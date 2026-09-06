-- 003_subscriber_lifecycle.sql
-- (a) radacct IPv6 columns required by FreeRADIUS 3.2.x default postgresql accounting
--     query — idempotent, covers DBs where 001 was applied before these were added.
-- (b) subscriber lifecycle: add 'inactive' (new, not-yet-charged) status so a fresh
--     subscriber is NOT serviceable until it is charged/activated.

ALTER TABLE radacct
  ADD COLUMN IF NOT EXISTS framedipv6address   inet,
  ADD COLUMN IF NOT EXISTS framedipv6prefix    inet,
  ADD COLUMN IF NOT EXISTS framedinterfaceid   text,
  ADD COLUMN IF NOT EXISTS delegatedipv6prefix inet;

ALTER TABLE subscribers DROP CONSTRAINT IF EXISTS subscribers_status_check;
ALTER TABLE subscribers ADD CONSTRAINT subscribers_status_check
  CHECK (status IN ('active', 'disabled', 'expired', 'inactive'));

-- New subscribers start life uncharged; the charge/activate action flips them to 'active'.
ALTER TABLE subscribers ALTER COLUMN status SET DEFAULT 'inactive';
