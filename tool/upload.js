/* Where You Stand: reading the reader's own statement.
 *
 * Two shapes come through this door and the reader is never asked which:
 *
 *   a holdings snapshot      what they own now: scheme, units, put in, worth.
 *                            No dates, so no yearly rate can come out of it.
 *   a transaction statement  every payment with its date, and often the fund,
 *                            the units and a word saying what the line was.
 *
 * Nothing here guesses silently about the reader's money. A minus sign or a
 * bracket is the reader saying "money out" themselves and wins outright. Where
 * amounts are unsigned, the words in the type column are handed back, pre-ticked
 * from a dictionary, and the reader confirms once. The one exception is this
 * tool's own three words (Money in, Money out, Worth today), which mean exactly
 * one thing each, so a file the tool saved is read back without a question.
 *
 * No DOM, no clock, no network.
 */
(function (root) {
  'use strict';

  var P = (typeof require === 'function') ? require('./parse.js') : root.PRCParse;
  var F = (typeof require === 'function') ? require('./format.js') : root.SimFormat;

  var MS_DAY = 86400000;
  /* A weekend plus a long holiday run is normal in an Indian NAV file. Beyond
   * this the reader is probably missing a downloaded piece. */
  var GAP_DAYS = 45;

  /* ------------------------------------------------------------ the rows */
  function rowsFrom(input) {
    if (Array.isArray(input)) return input;
    if (input && Array.isArray(input.rows)) return input.rows;
    var text = String(input == null ? '' : (input.text != null ? input.text : input));
    var trimmed = text.replace(/^﻿/, '').trim();
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      var rows = jsonRows(trimmed);
      if (rows) return rows;
    }
    return P.parseDelimited(text);
  }
  function jsonRows(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    var list = Array.isArray(data) ? data
      : (data && Array.isArray(data.data)) ? data.data
      : (data && Array.isArray(data.navs)) ? data.navs
      : (data && Array.isArray(data.series)) ? data.series : null;
    if (!list || !list.length || typeof list[0] !== 'object') return null;
    var keys = Object.keys(list[0]);
    if (!keys.length) return null;
    var rows = [keys];
    list.forEach(function (rec) { rows.push(keys.map(function (k) { return rec[k] == null ? '' : String(rec[k]); })); });
    return rows;
  }
  function blankRows(rows) {
    return !rows || !rows.length || !rows.some(function (r) {
      return r && r.some(function (c) { return String(c == null ? '' : c).trim() !== ''; });
    });
  }

  /* ------------------------------------------------------------- amounts
   * With the sign preserved: a bracketed figure and a true minus both mean
   * money out. The WHOLE cell must be a number; "5000 Dr" is not read, because
   * taking direction from an abbreviation is a guess about the reader's money. */
  function ledgerAmount(raw) {
    var t = String(raw == null ? '' : raw).trim().replace(/^"(.*)"$/, '$1').trim();
    var neg = false;
    var wrapped = /^\((.*)\)$/.exec(t);
    if (wrapped) { neg = true; t = wrapped[1]; }
    t = t.replace(/[₹$,\s ]/g, '').replace(/^−/, '-');
    if (t === '' || t === '-' || /^n\.?a\.?$/i.test(t)) return NaN;
    if (!/^-?\d*\.?\d+$/.test(t)) return NaN;
    var n = parseFloat(t);
    if (!isFinite(n)) return NaN;
    return neg ? -Math.abs(n) : n;
  }
  function dateOf(cell, dayFirst) { return P.toTimestamp(P.parseDateParts(cell, dayFirst)); }
  function anyDate(cell) { return isFinite(dateOf(cell, true)) || isFinite(dateOf(cell, false)); }

  /* ---------------------------------------------------------- the words
   * The tool's own three words mean exactly one thing each. A row that says
   * the holding's worth is a VALUATION, not a payment. */
  var OWN_IN = /^money in$/i, OWN_OUT = /^money out$/i;
  var OWN_VALUE = /^(worth today|value today|current value|valuation|worth now)$/i;
  function ownWord(word) {
    var t = String(word == null ? '' : word).trim();
    if (OWN_VALUE.test(t)) return 'value';
    if (OWN_IN.test(t)) return 'in';
    if (OWN_OUT.test(t)) return 'out';
    return null;
  }
  /* What the platforms call things. Pre-ticks the question; never decides it. */
  var TERMS_OUT = [
    /redem|redeem/i, /\bsell\b|\bsale\b|sold/i, /switch\s*[-_ ]?out/i, /transfer\s*[-_ ]?out/i,
    /withdraw/i, /\bswp\b|systematic\s+withdraw/i, /payout|dividend\s+paid|idcw\s+paid/i,
    /\bexit\b/i, /repurchase/i
  ];
  var TERMS_IN = [
    /\bpurchases?\b|\bbuy\b|bought/i, /\bsip\b|systematic\s+invest/i, /switch\s*[-_ ]?in/i,
    /transfer\s*[-_ ]?in/i, /\binvest/i, /\bstp\s*[-_ ]?in/i, /subscription|allot/i,
    /reinvest|dividend\s+reinvest/i, /\badd(ition)?\b/i, /lump\s*sum/i
  ];
  function guessDirection(word) {
    var own = ownWord(word);
    if (own) return own;
    var t = String(word == null ? '' : word);
    var out = TERMS_OUT.some(function (re) { return re.test(t); });
    var into = TERMS_IN.some(function (re) { return re.test(t); });
    if (out && !into) return 'out';
    if (into && !out) return 'in';
    return null;
  }

  /* Headings are compared as plain words (P.normHeader), so a registrar's
     AMOUNT, TRADE_DATE and SCHEME_NAME read the same as Amount, Trade Date
     and Scheme Name. The type headings are in order of preference: a
     transaction type beats a bare "Type", which on some exports is a code. */
  var AMOUNT_HEADERS = ['amount', 'amt', 'transaction amount', 'net amount', 'amount rs', 'amount in rs',
                        'amount inr', 'value', 'debit', 'credit', 'withdrawal', 'deposit'];
  var TYPE_HEADERS = ['transaction type', 'txn type', 'transaction', 'transaction description', 'description',
                      'particulars', 'narration', 'nature', 'what happened', 'type', 'kind'];
  var UNITS_HEADERS = /^(units?|no of units?|units? allotted|unit (balance|qty|quantity)|quantity|qty|balance units?)$/i;
  var FUND_HEADERS = /^(fund|fund name|scheme|scheme name|which fund|holding)$/i;
  var PRICE_HEADERS = /\bnav\b|net\s*asset|\bprice\b|\bclose\b|\bclosing\b|repurchase/i;
  var ISIN_HEADERS = /\bisin\b/;
  var CODE_HEADERS = /^(scheme code|amfi code|amfi scheme code|amfi)$/;
  function plain(h) { return P.normHeader(h); }

  /* ----------------------------------------------------- a transaction statement */
  function ledgerRows(input, options) {
    var o = options || {};
    var rows = rowsFrom(input);
    if (blankRows(rows)) return ledgerFail('NO-ROWS', MESSAGES.ledgerNoRows);

    var header = null, body = rows;
    var hr = P.headingRow(rows);
    if (hr >= 0 && rows.length >= hr + 2) { header = rows[hr]; body = rows.slice(hr + 1); }
    else if (rows.length >= 2 && !rows[0].some(anyDate)) { header = rows[0]; body = rows.slice(1); }
    if (!body.length) return ledgerFail('NO-ROWS', MESSAGES.ledgerNoRows);

    var probe = body.slice(0, 40);
    var width = Math.max.apply(null, body.map(function (r) { return r.length; }).concat([0]));
    var dateCol = bestColumn(probe, width, anyDate, Math.max(1, Math.ceil(probe.length * 0.5)));
    if (dateCol < 0) return ledgerFail('NO-DATES', MESSAGES.ledgerNoDates);

    var dayFirst = true, dateCertain = true, example = null;
    if (o.dayFirst !== undefined) dayFirst = !!o.dayFirst;
    else {
      var seen = P.detectDayFirst(body, dateCol);
      dayFirst = seen.dayFirst; dateCertain = seen.certain;
      if (!seen.certain) example = firstAmbiguousDate(body);
    }

    var amountCol = amountColumn(header, probe, width, dateCol);
    if (amountCol < 0) return ledgerFail('NO-AMOUNT', MESSAGES.ledgerNoAmount);
    var fundCol = fundColumn(header, width, dateCol, amountCol);
    var unitsCol = unitsColumn(header, width, dateCol, amountCol, fundCol);
    var isinCol = -1, codeCol = -1;
    if (header) header.forEach(function (h, i) {
      var p = plain(h);
      if (isinCol === -1 && ISIN_HEADERS.test(p)) isinCol = i;
      if (codeCol === -1 && CODE_HEADERS.test(p)) codeCol = i;
    });

    var signed = false;
    for (var q = 0; q < body.length && !signed; q++) {
      var probeAmt = ledgerAmount(body[q][amountCol]);
      if (isFinite(probeAmt) && probeAmt < 0) signed = true;
    }
    if (!signed && !o.direction && priceShaped(header, body, dateCol, amountCol, dayFirst)) {
      return { ok: false, ask: null, kind: 'prices', rows: [], valuations: [], skipped: 0, code: 'PRICES',
               header: header, message: MESSAGES.pricesNotPayments };
    }

    var typeCol = -1, words = null, dirMap = null;
    var found = typeColumn(header, body, width, dateCol, amountCol, fundCol);
    if (found) { typeCol = found.col; words = found.words; }
    if (typeCol >= 0) {
      var allOwn = words.every(function (w) { return ownWord(w.word) !== null; });
      var direction = o.direction;
      if (!direction && allOwn) {
        direction = {};
        words.forEach(function (w) { direction[w.word] = ownWord(w.word); });
      }
      if (!direction && !signed) {
        return {
          ok: false, ask: 'direction', rows: [], valuations: [], skipped: 0, header: header,
          dateCol: dateCol, amountCol: amountCol, fundCol: fundCol, unitsCol: unitsCol, typeCol: typeCol,
          words: words, dayFirst: dayFirst, dateCertain: dateCertain, example: example,
          code: 'ASK-DIRECTION', message: MESSAGES.whichDirection(words.length)
        };
      }
      if (direction) {
        dirMap = {};
        Object.keys(direction).forEach(function (k) {
          var v = direction[k];
          dirMap[String(k).trim().toLowerCase()] = v === 'out' ? 'out' : v === 'value' ? 'value' : 'in';
        });
      }
    }

    var out = [], valuations = [], skipped = 0;
    for (var i = 0; i < body.length; i++) {
      var t = dateOf(body[i][dateCol], dayFirst);
      var n = ledgerAmount(body[i][amountCol]);
      if (!isFinite(t) || !isFinite(n) || n === 0) { skipped++; continue; }
      var dir = n < 0 ? 'out' : 'in';
      var fund = fundCol >= 0 ? String(body[i][fundCol] == null ? '' : body[i][fundCol]).trim() : '';
      if (dirMap) {
        var word = String(body[i][typeCol] == null ? '' : body[i][typeCol]).trim().toLowerCase();
        var said = dirMap[word];
        if (!said && n > 0) { skipped++; continue; }
        if (said === 'value') { valuations.push({ t: t, amount: Math.abs(n), fund: fund, line: i + (header ? 2 : 1) }); continue; }
        if (said) dir = said;
      }
      var u = unitsCol >= 0 ? ledgerAmount(body[i][unitsCol]) : NaN;
      var isin = isinCol >= 0 ? String(body[i][isinCol] == null ? '' : body[i][isinCol]).trim().toUpperCase() : '';
      var code = codeCol >= 0 ? String(body[i][codeCol] == null ? '' : body[i][codeCol]).trim() : '';
      out.push({ t: t, amount: Math.abs(n), dir: dir, units: isFinite(u) ? Math.abs(u) : null,
                 fund: fund, isin: P.ISIN_RE.test(isin) ? isin : '', code: code, line: i + (header ? 2 : 1) });
    }
    return {
      ok: out.length > 0, rows: out, valuations: valuations, skipped: skipped, header: header,
      dateCol: dateCol, amountCol: amountCol, fundCol: fundCol, unitsCol: unitsCol, typeCol: typeCol,
      words: words, dayFirst: dayFirst, dateCertain: dateCertain, example: example,
      code: out.length ? null : 'NO-ROWS', message: out.length ? null : MESSAGES.ledgerNoRows
    };
  }

  function typeColumn(header, body, width, dateCol, amountCol, fundCol) {
    var named = [], rest = [], c;
    for (c = 0; c < width; c++) {
      if (c === dateCol || c === amountCol || c === fundCol) continue;
      var head = header ? plain(header[c]) : '';
      if (head && TYPE_HEADERS.indexOf(head) >= 0) named.push(c); else rest.push(c);
    }
    named.sort(function (a, b) { return TYPE_HEADERS.indexOf(plain(header[a])) - TYPE_HEADERS.indexOf(plain(header[b])); });
    /* a column whose heading names something else (a fund house, an
       investor, a PAN, a folio, a broker) is never the type column */
    rest = rest.filter(function (k) { var h = header ? plain(header[k]) : ''; return !/\b(mf|amc|investor|pan|folio|broker|arn|isin|code|name|email|mobile)\b/.test(h); });
    var order = named.concat(rest);
    for (var k = 0; k < order.length; k++) {
      var words = typeWords(body, order[k], named.indexOf(order[k]) >= 0);
      if (words) return { col: order[k], words: words };
    }
    return null;
  }
  function typeWords(body, col, isNamed) {
    var seen = {}, order = [], filled = 0;
    for (var i = 0; i < body.length; i++) {
      var raw = String(body[i][col] == null ? '' : body[i][col]).trim();
      if (raw === '') continue;
      if (raw.length > 30) return null;
      if (isFinite(ledgerAmount(raw))) return null;
      if (anyDate(raw)) return null;
      filled++;
      var key = raw.toLowerCase();
      if (!seen[key]) { seen[key] = { word: raw, count: 0 }; order.push(key); }
      seen[key].count++;
      if (order.length > 8) return null;
    }
    if (filled < Math.max(2, Math.ceil(body.length * 0.6))) return null;
    if (order.length < (isNamed ? 1 : 2)) return null;
    return order.map(function (k) { var w = seen[k]; w.guess = guessDirection(w.word); return w; });
  }
  function ledgerFail(code, message) {
    return { ok: false, ask: null, rows: [], valuations: [], skipped: 0, header: null, dateCol: -1,
             amountCol: -1, fundCol: -1, typeCol: -1, words: null, dayFirst: true, dateCertain: true,
             example: null, code: code, message: message };
  }
  function bestColumn(probe, width, test, need) {
    var bestAt = -1, bestCount = 0;
    for (var c = 0; c < width; c++) {
      var hits = 0;
      for (var r = 0; r < probe.length; r++) {
        var cell = probe[r][c];
        if (cell == null || cell === '') continue;
        if (test(cell)) hits++;
      }
      if (hits > bestCount) { bestCount = hits; bestAt = c; }
    }
    return bestCount >= need ? bestAt : -1;
  }
  function amountColumn(header, probe, width, dateCol) {
    if (header) {
      for (var i = 0; i < header.length; i++) {
        if (i === dateCol) continue;
        if (AMOUNT_HEADERS.indexOf(plain(header[i])) >= 0) return i;
      }
      for (var j = 0; j < header.length; j++) {
        if (j === dateCol) continue;
        if (/\bamount\b|\bamt\b/i.test(plain(header[j]))) return j;
      }
    }
    var need = Math.max(1, Math.ceil(probe.length * 0.6));
    var order = [];
    for (var a = dateCol + 1; a < width; a++) order.push(a);
    for (var b = 0; b < dateCol; b++) order.push(b);
    for (var k = 0; k < order.length; k++) {
      var c = order[k], hits = 0;
      for (var r2 = 0; r2 < probe.length; r2++) {
        var v = ledgerAmount(probe[r2][c]);
        if (isFinite(v) && v !== 0) hits++;
      }
      if (hits >= need) return c;
    }
    return -1;
  }
  function unitsColumn(header, width, dateCol, amountCol, fundCol) {
    if (!header) return -1;
    for (var i = 0; i < width; i++) {
      if (i === dateCol || i === amountCol || i === fundCol) continue;
      if (UNITS_HEADERS.test(plain(header[i]))) return i;
    }
    return -1;
  }
  /* Named only. Inferring a fund from a narration column would be inventing an attribution. */
  function fundColumn(header, width, dateCol, amountCol) {
    if (header) {
      for (var i = 0; i < header.length; i++) {
        if (i === dateCol || i === amountCol) continue;
        if (FUND_HEADERS.test(plain(header[i]))) return i;
      }
      return -1;
    }
    if (width === 3) { for (var c = 0; c < 3; c++) if (c !== dateCol && c !== amountCol) return c; }
    return -1;
  }

  /* ------------------------------------------------- what is left, per scheme */
  function schemeTotals(rows) {
    var order = [], by = {};
    (rows || []).forEach(function (r) {
      var key = (r.fund || '').trim();
      if (!by[key]) {
        by[key] = { name: key, rows: [], paidIn: 0, tookOut: 0, unitsIn: 0, unitsOut: 0, units: null,
                    first: r.t, last: r.t, hasUnits: false, isin: '', code: '', unitsBought: 0, paidForUnits: 0 };
        order.push(key);
      }
      var g = by[key];
      g.rows.push(r);
      if (r.dir === 'out') g.tookOut += r.amount; else g.paidIn += r.amount;
      if (r.units != null) {
        g.hasUnits = true;
        if (r.dir === 'out') g.unitsOut += r.units;
        else { g.unitsIn += r.units; if (r.units > 0) { g.unitsBought += r.units; g.paidForUnits += r.amount; } }
      }
      if (r.isin && !g.isin) g.isin = r.isin;
      if (r.code && !g.code) g.code = r.code;
      if (r.t < g.first) g.first = r.t;
      if (r.t > g.last) g.last = r.t;
    });
    return order.map(function (k) {
      var g = by[k];
      if (g.hasUnits) { g.units = g.unitsIn - g.unitsOut; if (Math.abs(g.units) < 0.001) g.units = 0; }
      g.closed = g.hasUnits && g.units === 0;
      return g;
    });
  }

  /* A switch is money leaving one fund and entering another on the same day
     for the same amount. The XIRR is unaffected either way; the totals of
     money put in and taken out are, so the pairs are marked and the screen
     leaves them out of those two totals. */
  function markSwitches(rows) {
    var byKey = {};
    rows.forEach(function (r, i) {
      var key = r.t + '|' + Math.round(r.amount * 100);
      (byKey[key] = byKey[key] || []).push(i);
    });
    var n = 0;
    Object.keys(byKey).forEach(function (k) {
      var idx = byKey[k];
      var outs = idx.filter(function (i) { return rows[i].dir === 'out'; });
      var ins = idx.filter(function (i) { return rows[i].dir === 'in'; });
      while (outs.length && ins.length) {
        var o = outs.shift(), a = ins.shift();
        if (rows[o].fund && rows[a].fund && rows[o].fund === rows[a].fund) continue;
        rows[o].switch = true; rows[a].switch = true; n++;
      }
    });
    return n;
  }

  /* ============================================ a holdings snapshot */
  var HOLD_NAME = /scheme|fund|security|instrument|stock|holding|particular|name/i;
  var HOLD_INVESTED = /invest|cost|purchase|acquisition|buy|paid/i;
  var HOLD_CURRENT = /current|market|present|latest|closing|valuation|worth|\bvalue\b/i;
  var HOLD_UNITS = /unit|quantit|\bqty\b|balance|share/i;
  var HOLD_TOTAL = /^\s*(grand\s+)?total\b|^\s*sum\b|^\s*overall\b/i;

  function holdingsRows(input, options) {
    var rows = rowsFrom(input);
    if (blankRows(rows)) return holdFail('NO-ROWS', MESSAGES.holdNoRows);
    var header = null, body = null;
    for (var h = 0; h < Math.min(rows.length, 8); h++) {
      if (wordCells(rows[h]) >= 2 && !rows[h].some(function (c) { return isFinite(ledgerAmount(c)); })) {
        header = rows[h]; body = rows.slice(h + 1); break;
      }
    }
    if (!header || !body || !body.length) return holdFail('NO-HEADER', MESSAGES.holdNoHeader);
    var width = Math.max.apply(null, [header.length].concat(body.map(function (r) { return r.length; })));
    var used = {};
    function pick(pattern, skipIfMatches) {
      for (var i = 0; i < width; i++) {
        if (used[i]) continue;
        var name = String(header[i] == null ? '' : header[i]).trim();
        if (!name || !pattern.test(name)) continue;
        if (skipIfMatches && skipIfMatches.test(name)) continue;
        used[i] = true;
        return i;
      }
      return -1;
    }
    var nameCol = pick(HOLD_NAME);
    var investedCol = pick(HOLD_INVESTED);
    var currentCol = pick(HOLD_CURRENT, HOLD_INVESTED);
    var unitsCol = pick(HOLD_UNITS);
    if (nameCol < 0) return holdFail('NO-NAMES', MESSAGES.holdNoNames);
    if (investedCol < 0 && currentCol < 0) return holdFail('NO-MONEY', MESSAGES.holdNoMoney);
    if (manyDates(body, width)) return holdFail('DATED', MESSAGES.holdIsDated);
    var out = [], skipped = 0, totals = 0;
    for (var r = 0; r < body.length; r++) {
      var name = String(body[r][nameCol] == null ? '' : body[r][nameCol]).trim();
      var invested = investedCol >= 0 ? ledgerAmount(body[r][investedCol]) : NaN;
      var current = currentCol >= 0 ? ledgerAmount(body[r][currentCol]) : NaN;
      var units = unitsCol >= 0 ? ledgerAmount(body[r][unitsCol]) : NaN;
      if (HOLD_TOTAL.test(name)) { totals++; continue; }
      if (!name) { skipped++; continue; }
      if (!isFinite(invested) && !isFinite(current)) { skipped++; continue; }
      out.push({ name: name, invested: isFinite(invested) ? Math.abs(invested) : null,
                 current: isFinite(current) ? Math.abs(current) : null, units: isFinite(units) ? units : null, line: r + 2 });
    }
    return { ok: out.length > 0, kind: 'holdings', rows: out, skipped: skipped, totalsDropped: totals, header: header,
             nameCol: nameCol, investedCol: investedCol, currentCol: currentCol, unitsCol: unitsCol,
             code: out.length ? null : 'NO-ROWS', message: out.length ? null : MESSAGES.holdNoRows };
  }
  function priceShaped(header, body, dateCol, amountCol, dayFirst) {
    if (header && amountCol >= 0) {
      var name = String(header[amountCol] == null ? '' : header[amountCol]).trim();
      if (name && PRICE_HEADERS.test(name)) return true;
    }
    if (body.length < 30 || dateCol < 0) return false;
    var times = [];
    for (var i = 0; i < body.length; i++) { var t = dateOf(body[i][dateCol], dayFirst); if (isFinite(t)) times.push(t); }
    if (times.length < 30) return false;
    times.sort(function (a, b) { return a - b; });
    var gaps = [];
    for (var j = 1; j < times.length; j++) gaps.push((times[j] - times[j - 1]) / MS_DAY);
    gaps.sort(function (a, b) { return a - b; });
    return gaps[Math.floor(gaps.length / 2)] <= 4;
  }
  function looksLikePrices(ledger) {
    if (ledger.header && ledger.amountCol >= 0) {
      var name = String(ledger.header[ledger.amountCol] == null ? '' : ledger.header[ledger.amountCol]).trim();
      if (name && PRICE_HEADERS.test(name)) return true;
    }
    var rows = ledger.rows;
    if (rows.length < 30) return false;
    var times = rows.map(function (r) { return r.t; }).sort(function (a, b) { return a - b; });
    var gaps = [];
    for (var i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / MS_DAY);
    gaps.sort(function (a, b) { return a - b; });
    return gaps[Math.floor(gaps.length / 2)] <= 4;
  }
  function manyDates(body, width) {
    /* a line holding one cell (a section heading, a fund house's name) is not a row of data */
    body = body.filter(function (row) { return row && row.filter(function (c) { return String(c == null ? '' : c).trim() !== ''; }).length >= 2; });
    for (var c = 0; c < width; c++) {
      var seen = {}, n = 0, distinct = 0;
      for (var r = 0; r < body.length; r++) {
        var t = dateOf(body[r][c], true);
        if (!isFinite(t)) continue;
        n++;
        if (!seen[t]) { seen[t] = true; distinct++; }
      }
      if (n >= Math.max(2, Math.ceil(body.length * 0.8)) && distinct > 1) return true;
    }
    return false;
  }
  function wordCells(row) {
    var n = 0;
    for (var i = 0; i < row.length; i++) {
      var v = String(row[i] == null ? '' : row[i]).trim();
      if (v && !isFinite(ledgerAmount(v)) && !anyDate(v)) n++;
    }
    return n;
  }
  function holdFail(code, message) {
    return { ok: false, kind: 'holdings', rows: [], skipped: 0, totalsDropped: 0, header: null,
             nameCol: -1, investedCol: -1, currentCol: -1, unitsCol: -1, code: code, message: message };
  }

  /* ------------------------------------------------ which file is this? */
  function portfolioFile(input, options) {
    var rows = rowsFrom(input);
    if (blankRows(rows)) return { ok: false, kind: null, rows: [], valuations: [], skipped: 0, code: 'EMPTY', message: MESSAGES.empty };
    /* C1: one price-data check for every row set, a file, a paste or a drop,
       before either reader sees it: a short NAV file can otherwise pass for a
       holdings snapshot, its NAVs read as what each fund is worth. */
    var looks = P.pricesNotPayments(rows);
    if (looks.prices) {
      return { ok: false, kind: 'prices', rows: [], valuations: [], skipped: 0, code: 'PRICES',
               message: MESSAGES.pricesNotPayments, reasons: looks.signals.reasons };
    }
    var holdings = holdingsRows(rows, options);
    if (holdings.ok) return holdings;
    var ledger = ledgerRows(rows, options);
    if (ledger.code === 'PRICES') return ledger;
    if (ledger.ok || ledger.ask) {
      if (ledger.ok && looksLikePrices(ledger)) {
        return { ok: false, kind: 'prices', rows: [], valuations: [], skipped: 0, code: 'PRICES', message: MESSAGES.pricesNotPayments };
      }
      ledger.kind = 'ledger';
      if (ledger.ok) ledger.switches = markSwitches(ledger.rows);
      return ledger;
    }
    return { ok: false, kind: null, rows: [], valuations: [], skipped: 0, code: 'UNREADABLE', message: MESSAGES.neitherShape,
             holdingsMessage: holdings.message, ledgerMessage: ledger.message };
  }

  function firstAmbiguousDate(rows) {
    for (var i = 0; i < rows.length; i++) {
      for (var c = 0; c < rows[i].length; c++) {
        var raw = String(rows[i][c] == null ? '' : rows[i][c]).trim();
        var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(raw);
        if (!m) continue;
        var a = +m[1], b = +m[2];
        if (a > 12 || b > 12 || a === b) continue;
        var y = +m[3] < 100 ? (+m[3] < 70 ? 2000 + +m[3] : 1900 + +m[3]) : +m[3];
        return { raw: raw, dayFirst: F.date(Date.UTC(y, b - 1, a)), monthFirst: F.date(Date.UTC(y, a - 1, b)) };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------- stitching
   * Several files of one history, joined by date. Where two carry the same
   * day the later file wins. Gaps wider than GAP_DAYS are reported. */
  function stitch(seriesList) {
    var byDate = {}, overlaps = 0;
    seriesList.forEach(function (series) {
      series.forEach(function (p) { if (byDate[p.t] !== undefined) overlaps++; byDate[p.t] = p.v; });
    });
    var series = Object.keys(byDate).map(function (t) { return { t: +t, v: byDate[t] }; })
      .sort(function (a, b) { return a.t - b.t; });
    return { series: series, overlaps: overlaps, gaps: gapsIn(series) };
  }
  function gapsIn(series) {
    var out = [];
    for (var i = 1; i < series.length; i++) {
      var days = Math.round((series[i].t - series[i - 1].t) / MS_DAY);
      if (days > GAP_DAYS) out.push({ days: days, from: series[i - 1].t, to: series[i].t });
    }
    return out;
  }

  /* -------------------------------------------------------- the messages */
  var MESSAGES = {
    empty: 'That file is empty: there is nothing in it to read. Download it again, or open it on ' +
           'your computer and check it holds rows.',
    ledgerNoRows: 'There was nothing to read in that. Copy the rows themselves, not a picture of them.',
    ledgerNoDates: 'I could not find a column of dates in that. Each line needs a date and an amount.',
    ledgerNoAmount: 'I found the dates but no column of amounts beside them. Copy the amount column ' +
                    'too, with a minus or brackets on the money you took out.',
    holdNoRows: 'There was nothing to read in that file.',
    holdNoHeader: 'This file has no row of column names at the top, and a holdings file needs one: the ' +
                  'words are the only thing that says which figure is what you paid and which is what it ' +
                  'is worth now.',
    holdNoNames: 'I could not find a column of fund names in this file.',
    holdIsDated: 'The rows in this file carry different dates, so it is a record of payments rather than a ' +
                 'picture of what is held today.',
    holdNoMoney: 'I found the fund names but no column of amounts beside them: neither what you put ' +
                 'in nor what it is worth now.',
    pricesNotPayments: 'This looks like a fund’s price history: one row for each day the market ' +
                       'was open. It is not a record of your own payments. Read as payments it ' +
                       'would produce a confident and completely wrong figure, so it is refused here. ' +
                       'This screen wants your holdings or your transaction statement. To measure the ' +
                       'fund itself, use Rolling returns, which is the screen this file belongs to.',
    neitherShape: 'I could not read this as either kind of file. Two downloads work here: your holdings ' +
                  'or portfolio statement, which lists each fund with what you put in and what it is ' +
                  'worth; or your transaction statement, which lists each payment with its date. A ' +
                  'screenshot or a PDF will not work. Look for CSV or Excel.',
    noDatesForRate: 'This is a holdings file, so it says what you own today but not when you bought it. A ' +
                    'yearly rate needs the dates. For that, download your transaction statement instead, ' +
                    'from the same place, usually under Reports or Statements.',
    whichDirection: function (n) {
      return 'Every amount here is unsigned, and one column says what each line was. Tick the ' +
             (n === 1 ? 'word' : 'words') + ' that mean money going OUT.';
    },
    gap: function (g) {
      return 'There is a gap of ' + F.count(g.days) + ' days, ' + F.span(g.from, g.to) +
             '. Windows crossing it use the last value before it. If you downloaded in pieces, one may be missing.';
    }
  };

  var api = {
    rowsFrom: rowsFrom, jsonRows: jsonRows,
    ledgerRows: ledgerRows, ledgerAmount: ledgerAmount, typeColumn: typeColumn, ownWord: ownWord,
    guessDirection: guessDirection, holdingsRows: holdingsRows, portfolioFile: portfolioFile,
    schemeTotals: schemeTotals, markSwitches: markSwitches, firstAmbiguousDate: firstAmbiguousDate,
    stitch: stitch, gapsIn: gapsIn, MESSAGES: MESSAGES, GAP_DAYS: GAP_DAYS
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimUpload = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
