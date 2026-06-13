/* =====================================================================
 * "Two Doors, One Storm"
 * An advanced Monte Carlo behavioural investing simulator.
 * ---------------------------------------------------------------------
 * Two people invest the same money, in the same market. One chose a
 * REGULAR plan (pays ~1%/yr more, but has a relationship manager / MD to
 * call when life hits). One chose DIRECT (pays nothing extra, but faces
 * every storm alone). The fee gap is small and steady. The behaviour gap
 * is enormous. The whole tool dramatises one idea: the only real variable
 * is who is beside you when it falls.
 *
 * This file has two clearly separated halves:
 *   1. THE MATH ENGINE  — deterministic where it can be, Monte Carlo where
 *      it must be. Dependency-free, auditable, and exported for Node so it
 *      can be unit-tested (tests/test_simulator.js). It uses REAL unit-level
 *      accounting (units x NAV every month), never bare percentages, with
 *      correct SIP cash-flow timing and an honest XIRR.
 *   2. THE EXPERIENCE   — the cinematic, mobile-first animation. Runs only
 *      in a browser; the engine half is untouched by it.
 *
 * INTEGRITY: every number on screen is reproducible from the functions
 * below — nothing is hardcoded, nothing is rigged. Across the paths it
 * simulates, the Direct investor can finish ABOVE, EQUAL TO, or BELOW the
 * Regular investor. We never force Regular to win. The door was never the
 * point — the behaviour in the one moment that matters is.
 *
 * All outputs are illustrative ranges of possibility, never predictions or
 * advice. The drawdown depths/durations and return assumptions are
 * approximate and must be locked against real index data before shipping.
 * ===================================================================== */
'use strict';

/* =====================================================================
 * 1. THE MATH ENGINE
 * ===================================================================== */

/* ---- The only fee difference: 1% per year. ----------------------------
 * Direct  net 12%/yr -> 1.0000%/mo.   Regular net 11%/yr -> 0.9167%/mo.
 * Regular underperforms Direct by exactly 1%/yr in EVERY month — that is
 * the entire cost of the door, and we track its compounded rupee toll. */
const DIRECT_ANNUAL   = 0.12;
const REGULAR_ANNUAL  = 0.11;
const DIRECT_MONTHLY  = DIRECT_ANNUAL  / 12;   // 0.010000  (1.0000%/mo)
const REGULAR_MONTHLY = REGULAR_ANNUAL / 12;   // 0.0091667 (0.9167%/mo)
const FEE_GAP_MONTHLY = DIRECT_MONTHLY - REGULAR_MONTHLY; // 0.0008333 = 1%/yr

const HORIZON_YEARS = 20;          // fixed: long enough for the fee to compound
const HORIZON_MONTHS = HORIZON_YEARS * 12; // 240

/* ---- Real market events (Section 5). -----------------------------------
 * Implemented as smooth geometric curves whose DEPTH, FALL and RECOVERY
 * match the real episode. Figures are based on the actual index drawdowns
 * and are illustrative — exact numbers vary by index and dates, and must be
 * locked against real data before this carries a book's name. */
const EVENTS = {
  covid: {
    id: 'covid', name: 'COVID-19, 2020',
    depth: 0.38, fallMonths: 1, recoveryMonths: 9, ongoing: false,
    character: 'The fast one — panic was punished brutally; the rebound was nearly as fast as the crash.',
  },
  gfc: {
    id: 'gfc', name: 'Global Financial Crisis, 2008',
    depth: 0.60, fallMonths: 14, recoveryMonths: 24, ongoing: false,
    character: 'The deep, slow one — the panic "felt right" the longest.',
  },
  corr2022: {
    id: 'corr2022', name: '2022 correction',
    depth: 0.18, fallMonths: 8, recoveryMonths: 12, ongoing: false,
    character: 'The moderate one.',
  },
  now: {
    id: 'now', name: "The one you're living through (geopolitics & oil), 2025–26",
    depth: 0.14, fallMonths: 6, recoveryMonths: 14, ongoing: true,
    character: "Ends on uncertainty — because that's the real decision: you never know, in the moment, which kind it will become.",
  },
};

/* ---- Seedable PRNG (mulberry32) so every Monte Carlo run is reproducible
 *      and auditable: same seed -> same 10,000 futures. ------------------ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Standard normal via Box–Muller. */
function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* =====================================================================
 * 1a. SINGLE-PATH ("LIVE IT") — a real, named crash you feel.
 * ===================================================================== */

/**
 * Build the NAV (price-per-unit) series for ONE plan around ONE real event.
 *
 * The series starts at 100, grows at `rate` every normal month, then at the
 * event's start month S:
 *   • Months S       -> S+fall      : NAV glides smoothly down to (1-depth)·peak
 *   • Months S+fall  -> S+fall+rec  : NAV glides back up to EXACTLY the level
 *                                     the undisturbed trend would have reached
 *                                     (full recovery to trend — no scar)
 *   • After that: normal monthly growth resumes, identical to a no-crash world.
 * Every move within a phase is geometric (a constant monthly factor), the
 * honest way prices move, and it reads as a smooth curve. An investor who
 * stays fully invested loses NOTHING to it and ends slightly richer (cheap
 * units bought in the dip) — we model that honestly and never clamp it.
 *
 * @param {number} rate   monthly growth rate (DIRECT_MONTHLY / REGULAR_MONTHLY)
 * @param {number} N      total months (240)
 * @param {object} ev     an EVENTS entry (depth, fallMonths, recoveryMonths)
 * @param {number} S      event start month (the horizon midpoint)
 */
function buildEventNav(rate, N, ev, S) {
  const fall = ev.fallMonths, rec = ev.recoveryMonths;
  const bottom = S + fall, healed = S + fall + rec;
  const nav = new Array(N + 1);
  nav[0] = 100;
  for (let t = 1; t <= N; t++) {
    if (t <= S) {
      nav[t] = nav[t - 1] * (1 + rate);              // calm pre-event climb
    } else if (t <= bottom) {
      const k = t - S;                               // 1..fall
      nav[t] = nav[S] * Math.pow(1 - ev.depth, k / fall);
    } else if (t <= healed) {
      const start = nav[S] * (1 - ev.depth);         // the bottom
      const target = nav[S] * Math.pow(1 + rate, fall + rec); // trend at `healed`
      const k = t - bottom;                          // 1..rec
      nav[t] = start * Math.pow(target / start, k / rec);
    } else {
      nav[t] = nav[t - 1] * (1 + rate);              // healed; back on trend
    }
  }
  nav._S = S; nav._bottom = bottom; nav._healed = healed;
  return nav;
}

/** A no-crash control (pure trend) — proves staying invested through a crash
 *  ends SLIGHTLY RICHER than a calm market (the cheap units below trend). */
