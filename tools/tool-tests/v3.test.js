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
const COPY = require('../../sim/copy.js');
const COPY_DECK = require('../../sim/copy.json');
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
    /* Review v4 §5: the door confirms before anything is computed, naming the
       file's own name and the dates it actually covers. */
    ok('the upload door confirms what it found, before computing',
       /^Found [\d,]+ NAVs for .+, \d\d-[A-Z][a-z]{2}-\d{4} to \d\d-[A-Z][a-z]{2}-\d{4}, (no gaps|one gap|[\d,]+ gaps)\.$/
         .test((await page.locator('#fund-state').innerText()).trim()),
       await page.locator('#fund-state').innerText());

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
    /* The names are HTML under the SVG, not <text> inside it: this viewBox is
       stretched with preserveAspectRatio="none", so a glyph drawn inside it
       comes out at a third of its width on a phone. */
    ok('the names sit beneath the line, in the page’s own type',
       (await page.locator('.ll-names .ll-name').count()) >= 3 &&
       (await page.locator('.lifeline text').count()) === 0,
       (await page.locator('.ll-names .ll-name').count()) + ' names, ' +
       (await page.locator('.lifeline text').count()) + ' inside the drawing');
    ok('and they are not squashed by the stretch the line depends on',
       (await page.evaluate(() => {
         const svg = document.querySelector('.lifeline');
         const n = document.querySelector('.ll-name');
         if (!svg || !n) return null;
         const box = svg.getBoundingClientRect();
         const vb = svg.viewBox.baseVal.width;
         /* the drawing is squeezed to about a third; the name must not be */
         return { squeeze: box.width / vb, nameSize: parseFloat(getComputedStyle(n).fontSize) };
       }).then(r => r && r.squeeze < 0.6 && r.nameSize >= 12)) === true);

    /* Review v4 §10: the eighteen are written, so the reading now carries the
       author's own sentences rather than the names of empty slots. */
    const sentences = await page.locator('#reading .sentence').allInnerTexts();
    ok('the author’s sentence is on screen', sentences.length >= 1, sentences.join(' | '));
    ok('and her next step is set with it, not at the foot of the screen',
       (await page.locator('#reading .sentence.next-step').count()) === 1,
       String(await page.locator('#reading .sentence.next-step').count()));
    ok('the cell prints before its extras',
       (await page.evaluate(() => {
         const all = [...document.querySelectorAll('#reading .sentence')];
         const firstExtra = all.findIndex(e => e.classList.contains('extra'));
         const plainBefore = all.slice(0, firstExtra < 0 ? all.length : firstExtra)
           .some(e => !e.classList.contains('extra'));
         return plainBefore;
       })) === true);
    ok('no brace is left unfilled where the engine should have supplied a figure',
       !/[{}]|\[(GAP|MONTHS|YOURS|INDEX|DRIP|AMOUNT)\]/.test(sentences.join(' ')),
       sentences.join(' | ').slice(0, 200));
    ok('and a tool she names in brackets is the thing you tap',
       (await page.locator('#reading .sentence a[href^="#"]').count()) >= 1);
    /* Any slot she has NOT written still names itself, which is what tells a
       reviewer exactly what is left to send. */
    const named = await page.locator('#reading .slot-empty code').allInnerTexts();
    ok('and any slot still waiting names itself rather than printing nothing',
       named.every(n => /^[A-Z0-9-]+$/.test(n)), named.join(', '));

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
       (await page.locator('#r-out .ll-names .ll-name').count()) === 3,
       String(await page.locator('#r-out .ll-names .ll-name').count()));
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

  /* ==================================================== Tool 1 · My return */
  section('Tool 1 · My return — the ledger');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '#mine', { waitUntil: 'networkidle' });

    ok('an empty ledger says so rather than showing a blank table',
       /Nothing written yet/.test(await page.locator('#m-rows').innerText()));
    ok('the four links the review asks for are all here',
       (await page.locator('#m-ledger > .actions .linkish').allInnerTexts()).join(' | ') ===
       'Add a line | Monthly instalments | Paste from a spreadsheet | Try an example | ' +
       'Save entries | Load entries | Clear',
       (await page.locator('#m-ledger > .actions .linkish').allInnerTexts()).join(' | '));

    /* The generator writes ONE line, not sixty. */
    await page.click('#m-sip');
    ok('asking for instalments relabels the date rather than opening a second box',
       (await page.locator('#m-e-date-label').innerText()) === 'First instalment');
    ok('and instalments have no in-or-out question, because they are always in',
       (await page.locator('#m-e-dir-field').isVisible()) === false);
    await page.fill('#m-e-date', '2021-04-05');
    await page.fill('#m-e-amount', '5000');
    await page.fill('#m-e-n', '60');
    await page.click('#m-e-save');
    await page.waitForTimeout(150);

    ok('sixty instalments are one line in the ledger',
       (await page.locator('#m-rows tr').count()) === 1,
       String(await page.locator('#m-rows tr').count()));
    const sipLine = await page.locator('#m-rows tr').innerText();
    ok('and that line reads as a sentence, with both ends and the count',
       /₹5,000 monthly/.test(sipLine) && /Apr 2021/.test(sipLine) &&
       /Mar 2026/.test(sipLine) && /60 instalments/.test(sipLine), sipLine);
    ok('while the engine sees all sixty payments',
       /60 payments/.test(await page.locator('#m-total').innerText()),
       await page.locator('#m-total').innerText());

    /* Tap to edit: the whole line is the control. */
    await page.click('#m-rows tr');
    ok('tapping a line opens it for editing, prefilled',
       (await page.locator('#m-edit').isVisible()) === true &&
       (await page.inputValue('#m-e-amount')) === '5000' &&
       (await page.inputValue('#m-e-n')) === '60');
    ok('and an existing line can be removed from where it is edited',
       (await page.locator('#m-e-drop').isVisible()) === true);
    await page.click('#m-e-cancel');

    /* Two columns, a minus for money out. */
    await page.click('#m-paste-open');
    await page.fill('#m-paste-text', '2023-08-14\t-50000\n2024-01-09\t25000\nnot a line at all');
    await page.click('#m-paste-read');
    await page.waitForTimeout(150);
    ok('a pasted minus becomes money out, and a line that is not one is skipped',
       (await page.locator('#m-rows tr').count()) === 3 &&
       /Money out/.test(await page.locator('#m-rows').innerText()),
       await page.locator('#m-rows').innerText());
    ok('and the paste says how many lines it read',
       /2 lines read, 1 skipped/.test(await page.locator('#m-paste-note').innerText()),
       await page.locator('#m-paste-note').innerText());

    /* Worth today is one fixed field, not a row type. */
    ok('worth today is a field at the foot of the ledger, not a line in it',
       (await page.locator('#m-worth').count()) === 1 &&
       (await page.locator('#m-rows tr:has-text("Worth")').count()) === 0);

    section('Tool 1 · the reading');
    /* A ledger whose answer is known without running the tool: one payment,
       one value, ten years, exactly double. */
    await page.click('#m-clear');
    await page.click('#m-add');
    await page.fill('#m-e-date', '2015-01-01');
    await page.fill('#m-e-amount', '100000');
    await page.click('#m-e-save');
    await page.fill('#m-worth', '200000');
    await page.fill('#m-worth-on', '2025-01-01');
    await page.click('#m-run');
    await page.waitForTimeout(300);

    const days = Math.round((Date.UTC(2025, 0, 1) - Date.UTC(2015, 0, 1)) / 86400000);
    const expect = Math.pow(2, 365 / days) - 1;
    const hero = await page.locator('#m-out .figure').innerText();
    ok('the figure is the rate the arithmetic gives, worked out here separately',
       Math.abs(parseFloat(hero) - expect * 100) < 0.05,
       hero + ' against ' + (expect * 100).toFixed(2) + '%');
    ok('it wears the marker, and it is the only large figure on the screen',
       (await page.locator('#m-out .figure.mine').count()) === 1 &&
       (await page.locator('#m-out .figure').count()) === 1);
    /* Review v4 §11: dates are dd-MMM-yyyy everywhere, with "to" between them. */
    ok('the span line carries the dates, the years and the count',
       /01-Jan-2015 to 01-Jan-2025 · 10\.0 years · 1 payment/
         .test(await page.locator('#m-out .gloss').first().innerText()),
       await page.locator('#m-out .gloss').first().innerText());

    const out = await page.locator('#m-out').innerText();
    ok('absolute return stands beside the yearly rate, each saying what it answers',
       /Absolute return/.test(out) && /no clock in it/.test(out) &&
       /XIRR/.test(out) && /counts every date/.test(out));
    ok('and the total doubling is printed as 100%', /100\.0%/.test(out), out.slice(0, 400));
    ok('one crossover line, and it counts the reader’s own years',
       (await page.locator('#m-crossover').count()) === 1 &&
       /10\.0 years inside it/.test(await page.locator('#m-crossover').innerText()),
       await page.locator('#m-crossover').innerText());

    ok('inflation ships blank — the tool never picks a rate for the reader',
       (await page.inputValue('#m-infl')) === '' &&
       (await page.locator('#m-real').innerText()).trim() === '');
    await page.fill('#m-infl', '6');
    await page.waitForTimeout(150);
    const real = await page.locator('#m-real').innerText();
    const expectReal = ((1 + expect) / 1.06 - 1) * 100;
    ok('and once typed it divides rather than subtracts',
       Math.abs(parseFloat(real.match(/(−?\d+\.\d)%/)[1].replace('−', '-')) - expectReal) < 0.05,
       real + ' against ' + expectReal.toFixed(2));

    section('Tool 1 · what it will not do');
    await page.click('#m-back');
    await page.fill('#m-worth', '');
    await page.click('#m-run');
    await page.waitForTimeout(200);
    ok('with nothing entered for what it is worth it says so, and names the sentence',
       /no figure for what it is worth/.test(await page.locator('#m-out').innerText()) &&
       /XIRR-NEED-VALUE/.test(await page.locator('#m-out').innerText()),
       await page.locator('#m-out').innerText());

    /* Under a year, and two funds — both readings the review asks this screen
       to carry, both printed as arithmetic beside the author's named slot. */
    await page.click('#m-back');
    await page.click('#m-clear');
    await page.click('#m-add');
    await page.fill('#m-e-date', '2025-06-01');
    await page.fill('#m-e-amount', '100000');
    await page.fill('#m-e-fund', 'One Fund');
    await page.click('#m-e-save');
    await page.click('#m-add');
    await page.fill('#m-e-date', '2025-07-01');
    await page.fill('#m-e-amount', '50000');
    await page.fill('#m-e-fund', 'Another Fund');
    await page.click('#m-e-save');
    ok('a named fund brings out the fund column, and only then',
       (await page.locator('#m-head-fund').isVisible()) === true);
    await page.fill('#m-worth', '160000');
    await page.fill('#m-worth-on', '2025-10-01');
    await page.click('#m-run');
    await page.waitForTimeout(300);
    const short = await page.locator('#m-out').innerText();
    /* POS-UNDER-A-YEAR is written now, so the screen carries her sentence with
       the engine's month count in it rather than the slot's name. */
    ok('under a year the screen carries the author’s sentence, with the months filled',
       /This money is 4 months old/.test(short) &&
       /yearly rate on 4 months/.test(short) && !/POS-UNDER-A-YEAR/.test(short),
       short.slice(0, 400));
    ok('and drops the words "a year" from beside the figure',
       (await page.locator('#m-out .unit').count()) === 0);
    ok('two funds in one ledger is a reading of its own',
       /2 funds are named in this ledger/.test(short) && /XIRR-MANY-FUNDS/.test(short));

    section('Tool 1 · saved on this device and nowhere else');
    await page.click('#m-back');
    await page.click('#m-save');
    await page.waitForTimeout(100);
    ok('saving says where it went', /Saved on this device/.test(await page.locator('#m-store-note').innerText()));
    await page.click('#m-clear');
    ok('clearing empties the ledger', (await page.locator('#m-rows tr').count()) === 1 &&
       /Nothing written yet/.test(await page.locator('#m-rows').innerText()));
    await page.click('#m-load');
    await page.waitForTimeout(150);
    ok('and loading brings back exactly what was written',
       (await page.locator('#m-rows tr').count()) === 2 &&
       (await page.inputValue('#m-worth')) === '160000');

    ok('no script errors across Tool 1', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: path.join(TMP, 'v3-mine.png'), fullPage: true });
    await ctx.close();
  }

  /* ================================================ Tool 4 · My plan, tested */
  section('Tool 4 · My plan, tested');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '#plan', { waitUntil: 'networkidle' });

    ok('with no fund loaded the Suppose field is the way in',
       (await page.locator('#p-suppose').isVisible()) === true);
    await page.fill('#p-have', '100000');
    await page.fill('#p-monthly', '10000');
    await page.fill('#p-years', '10');
    await page.fill('#p-needed', '5000000');
    await page.fill('#p-rate', '12');
    await page.waitForTimeout(200);
    ok('a supposed rate is tested, and the screen says the reader typed it',
       /that is what you typed/.test(await page.locator('#p-out').innerText()) &&
       /PLAN-NO-FUND/.test(await page.locator('#p-out').innerText()),
       (await page.locator('#p-out').innerText()).slice(0, 300));

    /* Now a real record underneath it. The fund loaded in any tool is the fund
       here: one search, one data layer, four screens. */
    await page.evaluate(() => { location.hash = 'record'; });
    await page.waitForTimeout(200);
    await page.setInputFiles('#r-file', navFile);
    await page.waitForTimeout(700);
    await page.evaluate(() => { location.hash = 'plan'; });
    await page.waitForTimeout(300);
    ok('the fund loaded in another tool is the fund here',
       /v3-nav/.test(await page.locator('#p-fund-state').innerText()),
       await page.locator('#p-fund-state').innerText());
    ok('and the Suppose field steps aside once there is a record to test against',
       (await page.locator('#p-suppose').isVisible()) === false);

    const landings = await page.locator('#p-landings .figure, #p-landings .val').allInnerTexts();
    ok('the plan lands three times, not once', landings.length === 3, landings.join(' | '));

    const rateRows = await page.locator('#p-out .ledger tr').allInnerTexts();
    ok('and the three rates are shown with the windows they came from',
       rateRows.length === 3 && /Worst window, from/.test(rateRows[0]) &&
       /Typical of all of them/.test(rateRows[1]) && /Best window, from/.test(rateRows[2]),
       rateRows.join(' | '));

    const rupees = t => parseFloat(t.replace(/[^0-9.]/g, ''));
    ok('the worst is the hero, and it is the smallest of the three landings',
       rupees(landings[0]) < rupees(landings[1]) && rupees(landings[1]) < rupees(landings[2]),
       landings.join(' | '));
    ok('the hero wears the marker, and nothing else on the screen is that size',
       (await page.locator('#p-landings .figure.mine').count()) === 1 &&
       (await page.locator('#p-out .figure').count()) === 1);

    /* The landing is checked here against the compounding written out again. */
    const worstPct = parseFloat(rateRows[0].replace('−', '-').match(/(-?\d+\.\d)%/)[1]) / 100;
    const i = Math.pow(1 + worstPct, 1 / 12) - 1;
    let sip = 0; for (let m = 0; m < 120; m++) sip = (sip + 10000) * (1 + i);
    const expectLand = 100000 * Math.pow(1 + worstPct, 10) + sip;
    ok('the worst landing is that rate compounded, worked out here separately',
       Math.abs(rupees(landings[0]) - expectLand) / expectLand < 0.005,
       landings[0] + ' against ' + Math.round(expectLand));

    ok('every landing carries its gap',
       (await page.locator('#p-landings').innerText().then(t => (t.match(/short of|over by/g) || []).length)) === 3,
       await page.locator('#p-landings').innerText());

    /* Two levers. Never a third. */
    ok('there are exactly two levers',
       (await page.locator('#p-levers .line').count()) === 2,
       String(await page.locator('#p-levers .line').count()));
    const levers = await page.locator('#p-levers').innerText();
    ok('and they are the two the review names, both the reader’s own',
       /The monthly amount that arrives, at the typical rate/.test(levers) &&
       /The years the worst rate would add/.test(levers), levers);

    section('Tool 4 · a history that cannot reach');
    const shortFile2 = path.join(TMP, 'v3-short.csv');
    if (!fs.existsSync(shortFile2)) {
      const lines = ['Date,NAV']; let t = Date.UTC(2019, 0, 1), v = 10;
      while (t <= Date.UTC(2025, 0, 1)) {
        const d = new Date(t);
        lines.push(`${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()},${v.toFixed(4)}`);
        v *= Math.pow(1.11, 1 / 365.2425); t += 86400000;
      }
      fs.writeFileSync(shortFile2, lines.join('\n'));
    }
    await page.setInputFiles('#p-file', shortFile2);
    await page.fill('#p-years', '15');
    await page.waitForTimeout(500);
    const stretched = await page.locator('#p-out').innerText();
    ok('a plan longer than the history is tested at the longest the history can give',
       /6\.0 years of published prices/.test(stretched) &&
       /tested against its 6-year windows — the longest it can give/.test(stretched),
       stretched.slice(0, 400));
    ok('and it names the author’s sentence rather than inventing one',
       /PLAN-TOO-SHORT/.test(stretched));
    ok('the plan still lands three times on the shorter window',
       (await page.locator('#p-landings .figure, #p-landings .val').count()) === 3);
    ok('and there are still two levers, never a third',
       (await page.locator('#p-levers .line').count()) === 2);
    ok('a history with no spread left in it says so rather than printing one figure three times',
       /the worst, the typical and the best of them all come to/.test(stretched) &&
       /RR-FEW-WINDOWS/.test(stretched), stretched.slice(-500));
    ok('and it counts its windows in the singular when there is one',
       / 1 window of /.test(stretched), stretched.match(/[^.]*window[^.]*\./g).join(' | '));

    /* The hero is money, not a percentage, and has to fit a phone. */
    const heroBox = await page.locator('#p-landings .figure').boundingBox();
    ok('the landing figure fits the screen it is read on',
       heroBox.width < 350, JSON.stringify(heroBox));
    const leverVals = await page.locator('#p-levers .val').allInnerTexts();
    ok('and each lever answers in one short figure, not a sentence',
       leverVals.every(v => v.trim().length <= 14), leverVals.join(' | '));

    /* .line was scoped to .reading, so a line drawn anywhere else lost its
       layout and dropped its figure onto the row below its own label. */
    const laid = await page.evaluate(() => {
      const l = document.querySelector('#p-levers .line');
      return { display: getComputedStyle(l).display,
               sameRow: Math.abs(l.querySelector('.what').getBoundingClientRect().top -
                                 l.querySelector('.val').getBoundingClientRect().top) < 30 };
    });
    ok('a ruled line keeps its layout outside the reading box too',
       laid.display === 'flex' && laid.sameRow, JSON.stringify(laid));

    ok('no script errors across Tool 4', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: path.join(TMP, 'v3-plan.png'), fullPage: true });
    await ctx.close();
  }

  /* ============================================ step 6 · copy, cut to budgets
   *
   * The author's deck is linted where it lives, in sim/tests/copy.test.js.
   * This lints the OTHER half: the labels, glosses and readings the screens
   * themselves carry. Those are words a reader reads, so they answer to the
   * same rules and the same budgets, and nobody had been counting them.
   *
   * Rules 1 and 3 -- no sentence tells the reader to act, and the excluded
   * words never appear -- apply to every word on screen, readings included.
   * Rule 2, timeless, applies to the STATIC markup only: a reading prints the
   * reader's own dates and percentages by design, and those come from their
   * data rather than from a sheet that has to survive a printed QR code.
   */
  section('Step 6 · the screens’ own words, against the rules and the budgets');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });

    /* An unwritten slot names itself on screen, which is scaffolding and not
       copy, so it is taken out before anything is counted. */
    const read = async sel => (await page.locator(sel).innerText())
      .replace(/Awaiting copy slot [A-Z0-9-]+/g, '')
      .replace(/Awaiting chapter pointer [A-Z0-9-]+/g, '');
    const words = t => t.trim().split(/\s+/).filter(Boolean).length;

    const screens = {};
    screens.home = await read('#main > [data-view="home"]');

    await page.evaluate(() => { location.hash = 'mine'; });
    await page.waitForTimeout(200);
    screens.mineLedger = await read('#m-ledger');
    await page.click('#m-example');
    await page.waitForTimeout(200);
    await page.click('#m-run');
    await page.waitForTimeout(400);
    await page.fill('#m-infl', '6');
    await page.waitForTimeout(200);
    screens.mineResult = await read('#m-out');

    await page.evaluate(() => { location.hash = 'record'; });
    await page.waitForTimeout(200);
    await page.setInputFiles('#r-file', navFile);
    await page.waitForTimeout(700);
    await page.click('#r-years .chip[data-y="5"]');
    await page.waitForTimeout(700);
    screens.recordResult = await read('#r-out');

    await page.evaluate(() => { location.hash = 'stand'; });
    await page.waitForTimeout(200);
    await page.setInputFiles('#file', navFile);
    await page.waitForTimeout(800);
    await page.click('#example');
    await page.waitForTimeout(300);
    await page.click('#run');
    await page.waitForTimeout(800);
    screens.standResult = await read('#reading');

    await page.evaluate(() => { location.hash = 'plan'; });
    await page.waitForTimeout(300);
    await page.fill('#p-have', '100000');
    await page.fill('#p-monthly', '10000');
    await page.fill('#p-years', '10');
    await page.fill('#p-needed', '5000000');
    await page.waitForTimeout(400);
    screens.planResult = await read('#p-out');

    await page.evaluate(() => { location.hash = 'about'; });
    await page.waitForTimeout(200);
    screens.about = await read('#main > [data-view="about"]');

    /* The two budgets review §4 states for Tool 1, in words. */
    ok('Tool 1’s ledger keeps inside its forty words of labels',
       words(screens.mineLedger) <= 40, words(screens.mineLedger) + ' words');
    ok('and its reading inside its hundred and thirty',
       words(screens.mineResult) <= 130, words(screens.mineResult) + ' words');

    /* Home is fifty words for the WHOLE screen, and the author's line has not
       landed yet. Her slot is budgeted at 120 characters, so twenty of the
       fifty are hers and thirty are the screen's own. */
    const promiseBudget = COPY_DECK.slots['LANDING-PROMISE'].budget;
    const hers = Math.ceil(promiseBudget / 6);
    ok('home leaves room for the author’s line inside her fifty words',
       words(screens.home) + hers <= 50,
       words(screens.home) + ' of the screen’s own + ' + hers + ' reserved for LANDING-PROMISE');

    /* Rule 1 and rule 3, over every word a reader sees. */
    const slots = {};
    Object.entries(screens).forEach(([k, v]) => { slots[k] = { text: v, budget: 1e6 }; });
    const spoken = COPY.check({ slots }).filter(f => f.rule !== 'timeless');
    ok('no screen tells the reader to buy, sell, switch, hold or redeem anything',
       spoken.filter(f => f.rule === 'transaction-verb').length === 0, JSON.stringify(spoken));
    ok('and the excluded words appear nowhere',
       spoken.filter(f => f.rule === 'vocabulary').length === 0, JSON.stringify(spoken));

    /* Rule 2, over the markup that ships. A year, a month name, a percentage
       or a word meaning "now" written into the page itself would go stale in
       a book that cannot be reissued. */
    const markup = fs.readFileSync(path.join(__dirname, '../../tool/v3/index.html'), 'utf8')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ');
    const stale = COPY.check({ slots: { 'index.html': { text: markup, budget: 1e6 } } })
      .filter(f => f.rule === 'timeless');
    ok('nothing written into the page itself references a moment', stale.length === 0,
       JSON.stringify(stale));

    /* Half of rule 2 applies to the readings as well. A rendered date or
       percentage comes from the reader's own data and is theirs to see; a word
       meaning "now" is never data, and it survived in four places the markup
       lint could not reach because the screens generate them. */
    const nowWords = COPY.check({ slots }).filter(f =>
      f.rule === 'timeless' && /means "now"/.test(f.detail));
    ok('and no screen prints a word meaning "now", wherever it is generated',
       nowWords.length === 0, JSON.stringify(nowWords));

    /* Counted and printed for the screens the review has not budgeted yet, so
       the author sets those numbers against something measured. */
    console.log('        measured: ' + Object.entries(screens)
      .map(([k, v]) => k + ' ' + words(v)).join(' · '));

    ok('no script errors across the copy pass', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ==================================================== step 6 · About */
  section('Step 6 · About, and the footer that reaches it');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });

    /* The footer rides on every screen, so About is one tap from anywhere. */
    for (const v of ['home', 'mine', 'record', 'stand', 'plan']) {
      await page.evaluate(h => { location.hash = h; }, v);
      await page.waitForTimeout(150);
      const link = page.locator('.foot a[href="#about"]');
      if (!(await link.isVisible())) { ok('About is reachable from ' + v, false); break; }
    }
    ok('About is one tap from every screen',
       (await page.locator('.foot a[href="#about"]').isVisible()) === true);

    await page.click('.foot a[href="#about"]');
    await page.waitForTimeout(250);
    ok('and on About itself the link to About steps out, separator and all',
       (await page.locator('#foot-about').isVisible()) === false);
    const about = await page.locator('#main > [data-view="about"]').innerText();

    /* ABOUT-MAIN is the one slot the author has written and signed off, and
       until now it was rendered nowhere in the app. */
    ok('the About paragraph the author kept is on screen, in full',
       about.includes(COPY_DECK.slots['ABOUT-MAIN'].text),
       about.slice(0, 200));
    ok('and it is set as a reading, in the serif, not as small print',
       (await page.locator('#about-main .reading .sentence').count()) === 1);

    ok('the four tools are named from the deck and each is a way in',
       (await page.locator('#about-tools a').allInnerTexts()).join(' | ') ===
       Object.values(COPY_DECK.tools).join(' | '),
       (await page.locator('#about-tools a').allInnerTexts()).join(' | '));

    ok('the five chapter pointers each name themselves until the author writes them',
       (await page.locator('#about-refs li.slot-empty').count()) === 5,
       String(await page.locator('#about-refs li').count()));

    /* A privacy note is only worth anything if it describes what the code in
       front of the reader actually does. Review v4 §3 settles it: the tool
       fetches nothing, so the answer is a file the reader downloaded. */
    ok('what this build reads is stated, and matches what it actually does',
       /a file you download and choose yourself/.test(about), about.slice(-400));
    ok('and it states that nothing is sent and nothing is fetched',
       /What is sent anywhere[\s\S]{0,40}nothing/.test(about) &&
       /What is fetched[\s\S]{0,40}nothing/.test(about), about.slice(-400));
    ok('and the page says what the figures leave out', /tax and exit load/.test(about));

    ok('About has one h1 and it is the screen’s own',
       (await page.locator('#main > [data-view="about"] h1').count()) === 1);

    ok('no script errors across About', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: path.join(TMP, 'v3-about.png'), fullPage: true });
    await ctx.close();
  }

  /* ================================================ step 6 · the design pass */
  section('Step 6 · the design pass, measured');
  {
    for (const width of [320, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle' });

      for (const v of ['home', 'about', 'mine', 'record', 'stand', 'plan']) {
        await page.evaluate(h => { location.hash = h; }, v);
        await page.waitForTimeout(200);
        if (v === 'mine') { await page.click('#m-example'); await page.waitForTimeout(200); }
        if (v === 'record') {
          await page.setInputFiles('#r-file', navFile); await page.waitForTimeout(700);
          await page.click('#r-years .chip[data-y="5"]'); await page.waitForTimeout(600);
        }
        if (v === 'stand') {
          await page.setInputFiles('#file', navFile); await page.waitForTimeout(700);
          await page.click('#example'); await page.waitForTimeout(200);
          await page.click('#run'); await page.waitForTimeout(600);
        }
        if (v === 'plan') {
          await page.fill('#p-have', '100000'); await page.fill('#p-monthly', '10000');
          await page.fill('#p-years', '10'); await page.fill('#p-needed', '5000000');
          await page.waitForTimeout(400);
        }
        const m = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            over: doc.scrollWidth - doc.clientWidth,
            h1: document.querySelectorAll('#main > [data-view]:not([hidden]) h1').length,
            small: [...document.querySelectorAll('button,a,select,summary,input')]
              .filter(e => { const b = e.getBoundingClientRect();
                             return b.width > 0 && b.height > 0 && b.height < 40; })
              .map(e => e.id || e.className || e.tagName)
          };
        });
        /* A page that scrolls sideways on a phone has lost the reader's place.
           A table that cannot fit scrolls inside its own box instead. */
        ok(v + ' does not scroll sideways at ' + width, m.over <= 0, 'over by ' + m.over);
        ok(v + ' has exactly one h1 at ' + width, m.h1 === 1, String(m.h1));
        ok(v + '’s controls are all a finger wide at ' + width, m.small.length === 0,
           m.small.join(', '));
      }
      await ctx.close();
    }
  }

  /* =============================================== review v4 §5 · the door
   *
   * Upload is the only door, so it holds a conversation. sim/tests/upload.test.js
   * proves the verdicts; this drives them through a real screen, because a
   * question nobody can answer with a thumb is not a question.
   */
  section('Step 5 · the upload door, in a browser');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '#record', { waitUntil: 'networkidle' });

    const iso = t => new Date(t).toISOString().slice(0, 10);

    /* --- a file holding many schemes ------------------------------------ */
    const manyFile = path.join(TMP, 'v5-many.csv');
    {
      const lines = ['Scheme Name,Date,NAV'];
      const names = ['Acme Bluechip Fund - Direct Plan - Growth',
                     'Acme Bluechip Fund - Direct Plan - IDCW',
                     'Acme Bluechip Fund - Regular Plan - Growth',
                     'Zenith Midcap Fund - Direct Plan - Growth'];
      names.forEach((n, k) => {
        for (let i = 0; i < 400; i++) {
          lines.push(`"${n}",${iso(Date.UTC(2019, 0, 1) + i * 86400000)},${(10 + k + i * 0.01).toFixed(4)}`);
        }
      });
      fs.writeFileSync(manyFile, lines.join('\n'));
    }
    await page.setInputFiles('#r-file', manyFile);
    await page.waitForTimeout(900);

    ok('a file with many schemes asks which one, and counts them',
       /This file has 4 schemes\. Pick the one you own\./
         .test(await page.locator('#r-fund .door-ask').innerText()),
       (await page.locator('#r-fund .door-ask').innerText()).slice(0, 140));
    ok('they are grouped by family, not listed flat',
       (await page.locator('#r-fund .scheme-list .label').count()) === 2,
       String(await page.locator('#r-fund .scheme-list .label').count()));
    ok('and each row is named by what differs — its plan and option',
       (await page.locator('#r-fund .scheme').first().innerText()).startsWith('Direct · Growth'),
       await page.locator('#r-fund .scheme').first().innerText());
    ok('every choice is a finger tall',
       (await page.evaluate(() => [...document.querySelectorAll('#r-fund .scheme')]
          .every(b => b.getBoundingClientRect().height >= 44))) === true);

    /* the search box §5 asks for */
    await page.fill('#r-file-find', 'zenith');
    await page.waitForTimeout(200);
    ok('the list can be searched down to one',
       (await page.locator('#r-fund .scheme:visible').count()) === 1,
       String(await page.locator('#r-fund .scheme:visible').count()));

    await page.locator('#r-fund .scheme:visible').first().click();
    await page.waitForTimeout(900);
    ok('picking one loads only that scheme, and confirms before computing',
       /^Found 400 NAVs for Zenith Midcap Fund - Direct Plan - Growth, 01-Jan-2019 to 04-Feb-2020, no gaps\.$/
         .test((await page.locator('#r-state').innerText()).trim()),
       await page.locator('#r-state').innerText());
    ok('and the question is not asked again',
       (await page.locator('#r-fund .door-ask').isVisible()) === false);

    /* --- dates that read two ways --------------------------------------- */
    const ambFile = path.join(TMP, 'v5-ambiguous.csv');
    {
      const lines = ['Date,NAV'];
      /* every row valid read either way: day and month both under 13 */
      for (let m = 1; m <= 12; m++) {
        for (let day = 1; day <= 12; day++) {
          lines.push(`${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/2020,` +
                     (10 + m * 0.1 + day * 0.01).toFixed(4));
        }
      }
      fs.writeFileSync(ambFile, lines.join('\n'));
    }
    await page.setInputFiles('#r-file', ambFile);
    await page.waitForTimeout(900);
    const askText = await page.locator('#r-fund .door-ask').innerText();
    ok('dates that read two ways are asked about, not guessed',
       /^These dates read two ways\./.test(askText), askText.slice(0, 160));
    ok('and the first row is shown BOTH ways, so the reader can tell them apart',
       /01-Jan-2020 one way, 01-Jan-2020 the other|one way, .* the other/.test(askText), askText);
    ok('with two answers to tap',
       (await page.locator('#r-fund .door-ask [data-answer]').count()) === 2);

    await page.locator('#r-fund [data-answer="month"]').click();
    await page.waitForTimeout(900);
    ok('answering settles it and the file loads',
       /^Found \d+ NAVs for /.test((await page.locator('#r-state').innerText()).trim()),
       await page.locator('#r-state').innerText());
    ok('and it is not asked twice',
       (await page.locator('#r-fund .door-ask [data-answer]').count()) === 0);

    /* --- many pieces, stitched, with a gap ------------------------------ */
    const p1 = path.join(TMP, 'v5-p1.csv'), p2 = path.join(TMP, 'v5-p2.csv');
    const piece = (from, days, nav) => {
      const out = ['Date,NAV'];
      for (let i = 0; i < days; i++) out.push(`${iso(from + i * 86400000)},${(nav + i * 0.01).toFixed(4)}`);
      return out.join('\n');
    };
    fs.writeFileSync(p1, piece(Date.UTC(2018, 0, 1), 90, 10));
    fs.writeFileSync(p2, piece(Date.UTC(2018, 8, 1), 90, 14));
    await page.setInputFiles('#r-file', [p1, p2]);
    await page.waitForTimeout(1000);
    const stitched = await page.locator('#r-state').innerText();
    ok('two pieces are stitched into one history',
       /^Found 180 NAVs for /.test(stitched.trim()), stitched);
    ok('and the confirmation says a gap is in it, rather than "no gaps"',
       /one gap\.$/.test(stitched.trim()), stitched);
    ok('the gap itself is named, with what to do about it',
       /There is a gap of \d+ days/.test(await page.locator('#r-fund .door-ask').innerText()) &&
       /one may be missing/.test(await page.locator('#r-fund .door-ask').innerText()),
       await page.locator('#r-fund .door-ask').innerText());

    /* --- the IDCW row --------------------------------------------------- */
    await page.setInputFiles('#r-file', manyFile);
    await page.waitForTimeout(900);
    await page.locator('#r-fund .scheme', { hasText: 'IDCW' }).first().click();
    await page.waitForTimeout(900);
    const idcw = await page.locator('#r-fund .door-ask').innerText();
    ok('an IDCW row is refused, with the reason and the row to pick instead',
       /Its NAV falls at every payout/.test(idcw) &&
       /Pick the Growth row of the same plan\./.test(idcw), idcw);
    ok('and it is set as a reading, not as an alert box',
       (await page.locator('#r-fund .door-ask .refusal').count()) >= 1);

    /* --- a file with no dates in it ------------------------------------- */
    const junk = path.join(TMP, 'v5-junk.csv');
    fs.writeFileSync(junk, 'Fund,Rating\nAcme,Five stars\nZenith,Four stars\n');
    await page.setInputFiles('#r-file', junk);
    await page.waitForTimeout(700);
    ok('a file with no dates says what the file should hold instead',
       /One column should be dates and one NAV/.test(await page.locator('#r-fund .door-ask').innerText()) &&
       /A screenshot or PDF will not work/.test(await page.locator('#r-fund .door-ask').innerText()),
       await page.locator('#r-fund .door-ask').innerText());

    ok('no script errors across the whole door', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: path.join(TMP, 'v5-door.png'), fullPage: true });
    await ctx.close();
  }

  /* ================================= review v4 §6 · the two rare touches */
  section('Step 6 · Add to home screen');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    ok('the page declares a manifest', manifestHref === 'manifest.webmanifest', String(manifestHref));

    const m = await page.evaluate(async () =>
      fetch('manifest.webmanifest').then(r => r.json()));
    ok('it names the product', m.name === 'Where You Stand', m.name);
    ok('it opens standalone, as an app rather than a tab', m.display === 'standalone', m.display);
    ok('and on the book’s own paper', m.background_color === '#F1EFEA' && m.theme_color === '#F1EFEA',
       m.background_color + ' / ' + m.theme_color);
    ok('with an icon at both sizes a phone asks for, and a maskable one',
       m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512') &&
       m.icons.some(i => i.purpose === 'maskable'),
       JSON.stringify(m.icons.map(i => i.sizes + '/' + i.purpose)));

    for (const icon of m.icons) {
      const res = await page.evaluate(async (src) => {
        const r = await fetch(src);
        return { ok: r.ok, type: r.headers.get('content-type') };
      }, icon.src);
      ok('the icon ' + icon.src + ' is really there', res.ok === true, JSON.stringify(res));
    }

    /* The shell itself. A service worker needs a secure context, which
       127.0.0.1 is, so it registers here exactly as it would on the site. */
    const registered = await page.evaluate(() =>
      navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false));
    ok('the offline shell registers', registered === true, String(registered));

    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      if (!keys.length) return null;
      const c = await caches.open(keys[0]);
      const reqs = await c.keys();
      return { cache: keys[0], count: reqs.length, urls: reqs.map(r => r.url) };
    });
    ok('and it precaches the whole shell', cached && cached.count >= 15,
       cached ? cached.cache + ': ' + cached.count + ' files' : 'no cache');
    ok('including the copy deck, the engines and the stylesheet',
       cached && ['deck.js', 'theme.css', 'engines.js', 'upload.js', 'stand.js']
         .every(f => cached.urls.some(u => u.endsWith(f))),
       cached ? cached.urls.filter(u => /\.(js|css)$/.test(u)).length + ' scripts and sheets' : '');
    ok('and nothing from another origin',
       cached && cached.urls.every(u => u.startsWith('http://127.0.0.1:8781/')),
       cached ? cached.urls.filter(u => !u.startsWith('http://127.0.0.1:8781/')).join(', ') : '');

    /* The point of it: it opens with no network at all. */
    await ctx.setOffline(true);
    const offline = await ctx.newPage();
    let opened = true;
    try { await offline.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 }); }
    catch (e) { opened = false; }
    if (opened) {
      await offline.waitForTimeout(600);
      ok('the tool opens with the network off',
         (await offline.locator('.entry b').count()) === 4,
         String(await offline.locator('.entry b').count()));
      ok('and its four tools are all there, by name',
         (await offline.locator('.entry b').allInnerTexts()).join(' | ') ===
         'My return | This fund’s record | My money in this fund | My plan, tested',
         (await offline.locator('.entry b').allInnerTexts()).join(' | '));
      ok('the reading engine came with it',
         (await offline.evaluate(() => typeof SimEngines.xirr === 'function')) === true);
    } else {
      ok('the tool opens with the network off', false, 'navigation failed offline');
    }
    await ctx.setOffline(false);
    await ctx.close();
  }

  section('Step 6 · Save this reading');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '#stand', { waitUntil: 'networkidle' });
    await page.setInputFiles('#file', navFile);
    await page.waitForTimeout(900);
    await page.click('#example');
    await page.waitForTimeout(300);
    await page.click('#run');
    await page.waitForTimeout(900);

    ok('the reading offers to be saved', (await page.locator('#save-reading').count()) === 1);

    /* Drawn, not screenshotted, so exactly what was handed over is on it. */
    const shot = await page.evaluate(() => {
      const c = window.WYSReading.draw({
        fund: 'A Fund', span: '01-Jan-2020 to 01-Jan-2025 · 60 entries',
        dateT: Date.UTC(2025, 0, 1),
        hero: { label: 'Your speed', value: '19.6%', unit: 'a year' },
        lines: [{ what: 'The fund over your dates', value: '19.0%' },
                { what: 'Your stretch, placed', value: 'Higher than 85 of 100' },
                { what: 'Index fund, same money', value: '—' }],
        sentence: 'A strong stretch for the fund, and your dates beat it as well.'
      });
      const g = c.getContext('2d');
      const px = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2]; };
      return { w: c.width, h: c.height, corner: px(4, 4), name: window.WYSReading.fileName({
        fund: 'A Fund', dateT: Date.UTC(2025, 0, 1) }) };
    });
    ok('it is drawn at a size worth keeping', shot.w === 1080 && shot.h > 600,
       shot.w + '×' + shot.h);
    /* §6: the saved reading always renders in the DAY palette, so it looks
       like a page from the book wherever it goes. This page is on the night
       sheet; the image must not be. */
    ok('and always on the book’s day paper, even from the night sheet',
       shot.corner === '241,239,234', shot.corner);
    ok('the file names the fund and the date it was measured to',
       /^where-you-stand-a-fund-01-Jan-2025\.png$/.test(shot.name), shot.name);

    /* Section 11's "never a number wider than its container" applies to the
       words around it too. The footer ran off the right edge as one line. */
    const fits = await page.evaluate(() => {
      const c = window.WYSReading.draw({
        fund: 'A Fund With Quite A Long Name - Direct Plan - Growth',
        span: '01-Jan-2020 to 01-Jan-2025 · 60 entries', dateT: Date.UTC(2025, 0, 1),
        hero: { label: 'Your speed', value: '19.6%', unit: 'a year' },
        lines: [{ what: 'The fund over your dates', value: '19.0%' }],
        sentence: 'A strong stretch for the fund, and your dates beat it as well.'
      });
      const g = c.getContext('2d');
      /* nothing may be painted in the right margin */
      const strip = g.getImageData(c.width - 60, 0, 60, c.height).data;
      let painted = 0;
      for (let i = 0; i < strip.length; i += 4) {
        if (strip[i] !== 241 || strip[i + 1] !== 239 || strip[i + 2] !== 234) painted++;
      }
      return { painted: painted, height: c.height };
    });
    ok('nothing is drawn into the right margin, however long the fund’s name',
       fits.painted === 0, fits.painted + ' pixels past the margin');

    /* "No fund advice on it, ever." The next step is a thing to do inside the
       tool, so it is not handed to the image at all. */
    const handed = await page.evaluate(() => {
      const calls = [];
      const real = window.WYSReading.save;
      window.WYSReading.save = function (r) { calls.push(r); return Promise.resolve('saved'); };
      document.querySelector('#save-reading').click();
      window.WYSReading.save = real;
      return calls[0];
    });
    ok('the image is handed the four figures and nothing else',
       handed && handed.hero && handed.lines.length === 3 &&
       !('nextStep' in handed) && !('next' in handed),
       JSON.stringify(Object.keys(handed || {})));
    ok('it carries the fund, the span and the date it was measured to',
       !!handed.fund && !!handed.span && !!handed.dateT);
    ok('and no next step, which is a thing to do inside the tool',
       JSON.stringify(handed).indexOf('Next') < 0 &&
       !/read the worst window|My plan, tested/.test(JSON.stringify(handed)),
       JSON.stringify(handed).slice(0, 200));

    ok('no script errors across the saved reading', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ============================ review v4 §13 · the token sheet, as a check
   *
   * The sheet builds itself from theme.css and sim/format.js, which makes it
   * a checker as well as a document: if a colour moves below its floor or a
   * number format drifts, this fails rather than the sheet quietly lying.
   */
  section('Step 13 · the token sheet');
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + 'tokens.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    ok('the sheet builds itself from the stylesheet',
       (await page.evaluate(() => document.body.dataset.ready)) === 'yes');
    ok('no colour pair is below the floor its job needs',
       (await page.locator('#colours .fail').count()) === 0,
       await page.locator('#colours .fail').allInnerTexts().then(t => t.join(', ')));

    /* The ratios the review states, measured here rather than quoted there. */
    const measured = await page.locator('#colours').innerText();
    for (const [token, ratio] of [['--ink', '13.48:1'], ['--muted', '4.94:1'],
                                  ['--slate', '4.75:1'], ['--rule-edge', '3.04:1'],
                                  ['--marker-ink', '12.77:1']]) {
      const row = measured.split('\n').find(l => l.startsWith(token));
      ok('the measured ratio for ' + token + ' is the one the review states',
         !!row && row.includes(ratio), row || 'row not found');
    }
    ok('and the night edge clears three to one as well', /3\.03:1/.test(measured));

    /* A token measured against a ground the pair never meets proves nothing,
       so the reader's own figures are measured on the composited band. */
    ok('the composited marker band is named and measured',
       /the composited band/.test(measured) && /#f9eaa1/i.test(measured), measured.slice(-200));
    /* A declared token nobody uses should not sit here looking live. */
    ok('a token unused on a sheet says so rather than showing a ratio',
       /not used by day/.test(measured), measured);

    const numbers = await page.locator('#numbers').innerText();
    [['₹87,500'], ['₹4.20 lakh'], ['₹4,20,000'], ['₹1.26 crore'],
     ['₹1,26,42,444'], ['₹4,312 crore'], ['₹43,12,00,00,000']].forEach(([cell]) => {
      ok('the sheet prints ' + cell + ' from the module itself', numbers.includes(cell), numbers);
    });

    const other = await page.locator('#other-formats').innerText();
    ok('a true minus, a closed-up percent and a dd-MMM-yyyy date are all shown',
       /−3\.4%/.test(other) && /9\.2%/.test(other) && /01-Apr-2021/.test(other), other);
    ok('and the span uses "to", never a dash',
       /01-Apr-2021 to 30-Aug-2026/.test(other), other);

    const caps = await page.locator('#caps').innerText();
    ok('every input cap is stated with the sentence it refuses with',
       /0% to 30%/.test(caps) && /0% to 25%/.test(caps) && /0% to 20%/.test(caps) &&
       /1 to 50/.test(caps) && /₹1,000 crore/.test(caps), caps);

    ok('the rules that are not values are on it too',
       /No red and no green anywhere/.test(await page.locator('.rules').innerText()) &&
       /Marker means/.test(await page.locator('.rules').innerText()));

    ok('the sheet does not scroll sideways either',
       (await page.evaluate(() => document.documentElement.scrollWidth -
                                  document.documentElement.clientWidth)) <= 0);
    ok('no script errors building the sheet', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: path.join(TMP, 'v3-tokens.png'), fullPage: true });
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
