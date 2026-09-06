#!/usr/bin/env node
/* "Two Doors, One Storm" — engine tests: the September 2026 audit's acceptance
 * test (Stage 10 §E / §G) and its edge cases E1–E13 (Stage 8).
 *
 * The published index.html is an encrypted build; the engine is read from the
 * READABLE MASTER, which lives outside the repository on purpose. Point at it:
 *
 *   TDOS_MASTER=/path/to/master.html node tools/two-doors/engine.test.js
 *
 * (or drop the master beside this file as `master.html`). No dependencies. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MASTER = process.env.TDOS_MASTER || path.join(__dirname, 'master.html');
if (!fs.existsSync(MASTER)) {
  console.error('Readable master not found at ' + MASTER + '\nSet TDOS_MASTER=/path/to/master.html (the decrypted source), not index.html.');
  process.exit(2);
}
const html = fs.readFileSync(MASTER, 'utf8');
const m = html.match(/<script>\n([\s\S]*?)<\/script>\s*<\/body>/);
assert(m, 'could not find the engine <script> in the master');
const tmp = path.join(require('os').tmpdir(), 'tdos-engine-' + process.pid + '.js');
fs.writeFileSync(tmp, m[1]);
const E = require(tmp);
fs.unlinkSync(tmp);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
const finite = (arr) => arr.every((v) => Number.isFinite(v));

console.log('\nReviewer\'s acceptance test (Stage 10 §E / §G)');
test('run C reproduces ₹3,04,53,950 / ₹2,63,05,172 / 11.3% / 10.4% / CAGR 11.4% / fee ₹41,48,778', () => {
  E.setFeeGap(0.01);
  const s = E.runSinglePath(20000, 'corr2022', 25);
  assert.strictEqual(Math.round(s.direct.hold.final), 30453950);
  assert.strictEqual(Math.round(s.regular.hold.final), 26305172);
  assert.strictEqual((s.direct.hold.xirr * 100).toFixed(1), '11.3');
  assert.strictEqual((s.regular.hold.xirr * 100).toFixed(1), '10.4');
  assert.strictEqual((s.indexCagr * 100).toFixed(1), '11.4');
  assert.strictEqual(Math.round(s.feeSavingRupees), 4148778);
  near(s.directNoCrash - s.direct.hold.final, 3590000, 2000, 'crash itself cost ≈ ₹35.90 L');
});
test('run D held figures show as ₹11.96 Cr / ₹10.12 Cr; split is exactly the midpoint', () => {
  const d = E.runSinglePath(50000, 'gfc', 30);
  assert.strictEqual((d.direct.hold.final / 1e7).toFixed(2), '11.96');
  assert.strictEqual((d.regular.hold.final / 1e7).toFixed(2), '10.12');
  near((d.direct.hold.final + d.regular.hold.final) / 2 / 1e7, 11.04, 0.005);
});
test('internal identities hold on every path: you = friend + fee saved − decision cost', () => {
  for (const ev of ['covid', 'gfc', 'corr2022', 'war']) for (const y of [10, 15, 20, 25, 30]) {
    const s = E.runSinglePath(10000, ev, y);
    for (const k of ['hold', 'pause', 'sellBack', 'sellWait']) {
      const you = s.direct[k].final, cost = s.direct.hold.final - you;
      near(you, s.regular.hold.final + s.feeSavingRupees - cost, 1e-3, ev + ' ' + y + 'y ' + k);
    }
  }
});
test('the fee gap is exactly the chosen gap in CAGR terms on the trend path, and the fee saved moves with it (F-44)', () => {
  let lastFee = Infinity;
  for (const g of [0.0125, 0.01, 0.0075, 0.005]) {
    E.setFeeGap(g);
    const r = E.rates();
    near(r.regularAnnual, 0.12 - g, 1e-12);
    near(Math.pow((1 + r.directMonthly) * r.feeFactor, 12) - 1, 0.12 - g, 1e-12, 'fee factor');
    const N = 240, d = E.buildTrendNav(r.directMonthly, N), q = E.buildTrendNav(r.regularMonthly, N);
    near(E.cagr(q[0], q[N], 20), E.cagr(d[0], d[N], 20) - g, 1e-9, 'trend gap ' + g);
    const s = E.runSinglePath(10000, 'covid', 20);
    assert(s.feeSavingRupees < lastFee, 'a smaller gap saves less'); lastFee = s.feeSavingRupees;
    assert.strictEqual(s.feeGap, g);
  }
  E.setFeeGap(0.01);
});

console.log('\nThe behaviour rules, as printed (Stage 3 §3.3, F-07, F-11)');
test('a sale happens at the bottom; "bought back" re-enters the month the market regains its old level', () => {
  const s = E.runSinglePath(10000, 'gfc', 20);
  assert.strictEqual(s.direct.sellBack.soldAt, s.navDirect._bottom);
  assert.strictEqual(s.direct.sellBack.reentry, E.peakRegainMonth(s.navDirect));
  assert(s.navDirect[s.direct.sellBack.reentry] >= s.navDirect[s.S] - 1e-9, 'regained the prior level');
});
test('"sold and waited" re-enters WAIT_LAG months after the market healed; a pause restarts PAUSE_LAG months after', () => {
  const s = E.runSinglePath(10000, 'gfc', 20);
  assert.strictEqual(s.direct.sellWait.reentry, s.navDirect._healed + E.WAIT_LAG);
  assert.strictEqual(s.direct.pause.reentry, s.navDirect._healed + E.PAUSE_LAG);
  assert.strictEqual(s.direct.pause.pauseMonths, s.direct.pause.reentry - s.S);
});
test('idle cash earns SAVINGS_ANNUAL in the crash door (one rate everywhere)', () => {
  const N = 240, ev = E.EVENTS.gfc, nav = E.buildEventNav(E.DIRECT_MONTHLY, N, ev, 120);
  const never = E.simSell(nav, N, 10000, N + 999);          // sold at the bottom, never came back
  const bottom = nav._bottom;
  // cash at the bottom = units × NAV + that month's SIP; then SIPs pile in and everything grows at the bank rate
  let cash = 0; for (let mm = 0; mm < N; mm++) { if (mm > 0) cash *= 1 + E.SAVINGS_MONTHLY; if (mm === bottom) cash += never.value[bottom - 1] / nav[bottom - 1] * nav[bottom]; if (mm >= bottom) cash += 10000; }
  cash *= 1 + E.SAVINGS_MONTHLY;
  near(never.final, cash, 1, 'cash grown at the bank rate');
  assert(never.final > 10000 * (N - bottom), 'more than the instalments alone: interest was paid');
});
test('the ten thousand futures use the same idle-cash rate', () => {
  const N = 120, rng = E.genMarketReturns; void rng;
  const returns = new Array(N).fill(-0.05);                  // a market that only falls: the panic path sells and sits in cash
  const nav = E.navFromReturns(returns, N, 1);
  const p = E.simPolicyPath(nav, N, 1000, E.MC_POLICIES.panic, true);
  const h = E.simPolicyPath(nav, N, 1000, E.MC_POLICIES.hold, true);
  assert(p.final > h.final, 'cash beat a market that only fell');
  assert(p.final > 1000 * N * 0.9, 'the cash was counted');
});

console.log('\nEdge cases (Stage 8)');
test('E1 — a crash starting late (month 170 of 180) runs past the horizon: no NaN, cash counted, flagged', () => {
  const ev = Object.assign({}, E.EVENTS.gfc, { id: 'drawn', hypothetical: true, anchor: 'ranges the real crashes sit in' });
  const s = E.runSinglePath(5000, 'drawn', 15, { ev, S: 170 });
  assert.strictEqual(s.S, 170);
  assert.strictEqual(s.recoveredInTime, false);
  for (const k of ['hold', 'pause', 'sellBack', 'sellWait']) {
    assert(finite(s.direct[k].value) && Number.isFinite(s.direct[k].final) && Number.isFinite(s.direct[k].xirr), k + ' finite');
    assert(s.direct[k].final > 0, k + ' positive');
  }
  assert(s.direct.sellWait.reentry > s.N, 'the re-entry never came');
  assert(s.direct.sellWait.final >= 5000 * (s.N - s.navDirect._bottom), 'the cash was still counted');
});
test('E2 — a crash in the first year: the fee gap dominates the crash cost, and a small cost never gets "frightened seconds"', () => {
  const s = E.runSinglePath(5000, 'covid', 20, { S: 6 });
  const cost = s.direct.hold.final - s.direct.sellBack.final, pause = s.direct.hold.final - s.direct.pause.final;
  assert(Number.isFinite(cost) && cost >= 0, 'finite, non-negative');
  assert(cost < s.feeSavingRupees, 'fee gap ' + Math.round(s.feeSavingRupees) + ' dominates the sale cost ' + Math.round(cost));
  assert(pause < s.feeSavingRupees * 0.5, 'the pause cost is well inside the fee gap: ' + Math.round(pause) + ' vs ' + Math.round(s.feeSavingRupees));
  assert.strictEqual(E.costLineKind(2000, s.direct.sellBack.invested, 5000, 'sellBack'), 'tiny');
  assert.strictEqual(E.costLineKind(Math.max(0, pause), s.direct.pause.invested, 5000, 'pause'), pause < 15000 ? (pause > 0 ? 'tiny' : 'none') : 'years');
});
test('E3 — oath "sell", act "hold" is the honourable reversal, with no penalty framing', () => {
  const o = E.oathSentence('sell', 'hold');
  assert.strictEqual(o.text, 'You swore to sell. You held.');
  assert.strictEqual(o.kind, 'reversed');
  assert.deepStrictEqual(E.oathSentence('hold', 'sellBack'), { text: 'You swore to hold. You sold.', kind: 'broke' });
  assert.deepStrictEqual(E.oathSentence('hold', 'pause'), { text: 'You swore to hold. You paused.', kind: 'broke' });
  assert.deepStrictEqual(E.oathSentence('hold', 'hold'), { text: 'You swore to hold. You held.', kind: 'kept' });
  assert.deepStrictEqual(E.oathSentence('pause', 'pause'), { text: 'You swore to pause. You paused.', kind: 'kept' });
});
test('E4 — oath "hold", act "sell everything", 30 years, ₹50,000: the cost exceeds every rupee put in', () => {
  const s = E.runSinglePath(50000, 'gfc', 30);
  const cost = s.direct.hold.final - s.direct.sellWait.final;
  assert(cost > s.direct.sellWait.invested, 'cost ' + cost + ' > invested ' + s.direct.sellWait.invested);
  assert.strictEqual(E.costLineKind(cost, s.direct.sellWait.invested, 50000, 'sellWait'), 'total');
});
test('E5 — need > corpus (Devastating, mid-fall): the shortfall ending runs, not the precise branch', () => {
  const em = E.runEmergency(5000, 'business', 'surgical', true, 20, 'severe');
  assert(em.need > em.corpusAtStrike, 'need ' + em.need + ' > corpus at strike ' + Math.round(em.corpusAtStrike));
  assert.strictEqual(em.shortfall, true);
  assert.strictEqual(em.steadyResponse, 'steadyShortfall');
  assert.strictEqual(em.directSmart.resumeMonth, em.S + 1, 'the SIP starts again next month');
  assert(em.directSmart.shortfall > 0 && em.you.shortfall > 0);
  const ok = E.runEmergency(5000, 'business', 'surgical', false, 20, 'minor');
  assert.strictEqual(ok.shortfall, false);
  assert.strictEqual(ok.steadyResponse, 'surgical');
});
test('E6 — "sell the fallen fund" when it is smaller than the need: the waterfall continues and is recorded', () => {
  const em = E.runEmergency(10000, 'business', 'sellLosers', false, 20, 'major');
  const w = em.you.waterfall;
  assert(w.length >= 2, 'more than one fund was sold');
  assert.strictEqual(w[0].sleeve, 'midSmall');
  assert.strictEqual(w[1].sleeve, 'largeCap');
  near(w.reduce((s, x) => s + x.amount, 0), em.need, 1, 'the waterfall adds up to the need');
  near(w[0].amount, em.you.sleeveValues.midSmall, 1, 'the fallen fund was exhausted first');
});
test('E7 — hardest mode off vs on: the fall lands only when the flag (or a crash-linked event) says so', () => {
  const off = E.runEmergency(10000, 'business', 'surgical', false, 20, 'major');
  const on = E.runEmergency(10000, 'business', 'surgical', true, 20, 'major');
  const war = E.runEmergency(10000, 'war', 'surgical', false, 20, 'major');
  assert.strictEqual(off.downturn, false); assert.strictEqual(on.downturn, true); assert.strictEqual(war.downturn, true);
  near(off.corpusAtStrike, off.corpusBefore, 1);
  assert(on.corpusAtStrike < on.corpusBefore * 0.9, 'the corpus fell in hardest mode');
});
test('E10 — the same inputs give the same ten thousand lives (seeded)', () => {
  const a = E.runLifetimes(10000, 20, 4242, 2000, 400), b = E.runLifetimes(10000, 20, 4242, 2000, 400);
  assert.strictEqual(a.calm.p50, b.calm.p50); assert.strictEqual(a.panic.p50, b.panic.p50);
  assert.strictEqual(a.doorGap, b.doorGap); assert.strictEqual(a.crowdGap, b.crowdGap);
});
test('E11 — the war storm names its anchor; the drawn crash prints ranges, never a scenario name', () => {
  assert(E.EVENTS.war.hypothetical && /Kargil/.test(E.EVENTS.war.anchor));
  const rng = E.mulberry32 ? null : null; void rng;
  const seq = [0.5, 0.5, 0.5]; let i = 0;
  const d = E.drawCrash(() => seq[i++ % seq.length]);
  assert(d.hypothetical && d.anchor === 'ranges the real crashes sit in');
  assert(d.depth >= E.DRAWN_RANGES.depthMin && d.depth <= E.DRAWN_RANGES.depthMax);
  assert(d.fallMonths >= E.DRAWN_RANGES.fallMin && d.fallMonths <= E.DRAWN_RANGES.fallMax);
  assert(d.recoveryMonths >= E.DRAWN_RANGES.recMin && d.recoveryMonths <= E.DRAWN_RANGES.recMax);
});
test('E12 — changing the SIP recomputes every rupee figure (need, corpus, fee gap)', () => {
  const a = E.emergencyNeed(5000, 20, 'major'), b = E.emergencyNeed(50000, 20, 'major');
  assert(b.need > a.need * 5, 'the need scales with the SIP');
  const s1 = E.runSinglePath(5000, 'covid', 20), s2 = E.runSinglePath(50000, 'covid', 20);
  near(s2.feeSavingRupees, s1.feeSavingRupees * 10, 1, 'linear in the SIP');
});

console.log('\nCopy decisions (F-06, F-09, F-29)');
test('F-06 — the finish-line branch keys on the action and on whether you finished ahead', () => {
  assert.strictEqual(E.verdictKind('hold', true, 0.6), 'held');
  assert.strictEqual(E.verdictKind('sellWait', false, 0.6), 'soldBehind');
  assert.strictEqual(E.verdictKind('sellBack', true, 0.18), 'soldAhead');
  assert.strictEqual(E.verdictKind('pause', true, 0.5), 'pausedAhead');
  assert.strictEqual(E.verdictKind('pause', false, 0.5), 'pausedBehind');
  assert.strictEqual(E.SHALLOW_DEPTH, 0.25);
});
test('F-09 — ₹1.58 Cr thirty years out is about ₹27.5 L today, about 7.6 years of ₹30,000 a month', () => {
  near(E.todaysMoney(1.58e7, 30), 2750940, 2000);
  near(E.yearsOfSpending(1.58e7, 30, 30000), 7.6, 0.1);
  assert.strictEqual(E.INFLATION_ANNUAL, 0.06);
});
test('F-29 — the cost line is capped at both ends', () => {
  assert.strictEqual(E.costLineKind(2000, 900000, 5000, 'sellBack'), 'tiny');
  assert.strictEqual(E.costLineKind(73739, 900000, 5000, 'pause'), 'years');
  assert.strictEqual(E.costLineKind(1e7, 900000, 5000, 'sellWait'), 'total');
  assert.strictEqual(E.costLineKind(0, 900000, 5000, 'hold'), 'none');
});
test('F-20 — redeeming everything re-enters after a year; "never went back" is a separate, worse path', () => {
  const em = E.runEmergency(10000, 'business', 'panic', false, 20, 'major');
  assert.strictEqual(em.you.resumeMonth, em.S + 1 + 12);
  assert(em.neverBack && em.neverBack.final < em.you.final, 'never going back is worse');
  assert.strictEqual(em.neverBack.resumeMonth, Infinity);
  near(em.you.took, em.need, 1, 'only the need left the investor');
});
test('F-08 — the size screen figure equals the engine\'s need, and the mapping is 30 / 55 / 80% of the pre-fall corpus', () => {
  for (const [id, f] of [['minor', 0.30], ['major', 0.55], ['severe', 0.80]]) {
    const n = E.emergencyNeed(10000, 20, id), em = E.runEmergency(10000, 'icu', 'surgical', false, 20, id);
    assert.strictEqual(n.need, em.need);
    assert.strictEqual(n.fraction, f);
    near(n.need, Math.max(1e5, Math.round(f * n.corpusBefore / 1e5) * 1e5), 0);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
