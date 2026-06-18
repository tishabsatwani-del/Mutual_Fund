/* =====================================================================
 * "Two Doors, One Storm"
 * An advanced, behaviour-driven Monte Carlo investing simulator.
 * ---------------------------------------------------------------------
 * Two people invest the same money, in the same market. One chose a REGULAR
 * plan (pays ~1%/yr more, but has a relationship manager / MD to call when
 * life hits). One chose DIRECT (pays nothing extra, but faces every storm
 * alone). The fee gap is small and steady; the behaviour gap is enormous.
 *
 * Two clearly separated halves:
 *   1. THE MATH ENGINE  — every figure is COMPUTED, never invented. Real
 *      unit-level accounting (units x NAV each month), correct SIP cash-flow
 *      timing, an exact XIRR (Newton-Raphson + bisection) and CAGR. The only
 *      *inputs* are clearly-labelled assumptions: a 12%/11% effective annual
 *      return (Direct/Regular — a 1%/yr expense-ratio gap) and drawdown
 *      depths/durations drawn from real history. Node-exported and unit-tested.
 *   2. THE EXPERIENCE   — the cinematic, mobile-first journey (browser only).
 *
 * ACCURACY NOTE: rates are stored so the *effective annual CAGR* is exactly
 * 12% / 11% (NOT a naive 1%/month, which would compound to 12.68%). The fee is
 * a multiplicative monthly drag so Regular's CAGR is exactly 1 percentage point
 * below Direct's, on every path. Outputs are illustrative ranges, never advice;
 * lock drawdown figures against real index data before shipping.
 * ===================================================================== */
'use strict';

/* =====================================================================
 * 1. THE MATH ENGINE
 * ===================================================================== */

/* ---- The two doors differ by exactly 1 percentage point of annual CAGR. ----
 * Effective annual returns are the assumption; the monthly rate is its 12th
 * root, so (1+monthly)^12 == 1+annual EXACTLY. */
const DIRECT_ANNUAL   = 0.12;
const REGULAR_ANNUAL  = 0.11;
const DIRECT_MONTHLY  = Math.pow(1 + DIRECT_ANNUAL,  1 / 12) - 1;   // ≈ 0.9489%/mo  -> 12.00%/yr
const REGULAR_MONTHLY = Math.pow(1 + REGULAR_ANNUAL, 1 / 12) - 1;   // ≈ 0.8735%/mo  -> 11.00%/yr
// Multiplicative monthly fee drag: applying it to ANY Direct path yields a path
// whose CAGR is exactly 1 pt lower. (1+DIRECT_M)*FEE_FACTOR raised to 12 = 1.11.
const FEE_FACTOR = Math.pow((1 + REGULAR_ANNUAL) / (1 + DIRECT_ANNUAL), 1 / 12);

const DEFAULT_YEARS = 20;

/* ---- Market events. Depths/durations are illustrative, based on real index
 * drawdowns; `what` explains, in plain words, what actually happened. -------- */
// Drawdown depth D, fall length F (months peak→trough), recovery R (months
// trough→pre-crash level), anchored to Nifty 50 / Sensex history. APPROXIMATE —
// lock to exact index data for the precise dates before any non-illustrative use.
// Sources to verify against: NSE/BSE index history.
//   COVID-19 2020: ~−38% (Jan–Mar 2020), trough ~Mar 2020, regained prior peak ~Nov 2020 (~8 mo).
//   GFC 2008: ~−60% (Jan 2008–Mar 2009), regained prior peak ~late 2010 (~22 mo from trough).
//   2022 correction: ~−18% (peaks Oct'21/early'22 to mid-2022), regained ~6 mo.
//   War/geopolitical: ~−14% illustrative/ongoing, recovers ~8 mo (Kargil/Balakot/Gulf precedent).
const EVENTS = {
  covid: {
    id: 'covid', name: 'COVID-19 crash, 2020', hypothetical: false,
    depth: 0.38, fallMonths: 1, recoveryMonths: 8,
    tag: 'The fast one',
    what: 'The world stopped overnight. Markets fell ~38% in one month — then regained their prior level within about eight. The fastest fall, and the fastest forgiveness.',
  },
  gfc: {
    id: 'gfc', name: 'Global Financial Crisis, 2008', hypothetical: false,
    depth: 0.60, fallMonths: 14, recoveryMonths: 22,
    tag: 'The deep, slow one',
    what: 'Banks collapsed worldwide. Markets bled ~60% over 14 long months, then took roughly 22 more to climb back to their prior peak — the slow crash that made selling feel smart for over a year.',
  },
  corr2022: {
    id: 'corr2022', name: '2022 correction', hypothetical: false,
    depth: 0.18, fallMonths: 9, recoveryMonths: 6,
    tag: 'The slow ache',
    what: 'Inflation and rising interest rates dragged markets down ~18% over about nine months, then back to their prior level in roughly six. Not a catastrophe — just a long, dull ache that tested your patience.',
  },
  war: {
    id: 'war', name: 'War / geopolitical shock', hypothetical: true,
    depth: 0.14, fallMonths: 2, recoveryMonths: 8,
    tag: 'The headline scare',
    what: 'War headlines, an oil shock, troops at the border. Markets dip on fear — history (Kargil, Balakot, the Gulf) says ~10–15%, regaining their level within months. Illustrative and ongoing; the scare is usually bigger than the damage.',
  },
  // 'drawn' is NOT a fixed event — it is generated live (see drawCrash) so it is
  // unique every run and can't be pattern-matched to history.
};

/** Generate a random-but-plausible crash for the "a crash no one saw coming"
 *  option: depth 25–55%, fall 1–12 mo, recovery 8–30 mo. */
function drawCrash() {
  const depth = 0.25 + Math.random() * 0.30;
  const fallMonths = 1 + Math.floor(Math.random() * 12);
  const recoveryMonths = 8 + Math.floor(Math.random() * 22);
  return { id: 'drawn', name: 'A crash no one saw coming', hypothetical: true,
    depth, fallMonths, recoveryMonths, tag: 'The unknown',
    what: 'Drawn live from the model — a real possible future. You don\'t know how deep it goes, or when it hits. Exactly like real life.' };
}

/* ---- Seedable PRNG (mulberry32) + standard normal (Box–Muller). ---- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---- Standard financial metrics (computed, never invented). ---- */

/** CAGR — compound annual growth rate from a begin/end value over `years`. */
function cagr(begin, end, years) { return Math.pow(end / begin, 1 / years) - 1; }

/** XIRR — annualised IRR of dated cash flows (years). Contributions negative,
 *  final value positive. Newton-Raphson with a bisection fallback. */
