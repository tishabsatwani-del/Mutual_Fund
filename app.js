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
const EVENTS = {
  covid: {
    id: 'covid', name: 'COVID-19 crash, 2020', hypothetical: false,
    depth: 0.38, fallMonths: 1, recoveryMonths: 9,
    tag: 'The fast one',
    what: 'A global pandemic shut the world economy almost overnight. Indian markets fell about 38% in barely a month — then, fuelled by stimulus, recovered most of it within months. Panic was punished brutally.',
  },
  gfc: {
    id: 'gfc', name: '2008 Financial Crisis', hypothetical: false,
    depth: 0.60, fallMonths: 14, recoveryMonths: 24,
    tag: 'The deep, slow one',
    what: "US sub-prime home loans collapsed and Lehman Brothers — a giant investment bank — went bankrupt, freezing global credit. Indian indices fell about 60% over roughly 14 months. It was the deepest, slowest fall in modern memory, and the panic 'felt right' the longest.",
  },
  corr2022: {
    id: 'corr2022', name: '2022 correction', hypothetical: false,
    depth: 0.18, fallMonths: 8, recoveryMonths: 12,
    tag: 'The moderate one',
    what: 'After COVID stimulus, inflation surged worldwide. Central banks raised interest rates sharply, foreign investors pulled money out of India, and the market drifted down about 18% through the year before steadying.',
  },
  iranUsa: {
    id: 'iranUsa', name: 'Iran–USA war', hypothetical: true,
    depth: 0.16, fallMonths: 5, recoveryMonths: 13,
    tag: 'The oil shock (hypothetical)',
    what: 'A hypothetical Gulf war: conflict spikes oil prices and rattles global markets — a fall of around 16%. Like all geopolitical shocks, it ends on uncertainty — in the moment, you never know how deep it goes or when it turns.',
  },
  indiaPak: {
    id: 'indiaPak', name: 'India–Pakistan war', hypothetical: true,
    depth: 0.10, fallMonths: 2, recoveryMonths: 5,
    tag: 'The short scare (hypothetical)',
    what: 'A hypothetical India–Pakistan flare-up. History is reassuring: past confrontations (Kargil 1999, Balakot 2019) caused only short, shallow dips of around 8–10% that markets recovered within weeks to months. The fear was always far bigger than the lasting damage.',
  },
};

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
 * price glides DOWN to (1-depth)·peak over `fallMonths`, then back UP to the
 * EXACT undisturbed-trend level over `recoveryMonths` (no scar), then resumes
 * normal growth. Geometric within each phase — the honest way prices move.
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
      const target = nav[S] * Math.pow(1 + rate, fall + rec);
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
  const S = nav._S, reentry = nav._healed + 1;
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
  return summarise(value, sip, N);
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

