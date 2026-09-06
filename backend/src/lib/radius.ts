import { query } from '../db/pool'

/**
 * MikroTik-Rate-Limit format is "rx/tx" from the ROUTER's perspective:
 *   rx = data the router receives from the client = client UPLOAD
 *   tx = data the router sends to the client     = client DOWNLOAD
 * So for a plan with download=20, upload=10 => "10M/20M".
 */
export function buildRateLimit(downloadMbps: number, uploadMbps: number): string {
  return `${uploadMbps || 0}M/${downloadMbps || 0}M`
}

/** FUP (throttled) rate in kbps, same rx/tx router perspective as buildRateLimit. */
export function buildFupRate(downloadKbps: number, uploadKbps: number): string {
  return `${uploadKbps || 0}k/${downloadKbps || 0}k`
}

interface SubRow {
  username: string
  password: string
  status: string
  static_ip: string | null
  download_mbps: number | null
  upload_mbps: number | null
  mikrotik_pool: string | null
  expired_pool: string | null
  quota_locked: boolean
  fup_active: boolean
  fup_down_kbps: number | null
  fup_up_kbps: number | null
}

/** Rewrite the FreeRADIUS radcheck/radreply rows for one subscriber from the app state. */
export async function syncSubscriberToRadius(subscriberId: string): Promise<void> {
  const r = await query<SubRow>(
    `SELECT s.username, s.password, s.status, s.static_ip, s.quota_locked, s.fup_active,
            p.download_mbps, p.upload_mbps, p.mikrotik_pool, p.expired_pool, p.fup_down_kbps, p.fup_up_kbps
       FROM subscribers s LEFT JOIN plans p ON p.id = s.plan_id
      WHERE s.id = $1`,
    [subscriberId],
  )
  const s = r.rows[0]
  if (!s) return
  const u = s.username

  await query('DELETE FROM radcheck WHERE username = $1', [u])
  await query('DELETE FROM radreply WHERE username = $1', [u])

  // Not serviceable → rejected outright:
  //  - disabled  : admin-blocked
  //  - inactive  : new account, never charged/activated yet
  //  - quota_locked: exceeded quota with 'block' behaviour
  if (s.status === 'disabled' || s.status === 'inactive' || s.quota_locked) {
    await query(`INSERT INTO radcheck (username, attribute, op, value) VALUES ($1,'Auth-Type',':=','Reject')`, [u])
    return
  }

  await query(`INSERT INTO radcheck (username, attribute, op, value) VALUES ($1,'Cleartext-Password',':=',$2)`, [u, s.password])

  // Network isolation (Option 2): bind the subscriber to its admin's NAS so a user can only
  // authenticate through their OWN company's router — not another admin's. FreeRADIUS compares the
  // request's NAS-IP-Address against this check item natively (no server config change). Applied
  // only when the governing admin owns exactly ONE IPv4 NAS; multi-NAS admins stay open here
  // (would need a huntgroup/unlang policy) so this can never falsely lock anyone out.
  const nasRows = await query<{ nasname: string }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, role FROM managers WHERE id = (SELECT manager_id FROM subscribers WHERE id = $1)
       UNION ALL
       SELECT m.id, m.parent_id, m.role FROM managers m JOIN up ON m.id = up.parent_id
     )
     SELECT n.nasname FROM nas n WHERE n.manager_id = (SELECT id FROM up WHERE role = 'admin' LIMIT 1)`,
    [subscriberId],
  )
  if (nasRows.rowCount === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(nasRows.rows[0]!.nasname)) {
    await query(`INSERT INTO radcheck (username, attribute, op, value) VALUES ($1,'NAS-IP-Address','==',$2)`, [u, nasRows.rows[0]!.nasname])
  }

  // Throttled (FUP) subscribers get the reduced kbps rate; otherwise the plan's full Mbps rate.
  if (s.fup_active && (s.fup_down_kbps || s.fup_up_kbps)) {
    await query(
      `INSERT INTO radreply (username, attribute, op, value) VALUES ($1,'Mikrotik-Rate-Limit',':=',$2)`,
      [u, buildFupRate(s.fup_down_kbps ?? 0, s.fup_up_kbps ?? 0)],
    )
  } else if (s.download_mbps || s.upload_mbps) {
    await query(
      `INSERT INTO radreply (username, attribute, op, value) VALUES ($1,'Mikrotik-Rate-Limit',':=',$2)`,
      [u, buildRateLimit(s.download_mbps ?? 0, s.upload_mbps ?? 0)],
    )
  }

  // expired -> walled-garden (expired_pool); active -> normal pool
  const pool = s.status === 'expired' ? s.expired_pool : s.mikrotik_pool
  if (pool) {
    await query(`INSERT INTO radreply (username, attribute, op, value) VALUES ($1,'Framed-Pool',':=',$2)`, [u, pool])
  }

  // optional static IP for the PPPoE session
  if (s.static_ip) {
    await query(`INSERT INTO radreply (username, attribute, op, value) VALUES ($1,'Framed-IP-Address',':=',$2)`, [u, s.static_ip])
  }
}

export async function removeSubscriberFromRadius(username: string): Promise<void> {
  await query('DELETE FROM radcheck WHERE username = $1', [username])
  await query('DELETE FROM radreply WHERE username = $1', [username])
}