function buildTrendNav(rate, N) {
  const nav = new Array(N + 1);
  nav[0] = 100;
  for (let t = 1; t <= N; t++) nav[t] = nav[t - 1] * (1 + rate);
  return nav;
}

/* ---- XIRR (annualised internal rate of return) from monthly cash flows. --
 * Flows: contributions are NEGATIVE (money the investor puts in), the final
 * corpus is POSITIVE (money it is worth). Times are in YEARS. Newton–Raphson
 * with a bisection fallback so it always converges to a real root. */
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
  // Bisection fallback on a wide, safe bracket.
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

/** Wrap a value series into a full result object (final, invested, XIRR). */
function summarise(value, sip, N) {
  const final = value[N];
  return { value, final, invested: sip * N, xirr: xirrFromSIP(sip, N, final) };
}

/* ---- The four behaviours, each a real month-by-month sim on a NAV series.
 * Shared rules (apples to apples — only behaviour differs):
 *   • SIP invested at the START of each month; units = SIP / NAV[m].
 *   • Value[m] = units · NAV[m] + idle cash.
 *   • Money "set aside" while out sits as cash earning nothing and is
 *     deployed in full at re-entry, so every behaviour invests SIP·N total. */

/** HOLD — keep every unit, keep the SIP running throughout. Buys cheap in
 *  the dip. The baseline discipline. */
function simHold(nav, N, sip) {
  let units = 0;
  const value = new Array(N + 1);
  for (let m = 0; m <= N; m++) {
    if (m < N) units += sip / nav[m];
    value[m] = units * nav[m];
  }
  return summarise(value, sip, N);
}

/** PAUSE — keep units, STOP contributions during the fall + recovery, resume
 *  after. The paused SIP piles up as cash and is deployed in one lump at
 *  re-entry — having missed the cheapest units. */
function simPause(nav, N, sip) {
  const S = nav._S, healed = nav._healed, reentry = healed + 1;
  let units = 0, cash = 0;
  const value = new Array(N + 1);
  for (let m = 0; m <= N; m++) {
    if (m < N) {
      if (m < S)               units += sip / nav[m];
      else if (m < reentry)    cash  += sip;                          // paused -> cash
      else if (m === reentry)  { cash += sip; units += cash / nav[m]; cash = 0; }
      else                     units += sip / nav[m];
    }
    value[m] = units * nav[m] + cash;
  }
  return summarise(value, sip, N);
}

/** SELL at the bottom, sit in cash, re-enter the whole pile at `reentry`,
 *  then resume buying. Used for both "buy back on recovery" (re-enter when
 *  NAV regains the pre-crash peak) and "wait it out" (a full year after it
 *  heals). Sold low, bought higher — permanent unit loss. */
function simSell(nav, N, sip, reentry) {
  const bottom = nav._bottom;
  let units = 0, cash = 0;
  const value = new Array(N + 1);
  for (let m = 0; m <= N; m++) {
    if (m < N) {
      if (m < bottom)          units += sip / nav[m];
      else if (m === bottom)   { cash += units * nav[m]; units = 0; cash += sip; } // sell all + SIP -> cash
      else if (m < reentry)    cash += sip;
      else if (m === reentry)  { cash += sip; units += cash / nav[m]; cash = 0; }  // re-enter everything
      else                     units += sip / nav[m];
    }
    value[m] = units * nav[m] + cash;
  }
  return summarise(value, sip, N);
}

/** First month at or after the bottom where NAV regains the pre-crash peak. */
function peakRegainMonth(nav) {
  const peak = nav[nav._S];
  for (let m = nav._bottom; m < nav.length; m++) if (nav[m] >= peak) return m;
  return nav._healed;
}

/**
 * Run a complete single-path "Live it" simulation for one chosen event.
 * Produces both doors (Direct + Regular) under all four behaviours, plus the
 * crash-free control, so every comparison the UI needs is a pure lookup.
 */
function runSinglePath(sip, eventId) {
  const ev = EVENTS[eventId] || EVENTS.covid;
  const N = HORIZON_MONTHS, S = N / 2; // event at the midpoint (year 10)

  const navDirect  = buildEventNav(DIRECT_MONTHLY,  N, ev, S);
  const navRegular = buildEventNav(REGULAR_MONTHLY, N, ev, S);
  const reDirect  = peakRegainMonth(navDirect);
  const reRegular = peakRegainMonth(navRegular);
  const waitDirect  = navDirect._healed + 12;
  const waitRegular = navRegular._healed + 12;

  const behaviours = (nav, re, wait) => ({
    hold:     simHold(nav, N, sip),
    pause:    simPause(nav, N, sip),
    sellBack: simSell(nav, N, sip, re),
    sellWait: simSell(nav, N, sip, wait),
  });

  const direct  = behaviours(navDirect,  reDirect,  waitDirect);
  const regular = behaviours(navRegular, reRegular, waitRegular);

  // The fee saving, in rupees, fully compounded: Direct-hold minus Regular-hold.
  // This is the entire structural value of going Direct — and it is small.
  const feeSavingRupees = direct.hold.final - regular.hold.final;
  // Slightly-richer-than-calm gift (cheap units below trend).
  const directNoCrash = simHold(buildTrendNav(DIRECT_MONTHLY, N), N, sip).final;

  return {
    mode: 'single', ev, sip, years: HORIZON_YEARS, N, S,
    navDirect, navRegular, direct, regular,
    feeSavingRupees, directNoCrash,
  };
}

/* =====================================================================
 * 1b. MONTE CARLO ("10,000 LIFETIMES") — the distribution.
 * ---------------------------------------------------------------------
 * Each path is 240 monthly market returns drawn from a documented model
 * (the parametric fallback the brief allows when real block-bootstrapped
 * history is not embedded): mean ≈ 12%/yr, volatility ≈ 15–18%/yr, with
 * FAT TAILS (occasional jumps) and VOLATILITY CLUSTERING (a two-state
 * calm/stress regime, so crashes arrive in runs, not as lone months).
 * Each investor follows a behavioural POLICY applied across all paths.
 * NOTE: lock this against real Indian index history before shipping.
 * ===================================================================== */

/** Generate one market path: monthly returns for the DIRECT investor (the
 *  Regular investor simply earns FEE_GAP_MONTHLY less every month). */
