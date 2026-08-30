/* Where You Stand — Tool 1, "My return".
 *
 * Review v3, section 4. A LEDGER, not a form. One ruled line per entry, the
 * way a passbook reads: date, in or out, amount, and the fund if the reader
 * keeps more than one. Tap a line to edit it. Nothing here needs a fund's
 * price history, so this tool works on its own, offline, from the first tap.
 *
 * The monthly instalments generator writes ONE line — "₹5,000 monthly, Apr 2021
 * to Aug 2026, 65 instalments" — and the engine expands it at run time. Sixty
 * five rows of the same number is a wall the reader has to proof-read; one line
 * is a sentence they can check at a glance, and it stays editable as one thing.
 *
 * "Worth today" is one fixed field at the foot of the ledger, not a row type.
 * It is not a transaction — no money moved — and every reader who has been
 * asked to enter it as a row has wondered whether to sign it.
 *
 * Every sentence that carries MEANING is a copy slot by id. What this file
 * writes is arithmetic on the reader's own entries: their dates, their totals,
 * and which side of the crossover they are on. Where a slot is unwritten the
 * screen names it rather than inventing a sentence or printing nothing.
 */
(function (root) {
  'use strict';

  var W = root.WYS, E = root.SimEngines, S = root.SimSchemes, St = root.SimStates;
  var $ = W.$, $$ = W.$$, money = W.money, pct = W.pct, date = W.date, esc = W.esc;

  var STORE = 'wys.mine.entries';
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* entries are what the reader wrote; rows are what the engine reads.
   *   { kind: 'one', t, dir: 'in'|'out', amount, fund }
   *   { kind: 'sip', t, amount, n, fund }                one line, n instalments
   */
  var M = { entries: [], editing: null };

  function monthYear(t) {
    var d = new Date(t);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  /* One line in, many flows out. The expansion lives here and not in the
   * ledger, so what the reader edits stays the single line they wrote. */
  function expand(entries) {
    var rows = [];
    (entries || []).forEach(function (e) {
      if (e.kind === 'sip') {
        for (var i = 0; i < e.n; i++) {
          rows.push({ t: E.addMonths(e.t, i), type: 'in', amount: e.amount, fund: e.fund || '' });
        }
      } else {
        rows.push({ t: e.t, type: e.dir === 'out' ? 'out' : 'in', amount: e.amount, fund: e.fund || '' });
      }
    });
    return rows.sort(function (a, b) { return a.t - b.t; });
  }

  function lastInstalment(e) { return E.addMonths(e.t, e.n - 1); }

  function anyFund() {
    return M.entries.some(function (e) { return e.fund; });
  }

  function fundsNamed() {
    var seen = {};
    M.entries.forEach(function (e) { if (e.fund) seen[e.fund] = 1; });
    return Object.keys(seen);
  }

  /* ------------------------------------------------------------- the ledger
   * One ruled line per entry. The whole row is the control: tapping anywhere
   * on it opens that entry for editing, which is how a reader expects a list
   * of their own writing to behave. */
  function drawLedger() {
    var body = $('#m-rows');
    var withFund = anyFund();
    $('#m-head-fund').hidden = !withFund;

    if (!M.entries.length) {
      body.innerHTML = '<tr><td colspan="' + (withFund ? 4 : 3) +
        '" class="gloss">Nothing written yet.</td></tr>';
    } else {
      body.innerHTML = M.entries.slice()
        .sort(function (a, b) { return a.t - b.t; })
        .map(function (e) {
          var i = M.entries.indexOf(e);
          var what, amount;
          if (e.kind === 'sip') {
            what = money(e.amount) + ' monthly, ' + monthYear(e.t) + ' to ' +
                   monthYear(lastInstalment(e)) + ', ' + W.count(e.n) + ' instalments';
            amount = money(e.amount * e.n);
          } else {
            what = e.dir === 'out' ? 'Money out' : 'Money in';
            amount = money(e.amount);
          }
          return '<tr class="tap" tabindex="0" role="button" data-edit="' + i +
            '" aria-label="Edit the line dated ' + date(e.t) + '">' +
            '<td>' + date(e.t) + '</td>' +
            '<td' + (e.kind === 'sip' ? '' : ' class="nw"') + '>' + esc(what) + '</td>' +
            '<td class="n">' + amount + '</td>' +
            (withFund ? '<td class="fund">' + esc(e.fund || '') + '</td>' : '') +
            '</tr>';
        }).join('');
    }

    $$('#m-rows [data-edit]').forEach(function (tr) {
      function open() { edit(+tr.dataset.edit); }
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
    });

    var rows = expand(M.entries);
    $('#m-total').textContent = rows.length
      ? W.count(rows.length) + (rows.length === 1 ? ' payment' : ' payments') + ' · ' +
        date(rows[0].t) + ' to ' + date(rows[rows.length - 1].t)
      : '';
    $('#m-run').disabled = !rows.some(function (r) { return r.type === 'in'; });
  }

  /* ------------------------------------------------------------- the editor
   * One box for both shapes of entry. The instalment fields appear only when
   * the reader asks for instalments, so a single payment is four fields and
   * not seven. */
  function edit(i) {
    var e = i == null ? { kind: 'one', t: NaN, dir: 'in', amount: NaN, fund: '' } : M.entries[i];
    M.editing = i;
    $('#m-e-kind').value = e.kind;
    $('#m-e-date').value = isFinite(e.t) ? E.toISO(e.t) : '';
    $('#m-e-dir').value = e.dir || 'in';
    $('#m-e-amount').value = isFinite(e.amount) ? e.amount : '';
    $('#m-e-n').value = e.n || '';
    $('#m-e-fund').value = e.fund || '';
    $('#m-e-drop').hidden = i == null;
    $('#m-e-title').textContent = i == null ? 'A new line' : 'This line';
    kindFields();
    $('#m-edit').hidden = false;
    $('#m-e-date').focus();
  }

  function kindFields() {
    var sip = $('#m-e-kind').value === 'sip';
    $('#m-e-dir-field').hidden = sip;      /* instalments are always money in */
    $('#m-e-n-field').hidden = !sip;
    $('#m-e-date-label').textContent = sip ? 'First instalment' : 'Date';
    $('#m-e-amount-label').textContent = sip ? 'Amount each month' : 'Amount';
  }

  function saveEdit() {
    var t = S.parseDate($('#m-e-date').value);
    var amount = parseFloat($('#m-e-amount').value);
    var kind = $('#m-e-kind').value;
    var n = Math.floor(parseFloat($('#m-e-n').value));
    if (!isFinite(t) || !(amount > 0) || (kind === 'sip' && !(n >= 1))) {
      $('#m-e-note').textContent = kind === 'sip'
        ? 'A first instalment, an amount above zero, and how many.'
        : 'A date and an amount above zero.';
      return;
    }
    var e = kind === 'sip'
      ? { kind: 'sip', t: t, amount: amount, n: Math.min(600, n), fund: $('#m-e-fund').value.trim() }
      : { kind: 'one', t: t, dir: $('#m-e-dir').value, amount: amount, fund: $('#m-e-fund').value.trim() };
    if (M.editing == null) M.entries.push(e); else M.entries[M.editing] = e;
    closeEdit();
    drawLedger();
  }

  function closeEdit() {
    M.editing = null;
    $('#m-e-note').textContent = '';
    $('#m-edit').hidden = true;
  }

  /* ------------------------------------------------- paste from a spreadsheet
   * Two columns: a date and an amount, with a minus for money out. That is
   * what a bank statement and a fund's own transaction export both already
   * look like, so most readers can paste without editing anything. */
  function paste(text) {
    var lines = String(text || '').split(/\r?\n/), added = 0, skipped = 0;
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var cells = line.split(/\t|,|;|\s{2,}/).map(function (c) { return c.trim(); })
                      .filter(function (c) { return c !== ''; });
      if (cells.length < 2) { skipped++; return; }
      var t = S.parseDate(cells[0]);
      var n = parseFloat(cells[1].replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
      if (!isFinite(t) || !isFinite(n) || n === 0) { skipped++; return; }
      M.entries.push({ kind: 'one', t: t, dir: n < 0 ? 'out' : 'in',
                       amount: Math.abs(n), fund: (cells[2] || '').trim() });
      added++;
    });
    $('#m-paste-note').textContent = added
      ? W.count(added) + (added === 1 ? ' line read' : ' lines read') +
        (skipped ? ', ' + W.count(skipped) + ' skipped' : '') + '.'
      : 'No line here had a date and an amount on it.';
    if (added) { $('#m-paste-text').value = ''; $('#m-paste').hidden = true; }
    drawLedger();
  }

  /* -------------------------------------------------------- save and load
   * On this device and nowhere else. Nothing is sent anywhere, which is why
   * saving is a button the reader presses rather than something that happens
   * to their figures without being asked. */
  function save() {
    try {
      root.localStorage.setItem(STORE, JSON.stringify({
        entries: M.entries, worth: $('#m-worth').value, on: $('#m-worth-on').value
      }));
      $('#m-store-note').textContent = 'Saved on this device.';
    } catch (err) {
      $('#m-store-note').textContent = 'This browser will not let the page save anything.';
    }
  }

  function load() {
    var raw;
    try { raw = root.localStorage.getItem(STORE); }
    catch (err) { $('#m-store-note').textContent = 'This browser will not let the page read what it saved.'; return; }
    if (!raw) { $('#m-store-note').textContent = 'Nothing has been saved on this device yet.'; return; }
    var kept;
    try { kept = JSON.parse(raw); } catch (err) { kept = null; }
    if (!kept || !kept.entries) { $('#m-store-note').textContent = 'What was saved cannot be read back.'; return; }
    M.entries = kept.entries.filter(function (e) { return e && isFinite(e.t) && isFinite(e.amount); });
    $('#m-worth').value = kept.worth || '';
    $('#m-worth-on').value = kept.on || '';
    $('#m-store-note').textContent = W.count(M.entries.length) +
      (M.entries.length === 1 ? ' line loaded.' : ' lines loaded.');
    drawLedger();
  }

  /* An example the reader can see a reading from before trusting the tool with
   * their own figures. It is one instalment line and one withdrawal, which is
   * what most ledgers actually look like. */
  function example() {
    var today = new Date();
    var start = E.utc(today.getUTCFullYear() - 5, today.getUTCMonth() + 1, 5);
    M.entries = [
      { kind: 'sip', t: start, amount: 5000, n: 60, fund: '' },
      { kind: 'one', t: E.addMonths(start, 40), dir: 'out', amount: 50000, fund: '' }
    ];
    $('#m-worth').value = 400000;
    $('#m-worth-on').value = E.toISO(E.utc(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()));
    drawLedger();
  }

  /* ------------------------------------------------------------ the reading */
  function show() {
    var rows = expand(M.entries);
    var worth = parseFloat($('#m-worth').value);
    var on = S.parseDate($('#m-worth-on').value);
    var all = rows.slice();
    if (isFinite(worth) && worth >= 0 && isFinite(on)) {
      all.push({ t: on, type: 'value', amount: worth, fund: '' });
    }

    var bad = E.validateRows(all);
    if (bad && bad.blocking !== false) { refuse(bad, rows); return; }

    var res = E.xirr(E.toFlows(all));
    if (!res.ok) {
      refuse({ code: 'XIRR-NO-SOLVE' }, rows);
      return;
    }

    var put = rows.filter(function (r) { return r.type === 'in'; })
                  .reduce(function (s, r) { return s + r.amount; }, 0);
    var took = rows.filter(function (r) { return r.type === 'out'; })
                   .reduce(function (s, r) { return s + r.amount; }, 0);
    var abs = put > 0 ? (worth + took - put) / put : NaN;
    var firstT = rows[0].t, spanDays = E.dayCount(firstT, on);
    var years = spanDays / 365;
    var early = spanDays < 365;

    /* the figure, wearing the marker, with its unit inline — and no unit at
     * all under a year, where "a year" is the word doing the damage */
    var html = '<div class="reading">';
    html += '<div class="hero"' + W.land(0) + '><p class="label">Your return</p>' +
      '<p class="figure mine">' + pct(res.rate) + '</p>' +
      (early ? '' : '<span class="unit">a year</span>') + '</div>';

    /* the span line */
    html += '<p class="gloss" style="margin-top:.9rem">' +
      date(firstT) + ' to ' + date(on) + ' · ' + years.toFixed(1) + ' years · ' +
      W.count(rows.length) + (rows.length === 1 ? ' payment' : ' payments') + '</p>';

    /* Absolute return BESIDE the yearly rate, each with the one gloss that
     * says which question it answers. Two numbers that do not match is the
     * most common reason a reader thinks a tool is broken. */
    html += '<div class="line"' + W.land(1) + '><div class="what">Absolute return' +
      '<br><span class="gloss">what it all came to, in total · no clock in it</span></div>' +
      '<div class="val">' + pct(abs) + '</div></div>';
    html += '<div class="line"' + W.land(2) + '><div class="what">XIRR' +
      '<br><span class="gloss">the yearly speed your own money travelled at · counts every date</span></div>' +
      '<div class="val">' + pct(res.rate) + '</div></div>';
    html += '</div>';

    /* the one crossover line — a reading of the reader's own two figures and
     * nothing more. Which is larger is decided by how many years are inside
     * the total, so that is what the line says. */
    html += '<p class="sentence" id="m-crossover" style="margin-top:1.25rem">' + esc(crossover(abs, res.rate, years)) + '</p>';

    /* the money, plainly */
    html += '<div class="section"><p class="label">Your money</p><div class="scroller"><table class="ledger"><tbody>' +
      '<tr><td>Put in</td><td class="n">' + money(put) + '</td></tr>' +
      '<tr><td>Taken out</td><td class="n">' + (took ? money(took) : '—') + '</td></tr>' +
      '<tr><td>Worth on ' + date(on) + '</td><td class="n">' + money(worth) + '</td></tr>' +
      '</tbody></table></div></div>';

    /* The state readings this screen carries, and only these.
     *
     * Each is the author's sentence where she has written one. Where she has
     * not, the screen prints the arithmetic and names the slot, so a reading
     * that matters is never silent while the deck is being written -- and that
     * scaffolding stands down by itself the moment her sentence lands, which
     * is what keeps this screen inside its hundred and thirty words. */
    var purchases = rows.filter(function (r) { return r.type === 'in'; });
    var subs = {
      MONTHS: String(Math.max(1, Math.round(spanDays / 30.44))),
      YOURS: pct(res.rate),
      AMOUNT: money(biggestRecentLump(purchases, on))
    };

    html += '<div class="section">' + W.slot('XIRR-MEANING', subs);
    if (early) {
      html += W.saying('POS-UNDER-A-YEAR', subs,
        'This runs ' + W.count(spanDays) + ' days, which is under a year.', 'extra');
    }
    if (took > 0) {
      html += W.saying('POS-WITHDRAWALS', subs,
        'Money came out on the way.', 'extra');
    }
    if (St.recentLump(purchases, on)) {
      html += W.saying('POS-RECENT-LUMP', subs,
        'A large part of this money went in inside the last twelve months.', 'extra');
    }
    var funds = fundsNamed();
    if (funds.length > 1) {
      html += W.saying('XIRR-MANY-FUNDS', subs,
        funds.length + ' funds are named in this ledger.', 'extra');
    }
    html += '</div>';

    /* Inflation ships blank. A rate typed here by the tool would be the tool
     * telling the reader what to expect, and that is not its job. */
    html += '<div class="section">' +
      '<label class="field" for="m-infl" style="max-width:14rem">' +
      '<span class="label">Inflation, % a year</span>' +
      '<input type="number" id="m-infl" inputmode="decimal" step="0.1" min="0" max="20"></label>' +
      '<p class="gloss" id="m-infl-bad"></p><div id="m-real"></div></div>';

    html += '<div class="section"><button class="linkish" id="m-back" type="button">' +
      'Back to the ledger</button></div>';

    $('#m-out').innerHTML = html;
    $('#m-ledger').hidden = true;
    $('#m-result').hidden = false;
    wireReal(res.rate);
    root.scrollTo(0, 0);
  }

  /* Which side of the crossover the reader is on. A total gain has however
   * many years are inside it; a yearly rate has one. Early on the rate reads
   * higher, and later the total overtakes it and stays ahead — a lump sum
   * crosses at exactly twelve months, a monthly plan later, which is why this
   * line counts the reader's own years rather than naming a fixed mark. */
  function crossover(abs, rate, years) {
    if (years < 1) {
      return 'Read the total. The yearly rate above stretches ' + (years * 12).toFixed(0) +
        ' months into a year that has not happened.';
    }
    /* Review v4 §4's own wording, which is true for a lump sum and for a
       monthly plan alike, because it counts the reader's own years. */
    return abs > rate
      ? 'The total is bigger than the yearly rate because it has ' + years.toFixed(1) +
        ' years inside it; the rate has one.'
      : 'The yearly rate is bigger than the total because most of this money has been ' +
        'invested for less than a year; the rate is still a per-year figure.';
  }

  /* The purchase that set the recent-lump line off, in rupees. */
  function biggestRecentLump(purchases, asOfT) {
    var cutoff = asOfT - 12 * 30.44 * 86400000, biggest = 0;
    (purchases || []).forEach(function (r) {
      if (r.t >= cutoff && r.amount > biggest) biggest = r.amount;
    });
    return biggest;
  }

  function refuse(bad, rows) {
    var slotId = bad.code === 'XIRR-SAME-SIGN' ? 'XIRR-SAME-SIGN'
      : bad.code === 'XIRR-NEED-VALUE' ? 'XIRR-NEED-VALUE'
      : bad.code === 'XIRR-ROW-FIX' ? 'XIRR-ROW-FIX'
      : bad.code === 'XIRR-NO-SOLVE' ? 'XIRR-NO-SOLVE'
      : 'XIRR-NEED-IN';
    var said = {
      'XIRR-NEED-IN': 'Not one line here has money going in.',
      'XIRR-NEED-VALUE': bad.found > 1
        ? 'There is more than one figure for what it is worth.'
        : 'The ledger has ' + W.count(rows.length) +
          (rows.length === 1 ? ' payment' : ' payments') + ' and no figure for what it is worth.',
      'XIRR-ROW-FIX': 'One line is not finished' +
        (bad.row != null ? ': the one dated ' + (rows[bad.row] ? date(rows[bad.row].t) : '') : '') + '.',
      'XIRR-SAME-SIGN': 'Every figure here points the same way, so there is no gain or loss to spread over the dates.',
      'XIRR-NO-SOLVE': 'These dates and amounts do not settle on a single yearly rate.'
    }[slotId];

    $('#m-out').innerHTML = '<div class="refusal"><p>' + esc(said) + '</p>' + W.slot(slotId) +
      '<button class="linkish" id="m-back" type="button" style="margin-top:.8rem">' +
      'Back to the ledger</button></div>';
    $('#m-result').hidden = false;
  }

  function wireReal(rate) {
    var input = $('#m-infl'), out = $('#m-real');
    if (!input) return;
    input.addEventListener('input', function () {
      var i = parseFloat(input.value);
      if (!isFinite(i)) { out.innerHTML = ''; return; }
      var bad = W.checkInput('inflation', i);
      var note = W.$('#m-infl-bad');
      if (note) { note.textContent = bad || ''; note.classList.toggle('refuse', !!bad); }
      if (bad) { out.innerHTML = ''; return; }
      var real = (1 + rate) / (1 + i / 100) - 1;
      out.innerHTML = '<div class="line"><div class="what">What is left</div>' +
        '<div class="val">' + pct(real) + '</div></div>';
    });
  }

  /* ---------------------------------------------------------------- wiring */
  function init() {
    drawLedger();

    $('#m-add').addEventListener('click', function () { edit(null); });
    $('#m-sip').addEventListener('click', function () {
      edit(null);
      $('#m-e-kind').value = 'sip';
      kindFields();
    });
    $('#m-e-kind').addEventListener('change', kindFields);
    $('#m-e-save').addEventListener('click', saveEdit);
    $('#m-e-cancel').addEventListener('click', closeEdit);
    $('#m-e-drop').addEventListener('click', function () {
      if (M.editing != null) M.entries.splice(M.editing, 1);
      closeEdit();
      drawLedger();
    });

    $('#m-paste-open').addEventListener('click', function () {
      var box = $('#m-paste');
      box.hidden = !box.hidden;
      if (!box.hidden) $('#m-paste-text').focus();
    });
    $('#m-paste-read').addEventListener('click', function () { paste($('#m-paste-text').value); });

    $('#m-example').addEventListener('click', example);
    $('#m-save').addEventListener('click', save);
    $('#m-load').addEventListener('click', load);
    $('#m-clear').addEventListener('click', function () {
      M.entries = [];
      $('#m-worth').value = '';
      $('#m-worth-on').value = '';
      $('#m-store-note').textContent = '';
      drawLedger();
    });
    $('#m-run').addEventListener('click', show);

    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'm-back') {
        $('#m-result').hidden = true;
        $('#m-ledger').hidden = false;
      }
    });
  }

  /* Coming back to this tool returns it to the ledger the reader wrote, not to
     a reading of figures they have since changed. */
  W.view('mine', {
    enter: function () {
      $('#m-result').hidden = true;
      $('#m-ledger').hidden = false;
      drawLedger();
    }
  });

  root.WYSMine = { state: M, expand: expand, init: init, show: show, paste: paste };
})(typeof globalThis !== 'undefined' ? globalThis : this);
