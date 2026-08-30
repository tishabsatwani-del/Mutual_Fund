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

  var E = window.SimEngines, S = window.SimSchemes, P = window.SimPosition,
      St = window.SimStates, COPY = window.SIM_COPY, LL = window.LifeLine;

  var $ = function (s) { return document.querySelector(s); };
  var inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function money(n) { return '₹' + inr.format(Math.round(n)); }
  /* A true minus, not a hyphen, and the percent sign closed up. */
  function pct(r) {
    if (!isFinite(r)) return '—';
    var v = (r * 100).toFixed(1);
    return (v.charAt(0) === '-' ? '−' + v.slice(1) : v) + '%';
  }
  function date(t) {
    var d = new Date(t);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  /* A slot the author has not written yet is named on screen, not hidden. A
   * blank where a sentence belongs looks like a bug; a named empty slot looks
   * like what it is, and it tells whoever is reviewing exactly what to send. */
  function slot(id) {
    var s = COPY.slots[id];
    if (s && s.text) return '<p class="sentence">' + esc(s.text) + '</p>';
    return '<p class="slot-empty">Awaiting copy slot <code>' + esc(id) + '</code></p>';
  }

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
      var drip = evenDrip(purchases, ST.series, asOf);
      f.dripActual = f.value;
      f.dripEven = drip;
    }
    var states = St.evaluate(f);

    /* The header already names the product, so the page heading names the fund.
     * The span line carries the dates and the count and nothing else. */
    var html = '<h1>' + esc(ST.name) + '</h1>';
    html += '<p class="gloss">' +
      date(stood.firstExecution.t) + ' to ' + date(stood.latest.t) + ' · ' +
      ST.rows.length + (ST.rows.length === 1 ? ' entry' : ' entries') + '</p>';

    /* ---- the four figures, in reading order --------------------------- */
    html += '<div class="reading" style="margin-top:1.5rem">';
    html += row('Your speed', pct(f.personalXirr), 'mine', 0,
      states.early ? null : 'a year');
    html += row('The fund’s speed over your dates', pct(f.fundSpeed), '', 1, 'a year');
    html += f.placementOk
      ? row('Your stretch in this fund’s record',
            'Higher than <b>' + f.placement + '</b> of every 100', 'placement', 2,
            'stretches of your length')
      : suppressed('Your stretch in this fund’s record', 2,
            'This history is not long enough to place a stretch of your length inside it.');
    html += f.proxyOk
      ? row('The same money in the index fund', pct(f.replayXirr), 'theirs', 3, esc(ST.proxyName))
      : suppressed('The same money in the index fund', 3,
            'No index fund is loaded to replay your dates into.');
    html += '</div>';

    /* ---- the life-line ------------------------------------------------- */
    html += lifeLineBlock(stood, f);

    /* ---- the sentence, then the next step ------------------------------ */
    html += '<div class="section">';
    if (states.early) html += slot('POS-UNDER-A-YEAR');
    if (f.hasWithdrawals) html += slot('POS-WITHDRAWALS');
    if (states.cellSlot) html += slot(states.cellSlot);
    if (states.replay) html += slot(replaySlot(states.replay));
    if (states.drip) html += slot(dripSlot(states.drip));
    if (f.fallingMarket) html += slot('POS-FALLING-MARKET');
    if (f.recentLump) html += slot('POS-RECENT-LUMP');
    if (states.nextSlot) html += slot(states.nextSlot);
    html += '</div>';

    /* ---- the money, plainly -------------------------------------------- */
    html += '<div class="section"><p class="label">Your money</p>' +
      '<table class="ledger"><tbody>' +
      '<tr><td>Put in</td><td class="n">' + money(f.put) + '</td></tr>' +
      '<tr><td>Taken out</td><td class="n">' + (f.took ? money(f.took) : '—') + '</td></tr>' +
      '<tr><td>Worth ' + (f.valueSource === 'visitor' ? 'today, as you entered it' :
        'at the latest NAV') + '</td><td class="n">' + money(f.value) + '</td></tr>' +
      '</tbody></table></div>';

    $('#reading').innerHTML = html;
    $('#step-reading').hidden = false;
    $('#step-fund').hidden = true;
    $('#step-ledger').hidden = true;
    $('#back').hidden = false;
    animate();
    window.scrollTo(0, 0);
  }

  /* A figure the tool will not give. The row is kept, so the reader can see
   * that the question was asked and answered honestly, rather than wondering
   * where the fourth reading went. */
  function suppressed(label, i, why) {
    return '<div class="row suppressed land" style="animation-delay:' + (i * 250) + 'ms">' +
      '<p class="label">' + label + '</p>' +
      '<p class="figure">—</p>' +
      '<p class="gloss">' + why + '</p></div>';
  }

  function row(label, value, tone, i, gloss) {
    return '<div class="row land" style="animation-delay:' + (i * 250) + 'ms">' +
      '<p class="label">' + label + '</p>' +
      '<p class="figure ' + tone + '">' + value + '</p>' +
      (gloss ? '<p class="gloss">' + gloss + '</p>' : '') + '</div>';
  }

  function lifeLineBlock(stood, f) {
    var marks = [];
    if (stood.stretch && stood.stretch.ok) {
      marks.push({ t: stood.stretch.stats.worst.startT, text: 'worst', rowLabel: 'Worst stretch of your length began' });
      marks.push({ t: stood.stretch.stats.best.startT, text: 'best', rowLabel: 'Best began' });
      var pts = stood.stretch.points;
      marks.push({ t: pts[pts.length - 1].startT, text: 'latest', rowLabel: 'Latest full stretch began' });
    }
    var svg = LL.render({
      series: ST.series,
      stretch: { from: stood.firstExecution.t, to: stood.latest.t },
      marks: marks,
      describe: 'The fund’s whole recorded life from ' + date(ST.series[0].t) + ' to ' +
        date(ST.series[ST.series.length - 1].t) + ', with your own stretch marked from ' +
        date(stood.firstExecution.t) + ' to ' + date(stood.latest.t) + '.'
    });
    var rows = LL.tableRows({ series: ST.series, stretch: { from: stood.firstExecution.t, to: stood.latest.t },
      marks: marks, fmtDate: date });
    return '<div class="section"><p class="label">This fund’s whole life, and your stretch of it</p>' +
      svg +
      '<details style="margin-top:.75rem"><summary class="linkish" style="padding:.4rem 0">Read it as dates</summary>' +
      '<table class="ledger"><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td class="n">' + esc(r[1]) + '</td></tr>'; }).join('') +
      '</tbody></table></details></div>';
  }

  function replaySlot(id) {
    return { 'S-REPLAY-BEHIND': 'POS-REPLAY-BEHIND', 'S-REPLAY-CLOSE': 'POS-REPLAY-CLOSE',
             'S-REPLAY-AHEAD': 'POS-REPLAY-AHEAD' }[id];
  }
  function dripSlot(id) {
    return { 'S-DRIP-HELPED': 'POS-DRIP-HELPED', 'S-DRIP-COST': 'POS-DRIP-COST' }[id];
  }

  /* The latest NAV against the NAV twelve months earlier. */
  function fallingMarket(series, asOfT) {
    var year = asOfT - 365 * 86400000, prior = null;
    for (var i = 0; i < series.length; i++) { if (series[i].t <= year) prior = series[i]; else break; }
    return !!(prior && series[series.length - 1].v < prior.v);
  }

  /* The same total, dripped evenly across the same span, valued at the latest
   * NAV. It is a comparison, never something that happened. */
  function evenDrip(purchases, series, asOfT) {
    if (!purchases.length) return NaN;
    var total = purchases.reduce(function (s, r) { return s + r.amount; }, 0);
    var from = Math.min.apply(null, purchases.map(function (r) { return r.t; }));
    var to = Math.max.apply(null, purchases.map(function (r) { return r.t; }));
    var months = Math.max(1, Math.round((to - from) / (30.44 * 86400000)) + 1);
    var each = total / months, rows = [];
    for (var i = 0; i < months; i++) rows.push({ t: E.addMonths(from, i), amount: each, type: 'in' });
    var run = P.execute(rows, series);
    return run.ok ? run.units * series[series.length - 1].v : NaN;
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
    $('#back').hidden = false;
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
    $('#fund-state').textContent = name + ' · ' + series.length.toLocaleString() +
      ' prices, ' + date(series[0].t) + ' to ' + date(series[series.length - 1].t);
    $('#step-ledger').hidden = false;
    refresh();
  }

  function init() {
    drawRows();
    $('#foot-refrains').innerHTML = COPY.slots['FOOTER-REFRAINS'].text
      ? esc(COPY.slots['FOOTER-REFRAINS'].text)
      : '<span class="slot-empty" style="display:inline-block">Awaiting copy slot <code>FOOTER-REFRAINS</code></span>';

    $('#use-file').addEventListener('click', function () { $('#file').click(); });
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
    $('#back').addEventListener('click', function () {
      $('#step-reading').hidden = true; $('#step-fund').hidden = false;
      $('#step-ledger').hidden = false; $('#back').hidden = true;
      window.scrollTo(0, 0);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.WhereYouStand = { state: ST, loadSeries: loadSeries, show: show, slot: slot };
})();