function genMarketReturns(N, rng) {
  // Base monthly drift set above the 12% target so the stress-regime negative
  // drift pulls the realised mean back to ≈ 12%/yr.
  const muM = Math.pow(1 + 0.137, 1 / 12) - 1;
  const r = new Array(N);
  let stress = false;
  for (let m = 0; m < N; m++) {
    // Two-state regime -> volatility clustering. Calm is sticky; stress runs
    // longer and meaner (negative drift), so deep drawdowns arrive in clusters
    // the way real crashes do. Steady-state stress share ≈ 0.03/(0.03+0.18)
    // ≈ 14% of months, enough that a 25–35% drawdown shows up in most 20-year
    // lifetimes — matching India's roughly once-a-decade deep falls.
    if (stress) { if (rng() < 0.18) stress = false; }
    else        { if (rng() < 0.03) stress = true; }
    const volAnnual = stress ? 0.30 : 0.12;
    const volM = volAnnual / Math.sqrt(12);
    let z = gaussian(rng);
    if (rng() < 0.02) z *= 2.0;                  // fat tail: rare large move
    let ret = muM + volM * z;
    if (stress) ret -= 0.010;                    // crashes carry negative drift
    r[m] = ret;
  }
  return r;
}

/** Turn a Direct-return path into a NAV series for a given fee drag. */
function navFromReturns(returns, N, feeDrag) {
  const nav = new Array(N + 1);
  nav[0] = 100;
  for (let m = 1; m <= N; m++) nav[m] = nav[m - 1] * (1 + returns[m - 1] - feeDrag);
  return nav;
}

/* ---- Monte Carlo behavioural policies. -------------------------------- */
const MC_POLICIES = {
  hold:  { id: 'hold',  label: 'Hold through everything' },
  // Sell to cash whenever drawdown from the running peak exceeds a threshold;
  // re-enter only once NAV regains that prior peak (sold low, bought higher).
  panic: { id: 'panic', label: 'Sell when it falls hard (alone)', drawdown: 0.25 },
};

/** Run ONE policy over ONE NAV series (real unit accounting). */
function simPolicyPath(nav, N, sip, policy) {
  let units = 0, cash = 0, peak = nav[0];
  let out = false, reentryPeak = 0;
  for (let m = 0; m < N; m++) {
    if (nav[m] > peak) peak = nav[m];
    if (policy.id === 'panic') {
      if (!out && nav[m] < peak * (1 - policy.drawdown)) {
        // Panic-sell everything to cash; remember the peak to wait for.
        cash += units * nav[m]; units = 0; out = true; reentryPeak = peak;
      } else if (out && nav[m] >= reentryPeak) {
        // Market regained the prior peak — re-enter the whole pile.
        units += cash / nav[m]; cash = 0; out = false;
      }
    }
    // This month's SIP: into units if invested, into cash if sitting out.
    if (out) cash += sip; else units += sip / nav[m];
  }
  const final = units * nav[N] + cash;
  return { final, xirr: xirrFromSIP(sip, N, final) };
}

/**
 * Run the full Monte Carlo. For every path we evaluate BOTH investors under
 * their chosen policy on the SAME underlying market, then collect the
 * distribution of finals and the head-to-head odds.
 *
 * @param sip          monthly SIP
 * @param youPolicy    MC_POLICIES key for the Direct investor (YOU)
 * @param friendPolicy MC_POLICIES key for the Regular investor (YOUR FRIEND)
 * @param nPaths       1,000–10,000
 * @param seed         PRNG seed (reproducible)
 */
function runMonteCarlo(sip, youPolicy, friendPolicy, nPaths, seed) {
  const N = HORIZON_MONTHS;
  const rng = mulberry32(seed == null ? 12345 : seed);
  const youP = MC_POLICIES[youPolicy] || MC_POLICIES.hold;
  const friendP = MC_POLICIES[friendPolicy] || MC_POLICIES.hold;

  const youFinals = new Float64Array(nPaths);
  const friendFinals = new Float64Array(nPaths);
  let youAhead = 0, friendAhead = 0, tied = 0;

  for (let i = 0; i < nPaths; i++) {
    const returns = genMarketReturns(N, rng);
    const navDirect  = navFromReturns(returns, N, 0);              // YOU = Direct
    const navRegular = navFromReturns(returns, N, FEE_GAP_MONTHLY); // FRIEND = Regular
    const you = simPolicyPath(navDirect, N, sip, youP);
    const friend = simPolicyPath(navRegular, N, sip, friendP);
    youFinals[i] = you.final;
    friendFinals[i] = friend.final;
    const diff = you.final - friend.final;
    const rel = Math.abs(diff) / Math.max(you.final, friend.final);
    if (rel < 0.01) tied++;
    else if (diff > 0) youAhead++;
    else friendAhead++;
  }

  return {
    mode: 'monte', sip, nPaths, youPolicy: youP, friendPolicy: friendP,
    you: distribution(youFinals), friend: distribution(friendFinals),
    youAhead, friendAhead, tied,
  };
}

