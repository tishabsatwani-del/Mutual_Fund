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
      if (!Array.isArray(list)) throw new Error('search did not return a list');
      return list.map(function (row) { return C.toScheme(row); })
                 .filter(function (s) { return s.code && s.name; });
    });
  }

  function history(code, ctx) {
    var url = BASE + '/mf/' + encodeURIComponent(code);
    return ctx.get(url).then(function (body) {
      if (!body || typeof body !== 'object') throw new Error('history did not return an object');
      /* The provider reports its own failures in the body rather than the status
       * code, so an explicit non-SUCCESS is an error here and not a series. */
      if (body.status && String(body.status).toUpperCase() !== 'SUCCESS') {
        throw new Error('provider reported ' + body.status);
      }
      var meta = body.meta || {};
      var scheme = C.toScheme({
        schemeCode: C.pick(meta, ['scheme_code', 'schemeCode']) || code,
        schemeName: C.pick(meta, ['scheme_name', 'schemeName']),
        fundHouse: C.pick(meta, ['fund_house', 'fundHouse']),
        isinGrowth: C.pick(meta, ['isin_growth', 'isinGrowth']),
        isinDivReinvestment: C.pick(meta, ['isin_div_reinvestment', 'isinDivReinvestment'])
      });
      return { scheme: scheme, series: C.toSeries(body.data) };
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
