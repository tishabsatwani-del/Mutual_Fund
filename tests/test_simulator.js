/* Node verification for the "Live It" math engine in app.js.
 * Run: node tests/test_simulator.js
 * Asserts the deterministic invariants the experience depends on. */
'use strict';
const { runSimulation, buildNav, DIRECT_MONTHLY, REGULAR_MONTHLY } = require('../app.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}
const cr = (v) => '₹' + (v / 1e7).toFixed(3) + ' Cr';

for (const years of [15, 20, 30]) {
  const sim = runSimulation(10000, years);
  const p = sim.paths;
  console.log(`\n₹10,000 / mo · ${years} years · crash at year ${years / 2}:`);
  for (const k of ['directHeld', 'regularHeld', 'paused', 'soldBack', 'stayedOut'])
    console.log(`    ${k.padEnd(12)} ${cr(p[k].final)}`);

  // ---- Invested is identical across every path (apples to apples). ----
  const inv = 10000 * sim.N;
  ok(`[${years}y] every path invests SIP x N = ${cr(inv)}`,
    ['directHeld', 'regularHeld', 'paused', 'soldBack', 'stayedOut']
      .every((k) => Math.abs(p[k].invested - inv) < 1e-6));

  // ---- The guaranteed ordering: 2 > 1 ~= 3 > 4 > 5. ----
  ok(`[${years}y] directHeld (2) is the best`,
    p.directHeld.final > p.regularHeld.final &&
    p.directHeld.final > p.paused.final &&
    p.directHeld.final > p.soldBack.final);
  ok(`[${years}y] regularHeld (1) > soldBack (4)`, p.regularHeld.final > p.soldBack.final);
  ok(`[${years}y] paused (3) > soldBack (4)`, p.paused.final > p.soldBack.final);
  ok(`[${years}y] soldBack (4) > stayedOut (5)`, p.soldBack.final > p.stayedOut.final);
  ok(`[${years}y] stayedOut (5) ends below the Regular toll (the gut-punch)`,
    p.stayedOut.final < p.regularHeld.final,
    `(out=${cr(p.stayedOut.final)} vs reg=${cr(p.regularHeld.final)})`);
  // regular (1) and paused (3) are the close middle pair: both sit strictly
  // between the best path (2) and the panic-sell paths (4). ("2 > 1 ~= 3 > 4")
  const mid = [p.regularHeld.final, p.paused.final];
  ok(`[${years}y] regular (1) & paused (3) are the middle pair: 2 > {1,3} > 4`,
    p.directHeld.final > Math.max(...mid) && Math.min(...mid) > p.soldBack.final,
    `(reg=${cr(p.regularHeld.final)}, paused=${cr(p.paused.final)})`);

  // ---- Staying invested through the crash ends SLIGHTLY RICHER than a
  //      crash-free market (cheap units below trend), and never poorer. ----
  ok(`[${years}y] directHeld > crash-free trend (slightly richer, not clamped)`,
    p.directHeld.final > sim.directNoCrashFinal,
    `(crash=${cr(p.directHeld.final)} vs no-crash=${cr(sim.directNoCrashFinal)})`);
}

// ---- NAV crash shape (Direct series, 15y) ----
{
  const years = 15, N = years * 12, C = years * 6;
  const nav = buildNav(DIRECT_MONTHLY, N, C);
  ok('NAV starts at 100', Math.abs(nav[0] - 100) < 1e-9);
  ok('NAV[C+3] is exactly 60% of NAV[C] (a 40% drop)',
    Math.abs(nav[C + 3] - 0.6 * nav[C]) < 1e-6);
  const trend = nav[C] * Math.pow(1 + DIRECT_MONTHLY, 18);
  ok('NAV[C+18] recovers exactly to trend',
    Math.abs(nav[C + 18] - trend) < 1e-6, `(got ${nav[C + 18].toFixed(3)}, trend ${trend.toFixed(3)})`);
  ok('post-recovery NAV equals undisturbed trend (no scar)',
    Math.abs(nav[C + 24] - nav[C] * Math.pow(1 + DIRECT_MONTHLY, 24)) < 1e-6);
}

// ---- Regular monthly rate is the 11%/yr commission-gap value. ----
ok('Regular monthly rate ≈ 0.9167%', Math.abs(REGULAR_MONTHLY - 0.0091667) < 1e-4);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
