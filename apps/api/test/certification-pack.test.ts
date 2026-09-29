import test from "node:test";
import assert from "node:assert/strict";
import { certificationPack } from "../src/lib/certification.js";

test("certification pack uses TripJack file names and keeps the last call per service", async () => {
  const r2 = new Map<string, string>();
  const at = (m: number) => new Date(Date.UTC(2026, 9, 1, 10, m));
  const ex = (id: string, endpoint: string, m: number) => {
    r2.set(`${id}-rq`, JSON.stringify({ method: "POST", url: `https://gw.example${endpoint}`, headers: { apikey: "KEY", "X-Poomas-Gateway-Key": "secret" }, body: { id } }));
    r2.set(`${id}-rs.json`, JSON.stringify({ id, status: { success: true } }));
    return { id, endpoint, requestKey: `${id}-rq`, responseKey: `${id}-rs.json`, startedAt: at(m), url: `https://gw.example${endpoint}` };
  };
  const exchanges = [
    ex("s1", "/air-search-all/v2", 0), ex("r1", "/fms/v1/review", 1), ex("r2", "/fms/v1/review", 2),
    ex("seat", "/fms/v1/seat", 3), ex("b1", "/oms/v1/air/book", 4), ex("d1", "/oms/v1/booking-details", 5), ex("d2", "/oms/v1/booking-details", 6),
  ];
  let call = 0;
  const chain = (rows: any[]) => ({ from: () => ({ where: () => Object.assign(Promise.resolve(rows), { orderBy: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }) }) });
  const db: any = { select: () => chain(call++ === 0 ? exchanges : [{ firstName: "Anand", lastName: "Kumar", passengerType: "ADULT" }]) };
  const env: any = { DOCUMENTS_R2: { get: async (k: string) => r2.has(k) ? { text: async () => r2.get(k), arrayBuffer: async () => new TextEncoder().encode(r2.get(k)!).buffer } : null } };
  const booking: any = { id: "bk1", tenantId: "t1", supplier: "TRIPJACK", flightData: { searchId: "s", tripjack: {} }, createdAt: at(4), origin: "DEL", destination: "BOM", tripType: "ONEWAY" };
  const files = await certificationPack(env, db, booking, "UAT");
  const names = files.map((f) => f.name);
  assert.deepEqual(names, ["BookingSummary.json", "SearchRequest.json", "SearchResponse.json", "ReviewRequest.json", "ReviewResponse.json",
    "SeatMapRequest.json", "SeatMapResponse.json", "BookingRequest.json", "BookingResponse.json", "BookingDetailRequest.json", "BookingDetailResponse.json"]);
  const dec = (n: string) => JSON.parse(new TextDecoder().decode(files.find((f) => f.name === n)!.data));
  assert.equal(dec("ReviewRequest.json").body.id, "r2");
  assert.equal(dec("BookingDetailResponse.json").id, "d2");
  assert.equal(dec("SearchRequest.json").url, "https://apitest.tripjack.com/fms/v1/air-search-all");
  assert.deepEqual(dec("SearchRequest.json").headers, { apikey: "KEY", "Content-Type": "application/json" });
  assert.equal(dec("BookingSummary.json").missingServices, undefined);
});
