/* =====================================================================
 * The Autonomous Portfolio Oracle — Part 2: "Future" Prognostic Engine
 * ---------------------------------------------------------------------
 * The AI co-pilot. Looks forward from the portfolio Part 1 diagnosed and
 * computes the protective moves: how big a corpus financial freedom needs,
 * how to glide equity down to safety as a goal nears, when valuations say
 * book or buy, and what real history would do to this portfolio.
 *
 * Pure, deterministic, dependency-free, Node-exported. Consumes the SAME
 * portfolio data model and ORACLE engine as Part 1 (oracle.js) — it never
 * re-derives a figure Part 1 already computes.
 *
 * Implements Part 2 of the Master Specification:
 *   1. Dynamic Financial Freedom Number (FFN)
 *   2. Autonomous Glide-Path reallocation countdown
 *   3. Valuation-based dynamic rebalancing (Nifty PE / PB / MCap-to-GDP)
 *   4. "What-If" historical stress-test simulator
 *
 * HONESTY NOTE: every output is COMPUTED from the inputs. Inflation, return,
 * retirement-horizon and valuation thresholds are clearly-named, overridable
 * assumptions; the stress shocks are illustrative depths anchored to real
 * index drawdowns (the same history the "Two Doors" engine uses), applied
 * allocation-aware so the portfolio-level number emerges from YOUR mix.
 * ===================================================================== */
'use strict';

