import type { FastifyPluginAsync } from 'fastify'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { syncSubscriberToRadius } from '../lib/radius'
import { managerScope, scopeAllows } from '../lib/scope'
import { deny } from '../lib/permissions'
import { getLive, liveAvailable, liveHealth } from '../lib/routerPoller'

// Same bucket the scheduler uses, so the live figure and the quota figure always agree.
const USAGE_TZ = process.env.USAGE_TZ || 'Asia/Damascus'



/**
 * Which WireGuard interface belongs to a tenant's router.
 *
 * With one tunnel per customer, two tenants can legitimately use the SAME customer pool
 * (10.0.0.0/24). The kernel has one route for that prefix, so an unbound `ping 10.0.0.207` always
 * leaves through whichever interface owns the route — i.e. the WRONG tenant's network. Asking the
 * kernel which device reaches the tenant's own router tunnel IP gives the interface to bind to.
 *
 * Cached briefly: a running ping tool fires several times a second and the answer rarely changes.
 */
const ifaceCache = new Map<string, { dev: string | null; at: number }>()
const IFACE_TTL_MS = 60_000

function resolveIface(nasname: string): Promise<string | null> {
  const hit = ifaceCache.get(nasname)
  if (hit && Date.now() - hit.at < IFACE_TTL_MS) return Promise.resolve(hit.dev)
  return new Promise((resolve) => {
    execFile('ip', ['route', 'get', nasname], { timeout: 2000 }, (err, stdout) => {
      // `ip route get 10.10.11.2` → "10.10.11.2 dev wg1 src 10.10.11.1 uid 0"
      const m = !err ? /\bdev\s+([A-Za-z0-9_.-]{1,15})\b/.exec(stdout) : null
      // Only ever hand a tunnel interface to execFile — never an arbitrary parsed string.
      const dev = m && /^wg[0-9]+$/.test(m[1]!) ? m[1]! : null
      ifaceCache.set(nasname, { dev, at: Date.now() })
      resolve(dev)
    })
  })
}

