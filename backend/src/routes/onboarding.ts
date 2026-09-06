import type { FastifyPluginAsync } from 'fastify'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { roleOf } from '../lib/permissions'
import { managerScope } from '../lib/scope'
import { decryptSecret } from '../lib/secretbox'
import { testRouter } from '../lib/routerApi'
import { getLive } from '../lib/routerPoller'

/**
 * First-run checklist for a newly approved company.
 *
 * Every step's state is derived from the account's OWN data rather than a stored "step 3 done"
 * marker: a marker drifts the moment the operator deletes the plan they just made, whereas this
 * always reflects reality and re-opens a step if the thing it checked for disappears.
 *
 * Only the dismissal is persisted (managers.onboarding_dismissed_at).
 */
const execFileAsync = promisify(execFile)

/**
 * Has this tenant's router ever completed a WireGuard handshake?
 *
 * `wg show <iface> latest-handshakes` prints 0 until the peer connects for the first time, which is
 * precisely the boundary between "we built you a tunnel" and "your router is on it". Reading the
 * live interface beats any database flag: nothing has to remember to write it.
 */
async function tunnelLinked(iface: string | null): Promise<boolean> {
  if (!iface || !/^wg[0-9]+$/.test(iface)) return false     // never build an argv from loose input
  try {
    const { stdout } = await execFileAsync('wg', ['show', iface, 'latest-handshakes'], { timeout: 3000 })
    return stdout.trim().split('\n').some((l) => Number(l.trim().split(/\s+/)[1] || 0) > 0)
  } catch {
    return false
  }
}

