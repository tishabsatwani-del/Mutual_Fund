/* Where You Stand: reading a Consolidated Account Statement (CAS).
 *
 * The CAS that CAMS and KFintech issue jointly is a PDF, and its detailed form
 * is the one complete record most Indian investors hold: every folio, every
 * scheme, every transaction since the start of the period, each with its
 * running unit balance. This file reads that layout, line by line, as the
 * open-source casparser does, and nothing else:
 *
 *   Folio No: 12345678 / 0  PAN: ...  KYC: OK  PAN: OK
 *   CODE-Scheme Name - Direct Plan - Growth (Advisor: DIRECT)   Registrar : CAMS
 *   ISIN: INF...
 *   Opening Unit Balance: 0.000
 *   Date  Transaction  Amount (INR)  Units  NAV (INR)  Unit Balance
 *   06-Jan-2025  Systematic Investment (1)  4,999.75  121.636  41.1043  121.636
 *   06-Jan-2025  *** Stamp Duty ***  0.25
 *   15-Sep-2025  Redemption  (20,000.00)  (241.250)  82.9015  55.198
 *   15-Sep-2025  *** STT Paid ***  0.20
 *   Closing Unit Balance: 1,148.622  NAV on 31-Dec-2025: INR 45.8012  ...  Market Value on 31-Dec-2025: INR 52,608.27
 *
 * Rules, each from the brief of November 2026:
 *   - for every scheme, the opening units plus every transaction's units must
 *     equal the closing units to three decimals; a scheme that does not add up
 *     is read as nothing, and named;
 *   - money out of pocket for a purchase is the purchase amount plus its stamp
 *     duty line; money received on a redemption is the amount less its STT and
 *     TDS lines;
 *   - an IDCW payout is money received; an IDCW reinvestment is units only;
 *   - the statement's own closing NAV and market value stand as "worth today"
 *     until a NAV file says otherwise;
 *   - a Summary CAS (no transactions) is a holdings file: no dates, no yearly rate;
 *   - a CAS in any other layout (MF Central's own, a depository's) is refused
 *     and told which statement to download instead.
 *
 * Statements that are not a complete history (a Single Folio statement of the
 * last five transactions, a Capital Gain statement, Pay-In Pay-Out, IDCW, ELSS
 * One View, SFT, Exit Load, Grandfathered) are recognised by their titles here
 * too, in any format, so step 1 can refuse each by name.
 *
 * No DOM, no clock, no network. Pure functions on lines of text.
 */
