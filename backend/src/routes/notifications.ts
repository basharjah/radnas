import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'

/**
 * The signed-in account's own inbox.
 *
 * Deliberately NOT scoped through managerScope. Every other list in the panel answers "what may I
 * see", and the answer widens as you go up the tree. An inbox answers a different question — "what
 * was sent to me" — and notify() already decided that when it fanned the event out to each
 * recipient. Widening it here would show an admin the copies addressed to their own resellers, and
 * every unread count would be wrong.
 */
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().datetime().optional(), // cursor: created_at of the last row seen
  unread: z.coerce.boolean().optional(),
})

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' })
    const { limit, before, unread } = parsed.data

    const params: unknown[] = [req.user.sub]
    let where = 'n.manager_id = $1'
    if (unread) where += ' AND n.read_at IS NULL'
    if (before) {
      params.push(before)
      where += ` AND n.created_at < $${params.length}`
    }
    params.push(limit)

    const rows = await query(
      `SELECT n.id, n.kind, n.title, n.body, n.url, n.read_at, n.created_at,
              COALESCE(m.company, m.username) AS subject
         FROM notifications n
         LEFT JOIN managers m ON m.id = n.subject_id
        WHERE ${where}
        ORDER BY n.created_at DESC
        LIMIT $${params.length}`,
      params,
    )

    const un = await query<{ c: number }>(
      'SELECT count(*)::int AS c FROM notifications WHERE manager_id = $1 AND read_at IS NULL',
      [req.user.sub],
    )

    return { data: rows.rows, unread: un.rows[0]?.c ?? 0 }
  })

  /** Just the badge. Cheap enough to poll, and the panel's bell does exactly that. */
  app.get('/count', { preHandler: authenticate }, async (req) => {
    const r = await query<{ c: number }>(
      'SELECT count(*)::int AS c FROM notifications WHERE manager_id = $1 AND read_at IS NULL',
      [req.user.sub],
    )
    return { unread: r.rows[0]?.c ?? 0 }
  })

  app.post('/read', { preHandler: authenticate }, async (req) => {
    const body = req.body as { ids?: unknown } | undefined
    const ids = Array.isArray(body?.ids)
      ? body!.ids.filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v))
      : null

    // No ids means "mark everything read" — the button people actually press. The manager_id
    // clause is what keeps that from reaching anyone else's rows.
    if (ids && ids.length) {
      await query(
        `UPDATE notifications SET read_at = now()
          WHERE manager_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`,
        [req.user.sub, ids],
      )
    } else {
      await query(
        'UPDATE notifications SET read_at = now() WHERE manager_id = $1 AND read_at IS NULL',
        [req.user.sub],
      )
    }
    return { ok: true }
  })

  /**
   * Housekeeping: an inbox nobody prunes grows without limit, and a two-year-old "subscriber
   * renewed" helps no one. Read rows older than 30 days go; unread rows are never touched.
   */
  app.post('/prune', { preHandler: authenticate }, async (req) => {
    const r = await query(
      `DELETE FROM notifications
        WHERE manager_id = $1 AND read_at IS NOT NULL AND created_at < now() - interval '30 days'`,
      [req.user.sub],
    )
    return { ok: true, removed: r.rowCount ?? 0 }
  })
}
