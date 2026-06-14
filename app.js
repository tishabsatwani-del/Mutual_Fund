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
    what: 'The world stopped overnight. Markets fell ~38% in one month — then roared back. The fastest fall, and the fastest forgiveness.',
  },
  gfc: {
    id: 'gfc', name: 'Global Financial Crisis, 2008', hypothetical: false,
    depth: 0.60, fallMonths: 14, recoveryMonths: 24,
    tag: 'The deep, slow one',
    what: 'Banks collapsed worldwide. Markets bled ~60% over 14 long months — the slow crash that made selling feel smart for over a year.',
  },
  corr2022: {
    id: 'corr2022', name: '2022 correction', hypothetical: false,
    depth: 0.18, fallMonths: 8, recoveryMonths: 12,
    tag: 'The slow ache',
    what: 'Inflation and rising interest rates dragged markets down ~18% across the year. Not a catastrophe — just a long, dull ache that tested your patience.',
  },
  war: {
    id: 'war', name: 'War / geopolitical shock', hypothetical: true,
    depth: 0.13, fallMonths: 3, recoveryMonths: 6,
    tag: 'The headline scare',
    what: 'War headlines, an oil shock, troops at the border. Markets dip on fear — history (Kargil, Balakot, the Gulf) says ~10–15%, then recover within months. The scare is bigger than the damage.',
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
    drawCrash, cagr, xirr, xirrFromSIP, buildEventNav, buildTrendNav,
    simHold, simPause, simSell, peakRegainMonth, runSinglePath,
    genMarketReturns, navFromReturns, simPolicyPath, runMonteCarlo, distribution,
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
        master = ctx.createGain(); master.gain.value = on ? 0.9 : 0; master.connect(ctx.destination);
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
      const src = ctx.createBufferSource(); src.buffer = brown(Math.max(2, dur / 1000 + 1)); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(120, T()); lp.frequency.linearRampToValueAtTime(900, T() + dur / 1000);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, T()); g.gain.linearRampToValueAtTime(0.42, T() + dur / 1000);
      src.connect(lp); lp.connect(g); g.connect(master); src.start();
      const sub = tone(60, T(), dur / 1000 + 0.2, 'sine', 0.3); if (sub) sub.frequency.exponentialRampToValueAtTime(32, T() + dur / 1000);
      rumble = { src, g };
    }
    function stopRumble() { if (rumble) { try { rumble.g.gain.cancelScheduledValues(T()); rumble.g.gain.linearRampToValueAtTime(0.0001, T() + 0.15); rumble.src.stop(T() + 0.2); } catch (e) {} rumble = null; } }
    function impact() { if (!init()) return; thump(0.7); const t = T(); const s = ctx.createBufferSource(); s.buffer = brown(0.25); const g = ctx.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); s.connect(g); g.connect(master); s.start(t); s.stop(t + 0.3); }
    function setHeart(bpm) {
      heartBpm = bpm;
      if (heartTimer) { clearInterval(heartTimer); heartTimer = 0; }
      if (!bpm || !ctx) return;
      const beat = () => { thump(0.32); setTimeout(() => thump(0.22), 180); };
      beat(); heartTimer = setInterval(beat, 60000 / bpm);
    }
    function stopHeart() { if (heartTimer) clearInterval(heartTimer); heartTimer = 0; heartBpm = 0; }
    function silenceCut() { stopRumble(); if (pad) { try { pad.gain.cancelScheduledValues(T()); pad.gain.linearRampToValueAtTime(0.0001, T() + 0.25); } catch (e) {} } }
    function stopPad() { if (pad) { try { pad.gain.cancelScheduledValues(T()); pad.gain.linearRampToValueAtTime(0.0001, T() + 0.4); } catch (e) {} } }
    function ring() {
      if (!init()) return;
      for (let k = 0; k < 2; k++) { const t = T() + k * 1.0; tone(440, t, 0.4, 'sine', 0.12); tone(480, t, 0.4, 'sine', 0.12); }
    }
    function tick() { if (init()) tone(660, T(), 0.08, 'triangle', 0.08); }
    function freeze() { if (!init()) return; const t = T(); tone(1200, t, 0.5, 'sine', 0.05); const o = tone(300, t, 0.6, 'sine', 0.12); if (o) o.frequency.exponentialRampToValueAtTime(80, t + 0.55); }
    function stinger(low) { if (!init()) return; const t = T(); if (low) { const o = tone(140, t, 0.8, 'sawtooth', 0.18); if (o) o.frequency.exponentialRampToValueAtTime(60, t + 0.7); } else { tone(392, t, 0.7, 'sine', 0.1); tone(523, t, 0.8, 'sine', 0.08); } }
    function resolve() { if (!init()) return; const t = T(); [261.6, 329.6, 392].forEach((f, i) => tone(f, t + i * 0.08, 1.6, 'sine', 0.09, 0.05)); }
    function stopAll() { stopRumble(); stopHeart(); stopPad(); }
    function toggle() { on = !on; if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, T(), 0.05); return on; }
    function isOn() { return on; }
    return { unlock, startPad, startRumble, stopRumble, impact, setHeart, stopHeart, silenceCut, stopPad, ring, tick, freeze, stinger, resolve, stopAll, toggle, isOn };
  })();

  const state = {
    scenario: 'crash', years: 20, sip: 10000, eventId: 'covid',
    emergencyId: 'icu', severity: 'major', downturn: false,
    pledge: null, choice: null, emResponse: null, emCtx: null, sim: null, luckStep: 0,
    wizIndex: 0, head: 0, phase: 'idle', phaseStart: null, raf: 0, yMax: 1,
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

  /* ===================== WIZARD (one decision per screen) ===================== */
  const WIZ_KEY = { scenario: 'scenario', duration: 'years', sip: 'sip', event: 'eventId', emType: 'emergencyId', severity: 'severity' };
  const WIZ_NUM = { duration: true, sip: true };
  function wizSteps() { return state.scenario === 'crash' ? ['scenario', 'duration', 'sip', 'event'] : ['scenario', 'duration', 'sip', 'emType', 'severity']; }
  function showWizStep(i) {
    const steps = wizSteps();
    state.wizIndex = Math.max(0, Math.min(i, steps.length - 1));
    const name = steps[state.wizIndex];
    document.querySelectorAll('.wstep').forEach((el) => { el.hidden = el.id !== 'w_' + name; });
    // reflect current value
    const key = WIZ_KEY[name], cur = String(state[key]);
    document.querySelectorAll('#w_' + name + ' .opt').forEach((b) => b.classList.toggle('on', b.dataset.val === cur));
    const back = $('wizBack'); if (back) back.hidden = state.wizIndex === 0;
    setHTML('wizDots', steps.map((s, idx) => '<span class="wdot' + (idx === state.wizIndex ? ' on' : '') + '"></span>').join(''));
  }
  function wizPick(name, val) {
    state[WIZ_KEY[name]] = WIZ_NUM[name] ? Number(val) : val;
    const steps = wizSteps();
    if (state.wizIndex >= steps.length - 1) { wizLaunch(); return; }
    showWizStep(state.wizIndex + 1);
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
    const corpus = valueAt(front, state.head), months = Math.min(Math.floor(state.head), N);
    setText('corpus', inr(corpus));
    setText('corpusShort', '≈ ' + inrShort(corpus));
    setText('yearLabel', 'Year ' + Math.min(Math.floor(state.head / 12), sim.years) + ' / ' + sim.years);
    setText('invested', 'You\'ve put in ' + inrShort(state.sip * months));
    const bar = $('climbProg'); if (bar) bar.style.width = Math.min(100, state.head / N * 100) + '%';
  }

  const CLIMB_MS = reduceMotion ? 200 : 7000, CRASH_MS = reduceMotion ? 150 : 3200, DIVERGE_MS = reduceMotion ? 200 : 6000;
  function tensionCue() { if (!reduceMotion && navigator.vibrate) navigator.vibrate([20, 70, 30]); }

  function loop(ts) {
    if (state.phaseStart == null) state.phaseStart = ts;
    const e = ts - state.phaseStart, sim = state.sim, N = sim.N, S = sim.S, bottom = sim.navDirect._bottom;
    if (state.phase === 'climb') {
      const p = Math.min(e / CLIMB_MS, 1); state.head = S * easeInOut(p); renderStage();
      if (p >= 1) { state.phase = 'crash'; state.phaseStart = null; $('stage').classList.add('crashing'); tensionCue(); Sound.startRumble(CRASH_MS); Sound.setHeart(110); }
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

  function startClimb() {
    state.sim = runSinglePath(state.sip, state.eventId, state.years);
    state.choice = null; state.head = 0; state.phase = 'climb'; state.phaseStart = null;
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
    Sound.impact(); Sound.silenceCut(); Sound.setHeart(96); // lone, racing heart
    const peak = sim.direct.hold.value[sim.S], bottom = sim.direct.hold.value[sim.navDirect._bottom];
    setText('silDepth', Math.round(sim.ev.depth * 100));
    setText('silFrom', inrShort(peak)); setText('silTo', inrShort(bottom));
    setText('silContext', (sim.crashYear % 1 ? sim.crashYear.toFixed(1) : sim.crashYear) + ' years in. ' + sim.ev.name + '.');
    show($('silence'));
  }
  function openSplit() {
    hide($('silence')); renderFriendPanel(); show($('split'));
    const wash = () => { const s = $('split'); if (s) s.classList.add('called'); Sound.ring(); Sound.setHeart(60); setTimeout(() => Sound.stopHeart(), 4000); };
    if (reduceMotion) wash(); else setTimeout(wash, 1100);
  }
  function renderFriendPanel() {
    const cv = $('friendCanvas'); if (!cv) return;
    const sim = state.sim, { w, h, c } = fitCanvas(cv);
    drawLines(c, w, h, sim.N, state.yMax, [{ values: sim.regular.hold.value, color: COL.regular, width: 2.8, glow: true, dot: true, fill: hexFill(COL.regular, 0.14) }], sim.navRegular._healed, { l: 10, r: 10, t: 14, b: 14 });
  }
  function choose(choice) { state.choice = choice; Sound.stopHeart(); if (CHOICE_CAT[choice] === 'sell') Sound.freeze(); else Sound.tick(); const s = $('split'); if (s) s.classList.remove('called'); hide($('split')); $('stage').classList.remove('crashing'); showCollision(); }

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
  function afterCollision() { hide($('collision')); show($('stage')); state.phase = 'diverge'; state.phaseStart = null; cancelAnimationFrame(state.raf); state.raf = requestAnimationFrame(loop); }

  /* ---- Result. ---- */
  function openResult() {
    Sound.stopHeart(); Sound.resolve();
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
      ['Assumed drawdown', '−' + Math.round(sim.ev.depth * 100) + '% over ' + sim.ev.fallMonths + ' mo, recover ' + sim.ev.recoveryMonths + ' mo', 'assumption'],
    ])) + '<p class="maths-note">XIRR is the one annual rate that makes your monthly investments equal the final value — the correct return for a SIP. Every ₹ is computed from month-by-month units × NAV; only the two assumptions are inputs.</p>');
    closeMaths('mathsPanel', 'mathsToggle');
    show($('result'));
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

  /* ===================== "Was it luck?" — sequential, lived ===================== */
  function openLuck() { state.luckStep = 0; show($('luck')); renderLuck(); }
  function renderLuck() {
    const N = 1000;
    if (state.luckStep === 0) {
      setHTML('luckBody', '<p class="mc-running">Replaying 1,000 lifetimes…</p>');
      setTimeout(() => {
        const held = runMonteCarlo(state.sip, 'hold', 'hold', N, 4242, state.years);
        state._luckHeld = Math.round(held.youAhead / N * 100);
        setHTML('luckBody',
          '<p class="luck-intro">We replayed your ' + state.years + ' years across <b>1,000 random markets</b> — booms, crashes, fat tails. <b>YOU (Direct, alone)</b> vs <b>your friend (Regular)</b>, who always holds because someone talks her through it.</p>'
          + luckRow('If you HOLD through every crash', state._luckHeld, COL.direct,
              'Holding wasn\'t luck — you beat your guided friend in <b>' + state._luckHeld + ' of 100</b> futures. That\'s the fee you saved, compounding.')
          + '<button id="luckNext" class="cta">But you swore you\'d hold… what if you sold? →</button>');
        on('luckNext', 'click', () => { state.luckStep = 1; renderLuck(); });
      }, 30);
    } else {
      setHTML('luckBody', '<p class="mc-running">Replaying with a panic-sell…</p>');
      setTimeout(() => {
        const sold = runMonteCarlo(state.sip, 'panic', 'hold', N, 4242, state.years);
        const s = Math.round(sold.youAhead / N * 100);
        setHTML('luckBody',
          luckRow('If you HOLD', state._luckHeld, COL.direct, 'Beat your guided friend in <b>' + state._luckHeld + ' of 100</b>.')
          + luckRow('If you SELL when it falls hard', s, COL.crash,
              'You beat her in only <b>' + s + ' of 100</b>. The other <b>' + (100 - s) + '</b> times, the phone call she had was worth more than the fee you saved.')
          + '<p class="luck-foot">Same money. Same markets. The only difference was your behaviour — and whether someone was there to stop you.</p>');
      }, 30);
    }
  }
  function luckRow(title, greenPct, color, caption) {
    let dots = '';
    for (let i = 0; i < 100; i++) dots += '<span class="dot' + (i < greenPct ? ' on' : '') + '" style="' + (i < greenPct ? 'background:' + color : '') + '"></span>';
    return '<div class="luck-block"><p class="luck-title">' + title + '</p><div class="dot-grid">' + dots + '</div><p class="luck-cap">' + caption + '</p></div>';
  }

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
    setText('emIntroYears', ctx.crashYear);
    setText('emIntroCorpus', inr(ctx.directSmart.corpusAtEmergency));
    const sv = ctx.directSmart.sleeveValues;
    setHTML('emIntroSleeves',
      sleeveRow('Liquid fund', sv.liquid, 'safe buffer')
      + sleeveRow('Large-cap', sv.largeCap, 'your core')
      + sleeveRow('Mid / small-cap', sv.midSmall, ctx.downturn ? 'down hard right now' : 'high growth'));
    show($('emIntro'));
  }
  function sleeveRow(name, val, note) { return '<div class="sleeve"><span class="sl-name">' + name + '</span><span class="sl-val">' + inrShort(val) + '</span><span class="sl-note">' + note + '</span></div>'; }
  function emToStrike() {
    Sound.unlock(); Sound.stinger(true);
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
  }
  function emToDecision() { hide($('emStrike')); show($('emDecision')); }
  function emChoose(r) { state.emResponse = r; hide($('emDecision')); setText('emCallNeed', inrShort(state.emCtx.need)); show($('emCall')); }
  function emToResult() {
    hide($('emCall')); Sound.resolve();
    const sim = runEmergency(state.sip, state.emergencyId, state.emResponse, state.downturn, state.years, state.severity);
    state.sim = sim; renderEmergencyResult(sim); show($('emergency'));
  }
  function renderEmergencyResult(sim) {
    const em = sim.em, need = sim.need, you = sim.you, friend = sim.friend, smart = sim.directSmart;
    setText('emTitle', em.name);
    setHTML('emLine', 'You needed <b>' + inrShort(need) + '</b>. You <b>' + EM_LABEL[sim.youResponse] + '</b>.' + (sim.downturn ? ' <span class="em-hard">Market falling.</span>' : ''));
    setText('emYouLabel', 'YOU · Direct · alone');
    setText('emFriendLabel', 'FRIEND · Regular · she called');
    countUp($('emYouFinal'), you.final, 1400, inrShort);
    countUp($('emFriendFinal'), friend.final, 1400, inrShort);
    const diff = friend.final - you.final;
    setHTML('emGapLine', diff > 0 ? '<span class="bad">' + inr(diff) + ' behind her — same emergency, same rupees out.</span>' : '<span class="good">You matched her — the call almost no one makes alone.</span>');
    setHTML('emVerdict', sim.youResponse === 'surgical'
      ? 'You made the call most people can\'t make alone.<span class="verdict-sub">Just <b>' + inr(Math.abs(diff)) + '</b> between you and the guided plan. Under real pressure, almost no one does what you just did.</span>'
      : 'She took only the emergency. You took the emergency <b>and your future</b>.<span class="verdict-sub">' + inr(diff) + ' gone by year ' + sim.years + ' — not because she was calmer, but because she had a number to call.</span>');
    setHTML('emHonest', 'A disciplined Direct investor would\'ve had <b>' + inrShort(smart.final) + '</b> — even saved the fee. The door was never the point. Making this call alone, under pressure, is — and that\'s what her fee bought.');
    setHTML('emMathsPanel', mathsRows([
      ['Corpus when it struck (year ' + sim.crashYear + ')', inr(you.corpusAtEmergency), 'computed'],
      ['Emergency to raise', inr(need), 'computed'],
      ['You took out', inr(you.took) + (you.idleCash > 0 ? ' (₹' + Math.round(you.idleCash).toLocaleString('en-IN') + ' left idle)' : ''), 'computed'],
      ['Friend took out', inr(friend.took), 'computed'],
      ['YOUR corpus at year ' + sim.years, inr(you.final), 'computed'],
      ['YOUR return (XIRR)', pct(you.xirr), 'computed'],
      ['Friend at year ' + sim.years + ' (XIRR ' + pct(friend.xirr) + ')', inr(friend.final), 'computed'],
      ['Sleeve returns', 'Liquid 6% · Large 12% · Mid/small 15%', 'assumption'],
      ['Emergency size', sim.sev.label + ' (' + Math.round(need / you.corpusAtEmergency * 100) + '% of corpus)', 'assumption'],
    ]) + '<p class="maths-note">Every ₹ computed from month-by-month units × NAV across three funds; XIRR from the real cash flows. Only the returns and the emergency size are inputs.</p>');
    closeMaths('emMathsPanel', 'emMathsToggle');
  }

  /* ===================== Wiring ===================== */
  function hideAllOverlays() { ['pledge', 'silence', 'split', 'collision', 'result', 'luck', 'grid', 'emIntro', 'emStrike', 'emDecision', 'emCall', 'emergency'].forEach((id) => hide($(id))); }
  function on(id, type, fn) { const el = $(id); if (el) el.addEventListener(type, fn); }
  function backToSetup() { Sound.stopAll(); cancelAnimationFrame(state.raf); hideAllOverlays(); hide($('stage')); hide($('emergency')); state.wizIndex = 0; showWizStep(0); show($('setup')); }

  function boot() {
    // Unlock audio on the very first interaction (autoplay policy).
    const firstGesture = () => { Sound.unlock(); document.removeEventListener('pointerdown', firstGesture); };
    document.addEventListener('pointerdown', firstGesture, { once: true });
    on('muteBtn', 'click', () => { const onNow = Sound.toggle(); const b = $('muteBtn'); if (b) b.textContent = onNow ? '🔊' : '🔇'; });

    // Wizard: each step is a group of .opt buttons.
    document.querySelectorAll('.wstep').forEach((step) => {
      const name = step.id.replace('w_', '');
      step.addEventListener('click', (ev) => { const b = ev.target.closest('.opt'); if (b) wizPick(name, b.dataset.val); });
    });
    on('wizBack', 'click', wizBack);
    on('downturnToggle', 'change', (e) => { state.downturn = e.target.checked; });

    on('pledgeChoices', 'click', (ev) => { const b = ev.target.closest('button[data-pledge]'); if (b) makePledge(b.dataset.pledge); });

    on('silenceContinue', 'click', openSplit);
    on('youChoices', 'click', (ev) => { const b = ev.target.closest('button[data-choice]'); if (b) choose(b.dataset.choice); });
    on('collisionBtn', 'click', afterCollision);

    on('replayBtn', 'click', () => { hideAllOverlays(); showPledge(); });
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

    window.addEventListener('resize', () => { if (!state.sim) return; if ($('stage') && !$('stage').hidden) renderStage(); if ($('split') && !$('split').hidden) renderFriendPanel(); });

    showWizStep(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
