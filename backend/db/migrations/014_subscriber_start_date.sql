-- Manual service window: an operator can set exactly WHEN an account opens and WHEN it closes.
--
-- expiry_at already existed but was only ever written by the renewal flow (now + plan duration);
-- there was no way to type an exact end date, and no concept of a start date at all. starts_at
-- lets an account be prepared in advance and open by itself at the chosen moment.
--
-- NULL starts_at = "already open" (every existing subscriber), so this is a no-op for current data.
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS starts_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_subscribers_starts_at ON subscribers (starts_at)
  WHERE starts_at IS NOT NULL;
