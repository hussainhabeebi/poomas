// CF Queue consumer — processes BOOKING_QUEUE and NOTIFY_QUEUE messages
// Handles: INITIATE_PAYMENT, PAYMENT_CAPTURED, NOTIFY_BOOKING_CONFIRMATION

import type { Env } from "./types.js";
import { createDb } from "@poomas/db";
import {
  bookings, bookingPassengers, payments, walletAccounts, walletTransactions,
  tenants, tenantSupplierConfigs, leadvyneConfigs,
} from "@poomas/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getBookableAdapter } from "@poomas/suppliers";
import { createRazorpayOrder, createNomodCheckout, createRefundRazorpay, RAZORPAY_ENABLED, refundNomodCharge, resolveNomodApiKey } from "./lib/payment-gateway.js";
import { creditBookingBonus, creditWallet } from "./lib/customer-wallet.js";
import { renderETicketHtml, storeETicket } from "./lib/eticket.js";
import { sendEmail, sendWhatsApp, buildBookingConfirmationMessage } from "./lib/notify.js";

// ── Message type discriminated union ─────────────────────────────

interface InitiatePaymentMsg {
  type:      "INITIATE_PAYMENT";
  bookingId: string;
  tenantId:  string;
  method:    "GATEWAY" | "WALLET";
  agentId?:  string;
}

interface PaymentCapturedMsg {
  type:             "PAYMENT_CAPTURED";
  gatewayPaymentId: string;
  orderId:          string;
  amount:           number;
}

interface NotifyBookingMsg {
  type:       "NOTIFY_BOOKING_CONFIRMATION";
  bookingId:  string;
  tenantId:   string;
  eticketKey: string;
}

interface NotifyOtpMsg {
  type:     "NOTIFY_OTP";
  phone:    string;
  otp:      string;
  tenantId: string;
}

type BookingQueueMsg   = InitiatePaymentMsg | PaymentCapturedMsg;
type NotifyQueueMsg    = NotifyBookingMsg | NotifyOtpMsg;

// ── Booking Queue consumer ────────────────────────────────────────

export async function handleBookingQueue(
  batch: MessageBatch<BookingQueueMsg>,
  env: Env,
): Promise<void> {
  const db = createDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);

  for (const msg of batch.messages) {
    try {
      const data = msg.body;

      if (data.type === "INITIATE_PAYMENT") {
        await handleInitiatePayment(db, env, data);
      } else if (data.type === "PAYMENT_CAPTURED") {
        await handlePaymentCaptured(db, env, data);
      }

      msg.ack();
    } catch (err) {
      console.error(`[BookingQueue] Failed to process msg ${msg.id}:`, err);
      msg.retry();
    }
  }
}

// ── INITIATE_PAYMENT ─────────────────────────────────────────────

