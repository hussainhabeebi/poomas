// Customer wallet (mounted at /api/profile/wallet, customer JWT required)
//
// GET  /                      balance + recent transactions
// POST /pay                   pay a PAYMENT_PENDING booking fully from the wallet
// GET  /coupons               coupons this customer created
// POST /coupons               move part of the balance into a shareable coupon code
// POST /coupons/:id/cancel    cancel an unredeemed coupon (amount returns to wallet)
// POST /redeem                redeem someone else's coupon code into this wallet
// GET  /bank-accounts         company accounts to recharge by bank transfer
// GET  /deposits              this customer's bank-transfer recharges
// POST /deposits              submit a recharge with the payment screenshot (multipart)

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { bookings, customerWalletDeposits, payments, walletCoupons, walletTransactions, users } from "@poomas/db/schema";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { Env, Variables } from "../types.js";
import {
  CUSTOMER_WALLET_CURRENCY, COUPON_MIN_AMOUNT, COUPON_TTL_DAYS,
  creditWallet, debitWallet, expireOverdueCoupons, generateCouponCode,
  getOrCreateCustomerWallet, roundMoney,
} from "../lib/customer-wallet.js";
import { applyReferral, myReferral, ReferralError } from "../lib/referral.js";
import { getBankAccounts, visibleAccounts } from "../lib/bank-accounts.js";
import { saveUpload } from "./agent-portal.js";

export const customerWalletRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

customerWalletRoutes.use("*", async (c, next) => {
  if (c.get("userRole") !== "CUSTOMER" || !c.get("userId")) {
    throw new HTTPException(403, { message: "Sign in with a customer account to use the wallet" });
  }
  return next();
});

customerWalletRoutes.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId")!;
  await expireOverdueCoupons(db, userId);
  const wallet = await getOrCreateCustomerWallet(db, c.get("tenantId"), userId);
  const transactions = await db.select({
    id: walletTransactions.id, type: walletTransactions.type, amount: walletTransactions.amount,
    balanceAfter: walletTransactions.balanceAfter, bookingId: walletTransactions.bookingId,
    note: walletTransactions.note, createdAt: walletTransactions.createdAt,
  })
    .from(walletTransactions)
    .where(eq(walletTransactions.walletAccountId, wallet.id))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(50);
  return c.json({ balance: Number(wallet.balance), currency: wallet.currency, transactions });
});

// ── Pay a booking from the wallet (only when the balance covers the full fare) ──

customerWalletRoutes.post("/pay", zValidator("json", z.object({ bookingId: z.string().min(1) })), async (c) => {
  const db = c.get("db");
  const tenantId = c.get("tenantId");
  const userId = c.get("userId")!;
  const { bookingId } = c.req.valid("json");

  const [booking] = await db.select({
    id: bookings.id, status: bookings.status, userId: bookings.userId,
    totalAmount: bookings.totalAmount, currency: bookings.currency, heldUntil: bookings.heldUntil,
  })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking || booking.userId !== userId) throw new HTTPException(404, { message: "Booking not found" });
  if (!["HELD", "PAYMENT_PENDING"].includes(booking.status)) {
    throw new HTTPException(409, { message: `Booking is ${booking.status}` });
  }
  if (booking.status === "HELD" && booking.heldUntil && booking.heldUntil.getTime() < Date.now()) {
    throw new HTTPException(409, { message: "This hold has expired. Please search again." });
  }
  if (booking.currency !== CUSTOMER_WALLET_CURRENCY) {
    throw new HTTPException(400, { message: `Wallet can pay only ${CUSTOMER_WALLET_CURRENCY} bookings` });
  }
  const [paid] = await db.select({ id: payments.id }).from(payments)
    .where(and(eq(payments.bookingId, bookingId), eq(payments.status, "SUCCESS"))).limit(1);
  if (paid) throw new HTTPException(409, { message: "This booking is already paid" });

  const amount = roundMoney(Number(booking.totalAmount));
  const wallet = await getOrCreateCustomerWallet(db, tenantId, userId);

  // Claim the single wallet-payment slot for this booking before touching the balance.
  const orderId = `wallet_${bookingId}`;
  const [slot] = await db.insert(payments).values({
    bookingId, gateway: "WALLET", gatewayOrderId: orderId, gatewayPaymentId: orderId,
    amount: amount.toFixed(2), currency: CUSTOMER_WALLET_CURRENCY, status: "PENDING",
  }).onConflictDoNothing().returning({ id: payments.id });
  if (!slot) throw new HTTPException(409, { message: "A wallet payment for this booking is already in progress" });

  const balance = await debitWallet(db, wallet.id, amount, "BOOKING_DEBIT", {
    bookingId, paymentId: orderId, note: `Payment for booking ${bookingId.slice(0, 8)}`, performedById: userId,
  });
  if (balance === null) {
    await db.delete(payments).where(eq(payments.id, slot.id));
    return c.json({ error: "Wallet balance does not cover this fare", balance: Number(wallet.balance), amount }, 402);
  }

  await db.update(payments).set({ status: "SUCCESS", updatedAt: new Date() }).where(eq(payments.id, slot.id));
  await db.update(bookings).set({ status: "PAYMENT_PENDING", updatedAt: new Date() }).where(eq(bookings.id, bookingId));
  await c.env.BOOKING_QUEUE.send({ type: "PAYMENT_CAPTURED", gatewayPaymentId: orderId, orderId, amount });

  return c.json({ ok: true, bookingId, amount, balance });
});

