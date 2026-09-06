-- Self-signup approval needs two more manager states than the original ('active','disabled') pair:
--   pending  — created at /register, cannot log in until the owner decides
--   rejected — turned down; the username stays taken so the applicant cannot silently re-register,
--              and the decision remains auditable
-- Without this the register endpoint fails with 23514 managers_status_check.
ALTER TABLE managers DROP CONSTRAINT IF EXISTS managers_status_check;
ALTER TABLE managers ADD CONSTRAINT managers_status_check
  CHECK (status = ANY (ARRAY['active', 'disabled', 'pending', 'rejected']));
