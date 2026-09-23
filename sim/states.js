/* Where You Stand — the state evaluator.
 *
 * A pure function from the figures the engine computed to the set of state ids
 * that fire. No clock, no network, no randomness: the same figures produce the
 * same reading today and in ten years, which is the promise the About paragraph
 * makes on the product's behalf.
 *
 * It decides which sentence is shown. It never writes one. Every state names a
 * slot in copy.json and nothing else.
 *
 * The thresholds live in states.json and were signed off on 30 August 2026.
 * Each sentence in the deck was written to be true at its own band, so moving a
 * threshold silently makes a sentence false. Move one only on purpose.
 */
(function (root) {
  'use strict';

  var CONFIG = (typeof require === 'function') ? require('./states.json') : (root.SIM_STATES || null);

  function points(rate) { return rate * 100; }

  /* ------------------------------------------------- Tool 3, the nine cells
   *
   * Axis one: the reader's own speed against the fund's speed over the reader's
   * exact dates, at the half-point band.
   * Axis two: where that stretch sits among every window of the same length in
   * days, at the quartiles.
   */
  function gapAxis(mine, fund, band) {
    if (!isFinite(mine) || !isFinite(fund)) return null;
    var a = points(mine), b = points(fund);
    if (a <= b - band) return 'LOWER';
    if (a >= b + band) return 'HIGHER';
    return 'SIMILAR';
  }

  function placementAxis(place, low, high) {
    if (!isFinite(place)) return null;
    if (place <= low) return 'BOTTOM';
    if (place >= high) return 'TOP';
    return 'MIDDLE';
  }

  function cellFor(cfg, gap, place) {
    var cells = cfg.tools.myMoneyInThisFund.cells;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].gap === gap && cells[i].placement === place) return cells[i];
    }
    return null;
  }

  /* input: the figures Module A computed. Everything is a plain number or a
   * boolean; nothing here reaches for anything it was not handed. */
  function evaluate(figures, override) {
    var cfg = override || CONFIG;
    var t = cfg.thresholds;
    var tool = cfg.tools.myMoneyInThisFund;
    var f = figures || {};
    var fired = [], slots = [];

    function fire(id, slot) {
      if (!id) return;
      fired.push(id);
      if (slot) slots.push({ state: id, slot: slot });
    }

    /* Under a year the yearly rate is withheld and no cell fires. The book's
     * own rule: a rate on seven months is a stretch, and a stretched number is
     * worse than no number. */
    var early = !(f.spanDays >= t.earlySpanDays);
    if (early) {
      fire('S-UNDER-A-YEAR', tool.overrides[0].slot);
    }

    /* Money out changes what the figures mean, so it is said above the cell —
     * and the cell still fires. */
    if (f.hasWithdrawals) fire('S-WITHDRAWALS', tool.overrides[1].slot);

    var cell = null;
    if (!early) {
      var gap = gapAxis(f.personalXirr, f.fundSpeed, t.similarPoints);
      var place = f.placementOk
        ? placementAxis(f.placement, t.placementLowPercentile, t.placementHighPercentile)
        : null;
      if (gap && place) {
        cell = cellFor(cfg, gap, place);
        if (cell) { fire(cell.id, cell.slot); slots.push({ state: cell.id, slot: cell.nextSlot, kind: 'next' }); }
      }
    }

    /* The replay: the same rupees, on the same dates, in the index fund the
     * reader could actually have bought. One point either way is "close". */
    var replay = null;
    if (!early && f.replayOk && isFinite(f.replayXirr) && isFinite(f.personalXirr)) {
      var mine = points(f.personalXirr), rep = points(f.replayXirr);
      replay = mine <= rep - t.comparisonPoints ? tool.replay[0]
             : mine >= rep + t.comparisonPoints ? tool.replay[2]
             : tool.replay[1];
      fire(replay.id, replay.slot);
    }

    /* The even-drip twin fires only when the reader's own dates carry a story.
     * Otherwise it prints nothing, which is the point: it exists to separate
     * what the fund did from what the reader's timing did, and when the timing
     * was unremarkable there is nothing to separate. */
    var drip = null;
    if (!early && f.dripFires && isFinite(f.dripActual) && isFinite(f.dripEven)) {
      drip = f.dripActual >= f.dripEven ? tool.drip.lines[0] : tool.drip.lines[1];
      fire(drip.id, drip.slot);
    }

    if (f.fallingMarket) fire(tool.extra[0].id, tool.extra[0].slot);
    if (f.recentLump) fire(tool.extra[1].id, tool.extra[1].slot);

    return {
      early: early,
      cell: cell ? cell.id : null,
      cellSlot: cell ? cell.slot : null,
      nextSlot: cell ? cell.nextSlot : null,
      replay: replay ? replay.id : null,
      drip: drip ? drip.id : null,
      fired: fired,
      slots: slots
    };
  }

  /* Does the reader's own timing deserve the even-drip twin? Purchases only,
   * and only when one is more than three times the median instalment or a gap
   * runs longer than two months. */
  function dripTriggers(purchases, override) {
    var t = (override || CONFIG).thresholds;
    var rows = (purchases || []).slice().sort(function (a, b) { return a.t - b.t; });
    if (rows.length < 3) return false;
    var amounts = rows.map(function (r) { return r.amount; }).sort(function (a, b) { return a - b; });
    var median = amounts[Math.floor(amounts.length / 2)];
    if (median > 0 && amounts[amounts.length - 1] > median * t.dripLumpMultiple) return true;
    for (var i = 1; i < rows.length; i++) {
      var months = (rows[i].t - rows[i - 1].t) / (30.44 * 86400000);
      if (months > t.dripGapMonths) return true;
    }
    return false;
  }

  /* A single purchase inside the last twelve months worth 40% or more of every
   * rupee put in. It drags the yearly rate down for reasons that have nothing
   * to do with the fund, so the reader is told before they read the figure. */
  function recentLump(purchases, asOfT, override) {
    var t = (override || CONFIG).thresholds;
    var rows = purchases || [];
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
    if (!(total > 0)) return false;
    var cutoff = asOfT - t.recentLumpMonths * 30.44 * 86400000;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].t >= cutoff && rows[i].amount / total >= t.recentLumpShare) return true;
    }
    return false;
  }

  /* Tool 2's one state line on the comparison, at one point. */
  function worstAgainstIndex(fundWorst, indexWorst, override) {
    var cfg = override || CONFIG, band = cfg.thresholds.comparisonPoints;
    if (!isFinite(fundWorst) || !isFinite(indexWorst)) return null;
    var a = points(fundWorst), b = points(indexWorst);
    var list = cfg.tools.thisFundsRecord.comparison;
    if (a >= b + band) return list[0];
    if (a <= b - band) return list[2];
    return list[1];
  }

  /* Every slot the code can ask the deck for, so CI can prove the deck covers
   * the code and the author can see what is still unwritten. */
  function allSlots(override) {
    var cfg = override || CONFIG, out = [];
    var t3 = cfg.tools.myMoneyInThisFund;
    t3.cells.forEach(function (c) { out.push(c.slot); out.push(c.nextSlot); });
    t3.overrides.forEach(function (o) { out.push(o.slot); });
    t3.replay.forEach(function (r) { out.push(r.slot); });
    t3.drip.lines.forEach(function (d) { out.push(d.slot); });
    t3.extra.forEach(function (e) { out.push(e.slot); });
    cfg.tools.thisFundsRecord.comparison.forEach(function (c) { out.push(c.slot); });
    cfg.tools.thisFundsRecord.guards.forEach(function (g) { out.push(g.slot); });
    return out;
  }

  var api = {
    config: CONFIG, evaluate: evaluate, allSlots: allSlots,
    gapAxis: gapAxis, placementAxis: placementAxis,
    dripTriggers: dripTriggers, recentLump: recentLump, worstAgainstIndex: worstAgainstIndex
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimStates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
