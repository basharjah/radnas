import type { FastifyPluginAsync } from 'fastify'
import { spawn } from 'node:child_process'
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { authenticate } from '../plugins/auth'
import { query } from '../db/pool'
import { env } from '../env'
import { deny, roleOf } from '../lib/permissions'
import { managerScope } from '../lib/scope'

const BACKUP_DIR = resolve('backups')
const PG_DUMP = process.env.PG_DUMP || 'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe'

async function ensureDir(): Promise<void> {
  await mkdir(BACKUP_DIR, { recursive: true })
}

/** File-name prefix that scopes a backup to its creator. Owner → full system dumps; others → own tenant export. */
const tenantPrefix = (id: string) => `tenant_${id}_`

export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (req) => {
    await ensureDir()
    const owner = roleOf(req) === 'owner'
    const all = await readdir(BACKUP_DIR)
    // Owner sees every backup; an admin sees ONLY its own tenant exports (isolation).
    const files = all.filter((f) =>
      owner ? (f.endsWith('.sql') || f.endsWith('.json')) : f.startsWith(tenantPrefix(req.user.sub)),
    )
    const out: Array<{ name: string; size: number; created_at: string }> = []
    for (const f of files) {
      const s = await stat(join(BACKUP_DIR, f))
      out.push({ name: f, size: s.size, created_at: s.mtime.toISOString() })
    }
    out.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return { data: out, dir: BACKUP_DIR }
  })

  app.post('/', { preHandler: authenticate }, async (req, reply) => {
    if (deny(req, reply, ['owner', 'admin'])) return
    await ensureDir()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')

    // Owner → full database dump (all tenants).
    if (roleOf(req) === 'owner') {
      const name = `system_${ts}.sql`
      const file = join(BACKUP_DIR, name)
      const ok = await new Promise<boolean>((res) => {
        const p = spawn(PG_DUMP, ['-d', env.DATABASE_URL, '-f', file, '--no-owner', '--clean'], { windowsHide: true })
        p.on('error', () => res(false))
        p.on('close', (code) => res(code === 0))
      })
      if (!ok) return reply.code(500).send({ error: 'pg_dump_failed', hint: `set PG_DUMP env if pg_dump path differs from ${PG_DUMP}` })
      const s = await stat(file)
      return reply.code(201).send({ name, size: s.size })
    }

    // Admin → tenant-scoped JSON export of OWN data only (subscribers/plans/nas/managers in the subtree).
    const scope = await managerScope(req.user.sub, roleOf(req))
    const ids = scope.ids
    const [subs, plans, nas, mgrs] = await Promise.all([
      query('SELECT id, username, password, full_name, phone, address, plan_id, connection_type, manager_id, static_ip, status, expiry_at FROM subscribers WHERE manager_id = ANY($1::uuid[])', [ids]),
      query('SELECT id, name, type, price, download_mbps, upload_mbps, duration_value, duration_unit, daily_quota_mb, monthly_quota_mb, fup_down_kbps, fup_up_kbps, fup_behavior, mikrotik_pool, expired_pool, manager_id FROM plans WHERE manager_id = ANY($1::uuid[])', [ids]),
      query('SELECT id, nasname, shortname, type, ports, secret, description, manager_id FROM nas WHERE manager_id = ANY($1::uuid[])', [ids]),
      query('SELECT id, username, full_name, phone, email, role, parent_id, max_subscribers, status FROM managers WHERE id = ANY($1::uuid[])', [ids]),
    ])
    const data = {
      exported_at: new Date().toISOString(),
      tenant: req.user.username,
      counts: { subscribers: subs.rowCount, plans: plans.rowCount, nas: nas.rowCount, managers: mgrs.rowCount },
      subscribers: subs.rows, plans: plans.rows, nas: nas.rows, managers: mgrs.rows,
    }
    const name = `${tenantPrefix(req.user.sub)}${ts}.json`
    const file = join(BACKUP_DIR, name)
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8')
    const s = await stat(file)
    return reply.code(201).send({ name, size: s.size })
  })

  app.get('/:name/download', { preHandler: authenticate }, async (req, reply) => {
    const { name } = req.params as { name: string }
    const owner = roleOf(req) === 'owner'
    const valid = /^system_[\w.-]+\.sql$/.test(name) || /^tenant_[\w.-]+\.json$/.test(name)
    if (!valid) return reply.code(400).send({ error: 'bad_name' })
    // An admin may only download its own tenant files; owner may download any.
    if (!owner && !name.startsWith(tenantPrefix(req.user.sub))) return reply.code(403).send({ error: 'forbidden' })
    const path = join(BACKUP_DIR, name)
    if (!resolve(path).startsWith(BACKUP_DIR)) return reply.code(400).send({ error: 'bad_path' })
    reply.header('Content-Disposition', `attachment; filename="${name}"`)
    reply.type(name.endsWith('.json') ? 'application/json' : 'application/sql')
    return reply.send(createReadStream(path))
  })
}
