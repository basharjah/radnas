-- One source of truth for a customer's subscriber network.
--
-- It was written twice and independently: as `AllowedIPs` on the tunnel (what the server will carry)
-- and as a hardcoded default in the PPPoE script (what the router hands out). Nothing kept the two
-- in step, so VIENNA.NET ended up with a pool the tunnel silently refused to route — the router
-- answered, its subscribers did not, and there was no error anywhere to explain it.
--
-- The old default, 10.0.0.0/24, was also a poor choice: `10.0.0.1` is already a live PPP local
-- address on these operators' routers, so the gateway the script suggested collided on arrival.
ALTER TABLE wireguard_peers ADD COLUMN IF NOT EXISTS pool_cidr text NOT NULL DEFAULT '10.10.0.0/24';

-- Existing tunnels keep the network their customers actually use — changing these would cut live
-- subscribers off. Only new provisioning gets the safer default.
UPDATE wireguard_peers SET pool_cidr = '10.0.0.0/24'  WHERE iface = 'wg0';
UPDATE wireguard_peers SET pool_cidr = '10.10.12.0/24' WHERE iface = 'wg2';
UPDATE wireguard_peers SET pool_cidr = '10.0.0.0/24'  WHERE iface = 'wg3';
