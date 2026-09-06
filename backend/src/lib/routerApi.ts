/**
 * Minimal RouterOS REST client (RouterOS 7.x, the `/rest` endpoint served by the `www` service).
 *
 * Reached over the WireGuard tunnel (10.10.10.x), so plain HTTP is acceptable here — the traffic
 * never leaves the encrypted tunnel. Only read calls are used; disconnecting a subscriber still
 * goes through RADIUS CoA, so the router account needs no write policy.
 */

export interface PppActive {
  name: string          // subscriber username
  address?: string      // IP handed to the customer
  'caller-id'?: string  // customer MAC
  uptime?: string       // RouterOS duration, e.g. "1h4m30s"
  service?: string
}

export interface RouterIface {
  name: string
  'rx-byte'?: string    // bytes the ROUTER received  = customer UPLOAD
  'tx-byte'?: string    // bytes the ROUTER sent      = customer DOWNLOAD
  type?: string
  running?: string
}

export interface RouterCreds {
  host: string
  port: number
  user: string
  password: string
}

async function rest<T>(c: RouterCreds, path: string, timeoutMs = 4000): Promise<T> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`http://${c.host}:${c.port}/rest${path}`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${c.user}:${c.password}`).toString('base64'),
        Accept: 'application/json',
      },
      signal: ac.signal,
    })
    if (res.status === 401) throw new Error('unauthorized')
    if (!res.ok) throw new Error(`http_${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export const getPppActive = (c: RouterCreds) => rest<PppActive[]>(c, '/ppp/active')
export const getInterfaces = (c: RouterCreds) => rest<RouterIface[]>(c, '/interface')

/** Cheap credential/reachability check used by the "test connection" button. */
export async function testRouter(c: RouterCreds): Promise<{ ok: true; identity: string; sessions: number } | { ok: false; error: string }> {
  try {
    const [id, ppp] = await Promise.all([
      rest<{ name?: string }>(c, '/system/identity'),
      getPppActive(c),
    ])
    return { ok: true, identity: id?.name ?? '—', sessions: ppp.length }
  } catch (e) {
    const m = (e as Error).message
    return { ok: false, error: m === 'unauthorized' ? 'اسم المستخدم أو كلمة المرور غير صحيحة' : m.startsWith('http_') ? `الراوتر ردّ بـ ${m.slice(5)}` : 'تعذّر الوصول إلى الراوتر' }
  }
}

/** RouterOS duration ("2w3d1h4m30s") → seconds. */
export function parseUptime(s: string | undefined): number {
  if (!s) return 0
  let total = 0
  const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 }
  for (const [, n, u] of s.matchAll(/(\d+)([wdhms])/g)) total += Number(n) * (units[u] ?? 0)
  return total
}

/**
 * A PPPoE session's dynamic interface is named `<pppoe-USERNAME>`. Normalising both sides lets the
 * interface counters be matched to the session without depending on the exact bracket style.
 */
export function ifaceUsername(name: string): string | null {
  const m = /^<?pppoe-(.+?)>?$/.exec(name.trim())
  return m ? m[1]! : null
}
