/* The Simulator - the IndexedDB half of section 5.5, in a real browser.
 *
 * The Node fixtures run the cache against a memory store, which proves the TTL
 * logic but not the storage it actually ships on. This suite runs the same cache
 * against real IndexedDB in Chromium: that it persists across reloads, that a
 * same-day repeat costs nothing, and -- the case that matters most -- that a
 * browser refusing storage degrades to a network call rather than a broken page.
 *
 * Run: node sim/tests/idb.test.js     (needs a static server on 8781)
 */
'use strict';

var { chromium } = require('playwright');

/* The pinned Chromium this repo's browser suites already use; overridable so the
 * suite runs anywhere Playwright is installed differently. */
var CHROME = process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
var ORIGIN = 'http://127.0.0.1:8781';
var passed = 0, failed = [];
function ok(name, condition, detail) {
  if (condition) { passed++; console.log('  pass  ' + name); }
  else { failed.push(name); console.log('  FAIL  ' + name + (detail ? '   -- ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

(async function () {
  var browser = await chromium.launch({ executablePath: CHROME });
  var context = await browser.newContext();
  var page = await context.newPage();

  async function load(p) {
    await p.goto(ORIGIN + '/sim/tests/harness.html', { waitUntil: 'load' });
  }

  section('IndexedDB is the store that is actually chosen in a browser');
  await load(page);
  ok('the browser picks IndexedDB, not the memory fallback',
     await page.evaluate(function () { return SimCache.createCache().store.kind; }) === 'indexeddb');

  section('A repeat view on the same day survives a reload');
  await page.evaluate(function () {
    window.C = SimCache.createCache();
    return window.C.writeHistory('118989', { scheme: { code: '118989', name: 'Example' }, series: [1, 2, 3] });
  });
  await load(page);
  var afterReload = await page.evaluate(function () {
    return SimCache.createCache().readHistory('118989');
  });
  ok('the stored series is still there after a full reload', afterReload.hit === true);
  ok('and is still fresh, so it costs no network call', afterReload.fresh === true);
  ok('the value survives intact', JSON.stringify(afterReload.value.series) === '[1,2,3]',
     JSON.stringify(afterReload.value));

  section('Yesterday\'s copy is kept, but not called fresh');
  var stale = await page.evaluate(function () {
    var clock = Date.now();
    var c = SimCache.createCache({ now: function () { return clock; } });
    return c.writeHistory('222222', { scheme: { code: '222222', name: 'x' }, series: [9] })
      .then(function () { clock += 86400000 * 2; return c.readHistory('222222'); });
  });
  ok('it is still a hit, which is what the all-providers-down path needs', stale.hit === true);
  ok('but no longer fresh, so it will be refetched', stale.fresh === false);

  section('A browser that refuses storage must not break the page');
  var blocked = await context.newPage();
  await blocked.addInitScript(function () {
    /* what a locked-down or private-mode browser does */
    Object.defineProperty(window, 'indexedDB', {
      get: function () { throw new DOMException('The operation is insecure.', 'SecurityError'); }
    });
  });
  await load(blocked);
  var survived = await blocked.evaluate(function () {
    try {
      var c = SimCache.createCache();
      return c.readHistory('anything').then(function (r) {
        return { kind: c.store.kind, hit: r.hit, threw: false };
      });
    } catch (e) {
      return { threw: true, message: e.message };
    }
  }).catch(function (e) { return { threw: true, message: e.message }; });

  await blocked.close();
  ok('the cache still constructs when IndexedDB is unreachable', survived.threw === false,
     JSON.stringify(survived));
  ok('it falls back to memory rather than failing', survived.kind === 'memory', JSON.stringify(survived));
  ok('and reports a miss, which sends the layer to the network', survived.hit === false);

  section('A store that opens but refuses to write is survivable too');
  var refusing = await context.newPage();
  await refusing.addInitScript(function () {
    var real = window.indexedDB.open.bind(window.indexedDB);
    window.indexedDB.open = function () {
      var request = real.apply(null, arguments);
      Object.defineProperty(request, 'result', {
        get: function () { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); }
      });
      return request;
    };
  });
  await load(refusing);
  var quota = await refusing.evaluate(function () {
    var c = SimCache.createCache();
    return c.writeHistory('333', { series: [1] })
      .then(function () { return c.readHistory('333'); })
      .then(function (r) { return { hit: r.hit, threw: false }; })
      .catch(function (e) { return { threw: true, message: e.message }; });
  });
  await refusing.close();
  ok('a write that cannot be stored resolves rather than rejecting', quota.threw === false,
     JSON.stringify(quota));
  ok('and the next read is simply a miss', quota.hit === false, JSON.stringify(quota));

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
  if (failed.length) { console.log('\nFAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
})().catch(function (e) { console.error('suite threw:', e); process.exit(1); });
