/* Independent validation of the calculation engine.
 *
 * Every expected value here comes from somewhere other than the engine: a
 * closed-form formula written out separately, a case worked by hand, or the
 * three acceptance cases already verified in a spreadsheet outside this
 * codebase. A test that only agrees with the code it is testing proves nothing.
 *
 * Run: node tools/tool-tests/engine.test.js
 */
'use strict';
var E = require('../../tool/engine.js');
var P = require('../../tool/parse.js');

var passed = 0, failed = [];

function ok(name, condition, detail) {
  if (condition) { passed++; console.log('  pass  ' + name); }
  else { failed.push(name); console.log('  FAIL  ' + name + (detail ? '   -- ' + detail : '')); }
}
function close(name, actual, expected, tol) {
  var t = tol == null ? 1e-9 : tol;
  var good = isFinite(actual) && Math.abs(actual - expected) <= t;
  ok(name, good, 'got ' + actual + ', expected ' + expected + ' (tolerance ' + t + ')');
}
function section(title) { console.log('\n' + title); }

/* Exact equality, for the values that are counts, codes and names rather than
   arithmetic -- close() would quietly pass a wrong string. */
function eq(name, actual, expected) {
  ok(name, actual === expected,
     'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

var d = E.utc;

/* ===================================================================== XIRR */
section('XIRR — against hand-worked and spreadsheet-verified cases');

/* Exactly one year, exactly 10% more money back. No solver needed to know it. */
close('lump sum over 365 days returns 10%',
  E.xirr([{ t: d(2024, 1, 1), amount: -100000 }, { t: d(2024, 12, 31), amount: 110000 }]).rate,
  0.10, 1e-9);

/* Halved over exactly one year. */
close('a halving over 365 days returns -50%',
  E.xirr([{ t: d(2024, 1, 1), amount: -100000 }, { t: d(2024, 12, 31), amount: 50000 }]).rate,
  -0.50, 1e-9);

/* The three cases already verified in the spreadsheet, recalculated outside
 * Excel. Same inputs must give the same answers here. */
close('two lump sums = 9.0509%',
  E.xirr([
    { t: d(2024, 1, 1), amount: -100000 },
    { t: d(2025, 1, 1), amount: -100000 },
    { t: d(2026, 1, 1), amount: 228000 }
  ]).rate * 100, 9.0509, 5e-4);

var sip = [];
for (var n = 0; n < 60; n++) {
  var y = 2020 + Math.floor(n / 12), m = (n % 12) + 1;
  sip.push({ t: d(y, m, 1), amount: -10000 });
}
sip.push({ t: d(2025, 1, 1), amount: 824864 });
close('five-year monthly SIP = 12.66%', E.xirr(sip).rate * 100, 12.66, 5e-3);

close('with a withdrawal = 8.1381%',
  E.xirr([
    { t: d(2022, 4, 1), amount: -500000 },
    { t: d(2024, 4, 1), amount: 200000 },
    { t: d(2026, 4, 1), amount: 450000 }
  ]).rate * 100, 8.1381, 5e-4);

/* Uneven dates with a partial withdrawal: no closed form, so check the
 * defining property instead -- the net present value at the answer is zero. */
var messy = [
  { t: d(2019, 3, 7), amount: -250000 },
  { t: d(2020, 11, 23), amount: -75000 },
  { t: d(2021, 6, 2), amount: 40000 },
  { t: d(2023, 1, 19), amount: -120000 },
  { t: d(2024, 8, 30), amount: 90000 },
  { t: d(2026, 2, 14), amount: 460000 }
];
var messyRate = E.xirr(messy).rate;
close('uneven dates: net present value at the answer is zero', E.xnpv(messyRate, messy), 0, 1e-6);
ok('uneven dates: answer is a sensible rate', messyRate > -0.9 && messyRate < 1,
   'got ' + messyRate);

/* Order of entry must not change the answer. */
var shuffled = messy.slice().reverse();
close('entry order does not change the result', E.xirr(shuffled).rate, messyRate, 1e-12);

section('XIRR — refuses to invent a number');
ok('single entry is refused', E.xirr([{ t: d(2024, 1, 1), amount: -1000 }]).code === 'TOO_FEW');
ok('all money in, none out, is refused',
   E.xirr([{ t: d(2024, 1, 1), amount: -1000 }, { t: d(2025, 1, 1), amount: -1000 }]).code === 'NO_VALUE');
ok('all money out, none in, is refused',
   E.xirr([{ t: d(2024, 1, 1), amount: 1000 }, { t: d(2025, 1, 1), amount: 1000 }]).code === 'NO_INVESTMENT');
ok('everything on one date is refused',
   E.xirr([{ t: d(2024, 1, 1), amount: -1000 }, { t: d(2024, 1, 1), amount: 1200 }]).code === 'SAME_DAY');
ok('a refusal always carries a readable message',
   typeof E.xirr([]).message === 'string' && E.xirr([]).message.length > 10);

/* ===================================================================== CAGR */
section('CAGR — distinct from XIRR');
close('doubling in 365 days is 100%', E.cagr(100, 200, d(2024, 1, 1), d(2024, 12, 31)).rate, 1.0, 1e-9);
close('100 to 121 over 730 days is 10%', E.cagr(100, 121, d(2024, 1, 1), d(2025, 12, 31)).rate, 0.10, 1e-9);
ok('a zero starting value is refused', E.cagr(0, 100, d(2024, 1, 1), d(2025, 1, 1)).ok !== true);
ok('an end date before the start is refused', E.cagr(100, 200, d(2025, 1, 1), d(2024, 1, 1)).ok !== true);
close('absolute return is not annualised', E.absoluteReturn(100000, 150000).rate, 0.5, 1e-12);

/* ========================================================== ROLLING RETURNS */
section('Rolling returns — against a series whose answer is known by construction');

/* A series growing at exactly 12% a year. Every window of every length must
 * come back at 12%, whatever the start date. */
function constantGrowthSeries(startY, years, annual) {
  var out = [], t = d(startY, 1, 1), end = d(startY + years, 1, 1);
  var v0 = 100, t0 = t;
  while (t <= end) {
    var elapsed = (t - t0) / 86400000 / 365.2425;
    out.push({ t: t, v: v0 * Math.pow(1 + annual, elapsed) });
    t += 86400000;
  }
  return out;
}
var steady = constantGrowthSeries(2005, 20, 0.12);
[1, 3, 5, 7, 10].forEach(function (h) {
  var r = E.rollingReturns(steady, h);
  ok(h + '-year windows all measure 12% on a 12% series',
     r.ok && Math.abs(r.stats.min - 0.12) < 5e-4 && Math.abs(r.stats.max - 0.12) < 5e-4,
     r.ok ? 'min ' + r.stats.min + ' max ' + r.stats.max : r.message);
  ok(h + '-year windows are all positive on a rising series', r.ok && r.stats.positiveShare === 1);
});

/* Window count: a 20-year daily series holds one 10-year window per day for
 * the first ten years, give or take a day at the boundary. */
var tenYear = E.rollingReturns(steady, 10);
ok('window count matches the shape of the data',
   Math.abs(tenYear.stats.count - (365.25 * 10)) < 20, 'got ' + tenYear.stats.count);

/* A hand-built series: doubles in year one, flat afterwards. */
var stepped = [
  { t: d(2020, 1, 1), v: 100 },
  { t: d(2021, 1, 1), v: 200 },
  { t: d(2022, 1, 1), v: 200 }
];
var oneYear = E.rollingReturns(stepped, 1);

/* These three expectations look like they should be round numbers and are not,
 * because 2020 is a leap year and the tool's year is 365 days.
 *
 * The money doubled, but it took 366 days to do it, so its rate per 365-day
 * year is 2^(365/366) - 1 = 99.62%, not 100%. That is not an approximation of
 * the "right" answer; it IS the right answer once a year is fixed at 365 days,
 * which the whole product does so that the screens and the workbook and Excel's
 * own XIRR cannot disagree. Anyone tempted to round these back to 1.0 should
 * change the convention deliberately, not the assertion. */
var LEAP_DOUBLE = Math.pow(2, 365 / 366) - 1;
close('a doubling leap year measures 99.62%, not 100%', oneYear.stats.max, LEAP_DOUBLE, 1e-12);
close('and the closed form agrees', oneYear.stats.max, 0.9962158948735886, 1e-12);
close('a flat year measures 0%', oneYear.stats.min, 0.0, 1e-9);

/* Two years spanning one leap day: 731 elapsed days, not 730. */
close('two-year window over a double then flat = 41.35%',
  E.rollingReturns(stepped, 2).stats.mean, Math.pow(2, 365 / 731) - 1, 1e-12);

section('Rolling returns — the annualisation convention');
/* The window that decides this is one that ended short of its target date,
 * which the seven-day matching rule produces on any weekday-only NAV file.
 * Under the nominal reading it would be priced over the window's full nominal
 * length; under the convention the review fixes, it is priced over the days
 * that actually elapsed. */
var weekdays = [];
for (var wt = d(2015, 1, 1); wt <= d(2023, 1, 1); wt += 86400000) {
  var dow = new Date(wt).getUTCDay();
  if (dow !== 0 && dow !== 6) weekdays.push({ t: wt, v: 100 * Math.pow(1.11, E.dayCount(d(2015, 1, 1), wt) / 365) });
}
var wd = E.rollingReturns(weekdays, 5);
var shortWindow = wd.pairs.filter(function (p) { return p.days !== E.dayCount(p.t, E.addYears(p.t, 5)); })[0];
ok('a real weekday file produces windows that end short of target', !!shortWindow);
close('and such a window is priced over the days that actually elapsed',
  shortWindow.r,
  Math.pow(Math.pow(1.11, shortWindow.days / 365), 365 / shortWindow.days) - 1, 1e-12);
close('which on an 11% series is 11%, whatever the window length',
  wd.stats.median, 0.11, 1e-9);

section('Rolling returns — which start date produced which result');
var dated = E.rollingReturns(stepped, 1);
ok('the best window names the day it started', dated.best.t === d(2020, 1, 1),
   String(dated.best && dated.best.t));
ok('the worst window names its own start day', dated.worst.t === d(2021, 1, 1),
   String(dated.worst && dated.worst.t));
close('the best window carries its own return', dated.best.r, LEAP_DOUBLE, 1e-12);
ok('every window is kept, not just the summary', dated.pairs.length === dated.values.length);

section('Rolling returns — refuses rather than guesses');
ok('asking for more years than the data holds is refused',
   E.rollingReturns(stepped, 10).code === 'NOT_ENOUGH_HISTORY');
ok('a refusal explains how much history there actually is',
   /2\.0 years/.test(E.rollingReturns(stepped, 10).message),
   E.rollingReturns(stepped, 10).message);
ok('a two-point series cannot be rolled over a decade', E.rollingReturns([{ t: d(2020, 1, 1), v: 1 }], 1).ok !== true);

/* A gap longer than the tolerance drops the window instead of stretching it. */
var gapped = [
  { t: d(2015, 1, 1), v: 100 },
  { t: d(2016, 1, 1), v: 110 },
  { t: d(2017, 1, 1), v: 121 },   /* then a hole where 2018 should be */
  { t: d(2019, 6, 1), v: 150 },
  { t: d(2020, 6, 1), v: 165 }
];
var gappedRoll = E.rollingReturns(gapped, 1);
ok('windows landing inside a data gap are dropped, not stretched',
   gappedRoll.ok && gappedRoll.stats.count === 3, gappedRoll.ok ? 'count ' + gappedRoll.stats.count : gappedRoll.message);

section('Rolling return statistics');
var sample = [-0.10, 0.00, 0.05, 0.12, 0.20];
var st = E.describe(sample);
close('median of five values', st.median, 0.05, 1e-12);
close('mean of five values', st.mean, 0.054, 1e-12);
close('share positive', st.positiveShare, 0.6, 1e-12);
close('share negative', st.negativeShare, 0.4, 1e-12);
close('quartile matches the spreadsheet definition', E.quantile(sample, 0.25), 0.0, 1e-12);
var bins = E.histogram(sample);
ok('every value lands in exactly one bucket',
   bins.reduce(function (s, b) { return s + b.count; }, 0) === sample.length);

section('Beating a rate the reader chooses');
var periods = [-0.05, 0.02, 0.07, 0.07, 0.11, 0.18];
close('counts strictly above the rate', E.shareAbove(periods, 0.07).above, 2, 0);
close('share is out of every period', E.shareAbove(periods, 0.07).share, 2 / 6, 1e-12);
close('a rate below everything is beaten by all', E.shareAbove(periods, -1).share, 1, 1e-12);
close('a rate above everything is beaten by none', E.shareAbove(periods, 5).share, 0, 1e-12);
ok('an empty set is refused rather than dividing by zero', E.shareAbove([], 0.07).ok !== true);
ok('a missing rate is refused', E.shareAbove(periods, NaN).ok !== true);

/* ================================================================ GOAL MATH */
section('Goal maths — against the closed-form annuity');

close('a monthly rate compounds back to the annual rate',
  Math.pow(1 + E.monthlyRate(0.12), 12) - 1, 0.12, 1e-12);
ok('the monthly rate is not the annual rate divided by twelve',
  Math.abs(E.monthlyRate(0.12) - 0.12 / 12) > 1e-4);

/* Closed form for a start-of-month annuity: P * (((1+i)^n - 1)/i) * (1+i) */
function annuityDue(P, annual, years) {
  var i = Math.pow(1 + annual, 1 / 12) - 1, n = Math.round(years * 12);
  return P * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
}
[[10000, 0.12, 5], [5000, 0.08, 20], [25000, 0.15, 10], [1000, 0.06, 1]].forEach(function (c) {
  close('SIP of ' + c[0] + ' at ' + (c[1] * 100) + '% for ' + c[2] + 'y matches the annuity formula',
    E.futureValueOfSip(c[0], c[1], c[2], 0), annuityDue(c[0], c[1], c[2]), 1e-6);
});

close('a lump sum compounds as expected', E.futureValueOfLumpSum(400000, 0.08, 5), 400000 * Math.pow(1.08, 5), 1e-9);
ok('the future value of a SIP is linear in the instalment',
  Math.abs(E.futureValueOfSip(20000, 0.10, 15, 0.10) - 2 * E.futureValueOfSip(10000, 0.10, 15, 0.10)) < 1e-6);
ok('a step-up beats a flat SIP over the same period',
  E.futureValueOfSip(10000, 0.10, 15, 0.10) > E.futureValueOfSip(10000, 0.10, 15, 0));
close('contributions with no step-up are just instalment times months',
  E.contributions(10000, 5, 0), 600000, 1e-9);

section('Goal planner — the required top-up actually closes the gap');
var plan = E.projectGoal({ currentValue: 400000, monthlySip: 0, years: 5, annualRate: 0.08, target: 1000000 });
ok('a shortfall is reported as a shortfall', plan.ok && plan.gap > 0);
var reprojected = E.projectGoal({
  currentValue: 400000, monthlySip: plan.extraMonthly, years: 5, annualRate: 0.08, target: 1000000
});
close('adding the required top-up lands exactly on the goal', reprojected.projected, 1000000, 1e-6);
ok('landing on the goal is reported as on track', reprojected.onTrack);

var stepPlan = E.projectGoal({
  currentValue: 400000, monthlySip: 5000, years: 10, annualRate: 0.10, annualStepUpRate: 0.10, target: 5000000
});
var stepFixed = E.projectGoal({
  currentValue: 400000, monthlySip: 5000 + stepPlan.extraMonthly, years: 10,
  annualRate: 0.10, annualStepUpRate: 0.10, target: 5000000
});
close('the top-up closes the gap with a step-up running too', stepFixed.projected, 5000000, 1e-5);

section('Goal planner — refuses nonsense');
ok('zero years is refused', E.projectGoal({ years: 0, annualRate: 0.1, target: 100 }).code === 'BAD_YEARS');
ok('a century is refused', E.projectGoal({ years: 100, annualRate: 0.1, target: 100 }).code === 'BAD_YEARS');
ok('a fantasy return is refused', E.projectGoal({ years: 5, annualRate: 0.9, target: 100 }).code === 'BAD_RATE');
ok('no target is refused', E.projectGoal({ years: 5, annualRate: 0.1, target: 0 }).code === 'BAD_TARGET');

/* =============================================================== DRAWDOWN */
section('Drawdown — what had to be sat through');

/* built by hand: 100 up to 120, down to 60, back to 120 and beyond.
   The worst fall is 120 -> 60, which is exactly -50%. */
var shaped = [
  { t: d(2020, 1, 1), v: 100 },
  { t: d(2020, 6, 1), v: 120 },
  { t: d(2021, 1, 1), v: 60 },
  { t: d(2021, 6, 1), v: 90 },
  { t: d(2022, 6, 1), v: 120 },
  { t: d(2023, 1, 1), v: 150 }
];
var dd = E.maxDrawdown(shaped);
close('the deepest fall is measured from the previous high', dd.depth, -0.5, 1e-12);
ok('it names the day the fall started', dd.from.t === d(2020, 6, 1));
ok('it names the bottom', dd.to.t === d(2021, 1, 1));
ok('it finds the day the old high was regained', dd.recoveredOn === d(2022, 6, 1),
   String(dd.recoveredOn));
close('recovery is measured from the bottom', dd.recoveryDays, 516, 1);

var neverBack = [
  { t: d(2020, 1, 1), v: 100 }, { t: d(2021, 1, 1), v: 40 }, { t: d(2022, 1, 1), v: 70 }
];
ok('a fall that never recovered says so', E.maxDrawdown(neverBack).recoveredOn === null);
ok('a series that only rises has no fall', E.maxDrawdown(steady.slice(0, 500)).depth === 0);
ok('one point cannot show a fall', E.maxDrawdown([{ t: d(2020, 1, 1), v: 1 }]).ok !== true);

/* ================================================== FUND VERSUS BENCHMARK */
section('Fund against benchmark — consistency, not one verdict');

var slow = constantGrowthSeries(2005, 20, 0.08);
var fast = constantGrowthSeries(2005, 20, 0.12);
var cmpAll = E.compareRolling(fast, slow, 5);
ok('every window is paired by its start date', cmpAll.ok && cmpAll.pairs > 3000, cmpAll.message);
close('a steadily better series leads in every period', cmpAll.fundAheadShare, 1, 1e-12);
close('the two medians are reported separately', cmpAll.fund.median, 0.12, 5e-4);
close('and the benchmark median is its own', cmpAll.bench.median, 0.08, 5e-4);
close('the weaker series never leads', E.compareRolling(slow, fast, 5).fundAheadShare, 0, 1e-12);

/* a series too short for the horizon at all is refused on its own terms */
var late = constantGrowthSeries(2022, 3, 0.12);
var tooShort = E.compareRolling(late, slow, 5);
ok('a series too short for the horizon is refused', tooShort.ok !== true);
ok('and the refusal says how much history it actually has',
   /not enough for a 5-year/.test(tooShort.message || ''), tooShort.message);

/* both long enough on their own, but they never overlap: no fair comparison */
var early = constantGrowthSeries(2000, 8, 0.12);
var later = constantGrowthSeries(2015, 8, 0.09);
var noOverlap = E.compareRolling(early, later, 5);
ok('two series that never overlap are refused', noOverlap.ok !== true);
ok('the refusal names the overlap as the problem',
   /overlap/.test(noOverlap.message || ''), noOverlap.message);

/* comparison must use the shared window only, never each series' own best run */
var overlap = E.compareRolling(constantGrowthSeries(2010, 10, 0.15), slow, 3);
ok('comparison is confined to the dates both cover',
   overlap.ok && overlap.from >= d(2010, 1, 1) && overlap.to <= d(2020, 1, 1),
   overlap.ok ? fmt(overlap.from) + ' to ' + fmt(overlap.to) : overlap.message);

function fmt(t) { return new Date(t).toISOString().slice(0, 10); }

/* ==================================================== GOAL SENSITIVITY */
section('Goal — the same plan under different assumptions');

var goalInput = { currentValue: 400000, monthlySip: 10000, years: 15,
                  annualRate: 0.10, annualStepUpRate: 0, target: 10000000 };
var rates = E.requiredAcrossRates(goalInput, [0.08, 0.10, 0.12]);
ok('one row per assumption', rates.length === 3);
ok('a higher assumed return needs less money each month',
   rates[0].extraMonthly > rates[1].extraMonthly && rates[1].extraMonthly > rates[2].extraMonthly,
   rates.map(function (r) { return Math.round(r.extraMonthly); }).join(' > '));
rates.forEach(function (r) {
  var check = E.projectGoal({
    currentValue: 400000, monthlySip: 10000 + r.extraMonthly, years: 15,
    annualRate: r.rate, annualStepUpRate: 0, target: 10000000
  });
  close('at ' + (r.rate * 100) + '% the stated top-up reaches the goal', check.projected, 10000000, 2);
});

section('Goal — what waiting costs');
var waits = E.costOfWaiting(goalInput, [0, 5, 10]);
ok('one row per delay', waits.length === 3);
ok('waiting always raises the monthly amount needed',
   waits[0].monthlyNeeded < waits[1].monthlyNeeded && waits[1].monthlyNeeded < waits[2].monthlyNeeded,
   waits.map(function (w) { return Math.round(w.monthlyNeeded); }).join(' < '));
ok('waiting past the deadline is reported, not calculated',
   E.costOfWaiting(goalInput, [20])[0].impossible === true);
ok('the total paid in is reported for each delay', waits.every(function (w) { return w.totalPaid > 0; }));

/* money already invested keeps compounding through the wait: the corpus at the
   goal date is the same in every row, because only the instalments start later */
close('waiting does not stop the existing corpus compounding',
  waits[1].corpusAtGoal, E.futureValueOfLumpSum(400000, 0.10, 15), 1e-6);
ok('every delay shares the same corpus figure',
  waits.every(function (w) { return Math.abs(w.corpusAtGoal - waits[0].corpusAtGoal) < 1e-6; }));
/* and each row's stated instalment really does reach the goal */
waits.forEach(function (w) {
  var reached = E.futureValueOfLumpSum(400000, 0.10, 15) + E.futureValueOfSip(w.monthlyNeeded, 0.10, w.yearsLeft, 0);
  close('starting in ' + w.delay + ' years, that instalment still reaches the goal', reached, 10000000, 2);
});

/* =================================================================== FILES */
section('Reading files — the formats a reader will actually download');

var amfi = 'Scheme Code;Scheme Name;ISIN Div Payout;ISIN Div Reinvestment;Net Asset Value;Date\n' +
           '119551;Some Fund - Growth;INF209K01Z15;-;45.6789;01-Apr-2024\n' +
           '119551;Some Fund - Growth;INF209K01Z15;-;46.1234;02-Apr-2024\n' +
           '119551;Some Fund - Growth;INF209K01Z15;-;46.9876;03-Apr-2024\n';
var a = P.parseSeriesText(amfi);
ok('AMFI semicolon format is read', a.ok && a.series.length === 3, a.ok ? '' : a.message);
ok('AMFI dates are read correctly', a.ok && a.series[0].t === d(2024, 4, 1));
close('AMFI NAV is read correctly', a.ok ? a.series[0].v : -1, 45.6789, 1e-9);

var iso = 'Date,Close\n2024-01-01,100.5\n2024-01-02,101.25\n2024-01-03,99.75\n';
var b = P.parseSeriesText(iso);
ok('ISO dates with a Close column are read', b.ok && b.series.length === 3);
ok('ISO dates map to the right day', b.ok && b.series[0].t === d(2024, 1, 1));

var indian = 'Date,NAV\n05-08-2026,120.5\n15-08-2026,121.5\n25-08-2026,119.5\n';
var c = P.parseSeriesText(indian);
ok('day-first dates are detected from the column', c.ok && c.series[0].t === d(2026, 8, 5));

var ambiguous = 'Date,NAV\n01-02-2024,100\n02-03-2024,101\n03-04-2024,102\n';
var amb = P.parseSeriesText(ambiguous);
ok('an ambiguous date column is flagged to the reader',
   amb.ok && amb.report.warnings.length > 0 && !amb.report.dateCertain);

var isoOnly = P.parseSeriesText('Date,NAV\n2024-01-01,100\n2024-02-01,101\n2024-03-01,102\n');
ok('an unambiguous ISO file raises no date warning',
   isoOnly.ok && isoOnly.report.dateCertain && isoOnly.report.warnings.length === 0,
   (isoOnly.report && isoOnly.report.warnings || []).join(' | '));
var namedMonths = P.parseSeriesText('Date,NAV\n01-Apr-2024,10\n02-Apr-2024,11\n03-Apr-2024,12\n');
ok('a named-month file raises no date warning',
   namedMonths.ok && namedMonths.report.warnings.length === 0);

var messyFile = 'Date,NAV\n01-Apr-2024,"1,234.56"\n02-Apr-2024,₹1235.00\n03-Apr-2024,n/a\n' +
                '04-Apr-2024,-5\n05-Apr-2024,1240.10\n05-Apr-2024,1241.00\nrubbish,12\n';
var m = P.parseSeriesText(messyFile);
ok('commas and currency symbols are stripped', m.ok && Math.abs(m.series[0].v - 1234.56) < 1e-9);
ok('a non-numeric value is skipped', m.ok && m.report.skipped.badValue >= 1);
ok('a negative NAV is skipped', m.ok && m.report.skipped.badValue >= 2);
ok('an unreadable date is skipped', m.ok && m.report.skipped.badDate >= 1);
ok('a repeated date is collapsed', m.ok && m.report.skipped.duplicate === 1);
ok('the last entry for a repeated date wins',
   m.ok && Math.abs(m.series[m.series.length - 1].v - 1241.00) < 1e-9);
ok('the reader is told which rows were dropped', m.ok && m.report.examples.length > 0);

var noHeader = '01-Apr-2024,45.5\n02-Apr-2024,46.0\n03-Apr-2024,46.5\n';
ok('a file with no header row still works', P.parseSeriesText(noHeader).ok);

var unsorted = 'Date,NAV\n03-Apr-2024,46.5\n01-Apr-2024,45.5\n02-Apr-2024,46.0\n';
var u = P.parseSeriesText(unsorted);
ok('rows out of order are sorted', u.ok && u.series[0].t < u.series[1].t && u.series[1].t < u.series[2].t);

ok('an empty file is refused', P.parseSeriesText('').ok !== true);
ok('a file with no numbers is refused', P.parseSeriesText('hello\nworld\n').ok !== true);
ok('a refusal explains what the file needs',
   /date/i.test(P.parseSeriesText('hello,there\nfoo,bar\n').message || ''));
ok('31 February is rejected rather than rolled forward',
   isNaN(P.toTimestamp(P.parseDateParts('31-02-2024', true))));

section('One file, many schemes — the way official downloads actually arrive');

/* AMFI's bulk download carries every scheme in one file. A reader should be
   able to hand it over exactly as it arrived. */
function amfiBulk(schemes, days) {
  var out = ['Scheme Code;Scheme Name;ISIN Div Payout;ISIN Div Reinvestment;Net Asset Value;Date'];
  var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  schemes.forEach(function (sc, idx) {
    var v = sc.start, t = d(2015, 1, 1);
    for (var i = 0; i < days; i++) {
      var dd = new Date(t);
      out.push([100000 + idx, sc.name, 'INF00' + idx, '-', v.toFixed(4),
                String(dd.getUTCDate()).padStart(2, '0') + '-' + M[dd.getUTCMonth()] + '-' + dd.getUTCFullYear()
               ].join(';'));
      v *= Math.pow(1 + sc.rate, 1 / 365.2425);
      t += 86400000;
    }
  });
  return out.join('\n');
}

var bulk = amfiBulk([
  { name: 'Alpha Flexi Cap Fund - Direct Growth', start: 10, rate: 0.14 },
  { name: 'Alpha Flexi Cap Fund - Regular Growth', start: 10, rate: 0.12 },
  { name: 'Beta Large Cap Fund - Direct Growth', start: 50, rate: 0.09 }
], 2600);

var listed = P.listSchemesText(bulk);
ok('every scheme in the file is found', listed && listed.schemes.length === 3,
   listed ? String(listed.schemes.length) : 'none');
ok('schemes are listed alphabetically',
   listed.schemes[0].name.indexOf('Alpha Flexi Cap Fund - Direct') === 0);
ok('each scheme reports how many rows it has',
   listed.schemes.every(function (x) { return x.rows === 2600; }));
ok('each scheme reports its own date range',
   listed.schemes.every(function (x) { return x.first === d(2015, 1, 1) && x.last > x.first; }));

var ambiguous = P.parseSeriesText(bulk);
ok('a multi-scheme file is refused until one is chosen', ambiguous.code === 'MANY_SCHEMES');
ok('and it says how many schemes it holds', /3 different schemes/.test(ambiguous.message),
   ambiguous.message);

var chosen = P.parseSeriesText(bulk, { scheme: 'Alpha Flexi Cap Fund - Direct Growth' });
ok('choosing one scheme reads only that scheme', chosen.ok && chosen.series.length === 2600,
   chosen.ok ? String(chosen.series.length) : chosen.message);
ok('the chosen scheme is named in the report',
   chosen.report.scheme === 'Alpha Flexi Cap Fund - Direct Growth');
close('the direct plan measures its own 14%',
  E.rollingReturns(chosen.series, 5).stats.median, 0.14, 2e-3);
var regular = P.parseSeriesText(bulk, { scheme: 'Alpha Flexi Cap Fund - Regular Growth' });
close('the regular plan measures its own 12%, not the direct plan\'s',
  E.rollingReturns(regular.series, 5).stats.median, 0.12, 2e-3);
ok('asking for a scheme that is not there is refused',
   P.parseSeriesText(bulk, { scheme: 'Nonexistent Fund' }).code === 'NO_SUCH_SCHEME');

/* a single-scheme file needs no choosing, and names itself */
var single = 'Scheme Code;Scheme Name;Net Asset Value;Date\n' +
  '1;Only Fund - Growth;10.0000;01-Apr-2024\n1;Only Fund - Growth;10.5000;02-Apr-2024\n' +
  '1;Only Fund - Growth;10.2000;03-Apr-2024';
var one = P.parseSeriesText(single);
ok('a file holding one scheme is read without asking', one.ok && one.series.length === 3);
ok('and the analysis is named after the scheme, not the file',
   one.report.scheme === 'Only Fund - Growth');

/* a plain two-column file has no scheme column and must still work */
ok('a file with no scheme column is unaffected',
   P.parseSeriesText('Date,NAV\n01-Apr-2024,10\n02-Apr-2024,11\n').ok);
ok('and reports no scheme name',
   P.parseSeriesText('Date,NAV\n01-Apr-2024,10\n02-Apr-2024,11\n').report.scheme === null);
ok('listing schemes on a file without them returns nothing',
   P.listSchemesText('Date,NAV\n01-Apr-2024,10\n02-Apr-2024,11\n') === null);

section('The daily all-fund snapshot, which is what most people download first');

/* AMFI's daily file carries one row per fund, for one date. It cannot produce a
   history, but it must say so usefully rather than dead-end. */
var daily = 'Scheme Code;Scheme Name;ISIN;ISIN2;Net Asset Value;Date\n' +
  '1;Alpha Fund - Direct Growth;A;-;45.6789;22-Aug-2026\n' +
  '2;Alpha Fund - Regular Growth;B;-;42.1234;22-Aug-2026\n' +
  '3;Beta Fund - Direct Growth;C;-;98.7654;22-Aug-2026';
var dailyList = P.listSchemesText(daily);
ok('every fund in a one-day snapshot is still listed',
   dailyList && dailyList.schemes.length === 3,
   dailyList ? String(dailyList.schemes.length) : 'none');
ok('each is marked as holding a single day',
   dailyList.schemes.every(function (x) { return x.rows === 1; }));
var oneDay = P.parseSeriesText(daily, { scheme: 'Alpha Fund - Direct Growth' });
ok('choosing one is refused, because one price is not a history',
   oneDay.code === 'ONE_DAY_ONLY', oneDay.code);
ok('and the refusal says what to download instead',
   /NAV history for a date range/.test(oneDay.message), oneDay.message);

section('Several funds stacked with nothing naming them');
var stacked = 'Date,NAV\n' +
  '01-Apr-2024,10\n01-Apr-2024,20\n01-Apr-2024,30\n' +
  '02-Apr-2024,11\n02-Apr-2024,21\n02-Apr-2024,31\n' +
  '03-Apr-2024,12\n03-Apr-2024,22\n03-Apr-2024,32';
var mixed = P.parseSeriesText(stacked);
ok('a stacked file is refused rather than silently collapsed', mixed.code === 'MIXED_SERIES', mixed.code);
ok('and the refusal explains what it saw', /repeat a date already seen/.test(mixed.message));
ok('a genuine file with one stray duplicate is still accepted',
   P.parseSeriesText('Date,NAV\n01-Apr-2024,10\n02-Apr-2024,11\n02-Apr-2024,12\n03-Apr-2024,13\n04-Apr-2024,14\n').ok);

section('Trimming a series to a chosen window');
var win = [
  { t: d(2020, 1, 1), v: 1 }, { t: d(2021, 1, 1), v: 2 },
  { t: d(2022, 1, 1), v: 3 }, { t: d(2023, 1, 1), v: 4 }
];
ok('both bounds are inclusive', P.sliceSeries(win, d(2021, 1, 1), d(2022, 1, 1)).length === 2);
ok('a missing start means from the beginning', P.sliceSeries(win, null, d(2021, 1, 1)).length === 2);
ok('a missing end means to the end', P.sliceSeries(win, d(2022, 1, 1), null).length === 2);
ok('no bounds changes nothing', P.sliceSeries(win, null, null).length === 4);
ok('a window outside the data is empty, not an error', P.sliceSeries(win, d(2030, 1, 1), null).length === 0);

section('End to end — a file becomes rolling returns');
var lines = ['Date,NAV'];
var t = d(2010, 1, 1), v = 100;
while (t <= d(2025, 1, 1)) {
  var dt = new Date(t);
  lines.push(dt.getUTCDate() + '-' + (dt.getUTCMonth() + 1) + '-' + dt.getUTCFullYear() + ',' + v.toFixed(4));
  v *= Math.pow(1.11, 1 / 365.2425);
  t += 86400000;
}
var parsed = P.parseSeriesText(lines.join('\n'));
var rolled = E.rollingReturns(parsed.series, 5);
ok('a 15-year file parses and rolls', parsed.ok && rolled.ok);
close('an 11% file measures 11% over five years', rolled.stats.median, 0.11, 1e-3);

/* ==================================================================== done */
/* -------------------------------------------------------------------------
 * Several schemes as one.
 *
 * Three funds cannot be averaged as they stand: one at 10 rupees a unit and one
 * at 450 have no meaningful mean. Each is rebased to 100 on the first date they
 * all share, and the rebased lines are averaged.
 */
section('Several schemes combined into one series');
{
  const day = i => Date.UTC(2020, 0, 1) + i * 86400000;
  const grow = (start, rate, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ t: day(i), v: start * Math.pow(1 + rate, i / 365.2425) });
    return out;
  };
  /* deliberately incomparable NAV scales, and three different rates */
  const a = grow(10, 0.14, 1500), b = grow(450, 0.08, 1500), c = grow(87, 0.20, 1500);

  const made = E.combineEqualWeighted([a, b, c]);
  ok('three schemes combine', made.ok && made.count === 3, made.code || '');
  ok('and the composite starts at exactly 100, whatever the NAVs were',
     Math.abs(made.series[0].v - 100) < 1e-9, String(made.series[0].v));

  /* Equal amounts bought once and never rebalanced -- so the weights are equal
     on the first day ONLY, and drift afterwards toward whichever grew fastest.
     Worked out independently: the mean of (1+r)^y across the three. */
  const level = y => [0.14, 0.08, 0.20].reduce((s, r) => s + Math.pow(1 + r, y), 0) / 3;
  const yrs = (made.to - made.from) / (365.2425 * 86400000);
  const measured = Math.pow(made.series[made.series.length - 1].v / 100, 1 / yrs) - 1;
  const expected = Math.pow(level(yrs), 1 / yrs) - 1;
  ok('and compounds at the rate a basket bought once actually would',
     Math.abs(measured - expected) < 0.0005,
     (measured * 100).toFixed(3) + '% vs ' + (expected * 100).toFixed(3) + '%');

  /* This is NOT the same as re-striking equal weights at every window start,
     and the difference is half a point on this fixture -- which is why the
     label says "equal amounts at the start" rather than "equally weighted". */
  const drift = Math.pow(level(6) / level(3), 1 / 3) - 1;
  const rebal = Math.pow(level(3), 1 / 3) - 1;
  ok('a drifting basket and a rebalanced one are genuinely different answers',
     Math.abs(drift - rebal) > 0.004,
     (drift * 100).toFixed(1) + '% vs ' + (rebal * 100).toFixed(1) + '%');

  /* Only dates every scheme has a price on: a date one fund did not trade on
     would move the composite on nothing but its own absence. */
  const gappy = a.filter((_, i) => i % 3 !== 0);
  const shared = E.combineEqualWeighted([a, gappy]);
  ok('only dates every scheme shares are kept',
     shared.ok && shared.points === gappy.length, String(shared.points));

  ok('one series alone is refused', E.combineEqualWeighted([a]).code === 'TOO_FEW');
  ok('and so are two that never overlap',
     E.combineEqualWeighted([a, grow(10, 0.1, 5).map(p => ({ t: p.t + 4e11, v: p.v }))]).code
       === 'NO_OVERLAP');
}


