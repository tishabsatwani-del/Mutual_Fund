/* Where You Stand: calculation engine.
 *
 * Pure functions, no DOM, no network, no dependencies. Every function here is
 * checked against an independent implementation (Python, written from the
 * definitions, not from this code) in ../tests/.
 *
 * Conventions, stated once and applied everywhere:
 *   - A date is a UTC millisecond timestamp at midnight, so a reader in any
 *     time zone gets identical numbers.
 *   - One year is 365 days, everywhere. That is the convention of Excel's XIRR
 *     and of the CAGR printed on fund factsheets, so the numbers here and the
 *     numbers a reader meets elsewhere are on the same footing.
 *   - Money the investor pays in is negative. Money they take out, and the
 *     value they still hold, is positive.
 */
(function (root) {
  'use strict';

  var MS_PER_DAY = 86400000;
  var DAY_BASIS = 365;

  /* ---------------------------------------------------------------- dates */

  function utc(y, m, d) { return Date.UTC(y, m - 1, d); }
  function dayCount(from, to) { return Math.round((to - from) / MS_PER_DAY); }
  function yearsBetween(from, to) { return dayCount(from, to) / DAY_BASIS; }
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
  function fail(code, message) { return { ok: false, code: code, message: message }; }

  /* The last observation on or before t, within `tol` days; null if none.
     Series are sorted ascending by t. Binary search. */
  function atOrBefore(series, t, tol) {
    var lo = 0, hi = series.length - 1, best = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (series[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best === -1) return null;
    if (tol != null && dayCount(series[best].t, t) > tol) return null;
    return series[best];
  }
  /* The first observation on or after t, within `tol` days; null if none. */
  function atOrAfter(series, t, tol) {
    var lo = 0, hi = series.length - 1, best = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (series[mid].t >= t) { best = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (best === -1) return null;
    if (tol != null && dayCount(t, series[best].t) > tol) return null;
    return series[best];
  }

  /* ----------------------------------------------------------------- XIRR */

  /* Net present value of dated cash flows at an annual rate, Excel's XNPV. */
  function xnpv(rate, flows) {
    var t0 = flows[0].t, sum = 0;
    for (var i = 0; i < flows.length; i++) {
      sum += flows[i].amount / Math.pow(1 + rate, dayCount(t0, flows[i].t) / DAY_BASIS);
    }
    return sum;
  }
  function dxnpv(rate, flows) {
    var t0 = flows[0].t, sum = 0;
    for (var i = 0; i < flows.length; i++) {
      var y = dayCount(t0, flows[i].t) / DAY_BASIS;
      sum += -y * flows[i].amount / Math.pow(1 + rate, y + 1);
    }
    return sum;
  }

  function cleanFlows(rawFlows) {
    return (rawFlows || [])
      .filter(function (f) { return f && isValidDate(f.t) && isFinite(f.amount) && f.amount !== 0; })
      .slice()
      .sort(function (a, b) { return a.t - b.t; });
  }

  /* Money-weighted annualised return.
   *
   * Returns {ok:true, rate, roots, alternatives, days} or {ok:false, code, message}.
   *
   * Two things a naive solver gets wrong, and this one does not:
   *   1. A rate can be enormous on a short hold (5% in two days is over 700,000%
   *      a year). The search runs up to 10^12 so the rate is found rather than
   *      refused; the screen decides how to present a rate on a short hold.
   *   2. Some patterns of money in and out have more than one rate that makes
   *      the flows balance. Every sign change on a fine grid is bisected, so
   *      every rate is found. The one reported is the one Excel reports, its
   *      Newton search from a 10% guess; the others are returned as
   *      `alternatives` so the screen can say a second rate also fits.
   */
  function xirr(rawFlows) {
    var flows = cleanFlows(rawFlows);
    if (flows.length < 2) {
      return fail('TOO_FEW', 'Add at least two entries: money going in, and what it is worth now.');
    }
    var hasneg = false, haspos = false;
    for (var i = 0; i < flows.length; i++) {
      if (flows[i].amount < 0) hasneg = true;
      if (flows[i].amount > 0) haspos = true;
    }
    if (!hasneg) return fail('NO_INVESTMENT', 'Add at least one investment.');
    if (!haspos) return fail('NO_VALUE', 'Add what the holding is worth now, or a withdrawal.');
    var days = dayCount(flows[0].t, flows[flows.length - 1].t);
    if (days === 0) {
      return fail('SAME_DAY', 'All the entries are on the same date, so there is no period to annualise over.');
    }

    var roots = allRoots(flows);
    if (!roots.length) {
      return fail('UNSOLVABLE', 'No single yearly rate makes these entries balance. This happens when ' +
        'money out and money in alternate in a way that no one rate can describe.');
    }
    var newtonRoot = newton(flows, 0.1);
    var rate = null;
    if (newtonRoot !== null) {
      /* snap to the bisected root it converged to */
      for (var r = 0; r < roots.length; r++) if (Math.abs(roots[r] - newtonRoot) < 1e-7 * (1 + Math.abs(newtonRoot))) rate = roots[r];
    }
    if (rate === null) {
      /* Newton wandered: take the root nearest the 10% guess, as a spreadsheet would settle on */
      rate = roots[0];
      for (var k = 1; k < roots.length; k++) if (Math.abs(roots[k] - 0.1) < Math.abs(rate - 0.1)) rate = roots[k];
    }
    var alternatives = roots.filter(function (x) { return x !== rate; });
    return { ok: true, rate: rate, roots: roots, alternatives: alternatives, days: days,
             underAYear: days < DAY_BASIS };
  }

  function newton(flows, guess) {
    var r = guess;
    for (var i = 0; i < 100; i++) {
      var f = xnpv(r, flows), df = dxnpv(r, flows);
      if (!isFinite(f) || !isFinite(df) || df === 0) return null;
      var r2 = r - f / df;
      if (!isFinite(r2)) return null;
      if (r2 <= -1) r2 = (r - 1) / 2;
      if (Math.abs(r2 - r) < 1e-12 * (1 + Math.abs(r))) return Math.abs(xnpv(r2, flows)) < 1e-6 * scale(flows) ? r2 : null;
      r = r2;
    }
    return null;
  }
  function scale(flows) {
    var s = 0;
    for (var i = 0; i < flows.length; i++) s += Math.abs(flows[i].amount);
    return s || 1;
  }

  /* Every rate in (-100%, 10^12] at which the flows balance. The grid is fine
     below zero, where two roots can sit close together, and logarithmic above. */
  function allRoots(flows) {
    var grid = [];
    var g;
    for (g = -0.9999; g < 0; g += 0.005) grid.push(g);
    grid.push(0);
    for (g = -3; g <= 12; g += 0.05) grid.push(Math.pow(10, g));
    var roots = [];
    var prev = grid[0], fprev = xnpv(prev, flows);
    for (var i = 1; i < grid.length; i++) {
      var x = grid[i], fx = xnpv(x, flows);
      if (!isFinite(fx)) break;
      if (fprev === 0) roots.push(prev);
      else if (fprev * fx < 0) roots.push(bisect(flows, prev, x, fprev));
      prev = x; fprev = fx;
    }
    /* dedupe */
    var out = [];
    roots.sort(function (a, b) { return a - b; });
    for (var k = 0; k < roots.length; k++) {
      if (!out.length || Math.abs(roots[k] - out[out.length - 1]) > 1e-9 * (1 + Math.abs(roots[k]))) out.push(roots[k]);
    }
    return out;
  }
  function bisect(flows, lo, hi, flo) {
    for (var k = 0; k < 200; k++) {
      var mid = (lo + hi) / 2;
      var fm = xnpv(mid, flows);
      if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
      if (hi - lo < 1e-13 * (1 + Math.abs(mid))) break;
    }
    return (lo + hi) / 2;
  }

  /* ------------------------------------------------- other return measures */

  /* Annualised growth between two values on a 365-day year. Not XIRR: this
   * ignores everything that happened in between. */
  function cagr(startValue, endValue, startT, endT) {
    if (!(startValue > 0) || !(endValue > 0)) return fail('NON_POSITIVE', 'Both values must be greater than zero.');
    var days = dayCount(startT, endT);
    if (days <= 0) return fail('BAD_PERIOD', 'The end date must be after the start date.');
    return { ok: true, rate: Math.pow(endValue / startValue, DAY_BASIS / days) - 1, days: days,
             total: endValue / startValue - 1 };
  }
  function absoluteReturn(invested, currentValue) {
    if (!(invested > 0)) return fail('NON_POSITIVE', 'The amount invested must be greater than zero.');
    return { ok: true, rate: (currentValue - invested) / invested };
  }
  /* How long money takes to double at a yearly rate. */
  function doublingTime(rate) {
    if (!(rate > 0)) return null;
    return Math.LN2 / Math.log(1 + rate);
  }

  /* -------------------------------------------------------- rolling returns
   *
   *   - One rolling window starts at every observation in the series (or every
   *     week or month, when thinned).
   *   - The window ends on the same calendar date N years later. If the market
   *     was shut that day the most recent earlier observation is used, but only
   *     within `toleranceDays` (default 7). Beyond that the window is dropped,
   *     never stretched.
   *   - The return is annualised over the days that actually elapsed on a
   *     365-day year: (end/start)^(365/days) - 1.
   */
  var FREQUENCY = {
    daily:   { label: 'Daily', step: null },
    weekly:  { label: 'Weekly', days: 7 },
    monthly: { label: 'Monthly', months: 1 }
  };

  function measureWindows(series, years, tol, freq) {
    var pairs = [];
    var j = 0;
    var nextStart = null;
    for (var i = 0; i < series.length; i++) {
      if (nextStart != null && series[i].t < nextStart) continue;
      var target = addYears(series[i].t, years);
      if (target > series[series.length - 1].t) break;
      if (j < i) j = i;
      while (j + 1 < series.length && series[j + 1].t <= target) j++;
      var end = series[j];
      if (end.t <= series[i].t) continue;
      if (dayCount(end.t, target) > tol) continue;
      if (!(series[i].v > 0) || !(end.v > 0)) continue;
      var days = dayCount(series[i].t, end.t);
      pairs.push({ t: series[i].t, endT: end.t, days: days, r: Math.pow(end.v / series[i].v, DAY_BASIS / days) - 1 });
      if (freq === 'weekly') nextStart = series[i].t + FREQUENCY.weekly.days * MS_PER_DAY;
      else if (freq === 'monthly') nextStart = addMonths(series[i].t, FREQUENCY.monthly.months);
    }
    return pairs;
  }

  function spanYearsOf(series) { return (series[series.length - 1].t - series[0].t) / (365.2425 * MS_PER_DAY); }

  function rollingReturns(series, years, options) {
    var opts = options || {};
    var tol = opts.toleranceDays == null ? 7 : opts.toleranceDays;
    var freq = FREQUENCY[opts.frequency] ? opts.frequency : 'daily';
    if (!(years > 0)) return fail('BAD_HORIZON', 'Choose a holding period of at least one year.');
    if (!series || series.length < 2) return fail('TOO_SHORT', 'This file does not hold enough history to measure.');
    var spanYears = spanYearsOf(series);
    if (spanYears < years) {
      return fail('NOT_ENOUGH_HISTORY',
        'This data covers about ' + spanYears.toFixed(1) + ' years, which is not enough for a ' +
        years + '-year holding period. Choose a shorter period, or use a file with more history.');
    }
    var pairs = measureWindows(series, years, tol, freq);
    if (!pairs.length) return fail('NO_WINDOWS', 'No complete ' + years + '-year periods could be measured from this data.');
    var values = pairs.map(function (p) { return p.r; });
    var best = pairs[0], worst = pairs[0];
    for (var k = 1; k < pairs.length; k++) {
      if (pairs[k].r > best.r) best = pairs[k];
      if (pairs[k].r < worst.r) worst = pairs[k];
    }
    return { ok: true, years: years, values: values, pairs: pairs, stats: describe(values),
             toleranceDays: tol, frequency: freq, dayBasis: DAY_BASIS, best: best, worst: worst,
             independent: Math.floor(spanYears / years), spanYears: spanYears };
  }

  /* ------------------------------------------ the spread of the daily moves */
  function annualisedVolatility(series) {
    if (!series || series.length < 3) return fail('TOO_SHORT', 'Too few observations to measure volatility.');
    var spanYears = spanYearsOf(series);
    if (!(spanYears > 0)) return fail('TOO_SHORT', 'Too few observations to measure volatility.');
    var rets = [];
    for (var i = 1; i < series.length; i++) {
      if (series[i].v > 0 && series[i - 1].v > 0) rets.push(Math.log(series[i].v / series[i - 1].v));
    }
    if (rets.length < 2) return fail('TOO_SHORT', 'Too few observations to measure volatility.');
    var mean = 0;
    for (var a = 0; a < rets.length; a++) mean += rets[a];
    mean /= rets.length;
    var acc = 0;
    for (var b = 0; b < rets.length; b++) { var d = rets[b] - mean; acc += d * d; }
    var perYear = rets.length / spanYears;
    var sigma = Math.sqrt(acc / (rets.length - 1)) * Math.sqrt(perYear);
    return { ok: true, sigma: sigma, observationsPerYear: perYear, observations: rets.length };
  }

  /* --------------------------------------- two series on one calendar
   * A strict inner join on the calendar date, with the last available value
   * carried forward where one file has a date the other lacks; never backwards,
   * so no value is invented before a file begins. */
  function alignCalendar(a, b) {
    if (!a || a.length < 2 || !b || b.length < 2) return fail('TOO_SHORT', 'Both series need at least two observations to be aligned.');
    var from = Math.max(a[0].t, b[0].t), to = Math.min(a[a.length - 1].t, b[b.length - 1].t);
    if (to <= from) return fail('NO_OVERLAP', 'The two series share no dates.');
    var seen = {}, dates = [];
    function collect(s) {
      for (var i = 0; i < s.length; i++) {
        var t = s[i].t;
        if (t < from || t > to || seen[t]) continue;
        seen[t] = true; dates.push(t);
      }
    }
    collect(a); collect(b);
    dates.sort(function (x, y) { return x - y; });
    function fill(s) {
      var out = [], j = 0, filled = 0, last = null;
      while (j < s.length && s[j].t <= from) { last = s[j]; j++; }
      for (var k = 0; k < dates.length; k++) {
        var t = dates[k];
        while (j < s.length && s[j].t <= t) { last = s[j]; j++; }
        if (!last) continue;
        if (last.t === t) out.push({ t: t, v: last.v });
        else { out.push({ t: t, v: last.v, carried: true }); filled++; }
      }
      return { series: out, filled: filled };
    }
    var fa = fill(a), fb = fill(b);
    return { ok: true, a: fa.series, b: fb.series, filledA: fa.filled, filledB: fb.filled, from: from, to: to, dates: dates.length };
  }

  /* Only the dates BOTH series actually have; no filling. For return-based
     comparisons, where a carried value would create a fake zero-return day. */
  function sharedDates(a, b) {
    var map = {}, outA = [], outB = [];
    for (var i = 0; i < b.length; i++) map[b[i].t] = b[i].v;
    for (var k = 0; k < a.length; k++) {
      if (map[a[k].t] != null && a[k].v > 0 && map[a[k].t] > 0) {
        outA.push({ t: a[k].t, v: a[k].v }); outB.push({ t: a[k].t, v: map[a[k].t] });
      }
    }
    return { a: outA, b: outB };
  }

  function rangeOverlap(a, b) {
    if (!a || a.length < 1 || !b || b.length < 1) return { ok: false, code: 'EMPTY' };
    var aFrom = a[0].t, aTo = a[a.length - 1].t, bFrom = b[0].t, bTo = b[b.length - 1].t;
    var from = Math.max(aFrom, bFrom), to = Math.min(aTo, bTo);
    if (to <= from) return { ok: false, code: 'NO_OVERLAP', aFrom: aFrom, aTo: aTo, bFrom: bFrom, bTo: bTo };
    return { ok: true, aFrom: aFrom, aTo: aTo, bFrom: bFrom, bTo: bTo, from: from, to: to,
             full: aFrom === bFrom && aTo === bTo, years: (to - from) / (365.2425 * MS_PER_DAY),
             lostA: ((from - aFrom) + (aTo - to)) / (365.2425 * MS_PER_DAY),
             lostB: ((from - bFrom) + (bTo - to)) / (365.2425 * MS_PER_DAY) };
  }

  function medianGapDays(series) {
    if (!series || series.length < 2) return null;
    var gaps = [];
    for (var i = 1; i < series.length; i++) gaps.push((series[i].t - series[i - 1].t) / MS_PER_DAY);
    gaps.sort(function (a, b) { return a - b; });
    var n = gaps.length;
    return n % 2 ? gaps[(n - 1) / 2] : (gaps[n / 2 - 1] + gaps[n / 2]) / 2;
  }
  function maxHorizon(series) {
    if (!series || series.length < 2) return null;
    var whole = Math.floor(spanYearsOf(series));
    return whole >= 1 ? whole : null;
  }

  /* ----------------------------------------------------------- statistics */
  function describe(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var sum = 0, pos = 0, neg = 0;
    for (var i = 0; i < n; i++) { sum += sorted[i]; if (sorted[i] > 0) pos++; if (sorted[i] < 0) neg++; }
    return {
      count: n, min: sorted[0], max: sorted[n - 1], mean: sum / n, median: median(sorted),
      p10: quantile(sorted, 0.10), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.90),
      positiveShare: pos / n, negativeShare: neg / n, below: neg, above: pos,
      stdev: stdevOf(sorted, sum / n)
    };
  }
  function stdevOf(values, mean) {
    var n = values.length;
    if (n < 2) return null;
    var acc = 0;
    for (var i = 0; i < n; i++) { var d = values[i] - mean; acc += d * d; }
    return Math.sqrt(acc / (n - 1));
  }
  function meanOf(values) { var s = 0; for (var i = 0; i < values.length; i++) s += values[i]; return values.length ? s / values.length : NaN; }
  function median(sorted) {
    var n = sorted.length, mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  /* Linear interpolation between order statistics: the spreadsheet PERCENTILE. */
  function quantile(sorted, q) {
    var n = sorted.length;
    if (n === 1) return sorted[0];
    var pos = (n - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function shareAbove(values, rate) {
    if (!values || !values.length || !isFinite(rate)) return fail('NO_DATA', 'There are no periods to compare.');
    var above = 0;
    for (var i = 0; i < values.length; i++) if (values[i] > rate) above++;
    return { ok: true, above: above, count: values.length, share: above / values.length };
  }
  function correlation(xs, ys) {
    var n = Math.min(xs.length, ys.length);
    if (n < 3) return null;
    var mx = 0, my = 0;
    for (var i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var sxy = 0, sxx = 0, syy = 0;
    for (var k = 0; k < n; k++) { var dx = xs[k] - mx, dy = ys[k] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  }

  /* Buckets for the distribution chart, fitted to the data.
   * Zero is always an edge when the values straddle it, so "lost money" is a
   * bar boundary and never a shade inside a bar. Edges are round numbers. */
  var NICE_STEPS = [0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
  function histogram(values, opts) {
    var o = opts || {};
    var e = o.edges;
    if (!e) {
      var lo = Infinity, hi = -Infinity;
      for (var i = 0; i < values.length; i++) { if (values[i] < lo) lo = values[i]; if (values[i] > hi) hi = values[i]; }
      if (!isFinite(lo)) return [];
      var target = o.bins || 8;
      var span = Math.max(hi - lo, 1e-9);
      var step = NICE_STEPS[NICE_STEPS.length - 1];
      for (var s = 0; s < NICE_STEPS.length; s++) { if (span / NICE_STEPS[s] <= target) { step = NICE_STEPS[s]; break; } }
      var first = Math.floor(lo / step) * step, last = Math.ceil(hi / step) * step;
      if (last <= first) last = first + step;
      e = [];
      for (var x = first; x <= last + step / 2; x += step) e.push(Math.round(x / step) * step);
      /* the top bin is closed on the right so the maximum value lands inside it */
    }
    var bins = [];
    for (var b = 0; b < e.length - 1; b++) bins.push({ from: e[b], to: e[b + 1], count: 0 });
    for (var k = 0; k < values.length; k++) {
      for (var q = 0; q < bins.length; q++) {
        var lastBin = q === bins.length - 1;
        if (values[k] >= bins[q].from && (values[k] < bins[q].to || (lastBin && values[k] <= bins[q].to))) { bins[q].count++; break; }
      }
    }
    return bins;
  }

  /* ------------------------------------------------------------- drawdown */
  function maxDrawdown(series) {
    if (!series || series.length < 2) return fail('TOO_SHORT', 'There is not enough history to measure a fall.');
    var peak = series[0], worst = 0, from = null, to = null, recovered = null;
    for (var i = 1; i < series.length; i++) {
      if (series[i].v >= peak.v) { peak = series[i]; continue; }
      var fall = series[i].v / peak.v - 1;
      if (fall < worst) { worst = fall; from = peak; to = series[i]; recovered = null; }
    }
    if (!to) return { ok: true, depth: 0, from: null, to: null, recoveredOn: null, recoveryDays: null, fallDays: null };
    for (var j = 0; j < series.length; j++) {
      if (series[j].t > to.t && series[j].v >= from.v) { recovered = series[j]; break; }
    }
    return { ok: true, depth: worst, from: from, to: to, fallDays: dayCount(from.t, to.t),
             recoveredOn: recovered ? recovered.t : null, recoveryDays: recovered ? dayCount(to.t, recovered.t) : null };
  }

  /* The longest stretch the value spent below a previous high, which can be
     longer than the deepest fall's own recovery. `ongoing` when the file ends
     while still below the high. */
  function longestUnderwater(series) {
    if (!series || series.length < 2) return fail('TOO_SHORT', 'There is not enough history to measure.');
    var peakT = series[0].t, peakV = series[0].v, best = { days: 0, from: null, to: null, ongoing: false };
    for (var i = 1; i < series.length; i++) {
      if (series[i].v >= peakV) {
        var days = dayCount(peakT, series[i].t);
        if (days > best.days) best = { days: days, from: peakT, to: series[i].t, ongoing: false };
        peakT = series[i].t; peakV = series[i].v;
      }
    }
    var tail = dayCount(peakT, series[series.length - 1].t);
    if (tail > best.days) best = { days: tail, from: peakT, to: series[series.length - 1].t, ongoing: true };
    best.ok = true;
    return best;
  }

  /* ------------------------------------------------ fund against benchmark
   * Every window both series can cover, on one calendar, paired by start date. */
  function compareRolling(fundSeries, benchSeries, years, options) {
    var opts = options || {};
    var al = alignCalendar(fundSeries, benchSeries);
    if (!al.ok) return al;
    var lo = al.from, hi = al.to;
    if (addYears(lo, years) > hi) {
      return fail('NO_OVERLAP', 'The two sets of data do not overlap by ' + years + ' years, so no fair comparison can be made.');
    }
    var tol = opts.toleranceDays == null ? 7 : opts.toleranceDays;
    var freq = FREQUENCY[opts.frequency] ? opts.frequency : 'daily';
    var fp = measureWindows(al.a, years, tol, freq), bp = measureWindows(al.b, years, tol, freq);
    if (!fp.length || !bp.length) return fail('NO_PAIRS', 'No period could be measured on both sets of data.');
    var byDate = {};
    fp.forEach(function (p) { byDate[p.t] = p; });
    var pairs = [];
    bp.forEach(function (p) { if (byDate[p.t]) pairs.push({ t: p.t, endT: p.endT, fund: byDate[p.t].r, bench: p.r }); });
    if (!pairs.length) return fail('NO_PAIRS', 'No period could be measured on both sets of data.');
    var ahead = 0;
    for (var i = 0; i < pairs.length; i++) if (pairs[i].fund > pairs[i].bench) ahead++;
    var fv = pairs.map(function (p) { return p.fund; }), bv = pairs.map(function (p) { return p.bench; });
    return { ok: true, years: years, pairs: pairs.length, fundAhead: ahead, fundAheadShare: ahead / pairs.length,
             fund: describe(fv), bench: describe(bv), fundValues: fv, benchValues: bv, matched: pairs,
             from: lo, to: hi, filledFund: al.filledA, filledBench: al.filledB,
             independent: Math.floor(((hi - lo) / (365.2425 * MS_PER_DAY)) / years) };
  }

  /* ------------------------------------------------------ periodic returns */

  /* Month-end observations: the last value in each calendar month. */
  function monthEnds(series) {
    var out = [];
    for (var i = 0; i < series.length; i++) {
      var p = parts(series[i].t), key = p.y * 12 + p.m;
      if (out.length && out[out.length - 1].key === key) out[out.length - 1] = { key: key, t: series[i].t, v: series[i].v };
      else out.push({ key: key, t: series[i].t, v: series[i].v });
    }
    return out;
  }
  /* Monthly returns of two series over the months both have. */
  function monthlyReturnsPaired(a, b) {
    var ma = monthEnds(a), mb = monthEnds(b), map = {};
    for (var i = 0; i < mb.length; i++) map[mb[i].key] = mb[i];
    var prevA = null, prevB = null, out = [];
    for (var k = 0; k < ma.length; k++) {
      var m = ma[k], n = map[m.key];
      if (!n) { prevA = null; prevB = null; continue; }
      if (prevA && prevB) out.push({ key: m.key, t: m.t, fund: m.v / prevA.v - 1, bench: n.v / prevB.v - 1 });
      prevA = m; prevB = n;
    }
    return out;
  }

  /* Up and down capture, the Morningstar definition: the geometric mean of the
     fund's monthly return in the months the index rose (fell), divided by the
     index's own geometric mean in those months. Over 100% in up months means
     more than the index's rises; under 100% in down months means less of its falls. */
  function captureRatios(fundSeries, benchSeries) {
    var months = monthlyReturnsPaired(fundSeries, benchSeries);
    var up = months.filter(function (m) { return m.bench > 0; }), down = months.filter(function (m) { return m.bench < 0; });
    function geo(list, key) {
      if (!list.length) return null;
      var prod = 1;
      for (var i = 0; i < list.length; i++) prod *= (1 + list[i][key]);
      return Math.pow(prod, 1 / list.length) - 1;
    }
    var fu = geo(up, 'fund'), bu = geo(up, 'bench'), fd = geo(down, 'fund'), bd = geo(down, 'bench');
    return { ok: months.length >= 12, months: months.length, upMonths: up.length, downMonths: down.length,
             upside: (fu != null && bu) ? fu / bu : null, downside: (fd != null && bd) ? fd / bd : null,
             fundUp: fu, benchUp: bu, fundDown: fd, benchDown: bd };
  }

  /* Daily arithmetic returns on the dates both files have. */
  function dailyExcess(fundSeries, benchSeries) {
    var s = sharedDates(fundSeries, benchSeries);
    var rf = [], rb = [], ex = [];
    for (var i = 1; i < s.a.length; i++) {
      var a = s.a[i].v / s.a[i - 1].v - 1, b = s.b[i].v / s.b[i - 1].v - 1;
      rf.push(a); rb.push(b); ex.push(a - b);
    }
    var span = s.a.length > 1 ? (s.a[s.a.length - 1].t - s.a[0].t) / (365.2425 * MS_PER_DAY) : 0;
    return { rf: rf, rb: rb, ex: ex, perYear: span > 0 ? ex.length / span : 0, from: s.a.length ? s.a[0].t : null,
             to: s.a.length ? s.a[s.a.length - 1].t : null, a: s.a, b: s.b };
  }

  /* SEBI's information ratio: excess return over the index divided by the
     spread of that excess, on daily returns, annualised. */
  function informationRatio(fundSeries, benchSeries) {
    var d = dailyExcess(fundSeries, benchSeries);
    if (d.ex.length < 60 || !(d.perYear > 0)) return fail('TOO_SHORT', 'Too few shared days to measure.');
    var m = meanOf(d.ex), sd = stdevOf(d.ex, m);
    if (!(sd > 0)) return fail('FLAT', 'The two move identically.');
    var annExcess = m * d.perYear, annSd = sd * Math.sqrt(d.perYear);
    return { ok: true, ratio: annExcess / annSd, excess: annExcess, trackingError: annSd, days: d.ex.length, from: d.from, to: d.to };
  }

  /* Tracking difference and error, for a fund that follows an index. */
  function tracking(fundSeries, benchSeries) {
    var d = dailyExcess(fundSeries, benchSeries);
    if (d.a.length < 60) return fail('TOO_SHORT', 'Too few shared days to measure.');
    var cf = cagr(d.a[0].v, d.a[d.a.length - 1].v, d.a[0].t, d.a[d.a.length - 1].t);
    var cb = cagr(d.b[0].v, d.b[d.b.length - 1].v, d.b[0].t, d.b[d.b.length - 1].t);
    var m = meanOf(d.ex), sd = stdevOf(d.ex, m);
    var corr = correlation(d.rf, d.rb);
    /* the last year on its own, the period SEBI's disclosure uses */
    var lastYearT = addYears(d.to, -1), rf1 = [], rb1 = [], ex1 = [];
    for (var i = 1; i < d.a.length; i++) if (d.a[i].t > lastYearT) { rf1.push(d.rf[i - 1]); rb1.push(d.rb[i - 1]); ex1.push(d.ex[i - 1]); }
    var te1 = ex1.length > 30 ? stdevOf(ex1, meanOf(ex1)) * Math.sqrt(d.perYear) : null;
    var start1 = atOrBefore(d.a, lastYearT, 7), startB1 = atOrBefore(d.b, lastYearT, 7);
    var td1 = (start1 && startB1) ? (cagr(start1.v, d.a[d.a.length - 1].v, start1.t, d.to).rate - cagr(startB1.v, d.b[d.b.length - 1].v, startB1.t, d.to).rate) : null;
    return { ok: cf.ok && cb.ok, fundRate: cf.rate, benchRate: cb.rate, difference: cf.rate - cb.rate,
             trackingError: sd * Math.sqrt(d.perYear), correlation: corr, closely: corr != null && corr >= 0.98,
             lastYearError: te1, lastYearDifference: td1, from: d.from, to: d.to, days: d.a.length };
  }

  /* Calendar-year returns: from the last value of the previous year to the
     last value of this year. The first and last years are marked partial when
     the file does not cover them whole. */
  function calendarYears(series) {
    if (!series || series.length < 2) return [];
    var byYear = {}, years = [];
    for (var i = 0; i < series.length; i++) {
      var y = parts(series[i].t).y;
      if (!byYear[y]) { byYear[y] = { first: series[i], last: series[i] }; years.push(y); }
      else byYear[y].last = series[i];
    }
    var out = [];
    for (var k = 0; k < years.length; k++) {
      var y2 = years[k], cur = byYear[y2], prev = byYear[y2 - 1];
      var start = prev ? prev.last : cur.first;
      var partial = !prev ? 'start' : null;
      var endP = parts(cur.last.t);
      if (k === years.length - 1 && !(endP.m === 12 && endP.d >= 24)) partial = partial === 'start' ? 'both' : 'end';
      if (start.t === cur.last.t) continue;
      out.push({ year: y2, from: start.t, to: cur.last.t, r: cur.last.v / start.v - 1, partial: partial });
    }
    return out;
  }
  function calendarYearsPaired(fund, bench) {
    var cf = calendarYears(fund), cb = calendarYears(bench), map = {};
    cb.forEach(function (r) { map[r.year] = r; });
    return cf.map(function (r) {
      var b = map[r.year];
      /* the index row is only comparable when it spans the same dates */
      var same = b && Math.abs(dayCount(b.from, r.from)) <= 7 && Math.abs(dayCount(b.to, r.to)) <= 7;
      return { year: r.year, from: r.from, to: r.to, fund: r.r, bench: same ? b.r : null, partial: r.partial };
    });
  }

  /* Trailing point-to-point returns, the factsheet's numbers: from the value
     on (or just before) N years before the last date to the last date. */
  function trailingReturns(series, yearsList) {
    if (!series || series.length < 2) return [];
    var last = series[series.length - 1], out = [];
    (yearsList || [1, 3, 5, 10]).forEach(function (n) {
      var startT = addYears(last.t, -n);
      var start = atOrBefore(series, startT, 7);
      if (!start || start.t < series[0].t || start.t >= last.t) { out.push({ years: n, ok: false }); return; }
      var c = cagr(start.v, last.v, start.t, last.t);
      out.push({ years: n, ok: c.ok, rate: c.rate, total: c.total, from: start.t, to: last.t });
    });
    var c0 = cagr(series[0].v, last.v, series[0].t, last.t);
    out.push({ years: null, sinceStart: true, ok: c0.ok, rate: c0.rate, total: c0.total, from: series[0].t, to: last.t });
    return out;
  }
  function trailingPaired(fund, bench, yearsList) {
    var f = trailingReturns(fund, yearsList), b = trailingReturns(bench, yearsList);
    return f.map(function (row, i) {
      var br = b[i];
      var same = br && br.ok && row.ok && Math.abs(dayCount(br.from, row.from)) <= 7 && Math.abs(dayCount(br.to, row.to)) <= 7;
      return { years: row.years, sinceStart: !!row.sinceStart, ok: row.ok, fund: row.ok ? row.rate : null,
               bench: same ? br.rate : null, from: row.from, to: row.to };
    });
  }

  /* Growth of a fixed sum, rebased on the first date both series hold. */
  function growthOf(series, base, from, to) {
    var out = [], first = null;
    for (var i = 0; i < series.length; i++) {
      var p = series[i];
      if (from != null && p.t < from) continue;
      if (to != null && p.t > to) break;
      if (first === null) first = p.v;
      out.push({ t: p.t, v: p.v / first * base });
    }
    return out;
  }

  /* --------------------------------------------- the reader's own flows against a series
   *
   * benchmarkEquivalent: the same rupees on the same dates, put into this
   * series instead. Money in buys units at that day's value (the last value on
   * or before the date, within `tol` days); money out sells them; the holding
   * is valued on `valueDate` (default: the series' last date). The XIRR of
   * those flows is what the reader's own timing would have earned in this
   * series. The series carries no costs, and the caller says so.
   *
   * flows: [{ t, amount, kind }] with amount > 0 and kind 'in' | 'out' | 'value'.
   * 'value' flows are the reader's own valuations and are replaced here. */
  function benchmarkEquivalent(flows, series, opts) {
    var o = opts || {};
    var tol = o.toleranceDays == null ? 7 : o.toleranceDays;
    /* An index is bought at its value on the date, or the last value before
       it. A fund's units are allotted at the NAV of the date, or the next NAV
       after it: priceRule 'after' replays a fund's own NAV file that way. */
    var priceAt = o.priceRule === 'after' ? atOrAfter : atOrBefore;
    if (!series || series.length < 2) return fail('TOO_SHORT', 'This file does not hold enough history.');
    var list = (flows || []).filter(function (f) { return f && isValidDate(f.t) && f.amount > 0 && f.kind !== 'value'; })
      .slice().sort(function (a, b) { return a.t - b.t; });
    if (!list.length) return fail('NO_FLOWS', 'There are no payments to put into this history.');
    var valueDate = o.valueDate != null ? o.valueDate : series[series.length - 1].t;
    var units = 0, paidIn = 0, tookOut = 0, used = [], skipped = [], eq = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f.t > valueDate) { skipped.push({ t: f.t, amount: f.amount, why: 'after the valuation date' }); continue; }
      var obs = priceAt(series, f.t, tol);
      if (!obs || obs.t > valueDate) { skipped.push({ t: f.t, amount: f.amount, why: 'no value in the file near this date' }); continue; }
      var u = f.amount / obs.v;
      if (f.kind === 'out') { units -= u; tookOut += f.amount; eq.push({ t: f.t, amount: f.amount }); }
      else { units += u; paidIn += f.amount; eq.push({ t: f.t, amount: -f.amount }); }
      used.push({ t: f.t, amount: f.amount, kind: f.kind, price: obs.v, priceDate: obs.t, units: u });
    }
    if (!used.length) return fail('NO_MATCH', 'None of the payment dates fall inside this file’s history.');
    var endObs = atOrBefore(series, valueDate, tol) || series[series.length - 1];
    var endValue = units * endObs.v;
    if (units < -1e-9) return fail('OVERSOLD', 'More was taken out than went in, at these prices, so the holding runs out before the end.');
    var all = eq.concat([{ t: endObs.t, amount: endValue }]);
    var x = xirr(all);
    return { ok: true, rate: x.ok ? x.rate : null, xirr: x, endValue: endValue, units: units, valuedOn: endObs.t,
             paidIn: paidIn, tookOut: tookOut, gain: endValue + tookOut - paidIn, used: used, skipped: skipped, flows: all };
  }

  /* fundOverDates: what this series itself did between the reader's first
   * payment and the valuation date, as a time-weighted figure (CAGR of the
   * value, the return the fund would publish for exactly these dates). The gap
   * between it and the reader's own XIRR is the effect of when the money moved. */
  function fundOverDates(firstT, valueDate, series, readerRate) {
    if (!series || series.length < 2) return fail('TOO_SHORT', 'This file does not hold enough history.');
    var start = atOrBefore(series, firstT, 7), end = atOrBefore(series, valueDate, 7) || series[series.length - 1];
    if (!start) return fail('NO_MATCH', 'The file does not reach back to your first payment.');
    var c = cagr(start.v, end.v, start.t, end.t);
    if (!c.ok) return c;
    return { ok: true, rate: c.rate, total: c.total, from: start.t, to: end.t, days: c.days,
             gap: isFinite(readerRate) ? c.rate - readerRate : null };
  }

  /* holdingPath: the reader's holding, valued every day the file has a value:
   * units held on that day times the day's value. A lot is {t, units, dir}
   * where units may be given (from a statement) or derived from amount / value.
   * Returns the value path and the net money put in on each date, so a fall
   * can be measured on price moves alone. */
  function holdingPath(lots, series, opts) {
    var o = opts || {};
    var tol = o.toleranceDays == null ? 7 : o.toleranceDays;
    var list = (lots || []).filter(function (l) { return l && isValidDate(l.t) && l.amount > 0; })
      .slice().sort(function (a, b) { return a.t - b.t; });
    if (!list.length || !series || series.length < 2) return fail('NO_FLOWS', 'Nothing to value.');
    var valueDate = o.valueDate != null ? o.valueDate : series[series.length - 1].t;
    var resolved = list.map(function (l) {
      /* units a payment bought: the statement's own figure, else the amount
         at the NAV of the date, or the next NAV after it */
      var obs = atOrAfter(series, l.t, tol);
      var units = l.units != null && l.units > 0 ? l.units : (obs ? l.amount / obs.v : null);
      return { t: l.t, dir: l.dir === 'out' ? 'out' : 'in', amount: l.amount, units: units, ok: !!units };
    }).filter(function (l) { return l.ok; });
    if (!resolved.length) return fail('NO_MATCH', 'None of the payment dates fall inside this file’s history.');
    var path = [], j = 0, units = 0, netIn = 0;
    for (var i = 0; i < series.length; i++) {
      var p = series[i];
      if (p.t < resolved[0].t || p.t > valueDate) continue;
      while (j < resolved.length && resolved[j].t <= p.t) {
        var l = resolved[j++];
        if (l.dir === 'out') { units -= l.units; netIn -= l.amount; } else { units += l.units; netIn += l.amount; }
      }
      path.push({ t: p.t, v: units * p.v, units: units, netIn: netIn });
    }
    if (path.length < 2) return fail('TOO_SHORT', 'Too little history after your first payment.');
    /* The gain path: value minus net money put in. A fall in it is a fall
       from price moves alone; a withdrawal or a purchase moves both sides equally. */
    var peakI = 0, worst = { rupees: 0 };
    for (var k = 1; k < path.length; k++) {
      var gk = path[k].v - path[k].netIn, gp = path[peakI].v - path[peakI].netIn;
      if (gk >= gp) { peakI = k; continue; }
      var fall = gp - gk;
      if (fall > worst.rupees) {
        worst = { rupees: fall, share: path[peakI].v > 0 ? fall / path[peakI].v : null, from: path[peakI].t, to: path[k].t, fromValue: path[peakI].v, toValue: path[k].v, peakI: peakI, troughI: k };
      }
    }
    var recovered = null;
    if (worst.rupees > 0) {
      var gpeak = path[worst.peakI].v - path[worst.peakI].netIn;
      for (var m = worst.troughI + 1; m < path.length; m++) if (path[m].v - path[m].netIn >= gpeak) { recovered = path[m].t; break; }
    }
    return { ok: true, path: path, units: units, endValue: path[path.length - 1].v, worst: worst, recoveredOn: recovered,
             fallDays: worst.rupees > 0 ? dayCount(worst.from, worst.to) : null,
             recoveryDays: recovered ? dayCount(worst.to, recovered) : null, lots: resolved };
  }

  /* rollingSip: a fixed sum every month for N years, from every month in the
   * file, valued at the end of each window. The XIRR of every such window:
   * what a monthly investor got over every stretch of this length. */
  function rollingSip(series, years, opts) {
    var o = opts || {};
    var tol = o.toleranceDays == null ? 7 : o.toleranceDays;
    if (!series || series.length < 2) return fail('TOO_SHORT', 'This file does not hold enough history.');
    if (!(years > 0)) return fail('BAD_HORIZON', 'Choose a holding period of at least one year.');
    var months = Math.round(years * 12);
    var startT = series[0].t, lastT = series[series.length - 1].t, out = [];
    for (var s = 0; ; s++) {
      var t0 = addMonths(startT, s);
      var endT = addYears(t0, years);
      if (endT > lastT) break;
      var flows = [], units = 0, ok = true;
      for (var m = 0; m < months; m++) {
        var tm = addMonths(t0, m);
        var obs = atOrAfter(series, tm, tol);
        if (!obs || obs.t >= endT) { ok = false; break; }
        flows.push({ t: obs.t, amount: -1 });
        units += 1 / obs.v;
      }
      if (!ok) continue;
      var endObs = atOrBefore(series, endT, tol);
      if (!endObs || endObs.t <= flows[flows.length - 1].t) continue;
      flows.push({ t: endObs.t, amount: units * endObs.v });
      var x = xirr(flows);
      if (x.ok) out.push({ t: flows[0].t, endT: endObs.t, r: x.rate, paid: months, worth: units * endObs.v / months });
    }
    if (!out.length) return fail('NO_WINDOWS', 'Not one full stretch of that length fits in this file.');
    var values = out.map(function (w) { return w.r; });
    var best = out[0], worst = out[0];
    for (var k = 1; k < out.length; k++) { if (out[k].r > best.r) best = out[k]; if (out[k].r < worst.r) worst = out[k]; }
    return { ok: true, years: years, windows: out, values: values, stats: describe(values), best: best, worst: worst };
  }

  /* ------------------------------------------------------------ goal maths
   * The monthly rate is the twelfth root of the annual rate. Contributions are
   * paid at the start of each month; a step-up is applied once every twelve months. */
  function monthlyRate(annualRate) { return Math.pow(1 + annualRate, 1 / 12) - 1; }
  function futureValueOfLumpSum(present, annualRate, years) { return present * Math.pow(1 + annualRate, years); }
  function futureValueOfSip(monthlyAmount, annualRate, years, annualStepUpRate) {
    var months = Math.round(years * 12);
    if (months <= 0 || !(monthlyAmount > 0)) return 0;
    var i = monthlyRate(annualRate), step = annualStepUpRate || 0;
    var amount = monthlyAmount, total = 0;
    for (var m = 0; m < months; m++) {
      if (m > 0 && m % 12 === 0) amount = amount * (1 + step);
      total = (total + amount) * (1 + i);
    }
    return total;
  }
  function sipGrowthFactor(annualRate, years, annualStepUpRate) { return futureValueOfSip(1, annualRate, years, annualStepUpRate); }
  function num(v) { var n = typeof v === 'string' ? parseFloat(v) : v; return isFinite(n) ? n : 0; }

  function projectGoal(input) {
    var currentValue = num(input.currentValue), monthlySip = num(input.monthlySip), years = num(input.years);
    var annualRate = num(input.annualRate), stepUp = num(input.annualStepUpRate), target = num(input.target);
    if (!(years > 0)) return fail('BAD_YEARS', 'Enter how many years are left, as a number greater than zero.');
    if (years > 60) return fail('BAD_YEARS', 'Enter a period of 60 years or less.');
    if (annualRate <= -1) return fail('BAD_RATE', 'Enter an assumed return greater than -100%.');
    if (annualRate > 0.5) return fail('BAD_RATE', 'Enter an assumed return of 50% a year or less. Higher assumptions do not make a plan, they hide one.');
    if (!(target > 0)) return fail('BAD_TARGET', 'Enter the amount you are aiming for.');
    var fromCorpus = futureValueOfLumpSum(currentValue, annualRate, years);
    var fromSip = futureValueOfSip(monthlySip, annualRate, years, stepUp);
    var projected = fromCorpus + fromSip;
    var gap = target - projected;
    var meaningful = Math.max(1, Math.abs(target) * 1e-9);
    var short = gap > meaningful;
    var factor = sipGrowthFactor(annualRate, years, stepUp);
    var extraMonthly = short && factor > 0 ? gap / factor : 0;
    return { ok: true, projected: projected, fromCorpus: fromCorpus, fromSip: fromSip, target: target,
             gap: short ? gap : 0, surplus: projected - target, onTrack: !short, extraMonthly: extraMonthly,
             totalContributed: contributions(monthlySip, years, stepUp), years: years, annualRate: annualRate };
  }

  /* The yearly return at which the plan lands exactly on the goal. */
  function requiredRate(input) {
    var base = { currentValue: num(input.currentValue), monthlySip: num(input.monthlySip), years: num(input.years),
                 annualStepUpRate: num(input.annualStepUpRate), target: num(input.target) };
    if (!(base.years > 0) || !(base.target > 0)) return fail('BAD_INPUT', 'Enter the years left and the amount you are aiming for.');
    if (!(base.currentValue > 0) && !(base.monthlySip > 0)) return fail('NO_MONEY', 'With nothing invested and nothing added each month, no rate reaches the goal.');
    function at(r) { var p = projectGoal({ currentValue: base.currentValue, monthlySip: base.monthlySip, years: base.years, annualRate: r, annualStepUpRate: base.annualStepUpRate, target: base.target }); return p.ok ? p.projected - base.target : NaN; }
    var lo = -0.99, hi = 0.5;
    var flo = at(lo), fhi = at(hi);
    if (!(flo < 0)) return { ok: true, rate: null, reachedAtZero: true, message: 'The goal is reached even if the money earns nothing.' };
    if (!(fhi > 0)) return { ok: true, rate: null, beyond: true, message: 'Even 50% a year would not reach it in this time.' };
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2, fm = at(mid);
      if (fm > 0) hi = mid; else lo = mid;
      if (hi - lo < 1e-10) break;
    }
    return { ok: true, rate: (lo + hi) / 2 };
  }

  /* A target in future rupees, read in today's, and the target that keeps
     today's buying power. */
  function todaysRupees(target, inflation, years) {
    var f = Math.pow(1 + num(inflation), num(years));
    return { buysToday: num(target) / f, targetForToday: num(target) * f, factor: f };
  }

  /* The same goal under three stretches of a real history: the worst, the
     median and the best rolling window of the plan's own length. */
  function goalUnderHistory(input, series) {
    var years = Math.max(1, Math.round(num(input.years)));
    var r = rollingReturns(series, years, {});
    if (!r.ok) return r;
    function plan(rate) { var p = projectGoal({ currentValue: input.currentValue, monthlySip: input.monthlySip, years: input.years, annualRate: Math.min(rate, 0.5), annualStepUpRate: input.annualStepUpRate, target: input.target }); return p; }
    return { ok: true, years: years, windows: r.stats.count,
             worst: { rate: r.stats.min, from: r.worst.t, to: r.worst.endT, plan: plan(r.stats.min) },
             median: { rate: r.stats.median, plan: plan(r.stats.median) },
             best: { rate: r.stats.max, from: r.best.t, to: r.best.endT, plan: plan(r.stats.max) } };
  }

  function requiredAcrossRates(input, rates) {
    return (rates || [0.08, 0.10, 0.12]).map(function (rate) {
      var plan = projectGoal({ currentValue: input.currentValue, monthlySip: input.monthlySip, years: input.years, annualRate: rate, annualStepUpRate: input.annualStepUpRate, target: input.target });
      return plan.ok ? { rate: rate, projected: plan.projected, gap: plan.gap, extraMonthly: plan.extraMonthly, onTrack: plan.onTrack } : { rate: rate, error: plan.message };
    });
  }
  function costOfWaiting(input, delays) {
    var fullYears = num(input.years), rate = num(input.annualRate), step = num(input.annualStepUpRate);
    var corpusAtGoal = futureValueOfLumpSum(num(input.currentValue), rate, fullYears);
    var shortfall = num(input.target) - corpusAtGoal;
    return (delays || [0, 5, 10]).map(function (delay) {
      var yearsLeft = fullYears - delay;
      if (yearsLeft <= 0) return { delay: delay, impossible: true };
      var factor = sipGrowthFactor(rate, yearsLeft, step);
      var needed = shortfall > 0 && factor > 0 ? shortfall / factor : 0;
      return { delay: delay, yearsLeft: yearsLeft, corpusAtGoal: corpusAtGoal, monthlyNeeded: needed, totalPaid: contributions(needed, yearsLeft, step) };
    });
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

  /* ------------------------------------------- the reader's own stretch
   * spanPercentile: where the fund's own rate over the reader's dates sits
   * among every stretch of the same length in the fund's file. A stretch
   * starts at every observation and ends on the last observation on or
   * before the same number of days later, within `tol` days, or is dropped;
   * each is annualised on a 365-day year, as every rate here is. The
   * percentile is the share of stretches that returned less, ties counted
   * half: 62 means 62 in every 100 stretches of that length did worse. */
  function spanPercentile(series, fromT, toT, rate, opts) {
    var o = opts || {};
    var tol = o.toleranceDays == null ? 7 : o.toleranceDays;
    if (!series || series.length < 2 || !isValidDate(fromT) || !isValidDate(toT) || !isFinite(rate)) return fail('NO_DATA', 'Nothing to place.');
    var spanDays = dayCount(fromT, toT);
    if (spanDays < 1) return fail('TOO_SHORT', 'The stretch is under a day.');
    var values = [], j = 0, last = series[series.length - 1].t;
    for (var i = 0; i < series.length; i++) {
      var target = series[i].t + spanDays * MS_PER_DAY;
      if (target > last) break;
      if (j < i) j = i;
      while (j + 1 < series.length && series[j + 1].t <= target) j++;
      var end = series[j];
      if (end.t <= series[i].t || dayCount(end.t, target) > tol) continue;
      if (!(series[i].v > 0) || !(end.v > 0)) continue;
      values.push(Math.pow(end.v / series[i].v, DAY_BASIS / dayCount(series[i].t, end.t)) - 1);
    }
    if (values.length < 3) return fail('TOO_FEW', 'Only ' + values.length + ' stretches of this length fit in the file.');
    var below = 0, equal = 0;
    for (var k = 0; k < values.length; k++) {
      if (Math.abs(values[k] - rate) <= 1e-9) equal++;
      else if (values[k] < rate) below++;
    }
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return { ok: true, count: values.length, below: below, equal: equal, percentile: 100 * (below + equal / 2) / values.length,
             spanDays: spanDays, years: spanDays / DAY_BASIS, min: sorted[0], median: median(sorted), max: sorted[sorted.length - 1] };
  }

  /* youngMoney: how much of the money paid in went in during the two years
   * before the valuation date. Money that has had little time behind it
   * moves a money-weighted rate more than its share of the years. */
  function youngMoney(flows, valueDate) {
    var since = addYears(valueDate, -2), total = 0, recent = 0;
    (flows || []).forEach(function (f) {
      if (!f || f.kind !== 'in' || !(f.amount > 0) || !isValidDate(f.t) || f.t > valueDate) return;
      total += f.amount;
      if (f.t > since) recent += f.amount;
    });
    return { total: total, recent: recent, share: total > 0 ? recent / total : 0, since: since };
  }

  /* breakEven: what a holding in loss must be worth, and what its NAV must
   * reach, for its value plus what was taken out to equal what was put in. */
  function breakEven(h) {
    var need = (h.paidIn || 0) - (h.tookOut || 0);
    var inLoss = need > 0 && isFinite(h.value) && h.value < need;
    return { inLoss: inLoss, valueNeeded: inLoss ? need : null, navNeeded: inLoss && h.units > 0 ? need / h.units : null };
  }

  /* averagePurchaseNav: what was paid for each unit bought, on average,
   * across every purchase that carries its units: money in divided by units in. */
  function averagePurchaseNav(lots) {
    var paid = 0, units = 0;
    (lots || []).forEach(function (l) { if (l && l.dir !== 'out' && l.units > 0 && l.amount > 0) { paid += l.amount; units += l.units; } });
    return units > 0 ? { ok: true, nav: paid / units, paid: paid, units: units } : fail('NO_UNITS', 'No purchase carries its units.');
  }

  /* ----------------------------------------------------------------- export */
  var api = {
    MS_PER_DAY: MS_PER_DAY, DAY_BASIS: DAY_BASIS, utc: utc, dayCount: dayCount, yearsBetween: yearsBetween,
    addYears: addYears, addMonths: addMonths, atOrBefore: atOrBefore, atOrAfter: atOrAfter,
    xnpv: xnpv, xirr: xirr, allRoots: allRoots, cagr: cagr, absoluteReturn: absoluteReturn, doublingTime: doublingTime,
    rollingReturns: rollingReturns, measureWindows: measureWindows, FREQUENCY: FREQUENCY,
    describe: describe, quantile: quantile, median: median, stdevOf: stdevOf, meanOf: meanOf, correlation: correlation,
    histogram: histogram, shareAbove: shareAbove,
    maxDrawdown: maxDrawdown, longestUnderwater: longestUnderwater,
    annualisedVolatility: annualisedVolatility, alignCalendar: alignCalendar, sharedDates: sharedDates,
    rangeOverlap: rangeOverlap, medianGapDays: medianGapDays, maxHorizon: maxHorizon, spanYearsOf: spanYearsOf,
    compareRolling: compareRolling, monthEnds: monthEnds, monthlyReturnsPaired: monthlyReturnsPaired,
    captureRatios: captureRatios, informationRatio: informationRatio, tracking: tracking,
    calendarYears: calendarYears, calendarYearsPaired: calendarYearsPaired,
    trailingReturns: trailingReturns, trailingPaired: trailingPaired, growthOf: growthOf,
    benchmarkEquivalent: benchmarkEquivalent, fundOverDates: fundOverDates, holdingPath: holdingPath, rollingSip: rollingSip,
    monthlyRate: monthlyRate, futureValueOfLumpSum: futureValueOfLumpSum, futureValueOfSip: futureValueOfSip,
    sipGrowthFactor: sipGrowthFactor, projectGoal: projectGoal, requiredRate: requiredRate, todaysRupees: todaysRupees,
    goalUnderHistory: goalUnderHistory, requiredAcrossRates: requiredAcrossRates, costOfWaiting: costOfWaiting,
    contributions: contributions, spanPercentile: spanPercentile, youngMoney: youngMoney, breakEven: breakEven,
    averagePurchaseNav: averagePurchaseNav
  };
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.PRCEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
