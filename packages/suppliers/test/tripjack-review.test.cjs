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
    '"../riya/client.js"', JSON.stringify(file.includes('tripjack') ? moduleUrl('../src/riya/client.ts') : ''),
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
      assert.equal(err.body, 'Fare verification unsuccessful');
      return true;
    });
  });

  await t.test('missing booking session fails closed', async () => {
    global.fetch = async () => Response.json({ status: { success: true } });
    await assert.rejects(client.validateFare('price-1'), /did not return a booking session/);
  });

  await t.test('route 404 is not fare expiry', async () => {
    global.fetch = async () => new Response('{}', { status: 404 });
    await assert.rejects(client.validateFare('price-1'), /route is unavailable/);
  });

  await t.test('explicit supplier fare expiry is preserved', async () => {
    global.fetch = async () => Response.json({ status: { success: false, statusMessage: 'Fare has expired' } });
    await assert.rejects(client.validateFare('price-1'), /Fare has expired/);
  });
});
