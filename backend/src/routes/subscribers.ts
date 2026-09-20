import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { audit } from '../lib/audit'
import { syncSubscriberToRadius, removeSubscriberFromRadius } from '../lib/radius'
import { notify } from '../lib/notify'
import { sendDisconnect } from '../lib/coa'
import { managerScope, scopeAllows } from '../lib/scope'
import { roleOf } from '../lib/permissions'

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional().default(''),
  // Narrow the list to one owning account (an admin or one of its resellers). Always intersected
  // with managerScope below, so it can only ever narrow what the caller may already see.
  manager_id: z.string().uuid().optional(),
  // Status/computed filters mirroring the competitor's chips:
  //  online/offline (radacct), expiring_1d/expiring_7d (expiry window),
  //  plus the raw account statuses.
  filter: z.enum([
    'all', 'online', 'offline', 'active', 'inactive', 'expired', 'disabled',
    'expiring_1d', 'expiring_7d',
  ]).optional(),
})

// Reusable correlated-subquery snippet (no user input → safe to inline).
const OPEN_SESSION = `EXISTS (SELECT 1 FROM radacct r WHERE r.username = s.username AND r.acctstoptime IS NULL)`

const createSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  full_name: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  plan_id: z.string().uuid().optional(),
  connection_type: z.enum(['pppoe', 'hotspot']).default('pppoe'),
  static_ip: z.string().optional(),
  manager_id: z.string().uuid().optional(), // owner assigns the subscriber to a specific tenant (admin/reseller)
})

const updateSchema = z.object({
  full_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  password: z.string().min(1).optional(),
  plan_id: z.string().uuid().nullable().optional(),
  static_ip: z.string().nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  manager_id: z.string().uuid().optional(), // reassign the subscriber to another tenant (owner/admin, within scope)
  // Service start. The end is DERIVED (starts_at + the plan's duration), never typed, so the two
  // can never contradict each other. Empty string clears the window; omitted leaves it untouched.
  starts_at: z.string().nullable().optional(),
})

/** Best-effort CoA Disconnect for a username via the first (or WireGuard-linked) NAS. Never throws. */
async function disconnectUsername(username: string): Promise<void> {
  try {
    const nas = (await query<{ id: string; nasname: string; secret: string }>(
      'SELECT id, nasname, secret FROM nas ORDER BY created_at LIMIT 1',
    )).rows[0]
    if (!nas) return
    const peer = await query<{ tunnel_ip: string }>(
      'SELECT host(tunnel_ip) AS tunnel_ip FROM wireguard_peers WHERE nas_id = $1 AND tunnel_ip IS NOT NULL LIMIT 1',
      [nas.id],
    )
    const host = peer.rows[0]?.tunnel_ip || nas.nasname
    const nasIp = /^\d+\.\d+\.\d+\.\d+$/.test(nas.nasname) ? nas.nasname : undefined
    await sendDisconnect({ host, secret: nas.secret, username, nasIp, retries: 1, timeoutMs: 800 })
  } catch {
    /* best-effort */
  }
}

/**
 * The subscriber quota governing the creator's tree. Walk UP to the admin ancestor (or self if
 * admin); if that admin has a max_subscribers, count its whole sub-tree. Returns {count,max} or
 * null (owner tree, or unlimited admin) meaning "no limit".
 */
async function checkSubscriberQuota(creatorId: string): Promise<{ count: number; max: number } | null> {
  const admin = await query<{ id: string; max_subscribers: number | null }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, role, max_subscribers FROM managers WHERE id = $1
       UNION ALL
       SELECT m.id, m.parent_id, m.role, m.max_subscribers FROM managers m JOIN up ON m.id = up.parent_id
     ) SELECT id, max_subscribers FROM up WHERE role = 'admin' LIMIT 1`,
    [creatorId],
  )
  const a = admin.rows[0]
  if (!a || a.max_subscribers == null) return null // owner tree, or unlimited admin
  const cnt = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM subscribers WHERE manager_id IN (
       WITH RECURSIVE d AS (
         SELECT id FROM managers WHERE id = $1
         UNION ALL
         SELECT m.id FROM managers m JOIN d ON m.parent_id = d.id
       ) SELECT id FROM d)`,
    [a.id],
  )
  return { count: cnt.rows[0]?.c ?? 0, max: a.max_subscribers }
}

