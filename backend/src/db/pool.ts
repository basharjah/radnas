import pg from 'pg'
import { env } from '../env'

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL })

/** Run a parameterized query. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as unknown[])
}

/** Lightweight connectivity check for /health/db. */
export async function ping(): Promise<boolean> {
  const res = await pool.query<{ ok: number }>('SELECT 1 AS ok')
  return res.rows[0]?.ok === 1
}
