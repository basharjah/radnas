import { query } from '../db/pool'
import { pushToManagers } from './push'
import { type NotifyKind } from './telegram'
import { telegramToManagers } from './telegramSend'

/**
 * Route an event to the people it actually concerns.
 *
 * The old path sent every event to one global Telegram chat, which meant a company never heard about
 * its own subscribers and the platform owner received four companies' alerts mixed together. The
 * transport was never the problem — nothing knew which tenant an event belonged to. That is what
 * this fixes; push is just the first channel to benefit.
 *
 * Recipients follow the existing managers.parent_id chain:
 *   - a tenant event reaches the account it concerns and its parents (a reseller's alert also
 *     reaches the admin above it), but stops short of the platform owner — burying the owner in
 *     every tenant's daily-quota alerts would train them to ignore all of it;
 *   - a platform event (a signup to approve, a quota upgrade request) reaches the owner alone,
 *     because only the owner can act on it.
 */

/** Events that are the platform's business, not a tenant's. */
const PLATFORM_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>(['signup', 'upgrade'])

export interface NotifyInput {
  kind: NotifyKind
  title: string
  body: string
  /** The account the event is about. Omit for platform events. */
  managerId?: string | null
  /** Where clicking the notification should land in the panel. */
  url?: string
}

/**
 * Everyone who should hear about this, already filtered by their own preferences.
 * `notify_prefs` is opt-OUT: a key absent means wanted, so a newly added event kind reaches people
 * instead of being silently withheld until someone discovers a setting.
 */
async function recipients(kind: NotifyKind, managerId?: string | null): Promise<string[]> {
  const platform = PLATFORM_KINDS.has(kind) || !managerId
  const res = platform
    ? await query<{ id: string }>(
        `SELECT id FROM managers
          WHERE role = 'owner' AND status = 'active'
            AND COALESCE(notify_prefs ->> $1, 'true') <> 'false'`,
        [kind],
      )
    : await query<{ id: string }>(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_id, role, status, notify_prefs FROM managers WHERE id = $2
           UNION ALL
           SELECT m.id, m.parent_id, m.role, m.status, m.notify_prefs
             FROM managers m JOIN chain c ON m.id = c.parent_id
         )
         SELECT id FROM chain
          WHERE role <> 'owner' AND status = 'active'
            AND COALESCE(notify_prefs ->> $1, 'true') <> 'false'`,
        [kind, managerId],
      )
  return res.rows.map((r) => r.id)
}

/**
 * Best-effort by design: a notification that fails must never break the action that produced it.
 * Renewing a subscriber is the operation; telling someone about it is a courtesy.
 */
export async function notify(input: NotifyInput): Promise<void> {
  let ids: string[] = []
  try {
    ids = await recipients(input.kind, input.managerId)
    if (ids.length) {
      await pushToManagers(ids, {
        title: input.title,
        body: input.body,
        url: input.url,
        // Collapse repeats of the same kind for the same account rather than stacking them.
        tag: `${input.kind}:${input.managerId ?? 'platform'}`,
      })
    }
  } catch {
    /* never break the caller */
  }
  // Telegram now follows exactly the same recipient list as push, so the two channels can no longer
  // disagree about who an event belongs to.
  try {
    if (ids.length) await telegramToManagers(ids, `RadNas: ${input.title} — ${input.body}`)
  } catch {
    /* never break the caller */
  }
}