/* -------------------------------------------------------------------------
 * The rolling-returns redesign specification, sections 3 and 4.
 *
 * Every expected value below is worked out somewhere other than the engine.
 */
section('Volatility: the standard deviation of the windows');
{
  /* Sample standard deviation, n-1. Two values differ by 0.10, so the sample
     standard deviation is 0.10 / sqrt(2) = 0.0707107, by hand. */
  close('two windows: 0.10 apart gives 0.10/sqrt(2)',
        E.describe([0.10, 0.20]).stdev, 0.1 / Math.SQRT2, 1e-9);

  /* One window has no spread to measure. Null, not zero: zero would read as
     "this never moved", which is a much stronger claim than "unknown". */
  eq('one window has no standard deviation', E.describe([0.10]).stdev, null);

  /* A wholly flat series: every window returns the same, so the spread is
     genuinely zero and zero is the honest answer. */
  var flat = E.describe([0.12, 0.12, 0.12, 0.12]);
  close('a flat set really is zero', flat.stdev, 0, 1e-12);

  /* Worked independently against the textbook definition on a set with real
     spread: mean 0.10, deviations -0.06/-0.02/0.02/0.06, sum of squares
     0.0080, divided by n-1 = 3, square root = 0.05163978. */
  close('and matches the definition on a set with spread',
        E.describe([0.04, 0.08, 0.12, 0.16]).stdev, Math.sqrt(0.0080 / 3), 1e-12);
}

