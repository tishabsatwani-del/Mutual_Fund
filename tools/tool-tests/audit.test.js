/* The September audit, item by item, driven the way a reader drives it.
 *
 * Run: node tools/tool-tests/audit.test.js   (server: python3 -m http.server 8781 from the repo root)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TMP = process.env.PRC_TMP || '/tmp/prc';
const CHROME = process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE_URL = process.env.PRC_URL || 'http://127.0.0.1:8781/tool/';
fs.mkdirSync(TMP, { recursive: true });

let pass = 0; const fails = [];
function ok(n, c, d) {
  if (c) { pass++; console.log('  pass  ' + n); }
  else { fails.push(n); console.log('  FAIL  ' + n + (d ? '  -- ' + String(d).slice(0, 240) : '')); }
}
function section(t) { console.log('\n' + t); }
function flat(s) { return String(s).replace(/\s+/g, ' ').trim(); }

function navFile(file, rate, from, to, start, head) {
  const out = [head || 'Date,NAV']; let v = start || 100, t = Date.UTC(from[0], from[1] - 1, from[2]);
  const end = Date.UTC(to[0], to[1] - 1, to[2]);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10) + ',' + v.toFixed(4));
    v *= Math.pow(1 + rate, 1 / 365.2425); t += 86400000;
  }
  fs.writeFileSync(file, out.join('\n')); return file;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '.ixpanel{display:block!important}';
      document.head.appendChild(s);
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const fund9 = navFile(TMP + '/audit-fund-9y.csv', 0.12, [2016, 1, 1], [2025, 1, 1], 100);
  const tri9 = navFile(TMP + '/audit-nifty-50-tri.csv', 0.10, [2016, 1, 1], [2025, 1, 1], 1000, 'Date,Index Value');
  const short14 = navFile(TMP + '/audit-short-1y5m.csv', 0.10, [2023, 8, 1], [2025, 1, 1], 100);
  const oneDayShort = navFile(TMP + '/audit-4y364d.csv', 0.10, [2021, 9, 3], [2026, 9, 2], 100);
  const seven = navFile(TMP + '/audit-7y.csv', 0.11, [2018, 1, 1], [2025, 1, 1], 100);
  const bulk = (() => {
    const L = ['Scheme Name,Date,NAV'];
    let t = Date.UTC(2019, 0, 1), a = 10, b = 20;
    while (t <= Date.UTC(2025, 0, 1)) {
      const d = new Date(t).toISOString().slice(0, 10);
      L.push('Alpha Flexi Cap Fund - Direct - Growth,' + d + ',' + a.toFixed(4));
      L.push('Beta Bond Fund - Direct - Growth,' + d + ',' + b.toFixed(4));
      a *= Math.pow(1.13, 1 / 365.2425); b *= Math.pow(1.07, 1 / 365.2425); t += 86400000;
    }
    fs.writeFileSync(TMP + '/audit-bulk.csv', L.join('\n')); return TMP + '/audit-bulk.csv';
  })();
  const cas = (() => {
    const L = ['Date,Transaction Type,Amount,Units,NAV'];
    let t = Date.UTC(2021, 0, 5);
    for (let i = 0; i < 30; i++) {
      const d = new Date(t).toISOString().slice(0, 10);
      L.push(d + ',' + (i % 7 === 6 ? 'Redemption' : 'Purchase') + ',' + (i % 7 === 6 ? '-2000' : '5000') + ',' + (30 + i) + ',' + (100 + i));
      t += 30 * 86400000;
    }
    fs.writeFileSync(TMP + '/audit-cas.csv', L.join('\n')); return TMP + '/audit-cas.csv';
  })();

  async function openIndex() {
    await page.goto(BASE_URL + '#rolling', { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.click('#r-source .chip[data-source="index"]');
    await page.waitForTimeout(250);
  }
  async function openCard(which) {
    if (await page.locator('#up-doors').isHidden()) return;
    const btn = page.locator('#door-' + which);
    if ((await btn.getAttribute('aria-expanded')) !== 'true') { await btn.click(); await page.waitForTimeout(220); }
  }
  async function loadBoth() {
    await page.setInputFiles('#bm-file', fund9);
    await page.waitForTimeout(1500);
    await page.setInputFiles('#cmp-file', tri9);
    await page.waitForTimeout(1500);
  }

  section('5 · The two modes are named by what they do');
  await page.goto(BASE_URL + '#home', { waitUntil: 'load' });
  const home = flat(await page.locator('#view-home').innerText());
  ok('the Compare card is a fund against its index',
     /Rolling returns: a fund against its index/.test(home), home.slice(0, 300));
  ok('the Examine card is one fund or index on its own',
     /Rolling returns: one fund or index on its own/.test(home));
  ok('and neither says "market index" or "my own fund" any more',
     !/Rolling returns: a market index|Rolling returns: my own fund/.test(home));
  await openIndex();
  const chips = await page.locator('#r-source .chip').allInnerTexts();
  ok('the step-1 toggles say the same',
     chips.join('|') === 'A fund against its benchmark index|One fund or index on its own', chips.join('|'));
  ok('the comparison toggle is the one with two cards',
     (await page.locator('#src-index').isVisible()) && (await page.locator('#up-doors').count()) === 1);

  section('33 · The phone’s back button returns to the home screen');
  await page.goto(BASE_URL + '#home', { waitUntil: 'load' });
  await page.click('.tile[data-go="goal"]');
  await page.waitForTimeout(300);
  ok('a card opens its screen', (await page.getAttribute('body', 'data-view')) === 'goal');
  await page.goBack();
  await page.waitForTimeout(400);
  ok('and Back returns to the home screen, not off the site',
     (await page.getAttribute('body', 'data-view')) === 'home' && /#home|\/tool\/$/.test(page.url()), page.url());

  section('4 · A long press selects nothing, except where the reader types');
  ok('body text is not selectable',
     await page.evaluate(() => getComputedStyle(document.body).userSelect === 'none'));
  ok('the paste box still is',
     await page.evaluate(() => getComputedStyle(document.querySelector('#pf-paste-text')).userSelect === 'text'));

  section('28 · Every date field reads dd-Mmm-yyyy');
  await openIndex();
  ok('the two date fields carry the overlay', (await page.locator('#r-start ~ .dateshow, .datewrap .dateshow').count()) >= 2);
  await page.setInputFiles('#bm-file', fund9);
  await page.waitForTimeout(1500);
  ok('and show the loaded file’s dates the tool’s way',
     /01-Jan-2016/.test(await page.locator('.datewrap:has(#r-start) .dateshow').innerText()),
     await page.locator('.datewrap:has(#r-start) .dateshow').innerText());

  section('14 · Ready only when both files are loaded on the comparison path');
  ok('with card 1 alone the line waits for the benchmark',
     (await page.locator('#up-waiting').count()) === 1 &&
     /Waiting for the benchmark index file/.test(await page.locator('#up-waiting').innerText()) &&
     (await page.locator('#up-ready').count()) === 0);
  await page.setInputFiles('#cmp-file', tri9);
  await page.waitForTimeout(1500);
  ok('with both, it is ready', (await page.locator('#up-ready').count()) === 1 &&
     (await page.locator('#up-waiting').count()) === 0);

  section('29 · Use the full range hides when the range already is the full range');
  ok('hidden after a fresh load', await page.locator('#r-all').isHidden());
  await page.fill('#r-start', '2018-01-01');
  await page.waitForTimeout(400);
  ok('shown once the dates are narrowed', await page.locator('#r-all').isVisible());
  await page.click('#r-all');
  await page.waitForTimeout(400);
  ok('and hidden again after it is used', await page.locator('#r-all').isHidden());

  section('13 · A refusal from the last file does not sit under the new one');
  await openIndex();
  await page.setInputFiles('#bm-file', short14);
  await page.waitForTimeout(1500);
  const blocked = flat(await page.locator('#r-out').innerText());
  ok('a 1.4-year file with 3 years chosen is blocked, in words',
     /requires at least 3 years/.test(blocked), blocked.slice(0, 200));
  ok('and Calculate is disabled rather than erroring after the tap', await page.locator('#r-run').isDisabled());
  await openCard('a');
  await page.setInputFiles('#bm-file', fund9);
  await page.waitForTimeout(1500);
  ok('loading a 9-year file clears the old refusal',
     flat(await page.locator('#r-out').innerText()) === '', flat(await page.locator('#r-out').innerText()).slice(0, 120));
  /* The cleared holding period is never restored on the reader's behalf, so
     Calculate stays off until one is chosen again. */
  ok('and Calculate stays off until a holding period is chosen again',
     await page.locator('#r-run').isDisabled());
  await page.locator('#r-years .chip[data-years="3"]').click();
  await page.waitForTimeout(250);
  ok('then it is live', !(await page.locator('#r-run').isDisabled()));

  section('12 · A file one day short of five years says so in days');
  await openIndex();
  await page.setInputFiles('#bm-file', oneDayShort);
  await page.waitForTimeout(1500);
  const chip5 = await page.locator('#r-years .chip[data-years="5"]').innerText();
  ok('the 5-year chip says "1 day short"', /5 years — 1 day short/.test(chip5), chip5);
  ok('and Data available is not rounded up to 5.0',
     /4\.9 years/.test(await page.locator('#r-range').innerText()), await page.locator('#r-range').innerText());
  await page.evaluate(() => { const c = document.querySelector('#r-years .chip[data-years="5"]'); c.disabled = false; c.click(); });
  await page.waitForTimeout(250);
  await page.setInputFiles('#cmp-file', tri9);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector('#r-run').disabled = false; });
  await page.click('#r-run');
  await page.waitForTimeout(800);
  const refusal = flat(await page.locator('#r-out').innerText());
  ok('a forced 5-year run refuses in days, not "5.0 years"',
     /It covers 1,825 days; one 5-year window needs 1,826\./.test(refusal), refusal.slice(0, 260));

  section('31 · The fund list folds to the chosen fund');
  await openIndex();
  await page.setInputFiles('#bm-file', bulk);
  await page.waitForTimeout(1800);
  ok('a two-scheme file offers its list', (await page.locator('#r-scheme-list .hit').count()) >= 2);
  await page.locator('#r-scheme-list .hit:not(.combined)').first().click();
  await page.waitForTimeout(800);
  ok('picking one folds the list',
     (await page.getAttribute('#r-scheme-wrap', 'data-folded')) === 'yes' &&
     await page.locator('#r-scheme-list').isHidden() &&
     /Chosen: Alpha Flexi Cap Fund/.test(await page.locator('#r-scheme-wrap .pickedline').innerText()));
  await page.click('#r-scheme-wrap [data-unfold]');
  await page.waitForTimeout(300);
  ok('and Change fund opens it again', await page.locator('#r-scheme-list').isVisible());

  section('6 · A statement of the reader’s own payments is refused at card 1');
  await openIndex();
  await page.setInputFiles('#bm-file', cas);
  await page.waitForTimeout(1500);
  await openCard('a');
  const casSays = flat(await page.locator('#bm-status').innerText());
  ok('in the audit’s words',
     /This looks like a statement of your own payments\. Rolling returns need the fund’s price history/.test(casSays) &&
     /Check my portfolio is the screen for this file/.test(casSays), casSays.slice(0, 260));

  section('32 · The frequency row is on both paths');
  await page.goto(BASE_URL + '#rolling', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.click('#r-source .chip[data-source="fund"]');
  await page.waitForTimeout(250);
  ok('the single-file path has the frequency chips too', await page.locator('#r-freq-wrap').isVisible());
  ok('and the same help label',
     /Where do I get my fund’s NAV file\?/.test(await page.locator('#src-fund details.explain summary').innerText()));

  section('17 · The portfolio door refuses a price history before asking anything');
  await page.goto(BASE_URL + '#portfolio', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.setInputFiles('#pf-file', fund9);
  await page.waitForTimeout(1500);
  const door = flat(await page.locator('#pf-door-out').innerText());
  ok('a NAV file is refused at once', /price|NAV|history/i.test(door) && (await page.locator('#pf-door-out .notice.bad').count()) === 1, door.slice(0, 200));
  ok('with no words to tick first', (await page.locator('#pf-door-out .ticks').count()) === 0);

  section('The comparison results, item by item');
  await openIndex();
  await loadBoth();
  await page.locator('#r-years .chip[data-years="3"]').click();
  await page.waitForTimeout(250);
  await page.click('#r-run');
  await page.waitForTimeout(2500);
  const out = flat(await page.locator('#r-out').innerText());
  /* 1 */
  ok('1 · the header card is static and appears once',
     (await page.locator('#r-out .resulthead').count()) === 1 && (await page.locator('.stickybar').count()) === 0 &&
     await page.evaluate(() => getComputedStyle(document.querySelector('#r-out .resulthead')).position === 'static'));
  /* 2 */
  ok('2 · Save as PDF sits on the tab row and at the foot; Print is gone',
     (await page.locator('#r-out .ixtabs .pdfbtn').count()) === 1 &&
     (await page.locator('#r-out .pdfrow .pdfbtn').count()) === 1 && !/Print \/ save PDF/.test(out));
  /* 7 */
  ok('7 · Sharpe and Sortino are gone from every table', !/Sharpe|Sortino/.test(out));
  ok('7 · and the spread of window returns is named as the spread',
     /Spread of window returns \(std dev\)/.test(out) && !/Return Volatility \(Std Deviation\)/.test(out));
  /* 8 */
  ok('8 · the join rule is not restated on the results; the method page is pointed at',
     !/YYYY-MM-DD/.test(out) && !/matched on calendar dates, with up to seven days/.test(out) &&
     /joined as set out in How the numbers work/.test(out));
  /* 9 */
  ok('9 · the CAGR formula carries its exponent and its words',
     (await page.locator('#r-out .formula sup').count()) === 1 &&
     /raise the result to the power of 365\.25 divided by the number of days/.test(out));
  /* 10 */
  ok('10 · independent periods are a whole number',
     /Independent \(Non-Overlapping\) 3-Year Horizons:? 3 Periods/i.test(out) && !/\d\.\d Periods/i.test(out),
     (out.match(/Independent[^|]{0,60}/i) || [''])[0]);
  ok('10 · in the bullet too', /only 3 of them could stand side by side/.test(
     await page.evaluate(() => document.querySelector('#r-out').textContent.replace(/\s+/g, ' '))));
  /* 23 */
  const tiles = await page.locator('#r-out .qgrid .qtile .k').allInnerTexts();
  ok('23 · the quartile strip is five labelled tiles',
     tiles.join('|').toLowerCase() === 'worst|bottom quarter|median|top quarter|best' &&
     (await page.locator('#r-out .ixpanel[data-panel="risk"] table thead th:has-text("Bottom quarter")').count()) === 0,
     tiles.join('|'));
  /* 36 */
  ok('36 · only Ended below zero remains', /Ended below zero/.test(out) && !/Ended above zero/.test(out));
  /* 24 */
  const heads = (await page.locator('#r-out table.charmatrix thead th').allInnerTexts()).map(flat);
  ok('24 · the characteristic table is headed Fund · Index · Gap',
     heads.join('|').toLowerCase() === 'characteristic|fund|index|gap', heads.join('|'));
  ok('24 · and so is the Against table', /gap/i.test((await page.locator('#r-out .ixpanel[data-panel="bench"] table.stickyfirst thead').last().innerText())));
  /* 27 */
  ok('27 · the statistical summary keeps its first column and fades at the edge',
     (await page.locator('#r-out .scroll.fade table.summary3.stickyfirst').count()) === 1 &&
     await page.evaluate(() => getComputedStyle(document.querySelector('#r-out table.summary3 td:first-child')).position === 'sticky'));
  /* 34/35 */
  ok('34 · the scope and data-standard notes, and the three-rates-are-not block, are gone',
     !/Dataset Scope Note|Data Standard Note|What these three rates are not/.test(out));
  ok('35 · the insights card is gone', !/Factual Data Insights/.test(out));
  ok('34 · what remains is one folded block per results page',
     /What these figures are not/.test(await page.locator('#r-out details.teachnotes summary').innerText()));
  /* 39, 40 */
  ok('39 · Daily is "(every start date)", not Recommended',
     /Daily \(every start date\)/.test(await page.locator('#r-freq').innerText()) && !/Recommended/.test(await page.locator('#r-freq').innerText()));
  ok('40 · the preset chips are captioned as starting points only',
     /Starting points only, not the tool’s view\./.test(out));
  /* 41 */
  ok('41 · the three questions sit under the rate box on the Risk tab',
     (await page.locator('#r-out .ixpanel[data-panel="risk"] .reflectlist').count()) === 1 &&
     (await page.locator('#r-out .ixpanel[data-panel="summary"] .reflectlist').count()) === 0);
  /* 3 / 26 */
  await page.locator('#r-out details.windowlist summary').click();
  await page.waitForTimeout(300);
  const winHeads = (await page.locator('#winbox-rolling thead th').allInnerTexts()).map(flat);
  ok('3 · the window table has four true columns', winHeads.join('|').toLowerCase() === 'start|end|fund|index', winHeads.join('|'));
  ok('3 · inside its own scroll box, header pinned',
     await page.evaluate(() => {
       const b = document.querySelector('#winbox-rolling');
       const cs = getComputedStyle(b), th = getComputedStyle(b.querySelector('thead th'));
       return cs.overflowY === 'auto' && parseFloat(cs.maxHeight) < window.innerHeight && th.position === 'sticky';
     }));
  ok('3 · rows are ~36px, not four lines each',
     await page.evaluate(() => document.querySelector('#winbox-rolling tbody tr').getBoundingClientRect().height < 40));
  const years = await page.locator('#r-out .yearchips .chip').allInnerTexts();
  ok('3 · a row of year chips sits above it', years.length >= 5 && years[0] === '2016', years.join(','));
  await page.locator('#r-out .yearchips .chip[data-jump-year="2019"]').click();
  await page.waitForTimeout(300);
  ok('3 · tapping a year jumps the box to that year',
     await page.evaluate(() => {
       const b = document.querySelector('#winbox-rolling');
       const row = b.querySelector('tr[data-year="2019"]');
       return b.scrollTop > 0 && Math.abs(row.getBoundingClientRect().top - b.getBoundingClientRect().top) < 60;
     }));
  const [csv] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#r-out .wincsv').click()
  ]);
  ok('3 · the rows download as CSV', /^Where-You-Stand-.*-windows\.csv$/.test(csv.suggestedFilename()), csv.suggestedFilename());
  const csvPath = path.join(TMP, 'audit-windows.csv');
  await csv.saveAs(csvPath);
  const csvText = fs.readFileSync(csvPath, 'utf8');
  ok('3 · with a header and one row per window',
     /^Window starts,Window ends,/.test(csvText) && csvText.split(/\r?\n/).length > 1000, csvText.slice(0, 120));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  ok('3 · a Top button exists, hidden until the reader is a screen down',
     (await page.locator('#r-out .totop').count()) === 1 && await page.locator('#r-out .totop').isHidden());
  await page.evaluate(() => { document.querySelector('#winbox-rolling').scrollIntoView(); window.scrollBy(0, 1200); });
  await page.waitForTimeout(300);
  ok('3 · and shows once they are', await page.locator('#r-out .totop').isVisible());
  await page.locator('#r-out .totop').click();
  await page.waitForTimeout(900);
  ok('3 · returning to the result tab row, not the page top',
     await page.evaluate(() => Math.abs(document.querySelector('#r-out .ixtabs').getBoundingClientRect().top) < 40 && window.scrollY > 100));

  section('30 · Two windows are two measurements, in words');
  await openIndex();
  await page.setInputFiles('#bm-file', seven);
  await page.waitForTimeout(1500);
  await page.setInputFiles('#cmp-file', tri9);
  await page.waitForTimeout(1500);
  const seven7 = page.locator('#r-years .chip[data-years="7"]');
  if ((await seven7.count()) && !(await seven7.isDisabled())) {
    await seven7.click();
    await page.waitForTimeout(250);
    await page.click('#r-run');
    await page.waitForTimeout(1500);
    const thin = flat(await page.locator('#r-out').innerText());
    ok('the count is a word and the result a measurement, not a distribution',
       /The only (one |two |three |)7-year periods? in this data/i.test(thin) &&
       /(One|Two|Three) measurements?, not a distribution/.test(thin) && !/The only \d+ \d+-year/.test(thin),
       (thin.match(/.{0,160}(not a distribution|measurement|period in this data).{0,120}/) || [thin.slice(0, 600)])[0]);
  } else console.log('  (7-year chip not offered on this file; skipped)');

  section('15 · 16 · The goal’s extra each month says it rises with the step-up');
  await page.goto(BASE_URL + '#goal', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.fill('#g-target', '10000000');
  await page.fill('#g-step', '10');
  await page.click('#g-calc');
  await page.waitForTimeout(600);
  const g1 = flat(await page.locator('#g-out').innerText());
  ok('with a 10% step-up: "a month now, rising 10% a year"',
     /a month now/.test(g1) && /Rising 10% a year with the rest of your instalment/.test(g1),
     (g1.match(/Additional monthly investment needed.{0,160}/) || [''])[0]);
  await page.fill('#g-step', '0');
  await page.click('#g-calc');
  await page.waitForTimeout(600);
  const g0 = flat(await page.locator('#g-out').innerText());
  ok('with none: "a month, every month"', /a month, every month/.test(g0),
     (g0.match(/Additional monthly investment needed.{0,120}/) || [''])[0]);
  ok('42 · the step-up helper no longer nudges',
     /Type the yearly rise you expect, or leave it at zero\./.test(await page.locator('#view-goal').innerText()) &&
     !/Most people.s income rises/.test(await page.locator('#view-goal').innerText()));
  await page.goto(BASE_URL + '#method', { waitUntil: 'load' });
  const method = flat(await page.locator('#view-method').innerText());
  ok('16 · the monthly-rate convention is disclosed',
     /converted to a monthly rate so that twelve months compound to exactly the yearly figure, not divided by twelve/.test(method) &&
     /a little lower than most app calculators/.test(method));
  ok('8 · and the join rule lives here, once',
     /How two files are joined/.test(method) && /carried onto the date, never a later one/.test(method) &&
     /within seven days/.test(method));

  section('20 · 21 · 22 · 37 · The portfolio result’s copy');
  await page.goto(BASE_URL + '#portfolio', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.click('#pf-manual');
  await page.waitForTimeout(300);
  await page.click('#pf-demo');
  await page.waitForTimeout(300);
  await page.click('#pf-calc');
  await page.waitForTimeout(1200);
  const pf = flat(await page.locator('#pf-out').innerText());
  ok('20 · no rate-dependent tax figure',
     /Plan on less once tax is paid, and less again if you sell early\./.test(pf) && !/a point a year/.test(pf));
  ok('21 · no bare chapter reference',
     !/Chapter 13/.test(pf) && /Explained in the book’s returns chapter\./.test(pf));
  ok('22 · the cross-reference names a card that exists',
     !/Understand market history/.test(pf) && /Rolling returns: one fund or index on its own/.test(pf) &&
     (await page.locator('#pf-out [data-go="history"]').count()) === 0);
  ok('37 · the second explanation is one line',
     /Your money grew at about [\d.]+% a year, counting the date every rupee went in and came out\./.test(pf) &&
     !/Money you invested early had longer to work/.test(pf) && !/is not a yearly figure\. Spread across/.test(pf),
     (pf.match(/Your money grew.{0,200}/) || [''])[0]);
  ok('2 · the portfolio result carries Save as PDF', (await page.locator('#pf-out .pdfbtn').count()) === 1);

  section('18 · 19 · 38 · About and the sheet');
  await page.goto(BASE_URL + '#about', { waitUntil: 'load' });
  const about = flat(await page.locator('#view-about').innerText());
  ok('18 · the index-fund-proxy sentence is gone', !/index fund you could actually have bought/.test(about));
  ok('19 · the version is 2.1', /Tool version 2\.1/.test(about));
  ok('2 · the About row no longer claims "no third-party code"',
     /no requests to any other site; everything the page needs is served from this address/.test(about) &&
     !/Third-party code, fonts or analytics/.test(about));
  await page.goto(BASE_URL + '#sheet', { waitUntil: 'load' });
  const sheet = flat(await page.locator('#view-sheet').innerText());
  ok('38 · the 💯 line is gone from the sheet page', !/100% Standalone/.test(sheet) && (await page.locator('.privacy-badge').count()) === 0);
  ok('19 · the file name and the page carry the one version',
     (await page.getAttribute('#sheetlink', 'href')) === 'XIRR-Calculator-2.1.xlsx' && /same version number as this tool, 2\.1/.test(sheet));

  ok('no script errors in the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
