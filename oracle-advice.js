/* =====================================================================
 * Autonomous Portfolio Oracle — professional advice engine
 * ---------------------------------------------------------------------
 * Turns raw diagnostics into RESPONSIBLE, suitability-aware guidance — the
 * way a fee-only planner would, not a rule-of-thumb. Three pillars:
 *
 *   1. EMERGENCY FUND FIRST. No equity advice until ~6 months of expenses
 *      sit in a liquid buffer. This is the single most important guardrail
 *      and the reason the tool never says "put it all in equity".
 *   2. SUITABILITY-CAPPED ALLOCATION. Equity is the LOWER of (a) what the
 *      risk profile allows and (b) what the time-horizon allows — always
 *      with a debt floor and a small gold sliver. Equity is never 100%.
 *   3. MULTI-FACTOR FUND QUALITY. A fund is scored on returns, risk-adjusted
 *      return, downside protection, consistency, cost and alpha — with a
 *      transparent breakdown, never a single number.
 *
 * Pure & dependency-free (Node-exported, unit-tested). Educational only —
 * not investment advice; all assumptions are named and overridable.
 * ===================================================================== */
'use strict';

(function (root, factory) {
  const ORACLE = (typeof require !== 'undefined') ? require('./oracle.js') : root.ORACLE;
  const ADVICE = factory(ORACLE);
  if (typeof module !== 'undefined' && module.exports) module.exports = ADVICE;
  if (typeof window !== 'undefined') window.ADVICE = ADVICE;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ORACLE) {

  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const lin = (x, x0, x1) => clamp((x - x0) / (x1 - x0)); // 0..1 ramp

  /* ---- named, overridable assumptions ---- */
  const ASSUME = Object.freeze({
    EMERGENCY_MONTHS: 6,        // months of expenses to hold liquid first
    HYBRID_EQUITY: 0.60,        // equity share attributed to a Hybrid fund
  });

  /* ---- risk profiles: caps a planner would actually use (never 100% equity) ---- */
  const PROFILES = Object.freeze({
    Conservative: { equityCap: 0.45, debtFloor: 0.45, gold: 0.05, blurb: 'Capital safety first; smaller swings.' },
    Moderate: { equityCap: 0.70, debtFloor: 0.20, gold: 0.05, blurb: 'Balanced growth with a real cushion.' },
    Aggressive: { equityCap: 0.85, debtFloor: 0.10, gold: 0.05, blurb: 'Growth-led, but still diversified.' },
  });

  /** Equity ceiling implied by how near the goal is (a smooth glide). Short
   *  horizons must be mostly safe regardless of appetite. */
  function horizonEquityCeiling(years) {
    if (years <= 1) return 0.15;
    const anchors = [[1, 0.15], [3, 0.35], [5, 0.55], [7, 0.65], [10, 0.78], [15, 0.85]];
    if (years >= 15) return 0.85;
    for (let i = 0; i < anchors.length - 1; i++) {
      const [y0, e0] = anchors[i], [y1, e1] = anchors[i + 1];
      if (years >= y0 && years <= y1) return e0 + (e1 - e0) * (years - y0) / (y1 - y0);
    }
    return 0.85;
  }

  /** Emergency-fund check. `liquidAssets` is whatever is already safe & liquid
   *  (liquid/overnight funds + cash). Returns the shortfall in months. */
  function emergencyFund({ monthlyExpense, liquidAssets = 0, months = ASSUME.EMERGENCY_MONTHS }) {
    const needed = monthlyExpense * months;
    const have = Math.max(0, liquidAssets);
    const ok = have >= needed;
    return { needed, have, months, ok, gap: Math.max(0, needed - have), gapMonths: monthlyExpense > 0 ? Math.max(0, (needed - have) / monthlyExpense) : 0 };
  }

  /** The recommended growth-money split (AFTER the emergency fund is carved
   *  out). Equity = min(risk cap, horizon ceiling); debt respects the floor;
   *  a small gold sliver aids diversification. Never returns 100% equity. */
  function recommendedAllocation({ profile = 'Moderate', yearsToGoal = 10 }) {
    const p = PROFILES[profile] || PROFILES.Moderate;
    const ceiling = horizonEquityCeiling(yearsToGoal);
    let equity = Math.min(p.equityCap, ceiling);
    let gold = p.gold;
    let debt = 1 - equity - gold;
    if (debt < p.debtFloor) { debt = p.debtFloor; equity = Math.max(0, 1 - debt - gold); }
    // normalise (guard rounding)
    const s = equity + debt + gold; equity /= s; debt /= s; gold /= s;
    const driver = p.equityCap <= ceiling ? 'your risk profile' : 'your time horizon';
    return {
      equity, debt, gold, profile, yearsToGoal,
      reasoning: [
        `Equity is capped at ${(equity * 100).toFixed(0)}% — the lower of what ${driver} allows (never 100%).`,
        `A debt floor keeps at least ${(debt * 100).toFixed(0)}% in steadier assets to cushion crashes.`,
        `A ${(gold * 100).toFixed(0)}% gold sliver adds diversification against equity & rupee shocks.`,
      ],
    };
  }

  /** Current equity fraction of a portfolio (Hybrid counted part-equity). */
  function currentEquity(summary) {
    const a = summary.allocation || {};
    return (a.Equity || 0) + ASSUME.HYBRID_EQUITY * (a.Hybrid || 0);
  }

  /** A complete, safe allocation plan: emergency-fund status FIRST, then the
   *  suitability-capped target vs the current mix, then the move to make —
   *  but only AFTER the emergency fund is in place. */
  function allocationPlan(portfolio, { profile = 'Moderate', yearsToGoal = 10, monthlyExpense = 50000, liquidSavings = 0 } = {}) {
    const summary = ORACLE.portfolioSummary(portfolio.holdings);
    const a = summary.allocation || {};
    const debtValue = (a.Debt || 0) * summary.current; // debt sleeve doubles as liquid-ish buffer
    const liquid = debtValue + (liquidSavings || 0);
    const ef = emergencyFund({ monthlyExpense, liquidAssets: liquid });
    const target = recommendedAllocation({ profile, yearsToGoal });
    const curEq = currentEquity(summary);
    const drift = curEq - target.equity; // +ve => too much equity
    const move = Math.abs(drift) * summary.current;
    return {
      summary, emergency: ef, target, currentEquity: curEq, targetEquity: target.equity,
      drift, moveRupees: Math.abs(drift) < 0.03 ? 0 : move,
      direction: Math.abs(drift) < 0.03 ? 'on-track' : (drift > 0 ? 'trim-equity' : 'add-equity'),
      // The headline action is ALWAYS the emergency fund if it isn't funded.
      firstAction: !ef.ok ? 'build-emergency' : (Math.abs(drift) < 0.03 ? 'hold' : (drift > 0 ? 'trim-equity' : 'add-equity')),
    };
  }

  /* ---- multi-factor fund quality score (0..100) with a transparent breakdown ---- */
  const SCORE_WEIGHTS = Object.freeze({ returns: 0.25, riskAdj: 0.25, downside: 0.20, consistency: 0.15, cost: 0.10, alpha: 0.05 });

  /** Score one diagnosed fund (dx.funds[i]) across six professional factors.
   *  Each sub-score is 0..100; missing data is scored neutrally (50). */
  function fundScore(fund) {
    const r = fund.risk, roll = fund.rolling;
    const ret3 = roll && roll['3y'] && isFinite(roll['3y'].avg) ? roll['3y'].avg : (r ? r.annReturn : NaN);
    const sub = {
      returns: isFinite(ret3) ? 100 * lin(ret3, 0.0, 0.18) : 50,                       // 0%→0, 18%→100
      riskAdj: r && isFinite(r.sharpe) ? 100 * lin((r.sharpe + (isFinite(r.sortino) ? r.sortino : r.sharpe)) / 2, 0, 2.0) : 50,
      downside: r ? 100 * (0.5 * (1 - lin(Math.abs(r.maxDrawdown), 0.15, 0.6)) + 0.5 * (1 - lin(isFinite(r.downsideCapture) ? r.downsideCapture : 1, 0.6, 1.2))) : 50,
      consistency: roll && roll['3y'] && isFinite(roll['3y'].consistency) ? 100 * roll['3y'].consistency : 50,
      cost: isFinite(fund.ter) ? 100 * (1 - lin(fund.ter, 0.004, 0.020)) : 60,         // 0.4%→100, 2%→0
      alpha: r && isFinite(r.alpha) ? 100 * lin(r.alpha, -0.04, 0.06) : 50,
    };
    let score = 0; for (const k in SCORE_WEIGHTS) score += SCORE_WEIGHTS[k] * sub[k];
    score = Math.round(score);
    const grade = score >= 75 ? 'Excellent' : score >= 60 ? 'Good' : score >= 45 ? 'Average' : 'Weak';
    const cautions = [];
    if (r && Math.abs(r.maxDrawdown) > 0.45) cautions.push('has fallen sharply in past crashes');
    if (r && isFinite(r.downsideCapture) && r.downsideCapture > 1) cautions.push('takes more than the full market fall');
    if (isFinite(fund.ter) && fund.ter > 0.015) cautions.push('carries a high expense ratio');
    if (r && isFinite(r.alpha) && r.alpha < -0.01) cautions.push('lags its benchmark after risk');
    return { score, grade, breakdown: sub, weights: SCORE_WEIGHTS, cautions };
  }

  return {
    ASSUME, PROFILES, clamp,
    horizonEquityCeiling, emergencyFund, recommendedAllocation, currentEquity, allocationPlan,
    SCORE_WEIGHTS, fundScore,
  };
});