section('Rolling frequency: how far the window moves each time');
{
  /* Weekdays only, so five observations a week -- which is what makes the
     expected counts below arithmetic rather than guesswork. */
  /* A bare { } block does not scope var, so a `var d` here would hoist to
     module level and silently overwrite the d = E.utc helper for every test
     below this line. It did, and the first test to use d() afterwards was
     written months later. */
  var s = [], t = Date.UTC(2006, 0, 1), v = 100;
  while (t <= Date.UTC(2026, 0, 1)) {
    var day = new Date(t);
    if (day.getUTCDay() % 6) s.push({ t: t, v: v });
    v *= Math.pow(1.12, 1 / 365.2425);
    t += 86400000;
  }

  var daily = E.rollingReturns(s, 5, { frequency: 'daily' });
  var weekly = E.rollingReturns(s, 5, { frequency: 'weekly' });
  var monthly = E.rollingReturns(s, 5, { frequency: 'monthly' });

  ok('daily takes every observation', daily.stats.count > 3800, String(daily.stats.count));
  /* Five trading days to the week, so weekly is a fifth of daily. */
  ok('weekly takes about one in five of them',
     Math.abs(weekly.stats.count - daily.stats.count / 5) / (daily.stats.count / 5) < 0.05,
     weekly.stats.count + ' vs ' + Math.round(daily.stats.count / 5));
  /* Roughly 21.7 trading days to the month. */
  ok('and monthly about one in twenty-two',
     Math.abs(monthly.stats.count - daily.stats.count / 21.7) / (daily.stats.count / 21.7) < 0.08,
     monthly.stats.count + ' vs ' + Math.round(daily.stats.count / 21.7));

  /* Thinning changes HOW MANY windows are taken, never how any one of them is
     measured -- so on a series growing at a constant rate every frequency must
     return the same rate. */
  [daily, weekly, monthly].forEach(function (r, i) {
    close(['daily', 'weekly', 'monthly'][i] + ' measures each window identically',
          r.stats.mean, 0.12, 0.0005);
  });

  /* Consecutive starts must actually be a week and a month apart. */
  var wGaps = [];
  for (var i = 1; i < weekly.pairs.length; i++) {
    wGaps.push((weekly.pairs[i].t - weekly.pairs[i - 1].t) / 86400000);
  }
  ok('no two weekly windows start less than seven days apart',
     Math.min.apply(null, wGaps) >= 7, String(Math.min.apply(null, wGaps)));
  var mGaps = [];
  for (var j = 1; j < monthly.pairs.length; j++) {
    mGaps.push((monthly.pairs[j].t - monthly.pairs[j - 1].t) / 86400000);
  }
  ok('nor two monthly ones less than twenty-eight',
     Math.min.apply(null, mGaps) >= 28, String(Math.min.apply(null, mGaps)));

  eq('an unknown frequency falls back to daily',
     E.rollingReturns(s, 5, { frequency: 'fortnightly' }).stats.count, daily.stats.count);
  eq('and the frequency used is reported back', monthly.frequency, 'monthly');

  /* Computed from the series that actually exists, not from the dates the loop
     was given: 1 January 2006 is a Sunday, so the first weekday in it is the
     2nd and the span is 19.997 years -- which holds nineteen whole years and
     not twenty. Asserting 20 here would have been asserting my own arithmetic
     about a calendar rather than the engine's about the data. */
  var span = (s[s.length - 1].t - s[0].t) / (365.25 * 86400000);
  eq('max history is the longest whole-year horizon in the data',
     E.maxHorizon(s), Math.floor(span));
  ok('which is one short of the nominal twenty, because the file starts on a Monday',
     Math.floor(span) === 19 && span > 19.9, span.toFixed(4) + ' years');
  eq('and nothing at all when there is no history', E.maxHorizon([{ t: 1, v: 1 }]), null);
}

