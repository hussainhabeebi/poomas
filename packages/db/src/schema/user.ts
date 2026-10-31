import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";
import { uuidPk, timestamp, timestampNow, decimal, json, textArray, boolean, date } from "./columns.js";
import { tenants } from "./tenant.js";
import { userRoleEnum, currencyEnum } from "./enums.js";

export const users = sqliteTable("users", {
  id:       uuidPk(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),

  email:        text("email"),
  phone:        text("phone"),
  name:         text("name"),
  passwordHash: text("password_hash"),
  socialProvider: text("social_provider"),
  socialSubject: text("social_subject"),
  role:         text("role", { enum: userRoleEnum }).notNull().default("CUSTOMER"),
  isActive:     boolean("is_active").notNull().default(true),

  // Staff linked to an agent account
  agentId:      text("agent_id"),   // FK to agents.id — set after agents table created

  // Admin panel staff (role STAFF): sections they may open, e.g. ["bookings", "support"].
  adminPermissions: json("admin_permissions").$type<string[]>().notNull().default([]),

  // Auth
  emailVerified:    boolean("email_verified").notNull().default(false),
  phoneVerified:    boolean("phone_verified").notNull().default(false),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  twoFactorSecret:  text("two_factor_secret"),

  // Preferences
  preferredCurrency: text("preferred_currency", { enum: currencyEnum }),
  preferredLanguage: text("preferred_language"),
  whatsappOptIn:     boolean("whatsapp_opt_in").notNull().default(false),

  lastLoginAt: timestamp("last_login_at"),
  createdAt:   timestampNow("created_at"),
  updatedAt:   timestampNow("updated_at"),
}, (t) => ({
  emailIdx: uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email),
  phoneIdx: uniqueIndex("users_tenant_phone_idx").on(t.tenantId, t.phone),
  socialIdx: uniqueIndex("users_tenant_social_idx").on(t.tenantId, t.socialProvider, t.socialSubject),
}));

export const socialAuthChallenges = sqliteTable("social_auth_challenges", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  nonce: text("nonce").notNull(),
  proofHash: text("proof_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const userSessions = sqliteTable("user_sessions", {
  id:        uuidPk(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  token:     text("token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  createdAt: timestampNow("created_at"),
}, (t) => ({
  tokenIdx: uniqueIndex("user_sessions_token_idx").on(t.token),
}));

export const savedPassengers = sqliteTable("saved_passengers", {
  id:     uuidPk(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  firstName:       text("first_name").notNull(),
  lastName:        text("last_name").notNull(),
  dob:             timestamp("dob"),
  gender:          text("gender"),
  nationality:     text("nationality"),
  passportNumber:  text("passport_number"),
  passportExpiry:  timestamp("passport_expiry"),
  passportCountry: text("passport_country"),

  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestampNow("created_at"),
  updatedAt: timestampNow("updated_at"),
});
