// Admin: customer wallet recharges by bank transfer (Admin → Wallet recharges → Customers).
//
// GET  /api/admin/customer-deposits?status=PENDING|APPROVED|REJECTED|ALL
// POST /api/admin/customer-deposits/:id/approve   { amount, note? }  credit the wallet once
// POST /api/admin/customer-deposits/:id/reject    { reason }         customer sees the reason
// GET  /api/admin/customer-deposits/:id/file?key=                    payment screenshot

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { customerWalletDeposits, users, walletAccounts } from "@poomas/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";
import { creditWallet } from "../../lib/customer-wallet.js";
import { audit } from "../../lib/agent-program.js";
import { getFx } from "../../lib/fx.js";
import { emailShell, escapeHtml, money, notifyCustomer, WEB_URL } from "../../lib/customer-notify.js";

export const customerDepositsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

customerDepositsAdminRoutes.get("/", async (c) => {
  const db = c.get("db");
  const tenantId = c.get("tenantId");
  const status = c.req.query("status") ?? "PENDING";
  const rows = await db.select({
    d: customerWalletDeposits, name: users.name, email: users.email, phone: users.phone,
    balance: walletAccounts.balance, walletCurrency: walletAccounts.currency,
  })
    .from(customerWalletDeposits)
    .innerJoin(users, eq(users.id, customerWalletDeposits.userId))
    .innerJoin(walletAccounts, eq(walletAccounts.id, customerWalletDeposits.walletAccountId))
    .where(and(eq(customerWalletDeposits.tenantId, tenantId), status === "ALL" ? undefined : eq(customerWalletDeposits.status, status)))
    .orderBy(status === "PENDING" ? asc(customerWalletDeposits.createdAt) : desc(customerWalletDeposits.updatedAt))
    .limit(200);
  const [counts] = await db.select({ pending: sql<number>`count(*) filter (where ${customerWalletDeposits.status} = 'PENDING')::int` })
    .from(customerWalletDeposits).where(eq(customerWalletDeposits.tenantId, tenantId));
  // Suggested credit in the wallet currency (INR) at today's rate; staff can change it.
  const fx = await getFx(c.env, tenantId, c.executionCtx).catch(() => null);
  const suggest = (amount: number, from: string, to: string) => {
    if (from === to) return amount;
    const rate = to === "INR" ? fx?.rates[from as keyof typeof fx.rates] : null;
    return rate ? Math.floor(amount * rate * 100) / 100 : null;
  };
  return c.json({
    pending: counts?.pending ?? 0,
    deposits: rows.map(({ d, name, email, phone, balance, walletCurrency }) => ({
      id: d.id, status: d.status, amount: Number(d.amount), currency: d.currency,
      creditAmount: d.creditAmount === null ? null : Number(d.creditAmount),
      suggestedCredit: suggest(Number(d.amount), d.currency, walletCurrency),
      method: d.method, reference: d.reference, paidOn: d.paidOn, bankAccount: d.bankAccount, attachments: d.attachments,
      adminNote: d.adminNote, createdAt: d.createdAt, updatedAt: d.updatedAt,
      customer: { id: d.userId, name, email, phone, wallet: { balance: Number(balance), currency: walletCurrency } },
    })),
  });
});

async function loadDeposit(c: { get: (k: "db" | "tenantId") => any }, id: string) {
  const [d] = await c.get("db").select().from(customerWalletDeposits)
    .where(and(eq(customerWalletDeposits.id, id), eq(customerWalletDeposits.tenantId, c.get("tenantId")))).limit(1);
  return d as typeof customerWalletDeposits.$inferSelect | undefined;
}

async function customerContact(db: Variables["db"], userId: string) {
  const [u] = await db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
  return u;
}

