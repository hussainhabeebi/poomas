#!/usr/bin/env bash
# One-time: dump every table from the old Neon Postgres database as JSON.
# Usage: DATABASE_URL='postgres://…neon.tech/…' ./scripts/neon-export.sh
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the Neon connection string}"
cd "$(dirname "$0")/.."
mkdir -p neon-export
tables=$(psql "$DATABASE_URL" -At -c "select tablename from pg_tables where schemaname = 'public' order by 1")
for t in $tables; do
  psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 \
    -c "select coalesce(json_agg(t), '[]'::json) from \"$t\" t" > "neon-export/$t.json"
  echo "exported $t ($(wc -c < "neon-export/$t.json") bytes)"
done
echo "Done. Next: pnpm --filter @poomas/db import:sql"
