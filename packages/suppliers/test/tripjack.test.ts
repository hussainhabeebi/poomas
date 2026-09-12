import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTripjackFare } from "../src/tripjack/normalizer.js";
import { TripjackClient } from "../src/tripjack/client.js";

const trip = { id: "search-price", sI: [
  { da: { code: "COK" }, aa: { code: "DEL" }, dt: "2026-09-26T09:00", at: "2026-09-26T12:00", duration: 180, cT: 90 },
  { da: { code: "DEL" }, aa: { code: "DXB" }, dt: "2026-09-26T13:30", at: "2026-09-26T16:00", duration: 240 },
] };
test("parses live passenger-keyed prices, counts, and final destination", () => {
  const fare = normalizeTripjackFare({ ...trip, totalPriceInfo: { fd: {
    ADULT: { fC: { BF: 18435, TAF: 9588.59, TF: 28023.59 }, bI: { iB: "30 Kg" }, rT: 1 },
    CHILD: { fC: { BF: 10000, TAF: 500, TF: 10500 } },
  } } }, { ADULT: 2, CHILD: 1, INFANT: 0 });
  assert.equal(fare.totalFare, 66547.18);
  assert.equal(fare.destination, "DXB");
  assert.equal(fare.duration, 510);
  assert.equal(fare.baggage.checked, "30 Kg");
  assert.equal(fare.isBookable, true);
});
test("missing price is not a free bookable ticket", () => {
  assert.equal(normalizeTripjackFare(trip).isBookable, false);
});
test("review sends priceIds and reads a new booking ID and aggregate price", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://gateway.test/fms/v1/review");
    assert.deepEqual(JSON.parse(String(init?.body)), { priceIds: ["search-price"] });
    return Response.json({ status: { success: true }, bookingId: "review-booking",
      tripInfos: [trip], totalPriceInfo: { totalFareDetail: { fC: { BF: 100, TAF: 20, TF: 120 } } } });
  };
  try {
    const review = await new TripjackClient({ baseUrl: "https://gateway.test", apiKey: "test" }).validateFare("search-price");
    assert.equal(review.bookingId, "review-booking");
    assert.equal(review.totalFare, 120);
  } finally { globalThis.fetch = original; }
});
test("HTTP 404 and invalid review responses are not classified as expired", async () => {
  const original = globalThis.fetch;
  const client = new TripjackClient({ baseUrl: "https://gateway.test", apiKey: "test" });
  try {
    globalThis.fetch = async () => Response.json({ error: "UNSUPPORTED_TRIPJACK_ROUTE" }, { status: 404 });
    await assert.rejects(client.validateFare("id"), (e: any) => !/expired/i.test(e.message));
    globalThis.fetch = async () => Response.json({ status: { success: false } });
    await assert.rejects(client.validateFare("id"));
    globalThis.fetch = async () => Response.json({ status: { success: true }, bookingId: "id" });
    await assert.rejects(client.validateFare("id"), /valid total price/);
  } finally { globalThis.fetch = original; }
});