customerDepositsAdminRoutes.post("/:id/approve", zValidator("json", z.object({
  amount: z.number().positive().max(10_000_000),
  note:   z.string().trim().max(200).optional(),
})), async (c) => {
  const db = c.get("db");
  const d = await loadDeposit(c, c.req.param("id"));
  if (!d) return c.json({ error: "Recharge not found" }, 404);
  const { amount, note } = c.req.valid("json");
  // Claim the deposit first so a double click can't credit twice.
  const [claimed] = await db.update(customerWalletDeposits)
    .set({ status: "APPROVED", creditAmount: amount.toFixed(2), adminNote: note || null, reviewedById: c.get("userId") ?? null, reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(customerWalletDeposits.id, d.id), eq(customerWalletDeposits.status, "PENDING"))).returning({ id: customerWalletDeposits.id });
  if (!claimed) return c.json({ error: `This recharge is already ${d.status.toLowerCase()}.` }, 409);
  const balance = await creditWallet(db, d.walletAccountId, amount, "TOPUP", {
    paymentId: `deposit_${d.id}`, performedById: c.get("userId") ?? "admin-service",
    note: `Bank transfer ${money(Number(d.amount), d.currency)}${d.reference ? ` · ref ${d.reference}` : ""}${note ? ` · ${note}` : ""}`,
  });
  await audit(db, { tenantId: d.tenantId, userId: c.get("userId"), action: "CUSTOMER_DEPOSIT_APPROVED", entity: "WalletAccount", entityId: d.walletAccountId, after: { amount, depositId: d.id } });
  c.executionCtx.waitUntil((async () => {
    const u = await customerContact(db, d.userId);
    if (!u) return;
    const text = `${money(amount, "INR")} has been added to your FlyPoomas wallet. New balance ${money(balance, "INR")}.`;
    await notifyCustomer(c.env, db, d.tenantId, {
      email: u.email, phone: u.phone, category: "wallet", idempotencyKey: `customer-deposit-approved-${d.id}`,
      subject: "Wallet recharge credited", whatsapp: text,
      html: emailShell("Wallet recharge credited", `<p>Hi ${escapeHtml(u.name ?? "there")},</p><p>${escapeHtml(text)}</p>`, { label: "Open wallet", href: `${WEB_URL}/wallet` }),
    });
  })().catch(() => {}));
  return c.json({ ok: true, balance });
});

customerDepositsAdminRoutes.post("/:id/reject", zValidator("json", z.object({ reason: z.string().trim().min(3).max(500) })), async (c) => {
  const db = c.get("db");
  const d = await loadDeposit(c, c.req.param("id"));
  if (!d) return c.json({ error: "Recharge not found" }, 404);
  const { reason } = c.req.valid("json");
  const [done] = await db.update(customerWalletDeposits)
    .set({ status: "REJECTED", adminNote: reason, reviewedById: c.get("userId") ?? null, reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(customerWalletDeposits.id, d.id), eq(customerWalletDeposits.status, "PENDING"))).returning({ id: customerWalletDeposits.id });
  if (!done) return c.json({ error: `This recharge is already ${d.status.toLowerCase()}.` }, 409);
  await audit(db, { tenantId: d.tenantId, userId: c.get("userId"), action: "CUSTOMER_DEPOSIT_REJECTED", entity: "CustomerWalletDeposit", entityId: d.id, after: { reason } });
  c.executionCtx.waitUntil((async () => {
    const u = await customerContact(db, d.userId);
    if (!u) return;
    const text = `Your wallet recharge of ${money(Number(d.amount), d.currency)} was not approved: ${reason}`;
    await notifyCustomer(c.env, db, d.tenantId, {
      email: u.email, phone: u.phone, category: "wallet", idempotencyKey: `customer-deposit-rejected-${d.id}`,
      subject: "Wallet recharge not approved", whatsapp: text,
      html: emailShell("Wallet recharge not approved", `<p>Hi ${escapeHtml(u.name ?? "there")},</p><p>${escapeHtml(text)}</p><p>Reply to this email if you have questions.</p>`, { label: "Open wallet", href: `${WEB_URL}/wallet` }),
    });
  })().catch(() => {}));
  return c.json({ ok: true });
});

customerDepositsAdminRoutes.get("/:id/file", async (c) => {
  const d = await loadDeposit(c, c.req.param("id"));
  const file = d?.attachments.find((f) => f.key === (c.req.query("key") ?? ""));
  if (!file) return c.json({ error: "File not found" }, 404);
  const obj = await c.env.DOCUMENTS_R2.get(file.key);
  if (!obj) return c.json({ error: "File not found" }, 404);
  return new Response(obj.body as unknown as BodyInit, { headers: { "Content-Type": file.type, "Content-Disposition": `inline; filename="${file.name.replace(/"/g, "")}"` } });
});