export const onboardingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req) => {
    const role = roleOf(req)
    // The owner runs the platform, not an ISP — there is nothing to set up.
    if (role !== 'admin') return { applicable: false, steps: [], done: true, dismissed: true }

    const scope = await managerScope(req.user.sub, role)
    const ids = scope.ids
    const one = async (sql: string, params: unknown[]): Promise<number> =>
      Number((await query<{ c: number }>(sql, params)).rows[0]?.c ?? 0)

    const [plans, nas, nasApi, subs, acct24h, dismissedRow] = await Promise.all([
      one(`SELECT count(*)::int AS c FROM plans WHERE manager_id = ANY($1::uuid[])`, [ids]),
      one(`SELECT count(*)::int AS c FROM nas WHERE manager_id = ANY($1::uuid[])`, [ids]),
      one(`SELECT count(*)::int AS c FROM nas WHERE manager_id = ANY($1::uuid[]) AND api_enabled = true AND api_user IS NOT NULL`, [ids]),
      one(`SELECT count(*)::int AS c FROM subscribers WHERE manager_id = ANY($1::uuid[])`, [ids]),
      // Accounting packets arriving IS the proof that the firewall path is open — no need to ask.
      one(`SELECT count(*)::int AS c FROM radacct a JOIN subscribers s ON s.username = a.username
            WHERE s.manager_id = ANY($1::uuid[]) AND a.acctupdatetime > now() - interval '24 hours'`, [ids]),
      query<{ onboarding_dismissed_at: string | null }>(
        'SELECT onboarding_dismissed_at FROM managers WHERE id = $1', [req.user.sub]),
    ])

    // The router's own row is handed back so the guide can print THIS tenant's real IP and secret
    // instead of a placeholder the operator has to go hunting for.
    const nasRow = await query<{ id: string; nasname: string; secret: string; shortname: string | null; has_tunnel: boolean; iface: string | null }>(
      // Tunnel-backed routers first, not merely the oldest: a router registered on an unreachable
      // LAN address would otherwise become the one the guide teaches and offers a script for.
      `SELECT n.id, n.nasname, n.secret, n.shortname, w.iface, (w.id IS NOT NULL) AS has_tunnel
         FROM nas n LEFT JOIN wireguard_peers w ON w.nas_id = n.id
        WHERE n.manager_id = ANY($1::uuid[])
        ORDER BY (w.id IS NULL), n.created_at LIMIT 1`,
      [ids],
    )

    // The router row now exists from the moment the account is approved — provisioning creates it —
    // so "does a NAS exist" would tick this step before anyone has touched a router. The honest
    // signal is the tunnel actually handshaking, which is also exactly what the operator is being
    // asked to accomplish: upload the file so the router comes up.
    const linked = nasRow.rowCount ? await tunnelLinked(nasRow.rows[0]!.iface) : false

    const steps = [
      { key: 'plan', done: plans > 0, count: plans },
      { key: 'nas', done: linked, count: nas },
      // No separate firewall step any more: the setup file writes those rules itself, so asking for
      // them again was a chore with nothing behind it. Whether packets actually arrive is still
      // reported honestly by the network self-test below, which reads accounting.
      // Requires the tunnel too: the read-only account exists the moment the setup file is
      // downloaded, but the panel cannot actually read the router until it is on the tunnel — so
      // ticking on the account alone reports a capability that does not work yet.
      { key: 'api', done: nasApi > 0 && linked, count: nasApi, optional: true },
      { key: 'subscribers', done: subs > 0, count: subs },
    ]
    const required = steps.filter((s) => !s.optional)

    return {
      applicable: true,
      steps,
      done: required.every((s) => s.done),
      dismissed: !!dismissedRow.rows[0]?.onboarding_dismissed_at,
      nas: nasRow.rows[0] ?? null,
    }
  })

  /**
   * End-to-end health check for this tenant's own link, run on demand from the last step.
   * Each check is independent and reports WHY it failed, so a new ISP can tell a firewall problem
   * from a credentials problem instead of just seeing "not working".
   */
  app.post('/test', { preHandler: authenticate }, async (req, reply) => {
    if (roleOf(req) !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const scope = await managerScope(req.user.sub, roleOf(req))
    const ids = scope.ids
    const checks: { key: string; ok: boolean; detail: string }[] = []

    const nasRes = await query<{ nasname: string; api_enabled: boolean; api_port: number | null; api_user: string | null; api_password: string | null }>(
      `SELECT nasname, api_enabled, api_port, api_user, api_password FROM nas
        WHERE manager_id = ANY($1::uuid[]) ORDER BY created_at LIMIT 1`, [ids],
    )
    const nas = nasRes.rows[0]
    checks.push({ key: 'nas', ok: !!nas, detail: nas ? `الراوتر مسجّل (${nas.nasname})` : 'لم تُسجّل راوتراً بعد' })

    // 2) RADIUS authentication actually happening
    const auth = await query<{ c: number; last: string | null }>(
      `SELECT count(*)::int AS c, max(a.authdate)::text AS last FROM radpostauth a
        JOIN subscribers s ON s.username = a.username
       WHERE s.manager_id = ANY($1::uuid[]) AND a.authdate > now() - interval '24 hours'`, [ids],
    )
    const authC = auth.rows[0]?.c ?? 0
    checks.push({ key: 'auth', ok: authC > 0,
      detail: authC > 0 ? `${authC} عملية مصادقة خلال 24 ساعة` : 'لا مصادقة واردة — تحقّق من إعداد RADIUS والفايروول (UDP 1812)' })

    // 3) Accounting — separate from auth on purpose: 1813 is very often the port left blocked
    const acct = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM radacct a JOIN subscribers s ON s.username = a.username
        WHERE s.manager_id = ANY($1::uuid[]) AND a.acctupdatetime > now() - interval '24 hours'`, [ids],
    )
    const acctC = acct.rows[0]?.c ?? 0
    checks.push({ key: 'acct', ok: acctC > 0,
      detail: acctC > 0 ? `${acctC} جلسة تُرسل محاسبة` : 'لا محاسبة واردة — غالباً UDP 1813 محجوب أو accounting=no' })

    // 4) Router API (only when the tenant opted into live speeds)
    if (nas?.api_enabled && nas.api_user) {
      const pw = decryptSecret(nas.api_password)
      const r = pw
        ? await testRouter({ host: nas.nasname, port: nas.api_port ?? 80, user: nas.api_user, password: pw })
        : { ok: false as const, error: 'كلمة المرور المحفوظة غير صالحة' }
      checks.push({ key: 'api', ok: r.ok, detail: r.ok ? `متصل بـ ${r.identity} — ${r.sessions} جلسة` : r.error })
    } else {
      checks.push({ key: 'api', ok: false, detail: 'السرعات اللحظية غير مفعّلة (اختياري)' })
    }

    // 5) Live throughput actually reaching the panel
    const liveRows = await query<{ username: string }>(
      `SELECT a.username FROM radacct a JOIN subscribers s ON s.username = a.username
        WHERE a.acctstoptime IS NULL AND s.manager_id = ANY($1::uuid[]) LIMIT 25`, [ids],
    )
    const withLive = liveRows.rows.filter((r) => getLive(r.username)).length
    checks.push({ key: 'live', ok: withLive > 0,
      detail: withLive > 0 ? `${withLive} جلسة تُرسل سرعة لحظية` : 'لا سرعات لحظية — فعّل واجهة الراوتر أولاً' })

    const required = checks.filter((c) => c.key !== 'api' && c.key !== 'live')
    return { ok: required.every((c) => c.ok), checks }
  })

  app.post('/dismiss', { preHandler: authenticate }, async (req) => {
    await query('UPDATE managers SET onboarding_dismissed_at = now() WHERE id = $1', [req.user.sub])
    return { ok: true }
  })

  app.post('/reopen', { preHandler: authenticate }, async (req) => {
    await query('UPDATE managers SET onboarding_dismissed_at = NULL WHERE id = $1', [req.user.sub])
    return { ok: true }
  })
}
