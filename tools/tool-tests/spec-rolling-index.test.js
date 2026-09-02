/* The Rolling Returns redesign specification, driven through the real screen.
 *
 * Section 7 of the specification is a five-item QA checklist. It is written
 * here as five sections of real clicks rather than as unit tests on the pure
 * functions, because every one of the five is a claim about what a READER
 * sees: a file being refused is only refused if the refusal reaches the
 * screen, and a horizon only "computes correctly" if the chip can be pressed.
 *
 * Scope, deliberately: the market-index source path and nothing else. The
 * fund path is covered by rolling.test.js and must be unchanged by any of
 * this, which the last section checks explicitly.
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
function flat(s) { return String(s).replace(/\s+/g, ' ').trim(); }

/* A clean daily price series growing at a known rate, so every figure the
   screen prints is checkable by hand rather than against the engine. */
function navFile(file, rate, fromY, toY, start = 100, head = 'Date,NAV') {
  const out = [head];
  let v = start, t = Date.UTC(fromY, 0, 1);
  while (t <= Date.UTC(toY, 0, 1)) {
    out.push(new Date(t).toISOString().slice(0, 10) + ',' + v.toFixed(4));
    v *= Math.pow(1 + rate, 1 / 365.2425); t += 86400000;
  }
  fs.writeFileSync(file, out.join('\n'));
  return file;
}

/* What a broker actually hands you. It has a date column and it has numeric
   columns, so every reader that goes by SHAPE accepts it. */
function tradebookFile(file) {
  const out = ['Symbol,ISIN,Trade Date,Exchange,Segment,Series,Trade Type,Auction,Quantity,Price,Trade ID,Order ID,Order Execution Time'];
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(2023, 0, 2 + i));
    out.push(['INFY', 'INE009A01021', d.toISOString().slice(0, 10), 'NSE', 'EQ', 'EQ',
              i % 2 ? 'sell' : 'buy', 'false', 10 + i, (1400 + i).toFixed(2),
              '10000' + i, '2300000' + i, d.toISOString()].join(','));
  }
  fs.writeFileSync(file, out.join('\n'));
  return file;
}

/* A file with the right headings and the wrong contents. */
function textValueFile(file) {
  const out = ['Date,NAV'];
  for (let i = 0; i < 60; i++) {
    out.push(new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10) + ',not available');
  }
  fs.writeFileSync(file, out.join('\n'));
  return file;
}

