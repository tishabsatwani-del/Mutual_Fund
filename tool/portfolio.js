/* Where You Stand: Check my portfolio.
 *
 * Three numbered steps, the way the Rolling returns screen is laid out:
 *   1  your payments: a statement file, pasted rows, or typed rows
 *   2  what each fund is worth today: from its NAV file, or typed as the last resort
 *   3  the benchmark index's TRI file, or a fund's NAV history, to compare with (optional)
 * The button appears only when steps 1 and 2 are complete. The main result is
 * short; the detail is a tab away.
 */
(function (root) {
  'use strict';
  var A = root.PRCApp, E = root.PRCEngine, P = root.PRCParse, U = root.SimUpload, D = root.PRCDoors, C = root.PRCCharts;
  var $ = A.$, $$ = A.$$, esc = A.esc, money = A.money, pct = A.pct, share = A.share, notice = A.notice, fmtDate = A.fmtDate;
  var stat = A.stat, fold = A.fold;

  var KINDS = ['Money in', 'Money out', 'Worth today'];
  var rowSeq = 0;
  var LOW = 0.1, HIGH = 20;          /* C5: a value under a tenth, or over twenty times, what went in is checked */

  var PF = {
    mode: null,            /* 'file' | 'typed' */
    kind: null,            /* 'holdings' | 'ledger' when a file was read */
    holdings: null, imported: null, valuations: [], switches: 0, source: '', answers: {},
    file: null, sheet: null, sheets: null, sheetName: null, last: null,
    funds: [],             /* [{ key, title, g }]: the funds step 2 values */
    navDoors: {},          /* fund key -> door handle */
    nav: {},               /* fund key -> { series, name, report, check } */
    confirmed: {},         /* fund key -> the value the reader confirmed is the whole holding */
    index: null,           /* { series, name, report, kind } */
    indexDoor: null,
    ran: false
  };

  function titleOf(key) { return key ? key : 'Your holding'; }

  /* ================================================================ rows */
  function addRow(values) {
    var v = values || {};
    var id = 'r' + (rowSeq++);
    var wrap = A.el('div', { class: 'entry', 'data-row': id });
    wrap.innerHTML =
      '<div class="c-fields">' +
        '<div class="c-num" aria-hidden="true"></div>' +
        '<div class="c-date"><label for="' + id + 'd">Date</label><input type="date" id="' + id + 'd" class="in-date" value="' + esc(v.date || '') + '"><span class="date-echo" id="' + id + 'de"></span></div>' +
        '<div class="c-kind"><label for="' + id + 'k">What happened</label><select id="' + id + 'k" class="in-kind">' +
          KINDS.map(function (k) { return '<option' + (v.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></div>' +
        '<div class="c-amt"><label for="' + id + 'a">Amount in rupees</label><input type="number" id="' + id + 'a" class="in-amt" inputmode="decimal" min="0" step="1" placeholder="Amount" value="' + (v.amount != null ? esc(v.amount) : '') + '"><span class="amt-echo" id="' + id + 'ae"></span></div>' +
        '<div class="c-tag"><label for="' + id + 't">Which fund?</label><input type="text" id="' + id + 't" class="in-tag" autocomplete="off" placeholder="Which fund?" value="' + esc(v.label || '') + '"></div>' +
      '</div><button type="button" class="del" aria-label="Remove this row">&times;</button>';
    wrap.querySelector('.del').addEventListener('click', function () { wrap.remove(); numberRows(); afterTyped(); });
    var dateInput = wrap.querySelector('.in-date'), dateEcho = wrap.querySelector('.date-echo');
    function sayDate() { var t = A.isoToTs(dateInput.value); dateEcho.textContent = isFinite(t) ? fmtDate(t) : ''; }
    dateInput.addEventListener('input', sayDate); dateInput.addEventListener('change', sayDate); sayDate();
    var amtInput = wrap.querySelector('.in-amt'), amtEcho = wrap.querySelector('.amt-echo');
    function sayAmt() {
      var n = parseFloat(amtInput.value);
      var say = amtInput.value.trim() === '' ? '' : A.checkInput('rupees', n);
      amtEcho.textContent = say || A.echo(n);
      amtEcho.classList.toggle('refuse', !!say);
    }
    amtInput.addEventListener('input', sayAmt); sayAmt();
    $('#pf-rows').appendChild(wrap);
    numberRows();
    return wrap;
  }
  function numberRows() {
    $$('#pf-rows .entry').forEach(function (r, i) { var n = r.querySelector('.c-num'); if (n) n.textContent = 'Row ' + (i + 1); });
  }
  function readRows() {
    return $$('#pf-rows .entry').map(function (r) {
      return { date: r.querySelector('.in-date').value, kind: r.querySelector('.in-kind').value,
               amount: parseFloat(r.querySelector('.in-amt').value), label: (r.querySelector('.in-tag').value || '').trim() };
    });
  }
  function goodRow(r) { return isFinite(A.isoToTs(r.date)) && isFinite(r.amount) && r.amount > 0; }
  /* the typed labels drive step 2 */
  function afterTyped() {
    if (PF.mode !== 'typed') return;
    var keys = [];
    readRows().forEach(function (r) { if (goodRow(r) && keys.indexOf(r.label) === -1) keys.push(r.label); });
    PF.funds = keys.map(function (k) { return { key: k, title: titleOf(k), g: null }; });
    drawFundCards();
  }

  /* ==================================================== step 1: the statement */
  function mountDoors() {
    $('#pf-howto').innerHTML = D.guide('statement');
    var host = $('#pf-statement-door');
    host.innerHTML =
      '<div class="filebox" id="pf-drop">' + PF_IDLE + '</div>' +
      '<p class="hint tight" id="pf-dup" aria-live="polite" hidden>This file is already added.</p>' +
      '<button class="secondary pastebtn" type="button" id="pf-paste-open">Paste the rows instead</button>' +
      '<div class="pastebox" id="pf-paste-box" hidden><label class="fieldlabel" for="pf-paste-text">Copy the rows out of your statement and paste them here</label>' +
      '<textarea id="pf-paste-text" rows="6" spellcheck="false"></textarea><div class="btnrow"><button class="primary" type="button" id="pf-paste-read">Read these</button></div></div>';
    var drop = $('#pf-drop');
    drop.addEventListener('click', function (e) { var input = $('#pf-file'); if (input && (e.target === drop || e.target.tagName === 'P')) input.click(); });
    var depth = 0;
    function allow(e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }
    drop.addEventListener('dragenter', function (e) { allow(e); depth++; drop.classList.add('over'); });
    drop.addEventListener('dragover', allow);
    drop.addEventListener('dragleave', function () { if (--depth <= 0) { depth = 0; drop.classList.remove('over'); } });
    drop.addEventListener('drop', function (e) { e.preventDefault(); depth = 0; drop.classList.remove('over'); var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []); if (files.length) takeFile(files[0]); });
    drop.addEventListener('change', function (e) { var input = e.target; if (!input || input.type !== 'file') return; var files = Array.prototype.slice.call(input.files || []); try { input.value = ''; } catch (err) { /* harmless */ } if (files.length) takeFile(files[0]); });
    $('#pf-paste-open').addEventListener('click', function () { var box = $('#pf-paste-box'); box.hidden = !box.hidden; if (!box.hidden) $('#pf-paste-text').focus(); });
    $('#pf-paste-read').addEventListener('click', function () {
      var text = $('#pf-paste-text').value;
      if (!text.trim()) return;
      PF.answers = {}; PF.source = 'pasted rows'; PF.file = null; PF.sheets = null; PF.accepted = false;
      dupLine(false); card(null);
      readInto(text, true);
    });

    /* step 3, on both modes: the benchmark index's TRI (a price index with its
       flag), or a fund's NAV history, an index fund's say. A fund is compared as
       the fund it is: named, tagged "a fund, costs included", never the index. */
    $('#pf-index-howto').innerHTML = D.guide('index');
    PF.indexDoor = D.mount($('#pf-index-door'), {
      prefix: 'pfix', kind: 'index', noun: 'fund or index', label: 'The index’s total return (TRI) file, or a fund’s NAV history',
      hint: 'CSV, Excel or text · a date column and the index value or NAV on that date',
      gate: indexGate,
      describe: function (res) {
        var k = P.indexFileKind(res.rows, res.name);
        return k.nav ? { tag: FUND_TAG, plain: true } : k.kind === 'PRICE' ? { tag: 'Price index', html: notice('warn', PRICE_FLAG) } : null;
      },
      onLoaded: function (res) {
        var k = res && res.rows ? P.indexFileKind(res.rows, res.name) : null;
        PF.index = res ? { series: res.series, name: res.name, report: res.report, kind: k ? (k.nav ? 'NAV' : k.kind) : null } : null;
        if (PF.index && !PF.index.kind) PF.index.kind = guessKind(res.name);
        drawIndexKind();
        if (PF.ran) calcPortfolio();
      }
    });
  }
  /* C3: the brief's wording, with the figure left out so it never goes stale */
  var PRICE_FLAG = '<strong>Price index:</strong> dividends are left out, which flatters your side by about the index’s dividend yield each year. The Total Returns tab of the same report fixes this.';
  /* The owner's ruling of 2 October 2026 on C3: a fund's NAV is welcome at step 3 too */
  var FUND_TAG = 'a fund, costs included';
  var FUND_NOTE = 'A fund, costs included: its NAV is net of its own costs, as your funds’ NAVs are.';
  function indexGate(rows) { return schemaGate(rows, 'compare'); }
  /* Step 2 values a fund's units at that fund's own NAV, so an index file is
     refused there by what its headings say it is: NSE's total return report,
     a file naming its index, NSE's price report. Two bare columns of dates and
     values say nothing, and are read, as a NAV history's must be. */
  var INDEX_AT_NAV = 'This is an index file, not a fund’s NAV. Your units are valued at the fund’s own NAV: load that fund’s NAV history here. An index goes in step 3, to compare with.';
  function navGate(rows, name) {
    var k = P.indexFileKind(rows, name), head = (P.rowSignals(rows).header || []).map(P.normHeader).join(' | ');
    if (!k.nav && (k.kind === 'TRI' || /\bindex name\b/.test(head) || (k.kind === 'PRICE' && /\bshares traded\b|\bturnover\b/.test(head)))) return notice('bad', esc(INDEX_AT_NAV));
    return schemaGate(rows, 'nav');
  }
  function fundCmp() { return !!(PF.index && PF.index.kind === 'NAV'); }
  function schemaGate(rows, slot) {
    var v = P.checkSchema(rows, { slot: slot });
    if (v.ok) return null;
    var found = (v.detected || []).filter(Boolean).slice(0, 8);
    return notice('bad', esc(v.message) + (found.length ? ' <br>The columns found: <strong>' + found.map(function (n) { return esc(String(n)); }).join('</strong>, <strong>') + '</strong>.' : ''));
  }
  var TRI_RE = /\b(tri|total\s*returns?\s*index|total\s*returns?)\b/i, PRICE_RE = /\b(pri|price\s*returns?\s*index|price\s*returns?|price\s*index)\b/i;
  function guessKind(name) {
    var t = String(name || '').replace(/[_.\-]+/g, ' ');
    if (PRICE_RE.test(t) && !TRI_RE.test(t)) return 'PRICE';
    if (TRI_RE.test(t)) return 'TRI';
    return null;
  }
  /* Only a file whose headings do not say which kind it is gets the question. */
  function drawIndexKind() {
    var host = $('#pf-index-kind');
    if (!host) { host = A.el('div', { id: 'pf-index-kind' }); $('#pf-index-door').appendChild(host); }
    if (!PF.index || (PF.index.kind && PF.index.report && fromHeadings())) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="field" style="margin-top:.8rem"><span class="fieldlabel">Which kind of file is <strong>' + esc(PF.index.name) + '</strong>?</span>' +
      '<div class="chips" id="pf-kind-chips" role="radiogroup">' +
      ['TRI', 'PRICE', 'NAV'].map(function (k) { return '<button class="chip" type="button" role="radio" data-kind="' + k + '" aria-checked="' + (PF.index.kind === k) + '">' + (k === 'TRI' ? 'Total return index: dividends included' : k === 'PRICE' ? 'Price index: dividends left out' : 'A fund’s NAV: costs included') + '</button>'; }).join('') +
      '</div><p class="hint" id="pf-kind-why"></p></div>';
    $$('#pf-kind-chips .chip').forEach(function (b) {
      b.addEventListener('click', function () { PF.index.kind = b.dataset.kind; $$('#pf-kind-chips .chip').forEach(function (c) { c.setAttribute('aria-checked', String(c === b)); }); sayKind(); if (PF.ran) calcPortfolio(); });
    });
    sayKind();
  }
  function fromHeadings() {
    var st = PF.indexDoor && PF.indexDoor.state;
    var k = st && st.rows ? P.indexFileKind(st.rows, PF.index.name) : null;
    return !!(k && (k.nav || k.kind));
  }
  function sayKind() {
    var why = $('#pf-kind-why'); if (!why || !PF.index) return;
    why.innerHTML = PF.index.kind === 'PRICE' ? PRICE_FLAG
      : PF.index.kind === 'TRI' ? 'Dividends are counted on both sides, so the comparison is like for like.'
      : PF.index.kind === 'NAV' ? esc(FUND_NOTE)
      : 'Not established. Until you say, the comparison cannot tell whether a gap is real or only the dividends the index leaves out.';
  }

  /* The payments card, drawn like every other file slot's: the file's name with
     a tick when it is read, with the mark when it is refused, and the same
     file chosen again is not read again. */
  var PF_IDLE = '<span class="filewrap"><input type="file" class="filepick" id="pf-file" accept="' + A.FILE_ACCEPT + '" aria-label="Choose your statement file" title="Choose a file"></span><p>or drop it here · CSV or Excel</p>';
  function card(state, name) {
    var drop = $('#pf-drop'); if (!drop) return;
    drop.className = 'filebox' + (state ? ' ' + state : '');
    drop.innerHTML = !state ? PF_IDLE :
      '<div class="fileok"><span class="fileok-ic" aria-hidden="true">' + (state === 'loaded' ? '✓' : '!') + '</span><span class="fileok-t"><strong class="fileok-name">' + esc(name) + '</strong><span class="fileok-sub">' +
      (state === 'loaded' ? '<strong class="ok-word">File added</strong>' : '<strong class="bad-word">Not added.</strong> The reason is below.') + '</span></span></div>' +
      '<span class="filewrap"><input type="file" class="filepick" id="pf-file" accept="' + A.FILE_ACCEPT + '" aria-label="Choose your statement file" title="' + (state === 'loaded' ? 'Choose a different file' : 'Choose another file') + '"></span>';
  }
  function dupLine(show) { var d = $('#pf-dup'); if (d) d.hidden = !show; }
  function sigOf(f) { return f ? f.name + '|' + f.size : ''; }
  function takeFile(file, sheet) {
    var again = sheet == null && PF.file && PF.accepted && sigOf(file) === sigOf(PF.file);
    dupLine(!!again);
    if (again) return;
    PF.accepted = false;
    PF.answers = {}; PF.file = file; PF.source = file.name || 'that file'; PF.sheet = sheet == null ? null : sheet;
    say('pf-door-out', 'Reading ' + esc(PF.source) + '…');
    A.readStatement(file, PF.sheet).then(function (got) {
      PF.sheets = got.sheets || null; PF.sheetName = got.sheetName || null;
      readInto(got.rows ? got.rows : got.text, true);
      if (got.sheets && got.sheets.length > 1) offerSheets(got.sheets, got.sheetName);
    }).catch(function (err) { forget(); card('refused', PF.source); A.chime('no'); say('pf-door-out', '', notice('bad', esc(err.message))); refreshGate(); });
  }
  function offerSheets(sheets, current) {
    var host = $('#pf-door-out');
    var wrap = document.createElement('div');
    wrap.className = 'field'; wrap.style.marginTop = '.8rem';
    wrap.innerHTML = '<label for="pf-sheet">This file has ' + sheets.length + ' tabs. Reading <strong>' + esc(current) + '</strong>.</label><select id="pf-sheet">' +
      sheets.map(function (n) { return '<option' + (n === current ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select><p class="hint">On a consolidated statement the transactions are usually not the first tab.</p>';
    host.appendChild(wrap);
    $('#pf-sheet').addEventListener('change', function () { takeFile(PF.file, this.value); });
  }
  /* what was read is forgotten before a new attempt is reported */
  function forget() {
    PF.kind = null; PF.holdings = null; PF.imported = null; PF.valuations = []; PF.switches = 0; PF.funds = [];
    $('#pf-read').hidden = true; $('#pf-out').innerHTML = ''; PF.ran = false;
    drawFundCards();
  }
  function readInto(source, fresh) {
    PF.last = source;
    var r = U.portfolioFile(source, PF.answers);
    if (fresh) {
      var ok = r.ok || r.ask === 'direction';
      PF.accepted = ok;
      if (PF.file) card(ok ? 'loaded' : 'refused', PF.source);
      A.chime(ok ? 'ok' : 'no');
    }
    if (r.ask === 'direction') { forget(); return askDirection(r); }
    if (!r.ok) {
      forget();
      say('pf-door-out', '', notice('bad', esc(r.message)));
      refreshGate();
      return;
    }
    PF.kind = r.kind;
    PF.holdings = r.kind === 'holdings' ? r.rows : null;
    PF.imported = r.kind === 'ledger' ? r.rows : null;
    PF.valuations = r.valuations || [];
    PF.switches = r.switches || 0;
    $('#pf-paste-box').hidden = true;
    say('pf-door-out', '', notice('ok', 'Read <strong>' + esc(PF.source) + '</strong>.'));
    drawRead(r);
  }
  function askDirection(r) {
    var guessed = 0;
    var words = r.words.map(function (w, i) {
      if (w.guess) guessed++;
      return '<label class="tick"><input type="checkbox" data-word="' + esc(w.word) + '" id="pf-dir-' + i + '"' + (w.guess === 'out' ? ' checked' : '') + '><span>' + esc(w.word) +
        ' <span class="qsub">' + w.count + (w.count === 1 ? ' line' : ' lines') + (w.guess ? ' · read as money ' + w.guess : ' · not recognised') + '</span></span></label>';
    }).join('');
    say('pf-door-out', '', '<div class="notice"><span class="ic">?</span><span>' + esc(r.message) + '</span></div><div class="ticks">' + words + '</div>' +
      '<p class="hint">' + (guessed ? 'Ticked from what these words usually mean. Change anything that is wrong for your statement. ' : '') + 'Anything left unticked is read as money in.</p>' +
      '<div class="btnrow"><button class="primary" type="button" id="pf-dir-go">Read them this way</button></div>');
    $('#pf-dir-go').addEventListener('click', function () {
      var map = {};
      $$('[data-word]', $('#pf-door-out')).forEach(function (b) { map[b.dataset.word] = b.checked ? 'out' : 'in'; });
      PF.answers.direction = map;
      readInto(PF.last);
    });
    refreshGate();
  }

  /* ---------------------------------------------- what was read, as a summary */
  function drawRead(r) {
    var card = $('#pf-read'), summary = $('#pf-read-summary'), list = $('#pf-read-list'), head = $('#pf-read-h');
    card.hidden = false;
    if (r.kind === 'holdings') {
      head.textContent = 'What you hold';
      var inv = 0, cur = 0;
      PF.holdings.forEach(function (h) { inv += h.invested || 0; cur += h.current || 0; });
      summary.innerHTML = '<p class="hint tight">' + PF.holdings.length + (PF.holdings.length === 1 ? ' fund' : ' funds') + ' read from ' + esc(PF.source) +
        (r.skipped ? ', ' + r.skipped + ' line' + (r.skipped === 1 ? '' : 's') + ' skipped' : '') + (r.totalsDropped ? ', a totals row left out so it is not counted twice' : '') + '.</p>' +
        '<div class="stats">' + stat('Funds', String(PF.holdings.length)) + stat('You put in', money(inv)) + stat('Worth now', money(cur)) + '</div>';
      list.innerHTML = PF.holdings.map(function (h, i) {
        return readLine(i, esc(h.name), [['put in', h.invested == null ? 'not in the file' : money(h.invested)], ['worth now', h.current == null ? 'not in the file' : money(h.current)]]);
      }).join('');
      PF.funds = [];
    } else {
      head.textContent = 'Money in and out';
      var ins = 0, outs = 0, nIn = 0, nOut = 0, first = Infinity, last = -Infinity;
      PF.imported.forEach(function (f) { if (f.dir === 'out') { outs += f.amount; nOut++; } else { ins += f.amount; nIn++; } if (f.t < first) first = f.t; if (f.t > last) last = f.t; });
      var groups = U.schemeTotals(PF.imported);
      var named = groups.some(function (g) { return g.name; });
      PF.funds = groups.map(function (g) { return { key: g.name, title: titleOf(g.name), g: g }; });
      summary.innerHTML = '<p class="hint tight">' + PF.imported.length + (PF.imported.length === 1 ? ' payment' : ' payments') + ' read from ' + esc(PF.source) +
        (r.skipped ? ', ' + r.skipped + ' line' + (r.skipped === 1 ? '' : 's') + ' skipped' : '') + ', ' + fmtDate(first) + ' to ' + fmtDate(last) + '.' +
        (PF.switches ? ' ' + PF.switches + (PF.switches === 1 ? ' switch between funds was' : ' switches between funds were') + ' recognised and left out of the totals of money put in and taken out.' : '') +
        (!r.dateCertain && r.example ? ' These dates read two ways; ' + esc(r.example.raw) + ' has been read as ' + esc(r.example.dayFirst) + '. Check the lines below.' : '') + '</p>' +
        '<div class="stats">' + stat('Money in', money(ins) + (nIn ? ' · ' + nIn : '')) + stat('Money out', nOut ? money(outs) + ' · ' + nOut : 'none') +
        (named ? stat('Funds named', String(groups.length)) : '') + '</div>' +
        (named ? '<div class="fundcards">' + groups.map(function (g) {
          return '<div class="fundcard"><div class="fc-name">' + esc(titleOf(g.name)) + '</div><div class="fc-figs">' +
            fig('Put in', money(g.paidIn)) + fig('Taken out', g.tookOut ? money(g.tookOut) : 'none') + fig('Units left', g.hasUnits ? units3(g.units) : 'not in this file') + '</div></div>';
        }).join('') + '</div>' : '');
      list.innerHTML = PF.imported.map(function (f, i) {
        return readLine(i, fmtDate(f.t) + (f.fund ? ' · ' + esc(f.fund) : ''), [[f.dir === 'out' ? 'money out' : 'money in', money(f.amount) + (f.switch ? ' (switch)' : '')]]);
      }).join('');
    }
    $$('[data-drop]', list).forEach(function (b) {
      b.addEventListener('click', function () {
        var arr = r.kind === 'holdings' ? PF.holdings : PF.imported;
        arr.splice(+b.dataset.drop, 1);
        if (!arr.length) { resetPortfolio(); return; }
        drawRead(r);
      });
    });
    drawFundCards();
  }
  function fig(k, v) { return '<span class="fc-fig"><span class="k">' + esc(k) + '</span> <b>' + v + '</b></span>'; }
  function readLine(i, title, pairs) {
    return '<li class="readline"><div class="rl-head"><span class="rl-title">' + title + '</span><button class="link" type="button" data-drop="' + i + '">drop</button></div>' +
      '<div class="rl-figs">' + pairs.map(function (p) { return '<span class="rl-fig"><span class="qsub">' + esc(p[0]) + '</span> <b>' + p[1] + '</b></span>'; }).join('') + '</div></li>';
  }
  function units3(n) { return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }
  function nav4(n) { return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }); }

  /* ============================== step 2: one card per fund, valued from its
     NAV file, or typed as the last resort */
  function drawFundCards() {
    var host = $('#pf-values');
    var keep = {};
    PF.funds.forEach(function (f, i) {
      keep[f.key] = true;
      var row = host.querySelector('[data-scheme="' + CSS.escape(f.key) + '"]');
      if (row) { row.querySelector('.val-name').innerHTML = cardHead(f); return; }
      row = A.el('div', { class: 'valrow', 'data-scheme': f.key });
      var id = 'pfv-' + (rowSeq++);
      var closed = f.g && f.g.closed;
      var typedFile = PF.mode === 'file';
      row.innerHTML = '<div class="val-name">' + cardHead(f) + '</div>' + (closed ? '' :
        '<div class="val-door" id="' + id + '-door"></div>' +
        (typedFile ? '<details class="explain inner val-typed"><summary>No NAV file? Type its value today</summary><div class="body">' +
          '<div class="field" style="max-width:20rem"><label for="' + id + '-amt" class="val-label">Value today (₹)</label>' +
          '<input type="number" class="val-amt" id="' + id + '-amt" inputmode="decimal" min="0" step="any">' +
          '<label class="switch"><input type="checkbox" class="val-navswitch"> <span>I only have the NAV (₹ per unit)</span></label>' +
          '<p class="hint val-echo"></p></div></div></details>' : '') +
        '<div class="val-status" aria-live="polite"></div><div class="val-confirm"></div>');
      host.appendChild(row);
      if (closed) return;
      var amt = row.querySelector('.val-amt'), sw = row.querySelector('.val-navswitch');
      if (amt) {
        /* a statement that carried its own valuation row for this fund */
        var vrow = PF.valuations.filter(function (x) { return (x.fund || '') === f.key; });
        if (vrow.length) { amt.value = vrow[vrow.length - 1].amount; row.dataset.valueDate = vrow[vrow.length - 1].t; row.querySelector('.val-typed').open = true; }
        amt.addEventListener('input', function () { delete row.dataset.valueDate; valuesChanged(f.key); });
        sw.addEventListener('change', function () { amt.value = ''; valuesChanged(f.key); });
      }
      PF.navDoors[f.key] = D.mount(row.querySelector('#' + id + '-door'), {
        prefix: 'pfnav' + id.replace(/\D/g, ''), kind: 'nav', noun: 'fund', label: 'NAV history of ' + f.title,
        hint: 'CSV, Excel or text · a date column and a NAV column',
        gate: navGate,
        describe: function (res) {
          var check = schemeCheck(f, res);
          return check && check.different ? { tag: 'Different scheme?', html: notice('warn', esc(check.message)) } : null;
        },
        onLoaded: function (res) {
          if (!res) delete PF.nav[f.key];
          else PF.nav[f.key] = { series: res.series, name: res.name, report: res.report, check: schemeCheck(f, res) };
          valuesChanged(f.key);
        }
      });
    });
    $$('.valrow', host).forEach(function (row) {
      if (!keep[row.dataset.scheme]) { delete PF.navDoors[row.dataset.scheme]; delete PF.nav[row.dataset.scheme]; row.remove(); }
    });
    PF.funds.forEach(function (f) { refreshFund(f.key); });
    refreshGate();
  }
  function cardHead(f) {
    var g = f.g, sub = '';
    if (g) {
      sub = g.closed ? 'units net to zero: you are out of it, so its ending is already in the statement'
        : (g.hasUnits && g.units > 0 ? units3(g.units) + ' units left · ' : '') + money(g.paidIn - g.tookOut) + ' net in' + (g.hasUnits ? '' : ' · no units in this file');
    } else {
      var t = typedTotals(f.key);
      sub = money(t.paidIn) + ' in' + (t.tookOut ? ', ' + money(t.tookOut) + ' out' : '');
    }
    return esc(f.title) + '<span class="qsub">' + sub + '</span>';
  }
  /* Typed rows: a fund is valued by its Worth today row or its NAV file. One
     with money taken out is taken as the reader's own account of how it
     ended; one with only money in waits for a value. */
  function typedValued(key) { return !!valueOf(key) || typedTotals(key).tookOut > 0; }
  function typedTotals(key) {
    var paidIn = 0, tookOut = 0, worth = 0, worthT = null;
    readRows().forEach(function (r) {
      if (r.label !== key || !goodRow(r)) return;
      if (r.kind === 'Money in') paidIn += r.amount; else if (r.kind === 'Money out') tookOut += r.amount;
      else { worth += r.amount; var t = A.isoToTs(r.date); if (worthT == null || t > worthT) worthT = t; }
    });
    return { paidIn: paidIn, tookOut: tookOut, worth: worth, worthT: worthT };
  }
  function fundOf(key) { return PF.funds.filter(function (f) { return f.key === key; })[0] || null; }
  function netInOf(key) {
    var f = fundOf(key);
    if (f && f.g) return f.g.paidIn - f.g.tookOut;
    var t = typedTotals(key);
    return t.paidIn - t.tookOut;
  }

  /* Units held now: from the statement where it carries them, else each
     payment divided by the NAV of its date, or the next NAV after it. */
  function unitsFor(key, series) {
    var f = fundOf(key);
    if (f && f.g && f.g.hasUnits) return f.g.units;
    if (!series) return null;
    var flows = flowsFor(key);
    if (!flows.length) return null;
    var units = 0;
    for (var i = 0; i < flows.length; i++) {
      var obs = E.atOrAfter(series, flows[i].t, 7);
      if (!obs) return null;
      units += (flows[i].kind === 'out' ? -1 : 1) * flows[i].amount / obs.v;
    }
    return units;
  }
  function knownUnits(key) {
    var f = fundOf(key);
    if (f && f.g && f.g.hasUnits && f.g.units > 0) return f.g.units;
    var nav = PF.nav[key];
    var u = nav ? unitsFor(key, nav.series) : null;
    return u != null && u > 0 ? u : null;
  }
  function flowsFor(key) {
    if (PF.mode === 'typed') {
      return readRows().filter(function (r) { return r.label === key && r.kind !== 'Worth today' && goodRow(r); })
        .map(function (r) { return { t: A.isoToTs(r.date), amount: r.amount, kind: r.kind === 'Money out' ? 'out' : 'in' }; });
    }
    return (PF.imported || []).filter(function (f) { return (f.fund || '') === key; }).map(function (f) { return { t: f.t, amount: f.amount, kind: f.dir, units: f.units }; });
  }

  /* What a fund is worth today, and where that figure came from.
     The NAV file comes first; a typed value is the last resort. */
  function valueOf(key) {
    var nav = PF.nav[key];
    if (nav && !navProblem(key)) {
      var u = unitsFor(key, nav.series), last = nav.series[nav.series.length - 1];
      return { amount: u * last.v, t: last.t, from: 'navfile', units: u, nav: last.v };
    }
    if (PF.mode === 'typed') {
      var t = typedTotals(key);
      return t.worth > 0 ? { amount: t.worth, t: t.worthT, from: 'typed' } : null;
    }
    var row = rowFor(key);
    if (!row) return null;
    var amt = row.querySelector('.val-amt'), sw = row.querySelector('.val-navswitch');
    var n = amt ? parseFloat(amt.value) : NaN;
    if (!isFinite(n) || n <= 0) return null;
    var when = row.dataset.valueDate ? +row.dataset.valueDate : A.todayTs();
    if (sw && sw.checked) {
      var units = knownUnits(key);
      return units ? { amount: n * units, t: when, from: 'typednav', units: units, nav: n } : null;
    }
    return { amount: n, t: when, from: 'typed' };
  }
  function rowFor(key) { return $('#pf-values [data-scheme="' + CSS.escape(key) + '"]'); }
  /* Why a loaded NAV file cannot value its fund, or null. Its last NAV must
     fall on or after the last payment, and the units must come to a holding. */
  function navProblem(key) {
    var nav = PF.nav[key];
    if (!nav) return null;
    var last = nav.series[nav.series.length - 1];
    var lastPaid = flowsFor(key).reduce(function (m, f) { return Math.max(m, f.t); }, -Infinity);
    if (isFinite(lastPaid) && last.t < lastPaid) return 'This NAV file ends on ' + fmtDate(last.t) + ', before your last payment on ' + fmtDate(lastPaid) + ', so it cannot say what the fund is worth today. Download its history up to today.';
    var u = unitsFor(key, nav.series);
    if (u == null) return 'The NAV file does not cover every payment date, so units cannot be worked out from it.' + (PF.mode === 'file' ? ' Type the value instead.' : '');
    if (!(u > 0)) return 'The units in these rows come to ' + units3(u) + ', which is not a holding: the statement may begin after your first purchases. Load a statement from your first purchase, or type the value.';
    return null;
  }

  /* C5: a value under a tenth, or over twenty times, the money that went in is
     probably a NAV typed into a value box. It is asked about, once, before any
     headline is printed. */
  function implausible(key) {
    var v = valueOf(key);
    if (!v || (v.from !== 'typed' && v.from !== 'typednav')) return null;
    var netIn = netInOf(key);
    if (!(netIn > 0)) return null;
    if (v.amount >= netIn * LOW && v.amount <= netIn * HIGH) return null;
    if (PF.confirmed[key] === v.amount) return null;
    return { value: v.amount, netIn: netIn, nav: v.from === 'typednav' ? v.nav : null };
  }
  function refreshFund(key) {
    var row = rowFor(key);
    if (!row) return;
    var f = fundOf(key);
    var status = row.querySelector('.val-status'), confirm = row.querySelector('.val-confirm');
    if (!status) return;
    var sw = row.querySelector('.val-navswitch'), amt = row.querySelector('.val-amt'), echo = row.querySelector('.val-echo'), lab = row.querySelector('.val-label');
    var units = knownUnits(key);
    if (sw) {
      sw.disabled = !units;
      if (!units && sw.checked) sw.checked = false;
      sw.parentNode.classList.toggle('off', !units);
      lab.textContent = sw.checked ? 'NAV today (₹ per unit)' : 'Value today (₹)';
      amt.placeholder = sw.checked ? 'per unit' : '';
    }
    var v = valueOf(key), nav = PF.nav[key];
    var typedFold = row.querySelector('.val-typed');
    if (typedFold) typedFold.hidden = !!(v && v.from === 'navfile');
    if (echo) {
      var n = parseFloat(amt.value);
      echo.textContent = !units ? (f && f.g && f.g.hasUnits ? 'Units are needed to turn a NAV into a value, and the units in these rows do not come to a holding.' : 'Units are needed to turn a NAV into a value, and this statement has none for this fund.')
        : sw && sw.checked && isFinite(n) && n > 0 ? '= ' + money(n * units) + ' for ' + units3(units) + ' units' : (isFinite(n) ? A.echo(n) : '');
      echo.classList.toggle('dim', !units);
    }
    var html = '';
    if (nav && v && v.from === 'navfile') {
      html = notice('ok', 'Valued from the NAV file: ' + units3(v.units) + ' units × ' + nav4(v.nav) + ' on ' + fmtDate(v.t) + ' = <strong>' + money(v.amount) + '</strong>.' +
        (nav.check && nav.check.different ? ' <strong>The result is tagged: valued against a different scheme’s NAV.</strong>' : ''));
    } else if (nav && navProblem(key)) {
      html = notice('warn', esc(navProblem(key)));
    } else if (PF.mode === 'typed') {
      html = v ? notice('ok', 'Valued by your <em>Worth today</em> row: ' + money(v.amount) + (v.t ? ' on ' + fmtDate(v.t) : '') + '.')
        : (f && !(f.g && f.g.closed) ? notice('', 'Not valued yet. Load this fund’s NAV file above, or add a <em>Worth today</em> row for it in step 1.') : '');
    }
    setHtml(status, html);
    var odd = implausible(key);
    setHtml(confirm, odd ? '<div class="notice warn confirmline"><span class="ic" aria-hidden="true">?</span><span>' +
      (odd.nav != null ? 'Is <strong>' + esc(nav4(odd.nav)) + '</strong> the NAV, the price of one unit? It makes the holding worth ' + money(odd.value) + ', against ' + money(odd.netIn) + ' put in, net.'
        : 'Is <strong>' + money(odd.value) + '</strong> the whole holding’s value, not its NAV? ' + money(odd.netIn) + ' went in, net.') +
      '<span class="btnrow"><button class="secondary" type="button" data-confirm="yes">' + (odd.nav != null ? 'Yes, that is the NAV' : 'Yes, that is the whole value') + '</button><button class="link" type="button" data-confirm="no">No, change it</button></span></span></div>' : '');
  }
  /* Only what changed is redrawn: a blur that redraws a button under the
     reader's finger would swallow the tap. */
  function setHtml(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }
  /* the answer to "is this the whole holding's value?", for every card at once */
  function onConfirm(e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-confirm]') : null;
    if (!b) return;
    var row = b.closest('.valrow'), key = row.dataset.scheme;
    if (b.dataset.confirm === 'yes') { var v = valueOf(key); if (v) PF.confirmed[key] = v.amount; valuesChanged(key); return; }
    var amt = row.querySelector('.val-amt');
    if (amt) { var d = row.querySelector('.val-typed'); if (d) d.open = true; amt.focus(); amt.select(); }
    else { var first = $$('#pf-rows .in-tag').filter(function (t) { return t.value.trim() === key; })[0]; if (first) first.focus(); }
  }
  function valuesChanged(key) {
    if (key != null) refreshFund(key); else PF.funds.forEach(function (f) { refreshFund(f.key); });
    refreshGate();
    if (PF.ran) calcPortfolio();
  }

  /* C5: a NAV file loaded for a fund is checked against the fund's rows: the
     ISIN or AMFI code when both carry one, else the name, its plan and its
     option. Only a full scheme name is compared; a short nickname typed by
     the reader is not. */
  var STOP = ['fund', 'plan', 'option', 'the', 'of', 'and', 'scheme', 'mutual', 'growth', 'direct', 'regular', 'idcw', 'dividend', 'payout',
              'reinvestment', 'reinvest', 'investment', 'formerly', 'known', 'as', 'erstwhile', 'an', 'a', 'open', 'ended', 'with', 'g', 'd', 'gr'];
  function words(n) { return String(n || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(function (w) { return w && STOP.indexOf(w) === -1; }); }
  function planOf(n) { return /\bdirect\b/i.test(n) ? 'Direct' : /\bregular\b/i.test(n) ? 'Regular' : null; }
  function optionOf(n) { return /\bidcw\b|\bdividend\b|\bpayout\b|\breinvest/i.test(n) ? 'IDCW' : /\bgrowth\b/i.test(n) ? 'Growth' : null; }
  function schemeCheck(f, res) {
    var g = f.g, rep = res.report || {}, fileName = rep.scheme || res.name || '';
    var rowName = f.key;
    if (g && g.isin && rep.isins && rep.isins.length) {
      return rep.isins.indexOf(g.isin) !== -1 ? { different: false } : mismatch('the ISIN on your rows is ' + g.isin + ' and the file’s is ' + rep.isins.join(' or '));
    }
    if (g && g.code && rep.code) {
      return String(g.code) === String(rep.code) ? { different: false } : mismatch('your rows carry scheme code ' + g.code + ' and the file holds code ' + rep.code);
    }
    if (!rowName || !fileName) return null;
    /* a scheme renamed over the years matches under any of its names */
    var older = (rep.names || []).filter(function (n) { return n && n !== fileName; });
    for (var k = 0; k < older.length; k++) {
      if (words(older[k]).join(' ') === words(rowName).join(' ') && planOf(older[k]) === planOf(rowName) && optionOf(older[k]) === optionOf(rowName)) return { different: false };
    }
    var a = words(rowName), b = words(fileName);
    var full = a.length >= 3 || planOf(rowName) || optionOf(rowName);
    if (!full || !b.length) return null;
    if (a[0] !== b[0]) return mismatch('your rows are for ' + rowName + ' and the file holds ' + fileName + (rep.code ? ' (code ' + rep.code + ')' : ''));
    var shared = a.filter(function (w) { return b.indexOf(w) !== -1; }).length;
    if (shared / Math.min(a.length, b.length) < 0.6) return mismatch('your rows are for ' + rowName + ' and the file holds ' + fileName + (rep.code ? ' (code ' + rep.code + ')' : ''));
    var pa = planOf(rowName), pb = planOf(fileName), oa = optionOf(rowName), ob = optionOf(fileName);
    if (pa && pb && pa !== pb) return mismatch('your rows are for the ' + pa + ' plan and the file holds the ' + pb + ' plan');
    if (oa && ob && oa !== ob) return mismatch('your rows are for the ' + oa + ' option and the file holds the ' + ob + ' option');
    return { different: false };
    function mismatch(why) {
      return { different: true, message: 'This file may be a different scheme’s NAV: ' + why + '. Each plan and option has its own NAV, so a value worked out from another one is wrong for this fund.' };
    }
  }

  /* ======================================================== the button (H4) */
  function stepsDone() {
    if (!PF.mode) return { one: false, two: false };
    if (PF.mode === 'file') {
      if (PF.kind === 'holdings') return { one: true, two: true, holdings: true };
      if (PF.kind !== 'ledger') return { one: false, two: false };
      var open = PF.funds.filter(function (f) { return !(f.g && f.g.closed); });
      var valued = open.filter(function (f) { return !!valueOf(f.key); });
      var odd = open.filter(function (f) { return !!implausible(f.key); });
      return { one: true, two: valued.length === open.length && !odd.length, open: open.length, valued: valued.length, odd: odd.length };
    }
    var rows = readRows().filter(goodRow);
    var anyIn = rows.some(function (r) { return r.kind === 'Money in'; });
    var keys = PF.funds.map(function (f) { return f.key; });
    var valued = keys.filter(typedValued);
    var oddT = keys.filter(function (k) { return !!implausible(k); });
    return { one: anyIn, two: anyIn && valued.length === keys.length && !oddT.length, open: keys.length, valued: valued.length, odd: oddT.length };
  }
  function refreshGate() {
    var st = stepsDone();
    $('#pf-actions').hidden = !PF.mode;
    $('#pf-calc').hidden = !(st.one && st.two);
    var s1 = $('#pf-step1'), s2 = $('#pf-step2'), s3 = $('#pf-step3');
    s1.dataset.done = st.one ? 'yes' : 'no';
    s2.hidden = !(PF.mode && st.one && !st.holdings);
    s2.dataset.done = st.two ? 'yes' : 'no';
    s3.hidden = !(PF.mode && st.one && !st.holdings);
    var note = $('#pf-values-note');
    if (note) note.textContent = !st.open ? '' : st.odd ? 'One value needs your answer above before the result can be shown.'
      : st.valued === st.open ? 'Every fund is valued.'
      : st.valued + ' of ' + st.open + ' valued. The result waits for all of them, so no wrong headline is printed.' + (PF.mode === 'typed' ? ' A fund with only money in needs its NAV file, or a Worth today row in step 1.' : '');
  }

  /* ================================================================= flows */
  /* Everything the arithmetic needs, from either mode, or the reason it cannot run yet. */
  function gather() {
    var flows = [], problems = [], missing = [], names = [], odd = [];
    var invested = 0, withdrawn = 0, current = 0, switched = 0;
    function addName(n) { if (names.indexOf(n) === -1) names.push(n); }
    if (PF.mode === 'typed') {
      readRows().forEach(function (r, i) {
        var blank = !r.date && !isFinite(r.amount);
        if (blank) return;
        var t = A.isoToTs(r.date);
        if (isNaN(t)) { problems.push('Row ' + (i + 1) + ' has no date.'); return; }
        if (t > A.todayTs()) { problems.push('Row ' + (i + 1) + ' is dated ' + fmtDate(t) + ', which is in the future. This measures money that has already moved.'); return; }
        if (!isFinite(r.amount) || r.amount <= 0) { problems.push('Row ' + (i + 1) + ' needs an amount greater than zero, typed as a plain positive number.'); return; }
        addName(r.label);
        if (r.kind === 'Money in') { invested += r.amount; flows.push({ t: t, amount: -r.amount, kind: 'in', label: r.label }); }
        else if (r.kind === 'Money out') { withdrawn += r.amount; flows.push({ t: t, amount: r.amount, kind: 'out', label: r.label }); }
      });
      names.forEach(function (key) {
        var v = valueOf(key);
        if (!v && !typedValued(key)) missing.push(titleOf(key));
        if (!v) return;
        if (v.from === 'typed') {
          readRows().forEach(function (r) {
            if (r.label !== key || r.kind !== 'Worth today' || !goodRow(r)) return;
            var t = A.isoToTs(r.date);
            if (t > A.todayTs()) return;
            current += r.amount; flows.push({ t: t, amount: r.amount, kind: 'value', label: key });
          });
        } else { current += v.amount; flows.push({ t: v.t, amount: v.amount, kind: 'value', label: key, fromFile: true }); }
        if (implausible(key)) odd.push(titleOf(key));
      });
    } else if (PF.kind === 'ledger') {
      PF.imported.forEach(function (f) {
        if (f.dir === 'out') withdrawn += f.switch ? 0 : f.amount; else invested += f.switch ? 0 : f.amount;
        if (f.switch && f.dir === 'in') switched += f.amount;   /* one switch, two legs: counted once */
        flows.push({ t: f.t, amount: f.dir === 'out' ? f.amount : -f.amount, kind: f.dir, label: f.fund || '', units: f.units, switch: !!f.switch });
      });
      PF.funds.forEach(function (f) {
        addName(f.key);
        if (f.g && f.g.closed) return;
        var v = valueOf(f.key);
        if (!v) { missing.push(f.title); return; }
        if (implausible(f.key)) odd.push(f.title);
        current += v.amount; flows.push({ t: v.t, amount: v.amount, kind: 'value', label: f.key, fromFile: v.from === 'navfile' });
      });
    }
    /* C2's last guard: a value worked out from a NAV file that never moved
       over the holding is not a value. */
    var flat = null;
    names.forEach(function (key) {
      var nav = PF.nav[key];
      if (!nav || flat) return;
      var own = flows.filter(function (x) { return x.label === key && x.kind !== 'value'; });
      if (!own.length) return;
      var from = Math.min.apply(null, own.map(function (x) { return x.t; }));
      var part = P.sliceSeries(nav.series, E.atOrBefore(nav.series, from, 7) ? E.atOrBefore(nav.series, from, 7).t : from, null);
      if (part.length > 1 && part.every(function (p) { return p.v === part[0].v; })) flat = nav;
    });
    return { flows: flows, names: names, problems: problems, missing: missing, odd: odd, flat: flat,
             invested: invested, withdrawn: withdrawn, current: current, switched: switched };
  }

  /* ================================================================ results */
  function calcPortfolio() {
    var out = $('#pf-out');
    if (PF.mode === 'file' && PF.kind === 'holdings') { PF.ran = true; out.innerHTML = holdingsAnswer(); return; }
    var g = gather();
    if (g.problems.length) { out.innerHTML = notice('bad', g.problems.slice(0, 4).map(esc).join('<br>')); return; }
    if (g.flat) { out.innerHTML = notice('bad', esc(P.flatCopy(g.flat.report && g.flat.report.headers))); return; }
    if (g.odd.length) {
      out.innerHTML = notice('bad', '<strong>No result yet.</strong> Check the value of <strong>' + g.odd.map(esc).join('</strong>, <strong>') + '</strong> in step 2: it is far from what went in, which is what a NAV typed as a value looks like.');
      return;
    }
    if (g.missing.length) {
      out.innerHTML = notice('bad', '<strong>No portfolio figure yet.</strong> ' + (g.missing.length === 1 ? 'One fund is' : g.missing.length + ' funds are') +
        ' not valued: <strong>' + g.missing.map(esc).join('</strong>, <strong>') + '</strong>. A rate worked out without ' + (g.missing.length === 1 ? 'it' : 'them') +
        ' would be wrong, not approximate, so nothing is printed until every fund has a value, or its NAV file.') +
        partialAnswer(g.invested, g.withdrawn, 0);
      return;
    }
    var res = E.xirr(g.flows);
    if (!res.ok) {
      var extra = res.code === 'NO_VALUE'
        ? (PF.mode === 'file' ? ' Give each fund its value today in step 2, or load its NAV file.' : ' Add a last row with today’s date, <strong>Worth today</strong>, and what the holding is worth now, or load the fund’s NAV file in step 2.')
        : '';
      out.innerHTML = notice('bad', esc(res.message) + extra) + partialAnswer(g.invested, g.withdrawn, g.current);
      return;
    }
    PF.ran = true;
    var name = g.names.length === 1 ? titleOf(g.names[0]) : 'your portfolio';
    var withNav = Object.keys(PF.nav).filter(function (k) { return g.names.indexOf(k) !== -1; });
    var info = fundInfo(g, withNav);
    var price = PF.index && PF.index.kind === 'PRICE';
    out.innerHTML = A.tabs('pf-tabs', [
      { key: 'main', label: 'Your return', html: mainTab(g, res, info) },
      { key: 'index', label: fundCmp() ? 'Against ' + A.shortName(PF.index.name, g.names.map(titleOf)) : price ? 'Against the price index' : 'Against the index', html: PF.index ? indexTab(g, res) : null },
      { key: 'fund', label: 'Against the fund', html: withNav.length ? againstFundTab(g, res, info) : null },
      { key: 'all', label: 'All the numbers', html: allNumbersTab(g, res, info) }
    ]) + A.pdfFoot('portfolio', name);
    wireRealReturn(res.rate);
  }

  /* per fund: its own flows, rate, units, NAV today, and the fund-file measures */
  function fundInfo(g, withNav) {
    var out = {};
    g.names.forEach(function (key) {
      var flows = g.flows.filter(function (f) { return (f.label || '') === key; });
      var put = 0, took = 0, worth = 0;
      flows.forEach(function (f) { if (f.kind === 'in') put += -f.amount; else if (f.kind === 'out') took += f.amount; else worth += f.amount; });
      var r = E.xirr(flows);
      var v = valueOf(key);
      var units = v && v.units ? v.units : knownUnits(key);
      var navToday = v && v.nav ? v.nav : (units && worth ? worth / units : null);
      var lots = flowsFor(key).map(function (x) { return { t: x.t, amount: x.amount, dir: x.kind === 'out' ? 'out' : 'in', units: x.units }; });
      var navFile = PF.nav[key];
      if (navFile) lots.forEach(function (l) { if (!(l.units > 0)) { var o = E.atOrAfter(navFile.series, l.t, 7); if (o) l.units = l.amount / o.v; } });
      var avg = E.averagePurchaseNav(lots);
      var info = { key: key, title: titleOf(key), flows: flows, put: put, took: took, worth: worth, rate: r, units: units, navToday: navToday,
                   avg: avg.ok ? avg.nav : null, closed: !!(fundOf(key) && fundOf(key).g && fundOf(key).g.closed),
                   be: E.breakEven({ paidIn: put, tookOut: took, value: worth, units: units }), different: !!(navFile && navFile.check && navFile.check.different) };
      if (withNav.indexOf(key) !== -1) {
        var nav = navFile;
        var payments = flows.filter(function (f) { return f.kind !== 'value'; }).map(function (f) { return { t: f.t, amount: Math.abs(f.amount), kind: f.kind, units: f.units }; });
        var valueFlow = flows.filter(function (f) { return f.kind === 'value'; })[0];
        var valueDate = valueFlow ? valueFlow.t : nav.series[nav.series.length - 1].t;
        var firstT = payments.reduce(function (m, f) { return Math.min(m, f.t); }, Infinity);
        info.nav = nav; info.payments = payments; info.valueFlow = valueFlow; info.valueDate = valueDate; info.firstT = firstT;
        info.over = E.fundOverDates(firstT, valueDate, nav.series, r.ok ? r.rate : NaN);
        info.span = info.over.ok ? E.spanPercentile(nav.series, info.over.from, info.over.to, info.over.rate) : null;
        info.path = E.holdingPath(payments.map(function (p) { return { t: p.t, amount: p.amount, dir: p.kind, units: p.units }; }), nav.series, { valueDate: valueDate });
        info.eq = E.benchmarkEquivalent(payments, nav.series, { valueDate: valueDate, priceRule: 'after' });
      }
      out[key] = info;
    });
    return out;
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  /* Section 7: where the reader's stretch sits, in words that stay true at
     the ends: the share is rounded down, so 100 is never claimed while one
     stretch (the reader's own) only equalled it. */
  function percentileWords(sp) {
    var y = sp.years.toFixed(1), n = sp.count.toLocaleString('en-IN');
    if (sp.below === 0) return 'Your ' + y + ' years were the lowest of this fund’s ' + y + '-year stretches: none of the ' + n + ' stretches of that length in its file returned less.';
    if (sp.below + sp.equal === sp.count) return 'Your ' + y + ' years were the highest of this fund’s ' + y + '-year stretches: none of the ' + n + ' stretches of that length in its file returned more.';
    var p = Math.max(1, Math.min(99, Math.floor(sp.percentile)));
    return 'Your ' + y + ' years sit in the <strong>' + ordinal(p) + ' percentile</strong> of this fund’s ' + y + '-year stretches: of the ' + n + ' stretches of that length in its file, ' + p + ' in 100 returned less.';
  }

  function mainTab(g, res, info) {
    var rate = res.rate;
    var net = g.current + g.withdrawn - g.invested;
    var abs = g.invested > 0 ? net / g.invested : 0;
    var first = g.flows.reduce(function (m, f) { return Math.min(m, f.t); }, Infinity);
    var last = g.flows.reduce(function (m, f) { return Math.max(m, f.t); }, -Infinity);
    var years = (last - first) / (365.2425 * 86400000);
    var young = E.youngMoney(g.flows.filter(function (f) { return f.kind === 'in' && !f.switch; }).map(function (f) { return { t: f.t, amount: -f.amount, kind: 'in' }; }), last);
    var youngLine = young.share > 0.5 ? '<div class="sub youngline">' + money(young.recent) + ' of the ' + money(young.total) + ' you put in, more than half, went in during the two years to ' + fmtDate(last) + '.</div>' : '';
    var different = Object.keys(info).filter(function (k) { return info[k].different; }).map(function (k) { return info[k].title; });
    var html = '';
    if (res.underAYear) {
      html += '<div class="result"><div class="label">Your total gain so far</div><div class="value">' + esc(A.signedPct(abs)) + '</div>' +
        '<div class="sub">' + money(g.invested) + ' put in, worth ' + money(g.current + g.withdrawn) + ' after ' + res.days + ' days, ' + fmtDate(first) + ' to ' + fmtDate(last) + '. Before exit load and tax.</div>' + youngLine + '</div>' +
        '<p class="cardtext">Under a year, the yearly rate is the one to ignore: it stretches ' + res.days + ' days to a twelve-month pace and reads ' +
        esc(pct(rate)) + ' a year, which is not something that has happened to anyone. Read the total. The yearly rate starts meaning something after a year.</p>';
    } else {
      html += '<div class="result"><div class="label">Your XIRR</div><div class="value">' + esc(pct(rate)) + '</div>' +
        '<div class="sub">a year, across ' + years.toFixed(1) + ' years, ' + fmtDate(first) + ' to ' + fmtDate(last) + '. Before exit load and tax.</div>' + youngLine + '</div>';
    }
    if (different.length) html += notice('warn', '<strong>Valued against a different scheme’s NAV:</strong> ' + different.map(esc).join(', ') + '. Step 2 says why.');
    if (res.alternatives && res.alternatives.length) {
      html += notice('warn', '<strong>A second rate also fits these entries: ' + esc(pct(res.alternatives[0])) + '.</strong> When money goes out and comes back in more than once, the arithmetic can have two answers. The one above is the one a spreadsheet gives; read both with care, and rely on the total gain.');
    }
    html += '<div class="stats topline">' + stat('Total return', A.signedPct(abs)) + stat('You put in', money(g.invested)) +
      (g.withdrawn ? stat('You took out', money(g.withdrawn)) : '') + stat('Worth now', money(g.current)) + stat('Gain or loss', A.signedMoney(net)) + '</div>' +
      (g.switched ? '<p class="hint">' + money(g.switched) + ' moved between your own funds by switch and is left out of the two totals; it was never new money.</p>' : '');
    html += fundCards(g, info);
    html += fundOverCards(info);
    if (PF.index) html += indexSummary(g, res);
    html += ownFallLines(info);
    html += realReturnCard(rate);
    return html;
  }

  /* one card per fund: name, then put in, taken out, units, value, XIRR;
     the average NAV paid and today's NAV where the units are known; the
     break-even line where the fund is in loss */
  function fundCards(g, info) {
    var keys = g.names.filter(function (k) { return info[k]; });
    var many = keys.length > 1;
    var cards = keys.map(function (k) {
      var x = info[k];
      var lines = [];
      if (x.avg != null && x.navToday != null) lines.push('Average NAV you paid: <strong>' + nav4(x.avg) + '</strong> a unit, across every purchase. NAV today: <strong>' + nav4(x.navToday) + '</strong>.');
      if (x.be.inLoss && !x.closed) lines.push('To break even on what you put in, ' + (x.be.navNeeded != null ? 'the NAV needs to reach <strong>' + nav4(x.be.navNeeded) + '</strong>, or ' : '') + 'the value <strong>' + money(x.be.valueNeeded) + '</strong>.');
      if (!many && !lines.length) return '';
      return '<div class="fundcard">' + (many ? '<div class="fc-name">' + esc(x.title) + '</div><div class="fc-figs">' +
        fig('Put in', money(x.put)) + fig('Taken out', x.took ? money(x.took) : 'none') + fig('Units', x.units ? units3(x.units) : 'not known') +
        fig('Value', x.worth ? money(x.worth) : (x.closed ? 'sold' : 'none')) + fig('XIRR', x.rate.ok ? pct(x.rate.rate) : holdingWhy(x.rate, x.flows)) + '</div>' : '') +
        lines.map(function (l) { return '<p class="fc-line">' + l + '</p>'; }).join('') + '</div>';
    }).filter(Boolean);
    if (!cards.length) return '';
    return '<div class="card"><h2>' + (many ? 'Each fund' : esc(info[keys[0]].title)) + '</h2><div class="fundcards">' + cards.join('') + '</div>' +
      (many ? '<p class="hint">Each fund’s XIRR is worked out from its own payments and value; the portfolio figure above weighs every fund by how much money was in it, and for how long.</p>' : '') + '</div>';
  }
  function holdingWhy(res, rows) {
    var says = { TOO_FEW: 'needs 2 dated rows; this fund has ' + rows.length, NO_INVESTMENT: 'no money going in, only a valuation',
      NO_VALUE: 'no valuation and no withdrawal', SAME_DAY: 'every row is on one date', UNSOLVABLE: 'no single rate fits' };
    return says[res.code] || res.message || 'not enough entries';
  }

  /* the fund's own rate over the reader's dates, beside the reader's, with
     the gap in points and where the reader's stretch sits among the fund's */
  function fundOverCards(info) {
    return Object.keys(info).filter(function (k) { return info[k].over; }).map(function (k) {
      var x = info[k], over = x.over, own = x.rate;
      if (!over.ok || !own.ok) return '<div class="card"><h2>' + esc(x.title) + ': the fund over your dates</h2>' + notice('warn', esc((over.ok ? own : over).message || 'The file does not cover your dates.')) + '</div>';
      var rel = A.relation(over.rate, own.rate);
      var gap = Math.abs(over.rate - own.rate) * 100;
      var sentence = rel === 'equal' ? A.equalWords(over.rate, own.rate, 2)
        : rel === 'greater' ? 'The fund’s own rate is ' + gap.toFixed(2) + ' percentage points a year above your money’s.'
        : 'Your money’s rate is ' + gap.toFixed(2) + ' percentage points a year above the fund’s own.';
      var sp = x.span;
      return '<div class="card"><h2>' + esc(x.title) + ': the fund over your dates</h2>' +
        '<div class="stats">' + stat('The fund itself', pct(over.rate, 2)) + stat('Your money in it', pct(own.rate, 2)) + stat('The gap', (rel === 'equal' ? '0.00' : gap.toFixed(2)) + ' points') + '</div>' +
        '<p class="cardtext">The fund’s NAV from ' + fmtDate(over.from) + ' to ' + fmtDate(over.to) + ', one lump sum on the first day; your money, on the dates it actually moved. ' + sentence + '</p>' +
        (sp && sp.ok ? '<p class="cardtext">' + percentileWords(sp) + '</p>' : '') +
        '</div>';
    }).join('');
  }
  function ownFallLines(info) {
    return Object.keys(info).filter(function (k) { return info[k].path && info[k].path.ok && info[k].path.worst.rupees > 0; }).map(function (k) {
      var x = info[k], w = x.path.worst;
      return '<div class="card"><h2>' + esc(x.title) + ': your money’s deepest fall</h2><div class="stats">' + stat('It fell by', money(w.rupees)) + stat('That was', w.share != null ? pct(w.share) + ' of its value' : 'not known') +
        stat('From', fmtDate(w.from)) + stat('To', fmtDate(w.to)) + '</div>' +
        '<p class="cardtext">From price moves alone; your own payments and withdrawals are taken out of the reckoning. ' +
        (x.path.recoveredOn ? 'It stood there again on ' + fmtDate(x.path.recoveredOn) + '.' : 'It had not stood there again by ' + fmtDate(x.path.path[x.path.path.length - 1].t) + '.') + '</p></div>';
    }).join('');
  }

  function realReturnCard(rate) {
    return '<div class="card" id="pf-real"><h2>After inflation, what is left?</h2>' +
      '<p class="hint tight">Type the inflation you want to measure against. This tool does not choose a figure for you.</p>' +
      '<div class="field" style="max-width:15rem"><label for="pf-infl">Inflation, % a year</label>' +
      '<input type="number" id="pf-infl" inputmode="decimal" step="0.1" min="0" max="25" aria-describedby="pf-infl-bad" placeholder="e.g. 6"><p class="hint refuse" id="pf-infl-bad" hidden></p></div>' +
      '<div id="pf-real-out"></div></div>';
  }
  function wireRealReturn(rate) {
    var input = $('#pf-infl'), out = $('#pf-real-out');
    if (!input || !out) return;
    input.addEventListener('input', function () {
      var i = parseFloat(input.value), bad = $('#pf-infl-bad');
      if (!isFinite(i)) { out.innerHTML = ''; if (bad) { bad.hidden = true; } return; }
      var say = A.checkInput('inflation', i);
      if (bad) { bad.textContent = say || ''; bad.hidden = !say; }
      if (say) { out.innerHTML = ''; return; }
      var real = (1 + rate) / (1 + i / 100) - 1;
      var rel = A.relation(real, 0);
      var words = rel === 'smaller' ? 'What this money buys fell: prices rose faster than it grew.'
        : rel === 'equal' ? 'What this money buys is about the same: it grew as fast as prices.'
        : 'What this money buys grew: it grew faster than prices.';
      out.innerHTML = '<div class="stats" style="margin:.2rem 0 0">' + stat('Your return', pct(rate)) + stat('Inflation', i.toFixed(1) + '%') + stat('What is left', pct(real)) + '</div>' +
        '<p class="cardtext">' + words + ' Worked out as (1 + return) ÷ (1 + inflation) − 1.</p>';
    });
  }

  /* ---------------------------------------------- the same rupees in the index */
  function indexEquivalent(g) {
    var ix = PF.index;
    var payments = g.flows.filter(function (f) { return f.kind !== 'value'; }).map(function (f) { return { t: f.t, amount: Math.abs(f.amount), kind: f.kind }; });
    var valueDate = g.flows.filter(function (f) { return f.kind === 'value'; }).reduce(function (m, f) { return Math.max(m, f.t); }, -Infinity);
    if (!isFinite(valueDate)) valueDate = ix.series[ix.series.length - 1].t;
    /* a fund's units are allotted at the NAV of the date or the next one, as the reader's are */
    return { payments: payments, eq: E.benchmarkEquivalent(payments, ix.series, { valueDate: valueDate, priceRule: ix.kind === 'NAV' ? 'after' : null }) };
  }
  function indexSentence(res, eq) {
    var rel = A.relation(res.rate, eq.rate);
    if (rel === 'undefined') return '';
    if (rel === 'equal') return A.equalWords(res.rate, eq.rate, 2);
    return 'Your money ran ' + esc(pct(Math.abs(res.rate - eq.rate), 2)) + ' a year ' + (rel === 'greater' ? 'ahead of' : 'behind') + ' the same rupees in ' + (fundCmp() ? esc(PF.index.name) : 'the index') + '.';
  }
  function kindNote() {
    var ix = PF.index;
    return ix.kind === 'PRICE' ? notice('warn', PRICE_FLAG)
      : ix.kind === 'NAV' ? ''
      : ix.kind !== 'TRI' ? notice('warn', 'Whether this index counts dividends has not been established. Say which it is under the index file in step 3; a price index flatters your side by about its dividend yield.') : '';
  }
  function indexSummary(g, res) {
    var ix = PF.index, x = indexEquivalent(g), eq = x.eq;
    var head = (ix.kind === 'PRICE' ? 'Against the price index: ' : '') + 'the same rupees, on the same dates, in ' + ix.name;
    var them = fundCmp() ? 'In ' + A.shortName(ix.name, g.names.map(titleOf)) : 'In the index';
    if (!eq.ok) return '<div class="card"><h2>' + esc(head) + '</h2>' + notice('bad', esc(eq.message)) + '</div>';
    return '<div class="card"><h2>' + esc(head.charAt(0).toUpperCase() + head.slice(1)) + '</h2>' + (fundCmp() ? '<p class="hint tight">' + esc(FUND_NOTE) + '</p>' : '') +
      '<div class="stats">' + stat('Your XIRR', pct(res.rate, 2)) + stat(them, eq.rate == null ? 'no rate' : pct(eq.rate, 2)) + '</div>' +
      (eq.rate != null ? '<p class="cardtext"><strong>' + indexSentence(res, eq) + '</strong> Both figures share your dates.</p>' : '') + kindNote() + '</div>';
  }
  function indexTab(g, res) {
    var ix = PF.index, x = indexEquivalent(g), eq = x.eq, payments = x.payments;
    if (!eq.ok) return '<div class="card">' + notice('bad', esc(eq.message)) + '</div>';
    /* a fund's NAV is named for what it is, never called the index */
    var fund = fundCmp(), short = A.shortName(ix.name, g.names.map(titleOf)), where = fund ? ix.name : 'the index';
    var html = '<div class="card"><h2>' + (ix.kind === 'PRICE' ? 'Against the price index: the' : 'The') + ' same rupees, on the same dates, in ' + esc(ix.name) + '</h2>' + (fund ? '<p class="hint tight">' + esc(FUND_NOTE) + '</p>' : '') +
      '<div class="stats">' + stat('Your XIRR', pct(res.rate, 2)) + stat(fund ? 'In ' + short : 'In the index', eq.rate == null ? 'no rate' : pct(eq.rate, 2)) +
      stat('Your gain', A.signedMoney(g.current + g.withdrawn - g.invested)) + stat(fund ? 'Gain in ' + short : 'Index gain', A.signedMoney(eq.gain)) + '</div>' +
      (eq.rate != null ? '<p class="cardtext"><strong>' + indexSentence(res, eq) + '</strong> ' + (fund ? 'Both figures share your dates, so your timing is the same on both sides and the gap is your funds against this one.' : 'Both figures share your dates, so this line removes the fund and leaves your timing in. The index carries no costs and cannot be bought as it stands; a fund that tracks it pays its own costs out of the gap.') + '</p>' : '') +
      kindNote() +
      (eq.skipped.length ? '<p class="hint">' + eq.skipped.length + ' payment' + (eq.skipped.length === 1 ? '' : 's') + ' fell outside ' + (fund ? 'that NAV file’s' : 'the index file’s') + ' dates and ' + (eq.skipped.length === 1 ? 'was' : 'were') + ' left out on both sides.</p>' : '') +
      '</div>';
    var marks = payments.map(function (f) { return { t: f.t, amount: f.amount, kind: f.kind }; });
    html += '<div class="card"><h2>' + (fund ? esc(ix.name) : 'The index') + ' over your dates</h2>' +
      C.growth(E.growthOf(ix.series, 10000, eq.used[0].t, eq.valuedOn), { name: ix.name, marks: marks, caption: 'What ₹10,000 in ' + where + ' became over your own stretch, with your money in and out marked.' }) + '</div>';
    html += fold('Every payment, put into ' + (fund ? esc(short) : 'the index'), '<p>' + (fund ? 'Each payment buys units at that fund’s NAV on the day, or the next NAV after it, as a purchase is allotted' : 'Each payment buys index units at the index’s value on that day (the last value on or before it)') + '; each withdrawal sells units. On ' + fmtDate(eq.valuedOn) + ' the units left, ' +
      esc(units3(eq.units)) + ', are worth ' + money(eq.endValue) + '.</p>' +
      '<div class="scroll"><table class="data"><thead><tr><th>Date</th><th>Money</th><th>' + (fund ? 'NAV used' : 'Index value used') + '</th><th>Units</th></tr></thead><tbody>' +
      eq.used.map(function (u) { return '<tr><td>' + fmtDate(u.t) + '</td><td>' + (u.kind === 'out' ? '−' : '') + money(u.amount) + '</td><td>' + u.price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (u.priceDate !== u.t ? ' <span class="qsub">(' + fmtDate(u.priceDate) + ')</span>' : '') + '</td><td>' + (u.kind === 'out' ? '−' : '') + units3(u.units) + '</td></tr>'; }).join('') +
      '</tbody></table></div>');
    return html;
  }

  /* --------------------------------------------- Against the fund (C2, C3, C8) */
  function againstFundTab(g, res, info) {
    var html = '';
    Object.keys(info).filter(function (k) { return info[k].over; }).forEach(function (k) {
      var x = info[k], nav = x.nav, own = x.rate, eq = x.eq, path = x.path;
      html += '<div class="card"><h2>' + esc(x.title) + '</h2>';
      if (x.over.ok && own.ok) {
        html += '<div class="stats">' + stat('The fund itself', pct(x.over.rate, 2)) + stat('Your money in it', pct(own.rate, 2)) + stat('From', fmtDate(x.over.from)) + stat('To', fmtDate(x.over.to)) + '</div>';
      } else html += notice('warn', esc((x.over.ok ? own : x.over).message || 'The file does not cover your dates.'));
      if (eq.ok && own.ok && eq.rate != null) {
        var d = Math.abs(eq.rate - own.rate);
        html += '<h3 class="subhead">Does your statement agree with the fund’s NAV file?</h3><p class="cardtext">Your payments, bought at each date’s NAV (or the next one) in this file, give ' + esc(pct(eq.rate)) + ' a year' + (x.valueFlow && !x.valueFlow.fromFile ? ', valuing the units on ' + fmtDate(eq.valuedOn) : '') + '; your own entries give ' + esc(pct(own.rate)) + '. ' +
          (d < 0.0025 ? 'They agree.' : 'They differ by ' + esc(pct(d)) + ' a year. A gap here usually means a payment or withdrawal is missing from the entries, a value was typed for a different day, or the file holds a different plan or option of the fund.') + '</p>';
      }
      if (path.ok && path.worst.rupees > 0) {
        html += '<h3 class="subhead">Your money’s deepest fall</h3><p class="cardtext">' + money(path.worst.rupees) + (path.worst.share != null ? ', ' + pct(path.worst.share) + ' of its value,' : '') + ' between ' + fmtDate(path.worst.from) + ' and ' + fmtDate(path.worst.to) + '. ' +
          (path.recoveredOn ? 'It took until ' + fmtDate(path.recoveredOn) + ', ' + A.monthsText(path.recoveryDays) + ', to stand where it had stood.' : 'It had not stood there again by the end of the file.') + '</p>';
      }
      var marks = x.payments.map(function (p) { return { t: p.t, amount: p.amount, kind: p.kind }; });
      var from = E.atOrBefore(nav.series, x.firstT, 7);
      html += C.growth(E.growthOf(nav.series, 10000, from ? from.t : x.firstT, x.valueDate), { name: x.title || nav.name, marks: marks, caption: 'What ₹10,000 in this fund became over your own stretch, with your money in and out marked.' });
      html += '</div>';
    });
    return html;
  }

  /* ------------------------------------------------------- All the numbers */
  function allNumbersTab(g, res, info) {
    var rows = g.flows.slice().sort(function (a, b) { return a.t - b.t; }).map(function (f) {
      return '<tr><td>' + fmtDate(f.t) + '</td><td>' + (f.kind === 'value' ? 'Worth' : f.kind === 'out' ? 'Money out' : 'Money in') + '</td><td class="num">' + money(Math.abs(f.amount)) + '</td><td>' + esc(f.label || '') + '</td></tr>';
    }).join('');
    var html = '<div class="card"><h2>Every entry the arithmetic used</h2><div class="scroll"><table class="data prose"><thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th>Fund</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="stats" style="margin-top:.8rem">' + stat('Entries', String(g.flows.length)) + stat('Days, first to last', String(res.days)) + stat('Rates that fit', String(res.roots.length)) + '</div>' +
      (res.roots.length > 1 ? '<p class="cardtext">The rates that balance these entries: ' + res.roots.map(function (r) { return pct(r); }).join(' and ') + '. The one shown is the one a spreadsheet’s XIRR returns from its 10% starting guess.</p>' : '') + '</div>';
    Object.keys(info).filter(function (k) { return info[k].span && info[k].span.ok; }).forEach(function (k) {
      var x = info[k], sp = x.span;
      html += '<div class="card"><h2>' + esc(x.title) + ': where your stretch sits</h2><div class="stats">' +
        stat('Stretches of ' + sp.years.toFixed(1) + ' years', sp.count.toLocaleString('en-IN')) + stat('Worst', pct(sp.min)) + stat('Median', pct(sp.median)) + stat('Best', pct(sp.max)) + '</div>' +
        '<p class="cardtext">The fund over your dates: ' + pct(x.over.rate) + ' a year. ' + percentileWords(sp) + ' Every stretch of the same ' + sp.spanDays.toLocaleString('en-IN') + ' days in the fund’s file, one starting on every date it has.</p></div>';
    });
    return html;
  }

  function holdingsAnswer() {
    var rows = PF.holdings, invested = 0, current = 0, haveIn = 0, haveNow = 0;
    rows.forEach(function (h) { if (h.invested != null) { invested += h.invested; haveIn++; } if (h.current != null) { current += h.current; haveNow++; } });
    var net = current - invested, abs = invested > 0 ? net / invested : null;
    var html = notice('', '<strong>No yearly rate from this file.</strong> ' + esc(U.MESSAGES.noDatesForRate));
    html += '<div class="result"><div class="label">' + (abs == null ? 'What it is worth today' : 'Your total return so far') + '</div><div class="value">' + (abs == null ? money(current) : esc(A.signedPct(abs))) + '</div>' +
      '<div class="sub">' + (abs == null ? rows.length + (rows.length === 1 ? ' holding' : ' holdings') : money(invested) + ' put in, worth ' + money(current) + ' now') + '. Before exit load and tax.</div></div>';
    html += '<div class="stats topline">' + stat('You put in', haveIn ? money(invested) : 'not in the file') + stat('Worth now', haveNow ? money(current) : 'not in the file') + stat('Gain or loss', haveIn && haveNow ? A.signedMoney(net) : 'not known') + stat('Holdings', String(rows.length)) + '</div>';
    var sorted = rows.slice().sort(function (a, b) { return (b.current || b.invested || 0) - (a.current || a.invested || 0); });
    html += '<div class="card"><h2>Each holding, and its share</h2><div class="fundcards">' +
      sorted.map(function (h) {
        var gn = (h.invested != null && h.current != null) ? h.current - h.invested : null, size = h.current != null ? h.current : h.invested;
        return '<div class="fundcard"><div class="fc-name">' + esc(h.name) + '</div><div class="fc-figs">' + fig('Put in', h.invested == null ? 'not in the file' : money(h.invested)) +
          fig('Worth now', h.current == null ? 'not in the file' : money(h.current)) + fig('Gain', gn == null || !(h.invested > 0) ? 'not known' : A.signedPct(gn / h.invested)) +
          fig('Share', current > 0 && size != null ? share(size / current) : 'not known') + '</div></div>';
      }).join('') + '</div>' +
      '<p class="hint">Share is each holding’s part of what the whole is worth now.</p></div>';
    return html + A.pdfFoot('portfolio', 'My holdings');
  }
  function partialAnswer(invested, withdrawn, current) {
    if (!invested && !withdrawn && !current) return '';
    var net = current + withdrawn - invested, abs = invested > 0 && current > 0 ? net / invested : null;
    return '<div class="card"><h2>What the figures so far do say</h2><div class="stats">' + stat('You put in', invested ? money(invested) : 'none') + stat('You took out', withdrawn ? money(withdrawn) : 'none') +
      stat('Worth now', current ? money(current) : 'not given') + stat('Gain or loss', abs == null ? 'not known' : A.signedMoney(net)) + '</div>' +
      (abs == null ? '<p class="hint">A gain needs both what went in and what it is worth today; one of the two is still missing.</p>' : '<p class="hint">That is ' + esc(A.signedPct(abs)) + ' in total. It has no clock in it: the yearly rate needs the dates.</p>') + '</div>';
  }

  /* ===================================================== SIP, example, save */
  function toggleSip(show) {
    var panel = $('#sip-builder');
    panel.hidden = !show;
    $('#pf-sip').setAttribute('aria-expanded', String(show));
    if (show) {
      if (!$('#sip-start').value) { $('#sip-start').value = A.isoOf(E.addYears(A.todayTs(), -1)); }
      $('#sip-start').max = A.isoToday(); $('#sip-msg').innerHTML = ''; $('#sip-start').focus();
    }
  }
  function addSipRows() {
    var msg = $('#sip-msg');
    var t0 = A.isoToTs($('#sip-start').value), amount = parseFloat($('#sip-amount').value), count = parseInt($('#sip-count').value, 10), name = $('#sip-name').value.trim();
    if (isNaN(t0)) { msg.innerHTML = notice('bad', 'Choose the date of the first instalment.'); return; }
    if (t0 > A.todayTs()) { msg.innerHTML = notice('bad', 'The first instalment cannot be in the future.'); return; }
    if (!isFinite(amount) || amount <= 0) { msg.innerHTML = notice('bad', 'Enter the monthly amount as a plain positive number.'); return; }
    if (!isFinite(count) || count < 1 || count > 600) { msg.innerHTML = notice('bad', 'Enter between 1 and 600 instalments.'); return; }
    var added = 0, skipped = 0;
    for (var i = 0; i < count; i++) {
      var t = E.addMonths(t0, i);
      if (t > A.todayTs()) { skipped++; continue; }
      addRow({ date: A.isoOf(t), kind: 'Money in', amount: amount, label: name });
      added++;
    }
    msg.innerHTML = notice('ok', 'Added ' + added + ' instalment' + (added === 1 ? '' : 's') + '.' + (skipped ? ' ' + skipped + ' would have fallen in the future and were left out.' : ''));
    toggleSip(false);
    afterTyped();
  }
  /* the example is written relative to today, so it never goes stale */
  function fillExample() {
    $('#pf-rows').innerHTML = '';
    var t = A.todayTs();
    addRow({ date: A.isoOf(E.addYears(t, -5)), kind: 'Money in', amount: 200000 });
    addRow({ date: A.isoOf(E.addYears(t, -4)), kind: 'Money in', amount: 150000 });
    addRow({ date: A.isoOf(E.addYears(t, -2)), kind: 'Money out', amount: 100000 });
    addRow({ date: A.isoToday(), kind: 'Worth today', amount: 420000 });
    afterTyped();
  }
  function blankRows() {
    $('#pf-rows').innerHTML = '';
    for (var k = 0; k < 3; k++) addRow({});
    addRow({ date: A.isoToday(), kind: 'Worth today' });
    afterTyped();
  }
  /* Saved in exactly the shape the statement door reads back without a question. */
  function exportRows() {
    var lines = ['Date,What happened,Amount,Fund'];
    readRows().forEach(function (r) {
      if (r.date || isFinite(r.amount)) lines.push([r.date, r.kind, isFinite(r.amount) ? r.amount : '', r.label].map(A.csvCell).join(','));
    });
    A.downloadText(lines.join('\r\n'), 'my-investments.csv', 'text/csv');
  }
  function importRows(file) {
    A.readStatement(file).then(function (got) {
      var r = U.portfolioFile(got.rows ? got.rows : got.text, {});
      if (!r.ok || r.kind !== 'ledger') { $('#pf-export-note').innerHTML = notice('bad', esc(r.message || 'That file is not a saved list of entries.')); return; }
      $('#pf-rows').innerHTML = '';
      r.rows.forEach(function (f) { addRow({ date: A.isoOf(f.t), kind: f.dir === 'out' ? 'Money out' : 'Money in', amount: f.amount, label: f.fund || '' }); });
      (r.valuations || []).forEach(function (v) { addRow({ date: A.isoOf(v.t), kind: 'Worth today', amount: v.amount, label: v.fund || '' }); });
      $('#pf-export-note').innerHTML = notice('ok', 'Loaded ' + (r.rows.length + (r.valuations || []).length) + ' entries from ' + esc(file.name) + '.');
      afterTyped();
    }).catch(function (err) { $('#pf-export-note').innerHTML = notice('bad', esc(err.message)); });
  }

  /* ================================================================== mode */
  function setMode(mode) {
    PF.mode = mode;
    $$('#pf-mode .chip').forEach(function (c) { c.setAttribute('aria-checked', String(c.dataset.mode === mode)); });
    $('#pf-mode-prompt').hidden = !!mode;
    $('#pf-filemode').hidden = mode !== 'file';
    $('#pf-typedmode').hidden = mode !== 'typed';
    $('#pf-out').innerHTML = ''; PF.ran = false;
    $('#pf-values').innerHTML = ''; PF.navDoors = {}; PF.nav = {}; PF.confirmed = {};
    if (mode === 'typed') {
      if (!$$('#pf-rows .entry').length) blankRows(); else afterTyped();
    } else if (mode === 'file') {
      PF.funds = [];
      if (PF.kind === 'ledger') drawRead({ kind: 'ledger', skipped: 0, dateCertain: true });
      drawFundCards();
    }
    refreshGate();
  }
  function say(id, text, html) { var e = $('#' + id); if (!e) return; if (html) e.innerHTML = html; else e.textContent = text; }
  function resetPortfolio() {
    PF.kind = null; PF.holdings = null; PF.imported = null; PF.valuations = []; PF.switches = 0; PF.source = ''; PF.answers = {}; PF.last = null;
    PF.funds = []; PF.nav = {}; PF.navDoors = {}; PF.confirmed = {}; PF.ran = false;
    $('#pf-read').hidden = true; $('#pf-values').innerHTML = '';
    $('#pf-out').innerHTML = ''; $('#pf-door-out').innerHTML = ''; $('#pf-paste-text').value = ''; $('#pf-paste-box').hidden = true;
    PF.file = null; PF.accepted = false; card(null); dupLine(false);
    if (PF.indexDoor) PF.indexDoor.clear();
    PF.index = null; drawIndexKind();
    if (PF.mode === 'typed') blankRows();
    setMode(PF.mode);
  }

  function init() {
    mountDoors();
    $$('#pf-mode .chip').forEach(function (c) { c.addEventListener('click', function () { setMode(c.dataset.mode); }); });
    $('#pf-add').addEventListener('click', function () { addRow({}); });
    $('#pf-sip').addEventListener('click', function () { toggleSip($('#sip-builder').hidden); });
    $('#sip-add').addEventListener('click', addSipRows);
    $('#sip-cancel').addEventListener('click', function () { toggleSip(false); });
    $('#pf-demo').addEventListener('click', fillExample);
    $('#pf-clear').addEventListener('click', function () { blankRows(); $('#pf-out').innerHTML = ''; PF.ran = false; });
    $('#pf-export').addEventListener('click', exportRows);
    $('#pf-import-file').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importRows(f); });
    $('#pf-calc').addEventListener('click', calcPortfolio);
    $('#pf-values').addEventListener('click', onConfirm);
    $('#pf-reset').addEventListener('click', resetPortfolio);
    /* typed rows: step 2 and the button follow every edit */
    var rowsHost = $('#pf-rows');
    rowsHost.addEventListener('input', function (e) {
      if (PF.mode !== 'typed') return;
      if (PF.ran) PF.ran = false;
      if (e.target && e.target.classList && e.target.classList.contains('in-tag')) return;   /* a name is settled on change */
      afterTyped();
    });
    rowsHost.addEventListener('change', function () { if (PF.mode === 'typed') afterTyped(); });
    refreshGate();
  }

  root.PRCPortfolio = { init: init, state: PF, calc: calcPortfolio, schemeCheck: schemeCheck };
})(typeof globalThis !== 'undefined' ? globalThis : this);
