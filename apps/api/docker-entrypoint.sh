#!/bin/sh
# RaftNow API container entrypoint.
# Applies pending database migrations (idempotent) before starting the server.
# With several replicas, run migrations as a one-off job and set RUN_MIGRATIONS=false.
set -e
SCHEMA=/app/apps/api/prisma/schema.prisma

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy"
  if ! OUT=$(npx prisma migrate deploy --schema "$SCHEMA" 2>&1); then
    echo "$OUT"
    # Legacy repair: the old "00_constraints" migration ran before any table
    # existed and always failed (relation "slots" does not exist), leaving a
    # failed record that blocks all later migrations (P3009). It applied
    # nothing, so marking it rolled back is safe. It no longer exists on disk.
    if echo "$OUT" | grep -q "P3009" && echo "$OUT" | grep -q "00_constraints"; then
      echo "[entrypoint] resolving legacy failed migration 00_constraints as rolled back"
      npx prisma migrate resolve --rolled-back 00_constraints --schema "$SCHEMA"
      npx prisma migrate deploy --schema "$SCHEMA"
    else
      echo "[entrypoint] migrations failed — refusing to start"
      exit 1
    fi
  else
    echo "$OUT" | tail -n 3
  fi
fi

# Hosted demo (render.yaml): load the idempotent seed so the site has data.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] prisma db seed"
  npx prisma db seed --schema "$SCHEMA" || echo "[entrypoint] seed failed — starting without demo data"
fi
exec node /app/apps/api/dist/main.js
