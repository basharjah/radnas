-- 007_company_signup.sql
-- Self-service company signup: a company registers and becomes an admin account (its own tree),
-- with a chosen subscriber tier (free = 4). Store the company name.

ALTER TABLE managers ADD COLUMN IF NOT EXISTS company text;
