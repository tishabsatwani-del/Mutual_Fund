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

  /* Below 34rem the index path's two cards live behind compact doors, and a
     card folds itself away once its file is read. Anything that inspects a
     card has to open its door first. On the fund path, and above 34rem, the
     doors are not drawn and this does nothing. */
  async function openCard(which) {
    if (await page.locator('#up-doors').isHidden()) return;
    const btn = page.locator('#door-' + which);
    if ((await btn.getAttribute('aria-expanded')) !== 'true') {
      await btn.click();
      await page.waitForTimeout(220);
    }
  }

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

  /* The author reversed review v4 §12.14 on 31 August 2026: the page opens on
     three years rather than on nothing. What survives of the old rule is that
     the default is never silently RESTORED over a reader's own choice -- see
     "a choice the history can no longer measure is cleared, not swapped". */
  ok('the page opens with three years chosen',
     (await page.locator('#r-years .chip[aria-checked="true"]').allInnerTexts()).join('|') === '3 years',
     (await page.locator('#r-years .chip[aria-checked="true"]').allInnerTexts()).join('|'));
  ok('and step 3 is ticked accordingly',
     (await page.locator('#step-hold').getAttribute('data-done')) === 'yes');

  ok('the upload area says how much history each length wants',
     /3\+ years of historical data for\s+1-Year rolling calculations, 5\+ years for 3-Year calculations, and 7\+ years for\s+comprehensive 5-Year statistical analysis/
       .test((await page.locator('.helper-span').innerText()).replace(/\s+/g, ' ')) ||
     /3\+ years .*1-Year .*5\+ years for 3-Year .*7\+ years for comprehensive 5-Year/
       .test((await page.locator('.helper-span').innerText()).replace(/\s+/g, ' ')),
     await page.locator('.helper-span').innerText());

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
  /* Three funds, plus all of them together offered first. */
  ok('every fund is offered, and all of them together',
     (await page.locator('#r-scheme-list .hit').count()) === 4 &&
     (await page.locator('#r-scheme-list .hit.combined').count()) === 1,
     String(await page.locator('#r-scheme-list .hit').count()));
  ok('the list says how many the file holds',
     /3 funds in this file/.test(await page.locator('#r-scheme-count').innerText()));
  ok('each entry carries its own date range',
     /01-Jan-2010 to 01-Jan-2025/
       .test(await page.locator('#r-scheme-list .hit:not(.combined)').first().innerText()),
     await page.locator('#r-scheme-list .hit:not(.combined)').first().innerText());
  /* The combined row says what it is instead of a date range, because it is a
     construction rather than a fund. */
  ok('while the combined row says what it is instead',
     /never rebalanced/.test(await page.locator('#r-scheme-list .hit.combined').innerText()),
     await page.locator('#r-scheme-list .hit.combined').innerText());
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

  /* Steps 2-4 are held at half opacity until there is something to analyse.
     gateSteps was called at init and from setSource -- both BEFORE a series can
     exist -- and never again, so the locked state stayed on for the whole
     session: every control below step 1 was live and usable while rendering at
     50%, which is precisely the "faded, looks disabled" the chips were being
     blamed for. Half of a 16.30:1 pill is not a 16.30:1 pill. */
  ok('the later steps come out of their locked state once there is data',
     (await page.evaluate(() => ['#step-period', '#step-hold', '#step-compare']
       .map(s => document.querySelector(s).dataset.locked +
                 ':' + getComputedStyle(document.querySelector(s)).opacity).join(' | '))) ===
     'no:1 | no:1 | no:1',
     await page.evaluate(() => ['#step-period', '#step-hold', '#step-compare']
       .map(s => document.querySelector(s).dataset.locked +
                 ':' + getComputedStyle(document.querySelector(s)).opacity).join(' | ')));

  /* An UNCHOSEN length is a live option and has to look like one. It used to
     take the card's own dark fill and the body ink, which is the same greyed
     state the browser gives a disabled button, so every length but the chosen
     one read as unavailable. Measured with a file loaded, because before that
     the chips are genuinely disabled and SHOULD look it. */
  const pill = await page.evaluate(() => {
    const c = document.querySelector('#r-years .chip[data-years="5"]');
    const s = getComputedStyle(c);
    return { bg: s.backgroundColor, fg: s.color, opacity: s.opacity, disabled: c.disabled };
  });
  ok('an unchosen holding period is a high-contrast secondary control, not a faded one',
     pill.disabled === false && pill.bg === 'rgb(241, 245, 249)' &&
     pill.fg === 'rgb(15, 23, 42)' && pill.opacity === '1',
     JSON.stringify(pill));
  ok('the dates cannot be set outside the data',
     (await page.locator('#r-start').getAttribute('min')) === '2010-01-01' &&
     (await page.locator('#r-end').getAttribute('max')) === '2025-01-01');

  /* Five years rather than the default three, so the run is on a length the
     reader actually chose. */
  await page.locator('#r-years .chip[data-years="5"]').click();
  await page.waitForTimeout(250);
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
  /* The index path says this with the go-ahead now: "Ready to analyse" as a
     control that carries the reader to step 2, rather than as a line of text
     under the card. */
  ok('an index file loads',
     /Ready to analyse/.test(await page.locator('#up-ready').innerText()),
     (await page.locator('#up-ready').innerText()).replace(/\s+/g, ' '));
  ok('and the door it came through shows the file it holds',
     (await page.locator('#door-a').getAttribute('data-state')) === 'loaded');

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
  /* Five years rather than the default three, so the run is on a length the
     reader actually chose. */
  await page.locator('#r-years .chip[data-years="5"]').click();
  await page.waitForTimeout(250);
  await page.click('#r-run');
  await page.waitForSelector('#r-out .result', { timeout: 20000 });
  out = await page.locator('#r-out').innerText();
  ok('consistency against the benchmark is reported', /came out ahead/i.test(out));

  /* Three measured rates, each saying what it counted -- and no verdict. */
  ok('the record is summarised as three rates',
     /The record, as three rates/.test(out) &&
     /Historical success rate/.test(out) &&
     /Benchmark outperformance rate/.test(out) &&
     /Historical downside risk/.test(out), out.slice(0, 200));
  ok('the outperformance rate is measured once a benchmark is loaded',
     !/Benchmark outperformance rate\s*not measured/.test(out), out.slice(0, 200));
  ok('and it carries the note that consistency guarantees nothing',
     /Past historical consistency does not guarantee future results/.test(out));
  ok('no card on this screen tells the reader to buy, sell, switch or hold',
     !/\b(you should|we recommend|consider (buying|selling|switching)|time to (buy|sell|exit))\b/i.test(out),
     (out.match(/.{0,60}(you should|we recommend|consider buying|time to buy).{0,60}/i) || [''])[0]);
  ok('a 14% fund beats a 10% index in every period', /100%/.test(out));
  /* The card that used to be the Reality check. It graded -- Strong, Mixed,
     Weak, Moderate, Limited -- by comparing each measured figure against a
     threshold this tool invented, which is a judgement about what counts as
     good and belongs to the reader. It now reports the figures. */
  ok('the comparison card reports four measurements',
     /The comparison, as four measurements/i.test(out), out.slice(0, 200));
  ok('and none of them is a grade',
     !/\b(Strong|Weak|Mixed|Moderate|Limited)\b/.test(out),
     (out.match(/.{0,50}\b(Strong|Weak|Mixed|Moderate|Limited)\b.{0,50}/) || [''])[0]);
  ok('the outperformance figure is a share of matched periods',
     /Outperformance Frequency \(%\)/.test(out) && /matched periods/.test(out), out.slice(0, 200));
  ok('only shared dates are compared', /both sets of data cover/.test(out));

  /* ------------------------------------------------------------ refusals */
  section('It refuses rather than guessing');
  await page.fill('#r-start', '2023-01-01');
  await page.waitForTimeout(800);
  ok('narrowing the window disables holding periods that no longer fit',
     await page.locator('#r-years .chip[data-years="5"]').isDisabled());
  ok('and the disabled chip says why',
     /needs 5 years of data/.test(await page.locator('#r-years .chip[data-years="5"]').innerText()));
  /* Review v4 §12.14: a length the history can no longer measure is CLEARED,
     not quietly swapped for a shorter one. Moving a reader from five years to
     one after they have looked away is the same recommendation a default is. */
  ok('a choice the history can no longer measure is cleared, not swapped',
     (await page.locator('#r-years .chip[aria-checked="true"]').count()) === 0,
     String(await page.locator('#r-years .chip[aria-checked="true"]').count()));
  /* It used to render nothing at all here, which left the reader looking at an
     empty results area and a set of chips that had changed under them. The
     block now names the two numbers that did not fit. */
  ok('and the block says why, in the place the answer would have been',
     /shorter than the holding period/i.test(await page.locator('#r-out').innerText()),
     (await page.locator('#r-out').innerText()).slice(0, 140));

  /* Choosing one that still fits brings the reading back. */
  await page.locator('#r-years .chip[data-years="1"]').click();
  await page.waitForTimeout(600);
  out = await page.locator('#r-out').innerText();
  ok('the analysis shows a result once a feasible period is chosen',
     /What was measured/.test(out), out.slice(0, 160));
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
  await page.locator('#r-years .chip[data-years="5"]').click();
  await page.waitForTimeout(700);
  ok('resetting the range recovers', /came out ahead|Median/i.test(await page.locator('#r-out').innerText()),
     (await page.locator('#r-out').innerText()).slice(0, 120));

  section('Start again clears everything');
  await page.click('#r-reset');
  await page.waitForTimeout(400);
  ok('the source selection is cleared',
     (await page.locator('#r-source .chip[aria-checked="true"]').count()) === 0);
  ok('the dates are disabled again', await page.locator('#r-start').isDisabled());
  ok('the analyse button is disabled again', await page.locator('#r-run').isDisabled());
  ok('the results are gone', (await page.locator('#r-out').innerText()).trim() === '');
  ok('the holding-period note is cleared too',
     (await page.locator('#r-window-note').innerText()).trim() === '',
     await page.locator('#r-window-note').innerText());
  /* Start again returns the page to the state it opens in, which now includes
     the three-year default -- so the tick follows the choice, not the file.
     Saying "not done" while a chip is plainly chosen is the screen
     contradicting itself. */
  ok('and step 3 is back to its opening choice, ticked',
     (await page.locator('#r-years .chip[aria-checked="true"]').allInnerTexts()).join('|') === '3 years' &&
     (await page.locator('#step-hold').getAttribute('data-done')) === 'yes',
     (await page.locator('#r-years .chip[aria-checked="true"]').allInnerTexts()).join('|'));

  /* ---------------------------------------- the run refuses, and says why ---
   *
   * Three states, and they are deliberately different things:
   *
   *   thinner than advised     a warning; the run is allowed, the numbers real
   *   shorter than the window  a block, naming the two numbers that did not fit
   *   nothing chosen           a refusal, in the step that holds the answer
   */
  section('A run that cannot happen says so, in the step that holds the answer');
  await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  await page.click('#r-source .chip[data-source="fund"]');
  await page.setInputFiles('#f-file', plainFile(TMP + '/r-short.csv', 0.11, 2022, 2025, 10));
  await page.waitForTimeout(1500);

  /* 2022-2025 is three years, so five, seven and ten are struck off and the
     three-year default -- which exactly fits the span -- survives. */
  ok('lengths the file cannot measure are struck off',
     (await page.locator('#r-years .chip:disabled').count()) === 3,
     String(await page.locator('#r-years .chip:disabled').count()));

  /* Three years of file for three-year windows is allowed and warned about:
     5+ years is what the step-1 helper text asks for. */
  /* s.count runs to thousands and every window overlaps its neighbours: on a
     daily file, today's window and yesterday's share all but one of their days.
     The number that means something is how many could stand side by side
     without touching -- the span divided by the window length. */
  /* Three years of file for three-year windows leaves exactly ONE window, and
     a screen written about a range then has nothing to describe. The badge
     used to say "These 1 windows overlap ... read the range below as the shape
     of that much market", which is advice about a shape with one point in it.
     At this length the screen states the measurement instead. */
  await page.click('#r-run');
  await page.waitForTimeout(900);
  const thinOut = (await page.locator('#r-out').innerText()).replace(/\s+/g, ' ');
  ok('one window is stated as a measurement, not summarised as a range',
     /The only 3-year period in this data/i.test(thinOut) &&
     /This is a measurement, not a range/i.test(thinOut), thinOut.slice(0, 240));
  ok('and no badge invites the reader to read a range that is not there',
     !/Low data density/i.test(thinOut) && !/Read the range below/i.test(thinOut),
     (thinOut.match(/.{0,50}(data density|range below).{0,50}/i) || [''])[0]);

  /* Shorten the window on the same file and a real distribution appears, so
     the badge has something to count. Three years of history holds three
     independent one-year periods, against the ~750 overlapping ones measured. */
  await page.locator('#r-years .chip[data-years="1"]').click();
  await page.waitForTimeout(1200);
  ok('the badge counts independent periods, not the hundreds of overlapping ones',
     await (async () => {
       const t = await page.locator('#r-out').innerText();
       /* "Independent" overclaimed: dividing the span by the window length
          gives at most how many periods could stand apart, not a sample of
          independent observations. The badge now says which it is. */
       return /Low data density/i.test(t) && /3 non-overlapping 1-year periods\b/.test(t);
     })(),
     (await page.locator('#r-out').innerText()).replace(/\s+/g, ' ').slice(0, 240));
  await page.locator('#r-years .chip[data-years="3"]').click();
  await page.waitForTimeout(800);

  ok('a file thinner than the recommendation warns rather than refusing',
     !(await page.locator('#r-span-warn').isHidden()) &&
     /5\+ years is the recommended amount of history/
       .test(await page.locator('#r-span-warn').innerText()),
     await page.locator('#r-span-warn').innerText());
  await page.click('#r-run');
  await page.waitForTimeout(900);
  ok('and the run still happens',
     /The only 3-year period in this data/i.test(await page.locator('#r-out').innerText()),
     (await page.locator('#r-out').innerText()).slice(0, 140));

  /* Narrow the dates until no three-year period fits. The reader gets the two
     numbers that did not fit, where the answer would have been -- not a screen
     whose chips silently changed under them. */
  await page.fill('#r-start', '2023-06-01');
  await page.waitForTimeout(900);
  const blocked = await page.locator('#r-out').innerText();
  ok('a history shorter than the window itself is blocked, and names both numbers',
     /shorter than the holding period/i.test(blocked) &&
     /not one full 3-year period fits inside it/.test(blocked), blocked.slice(0, 200));
  ok('and it says what would fit instead',
     /Choose 1 year or shorter in step 3, or load a longer history/.test(blocked),
     blocked.slice(0, 240));
  ok('the choice is cleared rather than slid down to a shorter one',
     (await page.locator('#r-years .chip[aria-checked="true"]').count()) === 0,
     String(await page.locator('#r-years .chip[aria-checked="true"]').count()));

  /* And with nothing chosen, pressing the button used to do nothing whatsoever:
     it cleared the output and returned. */
  await page.click('#r-run');
  await page.waitForTimeout(500);
  ok('pressing the button with nothing chosen says exactly what is missing',
     (await page.locator('#r-hold-error').innerText()).trim() ===
       'Please select a holding period to continue',
     await page.locator('#r-hold-error').innerText());
  ok('and the step itself is marked, not the button at the bottom of the page',
     (await page.locator('#step-hold').getAttribute('data-error')) === 'yes');

  await page.locator('#r-years .chip[data-years="1"]').click();
  await page.waitForTimeout(400);
  ok('choosing one clears the message again',
     (await page.locator('#r-hold-error').isHidden()) &&
     (await page.locator('#step-hold').getAttribute('data-error')) !== 'yes');

  /* ------------------------------- a many-scheme file, at either end of the
   *                                  comparison
   *
   * The picker served step 1's FUND slot alone, and it lived inside that block.
   * A file holding several schemes can arrive at step 1's index slot or at
   * step 4's benchmark slot just as easily, and both refused it with a red line
   * and nothing to click -- the tool naming the problem and then offering no
   * way out of it.
   */
  section('Every slot that can take a many-scheme file can also choose from it');
  /* A real reload, not a hash change: earlier cases in this file leave loaded
     series in the comparison list, and the benchmark upload only appears while
     that list is empty. */
  await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });

  const idxFile = plainFile(TMP + '/rr-idx.csv', 0.11, 2018, 2026, 1000);
  const threeFile = TMP + '/rr-three.csv';
  {
    const out = ['Scheme Name,Date,NAV'];
    for (const [nm, start, rate] of [['Alpha Fund - Direct Growth', 10, 0.14],
                                     ['Beta Fund - Direct Growth', 450, 0.08],
                                     ['Gamma Fund - Direct Growth', 87, 0.20]]) {
      let v = start, t = Date.UTC(2018, 0, 1);
      while (t <= Date.UTC(2026, 0, 1)) {
        const d = new Date(t);
        if (d.getUTCDay() % 6) out.push(nm + ',' + d.toISOString().slice(0, 10) + ',' + v.toFixed(4));
        v *= Math.pow(1 + rate, 1 / 365.2425); t += 86400000;
      }
    }
    fs.writeFileSync(threeFile, out.join('\n'));
  }

  /* The exact flow reported: the index in step 1, the three-scheme file in the
     benchmark slot in step 4. */
  await page.click('#r-source .chip[data-source="index"]');
  await page.waitForTimeout(300);
  await page.setInputFiles('#bm-file', idxFile);
  await page.waitForTimeout(1400);
  await page.setInputFiles('#cmp-file', threeFile);
  await page.waitForTimeout(1600);
  /* The picker lives inside card 2, and a many-scheme file is the one case
     that does NOT fold the card away -- there is still a question on it. */
  await openCard('b');

  ok('a many-scheme file in the benchmark slot offers a picker, not just a refusal',
     !(await page.locator('#cmp-scheme-wrap').isHidden()) &&
     /holds\s*3\s*schemes/.test((await page.locator('#cmp-note').innerText()).replace(/\s+/g, ' ')),
     (await page.locator('#cmp-note').innerText()).replace(/\n/g, ' '));
  ok('with every scheme in it, and all of them together offered first',
     (await page.locator('#cmp-scheme-list .hit .nm').allInnerTexts()).join(' | ') ===
     'All 3 together, equal amounts at the start | Alpha Fund - Direct Growth | ' +
     'Beta Fund - Direct Growth | Gamma Fund - Direct Growth',
     (await page.locator('#cmp-scheme-list .hit .nm').allInnerTexts()).join(' | '));

  await page.locator('#r-years .chip[data-years="3"]').click();
  await page.waitForTimeout(300);

  /* The index grows at 11%, the three at 14%, 8% and 20%. Every gap below is
     that arithmetic and nothing else -- and each is reached WITHOUT loading the
     file again, which is the whole point of keeping the picker alive. */
  async function gapAgainst(i) {
    /* Picking a scheme completes the upload, so the card folds away as it does
       for any other file. Reopening it is one tap and the picker is still
       populated -- which is the claim being tested: no SECOND UPLOAD. */
    await openCard('b');
    await page.locator('#cmp-scheme-list .hit').nth(i).click();
    await page.waitForTimeout(900);
    await page.click('#r-run');
    await page.waitForSelector('#r-out .result', { timeout: 20000 });
    await page.waitForTimeout(400);
    const t = await page.locator('#r-out').innerText();
    return (t.match(/([+-]?\d+\.\d) points a year/) || ['', '?'])[1];
  }
  ok('the index against Alpha at 14% is 3.0 points behind', (await gapAgainst(1)) === '-3.0');
  ok('against Beta at 8% it is 3.0 points ahead', (await gapAgainst(2)) === '+3.0');
  ok('against Gamma at 20% it is 9.0 points behind', (await gapAgainst(3)) === '-9.0');
  await openCard('b');
  ok('and switching between them needed no second upload',
     !(await page.locator('#cmp-scheme-wrap').isHidden()) &&
     (await page.locator('#cmp-scheme-list .hit').count()) === 4,
     String(await page.locator('#cmp-scheme-list .hit').count()));

  const combined = await gapAgainst(0);
  ok('all three together are a benchmark of their own',
     /All 3 together/.test(await page.locator('#r-out').innerText()), combined);
  /* Bought once and never rebalanced, so it lands ABOVE the 14.2% a basket
     re-struck at each window start would give. The label says which it is. */
  ok('and the composite lands where a basket bought once actually would',
     parseFloat(combined) < -3.2 && parseFloat(combined) > -4.5, combined + ' points');
  await openCard('b');
  ok('with the assumption it rests on stated, not implied',
     /never rebalanced/.test(await page.locator('#cmp-note').innerText()),
     (await page.locator('#cmp-note').innerText()).replace(/\n/g, ' ').slice(0, 160));

  /* And the same file at step 1's INDEX slot, which had no picker either. */
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#r-source .chip[data-source="index"]');
  await page.waitForTimeout(300);
  await page.setInputFiles('#bm-file', threeFile);
  await page.waitForTimeout(1600);
  ok('step 1’s index slot offers the picker too',
     !(await page.locator('#r-scheme-wrap').isHidden()) &&
     (await page.locator('#r-scheme-list .hit').count()) === 4,
     String(await page.locator('#r-scheme-list .hit').count()));
  await page.locator('#r-scheme-list .hit').nth(2).click();
  await page.waitForTimeout(1000);
  /* The scheme's name is on the door and in what gets measured, rather than in
     a notice below: the door names what it holds, and the run names what it
     analysed. Proving the second is the stronger claim, so that is the one
     made here. */
  ok('the door names the scheme rather than the bulk file it came out of',
     (await page.locator('#door-a').getAttribute('data-state')) === 'loaded' &&
     /Beta Fund/.test(await page.locator('#door-a-status').innerText()),
     await page.locator('#door-a-status').innerText());
  await page.click('#r-run');
  await page.waitForTimeout(1500);
  ok('and choosing one there analyses that scheme',
     /Fund or index\s*Beta Fund - Direct Growth/
       .test((await page.locator('#r-out').innerText()).replace(/\s+/g, ' ')),
     (await page.locator('#r-out').innerText()).replace(/\s+/g, ' ').slice(0, 120));

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
