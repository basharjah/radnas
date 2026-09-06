import { query } from '../db/pool'

/**
 * Which router belongs to this account.
 *
 * Three separate features had independently reached for `SELECT ... FROM nas ORDER BY created_at
 * LIMIT 1` — the globally oldest router — which on a multi-tenant platform means "teranet's router,
 * whoever is asking". A CoA Disconnect then travelled to the wrong company's device, signed with
 * that company's secret, carrying a username from a different company: the disconnect silently never
 * happened, and a neighbour's log gained a name it had no business seeing.
 *
 * Resellers own no routers, so the lookup walks UP the parent chain: a reseller's subscriber is
 * disconnected through the admin's router above it. Tunnel-backed routers come first — a router
 * registered on an unreachable LAN address is not something to send packets at.
 */
export interface TenantNas {
  id: string
  nasname: string
  secret: string
  /** The tunnel address to actually send to, when the router is reached over WireGuard. */
  host: string
}

export async function tenantNas(managerId: string | null | undefined): Promise<TenantNas | null> {
  if (!managerId) return null
  const r = await query<{ id: string; nasname: string; secret: string; tunnel_ip: string | null }>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id, 0 AS depth FROM managers WHERE id = $1
       UNION ALL
       SELECT m.id, m.parent_id, c.depth + 1 FROM managers m JOIN chain c ON m.id = c.parent_id
     )
     SELECT n.id, n.nasname, n.secret, host(w.tunnel_ip) AS tunnel_ip
       FROM chain c
       JOIN nas n ON n.manager_id = c.id
       LEFT JOIN wireguard_peers w ON w.nas_id = n.id
      WHERE n.nasname ~ '^[0-9.]+$'
      ORDER BY c.depth, (w.id IS NULL), n.created_at
      LIMIT 1`,
    [managerId],
  )
  if (!r.rowCount) return null
  const n = r.rows[0]!
  return { id: n.id, nasname: n.nasname, secret: n.secret, host: n.tunnel_ip || n.nasname }
}
