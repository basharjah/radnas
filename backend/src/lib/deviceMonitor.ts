import { query } from '../db/pool'
import { decryptSecret } from './secretbox'
import { getInterfaces, parseUptime, type RouterCreds, type RouterIface } from './routerApi'
import { notify } from './notify'
import { audit } from './audit'

/**
 * Device health monitoring — the part of The Dude that RadNas did not have.
 *
 * The panel already reached every tenant's router (WireGuard out to each site, REST in over the
 * tunnel) and already polled it twice a second for per-subscriber throughput. What was missing was
 * the router ITSELF as a monitored object: is it up, how hard is it working, how long has it been
 * running, which of its ports are carrying traffic — and a record of all that over time, so
 * "the internet was bad last night" can be answered with a number instead of a shrug.
 *
 * Deliberately NOT a reimplementation of The Dude's protocol. That protocol is undocumented and
 * closed; these are MikroTik's own published REST endpoints, which is what The Dude's server uses
 * internally anyway. Same data, supported, and it keeps working when MikroTik changes its mind.
 *
 * Runs on the server, never on the phone: an Android app cannot watch forty routers around the
 * clock because the OS kills background work to save battery. The phone is a thin client over the
 * data this collects — which is exactly the client/server split MikroTik themselves chose.
 */

/** A minute. Fast enough to catch an outage while it still matters, slow enough to be free. */
const POLL_MS = 60_000

/**
 * How many consecutive failures before a device is declared down.
 *
 * One miss is a dropped packet on a Starlink link with 200ms of latency and occasional loss; three
 * in a row, a full three minutes apart, is an outage. Alerting on the first miss would page the
 * operator several times a night for nothing, and an alert people learn to ignore is worse than no
 * alert at all.
 */
const DOWN_AFTER = 3

/** Samples are for graphing recent history, not for accounting. Two weeks is plenty. */
const RETAIN_DAYS = 14

interface SystemResource {
  uptime?: string
  version?: string
  'board-name'?: string
  'cpu-load'?: string
  'free-memory'?: string
  'total-memory'?: string
  'cpu-count'?: string
  architecture?: string
}

interface DeviceRow {
  id: string
  nasname: string
  shortname: string | null
  manager_id: string | null
  api_port: number | null
  api_user: string | null
  api_password: string | null
  status: string | null
  fail_count: number | null
}

/** Byte counters from the previous tick, to turn totals into a rate. In memory only: derived. */
const prev = new Map<string, { rx: number; tx: number; at: number }>()

let timer: NodeJS.Timeout | null = null

/** Idempotent, safe on every boot — the same pattern the automation columns use. */
export async function ensureMonitorSchema(): Promise<void> {
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS monitor_enabled boolean NOT NULL DEFAULT true`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'unknown'`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS last_seen_at  timestamptz`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS down_since    timestamptz`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS last_error    text`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS fail_count    int NOT NULL DEFAULT 0`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS identity      text`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS board         text`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS os_version    text`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS cpu_load      int`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS free_memory   bigint`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS total_memory  bigint`)
  await query(`ALTER TABLE nas ADD COLUMN IF NOT EXISTS uptime_sec    bigint`)

  await query(`
    CREATE TABLE IF NOT EXISTS device_samples (
      id          bigserial PRIMARY KEY,
      nas_id      uuid NOT NULL REFERENCES nas(id) ON DELETE CASCADE,
      sampled_at  timestamptz NOT NULL DEFAULT now(),
      reachable   boolean NOT NULL DEFAULT true,
      cpu_load    int,
      free_memory bigint,
      total_memory bigint,
      uptime_sec  bigint,
      rx_bps      bigint NOT NULL DEFAULT 0,
      tx_bps      bigint NOT NULL DEFAULT 0
    )`)
  await query(`CREATE INDEX IF NOT EXISTS device_samples_nas_time_idx ON device_samples (nas_id, sampled_at DESC)`)

  // Everything each router can SEE, which is what a network map is made of.
  //
  // MikroTik devices announce themselves to their neighbours (MNDP, and CDP/LLDP for other
  // vendors), and the router collects those announcements in /ip/neighbor. So the topology does
  // not have to be guessed or drawn by hand: the sector antenna on a tower reports its identity,
  // its board and the interface it arrived on, and that interface IS the link.
  //
  // Rows are kept after a device disappears rather than deleted, so an antenna that dropped off
  // last night is still on the map — greyed and stamped with when it was last seen. A map that
  // silently loses the failed device is the one map you cannot use during a failure.
  await query(`
    CREATE TABLE IF NOT EXISTS device_neighbors (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nas_id        uuid NOT NULL REFERENCES nas(id) ON DELETE CASCADE,
      mac           text NOT NULL,
      identity      text,
      address       text,
      iface         text,
      platform      text,
      board         text,
      version       text,
      uptime_sec    bigint,
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (nas_id, mac)
    )`)
  await query(`CREATE INDEX IF NOT EXISTS device_neighbors_nas_idx ON device_neighbors (nas_id, iface)`)
}

