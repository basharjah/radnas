import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { query } from '../db/pool'
import { authenticate } from '../plugins/auth'
import { deny } from '../lib/permissions'

const DEFAULT_WG = { server_tunnel_ip: '10.10.10.1', endpoint: 'SET_YOUR_SERVER_IP:51820', server_public_key: '' }

async function getServer(): Promise<Record<string, unknown>> {
  const r = await query<{ value: Record<string, unknown> }>(`SELECT value FROM settings WHERE key = 'wireguard'`)
  return { ...DEFAULT_WG, ...(r.rows[0]?.value ?? {}) }
}

const peerSchema = z.object({
  name: z.string().min(1),
  public_key: z.string().min(1),
  tunnel_ip: z.string().optional(),
  allowed_ips: z.string().optional(),
  nas_id: z.string().uuid().nullable().optional(),
})

function nextTunnelIp(used: string[]): string {
  let max = 1 // .1 reserved for the server
  for (const ip of used) {
    const m = /(\d+)$/.exec(ip.split('/')[0]!)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `10.10.10.${max + 1}`
}

export const wireguardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/server', { preHandler: authenticate }, async () => getServer())

  app.put('/server', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    const body = (req.body ?? {}) as Record<string, unknown>
    const merged = { ...(await getServer()), ...body }
    await query(
      `INSERT INTO settings (key, value) VALUES ('wireguard', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [JSON.stringify(merged)],
    )
    return merged
  })

  // Peers ARE the platform's tunnel topology — every tenant's public key and tunnel address.
  // Creating and deleting were already owner-only; listing must be too.
  app.get('/', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    const res = await query(
      `SELECT w.id, w.name, w.type, w.public_key, host(w.tunnel_ip) AS tunnel_ip, w.allowed_ips,
              w.nas_id, w.last_handshake, w.created_at, n.shortname AS nas_name
         FROM wireguard_peers w LEFT JOIN nas n ON n.id = w.nas_id
        ORDER BY w.created_at`,
    )
    return { data: res.rows }
  })

  app.post('/', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner'])) return
    const parsed = peerSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    const b = parsed.data
    let tunnelIp = b.tunnel_ip
    if (!tunnelIp) {
      const used = (await query<{ ip: string }>('SELECT host(tunnel_ip) AS ip FROM wireguard_peers WHERE tunnel_ip IS NOT NULL')).rows.map((r) => r.ip)
      tunnelIp = nextTunnelIp(used)
    }
    const res = await query<{ id: string }>(
      `INSERT INTO wireguard_peers (name, type, public_key, tunnel_ip, allowed_ips, nas_id)
       VALUES ($1,'mikrotik',$2,$3,$4,$5) RETURNING id`,
      [b.name, b.public_key, tunnelIp, b.allowed_ips ?? `${tunnelIp}/32`, b.nas_id ?? null],
    )
    return reply.code(201).send({ id: res.rows[0]!.id, tunnel_ip: tunnelIp })
  })

  const deletePeer = async (req: FastifyRequest, reply: FastifyReply) => {
    if (deny(req, reply, ['owner'])) return
    const { id } = req.params as { id: string }
    const res = await query('DELETE FROM wireguard_peers WHERE id = $1 RETURNING id', [id])
    if (res.rowCount === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  }
  app.delete('/:id', { preHandler: authenticate }, deletePeer)
  app.post('/:id/delete', { preHandler: authenticate }, deletePeer)
}
