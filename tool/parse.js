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

  function looksLikeHeader(row) {
    if (!row) return false;
    var text = row.join(' ').toLowerCase();
    var named = DATE_HEADERS.concat(VALUE_HEADERS).some(function (h) { return text.indexOf(h) !== -1; });
    var mostlyText = row.filter(function (c) { return c !== '' && isNaN(parseNumber(c)); }).length >= Math.ceil(row.length / 2);
    return named && mostlyText;
  }

  function pickColumns(rows, headerRow) {
    var dateCol = -1, valueCol = -1;
    if (headerRow) {
      var lower = headerRow.map(function (h) { return String(h).toLowerCase().trim(); });
      lower.forEach(function (h, i) {
        if (dateCol === -1 && DATE_HEADERS.indexOf(h) !== -1) dateCol = i;
        if (valueCol === -1 && VALUE_HEADERS.indexOf(h) !== -1) valueCol = i;
      });
      if (dateCol === -1) lower.forEach(function (h, i) { if (dateCol === -1 && /date/.test(h)) dateCol = i; });
      if (valueCol === -1) lower.forEach(function (h, i) {
        if (valueCol === -1 && /(nav|close|value|price|index)/.test(h) && i !== dateCol) valueCol = i;
      });
    }
    if (dateCol === -1 || valueCol === -1) {
      /* fall back to shape: the column that parses as dates, and the last
         column that parses as positive numbers */
      var probe = rows.slice(0, 40);
      var width = Math.max.apply(null, probe.map(function (r) { return r.length; }));
      for (var c = 0; c < width; c++) {
        var dates = 0, nums = 0;
        for (var r = 0; r < probe.length; r++) {
          var cell = probe[r][c];
          if (cell == null || cell === '') continue;
          if (toTimestamp(parseDateParts(cell, true)) === toTimestamp(parseDateParts(cell, true)) &&
              !isNaN(toTimestamp(parseDateParts(cell, true)))) dates++;
          else if (!isNaN(parseNumber(cell))) nums++;
        }
        if (dateCol === -1 && dates >= Math.max(2, probe.length * 0.6)) dateCol = c;
        else if (nums >= Math.max(2, probe.length * 0.6)) valueCol = c;
      }
    }
    return { dateCol: dateCol, valueCol: valueCol };
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
      var t = toTimestamp(parseDateParts(body[i][cols.dateCol], dayFirst));
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
    var header = looksLikeHeader(rows[0]) ? rows[0] : null;
    var body = header ? rows.slice(1) : rows;

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
      var t = toTimestamp(parseDateParts(rawDate, dayFirstInfo.dayFirst));
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
    parseNumber: parseNumber,
    parseDateParts: parseDateParts,
    toTimestamp: toTimestamp,
    rowsToSeries: rowsToSeries,
    columnSummary: columnSummary,
    listSchemes: listSchemes,
    listSchemesText: listSchemesText,
    sliceSeries: sliceSeries,
    parseSeriesText: parseSeriesText
  };
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.PRCParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
