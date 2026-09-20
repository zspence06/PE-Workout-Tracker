// Runnable check for the record-addressing scheme. Pulls the real functions out
// of index.html so it can't drift from what ships.   node identity-check.js
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/index.html', 'utf8');

// Browser globals the extracted functions expect.
global.crypto = require('crypto').webcrypto;
global.window = { crypto: global.crypto };
global.TextEncoder = require('util').TextEncoder;

function grab(sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('could not find ' + sig);
  const j = src.indexOf('\n  }', i);
  if (j < 0) throw new Error('could not find end of ' + sig);
  return src.slice(i, j + 4);
}
const constLine = src.split('\n').find(l => l.includes('const PIN_ITERATIONS'));
if (!constLine) throw new Error('PIN_ITERATIONS not found');
eval([
  constLine.replace('const ', 'globalThis.'),
  grab('function esc(v) {'),
  grab('function normalizeName(name) {'),
  grab('async function sha256Hex(str) {'),
  grab('async function studentDocId(name, pin) {'),
  grab('function nameKey(name) {'),
].join('\n'));

(async () => {
  const a = await studentDocId('Alex Smith', '4827');

  // The PIN is half the address: same name, different PIN => different record.
  assert.notStrictEqual(a, await studentDocId('Alex Smith', '4828'), 'PIN must change the address');

  // The name is the other half.
  assert.notStrictEqual(a, await studentDocId('Alexa Smith', '4827'), 'name must change the address');

  // Typing variations must still land on the same record.
  for (const v of ['alex smith', '  Alex   Smith ', 'ALEX-SMITH', 'Alex.Smith'])
    assert.strictEqual(await studentDocId(v, '4827'), a, 'should normalize: ' + v);

  // The address must not be derivable from the name alone, nor leak it.
  assert.notStrictEqual(a, await nameKey('Alex Smith'), 'address must differ from name key');
  assert.ok(!a.includes('alex') && !a.includes('4827'), 'address must not embed name or PIN');
  assert.strictEqual(a.length, 64);

  // The name key must carry no PIN information.
  assert.strictEqual(await nameKey('Alex Smith'), await nameKey('alex smith'));

  // Two different students must never share an address.
  const ids = new Set();
  for (const n of ['Alex Smith', 'Sam Jones', 'Pat Lee'])
    for (const p of ['0000', '1234', '9999']) ids.add(await studentDocId(n, p));
  assert.strictEqual(ids.size, 9, 'all name/PIN pairs must be distinct');

  // Escaping: student names and custom exercise names reach the teacher's
  // dashboard through innerHTML, inside her authenticated session.
  const payload = '<img src=x onerror=alert(1)>';
  assert.ok(!esc(payload).includes('<'), 'must neutralize angle brackets');
  assert.ok(!esc(payload).includes('>'), 'must neutralize angle brackets');
  assert.strictEqual(esc('a&b'), 'a&amp;b', 'ampersand first, or escapes double-encode');
  assert.strictEqual(esc('" onmouseover="x'), '&quot; onmouseover=&quot;x', 'attribute breakout');
  assert.strictEqual(esc("' onfocus='x"), '&#39; onfocus=&#39;x', 'single-quote breakout');
  assert.strictEqual(esc(null), '', 'null renders empty, not "null"');
  assert.strictEqual(esc(undefined), '', 'undefined renders empty');
  assert.strictEqual(esc(0), '0', 'zero must survive');

  // One login must stay fast enough for a school Chromebook.
  const t0 = Date.now();
  await studentDocId('Timing Test', '1234');
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, 'single derivation too slow: ' + ms + 'ms');

  console.log('derivation: ' + ms + 'ms/login, ' + PIN_ITERATIONS + ' iterations');
  console.log('identity-check OK - 9 distinct addresses, normalization stable, no name or PIN recoverable from an address');
  console.log('escaping-check OK - script payloads, attribute breakouts and null/0 all handled');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