/**
 * Renew one subscriber's period. Shared by the single-row action and the bulk one, so the two can
 * never drift apart — a bulk renewal that computed expiry differently from the single one would be
 * a billing bug nobody notices until a customer complains.
 *
 * Returns an outcome instead of throwing: a bulk run must report which rows succeeded and which did
 * not, rather than aborting the whole batch on the first subscriber that has no plan.
 */
export interface RenewOutcome {
  id: string
  username: string | null
  /** Whose subscriber this is — the notification has to reach that company, not the platform. */
  manager_id: string | null
  ok: boolean
  expiry_at?: string
  error?: 'not_found' | 'no_plan'
}

async function renewSubscriber(
  id: string,
  count: number,
  scope: Awaited<ReturnType<typeof managerScope>>,
  actor: { id: string; name: string; ip: string },
): Promise<RenewOutcome> {
  const sub = await query<{
    username: string; manager_id: string; status: string
    plan_id: string | null; duration_value: number | null; duration_unit: string | null
  }>(
    `SELECT s.username, s.manager_id, s.status, s.plan_id, p.duration_value, p.duration_unit
       FROM subscribers s LEFT JOIN plans p ON p.id = s.plan_id
      WHERE s.id = $1`,
    [id],
  )
  if (!sub.rowCount) return { id, username: null, manager_id: null, ok: false, error: 'not_found' }
  const s = sub.rows[0]!
  // Same answer as a missing row on purpose: a caller must not learn that an id it cannot see exists.
  if (!scopeAllows(scope, s.manager_id)) return { id, username: null, manager_id: null, ok: false, error: 'not_found' }
  if (!s.plan_id) return { id, username: s.username, manager_id: s.manager_id, ok: false, error: 'no_plan' }

  const unit = s.duration_unit ?? 'days'
  const value = s.duration_value ?? 30

  // Extend from the later of now / current expiry (renewing early keeps remaining time).
  const upd = await query<{ expiry_at: string }>(
    `UPDATE subscribers SET
       status         = 'active',
       is_paid        = true,
       paid_date      = current_date,
       expiry_warned  = false,
       bonus_quota_mb = 0,
       quota_locked   = false,
       fup_active     = false,
       -- A renewal starts a fresh allowance: the monthly quota is measured from this moment, not
       -- from the first of the calendar month. Clearing fup_active alone was not enough - the
       -- scheduler recomputes usage every few minutes and would put the throttle straight back.
       period_start_at = now(),
       expiry_at      = (CASE WHEN status = 'active' AND expiry_at > now() THEN expiry_at ELSE now() END)
                       + (($2::int * $4::int) * (CASE $3::text
                            WHEN 'hours'  THEN interval '1 hour'
                            WHEN 'months' THEN interval '1 month'
                            ELSE interval '1 day' END)),
       updated_at    = now()
     WHERE id = $1
     RETURNING expiry_at`,
    [id, value, unit, count],
  )

  await syncSubscriberToRadius(id)
  await audit({
    performedBy: actor.id, performedByName: actor.name, action: 'subscriber.renew',
    targetType: 'subscriber', targetId: s.username, details: `x${count}`, ip: actor.ip,
  })
  return { id, username: s.username, manager_id: s.manager_id, ok: true, expiry_at: upd.rows[0]?.expiry_at }
}

/** Periods to renew, e.g. months. Clamped 1..24; total extension = count x plan duration. */
const renewCount = (v: unknown): number => Math.min(24, Math.max(1, Math.floor(Number(v) || 1)))

