// Enum value lists (Postgres enum types replaced by CHECK-free TEXT columns on D1).
// Use with: text("status", { enum: bookingStatusEnum })

export const regionEnum = ["INDIA", "GCC"] as const;
export const currencyEnum = ["INR", "AED", "USD"] as const;
export const tenantPlanEnum = ["TRIAL", "STARTER", "PROFESSIONAL", "ENTERPRISE"] as const;
export const tenantStatusEnum = ["ONBOARDING", "ACTIVE", "SUSPENDED", "TRIAL_EXPIRED", "CLOSED"] as const;
export const userRoleEnum = [
  "SUPER_ADMIN", "TENANT_ADMIN", "AGENT_ADMIN", "AGENT_STAFF", "AGENT_ACCOUNTANT", "CUSTOMER",
  "STAFF", // admin-panel staff: only the sections in users.admin_permissions
] as const;
export const agentStatusEnum = ["PENDING", "APPROVED", "SUSPENDED", "REJECTED"] as const;
export const bookingStatusEnum = [
  "SEARCHED", "HELD", "PAYMENT_PENDING", "PAYMENT_FAILED", "CONFIRMED", "TICKETED",
  "CANCELLED", "REFUND_PENDING", "REFUNDED", "REISSUED",
] as const;
export const bookingChannelEnum = ["B2C_WEB", "B2B_PORTAL", "WHATSAPP_BOT", "OFFLINE"] as const;
export const supplierNameEnum = ["RIYA", "TRIPJACK", "GOOGLE_SERP", "DUFFEL"] as const;
export const paymentGatewayEnum = ["RAZORPAY", "NOMOD", "WALLET", "MANUAL"] as const;
export const paymentStatusEnum = ["PENDING", "SUCCESS", "FAILED", "REFUNDED", "PARTIAL_REFUND"] as const;
export const walletTxTypeEnum = [
  "TOPUP", "BOOKING_DEBIT", "REFUND_CREDIT", "ADJUSTMENT", "COMMISSION_CREDIT", "SUBSCRIPTION_DEBIT",
  "BOOKING_BONUS", "ADMIN_CREDIT", "COUPON_DEBIT", "COUPON_CREDIT", "COUPON_REFUND",
] as const;
export const cabinClassEnum = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const;
export const tripTypeEnum = ["ONEWAY", "ROUNDTRIP", "MULTICITY"] as const;
