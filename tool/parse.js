/* The Portfolio Reality Check: file reading.
 *
 * Turns a NAV or index file into a clean, sorted, dated series, and reports
 * exactly what it threw away and why. Nothing here guesses silently: if the
 * file is ambiguous the caller is told, so the screen can say so.
 */
(function (root) {
  'use strict';

  var MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };

  /* Headings as the files write them, reduced to plain lowercase words.
   *
   * The same heading arrives in several spellings: AMFI writes "Net Asset
   * Value", NSE's index service "TotalReturnsIndex", a registrar's export
   * "SCHEME_NAME", a hand-made file "NAV_Value". Splitting camelCase and
   * turning underscores, slashes and brackets into spaces makes all of them
   * the words a person would read, which is what every heading test below
   * is written against. Without it "NAV_Value" matched nothing, and the
   * file's first numeric column, a scheme code, was read as the NAV. */
  function normHeader(h) {
    return String(h == null ? '' : h)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[_\-.\/\\()\[\]{}:#₹*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var SCHEME_HEADERS = ['scheme name', 'schemename', 'scheme', 'fund name', 'fundname',
                        'fund', 'plan name', 'security name', 'index name'];
  var CODE_HEADERS = ['scheme code', 'amfi code', 'amfi scheme code', 'code', 'scheme id'];

  var DATE_HEADERS = ['date', 'nav date', 'navdate', 'as on', 'as on date', 'day', 'period'];
  var VALUE_HEADERS = ['nav', 'net asset value', 'net asset value rs', 'nav rs',
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

  /* Does this cell read as a date in EITHER order? 01/13/2024 is a date; it
     is just month-first. Which order the column uses is decided afterwards by
     detectDayFirst, over the whole column. */
  function readsAsDate(cell) {
    return !isNaN(toTimestamp(parseDateParts(cell, true))) || !isNaN(toTimestamp(parseDateParts(cell, false)));
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
    if (secondOver12 && !firstOver12) return { dayFirst: false, certain: true, monthFirst: true };
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
  /* Headings that are NEVER the value, whatever the column holds. Tested on
   * the plain words from normHeader. A scheme code, an ISIN, a folio, an id
   * or a number names a thing, not a price; AMFI's Repurchase and Sale Price
   * columns are blank or a load-adjusted copy of the NAV. Volumes, turnover,
   * changes, ratios, units and balances are numbers that are not a price. */
  var NEVER_BASE = /\bcode\b|\bisin\b|\bfolio\b|\bid\b|\bnumber\b/;
  /* A fund house's "Sale and Repurchase NAV" is its NAV under its old name
     (one price for both, since entry loads went), so a heading naming both
     sides and the NAV is the value. A sale price or a repurchase price on its
     own is still never read as the NAV. */
  var NEVER_VALUE = { test: function (h) {
    if (NEVER_BASE.test(h)) return true;
    if (!/\brepurchase\b|\bsale\b/.test(h)) return false;
    return !(/\bsale\b/.test(h) && /\brepurchase\b/.test(h) && /\bnav\b|\bnet asset value\b/.test(h));
  } };
  var NOT_VALUE = [
    NEVER_VALUE,
    /\bvolumes?\b|\bvol$|\bqty\b|\bquantit(y|ies)\b|\bshares\b|\bcontracts\b/,
    /\bturnover\b/,
    /\bchange\b|\bchg\b|\bpoints?\b|\bpct\b|%|\byield\b|\bratio\b/,
    /\bp e\b|\bp b\b|\bpe\b|\bpb\b|\bdiv(idend)?\b/,
    /\baccount\b|\b(no|num|sr|srno|s no)\b/,
    /\bunits?\b|\bbalance\b/
  ];

  /* Which numeric column is the value, when a file offers several: the
   * heading decides, in this order. Net asset value, NAV, total returns
   * index, index value, close, value; a bare price and a day's open, high
   * or low only when nothing above is there. */
  var VALUE_RANK = [
    /\bnet asset value\b/,
    /\bnav\b/,
    /\btotal returns? index\b|\btri\b/,
    /\bindex value\b/,
    /\bclos(e|ing)\b/,
    /\bvalue\b/,
    /\bprice\b/,
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
      var filled = 0, dates = 0, numbers = 0, positive = 0, serials = 0, whole = 0, decimals = 0;
      for (var r = 0; r < probe.length; r++) {
        var cell = probe[r] ? probe[r][c] : null;
        if (cell == null || String(cell).trim() === '') continue;
        filled++;
        if (readsAsDate(cell)) { dates++; continue; }
        if (serialOf(cell) !== null) serials++;
        var n = parseNumber(cell);
        if (isFinite(n)) {
          numbers++; if (n > 0) positive++;
          var dp = decimalPlaces(cell);
          /* whole as written: "80.0000" is a NAV written to four places */
          if (Math.floor(n) === n && dp === 0) whole++;
          if (dp > decimals) decimals = dp;
        }
      }
      out.push({
        index: c, filled: filled, dates: dates, numbers: numbers, positive: positive,
        isSerials: filled >= need && serials >= filled * 0.6,
        isDates: filled >= need && dates >= filled * 0.6,
        /* Prices are positive. A column of positive numbers is a candidate; a
           column that is 40% negative is a change or a points move. */
        isPrices: filled >= need && numbers >= filled * 0.6 && positive >= filled * 0.6,
        /* A whole number on every row is a code, a count or an id, never a
           NAV or an index value, which carry decimals. */
        allWhole: numbers > 0 && whole === numbers,
        decimals: decimals
      });
    }
    return out;
  }
  /* Decimal places as written: "24.7805" has four, "120503" none. */
  function decimalPlaces(cell) {
    var s = String(cell == null ? '' : cell).trim().replace(/[₹$,\s]/g, '');
    var m = /\.(\d+)$/.exec(s);
    return m ? m[1].length : 0;
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
    var lower = headerRow ? headerRow.map(normHeader) : null;

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

    /* ---- the value column: the heading first, in VALUE_RANK's order.
       A heading that names something else (a code, an ISIN, a volume) is
       never the value, and neither is a column of whole numbers: a NAV or an
       index value carries decimals, a scheme code does not. A column with no
       heading the list knows is taken only when no named one is there. */
    var valueCol = -1, bestValue = 1e9;
    prof.forEach(function (col) {
      if (col.index === dateCol || !col.isPrices || col.allWhole) return;
      var h = heading(col.index);
      if (h && NEVER_VALUE.test(h)) return;
      /* a heading that names the value wins even with "per unit" or
         "points" in it ("NAV per Unit", "Index Value (Points)"); one that
         names some other number (a volume, a change, units) is taken only
         when there is nothing else */
      var rank = h ? headingRank(VALUE_RANK, h) : null;
      var score = rank !== null ? rank : (h && headingRank(NOT_VALUE, h) !== null ? 900 + col.index : 100 + col.index);
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
      /* Headings over two rows ("Regular Plan" across two columns, "Growth"
         and "IDCW" under it) are read as one row of headings, each column
         named by both. A summary's headings (a year's highest and lowest
         NAV) are never the daily table's. */
      var head = rows[i], top = i, start = i + 1;
      if (subHeading(rows, i)) { head = joinHeadings(rows[i], rows[i + 1]); start = i + 2; }
      else if (i > 0 && isGroupRow(rows[i - 1], rows[i])) { head = joinHeadings(rows[i - 1], rows[i]); top = i - 1; }
      if (!looksLikeHeader(head) || summaryHeading(head)) continue;
      var body = rows.slice(start);
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
      if (width >= 2 && filledCount(head) < Math.max(2, width - 1)) continue;
      /* Kept even though its columns may not check out. A row that reads as a
         header IS the header; whether the rows under it hold what it claims is
         a separate question, and it is the question worth answering. Throwing
         the header away here left the refusal unable to say "the column you
         called NAV holds text" -- it could only say it found no columns. */
      if (fallback === null) fallback = { index: start - 1, top: top, header: head, body: body };
      if (body.length < 2) continue;
      var cols = pickColumns(body, head);
      if (cols.dateCol !== -1 && cols.valueCol !== -1 && cols.dateCol !== cols.valueCol) {
        return { index: start - 1, top: top, header: head, body: body };
      }
    }
    /* No header-shaped row at all. Everything is data and shape decides, which
       is how AMFI's headerless bulk files have always been read. */
    return fallback || { index: -1, top: -1, header: null, body: rows };
  }
  /* "Year | Highest NAV | Date | Lowest NAV | Date": every value it names is a summary's */
  var SUMMARY_WORDS = /\bnav range\b|\b52\s*weeks?\b|\bhighest\b|\blowest\b/;
  function summaryHeading(head) {
    var words = (head || []).map(normHeader);
    if (!words.some(function (h) { return SUMMARY_WORDS.test(h); })) return false;
    return !words.some(function (h) { return h && !SUMMARY_WORDS.test(h) && headingRank(VALUE_RANK, h) !== null && !NEVER_VALUE.test(h); });
  }

  function looksLikeHeader(row) {
    if (!row) return false;
    var text = row.map(normHeader).join(' ');
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
        if (readsAsDate(cell)) dates++;
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

  function checkSchema(rows, options) {
    var TRADEBOOK_COPY = tradebookCopy(options && options.slot);
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
        var plain = normHeader(name);
        TRADE_HEADERS.forEach(function (re) {
          if ((re.test(name) || re.test(plain)) && hits.indexOf(name) === -1) hits.push(name);
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

    /* 2b. The other marks of a statement, before the columns are looked for,
           so a statement is called one even when it has no price column. */
    var mark = statementMark(header, body, rows);
    if (mark) {
      var holdings = !columnProfile(body).some(function (col) { return col.isDates; });
      return { ok: false, code: 'TRADEBOOK', detected: [mark], message: tradebookCopy(options && options.slot, holdings) };
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
          var hh = normHeader(header[vh]);
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
          them, is a statement too: a price file has one value per date.
          A file with a plan or option column, or with each plan and option
          under a line of its own, explains them. */
    if (!keyedBy(schemeColumns(header, body)) && variantSections(body).length < 2 && body.length >= 6) {
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
             ' Nothing in it read as a column of dates or a column of values, which usually ' +
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
    'read one reliably, and a number read wrongly out of a PDF would be silently wrong. ' +
    'Open the statement in Excel or your fund house’s portal and download the same history as ' +
    'CSV or Excel, or copy the two columns and paste them in.';

  /* A statement of the reader's own payments (a tradebook, a CAS, a
     transaction log) is the right file in the wrong slot, and is told so in
     words that fit the slot it was put in. */
  function tradebookCopy(slot, holdings) {
    var what = 'This looks like a statement of your own ' + (holdings ? 'holdings' : 'payments') + '. ';
    if (slot === 'index') return what + 'This slot needs the index\u2019s history: a date and the index value on that date. Your statement goes in step 1.';
    if (slot === 'compare') return what + 'This slot needs the history to compare with: an index\u2019s values or a fund\u2019s NAVs, one row per date. Your statement goes in step 1.';
    if (slot === 'nav') return what + 'This slot needs the fund\u2019s NAV history: a date and the NAV on that date. Your statement goes in step 1.';
    return what + 'This screen needs a price history: a date and the NAV or index value on that date. Check my portfolio is the screen for this file.';
  }

  /* A statement by its other marks, for every slot that wants a price history.
   *
   * The headings and the words of a reader's own statement: an amount, units,
   * money invested, a folio, a transaction or its description; or a column whose
   * cells start with what happened (SIP Purchase, Systematic Investment,
   * Redemption, Switch ...). These are the marks the payments slot reads the
   * other way (the owner's C1 ruling), so a file is a statement on every
   * screen or on none. Without them, a ledger of Date, Transaction, Amount,
   * Units was read as a price history, its units column taken for a NAV.
   *
   * Rows without headings are a statement when whole amounts sit beside
   * decimal units, or every figure is a whole amount, and nothing marks them
   * as prices (an ISIN, a run of trading days). A NAV or an index value
   * carries decimals; an AMFI row carries an ISIN. "per unit" in a heading is
   * a NAV's, not a statement's. */
  var STATEMENT_HEADING = /\b(amount|amt|units?|invested|investment amount|current value|market value|transactions?|description|particulars|narration|folio)\b/;
  /* what happened, at the start of a cell; not dividend or IDCW, which a NAV
     file can carry in an option column on every row */
  var STATEMENT_WORD = /^(purchase|additional purchase|new purchase|fresh purchase|sip\b|systematic|redemption|redeem|switch|stp\b|swp\b|transfer|withdraw|money (in|out)\b|worth today|buy\b|sell\b|bought|sold|lump\s*sum)/i;
  function statementMark(header, body, rows) {
    var c, r;
    if (header) {
      for (c = 0; c < header.length; c++) {
        var p = normHeader(header[c]).replace(/\bper units?\b/g, '');
        if (p && STATEMENT_HEADING.test(p)) return String(header[c]).trim();
      }
    }
    var probe = body.slice(0, 60), width = 0;
    probe.forEach(function (row) { if (row && row.length > width) width = row.length; });
    for (c = 0; c < width; c++) {
      var seen = 0, hit = 0, first = '';
      for (r = 0; r < probe.length; r++) {
        var cell = String(probe[r][c] == null ? '' : probe[r][c]).trim();
        if (!cell) continue;
        seen++;
        if (cell.length <= 60 && STATEMENT_WORD.test(cell)) { hit++; if (!first) first = cell; }
      }
      if (seen >= 2 && hit >= Math.ceil(seen * 0.6)) return (header && header[c] ? String(header[c]).trim() + ': ' : '') + first;
    }
    if (!header) {
      var s = rowSignals(rows);
      if (s.dated && !s.isin && !s.dailyRun) {
        if (s.wholeBesideDecimals) return 'whole amounts beside units';
        var nums = 0, whole = 0;
        probe.forEach(function (row) {
          (row || []).forEach(function (cell) {
            var t = String(cell == null ? '' : cell).trim();
            if (!t || readsAsDate(t)) return;
            var v = parseNumber(t);
            if (!isFinite(v)) return;
            nums++;
            if (decimalPlaces(t) === 0 && Math.abs(v) >= 100) whole++;
          });
        });
        if (nums >= 3 && whole === nums) return 'whole amounts on dates';
      }
    }
    return null;
  }
  var TRADEBOOK_COPY = tradebookCopy();

  /* Section 3's red banner is written for a tradebook. A column of text under a
     NAV heading is a different fault and gets its own sentence, because "this
     is a trade log" would be a wrong description of it. */
  var NOT_NUMERIC_COPY =
    'The column this file uses for values does not hold numbers. Expected Schema: Date and ' +
    'NAV / Value, where every value is a price. Please re-upload a valid daily NAV or Index ' +
    'CSV file.';

  function fail(code, message) { return { ok: false, code: code, message: message, detected: [] }; }

  var ISIN_RE = /^INF[A-Z0-9]{9}$/;

  /* The refusal the brief writes for a value column that never moves. */
  function flatCopy(header) {
    var found = header ? header.map(function (h) { return String(h == null ? '' : h).trim(); }).filter(Boolean) : [];
    return 'Every value in this file\u2019s value column is the same. The wrong column was read. ' +
      (found.length ? 'The headers found were: ' + found.join(', ') + '.' : 'The file has no row of headers.');
  }

  /* The columns that say which scheme a row belongs to.
   *   name   the scheme's name, with its plan and option: what a reader knows
   *   code   the AMFI scheme code, one for each plan and option
   *   plan, option, freq   a fund house's own columns for the plan, the
   *          option and an IDCW's frequency, when each has rows of its own
   * A file with a code column is keyed by the code, because two plans can
   * share a name in a careless file and two codes never share a scheme. The
   * name is what the reader is shown and what they type to find it. A name,
   * plan or option column holds words, and a code column holds no dates: a
   * heading alone does not make one. */
  var PLAN_HEAD = /^(scheme )?plans?( name| type)?$|^plans? (and )?options?$|^options? (and )?plans?$/;
  var OPTION_HEAD = /^(scheme )?options?( name| type)?$|^(dividend|idcw) (option|type)$/;
  var FREQ_HEAD = /^((dividend|idcw) )?frequency$/;
  function schemeColumns(header, body) {
    var out = { key: -1, name: -1, code: -1, plan: -1, option: -1, freq: -1 };
    if (!header) return out;
    var lower = header.map(normHeader);
    var i;
    for (i = 0; i < lower.length && out.name === -1; i++) {
      if (SCHEME_HEADERS.indexOf(lower[i]) !== -1) out.name = i;
    }
    for (i = 0; i < lower.length && out.name === -1; i++) {
      if (/\bscheme\b|\bfund name\b/.test(lower[i]) && !/\bcode\b|\bisin\b|\bid\b/.test(lower[i])) out.name = i;
    }
    for (i = 0; i < lower.length && out.code === -1; i++) {
      if (CODE_HEADERS.indexOf(lower[i]) !== -1 || /\b(scheme|amfi) code\b/.test(lower[i])) out.code = i;
    }
    for (i = 0; i < lower.length; i++) {
      if (out.plan === -1 && PLAN_HEAD.test(lower[i])) out.plan = i;
      else if (out.option === -1 && OPTION_HEAD.test(lower[i])) out.option = i;
      else if (out.freq === -1 && FREQ_HEAD.test(lower[i])) out.freq = i;
    }
    if (body) {
      ['name', 'plan', 'option', 'freq'].forEach(function (k) { if (out[k] !== -1 && !wordsColumn(body, out[k])) out[k] = -1; });
      if (out.code !== -1 && datesColumn(body, out.code)) out.code = -1;
    }
    out.key = out.code !== -1 ? out.code : out.name;
    return out;
  }
  function columnCells(body, col) {
    var cells = [];
    for (var r = 0; r < body.length && cells.length < 60; r++) { var c = body[r] ? body[r][col] : null; if (filledCell(c)) cells.push(c); }
    return cells;
  }
  function wordsColumn(body, col) { var cells = columnCells(body, col); return !cells.length || cells.filter(textCell).length >= cells.length * 0.6; }
  function datesColumn(body, col) { var cells = columnCells(body, col); return cells.length > 0 && cells.filter(readsAsDate).length >= cells.length * 0.6; }
  function keyedBy(sc) { return sc.key !== -1 || sc.plan !== -1 || sc.option !== -1 || sc.freq !== -1; }
  function pickSchemeColumn(header) { return schemeColumns(header).key; }
  function cellText(row, col) { return col < 0 || !row ? '' : String(row[col] == null ? '' : row[col]).trim(); }

  /* ============================================= a scheme's plan and option
   *
   * One scheme, many NAVs. Each plan (Direct, Regular; older debt funds also
   * Retail, Institutional, Super Institutional) and each option (Growth;
   * IDCW, once called Dividend, paid out or reinvested, daily to annual; now
   * and then Bonus) has a NAV of its own, and two of them are never one
   * history. They are read from a scheme's name, a column's heading, a title
   * or a file's name, short forms included: Dir, Reg, Gr, Div, Reinv,
   * IDCW-M. A scheme's own name can hold the same words ("Regular Savings
   * Fund", "Growth Opportunities Fund", "Dividend Yield Fund"), so the parts
   * after the name are read first; the whole is read for the plan only when
   * the parts after it name none, and for the option only when there are no
   * parts after it at all, with those names taken out. Text that names two
   * plans, or two options, names neither: it is not one variant. */
  var NAME_PHRASES = /\b(regular savings|regular income|growth opportunit\w*|growth sectors?|growth fund|growth and income|div(idend)? yield|dividend opportunit\w*|dividend stability|dividend leaders?|high dividend|dividend aristocrats?)\b/g;
  /* a report's name is not a variant: "NAV and Dividend History" */
  var REPORT_PHRASES = /\b(dividends?|idcw|navs?|net asset values?)\s+(history|report|declared|records?|details|data)\b|\bhistory of (dividends?|idcw)\b/g;
  var FREQUENCIES = [['Daily', /\bdaily\b/], ['Weekly', /\bweekly\b/], ['Fortnightly', /\bfortnightly\b/], ['Monthly', /\bmonthly\b/],
    ['Quarterly', /\bquarterly\b/], ['Annual', /\bannual(ly)?\b|\byearly\b/]];
  var HALF_YEARLY = /\bhalf\s*yearly\b|\bsemi\s*annual(ly)?\b/g;
  var IDCW_SHORT = { d: 'Daily', w: 'Weekly', f: 'Fortnightly', m: 'Monthly', q: 'Quarterly', h: 'Half-Yearly', hy: 'Half-Yearly', a: 'Annual', y: 'Annual' };
  var SEPARATORS = /\s+[-–—]\s+|\s[-–—]|[-–—]\s|[()\[\]\/|,;:]+/;
  function noVariant() { return { plan: null, option: null, payout: null, frequency: null }; }
  function variantWords(t) {
    var v = noVariant();
    if (!t) return v;
    t = ' ' + t + ' ';
    var plans = [];
    if (/\bsuper\s*institutional\b/.test(t)) { plans.push('Super Institutional'); t = t.replace(/\bsuper\s*institutional\b/g, ' '); }
    if (/\binstitutional\b/.test(t)) plans.push('Institutional');
    if (/\bretail\b/.test(t)) plans.push('Retail');
    if (/\bdirect\b|\bdir\b/.test(t)) plans.push('Direct');
    if (/\bregular\b|\breg\b/.test(t)) plans.push('Regular');
    if (plans.length === 1) v.plan = plans[0];
    var idcw = /\bidcw\b|\bdividends?\b|\bdiv\b/.test(t), bonus = /\bbonus\b/.test(t), growth = /\bgrowth\b|\bgr\b/.test(t);
    if (idcw && !bonus && !growth) {
      v.option = 'IDCW';
      var re = /\bre\s*invest(ment|ed)?\b|\breinv\b/.test(t), po = /\bpay\s*outs?\b|\bpaid\b/.test(t);
      if (re && !po) v.payout = 'Reinvestment'; else if (po && !re) v.payout = 'Payout';
      var freq = [];
      if (HALF_YEARLY.test(t)) { freq.push('Half-Yearly'); t = t.replace(HALF_YEARLY, ' '); }
      HALF_YEARLY.lastIndex = 0;
      FREQUENCIES.forEach(function (f) { if (f[1].test(t)) freq.push(f[0]); });
      if (freq.length === 1) v.frequency = freq[0];
      else if (!freq.length) { var short = /\bidcw\s*(hy|[dwfmqhay])\b/.exec(t); if (short) v.frequency = IDCW_SHORT[short[1]]; }
    } else if (bonus && !idcw && !growth) v.option = 'Bonus';
    else if (growth && !idcw && !bonus) v.option = 'Growth';
    return v;
  }
  function plainWords(text) { return normHeader(text).replace(REPORT_PHRASES, ' ').replace(NAME_PHRASES, ' '); }
  function variantOf(text) {
    var raw = String(text == null ? '' : text);
    if (!raw.trim()) return noVariant();
    var parts = raw.split(SEPARATORS).map(normHeader).filter(Boolean);
    var whole = variantWords(plainWords(raw));
    /* the first part is a scheme's name, unless it only names a variant */
    if (parts.length < 2 || pureVariant(parts[0])) return whole;
    var tail = variantWords(plainWords(parts.slice(1).join(' ')));
    if (!tail.plan) tail.plan = whole.plan;
    return tail;
  }
  function variantKnown(v) { return !!(v && (v.plan || v.option)); }
  /* "Direct Plan, Growth Option"; "Regular Plan, Monthly IDCW Option (Payout)" */
  function variantLabel(v) {
    if (!variantKnown(v)) return null;
    var opt = v.option === 'IDCW' ? (v.frequency ? v.frequency + ' ' : '') + 'IDCW Option' + (v.payout ? ' (' + v.payout + ')' : '')
      : v.option ? v.option + ' Option' : 'option not stated';
    return (v.plan ? v.plan + ' Plan' : 'plan not stated') + ', ' + opt;
  }
  /* two variants that cannot be one NAV: a plan, an option, or an IDCW's
     payout or frequency stated on both sides and different */
  function variantsDiffer(a, b) {
    if (!a || !b) return false;
    if (a.plan && b.plan && a.plan !== b.plan) return true;
    if (a.option && b.option && a.option !== b.option) return true;
    if (a.option === 'IDCW' && b.option === 'IDCW') {
      if (a.payout && b.payout && a.payout !== b.payout) return true;
      if (a.frequency && b.frequency && a.frequency !== b.frequency) return true;
    }
    return false;
  }
  /* a's own words first; b fills only what a leaves unstated */
  function mergeVariant(a, b) {
    var out = noVariant();
    out.plan = (a && a.plan) || (b && b.plan) || null;
    out.option = (a && a.option) || (b && b.option) || null;
    var from = a && a.option ? a : b;
    var fill = b && a && a.option && b.option === a.option ? b : null;
    out.payout = (from && from.payout) || (fill && fill.payout) || null;
    out.frequency = (from && from.frequency) || (fill && fill.frequency) || null;
    return out;
  }
  /* A field the file's choices leave unstated, filled from the wider
     context: the titles over the table, then the file's own name. Only when
     NO choice states that field itself: in a file where some rows say
     "Direct Plan" and others say nothing, the others are not Direct. */
  function fillFrom(list, ctx) {
    var statesPlan = list.some(function (v) { return v.plan; }), statesOption = list.some(function (v) { return v.option; });
    return list.map(function (v) {
      var out = mergeVariant(v, null);
      ctx.forEach(function (c) {
        if (!c) return;
        if (!statesPlan && !out.plan && c.plan) out.plan = c.plan;
        if (!statesOption && !out.option && c.option) { out.option = c.option; out.payout = c.payout; out.frequency = c.frequency; }
        else if (out.option === 'IDCW' && c.option === 'IDCW') {
          if (!out.payout && c.payout && !list.some(function (x) { return x.payout; })) out.payout = c.payout;
          if (!out.frequency && c.frequency && !list.some(function (x) { return x.frequency; })) out.frequency = c.frequency;
        }
      });
      return out;
    });
  }
  /* a file's own name, its extension and underscores taken off */
  function fileVariant(fileName) {
    var nm = String(fileName == null ? '' : fileName).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_.]+/g, ' ');
    return variantOf(nm);
  }
  /* the plan and option a file's titles state */
  function titleVariant(titles) {
    var v = noVariant();
    (titles || []).forEach(function (t) { v = mergeVariant(v, variantOf(t)); });
    return v;
  }
  /* The scheme's name without its plan and option: "Axis Bluechip Fund". */
  function fundName(text) {
    var raw = String(text == null ? '' : text).trim().replace(/^\s*(scheme|fund)(\s+name)?\s*[:\-–—]\s*/i, '');
    if (!raw) return '';
    var parts = raw.split(/\s+[-–—]\s+|\s[-–—]\s?|[-–—]\s|\s*[()\[\]|,]\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    var keep = [];
    for (var i = 0; i < parts.length; i++) {
      if (i > 0 && variantKnown(variantWords(plainWords(parts[i])))) break;
      keep.push(parts[i]);
    }
    return keep.join(' - ');
  }
  /* words that only say a plan or an option, a NAV or a currency */
  var VARIANT_ONLY = /\b(super|institutional|retail|direct|dir|regular|reg|plans?|options?|idcw|dividends?|div|payouts?|pay|out|re|reinvestment|reinvest|reinvested|reinv|daily|weekly|fortnightly|monthly|quarterly|half|yearly|semi|annual|annually|bonus|growth|gr|nav|net|asset|value|rs|inr|[dwfmqhay])\b/g;
  function pureVariant(text) { return !normHeader(text).replace(VARIANT_ONLY, ' ').trim(); }

  /* ------------------------------------------------ a table's parts around its rows */
  function filledCell(c) { return c != null && String(c).trim() !== ''; }
  function textCell(c) { var t = String(c == null ? '' : c).trim(); return !!t && !readsAsDate(t) && !isFinite(parseNumber(t)); }
  function dataRow(r) { return !!r && r.some(readsAsDate) && r.some(function (c) { return filledCell(c) && !readsAsDate(c) && isFinite(parseNumber(c)); }); }

  /* Headings over two rows: "Regular Plan" across two columns with "Growth"
     and "IDCW" under it, or "Sale and Repurchase NAV" over "Regular" and
     "Direct". The upper row holds words over the value columns, never a
     title in the first cell (a title sits there alone; the first cell of a
     heading row is the date's, or empty), and a plan or an option is named
     on one of the two rows. */
  function isGroupRow(top, under) {
    if (!top || !under) return false;
    var t0 = String(top[0] == null ? '' : top[0]).trim();
    if (t0 && !/\bdate\b|\bas on\b|\bperiod\b|\bday\b/.test(normHeader(t0))) return false;
    var groups = 0, c;
    for (c = 1; c < top.length; c++) {
      if (!filledCell(top[c])) continue;
      if (!textCell(top[c])) return false;
      groups++;
    }
    if (!groups) return false;
    var cells = under.filter(filledCell);
    if (cells.length < 2 || under.some(readsAsDate)) return false;
    if (cells.filter(textCell).length < cells.length * 0.6) return false;
    function names(r) { for (var k = 1; k < r.length; k++) if (filledCell(r[k]) && variantKnown(variantOf(r[k]))) return true; return false; }
    return names(top) || names(under);
  }
  function subHeading(rows, i) {
    if (!isGroupRow(rows[i], rows[i + 1])) return false;
    for (var k = i + 2; k < rows.length && k < i + 5; k++) {
      if (!rows[k] || !rows[k].some(filledCell)) continue;
      return rows[k].some(readsAsDate);
    }
    return false;
  }
  function joinHeadings(top, under) {
    var width = Math.max(top.length, under.length), out = [], carry = '';
    for (var c = 0; c < width; c++) {
      var t = String(top[c] == null ? '' : top[c]).trim(), u = String(under[c] == null ? '' : under[c]).trim();
      if (t) carry = t; else if (!u) carry = '';
      out.push(((t || (u && c > 0 ? carry : '')) + ' ' + u).trim());
    }
    return out;
  }

  /* A fund house prints a summary beside the daily table: the year's highest
     and lowest NAV, a "NAV Range", 52-week highs. Those rows carry dates and
     NAVs too and are not the daily series. A summary line is dropped; from a
     summary's own heading, nothing is read until the daily table's heading
     comes back or a new part of the file begins. A repeat of the daily
     heading (a new page) is not a row. */
  var SUMMARY_HEAD = /\bnav range\b|\b52\s*weeks?\b|\bhighest\b|\blowest\b|^range\b/;
  var SUMMARY_LINE = /^(highest|lowest|high|low|max(imum)?|min(imum)?|average|avg)\b|\bnav range\b|\b52\s*weeks?\b/;
  function cleanBody(body, header) {
    var head = header ? header.map(normHeader).join('|') : null, out = [], skipping = false;
    for (var i = 0; i < body.length; i++) {
      var r = body[i] || [];
      var first = null;
      for (var f = 0; f < r.length && first === null; f++) if (filledCell(r[f])) first = r[f];
      if (first === null) { out.push(r); continue; }
      /* a data row starts with its date or a number: nothing to look at */
      if (!textCell(first)) { if (!skipping) out.push(r); continue; }
      if (head && r.map(normHeader).join('|') === head) { skipping = false; continue; }
      if (sectionTitle(r) != null) { skipping = false; out.push(r); continue; }
      var words = r.filter(textCell), label = words.map(normHeader).join(' ');
      if (!r.some(readsAsDate) && SUMMARY_HEAD.test(label)) { skipping = true; continue; }
      if (skipping) continue;
      if (SUMMARY_LINE.test(normHeader(first))) continue;
      out.push(r);
    }
    return out;
  }
  /* the titles over the headings: a scheme's name, a report's name, a period */
  function titleTexts(rows, before) {
    var out = [];
    for (var i = 0; i < before && i < rows.length; i++) {
      var t = (rows[i] || []).filter(filledCell).map(function (c) { return String(c).trim(); }).join(' ');
      if (t) out.push(t);
    }
    return out;
  }
  /* the scheme a title names: the first title that reads as a fund's name,
     without the report's words around it ("NAV History of ...", "for the
     period ...") and never the fund house's own name */
  function schemeTitle(titles) {
    for (var i = 0; i < titles.length; i++) {
      var t = String(titles[i]).replace(/\s+/g, ' ').trim();
      if (/^(fund\s*house|amc|asset management|registrar)\b/i.test(t)) continue;
      t = t.replace(/^(historical\s+navs?|navs?\s+history|net asset values?|sale\s*(and|&|\/)\s*repurchase\s+(navs?|prices?)|navs?)\s*(report|history|details|data)?\s*(of|for)?\s*[:\-–—]?\s*/i, '')
        .replace(/^(scheme|fund)(\s+name)?\s*[:\-–—]\s*/i, '')
        .replace(/\s*[(\-–—:,]?\s*\b(for the period|from|between|as on|period)\b.*$/i, '').trim();
      if (!t || !/\bfund\b|\bscheme\b|\bplan\b|\betf\b|\bfof\b/i.test(t)) continue;
      if (/^[\w\s.&'’-]*\bmutual\s+fund\s*$/i.test(t)) continue;
      if (pureVariant(fundName(t))) continue;
      return t;
    }
    return '';
  }

  /* Side by side: one NAV column per variant ("Regular Plan Growth",
     "Direct Plan IDCW"...). A column counts when it holds prices and its
     heading names a NAV, or says nothing but a plan or an option. Two or
     more that name different variants make a choice. Two that read the same,
     or a NAV column that names none beside one that does, cannot be told
     apart, and the file is not read: no guess is made between them. */
  function columnVariants(body, header) {
    if (!header) return null;
    var prof = columnProfile(body), list = [];
    prof.forEach(function (col) {
      var raw = header[col.index], h = normHeader(raw);
      if (!h || !col.isPrices || col.allWhole || NEVER_VALUE.test(h)) return;
      var rank = headingRank(VALUE_RANK, h), v = variantOf(raw);
      if (!(rank !== null && rank <= 1) && !(variantKnown(v) && pureVariant(raw))) return;
      list.push({ col: col.index, heading: String(raw).trim(), variant: v, label: variantLabel(v) });
    });
    if (list.length < 2 || !list.some(function (x) { return x.label; })) return null;
    var labels = list.map(function (x) { return x.label || ''; });
    var ambiguous = labels.some(function (l, i) { return !l || labels.indexOf(l) !== i; });
    return { ambiguous: ambiguous, list: list };
  }
  /* Rows per variant, each under a line of its own: "Direct Plan - Growth
     Option", its rows, then "Regular Plan - Growth Option" and its rows.
     Two such lines in a row are one title. */
  function sectionTitle(row) {
    var cells = (row || []).filter(filledCell);
    if (!cells.length || cells.length > 3 || !cells.every(textCell)) return null;
    var text = cells.map(function (c) { return String(c).trim(); }).join(' - ');
    /* AMFI's category lines ("Open Ended Schemes ( Growth )") name a kind of
       scheme, not an option */
    if (/^(open|close|closed)[\s-]*ended\b|^interval\b/i.test(text)) return null;
    return variantKnown(variantOf(text)) ? text : null;
  }
  function variantSections(body) {
    var parts = [], cur = { title: '', rows: [], data: 0 };
    body.forEach(function (r) {
      var t = sectionTitle(r);
      if (t != null) {
        if (!cur.data) { cur.title = cur.title ? cur.title + ' - ' + t : t; return; }
        parts.push(cur); cur = { title: t, rows: [], data: 0 }; return;
      }
      cur.rows.push(r);
      if (dataRow(r)) cur.data++;
    });
    parts.push(cur);
    return parts.filter(function (x) { return x.data > 0; });
  }

  /* The whole reading of a table, shared by the list of what a file holds
     and by the series read from it. */
  function tableOf(rows, fileName) {
    var found = findHeader(rows);
    var header = found.header;
    var sc = schemeColumns(header, found.body);
    var keyed = keyedBy(sc);
    /* a file keyed by its rows (AMFI's, thousands of schemes) has no summary to drop */
    var body = keyed ? found.body : cleanBody(found.body, header);
    var titles = found.index < 0 ? [] : titleTexts(rows, found.top != null && found.top >= 0 ? found.top : found.index);
    var columns = columnVariants(body, header);
    var sections = keyed ? null : variantSections(body);
    var single = sections && sections.length === 1 && sections[0].title ? sections[0] : null;
    if (single) single.variant = variantOf(single.title);
    var context = titles.slice();
    if (sections && sections.length > 1 && !sections[0].title) {
      /* the first variant's rows begin under the headings; its name is the
         nearest title above them that names one */
      for (var i = titles.length - 1; i >= 0; i--) {
        if (variantKnown(variantOf(titles[i]))) { sections[0].title = titles[i]; context.splice(i, 1); break; }
      }
    }
    /* a title that comes back (a page's heading, printed on every page)
       continues the rows it named before; it is not a variant of its own */
    if (sections && sections.length > 1) {
      var byLabel = {}, merged = [];
      sections.forEach(function (s) {
        s.variant = variantOf(s.title); s.label = variantLabel(s.variant);
        var same = s.label ? byLabel[s.label] : null;
        if (same) { same.rows = same.rows.concat(s.rows); same.data += s.data; return; }
        if (s.label) byLabel[s.label] = s;
        merged.push(s);
      });
      sections = merged;
      if (sections.length === 1 && sections[0].title) single = sections[0];
    }
    if (!sections || sections.length < 2) sections = null;
    var sectionsAmbiguous = !!sections && sections.some(function (s) { return !s.label; });
    return { found: found, header: header, body: body, titles: titles, sc: sc, keyed: keyed,
             columns: columns && !columns.ambiguous ? columns.list : null, columnsAmbiguous: !!(columns && columns.ambiguous),
             sections: sections, sectionsAmbiguous: sectionsAmbiguous, single: single,
             title: schemeTitle(titles), titleVariant: titleVariant(context), fileVariant: fileVariant(fileName) };
  }
  /* A row's key: its code, or its name, with its plan, option and frequency
     where the file gives them columns of their own. */
  function rowKey(row, sc) {
    var head = sc.code !== -1 ? cellText(row, sc.code) : cellText(row, sc.name);
    return [head, cellText(row, sc.plan), cellText(row, sc.option), cellText(row, sc.freq)].filter(Boolean).join(' · ');
  }
  function rowVariantText(row, sc) { return [cellText(row, sc.plan), cellText(row, sc.option), cellText(row, sc.freq)].filter(Boolean).join(' - '); }
  /* a choice's key: its rows' key, a section, a column, joined */
  var KEY_JOIN = '\u001f';
  function joinKey(a, b) { return [a, b].filter(Boolean).join(KEY_JOIN); }
  function splitKey(key) {
    var out = { group: null, section: null, column: null };
    String(key == null ? '' : key).split(KEY_JOIN).forEach(function (p) {
      if (p.indexOf('section:') === 0) out.section = p.slice(8);
      else if (p.indexOf('column:') === 0) out.column = p.slice(7);
      else if (p) out.group = p;
    });
    return out;
  }
  var AMBIGUOUS_VARIANTS_COPY = 'This file holds more than one NAV, and its headings do not say which plan and option each one is. ' +
    'Nothing has been read from it, so no NAV is mixed with another. Download one plan and option at a time.';
  /* a PDF, or any reading held to the strict standard, that is not certain */
  var PDF_COPY = 'This PDF could not be read with certainty, so nothing was taken from it. Please download the Excel version instead.';
  var PDF_SCANNED_COPY = 'This PDF holds no text, only a picture of the page, so nothing in it can be read. Please download the Excel version instead.';

  /* Every choice a file offers, with its full name and the dates its values
   * cover: one per scheme, or plan and option, on its rows; one per section;
   * one per variant column side by side; and each of these by each other
   * when a file has both. */
  function choicesOf(tb) {
    var header = tb.header, body = tb.body, sc = tb.sc;
    var cols = pickColumns(body, header);
    if (cols.dateCol === -1 || (!tb.columns && cols.valueCol === -1)) return null;
    var dayFirst = detectDayFirst(body, cols.dateCol).dayFirst;
    var groups = [];
    if (tb.keyed) {
      var by = {}, order = [];
      for (var i = 0; i < body.length; i++) {
        var r = body[i], key = rowKey(r, sc);
        if (!key) continue;
        var t = readDate(r[cols.dateCol], dayFirst, cols.serialDates);
        if (isNaN(t)) continue;      /* AMFI's section headings carry no date */
        var g = by[key];
        if (!g) { g = by[key] = { key: key, rows: [], name: '', code: cellText(r, sc.code), names: [], latest: -Infinity, cells: rowVariantText(r, sc) }; order.push(key); }
        g.rows.push({ t: t, r: r });
        var nm = cellText(r, sc.name);
        if (nm && g.names.indexOf(nm) === -1) g.names.push(nm);
        /* a renamed scheme is listed under its latest name; the older ones still match a search */
        if (nm && (t >= g.latest || !g.name)) { g.name = nm; g.latest = t; }
      }
      groups = order.map(function (k) { var x = by[k]; x.own = mergeVariant(variantOf(x.cells), variantOf(x.name)); return x; });
    } else {
      var dated = function (list) {
        var out = [];
        list.forEach(function (r) { var t = readDate(r[cols.dateCol], dayFirst, cols.serialDates); if (!isNaN(t)) out.push({ t: t, r: r }); });
        return out;
      };
      groups = tb.sections ? tb.sections.map(function (s) { return { key: 'section:' + s.label, rows: dated(s.rows), name: '', names: [], code: '', own: s.variant }; })
        : [{ key: '', rows: dated(body), name: '', names: [], code: '', own: tb.single ? tb.single.variant : noVariant() }];
    }
    var columns = tb.columns ? tb.columns.map(function (c) { return { key: 'column:' + c.label, col: c.col, own: c.variant }; })
      : [{ key: '', col: cols.valueCol, own: header ? variantOf(header[cols.valueCol]) : noVariant() }];
    var out = [];
    groups.forEach(function (g) {
      columns.forEach(function (c) {
        var n = 0, first = Infinity, last = -Infinity;
        g.rows.forEach(function (x) {
          var v = parseNumber(x.r[c.col]);
          if (!isFinite(v) || v <= 0) return;
          n++; if (x.t < first) first = x.t; if (x.t > last) last = x.t;
        });
        if (!n && groups.length * columns.length > 1) return;
        out.push({ key: joinKey(g.key, c.key), name: g.name, code: g.code, names: g.names, rows: n, first: first, last: last, own: mergeVariant(c.own, g.own) });
      });
    });
    /* the wider context fills what no choice states; a file of many schemes
       on its rows takes nothing from it */
    var ctx = tb.keyed && groups.length > 1 ? [] : [tb.titleVariant, tb.fileVariant];
    var filled = fillFrom(out.map(function (x) { return x.own; }), ctx);
    var fund = tb.title ? fundName(tb.title) : '';
    out.forEach(function (x, k) {
      x.variant = filled[k];
      x.label = variantLabel(x.variant);
      /* a variant listed by its full name: scheme, plan, option, frequency */
      if (!tb.keyed || sc.plan !== -1 || sc.option !== -1 || sc.freq !== -1) {
        var base = tb.keyed ? fundName(x.name) || x.name : fund;
        if (x.label) x.name = (base ? base + ' – ' : '') + x.label;
      }
    });
    return { choices: out, cols: cols, dayFirst: dayFirst, groups: groups.length, columns: columns.length, fund: fund };
  }
  /* one scheme in many plans and options, or many schemes */
  function variantsOnly(list, tb) {
    if (!tb.keyed) return true;
    var names = {};
    list.forEach(function (x) { names[(fundName(x.name) || x.name).toLowerCase()] = true; });
    return Object.keys(names).length === 1;
  }

  /* Every distinct scheme in the file, with enough detail to tell near-identical
   * names apart before choosing one: its name (plan and option are part of an
   * AMFI name), its code, and the dates its prices cover. A file that holds
   * one scheme in several plans or options lists each of them by its full
   * name. */
  function listSchemes(rows, fileName) {
    var tb = tableOf(rows, fileName);
    if (tb.columnsAmbiguous || tb.sectionsAmbiguous) return null;
    if (!tb.keyed && !tb.columns && !tb.sections) return null;
    var got = choicesOf(tb);
    if (!got || !got.choices.length) return null;
    var list = got.choices.map(function (x) {
      return { key: x.key, name: x.name, code: x.code, rows: x.rows, first: x.first, last: x.last, names: x.names, variant: x.variant, label: x.label };
    }).sort(function (a, b) { return (a.name || a.key).localeCompare(b.name || b.key); });
    var hasNames = list.some(function (x) { return x.name; });
    /* every scheme on one day: a daily list of every fund, not a history */
    var snapshot = list.every(function (x) { return x.rows <= 1; });
    return { column: tb.sc.key, nameColumn: tb.sc.name, codeColumn: tb.sc.code, hasNames: hasNames, schemes: list, variants: variantsOnly(list, tb), snapshot: snapshot };
  }
  var SNAPSHOT_COPY = 'This file is a daily snapshot: one NAV for each of its schemes, all on one day. A history needs many dates. Download the NAV history for a date range instead, and this will work.';

  /* ------------------------------------------------------------------ main */

  function rowsToSeries(rows, options) {
    var opts = options || {};
    var noun = opts.noun || 'fund';
    if (!rows || rows.length < 2) {
      return { ok: false, code: 'EMPTY', message: 'That file has no rows in it that could be read.' };
    }
    /* The header can be on any of the first twenty rows, not only the first.
       See findHeader: a downloaded file usually puts a title above it. */
    var tb = tableOf(rows, opts.fileName);
    var header = tb.header;
    var body = tb.body;
    var sc = tb.sc;
    if (tb.columnsAmbiguous || tb.sectionsAmbiguous) {
      return { ok: false, code: 'AMBIGUOUS_VARIANTS', message: AMBIGUOUS_VARIANTS_COPY };
    }
    var wanted = splitKey(opts.scheme);

    /* one file, many schemes: keep only the one asked for, by its key (the
       code where the file has one, else the name, with its plan and option
       where they have columns of their own) */
    var keyed = tb.keyed;
    var schemeName = null, schemeCode = null, schemeNames = [], keys = [], ownVariant = noVariant();
    if (keyed) {
      var distinct = {};
      /* only rows that carry a date count: AMFI's files interleave section
         headings ("Open Ended Schemes(...)", the fund house's name) with
         the data, and a heading is not a scheme */
      for (var q = 0; q < body.length; q++) {
        var nm = rowKey(body[q], sc);
        if (nm && body[q].some(readsAsDate)) distinct[nm] = true;
      }
      keys = Object.keys(distinct);
      if (wanted.group) {
        body = body.filter(function (r) { return rowKey(r, sc) === wanted.group; });
        if (!body.length) {
          return { ok: false, code: 'NO_SUCH_SCHEME',
                   message: 'No rows in that file belong to “' + wanted.group + '”.' };
        }
      }
    }
    var sections = tb.sections, columns = tb.columns;
    if (tb.single) ownVariant = tb.single.variant;
    if (sections && wanted.section) {
      var sec = sections.filter(function (s) { return s.label === wanted.section; })[0];
      if (!sec) return { ok: false, code: 'NO_SUCH_SCHEME', message: 'No rows in that file belong to “' + wanted.section + '”.' };
      body = sec.rows; ownVariant = sec.variant;
    }
    var column = null;
    if (columns && wanted.column) {
      column = columns.filter(function (c) { return c.label === wanted.column; })[0];
      if (!column) return { ok: false, code: 'NO_SUCH_SCHEME', message: 'No column in that file holds “' + wanted.column + '”.' };
    }
    var many = (keyed && !wanted.group ? keys.length : 1) * (sections && !wanted.section ? sections.length : 1) * (columns && !column ? columns.length : 1);
    if (many > 1) {
      var plansOnly = !keyed || keys.length < 2;
      return { ok: false, code: 'MANY_SCHEMES', schemes: many,
               message: plansOnly ? 'That file holds ' + many + ' plans and options of the fund. Choose which one to analyse.'
                 : 'That file holds ' + many + ' different schemes. Choose which one to analyse.' };
    }
    if (keyed && (wanted.group || keys.length === 1)) {
      /* one scheme: name the analysis after it, and keep its code */
      /* the latest row names the scheme; every name it carried is kept */
      var latest = -Infinity, cells = '';
      for (var w = 0; w < body.length; w++) {
        var dcell = null;
        for (var dc = 0; dc < body[w].length && dcell === null; dc++) if (readsAsDate(body[w][dc])) dcell = body[w][dc];
        if (dcell === null) continue;
        var tw = toTimestamp(parseDateParts(dcell, true));
        var nmw = sc.name !== -1 ? cellText(body[w], sc.name) : '';
        if (nmw && schemeNames.indexOf(nmw) === -1) schemeNames.push(nmw);
        if (nmw && (isNaN(tw) || tw >= latest)) { schemeName = nmw; if (!isNaN(tw)) latest = tw; }
        if (!schemeCode && sc.code !== -1) schemeCode = cellText(body[w], sc.code) || null;
        if (!cells) cells = rowVariantText(body[w], sc);
      }
      if (!schemeName && sc.code !== -1) schemeName = schemeCode || wanted.group || keys[0];
      ownVariant = mergeVariant(variantOf(cells), variantOf(schemeName));
    }
    /* the ISINs on the rows used, so a statement can be checked against them */
    var isins = {};
    if (header) {
      header.forEach(function (h, c) {
        if (!/\bisin\b/.test(normHeader(h))) return;
        for (var b = 0; b < body.length; b++) { var code = cellText(body[b], c).toUpperCase(); if (ISIN_RE.test(code)) isins[code] = true; }
      });
    }

    /* Review v4 §5, and the reader's own override. Detection reads content
     * rather than headers, which handles most files -- but "most" is not all,
     * and a file it cannot read should ask rather than refuse. When the reader
     * has told us which columns to use, that answer wins outright. */
    var cols = pickColumns(body, header);
    if (column) cols.valueCol = column.col;
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
    /* the plan and option of what is read: its own column, section or rows
       first, then what the file's titles and its name say, where nothing in
       the file's choices says it */
    var colVariant = column ? column.variant : header ? variantOf(header[cols.valueCol]) : noVariant();
    var own = mergeVariant(colVariant, ownVariant);
    var siblings = (columns || []).map(function (c) { return c.variant; }).concat((sections || []).map(function (s) { return s.variant; }));
    var ctx = keyed && keys.length > 1 ? [] : [tb.titleVariant, tb.fileVariant];
    var variant = fillFrom([own].concat(siblings), ctx)[0];

    /* Review v4 §5: where day-first and month-first are both valid the reader
     * is asked once, and their answer arrives here. Detection still runs when
     * nothing has been asked, so a file whose dates can only be read one way
     * never raises a question at all. */
    /* What the reader sees the history called: a plan or option chosen out of
       a file by its full name, a fund house's file by the fund its title
       names; a file whose rows name the scheme keeps that name (report.scheme). */
    function displayName() {
      var lab = variantLabel(variant);
      if (column || (sections && wanted.section) || (keyed && (sc.plan !== -1 || sc.option !== -1 || sc.freq !== -1))) {
        var base = keyed ? (fundName(schemeName) || schemeName) : (tb.title ? fundName(tb.title) : '');
        return base && lab ? base + ' – ' + lab : (lab || base || null);
      }
      return !schemeName && tb.title ? fundName(tb.title) || null : null;
    }
    var dayFirstInfo = detectDayFirst(body, cols.dateCol);
    if (opts.dayFirst !== undefined) {
      dayFirstInfo = { dayFirst: !!opts.dayFirst, certain: true, answered: true };
    }
    var seen = {}, series = [], skipped = { badDate: 0, badValue: 0, duplicate: 0, blank: 0 };
    var examples = [];
    /* The strict standard, for words read off a PDF page: the date order is
       certain, every line with a date has its NAV and every NAV its date, no
       date carries two NAVs, and no day halves or doubles the NAV. Anything
       less and nothing is shown. */
    var strict = !!opts.strict, doubt = strict && !dayFirstInfo.certain;
    function doubtful() { return { ok: false, code: 'DOUBTFUL', message: opts.doubtCopy || PDF_COPY }; }

    for (var i = 0; i < body.length; i++) {
      var row = body[i];
      var rawDate = row[cols.dateCol], rawValue = row[cols.valueCol];
      if ((rawDate == null || rawDate === '') && (rawValue == null || rawValue === '')) { skipped.blank++; continue; }
      var t = readDate(rawDate, dayFirstInfo.dayFirst, cols.serialDates);
      var v = parseNumber(rawValue);
      if (strict && (isNaN(t) !== !(isFinite(v) && v > 0))) doubt = true;
      if (isNaN(t)) { skipped.badDate++; note(examples, i, header, rawDate, 'date not understood'); continue; }
      if (!isFinite(v) || v <= 0) { skipped.badValue++; note(examples, i, header, rawValue, 'value missing, zero or negative'); continue; }
      if (seen[t] !== undefined) { if (strict && series[seen[t]].v !== v) doubt = true; skipped.duplicate++; series[seen[t]].v = v; continue; }  /* last entry for a date wins */
      seen[t] = series.length;
      series.push({ t: t, v: v });
    }
    if (doubt) return doubtful();

    if (series.length < 2) {
      if (schemeName) {
        return {
          ok: false, code: 'ONE_DAY_ONLY',
          message: 'That file holds only ' + series.length + ' day of prices for “' + schemeName +
                   '”. It is a daily snapshot of every fund, not a history. Download the NAV ' +
                   'history for a date range instead, and this will work.'
        };
      }
      return {
        ok: false, code: 'TOO_FEW_ROWS',
        message: 'Only ' + series.length + ' usable row' + (series.length === 1 ? '' : 's') +
                 ' could be read from that file. Check that it holds a date column and a NAV column.'
      };
    }

    if (!keyed && skipped.duplicate >= series.length && series.length) {
      return {
        ok: false, code: 'MIXED_SERIES',
        message: 'That file looks like more than one ' + noun + ' stacked together: ' + skipped.duplicate +
                 ' rows repeat a date already seen, and no column names the ' + noun + ' they belong to. ' +
                 'Load a file for one ' + noun + ', or one that names the ' + noun + ' in a column.'
      };
    }

    series.sort(function (a, b) { return a.t - b.t; });
    if (strict && series.some(function (p, k) { return k > 0 && (p.v > series[k - 1].v * 2 || p.v < series[k - 1].v / 2); })) return doubtful();

    /* Belt and braces: a price never sits still for a whole file. If every
       value read is the same, the column read was not the price, whatever
       the rules above concluded, and nothing is worked out from it. */
    if (series.every(function (p) { return p.v === series[0].v; })) {
      return { ok: false, code: 'FLAT', headers: header ? header.map(function (h) { return String(h == null ? '' : h).trim(); }).filter(Boolean) : [],
               message: flatCopy(header) };
    }

    var warnings = [];
    if (!dayFirstInfo.certain) {
      warnings.push(dayFirstInfo.conflict
        ? 'This file mixes day-first and month-first dates. It has been read as day-first, so 05-08 means the 5th of August. Check the first and last dates below.'
        : 'Every date in this file could be read either way, so it has been read as day-first, so 05-08 means the 5th of August. Check the first and last dates below.');
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
        code: schemeCode,
        names: schemeNames,
        isins: Object.keys(isins),
        headers: header ? header.map(function (h) { return String(h == null ? '' : h).trim(); }).filter(Boolean) : [],
        headerFound: !!header,
        firstDate: series[0].t,
        lastDate: series[series.length - 1].t,
        spanYears: (series[series.length - 1].t - series[0].t) / (365.25 * 86400000),
        variant: variant,
        variantLabel: variantLabel(variant),
        fund: tb.title ? fundName(tb.title) : null,
        title: displayName(),
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
   * a value. But the files themselves say what they are: AMFI's export
   * carries "Net Asset Value", scheme names and plan words; NSE's carries
   * "Total Returns Index", index columns and never a scheme, so the words in
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

  /* ============================================ what kind of rows these are
   *
   * One reading of a row set, whatever door it came through: a file, a paste
   * or a drop. It reports what it saw; each slot decides what that means for
   * it. The statement slot asks "prices or payments?"; the index slot asks
   * "a fund's NAV, or an index, and which kind of index?".
   *
   * Prices or payments, the brief's rule: rows are price data when an ISIN
   * (INF and nine letters or digits) is in them; or a heading says net asset
   * value, NAV, scheme code, index, close or total returns; or four in five
   * of the would-be amounts are one figure (beside another column that
   * moves, so a bare list of equal SIP instalments is still read); or the
   * would-be amounts are whole numbers on every row beside a column carrying
   * decimals; or the rows run on consecutive trading days with no
   * transaction word in them. A transaction word (purchase, SIP, redemption,
   * switch...) or an Amount heading anywhere says the rows are payments, and
   * outweighs every one of those. */
  var TYPE_WORD = /^(purchase|additional purchase|new purchase|fresh purchase|sip\b|systematic|redemption|redeem|switch|stp\b|swp\b|transfer|withdraw|money (in|out)\b|worth today|buy\b|sell\b|bought|sold|lump\s*sum|dividend|idcw|reinvest|lateral shift|segregat|gift)/i;
  var AMOUNT_HEADING = /\bamount\b|\bamt\b/;
  var PRICE_HEADING = /\bnet asset value\b|\bnav\b|\bscheme code\b|\bindex\b|\bclos(e|ing)\b|\btotal returns?\b|\btri\b|\bsensex\b|\bnifty\b/;
  var TRI_HEADING = /\btotal returns? index\b|\btri\b/;
  var CLOSE_HEADING = /\bclos(e|ing)\b/;

  /* The row of headings: the last row with two or more words in it that
     comes before the first row holding a date. */
  var HEADING_WORD = /\b(date|amount|amt|units?|nav|net asset value|price|value|type|transaction|description|particulars|scheme|fund|folio|balance|isin|code|close|open|high|low|index|what happened|worth)\b/;
  function headingRow(rows) {
    var limit = Math.min(rows.length, HEADER_SEARCH_ROWS), at = -1, best = -1;
    for (var i = 0; i < limit; i++) {
      var r = rows[i] || [];
      if (r.some(function (c) { return readsAsDate(c); })) break;
      var cells = r.filter(function (c) { var t = String(c == null ? '' : c).trim(); return t && !isFinite(parseNumber(t)); });
      if (cells.length < 2) continue;
      /* the row with the most column words wins, so a fund's name or a folio
         line between the headings and the data is not taken for them */
      var score = cells.filter(function (c) { return HEADING_WORD.test(normHeader(c)); }).length;
      if (score >= best) { best = score; at = i; }
    }
    return at;
  }

  function rowSignals(rows) {
    var out = { header: null, typeWords: [], amountHeading: null, isin: null, priceHeadings: [],
                identical: false, wholeBesideDecimals: false, dailyRun: false, weeklyRun: false, reasons: [], dated: false, amfi: false,
                nav: false, tri: false, close: false };
    if (!rows || !rows.length) return out;
    var h = headingRow(rows);
    var header = h >= 0 ? rows[h] : null;
    var body = rows.slice(h + 1).filter(function (r) { return r && r.some(function (c) { return String(c == null ? '' : c).trim() !== ''; }); }).slice(0, 400);
    out.header = header;
    var plain = header ? header.map(normHeader) : [];

    plain.forEach(function (p, c) {
      var raw = String(header[c] == null ? '' : header[c]).trim();
      if (!p) return;
      if (AMOUNT_HEADING.test(p) && !out.amountHeading) out.amountHeading = raw;
      if (PRICE_HEADING.test(p)) out.priceHeadings.push(raw);
      if (/\bnet asset value\b|\bnav\b|\bscheme code\b|\bamfi code\b|\bisin\b/.test(p)) out.nav = true;
      if (TRI_HEADING.test(p)) out.tri = true;
      if (CLOSE_HEADING.test(p)) out.close = true;
    });
    if (header && schemeColumns(header).name !== -1 && !/\bindex name\b/.test(plain.join(' | '))) out.nav = true;
    /* AMFI's own pair of headings, on its history and its one-day NAVAll alike */
    out.amfi = plain.some(function (p) { return /\bscheme code\b/.test(p); }) && plain.some(function (p) { return /\bnet asset value\b/.test(p); });

    var width = 0;
    body.forEach(function (r) { if (r.length > width) width = r.length; });
    var seenWord = {};
    rows.slice(0, 420).forEach(function (r) {
      (r || []).forEach(function (cell) {
        var t = String(cell == null ? '' : cell).trim();
        if (!t) return;
        var isinHit = /\bINF[A-Z0-9]{9}\b/.exec(t.toUpperCase());
        if (isinHit && !out.isin) out.isin = isinHit[0];
      });
    });
    body.forEach(function (r) {
      r.forEach(function (cell) {
        var t = String(cell == null ? '' : cell).trim();
        if (t && t.length <= 40 && TYPE_WORD.test(t) && !seenWord[t.toLowerCase()]) { seenWord[t.toLowerCase()] = true; out.typeWords.push(t); }
      });
    });
    if (out.isin) out.nav = true;

    /* the date column, and the column a reader of payments would take as the amount */
    var dateCol = -1, best = 0, c, r;
    for (c = 0; c < width; c++) {
      var n = 0;
      for (r = 0; r < body.length; r++) if (readsAsDate(body[r][c])) n++;
      if (n > best) { best = n; dateCol = c; }
    }
    /* rows that carry data: a section heading on a line of its own is not one */
    var dataRows = body.filter(function (r) { return r.filter(function (c) { return String(c == null ? '' : c).trim() !== ''; }).length >= 2; });
    if (dateCol === -1 || best < Math.max(1, Math.ceil(dataRows.length * 0.5))) return finish();
    var distinctDates = {};
    body.forEach(function (row) { var t0 = toTimestamp(parseDateParts(row[dateCol], true)); if (!isNaN(t0)) distinctDates[t0] = true; });
    out.dated = Object.keys(distinctDates).length >= 2;
    var numeric = [];
    for (c = 0; c < width; c++) {
      if (c === dateCol) continue;
      var filled = 0, nums = [], dec = 0;
      for (r = 0; r < body.length; r++) {
        var cell = body[r][c];
        if (cell == null || String(cell).trim() === '') continue;
        filled++;
        var v = parseNumber(String(cell).replace(/^\((.*)\)$/, '-$1'));
        if (isFinite(v)) { nums.push(v); var dp = decimalPlaces(cell); if (dp > dec) dec = dp; }
      }
      if (filled && nums.length >= Math.ceil(filled * 0.6)) numeric.push({ col: c, nums: nums, decimals: dec });
    }
    var amountCol = -1;
    plain.forEach(function (p, k) { if (amountCol === -1 && k !== dateCol && AMOUNT_HEADING.test(p)) amountCol = k; });
    if (amountCol === -1) {
      var order = [];
      for (c = dateCol + 1; c < width; c++) order.push(c);
      for (c = 0; c < dateCol; c++) order.push(c);
      for (var o = 0; o < order.length && amountCol === -1; o++) {
        if (numeric.some(function (x) { return x.col === order[o]; })) amountCol = order[o];
      }
    }
    var cand = numeric.filter(function (x) { return x.col === amountCol; })[0];
    var others = numeric.filter(function (x) { return x.col !== amountCol; });
    if (cand && cand.nums.length >= 3) {
      var counts = {}, top = 0;
      cand.nums.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; if (counts[v] > top) top = counts[v]; });
      var moves = others.some(function (x) { var first = x.nums[0]; return x.nums.some(function (v) { return v !== first; }); });
      out.identical = top >= cand.nums.length * 0.8 && moves;
      out.wholeBesideDecimals = cand.nums.every(function (v) { return Math.floor(v) === v; }) && others.some(function (x) { return x.decimals >= 2; });
    }
    /* consecutive trading days: five or more dates, four in five of the gaps
       between them no longer than a weekend and a holiday */
    var days = {};
    body.forEach(function (row) { var t = toTimestamp(parseDateParts(row[dateCol], true)); if (!isNaN(t)) days[t] = true; });
    var ts = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
    if (ts.length >= 5) {
      var short = 0;
      for (var g = 1; g < ts.length; g++) if ((ts[g] - ts[g - 1]) / 86400000 <= 4) short++;
      out.dailyRun = short >= (ts.length - 1) * 0.8 && !out.typeWords.length;
    }
    /* a value on the same weekday every week, moving by small decimals: a
       weekly sample of a price, which a fund house's page and a hand-made
       index file both give; a weekly SIP is a round amount that stays put */
    if (ts.length >= 8 && !out.typeWords.length && cand && cand.decimals >= 2) {
      var weekly = 0;
      for (var w = 1; w < ts.length; w++) { var dd = (ts[w] - ts[w - 1]) / 86400000; if (dd >= 5 && dd <= 9) weekly++; }
      var distinct = {};
      cand.nums.forEach(function (v) { distinct[v] = true; });
      out.weeklyRun = weekly >= (ts.length - 1) * 0.8 && Object.keys(distinct).length >= cand.nums.length * 0.8;
    }
    return finish();

    function finish() {
      if (out.isin) out.reasons.push('an ISIN (' + out.isin + ')');
      if (out.priceHeadings.length) out.reasons.push('a price heading (' + out.priceHeadings.slice(0, 3).join(', ') + ')');
      if (out.identical) out.reasons.push('the same figure on four rows in five');
      if (out.wholeBesideDecimals) out.reasons.push('whole numbers beside a column with decimals');
      if (out.dailyRun) out.reasons.push('one row for each trading day');
      if (out.weeklyRun) out.reasons.push('one value a week, moving by decimals');
      return out;
    }
  }

  /* The statement slot's question. Prices are a dated series: a holdings
     snapshot carries ISINs and NAVs too, but no column of dates, and it is
     left for the holdings reader. */
  function pricesNotPayments(rows) {
    var s = rowSignals(rows);
    var statement = s.typeWords.length > 0 || !!s.amountHeading;
    /* After review: "the same figure four rows in five" and "whole numbers
       beside decimals" describe a scheme code beside a NAV, and equally a SIP
       amount beside its units. On their own they refused real statements
       pasted without headings, so they count only beside an ISIN, a price
       heading or a run of trading days, which AMFI's and NSE's rows always
       carry. AMFI's own headings (Scheme Code, Net Asset Value) mark price
       data even on a one-day file such as NAVAll. */
    var decisive = !!s.isin || s.priceHeadings.length > 0 || s.dailyRun || s.weeklyRun;
    return { prices: !statement && ((s.dated && decisive) || s.amfi), signals: s };
  }

  /* The index slot's question: a fund's NAV file is refused; a total return
     index is taken as one; a file with a Close and no total returns column
     is a price index; anything else (a bare date and value) is not known. */
  function indexFileKind(rows, fileName) {
    var s = rowSignals(rows);
    var guess = guessDataKind(rows, fileName);
    if (s.nav || (guess.kind === 'nav' && !s.tri && !s.close)) return { nav: true, signals: s };
    return { nav: false, kind: s.tri ? 'TRI' : s.close ? 'PRICE' : null, signals: s };
  }

  /* ======================================== step 3: an index, or a fund?
   *
   * Any layout: an NSE or BSE download, a sheet the reader made, values copied
   * from a website. A fund's word in the headings, a name column or the
   * file's name makes it a fund's file, an index fund's included: Fund, NAV,
   * Net Asset Value, Scheme, Growth, Direct, Regular, IDCW, a scheme code
   * column, an ISIN (INF...). An index's word with no fund's word makes it an
   * index: Index, TRI, Total Returns, Close, Nifty, Sensex, BSE, NSE. Neither,
   * and the reader is asked. The kind of index is read from its columns: a
   * Total Returns (or TRI) column is the total return index; a Close column
   * without one is the price index. NSE's "NIFTY Growth Sectors 15" is an
   * index's name, so "Growth Sectors" is not read as a fund's Growth. */
  var FUND_MARKS = [[/\bfunds?\b/, 'Fund'], [/\bnav\b/, 'NAV'], [/\bnet asset value\b/, 'Net Asset Value'], [/\bschemes?\b/, 'Scheme'],
    [/\bgrowth\b(?! sectors?\b)/, 'Growth'], [/\bdirect\b/, 'Direct'], [/\bregular\b/, 'Regular'], [/\bidcw\b/, 'IDCW']];
  var INDEX_MARKS = [[/\bindex\b/, 'Index'], [/\btri\b/, 'TRI'], [/\btotal returns?\b/, 'Total Returns'], [/\bclos(e|ing)\b/, 'Close'],
    [/\bnifty\b/, 'Nifty'], [/\bsensex\b/, 'Sensex'], [/\bbse\b/, 'BSE'], [/\bnse\b/, 'NSE']];
  function indexOrFund(rows, fileName) {
    var out = { verdict: 'unknown', kind: null, fund: [], index: [] };
    rows = rows || [];
    /* words as the headings are read everywhere else: TotalReturnsIndex is "total returns index" */
    var plainOf = function (t) { return normHeader(String(t == null ? '' : t).replace(/[\u2013\u2014]/g, ' ')); };
    var filled = function (c) { return String(c == null ? '' : c).trim() !== ''; };
    var isText = function (c) { var t = String(c == null ? '' : c).trim(); return !!t && !readsAsDate(t) && !isFinite(parseNumber(t)); };
    var h = headingRow(rows), header = h >= 0 ? rows[h] : null, texts = [];
    /* the headings: the heading row and any title above it */
    rows.slice(0, h + 1).forEach(function (r) { (r || []).forEach(function (c) { if (filled(c)) texts.push(c); }); });
    /* a heading on a line of its own between the rows, and a name column */
    var body = rows.slice(h + 1, h + 1 + 400), width = 0;
    body.forEach(function (r) { if (r && r.length > width) width = r.length; });
    body.forEach(function (r) { var cells = (r || []).filter(filled); if (cells.length === 1 && isText(cells[0])) texts.push(cells[0]); });
    for (var c = 0; c < width; c++) {
      var n = 0, words = 0, seen = {};
      body.forEach(function (r) { var v = r ? r[c] : null; if (!filled(v)) return; n++; if (isText(v)) { words++; seen[String(v).trim()] = true; } });
      if (n && words >= n * 0.5) Object.keys(seen).slice(0, 60).forEach(function (t) { texts.push(t); });
    }
    var all = texts.map(plainOf), name = plainOf(String(fileName == null ? '' : fileName).replace(/\.[a-z0-9]{2,5}$/i, ''));
    if (name) all.push(name);
    function hits(marks, side) { marks.forEach(function (m) { if (all.some(function (t) { return m[0].test(t); })) out[side].push(m[1]); }); }
    hits(FUND_MARKS, 'fund'); hits(INDEX_MARKS, 'index');
    var heads = (header || []).map(plainOf);
    if (heads.some(function (t) { return /\bcode\b/.test(t); })) out.fund.push('a scheme code column');
    if (heads.some(function (t) { return /\bisin\b/.test(t); }) ||
        rows.slice(0, 420).some(function (r) { return (r || []).some(function (v) { return /\bINF[A-Z0-9]{9}\b/.test(String(v == null ? '' : v).toUpperCase()); }); })) out.fund.push('an ISIN');
    if (out.fund.length) { out.verdict = 'fund'; return out; }
    if (out.index.length) {
      out.verdict = 'index';
      out.kind = heads.some(function (t) { return /\btotal returns?\b|\btri\b/.test(t); }) ? 'TRI'
        : heads.some(function (t) { return /\bclos(e|ing)\b/.test(t); }) ? 'PRICE' : null;
    }
    return out;
  }

  /* ============================================== a whole page, pasted
   *
   * A reader on a phone selects all on a fund house's NAV history page and
   * pastes it: menus, headings, a "NAV Range" or 52-week table, the daily
   * table, a footer. Only the daily table is wanted. Each pasted line is cut
   * into cells at tabs or at runs of two or more spaces (a table copied from
   * a page keeps its cells apart that way; a line of prose does not). A line
   * is a row of the daily table when it holds a date and a positive number
   * with decimals; a line of words that names the columns, or a plan or
   * option over them, is kept as a heading so side-by-side Direct and
   * Regular columns reach the plan picker; every other line (a menu item, a
   * sentence, a summary's figure) is dropped. The rows are then read by the
   * same reading as any file, held to the strict standard: a date order in
   * doubt, a line with a date and no NAV, or a day that halves or doubles the
   * NAV, and nothing is shown. */
  var PAGE_COPY = 'The pasted page could not be read with certainty, so nothing was taken from it. Copy only the NAV table (the rows of dates and NAVs, with their headings), or download the file instead.';
  var PAGE_NONE_COPY = 'Nothing in the pasted text reads as a row of a date and a NAV. Copy the NAV table itself (the rows of dates and NAVs, with their headings) and paste it, or download the file instead.';
  /* a line of heading words set one space apart ("Date NAV", "Date Direct Growth Regular Growth") */
  var HEAD_WORD = /^(date|nav|navs|net|asset|value|values|rs|inr|per|unit|price|close|closing|index|tri|total|returns?|direct|regular|plan|option|growth|idcw|dividend|payout|reinvestment|daily|weekly|monthly|quarterly|annual|scheme|name|sale|repurchase|and|&|of|in)$/;
  var PAGE_NOISE = /^(home|menu|login|log in|sign in|register|search|download|print|share|back|next|previous|close|help|faq|contact|about|invest now|know more|read more|view all|select|choose|apply|reset|submit)$/i;
  function looksLikeTable(rows) {
    if (!rows || rows.length < 3) return false;
    var found = findHeader(rows);
    var cols = pickColumns(found.body, found.header);
    if (cols.dateCol === -1 || cols.valueCol === -1) return false;
    /* most data rows carry both: a page's lines mostly carry neither */
    var dated = 0, filled = 0;
    found.body.forEach(function (r) { if (r && r.some(filledCell)) { filled++; if (dataRow(r)) dated++; } });
    return filled > 0 && dated >= filled * 0.8;
  }
  function pageCells(line) {
    var t = String(line == null ? '' : line).replace(/ /g, ' ').replace(/[|;]/g, '\t').trim();
    if (!t) return [];
    var cells = /\t/.test(t) ? t.split(/\t+/) : t.split(/\s{2,}/);
    cells = cells.map(function (c) { return c.trim(); }).filter(Boolean);
    /* "01-Jan-2025 45.1234" on one line with one space: a date then a number;
       "Date NAV" on one line: the headings */
    if (cells.length === 1) {
      var ws = cells[0].split(/\s+/);
      if (ws.length >= 2 && ws.length <= 8 && ws.every(function (w) { return HEAD_WORD.test(w.toLowerCase().replace(/[()\[\].:,]/g, '')); }) && /^date$/i.test(ws[0])) {
        var out = [], cur = '', VAL = /^(nav|navs|net|asset|value|values|close|closing|index|tri|total|returns?|price|sale|repurchase)$/i, OPEN = /^(nav|navs|net|close|closing|index|tri|total|price|value|values|sale|repurchase)$/i, LINK = /^(net|total|per|asset|and|&|sale|repurchase)$/i;
        ws.forEach(function (w) {
          /* a new column starts at Date, at a plan word, or at a value word
             once the heading so far already names a value ("NAV Direct NAV Regular") */
          var prev = cur.split(' ').pop(), hasVal = cur.split(' ').some(function (x) { return VAL.test(x); });
          if (!cur || /^(date|direct|regular)$/i.test(w) || (OPEN.test(w) && (/^date$/i.test(cur) || (hasVal && !LINK.test(prev))))) { if (cur) out.push(cur); cur = w; }
          else cur += ' ' + w;
        });
        if (cur) out.push(cur);
        return out;
      }
      var parts = cells[0].split(/\s+/);
      if (parts.length >= 2 && parts.length <= 4 && readsAsDate(parts[0]) && parts.slice(1).every(function (p) { return isFinite(parseNumber(p)); })) return parts;
      var m = /^(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})\s+(.+)$/.exec(cells[0]);
      if (m) { var rest = m[2].split(/\s+/); if (rest.every(function (p) { return isFinite(parseNumber(p)); })) return [m[1]].concat(rest); }
    }
    return cells;
  }
  function pageRows(text) {
    var lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    var out = [], dropped = 0, kept = 0, headings = 0;
    lines.forEach(function (line) {
      var cells = pageCells(line);
      if (!cells.length) return;
      var isData = cells.some(readsAsDate) && cells.some(function (c) { return !readsAsDate(c) && isFinite(parseNumber(c)) && parseNumber(c) > 0; });
      if (isData) {
        /* a date with its NAV, nothing else on the line but numbers or a name */
        out.push(cells); kept++; return;
      }
      var words = cells.filter(textCell);
      if (!words.length || cells.length !== words.length) { dropped++; return; }
      var joined = words.map(normHeader).join(' ');
      if (words.every(function (w) { return PAGE_NOISE.test(w.trim()); })) { dropped++; return; }
      /* the daily table's headings, a plan or option over its columns, or a
         summary's heading (kept so the reading can drop the summary's rows) */
      if (looksLikeHeader(cells) || (cells.length >= 2 && cells.every(function (c) { return variantKnown(variantOf(c)) || DATE_HEADERS.indexOf(normHeader(c)) !== -1 || /\bdate\b/.test(normHeader(c)); })) ||
          SUMMARY_HEAD.test(joined) || (cells.length === 1 && (variantKnown(variantOf(cells[0])) || /\bfund\b|\bscheme\b/.test(joined)) && cells[0].length <= 120)) {
        out.push(cells); headings++; return;
      }
      dropped++;
    });
    return { rows: out, kept: kept, dropped: dropped, headings: headings };
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
    parseDateParts: parseDateParts, readsAsDate: readsAsDate,
    toTimestamp: toTimestamp,
    rowsToSeries: rowsToSeries,
    columnSummary: columnSummary,
    detectDayFirst: detectDayFirst,
    listSchemes: listSchemes,
    listSchemesText: listSchemesText,
    guessDataKind: guessDataKind,
    normHeader: normHeader,
    schemeColumns: schemeColumns,
    rowSignals: rowSignals,
    headingRow: headingRow,
    pricesNotPayments: pricesNotPayments,
    indexFileKind: indexFileKind,
    indexOrFund: indexOrFund,
    flatCopy: flatCopy,
    ISIN_RE: ISIN_RE,
    sliceSeries: sliceSeries,
    parseSeriesText: parseSeriesText,
    variantOf: variantOf,
    variantLabel: variantLabel,
    variantKnown: variantKnown,
    variantsDiffer: variantsDiffer,
    PDF_COPY: PDF_COPY, PDF_SCANNED_COPY: PDF_SCANNED_COPY,
    mergeVariant: mergeVariant,
    fileVariant: fileVariant,
    fundName: fundName,
    tableOf: tableOf,
    AMBIGUOUS_VARIANTS_COPY: AMBIGUOUS_VARIANTS_COPY,
    SNAPSHOT_COPY: SNAPSHOT_COPY,
    pageRows: pageRows, looksLikeTable: looksLikeTable, PAGE_COPY: PAGE_COPY, PAGE_NONE_COPY: PAGE_NONE_COPY
  };
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.PRCParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
