/* The Portfolio Reality Check — interface.
 *
 * No framework, no network, no storage. Every figure a reader types stays in
 * this page's memory and dies with the tab, which is the only honest way to
 * promise privacy.
 */
(function () {
  'use strict';

  var E = window.PRCEngine, P = window.PRCParse;
  var VERSION = '1.0';
  var HORIZONS = [1, 3, 5, 7, 10];

  /* ------------------------------------------------------------ formatting */

  var rupee, plain;
  try {
    rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
    plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  } catch (e) { rupee = null; plain = null; }

  function money(n) {
    if (!isFinite(n)) return '—';
    var v = Math.round(n);
    return rupee ? rupee.format(v) : '₹' + v.toLocaleString();
  }
  /* Indian readers think in lakh and crore, so say it their way alongside. */
  function scale(n) {
    var a = Math.abs(n);
    if (a >= 1e7) return (n / 1e7).toFixed(a >= 1e8 ? 0 : 2) + ' crore';
    if (a >= 1e5) return (n / 1e5).toFixed(a >= 1e6 ? 0 : 1) + ' lakh';
    return null;
  }
  function moneyLong(n) {
    var s = scale(n);
    return money(n) + (s ? ' (about ₹' + s + ')' : '');
  }
  function pct(r, dp) { return (r * 100).toFixed(dp == null ? 1 : dp) + '%'; }
  function signedPct(r) { return (r > 0 ? '+' : '') + pct(r); }

  function fmtDate(t) {
    var d = new Date(t);
    var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return String(d.getUTCDate()).padStart(2, '0') + '-' + M[d.getUTCMonth()] + '-' + d.getUTCFullYear();
  }
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

  var VIEWS = ['home', 'portfolio', 'goal', 'history', 'fund', 'method', 'about'];

  function show(name, initial) {
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
      if (t) { ev.preventDefault(); show(t.dataset.go); }
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

  function readFile(file, onSeries, onError) {
    var name = (file.name || '').toLowerCase();
    if (/\.xlsx?$/.test(name)) {
      readWorkbook(file).then(function (rows) {
        finish(P.rowsToSeries(rows));
      }).catch(function (err) {
        onError('That Excel file could not be read here (' + err.message + '). Open it and save it as CSV, then load that.');
      });
      return;
    }
    var fr = new FileReader();
    fr.onerror = function () { onError('That file could not be opened.'); };
    fr.onload = function () { finish(P.parseSeriesText(fr.result)); };
    fr.readAsText(file);

    function finish(res) {
      if (!res.ok) { onError(res.message); return; }
      onSeries(res);
    }
  }

  /* Minimal .xlsx reader: a zip, inflated by the browser itself. No library,
   * so nothing to go stale. Falls back to a plain message where the browser
   * has no DecompressionStream. */
  function readWorkbook(file) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('this browser cannot unzip it'));
    }
    return file.arrayBuffer().then(function (buf) {
      var entries = unzip(new Uint8Array(buf));
      var sheet = entries['xl/worksheets/sheet1.xml'];
      if (!sheet) {
        var first = Object.keys(entries).filter(function (k) { return /^xl\/worksheets\/.*\.xml$/.test(k); }).sort()[0];
        sheet = first && entries[first];
      }
      if (!sheet) throw new Error('no worksheet inside');
      return Promise.all([
        inflate(sheet),
        entries['xl/sharedStrings.xml'] ? inflate(entries['xl/sharedStrings.xml']) : Promise.resolve(''),
        entries['xl/styles.xml'] ? inflate(entries['xl/styles.xml']) : Promise.resolve('')
      ]).then(function (xml) { return sheetToRows(xml[0], xml[1], xml[2]); });
    });
  }

  function unzip(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var out = {};
    /* walk local file headers; enough for the flat packages Excel writes */
    var i = 0;
    while (i < bytes.length - 4) {
      if (view.getUint32(i, true) !== 0x04034b50) break;
      var method = view.getUint16(i + 8, true);
      var compSize = view.getUint32(i + 18, true);
      var uncompSize = view.getUint32(i + 22, true);
      var nameLen = view.getUint16(i + 26, true);
      var extraLen = view.getUint16(i + 28, true);
      var nameStart = i + 30;
      var name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
      var dataStart = nameStart + nameLen + extraLen;
      if (compSize === 0 && uncompSize === 0) break;   /* streamed entry: give up cleanly */
      out[name] = { method: method, data: bytes.subarray(dataStart, dataStart + compSize) };
      i = dataStart + compSize;
    }
    if (!Object.keys(out).length) throw new Error('not a readable workbook');
    return out;
  }

  function inflate(entry) {
    if (entry.method === 0) return Promise.resolve(new TextDecoder().decode(entry.data));
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([entry.data]).stream().pipeThrough(ds);
    return new Response(stream).text();
  }

  var DATE_FORMAT_IDS = [14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57, 58];

  function sheetToRows(sheetXml, sharedXml, stylesXml) {
    var dom = new DOMParser();
    var shared = [];
    if (sharedXml) {
      var sdoc = dom.parseFromString(sharedXml, 'application/xml');
      Array.prototype.forEach.call(sdoc.getElementsByTagName('si'), function (si) {
        var text = '';
        Array.prototype.forEach.call(si.getElementsByTagName('t'), function (t) { text += t.textContent; });
        shared.push(text);
      });
    }
    /* which cell styles mean "this number is a date" */
    var dateStyles = {};
    if (stylesXml) {
      var stdoc = dom.parseFromString(stylesXml, 'application/xml');
      var customDate = {};
      Array.prototype.forEach.call(stdoc.getElementsByTagName('numFmt'), function (f) {
        var code = f.getAttribute('formatCode') || '';
        if (/[dmy]/i.test(code) && !/[#0]/.test(code.replace(/\[[^\]]*\]/g, ''))) {
          customDate[f.getAttribute('numFmtId')] = true;
        }
      });
      var xfs = stdoc.getElementsByTagName('cellXfs')[0];
      if (xfs) Array.prototype.forEach.call(xfs.getElementsByTagName('xf'), function (xf, idx) {
        var id = xf.getAttribute('numFmtId');
        if (customDate[id] || DATE_FORMAT_IDS.indexOf(+id) !== -1) dateStyles[idx] = true;
      });
    }

    var doc = dom.parseFromString(sheetXml, 'application/xml');
    var rows = [];
    Array.prototype.forEach.call(doc.getElementsByTagName('row'), function (r) {
      var cells = [];
      Array.prototype.forEach.call(r.getElementsByTagName('c'), function (c) {
        var ref = c.getAttribute('r') || '';
        var col = colIndex(ref.replace(/\d+/g, ''));
        var type = c.getAttribute('t');
        var styleIdx = c.getAttribute('s');
        var vNode = c.getElementsByTagName('v')[0];
        var value = '';
        if (type === 'inlineStr') {
          var isNode = c.getElementsByTagName('t')[0];
          value = isNode ? isNode.textContent : '';
        } else if (type === 's') {
          value = shared[+(vNode ? vNode.textContent : -1)] || '';
        } else if (vNode) {
          value = vNode.textContent;
          if (dateStyles[+styleIdx] && isFinite(+value)) value = serialToIso(+value);
        }
        while (cells.length < col) cells.push('');
        cells[col] = value;
      });
      if (cells.some(function (c) { return c !== ''; })) rows.push(cells);
    });
    if (!rows.length) throw new Error('the first sheet is empty');
    return rows;
  }

  function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return Math.max(0, n - 1);
  }
  /* Excel counts days from 30 December 1899, and pretends 1900 was a leap year. */
  function serialToIso(serial) {
    var ms = Math.round((serial - 25569) * 86400000);
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(d.getUTCDate()).padStart(2, '0');
  }

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
    E: E, P: P, VERSION: VERSION, HORIZONS: HORIZONS,
    money: money, moneyLong: moneyLong, scale: scale, pct: pct, signedPct: signedPct,
    fmtDate: fmtDate, isoToday: isoToday, isoToTs: isoToTs,
    $: $, $$: $$, el: el, esc: esc, notice: notice, show: show,
    histogramChart: histogramChart, goalChart: goalChart,
    readFile: readFile, wireDrop: wireDrop, initRouter: initRouter
  };
})();
