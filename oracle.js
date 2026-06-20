/* =====================================================================
 * The Autonomous Portfolio Oracle — Part 1: "Current" Diagnostic Engine
 * ---------------------------------------------------------------------
 * A live X-ray of an existing mutual-fund portfolio. This file is the
 * MATH ENGINE only — pure, deterministic, dependency-free, and exported
 * for Node so every figure can be unit-tested. The browser dashboard
 * (oracle-ui.js) renders what this computes; it invents nothing.
 *
 * Implements Part 1 of the Master Specification:
 *   1. Advanced Return Metrics  — Absolute, CAGR, XIRR, Rolling Returns
 *   2. Statistical Risk & Quality — Alpha (Jensen), Beta, Sharpe, Downside Capture
 *   3. Leakage & Structure Control — TER/BER cost leakage, Portfolio Overlap %
 *   4. Spendable Wealth Counter — net in-hand cash after exit load + STCG/LTCG
 *
 * HONESTY NOTE (matches this repo's ethos): every metric below is COMPUTED
 * from the portfolio's data. The bundled sample portfolio's NAV histories are
 * generated from a seeded PRNG with clearly-labelled drift/vol assumptions so
 * the demo is reproducible — but the engine itself accepts real series and
 * does real math on whatever it is given. Tax/exit-load rules are the current
 * Indian rules as of FY2024-25, kept as named, overridable constants.
 * ===================================================================== */
'use strict';

/* =====================================================================
 * 0. NUMERIC UTILITIES
 * ===================================================================== */

/** mulberry32 — a tiny, fast, deterministic PRNG (seed -> [0,1)). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal sample via Box–Muller, driven by a [0,1) generator. */
function gaussian(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Sample standard deviation (n-1). */
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

/** Sample covariance of two equal-length series (n-1). */
function covariance(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / (n - 1);
}

const variance = (xs) => { const s = stdev(xs); return s * s; };

/** Period-over-period simple returns from a value/NAV series. */
function periodReturns(series) {
  const r = [];
  for (let i = 1; i < series.length; i++) r.push(series[i] / series[i - 1] - 1);
  return r;
}

/* =====================================================================
 * 1. ADVANCED RETURN METRICS
 * ===================================================================== */

/** Absolute Return as a fraction. 0.25 => +25%. Loss is negative. */
function absoluteReturn(invested, currentValue) {
  if (invested <= 0) throw new Error('invested must be positive');
  return (currentValue - invested) / invested;
}

/** CAGR of a lump sum.  ( Vfinal / Vinitial )^(1/n) − 1 . */
function cagr(initial, final, years) {
  if (initial <= 0) throw new Error('initial must be positive');
  if (final < 0) throw new Error('final cannot be negative');
  if (years <= 0) throw new Error('years must be positive');
  return Math.pow(final / initial, 1 / years) - 1;
}

/* ---- XIRR — IRR of dated, irregular cash flows ----------------------
 * flows: [{ date: Date|'YYYY-MM-DD', amount }] — investments negative,
 * redemptions/current-value positive. 365-day basis, Newton–Raphson with a
 * bracketed-bisection fallback so it converges even on awkward sign patterns. */
function toDate(d) { return d instanceof Date ? d : new Date(d + 'T00:00:00Z'); }

function xirr(flows, guess = 0.1) {
  if (!flows || flows.length < 2) return NaN;
  const cf = flows
    .map((f) => ({ t: toDate(f.date).getTime(), a: f.amount }))
    .sort((x, y) => x.t - y.t);
  const t0 = cf[0].t;
  const years = (t) => (t - t0) / (365 * 24 * 3600 * 1000);
  const hasPos = cf.some((c) => c.a > 0), hasNeg = cf.some((c) => c.a < 0);
  if (!hasPos || !hasNeg) return NaN;

  const npv = (rate) => cf.reduce((s, c) => s + c.a / Math.pow(1 + rate, years(c.t)), 0);
  const dnpv = (rate) => cf.reduce((s, c) => {
    const y = years(c.t);
    return s - (y * c.a) / Math.pow(1 + rate, y + 1);
  }, 0);

  // Newton–Raphson.
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate), df = dnpv(rate);
    if (!isFinite(f) || !isFinite(df) || df === 0) break;
    const next = rate - f / df;
    if (!isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
  }
  // Bisection fallback across a wide bracket.
  let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi);
  if (!(isFinite(flo) && isFinite(fhi)) || flo * fhi > 0) return NaN;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/* ---- Rolling Returns ------------------------------------------------
 * Point-to-point returns mislead; rolling returns show how CONSISTENT a fund
 * was across every overlapping window. Given a NAV series sampled at
 * `periodsPerYear`, computes the annualised return for every window of
 * `windowYears` and reports avg / min / max plus a consistency score
 * (= fraction of windows that beat `consistencyHurdle`). */
