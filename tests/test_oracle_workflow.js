/* Node verification for the Autonomous Portfolio Oracle — Part 3 engine
 * (oracle-workflow.js). Run: node tests/test_oracle_workflow.js
 * Locks the Health Score pillars/bounds and the Action Board generation. */
'use strict';
const O = require('../oracle.js');
const F = require('../oracle-future.js');
const W = require('../oracle-workflow.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}

const pf = O.samplePortfolio('2026-06-20');
const inputs = { yearsToGoal: 3, monthlySip: 30000, currentMonthlyExpense: 50000, niftyPE: 27 };
const A = W.analyze(pf, inputs);

/* ---------------- Health score ---------------- */
console.log('\n1. Unified Health Score');
ok('score: overall in [0,10]', A.score.overall >= 0 && A.score.overall <= 10, `(${A.score.overall})`);
ok('score: all four pillars present and in [0,10]', ['performance', 'cost', 'diversification', 'alignment'].every((k) => A.score.pillars[k] >= 0 && A.score.pillars[k] <= 10));
ok('score: pillar weights sum to 1', Math.abs(Object.values(A.score.weights).reduce((s, x) => s + x, 0) - 1) < 1e-9);
ok('score: overall = weighted sum of pillars', (() => {
  const p = A.score.pillars, w = A.score.weights;
  const calc = p.performance * w.performance + p.cost * w.cost + p.diversification * w.diversification + p.alignment * w.alignment;
  return Math.abs(calc - A.score.overall) < 0.06; // rounding to 1dp
})());
ok('score: grade matches the band', (() => {
  const o = A.score.overall, g = A.score.grade;
  if (o >= 8) return g === 'Excellent'; if (o >= 6) return g === 'Healthy'; if (o >= 4) return g === 'Needs work'; return g === 'At risk';
})(), `(${A.score.overall} -> ${A.score.grade})`);
// The sample has deadwood + a flagged overlap + ~45% Regular -> not a perfect 10.
ok('score: imperfect sample scores below 8', A.score.overall < 8, `(${A.score.overall})`);
ok('score: cost pillar penalised by the Regular share', A.score.pillars.cost < 10);
ok('score: diversification penalised by the flagged overlap', A.score.pillars.diversification < 10);

// A clean, all-Direct, no-overlap, on-track book should score high.
const clean = {
  name: 'Clean', asOf: '2026-06-20', benchmark: pf.benchmark,
  holdings: [{
    scheme: 'Index Fund', amc: 'AMC', category: 'Index Equity', assetClass: 'Equity', plan: 'Direct',
    ter: 0.002, units: 1000, nav: 200, avgCost: 100, invested: 100000, purchaseDate: '2020-01-01',
    navHistory: O.buildCorrelatedNav(3, pf.benchmark.navHistory, 1.0, 0.005, 0.02, 100),
    transactions: [{ date: '2020-01-01', amount: 100000 }], underlying: null,
  }],
};
const Aclean = W.analyze(clean, { yearsToGoal: 12, monthlySip: 100000, currentMonthlyExpense: 20000 });
ok('score: a clean, on-track, all-Direct book scores higher than the messy sample', Aclean.score.overall > A.score.overall, `(${Aclean.score.overall} > ${A.score.overall})`);
ok('score: clean book has a full cost pillar (no Regular plans)', Aclean.score.pillars.cost === 10);

/* ---------------- Action board ---------------- */
console.log('\n2. Live Action Board');
ok('actions: at least one item generated for the messy sample', A.actions.length > 0, `(${A.actions.length} items)`);
ok('actions: every item has issue, advice, button, severity', A.actions.every((a) => a.issue && a.advice && a.button && a.severity));
ok('actions: a deadwood switch is surfaced', A.actions.some((a) => /Underperforming/.test(a.issue) && /Direct|Replace/.test(a.button)));
ok('actions: an overlap consolidation is surfaced', A.actions.some((a) => /overlap/i.test(a.issue)));
ok('actions: a cost/Direct switch is surfaced', A.actions.some((a) => /Switch to Direct/.test(a.button)));
ok('actions: at 3y to goal an equity->debt rebalance is surfaced', A.actions.some((a) => /Rebalance/.test(a.button)));
ok('actions: PE 27 surfaces a Book profit action', A.actions.some((a) => /Book profit/.test(a.button)));
ok('actions: an LTCG harvesting opportunity is surfaced', A.actions.some((a) => /Harvest/.test(a.button)));
ok('actions: sorted by severity (critical first)', (() => {
  const order = { critical: 0, warn: 1, opportunity: 2, good: 3 };
  for (let i = 1; i < A.actions.length; i++) if (order[A.actions[i].severity] < order[A.actions[i - 1].severity]) return false; return true;
})());

// FFN shortfall: a tiny SIP far from a big goal must trigger an "Increase SIP".
const Aoff = W.analyze(pf, { yearsToGoal: 10, monthlySip: 1000, currentMonthlyExpense: 80000 });
ok('actions: an off-track plan surfaces "Increase SIP"', Aoff.actions.some((a) => /Increase SIP/.test(a.button)));

// A genuinely healthy book yields the "Stay the course" good-state.
ok('actions: a clean on-track book can reach the good state', (() => {
  return Aclean.actions.length === 0 || Aclean.actions.every((a) => a.severity !== 'critical') || Aclean.actions.some((a) => a.severity === 'good');
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