/** Full single-path run. Crash at the EXACT midpoint of the chosen horizon. */
function runSinglePath(sip, eventId, years) {
  const ev = EVENTS[eventId] || EVENTS.covid;
  const Y = years || DEFAULT_YEARS;
  const N = Y * 12, S = Math.round(N / 2);   // standardized: midpoint

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
  // Index CAGR (the market itself) — exactly 12% for Direct as it heals to trend.
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
  hold:  { id: 'hold',  label: 'held through everything' },
  panic: { id: 'panic', label: 'sold when it fell hard', drawdown: 0.25 },
};
function simPolicyPath(nav, N, sip, policy) {
  let units = 0, cash = 0, peak = nav[0], out = false, reentryPeak = 0;
  for (let m = 0; m < N; m++) {
    if (nav[m] > peak) peak = nav[m];
    if (policy.id === 'panic') {
      if (!out && nav[m] < peak * (1 - policy.drawdown)) { cash += units * nav[m]; units = 0; out = true; reentryPeak = peak; }
      else if (out && nav[m] >= reentryPeak) { units += cash / nav[m]; cash = 0; out = false; }
    }
    if (out) cash += sip; else units += sip / nav[m];
  }
  const final = units * nav[N] + cash;
  return { final, xirr: xirrFromSIP(sip, N, final) };
}
function runMonteCarlo(sip, youPolicy, friendPolicy, nPaths, seed, years) {
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
    const you = simPolicyPath(navD, N, sip, youP);
    const fr = simPolicyPath(navR, N, sip, friendP);
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
  return { n, p05: q(0.05), p50: q(0.50), p95: q(0.95), mean: sorted.reduce((s, v) => s + v, 0) / n };
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
  for (let m = 0; m <= S; m++) if (m < N) for (const k in SLEEVES) units[k] += (sip * SLEEVES[k].weight) / navs[k][m];
  const valueAt = (m) => Object.keys(units).reduce((s, k) => s + units[k] * navs[k][m], 0);
  const corpusAtEmergency = valueAt(S);
  const sleeveValues = {};
  for (const k in units) sleeveValues[k] = units[k] * navs[k][S];

  const cfg = EM_RESPONSES[response] || EM_RESPONSES.surgical;
  let took = 0, idleCash = 0, shortfall = 0, fromMid = 0;
  if (cfg.sellAll) {
    took = corpusAtEmergency; idleCash = Math.max(corpusAtEmergency - need, 0);
    for (const k in units) units[k] = 0;
  } else {
    let remaining = need;
    for (const sleeve of cfg.order) {
      if (remaining <= 0) break;
      const avail = units[sleeve] * navs[sleeve][S];
      const draw = Math.min(avail, remaining);
      if (sleeve === 'midSmall') fromMid += draw;
      units[sleeve] -= draw / navs[sleeve][S];
      remaining -= draw;
    }
    took = need - Math.max(remaining, 0);
    shortfall = Math.max(remaining, 0); // emergency exceeded the whole portfolio
  }
  const resumeMonth = cfg.killSIP ? Infinity : S + 1 + cfg.pauseMonths;
  const flows = [];
  for (let m = 0; m <= S; m++) if (m < N) flows.push({ t: m / 12, amount: -sip });
  for (let m = S + 1; m < N; m++) {
    if (m < resumeMonth) continue;
    for (const k in SLEEVES) units[k] += (sip * SLEEVES[k].weight) / navs[k][m];
    flows.push({ t: m / 12, amount: -sip });
  }
  const final = valueAt(N) + idleCash;
  flows.push({ t: S / 12, amount: took });
  flows.push({ t: N / 12, amount: final });
  return { response, corpusAtEmergency, sleeveValues, took, need, shortfall, fromMid, final,
    sipSurvived: !cfg.killSIP, idleCash, xirr: xirr(flows) };
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
    cagr, xirr, xirrFromSIP, buildEventNav, buildTrendNav,
    simHold, simPause, simSell, peakRegainMonth, runSinglePath,
    genMarketReturns, navFromReturns, simPolicyPath, runMonteCarlo, distribution,
    EMERGENCIES, SEVERITY, EM_RESPONSES, SLEEVES, simEmergency, runEmergency, MC_POLICIES,
  };
}

/* =====================================================================
 * 2. THE EXPERIENCE  (browser only)
 * ---------------------------------------------------------------------
 * One idea at a time. Heavy beats HOLD until the user taps. Big type. One
 * headline number; the full maths is one tap away. Crash at the exact midpoint
 * of the chosen horizon, told upfront so it never feels arbitrary.
 * ===================================================================== */