// ── Coupons ──────────────────────────────────────────────────────────────────

customerWalletRoutes.get("/coupons", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId")!;
  await expireOverdueCoupons(db, userId);
  const coupons = await db.select({
    id: walletCoupons.id, code: walletCoupons.code, amount: walletCoupons.amount,
    currency: walletCoupons.currency, status: walletCoupons.status,
    redeemedAt: walletCoupons.redeemedAt, expiresAt: walletCoupons.expiresAt, createdAt: walletCoupons.createdAt,
  })
    .from(walletCoupons)
    .where(eq(walletCoupons.createdByUserId, userId))
    .orderBy(desc(walletCoupons.createdAt))
    .limit(50);
  return c.json({ coupons });
});

customerWalletRoutes.post("/coupons", zValidator("json", z.object({
  amount: z.number().positive(),
})), async (c) => {
  const db = c.get("db");
  const tenantId = c.get("tenantId");
  const userId = c.get("userId")!;
  const amount = roundMoney(c.req.valid("json").amount);
  if (amount < COUPON_MIN_AMOUNT) {
    throw new HTTPException(400, { message: `Minimum coupon amount is ₹${COUPON_MIN_AMOUNT}` });
  }

  const wallet = await getOrCreateCustomerWallet(db, tenantId, userId);
  const code = generateCouponCode();
  const balance = await debitWallet(db, wallet.id, amount, "COUPON_DEBIT", { note: `Coupon ${code}`, performedById: userId });
  if (balance === null) throw new HTTPException(402, { message: "Not enough wallet balance for this coupon" });

  try {
    const expiresAt = new Date(Date.now() + COUPON_TTL_DAYS * 86_400_000);
    const [coupon] = await db.insert(walletCoupons).values({
      tenantId, code, amount: amount.toFixed(2), currency: CUSTOMER_WALLET_CURRENCY,
      createdByUserId: userId, walletAccountId: wallet.id, expiresAt,
    }).returning();
    return c.json({ coupon: { id: coupon.id, code: coupon.code, amount, expiresAt: coupon.expiresAt }, balance }, 201);
  } catch (err) {
    // Code could not be stored: give the money back.
    await creditWallet(db, wallet.id, amount, "COUPON_REFUND", { note: `Coupon ${code} not created` });
    throw err;
  }
});

