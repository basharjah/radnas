import { query } from '../db/pool'
import { decryptSecret } from './secretbox'

/**
 * Per-tenant Telegram delivery.
 *
 * Each account keeps its own `managers.telegram` — where it wants alerts, and optionally its own
 * bot. Without a bot of its own the message goes through the platform bot, which is the path almost
 * every tenant will take: they supply a chat id and nothing else. A company that wants alerts
 * arriving under its own name supplies a token instead, and nothing else changes.
 *
 * Best-effort throughout. A notification that fails must never break the action that produced it.
 */

export interface TelegramTarget {
  chat_ids?: string
  bot_token?: string          // encrypted at rest; absent means "use the platform bot"
}

/** The shared bot every tenant falls back to. Kept in settings, editable by the owner alone. */
async function platformToken(): Promise<string | null> {
  const r = await query<{ value: Record<string, unknown> }>(
    `SELECT value FROM settings WHERE key = 'telegram'`)
  const raw = r.rows[0]?.value?.bot_token
  return typeof raw === 'string' && raw ? (decryptSecret(raw) || raw) : null
}

/**
 * The token an account actually sends with, and whether it is its own.
 * Exported because /discover and /test have to use exactly the same resolution the real sends do —
 * testing with a different token than production would prove nothing.
 */
export async function effectiveToken(managerId: string): Promise<{ token: string | null; own: boolean }> {
  const r = await query<{ telegram: TelegramTarget }>(
    'SELECT telegram FROM managers WHERE id = $1', [managerId])
  const own = r.rows[0]?.telegram?.bot_token
  if (own) {
    const clear = decryptSecret(own) || own
    if (clear) return { token: clear, own: true }
  }
  return { token: await platformToken(), own: false }
}

async function post(token: string, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  })
}

/**
 * Deliver to these accounts' own Telegram chats.
 *
 * Recipients are resolved upstream by lib/notify, which already knows which tenant an event belongs
 * to — this only has to reach the chats each of them configured.
 */
export async function telegramToManagers(managerIds: string[], text: string): Promise<number> {
  if (!managerIds.length) return 0
  const rows = await query<{ id: string; telegram: TelegramTarget }>(
    'SELECT id, telegram FROM managers WHERE id = ANY($1::uuid[])', [managerIds])

  // Resolved once, not per recipient: most tenants share it and it is a database read each time.
  let shared: string | null | undefined
  let sent = 0

  for (const m of rows.rows) {
    const chats = String(m.telegram?.chat_ids || '').split(/[\s,]+/).filter(Boolean)
    if (!chats.length) continue

    let token: string | null = null
    if (m.telegram?.bot_token) token = decryptSecret(m.telegram.bot_token) || m.telegram.bot_token
    if (!token) {
      if (shared === undefined) shared = await platformToken()
      token = shared
    }
    if (!token) continue

    for (const c of chats) {
      try { await post(token, c, text); sent++ } catch { /* one dead chat must not stop the rest */ }
    }
  }
  return sent
}
