const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function moduleUrl(file) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return 'data:text/javascript;base64,' + Buffer.from(output.replace(
    /from "(\.[^"]+\.js)"/g,
    (_, dependency) => 'from ' + JSON.stringify(moduleUrl(path.join(path.dirname(file), dependency.replace(/\.js$/, '.ts')))),
  )).toString('base64');
}

test('review segments carry checkout itinerary details', async () => {
  const { parseTripjackReview } = await import(moduleUrl('../src/tripjack/review.ts'));
  const r = parseTripjackReview({
    bookingId: 'TJ1',
    tripInfos: [{
      sI: [{
        id: 's1', dt: '2026-11-14T10:30', at: '2026-11-14T13:15', duration: 225,
        fD: { aI: { code: '6E', name: 'IndiGo' }, fN: '1402', eT: '320' },
        da: { code: 'COK', city: 'Kochi', name: 'Cochin International Airport', terminal: '3' },
        aa: { code: 'DXB', city: 'Dubai', name: 'Dubai International Airport', terminal: ' ' },
      }],
      totalPriceList: [{ fareIdentifier: 'PUBLISHED', fd: { ADULT: { cc: 'ECONOMY', cB: 'Q', mI: false, rT: 1, bI: { iB: '30 Kg', cB: '7 Kg' }, fC: { TF: 100 } } } }],
    }],
  });
  const s = r.segments[0];
  assert.equal(s.originCity, 'Kochi');
  assert.equal(s.originAirport, 'Cochin International Airport');
  assert.equal(s.departureTerminal, '3');
  assert.equal(s.arrivalTerminal, undefined);   // blank terminal is left out
  assert.equal(s.aircraft, '320');
  assert.equal(s.cabinClass, 'ECONOMY');
  assert.equal(s.bookingClass, 'Q');
  assert.equal(s.checkedBaggage, '30 Kg');
  assert.equal(s.cabinBaggage, '7 Kg');
  assert.equal(s.mealIncluded, false);
  assert.equal(s.refundable, true);
  assert.equal(s.key, 's1');
});
