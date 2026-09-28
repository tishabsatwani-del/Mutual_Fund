/* Where You Stand — the file door, shared by every screen.
 *
 * One component, one behaviour everywhere: choose a file (or several of the
 * same history), drop it, or paste two columns. The box itself shows the
 * state — reading, added with rows and dates, or refused with the reason —
 * so nobody has to scroll to find out whether a tap worked. A file holding
 * many schemes shows a picker inside the door. Several files of one history
 * are joined by date.
 *
 *   PRCDoors.mount(hostEl, { prefix, kind: 'nav'|'index'|'any', label, hint,
 *                            multiple, onLoaded(result|null), gate(rows, name) })
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
  var GUIDES = {
    nav: function () {
      return '<details class="explain howto"><summary>Get your fund’s NAV file: where, which file, what it looks like</summary><div class="body">' +
        '<p><strong>The file:</strong> your fund’s NAV history, one row per day, with the date and the NAV on that date. Any span of dates works; more history means more holding periods to measure.</p>' +
        '<p><strong>Where:</strong> the website of the mutual fund industry body, AMFI, publishes every fund’s NAV history. On it, find <em>NAV History</em>, choose <em>historical NAV for a period</em>, your fund house, then the exact scheme you hold, then the dates, and download the file it offers, Excel or text. Your fund house’s own site offers the same history.</p>' +
        '<p><strong>Which scheme:</strong> the same fund appears as several rows, one per plan and option. Pick the exact name on your statement, and prefer the Growth option: an IDCW option’s NAV drops at every payout, so its history understates what the fund earned.</p>' +
        '<p><strong>If the site limits one download to a few years:</strong> download the history in pieces and load them all here, together or one after another. They are joined by date.</p>' +
        '<p><strong>What a good file looks like</strong> (any of these date forms is read):</p>' + sampleBlock(SAMPLE.nav) +
        '<p><strong>If it fails:</strong> the box below says why. A file holding hundreds of schemes is fine, you pick yours. A PDF or a screenshot will not work; download the table itself, or copy its two columns and paste them.</p>' +
        videoBlock('media/amfi-nav-download.mp4', 'A real NAV download recorded on a phone, about a minute, including a failed attempt and how it was fixed.') +
        '</div></details>';
    },
    index: function () {
      return '<details class="explain howto"><summary>Get the index file: where, which report, what it looks like</summary><div class="body">' +
        '<p><strong>The file:</strong> the daily values of the benchmark index, in its <em>total return</em> form (TRI), which counts dividends the way a fund’s NAV does. A price index leaves dividends out and reads lower every year; if only a price index is available, load it and say so when asked.</p>' +
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
        '<p><strong>A fund:</strong> its NAV history from the industry body’s website (NAV History, historical NAV for a period, your fund house, the exact scheme, the dates) or from the fund house’s own site. <strong>An index:</strong> its total return values from the index provider’s site. One row per day, a date and a value.</p>' +
        '<p><strong>If a download is limited to a few years:</strong> download the pieces and load them all; they are joined by date.</p>' +
        '<p><strong>What a good file looks like:</strong></p>' + sampleBlock(SAMPLE.nav) + sampleBlock(SAMPLE.index) +
        videoBlock('media/amfi-nav-download.mp4', 'A real NAV download recorded on a phone, about a minute.') +
        '</div></details>';
    }
  };
  function guide(kind) { return (GUIDES[kind] || GUIDES.any)(); }

  /* ------------------------------------------------------------ the door */
  var seq = 0;
  function mount(host, opts) {
    var o = opts || {};
    var prefix = o.prefix || ('door' + (seq++));
    var kind = o.kind || 'any';
    var state = { files: [], pieces: [], series: null, name: '', report: null, rows: null, schemes: null, picked: null, kindGuess: null };

    host.innerHTML =
      (o.label ? '<label class="fieldlabel" for="' + prefix + '-pick">' + esc(o.label) + '</label>' : '') +
      '<div class="filebox" id="' + prefix + '-drop" tabindex="0" role="button" aria-label="' + esc(o.aria || o.label || 'Choose a file') + '">' + idleHtml() + '</div>' +
      '<input type="file" id="' + prefix + '-file"' + (o.multiple === false ? '' : ' multiple') + ' accept="' + A.FILE_ACCEPT + '">' +
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
        '<p class="hint">Official downloads hold every scheme of a fund house in one file. Pick the exact name on your statement; check the plan and the option in it, since each is a separate row.</p>' +
      '</div>';

    function idleHtml() {
      return '<button class="secondary" type="button" id="' + prefix + '-pick">Choose a file</button>' +
        '<p>' + esc(o.hint || 'CSV, Excel or text · a date column and a value column is all it needs') + '</p>';
    }
    function box() { return $('#' + prefix + '-drop'); }
    function setState(cls, icon, name, sub, action) {
      var b = box();
      if (!b) return;
      b.className = 'filebox ' + cls;
      b.innerHTML = '<div class="fileok"><span class="fileok-ic" aria-hidden="true">' + icon + '</span>' +
        '<span class="fileok-t"><strong class="fileok-name">' + esc(name) + '</strong><span class="fileok-sub">' + sub + '</span></span></div>' +
        (action ? '<button class="secondary" type="button" id="' + prefix + '-pick">' + action + '</button>' : '');
    }
    function reading(name) { setState('working', '<span class="spin"></span>', name, 'Reading the file…', ''); }
    function added(name, sub) { setState('loaded', '✓', name, '<strong class="ok-word">File added</strong>' + (sub ? ' — ' + sub : ''), o.multiple === false ? 'Choose a different file' : 'Add another file, or change it'); }
    function refused(name) { setState('refused', '!', name, '<strong class="bad-word">Not added</strong> — see below', 'Choose another file'); }
    function say(html) { var st = $('#' + prefix + '-status'); if (st) st.innerHTML = html || ''; }
    function clear() {
      state.files = []; state.pieces = []; state.series = null; state.name = ''; state.report = null; state.rows = null; state.schemes = null; state.picked = null; state.kindGuess = null;
      var b = box(); if (b) { b.className = 'filebox'; b.innerHTML = idleHtml(); }
      say(''); $('#' + prefix + '-scheme-wrap').hidden = true; $('#' + prefix + '-paste-text').value = ''; $('#' + prefix + '-paste-box').hidden = true;
      if (o.onLoaded) o.onLoaded(null);
    }

    /* files arrive one at a time or several at once; each becomes a piece */
    function takeFiles(files) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      if (o.multiple === false) state.pieces = [];
      reading(list.length === 1 ? list[0].name : list.length + ' files');
      say('');
      var i = 0;
      function next() {
        if (i >= list.length) { assemble(); return; }
        var f = list[i++];
        A.readFile(f, function (res) { onPiece(f, res, null); next(); }, function (msg, extra) { onPiece(f, null, { msg: msg, extra: extra }); next(); }, function () {});
      }
      next();
    }
    function onPiece(file, res, err) {
      var rows = res ? res.rows : (err && err.extra && err.extra.rows) || null;
      var refusal = rows ? (o.gate ? o.gate(rows, file.name) : schemaRefusal(rows)) : null;
      if (refusal) { state.pieces.push({ name: file.name, refused: refusal }); return; }
      if (res) { state.pieces.push({ name: file.name, res: res, rows: rows }); return; }
      if (err && err.extra && err.extra.schemes && rows) { state.pieces.push({ name: file.name, rows: rows, schemes: err.extra.schemes }); return; }
      state.pieces.push({ name: file.name, refused: notice('bad', esc(err ? err.msg : 'That file could not be read.')) });
    }
    function schemaRefusal(rows) {
      if (!rows || !P.checkSchema) return null;
      var v = P.checkSchema(rows);
      if (v.ok) return null;
      var found = (v.detected || []).filter(Boolean).slice(0, 10);
      return notice('bad', esc(v.message) + (found.length ? ' <br>The columns found in this file: <strong>' + found.map(function (n) { return esc(String(n)); }).join('</strong>, <strong>') + '</strong>.' : ''));
    }

    /* join the pieces: refusals are shown, many-scheme pieces ask, the rest are stitched */
    function assemble() {
      var bad = state.pieces.filter(function (p) { return p.refused; });
      var many = state.pieces.filter(function (p) { return p.schemes; });
      var good = state.pieces.filter(function (p) { return p.res; });
      if (bad.length && !good.length && !many.length) {
        refused(bad[bad.length - 1].name); say(bad.map(function (p) { return p.refused; }).join(''));
        state.series = null; if (o.onLoaded) o.onLoaded(null);
        return;
      }
      if (many.length) {
        /* the scheme is chosen once, from the union of names, and applied to every piece that has it */
        var names = {};
        many.forEach(function (p) { p.schemes.forEach(function (s) { names[s.name] = names[s.name] || { name: s.name, rows: 0, first: s.first, last: s.last }; names[s.name].rows += s.rows; if (s.first < names[s.name].first) names[s.name].first = s.first; if (s.last > names[s.name].last) names[s.name].last = s.last; }); });
        var schemes = Object.keys(names).map(function (k) { return names[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        state.schemes = schemes;
        added(many.length === 1 ? many[0].name : many.length + ' files', schemes.length + ' schemes found — choose one below');
        say(bad.map(function (p) { return p.refused; }).join(''));
        showPicker(schemes, function (sc) { pickScheme(sc.name); });
        if (state.picked && names[state.picked]) pickScheme(state.picked);
        return;
      }
      finish(good.map(function (p) { return { name: p.name, series: p.res.series, report: p.res.report, rows: p.rows }; }), bad);
    }
    function pickScheme(name) {
      state.picked = name;
      var list = [], failed = [];
      state.pieces.forEach(function (p) {
        if (p.res) { list.push({ name: p.name, series: p.res.series, report: p.res.report, rows: p.rows }); return; }
        if (!p.schemes) return;
        var r = P.rowsToSeries(p.rows, { scheme: name });
        if (r.ok) list.push({ name: p.name, series: r.series, report: r.report, rows: p.rows }); else failed.push(p.name);
      });
      finish(list, state.pieces.filter(function (p) { return p.refused; }), name, failed);
    }
    function finish(list, bad, schemeName, failed) {
      if (!list.length) { say(notice('bad', 'None of the files could be read as this scheme.')); return; }
      var joined = U.stitch(list.map(function (p) { return p.series; }));
      var report = mergeReports(list, joined);
      var name = schemeName || list[0].report.scheme || list[0].name.replace(/\.[^.]+$/, '');
      state.series = joined.series; state.name = name; state.report = report; state.rows = list[0].rows;
      state.kindGuess = P.guessDataKind(list[0].rows, list[0].name).kind;
      var sub = report.used.toLocaleString('en-IN') + ' rows read · ' + fmtDate(report.firstDate) + ' to ' + fmtDate(report.lastDate) +
        (list.length > 1 ? ' · ' + list.length + ' files joined' : '');
      added(name, sub);
      var msgs = (bad || []).map(function (p) { return p.refused; });
      if (failed && failed.length) msgs.push(notice('warn', failed.length + ' file' + (failed.length === 1 ? ' does' : 's do') + ' not hold this scheme and ' + (failed.length === 1 ? 'was' : 'were') + ' left out.'));
      if (joined.gaps.length) msgs.push(notice('warn', esc(U.MESSAGES.gap(joined.gaps[0])) + (joined.gaps.length > 1 ? ' ' + (joined.gaps.length - 1) + ' more gap' + (joined.gaps.length > 2 ? 's' : '') + ' like it.' : '')));
      if (report.warnings.length) msgs.push(notice('warn', esc(report.warnings[0])));
      if (/\bidcw\b|\bdividend\b|\bpayout\b/i.test(name)) msgs.push(notice('warn', 'This looks like an IDCW row. Its NAV drops at every payout, so every return on it reads low. The Growth option of the same plan carries the full growth.'));
      say(msgs.join(''));
      if (o.onLoaded) o.onLoaded({ series: state.series, name: name, report: report, files: list.length, gaps: joined.gaps, kindGuess: state.kindGuess, rows: state.rows });
    }
    function mergeReports(list, joined) {
      var r = { rowsRead: 0, used: joined.series.length, skipped: { badDate: 0, badValue: 0, duplicate: 0, blank: 0 }, examples: [], warnings: [],
                dayFirst: list[0].report.dayFirst, dateCertain: true, scheme: list[0].report.scheme,
                firstDate: joined.series[0].t, lastDate: joined.series[joined.series.length - 1].t, files: list.length, overlaps: joined.overlaps };
      list.forEach(function (p) {
        var x = p.report;
        r.rowsRead += x.rowsRead; r.skipped.badDate += x.skipped.badDate; r.skipped.badValue += x.skipped.badValue; r.skipped.duplicate += x.skipped.duplicate; r.skipped.blank += x.skipped.blank;
        r.examples = r.examples.concat(x.examples || []).slice(0, 3);
        if (!x.dateCertain) r.dateCertain = false;
        (x.warnings || []).forEach(function (w) { if (r.warnings.indexOf(w) === -1) r.warnings.push(w); });
      });
      r.spanYears = (r.lastDate - r.firstDate) / (365.25 * 86400000);
      return r;
    }

    var MAX_HITS = 40;
    function showPicker(schemes, onPick) {
      var wrap = $('#' + prefix + '-scheme-wrap'), q = $('#' + prefix + '-scheme-q');
      wrap.hidden = false; wrap.removeAttribute('data-folded'); q.value = '';
      var line = wrap.querySelector('.pickedline'); if (line) line.remove();
      function render(term) {
        var needle = term.trim().toLowerCase();
        var hits = needle ? schemes.filter(function (sc) { return sc.name.toLowerCase().indexOf(needle) !== -1; }) : schemes;
        $('#' + prefix + '-scheme-count').textContent = schemes.length.toLocaleString('en-IN') + (schemes.length === 1 ? ' scheme in this file' : ' schemes in this file') +
          (needle ? ' · ' + hits.length.toLocaleString('en-IN') + ' match' + (hits.length === 1 ? '' : 'es') : ' — type to narrow the list');
        var list = $('#' + prefix + '-scheme-list');
        if (!hits.length) { list.innerHTML = '<p class="more">Nothing matches “' + esc(term) + '”.</p>'; return; }
        list.innerHTML = hits.slice(0, MAX_HITS).map(function (sc, i) {
          return '<button class="hit" type="button" role="option" aria-selected="false" data-i="' + i + '"><span class="nm">' + esc(sc.name) + '</span>' +
            '<span class="sub">' + fmtDate(sc.first) + ' to ' + fmtDate(sc.last) + ' · ' + (sc.rows === 1 ? 'one price only' : sc.rows.toLocaleString('en-IN') + ' prices') + '</span></button>';
        }).join('') + (hits.length > MAX_HITS ? '<p class="more">' + (hits.length - MAX_HITS).toLocaleString('en-IN') + ' more — keep typing to narrow them down.</p>' : '');
        $$('#' + prefix + '-scheme-list .hit').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var sc = hits[+btn.dataset.i];
            onPick(sc);
            wrap.setAttribute('data-folded', 'yes');
            var l = A.el('p', { 'class': 'hint pickedline' });
            l.innerHTML = 'Chosen: <strong>' + esc(sc.name) + '</strong> <button class="link" type="button">Change</button>';
            l.querySelector('button').addEventListener('click', function () { wrap.removeAttribute('data-folded'); l.remove(); q.focus(); });
            wrap.insertBefore(l, wrap.firstChild);
          });
        });
      }
      render(''); q.oninput = function () { render(q.value); }; q.focus();
    }

    /* wiring */
    var input = $('#' + prefix + '-file'), drop = box();
    function open() { input.click(); setTimeout(function () { A.pickBusy($('#' + prefix + '-pick')); }, 0); }
    drop.addEventListener('click', function (e) { if (e.target.closest('button') || e.target === drop || e.target.closest('.fileok') || e.target.tagName === 'P') open(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files && e.dataTransfer.files.length) takeFiles(e.dataTransfer.files); });
    input.addEventListener('change', function () { A.pickDone(); var chosen = Array.prototype.slice.call(input.files); input.value = ''; if (chosen.length) takeFiles(chosen); });
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

  root.PRCDoors = { mount: mount, guide: guide, SAMPLE: SAMPLE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
