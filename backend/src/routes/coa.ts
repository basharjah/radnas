import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { audit } from '../lib/audit'
import { sendDisconnect, buildAttrList } from '../lib/coa'
import { liveSessionId } from '../lib/radiusOps'
import { managerScope, scopeAllows } from '../lib/scope'

const schema = z.object({
  username: z.string().optional(),
  subscriber_id: z.string().uuid().optional(),
  nas_id: z.string().uuid().optional(),
  dry_run: z.boolean().optional().default(false),
  retries: z.coerce.number().int().min(1).max(5).optional(),
  timeout_ms: z.coerce.number().int().min(100).max(10000).optional(),
})

interface NasRow { id: string; nasname: string; shortname: string | null; secret: string }

export const coaRoutes: FastifyPluginAsync = async (app) => {
  app.post('/disconnect', { preHandler: authenticate }, async (req, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const b = parsed.data

    let username = b.username
    if (!username && b.subscriber_id) {
      const s = await query<{ username: string }>('SELECT username FROM subscribers WHERE id = $1', [b.subscriber_id])
      username = s.rows[0]?.username
    }
    if (!username) return reply.code(400).send({ error: 'username_required' })

    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    if (!scope.all) {
      const own = await query<{ manager_id: string }>('SELECT manager_id FROM subscribers WHERE username = $1', [username])
      if (!own.rowCount || !scopeAllows(scope, own.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })
    }

    // The router that actually holds this subscriber's session — resolved from the subscriber, not
    // guessed.
    //
    // This used to fall back to `ORDER BY created_at LIMIT 1`: the OLDEST NAS in the whole table,
    // belonging to whichever company was onboarded first. So every disconnect issued without an
    // explicit nas_id was addressed to a stranger's router, which quite correctly answered
    // Disconnect-NAK because the session was not its own. The panel reported the attempt and the
    // customer stayed online.
    //
    // It was also a tenancy leak: one company's disconnect command, carrying one of its
    // subscribers' usernames, was being delivered to another company's router.
    const nasRes = b.nas_id
      ? await query<NasRow>('SELECT id, nasname, shortname, secret FROM nas WHERE id = $1', [b.nas_id])
      : await query<NasRow>(
          `SELECT n.id, n.nasname, n.shortname, n.secret
             FROM nas n
             JOIN subscribers s ON s.manager_id = n.manager_id
            WHERE s.username = $1
            ORDER BY n.created_at
            LIMIT 1`,
          [username],
        )
    const nas = nasRes.rows[0]
    // No router of their own is a real answer, not a reason to borrow someone else's.
    if (!nas) return reply.code(400).send({ error: 'no_nas', message: 'لا راوتر مرتبط بشركة هذا المشترك' })

    // prefer the WireGuard tunnel IP of the peer linked to this NAS (real-world path)
    const peer = await query<{ tunnel_ip: string }>(
      'SELECT host(tunnel_ip) AS tunnel_ip FROM wireguard_peers WHERE nas_id = $1 AND tunnel_ip IS NOT NULL LIMIT 1',
      [nas.id],
    )
    const host = peer.rows[0]?.tunnel_ip || nas.nasname
    const nasIp = /^\d+\.\d+\.\d+\.\d+$/.test(nas.nasname) ? nas.nasname : undefined

    if (b.dry_run) {
      const attrs = buildAttrList({ username, nasIp })
      return {
        dry_run: true,
        target: `${host}:3799`,
        username,
        nas: nas.shortname || nas.nasname,
        via_tunnel: Boolean(peer.rows[0]),
        attributes: attrs.map((a) => ({ type: a.type, bytes: a.value.length })),
      }
    }

    // Same identifier the router needs; without it this endpoint answered "sent" and changed
    // nothing, which is how a disconnected subscriber stayed online for four days.
    const acctSessionId = await liveSessionId(username)
    const result = await sendDisconnect({
      host, secret: nas.secret, username, nasIp, acctSessionId,
      retries: b.retries, timeoutMs: b.timeout_ms,
    })
    await audit({
      performedBy: req.user.sub, performedByName: req.user.username, action: 'coa.disconnect',
      targetType: 'subscriber', targetId: username, details: result.ok ? 'ACK' : (result.error ?? result.response ?? ''), ip: req.ip,
    })
    return result
  })
}
