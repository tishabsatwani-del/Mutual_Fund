/* Where You Stand: reading a statement laid out in scheme blocks.
 *
 * A fund house's or a registrar's own transaction statement is not the CAS.
 * It comes as one block per scheme: a line naming the scheme, a table of its
 * transactions under headings like these,
 *
 *   NAV Date  Transaction Details  Amount  NAV  Price  Number of Units  Balance Units
 *             Opening Balance as on 27/04/2026                    -        270.853
 *   27/04/2026  Purchase Systematic - Instalment 7/301  1,499.93  34.9844  34.9844  42.874  313.727
 *               Gross Amount: Rs.1500/-; Stamp Duty 0.07 charges Levied
 *   Market Value as on 16-OCT-2026 : 17,606.42
 *
 * and, at the end, an Account Summary (scheme, last NAV date, NAV, unit
 * balance, cost value, market value, a grand total). KFintech's "Partial
 * Transaction Listing" is one of these; the same shape comes from every
 * registrar and fund house as a PDF, a workbook or text. This file reads that
 * shape, from rows of cells: a PDF's words placed under their headings
 * (pdfrows.js, placedRows), or a workbook's or a CSV's rows as they are.
 *
 * The one rule that lets any such layout in (the owner's word, November 2026):
 * for every scheme, the opening units plus every transaction's units must
 * equal the closing units exactly, to the thousandth of a unit the statement
 * prints, and every running balance it prints must follow from the line
 * before. A scheme that does not add up is named and not read. A statement
 * without running balances or an opening and a closing balance has no such
 * proof, and is not read here at all.
 *
 * What is taken from each line: the date (dd/mm/yyyy in the rows, DD-MON-YYYY
 * in the headings), the description over as many lines as it wraps (the date
 * sometimes on a later line than the first words), the amount, the NAV, the
 * units, the balance. Money out of pocket for a purchase is the gross amount:
 * where the description says "Gross Amount: Rs.1500/-; Stamp Duty 0.07", the
 * reader paid 1,500 and the amount column shows the 1,499.93 that bought
 * units; a stamp duty line of its own is folded in the same way (cas.js).
 * Nothing depends on the rupee sign: this PDF's text layer does not carry it.
 * Every page after the Account Summary (a blank transaction form, the
 * instructions) is ignored.
 *
 * A Partial Transaction Listing, by its own note, lists only some of the
 * transactions in the folio, so no yearly rate can be honest; the caller is
 * told so (partial: true) and shows the cost value, the market value and the
 * gain so far from the Account Summary instead. Any scheme that starts with
 * units bought earlier is reported in openings, as the CAS reader does.
 *
 * No DOM, no clock, no network. Pure functions on rows of cells.
 */
