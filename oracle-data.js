/* =====================================================================
 * Autonomous Portfolio Oracle — real market-data adapter
 * ---------------------------------------------------------------------
 * The "real live data" layer: pull actual mutual-fund NAV histories from the
 * free, public India MF API (mfapi.in) and map them onto the SAME holding /
 * portfolio model the rest of the Oracle already uses — so real funds get
 * real rolling returns, real Alpha/Beta/Sharpe, real drawdowns.
 *
 * Design:
 *   • The PURE transforms (date/category parsing, monthly resampling, holding
 *     construction) are dependency-free and unit-tested against fixtures, so
 *     they're verified without any network.
 *   • The thin async fetchers use the browser's fetch(); they degrade
 *     gracefully when offline (the rest of the tool stays fully usable).
 *
 * Reaching the network is inherent to "live data" and is the one place the
 * tool talks to the internet; everything else remains offline-capable.
 * ===================================================================== */
'use strict';

(function (root, factory) {
  const DATA = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  if (typeof window !== 'undefined') window.ORACLE_DATA = DATA;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const BASE = 'https://api.mfapi.in/mf';

  /** Map an mfapi scheme_category string to our coarse asset class. */
  function assetClassOf(category) {
    const c = String(category || '');
    if (/Debt|Liquid|Gilt|Bond|Money Market|Overnight|Duration|Credit/i.test(c)) return 'Debt';
    if (/Hybrid|Balanced|Arbitrage|Asset Allocation|Multi Asset/i.test(c)) return 'Hybrid';
    if (/Solution|Retirement|Children/i.test(c)) return 'Hybrid';
    return 'Equity';
  }

  /** "dd-mm-yyyy" -> "yyyy-mm-dd" (mfapi's date format). */
  function parseMfDate(s) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s).trim());
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  /** Resample a chronological [{date:'yyyy-mm-dd', nav:Number}] series to one
   *  point per calendar month (the last NAV of each month), keeping at most
   *  `maxMonths` most-recent months. Returns plain Number NAVs, oldest first. */
  function toMonthly(chrono, maxMonths = 60) {
    const byMonth = new Map(); // 'yyyy-mm' -> nav (last wins, since chrono ascending)
    for (const pt of chrono) byMonth.set(pt.date.slice(0, 7), pt.nav);
    const months = Array.from(byMonth.keys()).sort();
    const recent = months.slice(-maxMonths);
    return recent.map((k) => byMonth.get(k));
  }

  /** Parse a raw mfapi fund response into our normalised shape. The API returns
   *  data newest-first; we sort ascending and monthly-resample. */
  function parseFund(apiJson, maxMonths = 60) {
    if (!apiJson || !apiJson.meta || !Array.isArray(apiJson.data)) {
      throw new Error('Unexpected fund payload.');
    }
    const chrono = apiJson.data
      .map((d) => ({ date: parseMfDate(d.date), nav: parseFloat(d.nav) }))
      .filter((d) => d.date && isFinite(d.nav) && d.nav > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (!chrono.length) throw new Error('No usable NAV points.');
    const category = apiJson.meta.scheme_category || '';
    return {
      schemeCode: apiJson.meta.scheme_code,
      scheme: apiJson.meta.scheme_name || 'Unknown scheme',
      amc: apiJson.meta.fund_house || '',
      category,
      assetClass: assetClassOf(category),
      plan: /direct/i.test(apiJson.meta.scheme_name || '') ? 'Direct' : (/regular/i.test(apiJson.meta.scheme_name || '') ? 'Regular' : 'Direct'),
      latestNav: chrono[chrono.length - 1].nav,
      latestDate: chrono[chrono.length - 1].date,
      navHistory: toMonthly(chrono, maxMonths),
    };
  }

  /** Build a holding from a parsed fund plus the investor's position. If only
   *  `invested` (or `units`) is known, the other is derived from avgCost/NAV. */
  function buildHolding(parsed, position = {}) {
    const purchaseDate = position.purchaseDate || parsed.navHistory.length ? position.purchaseDate : null;
    const avgCost = position.avgCost != null ? position.avgCost : parsed.latestNav;
    let units = position.units, invested = position.invested;
    if (units == null && invested != null) units = invested / avgCost;
    if (units == null && invested == null) { units = 0; invested = 0; }
    if (invested == null) invested = units * avgCost;
    return {
      scheme: parsed.scheme, amc: parsed.amc, category: parsed.category, assetClass: parsed.assetClass,
      plan: position.plan || parsed.plan, ter: position.ter != null ? position.ter : null,
      units, nav: parsed.latestNav, avgCost,
      invested,
      purchaseDate: purchaseDate || position.purchaseDate || parsed.latestDate,
      transactions: [{ date: position.purchaseDate || parsed.latestDate, amount: invested }],
      navHistory: parsed.navHistory,
      underlying: null,
      schemeCode: parsed.schemeCode,
    };
  }

  /* ---- async fetchers (browser; degrade gracefully offline) ---- */
  async function searchFunds(query) {
    if (typeof fetch === 'undefined') throw new Error('No network in this environment.');
    const res = await fetch(`${BASE}/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed (' + res.status + ').');
    const list = await res.json();
    return (Array.isArray(list) ? list : []).map((x) => ({ schemeCode: x.schemeCode, schemeName: x.schemeName }));
  }

  async function fetchFund(schemeCode, maxMonths = 60) {
    if (typeof fetch === 'undefined') throw new Error('No network in this environment.');
    const res = await fetch(`${BASE}/${encodeURIComponent(schemeCode)}`);
    if (!res.ok) throw new Error('Fund fetch failed (' + res.status + ').');
    return parseFund(await res.json(), maxMonths);
  }

  return { BASE, assetClassOf, parseMfDate, toMonthly, parseFund, buildHolding, searchFunds, fetchFund };
});