function rollingReturns(navSeries, windowYears, periodsPerYear = 12, consistencyHurdle = 0) {
  const w = Math.round(windowYears * periodsPerYear);
  if (!navSeries || navSeries.length <= w) {
    return { windowYears, count: 0, avg: NaN, min: NaN, max: NaN, consistency: NaN, series: [] };
  }
  const out = [];
  for (let i = 0; i + w < navSeries.length; i++) {
    out.push(Math.pow(navSeries[i + w] / navSeries[i], 1 / windowYears) - 1);
  }
  const beats = out.filter((r) => r > consistencyHurdle).length;
  return {
    windowYears,
    count: out.length,
    avg: mean(out),
    min: Math.min(...out),
    max: Math.max(...out),
    consistency: beats / out.length, // share of windows above the hurdle
    series: out,
  };
}

/* =====================================================================
 * 2. STATISTICAL RISK & QUALITY ENGINE
 * Inputs are equal-length, same-period (e.g. monthly) return series for the
 * fund and its benchmark, plus an ANNUAL risk-free rate.
 * ===================================================================== */

/** Annualise a series of per-period simple returns (geometric). */
function annualizedReturn(periodRets, periodsPerYear = 12) {
  if (!periodRets.length) return NaN;
  const growth = periodRets.reduce((g, r) => g * (1 + r), 1);
  const years = periodRets.length / periodsPerYear;
  return Math.pow(growth, 1 / years) - 1;
}

/** Annualised volatility = per-period stdev × √periodsPerYear. */
function annualizedVol(periodRets, periodsPerYear = 12) {
  return stdev(periodRets) * Math.sqrt(periodsPerYear);
}

/** Beta — sensitivity to the benchmark. cov(fund,bench) / var(bench). */
function beta(fundRets, benchRets) {
  const v = variance(benchRets);
  if (v === 0) return NaN;
  return covariance(fundRets, benchRets) / v;
}

/** Jensen's Alpha (annualised) — return earned above CAPM expectation.
 *  α = Rfund − [ Rf + β·(Rbench − Rf) ] , all annualised. */
function jensenAlpha(fundRets, benchRets, annualRiskFree = 0.065, periodsPerYear = 12) {
  const b = beta(fundRets, benchRets);
  const rp = annualizedReturn(fundRets, periodsPerYear);
  const rm = annualizedReturn(benchRets, periodsPerYear);
  return { alpha: rp - (annualRiskFree + b * (rm - annualRiskFree)), beta: b, fundReturn: rp, benchReturn: rm };
}

/** Sharpe Ratio — excess return per unit of total risk.
 *  (Rp − Rf) / σp , annualised. */
function sharpe(fundRets, annualRiskFree = 0.065, periodsPerYear = 12) {
  const rp = annualizedReturn(fundRets, periodsPerYear);
  const sd = annualizedVol(fundRets, periodsPerYear);
  if (sd === 0) return NaN;
  return (rp - annualRiskFree) / sd;
}

/** Downside Capture Ratio (%) — how much of the market's FALLS the fund took.
 *  Over the periods the benchmark was negative, the ratio of the fund's
 *  average return to the benchmark's average return, ×100. 70 means: when the
 *  market fell ~10%, this fund fell only ~7% (the spec's own framing). Lower is
 *  safer. (Arithmetic-mean convention; counts cancel so it's mean-over-mean.) */
