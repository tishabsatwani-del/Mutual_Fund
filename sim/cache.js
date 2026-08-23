/* The Simulator - the on-device cache of section 5.5.
 *
 * Two caches with two different lifetimes, because they answer two different
 * questions:
 *
 *   NAV history   IndexedDB, same-day TTL. "A repeat view on the same day makes
 *                 zero network calls." It also keeps the last good copy past
 *                 its TTL, because section 5.1's all-providers-down rule needs
 *                 something to show, and stale-and-labelled beats blank.
 *   Search        memory, for the session only. Query strings are cheap to
 *                 re-ask and a stale search result is worth nothing.
 *
 * Nothing the visitor types is stored here. Module A's transactions never reach
 * this file; the only things cached are public scheme data (Principle 5).
 *
 * The store is injectable so the same cache logic runs in the browser against
 * IndexedDB and in the fixtures against memory, rather than being two
 * implementations that can drift apart.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'simulator-nav';
  var STORE = 'history';
  var VERSION = 1;

  /* The visitor's day, not UTC's.
   *
   * Section 5.5's TTL is "same-day", and the day that matters is the one the
   * person is living in. Stamping in UTC gets this wrong at both ends for an
   * Indian visitor: AMFI publishes a NAV late in the evening IST, and someone
   * opening the app early the next morning is still on the previous UTC date,
   * so a UTC stamp would call yesterday's copy fresh and hide the new NAV. */
  function isoDay(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* --------------------------------------------------------------- stores */

  function memoryStore() {
    var map = {};
    return {
      kind: 'memory',
      get: function (key) { return Promise.resolve(map[key] || null); },
      put: function (key, value) { map[key] = value; return Promise.resolve(); },
      clear: function () { map = {}; return Promise.resolve(); }
    };
  }

  function indexedDbStore(indexed) {
    /* Reading the global can itself throw: a browser told to block site data
     * guards indexedDB with a getter that raises SecurityError, so `typeof
     * indexedDB` is not a safe question to ask. Guard the reach, not just the
     * result, or the whole page dies on a privacy setting. */
    var idb = indexed || null;
    if (!idb) {
      try { idb = (typeof indexedDB !== 'undefined') ? indexedDB : null; }
      catch (e) { return null; }
    }
    if (!idb) return null;

    var opening = null;

    /* Every branch below must end in a settled promise. An IndexedDB request
     * that neither succeeds nor errors -- blocked by another tab holding an old
     * version, or a browser whose `result` getter raises rather than returns --
     * would otherwise leave this pending forever, and a pending cache read is a
     * page that never finishes loading. Section 14 is explicit that the app must
     * never white-screen, so the store fails closed and the layer goes to the
     * network. */
    function open() {
      if (opening) return opening;
      opening = new Promise(function (resolve, reject) {
        var request;
        try { request = idb.open(DB_NAME, VERSION); }
        catch (e) { reject(e); return; }

        request.onupgradeneeded = function () {
          try {
            var db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          } catch (e) { reject(e); }
        };
        request.onsuccess = function () {
          try { resolve(request.result); } catch (e) { reject(e); }
        };
        request.onerror = function () {
          try { reject(request.error || new Error('IndexedDB refused to open')); }
          catch (e) { reject(e); }
        };
        /* Another tab still holding an older version never fires either of the
         * two handlers above. */
        request.onblocked = function () { reject(new Error('IndexedDB is blocked by another tab')); };
      }).catch(function (e) {
        /* Do not cache the failure forever: a later view may find the database
         * available again, and retrying costs one request. */
        opening = null;
        throw e;
      });
      return opening;
    }

    function tx(mode, run) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t, request;
          try {
            t = db.transaction(STORE, mode);
            request = run(t.objectStore(STORE));
          } catch (e) { reject(e); return; }
          t.onabort = t.onerror = function () { reject(t.error || new Error('IndexedDB transaction failed')); };
          t.oncomplete = function () {
            try { resolve(request ? request.result : undefined); } catch (e) { reject(e); }
          };
        });
      });
    }

    return {
      kind: 'indexeddb',
      get: function (key) {
        return tx('readonly', function (store) { return store.get(key); })
          .then(function (v) { return v === undefined ? null : v; })
          /* A blocked or full quota is not a reason to fail the page; it is a
           * reason to go to the network. Private-browsing modes do exactly this. */
          .catch(function () { return null; });
      },
      put: function (key, value) {
        return tx('readwrite', function (store) { return store.put(value, key); })
          .catch(function () { return undefined; });
      },
      clear: function () {
        return tx('readwrite', function (store) { return store.clear(); }).catch(function () { return undefined; });
      }
    };
  }

  /* Anything at all going wrong while choosing the store means memory: the cache
   * is an optimisation, and no optimisation is worth a blank page. */
  function safeIndexedDbStore() {
    try { return indexedDbStore(); } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- cache */

  function createCache(options) {
    var opts = options || {};
    var store = opts.store || safeIndexedDbStore() || memoryStore();
    var now = opts.now || function () { return Date.now(); };
    var searches = {};

    function historyKey(providerless) { return 'history:' + providerless; }

    return {
      store: store,

      /* Returns { hit, fresh, value, storedOn }. `fresh` is section 5.5's
       * same-day rule; `hit` without `fresh` is the last-good copy that
       * section 5.1 falls back to when every provider is unreachable. */
      readHistory: function (code) {
        return store.get(historyKey(code)).then(function (record) {
          if (!record || !record.value) return { hit: false, fresh: false, value: null, storedOn: null };
          return {
            hit: true,
            fresh: record.storedOn === isoDay(now()),
            value: record.value,
            storedOn: record.storedOn
          };
        });
      },

      writeHistory: function (code, value) {
        return store.put(historyKey(code), { storedOn: isoDay(now()), value: value });
      },

      readSearch: function (query) {
        var key = String(query || '').trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(searches, key) ? searches[key] : null;
      },

      writeSearch: function (query, value) {
        searches[String(query || '').trim().toLowerCase()] = value;
      },

      clear: function () { searches = {}; return store.clear(); }
    };
  }

  var api = { createCache: createCache, memoryStore: memoryStore, indexedDbStore: indexedDbStore,
              safeIndexedDbStore: safeIndexedDbStore, isoDay: isoDay };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimCache = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
