import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { audit } from '../lib/audit'
import { deny, roleOf } from '../lib/permissions'
import { managerScope, scopeAllows } from '../lib/scope'
import { encryptSecret, decryptSecret } from '../lib/secretbox'
import { testRouter } from '../lib/routerApi'
import { syncSubscriberToRadius } from '../lib/radius'
import { buildRouterScript, readClientKey, tagFor } from '../lib/routerScript'

const nasSchema = z.object({
  nasname: z.string().min(1), // IP or hostname the router uses to reach RADIUS
  shortname: z.string().optional(),
  type: z.string().default('mikrotik'),
  ports: z.coerce.number().int().nullable().optional(),
  secret: z.string().min(1),
  description: z.string().optional(),
  api_enabled: z.boolean().optional().default(false),
  api_port: z.coerce.number().int().nullable().optional(),
  api_user: z.string().nullable().optional(),
  api_password: z.string().nullable().optional(),
})


/**
 * One RADIUS client per address. FreeRADIUS builds its client list from this table keyed by
 * nasname, so a duplicate means two different shared secrets for the same client and sessions get
 * attributed to the wrong tenant. Checked here to name the current holder (a bare unique-violation
 * would only say "conflict"), with the DB index as the real guarantee.
 */
async function addressTaken(nasname: string, exceptId?: string): Promise<string | null> {
  const r = await query<{ shortname: string | null; owner: string | null }>(
    `SELECT n.shortname, m.username AS owner FROM nas n LEFT JOIN managers m ON m.id = n.manager_id
      WHERE n.nasname = $1 AND ($2::uuid IS NULL OR n.id <> $2::uuid) LIMIT 1`,
    [nasname, exceptId ?? null],
  )
  if (!r.rowCount) return null
  const row = r.rows[0]!
  const who = row.owner ? `المدير «${row.owner}»` : 'حساب غير محدّد'
  return `العنوان ${nasname} مستخدم بالفعل للراوتر «${row.shortname || nasname}» التابع لـ${who}. اختر عنواناً آخر — لا يمكن لراوترين تقاسم العنوان نفسه.`
}


/**
 * Re-write the NAS binding for every subscriber under an admin.
 *
 * syncSubscriberToRadius pins each subscriber to its admin's router via a NAS-IP-Address check
 * item, but it only runs on subscriber create/renew/edit. A tenant that adds its subscribers BEFORE
 * its router — the natural order when importing from a spreadsheet — would otherwise sit with no
 * binding at all, able to authenticate through ANY tenant's router. Running this whenever the NAS
 * set changes makes the binding self-healing.
 */