function downsideCapture(fundRets, benchRets) {
  const n = Math.min(fundRets.length, benchRets.length);
  let sf = 0, sb = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (benchRets[i] < 0) { sf += fundRets[i]; sb += benchRets[i]; count++; }
  }
  if (count === 0 || sb === 0) return NaN;
  return (sf / sb) * 100;
}

/* =====================================================================
 * 3. LEAKAGE & STRUCTURE CONTROL ENGINE
 * ===================================================================== */

/* ---- TER vs BER — hidden-cost leakage in absolute rupees -----------
 * A Regular plan's higher expense ratio is a multiplicative drag every year.
 * Over a long horizon that small gap silently transfers a big slice of the
 * corpus to commissions. This projects the SAME gross-return path under the
 * Direct vs Regular expense ratio and reports the rupee gap and its share of
 * the Direct corpus. Works for either a lump sum, a monthly SIP, or both. */
function expenseLeakage({
  lumpsum = 0,
  monthlySip = 0,
  years,
  grossAnnualReturn = 0.12,
  directTer = 0.005,   // typical Direct-plan TER
  regularTer = 0.0150, // typical Regular-plan TER (incl. distributor trail)
}) {
  if (years <= 0) throw new Error('years must be positive');
  const months = Math.round(years * 12);
  // Net annual return under each plan; convert to an exact monthly rate.
  const mDirect = Math.pow(1 + (grossAnnualReturn - directTer), 1 / 12) - 1;
  const mRegular = Math.pow(1 + (grossAnnualReturn - regularTer), 1 / 12) - 1;
  const grow = (mRate) => {
    let v = lumpsum;
    for (let m = 0; m < months; m++) { v += monthlySip; v *= 1 + mRate; }
    return v;
  };
  const direct = grow(mDirect), regular = grow(mRegular);
  const leak = direct - regular;
  return {
    directCorpus: direct,
    regularCorpus: regular,
    leakageRupees: leak,
    leakagePctOfDirect: direct > 0 ? leak / direct : NaN,
    terGap: regularTer - directTer,
  };
}

/* ---- Portfolio Overlap % — the "Zoo of Schemes" filter -------------
 * Two funds that hold the same stocks aren't diversification — they're double
 * fees for one bet. Given each fund's underlying holdings as
 * [{ stock, weight }] (weights as fractions, ideally summing to ~1), returns
 * the overlap as the sum of the MINIMUM common weight per shared stock — the
 * standard fund-overlap measure — plus a red-flag when it exceeds `flagAt`. */
function portfolioOverlap(holdingsA, holdingsB, flagAt = 0.5) {
  const map = new Map();
  for (const h of holdingsA) map.set(h.stock, h.weight);
  let overlap = 0;
  const shared = [];
  for (const h of holdingsB) {
    if (map.has(h.stock)) {
      const w = Math.min(map.get(h.stock), h.weight);
      overlap += w;
      shared.push({ stock: h.stock, weight: w });
    }
  }
  shared.sort((x, y) => y.weight - x.weight);
  return { overlap, overlapPct: overlap, flagged: overlap >= flagAt, shared };
}

/* =====================================================================
 * 4. SPENDABLE WEALTH COUNTER
 * The real in-hand cash if you liquidated today — gross minus exit load and
 * realised capital-gains tax. Current Indian rules (FY2024-25), as named,
 * overridable constants:
 *   • Equity STCG (held < 12 mo): 20%
 *   • Equity LTCG (held ≥ 12 mo): 12.5% on gains above a ₹1.25 L exemption
 *   • Non-equity (debt) gains: taxed at slab (default 30%), no LTCG benefit
 *   • Exit load: 1% if redeemed within 365 days (typical equity), else 0
 * ===================================================================== */
const TAX = Object.freeze({
  EQUITY_STCG: 0.20,
  EQUITY_LTCG: 0.125,
  LTCG_EXEMPTION: 125000,    // ₹1.25 lakh aggregate equity LTCG exemption / yr
  EQUITY_LTCG_DAYS: 365,     // ≥ 365 days = long term for equity
  DEBT_SLAB: 0.30,           // post-Apr-2023 debt: slab; default top slab
  EXIT_LOAD_PCT: 0.01,
  EXIT_LOAD_DAYS: 365,
});

