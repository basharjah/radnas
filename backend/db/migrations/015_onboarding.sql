-- First-run guide for a newly approved company.
--
-- Only the dismissal is stored: every step's completion is derived live from the account's own data
-- (does it own a plan? a NAS? any subscribers?), so the checklist can never claim a step is done
-- when it isn't, and it keeps working if the operator deletes something and has to redo it.
ALTER TABLE managers ADD COLUMN IF NOT EXISTS onboarding_dismissed_at timestamptz;
