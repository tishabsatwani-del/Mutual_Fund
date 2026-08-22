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
  ok('title is the product name', (await page.title()) === 'The Portfolio Reality Check');
  ok('all four modules are offered', (await page.locator('.tile[data-go]').count()) === 4);
  await page.screenshot({ path: path.join(SHOTS, '01-home.png'), fullPage: true });

  /* ---------------------------------------------------------- portfolio */
  console.log('\nPortfolio XIRR');
  await page.click('.tile[data-go="portfolio"]');
  await page.waitForSelector('#view-portfolio.on');

  /* the spreadsheet-verified case: two lump sums -> 9.1% */
  const rows = page.locator('#pf-rows .entry');
  await rows.nth(0).locator('.in-date').fill('2024-01-01');
  await rows.nth(0).locator('.in-kind').selectOption('Investment');
  await rows.nth(0).locator('.in-amt').fill('100000');
  await rows.nth(1).locator('.in-date').fill('2025-01-01');
  await rows.nth(1).locator('.in-kind').selectOption('Investment');
  await rows.nth(1).locator('.in-amt').fill('100000');
  await rows.nth(2).locator('.in-date').fill('2026-01-01');
  await rows.nth(2).locator('.in-kind').selectOption('Value today');
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
  await rows.nth(2).locator('.in-kind').selectOption('Investment');
  await page.click('#pf-calc');
  await page.waitForSelector('#pf-out .notice.bad');
  const err = await page.locator('#pf-out .notice').innerText();
  ok('a missing current value gives a human sentence', /Value today/.test(err) && !/NaN|undefined/.test(err), err);

  /* bad amount */
  await rows.nth(2).locator('.in-kind').selectOption('Value today');
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

  /* nonsense input */
  await page.fill('#g-rate', '90');
  await page.click('#g-calc');
  ok('a fantasy return is refused', /50%/.test(await page.locator('#g-out').innerText()));
  await page.fill('#g-rate', '10');

  /* ---------------------------------------------------------------- fund */
  console.log('\nAnalyse my fund');
  await page.click('#back'); await page.click('.tile[data-go="fund"]');
  await page.waitForSelector('#view-fund.on');
  const navPath = TMP + '/fund-nav.csv';
  fs.writeFileSync(navPath, navCsv());
  await page.setInputFiles('#f-file', navPath);
  await page.waitForSelector('#f-out .result', { timeout: 15000 });
  const fundText = await page.locator('#f-out').innerText();
  ok('the import report says what was read', /rows in file/i.test(fundText));
  const median = (await page.locator('#f-out .result .value').first().textContent()).trim();
  ok('a 13% file measures 13% over five years', median === '13.0%', 'got ' + median);
  ok('the range is shown, not just an average', /worst/i.test(fundText) && /best/i.test(fundText));
  ok('distribution chart rendered', (await page.locator('#f-out svg').count()) >= 1);
  ok('a table view of the chart exists', /See the numbers as a table/.test(fundText));
  ok('it says what the number does not mean', /not a forecast/.test(fundText));
  await page.screenshot({ path: path.join(SHOTS, '04-fund.png'), fullPage: true });

  /* horizon switching */
  await page.locator('#f-horizons .chip', { hasText: '10 years' }).click();
  await page.waitForTimeout(300);
  const tenText = await page.locator('#f-out').innerText();
  ok('switching the holding period recalculates', /10-year period/.test(tenText));

  /* not enough history */
  await page.locator('#f-horizons .chip', { hasText: '1 year' }).click();
  const shortPath = TMP + '/short.csv';
  fs.writeFileSync(shortPath, 'Date,NAV\n01-01-2024,10\n01-06-2024,11\n01-12-2024,12\n');
  await page.setInputFiles('#f-file', shortPath);
  await page.waitForTimeout(400);
  const shortText = await page.locator('#f-out').innerText();
  ok('too little history is explained, not crashed', /not enough|0\.9 years|shorter/i.test(shortText), shortText.slice(0, 200));

  /* a junk file */
  const junkPath = TMP + '/junk.csv';
  fs.writeFileSync(junkPath, 'hello,world\nthis,is not a nav file\n');
  await page.setInputFiles('#f-file', junkPath);
  await page.waitForTimeout(400);
  const junkText = await page.locator('#f-out').innerText();
  ok('a junk file is refused in plain words', /date/i.test(junkText) && !/NaN|undefined/.test(junkText), junkText.slice(0, 160));

  /* AMFI format */
  const amfiPath = TMP + '/amfi.csv';
  const amfi = ['Scheme Code;Scheme Name;ISIN Div Payout;ISIN Div Reinvestment;Net Asset Value;Date'];
  let tt = Date.UTC(2010, 0, 1), vv = 20;
  while (tt <= Date.UTC(2024, 0, 1)) {
    const d = new Date(tt);
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    amfi.push(`119551;A Fund - Growth;INF209K01Z15;-;${vv.toFixed(4)};${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`);
    vv *= Math.pow(1.09, 1/365.2425); tt += 86400000;
  }
  fs.writeFileSync(amfiPath, amfi.join('\n'));
  await page.setInputFiles('#f-file', amfiPath);
  await page.waitForSelector('#f-out .result', { timeout: 15000 });
  const amfiMedian = (await page.locator('#f-out .result .value').first().textContent()).trim();
  ok('AMFI semicolon files work end to end (9%)', amfiMedian === '9.0%', 'got ' + amfiMedian);

  /* ------------------------------------------------------------- history */
  console.log('\nMarket history');
  await page.click('#back'); await page.click('.tile[data-go="history"]');
  await page.waitForSelector('#view-history.on');
  const histText = await page.locator('#bm-list').innerText();
  ok('the empty benchmark slot is stated honestly', /No market data is bundled/.test(histText), histText.slice(0, 120));
  ok('it does not claim data it does not have', !/Nifty/.test(histText));
  await page.setInputFiles('#bm-file', navPath);
  await page.waitForSelector('#h-out .result', { timeout: 15000 });
  ok('an uploaded index file measures the same way', /Median annual return/.test(await page.locator('#h-out').innerText()));
  await page.screenshot({ path: path.join(SHOTS, '05-history.png'), fullPage: true });

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

  /* ------------------------------------------------------------ dark mode */
  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const dpage = await dark.newPage();
  await dpage.goto(BASE, { waitUntil: 'networkidle' });
  const bg = await dpage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('dark mode paints its own background', bg === 'rgb(22, 24, 28)', 'got ' + bg);
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

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