const DAY = 24 * 3600 * 1000;
function daysHeld(purchaseDate, asOf) {
  return Math.max(0, Math.floor((toDate(asOf).getTime() - toDate(purchaseDate).getTime()) / DAY));
}

const isEquity = (cat) => /equity|elss|index|hybrid.*aggress|flexi|large|mid|small|multi/i.test(cat || '');

/** Per-holding liquidation breakdown (gain, term, exit load) as of a date. */
function holdingLiquidation(h, asOf, tax = TAX) {
  const current = h.units * h.nav;
  const invested = h.invested != null ? h.invested : h.units * h.avgCost;
  const gain = current - invested;
  const held = daysHeld(h.purchaseDate, asOf);
  const equity = isEquity(h.category);
  const longTerm = held >= tax.EQUITY_LTCG_DAYS;
  const exitLoad = held < tax.EXIT_LOAD_DAYS ? current * (h.exitLoadPct != null ? h.exitLoadPct : tax.EXIT_LOAD_PCT) : 0;
  let term;
  if (!equity) term = 'DEBT';
  else term = longTerm ? 'LTCG' : 'STCG';
  return { scheme: h.scheme, current, invested, gain, daysHeld: held, equity, term, exitLoad };
}

/** Net spendable cash for the whole portfolio, with a full tax breakdown.
 *  The ₹1.25 L LTCG exemption is applied across all equity-LTCG gains. */
function netSpendableCash(holdings, asOf, tax = TAX) {
  const lines = holdings.map((h) => holdingLiquidation(h, asOf, tax));
  let gross = 0, exitLoad = 0, stcgGain = 0, ltcgGain = 0, debtGain = 0;
  for (const l of lines) {
    gross += l.current;
    exitLoad += l.exitLoad;
    if (l.gain > 0) {
      if (l.term === 'STCG') stcgGain += l.gain;
      else if (l.term === 'LTCG') ltcgGain += l.gain;
      else debtGain += l.gain;
    }
  }
  const stcgTax = stcgGain * tax.EQUITY_STCG;
  const taxableLtcg = Math.max(0, ltcgGain - tax.LTCG_EXEMPTION);
  const ltcgTax = taxableLtcg * tax.EQUITY_LTCG;
  const debtTax = debtGain * tax.DEBT_SLAB;
  const totalTax = stcgTax + ltcgTax + debtTax;
  const net = gross - exitLoad - totalTax;
  return {
    gross, exitLoad,
    stcgGain, stcgTax,
    ltcgGain, ltcgExemptionUsed: Math.min(ltcgGain, tax.LTCG_EXEMPTION), taxableLtcg, ltcgTax,
    debtGain, debtTax,
    totalTax, net, lines,
  };
}

/* =====================================================================
 * 5. PORTFOLIO AGGREGATION
 * ===================================================================== */

function portfolioSummary(holdings) {
  let invested = 0, current = 0;
  const byCategory = {}, byPlan = { Direct: 0, Regular: 0 };
  for (const h of holdings) {
    const inv = h.invested != null ? h.invested : h.units * h.avgCost;
    const cur = h.units * h.nav;
    invested += inv; current += cur;
    byCategory[h.assetClass || h.category] = (byCategory[h.assetClass || h.category] || 0) + cur;
    byPlan[h.plan] = (byPlan[h.plan] || 0) + cur;
  }
  const allocation = {};
  for (const k in byCategory) allocation[k] = current > 0 ? byCategory[k] / current : 0;
  return {
    invested, current,
    pnl: current - invested,
    absoluteReturn: invested > 0 ? (current - invested) / invested : 0,
    byCategory, allocation,
    planSplit: { Direct: current > 0 ? byPlan.Direct / current : 0, Regular: current > 0 ? byPlan.Regular / current : 0 },
  };
}

/** Whole-portfolio XIRR from each holding's dated transactions plus a final
 *  positive flow for today's total value. Falls back to a single lump flow per
 *  holding (at its purchaseDate) when no transaction list is supplied. */
