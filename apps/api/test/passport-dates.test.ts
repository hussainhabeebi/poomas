import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { bookDirectRoutes } from "../src/routes/book.js";
import { bookingError } from "../../web/app/book/booking-error.js";
import { displayPassengerDate, isPassportDate, maskPassengerDate, normalizePassportDateEntry, normalizedPassportDates, passengerCalendarMonth, passengerDateFromDisplay, passengerDateProblems, passportDateProblems, passportToday, pastedPassengerDate } from "../../../packages/types/src/passport-dates.js";

test("passport dates require exactly four positive year digits", () => {
  for (const value of ["222222-04-23", "22222-04-23", "026-04-23", "26-04-23", "0000-04-23", "+2026-04-23", "2026-4-23", "2026-04-3"])
    assert.equal(isPassportDate(value), false, value);
  for (const value of ["0001-01-01", "2026-04-23", "9999-12-31"]) assert.equal(isPassportDate(value), true, value);
});
test("passport dates reject impossible dates rather than rolling into the next month", () => {
  for (const value of ["2026-02-29", "1900-02-29", "2026-04-31", "2026-00-23", "2026-13-23", "2026-04-00", "2026-04-32", "04/23/222222", "2026-04-23T00:00:00Z"])
    assert.equal(isPassportDate(value), false, value);
  for (const value of ["2024-02-29", "2000-02-29", "2026-04-30"]) assert.equal(isPassportDate(value), true, value);
});
test("issue today is allowed but issue tomorrow is rejected", () => {
  assert.deepEqual(passportDateProblems({ passportIssueDate: "2026-10-14" }, "2026-10-14"), {});
  assert.equal(passportDateProblems({ passportIssueDate: "2026-10-15" }, "2026-10-14").passportIssueDate, "Passport issue date cannot be in the future.");
});
test("expiry must be strictly later than a valid issue date", () => {
  for (const expiry of ["2020-04-22", "2020-04-23"]) assert.match(passportDateProblems({ passportIssueDate: "2020-04-23", passportExpiry: expiry }, "2026-10-14").passportExpiry!, /later than/);
  assert.deepEqual(passportDateProblems({ passportIssueDate: "2020-04-23", passportExpiry: "2030-04-23" }, "2026-10-14"), {});
});
test("invalid dates retain field-specific errors instead of a misleading chronology error", () => {
  const problems = passportDateProblems({ passportIssueDate: "2020-02-30", passportExpiry: "222222-04-23" }, "2026-10-14");
  assert.match(problems.passportIssueDate!, /valid date.*four-digit/);
  assert.match(problems.passportExpiry!, /valid date.*four-digit/);
});
test("optional blank passport dates do not change existing domestic booking requirements", () => {
  assert.deepEqual(passportDateProblems({}), {});
  assert.deepEqual(passportDateProblems({ passportIssueDate: "", passportExpiry: "" }), {});
});
test("numeric mobile entry produces the same ISO date as calendar selection", () => {
  for (const [digits, expected] of [["20260423", "2026-04-23"], ["20240229", "2024-02-29"], ["20300423", "2030-04-23"]]) {
    assert.equal(normalizePassportDateEntry(digits), expected);
    assert.equal(normalizePassportDateEntry(expected), expected);
    assert.equal(isPassportDate(expected), true);
  }
  assert.deepEqual(normalizedPassportDates({ passportIssueDate: "20200423", passportExpiry: "20300423" }), {
    passportIssueDate: "2020-04-23", passportExpiry: "2030-04-23",
  });
});
test("mobile incomplete, impossible and oversized dates are never truncated into valid dates", () => {
  for (const raw of ["2026", "202604", "20260230", "2222220423", "222222-04-23", "2026-04-23123", "04/23/222222"])
    assert.equal(isPassportDate(normalizePassportDateEntry(raw)), false, raw);
  assert.equal(normalizePassportDateEntry("222222-04-23"), "222222-04-23");
});
test("calendar-date serialization and today's reference do not shift across timezones", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["Pacific/Honolulu", "UTC", "Asia/Karachi", "Pacific/Kiritimati"]) {
      process.env.TZ = timezone;
      assert.equal(passportToday(new Date("2026-10-14T00:15:00Z")), "2026-10-14");
      assert.equal(JSON.stringify(normalizedPassportDates({ passportExpiry: "20300423" })), '{"passportExpiry":"2030-04-23"}');
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("booking API rejects invalid passport dates before any supplier or persistence call", async (t) => {
  const originalFetch = globalThis.fetch;
  let supplierCalls = 0, databaseCalls = 0;
  globalThis.fetch = async () => { supplierCalls++; throw new Error("Unexpected supplier request"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId" as never, "mock-tenant" as never);
    c.set("db" as never, { insert: () => { databaseCalls++; throw new Error("Unexpected DB write"); } } as never);
    await next();
  });
  app.route("/book", bookDirectRoutes);
  const base = {
    fareId: "mock-fare", supplier: "TRIPJACK", contactEmail: "mock@example.test", contactPhone: "+919999999999",
    origin: "COK", destination: "DXB", departureDate: "2030-04-01", totalFare: 250,
  };
  for (const [patch, message] of [
    [{ passportExpiry: "222222-04-23" }, /expiry date.*four-digit/],
    [{ passportIssueDate: "222222-04-23" }, /issue date.*four-digit/],
    [{ passportExpiry: "2026-04-31" }, /expiry date.*valid date/],
    [{ passportIssueDate: "2026-02-30" }, /issue date.*valid date/],
    [{ passportIssueDate: "9999-04-23" }, /cannot be in the future/],
    [{ passportIssueDate: "2020-04-23", passportExpiry: "2020-04-23" }, /later than/],
    [{ passportIssueDate: "2020-04-23", passportExpiry: "2019-04-23" }, /later than/],
    [{ passportExpiry: "20300423" }, /YYYY-MM-DD/],
    [{ dob: "275760-05-05" }, /birth.*four-digit/],
    [{ dob: "1900-02-29" }, /birth.*valid date/],
    [{ dob: "9999-05-05" }, /birth.*future/],
    [{ dob: "05/05/2000" }, /birth.*YYYY-MM-DD/],
  ] as const) {
    for (const holdOnly of [false, true]) {
      const response = await app.request("/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        ...base, holdOnly, passengers: [{ type: "ADULT", firstName: "Arun", lastName: "Kumar", passportNumber: "MOCK123", ...patch }],
      }) }, {});
      const data = await response.json();
      assert.equal(response.status, 400);
      assert.equal(data.errorCode, "BOOKING_DETAILS_INVALID");
      assert.match(bookingError(data, response.status), message);
    }
  }
  assert.equal(supplierCalls, 0); assert.equal(databaseCalls, 0);
});

