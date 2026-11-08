import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";
import { uuidPk, timestamp, timestampNow, decimal, json, textArray, boolean, date } from "./columns.js";
import { tenants } from "./tenant.js";
import { users } from "./user.js";
import { userRoleEnum } from "./enums.js";

// Audit logs are tenant-isolated — no cross-tenant leakage, enforced at query layer
export const auditLogs = sqliteTable("audit_logs", {
  id:       uuidPk(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId:   text("user_id").references(() => users.id),

  action:   text("action").notNull(),    // BOOKING_CREATED | AGENT_APPROVED | WALLET_ADJUSTED | ...
  entity:   text("entity").notNull(),    // Booking | Agent | WalletAccount | Tenant | ...
  entityId: text("entity_id"),

  before:    json("before"),   // State snapshot before action (for PII access logs too)
  after:     json("after"),    // State snapshot after action

  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata:  json("metadata"),

  createdAt: timestampNow("created_at"),
}, (t) => ({
  entityIdx: index("audit_logs_entity_idx").on(t.tenantId, t.entity, t.entityId),
  userIdx:   index("audit_logs_user_idx").on(t.tenantId, t.userId),
  timeIdx:   index("audit_logs_time_idx").on(t.tenantId, t.createdAt),
}));
