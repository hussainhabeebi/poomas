import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, secretsEqual, upstreamUrl } from "../src/gateway.mjs";

test("loads a secure UAT configuration", () => {
  const config = loadConfig({ TRIPJACK_API_KEY: "tripjack", POOMAS_GATEWAY_KEY: "internal" });
  assert.equal(config.upstream.origin, "https://apitest.tripjack.com");
  assert.equal(config.port, 3000);
});

test("rejects missing secrets and insecure upstreams", () => {
  assert.throws(() => loadConfig({}), /Missing required/);
  assert.throws(() => loadConfig({
    TRIPJACK_API_KEY: "tripjack",
    POOMAS_GATEWAY_KEY: "internal",
    TRIPJACK_UPSTREAM: "http://apitest.tripjack.com",
  }), /must use HTTPS/);
});

test("compares gateway secrets without accepting length mismatches", () => {
  assert.equal(secretsEqual("same-secret", "same-secret"), true);
  assert.equal(secretsEqual("wrong", "same-secret"), false);
  assert.equal(secretsEqual("", "same-secret"), false);
});

test("constructs the TripJack URL without duplicating paths", () => {
  assert.equal(
    upstreamUrl(new URL("https://apitest.tripjack.com"), "/air-search-all/v2"),
    "https://apitest.tripjack.com/air-search-all/v2",
  );
});

