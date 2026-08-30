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

    var parsedFiles = [], schemeQuestion = null, ambiguous = null;

    for (var i = 0; i < list.length; i++) {
      var rows = rowsFrom(list[i]);
      if (!rows || rows.length < 2) {
        return refuse('NO-DATES', MESSAGES.noDates);
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
      var res = P.rowsToSeries(rows, opts);

      if (!res.ok) {
        if (res.code === 'MANY_SCHEMES' && many) {
          schemeQuestion = schemeQuestion || { file: list[i].name, count: many.schemes.length,
                                               groups: groupSchemes(many.schemes) };
          continue;
        }
        return refuse(res.code === 'NO_COLUMNS' ? 'NO-DATES' : res.code,
                      res.code === 'NO_COLUMNS' ? MESSAGES.noDates : res.message);
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
    if (!parsedFiles.length) return refuse('NO-DATES', MESSAGES.noDates);

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

  function nameOf(file, res) {
    if (res.report && res.report.scheme) return res.report.scheme;
    return String(file.name || '').replace(/\.[^.]+$/, '');
  }

  /* -------------------------------------------------------- the messages
   * Section 5, transcribed. Each one says what happened and what to do. */
  var MESSAGES = {
    noDates: 'I could not find a column of dates in this file. One column should be dates and one ' +
             'NAV. A screenshot or PDF will not work; download the table.',

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
    read: read, stitch: stitch, gapsIn: gapsIn, groupSchemes: groupSchemes,
    rowsFrom: rowsFrom, jsonRows: jsonRows, firstAmbiguousDate: firstAmbiguousDate,
    MESSAGES: MESSAGES, GAP_DAYS: GAP_DAYS
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimUpload = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
