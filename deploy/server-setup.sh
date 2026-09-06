#!/usr/bin/env bash
# ============================================================================
# RadNas — server bootstrap for Rocky Linux 10 (ScalaHosting SSD VPS + SPanel)
# Run ONCE as root:   sudo bash server-setup.sh
# Installs: Node 20+, pm2, PostgreSQL 17, FreeRADIUS (phase 2), firewalld + SELinux rules.
# It does NOT touch SPanel's own Apache/DNS/SSL — web exposure is done in DEPLOY.md §7.
# ============================================================================
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo bash server-setup.sh)"; exit 1; }
echo "==> RadNas server setup on $(source /etc/os-release; echo "$PRETTY_NAME")"

# ---------- base packages ----------
dnf -y install epel-release || true
dnf -y install curl tar policycoreutils-python-utils openssl

# ---------- Node.js (>= 20) ----------
# Rocky 10 AppStream ships Node 22 (fine). For a specific line use NodeSource:
#   curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && dnf -y install nodejs
if ! command -v node >/dev/null 2>&1; then
  dnf -y install nodejs npm
fi
echo "node $(node -v) / npm $(npm -v)"

# ---------- pm2 process manager ----------
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

# ---------- PostgreSQL 17 (PGDG) ----------
if ! command -v psql >/dev/null 2>&1 && [ ! -x /usr/pgsql-17/bin/psql ]; then
  dnf -y install "https://download.postgresql.org/pub/repos/yum/reporpms/EL-10-x86_64/pgdg-redhat-repo-latest.noarch.rpm" || \
    echo "!! PGDG EL-10 repo not reachable — fall back to: dnf -y install postgresql-server (v16, also OK)"
  dnf -qy module disable postgresql || true
  dnf -y install postgresql17-server postgresql17-contrib
  /usr/pgsql-17/bin/postgresql-17-setup initdb
  systemctl enable --now postgresql-17
fi
systemctl is-active --quiet postgresql-17 && echo "PostgreSQL 17 running."

# ---------- FreeRADIUS (installed now, configured in phase 2 when towers connect) ----------
dnf -y install freeradius freeradius-postgresql freeradius-utils || \
  echo "!! FreeRADIUS install skipped/failed — retry later; not needed for the web panel."

# ---------- application user ----------
id radnas >/dev/null 2>&1 || useradd -m -s /bin/bash radnas
echo "app user: radnas (home /home/radnas)"

# ---------- firewall (firewalld) ----------
# NOTE: SPanel may run its OWN firewall (CSF). If ports stay blocked, open them in SPanel too.
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https --add-service=ssh
  # phase 2 (towers): RADIUS auth/acct, CoA, WireGuard
  firewall-cmd --permanent --add-port=1812/udp --add-port=1813/udp --add-port=3799/udp --add-port=51820/udp
  firewall-cmd --reload
  echo "firewalld: http/https/ssh + RADIUS/CoA/WG opened."
else
  echo "firewalld not active — SPanel likely manages the firewall; open ports there."
fi

# ---------- SELinux: allow Apache (SPanel) to reverse-proxy to the Node backend ----------
setsebool -P httpd_can_network_connect 1 || true

cat <<'NEXT'

==> Base setup complete.
Next steps (see deploy/DEPLOY.md):
  §3  create the PostgreSQL database + role
  §4  upload the code to /home/radnas/app
  §5  create backend/.env
  §6  run deploy-app.sh  (build + migrate + seed + pm2)
  §7  expose via SPanel (domain + Apache proxy + SSL)
NEXT
