/* Node verification for the SIP crash simulator engine in app.js.
 * Run: node tests/test_simulator.js
 * Checks the engine against the Python closed-form and the example invariants. */
'use strict';
const { simulateDeterministic } = require('../app.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
const cr = v => (v / 1e7).toFixed(2) + ' Cr';

const ex = { sip: 10000, yrs: 30, ret: 12, crash: 40, cy: 15, cm: 6, rm: 18,
  er: 1, psd: 6, out: 24, dip: 2, cur: 'INR', mode: 'det', vol: 16, paths: 1000, seed: 42 };

console.log('\nExample scenario (₹10k/mo, 30y, 12%, −40% crash in yr15, dip 2×):');
const sim = simulateDeterministic(ex);
const d = sim.scen;
for (const k of ['dip', 'direct', 'regular', 'soldback', 'out'])
  console.log(`    ${k.padEnd(9)} ${cr(d[k].final)}   XIRR ${(d[k].xirr * 100).toFixed(1)}%`);

console.log('\nChecks:');
// 1. stay-invested ~ Python sip_future_value(10000,0.12,30)=3.53cr (a one-time
//    crash that recovers to trend barely moves a 30y SIP terminal value)
ok('Direct stay-invested ≈ ₹3.5cr (within 3%)',
  Math.abs(d.direct.final - 3.53e7) / 3.53e7 < 0.03, '(got ' + cr(d.direct.final) + ')');

// 2. invested identical across all four reactions (apples-to-apples)
const inv = d.direct.invested;
ok('invested identical across all scenarios',
  ['regular','soldback','out'].every(k => Math.abs(d[k].invested - inv) < 1e-6),
  '(₹' + inv + ')');
ok('invested == sip*months', Math.abs(inv - ex.sip * ex.yrs * 12) < 1e-6);

// 3. ordering: stay-invested is best; panic-out is worst
ok('Direct > Regular (expense toll is positive)', d.direct.final > d.regular.final,
  'toll=' + cr(d.direct.final - d.regular.final));
ok('Direct > sold-back (rebound forfeited)', d.direct.final > d.soldback.final);
ok('sold-back > stayed-out', d.soldback.final > d.out.final);
ok('stayed-out can fall below Regular (the example punchline)',
  d.out.final < d.regular.final, '(out=' + cr(d.out.final) + ' vs reg=' + cr(d.regular.final) + ')');

// 3b. the courage door: bought-the-dip beats the benchmark on BOTH corpus and
//     money-weighted return (extra rupees deployed cheap, not just more deposited)
ok('bought-the-dip > Direct corpus (beats the benchmark)', d.dip.final > d.direct.final,
  '(dip=' + cr(d.dip.final) + ' vs direct=' + cr(d.direct.final) + ')');
ok('bought-the-dip deployed more capital', d.dip.invested > d.direct.invested);
ok('bought-the-dip XIRR > Direct XIRR (the extra rupees worked harder)',
  d.dip.xirr > d.direct.xirr,
  '(dip=' + (d.dip.xirr * 100).toFixed(2) + '% vs direct=' + (d.direct.xirr * 100).toFixed(2) + '%)');
ok('dip=1 ⇒ dip-buyer == Direct (no extra deployed)',
  Math.abs(simulateDeterministic({ ...ex, dip: 1 }).scen.dip.final - d.direct.final) < 1);

// 4. edge: crash=0 ⇒ nobody panics ⇒ direct/soldback/out identical (er=0 ⇒ +regular)
const flat = simulateDeterministic({ ...ex, crash: 0, er: 0 });
ok('crash=0 & er=0 ⇒ all four scenarios identical',
  ['regular','soldback','out'].every(k =>
    Math.abs(flat.scen[k].final - flat.scen.direct.final) < flat.scen.direct.final * 1e-9));
const noER = simulateDeterministic({ ...ex, er: 0 });
ok('expense=0 ⇒ Direct == Regular',
  Math.abs(noER.scen.direct.final - noER.scen.regular.final) < 1 );

// 5. XIRR of clean stay-invested ≈ effective annual of monthly 1% = 12.68%
const noCrash = simulateDeterministic({ ...ex, crash: 0 });
const effAnnual = Math.pow(1 + 0.12 / 12, 12) - 1; // 0.1268
ok('XIRR ≈ effective annual (12.68%) for clean 12% nominal market',
  Math.abs(noCrash.scen.direct.xirr - effAnnual) < 0.003, '(got ' + (noCrash.scen.direct.xirr*100).toFixed(2) + '%)');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
