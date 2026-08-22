/* The rolling-returns module: both sources, every control, and every refusal.
 *
 * This is the screen the whole product turns on, so it is driven the way a
 * reader drives it — click by click — and every expected number is known by
 * construction from the fixtures.
 */
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

const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* one file, several schemes — the way an official bulk download arrives */
function bulkFile(file, schemes, fromY, toY) {
  const out = ['Scheme Code;Scheme Name;ISIN Div Payout;ISIN Div Reinvestment;Net Asset Value;Date'];
  schemes.forEach(([name, rate], i) => {
    let v = 10, t = Date.UTC(fromY, 0, 1);
    while (t <= Date.UTC(toY, 0, 1)) {
      const d = new Date(t);
      out.push([1000 + i, name, 'INF' + i, '-', v.toFixed(4),
        String(d.getUTCDate()).padStart(2, '0') + '-' + M[d.getUTCMonth()] + '-' + d.getUTCFullYear()].join(';'));
      v *= Math.pow(1 + rate, 1 / 365.2425); t += 86400000;
    }
  });
  fs.writeFileSync(file, out.join('\n'));
  return file;
}

function plainFile(file, rate, fromY, toY, start = 100) {
  const out = ['Date,Close'];
  let v = start, t = Date.UTC(fromY, 0, 1);
  while (t <= Date.UTC(toY, 0, 1)) {
    out.push(new Date(t).toISOString().slice(0, 10) + ',' + v.toFixed(4));
    v *= Math.pow(1 + rate, 1 / 365.2425); t += 86400000;
  }
  fs.writeFileSync(file, out.join('\n'));
  return file;
}

