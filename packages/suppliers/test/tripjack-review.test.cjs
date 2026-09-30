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

test('TripJack review contract and safe error handling', async (t) => {
  const { TripjackClient } = await import(moduleUrl('../src/tripjack/client.ts'));
  const client = new TripjackClient({ baseUrl: 'https://gateway.example', apiKey: 'test' });
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  await t.test('sends priceIds and returns reviewed booking ID', async () => {
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://gateway.example/fms/v1/review');
      assert.deepEqual(JSON.parse(options.body), { priceIds: ['price-1'] });
      assert.ok(options.signal);
      return Response.json({ bookingId: 'review-1', status: { success: true } });
    };
    assert.equal((await client.validateFare('price-1')).bookingId, 'review-1');
  });

  await t.test('unspecified supplier failure is not invented expiry', async () => {
    global.fetch = async () => Response.json({ status: { success: false } });
    await assert.rejects(client.validateFare('price-1'), (err) => {
      assert.equal(err.code, 'REVIEW_REJECTED');
      return true;
    });
  });

  await t.test('missing booking session fails closed', async () => {
    global.fetch = async () => Response.json({ status: { success: true } });
    await assert.rejects(client.validateFare('price-1'), (err) => err.code === 'REVIEW_INVALID_RESPONSE');
  });

  await t.test('route 404 is not fare expiry', async () => {
    global.fetch = async () => new Response('{}', { status: 404 });
    await assert.rejects(client.validateFare('price-1'), (err) => err.code === 'REVIEW_ROUTE_UNAVAILABLE');
  });

  await t.test('TripJack 404 error body means the fare is gone', async () => {
    global.fetch = async () => Response.json({ status: { success: false, httpStatus: 404 }, errors: [{ errCode: '2502', message: 'Invalid price id' }] }, { status: 404 });
    await assert.rejects(client.validateFare('price-1'), (err) => {
      assert.equal(err.code, 'FARE_EXPIRED');
      assert.match(err.supplierMessage, /Invalid price id/);
      return true;
    });
  });

  await t.test('explicit supplier fare expiry is preserved', async () => {
    global.fetch = async () => Response.json({ status: { success: false, statusMessage: 'Fare has expired' } });
    await assert.rejects(client.validateFare('price-1'), /Fare has expired/);
  });

  for (const wrapper of ['data', 'result']) await t.test(`accepts ${wrapper}-wrapped review`, async () => {
    global.fetch = async () => Response.json({ [wrapper]: { status: { success: true }, bookingId: 'wrapped' } });
    assert.equal((await client.validateFare('price-1')).bookingId, 'wrapped');
  });
  await t.test('credential expiry cannot be mistaken for fare expiry', async () => {
    global.fetch = async () => Response.json({ errors: [{ errCode: '6041', message: 'API token expired' }] }, { status: 401 });
    await assert.rejects(client.validateFare('price-1'), (err) => err.code === 'REVIEW_AUTH_FAILED');
  });
  await t.test('HTTP 400 structured fare expiry is recognised', async () => {
    global.fetch = async () => Response.json({ errors: [{ message: 'Fare has expired' }] }, { status: 400 });
    await assert.rejects(client.validateFare('price-1'), (err) => err.code === 'FARE_EXPIRED');
  });
});

test('TripJack seat map parsing and seat pricing', async () => {
  const { parseTripjackSeatMap, seatTotal } = await import(moduleUrl('../src/tripjack/seat-map.ts'));
  const maps = parseTripjackSeatMap({ tripSeatMap: { tripSeat: { SEG1: { sData: { row: 30, column: 6 }, sInfo: [
    { seatNo: '1A', code: '1A', seatPosition: { row: 1, column: 1 }, isBooked: false, amount: 500, isLegroom: true },
    { seatNo: '1B', code: '1B', seatPosition: { row: 1, column: 2 }, isBooked: true, amount: 0 },
    { seatNo: '12C', code: '12C', amount: 250, isAisle: true },
  ] } } } });
  assert.equal(maps.length, 1);
  assert.equal(maps[0].key, 'SEG1');
  assert.equal(maps[0].rows, 30);
  assert.deepEqual([maps[0].seats[2].row, maps[0].seats[2].column], [12, 3]);
  assert.deepEqual(seatTotal(maps, [{ type: 'ADULT', ssr: { seat: [{ key: 'SEG1', code: '1A' }] } }, { type: 'CHILD', ssr: { seat: [{ key: 'SEG1', code: '12C' }] } }]), { total: 750, invalid: [] });
  assert.equal(seatTotal(maps, [{ type: 'ADULT', ssr: { seat: [{ key: 'SEG1', code: '1B' }] } }]).invalid.length, 1);
  assert.equal(seatTotal(maps, [{ ssr: { seat: [{ key: 'SEG1', code: '1A' }] } }, { ssr: { seat: [{ key: 'SEG1', code: '1A' }] } }]).invalid.length, 1);
  assert.equal(seatTotal(maps, [{ type: 'INFANT', ssr: { seat: [{ key: 'SEG1', code: '1A' }] } }]).invalid.length, 1);
});

test('TripJack search price covers every traveller', async () => {
  const { normalizeTripjackFare } = await import(moduleUrl('../src/tripjack/normalizer.ts'));
  const r = { id: 'P1', sI: [{ fD: { aI: { code: 'AI' }, fN: '996' }, da: { code: 'DXB' }, aa: { code: 'BKK' } }],
    totalPriceInfo: { fd: { ADULT: { fC: { BF: 1500, TAF: 304.9, TF: 1804.9 } }, CHILD: { fC: { BF: 1200, TAF: 300, TF: 1500 } }, INFANT: { fC: { BF: 150, TAF: 50, TF: 200 } } } } };
  const f = normalizeTripjackFare(r, { pax: { adults: 5, children: 3, infants: 2 } });
  assert.equal(f.totalFare, 5 * 1804.9 + 3 * 1500 + 2 * 200);
  assert.equal(f.perAdultFare, 1804.9);
  assert.equal(normalizeTripjackFare(r).totalFare, 1804.9);   // no pax context: unchanged
});
