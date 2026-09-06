import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, readFileSync, readdirSync, appendFileSync, unlinkSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { query } from '../db/pool'

const run = promisify(execFile)

/**
 * Give a newly approved company its own WireGuard tunnel and router record, unattended.
 *
 * One interface PER TENANT, not one shared interface with many peers. That is forced by the customers
 * themselves: they all hand out 10.0.0.0/24 from their PPPoE pools, and WireGuard requires AllowedIPs
 * to be unique WITHIN an interface while allowing the same prefix on different interfaces. Separate
 * interfaces are therefore the only arrangement in which overlapping customer pools can coexist.
 *
 * `Table = off` on every tunnel is equally deliberate: letting wg-quick install a route for the
 * customer's pool would steal that prefix from whichever tunnel already had it and break the
 * neighbour's ping. Reaching a pool is done with `ping -I wgN`, which names the interface explicitly.
 *
 * The UDP range 51820:51870 is opened in CSF once, by hand, so provisioning never touches the
 * firewall — a per-customer `csf -r` would briefly drop every other tunnel.
 */

const FIRST_INDEX = 2                 // wg0 and wg1 predate this and are managed by hand
const MAX_INDEX = 50                  // matches the port range opened in CSF
const SYSCTL_FILE = '/etc/sysctl.d/99-radnas-wg.conf'
const LOCK_KEY = 918273645            // any constant: serialises index allocation across requests

export interface Provisioned {
  nas_id: string
  nasname: string
  shortname: string
  iface: string
  tunnel_ip: string
  listen_port: number
  created: boolean                    // false when the tenant already had a tunnel
}

/** Every wgN already on disk, whether or not this code created it. */
function usedIndexes(): Set<number> {
  const out = new Set<number>()
  for (const f of readdirSync('/etc/wireguard')) {
    const m = /^wg(\d+)\.conf$/.exec(f)
    if (m) out.add(Number(m[1]))
  }
  return out
}

/**
 * `wg pubkey` reads the private key from stdin, and execFile has no way to supply it — the async
 * form silently ignores an `input` option. Synchronous is right here anyway: this is X25519 scalar
 * multiplication, over in microseconds, and provisioning happens once per customer.
 */
function pubkeyOf(privateKey: string): string {
  return execFileSync('wg', ['pubkey'], { input: privateKey, encoding: 'utf8' }).trim()
}

async function genKey(): Promise<string> {
  const { stdout } = await run('wg', ['genkey'])
  return stdout.trim()
}

