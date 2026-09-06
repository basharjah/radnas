-- 004_radacct_acctuniqueid_unique.sql
-- FreeRADIUS 3.2.x accounting INSERT uses "ON CONFLICT (AcctUniqueId)", which requires a
-- UNIQUE index/constraint on radacct.acctuniqueid. Migration 001 originally created a plain
-- (non-unique) index → accounting failed with:
--   ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification
-- Idempotent for DBs where 001 already ran with the non-unique index.

-- Drop any duplicate acctuniqueid rows first (keep the newest), else the unique index fails.
DELETE FROM radacct a USING radacct b
  WHERE a.radacctid < b.radacctid AND a.acctuniqueid = b.acctuniqueid;

DROP INDEX IF EXISTS idx_radacct_acctuniqueid;
CREATE UNIQUE INDEX idx_radacct_acctuniqueid ON radacct(acctuniqueid);
