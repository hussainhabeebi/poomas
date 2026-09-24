import { timingSafeEqual } from "node:crypto";

export const ROUTES = new Map([
  // Canonical Poomas v1 alias paths
  ["/v1/air/search", "/fms/v1/air-search-all"],
  ["/v1/air/fare-detail", "/fms/v2/farerule"],
  ["/v1/air/review", "/fms/v1/review"],
  ["/v1/air/book", "/oms/v1/air/book"],
  ["/v1/air/booking-detail", "/oms/v1/booking-details"],
  ["/v1/air/cancel", "/oms/v1/air/amendment/submit-amendment"],
  // TripJack native paths — forwarded 1:1 to the upstream
  ["/air-search-all/v2", "/fms/v1/air-search-all"],
  ["/fms/v1/review", "/fms/v1/review"],
  ["/fms/v2/farerule", "/fms/v2/farerule"],
  ["/oms/v1/air/book", "/oms/v1/air/book"],
  ["/oms/v1/booking-details", "/oms/v1/booking-details"],
  ["/oms/v1/air/amendment/submit-amendment", "/oms/v1/air/amendment/submit-amendment"],
  ["/oms/v1/air/amendment/amendment-charges", "/oms/v1/air/amendment/amendment-charges"],
  ["/oms/v1/air/amendment/amendment-details", "/oms/v1/air/amendment/amendment-details"],
  // Legacy paths kept for backwards compatibility
  ["/air-fare-detail/v2", "/fms/v2/farerule"],
  ["/air-book/v2", "/oms/v1/air/book"],
  ["/air-booking-detail/v2", "/oms/v1/booking-details"],
  ["/air-cancel/v2", "/oms/v1/air/amendment/submit-amendment"],
  // Hotel routes
  ["/hotel-search/v1", "/hotel-search/v1"],
  ["/hotel-prebook/v1", "/hotel-prebook/v1"],
  ["/hotel-book/v1", "/hotel-book/v1"],
  ["/hotel-booking-detail/v1", "/hotel-booking-detail/v1"],
  ["/hotel-cancel/v1", "/hotel-cancel/v1"],
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
