-- Browser push subscriptions, one row per device that opted in.
--
-- Standard Web Push (VAPID) rather than Firebase: the product is a web app, so FCM would add a
-- Google dependency and a heavy client SDK for exactly the same delivery on Chrome, Edge, Firefox
-- and installed-PWA Safari.
--
-- The endpoint URL is the device's address and is unique per subscription, so it is the natural key:
-- a browser that re-subscribes hands back the same endpoint and must update its row, not add one.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id  uuid        NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  endpoint    text        NOT NULL UNIQUE,
  p256dh      text        NOT NULL,          -- the device's public key, from the browser
  auth        text        NOT NULL,          -- the device's auth secret, from the browser
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  fail_count  integer     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subs_manager ON push_subscriptions (manager_id);

-- Which kinds each account wants. Absent key = wanted, so a new event type reaches people by
-- default instead of being silently withheld until someone finds the setting.
ALTER TABLE managers ADD COLUMN IF NOT EXISTS notify_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
