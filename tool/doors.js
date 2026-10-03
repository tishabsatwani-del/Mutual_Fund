/* Where You Stand: the file door, shared by every screen.
 *
 * One component, one behaviour everywhere: choose a file (or several of the
 * same history), drop it, or paste two columns. The box itself shows the
 * state (reading, added with rows and dates, or refused with the reason),
 * so nobody has to scroll to find out whether a tap worked. A file holding
 * many schemes shows a picker inside the door. Several files of one history
 * are joined by date.
 *
 *   PRCDoors.mount(hostEl, { prefix, kind: 'nav'|'index'|'any', label, hint,
 *                            multiple, onLoaded(result|null), gate(rows, name),
 *                            ask(result) -> null or { question, refusal },
 *                            navFile: takes a fund's NAV history, so an old .xls and a PDF too,
 *                            idcwFlag: flags an IDCW option's NAV on the card })
 *   result: { series, name, report, files, gaps, kindGuess }
 *
 * The "Get your file" guides live here too, written so that they stay true
 * when a website's buttons move: they say what the file is, where that kind
 * of file comes from, and what a good one looks like.
 */
(function (root) {
  'use strict';
  var A = root.PRCApp, E = root.PRCEngine, P = root.PRCParse, U = root.SimUpload;
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
  /* A fund's NAV history, in steps that stay true when a website changes:
     no dates, and no site named. */
  function navSteps() {
    return '<ol class="steps">' +
      '<li>Search for the exact scheme name in your browser and open the fund house’s own page for that scheme.</li>' +
      '<li>On that page, find the NAV section, then its NAV history / historical NAV.</li>' +
      '<li>Choose your plan and option (for example Direct, Growth) and the period you want (for example 1 year, 5 years, or a custom range).</li>' +
      '<li>Download it as Excel or PDF.</li>' +
      '<li>Upload that file here.</li>' +
      '</ol><p class="hint">If the site’s layout has changed, look for “NAV history” or “historical NAV” on the scheme’s page.</p>';
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
        '<p><strong>If the site limits one download to a shorter stretch:</strong> download several stretches and load them all here. They are joined by date.</p>' +
        '<p><strong>What a good file looks like:</strong></p>' + sampleBlock(SAMPLE.index) +
        '<p><strong>Which index:</strong> the one named as the benchmark in your fund’s factsheet or scheme document.</p>' +
        videoBlock('media/nse-tri-download.mp4', 'A real total-return-index download recorded on a phone, about a minute, including a download limit and how to work inside it.') +
        '</div></details>';
    },
    statement: function () {
      return '<details class="explain howto"><summary>Get your statement: where, which file, what it looks like</summary><div class="body">' +
        '<p><strong>Two files work.</strong> A <em>transaction statement</em> lists every payment with its date, and gives you the yearly rate. A <em>holdings statement</em> lists each fund with what you put in and what it is worth now, and gives you the total gain but no yearly rate, because it holds no dates.</p>' +
        '<p><strong>Where:</strong> wherever you invest, under <em>Reports</em>, <em>Statements</em> or <em>Transactions</em>: your fund house’s website or app, the app or platform you buy through, or the registrar’s portal. Choose <strong>Excel or CSV</strong>, not PDF, and the widest date range offered, from your first purchase to today.</p>' +
        '<p><strong>The consolidated statement that arrives by email is a PDF</strong> and will not work here; the site that sends it offers the same transactions as Excel or CSV. If you cannot find a download, type your entries in instead: it takes a few minutes.</p>' +
        '<p><strong>What a good transaction file looks like:</strong></p>' + sampleBlock(SAMPLE.ledger) +
        '<p><strong>What a good holdings file looks like:</strong></p>' + sampleBlock(SAMPLE.holdings) +
        '<p><strong>If it fails:</strong> the box says why. A file with unsigned amounts asks you once which words mean money out. A fund’s daily price file belongs on the Rolling returns screen, not here.</p>' +
        '</div></details>';
    },
    any: function () {
      return '<details class="explain howto"><summary>Get the file: a fund’s NAV history or an index’s values</summary><div class="body">' +
        '<p><strong>A fund’s NAV history:</strong></p>' + navSteps() +
        '<p><strong>An index:</strong> its total return values from the index provider’s site. One row per day, a date and a value.</p>' +
        '<p><strong>If a download is limited to a few years:</strong> download the pieces and load them all; they are joined by date.</p>' +
        '<p><strong>What a good file looks like:</strong></p>' + sampleBlock(SAMPLE.nav) + sampleBlock(SAMPLE.index) +
        '</div></details>';
    }
  };
  function guide(kind) { return (GUIDES[kind] || GUIDES.any)(); }

  /* An IDCW option's NAV in a screen that measures returns: on the file's
     card and on the result, in these words. */
  var IDCW_FLAG = 'This is an IDCW option\u2019s NAV. It drops each time a payout is made, so these returns leave the payouts out and read lower than the fund\u2019s Growth record. The Growth option\u2019s NAV gives the fund\u2019s full record.';

  /* ------------------------------------------------------------ the door */
  var seq = 0;
  var NOUN = { nav: 'fund', index: 'index', any: 'fund or index' };
  function mount(host, opts) {
    var o = opts || {};
    var prefix = o.prefix || ('door' + (seq++));
    var kind = o.kind || 'any';
    var noun = o.noun || NOUN[kind] || 'fund or index';
    var state = { pieces: [], series: null, name: '', report: null, rows: null, schemes: null, picked: null, kindGuess: null };
    var answers = {};   /* a question a slot asks of a file, answered once for that file */
    function keyOf(p) { return p.sig || p.name + '|' + (p.rows ? p.rows.length + '|' + JSON.stringify(p.rows.slice(0, 3)) : ''); }

    host.innerHTML =
      (o.label ? '<label class="fieldlabel" for="' + prefix + '-file">' + esc(o.label) + '</label>' : '') +
      '<div class="filebox" id="' + prefix + '-drop">' + idleHtml() + '</div>' +
      '<p class="hint tight" id="' + prefix + '-dup" aria-live="polite" hidden>This file is already added.</p>' +
      '<div id="' + prefix + '-status" aria-live="polite"></div>' +
      '<button class="secondary pastebtn" type="button" id="' + prefix + '-paste-open">Paste the two columns instead</button>' +
      '<div class="pastebox" id="' + prefix + '-paste-box" hidden>' +
        '<label class="fieldlabel" for="' + prefix + '-paste-text">Copy the date column and the value column, and paste them here</label>' +
        '<textarea id="' + prefix + '-paste-text" rows="6" spellcheck="false" placeholder="01-Jan-2020\t45.1234\n02-Jan-2020\t45.2210"></textarea>' +
        '<p class="hint">A numeric date such as 01-02-2020 is read day first, as 1 February 2020. Write 01-Feb-2020 or 2020-02-01 to be certain.</p>' +
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
      return '<span class="filewrap"><input type="file" class="filepick" id="' + prefix + '-file"' + (o.multiple === false ? '' : ' multiple') +
        ' accept="' + (o.navFile ? A.NAV_ACCEPT : A.FILE_ACCEPT) + '" aria-label="' + esc(word) + '" title="' + esc(word) + '"></span>';
    }
    function idleHtml() {
      return pickHtml('Choose a file') +
        '<p>' + esc(o.hint || 'CSV, Excel or text · a date column and a value column is all it needs') + '</p>';
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
    /* the same file is its name and its size: chosen again, it is not read again */
    function sigOf(f) { return f && f.pastedText == null ? f.name + '|' + f.size : null; }
    function added(name, sub) { chime('ok'); setState('loaded', '✓', name, '<strong class="ok-word">File added</strong>' + (sub ? ': ' + sub : ''), o.multiple === false ? 'Choose a different file' : 'Add another file, or change it'); }
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
      say(''); hidePicker(); dup(false); armed = false; $('#' + prefix + '-paste-text').value = ''; $('#' + prefix + '-paste-box').hidden = true;
      if (o.onLoaded) o.onLoaded(null);
    }

    /* Files arrive one at a time or several at once; each becomes a piece.
       An attempt is all or nothing: if any file in it is refused, the slot is
       emptied and shows that refusal alone, so a green card never sits above
       a red one. A file chosen again under the same name replaces its piece. */
    function takeFiles(files) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      var have = state.pieces.map(function (p) { return p.sig; });
      var fresh0 = list.filter(function (f) { var s = sigOf(f); return !s || have.indexOf(s) === -1; });
      dup(fresh0.length < list.length);
      if (!fresh0.length) return;
      list = fresh0;
      armed = true;
      if (o.multiple === false) state.pieces = [];
      reading(list.length === 1 ? list[0].name : list.length + ' files');
      say(''); hidePicker();
      var fresh = [], i = 0;
      function next() {
        if (i >= list.length) { landed(fresh); return; }
        var f = list[i++];
        A.readFile(f, function (res) { fresh.push(piece(f, res, null)); next(); },
          function (msg, extra) { fresh.push(piece(f, null, { msg: msg, extra: extra })); next(); }, function () {}, { noun: noun, navFile: !!o.navFile });
      }
      next();
    }
    function piece(file, res, err) { var p = pieceOf(file, res, err); p.sig = sigOf(file); return p; }
    function pieceOf(file, res, err) {
      var rows = res ? res.rows : (err && err.extra && err.extra.rows) || null;
      var refusal = rows ? (o.gate ? o.gate(rows, file.name) : schemaRefusal(rows)) : null;
      if (refusal) return { name: file.name, refused: refusal };
      if (res) return { name: file.name, res: res, rows: rows };
      if (err && err.extra && err.extra.schemes && rows) return { name: file.name, rows: rows, schemes: err.extra.schemes, hasNames: err.extra.hasNames !== false, variants: !!err.extra.variants };
      return { name: file.name, refused: notice('bad', esc(err ? err.msg : 'That file could not be read.')) };
    }
    function landed(fresh) {
      state.fresh = fresh.map(keyOf);   /* the files of this attempt: a question is about them */
      var bad = fresh.filter(function (p) { return p.refused; });
      if (bad.length) {
        empty();
        refused(bad.length === 1 ? bad[0].name : bad.length + ' of ' + fresh.length + ' files');
        say(bad.map(function (p) { return (bad.length > 1 ? '<p class="hint tight"><strong>' + esc(p.name) + '</strong></p>' : '') + p.refused; }).join('') +
          (fresh.length > bad.length ? '<p class="hint">Nothing from this attempt was kept. Choose the files again without the one refused.</p>' : ''));
        if (o.onLoaded) o.onLoaded(null);
        return;
      }
      /* Several files of one history are joined by date. A file of a
         different history (other headings, another scheme or index, a price
         index after a total return index) replaces what was there instead of
         being stitched into it. */
      if (state.pieces.length && fresh.some(function (p) { return apart(p, state.pieces[0]); })) state.pieces = [];
      fresh.forEach(function (p) {
        state.pieces = state.pieces.filter(function (q) { return q.name !== p.name; });
        state.pieces.push(p);
      });
      assemble();
    }
    function idOf(p) {
      var rows = p.rows || [];
      var head = P.findHeader(rows).header;
      var headings = head ? head.map(P.normHeader).filter(Boolean).join(',') : '';
      /* one scheme is one code, whatever it was called in a given year */
      return headings + '|' + (p.res ? (p.res.report.code || p.res.report.scheme || '') : '*');
    }
    /* two plans or options of one scheme are two histories, never one */
    function apart(p, q) {
      return idOf(p) !== idOf(q) || !!(p.res && q.res && P.variantsDiffer(p.res.report.variant, q.res.report.variant));
    }
    function schemaRefusal(rows) {
      if (!rows || !P.checkSchema) return null;
      var v = P.checkSchema(rows, { slot: kind });
      if (v.ok) return null;
      var found = (v.detected || []).filter(Boolean).slice(0, 10);
      return notice('bad', esc(v.message) + (found.length ? ' <br>The columns found in this file: <strong>' + found.map(function (n) { return esc(String(n)); }).join('</strong>, <strong>') + '</strong>.' : ''));
    }

    /* join the pieces: many-scheme pieces ask once, the rest are stitched */
    function assemble() {
      var many = state.pieces.filter(function (p) { return p.schemes; });
      var good = state.pieces.filter(function (p) { return p.res; });
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
        added(many.length === 1 ? many[0].name : many.length + ' files', schemes.length.toLocaleString('en-IN') + (variants ? ' plans and options found. Choose one below.' : ' schemes found. Choose one below.'));
        say('');
        showPicker(schemes, hasNames, function (sc) { pickScheme(sc.key); }, variants);
        if (state.picked && byKey[state.picked]) pickScheme(state.picked);
        return;
      }
      finish(good.map(function (p) { return { name: p.name, series: p.res.series, report: p.res.report, rows: p.rows, sig: p.sig }; }));
    }
    function pickScheme(key) {
      state.picked = key;
      var list = [], failed = [];
      state.pieces.forEach(function (p) {
        if (p.res) { list.push({ name: p.name, series: p.res.series, report: p.res.report, rows: p.rows, sig: p.sig }); return; }
        if (!p.schemes) return;
        /* a PDF's rows are held to the strict standard here too */
        var r = P.rowsToSeries(p.rows, { scheme: key, noun: noun, fileName: p.name, strict: /\.pdf$/i.test(p.name), doubtCopy: P.PDF_COPY });
        if (r.ok) list.push({ name: p.name, series: r.series, report: r.report, rows: p.rows, sig: p.sig });
        else failed.push({ name: p.name, message: r.message, code: r.code });
      });
      if (!list.length) {
        /* the chosen scheme could not be read from any piece: say why, keep the picker */
        chime('no');
        say(notice('bad', esc(failed.length ? failed[0].message : 'None of the files could be read as this scheme.')));
        state.series = null; if (o.onLoaded) o.onLoaded(null);
        return;
      }
      finish(list, failed.filter(function (f) { return f.code === 'NO_SUCH_SCHEME'; }).length);
    }
    function finish(list, missingIn) {
      if (!list.length) { say(notice('bad', 'None of the files could be read.')); return; }
      var joined = U.stitch(list.map(function (p) { return p.series; }));
      var report = mergeReports(list, joined);
      var name = report.title || report.scheme || list[0].name.replace(/\.[^.]+$/, '');
      state.series = joined.series; state.name = name; state.report = report; state.rows = list[0].rows;
      state.kindGuess = P.guessDataKind(list[0].rows, list[0].name).kind;
      /* the file's own name too, where the card's title is the scheme's */
      var files = list.map(function (p) { return p.name; }).filter(function (n, i, a) { return n && a.indexOf(n) === i; });
      var named = files.length === 1 && files[0].replace(/\.[^.]+$/, '') === name ? '' : esc(files.join(', ')) + ' · ';
      var pdf = list.every(function (p) { return /\.pdf$/i.test(p.name || ''); });
      var sub = named + report.used.toLocaleString('en-IN') + (pdf ? ' NAVs read · ' : ' rows read · ') + fmtDate(report.firstDate) + ' to ' + fmtDate(report.lastDate) +
        (list.length > 1 ? ' · ' + list.length + ' files joined' : '');
      /* a fund's file says which plan and option it holds; an index has none */
      var fundFile = state.kindGuess !== 'index' && (report.variantLabel || kind === 'nav' || state.kindGuess === 'nav');
      if (fundFile) sub += ' · ' + esc(report.variantLabel || 'plan and option not stated in the file');
      var idcw = !!(o.idcwFlag && fundFile && isIdcw({ report: report, kindGuess: state.kindGuess }));
      var res = { series: state.series, name: name, report: report, files: list.length, gaps: joined.gaps, kindGuess: state.kindGuess, rows: state.rows,
                  file: list[0].name, parts: list.map(function (p) { return { rows: p.rows, name: p.name }; }) };
      function land() {
        var extra = o.describe ? o.describe(res) : null;
        added(name, sub + (extra && extra.tag ? ' · <strong' + (extra.plain ? '' : ' class="warn-word"') + '>' + esc(extra.tag) + '</strong>' : '') +
          (idcw ? ' · <strong class="warn-word">IDCW option</strong>' : ''));
        var msgs = [];
        if (idcw) msgs.push(notice('warn', esc(IDCW_FLAG)));
        if (extra && extra.html) msgs.push(extra.html);
        if (missingIn) msgs.push(notice('warn', missingIn + ' file' + (missingIn === 1 ? ' does' : 's do') + ' not hold this scheme and ' + (missingIn === 1 ? 'was' : 'were') + ' left out.'));
        if (joined.gaps.length) msgs.push(notice('warn', esc(U.MESSAGES.gap(joined.gaps[0])) + (joined.gaps.length > 1 ? ' ' + (joined.gaps.length - 1) + ' more gap' + (joined.gaps.length > 2 ? 's' : '') + ' like it.' : '')));
        if (report.warnings.length) msgs.push(notice('warn', esc(report.warnings[0])));
        if (!o.idcwFlag && /\bidcw\b|\bdividend\b|\bpayout\b/i.test(name)) msgs.push(notice('warn', 'This looks like an IDCW row. Its NAV drops at every payout, so every return on it reads low. The Growth option of the same plan carries the full growth.'));
        say(msgs.join(''));
        if (o.onLoaded) o.onLoaded(res);
      }
      function turnDown(refusal) { empty(); refused(name); say(refusal); if (o.onLoaded) o.onLoaded(null); }
      /* A slot may need one answer before it takes a file. It is asked once:
         the answer is kept for that file, and a tap on Yes or No settles it. */
      var q = o.ask ? o.ask(res) : null;
      if (!q) { land(); return; }
      var keys = state.fresh && state.fresh.length ? state.fresh : list.map(keyOf);
      if (keys.some(function (k) { return answers[k] === 'no'; })) { turnDown(q.refusal); return; }
      if (keys.every(function (k) { return answers[k] === 'yes'; })) { land(); return; }
      setState('working', '?', name, 'One question below', 'Choose another file');
      /* drawn as the statement slot draws its question: the line, then the answers */
      say('<div class="notice"><span class="ic">?</span><span>' + esc(q.question) + '</span></div>' +
        '<div class="btnrow" style="margin-top:.6rem"><button class="primary" type="button" id="' + prefix + '-ask-yes">Yes</button><button class="secondary" type="button" id="' + prefix + '-ask-no">No</button></div>');
      if (o.onLoaded) o.onLoaded(null);
      $('#' + prefix + '-ask-yes').addEventListener('click', function () { keys.forEach(function (k) { answers[k] = 'yes'; }); armed = true; land(); });
      $('#' + prefix + '-ask-no').addEventListener('click', function () { keys.forEach(function (k) { answers[k] = 'no'; }); armed = true; turnDown(q.refusal); });
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
      return r;
    }

    /* H2: each scheme on two lines. The first is its name, which carries the
       plan and the option; the second its code and the dates it covers.
       Typing matches the name (and the code, for a reader who knows it). */
    var MAX_HITS = 40;
    function showPicker(schemes, hasNames, onPick, variants) {
      var wrap = $('#' + prefix + '-scheme-wrap'), q = $('#' + prefix + '-scheme-q');
      wrap.hidden = false; wrap.removeAttribute('data-folded'); q.value = '';
      $$('.pickedline', wrap).forEach(function (l) { l.remove(); });
      $('#' + prefix + '-scheme-list').setAttribute('aria-label', variants ? 'Plans and options in this file' : 'Schemes in this file');
      $('#' + prefix + '-scheme-note').textContent = variants
        ? 'Each plan and option has its own NAV, and two are never mixed. Pick the one on your statement.'
        : hasNames
        ? 'Official downloads hold every scheme of a fund house in one file. Pick the exact name on your statement; the plan and the option are part of the name, and each is a separate row.'
        : 'This file has no column of scheme names, so each scheme is shown by its code. The code is on your statement or on the fund house’s page for the scheme.';
      q.placeholder = hasNames ? 'Type part of the name' : 'Type the scheme code';
      function title(sc) { return sc.name || ('Scheme code ' + sc.key); }
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
          return '<button class="hit" type="button" role="option" aria-selected="false" data-i="' + i + '"><span class="nm">' + esc(title(sc)) + '</span>' +
            '<span class="sub">' + (sc.name && code ? 'Code ' + esc(code) + ' · ' : '') + fmtDate(sc.first) + ' to ' + fmtDate(sc.last) + ' · ' + (sc.rows === 1 ? 'one price only' : sc.rows.toLocaleString('en-IN') + ' prices') + '</span></button>';
        }).join('') + (hits.length > MAX_HITS ? '<p class="more">' + (hits.length - MAX_HITS).toLocaleString('en-IN') + ' more. Keep typing to narrow them down.</p>' : '');
        $$('#' + prefix + '-scheme-list .hit').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var sc = hits[+btn.dataset.i];
            $$('.pickedline', wrap).forEach(function (l) { l.remove(); });
            armed = true;
            onPick(sc);
            wrap.setAttribute('data-folded', 'yes');
            var l = A.el('p', { 'class': 'hint pickedline' });
            l.innerHTML = 'Chosen: <strong>' + esc(title(sc)) + '</strong>' + (sc.name && sc.code ? ' (code ' + esc(sc.code) + ')' : '') + ' <button class="link" type="button">Change</button>';
            l.querySelector('button').addEventListener('click', function () { wrap.removeAttribute('data-folded'); l.remove(); q.focus(); });
            wrap.insertBefore(l, wrap.firstChild);
          });
        });
      }
      render(''); q.oninput = function () { render(q.value); }; q.focus();
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
      $('#' + prefix + '-paste-open').textContent = pb.hidden ? 'Paste the two columns instead' : 'Use a file instead';
      if (!pb.hidden) $('#' + prefix + '-paste-text').focus();
    });
    $('#' + prefix + '-paste-read').addEventListener('click', function () {
      var text = $('#' + prefix + '-paste-text').value;
      if (!text.trim()) { say(notice('bad', 'Paste some rows first.')); return; }
      state.pieces = [];
      takeFiles([{ name: 'pasted columns', size: text.length, pastedText: text }]);
    });

    return { clear: clear, state: state, prefix: prefix, takeFiles: takeFiles, say: say };
  }

  /* a loaded file that is a fund's IDCW option NAV */
  function isIdcw(res) { return !!(res && res.kindGuess !== 'index' && res.report && res.report.variant && res.report.variant.option === 'IDCW'); }
  /* the flag on a result, naming the file it is about */
  function idcwNote(res) { return isIdcw(res) ? notice('warn', '<strong>' + esc(res.name) + '.</strong> ' + esc(IDCW_FLAG)) : ''; }

  root.PRCDoors = { mount: mount, guide: guide, SAMPLE: SAMPLE, IDCW_FLAG: IDCW_FLAG, isIdcw: isIdcw, idcwNote: idcwNote };
})(typeof globalThis !== 'undefined' ? globalThis : this);
