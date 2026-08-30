/* The Simulator — the two calculation engines and the date maths they share.
 *
 * Written against Build Specification v2, sections 8.2 (rolling), 9.2-9.3
 * (XIRR) and the conventions fixed in 8.2: a 365-day year everywhere, so the
 * web modules and the workbook cannot disagree; daily observations; full
 * precision in, one decimal place out.
 *
 * No DOM, no network, no clock. Everything here is a pure function of its
 * arguments, which is what lets section 17's fixtures pin it down.
 */
(function (root) {
  'use strict';

  var MS_PER_DAY = 86400000;
  var YEAR_DAYS = 365;               /* §8.2, matching Excel's XIRR */
  var MATCH_TOLERANCE_DAYS = 7;      /* §8.2 step 2 */

  /* ------------------------------------------------------------------ dates */

  function utc(y, m, d) { return Date.UTC(y, m - 1, d); }
  function dayCount(from, to) { return Math.round((to - from) / MS_PER_DAY); }
  function addDays(t, n) { return t + n * MS_PER_DAY; }

  function parts(t) {
    var d = new Date(t);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  /* §8.2 step 1: 29 February maps to 28 February. */
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

  function toISO(t) { return new Date(t).toISOString().slice(0, 10); }

  function fromISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return NaN;
    var t = utc(+m[1], +m[2], +m[3]);
    var back = new Date(t);
    /* rejects 31 February rather than rolling it into March */
    if (back.getUTCMonth() + 1 !== +m[2] || back.getUTCDate() !== +m[3]) return NaN;
    return t;
  }

  function fail(code, message, extra) {
    var out = { ok: false, code: code, message: message };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  /* ------------------------------------------------------------------- XIRR
   *
   * §9.3. Newton-Raphson from 0.10; on divergence or oscillation, bisection on
   * [-0.99, 100] -- that is -99% to +10,000% a year. The upper end is not
   * fantasy: a real holding measured over a few weeks annualises to four
   * figures, and a solver that refuses it forces the screen to say "no answer"
   * when the honest answer is "here it is, and it is meaningless at this
   * length". Whether to show it is the screen's decision, not the solver's.
   * If no sign change exists on that bracket, XIRR-NO-SOLVE -- never a raw
   * error, never NaN on screen.
   */

  function npv(rate, flows, t0) {
    var sum = 0;
    for (var i = 0; i < flows.length; i++) {
      sum += flows[i].amount / Math.pow(1 + rate, dayCount(t0, flows[i].t) / YEAR_DAYS);
    }
    return sum;
  }

  function dNpv(rate, flows, t0) {
    var sum = 0;
    for (var i = 0; i < flows.length; i++) {
      var e = dayCount(t0, flows[i].t) / YEAR_DAYS;
      if (e === 0) continue;
      sum -= e * flows[i].amount / Math.pow(1 + rate, e + 1);
    }
    return sum;
  }

  function xirr(rawFlows) {
    var flows = (rawFlows || [])
      .filter(function (f) { return f && isFinite(f.t) && isFinite(f.amount); })
      .slice()
      .sort(function (a, b) { return a.t - b.t; });
    if (flows.length < 2) return fail('XIRR-NO-SOLVE', 'Not enough entries to work out a rate.');

    var t0 = flows[0].t;
    if (flows[flows.length - 1].t === t0) {
      return fail('XIRR-NO-SOLVE', 'Every entry is on the same date, so there is no period to spread a rate over.');
    }

    /* Newton-Raphson from 0.10 */
    var r = 0.10;
    for (var i = 0; i < 60; i++) {
      var f = npv(r, flows, t0);
      if (!isFinite(f)) break;
      if (Math.abs(f) < 1e-9) return { ok: true, rate: r, method: 'newton' };
      var d = dNpv(r, flows, t0);
      if (!isFinite(d) || d === 0) break;
      var next = r - f / d;
      if (!isFinite(next) || next <= -0.99 || next > 100) break;   /* diverged */
      if (Math.abs(next - r) < 1e-12) return { ok: true, rate: next, method: 'newton' };
      r = next;
    }

    /* bisection on [-0.99, 100] */
    var lo = -0.99, hi = 100;
    var flo = npv(lo, flows, t0), fhi = npv(hi, flows, t0);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) {
      return fail('XIRR-NO-SOLVE',
        'These entries do not settle on a single yearly rate. That usually means the pattern of ' +
        'money in and money out has no one answer.');
    }
    for (var k = 0; k < 300; k++) {
      var mid = (lo + hi) / 2;
      var fm = npv(mid, flows, t0);
      if (flo * fm <= 0) { hi = mid; } else { lo = mid; flo = fm; }
    }
    return { ok: true, rate: (lo + hi) / 2, method: 'bisection' };
  }

  /* §9.2 validation, in the specified precedence order. Returns the first
   * offending code, or null. */
  function validateRows(rows) {
    var list = rows || [];
    var ins = list.filter(function (r) { return r.type === 'in'; });
    var values = list.filter(function (r) { return r.type === 'value'; });

    if (!ins.length) return { code: 'XIRR-NEED-IN' };
    if (values.length !== 1) return { code: 'XIRR-NEED-VALUE', found: values.length };

    /* "Incomplete" means a row the visitor has not finished filling in. A zero
     * Value today is finished and is a real answer -- the holding is worth
     * nothing -- and section 9.2 rule 4 depends on it reaching the same-sign
     * check rather than being turned back here. */
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var floor = r.type === 'value' ? 0 : Number.MIN_VALUE;
      if (!isFinite(r.t) || !isFinite(r.amount) || r.amount < floor || !r.type) {
        return { code: 'XIRR-ROW-FIX', row: i };
      }
    }

    var flows = toFlows(list);
    var pos = flows.some(function (f) { return f.amount > 0; });
    var neg = flows.some(function (f) { return f.amount < 0; });
    if (!pos || !neg) return { code: 'XIRR-SAME-SIGN' };

    var span = dayCount(flows[0].t, values[0].t);
    if (span < YEAR_DAYS) return { code: 'XIRR-SUB-YEAR', span: span, blocking: false };
    return null;
  }

  /* Amounts are always entered positive; the engine applies the signs (§9.1). */
  function toFlows(rows) {
    return (rows || []).map(function (r) {
      return { t: r.t, amount: r.type === 'in' ? -Math.abs(r.amount) : Math.abs(r.amount) };
    }).sort(function (a, b) { return a.t - b.t; });
  }

  /* ---------------------------------------------------------------- rolling
   *
   * §8.2. The window is general internally: Module B passes whole years,
   * Module A passes the visitor's exact span in days.
   *
   * The annualisation divides by the ACTUAL elapsed days between the two NAV
   * dates, not by the nominal window length. With the 7-day matching rule a
   * window can land a few days short, and dividing by the nominal length would
   * quietly misprice exactly those windows.
   */

  function windowEnd(startT, window) {
    return window.days != null ? addDays(startT, window.days) : addYears(startT, window.years);
  }

  function rolling(series, window, options) {
    var opts = options || {};
    var tol = opts.toleranceDays == null ? MATCH_TOLERANCE_DAYS : opts.toleranceDays;
    var data = series || [];
    if (data.length < 2) {
      return fail('RR-TOO-YOUNG', 'There is not enough history here to measure.', { windows: 0 });
    }
    var lengthDays = window.days != null
      ? window.days
      : dayCount(data[0].t, addYears(data[0].t, window.years));
    var spanDays = dayCount(data[0].t, data[data.length - 1].t);
    if (spanDays < lengthDays) {
      return fail('RR-TOO-YOUNG', 'The history is shorter than one window.',
                  { windows: 0, haveDays: spanDays, needDays: lengthDays });
    }

    var points = [], j = 0;
    for (var i = 0; i < data.length; i++) {
      var target = windowEnd(data[i].t, window);
      if (target > data[data.length - 1].t) break;
      if (j < i) j = i;
      while (j + 1 < data.length && data[j + 1].t <= target) j++;   /* latest NAV <= target */
      var end = data[j];
      if (end.t <= data[i].t) continue;
      if (dayCount(end.t, target) > tol) continue;                  /* series break: skip */
      if (!(data[i].v > 0) || !(end.v > 0)) continue;
      var days = dayCount(data[i].t, end.t);
      points.push({
        startT: data[i].t,
        endT: end.t,
        startV: data[i].v,
        endV: end.v,
        days: days,
        r: Math.pow(end.v / data[i].v, YEAR_DAYS / days) - 1
      });
    }

    if (!points.length) {
      return fail('RR-TOO-YOUNG', 'No complete window could be measured from this history.', { windows: 0 });
    }
    return { ok: true, points: points, stats: describe(points), lengthDays: lengthDays };
  }

  function describe(points) {
    var values = points.map(function (p) { return p.r; });
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length, sum = 0, below = 0;
    for (var i = 0; i < n; i++) { sum += sorted[i]; if (sorted[i] < 0) below++; }
    var best = points[0], worst = points[0];
    for (var k = 1; k < points.length; k++) {
      if (points[k].r > best.r) best = points[k];
      if (points[k].r < worst.r) worst = points[k];
    }
    return {
      count: n,
      best: best,
      worst: worst,
      average: sum / n,
      median: quantile(sorted, 0.5),
      p25: quantile(sorted, 0.25),
      p75: quantile(sorted, 0.75),
      belowZero: below / n,
      values: sorted
    };
  }

  function quantile(sorted, q) {
    var n = sorted.length;
    if (!n) return NaN;
    if (n === 1) return sorted[0];
    var pos = (n - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /* Where one figure sits among a set, as 0-100. Used by §7.2(d) to place the
   * visitor's own stretch inside the fund's whole record.
   *
   * Ties count half, which is the standard percentile rank and the only reading
   * that behaves at the extremes: the visitor's own window is itself one of the
   * windows measured, so there is always at least one exact tie, and counting
   * ties whole would report a fund that moved at one steady rate as sitting at
   * the very top of its own record rather than squarely in the middle of it. */
  function percentileOf(value, sortedValues) {
    var n = sortedValues.length;
    if (!n) return NaN;
    var below = 0, equal = 0;
    for (var i = 0; i < n; i++) {
      if (sortedValues[i] < value) below++;
      else if (sortedValues[i] === value) equal++;
    }
    return ((below + equal / 2) / n) * 100;
  }

  /* Placement, said the way a reader says it: "higher than N of every 100".
   * A decimal percentile invites a precision the data does not have, and it
   * reads as a score. An integer count out of a hundred reads as a place. */
  function placeInHundred(value, sortedValues) {
    var p = percentileOf(value, sortedValues);
    if (!isFinite(p)) return NaN;
    return Math.max(0, Math.min(100, Math.round(p)));
  }

  /* Share of windows at or above a rate the visitor typed (§8.1 item 5). */
  function shareAtOrAbove(points, rate) {
    if (!points.length || !isFinite(rate)) return NaN;
    var n = 0;
    for (var i = 0; i < points.length; i++) if (points[i].r >= rate) n++;
    return n / points.length;
  }

  /* Point-to-point annualised return between two dated values (§7.2c, 7.2e). */
  function pointToPoint(startValue, endValue, startT, endT) {
    if (!(startValue > 0) || !(endValue > 0)) return fail('BAD-VALUES', 'Both values must be above zero.');
    var days = dayCount(startT, endT);
    if (days <= 0) return fail('BAD-PERIOD', 'The end date must be after the start date.');
    return { ok: true, rate: Math.pow(endValue / startValue, YEAR_DAYS / days) - 1, days: days };
  }

  var api = {
    MS_PER_DAY: MS_PER_DAY, YEAR_DAYS: YEAR_DAYS, MATCH_TOLERANCE_DAYS: MATCH_TOLERANCE_DAYS,
    utc: utc, dayCount: dayCount, addDays: addDays, addYears: addYears, addMonths: addMonths,
    toISO: toISO, fromISO: fromISO,
    npv: npv, xirr: xirr, validateRows: validateRows, toFlows: toFlows,
    rolling: rolling, describe: describe, quantile: quantile,
    percentileOf: percentileOf, placeInHundred: placeInHundred,
    shareAtOrAbove: shareAtOrAbove, pointToPoint: pointToPoint
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimEngines = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
