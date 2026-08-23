/* The Simulator - the state evaluator of section 7.3.
 *
 * A pure function from the figures Module A computed to a set of state IDs.
 * It reads no clock, makes no network call, and contains no randomness, so the
 * same figures always produce the same reading -- which is acceptance criterion
 * 9 ("twice in a row, on two different machines").
 *
 * It decides which sentence is shown. It never writes one: each state carries
 * the copy.json slot whose words are the author's (section 13).
 */
(function (root) {
  'use strict';

  var CONFIG = (typeof require === 'function')
    ? require('./states.json')
    : (root.SIM_STATES || null);

  /* Thresholds are stated in percentage points; the figures arrive as decimals. */
  function points(rate) { return rate * 100; }

  function evaluate(figures, override) {
    var cfg = override || CONFIG;
    var th = cfg.thresholds;
    var f = figures || {};

    var early = !(f.spanDays >= th.earlySpanDays);
    var stale = isFinite(f.latestNavAgeDays) && f.latestNavAgeDays > th.staleAfterDays;

    var report = early ? 'S-EARLY' : 'S-FULL';
    var fundStatus = stale ? 'S-STALE' : 'S-LIVE';

    /* Section 7.3: under S-EARLY the totals are still shown but every
     * annualised reading is suppressed, per the book's own short-period rule.
     * A suppressed section has no state, not a neutral one. */
    var gap = null, stretch = null, alternative = null;

    if (!early) {
      gap = gapState(f, th);
      stretch = stretchState(f, th);
      alternative = altState(f, th);
    }

    var active = [report, fundStatus, gap, stretch, alternative]
      .filter(function (s) { return s !== null; });

    return {
      early: early,
      suppressedAnnualised: early,
      states: {
        report: report,
        fundStatus: fundStatus,
        gap: gap,
        stretch: stretch,
        alternative: alternative
      },
      active: active,
      slots: active.map(function (id) { return slotFor(cfg, id); })
                   .filter(function (s) { return s !== null; }),
      nextSteps: nextSteps(cfg, active)
    };
  }

  function gapState(f, th) {
    if (!isFinite(f.personalXirr) || !isFinite(f.fundSpeed)) return 'S-GAP-NEUTRAL';
    var mine = points(f.personalXirr), fund = points(f.fundSpeed);
    if (mine <= fund - th.gapPoints) return 'S-GAP-BEHIND';
    if (mine >= fund + th.gapPoints) return 'S-GAP-AHEAD';
    return 'S-GAP-NEUTRAL';
  }

  function stretchState(f, th) {
    if (!f.stretchOk || !isFinite(f.percentile) || f.windows < th.stretchMinWindows) {
      return 'S-STRETCH-NA';
    }
    if (f.percentile <= th.stretchLowPercentile) return 'S-STRETCH-LOW';
    if (f.percentile >= th.stretchHighPercentile) return 'S-STRETCH-HIGH';
    return 'S-STRETCH-MID';
  }

  function altState(f, th) {
    if (!f.proxyOk || !isFinite(f.replayXirr) || !isFinite(f.personalXirr)) return 'S-ALT-NONE';
    var mine = points(f.personalXirr), replay = points(f.replayXirr);
    if (mine <= replay - th.altPoints) return 'S-ALT-BEHIND';
    if (mine >= replay + th.altPoints) return 'S-ALT-AHEAD';
    return 'S-ALT-CLOSE';
  }

  function slotFor(cfg, stateId) {
    for (var i = 0; i < cfg.sections.length; i++) {
      var list = cfg.sections[i].states;
      for (var k = 0; k < list.length; k++) {
        if (list[k].id === stateId) {
          return list[k].slot ? { state: stateId, section: cfg.sections[i].id, slot: list[k].slot,
                                  presentation: list[k].presentation || 'sentence' } : null;
        }
      }
    }
    return null;
  }

  /* Section 7.5: at most three next steps, collected in the order the sections
   * are evaluated, each one either an in-Simulator action or a book pointer. */
  function nextSteps(cfg, active) {
    var out = [], seen = {};
    for (var i = 0; i < active.length && out.length < cfg.maxNextSteps; i++) {
      var list = cfg.nextSteps[active[i]] || [];
      for (var k = 0; k < list.length && out.length < cfg.maxNextSteps; k++) {
        if (seen[list[k].id]) continue;
        seen[list[k].id] = true;
        out.push(list[k]);
      }
    }
    return out;
  }

  /* Every state the report can reach, so a fixture can assert the table is whole
   * and CI can check each one has a slot the author has filled. */
  function allStates(cfg) {
    var c = cfg || CONFIG, out = [];
    c.sections.forEach(function (s) {
      s.states.forEach(function (st) { out.push({ section: s.id, id: st.id, slot: st.slot }); });
    });
    return out;
  }

  var api = { config: CONFIG, evaluate: evaluate, allStates: allStates, slotFor: slotFor };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimStates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
