// AI helpers for the customer site (Google Gemini).
//
//   GET  /api/ai/status        { tripSearch: boolean } — the site hides the box when off
//   POST /api/ai/trip-search   { text, timeZone? } → search form fields
//
// Public (no login). Limited to 30 requests per visitor per hour, and identical
// messages on the same day are answered from cache.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { AiSearchError, parseTripQuery, todayIn } from "../lib/ai-trip-search.js";

export const aiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const LIMIT_PER_HOUR = 30;

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

aiRoutes.get("/status", (c) => c.json({ tripSearch: Boolean(c.env.GEMINI_API_KEY) }));

aiRoutes.post("/trip-search", zValidator("json", z.object({
  text:     z.string().trim().min(3).max(400),
  timeZone: z.string().max(60).optional(),
})), async (c) => {
  const { text, timeZone } = c.req.valid("json");
  if (!c.env.GEMINI_API_KEY) return c.json({ error: "Smart search isn't available right now. Please use the search form.", code: "AI_SEARCH_UNAVAILABLE" }, 503);
  const zone = (() => { try { new Intl.DateTimeFormat("en", { timeZone }); return timeZone; } catch { return undefined; } })();

  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const hour = new Date().toISOString().slice(0, 13);
  const rlKey = `ai_rl:${c.get("tenantId")}:${ip}:${hour}`;
  const used = Number(await c.env.FARE_CACHE_KV.get(rlKey).catch(() => null) ?? 0);
  if (used >= LIMIT_PER_HOUR) return c.json({ error: "Too many smart searches — please use the search form or try again later.", code: "AI_RATE_LIMITED" }, 429);

  const cacheKey = `ai_trip:${await sha256(`${todayIn(zone).date}|${zone ?? ""}|${text.toLowerCase().replace(/\s+/g, " ")}`)}`;
  const cached = await c.env.FARE_CACHE_KV.get(cacheKey, "json").catch(() => null);
  if (cached) return c.json({ fields: cached, cached: true });

  c.executionCtx.waitUntil(c.env.FARE_CACHE_KV.put(rlKey, String(used + 1), { expirationTtl: 3700 }).catch(() => {}));
  try {
    const fields = await parseTripQuery(c.env, text, zone);
    if (!fields.isFlightSearch) {
      return c.json({ error: "That doesn't look like a flight search. Try e.g. “Kochi to Dubai next Friday, 2 adults”.", code: "NOT_A_FLIGHT_SEARCH" }, 422);
    }
    c.executionCtx.waitUntil(c.env.FARE_CACHE_KV.put(cacheKey, JSON.stringify(fields), { expirationTtl: 86_400 }).catch(() => {}));
    return c.json({ fields });
  } catch (err) {
    const e = err instanceof AiSearchError ? err : new AiSearchError(String(err), "AI_ERROR");
    console.error("[ai-trip-search]", e.code, e.message);
    return c.json({ error: "We couldn't read that. Please try rephrasing, or use the search form.", code: e.code }, e.status as 422 | 429 | 502 | 503);
  }
});
