import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { audit } from '../lib/audit'
import { managerScope } from '../lib/scope'
import { roleOf } from '../lib/permissions'
import { buildRateLimit } from '../lib/radius'

function rand(len: number): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

const genSchema = z.object({
  plan_id: z.string().uuid(),
  count: z.coerce.number().int().min(1).max(500),
})

export const hotspotRoutes: FastifyPluginAsync = async (app) => {
  // Cards inherit their tenant from the batch that produced them. Every read below is filtered by
  // it — unscoped, /cards handed out every tenant's voucher PASSWORDS.
  const mine = async (req: Parameters<typeof authenticate>[0]) => {
    const scope = await managerScope(req.user.sub, roleOf(req))
    return scope.all ? null : scope.ids
  }

  app.get('/stats', { preHandler: authenticate }, async (req) => {
    const ids = await mine(req)
    const f = ids ? `AND b.manager_id = ANY($1::uuid[])` : ''
    const p = ids ? [ids] : []
    const one = async (extra: string): Promise<number> =>
      Number((await query<{ c: number }>(
        `SELECT count(*)::int AS c FROM hotspot_cards c
           JOIN hotspot_batches b ON b.id = c.batch_id WHERE true ${extra} ${f}`, p)).rows[0]?.c ?? 0)
    const [total, unused, active, expired] = await Promise.all([
      one(''), one(`AND c.status = 'unused'`), one(`AND c.status = 'active'`), one(`AND c.status = 'expired'`),
    ])
    const batches = Number((await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM hotspot_batches b WHERE true ${f}`, p)).rows[0]?.c ?? 0)
    return { total, unused, active, expired, batches }
  })

  app.get('/batches', { preHandler: authenticate }, async (req) => {
    const ids = await mine(req)
    const res = await query(
      `SELECT b.id, b.code, b.count, b.created_at, p.name AS plan_name,
              (SELECT count(*)::int FROM hotspot_cards c WHERE c.batch_id = b.id) AS cards_count
         FROM hotspot_batches b LEFT JOIN plans p ON p.id = b.plan_id
        ${ids ? 'WHERE b.manager_id = ANY($1::uuid[])' : ''}
        ORDER BY b.created_at DESC`,
      ids ? [ids] : [],
    )
    return { data: res.rows }
  })

  app.get('/cards', { preHandler: authenticate }, async (req) => {
    const { batch_id } = req.query as { batch_id?: string }
    const ids = await mine(req)
    const conds: string[] = []
    const params: unknown[] = []
    if (batch_id) { params.push(batch_id); conds.push(`c.batch_id = $${params.length}`) }
    if (ids) { params.push(ids); conds.push(`b.manager_id = ANY($${params.length}::uuid[])`) }
    const res = await query(
      `SELECT c.id, c.username, c.password, c.status, c.expiry_at, c.created_at, p.name AS plan_name
         FROM hotspot_cards c
         JOIN hotspot_batches b ON b.id = c.batch_id
         LEFT JOIN plans p ON p.id = c.plan_id
         ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
        ORDER BY c.created_at DESC LIMIT 500`,
      params,
    )
    return { data: res.rows }
  })

  app.post('/batches', { preHandler: authenticate }, async (req, reply) => {
    const parsed = genSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { plan_id, count } = parsed.data

    const plan = await query<{ download_mbps: number; upload_mbps: number }>(
      'SELECT download_mbps, upload_mbps FROM plans WHERE id = $1',
      [plan_id],
    )
    if (plan.rowCount === 0) return reply.code(400).send({ error: 'plan_not_found' })
    const p = plan.rows[0]!
    const rl = buildRateLimit(p.download_mbps ?? 0, p.upload_mbps ?? 0)

    const code = 'B' + Date.now().toString(36)
    const batch = await query<{ id: string }>(
      'INSERT INTO hotspot_batches (code, plan_id, manager_id, count) VALUES ($1,$2,$3,$4) RETURNING id',
      [code, plan_id, req.user.sub, count],
    )
    const batchId = batch.rows[0]!.id

    for (let i = 0; i < count; i++) {
      const username = rand(8)
      const password = rand(6)
      await query(
        'INSERT INTO hotspot_cards (batch_id, username, password, plan_id, status) VALUES ($1,$2,$3,$4,$5)',
        [batchId, username, password, plan_id, 'unused'],
      )
      // sync each card into FreeRADIUS so it can authenticate on the hotspot NAS
      await query(`INSERT INTO radcheck (username, attribute, op, value) VALUES ($1,'Cleartext-Password',':=',$2)`, [username, password])
      if (p.download_mbps || p.upload_mbps) {
        await query(`INSERT INTO radreply (username, attribute, op, value) VALUES ($1,'Mikrotik-Rate-Limit',':=',$2)`, [username, rl])
      }
    }

    await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'hotspot.batch', targetType: 'batch', targetId: code, details: String(count), ip: req.ip })
    return reply.code(201).send({ id: batchId, code, count })
  })
}