function portfolioXirr(holdings, asOf) {
  const flows = [];
  for (const h of holdings) {
    if (h.transactions && h.transactions.length) {
      for (const t of h.transactions) flows.push({ date: t.date, amount: -Math.abs(t.amount) });
    } else {
      const inv = h.invested != null ? h.invested : h.units * h.avgCost;
      flows.push({ date: h.purchaseDate, amount: -inv });
    }
  }
  const totalValue = holdings.reduce((s, h) => s + h.units * h.nav, 0);
  flows.push({ date: asOf, amount: totalValue });
  return xirr(flows);
}

/* =====================================================================
 * 6. FULL DIAGNOSTIC RUN — assembles every Part-1 metric for a portfolio
 * ===================================================================== */
function diagnose(portfolio, opts = {}) {
  const asOf = opts.asOf || portfolio.asOf || new Date().toISOString().slice(0, 10);
  const rf = opts.annualRiskFree != null ? opts.annualRiskFree : 0.065;
  const benchRets = periodReturns(portfolio.benchmark.navHistory);

  const funds = portfolio.holdings.map((h) => {
    const invested = h.invested != null ? h.invested : h.units * h.avgCost;
    const current = h.units * h.nav;
    const fundRets = h.navHistory ? periodReturns(h.navHistory) : null;
    const yearsHeld = daysHeld(h.purchaseDate, asOf) / 365;
    const risk = fundRets
      ? (() => {
          const ja = jensenAlpha(fundRets, benchRets, rf);
          return {
            alpha: ja.alpha, beta: ja.beta,
            sharpe: sharpe(fundRets, rf),
            downsideCapture: downsideCapture(fundRets, benchRets),
            annReturn: ja.fundReturn, annVol: annualizedVol(fundRets),
          };
        })()
      : null;
    const rolling = h.navHistory
      ? { '3y': rollingReturns(h.navHistory, 3), '5y': rollingReturns(h.navHistory, 5) }
      : null;
    return {
      scheme: h.scheme, amc: h.amc, category: h.category, assetClass: h.assetClass || h.category,
      plan: h.plan, ter: h.ter, invested, current,
      absoluteReturn: absoluteReturn(invested, current),
      cagr: yearsHeld > 0 ? cagr(invested, current, yearsHeld) : NaN,
      xirr: portfolioXirr([h], asOf),
      yearsHeld, risk, rolling,
      underlying: h.underlying || null,
      // Deadwood flag: chronic underperformer vs benchmark on a risk-adjusted basis.
      deadwood: !!(risk && risk.alpha < -0.01 && risk.annReturn < jensenAlpha(benchRets, benchRets, rf).fundReturn),
    };
  });

  // Pairwise overlap among equity funds that expose underlying holdings.
  const overlaps = [];
  for (let i = 0; i < portfolio.holdings.length; i++) {
    for (let j = i + 1; j < portfolio.holdings.length; j++) {
      const a = portfolio.holdings[i], b = portfolio.holdings[j];
      if (a.underlying && b.underlying) {
        const ov = portfolioOverlap(a.underlying, b.underlying);
        if (ov.overlap > 0.15) overlaps.push({ a: a.scheme, b: b.scheme, ...ov });
      }
    }
  }
  overlaps.sort((x, y) => y.overlap - x.overlap);

  // Cost leakage: project the Regular-plan slice's gap to Direct over a horizon.
  const regularHoldings = portfolio.holdings.filter((h) => h.plan === 'Regular');
  const regularValue = regularHoldings.reduce((s, h) => s + h.units * h.nav, 0);
  const leakage = expenseLeakage({
    lumpsum: regularValue,
    years: opts.leakageHorizonYears || 15,
    grossAnnualReturn: 0.12,
  });
  leakage.regularValueToday = regularValue;

  return {
    asOf,
    summary: portfolioSummary(portfolio.holdings),
    portfolioXirr: portfolioXirr(portfolio.holdings, asOf),
    funds,
    overlaps,
    leakage,
    spendable: netSpendableCash(portfolio.holdings, asOf),
  };
}

/* =====================================================================
 * 7. SAMPLE / DEMO PORTFOLIO  (illustrative — clearly labelled inputs)
 * NAV histories are generated from a seeded PRNG with named drift/vol so the
 * dashboard is reproducible and the math has real series to chew on. These are
 * NOT real fund NAVs; they exist so every metric above is a live computation.
 * ===================================================================== */

