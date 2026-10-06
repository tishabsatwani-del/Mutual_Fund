/* Where You Stand: the file door, shared by every screen.
 *
 * One component, one behaviour everywhere: choose a file (or several pieces
 * of one history), drop it, or paste rows or a whole page. The box itself
 * shows the state (reading, added with rows and dates, or refused with the
 * reason), so nobody has to scroll to find out whether a tap worked. A file
 * holding many schemes shows a picker inside the door. Several pieces of one
 * history (files, pastes, or both, in any order) are joined by date under the
 * rules of pieces.js, and each piece can be removed on its own.
 *
 *   PRCDoors.mount(hostEl, { prefix, kind: 'nav'|'index'|'any', label, hint,
 *                            onLoaded(result|null), gate(rows, name),
 *                            ask(result) -> null or { question, refusal },
 *                            describe(result) -> null or { tag, html, plain },
 *                            idcwFlag: flags an IDCW option's NAV on the card })
 *   result: { series, name, report, files, gaps, kindGuess, rows, file, parts, pieces }
 *
 * The "Get your file" guides live here too, written so that they stay true
 * when a website's buttons move: they say what the file is, where that kind
 * of file comes from, and what a good one looks like.
 */
(function (root) {
  'use strict';
  var A = root.PRCApp, E = root.PRCEngine, P = root.PRCParse, U = root.SimUpload, J = root.PRCPieces;
  var $ = A.$, $$ = A.$$, esc = A.esc, notice = A.notice, fmtDate = A.fmtDate;

  /* ------------------------------------------------------- the guides */
  var SAMPLE = {
    nav: 'Scheme Name;Net Asset Value;Date\nExample Fund - Growth;24.7805;03-Jan-2011\nExample Fund - Growth;24.9012;04-Jan-2011\nExample Fund - Growth;24.8377;05-Jan-2011',
    index: 'Index Name,Date,Total Returns Index\nExample Index,03 Jan 2011,6000.12\nExample Index,04 Jan 2011,6031.55\nExample Index,05 Jan 2011,5998.40',
    ledger: 'Date,Transaction Type,Scheme Name,Amount,Units\n05-Apr-2021,Purchase,Example Fund - Growth,10000,403.523\n05-May-2021,SIP,Example Fund - Growth,10000,391.880\n12-Jun-2024,Redemption,Example Fund - Growth,150000,3714.211',
    holdings: 'Scheme Name,Units,Invested Amount,Current Value\nExample Fund - Growth,1234.567,640000,912345.50\nExample Debt Fund - Growth,17857.143,200000,241000.00'
  };
  function sampleBlock(text) {
    return '<pre class="sample" aria-label="Sample rows">' + esc(text) + '</pre>';
  }
  function videoBlock(src, what) {
    return '<details class="explain inner"><summary>Watch the download done on a phone</summary><div class="body">' +
      '<video controls playsinline preload="none" src="' + src + '"></video>' +
      '<p class="hint">' + esc(what) + ' The site may look different from this recording; what you are looking for is the same file.</p>' +
      '</div></details>';
  }
  /* A history in several pieces: official sites limit one download to a
     stretch, and every piece added here is joined into one. */
  var PIECES_LINE = 'Official sites let you download only a limited period at a time (for example 90 days on AMFI). Download the history in several pieces and add every piece here. The tool joins them into one.';
  /* A fund's NAV history, in steps that stay true when a website changes:
     no dates, and no site named. */
  function navSteps() {
    return '<ol class="steps">' +
      '<li>Search for the scheme’s name followed by “NAV history” (for example: [scheme name] NAV history). This usually opens the fund house’s NAV history page directly; browsing the fund house’s site may not show it.</li>' +
      '<li>On that page, find the NAV section, then its NAV history / historical NAV.</li>' +
      '<li>Choose your plan and option (for example Direct, Growth) and the period you want (for example 1 year, 5 years, or a custom range).</li>' +
      '<li>Download it as Excel or PDF.</li>' +
      '<li>If the site shows the NAVs but has no download button, select all on that page, copy, and paste it into the paste box here.</li>' +
      '<li>Upload that file here.</li>' +
      '</ol><p class="hint">If the site’s layout has changed, look for “NAV history” or “historical NAV” on the scheme’s page.</p>' +
      '<p class="hint">' + esc(PIECES_LINE) + '</p>';
  }
  var GUIDES = {
    nav: function () {
      return '<details class="explain howto"><summary>Get your fund’s NAV file: where, which file, what it looks like</summary><div class="body">' +
        navSteps() +
        '<p><strong>What a good file looks like</strong> (any of these date forms is read):</p>' + sampleBlock(SAMPLE.nav) +
        '</div></details>';
    },
    index: function () {
      return '<details class="explain howto"><summary>Get the index file: where, which report, what it looks like</summary><div class="body">' +
        '<p><strong>The file:</strong> the daily values of the benchmark index, in its <em>total return</em> form (TRI), which counts dividends the way a fund’s NAV does. A price index leaves dividends out and reads lower every year; it is accepted only with a flag that says so.</p>' +
        '<p><strong>Where:</strong> the index provider’s own website. For the indices most Indian funds are measured against, that is the site of the exchange’s index company: its historical data or reports section, the total returns report, your index, the dates, then the download link.</p>' +
        '<p><strong>If the site limits one download to a shorter stretch:</strong> ' + esc(PIECES_LINE) + ' Download every piece from the same report: a total return piece and a price piece are never joined.</p>' +
        '<p><strong>What a good file looks like:</strong></p>' + sampleBlock(SAMPLE.index) +
        '<p><strong>Which index:</strong> the one named as the benchmark in your fund’s factsheet or scheme document.</p>' +
        videoBlock('media/nse-tri-download.mp4', 'A real total-return-index download recorded on a phone, about a minute, including a download limit and how to work inside it.') +
        '</div></details>';
    },
    statement: function () {
      return '<details class="explain howto"><summary>Get your statement: where, which file, what it looks like</summary><div class="body">' +
        '<p><strong>Two files work.</strong> A <em>transaction statement</em> lists every payment with its date, and gives you the yearly rate. A <em>holdings statement</em> lists each fund with what you put in and what it is worth now, and gives you the total gain but no yearly rate, because it holds no dates.</p>' +
        '<p><strong>Where:</strong> wherever you invest, under <em>Reports</em>, <em>Statements</em> or <em>Transactions</em>: your fund house’s website or app, the app or platform you buy through, or the registrar’s portal. Choose <strong>Excel or CSV</strong>, not PDF, and the widest date range offered, from your first purchase to today.</p>' +
        '<p><strong>The consolidated statement that arrives by email is a PDF.</strong> A PDF is read here only when it is one plain table of text with its headings; a scanned page, a locked file or a statement laid out as several tables is refused, and the site that sends it offers the same transactions as Excel or CSV. If you cannot find a download, type your entries in instead: it takes a few minutes.</p>' +
        '<p><strong>What a good transaction file looks like:</strong></p>' + sampleBlock(SAMPLE.ledger) +
        '<p><strong>What a good holdings file looks like:</strong></p>' + sampleBlock(SAMPLE.holdings) +
        '<p><strong>If it fails:</strong> the box says why. A file with unsigned amounts asks you once which words mean money out. A fund’s daily price file belongs on the Rolling returns screen, not here.</p>' +
        '</div></details>';
    },
    any: function () {
      return '<details class="explain howto"><summary>Get the file: a fund’s NAV history or an index’s values</summary><div class="body">' +
        '<p><strong>A fund’s NAV history:</strong></p>' + navSteps() +
        '<p><strong>An index:</strong> its total return values from the index provider’s site. One row per day, a date and a value. If a download is limited to a shorter stretch, download the pieces and add them all here; a total return piece and a price piece are never joined.</p>' +
        '<p><strong>What a good file looks like:</strong></p>' + sampleBlock(SAMPLE.nav) + sampleBlock(SAMPLE.index) +
        '</div></details>';
    }
  };
  function guide(kind) { return (GUIDES[kind] || GUIDES.any)(); }

  /* An IDCW option's NAV in a screen that measures returns: on the file's
     card and on the result, in these words. */
  var IDCW_FLAG = 'This is an IDCW option’s NAV. It drops each time a payout is made, so these returns leave the payouts out and read lower than the fund’s Growth record. The Growth option’s NAV gives the fund’s full record.';
  /* the pieces could not be told to be one history, and the reader said they are not */
  var PIECES_NO = 'Add the pieces of one fund, plan and option only. Remove the piece that does not belong, below.';

  /* ------------------------------------------------------------ the door */
  var seq = 0;
  var NOUN = { nav: 'fund', index: 'index', any: 'fund or index' };
  function mount(host, opts) {
    var o = opts || {};
    var prefix = o.prefix || ('door' + (seq++));
    var kind = o.kind || 'any';
    var noun = o.noun || NOUN[kind] || 'fund or index';
    var state = { pieces: [], series: null, name: '', report: null, rows: null, schemes: null, picked: null, kindGuess: null, pastes: 0 };
    var answers = {};   /* a question a slot asks of a file, answered once for that file */
    function keyOf(p) { return p.sig || p.name + '|' + (p.rows ? p.rows.length + '|' + JSON.stringify(p.rows.slice(0, 3)) : ''); }

    host.innerHTML =
      (o.label ? '<label class="fieldlabel" for="' + prefix + '-file">' + esc(o.label) + '</label>' : '') +
      '<div class="filebox" id="' + prefix + '-drop">' + idleHtml() + '</div>' +
      '<p class="hint tight" id="' + prefix + '-dup" aria-live="polite" hidden>This file is already added.</p>' +
      '<div id="' + prefix + '-status" aria-live="polite"></div>' +
      '<ul class="pieces" id="' + prefix + '-pieces" aria-label="The pieces added" hidden></ul>' +
      '<button class="secondary pastebtn" type="button" id="' + prefix + '-paste-open">Paste the rows instead (two columns, or a whole page)</button>' +
      '<div class="pastebox" id="' + prefix + '-paste-box" hidden>' +
        '<label class="fieldlabel" for="' + prefix + '-paste-text">Paste the date column and the value column here, or a whole page copied with select all</label>' +
        '<textarea id="' + prefix + '-paste-text" rows="6" spellcheck="false" placeholder="01-Jan-2020\t45.1234\n02-Jan-2020\t45.2210"></textarea>' +
        '<p class="hint">A numeric date such as 01-02-2020 is read day first, as 1 February 2020. Write 01-Feb-2020 or 2020-02-01 to be certain. From a whole page only the rows of dates and NAVs are read; menus, headings and summary tables are ignored, and the box says what it took.</p>' +
        '<div class="btnrow"><button class="secondary" type="button" id="' + prefix + '-paste-read">Read these rows</button></div>' +
      '</div>' +
      '<div class="picker-wrap" id="' + prefix + '-scheme-wrap" hidden>' +
        '<div class="field"><label for="' + prefix + '-scheme-q">Which one in that file?</label>' +
        '<input type="text" id="' + prefix + '-scheme-q" autocomplete="off" placeholder="Type part of the name"><p class="hint" id="' + prefix + '-scheme-count"></p></div>' +
        '<div id="' + prefix + '-scheme-list" class="picker" role="listbox" aria-label="Schemes in this file"></div>' +
        '<p class="hint" id="' + prefix + '-scheme-note">Official downloads hold every scheme of a fund house in one file. Pick the exact name on your statement; the plan and the option are part of the name, and each is a separate row.</p>' +
      '</div>';

    /* The control is the browser's own file input, visible and styled: no
       script click and no label stands between the tap and the picker, so
       the one thing every browser can do on its own is the thing that happens. */
    function pickHtml(word) {
      return '<span class="filewrap"><input type="file" class="filepick" id="' + prefix + '-file" multiple' +
        ' accept="' + A.FILE_ACCEPT + '" aria-label="' + esc(word) + '" title="' + esc(word) + '"></span>';
    }
    function idleHtml() {
      return pickHtml('Choose a file') +
        '<p>' + esc(o.hint || 'CSV, Excel, PDF or text · a date column and a value column is all it needs · several pieces of one history are joined') + '</p>';
    }
    function box() { return $('#' + prefix + '-drop'); }
    function setState(cls, icon, name, sub, action) {
      var b = box();
      if (!b) return;
      b.className = 'filebox ' + cls;
      b.innerHTML = '<div class="fileok"><span class="fileok-ic" aria-hidden="true">' + icon + '</span>' +
        '<span class="fileok-t"><strong class="fileok-name">' + esc(name) + '</strong><span class="fileok-sub">' + sub + '</span></span></div>' +
        (action ? pickHtml(action) : '');
    }
    function reading(name) { setState('working', '<span class="spin"></span>', name, 'Reading the file…', ''); }
    /* one sound for each thing the reader does: the first outcome of an attempt */
    var armed = false;
    function chime(kind) { if (!armed) return; armed = false; if (A.chime) A.chime(kind); }
    function dup(show) { var d = $('#' + prefix + '-dup'); if (d) d.hidden = !show; }
    /* the same file is its name and its size; the same paste is its text: chosen again, it is not read again */
    function sigOf(f) { return f && f.pastedText == null ? f.name + '|' + f.size : f ? 'paste|' + hash(f.pastedText) : null; }
    function hash(t) { var h = 5381; for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + '|' + t.length; }
    function added(name, sub) { chime('ok'); setState('loaded', '✓', name, '<strong class="ok-word">File added</strong>' + (sub ? ': ' + sub : ''), 'Add another piece, or change it'); }
    function refused(name) { chime('no'); setState('refused', '!', name, '<strong class="bad-word">Not added.</strong> The reason is below.', 'Choose another file'); }
    /* H1: one status per slot. Every new attempt replaces what was there. */
    function say(html) { var st = $('#' + prefix + '-status'); if (st) st.innerHTML = html || ''; }
    function hidePicker() { var w = $('#' + prefix + '-scheme-wrap'); if (w) { w.hidden = true; $$('.pickedline', w).forEach(function (l) { l.remove(); }); } }
    function empty() {
      state.pieces = []; state.series = null; state.name = ''; state.report = null; state.rows = null; state.schemes = null; state.picked = null; state.kindGuess = null;
    }
    function clear() {
      empty();
      var b = box(); if (b) { b.className = 'filebox'; b.innerHTML = idleHtml(); }
      say(''); hidePicker(); dup(false); armed = false; renderPieces();
      $('#' + prefix + '-paste-text').value = ''; $('#' + prefix + '-paste-box').hidden = true;
      $('#' + prefix + '-paste-open').textContent = PASTE_OPEN;
      if (o.onLoaded) o.onLoaded(null);
    }
    var PASTE_OPEN = 'Paste the rows instead (two columns, or a whole page)';

    /* Files arrive one at a time or several at once; each becomes a piece.
       A file that cannot be read is not added, and the pieces already there
       stay as they were: the box shows that refusal, and the list below
       still shows what is kept. A file chosen again under the same name
       replaces its piece. */
    function takeFiles(files) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      var have = state.pieces.map(function (p) { return p.sig; });
      var fresh0 = list.filter(function (f) { var s = sigOf(f); return !s || have.indexOf(s) === -1; });
      dup(fresh0.length < list.length);
      if (!fresh0.length) return;
      list = fresh0;
      armed = true;
      reading(list.length === 1 ? list[0].name : list.length + ' files');
      say(''); hidePicker();
      var fresh = [], i = 0;
      function next() {
        if (i >= list.length) { landed(fresh); return; }
        var f = list[i++];
        A.readFile(f, function (res) { fresh.push(piece(f, res, null)); next(); },
          function (msg, extra) { fresh.push(piece(f, null, { msg: msg, extra: extra })); next(); }, function () {}, { noun: noun });
      }
      next();
    }
    function piece(file, res, err) { var p = pieceOf(file, res, err); p.sig = sigOf(file); p.isPaste = file.pastedText != null; return p; }
    function pieceOf(file, res, err) {
      var rows = res ? res.rows : (err && err.extra && err.extra.rows) || null;
      var refusal = rows ? (o.gate ? o.gate(rows, file.name) : schemaRefusal(rows)) : null;
      if (refusal) return { name: file.name, refused: refusal };
      if (res) return { name: file.name, res: res, rows: rows, page: res.page || null };
      if (err && err.extra && err.extra.schemes && rows) return { name: file.name, rows: rows, schemes: err.extra.schemes, hasNames: err.extra.hasNames !== false, variants: !!err.extra.variants, page: err.extra.page || null };
      return { name: file.name, refused: notice('bad', esc(err ? err.msg : 'That file could not be read.')) };
    }
    function landed(fresh) {
      state.fresh = fresh.map(keyOf);   /* the files of this attempt: a question is about them */
      var bad = fresh.filter(function (p) { return p.refused; }), good = fresh.filter(function (p) { return !p.refused; });
      if (bad.length) {
        refused(bad.length === 1 ? bad[0].name : bad.length + ' of ' + fresh.length + ' files');
        say(bad.map(function (p) { return (bad.length > 1 ? '<p class="hint tight"><strong>' + esc(p.name) + '</strong></p>' : '') + p.refused; }).join('') +
          (good.length ? '<p class="hint">' + (good.length === 1 ? 'The other file of this attempt, ' + esc(good[0].name) + ', was not added either. Choose it again on its own.' : 'The other files of this attempt were not added either. Choose them again without the one refused.') + '</p>' : '') +
          (state.pieces.length ? '<p class="hint">' + (state.pieces.length === 1 ? 'The piece already added stays as it was.' : 'The ' + state.pieces.length + ' pieces already added stay as they were.') + '</p>' : ''));
        renderPieces();
        if (!state.pieces.length && o.onLoaded) o.onLoaded(null);
        return;
      }
      fresh.forEach(function (p) {
        state.pieces = state.pieces.filter(function (q) { return q.name !== p.name; });
        state.pieces.push(p);
      });
      assemble();
    }
    function schemaRefusal(rows) {
      if (!rows || !P.checkSchema) return null;
      var v = P.checkSchema(rows, { slot: kind });
      if (v.ok) return null;
      var found = (v.detected || []).filter(Boolean).slice(0, 10);
      return notice('bad', esc(v.message) + (found.length ? ' <br>The columns found in this file: <strong>' + found.map(function (n) { return esc(String(n)); }).join('</strong>, <strong>') + '</strong>.' : ''));
    }
    /* the kind of index a piece is, by its own words: total return, price, or not said */
    function kindOf(p) {
      if (!p.rows || state.kindGuess === 'nav') return null;
      var k = P.indexOrFund(p.rows, p.name);
      if (k.verdict === 'fund') return null;
      if (k.kind) return k.kind;
      var nm = String(p.name || '').replace(/[_.\-]+/g, ' ');
      if (/\b(tri|total\s*returns?)\b/i.test(nm)) return 'TRI';
      if (/\b(pri|price\s*(returns?|index))\b/i.test(nm)) return 'PRICE';
      return null;
    }

    /* ------------------------------------------------ the pieces, listed */
    function renderPieces() {
      var ul = $('#' + prefix + '-pieces');
      if (!ul) return;
      var list = state.pieces.filter(function (p) { return !p.refused; });
      var show = list.length > 1 || list.some(function (p) { return p.isPaste; });
      ul.hidden = !show;
      if (!show) { ul.innerHTML = ''; return; }
      ul.innerHTML = list.map(function (p, i) {
        var sub = '';
        if (p.part) sub = p.part.series.length.toLocaleString('en-IN') + ' NAVs · ' + fmtDate(p.part.series[0].t) + ' to ' + fmtDate(p.part.series[p.part.series.length - 1].t);
        else if (p.res) sub = p.res.series.length.toLocaleString('en-IN') + ' NAVs · ' + fmtDate(p.res.report.firstDate) + ' to ' + fmtDate(p.res.report.lastDate);
        else if (p.schemes) sub = p.schemes.length.toLocaleString('en-IN') + (p.variants ? ' plans and options' : ' schemes') + (state.picked ? '' : ' · waiting for your choice');
        if (p.left) sub += ' · does not hold the chosen scheme, left out';
        return '<li class="piece"><span class="pc-t"><strong class="pc-name">' + esc(p.name) + '</strong><span class="pc-sub">' + sub + '</span></span>' +
          '<button class="link pc-remove" type="button" data-i="' + i + '" aria-label="Remove ' + esc(p.name) + '">Remove</button></li>';
      }).join('');
      $$('.pc-remove', ul).forEach(function (b) {
        b.addEventListener('click', function () {
          var p = list[+b.dataset.i];
          state.pieces = state.pieces.filter(function (q) { return q !== p; });
          if (!state.pieces.length) { clear(); return; }
          armed = true; say(''); hidePicker();
          assemble();
        });
      });
    }

    /* join the pieces: many-scheme pieces ask once, the rest are stitched */
    function assemble() {
      var many = state.pieces.filter(function (p) { return p.schemes; });
      var good = state.pieces.filter(function (p) { return p.res; });
      state.pieces.forEach(function (p) { p.part = null; p.left = false; });
      if (many.length) {
        /* the scheme is chosen once, from the union of keys, and applied to every piece that has it */
        var byKey = {}, hasNames = many.some(function (p) { return p.hasNames; }), variants = many.every(function (p) { return p.variants; });
        many.forEach(function (p) {
          p.schemes.forEach(function (s) {
            var k = s.key || s.name;
            var x = byKey[k] = byKey[k] || { key: k, name: s.name || '', code: s.code || '', rows: 0, first: s.first, last: s.last, names: [], label: s.label || null };
            x.rows += s.rows; if (s.first < x.first) x.first = s.first;
            if (s.last >= x.last && s.name) x.name = s.name;
            if (s.last > x.last) x.last = s.last;
            if (!x.name && s.name) x.name = s.name;
            (s.names || []).forEach(function (n) { if (x.names.indexOf(n) === -1) x.names.push(n); });
          });
        });
        var schemes = Object.keys(byKey).map(function (k) { return byKey[k]; })
          .sort(function (a, b) { return (a.name || a.key).localeCompare(b.name || b.key); });
        state.schemes = schemes;
        if (state.picked && byKey[state.picked]) { showPicker(schemes, hasNames, function (sc) { pickScheme(sc.key); }, variants, true); pickScheme(state.picked); return; }
        added(many.length === 1 ? many[0].name : many.length + ' files', schemes.length.toLocaleString('en-IN') + (variants ? ' plans and options found. Choose one below.' : ' schemes found. Choose one below.') +
          (good.length ? ' The same choice applies to every piece.' : ''));
        say('');
        showPicker(schemes, hasNames, function (sc) { pickScheme(sc.key); }, variants);
        renderPieces();
        if (o.onLoaded) o.onLoaded(null);
        return;
      }
      good.forEach(function (p) { p.part = { name: p.name, series: p.res.series, report: p.res.report, rows: p.rows, sig: p.sig, page: p.page }; });
      finish(good.map(function (p) { return p.part; }));
    }
    function pickScheme(key) {
      state.picked = key;
      var list = [], failed = [];
      state.pieces.forEach(function (p) {
        if (p.res) { p.part = { name: p.name, series: p.res.series, report: p.res.report, rows: p.rows, sig: p.sig, page: p.page }; list.push(p.part); return; }
        if (!p.schemes) return;
        /* a PDF's rows are held to the strict standard here too */
        var r = P.rowsToSeries(p.rows, { scheme: key, noun: noun, fileName: p.name, strict: /\.pdf$/i.test(p.name), doubtCopy: P.PDF_COPY });
        if (r.ok) { p.part = { name: p.name, series: r.series, report: r.report, rows: p.rows, sig: p.sig, page: p.page }; list.push(p.part); }
        else { p.left = r.code === 'NO_SUCH_SCHEME'; failed.push({ name: p.name, message: r.message, code: r.code }); }
      });
      if (!list.length) {
        /* the chosen scheme could not be read from any piece: say why, keep the picker */
        chime('no');
        say(notice('bad', esc(failed.length ? failed[0].message : 'None of the files could be read as this scheme.')));
        state.series = null; renderPieces(); if (o.onLoaded) o.onLoaded(null);
        return;
      }
      finish(list, failed.filter(function (f) { return f.code === 'NO_SUCH_SCHEME'; }).length);
    }
    function finish(list, missingIn) {
      if (!list.length) { say(notice('bad', 'None of the files could be read.')); renderPieces(); return; }
      var name = null;
      /* the kind the history is, by its words, before the pieces are checked against each other */
      state.kindGuess = P.guessDataKind(list[0].rows, list[0].name).kind;
      var check = J.check(list.map(function (p) { return { name: p.name, series: p.series, report: p.report, kind: kindOf(p) }; }));
      if (!check.ok) {
        chime('no');
        state.series = null; state.report = null;
        var newest = state.pieces.filter(function (p) { return !p.refused; }).slice(-1)[0];
        setState('refused', '!', list[list.length - 1].name, '<strong class="bad-word">Not joined.</strong> The reason is below.', 'Choose another file');
        /* the way out, both ways: remove a piece below, or keep only the one just added */
        say(notice('bad', esc(check.refusal)) + (newest && state.pieces.length > 1
          ? '<div class="btnrow" style="margin-top:.6rem"><button class="secondary" type="button" id="' + prefix + '-keep-new">Keep only ' + esc(newest.name) + '</button></div>' : ''));
        renderPieces();
        var keep = $('#' + prefix + '-keep-new');
        if (keep) keep.addEventListener('click', function () { state.pieces = [newest]; if (!newest.schemes) state.picked = null; armed = true; say(''); hidePicker(); assemble(); });
        if (o.onLoaded) o.onLoaded(null);
        return;
      }
      var joined = U.stitch(list.map(function (p) { return p.series; }));
      var report = mergeReports(list, joined);
      name = report.title || report.scheme || list[0].name.replace(/\.[^.]+$/, '');
      state.series = joined.series; state.name = name; state.report = report; state.rows = list[0].rows;
      /* the file's own name too, where the card's title is the scheme's */
      var files = list.map(function (p) { return p.name; }).filter(function (n, i, a) { return n && a.indexOf(n) === i; });
      var named = files.length === 1 && files[0].replace(/\.[^.]+$/, '') === name ? '' : esc(files.join(', ')) + ' · ';
      var pdf = list.every(function (p) { return /\.pdf$/i.test(p.name || ''); });
      var sub = list.length > 1
        ? esc(J.summaryLine(check.summary))
        : named + report.used.toLocaleString('en-IN') + (pdf ? ' NAVs read · ' : ' rows read · ') + fmtDate(report.firstDate) + ' to ' + fmtDate(report.lastDate);
      /* a fund's file says which plan and option it holds; an index has none */
      var fundFile = state.kindGuess !== 'index' && (report.variantLabel || kind === 'nav' || state.kindGuess === 'nav');
      if (fundFile) sub += ' · ' + esc(report.variantLabel || 'plan and option not stated in the file');
      var idcw = !!(o.idcwFlag && fundFile && isIdcw({ report: report, kindGuess: state.kindGuess }));
      var res = { series: state.series, name: name, report: report, files: list.length, gaps: joined.gaps, kindGuess: state.kindGuess, rows: state.rows,
                  file: list[0].name, parts: list.map(function (p) { return { rows: p.rows, name: p.name }; }), pieces: check.summary };
      function land() {
        var extra = o.describe ? o.describe(res) : null;
        added(name, sub + (extra && extra.tag ? ' · <strong' + (extra.plain ? '' : ' class="warn-word"') + '>' + esc(extra.tag) + '</strong>' : '') +
          (idcw ? ' · <strong class="warn-word">IDCW option</strong>' : ''));
        var msgs = [];
        list.forEach(function (p) {
          if (p.page) msgs.push(notice('ok', 'From ' + esc(p.name) + ', ' + p.series.length.toLocaleString('en-IN') + ' dated NAVs were read, ' + fmtDate(p.report.firstDate) + ' to ' + fmtDate(p.report.lastDate) + '. ' +
            p.page.dropped.toLocaleString('en-IN') + ' other line' + (p.page.dropped === 1 ? '' : 's') + ' (menus, headings, summaries) ' + (p.page.dropped === 1 ? 'was' : 'were') + ' left out.' + (p.report.variantLabel ? ' Read as the ' + esc(p.report.variantLabel) + '.' : '')));
        });
        if (idcw) msgs.push(notice('warn', esc(IDCW_FLAG)));
        if (extra && extra.html) msgs.push(extra.html);
        if (missingIn) msgs.push(notice('warn', missingIn + ' file' + (missingIn === 1 ? ' does' : 's do') + ' not hold this scheme and ' + (missingIn === 1 ? 'was' : 'were') + ' left out.'));
        check.warnings.forEach(function (w) { msgs.push(notice('warn', esc(w))); });
        var pieceGaps = (check.summary && check.summary.gaps) || [];
        pieceGaps.forEach(function (g) { msgs.push(notice('warn', esc(J.gapSentence(g)))); });
        /* a gap inside one piece, not already named as a gap between pieces */
        var inner = joined.gaps.filter(function (g) { return !pieceGaps.some(function (pg) { return pg.from === g.from && pg.to === g.to; }); });
        if (inner.length) msgs.push(notice('warn', esc(U.MESSAGES.gap(inner[0])) + (inner.length > 1 ? ' ' + (inner.length - 1) + ' more gap' + (inner.length > 2 ? 's' : '') + ' like it.' : '')));
        if (report.warnings.length) msgs.push(notice('warn', esc(report.warnings[0])));
        if (!o.idcwFlag && /\bidcw\b|\bdividend\b|\bpayout\b/i.test(name)) msgs.push(notice('warn', 'This looks like an IDCW row. Its NAV drops at every payout, so every return on it reads low. The Growth option of the same plan carries the full growth.'));
        say(msgs.join(''));
        renderPieces();
        if (o.onLoaded) o.onLoaded(res);
      }
      function turnDown(refusal) {
        chime('no');
        state.series = null; state.report = null;
        setState('refused', '!', name, '<strong class="bad-word">Not joined.</strong> The reason is below.', 'Choose another file');
        say(refusal); renderPieces(); if (o.onLoaded) o.onLoaded(null);
      }
      /* A question may stand before the file is taken: the pieces' own (are
         they one fund?) and then the slot's. Each is asked once; the answer is
         kept for those files, and a tap on Yes or No settles it. */
      var questions = [];
      var pieceKeys = list.map(function (p) { return p.sig || p.name; }).sort();
      if (check.ask) questions.push({ question: check.ask, refusal: notice('bad', PIECES_NO), keys: ['pieces|' + pieceKeys.join('|')] });
      var q = o.ask ? o.ask(res) : null;
      if (q) questions.push({ question: q.question, refusal: q.refusal, keys: state.fresh && state.fresh.length ? state.fresh : list.map(keyOf) });
      function askNext() {
        if (!questions.length) { land(); return; }
        var cur = questions.shift();
        if (cur.keys.some(function (k) { return answers[k] === 'no'; })) { turnDown(cur.refusal); return; }
        if (cur.keys.every(function (k) { return answers[k] === 'yes'; })) { askNext(); return; }
        setState('working', '?', name, 'One question below', 'Choose another file');
        /* drawn as the statement slot draws its question: the line, then the answers */
        say('<div class="notice"><span class="ic">?</span><span>' + esc(cur.question) + '</span></div>' +
          '<div class="btnrow" style="margin-top:.6rem"><button class="primary" type="button" id="' + prefix + '-ask-yes">Yes</button><button class="secondary" type="button" id="' + prefix + '-ask-no">No</button></div>');
        renderPieces();
        if (o.onLoaded) o.onLoaded(null);
        $('#' + prefix + '-ask-yes').addEventListener('click', function () { cur.keys.forEach(function (k) { answers[k] = 'yes'; }); armed = true; askNext(); });
        $('#' + prefix + '-ask-no').addEventListener('click', function () { cur.keys.forEach(function (k) { answers[k] = 'no'; }); armed = true; turnDown(cur.refusal); });
      }
      askNext();
    }
    function mergeReports(list, joined) {
      var r = { rowsRead: 0, used: joined.series.length, skipped: { badDate: 0, badValue: 0, duplicate: 0, blank: 0 }, examples: [], warnings: [],
                dayFirst: list[0].report.dayFirst, dateCertain: true, scheme: list[0].report.scheme, code: list[0].report.code || null,
                isins: [], names: [], headers: list[0].report.headers || [],
                firstDate: joined.series[0].t, lastDate: joined.series[joined.series.length - 1].t, files: list.length, overlaps: joined.overlaps };
      list.forEach(function (p) {
        var x = p.report;
        r.rowsRead += x.rowsRead; r.skipped.badDate += x.skipped.badDate; r.skipped.badValue += x.skipped.badValue; r.skipped.duplicate += x.skipped.duplicate; r.skipped.blank += x.skipped.blank;
        r.examples = r.examples.concat(x.examples || []).slice(0, 3);
        if (!x.dateCertain) r.dateCertain = false;
        (x.warnings || []).forEach(function (w) { if (r.warnings.indexOf(w) === -1) r.warnings.push(w); });
        (x.isins || []).forEach(function (i) { if (r.isins.indexOf(i) === -1) r.isins.push(i); });
        (x.names || []).forEach(function (n) { if (r.names.indexOf(n) === -1) r.names.push(n); });
        if (!r.code && x.code) r.code = x.code;
      });
      /* the piece that reaches furthest names the scheme: its latest name */
      var newest = list.reduce(function (a, b) { return b.report.lastDate >= a.report.lastDate ? b : a; });
      if (newest.report.scheme) r.scheme = newest.report.scheme;
      r.variant = list.reduce(function (v, p) { return P.mergeVariant(v, p.report.variant); }, newest.report.variant || null);
      r.variantLabel = P.variantLabel(r.variant);
      r.fund = newest.report.fund || list[0].report.fund || null;
      r.title = newest.report.title || list[0].report.title || null;
      r.spanYears = (r.lastDate - r.firstDate) / (365.25 * 86400000);
      /* a 45-day gap inside one piece is that piece's; between pieces it is said as a gap between pieces */
      if (list.length > 1) r.warnings = r.warnings.filter(function (w) { return !/longest gap/.test(w); });
      return r;
    }

    /* H2: each scheme on two lines. The first is its name, which carries the
       plan and the option; the second its code and the dates it covers.
       Typing matches the name (and the code, for a reader who knows it). */
    var MAX_HITS = 40;
    function showPicker(schemes, hasNames, onPick, variants, keepChoice) {
      var wrap = $('#' + prefix + '-scheme-wrap'), q = $('#' + prefix + '-scheme-q');
      wrap.hidden = false; if (!keepChoice) wrap.removeAttribute('data-folded'); q.value = '';
      $$('.pickedline', wrap).forEach(function (l) { l.remove(); });
      $('#' + prefix + '-scheme-list').setAttribute('aria-label', variants ? 'Plans and options in this file' : 'Schemes in this file');
      $('#' + prefix + '-scheme-note').textContent = variants
        ? 'Each plan and option has its own NAV, and two are never mixed. Pick the one on your statement. One choice applies to every piece added here.'
        : hasNames
        ? 'Official downloads hold every scheme of a fund house in one file. Pick the exact name on your statement; the plan and the option are part of the name, and each is a separate row.'
        : 'This file has no column of scheme names, so each scheme is shown by its code. The code is on your statement or on the fund house’s page for the scheme.';
      q.placeholder = hasNames ? 'Type part of the name' : 'Type the scheme code';
      function title(sc) { return sc.name || ('Scheme code ' + sc.key); }
      function chosenLine(sc) {
        $$('.pickedline', wrap).forEach(function (l) { l.remove(); });
        wrap.setAttribute('data-folded', 'yes');
        var l = A.el('p', { 'class': 'hint pickedline' });
        l.innerHTML = 'Chosen: <strong>' + esc(title(sc)) + '</strong>' + (sc.name && sc.code ? ' (code ' + esc(sc.code) + ')' : '') + ' <button class="link" type="button">Change</button>';
        l.querySelector('button').addEventListener('click', function () { wrap.removeAttribute('data-folded'); l.remove(); q.focus(); });
        wrap.insertBefore(l, wrap.firstChild);
      }
      function render(term) {
        var needle = term.trim().toLowerCase();
        var hits = needle ? schemes.filter(function (sc) {
          return [sc.name || ''].concat(sc.names || []).some(function (n) { return n.toLowerCase().indexOf(needle) !== -1; }) || String(sc.code || sc.key).toLowerCase().indexOf(needle) !== -1;
        }) : schemes;
        $('#' + prefix + '-scheme-count').textContent = schemes.length.toLocaleString('en-IN') + (variants ? ' plans and options in this file' : schemes.length === 1 ? ' scheme in this file' : ' schemes in this file') +
          (needle ? ' · ' + hits.length.toLocaleString('en-IN') + ' match' + (hits.length === 1 ? '' : 'es') : '. Type to narrow the list.');
        var list = $('#' + prefix + '-scheme-list');
        if (!hits.length) { list.innerHTML = '<p class="more">Nothing matches “' + esc(term) + '”.</p>'; return; }
        list.innerHTML = hits.slice(0, MAX_HITS).map(function (sc, i) {
          var code = sc.code || (sc.name ? '' : sc.key);
          return '<button class="hit" type="button" role="option" aria-selected="' + (sc.key === state.picked ? 'true' : 'false') + '" data-i="' + i + '"><span class="nm">' + esc(title(sc)) + '</span>' +
            '<span class="sub">' + (sc.name && code ? 'Code ' + esc(code) + ' · ' : '') + fmtDate(sc.first) + ' to ' + fmtDate(sc.last) + ' · ' + (sc.rows === 1 ? 'one price only' : sc.rows.toLocaleString('en-IN') + ' prices') + '</span></button>';
        }).join('') + (hits.length > MAX_HITS ? '<p class="more">' + (hits.length - MAX_HITS).toLocaleString('en-IN') + ' more. Keep typing to narrow them down.</p>' : '');
        $$('#' + prefix + '-scheme-list .hit').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var sc = hits[+btn.dataset.i];
            armed = true;
            onPick(sc);
            chosenLine(sc);
          });
        });
      }
      render(''); q.oninput = function () { render(q.value); };
      if (keepChoice && state.picked) { var kept = schemes.filter(function (sc) { return sc.key === state.picked; })[0]; if (kept) chosenLine(kept); }
      else q.focus();
    }

    /* wiring */
    var drop = box();
    function input() { return $('#' + prefix + '-file'); }
    /* the input is re-drawn with the box; a tap on the box's own words asks it */
    drop.addEventListener('click', function (e) { var inp = input(); if (inp && (e.target === drop || e.target.tagName === 'P')) inp.click(); });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files && e.dataTransfer.files.length) takeFiles(e.dataTransfer.files); });
    drop.addEventListener('change', function (e) {
      var inp = e.target;
      if (!inp || inp.type !== 'file') return;
      var chosen = Array.prototype.slice.call(inp.files || []);
      try { inp.value = ''; } catch (err) { /* some browsers refuse; harmless */ }
      if (chosen.length) takeFiles(chosen);
    });
    $('#' + prefix + '-paste-open').addEventListener('click', function () {
      var pb = $('#' + prefix + '-paste-box'); pb.hidden = !pb.hidden;
      $('#' + prefix + '-paste-open').textContent = pb.hidden ? PASTE_OPEN : 'Use a file instead';
      if (!pb.hidden) $('#' + prefix + '-paste-text').focus();
    });
    /* each paste is a piece of its own, named in order, and joined like a file */
    $('#' + prefix + '-paste-read').addEventListener('click', function () {
      var text = $('#' + prefix + '-paste-text').value;
      if (!text.trim()) { say(notice('bad', 'Paste some rows first.')); return; }
      var n = state.pieces.filter(function (p) { return p.isPaste; }).length;
      var name = n ? 'pasted rows ' + (n + 1) : 'pasted rows';
      takeFiles([{ name: name, size: text.length, pastedText: text }]);
      $('#' + prefix + '-paste-text').value = '';
    });

    return { clear: clear, state: state, prefix: prefix, takeFiles: takeFiles, say: say };
  }

  /* a loaded file that is a fund's IDCW option NAV */
  function isIdcw(res) { return !!(res && res.kindGuess !== 'index' && res.report && res.report.variant && res.report.variant.option === 'IDCW'); }
  /* the flag on a result, naming the file it is about */
  function idcwNote(res) { return isIdcw(res) ? notice('warn', '<strong>' + esc(res.name) + '.</strong> ' + esc(IDCW_FLAG)) : ''; }

  root.PRCDoors = { mount: mount, guide: guide, SAMPLE: SAMPLE, IDCW_FLAG: IDCW_FLAG, PIECES_LINE: PIECES_LINE, isIdcw: isIdcw, idcwNote: idcwNote };
})(typeof globalThis !== 'undefined' ? globalThis : this);
