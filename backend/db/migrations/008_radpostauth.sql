-- 008_radpostauth.sql
-- FreeRADIUS writes an auth-attempt record via the post-auth SQL query. This table was created
-- by hand on the live server but was never in the migrations, so a fresh DB (e.g. a Docker tenant)
-- lacked it — the post-auth INSERT failed → FreeRADIUS switched to Post-Auth-Type REJECT and
-- rejected otherwise-valid logins. Create it here (idempotent) so every install has it.

CREATE TABLE IF NOT EXISTS radpostauth (
  id               bigserial PRIMARY KEY,
  username         text NOT NULL DEFAULT '',
  pass             text,
  reply            text,
  calledstationid  text,
  callingstationid text,
  authdate         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_radpostauth_username ON radpostauth(username);