interface Neighbor {
  identity?: string
  address?: string
  'mac-address'?: string
  interface?: string
  platform?: string
  board?: string
  version?: string
  uptime?: string
}

/**
 * Which port a neighbour is really attached to.
 *
 * RouterOS reports every interface the announcement was heard on, comma-separated — typically the
 * physical sector plus the management bridge it belongs to ("Sector3-Omnitik,bridge-Management").
 * The bridge is the same for everyone and tells you nothing about where a device is, so the
 * physical member is the one worth drawing.
 */
function linkIface(raw: string | undefined): string {
  const parts = (raw ?? '').split(',').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return '—'
  return parts.find((p) => !/^(bridge|br)[-_]?/i.test(p)) ?? parts[0]!
}

/** Record what this router can see, so the map can be drawn from stored data. */
async function collectNeighbors(d: DeviceRow, creds: RouterCreds): Promise<void> {
  const list = await fetchJson<Neighbor[]>(creds, '/ip/neighbor', 9000)
  for (const n of list) {
    const mac = (n['mac-address'] ?? '').trim()
    // Without a MAC there is no stable identity: an address can move between devices, and the
    // row would then describe two different antennas over time.
    if (!mac) continue
    await query(
      `INSERT INTO device_neighbors
         (nas_id, mac, identity, address, iface, platform, board, version, uptime_sec, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (nas_id, mac) DO UPDATE SET
         identity = EXCLUDED.identity, address = EXCLUDED.address, iface = EXCLUDED.iface,
         platform = EXCLUDED.platform, board = EXCLUDED.board, version = EXCLUDED.version,
         uptime_sec = EXCLUDED.uptime_sec, last_seen_at = now()`,
      [d.id, mac, n.identity ?? null, n.address ?? null, linkIface(n.interface),
       n.platform ?? null, n.board ?? null, n.version ?? null, parseUptime(n.uptime)],
    )
  }
}

