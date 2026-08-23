/* The Simulator - the Section 17 acceptance fixtures, run headlessly.
 *
 * Specification section 16.5: build engines before UI, and pass all of Section
 * 17's fixtures first, including the Module A state fixtures. This file is that
 * gate. Criteria 1-9 are arithmetic and run here. Criteria 10-15 are properties
 * of the shipped interface (privacy, workbook parity, failover, performance,
 * isolation, copy integrity) and are checked once those surfaces exist.
 *
 * Every expected value is derived independently of the code being tested: a
 * closed-form expression written out here, or a solver implemented separately
 * inside this file. A test that only agrees with its subject proves nothing.
 *
 * Run: node sim/tests/fixtures.test.js
 */
'use strict';

var E = require('../engines.js');
var S = require('../schemes.js');
var P = require('../position.js');
var States = require('../states.js');

var passed = 0, failed = [], pending = [];

function ok(name, condition, detail) {
  if (condition) { passed++; console.log('  pass    ' + name); }
  else { failed.push(name); console.log('  FAIL    ' + name + (detail ? '   -- ' + detail : '')); }
}
function close(name, actual, expected, tol) {
  var good = isFinite(actual) && Math.abs(actual - expected) <= tol;
  ok(name, good, 'got ' + actual + ', expected ' + expected + ' +/- ' + tol);
}
function todo(name, why) { pending.push(name); console.log('  PENDING ' + name + '   -- ' + why); }
function section(title) { console.log('\n' + title); }

var d = E.utc;

/* An XIRR solver written here, independently of sim/engines.js, so criteria 1
 * and 2 are checked against arithmetic rather than against themselves. */
