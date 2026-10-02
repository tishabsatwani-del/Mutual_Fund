/* Where You Stand: the interface's shared helpers.
 *
 * No framework, no network, no storage. Every figure a reader types stays in
 * this page's memory and dies with the tab, which is the only honest way to
 * promise privacy.
 */
(function (root) {
  'use strict';

  var E = root.PRCEngine, P = root.PRCParse, F = root.SimFormat, WB = root.SimWorkbook;
  var VERSION = '3.0';
  var HORIZONS = [1, 3, 5, 7, 10];

  /* ------------------------------------------------------------ formatting */
  function money(n) { return F.money(n); }
  function moneyWords(n) { return F.moneyWords(n); }
  function moneyLong(n) { var words = F.echo(n); return money(n) + (words ? ' (' + words.replace(/^= /, '') + ')' : ''); }
  function pct(r, dp) { return F.pct(r, { dp: dp }); }
  function signedPct(r, dp) { return F.pct(r, { signed: true, dp: dp }); }
  /* A share of a count or a whole: how many windows, how much of the money.
     Whole percents as a rule, but a share that is not all never reads 100%
     and one that is not none never reads 0%: it gets one decimal, and words
     where even one decimal would round to the end. 5 windows of 1,305 below
     zero once printed as "100%" above zero, beside a gap of +0.4%. */
  function share(v, dp) {
    var d = dp == null ? 0 : dp;
    if (!(v > 0 && v < 1)) return pct(v, d);
    var text = pct(v, d);
    if (!/^(0|100)(\.0+)?%$/.test(text)) return text;
    if (d < 1) { text = pct(v, 1); if (!/^(0|100)\.0%$/.test(text)) return text; }
    return v < 0.5 ? 'under 0.1%' : 'over 99.9%';
  }
  /* A fund's name where it heads a tab or a figure: the scheme without its plan
     and option ("… Index Fund - Direct Growth" reads "… Index Fund"), unless
     that would read the same as a name beside it, as a Direct plan does against
     its own Regular plan; and short enough not to wrap a tab. */
  function shortName(n, others) {
    function base(x) { return String(x || '').split(/\s+[-\u2013]\s+/)[0]; }
    var full = String(n || ''), cut = base(full);
    var clash = [].concat(others || []).some(function (o) { return base(o) === cut && String(o) !== full; });
    var s = cut && !clash ? cut : full;
    return s.length <= 32 ? s : s.slice(0, 31).replace(/\s+\S*$/, '').replace(/[\s\-\u2013,·]+$/, '') + '…';
  }
  function signedMoney(n) { return (n >= 0 ? '+' : '') + money(n); }
  function fmtDate(t) { return F.date(t); }
  function fmtYears(y) { return F.years(y); }
  function short(n) {
    var a = Math.abs(n);
    if (a >= 1e7) return '₹' + (a / 1e7).toFixed(a >= 1e9 ? 0 : 1) + ' cr';
    if (a >= 1e5) return '₹' + (a / 1e5).toFixed(1) + ' L';
    return money(n);
  }
  function months(days) { return Math.round(days / 30.44); }
  function monthsText(days) { var m = months(days); return m < 1 ? 'under a month' : m === 1 ? '1 month' : m + ' months'; }
  /* Today, in the reader's own calendar, as a UTC-midnight timestamp: the
     same day the phone's clock shows, not the day it is in Greenwich. */
  function todayTs() { var n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
  function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }
  function isoToday() { return isoOf(todayTs()); }
  function isoToTs(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function count(n) { return F.count(n); }

  /* ------------------------------------------------------------ the chimes
     A short, soft sound when a file is accepted and a gentler, lower one when
     it is refused. Made here with the Web Audio API, so there is no sound file
     and nothing to fetch; quiet, each under a third of a second; never awaited,
     so it can neither block nor delay anything; and silent wherever the
     browser will not play. Browsers open sound only from a reader's touch, so
     the context is woken by a touch on a file slot, a paste button or a picker. */
  var audio = null;
  function wakeAudio(ev) {
    var t = ev && ev.target;
    if (!t || !t.closest || !t.closest('.filebox, .filewrap, .pastebox, .pastebtn, .picker')) return;
    try {
      if (!audio) { var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; audio = new AC(); }
      if (audio.state === 'suspended' && audio.resume) audio.resume().catch(function () {});
    } catch (err) { audio = null; }
  }
  if (root.addEventListener) ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (t) { root.addEventListener(t, wakeAudio, { capture: true, passive: true }); });
  function chime(kind) {
    try {
      if (!audio || audio.state !== 'running') return;
      var ok = kind === 'ok', t0 = audio.currentTime + 0.01;
      /* accepted: two soft rising notes; refused: two gentle falling ones */
      (ok ? [[659.25, 0, 0.09], [880, 0.08, 0.12]] : [[392, 0, 0.12], [329.63, 0.1, 0.16]]).forEach(function (n) {
        var osc = audio.createOscillator(), gain = audio.createGain(), at = t0 + n[1];
        osc.type = 'sine'; osc.frequency.setValueAtTime(n[0], at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(ok ? 0.05 : 0.035, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + n[2]);
        osc.connect(gain); gain.connect(audio.destination);
        osc.start(at); osc.stop(at + n[2] + 0.02);
      });
    } catch (err) { /* a sound is never worth an error */ }
  }

  /* --------------------------------------------------------------- DOM help */
  function $(sel, root_) { return (root_ || document).querySelector(sel); }
  function $$(sel, root_) { return Array.prototype.slice.call((root_ || document).querySelectorAll(sel)); }
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
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function notice(kind, text) {
    var mark = kind === 'bad' ? '!' : kind === 'ok' ? '✓' : kind === 'warn' ? '!' : 'i';
    return '<div class="notice ' + (kind || '') + '"><span class="ic" aria-hidden="true">' + mark + '</span><span>' + text + '</span></div>';
  }
  /* A figure's name. It used to link to a glossary page; that page is gone
     (the book teaches the ideas), so the name is plain text that says what
     the figure is a figure of. The key is kept so callers need not change. */
  function term(key, label) { return esc(label); }

  /* C4: one state table for every sentence that compares two figures. A
     sentence may say "ahead", "behind", "more" or "less" only when the
     figures say so; under 0.05 percentage points apart they are equal, and a
     missing figure gets no sentence at all. */
  var EQUAL_BAND = 0.0005;
  function relation(a, b) {
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return 'undefined';
    var d = a - b;
    if (Math.abs(d) < EQUAL_BAND) return 'equal';
    return d > 0 ? 'greater' : 'smaller';
  }
  /* The plain statement of equality, at the precision the figures are shown. */
  function equalWords(a, b, dp) {
    var x = pct(a, dp), y = pct(b, dp);
    return x === y ? 'Both figures are ' + x + '.' : 'The two figures, ' + x + ' and ' + y + ', are less than 0.05 percentage points apart.';
  }

  /* H8: on a phone no table runs wider than three columns. A wider one is
     marked to stack, one card per row, every figure carrying its own heading
     (data-label); a two-column table of words stacks as label over answer. */
  function stackTables(scope) {
    var list = (scope || document).querySelectorAll('table.data:not([data-stacked])');
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      t.setAttribute('data-stacked', 'yes');
      var cols = 0;
      for (var r = 0; r < t.rows.length; r++) cols = Math.max(cols, t.rows[r].cells.length);
      if (t.classList.contains('prose') && cols <= 2) { t.classList.add('stack2'); continue; }
      if (cols <= 3) continue;
      var heads = [];
      var head = t.tHead && t.tHead.rows[0];
      if (head) for (var h = 0; h < head.cells.length; h++) heads.push(head.cells[h].textContent.trim());
      for (var b = 0; b < t.tBodies.length; b++) {
        var rows = t.tBodies[b].rows;
        for (var k = 0; k < rows.length; k++) {
          for (var c = 0; c < rows[k].cells.length; c++) {
            var cell = rows[k].cells[c];
            if (heads[c] && !cell.hasAttribute('data-label') && !cell.hasAttribute('colspan')) cell.setAttribute('data-label', heads[c]);
          }
        }
      }
      t.classList.add('stack');
    }
  }
  function watchTables() {
    var main = document.getElementById('main');
    if (!main || !root.MutationObserver) return;
    stackTables(main);
    new MutationObserver(function () { stackTables(main); }).observe(main, { childList: true, subtree: true });
  }
  function stat(k, v, key) {
    /* a date never splits at its hyphens; a long value takes a smaller size */
    var text = esc(v).replace(/\d{2}-[A-Z][a-z]{2}-\d{4}/g, '<span class="nb">$&</span>');
    return '<div class="stat"><div class="k">' + (key ? term(key, k) : esc(k)) + '</div><div class="v' + (String(v).length >= 10 ? ' long' : '') + '">' + text + '</div></div>';
  }
  function trow(k, v, key) { return '<tr><td>' + (key ? term(key, k) : esc(k)) + '</td><td>' + esc(v) + '</td></tr>'; }
  function fold(summary, bodyHtml, open) {
    return '<details class="explain"' + (open ? ' open' : '') + '><summary>' + summary + '</summary><div class="body">' + bodyHtml + '</div></details>';
  }
  function tabs(id, list) {
    /* list: [{key, label, html}]: the first is the main flow, the rest fold to one at a time on a phone */
    var live = list.filter(function (t) { return t && t.html; });
    var bar = '<div class="ixtabs" role="tablist" aria-label="Results">' + live.map(function (t, i) {
      return '<button type="button" class="ixtab' + (i === 0 ? ' on' : '') + '" role="tab" data-panel="' + t.key + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '">' + esc(t.label) + '</button>';
    }).join('') + '</div>';
    var body = live.map(function (t, i) {
      return '<section class="ixpanel' + (i === 0 ? ' on' : '') + '" data-panel="' + t.key + '" role="tabpanel"><h2 class="ixpanel-h">' + esc(t.label) + '</h2>' + t.html + '</section>';
    }).join('');
    return '<div class="ixpath" id="' + id + '">' + bar + body + '</div>';
  }
  function pdfFoot(which, name) {
    return '<div class="pdfrow"><button class="secondary pdfbtn" type="button" data-pdf="' + which + '" data-name="' + esc(name || '') + '">Save as PDF</button><p class="hint pdfnote" aria-live="polite"></p></div>';
  }
  function csvCell(v) { var t = String(v == null ? '' : v); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
  function fileSlug(name) { return String(name || 'results').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'results'; }
  function downloadText(text, filename, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------------------------------------------------------- routing */
  var VIEWS = ['home', 'portfolio', 'goal', 'rolling', 'sheet', 'about'];
  /* #understand and #method were the glossary; an old link lands on About,
     where How this tool calculates now lives. */
  var ALIASES = { history: 'rolling', market: 'rolling', fund: 'rolling', method: 'about', understand: 'about' };
  function show(name, initial) {
    var anchor = null;
    var m = /^([a-z]+)\/(.+)$/.exec(name || '');
    if (m) { name = m[1]; anchor = m[2]; }
    if (ALIASES[name]) { if (name === 'understand' || name === 'method') anchor = 'how'; name = ALIASES[name]; }
    if (VIEWS.indexOf(name) === -1) name = 'home';
    $$('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'view-' + name); });
    document.body.dataset.view = name;
    $('#back').classList.toggle('on', name !== 'home');
    var want = '#' + name + (anchor ? '/' + anchor : '');
    if (location.hash !== want) location.hash = want;
    if (anchor) {
      var target = document.getElementById('u-' + anchor) || document.getElementById(anchor);
      if (target) { target.scrollIntoView({ block: 'start' }); target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); return; }
    }
    window.scrollTo(0, 0);
    if (!initial) {
      var h = $('#view-' + name + ' h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }
  function initRouter() {
    window.addEventListener('hashchange', function () { show(location.hash.replace('#', '') || 'home'); });
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-go]');
      if (t) { ev.preventDefault(); show(t.dataset.go); }
    });
    $('#back').addEventListener('click', function () { show('home'); });
    show(location.hash.replace('#', '') || 'home', true);
  }

  /* ------------------------------------------------------------ file intake */
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
    zip: 'That file is a zip archive rather than a spreadsheet. If it is an Excel workbook, give it back its .xlsx ending and load it again; if it is a folder of files, unzip it first and load the one holding the history.',
    oldexcel: 'That is an old .xls workbook, which this tool cannot open. Open it in Excel or Google Sheets and save it as .xlsx or CSV, then load that.',
    binary: 'That file is not a spreadsheet: it is not text at all. This screen reads a table of dates and values, so load a CSV or Excel file, or copy the two columns and paste them in.'
  };
  /* A NAV or index file becomes a series here; every refusal carries the rows
     so the caller can say what is actually wrong with the file. */
  function readFile(file, onSeries, onError, onProgress, opts) {
    var name = (file.name || '').toLowerCase();
    var ropts = { noun: (opts && opts.noun) || 'fund' };
    if (file.pastedText != null) {
      try { var pasteRows = P.parseDelimited(file.pastedText); finish(P.rowsToSeries(pasteRows, ropts), pasteRows); }
      catch (err) { onError('Those pasted rows could not be read (' + (err && err.message ? err.message : 'unknown') + ').'); }
      return;
    }
    if (onProgress) onProgress('Reading ' + file.name + '…');
    if (/\.pdf$/.test(name)) { onError(P.NOT_TABULAR_COPY); return; }
    if (/\.xls$/.test(name)) { onError(BINARY_COPY.oldexcel); return; }
    if (/\.(docx?|pptx?|png|jpe?g|gif|zip|rar|7z)$/.test(name)) {
      onError('That is a ' + name.replace(/^.*\./, '.') + ' file. This screen reads a table of dates and values, so load a CSV or Excel file, or copy the two columns and paste them in.');
      return;
    }
    if (/\.xlsx?$/.test(name)) {
      WB.readWorkbook(file).then(function (rows) {
        var res = P.rowsToSeries(rows, ropts);
        if (res.ok || res.code === 'MANY_SCHEMES') { finish(res, rows); return null; }
        return WB.listSheets(file).then(function (names) {
          var i = 1;
          function tryNext() {
            if (i >= names.length) {
              if (names.length > 1) res.message = 'None of the ' + names.length + ' sheets in this workbook holds a readable table of dates and values. On the first sheet: ' + res.message;
              finish(res, rows); return;
            }
            var nm = names[i++];
            return WB.readWorkbook(file, nm).then(function (rows2) {
              var r2 = P.rowsToSeries(rows2, ropts);
              if (r2.ok || r2.code === 'MANY_SCHEMES') { finish(r2, rows2); return; }
              return tryNext();
            }).catch(tryNext);
          }
          return tryNext();
        }).catch(function () { finish(res, rows); });
      }).catch(function (err) { onError('That Excel file could not be read here (' + err.message + '). Open it and save it as CSV, then load that.'); });
      return;
    }
    var fr = new FileReader();
    fr.onerror = function () { onError('That file could not be opened.'); };
    fr.onload = function () {
      var kind = looksBinary(fr.result);
      if (kind === 'pdf') { onError(P.NOT_TABULAR_COPY); return; }
      if (kind) { onError(BINARY_COPY[kind] || BINARY_COPY.binary); return; }
      try { var rows = P.parseDelimited(fr.result); finish(P.rowsToSeries(rows, ropts), rows); }
      catch (err) { onError('That file could not be read (' + (err && err.message ? err.message : 'unknown') + ').'); }
    };
    fr.readAsText(file);
    function finish(res, rows) {
      if (!res.ok) {
        if (res.code === 'MANY_SCHEMES' && rows) {
          var listed = P.listSchemes(rows);
          if (listed) { onError(res.message, { rows: rows, schemes: listed.schemes, hasNames: listed.hasNames }); return; }
        }
        onError(res.message, { rows: rows || null });
        return;
      }
      res.rows = rows;
      onSeries(res);
    }
  }
  /* A statement file: rows or text, whichever the file gives, plus the sheet list of a workbook. */
  function readStatement(file, sheet) {
    if (file.pastedText != null) return Promise.resolve({ text: file.pastedText, sheets: null });
    var name = (file.name || '').toLowerCase();
    if (/\.pdf$/.test(name)) return Promise.reject(new Error(P.NOT_TABULAR_COPY));
    if (/\.xlsx?$/.test(name) && WB) {
      return WB.listSheets(file).catch(function () { return []; }).then(function (sheets) {
        var order = sheet != null ? [sheet] : (sheets.length > 1 ? sheets.slice() : [undefined]);
        var i = 0, firstGot = null;
        function attempt() {
          if (i >= order.length) return Promise.resolve(firstGot);
          var nm = order[i++];
          return WB.readWorkbook(file, nm).then(function (rows) {
            var got = { rows: rows, sheetName: rows.sheetName || nm, sheets: sheets };
            if (!firstGot) firstGot = got;
            var probe = root.SimUpload.portfolioFile(rows, {});
            if (probe.ok || probe.ask) return got;
            return attempt();
          }, attempt);
        }
        return attempt();
      }).catch(function () { throw new Error('That Excel file could not be read here. Open it and save it as CSV, then load that.'); });
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That file could not be opened.')); };
      reader.onload = function () {
        var kind = looksBinary(reader.result);
        if (kind === 'pdf') { reject(new Error(P.NOT_TABULAR_COPY)); return; }
        if (kind) { reject(new Error(BINARY_COPY[kind] || BINARY_COPY.binary)); return; }
        resolve({ text: String(reader.result), sheets: null });
      };
      reader.readAsText(file);
    });
  }

  var FILE_ACCEPT = '.csv,.txt,.tsv,.xls,.xlsx,.json,text/csv,text/comma-separated-values,text/plain,text/tab-separated-values,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream';

  /* the picker takes a moment, and the button says so */
  var PICK_WAIT_MS = 400, PICK_GIVE_UP_MS = 25000, activePick = null;
  function pickDone() { if (activePick) activePick(); }
  function pickBusy(btn) {
    if (!btn || btn.dataset.opening === 'yes') return;
    pickDone();
    btn.dataset.opening = 'yes'; btn.setAttribute('aria-busy', 'true');
    var started = Date.now(), ended = false;
    var giveUp = setTimeout(end, PICK_GIVE_UP_MS);
    activePick = end;
    function end() {
      if (ended) return;
      ended = true;
      if (activePick === end) activePick = null;
      clearTimeout(giveUp);
      window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', shown);
      delete btn.dataset.opening; btn.removeAttribute('aria-busy');
    }
    function soon() { setTimeout(end, Math.max(0, PICK_WAIT_MS - (Date.now() - started))); }
    function back() { soon(); }
    function shown() { if (!document.hidden) soon(); }
    window.addEventListener('focus', back); document.addEventListener('visibilitychange', shown);
    return end;
  }

  /* A page opened inside another app's own browser view, rather than the
     phone's browser, often cannot open a file picker or save a download: the
     host app has to provide both and many do not. Best-effort recognition from
     the user agent, used only to say so where those two buttons live. */
  function inAppBrowser() {
    var ua = (root.navigator && navigator.userAgent) || '';
    if (/; wv\)|\bwv\b.*Chrome\//.test(ua) && /Android/.test(ua)) return true;
    if (/Android/.test(ua) && /Version\/\d+\.\d+/.test(ua) && /Chrome\//.test(ua) && /Mobile/.test(ua)) return true;
    if (/(FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|LinkedInApp|GSA\/|Twitter|TikTok|musical_ly)/i.test(ua)) return true;
    if (/(iPhone|iPad|iPod)/.test(ua) && !/Safari\//.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave)/.test(ua)) return true;
    return false;
  }
  var IN_APP_NOTE = '<strong>This page seems to be open inside another app’s browser, not your phone’s browser.</strong> There, Choose a file and Save as PDF may do nothing. Open this address in your browser (Safari, Chrome or the browser you use) and both work.';

  root.PRCApp = {
    E: E, P: P, F: F, VERSION: VERSION, HORIZONS: HORIZONS,
    money: money, moneyLong: moneyLong, moneyWords: moneyWords, short: short, signedMoney: signedMoney, count: count,
    pct: pct, signedPct: signedPct, share: share, shortName: shortName, chime: chime, echo: F.echo, checkInput: F.checkInput,
    fmtDate: fmtDate, fmtYears: fmtYears, months: months, monthsText: monthsText,
    todayTs: todayTs, isoToday: isoToday, isoOf: isoOf, isoToTs: isoToTs,
    $: $, $$: $$, el: el, esc: esc, notice: notice, term: term, stat: stat, trow: trow, fold: fold, tabs: tabs, pdfFoot: pdfFoot,
    relation: relation, equalWords: equalWords, EQUAL_BAND: EQUAL_BAND, stackTables: stackTables, watchTables: watchTables,
    csvCell: csvCell, fileSlug: fileSlug, downloadText: downloadText,
    show: show, initRouter: initRouter,
    readFile: readFile, readStatement: readStatement, pickBusy: pickBusy, pickDone: pickDone, FILE_ACCEPT: FILE_ACCEPT,
    inAppBrowser: inAppBrowser, IN_APP_NOTE: IN_APP_NOTE
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
