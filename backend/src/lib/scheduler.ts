import { query } from '../db/pool'
import { syncSubscriberToRadius } from './radius'
import { audit } from './audit'
import { notify } from './notify'
import { disconnectSubscriber } from './radiusOps'

/**
 * Automation engine — runs on boot then every few minutes:
 *  1. refreshUsage    : recompute daily/monthly used-MB from radacct (time-bucketed → resets are implicit)
 *  2. expireOverdue   : active subscribers past expiry_at → 'expired' (walled-garden) + disconnect + notify
 *  3. enforceQuota    : apply/lift FUP throttle or block when usage crosses the plan quota (self-healing)
 *  4. expiryWarnings  : Telegram warning once for subscriptions expiring within 3 days
 */

let timer: NodeJS.Timeout | null = null

/** Add automation columns if missing. Idempotent; safe on every boot. */
export async function ensureAutomationSchema(): Promise<void> {
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS quota_locked   boolean NOT NULL DEFAULT false`)
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS fup_active     boolean NOT NULL DEFAULT false`)
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS expiry_warned  boolean NOT NULL DEFAULT false`)
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS bonus_quota_mb bigint  NOT NULL DEFAULT 0`)
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS bonus_expires_at timestamptz`)
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS starts_at timestamptz`)
}

/** Best-effort CoA Disconnect for a username via the first (or WireGuard-linked) NAS. Never throws. */

// Local timezone for the daily/monthly usage windows (daily resets at LOCAL midnight, e.g. 12am
// Damascus, not UTC). Override per deployment via USAGE_TZ.
const USAGE_TZ = process.env.USAGE_TZ || 'Asia/Damascus'

/** Recompute daily/monthly usage (MB) for every subscriber from radacct, bucketed by LOCAL day/month. */
/**
 * Snapshot every open session's cumulative counters the first time it is seen inside a period.
 *
 * A session that STARTED inside the period gets a zero baseline (all its traffic belongs here);
 * one that spanned the boundary is recorded at its current counters, so only traffic accrued
 * during this period counts. Accuracy at the boundary is bounded by the scheduler interval.
 */
async function captureMarks(): Promise<void> {
  for (const period of ['day', 'month'] as const) {
    await query(
      `INSERT INTO session_period_marks (acctuniqueid, period, period_start, base_bytes)
       SELECT r.acctuniqueid, $2,
              date_trunc($2, now() AT TIME ZONE $1) AT TIME ZONE $1,
              CASE WHEN r.acctstarttime >= date_trunc($2, now() AT TIME ZONE $1) AT TIME ZONE $1
                   THEN 0 ELSE r.acctinputoctets + r.acctoutputoctets END
         FROM radacct r
        WHERE r.acctstoptime IS NULL AND r.acctuniqueid IS NOT NULL
       ON CONFLICT (acctuniqueid, period, period_start) DO NOTHING`,
      [USAGE_TZ, period],
    )
  }
  // Marks are only useful for the period they belong to; keep a short tail for auditing.
  await query(`DELETE FROM session_period_marks WHERE period_start < now() - interval '40 days'`)
}

async function refreshUsage(): Promise<void> {
  await captureMarks()
  // A session counts toward the period if it STARTED in it, or if it was marked while running in
  // it (i.e. it crossed the boundary). GREATEST(0,…) absorbs router counter resets.
  const periodSum = (period: 'day' | 'month') => `
        (SELECT SUM(GREATEST(0, (r.acctinputoctets + r.acctoutputoctets) - COALESCE(m.base_bytes, 0)))
           FROM radacct r
           LEFT JOIN session_period_marks m
             ON m.acctuniqueid = r.acctuniqueid AND m.period = '${period}'
            AND m.period_start = date_trunc('${period}', now() AT TIME ZONE $1) AT TIME ZONE $1
          WHERE r.username = s2.username
            AND (r.acctstarttime >= date_trunc('${period}', now() AT TIME ZONE $1) AT TIME ZONE $1
                 OR m.acctuniqueid IS NOT NULL))`
  await query(`
    UPDATE subscribers s SET
      daily_used_mb   = COALESCE(a.day_bytes, 0) / 1048576,
      monthly_used_mb = COALESCE(a.mon_bytes, 0) / 1048576,
      updated_at      = now()
    FROM (
      SELECT s2.id,
        ${periodSum('day')}   AS day_bytes,
        ${periodSum('month')} AS mon_bytes
      FROM subscribers s2
    ) a
    WHERE a.id = s.id
  `, [USAGE_TZ])
}