(function (root) {
  'use strict';
  var P = (typeof require === 'function') ? require('./parse.js') : root.PRCParse;

  /* ------------------------------------------------------------------ cells */
  function cell(c) { return String(c == null ? '' : c).replace(/\s+/g, ' ').trim(); }
  function rowText(r) { return (r || []).map(cell).filter(Boolean).join(' '); }
  function norm(s) { return P.normHeader(s); }
  /* "1,23,456.78", "(20,000.00)", "-41.333", "Rs.1500/-": the number, negative when bracketed or signed */
  function num(s) {
    var t = cell(s), neg = false, w = /^\((.*)\)$/.exec(t);
    if (w) { neg = true; t = w[1]; }
    t = t.replace(/^(?:INR|Rs\.?|₹)\s*/i, '').replace(/\/-$/, '').replace(/[,\s₹]/g, '').replace(/^−/, '-');
    if (!/^-?\d*\.?\d+$/.test(t)) return NaN;
    var n = parseFloat(t);
    return neg ? -n : n;
  }
  function lastNumber(text) {
    var m = String(text || '').match(/\(?-?[\d,]*\.\d+\)?|\(?-?\d[\d,]*\)?/g), out = NaN;
    (m || []).forEach(function (x) { var n = num(x); if (isFinite(n)) out = n; });
    return out;
  }
  /* a cell that is a date and nothing else: 27/04/2026, 16-Oct-2026, 2026-04-27 */
  var DATE_CELL = /^(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{4}|\d{2})|\d{1,2}[\/\-. ][A-Za-z]{3,9}[\/\-. ,]+\d{4}|\d{4}-\d{2}-\d{2})$/;
  var DATE_IN = /(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{4}|\d{2})|\d{1,2}[\/\-. ][A-Za-z]{3,9}[\/\-. ,]+\d{4}|\d{4}-\d{2}-\d{2})/;
  function dateOf(s, dayFirst) {
    var t = cell(s);
    if (!DATE_CELL.test(t)) return NaN;
    return P.toTimestamp(P.parseDateParts(t, dayFirst !== false));
  }
  function dateIn(text) { var m = DATE_IN.exec(String(text || '')); return m ? dateOf(m[1]) : NaN; }
  function thou(x) { return Math.round(x * 1000); }
  function fmtUnits(u) { return Number(u).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }

  /* --------------------------------------------------------------- headings */
  var H_DATE = /\bdate\b/, H_DESC = /\btransaction\b|\bdetails?\b|\bdescription\b|\bparticulars?\b|\bnarration\b|\btype\b|\bnature\b/;
  var H_AMOUNT = /\bamount\b|\bamt\b/, H_NAV = /\bnav\b|\bprice\b|\brate\b/, H_UNITS = /\bunits?\b|\bquantity\b|\bqty\b/;
  var H_BAL = /\bbalance\b|\bcumulative\b|\brunning\b|\bclosing\b/, H_FUND = /\bscheme\b|\bfund\b|\bfolio\b/;
  var H_COST = /\bcost\b|\binvested\b|\bpurchase value\b|\bamount invested\b/, H_VALUE = /\bmarket value\b|\bcurrent value\b|\bvaluation\b|\bvalue\b/;
  function columnsOf(row) {
    var cols = { date: -1, desc: -1, amount: -1, nav: -1, units: -1, bal: -1, fund: -1 }, named = 0;
    row.forEach(function (c, i) {
      var h = norm(c);
      if (!h) return;
      named++;
      if (cols.date === -1 && H_DATE.test(h) && !/\bnav date\b.*\bnav\b/.test(h)) cols.date = i;
      else if (cols.bal === -1 && H_BAL.test(h) && H_UNITS.test(h)) cols.bal = i;
      else if (cols.units === -1 && H_UNITS.test(h) && !H_BAL.test(h)) cols.units = i;
      else if (cols.amount === -1 && H_AMOUNT.test(h) && !/\bnet\b|\bgross\b/.test(h)) cols.amount = i;
      else if (cols.nav === -1 && H_NAV.test(h)) cols.nav = i;
      else if (cols.desc === -1 && H_DESC.test(h)) cols.desc = i;
      else if (cols.fund === -1 && H_FUND.test(h)) cols.fund = i;
      else if (cols.bal === -1 && H_BAL.test(h)) cols.bal = i;
    });
    /* a transaction table: a date, an amount, units, and a balance column or none (the opening
       and closing lines then carry the proof); a scheme column means a plain table, not a block */
    var ok = named >= 3 && cols.date >= 0 && cols.amount >= 0 && cols.units >= 0 && cols.fund === -1;
    return ok ? cols : null;
  }
  function summaryColumnsOf(row) {
    var cols = { name: -1, date: -1, nav: -1, units: -1, cost: -1, value: -1 }, named = 0;
    row.forEach(function (c, i) {
      var h = norm(c);
      if (!h) return;
      named++;
      if (cols.name === -1 && /\bscheme\b|\bfund\b/.test(h) && !H_VALUE.test(h)) cols.name = i;
      else if (cols.date === -1 && H_DATE.test(h)) cols.date = i;
      else if (cols.units === -1 && H_UNITS.test(h)) cols.units = i;
      else if (cols.cost === -1 && H_COST.test(h)) cols.cost = i;
      else if (cols.value === -1 && H_VALUE.test(h) && !/\bcost\b/.test(h)) cols.value = i;
      else if (cols.nav === -1 && H_NAV.test(h)) cols.nav = i;
    });
    return named >= 3 && cols.name >= 0 && cols.units >= 0 && (cols.cost >= 0 || cols.value >= 0) ? cols : null;
  }

  /* --------------------------------------------------------------- the lines */
  var SCHEME_LINE = /^\s*scheme(?:\s*name)?\s*[:\-]\s*(.+)$/i;
  var OPENING = /\bopening\s+(?:unit\s+)?balance\b/i, CLOSING = /\bclosing\s+(?:unit\s+)?balance\b/i;
  var NAV_AS_ON = /\bNAV\s+(?:as\s+on|on|dated?)\s*:?\s*(\d{1,2}[\/\-. ][A-Za-z]{3,9}[\/\-. ,]+\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\s*:?\s*(?:\(\s*\)|INR|Rs\.?|₹)?\s*([\d,]*\.\d+)/i;
  var VALUE_AS_ON = /\b(?:market\s+)?value\s+(?:as\s+on|on|dated?)\s*:?\s*(\d{1,2}[\/\-. ][A-Za-z]{3,9}[\/\-. ,]+\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i;
  var ISIN = /\bISIN\s*[:\-]?\s*([A-Z]{2}[A-Z0-9]{9}\d)\b/i;
  var FOLIO = /^\s*folio\s*(?:no\.?|number)?\s*[:\-]?\s*(\S.*?)(?:\s+(?:statement|pan|kyc|page)\b.*)?$/i;
  var PERIOD = /\b(?:from|period)\s*:?\s*(\d{1,2}[\/\-. ][A-Za-z]{3,9}[\/\-. ,]+\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\s+(?:to|-|–)\s+(\d{1,2}[\/\-. ][A-Za-z]{3,9}[\/\-. ,]+\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i;
  var PARTIAL = /\bpartial\s+transaction\s+listing\b|\bonly\s+a\s+listing\s+of\s+transactions\b|\bnot\s+the\s+account\s+statement\b/i;
  var SUMMARY_TITLE = /^\s*(?:account\s+)?summary\b|\bsummary\s+of\s+(?:holdings|investments)\b|\bportfolio\s+summary\b/i;
  var TOTAL_ROW = /\b(?:grand\s+)?total\b/i;
  /* the words a description starts with: a line of nothing but these, before a dated line, is its first words */
  var TXN_START = /^(purchase|redemption|redeem|switch|sip|stp|swp|systematic|subscription|allotment|dividend|idcw|reinvest|sale|lateral|transfer|bonus|conversion|segregat|initial|additional)/i;
  var OUT_WORD = /\bredemption\b|\bredeem\b|\bswitch[\s-]*out\b|\bswp\b|\bwithdraw/i;
  var FOOTER = /\bavailable\s+units\b|\bmarket\s+value\b|\bentry\s+load\b|\bexit\s+load\b|\bload\s+structure\b|\bnav\s+as\s+on\b|\bplease\b|\bkindly\b|\bnote\s*:|\bdisclaimer\b/i;
  var IDCW_WORD = /\bidcw\b|\bdividend\b|\bincome\s+distribution\b/i;
  /* "Gross Amount: Rs.1500/-; Stamp Duty 0.07 charges Levied": the gross, and the duty */
  var INLINE_GROSS = /\bgross\s+amount\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]*\.?\d+)\s*(?:\/-)?/i;
  var INLINE_STAMP = /\bstamp\s+duty\s*(?:charges?)?\s*:?\s*(?:of\s+)?(?:INR|Rs\.?|₹)?\s*([\d,]*\.?\d+)/i;
  var STAMP_WORD = /\bstamp\s*duty\b/i, STT_WORD = /\bSTT\b|securities\s+transaction\s+tax/i, TDS_WORD = /\bTDS\b|tax\s+deducted/i;
  function inlineStamp(desc) {
    var g = INLINE_GROSS.exec(desc || ''), s = INLINE_STAMP.exec(desc || '');
    var gross = g ? num(g[1]) : NaN, stamp = s ? num(s[1]) : NaN;
    if (!isFinite(gross) && !isFinite(stamp)) return null;
    return { gross: isFinite(gross) ? gross : null, stamp: isFinite(stamp) ? stamp : null };
  }

  var DOWNLOAD = ' For your full return, download your Consolidated Account Statement (CAS) from CAMS or KFintech: choose "Detailed" and the period from your first investment.';
  var MESSAGES = {
    /* the owner's sentence (November 2026), shown instead of a yearly rate */
    partial: 'This file lists only some of your transactions, so no yearly rate is shown.' + DOWNLOAD,
    units: function (name, expected, closing) {
      return name + ' could not be read with certainty: its opening units plus every transaction come to ' + fmtUnits(expected) + ', but the statement closes it at ' + fmtUnits(closing) + '. No figure is shown for this scheme.';
    },
    chain: function (name, when, got, want) {
      return name + ' could not be read with certainty: on ' + when + ' its running balance reads ' + fmtUnits(got) + ' where the line before plus that line’s units come to ' + fmtUnits(want) + '. No figure is shown for this scheme.';
    },
    nothing: 'This statement names its schemes but no transaction with its units and running balance could be read under them, so nothing is shown. Download the detailed Consolidated Account Statement (CAS) from CAMS or KFintech instead.',
    allFailed: 'No scheme in this statement adds up: for each one, the opening units plus every transaction should equal its closing units, and they do not, so nothing is shown.'
  };

  /* ------------------------------------------------------------------ read */
  function read(input) {
    var rows = (input || []).map(function (r) { return (r || []).map(cell); });
    var all = rows.map(rowText).join(' \n ');
    var partial = PARTIAL.test(all);
    var period = null, pm = PERIOD.exec(all);
    if (pm) { var pf = dateOf(pm[1]), pt = dateOf(pm[2]); if (isFinite(pf) && isFinite(pt)) period = { from: pf, to: pt }; }

    var schemes = [], cur = null, cols = null, folio = '', pendingName = null, pendingDesc = [], summary = null, scols = null, done = false, layout = false;
    function close() { if (cur) { finishRows(cur); schemes.push(cur); } cur = null; cols = null; pendingDesc = []; }
    function start(name, line, named) {
      close();
      cur = { name: name, named: !!named, folio: folio, isin: '', opening: null, openingT: null, closing: null, nav: null, navDate: null, value: null, valueDate: null, rows: [], line: line, balCol: false };
    }
    function finishRows(sc) {
      /* the words of the lines a description wrapped onto, and the inline stamp duty in them */
      sc.rows.forEach(function (r) {
        r.desc = (r.before.concat([r.desc]).concat(r.after)).map(cell).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        delete r.before; delete r.after;
      });
    }
    for (var i = 0; i < rows.length && !done; i++) {
      var r = rows[i], text = rowText(r), m;
      if (!text) { continue; }
      /* the Account Summary at the end: its table, then nothing more is read */
      if (summary && scols) {
        if (TOTAL_ROW.test(text) && !DATE_CELL.test(r[scols.name] || '')) {
          var tc = scols.cost >= 0 ? num(r[scols.cost]) : NaN, tv = scols.value >= 0 ? num(r[scols.value]) : NaN;
          summary.total = { cost: isFinite(tc) ? tc : null, value: isFinite(tv) ? tv : null };
          done = true; continue;
        }
        var su = num(r[scols.units]), sn = cell(r[scols.name]);
        if (isFinite(su) && sn) {
          summary.funds.push({ name: sn, units: su, nav: scols.nav >= 0 ? num(r[scols.nav]) : NaN, t: scols.date >= 0 ? dateOf(r[scols.date]) : NaN,
                               cost: scols.cost >= 0 ? num(r[scols.cost]) : NaN, value: scols.value >= 0 ? num(r[scols.value]) : NaN });
          continue;
        }
        /* a scheme name wrapped onto the next line */
        if (sn && summary.funds.length && r.every(function (c, k) { return k === scols.name || !c; })) { summary.funds[summary.funds.length - 1].name += ' ' + sn; continue; }
        /* anything else ends the summary */
        done = true; continue;
      }
      if (summary && !scols) {
        var sc = summaryColumnsOf(r);
        if (sc) { scols = sc; continue; }
        if (columnsOf(r) || SCHEME_LINE.test(text)) summary = null;   /* not a summary after all */
        else continue;
      }
      if (!summary && SUMMARY_TITLE.test(text) && r.filter(Boolean).length <= 2) { close(); summary = { funds: [], total: null, line: i }; continue; }
      var sc2 = summaryColumnsOf(r);
      if (!summary && sc2 && !columnsOf(r)) { close(); summary = { funds: [], total: null, line: i }; scols = sc2; continue; }

      if ((m = FOLIO.exec(text)) && !cur) { folio = /^(statement|date|pan|kyc)/i.test(m[1]) ? '' : m[1].replace(/\s+/g, ' ').trim(); continue; }
      if ((m = SCHEME_LINE.exec(text))) {
        var nm = m[1], im = ISIN.exec(nm), nv = NAV_AS_ON.exec(nm);
        nm = nm.replace(/\s*\bISIN\b.*$/i, '').replace(/\s*\bNAV\s+(?:as\s+on|on)\b.*$/i, '').replace(/\s*[:\-]\s*$/, '').trim();
        /* the same scheme named again at the top of the next page carries on the same block */
        var same = cur && cur.closing == null && norm(cur.name) === norm(nm) && (!im || !cur.isin || cur.isin === im[1].toUpperCase());
        if (!same) start(nm, i, true); else { cols = null; pendingDesc = []; }
        if (im) cur.isin = im[1].toUpperCase();
        if (nv) { cur.navDate = dateOf(nv[1]); cur.nav = num(nv[2]); }
        continue;
      }
      var c = columnsOf(r);
      if (c) {
        if (!cur) start(pendingName || '', i, false);
        cols = c; if (c.bal >= 0) cur.balCol = true; pendingDesc = []; continue;
      }
      if (!cur) { if (r.filter(Boolean).length === 1 && /[A-Za-z]/.test(text) && text.length < 120 && !/\d{2}[\/\-]\d{2}/.test(text)) pendingName = text; continue; }
      if (OPENING.test(text)) {
        var ou = lastNumber(text);
        /* an opening balance printed again where a block carries on over a page says the same figure */
        if (isFinite(ou) && cur.opening != null && cur.rows.length && thou(Math.abs(ou)) !== thou(cur.opening)) { pendingDesc = []; continue; }
        if (isFinite(ou) && !(cur.opening != null && cur.rows.length)) { cur.opening = Math.abs(ou); cur.openingT = dateIn(text); }
        pendingDesc = []; continue;
      }
      if (CLOSING.test(text)) { var cu = lastNumber(text); if (isFinite(cu)) cur.closing = Math.abs(cu); if ((m = NAV_AS_ON.exec(text))) { cur.navDate = dateOf(m[1]); cur.nav = num(m[2]); } continue; }
      if (VALUE_AS_ON.test(text) && !cols) { continue; }
      if ((m = VALUE_AS_ON.exec(text)) && !DATE_CELL.test(r[cols.date] || '')) { var vv = lastNumber(text.replace(VALUE_AS_ON, '')); if (isFinite(vv)) { cur.value = vv; cur.valueDate = dateOf(m[1]); } continue; }
      if ((m = NAV_AS_ON.exec(text)) && !DATE_CELL.test(r[cols.date] || '')) { cur.navDate = dateOf(m[1]); cur.nav = num(m[2]); continue; }
      if (!cols) continue;
      var t = dateOf(r[cols.date]);
      var amount = num(r[cols.amount]), units = num(r[cols.units]), bal = cols.bal >= 0 ? num(r[cols.bal]) : NaN, nav = cols.nav >= 0 ? num(r[cols.nav]) : NaN;
      var desc = cols.desc >= 0 ? cell(r[cols.desc]) : '';
      if (isFinite(t) && (isFinite(amount) || isFinite(units))) {
        /* a tax line of its own: a date, words, an amount, no units */
        if (!isFinite(units) && (STAMP_WORD.test(desc) || STT_WORD.test(desc) || TDS_WORD.test(desc))) {
          var kind = STAMP_WORD.test(desc) ? 'stamp' : STT_WORD.test(desc) ? 'stt' : 'tds', host = null;
          for (var b = cur.rows.length - 1; b >= 0; b--) { if (cur.rows[b].t === t) { host = cur.rows[b]; break; } }
          if (host) host.taxes.push({ kind: kind, amount: Math.abs(amount) }); else cur.rows.push({ t: t, desc: desc, before: pendingDesc, after: [], amount: 0, units: 0, nav: null, balance: null, taxes: [{ kind: kind, amount: Math.abs(amount) }], orphanTax: true, line: i });
          pendingDesc = []; continue;
        }
        if (!isFinite(units)) { pendingDesc = []; continue; }
        cur.rows.push({ t: t, desc: desc, before: pendingDesc, after: [], amount: isFinite(amount) ? amount : 0, units: units, rawUnits: cell(r[cols.units]), nav: isFinite(nav) ? nav : null, balance: isFinite(bal) ? bal : null, taxes: [], line: i });
        pendingDesc = [];
        continue;
      }
      /* no date on this line: the words of a description, before or after the line that carries the
         figures. A scheme's footer (its market value, the units free to redeem, the load structure,
         the notes) and a page heading are neither. */
      if (/\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{4}/.test(text) && /\bpage\b|\bstatement\b|\bfolio\b/i.test(text)) { pendingDesc = []; continue; }
      if (FOOTER.test(text) || text.length >= 120) { pendingDesc = []; cur.rows.forEach(function (x) { x.line = -1; }); continue; }
      var filled = r.map(function (c, k) { return c ? k : -1; }).filter(function (k) { return k >= 0; });
      var inPlace = filled.every(function (k) { return k === cols.desc || k === cols.amount || k === cols.date; });
      if (!inPlace) { pendingDesc = []; continue; }
      var first = r.filter(Boolean)[0] || '';
      var last = cur.rows[cur.rows.length - 1];
      if (last && last.line >= 0 && !(TXN_START.test(first) && filled.length === 1 && !/\d{3,}\.\d/.test(text))) {
        last.after.push(r.filter(Boolean).join(' ')); last.line = i;
      } else if (!/\.\d{2}\b.*\.\d{2}\b/.test(text)) pendingDesc.push(r.filter(Boolean).join(' '));
    }
    close();

    /* The layout this file reads, and nothing else: a block that names its scheme on a line of
       its own ("Scheme : ..."), or carries an Opening or Closing Balance line, and that prints
       running unit balances or those opening and closing lines. A plain table (a scheme column,
       or no scheme line at all) and a table without any balance stay with the statement reader
       they always had, so no earlier reading changes. */
    schemes = schemes.filter(function (sc) { return sc.rows.length || sc.opening != null || sc.closing != null; });
    layout = schemes.some(function (sc) { return (sc.named || sc.opening != null || sc.closing != null) && (sc.balCol || sc.opening != null || sc.closing != null); });
    if (!layout) return { ok: false, layout: false };
    var ledger = [], valuations = [], openings = [], problems = [], okSchemes = [];
    schemes.forEach(function (sc) {
      if (!sc.rows.length && sc.opening == null && sc.closing == null) return;
      var sum = sc.summary = matchSummary(sc, summary);
      var opening = sc.opening == null ? null : sc.opening;
      var signed = sc.rows.map(function (r) { return r.orphanTax ? 0 : (isOut(r) ? -Math.abs(r.units) : Math.abs(r.units)); });
      /* no opening line: the first running balance less its own line says what was held before */
      if (opening == null && sc.rows.length && sc.rows[0].balance != null) opening = Math.round((sc.rows[0].balance - signed[0]) * 1000) / 1000;
      if (opening == null) opening = 0;
      var closing = sc.closing != null ? sc.closing : null;
      var lastBal = null; sc.rows.forEach(function (r) { if (r.balance != null) lastBal = r.balance; });
      if (closing == null && sum && isFinite(sum.units)) closing = sum.units;
      if (closing == null && lastBal != null) closing = lastBal;
      var hasBalances = sc.rows.some(function (r) { return r.balance != null; });
      if (closing == null || (!hasBalances && sc.opening == null)) { problems.push({ scheme: sc.name, message: (sc.name || 'A scheme') + ' prints no running unit balance and no opening and closing balance, so its transactions cannot be proved to add up. No figure is shown for this scheme.' }); sc.ok = false; return; }
      /* the proof: every running balance follows from the line before, and the whole adds up */
      var run = opening, broken = null;
      sc.rows.forEach(function (r, k) {
        run = Math.round((run + signed[k]) * 1000) / 1000;
        if (!broken && r.balance != null && thou(r.balance) !== thou(run)) broken = { when: r.t, got: r.balance, want: run };
      });
      if (broken) { problems.push({ scheme: sc.name, message: MESSAGES.chain(sc.name, fmtDate(broken.when), broken.got, broken.want) }); sc.ok = false; return; }
      if (thou(run) !== thou(closing)) { problems.push({ scheme: sc.name, expected: run, closing: closing, message: MESSAGES.units(sc.name, run, closing) }); sc.ok = false; return; }
      if (sum && isFinite(sum.units) && thou(sum.units) !== thou(closing)) { problems.push({ scheme: sc.name, message: MESSAGES.units(sc.name, closing, sum.units) }); sc.ok = false; return; }
      sc.ok = true; sc.openingUnits = opening; sc.closingUnits = closing;
      okSchemes.push(sc);
      if (opening > 0.0005) openings.push({ fund: sc.name, folio: sc.folio, units: opening, t: sc.openingT != null && isFinite(sc.openingT) ? sc.openingT : (period ? period.from : (sc.rows.length ? sc.rows[0].t : null)) });
      sc.rows.forEach(function (r, k) {
        var stamp = 0, stt = 0, tds = 0;
        r.taxes.forEach(function (x) { if (x.kind === 'stamp') stamp += x.amount; else if (x.kind === 'stt') stt += x.amount; else tds += x.amount; });
        if (r.orphanTax) { ledger.push({ t: r.t, amount: stamp + stt + tds, gross: 0, dir: 'in', units: null, idcw: null, fund: sc.name, folio: sc.folio, isin: sc.isin, line: r.line, desc: r.desc, tax: { stamp: stamp, stt: stt, tds: tds }, taxOnly: true }); return; }
        var inl = inlineStamp(r.desc), gross = Math.abs(r.amount), units = Math.abs(r.units), out = signed[k] < 0;
        var idcw = IDCW_WORD.test(r.desc), reinvest = idcw && /reinvest/i.test(r.desc), payout = idcw && !reinvest && units < 0.0005;
        if (inl && inl.stamp != null && !out && !reinvest) stamp += inl.stamp;
        var cash;
        if (reinvest) { ledger.push({ t: r.t, amount: gross, gross: gross, dir: 'reinvest', units: units, idcw: 'reinvest', fund: sc.name, folio: sc.folio, isin: sc.isin, line: r.line, desc: r.desc, nav: r.nav, tax: { stamp: stamp, stt: stt, tds: tds } }); return; }
        if (payout) { ledger.push({ t: r.t, amount: Math.max(0, gross - tds - stt), gross: gross, dir: 'out', units: null, idcw: 'payout', fund: sc.name, folio: sc.folio, isin: sc.isin, line: r.line, desc: r.desc, nav: r.nav, tax: { stamp: stamp, stt: stt, tds: tds } }); return; }
        if (out) cash = Math.max(0, gross - stt - tds);
        else if (inl && inl.gross != null && inl.gross >= gross) cash = inl.gross;   /* money out of pocket is the gross the line names */
        else cash = gross + stamp;
        ledger.push({ t: r.t, amount: Math.round(cash * 100) / 100, gross: gross, dir: out ? 'out' : 'in', units: units > 0 ? units : null, idcw: null, fund: sc.name, folio: sc.folio, isin: sc.isin, line: r.line, desc: r.desc, nav: r.nav, tax: { stamp: stamp, stt: stt, tds: tds }, inline: !!(inl && inl.gross != null) });
      });
      var nav = sc.nav != null ? sc.nav : (sum && isFinite(sum.nav) ? sum.nav : null);
      var navDate = sc.navDate != null && isFinite(sc.navDate) ? sc.navDate : (sum && isFinite(sum.t) ? sum.t : null);
      var value = sc.value != null ? sc.value : (sum && isFinite(sum.value) ? sum.value : null);
      if (closing > 0.0005 && nav != null && navDate != null) {
        valuations.push({ fund: sc.name, folio: sc.folio, units: closing, nav: nav, t: sc.valueDate != null && isFinite(sc.valueDate) ? sc.valueDate : navDate, amount: value != null ? value : Math.round(closing * nav * 100) / 100, fromCas: true, cost: sum && isFinite(sum.cost) ? sum.cost : null });
      }
    });
    var ok = ledger.length > 0 || valuations.length > 0;
    return {
      ok: ok, layout: true, kind: 'listing', partial: partial, period: period, folio: folio, schemes: schemes, read: okSchemes.length, rows: ledger, valuations: valuations, openings: openings, problems: problems,
      summary: summary && summary.funds.length ? { funds: summary.funds.map(function (f) { var sc = schemes.filter(function (s) { return s.summary === f; })[0]; return { name: f.name, fund: sc ? sc.name : f.name, read: !!(sc && sc.ok), units: f.units, nav: isFinite(f.nav) ? f.nav : null, t: isFinite(f.t) ? f.t : null, cost: isFinite(f.cost) ? f.cost : null, value: isFinite(f.value) ? f.value : null }; }), total: summary.total } : null,
      message: ok ? null : (problems.length ? (schemes.length && problems.length === schemes.filter(function (s) { return s.rows.length || s.opening != null || s.closing != null; }).length ? MESSAGES.allFailed + ' ' : '') + problems.map(function (p) { return p.message; }).join(' ') : MESSAGES.nothing)
    };
  }
  function isOut(r) {
    if (r.units < 0 || /^\(.*\)$/.test(String(r.rawUnits || '')) || /^-/.test(String(r.rawUnits || ''))) return true;
    if (r.amount < 0) return true;
    return OUT_WORD.test(r.desc) && !/\bswitch[\s-]*in\b/i.test(r.desc);
  }
  /* the Account Summary's line for a scheme: by its unit balance, then its NAV, then its name */
  function matchSummary(sc, summary) {
    if (!summary || !summary.funds.length) return null;
    var lastBal = sc.closing; sc.rows.forEach(function (r) { if (r.balance != null) lastBal = r.balance; });
    var byUnits = summary.funds.filter(function (f) { return lastBal != null && isFinite(f.units) && thou(f.units) === thou(lastBal); });
    if (byUnits.length === 1) return byUnits[0];
    var byNav = summary.funds.filter(function (f) { return sc.nav != null && isFinite(f.nav) && Math.abs(f.nav - sc.nav) < 0.00005; });
    if (byNav.length === 1) return byNav[0];
    var key = words(sc.name), best = null, bestScore = 0;
    summary.funds.forEach(function (f) {
      var w = words(f.name), hit = 0;
      w.forEach(function (x) { if (key.indexOf(x) !== -1) hit++; });
      var score = w.length ? hit / w.length : 0;
      if (score > bestScore) { bestScore = score; best = f; }
    });
    return bestScore >= 0.6 ? best : null;
  }
  function words(s) { return norm(String(s || '').replace(/\breg\b/gi, 'regular').replace(/-/g, ' ')).split(' ').filter(function (w) { return w && !/^(plan|option|the|fund|scheme)$/.test(w); }); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(t) { if (!isFinite(t)) return 'that date'; var d = new Date(t); return String(d.getUTCDate()).padStart(2, '0') + '-' + MON[d.getUTCMonth()] + '-' + d.getUTCFullYear(); }

  var api = { read: read, inlineStamp: inlineStamp, columnsOf: columnsOf, summaryColumnsOf: summaryColumnsOf, MESSAGES: MESSAGES, num: num, dateOf: dateOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PRCListing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
