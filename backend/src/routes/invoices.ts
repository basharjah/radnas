import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { managerScope, scopeAllows } from '../lib/scope'

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['paid', 'unpaid']).optional(),
  manager_id: z.string().uuid().optional(),
  q: z.string().optional().default(''),
})

export const invoiceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' })
    const { page, limit, status, manager_id, q } = parsed.data

    const conds: string[] = []
    const params: unknown[] = []
    if (status) { params.push(status); conds.push(`i.status = $${params.length}`) }
    if (manager_id) { params.push(manager_id); conds.push(`i.manager_id = $${params.length}`) }
    if (q) {
      params.push(`%${q}%`)
      conds.push(`(sub.username ILIKE $${params.length} OR sub.full_name ILIKE $${params.length} OR i.number ILIKE $${params.length})`)
    }
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scope.all) { params.push(scope.ids); conds.push(`i.manager_id = ANY($${params.length}::uuid[])`) }
    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const totals = await query<{ total: string; unpaid: string; c: number }>(
      `SELECT COALESCE(sum(i.amount), 0) AS total,
              COALESCE(sum(i.amount) FILTER (WHERE i.status = 'unpaid'), 0) AS unpaid,
              count(*)::int AS c
         FROM invoices i LEFT JOIN subscribers sub ON sub.id = i.subscriber_id ${whereSql}`,
      params,
    )

    params.push(limit, (page - 1) * limit)
    const rows = await query(
      `SELECT i.id, i.number, i.description, i.amount, i.currency, i.status, i.issued_at, i.paid_at,
              sub.username AS subscriber_username, sub.full_name AS subscriber_name,
              m.username AS manager_name
         FROM invoices i
         LEFT JOIN subscribers sub ON sub.id = i.subscriber_id
         LEFT JOIN managers m ON m.id = i.manager_id
         ${whereSql}
        ORDER BY i.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )

    const t = totals.rows[0]!
    return { data: rows.rows, page, limit, total: t.c, sum_total: Number(t.total), sum_unpaid: Number(t.unpaid) }
  })

  app.post('/:id/pay', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scope.all) {
      const chk = await query<{ manager_id: string }>('SELECT manager_id FROM invoices WHERE id = $1', [id])
      if (!chk.rowCount || !scopeAllows(scope, chk.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })
    }
    const res = await query(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING id`, [id])
    if (res.rowCount === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })

  app.post('/:id/unpay', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scope.all) {
      const chk = await query<{ manager_id: string }>('SELECT manager_id FROM invoices WHERE id = $1', [id])
      if (!chk.rowCount || !scopeAllows(scope, chk.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })
    }
    const res = await query(`UPDATE invoices SET status = 'unpaid', paid_at = NULL WHERE id = $1 RETURNING id`, [id])
    if (res.rowCount === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })
}
