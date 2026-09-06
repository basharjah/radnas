import { query } from '../db/pool'

/**
 * Periodic traffic sampler for the dashboard "bandwidth last 24h" chart.
 *
 * Every interval we snapshot the *cumulative* octet counters of all accounting
 * rows (radacct) plus the number of active sessions. The delta between two
 * consecutive snapshots equals the traffic transferred in that interval, which
 * the /dashboard/bandwidth endpoint turns into a Mbps time-series.
 *
 * Real data only appears once a live NAS sends accounting (Interim-Update);
 * until then every sample is identical and the chart reads a flat 0 Mbps.
 */

let timer: NodeJS.Timeout | null = null

async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS traffic_samples (
      id              bigserial   PRIMARY KEY,
      sampled_at      timestamptz NOT NULL DEFAULT now(),
      active_sessions integer     NOT NULL DEFAULT 0,
      total_in_bytes  bigint      NOT NULL DEFAULT 0,
      total_out_bytes bigint      NOT NULL DEFAULT 0
    )`)
  await query(`CREATE INDEX IF NOT EXISTS idx_traffic_samples_ts ON traffic_samples(sampled_at)`)
}

async function takeSample(): Promise<void> {
  await query(`
    INSERT INTO traffic_samples (active_sessions, total_in_bytes, total_out_bytes)
    SELECT count(*) FILTER (WHERE acctstoptime IS NULL)::int,
           COALESCE(sum(acctinputoctets),  0),
           COALESCE(sum(acctoutputoctets), 0)
      FROM radacct`)
  // Keep 48h of history; the chart only needs 24h.
  await query(`DELETE FROM traffic_samples WHERE sampled_at < now() - interval '48 hours'`)
}

/** Create the table (if needed), take one sample now, then keep sampling. */
export async function startTrafficSampler(intervalMs = 5 * 60 * 1000): Promise<void> {
  await ensureTable()
  await takeSample().catch(() => {})
  timer = setInterval(() => {
    takeSample().catch(() => {})
  }, intervalMs)
  // Don't hold the process open on shutdown.
  timer.unref?.()
}

export function stopTrafficSampler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
