-- When a router's credentials last changed.
--
-- The shared secret cannot be verified by reading it back: RouterOS returns `*****` over REST and
-- never the real value. The only honest proof is behavioural — has the server accepted a request
-- from this router SINCE its secret last changed? A router that has accepted nothing since is
-- holding the old secret, which is the one fault that produces no log line anywhere: the packet
-- fails its Message-Authenticator check and is dropped in silence.
--
-- That question needs a timestamp for the change, and the table only had created_at.
ALTER TABLE nas ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Existing rows: treat creation as the last change, which is true for every router provisioned
-- automatically — re-provisioning replaces the row rather than editing it.
--
-- Unconditional on purpose. `DEFAULT now()` has already stamped every existing row with the migration
-- time, so a guard like `WHERE updated_at < created_at` can never be true and would leave every
-- router looking as though its secret had just changed — reporting a healthy link as broken.
UPDATE nas SET updated_at = created_at;