async function handleInitiatePayment(
  db: ReturnType<typeof createDb>,
  env: Env,
  data: InitiatePaymentMsg,
): Promise<void> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, data.bookingId), eq(bookings.tenantId, data.tenantId)))
    .limit(1);

  if (!booking) {
    throw new Error(`Booking ${data.bookingId} not found`);
  }

  if (booking.status !== "HELD") {
    console.warn(`Booking ${data.bookingId} is ${booking.status}, skipping payment initiation`);
    return;
  }

  const total   = Number(booking.totalAmount);
  const currency = booking.currency;

  if (data.method === "WALLET" && data.agentId) {
    // Deduct from agent wallet
    const [wallet] = await db
      .select()
      .from(walletAccounts)
      .where(eq(walletAccounts.agentId, data.agentId))
      .limit(1);

    if (!wallet) throw new Error("Wallet not found for agent");

    const available = Number(wallet.balance) + Number(wallet.creditLimit ?? 0);
    if (available < total) {
      await db.update(bookings)
        .set({ status: "PAYMENT_FAILED", updatedAt: new Date() })
        .where(eq(bookings.id, data.bookingId));
      throw new Error("Insufficient wallet balance");
    }

    // Deduct wallet and record transaction
    await db.update(walletAccounts)
      .set({ balance: String(Number(wallet.balance) - total), updatedAt: new Date() })
      .where(eq(walletAccounts.id, wallet.id));

    await db.insert(walletTransactions).values({
      walletAccountId: wallet.id,
      type:            "BOOKING_DEBIT",
      amount:          String(total),
      balanceBefore:   String(wallet.balance),
      balanceAfter:    String(Number(wallet.balance) - total),
      bookingId:       data.bookingId,
      note:            `Payment for booking ${data.bookingId}`,
      performedById:   data.agentId,
    });

    // Insert a WALLET payment record and mark booking PAYMENT_PENDING (confirm below)
    await db.insert(payments).values({
      bookingId:       data.bookingId,
      gateway:         "WALLET",
      amount:          String(total),
      currency:        currency,
      status:          "SUCCESS",
      gatewayPaymentId: `wallet_${data.bookingId}`,
    });

    await db.update(bookings)
      .set({ status: "PAYMENT_PENDING", updatedAt: new Date() })
      .where(eq(bookings.id, data.bookingId));

    // Trigger booking confirmation immediately for wallet payments
    await env.BOOKING_QUEUE.send({
      type:             "PAYMENT_CAPTURED",
      gatewayPaymentId: `wallet_${data.bookingId}`,
      orderId:          `wallet_${data.bookingId}`,
      amount:           total,
    });

    return;
  }

  // Gateway payment — get tenant payment config
  const [tenant] = await db
    .select({
      paymentConfig: tenants.paymentConfig,
      slug:          tenants.slug,
    })
    .from(tenants)
    .where(eq(tenants.id, data.tenantId))
    .limit(1);

  if (!tenant) throw new Error(`Tenant ${data.tenantId} not found`);

  const paymentConfig = tenant.paymentConfig as {
    razorpay?: { keyId: string; keySecret: string };
    nomod?:    { apiKey: string; apiSecret: string };
  } | null;

  // Fall back to platform-level credentials if tenant hasn't set own
  const useRazorpay = RAZORPAY_ENABLED && currency === "INR";
  let gatewayResult;

  if (useRazorpay) {
    const keyId     = paymentConfig?.razorpay?.keyId     ?? env.RAZORPAY_KEY_ID;
    const keySecret = paymentConfig?.razorpay?.keySecret ?? env.RAZORPAY_KEY_SECRET;

    gatewayResult = await createRazorpayOrder(
      { keyId, keySecret },
      {
        amount:   total,
        currency: "INR",
        receipt:  `bk_${data.bookingId.slice(0, 20)}`,
        notes:    { bookingId: data.bookingId, tenantId: data.tenantId },
      },
    );
  } else {
    const apiKey    = paymentConfig?.nomod?.apiKey    ?? env.NOMOD_API_KEY;
    const apiSecret = paymentConfig?.nomod?.apiSecret ?? env.NOMOD_API_SECRET;

    gatewayResult = await createNomodCheckout(
      { apiKey, apiSecret },
      {
        amount:      total,
        currency:    currency,
        reference:   data.bookingId,
        redirectUrl: `https://${tenant.slug}.flypoomas.com/booking/${data.bookingId}/confirm`,
        description: `Flight booking ${data.bookingId}`,
      },
    );
  }

  // Store payment record
  await db.insert(payments).values({
    bookingId:      data.bookingId,
    gateway:        gatewayResult.gateway,
    gatewayOrderId: gatewayResult.orderId,
    amount:         String(total),
    currency:       currency,
    status:         "PENDING",
  });

  // Update booking to PAYMENT_PENDING
  await db.update(bookings)
    .set({ status: "PAYMENT_PENDING", updatedAt: new Date() })
    .where(eq(bookings.id, data.bookingId));

  // Store payment URL in KV for frontend to poll (60 min TTL)
  await env.SESSIONS_KV.put(
    `pay_url:${data.bookingId}`,
    JSON.stringify(gatewayResult),
    { expirationTtl: 3600 },
  );
}

// ── AUTO-REFUND ───────────────────────────────────────────────────

