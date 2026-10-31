import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { uuidPk, timestamp, timestampNow, decimal, json, textArray, boolean, date } from "./columns.js";
import { tenants } from "./tenant.js";
import { users } from "./user.js";
import { agents } from "./agent.js";
import {
  bookingStatusEnum, bookingChannelEnum, supplierNameEnum,
  cabinClassEnum, tripTypeEnum, currencyEnum,
} from "./enums.js";

export const bookings = sqliteTable("bookings", {
  id:       uuidPk(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),

  // Booker identity — one of these is set
  userId:  text("user_id").references(() => users.id),
  agentId: text("agent_id").references(() => agents.id),

  channel: text("channel", { enum: bookingChannelEnum }).notNull(),
  status:  text("status", { enum: bookingStatusEnum }).notNull().default("SEARCHED"),

  // Itinerary
  tripType:      text("trip_type", { enum: tripTypeEnum }).notNull(),
  cabinClass:    text("cabin_class", { enum: cabinClassEnum }).notNull().default("ECONOMY"),
  origin:        text("origin").notNull(),         // IATA airport code
  destination:   text("destination").notNull(),
  departureDate: timestamp("departure_date").notNull(),
  returnDate:    timestamp("return_date"),

  // Full normalized fare snapshot at time of booking (never changes after CONFIRMED)
  flightData: json("flight_data").notNull(),

  // Passengers
  adultCount:  integer("adult_count").notNull().default(1),
  childCount:  integer("child_count").notNull().default(0),
  infantCount: integer("infant_count").notNull().default(0),

  // Pricing (all in `currency`)
  baseFare:       decimal("base_fare",       { precision: 14, scale: 2 }).notNull(),
  taxes:          decimal("taxes",           { precision: 14, scale: 2 }).notNull(),
  markup:         decimal("markup",          { precision: 14, scale: 2 }).notNull().default("0"),
  convenienceFee: decimal("convenience_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  promoDiscount:  decimal("promo_discount",  { precision: 14, scale: 2 }).notNull().default("0"),
  platformFee:    decimal("platform_fee",    { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount:    decimal("total_amount",    { precision: 14, scale: 2 }).notNull(),
  currency:       text("currency", { enum: currencyEnum }).notNull(),

  // Supplier
  supplier:          text("supplier", { enum: supplierNameEnum }).notNull(),
  supplierBookingRef: text("supplier_booking_ref"),
  supplierSessionId:  text("supplier_session_id"),  // For session-based auth flows
  pnr:               text("pnr"),
  ticketNumbers:     textArray("ticket_numbers"),

  // GST (India domestic)
  gstApplicable: boolean("gst_applicable").notNull().default(false),
  gstNumber:     text("gst_number"),
  gstDetails:    json("gst_details"),

  // Add-ons (Phase 2)
  addOns: json("add_ons"),

  // Promo
  promoCodeId: text("promo_code_id"),  // FK to promo_codes

  // B2B hold
  heldUntil: timestamp("held_until"),

  // Group booking reference
  groupRef: text("group_ref"),

  // Contact for confirmation delivery
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),

  // Request metadata
  ipAddress:     text("ip_address"),
  userAgent:     text("user_agent"),
  whatsappPhone: text("whatsapp_phone"),  // Set when channel = WHATSAPP_BOT

  createdAt: timestampNow("created_at"),
  updatedAt: timestampNow("updated_at"),
  // Set once the ₹50 customer booking bonus is credited (guards against double credit)
  walletBonusCreditedAt: timestamp("wallet_bonus_credited_at"),
}, (t) => ({
  tenantStatusIdx: index("bookings_tenant_status_idx").on(t.tenantId, t.status),
  tenantAgentIdx:  index("bookings_tenant_agent_idx").on(t.tenantId, t.agentId),
  pnrIdx:          index("bookings_pnr_idx").on(t.pnr),
  groupRefIdx:     index("bookings_group_ref_idx").on(t.groupRef),
}));

export const bookingPassengers = sqliteTable("booking_passengers", {
  id:        uuidPk(),
  bookingId: text("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),

  passengerType: text("passenger_type").notNull(),  // ADULT | CHILD | INFANT
  title:         text("title"),
  firstName:     text("first_name").notNull(),
  lastName:      text("last_name").notNull(),
  dob:           timestamp("dob"),
  gender:        text("gender"),
  nationality:   text("nationality"),

  passportNumber:  text("passport_number"),
  passportExpiry:  timestamp("passport_expiry"),
  passportCountry: text("passport_country"),

  ticketNumber: text("ticket_number"),
  seatNumber:   text("seat_number"),
  mealCode:     text("meal_code"),

  createdAt: timestampNow("created_at"),
});

export const cancellationRequests = sqliteTable("cancellation_requests", {
  id:        uuidPk(),
  bookingId: text("booking_id").notNull().references(() => bookings.id),

  reason:          text("reason"),
  requestedById:   text("requested_by_id"),
  status:          text("status").notNull().default("PENDING"),  // PENDING|APPROVED|REJECTED|PROCESSED

  supplierPenalty: decimal("supplier_penalty", { precision: 14, scale: 2 }),
  tenantPenalty:   decimal("tenant_penalty",   { precision: 14, scale: 2 }),
  refundAmount:    decimal("refund_amount",     { precision: 14, scale: 2 }),

  requestedAt:   timestampNow("requested_at"),
  processedAt:   timestamp("processed_at"),
  processedById: text("processed_by_id"),
  notes:         text("notes"),
});

export const reissueRequests = sqliteTable("reissue_requests", {
  id:        uuidPk(),
  bookingId: text("booking_id").notNull().references(() => bookings.id),

  newDepartureDate: timestamp("new_departure_date"),
  newReturnDate:    timestamp("new_return_date"),
  newOrigin:        text("new_origin"),
  newDestination:   text("new_destination"),
  reason:           text("reason"),
  requestedById:    text("requested_by_id"),
  status:           text("status").notNull().default("PENDING"),

  dateDiffFare:     decimal("date_diff_fare",    { precision: 14, scale: 2 }),
  supplierPenalty:  decimal("supplier_penalty",  { precision: 14, scale: 2 }),
  tenantPenalty:    decimal("tenant_penalty",    { precision: 14, scale: 2 }),
  totalDue:         decimal("total_due",         { precision: 14, scale: 2 }),

  requestedAt:   timestampNow("requested_at"),
  processedAt:   timestamp("processed_at"),
  processedById: text("processed_by_id"),
});

// Post-booking changes requested with the supplier (currently TripJack cancellations).
export const bookingAmendments = sqliteTable("booking_amendments", {
  id:        uuidPk(),
  tenantId:  text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bookingId: text("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  userId:    text("user_id").references(() => users.id),
  type:      text("type").notNull().default("CANCELLATION"),
  status:    text("status").notNull().default("SUBMITTED"),  // SUBMITTED | PROCESSING | SUCCESS | REJECTED | FAILED
  supplier:  text("supplier").notNull().default("TRIPJACK"),
  supplierAmendmentId: text("supplier_amendment_id"),
  supplierStatus:      text("supplier_status"),
  amountPaid:      decimal("amount_paid",      { precision: 14, scale: 2 }).notNull(),
  supplierCharges: decimal("supplier_charges", { precision: 14, scale: 2 }),
  refundAmount:    decimal("refund_amount",    { precision: 14, scale: 2 }),
  currency:        text("currency", { enum: currencyEnum }).notNull(),
  refundMethod:    text("refund_method").notNull().default("WALLET"),  // original payment method: WALLET | NOMOD | MANUAL
  refundStatus:    text("refund_status").notNull().default("PENDING"), // PENDING | PROCESSING | DONE | FAILED | MANUAL_REQUIRED
  refundReference: text("refund_reference"),
  refundError:     text("refund_error"),
  refundedAt:      timestamp("refunded_at"),
  quote:                json("quote"),
  lastSupplierResponse: json("last_supplier_response"),
  adminNote:     text("admin_note"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestampNow("created_at"),
  updatedAt: timestampNow("updated_at"),
}, (t) => ({
  // Only one live cancellation per booking (double-submit protection).
  oneActiveCancelIdx: uniqueIndex("booking_amendments_one_active_cancel_idx").on(t.bookingId)
    .where(sql`type = 'CANCELLATION' AND status IN ('SUBMITTED', 'PROCESSING', 'SUCCESS')`),
}));

export const supportRequests = sqliteTable("support_requests", {
  id:        uuidPk(),
  tenantId:  text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId:    text("user_id").references(() => users.id),
  bookingId: text("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  type:      text("type").notNull(),     // DATE_CHANGE | ADD_BAGGAGE | MEAL_SEAT | NAME_CORRECTION | CANCELLATION_HELP | OTHER
  message:   text("message").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  status:    text("status").notNull().default("OPEN"),  // OPEN | IN_PROGRESS | RESOLVED | CLOSED
  adminNote: text("admin_note"),
  createdAt: timestampNow("created_at"),
  updatedAt: timestampNow("updated_at"),
});
