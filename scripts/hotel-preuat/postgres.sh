#!/usr/bin/env bash
# Disposable native PostgreSQL only. Never accepts a connection string.
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v docker >/dev/null || { echo 'BLOCKED: Docker is required; nothing executed.'; exit 1; }
name="poomas-hotel-preuat-${RANDOM}-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# No published ports, no host volumes, no production credentials, no network.
docker run --name "$name" --network none -e POSTGRES_DB=hotel_preuat -e POSTGRES_USER=fixture -e POSTGRES_PASSWORD=local-fixture-only -d postgres:16-alpine >/dev/null
for n in {1..40}; do
  if docker exec "$name" pg_isready -U fixture -d hotel_preuat >/dev/null 2>&1; then break; fi
  sleep 1
done
sql() { docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U fixture -d hotel_preuat "$@"; }
# Minimal parent contracts only; this does NOT validate the complete legacy schema.
sql <<'SQL'
CREATE TABLE tenants(id text PRIMARY KEY);
CREATE TABLE users(id text PRIMARY KEY);
INSERT INTO tenants VALUES ('fixture-tenant');
INSERT INTO users VALUES ('fixture-owner');
SQL
sql --single-transaction < packages/db/drizzle/migrations/0013_hotel_quotes_attempts.sql
sql < scripts/hotel-preuat/postgres-checks.sql
# Two independent PostgreSQL sessions contend for exactly the same attempt.
claim="INSERT INTO hotel_attempts(id,tenant_id,user_id,quote_id,idempotency_key,request_hash,provider_booking_id,mode,state) VALUES ('parallel','fixture-tenant','fixture-owner','q1','same-key','hash','provider-1','HOLD_UAT','SUBMITTING') ON CONFLICT DO NOTHING;"
printf '%s\n' "$claim" | sql > /tmp/"$name"-a.log & a=$!
printf '%s\n' "${claim/parallel/parallel-b}" | sql > /tmp/"$name"-b.log & b=$!
wait "$a"; wait "$b"
rm -f /tmp/"$name"-{a,b}.log
sql <<'SQL'
DO $$ BEGIN IF (SELECT count(*) FROM hotel_attempts) <> 1 THEN RAISE EXCEPTION 'duplicate claim'; END IF; END $$;
-- Isolate each uniqueness guarantee: distinct primary keys and other fields.
INSERT INTO hotel_quotes(id,tenant_id,user_id,selection,snapshot,provider_booking_id,provider_scope,expires_at)
 SELECT 'q2',tenant_id,user_id,selection,snapshot,'provider-2',provider_scope,expires_at FROM hotel_quotes WHERE id='q1';
DO $$ BEGIN
 BEGIN
  INSERT INTO hotel_attempts(id,tenant_id,user_id,quote_id,idempotency_key,request_hash,provider_booking_id,mode)
  VALUES ('dup-key','fixture-tenant','fixture-owner','q2','same-key','h','provider-2','HOLD_UAT');
  RAISE EXCEPTION 'idempotency key not unique';
 EXCEPTION WHEN unique_violation THEN
  IF SQLERRM NOT LIKE '%hotel_attempts_key_idx%' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO hotel_attempts(id,tenant_id,user_id,quote_id,idempotency_key,request_hash,provider_booking_id,mode)
  VALUES ('dup-quote','fixture-tenant','fixture-owner','q1','different-key','h','provider-2','HOLD_UAT');
  RAISE EXCEPTION 'quote not unique';
 EXCEPTION WHEN unique_violation THEN
  IF SQLERRM NOT LIKE '%hotel_attempts_quote_idx%' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO hotel_attempts(id,tenant_id,user_id,quote_id,idempotency_key,request_hash,provider_booking_id,mode)
  VALUES ('dup-provider','fixture-tenant','fixture-owner','q2','different-key','h','provider-1','HOLD_UAT');
  RAISE EXCEPTION 'provider reference not unique';
 EXCEPTION WHEN unique_violation THEN
  IF SQLERRM NOT LIKE '%hotel_attempts_provider_idx%' THEN RAISE; END IF;
 END;
END $$;
-- Real DB recovery lease claimed by worker A. Admin intent invalidates its response.
UPDATE hotel_attempts SET checks=1, next_check_at=now()+interval '60 seconds' WHERE idempotency_key='same-key' AND state='SUBMITTING' AND checks=0 AND confirmation_started_at IS NULL AND cancellation_started_at IS NULL;
UPDATE hotel_attempts SET state='CANCELLATION_PENDING',cancellation_started_at=now() WHERE idempotency_key='same-key' AND state='SUBMITTING' AND cancellation_started_at IS NULL;
UPDATE hotel_attempts SET state='SUCCESS' WHERE idempotency_key='same-key' AND state='SUBMITTING' AND checks=1 AND confirmation_started_at IS NULL AND cancellation_started_at IS NULL;
DO $$ BEGIN IF (SELECT state FROM hotel_attempts WHERE idempotency_key='same-key') <> 'CANCELLATION_PENDING' THEN RAISE EXCEPTION 'stale recovery write'; END IF; END $$;
SQL
# Full database process restart; no application memory survives.
docker restart "$name" >/dev/null
for n in {1..40}; do
  if docker exec "$name" pg_isready -U fixture -d hotel_preuat >/dev/null 2>&1; then break; fi
  sleep 1
done
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT state FROM hotel_attempts WHERE idempotency_key='same-key') <> 'CANCELLATION_PENDING' OR (SELECT checks FROM hotel_attempts WHERE idempotency_key='same-key') <> 1 THEN RAISE EXCEPTION 'restart lost intent'; END IF;
END $$;
-- Lookup only after an uncertain send. Never execute supplier Book here.
SELECT id,state,checks,confirmation_started_at IS NOT NULL AS confirmed_intent,cancellation_started_at IS NOT NULL AS cancel_intent FROM hotel_attempts;
-- Disposable rollback rehearsal. Never drop populated production tables.
BEGIN;
DROP TABLE hotel_attempts;
DROP TABLE hotel_quotes;
ROLLBACK;
DO $$ BEGIN IF to_regclass('hotel_attempts') IS NULL OR (SELECT count(*) FROM hotel_attempts) <> 1 THEN RAISE EXCEPTION 'rollback recovery failed'; END IF; END $$;
SQL
echo 'PASS: isolated PostgreSQL migration, constraints, parallel claim, stale-write guard, restart persistence and transactional rollback.'
echo 'Still required: application-worker integration against an isolated PostgreSQL-compatible adapter; this SQL harness makes no supplier calls.'