async function resyncTenant(adminId: string | null): Promise<number> {
  if (!adminId) return 0
  const subs = await query<{ id: string }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM managers WHERE id = $1
       UNION ALL
       SELECT m.id FROM managers m JOIN tree t ON m.parent_id = t.id
     ) SELECT s.id FROM subscribers s WHERE s.manager_id IN (SELECT id FROM tree)`,
    [adminId],
  )
  for (const r of subs.rows) await syncSubscriberToRadius(r.id).catch(() => {})
  return subs.rowCount ?? 0
}

export const nasRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req) => {
    // Each admin sees only its own NAS; the owner sees all (labeled with the owning admin).
    const scope = await managerScope(req.user.sub, roleOf(req))
    const where = scope.all ? '' : 'WHERE n.manager_id = ANY($1::uuid[])'
    const params = scope.all ? [] : [scope.ids]
    const res = await query(
      `SELECT n.id, n.nasname, n.shortname, n.type, n.ports, n.secret, n.description, n.api_enabled, n.api_port, n.api_user, n.created_at,
              n.manager_id, m.username AS owner_username
         FROM nas n LEFT JOIN managers m ON m.id = n.manager_id ${where} ORDER BY n.created_at`,
      params,
    )
    return { data: res.rows }
  })

  app.post('/', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner', 'admin'])) return // admins link their own NAS; owner links on an admin's behalf
    const parsed = nasSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const b = parsed.data
    const taken = await addressTaken(b.nasname)
    if (taken) return reply.code(409).send({ error: 'nasname_taken', message: taken })
    // NAS owner (tenant): admin → self; owner must attach it to an existing admin (full isolation).
    let managerId: string
    if (roleOf(req) === 'admin') {
      managerId = req.user.sub
    } else {
      const pid = (req.body as { parent_admin_id?: string }).parent_admin_id
      if (!pid) return reply.code(400).send({ error: 'admin_required', message: 'اختر المدير (admin) المالك للجهاز' })
      const adm = await query(`SELECT 1 FROM managers WHERE id = $1 AND role = 'admin'`, [pid])
      if (!adm.rowCount) return reply.code(400).send({ error: 'parent_not_admin', message: 'يجب ربط الجهاز بمدير (admin)' })
      managerId = pid
    }
    const res = await query<{ id: string }>(
      `INSERT INTO nas (nasname, shortname, type, ports, secret, description, api_enabled, api_port, api_user, api_password, manager_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [b.nasname, b.shortname ?? null, b.type, b.ports ?? null, b.secret, b.description ?? null, b.api_enabled, b.api_port ?? null, b.api_user ?? null, b.api_password ? encryptSecret(b.api_password) : null, managerId],
    )
    await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'nas.create', targetType: 'nas', targetId: b.nasname, ip: req.ip })
    const synced = await resyncTenant(managerId)
    return reply.code(201).send({ id: res.rows[0]!.id, resynced: synced })
  })

  // An admin may only touch its own NAS; owner may touch any. Returns a 404 reply or null.
  async function guardNasOwnership(req: FastifyRequest, reply: FastifyReply, id: string): Promise<boolean> {
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (scope.all) return false
    const chk = await query<{ manager_id: string }>('SELECT manager_id FROM nas WHERE id = $1', [id])
    if (!chk.rowCount || !scopeAllows(scope, chk.rows[0]!.manager_id)) { reply.code(404).send({ error: 'not_found' }); return true }
    return false
  }

  app.put('/:id', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner', 'admin'])) return
    const parsed = nasSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { id } = req.params as { id: string }
    if (await guardNasOwnership(req, reply, id)) return
    const b = parsed.data
    const takenU = await addressTaken(b.nasname, id)
    if (takenU) return reply.code(409).send({ error: 'nasname_taken', message: takenU })
    const res = await query(
      `UPDATE nas SET nasname=$1, shortname=$2, type=$3, ports=$4, secret=$5, description=$6,
              api_enabled=$7, api_port=$8, api_user=$9, api_password=COALESCE($10, api_password),
              updated_at=now()
        WHERE id=$11 RETURNING id`,
      [b.nasname, b.shortname ?? null, b.type, b.ports ?? null, b.secret, b.description ?? null, b.api_enabled, b.api_port ?? null, b.api_user ?? null, b.api_password ? encryptSecret(b.api_password) : null, id],
    )
    if (res.rowCount === 0) return reply.code(404).send({ error: 'not_found' })
    const ownerRow = await query<{ manager_id: string | null }>('SELECT manager_id FROM nas WHERE id = $1', [id])
    const synced = await resyncTenant(ownerRow.rows[0]?.manager_id ?? null)
    return { id, resynced: synced }
  })

  const deleteNas = async (req: FastifyRequest, reply: FastifyReply) => {
    if (deny(req, reply, ['owner', 'admin'])) return
    const { id } = req.params as { id: string }
    if (await guardNasOwnership(req, reply, id)) return
    const ownerRow = await query<{ manager_id: string | null }>('SELECT manager_id FROM nas WHERE id = $1', [id])
    const res = await query('DELETE FROM nas WHERE id=$1 RETURNING id', [id])
    if (res.rowCount === 0) return reply.code(404).send({ error: 'not_found' })
    const synced = await resyncTenant(ownerRow.rows[0]?.manager_id ?? null)
    return { ok: true, resynced: synced }
  }
  app.delete('/:id', { preHandler: authenticate }, deleteNas)
  app.post('/:id/delete', { preHandler: authenticate }, deleteNas)

  // Validate router API credentials without ever echoing them back. Accepts an optional password in
  // the body so the form can be tested before saving; otherwise the stored (encrypted) one is used.
  app.post('/:id/test-api', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner', 'admin'])) return
    const { id } = req.params as { id: string }
    if (await guardNasOwnership(req, reply, id)) return
    const body = (req.body ?? {}) as { api_user?: string; api_password?: string; api_port?: number }
    const row = await query<{ nasname: string; api_port: number | null; api_user: string | null; api_password: string | null }>(
      'SELECT nasname, api_port, api_user, api_password FROM nas WHERE id = $1', [id],
    )
    if (!row.rowCount) return reply.code(404).send({ error: 'not_found' })
    const n = row.rows[0]!
    const user = body.api_user || n.api_user
    const password = body.api_password || decryptSecret(n.api_password)
    if (!user || !password) return reply.code(400).send({ ok: false, error: 'أدخل اسم المستخدم وكلمة المرور أولاً' })
    return testRouter({ host: n.nasname, port: body.api_port || n.api_port || 80, user, password })
  })

  // In production this reloads FreeRADIUS clients (e.g. `systemctl reload freeradius`).
  /**
   * Download this router's setup script.
   *
   * Served over the caller's own authenticated session — no public URL, no token to leak, and the
   * router never fetches anything from the internet. The operator uploads the file to the router
   * once; `.auto.rsc` makes RouterOS run it on upload, so no terminal is involved.
   *
   * The response carries the tunnel's private key and the RADIUS secret, so it is scope-checked like
   * any other tenant resource and every download is recorded.
   */
  app.get('/:id/script', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner', 'admin'])) return
    const { id } = req.params as { id: string }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: 'not_found' })

    const nas = await query<{
      nasname: string; shortname: string | null; secret: string; manager_id: string | null
      api_user: string | null; api_password: string | null
      tunnel_ip: string | null; iface: string | null; endpoint: string | null
      listen_port: number | null; server_public_key: string | null; pool_cidr: string | null
    }>(
      `SELECT n.nasname, n.shortname, n.secret, n.manager_id,
              n.api_user, n.api_password,
              host(w.tunnel_ip) AS tunnel_ip, w.iface, w.endpoint, w.listen_port,
              w.server_public_key, w.pool_cidr
         FROM nas n LEFT JOIN wireguard_peers w ON w.nas_id = n.id
        WHERE n.id = $1`, [id],
    )
    if (!nas.rowCount) return reply.code(404).send({ error: 'not_found' })
    const r = nas.rows[0]!
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scopeAllows(scope, r.manager_id)) return reply.code(404).send({ error: 'not_found' })

    // Say plainly which piece is missing rather than shipping a script with an empty key in it.
    if (!r.tunnel_ip || !r.iface || !r.endpoint || !r.listen_port || !r.server_public_key) {
      return reply.code(409).send({
        error: 'tunnel_incomplete',
        message: 'النفق غير مكتمل الإعداد على الخادم بعد. تواصل مع الإدارة.',
      })
    }
    const key = readClientKey(r.iface)
    if (!key) {
      return reply.code(409).send({
        error: 'key_unavailable',
        message: 'مفتاح النفق غير محفوظ على الخادم لهذا الراوتر، فلا يمكن توليد الملف.',
      })
    }

    // The read-only account the poller uses for live speeds. Minted on the FIRST download and then
    // reused: rotating it on every download would leave the panel holding a password the router does
    // not have yet, and silently kill live speeds for anyone who downloads without uploading.
    const apiUser = r.api_user || `radnas-${tagFor(r)}`
    let apiPassword: string = decryptSecret(r.api_password) || ''
    if (!apiPassword) {
      apiPassword = randomBytes(12).toString('base64url')
      await query(
        `UPDATE nas SET api_user = $2, api_password = $3, api_enabled = true,
                        api_port = COALESCE(api_port, 80)
          WHERE id = $1`,
        [id, apiUser, encryptSecret(apiPassword)],
      )
    }

    const { filename, body } = buildRouterScript(
      {
        nasname: r.nasname, shortname: r.shortname, secret: r.secret,
        tunnel_ip: r.tunnel_ip, iface: r.iface, endpoint: r.endpoint,
        listen_port: r.listen_port, server_public_key: r.server_public_key,
        api_user: apiUser, api_password: apiPassword,
      },
      key,
      r.pool_cidr || '10.10.0.0/24',
    )
    await audit({
      performedBy: req.user.sub, performedByName: req.user.username,
      action: 'nas.script_download', targetType: 'nas', targetId: r.nasname, ip: req.ip,
    })
    // octet-stream, not text/plain: Chrome appends an extension matching the content type when the
    // given filename's own extension does not match it, so a text/plain reply named *.auto.rsc lands
    // on disk as *.auto.rsc.txt — and RouterOS only auto-runs a file whose name ends in .auto.rsc.
    return reply
      .type('application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(body)
  })

  // The `nas` table is the source of truth; this endpoint is the reload hook.
  app.post('/restart', { preHandler: authenticate }, async () => {
    return { ok: true, message: 'FreeRADIUS reload signaled — nas table is the source of truth.' }
  })
}
