import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { managerScope } from '../lib/scope'
import { roleOf } from '../lib/permissions'

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().optional(),
  q: z.string().optional(),
})

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' })
    const { page, limit, action, q } = parsed.data

    const conds: string[] = []
    const params: unknown[] = []
    if (action) { params.push(`%${action}%`); conds.push(`action ILIKE $${params.length}`) }
    if (q) {
      params.push(`%${q}%`)
      conds.push(`(performed_by_name ILIKE $${params.length} OR target_id ILIKE $${params.length} OR details ILIKE $${params.length})`)
    }
    // The log records every action on the platform, including other companies' subscriber names
    // and the staff who touched them. A tenant may only see what its OWN tree did — plus the
    // scheduler's automatic actions on its own subscribers, which are the entries it most needs.
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scope.all) {
      params.push(scope.ids)
      const i = params.length
      conds.push(`(performed_by = ANY($${i}::uuid[])
        OR (performed_by IS NULL AND target_type = 'subscriber'
            AND target_id IN (SELECT username FROM subscribers WHERE manager_id = ANY($${i}::uuid[]))))`)
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const total = Number((await query<{ c: number }>(`SELECT count(*)::int c FROM audit_log ${where}`, params)).rows[0]?.c ?? 0)
    params.push(limit, (page - 1) * limit)
    const rows = await query(
      `SELECT id, performed_by_name, action, target_type, target_id, details, host(ip) AS ip, created_at
         FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    return { data: rows.rows, page, limit, total }
  })
}
