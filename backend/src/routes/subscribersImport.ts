import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { audit } from '../lib/audit'
import { roleOf } from '../lib/permissions'
import { managerScope, scopeAllows } from '../lib/scope'
import { syncSubscriberToRadius } from '../lib/radius'

/**
 * Bulk subscriber import (spreadsheet migration from another ISP system).
 *
 * The file is parsed in the BROWSER and arrives here as plain rows, so the server needs no
 * multipart/xlsx dependency. Everything that decides an outcome — plan lookup, duplicate detection,
 * tenant scope, quota — is resolved server-side, because the client must never be trusted to say
 * whether a subscriber already exists or which tenant owns it.
 *
 * `dry_run` returns the identical per-row verdicts without writing anything, which is what the
 * preview step renders. Nothing is imported blind.
 */

const rowSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().trim().min(1),
  full_name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  static_ip: z.string().trim().optional(),
  plan: z.string().trim().optional(),      // plan NAME as written in the sheet
  created_at: z.string().trim().optional(), // ISO date, used when activation = from_created
})

const importSchema = z.object({
  rows: z.array(rowSchema).min(1).max(2000),
  manager_id: z.string().uuid().optional(),
  /**
   * from_today   — activate now, expiry = today + plan duration (safe default for a migration:
   *                nobody is cut off, and normal renewals take over afterwards)
   * from_created — expiry = the sheet's creation date + plan duration (faithful to the old system,
   *                but anything already past its period lands expired)
   * inactive     — import only; assign plans/activate later by hand
   */
  activation: z.enum(['from_today', 'from_created', 'inactive']).default('from_today'),
  /** Existing usernames: skip them, or overwrite from the sheet. */
  on_duplicate: z.enum(['skip', 'update']).default('skip'),
  dry_run: z.boolean().default(false),
})