export async function provisionTenantTunnel(
  managerId: string,
  shortname: string,
  // Pass a pool only to override the per-tenant allocation below.
  poolCidr?: string,
): Promise<Provisioned> {
  // Two approvals landing together must not pick the same index or the same port.
  await query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
  try {
    // Already provisioned? Hand back what exists rather than building a second tunnel.
    const have = await query<{
      id: string; nasname: string; shortname: string | null
      iface: string | null; tunnel_ip: string; listen_port: number | null
    }>(
      `SELECT n.id, n.nasname, n.shortname, w.iface, host(w.tunnel_ip) AS tunnel_ip, w.listen_port
         FROM nas n JOIN wireguard_peers w ON w.nas_id = n.id
        WHERE n.manager_id = $1 AND w.iface IS NOT NULL
        ORDER BY n.created_at LIMIT 1`, [managerId],
    )
    if (have.rowCount) {
      const h = have.rows[0]!
      return {
        nas_id: h.id, nasname: h.nasname, shortname: h.shortname || shortname,
        iface: h.iface!, tunnel_ip: h.tunnel_ip, listen_port: h.listen_port!, created: false,
      }
    }

    const used = usedIndexes()
    let idx = FIRST_INDEX
    while (used.has(idx) && idx <= MAX_INDEX) idx++
    if (idx > MAX_INDEX) throw new Error('tunnel_capacity_exhausted')

    const iface = `wg${idx}`
    const conf = `/etc/wireguard/${iface}.conf`
    const keyFiles = [
      `/etc/wireguard/${iface}-client.key`,
      `/etc/wireguard/${iface}-client.pub`,
      `/etc/wireguard/${iface}-server.pub`,
    ]
    const net = `10.10.${10 + idx}`
    const clientIp = `${net}.2`
    const port = 51820 + idx

    // A subscriber pool unique to this tenant, allocated from the tunnel index exactly as the tunnel
    // network and port are. Two companies could previously be handed the same default, and identical
    // subscriber addresses across tenants make every log line ambiguous and leave isolation resting
    // on remembering to bind the interface on every outbound call — one omission is a leak.
    //
    // NOT 100.64.0.0/10. That range was chosen first, on the reasoning that RFC 6598 space is
    // provider-side and so absent from customer LANs — which is true of LANs and wrong about WANs.
    // Starlink hands its subscribers a 100.64.0.0/10 address (we met 100.66.184.73/10), so the whole
    // /10 sits on the router as a connected WAN route at distance 0. A pool inside it then competes
    // with that route: per-session /32 routes still answer ping, so the tunnel looks healthy, while
    // the subscribers have no internet. Nothing logs it. Every Starlink-fed ISP would hit this.
    //
    // 10.55.x is not collision-proof either — no private range is — so the diagnosis compares the
    // pool against the router's own connected routes and reports an overlap instead of trusting a
    // constant. A tenant whose LAN already uses 10.55.x is given an explicit poolCidr.
    const pool = poolCidr || `10.55.${idx}.0/24`

    const srvKey = await genKey()
    const cliKey = await genKey()
    const srvPub = pubkeyOf(srvKey)
    const cliPub = pubkeyOf(cliKey)

    writeFileSync(conf, `# نفق مستقلّ للعميل — وُلّد تلقائياً عند الموافقة على الحساب.
# Table = off مقصود: بِرك العملاء تتكرّر (10.0.0.0/24 عند أكثر من عميل)، فلو أضاف
# wg-quick مسارها لهذه الواجهة لسرقها من نفق آخر وقطع ping زبائنه.
# الوصول إلى بركة هذا العميل يجري بـ  ping -I ${iface}  الذي يحدّد الواجهة صراحةً.
[Interface]
Address = ${net}.1/24
ListenPort = ${port}
PrivateKey = ${srvKey}
Table = off

[Peer]
PublicKey = ${cliPub}
AllowedIPs = ${clientIp}/32, ${pool}
`, { mode: 0o600 })

    // The router needs the client key; /etc/wireguard stays its single home — never the database.
    writeFileSync(keyFiles[0]!, cliKey + '\n', { mode: 0o600 })
    writeFileSync(keyFiles[1]!, cliPub + '\n', { mode: 0o644 })
    writeFileSync(keyFiles[2]!, srvPub + '\n', { mode: 0o644 })

    // Loose reverse-path filtering: a reply from an overlapping pool arrives on this interface while
    // the kernel's single route for that prefix names another one. Strict mode would drop it.
    const haveSysctl = existsSync(SYSCTL_FILE)
      && readFileSync(SYSCTL_FILE, 'utf8').includes(`conf.${iface}.rp_filter`)
    if (!haveSysctl) appendFileSync(SYSCTL_FILE, `net.ipv4.conf.${iface}.rp_filter = 2\n`)

    try {
      await run('systemctl', ['enable', '--now', `wg-quick@${iface}`], { timeout: 20000 })
      await run('sysctl', ['-p', SYSCTL_FILE], { timeout: 10000 }).catch(() => {})
      await run('wg', ['show', iface], { timeout: 5000 })          // prove it is really up
    } catch (e) {
      // Never leave a half-built tunnel behind: undo the files so the next attempt starts clean.
      await run('systemctl', ['disable', '--now', `wg-quick@${iface}`], { timeout: 20000 }).catch(() => {})
      for (const f of [conf, ...keyFiles]) { try { unlinkSync(f) } catch { /* already gone */ } }
      throw new Error(`tunnel_bringup_failed: ${(e as Error).message}`)
    }

    // DB rows come last, so a failed bring-up leaves nothing dangling to confuse the panel.
    const secret = randomBytes(18).toString('base64url')
    const nas = await query<{ id: string }>(
      `INSERT INTO nas (nasname, shortname, type, secret, description, manager_id)
       VALUES ($1, $2, 'mikrotik', $3, $4, $5) RETURNING id`,
      [clientIp, shortname, secret, `نفق ${iface} — تجهيز تلقائي`, managerId],
    )
    const nasId = nas.rows[0]!.id
    await query(
      `INSERT INTO wireguard_peers (name, type, public_key, tunnel_ip, allowed_ips, nas_id,
                                    server_public_key, endpoint, listen_port, iface, pool_cidr)
       VALUES ($1, 'router', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [shortname, cliPub, clientIp, `${clientIp}/32`, nasId, srvPub,
       process.env.WG_ENDPOINT || '165.140.158.104', port, iface, pool],
    )

    // FreeRADIUS loads its client list at startup, so a new NAS stays invisible until it restarts.
    await run('systemctl', ['restart', 'radiusd'], { timeout: 30000 }).catch(() => {})

    return {
      nas_id: nasId, nasname: clientIp, shortname,
      iface, tunnel_ip: clientIp, listen_port: port, created: true,
    }
  } finally {
    await query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
  }
}

/**
 * Tear a tenant's tunnel off the machine.
 *
 * The database rows go with the account, but the interface, its keys and its sysctl line live on
 * disk — deleting the customer without this leaves a tunnel running for a company that no longer
 * exists, holding a port and a key that still work.
 *
 * Best-effort per step: a half-removed tunnel must not stop the rest of the cleanup, and every piece
 * is independently safe to remove twice.
 */
export async function destroyTenantTunnel(iface: string): Promise<boolean> {
  if (!/^wg[0-9]+$/.test(iface)) return false          // never build an argv from loose input
  // wg0 and wg1 predate provisioning and are managed by hand — refuse to touch them.
  const idx = Number(iface.slice(2))
  if (idx < FIRST_INDEX) return false

  await run('systemctl', ['disable', '--now', `wg-quick@${iface}`], { timeout: 20000 }).catch(() => {})
  for (const f of [
    `/etc/wireguard/${iface}.conf`,
    `/etc/wireguard/${iface}-client.key`,
    `/etc/wireguard/${iface}-client.pub`,
    `/etc/wireguard/${iface}-server.pub`,
  ]) {
    try { unlinkSync(f) } catch { /* already gone */ }
  }
  try {
    if (existsSync(SYSCTL_FILE)) {
      const kept = readFileSync(SYSCTL_FILE, 'utf8')
        .split(/\r?\n/)
        .filter((l) => !l.includes(`conf.${iface}.rp_filter`))
        .join('\n')
      writeFileSync(SYSCTL_FILE, kept)
    }
  } catch { /* the sysctl line is cosmetic once the interface is gone */ }
  return true
}