/** Summarise a finals array into percentile bands for a fan chart + medians. */
function distribution(finals) {
  const sorted = Float64Array.from(finals).sort();
  const n = sorted.length;
  const q = (p) => sorted[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
  return {
    n, min: sorted[0], max: sorted[n - 1],
    p05: q(0.05), p25: q(0.25), p50: q(0.50), p75: q(0.75), p95: q(0.95),
    mean: sorted.reduce((s, v) => s + v, 0) / n,
  };
}

/* =====================================================================
 * 1c. SCENARIO B — "The money, now." (the emergency)
 * ---------------------------------------------------------------------
 * The market need not crash for the door to matter. Life demands a large
 * sum, fast. The question is not "do I panic-sell" but "how do I raise this
 * cash without destroying my future." We model a portfolio split across a
 * liquid sleeve, large-cap and mid/small-cap, an emergency that strikes at
 * month `S`, and two responses applied to EITHER door:
 *   • PANIC    — redeem everything (far more than needed); the SIP dies.
 *   • SURGICAL — take exactly the emergency: liquid first, then large-cap,
 *                leave the (down) mid-cap; pause the SIP 3 months, then
 *                resume. The rest stays invested and keeps compounding.
 * We let either investor make either call, so the honest point lands:
 * "the solo investor under stress usually can't, and that's where guidance
 * earns its fee," not "Regular always wins."
 * ===================================================================== */

/* The emergency is sized as a FRACTION of the corpus you've built, so it is
 * always a meaningful — and coverable — shock whatever the SIP, and so the
 * RM's "leave the mid-cap, take liquid first" guidance can genuinely be
 * honoured (the need never exceeds the liquid + large-cap sleeves). The rupee
 * figure is shown live; the narrative (the ICU bill, the layoff runway) is in
 * the experience layer. */
const EMERGENCIES = {
  icu:    { id: 'icu',    name: 'Your mother in the ICU',        fraction: 0.50 },
  layoff: { id: 'layoff', name: 'The layoff',                    fraction: 0.42 },
  home:   { id: 'home',   name: 'A family emergency back home',  fraction: 0.32 },
};

// Portfolio sleeves: fractions of the SIP and their growth character.
const SLEEVES = {
  liquid:   { label: 'Liquid fund',   weight: 0.15, monthly: 0.005 },  // ~6%/yr, steady
  largeCap: { label: 'Large-cap',     weight: 0.50, monthly: DIRECT_MONTHLY },
  midSmall: { label: 'Mid/small-cap', weight: 0.35, monthly: 0.0115 }, // higher mean, hit hardest in the dip
};

/**
 * Build the three sleeves up to the emergency month, optionally inside a
 * downturn (hardest mode), then play each response to the 20-year horizon.
 *
 * @param sip       monthly SIP
 * @param feeDrag   0 for Direct, FEE_GAP_MONTHLY for Regular
 * @param response  'panic' | 'surgical'
 * @param need      rupees required now
 * @param S         emergency month
 * @param downturn  if true, the emergency lands inside a market drop
 */
function simEmergency(sip, feeDrag, response, need, S, downturn) {
  const N = HORIZON_MONTHS;
  // Per-sleeve NAVs. In "hardest mode" the equity sleeves are mid-fall at S
  // (mid/small-cap deepest), so selling them locks a real loss.
  const navs = {};
  for (const key in SLEEVES) {
    const s = SLEEVES[key];
    const nav = new Array(N + 1); nav[0] = 100;
    const isEquity = key !== 'liquid';
    const depth = key === 'midSmall' ? 0.30 : key === 'largeCap' ? 0.20 : 0;
    const bottom = S, fall = 6, recover = 12;
    for (let t = 1; t <= N; t++) {
      if (!downturn || !isEquity) { nav[t] = nav[t - 1] * (1 + s.monthly - feeDrag); continue; }
      const start = bottom - fall;
      if (t <= start)            nav[t] = nav[t - 1] * (1 + s.monthly - feeDrag);
      else if (t <= bottom)      nav[t] = nav[start] * Math.pow(1 - depth, (t - start) / fall);
      else if (t <= bottom + recover) {
        const lo = nav[start] * (1 - depth);
        const target = nav[start] * Math.pow(1 + s.monthly - feeDrag, fall + recover);
        nav[t] = lo * Math.pow(target / lo, (t - bottom) / recover);
      } else nav[t] = nav[t - 1] * (1 + s.monthly - feeDrag);
    }
    navs[key] = nav;
  }

  // Accumulate units in each sleeve via SIP up to (and including) month S.
  const units = { liquid: 0, largeCap: 0, midSmall: 0 };
  for (let m = 0; m <= S; m++) {
    if (m < N) for (const key in SLEEVES) units[key] += (sip * SLEEVES[key].weight) / navs[key][m];
  }
  const valueAt = (m) => Object.keys(units).reduce((s, k) => s + units[k] * navs[k][m], 0);
  const corpusAtEmergency = valueAt(S);

  let resumeMonth, took = 0;
  if (response === 'panic') {
    // Fear's one instruction: take it all, be safe. Redeem everything; the
    // SIP dies. The leftover cash sits idle (no growth, no re-entry).
    took = corpusAtEmergency;
    let cash = corpusAtEmergency - need;
    for (const k in units) units[k] = 0;
    return {
      response, corpusAtEmergency, took, need,
      final: Math.max(cash, 0), sipSurvived: false,
      xirr: xirrFromSIP(sip, S + 1, corpusAtEmergency), // return up to the day it died
    };
  }

  // SURGICAL: take EXACTLY `need`. Liquid first, then large-cap. Leave the
  // (down) mid-cap untouched. Pause the SIP 3 months, then resume.
  let remaining = need;
  for (const order of ['liquid', 'largeCap']) {
    if (remaining <= 0) break;
    const avail = units[order] * navs[order][S];
    const draw = Math.min(avail, remaining);
    units[order] -= draw / navs[order][S];
    remaining -= draw;
  }
  if (remaining > 0) { // only if liquid + large-cap could not cover it
    const avail = units.midSmall * navs.midSmall[S];
    const draw = Math.min(avail, remaining);
    units.midSmall -= draw / navs.midSmall[S]; remaining -= draw;
  }
  took = need - Math.max(remaining, 0);
  resumeMonth = S + 4; // paused 3 months, resume after

  const flows = [];
  for (let m = 0; m <= S; m++) if (m < N) flows.push({ t: m / 12, amount: -sip });
  for (let m = S + 1; m < N; m++) {
    if (m < resumeMonth) continue;                // paused
    for (const key in SLEEVES) units[key] += (sip * SLEEVES[key].weight) / navs[key][m];
    flows.push({ t: m / 12, amount: -sip });
  }
  const final = valueAt(N);
  flows.push({ t: S / 12, amount: need });        // the emergency, paid out
  flows.push({ t: N / 12, amount: final });       // what's left at the horizon
  return { response, corpusAtEmergency, took, need, final, sipSurvived: true, xirr: xirr(flows) };
}

/** The full Scenario-B comparison: YOU (Direct, response of your choice) vs
 *  YOUR FRIEND (Regular, surgical via the RM call). */
function runEmergency(sip, emergencyId, youResponse, downturn) {
  const em = EMERGENCIES[emergencyId] || EMERGENCIES.icu;
  const S = 8 * 12; // eight years in
  // Size the emergency off the calm (no-downturn) corpus, rounded to a clean
  // lakh, so the figure is stable whether or not the market is also falling.
  const probe = simEmergency(sip, 0, 'panic', 0, S, false);
  const need = Math.max(100000, Math.round(em.fraction * probe.corpusAtEmergency / 1e5) * 1e5);

  const you = simEmergency(sip, 0, youResponse, need, S, downturn);
  const friend = simEmergency(sip, FEE_GAP_MONTHLY, 'surgical', need, S, downturn);
  // A Direct investor who DOES make the smart call — kept honest, so the
  // lesson is "alone you usually can't," not "the door decides it". (Such an
  // investor even edges ahead of the friend — they also saved the fee.)
  const directSmart = simEmergency(sip, 0, 'surgical', need, S, downturn);
  return { mode: 'emergency', em, sip, years: HORIZON_YEARS, S, downturn, need, you, friend, directSmart };
}

/* ---- Node export for the test harness; harmless in the browser. -------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIRECT_MONTHLY, REGULAR_MONTHLY, FEE_GAP_MONTHLY, HORIZON_MONTHS, EVENTS,
    buildEventNav, buildTrendNav, xirr, xirrFromSIP,
    simHold, simPause, simSell, peakRegainMonth, runSinglePath,
    genMarketReturns, navFromReturns, simPolicyPath, runMonteCarlo, distribution,
    EMERGENCIES, SLEEVES, simEmergency, runEmergency, MC_POLICIES,
  };
}

/* =====================================================================
 * 2. THE EXPERIENCE  (browser only)
 * ===================================================================== */
if (typeof document !== 'undefined') (function () {
  'use strict';

  /* ---- Number formatting (Indian grouping + lakh/crore short form). ---- */
  function inr(v) {
    const n = Math.round(v);
    const s = Math.abs(n).toString();
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

  // ---- DOM helpers. ----
  const $ = (id) => document.getElementById(id);
  const show = (el) => { if (!el) return; el.hidden = false; requestAnimationFrame(() => el.classList.add('show')); };
  const hide = (el) => { if (!el) return; el.classList.remove('show'); el.hidden = true; };
  const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  const easeInOut = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const reduceMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Palette (mirrors styles.css). ----
  const COL = {
    direct: '#34d399', regular: '#e0a64a', crash: '#f06b6b',
    cool: '#6f86c9', ghost: '#cbb26b',
    pause: '#5b9cf0', sellBack: '#a78bfa', sellWait: '#f06b6b',
  };
  const BEHAVIOURS = {
    hold:     { label: 'Hold',                       color: COL.direct },
    pause:    { label: 'Pause the SIP',              color: COL.pause },
    sellBack: { label: 'Sell, buy back when safe',   color: COL.sellBack },
    sellWait: { label: 'Sell everything, wait',      color: COL.sellWait },
  };

  // ---- App state. ----
  const state = {
    scenario: 'crash',          // 'crash' | 'emergency'
    sip: 10000,
    eventId: 'covid',
    emergencyId: 'icu',
    downturn: false,
    sim: null, choice: null,
    head: 0, phase: 'idle', phaseStart: null, raf: 0, yMax: 1,
  };

  /* ===================================================================
   * 2a. Canvas chart primitives.
   * =================================================================== */
  function fitCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height, c };
  }
  function pointsUpTo(values, head) {
    const pts = [];
    const last = Math.min(Math.floor(head), values.length - 1);
    for (let m = 0; m <= last; m++) pts.push([m, values[m]]);
    if (last < values.length - 1 && head > last) {
      const f = head - last;
      pts.push([head, values[last] + (values[last + 1] - values[last]) * f]);
    }
    return pts;
  }
  function valueAt(values, head) {
    const last = Math.floor(head);
    if (last >= values.length - 1) return values[values.length - 1];
    return values[last] + (values[last + 1] - values[last]) * (head - last);
  }
  function hexFill(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function drawLines(c, w, h, N, yMax, lines, head, pad) {
    const p = pad || { l: 16, r: 16, t: 24, b: 22 };
    const X = (m) => p.l + (m / N) * (w - p.l - p.r);
    const Y = (v) => (h - p.b) - (v / yMax) * (h - p.t - p.b);
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const yy = p.t + i * (h - p.t - p.b) / 3;
      c.beginPath(); c.moveTo(p.l, yy); c.lineTo(w - p.r, yy); c.stroke();
    }
    for (const line of lines) {
      const pts = pointsUpTo(line.values, head == null ? N : head);
      if (!pts.length) continue;
      if (line.fill) {
        c.beginPath(); c.moveTo(X(pts[0][0]), h - p.b);
        for (const [m, v] of pts) c.lineTo(X(m), Y(v));
        c.lineTo(X(pts[pts.length - 1][0]), h - p.b); c.closePath();
        const g = c.createLinearGradient(0, p.t, 0, h - p.b);
        g.addColorStop(0, line.fill); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fill();
      }
      c.save();
      c.globalAlpha = line.alpha == null ? 1 : line.alpha;
      c.strokeStyle = line.color; c.lineWidth = line.width || 2;
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (line.dash) c.setLineDash(line.dash);
      if (line.glow) { c.shadowColor = line.color; c.shadowBlur = 12; }
      c.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [m, v] = pts[i];
        if (i === 0) c.moveTo(X(m), Y(v)); else c.lineTo(X(m), Y(v));
      }
      c.stroke(); c.restore();
      if (line.dot) {
        const [m, v] = pts[pts.length - 1];
        c.save(); c.shadowColor = line.color; c.shadowBlur = 16; c.fillStyle = line.color;
        c.beginPath(); c.arc(X(m), Y(v), 4, 0, Math.PI * 2); c.fill(); c.restore();
      }
    }
  }

  /* ===================================================================
   * 2b. SCENARIO A — "The Crash": the climb, the fall, the silence,
   *     the split (YOU choose / YOUR FRIEND gets the call), divergence.
   * =================================================================== */
  const stageCanvas = () => $('stageCanvas');

  function renderStage() {
    const cv = stageCanvas(); if (!cv) return;
    const { w, h, c } = fitCanvas(cv);
    const sim = state.sim, N = sim.N;
    const pre = state.phase === 'climb' || state.phase === 'crash';
    // Before the choice we show both doors climbing: Direct just above
    // Regular, the fee toll widening — shown accruing before anything dramatic.
    let lines, front;
    if (pre) {
      const crashing = state.phase === 'crash';
      const d = sim.direct.hold.value, r = sim.regular.hold.value;
      front = d;
      lines = [
        { values: r, color: crashing ? hexFill(COL.cool, 0.9) : COL.regular, width: 2, alpha: 0.85 },
        { values: d, color: crashing ? COL.cool : COL.direct, width: 3, glow: true, dot: true,
          fill: crashing ? hexFill(COL.cool, 0.16) : hexFill(COL.direct, 0.16) },
      ];
    } else {
      const yours = sim.direct[state.choice];
      const calm = sim.direct.hold;
      front = yours.value;
      lines = [
        { values: calm.value, color: COL.ghost, width: 2, alpha: 0.4, dash: [5, 6] },
        { values: yours.value, color: BEHAVIOURS[state.choice].color, width: 3, glow: true, dot: true,
          fill: hexFill(BEHAVIOURS[state.choice].color, 0.16) },
      ];
    }
    drawLines(c, w, h, N, state.yMax, lines, state.head);

    const corpus = valueAt(front, state.head);
    $('corpus').textContent = inr(corpus);
    $('corpusShort').textContent = '≈ ' + inrShort(corpus);
    const months = Math.min(Math.floor(state.head), N);
    $('yearLabel').textContent = 'Year ' + Math.min(Math.floor(state.head / 12), sim.years) + ' of ' + sim.years;
    $('invested').textContent = 'Invested ' + inrShort(state.sip * months);
  }

  const CLIMB_MS   = reduceMotion ? 200 : 4600;
  const CRASH_MS   = reduceMotion ? 150 : 2200;
  const DIVERGE_MS = reduceMotion ? 200 : 5200;

  function tensionCue() {
    if (!reduceMotion && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([18, 60, 28]);
  }

  function loop(ts) {
    if (state.phaseStart == null) state.phaseStart = ts;
    const e = ts - state.phaseStart;
    const sim = state.sim, N = sim.N, S = sim.S;
    const bottom = sim.navDirect._bottom;
    if (state.phase === 'climb') {
      const p = Math.min(e / CLIMB_MS, 1);
      state.head = S * easeInOut(p);
      renderStage();
      if (p >= 1) { state.phase = 'crash'; state.phaseStart = null; $('stage').classList.add('crashing'); tensionCue(); }
      state.raf = requestAnimationFrame(loop);
    } else if (state.phase === 'crash') {
      const p = Math.min(e / CRASH_MS, 1);
      state.head = S + (bottom - S) * p;
      renderStage();
      if (p >= 1) { cancelAnimationFrame(state.raf); enterSilence(); return; }
      state.raf = requestAnimationFrame(loop);
    } else if (state.phase === 'diverge') {
      const p = Math.min(e / DIVERGE_MS, 1);
      state.head = bottom + (N - bottom) * easeInOut(p);
      renderStage();
      if (p >= 1) { cancelAnimationFrame(state.raf); openResult(); return; }
      state.raf = requestAnimationFrame(loop);
    }
  }

  function startCrash() {
    state.sim = runSinglePath(state.sip, state.eventId);
    state.choice = null; state.head = 0; state.phase = 'climb'; state.phaseStart = null;
    state.yMax = state.sim.direct.hold.final * 1.08;
    $('stage').classList.remove('crashing');
    hideAllOverlays();
    hide($('setup'));
    show($('stage'));
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(loop);
  }

  // The silence beat: total stillness on YOUR side, the red number the only
  // thing trembling. Held one beat longer than is comfortable, then the split.
  function enterSilence() {
    const sim = state.sim;
    const depthEl = $('silDepth');
    if (depthEl) depthEl.textContent = Math.round(sim.ev.depth * 100);
    const peak = sim.direct.hold.value[sim.S];
    const bottom = sim.direct.hold.value[sim.navDirect._bottom];
    setHTML('silenceLoss',
      'Your <b>' + inrShort(peak) + '</b> is now <b>' + inrShort(bottom) + '</b>'
      + '<span class="sil-sub">' + inrShort(peak - bottom) + ' gone. And your side has gone silent.</span>');
    show($('silence'));
    const wait = reduceMotion ? 250 : 3200;
    setTimeout(openSplit, wait);
  }

  function openSplit() {
    hide($('silence'));
    const sim = state.sim;
    // FRIEND (Regular) holds, talked through it by the RM. Render her steady
    // line in the split panel.
    renderFriendPanel();
    show($('split'));
    if (!reduceMotion) {
      // Calm physically washes into her side after the call lands.
      setTimeout(() => { const s = $('split'); if (s) s.classList.add('called'); }, 900);
    } else {
      const s = $('split'); if (s) s.classList.add('called');
    }
  }

  function renderFriendPanel() {
    const cv = $('friendCanvas'); if (!cv) return;
    const sim = state.sim, N = sim.N;
    const { w, h, c } = fitCanvas(cv);
    const r = sim.regular.hold.value;
    drawLines(c, w, h, N, state.yMax, [
      { values: r, color: COL.regular, width: 2.6, glow: true, dot: true, fill: hexFill(COL.regular, 0.14) },
    ], sim.navRegular._healed, { l: 10, r: 10, t: 14, b: 14 });
  }

  function choose(choice) {
    state.choice = choice;
    const s = $('split'); if (s) s.classList.remove('called');
    hide($('split'));
    $('stage').classList.remove('crashing');
    // Sell-as-relief: if they sold, let calm flood in for one beat before cost.
    if ((choice === 'sellBack' || choice === 'sellWait') && !reduceMotion) {
      show($('relief'));
      setTimeout(() => { hide($('relief')); beginDiverge(); }, 1500);
    } else {
      beginDiverge();
    }
  }
  function beginDiverge() {
    show($('stage'));
    state.phase = 'diverge'; state.phaseStart = null;
    state.raf = requestAnimationFrame(loop);
  }

  /* ===================================================================
   * 2c. RESULT — YOU vs YOUR FRIEND. Two corpora, two XIRRs, fee saved
   *     vs behaviour cost, and the verdict caption (Section 11).
   * =================================================================== */
  function openResult() {
    const sim = state.sim;
    const yours = sim.direct[state.choice];
    const friend = sim.regular.hold;        // she held, talked through by the RM
    const calmDirect = sim.direct.hold;     // what staying calm alone would have done

    setHTML('resTitle', state.scenario === 'crash' ? 'YOU vs YOUR FRIEND' : 'YOU vs YOUR FRIEND');
    $('youLabel').textContent = 'YOU · Direct · ' + BEHAVIOURS[state.choice].label;
    $('friendLabelR').textContent = 'YOUR FRIEND · Regular · Held (the RM call)';
    $('youFinal').style.color = BEHAVIOURS[state.choice].color;

    countUp($('youFinal'), yours.final, 1400, inr);
    countUp($('friendFinal'), friend.final, 1400, inr);
    $('youShort').textContent = '≈ ' + inrShort(yours.final) + '  ·  XIRR ' + pct(yours.xirr);
    $('friendShort').textContent = '≈ ' + inrShort(friend.final) + '  ·  XIRR ' + pct(friend.xirr);

    const feeSaved = sim.feeSavingRupees;          // Direct's structural fee edge
    const behaviourCost = calmDirect.final - yours.final; // gap to the calm path
    setHTML('ledger',
      '<div class="led"><span>Direct saved you (the fee, compounded)</span><b class="good">' + inr(feeSaved) + '</b></div>'
      + '<div class="led"><span>Your decision in the crash cost you</span><b class="bad">' + inr(behaviourCost) + '</b></div>');

    setHTML('verdict', verdictFor(state.choice, yours.final, friend.final, sim));
    show($('result'));
  }

  // Verdict captions resonant with the book chapter (Section 11). Every cost
  // is computed live, never typed in.
  function verdictFor(choice, yours, friendFinal, sim) {
    const youHeld = choice === 'hold';
    const youAhead = yours >= friendFinal;
    if (youHeld && youAhead) {
      const surplus = Math.max(sim.direct.hold.final - sim.directNoCrash, 0);
      return 'You did nothing. She did nothing. You simply kept more — the door you chose finally paid off.'
        + '<span class="verdict-sub">Staying invested even left you about <b>' + inrShort(surplus)
        + '</b> ahead of a crash-free market — the months below trend bought cheaper units.</span>';
    }
    if (!youHeld && !youAhead) {
      return 'You saved the fee and lost far more.'
        + '<span class="verdict-sub">Her "expensive" plan bought the one thing that mattered: someone to stop her selling. '
        + 'She isn\'t smarter than you. She just wasn\'t alone.</span>';
    }
    if (!youHeld && youAhead) {
      // Honest: even after panicking you can still edge her — the fee is real.
      return 'You blinked — and still edged ahead, because the fee gap is small and this storm was shallow.'
        + '<span class="verdict-sub">It won\'t always go this way. The deeper the fall, the more the one phone call is worth.</span>';
    }
    // You held, she "held" but you finished behind — only possible via the fee
    // when behaviour is identical: the door, doing exactly its small job.
    return 'Two calm investors. The only gap left was the fee.'
      + '<span class="verdict-sub">When nobody panics, the door is all that\'s left to decide it — and it decides it by a little.</span>';
  }

  function countUp(el, to, dur, fmt) {
    if (!el) return;
    if (reduceMotion) { el.textContent = fmt(to); return; }
    const start = performance.now();
    (function step(t) {
      const p = Math.min((t - start) / dur, 1);
      el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  /* ===================================================================
   * 2d. "See every outcome" — the 4x4 grid (your choice x her choice),
   *     so Direct-above, equal and below Regular are all visible at once,
   *     plus the half/half hedge.
   * =================================================================== */
  function openGrid() {
    // The grid is always a single chosen storm. If we arrived here from the
    // emergency scenario, state.sim won't be a single-path sim — build one.
    const sim = (state.sim && state.sim.mode === 'single')
      ? state.sim : runSinglePath(state.sip, state.eventId);
    const keys = ['hold', 'pause', 'sellBack', 'sellWait'];
    let html = '<table class="grid-tbl"><thead><tr><th class="corner">YOU ↓ / FRIEND →</th>';
    for (const fk of keys) html += '<th>' + BEHAVIOURS[fk].label + '</th>';
    html += '</tr></thead><tbody>';
    for (const yk of keys) {
      html += '<tr><th class="rowh">' + BEHAVIOURS[yk].label + '</th>';
      for (const fk of keys) {
        const you = sim.direct[yk].final, fr = sim.regular[fk].final;
        const cls = you > fr * 1.005 ? 'win' : you < fr * 0.995 ? 'lose' : 'tie';
        html += '<td class="' + cls + '"><span class="cell-y">' + inrShort(you) + '</span>'
          + '<span class="cell-f">vs ' + inrShort(fr) + '</span></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';

    // The hedge: half Regular, half Direct, both holding — it lands in between.
    const halfHold = (sim.direct.hold.final + sim.regular.hold.final) / 2;
    html += '<p class="grid-note"><b>Green</b> = YOU (Direct) finish ahead · '
      + '<b>red</b> = your friend (Regular) finishes ahead · grey = a tie. '
      + 'The fee gap is small and steady; the behaviour gap is enormous.</p>'
      + '<div class="hedge"><span>What if you split — half Regular, half Direct, both holding?</span>'
      + '<b>' + inrShort(halfHold) + '</b><span class="hedge-sub">It lands right in between — the hedge does exactly what a hedge does.</span></div>';
    setHTML('gridBody', html);
    show($('grid'));
  }

  /* ===================================================================
   * 2e. "10,000 lifetimes" — the Monte Carlo fan chart + plain-language
   *     odds (never raw percentiles).
   * =================================================================== */
  function openMonte() {
    show($('monte'));
    runAndDrawMonte();
  }
  function runAndDrawMonte() {
    const youPolicy = $('youPolicy').value;
    const friendPolicy = $('friendPolicy').value;
    const nPaths = Number($('mcPaths').value) || 2000;
    setHTML('mcOdds', '<p class="mc-running">Simulating ' + nPaths.toLocaleString('en-IN') + ' futures…</p>');
    // Defer so the "running" text paints before the (blocking) compute.
    setTimeout(() => {
      const mc = runMonteCarlo(state.sip, youPolicy, friendPolicy, nPaths, 20262026);
      state.mc = mc;
      drawFan(mc);
      // Plain odds, scaled to a round "out of 10,000" the way the brief asks.
      const per10k = (n) => Math.round(n / mc.nPaths * 10000).toLocaleString('en-IN');
      const youName = mc.youPolicy.id === 'hold' ? 'calm Direct investor' : 'Direct investor who sells in the fall';
      const frName = mc.friendPolicy.id === 'hold' ? 'guided Regular investor (holds)' : 'Regular investor who sells in the fall';
      setHTML('mcOdds',
        '<p class="mc-headline">In <b>' + per10k(mc.youAhead) + ' of 10,000 futures</b>, the ' + youName
        + ' finished ahead of the ' + frName + '.</p>'
        + '<div class="mc-stats">'
        + '<div><span>YOU · Direct · ' + mc.youPolicy.label + '</span><b>median ' + inrShort(mc.you.p50) + '</b>'
        + '<i>likely range ' + inrShort(mc.you.p05) + ' – ' + inrShort(mc.you.p95) + '</i></div>'
        + '<div><span>FRIEND · Regular · ' + mc.friendPolicy.label + '</span><b>median ' + inrShort(mc.friend.p50) + '</b>'
        + '<i>likely range ' + inrShort(mc.friend.p05) + ' – ' + inrShort(mc.friend.p95) + '</i></div>'
        + '</div>'
        + '<p class="mc-foot">Same market, same SIP, every month. Change either policy above to see the case where '
        + 'the guided investor panics and the calm Direct investor wins — the door was never the point.</p>');
    }, 30);
  }
  function drawFan(mc) {
    const cv = $('fanCanvas'); if (!cv) return;
    const { w, h, c } = fitCanvas(cv);
    const yMax = Math.max(mc.you.p95, mc.friend.p95) * 1.05;
    const p = { l: 12, r: 12, t: 16, b: 16 };
    const Y = (v) => (h - p.b) - (v / yMax) * (h - p.t - p.b);
    c.clearRect(0, 0, w, h);
    const band = (dist, color, x0, x1) => {
      c.fillStyle = hexFill(color, 0.16);
      c.fillRect(x0, Y(dist.p95), x1 - x0, Y(dist.p05) - Y(dist.p95));
      c.fillStyle = hexFill(color, 0.30);
      c.fillRect(x0, Y(dist.p75), x1 - x0, Y(dist.p25) - Y(dist.p75));
      c.strokeStyle = color; c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(x0, Y(dist.p50)); c.lineTo(x1, Y(dist.p50)); c.stroke();
    };
    const mid = w / 2;
    band(mc.you, COL.direct, p.l, mid - 6);
    band(mc.friend, COL.regular, mid + 6, w - p.r);
    c.fillStyle = '#8a97a8'; c.font = '11px -apple-system, sans-serif'; c.textAlign = 'center';
    c.fillText('YOU (Direct)', (p.l + mid) / 2, h - 3);
    c.fillText('FRIEND (Regular)', (mid + w - p.r) / 2, h - 3);
  }

  /* ===================================================================
   * 2f. SCENARIO B — "The money, now." (the emergency)
   * =================================================================== */
  function startEmergency() {
    state.sim = runEmergency(state.sip, state.emergencyId, 'panic', state.downturn);
    renderEmergency();
    hideAllOverlays();
    hide($('setup')); hide($('stage'));
    show($('emergency'));
  }
  function renderEmergency() {
    const sim = state.sim, em = sim.em, need = sim.need;
    setHTML('emTitle', em.name);
    const lines = {
      icu: 'The hospital needs <b>' + inrShort(need) + '</b> by morning.',
      layoff: 'Rent, EMIs, two kids — you need <b>' + inrShort(need) + '</b> to survive six months of nothing.',
      home: "It can't wait — you need <b>" + inrShort(need) + '</b>, now.',
    };
    setHTML('emLine', (lines[em.id] || lines.icu) + (sim.downturn ? ' <span class="em-hard">And the market is falling.</span>' : ''));

    // YOU (Direct, panic) — redeem everything, the SIP dies.
    const you = sim.you, friend = sim.friend, smart = sim.directSmart;
    setHTML('emYou',
      '<p class="em-side-cap">YOU · Direct · alone, clock running</p>'
      + '<p class="em-act">You redeem <b>everything</b> — ' + inrShort(you.took) + ', far more than the '
      + inrShort(you.need) + ' you needed. The SIP you ran for eight years dies in one tap. No one told you there was a better way.</p>'
      + '<div class="em-num"><span>Worth at the horizon</span><b class="bad">' + inrShort(you.final) + '</b></div>'
      + '<div class="em-num small"><span>XIRR · SIP</span><b>' + pct(you.xirr) + ' · ' + (you.sipSurvived ? 'survived' : 'cancelled') + '</b></div>');

    setHTML('emFriend',
      '<p class="em-side-cap">YOUR FRIEND · Regular · she makes the call</p>'
      + '<p class="em-act">"Saans le. We take exactly ' + inrShort(friend.need) + ', not a rupee more — liquid first, then a little large-cap. '
      + 'Leave the mid-cap, it\'s down. Pause the SIP three months, don\'t cancel it. The rest stays invested."</p>'
      + '<div class="em-num"><span>Worth at the horizon</span><b class="good">' + inrShort(friend.final) + '</b></div>'
      + '<div class="em-num small"><span>XIRR · SIP</span><b>' + pct(friend.xirr) + ' · paused, then resumed</b></div>');

    const gap = friend.final - you.final;
    setHTML('emVerdict',
      'Same emergency, same ' + inrShort(need) + '. She took only the emergency. You took the emergency <b>and your future with it</b> — a gap of <b>' + inr(gap) + '</b> by year 20.'
      + '<span class="verdict-sub">It was never that she was calmer. On the worst day, there was a number she could call — and you had only yourself, '
      + 'making the biggest financial decision of your life at the worst possible moment to make it.</span>');

    // Kept honest: a Direct investor who DOES make the smart call would
    // actually finish a touch AHEAD of the friend — they saved the fee too.
    // So the door was never the point; making the call under stress was.
    setHTML('emHonest',
      'And if you, Direct, had made the same surgical call alone? You\'d have <b>' + inrShort(smart.final) + '</b> — even a hair '
      + (smart.final >= friend.final ? 'ahead of' : 'behind') + ' her, because you\'d have saved the fee too. '
      + 'The door was never the point. The solo investor under stress usually can\'t make that call — <i>that</i> is what her fee bought.');
  }

  /* ===================================================================
   * 2g. Wiring.
   * =================================================================== */
  function hideAllOverlays() {
    ['silence', 'split', 'relief', 'result', 'grid', 'monte', 'emergency'].forEach((id) => hide($(id)));
  }
  function on(id, type, fn) { const el = $(id); if (el) el.addEventListener(type, fn); }
  function wireChips(containerId, key, parse) {
    const box = $(containerId); if (!box) return;
    box.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.chip'); if (!btn) return;
      [...box.querySelectorAll('.chip')].forEach((b) => b.classList.toggle('on', b === btn));
      state[key] = parse ? parse(btn.dataset.val) : btn.dataset.val;
      if (containerId === 'scenarioChips') reflectScenario();
    });
  }
  function reflectScenario() {
    const crash = state.scenario === 'crash';
    const a = $('crashInputs'), b = $('emergencyInputs');
    if (a) a.hidden = !crash;
    if (b) b.hidden = crash;
    $('startBtn').textContent = crash ? 'Live the crash' : 'Face the emergency';
  }

  function start() {
    if (state.scenario === 'crash') startCrash(); else startEmergency();
  }
  function backToSetup() {
    cancelAnimationFrame(state.raf);
    hideAllOverlays();
    hide($('stage'));
    show($('setup'));
  }

  function boot() {
    on('startBtn', 'click', start);
    wireChips('scenarioChips', 'scenario', null);
    wireChips('sipChips', 'sip', Number);
    wireChips('eventChips', 'eventId', null);
    wireChips('emergencyChips', 'emergencyId', null);
    on('downturnToggle', 'change', (e) => { state.downturn = e.target.checked; });

    // Result actions.
    on('replayBtn', 'click', () => { if (state.scenario === 'crash') startCrash(); else startEmergency(); });
    on('gridBtn', 'click', openGrid);
    on('monteBtn', 'click', openMonte);
    on('changeBtn', 'click', backToSetup);
    on('gridClose', 'click', () => hide($('grid')));
    on('monteClose', 'click', () => hide($('monte')));
    on('emReplay', 'click', startEmergency);
    on('emGridBtn', 'click', openGrid);
    on('emMonteBtn', 'click', openMonte);
    on('emChangeBtn', 'click', backToSetup);

    on('runMcBtn', 'click', runAndDrawMonte);

    // The four choices in the split.
    on('youChoices', 'click', (ev) => {
      const btn = ev.target.closest('button[data-choice]');
      if (btn) choose(btn.dataset.choice);
    });

    window.addEventListener('resize', () => {
      if (!state.sim) return;
      if ($('stage') && !$('stage').hidden) renderStage();
      if ($('split') && !$('split').hidden) renderFriendPanel();
      if ($('monte') && !$('monte').hidden && state.mc) drawFan(state.mc);
    });

    reflectScenario();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
