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
