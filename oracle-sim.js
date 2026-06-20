/* =====================================================================
 * Autonomous Portfolio Oracle — Monte Carlo simulation engine
 * ---------------------------------------------------------------------
 * Deeper simulation for the "professional" build: project the portfolio
 * forward over thousands of random futures and report the distribution —
 * percentile bands over time, the final spread, and the probability of
 * reaching a target corpus (e.g. the FFN). Plus a custom what-if stress.
 *
 * Pure, deterministic (seeded), Node-exported. Parameters are estimated from
 * the holdings' own NAV histories when available, else from clearly-named
 * asset-class assumptions. Every figure is computed; nothing is asserted.
 * ===================================================================== */
'use strict';

(function (root, factory) {
  const ORACLE = (typeof require !== 'undefined') ? require('./oracle.js') : root.ORACLE;
  const SIM = factory(ORACLE);
  if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
  if (typeof window !== 'undefined') window.SIM = SIM;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ORACLE) {

  // Asset-class fallbacks when a holding has no NAV history to estimate from.
  const CLASS_PARAMS = {
    Equity: { mu: 0.12, sigma: 0.16 },
    Hybrid: { mu: 0.095, sigma: 0.09 },
    Debt: { mu: 0.066, sigma: 0.025 },
  };

  /** Estimate the portfolio's expected annual return & volatility. Prefers a
   *  value-weighted monthly return series built from the holdings' own
   *  histories; falls back to a value-weighted blend of asset-class params. */
  function estimatePortfolioParams(portfolio) {
    const holds = portfolio.holdings;
    const total = holds.reduce((s, h) => s + h.units * h.nav, 0) || 1;
    const withHist = holds.filter((h) => Array.isArray(h.navHistory) && h.navHistory.length > 12);

    if (withHist.length) {
      // Align on the shortest history; weight each fund's monthly returns by value.
      const len = Math.min(...withHist.map((h) => h.navHistory.length));
      const wTotal = withHist.reduce((s, h) => s + h.units * h.nav, 0) || 1;
      const series = [];
      for (let i = 1; i < len; i++) {
        let r = 0;
        for (const h of withHist) {
          const hr = h.navHistory[h.navHistory.length - len + i] / h.navHistory[h.navHistory.length - len + i - 1] - 1;
          r += (h.units * h.nav / wTotal) * hr;
        }
        series.push(r);
      }
      const mu = ORACLE.annualizedReturn(series, 12);
      const sigma = ORACLE.annualizedVol(series, 12);
      // Blend any no-history sleeve in by value weight, so debt cash etc. counts.
      const histShare = wTotal / total;
      let muRest = 0, sigRest = 0;
      for (const h of holds) {
        if (withHist.includes(h)) continue;
        const p = CLASS_PARAMS[h.assetClass] || CLASS_PARAMS.Equity;
        muRest += (h.units * h.nav / total) * p.mu; sigRest += (h.units * h.nav / total) * p.sigma;
      }
      return {
        annualReturn: histShare * mu + muRest,
        annualVol: histShare * sigma + sigRest,
        source: muRest > 0 ? 'history+assumption' : 'history',
      };
    }

    // No histories at all — value-weighted asset-class blend.
    let mu = 0, sigma = 0;
    for (const h of holds) {
      const p = CLASS_PARAMS[h.assetClass] || CLASS_PARAMS.Equity;
      mu += (h.units * h.nav / total) * p.mu; sigma += (h.units * h.nav / total) * p.sigma;
    }
    return { annualReturn: mu, annualVol: sigma, source: 'assumption' };
  }

  /* ---- seeded RNG (reuse the engine's) ---- */
  function rng(seed) { return ORACLE.mulberry32(seed >>> 0); }
  function gauss(rand) { return ORACLE.gaussian(rand); }

  const PCTS = [5, 10, 25, 50, 75, 90, 95];
  function percentile(sortedAsc, p) {
    if (!sortedAsc.length) return NaN;
    const idx = (p / 100) * (sortedAsc.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sortedAsc[lo];
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
  }

  /** Simulate `paths` monthly geometric random-walk futures of a corpus that
   *  also receives a start-of-month SIP. Returns yearly percentile bands, the
   *  final-value distribution percentiles, the probability of finishing at or
   *  above `target`, and a few sample paths for plotting.
   *
   *  A mild fat tail is added (a small chance each month of an extra adverse
   *  shock) so the downside isn't understated — calibrated, not cosmetic. */
  function monteCarlo({
    startValue, monthlySip = 0, years, annualReturn, annualVol,
    paths = 2000, seed = 12345, target = null, fatTail = true,
  }) {
    const n = Math.round(years * 12);
    const mr = Math.pow(1 + annualReturn, 1 / 12) - 1;
    const mv = annualVol / Math.sqrt(12);
    const rand = rng(seed);

    const yearlyBuckets = Array.from({ length: years + 1 }, () => []);
    const finals = [];
    const sampleN = Math.min(40, paths);
    const samples = [];

    for (let p = 0; p < paths; p++) {
      let v = startValue;
      const keepSample = p < sampleN;
      const path = keepSample ? [v] : null;
      yearlyBuckets[0].push(v);
      for (let m = 1; m <= n; m++) {
        let shock = mr + mv * gauss(rand);
        if (fatTail && rand() < 0.02) shock -= mv * (1.5 + rand() * 2); // occasional tail event
        v = (v + monthlySip) * (1 + shock);
        if (v < 0) v = 0;
        if (m % 12 === 0) {
          yearlyBuckets[m / 12].push(v);
          if (keepSample) path.push(v);
        }
      }
      finals.push(v);
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
    const invested = startValue + monthlySip * n;

    return {
      years, paths, annualReturn, annualVol,
      bands, finalPercentiles, samples,
      invested,
      median: finalPercentiles.p50,
      probReachTarget: target != null ? finals.filter((v) => v >= target).length / paths : null,
      probLoseMoney: finals.filter((v) => v < invested).length / paths,
      target,
    };
  }

  /** Convenience: run the Monte Carlo straight off a portfolio + inputs,
   *  estimating the parameters from the holdings. */
  function simulatePortfolio(portfolio, { years = 20, monthlySip = 0, target = null, paths = 2000, seed = 12345 } = {}) {
    const params = estimatePortfolioParams(portfolio);
    const startValue = portfolio.holdings.reduce((s, h) => s + h.units * h.nav, 0);
    const mc = monteCarlo({ startValue, monthlySip, years, annualReturn: params.annualReturn, annualVol: params.annualVol, paths, seed, target });
    return { ...mc, params, startValue };
  }

  return { CLASS_PARAMS, estimatePortfolioParams, percentile, monteCarlo, simulatePortfolio };
});
