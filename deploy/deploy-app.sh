#!/usr/bin/env bash
# ============================================================================
# RadNas — build & run the app.  Run as the 'radnas' user:
#     su - radnas
#     cd ~/app/deploy && bash deploy-app.sh
# Assumes the code is at ~/app  (so ~/app/backend and ~/app/frontend exist)
# and backend/.env already created from deploy/.env.production.example.
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/app}"
[ -d "$APP_DIR/backend" ] || { echo "Not found: $APP_DIR/backend — set APP_DIR or upload the code first"; exit 1; }

echo "==> [1/4] Backend dependencies"
cd "$APP_DIR/backend"
[ -f .env ] || { echo "!! backend/.env is missing. Copy deploy/.env.production.example -> backend/.env and edit it."; exit 1; }
npm ci

echo "==> [2/4] Apply DB migrations + seed the owner login (idempotent-ish; seed only once)"
npm run migrate
npm run seed || echo "   (seed skipped/failed — likely already seeded; that's fine)"

echo "==> [3/4] Build the frontend (outputs frontend/dist)"
cd "$APP_DIR/frontend"
npm ci
npm run build

echo "==> [4/4] Start the backend under pm2 (:4000)"
cd "$APP_DIR/backend"
pm2 delete radnas >/dev/null 2>&1 || true
pm2 start npm --name radnas -- run start
pm2 save

cat <<'NEXT'

==> App is up. Backend listening on 127.0.0.1:4000 ; frontend built at frontend/dist.
To keep pm2 running after reboot (run the printed command as root, once):
    pm2 startup systemd -u radnas --hp /home/radnas
    # then again:  pm2 save

Now expose it (DEPLOY.md §7): in SPanel add your domain, set docroot to
frontend/dist, add the Apache reverse-proxy (deploy/apache-radnas-proxy.conf.example),
and issue a free SSL certificate.
NEXT
