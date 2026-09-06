-- Per-admin NAS ownership → full tenant isolation: each admin's routers (NAS) are separate from
-- other admins'. Owner sees all (labeled by admin); an admin sees/manages only its own NAS.
ALTER TABLE nas ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES managers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_nas_manager_id ON nas(manager_id);
