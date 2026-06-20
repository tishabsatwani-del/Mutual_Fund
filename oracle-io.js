/* =====================================================================
 * Autonomous Portfolio Oracle — data I/O layer
 * ---------------------------------------------------------------------
 * Pure, dependency-free import/export so the tool runs on a REAL portfolio,
 * not just the demo — and stays fully offline (no pdf.js, no CDN, no backend).
 * A future CAS-PDF importer only has to emit the same holding objects these
 * parsers produce, so it plugs into the proven data model unchanged.
 *
 * Formats:
 *   • CSV  — scheme,amc,category,plan,units,nav,avgCost,invested,purchaseDate,ter
 *   • JSON — a whole portfolio (round-trips export -> import losslessly)
 *
 * Node-exported and unit-tested; attaches to window.ORACLE_IO in the browser.
 * ===================================================================== */
'use strict';

(function (root, factory) {
  const IO = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = IO;
  if (typeof window !== 'undefined') window.ORACLE_IO = IO;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const CSV_COLUMNS = ['scheme', 'amc', 'category', 'plan', 'units', 'nav', 'avgCost', 'invested', 'purchaseDate', 'ter'];
  const REQUIRED = ['scheme', 'category', 'plan', 'units', 'nav', 'avgCost', 'purchaseDate'];

  /** Asset class implied by a category string (mirrors the dashboard form). */
  function assetClassOf(category) {
    if (/Debt|Liquid|Gilt|Bond/i.test(category)) return 'Debt';
    if (/Hybrid|Balanced|Arbitrage/i.test(category)) return 'Hybrid';
    return 'Equity';
  }

  /* ---- a small RFC-4180-ish CSV row splitter (handles quoted commas) ---- */
  function splitCsvLine(line) {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  /** Parse holdings from CSV text. Returns { holdings, errors } — errors carry
   *  the 1-based source row so the UI can point at the bad line. `ter` is read
   *  as a PERCENT (e.g. 1.75 => 0.0175). Unknown columns are ignored; column
   *  order is taken from the header row. */
  function parseHoldingsCSV(text) {
    const errors = [], holdings = [];
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) return { holdings, errors: ['Empty file.'] };

    const header = splitCsvLine(lines[0]).map((h) => h.replace(/\s+/g, '').toLowerCase());
    const idx = {};
    CSV_COLUMNS.forEach((col) => { idx[col] = header.indexOf(col.toLowerCase()); });
    const missing = REQUIRED.filter((c) => idx[c] < 0);
    if (missing.length) return { holdings, errors: ['Missing required column(s): ' + missing.join(', ') + '. Expected header: ' + CSV_COLUMNS.join(',')] };

    for (let r = 1; r < lines.length; r++) {
      const cells = splitCsvLine(lines[r]);
      const get = (col) => (idx[col] >= 0 ? (cells[idx[col]] || '') : '');
      const numAt = (col) => { const raw = get(col); if (raw === '') return null; const v = parseFloat(raw.replace(/[, ]/g, '')); return isNaN(v) ? NaN : v; };

      const scheme = get('scheme');
      const units = numAt('units'), nav = numAt('nav'), avgCost = numAt('avgCost');
      const rowMsgs = [];
      if (!scheme) rowMsgs.push('missing scheme');
      [['units', units], ['nav', nav], ['avgCost', avgCost]].forEach(([n, v]) => {
        if (v === null) rowMsgs.push('missing ' + n);
        else if (isNaN(v) || v < 0) rowMsgs.push('invalid ' + n);
      });
      const purchaseDate = get('purchaseDate');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) rowMsgs.push('purchaseDate must be YYYY-MM-DD');
      const plan = /reg/i.test(get('plan')) ? 'Regular' : 'Direct';
      const category = get('category') || 'Equity';
      if (rowMsgs.length) { errors.push(`Row ${r + 1}: ${rowMsgs.join('; ')}`); continue; }

      let invested = numAt('invested');
      if (invested === null || isNaN(invested)) invested = units * avgCost;
      let ter = numAt('ter');
      ter = (ter === null || isNaN(ter)) ? null : ter / 100;

      holdings.push({
        scheme, amc: get('amc'), category, assetClass: assetClassOf(category), plan, ter,
        units, nav, avgCost, invested, purchaseDate,
        transactions: [{ date: purchaseDate, amount: invested }],
        navHistory: null, underlying: null,
      });
    }
    return { holdings, errors };
  }

  /** Serialise holdings to CSV (round-trips through parseHoldingsCSV). */
  function holdingsToCSV(holdings) {
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [CSV_COLUMNS.join(',')];
    for (const h of holdings) {
      const invested = h.invested != null ? h.invested : h.units * h.avgCost;
      rows.push([
        q(h.scheme), q(h.amc || ''), q(h.category), q(h.plan),
        h.units, h.nav, h.avgCost, Math.round(invested), q(h.purchaseDate),
        h.ter != null ? +(h.ter * 100).toFixed(4) : '',
      ].join(','));
    }
    return rows.join('\n') + '\n';
  }

  /** A ready-to-edit CSV template with one example row. */
  function csvTemplate() {
    return CSV_COLUMNS.join(',') + '\n' +
      'Bluechip Large Cap Fund,AMC One,Large Cap Equity,Direct,1234.567,121.45,78.30,100000,2021-04-15,0.55\n';
  }

  /* ---- whole-portfolio JSON (keeps navHistory/underlying when present) ---- */
  function portfolioToJSON(portfolio) {
    return JSON.stringify({
      name: portfolio.name, asOf: portfolio.asOf,
      benchmark: portfolio.benchmark ? { name: portfolio.benchmark.name, navHistory: portfolio.benchmark.navHistory } : undefined,
      holdings: portfolio.holdings,
    }, null, 2);
  }

  function parsePortfolioJSON(text) {
    const obj = JSON.parse(text);
    if (!obj || !Array.isArray(obj.holdings)) throw new Error('Not a portfolio: missing holdings array.');
    obj.holdings = obj.holdings.map((h) => ({
      navHistory: null, underlying: null, amc: '', ter: null,
      assetClass: assetClassOf(h.category || 'Equity'),
      transactions: h.transactions || (h.purchaseDate ? [{ date: h.purchaseDate, amount: h.invested != null ? h.invested : h.units * h.avgCost }] : []),
      ...h,
    }));
    return obj;
  }

  return { CSV_COLUMNS, REQUIRED, assetClassOf, splitCsvLine, parseHoldingsCSV, holdingsToCSV, csvTemplate, portfolioToJSON, parsePortfolioJSON };
});