(function (root) {
  'use strict';

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var DATE = /\b(\d{2})-([A-Za-z]{3})-(\d{4})\b/;
  function ts(s) {
    var m = DATE.exec(String(s || ''));
    if (!m) return NaN;
    var mo = MONTHS[m[2].toLowerCase()];
    return mo ? Date.UTC(+m[3], mo - 1, +m[1]) : NaN;
  }
  /* "1,23,456.78" or "(1,234.56)": the number, negative when bracketed */
  function num(s) {
    var t = String(s == null ? '' : s).trim(), neg = false;
    var w = /^\((.*)\)$/.exec(t);
    if (w) { neg = true; t = w[1]; }
    t = t.replace(/[,\s]/g, '').replace(/^(INR|Rs\.?)/i, '');
    if (!/^-?\d*\.?\d+$/.test(t)) return NaN;
    var n = parseFloat(t);
    return neg ? -n : n;
  }
  function flat(pages) {
    var out = [];
    (pages || []).forEach(function (pg) { (Array.isArray(pg) ? pg : [pg]).forEach(function (l) { var t = String(l == null ? '' : l).replace(/\s+/g, ' ').trim(); if (t) out.push(t); }); });
    return out;
  }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  /* ------------------------------------------------- which statement is this?
     By its title, in its first lines (a PDF) or its first cells (a workbook or
     CSV). Each kind the brief lists is named, and told what to download instead. */
  var DOWNLOAD = ' Download the detailed Consolidated Account Statement (CAS) from CAMS or KFintech, or the full Transaction Details statement, covering the period from your first investment to today, and load that here.';
  var MESSAGES = {
    'single-folio': 'This is a Single Folio Account Statement. CAMS limits it to the last five transactions, so it is not your complete history and a return worked out from it would be wrong.' + DOWNLOAD,
    'capital-gains': 'This is a Capital Gain / Loss statement. It lists only the units you sold, with the gain on each for tax, not every payment you made.' + DOWNLOAD,
    'payin-payout': 'This is a Pay-In Pay-Out statement: the bank movements, without the units, the NAVs, the switches or the reinvestments, so it is not a complete investment history.' + DOWNLOAD,
    'idcw': 'This is an IDCW (dividend) statement. It lists only the income the funds distributed, not your payments.' + DOWNLOAD,
    'elss': 'This is an ELSS One View statement. It lists only your tax-saving (ELSS) units and their lock-in, not your payments.' + DOWNLOAD,
    'sft': 'This is a Statement of Financial Transactions (SFT), prepared for the Income Tax Department. It reports a year’s purchases above a threshold, not your whole history.' + DOWNLOAD,
    'exit-load': 'This is an Exit Load statement: the load each unit would carry if sold now, not your payments.' + DOWNLOAD,
    'grandfathered': 'This is a Grandfathered NAV statement: the NAV of 31 January 2018 on units held then, for tax, not your payments.' + DOWNLOAD,
    'demat': 'This is a demat consolidated statement from a depository (NSDL or CDSL). It shows what the depository account holds, not every payment you made into your funds.' + DOWNLOAD,
    'cas-other': 'This is a consolidated account statement in a layout this tool does not read with certainty, so nothing was taken from it. Download the detailed CAS from CAMS or KFintech (choose Detailed, not Summary), covering the period from your first investment to today, and load that here.',
    'cas-nothing': 'This consolidated account statement holds no scheme with transactions that could be read, so nothing is shown.',
    units: function (name, expected, closing) {
      return name + ' could not be read with certainty: its opening units plus every transaction come to ' + fmtUnits(expected) + ', but the statement closes it at ' + fmtUnits(closing) + '. No figure is shown for this scheme.';
    },
    opening: function (name, when, units) {
      return 'This statement starts on ' + when + ' with ' + fmtUnits(units) + ' units bought earlier. For your full return, the statement must cover the period from your first investment.';
    }
  };
  function fmtUnits(u) { return Number(u).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }
  var TITLE_LINES = 14;
  function kindOfText(lines) {
    var head = lines.slice(0, TITLE_LINES).join(' \n ');
    var all = lines.join(' \n ');
    if (/\bsingle\s*folio\b/i.test(head)) return 'single-folio';
    if (/\bcapital\s*gains?\b/i.test(head) && !/consolidated account statement/i.test(head)) return 'capital-gains';
    if (/\bpay[\s-]*in\b.{0,6}\bpay[\s-]*out\b/i.test(head)) return 'payin-payout';
    if (/\b(idcw|dividend)\s+statement\b/i.test(head)) return 'idcw';
    if (/\belss\b.{0,20}\bone\s*view\b|\bone\s*view\b.{0,20}\belss\b/i.test(head)) return 'elss';
    if (/statement\s+of\s+financial\s+transactions?|\bSFT[\s-]*\d{3}\b|\bSFT\b.*\bincome\s+tax\b/i.test(head)) return 'sft';
    if (/\bexit\s+load\s+(statement|report)\b|^exit\s+load\b/im.test(head)) return 'exit-load';
    if (/\bgrandfather/i.test(head)) return 'grandfathered';
    if (/\bNSDL\b|\bCDSL\b|national securities depository|central depository services|depository participant|\bDP\s*ID\b|\bBO\s*ID\b|\bdemat\b/i.test(head)) return 'demat';
    if (/consolidated\s+account\s+statement|\bCAS\b/i.test(head)) {
      if (/opening\s+unit\s+balance/i.test(all) && /closing\s+unit\s+balance/i.test(all) && /folio\s*no/i.test(all)) return 'detailed';
      if (/\bsummary\b/i.test(head) && /folio/i.test(all) && /market\s+value|valuation/i.test(all)) return 'summary';
      /* a statement that presents itself as the registrars' or MF Central's CAS (Detailed, Summary, a
         statement period) in a layout that is not theirs is refused; a plain table that merely calls
         itself a consolidated statement is left to the plain-table reader */
      if (/\bmf\s*central\b/i.test(all) || /\bdetailed\b|\bsummary\b|statement\s+period|\bperiod\s*:|\bas\s+on\b/i.test(head)) return 'cas-other';
      return 'cas-plain';
    }
    return null;
  }
  /* the same question of a workbook's or a CSV's rows: the words of its first cells */
  function kindOfRows(rows) {
    var lines = [];
    (rows || []).slice(0, 40).forEach(function (r) { var t = (r || []).map(function (c) { return String(c == null ? '' : c).trim(); }).filter(Boolean).join(' '); if (t) lines.push(t); });
    var k = kindOfText(lines);
    /* a CAS title over rows the statement reader can read is not a refusal: the PDF path has already judged the layout */
    return k === 'detailed' || k === 'summary' || k === 'cas-other' || k === 'cas-plain' ? null : k;
  }
  function kind(pages) { return kindOfText(flat(pages)); }

  /* ------------------------------------------------------- the detailed CAS */
  var FOLIO = /^Folio\s*No\.?\s*[:\-]?\s*(\S.*?)(?:\s+PAN\b.*|\s+KYC\b.*|\s+Nominee\b.*)?$/i;
  var REGISTRAR = /^(.*?)\s*(?:\(Advisor\s*:[^)]*\)\s*)?Registrar\s*[:\-]\s*(\S+)\s*$/i;
  var ISIN = /\bISIN\s*[:\-]?\s*([A-Z]{2}[A-Z0-9]{9}\d)\b/i;
  var OPEN = /Opening\s+Unit\s+Balance\s*[:\-]?\s*(\(?[\d,]*\.?\d+\)?)/i;
  var CLOSE = /Closing\s+Unit\s+Balance\s*[:\-]?\s*(\(?[\d,]*\.?\d+\)?)/i;
  var NAV_ON = /NAV\s+on\s+(\d{2}-[A-Za-z]{3}-\d{4})\s*[:\-]?\s*(?:INR|Rs\.?)?\s*([\d,]*\.?\d+)/i;
  var VALUE_ON = /(?:Market\s+Value|Valuation)\s+on\s+(\d{2}-[A-Za-z]{3}-\d{4})\s*[:\-]?\s*(?:INR|Rs\.?)?\s*([\d,]*\.?\d+)/i;
  var COST = /Total\s+Cost\s+Value\s*[:\-]?\s*(?:INR|Rs\.?)?\s*([\d,]*\.?\d+)/i;
  var PERIOD = /^(\d{2}-[A-Za-z]{3}-\d{4})\s+To\s+(\d{2}-[A-Za-z]{3}-\d{4})$/i;
  var AMT = '(\\(?[\\d,]*\\.\\d{2,}\\)?)';
  var TXN = new RegExp('^(\\d{2}-[A-Za-z]{3}-\\d{4})\\s+(.+?)\\s+' + AMT + '\\s+(\\(?[\\d,]*\\.\\d{3,}\\)?)\\s+([\\d,]*\\.\\d{2,})\\s+(\\(?[\\d,]*\\.\\d{3,}\\)?)$');
  var TAX = new RegExp('^(\\d{2}-[A-Za-z]{3}-\\d{4})\\s+(\\*{2,}.*?\\*{2,}.*?|.*\\b(?:stamp\\s*duty|STT|TDS)\\b.*?)\\s+' + AMT + '$', 'i');
  var HEADING = /^Date\s+Transaction\b.*\bUnit\s+Balance$/i;
  function taxKind(desc) {
    if (/stamp\s*duty/i.test(desc)) return 'stamp';
    if (/\bSTT\b|securities\s+transaction\s+tax/i.test(desc)) return 'stt';
    if (/\bTDS\b|tax\s+deducted/i.test(desc)) return 'tds';
    return 'tax';
  }
  function schemeName(text) {
    var t = String(text || '').trim();
    /* a leading scheme code: "P8019-Scheme", "128TSDGG-Scheme" */
    var m = /^([A-Z0-9]{2,12})-\s*(?=[A-Za-z])(.*)$/.exec(t);
    if (m && !/^(SBI|UTI|HDFC|DSP|LIC|IDFC|PGIM|ITI|WOC|NJ)$/i.test(m[1])) t = m[2];
    return t.replace(/\s*\(Advisor\s*:[^)]*\)\s*$/i, '').replace(/\s+/g, ' ').trim();
  }
  function isIdcwDesc(d) { return /\bidcw\b|\bdividend\b|\bincome\s+distribution\b/i.test(d); }

  function readDetailed(pages) {
    var lines = flat(pages), schemes = [], cur = null, folio = '', amc = '', period = null, i;
    function close() {
      if (cur) schemes.push(cur);
      cur = null;
    }
    function start(name, registrar, line) {
      close();
      cur = { folio: folio, amc: amc, name: name, registrar: registrar || '', isin: '', opening: null, closing: null, nav: null, navDate: null, value: null, valueDate: null, cost: null, rows: [], line: line, sawHeading: false };
    }
    for (i = 0; i < lines.length; i++) {
      var l = lines[i], m;
      if (!period && (m = PERIOD.exec(l))) { period = { from: ts(m[1]), to: ts(m[2]) }; continue; }
      if ((m = FOLIO.exec(l))) { close(); folio = m[1].replace(/\s+/g, ' ').trim(); continue; }
      if ((m = REGISTRAR.exec(l)) && !/^Folio/i.test(l)) {
        var nm = schemeName(m[1]);
        if (nm) { start(nm, m[2], i); var im = ISIN.exec(l); if (im) cur.isin = im[1].toUpperCase(); continue; }
      }
      if (!cur) {
        /* the fund house's name stands over its folios */
        if (/\bmutual\s+fund$/i.test(l) && !/\bcost\s+value\b/i.test(l)) amc = l;
        continue;
      }
      if ((m = ISIN.exec(l)) && !cur.isin) { cur.isin = m[1].toUpperCase(); if (/^ISIN/i.test(l)) continue; }
      if ((m = OPEN.exec(l))) { cur.opening = num(m[1]); continue; }
      if (CLOSE.test(l)) {
        m = CLOSE.exec(l); cur.closing = num(m[1]);
        var nm2 = NAV_ON.exec(l); if (nm2) { cur.navDate = ts(nm2[1]); cur.nav = num(nm2[2]); }
        var vm = VALUE_ON.exec(l); if (vm) { cur.valueDate = ts(vm[1]); cur.value = num(vm[2]); }
        var cm = COST.exec(l); if (cm) cur.cost = num(cm[1]);
        close(); continue;
      }
      if (HEADING.test(l)) { cur.sawHeading = true; continue; }
      if ((m = TXN.exec(l))) {
        var amount = num(m[3]), units = num(m[4]), nav = num(m[5]), bal = num(m[6]);
        if (!isFinite(amount) || !isFinite(units)) continue;
        cur.rows.push({ t: ts(m[1]), desc: m[2].trim(), amount: amount, units: units, nav: isFinite(nav) ? nav : null, balance: isFinite(bal) ? bal : null, line: i, taxes: [] });
        continue;
      }
      if ((m = TAX.exec(l))) {
        var tax = num(m[3]);
        if (!isFinite(tax)) continue;
        var t0 = ts(m[1]), k = taxKind(m[2]), prev = null;
        for (var b = cur.rows.length - 1; b >= 0; b--) { if (cur.rows[b].t === t0) { prev = cur.rows[b]; break; } }
        if (prev) prev.taxes.push({ kind: k, amount: Math.abs(tax), desc: m[2].trim() });
        else cur.rows.push({ t: t0, desc: m[2].trim(), amount: 0, units: 0, nav: null, balance: null, line: i, taxes: [{ kind: k, amount: Math.abs(tax), desc: m[2].trim() }], orphanTax: true });
        continue;
      }
      /* a long description wrapped onto the next line, before any figures */
      if (cur.rows.length && !DATE.test(l) && !/\d\.\d/.test(l) && !/^(Page\b|Folio|Opening|Closing|Date\b)/i.test(l) && l.length < 120 && cur.rows[cur.rows.length - 1].line === i - 1) {
        cur.rows[cur.rows.length - 1].desc += ' ' + l;
      }
    }
    close();

    var problems = [], okSchemes = [], ledger = [], valuations = [], openings = [];
    schemes.forEach(function (sc) {
      if (sc.opening == null && sc.closing == null && !sc.rows.length) return;   /* a folio block with nothing in it */
      var opening = sc.opening == null ? 0 : sc.opening, sum = opening, reconciled = true;
      sc.rows.forEach(function (r) { sum += r.units; });
      if (sc.closing == null || Math.abs(round3(sum) - round3(sc.closing)) > 0.0015) reconciled = false;
      if (!reconciled) {
        sc.ok = false;
        problems.push({ scheme: sc.name, folio: sc.folio, expected: round3(sum), closing: sc.closing, message: MESSAGES.units(sc.name, round3(sum), sc.closing == null ? NaN : sc.closing) });
        return;
      }
      sc.ok = true;
      okSchemes.push(sc);
      if (opening > 0.0005) openings.push({ fund: sc.name, folio: sc.folio, units: opening, t: period ? period.from : (sc.rows.length ? sc.rows[0].t : null) });
      sc.rows.forEach(function (r) {
        var stamp = 0, stt = 0, tds = 0;
        r.taxes.forEach(function (x) { if (x.kind === 'stamp') stamp += x.amount; else if (x.kind === 'stt') stt += x.amount; else tds += x.amount; });
        var idcw = isIdcwDesc(r.desc), reinvest = idcw && /reinvest/i.test(r.desc), payout = idcw && !reinvest && Math.abs(r.units) < 0.0005;
        var out = r.amount < 0 || r.units < 0 || (payout && r.amount > 0 && false);
        if (r.orphanTax) {
          /* a tax line with no transaction of its own on that date: money out of pocket on its own */
          ledger.push({ t: r.t, amount: stamp + stt + tds, gross: 0, dir: 'in', units: null, idcw: null, fund: sc.name, folio: sc.folio, isin: sc.isin, line: r.line, desc: r.desc, tax: { stamp: stamp, stt: stt, tds: tds }, taxOnly: true });
          return;
        }
        var gross = Math.abs(r.amount), units = Math.abs(r.units), cash;
        if (reinvest) { ledger.push({ t: r.t, amount: gross, gross: gross, dir: 'reinvest', units: units, idcw: 'reinvest', fund: sc.name, folio: sc.folio, isin: sc.isin, line: r.line, desc: r.desc, nav: r.nav, tax: { stamp: stamp, stt: stt, tds: tds } }); return; }
        if (payout) { ledger.push({ t: r.t, amount: Math.max(0, gross - tds - stt), gross: gross, dir: 'out', units: null, idcw: 'payout', fund: sc.name, folio: sc.folio, isin: sc.isin, line: r.line, desc: r.desc, nav: r.nav, tax: { stamp: stamp, stt: stt, tds: tds } }); return; }
        if (out) cash = Math.max(0, gross - stt - tds);
        else cash = gross + stamp;
        ledger.push({ t: r.t, amount: cash, gross: gross, dir: out ? 'out' : 'in', units: units > 0 ? units : null, idcw: null, fund: sc.name, folio: sc.folio, isin: sc.isin, line: r.line, desc: r.desc, nav: r.nav, tax: { stamp: stamp, stt: stt, tds: tds } });
      });
      if (sc.closing > 0.0005 && sc.nav != null && sc.navDate != null) {
        valuations.push({ fund: sc.name, folio: sc.folio, units: sc.closing, nav: sc.nav, t: sc.valueDate != null ? sc.valueDate : sc.navDate,
                          amount: sc.value != null ? sc.value : Math.round(sc.closing * sc.nav * 100) / 100, fromCas: true });
      }
    });
    return { ok: ledger.length > 0 || valuations.length > 0, kind: 'cas', period: period, schemes: schemes, read: okSchemes.length, rows: ledger, valuations: valuations, openings: openings, problems: problems,
             message: ledger.length || valuations.length ? null : (problems.length ? problems.map(function (p) { return p.message; }).join(' ') : MESSAGES['cas-nothing']) };
  }

  /* -------------------------------------------------------- the Summary CAS
     One line per folio: Folio, Scheme Name, Cost Value, Unit Balance, NAV Date,
     NAV, Market Value; the next line may carry the ISIN and the registrar. */
  var SUMMARY_ROW = /^(\S.*?\/\s*\d+|\S+)\s+(\S.*?)\s+([\d,]*\.\d{2})\s+([\d,]*\.\d{3})\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+([\d,]*\.\d{2,})\s+([\d,]*\.\d{2})\s*$/;
  function readSummary(pages) {
    var lines = flat(pages), out = [];
    for (var i = 0; i < lines.length; i++) {
      var m = SUMMARY_ROW.exec(lines[i]);
      if (!m) continue;
      var h = { folio: m[1].trim(), name: m[2].trim(), invested: num(m[3]), units: num(m[4]), navDate: ts(m[5]), nav: num(m[6]), current: num(m[7]), isin: '', line: i };
      var nx = lines[i + 1] || '', im = ISIN.exec(nx);
      if (im && !DATE.test(nx)) h.isin = im[1].toUpperCase();
      if (h.name && isFinite(h.current)) out.push(h);
    }
    return { ok: out.length > 0, kind: 'holdings', summary: true, rows: out, skipped: 0, totalsDropped: 0, message: out.length ? null : MESSAGES['cas-other'] };
  }

  var api = { kind: kind, kindOfText: kindOfText, kindOfRows: kindOfRows, readDetailed: readDetailed, readSummary: readSummary, MESSAGES: MESSAGES, ts: ts, num: num, schemeName: schemeName };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PRCCas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