const num = (v: string | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Total traffic across the device's PHYSICAL ports.
 *
 * Dynamic PPPoE interfaces are excluded on purpose: every customer's session already appears on
 * the ethernet port carrying it, so counting both would roughly double the figure and make the
 * device look twice as busy as it is.
 */
function physicalTotals(ifaces: RouterIface[]): { rx: number; tx: number } {
  let rx = 0
  let tx = 0
  for (const i of ifaces) {
    const name = (i.name ?? '').trim()
    if (name.startsWith('<') || name.startsWith('pppoe-')) continue
    rx += num(i['rx-byte'])
    tx += num(i['tx-byte'])
  }
  return { rx, tx }
}

async function poll(): Promise<void> {
  const devices = (await query<DeviceRow>(`
    SELECT n.id, n.nasname, n.shortname, n.manager_id, n.api_port, n.api_user, n.api_password,
           n.status, n.fail_count
      FROM nas n
     WHERE n.api_enabled = true AND n.monitor_enabled = true
       AND n.api_user IS NOT NULL AND n.api_password IS NOT NULL`)).rows

  for (const d of devices) {
    // Each device in its own guard. Anything unexpected here — a credential that will not decrypt,
    // a malformed response, a driver-level throw — used to abort the whole sweep, so every device
    // after the bad one was silently never polled. A monitor that stops at the first fault is
    // worse than no monitor: it reports "unknown" for healthy routers and nobody knows why.
    try {
      await pollOne(d)
    } catch (e) {
      await query(`UPDATE nas SET last_error = $2 WHERE id = $1`,
        [d.id, `خطأ غير متوقّع في المراقبة: ${(e as Error).message}`]).catch(() => {})
    }
  }

  await query(`DELETE FROM device_samples WHERE sampled_at < now() - ($1::int * interval '1 day')`, [RETAIN_DAYS])
}

async function pollOne(d: DeviceRow): Promise<void> {
  {
    const label = d.shortname || d.nasname
    // A credential that will not decrypt is a configuration fault, not an outage. Recording it as
    // "down" would start paging the operator about a router that is very likely fine.
    const password = decryptSecret(d.api_password)
    const user = d.api_user
    if (!password || !user) {
      await query(`UPDATE nas SET last_error = $2 WHERE id = $1`,
        [d.id, 'تعذّر قراءة بيانات اعتماد واجهة الراوتر'])
      return
    }
    const creds: RouterCreds = {
      host: d.nasname,
      port: d.api_port ?? 80,
      user,
      password,
    }

    try {
      const [res, ident, ifaces] = await Promise.all([
        fetchJson<SystemResource>(creds, '/system/resource'),
        fetchJson<{ name?: string }>(creds, '/system/identity'),
        getInterfaces(creds),
      ])

      const totals = physicalTotals(ifaces)
      const now = Date.now()
      const before = prev.get(d.id)
      prev.set(d.id, { rx: totals.rx, tx: totals.tx, at: now })

      // Counters reset when a router reboots, so a negative delta means "rebooted", not "minus
      // four gigabytes". Clamping at zero keeps a restart from drawing a spike on the graph.
      let rxBps = 0
      let txBps = 0
      if (before) {
        const secs = (now - before.at) / 1000
        if (secs > 0) {
          rxBps = Math.max(0, Math.round(((totals.rx - before.rx) * 8) / secs))
          txBps = Math.max(0, Math.round(((totals.tx - before.tx) * 8) / secs))
        }
      }

      const cpu = Math.round(num(res['cpu-load']))
      const freeMem = num(res['free-memory'])
      const totalMem = num(res['total-memory'])
      const uptime = parseUptime(res.uptime)
      const wasDown = d.status === 'down'

      await query(
        `UPDATE nas SET status='up', last_seen_at=now(), down_since=NULL, last_error=NULL,
                       fail_count=0, identity=$2, board=$3, os_version=$4,
                       cpu_load=$5, free_memory=$6, total_memory=$7, uptime_sec=$8
          WHERE id=$1`,
        [d.id, ident?.name ?? null, res['board-name'] ?? null, res.version ?? null,
         cpu, freeMem, totalMem, uptime],
      )
      await query(
        `INSERT INTO device_samples (nas_id, reachable, cpu_load, free_memory, total_memory, uptime_sec, rx_bps, tx_bps)
         VALUES ($1, true, $2, $3, $4, $5, $6, $7)`,
        [d.id, cpu, freeMem, totalMem, uptime, rxBps, txBps],
      )

      // After the vitals, never before: a router whose neighbour list fails to parse must still
      // be recorded as up, with its CPU and its uptime. The map is the bonus, not the point.
      try {
        await collectNeighbors(d, creds)
      } catch {
        // Neighbour discovery can be switched off per interface, and some boards answer slowly.
        // Neither is an outage, and neither should colour the device red.
      }

      if (wasDown) {
        await notify({
          kind: 'nas_down', managerId: d.manager_id, url: '/nas',
          title: 'عاد الجهاز للعمل', body: `${label} — استجاب بعد انقطاع.`,
        })
        await audit({ performedByName: 'monitor', action: 'device.up', targetType: 'nas', targetId: label })
      }
    } catch (e) {
      const msg = (e as Error).message
      const reason = msg === 'unauthorized'
        ? 'كلمة مرور واجهة الراوتر مرفوضة'
        : msg.startsWith('http_') ? `الراوتر ردّ بـ ${msg.slice(5)}` : 'لا يستجيب'
      const fails = (d.fail_count ?? 0) + 1
      const nowDown = fails >= DOWN_AFTER && d.status !== 'down'

      await query(
        `UPDATE nas SET fail_count=$2::int, last_error=$3,
                       status = CASE WHEN $2::int >= $4::int THEN 'down' ELSE status END,
                       down_since = CASE WHEN $2::int >= $4::int AND down_since IS NULL
                                         THEN now() ELSE down_since END
          WHERE id=$1`,
        [d.id, fails, reason, DOWN_AFTER],
      )
      await query(
        `INSERT INTO device_samples (nas_id, reachable, rx_bps, tx_bps) VALUES ($1, false, 0, 0)`,
        [d.id],
      )

      // Announced once, on the transition — not every minute for as long as it stays down.
      if (nowDown) {
        await notify({
          kind: 'nas_down', managerId: d.manager_id, url: '/nas',
          title: 'انقطع جهاز', body: `${label} — ${reason}.`,
        })
        await audit({ performedByName: 'monitor', action: 'device.down', targetType: 'nas', targetId: label, details: reason })
      }
    }
  }
}

/** Same shape as routerApi's private helper, kept here so this module owns its own timeouts. */
async function fetchJson<T>(c: RouterCreds, path: string, timeoutMs = 6000): Promise<T> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(`http://${c.host}:${c.port}/rest${path}`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${c.user}:${c.password}`).toString('base64'),
        Accept: 'application/json',
      },
      signal: ac.signal,
    })
    if (r.status === 401) throw new Error('unauthorized')
    if (!r.ok) throw new Error(`http_${r.status}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function startDeviceMonitor(): Promise<void> {
  if (timer) return
  await ensureMonitorSchema()
  // One pass immediately so the panel has something to show on a fresh boot rather than a minute
  // of "unknown".
  const run = () => {
    // Logged, not swallowed. The first version hid its own errors, so a sweep that died halfway
    // looked exactly like a set of routers that had never been contacted.
    void poll().catch((e) => console.error('[deviceMonitor] sweep failed:', (e as Error).message))
  }
  run()
  timer = setInterval(run, POLL_MS)
}

export function stopDeviceMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
}
