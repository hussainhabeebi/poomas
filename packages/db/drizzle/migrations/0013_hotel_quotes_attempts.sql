-- Additive PostgreSQL migration. Apply only after approval; no existing records changed.
CREATE TABLE hotel_quotes (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id),
 user_id text NOT NULL REFERENCES users(id), selection jsonb NOT NULL, snapshot jsonb NOT NULL,
 provider_booking_id text NOT NULL, provider_scope text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hotel_quotes_provider_idx ON hotel_quotes(tenant_id, provider_scope, provider_booking_id);
CREATE TABLE hotel_attempts (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), user_id text NOT NULL REFERENCES users(id),
 quote_id text NOT NULL REFERENCES hotel_quotes(id), idempotency_key text NOT NULL, request_hash text NOT NULL,
 provider_booking_id text NOT NULL, state text NOT NULL DEFAULT 'PREPARING', mode text NOT NULL,
 confirmation_started_at timestamptz, cancellation_started_at timestamptz,
 outcome jsonb, checks integer NOT NULL DEFAULT 0, next_check_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT hotel_attempts_checks_valid CHECK (checks >= 0)
);
CREATE UNIQUE INDEX hotel_attempts_key_idx ON hotel_attempts(tenant_id, user_id, idempotency_key);
CREATE UNIQUE INDEX hotel_attempts_quote_idx ON hotel_attempts(quote_id);
CREATE INDEX hotel_attempts_owner_idx ON hotel_attempts(tenant_id, user_id, created_at);
CREATE UNIQUE INDEX hotel_attempts_provider_idx ON hotel_attempts(tenant_id, provider_booking_id);
