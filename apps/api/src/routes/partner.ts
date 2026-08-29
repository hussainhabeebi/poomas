import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../types.js";
import { requirePartnerScope } from "../middleware/partner-api-key.js";
import { searchRoutes } from "./search.js";

const OFFER_TTL_MS = 15 * 60 * 1000;

type InternalSearchResponse = {
  fares?: Array<Record<string, unknown>>;
  usedSuppliers?: string[];
  isIndicative?: boolean;
  disclaimer?: string;
  supplierErrors?: Record<string, string>;
  fromCache?: boolean;
};

const shapePartnerSearchResponse: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  await next();

  if (!c.res.ok || !c.res.headers.get("content-type")?.includes("application/json")) {
    return;
  }

  const data = await c.res.clone().json() as InternalSearchResponse;
  if (!Array.isArray(data.fares)) return;

  const offers = data.fares.map((fare) => {
    const { raw: _supplierPayload, id, ...publicOffer } = fare;
    return {
      offerId: String(id ?? ""),
      ...publicOffer,
    };
  });

  const expiresAt = new Date(Date.now() + OFFER_TTL_MS).toISOString();
  const response = {
    searchId: crypto.randomUUID(),
    expiresAt,
    offers,
    usedSuppliers: data.usedSuppliers ?? [],
    isIndicative: data.isIndicative ?? false,
    ...(data.disclaimer ? { disclaimer: data.disclaimer } : {}),
    ...(data.supplierErrors ? { supplierErrors: data.supplierErrors } : {}),
    ...(data.fromCache ? { fromCache: true } : {}),
  };

  const headers = new Headers(c.res.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  c.res = new Response(JSON.stringify(response), {
    status: c.res.status,
    headers,
  });
};

export const partnerRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

partnerRoutes.use("/search", requirePartnerScope("search"));
partnerRoutes.use("/search/*", requirePartnerScope("search"));
partnerRoutes.use("/search", shapePartnerSearchResponse);
partnerRoutes.use("/search/*", shapePartnerSearchResponse);
partnerRoutes.route("/search", searchRoutes);
