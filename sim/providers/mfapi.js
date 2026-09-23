/* Provider 1 - api.mfapi.in (Build Specification v2, section 5.1).
 *
 * A free JSON wrapper over AMFI: search, the full scheme list, per-scheme full
 * NAV history and latest NAV, with no key and with CORS headers that make it
 * callable straight from the browser. It documents its rate limiting and asks
 * integrators to cache, which section 5.5's same-day cache satisfies.
 *
 * The spec's own note on it: "Volunteer-run: treat as replaceable." Nothing in
 * this file is relied on anywhere else; it is one implementation of the contract
 * in contract.js, and losing it costs a failover, not a rewrite.
 *
 * Shapes, as documented by the provider:
 *   GET /mf/search?q=...   ->  [ { schemeCode, schemeName, ... } ]
 *   GET /mf/{code}         ->  { meta: { fund_house, scheme_name, ... },
 *                                data: [ { date: 'DD-MM-YYYY', nav: '123.4567' } ],
 *                                status: 'SUCCESS' }
 * `data` arrives newest first; the cleaning rules of 5.2 sort it and drop the
 * junk values AMFI history carries, so no ordering assumption is made here.
 */
(function (root) {
  'use strict';

  var C = (typeof require === 'function') ? require('./contract.js') : root.SimContract;

  var BASE = 'https://api.mfapi.in';

  function search(query, ctx) {
    var url = BASE + '/mf/search?q=' + encodeURIComponent(query);
    return ctx.get(url).then(function (body) {
      var list = Array.isArray(body) ? body : (body && body.data);
      if (!Array.isArray(list)) throw C.malformed('search did not return a list');
      var mapped = list.map(function (row) { return C.toScheme(row); })
                       .filter(function (s) { return s.code && s.name; });
      /* Rows arrived but none of them could be read: that is a shape change, and
       * reporting it as "no results" would hide a broken provider behind an
       * empty screen for the rest of the session. An honestly empty list stays
       * empty. */
      if (list.length && !mapped.length) {
        throw C.malformed('none of the ' + list.length + ' search rows could be read');
      }
      return mapped;
    });
  }

  function history(code, ctx) {
    var url = BASE + '/mf/' + encodeURIComponent(code);
    return ctx.get(url).then(function (body) {
      if (!body || typeof body !== 'object') throw C.malformed('history did not return an object');
      /* This provider reports its own failures in the body rather than in the
       * HTTP status, so a non-SUCCESS body is how it says "no such scheme". That
       * is the provider working correctly, so it counts as absence -- not as a
       * fault that removes it from the chain. */
      if (body.status && String(body.status).toUpperCase() !== 'SUCCESS') {
        throw C.absent('no history for this scheme (provider reported ' + body.status + ')');
      }
      var meta = body.meta || {};
      var scheme = C.toScheme({
        schemeCode: C.pick(meta, ['scheme_code', 'schemeCode']) || code,
        schemeName: C.pick(meta, ['scheme_name', 'schemeName']),
        fundHouse: C.pick(meta, ['fund_house', 'fundHouse']),
        isinGrowth: C.pick(meta, ['isin_growth', 'isinGrowth']),
        isinDivReinvestment: C.pick(meta, ['isin_div_reinvestment', 'isinDivReinvestment'])
      });
      var rows = Array.isArray(body.data) ? body.data : [];
      if (!rows.length) throw C.absent('the provider has no NAV rows for this scheme');
      var series = C.toSeries(rows);
      /* Rows arrived but every one of them was unreadable. Section 5.2 says to
       * drop junk values silently, and a handful of them is normal; all of them
       * means the shape moved. */
      if (!series.length) throw C.malformed('none of the ' + rows.length + ' NAV rows could be read');
      return { scheme: scheme, series: series };
    });
  }

  var adapter = {
    id: 'mfapi',
    label: 'api.mfapi.in',
    /* Shapes are the provider's documented ones. Section 16.2 still requires a
     * live check of CORS headers, rate-limit behaviour and date format on day
     * one; until that check is recorded, this stays false and the build says so. */
    verified: false,
    base: BASE,
    search: search,
    history: history
  };

  if (typeof module === 'object' && module.exports) module.exports = adapter;
  root.SimProviderMfapi = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
