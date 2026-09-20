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
  grab('function cleanName(v) {'),
  grab('function loggedToday(r, date, history) {'),
  grab('function rowConflicts(rows, history) {'),
  grab('function workoutBlockers(routines, day, date, history) {'),
  grab('function spreadsheetBlockers(rows, history) {'),
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

  // Why a submit is refused. The live checklist and the button read the SAME
  // function, so the panel can never promise something the button then denies.
  {
    const D = "2026-09-20";
    const codes = r => r.blockers.map(b => b.code);
    const full = [
      { id:1, name:"Squat",  day:"A", targetArea:"lower", done:true, doneDate:D },
      { id:2, name:"Lunge",  day:"A", targetArea:"lower", done:true, doneDate:D },
      { id:3, name:"Press",  day:"A", targetArea:"lower", done:true, doneDate:D },
      { id:4, name:"Raise",  day:"A", targetArea:"lower", done:true, doneDate:D },
      { id:5, name:"Plank",  day:"A", targetArea:"core",  done:true, doneDate:D },
      { id:6, name:"DeadBug",day:"A", targetArea:"core",  done:true, doneDate:D }
    ];

    assert.deepStrictEqual(codes(workoutBlockers([], "A", D, [])), ["empty-day"],
      'a day with no exercises names that, and nothing else');

    assert.deepStrictEqual(codes(workoutBlockers(full, "A", D, [])), [],
      'a complete, conflict-free Workout A has no blockers');

    // Two ticked (both lower): short on BOTH halves, and both are reported --
    // the whole point is that one press shows every blocker at once.
    const partial = full.map((r, i) => i < 2 ? r : { ...r, done:false, doneDate:"" });
    assert.deepStrictEqual(codes(workoutBlockers(partial, "A", D, [])),
      ["need-prime", "need-core"], 'both halves reported together, not one at a time');

    // A routine that CANNOT reach 6 must not be told to check off more; its only
    // route is ticking everything, so it gets its own message.
    const short = [
      { id:1, name:"Squat", day:"A", targetArea:"lower", done:false, doneDate:"" },
      { id:2, name:"Lunge", day:"A", targetArea:"lower", done:false, doneDate:"" },
      { id:3, name:"Plank", day:"A", targetArea:"core",  done:false, doneDate:"" }
    ];
    assert.deepStrictEqual(codes(workoutBlockers(short, "A", D, [])), ["short-routine"],
      'a routine too short to reach 6 gets a reachable instruction');
    assert.deepStrictEqual(
      codes(workoutBlockers(short.map(r => ({ ...r, done:true, doneDate:D })), "A", D, [])), [],
      'that same short routine submits once everything is ticked');

    // The dead end: already in history, and the blocker carries the routine id
    // so "Skip it" can act without interpolating a student-typed name into HTML.
    const clash = workoutBlockers(full, "A", D, [{ date:D, exercise:"Plank" }]);
    assert.deepStrictEqual(codes(clash), ["already-logged"], 'an existing history row blocks');
    assert.strictEqual(clash.blockers[0].id, 5, 'the blocker carries the routine id, not just a name');
    assert.ok(/Plank/.test(clash.blockers[0].text), 'and names the exercise');

    // Case and padding must not let a duplicate through.
    assert.deepStrictEqual(
      codes(workoutBlockers(full, "A", D, [{ date:D, exercise:"  plank  " }])),
      ["already-logged"], 'the history match ignores case and padding');
    assert.deepStrictEqual(codes(workoutBlockers(full, "A", D, [{ date:"2026-09-19", exercise:"Plank" }])),
      [], 'yesterday\'s history row does not block today');

    // Same exercise twice in one day's routine.
    const dup = full.concat([{ id:7, name:"plank", day:"A", targetArea:"core", done:true, doneDate:D }]);
    assert.deepStrictEqual(codes(workoutBlockers(dup, "A", D, [])), ["dup-in-submission"],
      'the same exercise twice in one day is reported once');

    // Warnings are NOT blockers, and only surface when the submit would succeed.
    const extra = full.concat([
      { id:7, name:"Calf", day:"A", targetArea:"lower", done:false, doneDate:"" },
      { id:8, name:"Twist", day:"A", targetArea:"core", done:false, doneDate:"" }
    ]);
    const warned = workoutBlockers(extra, "A", D, []);
    assert.deepStrictEqual(codes(warned), [], 'unticked extras do not block a met requirement');
    assert.deepStrictEqual(warned.warnings.map(w => w.code), ["not-ticked"],
      'but they are warned about, because they will not be logged');
    assert.deepStrictEqual(warned.warnings[0].exercises, ["Calf", "Twist"], 'and named');
    assert.deepStrictEqual(workoutBlockers(full, "A", D, []).warnings, [],
      'nothing unticked, nothing to warn about');
    assert.deepStrictEqual(workoutBlockers(partial, "A", D, []).warnings, [],
      'a blocked submit does not also nag about unticked rows');

    // The spreadsheet commit shares the conflict half and adds its own empty case.
    assert.deepStrictEqual(spreadsheetBlockers([], []).blockers.map(b => b.code), ["no-rows"],
      'committing nothing says so');
    assert.deepStrictEqual(
      spreadsheetBlockers([{ date:D, exercise:"Squat" }], [{ date:D, exercise:"Squat" }])
        .blockers.map(b => b.code), ["already-logged"],
      'the spreadsheet hits the same already-logged wall, explained the same way');
    assert.deepStrictEqual(
      spreadsheetBlockers([{ date:D, exercise:"Squat" }, { date:D, exercise:"SQUAT" }], [])
        .blockers.map(b => b.code), ["dup-in-submission"],
      'two rows for one exercise on one date is caught before the write');
    assert.deepStrictEqual(
      spreadsheetBlockers([{ date:D, exercise:"Squat" }, { date:"2026-09-19", exercise:"Squat" }], [])
        .blockers, [], 'the same exercise on two different dates is fine');

    // THE LOOP, found by driving the real UI: Back Squat is already in history,
    // so it blocks. Skipping it unticks it -- and if an already-logged exercise
    // did not count toward the requirement, the student would then be told to
    // check off one more lower body, whose only candidate is the very exercise
    // that is blocked. Two blockers, each cleared only by causing the other.
    {
      const hist = [{ date: D, exercise: "Squat" }];
      const blocked = workoutBlockers(full, "A", D, hist);
      assert.deepStrictEqual(codes(blocked), ["already-logged"], 'ticked + in history blocks');

      const skipped = full.map(r => r.name === "Squat" ? { ...r, done:false, doneDate:"" } : r);
      assert.deepStrictEqual(codes(workoutBlockers(skipped, "A", D, hist)), [],
        'skipping it clears the way instead of bouncing into a requirement blocker');

      // ...and it is credited, not silently dropped: without history it IS short.
      assert.deepStrictEqual(codes(workoutBlockers(skipped, "A", D, [])),
        ["need-prime"], 'the same untick with no history row is genuinely short');

      assert.ok(loggedToday({ name:"  squat " }, D, hist), 'match ignores case and padding');
      assert.ok(!loggedToday({ name:"Squat" }, "2026-09-19", hist), 'and is scoped to the date');

      // An already-logged exercise that was never ticked is not a conflict at
      // all -- nothing is about to be written twice.
      assert.deepStrictEqual(workoutBlockers(skipped, "A", D, hist).warnings, [],
        'a credited exercise is not warned about as unlogged');
    }

    assert.strictEqual(cleanName("  Back Squat "), "Back Squat", 'names are trimmed');
    assert.strictEqual(cleanName(null), "", 'and null-safe');
  }

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
  console.log('blocker-check  OK - every blocker reported at once, short routines reachable, warnings never block');
  console.log('daily-check    OK - composition enforced, extras capped, stale and legacy ticks ignored');
  console.log('clamp-check    OK - negatives, garbage, Infinity and overflow all bounded; local date matches calendar day');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
