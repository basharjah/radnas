import type { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { audit } from '../lib/audit'
import { notify } from '../lib/notify'

/**
 * How long a session lasts, by where it is being held.
 *
 * A browser is often a shared or public machine, so its session stays short. A phone is one
 * person's, locked, and the token sits in the platform keystore - and an operator who has to
 * retype an admin password every week on a phone keyboard will pick a weaker one. The app also
 * renews on every launch (see /refresh), so thirty days is really "thirty days without opening
 * the app at all", not a fixed expiry.
 *
 * The web never sends `device`, so nothing about the panel's session changes.
 */
const sessionFor = (device: unknown): string => (device === 'mobile' ? '30d' : '7d')

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const changePwSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
})

const registerSchema = z.object({
  company: z.string().min(1),
  full_name: z.string().min(1),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().optional(),
  username: z.string().min(3),
  password: z.string().min(6),
  max_subscribers: z.coerce.number().int().positive(),
})
export const SIGNUP_TIERS = [25, 50, 100, 200, 500, 1000] // 25 = free tier

interface ManagerRow {
  id: string
  username: string
  password_hash: string
  full_name: string | null
  role: string
  status: string
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { username, password } = parsed.data

    const res = await query<ManagerRow>(
      `SELECT id, username, password_hash, full_name, role, status FROM managers WHERE username = $1`,
      [username],
    )
    const m = res.rows[0]
    if (!m || !(await bcrypt.compare(password, m.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    // Credentials are right but the account is not usable yet — say which, so a company waiting on
    // approval is not left staring at "wrong password".
    if (m.status === 'pending') {
      return reply.code(403).send({ error: 'pending_approval', message: 'حسابك قيد المراجعة — سيُفعَّل بعد موافقة الإدارة.' })
    }
    if (m.status !== 'active') {
      return reply.code(403).send({ error: 'account_disabled', message: 'هذا الحساب معطّل. راجع الإدارة.' })
    }

    const token = app.jwt.sign(
      { sub: m.id, username: m.username, role: m.role },
      { expiresIn: sessionFor((req.body as { device?: unknown } | undefined)?.device) },
    )
    await audit({ performedBy: m.id, performedByName: m.username, action: 'auth.login', ip: req.ip })
    return { token, user: { id: m.id, username: m.username, full_name: m.full_name, role: m.role } }
  })

  // Public company signup → creates an admin (company) account under the platform owner, with the
  // chosen subscriber tier (4 = free). Auto-logs in. Rate-limited to curb abuse.
  app.post('/register', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const b = parsed.data
    if (!SIGNUP_TIERS.includes(b.max_subscribers)) return reply.code(400).send({ error: 'invalid_tier' })
    const owner = await query<{ id: string }>(`SELECT id FROM managers WHERE role = 'owner' ORDER BY created_at LIMIT 1`)
    const ownerId = owner.rows[0]?.id ?? null
    const hash = await bcrypt.hash(b.password, 10)
    try {
      // Created as 'pending': login already refuses any non-active account, so the request is
      // inert until the owner approves it. No token is issued — self-signup no longer grants access.
      const res = await query<{ id: string; username: string; full_name: string | null; role: string }>(
        `INSERT INTO managers (username, password_hash, full_name, phone, email, company, parent_id, role, max_subscribers, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'admin',$8,'pending') RETURNING id, username, full_name, role`,
        [b.username, hash, b.full_name, b.phone ?? null, b.email || null, b.company, ownerId, b.max_subscribers],
      )
      const m = res.rows[0]!
      await audit({ performedBy: m.id, performedByName: m.username, action: 'company.register', targetType: 'manager', targetId: b.company, details: `tier=${b.max_subscribers} status=pending`, ip: req.ip })
      await notify({ kind: 'signup', url: '/managers', title: 'طلب تسجيل جديد',
        body: `${b.company} (${b.username}) — شريحة ${b.max_subscribers} مشترك، بانتظار الموافقة.` })
      return reply.code(201).send({
        pending: true,
        message: 'تم استلام طلبك. سيُفعَّل حسابك بعد موافقة الإدارة.',
        user: { username: m.username, company: b.company },
      })
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'username_taken' })
      throw e
    }
  })

  // PUBLIC — the landing page reads this before anyone has an account. Prices live in settings so
  // the owner edits them from the panel; a tier with no price yet renders as "تواصل معنا" rather
  // than a number nobody approved.
  app.get('/tiers', async () => {
    const r = await query<{ value: Record<string, unknown> }>(`SELECT value FROM settings WHERE key='signup_tiers'`)
    const cfg = (r.rows[0]?.value ?? {}) as { prices?: Record<string, number | null>; currency?: string; note?: string }
    const prices = cfg.prices ?? {}
    return {
      currency: cfg.currency || 'USD',
      note: cfg.note || '',
      tiers: SIGNUP_TIERS.map((t) => ({
        subscribers: t,
        free: t === SIGNUP_TIERS[0],
        price: typeof prices[String(t)] === 'number' ? prices[String(t)] : null,
      })),
    }
  })

  /**
   * Trade a still-valid token for a fresh one, so an app in daily use never expires.
   *
   * This is what makes "signed in until I sign out" true on a phone: the app calls it on launch,
   * and the clock restarts. It is not a way back in from an expired token - `authenticate` has
   * already rejected those - and the account is re-checked here, so an operator whose company was
   * disabled since login stops renewing rather than carrying a valid token for another month.
   */
  app.post('/refresh', { preHandler: authenticate }, async (req, reply) => {
    const res = await query<ManagerRow>(
      `SELECT id, username, password_hash, full_name, role, status FROM managers WHERE id = $1`,
      [req.user.sub],
    )
    const m = res.rows[0]
    if (!m) return reply.code(401).send({ error: 'not_found' })
    if (m.status !== 'active') {
      return reply.code(403).send({ error: 'account_disabled', message: 'هذا الحساب معطّل. راجع الإدارة.' })
    }
    const token = app.jwt.sign(
      { sub: m.id, username: m.username, role: m.role },
      { expiresIn: sessionFor((req.body as { device?: unknown } | undefined)?.device) },
    )
    return { token, user: { id: m.id, username: m.username, full_name: m.full_name, role: m.role } }
  })

  app.get('/me', { preHandler: authenticate }, async (req) => {
    const res = await query(
      `SELECT id, username, full_name, phone, email, role, points, status, company, max_subscribers FROM managers WHERE id = $1`,
      [req.user.sub],
    )
    // Governing admin's subscriber quota usage (for the upgrade prompt). null = unlimited/owner.
    let quota: { max: number; count: number } | null = null
    const admin = await query<{ id: string; max_subscribers: number | null }>(
      `WITH RECURSIVE up AS (
         SELECT id, parent_id, role, max_subscribers FROM managers WHERE id = $1
         UNION ALL
         SELECT m.id, m.parent_id, m.role, m.max_subscribers FROM managers m JOIN up ON m.id = up.parent_id
       ) SELECT id, max_subscribers FROM up WHERE role = 'admin' LIMIT 1`,
      [req.user.sub],
    )
    const a = admin.rows[0]
    if (a && a.max_subscribers != null) {
      const cnt = await query<{ c: number }>(
        `SELECT count(*)::int AS c FROM subscribers WHERE manager_id IN (
           WITH RECURSIVE d AS (
             SELECT id FROM managers WHERE id = $1
             UNION ALL
             SELECT m.id FROM managers m JOIN d ON m.parent_id = d.id
           ) SELECT id FROM d)`,
        [a.id],
      )
      quota = { max: a.max_subscribers, count: cnt.rows[0]?.c ?? 0 }
    }
    return { user: res.rows[0] ?? null, quota }
  })

  // Self-service password change for the logged-in manager (verifies the current password).
  app.post(
    '/change-password',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = changePwSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
      const { current_password, new_password } = parsed.data
      const res = await query<{ password_hash: string }>(`SELECT password_hash FROM managers WHERE id = $1`, [req.user.sub])
      const m = res.rows[0]
      if (!m || !(await bcrypt.compare(current_password, m.password_hash))) {
        return reply.code(400).send({ error: 'invalid_current' })
      }
      const hash = await bcrypt.hash(new_password, 10)
      await query(`UPDATE managers SET password_hash = $1, updated_at = now() WHERE id = $2`, [hash, req.user.sub])
      await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'auth.change_password', ip: req.ip })
      return { ok: true }
    },
  )

  // Self-service profile edit for the logged-in account (owner edits owner, admin edits admin, etc.).
  const profileSchema = z.object({
    full_name: z.string().min(1).optional(),
    phone: z.string().optional(),
    email: z.string().email().or(z.literal('')).optional(),
  })
  app.post('/profile', { preHandler: authenticate }, async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const b = parsed.data
    await query(
      `UPDATE managers SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone),
              email = COALESCE($3, email), updated_at = now() WHERE id = $4`,
      [b.full_name ?? null, b.phone ?? null, b.email ?? null, req.user.sub],
    )
    await audit({ performedBy: req.user.sub, performedByName: req.user.username, action: 'auth.update_profile', ip: req.ip })
    const res = await query(`SELECT id, username, full_name, role FROM managers WHERE id = $1`, [req.user.sub])
    return { ok: true, user: res.rows[0] }
  })
}