// Refund a customer wallet payment. The payment row is flipped SUCCESS → REFUNDED
// atomically first, so a retried queue message can't refund twice. Agent wallet
// payments (no customer debit on record) are left unchanged.
async function refundCustomerWalletPayment(db: ReturnType<typeof createDb>, bookingId: string): Promise<void> {
  const [debit] = await db
    .select({ walletAccountId: walletTransactions.walletAccountId, amount: walletTransactions.amount })
    .from(walletTransactions)
    .innerJoin(walletAccounts, eq(walletAccounts.id, walletTransactions.walletAccountId))
    .where(and(
      eq(walletTransactions.bookingId, bookingId),
      eq(walletTransactions.type, "BOOKING_DEBIT"),
      sql`${walletAccounts.userId} IS NOT NULL`,
    ))
    .limit(1);
  if (!debit) return;

  const [claimed] = await db.update(payments)
    .set({ status: "REFUNDED", refundCompletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(payments.bookingId, bookingId), eq(payments.gateway, "WALLET"), eq(payments.status, "SUCCESS")))
    .returning({ id: payments.id });
  if (!claimed) return;

  try {
    await creditWallet(db, debit.walletAccountId, Number(debit.amount), "REFUND_CREDIT", {
      bookingId, note: `Refund: booking ${bookingId.slice(0, 8)} could not be ticketed`,
    });
    console.info(`[autoRefund] wallet refund issued for booking ${bookingId}`);
  } catch (err) {
    console.error(`[autoRefund] wallet refund failed for booking ${bookingId}:`, err);
  }
}

