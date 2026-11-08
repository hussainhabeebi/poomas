-- D1 (SQLite) logs database: high-volume tables moved out of Neon.
-- Timestamps are Unix epoch milliseconds; JSON columns are text.

CREATE TABLE IF NOT EXISTS supplier_api_logs (
  id               TEXT PRIMARY KEY NOT NULL,
  tenant_id        TEXT NOT NULL,
  supplier         TEXT NOT NULL,
  endpoint         TEXT NOT NULL,
  http_status      INTEGER,
  level            TEXT NOT NULL DEFAULT 'INFO',
  request_id       TEXT,
  request_summary  TEXT,
  response_snippet TEXT,
  error_code       TEXT,
  error_message    TEXT,
  duration_ms      INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS supplier_api_logs_tenant_time_idx ON supplier_api_logs (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS supplier_api_logs_level_idx ON supplier_api_logs (tenant_id, level, created_at);

CREATE TABLE IF NOT EXISTS supplier_exchanges (
  id           TEXT PRIMARY KEY NOT NULL,
  tenant_id    TEXT NOT NULL,
  booking_id   TEXT,
  search_id    TEXT,
  request_id   TEXT,
  supplier     TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  url          TEXT NOT NULL,
  http_status  INTEGER,
  duration_ms  INTEGER,
  error        TEXT,
  request_key  TEXT NOT NULL,
  response_key TEXT,
  started_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS supplier_exchanges_tenant_time_idx ON supplier_exchanges (tenant_id, started_at);
CREATE INDEX IF NOT EXISTS supplier_exchanges_booking_idx ON supplier_exchanges (booking_id);
CREATE INDEX IF NOT EXISTS supplier_exchanges_search_idx ON supplier_exchanges (search_id);

CREATE TABLE IF NOT EXISTS email_logs (
  id          TEXT PRIMARY KEY NOT NULL,
  tenant_id   TEXT,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  category    TEXT NOT NULL,
  status      TEXT NOT NULL,
  provider_id TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_logs_tenant_idx ON email_logs (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS agent_activity_daily (
  agent_id   TEXT NOT NULL,
  day        TEXT NOT NULL,
  tenant_id  TEXT NOT NULL,
  searches   INTEGER NOT NULL DEFAULT 0,
  checkouts  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, day)
);
CREATE INDEX IF NOT EXISTS agent_activity_daily_tenant_idx ON agent_activity_daily (tenant_id, day);
