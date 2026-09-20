-- Keep every notification, so one that arrived while the phone was off is not simply lost.
--
-- Until now notify() only transmitted: web push and Telegram, both fire-and-forget. An operator
-- whose phone was off, or who had not enabled push, had no way to learn that a company signed up or
-- a subscriber burned through their quota — the event existed for the instant it was sent and then
-- ceased to exist anywhere.
--
-- One row per RECIPIENT rather than per event, because "read" is a property of the person, not of
-- the event: an admin marking a signup read must not clear it for the owner.
CREATE TABLE IF NOT EXISTS notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id   uuid NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  url          text,
  -- The account the event was ABOUT, which is not always the recipient: a reseller's alert also
  -- reaches the admin above it, and that admin wants to know whose subscriber it was.
  subject_id   uuid REFERENCES managers(id) ON DELETE SET NULL,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The one query the panel and the app both run: this recipient's newest first.
CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON notifications (manager_id, created_at DESC);

-- Counting unread must not scan the whole history, and a partial index stays small because most
-- rows become read.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (manager_id) WHERE read_at IS NULL;