async function triggerAutoRefund(
  db: ReturnType<typeof createDb>,
  env: Env,
  bookingId: string,
  gatewayPaymentId: string,
  amount: number,
): Promise<void> {
  // Customer wallet payments go back to the customer's wallet.
  if (gatewayPaymentId.startsWith("wallet_")) {
    await refundCustomerWalletPayment(db, bookingId);
    return;
  }

  const [payment] = await db
    .select({ gateway: payments.gateway, gatewayOrderId: payments.gatewayOrderId, amount: payments.amount, currency: payments.currency })
    .from(payments)
    .where(eq(payments.bookingId, bookingId))
    .limit(1);

  if (!payment) {
    console.warn(`[autoRefund] No payment record for booking ${bookingId}`);
    return;
  }

  try {
    if (payment.gateway === "RAZORPAY") {
      const keyId     = env.RAZORPAY_KEY_ID;
      const keySecret = env.RAZORPAY_KEY_SECRET;
      if (!keyId || !keySecret) {
        console.error("[autoRefund] Razorpay credentials not configured");
        return;
      }
      const { refundId } = await createRefundRazorpay(
        { keyId, keySecret },
        { paymentId: gatewayPaymentId, amount, notes: { bookingId, reason: "booking_failed" } },
      );
      await db.update(payments).set({
        status:    "REFUNDED",
        updatedAt: new Date(),
      }).where(eq(payments.bookingId, bookingId));
      console.info(`[autoRefund] Razorpay refund ${refundId} issued for booking ${bookingId}`);
    } else if (payment.gateway === "NOMOD") {
      const [bk] = await db.select({ tenantId: bookings.tenantId }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      const apiKey = bk ? await resolveNomodApiKey(env, bk.tenantId) : env.NOMOD_API_KEY;
      if (!apiKey) {
        console.error("[autoRefund] Nomod API key not configured; refund manually from the Nomod dashboard");
        return;
      }
      // Refund the full charge in the currency it was taken in (may be AED).
      const chargeAmount = Number(payment.amount);
      const outcome = await refundNomodCharge(apiKey, gatewayPaymentId, chargeAmount, "Booking could not be ticketed");
      if (!outcome.ok) {
        console.error(`[autoRefund] Nomod refund for booking ${bookingId} not confirmed: ${outcome.error}`);
        return;
      }
      await db.update(payments).set({
        status:           "REFUNDED",
        refundedAmount:   chargeAmount.toFixed(2),
        refundGatewayRef: `nomod:${outcome.refundId}`,
        refundCompletedAt: new Date(),
        updatedAt:        new Date(),
      }).where(eq(payments.bookingId, bookingId));
      console.info(`[autoRefund] Nomod refund ${outcome.refundId} issued for booking ${bookingId}`);
    }
  } catch (refundErr) {
    // Refund failure must never swallow the original booking failure — log and continue
    console.error(`[autoRefund] Refund attempt failed for booking ${bookingId}:`, refundErr);
  }
}

// ── PAYMENT_CAPTURED ──────────────────────────────────────────────

async function handlePaymentCaptured(
  db: ReturnType<typeof createDb>,
  env: Env,
  data: PaymentCapturedMsg,
): Promise<void> {
  // Find the booking from the payment record
  const [payment] = await db
    .select({ bookingId: payments.bookingId })
    .from(payments)
    .where(eq(payments.gatewayOrderId, data.orderId))
    .limit(1);

  if (!payment) {
    throw new Error(`Payment for order ${data.orderId} not found`);
  }

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, payment.bookingId))
    .limit(1);

  if (!booking) throw new Error(`Booking ${payment.bookingId} not found`);

  if (booking.status === "TICKETED" || booking.status === "CONFIRMED") {
    console.warn(`Booking ${booking.id} already confirmed, skipping`);
    return;
  }

  // Load supplier configs for this tenant
  const supplierRows = await db
    .select()
    .from(tenantSupplierConfigs)
    .where(eq(tenantSupplierConfigs.tenantId, booking.tenantId));

  const supplierConfigs = supplierRows.map((s) => ({
    name:        s.supplier as "RIYA" | "TRIPJACK" | "GOOGLE_SERP",
    isEnabled:   s.isEnabled,
    priority:    s.priority,
    credentials: s.credentials as Record<string, string> | null,
    timeoutMs:   s.timeoutMs,
    maxRetries:  s.maxRetries,
  }));

  // Build platform credentials from env so the queue worker can reach suppliers
  // even when they are configured only via env vars and not in the DB.
  const platformCredentials = {
    ...(env.RIYA_API_KEY && env.RIYA_API_BASE_URL
      ? { RIYA: { apiKey: env.RIYA_API_KEY, secretKey: env.RIYA_API_SECRET, baseUrl: env.RIYA_API_BASE_URL } }
      : {}),
    ...((env.TRIPJACK_API_KEY || env.TRIPJACK_PROXY_KEY) && env.TRIPJACK_API_BASE_URL
      ? { TRIPJACK: { apiKey: env.TRIPJACK_API_KEY, baseUrl: env.TRIPJACK_API_BASE_URL, proxyKey: env.TRIPJACK_PROXY_KEY } }
      : {}),
  };

  // Load passengers
  const paxRows = await db
    .select()
    .from(bookingPassengers)
    .where(eq(bookingPassengers.bookingId, booking.id));

  // Call supplier book()
  const adapter = getBookableAdapter(booking.supplier as "RIYA" | "TRIPJACK", supplierConfigs, platformCredentials);

  if (!adapter.book) {
    throw new Error(`${booking.supplier} adapter does not implement book()`);
  }

  const flightData = booking.flightData as Record<string, unknown>;

  // TripJack requires a review step before booking to obtain a booking session ID.
  // The review step may have been skipped during reservation creation (partner/checkout
  // flows). If supplierBookingRef is not set, call review now to get the session ID.
  let tripjackHoldId = booking.supplierBookingRef ?? "";
  if (booking.supplier === "TRIPJACK" && !tripjackHoldId) {
    const fareId = (flightData.id as string) ?? booking.supplierSessionId ?? "";
    if (!fareId) throw new Error(`TripJack booking ${booking.id}: no fare ID to review`);
    if (!adapter.revalidate) throw new Error("TripJack adapter missing revalidate");
    const reviewed = await adapter.revalidate(fareId);
    tripjackHoldId = reviewed.bookingId;
    // Persist so retries don't call review again
    await db.update(bookings)
      .set({ supplierBookingRef: tripjackHoldId, updatedAt: new Date() })
      .where(eq(bookings.id, booking.id));
  }

  let bookResult;
  try {
    bookResult = await adapter.book({
      fareId:        flightData.id as string,
      holdId:        booking.supplier === "TRIPJACK" ? tripjackHoldId : (booking.supplierBookingRef ?? ""),
      sessionId:     booking.supplierSessionId ?? undefined,
      contactEmail:  booking.contactEmail ?? "",
      contactPhone:  booking.contactPhone ?? "",
      paymentRef:    data.gatewayPaymentId,
      // TripJack must be paid its reviewed net fare; totalAmount includes our markup.
      paymentAmount: Math.round((Number(booking.totalAmount) - Number(booking.markup ?? 0)) * 100) / 100,
      passengers: paxRows.map((p) => ({
        type:           p.passengerType as "ADULT" | "CHILD" | "INFANT",
        firstName:      p.firstName,
        lastName:       p.lastName,
        dob:            p.dob?.toISOString().slice(0, 10),
        gender:         p.gender ?? undefined,
        nationality:    p.nationality ?? undefined,
        passportNumber: p.passportNumber  ?? undefined,
        passportExpiry: p.passportExpiry?.toISOString().slice(0, 10),
        passportCountry: p.passportCountry ?? undefined,
      })),
    });
  } catch (err) {
    console.error(`Supplier book() failed for booking ${booking.id}:`, err);
    await db.update(bookings)
      .set({ status: "PAYMENT_FAILED", updatedAt: new Date() })
      .where(eq(bookings.id, booking.id));
    await triggerAutoRefund(db, env, booking.id, data.gatewayPaymentId, Number(booking.totalAmount));
    throw err;
  }

  if (!bookResult.success) {
    await db.update(bookings)
      .set({ status: "PAYMENT_FAILED", updatedAt: new Date() })
      .where(eq(bookings.id, booking.id));
    await triggerAutoRefund(db, env, booking.id, data.gatewayPaymentId, Number(booking.totalAmount));
    throw new Error(`Supplier booking failed: ${JSON.stringify(bookResult)}`);
  }

  // Update booking to TICKETED
  const newStatus = bookResult.status === "TICKETED" ? "TICKETED" : "CONFIRMED";
  await db.update(bookings).set({
    status:            newStatus,
    pnr:               bookResult.pnr,
    ticketNumbers:     bookResult.ticketNumbers,
    supplierBookingRef: bookResult.bookingRef,
    updatedAt:         new Date(),
  }).where(eq(bookings.id, booking.id));

  // Update payment record with gateway payment id
  await db.update(payments).set({
    gatewayPaymentId: data.gatewayPaymentId,
    status:           "SUCCESS",
    updatedAt:        new Date(),
  }).where(eq(payments.gatewayOrderId, data.orderId));

  // ₹50 wallet bonus for signed-in customers, once per confirmed booking.
  // Never let a bonus problem fail (and retry) an already-ticketed booking.
  try {
    if (await creditBookingBonus(db, booking.id)) console.info(`[wallet-bonus] credited for booking ${booking.id}`);
  } catch (err) {
    console.error(`[wallet-bonus] booking ${booking.id}:`, err);
  }

  // Generate e-ticket HTML
  const [tenantRow] = await db
    .select({
      name:         tenants.name,
      slug:         tenants.slug,
      customDomain: tenants.customDomain,
      logoUrl:      tenants.logoUrl,
      primaryColor: tenants.primaryColor,
      supportEmail: tenants.supportEmail,
    })
    .from(tenants)
    .where(eq(tenants.id, booking.tenantId))
    .limit(1);

  const fd = flightData as {
    airline: string; airlineName: string; flightNumber: string;
    origin: string; destination: string;
    departureTime: string; arrivalTime: string;
    cabinClass: string; isRefundable: boolean;
    baggage: { cabin: string; checked: string };
  };

  const eticketHtml = renderETicketHtml({
    bookingRef:    booking.id,
    pnr:           bookResult.pnr,
    ticketNumbers: bookResult.ticketNumbers,
    airline:       fd.airline,
    airlineName:   fd.airlineName,
    flightNumber:  fd.flightNumber,
    origin:        fd.origin,
    destination:   fd.destination,
    departureTime: fd.departureTime,
    arrivalTime:   fd.arrivalTime,
    cabinClass:    fd.cabinClass,
    isRefundable:  fd.isRefundable,
    baggage:       fd.baggage,
    passengers:    paxRows.map((p, i) => ({
      name:         `${p.firstName} ${p.lastName}`,
      type:         p.passengerType,
      ticketNumber: bookResult.ticketNumbers[i],
    })),
    totalAmount:  Number(booking.totalAmount),
    currency:     booking.currency,
    brandName:    tenantRow?.name ?? "POOMAS Traveldays",
    brandLogo:    tenantRow?.logoUrl ?? undefined,
    primaryColor: tenantRow?.primaryColor ?? "#E31E24",
    supportEmail: tenantRow?.supportEmail ?? undefined,
  });

  const eticketKey = await storeETicket(env.DOCUMENTS_R2, booking.id, eticketHtml);

  // Queue notification
  await env.NOTIFY_QUEUE.send({
    type:       "NOTIFY_BOOKING_CONFIRMATION",
    bookingId:  booking.id,
    tenantId:   booking.tenantId,
    eticketKey,
  });
}

