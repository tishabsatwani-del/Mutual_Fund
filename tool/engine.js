/* The Portfolio Reality Check — calculation engine.
 *
 * Pure functions, no DOM, no network, no dependencies. Everything here is
 * covered by tools/tool-tests/engine.test.js, which checks the outputs against
 * independently derived values rather than against the engine itself.
 *
 * Conventions, stated once and applied everywhere:
 *   - A date is a UTC millisecond timestamp at midnight. No local timezones,
 *     so a user in any zone gets identical numbers.
 *   - XIRR uses the Excel convention: a 365-day year, day counts from the
 *     first cash flow.
 *   - Money the investor pays in is negative. Money they take out, and the
 *     value they still hold, is positive.
 */
(function (root) {
  'use strict';

  var MS_PER_DAY = 86400000;

  /* ---------------------------------------------------------------- dates */

  function utc(y, m, d) { return Date.UTC(y, m - 1, d); }

  function dayCount(from, to) { return Math.round((to - from) / MS_PER_DAY); }

  function parts(t) {
    var d = new Date(t);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  /* Add whole years, clamping 29 Feb to 28 Feb in a non-leap year. */
  function addYears(t, years) {
    var p = parts(t);
    var y = p.y + years;
    var dim = new Date(Date.UTC(y, p.m, 0)).getUTCDate();
    return utc(y, p.m, Math.min(p.d, dim));
  }

  function addMonths(t, months) {
    var p = parts(t);
    var total = (p.y * 12) + (p.m - 1) + months;
    var y = Math.floor(total / 12);
    var m = (total % 12) + 1;
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return utc(y, m, Math.min(p.d, dim));
  }

  function isValidDate(t) { return typeof t === 'number' && isFinite(t) && !isNaN(t); }

  /* ----------------------------------------------------------------- XIRR */

  /* Net present value of dated cash flows at an annual rate. */
  function xnpv(rate, flows) {
    var t0 = flows[0].t, sum = 0;
    for (var i = 0; i < flows.length; i++) {
      sum += flows[i].amount / Math.pow(1 + rate, dayCount(t0, flows[i].t) / 365);
    }
    return sum;
  }

  /* Money-weighted annualised return.
   *
   * Returns {ok:true, rate} or {ok:false, code, message} -- never a bare NaN,
   * because a number nobody can explain is worse than no number at all.
   *
   * Bisection rather than Newton alone: Newton diverges on the deeply negative
   * cases, which is exactly when a worried investor is looking at the screen.
   */
  function xirr(rawFlows) {
    var flows = (rawFlows || [])
      .filter(function (f) { return f && isValidDate(f.t) && isFinite(f.amount) && f.amount !== 0; })
      .slice()
      .sort(function (a, b) { return a.t - b.t; });

    if (flows.length < 2) {
      return fail('TOO_FEW', 'Add at least two entries: money going in, and what it is worth now.');
    }
    var hasneg = false, haspos = false;
    for (var i = 0; i < flows.length; i++) {
      if (flows[i].amount < 0) hasneg = true;
      if (flows[i].amount > 0) haspos = true;
    }
    if (!hasneg) return fail('NO_INVESTMENT', 'Add at least one investment.');
    if (!haspos) {
      return fail('NO_VALUE', 'Add what the holding is worth now, or a withdrawal.');
    }
    if (flows[0].t === flows[flows.length - 1].t) {
      return fail('SAME_DAY', 'All the entries are on the same date, so there is no period to annualise over.');
    }

    var lo = -0.9999999, hi = 100;
    var flo = xnpv(lo, flows), fhi = xnpv(hi, flows);
    if (!isFinite(flo) || !isFinite(fhi)) {
      return fail('UNSOLVABLE', 'These entries do not produce a rate that can be calculated.');
    }
    if (flo * fhi > 0) {
      return fail('UNSOLVABLE', 'These entries do not produce a rate that can be calculated. This usually means the pattern of money in and out has no single sensible answer.');
    }
    for (var k = 0; k < 300; k++) {
      var mid = (lo + hi) / 2;
      var fm = xnpv(mid, flows);
      if (flo * fm <= 0) { hi = mid; } else { lo = mid; flo = fm; }
    }
    var rate = (lo + hi) / 2;
    if (!isFinite(rate)) return fail('UNSOLVABLE', 'These entries do not produce a rate that can be calculated.');
    return { ok: true, rate: rate };
  }

  function fail(code, message) { return { ok: false, code: code, message: message }; }

  /* ------------------------------------------------- other return measures */

  /* Annualised growth between two values. Not the same thing as XIRR: this
   * ignores everything that happened in between. */
  function cagr(startValue, endValue, startT, endT) {
    if (!(startValue > 0) || !(endValue > 0)) {
      return fail('NON_POSITIVE', 'Both values must be greater than zero.');
    }
    var days = dayCount(startT, endT);
    if (days <= 0) return fail('BAD_PERIOD', 'The end date must be after the start date.');
    return { ok: true, rate: Math.pow(endValue / startValue, 365 / days) - 1, days: days };
  }

  /* Total gain or loss, not annualised. */
  function absoluteReturn(invested, currentValue) {
    if (!(invested > 0)) return fail('NON_POSITIVE', 'The amount invested must be greater than zero.');
    return { ok: true, rate: (currentValue - invested) / invested };
  }

  /* -------------------------------------------------------- rolling returns
   *
   * Methodology, so the number can be defended:
   *   - One rolling window starts at every observation in the series.
   *   - The window ends on the same calendar date N years later. If the market
   *     was shut that day, the most recent earlier observation is used, but
   *     only within `toleranceDays` (default 7). Beyond that the window is
   *     dropped rather than stretched, because stretching quietly changes the
   *     horizon being measured.
   *   - The return is annualised as (end/start)^(1/N) - 1. For N = 1 that is
   *     the same as the simple change, which is why a one-year window needs no
   *     special case.
   *   - Windows are never overlapped with themselves, deduplicated by date, or
   *     averaged from yearly figures. An arithmetic mean of yearly returns is a
   *     different statistic and is not reported here.
   */
  function rollingReturns(series, years, options) {
    var opts = options || {};
    var tol = opts.toleranceDays == null ? 7 : opts.toleranceDays;
    if (!(years > 0)) return fail('BAD_HORIZON', 'Choose a holding period of at least one year.');
    if (!series || series.length < 2) return fail('TOO_SHORT', 'This file does not hold enough history to measure.');

    var spanYears = (series[series.length - 1].t - series[0].t) / (365.25 * MS_PER_DAY);
    if (spanYears < years) {
      return fail('NOT_ENOUGH_HISTORY',
        'This data covers about ' + spanYears.toFixed(1) + ' years, which is not enough for a ' +
        years + '-year holding period. Choose a shorter period, or use a file with more history.');
    }

    var values = [];
    var j = 0;
    for (var i = 0; i < series.length; i++) {
      var target = addYears(series[i].t, years);
      if (target > series[series.length - 1].t) break;
      /* advance to the last observation on or before the target date */
      if (j < i) j = i;
      while (j + 1 < series.length && series[j + 1].t <= target) j++;
      var end = series[j];
      if (end.t <= series[i].t) continue;
      if (dayCount(end.t, target) > tol) continue;
      if (!(series[i].v > 0) || !(end.v > 0)) continue;
      values.push(Math.pow(end.v / series[i].v, 1 / years) - 1);
    }

    if (!values.length) {
      return fail('NO_WINDOWS', 'No complete ' + years + '-year periods could be measured from this data.');
    }
    return { ok: true, years: years, values: values, stats: describe(values), toleranceDays: tol };
  }

  function describe(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var sum = 0, pos = 0;
    for (var i = 0; i < n; i++) { sum += sorted[i]; if (sorted[i] > 0) pos++; }
    return {
      count: n,
      min: sorted[0],
      max: sorted[n - 1],
      mean: sum / n,
      median: median(sorted),
      p25: quantile(sorted, 0.25),
      p75: quantile(sorted, 0.75),
      positiveShare: pos / n,
      negativeShare: (n - pos) / n
    };
  }

  function median(sorted) {
    var n = sorted.length, mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /* Linear interpolation between order statistics, matching the common
   * spreadsheet definition of PERCENTILE. */
  function quantile(sorted, q) {
    var n = sorted.length;
    if (n === 1) return sorted[0];
    var pos = (n - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /* How many periods cleared a rate the reader picked.
   *
   * Deliberately takes the rate as an argument rather than naming any product.
   * "Beat an FD 90% of the time" is a claim about a dataset nobody defined --
   * the rate source, the period, the compounding and the tax treatment all
   * change the answer. A rate the reader types is a claim they can check. */
  function shareAbove(values, rate) {
    if (!values || !values.length || !isFinite(rate)) {
      return fail('NO_DATA', 'There are no periods to compare.');
    }
    var above = 0;
    for (var i = 0; i < values.length; i++) if (values[i] > rate) above++;
    return { ok: true, above: above, count: values.length, share: above / values.length };
  }

  /* Buckets for the distribution chart. Fixed edges so two funds, or a fund
   * and a benchmark, can be read side by side. */
  function histogram(values, edges) {
    /* Fixed edges so a fund and a benchmark can be read side by side, with
     * real resolution below zero -- a single "lost money" bar hides whether
     * that meant a scratch or a mauling. */
    var e = edges || [-Infinity, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20, 0.25, Infinity];
    var bins = [];
    for (var i = 0; i < e.length - 1; i++) bins.push({ from: e[i], to: e[i + 1], count: 0 });
    for (var k = 0; k < values.length; k++) {
      for (var b = 0; b < bins.length; b++) {
        if (values[k] >= bins[b].from && values[k] < bins[b].to) { bins[b].count++; break; }
      }
    }
    return bins;
  }

  /* ------------------------------------------------------------ goal maths
   *
   * The monthly rate is the twelfth root of the annual rate, not annual/12.
   * Dividing by twelve overstates the result, and over twenty years the
   * overstatement is not small.
   *
   * Contributions are treated as paid at the start of each month, which is how
   * a SIP mandate actually runs. A step-up is applied once every twelve months.
   */
  function monthlyRate(annualRate) { return Math.pow(1 + annualRate, 1 / 12) - 1; }

  function futureValueOfLumpSum(present, annualRate, years) {
    return present * Math.pow(1 + annualRate, years);
  }

  function futureValueOfSip(monthlyAmount, annualRate, years, annualStepUpRate) {
    var months = Math.round(years * 12);
    if (months <= 0 || !(monthlyAmount > 0)) return 0;
    var i = monthlyRate(annualRate);
    var step = annualStepUpRate || 0;
    var amount = monthlyAmount, total = 0;
    for (var m = 0; m < months; m++) {
      if (m > 0 && m % 12 === 0) amount = amount * (1 + step);
      total = (total + amount) * (1 + i);   /* paid at the start of the month */
    }
    return total;
  }

  /* What one rupee a month grows into. The future value of a SIP is linear in
   * the instalment, so the extra needed to close a gap is a division, not a
   * search. */
  function sipGrowthFactor(annualRate, years, annualStepUpRate) {
    return futureValueOfSip(1, annualRate, years, annualStepUpRate);
  }

  function projectGoal(input) {
    var currentValue = num(input.currentValue);
    var monthlySip = num(input.monthlySip);
    var years = num(input.years);
    var annualRate = num(input.annualRate);
    var stepUp = num(input.annualStepUpRate);
    var target = num(input.target);

    if (!(years > 0)) return fail('BAD_YEARS', 'Enter how many years are left, as a number greater than zero.');
    if (years > 60) return fail('BAD_YEARS', 'Enter a period of 60 years or less.');
    if (annualRate <= -1) return fail('BAD_RATE', 'Enter an assumed return greater than -100%.');
    if (annualRate > 0.5) return fail('BAD_RATE', 'Enter an assumed return of 50% a year or less. Higher assumptions do not make a plan, they hide one.');
    if (!(target > 0)) return fail('BAD_TARGET', 'Enter the amount you are aiming for.');

    var fromCorpus = futureValueOfLumpSum(currentValue, annualRate, years);
    var fromSip = futureValueOfSip(monthlySip, annualRate, years, stepUp);
    var projected = fromCorpus + fromSip;
    var gap = target - projected;
    /* A shortfall of a fraction of a rupee is arithmetic noise, not a shortfall.
     * Without this, a plan that lands exactly on its goal reports as short. */
    var meaningful = Math.max(1, Math.abs(target) * 1e-9);
    var short = gap > meaningful;
    var factor = sipGrowthFactor(annualRate, years, stepUp);
    var extraMonthly = short && factor > 0 ? gap / factor : 0;

    return {
      ok: true,
      projected: projected,
      fromCorpus: fromCorpus,
      fromSip: fromSip,
      target: target,
      gap: short ? gap : 0,
      onTrack: !short,
      extraMonthly: extraMonthly,
      totalContributed: contributions(monthlySip, years, stepUp),
      years: years,
      annualRate: annualRate
    };
  }

  function contributions(monthlyAmount, years, annualStepUpRate) {
    var months = Math.round(years * 12);
    if (months <= 0 || !(monthlyAmount > 0)) return 0;
    var amount = monthlyAmount, total = 0;
    for (var m = 0; m < months; m++) {
      if (m > 0 && m % 12 === 0) amount = amount * (1 + (annualStepUpRate || 0));
      total += amount;
    }
    return total;
  }

  function num(v) { var n = typeof v === 'string' ? parseFloat(v) : v; return isFinite(n) ? n : 0; }

  /* ----------------------------------------------------------------- export */

  var api = {
    MS_PER_DAY: MS_PER_DAY,
    utc: utc,
    dayCount: dayCount,
    addYears: addYears,
    addMonths: addMonths,
    xnpv: xnpv,
    xirr: xirr,
    cagr: cagr,
    absoluteReturn: absoluteReturn,
    rollingReturns: rollingReturns,
    describe: describe,
    quantile: quantile,
    histogram: histogram,
    shareAbove: shareAbove,
    monthlyRate: monthlyRate,
    futureValueOfLumpSum: futureValueOfLumpSum,
    futureValueOfSip: futureValueOfSip,
    sipGrowthFactor: sipGrowthFactor,
    projectGoal: projectGoal,
    contributions: contributions
  };

  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.PRCEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
