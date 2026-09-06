import webpush, { type PushSubscription } from 'web-push'
import { query } from '../db/pool'

/**
 * Browser push delivery.
 *
 * Standard Web Push with VAPID, not Firebase: this product is a web app, and FCM would add a Google
 * dependency plus a sizeable client SDK to achieve exactly the same thing on every browser that
 * supports push at all.
 *
 * Delivery is best-effort by design — a push that fails must never break the action that triggered
 * it. Renewing a subscriber is the operation; telling someone about it is a courtesy.
 */

let ready = false

/** Configured once at boot. Without keys the module stays inert instead of throwing per send. */
export function initPush(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  // The subject must be a URL or mailto: the push service uses it to contact us about abuse.
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://radnas.com', pub, priv)
  ready = true
  return true
}

export const pushReady = (): boolean => ready
export const publicKey = (): string => process.env.VAPID_PUBLIC_KEY || ''

export interface PushPayload {
  title: string
  body: string
  /** Where clicking the notification should land, e.g. '/subscribers'. */
  url?: string
  /** Collapses repeats: a second notification with the same tag replaces the first. */
  tag?: string
}

interface SubRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  fail_count: number
}

/**
 * Send to every device belonging to these accounts.
 *
 * A subscription dies silently — the browser is uninstalled, the profile wiped, permission revoked —
 * and the push service answers 404/410. Those rows are deleted on the spot, because a table full of
 * dead endpoints turns every notification into a burst of doomed HTTP requests. Other failures are
 * counted instead of deleted: a transient 500 from the push service is not the device's fault, and
 * five strikes is a fairer verdict than one.
 */
export async function pushToManagers(managerIds: string[], payload: PushPayload): Promise<number> {
  if (!ready || !managerIds.length) return 0

  const subs = await query<SubRow>(
    `SELECT id, endpoint, p256dh, auth, fail_count
       FROM push_subscriptions WHERE manager_id = ANY($1::uuid[])`,
    [managerIds],
  )
  if (!subs.rowCount) return 0

  const body = JSON.stringify(payload)
  let sent = 0
  const dead: string[] = []
  const failed: string[] = []

  await Promise.all(subs.rows.map(async (s) => {
    const sub: PushSubscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }
    try {
      await webpush.sendNotification(sub, body, { TTL: 3600 })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) dead.push(s.id)
      else failed.push(s.id)
    }
  }))

  if (dead.length) {
    await query('DELETE FROM push_subscriptions WHERE id = ANY($1::uuid[])', [dead]).catch(() => {})
  }
  if (failed.length) {
    await query(
      `UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ANY($1::uuid[])`,
      [failed],
    ).catch(() => {})
    await query('DELETE FROM push_subscriptions WHERE fail_count >= 5').catch(() => {})
  }
  if (sent) {
    const ok = subs.rows.filter((s) => !dead.includes(s.id) && !failed.includes(s.id)).map((s) => s.id)
    await query(
      `UPDATE push_subscriptions SET last_ok_at = now(), fail_count = 0 WHERE id = ANY($1::uuid[])`,
      [ok],
    ).catch(() => {})
  }
  return sent
}
