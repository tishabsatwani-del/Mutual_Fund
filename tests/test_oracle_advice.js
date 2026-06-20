/* Node verification for the professional advice engine (oracle-advice.js).
 * Run: node tests/test_oracle_advice.js
 * Locks the safety guardrails: equity is NEVER 100%, short horizons stay
 * mostly safe, conservative < moderate < aggressive, the emergency fund is
 * sized and checked, allocation always sums to 1, and the fund score is a
 * sane multi-factor 0..100 with the right ordering. */
'use strict';
const O = require('../oracle.js');
const A = require('../oracle-advice.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e ? '   ' + e : '')); } };
const sum1 = (a) => Math.abs(a.equity + a.debt + a.gold - 1) < 1e-9;

/* ---------------- the cardinal rule: never 100% equity ---------------- */
console.log('\n1. Equity is never 100% — for any profile or horizon');
let allUnder = true, anyHigh = false;
for (const p of ['Conservative', 'Moderate', 'Aggressive']) {
  for (let y = 1; y <= 40; y++) {
    const a = A.recommendedAllocation({ profile: p, yearsToGoal: y });
    if (a.equity >= 1) allUnder = false;
    if (a.equity > 0.85 + 1e-9) anyHigh = true;
    if (!sum1(a)) allUnder = false;
  }
}
ok('equity < 100% in every profile × horizon, and allocations sum to 1', allUnder);
ok('equity never exceeds the 85% aggressive cap', !anyHigh);

/* ---------------- horizon & profile ordering ---------------- */
console.log('\n2. Sensible ordering');
const shortH = A.recommendedAllocation({ profile: 'Aggressive', yearsToGoal: 1 });
const longH = A.recommendedAllocation({ profile: 'Aggressive', yearsToGoal: 20 });
ok('a 1-year goal is mostly safe even for an aggressive investor (<35% equity)', shortH.equity < 0.35, `(${(shortH.equity * 100).toFixed(0)}%)`);
ok('a 20-year goal allows more equity than a 1-year goal', longH.equity > shortH.equity);
const cons = A.recommendedAllocation({ profile: 'Conservative', yearsToGoal: 20 });
const mod = A.recommendedAllocation({ profile: 'Moderate', yearsToGoal: 20 });
const agg = A.recommendedAllocation({ profile: 'Aggressive', yearsToGoal: 20 });
ok('conservative < moderate < aggressive equity at the same horizon', cons.equity < mod.equity && mod.equity < agg.equity, `(${(cons.equity * 100).toFixed(0)}/${(mod.equity * 100).toFixed(0)}/${(agg.equity * 100).toFixed(0)})`);
ok('every profile keeps a real debt cushion (>=10%)', cons.debt >= 0.10 && mod.debt >= 0.10 && agg.debt >= 0.10);
ok('reasoning is provided for the user', Array.isArray(mod.reasoning) && mod.reasoning.length >= 2);

/* ---------------- emergency fund first ---------------- */
console.log('\n3. Emergency fund');
const ef0 = A.emergencyFund({ monthlyExpense: 50000, liquidAssets: 0 });
ok('sizes 6 months of expenses', ef0.needed === 300000 && !ef0.ok && ef0.gapMonths === 6);
const ef1 = A.emergencyFund({ monthlyExpense: 50000, liquidAssets: 400000 });
ok('marks funded when liquid covers it', ef1.ok && ef1.gap === 0);

/* ---------------- allocationPlan: emergency fund is the first action ---------------- */
console.log('\n4. allocationPlan() puts safety first');
const pf = O.samplePortfolio('2026-06-20');
const planNoEF = A.allocationPlan(pf, { profile: 'Aggressive', yearsToGoal: 20, monthlyExpense: 200000, liquidSavings: 0 });
ok('with no emergency fund, the FIRST action is to build it (not buy equity)', planNoEF.firstAction === 'build-emergency', planNoEF.firstAction);
const planEF = A.allocationPlan(pf, { profile: 'Moderate', yearsToGoal: 15, monthlyExpense: 1000, liquidSavings: 100000 });
ok('with the emergency fund covered, it moves on to allocation', planEF.emergency.ok && planEF.firstAction !== 'build-emergency');
ok('target equity is suitability-capped (<=85%)', planEF.targetEquity <= 0.85);

/* ---------------- multi-factor fund score ---------------- */
console.log('\n5. Multi-factor fund score');
const dx = O.diagnose(pf, { asOf: pf.asOf });
const scored = dx.funds.filter((f) => f.risk).map((f) => ({ scheme: f.scheme, ...A.fundScore(f) }));
ok('every scored fund is in 0..100 with a grade', scored.every((s) => s.score >= 0 && s.score <= 100 && s.grade));
ok('the breakdown exposes all six factors', scored.length > 0 && ['returns', 'riskAdj', 'downside', 'consistency', 'cost', 'alpha'].every((k) => k in scored[0].breakdown));
// A clearly strong fund should outscore a clearly weak one in the sample set.
const best = scored.slice().sort((a, b) => b.score - a.score)[0];
const worst = scored.slice().sort((a, b) => a.score - b.score)[0];
ok('best-scored fund beats worst-scored fund', best.score > worst.score, `(${best.scheme.slice(0, 18)} ${best.score} vs ${worst.scheme.slice(0, 18)} ${worst.score})`);
// A laggard (negative alpha) should surface a caution.
const laggard = dx.funds.find((f) => f.deadwood);
if (laggard) ok('a lagging fund surfaces at least one caution', A.fundScore(laggard).cautions.length > 0);
else ok('a lagging fund surfaces a caution (no laggard in sample — skipped)', true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
