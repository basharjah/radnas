import type { FastifyPluginAsync } from 'fastify'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { deny } from '../lib/permissions'

const DEFAULTS = { timezone: 'Asia/Damascus', mac_auto_lock: false, fixed_expiry_time: '15:00', expired_pool_redirect: false }

async function getGeneral(): Promise<Record<string, unknown>> {
  const r = await query<{ value: Record<string, unknown> }>(`SELECT value FROM settings WHERE key='general'`)
  return { ...DEFAULTS, ...(r.rows[0]?.value ?? {}) }
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  // Platform-wide behaviour: timezone, fixed expiry hour, MAC auto-lock, expired-pool routing.
  // These affect EVERY tenant, so only the owner may read or change them.
  app.get('/', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    return getGeneral()
  })

  // Landing-page pricing for the SaaS tiers. Owner only — these numbers are shown publicly.
  app.get('/tiers', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    const r = await query<{ value: Record<string, unknown> }>(`SELECT value FROM settings WHERE key='signup_tiers'`)
    return r.rows[0]?.value ?? { prices: {}, currency: 'USD', note: '' }
  })

  app.put('/tiers', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    const b = (req.body ?? {}) as { prices?: Record<string, unknown>; currency?: string; note?: string }
    // Keep only clean numbers; anything blank stays unset so the page says "تواصل معنا".
    const prices: Record<string, number> = {}
    for (const [k, v] of Object.entries(b.prices ?? {})) {
      const n = Number(v)
      if (v !== '' && v != null && Number.isFinite(n) && n >= 0) prices[k] = Math.round(n * 100) / 100
    }
    const value = { prices, currency: String(b.currency || 'USD').slice(0, 8), note: String(b.note || '').slice(0, 300) }
    await query(
      `INSERT INTO settings(key,value) VALUES('signup_tiers',$1) ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=now()`,
      [JSON.stringify(value)],
    )
    return value
  })

  app.put('/', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    const merged = { ...(await getGeneral()), ...((req.body ?? {}) as Record<string, unknown>) }
    await query(
      `INSERT INTO settings(key,value) VALUES('general',$1) ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=now()`,
      [JSON.stringify(merged)],
    )
    return merged
  })
}
