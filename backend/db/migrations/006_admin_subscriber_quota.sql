-- 006_admin_subscriber_quota.sql
-- SaaS licensing dimension: each admin (company/tenant) is allowed a maximum number of
-- subscribers across its whole tree (itself + its resellers). NULL = unlimited.
-- Replaces the money/balance model — activation is now "renew plan" (extend expiry), no charge.

ALTER TABLE managers ADD COLUMN IF NOT EXISTS max_subscribers integer; -- NULL = unlimited
