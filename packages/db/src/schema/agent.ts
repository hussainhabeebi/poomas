import {
  pgTable, text, boolean, decimal, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenant.js";
import { regionEnum, currencyEnum, agentStatusEnum } from "./enums.js";

export const agents = pgTable("agents", {
  id:       text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),

  businessName: text("business_name").notNull(),
  ownerName:    text("owner_name").notNull(),
  email:        text("email").notNull(),
  phone:        text("phone").notNull(),
  whatsapp:     text("whatsapp"),
  region:       regionEnum("region").notNull(),
  currency:     currencyEnum("currency").notNull(),

  status:   agentStatusEnum("status").notNull().default("PENDING"),
  iataCode: text("iata_code"),

  // Sub-agent hierarchy within a tenant
  parentAgentId: text("parent_agent_id"),  // self-referential FK

  // Finance
  creditLimit:    decimal("credit_limit",    { precision: 14, scale: 2 }).notNull().default("0"),
  minimumDeposit: decimal("minimum_deposit", { precision: 14, scale: 2 }).notNull().default("0"),

  approvedAt:    timestamp("approved_at",    { withTimezone: true }),
  approvedById:  text("approved_by_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex("agents_tenant_email_idx").on(t.tenantId, t.email),
  statusIdx: index("agents_tenant_status_idx").on(t.tenantId, t.status),
}));

export const agentDocuments = pgTable("agent_documents", {
  id:      text("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),

  docType:  text("doc_type").notNull(),   // KYC_PAN | KYC_AADHAAR | IATA_CERT | TRADE_LICENSE
  fileUrl:  text("file_url").notNull(),   // R2 object URL
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),

  uploadedAt:    timestamp("uploaded_at",    { withTimezone: true }).notNull().defaultNow(),
  verifiedAt:    timestamp("verified_at",    { withTimezone: true }),
  verifiedById:  text("verified_by_id"),
});
