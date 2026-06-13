/* Node verification for the "Two Doors, One Storm" math engine in app.js.
 * Run: node tests/test_simulator.js
 * Asserts the deterministic invariants the experience depends on, and that
 * the Monte Carlo engine is honest — Direct can finish above, equal to, OR
 * below Regular. We never rig it so Regular always wins. */
'use strict';
const E = require('../app.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}
const L = (v) => '₹' + (v / 1e5).toFixed(2) + ' L';
const Cr = (v) => '₹' + (v / 1e7).toFixed(3) + ' Cr';

/* ---------------- Single-path (Live it) engine ---------------- */
for (const evId of Object.keys(E.EVENTS)) {
  const sim = E.runSinglePath(10000, evId);
  const d = sim.direct, r = sim.regular;
  console.log(`\n${sim.ev.name} · ₹10,000/mo · 20 yrs:`);
  console.log(`    direct  hold ${Cr(d.hold.final)}  pause ${Cr(d.pause.final)}  sellBack ${Cr(d.sellBack.final)}  sellWait ${Cr(d.sellWait.final)}`);
  console.log(`    regular hold ${Cr(r.hold.final)}`);

  const inv = 10000 * sim.N;
  ok(`[${evId}] every behaviour invests SIP×N = ${Cr(inv)}`,
    ['hold', 'pause', 'sellBack', 'sellWait'].every((k) =>
      Math.abs(d[k].invested - inv) < 1e-6 && Math.abs(r[k].invested - inv) < 1e-6));

  // Ordering within a door: hold > pause > sellBack > sellWait.
  ok(`[${evId}] direct: hold > pause > sellBack > sellWait`,
    d.hold.final > d.pause.final && d.pause.final > d.sellBack.final && d.sellBack.final > d.sellWait.final,
    `(${L(d.hold.final)} ${L(d.pause.final)} ${L(d.sellBack.final)} ${L(d.sellWait.final)})`);

  // The fee gap is small and positive: Direct-hold edges Regular-hold.
  ok(`[${evId}] fee saving (direct-hold − regular-hold) is positive`,
    sim.feeSavingRupees > 0, `(${L(sim.feeSavingRupees)})`);

  // The behaviour gap is enormous vs the fee gap: panicking Direct finishes
  // BELOW calm Regular — the whole point.
  ok(`[${evId}] panic (sellWait Direct) finishes BELOW calm Regular`,
    d.sellWait.final < r.hold.final, `(${L(d.sellWait.final)} < ${L(r.hold.final)})`);
  ok(`[${evId}] behaviour cost (sellWait) dwarfs the fee saving`,
    (d.hold.final - d.sellWait.final) > 2 * sim.feeSavingRupees,
    `(cost ${L(d.hold.final - d.sellWait.final)} vs fee ${L(sim.feeSavingRupees)})`);

  // Staying invested ends SLIGHTLY RICHER than a crash-free market (cheap units).
  ok(`[${evId}] direct-hold > crash-free trend (not clamped)`,
    d.hold.final > sim.directNoCrash, `(crash ${Cr(d.hold.final)} vs none ${Cr(sim.directNoCrash)})`);

  // XIRR is sane and ordered like the corpus.
  ok(`[${evId}] XIRR: hold > sellWait, both finite`,
    isFinite(d.hold.xirr) && isFinite(d.sellWait.xirr) && d.hold.xirr > d.sellWait.xirr,
    `(hold ${(d.hold.xirr * 100).toFixed(2)}% > wait ${(d.sellWait.xirr * 100).toFixed(2)}%)`);
}

/* ---------------- NAV crash shape (COVID, Direct) ---------------- */
{
  const ev = E.EVENTS.gfc, N = E.HORIZON_MONTHS, S = N / 2;
  const nav = E.buildEventNav(E.DIRECT_MONTHLY, N, ev, S);
  ok('NAV starts at 100', Math.abs(nav[0] - 100) < 1e-9);
  ok('GFC bottom is exactly (1−depth)×peak (a 60% drop)',
    Math.abs(nav[S + ev.fallMonths] - (1 - ev.depth) * nav[S]) < 1e-6);
  const trend = nav[S] * Math.pow(1 + E.DIRECT_MONTHLY, ev.fallMonths + ev.recoveryMonths);
  ok('NAV recovers exactly to trend at healed month',
    Math.abs(nav[S + ev.fallMonths + ev.recoveryMonths] - trend) < 1e-6);
}

/* ---------------- XIRR sanity ---------------- */
{
  // A lumpsum doubling in ~6 years should imply ~12.2%/yr.
  const r = E.xirr([{ t: 0, amount: -100 }, { t: 6, amount: 200 }]);
  ok('XIRR of 100→200 over 6y ≈ 12.25%', Math.abs(r - 0.1225) < 0.005, `(got ${(r * 100).toFixed(2)}%)`);
  ok('Fee gap is exactly 1%/yr', Math.abs(E.FEE_GAP_MONTHLY * 12 - 0.01) < 1e-9);
}

/* ---------------- Monte Carlo: honest, all three endings reachable ---------------- */
{
  const N = E.HORIZON_MONTHS;
  // Estimate annualised stats from many simulated paths (~12%/yr, ~15-18%/yr).
  const allRets = [];
  const seedRng = (function () { let a = 99; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  for (let p = 0; p < 400; p++) {
    const r = E.genMarketReturns(N, seedRng);
    for (const x of r) allRets.push(x);
  }
  const mean = allRets.reduce((s, x) => s + x, 0) / allRets.length;
  const variance = allRets.reduce((s, x) => s + (x - mean) ** 2, 0) / allRets.length;
  const annMean = Math.pow(1 + mean, 12) - 1;
  const annVol = Math.sqrt(variance) * Math.sqrt(12);
  console.log(`\nMonte Carlo market model: mean ≈ ${(annMean * 100).toFixed(1)}%/yr, vol ≈ ${(annVol * 100).toFixed(1)}%/yr`);
  ok('MC mean return ≈ 12%/yr (10–14%)', annMean > 0.10 && annMean < 0.14, `(${(annMean * 100).toFixed(1)}%)`);
  ok('MC volatility ≈ 15–18%/yr', annVol > 0.13 && annVol < 0.20, `(${(annVol * 100).toFixed(1)}%)`);

  // Direct-hold vs Regular-hold: Direct should win the large majority (fee).
  const mcHold = E.runMonteCarlo(10000, 'hold', 'hold', 2000, 7);
  console.log(`  Direct-hold vs Regular-hold: YOU ahead in ${mcHold.youAhead}/${mcHold.nPaths}`);
  ok('hold vs hold: Direct (no fee) wins the clear majority',
    mcHold.youAhead > mcHold.nPaths * 0.7, `(${mcHold.youAhead}/${mcHold.nPaths})`);

  // Direct-panic vs Regular-hold: the guided friend should win most futures.
  const mcPanic = E.runMonteCarlo(10000, 'panic', 'hold', 2000, 7);
  console.log(`  Direct-panic vs Regular-hold: FRIEND ahead in ${mcPanic.friendAhead}/${mcPanic.nPaths}`);
  ok('panic vs hold: the guided Regular friend wins more often than not',
    mcPanic.friendAhead > mcPanic.youAhead, `(friend ${mcPanic.friendAhead} vs you ${mcPanic.youAhead})`);

  // Direct-hold vs Regular-panic: calm Direct should dominate — the door was
  // never the point; behaviour is. (Honesty in the other direction.)
  const mcFlip = E.runMonteCarlo(10000, 'hold', 'panic', 2000, 7);
  console.log(`  Direct-hold vs Regular-panic: YOU ahead in ${mcFlip.youAhead}/${mcFlip.nPaths}`);
  ok('hold vs panic: calm Direct beats the panicking Regular most futures',
    mcFlip.youAhead > mcFlip.friendAhead, `(you ${mcFlip.youAhead} vs friend ${mcFlip.friendAhead})`);
}

/* ---------------- Scenario B: the emergency ---------------- */
{
  for (const downturn of [false, true]) {
    const sim = E.runEmergency(10000, 'icu', 'panic', downturn);
    console.log(`\nEmergency (icu, downturn=${downturn}): you(panic) ${Cr(sim.you.final)}  friend(surgical) ${Cr(sim.friend.final)}  directSmart ${Cr(sim.directSmart.final)}`);
    ok(`[em ${downturn}] surgical friend finishes far ahead of panic-everything you`,
      sim.friend.final > sim.you.final * 1.5, `(${Cr(sim.friend.final)} vs ${Cr(sim.you.final)})`);
    ok(`[em ${downturn}] panic killed the SIP; surgical kept it`,
      sim.you.sipSurvived === false && sim.friend.sipSurvived === true);
    // A disciplined solo Direct investor edges AHEAD of the friend (saved the
    // fee) — proof the door isn't the point. But the behaviour gap (panic vs
    // surgical) dwarfs that fee gap many times over.
    ok(`[em ${downturn}] directSmart ≥ friend (Direct also saved the fee)`,
      sim.directSmart.final >= sim.friend.final,
      `(smart ${Cr(sim.directSmart.final)} vs friend ${Cr(sim.friend.final)})`);
    ok(`[em ${downturn}] behaviour gap (friend−you) dwarfs the fee gap (smart−friend)`,
      (sim.friend.final - sim.you.final) > 4 * (sim.directSmart.final - sim.friend.final));
    ok(`[em ${downturn}] surgical took exactly the need (mid-cap left untouched)`,
      Math.abs(sim.friend.took - sim.need) < 1, `(took ${L(sim.friend.took)} need ${L(sim.need)})`);

    // The four user choices, all as Direct, must order sensibly:
    // surgical (best) > {sipKill, sellLosers} > panic (worst).
    const four = {};
    for (const r of ['panic', 'surgical', 'sellLosers', 'sipKill'])
      four[r] = E.runEmergency(10000, 'icu', r, downturn).you.final;
    ok(`[em ${downturn}] surgical is the best of the four choices`,
      four.surgical > four.sipKill && four.surgical > four.sellLosers && four.surgical > four.panic,
      `(surg ${L(four.surgical)} kill ${L(four.sipKill)} losers ${L(four.sellLosers)} panic ${L(four.panic)})`);
    ok(`[em ${downturn}] panic is the worst of the four choices`,
      four.panic < four.sipKill && four.panic < four.sellLosers);
    ok(`[em ${downturn}] cancelling the SIP forfeits 12 years of contributions`,
      four.sipKill < four.surgical * 0.85);
  }

  // crashLinked emergencies (pandemic, war) force the hardest mode on.
  const pan = E.runEmergency(10000, 'pandemic', 'panic', false);
  ok('pandemic is crash-linked (downturn forced on)', pan.downturn === true);
  const war = E.runEmergency(10000, 'war', 'surgical', false);
  ok('war is crash-linked (downturn forced on)', war.downturn === true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
