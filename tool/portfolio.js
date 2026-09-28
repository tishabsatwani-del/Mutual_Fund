/* Where You Stand — Check my portfolio.
 *
 * The reader's own money: from a statement file or typed rows, valued today,
 * optionally set against an index and against the fund's own record over the
 * same dates. The main result is short; everything else is a tab away.
 */
(function (root) {
  'use strict';
  var A = root.PRCApp, E = root.PRCEngine, U = root.SimUpload, D = root.PRCDoors, C = root.PRCCharts;
  var $ = A.$, $$ = A.$$, esc = A.esc, money = A.money, pct = A.pct, notice = A.notice, fmtDate = A.fmtDate;
  var stat = A.stat, term = A.term, fold = A.fold;

  var KINDS = ['Money in', 'Money out', 'Worth today'];
  var rowSeq = 0;

  var PF = {
    mode: null,            /* 'file' | 'typed' */
    kind: null,            /* 'holdings' | 'ledger' when a file was read */
    holdings: null, imported: null, valuations: [], switches: 0, source: '', answers: {},
    file: null, sheet: null, sheets: null, sheetName: null, last: null,
    schemes: null,         /* per-fund totals for a named ledger */
    navDoors: {},          /* fund name -> door handle */
    nav: {},               /* fund name -> { series, name, report } */
    index: null,           /* { series, name, report, kind } */
    indexDoor: null, statementDoor: null,
    ran: false
  };

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
        '<div class="c-tag"><label for="' + id + 't">Which fund or goal</label><input type="text" id="' + id + 't" class="in-tag" autocomplete="off" placeholder="Which fund?" value="' + esc(v.label || '') + '"></div>' +
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
    wrap.querySelector('.in-tag').addEventListener('change', afterTyped);
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
  /* the typed labels drive the per-fund NAV doors */
  function afterTyped() {
    if (PF.mode !== 'typed') return;
    var labels = [];
    readRows().forEach(function (r) { if (r.label && labels.indexOf(r.label) === -1) labels.push(r.label); });
    drawFundCards(labels, null);
  }

  /* ==================================================== the statement door */
  function mountDoors() {
    $('#pf-howto').innerHTML = D.guide('statement');
    var host = $('#pf-statement-door');
    host.innerHTML =
      '<div class="filebox" id="pf-drop" tabindex="0" role="button" aria-label="Choose your statement file"><button class="secondary" type="button" id="pf-pick">Choose a file</button><p>or drop it here · CSV or Excel</p></div>' +
      '<input type="file" id="pf-file" accept="' + A.FILE_ACCEPT + '">' +
      '<button class="secondary pastebtn" type="button" id="pf-paste-open">Paste the rows instead</button>' +
      '<div class="pastebox" id="pf-paste-box" hidden><label class="fieldlabel" for="pf-paste-text">Copy the rows out of your statement and paste them here</label>' +
      '<textarea id="pf-paste-text" rows="6" spellcheck="false"></textarea><div class="btnrow"><button class="primary" type="button" id="pf-paste-read">Read these</button></div></div>';
    var pick = $('#pf-pick'), input = $('#pf-file'), drop = $('#pf-drop');
    function openPicker() { input.click(); setTimeout(function () { A.pickBusy($('#pf-pick')); }, 0); }
    drop.addEventListener('click', function (e) { if (e.target === drop || e.target.closest('button') || e.target.tagName === 'P') openPicker(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
    var depth = 0;
    function allow(e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }
    drop.addEventListener('dragenter', function (e) { allow(e); depth++; drop.classList.add('over'); });
    drop.addEventListener('dragover', allow);
    drop.addEventListener('dragleave', function () { if (--depth <= 0) { depth = 0; drop.classList.remove('over'); } });
    drop.addEventListener('drop', function (e) { e.preventDefault(); depth = 0; drop.classList.remove('over'); var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []); if (files.length) takeFile(files[0]); });
    input.addEventListener('change', function (e) { A.pickDone(); var files = Array.prototype.slice.call(e.target.files || []); input.value = ''; if (files.length) takeFile(files[0]); });
    $('#pf-paste-open').addEventListener('click', function () { var box = $('#pf-paste-box'); box.hidden = !box.hidden; if (!box.hidden) $('#pf-paste-text').focus(); });
    $('#pf-paste-read').addEventListener('click', function () {
      var text = $('#pf-paste-text').value;
      if (!text.trim()) return;
      PF.answers = {}; PF.source = 'pasted rows'; PF.file = null; PF.sheets = null;
      readInto(text);
    });

    /* the optional index file, on both modes */
    $('#pf-index-howto').innerHTML = D.guide('index');
    PF.indexDoor = D.mount($('#pf-index-door'), {
      prefix: 'pfix', kind: 'index', label: 'The index’s total return (TRI) history file',
      hint: 'CSV, Excel or text · a date column and the index value on that date',
      gate: function (rows, name) { return schemaGate(rows, name); },
      onLoaded: function (res) {
        PF.index = res ? { series: res.series, name: res.name, report: res.report, kind: guessKind(res.name, res.rows), guess: res.kindGuess } : null;
        drawIndexKind();
        if (PF.ran) calcPortfolio();
      }
    });
  }
  function schemaGate(rows, name) {
    var v = A.P.checkSchema(rows);
    if (v.ok) return null;
    var found = (v.detected || []).filter(Boolean).slice(0, 8);
    return notice('bad', esc(v.message) + (found.length ? ' <br>The columns found: <strong>' + found.map(function (n) { return esc(String(n)); }).join('</strong>, <strong>') + '</strong>.' : ''));
  }
  var TRI_RE = /\b(tri|total\s*returns?\s*index|total\s*returns?)\b/i, PRICE_RE = /\b(pri|price\s*returns?\s*index|price\s*returns?|price\s*index)\b/i;
  function guessKind(name, rows) {
    var t = String(name || '').replace(/[_.\-]+/g, ' ');
    var text = t + ' ' + (rows || []).slice(0, 3).map(function (r) { return (r || []).join(' '); }).join(' ');
    if (PRICE_RE.test(text) && !TRI_RE.test(text)) return 'PRICE';
    if (TRI_RE.test(text)) return 'TRI';
    return null;
  }
  function drawIndexKind() {
    var host = $('#pf-index-kind');
    if (!host) { host = A.el('div', { id: 'pf-index-kind' }); $('#pf-index-door').appendChild(host); }
    if (!PF.index) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="field" style="margin-top:.8rem"><span class="fieldlabel">Does <strong>' + esc(PF.index.name) + '</strong> include dividends?</span>' +
      '<div class="chips" id="pf-kind-chips" role="radiogroup">' +
      ['TRI', 'PRICE'].map(function (k) { return '<button class="chip" type="button" role="radio" data-kind="' + k + '" aria-checked="' + (PF.index.kind === k) + '">' + (k === 'TRI' ? 'Total return index — dividends included' : 'Price index — dividends excluded') + '</button>'; }).join('') +
      '</div><p class="hint" id="pf-kind-why"></p></div>';
    $$('#pf-kind-chips .chip').forEach(function (b) {
      b.addEventListener('click', function () { PF.index.kind = b.dataset.kind; $$('#pf-kind-chips .chip').forEach(function (c) { c.setAttribute('aria-checked', String(c === b)); }); sayKind(); if (PF.ran) calcPortfolio(); });
    });
    sayKind();
  }
  function sayKind() {
    var why = $('#pf-kind-why'); if (!why || !PF.index) return;
    why.textContent = PF.index.kind === 'PRICE' ? 'A price index leaves dividends out while a fund’s NAV puts them back in, so this comparison flatters your fund by roughly the index’s dividend yield each year.'
      : PF.index.kind === 'TRI' ? 'Dividends are counted on both sides, so the comparison is like for like.'
      : 'Not established. Until you say, the comparison cannot tell whether a gap is real or only the dividends the index leaves out.';
  }

  function takeFile(file, sheet) {
    PF.answers = {}; PF.file = file; PF.source = file.name || 'that file'; PF.sheet = sheet == null ? null : sheet;
    say('pf-door-out', 'Reading ' + esc(PF.source) + '…');
    A.readStatement(file, PF.sheet).then(function (got) {
      PF.sheets = got.sheets || null; PF.sheetName = got.sheetName || null;
      readInto(got.rows ? got.rows : got.text);
      if (got.sheets && got.sheets.length > 1) offerSheets(got.sheets, got.sheetName);
    }).catch(function (err) { say('pf-door-out', '', notice('bad', esc(err.message))); });
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
  function readInto(source) {
    PF.last = source;
    var r = U.portfolioFile(source, PF.answers);
    if (r.ask === 'direction') return askDirection(r);
    if (!r.ok) {
      PF.kind = null; $('#pf-read').hidden = true; $('#pf-after').hidden = true; $('#pf-actions').hidden = true; $('#pf-out').innerHTML = '';
      say('pf-door-out', '', notice('bad', esc(r.message)));
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
    $('#pf-after').hidden = false; $('#pf-actions').hidden = false; $('#pf-calc').disabled = false;
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
        return readLine(i, esc(h.name), [['put in', h.invested == null ? '—' : money(h.invested)], ['worth now', h.current == null ? '—' : money(h.current)]]);
      }).join('');
    } else {
      head.textContent = 'What you paid in';
      var ins = 0, outs = 0, nIn = 0, nOut = 0, first = Infinity, last = -Infinity;
      PF.imported.forEach(function (f) { if (f.dir === 'out') { outs += f.amount; nOut++; } else { ins += f.amount; nIn++; } if (f.t < first) first = f.t; if (f.t > last) last = f.t; });
      var named = PF.imported.some(function (f) { return f.fund; });
      PF.schemes = named ? U.schemeTotals(PF.imported) : null;
      summary.innerHTML = '<p class="hint tight">' + PF.imported.length + (PF.imported.length === 1 ? ' payment' : ' payments') + ' read from ' + esc(PF.source) +
        (r.skipped ? ', ' + r.skipped + ' line' + (r.skipped === 1 ? '' : 's') + ' skipped' : '') + ', ' + fmtDate(first) + ' to ' + fmtDate(last) + '.' +
        (PF.switches ? ' ' + PF.switches + (PF.switches === 1 ? ' switch between funds was' : ' switches between funds were') + ' recognised and left out of the totals of money put in and taken out.' : '') +
        (!r.dateCertain && r.example ? ' These dates read two ways; ' + esc(r.example.raw) + ' has been read as ' + esc(r.example.dayFirst) + '. Check the lines below.' : '') + '</p>' +
        '<div class="stats">' + stat('Money in', money(ins) + (nIn ? ' · ' + nIn : '')) + stat('Money out', nOut ? money(outs) + ' · ' + nOut : '—') +
        (PF.schemes ? stat('Funds named', String(PF.schemes.length)) : '') + '</div>' +
        (PF.schemes ? '<div class="scroll"><table class="data"><thead><tr><th>Fund</th><th>Put in</th><th>Taken out</th><th>Units left</th></tr></thead><tbody>' +
          PF.schemes.map(function (g) { return '<tr><td>' + esc(g.name) + '</td><td>' + money(g.paidIn) + '</td><td>' + (g.tookOut ? money(g.tookOut) : '—') + '</td><td>' + (g.hasUnits ? units3(g.units) : 'not in this file') + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : '');
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
    /* what still has to be supplied, and the optional files */
    var namedLedger = r.kind === 'ledger' && !!PF.schemes;
    $('#pf-worth-card').hidden = r.kind !== 'ledger' || namedLedger;
    $('#pf-values-card').hidden = !namedLedger;
    $('#pf-index-card').hidden = r.kind === 'holdings';
    if (r.kind === 'ledger' && !namedLedger) {
      var v = PF.valuations.filter(function (x) { return !x.fund; });
      if (v.length) $('#pf-worth').value = v[v.length - 1].amount;
    }
    if (namedLedger) drawFundCards(PF.schemes.map(function (g) { return g.name; }), PF.schemes);
  }
  function readLine(i, title, pairs) {
    return '<li class="readline"><div class="rl-head"><span class="rl-title">' + title + '</span><button class="link" type="button" data-drop="' + i + '">drop</button></div>' +
      '<div class="rl-figs">' + pairs.map(function (p) { return '<span class="rl-fig"><span class="qsub">' + esc(p[0]) + '</span> <b>' + p[1] + '</b></span>'; }).join('') + '</div></li>';
  }
  function units3(n) { return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }

  /* ------------------------------------ one card per fund: value it, or load its NAV file */
  function drawFundCards(names, schemes) {
    var host = $('#pf-values'), card = $('#pf-values-card');
    if (!names.length) { card.hidden = true; host.innerHTML = ''; return; }
    card.hidden = false;
    var seen = {};
    names.forEach(function (name, i) {
      seen[name] = true;
      var g = schemes ? schemes.filter(function (x) { return x.name === name; })[0] : null;
      var id = 'pfv-' + i;
      var row = host.querySelector('[data-scheme="' + CSS.escape(name) + '"]');
      if (row) return;
      row = A.el('div', { class: 'valrow', 'data-scheme': name });
      var known = g && g.hasUnits && g.units > 0;
      var closed = g && g.closed;
      row.innerHTML = '<div class="val-name">' + esc(name) + '<span class="qsub">' +
        (closed ? 'units net to zero: you are out of it, so its ending is already in the statement'
          : g ? (known ? units3(g.units) + ' units left · ' + money(g.paidIn - g.tookOut) + ' net in' : money(g.paidIn - g.tookOut) + ' net in · no units in this file') : '') + '</span></div>' +
        (closed ? '' :
          '<div class="val-fields">' +
            (known ? '<label class="field"><span class="label">NAV today</span><input type="number" class="val-nav" id="' + id + '-nav" inputmode="decimal" min="0" step="any" placeholder="per unit"></label>' : '') +
            '<label class="field"><span class="label">Value today (₹)</span><input type="number" class="val-amt" id="' + id + '-amt" inputmode="decimal" min="0" step="any"></label>' +
          '</div>' +
          '<details class="explain inner val-door"><summary>Or load this fund’s NAV history file</summary><div class="body"><p class="hint tight">The value is filled from it' +
            (known ? ' (units left × the latest NAV in the file)' : ' when the file also lets units be worked out') + ', and the fund’s own record over your dates opens up in the result.</p>' +
            '<div id="' + id + '-door"></div></div></details>');
      host.appendChild(row);
      var nav = row.querySelector('.val-nav'), amt = row.querySelector('.val-amt');
      if (nav) nav.addEventListener('input', function () { var n = parseFloat(nav.value); amt.value = (isFinite(n) && n >= 0 && g) ? (n * g.units).toFixed(2) : ''; row.dataset.valueFrom = 'nav'; valuesChanged(); });
      if (amt) amt.addEventListener('input', function () { if (nav && document.activeElement === amt) nav.value = ''; row.dataset.valueFrom = 'typed'; valuesChanged(); });
      /* a statement that carried its own valuation row for this fund */
      var vrow = PF.valuations.filter(function (x) { return x.fund === name; });
      if (vrow.length && amt) { amt.value = vrow[vrow.length - 1].amount; row.dataset.valueFrom = 'file'; row.dataset.valueDate = vrow[vrow.length - 1].t; }
      if (!closed) {
        PF.navDoors[name] = D.mount(row.querySelector('#' + id + '-door'), {
          prefix: 'pfnav' + i, kind: 'nav', label: 'NAV history of ' + name, hint: 'CSV, Excel or text · a date column and a NAV column',
          gate: function (rows, fname) { return schemaGate(rows, fname); },
          onLoaded: function (res) {
            if (!res) { delete PF.nav[name]; valuesChanged(); return; }
            PF.nav[name] = { series: res.series, name: res.name, report: res.report };
            var last = res.series[res.series.length - 1];
            var unitsNow = unitsFor(name, res.series);
            if (unitsNow != null && amt) { amt.value = (unitsNow * last.v).toFixed(2); if (nav) nav.value = last.v; row.dataset.valueFrom = 'navfile'; row.dataset.valueDate = last.t; }
            valuesChanged();
          }
        });
      }
    });
    $$('.valrow', host).forEach(function (row) { if (!seen[row.dataset.scheme]) { delete PF.navDoors[row.dataset.scheme]; delete PF.nav[row.dataset.scheme]; row.remove(); } });
    valuesChanged();
  }
  /* units held now: from the statement where it carries them, else from
     each payment divided by the NAV on its date */
  function unitsFor(name, series) {
    var g = PF.schemes ? PF.schemes.filter(function (x) { return x.name === name; })[0] : null;
    if (g && g.hasUnits) return g.units;
    var flows = flowsFor(name);
    if (!flows.length) return null;
    var units = 0;
    for (var i = 0; i < flows.length; i++) {
      var obs = E.atOrBefore(series, flows[i].t, 7);
      if (!obs) return null;
      units += (flows[i].kind === 'out' ? -1 : 1) * flows[i].amount / obs.v;
    }
    return units;
  }
  function flowsFor(name) {
    if (PF.mode === 'typed') {
      return readRows().filter(function (r) { return r.label === name && r.kind !== 'Worth today' && isFinite(r.amount) && r.amount > 0 && isFinite(A.isoToTs(r.date)); })
        .map(function (r) { return { t: A.isoToTs(r.date), amount: r.amount, kind: r.kind === 'Money out' ? 'out' : 'in' }; });
    }
    return (PF.imported || []).filter(function (f) { return f.fund === name; }).map(function (f) { return { t: f.t, amount: f.amount, kind: f.dir, units: f.units }; });
  }
  function valuesChanged() {
    var rows = $$('#pf-values .valrow'), open = rows.length, given = 0;
    rows.forEach(function (row) { var a = row.querySelector('.val-amt'); if (a && parseFloat(a.value) > 0) given++; });
    var note = $('#pf-values-note');
    if (note) note.textContent = open ? (given === open ? 'Every fund is valued.' : given + ' of ' + open + ' valued. The result waits for all of them, so no wrong headline is printed.') : '';
    if (PF.ran) calcPortfolio();
  }
  function readValues() {
    var out = {};
    $$('#pf-values .valrow').forEach(function (row) {
      var a = row.querySelector('.val-amt');
      var v = a ? parseFloat(a.value) : NaN;
      if (isFinite(v) && v > 0) out[row.dataset.scheme] = { amount: v, t: row.dataset.valueDate ? +row.dataset.valueDate : A.todayTs(), from: row.dataset.valueFrom || 'typed' };
    });
    return out;
  }

  /* ================================================================= flows */
  /* Everything the arithmetic needs, from either mode, or the reason it cannot run yet. */
  function gather() {
    var flows = [], lots = {}, problems = [], missing = [], names = [];
    var invested = 0, withdrawn = 0, current = 0, switched = 0;
    function lot(name, l) { (lots[name] = lots[name] || []).push(l); if (name && names.indexOf(name) === -1) names.push(name); }
    if (PF.mode === 'typed') {
      var rows = readRows(), anyValue = false;
      rows.forEach(function (r, i) {
        var blank = !r.date && !isFinite(r.amount);
        if (blank) return;
        var t = A.isoToTs(r.date);
        if (isNaN(t)) { problems.push('Row ' + (i + 1) + ' has no date.'); return; }
        if (t > A.todayTs()) { problems.push('Row ' + (i + 1) + ' is dated ' + fmtDate(t) + ', which is in the future. This measures money that has already moved.'); return; }
        if (!isFinite(r.amount) || r.amount <= 0) { problems.push('Row ' + (i + 1) + ' needs an amount greater than zero, typed as a plain positive number.'); return; }
        if (r.kind === 'Money in') { invested += r.amount; flows.push({ t: t, amount: -r.amount, kind: 'in', label: r.label }); lot(r.label, { t: t, amount: r.amount, dir: 'in' }); }
        else if (r.kind === 'Money out') { withdrawn += r.amount; flows.push({ t: t, amount: r.amount, kind: 'out', label: r.label }); lot(r.label, { t: t, amount: r.amount, dir: 'out' }); }
        else { current += r.amount; anyValue = true; flows.push({ t: t, amount: r.amount, kind: 'value', label: r.label }); if (r.label && names.indexOf(r.label) === -1) names.push(r.label); }
      });
      /* a NAV file loaded for a typed label supplies the value where no row does */
      names.forEach(function (name) {
        var hasValue = flows.some(function (f) { return f.kind === 'value' && f.label === name; });
        if (hasValue || !PF.nav[name]) return;
        var s = PF.nav[name].series, u = unitsFor(name, s);
        if (u == null) return;
        var last = s[s.length - 1];
        current += u * last.v; flows.push({ t: last.t, amount: u * last.v, kind: 'value', label: name, fromFile: true });
      });
    } else if (PF.kind === 'ledger') {
      PF.imported.forEach(function (f) {
        if (f.dir === 'out') withdrawn += f.switch ? 0 : f.amount; else invested += f.switch ? 0 : f.amount;
        if (f.switch) switched += f.amount;
        flows.push({ t: f.t, amount: f.dir === 'out' ? f.amount : -f.amount, kind: f.dir, label: f.fund || '', units: f.units });
        lot(f.fund || '', { t: f.t, amount: f.amount, dir: f.dir, units: f.units });
      });
      if (PF.schemes) {
        var given = readValues();
        PF.schemes.forEach(function (g) {
          if (g.closed) return;
          var v = given[g.name];
          if (!v) { missing.push(g.name); return; }
          current += v.amount; flows.push({ t: v.t, amount: v.amount, kind: 'value', label: g.name, fromFile: v.from === 'navfile' });
        });
        names = PF.schemes.map(function (g) { return g.name; });
      } else {
        var worth = parseFloat($('#pf-worth').value);
        var vrow = PF.valuations.filter(function (x) { return !x.fund; });
        var vt = vrow.length && vrow[vrow.length - 1].amount === worth ? vrow[vrow.length - 1].t : A.todayTs();
        if (isFinite(worth) && worth > 0) { current = worth; flows.push({ t: vt, amount: worth, kind: 'value', label: '' }); }
      }
    }
    return { flows: flows, lots: lots, names: names, problems: problems, missing: missing, invested: invested, withdrawn: withdrawn, current: current, switched: switched };
  }

  /* ================================================================ results */
  function calcPortfolio() {
    var out = $('#pf-out');
    if (PF.mode === 'file' && PF.kind === 'holdings') { PF.ran = true; out.innerHTML = holdingsAnswer(); return; }
    var g = gather();
    if (g.problems.length) { out.innerHTML = notice('bad', g.problems.slice(0, 4).map(esc).join('<br>')); return; }
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
        ? (PF.mode === 'file' ? ' Type what the holding is worth today in the box above, or load the fund’s NAV file.' : ' Add a last row with today’s date, <strong>Worth today</strong>, and what the holding is worth now.')
        : '';
      out.innerHTML = notice('bad', esc(res.message) + extra) + partialAnswer(g.invested, g.withdrawn, g.current);
      return;
    }
    PF.ran = true;
    var name = g.names.length === 1 ? g.names[0] : 'your portfolio';
    var main = mainTab(g, res);
    var idx = PF.index ? indexTab(g, res) : null;
    var withNav = Object.keys(PF.nav).filter(function (n) { return g.names.indexOf(n) !== -1 || (PF.mode === 'typed' && n === ''); });
    var fundTab = withNav.length ? youAndFundTab(g, res, withNav) : null;
    out.innerHTML = A.tabs('pf-tabs', [
      { key: 'main', label: 'Your return', html: main },
      { key: 'index', label: 'Against the index', html: idx },
      { key: 'fund', label: 'You and the fund', html: fundTab },
      { key: 'all', label: 'All the numbers', html: allNumbersTab(g, res) }
    ]) + A.pdfFoot('portfolio', name);
    wireRealReturn(res.rate);
  }

  function mainTab(g, res) {
    var rate = res.rate;
    var net = g.current + g.withdrawn - g.invested;
    var abs = g.invested > 0 ? net / g.invested : 0;
    var first = g.flows.reduce(function (m, f) { return Math.min(m, f.t); }, Infinity);
    var last = g.flows.reduce(function (m, f) { return Math.max(m, f.t); }, -Infinity);
    var years = (last - first) / (365.2425 * 86400000);
    var dbl = E.doublingTime(rate);
    var html = '';
    if (res.underAYear) {
      html += '<div class="result"><div class="label">' + term('absolute', 'Your total gain so far') + '</div><div class="value">' + esc(A.signedPct(abs)) + '</div>' +
        '<div class="sub">' + money(g.invested) + ' put in, worth ' + money(g.current + g.withdrawn) + ' after ' + res.days + ' days, ' + fmtDate(first) + ' to ' + fmtDate(last) + '</div></div>' +
        '<p class="cardtext">Under a year, the yearly rate is the one to ignore: it stretches ' + res.days + ' days to a twelve-month pace and reads ' +
        esc(pct(rate)) + ' a year, which is not something that has happened to anyone. Read the total. The yearly rate starts meaning something after a year.</p>';
    } else {
      html += '<div class="result"><div class="label">' + term('xirr', 'Your XIRR') + '</div><div class="value">' + esc(pct(rate)) + '</div>' +
        '<div class="sub">a year, across ' + years.toFixed(1) + ' years, ' + fmtDate(first) + ' to ' + fmtDate(last) + '</div></div>' +
        '<p class="cardtext"><strong>Your money grew at about ' + esc(pct(rate)) + ' a year</strong>, counting the date every rupee went in and came out.' +
        (dbl ? ' At that pace money doubles about every ' + dbl.toFixed(1) + ' years.' : '') + '</p>';
    }
    if (res.alternatives && res.alternatives.length) {
      html += notice('warn', '<strong>A second rate also fits these entries: ' + esc(pct(res.alternatives[0])) + '.</strong> When money goes out and comes back in more than once, the arithmetic can have two answers. The one above is the one a spreadsheet gives; read both with care, and rely on the total gain.');
    }
    html += '<div class="stats topline">' + stat('Total return', A.signedPct(abs), 'absolute') + stat('You put in', money(g.invested)) +
      (g.withdrawn ? stat('You took out', money(g.withdrawn)) : '') + stat('Worth now', money(g.current)) + stat('Gain or loss', A.signedMoney(net)) + '</div>' +
      (g.switched ? '<p class="hint">' + money(g.switched) + ' moved between your own funds by switch and is left out of the two totals; it was never new money.</p>' : '');
    html += twoNumbersCard(abs, rate, years, res.underAYear);
    html += realReturnCard(rate);
    if (g.names.length > 1) html += byFund(g, rate);
    html += fold('What this figure is not', '<ul class="points">' +
      '<li><strong>Not the fund’s published return.</strong> A fund can print a strong number while yours is weaker, purely because of when you happened to invest. Its figure describes the fund; this one describes you.' + (Object.keys(PF.nav).length ? ' The <em>You and the fund</em> tab puts the two side by side over your own dates.' : '') + '</li>' +
      '<li><strong>Not comparable to another investor’s.</strong> Each ran on a different set of dates.</li>' +
      '<li><strong>Before exit load and before tax.</strong> Plan on less once tax is paid, and less again if you sell early.</li></ul>');
    html += '<div class="meaning"><h3>What to look at next</h3><p>' +
      (PF.index ? 'The <em>Against the index</em> tab shows the same rupees on the same dates in the index.' : 'Load the benchmark index’s TRI file above and the same rupees, same dates, are put into it beside this figure.') +
      ' <button class="link" type="button" data-go="rolling">Rolling returns</button> shows the range a fund or market delivered over holding periods this long.</p></div>';
    return html;
  }

  function twoNumbersCard(abs, rate, years, underAYear) {
    var sentence = underAYear ? 'Under a year, the total is the figure to read; the yearly rate stretches a short stretch to a twelve-month pace.'
      : abs > rate ? 'The total is bigger than the yearly rate because it has ' + years.toFixed(1) + ' years inside it; the rate has one.'
      : 'The yearly rate is bigger than the total because most of this money has been invested for less than a year so far; the rate is still a per-year figure.';
    return '<div class="card"><h2>Two numbers, two questions</h2>' +
      '<div class="scroll"><table class="data"><tbody>' +
      '<tr><td>' + term('absolute', 'Total return') + '<br><span class="qsub">Worth today, plus what you took out, minus what you put in, as a share of what you put in.</span></td><td>' + esc(A.signedPct(abs)) + '<br><span class="qsub">in total · no clock in it</span></td></tr>' +
      '<tr><td>' + term('xirr', 'XIRR') + '<br><span class="qsub">At what yearly speed did my own money travel?</span></td><td>' + esc(pct(rate)) + '<br><span class="qsub">a year · counts every date</span></td></tr>' +
      '</tbody></table></div><p class="cardtext">' + sentence + '</p>' +
      fold('And the third number, ' + term('cagr', 'CAGR') + ', which is not yours',
        '<p>CAGR is the number a fund publishes: if a single rupee had gone in on the first day of the period shown and never been touched, at what steady yearly speed did it grow? If you invested monthly, that is not your return. Use it to compare one fund with another over the same period; use the XIRR above for what your own money did.</p>' +
        (Object.keys(PF.nav).length ? '<p>With the fund’s NAV file loaded, its own CAGR over exactly your dates is on the <em>You and the fund</em> tab.</p>' : '')) +
      '</div>';
  }

  function realReturnCard(rate) {
    return '<div class="card" id="pf-real"><h2>' + term('real', 'After inflation, what is left?') + '</h2>' +
      '<p class="hint tight">Your return is printed on the statement; what it buys is decided by prices. Type the inflation you want to measure against. This tool does not choose a figure for you.</p>' +
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
      var words = real < 0 ? 'What this money buys fell over this period, even though the statement shows a gain.'
        : real < 0.03 ? 'What this money buys held roughly steady. Keeping pace with prices is itself a result, but little has been added to what the money can do.'
        : 'What this money buys grew. The figure on the right is the part that bought something; the rest went on holding the price of things steady.';
      out.innerHTML = '<div class="stats" style="margin:.2rem 0 0">' + stat('Your return', pct(rate)) + stat('Inflation', i.toFixed(1) + '%') + stat('What is left', pct(real), 'real') + '</div>' +
        '<p class="cardtext">' + words + '</p>' +
        fold('Why this is not ' + esc(pct(rate)) + ' minus ' + i.toFixed(1) + '%',
          '<div class="scroll"><table class="data"><tbody><tr><td><strong>Exact</strong><br><span class="qsub">what this tool uses</span></td><td class="mono">(1 + ' + rate.toFixed(4) + ') ÷ (1 + ' + (i / 100).toFixed(4) + ') − 1</td><td><strong>' + esc(pct(real)) + '</strong></td></tr>' +
          '<tr><td>Quick<br><span class="qsub">the subtraction in your head</span></td><td class="mono">' + esc(pct(rate)) + ' − ' + i.toFixed(1) + '%</td><td>' + esc(pct(rate - i / 100)) + '</td></tr></tbody></table></div>' +
          '<p>Inflation does not subtract from a return; it divides into it, because the price of things compounds against every rupee over the same years your money is compounding. The official basket is not your basket: if your life is heavy with fees or bills that outrun the headline figure, your real subtraction is bigger.</p>');
    });
  }

  function byFund(g, portfolioRate) {
    var rows = g.names.map(function (name) {
      var flows = g.flows.filter(function (f) { return f.label === name; });
      var r = E.xirr(flows);
      var put = 0, took = 0, worth = 0;
      flows.forEach(function (f) { if (f.kind === 'in') put += -f.amount; else if (f.kind === 'out') took += f.amount; else worth += f.amount; });
      var gain = worth + took - put;
      return '<tr><td>' + esc(name) + '</td><td>' + money(put) + '</td><td>' + (worth ? money(worth) : '—') + '</td><td>' + A.signedMoney(gain) + '</td><td>' +
        (r.ok ? pct(r.rate) : '<span class="qsub">' + esc(holdingWhy(r, flows)) + '</span>') + '</td></tr>';
    }).join('');
    var total = g.invested;
    rows += '<tr class="total"><td><strong>Your whole portfolio</strong></td><td><strong>' + money(total) + '</strong></td><td><strong>' + money(g.current) + '</strong></td><td><strong>' + A.signedMoney(g.current + g.withdrawn - g.invested) + '</strong></td><td><strong>' + pct(portfolioRate) + '</strong></td></tr>';
    return '<div class="card"><h2>Each fund, and the whole</h2><div class="scroll"><table class="data"><thead><tr><th>Fund</th><th>Put in</th><th>Worth now</th><th>Gain</th><th>Its own XIRR</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="cardtext">Your portfolio rate weighs each fund by how much money you had in it, and for how long. A brilliant return on a small, late investment moves the total far less than a middling one on a large, early holding.</p></div>';
  }
  function holdingWhy(res, rows) {
    var says = { TOO_FEW: 'needs 2 dated rows; this fund has ' + rows.length, NO_INVESTMENT: 'no money going in, only a valuation',
      NO_VALUE: 'no valuation and no withdrawal, so there is nothing to measure against', SAME_DAY: 'every row is on one date', UNSOLVABLE: 'no single rate fits this pattern' };
    return says[res.code] || res.message || 'not enough entries';
  }

  /* ---------------------------------------------- Against the index (C1) */
  function indexTab(g, res) {
    var ix = PF.index;
    var payments = g.flows.filter(function (f) { return f.kind !== 'value'; }).map(function (f) { return { t: f.t, amount: Math.abs(f.amount), kind: f.kind }; });
    var valueDate = g.flows.filter(function (f) { return f.kind === 'value'; }).reduce(function (m, f) { return Math.max(m, f.t); }, -Infinity);
    if (!isFinite(valueDate)) valueDate = ix.series[ix.series.length - 1].t;
    var eq = E.benchmarkEquivalent(payments, ix.series, { valueDate: valueDate });
    if (!eq.ok) return '<div class="card">' + notice('bad', esc(eq.message)) + '</div>';
    var html = '';
    var diff = eq.rate != null ? res.rate - eq.rate : null;
    html += '<div class="card"><h2>' + term('sameRupees', 'The same rupees, on the same dates, in ' + ix.name) + '</h2>' +
      '<div class="stats">' + stat('Your XIRR', pct(res.rate, 2), 'xirr') + stat('In the index', eq.rate == null ? '—' : pct(eq.rate, 2)) +
      stat('Your gain', A.signedMoney(g.current + g.withdrawn - g.invested)) + stat('Index gain', A.signedMoney(eq.gain)) + '</div>' +
      (diff != null ? '<p class="cardtext"><strong>' + (Math.abs(diff) < 0.00005 ? 'Your money ran level with the same rupees in the index: the gap is under a hundredth of a percent a year.'
        : 'Your money ran ' + esc(pct(Math.abs(diff), 2)) + ' a year ' + (diff > 0 ? 'ahead of' : 'behind') + ' the same rupees in the index.') +
        '</strong> Both figures share your dates, so this line removes the fund and leaves your timing in; the difference is what your fund did with your money, not when you gave it. The index carries no costs and cannot be bought as it stands; a fund that tracks it pays its own costs out of the gap.</p>' : '') +
      (ix.kind === 'PRICE' ? notice('warn', 'This index leaves dividends out while a fund’s NAV includes them, so the comparison flatters your side by roughly the index’s dividend yield each year.') :
        ix.kind !== 'TRI' ? notice('warn', 'Whether this index counts dividends has not been established. Say which it is under the index file above; if it is a price index, the comparison flatters your side by roughly its dividend yield.') : '') +
      (eq.skipped.length ? '<p class="hint">' + eq.skipped.length + ' payment' + (eq.skipped.length === 1 ? '' : 's') + ' fell outside the index file’s dates and ' + (eq.skipped.length === 1 ? 'was' : 'were') + ' left out on both sides.</p>' : '') +
      '</div>';
    var marks = payments.map(function (f) { return { t: f.t, amount: f.amount, kind: f.kind }; });
    html += '<div class="card"><h2>' + term('growth', 'The index over your dates') + '</h2>' +
      C.growth(E.growthOf(ix.series, 10000, eq.used[0].t, eq.valuedOn), { name: ix.name, marks: marks, caption: 'What ₹10,000 in the index became over your own stretch, with your money in and out marked.' }) +
      '<p class="cardtext">The marks are your own dates. Money that went in near a high bought fewer units; money that went in near a low bought more. That is the whole of the timing effect.</p></div>';
    html += fold('How this is worked out', '<p>Every payment buys index units at the index’s value on that day (the last value on or before it). Every withdrawal sells units at that day’s value. On ' + fmtDate(eq.valuedOn) + ' the units left are valued at the index’s value, ' +
      esc(units3(eq.units)) + ' units worth ' + money(eq.endValue) + '. The same XIRR arithmetic then runs on those flows.</p>' +
      '<div class="scroll"><table class="data"><thead><tr><th>Date</th><th>Money</th><th>Index value used</th><th>Units</th></tr></thead><tbody>' +
      eq.used.map(function (u) { return '<tr><td>' + fmtDate(u.t) + '</td><td>' + (u.kind === 'out' ? '−' : '') + money(u.amount) + '</td><td>' + u.price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (u.priceDate !== u.t ? ' <span class="qsub">(' + fmtDate(u.priceDate) + ')</span>' : '') + '</td><td>' + (u.kind === 'out' ? '−' : '') + units3(u.units) + '</td></tr>'; }).join('') +
      '</tbody></table></div>');
    return html;
  }

  /* --------------------------------------- You and the fund (C2, C3, C8) */
  function youAndFundTab(g, res, names) {
    var html = '';
    names.forEach(function (name) {
      var nav = PF.nav[name];
      var flows = g.flows.filter(function (f) { return (f.label || '') === name; });
      var payments = flows.filter(function (f) { return f.kind !== 'value'; }).map(function (f) { return { t: f.t, amount: Math.abs(f.amount), kind: f.kind, units: f.units }; });
      var valueFlow = flows.filter(function (f) { return f.kind === 'value'; })[0];
      if (!payments.length) return;
      var own = E.xirr(flows);
      var valueDate = valueFlow ? valueFlow.t : nav.series[nav.series.length - 1].t;
      var firstT = payments.reduce(function (m, f) { return Math.min(m, f.t); }, Infinity);
      var over = E.fundOverDates(firstT, valueDate, nav.series, own.ok ? own.rate : NaN);
      var eq = E.benchmarkEquivalent(payments, nav.series, { valueDate: valueDate });
      var lots = payments.map(function (p) { return { t: p.t, amount: p.amount, dir: p.kind, units: p.units }; });
      var path = E.holdingPath(lots, nav.series, { valueDate: valueDate });
      html += '<div class="card"><h2>' + esc(name === '' ? nav.name : name) + ': ' + term('timing', 'the fund over your dates') + '</h2>';
      if (over.ok && own.ok) {
        var gap = over.rate - own.rate;
        html += '<div class="stats">' + stat('The fund itself', pct(over.rate, 2), 'cagr') + stat('Your money in it', pct(own.rate, 2), 'xirr') + stat('The difference', A.signedPct(-gap, 2), 'timing') + '</div>' +
          '<p class="cardtext">Between ' + fmtDate(over.from) + ' and ' + fmtDate(over.to) + ' the fund’s NAV grew at <strong>' + esc(pct(over.rate, 2)) + ' a year</strong>: the figure it would publish for exactly your dates, as if one lump sum had gone in on day one. Your rupees earned <strong>' + esc(pct(own.rate, 2)) + '</strong>. ' +
          (Math.abs(gap) < 0.00005 ? 'The two are the same to the hundredth of a percent: your timing neither cost nor added anything.'
            : gap > 0 ? 'The ' + esc(pct(gap, 2)) + ' a year between them is the effect of when your money went in and out: more of it was in the fund during its weaker stretches than during its stronger ones.'
            : 'Your money earned ' + esc(pct(-gap, 2)) + ' a year more than a day-one lump sum would have: more of it was in the fund during its stronger stretches.') +
          ' This is a description of your dates, not a verdict on you or the fund.</p>';
      } else html += notice('warn', esc((over.ok ? own : over).message || 'The file does not cover your dates.'));
      if (eq.ok && own.ok && eq.rate != null) {
        var d = Math.abs(eq.rate - own.rate);
        html += fold('Does your statement agree with the fund’s NAV file?',
          '<p>Putting your payments into this NAV file at each day’s NAV gives ' + esc(pct(eq.rate)) + ' a year' + (valueFlow && !valueFlow.fromFile ? ', valuing the units on ' + fmtDate(eq.valuedOn) : '') + '; your own entries give ' + esc(pct(own.rate)) + '. ' +
          (d < 0.0025 ? 'They agree, so the statement is complete and the value you gave matches the NAV.' : 'They differ by ' + esc(pct(d)) + ' a year. A gap here usually means a payment or withdrawal is missing from the entries, a value was typed for a different day, or the file holds a different plan or option of the fund.') + '</p>');
      }
      if (path.ok && path.worst.rupees > 0) {
        html += '<h3 class="subhead">' + term('ownFall', 'Your own money’s worst fall') + '</h3>' +
          '<div class="stats">' + stat('It fell by', money(path.worst.rupees)) + stat('That was', path.worst.share != null ? pct(path.worst.share) + ' of its value' : '—') +
          stat('From', fmtDate(path.worst.from)) + stat('Back to that level', path.recoveredOn ? fmtDate(path.recoveredOn) : 'not yet, by ' + fmtDate(path.path[path.path.length - 1].t)) + '</div>' +
          '<p class="cardtext">Between ' + fmtDate(path.worst.from) + ' and ' + fmtDate(path.worst.to) + ' your holding lost ' + money(path.worst.rupees) + ' of what it had gained, from price moves alone; your own payments and withdrawals are taken out of the reckoning. ' +
          (path.recoveredOn ? 'It took until ' + fmtDate(path.recoveredOn) + ', ' + A.monthsText(path.recoveryDays) + ', to stand where it had stood.' : 'It had not stood there again by the end of the file.') +
          ' Whoever sells at the bottom of such a stretch turns it into a permanent result; this is the part of the record that decided whether the rate above was earned.</p>';
      }
      var marks = payments.map(function (p) { return { t: p.t, amount: p.amount, kind: p.kind }; });
      var from = E.atOrBefore(nav.series, firstT, 7);
      html += C.growth(E.growthOf(nav.series, 10000, from ? from.t : firstT, valueDate), { name: name || nav.name, marks: marks, caption: 'What ₹10,000 in this fund became over your own stretch, with your money in and out marked.' });
      html += '</div>';
    });
    return html;
  }

  /* ------------------------------------------------------- All the numbers */
  function allNumbersTab(g, res) {
    var rows = g.flows.slice().sort(function (a, b) { return a.t - b.t; }).map(function (f) {
      return '<tr><td>' + fmtDate(f.t) + '</td><td>' + (f.kind === 'value' ? 'Worth' : f.kind === 'out' ? 'Money out' : 'Money in') + '</td><td class="num">' + money(Math.abs(f.amount)) + '</td><td>' + esc(f.label || '') + '</td></tr>';
    }).join('');
    return '<div class="card"><h2>Every entry the arithmetic used</h2><div class="scroll"><table class="data prose"><thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th>Fund</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="stats" style="margin-top:.8rem">' + stat('Entries', String(g.flows.length)) + stat('Days, first to last', String(res.days)) + stat('Rates that fit', String(res.roots.length)) + '</div>' +
      '<p class="cardtext">' + term('xirr', 'XIRR') + ' is the one yearly rate at which every entry, discounted from its own date on a 365-day year, adds up to zero. Money in is negative, money out and today’s worth are positive. The search finds every rate between −99.99% and one million percent that balances the entries' +
      (res.roots.length > 1 ? '; here there are ' + res.roots.length + ', ' + res.roots.map(function (r) { return pct(r); }).join(' and ') + ', and the one shown is the one a spreadsheet’s XIRR returns from its 10% starting guess' : '; here there is exactly one') + '.</p></div>';
  }

  function holdingsAnswer() {
    var rows = PF.holdings, invested = 0, current = 0, haveIn = 0, haveNow = 0;
    rows.forEach(function (h) { if (h.invested != null) { invested += h.invested; haveIn++; } if (h.current != null) { current += h.current; haveNow++; } });
    var net = current - invested, abs = invested > 0 ? net / invested : null;
    var html = notice('', '<strong>No yearly rate from this file.</strong> ' + esc(U.MESSAGES.noDatesForRate));
    html += '<div class="result"><div class="label">' + (abs == null ? 'What it is worth today' : term('absolute', 'Your total return so far')) + '</div><div class="value">' + (abs == null ? money(current) : esc(A.signedPct(abs))) + '</div>' +
      '<div class="sub">' + (abs == null ? rows.length + (rows.length === 1 ? ' holding' : ' holdings') : money(invested) + ' put in, worth ' + money(current) + ' now') + '</div></div>';
    html += '<div class="stats topline">' + stat('You put in', haveIn ? money(invested) : '—') + stat('Worth now', haveNow ? money(current) : '—') + stat('Gain or loss', haveIn && haveNow ? A.signedMoney(net) : '—') + stat('Holdings', String(rows.length)) + '</div>';
    var sorted = rows.slice().sort(function (a, b) { return (b.current || b.invested || 0) - (a.current || a.invested || 0); });
    html += '<div class="card"><h2>Each holding, and its share</h2><div class="scroll"><table class="data"><thead><tr><th>Fund</th><th>Put in</th><th>Worth now</th><th>Gain</th><th>Share</th></tr></thead><tbody>' +
      sorted.map(function (h) {
        var gn = (h.invested != null && h.current != null) ? h.current - h.invested : null, size = h.current != null ? h.current : h.invested;
        return '<tr><td>' + esc(h.name) + '</td><td>' + (h.invested == null ? '—' : money(h.invested)) + '</td><td>' + (h.current == null ? '—' : money(h.current)) + '</td><td>' + (gn == null ? '—' : (h.invested > 0 ? A.signedPct(gn / h.invested) : '—')) + '</td><td>' + (current > 0 && size != null ? pct(size / current, 0) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="cardtext">The last column is what your money is actually made of. A fund can have the best return on this page and still be too small a share to have moved your total; the largest share decides most of what happens to you next.</p></div>';
    html += fold('What this figure is not', '<p>A total return has no clock in it. ' + (abs == null ? 'This' : esc(A.signedPct(abs))) + ' over two years and the same figure over ten are completely different results, and this file does not say which you are looking at. It is before exit load and before tax, and it compares with nothing.</p>');
    return html + A.pdfFoot('portfolio', 'My holdings');
  }
  function partialAnswer(invested, withdrawn, current) {
    if (!invested && !withdrawn && !current) return '';
    var net = current + withdrawn - invested, abs = invested > 0 && current > 0 ? net / invested : null;
    return '<div class="card"><h2>What the figures so far do say</h2><div class="stats">' + stat('You put in', invested ? money(invested) : '—') + stat('You took out', withdrawn ? money(withdrawn) : '—') +
      stat('Worth now', current ? money(current) : '—') + stat('Gain or loss', abs == null ? '—' : A.signedMoney(net)) + '</div>' +
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
    $('#pf-after').hidden = !mode;
    $('#pf-actions').hidden = !mode;
    $('#pf-out').innerHTML = ''; PF.ran = false;
    if (mode === 'typed') {
      $('#pf-worth-card').hidden = true; $('#pf-index-card').hidden = false; $('#pf-calc').disabled = false;
      if (!$$('#pf-rows .entry').length) blankRows(); else afterTyped();
    } else if (mode === 'file') {
      $('#pf-after').hidden = !PF.kind; $('#pf-actions').hidden = !PF.kind; $('#pf-calc').disabled = !PF.kind;
      if (PF.kind === 'ledger') drawFundCards(PF.schemes ? PF.schemes.map(function (g) { return g.name; }) : [], PF.schemes);
    }
  }
  function say(id, text, html) { var e = $('#' + id); if (!e) return; if (html) e.innerHTML = html; else e.textContent = text; }
  function resetPortfolio() {
    PF.kind = null; PF.holdings = null; PF.imported = null; PF.valuations = []; PF.switches = 0; PF.source = ''; PF.answers = {}; PF.last = null; PF.schemes = null; PF.nav = {}; PF.navDoors = {}; PF.ran = false;
    $('#pf-read').hidden = true; $('#pf-worth-card').hidden = true; $('#pf-values-card').hidden = true; $('#pf-values').innerHTML = ''; $('#pf-worth').value = '';
    $('#pf-out').innerHTML = ''; $('#pf-door-out').innerHTML = ''; $('#pf-paste-text').value = ''; $('#pf-paste-box').hidden = true;
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
    $('#pf-import').addEventListener('click', function () { $('#pf-import-file').click(); });
    $('#pf-import-file').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importRows(f); });
    $('#pf-calc').addEventListener('click', calcPortfolio);
    $('#pf-reset').addEventListener('click', resetPortfolio);
    $('#pf-worth').addEventListener('input', function () { var n = parseFloat($('#pf-worth').value); $('#pf-worth-echo').textContent = isFinite(n) ? A.echo(n) : ''; if (PF.ran) calcPortfolio(); });
    $('#pf-rows').addEventListener('change', function () { if (PF.ran) PF.ran = false; });
  }

  root.PRCPortfolio = { init: init, state: PF, calc: calcPortfolio };
})(typeof globalThis !== 'undefined' ? globalThis : this);
