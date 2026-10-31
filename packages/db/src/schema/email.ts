import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";
import { uuidPk, timestamp, timestampNow, decimal, json, textArray, boolean, date } from "./columns.js";
import { tenants } from "./tenant.js";

// Emails sent through Resend (or skipped / failed) — Admin → Settings → Email.
export const emailLogs = sqliteTable("email_logs", {
  id:         uuidPk(),
  tenantId:   text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  toEmail:    text("to_email").notNull(),
  subject:    text("subject").notNull(),
  category:   text("category").notNull(),
  status:     text("status").notNull(),
  providerId: text("provider_id"),
  error:      text("error"),
  createdAt:  timestampNow("created_at"),
}, (t) => ({
  tenantIdx: index("email_logs_tenant_idx").on(t.tenantId, t.createdAt),
}));
