import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { query } from '../db/pool'
import { sendDisconnect } from './coa'
import { tenantNas } from './nasResolve'

const run = promisify(execFile)

/**
 * Operations that reach out to FreeRADIUS or a tenant's router.
 *
 * Kept in one place because both of them are easy to get subtly wrong in ways nothing reports: a CoA
 * sent to the wrong tenant's router is silently ignored, and a NAS row deleted without reloading
 * FreeRADIUS keeps answering from the in-memory client list until the next restart.
 */

/**
 * The identifier RouterOS actually needs to end a session.
 *
 * A Disconnect-Request carrying only User-Name is answered with Disconnect-NAK: RouterOS looks the
 * session up by Acct-Session-Id, and without it there is nothing to match. Every disconnect in this
 * platform sent User-Name alone, so quota enforcement, expiry and the operator's own "cut this
 * subscriber" button all reported success while the customer stayed online — one of them for four
 * days and twenty-nine gigabytes after being barred.
 *
 * Read from the OPEN accounting row, newest first: a subscriber who reconnected while we were
 * deciding has two rows, and killing the stale one leaves them connected on the new one.
 */
async function liveSessionId(username: string): Promise<string | undefined> {
  try {
    const r = await query<{ acctsessionid: string }>(
      `SELECT acctsessionid FROM radacct
        WHERE username = $1 AND acctstoptime IS NULL AND acctsessionid IS NOT NULL
        ORDER BY acctstarttime DESC LIMIT 1`,
      [username],
    )
    return r.rows[0]?.acctsessionid
  } catch {
    // Without it the request still goes out on User-Name alone — no worse than before, and some
    // vendors do accept that.
    return undefined
  }
}

/** Best-effort CoA Disconnect through the router the subscriber's own company owns. Never throws. */
export async function disconnectSubscriber(username: string, managerId: string | null): Promise<void> {
  try {
    const nas = await tenantNas(managerId)
    if (!nas) return
    const nasIp = /^\d+\.\d+\.\d+\.\d+$/.test(nas.nasname) ? nas.nasname : undefined
    const acctSessionId = await liveSessionId(username)
    await sendDisconnect({
      host: nas.host, secret: nas.secret, username, nasIp, acctSessionId,
      retries: 1, timeoutMs: 800,
    })
  } catch {
    /* the subscriber drops at its own session timeout instead */
  }
}

export { liveSessionId }

/**
 * Make FreeRADIUS re-read the `nas` table.
 *
 * It loads its client list once at startup (read_clients=yes), so a router that was just deleted
 * still authenticates until this runs — which is exactly the window in which a removed company's
 * traffic would keep flowing.
 */
export async function reloadRadius(): Promise<boolean> {
  try {
    await run('systemctl', ['restart', 'radiusd'], { timeout: 30000 })
    return true
  } catch {
    return false
  }
}
