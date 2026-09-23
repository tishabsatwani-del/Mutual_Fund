/* The Simulator - the data access layer, sections 5.1, 5.3 and 5.5, plus the
 * failover drill of acceptance criterion 12.
 *
 * Every provider here is reached through an injected transport that serves
 * canned bodies, so the chain, the timeout, the cache and the queue are all
 * tested without a network -- which is also how the drill will be run in the
 * browser, by blocking providers at the layer rather than at the firewall.
 *
 * Run: node sim/tests/access.test.js
 */
'use strict';

var A = require('../access.js');
var Cache = require('../cache.js');
var C = require('../providers/contract.js');
var mfapi = require('../providers/mfapi.js');
var tigzig = require('../providers/tigzig.js');

var passed = 0, failed = [], pending = [];
function ok(name, condition, detail) {
  if (condition) { passed++; console.log('  pass    ' + name); }
  else { failed.push(name); console.log('  FAIL    ' + name + (detail ? '   -- ' + detail : '')); }
}
function todo(name, why) { pending.push(name); console.log('  PENDING ' + name + '   -- ' + why); }
function section(t) { console.log('\n' + t); }

/* ------------------------------------------------------------------ fixtures */

/* Provider 1's documented shape, newest first, with the junk AMFI history
 * actually carries mixed in. */
var MFAPI_HISTORY = {
  meta: {
    fund_house: 'Example Asset Management', scheme_type: 'Open Ended Schemes',
    scheme_category: 'Equity Scheme - Large Cap Fund', scheme_code: 118989,
    scheme_name: 'Example Large Cap Fund - Direct Plan - Growth',
    isin_growth: 'INF000A00001', isin_div_reinvestment: 'INF000A00002'
  },
  data: [
    { date: '05-08-2026', nav: '102.5000' },
    { date: '04-08-2026', nav: '#N/A' },
    { date: '01-08-2026', nav: '101.0000' },
    { date: '31-07-2026', nav: 'N.A.' },
    { date: '30-07-2026', nav: '100.0000' }
  ],
  status: 'SUCCESS'
};
var MFAPI_SEARCH = [
  { schemeCode: 118989, schemeName: 'Example Large Cap Fund - Direct Plan - Growth' },
  { schemeCode: 118990, schemeName: 'Example Large Cap Fund - Direct Plan - IDCW' }
];

/* Provider 2's shape as tigzig.js currently assumes it. Provisional by design. */
var TIGZIG_HISTORY = {
  meta: { schemeCode: 118989, schemeName: 'Example Large Cap Fund - Direct Plan - Growth', amc: 'Example AMC' },
  data: [
    { navDate: '2026-07-30', navValue: '100.0000' },
    { navDate: '2026-08-01', navValue: '101.0000' },
    { navDate: '2026-08-05', navValue: '102.5000' }
  ]
};
var TIGZIG_SEARCH = { data: [{ code: 118989, name: 'Example Large Cap Fund - Direct Plan - Growth' }] };

function fakeTransport(routes, watch) {
  return function (url) {
    if (watch) watch(url);
    var keys = Object.keys(routes);
    for (var i = 0; i < keys.length; i++) {
      if (url.indexOf(keys[i]) >= 0) {
        var r = routes[keys[i]];
        return typeof r === 'function' ? r(url) : Promise.resolve(r);
      }
    }
    var e = new Error('404 for ' + url); e.status = 404;
    return Promise.reject(e);
  };
}

function httpError(status) {
  var e = new Error('provider answered ' + status); e.status = status;
  return Promise.reject(e);
}
function netError() { return Promise.reject(new Error('network unreachable')); }
function after(ms, value) {
  return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, ms); });
}

function stubProvider(id, body) {
  return {
    id: id, label: id, verified: false,
    search: function (q, ctx) {
      return ctx.get('https://' + id + '/search?q=' + q).then(function (b) {
        return b.map(function (r) { return C.toScheme(r); });
      });
    },
    history: function (code, ctx) {
      return ctx.get('https://' + id + '/history/' + code).then(function (b) {
        return { scheme: C.toScheme(b.meta), series: C.toSeries(b.data) };
      });
    },
    body: body
  };
}

