/* Where You Stand — the four modules.
 *
 * Every result follows the same shape: the number, what it means, what it does
 * not mean, and what to look at next. A number on its own is what ordinary
 * calculators already give people.
 */
(function () {
  'use strict';
  var A = window.PRCApp, E = window.PRCEngine, P = window.PRCParse;
  var $ = A.$, $$ = A.$$, esc = A.esc, money = A.money, moneyLong = A.moneyLong;
  var pct = A.pct, notice = A.notice, fmtDate = A.fmtDate;

  /* ============================================================== PORTFOLIO */

  var KINDS = ['Money in', 'Money out', 'Worth today'];
  var rowSeq = 0;

  function addRow(values) {
    var v = values || {};
    var id = 'r' + (rowSeq++);
    var wrap = A.el('div', { class: 'entry', 'data-row': id });
    /* The labels are visible on a phone, where the column headings are not: an
     * error saying "row 4" is useless if row 4 is four unlabelled boxes. */
    /* Review v4 §12.6: the row is [fields][×]. The fields sit in their own
     * column so the × can never take space from them, and that column carries
     * min-width:0 -- without it a grid column refuses to shrink below its
     * content's minimum and the fields crush to about 60 pixels each ("Inv",
     * "Amou", "Whicl") while the × keeps its full width. */
    wrap.innerHTML =
      '<div class="c-fields">' +
        '<div class="c-num" aria-hidden="true"></div>' +
        '<div class="c-date"><label for="' + id + 'd">Date</label>' +
          '<input type="date" id="' + id + 'd" class="in-date" value="' + esc(v.date || '') + '">' +
          '<span class="date-echo" id="' + id + 'de"></span></div>' +
        '<div class="c-kind"><label for="' + id + 'k">What happened</label>' +
          '<select id="' + id + 'k" class="in-kind">' +
          KINDS.map(function (k) {
            return '<option' + (v.kind === k ? ' selected' : '') + '>' + k + '</option>';
          }).join('') + '</select></div>' +
        '<div class="c-amt"><label for="' + id + 'a">Amount in rupees</label>' +
          '<input type="number" id="' + id + 'a" class="in-amt" inputmode="decimal" min="0" step="1" ' +
          'placeholder="Amount" value="' + (v.amount != null ? esc(v.amount) : '') + '">' +
          '<span class="amt-echo" id="' + id + 'ae"></span></div>' +
        '<div class="c-tag"><label for="' + id + 't">Which fund or goal</label>' +
          '<input type="text" id="' + id + 't" class="in-tag" autocomplete="off" ' +
          'placeholder="Which fund?" value="' + esc(v.label || '') + '"></div>' +
      '</div>' +
      '<button type="button" class="del" aria-label="Remove this row">&times;</button>';
    wrap.querySelector('.del').addEventListener('click', function () { wrap.remove(); numberRows(); });

    /* Review v4 §12.5: a native date input renders in the BROWSER's locale, and
     * 04/01/2022 is 4 January to an Indian reader and 1 April to this tool.
     * The control stays -- it is the right one on a phone -- and the date it
     * holds is echoed underneath in dd-MMM-yyyy, which reads one way only. */
    var dateInput = wrap.querySelector('.in-date');
    var dateEcho = wrap.querySelector('.date-echo');
    function sayDate() {
      var t = A.isoToTs(dateInput.value);
      dateEcho.textContent = isFinite(t) ? A.fmtDate(t) : '';
    }
    dateInput.addEventListener('input', sayDate);
    dateInput.addEventListener('change', sayDate);
    sayDate();

    /* And the rupee helper the review asks for under every rupee input. */
    var amtInput = wrap.querySelector('.in-amt');
    var amtEcho = wrap.querySelector('.amt-echo');
    function sayAmt() {
      var n = parseFloat(amtInput.value);
      var say = amtInput.value.trim() === '' ? '' : A.checkInput('rupees', n);
      amtEcho.textContent = say || A.echo(n);
      amtEcho.classList.toggle('refuse', !!say);
    }
    amtInput.addEventListener('input', sayAmt);
    sayAmt();
    $('#pf-rows').appendChild(wrap);
    numberRows();
    return wrap;
  }

  /* Rows are referred to by number in every error message, so they carry one. */
  function numberRows() {
    $$('#pf-rows .entry').forEach(function (r, i) {
      var n = r.querySelector('.c-num');
      if (n) n.textContent = 'Row ' + (i + 1);
    });
  }

  function readRows() {
    return $$('#pf-rows .entry').map(function (r) {
      return {
        date: r.querySelector('.in-date').value,
        kind: r.querySelector('.in-kind').value,
        amount: parseFloat(r.querySelector('.in-amt').value),
        label: (r.querySelector('.in-tag').value || '').trim()
      };
    });
  }

  function todayTs() {
    var n = new Date();
    return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  }

  /* ===================================================== the portfolio door
   *
   * The reader hands over the file their platform already gives them and is
   * asked nothing about it. Two entirely different downloads work here and
   * they do not know which they have:
   *
   *   a holdings snapshot     what they own now. No dates, so no yearly rate
   *                           can ever come out of it -- but what went in
   *                           against what it is worth is a real answer, and
   *                           usually the one they wanted.
   *   a transaction statement every payment with its date. Everything above,
   *                           plus the yearly rate.
   *
   * So the screen answers from whatever it is given rather than demanding the
   * file that answers everything. It never asks the reader to pick a type, and
   * a file it cannot use is told what it is, not merely refused.
   */
  var PF = {
    kind: null,        /* 'holdings' | 'ledger' | null when typed by hand */
    holdings: null,
    imported: null,    /* dated flows out of a transaction statement */
    source: '',        /* the filename, or "pasted columns" */
    answers: {},       /* the door's questions, once answered */
    file: null,        /* kept, so another tab can be read without re-picking */
    sheet: null,       /* the tab chosen, when the file has more than one */
    sheets: null,
    sheetName: null,
    last: null         /* what to re-read when one of them is answered */
  };

  function portfolioDoor() {
    var pick = $('#pf-pick'), input = $('#pf-file'), drop = $('#pf-drop');
    if (!pick || !input) return;

    /* The picker can take a second or two to appear; the button says so the
       moment it is tapped rather than looking dead. See A.pickBusy. */
    function openPicker() {
      input.click();
      setTimeout(function () { A.pickBusy(pick); }, 0);
    }
    pick.addEventListener('click', openPicker);
    if (drop) {
      drop.addEventListener('click', function (e) { if (e.target === drop) openPicker(); });
      drop.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
      });
      /* dragenter and dragleave fire again for every child the pointer
         crosses, so the highlight is counted in and out rather than toggled. */
      var depth = 0;
      function allow(e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }
      drop.addEventListener('dragenter', function (e) { allow(e); depth++; drop.classList.add('dropping'); });
      drop.addEventListener('dragover', allow);
      drop.addEventListener('dragleave', function () {
        if (--depth <= 0) { depth = 0; drop.classList.remove('dropping'); }
      });
      drop.addEventListener('drop', function (e) {
        e.preventDefault(); depth = 0; drop.classList.remove('dropping');
        var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) takeFile(files[0]);
      });
    }
    input.addEventListener('change', function (e) {
      A.pickDone();
      var files = Array.prototype.slice.call(e.target.files || []);
      if (files.length) takeFile(files[0]);
    });

    $('#pf-paste-open').addEventListener('click', function () {
      var box = $('#pf-paste-box');
      box.hidden = !box.hidden;
      if (!box.hidden) $('#pf-paste-text').focus();
    });
    $('#pf-paste-read').addEventListener('click', function () {
      var text = $('#pf-paste-text').value;
      if (!text.trim()) return;
      PF.answers = {};
      PF.source = 'pasted columns';
      readInto(text);
    });

    $('#pf-manual').addEventListener('click', function () {
      var card = $('#pf-manual-card');
      card.hidden = false;
      $('#pf-group-card').hidden = false;
      $('#pf-manual-line').hidden = true;
      PF.kind = null;
      $('#pf-calc').disabled = false;
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    $('#pf-reset').addEventListener('click', resetPortfolio);
  }

  function takeFile(file, sheet) {
    PF.answers = {};
    PF.file = file;
    PF.source = file.name || 'that file';
    PF.sheet = sheet == null ? null : sheet;
    say('pf-door-out', 'Reading ' + esc(PF.source) + '…');
    /* A workbook comes back as rows and a CSV as text. The reader takes
       either, so neither is turned into the other on the way. */
    W_contentOf(file, PF.sheet).then(function (got) {
      PF.sheets = got.sheets || null;
      PF.sheetName = got.sheetName || null;
      readInto(got.rows ? got.rows : got.text);
      /* A consolidated statement is a cover, a summary and the transactions on
       * a third tab. Reading the first one hands the reader a cover page and a
       * refusal, so every tab is offered and the one that reads is chosen. */
      if (got.sheets && got.sheets.length > 1) offerSheets(got.sheets, got.sheetName);
    }).catch(function (err) {
      say('pf-door-out', '', notice('bad', esc(err.message)));
    });
  }

  function offerSheets(sheets, current) {
    var host = $('#pf-door-out');
    var wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.style.marginTop = '.8rem';
    wrap.innerHTML = '<label for="pf-sheet">This file has ' + sheets.length +
      ' tabs. Reading <strong>' + esc(current) + '</strong>.</label>' +
      '<select id="pf-sheet">' + sheets.map(function (n) {
        return '<option' + (n === current ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('') + '</select>' +
      '<p class="hint">On a consolidated statement the transactions are usually not the first tab.</p>';
    host.appendChild(wrap);
    $('#pf-sheet').addEventListener('change', function () {
      takeFile(PF.file, this.value);
    });
  }

  /* shared.js is a v3 file; this screen predates it, so the same two-shape
     reader is spelled out here rather than reached across. */
  function W_contentOf(file, sheet) {
    if (/\.xlsx?$/i.test(file.name || '') && window.SimWorkbook) {
      var WB = window.SimWorkbook;
      return WB.listSheets(file).catch(function () { return []; }).then(function (sheets) {
        /* With no tab named, read the first one whose rows this door can
           actually use, rather than the first one in the file. */
        var order = sheet != null ? [sheet]
          : (sheets.length > 1 ? sheets.slice() : [undefined]);
        return firstReadable(WB, file, order).then(function (got) {
          got.sheets = sheets;
          return got;
        });
      }).catch(function () {
        throw new Error('That Excel file could not be read here. Open it and save it as CSV, ' +
                        'then load that.');
      });
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That file could not be opened.')); };
      reader.onload = function () { resolve({ text: String(reader.result) }); };
      reader.readAsText(file);
    });
  }

  /* Tries each tab in turn and keeps the first whose rows read as either shape.
     If none does, the first tab is returned so the refusal describes something
     the reader can see rather than a tab they never opened. */
  function firstReadable(WB, file, order) {
    var i = 0, firstGot = null;
    function attempt() {
      if (i >= order.length) return Promise.resolve(firstGot);
      var name = order[i++];
      return WB.readWorkbook(file, name).then(function (rows) {
        var got = { rows: rows, sheetName: rows.sheetName || name };
        if (!firstGot) firstGot = got;
        var probe = window.SimUpload.portfolioFile(rows, {});
        if (probe.ok || probe.ask) return got;
        return attempt();
      }, attempt);
    }
    return attempt();
  }

  function readInto(source) {
    PF.last = source;
    var r = window.SimUpload.portfolioFile(source, PF.answers);

    if (r.ask === 'direction') return askDirection(r);
    if (!r.ok) {
      PF.kind = null;
      $('#pf-read').hidden = true;
      $('#pf-worth-card').hidden = true;
      $('#pf-calc').disabled = true;
      $('#pf-out').innerHTML = '';
      say('pf-door-out', '', notice('bad', esc(r.message)));
      return;
    }

    PF.kind = r.kind;
    PF.holdings = r.kind === 'holdings' ? r.rows : null;
    PF.imported = r.kind === 'ledger' ? r.rows : null;
    $('#pf-paste-box').hidden = true;
    $('#pf-manual-card').hidden = true;
    $('#pf-manual-line').hidden = false;
    $('#pf-calc').disabled = false;
    say('pf-door-out', '', notice('ok', 'Read <strong>' + esc(PF.source) + '</strong>.'));
    drawRead(r);
  }

  /* The one question this door can raise: a statement whose amounts are all
     unsigned, where only a type column knows which way the money went. */
  function askDirection(r) {
    /* Pre-ticked from the broker dictionary, never decided by it. A word the
       dictionary does not know stays unticked, which reads as money in -- the
       same as before the dictionary existed. */
    var guessed = 0;
    var words = r.words.map(function (w, i) {
      if (w.guess) guessed++;
      return '<label class="tick"><input type="checkbox" data-word="' + esc(w.word) +
        '" id="pf-dir-' + i + '"' + (w.guess === 'out' ? ' checked' : '') + '><span>' +
        esc(w.word) + ' <span class="qsub">' + w.count +
        (w.count === 1 ? ' line' : ' lines') +
        (w.guess ? ' \u00b7 read as money ' + w.guess : ' \u00b7 not recognised') +
        '</span></span></label>';
    }).join('');
    say('pf-door-out', '', '<div class="notice"><span class="ic">?</span><span>' +
      esc(r.message) + '</span></div><div class="ticks">' + words + '</div>' +
      '<p class="hint">' + (guessed
        ? 'Ticked from what these words usually mean. Change anything that is wrong for your ' +
          'statement \u2014 a switch out, for instance, is money leaving one fund and entering ' +
          'another on the same day. '
        : '') + 'Anything left unticked is read as money in.</p>' +
      '<div class="btnrow"><button class="primary" type="button" id="pf-dir-go">' +
      'Read them this way</button></div>');
    $('#pf-dir-go').addEventListener('click', function () {
      var map = {};
      A.$$('[data-word]', $('#pf-door-out')).forEach(function (b) {
        map[b.dataset.word] = b.checked ? 'out' : 'in';
      });
      PF.answers.direction = map;
      readInto(PF.last);
    });
  }

  /* What was read, shown back as plain lines.
   *
   * This is the part that makes an upload trustworthy. Typing is irritating but
   * its errors are VISIBLE -- a wrong row is on screen and gets fixed. An import
   * fails silently: one mis-read column and a confident wrong number comes out
   * with nothing flagged anywhere. So the file is read back to the reader, and
   * a line read wrongly can be dropped. Checked, not built. */
  function drawRead(r) {
    var card = $('#pf-read'), body = $('#pf-read-list');
    var head = $('#pf-read-h'), note = $('#pf-read-note');
    card.hidden = false;

    if (r.kind === 'holdings') {
      head.textContent = 'What you hold';
      note.innerHTML = String(PF.holdings.length) +
        (PF.holdings.length === 1 ? ' fund' : ' funds') + ' read from ' + esc(PF.source) +
        (r.skipped ? ', ' + String(r.skipped) + ' line' + (r.skipped === 1 ? '' : 's') +
          ' skipped' : '') +
        (r.totalsDropped ? ', and a totals row left out so it is not counted twice' : '') + '.';
      body.innerHTML = PF.holdings.map(function (h, i) {
        return readLine(i, esc(h.name),
          [['put in', h.invested == null ? '\u2014' : money(h.invested)],
           ['worth now', h.current == null ? '\u2014' : money(h.current)]]);
      }).join('');
    } else {
      head.textContent = 'What you paid in';
      var out = PF.imported.filter(function (f) { return f.dir === 'out'; }).length;
      note.innerHTML = String(PF.imported.length) +
        (PF.imported.length === 1 ? ' payment' : ' payments') + ' read from ' + esc(PF.source) +
        (r.skipped ? ', ' + String(r.skipped) + ' line' + (r.skipped === 1 ? '' : 's') +
          ' skipped' : '') +
        (out ? '. ' + String(out) + (out === 1 ? ' is money out' : ' are money out') : '') + '.' +
        (!r.dateCertain && r.example
          ? ' These dates read two ways; ' + esc(r.example.raw) + ' has been read as ' +
            esc(r.example.dayFirst) + '. Check the lines below.'
          : '');
      body.innerHTML = PF.imported.map(function (f, i) {
        return readLine(i, fmtDate(f.t),
          [[f.dir === 'out' ? 'money out' : 'money in', money(f.amount)]]);
      }).join('');
    }

    A.$$('[data-drop]', body).forEach(function (b) {
      b.addEventListener('click', function () {
        var list = r.kind === 'holdings' ? PF.holdings : PF.imported;
        list.splice(+b.dataset.drop, 1);
        if (!list.length) { resetPortfolio(); return; }
        drawRead(r);
      });
    });

    /* A statement of payments records what was paid, never what it grew to.
     * That is the one figure no such file contains.
     *
     * Where the statement NAMES its funds, one figure is not enough: a
     * portfolio XIRR can be had from a single total, but a fund's own XIRR
     * needs that fund's own ending, and there is no way to split one total
     * back out across schemes. So the ask becomes one row per scheme. */
    var named = r.kind === 'ledger' && PF.imported.some(function (f) { return f.fund; });
    PF.schemes = named ? window.SimUpload.schemeTotals(PF.imported) : null;
    $('#pf-worth-card').hidden = r.kind !== 'ledger' || named;
    $('#pf-values-card').hidden = !named;
    if (named) drawValues();
    /* A holdings file already shows every fund separately; the choice only
       means something for dated payments, and only when they carry a name. */
    $('#pf-group-card').hidden = r.kind !== 'ledger' ||
      !PF.imported.some(function (f) { return f.fund; });
  }

  /* One block per line rather than a table row.
   *
   * Five columns inside a 390px phone have no width to give, and the two ways
   * out of that are both wrong here. Letting the cells wrap turns one row into
   * a column of unlabelled figures; scrolling sideways puts the figures off
   * the edge -- and the figures are the entire point, because this list exists
   * to be CHECKED against the reader's own statement. So it is not a table at
   * that width: the line's name reads first, its figures sit under it with
   * their own labels, and nothing is off screen. */
  function readLine(i, title, pairs) {
    return '<li class="readline"><div class="rl-head">' +
      '<span class="rl-title">' + title + '</span>' +
      '<button class="link" type="button" data-drop="' + i + '">drop</button></div>' +
      '<div class="rl-figs">' + pairs.map(function (p) {
        return '<span class="rl-fig"><span class="qsub">' + esc(p[0]) + '</span> ' +
          '<b>' + p[1] + '</b></span>';
      }).join('') + '</div></li>';
  }

  /* Units left times today's NAV, or the value itself. Both are offered
   * because which one a reader can lay hands on depends entirely on their app:
   * some show a NAV per unit and some show a rupee value, and asking for the
   * one they do not have in front of them is asking them to do arithmetic the
   * page can do for them. */
  /* Units carry three or four decimals on a real statement and the tail is not
     decoration -- it is the difference between a valuation that reconciles with
     the reader's app and one that does not. */
  function units3(n) {
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function drawValues() {
    var host = $('#pf-values');
    if (!host) return;
    var open = PF.schemes.filter(function (g) { return !g.closed; });
    var closed = PF.schemes.filter(function (g) { return g.closed; });

    host.innerHTML = open.map(function (g, i) {
      var known = g.hasUnits && g.units > 0;
      return '<div class="valrow" data-scheme="' + esc(g.name) + '">' +
        '<div class="val-name">' + esc(g.name) +
          '<span class="qsub">' + (known
            ? units3(g.units) + ' units left \u00b7 ' + money(g.paidIn - g.tookOut) + ' net in'
            : money(g.paidIn - g.tookOut) + ' net in \u00b7 no units in this file') +
          '</span></div>' +
        '<div class="val-fields">' +
          (known
            ? '<label class="field"><span class="label">NAV today</span>' +
              '<input type="number" class="val-nav" id="pf-nav-' + i + '" ' +
              'inputmode="decimal" min="0" step="any" placeholder="per unit"></label>'
            : '') +
          '<label class="field"><span class="label">Value today (\u20b9)</span>' +
          '<input type="number" class="val-amt" id="pf-val-' + i + '" ' +
          'inputmode="decimal" min="0" step="any"></label>' +
        '</div></div>';
    }).join('');

    if (closed.length) {
      host.innerHTML += '<p class="hint" style="margin:.8rem 0 0">' +
        '<strong>Nothing to value in ' +
        closed.map(function (g) { return esc(g.name); }).join(', ') + '.</strong> ' +
        (closed.length === 1 ? 'Its units' : 'Their units') + ' net to zero, so you are out of ' +
        (closed.length === 1 ? 'it' : 'them') + ' \u2014 the statement already contains ' +
        (closed.length === 1 ? 'its' : 'their') + ' ending, and ' +
        (closed.length === 1 ? 'it is' : 'they are') + ' measured without a figure from you.</p>';
    }

    A.$$('.valrow', host).forEach(function (row) {
      var nav = row.querySelector('.val-nav'), amt = row.querySelector('.val-amt');
      var g = PF.schemes.filter(function (x) { return x.name === row.dataset.scheme; })[0];
      if (nav) nav.addEventListener('input', function () {
        var n = parseFloat(nav.value);
        /* The NAV fills the value; the value is still the reader's to overrule,
           because a statement's unit count can be stale and theirs is not. */
        amt.value = (isFinite(n) && n >= 0 && g) ? (n * g.units).toFixed(2) : '';
        valuesChanged();
      });
      amt.addEventListener('input', function () {
        if (nav && document.activeElement === amt) nav.value = '';
        valuesChanged();
      });
    });
    valuesChanged();
  }

  function valuesChanged() {
    var open = (PF.schemes || []).filter(function (g) { return !g.closed; });
    var given = readValues();
    var n = Object.keys(given).length;
    var note = $('#pf-values-note');
    if (note) {
      note.textContent = n === 0
        ? 'None valued yet. A fund left blank is measured on its payments alone, which needs a full exit to work.'
        : n + ' of ' + open.length + ' valued' +
          (n < open.length ? '. The rest are measured on their payments alone.' : '.');
    }
    if ($('#pf-out').innerHTML) calcPortfolio();
  }

  function readValues() {
    var out = {};
    A.$$('#pf-values .valrow').forEach(function (row) {
      var v = parseFloat(row.querySelector('.val-amt').value);
      if (isFinite(v) && v > 0) out[row.dataset.scheme] = v;
    });
    return out;
  }

  function resetPortfolio() {
    PF.kind = null; PF.holdings = null; PF.imported = null; PF.source = '';
    PF.answers = {}; PF.last = null;
    $('#pf-read').hidden = true;
    $('#pf-worth-card').hidden = true;
    $('#pf-values-card').hidden = true;
    $('#pf-values').innerHTML = '';
    PF.schemes = null;
    $('#pf-group-card').hidden = true;
    $('#pf-manual-card').hidden = true;
    $('#pf-manual-line').hidden = false;
    $('#pf-calc').disabled = true;
    $('#pf-out').innerHTML = '';
    $('#pf-door-out').innerHTML = '';
    $('#pf-file').value = '';
    $('#pf-paste-text').value = '';
    $('#pf-paste-box').hidden = true;
  }

  function say(id, text, html) {
    var el = $('#' + id);
    if (!el) return;
    if (html) el.innerHTML = html; else el.textContent = text;
  }

  /* ------------------------------------- what a holdings file can answer
   *
   * Everything except the yearly rate, and it says so once rather than
   * refusing. calcPortfolio used to compute invested, withdrawn and current in
   * its first pass and then THROW ALL THREE AWAY if XIRR failed, so a reader
   * whose file was missing one thing was told nothing at all. */
  function holdingsAnswer() {
    var rows = PF.holdings;
    var invested = 0, current = 0, haveIn = 0, haveNow = 0;
    rows.forEach(function (h) {
      if (h.invested != null) { invested += h.invested; haveIn++; }
      if (h.current != null) { current += h.current; haveNow++; }
    });
    var net = current - invested;
    var abs = invested > 0 ? net / invested : null;

    var html = '';
    html += '<div class="result"><div class="label">' +
      (abs == null ? 'What it is worth today' : 'Your total return so far') + '</div>' +
      '<div class="value">' + (abs == null ? money(current) : A.signedPct(abs)) + '</div>' +
      '<div class="sub">' + (abs == null
        ? String(rows.length) + (rows.length === 1 ? ' holding' : ' holdings')
        : money(invested) + ' put in, worth ' + money(current) + ' now') + '</div></div>';

    html += '<div class="card"><h2>The numbers behind it</h2><div class="stats">' +
      stat('You put in', haveIn ? money(invested) : '—') +
      stat('Worth now', haveNow ? money(current) : '—') +
      stat('Gain or loss', haveIn && haveNow ? (net >= 0 ? '+' : '') + money(net) : '—') +
      stat('Holdings', String(rows.length)) +
      '</div></div>';

    /* Sorted by size, because what a portfolio is MOSTLY made of is the thing
       a snapshot answers best and a list in file order hides. */
    var sorted = rows.slice().sort(function (a, b) {
      return (b.current || b.invested || 0) - (a.current || a.invested || 0);
    });
    html += '<div class="card"><h2>Each holding, and its share</h2>' +
      '<div class="scroll"><table class="data wide"><thead><tr><th>Fund</th><th>You put in</th>' +
      '<th>Worth now</th><th>Gain</th><th>Share of the whole</th></tr></thead><tbody>' +
      sorted.map(function (h) {
        var g = (h.invested != null && h.current != null) ? h.current - h.invested : null;
        var size = h.current != null ? h.current : h.invested;
        return '<tr><td>' + esc(h.name) + '</td><td>' +
          (h.invested == null ? '—' : money(h.invested)) + '</td><td>' +
          (h.current == null ? '—' : money(h.current)) + '</td><td>' +
          (g == null ? '—' : (h.invested > 0 ? A.signedPct(g / h.invested) : '—')) + '</td><td>' +
          (current > 0 && size != null ? pct(size / current, 0) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="meaning"><h3>What this means</h3>' +
      '<p>The last column is what your money is actually made of. A fund can have the best return ' +
      'on this page and still be too small a share to have moved your total, and the largest share ' +
      'decides most of what happens to you next.</p></div></div>';

    /* The one question this file cannot answer, said once, with the file that
       can answer it named. Not an error: nothing went wrong. */
    html += '<div class="card">' + notice('',
      '<strong>No yearly rate from this file.</strong> ' +
      esc(window.SimUpload.MESSAGES.noDatesForRate)) + '</div>';

    html += '<div class="meaning"><h3>What it does not mean</h3>' +
      '<p>A total return has no clock in it. ' + (abs == null ? 'This' : esc(A.signedPct(abs))) +
      ' over two years and the same figure over ten are completely different results, and this file ' +
      'does not say which you are looking at.</p>' +
      '<p>It is before exit load and before tax, and it compares with nothing — not the fund’s ' +
      'own return, not another investor’s.</p></div>';

    $('#pf-out').innerHTML = html;
  }

  /* Whatever the figures already support, when the yearly rate does not come
   * out. A total with no clock in it is still a total, and a reader who has
   * given enough for one should be shown it rather than an error alone. */
  function partialAnswer(invested, withdrawn, current) {
    if (!invested && !withdrawn && !current) return '';
    var net = current + withdrawn - invested;
    var abs = invested > 0 && current > 0 ? net / invested : null;
    return '<div class="card"><h2>What the figures so far do say</h2><div class="stats">' +
      stat('You put in', invested ? money(invested) : '\u2014') +
      stat('You took out', withdrawn ? money(withdrawn) : '\u2014') +
      stat('Worth now', current ? money(current) : '\u2014') +
      stat('Gain or loss', abs == null ? '\u2014' : (net >= 0 ? '+' : '') + money(net)) +
      '</div>' +
      (abs == null
        ? '<p class="hint" style="margin:.7rem 0 0">A gain needs both what went in and what it is ' +
          'worth today. One of the two is still missing.</p>'
        : '<p class="hint" style="margin:.7rem 0 0">That is ' + esc(A.signedPct(abs)) +
          ' in total. It has no clock in it: the yearly rate needs the dates.</p>') +
      '</div>';
  }

  function calcPortfolio() {
    if (PF.kind === 'holdings') return holdingsAnswer();
    var rows = readRows();
    var out = $('#pf-out');
    var flows = [], problems = [], invested = 0, withdrawn = 0, current = 0, currentDate = null;

    /* Imported payments arrive already dated and already signed, so they skip
       the row-by-row validation below: there is no typed cell to be wrong. */
    if (PF.kind === 'ledger') {
      PF.imported.forEach(function (f) {
        var kind = f.dir === 'out' ? 'Money out' : 'Money in';
        if (f.dir === 'out') withdrawn += f.amount; else invested += f.amount;
        flows.push({ t: f.t, amount: f.dir === 'out' ? f.amount : -f.amount,
                     kind: kind, label: f.fund || '' });
      });
      if (PF.schemes) {
        /* One ending per scheme, each labelled with its own fund. byLabel
         * groups on that label, so the same push that gives the portfolio its
         * terminal value gives every scheme its own -- which is the whole
         * reason the ask is per scheme rather than one total. */
        var given = readValues();
        Object.keys(given).forEach(function (name) {
          current += given[name];
          currentDate = todayTs();
          flows.push({ t: currentDate, amount: given[name], kind: 'Worth today', label: name });
        });
      } else {
        var worth = parseFloat($('#pf-worth').value);
        if (isFinite(worth) && worth > 0) {
          current = worth;
          currentDate = todayTs();
          flows.push({ t: currentDate, amount: worth, kind: 'Worth today', label: '' });
        }
      }
      rows = [];
    }

    rows.forEach(function (r, i) {
      var blank = !r.date && !isFinite(r.amount);
      if (blank) return;
      var t = A.isoToTs(r.date);
      if (isNaN(t)) { problems.push('Row ' + (i + 1) + ' has no date.'); return; }
      if (t > todayTs()) {
        problems.push('Row ' + (i + 1) + ' is dated ' + fmtDate(t) + ', which is in the future. ' +
          'This measures money that has already moved.');
        return;
      }
      if (!isFinite(r.amount) || r.amount <= 0) {
        problems.push('Row ' + (i + 1) + ' needs an amount greater than zero, typed as a plain positive number.');
        return;
      }
      var signed = r.kind === 'Money in' ? -r.amount : r.amount;
      if (r.kind === 'Money in') invested += r.amount;
      else if (r.kind === 'Money out') withdrawn += r.amount;
      else { current += r.amount; currentDate = currentDate == null ? t : Math.max(currentDate, t); }
      flows.push({ t: t, amount: signed, kind: r.kind, label: r.label });
    });

    if (problems.length) {
      out.innerHTML = notice('bad', problems.slice(0, 4).map(esc).join('<br>'));
      return;
    }
    var res = E.xirr(flows);
    if (!res.ok) {
      /* THE defect on this screen. invested, withdrawn and current were all
       * worked out in the pass above and then thrown away here, so a reader
       * missing one thing was told nothing at all -- not even the total they
       * had already given enough for. Say what is missing, then answer
       * everything the figures do support. */
      var extra = res.code === 'NO_VALUE'
        ? (PF.kind === 'ledger'
            ? ' Type what the whole holding is worth today in the box above \u2014 a statement of ' +
              'payments records what you paid, never what it grew to.'
            : ' Add a last row with today\'s date, <strong>Worth today</strong>, and what the ' +
              'holding is worth now.')
        : '';
      out.innerHTML = notice('bad', esc(res.message) + extra) +
                      partialAnswer(invested, withdrawn, current);
      return;
    }

    var rate = res.rate;
    var net = current + withdrawn - invested;
    var abs = invested > 0 ? net / invested : 0;
    var first = flows.reduce(function (m, f) { return Math.min(m, f.t); }, Infinity);
    var last = flows.reduce(function (m, f) { return Math.max(m, f.t); }, -Infinity);
    var years = (last - first) / (365.2425 * 86400000);

    var html = '';
    html += '<div class="result"><div class="label">Your portfolio XIRR</div>' +
      '<div class="value">' + pct(rate) + '</div>' +
      '<div class="sub">Across ' + years.toFixed(1) + ' years, from ' + fmtDate(first) + ' to ' + fmtDate(last) + '</div></div>';

    /* The four figures, immediately under the headline and above every word of
       explanation. A reader who reads nothing else on this screen should still
       leave with these. */
    html += '<div class="stats topline">' +
      stat('Total return', A.signedPct(abs)) +
      stat('You put in', money(invested)) +
      stat('Worth now', money(current)) +
      stat('Gain or loss', (net >= 0 ? '+' : '') + money(net)) +
      '</div>';

    html += '<div class="card"><h2>The numbers behind it</h2><div class="stats">' +
      stat('You put in', money(invested)) +
      stat('You took out', money(withdrawn)) +
      stat('Worth now', money(current)) +
      stat('Gain or loss', (net >= 0 ? '+' : '') + money(net)) +
      '</div>' +
      '<table class="data"><tbody>' +
      trow('Absolute return', A.signedPct(abs) + ' in total, not per year') +
      trow('XIRR', pct(rate) + ' a year, counting when each rupee moved') +
      trow('Period', years.toFixed(1) + ' years') +
      '</tbody></table>';

    /* ------------------------------------------------ whose maths is it?
     * Two arithmetics are on this screen and they will not match. The book's
     * first question is exactly this, so the tool answers it out loud rather
     * than leaving the reader to wonder which number is wrong. Neither is. */
    html += twoNumbersCard(abs, rate, years);

    /* ------------------------------------------- after the bill, what is left?
     * Inflation is the one return that compounds against every rupee. It ships
     * with no rate filled in: a number here would be the tool telling the
     * reader what to expect, and that is not its job. */
    html += realReturnCard(rate);

    html += '<div class="meaning"><h3>What this means</h3>' +
      '<p>Your money grew at about <strong>' + pct(rate) + ' a year</strong>, taking into account the date ' +
      'every rupee went in and came out. Money you invested early had longer to work than money you ' +
      'invested last month, and this number already accounts for that.</p>' +
      '<p>Your total gain of ' + esc(A.signedPct(abs)) + ' is <em>not</em> a yearly figure. Spread across ' +
      years.toFixed(1) + ' years, it works out at the ' + pct(rate) + ' above.</p>' +
      '</div>';

    html += '<div class="meaning"><h3>What it does not mean</h3><ul class="points">' +
      '<li><strong>Not the fund\u2019s return.</strong> A fund can publish a strong number while ' +
      'yours is weaker, purely because of when you happened to invest. Its figure describes the ' +
      'fund; this one describes you.</li>' +
      '<li><strong>Not comparable to anything.</strong> Not the fund\u2019s own return, not another ' +
      'investor\u2019s, not your other holding \u2014 each ran on a different set of dates.</li>' +
      '<li><strong>Before exit load and before tax.</strong> On an equity fund held for years, plan ' +
      'on roughly a point a year less once tax is paid, and more than that if you sell early.</li>' +
      '</ul></div>';

    html += disagreeCard();

    html += '<div class="meaning"><h3>What to look at next</h3>' +
      '<p>A return means little without a period and a comparison. Use <button class="link" data-go="history">' +
      'Understand market history</button> to see the range this kind of market has actually delivered over ' +
      'the same length of time, and <button class="link" data-go="goal">Plan my goal</button> to see whether ' +
      'this rate gets you where you are going.</p></div>';

    html += '</div>';

    /* Asked per scheme, so answered per scheme: the breakdown is not something
       the reader has to go and switch on after doing the work of valuing each
       fund. The control stays, and turning it off still turns it off. */
    if ($('#pf-group').value === 'on' || PF.schemes) html += byLabel(flows, rate);
    out.innerHTML = html;
    wireRealReturn(rate);
  }

  /* Three bands of real return, and what each one is.
   *
   * The bands are the author's: below zero, nought to three, above three. What
   * matters about how they are written is what they are NOT. A band is a
   * DESCRIPTION of a subtraction the reader can check -- nominal return divided
   * by inflation -- and never an instruction. So each band carries things to
   * look at rather than things to do: how long the money has been invested, how
   * it is spread, whether the amount going in has moved with prices. Every one
   * of those is a fact about the reader's own arrangement that they can inspect
   * without this tool knowing anything about their life. None of them names an
   * asset, and none of them says buy, sell, switch or swap. */
  var REAL_BANDS = [
    { at: -Infinity, name: 'Purchasing Power Loss',
      says: 'What this money buys fell over this period. The statement showed a positive return and ' +
            'still printed no minus sign, because the subtraction below is one no statement makes.',
      look: ['How long this money has been invested. Over a short stretch a single weak year decides ' +
             'the whole figure, and the yearly rate above says nothing about which years those were.',
             'How the money is spread. A real return below zero is what a mix held mostly in cash-like ' +
             'assets does during a period of higher inflation, and that is a fact about the mix ' +
             'rather than about any one holding.',
             'Whether the amount going in each month has moved with prices at all. An unchanged ' +
             'instalment buys a little less every year by definition.'] },
    { at: 0, name: 'Capital Preservation',
      says: 'What this money buys held roughly steady. It is not standing still &mdash; keeping pace ' +
            'with prices is itself a result &mdash; but nothing here has been added to what the ' +
            'money can do.',
      look: ['The gap between the two rates above. A small real return can come from a high nominal ' +
             'return in a high-inflation stretch or a low one in a quiet stretch, and those are very ' +
             'different periods to have lived through.',
             'How much of the period is recent. XIRR weighs every rupee by how long it was invested, ' +
             'so money added lately moves this figure less than it feels like it should.',
             'What the money is for and when it is needed. A real return near zero means the sum ' +
             'itself, rather than growth on it, is doing the work.'] },
    { at: 0.03, name: 'Real Wealth Generation',
      says: 'What this money buys grew over this period. The figure below is the part that bought ' +
            'something; everything above it went on holding the price of things steady.',
      look: ['Whether this stretch included a fall. A high real return measured from the bottom of ' +
             'one is a fact about the starting date as much as about the holding.',
             'How concentrated the result is. If one holding produced most of it, the figure ' +
             'describes that holding more than the arrangement around it.',
             'Whether the inflation figure typed above matches your own basket. School fees and ' +
             'hospital bills have outrun the headline number for years, and if your life is heavy ' +
             'with either, your real subtraction is bigger than the country\u2019s.'] }
  ];

  function realBand(real) {
    var found = REAL_BANDS[0];
    REAL_BANDS.forEach(function (b) { if (real >= b.at) found = b; });
    return found;
  }

  function wireRealReturn(rate) {
    var input = $('#pf-infl'), out = $('#pf-real-out');
    if (!input || !out) return;
    input.addEventListener('input', function () {
      var i = parseFloat(input.value);
      var bad = $('#pf-infl-bad');
      if (!isFinite(i)) {
        out.innerHTML = '';
        if (bad) { bad.hidden = true; bad.textContent = ''; }
        input.setAttribute('aria-invalid', 'false');
        return;
      }
      /* Refused ON THE FIELD, before anything is computed. A number outside
       * these bounds does not produce a wrong reading, it produces one that
       * describes a country nobody lives in -- and the same cap governs the
       * goal planner, so both screens agree about the same quantity. */
      var say = A.checkInput('inflation', i);
      if (bad) { bad.textContent = say || ''; bad.hidden = !say; }
      input.setAttribute('aria-invalid', say ? 'true' : 'false');
      if (say) { out.innerHTML = ''; return; }
      var real = (1 + rate) / (1 + i / 100) - 1;
      var band = realBand(real);
      out.innerHTML = '<div class="stats" style="margin:.2rem 0 0">' +
        stat('Your return', pct(rate)) +
        stat('Inflation', i.toFixed(1) + '%') +
        stat('What is left', pct(real)) +
        '</div>' +
        /* The band is a label on a subtraction, so it is set as a label with
           the subtraction beside it -- never as a badge on its own, which is
           how a description turns into a verdict. */
        '<p class="bandline" style="margin:.9rem 0 0"><span class="bandname">' + esc(band.name) +
        '</span> <span class="qsub">' + pct(real) + ' a year, after ' + i.toFixed(1) +
        '% inflation</span></p>' +
        '<p class="hint" style="margin:.5rem 0 0">' + band.says + '</p>' +
        /* Why it is not a subtraction. A reader who does the quick maths in
         * their head gets a different number from the one on screen, and
         * without both workings side by side the screen looks wrong rather
         * than exact. Shown at their own figures, not at an example's. */
        '<details class="explain"><summary>Why this is not ' + pct(rate) + ' minus ' +
        i.toFixed(1) + '%</summary><div class="body">' +
        '<div class="scroll"><table class="data"><tbody>' +
        '<tr><td><strong>Exact</strong><br><span class="qsub">what this tool uses</span></td>' +
        '<td class="mono">(1 + ' + rate.toFixed(4) + ') &divide; (1 + ' + (i / 100).toFixed(4) +
        ') &minus; 1</td><td><strong>' + pct(real) + '</strong></td></tr>' +
        '<tr><td>Quick<br><span class="qsub">the subtraction in your head</span></td>' +
        '<td class="mono">' + pct(rate) + ' &minus; ' + i.toFixed(1) + '%</td><td>' +
        pct(rate - i / 100) + '</td></tr>' +
        '</tbody></table></div>' +
        '<p>The quick maths is out by <strong>' +
        (Math.abs((rate - i / 100) - real) * 100).toFixed(2) + ' percentage points</strong> here, ' +
        'and the gap widens as both figures grow. Inflation does not subtract from a return; it ' +
        'divides into it, because the price of things compounds against every rupee over the same ' +
        'years your money is compounding.</p>' +
        '</div></details>' +
        '<div class="meaning" style="margin-top:.8rem"><h3>Worth looking at</h3><ul class="lookat">' +
        band.look.map(function (t) { return '<li>' + t + '</li>'; }).join('') +
        '</ul><p>None of these is a thing to do. They are things about your own arrangement that ' +
        'you can check, and this tool knows none of them: not your goal, not your horizon, not what ' +
        'else you own, not what you can sit through.</p></div>';
    });
  }

  /* The book's first question, answered on the reader's own numbers.
   *
   * Absolute return has no clock in it. XIRR is a yearly rate. Early on, a
   * small total gain gets stretched to a yearly pace and XIRR reads higher; as
   * the years pile up the total keeps growing while the yearly rate does not,
   * and somewhere near the two-year mark the total overtakes it for good. That
   * crossover is the single most common reason two figures on one screen look
   * like a contradiction, so the tool says which side of it the reader is on. */
  function twoNumbersCard(abs, rate, years) {
    /* The earlier wording said the total overtakes the rate "near the two-year
     * mark", which is true for a monthly SIP and false for a lump sum: a lump
     * crosses at exactly twelve months, because (1+r)^1 - 1 is r. One line
     * that is true for both is simply how many years the total has inside it. */
    var absAhead = abs > rate;
    var sentence = years < 1
      ? 'Under a year, the yearly rate is the one to ignore. It stretches a short stretch to a ' +
        'twelve-month pace: a 5% gain in two months reads as about 34% a year, which is not something ' +
        'that has happened to anyone. Read the total gain instead.'
      : absAhead
        ? 'The total is bigger than the yearly rate because it has ' + years.toFixed(1) +
          ' years inside it; the rate has one.'
        : 'The yearly rate is bigger than the total because most of this money has been invested for ' +
          'less than a year so far; the rate is still a per-year figure.';

    return '<div class="card"><h2>Two numbers, two different questions</h2>' +
      '<p class="hint" style="margin:0 0 .9rem">Both are on this screen, they do not match, and ' +
      'nothing is wrong. They are answering different questions.</p>' +
      '<div class="scroll"><table class="data"><tbody>' +
      '<tr><td><strong>Absolute return</strong><br><span class="qsub">Worth today, plus what you took ' +
      'out, minus what you put in &mdash; as a share of what you put in.</span></td><td>' +
      esc(A.signedPct(abs)) + '<br><span class="qsub">in total &middot; no clock in it</span></td></tr>' +
      '<tr><td><strong>XIRR</strong><br><span class="qsub">At what yearly speed did my own money ' +
      'travel?</span></td><td>' + pct(rate) + '<br><span class="qsub">a year &middot; counts every ' +
      'date</span></td></tr>' +
      '</tbody></table></div>' +
      '<p style="margin:.9rem 0 0;color:var(--ink-2);font-size:.95rem">' + sentence + '</p>' +
      '<details class="explain"><summary>And the third one, CAGR, which is not yours</summary>' +
      '<div class="body"><p>CAGR is the number a fund publishes. It answers one question: if a single ' +
      'rupee had gone in on the first day of the period shown and had never been touched, at what ' +
      'steady yearly speed did it grow?</p>' +
      '<p>If you invested monthly, that is not your return, because it measures one lump sum that went ' +
      'in on day one and stayed. It is also measured between the first and last day of the period the ' +
      'fund printed, not between the day you bought and the day you are reading.</p>' +
      '<p>Use CAGR to compare one fund with another over the same period. Use the XIRR above to see ' +
      'what your own money did. They are not rivals; they are answers to different questions.</p>' +
      '</div></details></div>';
  }

  /* The book's third question. The subtraction most statements never print. */
  function realReturnCard(rate) {
    return '<div class="card" id="pf-real"><h2>After the bill, what is left?</h2>' +
      '<p class="hint" style="margin:0 0 .9rem">Your return is printed on the statement. Your real ' +
      'earning is printed on the shop&rsquo;s bill. Type the inflation figure you want to measure ' +
      'against &mdash; this tool does not choose one for you.</p>' +
      '<div class="field" style="max-width:15rem"><label for="pf-infl">Inflation, % a year</label>' +
      '<input type="number" id="pf-infl" inputmode="decimal" step="0.1" min="0" max="25" ' +
      'aria-describedby="pf-infl-bad" placeholder="e.g. 6">' +
      '<p class="hint refuse" id="pf-infl-bad" hidden></p></div>' +
      '<div id="pf-real-out"></div>' +
      '<details class="explain"><summary>How this is worked out</summary><div class="body">' +
      '<p>The quick version is your return minus inflation. The exact version, which this tool uses, ' +
      'is (1 + return) &divide; (1 + inflation) &minus; 1. On a 12% return in a 6% year the quick ' +
      'maths says 6 and the exact maths says 5.66.</p>' +
      '<p>The official basket is not your basket. If your life is heavy with school fees or hospital ' +
      'bills, both of which have outrun the headline figure for years, your real subtraction is bigger ' +
      'than the country&rsquo;s.</p></div></details></div>';
  }

  /* Review v4 §12.12: "When two screens disagree" set out the chapter's five
   * checks in full on this screen. Section 4's rule: a sentence is on screen
   * only if it could not have been written before the reader's data arrived.
   * These could, so they are the book's, and what stays is a pointer of six
   * words or fewer. */
  function disagreeCard() {
    return '<p class="hint pointer">Chapter 13, the five checks.</p>';
  }

  function byLabel(flows, portfolioRate) {
    var groups = {};
    flows.forEach(function (f) {
      var k = f.label || 'Not named';
      (groups[k] = groups[k] || []).push(f);
    });
    var keys = Object.keys(groups);
    if (keys.length < 2) {
      return '<div class="card">' + notice('', 'To compare holdings, name each row in the ' +
        '<strong>Which fund?</strong> box — one name per fund or goal. Rows sharing a name are ' +
        'measured together.') + '</div>';
    }
    /* "not enough entries" told a reader that something was wrong and nothing
     * about what. The engine already knows exactly which of five conditions
     * failed -- it has said so since it was written -- and byLabel was throwing
     * that away and substituting a shrug. Each holding now says what its own
     * rows are missing, which is a different answer per holding on the same
     * screen: one may be a single purchase with no valuation, another may be
     * two entries on the same day. */
    var rows = keys.map(function (k) {
      var r = E.xirr(groups[k]);
      var put = groups[k].reduce(function (t, f) { return t + (f.amount < 0 ? -f.amount : 0); }, 0);
      return '<tr><td>' + esc(k) + '</td><td>' + money(put) + '</td><td>' +
        (r.ok ? pct(r.rate)
              : '<span class="qsub">' + esc(holdingWhy(r, groups[k])) + '</span>') + '</td></tr>';
    }).join('');
    var total = flows.reduce(function (t, f) { return t + (f.amount < 0 ? -f.amount : 0); }, 0);
    rows += '<tr style="border-top:2px solid var(--line-strong)"><td><strong>Your whole portfolio</strong></td>' +
      '<td><strong>' + money(total) + '</strong></td><td><strong>' + pct(portfolioRate) + '</strong></td></tr>';
    return '<div class="card"><h2>Each holding, and the whole</h2>' +
      '<div class="scroll"><table class="data"><thead><tr><th>Holding</th><th>You put in</th>' +
      '<th>Its own XIRR</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="meaning"><h3>Why these differ from your portfolio number</h3>' +
      '<p>Each line above is the return of that holding on its own. Your portfolio number weighs them by ' +
      'how much money you actually had in each, and when. A brilliant return on a small, late investment ' +
      'moves your total far less than a mediocre one on a large, early holding.</p></div></div>';
  }

  /* An XIRR needs at least two dated rows, at least one of them money going in
   * and at least one of them money coming back -- a valuation or a withdrawal
   * -- and they cannot all fall on the same day. Which of those is missing is
   * the whole of the answer, so it is what gets said. */
  function holdingWhy(res, rowsForHolding) {
    var n = rowsForHolding.length;
    var says = {
      TOO_FEW: 'needs 2 dated rows; this holding has ' + n,
      NO_INVESTMENT: 'no money going in — only a valuation',
      NO_VALUE: 'no valuation and no withdrawal, so there is nothing to measure against',
      SAME_DAY: 'every row is on one date, so there is no period to annualise',
      UNSOLVABLE: 'this pattern of money in and out has no single sensible rate'
    };
    return says[res.code] || res.message || 'not enough entries';
  }

  function stat(k, v) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }
  function trow(k, v) { return '<tr><td>' + esc(k) + '</td><td>' + esc(v) + '</td></tr>'; }

  /* Three chained window.prompt dialogs on a phone is not an interface. The
   * same four questions, asked in the page, with a date picker like everywhere
   * else. */
  function toggleSip(show) {
    var panel = $('#sip-builder');
    panel.hidden = !show;
    $('#pf-sip').setAttribute('aria-expanded', String(show));
    if (show) {
      if (!$('#sip-start').value) {
        /* a year ago, not today: a SIP that starts today has no history to measure */
        var d = new Date();
        d.setUTCFullYear(d.getUTCFullYear() - 1);
        $('#sip-start').value = d.toISOString().slice(0, 10);
      }
      $('#sip-start').max = A.isoToday();
      $('#sip-msg').innerHTML = '';
      $('#sip-start').focus();
    }
  }

  function addSipRows() {
    var msg = $('#sip-msg');
    var t0 = A.isoToTs($('#sip-start').value);
    var amount = parseFloat($('#sip-amount').value);
    var count = parseInt($('#sip-count').value, 10);
    var name = $('#sip-name').value.trim();

    if (isNaN(t0)) { msg.innerHTML = notice('bad', 'Choose the date of the first instalment.'); return; }
    if (t0 > todayTs()) {
      msg.innerHTML = notice('bad', 'The first instalment cannot be in the future.');
      return;
    }
    if (!isFinite(amount) || amount <= 0) {
      msg.innerHTML = notice('bad', 'Enter the monthly amount as a plain positive number.');
      return;
    }
    if (!isFinite(count) || count < 1 || count > 480) {
      msg.innerHTML = notice('bad', 'Enter between 1 and 480 instalments.');
      return;
    }

    var added = 0, skipped = 0;
    for (var i = 0; i < count; i++) {
      var t = E.addMonths(t0, i);
      if (t > todayTs()) { skipped++; continue; }
      addRow({ date: new Date(t).toISOString().slice(0, 10), kind: 'Money in',
               amount: amount, label: name });
      added++;
    }
    if (name) $('#pf-group').value = 'on';
    msg.innerHTML = notice('ok', 'Added ' + added + ' instalment' + (added === 1 ? '' : 's') + '.' +
      (skipped ? ' ' + skipped + ' would have fallen in the future and were left out.' : ''));
    toggleSip(false);
  }

  function fillExample() {
    $('#pf-rows').innerHTML = '';
    addRow({ date: '2021-04-01', kind: 'Money in', amount: 200000 });
    addRow({ date: '2022-04-01', kind: 'Money in', amount: 150000 });
    addRow({ date: '2024-04-01', kind: 'Money out', amount: 100000 });
    addRow({ date: A.isoToday(), kind: 'Worth today', amount: 420000 });
  }

  function exportRows() {
    var lines = ['Date,What happened,Amount'];
    readRows().forEach(function (r) {
      if (r.date || isFinite(r.amount)) lines.push([r.date, r.kind, isFinite(r.amount) ? r.amount : ''].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'my-investments.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* =================================================================== GOAL */

  /* Review v4 §12.1: the planner accepted any number at all. A step-up of
   * 10000000 was taken as 100,000 times a year and returned a 68-digit figure.
   * No formatting rule can rescue that number -- the refusal has to happen at
   * the field, before anything is computed. Section 11 sets the ranges; the
   * field says which one it broke and the screen does not compute. */
  var GOAL_FIELDS = [
    { id: 'g-target',  kind: 'rupees' },
    { id: 'g-current', kind: 'rupees' },
    { id: 'g-sip',     kind: 'rupees' },
    { id: 'g-years',   kind: 'years'  },
    { id: 'g-rate',    kind: 'rate'   },
    { id: 'g-step',    kind: 'stepUp' }
  ];

  function goalOutOfRange() {
    var broken = [];
    GOAL_FIELDS.forEach(function (f) {
      var el = $('#' + f.id);
      if (!el) return;
      var v = parseFloat(el.value);
      var say = A.checkInput(f.kind, v);
      var note = $('#' + f.id + '-bad');
      if (note) { note.textContent = say || ''; note.hidden = !say; }
      el.setAttribute('aria-invalid', say ? 'true' : 'false');
      if (say) broken.push(say);
    });
    return broken;
  }

  /* The four the reader may move, and nothing else. Each one says where it
   * starts from, how far it goes and how to read its own value back, so the
   * markup, the reset and the recompute all come from one list rather than
   * three copies of the same four things. */
  var SCENARIO_LEVERS = [
    /* The top of this lever has to REACH the amount that closes the gap, or
     * the model cannot answer the question a gap raises. Four times the
     * current amount does not reach it for a reader currently paying in
     * nothing, which is exactly the reader most likely to be short. */
    { id: 'g-scn-sip', key: 'monthlySip', label: 'Monthly investment',
      min: 0, step: 500,
      from: function (i) { return Math.round(i.monthlySip); },
      max: function (i, plan) {
        var needed = i.monthlySip + ((plan && plan.extraMonthly) || 0);
        return Math.max(5000, Math.ceil(Math.max(i.monthlySip * 4, needed * 1.5) / 500) * 500);
      },
      say: function (v) { return money(v) + ' a month'; } },

    { id: 'g-scn-step', key: 'annualStepUpRate', label: 'Raised each year by',
      min: 0, step: 1,
      from: function (i) { return Math.round(i.annualStepUpRate * 100); },
      max: function () { return 25; },
      scale: 0.01,
      say: function (v) { return v + '% a year'; } },

    { id: 'g-scn-years', key: 'years', label: 'Years left',
      min: 1, step: 1,
      from: function (i) { return Math.round(i.years); },
      max: function (i) { return Math.min(50, Math.max(10, Math.round(i.years) + 15)); },
      say: function (v) { return v + (v === 1 ? ' year' : ' years'); } },

    { id: 'g-scn-target', key: 'target', label: 'Amount you are aiming for',
      min: 0, step: 50000,
      from: function (i) { return Math.round(i.target / 50000) * 50000; },
      max: function (i) { return Math.max(500000, Math.round(i.target * 2 / 50000) * 50000); },
      say: function (v) { return A.moneyWords(v); } }
  ];

  /* Live while dragging: a scenario model that only answers when let go is a
   * form with extra steps. Everything here is arithmetic on numbers already in
   * the page, so there is nothing to wait for. */
  function wireScenario(input, plan) {
    var box = $('#g-scn');
    if (!box) return;

    function read() {
      var v = {
        currentValue: input.currentValue, monthlySip: input.monthlySip,
        years: input.years, annualRate: input.annualRate,
        annualStepUpRate: input.annualStepUpRate, target: input.target
      };
      SCENARIO_LEVERS.forEach(function (L) {
        var el = $('#' + L.id);
        if (!el) return;
        var n = parseFloat(el.value);
        v[L.key] = isFinite(n) ? n * (L.scale || 1) : v[L.key];
        var out = $('#' + L.id + '-v');
        if (out) out.textContent = L.say(isFinite(n) ? n : L.from(input));
      });
      return v;
    }

    function draw() {
      var v = read();
      var p = E.projectGoal(v);
      var slot = $('#g-scn-out');
      if (!slot) return;
      if (!p.ok) { slot.innerHTML = notice('bad', esc(p.message)); return; }
      var diff = p.projected - v.target;
      var moved = SCENARIO_LEVERS.filter(function (L) {
        var el = $('#' + L.id);
        return el && parseFloat(el.value) !== L.from(input);
      }).length;
      slot.innerHTML =
        '<div class="result" style="margin:.9rem 0 0"><div class="label">' +
        (moved ? 'On these four, you reach' : 'On your own entries, you reach') + '</div>' +
        '<div class="value small">' + A.moneyWords(p.projected) + '</div>' +
        '<div class="sub">' + money(p.projected) + ' \u00b7 against ' + money(v.target) + ' \u00b7 ' +
        (diff >= 0 ? 'covered, ' + money(diff) + ' to spare' : 'short by ' + money(-diff)) +
        '</div></div>' +
        '<p class="hint" style="margin:.6rem 0 0">Over ' + v.years.toFixed(0) + ' years you would pay ' +
        'in ' + money(p.totalContributed) + ' of your own money, on top of the ' +
        money(v.currentValue) + ' you already hold.</p>';
    }

    SCENARIO_LEVERS.forEach(function (L) {
      var el = $('#' + L.id);
      if (el) el.addEventListener('input', draw);
    });
    var reset = $('#g-scn-reset');
    if (reset) reset.addEventListener('click', function () {
      SCENARIO_LEVERS.forEach(function (L) {
        var el = $('#' + L.id);
        if (el) el.value = L.from(input);
      });
      draw();
    });
    draw();
  }

  function calcGoal() {
    var out = $('#g-out');
    var broken = goalOutOfRange();
    if (broken.length) {
      out.innerHTML = notice('bad', esc(broken[0]) +
        (broken.length > 1 ? ' And ' + (broken.length - 1) + ' other field' +
          (broken.length > 2 ? 's are' : ' is') + ' out of range.' : ''));
      return;
    }

    var input = {
      currentValue: parseFloat($('#g-current').value),
      monthlySip: parseFloat($('#g-sip').value),
      years: parseFloat($('#g-years').value),
      annualRate: parseFloat($('#g-rate').value) / 100,
      annualStepUpRate: parseFloat($('#g-step').value) / 100,
      target: parseFloat($('#g-target').value)
    };
    var plan = E.projectGoal(input);
    if (!plan.ok) { out.innerHTML = notice('bad', esc(plan.message)); return; }

    var name = $('#g-name').value.trim() || 'this goal';
    var html = '';

    /* The headline is the figure in words -- section 11's rule for a headline
     * and for any figure inside a sentence -- with the full digits beneath it
     * for a reader checking against their own arithmetic. Both go through the
     * one formatter, which is what makes an exponent unrepresentable. */
    html += '<div class="result"><div class="label">If nothing changes, you reach</div>' +
      '<div class="value">' + A.moneyWords(plan.projected) + '</div>' +
      '<div class="sub">' + money(plan.projected) + ' · Goal: ' + money(plan.target) + '</div></div>';

    if (plan.onTrack) {
      html += notice('ok', '<strong>On track.</strong> On the return you assumed, ' + esc(name) +
        ' is covered with ' + esc(A.moneyWords(plan.surplus)) + ' to spare.');
    } else {
      html += notice('bad', '<strong>Short by ' + esc(money(plan.gap)) + '.</strong> On the return you ' +
        'assumed, ' + esc(name) + ' is not covered by what you are doing now.');
    }

    html += '<div class="stats topline">' +
      stat('You reach', A.moneyWords(plan.projected)) +
      stat('Your goal', A.moneyWords(plan.target)) +
      stat(plan.onTrack ? 'To spare' : 'Short by',
           A.moneyWords(plan.onTrack ? plan.surplus : plan.gap)) +
      stat(plan.onTrack ? 'Needed each month' : 'More each month',
           plan.onTrack ? 'nothing more' : money(plan.extraMonthly)) +
      '</div>';

    html += '<div class="card">' + A.goalChart(plan) + '</div>';

    html += '<div class="card"><h2>What it would take</h2>';
    if (plan.onTrack) {
      html += '<p style="margin:0 0 .8rem">Nothing more is required on these assumptions. The scenarios below ' +
        'show what happens if you do more anyway.</p>';
    } else {
      html += '<div class="result" style="margin:0 0 1rem"><div class="label">Additional monthly investment needed</div>' +
        '<div class="value small">' + money(plan.extraMonthly) + ' a month</div>' +
        '<div class="sub">On top of the ' + money(input.monthlySip) + ' a month you already invest</div></div>';
    }

    /* Four fixed rows told a reader what ₹2,000 more a month would do. They
     * could not ask what ₹3,500 would do, or what a year longer would do, and
     * a gap is exactly the moment somebody wants to ask. The rows are now four
     * levers they can move, and everything below them recomputes as they move.
     *
     * Only these four move. The assumed RETURN stays where the reader put it,
     * because raising it until the gap closes is not a plan -- it is the one
     * lever nobody controls, and the table further down already shows what
     * happens if the market disagrees. */
    html += '<div class="scenario" id="g-scn">' +
      '<p class="hint" style="margin:0 0 .8rem">Move any of these four. The figure below moves ' +
      'with them. Your own entries above are untouched.</p>' +
      SCENARIO_LEVERS.map(function (L) {
        return '<div class="lever"><label for="' + L.id + '">' + L.label + '</label>' +
          '<input type="range" id="' + L.id + '" min="' + L.min + '" max="' + L.max(input, plan) +
          '" step="' + L.step + '" value="' + L.from(input) + '">' +
          '<output id="' + L.id + '-v" for="' + L.id + '"></output></div>';
      }).join('') +
      '<div id="g-scn-out" aria-live="polite"></div>' +
      '<button class="secondary" type="button" id="g-scn-reset">Put them back</button>' +
      '</div>';
    html += '<p class="hint" style="margin-top:.6rem">Every figure here uses the same assumed return of ' +
      pct(input.annualRate) + ' a year, the one you typed in.</p></div>';

    /* ---- §8: one assumed return printed alone reads as a promise */
    html += '<div class="card"><h2>It depends what the market does</h2>' +
      '<div class="scroll"><table class="data"><thead><tr><th>If returns average</th>' +
      '<th>You reach</th><th>Extra needed each month</th></tr></thead><tbody>';
    E.requiredAcrossRates(input, [0.06, 0.08, 0.10, 0.12]).forEach(function (row) {
      if (row.error) return;
      html += '<tr' + (Math.abs(row.rate - input.annualRate) < 1e-9 ?
        ' style="background:var(--accent-soft)"' : '') + '><td>' + pct(row.rate, 0) +
        ' a year</td><td>' + money(row.projected) + '</td><td>' +
        (row.onTrack ? 'nothing more needed' : money(row.extraMonthly) + ' a month') + '</td></tr>';
    });
    html += '</tbody></table></div>' +
      '<p class="hint" style="margin-top:.6rem">Your own assumption of ' + pct(input.annualRate, 0) +
      ' is highlighted. Nobody can tell you which of these rows the future will resemble.</p></div>';

    /* ---- §9: what waiting costs */
    var waits = E.costOfWaiting(input, [0, 5, 10]).filter(function (w) { return !w.error; });
    if (waits.length > 1) {
      html += '<div class="card"><h2>What waiting costs</h2>' +
        '<div class="scroll"><table class="data"><thead><tr><th>If you start</th>' +
        '<th>Years left</th><th>Needed each month</th><th>Total you pay in</th>' +
        '</tr></thead><tbody>';
      waits.forEach(function (w) {
        html += '<tr><td>' + (w.impossible ? 'in ' + w.delay + ' years' :
          w.delay === 0 ? 'now' : 'in ' + w.delay + ' years') + '</td>' +
          (w.impossible
            ? '<td colspan="3">the goal date has already passed</td>'
            : '<td>' + w.yearsLeft + '</td><td>' + money(w.monthlyNeeded) + '</td><td>' +
              money(w.totalPaid) + '</td>') + '</tr>';
      });
      html += '</tbody></table></div>';
      if (waits.length > 1 && waits[0].monthlyNeeded > 0) {
        html += '<div class="meaning"><h3>What this means</h3>' +
          '<p>Same goal, same date, same assumed return. Waiting ' + waits[1].delay +
          ' years raises what you must put in each month from ' + money(waits[0].monthlyNeeded) +
          ' to <strong>' + money(waits[1].monthlyNeeded) + '</strong>, and raises the total you pay ' +
          'in from ' + money(waits[0].totalPaid) + ' to ' + money(waits[1].totalPaid) + '.</p>' +
          '<p>Nothing about the market changed between those rows. Only the number of years did.</p>' +
          '</div>';
      }
      html += '</div>';
    }

    /* ---- §10: how much of the end is your money, and how much is growth */
    var ownMoney = input.currentValue + plan.totalContributed;
    var growth = plan.projected - ownMoney;
    html += '<div class="card"><h2>Your money, and growth on it</h2><div class="stats">' +
      stat('Already saved', money(input.currentValue)) +
      stat('Still to pay in', money(plan.totalContributed)) +
      stat('Growth on both', money(growth)) +
      stat('Growth\u2019s share of the end', growth > 0 ? pct(growth / plan.projected, 0) : '—') +
      '</div>' +
      '<div class="meaning"><h3>What this means</h3>' +
      '<p>Of the ' + money(plan.projected) + ' at the end, ' + money(ownMoney) + ' is money you ' +
      'hand over yourself \u2014 ' + money(input.currentValue) + ' already saved and ' +
      money(plan.totalContributed) + ' still to pay in \u2014 and ' + money(growth) + ' is what it ' +
      'earns while you leave it alone. The longer the period, the more the second number does the ' +
      'work.</p></div></div>';

    /* ---- §11: the target is in today's rupees unless the reader adjusts it */
    html += '<div class="card">' + notice('',
      '<strong>These are future rupees, not today\u2019s.</strong> ' + money(input.target) +
      ' in ' + plan.years.toFixed(0) + ' years will not buy what ' + money(input.target) +
      ' buys today. This tool does not model inflation, so if you want the goal to hold its ' +
      'purchasing power, raise the target yourself before planning against it.') + '</div>';

    html += '<div class="meaning"><h3>What this means</h3>' +
      '<p>Of the ' + money(plan.projected) + ' above, ' + money(plan.fromCorpus) + ' comes from what you ' +
      'already hold and ' + money(plan.fromSip) + ' from what you keep adding. Over ' + plan.years.toFixed(1) +
      ' years you would pay in ' + money(plan.totalContributed) + ' of your own money.</p>' +
      '<p>Notice how much the scenarios differ from each other. That difference is the point of this screen: ' +
      'small, steady changes compound into large ones, and they are almost always easier to control than ' +
      'the return.</p></div>';

    html += '<div class="meaning"><h3>What it does not mean</h3>' +
      '<p>The ' + pct(input.annualRate) + ' is an assumption you typed in, not a rate anyone can promise. ' +
      'Real markets do not deliver the same return every year, and a run of poor years early on hurts more ' +
      'than the same years late. Treat this as an illustration of arithmetic, not a forecast.</p>' +
      '</div>';

    out.innerHTML = html;
    wireScenario(input, plan);
  }

  /* ================================================ ROLLING RETURN RENDERER */

  var RATE_DATA = {};

  /* The length the page opens on. See R.years for why this exists. */
  var DEFAULT_YEARS = 3;

  /* How much history a window of this length wants behind it before its range
   * is worth reading. The step-1 helper text states this as 3+ years for
   * 1-year windows, 5+ for 3-year and 7+ for 5-year, which is length + 2, and
   * this is the function that keeps the warning honest to that promise.
   *
   * The result card carries a STRICTER test of its own (length + 3, the book's
   * rule) which refuses to be quiet about a range built from one stretch of
   * market. That one is a judgement about the numbers; this one is a warning
   * about the file, and they are deliberately not the same threshold. */
  function recommendedYears(years) { return years + 2; }

  function renderRolling(series, years, meta, compareSeries, compareName, prefix, compareMeta, opts) {
    var o = opts || {};
    /* Section 4: the frequency thins the START DATES and nothing else. Every
       window below is still measured first value to last over the full holding
       period, so a monthly-stepped 5-year window is still a 5-year window. */
    var calc = { frequency: o.frequency || 'daily' };
    if (o.indexPath) {
      /* Market-index path only. Each window is annualised over its own
         calendar-day count on a 365.25-day year -- the review's CAGR form --
         and the two files are put on one calendar (forward-filled where one
         lacks a date the other has) before any pairing. The fund path keeps
         the engine's defaults, and nothing there changes. */
      calc.dayBasis = 365.25;
      calc.join = 'calendar';
    }
    var r = E.rollingReturns(series, years, calc);
    if (!r.ok) return notice('bad', esc(r.message));
    var s = r.stats;
    var below = r.values.filter(function (v) { return v < 0; }).length;
    var key = prefix || 'x';
    RATE_DATA[key] = r.values;
    var html = '';
    /* The market-index path lays its cards out in four tabbed panels; the
       fund path keeps its single column exactly as it was. add() is the one
       place that decides which, so every block below is written once. */
    var PANEL = { summary: '', risk: '', bench: '', data: '' };
    function add(panel, frag) { if (o.indexPath) PANEL[panel] += frag; else html += frag; }
    var freqLabel = (E.FREQUENCY[calc.frequency] || E.FREQUENCY.daily).label;

    /* The book's rule for trusting this page at all: the history should be at
     * least three years longer than the window. Any less and every row starts
     * inside a narrow band of dates, so the table is one short stretch of
     * market measured over and over with its edges moved a little. The range it
     * prints then comes from one period of history, and many periods is the
     * entire point of the page. */
    var spanYears = (series[series.length - 1].t - series[0].t) / (365.2425 * 86400000);

    /* ONE WINDOW IS A MEASUREMENT, NOT A DISTRIBUTION.
     *
     * The Max History horizon makes this reachable in one click: twenty-year
     * windows on a twenty-year file leave exactly one. Everything below has to
     * know it, because three separate blocks on this screen are written about
     * a range -- the suspicion notice, the density badge and the hero -- and
     * all three said things about a range that did not exist. "These 1 windows
     * overlap ... read the range below as the shape of that much market" is
     * advice about a shape there is no second point to make. */
    var thin = s.count < 3;

    var suspicion = (!thin && spanYears < years + 3)
      ? '<strong>Read this range with suspicion.</strong> This data covers ' + spanYears.toFixed(1) +
        ' years and you have asked for ' + years + '-year windows, so every window here begins inside a ' +
        'band of about ' + Math.max(0, spanYears - years).toFixed(1) + ' years. They are not independent ' +
        'stretches of market &mdash; they are one stretch measured over and over with its edges moved a ' +
        'little. Three years of spare history is roughly the least it takes for windows to begin in ' +
        'genuinely different markets. Shorten the window, or load a longer history.'
      : '';
    if (suspicion && !o.indexPath) html += notice('bad', suspicion);

    /* ------------------------------------------------ how much is really here
     *
     * s.count runs to thousands, and every one of those windows overlaps its
     * neighbours: on a daily file, today's five-year window and yesterday's
     * share 1,824 of their 1,825 days. Counting them as evidence is counting
     * the same market over and over.
     *
     * The number that means something is how many windows could stand side by
     * side without touching -- the span divided by the window length -- and on
     * a twelve-year file measured in five-year windows that is two. Two. The
     * raw count on the same file is over two thousand, which is why the badge
     * is computed from the independent figure and never from s.count.
     */
    var independent = Math.floor(spanYears / years);
    /* The market-index path prints the span divided by the window length as
       it is, to one decimal: 6.9 years of history holds 1.4 five-year
       horizons, and rounding that down to 1 threw away the fraction the
       reader most needs to see. The fund path keeps the whole number. */
    var independentText = o.indexPath ? (spanYears / years).toFixed(1) : String(independent);
    var sampleLabel = 'Total Rolling Sample Windows';
    var sampleValue = s.count.toLocaleString() + ' (' + freqLabel + ' Shifts)';
    var horizonLabel = 'Independent (Non-Overlapping) ' + years + '-Year Horizons';
    var horizonValue = independentText + ' Periods';
    var densityText = (!thin && independent < 12)
      ? 'These ' + s.count.toLocaleString() + ' windows overlap. Laid side by side without ' +
        'touching, this history holds <strong>' + independentText +
        (independent === 1 && !o.indexPath ? ' non-overlapping ' + years + '-year period' :
                             ' non-overlapping ' + years + '-year periods') + '</strong> \u2014 ' +
        spanYears.toFixed(1) + ' years divided by ' + years + '. Read the range below as the shape ' +
        'of that much market and no more.'
      : '';
    if (densityText && !o.indexPath) {
      html += '<p class="density"><span class="density-badge">Low data density</span> ' +
        densityText + '</p>';
    }
    /* The reviewer's UX point, taken for the market-index path: overlap is
       real and stays said, but rolling windows are MEANT to overlap, and two
       warning slabs above the first number read as "this data is broken".
       The same sentences now live one tap away, under a heading that says
       what they are about, with the load-bearing count still visible on it. */
    if ((suspicion || densityText) && o.indexPath) {
      add('summary', '<details class="explain overlapinfo"><summary>Understanding window overlap' +
        ' \u2014 ' + sampleLabel + ': ' + sampleValue + ' \u00b7 ' + horizonLabel + ': ' +
        horizonValue + '</summary><div class="body">' +
        (suspicion ? '<p>' + suspicion + '</p>' : '') +
        (densityText ? '<p>' + densityText + '</p>' : '') +
        '<p>Overlap is a property of rolling analysis itself, not a fault in this file: ' +
        'consecutive windows share almost all their days by design. It matters only when ' +
        'the window count is read as a count of independent observations \u2014 which is ' +
        'why the non-overlapping figure is printed beside every large one.</p>' +
        '</div></details>');
    }

    /* The hero, at that length. The old one read "Median 15-year return ...
     * the middle of 1 overlapping holding periods. Half did better, half did
     * worse." Half of one did neither. The quartile
     * table beneath it printed the same number five times across Worst,
     * Bottom quarter, Median, Top quarter and Best, which is a spread of
     * nothing dressed as a range -- and a range is the entire claim this
     * screen makes.
     *
     * So at this length the screen states the one measurement it has, and
     * says outright that there is no distribution to read. */
    if (thin) {
      add('summary', '<div class="result"><div class="label">' +
        (s.count === 1 ? 'The only ' + years + '-year period in this data'
                       : 'The only ' + s.count + ' ' + years + '-year periods in this data') +
        ', % a year</div>' +
        '<div class="value">' + (s.count === 1 ? pct(r.values[0]) : pct(s.min) + ' to ' + pct(s.max)) +
        '</div>' +
        '<div class="sub">' + esc(meta.name) + ' \u00b7 ' + fmtDate(r.worst.t) + ' to ' +
        fmtDate(r.best.endT) + '. <strong>This is a measurement, not a range.</strong> A ' + years +
        '-year window needs ' + years + ' years of history behind it, and this file holds ' +
        spanYears.toFixed(1) + ' \u2014 so ' + (s.count === 1 ? 'only one such period exists'
          : 'only ' + s.count + ' such periods exist') + ' in it. There is no median, no worst ' +
        'case and no best case here, because there is nothing to be in the middle of. Choose a ' +
        'shorter holding period to see a distribution.</div></div>');
    } else {
      /* The reviewer's scroll-fatigue point: by the bottom of this screen the
         reader has forgotten what was asked at the top. A slim bar restates
         it and stays put while the results scroll under it \u2014 and carries the
         one action a finished analysis invites, printing it (a print is also
         how a phone saves a PDF). Market-index path only. */
      if (o.indexPath) {
        html += '<div class="stickybar"><span class="sb-name">' + esc(meta.name) + '</span>' +
          '<span class="sb-fact">' + years + 'y &middot; median ' + pct(s.median) +
          ' &middot; worst ' + pct(s.min) + '</span>' +
          '<button class="secondary printbtn" type="button" data-always-on="yes">' +
          'Print / save PDF</button></div>';
      }
      add('summary', '<div class="result"><div class="label">Median ' + years + '-year return, % a year</div>' +
        '<div class="value">' + pct(s.median) + '</div>' +
        '<div class="sub">' + esc(meta.name) + ' \u00b7 the middle of ' + s.count.toLocaleString() +
        ' overlapping holding periods, ' + fmtDate(series[0].t) + ' to ' +
        fmtDate(series[series.length - 1].t) + '. Half did better, half did worse.</div></div>');
    }

    if (!thin) {
      add('summary', '<div class="stats topline">' +
        stat('Worst', pct(s.min)) +
        stat('Median', pct(s.median)) +
        stat('Best', pct(s.max)) +
        (o.indexPath
          ? stat(sampleLabel, sampleValue) + stat(horizonLabel, horizonValue)
          : stat('Non-overlapping periods, at most', String(independent))) +
        '</div>');
    }

    /* The market-index path says, before any comparison, exactly what this
       page is and is not a record of. Two files, and nothing about the
       category those files sit in. */
    if (o.indexPath) {
      add('summary', '<p class="scopenote"><strong>Dataset Scope Note:</strong> This analysis ' +
        'reflects historical performance exclusively for the selected scheme and benchmark. It ' +
        'does not account for category-wide peer distributions or schemes that were merged, ' +
        'renamed, or liquidated during this timeframe.</p>');
    }

    /* Section 5's two blocks, in the order the specification lists them --
       on BOTH paths now. The fund path analyses one fund on its own, so its
       table has one measured column and its insights are the five that need
       no benchmark; where a figure would need one, the text names the Market
       index path instead of pretending the number exists. */
    var paired = null;
    if (compareSeries) {
      var cmp = E.compareRolling(series, compareSeries, years, calc);
      if (cmp.ok) paired = cmp;
    }
    if (o.indexPath && compareSeries) {
      /* Said once, at the top of the comparison panel, before any gap is
         printed -- and decided from the series as well as the names. */
      add('bench', classMismatchNote(meta.name, compareName, series, compareSeries));
    }
    add(o.indexPath ? 'bench' : 'summary',
        statisticalSummary(r, years, paired, compareName, calc,
                           compareSeries ? (compareMeta || null) : null,
                           o.indexPath ? 'index' : 'fund', key));
    add('summary', factualInsights(r, years, paired, compareName,
                                   o.indexPath ? 'index' : 'fund'));

    /* Worst to best across the quartiles, in that order. An average put at the
     * top of a screen becomes the number people remember, and it hides the
     * spread that actually decided what any one investor got. */
    if (thin) {
      /* Five columns of the same number is not a range. */
      add('risk', '<div class="card"><h2>There is no range at this length</h2>' +
        '<p class="hint" style="margin:0 0 .8rem">A quartile, a worst case and a best case all ' +
        'describe a set of measurements. This history holds ' + s.count +
        (s.count === 1 ? ' measurement' : ' measurements') + ' at ' + years +
        ' years, so there is nothing for them to describe.</p>' +
        '<div class="scroll"><table class="data"><tbody>' +
        r.pairs.map(function (pr, ix) {
          return '<tr><td>Period ' + (ix + 1) + '</td><td>' + fmtDate(pr.t) + ' to ' +
                 fmtDate(pr.endT) + '</td><td><strong>' + pct(pr.r) + ' a year</strong></td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="meaning"><h3>What to do about it</h3>' +
        '<p>Choose a shorter holding period in step 3, or load a longer history. Every extra year ' +
        'of history adds a year of start dates at this length; the file needs roughly ' +
        (years + 3) + ' years before ' + years + '-year windows begin in genuinely different ' +
        'markets, and it has ' + spanYears.toFixed(1) + '.</p></div></div>');
    } else {
    add('risk', '<div class="card"><h2>The range, not the average</h2>' +
      '<p class="hint" style="margin:0 0 .8rem"><strong>Read the worst figure first.</strong> It is what ' +
      'this market did over your holding period at its most unkind, and nobody tells you in advance ' +
      'which stretch you are walking into. Read the average last, and never on its own &mdash; on its ' +
      'own it is one more single number, which is the very thing this page exists to replace.</p>' +
      '<div class="scroll"><table class="data spread">' +
      '<caption>Annualised return, % a year, over every ' + years + '-year holding period</caption>' +
      '<thead><tr>' +
      '<th>Worst</th><th>Bottom quarter</th><th>Median</th><th>Top quarter</th><th>Best</th>' +
      '</tr></thead><tbody><tr>' +
      '<td>' + pct(s.min) + '</td><td>' + pct(s.p25) + '</td><td><strong>' + pct(s.median) +
      '</strong></td><td>' + pct(s.p75) + '</td><td>' + pct(s.max) + '</td>' +
      '</tr></tbody></table></div>' +
      '<p class="hint" style="margin:.5rem 0 1rem">A quarter of periods fell below ' +
      pct(s.p25) + ', and a quarter came in above ' + pct(s.p75) + '. The spread is what decided ' +
      'what any one investor actually got.</p>' +
      '<div class="stats">' +
      stat('Holding periods measured', s.count.toLocaleString()) +
      /* Counts, not shares. A share reads as a property of the fund when it is
       * really a property of the dates this file happens to start and end on. */
      stat('Ended below zero', below.toLocaleString() + ' of ' + s.count.toLocaleString()) +
      stat('Ended above zero', (s.count - below).toLocaleString() + ' of ' + s.count.toLocaleString()) +
      '</div>' +
      /* The market-index path draws its own histogram: the fund in one hue,
         the benchmark (when one is loaded, over the paired windows) in a
         second, side by side in every bin. The fund path keeps the shared
         chart untouched. */
      (o.indexPath
        ? ixHistogram(paired ? paired.fundValues : r.values,
                      paired ? paired.benchValues : null, years, meta.name, compareName, !!paired)
        : A.histogramChart(r.values, {
            years: years,
            caption: 'Each bar counts the ' + years + '-year periods that ended in that range'
          })) + '</div>');

      /* The histogram says how often; this says when. Index path only. */
      if (o.indexPath) {
        add('risk', rollLineChart(r.pairs, years, s, paired ? paired.matched : null, compareName));
      }
    }

    add('summary', summaryCard(r, s, series, years, below, compareSeries, compareName, calc, o.indexPath));

    /* Both paths: the horizon table is about the data itself, not about any
       comparison. The index path's version carries the wider matrix — the
       percentile bands and the below-zero / beat-target shares per horizon —
       and the fan chart drawn from the same rows. */
    if (!thin) {
      add('risk', horizonSpreadCard(series, years, calc,
                                    o.indexPath ? { extended: true, key: key,
                                                    compare: compareSeries || null,
                                                    compareName: compareName } : null));
    }

    add('risk', worstIsNotWorstCard(series, s, years));
    /* "The only difference between them was the day they started" needs two
       of them. With one window the best start and the worst start are the
       same day, and the card printed that spread as 0.0%. */
    if (s.count > 1) add('risk', startDateCard(r, years));
    add('risk', drawdownCard(series, years, o.indexPath, s.min));
    add('risk', rateCheckCard(key, years, r.values, o.indexPath));

    if (compareSeries) {
      add('bench', comparisonCards(series, compareSeries, years, meta.name, compareName,
                                   compareMeta, calc, o.indexPath, key));
    } else if (o.indexPath) {
      add('bench', '<div class="card"><h2>Benchmark comparison</h2><p class="hint" ' +
        'style="margin:0">No benchmark index is loaded. Load a Total Return Index (TRI) file ' +
        'into card 2, Benchmark Index Data, and this panel fills with the side-by-side ' +
        'comparison over the windows both files cover.</p></div>');
    }

    if (o.indexPath) add('summary', reflectCard(years, series, key));

    var meanings = '<div class="meaning"><h3>What this means</h3>' +
      '<p>Someone who invested at the worst possible moment in this data and held for ' + years +
      ' years earned <strong>' + pct(s.min) + ' a year</strong>. Someone who started at the best moment ' +
      'earned <strong>' + pct(s.max) + '</strong>. Same market, same holding period — the only difference ' +
      'was the day they started.</p>' +
      '<p>Of the ' + s.count.toLocaleString() + ' periods measured, ' + below.toLocaleString() +
      ' ended below zero. That count depends on the dates this file happens to cover, so read it as ' +
      'a count of what is in front of you, not as a property of the fund.</p></div>';

    meanings += '<div class="meaning"><h3>What it does not mean</h3><ul class="points">' +
      '<li><strong>Not a forecast.</strong> This is what already happened, over the dates in this ' +
      'file and no others. Nothing here claims the next ' + years + ' years will land inside it.</li>' +
      '<li><strong>Not independent samples.</strong> The windows overlap \u2014 ' +
      independentText + ' of them could stand side by side without touching.</li>' +
      '<li><strong>Not anyone\u2019s experience.</strong> The median is the middle of many possible ' +
      'starting days, not a result anybody actually had.</li>' +
      '</ul></div>';

    meanings += trapsCard(years);

    /* Index path: the closing education folds to one line, open on a tap.
       Nothing is removed — the reviewer's complaint was the scroll, not the
       sentences — and opening them is one tap for whoever wants them. */
    add('summary', o.indexPath
      ? '<details class="explain teachnotes"><summary>What these figures mean — and what ' +
        'they do not</summary><div class="body">' + meanings + '</div></details>'
      : meanings);

    var binTable = '<div class="scroll">' +
      '<table class="data"><thead><tr><th>Return range</th><th>Periods</th><th>Share</th></tr></thead><tbody>' +
      E.histogram(r.values).map(function (b) {
        return '<tr><td>' + esc(binText(b)) + '</td><td>' + b.count + '</td><td>' +
          pct(b.count / r.values.length, 0) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var matchNote = '<p style="margin-top:.7rem">Windows are matched on calendar dates, with up to seven days of ' +
      'tolerance when a market was shut. Periods falling inside a longer gap in the data are left out ' +
      'rather than stretched.</p>';
    if (!o.indexPath) {
      html += '<details class="explain"><summary>See the numbers as a table</summary><div class="body">' +
        binTable + matchNote + '</div></details>';
      return html;
    }

    /* The market-index path's fourth panel: every figure on the page as a
       table, and every window as a row, with the arithmetic that made them
       written out. */
    add('data', '<div class="card"><h2>The numbers as a table</h2>' +
      '<p class="hint" style="margin:0 0 .8rem">How many ' + years + '-year windows ended in ' +
      'each range.</p>' + binTable + matchNote +
      '<p>Each window’s figure is CAGR = (NAV<sub>end</sub> / NAV<sub>start</sub>)' +
      '<sup>365.25 / (Date<sub>end</sub> − Date<sub>start</sub>)</sup> − 1, with the ' +
      'day count taken from the two calendar dates themselves' +
      (paired ? '; the two files are joined on the calendar date (YYYY-MM-DD), and a date one ' +
                'file lacks is filled from that file’s last earlier value' : '') + '.</p>' +
      '</div>' + windowTable(r.pairs, years, paired ? paired.matched : null, meta.name, compareName));

    return '<div class="ixpath">' + html + tabbedPanels(PANEL, !!compareSeries) + '</div>';
  }

  /* The four panels, with a tab bar that folds them to one at a time on a
     phone. On a wide screen all four stay in view in order and the tabs only
     scroll; the CSS decides which, not this code. */
  var IX_TABS = [
    ['summary', 'Summary & Context'], ['risk', 'Risk & Return'],
    ['bench', 'Benchmark Comparison'], ['data', 'Data Table']
  ];
  function tabbedPanels(panels, haveBench) {
    var bar = '<div class="ixtabs" role="tablist" aria-label="Results">' +
      IX_TABS.map(function (t, i) {
        return '<button type="button" class="ixtab' + (i === 0 ? ' on' : '') + '" role="tab" ' +
          'data-panel="' + t[0] + '" aria-selected="' + (i === 0 ? 'true' : 'false') +
          '" data-always-on="yes">' + t[1] + '</button>';
      }).join('') + '</div>';
    var body = IX_TABS.map(function (t, i) {
      return '<section class="ixpanel' + (i === 0 ? ' on' : '') + '" data-panel="' + t[0] +
        '" role="tabpanel"><h2 class="ixpanel-h">' + t[1] + '</h2>' + panels[t[0]] + '</section>';
    }).join('');
    return bar + body;
  }

  /* Every window as a row: start, end, the fund's figure and, when a
     benchmark is loaded, the benchmark's over the same dates. Folded shut,
     because a daily file has thousands of them. */
  function windowTable(pairs, years, matched, name, compareName) {
    if (!pairs || !pairs.length) return '';
    var byT = {};
    if (matched) matched.forEach(function (m) { byT[m.t] = m.bench; });
    var rows = pairs.map(function (p) {
      return '<tr><td>' + fmtDate(p.t) + '</td><td>' + fmtDate(p.endT) + '</td><td>' +
        pct(p.r) + '</td>' +
        (matched ? '<td>' + (byT[p.t] == null ? '—' : pct(byT[p.t])) + '</td>' : '') +
        '</tr>';
    });
    return '<details class="explain windowlist"><summary>Every ' + years + '-year window, one per row (' +
      pairs.length.toLocaleString() + ')</summary><div class="body"><div class="scroll">' +
      '<table class="data"><thead><tr><th>Window starts</th><th>Window ends</th>' +
      '<th><span class="legend-dot fund"></span>' + esc(name) + '</th>' +
      (matched ? '<th><span class="legend-dot bench"></span>' + esc(compareName) + '</th>' : '') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      (matched ? '<p class="hint" style="margin:.6rem 0 0">A dash means the benchmark file ' +
        'does not cover that window, so nothing is compared there.</p>' : '') +
      '</div></details>';
  }

  /* ===================================== SECTION 5, THE STATISTICAL SUMMARY
   *
   * Eight rows, three columns, in the order the specification sets out. It
   * exists because a single average return says nothing about what had to be
   * lived through to earn it, and because a fund figure with no benchmark
   * beside it cannot be read at all.
   *
   * Both columns come from the SAME windows whenever a benchmark is loaded --
   * compareRolling pairs them by start date -- so every row compares like with
   * like. Reading a fund's best window against a benchmark's best window when
   * the two were measured over different stretches of history is the exact
   * mistake this table is meant to stop, so it is not offered as an option.
   */
  function statisticalSummary(r, years, paired, compareName, calc, compareMeta, mode, key) {
    var have = !!paired;
    var fundPath = mode === 'fund';
    var f = have ? paired.fund : r.stats;
    var b = have ? paired.bench : null;
    var fVals = have ? paired.fundValues : r.values;

    /* Strictly below zero, the same test the rest of the page uses. describe()
       counts anything not above zero, which folds an exactly-flat window in
       with the losses; on this table that would be a different number from the
       one printed six inches further down the same screen. */
    var fNeg = countBelow(fVals);
    var bNeg = have ? countBelow(paired.benchValues) : 0;

    function cell(v) { return v == null ? '&mdash;' : v; }
    function row(label, a, c) {
      return '<tr><td>' + esc(label) + '</td><td>' + cell(a) + '</td><td>' + cell(c) + '</td></tr>';
    }
    function obs(n) { return n.toLocaleString() + ' Observations'; }
    function negCell(count, total) {
      if (!total) return null;
      return pct(count / total, 1) + ' (' + count.toLocaleString() +
             (count === 1 ? ' Window)' : ' Windows)');
    }

    var none = have ? null : '<span class="nodata">No benchmark index data loaded</span>';

    /* On the fund path there is no benchmark column to leave empty: the path
       has no comparison at all, so the table carries the one measured column
       and nothing pretends a second one is waiting. */
    function row1(label, a) {
      return '<tr><td>' + esc(label) + '</td><td>' + cell(a) + '</td></tr>';
    }
    var body = fundPath
      ? row1('Total Rolling Windows Analysed', obs(f.count)) +
        row1('Average Rolling Return (Mean)', pct(f.mean)) +
        row1('Median Rolling Return', pct(f.median)) +
        row1('Maximum Return (Best Window)', pct(f.max)) +
        row1('Minimum Return (Worst Window)', pct(f.min)) +
        row1('Return Volatility (Std Deviation)',
             f.stdev == null ? 'not measurable on one window' : pct(f.stdev)) +
        row1('Negative Return Frequency (Historical)', negCell(fNeg, f.count))
      : row('Total Rolling Windows Analysed', obs(f.count), have ? obs(b.count) : none) +
        row('Average Rolling Return (Mean)', pct(f.mean), have ? pct(b.mean) : none) +
        row('Median Rolling Return', pct(f.median), have ? pct(b.median) : none) +
        row('Maximum Return (Best Window)', pct(f.max), have ? pct(b.max) : none) +
        row('Minimum Return (Worst Window)', pct(f.min), have ? pct(b.min) : none) +
        /* Volatility of the RETURNS, not of the prices: the spread of the
           window figures around their own mean. With one window there is no
           spread to measure and describe() returns null rather than zero. */
        row('Return Volatility (Std Deviation)',
            f.stdev == null ? 'not measurable on one window' : pct(f.stdev),
            have ? (b.stdev == null ? 'not measurable on one window' : pct(b.stdev)) : none) +
        /* "Probability" was the specification's word, and it is the wrong one:
           this row is a count of past windows, and the caveat two inches below
           says outright that nothing on the card is a probability. The label
           now agrees with the caveat. */
        row('Negative Return Frequency (Historical)', negCell(fNeg, f.count),
            have ? negCell(bNeg, b.count) : none) +
        row('Outperformance Rate vs Benchmark',
            have ? pct(paired.fundAheadShare, 1) + ' of total windows'
                 : '<span class="nodata">Not measurable without a benchmark</span>',
            have ? 'N/A' : none) +
        /* Market-index path only: the two ratios, in the table itself and
           against the reader's own target (7% to begin with; the rate box on
           the Risk & Return panel moves them). Marked so the box can find
           them. The fund path's table is left as it was. */
        (fundPath ? '' : ratioRows(fVals, have ? paired.benchValues : null, 0.07, key, none));

    var html = '<div class="card"><h2>Statistical summary</h2>' +
      '<p class="hint" style="margin:0 0 .8rem">' +
      (fundPath
        ? 'Every figure is measured over the same ' + f.count.toLocaleString() +
          ' rolling windows of this fund’s own history. To set these against an index, use ' +
          'the Market index path: the fund in card 1, the index in card 2.'
        : (have
          ? 'Both columns are measured over the same ' + f.count.toLocaleString() +
            ' windows &mdash; the two files joined on the calendar date (YYYY-MM-DD), so each ' +
            'window starts and ends on the same day in both &mdash; and every row ' +
            'compares like with like. Windows outside that shared stretch are not counted on either ' +
            'side.' + carriedPhrase(paired)
          : 'Only the Primary Investment column can be filled in. Load a benchmark index file in ' +
            'card 2 and the second column, and the outperformance row, become measurable.')) +
      '</p><div class="scroll"><table class="data' + (fundPath ? '' : ' summary3') + '">' +
      '<caption>Annualised ' + years + '-year rolling returns, ' +
      esc((E.FREQUENCY[calc.frequency] || E.FREQUENCY.daily).label.toLowerCase()) +
      ' start dates</caption>' +
      (fundPath
        ? '<thead><tr><th>Performance Metric</th><th>This Fund</th></tr></thead><tbody>'
        : '<thead><tr><th>Performance Metric</th><th><span class="legend-dot fund"></span>' +
          'Primary Investment</th>' +
          '<th><span class="legend-dot bench"></span>Benchmark Index</th></tr></thead><tbody>') +
      body +
      '</tbody></table></div>' +
      '<div class="meaning"><h3>How to read this table</h3>' +
      '<p>Every figure is a description of the dates in these files. None of them is a ' +
      'probability, a forecast, or a statement about any fund outside this data. The windows ' +
      'overlap, so they are not independent observations however many of them there are.</p>' +
      /* The outperformance row is the one a price index quietly inflates, and
         it is on this table, so the caveat belongs on this table too rather
         than only on the comparison card further down. */
      (have && compareMeta && compareMeta.kind === 'PRICE'
        ? '<p><strong>The benchmark column excludes dividends.</strong> A fund\u2019s NAV includes ' +
          'them, so the outperformance row overstates the gap by roughly the market\u2019s ' +
          'dividend yield \u2014 about 1 to 1.5 points a year.</p>' : '') +
      (have && compareMeta && compareMeta.kind == null
        ? '<p><strong>It has not been established whether the benchmark counts dividends.</strong> ' +
          'If it does not, the outperformance row overstates the gap by roughly the market\u2019s ' +
          'dividend yield. Say which it is on card 2, Benchmark Index Data.</p>' : '') +
      '</div></div>';
    return html;
  }

  function countBelow(values) {
    var n = 0;
    for (var i = 0; i < values.length; i++) if (values[i] < 0) n++;
    return n;
  }

  /* ==================================== SECTION 5, THE FACTUAL DATA INSIGHTS
   *
   * Five numbered statements, each one a sentence the reader could have
   * written themselves from the table above. That is the whole test: if a
   * sentence here cannot be checked against a number on this screen, it does
   * not belong. Nothing here says whether any of it is good.
   */
  function factualInsights(r, years, paired, compareName, mode) {
    var have = !!paired;
    var fundPath = mode === 'fund';
    var f = have ? paired.fund : r.stats;
    var fVals = have ? paired.fundValues : r.values;
    var loss = countBelow(fVals);
    var total = f.count;
    var items = [];

    /* The fund path has no benchmark by design, so its five statements are
       the five this data can actually support -- none of them a row of
       "not measurable" apologising for a column that was never offered. */
    if (fundPath) {
      items.push(['Return Range &amp; Distribution',
        'Historical ' + years + '-Year rolling returns ranged from ' + pct(f.min) + ' to ' +
        pct(f.max) + ', indicating an overall return variance spread of ' +
        pct(f.max - f.min) + '.']);
      items.push(['Central Tendency',
        'The median ' + years + '-Year rolling return was ' + pct(f.median) +
        ' a year, against a mean of ' + pct(f.mean) +
        '. When the two differ, a few unusual windows are pulling the mean away from the middle.']);
      items.push(['Middle Half of Outcomes',
        'Half of all ' + years + '-Year windows returned between ' + pct(f.p25) + ' and ' +
        pct(f.p75) + ' a year. A quarter fell below that band, and a quarter came in above it.']);
      items.push(['Capital Loss Frequency',
        'In ' + loss.toLocaleString() + ' out of ' + total.toLocaleString() + ' rolling periods (' +
        pct(total ? loss / total : 0, 1) + '), the investment recorded a negative return over a ' +
        years + '-Year holding period.']);
      items.push(['Weakest Window on Record',
        'The weakest ' + years + '-Year window in this data returned ' + pct(f.min) +
        ' a year. To set that against an index, use the Market index path.']);
    } else if (have) {
      items.push(['Outperformance Consistency',
        'Over the selected ' + years + '-Year rolling windows, the investment outperformed the ' +
        'benchmark in ' + pct(paired.fundAheadShare, 1) + ' of all instances (' +
        paired.fundAhead.toLocaleString() + ' out of ' + paired.pairs.toLocaleString() +
        ' rolling periods).']);

      var alpha = f.mean - paired.bench.mean;
      items.push(['Excess Return Profile (Alpha Spread)',
        'The investment generated an average annual return spread of ' +
        A.signedPct(alpha) + ' relative to the benchmark over ' + years + '-Year horizons.']);

      items.push(['Downside Resilience',
        'During the weakest ' + years + '-Year market window, the investment recorded a return ' +
        'of ' + pct(f.min) + ', compared to ' + pct(paired.bench.min) + ' for the benchmark.']);
    } else {
      items.push(['Outperformance Consistency',
        'Not measurable. No benchmark index data is loaded, so there is nothing to have ' +
        'outperformed. Load a Total Return Index file into card 2, Benchmark Index Data.']);
      items.push(['Excess Return Profile (Alpha Spread)',
        'Not measurable without benchmark index data.']);
      items.push(['Downside Resilience',
        'The weakest ' + years + '-Year window in this data returned ' + pct(f.min) +
        '. Without a benchmark there is nothing to set that against.']);
    }

    if (!fundPath) {
      items.push(['Return Range &amp; Distribution',
        'Historical ' + years + '-Year rolling returns ranged from ' + pct(f.min) + ' to ' +
        pct(f.max) + ', indicating an overall return variance spread of ' +
        pct(f.max - f.min) + '.']);

      items.push(['Capital Loss Frequency',
        'In ' + loss.toLocaleString() + ' out of ' + total.toLocaleString() + ' rolling periods (' +
        pct(total ? loss / total : 0, 1) + '), the investment recorded a negative return over a ' +
        years + '-Year holding period.']);
    }

    return '<div class="card"><h2>Factual Data Insights</h2>' +
      '<p class="hint" style="margin:0 0 .8rem">Five statements, each one checkable against the ' +
      'table above. None of them says whether any of it is good.</p>' +
      '<ol class="insights">' +
      items.map(function (it) {
        return '<li><span class="ins-h">' + it[0] + '</span><span class="ins-b">' + it[1] +
               '</span></li>';
      }).join('') +
      '</ol>' +
      '<div class="meaning"><h3>What these are not</h3>' +
      '<p>These are descriptions of what this data did, not advice about what to do. Whether any ' +
      'of it suits you depends on your goal, your horizon, what else you own and what you can sit ' +
      'through &mdash; none of which this tool knows.</p></div></div>';
  }

  /* ------------------------------------------------------------- the summary
   *
   * Three measured rates and nothing else. Every figure here is a count over
   * the windows in front of the reader, divided by how many windows there were,
   * and each one says what it counted so the reader can check the arithmetic
   * rather than take the label on trust.
   *
   * What this card must never become: a verdict. "Consistent enough to hold",
   * "strong track record", "consider adding" are all sentences about a decision
   * this tool cannot see -- it does not know the reader's goal, horizon, what
   * else they own or what they can sit through. So the card reports rates and
   * stops, and the note under it says the one thing a run of good windows most
   * tempts a reader to forget. */
  function summaryCard(r, s, series, years, below, compareSeries, compareName, calc, indexPath) {
    var n = s.count;
    var success = n ? (n - below) / n : 0;

    /* Downside risk, two ways, because they answer different questions:
     * how OFTEN a window ended below zero, and how BAD it got at the worst --
     * both the worst window's own rate and the deepest fall along the way,
     * which is what had to be sat through rather than what was earned. */
    var dd = E.maxDrawdown(series);

    /* Section 6's copy guide, now on BOTH paths. "Success rate" and "downside
       risk" were the fund path's old labels, and the objection to them is not
       path-specific: a rate of windows that ended above zero is not success,
       and the worst window is not the risk. The replacements say what is
       counted, wherever it is counted. */
    var SAY = { above: 'Windows ending above zero',
                out:   'Outperformance Frequency (%)',
                worst: 'Minimum Rolling Return' };

    var rows = [
      [SAY.above, pct(success, 0),
       (n - below).toLocaleString() + ' of ' + n.toLocaleString() + ' ' + years +
       '-year windows ended above zero.']
    ];

    if (compareSeries) {
      var c = E.compareRolling(series, compareSeries, years, calc || {});
      rows.push(c.ok
        ? [SAY.out, pct(c.fundAheadShare, 0),
           'Ahead of ' + esc(compareName) + ' in ' + c.fundAhead.toLocaleString() + ' of ' +
           c.pairs.toLocaleString() + ' windows both sets of data cover.']
        : [SAY.out, 'not measured', esc(c.message)]);
    } else {
      rows.push([SAY.out, 'not measured',
                 indexPath
                   ? 'No benchmark is loaded. Load one into card 2, Benchmark Index Data, ' +
                     'and this becomes a rate.'
                   : 'This path analyses the fund on its own. To measure it against an index, ' +
                     'use the Market index path: the fund in card 1, the index in card 2.']);
    }

    rows.push([SAY.worst, pct(s.min),
               'The worst of these windows returned ' + pct(s.min) + ' a year. ' +
               below.toLocaleString() + ' of ' + n.toLocaleString() + ' ended below zero' +
               (dd.ok ? ', and the deepest fall along the way was ' + pct(dd.depth) + '.' : '.')]);

    return '<div class="card"><h2>The record, as three rates</h2>' +
      '<p class="hint" style="margin:0 0 .8rem">Each figure is a count over the ' +
      n.toLocaleString() + ' windows above, divided by how many there were. The third column says ' +
      'what was counted.</p>' +
      '<div class="scroll"><table class="data"><thead><tr><th>Measure</th><th>Over these ' + years +
      '-year windows</th><th>What that counts</th></tr></thead><tbody>' +
      rows.map(function (row) {
        return '<tr><td>' + esc(row[0]) + '</td><td><strong>' + esc(row[1]) + '</strong></td><td>' +
          row[2] + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="meaning"><h3>What these three rates are not</h3>' +
      '<p><strong>Past historical consistency does not guarantee future results.</strong> A high ' +
      'figure on any of these rows is a description of the dates in this file and no others. It ' +
      'is not a probability, because the future is not drawn from this file, and the windows ' +
      'counted here overlap, so they are not independent samples of anything.</p>' +
      '<p>Nothing on this card is a recommendation to buy, hold, sell or switch. Whether any of it ' +
      'suits you depends on your goal, your horizon, what else you own and what you can sit ' +
      'through &mdash; none of which this tool knows.</p></div></div>';
  }

  /* ============================= THE SPREAD, ACROSS HOLDING PERIODS
   *
   * The claim the whole rolling screen makes is that the length of the hold
   * changes the range of outcomes more than anything else a reader controls.
   * One horizon at a time, they have to take that on trust; side by side,
   * they can watch the worst column climb as the periods lengthen -- or see
   * that in this particular data it does not, which is just as much worth
   * knowing. Every row is the same arithmetic as the headline, at a different
   * length. */
  /* The per-horizon window values, kept so the Beat-your-target column can
     recompute live when the reader edits the rate box below the table. */
  var HORIZON_DATA = {};

  function horizonSpreadCard(series, chosenYears, calc, xopts) {
    var x = xopts || {};
    var spanYears = (series[series.length - 1].t - series[0].t) / (365.2425 * 86400000);
    var horizons = A.HORIZONS.slice();
    var m = E.maxHorizon ? E.maxHorizon(series) : null;
    if (m !== null && horizons.indexOf(m) === -1) horizons.push(m);
    horizons.sort(function (a, b) { return a - b; });

    var rows = [];
    horizons.forEach(function (h) {
      if (h > spanYears) return;
      var r = E.rollingReturns(series, h, calc);
      if (!r.ok || r.stats.count < 3) return;
      rows.push({ h: h, s: r.stats, values: r.values });
    });
    if (rows.length < 2) return '';

    if (!x.extended) {
      return '<div class="card"><h2>The same data, held for longer</h2>' +
        '<p class="hint" style="margin:0 0 .8rem">Every row is every holding period of that ' +
        'length in this data — the same arithmetic as above, at other lengths. Read the ' +
        'Worst column downwards.</p>' +
        '<div class="scroll"><table class="data spread">' +
        '<caption>Annualised return, % a year, by holding period</caption>' +
        '<thead><tr><th>Held for</th><th>Worst</th><th>Median</th><th>Best</th>' +
        '<th>Spread</th></tr></thead><tbody>' +
        rows.map(function (row) {
          var em = row.h === chosenYears;
          return '<tr' + (em ? ' class="now"' : '') + '><td>' + row.h +
            (row.h === 1 ? ' year' : ' years') + (em ? ' ← chosen' : '') + '</td>' +
            '<td>' + pct(row.s.min) + '</td><td>' + pct(row.s.median) + '</td>' +
            '<td>' + pct(row.s.max) + '</td>' +
            '<td>' + pct(row.s.max - row.s.min) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="meaning"><h3>What this means</h3>' +
        '<p>Each figure describes the periods of that length inside this one file. Where the ' +
        'Worst column rises as the holding period grows, longer holds narrowed the range of ' +
        'outcomes <em>in this data</em>; that is a description of these dates, not a law, and ' +
        'not a promise about the next period of any length.</p></div></div>';
    }

    /* The reviewer's matrix, without the word they used for it: these are
       shares of past windows, never odds. The Beat-your-target column follows
       the rate box live, so the whole matrix answers the reader's own number
       rather than one this tool picked. */
    HORIZON_DATA[x.key || 'rolling'] = rows.map(function (row) {
      return { h: row.h, values: row.values };
    });
    var startRate = 0.07;
    /* The benchmark at every horizon, over the windows both files cover, so
       the fan chart can draw its median beside the fund's. */
    var benchRows = {};
    if (x.compare) {
      rows.forEach(function (row) {
        var c = E.compareRolling(series, x.compare, row.h, calc);
        if (c.ok && c.pairs >= 3) benchRows[row.h] = c.bench;
      });
    }
    return '<div class="card"><h2>The same data, held for longer</h2>' +
      fanChart(rows, benchRows, chosenYears, x.key || 'rolling', x.compareName) +
      '<p class="hint" style="margin:0 0 .8rem">Every row is every holding period of that ' +
      'length in this data — the same arithmetic as above, at other lengths. The 10th and ' +
      '90th columns are the outer tenths: 8 of every 10 windows of that length ended between ' +
      'them. <strong>Ended below zero</strong> and <strong>Beat your target</strong> are ' +
      'shares of past windows, not odds — and the target column follows the rate you set ' +
      'in the box below.</p>' +
      '<div class="scroll"><table class="data spread hmatrix">' +
      '<caption>Annualised return, % a year, by holding period</caption>' +
      '<thead><tr><th>Held for</th><th>Worst</th><th>10th pct</th><th>Median</th>' +
      '<th>90th pct</th><th>Best</th><th>Ended below zero</th>' +
      '<th>Beat your target</th></tr></thead><tbody>' +
      rows.map(function (row) {
        var em = row.h === chosenYears;
        var belowZero = countBelow(row.values);
        var beat = E.shareAbove(row.values, startRate);
        return '<tr' + (em ? ' class="now"' : '') + '><td>' + row.h +
          (row.h === 1 ? ' year' : ' years') + (em ? ' ← chosen' : '') + '</td>' +
          '<td>' + pct(row.s.min) + '</td><td>' + pct(row.s.p10) + '</td>' +
          '<td>' + pct(row.s.median) + '</td><td>' + pct(row.s.p90) + '</td>' +
          '<td>' + pct(row.s.max) + '</td>' +
          '<td>' + pct(belowZero / row.s.count, 0) + '</td>' +
          '<td data-beat-h="' + row.h + '" data-key="' + esc(x.key || 'rolling') + '">' +
          (beat.ok ? pct(beat.share, 0) : '—') + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p class="hint" style="margin:.5rem 0 0">Longer horizons hold fewer windows, and all ' +
      'of them overlap; each row describes only the periods of that length inside this one ' +
      'file.</p>' +
      '<div class="meaning"><h3>What this means</h3>' +
      '<p>Where the Worst column rises and the gap between the 10th and 90th columns narrows ' +
      'as the holding period grows, longer holds narrowed the range of outcomes <em>in this ' +
      'data</em>; that is a description of these dates, not a law, and not a promise about ' +
      'the next period of any length.</p></div></div>';
  }

  /* The horizon table as a shape: holding period across, annualised return
     up, the 10th-to-90th band shaded and the median drawn through it. The
     band is expected to narrow to the right; whether it does in THIS data is
     what the chart is for. A tap or hover on a horizon prints its three
     figures beneath. Market-index path only. */
  function fanChart(rows, benchRows, chosenYears, key, compareName) {
    if (!rows || rows.length < 2) return '';
    var W = 640, H = 250, padL = 46, padR = 16, padT = 14, padB = 34;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var lo = 0, hi = 0;
    rows.forEach(function (row) {
      lo = Math.min(lo, row.s.p10, row.s.min); hi = Math.max(hi, row.s.p90, row.s.max);
      var b = benchRows[row.h];
      if (b) { lo = Math.min(lo, b.p10); hi = Math.max(hi, b.p90); }
    });
    var span = hi - lo || 1;
    lo -= span * 0.08; hi += span * 0.08; span = hi - lo;
    var h0 = rows[0].h, h1 = rows[rows.length - 1].h;
    var chosen = rows.filter(function (row) { return row.h === chosenYears; })[0] || rows[0];
    function x(h) { return h1 === h0 ? padL : padL + (h - h0) / (h1 - h0) * innerW; }
    function y(v) { return padT + (hi - v) / span * innerH; }
    function pt(h, v) { return x(h).toFixed(1) + ',' + y(v).toFixed(1); }

    var parts = [];
    /* horizontal guides at round percentages */
    var stepPct = span > 0.6 ? 0.1 : span > 0.3 ? 0.05 : 0.02;
    for (var g = Math.ceil(lo / stepPct) * stepPct; g <= hi; g += stepPct) {
      var gy = y(g).toFixed(1);
      parts.push('<line class="grid" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>');
      parts.push('<text class="axis" x="' + (padL - 6) + '" y="' + (y(g) + 4).toFixed(1) +
        '" text-anchor="end">' + Math.round(g * 100) + '%</text>');
    }
    if (lo < 0 && hi > 0) {
      parts.push('<line class="rl-zero" x1="' + padL + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - padR) +
        '" y2="' + y(0).toFixed(1) + '"/>');
    }
    /* the fund's band, then its median on top */
    var upper = rows.map(function (row) { return pt(row.h, row.s.p90); });
    var lower = rows.slice().reverse().map(function (row) { return pt(row.h, row.s.p10); });
    parts.push('<polygon class="fan-band fund" points="' + upper.concat(lower).join(' ') + '"/>');
    parts.push('<polyline class="fan-line fund" points="' +
      rows.map(function (row) { return pt(row.h, row.s.median); }).join(' ') + '"/>');
    var withBench = rows.filter(function (row) { return !!benchRows[row.h]; });
    if (withBench.length >= 2) {
      parts.push('<polyline class="fan-edge bench" points="' +
        withBench.map(function (row) { return pt(row.h, benchRows[row.h].p90); }).join(' ') + '"/>');
      parts.push('<polyline class="fan-edge bench" points="' +
        withBench.map(function (row) { return pt(row.h, benchRows[row.h].p10); }).join(' ') + '"/>');
      parts.push('<polyline class="fan-line bench" points="' +
        withBench.map(function (row) { return pt(row.h, benchRows[row.h].median); }).join(' ') + '"/>');
    }
    /* one marker and one hit area per horizon */
    rows.forEach(function (row, i) {
      var cx = x(row.h);
      var left = i === 0 ? padL : (x(rows[i - 1].h) + cx) / 2;
      var right = i === rows.length - 1 ? W - padR : (x(rows[i + 1].h) + cx) / 2;
      var b = benchRows[row.h];
      parts.push('<circle class="fan-dot fund' + (row.h === chosenYears ? ' now' : '') + '" cx="' +
        cx.toFixed(1) + '" cy="' + y(row.s.median).toFixed(1) + '" r="4"/>');
      parts.push('<text class="axis" x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' +
        row.h + 'y</text>');
      parts.push('<rect class="fan-hit" data-fan-h="' + row.h + '" data-key="' + esc(key) +
        '" data-p10="' + pct(row.s.p10) + '" data-med="' + pct(row.s.median) + '" data-p90="' + pct(row.s.p90) +
        '" data-n="' + row.s.count + '"' +
        (b ? ' data-b10="' + pct(b.p10) + '" data-bmed="' + pct(b.median) + '" data-b90="' + pct(b.p90) + '"' : '') +
        ' x="' + left.toFixed(1) + '" y="' + padT + '" width="' + (right - left).toFixed(1) +
        '" height="' + innerH + '" tabindex="0" role="button" aria-label="' + row.h +
        '-year horizon: 10th ' + pct(row.s.p10) + ', median ' + pct(row.s.median) + ', 90th ' +
        pct(row.s.p90) + '"><title>' + row.h + ' years: 10th ' + pct(row.s.p10) + ' · median ' +
        pct(row.s.median) + ' · 90th ' + pct(row.s.p90) + '</title></rect>');
    });
    parts.push('<text class="axis" x="' + (padL + innerW / 2) + '" y="' + (H - 1) +
      '" text-anchor="middle">Holding period, years</text>');

    return '<figure class="chart fanchart"><figcaption>Annualised return by holding period: the ' +
      'shaded band runs from the 10th to the 90th percentile, the line through it is the median' +
      (withBench.length >= 2 ? '; dashed, ' + esc(compareName) + ' over the windows both files cover' : '') +
      '. Tap or hover a horizon for its figures.</figcaption>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Fan chart of ' +
      'rolling returns by holding period">' + parts.join('') + '</svg>' +
      '<div class="legend"><span class="key"><span class="legend-dot fund"></span>Primary Investment ' +
      '(band and median)</span>' +
      (withBench.length >= 2 ? '<span class="key"><span class="legend-dot bench"></span>' +
        esc(compareName) + ' (dashed)</span>' : '') + '</div>' +
      '<p class="hint fan-readout" id="fanout-' + esc(key) + '" aria-live="polite">' +
      fanReadout(chosen.h, chosen.s.p10, chosen.s.median, chosen.s.p90, chosen.s.count,
                 benchRows[chosen.h], compareName) + '</p></figure>';
  }

  /* Figures arrive as numbers from the card and as already-formatted strings
     from the hit area's data attributes; both print the same way. */
  function fanReadout(h, p10, med, p90, n, b, compareName) {
    function f(v) { return typeof v === 'number' ? pct(v) : v; }
    var text = h + (+h === 1 ? ' year' : ' years') + ': 10th percentile ' + f(p10) + ' · median ' + f(med) + ' · 90th percentile ' +
      f(p90) + ' (' + Number(n).toLocaleString() + ' windows)';
    if (b) text += ' — ' + (compareName || 'benchmark') + ': 10th ' + f(b.p10) + ' · median ' +
      f(b.median) + ' · 90th ' + f(b.p90);
    return text;
  }

  /* The worst window in a file is only the worst of the years the file covers.
   * A history that begins after a crash has never been measured through one. */
  function worstIsNotWorstCard(series, s, years) {
    var firstT = series[0].t;
    var first = new Date(firstT);
    var startsAfter2008 = firstT > Date.UTC(2009, 5, 1);
    return '<div class="card"><h2>The worst here is not the worst possible</h2>' +
      '<p style="margin:0 0 .7rem;color:var(--ink-2)">The lowest figure on this page, ' +
      '<strong>' + pct(s.min) + ' a year</strong>, is the worst this data has ever produced over ' +
      years + ' years. It is not a floor. It is the worst of the years this file happens to cover, ' +
      'which begin on ' + fmtDate(firstT) + '.</p>' +
      (startsAfter2008
        ? '<p style="margin:0;color:var(--ink-2)">This history begins after the crash of 2008, so it ' +
          'has never been measured through that fall. Its worst window is the worst of a kinder era. ' +
          'Treat the figure above as the worst <em>so far</em>, not the worst there is.</p>'
        : '<p style="margin:0;color:var(--ink-2)">This history reaches back far enough to include the ' +
          'crash of 2008, so the worst figure above has been tested against one of the deepest falls ' +
          'this market has produced.</p>');
  }

  /* Four ways a published return misleads without anyone lying. Straight from
   * the chapter, because a reader who knows these cannot be sold with them. */
  /* Review v4 §12.12: the four traps, in full, with the March 2020 worked
   * example. All of it could have been written before the reader arrived, so
   * all of it is the book's. Section 4 gives this pointer verbatim. */
  function trapsCard(years) {
    return '<p class="hint pointer">Chapter 13, Section 2, the traps.</p>';
  }

  function startDateCard(r, years) {
    var spread = r.best.r - r.worst.r;
    return '<div class="card"><h2>Would it still look this way if you had started elsewhere?</h2>' +
      '<div class="scroll"><table class="data"><thead><tr><th></th><th>Starting on</th>' +
      '<th>Held until</th><th>You would have got</th></tr></thead><tbody>' +
      '<tr><td><strong>Best start</strong></td><td>' + fmtDate(r.best.t) + '</td><td>' +
      fmtDate(r.best.endT) + '</td><td>' + pct(r.best.r) + ' a year</td></tr>' +
      '<tr><td><strong>Worst start</strong></td><td>' + fmtDate(r.worst.t) + '</td><td>' +
      fmtDate(r.worst.endT) + '</td><td>' + pct(r.worst.r) + ' a year</td></tr>' +
      '</tbody></table></div>' +
      '<div class="meaning"><h3>What this means</h3>' +
      '<p>Both investors held for the same ' + years + ' years, in the same market. The only ' +
      'difference between them was the day they started, and that difference is worth <strong>' +
      pct(spread) + ' a year</strong>.</p>' +
      '<p>Nobody chooses their starting day on purpose. It is worth knowing how much of any ' +
      'headline return was decided by it.</p></div></div>';
  }

  /* A return says what was earned. This says what had to be sat through. */
  function drawdownCard(series, years, indexPath, worstWindow) {
    var dd = E.maxDrawdown(series);
    if (!dd.ok || dd.depth === 0) return '';
    var fallMonths = dd.fallDays != null ? Math.round(dd.fallDays / 30) : null;
    var recMonths = dd.recoveryDays != null ? Math.round(dd.recoveryDays / 30) : null;
    var html = '<div class="card"><h2>The worst fall along the way' +
      (indexPath ? ' (peak to trough)' : '') + '</h2>' +
      /* Two metrics, two rows, named apart: the worst full window's
         annualised result, and the deepest fall in the value itself with
         how long it took to fall and to climb back. */
      (indexPath && worstWindow != null
        ? '<div class="scroll"><table class="data ddtwo">' +
          '<caption>Two different measurements of the worst of it</caption>' +
          '<thead><tr><th>Metric</th><th>Figure</th><th>What it measures</th></tr></thead><tbody>' +
          '<tr><td>Worst Rolling Return Window (%)</td><td><strong>' + pct(worstWindow) +
          ' a year</strong></td><td>The start-to-end annualised result of the single worst full ' +
          years + '-year holding period.</td></tr>' +
          '<tr><td>Peak-to-Trough NAV Drawdown</td><td><strong>Max decline ' + pct(dd.depth) +
          '</strong> · fall duration ' + (fallMonths != null ? fallMonths + ' months' : '—') +
          ' · recovery time ' + (recMonths != null ? recMonths + ' months' : 'not yet in this data') +
          '</td><td>The deepest fall in the daily value from any high to the low that followed, ' +
          'anywhere in the selected stretch, and the time it took to fall and to regain the old high.' +
          '</td></tr></tbody></table></div>'
        : '') +
      /* The reviewer's confusion, answered where it arises: this figure and
         the Minimum Rolling Return above it measure two different things, and
         a card that does not say so invites reading one as the other. The
         triplet — depth, fall, recovery — is here because a fall that
         recovers in a month and one that takes three years are different
         experiences hiding behind the same percentage. */
      (indexPath
        ? '<p class="hint" style="margin:0 0 .8rem">This is the deepest ' +
          '<strong>peak-to-trough fall in the daily value itself</strong>, anywhere in the ' +
          'selected stretch — a different measurement from the Minimum Rolling Return above, ' +
          'which is the start-to-end result of the worst full ' + years + '-year window. A ' +
          'value can fall steeply inside a window that still ends positive.</p>'
        : '') +
      '<div class="stats">' +
      stat('Deepest fall', pct(dd.depth)) +
      (indexPath
        ? stat('The fall took', dd.fallDays != null ? Math.round(dd.fallDays / 30) + ' months' : '—') +
          stat('Recovery took', dd.recoveryDays != null
            ? Math.round(dd.recoveryDays / 30) + ' months' : 'not yet in this data') +
          stat('It began', fmtDate(dd.from.t))
        : stat('It began', fmtDate(dd.from.t)) +
          stat('It bottomed', fmtDate(dd.to.t))) +
      stat('Back to the old high', dd.recoveredOn ? fmtDate(dd.recoveredOn) : 'not yet in this data') +
      '</div>';
    html += '<div class="meaning"><h3>What this means</h3>';
    if (dd.recoveredOn) {
      html += '<p>Anyone holding through this watched <strong>' + pct(-dd.depth) + '</strong> of their ' +
        'money disappear over ' + Math.round(dd.fallDays / 30) + ' months, and waited a further <strong>' +
        Math.round(dd.recoveryDays / 30) + ' months</strong> just to get back to where they had already been.</p>';
    } else {
      html += '<p>The fall of <strong>' + pct(-dd.depth) + '</strong> had not been recovered by the end ' +
        'of this data.</p>';
    }
    /* The reviewer's point, and a good one: a depth in percent tests nothing.
       A reader has to put THEIR money at the bottom of it and ask whether
       they could have stayed. Same figures, priced in rupees, ended with the
       one question the record actually puts. */
    var bottom = Math.round(10000 * (1 + dd.depth));
    html += '<p>Priced plainly: every \u20b910,000 held through this was worth about ' +
      '<strong>\u20b9' + bottom.toLocaleString('en-IN') + '</strong> at the bottom' +
      (dd.recoveredOn
        ? ', and took until ' + fmtDate(dd.recoveredOn) + ' to be \u20b910,000 again'
        : ', and had not got back to \u20b910,000 by the end of this data') + '.</p>' +
      '<p><strong>The question to ask yourself before any return figure:</strong> if this ' +
      'fall began the month after you invested, would anything \u2014 a fee due, a purchase ' +
      'planned, your own nerve \u2014 force you to take the money out before it climbed back? ' +
      'Whoever sells at the bottom turns this dip into their permanent result.</p>';
    if (dd.recoveredOn && years) {
      var underwaterMonths = Math.round((dd.fallDays + dd.recoveryDays) / 30);
      if (underwaterMonths > 0 && years * 12 <= underwaterMonths) {
        html += '<p><strong>Your chosen ' + years + '-year holding period is not longer than ' +
          'this fall-and-recovery (' + underwaterMonths + ' months).</strong> A hold of that ' +
          'length starting on a day like ' + fmtDate(dd.from.t) + ' would have ended before ' +
          'the money was whole again.</p>';
      }
    }
    html += '<p>Returns are earned by the people who were still there afterwards. This is the part ' +
      'of the record that decides who those people are.</p></div></div>';
    return html;
  }

  /* The reader names the rate. The screen reports arithmetic on the data above
   * and nothing else -- no product, no promise, no comparison anybody has to
   * take on trust. */
  /* Excess over the reader's own mark, per unit of spread. The official
     Sharpe and Sortino ratios divide excess over a RISK-FREE rate; this tool
     does not know today's risk-free rate and will not invent one, so the
     reference here is the target the reader typed, and the labels say
     "-style" because they are that and not the textbook figure. */
  function ratioLine(values, rate) {
    if (!values || values.length < 2 || !isFinite(rate)) return '';
    var mean = 0;
    for (var i = 0; i < values.length; i++) mean += values[i];
    mean /= values.length;
    var acc = 0;
    for (var j = 0; j < values.length; j++) {
      var d = values[j] - mean;
      acc += d * d;
    }
    var sd = Math.sqrt(acc / (values.length - 1));
    var ddv = E.downsideDeviation(values, rate);
    var bits = [];
    if (sd > 0) bits.push('per unit of volatility (Sharpe-style): <strong>' +
      ((mean - rate) / sd).toFixed(2) + '</strong>');
    if (ddv != null) {
      bits.push(ddv === 0
        ? 'no window fell below it, so downside deviation is zero (Sortino-style: not defined)'
        : 'per unit of downside deviation below it (Sortino-style): <strong>' +
          ((mean - rate) / ddv).toFixed(2) + '</strong>');
    }
    if (!bits.length) return '';
    return 'Average excess over your target, ' + bits.join(' · ') +
      '. Positive means the average window cleared your target; the size says by how much ' +
      'relative to how unevenly the windows landed. The official Sharpe and Sortino ratios ' +
      'use a risk-free rate this tool does not know; your target stands in for it here.';
  }

  /* The same two ratios as numbers, for a table cell. null where the
     spread that divides them is zero or there are too few windows. */
  function ratioPair(values, rate) {
    if (!values || values.length < 2 || !isFinite(rate)) return { sharpe: null, sortino: null };
    var mean = 0;
    for (var i = 0; i < values.length; i++) mean += values[i];
    mean /= values.length;
    var acc = 0;
    for (var j = 0; j < values.length; j++) { var d = values[j] - mean; acc += d * d; }
    var sd = Math.sqrt(acc / (values.length - 1));
    var ddv = E.downsideDeviation(values, rate);
    /* A spread below a millionth of a percentage point is rounding noise on
       a flat series, and dividing by it prints a seven-digit ratio. */
    var EPS = 1e-8;
    return {
      sharpe: sd > EPS ? (mean - rate) / sd : null,
      sortino: ddv != null && ddv > EPS ? (mean - rate) / ddv : null
    };
  }

  /* The window values behind every ratio cell on the page, by key, so the
     rate box can recompute the cells when the target changes. */
  var RATIO_DATA = {};

  function ratioText(v) { return v == null ? 'not defined' : v.toFixed(2); }

  function ratioCell(which, side, key, v) {
    return '<td data-ratio="' + which + '" data-side="' + side + '" data-key="' + esc(key || '') +
      '">' + ratioText(v) + '</td>';
  }

  /* Two table rows -- Sharpe and Sortino against the reader's target -- for
     a three-column table (label, fund, benchmark). The benchmark cell shows
     the no-benchmark marker when there is none. */
  function ratioRows(fVals, bVals, rate, key, none) {
    RATIO_DATA[key || 'rolling'] = { fund: fVals, bench: bVals || null };
    var f = ratioPair(fVals, rate), b = bVals ? ratioPair(bVals, rate) : null;
    return '<tr><td>Sharpe Ratio (vs your target)</td>' + ratioCell('sharpe', 'fund', key, f.sharpe) +
      (b ? ratioCell('sharpe', 'bench', key, b.sharpe) : '<td>' + none + '</td>') + '</tr>' +
      '<tr><td>Sortino Ratio (vs your target)</td>' + ratioCell('sortino', 'fund', key, f.sortino) +
      (b ? ratioCell('sortino', 'bench', key, b.sortino) : '<td>' + none + '</td>') + '</tr>';
  }

  /* The same two rows for a table that also carries a Difference column. */
  function ratioRowsDelta(fVals, bVals, rate, key) {
    var f = ratioPair(fVals, rate), b = ratioPair(bVals, rate);
    function delta(a, c) {
      return '<td data-ratio-delta="1">' + (a == null || c == null ? '—' :
        (a - c >= 0 ? '+' : '') + (a - c).toFixed(2)) + '</td>';
    }
    return '<tr><td>Sharpe Ratio (vs your target)</td>' + ratioCell('sharpe', 'fund', key, f.sharpe) +
      ratioCell('sharpe', 'bench', key, b.sharpe) + delta(f.sharpe, b.sharpe) + '</tr>' +
      '<tr><td>Sortino Ratio (vs your target)</td>' + ratioCell('sortino', 'fund', key, f.sortino) +
      ratioCell('sortino', 'bench', key, b.sortino) + delta(f.sortino, b.sortino) + '</tr>';
  }

  /* Recompute every ratio cell that carries this key, after the target moved. */
  function refreshRatioCells(key, rate) {
    var data = RATIO_DATA[key];
    if (!data) return;
    var f = ratioPair(data.fund, rate), b = data.bench ? ratioPair(data.bench, rate) : null;
    $$('[data-ratio][data-key="' + key + '"]').forEach(function (cell) {
      var side = cell.dataset.side === 'bench' ? b : f;
      if (!side) return;
      cell.textContent = ratioText(side[cell.dataset.ratio]);
      var next = cell.nextElementSibling;
      if (cell.dataset.side === 'bench' && next && next.dataset.ratioDelta) {
        var a = f[cell.dataset.ratio], c = b ? b[cell.dataset.ratio] : null;
        next.textContent = a == null || c == null ? '—' : (a - c >= 0 ? '+' : '') + (a - c).toFixed(2);
      }
    });
  }

  /* How many dates each file had filled in from its previous value when the
     two were joined on the calendar. Said only when it happened. */
  function carriedPhrase(paired) {
    if (!paired || paired.join !== 'calendar') return '';
    var fa = paired.filledFund || 0, fb = paired.filledBench || 0;
    if (!fa && !fb) return ' Every date in the shared stretch appears in both files; nothing was filled in.';
    return ' Where one file had a date the other lacked, the missing value was carried forward ' +
      'from that file’s previous date: ' + fa.toLocaleString() + (fa === 1 ? ' date' : ' dates') +
      ' in the Primary Investment file and ' + fb.toLocaleString() + (fb === 1 ? ' date' : ' dates') +
      ' in the Benchmark Index file.';
  }

  function rateCheckCard(key, years, values, indexPath) {
    var start = 0.07;
    var res = E.shareAbove(values, start);
    var ratios = indexPath ? ratioLine(values, start) : '';
    return '<div class="card"><h2>How often did it beat a rate you choose?</h2>' +
      '<p class="hint" style="margin:0 0 .8rem">Type your own target \u2014 the return you need, ' +
      'a deposit rate you could get instead, your own guess at inflation plus a margin \u2014 ' +
      'or start from one of these. The target is YOURS: this tool does not know today\u2019s ' +
      'deposit rates or inflation, and does not pretend to.</p>' +
      /* Round numbers, not recommendations: a preset here is a button that
         types for you, and the copy above says whose number it has to be. */
      '<div class="chips ratepresets" data-key="' + key + '">' +
      [6, 8, 10, 12].map(function (r) {
        return '<button class="chip" type="button" data-rate="' + r + '">' + r + '%</button>';
      }).join('') +
      '</div>' +
      '<div class="field" style="max-width:16rem">' +
      '<label for="rate-' + key + '">Rate to compare against, % a year</label>' +
      '<input type="number" id="rate-' + key + '" class="ratecheck" data-key="' + key +
      '" data-years="' + years + '" value="7" step="0.5" min="-50" max="100" inputmode="decimal">' +
      '</div>' +
      '<div class="result" style="margin:.6rem 0 0"><div class="label">Periods that beat it</div>' +
      '<div class="value" id="rateout-' + key + '">' + pct(res.share, 0) + '</div>' +
      '<div class="sub" id="ratesub-' + key + '">' + rateSentence(res, start, years) + '</div></div>' +
      (indexPath
        ? '<p class="hint ratioline" id="ratio-' + key + '" data-key="' + key + '">' +
          ratios + '</p>'
        : '') +
      '<div class="meaning"><h3>Read this carefully</h3>' +
      '<p>You chose that rate, so this is arithmetic on the data above and nothing more. It is not a ' +
      'comparison with any particular product, and it says nothing about what a deposit, a bond or any ' +
      'other investment actually paid over these dates.</p>' +
      '<p>The figures are before tax and before costs, on both sides of the comparison. Periods overlap, ' +
      'and none of this is a statement about what comes next.</p></div></div>';
  }

  function rateSentence(res, rate, years) {
    if (!res.ok) return '';
    /* The reviewer's own wording, which is right: a share of past periods,
       stated as exactly that. */
    return 'In ' + pct(res.share, 0) + ' of the ' + years + '-year holding periods in this ' +
      'data (' + res.above.toLocaleString() + ' of ' + res.count.toLocaleString() +
      '), the return beat your target of ' + pct(rate, 1) + ' a year. Past periods, not ' +
      'future odds.';
  }

  /* ================================================= WHICH KIND OF THING IS IT
   *
   * A corporate bond fund measured against Nifty 50 TRI produces a gap that
   * mostly measures the asset classes, not the fund -- and a reader who does
   * not know that walks away convinced a debt fund is a terrible investment
   * because it "lost" to equities by six points a year. The names usually say
   * which class each side is, so when they say two different things, the
   * screen says so before any gap is printed. Read from the names only, and
   * said to be: a name can lie, and the note says what to do when it does. */
  var CLASS_WORDS = [
    ['debt', /\b(bond|debt|gilt|g[\s-]?sec|liquid|overnight|money\s*market|ultra\s*short|low\s*duration|short\s*duration|medium\s*duration|long\s*duration|dynamic\s*bond|corporate\s*bond|credit\s*risk|banking\s*(&|and)\s*psu|floater|floating\s*rate|treasury|arbitrage|savings\s*fund|income\s*fund|fixed\s*income|crisil\s*composite)\b/i],
    ['gold', /\b(gold|silver|commodit)\w*\b/i],
    ['equity', /\b(nifty|sensex|equity|flexi[\s-]?cap|multi[\s-]?cap|large[\s-]?cap|mid[\s-]?cap|small[\s-]?cap|elss|bluechip|blue[\s-]?chip|focused|value\s*fund|contra|dividend\s*yield|next\s*50|midcap|smallcap|opportunities)\b/i]
  ];

  function assetClassOf(name) {
    var n = String(name || '');
    for (var i = 0; i < CLASS_WORDS.length; i++) {
      if (CLASS_WORDS[i][1].test(n)) return CLASS_WORDS[i][0];
    }
    return null;
  }

  /* Where a name says nothing, the series itself can: annualised volatility
     of the value at or below 6% a year reads as fixed income, at or above
     12% as equity. Between the two the series is silent and only a name can
     decide. The thresholds are the review's. */
  var DEBT_SIGMA = 0.06, EQUITY_SIGMA = 0.12;

  function classFromSigma(series) {
    if (!series || !E.annualisedVolatility) return null;
    var v = E.annualisedVolatility(series);
    if (!v.ok) return null;
    return { sigma: v.sigma,
             cls: v.sigma <= DEBT_SIGMA ? 'debt' : v.sigma >= EQUITY_SIGMA ? 'equity' : null };
  }

  function sigmaPhrase(label, sig) {
    return '<strong>' + esc(label) + '</strong> moved with an annualised volatility of ' +
      pct(sig.sigma, 1) + ', which ' +
      (sig.cls === 'debt' ? 'is at or below the 6% mark for a fixed-income series'
        : sig.cls === 'equity' ? 'is at or above the 12% mark for an equity series'
        : 'sits between the 6% fixed-income and 12% equity marks, so it decides nothing');
  }

  /* Keywords first, volatility where the keywords are silent. The decision
     is written under the banner so a reader can see which rule fired and
     overrule it if a name has misled it. */
  function classMismatchNote(name, compareName, series, compareSeries) {
    var a = assetClassOf(name), b = assetClassOf(compareName);
    var how = [];
    if (a) how.push('<strong>' + esc(name) + '</strong> is read from its name as ' + a);
    if (b) how.push('<strong>' + esc(compareName) + '</strong> is read from its name as ' + b);
    if (!a) {
      var sa = classFromSigma(series);
      if (sa) { a = sa.cls; how.push(sigmaPhrase(name, sa)); }
    }
    if (!b) {
      var sb = classFromSigma(compareSeries);
      if (sb) { b = sb.cls; how.push(sigmaPhrase(compareName, sb)); }
    }
    if (!a || !b || a === b) return '';
    var basis = '<p class="hint" style="margin:.4rem 0 0">How this was decided: ' +
      how.join('; ') + '. If a name has misled this note, ignore it.</p>';
    var pair = [a, b].sort().join('+');
    if (pair === 'debt+equity') {
      /* The banner is the review's own wording, verbatim and neutral: what
         each class is built to do, with no verdict on either. */
      return notice('info',
        '<strong>Notice: Asset Class Context</strong> — You are comparing a Fixed ' +
        'Income / Debt Asset with an Equity Index. Equity indices typically exhibit higher ' +
        'long-term capital growth alongside significantly higher short-term volatility and ' +
        'drawdown risk. Fixed Income assets are generally structured for income generation, ' +
        'capital stability, and lower price fluctuation.' +
        '<p class="hint" style="margin:.5rem 0 0">So the gap below mostly measures the ' +
        'difference between the asset classes, not the quality of the fund. A like-for-like ' +
        'benchmark — for a debt fund, a bond or debt index, its Total Return Index (TRI) ' +
        'where one is offered, since a TRI includes dividends and a price index does not ' +
        '— would say more.</p>' + basis);
    }
    var SAY = { debt: 'a debt / fixed-income holding', equity: 'an equity holding or index',
                gold: 'a gold or commodity holding' };
    return notice('info',
      '<strong>Notice: Asset Class Context</strong> — These look like different asset ' +
      'classes: <strong>' + esc(name) + '</strong> reads as ' + SAY[a] + ' and <strong>' +
      esc(compareName) + '</strong> as ' + SAY[b] + '. Their risk and return live on ' +
      'different scales, so the gap below mostly measures the difference between the ' +
      'classes, not the quality of the fund — a like-for-like benchmark, its TRI where ' +
      'one is offered, would say more.' + basis);
  }

  /* =================================== EVERY WINDOW, IN START-DATE ORDER
   *
   * The histogram says how often each outcome happened; this says WHEN. Each
   * point is one window's annualised return, plotted at the date the window
   * began, with the middle and the outer tenths drawn across it -- so the
   * narrowing (or not) of outcomes is visible as a shape, not asserted.
   */
  /* The market-index path's histogram. Every bin holds two bars when a
     benchmark is loaded -- the fund in its hue, the index in the other, over
     the same paired windows -- and the loss bins sit on a shaded ground left
     of the zero rule, so the sign is carried by position as well as colour. */
  function ixHistogram(fundValues, benchValues, years, name, compareName, havePaired) {
    var bins = E.histogram(fundValues);
    var bbins = benchValues ? E.histogram(benchValues) : null;
    var W = 640, H = 270, padL = 34, padR = 12, padT = 14, padB = 54;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var maxCount = 1;
    bins.forEach(function (b) { if (b.count > maxCount) maxCount = b.count; });
    if (bbins) bbins.forEach(function (b) { if (b.count > maxCount) maxCount = b.count; });
    var gap = 8, slot = innerW / bins.length, bw = slot - gap;
    var two = !!bbins;
    var parts = [];
    /* loss bins first, so the shading sits under the bars */
    var lossBins = bins.filter(function (b) { return b.to <= 0; }).length;
    if (lossBins) {
      parts.push('<rect class="ix-lossground" x="' + padL + '" y="' + padT + '" width="' +
        (lossBins * slot).toFixed(1) + '" height="' + innerH + '"/>');
    }
    var ticks = 4;
    for (var g = 0; g <= ticks; g++) {
      var yv = Math.round(maxCount * g / ticks);
      var y = padT + innerH - (yv / maxCount) * innerH;
      parts.push('<line class="grid" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) +
        '" y2="' + y.toFixed(1) + '"/>');
      parts.push('<text class="axis" x="' + (padL - 6) + '" y="' + (y + 4).toFixed(1) +
        '" text-anchor="end">' + yv + '</text>');
    }
    function bar(cls, count, total, x, w, label, who) {
      var h = (count / maxCount) * innerH;
      if (h <= 0.5) return;
      var y = padT + innerH - h;
      parts.push('<rect class="ixbar ' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"><title>' +
        esc(who + ': ' + count + ' of ' + total + ' periods returned ' + label) + '</title></rect>');
      parts.push('<text class="barlabel" x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) +
        '" text-anchor="middle">' + count + '</text>');
    }
    bins.forEach(function (b, i) {
      var x0 = padL + i * slot + gap / 2;
      var label = binText(b);
      if (two) {
        var half = bw / 2 - 1;
        bar('fund', b.count, fundValues.length, x0, half, label, name);
        bar('bench', bbins[i].count, benchValues.length, x0 + half + 2, half, label, compareName);
      } else {
        bar('fund', b.count, fundValues.length, x0, bw, label, name);
      }
      if (b.from !== -Infinity) {
        parts.push('<text class="axis" x="' + (x0 - gap / 2).toFixed(1) + '" y="' + (padT + innerH + 17) +
          '" text-anchor="middle">' + (b.from * 100).toFixed(0) + '</text>');
      }
    });
    if (lossBins) {
      var zx = padL + lossBins * slot;
      parts.push('<line class="ix-zerorule" x1="' + zx.toFixed(1) + '" y1="' + padT + '" x2="' +
        zx.toFixed(1) + '" y2="' + (padT + innerH) + '"/>');
      parts.push('<text class="axis ix-lossword" x="' + (padL + 4) + '" y="' + (padT + 12) +
        '">Lost money</text>');
    }
    parts.push('<line class="zero" x1="' + padL + '" y1="' + (padT + innerH) + '" x2="' + (W - padR) +
      '" y2="' + (padT + innerH) + '"/>');
    parts.push('<text class="axis" x="' + (padL + innerW / 2) + '" y="' + (H - 8) +
      '" text-anchor="middle">Annualised return, % a year, over each ' + years + '-year period</text>');
    var caption = two
      ? 'Each pair of bars counts the ' + years + '-year periods that ended in that range — ' +
        'the same ' + fundValues.length.toLocaleString() + ' paired windows for both'
      : 'Each bar counts the ' + years + '-year periods that ended in that range';
    return '<figure class="chart ixhist"><figcaption>' + esc(caption) + '</figcaption>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' +
      esc('Distribution of ' + years + '-year rolling returns for ' + name +
          (two ? ' and ' + compareName : '')) + '">' + parts.join('') + '</svg>' +
      '<div class="legend"><span class="key"><span class="legend-dot fund"></span>' + esc(name) +
      '</span>' +
      (two ? '<span class="key"><span class="legend-dot bench"></span>' + esc(compareName) + '</span>' : '') +
      '<span class="key"><span class="swatch ix-lossswatch"></span>Shaded: periods that lost money</span>' +
      '<span class="key">Unshaded: periods that made money</span>' +
      '</div></figure>';
  }

  function rollLineChart(pairs, years, s, benchPairs, compareName) {
    if (!pairs || pairs.length < 3) return '';
    var W = 640, H = 240, padL = 8, padR = 68, padT = 12, padB = 26;
    var t0 = pairs[0].t, t1 = pairs[pairs.length - 1].t;
    if (t1 <= t0) return '';
    var lo = Math.min(s.min, 0), hi = Math.max(s.max, 0);
    /* the benchmark line shares the axis, so the axis has to hold it too */
    var bp = benchPairs && benchPairs.length >= 3 ? benchPairs : null;
    if (bp) bp.forEach(function (m) { if (m.bench < lo) lo = m.bench; if (m.bench > hi) hi = m.bench; });
    var span = hi - lo || 1;
    lo -= span * 0.06; hi += span * 0.06; span = hi - lo;
    function x(t) { return padL + (t - t0) / (t1 - t0) * (W - padL - padR); }
    function y(v) { return padT + (hi - v) / span * (H - padT - padB); }
    /* Thin to at most ~700 points: a phone does not need 3,000 line segments
       to draw the same shape. Every k-th point keeps the ends. */
    var step = Math.max(1, Math.ceil(pairs.length / 700));
    var pts = [];
    for (var i = 0; i < pairs.length; i += step) {
      pts.push(x(pairs[i].t).toFixed(1) + ',' + y(pairs[i].r).toFixed(1));
    }
    var last = pairs[pairs.length - 1];
    pts.push(x(last.t).toFixed(1) + ',' + y(last.r).toFixed(1));
    var bpts = [];
    if (bp) {
      var bstep = Math.max(1, Math.ceil(bp.length / 700));
      for (var k = 0; k < bp.length; k += bstep) {
        if (bp[k].t < t0 || bp[k].t > t1) continue;
        bpts.push(x(bp[k].t).toFixed(1) + ',' + y(bp[k].bench).toFixed(1));
      }
      var blast = bp[bp.length - 1];
      if (blast.t >= t0 && blast.t <= t1) bpts.push(x(blast.t).toFixed(1) + ',' + y(blast.bench).toFixed(1));
    }

    /* The three guide labels overlap when the percentiles nearly coincide —
       a flat series puts all three on one pixel — so the label positions are
       pushed apart before drawing, while each line stays at its true level. */
    var guides = [
      { v: s.p90, label: '90th ' + pct(s.p90) },
      { v: s.median, label: 'median ' + pct(s.median) },
      { v: s.p10, label: '10th ' + pct(s.p10) }
    ];
    guides.forEach(function (g) { g.ly = y(g.v); });
    guides.sort(function (a, b) { return a.ly - b.ly; });
    for (var gi = 1; gi < guides.length; gi++) {
      if (guides[gi].ly - guides[gi - 1].ly < 13) guides[gi].ly = guides[gi - 1].ly + 13;
    }
    var guideSvg = guides.map(function (g) {
      var yy = y(g.v).toFixed(1);
      return '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy +
        '" class="rl-guide"/><text x="' + (W - padR + 5) + '" y="' + g.ly.toFixed(1) +
        '" class="rl-glabel" dominant-baseline="middle">' + esc(g.label) + '</text>';
    }).join('');
    var zero = (0 >= lo && 0 <= hi)
      ? '<line x1="' + padL + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - padR) + '" y2="' +
        y(0).toFixed(1) + '" class="rl-zero"/>' : '';

    return '<div class="card"><h2>Every window, in start-date order</h2>' +
      '<p class="hint" style="margin:0 0 .6rem">Each point is the annualised return of one ' +
      years + '-year holding period, plotted at the date it began. The lines mark the middle ' +
      'and the outer tenths: 8 of every 10 windows ended between the 10th and 90th lines.' +
      (bpts.length ? ' The dashed line is <strong>' + esc(compareName) + '</strong> over the ' +
        'same paired windows.' : '') + '</p>' +
      (bpts.length
        ? '<div class="legend" style="margin:0 0 .4rem"><span class="key"><span class="legend-dot fund">' +
          '</span>Primary Investment (solid)</span><span class="key"><span class="legend-dot bench">' +
          '</span>' + esc(compareName) + ' (dashed)</span></div>'
        : '') +
      '<svg class="rollline" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Rolling ' + years + '-year returns by start date">' +
      zero + guideSvg +
      (bpts.length ? '<polyline class="rl-line bench" points="' + bpts.join(' ') + '"/>' : '') +
      '<polyline class="rl-line" points="' + pts.join(' ') + '"/>' +
      '<text x="' + padL + '" y="' + (H - 8) + '" class="rl-axis">' + fmtDate(t0) + '</text>' +
      '<text x="' + (W - padR) + '" y="' + (H - 8) + '" class="rl-axis" text-anchor="end">' +
      fmtDate(t1) + '</text>' +
      '</svg>' +
      '<p class="hint" style="margin:.5rem 0 0">Neighbouring points share almost all their ' +
      'days, which is why the line moves smoothly — these are overlapping windows, not ' +
      'independent results.</p></div>';
  }

  /* ========================================= THREE QUESTIONS, NOT ONE VERDICT
   *
   * The one thing this screen may not do is advise. What it can do is put the
   * measured numbers inside the questions only the reader can answer, so the
   * decision stays theirs and the arithmetic stays this tool's.
   */
  function reflectCard(years, series, key) {
    var dd = E.maxDrawdown(series);
    var months = dd.ok && dd.to
      ? Math.round((dd.fallDays + (dd.recoveryDays || 0)) / 30) : null;
    return '<div class="card"><h2>Three questions only you can answer</h2>' +
      '<p class="hint" style="margin:0 0 .8rem">This tool measures; it does not advise. ' +
      'These are the questions the measurements exist to inform.</p>' +
      '<ol class="insights reflectlist">' +
      '<li><span class="ins-h">Horizon</span><span class="ins-b">The figures above describe ' +
      years + '-year holding periods. Is the money you are thinking of actually free for ' +
      years + (years === 1 ? ' year' : ' years') + ' — no planned purchase, fee or ' +
      'commitment inside that window?</span></li>' +
      '<li><span class="ins-h">Falls</span><span class="ins-b">' +
      (dd.ok && dd.to
        ? 'The deepest fall in this data was <strong>' + pct(dd.depth) + '</strong>' +
          (months ? ', and the round trip from peak to recovery took about <strong>' + months +
            ' months</strong>' : ', not yet recovered by the end of this data') +
          '. If that stretch began the month after you invested, could you — in money and ' +
          'in nerve — stay to the end of it?'
        : 'This data shows no fall, which says more about the dates it covers than about the ' +
          'future. Could you hold through a fall this file has simply never seen?') +
      '</span></li>' +
      '<li><span class="ins-h">Target</span><span class="ins-b">The rate box above holds your ' +
      'own required rate. Did enough of the past periods clear it for this record to fit the ' +
      'plan you are funding — and is that judgement yours, not this page’s?</span></li>' +
      '</ol></div>';
  }

  /* Every window both series can cover, paired by start date. One end-to-end
   * number can be an accident of where it started; how often one led the other
   * cannot. */
  function comparisonCards(series, compareSeries, years, name, compareName, compareMeta, calc, indexPath, key) {
    /* The frequency has to reach here, or this card measures a different set
       of windows from the summary above it. Same defect as windowed(): the
       options argument was simply not passed. */
    var c = E.compareRolling(series, compareSeries, years, calc || {});
    if (!c.ok) {
      return '<div class="card">' + notice('bad', esc(c.message)) + '</div>';
    }
    var f = c.fund, b = c.bench;
    /* With a Difference column when the market-index path asks for it: the
       reader stops doing the subtraction in their head, and the sign is
       explicit instead of inferred. */
    var delta = indexPath
      ? function (label, a, bb) {
          var d = a - bb;
          return '<tr><td>' + esc(label) + '</td><td>' + pct(a) + '</td><td>' + pct(bb) +
            '</td><td>' + A.signedPct(d) + '</td></tr>';
        }
      : null;
    var rowFn = delta || cmp;
    var fundHead = (indexPath ? '<span class="legend-dot fund"></span>' : '') + esc(name);
    var benchHead = (indexPath ? '<span class="legend-dot bench"></span>' : '') + esc(compareName);
    var html = (indexPath ? characteristicMatrix(series, compareSeries, c, name, compareName) : '') +
      '<div class="card"><h2>Against ' + esc(compareName) + '</h2>' +
      '<div class="result" style="margin:0 0 1rem"><div class="label">Periods where ' +
      esc(name) + ' came out ahead</div><div class="value">' + pct(c.fundAheadShare, 0) + '</div>' +
      '<div class="sub">' + c.fundAhead.toLocaleString() + ' of ' + c.pairs.toLocaleString() +
      ' matched ' + years + '-year periods, ' + fmtDate(c.from) + ' to ' + fmtDate(c.to) + '</div></div>' +
      '<div class="scroll"><table class="data"><thead><tr><th>Over ' + years + ' years</th><th>' +
      fundHead + '</th><th>' + benchHead + '</th>' +
      (indexPath ? '<th>Difference</th>' : '') + '</tr></thead><tbody>' +
      rowFn('Worst period', f.min, b.min) +
      rowFn('25th percentile', f.p25, b.p25) +
      rowFn('Median period', f.median, b.median) +
      rowFn('75th percentile', f.p75, b.p75) +
      rowFn('Best period', f.max, b.max) +
      (indexPath && f.stdev != null && b.stdev != null
        ? rowFn('Volatility (std deviation)', f.stdev, b.stdev) : '') +
      rowFn('Periods that made money', f.positiveShare, b.positiveShare) +
      /* The two ratios in the table itself, against the reader's target
         from the rate box, and refreshed when that target moves. */
      (indexPath ? ratioRowsDelta(c.fundValues, c.benchValues, 0.07, key) : '') +
      '<tr><td>Periods compared</td><td>' + c.pairs.toLocaleString() + '</td><td>' +
      c.pairs.toLocaleString() + '</td>' + (indexPath ? '<td>—</td>' : '') + '</tr>' +
      '</tbody></table></div>' +
      (indexPath
        ? '<p class="feenote"><strong>Data Standard Note:</strong> Fund NAVs reflect net ' +
          'performance after Total Expense Ratio (TER) deductions. Index TRI values represent ' +
          'gross market performance without expense deductions, transaction costs, or cash drag.</p>' +
          '<p class="hint" style="margin:.3rem 0 0">Sharpe and Sortino here divide the average ' +
          'excess over the target in the rate box by the spread of the windows (all of it, and ' +
          'the downside only); the official ratios use a risk-free rate this tool does not know.</p>'
        : '') +
      '<div class="meaning"><h3>What this means</h3>' +
      '<p>Only periods that both sets of data cover are compared, so neither is judged on dates the ' +
      'other never saw.' + (indexPath ? carriedPhrase(c) : '') + ' The gap in the median is ' +
      '<strong>' + (f.median >= b.median ? '+' : '') + ((f.median - b.median) * 100).toFixed(1) +
      ' percentage points</strong> a year.</p>' +
      '<p>Leading in ' + pct(c.fundAheadShare, 0) + ' of periods is a different statement from leading ' +
      'over one stretch. A fund can win on the dates you happen to look at and lose on most others.</p>' +
      '</div>' +
      (compareMeta ? '<div class="scroll" style="margin-top:.8rem"><table class="data"><tbody>' +
        '<tr><td>' + esc(compareName) + ' is</td><td>' + (compareMeta.kind === 'PRICE'
          ? 'a price index — dividends excluded'
          : compareMeta.kind === 'TRI'
            ? 'a total return index — dividends included'
            /* Never guessed. The old code had two branches and no third, so an
               index nobody had established anything about was described as a
               total return index -- the reassuring answer, asserted. */
            /* Step 4 is gone on this path and the control is on card 2, so
               pointing at a step that is not there would send the reader
               looking for something that does not exist. */
            : 'not established — open card 2 and say which') +
        '</td></tr>' +
        (compareMeta.firstDate ? '<tr><td>Its own data covers</td><td>' + esc(compareMeta.firstDate) +
          ' to ' + esc(compareMeta.lastDate) + '</td></tr>' : '') +
        (compareMeta.source ? '<tr><td>Source</td><td>' + esc(compareMeta.source) + '</td></tr>' : '') +
        '</tbody></table></div>' : '') +
      '<div class="meaning"><h3>What it does not mean</h3>' +
      (compareMeta && compareMeta.kind === 'PRICE'
        ? '<p><strong>This index excludes dividends while a fund\u2019s NAV includes them.</strong> ' +
          'The fund is flattered here by roughly the market\u2019s dividend yield each year \u2014 ' +
          'about 1 to 1.5 points on Indian equity indices, which is larger than most of the gaps ' +
          'this card is used to argue about.</p>' : '') +
      (compareMeta && compareMeta.kind == null
        ? '<p><strong>Whether this index counts dividends has not been established.</strong> If it ' +
          'is a price index, every figure above overstates the gap by roughly the market\u2019s ' +
          'dividend yield. Open card 2, Benchmark Index Data, and say which it is — this line ' +
          'will then say what follows from it.</p>'
        : '') +
      '<p>A benchmark carries no costs, holds no cash and makes no decisions; a fund does all three. ' +
      'A benchmark comparison is a reference point, not proof that a fund is good or bad, and it says ' +
      'nothing about whether the fund suits you.</p></div></div>';

    return html + realityCheck(series, compareSeries, c, name, compareName);
  }

  /* Five characteristics side by side, over the stretch both files cover:
     what each asset did over the windows, how much its value moved day to
     day, and how far it fell. The delta column is fund minus benchmark and
     is a description, not a score. Market-index path only. */
  function characteristicMatrix(series, compareSeries, c, name, compareName) {
    var fs = P.sliceSeries(series, c.from, c.to), bs = P.sliceSeries(compareSeries, c.from, c.to);
    var fv = E.annualisedVolatility(fs), bv = E.annualisedVolatility(bs);
    var fd = E.maxDrawdown(fs), bd = E.maxDrawdown(bs);
    function row(label, a, b, fmt) {
      var have = a != null && b != null;
      return '<tr><td>' + label + '</td><td>' + (a == null ? '—' : fmt(a)) + '</td><td>' +
        (b == null ? '—' : fmt(b)) + '</td><td>' + (have ? A.signedPct(a - b) : '—') + '</td></tr>';
    }
    return '<div class="card"><h2>Side by side, over the same dates</h2>' +
      '<p class="hint" style="margin:0 0 .8rem">Every figure below is measured over ' +
      fmtDate(c.from) + ' to ' + fmtDate(c.to) + ', the stretch both files cover. Window figures ' +
      'come from the ' + c.pairs.toLocaleString() + ' paired ' + c.years + '-year windows; ' +
      'volatility and drawdown come from the daily value itself.</p>' +
      '<div class="scroll"><table class="data charmatrix">' +
      '<caption>Asset characteristics, fund against benchmark</caption>' +
      '<thead><tr><th>Characteristic</th><th><span class="legend-dot fund"></span>' + esc(name) +
      '</th><th><span class="legend-dot bench"></span>' + esc(compareName) + '</th><th>Delta</th></tr></thead>' +
      '<tbody>' +
      row('Median Return (% a year)', c.fund.median, c.bench.median, pct) +
      row('Worst Window (% a year)', c.fund.min, c.bench.min, pct) +
      row('Volatility (annualised σ of the value)', fv.ok ? fv.sigma : null, bv.ok ? bv.sigma : null,
          function (v) { return pct(v, 1); }) +
      row('Max Drawdown (peak to trough)', fd.ok ? fd.depth : null, bd.ok ? bd.depth : null, pct) +
      row('Positive Window Ratio', c.fund.positiveShare, c.bench.positiveShare,
          function (v) { return pct(v, 0); }) +
      '</tbody></table></div>' +
      '<p class="hint" style="margin:.5rem 0 0">Delta is the first column minus the second, in ' +
      'percentage points. A wider volatility or a deeper drawdown on one side is a property of ' +
      'that asset over these dates, not a verdict on either.</p></div>';
  }

  /* Four plain judgements, each with the rule that produced it written out, so
   * a reader can disagree with the rule rather than the label. */
  function realityCheck(series, compareSeries, c, name, compareName) {
    var medianGap = c.fund.median - c.bench.median;
    var fundDD = E.maxDrawdown(series), benchDD = E.maxDrawdown(compareSeries);
    var ddGap = (fundDD.ok && benchDD.ok) ? fundDD.depth - benchDD.depth : null;
    var overlapYears = (c.to - c.from) / (365.2425 * 86400000);

    /* THE MEASUREMENT, NOT A GRADE OF IT.
     *
     * This column used to hold Strong, Mixed, Weak, Moderate, Limited --
     * words that are a verdict on a fund's record, arrived at by comparing a
     * measured number to a threshold this tool invented. Section 6 of the
     * specification names verdict language as prohibited and section 7 asks
     * for facts without it, and the panel two cards above this one carries
     * the subtitle "Neutral & Unbiased" while this one graded.
     *
     * A threshold is a judgement about what counts as good, and a reader with
     * a different horizon or a different alternative would draw it somewhere
     * else. So the figure stands where the grade stood, and the reader does
     * the grading. Nothing measured is lost: every one of these numbers was
     * already in the third column, which is how the grades could be checked
     * at all. */
    var rows = [
      ['Return against the benchmark',
       (medianGap >= 0 ? '+' : '') + (medianGap * 100).toFixed(1) + ' points a year',
       'Median ' + c.years + '-year return of this data against ' + esc(compareName) + '.'],
      ['Outperformance Frequency (%)', pct(c.fundAheadShare, 0),
       'Came out ahead in ' + c.fundAhead.toLocaleString() + ' of ' +
       c.pairs.toLocaleString() + ' matched periods.'],
      ['Deepest fall along the way',
       fundDD.ok ? pct(fundDD.depth) : 'not measured',
       ddGap === null ? 'Not enough data to measure the benchmark\u2019s.' :
        'Against ' + pct(benchDD.depth) + ' for ' + esc(compareName) + ' \u2014 a gap of ' +
        (ddGap >= 0 ? '+' : '') + (ddGap * 100).toFixed(1) + ' points.'],
      ['History behind these figures', overlapYears.toFixed(1) + ' years',
       c.pairs.toLocaleString() + ' periods compared, over the dates both files cover. ' +
       'The windows overlap, so they are not independent observations.']
    ];

    return '<div class="card"><h2>The comparison, as four measurements</h2><div class="scroll">' +
      '<table class="data"><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td><strong>' + esc(r[1]) + '</strong></td><td>' +
          r[2] + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="meaning"><h3>Before you read anything into this</h3>' +
      '<p>Every line above is a description of what already happened over these dates, against this ' +
      'benchmark. None of it establishes that the fund is suitable for you, and none of it is a ' +
      'forecast. Whether any of these figures is good is a judgement about your own goal and ' +
      'horizon, which is why this card reports them rather than grading them.</p>' +
      '<p>Nothing here is a recommendation to buy, hold, sell or switch. Suitability depends on your ' +
      'goal, your horizon, what else you own and what you can sit through — none of which this tool ' +
      'knows.</p></div></div>';
  }

  function cmp(label, a, b) {
    return '<tr><td>' + esc(label) + '</td><td>' + pct(a) + '</td><td>' + pct(b) + '</td></tr>';
  }
  function binText(b) {
    if (b.from === -Infinity) return 'Worse than ' + pct(b.to, 0) + ' a year';
    if (b.to === Infinity) return 'Above ' + pct(b.from, 0) + ' a year';
    return pct(b.from, 0) + ' to ' + pct(b.to, 0) + ' a year';
  }

  /* =============================================================== ROLLING
   *
   * One module, one set of controls, two sources. Splitting "the market" and
   * "my fund" into separate screens made the same analysis look like two
   * different things and left the inputs scattered; this asks the four
   * questions the analysis actually needs, in order, with nothing hidden.
   */

  var R = {
    source: null,          /* 'index' | 'fund' */
    series: null,          /* everything available for the chosen source */
    name: '',
    meta: null,            /* bundled-index metadata, when there is any */
    report: null,          /* import report, when it came from a file */
    rows: null,            /* raw rows, kept so the scheme can be changed */
    schemes: null,
    /* Three years, chosen on the page, at the author's instruction.
     *
     * Recorded because it reverses a decision: review v4 §12.14 and §4 said NO
     * default, on the ground that a default is a recommendation and the length
     * a reader means to hold is the one thing this screen cannot guess. The
     * author has since asked for 3 years pre-selected, and that is what ships.
     *
     * What survives of the old rule: DEFAULT_YEARS is never silently restored.
     * If the loaded history cannot measure three years, limitYears clears the
     * selection to null rather than sliding the reader onto a shorter length
     * they did not choose, and the run then refuses in words. */
    years: DEFAULT_YEARS,
    /* Section 4 of the specification. Daily is the default and is labelled
     * Recommended: it uses every start date the file offers, and weekly and
     * monthly exist to THIN those start dates on a very long file, never to
     * change how any one window is measured. */
    frequency: 'daily',
    blockMessage: null,    /* set when a length no longer fits the history */
    datesTouched: false,
    bundled: {},           /* name -> series, for the comparison list */
    cmpSchemes: null,      /* a many-scheme file loaded into the benchmark slot */
    cmpRows: null,
    /* Which kind of index each loaded benchmark is: 'TRI', 'PRICE', or null
     * for not yet established. Card B's header asserts (TRI) and its rule
     * tells the reader to use one; nothing checked, so a price index loaded
     * here was silently treated as though it counted dividends. */
    kinds: {},
    ran: false
  };

  function setSource(source) {
    R.source = source;
    $$('#r-source .chip').forEach(function (c) {
      c.setAttribute('aria-checked', String(c.dataset.source === source));
    });
    $('#src-index').hidden = source !== 'index';
    $('#src-fund').hidden = source !== 'fund';
    /* The specification covers the market-index path and nothing else, so
     * everything it adds appears only there. The fund path keeps exactly the
     * screen it had. */
    var onIndex = source === 'index';
    var freq = $('#r-freq-wrap');
    if (freq) freq.hidden = !onIndex;
    placeBenchmarkCard(onIndex);
    if (!onIndex) {
      var ov = $('#r-overlap-note');
      if (ov) ov.innerHTML = '';
    }
    $('#step-source').dataset.done = source ? 'yes' : 'no';
    yearChips();
    /* Step 4's hint depends on which path is running -- on the index path the
       upload it used to point at is now in step 1 -- and refreshCompare had
       no reason to run again when the source changed, so it kept whatever it
       had said at start-up. */
    refreshCompare();
    gateSteps();
    var prompt = $('#r-source-prompt');
    if (prompt) {
      prompt.textContent = source ? ''
        : 'Pick one of the two above to begin. The rest of this screen unlocks once you do.';
    }
  }

  /* ================================================ THE TWO DOORS, ON A PHONE
   *
   * Below 34rem the pair of cards becomes a pair of compact doors that fit
   * side by side honestly, and the card opens under whichever was tapped.
   * Above it none of this runs: the doors are not drawn, both cards show.
   *
   * The doors are the only place a reader can see BOTH answers at once, so
   * they carry the state -- empty, loaded with a name, or turned away -- and
   * every path that changes a drop box tells them so.
   */
  var DOOR_OF = { bm: 'a', cmp: 'b' };
  var DOOR_IDLE = { a: 'Upload File', b: 'Choose a File' };
  /* What each door is holding, once it holds something. */
  var LOADED = { a: null, b: null };

  function openDoor(which) {
    var cards = $('#up-cards');
    if (!cards) return;
    cards.setAttribute('data-open', which || '');
    ['a', 'b'].forEach(function (d) {
      var btn = $('#door-' + d);
      if (btn) btn.setAttribute('aria-expanded', String(d === which));
    });
  }

  /* ================================ WHAT HAS BEEN LOADED, AT REST
   *
   * A card is a working surface. It is open while a file is being chosen and
   * it has no business staying open afterwards -- a full-height box holding a
   * job already done is the largest thing on the screen and the least useful.
   *
   * So on a successful read the card folds away and the file appears here
   * instead: what it is, what it is called, how much of it was read, over what
   * dates. Two of them stacked is the whole of step 1 in six lines.
   */
  function recordLoaded(prefix, name, report) {
    var d = DOOR_OF[prefix];
    if (!d) return;
    LOADED[d] = report ? { name: name, report: report } : null;
    renderLoadedList();
  }

  function clearLoadedList() {
    LOADED.a = null; LOADED.b = null;
    renderLoadedList();
  }

  function renderLoadedList() {
    var host = $('#up-loaded');
    if (!host) return;

    /* ONE SINGLE LINE, by the author's explicit instruction, given twice.
     *
     * The first attempt here was a three-line panel per file; the second a
     * two-line bar. Both were boxes holding a job already done. What the
     * author asked for is the line from their own screenshot -- "Ready to
     * analyse <name>" -- dressed properly, not a paragraph. So: one row that
     * cannot wrap, naming what will be analysed, and carrying the reader to
     * step 2 when tapped, which was the other thing they asked for by name. */
    if (!LOADED.a) { host.innerHTML = ''; return; }

    host.innerHTML =
      '<button class="readyline" type="button" id="up-ready">' +
        '<span class="rl-ic" aria-hidden="true">✓</span>' +
        '<span class="rl-t">Ready to analyse <strong>' + esc(R.name || LOADED.a.name) +
          '</strong></span>' +
        '<span class="rl-go" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
          ' stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>' +
        '</span>' +
      '</button>';

    var btn = $('#up-ready');
    if (btn) {
      btn.addEventListener('click', function () {
        var target = $('#step-period');
        if (!target) return;
        var still = window.matchMedia &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
        /* Moved to as well as scrolled to, so a reader on a keyboard or a
           screen reader arrives where the page just went. */
        var first = A.$$('input:not([disabled])', target)[0];
        if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, still ? 0 : 420);
      });
    }
  }

  /* The help panels open to a choice — Read Instructions or Watch Video —
   * instead of a wall of text. The video is the phone recording the written
   * instructions were verified against, bundled with the tool so nothing is
   * fetched from anywhere at runtime. */
  function wireHowto() {
    $$('.howto').forEach(function (box) {
      var read = box.querySelector('.howto-read');
      var vid = box.querySelector('.howto-video');
      if (!read || !vid) return;
      $$('.howto-btn', box).forEach(function (b) {
        b.addEventListener('click', function () {
          var show = b.dataset.show;
          read.hidden = show !== 'read';
          vid.hidden = show !== 'video';
          $$('.howto-btn', box).forEach(function (o) {
            o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
          });
          if (show !== 'video') {
            var v = vid.querySelector('video');
            if (v) v.pause();
          }
        });
      });
    });
  }

  function wireDoors() {
    ['a', 'b'].forEach(function (d) {
      var btn = $('#door-' + d);
      if (!btn) return;
      btn.addEventListener('click', function () {
        var cards = $('#up-cards');
        var already = cards && cards.getAttribute('data-open') === d;
        /* Tapping the open door shuts it, so a reader who opened the wrong one
           is not stuck with a card they did not want. */
        openDoor(already ? '' : d);
      });
    });
  }

  /* The door says what its card holds, in the fewest words that are true. */
  function doorSays(prefix, state, text) {
    var d = DOOR_OF[prefix];
    if (!d) return;
    var btn = $('#door-' + d), slot = $('#door-' + d + '-status');
    if (!btn || !slot) return;
    if (state) btn.setAttribute('data-state', state);
    else btn.removeAttribute('data-state');
    slot.textContent = text || DOOR_IDLE[d];
  }

  /* A name long enough to fill the door twice over tells the reader nothing.
     The end matters more than the middle: it carries the extension. */
  function shortName(name) {
    var n = String(name || '');
    if (n.length <= 22) return n;
    return n.slice(0, 11) + '…' + n.slice(-10);
  }

  /* Section 2 puts both datasets in step 1, side by side.
   *
   * The benchmark door was in step 4, which meant the reader met one of the
   * two files it takes, dealt with it, and only later discovered there was a
   * second. Two things named "1." and "2." three steps apart are not a pair.
   *
   * The NODE is moved rather than rebuilt. Everything inside it -- the drop
   * zone, the file input, the paste box, the TRI question, the scheme picker
   * -- carries listeners bound at build time, and refreshCompare only rebuilds
   * when #cmp-file is missing. Reparenting keeps all of that intact; copying
   * the markup across would have quietly produced a second, dead upload box.
   *
   * On the fund path it goes back where it has always been, so that screen is
   * unchanged. */
  function placeBenchmarkCard(onIndex) {
    var head = $('#up-benchmark-head');
    var upload = $('#r-compare-upload');
    var overlap = $('#r-overlap-note');
    if (!head || !upload) return;

    var step = $('#step-compare');
    if (onIndex) {
      var cards = $('#up-cards');
      var after = $('#up-after-cards');
      if (upload.parentNode !== head) head.appendChild(upload);
      if (cards && head.parentNode !== cards) cards.appendChild(head);
      /* The amber range warning is about BOTH files, so it belongs under
         both of them rather than under one. */
      if (after && overlap && overlap.parentNode !== after) after.appendChild(overlap);
      head.hidden = false;
      /* Step 4 asked the question card 2 has already answered.
       *
       * "Compare against — optional — Benchmark: [Nifty 50 TRI]" three steps
       * below a card headed "2. Benchmark Index Data (TRI)" holding that very
       * file is the same choice offered twice, and the second offer is the one
       * with nothing to add: on this path there is one benchmark, it is the
       * file the reader loaded, and it is already selected. So the step goes,
       * and the chooser appears inside card 2 only if a SECOND benchmark is
       * ever loaded and there is a choice to make. */
      if (step) step.hidden = true;
      sayHowMany(3);
    } else {
      head.hidden = true;
      /* My own fund analyses one fund on its own: the reader who wants their
         fund measured against an index has the Market index path, where
         card 2 holds the benchmark. So the whole step goes here — not just
         the duplicate chooser — and nothing on this path offers a
         comparison. The nodes are still parked in the hidden step so the
         index path can take them back intact. */
      if (step) {
        step.hidden = true;
        if (upload.parentNode !== step) step.appendChild(upload);
        if (overlap && overlap.parentNode !== step) step.appendChild(overlap);
      }
      sayHowMany(3);
    }
    placeCompareField(onIndex);
  }

  /* The page opens by saying how many things there are to set. On the index
     path there are now three, because the fourth asked a question card 2 had
     already answered. A lede that miscounts the steps below it is a small
     thing that makes a reader distrust the rest. */
  function sayHowMany(n) {
    var lede = $('#r-lede');
    if (!lede) return;
    lede.textContent = 'Every holding period of the length you choose, not one flattering ' +
      'stretch. Set the ' + (n === 3 ? 'three' : 'four') + ' things below, then read the answer.';
  }

  /* The "which benchmark" chooser follows the upload, and shows itself only
     when it has a choice to offer. */
  function placeCompareField(onIndex) {
    var field = $('#r-compare-field');
    var head = $('#up-benchmark-head');
    var step = $('#step-compare');
    if (!field) return;
    if (onIndex) {
      if (head && field.parentNode !== head) head.appendChild(field);
      var names = Object.keys(R.bundled).filter(function (n) { return n !== R.name; });
      /* One loaded file is not a choice. */
      field.hidden = names.length < 2;
    } else {
      if (step && field.parentNode !== step) step.insertBefore(field, step.firstChild.nextSibling);
      field.hidden = false;
    }
  }

  /* Everything downstream of "what am I analysing" stays visible but inert
     until there is something to analyse, so nobody has to discover a control
     that only appears once they guess the right first move. */
  function setLoaded(series, name, opts) {
    var o = opts || {};
    R.series = series;
    R.name = name;
    R.meta = o.meta || null;
    R.report = o.report || null;

    var first = series[0].t, last = series[series.length - 1].t;
    var lo = isoOf(first), hi = isoOf(last);
    ['r-start', 'r-end'].forEach(function (id) {
      var el = $('#' + id);
      el.disabled = false;
      el.min = lo;
      el.max = hi;
    });
    /* keep dates the reader chose; replace dates this screen filled in itself */
    var reset = false;
    ['r-start', 'r-end'].forEach(function (id) {
      var el = $('#' + id);
      var v = el.value;
      var mine = R.datesTouched && v && v >= lo && v <= hi;
      if (!mine) { el.value = (id === 'r-start' ? lo : hi); if (v && R.datesTouched) reset = true; }
    });
    $('#r-all').disabled = false;
    $('#r-run').disabled = false;
    var spanYears = (last - first) / (365.2425 * 86400000);
    $('#r-range').textContent = 'Data available: ' + fmtDate(first) + ' to ' + fmtDate(last) +
      ' \u2014 ' + spanYears.toFixed(1) + ' years, ' + series.length.toLocaleString() +
      ' observations.';
    /* Rebuilt, not just re-measured: the Max History chip is worth a different
       number of years for every file, so it cannot be drawn once at start-up
       -- and the frequency chips read the file's own cadence, so neither can
       they. */
    yearChips();
    freqChips();
    limitYears(selectedSpanYears());
    updateWindowNote();
    $('#step-period').dataset.done = 'yes';
    /* Steps 2, 3 and 4 are held at half opacity until there is something to
     * analyse. gateSteps was called at init and from setSource -- both BEFORE
     * a series can exist -- and never again, so the locked state stayed on for
     * the whole session: every control below step 1 was live and usable while
     * rendering at 50%, which is precisely the "faded, looks disabled" the
     * chips were being blamed for. */
    /* A file that loads clears whatever the last refusal left behind. */
    var srcStep = $('#step-source');
    if (srcStep) { srcStep.dataset.done = 'yes'; srcStep.dataset.error = 'no'; }
    gateSteps();

    /* "Ready to analyse X" is what the summary row says, better, on the path
       that has one. Kept for anything the row does NOT say -- a date range
       that had to be reset, an aging note on bundled data -- and kept whole on
       the fund path, which has no summary row. */
    /* The density warning the sparse file never got. 29 values across seven
       years ran under a row recommending daily steps, and nothing said so
       until the results arrived with five windows in them. Said here, at load
       time, before anything is configured. */
    var gapDays = E.medianGapDays(series);
    var sparse = (gapDays != null && gapDays > 7)
      ? 'This file holds a value about every ' + Math.round(gapDays) + ' days \u2014 ' +
        series.length.toLocaleString() + ' observations over ' + spanYears.toFixed(1) +
        ' years. Rolling periods can only start on dates the file actually has, so there ' +
        'will be few of them, and none of the figures will be fine-grained.'
      : '';
    var extraWord = (reset ? 'Your dates fell outside this data, so they have been set to its ' +
                             'full range.' : '') + (o.note ? (reset ? ' ' : '') + o.note : '') +
                    (sparse ? ((reset || o.note) ? ' ' : '') + sparse : '');
    var quiet = R.source === 'index' && (LOADED.a || LOADED.b);
    $('#r-loaded').innerHTML = quiet
      ? (extraWord ? notice(sparse ? 'warn' : '', extraWord) : '')
      : notice(sparse ? 'warn' : 'ok', 'Ready to analyse <strong>' + esc(name) + '</strong>.' +
               (extraWord ? ' ' + extraWord : ''));
    refreshCompare();
    overlapNote();
    /* The ready line names R.name, and dropAdded ran before this function set
       it -- rendered then, it would carry the PREVIOUS file's name for the
       length of one upload. Re-rendered here, after the name is true. */
    renderLoadedList();
    if (R.ran) runRolling();
  }

  function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }

  /* How much history the reader's own dates leave, which is what the holding
   * period has to fit inside -- not the span of the whole file. */
  function selectedSpanYears() {
    if (!R.series) return null;
    var from = A.isoToTs($('#r-start').value), to = A.isoToTs($('#r-end').value);
    if (isNaN(from) || isNaN(to) || to <= from) return null;
    return (to - from) / (365.2425 * 86400000);
  }

  function updateWindowNote() {
    var note = $('#r-window-note');
    if (!note) return;
    var to = A.isoToTs($('#r-end').value), from = A.isoToTs($('#r-start').value);
    if (!R.series || isNaN(to) || isNaN(from) || to <= from) { note.textContent = ''; return; }
    /* With no length chosen there is nothing to say, and saying it anyway
       printed "With a null-year holding period, start dates from ..." on the
       screen -- a sentence with a JavaScript value in the middle of it. */
    if (R.years === null) { note.textContent = ''; return; }
    var lastStart = E.addYears(to, -R.years);
    note.textContent = lastStart <= from
      ? 'These dates leave less than one ' + R.years + '-year holding period.'
      : 'With a ' + R.years + '-year holding period, start dates from ' + fmtDate(from) +
        ' to ' + fmtDate(lastStart) + ' are measured.';
  }

  function clearLoaded(message, opts) {
    R.series = null; R.name = ''; R.meta = null; R.report = null;
    ['r-start', 'r-end'].forEach(function (id) { $('#' + id).disabled = true; $('#' + id).value = ''; });
    $('#r-all').disabled = true;
    $('#r-run').disabled = true;
    limitYears(null);
    $('#step-period').dataset.done = 'no';
    /* The chosen length survives a cleared file -- limitYears has nothing to
       measure it against -- so the step's own tick has to follow the choice,
       not the file. Saying "not done" while a chip is plainly chosen is the
       screen contradicting itself. */
    $('#step-hold').dataset.done = R.years === null ? 'no' : 'yes';
    holdError(null);
    $('#r-range').textContent = 'Choose something to analyse first.';
    var note = $('#r-window-note');
    if (note) note.textContent = '';
    $('#r-out').innerHTML = '';
    /* A refused file must not leave step 1 wearing a tick.
     *
     * setSource marks the step done the moment a SOURCE is chosen, so after a
     * tradebook was turned away the screen still showed a green 1 and a green
     * heading: the step said it was finished while holding nothing. */
    var step = $('#step-source');
    if (step && opts && opts.rejected) {
      step.dataset.done = 'no';
      step.dataset.error = 'yes';
    } else if (step && R.source) {
      step.dataset.done = R.series ? 'yes' : 'no';
      step.dataset.error = 'no';
    }
    gateSteps();
    if (message) $('#r-loaded').innerHTML = message;
  }

  /* ---------------------------------------------------------------- index */

  function loadIndexList() {
    fetch('data/benchmarks.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var list = (data && data.benchmarks) || [];
        R.indexList = list;
        if (data && data.asOf) $('#asof').textContent = 'through ' + data.asOf;

        /* The bundled chooser is built ONLY when there is something to choose.
         *
         * It used to be in the markup unconditionally, so with nothing bundled
         * -- which is every version that has shipped -- the reader met a
         * labelled dropdown holding one option that said it was empty. A
         * control taking a full row to announce it has nothing in it is worse
         * than no control: it reads as a step to be dealt with. */
        if (list.length) {
          $('#r-index-field').innerHTML =
            '<div class="field" style="margin-top:1rem">' +
            '<label for="r-index">Bundled history</label>' +
            '<select id="r-index"></select>' +
            '<p class="hint" id="r-index-hint"></p></div>';
          var sel = $('#r-index');
          sel.innerHTML = '<option value="">Choose an index…</option>' +
            list.map(function (b, i) {
              return '<option value="' + i + '">' + esc(b.name) + '</option>';
            }).join('');
          sel.addEventListener('change', function () {
            if (sel.value === '') { clearLoaded(''); return; }
            var b = list[+sel.value];
            var series = seriesOf(b);
            R.bundled[b.name] = series;
            $('#r-index-hint').textContent =
              (b.kind === 'PRICE' ? 'Price index — dividends are not included.'
                                  : 'Total Return Index — dividends included.') +
              ' ' + b.firstDate + ' to ' + b.lastDate + '.';
            setLoaded(series, b.name, { meta: b, note: agingNote(b.lastDate) });
          });
          return;
        }

        /* Card A's file door. It used to be labelled "Index data file", which
           is the OTHER card's file, and the whole of the specification's
           root-cause analysis is about readers putting the wrong file in the
           wrong door because the doors were named alike. */
        $('#r-index-upload').innerHTML =
          '<label class="fieldlabel" for="bm-pick">Primary Investment Data file</label>' +
          dropZone('bm', 'Choose a NAV or value history file',
                   'CSV or Excel &middot; a date column and the NAV or value on that date') +
          /* The reason a file was refused belongs against the box, with
             nothing between them. The paste link went in that gap and split
             the refusal from the thing it was about. */
          '<div id="bm-status" aria-live="polite"></div>' +
          pasteHtml('bm');
        A.wireDrop('bm-drop', 'bm-file', 'bm-pick', function (file) { loadIndexFile(file); });
        wirePaste('bm', function (text, name) { loadIndexFile(pastedFile(text, name)); });
      });
  }

  /* Bundled data does not update itself. Once it is materially behind, say so
   * in years rather than leaving a date for the reader to do the arithmetic on. */
  function agingNote(lastDate) {
    var last = A.isoToTs(lastDate);
    if (isNaN(last)) return '';
    var months = (Date.now() - last) / (30.44 * 86400000);
    if (months < 9) return '';
    var years = months / 12;
    return 'This data ends ' + fmtDate(last) + ', about ' +
      (years >= 1.5 ? years.toFixed(0) + ' years' : Math.round(months) + ' months') +
      ' ago, and describes the market only up to then. Load a current index file to bring it forward.';
  }

  function seriesOf(b) {
    return b.series.map(function (p) { return { t: A.isoToTs(p[0]), v: p[1] }; })
      .filter(function (p) { return !isNaN(p.t) && p.v > 0; })
      .sort(function (x, y) { return x.t - y.t; });
  }

  /* ================================================ THE UPLOAD CONTROL
   *
   * One control, four states, and every one of them shown IN THE BOX the
   * reader just clicked.
   *
   * What was wrong: choosing a file changed nothing where the reader was
   * looking. The confirmation was a notice further down the page, so the only
   * way to find out whether a file had been accepted was to scroll and hope.
   * On a phone, with the file picker taking over the screen and handing it
   * back scrolled to the top, that is a genuinely ambiguous moment -- and the
   * natural response to it is to press Choose a file again.
   *
   * So the box itself becomes the answer: reading, added, or not added, with
   * the file's own name in it and the reason immediately underneath.
   */
  var DROP_HINT = {};

  function dropZone(prefix, aria, hint) {
    DROP_HINT[prefix] = hint;
    /* data-always-on exempts these from gateSteps.
     *
     * Section 2 puts both datasets in step 1: the reader loads the two files
     * and then configures. But Card B lives inside step 4, which gateSteps
     * disables until a primary series exists -- so a reader holding both
     * files could not load the benchmark first, and clicking it did nothing
     * and said nothing. Loading a benchmark needs no primary series; only
     * RUNNING the comparison does, and the run button is gated separately. */
    var alwaysOn = prefix === 'cmp' ? ' data-always-on="yes"' : '';
    return '<div class="filebox" id="' + prefix + '-drop" tabindex="0" role="button" ' +
             'aria-label="' + esc(aria) + '">' + dropIdleHtml(prefix, alwaysOn) + '</div>' +
           '<input type="file" id="' + prefix + '-file"' + alwaysOn +
             ' accept="' + A.FILE_ACCEPT + '">';
  }

  function dropIdleHtml(prefix, alwaysOn) {
    var on = alwaysOn != null ? alwaysOn : (prefix === 'cmp' ? ' data-always-on="yes"' : '');
    return '<button class="secondary" type="button" id="' + prefix + '-pick"' + on +
             '>Choose a file</button>' +
           '<p>' + (DROP_HINT[prefix] || 'CSV or Excel') + '</p>';
  }

  /* The pick button is rebuilt with the box. It keeps working because
   * wireDrop also opens the picker from a click anywhere on the box, and that
   * listener is on the box, which survives every redraw. */
  function dropBox(prefix) { return $('#' + prefix + '-drop'); }

  function dropState(prefix, cls, icon, name, sub, action) {
    var box = dropBox(prefix);
    if (!box) return;
    box.className = 'filebox ' + cls;
    box.innerHTML =
      '<div class="fileok">' +
        '<span class="fileok-ic" aria-hidden="true">' + icon + '</span>' +
        '<span class="fileok-t"><strong class="fileok-name">' + esc(name) + '</strong>' +
        '<span class="fileok-sub">' + sub + '</span></span>' +
      '</div>' +
      (action
        ? '<button class="secondary" type="button" id="' + prefix + '-pick"' +
          (prefix === 'cmp' ? ' data-always-on="yes"' : '') + '>' + action + '</button>'
        : '');
  }

  function dropReading(prefix, name) {
    dropState(prefix, 'working', '<span class="spin"></span>', name, 'Reading the file…', '');
    doorSays(prefix, '', 'Reading…');
  }

  /* The one the reader was missing. Named, counted and dated, so "it worked"
   * is not something they have to take on trust. */
  function dropAdded(prefix, name, report, extra) {
    var sub = extra ? esc(extra) : '';
    if (!sub && report) {
      sub = report.used.toLocaleString() + (report.used === 1 ? ' row' : ' rows') + ' read · ' +
            fmtDate(report.firstDate) + ' to ' + fmtDate(report.lastDate);
    }
    dropState(prefix, 'loaded', '✓', name,
              '<strong class="ok-word">File added successfully</strong>' +
              (sub ? ' — ' + sub : ''),
              'Choose a different file');
    doorSays(prefix, 'loaded', shortName(name));
    recordLoaded(prefix, name, report || null);
    /* Folded away only when the file actually became a series. A many-scheme
       file has left a question on the card -- which one? -- and closing the
       card over it would hide the only control that answers it. */
    if (report) openDoor('');
  }

  function dropRejected(prefix, name) {
    dropState(prefix, 'refused', '!', name,
              '<strong class="bad-word">Not added</strong> — see below',
              'Choose another file');
    doorSays(prefix, 'refused', 'Not added');
    recordLoaded(prefix, name, null);
  }

  function clearDropStatus(prefix) {
    var box = dropBox(prefix);
    if (box) { box.className = 'filebox'; box.innerHTML = dropIdleHtml(prefix); }
    var st = $('#' + prefix + '-status');
    if (st) st.innerHTML = '';
    doorSays(prefix, '', null);
    recordLoaded(prefix, null, null);
  }

  function dropSay(prefix, html) {
    var st = $('#' + prefix + '-status');
    if (st) st.innerHTML = html || '';
  }

  /* ------------------------------------------------------------- pasting
   *
   * The third way in, and for a good number of readers the only practical
   * one: the history is already open in a spreadsheet, and copying two
   * columns is fewer steps than finding Save As and then finding the file
   * again. Pasted rows arrive as {name, pastedText} and go down exactly the
   * path a file does, so there is no second reader to keep honest. */
  function pasteHtml(prefix) {
    var on = prefix === 'cmp' ? ' data-always-on="yes"' : '';
    /* Not a small link under the box any more. The phone's own file app can
       take seconds to appear and nothing on a web page can hurry it, so the
       way in that needs no file app is offered as an equal, not a footnote. */
    return '<button class="secondary pastebtn" type="button" id="' + prefix + '-paste-open"' + on + '>' +
           'Paste the two columns instead</button>' + '<p class="hint pastewhy">Opens straight away, with no file picker to wait for.</p>' +
           '<div class="pastebox" id="' + prefix + '-paste-box" hidden>' +
             '<label class="fieldlabel" for="' + prefix + '-paste-text">' +
             'Copy the date column and the value column, and paste them here</label>' +
             '<textarea id="' + prefix + '-paste-text" rows="6" spellcheck="false" ' +
               'placeholder="01-Jan-2020\t20000&#10;02-Jan-2020\t20015"></textarea>' +
             '<div class="btnrow"><button class="secondary" type="button" ' +
               'id="' + prefix + '-paste-read"' + on + '>Read these rows</button></div>' +
           '</div>';
  }

  function wirePaste(prefix, handler) {
    var open = $('#' + prefix + '-paste-open');
    var box = $('#' + prefix + '-paste-box');
    var read = $('#' + prefix + '-paste-read');
    if (!open || !box || !read) return;
    open.addEventListener('click', function () {
      box.hidden = !box.hidden;
      open.textContent = box.hidden
        ? 'Or paste the two columns from a spreadsheet'
        : 'Use a file instead';
      if (!box.hidden) $('#' + prefix + '-paste-text').focus();
    });
    read.addEventListener('click', function () {
      var text = $('#' + prefix + '-paste-text').value;
      if (!text.trim()) { dropSay(prefix, notice('bad', 'Paste some rows first.')); return; }
      handler(text, 'pasted columns');
    });
  }

  function pastedFile(text, name) {
    return { name: name || 'pasted columns', size: text.length, pastedText: text };
  }

  /* ------------------------------------------- the specification's gatekeeper
   *
   * Section 3, and it exists because shape is not schema. A tradebook has a
   * date column and a numeric column, so every reader that goes by shape
   * accepts one and computes a confident rolling return out of order
   * quantities -- a number that is wrong in a way nothing downstream can
   * detect. Only the HEADINGS tell the two files apart, so they are read
   * before the file is allowed to become a series.
   *
   * Returns the refusal to print, or null when the file may pass. The
   * detected columns are named: "this is a trade log" is a diagnosis, and a
   * diagnosis without the evidence leaves the reader nothing to act on. */
  function schemaRefusal(rows) {
    if (!rows || !P.checkSchema) return null;
    var v = P.checkSchema(rows);
    if (v.ok) return null;
    /* All of them, not a handful. The cap exists only so a pathological file
       cannot print a paragraph of column names, and at six it was cutting off
       "Order ID" -- the one column a reader would recognise instantly as
       belonging to a trade log rather than to a price history. */
    var all = (v.detected || []).filter(Boolean);
    var found = all.slice(0, 10);
    var more = all.length - found.length;
    return notice('bad', esc(v.message) +
      (found.length
        ? ' <br>The columns found in this file: <strong>' +
          found.map(function (n) { return esc(String(n)); }).join('</strong>, <strong>') +
          '</strong>' + (more ? ', and ' + more + ' more' : '') + '.'
        : ''));
  }

  /* ----------------------------------------------- the wrong-door gatekeeper
   *
   * Shape passes both doors: a fund NAV file and an index file are each a
   * date and a value, so an index dropped on card 1 — or a portfolio on
   * card 2 — used to be accepted without a word, and the analysis it fed was
   * labelled as the other thing. The words inside the file say which kind it
   * is (parse.guessDataKind), so each door now states what it expected, what
   * it found, and which door the file actually belongs to. A file that names
   * neither kind still passes: a bare date,value paste is not evidence. */
  function kindRefusal(rows, expect, fileName, door) {
    if (!rows || !P.guessDataKind) return null;
    var g = P.guessDataKind(rows, fileName);
    if (!g.kind || g.kind === expect) return null;
    var found = (g.kind === 'index' ? g.indexFound : g.navFound).slice(0, 3)
      .map(function (s) { return '<strong>' + esc(s) + '</strong>'; }).join(', ');
    if (g.kind === 'index') {
      if (door === 'fund') {
        return notice('bad',
          '<strong>This looks like index data, not a fund’s NAV.</strong> It shows ' + found +
          '. This door analyses a single fund’s own NAV history. To measure your fund ' +
          'against an index, use the <strong>Market index</strong> path: your fund’s NAV in ' +
          'card 1, the index file in card 2.');
      }
      return notice('bad',
        '<strong>This looks like index data, not your investment data.</strong> It shows ' +
        found + '. Index history belongs in card 2 — Benchmark Index Data ' +
        '(TRI). This card takes your own fund’s NAV history, CAS, or portfolio value series.');
    }
    return notice('bad',
      '<strong>This looks like fund NAV data, not index data.</strong> It shows ' +
      found + '. A fund’s NAV history belongs in card 1 — Primary Investment Data (NAV). ' +
      'This card takes the benchmark index history itself (for example, Nifty 50 TRI ' +
      'downloaded from niftyindices.com).');
  }

  /* Section 3's amber banner.
   *
   * Two files that overlap only in part are not a refusal: the comparison is
   * real over the stretch they share, and that is what gets measured. But a
   * reader has to be told BEFORE reading a rate that three years of one file
   * were dropped to make the comparison possible -- afterwards it is a
   * correction, and corrections arrive too late to change what was believed. */
  function overlapNote() {
    var slot = $('#r-overlap-note');
    if (!slot) return;
    if (R.source !== 'index' || !R.series || !E.rangeOverlap) { slot.innerHTML = ''; return; }
    var against = compareSeries();
    if (!against || !against.series || !against.series.length) { slot.innerHTML = ''; return; }
    /* Said at load time, not only in the results: by the time the gap is on
       screen the wrong conclusion has already been drawn once. */
    var mismatch = classMismatchNote(R.name || '', against.name || '', R.series, against.series);
    var o = E.rangeOverlap(R.series, against.series);
    var lines = 'Primary Investment: ' + fmtDate(o.aFrom) + ' to ' + fmtDate(o.aTo) +
                ' | Benchmark Index: ' + fmtDate(o.bFrom) + ' to ' + fmtDate(o.bTo) + '.';
    if (!o.ok) {
      slot.innerHTML = mismatch +
        notice('bad', '<strong>These two files share no dates.</strong> ' + lines +
        ' There is not one day both of them cover, so no rolling return comparison can be made ' +
        'from them.');
      return;
    }
    if (o.full) { slot.innerHTML = mismatch; return; }
    slot.innerHTML = mismatch + notice('warn', lines +
      ' <br>Note: Rolling return comparisons will automatically be restricted to the overlapping ' +
      'period (' + fmtDate(o.from) + ' to ' + fmtDate(o.to) + ', ' + o.years.toFixed(1) +
      ' years). ' + droppedPhrase(o));
  }

  /* Which file lost history, and how much of it. A reader who uploaded ten
   * years and is being measured over seven should be told which of the two
   * files cost them the other three. */
  function droppedPhrase(o) {
    var bits = [];
    if (o.lostA >= 0.05) bits.push(o.lostA.toFixed(1) + ' years of the Primary Investment data');
    if (o.lostB >= 0.05) bits.push(o.lostB.toFixed(1) + ' years of the Benchmark Index data');
    if (!bits.length) return '';
    return 'Outside that period, ' + bits.join(' and ') +
      ' ' + (bits.length > 1 ? 'are' : 'is') + ' not used.';
  }

  function loadIndexFile(file) {
    dropReading('bm', file.name);
    dropSay('bm', '');
    A.readFile(file, function (res) {
      /* The gate runs on the raw rows, before the file becomes a series: by
         the time there is a series the tradebook has already been read as
         prices and nothing downstream can tell. */
      var refused = schemaRefusal(res.rows) || kindRefusal(res.rows, 'nav', file.name);
      if (refused) {
        $('#r-scheme-wrap').hidden = true;
        dropRejected('bm', file.name);
        dropSay('bm', refused);
        clearLoaded('', { rejected: true });
        return;
      }
      var name = res.report.scheme || file.name.replace(/\.[^.]+$/, '');
      R.bundled[name] = res.series;
      R.rows = res.rows || null;
      R.schemes = null;
      $('#r-scheme-wrap').hidden = true;
      dropAdded('bm', file.name, res.report);
      setLoaded(res.series, name, { report: res.report });
    }, function (msg, extra) {
      /* This slot used to refuse a many-scheme file outright: the tool named
         the problem -- "that file holds 3 schemes" -- and then offered nothing
         to click. The picker is the same one the fund slot has always had. */
      /* Before the parser's own words, the gate's. "Only 0 usable rows could
         be read" is a true description of a tradebook and a useless one. */
      var bad = extra && extra.rows
        ? (schemaRefusal(extra.rows) || kindRefusal(extra.rows, 'nav', file.name)) : null;
      if (bad) {
        $('#r-scheme-wrap').hidden = true;
        dropRejected('bm', file.name);
        dropSay('bm', bad);
        clearLoaded('', { rejected: true });
        return;
      }
      if (extra && extra.schemes && extra.rows) {
        /* Many schemes in one file is not a failure -- the file was read, and
           read correctly. The box says so, and then asks what is left. */
        dropAdded('bm', file.name, null,
                  extra.schemes.length + ' schemes found — choose one below');
        R.rows = extra.rows;
        R.schemes = extra.schemes;
        showSchemePicker(extra.schemes, {
          rows: extra.rows,
          onPick: function (sc) {
            var res = P.rowsToSeries(extra.rows, { scheme: sc.name });
            if (!res.ok) { clearLoaded(notice('bad', esc(res.message))); return; }
            R.bundled[sc.name] = res.series;
            /* The door and the summary name the SCHEME, not the file it came
               out of: a bulk download called 120503.txt says nothing, and the
               scheme is what is being measured. */
            dropAdded('bm', sc.name, res.report);
            setLoaded(res.series, sc.name, { report: res.report });
          },
          onCombine: function () {
            combineInto(extra.schemes, extra.rows, function (series, name, opts) {
              R.bundled[name] = series;
              setLoaded(series, name, opts);
            });
          }
        });
        clearLoaded(notice('', 'That file holds <strong>' + extra.schemes.length +
          '</strong> schemes. Choose one below, or all of them together.'));
        return;
      }
      $('#r-scheme-wrap').hidden = true;
      dropRejected('bm', file.name);
      dropSay('bm', notice('bad', esc(msg)));
      clearLoaded('', { rejected: true });
    },
    function () { /* the box already says it is reading */ });
  }

  /* ----------------------------------------------------------------- fund */

  function loadFundFile(file) {
    dropReading('f', file.name);
    dropSay('f', '');
    A.readFile(file, function (res) {
      /* The same wrong-door gate as the index path's two cards: an index file
         here would be analysed under a fund's name. */
      var refused = schemaRefusal(res.rows) || kindRefusal(res.rows, 'nav', file.name, 'fund');
      if (refused) {
        $('#r-scheme-wrap').hidden = true;
        dropRejected('f', file.name);
        dropSay('f', refused);
        clearLoaded('', { rejected: true });
        return;
      }
      R.rows = res.rows || null;
      R.schemes = null;
      $('#r-scheme-wrap').hidden = true;
      dropAdded('f', file.name, res.report);
      setLoaded(res.series, res.report.scheme || file.name.replace(/\.[^.]+$/, ''),
                { report: res.report });
    }, function (msg, extra) {
      var gated = extra && extra.rows
        ? (schemaRefusal(extra.rows) || kindRefusal(extra.rows, 'nav', file.name, 'fund')) : null;
      if (gated) {
        $('#r-scheme-wrap').hidden = true;
        dropRejected('f', file.name);
        dropSay('f', gated);
        clearLoaded('', { rejected: true });
        return;
      }
      /* one file, many schemes: let the reader pick theirs out of it */
      if (extra && extra.schemes && extra.rows) {
        dropAdded('f', file.name, null,
                  extra.schemes.length + ' funds found — choose one below');
        R.rows = extra.rows;
        R.schemes = extra.schemes;
        showSchemePicker(extra.schemes, { rows: extra.rows });
        clearLoaded(notice('', 'That file holds <strong>' + extra.schemes.length +
          '</strong> funds. Choose one below, or all of them together.'));
        return;
      }
      $('#r-scheme-wrap').hidden = true;
      dropRejected('f', file.name);
      dropSay('f', notice('bad', esc(msg)));
      clearLoaded('', { rejected: true });
    }, function () { /* the box already says it is reading */ });
  }

  /* Thousands of funds cannot be chosen from a dropdown on a phone. Filter as
   * they type, cap what is drawn, and say how many more are waiting. */
  var MAX_HITS = 40;

  /* One picker, for whichever slot the many-scheme file arrived at.
   *
   * It used to serve step 1's FUND slot alone, and it lived inside that block.
   * A file holding several schemes can arrive at step 1's index slot or at
   * step 4's benchmark slot just as easily, and both of those refused it with a
   * red line and nothing to click -- the tool naming the problem and then
   * offering no way out of it.
   *
   * `into` names the three elements to draw in, so step 4 can have its own set
   * without borrowing step 1's. `onPick` decides what a chosen scheme becomes:
   * the thing being analysed, or the thing it is measured against. */
  function showSchemePicker(schemes, opts) {
    var o = opts || {};
    var ids = o.ids || { wrap: 'r-scheme-wrap', q: 'r-scheme-q',
                         count: 'r-scheme-count', list: 'r-scheme-list' };
    var rows = o.rows || R.rows;
    var onPick = o.onPick || function (sc) {
      var res = P.rowsToSeries(rows, { scheme: sc.name });
      if (!res.ok) { clearLoaded(notice('bad', esc(res.message))); return; }
      setLoaded(res.series, sc.name, { report: res.report });
    };
    var onCombine = o.onCombine || function () { combineInto(schemes, rows, setLoaded); };

    var wrap = $('#' + ids.wrap), q = $('#' + ids.q);
    wrap.hidden = false;
    q.value = '';
    render('');
    q.oninput = function () { render(q.value); };
    q.focus();

    function render(term) {
      var needle = term.trim().toLowerCase();
      var hits = needle
        ? schemes.filter(function (sc) { return sc.name.toLowerCase().indexOf(needle) !== -1; })
        : schemes;
      $('#' + ids.count).textContent = schemes.length.toLocaleString() +
        (schemes.length === 1 ? ' fund in this file' : ' funds in this file') +
        (needle ? ' \u00b7 ' + hits.length.toLocaleString() + ' match' + (hits.length === 1 ? '' : 'es')
                : ' \u2014 type to narrow the list');

      var list = $('#' + ids.list);
      if (!hits.length) {
        list.innerHTML = '<p class="more">Nothing matches \u201c' + esc(term) + '\u201d.</p>';
        return;
      }
      /* All of them at once, offered first, and only when the whole list is in
         view -- combining a filtered subset would silently measure something
         other than what the row says. */
      var all = (!needle && schemes.length > 1)
        ? '<button class="hit combined" type="button" role="option" aria-selected="false" ' +
          'data-all="1"><span class="nm">All ' + schemes.length +
          ' together, equal amounts at the start</span><span class="sub">Bought in equal amounts ' +
          'on the first date they all share and never rebalanced \u2014 a composite of these ' +
          'schemes, not your own portfolio</span></button>'
        : '';
      list.innerHTML = all + hits.slice(0, MAX_HITS).map(function (sc, i) {
        /* rows are prices, not calendar days: a fund has no price at a weekend */
        var count = sc.rows === 1 ? 'one price only' : sc.rows.toLocaleString() + ' prices';
        return '<button class="hit" type="button" role="option" aria-selected="false" ' +
          'data-i="' + i + '"><span class="nm">' + esc(sc.name) + '</span>' +
          '<span class="sub">' + fmtDate(sc.first) + ' to ' + fmtDate(sc.last) +
          ' \u00b7 ' + count + '</span></button>';
      }).join('') +
        (hits.length > MAX_HITS
          ? '<p class="more">' + (hits.length - MAX_HITS).toLocaleString() +
            ' more \u2014 keep typing to narrow them down.</p>'
          : '');

      $$('#' + ids.list + ' .hit').forEach(function (btn) {
        btn.addEventListener('click', function () {
          $$('#' + ids.list + ' .hit').forEach(function (o) {
            o.setAttribute('aria-selected', 'false');
          });
          btn.setAttribute('aria-selected', 'true');
          if (btn.dataset.all) { onCombine(); return; }
          onPick(hits[+btn.dataset.i]);
        });
      });
    }
  }

  /* Every scheme in the file, rebased and averaged. The name says what it is,
   * because a composite that reads like a fund would be a fund nobody holds. */
  function combineInto(schemes, rows, land) {
    var list = [], failed = [];
    schemes.forEach(function (sc) {
      var res = P.rowsToSeries(rows, { scheme: sc.name });
      if (res.ok) list.push(res.series); else failed.push(sc.name);
    });
    var made = E.combineEqualWeighted(list);
    if (!made.ok) { clearLoaded(notice('bad', esc(made.message))); return; }
    land(made.series, 'All ' + made.count + ' together, equal amounts at the start', {
      note: 'Equal amounts bought on ' + fmtDate(made.from) + ', the first date all ' + made.count +
            ' share, and never rebalanced \u2014 so the weights are equal on that day only, and ' +
            'drift afterwards toward whichever grew fastest, exactly as a real basket would. ' +
            'Equal amounts is an assumption this makes, not a fact it knows: a composite weighted ' +
            'the way your money actually is would read differently.' +
            (failed.length ? ' ' + failed.length + ' could not be read and were left out.' : '')
    });
  }

  /* ------------------------------------------------------------- controls */

  function refreshCompare() {
    var sel = $('#r-compare');
    var keep = sel.value;
    var names = Object.keys(R.bundled).filter(function (n) { return n !== R.name; });
    (R.indexList || []).forEach(function (b) {
      if (b.name !== R.name && names.indexOf(b.name) === -1) names.push(b.name);
    });
    sel.innerHTML = '<option value="none">Nothing — just what I chose above</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    if (names.indexOf(keep) !== -1) sel.value = keep;
    sel.disabled = !names.length;
    $('#step-compare').dataset.done = sel.value !== 'none' ? 'yes' : 'no';
    placeCompareField(R.source === 'index');

    var hint = $('#r-compare-hint'), box = $('#r-compare-upload');
    /* The upload stays while a many-scheme file is loaded here, so the reader
     * can move from one scheme to the next without loading the file again.
     * It used to be wiped the moment a benchmark existed -- which meant
     * choosing scheme 1 destroyed the only way to reach schemes 2 and 3. */
    /* Card B is a permanent door on the market-index path, where section 2
     * names it and says what belongs behind it. It used to be wiped the
     * moment a benchmark existed, which left a reader who had loaded the
     * wrong TRI with no way to load another short of Start again. */
    if (!names.length || R.cmpSchemes || R.source === 'index') {
      hint.textContent = R.source === 'index'
        /* The upload is in step 1 now, so pointing at "below" would point at
           nothing. What is left here is the choice, not the loading. */
        ? (names.length
            ? 'A benchmark is a reference point, not a verdict. Only dates both sets of data ' +
              'cover are compared. Load another index file in step 1 to add to this list.'
            : 'Load a benchmark index file in step 1 — card 2 — and it appears here.')
        : names.length
          ? 'A benchmark is a reference point, not a verdict. Only dates both sets of data cover ' +
            'are compared. Pick another below at any time.'
          : 'Nothing to compare against yet. This version bundles no index data, ' +
            'so load an index file here and it becomes available as a benchmark.';
      if (!$('#cmp-file')) {
        box.innerHTML =
          '<label class="fieldlabel" for="cmp-pick">Benchmark index data file</label>' +
          dropZone('cmp', 'Choose an index history file',
                   'CSV or Excel &middot; a date column and the index value on that date') +
          '<div id="cmp-status" aria-live="polite"></div>' +
          '<div id="cmp-kind"></div>' +
          pasteHtml('cmp') +
          '<div id="cmp-note" aria-live="polite"></div>' +
          /* This slot's own picker. It had none: a many-scheme file dropped
             here produced the red line in the screenshot and no control. */
          '<div id="cmp-scheme-wrap" hidden style="margin-top:1rem">' +
            '<div class="field">' +
              '<label for="cmp-scheme-q">Which one in that file?</label>' +
              '<input type="text" id="cmp-scheme-q" autocomplete="off" placeholder="Type part of the name">' +
              '<p class="hint" id="cmp-scheme-count"></p>' +
            '</div>' +
            '<div id="cmp-scheme-list" class="picker" role="listbox" ' +
              'aria-label="Schemes in this file"></div>' +
            '<p class="hint">Whichever you pick becomes the benchmark. Pick another at any time ' +
            'to measure against that one instead.</p>' +
          '</div>';

        var CMP_IDS = { wrap: 'cmp-scheme-wrap', q: 'cmp-scheme-q',
                        count: 'cmp-scheme-count', list: 'cmp-scheme-list' };

        function useAsBenchmark(series, nm) {
          R.bundled[nm] = series;
          refreshCompare();
          $('#r-compare').value = nm;
          $('#step-compare').dataset.done = 'yes';
          overlapNote();
          askIndexKind(nm);
          if (R.ran) runRolling();
        }

        function readBenchmark(file) {
          dropReading('cmp', file.name);
          dropSay('cmp', '');
          $('#cmp-note').innerHTML = '';
          A.readFile(file, function (res) {
            /* Section 3 gates BOTH doors. A tradebook dropped on the benchmark
               slot is exactly as wrong as one dropped on the primary slot, and
               would be harder to spot: it would arrive as a comparison line
               rather than as the headline figure. Market-index path only. */
            var refused = R.source === 'index'
              ? (schemaRefusal(res.rows) || kindRefusal(res.rows, 'index', file.name)) : null;
            if (refused) { dropRejected('cmp', file.name); dropSay('cmp', refused); return; }
            var nm = res.report.scheme || file.name.replace(/\.[^.]+$/, '');
            dropAdded('cmp', file.name, res.report);
            useAsBenchmark(res.series, nm);
          }, function (msg, extra) {
            var gated = (R.source === 'index' && extra && extra.rows)
              ? (schemaRefusal(extra.rows) || kindRefusal(extra.rows, 'index', file.name)) : null;
            if (gated) { dropRejected('cmp', file.name); dropSay('cmp', gated); return; }
            if (extra && extra.schemes && extra.rows) {
              dropAdded('cmp', file.name, null,
                        extra.schemes.length + ' schemes found — choose one below');
              R.cmpSchemes = extra.schemes;
              R.cmpRows = extra.rows;
              $('#cmp-note').innerHTML = notice('', 'That file holds <strong>' +
                extra.schemes.length + '</strong> schemes. Choose one below, or all of them ' +
                'together, and it becomes the benchmark.');
              showSchemePicker(extra.schemes, {
                ids: CMP_IDS,
                rows: extra.rows,
                onPick: function (sc) {
                  var r2 = P.rowsToSeries(extra.rows, { scheme: sc.name });
                  if (!r2.ok) { $('#cmp-note').innerHTML = notice('bad', esc(r2.message)); return; }
                  dropAdded('cmp', sc.name, r2.report);
                  useAsBenchmark(r2.series, sc.name);
                },
                onCombine: function () {
                  combineInto(extra.schemes, extra.rows, function (series, nm2, opts) {
                    useAsBenchmark(series, nm2);
                    $('#cmp-note').innerHTML = notice('', esc(opts.note));
                  });
                }
              });
              return;
            }
            dropRejected('cmp', file.name);
            dropSay('cmp', notice('bad', esc(msg)));
          }, function () { /* the box already says it is reading */ });
        }

        A.wireDrop('cmp-drop', 'cmp-file', 'cmp-pick', readBenchmark);
        wirePaste('cmp', function (text, nm) { readBenchmark(pastedFile(text, nm)); });
      }
      /* Rebuilt box, or a rebuilt list of names: either way the picker has to
         come back, or switching benchmark once removes the ability to switch
         again. */
      if (R.cmpSchemes && R.cmpRows) restoreComparePicker();
    } else {
      hint.textContent = 'A benchmark is a reference point, not a verdict. Only dates both sets ' +
        'of data cover are compared.';
      box.innerHTML = '';
    }
  }

  function restoreComparePicker() {
    if (!$('#cmp-scheme-wrap')) return;
    var schemes = R.cmpSchemes, rows = R.cmpRows;
    function useAsBenchmark(series, nm) {
      R.bundled[nm] = series;
      refreshCompare();
      $('#r-compare').value = nm;
      $('#step-compare').dataset.done = 'yes';
      overlapNote();
      askIndexKind(nm);
      if (R.ran) runRolling();
    }
    showSchemePicker(schemes, {
      ids: { wrap: 'cmp-scheme-wrap', q: 'cmp-scheme-q',
             count: 'cmp-scheme-count', list: 'cmp-scheme-list' },
      rows: rows,
      onPick: function (sc) {
        var r2 = P.rowsToSeries(rows, { scheme: sc.name });
        if (!r2.ok) { $('#cmp-note').innerHTML = notice('bad', esc(r2.message)); return; }
        dropAdded('cmp', sc.name, r2.report);
        useAsBenchmark(r2.series, sc.name);
      },
      onCombine: function () {
        combineInto(schemes, rows, function (series, nm2, opts) {
          useAsBenchmark(series, nm2);
          $('#cmp-note').innerHTML = notice('', esc(opts.note));
        });
      }
    });
  }

  /* ============================== TOTAL RETURN, OR PRICE RETURN?
   *
   * Card B's header says "(TRI)" and its rule says to use one. Both are
   * assertions about a file the tool had never looked at.
   *
   * It matters more than a label. A price index leaves dividends out; a fund's
   * NAV puts them back in. Compare the two and the fund wins by roughly the
   * market's dividend yield before it has done anything at all -- about 1 to
   * 1.5 points a year on Indian equity indices, which is larger than most of
   * the gaps this screen is used to argue about. Every outperformance figure
   * on the page inherits it, silently, and nothing downstream can detect it.
   *
   * So the screen establishes the fact instead of asserting it: read from the
   * file's own name where the file says, asked where it does not, and stated
   * as unknown until one of the two is true. */
  var TRI_RE = /\b(tri|total\s*returns?\s*index|total\s*returns?)\b/i;
  var PRICE_RE = /\b(pri|price\s*returns?\s*index|price\s*returns?|price\s*index)\b/i;

  function guessIndexKind(name) {
    /* Separators become spaces before anything is matched.
     *
     * What gets read here is usually a FILENAME, and nobody downloads
     * "Nifty 50 Price Return Index.csv" -- they download
     * nifty-50-price-return-index.csv or nifty_50_pri.csv. A hyphen defeats
     * \s*, and an underscore is a word character so it defeats \b as well:
     * before this, the first was read as a total return index and the second
     * as nothing at all. Normalising once is simpler than teaching every
     * pattern about punctuation, and it cannot be got half right. */
    var t = String(name || '').replace(/[_.\-]+/g, ' ');
    /* Price first: "Nifty 50 Price Return Index" contains neither TRI nor
       "total return", but a file called "Nifty 50 TRI (Price adjusted)" would
       match both and the narrower claim should not win by ordering luck. */
    if (PRICE_RE.test(t) && !TRI_RE.test(t)) return 'PRICE';
    if (TRI_RE.test(t)) return 'TRI';
    return null;
  }

  function kindMeta(name) {
    return { name: name, kind: R.kinds[name] || null };
  }

  function askIndexKind(name) {
    var slot = $('#cmp-kind');
    if (!slot) return;
    if (R.source !== 'index' || !name) { slot.innerHTML = ''; return; }
    if (!(name in R.kinds) || R.kinds[name] == null) {
      R.kinds[name] = guessIndexKind(name);
    }
    var k = R.kinds[name];
    slot.innerHTML =
      '<div class="field" style="margin-top:1rem">' +
        '<span class="fieldlabel" id="cmp-kind-label">Does <strong>' + esc(name) +
          '</strong> include dividends?</span>' +
        '<div class="chips" id="cmp-kind-chips" role="radiogroup" aria-labelledby="cmp-kind-label">' +
          kindChip('TRI', 'Total Return Index — dividends included', k) +
          kindChip('PRICE', 'Price index — dividends excluded', k) +
        '</div>' +
        '<p class="hint" id="cmp-kind-why"></p>' +
      '</div>';
    $$('#cmp-kind-chips .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        R.kinds[name] = b.dataset.kind;
        $$('#cmp-kind-chips .chip').forEach(function (c) {
          c.setAttribute('aria-checked', String(c === b));
        });
        sayIndexKind(name);
        renderLoadedList();
        if (R.ran) runRolling();
      });
    });
    sayIndexKind(name);
    renderLoadedList();
  }

  function kindChip(kind, label, chosen) {
    return '<button class="chip" type="button" role="radio" data-kind="' + kind + '" ' +
           'data-always-on="yes" aria-checked="' + String(chosen === kind) + '">' +
           label + '</button>';
  }

  function sayIndexKind(name) {
    var why = $('#cmp-kind-why');
    if (!why) return;
    var k = R.kinds[name];
    if (k === 'PRICE') {
      why.innerHTML = 'A price index leaves dividends out while a fund’s NAV puts them back ' +
        'in, so every outperformance figure below flatters the fund by roughly the market’s ' +
        'dividend yield — about 1 to 1.5 points a year on Indian equity indices. Use a total ' +
        'return version of this index if the provider offers one.';
      why.className = 'hint refuse';
    } else if (k === 'TRI') {
      why.innerHTML = 'Dividends are counted on both sides, so the comparison is like for like.' +
        (guessIndexKind(name) === 'TRI'
          ? ' Read from the name of the file you loaded — change it if that is wrong.' : '');
      why.className = 'hint';
    } else {
      why.innerHTML = '<strong>Not established.</strong> The file does not say, and until you do ' +
        'the figures below cannot tell you whether a gap is real or just the dividends the index ' +
        'leaves out. Check the page you downloaded it from: providers publish both, and the ' +
        'difference is about 1 to 1.5 points a year.';
      why.className = 'hint';
    }
  }

  function compareSeries() {
    var sel = $('#r-compare');
    var name = sel.value;
    if (!name || name === 'none') return null;
    var bMeta = (R.indexList || []).filter(function (x) { return x.name === name; })[0] || null;
    if (R.bundled[name]) {
      return { name: name, series: R.bundled[name], meta: bMeta || kindMeta(name) };
    }
    var b = (R.indexList || []).filter(function (x) { return x.name === name; })[0];
    if (!b) return null;
    R.bundled[name] = seriesOf(b);
    return { name: name, series: R.bundled[name], meta: b };
  }

  /* Review v4 §12.15: "Choose something to analyse first" sat under date fields
   * that were themselves enabled, so a reader could fill in boxes that did
   * nothing. The later steps are greyed and their controls disabled until the
   * step above them is satisfied, which says the same thing without a sentence. */
  function gateSteps() {
    var haveSeries = !!R.series;
    [['#step-period', haveSeries], ['#step-hold', haveSeries],
     ['#step-compare', haveSeries]].forEach(function (pair) {
      var card = $(pair[0]);
      if (!card) return;
      card.dataset.locked = pair[1] ? 'no' : 'yes';
      A.$$('input, select, button', card).forEach(function (el) {
        if (el.dataset.alwaysOn === 'yes') return;
        el.disabled = !pair[1] || el.dataset.infeasible === 'yes';
      });
    });
    /* Once a series is loaded, step 2 writes its own "Data available:" line,
       so this only ever clears the placeholder it put there. */
    var range = $('#r-range');
    if (range && !haveSeries) range.textContent = 'Choose something to analyse first.';
  }

  /* The refusal, said in the step that holds the answer.
   *
   * Clicking a button that will not run and will not say why is the worst
   * thing a screen can do to somebody, and it is exactly what this did: with
   * no length chosen, runRolling cleared the output and returned. */
  function holdError(message) {
    var step = $('#step-hold'), slot = $('#r-hold-error');
    if (!step || !slot) return;
    if (!message) {
      step.dataset.error = 'no';
      slot.hidden = true;
      slot.textContent = '';
      return;
    }
    step.dataset.error = 'yes';
    slot.hidden = false;
    slot.textContent = message;
    if (step.scrollIntoView) step.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* Not a refusal: the run is allowed and the numbers are real. It says the
   * range they came from is thinner than the file's own helper text asks for,
   * which is a thing to know BEFORE reading a median, not after. */
  function spanWarning() {
    var slot = $('#r-span-warn');
    if (!slot) return;
    if (!R.series || R.years === null) { slot.hidden = true; slot.textContent = ''; return; }
    var span = (R.series[R.series.length - 1].t - R.series[0].t) / (365.2425 * 86400000);
    var want = recommendedYears(R.years);
    if (span >= want) { slot.hidden = true; slot.textContent = ''; return; }
    slot.hidden = false;
    slot.textContent = 'This file covers ' + span.toFixed(1) + ' years. For ' + R.years +
      '-year windows, ' + want + '+ years is the recommended amount of history. The figures below ' +
      'will still be worked out, but every window will begin inside a narrow band of dates.';
  }

  function yearChips() {
    var box = $('#r-years');
    box.innerHTML = '';
    $('#step-hold').dataset.done = R.years === null ? 'no' : 'yes';
    /* Section 4 asks for a Max History choice beyond the fixed five.
     *
     * It is a real number of years, not a keyword: the whole screen -- the
     * window note, the feasibility check on every chip, the refusal when a
     * length will not fit -- is arithmetic on R.years, and a chip holding the
     * string "max" would have poisoned all of it with NaN. So the longest
     * whole number of years this history can measure is computed once and the
     * chip carries that, with the label saying what it came from.
     *
     * It is offered only when it adds something: on a four-year file the
     * longest whole horizon is 3, which is already on the row. */
    var horizons = A.HORIZONS.slice();
    var extra = null;
    if (R.source === 'index' && R.series && E.maxHorizon) {
      var m = E.maxHorizon(R.series);
      if (m !== null && horizons.indexOf(m) === -1) { horizons.push(m); extra = m; }
    }
    horizons.sort(function (a, b) { return a - b; });
    horizons.forEach(function (h) {
      var b = A.el('button', { class: 'chip', type: 'button', role: 'radio',
                               'aria-checked': String(h === R.years) });
      b.dataset.years = h;
      if (h === extra) b.dataset.label = 'Max History \u2014 ' + h + ' years';
      b.textContent = chipLabel(b, h);
      b.addEventListener('click', function () {
        if (b.disabled) return;
        R.years = h;
        $$('#r-years .chip').forEach(function (c) {
          c.setAttribute('aria-checked', String(c === b));
        });
        $('#step-hold').dataset.done = 'yes';
        R.blockMessage = null;
        holdError(null);
        updateWindowNote();
        spanWarning();
        if (R.ran) runRolling();
      });
      box.appendChild(b);
    });
  }

  /* A chip's own name, where it has one, so limitYears redrawing the row does
     not rub "Max History" off it. */
  function chipLabel(chip, h) {
    return chip.dataset.label || (h + (h === 1 ? ' year' : ' years'));
  }

  /* Section 4's rolling frequency, on the market-index path.
   *
   * What this changes is HOW MANY start dates are taken, and nothing else. A
   * five-year window measured from a monthly start date is still measured
   * over five years, first value to last. Daily is the default and says so:
   * it uses every start date the file offers, which is the honest one, and
   * the other two exist because a twenty-year daily file yields ~4,000
   * overlapping windows whose neighbours share 1,824 of 1,825 days. */
  function freqChips() {
    var box = $('#r-freq');
    if (!box || !E.FREQUENCY) return;
    box.innerHTML = '';

    /* A STEP SIZE THE DATA CANNOT TAKE IS NOT OFFERED.
     *
     * This row said "Daily \u2014 Recommended" over a file holding 29 values
     * across seven years. The engine was never fooled -- windows are dropped,
     * not stretched, when the dates are not there -- but the label promised a
     * fineness the file does not have, and a reader could only find out how
     * few windows they really got after running. So the chips read the file's
     * own cadence first: a file with a value every ~90 days has no daily steps
     * in it, and the chip says so instead of recommending them. */
    var gap = R.series ? E.medianGapDays(R.series) : null;
    var can = {
      daily:   gap == null || gap <= 3.5,
      weekly:  gap == null || gap <= 10,
      monthly: true
    };
    if (!can[R.frequency]) {
      R.frequency = can.weekly ? 'weekly' : 'monthly';
    }

    var order = ['daily', 'weekly', 'monthly'];
    var says = {
      daily:   'Daily \u2014 Recommended (shifts by 1 trading day)',
      weekly:  'Weekly (7 days)',
      monthly: 'Monthly (1 calendar month)'
    };
    order.forEach(function (key) {
      var b = A.el('button', { class: 'chip', type: 'button', role: 'radio',
                               'aria-checked': String(key === R.frequency) });
      b.dataset.frequency = key;
      b.disabled = !can[key];
      /* gateSteps re-walks every control in this step whenever the gate
         changes, and re-enables whatever it does not know to be infeasible.
         The year chips carry this marker for exactly that reason. */
      b.dataset.infeasible = can[key] ? 'no' : 'yes';
      b.textContent = can[key] ? says[key]
        : says[key].replace(' \u2014 Recommended', '') +
          ' \u2014 this file has a value about every ' + Math.round(gap) + ' days';
      b.addEventListener('click', function () {
        if (b.disabled) return;
        R.frequency = key;
        $$('#r-freq .chip').forEach(function (c) {
          c.setAttribute('aria-checked', String(c === b));
        });
        if (R.ran) runRolling();
      });
      box.appendChild(b);
    });

    /* Sparser than monthly: no step size has anything left to thin. Said once
       under the row rather than three times on the chips. */
    var note = $('#r-freq-note');
    if (!note) {
      note = A.el('p', { class: 'hint', id: 'r-freq-note' });
      box.parentNode.insertBefore(note, box.nextSibling);
    }
    note.textContent = (gap != null && gap > 31)
      ? 'This file holds a value about every ' + Math.round(gap) + ' days, so every ' +
        'observation is already further apart than any of these steps. All of them use ' +
        'every start date the file has.'
      : '';
  }

  /* Offering "10 years" on a three-year file invites a reader to choose it and
   * only then be told no. Say it on the chip instead. */
  function limitYears(spanYears) {
    var best = null;
    R.blockMessage = null;
    $$('#r-years .chip').forEach(function (c) {
      var h = +c.dataset.years;
      var possible = spanYears == null || h <= spanYears;
      c.dataset.infeasible = possible ? 'no' : 'yes';
      c.disabled = !possible;
      c.textContent = chipLabel(c, h) +
        (possible ? '' : ' \u2014 needs ' + h + ' years of data');
      if (possible) best = h;
    });
    /* A length the history cannot measure is cleared rather than swapped for
       one the reader did not ask for: silently moving them from 10 years to 3
       is the same recommendation the default was. */
    if (R.years !== null && best !== null && R.years > best) {
      /* Not one holding period of the chosen length fits inside this history,
       * so there is no range to compute -- that is arithmetic, not judgement,
       * and it is the one hard stop on this screen.
       *
       * The choice is CLEARED rather than slid down to a shorter length: moving
       * a reader from five years to one after they have looked away is the same
       * recommendation a default is. And the block says which two numbers did
       * not fit, in the results area where the answer would have been, so the
       * reader is not left to work out why the chips changed under them. */
      var wanted = R.years;
      R.years = null;
      $('#step-hold').dataset.done = 'no';
      $$('#r-years .chip').forEach(function (c) { c.setAttribute('aria-checked', 'false'); });
      R.blockMessage = notice('bad',
        (R.source === 'index'
          ? '<strong>Selected holding period (' + wanted + ' Years) requires at least ' + wanted +
            ' years of historical data. Your file covers ' + ymText(spanYears) + '.</strong> '
          : '<strong>This history is shorter than the holding period.</strong> It covers ' +
            spanYears.toFixed(1) + ' years and ' + wanted + '-year windows need ' + wanted +
            ', so not one full ' + wanted + '-year period fits inside it. ') +
        (best === null
          ? 'Load a longer history.'
          : 'Choose ' + best + (best === 1 ? ' year' : ' years') +
            ' or shorter in step 3, or load a longer history.'));
      var out = $('#r-out');
      if (out) out.innerHTML = R.blockMessage;
    }
    spanWarning();
  }

  /* 4.9 years of history said as "4 Years, 11 Months", the way the review
     words the block, so the reader sees the shortfall in units they count in. */
  function ymText(spanYears) {
    var months = Math.floor(spanYears * 12 + 1e-9);
    var y = Math.floor(months / 12), m = months % 12;
    var bits = [];
    if (y) bits.push(y + (y === 1 ? ' Year' : ' Years'));
    if (m || !y) bits.push(m + (m === 1 ? ' Month' : ' Months'));
    return bits.join(', ');
  }

  /* The About paragraph is the author's, and it lives in one place: slot
   * ABOUT-MAIN in sim/copy.json, generated into v3/deck.js. This page used to
   * carry a transcript of it, and the transcript went stale the moment the
   * paragraph was corrected -- which is how a tool that fetches nothing came to
   * have an About page saying it fetched. Read, never copied. */
  function fillAbout() {
    var host = $('#about-main');
    if (!host) return;
    var deck = window.SIM_COPY;
    var slot = deck && deck.slots && deck.slots['ABOUT-MAIN'];
    host.textContent = (slot && slot.text) ||
      'The About paragraph has not been written into the copy deck yet.';
  }

  /* -------------------------------------------------------------- the run */

  function runRolling() {
    var out = $('#r-out');
    if (!R.series) { out.innerHTML = ''; return; }
    /* This used to clear the output and return, which meant pressing the button
       did nothing at all and said nothing at all. The step that holds the
       answer now says what is missing, in the step. */
    if (R.years === null) {
      /* Keep whatever limitYears put here. A run triggered by the same date
         change that caused the block would otherwise erase the explanation
         for the block, which is the one thing the reader needs. */
      out.innerHTML = R.blockMessage || '';
      holdError('Please select a holding period to continue');
      return;
    }
    holdError(null);

    var from = A.isoToTs($('#r-start').value);
    var to = A.isoToTs($('#r-end').value);
    if (isNaN(from) || isNaN(to)) {
      out.innerHTML = notice('bad', 'Enter both a start date and an end date.');
      return;
    }
    if (from >= to) {
      out.innerHTML = notice('bad', 'The end date must be after the start date.');
      return;
    }
    var series = P.sliceSeries(R.series, from, to);
    if (series.length < 2) {
      out.innerHTML = notice('bad', 'There is no data between those two dates.');
      return;
    }
    /* The one hard stop. Short history makes a range worth doubting, and the
     * warning above says so; history SHORTER THAN THE WINDOW ITSELF makes no
     * range at all, because not one holding period of that length fits inside
     * it. That is arithmetic, not judgement, so it refuses rather than warns. */
    var chosenSpan = (to - from) / (365.2425 * 86400000);
    if (chosenSpan < R.years) {
      /* "Your file covers" only when the dates are the whole file; once the
         reader has narrowed them in step 2 it is the dates that are short. */
      var wholeFile = R.series.length > 1 && from <= R.series[0].t && to >= R.series[R.series.length - 1].t;
      out.innerHTML = notice('bad', R.source === 'index'
        ? '<strong>Selected holding period (' + R.years + ' Years) requires at least ' + R.years +
          ' years of historical data. ' + (wholeFile ? 'Your file covers ' : 'Your selected dates cover ') +
          ymText(chosenSpan) + '.</strong> ' +
          (wholeFile ? 'Choose a shorter holding period in step 3, or load a longer history.'
                     : 'Choose a shorter holding period in step 3, or widen the dates in step 2.')
        : '<strong>This stretch is shorter than the holding period.</strong> The dates in step 2 cover ' +
          chosenSpan.toFixed(1) + ' years and you asked for ' + R.years + '-year windows, so not one ' +
          'full ' + R.years + '-year period fits inside them. Choose a shorter holding period in step 3, ' +
          'or widen the dates in step 2.');
      return;
    }
    /* Report the dates the data actually reaches, never the ones typed: a
       weekend or a holiday would otherwise put two different periods on one
       screen. */
    var usedFrom = series[0].t, usedTo = series[series.length - 1].t;
    var span = (usedTo - usedFrom) / (365.2425 * 86400000);
    if (span < R.years) {
      out.innerHTML = notice('bad', 'That leaves ' + span.toFixed(1) + ' years of history, and each ' +
        'holding period is ' + R.years + ' years long. Widen the dates, or choose a shorter holding ' +
        'period.');
      return;
    }
    var against = compareSeries();
    var cmpSeries = against ? P.sliceSeries(against.series, from, to) : null;
    var warning = '';
    if (against && cmpSeries.length < 2) {
      cmpSeries = null;
      warning = notice('bad', esc(against.name) + ' has no data between those dates, so no ' +
        'comparison is shown. Widen the dates, or choose a different benchmark.');
    }

    R.ran = true;
    /* The reviewer's four regulatory pillars, three of which already stand in
       the footer. The one they wanted made PROMINENT goes first, before any
       number: what follows already happened. One correction to their text,
       though: they asked for "expense ratios will reduce actual yield", and
       for NAV figures that is false -- a fund's NAV is already net of its
       expense ratio. The strip says what is actually true instead. */
    out.innerHTML =
      '<p class="pastnote"><strong>Already happened \u2014 not a forecast.</strong> Past rolling ' +
      'returns do not guarantee future performance. Figures are before tax and exit load; a ' +
      'fund\u2019s NAV already includes its expense ratio. Worked out on your device \u2014 ' +
      'nothing you upload leaves this page.</p>' +
      warning +
      periodCard(from, to, usedFrom, usedTo, R.years, R.name) +
      (R.meta ? datasetCard(R.meta, series) : '') +
      (R.report ? importReport(R.report, R.name) : '') +
      renderRolling(series, R.years, { name: R.name },
                    cmpSeries, against ? against.name : '', 'rolling',
                    against ? against.meta : null,
                    { frequency: R.frequency, indexPath: R.source === 'index' });
    out.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* What was actually measured, stated before any result. */
  function periodCard(from, to, usedFrom, usedTo, years, name) {
    var drifted = Math.abs(dayGap(from, usedFrom)) > 3 || Math.abs(dayGap(to, usedTo)) > 3;
    var lastStart = E.addYears(usedTo, -years);
    return '<div class="card"><h2>What was measured</h2><div class="scroll">' +
      '<table class="data"><tbody>' +
      '<tr><td>Fund or index</td><td>' + esc(name) + '</td></tr>' +
      '<tr><td>History searched</td><td>' + fmtDate(usedFrom) + ' to ' + fmtDate(usedTo) + '</td></tr>' +
      (drifted
        ? '<tr><td>You asked for</td><td>' + fmtDate(from) + ' to ' + fmtDate(to) +
          '; the nearest data is above</td></tr>'
        : '') +
      '<tr><td>Each holding period</td><td>' + years + (years === 1 ? ' year' : ' years') + '</td></tr>' +
      '<tr><td>Start dates measured</td><td>' + fmtDate(usedFrom) + ' to ' + fmtDate(lastStart) +
      '</td></tr>' +
      '</tbody></table></div>' +
      '<p class="hint" style="margin:.6rem 0 0">A holding period cannot start later than ' +
      fmtDate(lastStart) + ', because there would not be ' + years +
      (years === 1 ? ' year' : ' years') + ' of history left to measure it over.</p></div>';
  }

  function dayGap(a, b) { return Math.round((b - a) / 86400000); }

  /* Where the numbers came from, and what they can and cannot be read as. */
  function datasetCard(meta, series) {
    if (!meta) return '';
    var first = fmtDate(series[0].t), last = fmtDate(series[series.length - 1].t);
    return '<div class="card"><h2>About this data</h2><div class="scroll">' +
      '<table class="data"><tbody>' +
      '<tr><td>Series</td><td>' + esc(meta.name) + '</td></tr>' +
      '<tr><td>Type</td><td>' + (meta.kind === 'PRICE'
        ? 'Price index, dividends excluded' : 'Total Return Index, dividends included') + '</td></tr>' +
      '<tr><td>Bundled range</td><td>' + esc(meta.firstDate || '') + ' to ' + esc(meta.lastDate || '') + '</td></tr>' +
      (meta.source ? '<tr><td>Source</td><td>' + esc(meta.source) + '</td></tr>' : '') +
      (meta.licence ? '<tr><td>Used under</td><td>' + esc(meta.licence) + '</td></tr>' : '') +
      (meta.note ? '<tr><td>Note</td><td>' + esc(meta.note) + '</td></tr>' : '') +
      '</tbody></table></div>' +
      '<div class="meaning"><h3>What these results describe</h3>' +
      '<p>Everything below is calculated from this dataset and no other. It describes what happened ' +
      'between <strong>' + first + '</strong> and <strong>' + last + '</strong>, and nothing outside ' +
      'those dates.</p>' +
      '<p>This data is fixed, not live. It does not update itself, and nothing in it forecasts what ' +
      'comes next.</p></div></div>';
  }

  /* The search journey exists only when a provider does. A dead search box that
   * never returns anything is worse than no search box: it makes the tool look
   * broken rather than deliberately simple. */
  function wireFundSearch() {
    var provider = window.PRCProvider && window.PRCProvider.get();
    var card = $('#f-search-card');
    /* a missing element must never take the rest of init down with it */
    if (!provider || !card) return;
    card.hidden = false;

    function search() {
      var q = $('#f-query').value.trim();
      var out = $('#f-results');
      if (q.length < 3) {
        out.innerHTML = notice('', 'Type at least three letters of the scheme name.');
        return;
      }
      out.innerHTML = notice('', 'Looking\u2026');
      Promise.resolve()
        .then(function () { return provider.search(q); })
        .then(function (matches) {
          if (!matches || !matches.length) {
            out.innerHTML = notice('bad', 'Nothing matched \u201c' + esc(q) + '\u201d. Check the ' +
              'spelling, or load the fund\u2019s NAV file below \u2014 that works for every fund.');
            return;
          }
          /* §18: show enough to tell near-identical schemes apart */
          out.innerHTML = '<p class="hint" style="margin:.8rem 0 .4rem">' + matches.length +
            ' match' + (matches.length === 1 ? '' : 'es') + '. Check the plan and option before ' +
            'choosing \u2014 schemes with almost the same name behave differently.</p>' +
            '<div class="rows">' + matches.slice(0, 25).map(function (m, i) {
              return '<button class="tile" type="button" data-pick="' + i + '">' +
                '<h2 style="font-size:1rem">' + esc(m.name) + '</h2><p>' +
                [m.plan, m.option, m.identifier].filter(Boolean).map(esc).join(' \u00b7 ') +
                '</p></button>';
            }).join('') + '</div>';
          $$('#f-results [data-pick]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              choose(matches[+btn.dataset.pick]);
            });
          });
        })
        .catch(function (err) {
          out.innerHTML = notice('bad', 'The fund lookup could not be reached (' +
            esc(err && err.message ? err.message : 'no reply') + '). Load the fund\u2019s NAV ' +
            'file below instead \u2014 it needs no connection to anything.');
        });
    }

    function choose(match) {
      var out = $('#f-results');
      out.innerHTML = notice('', 'Fetching the history for ' + esc(match.name) + '\u2026');
      Promise.resolve()
        .then(function () { return provider.history(match.id); })
        .then(function (rows) {
          /* the same validation an uploaded file gets, so an automatically
             fetched fund is held to exactly the same standard */
          var res = P.rowsToSeries(rows);
          if (!res.ok) {
            /* the validator's wording assumes a file; this did not come from one */
            out.innerHTML = notice('bad',
              'The history that came back for ' + esc(match.name) + ' could not be used. ' +
              esc(res.message).replace('That file has', 'It has').replace('That file', 'It') +
              ' This came from the lookup service, not from you \u2014 loading the fund\u2019s own ' +
              'NAV file below will usually work.');
            return;
          }
          out.innerHTML = '';
          setLoaded(res.series, match.name, { report: res.report });
        })
        .catch(function (err) {
          out.innerHTML = notice('bad', 'That fund\u2019s history could not be fetched (' +
            esc(err && err.message ? err.message : 'no reply') + '). Load its NAV file below instead.');
        });
    }

    $('#f-search').addEventListener('click', search);
    $('#f-query').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); search(); }
    });
  }

  function importReport(rep, name) {
    if (!rep) return '';
    var skipped = rep.skipped.badDate + rep.skipped.badValue + rep.skipped.duplicate;
    var html = '<div class="card"><h2>What was read from your file</h2><div class="stats">' +
      stat('Rows in file', rep.rowsRead.toLocaleString()) +
      stat('Rows used', rep.used.toLocaleString()) +
      stat('First date', fmtDate(rep.firstDate)) +
      stat('Last date', fmtDate(rep.lastDate)) +
      '</div>';
    html += '<p style="margin:.2rem 0 0;color:var(--ink-2);font-size:.93rem">' +
      esc(name) + ' covers about ' + rep.spanYears.toFixed(1) + ' years.</p>';
    if (skipped) {
      html += '<p style="margin:.6rem 0 0;color:var(--ink-2);font-size:.93rem">' + skipped +
        ' row' + (skipped === 1 ? ' was' : 's were') + ' left out: ' +
        [rep.skipped.badDate + ' with a date that could not be read',
         rep.skipped.badValue + ' with a missing, zero or negative value',
         rep.skipped.duplicate + ' repeating a date already seen'].join(', ') + '.</p>';
      if (rep.examples.length) {
        html += '<details class="explain"><summary>Show me which rows</summary><div class="body"><ul style="margin:0;padding-left:1.1rem">' +
          rep.examples.map(function (x) {
            return '<li>Line ' + x.line + ': "' + esc(x.value) + '" — ' + esc(x.why) + '</li>';
          }).join('') + '</ul></div></details>';
      }
    }
    (rep.warnings || []).forEach(function (w) { html += notice('bad', esc(w)); });
    return html + '</div>';
  }

  /* =================================================================== INIT */

  function wireRateChecks() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.ratepresets .chip') : null;
      if (!btn) return;
      var input = document.getElementById('rate-' + btn.parentNode.dataset.key);
      if (!input) return;
      input.value = btn.dataset.rate;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.addEventListener('input', function (ev) {
      var input = ev.target;
      if (!input.classList || !input.classList.contains('ratecheck')) return;
      var key = input.dataset.key, years = input.dataset.years;
      var values = RATE_DATA[key];
      var rate = parseFloat(input.value) / 100;
      var out = document.getElementById('rateout-' + key);
      var sub = document.getElementById('ratesub-' + key);
      if (!out || !values) return;
      var res = E.shareAbove(values, rate);
      if (!res.ok) { out.textContent = '—'; sub.textContent = 'Enter a rate.'; return; }
      out.textContent = pct(res.share, 0);
      sub.textContent = rateSentence(res, rate, years);
      /* The rate box drives more than its own card: the Sharpe/Sortino-style
         line and the horizon matrix's Beat-your-target column both answer
         the same number, so they follow it. */
      var ratio = document.getElementById('ratio-' + key);
      if (ratio) ratio.innerHTML = ratioLine(values, rate);
      refreshRatioCells(key, rate);
      (HORIZON_DATA[key] || []).forEach(function (row) {
        var cell = document.querySelector('[data-beat-h="' + row.h + '"][data-key="' + key + '"]');
        if (!cell) return;
        var share = E.shareAbove(row.values, rate);
        cell.textContent = share.ok ? pct(share.share, 0) : '—';
      });
    });
    /* Print is how a phone saves a PDF; the button only exists on the
       market-index results. */
    document.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('.printbtn')) window.print();
    });
    /* The four result tabs on the market-index path. The CSS folds the
       panels to one at a time on a phone; here the tap only moves the .on
       marks, and on a wide screen scrolls to the panel's heading. */
    document.addEventListener('click', function (ev) {
      var tab = ev.target && ev.target.closest ? ev.target.closest('.ixtab') : null;
      if (!tab) return;
      var host = tab.closest('.ixpath');
      if (!host) return;
      var want = tab.dataset.panel;
      host.querySelectorAll('.ixtab').forEach(function (t) {
        var on = t.dataset.panel === want;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      var target = null;
      host.querySelectorAll('.ixpanel').forEach(function (p) {
        var on = p.dataset.panel === want;
        p.classList.toggle('on', on);
        if (on) target = p;
      });
      if (target && window.innerWidth > 720) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    /* The fan chart's readout follows the horizon under the pointer, or the
       one tapped, or the one focused with the keyboard. */
    function fanShow(ev) {
      var hit = ev.target && ev.target.closest ? ev.target.closest('.fan-hit') : null;
      if (!hit) return;
      var out = document.getElementById('fanout-' + hit.dataset.key);
      if (!out) return;
      var fig = hit.closest('.fanchart');
      var benchName = fig && fig.querySelector('.legend .key:nth-child(2)')
        ? fig.querySelector('.legend .key:nth-child(2)').textContent.replace(/ \(dashed\)$/, '') : '';
      out.textContent = fanReadout(hit.dataset.fanH, hit.dataset.p10, hit.dataset.med, hit.dataset.p90,
        hit.dataset.n, hit.dataset.bmed ? { p10: hit.dataset.b10, median: hit.dataset.bmed,
                                             p90: hit.dataset.b90 } : null, benchName);
    }
    document.addEventListener('mouseover', fanShow);
    document.addEventListener('click', fanShow);
    document.addEventListener('focusin', fanShow);
  }

  function init() {
    A.initRouter();
    wireRateChecks();
    fillAbout();
    $('#ver').textContent = A.VERSION;
    if ($('#sheetver')) $('#sheetver').textContent = A.SHEET_VERSION;

    /* portfolio */
    for (var i = 0; i < 3; i++) addRow({});
    addRow({ date: A.isoToday(), kind: 'Worth today' });
    $('#pf-add').addEventListener('click', function () { addRow({}); });
    $('#pf-sip').addEventListener('click', function () { toggleSip($('#sip-builder').hidden); });
    $('#sip-add').addEventListener('click', addSipRows);
    $('#sip-cancel').addEventListener('click', function () { toggleSip(false); });
    $('#pf-demo').addEventListener('click', fillExample);
    $('#pf-clear').addEventListener('click', function () {
      $('#pf-rows').innerHTML = ''; $('#pf-out').innerHTML = '';
      for (var k = 0; k < 3; k++) addRow({});
      addRow({ date: A.isoToday(), kind: 'Worth today' });
    });
    $('#pf-group').addEventListener('change', function () { if ($('#pf-out').innerHTML) calcPortfolio(); });
    $('#pf-calc').addEventListener('click', calcPortfolio);
    $('#pf-export').addEventListener('click', exportRows);
    portfolioDoor();
    var worth = $('#pf-worth');
    if (worth) worth.addEventListener('input', function () {
      if ($('#pf-out').innerHTML) calcPortfolio();
    });

    /* goal */
    ['g-target', 'g-current', 'g-sip'].forEach(function (id) {
      var input = $('#' + id), echo = $('#' + id + '-echo');
      if (!input || !echo) return;
      function say() {
        var v = parseFloat(input.value);
        /* Section 12's "not defects, worth keeping": this helper is exactly
           right and belongs under every rupee input. */
        var bad = A.checkInput('rupees', v);
        echo.textContent = input.value.trim() === '' ? ''
          : bad ? bad
          : A.echo(v);
        echo.classList.toggle('refuse', !!bad && input.value.trim() !== '');
      }
      input.addEventListener('input', say);
      say();
    });
    GOAL_FIELDS.forEach(function (f) {
      var el = $('#' + f.id);
      if (el) el.addEventListener('input', goalOutOfRange);
    });
    $('#g-calc').addEventListener('click', calcGoal);

    /* rolling returns: one module, four steps, nothing hidden */
    wireDoors();
    wireHowto();
    yearChips();
    freqChips();
    gateSteps();
    loadIndexList();
    $$('#r-source .chip').forEach(function (c) {
      c.addEventListener('click', function () { resetSource(c.dataset.source); });
    });
    A.wireDrop('f-drop', 'f-file', 'f-pick', loadFundFile);
    /* The fund path's box is written in the markup rather than built, so its
       idle hint has to be registered before any state can be drawn over it
       and then restored. */
    DROP_HINT.f = 'CSV or Excel &middot; a date column and a NAV column is all it needs';
    wirePaste('f', function (text, nm) { loadFundFile(pastedFile(text, nm)); });
    try { wireFundSearch(); } catch (e) { /* optional; never fatal */ }
    $('#r-compare').addEventListener('change', function () {
      $('#step-compare').dataset.done = this.value !== 'none' ? 'yes' : 'no';
      overlapNote();
      askIndexKind(this.value !== 'none' ? this.value : null);
      if (R.ran) runRolling();
    });
    ['r-start', 'r-end'].forEach(function (id) {
      $('#' + id).addEventListener('change', function () {
        R.datesTouched = true;
        limitYears(selectedSpanYears());
        updateWindowNote();
        if (R.ran) runRolling();
      });
    });
    $('#r-all').addEventListener('click', function () {
      if (!R.series) return;
      $('#r-start').value = isoOf(R.series[0].t);
      $('#r-end').value = isoOf(R.series[R.series.length - 1].t);
      R.datesTouched = false;
      limitYears(selectedSpanYears());
      updateWindowNote();
      if (R.ran) runRolling();
    });
    $('#r-run').addEventListener('click', runRolling);
    refreshCompare();   /* disabled, and visibly so, until there is anything to compare with */
    applyPreset();
    $('#r-reset').addEventListener('click', function () {
      R.ran = false; R.rows = null; R.schemes = null;
      /* Start again means the state the page opens in, and the page now opens
         on three years. This is the one place the default is restored over a
         reader's own choice, and it is restored because they pressed the
         button that says so. */
      R.years = DEFAULT_YEARS;
      R.frequency = 'daily';
      R.cmpSchemes = null; R.cmpRows = null; R.kinds = {};
      yearChips();
      freqChips();
      $('#r-scheme-wrap').hidden = true;
      $('#r-compare').value = 'none';
      $('#step-compare').dataset.done = 'no';
      setSource(null);
      clearLoaded('');
      $('#r-loaded').innerHTML = '';
      var isel = $('#r-index');
      if (isel) isel.value = '';
      ['bm', 'cmp', 'f'].forEach(clearDropStatus);
      clearLoadedList();
      openDoor('');
      var ov = $('#r-overlap-note');
      if (ov) ov.innerHTML = '';
      var cn = $('#cmp-note');
      if (cn) cn.innerHTML = '';
      refreshCompare();
    });
  }

  window.PRCRolling = {
    preset: function (source) {
      if (!source) return;
      pendingSource = source;
      if ($('#r-source')) applyPreset();
    }
  };

  var pendingSource = null;
  function applyPreset() {
    if (!pendingSource) return;
    var next = pendingSource;
    pendingSource = null;
    if (next === R.source && R.series) return;   /* already there; keep their work */
    resetSource(next);
  }

  /* Switching source must never leave the other source's series loaded under a
   * label that no longer describes it. */
  function resetSource(next) {
    setSource(next);
    R.rows = null; R.schemes = null; R.ran = false; R.datesTouched = false;
    var scheme = $('#r-scheme-wrap');
    if (scheme) scheme.hidden = true;
    var idx = $('#r-index');
    if (idx) idx.value = '';
    /* forget the chosen file too, or re-choosing the same one looks like nothing
       happened: the browser fires no change event for an unchanged selection */
    ['f-file', 'bm-file'].forEach(function (id) {
      var input = $('#' + id);
      if (input) input.value = '';
    });
    var results = $('#f-results');
    if (results) results.innerHTML = '';
    clearLoaded('');
    $('#r-loaded').innerHTML = '';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