// ── Notification Queue consumer ───────────────────────────────────

export async function handleNotifyQueue(
  batch: MessageBatch<NotifyQueueMsg>,
  env: Env,
): Promise<void> {
  const db = createDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);

  for (const msg of batch.messages) {
    try {
      const data = msg.body;
      if (data.type === "NOTIFY_BOOKING_CONFIRMATION") {
        await handleNotifyBookingConfirmation(db, env, data);
      } else if (data.type === "NOTIFY_OTP") {
        await handleNotifyOtp(db, env, data);
      }
      msg.ack();
    } catch (err) {
      console.error(`[NotifyQueue] Failed msg ${msg.id}:`, err);
      msg.retry();
    }
  }
}

async function handleNotifyOtp(
  db: ReturnType<typeof createDb>,
  env: Env,
  data: NotifyOtpMsg,
): Promise<void> {
  // Get tenant Leadvyne config for WhatsApp delivery
  const [leadvyne] = await db
    .select({
      chatwootBaseUrl:  leadvyneConfigs.chatwootBaseUrl,
      chatwootInboxId:  leadvyneConfigs.chatwootInboxId,
      chatwootApiToken: leadvyneConfigs.chatwootApiToken,
    })
    .from(leadvyneConfigs)
    .where(and(eq(leadvyneConfigs.tenantId, data.tenantId), eq(leadvyneConfigs.isActive, true)))
    .limit(1);

  if (leadvyne?.chatwootBaseUrl && leadvyne.chatwootInboxId && leadvyne.chatwootApiToken) {
    await sendWhatsApp({
      phone:            data.phone,
      message:          `Your POOMAS OTP is: *${data.otp}*\nValid for 10 minutes. Do not share this with anyone.`,
      chatwootBaseUrl:  leadvyne.chatwootBaseUrl,
      chatwootInboxId:  leadvyne.chatwootInboxId,
      chatwootApiToken: leadvyne.chatwootApiToken,
    });
  }
}

