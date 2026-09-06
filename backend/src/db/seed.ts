import bcrypt from 'bcryptjs'
import { pool } from './pool'

async function seed(): Promise<void> {
  const username = 'owner'
  const password = process.env.OWNER_PASSWORD || 'owner12345'

  const existing = await pool.query('SELECT id FROM managers WHERE username = $1', [username])
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(password, 10)
    await pool.query(
      `INSERT INTO managers (username, password_hash, full_name, role, status)
       VALUES ($1, $2, 'System Owner', 'owner', 'active')`,
      [username, hash],
    )
    console.log(`✅ created owner  (username: ${username}  password: ${password})`)
  } else {
    console.log('ℹ owner already exists — skipping')
  }

  const { rows } = await pool.query<{ c: number }>('SELECT count(*)::int AS c FROM plans')
  if (rows[0].c === 0) {
    await pool.query(`
      INSERT INTO plans (name, type, price, download_mbps, upload_mbps, duration_value, duration_unit)
      VALUES ('eco',   'pppoe',    0, 10, 10,  1, 'days'),
             ('5M',    'pppoe', 2000,  5,  5, 30, 'days'),
             ('silver','pppoe',    0, 10,  5, 30, 'days')
    `)
    console.log('✅ inserted 3 sample plans')
  } else {
    console.log('ℹ plans already exist — skipping')
  }

  await pool.end()
}

seed().catch((err) => {
  console.error('❌ seed failed:', err)
  process.exit(1)
})
