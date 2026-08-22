/* The features that separate this from a calculator: the percentile spread,
 * start-date sensitivity, drawdown, benchmark consistency and the reality
 * check, plus the goal planner's sensitivity tables.
 *
 * Every expected value here is known by construction from the test fixtures. */
const { chromium } = require('playwright');
const fs = require('fs');
const TMP = process.env.PRC_TMP || '/tmp/prc';
const CHROME = process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE_URL = process.env.PRC_URL || 'http://127.0.0.1:8781/tool/';

let pass = 0; const fails = [];
function ok(n, c, d) {
  if (c) { pass++; console.log('  pass  ' + n); }
  else { fails.push(n); console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); }
}
function section(t) { console.log('\n' + t); }



fs.mkdirSync(TMP, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));


  /* The percentile spread, start-date sensitivity, drawdown, benchmark
     consistency and reality check are covered by rolling.test.js against the
     rebuilt module. What remains here is the goal planner. */

  /* ------------------------------------------------------------ goal planner */
  section('Goal planner sensitivity');
  await page.goto(BASE_URL + '#goal', { waitUntil: 'networkidle' });
  await page.fill('#g-current', '400000');
  await page.fill('#g-sip', '10000');
  await page.fill('#g-years', '15');
  await page.fill('#g-rate', '10');
  await page.fill('#g-target', '10000000');
  await page.click('#g-calc');
  await page.waitForSelector('#g-out .result', { timeout: 15000 });
  const goal = await page.locator('#g-out').innerText();
  ok('several return assumptions are shown side by side', /It depends what the market does/i.test(goal));
  ['6%', '8%', '10%', '12%'].forEach(r =>
    ok('the ' + r + ' assumption is listed', new RegExp(r.replace('%', '\\%') + ' a year').test(goal)));
  ok('it says nobody knows which row the future resembles', /which of these rows/i.test(goal));
  ok('the cost of waiting is shown', /what waiting costs/i.test(goal));
  ok('waiting is expressed as a monthly amount', /Needed each month/i.test(goal));
  ok('it points out only the years changed', /Only the number of years did/i.test(goal));
  ok('own money is separated from growth', /Your money, and growth on it/i.test(goal));
  ok('inflation is stated, not modelled silently', /future rupees, not today/i.test(goal));
  ok('the reader is told to raise the target themselves', /raise the target yourself/i.test(goal));

  ok('no script errors anywhere', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: TMP + '/shots/20-goal-sensitivity.png', fullPage: true });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
