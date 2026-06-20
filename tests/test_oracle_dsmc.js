/* Node verification for the DYNAMIC STOCHASTIC Monte Carlo engine
 * (oracle-dsmc.js). Run: node tests/test_oracle_dsmc.js
 *
 * Locks: sleeve estimation, the glide-path schedule, simulation mechanics
 * (bands, ordering, widening), determinism, and the three dynamic levers —
 * regime-switching fattens the downside, the glide-path narrows terminal
 * dispersion, the step-up SIP lifts the corpus, and stochastic inflation
 * makes the FFN target itself a distribution. */
'use strict';
const O = require('../oracle.js');
const D = require('../oracle-dsmc.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e ? '   ' + e : '')); } };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const L = (v) => '₹' + (v / 1e5).toFixed(2) + ' L';

/* ---------------- glide-path schedule ---------------- */
console.log('\n1. Glide-path schedule (Autonomous countdown)');
ok('10+ years => 100% equity', close(D.glideEquity(12), 1.0) && close(D.glideEquity(10), 1.0));
ok('5 years => 85% equity', close(D.glideEquity(5), 0.85));
ok('3 years => 70% equity', close(D.glideEquity(3), 0.70));
ok('1 year => 50% equity', close(D.glideEquity(1), 0.50));
ok('monotonic non-increasing as the goal nears', D.glideEquity(8) >= D.glideEquity(4) && D.glideEquity(4) >= D.glideEquity(2));

/* ---------------- sleeve estimation ---------------- */
console.log('\n2. Sleeve estimation');
const pf = O.samplePortfolio('2026-06-20');
const sl = D.estimateSleeves(pf);
ok('startEquity is a fraction in [0,1]', sl.startEquity >= 0 && sl.startEquity <= 1, `(${(sl.startEquity * 100).toFixed(0)}%)`);
ok('equity sleeve return is plausible (2–30%)', sl.equity.mu > 0.02 && sl.equity.mu < 0.30, `(${(sl.equity.mu * 100).toFixed(1)}%)`);
ok('equity sleeve vol is plausible (6–45%)', sl.equity.sigma > 0.06 && sl.equity.sigma < 0.45, `(${(sl.equity.sigma * 100).toFixed(1)}%)`);
ok('debt sleeve is quieter than equity', sl.debt.sigma < sl.equity.sigma);
ok('starts from the portfolio current value', close(sl.startValue, O.portfolioSummary(pf.holdings).current, 1e-3));

/* ---------------- simulation mechanics ---------------- */
console.log('\n3. Simulation mechanics');
const mc = D.simulate({ startValue: 1000000, monthlySip: 0, years: 10, mode: 'static', startEquity: 1, paths: 3000, seed: 7, target: 2500000 });
ok('produces a band row per year (0..years)', mc.bands.length === 11 && mc.bands[0].p50 === 1000000);
ok('percentiles ordered p5 <= p50 <= p95 at the horizon', mc.finalPercentiles.p5 <= mc.finalPercentiles.p50 && mc.finalPercentiles.p50 <= mc.finalPercentiles.p95);
ok('bands widen over time (p90-p10 grows)', (mc.bands[10].p90 - mc.bands[10].p10) > (mc.bands[2].p90 - mc.bands[2].p10));
ok('keeps sample paths for plotting', mc.samples.length > 0 && mc.samples[0].length === 11);
ok('reports an expected crisis fraction (5–20%)', mc.expectedCrisisFraction > 0.05 && mc.expectedCrisisFraction < 0.20, `(${(mc.expectedCrisisFraction * 100).toFixed(1)}%)`);

/* ---------------- deterministic collapse ---------------- */
console.log('\n4. Deterministic collapse (no vol, no regimes, no inflation)');
const det = D.simulate({
  startValue: 1000000, monthlySip: 0, years: 10, mode: 'static', startEquity: 1,
  equity: { mu: 0.12, sigma: 0 }, debt: { mu: 0.066, sigma: 0 },
  regimes: false, stochasticInflation: false, paths: 25, seed: 1,
});
ok('zero-vol static median = deterministic FV (1.12^10)', close(det.finalPercentiles.p50, 1000000 * Math.pow(1.12, 10), 1), `(${L(det.finalPercentiles.p50)})`);

/* ---------------- determinism ---------------- */
console.log('\n5. Determinism');
const a = D.simulate({ startValue: 500000, monthlySip: 10000, years: 15, paths: 800, seed: 42 });
const b = D.simulate({ startValue: 500000, monthlySip: 10000, years: 15, paths: 800, seed: 42 });
const c = D.simulate({ startValue: 500000, monthlySip: 10000, years: 15, paths: 800, seed: 43 });
ok('same seed => identical median', close(a.median, b.median));
ok('different seed => different draws', !close(a.median, c.median));

/* ---------------- dynamic lever 1: regimes fatten the downside ---------------- */
console.log('\n6. Regime-switching fattens the downside');
const base = { startValue: 1000000, monthlySip: 0, years: 15, mode: 'static', startEquity: 1, paths: 4000, seed: 11 };
const rOn = D.simulate({ ...base, regimes: true });
const rOff = D.simulate({ ...base, regimes: false });
ok('regimes push the bad-case (p5) lower than a plain walk', rOn.finalPercentiles.p5 < rOff.finalPercentiles.p5, `(${L(rOn.finalPercentiles.p5)} < ${L(rOff.finalPercentiles.p5)})`);
ok('regimes spend a non-zero number of months in crisis', rOn.avgCrisisMonths > 0, `(${rOn.avgCrisisMonths.toFixed(1)} mo)`);
ok('plain walk reports zero crisis months', rOff.avgCrisisMonths === 0);

/* ---------------- dynamic lever 2: glide narrows terminal dispersion ---------------- */
console.log('\n7. Glide-path narrows terminal dispersion');
const glide = D.simulate({ startValue: 1000000, monthlySip: 0, years: 8, mode: 'glide', paths: 4000, seed: 3 });
const allEq = D.simulate({ startValue: 1000000, monthlySip: 0, years: 8, mode: 'static', startEquity: 1, paths: 4000, seed: 3 });
const last = (x) => x.bands[x.bands.length - 1];
ok('glide spread (p90-p10) is tighter than always-100% equity', (last(glide).p90 - last(glide).p10) < (last(allEq).p90 - last(allEq).p10));
const glideMono = glide.glide.every((w, i, arr) => i === 0 || w <= arr[i - 1] + 1e-9);
ok('glide equity weight steps down toward 0.5 at the goal', glideMono && glide.glide[0] > 0.5 && glide.glide[0] <= 1.0 && close(glide.glide[glide.glide.length - 1], 0.5), `(${glide.glide[0].toFixed(2)} -> ${glide.glide[glide.glide.length - 1].toFixed(2)})`);
ok('glide protects the bad case (higher p10) vs all-equity', last(glide).p10 >= last(allEq).p10);

/* ---------------- dynamic lever 3: step-up SIP lifts the corpus ---------------- */
console.log('\n8. Dynamic step-up SIP');
const flat = D.simulate({ startValue: 0, monthlySip: 10000, stepUpRate: 0, years: 20, paths: 1500, seed: 5 });
const step = D.simulate({ startValue: 0, monthlySip: 10000, stepUpRate: 0.10, years: 20, paths: 1500, seed: 5 });
ok('a step-up invests more over time', step.invested > flat.invested, `(${L(step.invested)} > ${L(flat.invested)})`);
ok('a step-up yields a larger median corpus', step.median > flat.median, `(${L(step.median)} > ${L(flat.median)})`);

/* ---------------- dynamic lever 4: stochastic inflation moves the target ---------------- */
console.log('\n9. Stochastic inflation => a moving FFN target');
const dyn = D.simulate({ startValue: 2000000, monthlySip: 25000, years: 18, currentMonthlyExpense: 50000, stochasticInflation: true, paths: 3000, seed: 8 });
ok('probReachTarget is a probability in [0,1]', dyn.probReachTarget >= 0 && dyn.probReachTarget <= 1, `(${(dyn.probReachTarget * 100).toFixed(0)}%)`);
ok('the FFN target is itself a distribution (p90 > p10)', dyn.targetPercentiles.p90 > dyn.targetPercentiles.p10, `(${L(dyn.targetPercentiles.p10)}..${L(dyn.targetPercentiles.p90)})`);
ok('median target inflates today\'s ₹50k spend well above it', dyn.target > 50000 * 12 / 0.035, `(${L(dyn.target)})`);

/* ---------------- convenience wrapper ---------------- */
console.log('\n10. simulatePortfolioDynamic()');
const sp = D.simulatePortfolioDynamic(pf, { years: 12, monthlySip: 30000, stepUpRate: 0.08, currentMonthlyExpense: 60000, paths: 1500, seed: 9 });
ok('starts from the portfolio current value', close(sp.startValue, O.portfolioSummary(pf.holdings).current, 1e-3));
ok('returns a probability of reaching the dynamic FFN', sp.probReachTarget >= 0 && sp.probReachTarget <= 1, `(${(sp.probReachTarget * 100).toFixed(0)}%)`);
ok('carries the estimated sleeves through', isFinite(sp.sleeves.equity.mu) && isFinite(sp.sleeves.debt.sigma));
ok('exposes a per-year glide-path of length years+1', sp.glide.length === 13);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
