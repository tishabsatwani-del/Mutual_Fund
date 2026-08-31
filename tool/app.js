/* Where You Stand — interface.
 *
 * No framework, no network, no storage. Every figure a reader types stays in
 * this page's memory and dies with the tab, which is the only honest way to
 * promise privacy.
 */
(function (root) {
  'use strict';

  var E = window.PRCEngine, P = window.PRCParse;
  var VERSION = '2.0';
  var SHEET_VERSION = '1.4';
  var HORIZONS = [1, 3, 5, 7, 10];

  /* ------------------------------------------------------------ formatting */

  /* Review v4 section 11: every figure in the product goes through ONE
   * formatting module, web and workbook, and nothing is formatted at the point
   * of use. These are the thin adapters that keep the old call sites working.
   *
   * What was here before divided by 1e7 for crore and called toFixed, and
   * toFixed falls back to exponent notation at 1e21 -- which is how the goal
   * screen came to print "₹1.264244546793246e+68 crore". sim/format.js uses
   * Intl at every magnitude and never produces an exponent. */
  var F = window.SimFormat;

  function money(n) { return F.money(n); }
  function moneyWords(n) { return F.moneyWords(n); }
  /* Full digits with the words beside them, for a figure the reader is
     checking against a statement. */
  function moneyLong(n) {
    var words = F.echo(n);
    return money(n) + (words ? ' (' + words.replace(/^= /, '') + ')' : '');
  }
  function pct(r, dp) { return F.pct(r, { dp: dp }); }
  function signedPct(r) { return F.pct(r, { signed: true }); }
  function fmtDate(t) { return F.date(t); }
  function fmtYears(y) { return F.years(y); }
  function isoToday() { return new Date().toISOString().slice(0, 10); }
  function isoToTs(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }

  /* --------------------------------------------------------------- DOM help */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function notice(kind, text) {
    var mark = kind === 'bad' ? '!' : kind === 'ok' ? '✓' : 'i';
    return '<div class="notice ' + kind + '"><span class="ic" aria-hidden="true">' + mark +
           '</span><span>' + text + '</span></div>';
  }

  /* ---------------------------------------------------------------- routing */

  var VIEWS = ['home', 'portfolio', 'goal', 'rolling', 'sheet', 'method', 'about'];
  /* the two analysis screens became one; old links still land somewhere sensible */
  var ALIASES = { history: ['rolling', 'index'], market: ['rolling', 'index'],
                  fund: ['rolling', 'fund'] };

  function show(name, initial) {
    if (ALIASES[name]) {
      var alias = ALIASES[name];
      name = alias[0];
      if (alias[1] && root.PRCRolling) root.PRCRolling.preset(alias[1]);
    }
    if (VIEWS.indexOf(name) === -1) name = 'home';
    $$('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'view-' + name); });
    document.body.dataset.view = name;
    $('#back').classList.toggle('on', name !== 'home');
    if (location.hash !== '#' + name) location.hash = name;
    window.scrollTo(0, 0);
    /* Move focus to the new heading so a screen reader announces the change --
     * but not on first paint, where nothing has changed yet. */
    if (!initial) {
      var h = $('#view-' + name + ' h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }

  function initRouter() {
    window.addEventListener('hashchange', function () { show(location.hash.replace('#', '') || 'home'); });
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-go]');
      if (t) {
        ev.preventDefault();
        if (t.dataset.source && root.PRCRolling) root.PRCRolling.preset(t.dataset.source);
        show(t.dataset.go);
      }
    });
    $('#back').addEventListener('click', function () { show('home'); });
    show(location.hash.replace('#', '') || 'home', true);
  }

  /* ----------------------------------------------------------------- charts
   *
   * Inline SVG, sized by viewBox so it scales on a phone without overflowing.
   * One hue for one series; the axis carries the meaning, never colour alone.
   */

  function histogramChart(values, opts) {
    var o = opts || {};
    var bins = E.histogram(values);
    var W = 640, H = 260, padL = 34, padR = 12, padT = 14, padB = 54;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var maxCount = Math.max.apply(null, bins.map(function (b) { return b.count; })) || 1;
    var gap = 6, bw = (innerW / bins.length) - gap;

    var parts = [];
    /* horizontal guides, recessive */
    var ticks = 4;
    for (var g = 0; g <= ticks; g++) {
      var yv = Math.round(maxCount * g / ticks);
      var y = padT + innerH - (yv / maxCount) * innerH;
      parts.push('<line class="grid" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '"/>');
      parts.push('<text class="axis" x="' + (padL - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + yv + '</text>');
    }
    bins.forEach(function (b, i) {
      var h = (b.count / maxCount) * innerH;
      var x = padL + i * (bw + gap) + gap / 2;
      var y = padT + innerH - h;
      var label = binLabel(b);
      /* negative-return bucket gets the second hue AND sits left of the zero
         rule AND is named in its own axis label -- three cues, not one */
      var cls = b.to <= 0 ? 'bar hot' : 'bar';
      if (h > 0.5) {
        parts.push('<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
          '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="4"><title>' +
          esc(b.count + ' of ' + values.length + ' periods returned ' + label) + '</title></rect>');
        parts.push('<text class="barlabel" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) +
          '" text-anchor="middle">' + b.count + '</text>');
      }
      /* Ticks sit on the boundary between bars, the way a histogram axis should:
         a label centred under a bar reads as that bar's value, which it is not. */
      if (b.from !== -Infinity) {
        parts.push('<text class="axis" x="' + (x - gap / 2).toFixed(1) + '" y="' + (padT + innerH + 17) +
          '" text-anchor="middle">' + (b.from * 100).toFixed(0) + '</text>');
      }
    });
    parts.push('<line class="zero" x1="' + padL + '" y1="' + (padT + innerH) + '" x2="' + (W - padR) + '" y2="' + (padT + innerH) + '"/>');
    parts.push('<text class="axis" x="' + (padL + innerW / 2) + '" y="' + (H - 8) +
      '" text-anchor="middle">Annualised return, % a year, over each ' + o.years + '-year period</text>');

    return '<figure class="chart"><figcaption>' + esc(o.caption || '') + '</figcaption>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' +
      esc(chartAlt(bins, values.length, o.years)) + '">' + parts.join('') + '</svg>' +
      '<div class="legend"><span class="key"><span class="swatch" style="background:var(--series-2)"></span>Periods that lost money</span>' +
      '<span class="key"><span class="swatch" style="background:var(--series-1)"></span>Periods that made money</span></div>' +
      '</figure>';
  }

  function binLabel(b) {
    if (b.from === -Infinity) return 'below ' + pct(b.to, 0);
    if (b.to === Infinity) return 'above ' + pct(b.from, 0);
    return pct(b.from, 0) + ' to ' + pct(b.to, 0);
  }
  function chartAlt(bins, total, years) {
    return 'Distribution of ' + total + ' rolling ' + years + '-year returns. ' +
      bins.filter(function (b) { return b.count; }).map(function (b) {
        return b.count + ' periods ' + binLabel(b);
      }).join('; ') + '.';
  }

  function goalChart(plan) {
    var W = 640, H = 150, padL = 12, padR = 12, padT = 34, padB = 34;
    var innerW = W - padL - padR;
    var top = Math.max(plan.projected, plan.target) * 1.06;
    var barH = 44, y = padT;
    var wCorpus = (plan.fromCorpus / top) * innerW;
    var wSip = (plan.fromSip / top) * innerW;
    var xTarget = padL + (plan.target / top) * innerW;
    var parts = [];

    if (wCorpus > 1) parts.push('<rect x="' + padL + '" y="' + y + '" width="' + wCorpus.toFixed(1) +
      '" height="' + barH + '" rx="4" fill="var(--series-1)"><title>' +
      esc('From what you already have: ' + money(plan.fromCorpus)) + '</title></rect>');
    /* 2px surface gap between the two segments so they never blur into one */
    if (wSip > 1) parts.push('<rect x="' + (padL + wCorpus + 2).toFixed(1) + '" y="' + y + '" width="' +
      Math.max(0, wSip - 2).toFixed(1) + '" height="' + barH + '" rx="4" fill="var(--series-2)"><title>' +
      esc('From your monthly investing: ' + money(plan.fromSip)) + '</title></rect>');

    parts.push('<line x1="' + xTarget.toFixed(1) + '" y1="' + (y - 12) + '" x2="' + xTarget.toFixed(1) +
      '" y2="' + (y + barH + 12) + '" stroke="var(--ink)" stroke-width="2" stroke-dasharray="4 3"/>');
    parts.push('<text class="barlabel" x="' + xTarget.toFixed(1) + '" y="' + (y - 18) +
      '" text-anchor="' + (xTarget > W * 0.75 ? 'end' : 'middle') + '">Goal ' + esc(money(plan.target)) + '</text>');
    parts.push('<text class="barlabel" x="' + padL + '" y="' + (y + barH + 26) + '">You land at ' +
      esc(money(plan.projected)) + '</text>');

    return '<figure class="chart"><figcaption>Where your money comes from, against the goal line</figcaption>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' +
      esc('Projected ' + money(plan.projected) + ' against a goal of ' + money(plan.target) +
          ', made up of ' + money(plan.fromCorpus) + ' from existing savings and ' +
          money(plan.fromSip) + ' from monthly investing.') + '">' + parts.join('') + '</svg>' +
      '<div class="legend">' +
      '<span class="key"><span class="swatch" style="background:var(--series-1)"></span>What you already have, grown</span>' +
      '<span class="key"><span class="swatch" style="background:var(--series-2)"></span>What your monthly investing adds</span>' +
      '</div></figure>';
  }

  /* ------------------------------------------------------------ file intake */

  function readFile(file, onSeries, onError, onProgress) {
    var name = (file.name || '').toLowerCase();
    if (onProgress) {
      var mb = file.size / (1024 * 1024);
      onProgress('Reading ' + file.name + (mb >= 1 ? ' (' + mb.toFixed(1) + ' MB)' : '') + '\u2026' +
        (mb > 25 ? ' This is a large file and may take a few seconds on a phone.' : ''));
    }
    if (/\.xlsx?$/.test(name)) {
      readWorkbook(file).then(function (rows) {
        finish(P.rowsToSeries(rows), rows);
      }).catch(function (err) {
        onError('That Excel file could not be read here (' + err.message + '). Open it and save it as CSV, then load that.');
      });
      return;
    }
    var fr = new FileReader();
    fr.onerror = function () { onError('That file could not be opened.'); };
    fr.onload = function () {
      try {
        var rows = P.parseDelimited(fr.result);
        finish(P.rowsToSeries(rows), rows);
      } catch (err) {
        onError('That file could not be read (' + (err && err.message ? err.message : 'unknown') + ').');
      }
    };
    fr.readAsText(file);

    function finish(res, rows) {
      if (!res.ok) {
        /* one file holding many schemes is a question, not an error */
        if (res.code === 'MANY_SCHEMES' && rows) {
          var listed = P.listSchemes(rows);
          if (listed) { onError(res.message, { rows: rows, schemes: listed.schemes }); return; }
        }
        onError(res.message);
        return;
      }
      res.rows = rows;
      onSeries(res);
    }
  }

  /* Minimal .xlsx reader: a zip, inflated by the browser itself. No library,
   * so nothing to go stale. Falls back to a plain message where the browser
   * has no DecompressionStream. */
  /* The workbook reader lives in sim/workbook.js so the older tool and the four
   * new screens read an .xlsx the same way. */
  var WB = window.SimWorkbook;
  function readWorkbook(file) { return WB.readWorkbook(file); }


  function wireDrop(dropId, inputId, pickId, handler) {
    var drop = $('#' + dropId), input = $('#' + inputId), pick = $('#' + pickId);
    function open() { input.click(); }
    pick.addEventListener('click', function (e) { e.stopPropagation(); open(); });
    drop.addEventListener('click', open);
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', function () { if (input.files[0]) handler(input.files[0]); });
  }

  window.PRCApp = {
    E: E, P: P, VERSION: VERSION, SHEET_VERSION: SHEET_VERSION, HORIZONS: HORIZONS,
    money: money, moneyLong: moneyLong, moneyWords: moneyWords,
    pct: pct, signedPct: signedPct, echo: F.echo, checkInput: F.checkInput,
    fmtDate: fmtDate, fmtYears: fmtYears, isoToday: isoToday, isoToTs: isoToTs,
    $: $, $$: $$, el: el, esc: esc, notice: notice, show: show,
    histogramChart: histogramChart, goalChart: goalChart,
    readFile: readFile, wireDrop: wireDrop, initRouter: initRouter
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
