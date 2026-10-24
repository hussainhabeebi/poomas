import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { fileURLToPath } from "node:url";

// Exercise the real controlled React component and validation, without booking,
// network access, native date-picker dependencies or a browser installation.
const bundle = await build({
  stdin: { contents: `
    import { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { PassengerDateInput } from "./app/book/PassengerDateInput";
    import { passengerDateProblems, passportToday } from "../../packages/types/src/passport-dates";
    function Fixture() {
      const [p, set] = useState(window.initialDates || {});
      const problems = passengerDateProblems(p);
      return <form onSubmit={e => {e.preventDefault(); window.submitted = p;}}>
        {[['dob','Date of birth'],['passportIssueDate','Passport issue date'],['passportExpiry','Passport expiry']].map(([key,label]) =>
          <PassengerDateInput key={key} label={label} value={p[key] || ''} required
            historical={key !== 'passportExpiry'} max={key === 'passportExpiry' ? '9999-12-31' : passportToday()}
            problem={problems[key]} onChange={value => { window.currentDates = {...p,[key]:value}; set(window.currentDates); }} />)}
        <button type="submit">Continue</button>
      </form>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, write: false, outdir: "/virtual", jsx: "automatic", platform: "browser",
});
const script = bundle.outputFiles.find(f => f.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(f => f.path.endsWith(".css")).text;
const settle = () => new Promise(resolve => setTimeout(resolve, 35));

async function fixture(t, initialDates = {}) {
  const errors = [];
  const console = new VirtualConsole(); console.on("jsdomError", e => errors.push(e));
  const dom = new JSDOM(`<style>${css}</style><div id="root"></div>`, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://fixture.invalid", virtualConsole: console,
    beforeParse(window) { window.initialDates = initialDates; },
  });
  dom.window.eval(script);
  await settle();
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const { window } = dom, { document } = window;
  const fields = [...document.querySelectorAll('input[type="text"]')];
  async function enter(input, raw) {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, raw);
    input.setSelectionRange(raw.length, raw.length);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle();
  }
  async function paste(input, raw) {
    input.setSelectionRange(0, input.value.length);
    const event = new window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => raw } });
    input.dispatchEvent(event); await settle(); assert.equal(event.defaultPrevented, true);
  }
  return { window, document, fields, enter, paste };
}

test("all date fields use one numeric, bounded input and one internal calendar icon", async t => {
  const { document, fields } = await fixture(t);
  assert.equal(fields.length, 3);
  assert.equal(document.querySelectorAll('input[type="date"]').length, 0);
  fields.forEach(input => {
    assert.equal(input.placeholder, "DD/MM/YYYY"); assert.equal(input.inputMode, "numeric"); assert.equal(input.maxLength, 10);
    assert.equal(input.parentElement.querySelectorAll("button svg").length, 1);
  });
});

test("manual numeric typing formats DOB and emits canonical ISO; a fifth year digit is prevented", async t => {
  const { window, fields, enter } = await fixture(t);
  const input = fields[0];
  for (const digit of "05052000") await enter(input, input.value + digit);
  assert.equal(input.value, "05/05/2000"); assert.equal(window.currentDates.dob, "2000-05-05");
  const key = new window.KeyboardEvent("keydown", { key: "7", bubbles: true, cancelable: true });
  input.dispatchEvent(key); await settle();
  assert.equal(key.defaultPrevented, true); assert.equal(input.value, "05/05/2000");
  assert.match(input.validationMessage, /four-digit year/);
  input.setSelectionRange(6, 10);
  const replace = new window.KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true });
  input.dispatchEvent(replace); assert.equal(replace.defaultPrevented, false);
  await enter(input, "05/05/1999"); assert.equal(input.validationMessage, "");
});

test("oversized typing/paste cannot enter the field, while valid display, numeric and ISO paste work", async t => {
  const { fields, enter, paste } = await fixture(t);
  for (const input of fields) {
    await paste(input, "05/05/275760"); assert.equal(input.value, ""); assert.match(input.validationMessage, /four-digit year/);
    await enter(input, "4444444444"); assert.equal(input.value, "");
    for (const value of ["05/05/2000", "05052000", "2000-05-05", "5/5/2000"]) {
      await paste(input, value); assert.equal(input.value, "05/05/2000");
    }
  }
});

test("impossible dates, future DOB/issue and reversed passport dates cannot submit", async t => {
  const { document, fields, paste, window } = await fixture(t);
  for (const raw of ["29/02/1900", "31/04/2000", "00/05/2000"]) {
    await paste(fields[0], raw); assert.match(fields[0].validationMessage, /real date/);
  }
  await paste(fields[0], "29/02/2000"); assert.equal(fields[0].validationMessage, "");
  await paste(fields[0], "01/01/9999"); assert.match(fields[0].validationMessage, /future/);
  await paste(fields[1], "01/01/9999"); assert.match(fields[1].validationMessage, /future/);
  await paste(fields[1], "23/04/2020"); await paste(fields[2], "23/04/2020");
  assert.match(fields[2].validationMessage, /later than/);
  document.querySelector('button[type="submit"]').click(); assert.equal(window.submitted, undefined);
});

test("historical calendar year/month selection handles leap days, ISO output and focus restoration", async t => {
  const { document, fields, window } = await fixture(t);
  const toggle = fields[0].parentElement.querySelector("button"); toggle.click(); await settle();
  const years = document.querySelector('[aria-label="Calendar year"]');
  assert.ok([...years.options].some(o => o.value === "1950"));
  years.value = "2000"; years.dispatchEvent(new window.Event("change", { bubbles: true })); await settle();
  const month = document.querySelector('[aria-label="Calendar month"]');
  month.value = "2"; month.dispatchEvent(new window.Event("change", { bubbles: true })); await settle();
  const day = document.querySelector('[aria-label="29/02/2000"]'); assert.ok(day); day.click(); await settle();
  assert.equal(fields[0].value, "29/02/2000"); assert.equal(window.currentDates.dob, "2000-02-29");
  assert.equal(document.querySelector('[role="dialog"]'), null); assert.equal(document.activeElement, toggle);
  toggle.click(); await settle();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle();
  assert.equal(toggle.getAttribute("aria-expanded"), "false"); assert.equal(document.activeElement, toggle);
});

test("calendar selection for both passport fields preserves chronology and valid form submission", async t => {
  const { document, fields, window } = await fixture(t, { dob: "2000-05-05", passportIssueDate: "2020-04-22", passportExpiry: "2030-04-22" });
  for (const [i, date] of [[1,"23/04/2020"],[2,"23/04/2030"]]) {
    fields[i].parentElement.querySelector("button").click(); await settle();
    document.querySelector(`[aria-label="${date}"]`).click(); await settle();
  }
  document.querySelector('button[type="submit"]').click(); await settle();
  assert.equal(JSON.stringify(window.submitted), '{"dob":"2000-05-05","passportIssueDate":"2020-04-23","passportExpiry":"2030-04-23"}');
});

test("editing or clearing a valid date removes stale ISO state and blocks required submission", async t => {
  const { fields, enter, window } = await fixture(t, { dob: "2000-05-05" });
  await enter(fields[0], "05/05/200"); assert.equal(window.currentDates.dob, "05/05/200"); assert.equal(fields[0].checkValidity(), false);
  await enter(fields[0], ""); assert.equal(window.currentDates.dob, ""); assert.equal(fields[0].checkValidity(), false);
});

test("backspace at a separator edits the preceding digit and partial paste can replace the year", async t => {
  const { fields, window } = await fixture(t, { dob: "2000-05-05" });
  const input = fields[0]; input.setSelectionRange(3, 3);
  const backspace = new window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  input.dispatchEvent(backspace); await settle();
  assert.equal(backspace.defaultPrevented, true); assert.equal(input.value, "00/52/000");
  assert.equal(input.checkValidity(), false);
  input.setSelectionRange(6, input.value.length);
  const paste = new window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", { value: { getData: () => "1999" } });
  input.dispatchEvent(paste); await settle();
  assert.equal(input.value, "00/52/1999"); assert.match(input.validationMessage, /real date/);
});

test("leap-century calendar omits February 29 and arrow keys cross month boundaries", async t => {
  const { document, fields, window } = await fixture(t, { dob: "1900-02-28" });
  fields[0].parentElement.querySelector("button").click(); await settle();
  assert.equal(document.querySelector('[aria-label="29/02/1900"]'), null);
  const day = document.querySelector('[aria-label="28/02/1900"]'); day.focus();
  day.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await settle();
  assert.equal(document.activeElement.getAttribute("aria-label"), "01/03/1900");
  document.activeElement.click(); await settle(); assert.equal(window.currentDates.dob, "1900-03-01");
});

test("an imported historical year stays selectable without an excessively large year menu", async t => {
  const { document, fields, window } = await fixture(t, { dob: "0001-01-01", passportExpiry: "9999-12-31" });
  fields[0].parentElement.querySelector("button").click(); await settle();
  const years = document.querySelector('[aria-label="Calendar year"]');
  assert.ok(years.options.length < 150); assert.equal(years.value, "1");
  document.querySelector('[aria-label="02/01/0001"]').click(); await settle();
  assert.equal(window.currentDates.dob, "0001-01-02");
  fields[2].parentElement.querySelector("button").click(); await settle();
  const expiryYears = document.querySelector('[aria-label="Calendar year"]');
  assert.ok(expiryYears.options.length < 50); assert.equal(expiryYears.value, "9999");
});

test("keyboard calendar opening and arrow navigation work; future DOB days are disabled", async t => {
  const { window, document, fields } = await fixture(t, { dob: "2000-05-05" });
  fields[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true })); await settle();
  const day = document.querySelector('[aria-label="05/05/2000"]'); day.focus();
  day.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(document.activeElement.getAttribute("aria-label"), "06/05/2000");
  const year = document.querySelector('[aria-label="Calendar year"]'); year.value = String(new Date().getUTCFullYear());
  year.dispatchEvent(new window.Event("change", { bubbles: true })); await settle();
  const month = document.querySelector('[aria-label="Calendar month"]'); month.value = "12";
  month.dispatchEvent(new window.Event("change", { bubbles: true })); await settle();
  const future = document.querySelector(`[aria-label="31/12/${new Date().getUTCFullYear()}"]`);
  if (new Date().toISOString().slice(5,10) !== "12-31") assert.equal(future.disabled, true);
});