function bisectXirr(flows) {
  var t0 = Math.min.apply(null, flows.map(function (f) { return f.t; }));
  function npv(r) {
    return flows.reduce(function (s, f) {
      return s + f.amount / Math.pow(1 + r, (f.t - t0) / 86400000 / 365);
    }, 0);
  }
  var lo = -0.9999, hi = 10;
  for (var i = 0; i < 400; i++) {
    var mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/* Synthetic NAV series: one observation per calendar day between two dates. */
function dailySeries(fromT, toT, navAt) {
  var out = [];
  for (var t = fromT; t <= toT; t += 86400000) out.push({ t: t, v: navAt(E.dayCount(fromT, t)) });
  return out;
}

/* ============================================ 1. XIRR fixture A (spec 17.1) */
section('Criterion 1 - XIRR fixture A: one lump sum doubling over six years');
var A = [
  { t: d(2020, 1, 1), amount: -100000 },
  { t: d(2026, 1, 1), amount: 200000 }
];
var daysA = E.dayCount(d(2020, 1, 1), d(2026, 1, 1));
var exactA = Math.pow(2, 365 / daysA) - 1;      /* closed form: the money doubles */
var gotA = E.xirr(A);
ok('the span is 2192 days', daysA === 2192, 'got ' + daysA);
close('matches the closed form', gotA.rate, exactA, 1e-12);
close('matches an independent solver', gotA.rate, bisectXirr(A), 1e-9);
ok('agrees with Excel to two decimals',
   (gotA.rate * 100).toFixed(2) === (exactA * 100).toFixed(2),
   'engine ' + (gotA.rate * 100).toFixed(4) + '%, closed form ' + (exactA * 100).toFixed(4) + '%');
console.log('          note: the exact figure is ' + (exactA * 100).toFixed(4) +
            '%, which is 12.23% at two decimals. Section 17.1 prints it as 12.24%.');

/* ============================================ 2. XIRR fixture B (spec 17.2) */
section('Criterion 2 - XIRR fixture B: two instalments, one value');
var B = [
  { t: d(2024, 1, 1), amount: -100000 },
  { t: d(2025, 1, 1), amount: -100000 },
  { t: d(2026, 1, 1), amount: 228000 }
];
var gotB = E.xirr(B);
close('matches an independent solver', gotB.rate, bisectXirr(B), 1e-9);
ok('reads 9.05% to two decimals', (gotB.rate * 100).toFixed(2) === '9.05',
   'got ' + (gotB.rate * 100).toFixed(4) + '%');

/* ============================================ 3. XIRR fixture C (spec 17.3) */
section('Criterion 3 - same-sign input gives words, never #NUM! or NaN');
var sameSign = [
  { t: d(2020, 1, 1), type: 'in', amount: 100000 },
  { t: d(2026, 1, 1), type: 'value', amount: 0 }
];
var verdict = E.validateRows(sameSign);
ok('validation names it XIRR-SAME-SIGN', verdict && verdict.code === 'XIRR-SAME-SIGN',
   JSON.stringify(verdict));
var solved = E.xirr(E.toFlows(sameSign));
ok('the solver refuses rather than returning NaN', solved.ok === false && !('rate' in solved));
ok('it refuses with XIRR-NO-SOLVE and a sentence',
   solved.code === 'XIRR-NO-SOLVE' && typeof solved.message === 'string' && solved.message.length > 20,
   JSON.stringify(solved));
ok('no raw error token appears in the message',
   !/#NUM|NaN|Infinity|undefined/.test(solved.message), solved.message);

/* Precedence, section 9.2, checked one rung at a time. */
ok('precedence 1: no money in            -> XIRR-NEED-IN',
   E.validateRows([{ t: d(2020, 1, 1), type: 'value', amount: 1 }]).code === 'XIRR-NEED-IN');
ok('precedence 2: no value today         -> XIRR-NEED-VALUE',
   E.validateRows([{ t: d(2020, 1, 1), type: 'in', amount: 1 }]).code === 'XIRR-NEED-VALUE');
ok('precedence 2: two values today       -> XIRR-NEED-VALUE',
   E.validateRows([{ t: d(2020, 1, 1), type: 'in', amount: 1 },
                   { t: d(2021, 1, 1), type: 'value', amount: 1 },
                   { t: d(2022, 1, 1), type: 'value', amount: 1 }]).code === 'XIRR-NEED-VALUE');
ok('precedence 3: an incomplete row      -> XIRR-ROW-FIX, pointing at the first',
   (function () {
     var v = E.validateRows([{ t: d(2020, 1, 1), type: 'in', amount: 1 },
                             { t: NaN, type: 'in', amount: 5 },
                             { t: d(2022, 1, 1), type: 'value', amount: 9 }]);
     return v.code === 'XIRR-ROW-FIX' && v.row === 1;
   })());
ok('precedence 5: a span under a year    -> XIRR-SUB-YEAR, and does not block',
   (function () {
     var v = E.validateRows([{ t: d(2025, 1, 1), type: 'in', amount: 100 },
                             { t: d(2025, 6, 1), type: 'value', amount: 120 }]);
     return v.code === 'XIRR-SUB-YEAR' && v.blocking === false;
   })());

/* ========================================= 4. Rolling fixture (spec 17.4) */
section('Criterion 4 - a series doubling every 2192 days rolls flat at six years');
var synthStart = d(2000, 1, 1), synthEnd = d(2020, 1, 1);
var doubling = dailySeries(synthStart, synthEnd, function (n) { return 10 * Math.pow(2, n / 2192); });
var rolled6 = E.rolling(doubling, { years: 6 });
ok('windows were measured', rolled6.ok && rolled6.stats.count > 4000, 'count ' + (rolled6.stats || {}).count);
var spread = (rolled6.stats.best.r - rolled6.stats.worst.r) * 100;
ok('every start date gives the same return, within 0.01 points', spread <= 0.01,
   'spread ' + spread.toFixed(6) + ' points');
close('and that return is the closed-form 2^(365/2192)-1',
      rolled6.stats.median, Math.pow(2, 365 / 2192) - 1, 1e-9);

/* Section 8.2 can be read two ways, and this fixture is where the choice is
 * settled. "Annualized return for the window = (NAV_end / NAV_start) ^ (365 /
 * days), where days = actual calendar days between the two NAV dates" is taken
 * literally: the divisor is the elapsed days, not the window's nominal length.
 *
 * On a gap-free daily series the two readings are identical, because the target
 * date is always itself an observation. They part company exactly where the
 * 7-day matching rule bites -- which is every real fund, since NAVs publish on
 * business days and a six-year target lands on a weekend two times in seven.
 * So the fixture is run again on a weekday-only series, where only one reading
 * survives the 0.01-point tolerance. */
var weekdayDoubling = doubling.filter(function (p) {
  var dow = new Date(p.t).getUTCDay();
  return dow !== 0 && dow !== 6;
});
var rolledWd = E.rolling(weekdayDoubling, { years: 6 });
ok('the same series, published only on business days, still rolls', rolledWd.ok);
ok('some windows now end short of their target date',
   rolledWd.points.some(function (p) { return p.days !== E.dayCount(p.startT, E.addYears(p.startT, 6)); }));
var wdSpread = (rolledWd.stats.best.r - rolledWd.stats.worst.r) * 100;
ok('measured over actual elapsed days it stays flat, within 0.01 points',
   wdSpread <= 0.01, 'spread ' + wdSpread.toFixed(6) + ' points');
var nominal = rolledWd.points.map(function (p) {
  var nominalDays = E.dayCount(p.startT, E.addYears(p.startT, 6));
  return Math.pow(p.endV / p.startV, 365 / nominalDays) - 1;
});
var nominalSpread = (Math.max.apply(null, nominal) - Math.min.apply(null, nominal)) * 100;
ok('the actual-days reading is not merely inside the tolerance but exact',
   wdSpread < 1e-12, 'spread ' + wdSpread + ' points (floating point, not method)');
ok('the nominal-length reading drifts instead of staying flat',
   nominalSpread > 0, 'nominal spread ' + nominalSpread.toFixed(6) + ' points');

/* The fixture's 0.01-point tolerance is loose enough to admit both readings, so
 * it does not by itself decide between them. What decides is 8.2's own wording,
 * checked here directly against a window that ended short of its target. */
var shortWindow = null;
for (var si = 0; si < rolledWd.points.length && !shortWindow; si++) {
  var pt = rolledWd.points[si];
  if (pt.days !== E.dayCount(pt.startT, E.addYears(pt.startT, 6))) shortWindow = pt;
}
ok('a window that ended short is annualised over its actual elapsed days',
   Math.abs(shortWindow.r - (Math.pow(shortWindow.endV / shortWindow.startV, 365 / shortWindow.days) - 1)) < 1e-15,
   JSON.stringify({ days: shortWindow.days, r: shortWindow.r }));
console.log('          note: 17.4 admits both readings (actual-days drift ' + wdSpread.toFixed(6) +
            ', nominal-length drift ' + nominalSpread.toFixed(6) + ', tolerance 0.01).');
console.log('                8.2\'s wording -- "days = actual calendar days between the two NAV');
console.log('                dates" -- is what settles it, and is what the engine does.');

/* ================================== 5. Real-fund cross-check (spec 17.5) */
section('Criterion 5 - real-fund cross-check against an established public tool');
todo('three funds of different ages, +/-0.1 points on 95% of shared dates',
     'needs live provider data and a second tool; this environment has no network egress');

/* ========================================== 6. Replay fixture (spec 17.6) */
section('Criterion 6 - 24 monthly instalments into a proxy growing at 12% a year');
var proxyFrom = d(2015, 1, 1), proxyTo = d(2020, 1, 1);
var steady = dailySeries(proxyFrom, proxyTo, function (n) { return 50 * Math.pow(1.12, n / 365); });
var sip = P.repeatMonthly(d(2018, 1, 1), 10000, 24, 'in');
var replay = P.againstProxy(steady, sip,
  { firstExecutionT: d(2018, 1, 1), latestT: proxyTo }, E.dayCount(d(2018, 1, 1), proxyTo));
ok('the replay ran', replay.ok, JSON.stringify(replay));
close('replay XIRR is 12.0%', replay.replayXirr * 100, 12.0, 0.1);
close('and is 12% to far better than the tolerance', replay.replayXirr, 0.12, 1e-9);

/* ================================= 7. Execution-NAV fixture (spec 17.7) */
section('Criterion 7 - the execution-NAV rule');
var weekdays = [];
for (var wt = d(2020, 1, 1); wt <= d(2020, 12, 31); wt += 86400000) {
  var dow = new Date(wt).getUTCDay();
  if (dow !== 0 && dow !== 6) weekdays.push({ t: wt, v: 100 + E.dayCount(d(2020, 1, 1), wt) });
}
var saturday = d(2020, 3, 7);      /* a Saturday */
var monday = d(2020, 3, 9);
ok('the fixture dates are a Saturday and the following Monday',
   new Date(saturday).getUTCDay() === 6 && new Date(monday).getUTCDay() === 1);
var hit = P.executionNav(weekdays, saturday);
ok('a weekend transaction takes the following Monday NAV',
   hit.ok && hit.t === monday, JSON.stringify(hit));

/* A hole wider than seven days: the row is flagged, never mapped across it. */
var holed = weekdays.filter(function (p) {
  return !(p.t > d(2020, 6, 1) && p.t < d(2020, 6, 30));
});
var inHole = P.executionNav(holed, d(2020, 6, 10));
ok('a transaction inside a long gap is not mapped', inHole.ok === false, JSON.stringify(inHole));
ok('and the reason given is the gap, with its size', inHole.reason === 'gap' && inHole.gapDays > 7,
   JSON.stringify(inHole));
var flaggedRun = P.execute([{ t: d(2020, 2, 3), type: 'in', amount: 1000 },
                            { t: d(2020, 6, 10), type: 'in', amount: 1000 }], holed);
ok('the run continues and flags that row individually',
   flaggedRun.ok && flaggedRun.flagged.length === 1 && flaggedRun.flagged[0].row === 1,
   JSON.stringify(flaggedRun.flagged));
ok('a transaction before the fund existed stops the run at that row',
   P.execute([{ t: d(2019, 5, 1), type: 'in', amount: 1000 }], weekdays).code === 'POS-ROW-BEFORE-FUND');
ok('more money out than in stops the run',
   P.execute([{ t: d(2020, 2, 3), type: 'in', amount: 1000 },
              { t: d(2020, 3, 3), type: 'out', amount: 9000 }], weekdays).code === 'POS-UNITS-NEGATIVE');

/* ====================================== 8. Percentile fixture (spec 17.8) */
section('Criterion 8 - a known worst window lands in the bottom quartile');
/* Twelve years of steady growth, then a year that gives a third of it back.
 * Any window ending at the last observation is therefore among the worst. */
var crashFrom = d(2008, 1, 1), crashPeak = d(2020, 1, 1), crashTo = d(2021, 1, 1);
var peakDays = E.dayCount(crashFrom, crashPeak);
var totalDays = E.dayCount(crashFrom, crashTo);
var crashy = dailySeries(crashFrom, crashTo, function (n) {
  var grown = 100 * Math.pow(1.14, Math.min(n, peakDays) / 365);
  if (n <= peakDays) return grown;
  return grown * Math.pow(0.65, (n - peakDays) / (totalDays - peakDays));
});
var lump = [{ t: d(2018, 1, 1), type: 'in', amount: 100000 }];
var stood = P.whereYouStand({ rows: lump, fundSeries: crashy, proxySeries: null, asOfT: crashTo });
ok('the reading ran', stood.ok, JSON.stringify(stood).slice(0, 200));
ok('the stretch could be placed', stood.figures.stretchOk, JSON.stringify(stood.stretch));
ok('there were at least 30 windows', stood.figures.windows >= 30, 'windows ' + stood.figures.windows);
ok('the percentile is in the bottom quartile', stood.figures.percentile <= 25,
   'percentile ' + stood.figures.percentile.toFixed(2));
var crashStates = States.evaluate(stood.figures);
ok('and the state fired is S-STRETCH-LOW', crashStates.states.stretch === 'S-STRETCH-LOW',
   crashStates.states.stretch);
ok('its copy slot is POS-STRETCH-LOW',
   crashStates.slots.some(function (s) { return s.slot === 'POS-STRETCH-LOW'; }));

/* ==================================== 9. State determinism (spec 17.9) */
section('Criterion 9 - a fixture table of transaction sets gives exactly these states');

/* One steady fund and one proxy, both synthetic, so every expected state below
 * is arithmetic rather than opinion. */
var fundFrom = d(2005, 1, 1), fundTo = d(2025, 1, 1);
var steadyFund = dailySeries(fundFrom, fundTo, function (n) { return 10 * Math.pow(1.12, n / 365); });
var slowProxy = dailySeries(fundFrom, fundTo, function (n) { return 10 * Math.pow(1.08, n / 365); });
var fastProxy = dailySeries(fundFrom, fundTo, function (n) { return 10 * Math.pow(1.18, n / 365); });

var CASES = [
  {
    name: 'a holding under a year suppresses every annualised reading',
    input: { rows: [{ t: d(2024, 6, 1), type: 'in', amount: 100000 }],
             fundSeries: steadyFund, proxySeries: slowProxy, asOfT: fundTo },
    expect: { report: 'S-EARLY', fundStatus: 'S-LIVE', gap: null, stretch: null, alternative: null }
  },
  {
    name: 'a fund that stopped publishing raises the stale banner',
    input: { rows: [{ t: d(2010, 1, 1), type: 'in', amount: 100000 }],
             fundSeries: steadyFund, proxySeries: slowProxy, asOfT: d(2025, 6, 1) },
    expect: { report: 'S-FULL', fundStatus: 'S-STALE', gap: 'S-GAP-NEUTRAL',
              stretch: 'S-STRETCH-MID', alternative: 'S-ALT-AHEAD' }
  },
  {
    name: 'one lump sum in a steady fund tracks the fund exactly',
    input: { rows: [{ t: d(2010, 1, 1), type: 'in', amount: 100000 }],
             fundSeries: steadyFund, proxySeries: null, asOfT: fundTo },
    expect: { report: 'S-FULL', fundStatus: 'S-LIVE', gap: 'S-GAP-NEUTRAL',
              stretch: 'S-STRETCH-MID', alternative: 'S-ALT-NONE' }
  },
  {
    name: 'no proxy at all leaves the alternative unspoken',
    input: { rows: P.repeatMonthly(d(2015, 1, 1), 5000, 60, 'in'),
             fundSeries: steadyFund, proxySeries: null, asOfT: fundTo },
    expect: { report: 'S-FULL', fundStatus: 'S-LIVE', gap: 'S-GAP-NEUTRAL',
              stretch: 'S-STRETCH-MID', alternative: 'S-ALT-NONE' }
  },
  {
    name: 'a slower proxy puts the visitor ahead of the alternative',
    input: { rows: [{ t: d(2012, 1, 1), type: 'in', amount: 100000 }],
             fundSeries: steadyFund, proxySeries: slowProxy, asOfT: fundTo },
    expect: { report: 'S-FULL', fundStatus: 'S-LIVE', gap: 'S-GAP-NEUTRAL',
              stretch: 'S-STRETCH-MID', alternative: 'S-ALT-AHEAD' }
  },
  {
    name: 'a faster proxy puts the visitor behind it',
    input: { rows: [{ t: d(2012, 1, 1), type: 'in', amount: 100000 }],
             fundSeries: steadyFund, proxySeries: fastProxy, asOfT: fundTo },
    expect: { report: 'S-FULL', fundStatus: 'S-LIVE', gap: 'S-GAP-NEUTRAL',
              stretch: 'S-STRETCH-MID', alternative: 'S-ALT-BEHIND' }
  },
  {
    name: 'a proxy younger than the holding cannot be compared against',
    input: { rows: [{ t: d(2006, 1, 1), type: 'in', amount: 100000 }],
             fundSeries: steadyFund,
             proxySeries: dailySeries(d(2015, 1, 1), fundTo, function (n) { return 10 * Math.pow(1.12, n / 365); }),
             asOfT: fundTo },
    expect: { report: 'S-FULL', fundStatus: 'S-LIVE', gap: 'S-GAP-NEUTRAL',
              stretch: 'S-STRETCH-MID', alternative: 'S-ALT-NONE' }
  },
  {
    name: 'buying only into the crash leaves the visitor behind the fund',
    input: { rows: P.repeatMonthly(d(2019, 6, 1), 20000, 12, 'in'),
             fundSeries: crashy, proxySeries: null, asOfT: crashTo },
    expect: { report: 'S-FULL', fundStatus: 'S-LIVE', gap: 'S-GAP-BEHIND',
              stretch: 'S-STRETCH-LOW', alternative: 'S-ALT-NONE' }
  },
  {
    name: 'a fund without span plus a year of history cannot place the stretch',
    input: { rows: [{ t: d(2021, 6, 1), type: 'in', amount: 100000 }],
             fundSeries: dailySeries(d(2021, 1, 1), d(2025, 1, 1),
                                     function (n) { return 10 * Math.pow(1.12, n / 365); }),
             proxySeries: null, asOfT: d(2025, 1, 1) },
    expect: { report: 'S-FULL', fundStatus: 'S-LIVE', gap: 'S-GAP-NEUTRAL',
              stretch: 'S-STRETCH-NA', alternative: 'S-ALT-NONE' }
  }
];

function run(c) {
  var stand = P.whereYouStand(c.input);
  if (!stand.ok) return { error: stand.code };
  return States.evaluate(stand.figures).states;
}

CASES.forEach(function (c) {
  var first = run(c), second = run(c);
  var wanted = JSON.stringify(c.expect);
  ok(c.name, JSON.stringify(first) === wanted, 'got ' + JSON.stringify(first));
  ok('  ... and identically on a second run', JSON.stringify(first) === JSON.stringify(second));
});
ok('the table carries at least six transaction sets', CASES.length >= 6, 'has ' + CASES.length);

section('Criterion 9 - the evaluator is pure');
var src = require('fs').readFileSync(require('path').join(__dirname, '../states.js'), 'utf8');
ok('states.js never reads the clock', !/Date\.now|new Date\(\s*\)/.test(src));
ok('states.js makes no network call', !/fetch|XMLHttpRequest|require\('http/.test(src));
ok('states.js contains no randomness', !/Math\.random/.test(src));
ok('every state in the table has an entry',
   States.allStates().length === 15, 'found ' + States.allStates().length);
ok('the two states that say nothing are the quiet ones',
   States.allStates().filter(function (s) { return !s.slot; })
         .map(function (s) { return s.id; }).join(',') === 'S-FULL,S-LIVE');
ok('every other state names a copy slot for the author to write',
   States.allStates().filter(function (s) { return s.slot; }).length === 13);
ok('no more than three next steps are ever offered',
   States.evaluate({ spanDays: 4000, latestNavAgeDays: 900, personalXirr: 0.02, fundSpeed: 0.12,
                     stretchOk: true, percentile: 3, windows: 900,
                     proxyOk: true, replayXirr: 0.14 }).nextSteps.length <= 3);

/* ============================================ the data layer, sections 5.2-5.4 */
section('Section 5.2 - the cleaning rules');
var messy = [
  { date: '05-08-2026', nav: '100.5' },
  { date: '04-08-2026', nav: '#N/A' },
  { date: '03-08-2026', nav: 'N.A.' },
  { date: '02-08-2026', nav: 'B.C.' },
  { date: '01-08-2026', nav: '99.25' },
  { date: '05-08-2026', nav: '101.0' },
  { date: '2026-07-31', nav: 98 },
  { date: '30-Jul-2026', nav: '97.5' },
  { date: 'rubbish', nav: '5' },
  { date: '29-07-2026', nav: '-3' },
  { date: '28-07-2026', nav: '0' }
];
var cleaned = S.cleanSeries(messy);
ok('junk NAV values are dropped silently', cleaned.series.length === 4, JSON.stringify(cleaned.series));
ok('the result is sorted ascending',
   cleaned.series.map(function (p) { return p.date; }).join(',') ===
   '2026-07-30,2026-07-31,2026-08-01,2026-08-05');
ok('a duplicated date keeps the last occurrence',
   cleaned.series[3].nav === 101.0, JSON.stringify(cleaned.series[3]));
ok('zero and negative NAVs are dropped', cleaned.dropped === 6, 'dropped ' + cleaned.dropped);
ok('DD-MM-YYYY is read day-first, as mfapi publishes it',
   S.parseDate('05-08-2026') === d(2026, 8, 5));
ok('ISO dates are read as ISO', S.parseDate('2026-08-05') === d(2026, 8, 5));
ok('DD-MMM-YYYY is read too, as AMFI publishes it', S.parseDate('05-Aug-2026') === d(2026, 8, 5));
ok('an impossible date is refused, not rolled forward', !isFinite(S.parseDate('31-02-2026')));

section('Section 5.4 - plan and option parsing');
var NAMES = [
  ['Aditya Birla Sun Life Frontline Equity Fund - Growth', 'regular', 'growth', 'Aditya Birla Sun Life Frontline Equity Fund'],
  ['Aditya Birla Sun Life Frontline Equity Fund - Direct Plan - Growth', 'direct', 'growth', 'Aditya Birla Sun Life Frontline Equity Fund'],
  ['HDFC Balanced Advantage Fund - IDCW Option - Payout - Regular Plan', 'regular', 'idcw', 'HDFC Balanced Advantage Fund'],
  ['Nippon India Growth Fund - Direct Plan - Growth Option', 'direct', 'growth', 'Nippon India Growth Fund'],
  ['Nippon India Growth Fund-Direct Plan-IDCW Option', 'direct', 'idcw', 'Nippon India Growth Fund'],
  ['ICICI Prudential Dividend Yield Equity Fund - Direct Plan - Growth', 'direct', 'growth', 'ICICI Prudential Dividend Yield Equity Fund'],
  ['Motilal Oswal Mid-Cap Fund - Direct Plan - Growth', 'direct', 'growth', 'Motilal Oswal Mid-Cap Fund'],
  ['Kotak Bluechip Fund - Payout of Income Distribution cum capital withdrawal option', 'regular', 'idcw', 'Kotak Bluechip Fund'],
  ['Mirae Asset Large Cap Fund - Direct Plan - Half Yearly IDCW', 'direct', 'idcw', 'Mirae Asset Large Cap Fund']
];
NAMES.forEach(function (row) {
  var p = S.parseName(row[0]);
  ok('"' + row[0].slice(0, 52) + '"',
     p.plan === row[1] && p.option === row[2] && p.family === row[3],
     'plan=' + p.plan + ' option=' + p.option + ' family="' + p.family + '"');
});
ok('a fund name containing "Growth" survives family stripping',
   S.parseName('Nippon India Growth Fund - Direct Plan - Growth').family === 'Nippon India Growth Fund');
ok('a fund name containing "Dividend" is not read as an IDCW option',
   S.parseName('ICICI Prudential Dividend Yield Equity Fund - Direct Plan - Growth').option === 'growth');
ok('an unparseable name with no Growth token is not analyzable',
   S.parseName('Some Old Scheme (G)').analyzable === false);

section('Section 5.4 rule 1 - IDCW is routed to its Growth twin');
var universe = [
  { code: 1, name: 'HDFC Top 100 Fund - Direct Plan - Growth' },
  { code: 2, name: 'HDFC Top 100 Fund - Direct Plan - IDCW' },
  { code: 3, name: 'HDFC Top 100 Fund - Regular Plan - Growth' },
  { code: 4, name: 'Orphan Income Fund - Regular Plan - IDCW' }
];
var routed = S.resolveForAnalysis(S.decorate(universe[1]), universe);
ok('an IDCW selection routes to the Growth twin of the same plan',
   routed.ok && routed.routed && routed.scheme.code === 1, JSON.stringify(routed.scheme));
ok('and says why, through RR-IDCW-ROUTE', routed.slot === 'RR-IDCW-ROUTE');
var orphan = S.resolveForAnalysis(S.decorate(universe[3]), universe);
ok('a fund with no Growth twin is shown as not analyzable',
   orphan.ok === false && orphan.slot === 'RR-IDCW-ROUTE', JSON.stringify(orphan));
var groups = S.groupByFamily(universe);
ok('search results group to one row per family', groups.length === 2, 'got ' + groups.length);
ok('the plan default is Regular, as the older plan type',
   S.pickPlan(groups[0]).code === 3, JSON.stringify(S.pickPlan(groups[0])));
ok('a stated preference wins over the default',
   S.pickPlan(groups[0], 'direct').code === 1);

section('Section 5.6 - a scheme that stopped publishing');
ok('31 days without a NAV is stale',
   S.staleness([{ t: d(2026, 7, 1), nav: 10 }], d(2026, 8, 1)).stale === true);
ok('30 days is not', S.staleness([{ t: d(2026, 7, 2), nav: 10 }], d(2026, 8, 1)).stale === false);

/* ============================================================ 8.4 guards */
section('Section 8.4 - the Module B guards');
var young = dailySeries(d(2023, 1, 1), d(2025, 1, 1), function (n) { return 10 + n * 0.01; });
var tooYoung = E.rolling(young, { years: 5 });
ok('a fund younger than the window returns RR-TOO-YOUNG, not an empty chart',
   tooYoung.ok === false && tooYoung.code === 'RR-TOO-YOUNG', JSON.stringify(tooYoung));
ok('and reports how much history there is against how much is needed',
   tooYoung.haveDays > 0 && tooYoung.needDays > tooYoung.haveDays,
   tooYoung.haveDays + ' of ' + tooYoung.needDays);
var oneYear = E.rolling(young, { years: 1 });
ok('the largest feasible window still works', oneYear.ok && oneYear.stats.count > 300);

/* ==================================================================== done */
console.log('\n' + passed + ' passed, ' + failed.length + ' failed, ' + pending.length + ' pending');
if (pending.length) console.log('\nPENDING (needs the live environment):\n  ' + pending.join('\n  '));
if (failed.length) {
  console.log('\nFAILED:\n  ' + failed.join('\n  '));
  process.exit(1);
}
