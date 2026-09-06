import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { pool, query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { audit } from '../lib/audit'
import { managerScope, scopeAllows } from '../lib/scope'
import { deny, roleOf } from '../lib/permissions'
import { notify } from '../lib/notify'
import { disconnectSubscriber, reloadRadius } from '../lib/radiusOps'
import { provisionTenantTunnel, destroyTenantTunnel, type Provisioned } from '../lib/tunnelProvision'

const createSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(4),
  full_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().or(z.literal('')).optional(), // strict: valid email or blank
  company: z.string().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  role: z.enum(['admin', 'reseller']).default('reseller'),
  max_subscribers: z.coerce.number().int().positive().nullable().optional(), // admin quota; null = unlimited
})

const updateSchema = z.object({
  full_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  max_subscribers: z.coerce.number().int().positive().nullable().optional(), // owner adjusts admin quota
})

const resetPwSchema = z.object({ new_password: z.string().min(4) })

export const managerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req) => {
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    const where = scope.all ? '' : 'WHERE m.id = ANY($1::uuid[])'
    const res = await query(
      `SELECT m.id, m.parent_id, m.username, m.full_name, m.phone, m.email, m.company, m.role, m.points, m.status,
              m.max_subscribers, m.created_at,
              (SELECT count(*)::int FROM subscribers s WHERE s.manager_id IN (
                 WITH RECURSIVE d AS (
                   SELECT id FROM managers WHERE id = m.id
                   UNION ALL
                   SELECT mm.id FROM managers mm JOIN d ON mm.parent_id = d.id
                 ) SELECT id FROM d)) AS sub_count
         FROM managers m ${where} ORDER BY m.created_at`,
      scope.all ? [] : [scope.ids],
    )
    return { data: res.rows }
  })

  app.post('/', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner', 'admin'])) return // resellers cannot create managers
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const b = parsed.data
    // Resellers MUST belong to an admin. An admin creates resellers under itself; the owner
    // (super admin) must explicitly pick the parent admin. Only the owner may create admins.
    let role = b.role
    let parentId = req.user.sub
    if (roleOf(req) === 'admin') {
      if (b.role !== 'reseller') return reply.code(403).send({ error: 'forbidden', message: 'يمكنك إنشاء موزّعين فقط' })
      role = 'reseller'
      parentId = req.user.sub
    } else if (b.role === 'reseller') {
      // owner creating a reseller → require a valid admin parent
      if (!b.parent_id) return reply.code(400).send({ error: 'admin_required', message: 'يجب تحديد المدير (admin) التابع له الموزّع' })
      const parent = await query<{ role: string }>('SELECT role FROM managers WHERE id = $1', [b.parent_id])
      if (!parent.rowCount || parent.rows[0]!.role !== 'admin') {
        return reply.code(400).send({ error: 'parent_not_admin', message: 'المدير المحدّد غير صالح — يجب أن يكون admin' })
      }
      parentId = b.parent_id
    }
    // (owner creating an admin → parentId stays = owner)
    const maxSubs = role === 'admin' ? (b.max_subscribers ?? null) : null // quota applies to admins only
    const hash = await bcrypt.hash(b.password, 10)
    try {
      const res = await query<{ id: string }>(
        `INSERT INTO managers (username, password_hash, full_name, phone, email, company, parent_id, role, max_subscribers)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [b.username, hash, b.full_name ?? null, b.phone ?? null, b.email || null, b.company || null, parentId, role, maxSubs],
      )
      await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'manager.create', targetType: 'manager', targetId: b.username, ip: req.ip })
      return reply.code(201).send({ id: res.rows[0]!.id })
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'username_taken' })
      throw e
    }
  })

  // A manager (admin/reseller) asks the owner to raise the quota when full. Notifies the owner.
  app.post('/request-upgrade', { preHandler: authenticate }, async (req, reply) => {
    const desired = (req.body as { max_subscribers?: number })?.max_subscribers
    await notify({ kind: 'upgrade', url: '/managers', title: 'طلب ترقية حصّة',
      body: `${req.user.username}${desired ? ` يطلب ${desired} مشترك` : ' يطلب ترقية'}.` })
    await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'quota.upgrade_request', details: desired ? String(desired) : '', ip: req.ip })
    return reply.send({ ok: true })
  })

  app.put('/:id', { preHandler: authenticate }, async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { id } = req.params as { id: string }
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scopeAllows(scope, id)) return reply.code(404).send({ error: 'not_found' })
    const b = parsed.data
    const res = await query(
      `UPDATE managers
          SET full_name = COALESCE($1, full_name),
              phone     = COALESCE($2, phone),
              email     = COALESCE($3, email),
              company   = COALESCE($4, company),
              status    = COALESCE($5, status),
              updated_at = now()
        WHERE id = $6 RETURNING id`,
      [b.full_name ?? null, b.phone ?? null, b.email ?? null, b.company ?? null, b.status ?? null, id],
    )
    if (res.rowCount === 0) return reply.code(404).send({ error: 'not_found' })
    // Only the owner may change an admin's subscriber quota (upgrade). null = unlimited.
    if (b.max_subscribers !== undefined && roleOf(req) === 'owner') {
      await query(`UPDATE managers SET max_subscribers = $1, updated_at = now() WHERE id = $2 AND role = 'admin'`, [b.max_subscribers, id])
    }
    return { id }
  })

  // Owner/admin reset a sub-manager's login password (no email needed — covers a forgotten password).
  app.post('/:id/reset-password', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner', 'admin'])) return
    const parsed = resetPwSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', message: 'كلمة المرور 4 أحرف على الأقل' })
    const { id } = req.params as { id: string }
    if (id === req.user.sub) return reply.code(400).send({ error: 'use_change_password', message: 'استخدم «تغيير كلمة المرور» لحسابك' })
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scopeAllows(scope, id)) return reply.code(404).send({ error: 'not_found' })
    const chk = await query<{ role: string; username: string }>('SELECT role, username FROM managers WHERE id = $1', [id])
    if (!chk.rowCount) return reply.code(404).send({ error: 'not_found' })
    if (chk.rows[0]!.role === 'owner') return reply.code(400).send({ error: 'cannot_reset_owner', message: 'لا يمكن إعادة تعيين كلمة مرور المالك من هنا' })
    const hash = await bcrypt.hash(parsed.data.new_password, 10)
    await query('UPDATE managers SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, id])
    await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'manager.reset_password', targetType: 'manager', targetId: chk.rows[0]!.username, ip: req.ip })
    return { ok: true }
  })

  // ---- Self-signup approval -------------------------------------------------------------
  // A company that registers at /register lands as status='pending' and cannot log in until the
  // platform owner decides. Owner-only: signups always attach under the owner as admins, so no
  // other role has standing to approve them.
  app.get('/pending', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    const res = await query(
      `SELECT id, username, company, full_name, phone, email, max_subscribers, created_at
         FROM managers WHERE status = 'pending' ORDER BY created_at`,
    )
    return { data: res.rows, total: res.rowCount }
  })

  async function decide(req: FastifyRequest, reply: FastifyReply, approve: boolean) {
    if (deny(req, reply, ['owner'])) return
    const { id } = req.params as { id: string }
    // Guard the cast: a malformed id would otherwise reach Postgres and raise 22P02 as a 500.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) {
      return reply.code(404).send({ error: 'not_found' })
    }
    const chk = await query<{ username: string; company: string | null; status: string }>(
      'SELECT username, company, status FROM managers WHERE id = $1', [id],
    )
    if (!chk.rowCount) return reply.code(404).send({ error: 'not_found' })
    const m = chk.rows[0]!
    if (m.status !== 'pending') return reply.code(400).send({ error: 'not_pending', message: 'هذا الطلب تمّت معالجته سابقاً' })
    // 'rejected' rather than DELETE: the username stays taken, so a rejected applicant cannot
    // silently re-register the same name, and the decision remains auditable.
    await query('UPDATE managers SET status = $1, updated_at = now() WHERE id = $2', [approve ? 'active' : 'rejected', id])
    await audit({
      performedBy: req.user.sub, performedByName: req.user.username,
      action: approve ? 'company.approved' : 'company.rejected',
      targetType: 'manager', targetId: m.username, ip: req.ip,
    })
    await notify({ kind: 'signup', url: '/managers',
      title: approve ? 'تمت الموافقة على شركة' : 'تم رفض طلب',
      body: m.company || m.username })

    // Approval builds the company's tunnel and router record right away, so the very first thing it
    // sees after logging in is a finished setup file — not a checklist of things to arrange with us.
    // A failure here must not undo the approval: the account is live either way, and the panel shows
    // the router step unfinished, which is recoverable. Reporting it back is enough.
    let tunnel: Provisioned | null = null
    let tunnelError: string | null = null
    if (approve) {
      try {
        tunnel = await provisionTenantTunnel(id, m.company || m.username)
        await audit({
          performedBy: req.user.sub, performedByName: req.user.username,
          action: 'tunnel.provisioned', targetType: 'nas', targetId: tunnel.nasname, ip: req.ip,
        })
      } catch (e) {
        tunnelError = (e as Error).message
        app.log.error({ err: e, manager: m.username }, 'tunnel provisioning failed')
      }
    }
    return {
      ok: true,
      status: approve ? 'active' : 'rejected',
      tunnel: tunnel && { iface: tunnel.iface, router_ip: tunnel.tunnel_ip, created: tunnel.created },
      tunnel_error: tunnelError,
    }
  }
  app.post('/:id/approve', { preHandler: authenticate }, (req, reply) => decide(req, reply, true))
  app.post('/:id/reject', { preHandler: authenticate }, (req, reply) => decide(req, reply, false))

  /**
   * Everything that dies with an account.
   *
   * Every foreign key into `managers` was ON DELETE SET NULL, so deleting a company used to detach
   * its rows rather than remove them: its subscribers survived as ownerless records that were still
   * active and still held radcheck credentials, so they kept authenticating — invisible in the panel
   * and billed to nobody. Its router stayed a valid RADIUS client with a working secret, and its
   * WireGuard tunnel kept running on the machine. radcheck and radreply have no foreign key at all,
   * so nothing was ever going to clean them up on its own.
   */
  interface DeleteScope {
    managerIds: string[]
    usernames: string[]
    nasIds: string[]
    ifaces: string[]
    counts: Record<string, number>
  }

  async function gatherDeleteScope(rootId: string): Promise<DeleteScope> {
    // Sub-managers go with their parent. Leaving them behind would promote a reseller into a
    // top-level account nobody owns, carrying every subscriber under it.
    const tree = await query<{ id: string }>(
      `WITH RECURSIVE t AS (
         SELECT id FROM managers WHERE id = $1
         UNION ALL
         SELECT m.id FROM managers m JOIN t ON m.parent_id = t.id
       ) SELECT id FROM t`, [rootId],
    )
    const managerIds = tree.rows.map((r) => r.id)

    const [subs, nas, plans, invoices, txns, batches, pushes] = await Promise.all([
      query<{ username: string }>(
        'SELECT username FROM subscribers WHERE manager_id = ANY($1::uuid[])', [managerIds]),
      query<{ id: string; iface: string | null }>(
        `SELECT n.id, w.iface FROM nas n LEFT JOIN wireguard_peers w ON w.nas_id = n.id
          WHERE n.manager_id = ANY($1::uuid[])`, [managerIds]),
      query('SELECT 1 FROM plans WHERE manager_id = ANY($1::uuid[])', [managerIds]),
      query('SELECT 1 FROM invoices WHERE manager_id = ANY($1::uuid[])', [managerIds]),
      query('SELECT 1 FROM transactions WHERE manager_id = ANY($1::uuid[])', [managerIds]),
      query('SELECT 1 FROM hotspot_batches WHERE manager_id = ANY($1::uuid[])', [managerIds]),
      query('SELECT 1 FROM push_subscriptions WHERE manager_id = ANY($1::uuid[])', [managerIds]),
    ])

    return {
      managerIds,
      usernames: subs.rows.map((r) => r.username),
      nasIds: nas.rows.map((r) => r.id),
      ifaces: nas.rows.map((r) => r.iface).filter((i): i is string => !!i),
      counts: {
        managers: managerIds.length,
        subscribers: subs.rowCount ?? 0,
        routers: nas.rowCount ?? 0,
        tunnels: nas.rows.filter((r) => r.iface).length,
        plans: plans.rowCount ?? 0,
        invoices: invoices.rowCount ?? 0,
        transactions: txns.rowCount ?? 0,
        hotspot_batches: batches.rowCount ?? 0,
        devices: pushes.rowCount ?? 0,
      },
    }
  }

  /** Guard shared by preview and delete. Returns the username when allowed, null once it replied. */
  async function guardDelete(req: FastifyRequest, reply: FastifyReply, id: string): Promise<string | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) {
      reply.code(404).send({ error: 'not_found' }); return null
    }
    if (id === req.user.sub) {
      reply.code(400).send({ error: 'cannot_delete_self', message: 'لا يمكنك حذف حسابك' }); return null
    }
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scopeAllows(scope, id)) { reply.code(404).send({ error: 'not_found' }); return null }
    const chk = await query<{ role: string; username: string }>(
      'SELECT role, username FROM managers WHERE id = $1', [id])
    if (!chk.rowCount) { reply.code(404).send({ error: 'not_found' }); return null }
    if (chk.rows[0]!.role === 'owner') { reply.code(400).send({ error: 'cannot_delete_owner' }); return null }
    return chk.rows[0]!.username
  }

  /** What deleting this account would destroy. Removes nothing — the panel shows this first. */
  app.get('/:id/delete-preview', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const username = await guardDelete(req, reply, id)
    if (!username) return
    const sc = await gatherDeleteScope(id)
    return { username, counts: sc.counts, tunnels: sc.ifaces }
  })

  const deleteManager = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string }
    const username = await guardDelete(req, reply, id)
    if (!username) return
    const sc = await gatherDeleteScope(id)

    // Drop live sessions first: once the rows are gone there is no secret left to sign a CoA with,
    // and the subscriber would stay online until the router's own session timeout.
    for (const u of sc.usernames.slice(0, 200)) {
      await disconnectSubscriber(u, id).catch(() => {})
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const M = [sc.managerIds]
      const U = [sc.usernames]
      // The RADIUS tables are keyed by username with no foreign key, so they have to be named
      // explicitly — this is the part that actually stops a deleted company's subscribers from
      // continuing to authenticate.
      if (sc.usernames.length) {
        await client.query('DELETE FROM radcheck    WHERE username = ANY($1::text[])', U)
        await client.query('DELETE FROM radreply    WHERE username = ANY($1::text[])', U)
        await client.query('DELETE FROM radpostauth WHERE username = ANY($1::text[])', U)
        await client.query('DELETE FROM radacct     WHERE username = ANY($1::text[])', U)
      }
      await client.query('DELETE FROM subscribers     WHERE manager_id = ANY($1::uuid[])', M)
      await client.query('DELETE FROM invoices        WHERE manager_id = ANY($1::uuid[])', M)
      await client.query('DELETE FROM transactions    WHERE manager_id = ANY($1::uuid[])', M)
      await client.query('DELETE FROM hotspot_batches WHERE manager_id = ANY($1::uuid[])', M)
      await client.query('DELETE FROM plans           WHERE manager_id = ANY($1::uuid[])', M)
      // wireguard_peers.nas_id is ON DELETE SET NULL, not CASCADE — deleting the router would
      // otherwise leave the peer row behind holding an interface name that no longer belongs to
      // anyone. Delete it explicitly rather than trusting a constraint's behaviour.
      if (sc.nasIds.length) {
        await client.query('DELETE FROM wireguard_peers WHERE nas_id = ANY($1::uuid[])', [sc.nasIds])
      }
      await client.query('DELETE FROM nas             WHERE manager_id = ANY($1::uuid[])', M)
      await client.query('DELETE FROM managers        WHERE id = ANY($1::uuid[])', M)
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      app.log.error({ err: e, manager: username }, 'cascade delete failed')
      return reply.code(500).send({ error: 'delete_failed', message: 'تعذّر الحذف — لم يُحذف شيء.' })
    } finally {
      client.release()
    }

    // Only after the rows are gone: tearing the tunnel down first would strand the machine without
    // a tunnel while the database still described one, had the transaction then failed.
    const removed: string[] = []
    for (const iface of sc.ifaces) {
      if (await destroyTenantTunnel(iface)) removed.push(iface)
    }
    // FreeRADIUS keeps its client list in memory from startup, so a deleted NAS still answers until
    // it reloads.
    if (sc.nasIds.length) await reloadRadius()

    await audit({
      performedBy: req.user.sub, performedByName: req.user.username,
      action: 'manager.delete', targetType: 'manager', targetId: username, ip: req.ip,
      details: `subs=${sc.counts.subscribers} nas=${sc.counts.routers} tunnels=${removed.length}`,
    })
    return { ok: true, deleted: sc.counts, tunnels_removed: removed }
  }

  app.delete('/:id', { preHandler: authenticate }, deleteManager)
  app.post('/:id/delete', { preHandler: authenticate }, deleteManager)
}
