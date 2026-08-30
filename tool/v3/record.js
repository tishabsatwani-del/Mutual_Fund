/* Where You Stand — Tool 2, "This fund's record".
 *
 * Review v3, section 4. Order: fund → plan → "How long will you hold?" with no
 * default and nothing rendered until one is chosen → the reading.
 *
 * The reading puts the WORST window first and largest, the typical one second,
 * the best third, and never shows the mean: an average put at the top of a
 * screen becomes the number people remember, and it hides the spread that
 * actually decided what any one investor got.
 *
 * Where a sentence is the author's, this file names the slot and prints the
 * arithmetic beside it. The figures are a reading of the reader's own data and
 * so belong on screen; the meaning is the author's and is never invented here.
 */
(function (root) {
  'use strict';

  var W = root.WYS, E = root.SimEngines, St = root.SimStates, LL = root.LifeLine;
  var $ = W.$, $$ = W.$$;

  var YEARS = [1, 3, 5, 7, 10, 15];
  var R = { series: null, name: '', years: null, index: null, indexName: '', deposit: null };

  function spanYears(series) {
    return (series[series.length - 1].t - series[0].t) / (365.2425 * 86400000);
  }

  /* ------------------------------------------------------- the window chips
   * No default. A default is a recommendation, and the length a reader means to
   * hold is the one thing this screen cannot guess. */
  function drawYears() {
    var span = R.series ? spanYears(R.series) : 0;
    $('#r-years').innerHTML = YEARS.map(function (y) {
      var feasible = span >= y;
      return '<button class="chip" role="radio" type="button" data-y="' + y + '"' +
        ' aria-checked="' + (R.years === y) + '"' + (feasible ? '' : ' disabled') +
        '>' + y + ' year' + (y === 1 ? '' : 's') + '</button>';
    }).join('');
    $$('#r-years .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        R.years = +b.dataset.y;
        drawYears();
        run();
      });
    });
    $('#r-window-note').textContent = R.series
      ? 'This history covers ' + span.toFixed(1) + ' years. Lengths it cannot measure are greyed out.'
      : '';
  }

  /* ------------------------------------------------------------ the reading */
  function run() {
    var out = $('#r-out');
    if (!R.series || !R.years) { out.innerHTML = ''; return; }

    var rolled = E.rolling(R.series, { years: R.years });
    if (!rolled.ok) {
      out.innerHTML = guard('RR-TOO-YOUNG',
        'This history is ' + spanYears(R.series).toFixed(1) + ' years long and you asked for ' +
        R.years + '-year windows. There is not one full window to measure.');
      return;
    }
    var s = rolled.stats, pts = rolled.points, html = '';

    /* The age guard is a reading, not an alert: the arithmetic is printed, and
     * the meaning is the author's slot beside it. */
    var span = spanYears(R.series);
    if (span < R.years + 3) {
      html += guard('RR-AGE-GUARD',
        'This history is ' + span.toFixed(1) + ' years long and you asked for ' + R.years +
        '-year windows, so every window here begins inside a band of ' +
        Math.max(0, span - R.years).toFixed(1) + ' years.');
    }

    /* Worst first and largest. Typical second. Best third. No mean. */
    html += '<div class="section windows">';
    html += big('The worst ' + R.years + ' years this fund has had', s.worst, 'w-worst', 0);
    html += big('Typical', s.median, 'w-typical', 1, true);
    html += big('The best', s.best, 'w-best', 2);
    html += '<p class="gloss">' + W.count(s.count) + ' windows of ' + R.years +
      ' year' + (R.years === 1 ? '' : 's') + ', one for every day this fund published a price.</p>';
    html += '</div>';

    /* The life-line, with the three windows marked. */
    html += '<div class="section"><p class="label">This fund’s whole life</p>' +
      LL.render({
        series: R.series,
        marks: [
          { t: s.worst.startT, text: 'worst', rowLabel: 'The worst window began' },
          { t: s.best.startT, text: 'best', rowLabel: 'The best began' },
          { t: pts[pts.length - 1].startT, text: 'latest', rowLabel: 'The latest full window began' }
        ],
        describe: 'The whole recorded life of ' + R.name + ', with the worst, best and latest ' +
          R.years + '-year windows marked.'
      }) + '</div>';

    /* Where each of those windows started, and where the latest one places.
     * The window a fund's own page prints is the latest one, and its place
     * is the question a fund's own page can never answer. */
    var latest = pts[pts.length - 1];
    var place = E.placeInHundred(latest.r, s.values);
    html += '<div class="section"><p class="label">Which window is which</p>' +
      '<div class="scroller"><table class="ledger"><tbody>' +
      trow('The worst began', W.date(s.worst.startT), W.pct(s.worst.r)) +
      trow('The best began', W.date(s.best.startT), W.pct(s.best.r)) +
      trow('The latest began', W.date(latest.startT), W.pct(latest.r)) +
      '</tbody></table></div>' +
      '<p class="gloss">The latest window is the one this fund’s own page prints. ' +
      'It is higher than ' + place + ' of every 100 windows of this length.</p></div>';

    /* Two counts under the distribution. A count, not a share: a share reads as
     * a property of the fund when it is a property of the dates this history
     * happens to cover. */
    html += depositBlock(s);

    /* The comparison series. One, never a third. */
    html += comparisonBlock(s);

    /* A history that begins after the 2008 fall has never been measured through
     * one. The series is named by its own name, never called "the market". */
    if (R.series[0].t > Date.UTC(2009, 5, 1)) {
      html += guard('RR-BEFORE-2008',
        W.esc(R.name) + ' begins on ' + W.date(R.series[0].t) + ', after the fall of 2008, ' +
        'so its worst window above has never been measured through one.');
    }

    /* The histogram is secondary now: one tap away, under How often. */
    html += '<details class="section"><summary class="linkish">How often</summary>' +
      histogram(s.values) + '</details>';

    out.innerHTML = html;
    wireDeposit(s);
    drawLine();
  }

  function big(label, w, cls, i, isMedian) {
    var r = isMedian ? w : w.r;
    return '<div class="' + cls + '"' + W.land(i) + '>' +
      '<p class="label">' + label + '</p>' +
      '<p class="figure">' + W.pct(r) + '</p>' +
      '<p class="gloss">a year' + (isMedian ? ' · half did better, half did worse' : '') + '</p></div>';
  }

  function trow(a, b, c) {
    return '<tr><td>' + W.esc(a) + '</td><td class="n">' + W.esc(b) + '</td><td class="n">' +
      W.esc(c) + '</td></tr>';
  }

  /* The tool ships no rate. A figure here would be the tool telling the reader
   * what to expect, and that is not its job. */
  function depositBlock(s) {
    var below = s.values.filter(function (v) { return v < 0; }).length;
    return '<div class="section"><p class="label">Against a deposit</p>' +
      '<label class="field" for="r-dep" style="max-width:14rem">' +
      '<span class="label">What a fixed deposit pays, %</span>' +
      '<input type="number" id="r-dep" inputmode="decimal" step="0.1" min="0" max="100"></label>' +
      '<div class="scroller"><table class="ledger"><tbody>' +
      '<tr><td>Windows that ended below zero</td><td class="n">' + W.count(below) + ' of ' +
      W.count(s.count) + '</td></tr>' +
      '<tr id="r-dep-row" hidden><td>Windows above the deposit</td><td class="n" id="r-dep-count">—</td></tr>' +
      '</tbody></table></div></div>';
  }

  function wireDeposit(s) {
    var input = $('#r-dep');
    if (!input) return;
    input.addEventListener('input', function () {
      var g = parseFloat(input.value);
      var row = $('#r-dep-row');
      if (!isFinite(g)) { row.hidden = true; return; }
      var above = s.values.filter(function (v) { return v >= g / 100; }).length;
      $('#r-dep-count').textContent = W.count(above) + ' of ' + W.count(s.count);
      row.hidden = false;
    });
  }

  /* One comparison series, never a third. With no index fund loaded the block
   * says what it is missing rather than quietly leaving the question out. */
  function comparisonBlock(s) {
    if (!R.index) {
      return '<div class="section"><p class="label">Against an index fund</p>' +
        '<p class="gloss">No index fund is loaded, so this fund’s record stands on its own here.</p>' +
        '<button class="linkish" id="r-index-open" type="button">Load an index fund</button>' +
        '<input type="file" id="r-index-file" accept=".csv,.txt,.xlsx,.json" hidden></div>';
    }
    var theirs = E.rolling(R.index, { years: R.years });
    if (!theirs.ok) {
      return '<div class="section"><p class="label">Against an index fund</p>' +
        '<p class="gloss">' + W.esc(R.indexName) + ' has no full ' + R.years +
        '-year window to compare against.</p></div>';
    }
    var state = St.worstAgainstIndex(s.worst.r, theirs.stats.worst.r);
    return '<div class="section"><p class="label">Against an index fund</p>' +
      '<div class="scroller"><table class="ledger"><tbody>' +
      '<tr><td>' + W.esc(R.name) + ', worst</td><td class="n">' + W.pct(s.worst.r) + '</td></tr>' +
      '<tr><td>' + W.esc(R.indexName) + ', worst</td><td class="n theirs">' +
      W.pct(theirs.stats.worst.r) + '</td></tr>' +
      '</tbody></table></div>' +
      (state ? W.slot(state.slot) : '') + '</div>';
  }

  /* A plain count per band. No colour by sign: a return is ink or it is marker. */
  function histogram(values) {
    var edges = [-Infinity, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20, 0.25, Infinity];
    var bins = edges.slice(0, -1).map(function (lo, i) {
      var hi = edges[i + 1];
      return { lo: lo, hi: hi, n: values.filter(function (v) { return v >= lo && v < hi; }).length };
    });
    var most = Math.max.apply(null, bins.map(function (b) { return b.n; })) || 1;
    return '<div class="scroller"><table class="ledger" style="margin-top:.75rem"><tbody>' + bins.map(function (b) {
      var label = b.lo === -Infinity ? 'below −10%'
        : b.hi === Infinity ? '25% and above'
        : W.pct(b.lo, 0) + ' to ' + W.pct(b.hi, 0);
      return '<tr><td>' + label + '</td><td class="n">' + W.count(b.n) + '</td>' +
        '<td style="width:40%"><span class="hist-bar" style="width:' +
        (b.n / most * 100).toFixed(1) + '%"></span></td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  /* A guard printed as a reading: the arithmetic, then the author's sentence. */
  function guard(slotId, arithmetic) {
    return '<div class="section refusal"><p>' + arithmetic + '</p>' + W.slot(slotId) + '</div>';
  }

  function drawLine() {
    var svg = $('#r-out .lifeline');
    if (!svg) return;
    var life = svg.querySelector('.ll-life');
    if (!life || !life.getTotalLength) return;
    try { svg.style.setProperty('--len', life.getTotalLength()); svg.classList.add('drawing'); }
    catch (e) { /* a browser that cannot measure simply shows it drawn */ }
  }

  /* ---------------------------------------------------------------- wiring */
  function load(series, name) {
    R.series = series; R.name = name; R.years = null;
    /* Review v4 §5: confirm before computing, naming the file's own name and
       the dates it actually covers, so a reader can check they loaded what
       they meant to before a single figure is worked out. */
    $('#r-state').textContent = 'Found ' + W.count(series.length) + ' NAVs for ' + name +
      ', ' + W.span(series[0].t, series[series.length - 1].t) + '.';
    $('#r-window').hidden = false;
    $('#r-out').innerHTML = '';
    drawYears();
  }

  W.view('record', {
    enter: function () {
      if (!R.series) { $('#r-window').hidden = true; $('#r-out').innerHTML = ''; }
    }
  });

  root.WYSRecord = {
    state: R, load: load,
    init: function () {
      $('#r-file-open').addEventListener('click', function () { $('#r-file').click(); });
      $('#r-file').addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        W.readFile(f).then(function (r) { load(r.series, r.name); })
                     .catch(function (err) { $('#r-state').textContent = err.message; });
      });
      /* the index-fund door is rendered inside the reading, so it is wired
         each time the reading is drawn */
      document.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'r-index-open') $('#r-index-file').click();
      });
      document.addEventListener('change', function (e) {
        if (!e.target || e.target.id !== 'r-index-file') return;
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        W.readFile(f).then(function (r) {
          R.index = r.series; R.indexName = r.name; run();
        });
      });
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
