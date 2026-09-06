import type { FastifyPluginAsync } from 'fastify'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { deny, roleOf } from '../lib/permissions'
import { encryptSecret } from '../lib/secretbox'
import { effectiveToken, telegramToManagers } from '../lib/telegramSend'

/**
 * Telegram settings, per account.
 *
 * Every role configures its OWN destination here, mirroring how push already works: an event about
 * a company's subscribers reaches that company. Only the platform bot's token stays owner-only —
 * it is the fallback every tenant sends through, so one careless edit would silence all of them.
 *
 * Tokens are stored encrypted. A bot token is a full credential: whoever holds it can send as that
 * bot and read everything sent to it.
 */

interface TgRow { chat_ids?: string; bot_token?: string }

async function ownRow(managerId: string): Promise<TgRow> {
  const r = await query<{ telegram: TgRow }>('SELECT telegram FROM managers WHERE id = $1', [managerId])
  return r.rows[0]?.telegram ?? {}
}

export const telegramRoutes: FastifyPluginAsync = async (app) => {
  /** This account's own settings. The token is never returned — only whether one is set. */
  app.get('/', { preHandler: authenticate }, async (req) => {
    const mine = await ownRow(req.user.sub)
    const out: Record<string, unknown> = {
      chat_ids: mine.chat_ids ?? '',
      has_own_bot: !!mine.bot_token,
      is_owner: roleOf(req) === 'owner',
    }
    if (roleOf(req) === 'owner') {
      const s = await query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE key = 'telegram'`)
      out.platform_bot_set = !!s.rows[0]?.value?.bot_token
    }
    return out
  })

  /**
   * Save this account's chat ids, and optionally its own bot token.
   * An empty token string clears it, which returns the account to the platform bot.
   */
  app.put('/', { preHandler: authenticate }, async (req, reply) => {
    const b = (req.body ?? {}) as { chat_ids?: string; bot_token?: string | null }
    const mine = await ownRow(req.user.sub)
    const next: TgRow = { ...mine }

    if (b.chat_ids !== undefined) {
      // Normalise on the way in so the stored value is always a clean comma list.
      next.chat_ids = String(b.chat_ids).split(/[\s,]+/).filter(Boolean).join(',')
    }
    if (b.bot_token !== undefined) {
      const t = String(b.bot_token || '').trim()
      if (!t) delete next.bot_token
      else if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(t)) {
        return reply.code(400).send({ error: 'bad_token', message: 'صيغة رمز البوت غير صحيحة' })
      } else next.bot_token = encryptSecret(t)
    }
    await query('UPDATE managers SET telegram = $2, updated_at = now() WHERE id = $1',
      [req.user.sub, JSON.stringify(next)])
    return { chat_ids: next.chat_ids ?? '', has_own_bot: !!next.bot_token }
  })

  /** The shared bot every tenant without its own falls back to. Owner only, for that reason. */
  app.put('/platform-bot', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    const t = String((req.body as { bot_token?: string })?.bot_token || '').trim()
    if (t && !/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(t)) {
      return reply.code(400).send({ error: 'bad_token', message: 'صيغة رمز البوت غير صحيحة' })
    }
    const cur = await query<{ value: Record<string, unknown> }>(
      `SELECT value FROM settings WHERE key = 'telegram'`)
    const merged = { ...(cur.rows[0]?.value ?? {}) }
    if (t) merged.bot_token = encryptSecret(t)
    else delete merged.bot_token
    await query(
      `INSERT INTO settings(key, value) VALUES('telegram', $1)
       ON CONFLICT(key) DO UPDATE SET value = $1, updated_at = now()`,
      [JSON.stringify(merged)],
    )
    return { platform_bot_set: !!t }
  })

  /**
   * List chats that have written to the bot this account sends through.
   *
   * Replaces telling operators to trust a third-party "what is my id" bot — those cannot be verified
   * safely, since a name and an avatar are trivially copied.
   */
  app.post('/discover', { preHandler: authenticate }, async (req, reply) => {
    const supplied = String((req.body as { bot_token?: string })?.bot_token || '').trim()
    // An unsaved token is accepted so ids can be discovered before anything is committed.
    const token = supplied || (await effectiveToken(req.user.sub)).token
    if (!token) return reply.code(400).send({ error: 'missing_token', message: 'لا يوجد بوت مضبوط بعد' })

    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=100`)
      const j = (await r.json()) as {
        ok: boolean; description?: string
        result?: { message?: { chat?: { id: number; type: string; title?: string; first_name?: string; username?: string } } }[]
      }
      if (!j.ok) {
        return reply.code(400).send({
          error: 'telegram_error',
          message: j.description === 'Unauthorized' ? 'رمز البوت غير صحيح' : (j.description || 'رفض تلغرام الطلب'),
        })
      }
      const seen = new Map<string, { id: string; type: string; name: string }>()
      for (const u of j.result ?? []) {
        const c = u.message?.chat
        if (!c) continue
        seen.set(String(c.id), {
          id: String(c.id),
          type: c.type,
          name: c.title || [c.first_name, c.username && `@${c.username}`].filter(Boolean).join(' ') || String(c.id),
        })
      }
      return { chats: [...seen.values()] }
    } catch {
      return reply.code(502).send({ error: 'unreachable', message: 'تعذّر الوصول إلى تلغرام من الخادم' })
    }
  })

  /** Send to this account's own chats, through whichever bot it actually uses. */
  app.post('/test', { preHandler: authenticate }, async (req, reply) => {
    const mine = await ownRow(req.user.sub)
    if (!mine.chat_ids) {
      return reply.code(400).send({ error: 'no_chat', message: 'اختر معرّف محادثة أولاً' })
    }
    const { token, own } = await effectiveToken(req.user.sub)
    if (!token) {
      return reply.code(400).send({ error: 'no_bot', message: 'لا يوجد بوت مضبوط — أضف بوتك أو راجع الإدارة' })
    }
    const sent = await telegramToManagers([req.user.sub], 'RadNas: رسالة اختبار ✅')
    if (!sent) {
      return reply.code(502).send({
        error: 'not_delivered',
        message: 'لم تُقبل الرسالة. تأكّد أنك راسلت البوت أولاً — تلغرام يمنعه من مراسلة من لم يبدأ محادثته.',
      })
    }
    return { ok: true, sent, via: own ? 'own' : 'platform' }
  })
}
