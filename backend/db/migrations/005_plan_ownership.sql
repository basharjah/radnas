-- 005_plan_ownership.sql
-- Plans can now be owned by a manager (admin). Owner-created / seeded plans keep manager_id = NULL
-- and are treated as GLOBAL (visible to everyone). An admin's plans are visible to that admin and
-- its reseller subtree; resellers cannot create plans.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES managers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_plans_manager ON plans(manager_id);
