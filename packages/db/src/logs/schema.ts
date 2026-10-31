// High-volume operational logs kept in Cloudflare D1 (SQLite), not Neon.
// Written on every search / supplier call — keeping them out of Postgres lets the
// Neon compute scale to zero between real bookings. Bookings, payments, wallets,
// users, agents and tenants stay in Neon.
import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());

// TripJack / supplier API call logs — Admin → Supplier Logs.
export const supplierApiLogs = sqliteTable("supplier_api_logs", {
  id:              id(),
  tenantId:        text("tenant_id").notNull(),
  supplier:        text("supplier", { enum: ["TRIPJACK", "RIYA", "DUFFEL", "GOOGLE_SERP"] }).notNull(),
  endpoint:        text("endpoint").notNull(),
  httpStatus:      integer("http_status"),
  level:           text("level").notNull().default("INFO"),
  requestId:       text("request_id"),
  requestSummary:  text("request_summary", { mode: "json" }),
  responseSnippet: text("response_snippet"),
  errorCode:       text("error_code"),
  errorMessage:    text("error_message"),
  durationMs:      integer("duration_ms"),
  createdAt:       createdAt(),
}, (t) => ({
  tenantTimeIdx: index("supplier_api_logs_tenant_time_idx").on(t.tenantId, t.createdAt),
  levelIdx:      index("supplier_api_logs_level_idx").on(t.tenantId, t.level, t.createdAt),
}));

// Raw supplier API exchanges (request + response files in R2) for certification logs.
export const supplierExchanges = sqliteTable("supplier_exchanges", {
  id:          id(),
  tenantId:    text("tenant_id").notNull(),
  bookingId:   text("booking_id"),
  searchId:    text("search_id"),
  requestId:   text("request_id"),
  supplier:    text("supplier").notNull(),
  endpoint:    text("endpoint").notNull(),
  url:         text("url").notNull(),
  httpStatus:  integer("http_status"),
  durationMs:  integer("duration_ms"),
  error:       text("error"),
  requestKey:  text("request_key").notNull(),
  responseKey: text("response_key"),
  startedAt:   integer("started_at", { mode: "timestamp_ms" }).notNull(),
  createdAt:   createdAt(),
}, (t) => ({
  tenantTimeIdx: index("supplier_exchanges_tenant_time_idx").on(t.tenantId, t.startedAt),
  bookingIdx:    index("supplier_exchanges_booking_idx").on(t.bookingId),
  searchIdx:     index("supplier_exchanges_search_idx").on(t.searchId),
}));

// Emails sent through Resend (or skipped / failed) — Admin → Settings → Email.
export const emailLogs = sqliteTable("email_logs", {
  id:         id(),
  tenantId:   text("tenant_id"),
  toEmail:    text("to_email").notNull(),
  subject:    text("subject").notNull(),
  category:   text("category").notNull(),
  status:     text("status").notNull(),
  providerId: text("provider_id"),
  error:      text("error"),
  createdAt:  createdAt(),
}, (t) => ({
  tenantIdx: index("email_logs_tenant_idx").on(t.tenantId, t.createdAt),
}));

// Leadvyne agency searches / checkout links, tallied per UTC day (YYYY-MM-DD).
export const agentActivityDaily = sqliteTable("agent_activity_daily", {
  agentId:   text("agent_id").notNull(),
  day:       text("day").notNull(),
  tenantId:  text("tenant_id").notNull(),
  searches:  integer("searches").notNull().default(0),
  checkouts: integer("checkouts").notNull().default(0),
}, (t) => ({
  pk:        primaryKey({ columns: [t.agentId, t.day] }),
  tenantIdx: index("agent_activity_daily_tenant_idx").on(t.tenantId, t.day),
}));
