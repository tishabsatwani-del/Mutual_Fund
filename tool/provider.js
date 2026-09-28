/* The seam for automatic fund lookup.
 *
 * No provider is wired in. The tool works today without one, and this file
 * exists so that adding one later is configuration rather than a rebuild.
 *
 * WHY IT IS EMPTY
 * ---------------
 * A provider has to be chosen on grounds this code cannot settle: whether its
 * terms permit this use, whether it sends CORS headers (without them a browser
 * refuses the request and no code fixes it), and whether it is still going to
 * be there in five years. Wiring one in untested, behind an address printed in
 * a book, would be worse than the upload path that already works for every
 * fund that exists.
 *
 * THE CONTRACT
 * ------------
 * A provider is a plain object with two methods, both returning promises:
 *
 *   search(query) -> [{ id, name, plan, option, identifier }]
 *
 *     `id` is whatever the provider needs to fetch history later. The rest is
 *     shown to the reader so they can tell near-identical schemes apart --
 *     §18: never silently assume a similarly named scheme. Return [] for no
 *     matches; reject with an Error for a failed lookup.
 *
 *   history(id) -> [[date, value], [date, value], ...]
 *
 *     Rows exactly as the provider gives them. Dates may be strings in any of
 *     the formats the tool already reads. Do NOT clean, sort, de-duplicate or
 *     fill gaps here: the rows go through the same validation as an uploaded
 *     file, so an automatically fetched fund is held to exactly the same
 *     standard as one a reader typed in.
 *
 * ADDING ONE
 * ----------
 * Load a script before this one that sets `window.PRC_PROVIDER`, or call
 * `PRCProvider.register(...)` after it:
 *
 *   PRCProvider.register({
 *     name: 'Example data service',
 *     search: function (query) {
 *       return fetch('https://example.test/search?q=' + encodeURIComponent(query))
 *         .then(function (r) { if (!r.ok) throw new Error('lookup failed'); return r.json(); })
 *         .then(function (rows) {
 *           return rows.map(function (row) {
 *             return { id: row.code, name: row.schemeName,
 *                      plan: row.plan, option: row.option, identifier: row.isin };
 *           });
 *         });
 *     },
 *     history: function (id) {
 *       return fetch('https://example.test/scheme/' + encodeURIComponent(id))
 *         .then(function (r) { if (!r.ok) throw new Error('history unavailable'); return r.json(); })
 *         .then(function (d) { return d.data.map(function (p) { return [p.date, p.nav]; }); });
 *     }
 *   });
 *
 * Before relying on it, check the four things that decide whether it holds:
 * the terms permit this use; it sends CORS headers to a static page; it covers
 * the funds your readers hold; and it fails loudly rather than returning
 * something plausible when it has nothing.
 */
(function (root) {
  'use strict';

  var provider = null;

  function register(p) {
    if (!p || typeof p.search !== 'function' || typeof p.history !== 'function') {
      throw new Error('A provider needs a search(query) and a history(id), both returning promises.');
    }
    provider = p;
    return provider;
  }

  function get() { return provider; }
  function clear() { provider = null; }

  root.PRCProvider = { register: register, get: get, clear: clear };

  /* lets a deployment wire one in without editing this file */
  if (root.PRC_PROVIDER) { register(root.PRC_PROVIDER); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
