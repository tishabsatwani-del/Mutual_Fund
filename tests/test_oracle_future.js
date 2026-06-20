/* Node verification for the Autonomous Portfolio Oracle — Part 2 engine
 * (oracle-future.js). Run: node tests/test_oracle_future.js
 * Locks the prognostic invariants: FFN inflation/corpus maths, the glide-path
 * anchors and STP sizing, valuation signals, and allocation-aware stress. */
'use strict';
const O = require('../oracle.js');
const F = require('../oracle-future.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const L = (v) => '₹' + (v / 1e5).toFixed(2) + ' L';

/* ---------------- 1. Dynamic FFN ---------------- */
console.log('\n1. Dynamic Financial Freedom Number');
// Spec worked example: 50,000 today, 20y, 6% inflation -> 1,60,356/mo.
const fme = F.futureMonthlyExpense(50000, 20, 0.06);
ok('futureMonthlyExpense matches the spec example (~₹1,60,356)', Math.round(fme) === 160357 || Math.abs(fme - 160356) < 2, `(₹${Math.round(fme).toLocaleString('en-IN')})`);
ok('futureMonthlyExpense: zero inflation => unchanged', close(F.futureMonthlyExpense(50000, 20, 0), 50000));

const corpus = F.ffnCorpus({ currentMonthlyExpense: 50000, yearsToGoal: 20 });
ok('ffnCorpus: required corpus is a large positive number', corpus.requiredCorpus > 0 && corpus.requiredCorpus > corpus.firstYearSpend, `(${L(corpus.requiredCorpus)})`);
ok('ffnCorpus: SWR cross-check = firstYearSpend / 3.5%', close(corpus.swrCrossCheck, corpus.firstYearSpend / 0.035, 1));

// projectCorpus: a pure lump at known rate.
const pj = F.projectCorpus({ currentCorpus: 1000000, monthlySip: 0, yearsToGoal: 10, annualReturn: 0.11 });
ok('projectCorpus: 10L lump @11% for 10y ~ 10L×1.11^10', close(pj.projectedCorpus, 1000000 * Math.pow(1.11, 10), 1));
ok('projectCorpus: a SIP adds to the lump', F.projectCorpus({ currentCorpus: 1000000, monthlySip: 10000, yearsToGoal: 10 }).projectedCorpus > pj.projectedCorpus);

// requiredSipTopUp closes a gap: top-up SIP's FV should equal the gap.
const gap = 5000000;
const topUp = F.requiredSipTopUp(gap, 15, 0.11);
const filled = F.projectCorpus({ currentCorpus: 0, monthlySip: topUp, yearsToGoal: 15, annualReturn: 0.11 }).projectedCorpus;
ok('requiredSipTopUp: the suggested SIP exactly fills the gap', close(filled, gap, 1), `(SIP ₹${Math.round(topUp).toLocaleString('en-IN')})`);
ok('requiredSipTopUp: no top-up when already ahead (gap<=0)', F.requiredSipTopUp(-1, 15) === 0);

const plan = F.ffnPlan({ currentCorpus: 2000000, monthlySip: 30000, currentMonthlyExpense: 50000, yearsToGoal: 20 });
ok('ffnPlan: onTrack iff projected >= required', plan.onTrack === (plan.projectedCorpus >= plan.requiredCorpus));
ok('ffnPlan: gap = required − projected', close(plan.gap, plan.requiredCorpus - plan.projectedCorpus, 1));
ok('ffnPlan: alignmentRatio = projected / required', close(plan.alignmentRatio, plan.projectedCorpus / plan.requiredCorpus, 1e-9));

/* ---------------- 2. Glide path ---------------- */
console.log('\n2. Autonomous Glide-Path');
ok('glide: 10+ years => 100% equity', F.glidePath(12).equity === 1.0 && F.glidePath(10).equity === 1.0);
ok('glide: 5 years => 85% equity', close(F.glidePath(5).equity, 0.85));
ok('glide: 3 years => 70% equity', close(F.glidePath(3).equity, 0.70));
ok('glide: 1 year => 50% equity', close(F.glidePath(1).equity, 0.50));
ok('glide: equity+debt always = 1', [12, 7, 4, 2, 0.5].every((y) => close(F.glidePath(y).equity + F.glidePath(y).debt, 1)));
ok('glide: monotonic — equity never rises as the goal nears', (() => {
  let prev = 0; for (let y = 0; y <= 12; y += 0.5) { const e = F.glidePath(y).equity; if (e < prev - 1e-9) return false; prev = e; } return true;
})());
ok('glide: interpolates between anchors (4y is between 70% and 85%)', (() => { const e = F.glidePath(4).equity; return e > 0.70 && e < 0.85; })());

const pf = O.samplePortfolio('2026-06-20');
const gp = F.glidePlan(pf, 3); // sample is ~87% equity; target at 3y is 70%
ok('glidePlan: flags too-much-equity drift and sizes an equity->debt STP', gp.direction === 'equity->debt' && gp.rupeesToShift > 0, `(shift ${L(gp.rupeesToShift)})`);
ok('glidePlan: rupeesToShift = |drift| × current value', close(gp.rupeesToShift, Math.abs(gp.drift) * gp.currentValue, 1));
ok('glidePlan: a 12-year horizon on an equity-heavy book is ~on-track (target 100%)', F.glidePlan(pf, 12).direction === 'debt->equity' || F.glidePlan(pf, 12).direction === 'on-track');

/* ---------------- 3. Valuation rebalancing ---------------- */
console.log('\n3. Valuation-Based Rebalancing');
const hi = F.valuationSignal(28, pf), lo = F.valuationSignal(15, pf), mid = F.valuationSignal(21, pf);
ok('valuation: PE 28 => overvalued, trim equity->debt', hi.zone === 'overvalued' && hi.action === 'equity->debt' && hi.moveRupees > 0, `(book ${L(hi.moveRupees)})`);
ok('valuation: PE 15 => undervalued, deploy debt->equity', lo.zone === 'undervalued' && lo.action === 'debt->equity');
ok('valuation: PE 21 => fair, hold, no move', mid.zone === 'fair' && mid.action === 'hold' && mid.moveRupees === 0);
ok('valuation: overvalued trim ~12.5% of equity value', (() => {
  const s = O.portfolioSummary(pf.holdings);
  const eq = ((s.allocation.Equity || 0) + 0.6 * (s.allocation.Hybrid || 0)) * s.current;
  return close(hi.moveRupees, eq * 0.125, 1);
})());

/* ---------------- 4. What-If stress tests ---------------- */
console.log('\n4. "What-If" Stress Tests');
const st = F.stressTest(pf, 'gfc2008');
ok('stress: GFC drawdown is negative and material', st.drawdownPct < -0.3, `(${(st.drawdownPct * 100).toFixed(1)}%)`);
ok('stress: trough value = current × (1 + drawdown)', close(st.troughValue, st.currentValue * (1 + st.drawdownPct), 1));
ok('stress: loss = current − trough', close(st.lossRupees, st.currentValue - st.troughValue, 1));
const stc = F.stressTest(pf, 'covid2020');
ok('stress: COVID shallower than GFC, faster recovery', stc.drawdownPct > st.drawdownPct && stc.recoveryMonths < st.recoveryMonths);
const sw = F.stressTest(pf, 'sideways');
ok('stress: sideways market => ~0% drawdown but flat years > 0', Math.abs(sw.drawdownPct) < 1e-9 && sw.flatYears === 3);
ok('stress: allocation-aware — a 100% equity book falls MORE than the sample', (() => {
  const allEq = { holdings: pf.holdings.filter((h) => h.assetClass === 'Equity') };
  return F.stressTest(allEq, 'gfc2008').drawdownPct < st.drawdownPct;
})());
ok('stress: every scenario runs via stressAll', F.stressAll(pf).length === Object.keys(F.SCENARIOS).length);

/* ---------------- 5. Aggregate prognose() ---------------- */
console.log('\n5. Aggregate prognose()');
const pr = F.prognose(pf, { yearsToGoal: 15, monthlySip: 30000, currentMonthlyExpense: 50000, niftyPE: 27 });
ok('prognose: returns ffn, glide, valuation, stress', !!(pr.ffn && pr.glide && pr.valuation && pr.stress));
ok('prognose: valuation PE 27 surfaces an overvalued signal', pr.valuation.zone === 'overvalued');
ok('prognose: ffn alignmentRatio is finite', isFinite(pr.ffn.alignmentRatio), `(${pr.ffn.alignmentRatio.toFixed(2)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