/**
 * Open accounts whose scheduled start moment has arrived.
 *
 * The counterpart of expireOverdue: an operator can prepare an account with a future starts_at and
 * it lets itself in on time. Only 'inactive' rows are touched — 'disabled' is a manual override and
 * must never be undone by automation.
 */
async function openScheduled(): Promise<number> {
  const rows = (await query<{ id: string; username: string }>(
    `UPDATE subscribers SET status = 'active', updated_at = now()
      WHERE status = 'inactive'
        AND starts_at IS NOT NULL AND starts_at <= now()
        AND (expiry_at IS NULL OR expiry_at > now())
      RETURNING id, username`,
  )).rows
  for (const r of rows) {
    await syncSubscriberToRadius(r.id)
    await audit({ performedByName: 'scheduler', action: 'subscriber.opened', targetType: 'subscriber', targetId: r.username })
  }
  return rows.length
}

/** Move overdue subscribers to 'expired' (walled-garden pool) + disconnect + audit + notify. */
async function expireOverdue(): Promise<number> {
  const rows = (await query<{ id: string; username: string; manager_id: string | null }>(
    `UPDATE subscribers SET status='expired', updated_at=now()
      WHERE status='active' AND expiry_at IS NOT NULL AND expiry_at < now()
      RETURNING id, username, manager_id`,
  )).rows
  for (const r of rows) {
    await syncSubscriberToRadius(r.id)
    await disconnectSubscriber(r.username, r.manager_id)
    await audit({ performedByName: 'scheduler', action: 'subscriber.expired', targetType: 'subscriber', targetId: r.username })
    await notify({ kind: 'expired', managerId: r.manager_id, url: '/subscribers',
      title: 'انتهى اشتراك', body: `${r.username} — تم النقل للحديقة المسوّرة.` })
  }
  return rows.length
}