function run() {
  var chain = Promise.resolve();
  function step(fn) { chain = chain.then(fn); return chain; }

  /* ============================================== the contract, section 5.2 */
  step(function () {
    section('The contract every adapter is held to');
    return C.conform(mfapi, {
      code: '118989',
      responses: { '/mf/search': MFAPI_SEARCH, '/mf/118989': MFAPI_HISTORY }
    }).then(function (problems) {
      ok('provider 1 satisfies the contract', problems.length === 0, problems.join('; '));
    });
  });

  step(function () {
    return C.conform(tigzig, {
      code: '118989',
      responses: { '/search': TIGZIG_SEARCH, '/nav': TIGZIG_HISTORY }
    }).then(function (problems) {
      ok('provider 2 satisfies the contract against its assumed shapes',
         problems.length === 0, problems.join('; '));
    });
  });

  step(function () {
    /* The chain is two public, no-key sources called straight from the reader's
     * browser. The Cloudflare Worker is gone on purpose: it ran on the author's
     * own infrastructure, which is a key to hold, a bill to pay and a thing to
     * break into. Two public doors plus the upload door leave nothing of the
     * author's anywhere in the path. */
    var fs = require('fs'), path = require('path');
    var src = fs.readFileSync(path.join(__dirname, '../providers/mfapi.js'), 'utf8') +
              fs.readFileSync(path.join(__dirname, '../providers/tigzig.js'), 'utf8');
    ok('every source in the chain is a public host', [mfapi, tigzig].every(function (p) {
      return /^https:\/\//.test(p.base || (p.endpoints && p.endpoints.base));
    }));
    ok('and neither needs a key of the author\'s', !/apiKey|api_key|bearer|Authorization/i.test(src));
    ok('no leg of the chain runs on infrastructure of the author\'s',
       !fs.existsSync(path.join(__dirname, '../providers/worker.js')));
    todo('live shape confirmation for both sources',
         'this environment has no outbound network; verified stays false until checked');
    ok('no adapter claims to be verified before anyone has checked it',
       [mfapi, tigzig].every(function (p) { return p.verified === false; }));
  });

  step(function () {
    section('Section 5.2 - what the adapters hand back');
    var t = fakeTransport({ '/mf/118989': MFAPI_HISTORY });
    return mfapi.history('118989', { get: t }).then(function (out) {
      ok('junk NAV values are dropped', out.series.length === 3, JSON.stringify(out.series));
      ok('DD-MM-YYYY becomes ISO', out.series[0].date === '2026-07-30', out.series[0].date);
      ok('a newest-first payload comes back ascending',
         out.series.map(function (p) { return p.date; }).join() === '2026-07-30,2026-08-01,2026-08-05');
      ok('NAVs come back as numbers, not strings', typeof out.series[2].nav === 'number');
      ok('the scheme carries its house and codes',
         out.scheme.fundHouse === 'Example Asset Management' && out.scheme.isinGrowth === 'INF000A00001',
         JSON.stringify(out.scheme));
    });
  });

  step(function () {
    var t = fakeTransport({ '/nav': TIGZIG_HISTORY });
    return tigzig.history('118989', { get: t }).then(function (out) {
      ok('provider 2 produces the identical normalised shape',
         out.series.length === 3 && out.series[0].date === '2026-07-30' && typeof out.series[0].nav === 'number',
         JSON.stringify(out.series));
    });
  });

  /* ================================================== the chain, section 5.1 */
  step(function () {
    section('Section 5.1 - the chain is tried in order');
    var calls = [];
    var one = stubProvider('one'), two = stubProvider('two');
    var access = A.createAccess({
      providers: [one, two],
      transport: fakeTransport({ 'one/history': MFAPI_HISTORY }, function (u) { calls.push(u); }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.history('118989').then(function (r) {
      ok('provider 1 answering means provider 2 is never called',
         r.ok && r.provider === 'one' && calls.length === 1, JSON.stringify(calls));
    });
  });

  step(function () {
    section('Acceptance criterion 12 - the failover drill');
    var calls = [];
    var access = A.createAccess({
      providers: [stubProvider('one'), stubProvider('two'), stubProvider('three')],
      transport: fakeTransport({
        'one/history': netError,
        'two/history': MFAPI_HISTORY
      }, function (u) { calls.push(u); }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.history('118989').then(function (r) {
      ok('with provider 1 down, the flow completes on provider 2',
         r.ok && r.provider === 'two', JSON.stringify(r));
      ok('and provider 3 was never reached', calls.length === 2, JSON.stringify(calls));
      return access.history('222222');
    }).then(function () {
      var state = access.state();
      var one = state.providers[0];
      ok('a failed provider is skipped for the rest of the session',
         one.status === 'skipped' && /network unreachable/.test(one.reason), JSON.stringify(one));
      ok('and is not tried again', calls.filter(function (u) { return u.indexOf('one/') >= 0; }).length === 1,
         JSON.stringify(calls));
    });
  });

  step(function () {
    /* With both public sources blocked there is no third leg to fall to, by
     * design. The layer has to fail cleanly and name it, because that is the
     * exact moment the upload door has to appear. */
    var access = A.createAccess({
      providers: [stubProvider('one'), stubProvider('two')],
      transport: fakeTransport({}),
      cache: Cache.createCache({ store: Cache.memoryStore() }),
      block: ['one', 'two']
    });
    return access.history('118989').then(function (r) {
      ok('with both sources blocked the layer fails cleanly rather than hanging',
         r.ok === false && r.slot === 'ERR-DATA-DOWN', JSON.stringify(r));
      var s = access.state();
      ok('the drill reports exactly which sources were blocked',
         s.providers[0].status === 'blocked' && s.providers[1].status === 'blocked');
    });
  });

  step(function () {
    section('Section 5.1 - what counts as a provider failing');
    var access = A.createAccess({
      providers: [stubProvider('one'), stubProvider('two')],
      transport: fakeTransport({ 'two/history': MFAPI_HISTORY }),   /* 'one' 404s */
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.history('118989').then(function (r) {
      ok('a 404 fails over to the next provider', r.ok && r.provider === 'two');
      ok('but does not blacklist the provider that answered honestly',
         access.state().providers[0].status === 'available',
         JSON.stringify(access.state().providers[0]));
    });
  });

  step(function () {
    var access = A.createAccess({
      providers: [mfapi, tigzig],
      transport: fakeTransport({
        '/mf/118989': { meta: { scheme_code: 1, scheme_name: 'x' }, status: 'SUCCESS',
                        data: [{ when: '05-08-2026', price: '10' }, { when: '06-08-2026', price: '11' }] },
        '/nav': TIGZIG_HISTORY
      }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.history('118989').then(function (r) {
      ok('rows the adapter cannot read at all are malformed, and fail over',
         r.ok && r.provider === 'tigzig', JSON.stringify(r));
      var first = access.state().providers[0];
      ok('and that provider is skipped for the session',
         first.status === 'skipped' && /none of the 2 NAV rows could be read/.test(first.reason || ''),
         JSON.stringify(first));
    });
  });

  /* ============================ regressions from the adversarial review ==== */

  step(function () {
    section('A provider answering correctly is never blamed for the answer');
    var NEW_FUND = {
      meta: { scheme_code: 999999, scheme_name: 'Brand New Fund - Direct Plan - Growth' },
      data: [{ date: '22-08-2026', nav: '10.0000' }], status: 'SUCCESS'
    };
    var access = A.createAccess({
      providers: [mfapi, tigzig],
      transport: fakeTransport({ '/mf/999999': NEW_FUND, '/mf/118989': MFAPI_HISTORY }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.history('999999').then(function (r) {
      ok('a fund with one published NAV is served, not rejected',
         r.ok && r.series.length === 1, JSON.stringify(r).slice(0, 160));
      ok('and no provider is blamed for it',
         access.state().providers.every(function (p) { return p.status === 'available'; }),
         JSON.stringify(access.state().providers));
      return access.history('118989');
    }).then(function (r) {
      ok('a healthy fund still works afterwards in the same session', r.ok && r.series.length === 3);
    });
  });

  step(function () {
    var access = A.createAccess({
      providers: [mfapi, tigzig],
      transport: fakeTransport({
        '/mf/000000': { status: 'FAIL', message: 'Invalid scheme code' },
        '/mf/118989': MFAPI_HISTORY
      }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.history('000000').then(function (r) {
      ok('a dead scheme code reported inside a 200 body is absence, not breakage',
         r.ok === false && r.kind === 'absent', JSON.stringify(r));
      ok('and it says no history was found, not that the data is down',
         r.slot === 'RR-NO-HISTORY', r.slot);
      ok('the provider that answered honestly stays in the chain',
         access.state().providers[0].status === 'available',
         JSON.stringify(access.state().providers[0]));
      return access.history('118989');
    }).then(function (r) {
      ok('so the next fund is served normally', r.ok && r.provider === 'mfapi');
    });
  });

  step(function () {
    var access = A.createAccess({
      providers: [mfapi, tigzig],
      transport: fakeTransport({
        '/mf/search': [{ sid: 118989, title: 'Renamed Keys Fund - Direct Plan - Growth' }],
        '/search': TIGZIG_SEARCH
      }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.search('flexi').then(function (r) {
      ok('a search whose rows cannot be mapped fails over instead of looking empty',
         r.ok && r.provider === 'tigzig' && r.schemes.length === 1, JSON.stringify(r));
      var moved = access.state().providers[0];
      ok('and the provider whose shape moved is skipped',
         moved.status === 'skipped' && /none of the 1 search rows could be read/.test(moved.reason || ''),
         JSON.stringify(moved));
    });
  });

  step(function () {
    var access = A.createAccess({
      providers: [mfapi],
      transport: fakeTransport({ '/mf/search': [] }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.search('nothing matches this').then(function (r) {
      ok('an honestly empty search is still a success', r.ok && r.schemes.length === 0);
      ok('and carries the EMPTY-SEARCH slot rather than an error', r.slot === 'EMPTY-SEARCH', r.slot);
      ok('the provider is not blamed for finding nothing',
         access.state().providers[0].status === 'available');
    });
  });

  step(function () {
    section('Scheme codes that collide with Object.prototype');
    var access = A.createAccess({
      providers: [stubProvider('one')],
      transport: fakeTransport({ 'one/history': MFAPI_HISTORY }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    var awkward = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];
    ok('every one of them returns a real promise',
       awkward.every(function (code) {
         var out = access.history(code);
         return out && typeof out.then === 'function';
       }), JSON.stringify(awkward));
    return Promise.all(awkward.map(function (c) { return access.history(c); })).then(function (all) {
      ok('and each resolves rather than crashing the caller',
         all.every(function (r) { return r && typeof r.ok === 'boolean'; }));
    });
  });

  step(function () {
    section('An adapter that throws instead of rejecting');
    var thrower = {
      id: 'thrower', label: 'thrower', verified: false,
      search: function () { throw new Error('synchronous explosion'); },
      history: function () { throw new Error('synchronous explosion'); }
    };
    var access = A.createAccess({
      providers: [thrower, stubProvider('two')],
      transport: fakeTransport({ 'two/history': MFAPI_HISTORY }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.history('118989').then(function (r) {
      ok('is treated as a provider fault, not an exception escaping the layer',
         r.ok && r.provider === 'two', JSON.stringify(r));
      ok('and is skipped for the session',
         access.state().providers[0].status === 'skipped');
    });
  });

  step(function () {
    var access = A.createAccess({
      providers: [stubProvider('one'), stubProvider('two')],
      transport: fakeTransport({
        'one/history': function () { return after(200, MFAPI_HISTORY); },
        'two/history': MFAPI_HISTORY
      }),
      cache: Cache.createCache({ store: Cache.memoryStore() }),
      timeoutMs: 50
    });
    var began = Date.now();
    return access.history('118989').then(function (r) {
      ok('a provider that does not answer in time is timed out and failed over',
         r.ok && r.provider === 'two', JSON.stringify(r));
      ok('the wait is bounded by the timeout, not by the slow provider',
         Date.now() - began < 180, (Date.now() - began) + 'ms');
      ok('the timeout counts as a failure and skips the provider',
         /within 0.05 seconds/.test(access.state().providers[0].reason || ''),
         access.state().providers[0].reason);
    });
  });

  step(function () {
    ok('the default timeout is the 8 seconds section 5.1 fixes', A.TIMEOUT_MS === 8000);
    ok('the default search debounce is section 5.3\'s 300 ms', A.SEARCH_DEBOUNCE_MS === 300);
    ok('the default history concurrency cap is section 5.5\'s two', A.MAX_HISTORY_IN_FLIGHT === 2);
  });

  /* =============================================== the caches, section 5.5 */
  step(function () {
    section('Section 5.5 - a repeat view on the same day makes zero network calls');
    var calls = [];
    var clock = Date.UTC(2026, 7, 23, 9);
    var access = A.createAccess({
      providers: [stubProvider('one')],
      transport: fakeTransport({ 'one/history': MFAPI_HISTORY }, function (u) { calls.push(u); }),
      cache: Cache.createCache({ store: Cache.memoryStore(), now: function () { return clock; } })
    });
    return access.history('118989').then(function () {
      return access.history('118989');
    }).then(function (r) {
      ok('the second view is served from the cache', r.ok && r.cached === true);
      ok('and cost exactly zero further requests', calls.length === 1, JSON.stringify(calls));
      clock += 86400000;
      return access.history('118989');
    }).then(function (r) {
      ok('the next day it is fetched again', r.cached === false && calls.length === 2);
    });
  });

  step(function () {
    section('Section 5.1 - when every provider is unreachable');
    var clock = Date.UTC(2026, 7, 23, 9);
    var failing = false;
    var cache = Cache.createCache({ store: Cache.memoryStore(), now: function () { return clock; } });
    var access = A.createAccess({
      providers: [stubProvider('one')],
      transport: fakeTransport({ 'one/history': function () { return failing ? netError() : Promise.resolve(MFAPI_HISTORY); } }),
      cache: cache
    });
    return access.history('118989').then(function () {
      clock += 86400000 * 3;
      failing = true;
      return access.history('118989');
    }).then(function (r) {
      ok('the last good copy is shown rather than a blank screen', r.ok && r.cached === true);
      ok('it is labelled stale, with the day it was stored',
         r.stale === true && r.storedOn === '2026-08-23', JSON.stringify(r));
      ok('and it carries the ERR-DATA-DOWN slot for the banner', r.slot === 'ERR-DATA-DOWN');
    });
  });

  step(function () {
    var access = A.createAccess({
      providers: [stubProvider('one')],
      transport: fakeTransport({ 'one/history': netError }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.history('118989').then(function (r) {
      ok('with nothing cached, the failure is named, never thrown',
         r.ok === false && r.slot === 'ERR-DATA-DOWN' && Array.isArray(r.reasons), JSON.stringify(r));
    });
  });

  step(function () {
    section('Section 5.3 - search');
    var calls = [];
    var one = stubProvider('one');
    var access = A.createAccess({
      providers: [one],
      transport: fakeTransport({ 'one/search': MFAPI_SEARCH }, function (u) { calls.push(u); }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.search('large cap').then(function (r) {
      ok('search returns schemes in the section 5.2 shape',
         r.ok && r.schemes.length === 2 && r.schemes[0].code === '118989', JSON.stringify(r.schemes));
      return access.search('large cap');
    }).then(function (r) {
      ok('the same query string is answered from the session cache', r.cached === true && calls.length === 1);
      return access.search('  LARGE CAP  ');
    }).then(function () {
      ok('cached regardless of case and surrounding space', calls.length === 1, JSON.stringify(calls));
      return access.search('');
    }).then(function (r) {
      ok('an empty query costs no request', r.ok && r.schemes.length === 0 && calls.length === 1);
    });
  });

  step(function () {
    section('Section 5.5 - never more than two history fetches in flight');
    var live = 0, peak = 0;
    var access = A.createAccess({
      providers: [stubProvider('one')],
      transport: function () {
        live++; peak = Math.max(peak, live);
        return after(20, MFAPI_HISTORY).then(function (v) { live--; return v; });
      },
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    var codes = ['1', '2', '3', '4', '5', '6', '7', '8'];
    return Promise.all(codes.map(function (c) { return access.history(c); })).then(function (all) {
      ok('all eight requests complete', all.every(function (r) { return r.ok; }));
      ok('and never more than two were in flight at once', peak <= 2, 'peak was ' + peak);
    });
  });

  step(function () {
    var calls = 0;
    var access = A.createAccess({
      providers: [stubProvider('one')],
      transport: function () { calls++; return after(20, MFAPI_HISTORY); },
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return Promise.all([access.history('118989'), access.history('118989'), access.history('118989')])
      .then(function (all) {
        ok('three callers asking for one scheme at once share a single fetch',
           all.every(function (r) { return r.ok; }) && calls === 1, 'calls ' + calls);
      });
  });

  /* ================================================ privacy, criterion 10 */
  step(function () {
    section('Acceptance criterion 10 - the layer asks for nothing else');
    var urls = [];
    var access = A.createAccess({
      providers: [stubProvider('one')],
      transport: fakeTransport({ 'one/history': MFAPI_HISTORY, 'one/search': MFAPI_SEARCH },
                               function (u) { urls.push(u); }),
      cache: Cache.createCache({ store: Cache.memoryStore() })
    });
    return access.search('large cap').then(function () {
      return access.history('118989');
    }).then(function () {
      ok('every request carries only a search string or a scheme code',
         urls.every(function (u) { return /\/search\?q=large cap$/.test(u) || /\/history\/118989$/.test(u); }),
         JSON.stringify(urls));
      ok('exactly two requests were made', urls.length === 2, JSON.stringify(urls));
    });
  });

  step(function () {
    section('Section 5.5 - the TTL day is the visitor\'s day, not UTC\'s');
    var execFileSync = require('child_process').execFileSync;
    var script = 'var C=require(process.argv[1]); ' +
                 'process.stdout.write(C.isoDay(Date.UTC(2026,7,23,20,0,0)));';
    var path = require('path').join(__dirname, '../cache.js');
    function stampUnder(tz) {
      return execFileSync(process.execPath, ['-e', script, path],
                          { env: Object.assign({}, process.env, { TZ: tz }) }).toString();
    }
    var utc = stampUnder('UTC');
    var ist = stampUnder('Asia/Kolkata');
    ok('20:00 UTC is still the 23rd in London', utc === '2026-08-23', utc);
    ok('but is already the 24th in India, and the stamp says so', ist === '2026-08-24', ist);
    ok('so a NAV published late in the IST evening is not hidden by a stale stamp',
       utc !== ist, utc + ' vs ' + ist);
  });

  step(function () {
    section('Section 5.3 - the 300 ms debounce');
    var fired = 0;
    var d = A.debounce(function () { fired++; }, 20);
    d(); d(); d();
    return after(60).then(function () {
      ok('three keystrokes inside the window produce one call', fired === 1, 'fired ' + fired);
    });
  });

  return chain.then(function () {
    console.log('\n' + passed + ' passed, ' + failed.length + ' failed, ' + pending.length + ' pending');
    if (pending.length) console.log('\nPENDING (needs the live environment):\n  ' + pending.join('\n  '));
    if (failed.length) { console.log('\nFAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
  });
}

run().catch(function (e) { console.error('\nsuite threw:', e); process.exit(1); });
