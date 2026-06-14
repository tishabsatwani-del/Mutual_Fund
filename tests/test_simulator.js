/* Node verification for the "Two Doors, One Storm" math engine in app.js.
 * Run: node tests/test_simulator.js
 * Locks the financial invariants: exact CAGRs, ordering, XIRR sanity, an
 * honest Monte Carlo (Direct can finish above, equal to, or below Regular),
 * and the emergency severity/response mechanics. No figure is fabricated. */
'use strict';
const E = require('../app.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}
const L = (v) => '₹' + (v / 1e5).toFixed(2) + ' L';
const Cr = (v) => '₹' + (v / 1e7).toFixed(3) + ' Cr';

/* ---------------- Rates: EXACT effective annual CAGRs ---------------- */
ok('Direct monthly compounds to EXACTLY 12.00%/yr', Math.abs(Math.pow(1 + E.DIRECT_MONTHLY, 12) - 1 - 0.12) < 1e-12);
ok('Regular monthly compounds to EXACTLY 11.00%/yr', Math.abs(Math.pow(1 + E.REGULAR_MONTHLY, 12) - 1 - 0.11) < 1e-12);
ok('fee factor on a Direct path yields EXACTLY 11.00%/yr (a 1pt gap)',
  Math.abs(Math.pow((1 + E.DIRECT_MONTHLY) * E.FEE_FACTOR, 12) - 1 - 0.11) < 1e-12);

/* ---------------- Single-path engine (every event, 20y) ---------------- */
for (const evId of Object.keys(E.EVENTS)) {
  const sim = E.runSinglePath(10000, evId, 20);
  const d = sim.direct, r = sim.regular;
  console.log(`\n${sim.ev.name} · ₹10,000/mo · 20y · crash at year ${sim.crashYear}:`);
  console.log(`    direct hold ${Cr(d.hold.final)} (XIRR ${(d.hold.xirr * 100).toFixed(2)}%)  sellWait ${Cr(d.sellWait.final)}   regular hold ${Cr(r.hold.final)}`);

  const inv = 10000 * sim.N;
  ok(`[${evId}] every behaviour invests SIP×N`,
    ['hold', 'pause', 'sellBack', 'sellWait'].every((k) => Math.abs(d[k].invested - inv) < 1e-6 && Math.abs(r[k].invested - inv) < 1e-6));
  ok(`[${evId}] direct: hold > pause > sellBack > sellWait`,
    d.hold.final > d.pause.final && d.pause.final > d.sellBack.final && d.sellBack.final > d.sellWait.final);
  ok(`[${evId}] fee saving (direct-hold − regular-hold) > 0`, sim.feeSavingRupees > 0, `(${L(sim.feeSavingRupees)})`);
  ok(`[${evId}] panic (sellWait Direct) finishes BELOW calm Regular`,
    d.sellWait.final < r.hold.final, `(${L(d.sellWait.final)} < ${L(r.hold.final)})`);
  ok(`[${evId}] held ends a little BELOW the no-crash baseline (round-trip cost), never near half`,
    d.hold.final < sim.directNoCrash && d.hold.final > sim.directNoCrash * 0.78, `(${L(d.hold.final)} vs no-crash ${L(sim.directNoCrash)})`);
  ok(`[${evId}] index CAGR is a little under 12% (regains the peak, not the trend)`, sim.indexCagr > 0.085 && sim.indexCagr < 0.12, `(${(sim.indexCagr * 100).toFixed(2)}%)`);
  ok(`[${evId}] XIRR finite and hold > sellWait`, isFinite(d.hold.xirr) && d.hold.xirr > d.sellWait.xirr);
}

/* ---------------- Horizon scales; crash stays at the midpoint ---------------- */
for (const Y of [15, 20, 30]) {
  const s = E.runSinglePath(10000, 'gfc', Y);
  ok(`[${Y}y] crash at the exact midpoint (year ${Y / 2})`, Math.abs(s.crashYear - Y / 2) < 0.05, `(got ${s.crashYear})`);
}

/* ---------------- NAV crash shape ---------------- */
{
  const ev = E.EVENTS.gfc, N = 240, S = 120;
  const nav = E.buildEventNav(E.DIRECT_MONTHLY, N, ev, S);
  ok('NAV starts at 100', Math.abs(nav[0] - 100) < 1e-9);
  ok('GFC bottom is exactly (1−depth)×peak', Math.abs(nav[S + ev.fallMonths] - (1 - ev.depth) * nav[S]) < 1e-6);
  ok('NAV recovers to the PRE-CRASH PEAK at the healed month (not the trend)', Math.abs(nav[S + ev.fallMonths + ev.recoveryMonths] - nav[S]) < 1e-6);
  ok('after healing, NAV resumes trend growth FROM the peak (permanent gap below trend)',
    Math.abs(nav[N] - nav[S] * Math.pow(1 + E.DIRECT_MONTHLY, N - (S + ev.fallMonths + ev.recoveryMonths))) < 1e-6 && nav[N] < 100 * Math.pow(1 + E.DIRECT_MONTHLY, N));
}

/* ---------------- CAGR & XIRR sanity ---------------- */
ok('CAGR 100→200 over 6y ≈ 12.25%', Math.abs(E.cagr(100, 200, 6) - 0.1225) < 0.001);
ok('XIRR 100→200 over 6y ≈ 12.25%', Math.abs(E.xirr([{ t: 0, amount: -100 }, { t: 6, amount: 200 }]) - 0.1225) < 0.005);

/* ---------------- Monte Carlo: honest, all three endings reachable ---------------- */
{
  const N = 240, allRets = [];
  const seedRng = (function () { let a = 99; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  for (let p = 0; p < 400; p++) for (const x of E.genMarketReturns(N, seedRng)) allRets.push(x);
  const mean = allRets.reduce((s, x) => s + x, 0) / allRets.length;
  const variance = allRets.reduce((s, x) => s + (x - mean) ** 2, 0) / allRets.length;
  const annMean = Math.pow(1 + mean, 12) - 1, annVol = Math.sqrt(variance) * Math.sqrt(12);
  console.log(`\nMonte Carlo model: mean ≈ ${(annMean * 100).toFixed(1)}%/yr, vol ≈ ${(annVol * 100).toFixed(1)}%/yr`);
  ok('MC mean ≈ 12%/yr (10–14%)', annMean > 0.10 && annMean < 0.14, `(${(annMean * 100).toFixed(1)}%)`);
  ok('MC vol ≈ 15–18%/yr', annVol > 0.13 && annVol < 0.20, `(${(annVol * 100).toFixed(1)}%)`);

  const hh = E.runMonteCarlo(10000, 'hold', 'hold', 2000, 7, 20);
  ok('hold vs hold: Direct (no fee) wins the clear majority', hh.youAhead > hh.nPaths * 0.7, `(${hh.youAhead}/${hh.nPaths})`);
  const ph = E.runMonteCarlo(10000, 'panic', 'hold', 2000, 7, 20);
  ok('panic vs hold: guided Regular wins more often than not', ph.friendAhead > ph.youAhead, `(friend ${ph.friendAhead} vs you ${ph.youAhead})`);
  const hp = E.runMonteCarlo(10000, 'hold', 'panic', 2000, 7, 20);
  ok('hold vs panic: calm Direct beats panicking Regular most futures', hp.youAhead > hp.friendAhead, `(you ${hp.youAhead} vs friend ${hp.friendAhead})`);
}

/* ---------------- Scenario B: severity + four responses ---------------- */
{
  for (const downturn of [false, true]) {
    const sim = E.runEmergency(10000, 'icu', 'panic', downturn, 20, 'major');
    console.log(`\nEmergency (icu, major, downturn=${downturn}): need ${L(sim.need)}  you(panic) ${Cr(sim.you.final)}  friend ${Cr(sim.friend.final)}  smart ${Cr(sim.directSmart.final)}`);
    ok(`[em ${downturn}] surgical friend far ahead of panic-everything you`, sim.friend.final > sim.you.final * 1.5);
    ok(`[em ${downturn}] panic killed the SIP; surgical kept it`, sim.you.sipSurvived === false && sim.friend.sipSurvived === true);
    ok(`[em ${downturn}] directSmart ≥ friend (Direct also saved the fee)`, sim.directSmart.final >= sim.friend.final);
    ok(`[em ${downturn}] behaviour gap dwarfs the fee gap`, (sim.friend.final - sim.you.final) > 4 * (sim.directSmart.final - sim.friend.final));
    ok(`[em ${downturn}] surgical took exactly the need`, Math.abs(sim.friend.took - sim.need) < 1, `(took ${L(sim.friend.took)} need ${L(sim.need)})`);

    const four = {};
    for (const r of ['panic', 'surgical', 'sellLosers', 'sipKill']) four[r] = E.runEmergency(10000, 'icu', r, downturn, 20, 'major').you.final;
    ok(`[em ${downturn}] surgical best, panic worst of the four choices`,
      four.surgical > four.sipKill && four.surgical > four.sellLosers && four.surgical > four.panic && four.panic < four.sipKill && four.panic < four.sellLosers);
    ok(`[em ${downturn}] cancelling the SIP forfeits years of contributions`, four.sipKill < four.surgical * 0.9);
  }
  // Severity scales the need monotonically.
  const nMinor = E.runEmergency(10000, 'icu', 'surgical', false, 20, 'minor').need;
  const nMajor = E.runEmergency(10000, 'icu', 'surgical', false, 20, 'major').need;
  const nSevere = E.runEmergency(10000, 'icu', 'surgical', false, 20, 'severe').need;
  ok('severity scales need: minor < major < severe', nMinor < nMajor && nMajor < nSevere, `(${L(nMinor)} ${L(nMajor)} ${L(nSevere)})`);
  // Minor/major leave the mid-cap untouched; severe is forced to dip into it.
  ok('minor leaves mid-cap untouched', E.runEmergency(10000, 'icu', 'surgical', false, 20, 'minor').friend.fromMid === 0);
  ok('severe forces some mid-cap selling', E.runEmergency(10000, 'icu', 'surgical', false, 20, 'severe').friend.fromMid > 0);
  // crashLinked emergencies force the hardest mode on.
  ok('pandemic is crash-linked', E.runEmergency(10000, 'pandemic', 'panic', false, 20, 'major').downturn === true);
  ok('war is crash-linked', E.runEmergency(10000, 'war', 'surgical', false, 20, 'major').downturn === true);
}

/* ---------------- Ten thousand lifetimes: calm vs panic, same door ---------------- */
{
  const lf = E.runLifetimes(10000, 20, 4242, 3000, 1500);
  console.log(`\nTen thousand lifetimes (3,000 here): calm ahead ${lf.calmAhead}/${lf.nPaths}  calm p50 ${Cr(lf.calm.p50)}  panic p50 ${Cr(lf.panic.p50)}  crowdGap ${L(lf.crowdGap)}  doorGap ${L(lf.doorGap)}`);
  ok('lifetimes: outcomes partition (calm + tied + panic = nPaths)', lf.calmAhead + lf.tied + lf.panicAhead === lf.nPaths);
  ok('lifetimes: the calm you wins the clear majority of lives', lf.calmAhead > lf.nPaths * 0.6, `(${lf.calmAhead}/${lf.nPaths})`);
  ok('lifetimes: calm median above panic median', lf.calm.p50 > lf.panic.p50, `(${Cr(lf.calm.p50)} > ${Cr(lf.panic.p50)})`);
  ok('lifetimes: the crowd (behaviour) outweighs the door (fee)', Math.abs(lf.crowdGap) > 1.5 * Math.abs(lf.doorGap), `(crowd ${L(lf.crowdGap)} vs door ${L(lf.doorGap)})`);
  ok('lifetimes: door gap is positive (Direct beats Regular, calm vs calm)', lf.doorGap > 0, `(${L(lf.doorGap)})`);
  // Realistic panic re-enters at erratic, mostly-late times — so it ends LOWER,
  // with a WORSE FLOOR and more scatter relative to its median (less safe). It is
  // NOT wider in absolute rupees: calm's huge upper tail stretches its range more.
  const covPanic = (lf.panic.p90 - lf.panic.p10) / lf.panic.p50, covCalm = (lf.calm.p90 - lf.calm.p10) / lf.calm.p50;
  ok('lifetimes: panic ends lower, with a worse floor and more relative scatter (less safe)',
    lf.panic.p50 < lf.calm.p50 && lf.panic.p05 < lf.calm.p05 && covPanic > covCalm,
    `(panic floor ${L(lf.panic.p05)} vs calm ${L(lf.calm.p05)}; CoV ${covPanic.toFixed(2)} vs ${covCalm.toFixed(2)})`);
  ok('lifetimes: percentiles ordered', lf.calm.min <= lf.calm.p05 && lf.calm.p05 <= lf.calm.p50 && lf.calm.p50 <= lf.calm.p95 && lf.calm.p95 <= lf.calm.max);
  ok('lifetimes: representative sample collected', lf.sample.length > 1000 && lf.sample.length <= 3000, `(${lf.sample.length})`);

  // The "cruelest life" replay: reproducible by index, calm clearly survives it.
  const wl = E.buildWorstLife(10000, 20, 4242, lf.worstIdx);
  console.log(`Cruelest life #${lf.worstIdx}: calm ${Cr(wl.calmFinal)}  panic ${Cr(wl.panicFinal)}  invested ${L(wl.invested)}`);
  ok('worst life: series run the full horizon', wl.calmSeries.length === wl.N + 1 && wl.panicSeries.length === wl.N + 1);
  ok('worst life: replay reproduces the counted finals', Math.abs(wl.calmSeries[wl.N] - wl.calmFinal) < 1 && Math.abs(wl.panicSeries[wl.N] - wl.panicFinal) < 1);
  ok('worst life: even here the calm you ends above what was invested', wl.calmFinal > wl.invested, `(${Cr(wl.calmFinal)} > ${L(wl.invested)})`);
  ok('worst life: on that same unlucky market the panic you ended underwater, below calm', wl.panicFinal < wl.invested && wl.panicFinal < wl.calmFinal, `(panic ${Cr(wl.panicFinal)} underwater vs calm ${Cr(wl.calmFinal)})`);
  ok('worst life: buildWorstLife is deterministic for a given index', E.buildWorstLife(10000, 20, 4242, lf.worstIdx).calmFinal === wl.calmFinal);
}

/* ---------------- Acceptance: ₹10,000/mo · 15y · 2008 (corrected recovery) ---------------- */
{
  const s = E.runSinglePath(10000, 'gfc', 15), d = s.direct, N = 180;
  const dN = E.buildTrendNav(E.DIRECT_MONTHLY, N), rN = E.buildTrendNav(E.REGULAR_MONTHLY, N);
  let du = 0, ru = 0; for (let m = 0; m < N; m++) { du += 10000 / dN[m]; ru += 10000 / rN[m]; }
  const ncD = du * dN[N], ncR = ru * rN[N];
  console.log(`\nAcceptance ₹10k/15y/2008: no-crash D ${L(ncD)} R ${L(ncR)} | held D ${L(d.hold.final)} R ${L(s.regular.hold.final)} pause ${L(d.pause.final)} sellBack ${L(d.sellBack.final)} sellWait ${L(d.sellWait.final)}`);
  ok('accept: no-crash Direct ≈ ₹47.6 L', Math.abs(ncD - 47.6e5) < 1.0e5, `(${L(ncD)})`);
  ok('accept: no-crash Regular ≈ ₹43.7 L', Math.abs(ncR - 43.7e5) < 1.0e5, `(${L(ncR)})`);
  ok('accept: held finishes high-30s..mid-40s lakh, NOT ~half', d.hold.final > 37e5 && d.hold.final < 46e5, `(${L(d.hold.final)})`);
  ok('accept: ordering held ≥ Regular-held > paused > sold&rebuy > sold&stay-out',
    d.hold.final >= s.regular.hold.final && s.regular.hold.final > d.pause.final && d.pause.final > d.sellBack.final && d.sellBack.final > d.sellWait.final);
  ok('accept: sold-&-stay-out clearly below held (missed the rally)', d.sellWait.final < d.hold.final * 0.7, `(${L(d.sellWait.final)} vs ${L(d.hold.final)})`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
