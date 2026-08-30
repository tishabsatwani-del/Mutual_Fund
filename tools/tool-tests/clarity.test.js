/* Guards for the problems an independent audit found, so none of them can come
 * back unnoticed. Each test names the behaviour, not the bug.
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

function shortFile(file) {          /* three years only */
  const out = ['Date,NAV']; let v = 10, t = Date.UTC(2022, 0, 1);
  while (t <= Date.UTC(2025, 0, 1)) {
    out.push(new Date(t).toISOString().slice(0, 10) + ',' + v.toFixed(4));
    v *= Math.pow(1.10, 1 / 365.2425); t += 86400000;
  }
  fs.writeFileSync(file, out.join('\n')); return file;
}
function longFile(file) {
  const out = ['Date,NAV']; let v = 10, t = Date.UTC(2005, 0, 1);
  while (t <= Date.UTC(2025, 0, 1)) {
    out.push(new Date(t).toISOString().slice(0, 10) + ',' + v.toFixed(4));
    v *= Math.pow(1.12, 1 / 365.2425); t += 86400000;
  }
  fs.writeFileSync(file, out.join('\n')); return file;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const short = shortFile(TMP + '/c-short.csv');
  const long = longFile(TMP + '/c-long.csv');

  section('Switching source never leaves the other one loaded');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('.tile[data-go="rolling"][data-source="fund"]');
  await page.setInputFiles('#f-file', long);
  await page.waitForTimeout(1200);
  ok('a fund loads', /Ready to analyse/.test(await page.locator('#r-loaded').innerText()));
  await page.click('#back');
  await page.click('.tile[data-go="rolling"][data-source="index"]');
  await page.waitForTimeout(400);
  ok('arriving at the index tile selects the index source',
     (await page.locator('#r-source .chip[data-source="index"]').getAttribute('aria-checked')) === 'true');
  ok('and the previously loaded fund is gone',
     (await page.locator('#r-loaded').innerText()).trim() === '',
     await page.locator('#r-loaded').innerText());
  ok('so nothing can be analysed under the wrong label',
     await page.locator('#r-run').isDisabled());

  section('A holding period the data cannot support is never offered');
  await page.click('#r-source .chip[data-source="fund"]');
  await page.setInputFiles('#f-file', short);
  await page.waitForTimeout(1200);
  ok('ten years is disabled on a three-year file',
     await page.locator('#r-years .chip[data-years="10"]').isDisabled());
  ok('and the chip says why',
     /needs 10 years of data/.test(await page.locator('#r-years .chip[data-years="10"]').innerText()));
  ok('three years is still offered',
     !(await page.locator('#r-years .chip[data-years="3"]').isDisabled()));
  ok('the selection falls back to the longest period that fits',
     (await page.locator('#r-years .chip[aria-checked="true"]').innerText()).trim() === '3 years',
     await page.locator('#r-years .chip[aria-checked="true"]').innerText());

  await page.setInputFiles('#f-file', long);
  await page.waitForTimeout(1200);
  ok('a longer file re-enables the longer periods',
     !(await page.locator('#r-years .chip[data-years="10"]').isDisabled()));

  section('An empty comparison explains itself and offers the way out');
  const step4 = await page.locator('#step-compare').innerText();
  ok('it says why there is nothing to compare against', /Nothing to compare against yet/.test(step4), step4);
  ok('and offers to load an index right there', await page.locator('#cmp-file').count() === 1);
  await page.setInputFiles('#cmp-file', shortFile(TMP + '/c-cmp.csv'));
  await page.waitForTimeout(1000);
  ok('loading one makes it the chosen benchmark',
     (await page.locator('#r-compare').inputValue()) !== 'none',
     await page.locator('#r-compare').inputValue());

  section('A benchmark with no overlap says so, and the result is not lost');
  await page.click('#r-run');
  await page.waitForTimeout(1500);
  const out = await page.locator('#r-out').innerText();
  ok('the analysis still appears', /What was measured/.test(out), out.slice(0, 160));

  section('The index panel names what file to look for');
  await page.click('#r-source .chip[data-source="index"]');
  /* the guidance lives in a <details>; a reader opens it, so the test does too */
  await page.locator('#src-index details summary').click();
  await page.waitForTimeout(200);
  const idx = await page.locator('#src-index details .body').innerText();
  ok('it says where index data comes from', /index provider/i.test(idx));
  ok('it names the two columns needed', /a date/i.test(idx) && /index value on that date/i.test(idx));
  ok('it explains TRI versus a price index', /Total Return Index/.test(idx) && /dividends/.test(idx));

  section('Money that has not moved yet cannot be measured');
  await page.goto(BASE_URL + '#portfolio', { waitUntil: 'networkidle' });
  const rows = page.locator('#pf-rows .entry');
  await rows.nth(0).locator('.in-date').fill('2035-01-01');
  await rows.nth(0).locator('.in-kind').selectOption('Money in');
  await rows.nth(0).locator('.in-amt').fill('100000');
  await page.click('#pf-calc');
  await page.waitForTimeout(400);
  const err = await page.locator('#pf-out').innerText();
  ok('a future date is refused', /in the future/.test(err), err.slice(0, 200));
  ok('and the message says what the tool measures', /already moved/.test(err));

  section('Every row names itself on a phone');
  ok('each row carries a visible number',
     (await rows.nth(0).locator('.c-num').textContent()).trim() === 'Row 1' &&
     await rows.nth(0).locator('.c-num').isVisible(),
     await rows.nth(0).locator('.c-num').textContent());
  ok('the date field is labelled', await rows.nth(0).locator('label[for$="d"]').isVisible());
  ok('the amount field is labelled', await rows.nth(0).locator('label[for$="a"]').isVisible());

  section('The SIP builder is part of the page, not a stack of dialogs');
  await page.click('#pf-sip');
  ok('it opens inline', await page.locator('#sip-builder').isVisible());
  ok('the date is a real date picker',
     (await page.locator('#sip-start').getAttribute('type')) === 'date');
  ok('it cannot be set in the future',
     (await page.locator('#sip-start').getAttribute('max')) !== null);
  await page.fill('#sip-start', '2035-01-01');
  await page.click('#sip-add');
  await page.waitForTimeout(300);
  ok('a future first instalment is refused',
     /cannot be in the future/.test(await page.locator('#sip-msg').innerText()));
  await page.fill('#sip-start', '2024-01-01');
  await page.fill('#sip-amount', '5000');
  await page.fill('#sip-count', '6');
  await page.fill('#sip-name', 'Test Fund');
  await page.click('#sip-add');
  await page.waitForTimeout(500);
  ok('instalments are added as rows', (await rows.count()) >= 6);
  ok('the fund name is carried onto every row',
     (await rows.nth(4).locator('.in-tag').inputValue()) === 'Test Fund');
  ok('the panel closes once it has done its job', await page.locator('#sip-builder').isHidden());

  section('Large amounts are echoed in words a reader thinks in');
  await page.goto(BASE_URL + '#goal', { waitUntil: 'networkidle' });
  ok('the target is echoed', /crore|lakh/.test(await page.locator('#g-target-echo').innerText()),
     await page.locator('#g-target-echo').innerText());
  await page.fill('#g-target', '1000000');
  await page.waitForTimeout(200);
  /* Review v4 §11: two decimals below a hundred units, so a missing zero moves
     the echo from ₹1.00 crore to ₹10.00 lakh -- a different word, not a
     different digit, which is the whole point of the helper. */
  ok('a missing zero visibly changes the echo',
     /10\.00 lakh/.test(await page.locator('#g-target-echo').innerText()),
     await page.locator('#g-target-echo').innerText());
  ok('what you already have is echoed too',
     /lakh|crore/.test(await page.locator('#g-current-echo').innerText()));

  section('The assumed return points somewhere for a basis');
  const rateHint = await page.locator('#g-rate').locator('xpath=following-sibling::p[not(@hidden)]').first().innerText();
  ok('it admits the tool will not suggest a number', /will not suggest/.test(rateHint), rateHint);
  ok('and offers a route to historical evidence', /actually returned/.test(rateHint));
  await page.locator('#g-rate').locator('xpath=following-sibling::p').locator('button[data-go]').first().click();
  await page.waitForTimeout(400);
  ok('that route reaches the rolling module on the index source',
     await page.locator('#view-rolling').isVisible() &&
     (await page.locator('#r-source .chip[data-source="index"]').getAttribute('aria-checked')) === 'true');

  ok('no script errors anywhere', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
