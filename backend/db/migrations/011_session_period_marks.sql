-- Correct daily/monthly usage attribution for sessions that span a period boundary.
--
-- radacct stores CUMULATIVE per-session counters, so the old query (acctstarttime >= day start)
-- excluded any session that began before midnight — daily_used_mb read 0 for every long-lived
-- session. That is not just a display bug: enforceQuota reads the same column, so FUP throttling
-- and quota blocking silently did nothing for those subscribers.
--
-- Fix: snapshot a session's counters the first time it is observed inside a period. Usage for the
-- period is then (current counters - snapshot). A session that STARTED inside the period gets a
-- zero baseline, so all of its traffic counts.
CREATE TABLE IF NOT EXISTS session_period_marks (
  acctuniqueid text        NOT NULL,
  period       text        NOT NULL CHECK (period IN ('day', 'month')),
  period_start timestamptz NOT NULL,
  base_bytes   bigint      NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (acctuniqueid, period, period_start)
);

CREATE INDEX IF NOT EXISTS idx_spm_period ON session_period_marks (period, period_start);
