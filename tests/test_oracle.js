/* Node verification for the Autonomous Portfolio Oracle — Part 1 engine
 * (oracle.js). Run: node tests/test_oracle.js
 * Locks the diagnostic invariants: exact return maths, risk-stat sanity,
 * cost-leakage direction, overlap detection, and the spendable-cash tax
 * waterfall. Every figure is computed; nothing is fabricated. */
'use strict';
const O = require('../oracle.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const L = (v) => '₹' + (v / 1e5).toFixed(2) + ' L';

/* ---------------- 1. Return metrics ---------------- */
console.log('\n1. Advanced Return Metrics');
ok('absoluteReturn: +25% on a 100k->125k', close(O.absoluteReturn(100000, 125000), 0.25));
ok('absoluteReturn: negative on a loss', O.absoluteReturn(100000, 80000) < 0);
ok('cagr: 100->200 over 1y is 100%', close(O.cagr(100, 200, 1), 1));
ok('cagr: doubling over 6y ~ 12.246%', close(O.cagr(100, 200, 6), Math.pow(2, 1 / 6) - 1));

// XIRR: invest 50k twice a year apart, end 120k -> should be a sane positive IRR.
const xr = O.xirr([
  { date: '2022-01-01', amount: -50000 },
  { date: '2023-01-01', amount: -50000 },
  { date: '2024-01-01', amount: 120000 },
]);
ok('xirr: finite and positive on a winning portfolio', isFinite(xr) && xr > 0, `(${(xr * 100).toFixed(2)}%)`);
// A flat 10%/yr single lump should recover ~10% (365-day basis: the 2023->24
// span crosses a leap day, so 366/365 yr lands a hair under 10% — expected).
const xr2 = O.xirr([{ date: '2023-06-20', amount: -100000 }, { date: '2024-06-20', amount: 110000 }]);
ok('xirr: 100k -> 110k in ~1y is ~10% (365-day basis)', close(xr2, 0.10, 5e-4), `(${(xr2 * 100).toFixed(3)}%)`);
ok('xirr: returns NaN when all flows share a sign', Number.isNaN(O.xirr([{ date: '2023-01-01', amount: -1 }, { date: '2024-01-01', amount: -1 }])));

// Rolling returns: a clean 12%/yr compounding series -> every window ~12%.
const steady = [100];
const mUp = Math.pow(1.12, 1 / 12) - 1;
for (let i = 1; i <= 72; i++) steady.push(steady[i - 1] * (1 + mUp));
const roll3 = O.rollingReturns(steady, 3);
ok('rollingReturns: 3y windows on a 12% series all ~12%', close(roll3.avg, 0.12, 1e-6) && close(roll3.min, 0.12, 1e-6));
ok('rollingReturns: consistency = 1 (every window beats 0)', close(roll3.consistency, 1));
ok('rollingReturns: produces the expected window count', roll3.count === steady.length - 36);

/* ---------------- 2. Risk & quality ---------------- */
console.log('\n2. Statistical Risk & Quality');
// A fund that is exactly the benchmark must have beta=1, alpha=0.
const bench = O.buildNavHistory(7, 120, 0.115, 0.15, 1000);
const br = O.periodReturns(bench);
ok('beta of benchmark vs itself == 1', close(O.beta(br, br), 1, 1e-9));
const jaSelf = O.jensenAlpha(br, br, 0.065);
ok('alpha of benchmark vs itself == 0', close(jaSelf.alpha, 0, 1e-9));
// A fund that is exactly 2x the benchmark's returns each period -> beta 2.
const lev = br.map((r) => 2 * r);
ok('beta of a 2x series ~ 2', close(O.beta(lev, br), 2, 1e-9), `(${O.beta(lev, br).toFixed(4)})`);
// Sharpe rises when vol falls for the same return profile.
const calm = O.buildNavHistory(7, 120, 0.12, 0.08, 100);
const wild = O.buildNavHistory(8, 120, 0.12, 0.30, 100);
const sCalm = O.sharpe(O.periodReturns(calm), 0.065), sWild = O.sharpe(O.periodReturns(wild), 0.065);
ok('sharpe: lower-vol fund has the higher Sharpe', sCalm > sWild, `(${sCalm.toFixed(2)} vs ${sWild.toFixed(2)})`);
// Downside capture: a fund that always falls HALF as much as the market => 50%.
const half = br.map((r) => (r < 0 ? r / 2 : r));
const dc = O.downsideCapture(half, br);
ok('downsideCapture: half-the-fall fund captures exactly 50% of downside', close(dc, 50, 1e-9), `(${dc.toFixed(1)}%)`);
ok('downsideCapture of benchmark vs itself == 100', close(O.downsideCapture(br, br), 100, 1e-6));

/* ---------------- 2b. Advanced quant metrics ---------------- */
console.log('\n2b. Advanced risk-adjusted metrics');
// Sortino >= Sharpe in general (only downside vol penalised); both finite.
const calmRets = O.periodReturns(calm);
ok('sortino: finite and >= Sharpe for a steady fund', isFinite(O.sortino(calmRets, 0.065)) && O.sortino(calmRets, 0.065) >= O.sharpe(calmRets, 0.065) - 1e-9);
// Max drawdown: a known peak->trough series.
const dd = O.maxDrawdown([100, 120, 60, 90, 130]); // worst is 120->60 = -50%
ok('maxDrawdown: finds the worst peak->trough (-50%)', close(dd.maxDrawdown, -0.5) && dd.peakIndex === 1 && dd.troughIndex === 2);
ok('maxDrawdown: a monotonically rising series has 0 drawdown', close(O.maxDrawdown([1, 2, 3, 4]).maxDrawdown, 0));
ok('calmar: annReturn / |maxDD|', close(O.calmar(0.15, -0.30), 0.5));
// R²: a fund identical to the benchmark is fully explained (R²=1); a 2x-levered one too.
ok('rSquared: fund == benchmark => R² = 1', close(O.rSquared(br, br), 1, 1e-9));
ok('rSquared: perfectly-correlated 2x series => R² = 1', close(O.rSquared(br.map((r) => 2 * r), br), 1, 1e-9));
ok('rSquared: between 0 and 1 for a noisy fund', (() => { const v = O.rSquared(O.periodReturns(wild), br); return v >= 0 && v <= 1; })());
// Tracking error: zero when fund == benchmark; positive otherwise.
ok('trackingError: 0 when fund tracks benchmark exactly', close(O.trackingError(br, br), 0, 1e-12));
ok('trackingError: positive when the fund deviates', O.trackingError(O.periodReturns(wild), br) > 0);
ok('informationRatio: finite when there is tracking error', isFinite(O.informationRatio(O.periodReturns(calm), br)));

/* ---------------- 3. Leakage & structure ---------------- */
console.log('\n3. Leakage & Structure Control');
const leak = O.expenseLeakage({ lumpsum: 1000000, years: 20, grossAnnualReturn: 0.12, directTer: 0.005, regularTer: 0.015 });
ok('leakage: Regular corpus < Direct corpus', leak.regularCorpus < leak.directCorpus);
ok('leakage: rupee leak is positive and material on 10L/20y', leak.leakageRupees > 0, `(${L(leak.leakageRupees)})`);
ok('leakage: a 1pt TER gap costs a double-digit % of the corpus over 20y',
  leak.leakagePctOfDirect > 0.10 && leak.leakagePctOfDirect < 0.30, `(${(leak.leakagePctOfDirect * 100).toFixed(1)}%)`);
ok('leakage: zero gap => zero leak', close(O.expenseLeakage({ lumpsum: 1e6, years: 20, directTer: 0.01, regularTer: 0.01 }).leakageRupees, 0, 1e-6));

// Overlap: identical holdings -> 100%; disjoint -> 0%.
const hA = [{ stock: 'A', weight: 0.5 }, { stock: 'B', weight: 0.5 }];
const hB = [{ stock: 'A', weight: 0.4 }, { stock: 'B', weight: 0.6 }];
const ov = O.portfolioOverlap(hA, hB);
ok('overlap: identical stocks flagged, ~90% (sum of min weights)', ov.flagged && close(ov.overlap, 0.9), `(${(ov.overlap * 100).toFixed(0)}%)`);
ok('overlap: disjoint funds => 0% and not flagged',
  (() => { const o = O.portfolioOverlap(hA, [{ stock: 'X', weight: 1 }]); return o.overlap === 0 && !o.flagged; })());

/* ---------------- 4. Spendable wealth ---------------- */
console.log('\n4. Spendable Wealth Counter');
const asOf = '2026-06-20';
// One long-held equity winner (LTCG) and one fresh equity buy (STCG + exit load).
const holdings = [
  { scheme: 'Old Winner', category: 'Large Cap Equity', plan: 'Direct', units: 1000, nav: 200, avgCost: 100, invested: 100000, purchaseDate: '2020-01-01' },
  { scheme: 'Fresh Buy', category: 'Mid Cap Equity', plan: 'Direct', units: 1000, nav: 130, avgCost: 100, invested: 100000, purchaseDate: '2026-02-01' },
];
const sw = O.netSpendableCash(holdings, asOf);
ok('spendable: gross = sum of current values', close(sw.gross, 1000 * 200 + 1000 * 130));
ok('spendable: long-held units classified LTCG', sw.lines[0].term === 'LTCG');
ok('spendable: fresh units classified STCG', sw.lines[1].term === 'STCG');
ok('spendable: exit load only on the < 1y holding', sw.lines[0].exitLoad === 0 && sw.lines[1].exitLoad > 0);
// LTCG gain = 100k, exemption 1.25L => fully exempt => no LTCG tax.
ok('spendable: ₹1.25L exemption wipes a 1L LTCG gain', close(sw.ltcgTax, 0), `(${L(sw.ltcgTax)})`);
// STCG gain = 30k @ 20% = 6k.
ok('spendable: STCG taxed at 20% (30k gain -> 6k tax)', close(sw.stcgTax, 6000), `(${sw.stcgTax})`);
ok('spendable: net = gross - exitLoad - totalTax', close(sw.net, sw.gross - sw.exitLoad - sw.totalTax));
ok('spendable: net is strictly below gross when tax/load apply', sw.net < sw.gross);

/* ---------------- 5. Full diagnosis on the sample portfolio ---------------- */
console.log('\n5. Full diagnose() on the sample portfolio');
const pf = O.samplePortfolio(asOf);
const dx = O.diagnose(pf, { asOf });
ok('diagnose: every holding gets a fund report', dx.funds.length === pf.holdings.length);
ok('diagnose: summary current value = sum(units*nav)',
  close(dx.summary.current, pf.holdings.reduce((s, h) => s + h.units * h.nav, 0), 1e-3));
ok('diagnose: portfolio XIRR is finite', isFinite(dx.portfolioXirr), `(${(dx.portfolioXirr * 100).toFixed(2)}%)`);
ok('diagnose: every equity fund has risk stats (alpha/beta/sharpe)',
  dx.funds.filter((f) => f.assetClass === 'Equity').every((f) => f.risk && isFinite(f.risk.beta) && isFinite(f.risk.sharpe)));
ok('diagnose: the two large-caps are flagged as overlapping',
  dx.overlaps.some((o) => /Large Cap/.test(o.a) && /Large Cap/.test(o.b) && o.flagged), `(top overlap ${dx.overlaps[0] ? (dx.overlaps[0].overlap * 100).toFixed(0) + '%' : 'none'})`);
ok('diagnose: the deliberate laggard is flagged as deadwood',
  dx.funds.some((f) => /Laggard/.test(f.scheme) && f.deadwood));
ok('diagnose: Regular plans show a positive cost leakage', dx.leakage.leakageRupees > 0, `(${L(dx.leakage.leakageRupees)})`);
ok('diagnose: spendable net <= gross', dx.spendable.net <= dx.spendable.gross);
ok('diagnose: allocation weights sum to ~1', close(Object.values(dx.summary.allocation).reduce((s, x) => s + x, 0), 1, 1e-6));

/* ---------------- summary ---------------- */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
