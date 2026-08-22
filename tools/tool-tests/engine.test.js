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
close('a doubling year measures 100%', oneYear.stats.max, 1.0, 1e-9);
close('a flat year measures 0%', oneYear.stats.min, 0.0, 1e-9);
close('two-year window over a double then flat = 41.42%',
  E.rollingReturns(stepped, 2).stats.mean, Math.sqrt(2) - 1, 1e-9);

section('Rolling returns — which start date produced which result');
var dated = E.rollingReturns(stepped, 1);
ok('the best window names the day it started', dated.best.t === d(2020, 1, 1),
   String(dated.best && dated.best.t));
ok('the worst window names its own start day', dated.worst.t === d(2021, 1, 1),
   String(dated.worst && dated.worst.t));
close('the best window carries its own return', dated.best.r, 1.0, 1e-9);
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
console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  console.log('\nFAILED:\n  ' + failed.join('\n  '));
  process.exit(1);
}