type Verdict = 'create' | 'update' | 'skip' | 'error'
interface RowResult {
  row: number
  username: string
  verdict: Verdict
  reason?: string
  plan_name?: string | null
  expiry_at?: string | null
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export const subscriberImportRoutes: FastifyPluginAsync = async (app) => {
  app.post('/import', { preHandler: authenticate }, async (req, reply) => {
    const parsed = importSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const { rows, activation, on_duplicate, dry_run } = parsed.data

    const role = roleOf(req)
    if (role === 'reseller') return reply.code(403).send({ error: 'forbidden', message: 'الاستيراد متاح للمدير فقط' })
    const scope = await managerScope(req.user.sub, role)

    // ---- resolve the owning tenant -------------------------------------------------------
    let targetManager = req.user.sub
    if (parsed.data.manager_id && parsed.data.manager_id !== req.user.sub) {
      if (!scopeAllows(scope, parsed.data.manager_id)) return reply.code(403).send({ error: 'forbidden' })
      const mgr = await query<{ role: string }>('SELECT role FROM managers WHERE id = $1', [parsed.data.manager_id])
      if (!mgr.rowCount || mgr.rows[0]!.role === 'owner') return reply.code(400).send({ error: 'invalid_manager', message: 'اختر مديراً أو موزّعاً' })
      targetManager = parsed.data.manager_id
    } else if (role === 'owner') {
      return reply.code(400).send({ error: 'manager_required', message: 'اختر الحساب المالك للمشتركين' })
    }

    // ---- plans visible to this account, matched by name ----------------------------------
    const planRows = await query<{ id: string; name: string; duration_value: number | null; duration_unit: string | null }>(
      `SELECT p.id, p.name, p.duration_value, p.duration_unit FROM plans p
        WHERE p.manager_id IS NULL OR p.manager_id = ANY($1::uuid[])`,
      [scope.all ? [] : scope.ids],
    )
    const planByName = new Map(planRows.rows.map((p) => [norm(p.name), p]))

    // ---- quota headroom (counted once, then decremented as we plan inserts) ---------------
    const quotaRes = await query<{ max_subscribers: number | null }>(
      `WITH RECURSIVE up AS (
         SELECT id, parent_id, role, max_subscribers FROM managers WHERE id = $1
         UNION ALL
         SELECT m.id, m.parent_id, m.role, m.max_subscribers FROM managers m JOIN up ON up.parent_id = m.id
       ) SELECT max_subscribers FROM up WHERE role = 'admin' LIMIT 1`,
      [targetManager],
    )
    const maxSubs = quotaRes.rows[0]?.max_subscribers ?? null
    let headroom = Infinity
    if (maxSubs != null) {
      const used = await query<{ c: number }>(
        `WITH RECURSIVE down AS (
           SELECT id FROM managers WHERE id = (
             WITH RECURSIVE up AS (
               SELECT id, parent_id, role FROM managers WHERE id = $1
               UNION ALL SELECT m.id, m.parent_id, m.role FROM managers m JOIN up ON up.parent_id = m.id
             ) SELECT id FROM up WHERE role = 'admin' LIMIT 1)
           UNION ALL
           SELECT m.id FROM managers m JOIN down d ON m.parent_id = d.id
         ) SELECT count(*)::int AS c FROM subscribers WHERE manager_id IN (SELECT id FROM down)`,
        [targetManager],
      )
      headroom = Math.max(0, maxSubs - (used.rows[0]?.c ?? 0))
    }

    // ---- existing usernames, restricted to what this account may touch -------------------
    const names = rows.map((r) => r.username)
    const existing = await query<{ id: string; username: string; manager_id: string | null }>(
      `SELECT id, username, manager_id FROM subscribers WHERE username = ANY($1::text[])`,
      [names],
    )
    const existingByName = new Map(existing.rows.map((e) => [e.username, e]))

    const results: RowResult[] = []
    const seen = new Set<string>()
    let created = 0, updated = 0

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!
      const out: RowResult = { row: i + 1, username: r.username, verdict: 'error' }

      if (seen.has(r.username)) { out.reason = 'مكرّر داخل الملف نفسه'; results.push(out); continue }
      seen.add(r.username)

      // plan lookup
      let plan = null as (typeof planRows.rows)[number] | null
      if (r.plan) {
        plan = planByName.get(norm(r.plan)) ?? null
        if (!plan) { out.reason = `الباقة «${r.plan}» غير موجودة`; results.push(out); continue }
      }
      out.plan_name = plan?.name ?? null

      // expiry
      let expiry: Date | null = null
      if (activation !== 'inactive' && plan) {
        const unit = plan.duration_unit ?? 'days'
        const value = plan.duration_value ?? 30
        const base = activation === 'from_created' && r.created_at && !isNaN(Date.parse(r.created_at))
          ? new Date(r.created_at) : new Date()
        expiry = new Date(base)
        if (unit === 'hours') expiry.setHours(expiry.getHours() + value)
        else if (unit === 'months') expiry.setMonth(expiry.getMonth() + value)
        else expiry.setDate(expiry.getDate() + value)
      } else if (activation !== 'inactive' && !plan) {
        out.reason = 'التفعيل يتطلّب باقة — أضف عمود الباقة أو اختر «استيراد غير مفعّل»'
        results.push(out); continue
      }
      out.expiry_at = expiry ? expiry.toISOString() : null
      const status = activation === 'inactive' || !expiry ? 'inactive' : 'active'

      const ex = existingByName.get(r.username)
      if (ex) {
        // An admin must not be able to overwrite another tenant's subscriber by guessing a username.
        if (!scopeAllows(scope, ex.manager_id)) { out.verdict = 'skip'; out.reason = 'الاسم مستخدم في حساب آخر'; results.push(out); continue }
        if (on_duplicate === 'skip') { out.verdict = 'skip'; out.reason = 'موجود مسبقاً'; results.push(out); continue }
        out.verdict = 'update'
        if (!dry_run) {
          await query(
            `UPDATE subscribers SET password=$1, full_name=COALESCE($2, full_name), phone=COALESCE($3, phone),
                    address=COALESCE($4, address), static_ip=COALESCE($5, static_ip),
                    plan_id=COALESCE($6, plan_id),
                    expiry_at=COALESCE($7, expiry_at), status=CASE WHEN $8::text = 'active' THEN 'active' ELSE status END,
                    is_paid = CASE WHEN $8::text = 'active' THEN true ELSE is_paid END,
                    updated_at=now()
              WHERE id=$9`,
            [r.password, r.full_name ?? null, r.phone ?? null, r.address ?? null, r.static_ip || null,
             plan?.id ?? null, expiry, status, ex.id],
          )
          await syncSubscriberToRadius(ex.id)
        }
        updated++
        results.push(out); continue
      }

      if (headroom <= 0) { out.verdict = 'error'; out.reason = `تجاوز الحصّة (${maxSubs} مشترك)`; results.push(out); continue }
      out.verdict = 'create'
      if (!dry_run) {
        const ins = await query<{ id: string }>(
          `INSERT INTO subscribers (username, password, full_name, phone, address, plan_id, connection_type,
                                    manager_id, static_ip, status, expiry_at, is_paid)
           VALUES ($1,$2,$3,$4,$5,$6,'pppoe',$7,$8,$9,$10,$11) RETURNING id`,
          [r.username, r.password, r.full_name ?? null, r.phone ?? null, r.address ?? null, plan?.id ?? null,
           targetManager, r.static_ip || null, status, expiry, status === 'active'],
        )
        await syncSubscriberToRadius(ins.rows[0]!.id)
      }
      headroom--
      created++
      results.push(out)
    }

    if (!dry_run) {
      await audit({
        performedBy: req.user.sub, performedByName: req.user.username,
        action: 'subscriber.import', targetType: 'subscriber',
        targetId: `${created} created, ${updated} updated`,
        details: `rows=${rows.length} activation=${activation} on_duplicate=${on_duplicate}`, ip: req.ip,
      })
    }

    return {
      dry_run,
      total: rows.length,
      created, updated,
      skipped: results.filter((r) => r.verdict === 'skip').length,
      errors: results.filter((r) => r.verdict === 'error').length,
      headroom: maxSubs == null ? null : headroom,
      results,
    }
  })
}
