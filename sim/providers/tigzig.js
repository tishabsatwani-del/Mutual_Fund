/* Provider 2 - TIGZIG MFPRO API (Build Specification v2, section 5.1).
 *
 * A free, no-key, AMFI-derived API with scheme search and per-scheme history.
 *
 * The spec is explicit about this one: "Confirm exact endpoint shapes from its
 * live documentation at build time; do not hardcode from this spec." So the
 * endpoint paths and field spellings are not hardcoded through the file. They
 * sit in the ENDPOINTS block below, which is the only thing that changes when
 * the live shapes are confirmed, and `verified` stays false until then.
 *
 * The extraction underneath is shape-tolerant on purpose: it accepts the field
 * spellings these AMFI-derived APIs are actually written with, so confirming
 * the live documentation is expected to be an edit to ENDPOINTS and nothing
 * more. Run sim/tests/access.test.js afterwards -- the conformance harness in
 * contract.js is what proves the adapter, and it is the same harness provider 1
 * passes.
 */
(function (root) {
  'use strict';

  var C = (typeof require === 'function') ? require('./contract.js') : root.SimContract;

  /* ------------------------------------------------------------------ CONFIRM
   * Every value in this block is provisional until checked against the live
   * documentation. Nothing else in the file needs to change.
   * -------------------------------------------------------------------------- */
  var ENDPOINTS = {
    base: 'https://mfapi.tigzig.com',
    search: '/api/scheme/search?q={query}',
    history: '/api/scheme/{code}/nav',
    /* Where the payload hides the rows, tried in order. An empty string means
     * the response body is itself the list. */
    searchListAt: ['', 'data', 'results', 'schemes'],
    historyListAt: ['data', 'nav', 'navHistory', 'history', ''],
    metaAt: ['meta', 'scheme', 'schemeDetails'],
    /* Where the payload says "no such scheme" when it answers 200 rather than
     * 404. Confirm the real spelling with the endpoints above; until then a body
     * that cannot be read at all is treated as a shape change, which fails over
     * and skips the provider, rather than as absence. */
    errorAt: ['detail', 'error', 'message', 'status']
  };
  /* ----------------------------------------------------------------------- */

  function at(body, paths) {
    for (var i = 0; i < paths.length; i++) {
      var value = paths[i] === '' ? body : C.pick(body, [paths[i]]);
      if (Array.isArray(value)) return value;
    }
    return null;
  }

  function metaOf(body) {
    for (var i = 0; i < ENDPOINTS.metaAt.length; i++) {
      var value = C.pick(body, [ENDPOINTS.metaAt[i]]);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
    return body && typeof body === 'object' ? body : {};
  }

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (_, key) {
      return encodeURIComponent(values[key]);
    });
  }

  /* An explicit "not found" in the body, in whichever field this provider uses. */
  function statedAbsence(body) {
    for (var i = 0; i < ENDPOINTS.errorAt.length; i++) {
      var value = C.pick(body, [ENDPOINTS.errorAt[i]]);
      if (typeof value === 'string' && /not\s*found|no\s*such|invalid|unknown/i.test(value)) return value;
    }
    return null;
  }

  function search(query, ctx) {
    return ctx.get(ENDPOINTS.base + fill(ENDPOINTS.search, { query: query })).then(function (body) {
      var list = at(body, ENDPOINTS.searchListAt);
      if (!list) {
        var said = statedAbsence(body);
        if (said) return [];
        throw C.malformed('search did not return a list');
      }
      var mapped = list.map(function (row) { return C.toScheme(row); })
                       .filter(function (s) { return s.code && s.name; });
      if (list.length && !mapped.length) {
        throw C.malformed('none of the ' + list.length + ' search rows could be read');
      }
      return mapped;
    });
  }

  function history(code, ctx) {
    return ctx.get(ENDPOINTS.base + fill(ENDPOINTS.history, { code: code })).then(function (body) {
      var rows = at(body, ENDPOINTS.historyListAt);
      if (!rows) {
        var said = statedAbsence(body);
        if (said) throw C.absent('no history for this scheme (provider said "' + said + '")');
        throw C.malformed('history did not return a list');
      }
      if (!rows.length) throw C.absent('the provider has no NAV rows for this scheme');
      var meta = metaOf(body);
      var scheme = C.toScheme({
        schemeCode: C.pick(meta, ['schemeCode', 'scheme_code', 'code']) || code,
        schemeName: C.pick(meta, ['schemeName', 'scheme_name', 'name']),
        fundHouse: C.pick(meta, ['fundHouse', 'fund_house', 'amc']),
        isinGrowth: C.pick(meta, ['isinGrowth', 'isin_growth']),
        isinDivReinvestment: C.pick(meta, ['isinDivReinvestment', 'isin_div_reinvestment'])
      });
      var series = C.toSeries(rows);
      if (!series.length) throw C.malformed('none of the ' + rows.length + ' NAV rows could be read');
      return { scheme: scheme, series: series };
    });
  }

  var adapter = {
    id: 'tigzig',
    label: 'TIGZIG MFPRO API',
    /* False until the endpoint shapes above are confirmed against the live
     * documentation, which section 5.1 requires and this environment -- with no
     * outbound network -- cannot do. */
    verified: false,
    endpoints: ENDPOINTS,
    search: search,
    history: history
  };

  if (typeof module === 'object' && module.exports) module.exports = adapter;
  root.SimProviderTigzig = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
