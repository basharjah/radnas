import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { managerScope } from '../lib/scope'

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  type: z.enum(['charge', 'commission', 'topup', 'withdraw', 'transfer']).optional(),
  direction: z.enum(['in', 'out']).optional(),
  manager_id: z.string().uuid().optional(),
})

export const transactionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' })
    const { page, limit, type, direction, manager_id } = parsed.data

    const conds: string[] = []
    const params: unknown[] = []
    if (type) { params.push(type); conds.push(`t.type = $${params.length}`) }
    if (direction) { params.push(direction); conds.push(`t.direction = $${params.length}`) }
    if (manager_id) { params.push(manager_id); conds.push(`t.manager_id = $${params.length}`) }
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scope.all) { params.push(scope.ids); conds.push(`t.manager_id = ANY($${params.length}::uuid[])`) }
    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const totals = await query<{ total: string; points: number; c: number }>(
      `SELECT COALESCE(sum(t.amount), 0) AS total, COALESCE(sum(t.points), 0)::int AS points, count(*)::int AS c
         FROM transactions t ${whereSql}`,
      params,
    )

    params.push(limit, (page - 1) * limit)
    const rows = await query(
      `SELECT t.id, t.type, t.direction, t.amount, t.points, t.status, t.note, t.created_at,
              m.username AS manager_name, cp.username AS counterparty_name
         FROM transactions t
         LEFT JOIN managers m ON m.id = t.manager_id
         LEFT JOIN managers cp ON cp.id = t.counterparty_id
         ${whereSql}
        ORDER BY t.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )

    const t = totals.rows[0]!
    return { data: rows.rows, page, limit, total: t.c, sum_amount: Number(t.total), sum_points: t.points }
  })
}
