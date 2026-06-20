/* =====================================================================
 * The Autonomous Portfolio Oracle — Part 3: User Autonomy & Execution
 * ---------------------------------------------------------------------
 * The layer that turns diagnosis + prognosis into a single number and a list
 * of buttons. It computes:
 *   • the Unified Portfolio Health Score (0–10) across four pillars, and
 *   • the live Action Board — every flagged issue paired with plain-language
 *     advice and one autonomous decision button.
 *
 * Pure, deterministic, Node-exported. Consumes ORACLE.diagnose (Part 1) and
 * FUTURE.prognose (Part 2); it derives nothing they already compute. The CAS-
 * PDF import that the spec puts at "Step 1" of this workflow plugs into the
 * same portfolio data model the manual form already fills — no engine change.
 * ===================================================================== */
'use strict';

(function (root, factory) {
  const ORACLE = (typeof require !== 'undefined') ? require('./oracle.js') : root.ORACLE;
  const FUTURE = (typeof require !== 'undefined') ? require('./oracle-future.js') : root.FUTURE;
  const WORKFLOW = factory(ORACLE, FUTURE);
  if (typeof module !== 'undefined' && module.exports) module.exports = WORKFLOW;
  if (typeof window !== 'undefined') window.WORKFLOW = WORKFLOW;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ORACLE, FUTURE) {

  const clamp = (v, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, v));

  /* =====================================================================
   * Unified Portfolio Health Score (0–10), four pillars from the spec:
   *   Performance · Cost · Diversification · Alignment
   * ===================================================================== */
  function healthScore(dx, pr) {
    const total = dx.summary.current || 1;

    // Performance — drag down by the value share sitting in deadwood funds.
    const deadwoodShare = dx.funds.filter((f) => f.deadwood).reduce((s, f) => s + f.current, 0) / total;
    const performance = clamp(10 - 30 * deadwoodShare);

    // Cost — drag down by how much of the book is in commission-bearing
    // Regular plans (the engine of hidden leakage).
    const regularShare = dx.summary.planSplit.Regular || 0;
    const cost = clamp(10 - 12 * regularShare);

    // Diversification — penalise red-flag overlaps and asset-class concentration.
    const flagged = dx.overlaps.filter((o) => o.flagged).length;
    const maxClassShare = Math.max(0, ...Object.values(dx.summary.allocation));
    const diversification = clamp(10 - 3 * flagged - Math.max(0, maxClassShare - 0.7) * 10);

    // Alignment — will today's plan actually reach the future FFN corpus?
    const alignment = clamp(10 * (isFinite(pr.ffn.alignmentRatio) ? pr.ffn.alignmentRatio : 1));

    const weights = { performance: 0.30, cost: 0.20, diversification: 0.20, alignment: 0.30 };
    const overall =
      performance * weights.performance + cost * weights.cost +
      diversification * weights.diversification + alignment * weights.alignment;

    let grade;
    if (overall >= 8) grade = 'Excellent';
    else if (overall >= 6) grade = 'Healthy';
    else if (overall >= 4) grade = 'Needs work';
    else grade = 'At risk';

    return {
      overall: Math.round(overall * 10) / 10,
      grade,
      pillars: {
        performance: round1(performance),
        cost: round1(cost),
        diversification: round1(diversification),
        alignment: round1(alignment),
      },
      weights,
      detail: { deadwoodShare, regularShare, flaggedOverlaps: flagged, maxClassShare, alignmentRatio: pr.ffn.alignmentRatio },
    };
  }
  const round1 = (v) => Math.round(v * 10) / 10;

  /* =====================================================================
   * Live Action Board — issues paired with advice and a decision button.
   * Severity: 'critical' | 'warn' | 'opportunity' | 'good'.
   * ===================================================================== */
  function actionBoard(dx, pr) {
    const items = [];

    // Deadwood funds -> switch out.
    for (const f of dx.funds) {
      if (f.deadwood) {
        items.push({
          severity: 'critical',
          issue: `Underperforming '${f.scheme}'`,
          advice: `It has lagged its benchmark on a risk-adjusted basis (alpha ${(f.risk.alpha * 100).toFixed(1)}%) while taking full market risk (beta ${f.risk.beta.toFixed(2)}). Exit it.`,
          button: f.plan === 'Regular' ? 'Switch to a Direct peer' : 'Replace this fund',
        });
      }
    }

    // Red-flag overlaps -> trim the duplicate.
    for (const o of dx.overlaps) {
      if (o.flagged) {
        items.push({
          severity: 'warn',
          issue: `Excess overlap (${(o.overlap * 100).toFixed(0)}%)`,
          advice: `'${o.a}' and '${o.b}' share ${(o.overlap * 100).toFixed(0)}% of their stocks — you're paying two fees for one bet. Keep the cheaper/better one.`,
          button: 'Consolidate duplicates',
        });
      }
    }

    // Cost leakage -> move Regular to Direct.
    if (dx.leakage.regularValueToday > 0 && dx.leakage.leakageRupees > 0) {
      items.push({
        severity: 'warn',
        issue: 'Hidden cost leakage (Regular plans)',
        advice: `Your Regular-plan holdings will leak ~${inr(dx.leakage.leakageRupees)} (${(dx.leakage.leakagePctOfDirect * 100).toFixed(1)}% of the corpus) to commissions over 15 years. Switch them to Direct.`,
        button: 'Switch to Direct',
      });
    }

    // Glide-path drift -> rebalance.
    if (pr.glide.direction === 'equity->debt' && pr.glide.rupeesToShift > 0) {
      items.push({
        severity: 'warn',
        issue: `Equity allocation drift (${(pr.glide.currentEquity * 100).toFixed(0)}%)`,
        advice: `With ${pr.glide.yearsToGoal} years to your goal the glide-path target is ${(pr.glide.targetEquity * 100).toFixed(0)}% equity. Move ${inr(pr.glide.rupeesToShift)} from equity into safer debt.`,
        button: 'Rebalance portfolio',
      });
    } else if (pr.glide.direction === 'debt->equity' && pr.glide.rupeesToShift > 0) {
      items.push({
        severity: 'opportunity',
        issue: `Under-allocated to growth (${(pr.glide.currentEquity * 100).toFixed(0)}% equity)`,
        advice: `You're ${pr.glide.yearsToGoal} years out — the glide-path supports ${(pr.glide.targetEquity * 100).toFixed(0)}% equity. Consider moving ${inr(pr.glide.rupeesToShift)} from debt into equity for growth.`,
        button: 'Add to equity',
      });
    }

    // Valuation signal.
    if (pr.valuation.action === 'equity->debt') {
      items.push({
        severity: 'warn',
        issue: `Market overvalued (Nifty PE ${pr.valuation.pe.toFixed(1)})`,
        advice: `${pr.valuation.rationale} That's about ${inr(pr.valuation.moveRupees)} of profit to book into safe debt.`,
        button: 'Book profit',
      });
    } else if (pr.valuation.action === 'debt->equity') {
      items.push({
        severity: 'opportunity',
        issue: `Market undervalued (Nifty PE ${pr.valuation.pe.toFixed(1)})`,
        advice: `${pr.valuation.rationale} About ${inr(pr.valuation.moveRupees)} from your debt buffer.`,
        button: 'Deploy buffer',
      });
    }

    // LTCG harvesting opportunity (tax-free up to ₹1.25 L of long-term gains).
    const harvestable = Math.min(dx.spendable.ltcgGain, ORACLE.TAX.LTCG_EXEMPTION);
    if (harvestable > 1000) {
      items.push({
        severity: 'opportunity',
        issue: 'Tax optimisation (LTCG harvesting)',
        advice: `You can realise about ${inr(harvestable)} of long-term gains completely tax-free this year (within the ₹1.25 L exemption) and reset your cost base.`,
        button: 'Harvest tax now',
      });
    }

    // FFN shortfall -> increase SIP.
    if (!pr.ffn.onTrack && pr.ffn.sipTopUp > 0) {
      items.push({
        severity: 'critical',
        issue: 'Off track for financial freedom',
        advice: `At today's SIP you'll reach ${inr(pr.ffn.projectedCorpus)} of the ${inr(pr.ffn.requiredCorpus)} you need in ${pr.ffn.yearsToGoal} years. Increase your SIP by ${inr(pr.ffn.sipTopUp)}/month to close the gap.`,
        button: 'Increase SIP',
      });
    }

    if (!items.length) {
      items.push({ severity: 'good', issue: 'No urgent issues', advice: 'Your portfolio is low-cost, well-diversified, on its glide-path, and on track for the goal. Keep going.', button: 'Stay the course' });
    }

    const order = { critical: 0, warn: 1, opportunity: 2, good: 3 };
    items.sort((a, b) => order[a.severity] - order[b.severity]);
    return items;
  }

  function inr(v) {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' L';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }

  /** One call: full diagnosis + prognosis + score + action board. */
  function analyze(portfolio, futureInputs = {}) {
    const dx = ORACLE.diagnose(portfolio, { asOf: portfolio.asOf });
    const pr = FUTURE.prognose(portfolio, futureInputs);
    return { dx, pr, score: healthScore(dx, pr), actions: actionBoard(dx, pr) };
  }

  return { healthScore, actionBoard, analyze };
});