export const subscriberRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' })
    const { page, limit, q, filter, manager_id } = parsed.data

    const conditions: string[] = []
    const params: unknown[] = []
    if (q) {
      params.push(`%${q}%`)
      conditions.push(
        `(s.username ILIKE $${params.length} OR s.full_name ILIKE $${params.length} OR s.phone ILIKE $${params.length})`,
      )
    }
    switch (filter) {
      case 'online':      conditions.push(OPEN_SESSION); break
      case 'offline':     conditions.push(`s.status = 'active' AND NOT ${OPEN_SESSION}`); break
      case 'active':
      case 'inactive':
      case 'expired':
      case 'disabled':    params.push(filter); conditions.push(`s.status = $${params.length}`); break
      case 'expiring_1d': conditions.push(`s.status = 'active' AND s.expiry_at IS NOT NULL AND s.expiry_at BETWEEN now() AND now() + interval '1 day'`); break
      case 'expiring_7d': conditions.push(`s.status = 'active' AND s.expiry_at IS NOT NULL AND s.expiry_at BETWEEN now() AND now() + interval '7 days'`); break
      // 'all' / undefined → no status condition
    }
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scope.all) {
      params.push(scope.ids)
      conditions.push(`s.manager_id = ANY($${params.length}::uuid[])`)
    }
    // Applied AFTER the scope condition, never instead of it — a crafted manager_id from another
    // tenant simply yields nothing rather than leaking rows.
    if (manager_id && (scope.all || scope.ids.includes(manager_id))) {
      params.push(manager_id)
      conditions.push(`s.manager_id = $${params.length}`)
    } else if (manager_id) {
      return { data: [], total: 0, page, limit }
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const totalRes = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM subscribers s ${whereSql}`,
      params,
    )

    params.push(limit, (page - 1) * limit)
    const rows = await query(
      `SELECT s.id, s.username, s.full_name, s.phone, s.address, s.status, s.mac, s.static_ip,
              s.plan_id, s.starts_at, s.expiry_at, s.is_paid, s.last_online_at, s.daily_used_mb, s.monthly_used_mb,
              s.connection_type, s.quota_locked, s.fup_active, COALESCE(s.bonus_quota_mb, 0) AS bonus_quota_mb, s.manager_id,
              p.name AS plan_name, p.price AS plan_price, p.monthly_quota_mb, p.daily_quota_mb, m.username AS manager_name,
              ${OPEN_SESSION} AS online,
              (SELECT host(r.framedipaddress) FROM radacct r
                 WHERE r.username = s.username AND r.acctstoptime IS NULL
                 ORDER BY r.acctstarttime DESC LIMIT 1) AS live_ip
         FROM subscribers s
         LEFT JOIN plans p ON p.id = s.plan_id
         LEFT JOIN managers m ON m.id = s.manager_id
         ${whereSql}
        ORDER BY s.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )

    return { data: rows.rows, page, limit, total: totalRes.rows[0]?.c ?? 0 }
  })

  app.post('/', { preHandler: authenticate }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const b = parsed.data
    // Which tenant owns this subscriber. Default = creator; but owner/admin may file it under a
    // manager WITHIN their scope, so it inherits that admin's NAS isolation + subscriber quota
    // (owner creating "under teranet" must land under teranet, not under the owner).
    let targetManager = req.user.sub
    if (b.manager_id && b.manager_id !== req.user.sub) {
      const scope = await managerScope(req.user.sub, roleOf(req))
      if (!scopeAllows(scope, b.manager_id)) return reply.code(403).send({ error: 'forbidden', message: 'لا يمكنك الإسناد لهذا الحساب' })
      const mgr = await query<{ role: string }>('SELECT role FROM managers WHERE id = $1', [b.manager_id])
      if (!mgr.rowCount) return reply.code(400).send({ error: 'invalid_manager' })
      if (mgr.rows[0]!.role === 'owner') return reply.code(400).send({ error: 'invalid_manager', message: 'اختر مديراً أو موزّعاً' })
      targetManager = b.manager_id
    }
    // Enforce the governing admin's subscriber quota (of the TARGET tenant, not the creator).
    const quota = await checkSubscriberQuota(targetManager)
    if (quota && quota.count >= quota.max) {
      return reply.code(403).send({ error: 'quota_reached', message: `بلغتَ الحدّ المسموح (${quota.max} مشترك). يلزم رفع الحصّة.` })
    }
    try {
      // New subscribers default to 'inactive' — RADIUS rejects them until the plan is renewed/activated.
      const res = await query<{ id: string }>(
        `INSERT INTO subscribers (username, password, full_name, phone, address, plan_id, connection_type, manager_id, static_ip, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'inactive') RETURNING id`,
        [b.username, b.password, b.full_name ?? null, b.phone ?? null, b.address ?? null, b.plan_id ?? null, b.connection_type, targetManager, b.static_ip || null],
      )
      const id = res.rows[0]!.id
      await syncSubscriberToRadius(id)
      await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'subscriber.create', targetType: 'subscriber', targetId: b.username, ip: req.ip })
      return reply.code(201).send({ id })
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'username_taken' })
      throw e
    }
  })

  // Renew the plan: extend the subscription period by the plan duration and activate.
  // No money/balance — licensing is by subscriber count (per-admin quota), not payment.
  app.post('/:id/charge', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const scope = await managerScope(req.user.sub, roleOf(req))
    const count = renewCount((req.body as { months?: number } | undefined)?.months)
    const r = await renewSubscriber(id, count, scope,
      { id: req.user.sub, name: req.user.username, ip: req.ip })

    if (!r.ok) {
      return reply.code(r.error === 'no_plan' ? 400 : 404).send({ error: r.error })
    }
    await notify({ kind: 'charged', managerId: r.manager_id, url: '/subscribers',
      title: 'تجديد باقة', body: `${r.username} (${count}×)` })
    return { ok: true, expiry_at: r.expiry_at, status: 'active' }
  })

  /**
   * Renew many at once — the month-end job for an ISP, where renewing 80 subscribers one row at a
   * time is the whole evening.
   *
   * Deliberately NOT one transaction: a subscriber with no plan must not roll back the 79 that
   * renewed fine. Each is renewed independently and the response says exactly which ones failed and
   * why, so the operator can fix those and re-run instead of guessing what took effect.
   *
   * Sequential rather than parallel: every renewal also rewrites that subscriber's RADIUS rows, and
   * a hundred concurrent writers would fight over the same tables for no gain on a batch this size.
   */
  app.post('/bulk-charge', { preHandler: authenticate }, async (req, reply) => {
    const body = (req.body ?? {}) as { ids?: unknown; months?: number }
    const raw = Array.isArray(body.ids) ? body.ids : []
    // Shape-check every id here: one malformed value reaching Postgres would raise 22P02 as a 500
    // and lose the outcome of everything already renewed in this batch.
    const ids = [...new Set(raw.filter(
      (v): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    ))]
    if (!ids.length) return reply.code(400).send({ error: 'no_ids', message: 'لم تُحدّد أي مشترك' })
    if (ids.length > 500) {
      return reply.code(400).send({ error: 'too_many', message: 'الحدّ 500 مشترك في العملية الواحدة' })
    }

    const scope = await managerScope(req.user.sub, roleOf(req))
    const count = renewCount(body.months)
    const actor = { id: req.user.sub, name: req.user.username, ip: req.ip }

    const results: RenewOutcome[] = []
    for (const id of ids) {
      try {
        results.push(await renewSubscriber(id, count, scope, actor))
      } catch (e) {
        app.log.error({ err: e, id }, 'bulk renew: subscriber failed')
        results.push({ id, username: null, manager_id: null, ok: false, error: 'not_found' })
      }
    }

    const renewed = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok)
    // One notification for the batch, not eighty.
    // One notification per owning company. A batch can span a reseller's customers and an admin's,
    // and each should hear only its own count — not the batch total.
    const perManager = new Map<string, number>()
    for (const r of renewed) {
      if (r.manager_id) perManager.set(r.manager_id, (perManager.get(r.manager_id) ?? 0) + 1)
    }
    for (const [mid, n] of perManager) {
      await notify({ kind: 'charged', managerId: mid, url: '/subscribers',
        title: 'تجديد جماعي', body: `${n} مشترك (${count}×)` })
    }
    await audit({
      performedBy: actor.id, performedByName: actor.name, action: 'subscriber.bulk_renew',
      details: `${renewed.length}/${ids.length} ×${count}`, ip: actor.ip,
    })
    return { ok: true, requested: ids.length, renewed: renewed.length, failed: failed.length, results }
  })

  // Sell extra data (GB) to a quota subscriber who burned through the bundle before the period ends.
  // Stacks on the plan's monthly quota (bonus_quota_mb); if it brings them back under quota, the FUP
  // throttle is lifted immediately (and they're reconnected at full speed).
  app.post('/:id/topup', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const gb = Number((req.body as { gb?: number } | undefined)?.gb)
    if (!Number.isFinite(gb) || gb <= 0) return reply.code(400).send({ error: 'invalid_amount' })
    const addMb = Math.min(1024 * 1024, Math.round(gb * 1024)) // cap 1 TB per top-up
    const sub = await query<{
      username: string; manager_id: string; monthly_used_mb: string; daily_used_mb: string
      monthly_quota_mb: number | null; daily_quota_mb: number | null
      fup_active: boolean; quota_locked: boolean
    }>(
      `SELECT s.username, s.manager_id, s.monthly_used_mb, s.daily_used_mb, s.fup_active, s.quota_locked,
              p.monthly_quota_mb, p.daily_quota_mb
         FROM subscribers s LEFT JOIN plans p ON p.id = s.plan_id
        WHERE s.id = $1`,
      [id],
    )
    if (!sub.rowCount) return reply.code(404).send({ error: 'not_found' })
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scopeAllows(scope, sub.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })
    const s = sub.rows[0]!
    // A daily-quota plan is just as toppable as a monthly one — refusing it here was why a
    // throttled subscriber on a daily plan could not be given extra GB at all.
    const isDaily = !!s.daily_quota_mb
    if (!s.monthly_quota_mb && !s.daily_quota_mb) {
      return reply.code(400).send({ error: 'no_quota', message: 'باقة هذا المشترك غير محدودة — لا حاجة لشحن غيغا.' })
    }
    // A daily top-up is bought for TODAY: it lapses at the next local midnight, otherwise it would
    // silently grant the same extra GB every day forever. Monthly bonuses keep clearing on renewal.
    const expiresSql = isDaily
      ? `(date_trunc('day', now() AT TIME ZONE $3) + interval '1 day') AT TIME ZONE $3`
      : 'NULL'
    const params: unknown[] = [id, addMb]
    if (isDaily) params.push(process.env.USAGE_TZ || 'Asia/Damascus')

    const upd = await query<{ bonus_quota_mb: string }>(
      `UPDATE subscribers SET bonus_quota_mb = bonus_quota_mb + $2, bonus_expires_at = ${expiresSql},
              updated_at = now() WHERE id = $1 RETURNING bonus_quota_mb`,
      params,
    )
    const newBonus = Number(upd.rows[0]!.bonus_quota_mb)
    // Mirrors enforceQuota: the bonus lifts whichever quota governs this plan. Checking only the
    // monthly figure would mis-answer on a daily plan (monthly_quota is null → compares against 0).
    // Quota columns are bigint (strings from node-pg) → coerce before any arithmetic.
    const mQuota = Number(s.monthly_quota_mb) || 0
    const dQuota = Number(s.daily_quota_mb) || 0
    const stillOver =
      (mQuota > 0 && Number(s.monthly_used_mb) >= mQuota + newBonus) ||
      (dQuota > 0 && Number(s.daily_used_mb) >= dQuota + newBonus)
    if (!stillOver && (s.fup_active || s.quota_locked)) {
      await query('UPDATE subscribers SET fup_active = false, quota_locked = false, updated_at = now() WHERE id = $1', [id])
      await syncSubscriberToRadius(id)
      await disconnectUsername(s.username) // reconnect at full speed
    }
    await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'subscriber.topup', targetType: 'subscriber', targetId: s.username, details: `+${gb}GB`, ip: req.ip })
    await notify({ kind: 'charged', managerId: s.manager_id, url: '/subscribers',
      title: 'شحن بيانات', body: `${gb}GB لـ ${s.username}` })
    return { ok: true, bonus_quota_mb: newBonus, monthly_quota_mb: s.monthly_quota_mb,
             daily_quota_mb: s.daily_quota_mb, applies_to: isDaily ? 'daily' : 'monthly', restored: !stillOver }
  })

  app.put('/:id', { preHandler: authenticate }, async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const { id } = req.params as { id: string }
    const chk = await query<{ manager_id: string; plan_id: string | null; status: string }>('SELECT manager_id, plan_id, status FROM subscribers WHERE id = $1', [id])
    if (!chk.rowCount) return reply.code(404).send({ error: 'not_found' })
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scopeAllows(scope, chk.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })
    const b = parsed.data
    // Optional tenant reassignment (owner/admin): must be a non-owner manager within the editor's scope.
    let newManager: string | null = null
    if (b.manager_id && b.manager_id !== chk.rows[0]!.manager_id) {
      if (!scopeAllows(scope, b.manager_id)) return reply.code(403).send({ error: 'forbidden', message: 'لا يمكنك الإسناد لهذا الحساب' })
      const mgr = await query<{ role: string }>('SELECT role FROM managers WHERE id = $1', [b.manager_id])
      if (!mgr.rowCount || mgr.rows[0]!.role === 'owner') return reply.code(400).send({ error: 'invalid_manager', message: 'اختر مديراً أو موزّعاً' })
      newManager = b.manager_id
    }
    // Switching an ACTIVE subscriber's plan re-bases the expiry on the NEW plan's duration
    // (monthly → daily ⇒ expiry becomes now + 1 day). Non-plan edits leave the expiry untouched.
    let reExpiry = false, durVal = 30, durUnit = 'days'
    if (b.plan_id && b.plan_id !== chk.rows[0]!.plan_id && chk.rows[0]!.status === 'active') {
      const pl = await query<{ duration_value: number; duration_unit: string }>('SELECT duration_value, duration_unit FROM plans WHERE id = $1', [b.plan_id])
      if (pl.rowCount) { reExpiry = true; durVal = pl.rows[0]!.duration_value; durUnit = pl.rows[0]!.duration_unit }
    }
    // A field is only touched when the client actually sent it; '' clears it back to NULL.
    const parseWhen = (v: string | null | undefined): [boolean, string | null] => {
      if (v === undefined) return [false, null]
      if (v === null || v === '') return [true, null]
      const d = new Date(v)
      return isNaN(d.getTime()) ? [false, null] : [true, d.toISOString()]
    }
    const [setStarts, startsVal] = parseWhen(b.starts_at)

    // Setting a start date re-derives the end from the plan in force (the newly chosen one if the
    // plan is being changed in the same save, otherwise the current one).
    let winVal = 30, winUnit = 'days'
    if (setStarts && startsVal) {
      const planId = b.plan_id ?? chk.rows[0]!.plan_id
      if (planId) {
        const pl = await query<{ duration_value: number; duration_unit: string }>(
          'SELECT duration_value, duration_unit FROM plans WHERE id = $1', [planId],
        )
        if (pl.rowCount) { winVal = pl.rows[0]!.duration_value; winUnit = pl.rows[0]!.duration_unit }
      }
    }

    try {
      const res = await query<{ username: string }>(
        `UPDATE subscribers SET
           full_name  = COALESCE($1, full_name),
           phone      = COALESCE($2, phone),
           address    = COALESCE($3, address),
           password   = COALESCE($4, password),
           plan_id    = COALESCE($5, plan_id),
           static_ip  = COALESCE($6, static_ip),
           status     = COALESCE($7, status),
           manager_id = COALESCE($8, manager_id),
           starts_at  = CASE WHEN $13::bool THEN $14::timestamptz ELSE starts_at END,
           -- Derived, never typed: start + the plan's own duration. Clearing the start clears it too.
           expiry_at  = CASE WHEN $13::bool AND $14::timestamptz IS NOT NULL
                               THEN $14::timestamptz + ($15::int * (CASE $16::text
                                 WHEN 'hours'  THEN interval '1 hour'
                                 WHEN 'months' THEN interval '1 month'
                                 ELSE interval '1 day' END))
                             WHEN $13::bool AND $14::timestamptz IS NULL THEN NULL
                             WHEN $10::bool THEN now() + ($11::int * (CASE $12::text
                               WHEN 'hours'  THEN interval '1 hour'
                               WHEN 'months' THEN interval '1 month'
                               ELSE interval '1 day' END))
                          ELSE expiry_at END,
           updated_at = now()
         WHERE id = $9 RETURNING username`,
        [b.full_name ?? null, b.phone ?? null, b.address ?? null, b.password ?? null,
         b.plan_id ?? null, b.static_ip ?? null, b.status ?? null, newManager, id, reExpiry, durVal, durUnit,
         setStarts, startsVal, winVal, winUnit],
      )
      // Reconcile the status with the window immediately, so the operator sees the effect of the
      // dates they just typed instead of waiting up to 10 minutes for the scheduler.
      // 'disabled' is a manual override and is never overwritten here.
      if (setStarts) {
        await query(
          `UPDATE subscribers SET status = CASE
             WHEN status = 'disabled' THEN status
             WHEN starts_at IS NOT NULL AND starts_at > now() THEN 'inactive'
             WHEN expiry_at IS NOT NULL AND expiry_at <= now() THEN 'expired'
             ELSE 'active' END,
           updated_at = now() WHERE id = $1`,
          [id],
        )
      }
      await syncSubscriberToRadius(id)
      if (b.status === 'disabled') await disconnectUsername(res.rows[0]!.username)
      await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'subscriber.update', targetType: 'subscriber', targetId: res.rows[0]!.username, ip: req.ip })
      return { ok: true }
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'username_taken' })
      throw e
    }
  })

  // The subscriber's own PPPoE credentials, for handing back to the subscriber.
  //
  // Deliberately its own endpoint rather than a column on the list: the list is 400 rows wide and
  // ends up in logs, caches and screenshots, and a password belongs in none of those. Here one row
  // is read, by an operator who already owns it, and the read is written to the audit trail — so
  // "who looked up this password" has an answer.
  //
  // The password is stored in the clear because RADIUS Cleartext-Password requires it; that is a
  // property of PPPoE, not a choice this endpoint makes.
  app.get('/:id/credentials', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = await query<{ username: string; password: string; manager_id: string; full_name: string | null }>(
      'SELECT username, password, manager_id, full_name FROM subscribers WHERE id = $1', [id],
    )
    if (!row.rowCount) return reply.code(404).send({ error: 'not_found' })
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    // Same answer as a missing row: a caller must not learn that an id outside its scope exists.
    if (!scopeAllows(scope, row.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })
    const r = row.rows[0]!
    await audit({
      performedBy: req.user.sub, performedByName: req.user.username, action: 'subscriber.credentials_read',
      targetType: 'subscriber', targetId: r.username, ip: req.ip,
    })
    return { username: r.username, password: r.password, full_name: r.full_name }
  })

  // Delete handler registered for both DELETE and POST /:id/delete (managed host blocks DELETE).
  const deleteSubscriber = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string }
    const row = await query<{ username: string; manager_id: string }>('SELECT username, manager_id FROM subscribers WHERE id = $1', [id])
    if (!row.rowCount) return reply.code(404).send({ error: 'not_found' })
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scopeAllows(scope, row.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })
    const username = row.rows[0]!.username
    await disconnectUsername(username)
    await removeSubscriberFromRadius(username)
    await query('DELETE FROM subscribers WHERE id = $1', [id])
    await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'subscriber.delete', targetType: 'subscriber', targetId: username, ip: req.ip })
    return { ok: true }
  }
  app.delete('/:id', { preHandler: authenticate }, deleteSubscriber)
  app.post('/:id/delete', { preHandler: authenticate }, deleteSubscriber)

  app.get('/:id/usage', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const sub = await query<{
      username: string; manager_id: string; daily_used_mb: string; monthly_used_mb: string
      quota_locked: boolean; fup_active: boolean; bonus_quota_mb: string
      daily_quota_mb: number | null; monthly_quota_mb: number | null; fup_behavior: string | null
    }>(
      `SELECT s.username, s.manager_id, s.daily_used_mb, s.monthly_used_mb, s.quota_locked, s.fup_active,
              COALESCE(s.bonus_quota_mb, 0) AS bonus_quota_mb,
              p.daily_quota_mb, p.monthly_quota_mb, p.fup_behavior
         FROM subscribers s LEFT JOIN plans p ON p.id = s.plan_id
        WHERE s.id = $1`,
      [id],
    )
    if (!sub.rowCount) return reply.code(404).send({ error: 'not_found' })
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scopeAllows(scope, sub.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })
    const username = sub.rows[0]!.username
    // radacct: input octets = رفع (client→net), output octets = تنزيل (net→client)
    const agg = await query<{ down: string; up: string; sessions: string; last: string | null }>(
      `SELECT COALESCE(SUM(acctoutputoctets), 0) AS down,
              COALESCE(SUM(acctinputoctets), 0)  AS up,
              COUNT(*)                           AS sessions,
              MAX(acctstarttime)                 AS last
         FROM radacct WHERE username = $1`,
      [username],
    )
    const a = agg.rows[0]!
    const toMb = (b: string) => Math.round((Number(b) / 1048576) * 100) / 100
    const row = sub.rows[0]!
    return {
      username,
      download_mb: toMb(a.down),
      upload_mb: toMb(a.up),
      total_mb: toMb(String(Number(a.down) + Number(a.up))),
      sessions: Number(a.sessions),
      last_session: a.last,
      daily_used_mb: Number(row.daily_used_mb),
      monthly_used_mb: Number(row.monthly_used_mb),
      daily_quota_mb: row.daily_quota_mb == null ? null : Number(row.daily_quota_mb),
      monthly_quota_mb: row.monthly_quota_mb == null ? null : Number(row.monthly_quota_mb),
      bonus_quota_mb: Number(row.bonus_quota_mb),
      fup_behavior: row.fup_behavior,
      quota_locked: row.quota_locked,
      fup_active: row.fup_active,
    }
  })

  app.post('/:id/sync', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scope.all) {
      const chk = await query<{ manager_id: string }>('SELECT manager_id FROM subscribers WHERE id = $1', [id])
      if (!chk.rowCount || !scopeAllows(scope, chk.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })
    }
    await syncSubscriberToRadius(id)
    return { ok: true }
  })
}
