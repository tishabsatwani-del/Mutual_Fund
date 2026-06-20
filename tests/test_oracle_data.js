/* Node verification for the real-data adapter (oracle-data.js).
 * Run: node tests/test_oracle_data.js
 * Tests the PURE transforms against a fixture shaped exactly like an mfapi.in
 * response (no network needed), and proves a fetched fund flows cleanly into
 * the diagnostic engine. */
'use strict';
const D = require('../oracle-data.js');
const O = require('../oracle.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e ? '   ' + e : '')); } };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* Build a fixture: ~26 months of daily-ish NAVs, newest first (mfapi order). */
function fixture() {
  const data = [];
  const start = new Date(Date.UTC(2024, 0, 1));
  let nav = 100;
  const pts = [];
  for (let i = 0; i < 800; i++) {
    const d = new Date(start.getTime() + i * 24 * 3600 * 1000);
    nav *= 1 + (0.0004 + (i % 7 === 0 ? -0.001 : 0.0006));
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    pts.push({ date: `${dd}-${mm}-${d.getUTCFullYear()}`, nav: nav.toFixed(4) });
  }
  pts.reverse(); // newest first
  return { meta: { scheme_code: 123456, scheme_name: 'Test Bluechip Fund - Direct Plan - Growth', fund_house: 'Test AMC', scheme_category: 'Equity Scheme - Large Cap Fund' }, data: pts };
}

/* ---------------- date & category parsing ---------------- */
console.log('\n1. Parsing helpers');
ok('parseMfDate converts dd-mm-yyyy -> yyyy-mm-dd', D.parseMfDate('15-04-2021') === '2021-04-15');
ok('parseMfDate rejects bad input', D.parseMfDate('2021/04/15') === null);
ok('assetClassOf maps equity categories', D.assetClassOf('Equity Scheme - Large Cap Fund') === 'Equity');
ok('assetClassOf maps debt categories', D.assetClassOf('Debt Scheme - Liquid Fund') === 'Debt');
ok('assetClassOf maps hybrid/arbitrage', D.assetClassOf('Hybrid Scheme - Arbitrage Fund') === 'Hybrid');

/* ---------------- monthly resampling ---------------- */
console.log('\n2. Monthly resampling');
const chrono = [
  { date: '2024-01-05', nav: 100 }, { date: '2024-01-20', nav: 102 }, // Jan -> 102 (last)
  { date: '2024-02-10', nav: 105 }, // Feb -> 105
  { date: '2024-03-31', nav: 110 }, // Mar -> 110
];
const monthly = D.toMonthly(chrono, 60);
ok('keeps one point per month (last NAV of the month)', monthly.length === 3 && close(monthly[0], 102) && monthly[2], JSON.stringify(monthly));
ok('caps to maxMonths most recent', D.toMonthly(chrono, 2).length === 2);

/* ---------------- full fund parse ---------------- */
console.log('\n3. parseFund() on an mfapi-shaped fixture');
const parsed = D.parseFund(fixture());
ok('reads scheme name, code, AMC', parsed.scheme === 'Test Bluechip Fund - Direct Plan - Growth' && parsed.schemeCode === 123456 && parsed.amc === 'Test AMC');
ok('classifies as Equity, Direct plan', parsed.assetClass === 'Equity' && parsed.plan === 'Direct');
ok('latest NAV is the most recent (chronologically last)', parsed.latestNav > 100);
ok('navHistory is monthly, oldest-first, and non-trivial', parsed.navHistory.length >= 24 && parsed.navHistory[0] < parsed.navHistory[parsed.navHistory.length - 1]);
ok('rejects a malformed payload', (() => { try { D.parseFund({ foo: 1 }); return false; } catch (e) { return true; } })());

/* ---------------- holding construction ---------------- */
console.log('\n4. buildHolding()');
const h = D.buildHolding(parsed, { invested: 100000, avgCost: 80, purchaseDate: '2024-06-01', plan: 'Direct' });
ok('derives units from invested / avgCost', close(h.units, 100000 / 80, 1e-6));
ok('uses the live latest NAV', h.nav === parsed.latestNav);
ok('carries the real monthly navHistory onto the holding', h.navHistory.length === parsed.navHistory.length);
ok('builds a dated transaction', h.transactions[0].date === '2024-06-01' && h.transactions[0].amount === 100000);

/* ---------------- flows through the diagnostic engine ---------------- */
console.log('\n5. A real-data holding runs through diagnose()');
const benchmark = O.samplePortfolio('2026-06-20').benchmark;
const portfolio = { name: 'Real', asOf: '2026-06-20', benchmark, holdings: [h] };
const dx = O.diagnose(portfolio, { asOf: '2026-06-20' });
ok('produces risk stats from the real history', dx.funds[0].risk && isFinite(dx.funds[0].risk.beta) && isFinite(dx.funds[0].risk.sharpe));
ok('produces rolling returns from the real history', dx.funds[0].rolling && dx.funds[0].rolling['3y']);
ok('spendable cash computes', isFinite(dx.spendable.net));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