(async () => {
  fs.mkdirSync(TMP + '/shots', { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  /* The market-index results are tabbed on a phone: only the chosen panel is
     drawn, and innerText leaves undrawn panels out. These sections read the
     whole result as one page, so the harness un-tabs it. The tab behaviour
     itself is checked in spec-rolling-index.test.js, on a context without
     this. */
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

  const primary   = navFile(TMP + '/spec-primary.csv', 0.14, 2015, 2025, 100);
  const bench     = navFile(TMP + '/spec-bench.csv',   0.10, 2018, 2025, 1000, 'Date,Index Value');
  const benchLong = navFile(TMP + '/spec-bench-long.csv', 0.10, 2015, 2025, 1000, 'Date,Index Value');
  /* Named so the tool can read what kind of index it is out of the file. */
  const benchTRI = navFile(TMP + '/nifty-50-tri.csv', 0.10, 2015, 2025, 1000, 'Date,Index Value');
  const benchPRI = navFile(TMP + '/nifty-50-price-return-index.csv', 0.085, 2015, 2025, 1000, 'Date,Index Value');
  const long20    = navFile(TMP + '/spec-long20.csv',  0.12, 2005, 2025, 100);
  const trades    = tradebookFile(TMP + '/spec-tradebook.csv');
  const textNav   = textValueFile(TMP + '/spec-textnav.csv');

  /* A real reload every time. goto() to a URL that differs only in its hash is
     a same-document navigation: the page does not re-execute and the module's
     state survives, so one test's uploaded files leak into the next. */
  async function openIndexPath() {
    await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('#r-source .chip[data-source="index"]');
    await page.waitForTimeout(250);
  }

  /* Below 34rem the two cards live behind compact doors, and a card folds
     itself away once its file is read. Anything inspecting a card has to open
     its door first; above 34rem the doors are not drawn and this is a no-op. */
  async function openCard(which) {
    if (await page.locator('#up-doors').isHidden()) return;
    const btn = page.locator('#door-' + which);
    if ((await btn.getAttribute('aria-expanded')) !== 'true') {
      await btn.click();
      await page.waitForTimeout(220);
    }
  }

  /* ================================================== SECTION 2, THE CARDS */
  section('Section 2 — two named data doors, not one word used twice');
  await openIndexPath();

  const cardA = flat(await page.locator('#up-primary').innerText());
  /* The audit replaced the specification's card copy: a CAS is a transaction
     statement and a portfolio value series is not a price history, so the
     card asks for the one file it can use, in the single-file path's words. */
  ok('Card A carries its header',
     /^1\. The fund’s NAV history file/.test(cardA), cardA.slice(0, 80));
  ok('Card A says what may go in it',
     /NAV is the fund’s price per unit on a given day\. A file of those, day by day, is all this needs\./.test(cardA),
     cardA.slice(0, 260));
  ok('and no longer offers a CAS or a portfolio value series',
     !/Consolidated Account Statement|Portfolio Value/.test(cardA), cardA.slice(0, 200));
  ok('nor a Rule line or an Accepted columns line',
     !/Rule:/.test(cardA) && !/Accepted columns/.test(cardA), cardA.slice(0, 200));
  ok('and its file picker is labelled for the file it wants',
     /The fund’s NAV history file/.test(cardA), cardA);

  const cardB = flat(await page.locator('#up-benchmark-head').innerText());
  ok('Card B carries its header',
     /^2\. The benchmark index \(TRI\)/.test(cardB), cardB.slice(0, 80));
  ok('Card B says what may go in it',
     /The daily values of a Total Return Index — Nifty 50 TRI, Nifty Midcap 150 TRI, Sensex TRI\./.test(cardB),
     cardB);
  ok('and no Accepted columns line either', !/Accepted columns/.test(cardB), cardB.slice(0, 200));
  ok('Card B carries the TRI guidance',
     /A TRI counts dividends; a price index does not, and reads lower, so use the total return version\./.test(cardB),
     cardB);

  /* ================================== SECTION 7.1, TRADEBOOK REJECTION TEST */
  section('Section 7 · Tradebook Rejection Test');
  await page.setInputFiles('#bm-file', trades);
  await page.waitForTimeout(1200);
  /* The reason sits directly under the box that was clicked, not in a notice
     further down the page. Finding out whether a file was taken must not
     require scrolling. */
  const refusal = flat(await page.locator('#bm-status').innerText());
  ok('a tradebook at Card A is refused',
     /statement of your own payments/.test(refusal), refusal.slice(0, 200));
  ok('and the refusal names the screen the file belongs to, and the columns that gave it away',
     /Rolling returns need the fund’s price history/.test(refusal) &&
     /Check my portfolio is the screen for this file/.test(refusal) &&
     /columns found in this file/.test(refusal), refusal);
  ok('and it names the columns it actually found, so the reader can act on it',
     /Trade Type/.test(refusal) && /Quantity/.test(refusal) && /Order ID/.test(refusal),
     refusal);
  ok('the refusal is drawn in the refusing colour, not as information',
     (await page.locator('#bm-status .notice.bad').count()) === 1);
  ok('and the box itself says the file was not added',
     (await page.locator('#bm-drop.refused').count()) === 1 &&
     /Not added/.test(await page.locator('#bm-drop').innerText()),
     await page.locator('#bm-drop').innerText());
  ok('naming the file the reader chose, so there is no doubt which one',
     /spec-tradebook\.csv/.test(await page.locator('#bm-drop').innerText()),
     await page.locator('#bm-drop').innerText());
  ok('nothing was loaded, so the configurator stays shut',
     await page.locator('#r-run').isDisabled() &&
     await page.locator('#r-start').isDisabled() &&
     (await page.locator('#step-period').getAttribute('data-locked')) === 'yes');

  /* the same file at the OTHER door */
  await openIndexPath();
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(1500);
  await page.setInputFiles('#cmp-file', trades);
  await page.waitForTimeout(1200);
  const refusalB = flat(await page.locator('#cmp-status').innerText());
  ok('a tradebook at Card B is refused too',
     /statement of your own payments/.test(refusalB), refusalB.slice(0, 160));
  ok('and no benchmark was adopted from it',
     (await page.locator('#r-compare').inputValue()) === 'none',
     await page.locator('#r-compare').inputValue());

  /* ==================================== SECTION 7.2, FORMAT MISMATCH TEST */
  section('Section 7 · Format Mismatch Test');
  await openIndexPath();
  await page.setInputFiles('#bm-file', textNav);
  await page.waitForTimeout(1200);
  const mismatch = flat(await page.locator('#bm-status').innerText());
  ok('text under a NAV heading halts processing',
     /does not hold numbers/.test(mismatch), mismatch.slice(0, 200));
  ok('and it is not called a trade log, because it is not one',
     !/trade logs/.test(mismatch), mismatch.slice(0, 200));
  ok('the configurator stays shut', await page.locator('#r-run').isDisabled());

  /* ====================================== SECTION 7.3, DATE ALIGNMENT TEST */
  section('Section 7 · Date Alignment Test');
  await openIndexPath();
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(1600);
  await page.setInputFiles('#cmp-file', bench);
  await page.waitForTimeout(1600);
  const amber = flat(await page.locator('#r-overlap-note').innerText());
  ok('two files that only partly overlap raise the amber warning',
     (await page.locator('#r-overlap-note .notice.warn').count()) === 1, amber.slice(0, 200));
  ok('it states both ranges, primary first',
     /Fund: 01-Jan-2015 to 01-Jan-2025 \| Index: 01-Jan-2018 to 01-Jan-2025\./.test(amber),
     amber);
  ok('and says the comparison will be restricted to what they share',
     /Note: Rolling return comparisons will automatically be restricted to the overlapping period \(01-Jan-2018 to 01-Jan-2025, 7\.0 years\)\./.test(amber),
     amber);
  ok('and says which file lost history, and how much',
     /Outside that period, 3\.0 years of the fund data is not used\./.test(amber),
     amber);

  await page.click('#r-run');
  await page.waitForTimeout(1200);
  const summary = flat(await page.locator('#r-out .summary3').innerText());
  ok('the comparison is computed over the shared stretch only',
     /same 1,\d\d\d windows/.test(flat(await page.locator('#r-out').innerText())) ||
     /the ones whose start dates appear in both files/.test(flat(await page.locator('#r-out').innerText())),
     flat(await page.locator('#r-out').innerText()).slice(0, 400));
  /* Seven shared years, three-year windows: about four years of start dates,
     which is ~1,460 daily windows on a file with a value every day. It is the
     BOUND that matters -- the primary file alone would give ~2,560. */
  const windows = Number((summary.match(/Total Rolling Windows Analysed ([\d,]+) Observations/) || [])[1]
                          ?.replace(/,/g, ''));
  ok('so the window count is bounded by the overlap, not by the longer file',
     windows > 1300 && windows < 1600, String(windows));

  /* two files that share nothing at all */
  await openIndexPath();
  await page.setInputFiles('#bm-file', navFile(TMP + '/spec-early.csv', 0.1, 1998, 2006, 100));
  await page.waitForTimeout(1500);
  await page.setInputFiles('#cmp-file', bench);
  await page.waitForTimeout(1500);
  ok('and files that share no dates at all are refused, not warned',
     (await page.locator('#r-overlap-note .notice.bad').count()) === 1 &&
     /share no dates/.test(flat(await page.locator('#r-overlap-note').innerText())),
     flat(await page.locator('#r-overlap-note').innerText()).slice(0, 200));

  /* ==================================== SECTION 7.4, EXTENDED HORIZON TEST */
  section('Section 7 · Extended Horizon Test');
  await openIndexPath();
  await page.setInputFiles('#bm-file', long20);
  await page.waitForTimeout(1800);
  const chips = await page.locator('#r-years .chip').allInnerTexts();
  ok('the five fixed horizons are all offered and none is disabled on 20 years',
     chips.slice(0, 5).join('|') === '1 year|3 years|5 years|7 years|10 years', chips.join('|'));
  ok('and a Max History horizon is offered beyond them',
     /^Max History — 20 years$/.test(chips[5] || ''), chips.join('|'));

  for (const [label, years] of [['7 years', 7], ['10 years', 10], ['Max History — 20 years', 20]]) {
    await page.locator('#r-years .chip', { hasText: label }).first().click();
    await page.waitForTimeout(300);
    await page.click('#r-run');
    await page.waitForTimeout(1400);
    const out = flat(await page.locator('#r-out').innerText());
    ok(years + '-year windows compute on a 20-year file',
       new RegExp('Each holding period ' + years + ' years').test(out), out.slice(0, 300));
    /* 12% a year, compounded daily, over any window: the answer is 12.0%. */
    ok('and a 12% series returns 12% over ' + years + ' years, whatever the horizon',
       /Median 12\.0%/.test(out) || /Median Rolling Return 12\.0%/.test(out),
       (out.match(/Median[^|]{0,30}/) || [''])[0]);
  }

  /* ---------------------------------------------------- section 4, frequency */
  section('Section 4 · rolling frequency thins start dates and nothing else');
  const freq = await page.locator('#r-freq .chip').allInnerTexts();
  ok('all three frequencies are offered, in the specification’s order',
     freq.join('|') === 'Daily (every start date)|Weekly (7 days)|Monthly (1 calendar month)',
     freq.join('|'));
  ok('and daily is the one chosen to begin with',
     (await page.locator('#r-freq .chip[aria-checked="true"]').innerText())
       .indexOf('Daily') === 0);

  await page.locator('#r-years .chip[data-years=\"5\"]').click();
  await page.waitForTimeout(250);
  await page.click('#r-run');
  await page.waitForTimeout(1400);
  function windowsFrom(text) {
    return Number((text.match(/Total Rolling Windows Analysed ([\d,]+) Observations/) || [])[1]
                  ?.replace(/,/g, ''));
  }
  const daily = windowsFrom(flat(await page.locator('#r-out').innerText()));
  await page.locator('#r-freq .chip', { hasText: 'Weekly' }).click();
  await page.waitForTimeout(1400);
  const weekly = windowsFrom(flat(await page.locator('#r-out').innerText()));
  await page.locator('#r-freq .chip', { hasText: 'Monthly' }).click();
  await page.waitForTimeout(1400);
  const monthlyText = flat(await page.locator('#r-out').innerText());
  const monthly = windowsFrom(monthlyText);
  ok('weekly takes about a seventh of the daily start dates',
     Math.abs(weekly - daily / 7) < daily * 0.02, daily + ' -> ' + weekly);
  ok('monthly takes about a thirtieth',
     Math.abs(monthly - daily / 30.44) < daily * 0.02, daily + ' -> ' + monthly);
  ok('and every one of the three still measures a 12% series at 12% a year',
     /Median Rolling Return 12\.0%/.test(monthlyText),
     (monthlyText.match(/Median Rolling Return [^ ]+/) || [''])[0]);
  ok('the table says which start dates it used',
     /monthly start dates/.test(monthlyText), (monthlyText.match(/start dates[^.]{0,40}/) || [''])[0]);

  /* ============================================ SECTION 5, THE TABLE AND FIVE */
  section('Section 5 · the statistical summary and the five insights');
  await openIndexPath();
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(1600);
  await page.setInputFiles('#cmp-file', benchLong);
  await page.waitForTimeout(1600);
  await page.locator('#r-years .chip[data-years=\"3\"]').click();
  await page.waitForTimeout(250);
  await page.click('#r-run');
  await page.waitForTimeout(1600);
  const out = flat(await page.locator('#r-out').innerText());

  /* Compared case-insensitively: the stylesheet renders table headings in
     capitals, and allInnerTexts reports what is rendered. The words are what
     the specification names, not their casing. */
  const heads = await page.locator('#r-out .summary3 thead th').allInnerTexts();
  ok('the table has the three columns the specification names',
     heads.join('|').toLowerCase() === 'performance metric|primary investment|benchmark index',
     heads.join('|'));
  const metrics = await page.locator('#r-out .summary3 tbody td:first-child').allInnerTexts();
  /* The specification's eight rows, then the two ratio rows the September
     review added to this table (item 3). */
  /* Eight rows. The Sharpe and Sortino rows are gone (their denominator was
     the spread of window returns, not the asset's volatility, so they were
     not Sharpe ratios), and the spread row is named as the spread. */
  ok('and the eight rows, in the specification’s order, with the spread named as the spread',
     metrics.join('|') === [
       'Total Rolling Windows Analysed', 'Average Rolling Return (Mean)', 'Median Rolling Return',
       'Maximum Return (Best Window)', 'Minimum Return (Worst Window)',
       'Spread of window returns (std dev)', 'Negative Return Frequency (Historical)',
       'Outperformance Rate vs Benchmark'].join('|'),
     metrics.join('|'));
  ok('and no row is called Sharpe or Sortino', !/Sharpe|Sortino/.test(metrics.join('|')));
  ok('windows are counted as Observations',
     /Total Rolling Windows Analysed [\d,]+ Observations [\d,]+ Observations/.test(out), out.slice(0, 400));
  /* 14% and 10%, compounded daily, over every window. Both columns are known. */
  ok('the primary column reads 14.0% and the benchmark 10.0%',
     /Average Rolling Return \(Mean\) 14\.0% 10\.0%/.test(out),
     (out.match(/Average Rolling Return \(Mean\)[^A-Z]{0,30}/) || [''])[0]);
  ok('a constant-growth series has no spread between its windows',
     /Spread of window returns \(std dev\) 0\.0% 0\.0%/.test(out),
     (out.match(/Spread of window returns[^A-Z]{0,40}/) || [''])[0]);
  ok('nothing ended below zero, and it is counted in windows',
     /Negative Return Frequency \(Historical\) 0\.0% \(0 Windows\) 0\.0% \(0 Windows\)/.test(out),
     (out.match(/Negative Return Frequency[^A-Z()]{0,60}/) || [''])[0]);
  ok('14% beats 10% in every single window',
     /Outperformance Rate vs Benchmark 100\.0% of total windows N\/A/.test(out),
     (out.match(/Outperformance Rate vs Benchmark[^A-Z]{0,50}/) || [''])[0]);

  /* The Factual Data Insights card is gone: its five statements repeated the
     three-rates card and the four-measurements card, in a register the tool
     does not use anywhere else. Each figure has one home per tab now. */
  ok('there is no Factual Data Insights card',
     (await page.locator('#r-out ol.insights:not(.reflectlist)').count()) === 0 &&
     !/Factual Data Insights|Alpha Spread|Downside Resilience|Central Tendency/.test(out),
     (out.match(/.{0,40}(Factual Data Insights|Alpha Spread).{0,40}/) || [''])[0]);
  ok('nor a Dataset Scope Note or a Data Standard Note',
     !/Dataset Scope Note|Data Standard Note/.test(out));
  ok('and the outperformance figure appears once on the comparison tab, not five times',
     (out.match(/100\.0% of total windows/g) || []).length === 1,
     String((out.match(/100\.0% of total windows/g) || []).length));

  /* and with no benchmark at all, the table still stands and says why */
  await openIndexPath();
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(1600);
  await page.click('#r-run');
  await page.waitForTimeout(1400);
  const alone = flat(await page.locator('#r-out').innerText());
  ok('with no benchmark the table still reports the primary investment',
     /Average Rolling Return \(Mean\) 14\.0%/.test(alone), alone.slice(0, 300));
  ok('and says plainly that the second column cannot be filled in',
     /No benchmark index data loaded/.test(alone), alone.slice(0, 400));
  ok('the outperformance row does not invent a rate',
     /Outperformance Rate vs Benchmark Not measurable without a benchmark/.test(alone),
     (alone.match(/Outperformance Rate vs Benchmark[^A-Z]{0,60}/) || [''])[0]);
  ok('and no insights card appears in their place either',
     (await page.locator('#r-out ol.insights:not(.reflectlist)').count()) === 0);

  /* ============================== SECTION 7.5, NEUTRALITY VERIFICATION */
  section('Section 7 · Neutrality Verification');
  await openIndexPath();
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(1600);
  await page.setInputFiles('#cmp-file', benchLong);
  await page.waitForTimeout(1600);
  await page.click('#r-run');
  await page.waitForTimeout(1600);
  /* Read with both cards opened as well as shut: the approved wording has to
     survive being reached the long way round. */
  const shut = flat(await page.locator('#view-rolling').innerText());
  await openCard('a');
  const withA = flat(await page.locator('#view-rolling').innerText());
  await openCard('b');
  const screen = shut + ' ' + withA + ' ' + flat(await page.locator('#view-rolling').innerText());

  /* Section 6's prohibited column, and the advisory phrases section 7 names. */
  const banned = [
    'Success Rate', 'Winning Percentage', 'Max Loss', 'Danger Level',
    'Investment Advice', 'Find Best Funds', 'Evaluate Portfolio',
    'Must Buy', 'Underperforming Asset', 'ZeroDha File'
  ];
  banned.forEach(phrase => {
    ok('the screen never says “' + phrase + '”',
       !new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(screen),
       (screen.match(new RegExp('.{0,50}' + phrase + '.{0,50}', 'i')) || [''])[0]);
  });
  /* Not a ban on the WORD. The screen says "Nothing on this card is a
     recommendation to buy, hold, sell or switch", which is the disclaimer
     itself, and it labels daily rolling as Recommended, which is a statement
     about method and not about money. What section 7 forbids is the screen
     telling a reader what to do with an investment, so that is what is
     tested: an advisory sentence, not a substring. */
  const advisory = [
    /\byou should (buy|sell|hold|switch|invest|avoid)\b/i,
    /\bwe recommend\b/i,
    /\brecommended (fund|scheme|investment|holding|allocation)\b/i,
    /\b(best|top|worst) (fund|scheme)s?\b/i,
    /\b(consider|try) (buying|selling|switching|adding)\b/i,
    /\b(strong|weak) (buy|sell)\b/i,
    /\bthis fund is (good|bad|safe|risky)\b/i
  ];
  advisory.forEach(re => {
    ok('the screen never advises: ' + re.source, !re.test(screen),
       (screen.match(new RegExp('.{0,60}' + re.source + '.{0,60}', 'i')) || [''])[0]);
  });
  ok('and it says outright that it recommends nothing',
     /Nothing here is a recommendation to buy, hold, sell or switch/.test(screen),
     'the disclaimer is missing');

  /* Section 6's approved column, each one actually on the screen. */
  [['The fund’s NAV history file',   'Card A header'],
   ['The benchmark index (TRI)',     'Card B header'],
   ['Outperformance Frequency (%)',  'the outperformance metric'],
   ['Minimum Rolling Return',        'the downside metric'],
   ['Calculate Rolling Returns',     'the call to action']
  ].forEach(([phrase, what]) => {
    ok(what + ' uses the approved wording', screen.indexOf(phrase) !== -1,
       phrase + ' not found');
  });

  /* ============================ WHAT THE SPEC MAPPING FOUND AFTERWARDS */
  section('Both datasets load in step 1, in either order');
  await openIndexPath();
  /* Section 2 puts both files in step 1. Card B sits inside step 4, which is
     gated on a primary series -- so a reader holding both files could not
     load the benchmark first, and clicking it did nothing and said nothing. */
  ok('the benchmark file chooser is usable before any primary file',
     !(await page.locator('#cmp-pick').isDisabled()) &&
     !(await page.locator('#cmp-file').isDisabled()));
  await page.setInputFiles('#cmp-file', benchLong);
  await page.waitForTimeout(2000);
  ok('and loading it first works',
     (await page.locator('#cmp-drop.loaded').count()) === 1,
     flat(await page.locator('#cmp-drop').innerText()));
  ok('while the run button stays shut until there is something to compare',
     await page.locator('#r-run').isDisabled());
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2000);
  ok('the primary file arriving second completes the pair',
     !(await page.locator('#r-run').isDisabled()) &&
     (await page.locator('#r-compare').inputValue()) !== 'none');

  /* A second benchmark IS a choice, so the chooser appears then and only then. */
  await page.setInputFiles('#cmp-file', benchTRI);
  await page.waitForTimeout(2000);
  await openCard('b');
  ok('loading a second benchmark brings the chooser out',
     !(await page.locator('#r-compare-field').isHidden()) &&
     (await page.locator('#r-compare option').count()) === 3,
     String(await page.locator('#r-compare option').count()));
  ok('and it is inside card 2, not three steps below it',
     await page.evaluate(() => !!document.querySelector('#up-benchmark-head #r-compare-field')));

  section('A refused file does not leave step 1 wearing a tick');
  await openIndexPath();
  await page.setInputFiles('#bm-file', trades);
  await page.waitForTimeout(1500);
  ok('step 1 is not marked done',
     (await page.locator('#step-source').getAttribute('data-done')) === 'no',
     await page.locator('#step-source').getAttribute('data-done'));
  ok('and is marked as holding an error',
     (await page.locator('#step-source').getAttribute('data-error')) === 'yes');
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2000);
  ok('a good file afterwards clears both marks',
     (await page.locator('#step-source').getAttribute('data-done')) === 'yes' &&
     (await page.locator('#step-source').getAttribute('data-error')) === 'no');

  section('One window is a measurement, not a distribution');
  await openIndexPath();
  await page.setInputFiles('#bm-file', long20);
  await page.waitForTimeout(2200);
  await page.locator('#r-years .chip', { hasText: 'Max History' }).first().click();
  await page.waitForTimeout(300);
  await page.click('#r-run');
  await page.waitForTimeout(1800);
  const one = flat(await page.locator('#r-out').innerText());
  /* Case-insensitive: the hero's label is uppercased by the stylesheet. */
  ok('the hero does not call one window a median',
     !/Median 20-year return/i.test(one) && /The only 20-year period in this data/i.test(one),
     one.slice(0, 260));
  ok('and nothing else on the screen speaks of a range either',
     !/Read this range with suspicion/i.test(one) &&
     !/These 1 windows overlap/i.test(one) &&
     !/Read the range below/i.test(one),
     (one.match(/.{0,60}(this range|1 windows|range below).{0,60}/i) || [''])[0]);
  ok('and says outright that it is not a distribution',
     /One measurement, not a distribution/.test(one), one.slice(0, 400));
  ok('the quartile table is replaced rather than filled with one number five times',
     (await page.locator('#r-out table.spread').count()) === 0 &&
     /There is no range at this length/.test(one), one.slice(0, 400));
  ok('the one period is listed with its own dates',
     /Period 1 01-Jan-2005 to 01-Jan-2025/.test(one),
     (one.match(/Period 1[^|]{0,60}/) || [''])[0]);
  ok('and best-start against worst-start is not offered, being the same day',
     !/Would it still look this way if you had started elsewhere/.test(one));
  ok('while the volatility row says it cannot be measured on one window',
     /Spread of window returns \(std dev\) not measurable on one window/.test(one),
     (one.match(/Spread of window returns[^A-Z]{0,50}/) || [''])[0]);

  section('The comparison card reports, it does not grade');
  await openIndexPath();
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2000);
  await page.setInputFiles('#cmp-file', benchLong);
  await page.waitForTimeout(2000);
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  const graded = flat(await page.locator('#r-out').innerText());
  ok('no row is graded Strong, Weak, Mixed, Moderate or Limited',
     !/\b(Strong|Weak|Mixed|Moderate|Limited)\b/.test(graded),
     (graded.match(/.{0,50}\b(Strong|Weak|Mixed|Moderate|Limited)\b.{0,50}/) || [''])[0]);
  ok('the return line carries the gap in points instead',
     /Return against the benchmark \+4\.0 points a year/.test(graded),
     (graded.match(/Return against the benchmark[^A-Z]{0,40}/) || [''])[0]);
  ok('and the evidence line carries the years instead of a word',
     /History behind these figures [\d.]+ years/.test(graded),
     (graded.match(/History behind these figures[^A-Z]{0,30}/) || [''])[0]);

  section('Total return, or price return — established, not asserted');
  await openIndexPath();
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2000);
  await page.setInputFiles('#cmp-file', benchLong);
  await page.waitForTimeout(2000);
  await openCard('b');
  ok('the screen asks which kind of index was loaded',
     await page.locator('#cmp-kind-chips').isVisible());
  const kinds = await page.locator('#cmp-kind-chips .chip').allInnerTexts();
  ok('offering exactly the two that matter',
     kinds.join('|') === 'Total Return Index — dividends included|Price index — dividends excluded',
     kinds.join('|'));
  ok('and a file whose name says nothing leaves it unanswered',
     (await page.locator('#cmp-kind-chips .chip[aria-checked="true"]').count()) === 0);
  ok('saying plainly that it has not been established, and why that matters',
     /Not established/.test(await page.locator('#cmp-kind-why').innerText()) &&
     /dividends the index leaves out/.test(await page.locator('#cmp-kind-why').innerText()),
     flat(await page.locator('#cmp-kind-why').innerText()));

  await page.click('#r-run');
  await page.waitForTimeout(2000);
  let k = flat(await page.locator('#r-out').innerText());
  ok('the results do not claim it counts dividends',
     !/a total return index — dividends included/i.test(k), k.slice(0, 200));
  ok('they say it is not established',
     /not established — open card 2 and say which/i.test(k),
     (k.match(/.{0,60}not established.{0,60}/i) || [''])[0]);
  ok('and the summary table warns the outperformance row may be inflated',
     /It has not been established whether the benchmark counts dividends/i.test(k),
     k.slice(0, 200));

  /* Answer it, and the screen follows the answer. */
  await page.locator('#cmp-kind-chips .chip[data-kind="PRICE"]').click();
  await page.waitForTimeout(1800);
  k = flat(await page.locator('#r-out').innerText());
  ok('a price index is described as one',
     /a price index — dividends excluded/i.test(k),
     (k.match(/.{0,50}price index.{0,60}/i) || [''])[0]);
  ok('and the reader is told the gap is flattered, with the size of it',
     /flattered here by roughly the market’s dividend yield/i.test(k) &&
     /1 to 1\.5 points/.test(k), k.slice(0, 200));
  ok('the summary table carries it too, where the outperformance row is',
     /The benchmark column excludes dividends/i.test(k), k.slice(0, 200));
  ok('and the reason is stated at the control as well',
     /flatters the fund by roughly the market’s dividend yield/i
       .test(await page.locator('#cmp-kind-why').innerText()),
     flat(await page.locator('#cmp-kind-why').innerText()));

  await page.locator('#cmp-kind-chips .chip[data-kind="TRI"]').click();
  await page.waitForTimeout(1800);
  k = flat(await page.locator('#r-out').innerText());
  ok('answering TRI removes the caveat rather than leaving both on screen',
     /a total return index — dividends included/i.test(k) &&
     !/flattered here by roughly/i.test(k) &&
     !/not been established whether/i.test(k), k.slice(0, 220));

  section('A file that names itself is read, not asked about');
  await openIndexPath();
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2000);
  await page.setInputFiles('#cmp-file', benchTRI);
  await page.waitForTimeout(2000);
  ok('“nifty-50-tri” is taken as a total return index',
     (await page.locator('#cmp-kind-chips .chip[data-kind="TRI"]').getAttribute('aria-checked')) === 'true',
     await page.locator('#cmp-kind-chips').innerText());
  ok('and the screen says where it got that from, so it can be corrected',
     /Read from the name of the file you loaded/.test(await page.locator('#cmp-kind-why').innerText()),
     flat(await page.locator('#cmp-kind-why').innerText()));

  await openIndexPath();
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2000);
  await page.setInputFiles('#cmp-file', benchPRI);
  await page.waitForTimeout(2000);
  ok('“price-return-index” is taken as a price index, not as a TRI',
     (await page.locator('#cmp-kind-chips .chip[data-kind="PRICE"]').getAttribute('aria-checked')) === 'true',
     await page.locator('#cmp-kind-chips').innerText());
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  ok('so the caveat is on the screen without anybody having been asked',
     /excludes dividends/i.test(flat(await page.locator('#r-out').innerText())),
     flat(await page.locator('#r-out').innerText()).slice(0, 200));

  /* ================================ SECTION 2, BOTH DOORS IN ONE STEP */
  section('Section 2 — the two cards are in step 1, beside each other');
  await openIndexPath();
  ok('Card A is in step 1', await page.evaluate(() =>
     !!document.querySelector('#step-source #up-primary')));
  ok('and so is Card B, which used to be three steps away', await page.evaluate(() =>
     !!document.querySelector('#step-source #up-benchmark-head')));
  ok('they are siblings in one container, not two stacked steps', await page.evaluate(() => {
     const a = document.querySelector('#up-primary'), b = document.querySelector('#up-benchmark-head');
     return !!a && !!b && a.parentElement === b.parentElement &&
            a.parentElement.id === 'up-cards';
  }));
  ok('the benchmark upload travelled with its card', await page.evaluate(() =>
     !!document.querySelector('#up-benchmark-head #r-compare-upload') &&
     !!document.querySelector('#up-benchmark-head #cmp-file')));
  ok('so step 4 no longer holds an upload at all', await page.evaluate(() =>
     !document.querySelector('#step-compare #cmp-file')));
  /* Step 4 asked the question card 2 has already answered. "Compare against —
     optional — Benchmark: [Nifty 50 TRI]" three steps below a card headed
     "2. Benchmark Index Data (TRI)" holding that very file is the same choice
     offered twice, and the second offer has nothing to add. */
  ok('and step 4 is gone entirely, rather than repeating card 2',
     await page.locator('#step-compare').isHidden());
  ok('the lede counts the steps that are actually there',
     /Set the three things below/.test(await page.locator('#r-lede').innerText()),
     await page.locator('#r-lede').innerText());
  ok('the chooser moved into card 2 with its upload',
     await page.evaluate(() => !!document.querySelector('#up-benchmark-head #r-compare-field')));
  ok('and stays out of sight while there is nothing to choose between',
     await page.locator('#r-compare-field').isHidden());
  ok('the range warning sits under both files, not under one of them',
     await page.evaluate(() => !!document.querySelector('#step-source #r-overlap-note')));

  /* Both visible at once is the substance; side by side is the layout, and it
     only applies where there is room for two columns. */
  const wide = await ctx.newPage();
  await wide.setViewportSize({ width: 1100, height: 900 });
  await wide.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  await wide.reload({ waitUntil: 'networkidle' });
  await wide.click('#r-source .chip[data-source="index"]');
  await wide.waitForTimeout(300);
  const boxes = await wide.evaluate(() => {
    const a = document.querySelector('#up-primary').getBoundingClientRect();
    const b = document.querySelector('#up-benchmark-head').getBoundingClientRect();
    return { aTop: a.top, bTop: b.top, aRight: a.right, bLeft: b.left, innerW: window.innerWidth };
  });
  ok('on a wide screen they share a row',
     Math.abs(boxes.aTop - boxes.bTop) < 2 && boxes.bLeft >= boxes.aRight - 1,
     JSON.stringify(boxes));
  ok('and the compact doors are not drawn where there is room for the cards',
     await wide.locator('#up-doors').isHidden());
  await wide.close();

  section('Either file first, from the same step');
  await openIndexPath();
  await page.setInputFiles('#cmp-file', benchLong);
  await page.waitForTimeout(2000);
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2000);
  ok('benchmark first, then primary, both from step 1',
     (await page.locator('#cmp-drop.loaded').count()) === 1 &&
     (await page.locator('#bm-drop.loaded').count()) === 1 &&
     !(await page.locator('#r-run').isDisabled()));

  section('The card survives being moved back and forth');
  /* The node is REPARENTED rather than rebuilt, so everything wired into it
     at build time -- the drop zone, the paste box, the TRI question -- has to
     keep working after a round trip through the other source path. Rebuilding
     the markup instead would leave a second, dead upload box behind. */
  await openIndexPath();
  await page.click('#r-source .chip[data-source="fund"]');
  await page.waitForTimeout(300);
  ok('on the fund path Card B is hidden',
     await page.locator('#up-benchmark-head').isHidden());
  /* My own fund offers no comparison at all: whoever wants their fund
     measured against an index has the Market index path. Step 4 stays
     hidden and serves only as the parking bay for the comparison nodes. */
  ok('step 4 does NOT come back — the fund path offers no comparison',
     await page.locator('#step-compare').isHidden());
  ok('but the benchmark upload is parked inside it, intact for the way back',
     await page.evaluate(() => !!document.querySelector('#step-compare #cmp-file')) &&
     await page.evaluate(() => !!document.querySelector('#step-compare #r-compare-field')));
  ok('with the lede counting three on this path too',
     /Set the three things below/.test(await page.locator('#r-lede').innerText()),
     await page.locator('#r-lede').innerText());
  ok('with exactly one of it, not a copy left behind',
     (await page.locator('#cmp-file').count()) === 1 &&
     (await page.locator('#cmp-drop').count()) === 1);
  await page.click('#r-source .chip[data-source="index"]');
  await page.waitForTimeout(300);
  ok('coming back moves it into step 1 again',
     await page.evaluate(() => !!document.querySelector('#up-benchmark-head #cmp-file')));
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2000);
  await page.setInputFiles('#cmp-file', benchPRI);
  await page.waitForTimeout(2000);
  ok('and it still reads a file after the round trip',
     (await page.locator('#cmp-drop.loaded').count()) === 1,
     flat(await page.locator('#cmp-drop').innerText()));
  ok('with the TRI question still wired',
     (await page.locator('#cmp-kind-chips .chip[data-kind="PRICE"]').getAttribute('aria-checked')) === 'true');
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  ok('and the comparison runs',
     /Outperformance Rate vs Benchmark/.test(flat(await page.locator('#r-out').innerText())),
     flat(await page.locator('#r-out').innerText()).slice(0, 160));

  /* ================================== THE TWO DOORS, ON A PHONE (390px) */
  section('On a phone the pair is what sits side by side');
  await openIndexPath();
  ok('two compact doors are drawn instead of two cards',
     await page.locator('#up-doors').isVisible() &&
     (await page.locator('.door').count()) === 2);
  const doorBox = await page.evaluate(() => {
    const a = document.querySelector('#door-a').getBoundingClientRect();
    const b = document.querySelector('#door-b').getBoundingClientRect();
    return { aTop: a.top, bTop: b.top, aRight: a.right, bLeft: b.left, w: a.width };
  });
  ok('side by side on a 390px screen, which the cards themselves could not be',
     Math.abs(doorBox.aTop - doorBox.bTop) < 2 && doorBox.bLeft >= doorBox.aRight - 1,
     JSON.stringify(doorBox));
  ok('each door names its file and what to do about it',
     /The fund’s NAV history/.test(await page.locator('#door-a').innerText()) &&
     /Choose a file/.test(await page.locator('#door-a').innerText()) &&
     /The benchmark index \(TRI\)/.test(await page.locator('#door-b').innerText()) &&
     /Choose a file/.test(await page.locator('#door-b').innerText()),
     flat(await page.locator('#up-doors').innerText()));
  ok('and neither card is taking up the screen until it is asked for',
     await page.locator('#up-primary').isHidden() &&
     await page.locator('#up-benchmark-head').isHidden());

  section('Tapping a door opens its card, whole');
  await page.click('#door-a');
  await page.waitForTimeout(300);
  ok('card 1 opens', await page.locator('#up-primary').isVisible());
  ok('and card 2 stays shut, so one box is on screen and not two',
     await page.locator('#up-benchmark-head').isHidden());
  ok('the door says it is open', (await page.locator('#door-a').getAttribute('aria-expanded')) === 'true' &&
     (await page.locator('#door-b').getAttribute('aria-expanded')) === 'false');
  const openA = flat(await page.locator('#up-primary').innerText());
  ok('with every word of the card, not a summary of it',
     /NAV is the fund’s price per unit on a given day/.test(openA) &&
     /Where do I get my fund’s NAV file/.test(openA) &&
     /Choose a file/.test(openA), openA.slice(0, 220));
  /* The door carries the short name; the card, opened to be READ, carries
     the complete one -- which is also where the specification's approved
     header lives now that the tile is shorter. */
  ok('and the opened card carries its full approved title',
     /1\. The fund’s NAV history file/.test(openA), openA.slice(0, 120));

  await page.click('#door-b');
  await page.waitForTimeout(300);
  ok('tapping the other door swaps which card is open',
     await page.locator('#up-benchmark-head').isVisible() &&
     await page.locator('#up-primary').isHidden());
  ok('and card 2 is whole too',
     /The daily values of a Total Return Index/
       .test(flat(await page.locator('#up-benchmark-head').innerText())),
     flat(await page.locator('#up-benchmark-head').innerText()).slice(0, 200));

  await page.click('#door-b');
  await page.waitForTimeout(300);
  ok('tapping the open door shuts it again, so a wrong tap is not a trap',
     await page.locator('#up-benchmark-head').isHidden() &&
     (await page.locator('#door-b').getAttribute('aria-expanded')) === 'false');

  section('The doors carry the answer, so both can be read at a glance');
  await page.click('#door-a');
  await page.waitForTimeout(250);
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2200);
  ok('a loaded door shows the file it holds',
     (await page.locator('#door-a').getAttribute('data-state')) === 'loaded' &&
     /spec-primary\.csv/.test(await page.locator('#door-a-status').innerText()),
     await page.locator('#door-a-status').innerText());
  ok('while the other still says what it wants',
     (await page.locator('#door-b').getAttribute('data-state')) === null &&
     /Choose a file/.test(await page.locator('#door-b-status').innerText()));

  await page.click('#door-b');
  await page.waitForTimeout(250);
  await page.setInputFiles('#cmp-file', trades);
  await page.waitForTimeout(2000);
  ok('a door whose file was turned away says so',
     (await page.locator('#door-b').getAttribute('data-state')) === 'refused' &&
     /Not added/.test(await page.locator('#door-b-status').innerText()),
     await page.locator('#door-b-status').innerText());
  ok('and the reason is still in the open card, where it was refused',
     /statement of your own payments/.test(flat(await page.locator('#cmp-status').innerText())),
     flat(await page.locator('#cmp-status').innerText()).slice(0, 120));

  await page.setInputFiles('#cmp-file', benchTRI);
  await page.waitForTimeout(2200);
  ok('a good file after it clears the mark',
     (await page.locator('#door-b').getAttribute('data-state')) === 'loaded' &&
     /nifty-50-tri\.csv/.test(await page.locator('#door-b-status').innerText()),
     await page.locator('#door-b-status').innerText());

  section('A read file folds its card away and rests as a summary');
  /* A card is a working surface. It is open while a file is being chosen and
     has no business staying open afterwards -- a full-height box holding a job
     already done is the largest thing on the screen and the least useful. */
  ok('both cards closed themselves once their files were read',
     await page.locator('#up-primary').isHidden() &&
     await page.locator('#up-benchmark-head').isHidden() &&
     await page.locator('#up-doors').isVisible());
  /* NOT a list of what was uploaded. The tiles already carry that -- each one
     shows its own file name and reopens its card when tapped -- so a row
     repeating it underneath is a second copy of an answer already on screen.
     What is left to say is that there is enough here to run, and where to go
     next: on a phone step 2 is below the fold. */
  ok('one go-ahead, and no list repeating what the tiles already say',
     (await page.locator('#up-ready').count()) === 1 &&
     (await page.locator('#up-loaded .loaded-line').count()) === 0);
  const ready = flat(await page.locator('#up-ready').innerText());
  ok('it says the analysis can run, naming what will be analysed',
     /Ready to analyse/.test(ready) && /spec-primary/.test(ready), ready);
  /* ONE SINGLE LINE, the author's words. The name gives way to an ellipsis
     before the sentence ever wraps. */
  ok('and it is genuinely one line',
     await page.evaluate(() => {
       const r = document.querySelector('#up-ready');
       const kids = r.querySelectorAll(':scope > span');
       const tops = Array.prototype.map.call(kids, k => k.getBoundingClientRect().top);
       return r.getBoundingClientRect().height < 64 &&
              Math.max.apply(null, tops) - Math.min.apply(null, tops) < 10;
     }));
  ok('the plain “Ready to analyse” notice is retired, its job done better here',
     !/Ready to analyse/.test(flat(await page.locator('#r-loaded').innerText())),
     flat(await page.locator('#r-loaded').innerText()));

  const beforeScroll = await page.evaluate(() => window.scrollY);
  await page.click('#up-ready');
  await page.waitForTimeout(900);
  const moved = await page.evaluate(() => ({
    y: window.scrollY,
    stepTop: document.querySelector('#step-period').getBoundingClientRect().top
  }));
  ok('tapping it carries the reader to step 2 instead of making them hunt for it',
     moved.y > beforeScroll && Math.abs(moved.stepTop) < 90,
     JSON.stringify({ from: beforeScroll, to: moved.y, stepTop: Math.round(moved.stepTop) }));
  ok('and puts them in the first field there',
     await page.evaluate(() => document.activeElement &&
       document.activeElement.id === 'r-start'),
     await page.evaluate(() => document.activeElement && document.activeElement.id));

  section('And the whole analysis runs from the doors');
  await page.click('#r-run');
  await page.waitForTimeout(2200);
  const fromDoors = flat(await page.locator('#r-out').innerText());
  ok('a 14% fund against a 10% index, loaded entirely through the doors',
     /Average Rolling Return \(Mean\) 14\.0% 10\.0%/.test(fromDoors),
     (fromDoors.match(/Average Rolling Return \(Mean\)[^A-Z]{0,26}/) || [''])[0]);

  section('Start again puts the doors back');
  await page.click('#r-reset');
  await page.waitForTimeout(400);
  await page.click('#r-source .chip[data-source="index"]');
  await page.waitForTimeout(300);
  ok('both doors are empty again',
     (await page.locator('#door-a').getAttribute('data-state')) === null &&
     (await page.locator('#door-b').getAttribute('data-state')) === null &&
     /Upload File/.test(await page.locator('#door-a-status').innerText()));
  ok('and neither card is open',
     await page.locator('#up-primary').isHidden() &&
     await page.locator('#up-benchmark-head').isHidden());

  /* ============================ THE REVIEWER'S SPARSE FILE, AND WHAT CHANGED */
  section('A quarterly file is told what it is, before anything runs');
  /* 29 rows across ~7 years, ~96-day gaps — the reviewer's shape. The engine
     was never fooled by it (windows are dropped, not stretched), but the
     screen recommended Daily steps over it and said nothing about density
     until five windows arrived. */
  const sparse = (() => {
    const L = ['Date,NAV']; let v = 100;
    const dates = []; let t = Date.UTC(2017, 6, 3);
    for (let i = 0; i < 29; i++) { dates.push(t); t += Math.round((80 + (i % 5) * 8) * 86400000); }
    dates[26] = Date.UTC(2023, 6, 1); dates[27] = Date.UTC(2023, 9, 1); dates[28] = Date.UTC(2024, 5, 28);
    let prev = dates[0];
    dates.forEach((dt, i) => {
      if (i) v *= Math.pow(1.10, (dt - prev) / (365.2425 * 86400000));
      prev = dt;
      L.push(new Date(dt).toISOString().slice(0, 10) + ',' + v.toFixed(4));
    });
    fs.writeFileSync(TMP + '/sparse29.csv', L.join('\n'));
    return TMP + '/sparse29.csv';
  })();

  await openIndexPath();
  await openCard('a');
  await page.setInputFiles('#bm-file', sparse);
  await page.waitForTimeout(2000);
  const warned = flat(await page.locator('#r-loaded').innerText());
  ok('the density warning arrives at load time, not after a run',
     /a value about every \d+ days/.test(warned) && /29 observations/.test(warned), warned);
  ok('and it is drawn as a warning, not as good news',
     (await page.locator('#r-loaded .notice.warn').count()) === 1);
  const freqNow = await page.locator('#r-freq .chip').allInnerTexts();
  ok('Daily is disabled, with the reason on the chip',
     await page.locator('#r-freq .chip[data-frequency="daily"]').isDisabled() &&
     /this file has a value about every \d+ days/.test(freqNow[0]), freqNow[0]);
  ok('and no longer calls itself Recommended over data it cannot step through',
     !/Recommended/.test(freqNow[0]), freqNow[0]);
  ok('Weekly is disabled too', await page.locator('#r-freq .chip[data-frequency="weekly"]').isDisabled());
  ok('the selection moved to the coarsest step, not left on a dead one',
     (await page.locator('#r-freq .chip[data-frequency="monthly"]').getAttribute('aria-checked')) === 'true');
  ok('and the row says plainly that nothing here has anything to thin',
     /every observation is already further apart than any of these steps/
       .test(await page.locator('#r-freq-note').innerText()),
     await page.locator('#r-freq-note').innerText());

  await page.locator('#r-years .chip[data-years="5"]').click();
  await page.waitForTimeout(300);
  await page.click('#r-run');
  await page.waitForTimeout(1500);
  const sparseOut = flat(await page.locator('#r-out').innerText());
  ok('the results own their thinness in words',
     /The only (two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+) 5-year periods in this data/i.test(sparseOut) ||
     /The only 5-year period in this data/i.test(sparseOut), sparseOut.slice(0, 400));
  ok('with the plural the right way round',
     !/\d+ 5-year period ,|\d+ 5-year period in/i.test(sparseOut), sparseOut.slice(0, 300));

  /* A dense file gets Daily back, Recommended and all. */
  await openIndexPath();
  await openCard('a');
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(2000);
  ok('a daily file gets all three steps back',
     (await page.locator('#r-freq .chip:disabled').count()) === 0 &&
     /every start date/.test((await page.locator('#r-freq .chip').allInnerTexts())[0]));

  /* ================================ THE FOUR PILLARS, FIRST THING ON SCREEN */
  section('Every result opens with what it is');
  await page.locator('#r-years .chip[data-years="3"]').click();
  await page.waitForTimeout(250);
  await page.click('#r-run');
  await page.waitForTimeout(1600);
  const strip = flat(await page.locator('#r-out .pastnote').innerText());
  ok('the past-performance line is the first element of the results',
     await page.evaluate(() => {
       const first = document.querySelector('#r-out').firstElementChild;
       return first && first.classList.contains('pastnote');
     }));
  ok('and says already-happened, on-your-device, before-tax',
     /Already happened/.test(strip) && /do not guarantee future performance/.test(strip) &&
     /nothing you upload leaves this page/.test(strip) && /before tax and exit load/.test(strip),
     strip);
  ok('without repeating the reviewer’s error about expense ratios',
     /NAV already includes its expense ratio/.test(strip), strip);

  section('The target-rate card answers the reviewer’s question, factually');
  const rateCard = flat(await page.locator('#r-out .ratepresets').innerText());
  ok('round-number presets are offered',
     rateCard === '6% 8% 10% 12%', rateCard);
  ok('and the copy says whose number the target has to be',
     /The target is YOURS/i.test(flat(await page.locator('#r-out').innerText())));
  await page.locator('.ratepresets .chip', { hasText: '8%' }).click();
  await page.waitForTimeout(400);
  const verdict = flat(await page.locator('[id^="ratesub-"]').first().innerText());
  ok('a preset types the target and the sentence answers in the reviewer’s own shape',
     /In 100% of the 3-year holding periods in this data \([\d,]+ of [\d,]+\), the return beat your target of 8\.0% a year/.test(verdict),
     verdict);
  ok('and closes with past periods, not future odds',
     /Past periods, not future odds/.test(verdict), verdict);

  section('The same data, held for longer');
  const hz = flat(await page.locator('#r-out .card', { hasText: 'The same data, held for longer' }).innerText());
  ok('the multi-horizon card renders', hz.length > 0);
  ok('with 1, 3 and 5-year rows on a ten-year file',
     /1 year/.test(hz) && /3 years/.test(hz) && /5 years/.test(hz), hz.slice(0, 300));
  ok('the chosen horizon is marked in its row',
     /3 years ← chosen/.test(hz), hz.slice(0, 300));
  ok('and on a constant-growth file every horizon reads 14%',
     (hz.match(/14\.0%/g) || []).length >= 9, String((hz.match(/14\.0%/g) || []).length));
  /* Whole windows only: 10 years of history holds three 3-year periods,
     not 3.3 of them. */
  ok('the label says what the count is, as a whole number',
     /Independent \(Non-Overlapping\) 3-Year Horizons:? 3 Periods/i.test(flat(await page.locator('#r-out').innerText())) &&
     !/\d\.\d Periods/i.test(flat(await page.locator('#r-out').innerText())) &&
     /Total Rolling Sample Windows [\d,]+ \(Daily Shifts\)/i.test(flat(await page.locator('#r-out').innerText())),
     flat(await page.locator('#r-out').innerText()).slice(0, 900));

  section('The fall, priced in rupees and ended with the question');
  /* A file with a real crash in it: up 8%/yr, a 30% fall over 2 months in
     2020, then recovery. */
  const crashy = (() => {
    const L = ['Date,NAV']; let v = 100; let t = Date.UTC(2015, 0, 1);
    while (t <= Date.UTC(2025, 0, 1)) {
      const inCrash = t >= Date.UTC(2020, 0, 15) && t < Date.UTC(2020, 2, 15);
      /* Recovery stretched past a year on purpose: the mismatch line fires
         only when the chosen hold is NOT longer than fall-plus-recovery, so
         the fixture needs ~19 months underwater for a 1-year hold to trip it. */
      const inRecovery = t >= Date.UTC(2020, 2, 15) && t < Date.UTC(2021, 8, 15);
      if (inCrash) v *= Math.pow(0.70, 1 / 60);
      else if (inRecovery) v *= Math.pow(1 / 0.70, 1 / 549) * Math.pow(1.08, 1 / 365.2425);
      else v *= Math.pow(1.08, 1 / 365.2425);
      L.push(new Date(t).toISOString().slice(0, 10) + ',' + v.toFixed(4));
      t += 86400000;
    }
    fs.writeFileSync(TMP + '/crashy.csv', L.join('\n'));
    return TMP + '/crashy.csv';
  })();
  await openIndexPath();
  await openCard('a');
  await page.setInputFiles('#bm-file', crashy);
  await page.waitForTimeout(2200);
  await page.locator('#r-years .chip[data-years="1"]').click();
  await page.waitForTimeout(250);
  await page.click('#r-run');
  await page.waitForTimeout(1600);
  /* The whole results area: the sentences below appear exactly once on it,
     and pinning the card element proved fragile against Playwright's
     ancestor-inclusive text filtering. */
  const fall = flat(await page.locator('#r-out').innerText());
  ok('the fall is priced: what ₹10,000 became at the bottom',
     /every ₹10,000 held through this was worth about ₹[\d,]+ at the bottom/.test(fall), fall.slice(0, 400));
  ok('and the reader is asked the one question the record puts',
     /would anything .* force you to take the money out/.test(fall) &&
     /Whoever sells at the bottom turns this dip into their permanent result/.test(fall),
     fall.slice(0, 500));
  ok('a 1-year hold is called out as not longer than this fall-and-recovery',
     /Your chosen 1-year holding period is not longer than this fall-and-recovery/.test(fall),
     fall.slice(0, 600));

  /* And the summary table must not spill on a phone, benchmark or not —
     the reviewer reported clipping on an older build; this pins the fix. */
  ok('the statistical summary does not spill sideways without a benchmark',
     await page.evaluate(() => {
       const w = document.querySelector('#r-out .summary3').closest('.scroll');
       return w.scrollWidth <= w.clientWidth + 1;
     }));

  /* ================================= THE FUND PATH IS NOT IN SCOPE AND IS NOT TOUCHED */
  section('The other source path is left exactly as it was');
  await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  await page.click('#r-source .chip[data-source="fund"]');
  await page.waitForTimeout(300);
  ok('no Card B header appears on the fund path',
     await page.locator('#up-benchmark-head').isHidden());
  /* Steps 1-3 are the same controls on both paths now. */
  ok('the rolling frequency is offered on the fund path too',
     await page.locator('#r-freq-wrap').isVisible());
  await page.setInputFiles('#f-file', navFile(TMP + '/spec-fund.csv', 0.14, 2015, 2025, 100));
  await page.waitForTimeout(1600);
  const fundChips = await page.locator('#r-years .chip').allInnerTexts();
  ok('and the fund path still offers exactly the five fixed horizons',
     fundChips.join('|') === '1 year|3 years|5 years|7 years|10 years', fundChips.join('|'));
  await page.click('#r-run');
  await page.waitForTimeout(1500);
  const fundOut = flat(await page.locator('#r-out').innerText());
  /* The fund path now carries the full analysis too -- its own single-column
     statistical summary (no benchmark column: the path offers no comparison),
     five insights this data can actually support, and the approved labels
     everywhere. "Historical success rate" is gone from both paths. */
  ok('the fund path gets its own statistical summary, one measured column',
     /Statistical summary/.test(fundOut) && /This Fund/i.test(fundOut) &&
     (await page.locator('#r-out .summary3').count()) === 0, fundOut.slice(0, 300));
  ok('and no insights card, on this path either',
     (await page.locator('#r-out ol.insights:not(.reflectlist)').count()) === 0 &&
     !/Not measurable without benchmark/i.test(fundOut));
  ok('with the approved labels, not the old success-rate wording',
     /Windows ending above zero/.test(fundOut) && !/Historical success rate/.test(fundOut),
     fundOut.slice(0, 400));
  ok('and the horizon comparison reaches this path too',
     /The same data, held for longer/.test(fundOut));


  /* ================== THE SEPTEMBER REVIEW: the market-index path, revisited */
  section('Different asset classes are named before the gap is read');
  {
    /* A corporate bond fund against Nifty 50 TRI: the reported flow. */
    const bondFund = navFile(TMP + '/acme-corporate-bond-fund-nav.csv', 0.07, 2015, 2025, 100);
    await openIndexPath();
    await page.setInputFiles('#bm-file', bondFund);
    await page.waitForTimeout(1500);
    await page.setInputFiles('#cmp-file', benchTRI);
    await page.waitForTimeout(1500);
    const note = flat(await page.locator('#r-overlap-note').innerText());
    ok('the mismatch is said at load time, before any result, in the approved words',
       /Notice: Asset Class Context/i.test(note) &&
       /You are comparing a Fixed Income \/ Debt Asset with an Equity Index\. Equity indices typically exhibit higher long-term capital growth alongside significantly higher short-term volatility and drawdown risk\. Fixed Income assets are generally structured for income generation, capital stability, and lower price fluctuation\./.test(note),
       note.slice(0, 400));
    ok('as a neutral notice, not a red or amber one',
       (await page.locator('#r-overlap-note .notice.info').count()) === 1 &&
       (await page.locator('#r-overlap-note .notice.bad, #r-overlap-note .notice.warn').count()) === 0);
    ok('it points at a like-for-like TRI and says how the classes were decided',
       /like-for-like/i.test(note) && /Total Return Index \(TRI\)/.test(note) &&
       /How this was decided/i.test(note) && /read from its name as debt/i.test(note) &&
       /read from its name as equity/i.test(note), note.slice(0, 700));
    await page.locator('#r-years .chip[data-years="5"]').click();
    await page.waitForTimeout(250);
    await page.click('#r-run');
    await page.waitForTimeout(2200);
    const gapOut = flat(await page.locator('#r-out').innerText());
    ok('the comparison panel repeats the notice beside the gap',
       /Notice: Asset Class Context/i.test(gapOut) &&
       (await page.locator('#r-out .ixpanel[data-panel="bench"] .notice.info').count()) === 1);
    ok('and the comparison table carries a Gap column',
       /\bgap\b/i.test(await page.locator('#r-out .ixpanel[data-panel="bench"] table.stickyfirst thead').last().innerText()));

    /* The audit (September, second pass) removed the Data Standard Note and
       the Dataset Scope Note as two of seven disclaimers on one page, made
       the independent-period count a whole number, and deleted the Sharpe
       and Sortino rows whose denominator was not the asset's volatility. */
    ok('the data-standard note and the scope note are gone',
       (await page.locator('#r-out .feenote, #r-out .scopenote').count()) === 0 &&
       !/Data Standard Note|Dataset Scope Note/.test(gapOut));
    ok('the window count is labelled as sample windows with the shift frequency',
       /Total Rolling Sample Windows:? 1,827 \(Daily Shifts\)/i.test(gapOut), gapOut.slice(0, 900));
    ok('and the independent count is a whole number of periods',
       /Independent \(Non-Overlapping\) 5-Year Horizons:? 2 Periods/i.test(gapOut) &&
       !/\d\.\d Periods/i.test(gapOut));
    ok('no Sharpe or Sortino row remains in either comparison table',
       (await page.locator('#r-out td[data-ratio], #r-out td[data-ratio-delta]').count()) === 0 &&
       !/Sharpe|Sortino/.test(gapOut));

    /* Item 5: the side-by-side characteristic matrix, fund | benchmark | delta. */
    const matrixRows = await page.locator('#r-out table.charmatrix tbody tr').allInnerTexts();
    ok('the characteristic matrix carries the five rows in order',
       matrixRows.length === 5 &&
       /^Median Return/.test(flat(matrixRows[0])) && /^Worst Window/.test(flat(matrixRows[1])) &&
       /^Volatility/.test(flat(matrixRows[2])) && /^Max Drawdown/.test(flat(matrixRows[3])) &&
       /^Positive Window Ratio/.test(flat(matrixRows[4])), matrixRows.map(flat).join(' | '));
    ok('with a delta that is fund minus benchmark',
       /Median Return \(% a year\) 7\.0% 10\.0% \u22123\.0%/.test(flat(matrixRows[0])), flat(matrixRows[0]));
    ok('and legend dots on both column headings',
       (await page.locator('#r-out table.charmatrix th .legend-dot.fund').count()) === 1 &&
       (await page.locator('#r-out table.charmatrix th .legend-dot.bench').count()) === 1);

    /* Item 9: two colours, two marks. */
    ok('the histogram draws the fund and the benchmark as separate bars',
       (await page.locator('#r-out .ixbar.fund').count()) >= 1 &&
       (await page.locator('#r-out .ixbar.bench').count()) >= 1);
    const colours = await page.evaluate(() => {
      const f = document.querySelector('#r-out .ixbar.fund'), b = document.querySelector('#r-out .ixbar.bench');
      const fl = document.querySelector('#r-out .rl-line:not(.bench)'), bl = document.querySelector('#r-out .rl-line.bench');
      return {
        fund: getComputedStyle(f).fill, bench: getComputedStyle(b).fill,
        fundLine: getComputedStyle(fl).strokeDasharray, benchLine: getComputedStyle(bl).strokeDasharray,
        benchStroke: getComputedStyle(bl).stroke
      };
    });
    ok('the fund is blue and the benchmark is amber, and they are not the same colour',
       colours.fund === 'rgb(0, 180, 216)' && colours.bench === 'rgb(238, 155, 0)', JSON.stringify(colours));
    ok('the fund line is solid and the benchmark line is dashed',
       colours.fundLine === 'none' && colours.benchLine !== 'none', JSON.stringify(colours));
    ok('the legend dots sit beside the metric titles in the comparison tables',
       (await page.locator('#r-out table.summary3 th .legend-dot.fund').count()) === 1 &&
       (await page.locator('#r-out table.summary3 th .legend-dot.bench').count()) === 1);

    /* Item 6: the fan chart, one horizon at a time. */
    ok('the fan chart is drawn with a band, a median and one hit target per horizon',
       (await page.locator('#r-out figure.fanchart').count()) === 1 &&
       (await page.locator('#r-out .fan-band.fund').count()) === 1 &&
       (await page.locator('#r-out .fan-line.fund').count()) === 1 &&
       (await page.locator('#r-out .fan-line.bench').count()) === 1 &&
       (await page.locator('#r-out .fan-hit').count()) === 4);
    const readoutBefore = flat(await page.locator('#r-out .fan-readout').innerText());
    ok('its readout opens on the chosen horizon',
       /^5 years: 10th percentile 7\.0% \u00b7 median 7\.0% \u00b7 90th percentile 7\.0% \(1,827 windows\) \u2014 nifty-50-tri: 10th 10\.0% \u00b7 median 10\.0% \u00b7 90th 10\.0%$/.test(readoutBefore),
       readoutBefore);
    await page.locator('#r-out .fan-hit[data-fan-h="1"]').dispatchEvent('click');
    await page.waitForTimeout(150);
    const readoutAfter = flat(await page.locator('#r-out .fan-readout').innerText());
    ok('and tapping the 1-year horizon moves the readout to it',
       /^1 year: 10th percentile 7\.0%/.test(readoutAfter) && /\(3,[23]\d\d windows\)/.test(readoutAfter),
       readoutAfter);

    /* Item 10: the arithmetic, written out on the data panel. */
    ok('the data panel writes out CAGR with 365.25 over the calendar-day count, exponent and words',
       (await page.locator('#r-out .formula sup').count()) === 1 &&
       /\(NAVend \u00f7 NAVstart\)365\.25 \u00f7 days \u2212 1/.test(gapOut) &&
       /raise the result to the power of 365\.25 divided by the number of days/.test(gapOut) &&
       !/YYYY-MM-DD/.test(gapOut), (gapOut.match(/.{0,40}NAVend.{0,120}/) || [''])[0]);
  }

  section('A same-class or unnamed pairing is not nagged');
  await openIndexPath();
  /* Neither name says a class, and both synthetic series compound so evenly
     that their volatility reads as fixed income: the same class twice, so
     there is nothing to notice. (A nifty-named file against the same primary
     IS noticed, by the volatility rule -- the September section checks it.) */
  await page.setInputFiles('#bm-file', primary);
  await page.waitForTimeout(1500);
  await page.setInputFiles('#cmp-file', benchLong);
  await page.waitForTimeout(1500);
  ok('no class warning appears when neither the names nor the volatility set two classes apart',
     !/asset class/i.test(flat(await page.locator('#r-overlap-note').innerText())),
     flat(await page.locator('#r-overlap-note').innerText()).slice(0, 200));
  await page.setInputFiles('#cmp-file', benchTRI);
  await page.waitForTimeout(1500);

  section('The results carry the chart, the matrix, the ratios and the questions');
  await page.locator('#r-years .chip[data-years="3"]').click();
  await page.waitForTimeout(250);
  await page.click('#r-run');
  await page.waitForTimeout(2200);
  const rev = flat(await page.locator('#r-out').innerText());
  ok('the rolling line chart is drawn, with its percentile guides',
     (await page.locator('#r-out svg.rollline').count()) === 1 &&
     /Every window, in start-date order/.test(rev) &&
     /8 of every 10 windows ended between/.test(rev));
  ok('the horizon matrix carries the bands and the shares',
     /10th pct/i.test(rev) && /90th pct/i.test(rev) &&
     /Ended below zero/i.test(rev) && /Beat your target/i.test(rev));
  ok('and never calls a share of the past the odds',
     !/\bodds of\b/i.test(rev), (rev.match(/.{0,40}odds of.{0,40}/i) || [''])[0]);
  /* The audit: the header card is static and appears once, the PDF button
     sits on the tab row, and the Sharpe-style line is gone with the rows. */
  ok('the header card restates what was asked, once, in flow',
     (await page.locator('#r-out .resulthead').count()) === 1 &&
     (await page.locator('#r-out .stickybar').count()) === 0 &&
     await page.locator('#r-out .ixtabs .pdfbtn').isVisible());
  ok('no Sharpe-style or Sortino-style line sits under the rate box',
     !/Sharpe|Sortino/.test(rev) && (await page.locator('#r-out .ratioline').count()) === 0);
  ok('the three self-reflection questions are asked, not answered',
     (await page.locator('#r-out .reflectlist > li').count()) === 3 &&
     /Three questions only you can answer/.test(rev));

  /* The matrix's target column follows the reader's own rate. */
  await page.fill('#rate-rolling', '99');
  await page.waitForTimeout(300);
  ok('raising the target to 99% empties the Beat-your-target column',
     await (async () => {
       const cells = await page.locator('[data-beat-h]').allInnerTexts();
       return cells.length >= 2 && cells.every(c => c.trim() === '0%');
     })());
  ok('and no ratio line exists to follow it', (await page.locator('#ratio-rolling').count()) === 0);

  section('Overlap is explained on request, not shouted');
  await openIndexPath();
  await page.setInputFiles('#bm-file', bench);   /* 7 years, 5-year windows: tight */
  await page.waitForTimeout(1500);
  await page.locator('#r-years .chip[data-years="5"]').click();
  await page.waitForTimeout(250);
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  ok('the suspicion text is not a red slab above the first number',
     !(await page.locator('#r-out > .notice.bad').count()) ||
     !/Read this range with suspicion/.test(flat(await page.locator('#r-out > .notice.bad').first().innerText())));
  ok('it lives in a collapsible that names the counts on its one visible line',
     (await page.locator('#r-out details.overlapinfo').count()) === 1 &&
     /Understanding window overlap/.test(await page.locator('#r-out details.overlapinfo summary').innerText()));
  await page.locator('#r-out details.overlapinfo summary').click();
  await page.waitForTimeout(150);
  ok('and opening it gives every sentence the slab used to hold',
     /Read this range with suspicion/.test(flat(await page.locator('#r-out details.overlapinfo').innerText())) &&
     /non-overlapping/.test(flat(await page.locator('#r-out details.overlapinfo').innerText())));
  ok('the closing education folds to one line the same way',
     (await page.locator('#r-out details.teachnotes').count()) === 1 &&
     !/Not a forecast\./.test(flat(await page.locator('#r-out').innerText())));

  section('The worst fall names what it measures, in three figures');
  {
    /* Constant growth has no fall, so this needs a real dip: up, 30% down
       over ~6 months, then a recovery and on upward. */
    const dip = (() => {
      const L = ['Date,NAV'];
      let v = 100, t = Date.UTC(2016, 0, 1);
      const fallFrom = Date.UTC(2020, 0, 1), fallTo = Date.UTC(2020, 6, 1);
      while (t <= Date.UTC(2025, 0, 1)) {
        L.push(new Date(t).toISOString().slice(0, 10) + ',' + v.toFixed(4));
        if (t >= fallFrom && t < fallTo) v *= Math.pow(0.70, 1 / 182);
        else v *= Math.pow(1.12, 1 / 365.2425);
        t += 86400000;
      }
      fs.writeFileSync(TMP + '/spec-dip-nav.csv', L.join('\n'));
      return TMP + '/spec-dip-nav.csv';
    })();
    await openIndexPath();
    await page.setInputFiles('#bm-file', dip);
    await page.waitForTimeout(1500);
    await page.locator('#r-years .chip[data-years="3"]').click();
    await page.waitForTimeout(250);
    await page.click('#r-run');
    await page.waitForTimeout(2200);
    const fall = flat(await page.locator('#r-out').innerText());
    ok('the card is titled peak to trough',
       /The worst fall along the way \(peak to trough\)/.test(fall));
    ok('and says outright it is not the worst rolling window',
       /a different measurement from the Minimum Rolling Return/.test(fall));
    ok('depth, fall time and recovery time stand as a triplet',
       /Deepest fall/i.test(fall) && /The fall took/i.test(fall) && /Recovery took/i.test(fall));
    /* Item 2: the two measurements as two named rows of one table. */
    const ddRows = (await page.locator('#r-out table.ddtwo tbody tr').allInnerTexts()).map(flat);
    ok('the worst window and the peak-to-trough fall are two rows of one table',
       ddRows.length === 2 && /^Worst Rolling Return Window \(%\)/.test(ddRows[0]) &&
       /^Peak-to-Trough NAV Drawdown/.test(ddRows[1]), ddRows.join(' | '));
    ok('the drawdown row is a triplet: max decline, fall duration, recovery time',
       /Max decline −?\d+\.\d%/.test(ddRows[1]) && /fall duration \d+ months?/.test(ddRows[1]) &&
       /recovery time \d+ months?/.test(ddRows[1]), ddRows[1]);
    ok('and the two rows hold different figures',
       (ddRows[0].match(/−?\d+\.\d%/) || [])[0] !== (ddRows[1].match(/−?\d+\.\d%/) || [])[0], ddRows.join(' | '));
  }

  /* ====================== ITEM 14: a horizon the file cannot hold is refused, in years and months */
  section('A holding period longer than the file is refused, with the file’s span in years and months');
  {
    /* 4 years and 11 months of daily data: 1 Feb 2020 to 1 Jan 2025. */
    const short = (() => {
      const L = ['Date,NAV'];
      let v = 100, t = Date.UTC(2020, 1, 1);
      while (t <= Date.UTC(2025, 0, 1)) {
        L.push(new Date(t).toISOString().slice(0, 10) + ',' + v.toFixed(4));
        v *= Math.pow(1.10, 1 / 365.2425); t += 86400000;
      }
      fs.writeFileSync(TMP + '/spec-short-4y11m.csv', L.join('\n'));
      return TMP + '/spec-short-4y11m.csv';
    })();
    await openIndexPath();
    await page.setInputFiles('#bm-file', short);
    await page.waitForTimeout(1500);
    const chip5 = page.locator('#r-years .chip[data-years="5"]');
    ok('the 5-year chip is disabled on a file 4 years 11 months long',
       (await chip5.count()) === 1 && await chip5.isDisabled());
    await page.locator('#r-years .chip[data-years="3"]').click();
    await page.waitForTimeout(250);
    await page.click('#r-run');
    await page.waitForTimeout(1600);
    ok('a 3-year hold still runs', (await page.locator('#r-out .result').count()) >= 1);
    /* Force the 5-year hold through the state, as a stale chip or a saved link
       could, and read the refusal. */
    await page.evaluate(() => {
      const c = document.querySelector('#r-years .chip[data-years="5"]');
      c.disabled = false; c.click();
    });
    await page.waitForTimeout(250);
    await page.click('#r-run');
    await page.waitForTimeout(1200);
    const refusal = flat(await page.locator('#r-out').innerText());
    ok('and the refusal names the horizon and the file’s span in years and months',
       /Selected holding period \(5 Years\) requires at least 5 years of historical data\. Your file covers 4 Years, 11 Months\./.test(refusal),
       refusal.slice(0, 300));
  }

  /* ====================== ITEM 7: four tabs on a phone, one panel at a time */
  section('On a phone the results are four tabs, one panel showing at a time');
  {
    /* A context WITHOUT the harness style that un-tabs the panels. */
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await phone.newPage();
    const errs2 = [];
    p2.on('pageerror', e => errs2.push(e.message));
    await p2.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
    await p2.click('#r-source .chip[data-source="index"]');
    await p2.waitForTimeout(250);
    await p2.setInputFiles('#bm-file', primary);
    await p2.waitForTimeout(1500);
    await p2.setInputFiles('#cmp-file', benchTRI);
    await p2.waitForTimeout(1500);
    await p2.locator('#r-years .chip[data-years="3"]').click();
    await p2.waitForTimeout(250);
    await p2.click('#r-run');
    await p2.waitForTimeout(2200);
    const tabs = (await p2.locator('#r-out .ixtab').allInnerTexts()).map(flat);
    ok('the four tabs are named as specified, in order',
       tabs.join('|') === 'Summary & Context|Risk & Return|Benchmark Comparison|Data Table', tabs.join('|'));
    ok('four panels exist and only the first is showing',
       (await p2.locator('#r-out .ixpanel').count()) === 4 &&
       await p2.locator('#r-out .ixpanel[data-panel="summary"]').isVisible() &&
       await p2.locator('#r-out .ixpanel[data-panel="risk"]').isHidden() &&
       await p2.locator('#r-out .ixpanel[data-panel="bench"]').isHidden() &&
       await p2.locator('#r-out .ixpanel[data-panel="data"]').isHidden());
    ok('the first tab is the selected one',
       (await p2.locator('#r-out .ixtab').first().getAttribute('aria-selected')) === 'true');
    await p2.locator('#r-out .ixtab[data-panel="bench"]').click();
    await p2.waitForTimeout(200);
    ok('tapping Benchmark Comparison shows that panel and hides the rest',
       await p2.locator('#r-out .ixpanel[data-panel="bench"]').isVisible() &&
       await p2.locator('#r-out .ixpanel[data-panel="summary"]').isHidden() &&
       (await p2.locator('#r-out .ixtab[data-panel="bench"]').getAttribute('aria-selected')) === 'true' &&
       (await p2.locator('#r-out .ixtab[data-panel="summary"]').getAttribute('aria-selected')) === 'false');
    ok('the comparison table and its fee note are on that panel',
       await p2.locator('#r-out .ixpanel[data-panel="bench"] table.summary3').isVisible() &&
       await p2.locator('#r-out .ixpanel[data-panel="bench"] .feenote').isVisible());
    await p2.locator('#r-out .ixtab[data-panel="data"]').click();
    await p2.waitForTimeout(200);
    ok('and Data Table shows the numbers as a table',
       await p2.locator('#r-out .ixpanel[data-panel="data"]').isVisible() &&
       /The numbers as a table/.test(flat(await p2.locator('#r-out .ixpanel[data-panel="data"]').innerText())));
    ok('nothing on the tabbed screen scrolls sideways',
       await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    /* Wide screens keep every panel open; the row becomes a jump bar. */
    await p2.setViewportSize({ width: 1100, height: 900 });
    await p2.waitForTimeout(200);
    ok('on a wide screen all four panels are open at once',
       await p2.locator('#r-out .ixpanel[data-panel="summary"]').isVisible() &&
       await p2.locator('#r-out .ixpanel[data-panel="risk"]').isVisible() &&
       await p2.locator('#r-out .ixpanel[data-panel="bench"]').isVisible() &&
       await p2.locator('#r-out .ixpanel[data-panel="data"]').isVisible());
    ok('no script errors on the tabbed screen', errs2.length === 0, errs2.slice(0, 2).join(' | '));
    await phone.close();
  }

  ok('no script errors in the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  await page.click('#r-source .chip[data-source="index"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: TMP + '/shots/40-spec-cards.png', fullPage: true });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
