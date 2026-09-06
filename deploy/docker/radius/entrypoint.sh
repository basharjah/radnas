#!/bin/sh
set -e

CONF=/etc/raddb/mods-available/sql

# Inject DB credentials from env (use '#' as the sed delimiter to tolerate '/' in values;
# keep the DB password alphanumeric to avoid clashing with sed metacharacters).
sed -i \
  -e "s#__SQL_HOST__#${SQL_HOST:-host.docker.internal}#g" \
  -e "s#__SQL_PORT__#${SQL_PORT:-5432}#g" \
  -e "s#__SQL_USER__#${SQL_USER:-radnas}#g" \
  -e "s#__SQL_PASSWORD__#${SQL_PASSWORD}#g" \
  -e "s#__SQL_DB__#${SQL_DB:-radnas}#g" \
  "$CONF"

# enable the sql module (idempotent)
ln -sf ../mods-available/sql /etc/raddb/mods-enabled/sql

echo "[radnas-radius] starting FreeRADIUS (sql → ${SQL_HOST:-db}/${SQL_DB:-radnas}) ..."
# Delegate to the image's own entrypoint (it sets PATH to /opt/sbin and handles setup),
# passing the daemon args. -f foreground, -l stdout so logs reach `docker logs`.
# For verbose debugging use: exec /docker-entrypoint.sh radiusd -X
exec /docker-entrypoint.sh radiusd -f -l stdout
