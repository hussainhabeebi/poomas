// Tenant markup rules, cached in KV so flight searches don't query Neon (each query
// keeps the Neon compute awake). Admin edits clear the cache via forgetMarkupRules().
// Bookings still read the rules from Neon directly.

import { eq } from "drizzle-orm";
import { markupRules } from "@poomas/db/schema";
import type { Env, Variables } from "../types.js";

type Rule = typeof markupRules.$inferSelect;

const RULES_TTL = 3600;
const key = (tenantId: string) => `markup_rules:${tenantId}`;
const toDate = (v: unknown) => (v ? new Date(v as string) : null);

export async function tenantMarkupRules(env: Pick<Env, "TENANT_CACHE_KV">, db: Variables["db"], tenantId: string): Promise<Rule[]> {
  try {
    const hit = await env.TENANT_CACHE_KV.get(key(tenantId), "json") as Rule[] | null;
    if (hit) {
      return hit.map((r) => ({
        ...r, validFrom: toDate(r.validFrom), validTo: toDate(r.validTo),
        createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt),
      }));
    }
  } catch (err) {
    console.error("[markup-rules] cache read failed", err);
  }
  const rows = await db.select().from(markupRules).where(eq(markupRules.tenantId, tenantId));
  try {
    await env.TENANT_CACHE_KV.put(key(tenantId), JSON.stringify(rows), { expirationTtl: RULES_TTL });
  } catch (err) {
    console.error("[markup-rules] cache write failed", err);
  }
  return rows;
}

export async function forgetMarkupRules(env: Pick<Env, "TENANT_CACHE_KV">, tenantId: string) {
  try { await env.TENANT_CACHE_KV.delete(key(tenantId)); } catch {}
}
