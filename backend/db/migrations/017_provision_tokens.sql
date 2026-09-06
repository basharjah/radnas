-- One-paste router provisioning.
--
-- The router fetches a .rsc script that configures its tunnel, RADIUS client and CoA in one go.
-- That script necessarily contains the tenant's WireGuard private key and RADIUS secret, so the
-- URL is protected the only way a URL can be: an unguessable token that dies on first use and
-- expires quickly. Every fetch is recorded with its address.
CREATE TABLE IF NOT EXISTS provision_tokens (
  token       text        PRIMARY KEY,
  nas_id      uuid        NOT NULL REFERENCES nas(id)      ON DELETE CASCADE,
  manager_id  uuid                 REFERENCES managers(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  used_ip     inet,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provision_tokens_nas ON provision_tokens (nas_id);

-- The peer's private key, so the script can be generated without an operator copying it by hand.
-- Stored through lib/secretbox (AES-256-GCM), never in plain text, and never returned by any list
-- endpoint — only the single-use provisioning script may reveal it.
ALTER TABLE wireguard_peers ADD COLUMN IF NOT EXISTS client_private_key text;

-- Tunnel endpoint details live PER PEER, not in one global setting: with a tunnel per customer
-- each peer has its own server key, port and subnet, and a single shared row cannot describe them.
ALTER TABLE wireguard_peers ADD COLUMN IF NOT EXISTS server_public_key text;
ALTER TABLE wireguard_peers ADD COLUMN IF NOT EXISTS endpoint          text;
ALTER TABLE wireguard_peers ADD COLUMN IF NOT EXISTS listen_port       integer;
ALTER TABLE wireguard_peers ADD COLUMN IF NOT EXISTS iface             text;
