// Converts rows exported from Neon (one JSON object per line on stdin, via psql
// `select row_to_json(t) ...`) into INSERT statements for the D1 logs database.
// Usage: node logs-backfill-sql.mjs <table> < rows.jsonl > rows.sql
// INSERT OR IGNORE keeps it safe to re-run: rows already in D1 are left alone.
import { createInterface } from "node:readline";

const COLUMNS = {
  supplier_api_logs: ["id", "tenant_id", "supplier", "endpoint", "http_status", "level", "request_id", "request_summary", "response_snippet", "error_code", "error_message", "duration_ms", "created_at"],
  supplier_exchanges: ["id", "tenant_id", "booking_id", "search_id", "request_id", "supplier", "endpoint", "url", "http_status", "duration_ms", "error", "request_key", "response_key", "started_at", "created_at"],
  email_logs: ["id", "tenant_id", "to_email", "subject", "category", "status", "provider_id", "error", "created_at"],
  agent_activity_daily: ["agent_id", "day", "tenant_id", "searches", "checkouts"],
};
const TIMESTAMPS = new Set(["created_at", "started_at"]);

const table = process.argv[2];
const cols = COLUMNS[table];
if (!cols) throw new Error(`Unknown table ${table}`);

const literal = (col, v) => {
  if (v === null || v === undefined) return "NULL";
  if (TIMESTAMPS.has(col)) return String(Date.parse(v));
  if (typeof v === "number") return String(v);
  if (typeof v === "object") v = JSON.stringify(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  process.stdout.write(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => literal(c, row[c])).join(", ")});\n`);
}