section('Whether two files line up, asked before anything is computed');
{
  var mk = function (y1, y2) {
    var out = [], t = Date.UTC(y1, 0, 1);
    while (t <= Date.UTC(y2, 11, 31)) { out.push({ t: t, v: 100 }); t += 86400000 * 7; }
    return out;
  };
  /* The specification's own example: 2015-2025 against 2018-2025. */
  var o = E.rangeOverlap(mk(2015, 2025), mk(2018, 2025));
  ok('an incomplete overlap is reported as one', o.ok && o.full === false);
  eq('the shared stretch starts at the later start',
     new Date(o.from).toISOString().slice(0, 10), '2018-01-01');
  close('and three years of the primary fall outside it', o.lostA, 3, 0.05);
  close('while none of the benchmark does', o.lostB, 0, 0.05);

  var same = E.rangeOverlap(mk(2015, 2025), mk(2015, 2025));
  ok('identical ranges are a full overlap, with nothing dropped',
     same.full === true && same.lostA === 0 && same.lostB === 0);

  eq('and ranges that never meet are refused',
     E.rangeOverlap(mk(2000, 2005), mk(2018, 2025)).code, 'NO_OVERLAP');
}

section('The schema gatekeeper: a tradebook is not a price series');
{
  var check = function (text) { return P.checkSchema(P.parseDelimited(text)); };

  ok('a clean NAV file passes',
     check('Date,NAV\n2021-01-01,10.5\n2021-01-04,10.6\n2021-01-05,10.7\n').ok);
  ok('and an index file passes',
     check('Date,Index Value\n2021-01-01,1000\n2021-01-04,1010\n').ok);
  ok('and so does a NAV file carrying a scheme column',
     check('Scheme Name,Date,NAV\nAcme,2021-01-01,10.5\nAcme,2021-01-04,10.6\n').ok);

  /* A tradebook has a date column and a numeric column, so the ordinary reader
     takes it: order quantities become "prices" and a rolling return comes out
     of them, confident and meaningless. Only the headings say which it is. */
  var trade = check('Symbol,ISIN,Trade Date,Exchange,Segment,Trade Type,Quantity,Price,Order ID\n' +
                    'INFY,INE009A01021,2021-01-01,NSE,EQ,buy,10,1500,O1\n' +
                    'TCS,INE467B01029,2021-01-04,NSE,EQ,sell,5,3200,O2\n');
  eq('a broker tradebook is refused', trade.code, 'TRADEBOOK');
  ok('and the columns that gave it away are named',
     trade.detected.indexOf('Order ID') !== -1 && trade.detected.indexOf('Quantity') !== -1,
     JSON.stringify(trade.detected));
  ok('with the specification’s own sentence',
     /trade logs or transaction records instead of historical NAV\/Index values/
       .test(trade.message) &&
     /Expected Schema: Date and NAV \/ Value/.test(trade.message), trade.message);

  /* AMFI-style files carry no header at all, so headings cannot be the only
     test: a column of BUY/SELL is a tradebook whatever it is called. */
  eq('a headerless file with a buy/sell column is caught by its content',
     check('2021-01-01,buy,10,1500\n2021-01-04,sell,5,3200\n2021-01-05,buy,8,1490\n').code,
     'TRADEBOOK');

  /* pickColumns finds the value column by HEADING first, so a column called
     NAV was taken as the values whatever was in it. */
  var text = check('Date,NAV\n2021-01-01,not a number\n2021-01-04,also text\n');
  eq('a value column holding text halts processing', text.code, 'NOT_NUMERIC');
  ok('and it is not called a trade log, because it is not one',
     !/trade logs/.test(text.message), text.message);
  ok('while one stray unreadable row is tolerated',
     check('Date,NAV\n2021-01-01,10.5\n2021-01-04,n/a\n2021-01-05,10.7\n2021-01-06,10.8\n').ok);

  eq('a file with no date column at all is refused',
     check('Fund,Rating\nAcme,Five\nZenith,Four\n').code, 'NO_SCHEMA');

  /* The gate has to be wrong in only one direction. Refusing a tradebook
   * costs a reader one confusing minute; refusing the file the tool exists to
   * read costs it the reader. These are the legitimate shapes, and every one
   * of them was found by feeding the gate a real file rather than by
   * imagining what one looks like. */
  var amfiBulk = ['Scheme Code;Scheme Name;ISIN Div Payout;ISIN Div Reinvestment;Net Asset Value;Date'];
  for (var ab = 0; ab < 40; ab++) {
    amfiBulk.push('120503;Alpha Fund - Direct Plan - Growth;INF204K01XI3;-;' +
                  (10 + ab).toFixed(4) + ';0' + (1 + ab % 9) + '-Jan-2020');
  }
  ok('AMFI\u2019s own bulk NAV download passes the gate',
     P.checkSchema(P.parseDelimited(amfiBulk.join('\n'))).ok,
     JSON.stringify(P.checkSchema(P.parseDelimited(amfiBulk.join('\n')))));

  ok('and so does a statement carrying a broker column',
     check('Date,Broker,NAV\n2021-01-01,ARN-0001,10.5\n2021-01-02,ARN-0001,10.6\n' +
           '2021-01-03,ARN-0001,10.7\n2021-01-04,ARN-0001,10.8\n').ok);

  ok('while a Zerodha tradebook is still caught by six other columns',
     (function () {
       var t = ['Symbol,ISIN,Trade Date,Exchange,Segment,Series,Trade Type,Quantity,Price,Order ID'];
       for (var i = 0; i < 40; i++) {
         t.push('INFY,INE009A01021,2023-01-0' + (1 + i % 9) + ',NSE,EQ,EQ,' +
                (i % 2 ? 'sell' : 'buy') + ',' + (10 + i) + ',1400.50,23000' + i);
       }
       var r = P.checkSchema(P.parseDelimited(t.join('\n')));
       return r.code === 'TRADEBOOK' && r.detected.length >= 6 &&
              r.detected.indexOf('ISIN') === -1;
     })());
}

