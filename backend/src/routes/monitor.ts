import type { FastifyPluginAsync } from 'fastify'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { managerScope, scopeAllows } from '../lib/scope'
import { decryptSecret } from '../lib/secretbox'
import { getInterfaces, type RouterCreds } from '../lib/routerApi'

/**
 * Network monitoring — devices, their health, and their recent history.
 *
 * Every route is scoped the same way the rest of the panel is: a reseller sees their company's
 * routers and nobody else's, and an id outside that scope answers 404 rather than 403 so a caller
 * cannot learn that a device it may not see exists.
 *
 * The heavy work happens in deviceMonitor.ts on a timer. These routes only read what it recorded,
 * with one exception — the interface list on the detail screen, which is fetched live because
 * "which port is down right now" is a question about this second, not about the last poll.
 */

const roleOf = (req: { user?: { role?: string } }) => req.user?.role

export const monitorRoutes: FastifyPluginAsync = async (app) => {
  /** Every device the caller may see, with the health the monitor last recorded. */
  app.get('/devices', { preHandler: authenticate }, async (req) => {
    const scope = await managerScope(req.user.sub, roleOf(req))
    const params: unknown[] = []
    let where = ''
    if (!scope.all) {
      params.push(scope.ids)
      where = `WHERE n.manager_id = ANY($1::uuid[])`
    }
    const rows = await query(`
      SELECT n.id, n.nasname, n.shortname, n.manager_id, n.monitor_enabled, n.api_enabled,
             n.status, n.last_seen_at, n.down_since, n.last_error,
             n.identity, n.board, n.os_version,
             n.cpu_load, n.free_memory, n.total_memory, n.uptime_sec,
             m.username AS company,
             (SELECT s.rx_bps FROM device_samples s
               WHERE s.nas_id = n.id AND s.reachable ORDER BY s.sampled_at DESC LIMIT 1) AS rx_bps,
             (SELECT s.tx_bps FROM device_samples s
               WHERE s.nas_id = n.id AND s.reachable ORDER BY s.sampled_at DESC LIMIT 1) AS tx_bps,
             (SELECT count(*) FROM subscribers x WHERE x.manager_id = n.manager_id) AS subscribers
        FROM nas n
        LEFT JOIN managers m ON m.id = n.manager_id
        ${where}
       ORDER BY (n.status = 'down') DESC, COALESCE(n.shortname, n.nasname)`, params)

    const data = rows.rows
    return {
      data,
      totals: {
        devices: data.length,
        up: data.filter((d: any) => d.status === 'up').length,
        down: data.filter((d: any) => d.status === 'down').length,
        unknown: data.filter((d: any) => d.status !== 'up' && d.status !== 'down').length,
      },
    }
  })

  /** One device, with its ports read live from the router. */
  app.get('/devices/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const r = await query<{
      id: string; nasname: string; shortname: string | null; manager_id: string | null
      api_port: number | null; api_user: string | null; api_password: string | null
      status: string | null; last_seen_at: string | null; down_since: string | null
      last_error: string | null; identity: string | null; board: string | null
      os_version: string | null; cpu_load: number | null; free_memory: string | null
      total_memory: string | null; uptime_sec: string | null
    }>(`SELECT id, nasname, shortname, manager_id, api_port, api_user, api_password,
               status, last_seen_at, down_since, last_error, identity, board, os_version,
               cpu_load, free_memory, total_memory, uptime_sec
          FROM nas WHERE id = $1`, [id])
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' })

    const d = r.rows[0]!
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scopeAllows(scope, d.manager_id)) return reply.code(404).send({ error: 'not_found' })

    // The device row is returned whatever happens to the live call: a router that is down still
    // has a name, a last-seen time and a reason, and that is precisely when it is being looked at.
    const device = { ...d, api_password: undefined, api_user: undefined }

    let interfaces: unknown[] = []
    let ifaceError: string | null = null
    const password = decryptSecret(d.api_password)
    if (d.api_user && password) {
      try {
        const creds: RouterCreds = {
          host: d.nasname,
          port: d.api_port ?? 80,
          user: d.api_user,
          password,
        }
        const list = await getInterfaces(creds)
        interfaces = list
          // Dynamic per-subscriber sessions would drown the list on a router with 400 of them;
          // they belong on the subscribers screen, which already shows them one by one.
          .filter((i) => !(i.name ?? '').startsWith('<') && !(i.name ?? '').startsWith('pppoe-'))
          .map((i) => ({
            name: i.name,
            type: i.type ?? null,
            running: i.running === 'true',
            rx_byte: Number(i['rx-byte'] ?? 0),
            tx_byte: Number(i['tx-byte'] ?? 0),
          }))
      } catch (e) {
        const m = (e as Error).message
        ifaceError = m === 'unauthorized'
          ? 'كلمة مرور واجهة الراوتر مرفوضة'
          : m.startsWith('http_') ? `الراوتر ردّ بـ ${m.slice(5)}` : 'تعذّر الوصول إلى الراوتر'
      }
    } else {
      ifaceError = 'واجهة الراوتر غير مفعّلة لهذا الجهاز'
    }

    return { device, interfaces, iface_error: ifaceError }
  })

  /** Recent history for the graphs. */
  app.get('/devices/:id/history', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const hours = Math.min(168, Math.max(1, Number((req.query as { hours?: string }).hours) || 24))

    const own = await query<{ manager_id: string | null }>('SELECT manager_id FROM nas WHERE id = $1', [id])
    if (!own.rowCount) return reply.code(404).send({ error: 'not_found' })
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scopeAllows(scope, own.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })

    // Bucketed rather than raw: a week at one sample a minute is ten thousand points, which is
    // both a slow response and more detail than any phone-sized chart can draw. The bucket grows
    // with the window so the number of points stays roughly constant.
    const bucketMin = hours <= 6 ? 1 : hours <= 24 ? 5 : hours <= 72 ? 15 : 60
    const rows = await query(`
      SELECT to_timestamp(floor(extract(epoch FROM sampled_at) / ($2::int * 60)) * ($2::int * 60)) AS t,
             round(avg(cpu_load))::int                                   AS cpu_load,
             round(avg(NULLIF(free_memory, 0)))::bigint                  AS free_memory,
             max(total_memory)                                           AS total_memory,
             round(avg(rx_bps))::bigint                                  AS rx_bps,
             round(avg(tx_bps))::bigint                                  AS tx_bps,
             bool_and(reachable)                                         AS reachable
        FROM device_samples
       WHERE nas_id = $1 AND sampled_at > now() - ($3::int * interval '1 hour')
       GROUP BY 1 ORDER BY 1`, [id, bucketMin, hours])

    // Availability over the window, which is the number an operator is actually asked for.
    const up = await query<{ total: string; ok: string }>(`
      SELECT count(*)::text AS total, count(*) FILTER (WHERE reachable)::text AS ok
        FROM device_samples
       WHERE nas_id = $1 AND sampled_at > now() - ($2::int * interval '1 hour')`, [id, hours])

    const total = Number(up.rows[0]?.total ?? 0)
    const ok = Number(up.rows[0]?.ok ?? 0)
    return {
      data: rows.rows,
      hours,
      bucket_minutes: bucketMin,
      uptime_pct: total > 0 ? Math.round((ok / total) * 1000) / 10 : null,
      samples: total,
    }
  })

  /**
   * The network map: every router the caller may see, each with its ports, and hanging off each
   * port the devices that announced themselves there.
   *
   * Shaped as a tree rather than a free-form graph of nodes and edges, because that is what this
   * network actually is — a router, its sectors, and the antennas on each sector — and because a
   * tree can be drawn on a phone. A generic graph needs a layout engine and still comes out as a
   * hairball on a 6-inch screen.
   *
   * Traffic belongs to the PORT, not to the individual antenna: fifteen customers share one
   * sector, and the router counts the sector. Showing each antenna a copy of the sector's rate
   * would be inventing a number the router never measured.
   */
  app.get('/map', { preHandler: authenticate }, async (req) => {
    const scope = await managerScope(req.user.sub, roleOf(req))
    const params: unknown[] = []
    let where = ''
    if (!scope.all) {
      params.push(scope.ids)
      where = `WHERE n.manager_id = ANY($1::uuid[])`
    }

    const sites = (await query<{
      id: string; nasname: string; shortname: string | null; identity: string | null
      status: string | null; cpu_load: number | null; board: string | null
      os_version: string | null; uptime_sec: string | null; company: string | null
    }>(`SELECT n.id, n.nasname, n.shortname, n.identity, n.status, n.cpu_load, n.board,
               n.os_version, n.uptime_sec, m.username AS company
          FROM nas n LEFT JOIN managers m ON m.id = n.manager_id
          ${where}
         ORDER BY COALESCE(n.shortname, n.nasname)`, params)).rows

    if (!sites.length) return { sites: [] }

    const ids = sites.map((s) => s.id)
    const neighbors = (await query<{
      nas_id: string; mac: string; identity: string | null; address: string | null
      iface: string | null; platform: string | null; board: string | null
      version: string | null; uptime_sec: string | null; last_seen_at: string
      stale: boolean
    }>(`SELECT nas_id, mac, identity, address, iface, platform, board, version, uptime_sec,
               last_seen_at,
               -- Three missed sweeps. One is a lost announcement, three is a device that stopped
               -- talking — and that is what the operator is looking for on a map.
               (last_seen_at < now() - interval '5 minutes') AS stale
          FROM device_neighbors
         WHERE nas_id = ANY($1::uuid[])
         ORDER BY iface, identity NULLS LAST`, [ids])).rows

    // One sample per device for the port rates; the map redraws often and must not re-poll routers.
    const rates = (await query<{ nas_id: string; rx_bps: string; tx_bps: string }>(
      `SELECT DISTINCT ON (nas_id) nas_id, rx_bps, tx_bps
         FROM device_samples WHERE nas_id = ANY($1::uuid[]) AND reachable
        ORDER BY nas_id, sampled_at DESC`, [ids])).rows
    const rateOf = new Map(rates.map((r) => [r.nas_id, r]))

    return {
      sites: sites.map((site) => {
        const mine = neighbors.filter((n) => n.nas_id === site.id)
        const ports = new Map<string, typeof mine>()
        for (const n of mine) {
          const key = n.iface || '—'
          if (!ports.has(key)) ports.set(key, [])
          ports.get(key)!.push(n)
        }
        const r = rateOf.get(site.id)
        return {
          id: site.id,
          name: site.shortname || site.nasname,
          identity: site.identity,
          address: site.nasname,
          company: site.company,
          status: site.status,
          cpu_load: site.cpu_load,
          board: site.board,
          os_version: site.os_version,
          uptime_sec: site.uptime_sec,
          rx_bps: r?.rx_bps ?? null,
          tx_bps: r?.tx_bps ?? null,
          devices_total: mine.length,
          devices_stale: mine.filter((n) => n.stale).length,
          ports: [...ports.entries()]
            // Busiest port first: a sector carrying twenty antennas is the one worth looking at.
            .sort((a, b) => b[1].length - a[1].length)
            .map(([name, list]) => ({
              name,
              devices: list.map((n) => ({
                mac: n.mac,
                identity: n.identity,
                address: n.address,
                board: n.board,
                version: n.version,
                uptime_sec: n.uptime_sec,
                last_seen_at: n.last_seen_at,
                stale: n.stale,
              })),
            })),
        }
      }),
    }
  })

  /** Turn monitoring on or off for one device, without touching its RADIUS role. */
  app.put('/devices/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body ?? {}) as { monitor_enabled?: unknown }
    if (typeof body.monitor_enabled !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_input' })
    }
    const own = await query<{ manager_id: string | null }>('SELECT manager_id FROM nas WHERE id = $1', [id])
    if (!own.rowCount) return reply.code(404).send({ error: 'not_found' })
    const scope = await managerScope(req.user.sub, roleOf(req))
    if (!scopeAllows(scope, own.rows[0]!.manager_id)) return reply.code(404).send({ error: 'not_found' })

    // Disabling clears the failure state too, so re-enabling later does not fire a stale alert
    // about an outage that ended weeks ago.
    await query(
      `UPDATE nas SET monitor_enabled = $2,
              status = CASE WHEN $2 THEN status ELSE 'unknown' END,
              fail_count = 0, down_since = NULL, last_error = NULL
        WHERE id = $1`,
      [id, body.monitor_enabled],
    )
    return { ok: true }
  })
}
