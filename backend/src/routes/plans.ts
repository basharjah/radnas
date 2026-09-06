import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { deny, roleOf } from '../lib/permissions'

const timeField = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable(),
)

const planSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['pppoe', 'hotspot']).default('pppoe'),
  price: z.coerce.number().default(0),
  daily_reset_price: z.coerce.number().default(0),
  download_mbps: z.coerce.number().int().default(0),
  upload_mbps: z.coerce.number().int().default(0),
  duration_value: z.coerce.number().int().default(30),
  duration_unit: z.enum(['hours', 'days', 'months']).default('days'),
  daily_quota_mb: z.coerce.number().int().nullable().optional(),
  monthly_quota_mb: z.coerce.number().int().nullable().optional(),
  mikrotik_pool: z.string().nullable().optional(),
  expired_pool: z.string().nullable().optional(),
  fup_down_kbps: z.coerce.number().int().nullable().optional(),
  fup_up_kbps: z.coerce.number().int().nullable().optional(),
  fup_behavior: z.enum(['throttle', 'disconnect', 'block']).default('throttle'),
  free_hours_from: timeField,
  free_hours_to: timeField,
  burst_from: timeField,
  burst_to: timeField,
  allow_burst_monthly: z.boolean().optional().default(false),
  description: z.string().nullable().optional(),
})

const COLS = [
  'name', 'type', 'price', 'daily_reset_price', 'download_mbps', 'upload_mbps', 'duration_value', 'duration_unit',
  'daily_quota_mb', 'monthly_quota_mb', 'mikrotik_pool', 'expired_pool', 'fup_down_kbps', 'fup_up_kbps', 'fup_behavior',
  'free_hours_from', 'free_hours_to', 'burst_from', 'burst_to', 'allow_burst_monthly', 'description',
] as const

// Plans a non-owner may see: GLOBAL (manager_id IS NULL) + owned by any ancestor (incl. self).
const VISIBLE_TO_SELF_OR_ANCESTORS = `(p.manager_id IS NULL OR p.manager_id IN (
  WITH RECURSIVE anc AS (
    SELECT id, parent_id FROM managers WHERE id = $1
    UNION ALL
    SELECT m.id, m.parent_id FROM managers m JOIN anc ON m.id = anc.parent_id
  ) SELECT id FROM anc))`

/** admins may only touch plans they own; owner may touch any. Returns a 403/404 reply or null. */
async function guardPlanOwnership(req: any, reply: any, id: string) {
  if (roleOf(req) === 'owner') return null
  const chk = await query<{ manager_id: string | null }>('SELECT manager_id FROM plans WHERE id = $1', [id])
  if (!chk.rowCount) return reply.code(404).send({ error: 'not_found' })
  if (chk.rows[0]!.manager_id !== req.user.sub) return reply.code(403).send({ error: 'forbidden', message: 'يمكنك إدارة باقاتك فقط' })
  return null
}

export const planRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req) => {
    const role = roleOf(req)
    const where = role === 'owner' ? '' : `WHERE ${VISIBLE_TO_SELF_OR_ANCESTORS}`
    const params = role === 'owner' ? [] : [req.user.sub]
    const res = await query(
      `SELECT p.*, m.username AS owner_username,
              (SELECT count(*)::int FROM subscribers s WHERE s.plan_id = p.id) AS subscribers_count
         FROM plans p LEFT JOIN managers m ON m.id = p.manager_id ${where} ORDER BY p.created_at`,
      params,
    )
    return { data: res.rows }
  })

  app.post('/', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['admin'])) return
    const parsed = planSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const b = parsed.data as Record<string, unknown>
    const placeholders = COLS.map((_, i) => `$${i + 1}`).join(',')
    const values: unknown[] = COLS.map((c) => b[c] ?? null)
    values.push(req.user.sub) // manager_id = plan owner
    const res = await query<{ id: string }>(
      `INSERT INTO plans (${COLS.join(',')}, manager_id) VALUES (${placeholders}, $${COLS.length + 1}) RETURNING id`,
      values,
    )
    return reply.code(201).send({ id: res.rows[0]!.id })
  })

  app.put('/:id', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['admin'])) return
    const parsed = planSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const { id } = req.params as { id: string }
    if (await guardPlanOwnership(req, reply, id)) return
    const b = parsed.data as Record<string, unknown>
    const sets = COLS.map((c, i) => `${c} = $${i + 1}`).join(', ')
    const values: unknown[] = COLS.map((c) => b[c] ?? null)
    values.push(id)
    const res = await query(
      `UPDATE plans SET ${sets}, updated_at = now() WHERE id = $${COLS.length + 1} RETURNING id`,
      values,
    )
    if (res.rowCount === 0) return reply.code(404).send({ error: 'not_found' })
    return { id }
  })

  const deletePlan = async (req: FastifyRequest, reply: FastifyReply) => {
    if (deny(req, reply, ['admin'])) return
    const { id } = req.params as { id: string }
    if (await guardPlanOwnership(req, reply, id)) return
    const res = await query('DELETE FROM plans WHERE id = $1 RETURNING id', [id])
    if (res.rowCount === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  }
  app.delete('/:id', { preHandler: authenticate }, deletePlan)
  app.post('/:id/delete', { preHandler: authenticate }, deletePlan)
}
