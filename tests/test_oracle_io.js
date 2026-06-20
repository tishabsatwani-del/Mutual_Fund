/* Node verification for the Oracle data I/O layer (oracle-io.js).
 * Run: node tests/test_oracle_io.js
 * Locks CSV parsing/validation, CSV round-trip, and JSON portfolio round-trip,
 * and proves an imported portfolio runs clean through the full analysis. */
'use strict';
const IO = require('../oracle-io.js');
const O = require('../oracle.js');
const F = require('../oracle-future.js');
const W = require('../oracle-workflow.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e ? '   ' + e : '')); } };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* ---------------- CSV parsing ---------------- */
console.log('\n1. CSV parsing & validation');
const goodCsv = [
  'scheme,amc,category,plan,units,nav,avgCost,invested,purchaseDate,ter',
  'Bluechip Large Cap Fund,AMC One,Large Cap Equity,Direct,1000,200,100,100000,2021-04-15,0.55',
  '"Smith, Jones & Co Fund",AMC Two,Mid Cap Equity,Regular,500,150,120,,2022-01-01,1.75',
  'Liquid Fund,AMC Three,Debt — Liquid,Direct,2000,110.5,100,200000,2023-06-01,',
].join('\n');
const r = IO.parseHoldingsCSV(goodCsv);
ok('parses all valid rows, no errors', r.holdings.length === 3 && r.errors.length === 0, JSON.stringify(r.errors));
ok('handles a quoted comma in the scheme name', r.holdings[1].scheme === 'Smith, Jones & Co Fund');
ok('reads ter as a percent (0.55 -> 0.0055)', close(r.holdings[0].ter, 0.0055));
ok('blank ter -> null', r.holdings[2].ter === null);
ok('defaults invested to units*avgCost when blank', close(r.holdings[1].invested, 500 * 120));
ok('infers assetClass from category', r.holdings[0].assetClass === 'Equity' && r.holdings[2].assetClass === 'Debt');
ok('normalises plan text', r.holdings[1].plan === 'Regular' && r.holdings[0].plan === 'Direct');
ok('builds a transaction from purchaseDate + invested', r.holdings[0].transactions.length === 1 && r.holdings[0].transactions[0].amount === 100000);

console.log('\n2. CSV error handling');
const missingCol = IO.parseHoldingsCSV('scheme,units,nav\nX,1,2');
ok('reports missing required columns', missingCol.holdings.length === 0 && /Missing required column/.test(missingCol.errors[0]));
const badRows = IO.parseHoldingsCSV([
  'scheme,category,plan,units,nav,avgCost,purchaseDate',
  ',Equity,Direct,1,2,3,2020-01-01',          // missing scheme
  'Good,Equity,Direct,1,2,3,2020-01-01',       // ok
  'Bad NAV,Equity,Direct,1,x,3,2020-01-01',    // invalid nav
  'Bad Date,Equity,Direct,1,2,3,01/01/2020',   // bad date
].join('\n'));
ok('keeps good rows and flags bad ones with row numbers', badRows.holdings.length === 1 && badRows.errors.length === 3, JSON.stringify(badRows.errors));
ok('row error messages name the problem', /missing scheme/.test(badRows.errors[0]) && /invalid nav/.test(badRows.errors[1]) && /YYYY-MM-DD/.test(badRows.errors[2]));

/* ---------------- CSV round-trip ---------------- */
console.log('\n3. CSV round-trip');
const back = IO.parseHoldingsCSV(IO.holdingsToCSV(r.holdings));
ok('export -> import preserves count', back.holdings.length === r.holdings.length);
ok('export -> import preserves key fields', (() => {
  for (let i = 0; i < r.holdings.length; i++) {
    const a = r.holdings[i], b = back.holdings[i];
    if (a.scheme !== b.scheme || !close(a.units, b.units) || !close(a.nav, b.nav) || a.plan !== b.plan) return false;
    if ((a.ter == null) !== (b.ter == null)) return false;
    if (a.ter != null && !close(a.ter, b.ter, 1e-6)) return false;
  }
  return true;
})());
ok('template parses cleanly', IO.parseHoldingsCSV(IO.csvTemplate()).holdings.length === 1);

/* ---------------- JSON round-trip ---------------- */
console.log('\n4. JSON portfolio round-trip');
const pf = O.samplePortfolio('2026-06-20');
const json = IO.portfolioToJSON(pf);
const pf2 = IO.parsePortfolioJSON(json);
ok('round-trips holding count and benchmark', pf2.holdings.length === pf.holdings.length && pf2.benchmark.navHistory.length === pf.benchmark.navHistory.length);
ok('round-tripped portfolio produces the same current value', (() => {
  const a = O.portfolioSummary(pf.holdings).current, b = O.portfolioSummary(pf2.holdings).current;
  return close(a, b, 1e-3);
})());
ok('rejects non-portfolio JSON', (() => { try { IO.parsePortfolioJSON('{"foo":1}'); return false; } catch (e) { return true; } })());

/* ---------------- imported CSV flows through the whole engine ---------------- */
console.log('\n5. Imported portfolio runs through full analysis');
const imported = { name: 'Imported', asOf: '2026-06-20', benchmark: pf.benchmark, holdings: r.holdings };
const A = W.analyze(imported, { yearsToGoal: 10, monthlySip: 20000, currentMonthlyExpense: 40000, niftyPE: 24 });
ok('health score computes in [0,10] for a CSV-imported book', A.score.overall >= 0 && A.score.overall <= 10, `(${A.score.overall})`);
ok('spendable cash computes for the imported book', isFinite(A.dx.spendable.net) && A.dx.spendable.net > 0);
ok('action board generates at least one item', A.actions.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