/** Apply or lift FUP throttle / block based on current usage vs plan quota. Self-healing each cycle. */
async function enforceQuota(): Promise<void> {
  // A lapsed bonus is zeroed rather than left lying around — otherwise the subscriber card keeps
  // advertising GB that no longer affect anything.
  await query(
    `UPDATE subscribers SET bonus_quota_mb = 0, bonus_expires_at = NULL, updated_at = now()
      WHERE bonus_expires_at IS NOT NULL AND bonus_expires_at <= now() AND bonus_quota_mb > 0`,
  )

  const rows = (await query<{
    id: string; username: string; manager_id: string | null; fup_active: boolean; quota_locked: boolean
    daily_used_mb: string; monthly_used_mb: string; bonus_quota_mb: string; bonus_live: boolean
    daily_quota: number; monthly_quota: number; fup_behavior: string
  }>(`
    SELECT s.id, s.username, s.manager_id, s.fup_active, s.quota_locked, s.daily_used_mb, s.monthly_used_mb,
           COALESCE(s.bonus_quota_mb, 0)        AS bonus_quota_mb,
           (s.bonus_expires_at IS NULL OR s.bonus_expires_at > now()) AS bonus_live,
           COALESCE(p.daily_quota_mb, 0)        AS daily_quota,
           COALESCE(p.monthly_quota_mb, 0)      AS monthly_quota,
           COALESCE(p.fup_behavior, 'throttle') AS fup_behavior
      FROM subscribers s JOIN plans p ON p.id = s.plan_id
     WHERE s.status = 'active'
       AND (COALESCE(p.daily_quota_mb, 0) > 0 OR COALESCE(p.monthly_quota_mb, 0) > 0)
  `)).rows

  for (const r of rows) {
    // Bonus (topped-up GB) stacks on the plan's monthly quota → effective allowance for the period.
    // NB: bigint columns arrive as strings from node-pg → coerce with Number() before arithmetic,
    // otherwise `+` concatenates ("1024"+0 = "10240") and the comparison silently misfires.
    const monthlyQuota = Number(r.monthly_quota), dailyQuota = Number(r.daily_quota)
    // The top-up stacks on whichever quota actually governs this plan. Applying it to the monthly
    // figure only (the old behaviour) meant a top-up did NOTHING for a daily-limited subscriber —
    // they stayed throttled no matter how many GB were sold to them.
    const bonus = r.bonus_live ? Number(r.bonus_quota_mb) : 0
    const effMonthly = monthlyQuota > 0 ? monthlyQuota + bonus : 0
    const effDaily = dailyQuota > 0 ? dailyQuota + bonus : 0
    const overMonthly = effMonthly > 0 && Number(r.monthly_used_mb) >= effMonthly
    const overDaily = effDaily > 0 && Number(r.daily_used_mb) >= effDaily
    const over = overMonthly || overDaily

    if (r.fup_behavior === 'disconnect') {
      if (over) await disconnectSubscriber(r.username, r.manager_id)
      continue
    }

    const wantBlock = over && r.fup_behavior === 'block'
    const wantFup = over && r.fup_behavior === 'throttle'
    if (Boolean(r.quota_locked) === wantBlock && Boolean(r.fup_active) === wantFup) continue

    await query('UPDATE subscribers SET quota_locked=$2, fup_active=$3, updated_at=now() WHERE id=$1', [r.id, wantBlock, wantFup])
    await syncSubscriberToRadius(r.id)
    if (wantBlock || wantFup) {
      await disconnectSubscriber(r.username, r.manager_id)
      await notify({
        kind: overMonthly ? 'monthly_quota' : 'daily_quota', managerId: r.manager_id,
        url: '/subscribers', title: 'تجاوز الحصّة',
        body: `${r.username} — ${wantBlock ? 'تم الحظر' : 'تخفيض السرعة (FUP)'}.`,
      })
      await audit({ performedByName: 'scheduler', action: wantBlock ? 'quota.block' : 'quota.throttle', targetType: 'subscriber', targetId: r.username })
    } else {
      await audit({ performedByName: 'scheduler', action: 'quota.restore', targetType: 'subscriber', targetId: r.username })
    }
  }
}

/** Warn once about subscriptions expiring within 3 days; re-arm the flag after renewal. */
async function expiryWarnings(): Promise<void> {
  const rows = (await query<{ id: string; username: string; expiry_at: string; manager_id: string | null }>(
    `SELECT id, username, expiry_at, manager_id FROM subscribers
      WHERE status='active' AND expiry_warned=false
        AND expiry_at IS NOT NULL AND expiry_at BETWEEN now() AND now() + interval '3 days'`,
  )).rows
  for (const r of rows) {
    await notify({ kind: 'expiring', managerId: r.manager_id, url: '/subscribers',
      title: 'اشتراك ينتهي قريباً',
      body: `${r.username} — ${new Date(r.expiry_at).toLocaleString('en-GB')}` })
    await query('UPDATE subscribers SET expiry_warned=true WHERE id=$1', [r.id])
  }
  await query(`UPDATE subscribers SET expiry_warned=false
                WHERE expiry_warned=true AND (expiry_at IS NULL OR expiry_at > now() + interval '3 days')`)
}

/** One full automation pass. Each step is isolated so one failure can't abort the rest. */
export async function runCycle(): Promise<void> {
  await refreshUsage().catch(() => {})
  await openScheduled().catch(() => {}) // open before expiring: a window can start and end in one cycle
  await expireOverdue().catch(() => {})
  await enforceQuota().catch(() => {})
  await expiryWarnings().catch(() => {})
}

/** Run one cycle now, then every `intervalMs` (default 10 min). */
export async function startScheduler(intervalMs = 10 * 60 * 1000): Promise<void> {
  await runCycle()
  timer = setInterval(() => {
    runCycle().catch(() => {})
  }, intervalMs)
  timer.unref?.()
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
