#!/usr/bin/env bash
# Production-capable release gate; execution requires separate authorization.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?A separately authorized target is required}"
python3 scripts/migrations/hotel-release-sql.py | psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction
