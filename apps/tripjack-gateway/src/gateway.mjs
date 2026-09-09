import { timingSafeEqual } from "node:crypto";

export const ROUTES = new Map([
  ["/v1/air/search", "/fms/v1/air-search-all"],
  ["/v1/air/fare-detail", "/air-fare-detail/v2"],
  ["/v1/air/book", "/air-book/v2"],
  ["/v1/air/booking-detail", "/air-booking-detail/v2"],
  ["/v1/air/cancel", "/air-cancel/v2"],
  // Compatibility while Poomas still appends TripJack's native paths.
  ["/air-search-all/v2", "/fms/v1/air-search-all"],
  ["/air-fare-detail/v2", "/air-fare-detail/v2"],
  ["/air-book/v2", "/air-book/v2"],
  ["/air-booking-detail/v2", "/air-booking-detail/v2"],
  ["/air-cancel/v2", "/air-cancel/v2"],
]);

export function loadConfig(env = process.env) {
  const required = ["POOMAS_GATEWAY_KEY"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

  const upstream = new URL(env.TRIPJACK_UPSTREAM ?? "https://apitest.tripjack.com");
  if (upstream.protocol !== "https:") throw new Error("TRIPJACK_UPSTREAM must use HTTPS");

  return {
    port: Number(env.PORT ?? 3000),
    upstream,
    // Optional fallback for self-hosted callers. Cloudflare normally supplies
    // the TripJack key per request after authenticating to this gateway.
    tripjackApiKey: env.TRIPJACK_API_KEY ?? "",
    gatewayKey: env.POOMAS_GATEWAY_KEY,
    requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS ?? 45000),
    maxBodyBytes: Number(env.MAX_BODY_BYTES ?? 2_097_152),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 120),
    circuitFailureThreshold: Number(env.CIRCUIT_FAILURE_THRESHOLD ?? 5),
    circuitResetMs: Number(env.CIRCUIT_RESET_MS ?? 30000),
  };
}

export function secretsEqual(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function upstreamUrl(upstream, pathname) {
  return new URL(pathname, `${upstream.origin}/`).toString();
}
