import { query } from '../db/pool'

export type NotifyKind = 'expiring' | 'expired' | 'daily_quota' | 'monthly_quota' | 'nas_down' | 'charged' | 'upgrade' | 'signup'

/**
 * Send a notification to the configured Telegram admin chat IDs.
 * No-op (never throws) when the bot isn't configured or the kind is disabled,
 * so business logic can call it unconditionally.
 */
export async function notifyAdmins(kind: NotifyKind, text: string): Promise<void> {
  try {
    const r = await query<{ value: Record<string, any> }>(`SELECT value FROM settings WHERE key='telegram'`)
    const tg = r.rows[0]?.value
    if (!tg?.bot_token || !tg?.admin_chat_ids) return
    if (tg.notify && tg.notify[kind] === false) return
    const ids = String(tg.admin_chat_ids).split(/[\s,]+/).filter(Boolean)
    for (const id of ids) {
      try {
        await fetch(`https://api.telegram.org/bot${tg.bot_token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: id, text }),
        })
      } catch {
        /* best-effort per chat */
      }
    }
  } catch {
    /* never break the caller */
  }
}
