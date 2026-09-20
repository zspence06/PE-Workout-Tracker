// Runnable checks for the logic index.html depends on being exactly right:
// record addressing, HTML escaping, and number clamping. Pulls the real functions
// out of index.html so they cannot drift from what ships.   node self-check.js
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
const constLines = ['const PIN_ITERATIONS', 'const TARGET_MODAL_INTERVAL_MS', 'const DAILY_TARGET'].map(k => {
  const line = src.split('\n').find(l => l.includes(k));
  if (!line) throw new Error(k + ' not found');
  return line.trim().replace('const ', 'globalThis.');
});
eval([
  ...constLines,
  grab('function esc(v) {'),
  grab('function cleanNumber(value, max) {'),
  grab('function todayLocal() {'),
  grab('function doneToday(r, date) {'),
  grab('function composedScore(routines, day, date) {'),
  grab('function shouldShowTarget(now, seen, currentText) {'),
  grab('function nextFreeId(start, existing) {'),
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

  // Number clamping: sets/reps/weight are free-entry boxes. Clamp, never reject,
  // so a typo cannot block a student mid-workout.
  assert.strictEqual(cleanNumber('-5', 99), 0, 'negatives floor to 0');
  assert.strictEqual(cleanNumber('abc', 99), 0, 'garbage floors to 0');
  assert.strictEqual(cleanNumber('', 99), 0, 'empty floors to 0');
  assert.strictEqual(cleanNumber('7.9', 99), 7, 'decimals truncate');
  assert.strictEqual(cleanNumber('1e9', 2000), 2000, 'absurd values clamp to max');
  assert.strictEqual(cleanNumber('Infinity', 99), 0, 'Infinity is not a value: reads as 0, never leaks through');
  assert.strictEqual(cleanNumber('0', 99), 0, 'a skipped exercise stays 0');
  assert.strictEqual(cleanNumber('45', 2000), 45, 'ordinary values pass through');

  // Local date, not UTC: after 7pm CDT toISOString() already reads tomorrow.
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(todayLocal()), 'todayLocal shape');
  {
    const d = new Date();
    const expected = [d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')].join('-');
    assert.strictEqual(todayLocal(), expected, 'todayLocal must match the local calendar day');
  }

  // Learning-target modal: once per device per hour, but a changed target always
  // shows, or a class starting at 10:05 would miss a target rewritten at 10:00.
  {
    const HOUR = 60 * 60 * 1000, now = 1_000_000_000_000, T = 'squat depth';
    assert.strictEqual(shouldShowTarget(now, null, T), true, 'never seen -> show');
    assert.strictEqual(shouldShowTarget(now, { at: now - 60_000, text: T }, T), false,
      'seen a minute ago, unchanged -> stay quiet');
    assert.strictEqual(shouldShowTarget(now, { at: now - HOUR, text: T }, T), true,
      'an hour later -> show again');
    assert.strictEqual(shouldShowTarget(now, { at: now - 60_000, text: 'old target' }, T), true,
      'target changed -> show immediately, hour or not');
    assert.strictEqual(shouldShowTarget(now, { text: T }, T), true, 'missing timestamp -> show');
    assert.strictEqual(shouldShowTarget(now, { at: 'nonsense', text: T }, T), true,
      'corrupt timestamp -> show');
    assert.strictEqual(shouldShowTarget(now, {}, T), true, 'empty record -> show');
  }

  // Routine ids must be unique: everything that edits or deletes a routine
  // finds it by id, and `find` silently returns the first match.
  assert.strictEqual(nextFreeId(100, []), 100, 'free id is used as-is');
  assert.strictEqual(nextFreeId(100, [{id:100}]), 101, 'collision steps forward');
  assert.strictEqual(nextFreeId(100, [{id:100},{id:101},{id:102}]), 103, 'walks past a run');
  {
    // six added in the same millisecond, the case that broke it
    const list = [];
    for (let i = 0; i < 6; i++) list.push({ id: nextFreeId(1000, list) });
    assert.strictEqual(new Set(list.map(r => r.id)).size, 6, 'six same-ms adds must all be distinct');
  }

  // Daily progress. The bar scores against the composed program minimum, so six
  // core exercises are not a Workout A -- and yesterday's ticks are not today's.
  const T = "2026-09-20", Y = "2026-09-19";
  const mk = (day, area, date) => ({ day, targetArea: area, done: true, doneDate: date });

  assert.strictEqual(DAILY_TARGET, 6, 'daily target is the composed minimum');

  assert.ok(doneToday({ done: true, doneDate: T }, T), 'ticked today counts');
  assert.ok(!doneToday({ done: false, doneDate: T }, T), 'unticked does not count');
  assert.ok(!doneToday({ done: true, doneDate: Y }, T), 'ticked yesterday does not count');

  assert.strictEqual(composedScore([
    mk("A","core",T), mk("A","core",T), mk("A","core",T),
    mk("A","core",T), mk("A","core",T), mk("A","core",T)
  ], "A", T), 2, 'six core exercises are not a complete Workout A');

  assert.strictEqual(composedScore([
    mk("A","lower",T), mk("A","lower",T), mk("A","lower",T), mk("A","lower",T),
    mk("A","core",T), mk("A","core",T)
  ], "A", T), 6, 'four lower plus two core completes Workout A');

  assert.strictEqual(composedScore([
    mk("A","lower",T), mk("A","lower",T), mk("A","lower",T),
    mk("A","lower",T), mk("A","lower",T),
    mk("A","core",T), mk("A","core",T), mk("A","core",T)
  ], "A", T), 6, 'extra exercises cap the score at 6');

  // The sticky-flag bug: before doneDate these stayed checked forever, so every
  // day after the first submission would have opened at a full bar.
  assert.strictEqual(composedScore([
    mk("A","lower",Y), mk("A","lower",Y), mk("A","lower",Y), mk("A","lower",Y),
    mk("A","core",Y), mk("A","core",Y)
  ], "A", T), 0, "yesterday's ticks do not count toward today");

  // Routines saved before this change carry done:true and no doneDate at all.
  assert.strictEqual(composedScore([
    { day: "A", targetArea: "lower", done: true },
    { day: "A", targetArea: "core",  done: true }
  ], "A", T), 0, 'legacy done flags without a date do not count');

  assert.strictEqual(composedScore([
    mk("B","upper",T), mk("B","upper",T), mk("B","upper",T), mk("B","upper",T),
    mk("B","core",T), mk("B","core",T)
  ], "B", T), 6, 'Workout B completes on upper body');

  assert.strictEqual(composedScore([
    mk("B","lower",T), mk("B","lower",T), mk("B","lower",T), mk("B","lower",T),
    mk("B","core",T), mk("B","core",T)
  ], "B", T), 2, 'lower body does not count toward Workout B');

  assert.strictEqual(composedScore([
    mk("A","lower",T), mk("A","lower",T), mk("A","lower",T), mk("A","lower",T),
    mk("A","core",T), mk("A","core",T), mk("B","upper",Y)
  ], "B", T), 0, 'a finished Workout A does not fill Workout B');

  // One login must stay fast enough for a school Chromebook.
  const t0 = Date.now();
  await studentDocId('Timing Test', '1234');
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, 'single derivation too slow: ' + ms + 'ms');

  console.log('derivation: ' + ms + 'ms/login, ' + PIN_ITERATIONS + ' iterations');
  console.log('identity-check OK - 9 distinct addresses, normalization stable, no name or PIN recoverable from an address');
  console.log('escaping-check OK - script payloads, attribute breakouts and null/0 all handled');
  console.log('routineid-check OK - no collision when several exercises are added in the same millisecond');
  console.log('target-check   OK - once per hour per device, and always on a changed target');
  console.log('daily-check    OK - composition enforced, extras capped, stale and legacy ticks ignored');
  console.log('clamp-check    OK - negatives, garbage, Infinity and overflow all bounded; local date matches calendar day');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