section('Which KIND of history: a NAV file and an index file tell themselves apart');
{
  /* Shape passes both doors -- date and value each time -- so the words in
     the file decide. The user's own uploads proved the hole: a Nifty 50 file
     was accepted as Primary Investment Data, and a portfolio file as the
     Benchmark Index, and nothing downstream could tell either apart. */
  /* NOT "kindOf": that name is a module-level var in the index-NAME section
     below, and a var here would clobber it (bare blocks do not scope var). */
  var dataKindOf = function (text) { return P.guessDataKind(P.parseDelimited(text)).kind; };

  eq('AMFI’s NAV export reads as fund data',
     dataKindOf('Scheme Code;Scheme Name;Net Asset Value;Repurchase Price;Sale Price;Date\n' +
            '120503;Alpha Bluechip Fund - Direct Plan - Growth;100.5;100.4;100.6;01-Jan-2021\n'),
     'nav');
  eq('NSE’s price-index export reads as index data',
     dataKindOf('Nifty 50 Total Returns Index\nHistorical Index Data\n\n' +
            'Date,Index Name,Open Index Value,High Index Value,Low Index Value,Closing Index Value\n' +
            '01-Jan-2021,Nifty 50 TRI,1000,1010,995,1005\n'),
     'index');
  eq('the TRI csv with NTR values reads as index data',
     dataKindOf('Index Name,Index Date,Total Returns Index,NTR Values\n' +
            'NIFTY 50,31-Aug-2026,36579.00,31765.47\n'),
     'index');
  /* The trap the weighting exists for: an index FUND is a fund. Its NAV file
     says Nifty in every scheme name, and one hit must not outvote the plan
     words, the scheme column and the NAV column that say what it really is. */
  eq('an index FUND’s NAV file still reads as fund data',
     dataKindOf('Scheme Name,Date,NAV\n' +
            'UTI Nifty 50 Index Fund - Direct Plan - Growth,2021-01-01,120.5\n'),
     'nav');
  eq('a bare date,value paste claims nothing',
     dataKindOf('Date,Value\n2021-01-01,100\n2021-01-04,101\n'), null);
  eq('and a lone weak hit is not a verdict',
     dataKindOf('Date,Close\n2021-01-01,100\n'), null);

  /* The shapes that slipped through on a real phone. NSE's own csv writes
     "TotalReturnsIndex" and "HistoricalDate" as single camelCase words that a
     \s* cannot bridge, and its price export can carry nothing but bare
     OPEN/HIGH/LOW/CLOSE headings -- the index's name lives only in the file
     name. Each of these was accepted at the Primary door and must not be. */
  var kindWithName = function (text, name) {
    return P.guessDataKind(P.parseDelimited(text), name).kind;
  };
  eq('NSE’s camelCase TRI csv reads as index data',
     dataKindOf('HistoricalDate,TotalReturnsIndex\n31 Aug 2026,36579.00\n'), 'index');
  eq('a bare OPEN/HIGH/LOW/CLOSE header reads as index data',
     dataKindOf('Date,OPEN,HIGH,LOW,CLOSE\n31 Aug 2026,24117.55,24128.7,23993.6,24080.40\n'),
     'index');
  eq('a nameless date,value csv named after an index reads as index data',
     kindWithName('HistoricalDate,CLOSE\n31 Aug 2026,24080.40\n01 Sep 2026,24055.80\n',
                  'NIFTY 50_Data.csv'), 'index');
  eq('but a fund named after the index it tracks stays fund data',
     kindWithName('Scheme Name,Date,NAV\nAcme Nifty 50 Index Fund - Growth,2021-01-01,12.5\n',
                  'nifty50-index-fund-nav.xlsx'), 'nav');
  eq('and AMFI’s own file name is NAV evidence',
     kindWithName('Date,Value\n2021-01-01,100\n', 'NAV_2022-09-01_to_2026-08-19.xlsx'), null);
}


