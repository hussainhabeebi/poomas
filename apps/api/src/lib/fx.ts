// Currency conversion for customer payments. TripJack prices are in INR; a
// customer who chooses AED pays the INR price converted at the admin-set rate
// (Admin → Settings → Payment Gateways → Nomod, "INR per 1 AED").
// No rate configured means AED payment is not offered — never guessed.

export type PayCurrency = "INR" | "AED";

export async function getAedRate(env: { TENANT_CACHE_KV: { get(k: string): Promise<string | null> } }, tenantId: string): Promise<number | null> {
  try {
    const raw = await env.TENANT_CACHE_KV.get(`admin_settings:${tenantId}:payments`);
    const rate = raw ? Number(JSON.parse(raw)?.nomod?.aedRate) : NaN;
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

// Converts an amount from `from` into `to`. Rounds UP to the next fils/paisa so
// the conversion never under-collects. Returns null when no rate is available.
export function convertAmount(amount: number, from: string, to: string, aedRate: number | null): number | null {
  if (from === to) return Math.round(amount * 100) / 100;
  if (from === "INR" && to === "AED" && aedRate) return Math.ceil((amount / aedRate) * 100 - 1e-9) / 100;
  return null;
}