customerWalletRoutes.post("/coupons/:id/cancel", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId")!;
  const [coupon] = await db.update(walletCoupons)
    .set({ status: "CANCELLED" })
    .where(and(eq(walletCoupons.id, c.req.param("id")), eq(walletCoupons.createdByUserId, userId), eq(walletCoupons.status, "ACTIVE")))
    .returning({ code: walletCoupons.code, amount: walletCoupons.amount, walletAccountId: walletCoupons.walletAccountId });
  if (!coupon) throw new HTTPException(404, { message: "No active coupon to cancel" });
  const balance = await creditWallet(db, coupon.walletAccountId, Number(coupon.amount), "COUPON_REFUND", {
    note: `Coupon ${coupon.code} cancelled`, performedById: userId,
  });
  return c.json({ ok: true, balance });
});

customerWalletRoutes.post("/redeem", zValidator("json", z.object({ code: z.string().min(4).max(40) })), async (c) => {
  const db = c.get("db");
  const tenantId = c.get("tenantId");
  const userId = c.get("userId")!;
  const code = c.req.valid("json").code.trim().toUpperCase();

  // Claim atomically: only one redeemer can flip ACTIVE → REDEEMED.
  const [coupon] = await db.update(walletCoupons)
    .set({ status: "REDEEMED", redeemedByUserId: userId, redeemedAt: new Date() })
    .where(and(
      eq(walletCoupons.tenantId, tenantId),
      eq(walletCoupons.code, code),
      eq(walletCoupons.status, "ACTIVE"),
      gt(walletCoupons.expiresAt, new Date()),
      ne(walletCoupons.createdByUserId, userId),
    ))
    .returning({ id: walletCoupons.id, amount: walletCoupons.amount, createdByUserId: walletCoupons.createdByUserId });

  if (!coupon) {
    const [existing] = await db.select({ status: walletCoupons.status, createdByUserId: walletCoupons.createdByUserId, expiresAt: walletCoupons.expiresAt })
      .from(walletCoupons).where(and(eq(walletCoupons.tenantId, tenantId), eq(walletCoupons.code, code))).limit(1);
    if (existing?.status === "ACTIVE" && existing.expiresAt <= new Date()) {
      await expireOverdueCoupons(db, existing.createdByUserId);
    }
    const message = !existing ? "Coupon code not found"
      : existing.createdByUserId === userId ? "You can't redeem your own coupon"
      : existing.status === "REDEEMED" ? "This coupon has already been used"
      : existing.status === "CANCELLED" ? "This coupon was cancelled"
      : "This coupon has expired";
    throw new HTTPException(400, { message });
  }

  const wallet = await getOrCreateCustomerWallet(db, tenantId, userId);
  const [from] = await db.select({ name: users.name }).from(users).where(eq(users.id, coupon.createdByUserId)).limit(1);
  const balance = await creditWallet(db, wallet.id, Number(coupon.amount), "COUPON_CREDIT", {
    note: `Coupon ${code}${from?.name ? ` from ${from.name}` : ""}`, performedById: userId,
  });
  return c.json({ ok: true, amount: Number(coupon.amount), balance });
});

// ── Refer a friend ───────────────────────────────────────────────────────────

customerWalletRoutes.get("/referral", async (c) => {
  return c.json(await myReferral(c.env, c.get("tenantId"), c.get("userId")!));
});