section('The headline and the comparison are the same measurement');
/* They were not. rollingReturns annualised over the days that actually
 * elapsed; windowed(), which produces every figure in the statistical summary
 * and the outperformance rate, annualised over the nominal window length and
 * ignored the rolling frequency entirely. So the median at the top of the
 * screen and the median in the table below it were the same statistic
 * computed two different ways, and switching to Monthly rolling changed one of
 * them and not the other -- 141 windows in the headline against 3,131 in the
 * comparison, on the same file, at the same time.
 *
 * A weekday-only series is what makes the two visible: a three-year target
 * landing on a Saturday ends on the Friday, so elapsed days and nominal years
 * differ on a large share of windows. */
function weekdaySeries(rate, fromY, toY, start) {
  var out = [], v = start, t = Date.UTC(fromY, 0, 1);
  while (t <= Date.UTC(toY, 0, 1)) {
    var d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) out.push({ t: t, v: v });
    v *= Math.pow(1 + rate, 1 / 365.2425);
    t += 86400000;
  }
  return out;
}
var wFund = weekdaySeries(0.14, 2010, 2025, 100);
var wIdx = weekdaySeries(0.11, 2010, 2025, 1000);

['daily', 'weekly', 'monthly'].forEach(function (freq) {
  var head = E.rollingReturns(wFund, 3, { frequency: freq });
  var cmp = E.compareRolling(wFund, wIdx, 3, { frequency: freq });
  eq(freq + ': the two count the same windows', cmp.pairs, head.stats.count);
  close(freq + ': and report the same median', cmp.fund.median, head.stats.median, 1e-12);
  close(freq + ': and the same worst window', cmp.fund.min, head.stats.min, 1e-12);
});