(async () => {
  fs.mkdirSync(TMP + '/shots', { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const bulk = bulkFile(TMP + '/r-bulk.csv',
    [['Alpha Fund - Direct Growth', 0.14], ['Alpha Fund - Regular Growth', 0.11],
     ['Beta Fund - Direct Growth', 0.08]], 2010, 2025);
  const index = plainFile(TMP + '/r-index.csv', 0.10, 2005, 2025, 1000);

  /* ------------------------------------------------------------ structure */
  section('One screen, four labelled steps, nothing hidden');
  await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  const steps = (await page.locator('.card.step > h2').allInnerTexts())
    .map(t => t.replace(/\s+/g, ' ').trim());
  ok('the steps are numbered and named', steps.length === 4, steps.join(' // '));
  ok('step 1 asks what to analyse', /1 What do you want to analyse/.test(steps[0]), steps[0]);
  ok('step 2 asks which stretch of history', /2 Which stretch of history/.test(steps[1]), steps[1]);
  ok('step 3 asks how long each holding period is',
     /3 How long is each holding period/.test(steps[2]), steps[2]);
  ok('step 4 offers a comparison and marks it optional',
     /4 Compare against/.test(steps[3]) && /OPTIONAL/i.test(steps[3]), steps[3]);

  ok('the dates say what they bound',
     (await page.locator('label[for="r-start"]').innerText()).trim() === 'History from' &&
     (await page.locator('label[for="r-end"]').innerText()).trim() === 'History to');
  ok('all five holding periods are offered',
     (await page.locator('#r-years .chip').allInnerTexts()).join('|') ===
     '1 year|3 years|5 years|7 years|10 years');

  section('Controls stay visible but inert until there is data');
  ok('dates start disabled rather than hidden',
     await page.locator('#r-start').isDisabled() && await page.locator('#r-start').isVisible());
  ok('the analyse button starts disabled', await page.locator('#r-run').isDisabled());
  ok('the comparison starts disabled', await page.locator('#r-compare').isDisabled());
  ok('and the screen says what to do first',
     /Choose something to analyse first/.test(await page.locator('#r-range').innerText()));

  /* ------------------------------------------------------- the fund source */
  section('A fund, from a file holding many schemes');
  await page.click('#r-source .chip[data-source="fund"]');
  ok('choosing a source reveals only that source',
     await page.locator('#src-fund').isVisible() && await page.locator('#src-index').isHidden());

  await page.setInputFiles('#f-file', bulk);
  await page.waitForTimeout(1500);
  ok('a bulk file is not rejected', !(await page.locator('#r-scheme-wrap').isHidden()));
  ok('the reader is told how many funds it holds',
     /holds 3 funds/i.test(await page.locator('#r-loaded').innerText()),
     await page.locator('#r-loaded').innerText());
  ok('every fund is offered', (await page.locator('#r-scheme-list .hit').count()) === 3);
  ok('the list says how many the file holds',
     /3 funds in this file/.test(await page.locator('#r-scheme-count').innerText()));
  ok('each entry carries its own date range',
     /01-Jan-2010 to 01-Jan-2025/.test(await page.locator('#r-scheme-list .hit').first().innerText()));
  ok('the picker warns that Direct and Regular differ',
     /Direct and Regular/.test(await page.locator('#r-scheme-wrap').innerText()));

  await page.fill('#r-scheme-q', 'alpha fund - direct');
  await page.waitForTimeout(300);
  ok('typing narrows the list', (await page.locator('#r-scheme-list .hit').count()) === 1);
  await page.locator('#r-scheme-list .hit').first().click();
  await page.waitForTimeout(600);
  ok('picking a scheme enables the dates', !(await page.locator('#r-start').isDisabled()));
  ok('dates default to everything available',
     (await page.locator('#r-start').inputValue()) === '2010-01-01' &&
     (await page.locator('#r-end').inputValue()) === '2025-01-01');
  ok('the available range is stated in words',
     /01-Jan-2010 to 01-Jan-2025/.test(await page.locator('#r-range').innerText()));
  ok('the dates cannot be set outside the data',
     (await page.locator('#r-start').getAttribute('min')) === '2010-01-01' &&
     (await page.locator('#r-end').getAttribute('max')) === '2025-01-01');

  await page.click('#r-run');
  await page.waitForSelector('#r-out .result', { timeout: 20000 });
  let out = await page.locator('#r-out').innerText();
  ok('what was measured is stated before the answer', /What was measured/.test(out));
  ok('the analysed name is stated', /Alpha Fund - Direct Growth/.test(out));
  ok('the history searched is stated', /01-Jan-2010 to 01-Jan-2025/.test(out));
  ok('the holding period is stated', /5 years/.test(out));
  ok('the last usable start date is stated', /Start dates measured/.test(out));
  ok('a 14% scheme measures 14%',
     (await page.locator('#r-out .result .value').first().innerText()).trim() === '14.0%');

  section('Changing the scheme changes the answer');
  await page.fill('#r-scheme-q', 'regular');
  await page.waitForTimeout(300);
  await page.locator('#r-scheme-list .hit').first().click();
  await page.waitForTimeout(800);
  ok('the regular plan measures its own 11%, not the direct plan\'s',
     (await page.locator('#r-out .result .value').first().innerText()).trim() === '11.0%',
     await page.locator('#r-out .result .value').first().innerText());

  section('The period controls actually narrow the analysis');
  await page.fill('#r-scheme-q', 'direct');
  await page.waitForTimeout(300);
  await page.locator('#r-scheme-list .hit').first().click();
  await page.waitForTimeout(600);
  await page.fill('#r-start', '2015-01-01');
  await page.waitForTimeout(800);
  out = await page.locator('#r-out').innerText();
  ok('a narrowed start date is reflected in what was measured',
     /01-Jan-2015 to 01-Jan-2025/.test(out), out.slice(0, 300));
  await page.click('#r-all');
  await page.waitForTimeout(600);
  ok('“use everything available” restores the full range',
     (await page.locator('#r-start').inputValue()) === '2010-01-01');

  section('The holding period re-runs immediately');
  await page.locator('#r-years .chip', { hasText: '10 years' }).click();
  await page.waitForTimeout(800);
  ok('switching to ten years re-measures', /10 years/.test(await page.locator('#r-out').innerText()));
  await page.locator('#r-years .chip', { hasText: '5 years' }).click();
  await page.waitForTimeout(800);

  /* --------------------------------------------------------- the insight */
  section('The insight layer survives the restructure');
  out = await page.locator('#r-out').innerText();
  const spread = await page.locator('#r-out table.spread th').allInnerTexts();
  ok('worst to best through the quartiles',
     spread.join('|').toLowerCase() === 'worst|bottom quarter|median|top quarter|best',
     spread.join('|'));
  ok('the headline says which statistic it is', /median 5-year return/i.test(out), out.slice(0, 120));
  ok('and in what unit', /% a year/i.test(out));
  ok('start-date sensitivity is shown', /started elsewhere/i.test(out));
  ok('the hurdle-rate box is offered', await page.locator('#rate-rolling').isVisible());
  await page.fill('#rate-rolling', '20');
  await page.waitForTimeout(250);
  ok('a hurdle above the series is beaten by nothing',
     (await page.locator('#rateout-rolling').innerText()).trim() === '0%');

  /* -------------------------------------------------------- the benchmark */
  section('Comparing against an index');
  await page.click('#r-source .chip[data-source="index"]');
  ok('switching source clears the previous result',
     (await page.locator('#r-out').innerText()).trim() === '');
  await page.setInputFiles('#bm-file', index);
  await page.waitForTimeout(1200);
  ok('an index file loads', /Ready to analyse/.test(await page.locator('#r-loaded').innerText()));

  await page.click('#r-source .chip[data-source="fund"]');
  await page.setInputFiles('#f-file', bulk);
  await page.waitForTimeout(1500);
  await page.fill('#r-scheme-q', 'alpha fund - direct');
  await page.waitForTimeout(300);
  await page.locator('#r-scheme-list .hit').first().click();
  await page.waitForTimeout(600);
  ok('the loaded index is now offered as a comparison',
     !(await page.locator('#r-compare').isDisabled()));
  const cmpOpts = await page.locator('#r-compare option').allInnerTexts();
  ok('and it is named in the list', cmpOpts.length === 2, cmpOpts.join('|'));
  await page.selectOption('#r-compare', { index: 1 });
  await page.click('#r-run');
  await page.waitForSelector('#r-out .result', { timeout: 20000 });
  out = await page.locator('#r-out').innerText();
  ok('consistency against the benchmark is reported', /came out ahead/i.test(out));
  ok('a 14% fund beats a 10% index in every period', /100%/.test(out));
  ok('the reality check appears', /reality check/i.test(out));
  ok('only shared dates are compared', /both sets of data cover/.test(out));

  /* ------------------------------------------------------------ refusals */
  section('It refuses rather than guessing');
  await page.fill('#r-start', '2023-01-01');
  await page.waitForTimeout(800);
  ok('narrowing the window disables holding periods that no longer fit',
     await page.locator('#r-years .chip[data-years="5"]').isDisabled());
  ok('and the disabled chip says why',
     /needs 5 years of data/.test(await page.locator('#r-years .chip[data-years="5"]').innerText()));
  ok('the selection falls back instead of erroring',
     (await page.locator('#r-years .chip[aria-checked="true"]').textContent()).trim() === '1 year',
     await page.locator('#r-years .chip[aria-checked="true"]').textContent());
  out = await page.locator('#r-out').innerText();
  ok('the analysis still shows a result', /What was measured/.test(out));
  ok('no bare error code reaches the reader', !/NaN|undefined|#VALUE/.test(out));

  await page.fill('#r-start', '2024-08-01');
  await page.waitForTimeout(800);
  ok('a window too short for any holding period is refused',
     /Widen the dates|holding period/.test(await page.locator('#r-out').innerText()),
     (await page.locator('#r-out').innerText()).slice(0, 200));

  await page.fill('#r-start', '2020-01-01');
  await page.fill('#r-end', '2015-01-01');
  await page.waitForTimeout(700);
  ok('an end date before the start is refused',
     /end date must be after/i.test(await page.locator('#r-out').innerText()));

  await page.click('#r-all');
  await page.waitForTimeout(700);
  ok('resetting the range recovers', /came out ahead|Median/i.test(await page.locator('#r-out').innerText()));

  section('Start again clears everything');
  await page.click('#r-reset');
  await page.waitForTimeout(400);
  ok('the source selection is cleared',
     (await page.locator('#r-source .chip[aria-checked="true"]').count()) === 0);
  ok('the dates are disabled again', await page.locator('#r-start').isDisabled());
  ok('the analyse button is disabled again', await page.locator('#r-run').isDisabled());
  ok('the results are gone', (await page.locator('#r-out').innerText()).trim() === '');

  section('Old links still land somewhere sensible');
  for (const hash of ['#fund', '#history']) {
    await page.goto(BASE_URL + hash, { waitUntil: 'networkidle' });
    ok(hash + ' still reaches the rolling module', await page.locator('#view-rolling').isVisible());
  }

  ok('no script errors in the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  await page.screenshot({ path: TMP + '/shots/31-rolling-empty.png', fullPage: true });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