/** Build `months+1` monthly NAVs from a seeded geometric random walk. */
function buildNavHistory(seed, months, annDrift, annVol, startNav = 100) {
  const rand = mulberry32(seed);
  const mDrift = Math.pow(1 + annDrift, 1 / 12) - 1;
  const mVol = annVol / Math.sqrt(12);
  const nav = [startNav];
  for (let m = 1; m <= months; m++) {
    const shock = mDrift + mVol * gaussian(rand);
    nav.push(Math.max(1, nav[m - 1] * (1 + shock)));
  }
  return nav;
}

/** Build a fund NAV history CORRELATED to a benchmark — the realistic case.
 *  Each month: fundReturn = mAlpha + beta·benchReturn + idioVol·noise. This
 *  makes the demo's Beta ≈ `targetBeta`, Jensen Alpha ≈ `annAlpha`, and the
 *  downside capture track beta — so every risk stat actually demonstrates its
 *  concept instead of being noise. */
function buildCorrelatedNav(seed, benchNav, targetBeta, annAlpha, annIdioVol, startNav = 100) {
  const rand = mulberry32(seed);
  const benchRets = periodReturns(benchNav);
  const mAlpha = annAlpha / 12;          // small monthly alpha drip
  const mIdio = annIdioVol / Math.sqrt(12);
  const nav = [startNav];
  for (let i = 0; i < benchRets.length; i++) {
    const r = mAlpha + targetBeta * benchRets[i] + mIdio * gaussian(rand);
    nav.push(Math.max(1, nav[i] * (1 + r)));
  }
  return nav;
}

