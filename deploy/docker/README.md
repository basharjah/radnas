# RadNas — Docker packaging

A complete, self-contained RadNas **tenant stack** in containers:

| Service   | Image / build            | Role |
|-----------|--------------------------|------|
| `db`      | postgres:17-alpine       | app data + FreeRADIUS tables (radcheck/radacct/nas…) |
| `backend` | Dockerfile.backend       | Fastify API (tsx). Runs migrations + seed on first boot |
| `web`     | Dockerfile.web           | Vite build served by nginx; reverse-proxies `/api` → backend |
| `radius`  | Dockerfile.radius        | FreeRADIUS 3.2 reading the same PostgreSQL |

This is the foundation of the **instance-per-tenant** model: one `docker compose` project = one isolated company (its own DB, RADIUS, and data). It does **not** touch the live `radnas.com` deployment.

---

## Quick start (single stack)

```bash
cd deploy/docker
cp .env.example .env          # then edit DB_PASSWORD + JWT_SECRET
docker compose up -d --build
```

- Panel:   http://localhost:8080  (login `owner` / `owner12345` — change it immediately)
- RADIUS:  auth `udp/1812`, accounting `udp/1813`, CoA `udp/3799`

Logs / stop:
```bash
docker compose logs -f backend
docker compose logs -f radius
docker compose down            # keep data
docker compose down -v         # wipe data (destroys the tenant)
```

---

## One isolated stack **per company** (instance-per-tenant)

Give each company its own project name, env file, and **unique host ports**:

```bash
cp .env.example acme.env       # set WEB_PORT=8081, RADIUS_AUTH_PORT=1822, ... unique per tenant
docker compose -p acme --env-file acme.env up -d --build

cp .env.example globex.env     # WEB_PORT=8082, RADIUS_AUTH_PORT=1832, ...
docker compose -p globex --env-file globex.env up -d --build
```

Docker namespaces volumes/networks by project, so `acme` and `globex` share **nothing**. Put a
front reverse proxy (Caddy/nginx/Traefik) mapping `acme.radnas.com → :8081`, `globex.radnas.com → :8082`,
and point each company's MikroTik at that tenant's RADIUS ports (directly, or over WireGuard).

Offboard a company cleanly:
```bash
docker compose -p acme --env-file acme.env down -v
```

---

## Notes & first-run tuning

- **Boot order** is handled: `db` (healthcheck) → `backend` (migrate + seed, healthcheck) → `radius`
  starts only after the tables exist.
- **Seed** runs once (fresh volume). The default owner is `owner`/`owner12345` — the provisioning
  layer (next phase) will inject each company's own owner instead.
- **DB password**: keep it alphanumeric — it is substituted into the FreeRADIUS `sql` config.
- **FreeRADIUS**: the `sql` module mirrors the live server (postgresql, `read_clients=yes`,
  `client_table=nas`, standard queries). Verify on first run with:
  ```bash
  docker compose exec radius freeradius -CX     # config check
  docker compose logs radius
  ```
  If the `eap` module blocks startup (missing certs), it is unused for PPPoE PAP — you can disable it
  (`rm mods-enabled/eap`) in a small image tweak; kept enabled here to match stock config.
- **CoA/disconnect** from the app targets the router on `udp/3799`; the router reaches this stack's
  RADIUS the same way it does today (public IP or WireGuard tunnel).

## What this is NOT (yet)
- No control plane / provisioning automation (spinning tenants up on signup) — that is the next phase.
- No payment/billing gateway.
- No TLS here — terminate HTTPS at the front reverse proxy.
