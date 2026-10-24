#!/usr/bin/env bash
# Tests the exact release SQL generator in a disposable native PostgreSQL 16.
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v docker >/dev/null || { echo 'BLOCKED: Docker unavailable'; exit 1; }
name="hotel-migration-failure-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --network none -e POSTGRES_USER=fixture -e POSTGRES_PASSWORD=fixture-only -e POSTGRES_DB=hotel_preuat postgres:16-alpine >/dev/null
for n in {1..40}; do if docker exec "$name" pg_isready -U fixture -d hotel_preuat >/dev/null 2>&1; then break; fi; sleep 1; done
sql() { docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U fixture -d hotel_preuat "$@"; }
sql <<'SQL'
CREATE TABLE tenants(id text PRIMARY KEY); CREATE TABLE users(id text PRIMARY KEY);
SQL
# Missing baseline MUST fail, never replay initial schema/seeds.
if python3 scripts/migrations/hotel-release-sql.py | sql --single-transaction; then echo 'FAIL missing baseline accepted'; exit 1; fi
sql <<'SQL'
CREATE TABLE poomas_schema_migrations(name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO tenants VALUES ('fixture'); INSERT INTO users VALUES ('fixture');
SQL
# Synthetic ledger for this fixture only; NEVER a production baseline procedure.
python3 - <<'PY' | sql
from pathlib import Path
from hashlib import sha256
for f in sorted(Path('packages/db/drizzle/migrations').glob('*.sql'))[:-1]:
 print(f"INSERT INTO poomas_schema_migrations(name,sha256) VALUES ('{f.name}','{sha256(f.read_bytes()).hexdigest()}');")
PY
# Error after CREATE and ledger INSERT must roll everything back.
if { python3 scripts/migrations/hotel-release-sql.py; echo 'SELECT 1/0;'; } | sql --single-transaction; then echo 'FAIL injected error accepted'; exit 1; fi
sql <<'SQL'
DO $$ BEGIN IF to_regclass('hotel_quotes') IS NOT NULL OR to_regclass('hotel_attempts') IS NOT NULL OR EXISTS(SELECT 1 FROM poomas_schema_migrations WHERE name LIKE '0013%') THEN RAISE EXCEPTION 'partial migration survived'; END IF; END $$;
SQL
python3 scripts/migrations/hotel-release-sql.py | sql --single-transaction
sql <<'SQL'
INSERT INTO hotel_quotes(id,tenant_id,user_id,selection,snapshot,provider_booking_id,provider_scope,expires_at) VALUES ('q','fixture','fixture','{}','{}','provider-fixture','fixture',now());
INSERT INTO hotel_attempts(id,tenant_id,user_id,quote_id,idempotency_key,request_hash,provider_booking_id,mode,state) VALUES ('a','fixture','fixture','q','k','hash','provider-fixture','HOLD_UAT','UNKNOWN');
SQL
python3 scripts/migrations/hotel-release-sql.py | sql --single-transaction
sql <<'SQL'
DO $$ BEGIN IF (SELECT count(*) FROM hotel_attempts WHERE id='a' AND state='UNKNOWN' AND idempotency_key='k') <> 1 THEN RAISE EXCEPTION 'retry lost uncertain record'; END IF; END $$;
SQL
echo 'PASS missing baseline rejected, SQL failure rolled back, successful migration and repeat preserve unknown/idempotency record'
