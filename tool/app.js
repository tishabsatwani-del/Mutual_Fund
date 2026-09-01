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
    var mark = kind === 'bad' ? '!' : kind === 'ok' ? '✓' : kind === 'warn' ? '!' : 'i';
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

  /* Short enough to sit inside a bar segment: a full rupee figure does not fit
     and a truncated one is worse than none. */
  function short(n) {
    var a = Math.abs(n);
    if (a >= 1e7) return '\u20b9' + (a / 1e7).toFixed(1) + ' cr';
    if (a >= 1e5) return '\u20b9' + (a / 1e5).toFixed(1) + ' L';
    return money(n);
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

    /* The gap, drawn. A shortfall printed as "short by Rs 11,28,738" is a
     * number the reader has to hold against another number to mean anything.
     * Drawn as the remaining length of the same bar, it is the one thing on
     * the chart that needs no arithmetic at all -- and it is hatched rather
     * than filled, because it is the part that does not exist. */
    if (plan.projected < plan.target) {
      var xEnd = padL + ((plan.fromCorpus + plan.fromSip) / top) * innerW;
      var wGap = Math.max(0, xTarget - xEnd);
      if (wGap > 1) {
        parts.push('<defs><pattern id="gaphatch" width="6" height="6" patternUnits="userSpaceOnUse" ' +
          'patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" ' +
          'stroke="var(--muted)" stroke-width="2"/></pattern></defs>');
        parts.push('<rect x="' + (xEnd + 2).toFixed(1) + '" y="' + y + '" width="' +
          Math.max(0, wGap - 2).toFixed(1) + '" height="' + barH + '" rx="4" ' +
          'fill="url(#gaphatch)" stroke="var(--muted)" stroke-width="1"><title>' +
          esc('Still to find: ' + money(plan.target - plan.projected)) + '</title></rect>');
        /* The label sits ON the hatching, which is exactly the busiest ground
           in the figure. It gets the page's own ink and a halo of the card
           behind it, so it reads over the diagonals rather than through them. */
        parts.push('<text class="barlabel gap" x="' + ((xEnd + xTarget) / 2).toFixed(1) + '" y="' +
          (y + barH / 2 + 4) + '" text-anchor="middle" ' +
          'stroke="var(--surface)" stroke-width="4" paint-order="stroke">' +
          esc(short(plan.target - plan.projected)) + ' short</text>');
      }
    }

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
      (plan.projected < plan.target
        ? '<span class="key"><span class="swatch hatched"></span>Still to find</span>' : '') +
      '</div></figure>';
  }

  /* ------------------------------------------------------------ file intake */

  /* Is this text at all?
   *
   * A PDF handed to FileReader.readAsText comes back as its own bytes read as
   * characters: "%PDF-1.7", a compressed stream, and a few thousand control
   * codes. Split on commas that is a table of nonsense, and every reader
   * downstream then reports something confident about it -- which is how a
   * bank statement came to be described as containing trade logs.
   *
   * So the question "is this a spreadsheet" is answered before anything tries
   * to read one out of it. */
  function looksBinary(text) {
    var head = String(text == null ? '' : text).slice(0, 4096);
    if (!head) return null;
    if (head.slice(0, 5) === '%PDF-') return 'pdf';
    if (head.slice(0, 2) === 'PK' && head.charCodeAt(2) === 3 && head.charCodeAt(3) === 4) return 'zip';
    if (head.slice(0, 4) === '\xD0\xCF\x11\xE0') return 'oldexcel';
    var bad = 0;
    for (var i = 0; i < head.length; i++) {
      var c = head.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13) continue;
      if (c < 32 || c === 0xFFFD) bad++;
    }
    return bad > head.length * 0.05 ? 'binary' : null;
  }

  var BINARY_COPY = {
    zip: 'That file is a zip archive rather than a spreadsheet. If it is an Excel workbook, give ' +
         'it back its .xlsx ending and load it again; if it is a folder of files, unzip it first ' +
         'and load the one holding the history.',
    oldexcel: 'That is an old .xls workbook, which this tool cannot open. Open it in Excel or ' +
              'Google Sheets and save it as .xlsx or CSV, then load that.',
    binary: 'That file is not a spreadsheet — it is not text at all. This screen reads a table of ' +
            'dates and values, so load a CSV or Excel file, or copy the two columns and paste them in.'
  };

  function readFile(file, onSeries, onError, onProgress) {
    var name = (file.name || '').toLowerCase();

    /* Pasted columns arrive here exactly as a file does, so everything
       downstream -- the schema gate, the scheme picker, the import report --
       treats them identically and there is no second code path to keep
       honest. */
    if (file.pastedText != null) {
      if (onProgress) onProgress('Reading the pasted rows\u2026');
      try {
        var pasteRows = P.parseDelimited(file.pastedText);
        finish(P.rowsToSeries(pasteRows), pasteRows);
      } catch (err) {
        onError('Those pasted rows could not be read (' +
                (err && err.message ? err.message : 'unknown') + ').');
      }
      return;
    }

    if (onProgress) {
      var mb = file.size / (1024 * 1024);
      onProgress('Reading ' + file.name + (mb >= 1 ? ' (' + mb.toFixed(1) + ' MB)' : '') + '\u2026' +
        (mb > 25 ? ' This is a large file and may take a few seconds on a phone.' : ''));
    }
    /* Named before it is opened, because the answer is the same either way and
       a reader should not wait for a 20 MB statement to be read to be told it
       is a PDF. */
    if (/\.pdf$/.test(name)) { onError(P.NOT_TABULAR_COPY); return; }
    if (/\.xls$/.test(name)) { onError(BINARY_COPY.oldexcel); return; }
    if (/\.(docx?|pptx?|png|jpe?g|gif|zip|rar|7z)$/.test(name)) {
      onError('That is a ' + name.replace(/^.*\./, '.') + ' file. This screen reads a table of ' +
              'dates and values, so load a CSV or Excel file, or copy the two columns and paste ' +
              'them in.');
      return;
    }
    if (/\.xlsx?$/.test(name)) {
      /* A real multi-tab workbook -- a CAS, a portal export -- often opens on
         a cover page, and reading tab 1 out of that used to hand the reader
         a hard refusal for a file whose data sat one tab over. So every tab
         is tried in order, and the first that yields a series (or the
         many-schemes question, which is a series with a choice on it) is the
         one read. Only when NO tab holds a table does the refusal stand, and
         it is tab 1's, with the tab count named. */
      readWorkbook(file).then(function (rows) {
        var res = P.rowsToSeries(rows);
        if (res.ok || res.code === 'MANY_SCHEMES') { finish(res, rows); return null; }
        return WB.listSheets(file).then(function (names) {
          var i = 1;
          function tryNext() {
            if (i >= names.length) {
              if (names.length > 1) {
                res.message = 'None of the ' + names.length + ' sheets in this workbook holds ' +
                  'a readable table of dates and values. On the first sheet: ' + res.message;
              }
              finish(res, rows);
              return;
            }
            var nm = names[i++];
            return WB.readWorkbook(file, nm).then(function (rows2) {
              var r2 = P.rowsToSeries(rows2);
              if (r2.ok || r2.code === 'MANY_SCHEMES') { finish(r2, rows2); return; }
              return tryNext();
            }).catch(tryNext);
          }
          return tryNext();
        }).catch(function () { finish(res, rows); });
      }).catch(function (err) {
        onError('That Excel file could not be read here (' + err.message + '). Open it and save it as CSV, then load that.');
      });
      return;
    }
    var fr = new FileReader();
    fr.onerror = function () { onError('That file could not be opened.'); };
    fr.onload = function () {
      /* Sniffed rather than trusted to the extension: a PDF saved as .csv is
         still a PDF, and it is the contents that decide what can be read. */
      var kind = looksBinary(fr.result);
      if (kind === 'pdf') { onError(P.NOT_TABULAR_COPY); return; }
      if (kind) { onError(BINARY_COPY[kind] || BINARY_COPY.binary); return; }
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
        /* The rows go out with EVERY refusal, not only that one.
         *
         * A file of text under a NAV heading fails here first, with "0 usable
         * rows" -- true, and useless: it describes the symptom and not the
         * fault. The caller can only say what is actually wrong with the file
         * if it is handed the file. */
        onError(res.message, { rows: rows || null });
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
    input.addEventListener('change', function () {
      var chosen = input.files[0];
      /* Cleared so that choosing the SAME file again fires change again. A
         reader who fixes their spreadsheet and re-picks it otherwise gets
         nothing at all, and no way to tell whether the tool saw the click. */
      input.value = '';
      if (chosen) handler(chosen);
    });
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
