// GET /api/session/preferences — get session-level preferences (currency etc.)
// PUT /api/session/preferences — save session-level preferences

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env, Variables } from "../types.js";

const SESSION_PREFS_TTL = 60 * 60 * 24 * 30;  // 30 days
const prefsSchema = z.object({ currency: z.enum(["INR", "AED", "USD"]) });

export const sessionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function prefKey(tenantId: string, sessionId: string) {
  return `session_prefs:${tenantId}:${sessionId}`;
}

sessionRoutes.get("/preferences", async (c) => {
  const tenantId  = c.get("tenantId");
  const tenant    = c.get("tenant");
  const sessionId = c.get("userId") ?? c.req.header("X-Session-ID") ?? null;

  if (!sessionId) return c.json({ currency: tenant.defaultCurrency });

  const saved = await c.env.SESSIONS_KV.get(prefKey(tenantId, sessionId), "json") as { currency?: string } | null;
  return c.json({ currency: saved?.currency ?? tenant.defaultCurrency });
});

sessionRoutes.put("/preferences", zValidator("json", prefsSchema), async (c) => {
  const { currency } = c.req.valid("json");
  const tenantId  = c.get("tenantId");
  const sessionId = c.get("userId") ?? c.req.header("X-Session-ID") ?? null;

  if (sessionId) {
    const key      = prefKey(tenantId, sessionId);
    const existing = await c.env.SESSIONS_KV.get(key, "json") as Record<string, unknown> | null;
    c.executionCtx.waitUntil(
      c.env.SESSIONS_KV.put(key, JSON.stringify({ ...(existing ?? {}), currency }), { expirationTtl: SESSION_PREFS_TTL }),
    );
  }

  return c.json({ currency });
});
