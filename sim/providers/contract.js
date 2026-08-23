/* The Simulator - the one interface every data provider is reached through.
 *
 * Build Specification v2, section 5.1: "The app never talks to a single provider
 * directly; it talks to one internal access layer with three implementations,
 * tried in order." This file is that interface, plus the validation the layer
 * uses to decide whether what came back is usable.
 *
 * An adapter is a plain object:
 *
 *   {
 *     id:       'mfapi',                     stable, used in logs and the drill
 *     label:    'api.mfapi.in',              shown only in the About page
 *     verified: true,                        have the live shapes been confirmed?
 *     search:   function (query, ctx) -> Promise<Scheme[]>
 *     history:  function (code, ctx)  -> Promise<{ scheme, series }>
 *   }
 *
 * ctx carries { get, signal }: `get` is a transport the layer supplies, so an
 * adapter never reaches for fetch itself. That is what lets the whole chain be
 * tested against canned responses, and what keeps the 8-second timeout and the
 * failover policy in one place instead of scattered through three files.
 *
 * The shapes an adapter returns are section 5.2's:
 *   Scheme     { code, name, fundHouse, isinGrowth?, isinIdcw? }
 *   NavSeries  [ { date: 'YYYY-MM-DD', nav: number } ]  ascending, cleaned
 */
(function (root) {
  'use strict';

  var S = (typeof require === 'function') ? require('../schemes.js') : root.SimSchemes;

  /* Section 5.1: a provider that returns malformed data is skipped for the rest
   * of the session. "Malformed" has to mean something exact, or the rule cannot
   * be applied, so it means: does not satisfy the contract below. The layer
   * checks this itself rather than trusting each adapter to be strict. */

  function validateSchemes(value) {
    if (!Array.isArray(value)) return 'not a list';
    for (var i = 0; i < value.length; i++) {
      var s = value[i];
      if (!s || typeof s !== 'object') return 'entry ' + i + ' is not an object';
      if (!(typeof s.code === 'string' || typeof s.code === 'number') || String(s.code) === '') {
        return 'entry ' + i + ' has no scheme code';
      }
      if (typeof s.name !== 'string' || !s.name.trim()) return 'entry ' + i + ' has no scheme name';
    }
    return null;
  }

  function validateSeries(value) {
    if (!Array.isArray(value)) return 'not a list';
    if (value.length < 2) return 'fewer than two observations';
    var previous = '';
    for (var i = 0; i < value.length; i++) {
      var p = value[i];
      if (!p || typeof p !== 'object') return 'observation ' + i + ' is not an object';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return 'observation ' + i + ' has no ISO date';
      if (!(typeof p.nav === 'number' && isFinite(p.nav) && p.nav > 0)) {
        return 'observation ' + i + ' has no positive NAV';
      }
      if (p.date <= previous) return 'observations are not strictly ascending at ' + i;
      previous = p.date;
    }
    return null;
  }

  function validateHistory(value) {
    if (!value || typeof value !== 'object') return 'not an object';
    var bad = validateSchemes([value.scheme || {}]);
    if (bad) return 'scheme: ' + bad;
    return validateSeries(value.series);
  }

  /* Adapters differ in what they call things; every one of them ends here, so
   * the cleaning rules of 5.2 are applied exactly once, in exactly one place. */
  function toScheme(raw, map) {
    var m = map || {};
    var code = pick(raw, m.code || ['schemeCode', 'scheme_code', 'code', 'id']);
    var name = pick(raw, m.name || ['schemeName', 'scheme_name', 'name', 'schemeNAME']);
    var out = { code: String(code == null ? '' : code).trim(), name: String(name == null ? '' : name).trim() };
    var house = pick(raw, m.fundHouse || ['fundHouse', 'fund_house', 'amc', 'amcName', 'mutualFundFamily']);
    if (house) out.fundHouse = String(house).trim();
    var growth = pick(raw, m.isinGrowth || ['isinGrowth', 'isin_growth', 'isinGrowthPayout', 'isin']);
    if (growth) out.isinGrowth = String(growth).trim();
    var idcw = pick(raw, m.isinIdcw || ['isinDivReinvestment', 'isin_div_reinvestment', 'isinIdcw', 'isin_idcw']);
    if (idcw) out.isinIdcw = String(idcw).trim();
    return out;
  }

  function toSeries(rows, map) {
    var m = map || {};
    var dateKeys = m.date || ['date', 'Date', 'navDate', 'nav_date', 'asOn'];
    var navKeys = m.nav || ['nav', 'NAV', 'navValue', 'nav_value', 'value', 'netAssetValue'];
    var shaped = (rows || []).map(function (r) {
      if (Array.isArray(r)) return { date: r[0], nav: r[1] };
      return { date: pick(r, dateKeys), nav: pick(r, navKeys) };
    });
    return S.cleanSeries(shaped).series;
  }

  /* Providers rename fields between versions, and a rename should degrade to a
   * skipped provider, never to a wrong number. Trying several spellings costs
   * nothing and makes an adapter survive a cosmetic change. */
  function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return undefined;
    var list = typeof keys === 'string' ? [keys] : keys;
    for (var i = 0; i < list.length; i++) {
      if (obj[list[i]] !== undefined && obj[list[i]] !== null && obj[list[i]] !== '') return obj[list[i]];
    }
    /* one case-insensitive sweep, so schemeName and schemename both land */
    var lower = {};
    Object.keys(obj).forEach(function (k) { lower[k.toLowerCase()] = obj[k]; });
    for (var j = 0; j < list.length; j++) {
      var v = lower[String(list[j]).toLowerCase()];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  /* One harness every adapter is run through, so "does this adapter satisfy the
   * contract" is a question with a single answer rather than one per file. It
   * takes canned responses, so it proves the adapter's shape handling without
   * touching the network -- and it is the same harness that will prove TIGZIG
   * once its live shapes are confirmed. */
  function conform(adapter, canned) {
    var problems = [];
    function note(what, detail) { problems.push(what + (detail ? ': ' + detail : '')); }

    ['id', 'label'].forEach(function (k) {
      if (typeof adapter[k] !== 'string' || !adapter[k]) note('missing ' + k);
    });
    if (typeof adapter.search !== 'function') note('missing search()');
    if (typeof adapter.history !== 'function') note('missing history()');
    if (typeof adapter.verified !== 'boolean') note('missing verified flag');
    if (problems.length) return Promise.resolve(problems);

    var ctx = { get: cannedTransport(canned) };
    return adapter.search('test', ctx).then(function (schemes) {
      var bad = validateSchemes(schemes);
      if (bad) note('search() output', bad);
      if (!schemes.length) note('search() returned nothing for the canned response');
      return adapter.history(canned.code, ctx);
    }).then(function (history) {
      var bad = validateHistory(history);
      if (bad) note('history() output', bad);
      return problems;
    }).catch(function (err) {
      note('threw', err && err.message);
      return problems;
    });
  }

  function cannedTransport(canned) {
    return function (url) {
      var keys = Object.keys(canned.responses || {});
      for (var i = 0; i < keys.length; i++) {
        if (url.indexOf(keys[i]) >= 0) return Promise.resolve(canned.responses[keys[i]]);
      }
      return Promise.reject(new Error('no canned response for ' + url));
    };
  }

  var api = {
    validateSchemes: validateSchemes, validateSeries: validateSeries,
    validateHistory: validateHistory,
    toScheme: toScheme, toSeries: toSeries, pick: pick,
    conform: conform, cannedTransport: cannedTransport
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
