/* Proves the fund-lookup seam actually works, using a stub provider injected
 * into the page. No network is involved: the point is that the day a real
 * provider is wired in, the journey around it is already known to work.
 */
const { chromium } = require('playwright');
const TMP = process.env.PRC_TMP || '/tmp/prc';
const CHROME = process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE_URL = process.env.PRC_URL || 'http://127.0.0.1:8781/tool/';

let pass = 0; const fails = [];
function ok(n, c, d) {
  if (c) { pass++; console.log('  pass  ' + n); }
  else { fails.push(n); console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); }
}

/* Runs in the page before the app scripts. Builds 18 years of daily NAV at
 * exactly 11% a year, so the answer is known before the tool calculates it. */
const STUB = `
window.PRC_PROVIDER = {
  name: 'stub',
  search: function (q) {
    if (/fail/i.test(q)) return Promise.reject(new Error('service unavailable'));
    if (/nothing/i.test(q)) return Promise.resolve([]);
    return Promise.resolve([
      { id: 'good', name: 'Example Flexi Cap Fund', plan: 'Direct', option: 'Growth', identifier: 'INF000A01AA1' },
      { id: 'good2', name: 'Example Flexi Cap Fund', plan: 'Regular', option: 'IDCW', identifier: 'INF000A01AB9' },
      { id: 'broken', name: 'Example Broken Data Fund', plan: 'Direct', option: 'Growth', identifier: 'INF000A01AC7' }
    ]);
  },
  history: function (id) {
    if (id === 'broken') return Promise.resolve([['not a date', 'not a number']]);
    var rows = [['Date', 'NAV']];
    var t = Date.UTC(2006, 0, 1), v = 10;
    while (t <= Date.UTC(2024, 0, 1)) {
      var d = new Date(t);
      rows.push([d.toISOString().slice(0, 10), v.toFixed(4)]);
      v *= Math.pow(1.11, 1 / 365.2425);
      t += 86400000;
    }
    return Promise.resolve(rows);
  }
};`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });

  /* ---------------------------------------- with no provider, nothing appears */
  const plain = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p0 = await plain.newPage();
  await p0.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  await p0.click('#r-source .chip[data-source="fund"]');
  ok('with no provider wired in, no search box is shown',
     await p0.locator('#f-search-card').isHidden());
  ok('and the upload path is still offered', await p0.locator('#f-drop').isVisible());
  ok('the contract is documented in the shipped file',
     (await (await p0.request.get(new URL('provider.js', BASE_URL).href)).text())
       .includes('search(query) ->'));

  /* --------------------------------------------- with a stub provider wired in */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(STUB);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  await page.click('#r-source .chip[data-source="fund"]');

  ok('a wired provider reveals the search journey', await page.locator('#f-search-card').isVisible());

  await page.fill('#f-query', 'ex');
  await page.click('#f-search');
  await page.waitForTimeout(200);
  ok('a too-short query is refused politely',
     /at least three letters/.test(await page.locator('#f-results').innerText()));

  await page.fill('#f-query', 'example');
  await page.click('#f-search');
  await page.waitForSelector('#f-results [data-pick]', { timeout: 10000 });
  const results = await page.locator('#f-results').innerText();
  ok('matches are listed', (await page.locator('#f-results [data-pick]').count()) === 3);
  ok('the plan is shown so near-identical schemes can be told apart', /Direct/.test(results));
  ok('the option is shown too', /Growth/.test(results) && /IDCW/.test(results));
  ok('an identifier is shown', /INF000A01AA1/.test(results));
  ok('the reader is warned to check before choosing', /behave differently/.test(results));

  await page.locator('#f-results [data-pick="0"]').click();
  await page.waitForTimeout(1200);
  ok('a fetched fund is ready to analyse like any other source',
     /Ready to analyse/.test(await page.locator('#r-loaded').innerText()),
     await page.locator('#r-loaded').innerText());
  await page.click('#r-run');
  await page.waitForSelector('#r-out .result', { timeout: 20000 });
  const out = await page.locator('#r-out').innerText();
  ok('choosing a fund fetches and analyses it', /Median 5-year return/i.test(out), out.slice(0, 160));
  ok('an 11% history measures 11%', /11\.0%/.test(out), out.slice(0, 200));
  ok('the fetched data goes through the same import report', /rows in file/i.test(out));
  ok('and through the same period controls', /What was measured/.test(out));
  ok('the fund is named from the search result', /Example Flexi Cap Fund/.test(out));

  /* -------------------------------------------------- failures stay honest */
  await page.fill('#f-query', 'nothing here');
  await page.click('#f-search');
  await page.waitForTimeout(300);
  const none = await page.locator('#f-results').innerText();
  ok('no matches is stated plainly', /Nothing matched/.test(none));
  ok('and the upload path is offered as the way through', /NAV file below/.test(none));

  await page.fill('#f-query', 'failing service');
  await page.click('#f-search');
  await page.waitForTimeout(300);
  const failed = await page.locator('#f-results').innerText();
  ok('a lookup failure is reported, not swallowed', /could not be reached/.test(failed));
  ok('the error names the reason', /service unavailable/.test(failed));
  ok('it never leaves the reader stuck', /needs no connection/.test(failed));

  await page.fill('#f-query', 'example');
  await page.click('#f-search');
  await page.waitForSelector('#f-results [data-pick="2"]', { timeout: 10000 });
  await page.locator('#f-results [data-pick="2"]').click();
  await page.waitForTimeout(500);
  const bad = await page.locator('#f-results').innerText();
  ok('unusable fetched data is refused, not calculated on',
     /could not be used/i.test(bad), bad);
  ok('the refusal does not call a service response a file',
     !/That file/.test(bad), bad);
  ok('and it says the data came from the service, not the reader',
     /from the lookup service/.test(bad));
  ok('no NaN reaches the screen', !/NaN|undefined/.test(bad));

  ok('no script errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: TMP + '/shots/23-provider.png', fullPage: true });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
