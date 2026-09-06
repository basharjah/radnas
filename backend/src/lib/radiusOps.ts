import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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

/** Best-effort CoA Disconnect through the router the subscriber's own company owns. Never throws. */
export async function disconnectSubscriber(username: string, managerId: string | null): Promise<void> {
  try {
    const nas = await tenantNas(managerId)
    if (!nas) return
    const nasIp = /^\d+\.\d+\.\d+\.\d+$/.test(nas.nasname) ? nas.nasname : undefined
    await sendDisconnect({ host: nas.host, secret: nas.secret, username, nasIp, retries: 1, timeoutMs: 800 })
  } catch {
    /* the subscriber drops at its own session timeout instead */
  }
}

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
