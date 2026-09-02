/* The date fields spell their value the way the rest of the tool does.
 *
 * A native <input type="date"> shows its value in the browser's locale, which
 * on many Indian phones is the US order (09/02/2026). dates.js keeps the native
 * input as the tap target but draws it transparent and spells the chosen date
 * dd-Mmm-yyyy in a sibling. The page may not include the script yet, so this
 * suite injects it after load and calls the API itself.
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

/* what one decorated field looks like right now */
const inspect = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { missing: true };
  const wrap = el.parentElement;
  const show = wrap && wrap.querySelector('.dateshow');
  const cs = show && getComputedStyle(show);
  return {
    wrapped: !!wrap && wrap.classList.contains('datewrap'),
    hasShow: !!show,
    text: show ? show.textContent : null,
    showClass: show ? show.className : null,
    showOpacity: cs ? cs.opacity : null,
    showOutline: cs ? cs.outlineStyle + ' ' + cs.outlineWidth : null,
    inputOpacity: getComputedStyle(el).opacity,
    ariaHidden: show ? show.getAttribute('aria-hidden') : null,
    id: el.id, type: el.type,
    wrapDisplay: wrap ? getComputedStyle(wrap).display : null
  };
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
    await page.addScriptTag({ url: BASE_URL + 'dates.js' });
    await page.evaluate(() => window.PRCDates.decorate(document));
    await page.waitForTimeout(100);

    section('A disabled, empty date field');
    let s = await page.evaluate(inspect('#r-start'));
    ok('#r-start is wrapped in .datewrap', s.wrapped, JSON.stringify(s));
    ok('it has a .dateshow sibling', s.hasShow);
    ok('the sibling is hidden from assistive tech', s.ariaHidden === 'true');
    ok('an empty field reads dd-Mmm-yyyy', s.text === 'dd-Mmm-yyyy', s.text);
    ok('a disabled field is dimmed', /\bis-disabled\b/.test(s.showClass) && s.showOpacity === '0.5',
       s.showClass + ' ' + s.showOpacity);
    ok('the native input is transparent, not gone', s.inputOpacity === '0', s.inputOpacity);
    ok('the input keeps its id and type', s.id === 'r-start' && s.type === 'date');
    ok('a full-width input gets a full-width wrap', s.wrapDisplay === 'block', s.wrapDisplay);
    ok('the CSS is injected once', (await page.locator('#prc-dates-css').count()) === 1);
    await page.evaluate(() => window.PRCDates.decorate(document));
    ok('decorating twice wraps nothing twice',
       (await page.locator('#r-start').evaluate(el => el.parentElement.parentElement.classList.contains('datewrap'))) === false);

    section('Filling it the way a reader (or Playwright) does');
    await page.evaluate(() => { document.querySelector('#r-start').disabled = false; });
    await page.waitForTimeout(400);
    s = await page.evaluate(inspect('#r-start'));
    ok('enabling the input un-dims the display', !/\bis-disabled\b/.test(s.showClass), s.showClass);
    await page.fill('#r-start', '2019-08-30');
    await page.waitForTimeout(400);
    s = await page.evaluate(inspect('#r-start'));
    ok('30 August 2019 reads 30-Aug-2019, not 08/30/2019', s.text === '30-Aug-2019', s.text);
    ok('a filled field is no longer muted', !/\bis-empty\b/.test(s.showClass), s.showClass);
    ok('the input value is untouched', (await page.inputValue('#r-start')) === '2019-08-30');

    section('Setting the value from code, with no event');
    await page.evaluate(() => { document.querySelector('#r-start').value = '2026-09-02'; });
    await page.waitForTimeout(400);
    s = await page.evaluate(inspect('#r-start'));
    ok('a programmatic value shows within 400ms', s.text === '02-Sep-2026', s.text);
    await page.evaluate(() => { document.querySelector('#r-start').value = ''; });
    await page.waitForTimeout(400);
    s = await page.evaluate(inspect('#r-start'));
    ok('clearing it from code brings the placeholder back',
       s.text === 'dd-Mmm-yyyy' && /\bis-empty\b/.test(s.showClass), s.text);

    section('Taps still reach the native picker');
    const hit = await page.evaluate(() => {
      const el = document.querySelector('#r-start');
      const r = el.getBoundingClientRect();
      el.scrollIntoView({ block: 'center' });
      const r2 = el.getBoundingClientRect();
      const at = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2);
      return { id: at && at.id, tag: at && at.tagName, w: r.width, h: r.height };
    });
    ok('the input is the element at the centre of the field', hit.id === 'r-start', JSON.stringify(hit));
    ok('the field still has a tappable box (>= 44px tall)', hit.h >= 44 && hit.w > 100, JSON.stringify(hit));
    const showBox = await page.evaluate(() => {
      const el = document.querySelector('#r-start');
      const a = el.getBoundingClientRect(), b = el.parentElement.querySelector('.dateshow').getBoundingClientRect();
      return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 &&
             Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
    });
    ok('the display sits exactly over the input', showBox);
    await page.focus('#r-start');
    await page.waitForTimeout(50);
    s = await page.evaluate(inspect('#r-start'));
    ok('focus draws a visible ring on the display',
       /\bis-focus\b/.test(s.showClass) && /^solid 3px$/.test(s.showOutline), s.showClass + ' ' + s.showOutline);
    /* Tab inside a Chrome date input only moves between its own segments, so
       leave the field the way a tap elsewhere would. */
    await page.evaluate(() => document.querySelector('#r-start').blur());
    await page.waitForTimeout(50);
    s = await page.evaluate(inspect('#r-start'));
    ok('blur takes the ring away', !/\bis-focus\b/.test(s.showClass), s.showClass);
    await page.click('#r-start');
    await page.waitForTimeout(100);
    ok('clicking the field raises no error (showPicker is guarded)', errors.length === 0, errors.join(' | '));
    /* the click opened the native picker; close it before going on */
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('#r-start').blur());

    section('A date input added later');
    await page.evaluate(() => {
      const el = document.createElement('input');
      el.type = 'date'; el.id = 'late-date'; el.value = '2021-03-09';
      document.querySelector('#view-rolling').appendChild(el);
    });
    await page.waitForTimeout(400);
    s = await page.evaluate(inspect('#late-date'));
    ok('it is decorated within 400ms', s.wrapped && s.hasShow, JSON.stringify(s));
    ok('and already spells its value', s.text === '09-Mar-2021', s.text);
    await page.evaluate(() => {
      const row = document.createElement('div');
      row.innerHTML = '<label>x <input type="date" id="nested-date"></label>';
      document.querySelector('#view-rolling').appendChild(row);
    });
    await page.waitForTimeout(400);
    s = await page.evaluate(inspect('#nested-date'));
    ok('so is one nested inside an added subtree', s.wrapped && s.hasShow, JSON.stringify(s));
    ok('the other date fields were decorated too',
       (await page.locator('#r-end').evaluate(el => el.parentElement.classList.contains('datewrap'))) &&
       (await page.locator('#sip-start').evaluate(el => el.parentElement.classList.contains('datewrap'))));

    section('format()');
    const f = await page.evaluate(() => [
      PRCDates.format('2021-03-09'), PRCDates.format('2026-09-02'), PRCDates.format(''),
      PRCDates.format('nonsense'), PRCDates.format(null), PRCDates.format('2021-02-30'),
      PRCDates.format('2024-02-29')
    ]);
    ok("format('2021-03-09') === '09-Mar-2021'", f[0] === '09-Mar-2021', f[0]);
    ok("format('2026-09-02') === '02-Sep-2026'", f[1] === '02-Sep-2026', f[1]);
    ok('empty, junk and null give an empty string', f[2] === '' && f[3] === '' && f[4] === '');
    ok('an impossible date is refused, a real leap day is not', f[5] === '' && f[6] === '29-Feb-2024', f[5] + '/' + f[6]);

    section('Nothing broke');
    ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    fs.mkdirSync(TMP + '/shots', { recursive: true });
    try { await page.screenshot({ path: TMP + '/shots/23-dates.png', fullPage: true, timeout: 10000 }); }
    catch (e) { console.log('  (screenshot skipped: ' + e.message.split('\n')[0] + ')'); }
  } finally {
    await browser.close();
  }
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
