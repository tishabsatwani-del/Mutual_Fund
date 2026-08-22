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

/* a series growing at exactly `rate` a year, every calendar day */
function steady(rate, fromY, toY, file) {
  const lines = ['Date,NAV'];
  let t = Date.UTC(fromY, 0, 1), v = 100;
  while (t <= Date.UTC(toY, 0, 1)) {
    const d = new Date(t);
    lines.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')},${v.toFixed(4)}`);
    v *= Math.pow(1 + rate, 1 / 365.2425); t += 86400000;
  }
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

/* rises to 120, halves to 60, recovers past the old high */
function shaped(file) {
  const pts = [[2015, 100], [2017, 120], [2018, 60], [2020, 100], [2022, 130], [2025, 160]];
  const lines = ['Date,NAV'];
  for (let i = 0; i < pts.length - 1; i++) {
    const [y0, v0] = pts[i], [y1, v1] = pts[i + 1];
    let t = Date.UTC(y0, 0, 1); const end = Date.UTC(y1, 0, 1);
    const span = (end - t) / 86400000;
    let n = 0;
    while (t < end) {
      const d = new Date(t);
      const v = v0 + (v1 - v0) * (n / span);
      lines.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')},${v.toFixed(4)}`);
      t += 86400000; n++;
    }
  }
  lines.push('2025-01-01,160.0000');
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

fs.mkdirSync(TMP, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const fund = steady(0.13, 2005, 2025, TMP + '/i-fund.csv');
  const bench = steady(0.09, 2005, 2025, TMP + '/i-bench.csv');
  const falling = shaped(TMP + '/i-shaped.csv');

  /* ------------------------------------------------------ percentile spread */
  section('The spread is the headline, not the average');
  await page.goto(BASE_URL + '#fund', { waitUntil: 'networkidle' });
  await page.setInputFiles('#f-file', fund);
  await page.waitForSelector('#f-out .result', { timeout: 20000 });
  const heads = await page.locator('#f-out table.spread th').allInnerTexts();
  /* the stylesheet uppercases table headings, so compare case-insensitively */
  ok('worst to best, through the quartiles, in that order',
     heads.join('|').toLowerCase() === 'worst|25th|median|75th|best', heads.join('|'));
  const spread = await page.locator('#f-out table.spread td').allInnerTexts();
  ok('a 13% series reads 13% at every percentile',
     spread.every(v => v.trim() === '13.0%'), spread.join('|'));
  const body = await page.locator('#f-out').innerText();
  ok('the average is still shown, just not as the headline', /average/i.test(body));

  /* --------------------------------------------------- start-date sensitivity */
  section('Start-date sensitivity');
  ok('it asks whether the result survives a different starting day',
     /started elsewhere/i.test(body));
  ok('it names the actual starting dates', /\d{2}-[A-Z][a-z]{2}-\d{4}/.test(body));

  /* ------------------------------------------------------------- drawdown */
  section('The worst fall along the way');
  await page.setInputFiles('#f-file', falling);
  await page.waitForSelector('#f-out .result', { timeout: 20000 });
  const fallText = await page.locator('#f-out').innerText();
  ok('the deepest fall is reported', /worst fall along the way/i.test(fallText));
  ok('a 120 to 60 fall measures -50%', /-50\.0%/.test(fallText), fallText.slice(0, 400));
  ok('it says when the old high was regained', /back to the old high/i.test(fallText));
  ok('it explains what holding through it meant', /still there afterwards/i.test(fallText));

  /* ------------------------------------------------- fund versus benchmark */
  section('Fund against benchmark');
  await page.goto(BASE_URL + '#history', { waitUntil: 'networkidle' });
  await page.setInputFiles('#bm-file', bench);
  await page.waitForSelector('#h-out .result', { timeout: 20000 });
  await page.goto(BASE_URL + '#fund', { waitUntil: 'networkidle' });
  await page.setInputFiles('#f-file', fund);
  await page.waitForSelector('#f-out .result', { timeout: 20000 });
  const options = await page.locator('#f-compare option').allInnerTexts();
  ok('the loaded benchmark is offered for comparison', options.length > 1, options.join('|'));
  await page.selectOption('#f-compare', { index: 1 });
  await page.waitForTimeout(600);
  const cmp = await page.locator('#f-out').innerText();
  ok('consistency is reported as a share of periods', /came out ahead/i.test(cmp));
  ok('a 13% fund beats a 9% benchmark in every period', /100%/.test(cmp), cmp.slice(0, 300));
  ok('the median gap is given in percentage points', /percentage points/.test(cmp));
  ok('percentiles are compared, not just the ends', /25th percentile/.test(cmp));
  ok('only shared dates are compared', /both sets of data cover/.test(cmp));

  section('Reality check');
  ok('the reality check appears', /reality check/i.test(cmp));
  ok('return is graded against the benchmark', /Ahead|Behind|Similar/.test(cmp));
  ok('consistency is graded', /Strong|Mixed|Weak/.test(cmp));
  ok('the weight of evidence is stated', /weight of evidence/i.test(cmp));
  ok('it refuses to call the fund suitable', /does not establish|none of it establishes/i.test(cmp));
  ok('it gives no buy or sell instruction',
     !/\b(buy now|sell now|strong buy|you should buy|you should sell|exit immediately)\b/i.test(cmp));
  ok('it says plainly that nothing here is a recommendation',
     /nothing here is a recommendation/i.test(cmp));

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
  await page.goto(BASE_URL + '#fund', { waitUntil: 'networkidle' });
  await page.setInputFiles('#f-file', falling);
  await page.waitForSelector('#f-out .result', { timeout: 20000 });
  await page.screenshot({ path: TMP + '/shots/21-fund-intelligence.png', fullPage: true });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
