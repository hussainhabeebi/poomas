import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { hotelRoutes } from "../src/routes/hotel.js";
test("hotel review validation returns readable reason", async () => {
  const app = new Hono<any>();
  const logs: any[] = [];
  app.use("*", async (c, n) => { c.set("tenantId", "t"); c.set("db", { insert: () => ({ values: async (v: any) => { logs.push(v); } }) }); await n(); });
  app.route("/h", hotelRoutes);
  const res = await app.fetch(new Request("http://x/h/review", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correlationId: "abcdefgh12", hid: "100000038374", optionId: "", checkIn: "2026-10-01", checkOut: "2026-10-08", rooms: [{ adults: 2, children: 0 }], nationality: "IN", currency: "INR" }) }),
    {}, { waitUntil: (p: any) => p, passThroughOnException() {} } as any);
  const d: any = await res.json();
  console.log(res.status, d.error);
  assert.equal(res.status, 400);
  assert.match(d.error, /optionId/);
});
