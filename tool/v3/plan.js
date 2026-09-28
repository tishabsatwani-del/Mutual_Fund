/* Where You Stand — Tool 4, "My plan, tested".
 *
 * Review v3, section 4. Five inputs — what you have, how much a month, the
 * step-up if there is one, how many years, and how much is needed — tested at
 * rates taken from a real fund's OWN record rather than at one assumed number.
 *
 * That is the whole difference. Every goal calculator in the market asks the
 * reader to type a rate, and the rate they type is the rate they hope for. This
 * one takes the worst, the typical and the best window of exactly their length
 * out of a fund's published history and lands the same plan three times. The
 * worst goes first and largest, because the worst stretch is the one a plan has
 * to survive; the best is printed last and small, because it is the one figure
 * a reader will otherwise plan around.
 *
 * Two levers, both the reader's own: the monthly amount that arrives at the
 * typical rate, and the years the worst rate would add. Never a third. A third
 * lever is always either "pick a better fund" or "need less", and neither is
 * something a calculator gets to say.
 */
(function (root) {
  'use strict';

  var W = root.WYS, E = root.SimEngines, S = root.SimSchemes;
  var $ = W.$, money = W.money, pct = W.pct, date = W.date, esc = W.esc;

  var P = { series: null, name: '' };

  function spanYears(series) {
    return (series[series.length - 1].t - series[0].t) / (365.2425 * 86400000);
  }

  function plan() {
    var years = Math.floor(parseFloat($('#p-years').value));
    return {
      have: parseFloat($('#p-have').value) || 0,
      monthly: parseFloat($('#p-monthly').value) || 0,
      stepUp: (parseFloat($('#p-step').value) || 0) / 100,
      years: years,
      needed: parseFloat($('#p-needed').value)
    };
  }

  function ready(p) {
    return isFinite(p.years) && p.years >= 1 && p.years <= 40 &&
           isFinite(p.needed) && p.needed > 0 && (p.have > 0 || p.monthly > 0);
  }

  /* ------------------------------------------------------------- the fund
   * A fund loaded in any of the four tools is the fund here too. One search,
   * one file, one data layer: a reader who has already found their fund on
   * another screen should not have to find it again. */
  function borrowed() {
    var r = root.WYSRecord && root.WYSRecord.state;
    if (r && r.series) return { series: r.series, name: r.name };
    var s = root.WhereYouStand && root.WhereYouStand.state;
    if (s && s.series) return { series: s.series, name: s.name };
    return null;
  }

  function fundNow() {
    if (P.series) return P;
    return borrowed();
  }

  function drawFund() {
    var f = fundNow();
    $('#p-fund-state').textContent = f
      ? 'Found ' + W.count(f.series.length) + ' NAVs for ' + f.name + ', ' +
        W.span(f.series[0].t, f.series[f.series.length - 1].t) + '.'
      : '';
    $('#p-suppose').hidden = !!f;
  }

  /* --------------------------------------------------------- the three rates
   * The window is the reader's own horizon. Where the history cannot reach
   * that far the longest it CAN give is used, and the screen says so in one
   * line rather than quietly measuring something shorter. */
  function rates(p) {
    var f = fundNow();
    if (!f) {
      var supposed = parseFloat($('#p-rate').value);
      if (!isFinite(supposed)) return { ok: false, code: 'NO-RATE' };
      return { ok: true, source: 'supposed', rate: supposed / 100 };
    }
    var span = spanYears(f.series);
    var length = Math.min(p.years, Math.floor(span));
    if (length < 1) {
      return { ok: false, code: 'TOO-SHORT', name: f.name, span: span, wanted: p.years };
    }
    var rolled = E.rolling(f.series, { years: length });
    if (!rolled.ok) return { ok: false, code: 'TOO-SHORT', name: f.name, span: span, wanted: p.years };
    var s = rolled.stats;
    return {
      ok: true, source: 'fund', name: f.name, length: length, wanted: p.years,
      short: length < p.years, span: span,
      worst: s.worst.r, typical: s.median, best: s.best.r,
      worstFrom: s.worst.startT, bestFrom: s.best.startT, count: s.count
    };
  }

  /* ------------------------------------------------------------ the reading */
  function run() {
    var p = plan(), out = $('#p-out');
    if (!ready(p)) { out.innerHTML = ''; return; }

    var r = rates(p);
    if (!r.ok) {
      if (r.code === 'TOO-SHORT') {
        out.innerHTML = '<div class="refusal"><p>' + esc(r.name) + ' has ' + r.span.toFixed(1) +
          ' years of published prices, and this plan runs ' + r.wanted +
          '. There is not one full window of any whole year to test it against.</p>' +
          W.slot('PLAN-TOO-SHORT') + '</div>';
      } else {
        out.innerHTML = '';
      }
      return;
    }

    var html = '';

    if (r.source === 'supposed') {
      /* No fund, one rate, and the screen says out loud that the number came
       * from the reader and not from anything that happened. */
      html += '<div class="refusal"><p>This is tested at ' + pct(r.rate) +
        ' a year because that is what you typed. No fund is loaded, so nothing here has been ' +
        'measured against a market that actually happened.</p>' + W.slot('PLAN-NO-FUND') + '</div>';
      html += landings(p, [
        { label: 'At ' + pct(r.rate) + ' a year', rate: r.rate, hero: true, i: 0 }
      ]);
      html += levers(p, r.rate, r.rate);
      $('#p-out').innerHTML = html;
      return;
    }

    if (r.short) {
      html += '<div class="refusal"><p>' + esc(r.name) + ' has ' + r.span.toFixed(1) +
        ' years of published prices, so this plan of ' + r.wanted + ' years is tested against its ' +
        r.length + '-year windows — the longest it can give.</p>' + W.slot('PLAN-TOO-SHORT') + '</div>';
    }

    html += '<p class="label">' + esc(r.name) + ' · every ' + r.length + '-year window it has had</p>';
    html += landings(p, [
      { label: 'At its worst ' + r.length + ' years', rate: r.worst, hero: true, i: 0 },
      { label: 'At its typical ' + r.length + ' years', rate: r.typical, i: 1 },
      { label: 'At its best ' + r.length + ' years', rate: r.best, i: 2 }
    ]);

    html += '<div class="section"><p class="label">Where these three rates come from</p>' +
      '<div class="scroller"><table class="ledger"><tbody>' +
      '<tr><td>Worst window, from ' + date(r.worstFrom) + '</td><td class="n">' + pct(r.worst) + '</td></tr>' +
      '<tr><td>Typical of all of them</td><td class="n">' + pct(r.typical) + '</td></tr>' +
      '<tr><td>Best window, from ' + date(r.bestFrom) + '</td><td class="n">' + pct(r.best) + '</td></tr>' +
      '</tbody></table></div>' +
      '<p class="gloss">' + W.count(r.count) + ' window' + (r.count === 1 ? '' : 's') +
      ' of ' + r.length + ' year' + (r.length === 1 ? '' : 's') +
      ', one for every day this fund published a price.</p></div>';

    /* When a history is barely longer than the window, every start date sits on
     * top of every other and the worst, the typical and the best come out as
     * one number. Three identical landings look like a broken screen, so the
     * screen says what happened. The trigger is the fact itself -- the three
     * printing the same -- and not a threshold anyone had to choose. */
    if (pct(r.worst) === pct(r.best)) {
      html += '<div class="refusal"><p>' + esc(r.name) + ' gives ' + W.count(r.count) +
        ' window' + (r.count === 1 ? '' : 's') + ' of ' + r.length + ' year' +
        (r.length === 1 ? '' : 's') + ', and the worst, the typical and the best of them all come ' +
        'to ' + pct(r.worst) + ' a year. There is no spread here to test a plan against.</p>' +
        W.slot('RR-FEW-WINDOWS') + '</div>';
    }

    html += levers(p, r.typical, r.worst);

    out.innerHTML = html;
  }

  /* Where the same plan lands at each rate, and the gap at each. The worst is
   * the hero: it is the landing the plan has to survive. */
  function landings(p, list) {
    var html = '<div class="reading" id="p-landings" style="margin-top:1rem">';
    list.forEach(function (item, k) {
      var l = E.landing(p, item.rate);
      var gap = l.gap > 0
        ? 'short of ' + money(l.gap)
        : 'over by ' + money(-l.gap);
      if (item.hero) {
        /* A rupee figure is eight or nine glyphs where a percentage is four, so
         * it takes its own size. The gap goes underneath rather than inline:
         * "over by ₹8,05,822" is a phrase, not a unit. */
        html += '<div class="hero"' + W.land(item.i) + '><p class="label">' + esc(item.label) +
          ' · ' + pct(item.rate) + ' a year</p>' +
          '<p class="figure mine money">' + money(l.lands) + '</p>' +
          '<p class="gloss">' + gap + '</p></div>';
      } else {
        html += '<div class="line"' + W.land(item.i) + '><div class="what">' + esc(item.label) +
          '<br><span class="gloss">' + pct(item.rate) + ' a year · ' + gap + '</span></div>' +
          '<div class="val">' + money(l.lands) + '</div></div>';
      }
    });
    html += '</div>';
    return html;
  }

  /* TWO levers. Both are things the reader controls, and both are printed as
   * arithmetic on their own plan. There is deliberately no third: the only
   * others a calculator could offer are "find a better fund" and "need less",
   * and neither is a calculation. */
  function levers(p, typical, worst) {
    var atTypical = E.landing(p, typical);
    var need = atTypical.monthlyToArrive;
    var addYears = E.yearsToArrive(p, worst);

    var arrives = need > p.monthly;
    var first = !isFinite(need) ? '—' : money(arrives ? need : p.monthly);
    var firstGloss = !isFinite(need)
      ? 'this plan has no monthly amount to raise'
      : arrives
        ? money(need - p.monthly) + ' more a month than the ' + money(p.monthly) + ' above'
        : 'what you already pay · the plan arrives at this rate as it stands';

    var second, secondGloss;
    if (!isFinite(addYears)) {
      second = '—';
      secondGloss = 'at that rate this plan does not reach ' + money(p.needed) +
        ' inside sixty years';
    } else if (addYears <= p.years) {
      second = 'none';
      secondGloss = 'the worst window still arrives inside your ' + p.years + ' years';
    } else {
      second = (addYears - p.years).toFixed(1) + ' years';
      secondGloss = p.years + ' years becomes ' + addYears.toFixed(1) + ' at ' + pct(worst) + ' a year';
    }

    return '<div class="section" id="p-levers"><p class="label">What would close it</p>' +
      '<div class="line"><div class="what">The monthly amount that arrives, at the typical rate' +
      '<br><span class="gloss">' + firstGloss + '</span></div>' +
      '<div class="val">' + first + '</div></div>' +
      '<div class="line"><div class="what">The years the worst rate would add' +
      '<br><span class="gloss">' + secondGloss + '</span></div>' +
      '<div class="val">' + second + '</div></div></div>';
  }

  /* ---------------------------------------------------------------- wiring */
  function init() {
    ['p-have', 'p-monthly', 'p-step', 'p-years', 'p-needed', 'p-rate'].forEach(function (id) {
      $('#' + id).addEventListener('input', run);
    });
    W.door({ openId: 'p-file-open', fileId: 'p-file', stateId: 'p-fund-state',
             onLoad: function (series, name) { P.series = series; P.name = name; drawFund(); run(); } });
    drawFund();
  }

  W.view('plan', { enter: function () { drawFund(); run(); } });

  root.WYSPlan = { state: P, init: init, run: run, rates: rates, plan: plan };
})(typeof globalThis !== 'undefined' ? globalThis : this);
