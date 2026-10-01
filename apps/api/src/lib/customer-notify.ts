// One-off customer messages (fare alerts, held-fare reminders): email via Resend
// and WhatsApp via the tenant's Leadvyne/Chatwoot inbox, whichever is available.
// Never throws — a failed message must not fail the request or job that sent it.

import { leadvyneConfigs, tenants } from "@poomas/db/schema";
import { and, eq } from "drizzle-orm";
import type { Db } from "@poomas/db";
import type { Env } from "../types.js";
import { sendEmail, sendWhatsApp } from "./notify.js";

export const WEB_URL = "https://flypoomas.com";
export const API_URL = "https://api.flypoomas.com";

export interface CustomerMessage {
  email?: string | null;
  phone?: string | null;
  subject: string;
  html: string;
  whatsapp: string;
}

export async function notifyCustomer(env: Env, db: Db, tenantId: string, msg: CustomerMessage): Promise<{ email: boolean; whatsapp: boolean }> {
  const sent = { email: false, whatsapp: false };
  if (msg.email && env.RESEND_API_KEY) {
    try {
      const [tenant] = await db.select({ customDomain: tenants.customDomain }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      await sendEmail(env.RESEND_API_KEY, {
        to: msg.email, subject: msg.subject, html: msg.html,
        from: `bookings@${tenant?.customDomain ?? "flypoomas.com"}`,
      });
      sent.email = true;
    } catch (err) {
      console.error("[customer-notify] email failed", err);
    }
  }
  if (msg.phone) {
    try {
      const [wa] = await db.select({
        chatwootBaseUrl: leadvyneConfigs.chatwootBaseUrl,
        chatwootInboxId: leadvyneConfigs.chatwootInboxId,
        chatwootApiToken: leadvyneConfigs.chatwootApiToken,
      }).from(leadvyneConfigs)
        .where(and(eq(leadvyneConfigs.tenantId, tenantId), eq(leadvyneConfigs.isActive, true))).limit(1);
      if (wa?.chatwootBaseUrl && wa.chatwootInboxId && wa.chatwootApiToken) {
        await sendWhatsApp({
          phone: msg.phone, message: msg.whatsapp,
          chatwootBaseUrl: wa.chatwootBaseUrl, chatwootInboxId: wa.chatwootInboxId, chatwootApiToken: wa.chatwootApiToken,
        });
        sent.whatsapp = true;
      }
    } catch (err) {
      console.error("[customer-notify] WhatsApp failed", err);
    }
  }
  return sent;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

export function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

// Simple branded email shell.
export function emailShell(title: string, bodyHtml: string, cta?: { label: string; href: string }) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
<h2 style="color:#E31E24;margin:0 0 12px">${escapeHtml(title)}</h2>
${bodyHtml}
${cta ? `<p style="margin:20px 0"><a href="${cta.href}" style="background:#E31E24;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(cta.label)}</a></p>` : ""}
<p style="color:#64748b;font-size:12px">FlyPoomas · flypoomas.com</p></div>`;
}
