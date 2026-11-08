import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";
import { uuidPk, timestamp, timestampNow, decimal, json, textArray, boolean, date } from "./columns.js";
import {
  regionEnum, currencyEnum, tenantPlanEnum, tenantStatusEnum, userRoleEnum,
} from "./enums.js";

export const tenants = sqliteTable("tenants", {
  id:             uuidPk(),
  name:           text("name").notNull(),
  slug:           text("slug").notNull(),                 // skyjet → skyjet.poomas.com
  customDomain:   text("custom_domain"),                  // flights.skyjetagency.com (CNAME)

  // Self-referential: a tenant can be a reseller with sub-tenants
  parentTenantId: text("parent_tenant_id"),

  status:         text("status", { enum: tenantStatusEnum }).notNull().default("ONBOARDING"),
  plan:           text("plan", { enum: tenantPlanEnum }).notNull().default("TRIAL"),

  // Region / locale defaults
  region:         text("region", { enum: regionEnum }).notNull().default("INDIA"),
  defaultCurrency: text("default_currency", { enum: currencyEnum }).notNull().default("INR"),
  defaultLanguage: text("default_language").notNull().default("en"),     // en | ml | ar

  // ── White-label branding ──
  logoUrl:        text("logo_url"),
  faviconUrl:     text("favicon_url"),
  primaryColor:   text("primary_color").notNull().default("#E31E24"),    // POOMAS red
  secondaryColor: text("secondary_color").notNull().default("#F7941D"),  // POOMAS orange
  accentColor:    text("accent_color").notNull().default("#F5C518"),     // POOMAS yellow
  fontFamily:     text("font_family").notNull().default("Inter"),
  companyName:    text("company_name"),
  tagline:        text("tagline"),

  // Controls "Powered by Poomas" badge — shown on TRIAL/STARTER, hidden on PROFESSIONAL+
  showPoweredBy:  boolean("show_powered_by").notNull().default(true),

  // ── Communication / sender identity ──
  supportEmail:    text("support_email"),
  supportPhone:    text("support_phone"),
  supportWhatsApp: text("support_whatsapp"),
  emailSenderName: text("email_sender_name"),    // "SkyJet Bookings"
  whatsappSenderId: text("whatsapp_sender_id"),  // BSP number for outbound WA

  // ── Content ──
  homeBannerConfig: json("home_banner_config"),
  footerConfig:     json("footer_config"),
  homepageRoutes:   json("homepage_routes"),

  // ── Legal ──
  gstNumber:    text("gst_number"),
  vatNumber:    text("vat_number"),
  iataCode:     text("iata_code"),
  address:      text("address"),
  termsUrl:     text("terms_url"),
  privacyUrl:   text("privacy_url"),

  // ── Feature flags ──
  allowB2C:           boolean("allow_b2c").notNull().default(true),
  allowB2B:           boolean("allow_b2b").notNull().default(true),
  allowWhatsApp:      boolean("allow_whatsapp").notNull().default(false),
  allowGroupBooking:  boolean("allow_group_booking").notNull().default(false),
  allowSeatSelection: boolean("allow_seat_selection").notNull().default(false),

  // ── Tenant-level API rate limits (enforced via Durable Objects) ──
  searchRpmLimit:  integer("search_rpm_limit").notNull().default(60),
  bookingRpmLimit: integer("booking_rpm_limit").notNull().default(20),

  // ── Payment gateway config (null = inherit platform defaults) ──
  paymentConfig: json("payment_config"),   // { razorpay: {...}, nomod: {...} }

  // ── Billing (Poomas charges this tenant/reseller) ──
  subscriptionFee:    decimal("subscription_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  perBookingFee:      decimal("per_booking_fee",  { precision: 14, scale: 4 }).notNull().default("0"),
  perBookingFeeType:  text("per_booking_fee_type").notNull().default("PERCENTAGE"),
  billingCycleDay:    integer("billing_cycle_day").notNull().default(1),
  trialEndsAt:        timestamp("trial_ends_at"),
  subscriptionEndsAt: timestamp("subscription_ends_at"),

  // ── Usage metering ── (reset monthly by a scheduled Worker)
  usageCurrentMonth: json("usage_current_month"),   // { searchCalls, bookings, waMessages }
  usageResetAt:      timestamp("usage_reset_at"),

  // ── Setup ──
  onboardingStep:  integer("onboarding_step").notNull().default(0),
  isSetupComplete: boolean("is_setup_complete").notNull().default(false),

  createdAt: timestampNow("created_at"),
  updatedAt: timestampNow("updated_at"),
}, (t) => ({
  slugIdx:         uniqueIndex("tenants_slug_idx").on(t.slug),
  customDomainIdx: uniqueIndex("tenants_custom_domain_idx").on(t.customDomain),
}));

export const tenantApiKeys = sqliteTable("tenant_api_keys", {
  id:           uuidPk(),
  tenantId:     text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),

  name:         text("name").notNull(),
  keyHash:      text("key_hash").notNull(),    // argon2 hash — never stored in plain text
  keyPrefix:    text("key_prefix").notNull(),  // first 8 chars shown in UI ("pmsk_abc1...")
  scopes:       textArray("scopes"),

  isActive:     boolean("is_active").notNull().default(true),
  lastUsedAt:   timestamp("last_used_at"),
  expiresAt:    timestamp("expires_at"),

  createdAt:    timestampNow("created_at"),
  revokedAt:    timestamp("revoked_at"),
  revokedById:  text("revoked_by_id"),
}, (t) => ({
  keyHashIdx: uniqueIndex("tenant_api_keys_hash_idx").on(t.keyHash),
}));

export const announcements = sqliteTable("announcements", {
  id:         uuidPk(),
  tenantId:   text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),

  title:      text("title").notNull(),
  content:    text("content").notNull(),
  type:       text("type").notNull().default("INFO"),     // INFO | WARNING | SUCCESS | ALERT
  targetRole: text("target_role", { enum: userRoleEnum }),                // null = all roles
  isActive:   boolean("is_active").notNull().default(true),

  createdAt:  timestampNow("created_at"),
  expiresAt:  timestamp("expires_at"),
});

export const subscriptionInvoices = sqliteTable("subscription_invoices", {
  id:          uuidPk(),
  tenantId:    text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),

  periodStart: timestamp("period_start").notNull(),
  periodEnd:   timestamp("period_end").notNull(),

  subscriptionFee: decimal("subscription_fee", { precision: 14, scale: 2 }).notNull(),
  transactionFees: decimal("transaction_fees", { precision: 14, scale: 2 }).notNull(),
  totalAmount:     decimal("total_amount",     { precision: 14, scale: 2 }).notNull(),
  currency:        text("currency", { enum: currencyEnum }).notNull(),

  status:     text("status").notNull().default("DRAFT"),  // DRAFT|SENT|PAID|OVERDUE
  paidAt:     timestamp("paid_at"),
  paymentRef: text("payment_ref"),
  lineItems:  json("line_items").notNull(),

  createdAt:  timestampNow("created_at"),
  updatedAt:  timestampNow("updated_at"),
});

export const webhookConfigs = sqliteTable("webhook_configs", {
  id:        uuidPk(),
  tenantId:  text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),

  name:      text("name").notNull(),
  url:       text("url").notNull(),
  secret:    text("secret"),     // Used to sign payloads (HMAC-SHA256)
  events:    textArray("events"),
  isActive:  boolean("is_active").notNull().default(true),

  createdAt: timestampNow("created_at"),
  updatedAt: timestampNow("updated_at"),
});
