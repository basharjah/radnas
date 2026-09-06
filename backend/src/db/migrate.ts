import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pool } from './pool'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../../db/migrations')

async function run(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id serial PRIMARY KEY,
        name text UNIQUE NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    )

    let count = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(join(migrationsDir, file), 'utf8')
      console.log(`▶ applying ${file} ...`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file])
        await client.query('COMMIT')
        count++
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    console.log(count ? `✅ applied ${count} migration(s).` : '✅ up to date — nothing to apply.')
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((err) => {
  console.error('❌ migration failed:', err)
  process.exit(1)
})
