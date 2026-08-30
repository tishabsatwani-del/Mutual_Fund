/* Where You Stand — Tool 3, "My money in this fund".
 *
 * Review v3, section 4. The ledger for one fund, then the reading: four figures
 * landing in this order — your speed, the fund's speed over your dates, your
 * stretch in the fund's record, the same money in the index fund — then the
 * sentence, then the next step. That is the screen.
 *
 * Every sentence the reader sees comes from copy.json by slot id. Where a slot
 * is still unwritten the screen says so, by name, rather than inventing a
 * sentence or quietly printing nothing.
 */
(function () {
  'use strict';

  var W = window.WYS, E = window.SimEngines, S = window.SimSchemes,
      P = window.SimPosition, St = window.SimStates, LL = window.LifeLine;

  var $ = W.$, money = W.money, pct = W.pct, date = W.date, esc = W.esc, slot = W.slot;

  /* ------------------------------------------------------------ the state */
  var ST = { series: null, name: '', rows: [], proxy: null, proxyName: '' };

  /* ----------------------------------------------------------- the ledger */
  function drawRows() {
    var body = $('#rows');
    if (!ST.rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="gloss">No lines yet.</td></tr>';
    } else {
      body.innerHTML = ST.rows.slice()
        .sort(function (a, b) { return a.t - b.t; })
        .map(function (r, i) {
          return '<tr><td>' + date(r.t) + '</td><td>' +
            (r.type === 'out' ? 'Money out' : 'Money in') + '</td><td class="n">' +
            money(r.amount) + '</td><td class="n"><button class="linkish" data-drop="' + i +
            '" aria-label="Remove the line dated ' + date(r.t) + '">Remove</button></td></tr>';
        }).join('');
    }
    Array.prototype.forEach.call(body.querySelectorAll('[data-drop]'), function (b) {
      b.addEventListener('click', function () {
        var sorted = ST.rows.slice().sort(function (a, b2) { return a.t - b2.t; });
        var victim = sorted[+b.dataset.drop];
        ST.rows.splice(ST.rows.indexOf(victim), 1);
        drawRows(); refresh();
      });
    });
    refresh();
  }

  function refresh() {
    $('#run').disabled = !(ST.series && ST.rows.some(function (r) { return r.type === 'in'; }));
  }

  /* ---------------------------------------------------------- the reading */
  function show() {
    var asOf = ST.series[ST.series.length - 1].t;
    var worth = parseFloat($('#worth').value);
    var stood = P.whereYouStand({
      rows: ST.rows,
      fundSeries: ST.series,
      proxySeries: ST.proxy,
      overrideValue: isFinite(worth) && worth >= 0 ? worth : null,
      asOfT: asOf
    });

    if (!stood.ok) { refuse(stood); return; }
    var f = stood.figures;

    /* The two conditional readings the review asks for, both computed from the
     * reader's own purchases and nothing else. */
    var purchases = ST.rows.filter(function (r) { return r.type === 'in'; });
    f.dripFires = St.dripTriggers(purchases);
    f.recentLump = St.recentLump(purchases, asOf);
    f.fallingMarket = fallingMarket(ST.series, asOf);
    if (f.dripFires) {
      f.dripActual = f.personalXirr;
      f.dripEven = evenDripRate(purchases, ST.series, asOf);
    }
    var states = St.evaluate(f);

    /* The section already carries the screen's h1, so the fund is named beneath
     * it rather than as a second one: two h1s in one document leave a screen
     * reader with no top to the page. The span line carries the dates and the
     * count and nothing else. */
    var html = '<h2>' + esc(ST.name) + '</h2>';
    html += '<p class="gloss">' +
      date(stood.firstExecution.t) + ' to ' + date(stood.latest.t) + ' · ' +
      ST.rows.length + (ST.rows.length === 1 ? ' entry' : ' entries') + '</p>';

    /* ---- the reading -------------------------------------------------
     * Exactly one figure is large: the reader's own speed, wearing the marker,
     * with its unit inline beside it. The fund's speed, the placement and the
     * index-fund replay are ruled lines with their figures aligned right, so
     * the eye lands on the one number the screen exists for and then reads
     * down. The index fund's line and figure are the only slate on the page. */
    html += '<div class="reading" style="margin-top:1.5rem">';
    html += '<div class="hero"' + W.land(0) + '><p class="label">Your speed</p>' +
      '<p class="figure mine">' + pct(f.personalXirr) + '</p>' +
      (states.early ? '' : '<span class="unit">a year</span>') + '</div>';

    html += line('The fund over your dates', pct(f.fundSpeed), '', 1);
    html += f.placementOk
      ? line('Your stretch, placed', 'Higher than ' + f.placement + ' of 100', '', 2)
      : line('Your stretch, placed', '—', 'suppressed', 2,
             'Not enough history to place a stretch of your length.');
    html += f.proxyOk
      ? line('Index fund, same money', pct(f.replayXirr), 'theirs', 3)
      : line('Index fund, same money', '—', 'suppressed', 3,
             'No index fund is loaded to replay your dates into.');
    html += '</div>';

    /* ---- the life-line -------------------------------------------------
     * The fund's whole life in ink, the index fund beside it in slate, and the
     * reader's own stretch marked. The three names sit beneath the line, so
     * the reader reads along it rather than up into it. */
    html += lifeLineBlock(stood, f);

    /* ---- the sentence, then the next step ------------------------------
     *
     * Review v4 §10's two rules for whoever wires these:
     *
     *   a cell sentence and its next step are ONE slot, never split, so the
     *   next step is set immediately under its cell rather than at the foot of
     *   the screen;
     *
     *   and when two lines fire together, the CELL PRINTS FIRST and the extras
     *   follow as short lines, never merged into one paragraph.
     *
     * The two overrides sit above the cell, which is what they are for: under
     * a year no cell fires at all, and the withdrawals line qualifies every
     * comparison beneath it.
     *
     * The braces in her drafts are the engine's to fill. Every one is a
     * reading of the reader's own data, formatted by the one formatter. */
    var subs = {
      GAP:    W.pct(Math.abs(f.personalXirr - f.fundSpeed)).replace('%', ''),
      MONTHS: String(Math.max(1, Math.round(f.spanDays / 30.44))),
      YOURS:  W.pct(f.personalXirr),
      INDEX:  W.pct(f.replayXirr),
      DRIP:   W.pct(f.dripEven),
      AMOUNT: W.money(recentLumpAmount(purchases, asOf))
    };

    html += '<div class="section">';
    if (states.early) html += slot('POS-UNDER-A-YEAR', subs);
    if (f.hasWithdrawals) html += slot('POS-WITHDRAWALS', subs);
    /* the cell and its next step, as one thing */
    if (states.cellSlot) html += slot(states.cellSlot, subs);
    if (states.nextSlot) html += slot(states.nextSlot, subs, 'next-step');
    /* then the extras, each its own short line */
    if (states.replay) html += slot(replaySlot(states.replay), subs, 'extra');
    if (states.drip) html += slot(dripSlot(states.drip), subs, 'extra');
    if (f.fallingMarket) html += slot('POS-FALLING-MARKET', subs, 'extra');
    if (f.recentLump) html += slot('POS-RECENT-LUMP', subs, 'extra');
    html += '</div>';

    /* ---- the money, plainly -------------------------------------------- */
    html += '<div class="section"><p class="label">Your money</p>' +
      '<div class="scroller"><table class="ledger"><tbody>' +
      '<tr><td>Put in</td><td class="n">' + money(f.put) + '</td></tr>' +
      '<tr><td>Taken out</td><td class="n">' + (f.took ? money(f.took) : '—') + '</td></tr>' +
      '<tr><td>Worth ' + (f.valueSource === 'visitor' ? 'as you entered it' :
        'at the latest NAV') + '</td><td class="n">' + money(f.value) + '</td></tr>' +
      '</tbody></table></div></div>';

    $('#reading').innerHTML = html;
    $('#step-reading').hidden = false;
    $('#step-fund').hidden = true;
    $('#step-ledger').hidden = true;
    animate();
    window.scrollTo(0, 0);
  }

  /* A ruled line: what it is on the left, the figure aligned right. A figure
   * the tool will not give keeps its line, at less weight, with a true em dash
   * and one sentence saying why — the tool declining to guess is part of its
   * character, not an error. */
  function line(what, value, tone, i, why, under) {
    return '<div class="line ' + tone + '"' + W.land(i) + '>' +
      '<div class="what">' + what +
      (why ? '<br><span class="gloss">' + why + '</span>' : '') +
      (under ? '<br><span class="gloss">' + under + '</span>' : '') + '</div>' +
      '<div class="val">' + value + '</div></div>';
  }

  function lifeLineBlock(stood, f) {
    var marks = [];
    if (stood.stretch && stood.stretch.ok) {
      marks.push({ t: stood.stretch.stats.worst.startT, text: 'worst', rowLabel: 'The worst stretch of your length began' });
      marks.push({ t: stood.stretch.stats.best.startT, text: 'best', rowLabel: 'The best began' });
    }
    var svg = LL.render({
      series: ST.series,
      compare: ST.proxy,
      stretch: { from: stood.firstExecution.t, to: stood.latest.t },
      marks: marks,
      describe: 'The whole recorded life of ' + ST.name + ', from ' + date(ST.series[0].t) + ' to ' +
        date(ST.series[ST.series.length - 1].t) + ', with your own stretch marked from ' +
        date(stood.firstExecution.t) + ' to ' + date(stood.latest.t) + '.'
    });
    var rows = LL.tableRows({ series: ST.series, stretch: { from: stood.firstExecution.t, to: stood.latest.t },
      marks: marks, fmtDate: date });
    return '<div class="section"><p class="label">This fund’s whole life, and your stretch of it</p>' +
      svg +
      '<details style="margin-top:.75rem"><summary class="linkish" style="padding:.4rem 0">Read it as dates</summary>' +
      '<div class="scroller"><table class="ledger"><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td class="n">' + esc(r[1]) + '</td></tr>'; }).join('') +
      '</tbody></table></div></details></div>';
  }

  function replaySlot(id) {
    return { 'S-REPLAY-BEHIND': 'POS-REPLAY-BEHIND', 'S-REPLAY-CLOSE': 'POS-REPLAY-CLOSE',
             'S-REPLAY-AHEAD': 'POS-REPLAY-AHEAD' }[id];
  }
  function dripSlot(id) {
    return { 'S-DRIP-HELPED': 'POS-DRIP-HELPED', 'S-DRIP-COST': 'POS-DRIP-COST' }[id];
  }

  /* Which purchase set the recent-lump line off, in rupees. states.js answers
   * whether it fired; the sentence needs the amount that fired it. */
  function recentLumpAmount(purchases, asOfT) {
    var cutoff = asOfT - 12 * 30.44 * 86400000, biggest = 0;
    (purchases || []).forEach(function (r) {
      if (r.t >= cutoff && r.amount > biggest) biggest = r.amount;
    });
    return biggest;
  }

  /* The latest NAV against the NAV twelve months earlier. */
  function fallingMarket(series, asOfT) {
    var year = asOfT - 365 * 86400000, prior = null;
    for (var i = 0; i < series.length; i++) { if (series[i].t <= year) prior = series[i]; else break; }
    return !!(prior && series[series.length - 1].v < prior.v);
  }

  /* The same total, dripped evenly across the same span, in the SAME fund, and
   * the yearly rate that drip would have earned. Review v4 §10 lines 15 and 16
   * are written in points a year against the reader's own rate, so a rupee
   * total is the wrong figure to hand them.
   *
   * It is a comparison and never something that happened, which is what the
   * author's own sentence says out loud. */
  function evenDripRate(purchases, series, asOfT) {
    if (!purchases.length) return NaN;
    var total = purchases.reduce(function (s, r) { return s + r.amount; }, 0);
    var from = Math.min.apply(null, purchases.map(function (r) { return r.t; }));
    var to = Math.max.apply(null, purchases.map(function (r) { return r.t; }));
    var months = Math.max(1, Math.round((to - from) / (30.44 * 86400000)) + 1);
    var each = total / months, rows = [];
    for (var i = 0; i < months; i++) rows.push({ t: E.addMonths(from, i), amount: each, type: 'in' });
    var run = P.execute(rows, series);
    if (!run.ok) return NaN;
    var worth = run.units * series[series.length - 1].v;
    var flows = run.executed.map(function (e) { return { t: e.t, amount: -e.amount }; });
    flows.push({ t: asOfT, amount: worth });
    var solved = E.xirr(flows);
    return solved.ok ? solved.rate : NaN;
  }

  /* A refusal is set exactly like a reading: serif sentence, hairline, next
   * step. Never a red box with an exclamation mark. */
  function refuse(bad) {
    var lines = {
      'POS-ROW-BEFORE-FUND': 'One line is dated before this fund had a price. There is nothing to buy at, on that day.',
      'POS-UNITS-NEGATIVE': 'The money out adds up to more than the money in, so the units go below zero. One of the lines needs a look.',
      'XIRR-NEED-IN': 'Add at least one line of money going in.',
      'POS-NO-SERIES': 'This fund’s history has not loaded.',
      'POS-NO-ROWS-EXECUTED': 'None of these lines could be matched to a price within seven days.'
    };
    $('#reading').innerHTML = '<div class="refusal"><p>' +
      esc(lines[bad.code] || 'This cannot be worked out from what is entered.') + '</p>' +
      (bad.date ? '<p class="gloss">The line dated ' + esc(bad.date) + '.</p>' : '') +
      '<button class="linkish" id="fix" type="button">Go back to the ledger</button></div>';
    $('#step-reading').hidden = false;
    $('#step-ledger').hidden = false;
    var fix = $('#fix');
    if (fix) fix.addEventListener('click', function () {
      $('#step-reading').hidden = true;
      $('#step-ledger').scrollIntoView();
    });
  }

  /* The life-line draws once, left to right. */
  function animate() {
    var svg = $('.lifeline');
    if (!svg) return;
    var life = svg.querySelector('.ll-life');
    if (!life || !life.getTotalLength) return;
    try {
      svg.style.setProperty('--len', life.getTotalLength());
      svg.classList.add('drawing');
    } catch (e) { /* a browser that cannot measure simply shows it drawn */ }
  }

  /* ------------------------------------------------------------- the data */
  function loadSeries(series, name) {
    ST.series = series; ST.name = name;
    $('#fund-state').textContent = 'Found ' + W.count(series.length) + ' NAVs for ' + name +
      ', ' + W.span(series[0].t, series[series.length - 1].t) + '.';
    $('#step-ledger').hidden = false;
    refresh();
  }

  function init() {
    drawRows();
    $('#use-file').addEventListener('click', function () { $('#file').click(); });
    $('#index-open').addEventListener('click', function () { $('#index-file').click(); });
    $('#index-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      W.readFile(f).then(function (r) {
        ST.proxy = r.series; ST.proxyName = r.name;
        $('#index-state').textContent = r.name + ' · loaded';
      }).catch(function (err) { $('#index-state').textContent = err.message; });
    });
    $('#file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var parsed = window.PRCParse.parseSeriesText(String(reader.result));
        if (!parsed.ok) { $('#fund-state').textContent = parsed.message; return; }
        loadSeries(parsed.series, f.name.replace(/\.[^.]+$/, ''));
      };
      reader.readAsText(f);
    });

    $('#add').addEventListener('click', function () {
      var t = prompt('Date, as YYYY-MM-DD');
      var a = prompt('Amount');
      var ts = S.parseDate(t);
      if (isFinite(ts) && +a > 0) { ST.rows.push({ t: ts, amount: +a, type: 'in' }); drawRows(); }
    });
    $('#sip').addEventListener('click', function () {
      var box = $('#sip-box'); box.hidden = !box.hidden;
    });
    $('#sip-add').addEventListener('click', function () {
      var from = S.parseDate($('#sip-from').value), amt = +$('#sip-amt').value,
          n = Math.min(600, Math.max(1, Math.floor(+$('#sip-n').value)));
      if (!isFinite(from) || !(amt > 0) || !(n > 0)) return;
      for (var i = 0; i < n; i++) ST.rows.push({ t: E.addMonths(from, i), amount: amt, type: 'in' });
      $('#sip-box').hidden = true; drawRows();
    });
    /* "Try an example" writes a plausible run of instalments across whatever
     * history is loaded, so the reader can see a reading before trusting the
     * tool with their own figures. It is their fund, not an invented one. */
    $('#example').addEventListener('click', function () {
      if (!ST.series) { $('#fund-state').textContent = 'Load a fund first.'; return; }
      var last = ST.series[ST.series.length - 1].t;
      var start = E.addMonths(last, -60);
      if (start < ST.series[0].t) start = ST.series[0].t;
      ST.rows = [];
      for (var i = 0; i < 60; i++) {
        var t = E.addMonths(start, i);
        if (t > last) break;
        ST.rows.push({ t: t, amount: 10000, type: 'in' });
      }
      drawRows();
    });
    $('#clear').addEventListener('click', function () { ST.rows = []; drawRows(); });
    $('#run').addEventListener('click', show);
  }

  /* Coming back to this tool from elsewhere returns it to its ledger, not to
     a stale reading of somebody else's numbers. */
  W.view('stand', {
    enter: function () {
      if (!ST.series) { $('#step-ledger').hidden = true; $('#step-reading').hidden = true; }
    }
  });

  window.WhereYouStand = { state: ST, loadSeries: loadSeries, show: show, init: init };
})();
