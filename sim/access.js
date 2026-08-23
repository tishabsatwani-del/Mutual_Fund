/* The Simulator - the data access layer of sections 5.1, 5.3 and 5.5.
 *
 * "The app never talks to a single provider directly; it talks to one internal
 * access layer with three implementations, tried in order." Everything the rest
 * of the app knows about data arrives through the two methods here.
 *
 * What this file owns, so that no adapter has to:
 *   the order of the chain and the failover rule (5.1)
 *   the 8-second timeout (5.1)
 *   deciding whether a reply is malformed, against contract.js (5.1)
 *   the same-day cache and the session search cache (5.5)
 *   never more than two history fetches in flight (5.5)
 *   the forced-failover drill of acceptance criterion 12 (16.4)
 *
 * The visitor's own entries never come near this file. The only things it ever
 * requests are public scheme data: a search string and a scheme code (Principle
 * 5, and acceptance criterion 10).
 */
(function (root) {
  'use strict';

  var C = (typeof require === 'function') ? require('./providers/contract.js') : root.SimContract;
  var Cache = (typeof require === 'function') ? require('./cache.js') : root.SimCache;

  var TIMEOUT_MS = 8000;              /* section 5.1 */
  var MAX_HISTORY_IN_FLIGHT = 2;      /* section 5.5 */
  var SEARCH_DEBOUNCE_MS = 300;       /* section 5.3 */

  /* A provider that errors, times out, or returns malformed data is skipped for
   * the rest of the session (5.1). Read strictly, that also blacklists a
   * provider for correctly answering "no such scheme", which would burn the
   * whole chain on one bad code. So a reply that is a valid answer meaning
   * "not here" is treated as absence, not as failure: the chain moves on and
   * the provider stays healthy. Recorded in sim/README.md.
   *
   * Absence is not only an HTTP status. api.mfapi.in reports its own failures
   * inside a 200 body, so the adapters tag what they know: an explicit "no such
   * scheme" is C.absent, an unreadable payload is C.malformed. Reading the
   * status alone missed exactly the provider the code documents as answering
   * in-body. */
  function classify(error) {
    if (error && error.absent) return 'absent';
    if (error && error.malformed) return 'malformed';
    var status = error && error.status;
    if (status === 404 || status === 400 || status === 410) return 'absent';
    return 'failed';
  }

  function timeoutError(ms) {
    var e = new Error('provider did not answer within ' + (ms / 1000) + ' seconds');
    e.timedOut = true;
    return e;
  }

  /* The default transport. Adapters never call this; they are handed it, which
   * is what keeps the timeout and the failure classification in one place. */
  function browserTransport() {
    return function (url, options) {
      var opts = options || {};
      return fetch(url, { signal: opts.signal, credentials: 'omit', mode: 'cors' })
        .then(function (response) {
          if (!response.ok) {
            var e = new Error('provider answered ' + response.status);
            e.status = response.status;
            throw e;
          }
          return response.json();
        });
    };
  }

  function withTimeout(promiseFactory, ms, hasAbort) {
    var controller = hasAbort && typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    return new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(timeoutError(ms));
      }, ms);
      promiseFactory(controller ? controller.signal : undefined).then(resolve, reject);
    }).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  /* Section 5.5: never more than two history fetches in flight; queue the rest. */
  function createQueue(limit) {
    var running = 0, waiting = [];
    function next() {
      if (running >= limit || !waiting.length) return;
      running++;
      var job = waiting.shift();
      job.run().then(job.resolve, job.reject).then(function () {
        running--;
        next();
      });
    }
    return {
      add: function (run) {
        return new Promise(function (resolve, reject) {
          waiting.push({ run: run, resolve: resolve, reject: reject });
          next();
        });
      },
      inFlight: function () { return running; },
      queued: function () { return waiting.length; }
    };
  }

  function createAccess(options) {
    var opts = options || {};
    var providers = opts.providers || [];
    var transport = opts.transport || browserTransport();
    var timeoutMs = opts.timeoutMs == null ? TIMEOUT_MS : opts.timeoutMs;
    var cache = opts.cache || Cache.createCache({ now: opts.now });
    var queue = createQueue(opts.maxHistoryInFlight || MAX_HISTORY_IN_FLIGHT);
    var hasAbort = opts.abortable !== false;

    var skipped = {};            /* provider id -> why, for the rest of the session */
    var blocked = {};            /* the drill of 16.4 */
    var attempts = [];           /* what happened, for the About page and the drill */
    /* Object.create(null), not {}: a scheme code of "constructor" or "__proto__"
     * would otherwise resolve against Object.prototype and hand the caller
     * something that is not a promise, crashing it synchronously. */
    var inFlightByCode = Object.create(null);

    (opts.block || []).forEach(function (id) { blocked[id] = 'blocked for the failover drill'; });

    function usable() {
      return providers.filter(function (p) { return !skipped[p.id] && !blocked[p.id]; });
    }

    function record(entry) {
      attempts.push(entry);
      if (attempts.length > 50) attempts.shift();
      return entry;
    }

    /* Walk the chain in order. `call` runs one provider; `validate` says whether
     * what came back is usable. Returns the first good answer, or a failure
     * carrying everything that went wrong on the way. */
    function chain(call, validate, what) {
      var list = usable();
      var reasons = [];
      var sawAbsence = false;

      function step(i) {
        if (i >= list.length) {
          /* Two different failures need two different sentences. Every provider
           * saying "nothing here" means the scheme is missing, and telling the
           * visitor the data providers are down would be untrue. */
          return Promise.resolve({
            ok: false,
            kind: sawAbsence ? 'absent' : 'down',
            reasons: reasons
          });
        }
        var provider = list[i];
        return withTimeout(function (signal) {
          /* An adapter that throws rather than rejecting is still a provider
           * fault, not an exception escaping the layer. */
          try {
            return Promise.resolve(call(provider, { get: function (url, o) {
              return transport(url, { signal: (o && o.signal) || signal });
            }, signal: signal }));
          } catch (thrown) { return Promise.reject(thrown); }
        }, timeoutMs, hasAbort).then(function (value) {
          var bad = validate(value);
          if (bad) {
            /* Malformed data is a provider fault, not an absence. */
            skipped[provider.id] = 'returned malformed data (' + bad + ')';
            record({ provider: provider.id, what: what, outcome: 'malformed', detail: bad });
            reasons.push(provider.id + ': malformed (' + bad + ')');
            return step(i + 1);
          }
          record({ provider: provider.id, what: what, outcome: 'ok' });
          return { ok: true, value: value, provider: provider.id };
        }, function (error) {
          var kind = error && error.timedOut ? 'failed' : classify(error);
          var detail = (error && error.message) || String(error);
          /* Only a fault removes a provider from the chain. An honest "not
           * here" leaves it available for the next scheme. */
          if (kind === 'failed' || kind === 'malformed') skipped[provider.id] = detail;
          if (kind === 'absent') sawAbsence = true;
          record({ provider: provider.id, what: what, outcome: kind, detail: detail });
          reasons.push(provider.id + ': ' + detail);
          return step(i + 1);
        });
      }

      return step(0);
    }

    return {
      /* Section 5.3: provider search, cached per query string for the session. */
      search: function (query) {
        var q = String(query || '').trim();
        if (!q) return Promise.resolve({ ok: true, schemes: [], provider: null, cached: false });

        var hit = cache.readSearch(q);
        if (hit) return Promise.resolve({ ok: true, schemes: hit.schemes, provider: hit.provider, cached: true });

        return chain(
          function (p, ctx) { return p.search(q, ctx); },
          C.validateSchemes,
          'search'
        ).then(function (result) {
          if (!result.ok) {
            if (result.kind === 'absent') {
              return { ok: true, schemes: [], provider: null, cached: false, slot: 'EMPTY-SEARCH' };
            }
            return { ok: false, schemes: [], slot: 'ERR-DATA-DOWN', reasons: result.reasons };
          }
          cache.writeSearch(q, { schemes: result.value, provider: result.provider });
          return { ok: true, schemes: result.value, provider: result.provider,
                   cached: false, slot: result.value.length ? null : 'EMPTY-SEARCH' };
        });
      },

      /* Section 5.5: a repeat view on the same day makes zero network calls.
       * Section 5.1: when every provider is unreachable, the last good copy is
       * shown, labelled, rather than a blank screen. */
      history: function (code) {
        /* Module A asks for the fund and its proxy, and Module B may ask for the
         * same fund again a moment later. One in-flight fetch per scheme serves
         * every caller: section 5.5 asks integrators to respect rate limiting,
         * and the cheapest request is the one never sent. */
        if (inFlightByCode[code]) return inFlightByCode[code];

        var work = cache.readHistory(code).then(function (cached) {
          if (cached.hit && cached.fresh) {
            return { ok: true, scheme: cached.value.scheme, series: cached.value.series,
                     provider: null, cached: true, stale: false };
          }
          return queue.add(function () {
            return chain(
              function (p, ctx) { return p.history(code, ctx); },
              C.validateHistory,
              'history:' + code
            );
          }).then(function (result) {
            if (result.ok) {
              return cache.writeHistory(code, result.value).then(function () {
                return { ok: true, scheme: result.value.scheme, series: result.value.series,
                         provider: result.provider, cached: false, stale: false };
              });
            }
            /* Section 5.6: a scheme that has stopped being served keeps its
             * history. A stored copy is still worth showing, labelled. */
            if (cached.hit) {
              return { ok: true, scheme: cached.value.scheme, series: cached.value.series,
                       provider: null, cached: true, stale: true, storedOn: cached.storedOn,
                       slot: result.kind === 'absent' ? 'RR-STALE' : 'ERR-DATA-DOWN',
                       reasons: result.reasons };
            }
            return { ok: false, kind: result.kind,
                     slot: result.kind === 'absent' ? 'RR-NO-HISTORY' : 'ERR-DATA-DOWN',
                     reasons: result.reasons };
          });
        });

        inFlightByCode[code] = work;
        return work.then(
          function (v) { delete inFlightByCode[code]; return v; },
          function (e) { delete inFlightByCode[code]; throw e; }
        );
      },

      /* Acceptance criterion 12's drill, and the About page's honesty about
       * which provider answered. */
      block: function (id) { blocked[id] = 'blocked for the failover drill'; },
      unblock: function (id) { delete blocked[id]; },
      state: function () {
        return {
          providers: providers.map(function (p) {
            return {
              id: p.id, label: p.label, verified: p.verified,
              status: blocked[p.id] ? 'blocked' : (skipped[p.id] ? 'skipped' : 'available'),
              reason: blocked[p.id] || skipped[p.id] || null
            };
          }),
          inFlight: queue.inFlight(),
          queued: queue.queued(),
          attempts: attempts.slice()
        };
      },
      cache: cache
    };
  }

  /* Section 5.3's 300 ms, kept here so the search box cannot get it wrong. */
  function debounce(fn, ms) {
    var timer = null;
    var wait = ms == null ? SEARCH_DEBOUNCE_MS : ms;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  var api = {
    TIMEOUT_MS: TIMEOUT_MS, MAX_HISTORY_IN_FLIGHT: MAX_HISTORY_IN_FLIGHT,
    SEARCH_DEBOUNCE_MS: SEARCH_DEBOUNCE_MS,
    createAccess: createAccess, createQueue: createQueue, browserTransport: browserTransport,
    classify: classify, debounce: debounce
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimAccess = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
