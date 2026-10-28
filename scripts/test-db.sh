#!/usr/bin/env bash
# Runs every migration, the seed and the SQL tests against a throwaway local Postgres 16.
# Usage: npm run test:db        (needs Postgres 16 binaries; no Docker, no Supabase account)
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
DIR="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); chown postgres "$DIR"; fi

cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f supabase/tests/bootstrap.sql
for f in supabase/migrations/*.sql; do echo "migrate  $f"; "${PSQL[@]}" -f "$f"; done
echo "seed     supabase/seed.sql"; "${PSQL[@]}" -f supabase/seed.sql >/dev/null
for f in supabase/tests/[0-9]*.sql; do echo "test     $f"; "${PSQL[@]}" -o /dev/null -f "$f" 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  /  /"; done
echo "all database tests passed"