test("booking API accepts valid ISO passport dates and keeps optional dates optional", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("No live supplier requests allowed"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId" as never, "mock-tenant" as never);
    c.set("tenant" as never, { supplierConfigs: [] } as never);
    c.set("db" as never, {} as never);
    await next();
  });
  app.route("/book", bookDirectRoutes);
  for (const dates of [{}, { dob: "2000-02-29", passportIssueDate: "2020-02-29", passportExpiry: "2030-04-23" }, { passportExpiry: "2030-04-23" }]) {
    const response = await app.request("/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      fareId: "mock-fare", supplier: "TRIPJACK", contactEmail: "mock@example.test", contactPhone: "+919999999999",
      origin: "COK", destination: "DXB", departureDate: "2030-04-01", totalFare: 250,
      passengers: [{ type: "ADULT", firstName: "Arun", lastName: "Kumar", ...dates }],
    }) }, { TENANT_CACHE_KV: { get: async () => null } });
    // Deliberately disabled mock supplier proves the request passed validation
    // without executing a booking or touching records.
    assert.equal(response.status, 503);
    assert.equal((await response.json()).errorCode, "BOOKING_UNAVAILABLE");
  }
  assert.equal(calls, 0);
});

test("DOB validates calendar days and past/current dates without changing optional requirements", () => {
  for (const dob of ["", "2000-02-29", "2026-10-14"]) assert.deepEqual(passengerDateProblems({ dob }, "2026-10-14"), {});
  for (const dob of ["275760-05-05", "0000-05-05", "1900-02-29", "2025-04-31"]) assert.match(passengerDateProblems({ dob }, "2026-10-14").dob!, /valid date/);
  assert.match(passengerDateProblems({ dob: "2026-10-15" }, "2026-10-14").dob!, /future/);
  assert.match(passengerDateProblems({ dob: "2000-02-29", passportIssueDate: "2020-01-01", passportExpiry: "2019-12-31" }).passportExpiry!, /later than/);
});

test("DD/MM/YYYY typing and numeric mobile drafts are bounded without truncation", () => {
  const drafts = ["0", "05", "05/0", "05/05", "05/05/2", "05/05/20", "05/05/200", "05/05/2000"];
  drafts.forEach((expected, i) => assert.equal(maskPassengerDate("05052000".slice(0, i + 1)), expected));
  for (const raw of ["0505275760", "05/05/275760", "4444444444", "letters", "05-05-2000"]) assert.equal(maskPassengerDate(raw), undefined);
  assert.equal(passengerDateFromDisplay("05/05/2000"), "2000-05-05");
  for (const raw of ["05/05/275760", "29/02/1900", "31/04/2020", "00/01/2000", "05/05/200"]) assert.equal(passengerDateFromDisplay(raw), undefined);
});

test("paste supports explicit display/ISO formats and never salvages oversized years", () => {
  for (const raw of ["29/02/2000", "29022000", "2000-02-29", " 29/2/2000 "]) assert.equal(pastedPassengerDate(raw), "29/02/2000");
  for (const raw of ["05/05/275760", "4444444444", "2020-01-011", "5/5/20", "05/05/2000 extra"]) assert.equal(pastedPassengerDate(raw), undefined);
  assert.equal(pastedPassengerDate("31/04/2000"), "31/04/2000"); // Kept editable, but cannot submit.
});

test("calendar selection matches manual entry including leap years and historical DOB years", () => {
  for (const [year, days] of [[1900, 28], [2000, 29], [2024, 29], [2025, 28]]) assert.equal(passengerCalendarMonth(year, 2).days, days);
  assert.deepEqual(passengerCalendarMonth(1, 1), { weekday: 1, days: 31 });
  for (const date of ["0001-01-01", "1900-05-05", "2000-02-29", "2030-04-23"]) assert.equal(passengerDateFromDisplay(displayPassengerDate(date)), date);
});

test("display and API dates stay identical across timezones", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["Pacific/Honolulu", "UTC", "Asia/Kolkata", "Pacific/Kiritimati"]) {
      process.env.TZ = timezone;
      assert.equal(displayPassengerDate("2000-02-29"), "29/02/2000");
      assert.equal(passengerDateFromDisplay("29/02/2000"), "2000-02-29");
      assert.equal(passengerCalendarMonth(2000, 2).days, 29);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