customerWalletRoutes.post("/referral/apply", zValidator("json", z.object({ code: z.string().trim().min(4).max(20) })), async (c) => {
  try {
    const r = await applyReferral(c.env, c.get("db"), c.get("tenantId"), c.get("userId")!, c.req.valid("json").code);
    return c.json({ ok: true, ...r, message: `Code applied! You and your friend each get ₹${r.reward} in your wallets when your first booking is confirmed.` });
  } catch (err) {
    if (err instanceof ReferralError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

// ── Recharge by bank transfer (credited once staff check the screenshot) ─────

const MAX_PENDING_DEPOSITS = 5;

customerWalletRoutes.get("/bank-accounts", async (c) => {
  const accounts = visibleAccounts(await getBankAccounts(c.env, c.get("tenantId"), c.get("tenant")?.slug), CUSTOMER_WALLET_CURRENCY);
  return c.json({ walletCurrency: CUSTOMER_WALLET_CURRENCY, accounts });
});

customerWalletRoutes.get("/deposits", async (c) => {
  const rows = await c.get("db").select({
    id: customerWalletDeposits.id, amount: customerWalletDeposits.amount, currency: customerWalletDeposits.currency,
    creditAmount: customerWalletDeposits.creditAmount, reference: customerWalletDeposits.reference, bankAccount: customerWalletDeposits.bankAccount,
    status: customerWalletDeposits.status, adminNote: customerWalletDeposits.adminNote, createdAt: customerWalletDeposits.createdAt,
  })
    .from(customerWalletDeposits)
    .where(eq(customerWalletDeposits.userId, c.get("userId")!))
    .orderBy(desc(customerWalletDeposits.createdAt))
    .limit(30);
  return c.json({ deposits: rows.map((r) => ({ ...r, amount: Number(r.amount), creditAmount: r.creditAmount === null ? null : Number(r.creditAmount) })) });
});

customerWalletRoutes.post("/deposits", async (c) => {
  const db = c.get("db");
  const tenantId = c.get("tenantId");
  const userId = c.get("userId")!;
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "Send the deposit as a form with the screenshot" }, 400);
  const files = form.getAll("receipt").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 3);
  const amount = roundMoney(Number(form.get("amount")));
  const reference = String(form.get("reference") ?? "").trim().slice(0, 80);
  const paidOn = String(form.get("paidOn") ?? "").slice(0, 10) || null;
  const bankAccountId = String(form.get("bankAccountId") ?? "").trim();

  if (!(amount > 0) || amount > 10_000_000) return c.json({ error: "Enter the amount you paid" }, 400);
  if (!files.length) return c.json({ error: "Upload the payment screenshot or receipt" }, 400);
  const bad = files.find((f) => !/^(image\/|application\/pdf$)/.test(f.type) || f.size > 8 * 1024 * 1024);
  if (bad) return c.json({ error: "The receipt must be a photo, screenshot or PDF under 8 MB" }, 400);
  const accounts = (await getBankAccounts(c.env, tenantId, c.get("tenant")?.slug)).filter((a) => a.active);
  const bank = accounts.find((a) => a.id === bankAccountId);
  if (!bank) return c.json({ error: "Choose the bank account you paid into" }, 400);

  const [open] = await db.select({ n: sql<number>`count(*)` }).from(customerWalletDeposits)
    .where(and(eq(customerWalletDeposits.userId, userId), eq(customerWalletDeposits.status, "PENDING")));
  if ((open?.n ?? 0) >= MAX_PENDING_DEPOSITS) return c.json({ error: "You already have several recharges waiting for approval. Please wait until they're checked." }, 429);
  // The same transfer reference can't be credited twice.
  if (reference) {
    const [dup] = await db.select({ status: customerWalletDeposits.status }).from(customerWalletDeposits)
      .where(and(eq(customerWalletDeposits.tenantId, tenantId), sql`lower(${customerWalletDeposits.reference}) = ${reference.toLowerCase()}`,
        inArray(customerWalletDeposits.status, ["PENDING", "APPROVED"]))).limit(1);
    if (dup) return c.json({ error: `A recharge with reference ${reference} was already submitted.` }, 409);
  }

  const wallet = await getOrCreateCustomerWallet(db, tenantId, userId);
  const attachments = [];
  for (const f of files) attachments.push(await saveUpload(c.env, `customer-deposits/${userId}`, f));
  const [deposit] = await db.insert(customerWalletDeposits).values({
    tenantId, userId, walletAccountId: wallet.id, amount: amount.toFixed(2), currency: bank.currency,
    reference: reference || null, paidOn, attachments,
    bankAccount: { id: bank.id, label: bank.label, bankName: bank.bankName, accountNumber: bank.accountNumber, currency: bank.currency },
  }).returning({ id: customerWalletDeposits.id, status: customerWalletDeposits.status });
  return c.json({ deposit, message: "Recharge submitted. We'll add it to your wallet once our team checks the payment." }, 201);
});