function isoMonthsAgo(months, asOf) {
  const d = toDate(asOf);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** A realistic, deliberately-imperfect demo portfolio: a couple of overlapping
 *  large-caps, a deadwood underperformer, a costly Regular plan, fresh units
 *  that would attract STCG + exit load, and long-held units sitting on LTCG. */
function samplePortfolio(asOf = '2026-06-20') {
  const M = 60; // 5 years of monthly history
  // Benchmark: Nifty-50-like, ~11.5%/yr drift, ~15% vol.
  const benchmark = { name: 'Nifty 50 TRI (illustrative)', navHistory: buildNavHistory(14, M, 0.115, 0.15, 1000) };

  // Two large-caps with a deliberately high stock overlap.
  const largeStocks = ['HDFC Bank', 'Reliance', 'ICICI Bank', 'Infosys', 'TCS', 'L&T', 'Axis Bank', 'Bharti Airtel', 'ITC', 'SBI'];
  const lcA = largeStocks.map((s, i) => ({ stock: s, weight: [0.10, 0.09, 0.08, 0.07, 0.07, 0.06, 0.05, 0.05, 0.04, 0.04][i] }));
  const lcB = largeStocks.map((s, i) => ({ stock: s, weight: [0.09, 0.08, 0.08, 0.08, 0.06, 0.05, 0.06, 0.04, 0.05, 0.04][i] }));
  const midStocks = ['Cummins India', 'Persistent', 'Trent', 'Polycab', 'Supreme Inds', 'AU Small Fin', 'Coforge', 'Federal Bank'];
  const mid = midStocks.map((s, i) => ({ stock: s, weight: [0.09, 0.08, 0.08, 0.07, 0.07, 0.06, 0.06, 0.05][i] }));

  const B = benchmark.navHistory;
  const holdings = [
    {
      // Solid large-cap: near-market beta, small positive alpha.
      scheme: 'Bluechip Large Cap Fund', amc: 'AMC One', category: 'Large Cap Equity', assetClass: 'Equity',
      plan: 'Direct', ter: 0.0055, purchaseDate: isoMonthsAgo(54, asOf),
      navHistory: buildCorrelatedNav(17, B, 0.95, 0.015, 0.04, 100),
      underlying: lcA,
    },
    {
      // Regular-plan twin of Bluechip: same bet, ~no alpha, heavy stock overlap.
      scheme: 'Prime Large Cap Fund', amc: 'AMC Two', category: 'Large Cap Equity', assetClass: 'Equity',
      plan: 'Regular', ter: 0.0175, purchaseDate: isoMonthsAgo(48, asOf),
      navHistory: buildCorrelatedNav(13, B, 1.00, 0.000, 0.05, 100),
      underlying: lcB,
    },
    {
      // Mid-cap star: higher beta, genuine alpha, more idiosyncratic risk.
      scheme: 'Emerging Mid Cap Fund', amc: 'AMC Three', category: 'Mid Cap Equity', assetClass: 'Equity',
      plan: 'Direct', ter: 0.0070, purchaseDate: isoMonthsAgo(40, asOf),
      navHistory: buildCorrelatedNav(21, B, 1.15, 0.030, 0.10, 100),
      underlying: mid,
    },
    {
      // Deadwood: high beta, clearly NEGATIVE alpha — takes the risk, misses the reward.
      scheme: 'Laggard Focused Fund', amc: 'AMC Four', category: 'Multi Cap Equity', assetClass: 'Equity',
      plan: 'Regular', ter: 0.0190, purchaseDate: isoMonthsAgo(36, asOf),
      navHistory: buildCorrelatedNav(29, B, 1.05, -0.045, 0.09, 100),
      underlying: midStocks.slice(0, 5).map((s, i) => ({ stock: s, weight: [0.12, 0.11, 0.10, 0.09, 0.08][i] })),
    },
    {
      scheme: 'Short Duration Debt Fund', amc: 'AMC One', category: 'Debt — Short Duration', assetClass: 'Debt',
      plan: 'Direct', ter: 0.0035, purchaseDate: isoMonthsAgo(30, asOf),
      navHistory: buildNavHistory(33, M, 0.068, 0.02, 100),
      underlying: null,
    },
    {
      scheme: 'Liquid Fund', amc: 'AMC Two', category: 'Debt — Liquid', assetClass: 'Debt',
      plan: 'Direct', ter: 0.0020, purchaseDate: isoMonthsAgo(6, asOf), // fresh -> STCG + exit-load window
      navHistory: buildNavHistory(37, M, 0.063, 0.005, 100),
      underlying: null,
    },
  ];

  // Derive units/invested/transactions from a single dated buy at purchaseDate,
  // priced off each fund's own history so current value is internally consistent.
  for (const h of holdings) {
    const buyAmount = {
      'Bluechip Large Cap Fund': 300000, 'Prime Large Cap Fund': 250000,
      'Emerging Mid Cap Fund': 200000, 'Laggard Focused Fund': 150000,
      'Short Duration Debt Fund': 200000, 'Liquid Fund': 120000,
    }[h.scheme];
    const monthsAgo = Math.round(daysHeld(h.purchaseDate, asOf) / 30.4375);
    const idx = Math.max(0, h.navHistory.length - 1 - monthsAgo);
    h.avgCost = h.navHistory[idx];
    h.nav = h.navHistory[h.navHistory.length - 1];
    h.units = buyAmount / h.avgCost;
    h.invested = buyAmount;
    h.transactions = [{ date: h.purchaseDate, amount: buyAmount }];
  }

  return { name: 'Illustrative Demo Portfolio', asOf, benchmark, holdings };
}

/* =====================================================================
 * Node export for the test harness; harmless in the browser.
 * ===================================================================== */
const ORACLE = {
  // utils
  mulberry32, gaussian, mean, stdev, covariance, variance, periodReturns,
  // returns
  absoluteReturn, cagr, xirr, rollingReturns,
  // risk
  annualizedReturn, annualizedVol, beta, jensenAlpha, sharpe, downsideCapture,
  // leakage & structure
  expenseLeakage, portfolioOverlap,
  // spendable
  TAX, daysHeld, holdingLiquidation, netSpendableCash,
  // aggregation & diagnosis
  portfolioSummary, portfolioXirr, diagnose,
  // sample data
  buildNavHistory, buildCorrelatedNav, samplePortfolio,
};

if (typeof module !== 'undefined' && module.exports) module.exports = ORACLE;
if (typeof window !== 'undefined') window.ORACLE = ORACLE;
