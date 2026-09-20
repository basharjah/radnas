import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticateSubscriber } from '../plugins/auth'

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) })

/** Same rule as the panel: a phone's session is long and renewed on launch, a browser's is not. */
const sessionFor = (device: unknown): string => (device === 'mobile' ? '30d' : '7d')

interface SubAuth { id: string; username: string; password: string; status: string; full_name: string | null }

export const portalRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { username, password } = parsed.data
    const r = await query<SubAuth>('SELECT id, username, password, status, full_name FROM subscribers WHERE username = $1', [username])
    const s = r.rows[0]
    if (!s || s.password !== password) return reply.code(401).send({ error: 'invalid_credentials' })
    const token = app.jwt.sign(
      { sub: s.id, username: s.username, kind: 'subscriber' },
      { expiresIn: sessionFor((req.body as { device?: unknown } | undefined)?.device) },
    )
    return { token, user: { username: s.username, full_name: s.full_name } }
  })

  /// Renew a live session, so the app stays signed in as long as it is being used.
  ///
  /// A subscriber who has since been deleted gets nothing back; one who has merely expired keeps
  /// their session, because seeing *why* the line is off is exactly what they open the app for.
  app.post('/refresh', { preHandler: authenticateSubscriber }, async (req, reply) => {
    const r = await query<SubAuth>(
      'SELECT id, username, password, status, full_name FROM subscribers WHERE id = $1',
      [req.user.sub],
    )
    const s = r.rows[0]
    if (!s) return reply.code(401).send({ error: 'not_found' })
    const token = app.jwt.sign(
      { sub: s.id, username: s.username, kind: 'subscriber' },
      { expiresIn: sessionFor((req.body as { device?: unknown } | undefined)?.device) },
    )
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
