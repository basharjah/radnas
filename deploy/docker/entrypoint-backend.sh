#!/bin/sh
set -e

echo "[radnas] waiting for external postgres at ${PGHOST}:${PGPORT:-5432} ..."
until pg_isready -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" >/dev/null 2>&1; do sleep 1; done

echo "[radnas] applying migrations ..."
npm run migrate

# Seed only once (fresh volume). On restarts the owner already exists → skip so we don't duplicate.
SEEDED=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" -tAc \
  "SELECT 1 FROM managers WHERE role='owner' LIMIT 1" 2>/dev/null || true)
if [ -z "$SEEDED" ]; then
  echo "[radnas] seeding initial owner + plans ..."
  npm run seed || echo "[radnas] seed skipped/failed (continuing)"
else
  echo "[radnas] already seeded — skipping"
fi

echo "[radnas] starting backend on :${PORT:-4000} ..."
exec npm run start
