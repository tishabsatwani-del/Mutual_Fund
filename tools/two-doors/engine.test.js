#!/usr/bin/env node
/* "Two Doors, One Storm" — engine tests for the fourth audit (September 2026):
 * the twenty golden vectors (Appendix A, regenerated under the asset-charge
 * fee and decision-time pricing, then frozen), the relationships each
 * developer area states as its test, and the edge cases of Stage 8.
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
const gap = (g) => E.setFeeGap(g);

console.log('\nThe twenty golden vectors (Appendix A, regenerated and frozen)');
test('20 / 20 recompute to the rupee', () => {
  gap(0.01);
  const r = E.runGolden();
  assert.strictEqual(r.length, 20);
  const bad = r.filter((x) => !x.pass);
  assert(!bad.length, bad.map((x) => x.name + ': got ' + x.got + ', expected ' + x.expected).join('; '));
});

console.log('\nArea 1 — the fee is a charge on assets, accrued daily');
test('φ = (1 − g/365)^(365/12); at g = 1.00 Regular compounds at 10.886% (φ = 0.999164 a month)', () => {
  gap(0.01); const r = E.rates();
  near(r.phi, 0.999167, 5e-6); near(r.regularAnnual, 0.10886, 5e-6);
  near(r.pointsOfReturn, 0.01114, 5e-6, '1.0 point costs 1.11 points of return');
});
test('g = 0 gives φ = 1 and identical paths; g = 1.5 gives an annual factor 0.98511 (Regular ≈ 10.34%)', () => {
  gap(0); const s0 = E.runSinglePath(10000, 'covid', 20);
  assert.strictEqual(E.rates().phi, 1); near(s0.feeSavingRupees, 0, 1e-6);
  for (let t = 0; t <= s0.N; t += 37) near(s0.navRegular[t], s0.navDirect[t], 1e-9);
  gap(0.015); near(Math.pow(E.rates().phi, 12), 0.98511, 5e-6); near(E.rates().regularAnnual, 0.1033, 5e-4);
  gap(0.01);
});
test('every Regular path is the Direct path × φ per month (storm friend, calm friend, sleeves)', () => {
  gap(0.01); const s = E.runSinglePath(20000, 'gfc', 25), phi = E.rates().phi;
  for (let t = 0; t <= s.N; t += 13) near(s.navRegular[t] / s.navDirect[t], Math.pow(phi, t), 1e-12, 'month ' + t);
  const cal = E.buildTrendNav(E.DIRECT_MONTHLY, 240, phi), cd = E.buildTrendNav(E.DIRECT_MONTHLY, 240, 1);
  near(cal[240] / cd[240], Math.pow(phi, 240), 1e-12);
  const liq = E.sleeveNav('liquid', 240, 120, null, E.LIQUID_PHI), liqD = E.sleeveNav('liquid', 240, 120, null, 1);
  near(liq[240] / liqD[240], Math.pow(E.LIQUID_PHI, 240), 1e-12, 'the liquid sleeve carries the 0.10 gap');
});
test('the fee saved grows with the gap across 0.5 / 0.75 / 1.0 / 1.25 / 1.5', () => {
  let last = -1;
  for (const g of [0.005, 0.0075, 0.01, 0.0125, 0.015]) { gap(g); const f = E.runSinglePath(10000, 'covid', 20).feeSavingRupees; assert(f > last); last = f; }
  gap(0.01);
});

console.log('\nArea 2 — the liquid sleeve carries 0.10 points whatever the equity gap');
test('LIQUID_GAP = 0.001; the emergency fee at gap 1.5 charges the liquid sleeve no more than at gap 0.5', () => {
  assert.strictEqual(E.LIQUID_GAP, 0.001);
  gap(0.015); const hi = E.runEmergency(10000, 'icu', 'surgical', 'calm', 20, 'minor');
  gap(0.005); const lo = E.runEmergency(10000, 'icu', 'surgical', 'calm', 20, 'minor');
  gap(0.01);
  const liqHi = hi.friend.sleeveValues.liquid, liqLo = lo.friend.sleeveValues.liquid;
  near(liqHi, liqLo, 1e-6, 'the liquid sleeve is the same at both equity gaps');
});

console.log('\nAreas 4–5 — one pause convention; the benchmark does not flinch');
test('paused instalments are parked and go in together: total invested = S × N on every crash-door path', () => {
  gap(0.01);
  for (const ev of ['covid', 'gfc', 'corr2022', 'oilwar2026']) {
    const s = E.runSinglePath(10000, ev, 20);
    for (const k of ['hold', 'pause', 'sellBack', 'sellWait']) assert.strictEqual(s.direct[k].invested - s.direct[k].reserve, 10000 * s.N, ev + ' ' + k);
    assert.strictEqual(s.pauseSpent.invested - s.pauseSpent.reserve, 10000 * s.N - s.pauseSpent.dropped);
    assert(s.pauseSpent.final < s.direct.pause.final, 'spending the parked money costs more than parking it');
  }
});
test('₹50k × 30y through 2008: the pause costs less parked than spent (48 instalments = ₹24 L parked)', () => {
  const s = E.runSinglePath(50000, 'gfc', 30);
  const parked = s.direct.hold.final - s.direct.pause.final, spent = s.direct.hold.final - s.pauseSpent.final;
  assert(parked < spent); near(s.direct.pause.pauseMonths, s.healed + E.PAUSE_LAG - s.S, 1e-9);
  assert.strictEqual(s.pauseSpent.dropped, 50000 * Math.round(s.direct.pause.pauseMonths));
});
test('the emergency door parks too: every response invests S × N (cancelled SIP included, as cash)', () => {
  for (const r of ['surgical', 'sellLosers', 'sipKill', 'panic']) {
    const e = E.runEmergency(10000, 'icu', r, 'calm', 20, 'major');
    assert.strictEqual(e.you.invested, 10000 * e.N, r);
    assert(e.youSpent.final <= e.you.final + 1e-6, r + ': spending the parked money is never better');
  }
});
test('steady hand pause = 0: a surgical reader in a calm market matches the steady hand exactly (E2: cost ₹0)', () => {
  const e = E.runEmergency(1000, 'icu', 'surgical', 'calm', 25, 'severe');
  near(e.directSmart.final - e.you.final, 0, 1e-6);
  assert.strictEqual(e.friend.response, 'surgical'); assert.strictEqual(e.directSmart.resumeMonth, e.S + 1);
});

console.log('\nArea 6 — decision-time pricing: the tape');
test('no tap reproduces the hold figures exactly', () => {
  const s = E.runSinglePath(25000, 'covid', 20, { decisions: [] });
  assert.strictEqual(s.you.final, s.direct.hold.final); assert(s.you.froze); assert.strictEqual(s.you.log.length, 0);
});
test('a sale is priced at the moment: the cost is monotonic in depth and the trough equals the matrix figure', () => {
  const s = E.runSinglePath(50000, 'gfc', 30), g = s.navDirect._geom;
  const at = (x) => g.S + g.F * Math.log(1 - x) / Math.log(1 - g.d);
  const cost = (t) => s.direct.hold.final - E.simDecisions(s.navDirect, s.N, 50000, [{ t, action: 'sell', fraction: 1 }]).final;
  const c10 = cost(at(0.10)), c25 = cost(at(0.25)), c40 = cost(at(0.40)), cT = cost(s.bottom);
  assert(c10 < c25 && c25 < c40 && c40 < cT, [c10, c25, c40, cT].join(' < '));
  near(cT, s.direct.hold.final - s.direct.sellBack.final, 1e-6, 'trough sale = sold at the bottom, bought back at the regain');
  assert(c10 < s.feeSavingRupees, 'selling at −10% costs less than the fee on this road');
  assert(cT > s.feeSavingRupees, 'selling at the trough costs more than the fee');
});
test('a tap on a month boundary happens before that month\'s instalment; the sale price is nav.at(t)', () => {
  const s = E.runSinglePath(10000, 'covid', 20);
  const you = E.simDecisions(s.navDirect, s.N, 10000, [{ t: s.S, action: 'sell', fraction: 1 }]);
  near(you.log[0].price, s.navDirect.at(s.S), 1e-12); near(you.log[0].unitsBefore, s.direct.hold.unitsAt[s.S - 1], 1e-9);
  const half = E.simDecisions(s.navDirect, s.N, 10000, [{ t: s.S + 0.5, action: 'sell', fraction: 0.5 }]);
  near(half.log[0].unitsAfter, half.log[0].unitsBefore / 2, 1e-9); assert(!half.neverBack);
});
test('"buy the dip" at the trough with the whole reserve beats hold by reserve × (regain ÷ trough) less the cash growth', () => {
  const s = E.runSinglePath(20000, 'gfc', 25), R = s.reserve, B = s.bottom;
  const you = E.simDecisions(s.navDirect, s.N, 20000, [{ t: B, action: 'buyDip', fraction: 1 }]);
  const grown = R * Math.pow(1 + E.SAVINGS_MONTHLY, B);
  const expect = grown * s.navDirect.at(s.N) / s.navDirect.at(B) - R * Math.pow(1 + E.SAVINGS_MONTHLY, s.N);
  near(you.final - s.direct.hold.final, expect, 1e-4);
  assert.strictEqual(you.invested, s.direct.hold.invested, 'the reserve is counted in every path');
});
test('a full sale never bought back re-enters at the regain; a pause never resumed restarts a year after it', () => {
  const s = E.runSinglePath(10000, 'gfc', 20);
  const sold = E.simDecisions(s.navDirect, s.N, 10000, [{ t: s.S + 2.5, action: 'sell', fraction: 1 }]);
  near(sold.reentry, s.healed, 1e-12); assert(!sold.neverBack);
  const paused = E.simDecisions(s.navDirect, s.N, 10000, [{ t: s.S + 1.25, action: 'pause' }]);
  near(paused.resumed, s.healed + E.PAUSE_LAG, 1e-12); near(paused.pauseMonths, s.healed + E.PAUSE_LAG - s.S - 1.25, 1e-12);
});
test('the live value at a fractional time reflects a sale inside the month', () => {
  const s = E.runSinglePath(10000, 'covid', 20), t = s.S + 0.4;
  const you = E.simDecisions(s.navDirect, s.N, 10000, [{ t, action: 'sell', fraction: 1 }], { logAuto: true });
  const before = E.valueAtTime(you, t - 1e-6), after = E.valueAtTime(you, t + 1e-6);
  near(after, before, before * 1e-5, 'a sale converts units to cash at the same price');
  const later = E.valueAtTime(you, t + 0.5);
  near(later, after * Math.pow(1 + E.SAVINGS_MONTHLY, 0.5), after * 1e-6, 'and then earns the bank rate');
});
test('the stamp: "sold at −22%, day N" is drawdown and day, never seconds', () => {
  const s = E.runSinglePath(10000, 'gfc', 20), g = s.navDirect._geom, t = g.S + g.F * Math.log(0.78) / Math.log(1 - g.d);
  const you = E.simDecisions(s.navDirect, s.N, 10000, [{ t, action: 'sell', fraction: 1 }]);
  near(you.log[0].drawdown, 0.22, 1e-9); assert.strictEqual(you.log[0].day, Math.round((t - g.S) * E.monthsBetween('2020-01-01', '2020-01-02') * 0 + (t - g.S) * (365.25 / 12)));
});

console.log('\nArea 7 — the regain is exact');
test('in every named storm × horizon the market is back at its peak at H = S + F + R, within 1e-9, and re-entry lands there', () => {
  for (const ev of ['covid', 'gfc', 'corr2022', 'oilwar2026']) for (const y of [10, 15, 20, 25, 30]) for (const g of [0.005, 0.01, 0.015]) {
    gap(g); const s = E.runSinglePath(10000, ev, y);
    const sh = E.stormShape(s.ev);
    near(s.healed, s.S + sh.fallMonths + sh.recoveryMonths, 1e-9, ev + ' ' + y);
    near(s.navDirect.at(s.healed) / s.navDirect.at(s.S), 1, 1e-9, ev + ' ' + y + ' regained');
    if (s.healed <= s.N) { assert.strictEqual(E.peakRegainMonth(s.navDirect), Math.ceil(s.healed - E.EPS)); near(s.direct.sellBack.reentry, s.healed, 1e-12); }
  }
  gap(0.01);
});

console.log('\nArea 8 — need rounding is adaptive and strictly increasing');
test('Manageable < Serious < Devastating for every SIP in {500…5,00,000} × horizon {10…30}; small SIPs never all ₹1 L', () => {
  for (const sip of [500, 1000, 3511, 5000, 10000, 50000, 500000]) for (let y = 10; y <= 30; y += 5) {
    const n = E.emergencyNeed(sip, y, 'minor').needs;
    assert(n.minor < n.major && n.major < n.severe, sip + ' × ' + y + ': ' + JSON.stringify(n));
  }
  const s500 = E.emergencyNeed(500, 10, 'minor');
  assert(s500.needs.minor <= s500.corpusBefore && s500.needs.major <= s500.corpusBefore, '₹500 × 10y: manageable and serious fit inside the corpus');
  assert(s500.needs.minor !== 100000 && s500.needs.major !== 100000, 'no ₹1.00 L floor for a ₹41k corpus');
  const p = E.emergencyNeed(25000, 20, 'minor'); near(p.pct, 0.30, 0.02, 'the printed percentage is of the rounded amount');
});

console.log('\nArea 9 — two numbers on one basis');
test('the fee on a calm road is path-independent and close to the fee on any storm road', () => {
  gap(0.01); const calm = E.feeCalm(50000, 360);
  for (const ev of ['covid', 'gfc', 'corr2022']) { const s = E.runSinglePath(50000, ev, 30); near(s.feeCalm, calm, 1e-6); assert(Math.abs(s.feeSavingRupees / calm - 1) < 0.35, ev); }
});

console.log('\nArea 10 — the ten thousand futures compound at 12% in the typical life');
test('median calm-path CAGR over 30 years = 12.0% ± 0.1% at the frozen base drift (seeds 4242 + 2i + 1)', () => {
  const med = E.medianPathCagr(E.BASE_DRIFT, 10000, 30, 4242).median;
  near(med, 0.12, 0.001, 'BASE_DRIFT ' + E.BASE_DRIFT);
  near(E.BASE_DRIFT, 0.153, 0.003, 'expected ≈ 15.3%');
});
test('the futures apply φ as the fee factor', () => { gap(0.0125); near(E.rates().feeFactor, E.phiFor(0.0125), 1e-15); gap(0.01); });

console.log('\nAreas 12–13 — the storms are dated; the drawn crash is bounded');
test('the four storms carry their dates; the 2026 oil war is unfinished with an assumed 8-month recovery', () => {
  const ev = E.EVENTS;
  assert.deepStrictEqual(Object.keys(ev), ['covid', 'gfc', 'corr2022', 'oilwar2026']);
  near(E.stormShape(ev.covid).fallMonths, 2.27, 0.05); near(E.stormShape(ev.gfc).recoveryMonths, 24.3, 0.2); near(E.stormShape(ev.corr2022).depth, 0.17, 1e-9);
  assert.strictEqual(ev.oilwar2026.recovery, 'assumed'); assert.strictEqual(ev.oilwar2026.regainDate, null); assert.strictEqual(E.stormShape(ev.oilwar2026).recoveryMonths, 8);
  assert(E.runSinglePath(10000, 'oilwar2026', 20).recoveryAssumed);
  assert(!/Kargil.*\d+%/.test(ev.oilwar2026.what), 'no Kargil percentage claim');
});
test('10,000 draws: depth ≥ 25%, fall ≥ 2 months, regain = S + F + R, timing after month 36', () => {
  const rng = E.mulberry32(99);
  for (let i = 0; i < 10000; i++) {
    const ev = E.drawCrash(rng);
    assert(ev.depth >= 0.25 && ev.depth <= 0.55 && ev.fallMonths >= 2 && ev.fallMonths <= 12 && ev.recoveryMonths >= 8 && ev.recoveryMonths <= 29);
  }
  const s = E.runSinglePath(10000, 'drawn', 20, { rng: E.mulberry32(7) });
  assert(s.drawn && s.S >= 36); near(s.healed, s.S + s.ev.fallMonths + s.ev.recoveryMonths, 1e-9);
});

console.log('\nArea 14 — the emergency backdrop is chosen, never a hidden default');
test('ICU in a calm market never falls; ICU in COVID lands on the trough with mid/small deeper than large-cap', () => {
  const calm = E.runEmergency(10000, 'icu', 'sellLosers', 'calm', 20, 'minor');
  assert(!calm.downturn && calm.backdrop === null); assert.strictEqual(calm.you.fallen.largeCap, 0);
  const cov = E.runEmergency(10000, 'icu', 'sellLosers', 'covid', 20, 'minor');
  assert(cov.downturn && cov.backdropId === 'covid'); assert(cov.you.fallen.midSmall > cov.you.fallen.largeCap);
  assert.strictEqual(cov.you.waterfall[0].sleeve, 'midSmall', '"sell the fallen fund" sells the sleeve that fell most');
  assert(cov.corpusAtStrike < cov.corpusBefore);
  const pan = E.runEmergency(10000, 'pandemic', 'surgical', 'calm', 20, 'minor'); assert.strictEqual(pan.backdropId, 'covid', 'pandemic brings its own storm');
  const war = E.runEmergency(10000, 'war', 'surgical', 'gfc', 20, 'minor'); assert.strictEqual(war.backdropId, 'oilwar2026', 'war brings the 2026 fall');
});

console.log('\nArea 19 — the copy branches are pure functions');
test('verdictKind, oathSentence, costLineKind, crashCostKind, ratioPhrase', () => {
  assert.strictEqual(E.verdictKind('froze', true), 'froze');
  assert.strictEqual(E.verdictKind('buyDip', true), 'held');
  assert.strictEqual(E.verdictKind('sellHalf', false), 'soldBehind');
  assert.strictEqual(E.verdictKind('pause', true), 'pausedAhead');
  assert.strictEqual(E.oathSentence('hold', 'froze').text, 'You swore to hold. You did nothing.');
  assert.strictEqual(E.oathSentence('sell', 'hold').kind, 'reversed');
  assert.strictEqual(E.oathSentence('hold', 'sold').kind, 'broke');
  assert.strictEqual(E.costLineKind(-5, 1e6, 1e4, 'buyDip'), 'none');
  assert.strictEqual(E.ratioPhrase(1.05, 1).kind, 'same'); assert.strictEqual(E.ratioPhrase(2, 1).text, '2× more'); assert.strictEqual(E.ratioPhrase(0.4, 1).text, '2.5× less');
  gap(0.01);
  const c10 = E.runSinglePath(10000, 'covid', 10), g30 = E.runSinglePath(50000, 'gfc', 30);
  assert.strictEqual(E.crashCostKind(c10.direct.hold.final - c10.directNoCrash, c10.directNoCrash), 'negative', 'the crash cost something at the midpoint');
  assert.strictEqual(E.crashCostKind(g30.direct.hold.final - g30.directNoCrash, g30.directNoCrash), 'negative');
  const early = E.runSinglePath(10000, 'covid', 30, { S: 6 });
  assert.strictEqual(E.crashCostKind(early.direct.hold.final - early.directNoCrash, early.directNoCrash), 'positive', 'a crash at the very start pays the holder');
});
test('sell-wait re-entry can equal the horizon: the engine says "never came back" rather than printing a re-entry', () => {
  const s = E.runSinglePath(10000, 'gfc', 10, { S: 100 });
  assert(!s.recoveredInTime); assert(s.direct.sellWait.reentry >= s.N); assert(s.direct.sellWait.neverBack);
  assert(finite(s.direct.sellWait.value));
});

console.log('\nStage 8 — edge cases');
test('linear scaling: every figure of ₹5,00,000 is 10.000 × ₹50,000', () => {
  const a = E.runSinglePath(50000, 'gfc', 30), b = E.runSinglePath(500000, 'gfc', 30);
  for (const k of ['hold', 'pause', 'sellBack', 'sellWait']) near(b.direct[k].final / a.direct[k].final, 10, 1e-9, k);
  near(b.feeSavingRupees / a.feeSavingRupees, 10, 1e-9); near(b.feeCalm / a.feeCalm, 10, 1e-9);
});
test('need > corpus (Devastating, in 2008): the shortfall ending runs and the steady hand takes everything', () => {
  const e = E.runEmergency(2000, 'icu', 'sipKill', 'gfc', 10, 'severe');
  assert(e.shortfall, 'need ' + e.need + ' vs corpus ' + e.corpusAtStrike); assert.strictEqual(e.steadyResponse, 'steadyShortfall');
  assert(e.directSmart.shortfall > 0 && e.you.shortfall > 0); assert(finite(e.you.value) && finite(e.friend.value));
});
test('"sell the fallen fund" smaller than the need: the waterfall continues and is recorded', () => {
  const e = E.runEmergency(10000, 'icu', 'sellLosers', 'covid', 20, 'major');
  assert(!e.shortfall); assert(e.you.waterfall.length >= 2); assert.strictEqual(e.you.waterfall[0].sleeve, 'midSmall'); near(e.you.took, e.need, 1e-6);
});
test('redeeming everything re-enters after a year; "never went back" is a separate, worse path', () => {
  const e = E.runEmergency(10000, 'business', 'panic', 'calm', 20, 'minor');
  assert(e.neverBack && e.neverBack.final < e.you.final); assert.strictEqual(e.you.resumeMonth, e.S + 13);
});
test('a crash starting late runs past the horizon without NaN; the cash is counted', () => {
  const s = E.runSinglePath(10000, 'gfc', 15, { S: 170 });
  assert(!s.recoveredInTime); for (const k of ['hold', 'pause', 'sellBack', 'sellWait']) assert(finite(s.direct[k].value) && finite(s.regular[k].value));
});
test('the same inputs give the same ten thousand lives (seeded); a changed SIP recomputes every rupee', () => {
  const a = E.runLifetimes(10000, 20, 4242, 400, 50), b = E.runLifetimes(10000, 20, 4242, 400, 50);
  assert.strictEqual(a.calm.p50, b.calm.p50); assert.strictEqual(a.doorGap, b.doorGap);
  near(a.pathCagrMedian, 0.12, 0.02);
  const n1 = E.emergencyNeed(10000, 20, 'major').need, n2 = E.emergencyNeed(20000, 20, 'major').need; assert(n2 > n1);
});
test('the drawn severity draws with weights 50 / 35 / 15', () => {
  const rng = E.mulberry32(3), c = { minor: 0, major: 0, severe: 0 };
  for (let i = 0; i < 20000; i++) c[E.drawSeverity(rng)]++;
  near(c.minor / 20000, 0.50, 0.02); near(c.major / 20000, 0.35, 0.02); near(c.severe / 20000, 0.15, 0.02);
});

console.log('\nAreas 18, 22, 25 — the build itself');
test('no emoji anywhere in the master; no real outlet or broker names in the feed; the Axis line is industry-wide', () => {
  const emoji = html.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu) || [];
  assert(!emoji.length, 'emoji found: ' + emoji.join(' '));
  assert(!/its own investors/.test(html));
  const feed = html.slice(html.indexOf('const FEED = {'), html.indexOf('const FEED_LOGO'));
  assert(!/CNBC|NDTV|Zee|ET Now|Moneycontrol|Zerodha|Groww|Bloomberg|Reuters|Times of India|Economic Times|Mint|Upstox|Paytm/i.test(feed), 'a real outlet name in the feed');
  assert(/SIMULATION|Simulation/.test(html), 'the word SIMULATION must be visible in the feed header');
  assert(/points a year on assets, accrued daily/.test(html));
  assert(/Switching from Regular to Direct is itself a sale/.test(html));
  assert(/Cafemutual/.test(html) && /2003–2022/.test(html));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