/* The frequency has to reach the comparison, not just the headline. */
var dailyPairs = E.compareRolling(wFund, wIdx, 3, { frequency: 'daily' }).pairs;
var monthlyPairs = E.compareRolling(wFund, wIdx, 3, { frequency: 'monthly' }).pairs;
ok('monthly thins the comparison as well as the headline',
   monthlyPairs < dailyPairs / 15 && monthlyPairs > dailyPairs / 30,
   dailyPairs + ' -> ' + monthlyPairs);

section('A horizon as long as the history leaves one window');
/* Which is reachable in one click now that Max History is offered, so the
 * screen has to know it is holding a measurement and not a distribution. */
var full = E.rollingReturns(weekdaySeries(0.12, 2010, 2025, 100), 15);
eq('fifteen-year windows on a fifteen-year file: exactly one', full.stats.count, 1);
close('and its rate is the growth rate of the series', full.stats.median, 0.12, 0.002);
ok('a single window has no spread to report', full.stats.stdev === null,
   String(full.stats.stdev));
eq('and its worst and best are the same window', full.worst.t, full.best.t);


section('Reading TRI or PRI out of a file’s own name');
/* The screen asks when it cannot tell, so the only thing that must never
 * happen is a WRONG confident answer -- and the wrong answer in the flattering
 * direction is calling a price index a total return one. Every case below is
 * a name a provider or a browser actually produces. */
function kindOf(name) {
  var TRI = /\b(tri|total\s*returns?\s*index|total\s*returns?)\b/i;
  var PRI = /\b(pri|price\s*returns?\s*index|price\s*returns?|price\s*index)\b/i;
  var t = String(name).replace(/[_.\-]+/g, ' ');
  if (PRI.test(t) && !TRI.test(t)) return 'PRICE';
  if (TRI.test(t)) return 'TRI';
  return null;
}
[['Nifty 50 TRI', 'TRI'],
 ['nse-nifty50-tri', 'TRI'],
 ['Nifty Midcap 150 TRI', 'TRI'],
 ['Nifty 50 Total Returns Index', 'TRI'],
 ['bse_500_total_return', 'TRI'],
 ['nifty-50-price-return-index', 'PRICE'],
 ['nifty_50_pri', 'PRICE'],
 ['sensex-price-index', 'PRICE'],
 ['NIFTY 50', null],
 ['sensex', null],
 ['my portfolio', null],
 /* "Tri" inside a word is not the abbreviation. */
 ['Triveni Fund', null],
 ['Nutrition Index', null]
].forEach(function (pair) {
  eq('“' + pair[0] + '” reads as ' + (pair[1] || 'unknown'), kindOf(pair[0]), pair[1]);
});


section('Sparse files: the tolerance drops windows, it never stretches them');
/* A reviewer claimed windows were being matched "to nearest observations
 * separated by up to 100 days" and annualised over the nominal length. Both
 * halves are tested here against a file shaped like the one they used --
 * 29 rows across ~7 years -- because the correct answer to a wrong claim
 * about arithmetic is arithmetic. */
var sparse = [];
(function () {
  var t = d(2017, 7, 3), v = 100;
  for (var i = 0; i < 29; i++) {
    sparse.push({ t: t, v: v });
    t += 88 * 86400000;
    v *= Math.pow(1.10, 88 / 365.2425);
  }
})();
eq('uniform 88-day gaps at a 6-year horizon leave NO windows at all',
   E.rollingReturns(sparse, 6).code, 'NO_WINDOWS');

/* An end 8 days short of the target is refused; 3 days short is taken, and
 * annualised over the days that actually elapsed, not the nominal length. */
/* Both files span 6.4 years, so the horizon fits; what differs is where the
   observations land around the 6-year target of 01-Jan-2023. Twelve days
   short is beyond the 7-day tolerance; three days short is inside it. */
var nearMiss = [
  { t: d(2017, 1, 1), v: 100 },
  { t: d(2018, 1, 1), v: 110 },
  { t: d(2022, 12, 20), v: 168 },
  { t: d(2023, 6, 1), v: 180 }
];
eq('an end twelve days short of the target is dropped, not stretched',
   E.rollingReturns(nearMiss, 6).code, 'NO_WINDOWS');
var nearHit = [
  { t: d(2017, 1, 1), v: 100 },
  { t: d(2018, 1, 1), v: 110 },
  { t: d(2022, 12, 29), v: 170 },
  { t: d(2023, 6, 1), v: 180 }
];
var nh = E.rollingReturns(nearHit, 6);
eq('three days short is taken', nh.stats.count, 1);
var elapsed = E.dayCount(d(2017, 1, 1), d(2022, 12, 29));
close('and annualised over the days that actually elapsed (the reviewer’s own formula)',
      nh.values[0], Math.pow(1.7, 365 / elapsed) - 1, 1e-12);
ok('which is not the figure the nominal six years would give',
   Math.abs(nh.values[0] - (Math.pow(1.7, 1 / 6) - 1)) > 1e-5,
   String(nh.values[0]));

section('How often a file has a value at all');
/* The median day-gap, which is what gates the frequency chips: a control
 * offering daily steps over quarterly data promises a fineness the file does
 * not have. Median, not mean -- a weekday file is 1-day gaps with 3-day
 * weekends, and the mean would call that 1.4. */
function gapSeries(gaps) {
  var out = [{ t: d(2020, 1, 1), v: 100 }];
  var t = d(2020, 1, 1);
  gaps.forEach(function (g) { t += g * 86400000; out.push({ t: t, v: 100 }); });
  return out;
}
eq('a weekday file reads as daily', E.medianGapDays(gapSeries([1, 1, 1, 1, 3, 1, 1, 1, 1, 3])), 1);
eq('a quarterly statement reads as quarterly', E.medianGapDays(gapSeries([88, 92, 90, 91])), 90.5);
eq('one gap is that gap', E.medianGapDays(gapSeries([30])), 30);
eq('one row has no gap to measure', E.medianGapDays([{ t: 0, v: 1 }]), null);
eq('and no series, none either', E.medianGapDays(null), null);



