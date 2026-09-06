import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { publicKey, pushReady, pushToManagers } from '../lib/push'

/**
 * Device registration for browser push.
 *
 * A subscription is issued by the browser's own push service, so the server never invents one — it
 * only stores what the device hands over and binds it to the logged-in account.
 */

const subSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
})

export const pushRoutes: FastifyPluginAsync = async (app) => {
  /** The VAPID public key the browser needs to subscribe. Public by nature — it identifies us. */
  app.get('/public-key', async () => ({ key: publicKey(), enabled: pushReady() }))

  app.post('/subscribe', { preHandler: authenticate }, async (req, reply) => {
    if (!pushReady()) return reply.code(503).send({ error: 'push_disabled' })
    const parsed = subSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_subscription' })
    const { endpoint, keys } = parsed.data

    // The endpoint is the device's address and is unique. A browser that re-subscribes — after a
    // permission reset, or a key rotation — returns the same endpoint and must UPDATE its row;
    // inserting again would leave a stale duplicate that we would keep pushing to forever.
    // Re-binding manager_id also matters on a shared computer: the notification must follow whoever
    // is actually logged in now.
    await query(
      `INSERT INTO push_subscriptions (manager_id, endpoint, p256dh, auth, user_agent, last_ok_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (endpoint) DO UPDATE
          SET manager_id = EXCLUDED.manager_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
              user_agent = EXCLUDED.user_agent, fail_count = 0`,
      [req.user.sub, endpoint, keys.p256dh, keys.auth, String(req.headers['user-agent'] || '').slice(0, 300)],
    )
    return { ok: true }
  })

  app.post('/unsubscribe', { preHandler: authenticate }, async (req) => {
    const endpoint = (req.body as { endpoint?: string } | undefined)?.endpoint
    // Scoped to the caller: an endpoint string must not let one account delete another's device.
    if (endpoint) {
      await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND manager_id = $2',
        [endpoint, req.user.sub])
    } else {
      await query('DELETE FROM push_subscriptions WHERE manager_id = $1', [req.user.sub])
    }
    return { ok: true }
  })

  /** Devices registered for this account — so the panel can say "on" without guessing. */
  app.get('/status', { preHandler: authenticate }, async (req) => {
    const r = await query<{ c: number }>(
      'SELECT count(*)::int AS c FROM push_subscriptions WHERE manager_id = $1', [req.user.sub])
    return { enabled: pushReady(), devices: r.rows[0]?.c ?? 0 }
  })

  /** Send one to the caller's own devices, so a user can prove it works before relying on it. */
  app.post('/test', { preHandler: authenticate }, async (req, reply) => {
    if (!pushReady()) return reply.code(503).send({ error: 'push_disabled' })
    const sent = await pushToManagers([req.user.sub], {
      title: 'RadNas',
      body: 'الإشعارات تعمل ✅',
      url: '/',
      tag: 'test',
    })
    if (!sent) {
      return reply.code(409).send({
        error: 'no_devices',
        message: 'لا يوجد جهاز مُفعَّل لهذا الحساب. فعّل الإشعارات من هذا المتصفّح أولاً.',
      })
    }
    return { ok: true, sent }
  })
}
