/* Two Doors, One Storm — offline cache (audit T9).
 * Network first, so a new deploy is picked up on the next open; the last good
 * copy of the gate and the voice clips serve when there is no signal (a reader
 * on a train). The simulator itself needs nothing from the network once the
 * gate has loaded — everything is computed on the phone. */
const CACHE = 'tdos-v2';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined)))
  );
});