if (typeof document !== 'undefined') (function () {
  'use strict';

  /* ---- Formatting. ---- */
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

  const $ = (id) => document.getElementById(id);
  const show = (el) => { if (!el) return; el.hidden = false; requestAnimationFrame(() => el.classList.add('show')); };
  const hide = (el) => { if (!el) return; el.classList.remove('show'); el.hidden = true; };
  const setHTML = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
  const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const easeInOut = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COL = { direct: '#34d399', regular: '#e8b257', crash: '#f37070', cool: '#7e93d4', ghost: '#cbb26b',
    pause: '#5b9cf0', sellBack: '#a78bfa', sellWait: '#f37070' };
  const BEHAVIOURS = {
    hold:     { label: 'Held',                     color: COL.direct },
    pause:    { label: 'Paused the SIP',           color: COL.pause },
    sellBack: { label: 'Sold, bought back',        color: COL.sellBack },
    sellWait: { label: 'Sold and waited',          color: COL.sellWait },
  };
  const EM_LABEL = { panic: 'redeemed everything', surgical: 'took only what you needed',
    sellLosers: 'sold the fallen fund', sipKill: 'stopped the SIP' };

  const state = {
    scenario: 'crash', years: 20, sip: 10000, eventId: 'covid',
    emergencyId: 'icu', severity: 'major', downturn: false,
    sim: null, choice: null, emResponse: null, emCtx: null,
    head: 0, phase: 'idle', phaseStart: null, raf: 0, yMax: 1,
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
  function drawLines(c, w, h, N, yMax, lines, head, pad) {
    const p = pad || { l: 18, r: 18, t: 26, b: 24 };
    const X = (m) => p.l + (m / N) * (w - p.l - p.r), Y = (v) => (h - p.b) - (v / yMax) * (h - p.t - p.b);
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const yy = p.t + i * (h - p.t - p.b) / 3; c.beginPath(); c.moveTo(p.l, yy); c.lineTo(w - p.r, yy); c.stroke(); }
    for (const line of lines) {
      const pts = pointsUpTo(line.values, head == null ? N : head);
      if (!pts.length) continue;
      if (line.fill) {
        c.beginPath(); c.moveTo(X(pts[0][0]), h - p.b);
        for (const [m, v] of pts) c.lineTo(X(m), Y(v));
        c.lineTo(X(pts[pts.length - 1][0]), h - p.b); c.closePath();
        const g = c.createLinearGradient(0, p.t, 0, h - p.b); g.addColorStop(0, line.fill); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fill();
      }
      c.save(); c.globalAlpha = line.alpha == null ? 1 : line.alpha; c.strokeStyle = line.color; c.lineWidth = line.width || 2;
      c.lineJoin = 'round'; c.lineCap = 'round'; if (line.dash) c.setLineDash(line.dash); if (line.glow) { c.shadowColor = line.color; c.shadowBlur = 14; }
      c.beginPath();
      for (let i = 0; i < pts.length; i++) { const [m, v] = pts[i]; if (i === 0) c.moveTo(X(m), Y(v)); else c.lineTo(X(m), Y(v)); }
      c.stroke(); c.restore();
      if (line.dot) { const [m, v] = pts[pts.length - 1]; c.save(); c.shadowColor = line.color; c.shadowBlur = 18; c.fillStyle = line.color; c.beginPath(); c.arc(X(m), Y(v), 5, 0, Math.PI * 2); c.fill(); c.restore(); }
    }
  }

  /* ===================== SCENARIO A — the crash ===================== */
  function renderStage() {
    const cv = $('stageCanvas'); if (!cv) return;
    const { w, h, c } = fitCanvas(cv);
    const sim = state.sim, N = sim.N;
    const pre = state.phase === 'climb' || state.phase === 'crash';
    let lines, front;
    if (pre) {
      const crashing = state.phase === 'crash', d = sim.direct.hold.value, r = sim.regular.hold.value;
      front = d;
      lines = [
        { values: r, color: crashing ? hexFill(COL.cool, 0.9) : COL.regular, width: 2.4, alpha: 0.85 },
        { values: d, color: crashing ? COL.cool : COL.direct, width: 3.4, glow: true, dot: true, fill: crashing ? hexFill(COL.cool, 0.16) : hexFill(COL.direct, 0.16) },
      ];
    } else {
      const yours = sim.direct[state.choice], calm = sim.direct.hold;
      front = yours.value;
      lines = [
        { values: calm.value, color: COL.ghost, width: 2.2, alpha: 0.4, dash: [5, 6] },
        { values: yours.value, color: BEHAVIOURS[state.choice].color, width: 3.4, glow: true, dot: true, fill: hexFill(BEHAVIOURS[state.choice].color, 0.16) },
      ];
    }
    drawLines(c, w, h, N, state.yMax, lines, state.head);
    const corpus = valueAt(front, state.head);
    setText('corpus', inr(corpus));
    setText('corpusShort', '≈ ' + inrShort(corpus));
    const months = Math.min(Math.floor(state.head), N);
    setText('yearLabel', 'Year ' + Math.min(Math.floor(state.head / 12), sim.years) + ' / ' + sim.years);
    setText('invested', 'Invested ' + inrShort(state.sip * months));
    const bar = $('climbProg'); if (bar) bar.style.width = Math.min(100, state.head / N * 100) + '%';
  }

  const CLIMB_MS = reduceMotion ? 200 : 7000, CRASH_MS = reduceMotion ? 150 : 3200, DIVERGE_MS = reduceMotion ? 200 : 6000;
  function tensionCue() { if (!reduceMotion && navigator.vibrate) navigator.vibrate([20, 70, 30]); }

  function loop(ts) {
    if (state.phaseStart == null) state.phaseStart = ts;
    const e = ts - state.phaseStart, sim = state.sim, N = sim.N, S = sim.S, bottom = sim.navDirect._bottom;
    if (state.phase === 'climb') {
      const p = Math.min(e / CLIMB_MS, 1); state.head = S * easeInOut(p); renderStage();
      if (p >= 1) { state.phase = 'crash'; state.phaseStart = null; $('stage').classList.add('crashing'); tensionCue(); }
      state.raf = requestAnimationFrame(loop);
    } else if (state.phase === 'crash') {
      const p = Math.min(e / CRASH_MS, 1); state.head = S + (bottom - S) * p; renderStage();
      if (p >= 1) { cancelAnimationFrame(state.raf); enterSilence(); return; }
      state.raf = requestAnimationFrame(loop);
    } else if (state.phase === 'diverge') {
      const p = Math.min(e / DIVERGE_MS, 1); state.head = bottom + (N - bottom) * easeInOut(p); renderStage();
      if (p >= 1) { cancelAnimationFrame(state.raf); openResult(); return; }
      state.raf = requestAnimationFrame(loop);
    }
  }

  function startCrash() {
    state.sim = runSinglePath(state.sip, state.eventId, state.years);
    state.choice = null; state.head = 0; state.phase = 'climb'; state.phaseStart = null;
    state.yMax = state.sim.direct.hold.final * 1.08;
    const marker = $('climbMarker'); if (marker) marker.style.left = (state.sim.S / state.sim.N * 100) + '%';
    $('stage').classList.remove('crashing');
    hideAllOverlays(); hide($('setup')); hide($('emergency'));
    show($('stage'));
    cancelAnimationFrame(state.raf); state.raf = requestAnimationFrame(loop);
  }

  // Loss at a glance — big number, one before→after row, one line of context.
  function enterSilence() {
    const sim = state.sim;
    const peak = sim.direct.hold.value[sim.S], bottom = sim.direct.hold.value[sim.navDirect._bottom];
    setText('silDepth', Math.round(sim.ev.depth * 100));
    setText('silFrom', inrShort(peak)); setText('silTo', inrShort(bottom));
    setText('silContext', sim.years / 2 + ' years of investing. Then ' + sim.ev.name + '.');
    show($('silence'));
  }
  function openSplit() {
    hide($('silence')); renderFriendPanel(); show($('split'));
    const wash = () => { const s = $('split'); if (s) s.classList.add('called'); };
    if (reduceMotion) wash(); else setTimeout(wash, 1100);
  }
  function renderFriendPanel() {
    const cv = $('friendCanvas'); if (!cv) return;
    const sim = state.sim, { w, h, c } = fitCanvas(cv);
    drawLines(c, w, h, sim.N, state.yMax, [{ values: sim.regular.hold.value, color: COL.regular, width: 2.8, glow: true, dot: true, fill: hexFill(COL.regular, 0.14) }], sim.navRegular._healed, { l: 10, r: 10, t: 14, b: 14 });
  }
  function choose(choice) {
    state.choice = choice;
    const s = $('split'); if (s) s.classList.remove('called');
    hide($('split')); $('stage').classList.remove('crashing');
    if (choice === 'sellBack' || choice === 'sellWait') show($('relief')); else beginDiverge();
  }
  function beginDiverge() {
    hide($('relief')); show($('stage'));
    state.phase = 'diverge'; state.phaseStart = null;
    cancelAnimationFrame(state.raf); state.raf = requestAnimationFrame(loop);
  }

  /* ---- Result: ONE headline; maths one tap away. ---- */
  function openResult() {
    const sim = state.sim, yours = sim.direct[state.choice], friend = sim.regular.hold, calm = sim.direct.hold;
    setText('youLabel', 'YOU · Direct · ' + BEHAVIOURS[state.choice].label);
    setText('friendLabelR', 'FRIEND · Regular · Held');
    $('youFinal').style.color = BEHAVIOURS[state.choice].color;
    countUp($('youFinal'), yours.final, 1500, inrShort);
    countUp($('friendFinal'), friend.final, 1500, inrShort);

    const diff = yours.final - friend.final;
    if (diff >= 0) setHTML('gapLine', '<span class="good">You finished ' + inr(Math.abs(diff)) + ' ahead of your friend.</span>');
    else setHTML('gapLine', '<span class="bad">You finished ' + inr(Math.abs(diff)) + ' behind your friend.</span>');

    setHTML('verdict', verdictFor(state.choice, yours.final, friend.final, sim));

    // The maths panel (computed vs assumption, fully auditable).
    const feeSaved = sim.feeSavingRupees, behaviourCost = calm.final - yours.final;
    setHTML('mathsPanel',
      mathsRows([
        ['Total you invested (₹' + state.sip.toLocaleString('en-IN') + '×' + sim.N + ' months)', inr(yours.invested), 'computed'],
        ['YOUR final corpus', inr(yours.final), 'computed'],
        ['YOUR return (XIRR)', pct(yours.xirr), 'computed'],
        ['Friend\'s final corpus', inr(friend.final), 'computed'],
        ['Friend\'s return (XIRR)', pct(friend.xirr), 'computed'],
        ['The market itself (CAGR)', pct(sim.indexCagr), 'computed'],
        ['What the fee saved you (Direct vs Regular, both holding)', inr(feeSaved), 'computed'],
        ['What your crash decision cost you (vs holding)', inr(behaviourCost), 'computed'],
        ['Assumed returns', 'Direct 12% / Regular 11% a year', 'assumption'],
        ['Assumed drawdown', '−' + Math.round(sim.ev.depth * 100) + '% over ' + sim.ev.fallMonths + ' mo, recover ' + sim.ev.recoveryMonths + ' mo', 'assumption'],
      ]) + '<p class="maths-note">XIRR is the one annual rate that makes all your monthly investments add up to the final value — the correct return for a SIP. Every ₹ above is computed from the month-by-month units × NAV; only the two assumptions are inputs.</p>');
    closeMaths('mathsPanel', 'mathsToggle');
    show($('result'));
  }

  function verdictFor(choice, yours, friendFinal, sim) {
    const youHeld = choice === 'hold', youAhead = yours >= friendFinal;
    if (youHeld && youAhead)
      return 'You both did nothing — and you kept more. The cheaper door quietly paid off.'
        + '<span class="verdict-sub">Holding even beat a crash-free market by about <b>' + inrShort(Math.max(sim.direct.hold.final - sim.directNoCrash, 0)) + '</b>: the months below trend bought you cheaper units.</span>';
    if (!youHeld && !youAhead)
      return 'You saved the fee — and lost far more.'
        + '<span class="verdict-sub">Her plan bought the one thing that mattered: a voice that said <i>don\'t sell</i>. She isn\'t smarter than you. She just wasn\'t alone.</span>';
    if (!youHeld && youAhead) {
      // Concrete, computed "what a deeper crash would have done".
      const gfc = runSinglePath(state.sip, 'gfc', state.years);
      const deepCost = gfc.direct.hold.final - gfc.direct.sellWait.final;
      return 'This fall was shallow, so blinking barely hurt — you even edged ahead.'
        + '<span class="verdict-sub">Don\'t mistake that for skill. The same panic in a 2008-style crash would have cost you about <b>' + inrShort(deepCost) + '</b>.</span>';
    }
    return 'Two calm investors. The only gap left was the fee.'
      + '<span class="verdict-sub">When nobody panics, the door decides it — by a little.</span>';
  }

  function countUp(el, to, dur, fmt) {
    if (!el) return;
    if (reduceMotion) { el.textContent = fmt(to); return; }
    const start = performance.now();
    (function step(t) { const p = Math.min((t - start) / dur, 1); el.textContent = fmt(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(performance.now());
  }

  /* ---- Maths panel helpers (reused by both scenarios). ---- */
  function mathsRows(rows) {
    return '<div class="maths-rows">' + rows.map((r) =>
      '<div class="maths-row"><span class="mr-label">' + r[0] + '</span><span class="mr-val">' + r[1]
      + '</span><span class="mr-tag ' + r[2] + '">' + (r[2] === 'computed' ? 'computed' : 'assumption') + '</span></div>').join('') + '</div>';
  }
  function closeMaths(panelId, toggleId) { const p = $(panelId), t = $(toggleId); if (p) p.hidden = true; if (t) t.textContent = 'See the maths ▾'; }
  function wireMaths(toggleId, panelId) {
    on(toggleId, 'click', () => { const p = $(panelId), t = $(toggleId); if (!p) return; p.hidden = !p.hidden; t.textContent = p.hidden ? 'See the maths ▾' : 'Hide the maths ▴'; });
  }

  /* ===================== "Was it luck?" (simplified Monte Carlo) ===================== */
  function openLuck() {
    show($('luck'));
    setHTML('luckBody', '<p class="mc-running">Replaying 1,000 lifetimes…</p>');
    setTimeout(() => {
      const N = 1000;
      const held = runMonteCarlo(state.sip, 'hold', 'hold', N, 4242, state.years);
      const sold = runMonteCarlo(state.sip, 'panic', 'hold', N, 4242, state.years);
      const heldPct = Math.round(held.youAhead / N * 100);
      const soldPct = Math.round(sold.youAhead / N * 100);
      setHTML('luckBody',
        '<p class="luck-intro">We replayed your 20 years across <b>1,000 random markets</b> — booms, crashes, fat tails and all. How often did YOU (Direct) beat your guided friend (Regular, who always holds)?</p>'
        + luckRow('If you HOLD through every crash', heldPct, COL.direct,
            'Holding wasn\'t luck — it came out ahead in <b>' + heldPct + ' of 100</b> futures (the fee you saved, compounding).')
        + luckRow('If you SELL when it falls hard', soldPct, COL.crash,
            'Selling in the fall beat your guided friend in only <b>' + soldPct + ' of 100</b>. The other ' + (100 - soldPct) + ' times, the phone call she had was worth more than the fee you saved.')
        + '<p class="luck-foot">Same money, same markets — the only difference is behaviour. That\'s the whole point.</p>');
    }, 30);
  }
  function luckRow(title, greenPct, color, caption) {
    let dots = '';
    for (let i = 0; i < 100; i++) dots += '<span class="dot' + (i < greenPct ? ' on' : '') + '" style="' + (i < greenPct ? 'background:' + color : '') + '"></span>';
    return '<div class="luck-block"><p class="luck-title">' + title + '</p><div class="dot-grid">' + dots + '</div><p class="luck-cap">' + caption + '</p></div>';
  }

  /* ===================== Every outcome (grid) ===================== */
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
      + '<div class="hedge"><span>Split half-Regular, half-Direct (both holding)?</span><b>' + inrShort(half) + '</b><span class="hedge-sub">It lands right in between — what a hedge does.</span></div>';
    setHTML('gridBody', html); show($('grid'));
  }

  /* ===================== SCENARIO B — the emergency ===================== */
  function startEmergency() {
    const ctx = runEmergency(state.sip, state.emergencyId, null, state.downturn, state.years, state.severity);
    state.emCtx = ctx; state.emResponse = null;
    hideAllOverlays(); hide($('setup')); hide($('stage'));
    setText('emIntroSip', state.sip.toLocaleString('en-IN'));
    setText('emIntroYears', ctx.crashYear);
    setText('emIntroCorpus', inr(ctx.directSmart.corpusAtEmergency));
    const sv = ctx.directSmart.sleeveValues;
    setHTML('emIntroSleeves',
      sleeveRow('Liquid fund', sv.liquid, 'safe, steady — your buffer')
      + sleeveRow('Large-cap', sv.largeCap, 'the core of your wealth')
      + sleeveRow('Mid / small-cap', sv.midSmall, ctx.downturn ? 'highest growth — and right now, deep in the red' : 'highest growth, biggest swings'));
    show($('emIntro'));
  }
  function sleeveRow(name, val, note) {
    return '<div class="sleeve"><span class="sl-name">' + name + '</span><span class="sl-val">' + inrShort(val) + '</span><span class="sl-note">' + note + '</span></div>';
  }
  function emToStrike() {
    hide($('emIntro'));
    const ctx = state.emCtx, em = ctx.em;
    const copy = {
      icu: { tag: 'HOSPITALISATION', title: 'A family member is in the ICU.', pressure: 'The hospital won\'t continue until the deposit clears. Your phone is at 11%. Relatives keep calling. The form doesn\'t care what the market is doing today.' },
      business: { tag: 'BUSINESS LOSS', title: 'The business just took a hit.', pressure: 'A deal collapsed; suppliers and salaries are due this week. There\'s no salary slip to fall back on — the money has to come from the corpus you swore you\'d never touch.' },
      pandemic: { tag: 'PANDEMIC', title: 'A pandemic hits. COVID.', pressure: 'Your income stops, a hospital bill arrives, and the market is in free-fall — all at once. Job losses cluster with crashes; hospitals don\'t wait for green markets.' },
      war: { tag: 'WAR', title: 'War breaks out.', pressure: 'You need cash for family and safety in the exact week markets gap down. The headlines scream; selling now hurts most.' },
    };
    const cp = copy[em.id] || copy.icu;
    setText('emStrikeTag', cp.tag);
    setText('emStrikeTitle', cp.title);
    setText('emStrikeWhat', em.what);
    setText('emStrikeNeed', inrShort(ctx.need));
    setText('emStrikePressure', cp.pressure);
    show($('emStrike'));
  }
  function emToDecision() { hide($('emStrike')); show($('emDecision')); }
  function emChoose(r) { state.emResponse = r; hide($('emDecision')); setText('emCallNeed', inrShort(state.emCtx.need)); show($('emCall')); }
  function emToResult() {
    hide($('emCall'));
    const sim = runEmergency(state.sip, state.emergencyId, state.emResponse, state.downturn, state.years, state.severity);
    state.sim = sim; renderEmergencyResult(sim); show($('emergency'));
  }
  function renderEmergencyResult(sim) {
    const em = sim.em, need = sim.need, you = sim.you, friend = sim.friend, smart = sim.directSmart;
    setText('emTitle', em.name);
    setHTML('emLine', 'You needed <b>' + inrShort(need) + '</b>. You <b>' + EM_LABEL[sim.youResponse] + '</b>.' + (sim.downturn ? ' <span class="em-hard">And the market was falling.</span>' : ''));
    setText('emYouLabel', 'YOU · Direct · alone');
    setText('emFriendLabel', 'FRIEND · Regular · she called');
    countUp($('emYouFinal'), you.final, 1400, inrShort);
    countUp($('emFriendFinal'), friend.final, 1400, inrShort);
    const diff = friend.final - you.final;
    setHTML('emGapLine', diff > 0 ? '<span class="bad">You ended ' + inr(diff) + ' behind your friend — same emergency, same rupees out.</span>' : '<span class="good">You matched her — the call almost no one makes alone.</span>');
    setHTML('emVerdict', emVerdictCopy(sim, diff));
    setHTML('emHonest', 'A disciplined Direct investor making the same call would have <b>' + inrShort(smart.final) + '</b> — even a hair ' + (smart.final >= friend.final ? 'ahead of' : 'behind') + ' her (they saved the fee too). The door was never the point — making this call alone, under pressure, is the hard part. That\'s what her fee bought.');

    setHTML('emMathsPanel',
      mathsRows([
        ['Corpus when it struck (' + sim.crashYear + ' years in)', inr(you.corpusAtEmergency), 'computed'],
        ['Emergency you had to raise', inr(need), 'computed'],
        ['You took out', inr(you.took) + (you.idleCash > 0 ? ' (₹' + Math.round(you.idleCash).toLocaleString('en-IN') + ' left idle)' : ''), 'computed'],
        ['Friend took out', inr(friend.took), 'computed'],
        ['YOUR corpus at year ' + sim.years, inr(you.final), 'computed'],
        ['YOUR return (XIRR)', pct(you.xirr), 'computed'],
        ['Friend\'s corpus at year ' + sim.years, inr(friend.final), 'computed'],
        ['Friend\'s return (XIRR)', pct(friend.xirr), 'computed'],
        ['Sleeve returns', 'Liquid 6% · Large-cap 12% · Mid/small 15% a year', 'assumption'],
        ['Emergency size', sim.sev.label + ' (' + Math.round(need / you.corpusAtEmergency * 100) + '% of your corpus)', 'assumption'],
      ]) + '<p class="maths-note">Every rupee is computed from month-by-month units × NAV across three funds; XIRR is solved from the real dated cash flows. Only the return assumptions and the emergency size you chose are inputs.</p>');
    closeMaths('emMathsPanel', 'emMathsToggle');
  }
  function emVerdictCopy(sim, gap) {
    if (sim.youResponse === 'surgical')
      return 'You made the call most people can\'t make alone — and it barely cost you your future.'
        + '<span class="verdict-sub">Just <b>' + inr(Math.abs(gap)) + '</b> between you and the guided plan. The lesson isn\'t the door — it\'s that under real pressure, almost no one does what you just did.</span>';
    return 'Same emergency, same ' + inrShort(sim.need) + '. She took only the emergency. You took the emergency <b>and your future with it</b> — ' + inr(gap) + ' gone by year ' + sim.years + '.'
      + '<span class="verdict-sub">It was never that she was calmer. On the worst day there was a number she could call — and you had only yourself, at the worst possible moment to decide.</span>';
  }

  /* ===================== Wiring ===================== */
  function hideAllOverlays() {
    ['silence', 'split', 'relief', 'result', 'luck', 'grid', 'emIntro', 'emStrike', 'emDecision', 'emCall', 'emergency'].forEach((id) => hide($(id)));
  }
  function on(id, type, fn) { const el = $(id); if (el) el.addEventListener(type, fn); }
  function wireChips(containerId, key, parse, after) {
    const box = $(containerId); if (!box) return;
    box.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.chip'); if (!btn) return;
      [...box.querySelectorAll('.chip')].forEach((b) => b.classList.toggle('on', b === btn));
      state[key] = parse ? parse(btn.dataset.val) : btn.dataset.val;
      if (after) after();
    });
  }
  function reflectScenario() {
    const crash = state.scenario === 'crash';
    if ($('crashInputs')) $('crashInputs').hidden = !crash;
    if ($('emergencyInputs')) $('emergencyInputs').hidden = crash;
    setText('startBtn', crash ? 'Live the crash' : 'Live the emergency');
    updateHints();
  }
  function updateHints() {
    const cy = state.years / 2;
    if (state.scenario === 'crash') {
      const ev = EVENTS[state.eventId];
      setHTML('eventDesc', '<b>' + ev.tag + '.</b> ' + ev.what);
      setText('crashTiming', 'You invest for ' + state.years + ' years. The crash hits at year ' + cy + '.');
    } else {
      const em = EMERGENCIES[state.emergencyId];
      setHTML('emergencyDesc', em.what + (em.crashLinked ? ' <i>(arrives with a market crash)</i>' : ''));
      setText('emTiming', 'You invest for ' + state.years + ' years. The emergency strikes at year ' + cy + '.');
    }
  }
  function start() { if (state.scenario === 'crash') startCrash(); else startEmergency(); }
  function backToSetup() { cancelAnimationFrame(state.raf); hideAllOverlays(); hide($('stage')); hide($('emergency')); show($('setup')); }

  function boot() {
    on('startBtn', 'click', start);
    wireChips('scenarioChips', 'scenario', null, reflectScenario);
    wireChips('durationChips', 'years', Number, updateHints);
    wireChips('sipChips', 'sip', Number);
    wireChips('eventChips', 'eventId', null, updateHints);
    wireChips('emergencyChips', 'emergencyId', null, updateHints);
    wireChips('severityChips', 'severity', null);
    on('downturnToggle', 'change', (e) => { state.downturn = e.target.checked; });

    on('silenceContinue', 'click', openSplit);
    on('reliefContinue', 'click', beginDiverge);
    on('youChoices', 'click', (ev) => { const b = ev.target.closest('button[data-choice]'); if (b) choose(b.dataset.choice); });

    on('replayBtn', 'click', () => start());
    on('luckBtn', 'click', openLuck);
    on('luckClose', 'click', () => hide($('luck')));
    on('gridBtn', 'click', openGrid);
    on('gridClose', 'click', () => hide($('grid')));
    on('changeBtn', 'click', backToSetup);
    wireMaths('mathsToggle', 'mathsPanel');

    on('emIntroBtn', 'click', emToStrike);
    on('emStrikeBtn', 'click', emToDecision);
    on('emChoices', 'click', (ev) => { const b = ev.target.closest('button[data-choice]'); if (b) emChoose(b.dataset.choice); });
    on('emCallBtn', 'click', emToResult);
    on('emReplay', 'click', startEmergency);
    on('emLuckBtn', 'click', openLuck);
    on('emGridBtn', 'click', openGrid);
    on('emChangeBtn', 'click', backToSetup);
    wireMaths('emMathsToggle', 'emMathsPanel');

    window.addEventListener('resize', () => {
      if (!state.sim) return;
      if ($('stage') && !$('stage').hidden) renderStage();
      if ($('split') && !$('split').hidden) renderFriendPanel();
    });
    reflectScenario();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
