/* The Simulator - Module A, "Where You Stand": the computations of section 7.2.
 *
 * Six steps, in the order the specification fixes them:
 *   a  units and estimated value, via the execution-NAV rule
 *   b  the visitor's personal XIRR
 *   c  the fund's own speed over the same span
 *   d  where that span sits inside the fund's entire recorded history
 *   e  the investable alternative's speed over the same span
 *   f  the replay: the same rupees, on the same dates, in the proxy
 *
 * No new data source and no new maintenance surface: this file calls the two
 * engines in sim/engines.js and nothing else. It is pure. "Today" arrives as an
 * argument so the same inputs always produce the same reading, which is what
 * section 7.3's determinism requirement rests on.
 */
(function (root) {
  'use strict';

  var E = (typeof require === 'function') ? require('./engines.js') : root.SimEngines;

  var EXECUTION_TOLERANCE_DAYS = 7;   /* section 7.2(a) */
  var STRETCH_MIN_WINDOWS = 30;       /* section 7.2(d) */
  var STRETCH_MIN_EXTRA_DAYS = 365;   /* section 7.2(d): span + 1 year of history */

  function fail(code, extra) {
    var out = { ok: false, code: code };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  /* ------------------------------------------------------ a. execution NAV
   *
   * The first NAV on or after the transaction date. A Saturday buy therefore
   * takes Monday's NAV. Nothing within seven calendar days means the row is
   * flagged rather than silently mapped to a distant price.
   */
  function executionNav(series, t) {
    for (var i = 0; i < series.length; i++) {
      if (series[i].t >= t) {
        var gap = E.dayCount(t, series[i].t);
        if (gap > EXECUTION_TOLERANCE_DAYS) return { ok: false, reason: 'gap', gapDays: gap };
        return { ok: true, t: series[i].t, v: series[i].v, gapDays: gap };
      }
    }
    return { ok: false, reason: 'after-last' };   /* dated past the last published NAV */
  }

  /* Run one set of dated amounts through one fund's NAV series, tracking units.
   * Used twice: for the visitor's own fund in step (a), and unchanged for the
   * proxy in the replay of step (f). */
  function execute(rows, series) {
    if (!series || series.length < 2) return fail('POS-NO-SERIES');
    var first = series[0], latest = series[series.length - 1];

    var entries = (rows || []).slice().sort(function (a, b) { return a.t - b.t; });
    var flagged = [], units = 0, put = 0, took = 0, executed = [];

    for (var i = 0; i < entries.length; i++) {
      var r = entries[i];
      /* Section 7.6: a transaction dated before the fund's first NAV stops the
       * run and points at the row. There is no price to execute it at. */
      if (r.t < first.t) {
        return fail('POS-ROW-BEFORE-FUND', { row: i, date: E.toISO(r.t), fundStarts: E.toISO(first.t) });
      }
      var hit = executionNav(series, r.t);
      if (!hit.ok) { flagged.push({ row: i, date: E.toISO(r.t), reason: hit.reason, gapDays: hit.gapDays }); continue; }

      var amount = Math.abs(r.amount);
      var delta = amount / hit.v;
      if (r.type === 'out') {
        units -= delta;
        took += amount;
        /* Section 7.2(a): entries and fund that do not reconcile stop the run;
         * the visitor can fix rows or use the override. */
        if (units < -1e-9) {
          return fail('POS-UNITS-NEGATIVE', { row: i, date: E.toISO(r.t) });
        }
      } else {
        units += delta;
        put += amount;
      }
      executed.push({ row: i, t: r.t, navT: hit.t, nav: hit.v, units: delta,
                      type: r.type, amount: amount, gapDays: hit.gapDays });
    }

    if (!executed.length) return fail('POS-NO-ROWS-EXECUTED', { flagged: flagged });

    return {
      ok: true,
      units: units,
      put: put,
      took: took,
      executed: executed,
      flagged: flagged,
      firstExecutionT: executed[0].navT,
      firstExecutionNav: executed[0].nav,
      latestT: latest.t,
      latestNav: latest.v,
      estimatedValue: units * latest.v
    };
  }

  /* Signed flows for the XIRR engine: money in is negative, money out and the
   * closing value are positive (section 9.1). */
  function flowsFrom(run, value, valueT) {
    var flows = run.executed.map(function (e) {
      return { t: e.t, amount: e.type === 'in' ? -e.amount : e.amount };
    });
    flows.push({ t: valueT, amount: value });
    return flows;
  }

  /* ------------------------------------------------------------ the reading
   *
   * input: {
   *   rows:         [{ t, type: 'in' | 'out', amount }]
   *   fundSeries:   [{ t, v }] ascending, cleaned
   *   proxySeries:  [{ t, v }] or null
   *   overrideValue: number or null   ("Value my app shows")
   *   asOfT:        milliseconds; used only for the staleness figure
   * }
   */
  function whereYouStand(input) {
    var rows = (input.rows || []).filter(function (r) {
      return r && isFinite(r.t) && isFinite(r.amount) && r.amount > 0 &&
             (r.type === 'in' || r.type === 'out');
    });
    if (!rows.length) return fail('XIRR-NEED-IN');
    if (!rows.some(function (r) { return r.type === 'in'; })) return fail('XIRR-NEED-IN');

    var fund = input.fundSeries || [];
    var run = execute(rows, fund);
    if (!run.ok) return run;

    /* --- a. value -------------------------------------------------------- */
    var override = isFinite(input.overrideValue) && input.overrideValue > 0
      ? input.overrideValue : null;
    var value = override != null ? override : run.estimatedValue;
    var valueT = run.latestT;
    var valueSource = override != null ? 'visitor' : 'estimated';

    /* --- b. personal XIRR ------------------------------------------------ */
    var personal = E.xirr(flowsFrom(run, value, valueT));

    /* The span every annualised reading is measured over: first execution NAV
     * date to the latest NAV date. */
    var spanDays = E.dayCount(run.firstExecutionT, run.latestT);

    /* --- c. the fund's own speed over the same span ----------------------- */
    var fundSpeed = E.pointToPoint(run.firstExecutionNav, run.latestNav,
                                   run.firstExecutionT, run.latestT);

    /* --- d. this stretch inside the fund's whole record ------------------- */
    var stretch = placeInRecord(fund, spanDays, fundSpeed.ok ? fundSpeed.rate : NaN);

    /* --- e, f. the investable alternative --------------------------------- */
    var alternative = againstProxy(input.proxySeries, rows, run, spanDays);

    var stale = staleFigure(fund, input.asOfT);

    return {
      ok: true,
      /* the figures the state evaluator reads, and nothing it does not */
      figures: {
        spanDays: spanDays,
        entries: run.executed.length,
        put: run.put,
        took: run.took,
        value: value,
        valueSource: valueSource,
        units: run.units,
        personalXirr: personal.ok ? personal.rate : NaN,
        fundSpeed: fundSpeed.ok ? fundSpeed.rate : NaN,
        /* Placement is an integer out of a hundred, never a decimal percentile:
         * a decimal invites a precision the data has not got and reads as a
         * score, while "higher than N of every 100" reads as a place. */
        placementOk: stretch.ok,
        placement: stretch.ok ? E.placeInHundred(fundSpeed.ok ? fundSpeed.rate : NaN, stretch.stats.values) : NaN,
        windows: stretch.ok ? stretch.count : 0,
        hasWithdrawals: rows.some(function (r) { return r.type === 'out'; }),
        proxyOk: alternative.ok,
        proxySpeed: alternative.ok ? alternative.speed : NaN,
        replayXirr: alternative.ok ? alternative.replayXirr : NaN,
        latestNavAgeDays: stale.ageDays
      },
      firstExecution: { t: run.firstExecutionT, nav: run.firstExecutionNav },
      latest: { t: run.latestT, nav: run.latestNav },
      flagged: run.flagged,
      executed: run.executed,
      personal: personal,
      fundSpeed: fundSpeed,
      stretch: stretch,
      alternative: alternative,
      stale: stale
    };
  }

  /* Section 7.2(d): the Module B engine with the window set to the visitor's
   * exact span in days, run across the fund's full history, and the fund's own
   * speed placed as a percentile among every same-length window. */
  function placeInRecord(series, spanDays, rate) {
    if (!(spanDays > 0) || !isFinite(rate)) return { ok: false, reason: 'no-span' };
    var historyDays = E.dayCount(series[0].t, series[series.length - 1].t);
    if (historyDays < spanDays + STRETCH_MIN_EXTRA_DAYS) {
      return { ok: false, reason: 'short-history', historyDays: historyDays,
               needDays: spanDays + STRETCH_MIN_EXTRA_DAYS };
    }
    var rolled = E.rolling(series, { days: spanDays });
    if (!rolled.ok) return { ok: false, reason: 'no-windows' };
    if (rolled.stats.count < STRETCH_MIN_WINDOWS) {
      return { ok: false, reason: 'few-windows', count: rolled.stats.count };
    }
    return {
      ok: true,
      percentile: E.percentileOf(rate, rolled.stats.values),
      count: rolled.stats.count,
      stats: rolled.stats,
      points: rolled.points
    };
  }

  /* Sections 7.2(e) and 7.2(f). The proxy has to actually cover the visitor's
   * span; a proxy younger than the holding is no comparison at all, and the
   * honest answer there is to show nothing (state S-ALT-NONE). */
  function againstProxy(proxySeries, rows, run, spanDays) {
    var proxy = proxySeries || [];
    if (proxy.length < 2) return { ok: false, reason: 'no-proxy' };
    var earliestRowT = rows.reduce(function (a, r) { return r.t < a ? r.t : a; }, rows[0].t);
    if (proxy[0].t > earliestRowT) return { ok: false, reason: 'proxy-too-young' };
    if (E.dayCount(proxy[proxy.length - 1].t, run.latestT) > EXECUTION_TOLERANCE_DAYS) {
      return { ok: false, reason: 'proxy-stale' };
    }

    var startHit = executionNav(proxy, run.firstExecutionT);
    if (!startHit.ok) return { ok: false, reason: 'proxy-gap' };
    var endNav = proxy[proxy.length - 1];

    /* e. point to point over the same span */
    var speed = E.pointToPoint(startHit.v, endNav.v, startHit.t, endNav.t);

    /* f. the same rupees, on the same dates, executed into the proxy */
    var replayRun = execute(rows, proxy);
    if (!replayRun.ok) return { ok: false, reason: replayRun.code };
    var replayValue = replayRun.units * replayRun.latestNav;
    var replay = E.xirr(flowsFrom(replayRun, replayValue, replayRun.latestT));

    if (!speed.ok || !replay.ok) return { ok: false, reason: 'proxy-no-solve' };

    return {
      ok: true,
      speed: speed.rate,
      replayXirr: replay.rate,
      replayValue: replayValue,
      replayUnits: replayRun.units,
      flagged: replayRun.flagged,
      spanDays: spanDays
    };
  }

  function staleFigure(series, asOfT) {
    if (!series.length || !isFinite(asOfT)) return { ageDays: NaN };
    return { ageDays: E.dayCount(series[series.length - 1].t, asOfT) };
  }

  /* The "repeat monthly x N" helper of section 7.1, expanded here so the web
   * table and any fixture agree on what it produces. */
  function repeatMonthly(startT, amount, count, type) {
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push({ t: E.addMonths(startT, i), amount: amount, type: type || 'in' });
    }
    return out;
  }

  var api = {
    EXECUTION_TOLERANCE_DAYS: EXECUTION_TOLERANCE_DAYS,
    STRETCH_MIN_WINDOWS: STRETCH_MIN_WINDOWS,
    STRETCH_MIN_EXTRA_DAYS: STRETCH_MIN_EXTRA_DAYS,
    executionNav: executionNav, execute: execute, whereYouStand: whereYouStand,
    placeInRecord: placeInRecord, againstProxy: againstProxy, repeatMonthly: repeatMonthly
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimPosition = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
