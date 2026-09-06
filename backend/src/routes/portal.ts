import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticateSubscriber } from '../plugins/auth'

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) })

interface SubAuth { id: string; username: string; password: string; status: string; full_name: string | null }

export const portalRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { username, password } = parsed.data
    const r = await query<SubAuth>('SELECT id, username, password, status, full_name FROM subscribers WHERE username = $1', [username])
    const s = r.rows[0]
    if (!s || s.password !== password) return reply.code(401).send({ error: 'invalid_credentials' })
    const token = app.jwt.sign({ sub: s.id, username: s.username, kind: 'subscriber' }, { expiresIn: '7d' })
    return { token, user: { username: s.username, full_name: s.full_name } }
  })

  app.get('/me', { preHandler: authenticateSubscriber }, async (req) => {
    const r = await query(
      `SELECT s.username, s.full_name, s.phone, s.status, s.expiry_at, s.static_ip, s.is_paid,
              s.daily_used_mb, s.monthly_used_mb, COALESCE(s.bonus_quota_mb, 0) AS bonus_quota_mb, s.connection_type,
              p.name AS plan_name, p.download_mbps, p.upload_mbps, p.duration_unit,
              p.daily_quota_mb, p.monthly_quota_mb,
              EXISTS (SELECT 1 FROM radacct r WHERE r.username = s.username AND r.acctstoptime IS NULL) AS online
         FROM subscribers s LEFT JOIN plans p ON p.id = s.plan_id
        WHERE s.id = $1`,
      [req.user.sub],
    )
    return { account: r.rows[0] ?? null }
  })
}
