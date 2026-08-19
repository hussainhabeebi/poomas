import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env, Variables } from "../types.js";

// Per-tenant rate limiting via Durable Objects (stateful, accurate across Workers)
// The Durable Object is keyed by tenantId so rate limits are fully isolated per tenant.
export const rateLimitMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const tenant    = c.get("tenant");
  const isSearch  = c.req.path.startsWith("/api/search");
  const isBooking = c.req.path.startsWith("/api/bookings");

  const limit = isSearch  ? tenant.searchRpmLimit
              : isBooking ? tenant.bookingRpmLimit
              : 200;  // Default for other API calls

  const id  = c.env.TENANT_RATE_LIMITER.idFromName(tenant.id);
  const obj = c.env.TENANT_RATE_LIMITER.get(id);

  const res = await obj.fetch(new Request("https://dummy/check", {
    method: "POST",
    body:   JSON.stringify({ tenantId: tenant.id, action: isSearch ? "search" : "other", limit }),
  }));

  const { allowed } = await res.json() as { allowed: boolean; remaining: number };

  if (!allowed) {
    throw new HTTPException(429, { message: "Rate limit exceeded. Please slow down." });
  }

  return next();
};