async function handleNotifyBookingConfirmation(
  db: ReturnType<typeof createDb>,
  env: Env,
  data: NotifyBookingMsg,
): Promise<void> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, data.bookingId))
    .limit(1);

  if (!booking) return;

  const paxRows = await db
    .select()
    .from(bookingPassengers)
    .where(eq(bookingPassengers.bookingId, data.bookingId));

  const [tenantRow] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, data.tenantId))
    .limit(1);

  const [leadvyne] = await db
    .select({
      chatwootBaseUrl:  leadvyneConfigs.chatwootBaseUrl,
      chatwootInboxId:  leadvyneConfigs.chatwootInboxId,
      chatwootApiToken: leadvyneConfigs.chatwootApiToken,
    })
    .from(leadvyneConfigs)
    .where(and(eq(leadvyneConfigs.tenantId, data.tenantId), eq(leadvyneConfigs.isActive, true)))
    .limit(1);

  const fd = booking.flightData as Record<string, unknown>;
  const passengerNames = paxRows.map((p) => `${p.firstName} ${p.lastName}`);

  // Retrieve e-ticket HTML from R2
  let eticketHtml = "";
  const r2obj = await env.DOCUMENTS_R2.get(data.eticketKey);
  if (r2obj) {
    eticketHtml = await r2obj.text();
  }

  // Send email confirmation
  if (booking.contactEmail && env.RESEND_API_KEY) {
    try {
      await sendEmail(env.RESEND_API_KEY, {
        to:      booking.contactEmail,
        from:    `bookings@${tenantRow?.customDomain ?? "flypoomas.com"}`,
        subject: `Your booking is confirmed — PNR: ${booking.pnr}`,
        html:    eticketHtml || `<p>Your booking PNR is <strong>${booking.pnr}</strong>.</p>`,
      });
    } catch (err) {
      console.error("Email send failed (non-fatal):", err);
    }
  }

  // Send WhatsApp via Leadvyne/Chatwoot
  if (booking.contactPhone && leadvyne?.chatwootBaseUrl && leadvyne.chatwootInboxId && leadvyne.chatwootApiToken) {
    try {
      const waMessage = buildBookingConfirmationMessage({
        brandName:    tenantRow?.name ?? "POOMAS",
        pnr:          booking.pnr ?? "",
        origin:       fd.origin as string,
        destination:  fd.destination as string,
        departureTime: fd.departureTime as string,
        passengerNames,
        totalAmount:  Number(booking.totalAmount),
        currency:     booking.currency,
      });

      await sendWhatsApp({
        phone:             booking.contactPhone,
        message:           waMessage,
        chatwootBaseUrl:   leadvyne.chatwootBaseUrl,
        chatwootInboxId:   leadvyne.chatwootInboxId,
        chatwootApiToken:  leadvyne.chatwootApiToken,
      });
    } catch (err) {
      console.error("WhatsApp send failed (non-fatal):", err);
    }
  }
}
