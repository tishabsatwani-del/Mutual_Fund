/* =====================================================================
 * Autonomous Portfolio Oracle — DYNAMIC STOCHASTIC Monte Carlo engine
 * ---------------------------------------------------------------------
 * The companion `oracle-sim.js` runs a *static* geometric random walk:
 * one mu, one sigma, one fixed allocation, for the whole horizon. Real
 * portfolios — and the master spec — are not static. This engine makes
 * every lever in the spec move WITH TIME and WITH CHANCE:
 *
 *   • DYNAMIC ALLOCATION (Autonomous Glide-Path) — equity is dialled down
 *     as the goal nears (spec's 100 → 85 → 70 → 50% schedule), so each
 *     month is simulated at the allocation you'd actually be holding then.
 *   • REGIME-SWITCHING VOLATILITY — a 2-state Markov chain (calm / crisis)
 *     drives equity returns, so crashes CLUSTER and fat tails emerge from
 *     the dynamics (the 2008/COVID character) rather than a cosmetic shock.
 *   • STOCHASTIC INFLATION — a mean-reverting CPI path grows the spending
 *     target, so the "Dynamic FFN" finish line MOVES, differently on every
 *     path. Success is measured against each path's own inflated target.
 *   • DYNAMIC SIP — a yearly step-up grows contributions over time.
 *
 * Pure, deterministic (seeded), Node-exported. Everything is computed;
 * the named constants below are clearly-labelled, overridable assumptions.
 * ===================================================================== */
'use strict';

