#!/bin/sh
# Start PocketBase, and on a brand-new database optionally create the first admin.
#
# The schema is NOT created here. It is built by pb_migrations/1699999999_bootstrap.js,
# which PocketBase applies itself on serve, so a fresh container installs its own
# database with no credentials and nothing to click.
set -eu

PB_DATA="${PB_DATA:-/pb/pb_data}"
PB_PORT="${PB_PORT:-8090}"

# `admin create` is the 0.22 spelling; it became `superuser create` in 0.23. This
# image pins 0.22, so 0.22 is what is used here.
if [ ! -f "$PB_DATA/data.db" ] && [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "==> fresh database, creating the first admin ($ADMIN_EMAIL)"
  pocketbase admin create "$ADMIN_EMAIL" "$ADMIN_PASSWORD" --dir "$PB_DATA" || \
    echo "    admin create failed; use the install link PocketBase prints below instead"
fi

exec pocketbase serve \
  --http="0.0.0.0:${PB_PORT}" \
  --dir="$PB_DATA" \
  --publicDir=/pb/pb_public \
  --hooksDir=/pb/pb_hooks \
  --migrationsDir=/pb/pb_migrations \
  "$@"
