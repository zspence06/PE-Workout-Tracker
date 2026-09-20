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
  grab('function lastLoggedDay(history, before) {'),
  grab('function suggestedDay(history, today) {'),
  grab('function submissionIdFor(day, date, history) {'),
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
    assert.ok(!workoutBlockers(full, "A", D, []).warnings.some(w => w.code === "not-ticked"),
      'nothing unticked, nothing to warn about');
    assert.ok(!workoutBlockers(partial, "A", D, []).warnings.some(w => w.code === "not-ticked"),
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
      assert.ok(!workoutBlockers(skipped, "A", D, hist).warnings.some(w => w.code === "not-ticked"),
        'a credited exercise is not warned about as unlogged');
    }

    // 0 lbs warns but must never block, and must never fire on an exercise the
    // student did not tick -- nothing unticked is about to be written.
    {
      const D = "2026-09-20";
      const mk = (name, area, lbs, done) => ({ id: name, name, day: "A", targetArea: area,
        lbs, done, doneDate: done ? D : "" });
      const six = [mk("Squat","lower",135,true), mk("Press","lower",95,true),
                   mk("Lunge","lower",0,true), mk("Calf","lower",0,true),
                   mk("Plank","core",0,true), mk("Twist","core",0,true)];
      const res = workoutBlockers(six, "A", D, []);
      assert.deepStrictEqual(res.blockers, [], '0 lbs never blocks a submit');
      const z = res.warnings.find(w => w.code === "zero-lbs");
      assert.deepStrictEqual(z.exercises, ["Lunge","Calf","Plank","Twist"], 'names the 0 lbs rows');

      const loaded = six.map(r => ({ ...r, lbs: 45 }));
      assert.ok(!workoutBlockers(loaded, "A", D, []).warnings.some(w => w.code === "zero-lbs"),
        'no warning when everything is loaded');

      // An unticked 0 lbs row is not about to be written, so it is not warned
      // about. Needs a SEVENTH exercise: unticking one of exactly six drops the
      // routine under the requirement and raises a blocker, which suppresses
      // every warning by design.
      const seven = six.concat([mk("Step Up", "lower", 0, false)]);
      const rz = workoutBlockers(seven, "A", D, []);
      assert.deepStrictEqual(rz.blockers, [], 'a spare unticked exercise does not block');
      const zu = rz.warnings.find(w => w.code === "zero-lbs");
      assert.ok(!zu.exercises.includes("Step Up"), 'an unticked row is not warned about for weight');
      assert.deepStrictEqual(zu.exercises, ["Lunge","Calf","Plank","Twist"],
        'only the rows about to be written');
    }

    // Which day was submitted has to come from the ROWS. A single
    // last-submission object meant that submitting B after A left A's card
    // claiming it had never been sent, directly above a panel that correctly
    // called it a duplicate.
    {
      const D = "2026-09-20";
      const H = [
        { date: D, day: "A", exercise: "Squat", subId: "sA" },
        { date: D, day: "A", exercise: "Plank", subId: "sA" },
        { date: D, day: "B", exercise: "Bench", subId: "sB" },
        // Hand-logged on the Quick Log tab: no day, no subId. Not a submission.
        { date: D, exercise: "Mile Run" },
        { date: "2026-09-18", day: "A", exercise: "Squat", subId: "sOld" },
      ];
      assert.strictEqual(submissionIdFor("A", D, H), "sA", 'A is submitted for today');
      assert.strictEqual(submissionIdFor("B", D, H), "sB", 'and B independently');
      assert.notStrictEqual(submissionIdFor("A", D, H), submissionIdFor("B", D, H),
        'the two days must not share a submission id');
      assert.strictEqual(submissionIdFor("A", "2026-09-19", H), null, 'a day with no rows is not submitted');
      assert.strictEqual(submissionIdFor("A", "2026-09-18", H), "sOld", 'past days resolve too');

      // A day whose only rows are hand-logged has NOT been submitted -- undo
      // must not offer to pull someone's Quick Log entries out from under them.
      const handOnly = [{ date: D, exercise: "Mile Run" }, { date: D, day: "A", exercise: "Sit Up" }];
      assert.strictEqual(submissionIdFor("A", D, handOnly), null,
        'rows without a subId are not a submission');
      assert.strictEqual(submissionIdFor("A", D, []), null, 'empty history');
      assert.strictEqual(submissionIdFor("A", D, null), null, 'and null-safe');
    }

    assert.strictEqual(cleanName("  Back Squat "), "Back Squat", 'names are trimmed');
    assert.strictEqual(cleanName(null), "", 'and null-safe');
  }

  // A/B alternation. The failure this guards is the one that shipped for months:
  // every new day defaulted to A, so a student who did A yesterday was pointed
  // straight back at A and never alternated.
  {
    const H = [
      { date: "2026-09-14", day: "A", exercise: "Back Squat" },
      { date: "2026-09-16", day: "B", exercise: "Bench Press" },
      { date: "2026-09-18", day: "A", exercise: "Back Squat" },
      // A Quick Log row carries no day and must not be mistaken for a workout.
      { date: "2026-09-19", exercise: "Mile Run" },
    ];
    assert.strictEqual(suggestedDay(H, "2026-09-20").day, "B",
      'after an A, suggest B');
    assert.strictEqual(lastLoggedDay(H, "2026-09-20").date, "2026-09-18",
      'a day-less Quick Log row is not the last workout');

    // Today's own rows must not decide today's suggestion -- submitting A this
    // morning would otherwise flip the toggle to B underneath the student.
    const withToday = H.concat([{ date: "2026-09-20", day: "B", exercise: "Row" }]);
    assert.strictEqual(suggestedDay(withToday, "2026-09-20").day, "B",
      'today\'s own submission is excluded from the suggestion');

    // A brand-new student has nothing to alternate from.
    assert.strictEqual(suggestedDay([], "2026-09-20").day, "A", 'no history starts at A');
    assert.strictEqual(suggestedDay([], "2026-09-20").from, null);

    // Out-of-order history must still find the genuinely latest workout.
    const shuffled = [H[2], H[0], H[1]];
    assert.strictEqual(lastLoggedDay(shuffled, "2026-09-20").day, "A",
      'latest by date, not by array position');
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
  console.log('weight-check   OK - 0 lbs warns on ticked rows only, and never blocks');
  console.log('daily-check    OK - composition enforced, extras capped, stale and legacy ticks ignored');
  console.log('clamp-check    OK - negatives, garbage, Infinity and overflow all bounded; local date matches calendar day');
  console.log('alternate-check OK - A/B alternates off the last real workout, ignoring Quick Log rows and today\'s own');
  console.log('submitted-check OK - A and B resolve independently from the rows; hand-logged rows are not a submission');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
