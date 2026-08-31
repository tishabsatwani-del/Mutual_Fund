/* Where You Stand — the upload door, review v4 section 5.
 *
 * Upload is the ONLY door (§3), so it carries the weight a fetch would have
 * carried. That means it cannot just parse: it has to hold a conversation.
 * Three of §5's rules are questions, not answers, and this file is what makes
 * them askable —
 *
 *   dates that read two ways      ask once, showing the first row both ways
 *   a file holding many schemes   list them, grouped by plan and option
 *   the reader picks an IDCW row  refuse, and say which row to pick instead
 *
 * — and two are arithmetic over several files at once: stitch by date,
 * removing overlaps, and report the gaps that are left.
 *
 * Every message below is section 5's, transcribed. Each one is an instruction:
 * it says what happened and what to do about it, and never only the first.
 *
 * No DOM, no clock, no network. The screen calls read() and renders whatever
 * verdict comes back, which is what lets the whole conversation be tested
 * headlessly.
 */
(function (root) {
  'use strict';

  var P = (typeof require === 'function') ? require('../tool/parse.js') : root.PRCParse;
  var S = (typeof require === 'function') ? require('./schemes.js') : root.SimSchemes;
  var F = (typeof require === 'function') ? require('./format.js') : root.SimFormat;

  var MS_DAY = 86400000;
  /* A weekend plus a long holiday run is normal in an Indian NAV file. Beyond
   * this the reader is probably missing a downloaded piece, which is the one
   * cause they can actually do something about. */
  var GAP_DAYS = 45;

  function refuse(code, message, extra) {
    var out = { ok: false, ask: null, code: code, message: message };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }
  function ask(question, message, extra) {
    var out = { ok: false, ask: question, message: message };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  /* ------------------------------------------------------------ the rows
   * "Read content, not headers" is parse.js's job already. This adds the two
   * shapes the door accepts that a delimited reader does not: a JSON array of
   * records, and rows handed straight in from a workbook. */
  function rowsFrom(input) {
    if (Array.isArray(input.rows)) return input.rows;
    var text = String(input.text == null ? '' : input.text);
    var trimmed = text.replace(/^﻿/, '').trim();
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      var rows = jsonRows(trimmed);
      if (rows) return rows;
    }
    return P.parseDelimited(text);
  }

  /* A JSON export is a list of records with a date key and a value key under
   * whatever names the exporter chose. The keys are found the same way the
   * columns are: by what is in them, not by what they are called. */
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
    list.forEach(function (rec) {
      rows.push(keys.map(function (k) { return rec[k] == null ? '' : String(rec[k]); }));
    });
    return rows;
  }

  /* ------------------------------------------------------------- a ledger
   *
   * A NAV column and a ledger column are not the same kind of number, and one
   * parser cannot serve both. rowsToSeries drops any value at or below zero
   * (a NAV cannot be negative) and its fallback takes the LAST numeric column
   * (a NAV file's last number is the NAV). In a ledger the negatives are the
   * whole point -- they are the money going out -- and the last numeric column
   * of a statement is usually a unit balance. So the ledger gets its own
   * reader, and both ledger screens share this one.
   */

  /* An amount as a statement writes it, with its sign preserved: a bracketed
   * figure and a true minus both mean money out.
   *
   * Deliberately NOT read: a Dr/Cr suffix. Taking direction from a bank's
   * abbreviation is a guess about the reader's own data, and a wrong guess
   * turns a purchase into a withdrawal silently. Those rows are skipped and
   * shown in the preview, where the reader can see them. */
  function ledgerAmount(raw) {
    var t = String(raw == null ? '' : raw).trim().replace(/^"(.*)"$/, '$1').trim();
    var neg = false;
    var wrapped = /^\((.*)\)$/.exec(t);
    if (wrapped) { neg = true; t = wrapped[1]; }
    t = t.replace(/[\u20B9$,\s\u00A0]/g, '').replace(/^\u2212/, '-');
    if (t === '' || t === '-' || /^n\.?a\.?$/i.test(t)) return NaN;
    /* The WHOLE cell must be a number. parseFloat stops at the first character
     * it cannot use, so "5000 Dr" came back as 5000 and a debit was read as
     * money IN -- silently, and in the wrong direction, which is the one
     * failure this parser must never have. Anything left over means the cell
     * says something this reader does not understand, and it is skipped and
     * counted where the reader can see it. */
    if (!/^-?\d*\.?\d+$/.test(t)) return NaN;
    var n = parseFloat(t);
    if (!isFinite(n)) return NaN;
    return neg ? -Math.abs(n) : n;
  }

  var AMOUNT_HEADERS = ['amount', 'amt', 'transaction amount', 'net amount', 'amount (rs.)',
                        'amount in rs.', 'value', 'debit', 'credit', 'withdrawal', 'deposit'];

  /* Two columns out of a spreadsheet, read by content. Returns rows the ledger
   * screens can use directly, plus everything a preview needs to show what was
   * read and what was left out. */
  function ledgerRows(input, options) {
    var o = options || {};
    /* Text from a paste, or rows already read out of a workbook by the same
       reader the NAV door uses. A dropped .xlsx ledger arrives as the second. */
    var rows = Array.isArray(input)
      ? input
      : P.parseDelimited(String(input == null ? '' : input));
    if (!rows.length) return ledgerFail('NO-ROWS', MESSAGES.ledgerNoRows);

    /* A header is recognised by CONTENT: a first row in which no cell reads as
       a date. That is what stops the word "Date" being counted as a line the
       tool could not read. */
    var header = null, body = rows;
    if (rows.length >= 2 && !rows[0].some(function (c) { return isFinite(dateOf(c, true)); })) {
      header = rows[0];
      body = rows.slice(1);
    }
    if (!body.length) return ledgerFail('NO-ROWS', MESSAGES.ledgerNoRows);

    var probe = body.slice(0, 40);
    var width = Math.max.apply(null, body.map(function (r) { return r.length; }).concat([0]));

    var dateCol = bestColumn(probe, width, function (cell) { return isFinite(dateOf(cell, true)); },
                             Math.max(1, Math.ceil(probe.length * 0.5)));
    if (dateCol < 0) return ledgerFail('NO-DATES', MESSAGES.ledgerNoDates);

    var dayFirst = true, dateCertain = true, example = null;
    if (o.dayFirst !== undefined) {
      dayFirst = !!o.dayFirst;
    } else {
      var seen = P.detectDayFirst(body, dateCol);
      dayFirst = seen.dayFirst;
      dateCertain = seen.certain;
      if (!seen.certain) example = firstAmbiguousDate(body);
    }

    var amountCol = amountColumn(header, probe, width, dateCol);
    if (amountCol < 0) return ledgerFail('NO-AMOUNT', MESSAGES.ledgerNoAmount);

    var fundCol = fundColumn(header, width, dateCol, amountCol);

    /* ------------------------------------------------------- which way it went
     * A minus sign or a bracket is the reader saying it themselves, and it wins
     * outright. Where every amount is unsigned, the only thing in the file that
     * knows is a type column -- "Purchase", "Redemption", "SIP". What those
     * words MEAN is not decided here. They are handed back with their counts
     * and the reader says which ones are money out, once, for the whole file.
     *
     * This is the same rule that makes "5000 Dr" unreadable: a direction taken
     * from an abbreviation the tool has decided it understands is wrong
     * silently, and backwards, which is the one failure this parser must not
     * have. Asking costs one click. */
    var signed = false;
    for (var q = 0; q < body.length && !signed; q++) {
      var probeAmt = ledgerAmount(body[q][amountCol]);
      if (isFinite(probeAmt) && probeAmt < 0) signed = true;
    }

    var typeCol = -1, words = null, dirMap = null;
    if (!signed) {
      var found = typeColumn(header, body, width, dateCol, amountCol, fundCol);
      if (found) { typeCol = found.col; words = found.words; }
    }
    if (typeCol >= 0) {
      if (!o.direction) {
        return {
          ok: false, ask: 'direction', rows: [], skipped: 0, header: header,
          dateCol: dateCol, amountCol: amountCol, fundCol: fundCol, typeCol: typeCol,
          words: words, dayFirst: dayFirst, dateCertain: dateCertain, example: example,
          code: 'ASK-DIRECTION', message: MESSAGES.whichDirection(words.length)
        };
      }
      dirMap = {};
      Object.keys(o.direction).forEach(function (k) {
        dirMap[String(k).trim().toLowerCase()] = o.direction[k] === 'out' ? 'out' : 'in';
      });
    }

    var out = [], skipped = 0;
    for (var i = 0; i < body.length; i++) {
      var t = dateOf(body[i][dateCol], dayFirst);
      var n = ledgerAmount(body[i][amountCol]);
      if (!isFinite(t) || !isFinite(n) || n === 0) { skipped++; continue; }
      var dir = n < 0 ? 'out' : 'in';
      if (dirMap) {
        /* A row whose word the reader never saw -- an empty type cell, or one
           that turned up below where the words were counted -- is skipped and
           counted, never quietly filed as money in. */
        var said = dirMap[String(body[i][typeCol] == null ? '' : body[i][typeCol]).trim().toLowerCase()];
        if (!said) { skipped++; continue; }
        dir = said;
      }
      out.push({
        t: t, amount: Math.abs(n), dir: dir,
        fund: fundCol >= 0 ? String(body[i][fundCol] == null ? '' : body[i][fundCol]).trim() : '',
        line: i + (header ? 2 : 1)
      });
    }

    return {
      ok: out.length > 0, rows: out, skipped: skipped, header: header,
      dateCol: dateCol, amountCol: amountCol, fundCol: fundCol, typeCol: typeCol,
      words: words, dayFirst: dayFirst, dateCertain: dateCertain, example: example,
      code: out.length ? null : 'NO-ROWS',
      message: out.length ? null : MESSAGES.ledgerNoRows
    };
  }

  /* A column of a few repeated short words is a transaction type. It is found
   * by shape, not only by name, because half the exports in circulation head it
   * "Particulars" or nothing at all.
   *
   * A named column may hold ONE word -- a file that is all redemptions still
   * has to be asked about, or it reads entirely backwards. An unnamed one needs
   * at least two, otherwise every file with a constant column in it ("NSE",
   * "INR") would ask a question about nothing. */
  var TYPE_HEADERS = ['type', 'transaction type', 'txn type', 'transaction', 'nature',
                      'kind', 'particulars', 'description', 'narration'];

  /* ------------------------------------------- what the brokers call things
   *
   * The words that mean money leaving the reader's pocket, and the words that
   * mean it coming back. This does NOT decide anything: it pre-ticks the
   * question, and the reader still confirms.
   *
   * That is deliberate and it is the whole design. A dictionary that is right
   * ninety-five times in a hundred is silent the other five, and a direction
   * that is silently backwards is the one failure this parser must not have.
   * "Switch Out" is the clearest case: it is money leaving one fund and
   * entering another on the same day, and read as a plain redemption it
   * inflates the return of whatever it left. So the words arrive already
   * ticked and one tap confirms them, instead of three taps setting them.
   */
  var TERMS_OUT = [
    /redem|redeem/i, /\bsell\b|\bsale\b|sold/i, /switch\s*[-_ ]?out/i, /transfer\s*[-_ ]?out/i,
    /withdraw/i, /\bswp\b|systematic\s+withdraw/i, /payout|dividend\s+paid|idcw\s+paid/i,
    /\bexit\b/i, /repurchase/i
  ];
  /* \bpurchases?\b, not /purchase/. "Repurchase" is the AMC buying units BACK
     from the reader -- a redemption, money out -- and an unanchored match read
     it as a purchase, which is precisely backwards. There is no word boundary
     inside "Repurchase", so the anchor excludes it while "Additional Purchase"
     still matches. */
  var TERMS_IN = [
    /\bpurchases?\b|\bbuy\b|bought/i, /\bsip\b|systematic\s+invest/i, /switch\s*[-_ ]?in/i,
    /transfer\s*[-_ ]?in/i, /\binvest/i, /\bstp\s*[-_ ]?in/i, /subscription|allot/i,
    /reinvest|dividend\s+reinvest/i, /\badd(ition)?\b/i, /lump\s*sum/i
  ];

  /* The reader's own word, matched against both lists. A word that matches
   * NEITHER is left unticked -- which reads as money in, the same as before
   * this dictionary existed -- and a word that somehow matches both is left
   * unticked too, because two answers is not an answer. */
  function guessDirection(word) {
    var t = String(word == null ? '' : word);
    var out = TERMS_OUT.some(function (re) { return re.test(t); });
    var into = TERMS_IN.some(function (re) { return re.test(t); });
    if (out && !into) return 'out';
    if (into && !out) return 'in';
    return null;
  }

  function typeColumn(header, body, width, dateCol, amountCol, fundCol) {
    var named = [], rest = [], c;
    for (c = 0; c < width; c++) {
      /* The fund column is already spoken for. Without this, a three-column
         export -- date, amount, fund -- asks the reader which of their own
         fund names means money out. */
      if (c === dateCol || c === amountCol || c === fundCol) continue;
      var head = header ? String(header[c] == null ? '' : header[c]).toLowerCase().trim() : '';
      if (head && TYPE_HEADERS.indexOf(head) >= 0) named.push(c); else rest.push(c);
    }
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
      if (raw.length > 30) return null;                    /* a narration, not a type */
      if (isFinite(ledgerAmount(raw))) return null;        /* another money column */
      if (isFinite(dateOf(raw, true))) return null;        /* another date column */
      filled++;
      var key = raw.toLowerCase();
      if (!seen[key]) { seen[key] = { word: raw, count: 0 }; order.push(key); }
      seen[key].count++;
      if (order.length > 8) return null;                   /* not a small set of types */
    }
    if (filled < Math.max(2, Math.ceil(body.length * 0.6))) return null;
    if (order.length < (isNamed ? 1 : 2)) return null;
    return order.map(function (k) {
      var w = seen[k];
      w.guess = guessDirection(w.word);      /* a suggestion, never a decision */
      return w;
    });
  }

  function ledgerFail(code, message) {
    return { ok: false, ask: null, rows: [], skipped: 0, header: null, dateCol: -1,
             amountCol: -1, fundCol: -1, typeCol: -1, words: null, dayFirst: true,
             dateCertain: true, example: null, code: code, message: message };
  }

  function dateOf(cell, dayFirst) { return P.toTimestamp(P.parseDateParts(cell, dayFirst)); }

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

  /* Named first, because a statement that says "Amount" means it; then shape. */
  function amountColumn(header, probe, width, dateCol) {
    if (header) {
      for (var i = 0; i < header.length; i++) {
        if (i === dateCol) continue;
        if (AMOUNT_HEADERS.indexOf(String(header[i] || '').toLowerCase().trim()) >= 0) return i;
      }
      for (var j = 0; j < header.length; j++) {
        if (j === dateCol) continue;
        if (/\bamount\b|\bamt\b/i.test(String(header[j] || ''))) return j;
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

  /* Named only. Inferring a fund from a bank's narration column would be the
     tool inventing an attribution for the reader's money. */
  function fundColumn(header, width, dateCol, amountCol) {
    if (header) {
      for (var i = 0; i < header.length; i++) {
        if (i === dateCol || i === amountCol) continue;
        if (/^(fund|fund name|scheme|scheme name)$/i.test(String(header[i] || '').trim())) return i;
      }
      return -1;
    }
    if (width === 3) {
      for (var c = 0; c < 3; c++) if (c !== dateCol && c !== amountCol) return c;
    }
    return -1;
  }

  /* ============================================ a holdings snapshot
   *
   * The OTHER file a reader can download, and the one most of them will find
   * first, because it is the button on the screen they are already looking at.
   * It holds what they own right now: scheme, units, what they put in, what it
   * is worth. It holds NO DATES, so no yearly rate can ever come out of it --
   * not with a better parser, not ever. The information is not in the file.
   *
   * That is not a reason to refuse it. Invested against current value is a real
   * answer, and often the one the reader wanted. So this reads the snapshot for
   * what it does hold, and the screen says plainly which question it cannot
   * answer from it and where the file that can is kept.
   *
   * Columns are found BY HEADER here, unlike everywhere else in this file,
   * and that is deliberate. Two money columns sit side by side and nothing in
   * their shape tells them apart: 50,000 and 62,300 are both just numbers. Only
   * the words above them say which is cost and which is worth, and getting that
   * pair backwards turns a gain into a loss silently. Where the headers do not
   * say, this asks rather than guesses.
   */
  var HOLD_NAME = /scheme|fund|security|instrument|stock|holding|particular|name/i;
  /* Checked FIRST, and the more specific of the two: "Cost Value" would match
     the current-value pattern too, on the word "value" alone. */
  var HOLD_INVESTED = /invest|cost|purchase|acquisition|buy|paid/i;
  /* "Amount" is deliberately NOT here. A snapshot names its valuation column --
     Current Value, Market Value -- and a bare "Amount" is what a transaction
     statement calls a payment. Matching it read a statement of two dated
     payments as two holdings and threw the dates away. */
  var HOLD_CURRENT = /current|market|present|latest|closing|valuation|worth|\bvalue\b/i;
  var HOLD_UNITS = /unit|quantit|\bqty\b|balance|share/i;
  /* A snapshot almost always ends in a totals row. Counted as a holding it
     doubles every figure on the screen, and the doubling looks entirely
     plausible -- which is the sort of wrong number that never gets caught. */
  var HOLD_TOTAL = /^\s*(grand\s+)?total\b|^\s*sum\b|^\s*overall\b/i;

  function holdingsRows(input, options) {
    var o = options || {};
    var rows = Array.isArray(input)
      ? input
      : P.parseDelimited(String(input == null ? '' : input));
    if (!rows.length) return holdFail('NO-ROWS', MESSAGES.holdNoRows);

    /* A header is required, for the reason above. It is the first row in which
       at least two cells are words rather than numbers or dates. */
    var header = null, body = null;
    for (var h = 0; h < Math.min(rows.length, 8); h++) {
      if (wordCells(rows[h]) >= 2 && !rows[h].some(function (c) {
        return isFinite(ledgerAmount(c));
      })) { header = rows[h]; body = rows.slice(h + 1); break; }
    }
    if (!header || !body || !body.length) return holdFail('NO-HEADER', MESSAGES.holdNoHeader);

    var width = Math.max.apply(null, [header.length].concat(
      body.map(function (r) { return r.length; })));

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
    /* Invested before current, and a current-column match is refused the words
       that mean cost, so "Cost Value" cannot land on the wrong side. */
    var investedCol = pick(HOLD_INVESTED);
    var currentCol = pick(HOLD_CURRENT, HOLD_INVESTED);
    var unitsCol = pick(HOLD_UNITS);

    if (nameCol < 0) return holdFail('NO-NAMES', MESSAGES.holdNoNames);
    if (investedCol < 0 && currentCol < 0) return holdFail('NO-MONEY', MESSAGES.holdNoMoney);

    /* A snapshot is ONE point in time. It may carry an "as on" date column, and
     * every row will hold the same date. Rows carrying DIFFERENT dates are
     * events, not a position -- a transaction statement with a fund column
     * beside the amount -- and reading those as holdings throws the dates away
     * and with them the yearly rate, silently. */
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

      out.push({
        name: name,
        invested: isFinite(invested) ? Math.abs(invested) : null,
        current: isFinite(current) ? Math.abs(current) : null,
        units: isFinite(units) ? units : null,
        line: r + 2
      });
    }

    return {
      ok: out.length > 0, kind: 'holdings', rows: out, skipped: skipped, totalsDropped: totals,
      header: header, nameCol: nameCol, investedCol: investedCol,
      currentCol: currentCol, unitsCol: unitsCol,
      code: out.length ? null : 'NO-ROWS',
      message: out.length ? null : MESSAGES.holdNoRows
    };
  }

  /* Two tests, either of which settles it.
   *
   * The header, when there is one: nothing called NAV or a price is a payment.
   *
   * The shape, when there is not -- and AMFI's own download has no useful
   * header at all. A payments file is a few dozen rows at most, spread over
   * years, with gaps of weeks or months. A price file is one row per trading
   * day: hundreds of them, nearly all one to four days apart. No statement of
   * anybody's own payments looks like that. */
  var PRICE_HEADERS = /\bnav\b|net\s*asset|\bprice\b|\bclose\b|\bclosing\b|repurchase/i;

  function looksLikePrices(ledger) {
    if (ledger.header && ledger.amountCol >= 0) {
      var name = String(ledger.header[ledger.amountCol] == null
        ? '' : ledger.header[ledger.amountCol]).trim();
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
    for (var c = 0; c < width; c++) {
      var seen = {}, n = 0, distinct = 0;
      for (var r = 0; r < body.length; r++) {
        var t = dateOf(body[r][c], true);
        if (!isFinite(t)) continue;
        n++;
        if (!seen[t]) { seen[t] = true; distinct++; }
      }
      /* Most of the column has to read as dates before it counts as one at all,
         so a stray year in a fund's name cannot trip this. */
      if (n >= Math.max(2, Math.ceil(body.length * 0.8)) && distinct > 1) return true;
    }
    return false;
  }

  function wordCells(row) {
    var n = 0;
    for (var i = 0; i < row.length; i++) {
      var v = String(row[i] == null ? '' : row[i]).trim();
      if (v && !isFinite(ledgerAmount(v)) && !isFinite(dateOf(v, true))) n++;
    }
    return n;
  }

  function holdFail(code, message) {
    return { ok: false, kind: 'holdings', rows: [], skipped: 0, totalsDropped: 0, header: null,
             nameCol: -1, investedCol: -1, currentCol: -1, unitsCol: -1,
             code: code, message: message };
  }

  /* ------------------------------------------------ which file is this?
   *
   * The reader chooses no file type and is asked no question about one. They
   * hand over what they have and this decides what it is.
   *
   * Holdings are tested first, because a snapshot can carry an "as on" date
   * column that the ledger reader would happily latch onto -- and reading a
   * snapshot as a ledger turns one row per fund into one payment per fund,
   * dated the same day, which produces a confident and completely wrong
   * return. A ledger cannot be mistaken for a snapshot the same way, because
   * a snapshot must be NAMED as one by its own headers.
   */
  function portfolioFile(input, options) {
    var holdings = holdingsRows(input, options);
    if (holdings.ok) return holdings;

    var ledger = ledgerRows(input, options);
    if (ledger.ok || ledger.ask) {
      /* A NAV history is a date column beside a money column, which is exactly
       * what a transaction statement is, and the ledger reader will take it
       * without complaint: 4,000 daily prices become 4,000 payments of about
       * ten rupees each, and a return comes out. It is confident and it is
       * nonsense. This is the same file the OTHER screens on this tool ask for,
       * so a reader loading it here has not made a mistake -- they have loaded
       * the right file on the wrong screen, and are told so. */
      if (ledger.ok && looksLikePrices(ledger)) {
        return { ok: false, kind: 'prices', rows: [], skipped: 0, code: 'PRICES',
                 message: MESSAGES.pricesNotPayments };
      }
      ledger.kind = 'ledger';
      return ledger;
    }

    /* Neither shape. The refusal names both files, because the reader has no
       way to know there are two and which one they downloaded. */
    return { ok: false, kind: null, rows: [], skipped: 0, code: 'UNREADABLE',
             message: MESSAGES.neitherShape,
             holdingsMessage: holdings.message, ledgerMessage: ledger.message };
  }

  /* ------------------------------------------------- dates that read two ways
   * §5: "where day-first and month-first are both valid for EVERY row, ask
   * once, showing the first row both ways." parse.js detects the ambiguity and
   * defaults to day-first with a warning; a warning is not a question, and the
   * reader is the only one who knows. */
  function firstAmbiguousDate(rows) {
    for (var i = 0; i < rows.length; i++) {
      for (var c = 0; c < rows[i].length; c++) {
        var raw = String(rows[i][c] == null ? '' : rows[i][c]).trim();
        var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(raw);
        if (!m) continue;
        var a = +m[1], b = +m[2];
        if (a > 12 || b > 12 || a === b) continue;      /* not actually ambiguous */
        var y = +m[3] < 100 ? (+m[3] < 70 ? 2000 + +m[3] : 1900 + +m[3]) : +m[3];
        return {
          raw: raw,
          dayFirst: F.date(Date.UTC(y, b - 1, a)),
          monthFirst: F.date(Date.UTC(y, a - 1, b))
        };
      }
    }
    return null;
  }

  /* ---------------------------------------------------- many schemes, grouped
   * §5: "Accept files holding many schemes and list them grouped by plan and
   * option." Grouping is what makes a 214-row list usable: the reader knows
   * their fund's family and has to choose between Direct and Regular, Growth
   * and IDCW, which is four rows rather than two hundred. */
  function groupSchemes(list) {
    var families = {}, order = [];
    list.forEach(function (s) {
      var d = S.decorate({ name: s.name });
      var key = d.familyKey || s.name.toLowerCase();
      if (!families[key]) { families[key] = { family: d.family || s.name, rows: [] }; order.push(key); }
      families[key].rows.push({
        name: s.name, plan: d.plan, option: d.option,
        analyzable: d.analyzable !== false,
        count: s.rows, first: s.first, last: s.last
      });
    });
    return order.map(function (k) {
      var f = families[k];
      /* Direct before Regular, Growth before IDCW, so the row most readers
         want is the one nearest the top of its family. */
      f.rows.sort(function (a, b) {
        var pa = a.plan === 'direct' ? 0 : 1, pb = b.plan === 'direct' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        var oa = a.option === 'growth' ? 0 : 1, ob = b.option === 'growth' ? 0 : 1;
        return oa - ob;
      });
      return f;
    });
  }

  /* ------------------------------------------------------------- stitching
   * §5: "Accept many files at once and stitch by date, removing overlaps and
   * reporting gaps." AMFI caps a download at 90 days, so a full history
   * arrives as a pile of pieces and this is the ordinary case, not an edge one.
   *
   * Where two pieces cover the same day, the LAST file to carry it wins, which
   * matches parse.js's own rule inside a single file. */
  function stitch(seriesList) {
    var byDate = {}, overlaps = 0;
    seriesList.forEach(function (series) {
      series.forEach(function (p) {
        if (byDate[p.t] !== undefined) overlaps++;
        byDate[p.t] = p.v;
      });
    });
    var series = Object.keys(byDate)
      .map(function (t) { return { t: +t, v: byDate[t] }; })
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

  /* ------------------------------------------------------------------ read
   *
   * files: [{ name, text }] or [{ name, rows }]
   * answers: { dayFirst: true|false, scheme: 'exact name' }  — what the reader
   *          has already told us, so a question is asked ONCE.
   */
  function read(files, answers) {
    var given = answers || {};
    var list = (files || []).filter(Boolean);
    if (!list.length) return refuse('NO-FILE', 'No file was chosen.');
    /* Pasted columns arrive here exactly as a file does -- {name, text} -- so
     * the day-first question, the scheme picker, the IDCW refusal, stitching,
     * the gap report and the confirmation all run on them unchanged. The only
     * difference the reader should notice is the instruction when it fails:
     * there is no file to download again. */
    var pasted = list.every(function (f) { return f.pasted === true; });
    var noDates = pasted ? MESSAGES.noDatesPasted : MESSAGES.noDates;

    var parsedFiles = [], schemeQuestion = null, ambiguous = null;

    for (var i = 0; i < list.length; i++) {
      var rows = rowsFrom(list[i]);
      if (!rows || rows.length < 2) {
        return refuse('NO-DATES', noDates);
      }

      /* one file, many schemes */
      var many = P.listSchemes(rows);
      if (many && many.schemes.length > 1 && !given.scheme) {
        schemeQuestion = schemeQuestion || { file: list[i].name, count: many.schemes.length,
                                             groups: groupSchemes(many.schemes) };
        continue;
      }

      var opts = {};
      if (given.scheme) opts.scheme = given.scheme;
      if (given.dayFirst !== undefined) opts.dayFirst = given.dayFirst;
      if (given.dateCol != null) opts.dateCol = given.dateCol;
      if (given.valueCol != null) opts.valueCol = given.valueCol;
      var res = P.rowsToSeries(rows, opts);

      if (!res.ok) {
        if (res.code === 'MANY_SCHEMES' && many) {
          schemeQuestion = schemeQuestion || { file: list[i].name, count: many.schemes.length,
                                               groups: groupSchemes(many.schemes) };
          continue;
        }
        /* A file whose columns cannot be found is a QUESTION, not a dead end.
         * The reader can see their own file; the tool cannot. Showing them the
         * columns and asking which two matter turns a refusal into one tap --
         * and it is the only way a layout nobody anticipated ever works. */
        if (res.code === 'NO_COLUMNS' && res.columns && res.columns.length >= 2) {
          var guess = {
            dateCol: firstMatching(res.columns, 'looksLikeDate'),
            valueCol: firstMatching(res.columns, 'looksLikeNumber')
          };
          /* Only ask when there is plausibly something to point AT. A file with
           * no column that reads as a date and none that reads as a number is
           * not a mapping problem -- it is the wrong file, and section 5's
           * message is the useful answer there. Asking "point at the dates" of
           * a file that has none wastes the reader's time twice. */
          if (guess.dateCol >= 0 || guess.valueCol >= 0) {
            return ask('columns', MESSAGES.whichColumns, {
              file: list[i].name, columns: res.columns, guess: guess
            });
          }
        }
        return refuse(res.code === 'NO_COLUMNS' ? 'NO-DATES' : res.code,
                      res.code === 'NO_COLUMNS' ? noDates : res.message);
      }

      /* dates that read two ways, asked once across the whole pile */
      if (!res.report.dateCertain && given.dayFirst === undefined) {
        ambiguous = ambiguous || firstAmbiguousDate(rows);
      }
      parsedFiles.push({ name: nameOf(list[i], res), series: res.series, report: res.report });
    }

    if (schemeQuestion) {
      return ask('scheme', MESSAGES.manySchemes(schemeQuestion.count), schemeQuestion);
    }
    if (ambiguous) {
      return ask('day-first', MESSAGES.ambiguousDates(ambiguous), { example: ambiguous });
    }
    if (!parsedFiles.length) return refuse('NO-DATES', noDates);

    /* the reader picked an IDCW row */
    var chosen = given.scheme || parsedFiles[0].report.scheme || parsedFiles[0].name;
    var parsedName = S.parseName(chosen);
    if (parsedName && parsedName.option === 'idcw') {
      return refuse('IDCW', MESSAGES.idcw, { scheme: chosen });
    }

    var joined = stitch(parsedFiles.map(function (f) { return f.series; }));
    if (joined.series.length < 2) {
      return refuse('TOO-FEW', 'Only ' + joined.series.length + ' usable price could be read.');
    }

    var name = chosen;
    return {
      ok: true, ask: null,
      series: joined.series,
      name: name,
      files: parsedFiles.length,
      overlaps: joined.overlaps,
      gaps: joined.gaps,
      /* §5's own confirmation, and the reason it exists: a reader has to be
         able to see they loaded what they meant to before a figure is worked
         out on it. */
      confirmation: MESSAGES.found(joined.series.length, name, joined.series, joined.gaps),
      gapMessage: joined.gaps.length ? MESSAGES.gap(joined.gaps[0]) : null
    };
  }

  function firstMatching(columns, flag) {
    for (var i = 0; i < columns.length; i++) if (columns[i][flag]) return columns[i].index;
    return -1;
  }

  function nameOf(file, res) {
    if (res.report && res.report.scheme) return res.report.scheme;
    if (file.pasted) return MESSAGES.pastedName;
    return String(file.name || '').replace(/\.[^.]+$/, '');
  }

  /* -------------------------------------------------------- the messages
   * Section 5, transcribed. Each one says what happened and what to do. */
  var MESSAGES = {
    noDates: 'I could not find a column of dates in this file. One column should be dates and one ' +
             'NAV. A screenshot or PDF will not work; download the table.',

    /* The same failure, pasted rather than uploaded: the instruction changes,
       because there is no file to download again. */
    noDatesPasted: 'I could not find a column of dates in what you pasted. Copy two columns out of ' +
                   'the sheet: the date, and the NAV on that date.',

    ledgerNoRows: 'There was nothing to read in that. Copy the rows themselves, not a picture of ' +
                  'them.',
    ledgerNoDates: 'I could not find a column of dates in what you pasted. Copy two columns: the ' +
                   'date, and the amount.',
    ledgerNoAmount: 'I found the dates but no column of amounts beside them. Copy the amount column ' +
                    'too, with a minus or brackets on the money you took out.',

    /* ---- a holdings snapshot ------------------------------------------- */
    holdNoRows: 'There was nothing to read in that file.',
    holdNoHeader: 'This file has no row of column names at the top, and a holdings file needs one: ' +
                  'the words are the only thing that says which figure is what you paid and which ' +
                  'is what it is worth now.',
    holdNoNames: 'I could not find a column of fund names in this file.',
    /* Never shown on its own: portfolioFile falls through to the ledger reader,
       which is what this file actually is. */
    holdIsDated: 'The rows in this file carry different dates, so it is a record of payments rather ' +
                 'than a picture of what is held today.',

    holdNoMoney: 'I found the fund names but no column of amounts beside them \u2014 neither what ' +
                 'you put in nor what it is worth now.',

    /* Said when a file is neither shape. It names both downloads, because a
       reader has no reason to know there are two of them. */
    /* The right file, on the wrong screen. Said as such: this reader has not
       made a mistake, they are one tap away from the answer they wanted. */
    pricesNotPayments: 'This looks like a fund\u2019s price history \u2014 one row for each day the ' +
                       'market was open \u2014 rather than a record of your own payments. Read as ' +
                       'payments it would produce a confident and completely wrong figure, so it is ' +
                       'refused here. This screen wants your holdings or your transaction statement. ' +
                       'To measure the fund itself, use Rolling returns, which is the screen this ' +
                       'file belongs to.',

    neitherShape: 'I could not read this as either kind of file. Two downloads work here: your ' +
                  'holdings or portfolio statement, which lists each fund with what you put in and ' +
                  'what it is worth; or your transaction statement, which lists each payment with ' +
                  'its date. A screenshot or a PDF will not work \u2014 look for CSV or Excel.',

    /* Not a refusal. The file was read; it simply cannot answer one of the two
       questions, and the reader is told where the file that can is kept. */
    noDatesForRate: 'This is a holdings file, so it says what you own today but not when you bought ' +
                    'it. A yearly rate needs the dates. For that, download your transaction ' +
                    'statement instead \u2014 the same place, usually under Reports or Statements.',

    /* Not a refusal and not a guess: the file has a column saying what each
       line was, and only the reader knows which of those words took money out.
       Asked once, applied to every line. */
    whichDirection: function (n) {
      return 'Every amount here is unsigned, and one column says what each line was. ' +
             'Tick the ' + (n === 1 ? 'word' : 'words') + ' that mean money going OUT.';
    },

    /* A name, not a sentence. nameOf() strips a file extension; pasted columns
       have no file, and the confirmation must still say what it read. */
    pastedName: 'pasted columns',

    /* The same failure, but with something to do about it. Section 5's message
     * is right when there is nothing in the file to point at; when there ARE
     * columns, the reader can point at them faster than any parser can guess. */
    whichColumns: 'I could not tell which columns to read. Here is the top of your file — ' +
                  'point at the dates and at the NAV.',

    ambiguousDates: function (ex) {
      return 'These dates read two ways. The first row is ' + ex.dayFirst + ' one way, ' +
             ex.monthFirst + ' the other. Which is right?';
    },

    manySchemes: function (n) {
      return 'This file has ' + F.count(n) + ' schemes. Pick the one you own.';
    },

    idcw: 'This is the IDCW row. Its NAV falls at every payout, so every return on it reads low. ' +
          'Pick the Growth row of the same plan.',

    tooYoung: function (haveYears, windowYears) {
      return 'This history is ' + haveYears.toFixed(1) + ' years long and you asked for ' +
             windowYears + '-year windows. There is not one full window to measure. ' +
             'Choose a shorter window.';
    },

    ageGuard: function (haveYears, windowYears) {
      return 'This history is ' + haveYears.toFixed(1) + ' years long and you asked for ' +
             windowYears + '-year windows, so every window starts inside the same ' +
             (haveYears - windowYears).toFixed(1) + '-year band. They are one stretch measured over ' +
             'and over, not different stretches. Three spare years is the least it takes. ' +
             'Choose a shorter window or a longer history.';
    },

    gap: function (g) {
      return 'There is a gap of ' + F.count(g.days) + ' days, ' + F.span(g.from, g.to) +
             '. Windows crossing it use the last NAV before it. If you downloaded in pieces, ' +
             'one may be missing.';
    },

    valueMissing: 'Add what it is all worth today, and the date you read it.',

    underAYear: function (months) {
      return 'This money is ' + months + ' months old. A yearly rate on ' + months +
             ' months is a stretch. Read the total gain; the yearly rate starts meaning something ' +
             'after a year.';
    },

    noOverlap: function (years) {
      return 'These two histories share only ' + years.toFixed(1) +
             ' years, which is too short for the window you set.';
    },

    directBefore2013: 'Direct plans began in 2013. For the years before, this fund’s Regular ' +
                      'plan carries the same history, about 0.5 to 1 point a year lower.',

    found: function (n, name, series, gaps) {
      return 'Found ' + F.count(n) + ' NAVs for ' + name + ', ' +
             F.span(series[0].t, series[series.length - 1].t) + ', ' +
             (gaps.length
               ? (gaps.length === 1 ? 'one gap' : F.count(gaps.length) + ' gaps') + '.'
               : 'no gaps.');
    }
  };

  var api = {
    read: read, firstMatching: firstMatching,
    ledgerRows: ledgerRows, ledgerAmount: ledgerAmount, typeColumn: typeColumn,
    holdingsRows: holdingsRows, portfolioFile: portfolioFile, guessDirection: guessDirection, stitch: stitch, gapsIn: gapsIn, groupSchemes: groupSchemes,
    rowsFrom: rowsFrom, jsonRows: jsonRows, firstAmbiguousDate: firstAmbiguousDate,
    MESSAGES: MESSAGES, GAP_DAYS: GAP_DAYS
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimUpload = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
