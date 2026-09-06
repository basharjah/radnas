-- Per-subscriber bonus data allowance (GB top-ups) stacked ON TOP of the plan's monthly quota.
-- Lets an operator sell extra data when a quota subscriber burns through their bundle before the
-- period ends; the scheduler compares usage against (plan.monthly_quota_mb + bonus_quota_mb), so a
-- top-up automatically lifts the FUP throttle. Reset to 0 on renewal (fresh period).
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS bonus_quota_mb bigint NOT NULL DEFAULT 0;