(function (root, factory) {
  const ORACLE = (typeof require !== 'undefined') ? require('./oracle.js') : root.ORACLE;
  const SIM = (typeof require !== 'undefined') ? require('./oracle-sim.js') : root.SIM;
  const DSMC = factory(ORACLE, SIM);
  if (typeof module !== 'undefined' && module.exports) module.exports = DSMC;
  if (typeof window !== 'undefined') window.DSMC = DSMC;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ORACLE, SIM) {

  /* ---- asset-class fallbacks (mirror oracle-sim for a consistent base) ---- */
  const CLASS_PARAMS = {
    Equity: { mu: 0.12, sigma: 0.16 },
    Hybrid: { mu: 0.095, sigma: 0.09 },
    Debt: { mu: 0.066, sigma: 0.025 },
  };
  const HYBRID_EQUITY = 0.60; // equity share attributed to a Hybrid fund

  /* ---- the spec's Autonomous Glide-Path anchors (years-to-goal -> equity) ---- */
  const GLIDE_ANCHORS = [
    { years: 10, equity: 1.00 },
    { years: 5, equity: 0.85 },
    { years: 3, equity: 0.70 },
    { years: 1, equity: 0.50 },
    { years: 0, equity: 0.50 },
  ];

  /** Equity weight prescribed for a given remaining horizon (interpolated). */
  function glideEquity(yearsRemaining) {
    if (yearsRemaining >= 10) return 1.0;
    if (yearsRemaining <= 0) return 0.5;
    for (let i = 0; i < GLIDE_ANCHORS.length - 1; i++) {
      const hi = GLIDE_ANCHORS[i], lo = GLIDE_ANCHORS[i + 1];
      if (yearsRemaining <= hi.years && yearsRemaining >= lo.years) {
        const t = (yearsRemaining - lo.years) / (hi.years - lo.years);
        return lo.equity + t * (hi.equity - lo.equity);
      }
    }
    return 1.0;
  }

  /* ---- regime-switching model (monthly Markov chain on the equity sleeve) ----
   * Calm and crisis differ in drift and volatility. Transition probabilities
   * are set so crises are infrequent but, once begun, persist a few months —
   * which is what makes drawdowns cluster instead of averaging away. */
  const REGIME = Object.freeze({
    P_CALM_TO_CRISIS: 0.025, // ~ one crisis onset every ~40 months
    P_CRISIS_TO_CALM: 0.25,  // a crisis lasts ~4 months on average
    CRISIS_DRIFT: 0.055,     // extra monthly drag while in crisis (≈ -6%/mo)
    CALM_VOL_MULT: 0.85,     // calm months are a touch quieter than average
    CRISIS_VOL_MULT: 2.6,    // crisis months are far wilder
    DEBT_CRISIS_BUMP: 0.0015, // mild flight-to-safety lift for debt in a crisis
  });
  // Long-run share of months spent in crisis (stationary distribution).
  const CRISIS_FRACTION = REGIME.P_CALM_TO_CRISIS / (REGIME.P_CALM_TO_CRISIS + REGIME.P_CRISIS_TO_CALM);

  /* ---- stochastic inflation (mean-reverting AR(1) on the annual CPI rate) ---- */
  const INFLATION = Object.freeze({
    MEAN: 0.06,   // long-run anchor (live CPI would replace this)
    RHO: 0.80,    // monthly persistence
    VOL: 0.004,   // monthly shock sd on the annual rate
    SWR: 0.035,   // safe withdrawal rate used to size the moving FFN target
  });

  const PCTS = [5, 10, 25, 50, 75, 90, 95];
  const percentile = SIM ? SIM.percentile : function (sortedAsc, p) {
    if (!sortedAsc.length) return NaN;
    const idx = (p / 100) * (sortedAsc.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
  };

  /** Split a portfolio into an equity sleeve and a debt sleeve, estimating
   *  each sleeve's annual return & vol. Equity history is reused when present
   *  (via oracle-sim's blended estimate); otherwise asset-class assumptions.
   *  Hybrid value is split between the two sleeves by HYBRID_EQUITY. */
  function estimateSleeves(portfolio) {
    const holds = portfolio.holdings;
    const total = holds.reduce((s, h) => s + h.units * h.nav, 0) || 1;
    let eqVal = 0, dtVal = 0;
    for (const h of holds) {
      const v = h.units * h.nav;
      if (h.assetClass === 'Equity') eqVal += v;
      else if (h.assetClass === 'Hybrid') { eqVal += v * HYBRID_EQUITY; dtVal += v * (1 - HYBRID_EQUITY); }
      else dtVal += v; // Debt and anything else
    }
    const startEquity = total > 0 ? eqVal / total : 1;

    // Lean on oracle-sim's history-aware estimate for the equity sleeve's mu/sigma
    // when histories exist; fall back to the asset-class numbers otherwise.
    let equity = { mu: CLASS_PARAMS.Equity.mu, sigma: CLASS_PARAMS.Equity.sigma };
    let source = 'assumption';
    if (SIM) {
      const est = SIM.estimatePortfolioParams(portfolio);
      if (/history/.test(est.source)) {
        // De-blend the portfolio estimate back toward a pure-equity read by
        // removing the (low-vol) debt drag in proportion to the debt weight.
        const dW = total > 0 ? dtVal / total : 0, eW = 1 - dW;
        const dP = CLASS_PARAMS.Debt;
        equity = {
          mu: eW > 0.05 ? (est.annualReturn - dW * dP.mu) / eW : est.annualReturn,
          sigma: eW > 0.05 ? (est.annualVol - dW * dP.sigma) / eW : est.annualVol,
        };
        // Guard against pathological de-blends.
        if (!(equity.mu > 0.02 && equity.mu < 0.30)) equity.mu = CLASS_PARAMS.Equity.mu;
        if (!(equity.sigma > 0.06 && equity.sigma < 0.45)) equity.sigma = CLASS_PARAMS.Equity.sigma;
        source = 'history';
      }
    }
    return {
      equity,
      debt: { mu: CLASS_PARAMS.Debt.mu, sigma: CLASS_PARAMS.Debt.sigma },
      startEquity, startValue: total, source,
    };
  }

  /** Core dynamic stochastic Monte Carlo.
   *
   *  Each path walks month-by-month: the equity sleeve follows a regime-
   *  switching random walk, the debt sleeve a quiet one, and they are blended
   *  at the *current* glide-path (or static) allocation. A dynamic step-up SIP
   *  is invested at the start of each month, and a mean-reverting inflation
   *  path grows a per-path FFN target the corpus is then measured against.
   *
   *  Returns yearly percentile bands (for the fan chart), the final-value
   *  distribution, probability of clearing the (moving or fixed) target,
   *  probability of finishing below cost, the realised glide-path, and
   *  regime/inflation diagnostics. */
  function simulate({
    startValue, startEquity = 1, monthlySip = 0, stepUpRate = 0, years,
    equity = CLASS_PARAMS.Equity, debt = CLASS_PARAMS.Debt,
    mode = 'glide',              // 'glide' (dynamic allocation) | 'static'
    regimes = true,              // regime-switching volatility on/off
    stochasticInflation = true,  // moving inflation target on/off
    currentMonthlyExpense = null, // drives the per-path dynamic FFN target
    target = null,               // fixed fallback target if no expense given
    inflationMean = INFLATION.MEAN, swr = INFLATION.SWR,
    paths = 2000, seed = 12345,
  }) {
    const n = Math.round(years * 12);
    const rand = ORACLE.mulberry32(seed >>> 0);
    const gauss = () => ORACLE.gaussian(rand);

    // Monthly sleeve parameters.
    const eqM = Math.pow(1 + equity.mu, 1 / 12) - 1;
    const eqV = equity.sigma / Math.sqrt(12);
    const dtM = Math.pow(1 + debt.mu, 1 / 12) - 1;
    const dtV = debt.sigma / Math.sqrt(12);
    // Calm drift is lifted just enough that the regime-blended mean stays at eqM,
    // so switching adds clustering and fat tails without quietly changing the
    // central return the user was shown.
    const calmDrift = regimes ? eqM + (CRISIS_FRACTION / (1 - CRISIS_FRACTION)) * REGIME.CRISIS_DRIFT : eqM;
    const crisisDrift = eqM - REGIME.CRISIS_DRIFT;

    // Pre-compute the (deterministic) glide-path equity weight per month.
    const wEquity = new Array(n + 1);
    for (let m = 0; m <= n; m++) {
      const yearsRemaining = years - m / 12;
      wEquity[m] = mode === 'glide' ? glideEquity(yearsRemaining) : startEquity;
    }

    const yearlyBuckets = Array.from({ length: years + 1 }, () => []);
    const finals = [], targets = [], crisisMonthsArr = [];
    const sampleN = Math.min(40, paths);
    const samples = [];

    for (let p = 0; p < paths; p++) {
      let v = startValue;
      let inCrisis = false, crisisMonths = 0;
      let inflAnnual = inflationMean;     // current annualised CPI rate
      let expenseFactor = 1;              // cumulative inflation multiplier
      let sip = monthlySip;
      const keepSample = p < sampleN;
      const path = keepSample ? [v] : null;
      yearlyBuckets[0].push(v);

      for (let m = 1; m <= n; m++) {
        // Step-up the SIP at each year boundary.
        if (m > 1 && (m - 1) % 12 === 0) sip *= (1 + stepUpRate);

        // Regime transition for the equity sleeve.
        if (regimes) {
          if (inCrisis) { if (rand() < REGIME.P_CRISIS_TO_CALM) inCrisis = false; }
          else { if (rand() < REGIME.P_CALM_TO_CRISIS) inCrisis = true; }
          if (inCrisis) crisisMonths++;
        }
        const drift = inCrisis ? crisisDrift : calmDrift;
        const vol = eqV * (inCrisis ? REGIME.CRISIS_VOL_MULT : (regimes ? REGIME.CALM_VOL_MULT : 1));
        const rEq = drift + vol * gauss();
        const rDt = dtM + dtV * gauss() + (inCrisis ? REGIME.DEBT_CRISIS_BUMP : 0);

        // Blend at this month's allocation, after adding the SIP.
        const w = wEquity[m];
        const rPort = w * rEq + (1 - w) * rDt;
        v = (v + sip) * (1 + rPort);
        if (v < 0) v = 0;

        // Evolve the inflation path (mean-reverting AR(1)) and grow the target.
        if (stochasticInflation) {
          inflAnnual = inflationMean + INFLATION.RHO * (inflAnnual - inflationMean) + INFLATION.VOL * gauss();
          expenseFactor *= Math.pow(1 + Math.max(0, inflAnnual), 1 / 12);
        }

        if (m % 12 === 0) {
          yearlyBuckets[m / 12].push(v);
          if (keepSample) path.push(v);
        }
      }

      finals.push(v);
      crisisMonthsArr.push(crisisMonths);
      // Per-path dynamic FFN target: inflated annual spend capitalised at the SWR.
      if (currentMonthlyExpense != null) {
        const futureAnnualSpend = currentMonthlyExpense * (stochasticInflation ? expenseFactor : Math.pow(1 + inflationMean, years)) * 12;
        targets.push(futureAnnualSpend / swr);
      }
      if (keepSample) samples.push(path);
    }

    const bands = yearlyBuckets.map((bucket, year) => {
      const sorted = bucket.slice().sort((a, b) => a - b);
      const row = { year };
      for (const pc of PCTS) row['p' + pc] = percentile(sorted, pc);
      return row;
    });

    const sortedFinals = finals.slice().sort((a, b) => a - b);
    const finalPercentiles = {};
    for (const pc of PCTS) finalPercentiles['p' + pc] = percentile(sortedFinals, pc);

    // Invested = lump + the actual (stepped-up) SIP stream.
    let invested = startValue;
    {
      let sip = monthlySip;
      for (let m = 1; m <= n; m++) {
        if (m > 1 && (m - 1) % 12 === 0) sip *= (1 + stepUpRate);
        invested += sip;
      }
    }

    // Probability of clearing the target — per-path moving target when an
    // expense is given, else a single fixed target, else null.
    let probReachTarget = null, targetPercentiles = null, medianTarget = null;
    if (currentMonthlyExpense != null && targets.length) {
      let hit = 0;
      for (let i = 0; i < finals.length; i++) if (finals[i] >= targets[i]) hit++;
      probReachTarget = hit / finals.length;
      const st = targets.slice().sort((a, b) => a - b);
      targetPercentiles = {}; for (const pc of PCTS) targetPercentiles['p' + pc] = percentile(st, pc);
      medianTarget = targetPercentiles.p50;
    } else if (target != null) {
      probReachTarget = finals.filter((x) => x >= target).length / finals.length;
      medianTarget = target;
    }

    return {
      years, paths, mode, regimes, stochasticInflation,
      equity, debt,
      bands, finalPercentiles, samples, invested,
      median: finalPercentiles.p50,
      probReachTarget, probLoseMoney: finals.filter((x) => x < invested).length / finals.length,
      target: medianTarget, targetPercentiles,
      // realised glide-path, one equity weight per year boundary
      glide: Array.from({ length: years + 1 }, (_, y) => wEquity[Math.min(n, y * 12)]),
      avgCrisisMonths: crisisMonthsArr.reduce((s, x) => s + x, 0) / (crisisMonthsArr.length || 1),
      expectedCrisisFraction: regimes ? CRISIS_FRACTION : 0,
    };
  }

  /** Convenience: run the dynamic stochastic Monte Carlo straight off a
   *  portfolio, estimating the equity/debt sleeves from the holdings. */
  function simulatePortfolioDynamic(portfolio, {
    years = 20, monthlySip = 0, stepUpRate = 0, mode = 'glide',
    regimes = true, stochasticInflation = true,
    currentMonthlyExpense = null, target = null,
    paths = 2000, seed = 12345,
  } = {}) {
    const sleeves = estimateSleeves(portfolio);
    const mc = simulate({
      startValue: sleeves.startValue, startEquity: sleeves.startEquity,
      monthlySip, stepUpRate, years,
      equity: sleeves.equity, debt: sleeves.debt,
      mode, regimes, stochasticInflation, currentMonthlyExpense, target,
      paths, seed,
    });
    return { ...mc, sleeves, startValue: sleeves.startValue, startEquity: sleeves.startEquity, source: sleeves.source };
  }

  return {
    CLASS_PARAMS, GLIDE_ANCHORS, REGIME, INFLATION, CRISIS_FRACTION,
    glideEquity, estimateSleeves, percentile, simulate, simulatePortfolioDynamic,
  };
});
