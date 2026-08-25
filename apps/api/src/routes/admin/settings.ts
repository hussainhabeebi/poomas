// GET  /api/admin/settings/payments   — get payment gateway config
// PUT  /api/admin/settings/payments   — save payment gateway config (Razorpay + NoMod)
// GET  /api/admin/settings/whatsapp   — get Leadvyne / WhatsApp config
// PUT  /api/admin/settings/whatsapp   — save Leadvyne config
// GET  /api/admin/settings/eticket    — get e-ticket delivery config
// PUT  /api/admin/settings/eticket    — save e-ticket delivery config

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env, Variables } from "../../types.js";

export const settingsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const SETTINGS_TTL = 60 * 60 * 24 * 365;  // 1 year

function settingsKey(tenantId: string, section: string) {
  return `admin_settings:${tenantId}:${section}`;
}

async function getSettings<T>(env: Env, tenantId: string, section: string): Promise<T | null> {
  const raw = await env.TENANT_CACHE_KV.get(settingsKey(tenantId, section));
  return raw ? JSON.parse(raw) as T : null;
}

async function saveSettings(env: Env, tenantId: string, section: string, data: unknown) {
  await env.TENANT_CACHE_KV.put(settingsKey(tenantId, section), JSON.stringify(data), {
    expirationTtl: SETTINGS_TTL,
  });
}

// ── Payment settings ──────────────────────────────────────────────────────────

const paymentsSchema = z.object({
  razorpay: z.object({
    enabled:    z.boolean(),
    keyId:      z.string().optional(),
    keySecret:  z.string().optional(),
    webhookSecret: z.string().optional(),
  }).optional(),
  nomod: z.object({
    enabled:       z.boolean(),
    apiKey:        z.string().optional(),
    apiSecret:     z.string().optional(),
    webhookSecret: z.string().optional(),
    environment:   z.enum(["sandbox", "production"]).default("production"),
  }).optional(),
  defaultGateway: z.enum(["RAZORPAY", "NOMOD"]).default("RAZORPAY"),
});

settingsAdminRoutes.get("/payments", async (c) => {
  const tenantId = c.get("tenantId");
  const saved    = await getSettings(c.env, tenantId, "payments");
  return c.json(saved ?? {
    razorpay: { enabled: false },
    nomod:    { enabled: false, environment: "production" },
    defaultGateway: "RAZORPAY",
  });
});

settingsAdminRoutes.put("/payments", zValidator("json", paymentsSchema), async (c) => {
  const tenantId = c.get("tenantId");
  const body     = c.req.valid("json");

  // Mask secrets when persisting — only update if non-empty
  const existing = await getSettings<typeof body>(c.env, tenantId, "payments") ?? {};
  const merged   = {
    ...existing,
    ...body,
    razorpay: body.razorpay ? {
      ...(existing as any)?.razorpay,
      enabled:       body.razorpay.enabled,
      keyId:         body.razorpay.keyId      || (existing as any)?.razorpay?.keyId,
      keySecret:     body.razorpay.keySecret  || (existing as any)?.razorpay?.keySecret,
      webhookSecret: body.razorpay.webhookSecret || (existing as any)?.razorpay?.webhookSecret,
    } : (existing as any)?.razorpay,
    nomod: body.nomod ? {
      ...(existing as any)?.nomod,
      enabled:       body.nomod.enabled,
      apiKey:        body.nomod.apiKey        || (existing as any)?.nomod?.apiKey,
      apiSecret:     body.nomod.apiSecret     || (existing as any)?.nomod?.apiSecret,
      webhookSecret: body.nomod.webhookSecret || (existing as any)?.nomod?.webhookSecret,
      environment:   body.nomod.environment,
    } : (existing as any)?.nomod,
  };

  await saveSettings(c.env, tenantId, "payments", merged);
  return c.json({ ok: true });
});

// ── WhatsApp / Leadvyne settings ──────────────────────────────────────────────

const whatsappSchema = z.object({
  enabled:    z.boolean(),
  provider:   z.enum(["LEADVYNE", "WABA_DIRECT"]).default("LEADVYNE"),
  leadvyne: z.object({
    apiKey:     z.string().optional(),
    apiSecret:  z.string().optional(),
    instanceId: z.string().optional(),
    baseUrl:    z.string().url().optional(),
  }).optional(),
  defaultCountryCode: z.string().default("91"),
  eticketTemplate:    z.string().default("poomas_eticket_v1"),
  bookingConfirmTemplate: z.string().default("poomas_booking_confirm_v1"),
  webhookSecret: z.string().optional(),
});

settingsAdminRoutes.get("/whatsapp", async (c) => {
  const tenantId = c.get("tenantId");
  const saved    = await getSettings(c.env, tenantId, "whatsapp");
  return c.json(saved ?? {
    enabled:  false,
    provider: "LEADVYNE",
    leadvyne: {},
    defaultCountryCode: "91",
    eticketTemplate:    "poomas_eticket_v1",
    bookingConfirmTemplate: "poomas_booking_confirm_v1",
  });
});

settingsAdminRoutes.put("/whatsapp", zValidator("json", whatsappSchema), async (c) => {
  const tenantId = c.get("tenantId");
  const body     = c.req.valid("json");
  const existing = await getSettings<any>(c.env, tenantId, "whatsapp") ?? {};

  const merged = {
    ...existing,
    ...body,
    leadvyne: body.leadvyne ? {
      ...existing?.leadvyne,
      apiKey:     body.leadvyne.apiKey     || existing?.leadvyne?.apiKey,
      apiSecret:  body.leadvyne.apiSecret  || existing?.leadvyne?.apiSecret,
      instanceId: body.leadvyne.instanceId || existing?.leadvyne?.instanceId,
      baseUrl:    body.leadvyne.baseUrl    || existing?.leadvyne?.baseUrl,
    } : existing?.leadvyne,
  };

  await saveSettings(c.env, tenantId, "whatsapp", merged);
  return c.json({ ok: true });
});

// ── E-ticket delivery settings ────────────────────────────────────────────────

const eticketSchema = z.object({
  autoSendOnConfirm:  z.boolean().default(true),
  channels:           z.array(z.enum(["WHATSAPP", "EMAIL"])).default(["WHATSAPP", "EMAIL"]),
  emailFrom:          z.string().optional(),
  emailFromName:      z.string().optional(),
  includeItinerary:   z.boolean().default(true),
  includeBaggage:     z.boolean().default(true),
  includeCheckinLink: z.boolean().default(false),
});

settingsAdminRoutes.get("/eticket", async (c) => {
  const tenantId = c.get("tenantId");
  const saved    = await getSettings(c.env, tenantId, "eticket");
  return c.json(saved ?? {
    autoSendOnConfirm:  true,
    channels:           ["WHATSAPP", "EMAIL"],
    emailFrom:          "tickets@flypoomas.com",
    emailFromName:      "POOMAS Flights",
    includeItinerary:   true,
    includeBaggage:     true,
    includeCheckinLink: false,
  });
});

settingsAdminRoutes.put("/eticket", zValidator("json", eticketSchema), async (c) => {
  const tenantId = c.get("tenantId");
  await saveSettings(c.env, tenantId, "eticket", c.req.valid("json"));
  return c.json({ ok: true });
});
