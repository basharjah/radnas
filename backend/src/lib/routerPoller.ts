import { query } from '../db/pool'
import { decryptSecret } from './secretbox'
import { getInterfaces, getPppActive, ifaceUsername, parseUptime, type RouterCreds } from './routerApi'

/**
 * Live per-subscriber throughput, polled straight from the router.
 *
 * RADIUS accounting only refreshes on Interim-Update (~60s on the RB5009), which is far too coarse
 * for a "right now" speed readout. RouterOS exposes per-interface byte counters for every PPPoE
 * session, so two REST calls per tick cover ALL sessions at once — cost is independent of how many
 * subscribers are online.
 *
 * State lives in memory only: it is derived, hot, and worthless after a restart.
 */

const POLL_MS = 2000
const STALE_MS = 15000 // a reading older than this is no longer "live"

export interface LiveStat {
  username: string
  mac: string | null
  ip: string | null
  uptimeSec: number
  downBps: number   // to the customer
  upBps: number     // from the customer
  rxBytes: number   // session totals as the ROUTER sees them
  txBytes: number
  at: number
}

interface NasState {
  id: string
  label: string
  creds: RouterCreds
  prev: Map<string, { rx: number; tx: number; at: number }>
  ok: boolean
  error: string | null
  lastOkAt: number
  failures: number
}

const live = new Map<string, LiveStat>()
const nasStates = new Map<string, NasState>()
let timer: ReturnType<typeof setInterval> | null = null

export function getLive(username: string): LiveStat | null {
  const s = live.get(username)
  return s && Date.now() - s.at < STALE_MS ? s : null
}

/**
 * Router health, RESTRICTED to the NAS ids the caller may see.
 *
 * The poller holds every tenant's router, so returning it unfiltered leaked another company's
 * router NAME and failure state into a tenant's dashboard ("تعذّر الوصول إلى الراوتر sam").
 * Passing null means "no restriction" and is only for the platform owner.
 */
export function liveHealth(nasIds: string[] | null) {
  return [...nasStates.values()]
    .filter((n) => nasIds === null || nasIds.includes(n.id))
    .map((n) => ({
      nas_id: n.id, label: n.label, ok: n.ok, error: n.error,
      seconds_since_ok: n.lastOkAt ? Math.round((Date.now() - n.lastOkAt) / 1000) : null,
    }))
}

/** True when at least one of the CALLER'S routers is answering. Same scoping rule as liveHealth. */
export function liveAvailable(nasIds: string[] | null): boolean {
  return [...nasStates.values()].some((n) => (nasIds === null || nasIds.includes(n.id)) && n.ok)
}

async function loadNasList(): Promise<void> {
  const res = await query<{
    id: string; nasname: string; shortname: string | null
    api_port: number | null; api_user: string | null; api_password: string | null
  }>(`SELECT id, nasname, shortname, api_port, api_user, api_password
        FROM nas WHERE api_enabled = true AND api_user IS NOT NULL AND api_password IS NOT NULL`)

  const seen = new Set<string>()
  for (const r of res.rows) {
    const password = decryptSecret(r.api_password)
    if (!password) continue
    seen.add(r.id)
    const creds: RouterCreds = { host: r.nasname, port: r.api_port ?? 80, user: r.api_user!, password }
    const existing = nasStates.get(r.id)
    if (existing) existing.creds = creds
    else nasStates.set(r.id, { id: r.id, label: r.shortname || r.nasname, creds, prev: new Map(), ok: false, error: null, lastOkAt: 0, failures: 0 })
  }
  for (const id of nasStates.keys()) if (!seen.has(id)) nasStates.delete(id)
}

async function pollNas(n: NasState): Promise<void> {
  // Skip a dead router most ticks so one unreachable NAS can't slow the whole loop.
  if (!n.ok && n.failures > 3 && n.failures % 15 !== 0) { n.failures++; return }
  try {
    const [ppp, ifaces] = await Promise.all([getPppActive(n.creds), getInterfaces(n.creds)])
    const now = Date.now()

    const counters = new Map<string, { rx: number; tx: number }>()
    for (const i of ifaces) {
      const u = ifaceUsername(i.name)
      if (u) counters.set(u, { rx: Number(i['rx-byte'] ?? 0), tx: Number(i['tx-byte'] ?? 0) })
    }

    const nextPrev = new Map<string, { rx: number; tx: number; at: number }>()
    for (const s of ppp) {
      const c = counters.get(s.name)
      if (!c) continue
      const p = n.prev.get(s.name)
      let downBps = 0, upBps = 0
      if (p && now > p.at) {
        const secs = (now - p.at) / 1000
        // Router tx = customer download, rx = customer upload. Negative = counter reset → drop it.
        downBps = Math.max(0, (c.tx - p.tx)) * 8 / secs
        upBps = Math.max(0, (c.rx - p.rx)) * 8 / secs
      }
      nextPrev.set(s.name, { rx: c.rx, tx: c.tx, at: now })
      live.set(s.name, {
        username: s.name,
        mac: s['caller-id'] ?? null,
        ip: s.address ?? null,
        uptimeSec: parseUptime(s.uptime),
        downBps: p ? Math.round(downBps) : 0,
        upBps: p ? Math.round(upBps) : 0,
        rxBytes: c.rx, txBytes: c.tx, at: now,
      })
    }
    n.prev = nextPrev
    n.ok = true; n.error = null; n.lastOkAt = now; n.failures = 0
  } catch (e) {
    n.ok = false
    n.error = (e as Error).message
    n.failures++
  }
}

export async function startRouterPoller(): Promise<void> {
  if (timer) return
  await loadNasList().catch(() => {})
  let ticks = 0
  timer = setInterval(() => {
    ticks++
    // Re-read the NAS table every ~30s so newly configured routers start polling on their own.
    if (ticks % 15 === 0) loadNasList().catch(() => {})
    for (const n of nasStates.values()) void pollNas(n)
    // Forget sessions that stopped reporting so a stale card can't linger.
    const cutoff = Date.now() - STALE_MS * 4
    for (const [u, s] of live) if (s.at < cutoff) live.delete(u)
  }, POLL_MS)
}
