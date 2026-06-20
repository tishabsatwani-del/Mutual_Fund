/* Node verification for the Monte Carlo engine (oracle-sim.js) and the
 * custom what-if stress. Run: node tests/test_oracle_sim.js
 * Locks parameter estimation, percentile ordering, determinism, the law-of-
 * large-numbers sanity of the median, and probability outputs. */
'use strict';
const O = require('../oracle.js');
const F = require('../oracle-future.js');
const S = require('../oracle-sim.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e ? '   ' + e : '')); } };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const L = (v) => '₹' + (v / 1e5).toFixed(2) + ' L';

/* ---------------- parameter estimation ---------------- */
console.log('\n1. Portfolio parameter estimation');
const pf = O.samplePortfolio('2026-06-20');
const params = S.estimatePortfolioParams(pf);
ok('estimates a plausible annual return from history (5–25%)', params.annualReturn > 0.05 && params.annualReturn < 0.25, `(${(params.annualReturn * 100).toFixed(1)}%)`);
ok('estimates a plausible annual vol (3–30%)', params.annualVol > 0.03 && params.annualVol < 0.30, `(${(params.annualVol * 100).toFixed(1)}%)`);
ok('uses history when available', /history/.test(params.source), params.source);
// No-history portfolio falls back to asset-class blend.
const noHist = { holdings: [
  { units: 100, nav: 100, assetClass: 'Equity' },
  { units: 100, nav: 100, assetClass: 'Debt' },
] };
const pa = S.estimatePortfolioParams(noHist);
ok('falls back to an asset-class blend with no history', pa.source === 'assumption' && close(pa.annualReturn, (0.12 + 0.066) / 2, 1e-9));

/* ---------------- Monte Carlo mechanics ---------------- */
console.log('\n2. Monte Carlo mechanics');
const mc = S.monteCarlo({ startValue: 1000000, monthlySip: 0, years: 10, annualReturn: 0.12, annualVol: 0.15, paths: 4000, seed: 7, target: 2500000 });
ok('produces a band row per year (0..years)', mc.bands.length === 11 && mc.bands[0].p50 === 1000000);
ok('percentiles are ordered p5 <= p50 <= p95 at the horizon', mc.finalPercentiles.p5 <= mc.finalPercentiles.p50 && mc.finalPercentiles.p50 <= mc.finalPercentiles.p95);
ok('bands widen over time (p90-p10 grows)', (mc.bands[10].p90 - mc.bands[10].p10) > (mc.bands[2].p90 - mc.bands[2].p10));
// With zero vol, every path is the deterministic compounding -> median ~ lump FV.
const det = S.monteCarlo({ startValue: 1000000, monthlySip: 0, years: 10, annualReturn: 0.12, annualVol: 0, paths: 50, seed: 1, fatTail: false });
ok('zero-vol median equals deterministic FV (1.12^10)', close(det.finalPercentiles.p50, 1000000 * Math.pow(1.12, 10), 1));
// Median of many paths is near the deterministic growth (within a sensible band).
const detFV = 1000000 * Math.pow(1.12, 10);
ok('stochastic median is in the right ballpark of deterministic FV', mc.median > detFV * 0.6 && mc.median < detFV * 1.2, `(${L(mc.median)} vs ${L(detFV)})`);
ok('probReachTarget is a probability in [0,1]', mc.probReachTarget >= 0 && mc.probReachTarget <= 1, `(${(mc.probReachTarget * 100).toFixed(0)}%)`);
ok('probLoseMoney is small for a +12% 10y horizon', mc.probLoseMoney < 0.2, `(${(mc.probLoseMoney * 100).toFixed(1)}%)`);
ok('keeps a handful of sample paths for plotting', mc.samples.length > 0 && mc.samples[0].length === 11);

/* ---------------- determinism ---------------- */
console.log('\n3. Determinism');
const a = S.monteCarlo({ startValue: 500000, monthlySip: 10000, years: 15, annualReturn: 0.11, annualVol: 0.16, paths: 1000, seed: 42 });
const b = S.monteCarlo({ startValue: 500000, monthlySip: 10000, years: 15, annualReturn: 0.11, annualVol: 0.16, paths: 1000, seed: 42 });
ok('same seed => identical median', close(a.median, b.median));
const c = S.monteCarlo({ startValue: 500000, monthlySip: 10000, years: 15, annualReturn: 0.11, annualVol: 0.16, paths: 1000, seed: 43 });
ok('different seed => different draws', !close(a.median, c.median));

/* ---------------- higher SIP / longer horizon dominate ---------------- */
console.log('\n4. Monotonic sanity');
const lowSip = S.monteCarlo({ startValue: 0, monthlySip: 5000, years: 20, annualReturn: 0.11, annualVol: 0.15, paths: 1500, seed: 5 });
const hiSip = S.monteCarlo({ startValue: 0, monthlySip: 20000, years: 20, annualReturn: 0.11, annualVol: 0.15, paths: 1500, seed: 5 });
ok('a larger SIP yields a larger median corpus', hiSip.median > lowSip.median);

/* ---------------- simulatePortfolio + FFN probability ---------------- */
console.log('\n5. simulatePortfolio()');
const sp = S.simulatePortfolio(pf, { years: 15, monthlySip: 30000, target: 15000000, paths: 1500, seed: 9 });
ok('starts from the portfolio current value', close(sp.startValue, O.portfolioSummary(pf.holdings).current, 1e-3));
ok('returns a probability of reaching the FFN target', sp.probReachTarget >= 0 && sp.probReachTarget <= 1, `(${(sp.probReachTarget * 100).toFixed(0)}%)`);
ok('carries the estimated params through', isFinite(sp.params.annualReturn) && isFinite(sp.params.annualVol));

/* ---------------- custom what-if stress ---------------- */
console.log('\n6. Custom what-if stress (oracle-future)');
const cs = F.customStress(pf, { equityShock: -0.5, debtShock: -0.02, recoveryMonths: 18, name: 'My crash' });
ok('custom stress is allocation-aware and negative', cs.drawdownPct < 0 && cs.drawdownPct > -0.5, `(${(cs.drawdownPct * 100).toFixed(1)}%)`);
ok('a deeper equity shock => a deeper portfolio drawdown', F.customStress(pf, { equityShock: -0.6 }).drawdownPct < F.customStress(pf, { equityShock: -0.3 }).drawdownPct);
ok('trough = current × (1 + drawdown)', close(cs.troughValue, cs.currentValue * (1 + cs.drawdownPct), 1));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
