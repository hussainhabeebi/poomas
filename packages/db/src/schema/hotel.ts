import { pgTable, text, timestamp, jsonb, integer, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.js';
import { users } from './user.js';

// Hotel records deliberately do not use flight-specific bookings columns.
// No guest identities, payment credentials or raw supplier payloads are stored here.
export const hotelQuotes = pgTable('hotel_quotes', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  userId: text('user_id').notNull().references(() => users.id),
  selection: jsonb('selection').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  providerBookingId: text('provider_booking_id').notNull(),
  providerScope: text('provider_scope').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ provider: index('hotel_quotes_provider_idx').on(t.tenantId, t.providerScope, t.providerBookingId) }));

export const hotelAttempts = pgTable('hotel_attempts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  userId: text('user_id').notNull().references(() => users.id),
  quoteId: text('quote_id').notNull().references(() => hotelQuotes.id),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  providerBookingId: text('provider_booking_id').notNull(),
  state: text('state').notNull().default('PREPARING'),
  mode: text('mode').notNull(),
  confirmationStartedAt: timestamp('confirmation_started_at', { withTimezone: true }),
  cancellationStartedAt: timestamp('cancellation_started_at', { withTimezone: true }),
  outcome: jsonb('outcome'),
  checks: integer('checks').notNull().default(0),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  key: uniqueIndex('hotel_attempts_key_idx').on(t.tenantId, t.userId, t.idempotencyKey),
  quote: uniqueIndex('hotel_attempts_quote_idx').on(t.quoteId),
  provider: uniqueIndex('hotel_attempts_provider_idx').on(t.tenantId, t.providerBookingId),
  checksValid: check('hotel_attempts_checks_valid', sql`${t.checks} >= 0`),
  owner: index('hotel_attempts_owner_idx').on(t.tenantId, t.userId, t.createdAt),
}));