export const radiusRoutes: FastifyPluginAsync = async (app) => {
  // Platform-wide totals (radcheck/radreply/nas/subscribers across ALL tenants). The UI only calls
  // this for the owner, but the route has to enforce it too — an admin could hit it directly and
  // learn how big the platform and its other tenants are.
  app.get('/status', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    const one = async (sql: string): Promise<number> =>
      Number((await query<{ c: number }>(sql)).rows[0]?.c ?? 0)
    const [radcheck, radreply, nas, subscribers] = await Promise.all([
      one('SELECT count(*)::int AS c FROM radcheck'),
      one('SELECT count(*)::int AS c FROM radreply'),
      one('SELECT count(*)::int AS c FROM nas'),
      one('SELECT count(*)::int AS c FROM subscribers'),
    ])
    return { radcheck, radreply, nas, subscribers }
  })

  app.post('/sync-all', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return // cross-tenant bulk op → owner only
    const subs = await query<{ id: string }>('SELECT id FROM subscribers')
    for (const s of subs.rows) await syncSubscriberToRadius(s.id)
    return { ok: true, synced: subs.rowCount }
  })

  // Live PPPoE/Hotspot sessions = open rows in radacct (Acct-Stop not yet received), enriched with
  // per-second throughput polled straight from the router (see lib/routerPoller). RADIUS accounting
  // alone only refreshes every ~60s, so the speed figures come from the router, not from radacct.
  app.get('/online', { preHandler: authenticate }, async (req) => {
    // Each account sees only its own subtree's live sessions; the owner sees all.
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    // The owner runs the platform and reads the per-company summary — never another ISP's end
    // customers. Their rows are not sent at all, and there is deliberately no parameter to ask for
    // them: an escape hatch in the API is an escape hatch for anyone holding an owner token.
    // Hiding them in the UI instead would still ship every name, IP and MAC to the browser.
    const wantSessions = !scope.all
    const where = scope.all ? '' : 'AND s.manager_id = ANY($1::uuid[])'
    const params: unknown[] = scope.all ? [] : [scope.ids]
    const tz = `$${params.push(USAGE_TZ)}` // placeholder index for the timezone param
    const dayStart = `date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`
    // Today's traffic computed LIVE from the same period marks the scheduler uses — the
    // subscribers.daily_used_mb column only refreshes every 10 minutes, far too slow for this page.
    const dailyBytes = `
      (SELECT COALESCE(SUM(GREATEST(0, (r2.acctinputoctets + r2.acctoutputoctets) - COALESCE(m.base_bytes, 0))), 0)
         FROM radacct r2
         LEFT JOIN session_period_marks m
           ON m.acctuniqueid = r2.acctuniqueid AND m.period = 'day' AND m.period_start = ${dayStart}
        WHERE r2.username = a.username
          AND (r2.acctstarttime >= ${dayStart} OR m.acctuniqueid IS NOT NULL))`
    const res = await query<Record<string, unknown> & { username: string; acctinputoctets: string; acctoutputoctets: string }>(
      `SELECT a.radacctid, a.username, a.acctsessionid, a.callingstationid AS mac,
              host(a.framedipaddress) AS framed_ip, host(a.nasipaddress) AS nas_ip,
              a.acctstarttime, a.acctsessiontime, a.acctinputoctets, a.acctoutputoctets,
              EXTRACT(EPOCH FROM (now() - a.acctupdatetime))::int AS updated_ago_s,
              s.id AS subscriber_id, s.full_name, s.status AS sub_status, p.name AS plan_name,
              s.fup_active, s.quota_locked,
              ${dailyBytes} AS daily_bytes
         FROM radacct a
         LEFT JOIN subscribers s ON s.username = a.username
         LEFT JOIN plans p ON p.id = s.plan_id
        WHERE a.acctstoptime IS NULL ${where}
        ORDER BY a.acctstarttime DESC`,
      params,
    )

    // Which routers this caller is allowed to hear about. Owner => null (no restriction);
    // everyone else => only the NAS rows inside their own subtree.
    const nasIds = scope.all ? null : (await query<{ id: string }>(
      'SELECT id FROM nas WHERE manager_id = ANY($1::uuid[])', [scope.ids],
    )).rows.map((r) => r.id)

    let downBps = 0, upBps = 0, downBytes = 0, upBytes = 0
    const rows = res.rows.map((r) => {
      const l = getLive(r.username)
      if (l) { downBps += l.downBps; upBps += l.upBps }
      // acctoutputoctets = sent to the customer = download.
      downBytes += Number(r.acctoutputoctets || 0)
      upBytes += Number(r.acctinputoctets || 0)
      return {
        ...r,
        mac: l?.mac ?? r.mac ?? null,
        framed_ip: r.framed_ip ?? l?.ip ?? null,
        down_bps: l?.downBps ?? null,
        up_bps: l?.upBps ?? null,
        live: !!l, // false => speed unknown for this row (router not reporting it)
      }
    })

    // ---- owner-only: one line per company ------------------------------------------------
    // The owner runs the platform, so the useful view is not 51 cards but "which company is
    // carrying how much traffic right now". Built only for the owner; a tenant never sees it.
    let tenants: unknown[] | undefined
    if (scope.all) {
      const agg = await query<{
        admin_name: string; company: string | null; routers: string | null
        sessions: number; down_bytes: string; up_bytes: string; usernames: string[]
      }>(`
        WITH RECURSIVE up AS (
          SELECT s.username, s.manager_id AS cur, m.role
            FROM subscribers s JOIN managers m ON m.id = s.manager_id
          UNION ALL
          SELECT u.username, p.id, p.role
            FROM up u JOIN managers c ON c.id = u.cur JOIN managers p ON p.id = c.parent_id
           WHERE u.role <> 'admin'
        ), admin_of AS (
          SELECT DISTINCT u.username, u.cur AS admin_id FROM up u WHERE u.role = 'admin'
        )
        SELECT m.username AS admin_name, m.company,
               (SELECT string_agg(COALESCE(n.shortname, n.nasname), ' · ')
                  FROM nas n WHERE n.manager_id = a.admin_id) AS routers,
               count(*)::int                            AS sessions,
               COALESCE(SUM(r.acctoutputoctets), 0)::text AS down_bytes,
               COALESCE(SUM(r.acctinputoctets), 0)::text  AS up_bytes,
               array_agg(r.username)                     AS usernames
          FROM admin_of a
          JOIN managers m ON m.id = a.admin_id
          JOIN radacct r ON r.username = a.username AND r.acctstoptime IS NULL
         GROUP BY a.admin_id, m.username, m.company
         ORDER BY count(*) DESC`)

      tenants = agg.rows.map((t) => {
        // Live throughput is in the poller's memory, not the database — sum it per company here.
        let d = 0, u = 0
        for (const name of t.usernames) {
          const l = getLive(name)
          if (l) { d += l.downBps; u += l.upBps }
        }
        return {
          admin_name: t.admin_name, company: t.company, routers: t.routers,
          sessions: t.sessions, down_bytes: t.down_bytes, up_bytes: t.up_bytes,
          down_bps: d, up_bps: u,
        }
      })
    }

    return {
      data: wantSessions ? rows : [],
      sessions_withheld: !wantSessions, // the UI shows a "reveal" affordance from this
      total: res.rowCount,
      tenants,
      totals: { down_bps: downBps, up_bps: upBps, down_bytes: downBytes, up_bytes: upBytes },
      live: liveAvailable(nasIds), // false => no router API configured; speeds render as “—”
      routers: liveHealth(nasIds),
    }
  })

  // Admin diagnostic ping from the RadNas server (single echo per call; the frontend controls the
  // interval/repeat). Authenticated only; execFile (no shell); IPv4-validated; bounded packet size
  // + timeout. Not restricted to live sessions so the modal's editable IP field works.
  app.get('/ping', { preHandler: authenticate }, async (req, reply) => {
    const q = req.query as { ip?: string; size?: string }
    const ip = String(q.ip || '')
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some((o) => Number(o) > 255)) {
      return reply.code(400).send({ error: 'invalid_ip' })
    }
    const size = Math.min(65500, Math.max(1, Math.floor(Number(q.size) || 56))) // payload bytes

    // Send the probe out the CALLER'S OWN tunnel.
    //
    // Customer PPPoE pools overlap — two companies both hand out 10.0.0.0/24, and both tunnels
    // announce it. The kernel keeps ONE route for that prefix, so an unbound ping follows whichever
    // tunnel won the race and lands inside the wrong company's network: a wrong answer and a peek
    // into someone else's subscribers. `ping -I wgN` (SO_BINDTODEVICE) overrides the route, which is
    // the only thing that makes overlapping pools safe.
    //
    // Two rules follow. Pick a NAS that actually resolves to a tunnel — not merely the oldest one,
    // since a router registered on an unreachable LAN address resolves to the public interface and
    // silently disables the binding. And when nothing resolves, REFUSE: an unbound probe is exactly
    // the leak this exists to prevent, so failing closed is the only safe outcome.
    const scope = await managerScope(req.user.sub, (req.user as { role?: string }).role)
    const wantNas = (req.query as { nas_id?: string }).nas_id
    let iface: string | null = null

    if (wantNas) {
      const one = await query<{ nasname: string; manager_id: string | null }>(
        'SELECT nasname, manager_id FROM nas WHERE id = $1', [wantNas],
      )
      if (!one.rowCount || !scopeAllows(scope, one.rows[0]!.manager_id)) {
        return reply.code(404).send({ error: 'nas_not_found' })
      }
      iface = await resolveIface(one.rows[0]!.nasname)
      if (!iface) return reply.code(409).send({ error: 'no_tunnel', message: 'هذا الراوتر بلا نفق فعّال.' })
    } else if (!scope.all) {
      // Peer-backed routers first — those are the ones with a tunnel by construction.
      const cands = await query<{ nasname: string }>(
        `SELECT n.nasname FROM nas n
           LEFT JOIN wireguard_peers w ON w.nas_id = n.id
          WHERE n.manager_id = ANY($1::uuid[]) AND n.nasname ~ '^[0-9.]+$'
          ORDER BY (w.id IS NULL), n.created_at`, [scope.ids],
      )
      for (const c of cands.rows) {
        iface = await resolveIface(c.nasname)
        if (iface) break
      }
      if (!iface) {
        return reply.code(409).send({
          error: 'no_tunnel',
          message: 'لا يوجد نفق فعّال لشبكتك، ولن نرسل الفحص بدونه — قد يصل إلى شبكة أخرى.',
        })
      }
    }

    const args = ['-c', '1', '-s', String(size), '-W', '2']
    if (iface) args.push('-I', iface)
    args.push(ip)

    const result = await new Promise<{ reachable: boolean; ms: number | null }>((resolve) => {
      execFile('ping', args, { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve({ reachable: false, ms: null })
        const m = stdout.match(/time=([\d.]+)/)
        resolve({ reachable: true, ms: m ? Math.round(Number(m[1]) * 10) / 10 : null })
      })
    })
    return { ip, size, via: iface, ...result }
  })

}
