/* Where You Stand: reading a fund house's NAV history out of a PDF.
 *
 * A PDF holds no table, only words placed on a page. The words are taken out
 * on the device with pdf.js (vendor/pdfjs, served with the tool; nothing is
 * fetched from anywhere else), and put back into rows: words on one line are
 * one row, and each is placed under the heading it sits beneath. The rows
 * then go through the same reading as any CSV, held to a stricter standard
 * (parse.js, strict): every dated line must carry its NAV, no date may carry
 * two NAVs, and no day may move the NAV by half or double. A scanned page has
 * no words at all. Any doubt, and nothing is shown: the reader is asked for
 * the Excel file instead.
 *
 *   PRCPdfRows.read(file) -> Promise<rows>        (rejects when there is nothing to read)
 *   PRCPdfRows.rowsFromPages(pages) -> rows       pages: [[{ str, x, y, w, h }]]
 */
(function (root) {
  'use strict';
  var P = (typeof require === 'function') ? require('./parse.js') : root.PRCParse;

  var loading = null;
  function base() { return (root.document && root.document.baseURI) || ''; }
  function lib() {
    if (!loading) {
      loading = import(new URL('vendor/pdfjs/pdf.min.mjs', base()).href).then(function (m) {
        m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', base()).href;
        return m;
      });
      loading.catch(function () { loading = null; });
    }
    return loading;
  }
  /* every page's words, each with its place: x from the left, y from the bottom */
  function pagesOf(data, pdfjs) {
    var task = pdfjs.getDocument({ data: data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0 });
    return task.promise.then(function (doc) {
      var out = [], n = doc.numPages, i = 0;
      function next() {
        if (i >= n) { task.destroy(); return out; }
        i++;
        return doc.getPage(i).then(function (page) {
          return page.getTextContent().then(function (tc) {
            out.push(itemsOf(tc.items));
            page.cleanup();
            return next();
          });
        });
      }
      return next();
    }).catch(function (err) { task.destroy(); throw err; });
  }
  function itemsOf(items) {
    return (items || []).filter(function (it) { return typeof it.str === 'string' && it.transform; }).map(function (it) {
      return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10 };
    });
  }
  function read(file, opts) {
    return file.arrayBuffer().then(function (buf) {
      return lib().then(function (pdfjs) { return pagesOf(new Uint8Array(buf), pdfjs); });
    }, function (err) {
      /* pdf.js names a locked file; anything else is not a PDF that can be opened */
      var e = new Error(err && err.name === 'PasswordException' ? 'locked' : 'unreadable');
      if (err && err.name === 'PasswordException') e.locked = true;
      throw e;
    }).then(function (pages) { return rowsFromPages(pages, opts); });
  }

  /* ------------------------------------------------------------ words into lines */
  /* an item that holds several cells set apart by runs of spaces */
  function splitItem(it) {
    var out = [], n = it.str.length || 1, cw = it.w / n, re = /\S+(?: \S+)*/g, m;
    while ((m = re.exec(it.str))) out.push({ str: m[0], x: it.x + m.index * cw, y: it.y, w: m[0].length * cw, h: it.h });
    return out;
  }
  function linesOf(items) {
    var list = [];
    items.forEach(function (it) { if (it.str && it.str.trim()) splitItem(it).forEach(function (x) { list.push(x); }); });
    list.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    list.forEach(function (it) {
      var line = lines[lines.length - 1];
      if (line && Math.abs(line.y - it.y) <= Math.max(1.5, Math.min(it.h, line.h) * 0.45)) { line.items.push(it); line.h = Math.max(line.h, it.h); }
      else lines.push({ y: it.y, h: it.h, items: [it] });
    });
    lines.forEach(function (l) { l.items.sort(function (a, b) { return a.x - b.x; }); l.segs = segmentsOf(l.items); });
    return lines;
  }
  /* words a space apart are one phrase; a wider gap starts the next cell */
  function segmentsOf(items) {
    var segs = [];
    items.forEach(function (it) {
      var s = segs[segs.length - 1], gap = s ? it.x - s.x1 : Infinity;
      if (s && gap < Math.max(1.2, it.h * 0.6)) { s.text += (gap > it.h * 0.12 ? ' ' : '') + it.str; s.x1 = Math.max(s.x1, it.x + it.w); }
      else segs.push({ text: it.str, x0: it.x, x1: it.x + it.w });
    });
    segs.forEach(function (s) { s.text = s.text.replace(/\s+/g, ' ').trim(); s.c = (s.x0 + s.x1) / 2; });
    return segs.filter(function (s) { return s.text; });
  }
  /* A phrase of nothing but dates and numbers set a single space apart
     ("01-07-2026 52.1034") is split into its parts. */
  var TOKEN = /\d{1,2}[-\/. ](?:[A-Za-z]{3,9}|\d{1,2})[-\/. ]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|[-+(]?₹?\s?[\d,]*\.?\d+\)?%?/g;
  function tokensOf(seg) {
    var t = seg.text, out = [], m, covered = 0, n = t.length || 1, cw = (seg.x1 - seg.x0) / n;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(t))) {
      if (!m[0].trim()) { TOKEN.lastIndex++; continue; }
      if (t.slice(covered, m.index).trim()) return [seg];
      out.push({ text: m[0].trim(), x0: seg.x0 + m.index * cw, x1: seg.x0 + (m.index + m[0].length) * cw });
      covered = m.index + m[0].length;
    }
    if (t.slice(covered).trim() || out.length < 2) return [seg];
    out.forEach(function (s) { s.c = (s.x0 + s.x1) / 2; });
    return out;
  }

  var DATE_WORD = /\bdate\b|\bas on\b|\bperiod\b|\bday\b/;
  var VALUE_WORD = /\bnav\b|\bnet asset value\b|\bvalue\b|\bprice\b|\bclos(e|ing)\b|\brepurchase\b|\bindex\b|\bgrowth\b|\bidcw\b|\bdirect\b|\bregular\b|\btri\b|\btotal returns?\b/;
  /* a statement's headings name an amount, units or what happened */
  var STATEMENT_WORD = /\bamount\b|\bamt\b|\bunits?\b|\btransaction\b|\btype\b|\bdescription\b|\bparticulars\b|\bnarration\b|\bfolio\b|\bscheme\b|\bcash flow\b/;
  function isText(t) { return !P.readsAsDate(t) && !isFinite(P.parseNumber(t)); }
  function headerLine(line, statement) {
    var segs = line.segs;
    if (segs.length < 2 || !segs.every(function (s) { return isText(s.text); })) return false;
    var words = segs.map(function (s) { return P.normHeader(s.text); });
    var named = statement ? function (w) { return VALUE_WORD.test(w) || STATEMENT_WORD.test(w); } : function (w) { return VALUE_WORD.test(w); };
    return words.some(function (w) { return DATE_WORD.test(w); }) && words.some(function (w) { return !DATE_WORD.test(w) && named(w); });
  }
  function dataLine(line) {
    var segs = [];
    line.segs.forEach(function (s) { tokensOf(s).forEach(function (x) { segs.push(x); }); });
    var dated = segs.some(function (s) { return P.readsAsDate(s.text); });
    var numbered = segs.some(function (s) { return !P.readsAsDate(s.text) && isFinite(P.parseNumber(s.text)); });
    return dated && numbered ? segs : null;
  }

  /* Each cell goes under the heading it sits beneath: the boundary between
     two columns is the middle of the gap between their headings. A cell far
     to the right of the last heading is a column of its own. */
  function columnsOf(head) {
    var cols = head.segs.slice().sort(function (a, b) { return a.x0 - b.x0; });
    var bounds = [];
    for (var i = 0; i + 1 < cols.length; i++) bounds.push((cols[i].x1 + cols[i + 1].x0) / 2);
    var last = cols[cols.length - 1], width = Math.max(last.x1 - last.x0, head.h * 2);
    return { cols: cols, bounds: bounds, edge: last.x1 + width, h: head.h };
  }
  function place(segs, layout) {
    var cells = [], extra = [];
    segs.forEach(function (s) {
      if (s.x0 > layout.edge) { extra.push(s.text); return; }
      var k = 0;
      while (k < layout.bounds.length && s.c >= layout.bounds[k]) k++;
      cells[k] = cells[k] ? cells[k] + ' ' + s.text : s.text;
    });
    var out = [];
    for (var i = 0; i < layout.cols.length; i++) out.push(cells[i] || '');
    return out.concat(extra);
  }
  /* a line above the headings that names their groups ("Regular Plan" over
     two columns): each name under the first column it covers */
  function placeGroups(segs, layout) {
    var out = layout.cols.map(function () { return ''; });
    segs.forEach(function (s) {
      var k = -1;
      for (var i = 0; i < layout.cols.length && k === -1; i++) if (s.x1 >= layout.cols[i].x0 - layout.h && s.x0 <= layout.cols[i].x1 + layout.h) k = i;
      if (k === -1) { k = 0; while (k < layout.bounds.length && s.c >= layout.bounds[k]) k++; }
      out[k] = out[k] ? out[k] + ' ' + s.text : s.text;
    });
    return out;
  }
  function joined(line) { return [line.segs.map(function (s) { return s.text; }).join(' ')]; }

  function rowsFromPages(pages, opts) {
    var statement = !!(opts && opts.statement);
    var rows = [], layout = null, words = 0, heads = [];
    var SUMMARY = /\bnav range\b|\b52\s*weeks?\b|\bhighest\b|\blowest\b/;
    function noteHead(line) {
      var key = line.segs.map(function (s) { return P.normHeader(s.text); }).join('|');
      /* a summary's headings (a year's highest and lowest NAV) are not another table */
      if (SUMMARY.test(key)) return;
      if (heads.indexOf(key) === -1) heads.push(key);
    }
    (pages || []).forEach(function (items) {
      var lines = linesOf(items);
      words += lines.length;
      var at = -1;
      for (var i = 0; i < lines.length && at === -1; i++) if (headerLine(lines[i], statement)) at = i;
      if (at !== -1) { layout = columnsOf(lines[at]); noteHead(lines[at]); }
      lines.forEach(function (line, i) {
        if (at !== -1 && i < at) {
          /* the line just over the headings may name their groups */
          var near = i === at - 1 && line.y - lines[at].y <= lines[at].h * 1.9 && line.segs.every(function (s) { return isText(s.text); }) &&
            line.segs.some(function (s) { return s.x0 > layout.cols[0].x1; });
          rows.push(near ? placeGroups(line.segs, layout) : joined(line));
          return;
        }
        if (i === at || (layout && headerLine(line, statement))) { if (i !== at) noteHead(line); rows.push(layout ? place(line.segs, columnsOf(line)) : joined(line)); return; }
        var segs = layout ? dataLine(line) : null;
        rows.push(segs ? place(segs, layout) : joined(line));
      });
    });
    if (!words) { var scanned = new Error('no words in this PDF'); scanned.scanned = true; throw scanned; }
    if (!layout) throw new Error('no table of dates and values in this PDF');
    /* how many differently headed tables the pages hold: a statement is read only from one */
    rows.tables = heads.length;
    return rows;
  }

  var api = { read: read, rowsFromPages: rowsFromPages, itemsOf: itemsOf, linesOf: linesOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PRCPdfRows = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
