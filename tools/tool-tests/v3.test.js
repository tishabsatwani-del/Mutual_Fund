/* Where You Stand — Tool 3 and the materials it is made of.
 *
 * Two halves. The first measures every colour in the palette, so a change that
 * makes a pair unreadable fails here rather than in front of a reader. The
 * second drives the real screen in a real browser, in both the day and the
 * night sheet.
 *
 * Run: node tools/tool-tests/v3.test.js   (needs a static server on 8781)
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.PRC_URL_V3 || 'http://127.0.0.1:8781/tool/v3/';
const TMP = process.env.PRC_TMP || '/tmp/prc';

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  pass  ' + name); }
  else { fails.push(name); console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------- contrast */
function lum(h) {
  const c = h.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
function over(fg, bg, alpha) {
  const f = fg.replace('#', '').match(/../g).map(x => parseInt(x, 16));
  const b = bg.replace('#', '').match(/../g).map(x => parseInt(x, 16));
  return '#' + f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

/* The values the stylesheet is supposed to hold. If someone edits theme.css
   these stop matching, which is the point. */
const DAY = { paper: '#F1EFEA', ink: '#1E2433', muted: '#5F6779', slate: '#4C6A9C',
              rule: '#B7C1D3', edge: '#7D8AA0', marker: '#FFE566' };
const NIGHT = { paper: '#12161E', ink: '#E8E6E1', muted: '#9AA1AE', slate: '#8FA8D3',
                rule: '#2C3442', edge: '#5A6475', markerInk: '#F2CF5B' };

(async () => {
  section('The palette, measured — text pairs need 4.5:1');
  ok('day ink on paper', ratio(DAY.ink, DAY.paper) >= 4.5, ratio(DAY.ink, DAY.paper).toFixed(2));
  ok('day muted on paper', ratio(DAY.muted, DAY.paper) >= 4.5, ratio(DAY.muted, DAY.paper).toFixed(2));
  ok('day slate on paper', ratio(DAY.slate, DAY.paper) >= 4.5, ratio(DAY.slate, DAY.paper).toFixed(2));
  const band = over(DAY.marker, DAY.paper, 0.55);
  ok('day ink on the marker band (composited ' + band + ')',
     ratio(DAY.ink, band) >= 4.5, ratio(DAY.ink, band).toFixed(2));
  ok('night ink on paper', ratio(NIGHT.ink, NIGHT.paper) >= 4.5, ratio(NIGHT.ink, NIGHT.paper).toFixed(2));
  ok('night muted on paper', ratio(NIGHT.muted, NIGHT.paper) >= 4.5, ratio(NIGHT.muted, NIGHT.paper).toFixed(2));
  ok('night slate on paper', ratio(NIGHT.slate, NIGHT.paper) >= 4.5, ratio(NIGHT.slate, NIGHT.paper).toFixed(2));
  ok('night marker as ink', ratio(NIGHT.markerInk, NIGHT.paper) >= 4.5,
     ratio(NIGHT.markerInk, NIGHT.paper).toFixed(2));

  section('The two grades of ruling');
  ok('a tappable edge reaches 3:1 by day', ratio(DAY.edge, DAY.paper) >= 3,
     ratio(DAY.edge, DAY.paper).toFixed(2));
  ok('and by night', ratio(NIGHT.edge, NIGHT.paper) >= 3, ratio(NIGHT.edge, NIGHT.paper).toFixed(2));
  ok('a plain divider is allowed to be quiet, and is',
     ratio(DAY.rule, DAY.paper) < 3 && ratio(NIGHT.rule, NIGHT.paper) < 3);
  ok('an edge always reads stronger than a divider',
     ratio(DAY.edge, DAY.paper) > ratio(DAY.rule, DAY.paper) &&
     ratio(NIGHT.edge, NIGHT.paper) > ratio(NIGHT.rule, NIGHT.paper));

  section('The stylesheet actually holds those values');
  const css = fs.readFileSync(path.join(__dirname, '../../tool/v3/theme.css'), 'utf8');
  Object.entries({ '--paper': DAY.paper, '--ink': DAY.ink, '--muted': DAY.muted,
                   '--slate': DAY.slate, '--rule': DAY.rule, '--rule-edge': DAY.edge })
    .forEach(([k, v]) => ok('theme.css sets ' + k + ' to ' + v, css.includes(k + ':' + ' '.repeat(Math.max(1, 14 - k.length)) + v) || css.includes(k + ': ' + v), 'not found'));
  ok('no red and no green anywhere in the palette',
     !/#(ff|e[0-9a-f])[0-9a-f]{2}[0-3][0-9a-f]{3}|green|crimson|tomato/i.test(css.split('/*')[0] + css));
  ok('nothing glows and nothing is a gradient',
     !/box-shadow:[^;]*rgba\([^)]*\)\s*;?\s*\}?\s*$/m.test(css) && !/linear-gradient|radial-gradient/.test(css));

  /* ------------------------------------------------------------- the screen */
  const browser = await chromium.launch({ executablePath: CHROME });
  const navFile = path.join(TMP, 'v3-nav.csv');
  fs.mkdirSync(TMP, { recursive: true });
  {
    const lines = ['Date,NAV']; let t = Date.UTC(2008, 0, 1), v = 10;
    while (t <= Date.UTC(2025, 0, 1)) {
      const d = new Date(t), dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        lines.push(`${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()},${v.toFixed(4)}`);
      }
      v *= Math.pow(1.14, 1 / 365.2425) * (1 + Math.sin(t / 7e9) * 0.0016);
      t += 86400000;
    }
    fs.writeFileSync(navFile, lines.join('\n'));
  }

  for (const scheme of ['light', 'dark']) {
    section('The reading, ' + (scheme === 'light' ? 'day' : 'night') + ' sheet');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
    page.on('request', r => { if (!r.url().startsWith(new URL(BASE).origin + '/')) external.push(r.url()); });

    await page.goto(BASE + '#stand', { waitUntil: 'networkidle' });
    ok('loads with no script errors', errors.length === 0, errors.join(' | '));

    const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok('paints its own ground', ground === (scheme === 'light' ? 'rgb(241, 239, 234)' : 'rgb(18, 22, 30)'), ground);

    await page.setInputFiles('#file', navFile);
    await page.waitForTimeout(600);
    ok('the upload door loads a history', /prices/.test(await page.locator('#fund-state').innerText()));

    await page.click('#example');
    await page.waitForTimeout(200);
    ok('the ledger fills with one ruled line per entry',
       (await page.locator('#rows tr').count()) === 60, String(await page.locator('#rows tr').count()));

    await page.click('#run');
    await page.waitForSelector('#reading .reading');
    await page.waitForTimeout(1200);

    /* Exactly one figure is large: the reader's own. Everything else is a
       ruled line with its figure aligned right. */
    ok('the reading is boxed',
       (await page.evaluate(() => getComputedStyle(document.querySelector('.reading')).borderStyle)) === 'solid');
    ok('the reader\'s own speed is the one large figure',
       (await page.locator('#reading .reading .figure').count()) === 1);
    const hero = (await page.locator('#reading .hero .figure').innerText()).trim();
    ok('and it is a percentage', /^\d+\.\d%$/.test(hero), hero);
    ok('with its unit inline beside it, not beneath',
       (await page.locator('#reading .hero .unit').innerText()).trim() === 'a year');
    ok('it wears the marker, and nothing else on the page does',
       (await page.locator('#reading .figure.mine').count()) === 1);

    const lines = await page.evaluate(() => [...document.querySelectorAll('.reading .line')].map(l => ({
      what: l.querySelector('.what').childNodes[0].textContent.trim(),
      val: l.querySelector('.val').textContent.trim()
    })));
    ok('the fund over the reader\'s dates comes first',
       /fund over your dates/i.test(lines[0].what), JSON.stringify(lines[0]));
    ok('the placement second, out of a hundred',
       /Higher than \d+ of 100/.test(lines[1].val), JSON.stringify(lines[1]));
    ok('no decimal percentile reaches the screen', !/\d\.\d+ of 100/.test(lines[1].val));
    ok('and the index fund last', /index fund/i.test(lines[2].what), JSON.stringify(lines[2]));

    ok('a reading the tool will not give keeps its line, at less weight',
       (await page.locator('#reading .line.suppressed').count()) >= 1);
    ok('and says why, rather than showing a bare dash',
       /No index fund is loaded/.test(await page.locator('#reading .line.suppressed').innerText()));

    ok('the life-line is drawn', (await page.locator('.lifeline').count()) === 1);
    ok('it carries the reader\'s own stretch', (await page.locator('.ll-mine').count()) === 1);
    ok('and it is described for anyone who cannot see it',
       /whole recorded life/.test(await page.locator('.lifeline').getAttribute('aria-label')));
    ok('the marker appears on no other chart in the product',
       (await page.locator('.ll-band, .ll-mine').count()) <= 2);
    ok('the band hugs the line rather than filling the chart',
       (await page.evaluate(() => {
         const r = document.querySelector('.ll-band');
         return r ? parseFloat(r.getAttribute('height')) : 999;
       })) < 142);
    ok('the three names sit beneath the line',
       (await page.evaluate(() => [...document.querySelectorAll('.ll-mark-text')]
          .every(t => parseFloat(t.getAttribute('y')) > 150))) === true);

    const named = await page.locator('#reading .slot-empty code').allInnerTexts();
    ok('every unwritten sentence is named on screen, not left blank',
       named.length >= 1 && named.every(n => /^[A-Z0-9-]+$/.test(n)), named.join(', '));
    ok('and no sentence is invented in the meantime',
       (await page.locator('#reading .sentence').count()) === 0);

    ok('no request leaves the site', external.length === 0, external.join(', '));

    const money = await page.locator('#reading table.ledger').last().innerText();
    ok('money carries Indian grouping', /₹\d,\d\d,\d\d\d/.test(money), money.slice(0, 80));

    await page.screenshot({ path: path.join(TMP, `v3-${scheme}.png`), fullPage: true });
    await ctx.close();
  }

  section('The shell: four tools behind one address');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });

    ok('home offers the four tools by name',
       (await page.locator('.entry b').allInnerTexts()).join(' | ') ===
       'My return | This fund’s record | My money in this fund | My plan, tested',
       (await page.locator('.entry b').allInnerTexts()).join(' | '));

    await page.click('a[href="#record"]');
    await page.waitForTimeout(200);

    /* The router hides sections by [data-view]. The <body> carries the same
       attribute as a styling hook, so an unscoped selector hid the entire page
       — everything was in the DOM and nothing could be clicked. */
    ok('navigating does not hide the page itself',
       (await page.evaluate(() => document.body.hidden)) === false);
    ok('and the tool asked for is the one shown',
       (await page.locator('#main > [data-view="record"]').isVisible()) === true &&
       (await page.locator('#main > [data-view="home"]').isVisible()) === false);

    /* The sticky header is .bar. So, once, was the histogram's bar, and the
       later rule won: the header became a histogram bar. */
    const bar = await page.evaluate(() => {
      const b = document.querySelector('.bar'), cs = getComputedStyle(b);
      return { w: b.getBoundingClientRect().width, bg: cs.backgroundColor, display: cs.display,
               link: getComputedStyle(document.querySelector('.bar .name')).color };
    });
    ok('the header spans the screen', bar.w === 390, String(bar.w));
    ok('on paper, not ink', bar.bg === 'rgb(241, 239, 234)', bar.bg);
    ok('and its brand is ink, not a browser link colour', bar.link === 'rgb(30, 36, 51)', bar.link);

    section('Tool 2 · This fund’s record');
    await page.setInputFiles('#r-file', navFile);
    await page.waitForTimeout(700);

    const chips = await page.locator('#r-years .chip').allInnerTexts();
    ok('the six holding periods are offered',
       chips.join(',') === '1 year,3 years,5 years,7 years,10 years,15 years', chips.join(','));
    ok('none is chosen for the reader',
       (await page.locator('#r-years .chip[aria-checked="true"]').count()) === 0);
    ok('and nothing renders until one is',
       (await page.locator('#r-out').innerText()).trim() === '');

    await page.click('#r-years .chip[data-y="5"]');
    await page.waitForTimeout(900);

    const order = await page.locator('#r-out .windows .label').allInnerTexts();
    ok('the worst window is read first',  /worst/i.test(order[0]), order.join(' | '));
    ok('the typical one second',          /typical/i.test(order[1]), order.join(' | '));
    ok('the best third',                  /best/i.test(order[2]), order.join(' | '));

    const worstSize = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.w-worst .figure')).fontSize));
    const bestSize = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.w-best .figure')).fontSize));
    ok('and the worst is the largest figure on the screen', worstSize > bestSize,
       worstSize + ' vs ' + bestSize);

    const body = await page.locator('#r-out').innerText();
    ok('the mean is nowhere on the screen', !/\bmean\b|\baverage\b/i.test(body));
    ok('the latest window is placed out of a hundred',
       /higher than \d+ of every 100/i.test(body), body.slice(0, 200));

    ok('the life-line is drawn here too', (await page.locator('#r-out .lifeline').count()) === 1);
    ok('with the worst, best and latest windows named beneath it',
       (await page.locator('#r-out .ll-mark-text').count()) === 3,
       String(await page.locator('#r-out .ll-mark-text').count()));
    ok('each with a dot on the line itself',
       (await page.locator('#r-out .ll-dot').count()) === 3);
    ok('and no marker band, because this is not the reader’s own stretch',
       (await page.locator('#r-out .ll-band').count()) === 0);

    ok('the deposit rate ships empty',
       (await page.locator('#r-dep').inputValue()) === '');
    ok('below-zero windows are a count, not a share',
       /\d+ of [\d,]+/.test(body), body.slice(0, 200));
    await page.fill('#r-dep', '7');
    await page.waitForTimeout(200);
    ok('typing a deposit adds the second count',
       /of [\d,]+/.test(await page.locator('#r-dep-row').innerText()));

    ok('the histogram is one tap away, not on the screen',
       (await page.locator('#r-out details').count()) === 1 &&
       (await page.evaluate(() => document.querySelector('#r-out details').open)) === false);

    /* A short history must be refused as a reading, with the arithmetic shown
       and the author's sentence named. */
    const shortFile = path.join(TMP, 'v3-short.csv');
    {
      const lines = ['Date,NAV']; let t = Date.UTC(2019, 0, 1), v = 10;
      while (t <= Date.UTC(2025, 0, 1)) {
        const d = new Date(t);
        lines.push(`${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()},${v.toFixed(4)}`);
        v *= Math.pow(1.13, 1 / 365.2425); t += 86400000;
      }
      fs.writeFileSync(shortFile, lines.join('\n'));
    }
    await page.setInputFiles('#r-file', shortFile);
    await page.waitForTimeout(700);
    ok('lengths the history cannot measure are disabled',
       (await page.locator('#r-years .chip[disabled]').count()) >= 2,
       String(await page.locator('#r-years .chip[disabled]').count()));
    await page.click('#r-years .chip[data-y="5"]');
    await page.waitForTimeout(700);
    const guarded = await page.locator('#r-out').innerText();
    ok('the age guard states the arithmetic itself',
       /6\.0 years .*5-year windows.*band of 1\.0 years/s.test(guarded), guarded.slice(0, 240));
    ok('and names the author’s sentence rather than inventing one',
       /RR-AGE-GUARD/.test(guarded));
    ok('it is set as a reading, not as an alert box',
       (await page.locator('#r-out .refusal').count()) >= 1);

    ok('no script errors across the whole run', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: path.join(TMP, 'v3-record.png'), fullPage: true });
    await ctx.close();
  }

  section('Reduced motion');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const anim = await page.evaluate(() => {
      const d = document.createElement('div'); d.className = 'land';
      document.body.appendChild(d);
      return getComputedStyle(d).animationName;
    });
    ok('the landing sequence collapses to instant', anim === 'none', anim);
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('\nFAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})().catch(e => { console.error('suite threw:', e); process.exit(1); });
