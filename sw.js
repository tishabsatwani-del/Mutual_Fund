/* Two Doors, One Storm — offline cache (audit T9, ticket N5).
 * Network first, so a new deploy is picked up on the next open; the last good
 * copy of the gate and the voice clips serve when there is no signal (a reader
 * on a train). The simulator itself needs nothing from the network once the
 * gate has loaded — everything is computed on the phone. */
const CACHE = 'tdos-v4';

/* N5 — the recordings are precached on install. Without this, a reader who
 * opens the tool offline for their first full run reaches a clip that has
 * never been fetched, the request fails, and the device voice speaks instead
 * of the author's. Nothing is lost while no recordings exist; the moment they
 * ship, this is what makes them play.
 *
 * Only the nine voice notes are listed. Three older narration clips
 * (opening, crash, emergency) used to be precached here; they belonged to the
 * two-door opening and the advisor phone call, both of which have since been
 * replaced, and nothing in the page requests them any more. They were removed
 * from the site rather than left served in the clear. voice/access.mp3 is not
 * precached because the gate fetches it on the reader's first touch, which is
 * necessarily online. */
const NOTE_KEYS = ['covid', 'gfc', 'corr2022', 'drawn', 'icu', 'business', 'pandemic', 'war', 'jobloss'];
const PRECACHE = NOTE_KEYS.reduce((a, k) => a.concat(['voice/notes/' + k + '.m4a', 'voice/notes/' + k + '.ogg']), []);

self.addEventListener('install', (e) => {
  self.skipWaiting();
  /* One file at a time, each failure swallowed: a recording that is not in the
   * build yet must not fail the install and leave the reader with no cache at all.
   * cache.addAll would reject the whole set on the first missing file. */
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))));
});

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
    }).catch(() =>
      /* N5 — the offline branch always resolves to a Response. It used to resolve
       * to undefined for an uncached non-navigation request, which rejects
       * respondWith and surfaces as an unhandled rejection in the console.
       * ignoreSearch so the head's cache-busting ?v= query still finds the clip. */
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./').then((page) => page || Response.error());
        return Response.error();
      })
    )
  );
});