(function (root, factory) {
  const ORACLE = (typeof require !== 'undefined') ? require('./oracle.js') : root.ORACLE;
  const FUTURE = factory(ORACLE);
  if (typeof module !== 'undefined' && module.exports) module.exports = FUTURE;
  if (typeof window !== 'undefined') window.FUTURE = FUTURE;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ORACLE) {

  /* ---- named, overridable assumptions ---- */
  const ASSUME = Object.freeze({
    INFLATION: 0.06,          // live CPI would replace this
    PRE_RETURN: 0.11,         // expected nominal return while accumulating
    POST_RETURN: 0.08,        // expected nominal return through retirement
    RETIREMENT_YEARS: 30,     // years the corpus must last after the goal
    SWR: 0.035,               // safe withdrawal rate (cross-check view)
    HYBRID_EQUITY: 0.60,      // assumed equity share of a Hybrid fund
  });

  /* =====================================================================
   * 1. DYNAMIC FINANCIAL FREEDOM NUMBER (FFN)
   * ===================================================================== */

  /** Future Monthly Expense = Current × (1 + inflation)^years. */
  function futureMonthlyExpense(currentMonthly, years, inflation = ASSUME.INFLATION) {
    return currentMonthly * Math.pow(1 + inflation, years);
  }

  /** Corpus needed at the goal to fund an inflation-indexed monthly spend for
   *  `retirementYears`, as the present value (at the goal) of a growing annuity
   *  paid at each year's start. */
  function ffnCorpus({
    currentMonthlyExpense, yearsToGoal,
    inflation = ASSUME.INFLATION, retirementYears = ASSUME.RETIREMENT_YEARS,
    postReturn = ASSUME.POST_RETURN,
  }) {
    const fme = futureMonthlyExpense(currentMonthlyExpense, yearsToGoal, inflation);
    const firstYearSpend = fme * 12;
    const i = postReturn, g = inflation, N = retirementYears;
    let corpus;
    if (Math.abs(i - g) < 1e-9) {
      corpus = (firstYearSpend * N) / (1 + i);
    } else {
      corpus = firstYearSpend * (1 - Math.pow((1 + g) / (1 + i), N)) / (i - g);
    }
    return { futureMonthlyExpense: fme, firstYearSpend, requiredCorpus: corpus, swrCrossCheck: firstYearSpend / ASSUME.SWR };
  }

  /** Future value of a lump sum plus a start-of-month SIP, both compounded at
   *  an exact monthly rate derived from the annual return. */
  function projectCorpus({ currentCorpus, monthlySip, yearsToGoal, annualReturn = ASSUME.PRE_RETURN }) {
    const n = Math.round(yearsToGoal * 12);
    const mr = Math.pow(1 + annualReturn, 1 / 12) - 1;
    const growth = Math.pow(1 + mr, n);
    const fvLump = currentCorpus * growth;
    const fvSip = mr === 0 ? monthlySip * n : monthlySip * ((growth - 1) / mr) * (1 + mr);
    return { projectedCorpus: fvLump + fvSip, fromCurrent: fvLump, fromSip: fvSip };
  }

  /** Extra monthly SIP required for an FV-of-SIP stream to fill a corpus gap. */
  function requiredSipTopUp(gap, yearsToGoal, annualReturn = ASSUME.PRE_RETURN) {
    if (gap <= 0) return 0;
    const n = Math.round(yearsToGoal * 12);
    const mr = Math.pow(1 + annualReturn, 1 / 12) - 1;
    const factor = mr === 0 ? n : ((Math.pow(1 + mr, n) - 1) / mr) * (1 + mr);
    return gap / factor;
  }

  /** The whole FFN picture: target corpus, projection, gap, on-track flag, and
   *  the SIP top-up that would close any shortfall. `alignmentRatio` (projected
   *  ÷ required) feeds Part 3's Health Score alignment pillar. */
  function ffnPlan({
    currentCorpus, monthlySip, currentMonthlyExpense, yearsToGoal,
    inflation = ASSUME.INFLATION, annualReturn = ASSUME.PRE_RETURN,
    retirementYears = ASSUME.RETIREMENT_YEARS, postReturn = ASSUME.POST_RETURN,
  }) {
    const target = ffnCorpus({ currentMonthlyExpense, yearsToGoal, inflation, retirementYears, postReturn });
    const proj = projectCorpus({ currentCorpus, monthlySip, yearsToGoal, annualReturn });
    const gap = target.requiredCorpus - proj.projectedCorpus;
    const sipTopUp = requiredSipTopUp(gap, yearsToGoal, annualReturn);
    return {
      ...target,
      ...proj,
      yearsToGoal, currentMonthlyExpense, monthlySip,
      gap,
      onTrack: gap <= 0,
      sipTopUp,
      alignmentRatio: target.requiredCorpus > 0 ? proj.projectedCorpus / target.requiredCorpus : Infinity,
    };
  }

  /* =====================================================================
   * 2. AUTONOMOUS GLIDE-PATH COUNTDOWN
   * Equity is dialled down as the goal nears, so a last-minute crash can't
   * undo the plan. Anchors from the spec; linearly interpolated in between.
   * ===================================================================== */
  const GLIDE_ANCHORS = [
    { years: 10, equity: 1.00 }, // 10+ yrs: full growth
    { years: 5, equity: 0.85 }, // 5 yrs: start trimming
    { years: 3, equity: 0.70 }, // 3 yrs: protective layer (STP trigger)
    { years: 1, equity: 0.50 }, // 1 yr: half in ultra-safe assets
    { years: 0, equity: 0.50 },
  ];

  /** Target equity/debt split for a given horizon. */
  function glidePath(yearsToGoal) {
    if (yearsToGoal >= 10) return { equity: 1.0, debt: 0.0 };
    if (yearsToGoal <= 0) return { equity: 0.5, debt: 0.5 };
    for (let i = 0; i < GLIDE_ANCHORS.length - 1; i++) {
      const hi = GLIDE_ANCHORS[i], lo = GLIDE_ANCHORS[i + 1];
      if (yearsToGoal <= hi.years && yearsToGoal >= lo.years) {
        const t = (yearsToGoal - lo.years) / (hi.years - lo.years);
        const equity = lo.equity + t * (hi.equity - lo.equity);
        return { equity, debt: 1 - equity };
      }
    }
    return { equity: 1.0, debt: 0.0 };
  }

  /** Equity fraction of a portfolio, treating Hybrid as part equity. */
  function equityFraction(summary) {
    const a = summary.allocation || {};
    return (a.Equity || 0) + ASSUME.HYBRID_EQUITY * (a.Hybrid || 0);
  }

  /** Compare the current mix to the glide-path target and size the STP move
   *  (rupees of equity to shift into debt, or vice-versa) to get back on path. */
  function glidePlan(portfolio, yearsToGoal) {
    const summary = ORACLE.portfolioSummary(portfolio.holdings);
    const currentEquity = equityFraction(summary);
    const target = glidePath(yearsToGoal);
    const drift = currentEquity - target.equity; // +ve => too much equity
    const rupeesToShift = Math.abs(drift) * summary.current;
    return {
      yearsToGoal,
      currentEquity, currentDebt: 1 - currentEquity,
      targetEquity: target.equity, targetDebt: target.debt,
      drift,
      direction: Math.abs(drift) < 0.02 ? 'on-track' : (drift > 0 ? 'equity->debt' : 'debt->equity'),
      rupeesToShift: Math.abs(drift) < 0.02 ? 0 : rupeesToShift,
      currentValue: summary.current,
    };
  }

  /* =====================================================================
   * 3. VALUATION-BASED DYNAMIC REBALANCING
   * Rebalances on what the market is worth, not the calendar.
   * ===================================================================== */
  const VALUATION = Object.freeze({
    OVERVALUED_PE: 25,   // > this: book profit, trim equity
    UNDERVALUED_PE: 18,  // < this: deploy the debt buffer into equity
    TRIM_FRACTION: 0.125, // shift ~10-15% of equity out at rich valuations
    DEPLOY_FRACTION: 0.125,
  });

  /** Signal + sized action from a market PE (PB / MCap-GDP can refine later). */
  function valuationSignal(pe, portfolio, cfg = VALUATION) {
    const summary = ORACLE.portfolioSummary(portfolio.holdings);
    const equityValue = ((summary.allocation.Equity || 0) + ASSUME.HYBRID_EQUITY * (summary.allocation.Hybrid || 0)) * summary.current;
    const debtValue = summary.current - equityValue;
    if (pe > cfg.OVERVALUED_PE) {
      return {
        zone: 'overvalued', pe,
        headline: 'Market is in an expensive zone — book some profit.',
        action: 'equity->debt',
        moveRupees: equityValue * cfg.TRIM_FRACTION,
        movePctOfEquity: cfg.TRIM_FRACTION,
        rationale: `Nifty PE ${pe.toFixed(1)} is above ${cfg.OVERVALUED_PE}. Shift ~${Math.round(cfg.TRIM_FRACTION * 100)}% of equity into safe debt to lock gains.`,
      };
    }
    if (pe < cfg.UNDERVALUED_PE) {
      return {
        zone: 'undervalued', pe,
        headline: 'Market is cheap — this is the time to add, not to panic.',
        action: 'debt->equity',
        moveRupees: Math.min(debtValue, equityValue * cfg.DEPLOY_FRACTION),
        movePctOfEquity: cfg.DEPLOY_FRACTION,
        rationale: `Nifty PE ${pe.toFixed(1)} is below ${cfg.UNDERVALUED_PE}. Deploy your debt buffer into equity to top up at a discount.`,
      };
    }
    return {
      zone: 'fair', pe,
      headline: 'Valuations are in a fair zone — stay the course.',
      action: 'hold', moveRupees: 0, movePctOfEquity: 0,
      rationale: `Nifty PE ${pe.toFixed(1)} sits between ${cfg.UNDERVALUED_PE} and ${cfg.OVERVALUED_PE}. No valuation-driven move needed.`,
    };
  }

  /* =====================================================================
   * 4. "WHAT-IF" HISTORICAL STRESS-TEST SIMULATOR
   * Shocks are illustrative depths anchored to real index history, applied
   * allocation-aware (equity takes the hit; debt barely moves), so the
   * portfolio-level drawdown emerges from YOUR mix rather than being asserted.
   * ===================================================================== */
  const SCENARIOS = Object.freeze({
    gfc2008: {
      id: 'gfc2008', name: '2008 Global Financial Crisis',
      equityShock: -0.55, debtShock: -0.03, recoveryMonths: 27,
      blurb: 'The deepest modern crash. Equities roughly halved; recovery took years, not months.',
    },
    covid2020: {
      id: 'covid2020', name: '2020 COVID Crash',
      equityShock: -0.38, debtShock: -0.01, recoveryMonths: 8,
      blurb: 'The fastest fall — and the fastest forgiveness. A sharp ~38% drop, then a V-shaped recovery within months.',
    },
    sideways: {
      id: 'sideways', name: 'Sideways Market (2010–2013)',
      equityShock: 0.0, debtShock: 0.0, flatYears: 3, recoveryMonths: 0,
      blurb: 'No crash — just three years of 0% returns. A test of patience and holding cost, not of nerve.',
    },
  });

  /** Apply a scenario to the current portfolio. Returns the immediate
   *  drawdown, trough value, rupee loss and recovery timeline. */
  function stressTest(portfolio, scenarioId) {
    const sc = SCENARIOS[scenarioId];
    if (!sc) throw new Error('unknown scenario: ' + scenarioId);
    const summary = ORACLE.portfolioSummary(portfolio.holdings);
    const eqFrac = equityFraction(summary);
    const debtFrac = 1 - eqFrac;
    const drawdown = eqFrac * sc.equityShock + debtFrac * sc.debtShock; // weighted, negative
    const troughValue = summary.current * (1 + drawdown);
    return {
      scenario: sc,
      currentValue: summary.current,
      equityFraction: eqFrac,
      drawdownPct: drawdown,
      troughValue,
      lossRupees: summary.current - troughValue,
      recoveryMonths: sc.recoveryMonths,
      flatYears: sc.flatYears || 0,
    };
  }

  function stressAll(portfolio) {
    return Object.keys(SCENARIOS).map((id) => stressTest(portfolio, id));
  }

  /* =====================================================================
   * Aggregate Part-2 run for a portfolio + a set of "future" inputs.
   * ===================================================================== */
  function prognose(portfolio, inputs = {}) {
    const summary = ORACLE.portfolioSummary(portfolio.holdings);
    const yearsToGoal = inputs.yearsToGoal != null ? inputs.yearsToGoal : 20;
    const ffn = ffnPlan({
      currentCorpus: summary.current,
      monthlySip: inputs.monthlySip != null ? inputs.monthlySip : 30000,
      currentMonthlyExpense: inputs.currentMonthlyExpense != null ? inputs.currentMonthlyExpense : 50000,
      yearsToGoal,
      inflation: inputs.inflation,
      annualReturn: inputs.annualReturn,
    });
    return {
      ffn,
      glide: glidePlan(portfolio, yearsToGoal),
      valuation: valuationSignal(inputs.niftyPE != null ? inputs.niftyPE : 22.5, portfolio),
      stress: stressAll(portfolio),
    };
  }

  return {
    ASSUME, GLIDE_ANCHORS, VALUATION, SCENARIOS,
    futureMonthlyExpense, ffnCorpus, projectCorpus, requiredSipTopUp, ffnPlan,
    glidePath, equityFraction, glidePlan,
    valuationSignal,
    stressTest, stressAll,
    prognose,
  };
});