function xirr(flows, guess) {
  const npv = (r) => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, f.t), 0);
  const dnpv = (r) => flows.reduce((s, f) => s - f.t * f.amount / Math.pow(1 + r, f.t + 1), 0);
  let r = guess == null ? 0.12 : guess;
  for (let i = 0; i < 80; i++) {
    const f = npv(r), d = dnpv(r);
    if (Math.abs(f) < 1e-7) return r;
    const next = r - f / d;
    if (!isFinite(next)) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  let lo = -0.95, hi = 5, flo = npv(lo);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fmid = npv(mid);
    if (Math.abs(fmid) < 1e-7) return mid;
    if ((flo < 0) === (fmid < 0)) { lo = mid; flo = fmid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

/** XIRR for a level SIP: -sip at the START of months 0..N-1, +final at N. */
function xirrFromSIP(sip, N, finalValue) {
  const flows = [];
  for (let m = 0; m < N; m++) flows.push({ t: m / 12, amount: -sip });
  flows.push({ t: N / 12, amount: finalValue });
  return xirr(flows);
}

/* =====================================================================
 * 1a. SINGLE-PATH ("LIVE IT") — a real, named crash at the exact midpoint.
 * ===================================================================== */

/**
 * NAV (price-per-unit) series for one plan around one event.
 * Starts at 100, grows at `rate` each calm month; at the event start S the
 * price glides DOWN to (1-depth)·peak over `fallMonths`, then a recovery RALLY
 * climbs from the trough back to the PRE-CRASH PEAK level over `recoveryMonths`
 * (as real crashes do — they regain the prior high, not the imaginary "no-crash
 * trend"), then resumes normal trend growth FROM that peak. The market therefore
 * sits permanently a little below where an uninterrupted trend would have put it
 * — the growth the round-trip consumed. Geometric within each phase.
 */
function buildEventNav(rate, N, ev, S) {
  const fall = ev.fallMonths, rec = ev.recoveryMonths;
  const bottom = S + fall, healed = S + fall + rec;
  const nav = new Array(N + 1);
  nav[0] = 100;
  for (let t = 1; t <= N; t++) {
    if (t <= S)            nav[t] = nav[t - 1] * (1 + rate);
    else if (t <= bottom)  nav[t] = nav[S] * Math.pow(1 - ev.depth, (t - S) / fall);
    else if (t <= healed) {
      const start = nav[S] * (1 - ev.depth);
      const target = nav[S]; // recovery returns to the PRE-CRASH PEAK, not the trend
      nav[t] = start * Math.pow(target / start, (t - bottom) / rec);
    } else                 nav[t] = nav[t - 1] * (1 + rate);
  }
  nav._S = S; nav._bottom = bottom; nav._healed = healed;
  return nav;
}

/** No-crash control (pure trend) — proves staying invested through a crash
 *  ends SLIGHTLY RICHER than a calm market (cheap units below trend). */
function buildTrendNav(rate, N) {
  const nav = new Array(N + 1);
  nav[0] = 100;
  for (let t = 1; t <= N; t++) nav[t] = nav[t - 1] * (1 + rate);
  return nav;
}

function summarise(value, sip, N) {
  const final = value[N];
  return { value, final, invested: sip * N, xirr: xirrFromSIP(sip, N, final) };
}

/* ---- The four behaviours (unit accounting; same total invested everywhere). */
function simHold(nav, N, sip) {
  let units = 0; const value = new Array(N + 1);
  for (let m = 0; m <= N; m++) { if (m < N) units += sip / nav[m]; value[m] = units * nav[m]; }
  return summarise(value, sip, N);
}
function simPause(nav, N, sip) {
  // Realistic fear: a paused investor does NOT restart the instant the market
  // heals — confidence returns roughly a year after it has clearly recovered.
  // We stop contributions from the crash start until then (units are kept), and
  // report the exact pause length so the behaviour is fully auditable.
  const S = nav._S;
  const reentry = Math.min(N, nav._healed + 12);
  let units = 0, cash = 0; const value = new Array(N + 1);
  for (let m = 0; m <= N; m++) {
    if (m < N) {
      if (m < S)              units += sip / nav[m];
      else if (m < reentry)   cash += sip;
      else if (m === reentry) { cash += sip; units += cash / nav[m]; cash = 0; }
      else                    units += sip / nav[m];
    }
    value[m] = units * nav[m] + cash;
  }
  const res = summarise(value, sip, N);
  res.pauseMonths = reentry - S;   // how long contributions stayed frozen
  return res;
}
function simSell(nav, N, sip, reentry) {
  const bottom = nav._bottom;
  let units = 0, cash = 0; const value = new Array(N + 1);
  for (let m = 0; m <= N; m++) {
    if (m < N) {
      if (m < bottom)         units += sip / nav[m];
      else if (m === bottom)  { cash += units * nav[m]; units = 0; cash += sip; }
      else if (m < reentry)   cash += sip;
      else if (m === reentry) { cash += sip; units += cash / nav[m]; cash = 0; }
      else                    units += sip / nav[m];
    }
    value[m] = units * nav[m] + cash;
  }
  return summarise(value, sip, N);
}
function peakRegainMonth(nav) {
  const peak = nav[nav._S];
  for (let m = nav._bottom; m < nav.length; m++) if (nav[m] >= peak) return m;
  return nav._healed;
}

/** Full single-path run. Named events crash at the EXACT midpoint; the 'drawn'
 *  crash gets random depth/duration AND random timing (you never know when). */
function runSinglePath(sip, eventId, years) {
  const Y = years || DEFAULT_YEARS;
  const N = Y * 12;
  let ev, S;
  if (eventId === 'drawn') {
    ev = drawCrash();
    const span = ev.fallMonths + ev.recoveryMonths;
    const earliest = 36, latest = Math.max(earliest, N - span - 12);
    S = earliest + Math.floor(Math.random() * Math.max(1, latest - earliest));
  } else {
    ev = EVENTS[eventId] || EVENTS.covid;
    S = Math.round(N / 2);   // standardized: midpoint
  }
  const navDirect  = buildEventNav(DIRECT_MONTHLY,  N, ev, S);
  const navRegular = buildEventNav(REGULAR_MONTHLY, N, ev, S);
  const reD = peakRegainMonth(navDirect),  reR = peakRegainMonth(navRegular);
  const waitD = navDirect._healed + 12,    waitR = navRegular._healed + 12;

  const behave = (nav, re, wait) => ({
    hold: simHold(nav, N, sip), pause: simPause(nav, N, sip),
    sellBack: simSell(nav, N, sip, re), sellWait: simSell(nav, N, sip, wait),
  });
  const direct = behave(navDirect, reD, waitD);
  const regular = behave(navRegular, reR, waitR);

  const feeSavingRupees = direct.hold.final - regular.hold.final; // structural fee edge
  const directNoCrash = simHold(buildTrendNav(DIRECT_MONTHLY, N), N, sip).final;
  // Index CAGR (the market itself) — a little under 12% for Direct, because the
  // crash regains the prior peak (not the trend), leaving a permanent gap.
  const indexCagr = cagr(navDirect[0], navDirect[N], Y);

  return {
    mode: 'single', ev, sip, years: Y, N, S, crashYear: S / 12,
    navDirect, navRegular, direct, regular,
    feeSavingRupees, directNoCrash, indexCagr,
  };
}

/* =====================================================================
 * 1b. MONTE CARLO ("WAS IT LUCK?") — keep the rigorous engine; the UI shows
 *     one plain line + a 100-dot grid, no jargon.
 * ===================================================================== */
function genMarketReturns(N, rng) {
  const muM = Math.pow(1 + 0.137, 1 / 12) - 1; // base drift; stress drag pulls realised mean to ≈12%
  const r = new Array(N);
  let stress = false;
  for (let m = 0; m < N; m++) {
    if (stress) { if (rng() < 0.18) stress = false; }
    else        { if (rng() < 0.03) stress = true; }
    const volAnnual = stress ? 0.30 : 0.12;
    const volM = volAnnual / Math.sqrt(12);
    let z = gaussian(rng);
    if (rng() < 0.02) z *= 2.0;                  // fat tail
    let ret = muM + volM * z;
    if (stress) ret -= 0.010;                    // crashes carry negative drift
    r[m] = ret;
  }
  return r;
}
/** Direct path -> NAV; `feeFactor` (≤1) applies the Regular fee multiplicatively. */
function navFromReturns(returns, N, feeFactor) {
  const f = feeFactor == null ? 1 : feeFactor;
  const nav = new Array(N + 1); nav[0] = 100;
  for (let m = 1; m <= N; m++) nav[m] = nav[m - 1] * (1 + returns[m - 1]) * f;
  return nav;
}
const MC_POLICIES = {
  hold:     { id: 'hold',     label: 'held through everything' },
  panic:    { id: 'panic',    label: 'sold when it fell hard', drawdown: 0.25 },
  sell:     { id: 'sell',     label: 'sold, then bought back', drawdown: 0.25 },
  pause:    { id: 'pause',    label: 'paused the SIP',         drawdown: 0.25 },
  sellWait: { id: 'sellWait', label: 'sold and waited a year', drawdown: 0.25, waitMonths: 12 },
};
function simPolicyPath(nav, N, sip, policy, skipXirr, rng, rec) {
  // Behavioural policies across a random market path (real unit accounting):
  //   hold      — always invested.
  //   panic/sell — sell to cash on a drawdown > threshold; re-enter at prior peak.
  //   pause     — keep units but stop contributing on the drawdown; resume (and
  //               deploy the cash piled up) once the price regains the peak.
  //   sellWait  — sell on the drawdown, then re-enter:
  //               · with an `rng` — at an ERRATIC, mostly-late time (realistic
  //                 panic: most return within ~2y, some capitulate for years, a
  //                 few jump back while still down). This dispersion is exactly
  //                 what makes a panic life LESS CERTAIN — a wider mountain.
  //               · without — a fixed year after the price regains the old peak.
  let units = 0, cash = 0, peak = nav[0], st = 'in', reentryAt = -1;
  const id = policy.id, thr = policy.drawdown || 0, wait = policy.waitMonths || 12;
  for (let m = 0; m < N; m++) {
    if (nav[m] > peak) peak = nav[m];
    const dd = 1 - nav[m] / peak;
    if (id === 'panic' || id === 'sell') {
      if (st === 'in' && dd > thr) { cash += units * nav[m]; units = 0; st = 'out'; }
      else if (st === 'out' && nav[m] >= peak) { units += cash / nav[m]; cash = 0; st = 'in'; }
    } else if (id === 'pause') {
      if (st === 'in' && dd > thr) st = 'paused';
      else if (st === 'paused' && nav[m] >= peak) { units += cash / nav[m]; cash = 0; st = 'in'; }
    } else if (id === 'sellWait') {
      if (st === 'in' && dd > thr) {
        cash += units * nav[m]; units = 0; st = 'out';
        if (rng) { let D = 3 + Math.floor(rng() * 18); if (rng() < 0.15) D += 18 + Math.floor(rng() * 30); reentryAt = m + D; }
        else reentryAt = -1;
      } else if (st === 'out') {
        if (rng) { if (m >= reentryAt) { units += cash / nav[m]; cash = 0; st = 'in'; } }
        else { if (reentryAt < 0 && nav[m] >= peak) reentryAt = m + wait; if (reentryAt >= 0 && m >= reentryAt) { units += cash / nav[m]; cash = 0; st = 'in'; } }
      }
    }
    if (st === 'out' || st === 'paused') cash += sip; else units += sip / nav[m];
    if (rec) rec.push(units * nav[m] + cash); // monthly portfolio value, for replay
  }
  const final = units * nav[N] + cash;
  if (rec) rec.push(final);
  return { final, xirr: skipXirr ? 0 : xirrFromSIP(sip, N, final) };
}
function runMonteCarlo(sip, youPolicy, friendPolicy, nPaths, seed, years, light) {
  const N = (years || DEFAULT_YEARS) * 12;
  const rng = mulberry32(seed == null ? 12345 : seed);
  const youP = MC_POLICIES[youPolicy] || MC_POLICIES.hold;
  const friendP = MC_POLICIES[friendPolicy] || MC_POLICIES.hold;
  let youAhead = 0, friendAhead = 0, tied = 0;
  const youFinals = new Float64Array(nPaths), friendFinals = new Float64Array(nPaths);
  for (let i = 0; i < nPaths; i++) {
    const returns = genMarketReturns(N, rng);
    const navD = navFromReturns(returns, N, 1);            // YOU = Direct
    const navR = navFromReturns(returns, N, FEE_FACTOR);   // FRIEND = Regular (1%/yr drag)
    const you = simPolicyPath(navD, N, sip, youP, light);
    const fr = simPolicyPath(navR, N, sip, friendP, light);
    youFinals[i] = you.final; friendFinals[i] = fr.final;
    const rel = Math.abs(you.final - fr.final) / Math.max(you.final, fr.final);
    if (rel < 0.01) tied++; else if (you.final > fr.final) youAhead++; else friendAhead++;
  }
  return { mode: 'monte', sip, nPaths, youPolicy: youP, friendPolicy: friendP,
    you: distribution(youFinals), friend: distribution(friendFinals), youAhead, friendAhead, tied };
}
function distribution(finals) {
  const sorted = Float64Array.from(finals).sort();
  const n = sorted.length, q = (p) => sorted[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
  return { n, min: sorted[0], max: sorted[n - 1], p05: q(0.05), p10: q(0.10), p25: q(0.25),
    p50: q(0.50), p75: q(0.75), p90: q(0.90), p95: q(0.95), mean: sorted.reduce((s, v) => s + v, 0) / n };
}
// "Ten thousand lifetimes." The SAME investor, lived nPaths times over the SAME
// markets — once CALM (held through every crash), once PANICKED (sold in the
// fall, re-entered a year after recovery). Both on the SAME door (Direct), so
// the only thing that changes is behaviour — the crowd, not the door. We also
// measure the door's pure effect (calm-Direct vs calm-Regular, the whole fee)
// so the closing truth — behaviour moves everything, the door moves a little —
// is counted, never asserted. Returns full distributions + a representative
// sample of lives for the spray visual. Nothing here is fabricated.
// Each path is seeded INDEPENDENTLY from (base, i) — two streams per path, one
// for the market, one for the panic-seller's erratic re-entry — so any single
// life is fully reproducible from its index alone (needed to replay the
// "cruelest life" frame-by-frame later). Statistically identical to a single
// stream; it just lets us rewind to one specific future.
function lifeRngs(base, i) { return { m: mulberry32(base + i * 2 + 1), p: mulberry32(base + i * 2 + 2) }; }
function runLifetimes(sip, years, seed, nPaths, sampleN) {
  const N = (years || DEFAULT_YEARS) * 12, base = seed == null ? 4242 : seed;
  const calmP = MC_POLICIES.hold, panicP = MC_POLICIES.sellWait;
  const calm = new Float64Array(nPaths), panic = new Float64Array(nPaths);
  let calmAhead = 0, tied = 0, calmDirectSum = 0, calmRegularSum = 0;
  const sample = [], step = Math.max(1, Math.floor(nPaths / (sampleN || 1800)));
  // The cruelest life to SHOW: the unluckiest market (lowest calm outcome) in
  // which staying calm STILL pulled you through — calm ends above what you put
  // in AND clearly above panic. (The absolute-worst markets never recover and
  // ruin everyone equally; those don't teach the lesson, so we don't pretend
  // they do.) A max-gap fallback guarantees a pick.
  const invested = sip * N;
  let worstIdx = 0, worstCalm = Infinity, gapIdx = 0, maxGap = -Infinity;
  for (let i = 0; i < nPaths; i++) {
    const rg = lifeRngs(base, i);
    const returns = genMarketReturns(N, rg.m);
    const navD = navFromReturns(returns, N, 1);          // YOU — Direct
    const navR = navFromReturns(returns, N, FEE_FACTOR); // the other door — Regular (1%/yr drag)
    const c = simPolicyPath(navD, N, sip, calmP, true).final;         // calm you (held)
    const p = simPolicyPath(navD, N, sip, panicP, true, rg.p).final;  // panic you (sold; erratic re-entry)
    const cr = simPolicyPath(navR, N, sip, calmP, true).final;        // calm you, the OTHER door
    calm[i] = c; panic[i] = p; calmDirectSum += c; calmRegularSum += cr;
    const rel = Math.abs(c - p) / Math.max(c, p);
    if (rel < 0.005) tied++; else if (c > p) calmAhead++;
    if (c > invested * 1.25 && p < invested && c < worstCalm) { worstCalm = c; worstIdx = i; }
    if (c - p > maxGap) { maxGap = c - p; gapIdx = i; }
    if (i % step === 0) sample.push([c, p]);
  }
  if (worstCalm === Infinity) worstIdx = gapIdx; // no "survived" life found — fall back to the costliest panic
  const dc = distribution(calm), dp = distribution(panic);
  return {
    nPaths, years, seed: base, invested: sip * N, sample, worstIdx,
    calmAhead, tied, panicAhead: nPaths - calmAhead - tied,
    calm: dc, panic: dp,
    doorGap: (calmDirectSum - calmRegularSum) / nPaths, // the door (fee), averaged
    crowdGap: dc.p50 - dp.p50,                          // the crowd (behaviour), median
  };
}
// Replay a single life (by index) month by month — the value series for the
// calm twin and the panic twin on the SAME market. Reproduces exactly the
// finals counted in runLifetimes (same per-path seeds, same call order).
function buildWorstLife(sip, years, seed, idx) {
  const N = (years || DEFAULT_YEARS) * 12, base = seed == null ? 4242 : seed, rg = lifeRngs(base, idx);
  const returns = genMarketReturns(N, rg.m), navD = navFromReturns(returns, N, 1);
  const calmSeries = [], panicSeries = [];
  const calmFinal = simPolicyPath(navD, N, sip, MC_POLICIES.hold, true, null, calmSeries).final;
  const panicFinal = simPolicyPath(navD, N, sip, MC_POLICIES.sellWait, true, rg.p, panicSeries).final;
  return { N, invested: sip * N, calmSeries, panicSeries, calmFinal, panicFinal };
}

/* =====================================================================
 * 1c. SCENARIO B — "The money, now." (the emergency)
 * ---------------------------------------------------------------------
 * A portfolio across a liquid sleeve, large-cap and mid/small-cap; an
 * emergency of a user-chosen SEVERITY strikes at the midpoint. FOUR responses:
 *   panic      — redeem everything (idle cash; SIP dies)
 *   surgical   — take exactly the need, safest sleeve first, pause SIP 3 mo
 *   sellLosers — take the need from the fallen sleeve first (locks the loss)
 *   sipKill    — take the need safely, but cancel the SIP forever
 * Either door can make any call. Effective sleeve returns are assumptions
 * (6% / 12% / 15% CAGR); every rupee is computed.
 * ===================================================================== */
const EMERGENCIES = {
  icu:      { id: 'icu',      name: 'Hospitalisation / ICU',         crashLinked: false,
              what: 'A family member is in intensive care; the hospital needs a large deposit before treatment continues.' },
  business: { id: 'business', name: 'Business loss',                 crashLinked: false,
              what: 'A deal collapses; suppliers and salaries must be paid this month or the business unwinds.' },
  pandemic: { id: 'pandemic', name: 'Pandemic — COVID',              crashLinked: true,
              what: 'A pandemic stops your income and lands a hospital bill — while the market is crashing at the same time.' },
  war:      { id: 'war',      name: 'War (Iran–USA / India–Pakistan)', crashLinked: true,
              what: 'Conflict erupts; you need cash for family and safety in the exact week markets gap down.' },
};
// Severity = fraction of the corpus the emergency demands (user choice).
const SEVERITY = {
  minor:  { id: 'minor',  label: 'Manageable',  fraction: 0.30 },
  major:  { id: 'major',  label: 'Serious',     fraction: 0.55 },
  severe: { id: 'severe', label: 'Devastating', fraction: 0.80 },
};
const SLEEVES = {
  liquid:   { label: 'Liquid fund',   weight: 0.15, annual: 0.06 },
  largeCap: { label: 'Large-cap',     weight: 0.50, annual: 0.12 },
  midSmall: { label: 'Mid / small-cap', weight: 0.35, annual: 0.15 },
};
const SAVINGS_ANNUAL = 0.04; // where panic-redeemed cash realistically sits (a bank/FD)
const EM_RESPONSES = {
  panic:      { sellAll: true,  killSIP: true,  pauseMonths: 0, order: ['liquid', 'largeCap', 'midSmall'] },
  surgical:   { sellAll: false, killSIP: false, pauseMonths: 3, order: ['liquid', 'largeCap', 'midSmall'] },
  sellLosers: { sellAll: false, killSIP: false, pauseMonths: 0, order: ['midSmall', 'largeCap', 'liquid'] },
  sipKill:    { sellAll: false, killSIP: true,  pauseMonths: 0, order: ['liquid', 'largeCap', 'midSmall'] },
};

function simEmergency(sip, feeFactor, response, need, S, downturn, N) {
  const ff = feeFactor == null ? 1 : feeFactor;
  // Per-sleeve NAVs (effective-annual growth; fee applied multiplicatively).
  const navs = {};
  for (const key in SLEEVES) {
    const s = SLEEVES[key];
    const mRate = Math.pow(1 + s.annual, 1 / 12) - 1;
    const nav = new Array(N + 1); nav[0] = 100;
    const isEquity = key !== 'liquid';
    const depth = key === 'midSmall' ? 0.30 : key === 'largeCap' ? 0.20 : 0;
    const bottom = S, fall = 6, recover = 12, start = bottom - fall;
    for (let t = 1; t <= N; t++) {
      if (!downturn || !isEquity) { nav[t] = nav[t - 1] * (1 + mRate) * ff; continue; }
      if (t <= start)            nav[t] = nav[t - 1] * (1 + mRate) * ff;
      else if (t <= bottom)      nav[t] = nav[start] * Math.pow(1 - depth, (t - start) / fall);
      else if (t <= bottom + recover) {
        const lo = nav[start] * (1 - depth);
        const target = nav[start] * Math.pow((1 + mRate) * ff, fall + recover);
        nav[t] = lo * Math.pow(target / lo, (t - bottom) / recover);
      } else nav[t] = nav[t - 1] * (1 + mRate) * ff;
    }
    navs[key] = nav;
  }
  const units = { liquid: 0, largeCap: 0, midSmall: 0 };
  const value = new Array(N + 1);
  const sumU = (m) => units.liquid * navs.liquid[m] + units.largeCap * navs.largeCap[m] + units.midSmall * navs.midSmall[m];
  const flows = [];
  // Phase 1 — accumulate up to the emergency month, recording the value path.
  for (let m = 0; m <= S; m++) {
    if (m < N) { for (const k in SLEEVES) units[k] += (sip * SLEEVES[k].weight) / navs[k][m]; flows.push({ t: m / 12, amount: -sip }); }
    value[m] = sumU(m);
  }
  const corpusAtEmergency = value[S];
  const sleeveValues = { liquid: units.liquid * navs.liquid[S], largeCap: units.largeCap * navs.largeCap[S], midSmall: units.midSmall * navs.midSmall[S] };

  const cfg = EM_RESPONSES[response] || EM_RESPONSES.surgical;
  let took = 0, idleCash = 0, shortfall = 0, fromMid = 0, fromLiquid = 0;
  if (cfg.sellAll) {
    took = corpusAtEmergency; idleCash = Math.max(corpusAtEmergency - need, 0);
    fromLiquid = sleeveValues.liquid; fromMid = sleeveValues.midSmall;
    for (const k in units) units[k] = 0;
  } else {
    let remaining = need;
    for (const sleeve of cfg.order) {
      if (remaining <= 0) break;
      const avail = units[sleeve] * navs[sleeve][S];
      const draw = Math.min(avail, remaining);
      if (sleeve === 'midSmall') fromMid += draw;
      if (sleeve === 'liquid') fromLiquid += draw;
      units[sleeve] -= draw / navs[sleeve][S];
      remaining -= draw;
    }
    took = need - Math.max(remaining, 0);
    shortfall = Math.max(remaining, 0); // emergency exceeded the whole portfolio
  }
  const resumeMonth = cfg.killSIP ? Infinity : S + 1 + cfg.pauseMonths;
  // Phase 2 — the years after; panic-redeemed cash sits in a bank/FD at 4%/yr.
  for (let m = S + 1; m <= N; m++) {
    if (m < N && m >= resumeMonth) { for (const k in SLEEVES) units[k] += (sip * SLEEVES[k].weight) / navs[k][m]; flows.push({ t: m / 12, amount: -sip }); }
    value[m] = sumU(m) + idleCash * Math.pow(1 + SAVINGS_ANNUAL, (m - S) / 12);
  }
  const idleGrown = idleCash * Math.pow(1 + SAVINGS_ANNUAL, (N - S) / 12);
  const final = value[N];
  flows.push({ t: S / 12, amount: took });
  flows.push({ t: N / 12, amount: final });
  return { response, value, corpusAtEmergency, sleeveValues, took, need, shortfall, fromMid, fromLiquid, final,
    sipSurvived: !cfg.killSIP, idleCash, idleGrown, xirr: xirr(flows) };
}

function runEmergency(sip, emergencyId, youResponse, downturn, years, severityId) {
  const em = EMERGENCIES[emergencyId] || EMERGENCIES.icu;
  const sev = SEVERITY[severityId] || SEVERITY.major;
  const Y = years || DEFAULT_YEARS, N = Y * 12, S = Math.round(N / 2);
  const hard = downturn || em.crashLinked;
  const probe = simEmergency(sip, 1, 'panic', 0, S, false, N);
  const need = Math.max(100000, Math.round(sev.fraction * probe.corpusAtEmergency / 1e5) * 1e5);
  const you = youResponse ? simEmergency(sip, 1, youResponse, need, S, hard, N) : null;
  const friend = simEmergency(sip, FEE_FACTOR, 'surgical', need, S, hard, N);
  const directSmart = simEmergency(sip, 1, 'surgical', need, S, hard, N);
  return { mode: 'emergency', em, sev, sip, years: Y, N, S, crashYear: S / 12,
    downturn: hard, need, youResponse, you, friend, directSmart };
}

/* ---- Node export for the test harness; harmless in the browser. ---- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIRECT_ANNUAL, REGULAR_ANNUAL, DIRECT_MONTHLY, REGULAR_MONTHLY, FEE_FACTOR, DEFAULT_YEARS, EVENTS,
    drawCrash, cagr, xirr, xirrFromSIP, buildEventNav, buildTrendNav,
    simHold, simPause, simSell, peakRegainMonth, runSinglePath,
    genMarketReturns, navFromReturns, simPolicyPath, runMonteCarlo, runLifetimes, buildWorstLife, distribution,
    EMERGENCIES, SEVERITY, EM_RESPONSES, SLEEVES, simEmergency, runEmergency, MC_POLICIES,
  };
}

/* =====================================================================
 * 2. THE EXPERIENCE  (browser only)
 * ---------------------------------------------------------------------
 * Centrepiece: COMMIT → COLLIDE. You swear what you'll do while calm; you
 * live the crash; then you're shown the gap between your promise and your
 * panic. One decision per screen. Heavy beats hold until you tap.
 * ===================================================================== */
if (typeof document !== 'undefined') (function () {
  'use strict';

  function inr(v) {
    const n = Math.round(v), s = Math.abs(n).toString();
    let last3 = s.slice(-3), rest = s.slice(0, -3);
    if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return '₹' + (n < 0 ? '-' : '') + (rest ? rest + ',' + last3 : last3);
  }
  function inrShort(v) {
    if (Math.abs(v) >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr';
    if (Math.abs(v) >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' L';
    return inr(v);
  }
  const pct = (r) => (r * 100).toFixed(1) + '%';
  // Spoken rupees in Indian words — "5 lakh 33 thousand rupees", never "5 point 33".
  function amountWords(v) {
    v = Math.round(Math.abs(v));
    if (v === 0) return 'zero rupees';
    const cr = Math.floor(v / 1e7); v %= 1e7;
    const lakh = Math.floor(v / 1e5); v %= 1e5;
    const th = Math.floor(v / 1e3); v %= 1e3;
    const parts = [];
    if (cr) parts.push(cr + ' crore');
    if (lakh) parts.push(lakh + ' lakh');
    if (th) parts.push(th + ' thousand');
    if (v) parts.push(String(v));
    return parts.join(' ') + ' rupees';
  }
  // Speak text with finance terms pronounced correctly (SIP -> the full phrase).
  function say(text, opts) { Voice.speak(text.replace(/\bSIP\b/g, 'systematic investment plan'), opts); }
  // A live, ticking call timer (mm:ss) for the "real phone call" feel.
  function startCallTimer(id) {
    const el = $(id); if (!el) return;
    let s = 0; el.textContent = '00:00';
    if (state._callTimer) clearInterval(state._callTimer);
    state._callTimer = setInterval(() => { s++; el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 1000);
  }
  function stopCallTimer() { if (state._callTimer) { clearInterval(state._callTimer); state._callTimer = 0; } }
  // Narrate AND lock interaction until it finishes — released on the first of
  // {onend, onerror, timeout, mute, no-voice}, so it can never dead-end.
  function narrate(text, opts, onDone) {
    const spoken = text.replace(/\bSIP\b/g, 'systematic investment plan');
    if (!Voice.available || !Voice.isEnabled()) { if (onDone) onDone(); return; }
    document.body.classList.add('narrating');
    let done = false;
    const finish = () => { if (done) return; done = true; document.body.classList.remove('narrating'); if (onDone) onDone(); };
    const speakLive = () => {
      Voice.speak(spoken, opts, finish);
      // Safety release — never let a stalled/again silent speech engine keep the
      // screen locked. Caps well below any real narration's length.
      setTimeout(finish, Math.min(8000, 1400 + spoken.split(' ').length * 300));
    };
    // A recorded clip (instant + identically-timed on every device) when opts.clip
    // is given; if it is missing/blocked we fall back to the live voice, so this
    // can never dead-end.
    const clipSrc = opts && opts.clip;
    if (clipSrc) {
      let started = false, fell = false;
      const fallback = () => { if (started || fell || done) return; fell = true; speakLive(); };
      try {
        const a = new Audio(clipSrc); a.preload = 'auto';
        a.addEventListener('playing', () => { started = true; });
        a.addEventListener('ended', finish);
        a.addEventListener('error', fallback);
        const pr = a.play(); if (pr && pr.catch) pr.catch(fallback);
        setTimeout(fallback, 600);        // clip never started → live voice
        setTimeout(finish, 16000);        // absolute backstop if 'ended' never fires
      } catch (e) { speakLive(); }
      return;
    }
    speakLive();
  }
  // Reveal a quote word-by-word, as if spoken live on the call.
  function revealQuote(id, text, startMs, perWord) {
    const el = $(id); if (!el) return;
    const words = text.split(' ');
    el.innerHTML = words.map((w) => '<span class="rw">' + w + '</span>').join(' ');
    const spans = el.querySelectorAll('.rw');
    if (reduceMotion) { spans.forEach((s) => s.classList.add('on')); return; }
    spans.forEach((s, i) => setTimeout(() => s.classList.add('on'), (startMs || 0) + i * (perWord || 160)));
  }
  // A realistic relationship-manager response: behavioural coaching that also
  // takes a genuine cash need seriously (not just "never sell").
  const RM_CRASH_LINE = "Don't sell in fear; the market recovers. If you genuinely need money, we plan it — the right amount, the right fund, calmly.";
  const RM_EM_LINE = "We withdraw strategically — exactly what you need, from the right place — so one hard week never costs your future.";
  // Make a rupee figure personal & exact: express it in the user's own SIP.
  function sipSpan(rupees) {
    const months = Math.abs(rupees) / state.sip, yrs = months / 12;
    return yrs >= 1 ? yrs.toFixed(1) + ' years of your SIP' : Math.round(months) + ' months of your SIP';
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false; requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 300); }, 2600);
  }
  function doShare(text) {
    const url = location.href.split('#')[0];
    if (navigator.share) { navigator.share({ title: 'Two Doors, One Storm', text: text, url: url }).catch(() => {}); }
    else if (navigator.clipboard) { navigator.clipboard.writeText(text + '\n\n' + url).then(() => toast('Copied — send it to a friend'), () => toast(text)); }
    else toast(text);
  }
  /* ---- Shareable result IMAGE — what actually travels (a screenshot, not a
   * link). Renders a premium 1080×1350 card on an offscreen canvas. ---- */
  const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
  function wrapText(c, text, x, y, maxW, lineH) {
    const words = text.split(' '); let line = '', yy = y;
    for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (c.measureText(t).width > maxW && line) { c.fillText(line, x, yy); line = wd; yy += lineH; } else line = t; }
    if (line) c.fillText(line, x, yy); return yy;
  }
  function chartToImage(cw, ch, lines, band, N, yMax) {
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    drawLines(cv.getContext('2d'), cw, ch, N, yMax, lines, N, { l: 12, r: 12, t: 16, b: 16 }, band, {});
    return cv;
  }
  function renderShareCard(cfg) {
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0e1622'); g.addColorStop(0.6, '#07090f'); g.addColorStop(1, '#05070b'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    const rg = c.createRadialGradient(W / 2, H * 0.42, 180, W / 2, H * 0.5, H * 0.72); rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.55)'); c.fillStyle = rg; c.fillRect(0, 0, W, H);
    c.textAlign = 'center';
    c.fillStyle = '#c4cdd9'; c.font = '600 26px ' + SANS; if ('letterSpacing' in c) c.letterSpacing = '4px';
    c.fillText(cfg.kicker.toUpperCase(), W / 2, 116); if ('letterSpacing' in c) c.letterSpacing = '0px';
    c.fillStyle = '#fff'; c.font = '800 58px ' + SANS; c.fillText('Two Doors, One Storm', W / 2, 192);
    c.fillStyle = '#9aa7b8'; c.font = '400 30px ' + SANS; c.fillText(cfg.sub, W / 2, 250);
    // Journey chart.
    const chW = W - 180, chH = 400, chartImg = chartToImage(chW, chH, cfg.lines, cfg.band, cfg.N, cfg.yMax);
    c.drawImage(chartImg, 90, 300);
    // Two numbers.
    const ry = 800, lx = W * 0.28, rx = W * 0.72;
    c.font = '800 26px ' + SANS; if ('letterSpacing' in c) c.letterSpacing = '1px';
    c.fillStyle = cfg.you.color; c.fillText(cfg.you.label, lx, ry);
    c.fillStyle = cfg.friend.color; c.fillText(cfg.friend.label, rx, ry);
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    c.font = '700 62px ' + MONO;
    c.fillStyle = cfg.you.color; c.fillText(cfg.you.val, lx, ry + 78);
    c.fillStyle = cfg.friend.color; c.fillText(cfg.friend.val, rx, ry + 78);
    c.fillStyle = cfg.gapColor; c.font = '700 38px ' + SANS; c.fillText(cfg.gapText, W / 2, ry + 175);
    c.fillStyle = '#eef2f8'; c.font = '400 34px ' + SANS; wrapText(c, cfg.punch, W / 2, ry + 250, W - 200, 48);
    c.fillStyle = '#7e93d4'; c.font = '700 26px ' + SANS; c.fillText('Live it yourself → tishabsatwani-del.github.io/Mutual_Fund', W / 2, H - 110);
    c.fillStyle = '#5a6675'; c.font = '400 22px ' + SANS; c.fillText('Educational tool — not investment advice.', W / 2, H - 64);
    return cv;
  }
  function shareImage(canvas, text) {
    const url = location.href.split('#')[0];
    if (!canvas.toBlob) { doShare(text); return; }
    canvas.toBlob((blob) => {
      if (!blob) { doShare(text); return; }
      const file = new File([blob], 'two-doors-one-storm.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], text: text, url: url }).catch(() => {});
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'two-doors-one-storm.png'; document.body.appendChild(a); a.click(); a.remove();
        toast('Image saved — share it anywhere');
      }
    }, 'image/png');
  }

  const $ = (id) => document.getElementById(id);
  const show = (el) => { if (!el) return; el.hidden = false; requestAnimationFrame(() => el.classList.add('show')); };
  const hide = (el) => { if (!el) return; el.classList.remove('show'); el.hidden = true; };
  const setHTML = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
  const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const easeInOut = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  // The fall starts slow (dread builds), then accelerates — a crash you feel, not a blink.
  const easeInCrash = (p) => p * p * (2.2 - 1.2 * p);
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COL = { direct: '#34d399', regular: '#e8b257', crash: '#f37070', cool: '#7e93d4', ghost: '#cbb26b',
    pause: '#5b9cf0', sellBack: '#a78bfa', sellWait: '#f37070' };
  const BEHAVIOURS = {
    hold:     { label: 'Held',              short: 'hold',            color: COL.direct },
    pause:    { label: 'Paused the SIP',    short: 'pause the SIP',   color: COL.pause },
    sellBack: { label: 'Sold, bought back', short: 'sell',            color: COL.sellBack },
    sellWait: { label: 'Sold and waited',   short: 'sell everything', color: COL.sellWait },
  };
  const CHOICE_CAT = { hold: 'hold', pause: 'pause', sellBack: 'sell', sellWait: 'sell' };
  const PLEDGE_LABEL = { hold: 'hold', pause: 'pause the SIP', sell: 'sell' };
  const EM_LABEL = { panic: 'redeemed everything', surgical: 'took only what you needed',
    sellLosers: 'sold the fallen fund', sipKill: 'stopped the SIP' };

  /* ===================== PROCEDURAL AUDIO =====================
   * Every sound is synthesised live with the Web Audio API — no files, no CDN,
   * fully offline. Calm pad on the climb; a low rumble that swells through the
   * fall; an impact at the bottom; then the cut to silence with a lone, racing
   * heartbeat that slows the moment the friend's call lands; a phone ring; warm
   * tones to resolve. Gated behind a user gesture (autoplay-safe) and mutable. */
  const Sound = (function () {
    let ctx = null, master = null, on = true;
    let pad = null, rumble = null, heartTimer = 0, heartBpm = 0;
    function init() {
      if (ctx) return true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = on ? 0.95 : 0; master.connect(ctx.destination);
        return true;
      } catch (e) { return false; }
    }
    function unlock() { if (init() && ctx.state === 'suspended') ctx.resume(); }
    const T = () => ctx.currentTime;
    function brown(dur) {
      const len = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      return b;
    }
    function tone(freq, t0, dur, type, peak, atk) {
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + (atk || 0.012));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
      return o;
    }
    function thump(peak) {
      if (!ctx) return;
      const t = T(), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
      g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.36);
    }
    function startPad() {
      if (!init()) return;
      if (pad) { try { pad.gain.cancelScheduledValues(T()); pad.gain.setValueAtTime(Math.max(pad.gain.value || 0.0001, 0.0001), T()); pad.gain.linearRampToValueAtTime(0.05, T() + 2.5); } catch (e) {} return; }
      pad = ctx.createGain(); pad.gain.value = 0.0; pad.connect(master);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.connect(pad);
      [110, 110.5, 164.8].forEach((f) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(lp); o.start(); });
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 0.012;
      lfo.connect(lg); lg.connect(pad.gain); lfo.start();
      pad.gain.linearRampToValueAtTime(0.05, T() + 2.5);
    }
    function startRumble(dur) {
      if (!init()) return;
      stopRumble();
      const secs = dur / 1000, t = T(), srcs = [];
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.95, t + secs * 0.85); g.connect(master);
      // 0) THE BRAAM — a cinematic descending dread-horn cluster (the gut-punch).
      [55, 55.4, 82.5, 110].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + secs);
        const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(160, t); fl.frequency.linearRampToValueAtTime(420, t + secs);
        const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(i === 0 ? 0.26 : 0.16, t + secs * 0.7);
        o.connect(fl); fl.connect(bg); bg.connect(g); o.start(); srcs.push(o);
      });
      // 1) deep ground rumble
      const n1 = ctx.createBufferSource(); n1.buffer = brown(Math.max(2, secs + 1)); n1.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(90, t); lp.frequency.linearRampToValueAtTime(900, t + secs);
      n1.connect(lp); lp.connect(g); n1.start(); srcs.push(n1);
      // 2) a rising roar (band of noise) that climbs toward the impact — "whoosh"
      const n2 = ctx.createBufferSource(); n2.buffer = brown(Math.max(2, secs + 1)); n2.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(240, t); bp.frequency.linearRampToValueAtTime(1400, t + secs); bp.Q.value = 0.7;
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.linearRampToValueAtTime(0.55, t + secs);
      n2.connect(bp); bp.connect(g2); g2.connect(g); n2.start(); srcs.push(n2);
      // 3) a sub that sinks — the floor dropping out
      const sub = ctx.createOscillator(), sg = ctx.createGain(); sub.type = 'sine';
      sub.frequency.setValueAtTime(72, t); sub.frequency.exponentialRampToValueAtTime(26, t + secs);
      sg.gain.value = 0.4; sub.connect(sg); sg.connect(g); sub.start(); srcs.push(sub);
      rumble = { srcs, g };
    }
    function stopRumble() { if (rumble) { try { rumble.g.gain.cancelScheduledValues(T()); rumble.g.gain.linearRampToValueAtTime(0.0001, T() + 0.2); rumble.srcs.forEach((s) => { try { s.stop(T() + 0.25); } catch (e) {} }); } catch (e) {} rumble = null; } }
    function impact() {
      if (!init()) return; thump(1.0); const t = T();
      // Huge sub boom with a long tail.
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(24, t + 0.9);
      g.gain.setValueAtTime(0.85, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.15);
      // A sharp "crack" — broadband noise burst.
      const s = ctx.createBufferSource(); s.buffer = brown(0.5); const ng = ctx.createGain(); ng.gain.setValueAtTime(0.65, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.5);
      s.connect(lp); lp.connect(ng); ng.connect(master); s.start(t); s.stop(t + 0.55);
    }
    // The CRACK — a powerful, authentic hit the instant the market breaks:
    // a glass-like shatter, a gut sub-drop, and a dissonant alarm stab.
    function crashHit() {
      if (!init()) return; const t = T();
      // shatter: bright noise burst sweeping down
      const s = ctx.createBufferSource(); s.buffer = brown(0.7); s.playbackRate.value = 1.4;
      const bp = ctx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(300, t + 0.6);
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0.7, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      s.connect(bp); bp.connect(sg); sg.connect(master); s.start(t); s.stop(t + 0.75);
      // gut sub-drop
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.8);
      g.gain.setValueAtTime(0.95, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.05);
      // dissonant alarm stab (two clashing saws)
      [233, 247].forEach((f) => { const so = ctx.createOscillator(), gg = ctx.createGain(); so.type = 'sawtooth'; so.frequency.value = f; gg.gain.setValueAtTime(0.18, t); gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.9); const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 900; so.connect(fl); fl.connect(gg); gg.connect(master); so.start(t); so.stop(t + 0.95); });
    }
    // A heavy descending thud as each red candle drops — deepens and grows as
    // the crash bottoms out (depth 0..1), so the fall is felt getting worse.
    function crashTick(depth) {
      if (!init()) return; const t = T(), d = Math.max(0, Math.min(1, depth || 0));
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(150 - 60 * d, t); o.frequency.exponentialRampToValueAtTime(40 - 14 * d, t + 0.2 + 0.1 * d);
      g.gain.setValueAtTime(0.45 + 0.4 * d, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34 + 0.18 * d);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.55);
      // a short noise "thump" of impact, louder deeper in
      const s = ctx.createBufferSource(); s.buffer = brown(0.18); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 360 + 200 * (1 - d);
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0.18 + 0.22 * d, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      s.connect(lp); lp.connect(sg); sg.connect(master); s.start(t); s.stop(t + 0.22);
    }
    function setHeart(bpm) {
      heartBpm = bpm;
      if (heartTimer) { clearInterval(heartTimer); heartTimer = 0; }
      if (!bpm || !ctx) return;
      const beat = () => { thump(0.32); setTimeout(() => thump(0.22), 180); };
      beat(); heartTimer = setInterval(beat, 60000 / bpm);
    }
    function stopHeart() { if (heartTimer) clearInterval(heartTimer); heartTimer = 0; heartBpm = 0; }
    function silenceCut() { if (rumble) { try { rumble.g.gain.cancelScheduledValues(T()); rumble.g.gain.linearRampToValueAtTime(0.0001, T() + 0.9); rumble.srcs.forEach((s) => { try { s.stop(T() + 1.0); } catch (e) {} }); } catch (e) {} rumble = null; } if (pad) { try { pad.gain.cancelScheduledValues(T()); pad.gain.linearRampToValueAtTime(0.0001, T() + 0.4); } catch (e) {} } }
    function stopPad() { if (pad) { try { pad.gain.cancelScheduledValues(T()); pad.gain.linearRampToValueAtTime(0.0001, T() + 0.4); } catch (e) {} } }
    function ring() {
      if (!init()) return;
      for (let k = 0; k < 2; k++) { const t = T() + k * 1.0; tone(440, t, 0.4, 'sine', 0.12); tone(480, t, 0.4, 'sine', 0.12); }
    }
    function tick() { if (init()) tone(660, T(), 0.08, 'triangle', 0.08); }
    // A soft, premium UI tap (subtle, high, short).
    function ui() { if (init()) tone(880, T(), 0.045, 'sine', 0.04); }
    // A breathy whoosh for screen transitions.
    function whoosh() {
      if (!init()) return; const t = T();
      const s = ctx.createBufferSource(); s.buffer = brown(0.5); s.playbackRate.value = 1.6;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.32); bp.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.45);
    }
    function freeze() { if (!init()) return; const t = T(); tone(1200, t, 0.5, 'sine', 0.05); const o = tone(300, t, 0.6, 'sine', 0.12); if (o) o.frequency.exponentialRampToValueAtTime(80, t + 0.55); }
    function stinger(low) { if (!init()) return; const t = T(); if (low) { const o = tone(140, t, 0.8, 'sawtooth', 0.18); if (o) o.frequency.exponentialRampToValueAtTime(60, t + 0.7); } else { tone(392, t, 0.7, 'sine', 0.1); tone(523, t, 0.8, 'sine', 0.08); } }
    function resolve() { if (!init()) return; const t = T(); [261.6, 329.6, 392].forEach((f, i) => tone(f, t + i * 0.08, 1.6, 'sine', 0.09, 0.05)); }
    // A premium rising swell for the opening screen.
    function openSwell() { if (!init()) return; const t = T(); [196, 261.6, 329.6, 392, 523.25].forEach((f, i) => tone(f, t + i * 0.13, 2.2, 'sine', 0.05, 0.06)); const o = tone(98, t, 2.4, 'sine', 0.06); if (o) o.frequency.linearRampToValueAtTime(130, t + 2); }
    // The emergency hit — a deep cinematic boom + a tense minor swell (not harsh).
    function strike() { if (!init()) return; thump(0.8); const t = T(); const o = tone(160, t, 1.2, 'sine', 0.16); if (o) o.frequency.exponentialRampToValueAtTime(70, t + 1.1); tone(190, t + 0.04, 1.0, 'triangle', 0.06); const s = ctx.createBufferSource(); s.buffer = brown(0.5); const g = ctx.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; s.connect(lp); lp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.55); }
    // A descending, hollow loss tone for the crash reveal.
    function lossTone() { if (!init()) return; const t = T(); const o = tone(330, t, 1.4, 'sine', 0.1); if (o) o.frequency.exponentialRampToValueAtTime(120, t + 1.2); tone(247, t + 0.1, 1.2, 'sine', 0.06); }
    function stopAll() { stopRumble(); stopHeart(); stopPad(); }
    function toggle() { on = !on; if (master) master.gain.setTargetAtTime(on ? 0.95 : 0, T(), 0.05); return on; }
    function isOn() { return on; }
    return { unlock, startPad, startRumble, stopRumble, impact, crashHit, crashTick, setHeart, stopHeart, silenceCut, stopPad, ring, tick, ui, whoosh, freeze, stinger, resolve, openSwell, strike, lossTone, stopAll, toggle, isOn };
  })();

  /* ---- Voice narration (Web Speech API — uses the device's default voice). ---- */
  const Voice = (function () {
    const ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    let enabled = true, picked = null;
    function pick() {
      if (!ok) return null;
      const vs = window.speechSynthesis.getVoices() || [];
      // Prefer a LOCAL (on-device) English voice — network voices (common for
      // "en-IN" on Android) have a multi-second cold start that makes the opening
      // line arrive late. Local voices speak immediately.
      const byLang = (arr) => arr.find((v) => /en[-_]?IN/i.test(v.lang)) || arr.find((v) => /en[-_]?GB/i.test(v.lang)) || arr.find((v) => /^en/i.test(v.lang));
      const local = vs.filter((v) => v.localService);
      return byLang(local) || byLang(vs) || local[0] || vs[0] || null;
    }
    if (ok) { try { window.speechSynthesis.onvoiceschanged = () => { picked = pick(); }; } catch (e) {} }
    function speak(text, opts, onEnd) {
      if (!ok || !enabled || !text) { if (onEnd) onEnd(); return; }
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (!picked) picked = pick(); if (picked) u.voice = picked;
        u.rate = (opts && opts.rate) || 0.92; u.pitch = (opts && opts.pitch) || 1; u.volume = (opts && opts.volume) || 1;
        if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
        window.speechSynthesis.speak(u);
      } catch (e) { if (onEnd) onEnd(); }
    }
    // Queue several phrases; each fires onStart as IT begins speaking, so the
    // visuals can sync to the actual words. Returns false if it won't speak.
    function speakSequence(parts) {
      if (!ok || !enabled) return false;
      try {
        window.speechSynthesis.cancel();
        if (!picked) picked = pick();
        parts.forEach((p) => {
          const u = new SpeechSynthesisUtterance(p.text);
          if (picked) u.voice = picked;
          u.rate = p.rate || 0.92; u.pitch = 1; u.volume = 1;
          if (p.onStart) u.onstart = p.onStart;
          window.speechSynthesis.speak(u);
        });
        return true;
      } catch (e) { return false; }
    }
    function stop() { if (ok) try { window.speechSynthesis.cancel(); } catch (e) {} }
    // Warm the engine on the first touch so the opening line starts promptly
    // (mobile speech has a cold-start delay on the first utterance).
    let primed = false;
    function prime() { if (!ok || !enabled || primed) return; primed = true; try { window.speechSynthesis.resume(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.rate = 2; window.speechSynthesis.speak(u); } catch (e) {} }
    function setEnabled(b) { enabled = b; if (!b) stop(); }
    function isEnabled() { return enabled; }
    // Speak ONE line and fire marks as the engine actually reaches each word
    // (via onboundary — the only reliable way to sync visuals to speech). Each
    // mark fires once. Returns true if it attempted to speak.
    function speakSynced(text, marks, onEnd) {
      if (!ok || !enabled || !text) { if (onEnd) onEnd(); return false; }
      try {
        // No cancel() here: at the opening nothing is playing, and a cancel→speak
        // sequence delays (sometimes drops) the first utterance on mobile. A
        // resume() guards against an engine that loaded paused.
        try { window.speechSynthesis.resume(); } catch (e) {}
        if (!picked) picked = pick();
        const u = new SpeechSynthesisUtterance(text);
        if (picked) u.voice = picked;
        u.rate = 0.9; u.pitch = 1; u.volume = 1;
        const fired = marks.map(() => false);
        const fire = (i) => { if (!fired[i]) { fired[i] = true; try { marks[i].fn(); } catch (e) {} } };
        u.onboundary = (e) => { for (let i = 0; i < marks.length; i++) if (e.charIndex >= marks[i].at) fire(i); };
        u.onend = u.onerror = () => { for (let i = 0; i < marks.length; i++) fire(i); if (onEnd) onEnd(); };
        window.speechSynthesis.speak(u);
        return true;
      } catch (e) { if (onEnd) onEnd(); return false; }
    }
    return { speak, speakSequence, speakSynced, prime, stop, setEnabled, isEnabled, available: ok };
  })();
  let introSpoken = false;
  function speakIntro() { if (introSpoken) return; introSpoken = true; Voice.speak('What do you want to face? A market crash… or a personal emergency?', { rate: 0.88 }); }

  const state = {
    scenario: 'crash', years: 20, sip: 10000, eventId: 'covid',
    emergencyId: 'icu', severity: 'major', downturn: false,
    pledge: null, choice: null, emResponse: null, emCtx: null, sim: null, luckStep: 0,
    wizIndex: 0, head: 0, phase: 'idle', phaseStart: null, raf: 0, yMax: 1, embers: [],
  };

  /* ===================== Canvas ===================== */
  function fitCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height, c };
  }
  function pointsUpTo(values, head) {
    const pts = [], last = Math.min(Math.floor(head), values.length - 1);
    for (let m = 0; m <= last; m++) pts.push([m, values[m]]);
    if (last < values.length - 1 && head > last) { const f = head - last; pts.push([head, values[last] + (values[last + 1] - values[last]) * f]); }
    return pts;
  }
  function valueAt(values, head) {
    const last = Math.floor(head);
    if (last >= values.length - 1) return values[values.length - 1];
    return values[last] + (values[last + 1] - values[last]) * (head - last);
  }
  function hexFill(hex, a) { const n = parseInt(hex.slice(1), 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  // Realistic market texture — an irregular random walk built once per run
  // (stable across frames, so the line jitters like a real index, not a smooth
  // wave). Visual only: the HUD figure stays the exact computed value.
  let texArr = null;
  function buildTex(N) {
    texArr = new Array(N + 1); let v = 0;
    for (let m = 0; m <= N; m++) { v = v * 0.86 + (Math.random() - 0.5) * 1.5; texArr[m] = Math.max(-2.3, Math.min(2.3, v)); }
  }
  function chartNoise(m) { if (!texArr) return 0; return texArr[Math.min(Math.max(0, Math.round(m)), texArr.length - 1)] || 0; }
  function drawLines(c, w, h, N, yMax, lines, head, pad, band, opts) {
    const p = pad || { l: 18, r: 18, t: 26, b: 24 };
    opts = opts || {};
    const X = (m) => p.l + (m / N) * (w - p.l - p.r);
    const Y = (v) => (h - p.b) - (v / yMax) * (h - p.t - p.b);
    // Plotted Y with optional texture (amplitude scales with value, like real vol).
    const PY = (m, v, tex) => Y(tex ? v * (1 + 0.026 * chartNoise(m)) : v);
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const yy = p.t + i * (h - p.t - p.b) / 3; c.beginPath(); c.moveTo(p.l, yy); c.lineTo(w - p.r, yy); c.stroke(); }
    // Axis labels — clearly visible, like a real financial chart. ₹ values sit
    // on the right (clear of the line); year ticks run along the bottom.
    if (opts.axis) {
      c.save();
      c.font = '600 12px ui-monospace, "SF Mono", Menlo, monospace';
      // ₹ gridline values on the LEFT (the lines and their end-dots live on the
      // right, so left-aligned labels never collide with them).
      c.fillStyle = 'rgba(230,238,248,0.62)'; c.textAlign = 'left'; c.textBaseline = 'bottom';
      for (let i = 0; i < 3; i++) { const yy = p.t + i * (h - p.t - p.b) / 3; const val = yMax * (3 - i) / 3; c.fillText(inrShort(val), p.l + 3, yy - 3); }
      // year ticks — first left-anchored, last right-anchored, so neither spills off-canvas.
      c.fillStyle = 'rgba(230,238,248,0.55)'; c.textBaseline = 'alphabetic';
      const yrs = opts.axisYears || Math.round(N / 12), step = Math.max(1, Math.round(yrs / 4));
      for (let yr = 0; yr <= yrs; yr += step) {
        const last = yr + step > yrs;
        c.textAlign = yr === 0 ? 'left' : (last ? 'right' : 'center');
        const lx = yr === 0 ? p.l : (last ? w - p.r : X(yr * 12));
        c.fillText('Yr ' + yr, lx, h - p.b + 16);
      }
      c.restore();
    }
    // Divergence shading: fill the gap between two lines (the cost made visible).
    if (band) {
      const a = pointsUpTo(band.a, head == null ? N : head), b = pointsUpTo(band.b, head == null ? N : head);
      if (a.length && b.length) {
        c.save(); c.beginPath();
        for (let i = 0; i < a.length; i++) { const [m, v] = a[i]; if (i === 0) c.moveTo(X(m), Y(v)); else c.lineTo(X(m), Y(v)); }
        for (let i = b.length - 1; i >= 0; i--) { const [m, v] = b[i]; c.lineTo(X(m), Y(v)); }
        c.closePath(); c.fillStyle = band.color; c.fill(); c.restore();
      }
    }
    for (const line of lines) {
      const pts = pointsUpTo(line.values, head == null ? N : head);
      if (!pts.length) continue;
      const tex = !!line.texture;
      if (line.fill) {
        c.beginPath(); c.moveTo(X(pts[0][0]), h - p.b);
        for (const [m, v] of pts) c.lineTo(X(m), PY(m, v, tex));
        c.lineTo(X(pts[pts.length - 1][0]), h - p.b); c.closePath();
        const g = c.createLinearGradient(0, p.t, 0, h - p.b); g.addColorStop(0, line.fill); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fill();
      }
      const tracePath = (dx) => { c.beginPath(); for (let i = 0; i < pts.length; i++) { const [m, v] = pts[i]; const px = X(m) + (dx || 0), py = PY(m, v, tex); if (i === 0) c.moveTo(px, py); else c.lineTo(px, py); } };
      // Crisp, restrained line — professional, not glowing/cartoonish.
      c.save(); c.globalAlpha = line.alpha == null ? 1 : line.alpha; c.strokeStyle = line.color; c.lineWidth = line.width || 2;
      c.lineJoin = 'round'; c.lineCap = 'round'; if (line.dash) c.setLineDash(line.dash); if (line.glow) { c.shadowColor = line.color; c.shadowBlur = 6; }
      tracePath(0); c.stroke(); c.restore();
      if (line.dot) {
        const [m, v] = pts[pts.length - 1], px = X(m), py = PY(m, v, tex);
        c.save();
        c.strokeStyle = hexFill(line.color, 0.35); c.lineWidth = 1; c.beginPath(); c.arc(px, py, 7, 0, Math.PI * 2); c.stroke();
        c.shadowColor = line.color; c.shadowBlur = 8; c.fillStyle = line.color; c.beginPath(); c.arc(px, py, 3.4, 0, Math.PI * 2); c.fill();
        c.restore();
      }
    }
  }

  // A real trading-terminal CANDLESTICK chart of the market, auto-fitting to
  // the visible window. Green = up month, red = down month; the crash is a
  // cascade of red candles.
  function drawCandles(c, w, h, N, nav, head, pad, years, crashing) {
    const p = pad, last = Math.max(1, Math.min(Math.floor(head), nav.length - 1));
    let lo = Infinity, hi = -Infinity;
    for (let m = 0; m <= last; m++) { const o = nav[m], rg = Math.max(o, 1) * 0.02; if (o - rg < lo) lo = o - rg; if (o + rg > hi) hi = o + rg; }
    const span = (hi - lo) || 1; lo -= span * 0.06; hi += span * 0.06;
    const X = (m) => p.l + (m / N) * (w - p.l - p.r);
    const Y = (v) => (h - p.b) - ((v - lo) / (hi - lo)) * (h - p.t - p.b);
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const yy = p.t + i * (h - p.t - p.b) / 3; c.beginPath(); c.moveTo(p.l, yy); c.lineTo(w - p.r, yy); c.stroke(); }
    const cw = Math.max(1.6, Math.min(11, (w - p.l - p.r) / N * 0.6));
    for (let m = 1; m <= last; m++) {
      const o = nav[m - 1], cl = nav[m], up = cl >= o, col = up ? '#3ee0a4' : '#ff7a7a';
      const wick = (Math.abs(chartNoise(m)) * 0.5 + 0.35) * Math.max(o, cl) * 0.012;
      const x = X(m);
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, Y(Math.max(o, cl) + wick)); c.lineTo(x, Y(Math.min(o, cl) - wick)); c.stroke();
      const top = Math.min(Y(o), Y(cl)), ht = Math.max(1.6, Math.abs(Y(cl) - Y(o)));
      c.globalAlpha = up ? 0.85 : 1; c.fillRect(x - cw / 2, top, cw, ht); c.globalAlpha = 1;
    }
    // last-price level + label (right edge), like a live ticker
    const lc = nav[last], yL = Y(lc);
    c.setLineDash([4, 5]); c.strokeStyle = crashing ? hexFill('#ff7a7a', 0.7) : hexFill('#3ee0a4', 0.7); c.lineWidth = 1;
    c.beginPath(); c.moveTo(p.l, yL); c.lineTo(w - p.r, yL); c.stroke(); c.setLineDash([]);
    // axis: year ticks + a 'market' caption
    c.fillStyle = 'rgba(230,238,248,0.6)'; c.font = '600 13px ui-monospace, monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (let yr = 0; yr <= years; yr += Math.max(1, Math.round(years / 4))) c.fillText('Yr ' + yr, X(yr * 12), h - p.b + 17);
    c.textAlign = 'left'; c.fillStyle = 'rgba(230,238,248,0.5)'; c.font = '700 11px ui-monospace, monospace';
    c.fillText('THE MARKET', p.l + 2, p.t - 8 < 14 ? 16 : p.t - 8);
  }

  // A single candle (wick + body) — shared by the climb and the crash waterfall.
  function drawCandle(c, x, o, cl, cw, Y, col, wickv) {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, Y(Math.max(o, cl) + wickv)); c.lineTo(x, Y(Math.min(o, cl) - wickv)); c.stroke();
    const top = Math.min(Y(o), Y(cl)), ht = Math.max(1.8, Math.abs(Y(cl) - Y(o)));
    c.fillRect(x - cw / 2, top, cw, ht);
  }
  // Stage the fall as a fixed waterfall of red candles from peak → the REAL
  // computed bottom (the destination is the true value; the cascade is the
  // visual). Slightly jagged, with the odd dead-cat bounce, so it reads real.
  function buildCrashSeq(sim, K) {
    const peak = sim.navDirect[sim.S], bottom = sim.navDirect[sim.navDirect._bottom];
    const seq = [peak];
    for (let i = 1; i <= K; i++) {
      const t = i / K, base = peak + (bottom - peak) * easeInCrash(t);
      let v = base;
      if (i < K) { const n = Math.sin(i * 12.9898) * 43758.5453; const fr = n - Math.floor(n); v = base * (1 + (fr - 0.5) * 0.045); }
      else v = bottom;
      seq.push(v);
    }
    return seq;
  }
  function drawCrash(c, w, h, sim, q) {
    const K = CRASH_CANDLES, seq = state.crashSeq, p = { l: 18, r: 18, t: 30, b: 32 }, Wpre = 14, displayN = Wpre + K;
    const revealedF = q * K, revealed = Math.max(1, Math.min(K, Math.ceil(revealedF)));
    const peak = seq[0], bottom = seq[K], preStart = Math.max(1, sim.S - Wpre);
    let lo = bottom, hi = peak;
    for (let m = preStart; m <= sim.S; m++) { const v = sim.navDirect[m]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = (hi - lo) || 1; lo -= span * 0.10; hi += span * 0.10;
    const X = (slot) => p.l + (slot / displayN) * (w - p.l - p.r);
    const Y = (v) => (h - p.b) - ((v - lo) / (hi - lo)) * (h - p.t - p.b);
    const cw = Math.max(4, (w - p.l - p.r) / displayN * 0.62);
    // current (interpolated) price + drawdown
    const fi = Math.min(K, Math.floor(revealedF)), fr = Math.max(0, Math.min(1, revealedF - fi));
    const curV = seq[Math.max(0, fi)] + (seq[Math.min(K, fi + 1)] - seq[Math.max(0, fi)]) * fr;
    const dd = Math.max(0, (1 - curV / peak) * 100);
    // screen shake intensifies with the fall
    const jx = (Math.random() - 0.5) * 9 * q, jy = (Math.random() - 0.5) * 9 * q;
    c.clearRect(0, 0, w, h); c.save(); c.translate(jx, jy);
    c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const yy = p.t + i * (h - p.t - p.b) / 3; c.beginPath(); c.moveTo(p.l, yy); c.lineTo(w - p.r, yy); c.stroke(); }
    // recent climb (green) for context
    for (let i = 1; i < Wpre; i++) { const m = preStart + i; if (m > sim.S) break; const o = sim.navDirect[m - 1], cl = sim.navDirect[m]; drawCandle(c, X(i), o, cl, cw, Y, '#2fae7e', Math.max(o, cl) * 0.006); }
    // the waterfall (red, the odd bounce green)
    for (let i = 1; i <= revealed; i++) {
      const o = seq[i - 1]; let cl = seq[i];
      if (i === revealed) cl = o + (seq[i] - o) * fr; // the live candle grows down
      const col = cl >= o ? '#3ee0a4' : '#ff4d4d';
      drawCandle(c, X(Wpre - 1 + i), o, cl, cw, Y, col, Math.abs(chartNoise(i) * 0.5 + 0.4) * Math.max(o, cl) * 0.012);
    }
    // falling red level line at the live price
    const yL = Y(curV);
    c.setLineDash([4, 5]); c.strokeStyle = hexFill('#ff4d4d', 0.8); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(p.l, yL); c.lineTo(w - p.r, yL); c.stroke(); c.setLineDash([]);
    // big live drawdown ticker
    c.textAlign = 'right'; c.textBaseline = 'top';
    c.fillStyle = hexFill('#ff4d4d', 0.95); c.font = '800 ' + Math.round(26 + 16 * q) + 'px ui-monospace, monospace';
    c.shadowColor = 'rgba(255,60,60,0.6)'; c.shadowBlur = 18 * q;
    c.fillText('−' + dd.toFixed(0) + '%', w - p.r - 2, p.t + 2); c.shadowBlur = 0;
    c.textAlign = 'left'; c.fillStyle = hexFill('#ff7a7a', 0.7); c.font = '700 11px ui-monospace, monospace';
    c.fillText('THE MARKET', p.l + 2, p.t - 8 < 14 ? 16 : p.t - 8);
    c.restore();
  }

  // Draw a finished two-line journey (used on the result screens).
  function drawJourney(canvasId, a, b, N, years, behind) {
    const cv = $(canvasId); if (!cv) return;
    const { w, h, c } = fitCanvas(cv);
    const yMax = Math.max(a.values[N], b.values[N], a.values[a.values.length - 1], b.values[b.values.length - 1]) * 1.08;
    const band = { a: a.values, b: b.values, color: hexFill(behind ? COL.crash : COL.direct, 0.16) };
    drawLines(c, w, h, N, yMax, [b, a], N, { l: 16, r: 16, t: 18, b: 30 }, band, { axis: true, axisYears: years });
  }
  // A premium allocation donut for the emergency intro.
  function drawDonut(canvasId, parts) {
    const cv = $(canvasId); if (!cv) return;
    const { w, h, c } = fitCanvas(cv);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6, total = parts.reduce((s, p) => s + p.v, 0) || 1;
    let a0 = -Math.PI / 2;
    c.clearRect(0, 0, w, h);
    for (const p of parts) {
      const a1 = a0 + (p.v / total) * Math.PI * 2;
      c.beginPath(); c.arc(cx, cy, r, a0, a1); c.lineWidth = 16; c.strokeStyle = p.color; c.lineCap = 'butt'; c.stroke();
      a0 = a1;
    }
    c.fillStyle = '#fff'; c.font = '700 13px ui-monospace, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('3 funds', cx, cy);
  }

  /* ===================== WIZARD (one decision per screen) ===================== */
  const WIZ_KEY = { scenario: 'scenario', duration: 'years', sip: 'sip', event: 'eventId', emType: 'emergencyId', severity: 'severity' };
  const WIZ_NUM = { duration: true, sip: true };
  function wizSteps() { return state.scenario === 'crash' ? ['scenario', 'duration', 'sip', 'event'] : ['scenario', 'duration', 'sip', 'emType', 'severity']; }
  function showWizStep(i) {
    const steps = wizSteps();
    state.wizIndex = Math.max(0, Math.min(i, steps.length - 1));
    const name = steps[state.wizIndex];
    document.querySelectorAll('.wstep').forEach((el) => { el.hidden = el.id !== 'w_' + name; });
    // Returning to the doors: reset them to open/visible (no leftover swing).
    if (name === 'scenario') document.querySelectorAll('#w_scenario .scn-card').forEach((c) => { c.classList.remove('chosen', 'dismiss', 'locked'); c.classList.add('open'); });
    const key = WIZ_KEY[name], cur = String(state[key]);
    document.querySelectorAll('#w_' + name + ' .opt').forEach((b) => b.classList.toggle('on', b.dataset.val === cur));
    const back = $('wizBack'); if (back) back.hidden = state.wizIndex === 0;
    setHTML('wizDots', steps.map((s, idx) => '<span class="wdot' + (idx === state.wizIndex ? ' on' : '') + '"></span>').join(''));
  }
  function wizPick(name, val, btn) {
    state[WIZ_KEY[name]] = WIZ_NUM[name] ? Number(val) : val;
    if (btn) { document.querySelectorAll('#w_' + name + ' .opt').forEach((b) => b.classList.toggle('on', b === btn)); }
    const steps = wizSteps();
    const advance = () => { if (state.wizIndex >= steps.length - 1) wizLaunch(); else showWizStep(state.wizIndex + 1); };
    // The DOOR you pick swings fully open, light floods, and you step through
    // into the next screen.
    if (name === 'scenario' && btn && !reduceMotion) {
      btn.classList.add('chosen');
      const other = [...document.querySelectorAll('#w_scenario .scn-card')].find((c) => c !== btn);
      if (other) other.classList.add('dismiss');
      Sound.whoosh();
      const flash = $('doorFlash'); if (flash) { flash.classList.remove('show'); requestAnimationFrame(() => flash.classList.add('show')); setTimeout(() => flash.classList.remove('show'), 700); }
      setTimeout(advance, 470);
      return;
    }
    // Other steps: a brief beat so the selection registers, then move on.
    if (reduceMotion) advance(); else setTimeout(advance, 260);
  }
  function wizBack() { if (state.wizIndex > 0) showWizStep(state.wizIndex - 1); }
  function wizLaunch() {
    if (state.scenario === 'crash') showPledge();
    else startEmergency();
  }

  /* ===================== THE PLEDGE (commit) ===================== */
  function showPledge() {
    hide($('setup')); hideAllOverlays();
    state.pledge = null;
    setText('pledgeYears', state.years);
    show($('pledge'));
    narrate('Sometime in your ' + state.years + ' years, a crash will come. Swear it now, while you are calm. When your savings are deep in the red, what will you do?', { rate: 0.92 });
  }
  function makePledge(p) {
    state.pledge = p;
    hide($('pledge'));
    startClimb();
  }

  /* ===================== SCENARIO A — the crash ===================== */
  function renderStage() {
    const cv = $('stageCanvas'); if (!cv) return;
    const { w, h, c } = fitCanvas(cv);
    const sim = state.sim, N = sim.N;
    const pre = state.phase === 'climb' || state.phase === 'crash';
    let front;
    if (pre) {
      // Watch THE MARKET as live candlesticks; the HUD shows your money.
      front = sim.direct.hold.value;
      if (state.phase === 'crash' && state.crashSeq) drawCrash(c, w, h, sim, state.crashQ || 0);
      else drawCandles(c, w, h, N, sim.navDirect, state.head, { l: 18, r: 18, t: 30, b: 32 }, sim.years, false);
    } else {
      // The consequence: your path vs the calm path, with the gap shaded.
      const yours = sim.direct[state.choice], calm = sim.direct.hold;
      front = yours.value;
      const lines = [
        { values: calm.value, color: COL.ghost, width: 1.8, alpha: 0.38, dash: [4, 5] },
        { values: yours.value, color: BEHAVIOURS[state.choice].color, width: 2.4, glow: true, dot: true, texture: true, fill: hexFill(BEHAVIOURS[state.choice].color, 0.14) },
      ];
      const band = state.head > sim.navDirect._bottom ? { a: yours.value, b: calm.value, color: hexFill(yours.final < calm.final ? COL.crash : COL.direct, 0.16) } : null;
      drawLines(c, w, h, N, state.yMax, lines, state.head, { l: 18, r: 18, t: 28, b: 32 }, band, { axis: true, axisYears: sim.years });
    }
    const corpus = valueAt(front, state.head), months = Math.min(Math.floor(state.head), N);
    // A soft tick + light haptic each year the climb passes — time, felt.
    const yr = Math.min(Math.floor(state.head / 12), sim.years);
    if (state.phase === 'climb' && yr !== state._lastYear) { state._lastYear = yr; if (yr > 0) { Sound.ui(); if (navigator.vibrate) navigator.vibrate(5); } }
    setText('corpus', inr(corpus));
    setText('corpusShort', '≈ ' + inrShort(corpus));
    setText('yearLabel', 'Year ' + yr + ' / ' + sim.years);
    setText('invested', 'You\'ve put in ' + inrShort(state.sip * months));
    const bar = $('climbProg'); if (bar) bar.style.width = Math.min(100, state.head / N * 100) + '%';
  }

  function spawnEmbers() {} // removed — falling red dots read as childish

  const CLIMB_MS = reduceMotion ? 200 : 5200, CRASH_MS = reduceMotion ? 150 : 7600, DIVERGE_MS = reduceMotion ? 200 : 6000;
  const CRASH_CANDLES = 16; // the fall is staged as a dramatic waterfall of N candles, regardless of the event's literal fall length
  function tensionCue() { if (!reduceMotion && navigator.vibrate) navigator.vibrate([20, 70, 30]); }

  function loop(ts) {
    if (state.phaseStart == null) state.phaseStart = ts;
    const e = ts - state.phaseStart, sim = state.sim, N = sim.N, S = sim.S, bottom = sim.navDirect._bottom;
    if (state.phase === 'climb') {
      const p = Math.min(e / CLIMB_MS, 1); state.head = S * easeInOut(p); renderStage();
      if (p >= 1) { state.phase = 'crash'; state.phaseStart = null; state._crashCand = 0; state.crashSeq = buildCrashSeq(sim, CRASH_CANDLES); state.crashQ = 0; $('stage').classList.add('crashing'); tensionCue(); Sound.impact(); Sound.crashHit(); Sound.startRumble(CRASH_MS + 600); Sound.setHeart(104); }
      state.raf = requestAnimationFrame(loop);
    } else if (state.phase === 'crash') {
      // a dramatic, accelerating WATERFALL: CRASH_CANDLES red candles tumble from
      // peak to the real computed bottom — felt one heavy thud at a time.
      const p = Math.min(e / CRASH_MS, 1), q = easeInCrash(p);
      state.crashQ = q; state.head = S + (bottom - S) * q; renderStage();
      const cur = Math.floor(q * CRASH_CANDLES);
      if (cur > state._crashCand) { state._crashCand = cur; Sound.crashTick(q); Sound.setHeart(104 + Math.round(q * 56)); if (!reduceMotion && navigator.vibrate) navigator.vibrate(10 + Math.round(q * 30)); }
      if (p >= 1) { Sound.impact(); Sound.lossTone(); cancelAnimationFrame(state.raf); enterSilence(); return; }
      state.raf = requestAnimationFrame(loop);
    } else if (state.phase === 'diverge') {
      const p = Math.min(e / DIVERGE_MS, 1); state.head = bottom + (N - bottom) * easeInOut(p); renderStage();
      if (p >= 1) { cancelAnimationFrame(state.raf); openResult(); return; }
      state.raf = requestAnimationFrame(loop);
    }
  }

  function startClimb() {
    state.sim = runSinglePath(state.sip, state.eventId, state.years);
    buildTex(state.sim.N); // fresh realistic market texture for this run
    state.choice = null; state.head = 0; state.phase = 'climb'; state.phaseStart = null; state.embers = []; state._lastYear = -1;
    state.yMax = state.sim.direct.hold.final * 1.08;
    const marker = $('climbMarker'); if (marker) marker.style.left = (state.sim.S / state.sim.N * 100) + '%';
    setText('pledgeBadge', 'You swore: ' + PLEDGE_LABEL[state.pledge]);
    $('stage').classList.remove('crashing');
    hideAllOverlays(); hide($('setup')); hide($('emergency'));
    show($('stage'));
    Sound.unlock(); Sound.startPad();
    cancelAnimationFrame(state.raf); state.raf = requestAnimationFrame(loop);
  }

  function enterSilence() {
    const sim = state.sim;
    Sound.impact(); Sound.silenceCut(); Sound.lossTone(); Sound.setHeart(96); // impact, hollow loss tone, lone racing heart
    const peak = sim.direct.hold.value[sim.S], bottom = sim.direct.hold.value[sim.navDirect._bottom];
    const depth = Math.round(sim.ev.depth * 100);
    setText('silDepth', depth);
    setText('silFrom', inrShort(peak)); setText('silTo', inrShort(bottom));
    setText('silContext', (sim.crashYear % 1 ? sim.crashYear.toFixed(1) : sim.crashYear) + ' years in. ' + sim.ev.name + '.');
    show($('silence')); // a visual beat — full-screen, no narration here
  }
  // Step 1: YOU decide ALONE — no friend, no voice, nothing to copy.
  function openYouDecision() { hide($('silence')); Sound.whoosh(); show($('youDecision')); }
  // Step 2: only AFTER you've chosen, the friend (and the RM call) is revealed.
  // Her phone rings (MD calling). You "listen in" — then the MD's short, sharp
  // advice plays. Makes clear it's the FRIEND's call, not yours.
  function openFriendReveal() {
    show($('friendReveal'));
    const wave = $('revealWave'); if (wave) wave.hidden = true;
    setText('revealStatus', 'Her fund\'s MD — incoming…');
    setHTML('revealQuote', '');
    const ans = $('friendAnswer'); if (ans) ans.hidden = false;
    const go = $('friendRevealBtn'); if (go) go.hidden = true;
    Sound.whoosh(); Sound.ring();
  }
  function answerFriendCall() {
    const ans = $('friendAnswer'); if (ans) ans.hidden = true;
    const av = document.querySelector('#friendReveal .call-avatar'); if (av) av.classList.remove('ringing');
    const wave = $('revealWave'); if (wave) wave.hidden = false;
    setText('revealStatus', 'Connected · MD');
    revealQuote('revealQuote', '"' + RM_CRASH_LINE + '"', 350, 130);
    narrate(RM_CRASH_LINE, { rate: 0.98, clip: 'voice/crash.mp3?v=20260618' }, () => { const go = $('friendRevealBtn'); if (go) go.hidden = false; });
  }
  function choose(choice) {
    state.choice = choice; Sound.stopHeart();
    if (CHOICE_CAT[choice] === 'sell') Sound.freeze(); else Sound.tick();
    hide($('youDecision')); $('stage').classList.remove('crashing');
    openFriendReveal();
  }

  /* ---- The collision: your promise vs what you actually did. ---- */
  function showCollision() {
    const kept = CHOICE_CAT[state.choice] === state.pledge;
    const did = BEHAVIOURS[state.choice].short, sworn = PLEDGE_LABEL[state.pledge];
    if (kept) {
      setText('collisionTag', 'YOU KEPT YOUR WORD');
      setHTML('collisionTitle', 'You said you\'d ' + sworn + '.<br />You did.');
      setHTML('collisionBody', 'Most people swear the same thing — then break it the moment the screen turns red. You didn\'t. Let\'s see what that was worth.');
      $('collision').classList.remove('broke'); Sound.stinger(false);
    } else {
      setText('collisionTag', 'WHAT YOU SWORE vs WHAT YOU DID');
      setHTML('collisionTitle', 'You swore you\'d ' + sworn + '.<br />You ' + did + '.');
      setHTML('collisionBody', (CHOICE_CAT[state.choice] === 'sell'
        ? 'The instant you sold, the red froze and the fear stopped — pure relief. That flinch feels smart in the moment. It is the most expensive feeling in investing.'
        : 'Calm, you meant it. In the red, your hand moved anyway. That\'s the gap between the investor you plan to be and the one who shows up on the worst day.'));
      $('collision').classList.add('broke'); Sound.stinger(true);
    }
    show($('collision'));
  }
  function afterCollision() {
    stopCallTimer(); hide($('collision')); show($('stage'));
    // The regret beat: for sellers, the market visibly recovers without them.
    const reg = $('regretCaption');
    if (reg) {
      if (CHOICE_CAT[state.choice] === 'sell' && !reduceMotion) {
        reg.textContent = 'The market recovered. Without you.';
        reg.hidden = false; reg.classList.remove('show');
        setTimeout(() => reg.classList.add('show'), 1600);
        setTimeout(() => { reg.classList.remove('show'); setTimeout(() => { reg.hidden = true; }, 600); }, 4400);
      } else { reg.hidden = true; }
    }
    state.phase = 'diverge'; state.phaseStart = null; cancelAnimationFrame(state.raf); state.raf = requestAnimationFrame(loop);
  }
  function shareCrash() {
    const sim = state.sim, yours = sim.direct[state.choice], friend = sim.regular.hold, cost = sim.direct.hold.final - yours.final;
    let txt;
    if (CHOICE_CAT[state.choice] === 'sell' && state.pledge === 'hold')
      txt = 'I swore I\'d hold through a crash. At −' + Math.round(sim.ev.depth * 100) + '% I sold anyway. It cost me ' + inrShort(cost) + ' — ' + sipSpan(cost) + '. I just found out the kind of investor I really am.';
    else if (state.choice === 'hold')
      txt = 'I held through ' + sim.ev.name + ' and finished with ' + inrShort(yours.final) + '. Doing nothing was the hardest, smartest thing.';
    else
      txt = 'I lived ' + sim.ev.name + ' as an investor. My one decision in the crash cost me ' + inrShort(cost) + ' — ' + sipSpan(cost) + '.';
    const behind = yours.final < friend.final;
    const card = renderShareCard({
      kicker: 'I lived ' + sim.ev.name, sub: 'You ' + BEHAVIOURS[state.choice].label + ' · ' + sim.years + ' years',
      you: { label: 'YOU', val: inrShort(yours.final), color: '#3ee0a4' },
      friend: { label: 'YOUR FRIEND', val: inrShort(friend.final), color: '#f0bb63' },
      gapText: (yours.final >= friend.final ? '+' : '−') + inrShort(Math.abs(yours.final - friend.final)) + (yours.final >= friend.final ? ' ahead' : ' behind'),
      gapColor: yours.final >= friend.final ? '#3ee0a4' : '#ff7a7a', punch: txt,
      N: sim.N, yMax: Math.max(yours.final, friend.final, sim.direct.hold.final) * 1.08,
      lines: [{ values: friend.value, color: '#f0bb63', width: 4, alpha: 0.9, texture: true }, { values: yours.value, color: BEHAVIOURS[state.choice].color, width: 5, glow: true, dot: true, texture: true }],
      band: { a: yours.value, b: sim.direct.hold.value, color: hexFill(behind ? '#ff7a7a' : '#3ee0a4', 0.16) },
    });
    shareImage(card, txt);
  }
  function shareEmergency() {
    const sim = state.sim, gap = sim.directSmart.final - sim.you.final;
    const txt = gap > sim.sip
      ? 'An emergency hit. Alone and under pressure, I ' + emActionLabel(sim) + ' — and one calm decision would have left me ' + inrShort(gap) + ' (' + sipSpan(gap) + ') richer. A temporary emergency almost became permanent.'
      : 'An emergency hit and I kept it temporary — the call almost no one makes alone. Try it yourself.';
    const card = renderShareCard({
      kicker: sim.em.name, sub: 'You ' + emActionLabel(sim) + ' · ' + sim.years + ' years',
      you: { label: 'YOU, ALONE', val: inrShort(sim.you.final), color: '#ff7a7a' },
      friend: { label: 'A STEADY CALL', val: inrShort(sim.directSmart.final), color: '#3ee0a4' },
      gapText: gap > 1 ? '−' + inrShort(gap) + ' for facing it alone' : 'You kept it temporary',
      gapColor: gap > 1 ? '#ff7a7a' : '#3ee0a4', punch: txt,
      N: sim.N, yMax: Math.max(sim.you.final, sim.directSmart.final) * 1.08,
      lines: [{ values: sim.directSmart.value, color: '#3ee0a4', width: 4, alpha: 0.9, texture: true }, { values: sim.you.value, color: '#ff7a7a', width: 5, glow: true, dot: true, texture: true }],
      band: { a: sim.you.value, b: sim.directSmart.value, color: hexFill('#ff7a7a', 0.16) },
    });
    shareImage(card, txt);
  }

  /* ---- Result. ---- */
  function openResult() {
    Sound.stopHeart(); Sound.whoosh(); Sound.resolve();
    const sim = state.sim, yours = sim.direct[state.choice], friend = sim.regular.hold, calm = sim.direct.hold;
    setText('youLabel', 'YOU · Direct · ' + BEHAVIOURS[state.choice].label);
    setText('friendLabelR', 'FRIEND · Regular · Held');
    $('youFinal').style.color = BEHAVIOURS[state.choice].color;
    countUp($('youFinal'), yours.final, 1500, inrShort);
    countUp($('friendFinal'), friend.final, 1500, inrShort);
    const diff = yours.final - friend.final;
    setHTML('gapLine', diff >= 0 ? '<span class="good">You finished ' + inr(Math.abs(diff)) + ' ahead of your friend.</span>' : '<span class="bad">You finished ' + inr(Math.abs(diff)) + ' behind your friend.</span>');
    setHTML('verdict', verdictFor(state.choice, yours.final, friend.final, sim));

    const feeSaved = sim.feeSavingRupees, behaviourCost = calm.final - yours.final;
    // Make it personal: the cost in years of their own SIP, or the magic of holding.
    if (behaviourCost > state.sip * 6)
      setHTML('resonate', '<b class="bad">' + inr(behaviourCost) + '</b> — that\'s <b>' + sipSpan(behaviourCost) + '</b>, gone in a decision you made in a few frightened seconds.');
    else if (state.choice === 'hold')
      setHTML('resonate', 'You put in ' + inrShort(yours.invested) + ' and did nothing. Nothing turned it into <b class="good">' + inrShort(yours.final) + '</b>.');
    else
      setHTML('resonate', 'You put in ' + inrShort(yours.invested) + '. It became <b>' + inrShort(yours.final) + '</b>.');
    const pauseRow = (state.choice === 'pause' && yours.pauseMonths) ? [['You stayed paused for', (yours.pauseMonths / 12).toFixed(1) + ' years (until confidence returned)', 'computed']] : [];
    setHTML('mathsPanel', mathsRows([
      ['Total you invested (₹' + state.sip.toLocaleString('en-IN') + ' × ' + sim.N + ' months)', inr(yours.invested), 'computed'],
    ].concat(pauseRow).concat([
      ['YOUR final corpus', inr(yours.final), 'computed'],
      ['YOUR return (XIRR)', pct(yours.xirr), 'computed'],
      ['Friend\'s final corpus', inr(friend.final), 'computed'],
      ['Friend\'s return (XIRR)', pct(friend.xirr), 'computed'],
      ['The market itself (CAGR)', pct(sim.indexCagr), 'computed'],
      ['What the fee saved you', inr(feeSaved), 'computed'],
      ['What your crash decision cost you', inr(behaviourCost), 'computed'],
      ['Assumed returns', 'Direct 12% / Regular 11% a year', 'assumption'],
      ['Assumed crash', '−' + Math.round(sim.ev.depth * 100) + '% over ' + sim.ev.fallMonths + ' mo, then regains its prior level over ' + sim.ev.recoveryMonths + ' mo', 'assumption'],
    ])) + '<p class="maths-note">The crash falls, then recovers to its <b>pre-crash level</b> over ' + sim.ev.recoveryMonths + ' months — as ' + sim.ev.name + ' did historically — and resumes trend growth from there (so the market ends a little under a no-crash 12%, the growth the round-trip consumed). XIRR is the one annual rate that makes your monthly investments equal the final value — the correct return for a SIP. Every ₹ is computed from month-by-month units × NAV; only the labelled assumptions are inputs.</p>');
    closeMaths('mathsPanel', 'mathsToggle');
    show($('result'));
    const a = { values: yours.value, color: BEHAVIOURS[state.choice].color, width: 3, glow: true, dot: true, texture: true };
    const b = { values: friend.value, color: COL.regular, width: 2.4, alpha: 0.85, texture: true };
    requestAnimationFrame(() => drawJourney('resultCanvas', a, b, sim.N, sim.years, yours.final < friend.final));
  }

  function verdictFor(choice, yours, friendFinal, sim) {
    const kept = CHOICE_CAT[choice] === state.pledge, youHeld = choice === 'hold', youAhead = yours >= friendFinal;
    if (youHeld && youAhead)
      return 'You held. She held. You simply kept more.'
        + '<span class="verdict-sub">The cheaper door quietly won — and holding even beat a crash-free market by <b>' + inrShort(Math.max(sim.direct.hold.final - sim.directNoCrash, 0)) + '</b> (the dip bought you cheap units).</span>';
    if (!youHeld && !youAhead)
      return 'You saved the fee — and lost far more.'
        + '<span class="verdict-sub">' + (kept ? 'You even did what you planned. It still hurt, because the plan itself was the mistake.' : 'Her plan bought one thing: a voice that said <i>don\'t sell</i>.') + ' She isn\'t smarter. She just wasn\'t alone.</span>';
    if (!youHeld && youAhead) {
      const gfc = runSinglePath(state.sip, 'gfc', state.years);
      return 'You blinked — and got away with it. This time.'
        + '<span class="verdict-sub">A shallow fall forgives a panic. The same flinch in a 2008-style crash would have cost you about <b>' + inrShort(gfc.direct.hold.final - gfc.direct.sellWait.final) + '</b>.</span>';
    }
    return 'Two calm investors. The only thing left to separate you was the fee.'
      + '<span class="verdict-sub">When nobody panics, the door decides it — by a little.</span>';
  }

  function countUp(el, to, dur, fmt) {
    if (!el) return;
    if (reduceMotion) { el.textContent = fmt(to); return; }
    const start = performance.now();
    (function step(t) { const p = Math.min((t - start) / dur, 1); el.textContent = fmt(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(performance.now());
  }

  function mathsRows(rows) {
    return '<div class="maths-rows">' + rows.map((r) => '<div class="maths-row"><span class="mr-label">' + r[0] + '</span><span class="mr-val">' + r[1] + '</span><span class="mr-tag ' + r[2] + '">' + (r[2] === 'computed' ? 'computed' : 'assumption') + '</span></div>').join('') + '</div>';
  }
  function closeMaths(panelId, toggleId) { const p = $(panelId), t = $(toggleId); if (p) p.hidden = true; if (t) t.textContent = 'See the maths ▾'; }
  function wireMaths(toggleId, panelId) { on(toggleId, 'click', () => { const p = $(panelId), t = $(toggleId); if (!p) return; p.hidden = !p.hidden; t.textContent = p.hidden ? 'See the maths ▾' : 'Hide the maths ▴'; }); }

  /* ===================== "Was It Luck?" — behaviour vs the door ===================== *
   * Reframed so the lesson is NOT "Direct wins" but "BEHAVIOUR dwarfs the
   * product". We hold the door constant (same investor) and let the user feel
   * how much their behaviour swings the typical outcome — then show the fee gap
   * is a sliver beside it, and that guidance's real value is behavioural. */
  /* ===== "Run it yourself" — the interactive 10,000-life experiment (Section 10) =====
   * Not a film you watch — an experiment you RUN. A choice at every beat, so the
   * reader proves the point on themselves: they try to control what they can't,
   * guess the odds, pull the lever both ways, decide whether to reach for a
   * steady hand, and turn the gap into years of their own life. Every rupee is
   * computed from the engine; the 8/21 persistence figures are cited (AMFI–CRISIL). */
  let expLayout = null;
  function buildExpLayout(data, w, h) {
    const pad = { l: 16, r: 16, t: 18, b: 22 }, innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b, baseY = h - pad.b;
    const cl = data.sample.map((s) => s[0]), pn = data.sample.map((s) => s[1]);
    const lo = Math.min(Math.min.apply(null, cl), Math.min.apply(null, pn)), hi = Math.max(Math.max.apply(null, cl), Math.max.apply(null, pn));
    const Y = (v) => pad.t + innerH * (1 - (Math.max(lo, Math.min(hi, v)) - lo) / ((hi - lo) || 1));
    const dots = data.sample.map((s, i) => { const r = ((i * 2654435761) % 1000) / 1000; return { x: pad.l + innerW * (0.05 + 0.9 * r), yStay: Y(s[0]), yRun: Y(s[1]) }; });
    return { pad, baseY, dots, investedY: Y(data.invested), w, h };
  }
  function drawCloud(c, w, h, L, stayP, runP) {
    c.setLineDash([4, 4]); c.strokeStyle = 'rgba(230,238,248,0.22)'; c.lineWidth = 1; c.beginPath(); c.moveTo(L.pad.l, L.investedY); c.lineTo(w - L.pad.r, L.investedY); c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(230,238,248,0.4)'; c.font = '600 9px ui-monospace, monospace'; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('what you put in', L.pad.l + 2, L.investedY - 2);
    const eo = (p) => 1 - Math.pow(1 - p, 3);
    for (const d of L.dots) {
      if (runP > 0) { const y = L.baseY + (d.yRun - L.baseY) * eo(runP); c.fillStyle = hexFill(COL.crash, 0.42 * runP); c.beginPath(); c.arc(d.x, y, 1.4, 0, 7); c.fill(); }
      if (stayP > 0) { const y = L.baseY + (d.yStay - L.baseY) * eo(stayP); c.fillStyle = hexFill(COL.ghost, 0.5 * stayP); c.beginPath(); c.arc(d.x, y, 1.4, 0, 7); c.fill(); }
    }
  }
  function drawDials(c, w, h, t) {
    const cx = w / 2, cy = h / 2, R = Math.min(w, h);
    for (let i = 0; i < 6; i++) {
      const r = 18 + i * R * 0.072, a0 = t * (0.25 + i * 0.13) * (i % 2 ? 1 : -1);
      c.beginPath(); c.arc(cx, cy, r, a0, a0 + Math.PI * 1.15); c.strokeStyle = 'rgba(203,178,107,' + (0.05 + 0.025 * i) + ')'; c.lineWidth = 2; c.stroke();
      const hx = cx + Math.cos(a0) * r, hy = cy + Math.sin(a0) * r; c.fillStyle = 'rgba(203,178,107,0.3)'; c.beginPath(); c.arc(hx, hy, 2, 0, 7); c.fill();
    }
  }
  function drawOddsGrid(c, w, h, count, p, t) {
    const cols = 10, cellW = (w - 36) / cols, cellH = (h - 36) / 10, r = Math.min(cellW, cellH) * 0.24;
    for (let idx = 0; idx < 100; idx++) {
      if (idx / 100 > p * 1.1) continue;
      const cx = 18 + cellW * (idx % cols + 0.5), cy = 18 + cellH * (Math.floor(idx / cols) + 0.5);
      if (idx < count) c.fillStyle = hexFill(COL.direct, 0.92);
      else c.fillStyle = hexFill(COL.crash, Math.max(0.14, 0.32 + 0.32 * Math.sin(t * 4 + idx)));
      c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
    }
  }
  function drawGlow(c, w, h, t) {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.55);
    g.addColorStop(0, hexFill(COL.ghost, 0.1 + 0.04 * Math.sin(t * 1.5))); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = hexFill(COL.ghost, 0.85); c.beginPath(); c.arc(w / 2, h / 2, 3, 0, 7); c.fill();
  }
  function drawExpScene(data, st) {
    const cv = $('lifeCanvas'); if (!cv) return;
    const { w, h, c } = fitCanvas(cv);
    if (!expLayout || expLayout.w !== w || expLayout.h !== h || expLayout.data !== data) { expLayout = buildExpLayout(data, w, h); expLayout.data = data; }
    c.clearRect(0, 0, w, h);
    if (st.scene === 'dials') drawDials(c, w, h, st.t);
    else if (st.scene === 'odds') drawOddsGrid(c, w, h, st.oddsCount, st.p, st.t);
    else if (st.scene === 'cloud') drawCloud(c, w, h, expLayout, st.stayP, st.runP);
    else drawGlow(c, w, h, st.t);
  }

  function openLuck() {
    show($('luck')); expLayout = null;
    setText('lifeTitle', 'Run it yourself.');
    setText('lifeLead', 'Ten thousand futures. Your call at every step.');
    setHTML('lifeBeats', '<p class="mc-running">Building ten thousand futures…</p>');
    setTimeout(() => { const data = runLifetimes(state.sip, state.years, 4242, 10000, 1800); startExperiment(data); }, 30);
  }
  const EXP_STEPS = ['control', 'guess', 'lever', 'hand', 'life', 'reveal', 'seal'];
  function startExperiment(data) {
    const gap = Math.abs(data.crowdGap), door = Math.abs(data.doorGap);
    state.exp = { step: 'control', data: data, scene: 'dials', p: 0, t0: null, elapsed: 0, oddsCount: 8,
      stay: false, run: false, stayP: 0, runP: 0, calmTyp: data.calm.p50, panicTyp: data.panic.p50, gap: gap, door: door, ratio: (gap / Math.max(1, door)).toFixed(1) };
    const draw = (ts) => { const e = state.exp; if (!e) return;
      if (e.t0 == null) e.t0 = ts; e.elapsed = (ts - e.t0) / 1000;
      e.p += (1 - e.p) * 0.06; if (e.p > 0.999) e.p = 1;
      if (e.stay) e.stayP += (1 - e.stayP) * 0.05; if (e.run) e.runP += (1 - e.runP) * 0.05;
      drawExpScene(data, { scene: e.scene, p: e.p, t: e.elapsed, oddsCount: e.oddsCount, stayP: e.stayP, runP: e.runP });
      state._lifeRaf = requestAnimationFrame(draw); };
    cancelAnimationFrame(state._lifeRaf); state._lifeRaf = requestAnimationFrame(draw);
    expRender('control');
  }
  function expScene(scene) { const e = state.exp; if (!e) return; if (e.scene !== scene) { e.scene = scene; e.p = 0; } }
  function expBtn(act, label, cls) { return '<button class="exp-btn ' + (cls || '') + '" data-act="' + act + '">' + label + '</button>'; }
  function nextBtn(to) { return '<button class="exp-btn next" data-act="next" data-next="' + to + '">Continue →</button>'; }
  function progressDots(idx) { return '<div class="exp-progress">' + EXP_STEPS.map((s, i) => '<span class="edot' + (i === idx ? ' on' : (i < idx ? ' done' : '')) + '"></span>').join('') + '</div>'; }
  function expRender(step) {
    const e = state.exp; if (!e) return; e.step = step; const idx = EXP_STEPS.indexOf(step);
    let html = progressDots(idx);
    if (step === 'control') { expScene('dials');
      html += '<p class="exp-prompt">If you could control <b>one thing</b> about your next 20 years, which would it be?</p>'
        + '<div class="exp-grid">' + expBtn('year', 'The year the crash hits') + expBtn('deep', 'How deep it falls') + expBtn('fund', 'Which fund wins') + expBtn('news', 'The news') + expBtn('nerve', 'Your own nerve') + '</div>'
        + '<p class="exp-note" id="expNote"></p>';
    } else if (step === 'guess') { expScene('dials');
      html += '<p class="exp-prompt">When the market crashes, how many out of 100 do you think <b>actually hold on</b>?</p>'
        + '<div class="exp-grid four">' + expBtn('g70', '70 or more') + expBtn('g50', 'About 50') + expBtn('g30', 'About 30') + expBtn('g10', 'Under 10') + '</div>'
        + '<p class="exp-note" id="expNote"></p>';
    } else if (step === 'lever') { expScene('cloud');
      html += '<p class="exp-prompt">Your money, 10,000 markets, 20 years. <b>Pull the lever — both ways.</b></p>'
        + '<div class="exp-grid two">' + expBtn('stay', '▲ STAY invested', 'stay') + expBtn('run', '▼ RUN to cash', 'run') + '</div>'
        + '<p class="exp-note" id="expNote"></p>';
    } else if (step === 'hand') { expScene('glow');
      html += '<p class="exp-prompt">The crash is here. Your hand is shaking — fear is shoving the lever toward RUN. <b>What do you do?</b></p>'
        + '<div class="exp-grid two">' + expBtn('alone', 'Hold it alone') + expBtn('help', 'Reach for a steady hand') + '</div>'
        + '<p class="exp-note" id="expNote"></p>';
    } else if (step === 'life') { expScene('glow');
      html += '<p class="exp-prompt">Turn the gap into something you can feel. <b>What do you spend a month?</b></p>'
        + '<div class="exp-grid">' + expBtn('e30', '₹30,000') + expBtn('e50', '₹50,000') + expBtn('e100', '₹1,00,000') + '</div>'
        + '<p class="exp-note" id="expNote"></p>';
    } else if (step === 'reveal') { expScene('glow');
      html += '<p class="exp-prompt">One last thing.</p><div class="exp-grid"><button class="exp-btn wide" data-act="showline">Show me →</button></div><p class="exp-note" id="expNote"></p>';
    } else if (step === 'seal') { expScene('glow');
      html += '<div class="lbeat door"><p>The <b>door</b> you chose moved a dial you don’t control — about <b>' + inrShort(e.door) + '</b>. The <b>lever</b> you held — and whether someone helped you hold it — moved the only one you do: about <b>' + inrShort(e.gap) + '</b>, roughly <b>' + e.ratio + '×</b> more <span class="exp-dim">(in this run, at these inputs)</span>.</p><p class="life-cta">You will live exactly one of these futures. You’re choosing it now.</p></div>'
        + '<div class="exp-grid two"><button class="exp-btn" data-act="again">Live it again</button><button class="exp-btn" data-act="close">Done</button></div>';
    }
    setHTML('lifeBeats', html);
    const body = $('lifeBeats'); if (body) body.onclick = (ev) => { const b = ev.target.closest('button[data-act]'); if (b && !b.disabled) expClick(b.dataset.act, b); };
  }
  function expClick(act, btn) {
    const e = state.exp; if (!e) return; Sound.ui();
    if (act === 'next') { expRender(btn.dataset.next); return; }
    if (act === 'guided') { e.oddsCount = 21; e.p = 0; Sound.tick(); btn.classList.add('chosen'); return; }
    if (act === 'showline') { setHTML('expNote', '<span class="exp-line">You will live exactly <b>one</b> of these futures. You’re choosing it right now.</span> ' + nextBtn('seal')); Sound.resolve(); return; }
    if (act === 'again') { hide($('luck')); stopLife(); const rb = $('replayBtn') || $('emReplay'); if (rb) rb.click(); return; }
    if (act === 'close') { hide($('luck')); stopLife(); return; }
    if (e.step === 'control') {
      if (act === 'nerve') { btn.classList.add('chosen'); setHTML('expNote', '<b>This one.</b> The only thing that was ever in your hands. ' + nextBtn('guess')); Sound.resolve(); }
      else { btn.classList.add('locked'); setTimeout(() => btn.classList.remove('locked'), 500); setHTML('expNote', 'No one controls that — not you, not the experts, not the man on TV. <span class="exp-dim">Try again.</span>'); }
      return;
    }
    if (e.step === 'guess') {
      const gl = { g70: '70 or more', g50: 'about 50', g30: 'about 30', g10: 'under 10' }[act];
      e.oddsCount = 8; expScene('odds');
      document.querySelectorAll('#lifeBeats .exp-grid .exp-btn').forEach((b) => { b.disabled = true; }); btn.classList.add('chosen');
      setHTML('expNote', 'You guessed <b>' + gl + '</b>. The truth: about <b>8 in 100</b> who face it alone are still invested five years later. With a steady hand — about <b>21</b>. '
        + '<button class="exp-link" data-act="guided">show “with a steady hand” →</button><br>' + nextBtn('lever'));
      return;
    }
    if (e.step === 'lever') {
      if (act === 'stay') { e.stay = true; btn.classList.add('chosen'); }
      if (act === 'run') { e.run = true; btn.classList.add('chosen'); }
      let note = '';
      if (e.stay && !e.run) note = 'Stayed invested: a typical <b>' + inrShort(e.calmTyp) + '</b>. Now pull it the other way.';
      else if (e.run && !e.stay) note = 'Ran to cash: a typical <b>' + inrShort(e.panicTyp) + '</b>. Now try staying.';
      if (e.stay && e.run) note = 'Same money, same markets — the <b>only</b> thing you changed was the lever. It moved your typical future by <b>' + inrShort(e.gap) + '</b>. ' + nextBtn('hand');
      setHTML('expNote', note); return;
    }
    if (e.step === 'hand') {
      document.querySelectorAll('#lifeBeats .exp-grid .exp-btn').forEach((b) => { b.disabled = true; }); btn.classList.add('chosen');
      const note = act === 'help'
        ? 'A second hand closes over yours; the lever holds. <b>This</b> is what the fee actually buys — not tips, a second hand in the ten seconds yours can’t hold still.'
        : 'Maybe you hold. Most don’t — alone, in the moment, fear usually wins. That isn’t weakness; it’s being alone.';
      setHTML('expNote', note + ' ' + nextBtn('life')); return;
    }
    if (e.step === 'life') {
      const exp = { e30: 30000, e50: 50000, e100: 100000 }[act], yrs = Math.max(1, Math.round(e.gap / (exp * 12)));
      document.querySelectorAll('#lifeBeats .exp-grid .exp-btn').forEach((b) => { b.disabled = true; }); btn.classList.add('chosen');
      setHTML('expNote', 'Then <b>' + inrShort(e.gap) + '</b> is about <b>' + yrs + ' years</b> you’d never have to work for money. <span class="exp-dim">(at ₹' + (exp / 1000) + 'k/mo — illustrative)</span> ' + nextBtn('reveal')); Sound.resolve(); return;
    }
  }
  function stopLife() { cancelAnimationFrame(state._lifeRaf); state.exp = null; Voice.stop(); }

  /* ===================== Every choice (grid) ===================== */
  function openGrid() {
    const sim = (state.sim && state.sim.mode === 'single') ? state.sim : runSinglePath(state.sip, state.eventId, state.years);
    const keys = ['hold', 'pause', 'sellBack', 'sellWait'];
    let html = '<table class="grid-tbl"><thead><tr><th class="corner">YOU ↓ / FRIEND →</th>';
    for (const fk of keys) html += '<th>' + BEHAVIOURS[fk].label + '</th>';
    html += '</tr></thead><tbody>';
    for (const yk of keys) {
      html += '<tr><th class="rowh">' + BEHAVIOURS[yk].label + '</th>';
      for (const fk of keys) {
        const you = sim.direct[yk].final, fr = sim.regular[fk].final;
        const cls = you > fr * 1.005 ? 'win' : you < fr * 0.995 ? 'lose' : 'tie';
        html += '<td class="' + cls + '"><span class="cell-y">' + inrShort(you) + '</span><span class="cell-f">vs ' + inrShort(fr) + '</span></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    const half = (sim.direct.hold.final + sim.regular.hold.final) / 2;
    html += '<p class="grid-note"><b style="color:' + COL.direct + '">Green</b> = YOU (Direct) ahead · <b style="color:' + COL.crash + '">red</b> = your friend (Regular) ahead. The fee gap is small; the behaviour gap is huge.</p>'
      + '<div class="hedge"><span>Split half-Regular, half-Direct (both holding)?</span><b>' + inrShort(half) + '</b><span class="hedge-sub">Right in between — what a hedge does.</span></div>';
    setHTML('gridBody', html); show($('grid'));
  }

  /* ===================== SCENARIO B — emergency (tight copy) ===================== */
  function startEmergency() {
    const ctx = runEmergency(state.sip, state.emergencyId, null, state.downturn, state.years, state.severity);
    state.emCtx = ctx; state.emResponse = null;
    hideAllOverlays(); hide($('setup')); hide($('stage'));
    setText('emIntroSip', state.sip.toLocaleString('en-IN'));
    setText('emIntroYears', ctx.crashYear % 1 ? ctx.crashYear.toFixed(1) : ctx.crashYear);
    setText('emIntroInvested', inrShort(state.sip * ctx.S));
    setText('emIntroCorpus', inr(ctx.directSmart.corpusAtEmergency));
    const sv = ctx.directSmart.sleeveValues;
    setHTML('emIntroSleeves',
      sleeveRow('Liquid fund', sv.liquid, 'your emergency buffer — reach here first')
      + sleeveRow('Large-cap', sv.largeCap, 'the core of your future')
      + sleeveRow('Mid / small-cap', sv.midSmall, ctx.downturn ? 'down hard right now — worst to sell' : 'highest growth — sell last'));
    show($('emIntro'));
    requestAnimationFrame(() => drawDonut('emDonut', [
      { v: sv.liquid, color: COL.cool }, { v: sv.largeCap, color: COL.direct }, { v: sv.midSmall, color: COL.regular },
    ]));
  }
  function sleeveRow(name, val, note) { return '<div class="sleeve"><span class="sl-name">' + name + '</span><span class="sl-val">' + inrShort(val) + '</span><span class="sl-note">' + note + '</span></div>'; }
  function emToStrike() {
    Sound.unlock(); Sound.strike();
    hide($('emIntro'));
    const ctx = state.emCtx, em = ctx.em;
    const copy = {
      icu: { tag: 'ICU', title: 'Someone you love is in the ICU.', pressure: 'The deposit clears, or treatment stops. No time to think.' },
      business: { tag: 'BUSINESS LOSS', title: 'The business just broke.', pressure: 'Salaries and suppliers, due this week. No salary slip to fall back on.' },
      pandemic: { tag: 'PANDEMIC', title: 'A pandemic. COVID.', pressure: 'Income gone, a bill due, the market in free-fall — all at once.' },
      war: { tag: 'WAR', title: 'War breaks out.', pressure: 'Cash for safety, now — in the week selling hurts most.' },
    };
    const cp = copy[em.id] || copy.icu;
    setText('emStrikeTag', cp.tag);
    setText('emStrikeTitle', cp.title);
    setText('emStrikeWhat', cp.pressure);
    setText('emStrikeNeed', inrShort(ctx.need));
    setHTML('emStrikePressure', 'You never planned to touch your investments. Now you have to.');
    show($('emStrike'));
    setTimeout(() => say('You need ' + amountWords(ctx.need) + ', now.', { rate: 0.92 }), 700);
  }
  function emToDecision() { hide($('emStrike')); show($('emDecision')); Sound.setHeart(92); } // the clock, running
  function emChoose(r) {
    state.emResponse = r; Sound.stopHeart(); Sound.tick();
    hide($('emDecision')); show($('emCall'));
    const wave = $('emCallWave'); if (wave) wave.hidden = true;
    setText('emCallStatus', 'She calls her MD — connecting…');
    setHTML('emQuote', '');
    const ans = $('emAnswer'); if (ans) ans.hidden = false;
    const go = $('emCallBtn'); if (go) go.hidden = true;
    Sound.whoosh(); Sound.ring();
  }
  function answerEmCall() {
    const ans = $('emAnswer'); if (ans) ans.hidden = true;
    const av = document.querySelector('#emCall .call-avatar'); if (av) av.classList.remove('ringing');
    const wave = $('emCallWave'); if (wave) wave.hidden = false;
    setText('emCallStatus', 'Connected · MD');
    revealQuote('emQuote', '"' + RM_EM_LINE + '"', 350, 130);
    narrate(RM_EM_LINE, { rate: 0.98, clip: 'voice/emergency.mp3?v=20260618' }, () => { const go = $('emCallBtn'); if (go) go.hidden = false; });
  }
  function emToResult() {
    stopCallTimer(); hide($('emCall')); Sound.whoosh(); Sound.resolve();
    const sim = runEmergency(state.sip, state.emergencyId, state.emResponse, state.downturn, state.years, state.severity);
    buildTex(sim.N);
    state.sim = sim; renderEmergencyResult(sim); show($('emergency'));
    const a = { values: sim.you.value, color: COL.crash, width: 3, glow: true, dot: true, texture: true };
    const b = { values: sim.directSmart.value, color: COL.direct, width: 2.4, alpha: 0.85, texture: true };
    requestAnimationFrame(() => drawJourney('emResultCanvas', a, b, sim.N, sim.years, sim.you.final < sim.directSmart.final));
  }
  function emActionLabel(sim) {
    if (sim.youResponse === 'sellLosers') return sim.downturn ? 'sold the fund that had crashed — locking the loss' : 'sold your highest-growth fund to raise it';
    return EM_LABEL[sim.youResponse];
  }
  function renderEmergencyResult(sim) {
    // Headline isolates BEHAVIOUR (same door): YOU vs the surgical "steady call".
    // The Regular friend appears only in supporting copy, to make plain that the
    // fee was never the point — the call was.
    const em = sim.em, need = sim.need, you = sim.you, smart = sim.directSmart, friend = sim.friend;
    const surgical = sim.youResponse === 'surgical';
    setText('emTitle', em.name);
    setHTML('emLine', 'You needed <b>' + inrShort(need) + '</b>. Alone, under pressure, you <b>' + emActionLabel(sim) + '</b>.' + (sim.downturn ? ' <span class="em-hard">Mid-crash.</span>' : ''));
    setText('emYouLabel', surgical ? 'YOU — you stayed precise' : 'YOU — alone, afraid');
    setText('emFriendLabel', 'A SINGLE STEADY CALL');
    countUp($('emYouFinal'), you.final, 1400, inrShort);
    countUp($('emFriendFinal'), smart.final, 1400, inrShort);
    const gap = smart.final - you.final;
    setHTML('emGapLine', surgical
      ? '<span class="good">You matched the steady call — almost no one does this alone.</span>'
      : '<span class="bad">' + inr(gap) + ' less than one calm decision would have left you.</span>');
    // Short verdict (one line) + the single HERO insight, big. Detail moves
    // into the maths panel so the finish page stays clean and unmissable.
    setHTML('emVerdict', surgical ? 'You kept a temporary emergency temporary.' : 'A temporary emergency just became a permanent setback.');
    setHTML('emResonate', surgical
      ? 'It was never about being smart, or lucky.<br>It was having a plan — and the nerve to follow it.'
      : 'The difference wasn\'t intelligence.<br>It wasn\'t luck.<br>It was having <b>someone to stop a temporary emergency from becoming a permanent one</b>.');
    setHTML('emHonest', ''); // folded into the maths panel below
    // Sourcing detail teaches the sequencing without crowding the hero copy.
    const drewMid = you.fromMid > 1;
    const sourcing = sim.youResponse === 'panic'
      ? 'sold everything — far more than the emergency'
      : (drewMid ? 'had to dip into the mid-cap' : 'left the equity to keep compounding');
    const steadySrc = smart.fromLiquid >= smart.need - 1 ? 'covered it entirely from the liquid buffer'
      : 'took the liquid buffer first, then a little large-cap';
    setHTML('emMathsPanel', mathsRows([
      ['Corpus when it struck (year ' + sim.crashYear + ')', inr(you.corpusAtEmergency), 'computed'],
      ['Emergency to raise', inr(need), 'computed'],
      ['You took out', inr(you.took) + (you.idleCash > 0 ? ' (₹' + Math.round(you.idleGrown).toLocaleString('en-IN') + ' later, in a bank)' : '') + ' — ' + sourcing, 'computed'],
      ['The steady call', steadySrc, 'computed'],
      ['YOU — at year ' + sim.years + ' (XIRR ' + pct(you.xirr) + ')', inr(you.final), 'computed'],
      ['A steady call — same door, surgical (XIRR ' + pct(smart.xirr) + ')', inr(smart.final), 'computed'],
      ['Your guided friend — Regular, after the 1% fee', inr(friend.final), 'computed'],
      ['Behaviour cost (you vs the steady call)', inr(gap), 'computed'],
      ['Sleeve returns', 'Liquid 6% · Large-cap 12% · Mid/small 15%', 'assumption'],
      ['Idle cash earns', '4% a year (a bank / FD)', 'assumption'],
      ['Emergency size', sim.sev.label + ' (' + Math.round(need / you.corpusAtEmergency * 100) + '% of corpus)', 'assumption'],
    ]) + '<p class="maths-note">Your friend on Regular finished with <b>' + inrShort(friend.final) + '</b> even after her 1% fee — the fee was never the point. The headline compares the same investor (only behaviour differs), so the fee can\'t flatter either side. A veteran\'s footnote: for a short gap, an RM might suggest a <b>loan against the funds</b> rather than selling at all. Every ₹ is computed from month-by-month units × NAV; only the labelled assumptions are inputs.</p>');
    closeMaths('emMathsPanel', 'emMathsToggle');
  }

  /* ===================== Wiring ===================== */
  function hideAllOverlays() { ['pledge', 'silence', 'youDecision', 'friendReveal', 'collision', 'result', 'luck', 'grid', 'emIntro', 'emStrike', 'emDecision', 'emCall', 'emergency'].forEach((id) => hide($(id))); }
  function on(id, type, fn) { const el = $(id); if (el) el.addEventListener(type, fn); }
  function backToSetup() { Sound.stopAll(); Voice.stop(); stopCallTimer(); cancelAnimationFrame(state.raf); hideAllOverlays(); hide($('stage')); hide($('emergency')); state.wizIndex = 0; showWizStep(0); show($('setup')); }

  function boot() {
    // Kick the voice list loading at startup so a fast LOCAL voice is already
    // selected by the time Begin is pressed (avoids picking a slow default).
    try { window.speechSynthesis && window.speechSynthesis.getVoices(); } catch (e) {}
    // Recorded opening clip (instant + identically-timed on every device). When
    // present at this path it is used and the doors sync to ITS playback; if it
    // is missing/blocked, we fall back to the live voice. OPEN_M1/M2 are the
    // fractions of the clip at which each door unlocks (tune to the recording:
    // ~when "market crash" and "personal emergency" are spoken).
    const OPENING_SRC = 'voice/opening.mp3?v=20260618', OPEN_M1 = 0.49, OPEN_M2 = 0.76;
    on('introBtn', 'click', () => {
      Sound.unlock(); Sound.openSwell(); hide($('intro'));
      const crash = document.querySelector('#w_scenario .crash-scn');
      const em = document.querySelector('#w_scenario .em-scn');
      // Both doors appear INSTANTLY, locked (closed, dim, padlock); each UNLOCKS
      // exactly as its name is spoken — synced to the recorded clip's timeline
      // (or the live voice's word-boundaries when the clip isn't available).
      [crash, em].forEach((el) => { if (el) { el.classList.remove('open', 'reveal-in', 'chosen', 'dismiss'); void el.offsetWidth; el.classList.add('locked'); } });
      const openDoor = (el) => { if (!el || !el.classList.contains('locked')) return; el.classList.remove('locked'); el.classList.add('open'); Sound.tick(); Sound.whoosh(); if (navigator.vibrate) navigator.vibrate(12); };
      let f1 = false, f2 = false;
      const door1 = () => { if (!f1) { f1 = true; openDoor(crash); } };
      const door2 = () => { if (!f2) { f2 = true; openDoor(em); } };
      // Absolute backstop — the doors can never stay stuck, whatever happens.
      setTimeout(door1, 5000); setTimeout(door2, 6500);

      if (!Voice.isEnabled()) { setTimeout(door1, 600); setTimeout(door2, 1100); return; } // muted → silent stagger

      const line = 'What do you want to face? A market crash… or a personal emergency.';
      const ttsOpening = () => {
        const spoke = Voice.speakSynced(line, [{ at: line.indexOf('market'), fn: door1 }, { at: line.indexOf('personal'), fn: door2 }]);
        if (spoke) { setTimeout(door1, 2400); setTimeout(door2, 4400); }
        else { setTimeout(door1, 600); setTimeout(door2, 1100); }
      };
      let clipStarted = false, fellBack = false;
      const useTTS = () => { if (clipStarted || fellBack) return; fellBack = true; ttsOpening(); };
      try {
        const clip = new Audio(OPENING_SRC); clip.preload = 'auto';
        clip.addEventListener('playing', () => { clipStarted = true; });
        clip.addEventListener('timeupdate', () => { const d = clip.duration; if (d && isFinite(d)) { if (clip.currentTime >= d * OPEN_M1) door1(); if (clip.currentTime >= d * OPEN_M2) door2(); } });
        clip.addEventListener('ended', () => { door1(); door2(); });
        clip.addEventListener('error', useTTS);
        const pr = clip.play(); if (pr && pr.catch) pr.catch(useTTS);
        setTimeout(useTTS, 600); // clip hasn't started → use the live voice
      } catch (e) { useTTS(); }
    });
    // Premium tactile feedback on every tap: a soft click + a light haptic.
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') && e.target.id !== 'muteBtn') { Sound.ui(); if (navigator.vibrate) navigator.vibrate(8); }
    });
    on('muteBtn', 'click', () => { const onNow = Sound.toggle(); Voice.setEnabled(onNow); if (!onNow) document.body.classList.remove('narrating'); const b = $('muteBtn'); if (b) b.textContent = onNow ? '🔊' : '🔇'; });

    // Wizard: each step is a group of .opt buttons.
    document.querySelectorAll('.wstep').forEach((step) => {
      const name = step.id.replace('w_', '');
      step.addEventListener('click', (ev) => { const b = ev.target.closest('.opt'); if (b) wizPick(name, b.dataset.val, b); });
    });
    on('wizBack', 'click', wizBack);
    on('downturnToggle', 'change', (e) => { state.downturn = e.target.checked; });

    on('pledgeChoices', 'click', (ev) => { const b = ev.target.closest('button[data-pledge]'); if (b) makePledge(b.dataset.pledge); });

    on('silenceContinue', 'click', openYouDecision);
    on('youChoices', 'click', (ev) => { const b = ev.target.closest('button[data-choice]'); if (b) choose(b.dataset.choice); });
    on('friendAnswer', 'click', answerFriendCall);
    on('friendRevealBtn', 'click', () => { stopCallTimer(); hide($('friendReveal')); showCollision(); });
    on('collisionBtn', 'click', afterCollision);

    on('replayBtn', 'click', () => { hideAllOverlays(); showPledge(); });
    on('shareBtn', 'click', shareCrash);
    on('emShareBtn', 'click', shareEmergency);
    on('luckBtn', 'click', openLuck);
    on('luckClose', 'click', () => { hide($('luck')); stopLife(); });
    on('gridBtn', 'click', openGrid);
    on('gridClose', 'click', () => hide($('grid')));
    on('changeBtn', 'click', backToSetup);
    wireMaths('mathsToggle', 'mathsPanel');

    on('emIntroBtn', 'click', emToStrike);
    on('emStrikeBtn', 'click', emToDecision);
    on('emChoices', 'click', (ev) => { const b = ev.target.closest('button[data-choice]'); if (b) emChoose(b.dataset.choice); });
    on('emAnswer', 'click', answerEmCall);
    on('emCallBtn', 'click', emToResult);
    on('emReplay', 'click', startEmergency);
    on('emLuckBtn', 'click', openLuck);
    on('emGridBtn', 'click', openGrid);
    on('emChangeBtn', 'click', backToSetup);
    wireMaths('emMathsToggle', 'emMathsPanel');

    window.addEventListener('resize', () => { if (!state.sim) return; if ($('stage') && !$('stage').hidden) renderStage(); });

    showWizStep(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
