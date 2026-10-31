import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { uuidPk, timestamp, timestampNow, decimal, json, textArray, boolean, date } from "./columns.js";
import { tenants } from "./tenant.js";
import { agents } from "./agent.js";
import { users } from "./user.js";
import { bookings } from "./booking.js";
import {
  currencyEnum, paymentGatewayEnum, paymentStatusEnum, walletTxTypeEnum,
} from "./enums.js";

export const payments = sqliteTable("payments", {
  id:        uuidPk(),
  bookingId: text("booking_id").notNull().references(() => bookings.id),

  gateway:          text("gateway", { enum: paymentGatewayEnum }).notNull(),
  gatewayOrderId:   text("gateway_order_id"),
  gatewayPaymentId: text("gateway_payment_id"),

  amount:          decimal("amount",   { precision: 14, scale: 2 }).notNull(),
  currency:        text("currency", { enum: currencyEnum }).notNull(),
  status:          text("status", { enum: paymentStatusEnum }).notNull().default("PENDING"),
  paymentMethod:   text("payment_method"),      // card | upi | netbanking | wallet
  gatewayResponse: json("gateway_response"),   // Raw webhook payload for reconciliation

  refundedAmount:    decimal("refunded_amount",    { precision: 14, scale: 2 }),
  refundInitiatedAt: timestamp("refund_initiated_at"),
  refundCompletedAt: timestamp("refund_completed_at"),
  refundGatewayRef:  text("refund_gateway_ref"),

  createdAt: timestampNow("created_at"),
  updatedAt: timestampNow("updated_at"),
}, (t) => ({
  gatewayPaymentIdx: uniqueIndex("payments_gateway_payment_id_idx").on(t.gatewayPaymentId),
  // One wallet payment per booking, so a double-submit cannot charge the wallet twice.
  walletBookingIdx: uniqueIndex("payments_wallet_booking_idx").on(t.bookingId).where(sql`gateway = 'WALLET'`),
}));

export const walletAccounts = sqliteTable("wallet_accounts", {
  id:       uuidPk(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId:  text("agent_id").references(() => agents.id),
  userId:   text("user_id").references(() => users.id, { onDelete: "cascade" }),  // customer wallet

  currency:        text("currency", { enum: currencyEnum }).notNull(),
  balance:         decimal("balance",      { precision: 14, scale: 2 }).notNull().default("0"),
  creditLimit:     decimal("credit_limit", { precision: 14, scale: 2 }).notNull().default("0"),
  alertThreshold:  decimal("alert_threshold", { precision: 14, scale: 2 }),

  createdAt: timestampNow("created_at"),
  updatedAt: timestampNow("updated_at"),
}, (t) => ({
  agentIdx: uniqueIndex("wallet_accounts_agent_id_idx").on(t.agentId),
  userIdx:  uniqueIndex("wallet_accounts_user_id_idx").on(t.userId),
}));

// Customer-to-customer balance sharing: the amount leaves the creator's wallet
// when the code is created and lands in the redeemer's wallet on redemption.
export const walletCoupons = sqliteTable("wallet_coupons", {
  id:              uuidPk(),
  tenantId:        text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code:            text("code").notNull(),
  amount:          decimal("amount", { precision: 14, scale: 2 }).notNull(),
  currency:        text("currency", { enum: currencyEnum }).notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  walletAccountId: text("wallet_account_id").notNull().references(() => walletAccounts.id),
  status:          text("status").notNull().default("ACTIVE"),  // ACTIVE | REDEEMED | CANCELLED | EXPIRED
  redeemedByUserId: text("redeemed_by_user_id").references(() => users.id),
  redeemedAt:      timestamp("redeemed_at"),
  expiresAt:       timestamp("expires_at").notNull(),
  createdAt:       timestampNow("created_at"),
}, (t) => ({
  codeIdx:    uniqueIndex("wallet_coupons_tenant_code_idx").on(t.tenantId, t.code),
}));

export const walletTransactions = sqliteTable("wallet_transactions", {
  id:              uuidPk(),
  walletAccountId: text("wallet_account_id").notNull().references(() => walletAccounts.id),

  type:          text("type", { enum: walletTxTypeEnum }).notNull(),
  amount:        decimal("amount",        { precision: 14, scale: 2 }).notNull(),
  balanceBefore: decimal("balance_before",{ precision: 14, scale: 2 }).notNull(),
  balanceAfter:  decimal("balance_after", { precision: 14, scale: 2 }).notNull(),

  bookingId:    text("booking_id"),
  paymentId:    text("payment_id"),    // Gateway payment ref for topups
  note:         text("note"),
  performedById: text("performed_by_id"),

  createdAt: timestampNow("created_at"),
});

export const commissions = sqliteTable("commissions", {
  id:        uuidPk(),
  bookingId: text("booking_id").notNull().references(() => bookings.id),
  agentId:   text("agent_id").notNull().references(() => agents.id),

  baseAmount:   decimal("base_amount",    { precision: 14, scale: 2 }).notNull(),
  ratePercent:  decimal("rate_percent",   { precision: 8,  scale: 4 }).notNull(),
  amount:       decimal("amount",         { precision: 14, scale: 2 }).notNull(),
  currency:     text("currency", { enum: currencyEnum }).notNull(),

  paidAt:  timestamp("paid_at"),
  paidVia: text("paid_via"),   // WALLET | BANK_TRANSFER

  createdAt: timestampNow("created_at"),
}, (t) => ({
  bookingIdx: uniqueIndex("commissions_booking_id_idx").on(t.bookingId),
}));
