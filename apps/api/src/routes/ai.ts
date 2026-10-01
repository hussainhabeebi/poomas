// AI helpers for the customer site (Google Gemini).
//
//   GET  /api/ai/status        { tripSearch: boolean } — the site hides the box when off
//   POST /api/ai/trip-search   { text, timeZone? } → search form fields
//   POST /api/ai/scan-document multipart "file" (passport / ID photo or PDF) → traveller fields
//   POST /api/ai/transcribe    multipart "audio" (short WAV recording) → { text } — voice search
//                              for browsers without built-in speech recognition (Workers AI Whisper)
//
// Public (no login). Limited to 30 requests per visitor per hour, and identical
// messages on the same day are answered from cache.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { AiSearchError, parseTripQuery, todayIn } from "../lib/ai-trip-search.js";
import { ScanError, scanDocument } from "../lib/document-scan.js";

export const aiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const LIMIT_PER_HOUR = 30;

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

aiRoutes.get("/status", (c) => c.json({
  tripSearch: Boolean(c.env.GEMINI_API_KEY),
  documentScan: Boolean(c.env.GEMINI_API_KEY),
  voiceTranscribe: Boolean(c.env.GEMINI_API_KEY && c.env.AI),
}));

// Per-visitor hourly counter (KV); returns false once the limit is reached.
async function underLimit(c: any, name: string, limit: number) {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const key = `ai_rl:${name}:${c.get("tenantId")}:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const used = Number(await c.env.FARE_CACHE_KV.get(key).catch(() => null) ?? 0);
  if (used >= limit) return false;
  c.executionCtx.waitUntil(c.env.FARE_CACHE_KV.put(key, String(used + 1), { expirationTtl: 3700 }).catch(() => {}));
  return true;
}

// Voice search: a short recording → text (then sent to /trip-search by the page).
// Whisper detects the language (English, Malayalam, Hindi, Arabic…). Nothing is stored.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;   // ~60 s of 16 kHz mono WAV
aiRoutes.post("/transcribe", async (c) => {
  if (!c.env.AI) return c.json({ error: "Voice search isn't available right now. Please type your trip.", code: "VOICE_UNAVAILABLE" }, 503);
  if (!(await underLimit(c, "voice", 30))) return c.json({ error: "Too many voice searches — please type your trip or try again later.", code: "VOICE_RATE_LIMITED" }, 429);
  let audio: unknown;
  try { audio = (await c.req.formData()).get("audio"); } catch { /* not multipart */ }
  if (!(audio instanceof File) || audio.size < 1000) return c.json({ error: "We didn't catch that — please try again.", code: "VOICE_NO_AUDIO" }, 400);
  if (audio.size > MAX_AUDIO_BYTES) return c.json({ error: "That recording is too long — keep it under a minute.", code: "VOICE_TOO_LONG" }, 413);
  try {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const out = await c.env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: btoa(binary), task: "transcribe", vad_filter: true,
    }) as { text?: string };
    const text = String(out?.text ?? "").trim().slice(0, 400);
    if (text.length < 3) return c.json({ error: "We didn't catch that — please try again or type your trip.", code: "VOICE_EMPTY" }, 422);
    return c.json({ text });
  } catch (err) {
    console.error("[voice-transcribe]", err);
    return c.json({ error: "Voice search failed — please type your trip.", code: "VOICE_ERROR" }, 502);
  }
});

// Passport / ID photo → name, date of birth, nationality, document number,
// expiry. The image is only sent to Gemini; nothing is stored.
aiRoutes.post("/scan-document", async (c) => {
  if (!c.env.GEMINI_API_KEY) return c.json({ error: "Document scan isn't available right now. Please type the details.", code: "SCAN_UNAVAILABLE" }, 503);
  if (!(await underLimit(c, "scan", 20))) return c.json({ error: "Too many scans — please type the details or try again later.", code: "SCAN_RATE_LIMITED" }, 429);
  let file: unknown;
  try { file = (await c.req.formData()).get("file"); } catch { /* not multipart */ }
  if (!(file instanceof File)) return c.json({ error: "Attach a photo or PDF of the passport / ID.", code: "SCAN_NO_FILE" }, 400);
  try {
    return c.json({ traveller: await scanDocument(c.env, file), stored: false });
  } catch (err) {
    const e = err instanceof ScanError ? err : new ScanError(String(err), "SCAN_ERROR");
    console.error("[scan-document]", e.code, e.message);
    const message = e.status < 500 || e.code === "SCAN_UNAVAILABLE" ? e.message : "We couldn't read the document. Try a sharper photo in good light, or type the details.";
    return c.json({ error: message, code: e.code }, e.status as 400 | 413 | 415 | 422 | 429 | 502 | 503);
  }
});

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
