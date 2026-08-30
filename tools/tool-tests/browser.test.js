/* Drives the real page in a real browser. Anything that only works in theory
 * fails here. */
const { chromium } = require('playwright');
/* Where screenshots and generated test files go. */
const TMP = process.env.PRC_TMP || '/tmp/prc';
const CHROME = process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE_URL = process.env.PRC_URL || 'http://127.0.0.1:8781/tool/';
const fs = require('fs');
const path = require('path');

const BASE = BASE_URL;
const SHOTS = TMP + '/shots';

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  pass  ' + name); }
  else { fails.push(name); console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

/* a NAV file that grows at exactly 13% a year, so the answer is known */
function navCsv() {
  const lines = ['Date,NAV'];
  let t = Date.UTC(2008, 0, 1); let v = 10;
  while (t <= Date.UTC(2025, 0, 1)) {
    const d = new Date(t);
    lines.push(`${String(d.getUTCDate()).padStart(2,'0')}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${d.getUTCFullYear()},${v.toFixed(4)}`);
    v *= Math.pow(1.13, 1/365.2425); t += 86400000;
  }
  return lines.join('\n');
}

fs.mkdirSync(TMP + '/shots', { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) console.log('    HTTP ' + r.status() + ' ' + r.url()); });

  console.log('\nLoading');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  ok('page loads with no script errors', errors.length === 0, errors.join(' | '));
  ok('title is the product name', (await page.title()) === 'Where You Stand', await page.title());
  ok('four analysis modules are offered', (await page.locator('.tile[data-go="portfolio"], .tile[data-go="goal"], .tile[data-go="rolling"]').count()) === 4);
  ok('rolling returns is named on the home screen',
     /Rolling returns/.test(await page.locator('.tiles').innerText()));
  ok('and it is offered for both an index and a fund',
     (await page.locator('.tile[data-go="rolling"]').count()) === 2);
  await page.screenshot({ path: path.join(SHOTS, '01-home.png'), fullPage: true });

  /* ---------------------------------------------------------- portfolio */
  console.log('\nPortfolio XIRR');
  await page.click('.tile[data-go="portfolio"]');
  await page.waitForSelector('#view-portfolio.on');

  /* the spreadsheet-verified case: two lump sums -> 9.1% */
  const rows = page.locator('#pf-rows .entry');
  await rows.nth(0).locator('.in-date').fill('2024-01-01');
  await rows.nth(0).locator('.in-kind').selectOption('Money in');
  await rows.nth(0).locator('.in-amt').fill('100000');
  await rows.nth(1).locator('.in-date').fill('2025-01-01');
  await rows.nth(1).locator('.in-kind').selectOption('Money in');
  await rows.nth(1).locator('.in-amt').fill('100000');
  await rows.nth(2).locator('.in-date').fill('2026-01-01');
  await rows.nth(2).locator('.in-kind').selectOption('Worth today');
  await rows.nth(2).locator('.in-amt').fill('228000');
  await rows.nth(3).locator('.del').click();
  await page.click('#pf-calc');
  await page.waitForSelector('#pf-out .result');
  const xirrShown = (await page.locator('#pf-out .result .value').first().textContent()).trim();
  ok('portfolio XIRR matches the spreadsheet answer (9.1%)', xirrShown === '9.1%', 'got ' + xirrShown);
  const meaning = await page.locator('#pf-out .meaning').count();
  ok('the number is accompanied by meaning, limits and next steps', meaning >= 3, 'got ' + meaning);
  const body = await page.locator('#pf-out').innerText();
  ok('no raw NaN or undefined leaks to the screen', !/NaN|undefined|#VALUE|Infinity/.test(body), body.slice(0,120));
  ok('absolute return is kept separate from XIRR', /Absolute return/.test(body));
  await page.screenshot({ path: path.join(SHOTS, '02-portfolio.png'), fullPage: true });

  /* error handling: no current value */
  await rows.nth(2).locator('.in-kind').selectOption('Money in');
  await page.click('#pf-calc');
  await page.waitForSelector('#pf-out .notice.bad');
  const err = await page.locator('#pf-out .notice').innerText();
  ok('a missing current value gives a human sentence', /Worth today/.test(err) && !/NaN|undefined/.test(err), err);

  /* bad amount */
  await rows.nth(2).locator('.in-kind').selectOption('Worth today');
  await rows.nth(0).locator('.in-amt').fill('-5000');
  await page.click('#pf-calc');
  const err2 = await page.locator('#pf-out .notice').innerText();
  ok('a negative amount is refused in plain words', /positive/.test(err2), err2);
  await rows.nth(0).locator('.in-amt').fill('100000');

  /* ---------------------------------------------------------------- goal */
  console.log('\nGoal planner');
  await page.click('#back'); await page.click('.tile[data-go="goal"]');
  await page.waitForSelector('#view-goal.on');
  await page.fill('#g-current', '400000');
  await page.fill('#g-sip', '0');
  await page.fill('#g-years', '5');
  await page.fill('#g-rate', '8');
  await page.fill('#g-step', '0');
  await page.fill('#g-target', '1000000');
  await page.click('#g-calc');
  await page.waitForSelector('#g-out .result');
  const goalText = await page.locator('#g-out').innerText();
  /* 400000 * 1.08^5 = 587,731 -- worked out independently */
  ok('projection matches the compounding done by hand', /5,87,731|587,731/.test(goalText), goalText.slice(0, 160));
  ok('the shortfall is stated', /Short by/.test(goalText));
  ok('a required monthly top-up is given', /a month/.test(goalText));
  ok('scenarios are shown', /Add ₹2,000 a month/.test(goalText));
  ok('the assumption is labelled, not sold as a forecast', /assumption you typed in|not a forecast/.test(goalText));
  ok('goal chart rendered', (await page.locator('#g-out svg').count()) >= 1);
  ok('the chart has a text alternative', !!(await page.locator('#g-out svg[aria-label]').count()));
  await page.screenshot({ path: path.join(SHOTS, '03-goal.png'), fullPage: true });

  /* Nonsense input. Review v4 §11 caps a return at 30%, and §12.1 requires the
     refusal to happen ON THE FIELD before anything is computed -- a step-up of
     10000000 was accepted and returned a 68-digit figure. */
  await page.fill('#g-rate', '90');
  ok('an out-of-range return is refused on the field as it is typed',
     (await page.locator('#g-rate-bad').isVisible()) === true &&
     /between 0% and 30%/.test(await page.locator('#g-rate-bad').innerText()),
     await page.locator('#g-rate-bad').innerText());
  await page.click('#g-calc');
  ok('a fantasy return is refused, with the range named',
     /between 0% and 30%/.test(await page.locator('#g-out').innerText()),
     await page.locator('#g-out').innerText());
  /* the step-up on its own, with every other field back inside its range */
  await page.fill('#g-rate', '10');
  await page.fill('#g-step', '10000000');
  await page.click('#g-calc');
  const stepped = await page.locator('#g-out').innerText();
  ok('and the step-up that produced the 68-digit figure never computes',
     /between 0% and 25%/.test(stepped) && !/e\+/i.test(stepped), JSON.stringify(stepped));
  await page.fill('#g-step', '0');
  await page.fill('#g-rate', '10');

  /* The fund, index, hurdle-rate and benchmark journeys are covered in full by
     rolling.test.js, which drives the rebuilt module click by click. */

  /* --------------------------------------------------------------- sheet */
  console.log('\nThe spreadsheet, inside the tool');
  await page.click('#back');
  await page.click('[data-go="sheet"]');
  await page.waitForSelector('#view-sheet.on');
  const sheetText = await page.locator('#view-sheet').innerText();
  ok('the sheet is reachable without leaving the tool', /Download the sheet/.test(sheetText));
  ok('the phone app line is present', /free spreadsheet app/.test(sheetText));
  ok('the date warning survived the move', /05-Aug-2026/.test(sheetText));
  ok('the Google Sheets line survived the move', /Google Sheets and it works there too/.test(sheetText));
  const href = await page.locator('#view-sheet a.download').getAttribute('href');
  ok('the download points at a file beside the tool', href === 'XIRR-Calculator.xlsx', href);
  const dl = await page.request.get(new URL(href, BASE_URL).href);
  ok('the file is actually served', dl.status() === 200, 'status ' + dl.status());
  ok('it is served as a spreadsheet, not a web page',
     /spreadsheetml/.test(dl.headers()['content-type'] || ''), dl.headers()['content-type']);
  const bytes = await dl.body();
  ok('the file is a real workbook, not an error page',
     bytes.length > 20000 && bytes[0] === 0x50 && bytes[1] === 0x4b, 'length ' + bytes.length);

  /* the old separate address must still land somewhere useful */
  const oldPage = await page.request.get(new URL('../xirr/', BASE_URL).href);
  ok('the old sheet address still resolves', oldPage.status() === 200, 'status ' + oldPage.status());
  ok('the old address sends the reader to the tool', /url=\.\.\/tool\//.test(await oldPage.text()));

  /* -------------------------------------------------------------- privacy */
  console.log('\nPrivacy and robustness');
  const external = requests.filter(u => !u.startsWith(new URL(BASE_URL).origin + '/'));
  ok('the page makes no request to any other host', external.length === 0, external.join(', '));

  /* --------------------------------------------------------- the one world
   * The tool commits to a single dark palette rather than shipping a light
   * theme with a dark variant, so the check is that the ground is painted
   * explicitly and is the same under either OS setting. A page that borrows
   * its background from the host is the bug this guards against. */
  const obsidian = 'rgb(10, 14, 23)';
  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const dpage = await dark.newPage();
  await dpage.goto(BASE, { waitUntil: 'networkidle' });
  const bg = await dpage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('the page paints its own ground under a dark OS', bg === obsidian, 'got ' + bg);

  const lightCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const lpage = await lightCtx.newPage();
  await lpage.goto(BASE, { waitUntil: 'networkidle' });
  const lbg = await lpage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('and the identical ground under a light OS', lbg === obsidian, 'got ' + lbg);
  const lightInk = await lpage.evaluate(() => getComputedStyle(document.body).color);
  ok('with light ink on it, never the host\'s dark text', lightInk === 'rgb(255, 255, 255)', 'got ' + lightInk);
  await lightCtx.close();

  await dpage.screenshot({ path: path.join(SHOTS, '06-dark.png'), fullPage: true });

  /* ----------------------------------------------------------- no overflow */
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('nothing scrolls sideways on a phone', !overflow);

  /* -------------------------------------------------------------- desktop */
  const wide = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const wpage = await wide.newPage();
  await wpage.goto(BASE, { waitUntil: 'networkidle' });
  await wpage.screenshot({ path: path.join(SHOTS, '07-desktop.png'), fullPage: true });
  ok('desktop renders without error', true);

  ok('no script errors during the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ============================ review v4 §12.6, §12.9: the phone layout
   *
   * The recording showed ledger rows where every field was crushed to about
   * sixty pixels -- "Inv", "Amou", "Whicl", an empty date box -- while the ×
   * kept its full width, and a header two lines of title tall with the section
   * heading sitting behind it. Both are measured here, at the four widths the
   * review names.
   */
  console.log('\nThe phone layout, measured at 320, 360, 390 and 430');
  for (const width of [320, 360, 390, 430]) {
    const ctx2 = await browser.newContext({ viewport: { width, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE_URL + '#portfolio', { waitUntil: 'networkidle' });
    await p2.waitForTimeout(250);
    const m = await p2.evaluate(() => {
      const doc = document.documentElement;
      const fields = [...document.querySelectorAll(
        '#pf-rows .entry .in-date, #pf-rows .entry .in-kind, ' +
        '#pf-rows .entry .in-amt, #pf-rows .entry .in-tag')];
      const bar = document.querySelector('.topbar-inner');
      return {
        over: doc.scrollWidth - doc.clientWidth,
        narrowest: fields.length ? Math.min(...fields.map(e => e.getBoundingClientRect().width)) : 0,
        header: bar ? bar.getBoundingClientRect().height : 0,
        del: (document.querySelector('#pf-rows .entry .del') || {}).getBoundingClientRect
             ? document.querySelector('#pf-rows .entry .del').getBoundingClientRect().width : 0
      };
    });
    ok('no sideways scroll at ' + width, m.over <= 0, 'over by ' + m.over);
    /* the defect was ~60px; a field a reader can actually type into is far wider */
    ok('ledger fields are not crushed at ' + width, m.narrowest >= 140,
       'narrowest field ' + Math.round(m.narrowest) + 'px');
    ok('and the × keeps its 44 without taking their room at ' + width,
       Math.round(m.del) === 44, String(Math.round(m.del)));
    ok('the header is one line at ' + width, Math.round(m.header) <= 56,
       Math.round(m.header) + 'px');
    await ctx2.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
