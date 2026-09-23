/* The Portfolio Reality Check — file reading.
 *
 * Turns a NAV or index file into a clean, sorted, dated series, and reports
 * exactly what it threw away and why. Nothing here guesses silently: if the
 * file is ambiguous the caller is told, so the screen can say so.
 */
(function (root) {
  'use strict';

  var MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };

  var SCHEME_HEADERS = ['scheme name', 'schemename', 'scheme', 'fund name', 'fundname',
                        'fund', 'plan name', 'security name', 'index name'];

  var DATE_HEADERS = ['date', 'nav date', 'navdate', 'as on', 'as on date', 'day', 'period'];
  var VALUE_HEADERS = ['nav', 'net asset value', 'net asset value (rs.)', 'nav (rs.)', 'nav rs',
                       'close', 'closing', 'closing value', 'close price', 'index value',
                       'total returns index', 'tri', 'adj close', 'adjusted close', 'value', 'price'];

  /* ------------------------------------------------------------ delimiters */

  /* AMFI's own NAV history download is semicolon separated, so semicolons are
   * checked before commas rather than after. */
  function detectDelimiter(text) {
    var sample = text.split(/\r?\n/).slice(0, 25).join('\n');
    var best = ',', bestScore = -1;
    [';', ',', '\t', '|'].forEach(function (d) {
      var counts = sample.split(/\r?\n/).map(function (line) {
        return line.split(d).length - 1;
      }).filter(function (c) { return c > 0; });
      if (counts.length < 2) return;
      /* a real delimiter appears a consistent number of times per line */
      var mode = counts.sort(function (a, b) { return a - b; })[Math.floor(counts.length / 2)];
      var consistent = counts.filter(function (c) { return c === mode; }).length;
      var score = mode * consistent;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function splitLine(line, delim) {
    var out = [], cur = '', inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function parseDelimited(text) {
    var clean = String(text || '').replace(/^﻿/, '');
    var delim = detectDelimiter(clean);
    return clean.split(/\r?\n/)
      .filter(function (l) { return l.trim() !== ''; })
      .map(function (l) { return splitLine(l, delim); });
  }

  /* ----------------------------------------------------------------- dates */

  function parseNumber(raw) {
    if (raw == null) return NaN;
    var s = String(raw).replace(/[₹$,\s]/g, '').replace(/^"|"$/g, '');
    if (s === '' || s === '-' || /^n\.?a\.?$/i.test(s) || /^nan$/i.test(s)) return NaN;
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  /* Returns {y,m,d} or null. `dayFirst` decides the reading of an ambiguous
   * numeric date such as 05/08/2026. */
  function parseDateParts(raw, dayFirst) {
    if (raw == null) return null;
    var s = String(raw).trim().replace(/^"|"$/g, '');
    if (!s) return null;
    var m;

    /* 2026-08-05 or 2026/08/05 */
    m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };

    /* 05-Aug-2026, 5 Aug 2026, 05-Aug-26 */
    m = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,9})[-\/\s](\d{2,4})/);
    if (m) {
      var mon = MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)];
      if (!mon) return null;
      return { y: fullYear(+m[3]), m: mon, d: +m[1] };
    }

    /* Aug 05, 2026 */
    m = s.match(/^([A-Za-z]{3,9})[-\/\s](\d{1,2}),?[-\/\s](\d{2,4})/);
    if (m) {
      var mo = MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)];
      if (!mo) return null;
      return { y: fullYear(+m[3]), m: mo, d: +m[2] };
    }

    /* 05-08-2026 or 05/08/2026 -- the ambiguous one */
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
    if (m) {
      var a = +m[1], b = +m[2], y = fullYear(+m[3]);
      return dayFirst ? { y: y, m: b, d: a } : { y: y, m: a, d: b };
    }
    return null;
  }

  function fullYear(y) { return y >= 100 ? y : (y < 70 ? 2000 + y : 1900 + y); }

  /* An Excel serial -- 43831 is 1 January 2020 -- arrives when a sheet's date
     cells were never given a date format, or a CSV was written from one. Read
     only where the column's own heading says it holds dates: a column of
     five-digit index values would otherwise become a column of dates. */
  var SERIAL_MIN = 20000, SERIAL_MAX = 80000;   /* 1954 to 2119 */
  function serialOf(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!/^\d{5}(\.0+)?$/.test(s)) return null;
    var n = parseInt(s, 10);
    return n >= SERIAL_MIN && n <= SERIAL_MAX ? n : null;
  }
  function serialToParts(raw) {
    var n = serialOf(raw);
    if (n === null) return null;
    var d = new Date((n - 25569) * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  function readDate(raw, dayFirst, serial) {
    return toTimestamp(serial ? serialToParts(raw) : parseDateParts(raw, dayFirst));
  }

  function toTimestamp(p) {
    if (!p) return NaN;
    if (p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31) return NaN;
    if (p.y < 1900 || p.y > 2100) return NaN;
    var t = Date.UTC(p.y, p.m - 1, p.d);
    var back = new Date(t);
    /* rejects 31 February and friends instead of rolling them forward */
    if (back.getUTCFullYear() !== p.y || back.getUTCMonth() !== p.m - 1 || back.getUTCDate() !== p.d) return NaN;
    return t;
  }

  /* Decide dd/mm versus mm/dd by looking at the whole column, not one row. */
  function detectDayFirst(rows, dateCol) {
    var firstOver12 = false, secondOver12 = false, ambiguousFormat = false;
    for (var i = 0; i < rows.length; i++) {
      var s = String(rows[i][dateCol] || '').trim();
      var m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
      if (!m) continue;
      ambiguousFormat = true;
      if (+m[1] > 12) firstOver12 = true;
      if (+m[2] > 12) secondOver12 = true;
    }
    /* 2026-08-05 and 05-Aug-2026 can only be read one way. Warning a reader
       about an ambiguity their file does not have teaches them to ignore
       warnings, which is worse than saying nothing. */
    if (!ambiguousFormat) return { dayFirst: true, certain: true };
    if (firstOver12 && !secondOver12) return { dayFirst: true, certain: true };
    if (secondOver12 && !firstOver12) return { dayFirst: false, certain: true };
    if (firstOver12 && secondOver12) return { dayFirst: true, certain: false, conflict: true };
    return { dayFirst: true, certain: false };  /* day-first default, flagged to the user */
  }

  /* --------------------------------------------------------------- columns */

  /* Headings that name a NUMBER which is not a price.
   *
   * Every one of these was found in a real file. NSE's own index export ships
   * thirteen columns, nine of them numeric, and only one of the nine is the
   * index value; a reader that takes "the first numeric column" out of it
   * produces a rolling return on traded volume. */
  var NOT_VALUE = [
    /\bvolumes?\b|\bvol\.?$|\bqty\b|\bquantit(y|ies)\b|\bshares\b|\bcontracts\b/,
    /\bturnover\b/,
    /\bchange\b|\bchg\b|\bpoints?\b|\bpct\b|%|\byield\b|\bratio\b/,
    /\bp\s*\/\s*e\b|\bp\s*\/\s*b\b|\bpe\b|\bpb\b|\bdiv(idend)?\b/,
    /\bcode\b|\bisin\b|\bfolio\b|\baccount\b/,
    /\b(id|no|num|number|sr|srno|s\.no)\b/,
    /\bunits?\b|\bbalance\b/
  ];

  /* Which numeric column is the price, when a file offers several.
   *
   * Earlier is better. The list is ordered by how specifically the heading
   * commits to being a closing price: "Closing Index Value" beats "Open Index
   * Value" beats a bare "Value", and a total-return index beats all of them
   * because it is the one this tool actually asks for. */
  var VALUE_RANK = [
    /\bnet asset value\b|\bnav\b/,
    /\btotal returns? index\b|\btri\b/,
    /\bclos(e|ing)\b[^,]*\bindex\b|\bindex\b[^,]*\bclos(e|ing)\b/,
    /\badj(usted)?\.?\s*clos(e|ing)\b/,
    /\bclos(e|ing)\b/,
    /\bindex\s*value\b/,
    /\bprice\b/,
    /\bvalue\b/,
    /\bopen\b|\bhigh\b|\blow\b/
  ];

  function headingRank(list, h) {
    for (var i = 0; i < list.length; i++) if (list[i].test(h)) return i;
    return null;
  }

  /* What is actually IN each column, which is the only thing that settles what
   * a column is. A heading says what a column is for. */
  function columnProfile(rows) {
    var probe = rows.slice(0, 60);
    var width = 0;
    probe.forEach(function (r) { if (r && r.length > width) width = r.length; });
    /* Two filled cells before a column is worth an opinion -- unless there
       are not two rows. A bulk file filtered down to one scheme's single day
       is still a readable table; it is just a table with nothing to measure,
       which is a different refusal and a much more useful one than "no
       columns found". */
    var need = Math.min(2, probe.length);
    var out = [];
    for (var c = 0; c < width; c++) {
      var filled = 0, dates = 0, numbers = 0, positive = 0, serials = 0;
      for (var r = 0; r < probe.length; r++) {
        var cell = probe[r] ? probe[r][c] : null;
        if (cell == null || String(cell).trim() === '') continue;
        filled++;
        if (!isNaN(toTimestamp(parseDateParts(cell, true)))) { dates++; continue; }
        if (serialOf(cell) !== null) serials++;
        var n = parseNumber(cell);
        if (isFinite(n)) { numbers++; if (n > 0) positive++; }
      }
      out.push({
        index: c, filled: filled, dates: dates, numbers: numbers, positive: positive,
        isSerials: filled >= need && serials >= filled * 0.6,
        isDates: filled >= need && dates >= filled * 0.6,
        /* Prices are positive. A column of positive numbers is a candidate; a
           column that is 40% negative is a change or a points move. */
        isPrices: filled >= need && numbers >= filled * 0.6 && positive >= filled * 0.6
      });
    }
    return out;
  }

  /* Two columns out of however many the file has.
   *
   * The rule, and it is the whole fix: CONTENT DECIDES WHETHER, HEADINGS
   * DECIDE WHICH. A column is eligible only if its own cells parse as dates,
   * or as positive numbers; among the eligible ones the heading picks the
   * best. It used to be the other way round -- the first heading matching
   * /index/ won outright -- and on NSE's own export that is "Index Name", a
   * column of the words "Nifty 50 TRI", which the file was then refused for
   * not containing numbers. The most obvious legitimate file for this screen
   * could not be uploaded. */
  function pickColumns(rows, headerRow) {
    var prof = columnProfile(rows);
    var lower = headerRow
      ? headerRow.map(function (h) { return String(h == null ? '' : h).toLowerCase().trim(); })
      : null;

    function heading(c) { return lower && lower[c] != null ? lower[c] : ''; }

    /* ---- the date column */
    var dateCol = -1, bestDate = 1e9;
    prof.forEach(function (col) {
      if (!col.isDates) return;
      var h = heading(col.index);
      var score = DATE_HEADERS.indexOf(h) !== -1 ? 0
                : /\bdate\b|\bas on\b|\bperiod\b|\bday\b/.test(h) ? 1
                : /date/.test(h) ? 2
                : 50 + col.index;      /* no opinion: leftmost date column */
      if (score < bestDate) { bestDate = score; dateCol = col.index; }
    });
    /* No column of dates, but a column of Excel serials under a heading that
       says "date": read the serials. Only under such a heading. */
    var serialDates = false;
    if (dateCol === -1 && lower) {
      prof.forEach(function (col) {
        if (!col.isSerials || dateCol !== -1) return;
        var h = heading(col.index);
        if (DATE_HEADERS.indexOf(h) !== -1 || /date|as on|as at/.test(h)) {
          dateCol = col.index; serialDates = true;
        }
      });
    }

    /* ---- the value column */
    var valueCol = -1, bestValue = 1e9;
    prof.forEach(function (col) {
      if (col.index === dateCol || !col.isPrices) return;
      var h = heading(col.index);
      var score;
      if (lower && VALUE_HEADERS.indexOf(h) !== -1) score = -1;         /* named exactly */
      else {
        var rank = lower ? headingRank(VALUE_RANK, h) : null;
        if (rank !== null) score = rank;
        else if (lower && h && headingRank(NOT_VALUE, h) !== null) score = 900 + col.index;
        else score = 100 + col.index;
      }
      /* A heading that names something else loses even to an unnamed column,
         but is still better than having no value column at all. */
      if (score < bestValue) { bestValue = score; valueCol = col.index; }
    });

    return { dateCol: dateCol, valueCol: valueCol, serialDates: serialDates };
  }

  /* Where the headings actually are.
   *
   * Downloaded files do not start with their header row. NSE puts a title and
   * a period above it, fund houses put a logo row, and an .xlsx exported from
   * a report puts both. Only row 1 was ever examined, so those files fell
   * through to shape detection and were read by luck or refused.
   *
   * A candidate is accepted only if TAKING it as the header produces a date
   * column and a value column that verify against the rows below it. That
   * makes the detection self-checking: a data row that happens to contain the
   * word "value" cannot pass, because the rows under it will not line up. */
  var HEADER_SEARCH_ROWS = 20;

  /* How many cells a row of this table actually holds, taken as the commonest
     count among the data rows rather than the widest -- one stray trailing
     comma should not decide it. */
  function filledCount(row) {
    var n = 0;
    for (var c = 0; c < (row ? row.length : 0); c++) {
      if (row[c] != null && String(row[c]).trim() !== '') n++;
    }
    return n;
  }

  function modalWidth(rows) {
    var counts = {}, best = 0, seen = 0;
    for (var i = 0; i < Math.min(rows.length, 40); i++) {
      var n = filledCount(rows[i]);
      if (!n) continue;
      counts[n] = (counts[n] || 0) + 1;
      if (counts[n] > seen) { seen = counts[n]; best = n; }
    }
    return best;
  }

  function findHeader(rows) {
    var limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
    var fallback = null;
    for (var i = 0; i < limit; i++) {
      if (!looksLikeHeader(rows[i])) continue;
      var body = rows.slice(i + 1);
      if (!body.length) continue;

      /* A TITLE IS NOT A HEADER, and telling them apart is a counting job.
       *
       * "Scheme NAV history report" in cell A2 of a fund house's workbook
       * reads as a header by every word test -- it contains "nav" and it is
       * text -- and the columns beneath it check out too, because the real
       * header one row further down is just one more text row among four
       * thousand. Taken as the header it has ONE cell, so its single title
       * became the name of column A, the date column was read as a column of
       * scheme names, and the tool announced the file held 4,751 schemes.
       *
       * A header names the columns, so it has about as many cells as they do. */
      var width = modalWidth(body);
      if (width >= 2 && filledCount(rows[i]) < Math.max(2, width - 1)) continue;
      /* Kept even though its columns may not check out. A row that reads as a
         header IS the header; whether the rows under it hold what it claims is
         a separate question, and it is the question worth answering. Throwing
         the header away here left the refusal unable to say "the column you
         called NAV holds text" -- it could only say it found no columns. */
      if (fallback === null) fallback = { index: i, header: rows[i], body: body };
      if (body.length < 2) continue;
      var cols = pickColumns(body, rows[i]);
      if (cols.dateCol !== -1 && cols.valueCol !== -1 && cols.dateCol !== cols.valueCol) {
        return { index: i, header: rows[i], body: body };
      }
    }
    /* No header-shaped row at all. Everything is data and shape decides, which
       is how AMFI's headerless bulk files have always been read. */
    return fallback || { index: -1, header: null, body: rows };
  }

  function looksLikeHeader(row) {
    if (!row) return false;
    var text = row.join(' ').toLowerCase();
    var named = DATE_HEADERS.concat(VALUE_HEADERS).some(function (h) { return text.indexOf(h) !== -1; });
    var mostlyText = row.filter(function (c) { return c !== '' && isNaN(parseNumber(c)); }).length >= Math.ceil(row.length / 2);
    return named && mostlyText;
  }

  /* What each column looks like, so a reader can be shown the file rather than
   * told about it. One row per column: its heading if there is one, a few of
   * its own cells, and how many of them read as a date or as a number. That
   * last pair is what turns a wall of columns into an obvious choice. */
  function columnSummary(rows, header) {
    var probe = rows.slice(0, 40);
    var width = Math.max.apply(null, probe.map(function (r) { return r.length; }).concat([0]));
    var out = [];
    for (var c = 0; c < width; c++) {
      var dates = 0, nums = 0, samples = [], filled = 0;
      for (var r = 0; r < probe.length; r++) {
        var cell = probe[r][c];
        if (cell == null || cell === '') continue;
        filled++;
        if (samples.length < 3) samples.push(String(cell).slice(0, 24));
        if (!isNaN(toTimestamp(parseDateParts(cell, true)))) dates++;
        else if (isFinite(parseNumber(cell))) nums++;
      }
      out.push({
        index: c,
        heading: header && header[c] != null ? String(header[c]).slice(0, 40) : '',
        samples: samples,
        filled: filled,
        looksLikeDate: filled > 0 && dates >= filled * 0.6,
        looksLikeNumber: filled > 0 && nums >= filled * 0.6
      });
    }
    return out;
  }

  /* --------------------------------------------------------------- schemes
   *
   * The official bulk NAV downloads carry hundreds of schemes in one file. A
   * reader should be able to hand the tool that file exactly as it arrived and
   * pick their own scheme out of it -- which is what makes fund selection
   * practical at the scale of thousands of schemes without anyone maintaining
   * a database of them.
   */
  /* ================================================ the schema gatekeeper
   *
   * A file is checked BEFORE anything is computed from it, because the failure
   * this catches is not a crash -- it is a plausible wrong answer.
   *
   * A tradebook has a date column and a numeric column, so the ordinary reader
   * takes it without complaint: order quantities become "prices", and a rolling
   * return comes out of them. It is confident and it is meaningless. The names
   * of the columns are the only thing that says which kind of file this is,
   * which is why this checks headings and the ordinary reader checks shape.
   */
  /* Headings that only a transaction record has.
   *
   * Every entry here has to earn its place by being ABSENT from the files
   * this tool exists to read, and two of them did not:
   *
   *   ISIN -- removed. AMFI's bulk NAV download, which is the single most
   *   common legitimate file this tool receives, ships "ISIN Div Payout" and
   *   "ISIN Div Reinvestment" columns. The gate refused it as a trade log. An
   *   ISIN names an instrument; it says nothing about whether the rows are
   *   prices or orders, so it discriminates nothing and cost everything.
   *
   *   "broker" -- narrowed to "brokerage". A brokerage column is a fee and
   *   only a tradebook has one. A broker column is an intermediary's name and
   *   a consolidated account statement carries one, and section 2 says a CAS
   *   is a file this door must accept.
   *
   * What is left is genuinely transaction-only: an order, a trade, a
   * quantity, an exchange, a segment. */
  /* Underscores and hyphens count as spaces here: Zerodha's tradebook ships
     order_id and trade_date, and \s* matched neither, so the two columns a
     reader would recognise instantly were the two the refusal did not name. */
  var TRADE_HEADERS = [
    /\border[\s_-]*(id|no|number|type)\b/i,
    /\b(buy|sell)[\s_-]*\/?[\s_-]*(sell|buy)?\b/i,
    /\btrade[\s_-]*(id|no|type|date)\b/i,
    /\bquantity\b|\bqty\b/i,
    /\bbrokerage\b/i,
    /\btransaction\s*(id|type)\b/i,
    /\bexchange\b/i,
    /\bsegment\b/i
  ];
  /* Words that make a column a transaction record rather than a price series.
     "Amount" alone is not here: a NAV file can carry one. */
  var TRADE_VALUES = /^(buy|sell|b|s|purchase|redemption|credit|debit|cr|dr)$/i;

  function checkSchema(rows) {
    if (!rows || !rows.length) {
      return fail('EMPTY', 'That file has no rows in it that could be read.');
    }
    var found = findHeader(rows);
    var header = found.header;
    var body = found.body;
    if (!body.length) {
      return fail('EMPTY', 'That file has no rows in it that could be read.');
    }

    /* 1. Transaction columns, by heading. */
    var hits = [];
    if (header) {
      header.forEach(function (h) {
        var name = String(h == null ? '' : h).trim();
        if (!name) return;
        TRADE_HEADERS.forEach(function (re) {
          if (re.test(name) && hits.indexOf(name) === -1) hits.push(name);
        });
      });
    }

    /* 2. Transaction columns, by content: a column of BUY/SELL in most of its
          rows is a tradebook whatever its heading says, and AMFI-style files
          with no header at all would otherwise slip straight past step 1. */
    var probe = body.slice(0, 40);
    var width = Math.max.apply(null, probe.map(function (r) { return r.length; }).concat([0]));
    for (var c = 0; c < width; c++) {
      var n = 0, seen = 0;
      for (var r = 0; r < probe.length; r++) {
        var cell = String(probe[r][c] == null ? '' : probe[r][c]).trim();
        if (!cell) continue;
        seen++;
        if (TRADE_VALUES.test(cell)) n++;
      }
      if (seen >= 2 && n >= Math.ceil(seen * 0.6)) {
        var label = header && header[c] ? String(header[c]).trim() : 'column ' + (c + 1);
        if (hits.indexOf(label) === -1) hits.push(label);
      }
    }

    if (hits.length) {
      return { ok: false, code: 'TRADEBOOK', detected: hits, message: TRADEBOOK_COPY };
    }

    /* 3. A date column and a numeric value column, or there is nothing to read. */
    var cols = pickColumns(body, header);
    if (cols.dateCol === -1 || cols.valueCol === -1) {
      /* This is NOT a tradebook and must not be called one.
       *
       * It used to be: this branch returned TRADEBOOK_COPY, so a PDF, a
       * picture, an empty sheet and a file with one column all told the
       * reader their file "contains trade logs or transaction records" -- a
       * confident, specific and completely wrong diagnosis, and one that
       * gives them nothing to fix. What is true is only that the two columns
       * could not be found, so that is what it says, and it says which of the
       * two was missing. */
      var prof = columnProfile(body);
      var anyDate = prof.some(function (c) { return c.isDates; });
      var anyPrice = prof.some(function (c) { return c.isPrices; });

      /* A column HEADED as the price, holding something that is not one.
       *
       * This is a different fault from "no price column here", and it is the
       * one the reader can actually act on: they know which column they meant,
       * and the file disagrees with them about what is in it. Naming that
       * column is the whole of the fix, so it gets its own sentence rather
       * than being folded into the general refusal. */
      if (anyDate && !anyPrice && header) {
        var named = -1;
        for (var vh = 0; vh < header.length; vh++) {
          var hh = String(header[vh] == null ? '' : header[vh]).toLowerCase().trim();
          if (!hh) continue;
          if (VALUE_HEADERS.indexOf(hh) !== -1 || headingRank(VALUE_RANK, hh) !== null) {
            if (headingRank(NOT_VALUE, hh) === null) { named = vh; break; }
          }
        }
        if (named !== -1) {
          return { ok: false, code: 'NOT_NUMERIC',
                   detected: [String(header[named]).trim()],
                   columns: columnSummary(body, header),
                   message: NOT_NUMERIC_COPY };
        }
      }
      return { ok: false, code: 'NO_SCHEMA',
               detected: header ? header.filter(Boolean).map(String) : [],
               missing: !anyDate && !anyPrice ? 'both' : !anyDate ? 'date' : 'value',
               columns: columnSummary(body, header),
               message: noSchemaCopy(anyDate, anyPrice) };
    }

    /* 4. And the value column has to hold NUMBERS.
     *
     * pickColumns finds it by heading first, so a column called "NAV" is taken
     * as the values whatever is actually in it -- and a file of text under that
     * heading went all the way through to a reading. The heading says what the
     * column is FOR; only the cells say what is in it. */
    var numbers = 0, filled = 0;
    for (var v = 0; v < probe.length; v++) {
      var raw = String(probe[v][cols.valueCol] == null ? '' : probe[v][cols.valueCol]).trim();
      if (!raw) continue;
      filled++;
      if (parseNumber(raw) > 0) numbers++;
    }
    if (!filled || numbers < Math.ceil(filled * 0.6)) {
      return { ok: false, code: 'NOT_NUMERIC',
               detected: header && header[cols.valueCol]
                 ? [String(header[cols.valueCol]).trim()] : ['column ' + (cols.valueCol + 1)],
               message: NOT_NUMERIC_COPY };
    }

    /* 5. Signed amounts are payments, not prices. A NAV never goes below
          zero; a statement of money in and money out does, on every
          withdrawal. Tested on the column that would have been read as the
          value, so an index export's "change" column cannot trip it. */
    var negatives = 0, seenAmt = 0;
    for (var g = 0; g < body.length && g < 400; g++) {
      var cell5 = String(body[g][cols.valueCol] == null ? '' : body[g][cols.valueCol]).trim();
      if (!cell5) continue;
      var num5 = parseNumber(cell5);
      if (!isFinite(num5)) continue;
      seenAmt++;
      if (num5 < 0 || /^\(.*\)$/.test(cell5)) negatives++;
    }
    if (seenAmt >= 3 && negatives >= Math.max(2, Math.ceil(seenAmt * 0.15))) {
      return { ok: false, code: 'TRADEBOOK',
               detected: [header && header[cols.valueCol]
                 ? String(header[cols.valueCol]).trim() + ' (signed amounts)'
                 : 'signed amounts in column ' + (cols.valueCol + 1)],
               message: TRADEBOOK_COPY };
    }

    /* 6. Several amounts on one date, with no scheme column to explain
          them, is a statement too: a price file has one value per date. */
    if (pickSchemeColumn(header, body) === -1 && body.length >= 6) {
      var seenDates = {}, dup = 0, dated = 0;
      for (var q = 0; q < body.length && q < 400; q++) {
        var dcell = String(body[q][cols.dateCol] == null ? '' : body[q][cols.dateCol]).trim();
        if (!dcell) continue;
        dated++;
        if (seenDates[dcell]) dup++; else seenDates[dcell] = true;
      }
      if (dated >= 6 && dup >= Math.ceil(dated * 0.5)) {
        return { ok: false, code: 'TRADEBOOK',
                 detected: ['several amounts on one date'],
                 message: TRADEBOOK_COPY };
      }
    }

    return { ok: true, header: header, dateCol: cols.dateCol, valueCol: cols.valueCol };
  }

  /* Three different faults, three different sentences.
   *
   * The specification writes one red banner, for a tradebook. Everything that
   * is not a tradebook was getting that banner too, which is how a PDF came to
   * be described as a trade log. A refusal that names the wrong fault is worse
   * than a vague one: it sends the reader off to fix something that was never
   * wrong with their file. */
  function noSchemaCopy(anyDate, anyPrice) {
    var need = 'This screen needs two columns: a date, and the NAV or index value on that date.';
    if (!anyDate && !anyPrice) {
      return 'No table could be read out of that file. ' + need +
             ' Nothing in it read as a column of dates or a column of values — which usually ' +
             'means it is not a spreadsheet at all, or the data sits inside a picture. ' +
             'Save it as CSV or Excel and load that.';
    }
    if (!anyDate) {
      return 'That file has values but no column of dates. ' + need +
             ' Check that the dates are real dates rather than text, and that the file has not ' +
             'been trimmed to a single day.';
    }
    return 'That file has dates but no column of prices. ' + need +
           ' A column of units, order quantities or percentage changes is not a price. ' +
           'Load a file that carries the NAV or the index value itself.';
  }

  var NOT_TABULAR_COPY =
    'That file is not a spreadsheet. This screen reads a table of dates and values, and a PDF ' +
    'stores its numbers as page layout rather than as columns, so there is nothing here that can ' +
    'read one reliably — and a number read wrongly out of a PDF would be silently wrong. ' +
    'Open the statement in Excel or your fund house’s portal and download the same history as ' +
    'CSV or Excel, or copy the two columns and paste them in.';

  /* A statement of the reader's own payments -- a tradebook, a CAS, a
     transaction log -- is the right file on the wrong screen, and is told
     so in those words. */
  var TRADEBOOK_COPY =
    'This looks like a statement of your own payments. Rolling returns need the fund\u2019s ' +
    'price history \u2014 a date and the NAV or index value on that date. Check my portfolio ' +
    'is the screen for this file.';

  /* Section 3's red banner is written for a tradebook. A column of text under a
     NAV heading is a different fault and gets its own sentence, because "this
     is a trade log" would be a wrong description of it. */
  var NOT_NUMERIC_COPY =
    'The column this file uses for values does not hold numbers. Expected Schema: Date and ' +
    'NAV / Value, where every value is a price. Please re-upload a valid daily NAV or Index ' +
    'CSV file.';

  function fail(code, message) { return { ok: false, code: code, message: message, detected: [] }; }

  function pickSchemeColumn(header, rows) {
    if (!header) return -1;
    var lower = header.map(function (h) { return String(h).toLowerCase().trim(); });
    for (var i = 0; i < lower.length; i++) {
      if (SCHEME_HEADERS.indexOf(lower[i]) !== -1) return i;
    }
    for (var j = 0; j < lower.length; j++) {
      if (/scheme|fund name/.test(lower[j])) return j;
    }
    return -1;
  }

  /* Every distinct scheme in the file, with enough detail to tell near-identical
   * names apart before choosing one. */
  function listSchemes(rows) {
    var header = looksLikeHeader(rows[0]) ? rows[0] : null;
    var body = header ? rows.slice(1) : rows;
    var schemeCol = pickSchemeColumn(header, body);
    if (schemeCol === -1) return null;

    var cols = pickColumns(body, header);
    if (cols.dateCol === -1 || cols.valueCol === -1) return null;
    var dayFirst = detectDayFirst(body, cols.dateCol).dayFirst;

    var found = {}, order = [];
    for (var i = 0; i < body.length; i++) {
      var name = String(body[i][schemeCol] == null ? '' : body[i][schemeCol]).trim();
      if (!name) continue;
      var t = readDate(body[i][cols.dateCol], dayFirst, cols.serialDates);
      var v = parseNumber(body[i][cols.valueCol]);
      if (isNaN(t) || !isFinite(v) || v <= 0) continue;
      if (!found[name]) { found[name] = { name: name, rows: 0, first: t, last: t }; order.push(name); }
      var f = found[name];
      f.rows++;
      if (t < f.first) f.first = t;
      if (t > f.last) f.last = t;
    }
    var list = order.map(function (n) { return found[n]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list.length ? { column: schemeCol, schemes: list } : null;
  }

  /* ------------------------------------------------------------------ main */

  function rowsToSeries(rows, options) {
    var opts = options || {};
    if (!rows || rows.length < 2) {
      return { ok: false, code: 'EMPTY', message: 'That file has no rows in it that could be read.' };
    }
    /* The header can be on any of the first twenty rows, not only the first.
       See findHeader: a downloaded file usually puts a title above it. */
    var found = findHeader(rows);
    var header = found.header;
    var body = found.body;

    /* one file, many schemes: keep only the one asked for */
    var schemeCol = pickSchemeColumn(header, body);
    var schemeName = null;
    if (schemeCol !== -1) {
      var wanted = opts.scheme;
      var distinct = {};
      for (var q = 0; q < body.length; q++) {
        var nm = String(body[q][schemeCol] == null ? '' : body[q][schemeCol]).trim();
        if (nm) distinct[nm] = true;
      }
      var names = Object.keys(distinct);
      if (wanted) {
        body = body.filter(function (r) {
          return String(r[schemeCol] == null ? '' : r[schemeCol]).trim() === wanted;
        });
        schemeName = wanted;
        if (!body.length) {
          return { ok: false, code: 'NO_SUCH_SCHEME',
                   message: 'No rows in that file belong to \u201c' + wanted + '\u201d.' };
        }
      } else if (names.length > 1) {
        return { ok: false, code: 'MANY_SCHEMES', schemes: names.length,
                 message: 'That file holds ' + names.length + ' different schemes. Choose which one to analyse.' };
      } else if (names.length === 1) {
        schemeName = names[0];      /* one scheme: name the analysis after it */
      }
    }

    /* Review v4 §5, and the reader's own override. Detection reads content
     * rather than headers, which handles most files -- but "most" is not all,
     * and a file it cannot read should ask rather than refuse. When the reader
     * has told us which columns to use, that answer wins outright. */
    var cols = pickColumns(body, header);
    if (opts.dateCol != null && opts.dateCol >= 0) cols.dateCol = opts.dateCol;
    if (opts.valueCol != null && opts.valueCol >= 0) cols.valueCol = opts.valueCol;
    if (cols.dateCol === -1 || cols.valueCol === -1 || cols.dateCol === cols.valueCol) {
      return {
        ok: false, code: 'NO_COLUMNS',
        header: header,
        columns: columnSummary(body, header),
        message: 'Could not find a date column and a value column in that file. It needs two columns: the date, and the NAV or index value on that date.'
      };
    }

    /* Review v4 §5: where day-first and month-first are both valid the reader
     * is asked once, and their answer arrives here. Detection still runs when
     * nothing has been asked, so a file whose dates can only be read one way
     * never raises a question at all. */
    var dayFirstInfo = detectDayFirst(body, cols.dateCol);
    if (opts.dayFirst !== undefined) {
      dayFirstInfo = { dayFirst: !!opts.dayFirst, certain: true, answered: true };
    }
    var seen = {}, series = [], skipped = { badDate: 0, badValue: 0, duplicate: 0, blank: 0 };
    var examples = [];

    for (var i = 0; i < body.length; i++) {
      var row = body[i];
      var rawDate = row[cols.dateCol], rawValue = row[cols.valueCol];
      if ((rawDate == null || rawDate === '') && (rawValue == null || rawValue === '')) { skipped.blank++; continue; }
      var t = readDate(rawDate, dayFirstInfo.dayFirst, cols.serialDates);
      if (isNaN(t)) { skipped.badDate++; note(examples, i, header, rawDate, 'date not understood'); continue; }
      var v = parseNumber(rawValue);
      if (!isFinite(v) || v <= 0) { skipped.badValue++; note(examples, i, header, rawValue, 'value missing, zero or negative'); continue; }
      if (seen[t] !== undefined) { skipped.duplicate++; series[seen[t]].v = v; continue; }  /* last entry for a date wins */
      seen[t] = series.length;
      series.push({ t: t, v: v });
    }

    if (series.length < 2) {
      if (schemeName) {
        return {
          ok: false, code: 'ONE_DAY_ONLY',
          message: 'That file holds only ' + series.length + ' day of prices for \u201c' + schemeName +
                   '\u201d. It is a daily snapshot of every fund, not a history. Download the NAV ' +
                   'history for a date range instead, and this will work.'
        };
      }
      return {
        ok: false, code: 'TOO_FEW_ROWS',
        message: 'Only ' + series.length + ' usable row' + (series.length === 1 ? '' : 's') +
                 ' could be read from that file. Check that it holds a date column and a NAV column.'
      };
    }

    if (schemeCol === -1 && skipped.duplicate >= series.length && series.length) {
      return {
        ok: false, code: 'MIXED_SERIES',
        message: 'That file looks like more than one fund stacked together: ' + skipped.duplicate +
                 ' rows repeat a date already seen, and no column names the fund they belong to. ' +
                 'Load a file for one fund, or one that names the fund in a column.'
      };
    }

    series.sort(function (a, b) { return a.t - b.t; });

    var warnings = [];
    if (!dayFirstInfo.certain) {
      warnings.push(dayFirstInfo.conflict
        ? 'This file mixes day-first and month-first dates. It has been read as day-first (05-08-2026 means 5 August). Check the first and last dates below.'
        : 'Every date in this file could be read either way, so it has been read as day-first (05-08-2026 means 5 August). Check the first and last dates below.');
    }
    var gap = largestGapDays(series);
    if (gap > 45) {
      warnings.push('The longest gap in this data is about ' + gap + ' days. Rolling periods that fall inside a gap are left out rather than stretched.');
    }

    return {
      ok: true,
      series: series,
      report: {
        rowsRead: body.length,
        used: series.length,
        skipped: skipped,
        examples: examples.slice(0, 3),
        dayFirst: dayFirstInfo.dayFirst,
        dateCertain: dayFirstInfo.certain,
        scheme: schemeName,
        headerFound: !!header,
        firstDate: series[0].t,
        lastDate: series[series.length - 1].t,
        spanYears: (series[series.length - 1].t - series[0].t) / (365.25 * 86400000),
        warnings: warnings
      }
    };
  }

  function note(examples, index, header, value, why) {
    if (examples.length < 3) {
      examples.push({ line: index + (header ? 2 : 1), value: String(value).slice(0, 40), why: why });
    }
  }

  function largestGapDays(series) {
    var max = 0;
    for (var i = 1; i < series.length; i++) {
      var d = Math.round((series[i].t - series[i - 1].t) / 86400000);
      if (d > max) max = d;
    }
    return max;
  }

  function parseSeriesText(text, options) { return rowsToSeries(parseDelimited(text), options); }
  function listSchemesText(text) { return listSchemes(parseDelimited(text)); }

  /* ============================================== which KIND of history this is
   *
   * Shape cannot tell a fund NAV file from an index file: both are a date and
   * a value. But the files themselves say what they are — AMFI's export
   * carries "Net Asset Value", scheme names and plan words; NSE's carries
   * "Total Returns Index", index columns and never a scheme — so the words in
   * the file are read and weighed. An index FUND's NAV file mentions "Nifty"
   * too, which is why one hit decides nothing: the fund-side words must
   * clearly outweigh the index-side words, or nothing is claimed. A file that
   * says neither (a bare date,value paste) stays null and passes any door.
   */
  /* Each signal is tried two ways: as a word pattern on the file's text with
   * separators kept, and as a substring of the text with every separator
   * stripped -- because NSE writes "TotalReturnsIndex" and "HistoricalDate"
   * as single camelCase words that no \s* can bridge. A signal counts once
   * however many ways it matches. Third column: the compact form (or null
   * where the compact form would be unsafe -- "tri" is inside "distribution"). */
  var NAV_SIGNALS = [
    [/net[\s_-]*asset[\s_-]*value/i, 3, 'Net Asset Value', 'netassetvalue'],
    [/historical\s+nav|nav\s+history/i, 3, 'Historical NAV', 'navhistory'],
    [/\bnav\b/i, 3, 'a NAV column', null],
    [/repurchase/i, 3, 'Repurchase Price', 'repurchase'],
    [/\bsale\s*price\b/i, 2, 'Sale Price', 'saleprice'],
    [/\bmutual\s*fund\b/i, 2, 'Mutual Fund', 'mutualfund'],
    [/\bscheme\b/i, 2, 'a Scheme column', 'schemename'],
    [/\b(direct|regular)[\s_-]*plan\b/i, 2, 'a Direct/Regular plan name', 'directplan'],
    [/\bidcw\b|\bdividend\s*payout\b/i, 2, 'IDCW', null],
    [/\bfolio\b/i, 2, 'Folio', 'folio'],
    [/\bfund\b/i, 1, 'a fund name', null],
    [/\bgrowth\b/i, 1, 'a Growth option', null]
  ];
  var INDEX_SIGNALS = [
    [/total[\s_-]*returns?[\s_-]*index/i, 4, 'Total Returns Index', 'totalreturnsindex'],
    [/\bntr[\s_-]*values?\b/i, 3, 'NTR values', 'ntrvalue'],
    [/historical[\s_-]*index[\s_-]*data/i, 3, 'Historical Index Data', 'historicalindexdata'],
    [/\bindex[\s_-]*(value|name|date)\b/i, 2, 'an Index value/name column', 'indexname'],
    [/\btri\b/i, 2, 'TRI', null],
    [/\b(nifty|sensex)\b/i, 2, 'an index name (Nifty/Sensex)', 'nifty'],
    [/\b(open|high|low|closing?)[\s_-]*index\b|\bday[\s_-]*(high|low)\b/i, 2,
      'Open/High/Low/Close index columns', 'openindex'],
    [/historical[\s_-]*date\b/i, 2, 'a HistoricalDate column', 'historicaldate'],
    [/\bshares\s*traded\b/i, 2, 'Shares Traded', 'sharestraded'],
    [/\bturnover\b/i, 1, 'Turnover', 'turnover'],
    [/\bp\/e\b/i, 1, 'P/E', null],
    [/div[\s_-]*yield/i, 1, 'Div Yield', 'divyield']
  ];

  function guessDataKind(rows, fileName) {
    var out = { kind: null, navScore: 0, indexScore: 0, navFound: [], indexFound: [] };
    if (!rows || !rows.length) return out;
    /* the header rows and a sample of the body carry every naming there is */
    var text = rows.slice(0, 60).map(function (r) {
      return (r || []).map(function (c) { return String(c == null ? '' : c); }).join(' ');
    }).join('\n');
    var compact = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
    function score(signals, side, found) {
      signals.forEach(function (s) {
        if (s[0].test(text) || (s[3] && compact.indexOf(s[3]) !== -1)) {
          out[side] += s[1]; found.push(s[2]);
        }
      });
    }
    score(NAV_SIGNALS, 'navScore', out.navFound);
    score(INDEX_SIGNALS, 'indexScore', out.indexFound);

    /* A header of Open/High/Low/Close is market data whatever else it says:
     * a NAV has one value a day, never a traded range. Count the four words
     * across the first rows (NSE writes them as bare uppercase headings). */
    var ohlc = 0;
    ['open', 'high', 'low', 'close'].forEach(function (w) {
      if (new RegExp('\\b' + w + '\\b', 'i').test(text)) ohlc++;
    });
    if (ohlc >= 3) { out.indexScore += 3; out.indexFound.push('Open/High/Low/Close columns'); }

    /* The file's own name testifies too: NSE names its exports after the
     * index ("NIFTY 50_Data.csv") and often says nothing inside the file,
     * while AMFI names them NAV_<from>_to_<to>.xlsx. Weighted below any
     * content signal so words inside the file always outrank the label on it. */
    var nm = String(fileName == null ? '' : fileName).replace(/[_.\-]+/g, ' ');
    if (/\b(nifty|sensex|tri|index)\b/i.test(nm) && !/\bfund\b/i.test(nm)) {
      out.indexScore += 2; out.indexFound.push('the file’s name (' + nm.trim() + ')');
    }
    if (/\bnav\b/i.test(nm)) {
      out.navScore += 2; out.navFound.push('the file’s name (' + nm.trim() + ')');
    }

    var hi = Math.max(out.navScore, out.indexScore);
    var lo = Math.min(out.navScore, out.indexScore);
    /* decide only on a clear verdict: a real score, a real margin, dominance */
    if (hi >= 3 && hi - lo >= 2 && hi >= 2 * lo) {
      out.kind = out.navScore > out.indexScore ? 'nav' : 'index';
    }
    return out;
  }

  /* Keep only the part of a series inside a chosen window. Both bounds are
   * inclusive, and either may be left out. */
  function sliceSeries(series, fromT, toT) {
    return (series || []).filter(function (p) {
      if (fromT != null && !isNaN(fromT) && p.t < fromT) return false;
      if (toT != null && !isNaN(toT) && p.t > toT) return false;
      return true;
    });
  }

  var api = {
    detectDelimiter: detectDelimiter,
    parseDelimited: parseDelimited,
    checkSchema: checkSchema, TRADEBOOK_COPY: TRADEBOOK_COPY, NOT_NUMERIC_COPY: NOT_NUMERIC_COPY,
    NOT_TABULAR_COPY: NOT_TABULAR_COPY, findHeader: findHeader, columnProfile: columnProfile,
    parseNumber: parseNumber,
    parseDateParts: parseDateParts,
    toTimestamp: toTimestamp,
    rowsToSeries: rowsToSeries,
    columnSummary: columnSummary,
    detectDayFirst: detectDayFirst,
    listSchemes: listSchemes,
    listSchemesText: listSchemesText,
    guessDataKind: guessDataKind,
    sliceSeries: sliceSeries,
    parseSeriesText: parseSeriesText
  };
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.PRCParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
