/* Provider 3 - the author's own Cloudflare Worker (section 5.1).
 *
 * AMFI does not send CORS headers, which is this Worker's entire reason to
 * exist: it fetches AMFI's own files, parses them, adds the headers a browser
 * needs, and caches at the edge for about six hours.
 *
 * It is deliberately not written yet.
 *
 * AMFI's old NAV download format retires on 28 August 2026, and both the spec
 * (5.1) and the author's instruction say the same thing: build the Worker
 * against the new format, inspected live. Writing a parser now would mean
 * writing it against a format that is about to stop existing, and then being
 * unable to tell whether a failure came from the parser or from the change.
 *
 * So the adapter exists, holds its place in the chain, and refuses in a way the
 * access layer understands: it is skipped like any unavailable provider, and it
 * reports why rather than pretending to be absent. When the new format is
 * inspectable, only this file and its fixtures change; nothing upstream moves.
 */
(function (root) {
  'use strict';

  var NOT_BUILT = 'the Worker parser is not written yet: AMFI\'s new file format ' +
                  'is inspected live before it is built';

  function notBuilt() { return Promise.reject(new Error(NOT_BUILT)); }

  var adapter = {
    id: 'worker',
    label: 'own Cloudflare Worker',
    verified: false,
    built: false,
    reason: NOT_BUILT,
    search: notBuilt,
    history: notBuilt
  };

  if (typeof module === 'object' && module.exports) module.exports = adapter;
  root.SimProviderWorker = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
