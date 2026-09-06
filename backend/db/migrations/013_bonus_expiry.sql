-- Data top-ups on a DAILY-quota plan must expire with the day they were bought for.
--
-- Before this, bonus_quota_mb was only ever cleared on renewal. That is right for a monthly plan,
-- but on a daily plan it would hand the subscriber the same extra GB every single day, forever.
-- NULL keeps the old behaviour (monthly bonus, cleared on renewal); a timestamp makes the bonus
-- lapse on its own.
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS bonus_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_subscribers_bonus_expires ON subscribers (bonus_expires_at)
  WHERE bonus_expires_at IS NOT NULL;