section('Percentile bands and downside deviation — closed-form');
{
  var ten = [];
  for (var pv = 1; pv <= 10; pv++) ten.push(pv);
  var dsc = E.rollingReturns ? null : null; /* describe is internal; reach it through rollingReturns? no — test the exported surface */
  /* describe() is not exported; its p10/p90 reach the screen through
     rollingReturns().stats, so build a series whose window returns are known
     and read the stats. A 12%-constant series gives p10 = p90 = 12%. */
  var steady10 = (function () {
    var out = [], t = Date.UTC(2010, 0, 1), t0 = t, end = Date.UTC(2025, 0, 1);
    while (t <= end) {
      out.push({ t: t, v: 100 * Math.pow(1.12, (t - t0) / 86400000 / 365.2425) });
      t += 86400000;
    }
    return out;
  })();
  var r10 = E.rollingReturns(steady10, 5);
  ok('a constant-growth series has flat percentile bands',
     r10.ok && Math.abs(r10.stats.p10 - 0.12) < 5e-4 && Math.abs(r10.stats.p90 - 0.12) < 5e-4,
     r10.ok ? 'p10 ' + r10.stats.p10 + ' p90 ' + r10.stats.p90 : r10.message);
  ok('and the bands sit inside min and max',
     r10.stats.min <= r10.stats.p10 && r10.stats.p10 <= r10.stats.median &&
     r10.stats.median <= r10.stats.p90 && r10.stats.p90 <= r10.stats.max);

  close('downside deviation of [-10%,0,10%,20%] below a 5% mark',
        E.downsideDeviation([-0.10, 0, 0.10, 0.20], 0.05),
        Math.sqrt((0.15 * 0.15 + 0.05 * 0.05) / 4), 1e-12);
  eq('one value has no deviation to measure', E.downsideDeviation([0.1], 0.05), null);
  close('all values above the mark measure zero',
        E.downsideDeviation([0.10, 0.12, 0.14], 0.05), 0, 1e-12);
}

/* ============================ September review: the market-index arithmetic */
section('CAGR over calendar days: 365.25 is opt-in, 365 stays the default');
{
  /* Two points, 1,461 days apart (four calendar years including one leap
     day), the value doubling. Closed form: 2^(basis/1461) - 1. */
  var two = [{ t: d(2020, 1, 1), v: 100 }, { t: d(2024, 1, 1), v: 200 }];
  var r365 = E.rollingReturns(two, 4);
  var r36525 = E.rollingReturns(two, 4, { dayBasis: 365.25 });
  ok('both measure the one window', r365.ok && r36525.ok && r365.values.length === 1 && r36525.values.length === 1);
  close('the default basis is 365 days', r365.values[0], Math.pow(2, 365 / 1461) - 1, 1e-12);
  close('365.25 is used when asked for', r36525.values[0], Math.pow(2, 365.25 / 1461) - 1, 1e-12);
  /* A longer year takes a larger share of the doubling: the 365.25 figure is
     the higher, and only by about a hundredth of a point. */
  ok('and the 365.25 figure is the larger of the two, by a hair',
     r36525.values[0] > r365.values[0] && r36525.values[0] - r365.values[0] < 2e-4,
     r365.values[0] + ' vs ' + r36525.values[0]);
  eq('the default is written down', E.DEFAULT_DAY_BASIS, 365);
}

section('Annualised volatility, scaled by the observations the file actually holds');
{
  /* A constant-growth series has no dispersion in its log returns at all. */
  var flat = [], v = 100, t = d(2020, 1, 1);
  for (var i = 0; i < 400; i++) { flat.push({ t: t, v: v }); v *= 1.0003; t += 86400000; }
  var fv = E.annualisedVolatility(flat);
  ok('a constant-growth series reads as zero volatility', fv.ok && fv.sigma < 1e-9, JSON.stringify(fv));
  /* Alternating +10% / -10% daily, 365 observations a year: the log returns
     alternate between ln(1.1) and ln(0.9); their sample standard deviation
     is half their gap (for an even count), times sqrt(365). */
  var alt = [], av = 100, at = d(2020, 1, 1);
  for (var j = 0; j <= 730; j++) { alt.push({ t: at, v: av }); av *= (j % 2 === 0 ? 1.1 : 0.9); at += 86400000; }
  var fa = E.annualisedVolatility(alt);
  var gap = Math.log(1.1) - Math.log(0.9);
  /* 730 returns over two years of 365.2425 days: 365.2425 observations a
     year, and the (n-1) sample correction on 730 of them. */
  var expected = (gap / 2) * Math.sqrt(730 / 729) * Math.sqrt(365.2425);
  close('an alternating series measures half the gap times root observations-a-year',
        fa.sigma, expected, 1e-6);
  ok('the observations a year are the file’s own count', fa.ok && Math.abs(fa.observationsPerYear - 365.2425) < 1e-6,
     String(fa.observationsPerYear));
  ok('a series of two cannot be measured', E.annualisedVolatility(flat.slice(0, 2)).ok === false);
  /* The two class marks used by the screen: 4% a year stays under 6, 20% over 12. */
  ok('the flat series is under the fixed-income mark', fv.sigma <= 0.06);
  ok('the alternating series is over the equity mark', fa.sigma >= 0.12);
}

section('A strict calendar join, filled forward and never backward');
{
  /* Fund on every day of ten; index only on days 1, 4, 7, 10. */
  var f = [], x = [], t0 = d(2021, 1, 1);
  for (var k = 0; k < 10; k++) {
    f.push({ t: t0 + k * 86400000, v: 100 + k });
    if (k % 3 === 0) x.push({ t: t0 + k * 86400000, v: 1000 + k });
  }
  var al = E.alignCalendar(f, x);
  ok('the join succeeds', al.ok);
  eq('every date either file holds inside the overlap is on the calendar', al.dates, 10);
  eq('the fund needed no filling', al.filledA, 0);
  eq('the index was carried forward on the six dates it lacked', al.filledB, 6);
  eq('a carried value is the last one actually observed', al.b[2].v, 1000);
  ok('and is marked as carried', al.b[2].carried === true && !al.b[3].carried);
  eq('an observed date keeps its own value', al.b[3].v, 1003);
  /* The index starts two days later: nothing is invented before it begins. */
  var late = x.slice(1);
  var al2 = E.alignCalendar(f, late);
  eq('the calendar begins where both files have a value', al2.from, late[0].t);
  eq('so the fund loses its first three dates and the index is never filled backward', al2.dates, 7);
  ok('no shared dates at all is refused',
     E.alignCalendar(f, [{ t: d(2022, 1, 1), v: 1 }, { t: d(2022, 1, 2), v: 1 }]).ok === false);
}

section('compareRolling on the calendar join');
{
  var fund = [], bench = [], tt = d(2018, 1, 1);
  var fvv = 100, bvv = 1000;
  while (tt <= d(2024, 1, 1)) {
    fund.push({ t: tt, v: fvv });
    /* the index file skips every seventh day */
    if (Math.round((tt - d(2018, 1, 1)) / 86400000) % 7 !== 6) bench.push({ t: tt, v: bvv });
    fvv *= Math.pow(1.07, 1 / 365.2425); bvv *= Math.pow(1.10, 1 / 365.2425); tt += 86400000;
  }
  var cj = E.compareRolling(fund, bench, 3, { join: 'calendar', dayBasis: 365.25 });
  var cs = E.compareRolling(fund, bench, 3, { dayBasis: 365.25 });
  ok('both joins succeed', cj.ok && cs.ok);
  eq('the calendar join says so', cj.join, 'calendar');
  eq('the start-date join says so', cs.join, 'start-date');
  ok('the calendar join fills the index on the days it lacked and the fund on none',
     cj.filledBench > 0 && cj.filledFund === 0, cj.filledFund + '/' + cj.filledBench);
  ok('the calendar join pairs every window the fund has, the start-date join fewer',
     cj.pairs > cs.pairs, cj.pairs + ' vs ' + cs.pairs);
  close('the fund side still measures 7% a year', cj.fund.median, 0.07, 2e-3);
  close('and the index side 10%', cj.bench.median, 0.10, 2e-3);
  eq('the fund is never ahead of a faster index', cj.fundAhead, 0);
}

console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  console.log('\nFAILED:\n  ' + failed.join('\n  '));
  process.exit(1);
}
