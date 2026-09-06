-- Per-tenant Telegram, so a company's alerts reach that company.
--
-- Telegram lived in a single global `settings` row: one bot, one list of chat ids, owner-only. Web
-- push was rebuilt to route by tenant, which left the two channels unequal — a company heard nothing
-- about its own subscribers while the platform owner received four companies' alerts interleaved.
--
-- Shape: {"chat_ids": "123,-100456", "bot_token": "enc:v1:…"}
--   chat_ids  — where this account wants its alerts
--   bot_token — OPTIONAL, encrypted. Absent means "send through the platform bot", which is the
--               path most tenants will take: they only have to supply a chat id.
ALTER TABLE managers ADD COLUMN IF NOT EXISTS telegram jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Carry the existing global recipients onto the owner's own row, so the platform's current alerts
-- keep arriving after the switch instead of going quiet until someone notices.
UPDATE managers m
   SET telegram = jsonb_build_object('chat_ids', s.value ->> 'admin_chat_ids')
  FROM settings s
 WHERE s.key = 'telegram'
   AND m.role = 'owner'
   AND COALESCE(s.value ->> 'admin_chat_ids', '') <> ''
   AND COALESCE(m.telegram ->> 'chat_ids', '') = '';
