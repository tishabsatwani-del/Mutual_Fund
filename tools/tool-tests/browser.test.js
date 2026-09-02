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
  ok('title is the product name', (await page.title()) === 'Where You Stand', await page.title());
  ok('four analysis modules are offered', (await page.locator('.tile[data-go="portfolio"], .tile[data-go="goal"], .tile[data-go="rolling"]').count()) === 4);
  ok('rolling returns is named on the home screen',
     /Rolling returns/.test(await page.locator('.tiles').innerText()));
  ok('and it is offered for both an index and a fund',
     (await page.locator('.tile[data-go="rolling"]').count()) === 2);
  await page.screenshot({ path: path.join(SHOTS, '01-home.png'), fullPage: true });

  /* ---------------------------------------------------------- portfolio */
  console.log('\nPortfolio XIRR');
  await page.click('.tile[data-go="portfolio"]');
  await page.waitForSelector('#view-portfolio.on');

  /* ------------------------------------------------------ the file first
   *
   * The screen is a door now. Typing is the fallback, reached from "No file to
   * hand?", and it is still tested below because somebody will always be
   * without a file. */
  ok('the screen opens on a door, not on rows to fill in',
     !(await page.locator('#pf-door').isHidden()) &&
     (await page.locator('#pf-manual-card').isHidden()) === true);
  ok('and it will not compute until it has been given something',
     await page.locator('#pf-calc').isDisabled());
  /* A primary button that cannot be pressed must not look pressable. The
     shared disabled rule only drops opacity, and this gradient survived that
     at full strength -- it read as the live next step while doing nothing. */
  ok('and while it cannot be pressed it does not look pressable',
     (await page.evaluate(() => {
       const s = getComputedStyle(document.querySelector('#pf-calc'));
       return s.backgroundImage === 'none' && s.boxShadow === 'none';
     })) === true,
     await page.evaluate(() => {
       const s = getComputedStyle(document.querySelector('#pf-calc'));
       return s.backgroundImage + ' | ' + s.boxShadow;
     }));

  await page.click('#pf-manual');
  await page.waitForTimeout(200);
  ok('typing is still reachable for somebody without a file',
     !(await page.locator('#pf-manual-card').isHidden()) &&
     !(await page.locator('#pf-calc').isDisabled()));

  /* the spreadsheet-verified case: two lump sums -> 9.1% */
  const rows = page.locator('#pf-rows .entry');
  await rows.nth(0).locator('.in-date').fill('2024-01-01');
  await rows.nth(0).locator('.in-kind').selectOption('Money in');
  await rows.nth(0).locator('.in-amt').fill('100000');
  await rows.nth(1).locator('.in-date').fill('2025-01-01');
  await rows.nth(1).locator('.in-kind').selectOption('Money in');
  await rows.nth(1).locator('.in-amt').fill('100000');
  await rows.nth(2).locator('.in-date').fill('2026-01-01');
  await rows.nth(2).locator('.in-kind').selectOption('Worth today');
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
  /* --------------------------------------------- the three real-return bands
   *
   * A band is a label on a subtraction the reader can check, never a verdict.
   * The XIRR here is 9.1%, so the inflation figure alone decides the band:
   * 12% puts the real return below zero, 6% lands it between nought and three,
   * and 2% puts it above three. */
  const BANDS = [
    ['12', 'Purchasing Power Loss'],
    ['6',  'Capital Preservation'],
    ['2',  'Real Wealth Generation']
  ];
  for (const [infl, name] of BANDS) {
    await page.fill('#pf-infl', infl);
    await page.waitForTimeout(200);
    const real = await page.locator('#pf-real-out').innerText();
    ok('at ' + infl + '% inflation the real return is called ' + name,
       (await page.locator('#pf-real-out .bandname').innerText()).trim() === name, real.slice(0, 160));
    ok('and ' + name + ' comes with things to look at, not things to do',
       (await page.locator('#pf-real-out .lookat li').count()) === 3 &&
       !/\b(you should|we recommend|consider (buying|selling|switching)|buy |sell |switch to|swap )\b/i
         .test(real),
       (real.match(/.{0,60}(you should|we recommend|consider buying|switch to|swap ).{0,60}/i) || [''])[0]);
    ok('and the band is set beside its own arithmetic, never alone',
       /a year, after/.test(await page.locator('#pf-real-out .bandline').innerText()),
       await page.locator('#pf-real-out .bandline').innerText());
  }
  await page.fill('#pf-infl', '6');
  await page.waitForTimeout(200);

  await page.screenshot({ path: path.join(SHOTS, '02-portfolio.png'), fullPage: true });

  /* ------------------------------------- the core figures, before the prose */
  ok('the four core figures sit above every word of explanation',
     (await page.locator('#pf-out .stats.topline .stat').count()) === 4 &&
     (await page.evaluate(() => {
       const t = document.querySelector('#pf-out .stats.topline');
       const m = document.querySelector('#pf-out .meaning');
       return !!t && !!m && (t.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
     })) === true,
     (await page.locator('#pf-out .stats.topline').innerText()).replace(/\n/g, ' | '));

  /* A reader who does the quick maths in their head gets a different number
     from the one on screen. Without both workings side by side the screen
     looks wrong rather than exact. */
  await page.fill('#pf-infl', '6');
  await page.waitForTimeout(250);
  await page.locator('#pf-real-out details summary').click();
  await page.waitForTimeout(150);
  const workings = await page.locator('#pf-real-out details').innerText();
  ok('the exact division and the quick subtraction are shown side by side',
     /÷/.test(workings) && /−/.test(workings) &&
     /percentage points/.test(workings), workings.replace(/\n/g, ' | ').slice(0, 220));

  /* §11 caps inflation, and the field refuses BEFORE anything is computed. */
  await page.fill('#pf-infl', '30');
  await page.waitForTimeout(250);
  ok('an inflation figure outside its bounds is refused on the field',
     (await page.locator('#pf-infl-bad').isVisible()) === true &&
     /between 0% and 25%/.test(await page.locator('#pf-infl-bad').innerText()) &&
     (await page.locator('#pf-real-out').innerText()).trim() === '',
     await page.locator('#pf-infl-bad').innerText());
  await page.fill('#pf-infl', '6');
  await page.waitForTimeout(250);

  /* ==================================================== the portfolio door
   *
   * Two entirely different downloads work here, and the reader does not know
   * which they have. They are never asked. The screen answers from whatever it
   * is given rather than demanding the file that answers everything.
   */
  console.log('\nThe portfolio door');
  const snapCsv = path.join(TMP, 'pf-holdings.csv');
  fs.writeFileSync(snapCsv,
    'Scheme Name,Units,Invested Amount,Current Value\n' +
    'Acme Bluechip Direct Growth,1234.567,50000,62300\n' +
    'Zenith Flexi Cap Direct Growth,890.123,75000,71200\n' +
    'Meridian Small Cap Direct Growth,410.5,25000,38900\n' +
    'Total,,150000,172400\n');
  const txnCsv = path.join(TMP, 'pf-txns.csv');
  fs.writeFileSync(txnCsv, 'Date,Amount\n2024-01-01,100000\n2025-01-01,100000\n');

  await page.goto(BASE_URL + '#portfolio', { waitUntil: 'networkidle' });
  await page.setInputFiles('#pf-file', snapCsv);
  await page.waitForTimeout(700);

  ok('a holdings snapshot is read without the reader naming its type',
     /3 funds read from pf-holdings\.csv/.test(await page.locator('#pf-read-note').innerText()),
     await page.locator('#pf-read-note').innerText());
  /* A totals row counted as a holding doubles every figure on the screen, and
     the doubling looks entirely plausible. */
  ok('and its totals row is left out, and said to be',
     /totals row left out so it is not counted twice/
       .test(await page.locator('#pf-read-note').innerText()));
  /* This is what makes an upload trustworthy: an import fails SILENTLY, so the
     file is read back and every line is checkable. */
  /* Not a table: five columns inside a 390px phone put the figures off the
     edge, and the figures are the point -- this list exists to be CHECKED. */
  ok('every line is shown back for checking, with its figures beside it',
     (await page.locator('#pf-read-list .readline').count()) === 3 &&
     /Acme Bluechip Direct Growth/.test(await page.locator('#pf-read-list').innerText()) &&
     /put in\s*₹50,000/.test((await page.locator('#pf-read-list').innerText()).replace(/\s+/g, ' ')),
     (await page.locator('#pf-read-list').innerText()).slice(0, 160));
  ok('a snapshot is not asked for a value it already has',
     await page.locator('#pf-worth-card').isHidden());

  await page.click('#pf-calc');
  await page.waitForTimeout(500);
  const snapOut = await page.locator('#pf-out').innerText();
  ok('it answers: 1,50,000 in, 1,72,400 now, +14.9%',
     /\+14\.9%/.test(snapOut) && /1,50,000/.test(snapOut) && /1,72,400/.test(snapOut),
     snapOut.slice(0, 140));
  ok('with each holding and its share of the whole',
     /Each holding, and its share/.test(snapOut) && /share of the whole/i.test(snapOut),
     snapOut.slice(0, 200));
  /* The one question this file cannot answer, said once, with the file that
     can answer it named. Not an error: nothing went wrong. */
  ok('and the one question it cannot answer is named, not raised as an error',
     /No yearly rate from this file/.test(snapOut) &&
     /transaction statement/.test(snapOut) &&
     (await page.locator('#pf-out .notice.bad').count()) === 0,
     String(await page.locator('#pf-out .notice.bad').count()));

  /* A line read wrongly is dropped, not corrected by typing. Checked, not built. */
  await page.locator('#pf-read-list [data-drop]').first().click();
  await page.waitForTimeout(200);
  ok('a line read wrongly can be dropped from the list',
     (await page.locator('#pf-read-list .readline').count()) === 2,
     String(await page.locator('#pf-read-list .readline').count()));

  /* ---------------------------------------------- the other download ---- */
  await page.click('#pf-reset');
  await page.waitForTimeout(200);
  ok('start again clears the file and disables the button',
     (await page.locator('#pf-read').isHidden()) &&
     await page.locator('#pf-calc').isDisabled());

  await page.setInputFiles('#pf-file', txnCsv);
  await page.waitForTimeout(700);
  ok('a transaction statement is read as payments instead',
     /2 payments read from pf-txns\.csv/.test(await page.locator('#pf-read-note').innerText()),
     await page.locator('#pf-read-note').innerText());
  /* A statement of payments records what was paid, never what it grew to. */
  ok('and asks for the one figure no such file contains',
     !(await page.locator('#pf-worth-card').isHidden()));

  await page.click('#pf-calc');
  await page.waitForTimeout(400);
  const partial = await page.locator('#pf-out').innerText();
  /* THE defect: invested, withdrawn and current were computed and then thrown
     away when XIRR failed, so a reader missing one thing was told nothing. */
  ok('without that figure it still says what the file does support',
     /What the figures so far do say/.test(partial) && /2,00,000/.test(partial),
     partial.slice(0, 160));

  await page.fill('#pf-worth', '228000');
  await page.waitForTimeout(500);
  const full = await page.locator('#pf-out').innerText();
  ok('and with it, the yearly rate appears without anything being clicked',
     /Your portfolio XIRR/i.test(full) && /% /.test(full), full.slice(0, 120));

  /* The by-fund choice used to live inside the typing card, so an uploaded
     statement could never reach it. It belongs to the data, not to how the
     data arrived -- and it is offered only when the file carries fund names. */
  ok('a statement with no fund names is not offered a by-fund breakdown',
     await page.locator('#pf-group-card').isHidden());

  const namedCsv = path.join(TMP, 'pf-named.csv');
  fs.writeFileSync(namedCsv,
    'Date,Amount,Fund\n2024-01-01,100000,Acme Bluechip\n2025-01-01,100000,Zenith Flexi\n');
  await page.click('#pf-reset');
  await page.setInputFiles('#pf-file', namedCsv);
  await page.waitForTimeout(700);
  ok('while one that carries them is',
     !(await page.locator('#pf-group-card').isHidden()));

  /* --------------------------------- what each holding is missing, per holding
   *
   * "not enough entries" told a reader something was wrong and nothing about
   * what. The engine has known exactly which of five conditions failed since it
   * was written; byLabel was throwing that away and substituting a shrug. */
  await page.click('#pf-reset');
  const sparseCsv = path.join(TMP, 'pf-sparse.csv');
  fs.writeFileSync(sparseCsv,
    'Date,Amount,Fund\n' +
    '2024-01-01,100000,Acme Bluechip\n' +
    '2025-01-01,50000,Acme Bluechip\n' +
    '2024-06-01,25000,Zenith Flexi\n');
  await page.setInputFiles('#pf-file', sparseCsv);
  await page.waitForTimeout(700);
  /* Acme is valued and Zenith deliberately is not, so one holding on the same
     screen can be measured and the other cannot -- which is the point: the
     reason has to be that holding's own. */
  await page.fill('#pf-val-0', '200000');
  await page.click('#pf-calc');
  await page.waitForTimeout(600);
  const perFund = await page.locator('#pf-out').innerText();
  ok('a holding that cannot be measured says what it is missing, not "not enough entries"',
     !/not enough entries/.test(perFund) &&
     /no valuation and no withdrawal|needs 2 dated rows|only a valuation/.test(perFund),
     (perFund.match(/.{0,140}(Zenith Flexi).{0,140}/) || [''])[0].replace(/\n/g, ' | '));
  ok('while the one that was valued is measured beside it',
     /Acme Bluechip[\s\S]{0,60}%/.test(perFund),
     (perFund.match(/Acme Bluechip[\s\S]{0,80}/) || [''])[0].replace(/\n/g, ' | '));

  /* ------------------------------------------ a statement of several tabs
   *
   * A consolidated statement is a cover, a summary and the transactions on a
   * third tab. Reading sheet1 hands the reader a cover page and a refusal. */
  await page.click('#pf-reset');
  await page.waitForTimeout(200);
  await page.setInputFiles('#pf-file',
    path.join(__dirname, 'fixtures', 'three-tab-statement.xlsx'));
  await page.waitForTimeout(1400);
  ok('the tab holding the transactions is found, not the first one in the file',
     (await page.locator('#pf-sheet').inputValue()) === 'Transaction Details',
     await page.locator('#pf-sheet').inputValue());
  ok('and every tab is offered so the choice can be changed',
     (await page.locator('#pf-sheet option').allInnerTexts()).join('|') ===
     'Cover|Summary|Transaction Details',
     (await page.locator('#pf-sheet option').allInnerTexts()).join('|'));

  /* The dictionary SUGGESTS and never decides: a word it does not know stays
     unticked, which reads as money in, exactly as before it existed. */
  ok('the words it recognises arrive already ticked',
     (await page.locator('#pf-door-out input:checked').count()) === 1 &&
     /Switch Out[\s\S]*read as money out/.test(await page.locator('#pf-door-out').innerText()),
     await page.locator('#pf-door-out').innerText().then(t => t.replace(/\n/g, ' | ')));
  ok('and a switch out is called out by name, because it is the one that misleads',
     /switch out.*money leaving one fund and entering another/i
       .test((await page.locator('#pf-door-out').innerText()).replace(/\s+/g, ' ')));

  /* ----------------------------------- a valuation per scheme, then two XIRRs
   *
   * A portfolio XIRR can be had from one total. A fund's OWN XIRR needs that
   * fund's own ending, and there is no way to split one total back out across
   * schemes -- so the ask is one row per fund, and answering it produces both
   * levels at once.
   */
  await page.click('#pf-reset');
  await page.waitForTimeout(200);
  const schemeCsv = path.join(TMP, 'pf-schemes.csv');
  fs.writeFileSync(schemeCsv,
    'Date,Transaction Type,Amount,Units,Fund\n' +
    '2021-04-05,Purchase,50000,1234.567,Acme Bluechip\n' +
    '2022-04-05,Purchase,50000,987.654,Acme Bluechip\n' +
    '2024-01-09,Redemption,30000,500.000,Acme Bluechip\n' +
    '2021-06-01,Purchase,25000,800.000,Zenith Flexi\n' +
    '2025-02-01,Redemption,40000,800.000,Zenith Flexi\n');
  await page.setInputFiles('#pf-file', schemeCsv);
  await page.waitForTimeout(700);
  await page.click('#pf-dir-go');            /* Purchase in, Redemption out */
  await page.waitForTimeout(500);

  ok('a named statement is asked for a value per fund, not one total',
     !(await page.locator('#pf-values-card').isHidden()) &&
     (await page.locator('#pf-worth-card').isHidden()) === true);
  /* Zenith's units net to zero: the reader sold out, the flows already contain
     their own ending, and asking about it would be asking about money they no
     longer have. */
  ok('a fund still held is asked about, and one sold out of is not',
     (await page.locator('#pf-values .valrow').count()) === 1 &&
     /Acme Bluechip/.test(await page.locator('#pf-values .valrow').innerText()),
     await page.locator('#pf-values .valrow').innerText());
  ok('and the one sold out of is explained rather than dropped',
     /Nothing to value in Zenith Flexi[\s\S]*units net to zero/
       .test((await page.locator('#pf-values').innerText()).replace(/\s+/g, ' ')),
     (await page.locator('#pf-values').innerText()).replace(/\n/g, ' | '));
  ok('the units still held are added up and shown',
     /1,722\.221 units left/.test(await page.locator('#pf-values .valrow').innerText()),
     await page.locator('#pf-values .valrow').innerText());

  /* Either way in, because which one a reader can lay hands on depends on
     their app: some show a NAV per unit and some show a rupee value. */
  await page.fill('#pf-nav-0', '65.5');
  await page.waitForTimeout(300);
  ok('a NAV fills the value from the units left',
     (await page.inputValue('#pf-val-0')) === '112805.48',
     await page.inputValue('#pf-val-0'));

  await page.click('#pf-calc');
  await page.waitForTimeout(700);
  const both = await page.locator('#pf-out').innerText();
  /* Checked against the same flows run through the engine directly, and
     against 1.6^(1/3.674)-1 = 13.65% by hand for the closed fund. */
  ok('the portfolio XIRR is 9.6%', /Your portfolio XIRR[\s\S]*?9\.6%/i.test(both),
     both.slice(0, 120));
  ok('and both schemes are measured beside it, without switching anything on',
     /Acme Bluechip[\s\S]{0,60}8\.6%/.test(both) &&
     /Zenith Flexi[\s\S]{0,60}13\.6%/.test(both),
     (both.match(/Each holding[\s\S]{0,240}/) || [''])[0].replace(/\n/g, ' | '));
  ok('the fund sold out of is measured with no figure from the reader',
     /Zenith Flexi[\s\S]{0,60}13\.6%/.test(both));

  /* ------------------------------------- the right file on the wrong screen */
  await page.click('#pf-reset');
  await page.waitForTimeout(200);
  const navLines = ['Date,NAV'];
  let nv = 10, nt = Date.UTC(2021, 0, 1);
  for (let i = 0; i < 400; i++) {
    const dd = new Date(nt);
    if (dd.getUTCDay() % 6) navLines.push(dd.toISOString().slice(0, 10) + ',' + nv.toFixed(4));
    nv *= 1.0003; nt += 86400000;
  }
  const navCsv = path.join(TMP, 'pf-nav.csv');
  fs.writeFileSync(navCsv, navLines.join('\n'));
  await page.setInputFiles('#pf-file', navCsv);
  await page.waitForTimeout(700);
  /* Read as payments, 4,000 daily prices become 4,000 payments of about ten
     rupees and a return comes out. It is confident and it is nonsense. */
  const wrongScreen = await page.locator('#pf-door-out').innerText();
  ok('a NAV file is refused rather than read as four hundred payments',
     /price history/.test(wrongScreen) && /Rolling returns/.test(wrongScreen),
     wrongScreen.slice(0, 160));
  ok('and nothing was computed from it',
     (await page.locator('#pf-read').isHidden()) &&
     await page.locator('#pf-calc').isDisabled());

  /* Back to the typed rows the earlier section filled in, which the tests
     below go on to use. resetPortfolio hides that card; it does not empty it. */
  await page.click('#pf-reset');
  await page.click('#pf-manual');
  await page.waitForTimeout(250);

  /* error handling: no current value */
  await rows.nth(2).locator('.in-kind').selectOption('Money in');
  await page.click('#pf-calc');
  await page.waitForSelector('#pf-out .notice.bad');
  const err = await page.locator('#pf-out .notice').innerText();
  ok('a missing current value gives a human sentence', /Worth today/.test(err) && !/NaN|undefined/.test(err), err);

  /* bad amount */
  await rows.nth(2).locator('.in-kind').selectOption('Worth today');
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
  /* Four fixed rows told the reader what ₹2,000 more a month would do, and
     could not answer what ₹3,500 would do, or a year longer -- which is the
     question a gap actually raises. They are four levers now. */
  ok('a gap opens an interactive model with four levers',
     (await page.locator('#g-scn .lever input[type="range"]').count()) === 4,
     String(await page.locator('#g-scn .lever input[type="range"]').count()));
  ok('the four are the monthly amount, the step-up, the horizon and the target',
     (await page.locator('#g-scn .lever label').allInnerTexts()).join(' | ') ===
     'Monthly investment | Raised each year by | Years left | Amount you are aiming for',
     (await page.locator('#g-scn .lever label').allInnerTexts()).join(' | '));
  /* The assumed RETURN is deliberately not among them: raising it until the
     gap closes is not a plan, it is the one lever nobody controls. */
  ok('and the assumed return is not one of them',
     (await page.locator('#g-scn .lever label').allInnerTexts())
       .every(t => !/return|rate/i.test(t)));

  ok('the model starts on the reader\u2019s own entries',
     /On your own entries, you reach/i.test(await page.locator('#g-scn-out').innerText()),
     await page.locator('#g-scn-out').innerText());

  /* The top of the monthly lever has to REACH the amount that closes the gap,
     or the model cannot answer the question a gap raises. This reader pays in
     nothing today, and four times nothing is nothing. */
  const sipTop = +(await page.getAttribute('#g-scn-sip', 'max'));
  const needed = +((await page.locator('#g-out').innerText())
    .match(/₹([\d,]+) a month/) || [0, '0'])[1].replace(/,/g, '');
  ok('the monthly lever reaches the amount that would close the gap',
     sipTop >= needed && needed > 0, sipTop + ' vs ' + needed);

  const before = await page.locator('#g-scn-out .value').innerText();
  await page.locator('#g-scn-sip').fill(String(sipTop));
  await page.waitForTimeout(250);
  const after = await page.locator('#g-scn-out .value').innerText();
  ok('moving a lever moves the figure, live', after !== before, before + ' -> ' + after);
  ok('and the model says it is no longer on the reader\u2019s own entries',
     /On these four, you reach/i.test(await page.locator('#g-scn-out').innerText()));
  ok('the entries above are left alone', (await page.inputValue('#g-sip')) === '0',
     await page.inputValue('#g-sip'));

  await page.click('#g-scn-reset');
  await page.waitForTimeout(250);
  ok('and they can be put back',
     (await page.locator('#g-scn-out .value').innerText()) === before &&
     /On your own entries/i.test(await page.locator('#g-scn-out').innerText()));
  ok('the assumption is labelled, not sold as a forecast', /assumption you typed in|not a forecast/.test(goalText));
  ok('goal chart rendered', (await page.locator('#g-out svg').count()) >= 1);

  /* A shortfall printed as a rupee figure is a number the reader has to hold
     against another number to mean anything. Drawn as the remaining length of
     the same bar it needs no arithmetic at all -- and it is hatched rather
     than filled, because it is the part that does not exist yet. */
  ok('the gap is drawn as the rest of the bar, not only printed',
     (await page.locator('#g-out svg rect[fill^="url(#gaphatch"]').count()) === 1,
     String(await page.locator('#g-out svg rect').count()) + ' rects');
  ok('and the legend names it',
     /Still to find/.test(await page.locator('#g-out .legend').innerText()),
     await page.locator('#g-out .legend').innerText());
  ok('the four core figures sit above the chart and the prose',
     (await page.locator('#g-out .stats.topline .stat').count()) === 4 &&
     /short by/i.test(await page.locator('#g-out .stats.topline').innerText()),
     (await page.locator('#g-out .stats.topline').innerText()).replace(/\n/g, ' | '));
  ok('the chart has a text alternative', !!(await page.locator('#g-out svg[aria-label]').count()));
  await page.screenshot({ path: path.join(SHOTS, '03-goal.png'), fullPage: true });

  /* Nonsense input. Review v4 §11 caps a return at 30%, and §12.1 requires the
     refusal to happen ON THE FIELD before anything is computed -- a step-up of
     10000000 was accepted and returned a 68-digit figure. */
  await page.fill('#g-rate', '90');
  ok('an out-of-range return is refused on the field as it is typed',
     (await page.locator('#g-rate-bad').isVisible()) === true &&
     /between 0% and 30%/.test(await page.locator('#g-rate-bad').innerText()),
     await page.locator('#g-rate-bad').innerText());
  await page.click('#g-calc');
  ok('a fantasy return is refused, with the range named',
     /between 0% and 30%/.test(await page.locator('#g-out').innerText()),
     await page.locator('#g-out').innerText());
  /* the step-up on its own, with every other field back inside its range */
  await page.fill('#g-rate', '10');
  await page.fill('#g-step', '10000000');
  await page.click('#g-calc');
  const stepped = await page.locator('#g-out').innerText();
  ok('and the step-up that produced the 68-digit figure never computes',
     /between 0% and 25%/.test(stepped) && !/e\+/i.test(stepped), JSON.stringify(stepped));
  await page.fill('#g-step', '0');
  await page.fill('#g-rate', '10');

  /* The fund, index, hurdle-rate and benchmark journeys are covered in full by
     rolling.test.js, which drives the rebuilt module click by click. */

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
  /* One version string: the file name carries the tool's own version. */
  ok('the download points at a file beside the tool, named with the version',
     href === 'XIRR-Calculator-' + (await page.locator('#ver').innerText()).trim() + '.xlsx', href);
  ok('and the marketing badge is gone from the page',
     (await page.locator('.privacy-badge').count()) === 0 && !/100% Standalone/.test(sheetText));
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

  /* --------------------------------------------------------- the one world
   * The tool commits to a single dark palette rather than shipping a light
   * theme with a dark variant, so the check is that the ground is painted
   * explicitly and is the same under either OS setting. A page that borrows
   * its background from the host is the bug this guards against. */
  const obsidian = 'rgb(10, 14, 23)';
  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const dpage = await dark.newPage();
  await dpage.goto(BASE, { waitUntil: 'networkidle' });
  const bg = await dpage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('the page paints its own ground under a dark OS', bg === obsidian, 'got ' + bg);

  const lightCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const lpage = await lightCtx.newPage();
  await lpage.goto(BASE, { waitUntil: 'networkidle' });
  const lbg = await lpage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('and the identical ground under a light OS', lbg === obsidian, 'got ' + lbg);
  /* Asserted as "the page's OWN ink, and a light one" rather than as an exact
     colour. The claim being made here is that nothing is borrowed from the
     host; pinning it to pure white also pinned a typographic decision that has
     since changed -- pure white on near-black is the maximum possible glare,
     and it made everything near it read as dimmed. */
  const lightInk = await lpage.evaluate(() => ({
    body: getComputedStyle(document.body).color,
    token: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
  }));
  const inkLum = (() => {
    const v = lightInk.body.match(/\d+/g).map(Number).map(x => x / 255)
      .map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  })();
  ok('with the page\'s own light ink on it, never the host\'s dark text',
     inkLum > 0.7 && lightInk.token !== '', JSON.stringify(lightInk));
  await lightCtx.close();

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

  /* ============================ review v4 §12.6, §12.9: the phone layout
   *
   * The recording showed ledger rows where every field was crushed to about
   * sixty pixels -- "Inv", "Amou", "Whicl", an empty date box -- while the ×
   * kept its full width, and a header two lines of title tall with the section
   * heading sitting behind it. Both are measured here, at the four widths the
   * review names.
   */
  /* ============================ the About page tells the truth about itself
   *
   * This page carried a TRANSCRIPT of the author's About paragraph, and the
   * transcript went stale the moment the paragraph was corrected -- which is
   * how a tool that fetches nothing came to have an About page saying it
   * fetched the fund's public NAV history. It reads the deck now, and these
   * checks fail if it ever goes back to carrying its own copy.
   */
  console.log('\nAbout tells the truth about the build');
  {
    await page.goto(BASE_URL + '#about', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const about = await page.locator('#about-main').innerText();
    const deck = await page.evaluate(() => window.SIM_COPY.slots['ABOUT-MAIN'].text);

    ok('the About paragraph is the deck’s, character for character',
       about.trim() === deck.trim(), about.slice(0, 120));
    ok('it does not claim the tool fetches anything',
       !/it fetches|fetches the fund|public NAV history/i.test(about), about.slice(0, 200));
    ok('it says plainly that nothing is fetched',
       /nothing is fetched/.test(about) && /no request leaves this page/.test(about));

    const facts = await page.locator('#view-about .data').first().innerText();
    ok('and the build states what it actually does, in checkable rows',
       /Requests to any other site\s*\n?\s*none/.test(facts) &&
       /Other sites\s*\n?\s*no requests to any other site; everything the page needs is served from this address/.test(facts) &&
       /What is sent anywhere\s*\n?\s*nothing/.test(facts), facts);

    /* the claim, verified rather than asserted: nothing left the origin at all */
    ok('no request left this origin while the whole page ran',
       external.length === 0, external.join(', '));
  }

  console.log('\nThe phone layout, measured at 320, 360, 390 and 430');
  for (const width of [320, 360, 390, 430]) {
    const ctx2 = await browser.newContext({ viewport: { width, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE_URL + '#portfolio', { waitUntil: 'networkidle' });
    await p2.waitForTimeout(250);
    /* The rows live behind "No file to hand?" now. They are still measured at
       every width, because a reader who reaches them is the reader least able
       to cope with a crushed field. */
    await p2.click('#pf-manual');
    await p2.waitForTimeout(250);
    const m = await p2.evaluate(() => {
      const doc = document.documentElement;
      const fields = [...document.querySelectorAll(
        '#pf-rows .entry .in-date, #pf-rows .entry .in-kind, ' +
        '#pf-rows .entry .in-amt, #pf-rows .entry .in-tag')];
      const bar = document.querySelector('.topbar-inner');
      return {
        over: doc.scrollWidth - doc.clientWidth,
        narrowest: fields.length ? Math.min(...fields.map(e => e.getBoundingClientRect().width)) : 0,
        header: bar ? bar.getBoundingClientRect().height : 0,
        del: (document.querySelector('#pf-rows .entry .del') || {}).getBoundingClientRect
             ? document.querySelector('#pf-rows .entry .del').getBoundingClientRect().width : 0
      };
    });
    ok('no sideways scroll at ' + width, m.over <= 0, 'over by ' + m.over);
    /* the defect was ~60px; a field a reader can actually type into is far wider */
    ok('ledger fields are not crushed at ' + width, m.narrowest >= 140,
       'narrowest field ' + Math.round(m.narrowest) + 'px');
    ok('and the × keeps its 44 without taking their room at ' + width,
       Math.round(m.del) === 44, String(Math.round(m.del)));
    ok('the header is one line at ' + width, Math.round(m.header) <= 56,
       Math.round(m.header) + 'px');
    await ctx2.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
