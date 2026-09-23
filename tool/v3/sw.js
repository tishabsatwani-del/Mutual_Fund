/* Where You Stand — the offline shell, review v4 §6, "Add to home screen".
 *
 * "On an upload-only tool this is not a nicety: it makes the whole product work
 * on a plane, which no fetching calculator can claim." That is the whole
 * argument. The tool fetches no data by design (§3), so once the shell is on
 * the phone there is nothing left for a network to be needed for: the reader's
 * own file comes off their own device and every figure is worked out there.
 *
 * TWO STRATEGIES, DELIBERATELY.
 *
 *   The page itself is NETWORK-FIRST, falling back to cache. Every sentence a
 *   reader sees comes from the copy deck, and the author is still writing it;
 *   a cache-first document would show a reader last month's sentences for as
 *   long as the icon sat on their phone. Online they always get what shipped.
 *
 *   Everything else is STALE-WHILE-REVALIDATE: served instantly from cache,
 *   refreshed in the background for next time. That is what makes it open at
 *   once, and it self-heals without anyone remembering to bump a version.
 *
 * Nothing cross-origin is ever touched, which is checked below rather than
 * assumed: the page makes no external request and this must not become the
 * one thing that does.
 */
'use strict';

var CACHE = 'where-you-stand-v1';

/* The shell: everything the four tools need to draw themselves with no
 * network at all. Data is never in here, because there is none. */
var SHELL = [
  './',
  'index.html',
  'theme.css',
  'deck.js',
  'shared.js',
  'lifeline.js',
  'spread.js',
  'record.js',
  'stand.js',
  'mine.js',
  'plan.js',
  'boot.js',
  'reading.js',
  'tokens.html',
  'tokens.js',
  '../parse.js',
  '../../sim/format.js',
  '../../sim/workbook.js',
  '../../sim/engines.js',
  '../../sim/schemes.js',
  '../../sim/position.js',
  '../../sim/states.js',
  '../../sim/upload.js',
  'manifest.webmanifest',
  'icon/icon-192.png',
  'icon/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* addAll fails the whole install if one file 404s, which would leave the
         reader with no offline shell at all and no way to know. Each file is
         added on its own, and a miss is survivable. */
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  /* Same origin only. The tool makes no external request, and this must not
     become the one place that does. */
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') { e.respondWith(networkFirst(req)); return; }
  e.respondWith(staleWhileRevalidate(req));
});

function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      return hit || caches.match('index.html') || caches.match('./');
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.match(req).then(function (hit) {
    var fresh = fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || fresh;
  });
}
