/* Every way a file gets into this tool, driven the way a reader drives it.
 *
 * The fixtures are in the shapes real files arrive in, not in the shape the
 * parser would like: NSE's index export puts a title above thirteen columns
 * and only one of the nine numeric ones is the index value; a fund house's
 * .xlsx opens with a logo row; AMFI uses semicolons; and somebody will always
 * try a PDF. Two of those were being refused with the words "contains trade
 * logs or transaction records", which was both wrong and unactionable, and
 * that is what most of this file exists to keep fixed.
 *
 * Run: python3 tools/tool-tests/fixtures/make_upload_fixtures.py /tmp/prc/upload
 *      node tools/tool-tests/upload.test.js
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TMP = process.env.PRC_TMP || '/tmp/prc';
const FIX = path.join(TMP, 'upload');
const CHROME = process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE_URL = process.env.PRC_URL || 'http://127.0.0.1:8781/tool/';

let pass = 0; const fails = [];
function ok(n, c, d) {
  if (c) { pass++; console.log('  pass  ' + n); }
  else { fails.push(n); console.log('  FAIL  ' + n + (d ? '  -- ' + String(d).slice(0, 220) : '')); }
}
function section(t) { console.log('\n' + t); }
function flat(s) { return String(s).replace(/\s+/g, ' ').trim(); }
const f = n => path.join(FIX, n);

/* The fixtures are generated, never committed: a 570 KB CSV in the repository
   would be a data file nobody reads, and these have to change with the test. */
execFileSync('python3', [path.join(__dirname, 'fixtures', 'make_upload_fixtures.py'), FIX],
             { stdio: 'inherit' });

(async () => {
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

  /* goto() to a URL differing only in its hash does not re-execute the page. */
  async function open(source) {
    await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.click(`#r-source .chip[data-source="${source}"]`);
    await page.waitForTimeout(250);
  }
  /* Below 34rem the index path's two cards live behind compact doors, and a
     card folds itself away once its file has been read -- the reader is
     returned to the pair of tiles rather than left facing a box whose job is
     done. So anything here that inspects a card opens its door first. On the
     fund path, and above 34rem, the doors are not drawn and this does
     nothing. */
  const DOOR = { 'bm-drop': 'a', 'cmp-drop': 'b' };
  async function openCard(which) {
    if (!which) return;
    if (await page.locator('#up-doors').isHidden()) return;
    const btn = page.locator('#door-' + which);
    if ((await btn.getAttribute('aria-expanded')) !== 'true') {
      await btn.click();
      await page.waitForTimeout(220);
    }
  }
  async function boxText(id) {
    await openCard(DOOR[id]);
    return flat(await page.locator('#' + id).innerText());
  }

  /* ============================================================ the states */
  section('The box the reader clicked is the box that answers');
  await open('index');
  ok('it starts as an invitation, with no state claimed',
     (await page.locator('#bm-drop.loaded, #bm-drop.refused, #bm-drop.working').count()) === 0 &&
     /Choose a file/.test(await boxText('bm-drop')));
  ok('and it says which two formats it reads',
     /CSV or Excel/.test(await boxText('bm-drop')), await boxText('bm-drop'));

  /* ------------------------------------------------ the confirmation itself */
  /* Card 1 takes the reader's own investment data, so the file that proves
     the confirmation is a NAV file. The NSE index file that used to sit here
     now proves the refusal a few sections down: the wrong-door gate reads the
     words in the file, and "Nifty 50 Total Returns Index" is not a fund. */
  section('A valid NAV file is confirmed where it was chosen');
  await openCard('a');
  await page.locator('#bm-drop').scrollIntoViewIfNeeded();
  const beforeScroll = await page.evaluate(() => window.scrollY);
  await page.setInputFiles('#bm-file', f('amfi-alpha-nav.csv'));
  await page.waitForTimeout(2500);

  const added = await boxText('bm-drop');
  ok('the box turns into a confirmation', (await page.locator('#bm-drop.loaded').count()) === 1, added);
  ok('and says so in as many words',
     /File added successfully/.test(added), added);
  ok('it names the file the reader chose',
     /amfi-alpha-nav\.csv/.test(added), added);
  ok('and says how much of it was read, and over what dates',
     /[\d,]+ rows read/.test(added) && /01-Jan-2010 to 01-Jan-2025/.test(added), added);
  ok('it offers the next move without hunting for it',
     /Choose a different file/.test(added), added);

  /* The complaint this was built for: having to scroll to find out.
   *
   * On a phone the card folds itself away once the file is read and the
   * reader is returned to the pair of tiles, so it is the TILE that has to
   * carry the answer into view. That is the stronger claim: not that a box
   * somewhere below says it worked, but that the thing the reader was looking
   * at when they tapped now says so. */
  const inView = await page.evaluate(() => {
    const doors = document.querySelector('#up-doors');
    const onPhone = doors && doors.getBoundingClientRect().height > 0;
    const b = document.querySelector(onPhone ? '#door-a[data-state="loaded"]'
                                             : '#bm-drop.loaded');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  ok('the confirmation is on screen without scrolling anywhere', inView);
  ok('and it names the file there',
     /amfi-alpha-nav\.csv/.test(await page.locator('#door-a-status').innerText()),
     await page.locator('#door-a-status').innerText());
  ok('and the page did not scroll out from under the reader',
     Math.abs((await page.evaluate(() => window.scrollY)) - beforeScroll) < 40);

  ok('the analysis becomes available', !(await page.locator('#r-run').isDisabled()));
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  const out = flat(await page.locator('#r-out').innerText());
  ok('a series built to return 14% a year measures 14% a year',
     /Median Rolling Return 14\.0%/.test(out) || /Median 14\.0%/.test(out),
     (out.match(/Median[^A-Z]{0,24}/) || [''])[0]);
  ok('over the whole file, not a fragment of it',
     /01-Jan-2010 to 01-Jan-2025/.test(out), out.slice(0, 220));

  /* ------------------------------------------------- the wrong-door refusal
     The report this section answers: "When I uploaded the Nifty 50 file in
     the Primary Investment Data section, the system accepted it." It must
     not. The file is a date and a value like any NAV file, so only the words
     inside it can say it is an index -- and they do. */
  section('An index file at the Primary Investment door is turned away');
  await open('index');
  await openCard('a');
  await page.setInputFiles('#bm-file', f('nse-nifty50-tri.csv'));
  await page.waitForTimeout(2500);
  const wrongA = flat(await page.locator('#bm-status').innerText());
  ok('the box shows it was not added',
     (await page.locator('#bm-drop.refused').count()) === 1, await boxText('bm-drop'));
  ok('it is named as index data', /looks like index data/.test(wrongA), wrongA);
  ok('with the words that gave it away',
     /Total Returns Index|Nifty/.test(wrongA), wrongA);
  ok('and it points at the door the file belongs to',
     /card 2/.test(wrongA) && /Benchmark Index Data/.test(wrongA), wrongA);
  ok('nothing was loaded from it', await page.locator('#r-run').isDisabled());

  /* ================================================= Excel, with a preamble */
  section('An .xlsx whose header is on row 4');
  await open('index');
  await page.setInputFiles('#bm-file', f('amc-nav-history.xlsx'));
  await page.waitForTimeout(3500);
  const xl = await boxText('bm-drop');
  ok('the workbook is accepted', (await page.locator('#bm-drop.loaded').count()) === 1, xl);
  ok('and the logo and title rows above the header did not stop it',
     /[\d,]+ rows read/.test(xl), xl);
  ok('Excel date cells are read as dates',
     /01-Jan-2012 to 01-Jan-2025/.test(xl), xl);
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  ok('and a 13% workbook measures 13% a year',
     /Median Rolling Return 13\.0%/.test(flat(await page.locator('#r-out').innerText())),
     (flat(await page.locator('#r-out').innerText())).match(/Median Rolling Return[^A-Z]{0,20}/));

  /* ==================================================== Excel, many schemes */
  section('An .xlsx holding three schemes asks which one');
  await open('index');
  await page.setInputFiles('#bm-file', f('amc-three-schemes.xlsx'));
  await page.waitForTimeout(4000);
  const many = await boxText('bm-drop');
  ok('the file is reported as read, not as failed',
     (await page.locator('#bm-drop.loaded').count()) === 1, many);
  ok('and the box says what the question is',
     /3 schemes found/.test(many), many);
  await openCard('a');
  ok('the picker is offered', !(await page.locator('#r-scheme-wrap').isHidden()));
  await page.locator('#r-scheme-list .hit:not(.combined)').first().click();
  await page.waitForTimeout(1500);
  /* The chosen SCHEME is what the door names, not the workbook it came out
     of: "amc-three-schemes.xlsx" tells a reader nothing about what is being
     measured. */
  ok('choosing one loads it',
     (await page.locator('#door-a').getAttribute('data-state')) === 'loaded' &&
     /Alpha Fund/.test(await page.locator('#door-a-status').innerText()),
     await page.locator('#door-a-status').innerText());

  /* ======================================================= AMFI semicolons */
  section('AMFI’s own semicolon file');
  await open('index');
  await page.setInputFiles('#bm-file', f('amfi-alpha-nav.csv'));
  await page.waitForTimeout(2500);
  const amfi = await boxText('bm-drop');
  ok('it is accepted', (await page.locator('#bm-drop.loaded').count()) === 1, amfi);
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  ok('and the Net Asset Value column is the one measured, at 14%',
     /Median Rolling Return 14\.0%/.test(flat(await page.locator('#r-out').innerText())),
     (flat(await page.locator('#r-out').innerText())).match(/Median Rolling Return[^A-Z]{0,20}/));

  /* ================================================================= a PDF */
  section('A PDF is refused for being a PDF');
  await open('index');
  await page.setInputFiles('#bm-file', f('account-statement.pdf'));
  await page.waitForTimeout(1500);
  const pdfBox = await boxText('bm-drop');
  const pdfWhy = flat(await page.locator('#bm-status').innerText());
  ok('the box says the file was not added',
     (await page.locator('#bm-drop.refused').count()) === 1 && /Not added/.test(pdfBox), pdfBox);
  ok('naming the file, so there is no doubt which one',
     /account-statement\.pdf/.test(pdfBox), pdfBox);
  ok('the reason is that it is a PDF',
     /not a spreadsheet/.test(pdfWhy) && /PDF/.test(pdfWhy), pdfWhy);
  ok('and it is NOT called a trade log, which it is not',
     !/trade logs|transaction records/i.test(pdfWhy), pdfWhy);
  ok('it says what to do instead, in steps that exist',
     /CSV or Excel/.test(pdfWhy) && /paste/.test(pdfWhy), pdfWhy);
  await openCard('a');
  ok('the reason is under the box, not somewhere down the page',
     await page.evaluate(() => {
       const b = document.querySelector('#bm-drop'), s = document.querySelector('#bm-status');
       return !!b && !!s && s.getBoundingClientRect().top - b.getBoundingClientRect().bottom < 120;
     }));
  ok('nothing was loaded', await page.locator('#r-run').isDisabled());

  section('A PDF renamed .csv is still a PDF');
  await open('index');
  await page.setInputFiles('#bm-file', f('statement-renamed.csv'));
  await page.waitForTimeout(1500);
  const renamed = flat(await page.locator('#bm-status').innerText());
  ok('the contents decide, not the ending',
     /not a spreadsheet/.test(renamed), renamed);
  ok('and still not a trade log', !/trade logs/i.test(renamed), renamed);

  /* ============================================== the refusals that are right */
  section('A tradebook is still refused, and called one');
  await open('index');
  await page.setInputFiles('#bm-file', f('zerodha-tradebook.csv'));
  await page.waitForTimeout(2000);
  const tb = flat(await page.locator('#bm-status').innerText());
  ok('it is named as a trade log', /trade logs or transaction records/.test(tb), tb);
  ok('and the columns that gave it away are listed, snake_case and all',
     /trade_date/.test(tb) && /trade_type/.test(tb) &&
     /quantity/.test(tb) && /order_id/.test(tb), tb);
  ok('the box shows it was not added',
     (await page.locator('#bm-drop.refused').count()) === 1);

  section('Right heading, wrong contents');
  await open('index');
  await page.setInputFiles('#bm-file', f('text-in-nav-column.csv'));
  await page.waitForTimeout(1500);
  const txt = flat(await page.locator('#bm-status').innerText());
  ok('a NAV column of text halts processing',
     /does not hold numbers/.test(txt), txt);
  ok('and is not described as a trade log', !/trade logs/i.test(txt), txt);

  /* ============================================================== recovery */
  section('Getting it wrong once does not trap the reader');
  ok('the box still offers another try',
     /Choose another file/.test(await boxText('bm-drop')), await boxText('bm-drop'));
  await page.setInputFiles('#bm-file', f('amc-nav-history.xlsx'));
  await page.waitForTimeout(3500);
  ok('and a good file after a bad one is accepted',
     (await page.locator('#bm-drop.loaded').count()) === 1, await boxText('bm-drop'));
  ok('with the refusal cleared away',
     flat(await page.locator('#bm-status').innerText()) === '',
     flat(await page.locator('#bm-status').innerText()));

  section('The same file, chosen twice');
  await page.setInputFiles('#bm-file', f('amfi-alpha-nav.csv'));
  await page.waitForTimeout(2500);
  ok('a second, different file replaces the first',
     /amfi-alpha-nav\.csv/.test(await boxText('bm-drop')), await boxText('bm-drop'));
  await page.setInputFiles('#bm-file', f('amfi-alpha-nav.csv'));
  await page.waitForTimeout(2500);
  ok('and re-choosing the SAME file is not silently ignored',
     (await page.locator('#bm-drop.loaded').count()) === 1 &&
     /amfi-alpha-nav\.csv/.test(await boxText('bm-drop')), await boxText('bm-drop'));

  /* ================================================================ paste */
  section('Pasting two columns out of a spreadsheet');
  await open('index');
  await openCard('a');
  ok('the option is offered', await page.locator('#bm-paste-open').isVisible());
  await page.click('#bm-paste-open');
  await page.waitForTimeout(200);
  ok('and opens a box to paste into', await page.locator('#bm-paste-box').isVisible());
  const pasted = (() => {
    const L = [];
    let v = 100, t = Date.UTC(2012, 0, 1);
    while (t <= Date.UTC(2025, 0, 1)) {
      L.push(new Date(t).toISOString().slice(0, 10) + '\t' + v.toFixed(4));
      v *= Math.pow(1.15, 1 / 365.2425); t += 86400000;
    }
    return L.join('\n');
  })();
  /* Set on the element rather than typed in.
   *
   * Thirteen years is 95 KB, and page.fill() drives that through the input
   * pipeline a chunk at a time and never finishes -- it is the harness that
   * cannot take it, not the page: setting the value outright and reading it
   * takes the tool about two and a half seconds. Paste is what a reader does
   * anyway, and a paste sets the value and raises input; it does not type. */
  async function pasteInto(prefix, text) {
    await page.locator('#' + prefix + '-paste-text').evaluate((el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  }
  await pasteInto('bm', pasted);
  await page.click('#bm-paste-read');
  await page.waitForTimeout(2500);
  const pasteBox = await boxText('bm-drop');
  ok('tab-separated rows straight out of Excel are read',
     (await page.locator('#bm-drop.loaded').count()) === 1, pasteBox);
  ok('and are named as pasted rather than given a filename that does not exist',
     /pasted columns/.test(pasteBox), pasteBox);
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  ok('a 15% paste measures 15% a year',
     /Median Rolling Return 15\.0%/.test(flat(await page.locator('#r-out').innerText())),
     (flat(await page.locator('#r-out').innerText())).match(/Median Rolling Return[^A-Z]{0,20}/));
  await page.click('#bm-paste-open');
  await page.waitForTimeout(150);
  ok('and the paste box folds away again', await page.locator('#bm-paste-box').isHidden());

  /* ====================================================== the benchmark door */
  section('Card B behaves the same way');
  await open('index');
  await page.setInputFiles('#bm-file', f('amfi-alpha-nav.csv'));
  await page.waitForTimeout(2500);
  await openCard('b');
  await page.locator('#cmp-drop').scrollIntoViewIfNeeded();
  await page.setInputFiles('#cmp-file', f('nse-nifty50-tri.csv'));
  await page.waitForTimeout(2500);
  const cmp = await boxText('cmp-drop');
  ok('the benchmark box confirms in the same words',
     (await page.locator('#cmp-drop.loaded').count()) === 1 &&
     /File added successfully/.test(cmp), cmp);
  ok('and it too is on screen without scrolling',
     await page.evaluate(() => {
       const doors = document.querySelector('#up-doors');
       const onPhone = doors && doors.getBoundingClientRect().height > 0;
       const b = document.querySelector(onPhone ? '#door-b[data-state="loaded"]'
                                                : '#cmp-drop.loaded');
       const r = b && b.getBoundingClientRect();
       return !!r && r.top >= 0 && r.bottom <= window.innerHeight;
     }));
  await page.click('#r-run');
  await page.waitForTimeout(2200);
  const both = flat(await page.locator('#r-out').innerText());
  ok('and the comparison runs on both files: 14% against 12%',
     /Average Rolling Return \(Mean\) 14\.0% 12\.0%/.test(both),
     (both.match(/Average Rolling Return \(Mean\)[^A-Z]{0,26}/) || [''])[0]);
  ok('a PDF at the benchmark door is refused there too',
     await (async () => {
       await page.setInputFiles('#cmp-file', f('account-statement.pdf'));
       await page.waitForTimeout(1500);
       return /not a spreadsheet/.test(flat(await page.locator('#cmp-status').innerText()));
     })(), flat(await page.locator('#cmp-status').innerText()));

  /* The other half of the same report: "when I uploaded portfolio data in
     the Benchmark Index Data section, it also accepted it." */
  section('A fund NAV file at the Benchmark Index door is turned away');
  await page.setInputFiles('#cmp-file', f('amfi-alpha-nav.csv'));
  await page.waitForTimeout(2500);
  const wrongB = flat(await page.locator('#cmp-status').innerText());
  ok('the box shows it was not added',
     (await page.locator('#cmp-drop.refused').count()) === 1, await boxText('cmp-drop'));
  ok('it is named as fund NAV data', /looks like fund NAV data/.test(wrongB), wrongB);
  ok('with the words that gave it away',
     /Net Asset Value|Direct\/Regular plan|Scheme/i.test(wrongB), wrongB);
  ok('and it points at the door the file belongs to',
     /card 1/.test(wrongB) && /Primary Investment Data/.test(wrongB), wrongB);

  /* ============================================= a workbook that opens on a cover */
  section('A multi-tab workbook is read from the tab that holds the data');
  await open('index');
  await page.setInputFiles('#bm-file', f('cas-multitab.xlsx'));
  await page.waitForTimeout(4000);
  const multitab = await boxText('bm-drop');
  ok('the cover page does not defeat the workbook',
     (await page.locator('#bm-drop.loaded').count()) === 1, multitab);
  ok('the data was found on the later tab, whole',
     /[\d,]+ rows read/.test(multitab) && /01-Jan-2014 to 01-Jan-2025/.test(multitab), multitab);
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  ok('and an 11% workbook measures 11% a year',
     /Median Rolling Return 11\.0%/.test(flat(await page.locator('#r-out').innerText())),
     (flat(await page.locator('#r-out').innerText())).match(/Median Rolling Return[^A-Z]{0,20}/));

  /* ================================================== what was removed, gone */
  section('The empty dropdown is gone');
  await open('index');
  ok('no bundled-history control is drawn when nothing is bundled',
     (await page.locator('#r-index').count()) === 0);
  ok('and nothing on the card announces its own emptiness',
     !/Nothing bundled/i.test(await page.locator('#up-primary').innerText()) &&
     !/No history is bundled/i.test(await page.locator('#up-primary').innerText()),
     flat(await page.locator('#up-primary').innerText()).slice(0, 200));

  /* ============================================================= My own fund */
  section('My own fund gets the same box');
  await open('fund');
  ok('it starts as an invitation',
     (await page.locator('#f-drop.loaded, #f-drop.refused').count()) === 0);
  await page.locator('#f-drop').scrollIntoViewIfNeeded();
  await page.setInputFiles('#f-file', f('amc-nav-history.xlsx'));
  await page.waitForTimeout(3500);
  const fund = await boxText('f-drop');
  ok('a workbook is confirmed in the box',
     (await page.locator('#f-drop.loaded').count()) === 1 &&
     /File added successfully/.test(fund), fund);
  ok('with the file name and what was read',
     /amc-nav-history\.xlsx/.test(fund) && /[\d,]+ rows read/.test(fund), fund);
  ok('and it is on screen without scrolling',
     await page.evaluate(() => {
       const b = document.querySelector('#f-drop.loaded');
       const r = b && b.getBoundingClientRect();
       return !!r && r.top >= 0 && r.bottom <= window.innerHeight;
     }));
  await page.click('#r-run');
  await page.waitForTimeout(2000);
  /* Case-insensitive: the stat card's label is uppercased by the stylesheet,
     and innerText reports what is rendered. */
  ok('and the fund path still computes 13% on a 13% file',
     /median 13\.0%/i.test(flat(await page.locator('#r-out').innerText())),
     (flat(await page.locator('#r-out').innerText())).match(/[Mm]edian[^|]{0,30}/));

  section('My own fund refuses the same things, in the same place');
  await open('fund');
  await page.setInputFiles('#f-file', f('account-statement.pdf'));
  await page.waitForTimeout(1500);
  const fpdf = flat(await page.locator('#f-status').innerText());
  ok('a PDF is refused as a PDF',
     /not a spreadsheet/.test(fpdf) && !/trade logs/i.test(fpdf), fpdf);
  ok('and the box says it was not added',
     (await page.locator('#f-drop.refused').count()) === 1);
  await page.setInputFiles('#f-file', f('amc-three-schemes.xlsx'));
  await page.waitForTimeout(4000);
  ok('a many-scheme workbook is read, and asks which fund',
     (await page.locator('#f-drop.loaded').count()) === 1 &&
     /3 funds found/.test(await boxText('f-drop')), await boxText('f-drop'));

  section('Pasting works on the fund path too');
  await open('fund');
  await page.click('#f-paste-open');
  await page.waitForTimeout(200);
  await pasteInto('f', pasted);
  await page.click('#f-paste-read');
  await page.waitForTimeout(2500);
  ok('the pasted rows are accepted',
     (await page.locator('#f-drop.loaded').count()) === 1, await boxText('f-drop'));

  /* ============================================ the tap answers immediately */
  /* The phone's own file app takes a second or two to appear, and for that
     second or two nothing on the page used to change -- so the button read as
     broken and got tapped again. Nothing here can hurry the phone; the page
     answers the tap while it waits. The picker never opens in this browser,
     which is exactly the state being tested. */
  section('The Choose a file button answers the tap while the picker opens');
  await open('index');
  await openCard('a');
  await page.locator('#bm-pick').click();
  await page.waitForTimeout(150);
  ok('the button says it is busy the moment it is tapped',
     (await page.getAttribute('#bm-pick', 'data-opening')) === 'yes' &&
     (await page.getAttribute('#bm-pick', 'aria-busy')) === 'true');
  ok('and a turning ring is drawn on it',
     await page.evaluate(() => {
       const cs = getComputedStyle(document.querySelector('#bm-pick'), '::after');
       return cs.animationName === 'spin' && parseFloat(cs.width) > 8;
     }));
  ok('the wait is said in words, not only drawn',
     /Opening your files… this can take a moment\./.test(
       flat(await page.locator('#bm-drop .pickwait').innerText())),
     flat(await page.locator('#bm-drop').innerText()));
  ok('and the button keeps its own label',
     flat(await page.locator('#bm-pick').innerText()) === 'Choose a file',
     flat(await page.locator('#bm-pick').innerText()));
  /* The picker closing without a file: the window gets its focus back. */
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(600);
  ok('a picker dismissed with nothing chosen puts the button back',
     (await page.getAttribute('#bm-pick', 'data-opening')) === null &&
     (await page.locator('.pickwait').count()) === 0);
  /* And a file arriving ends it too, whatever the browser reports. */
  await page.locator('#bm-pick').click();
  await page.waitForTimeout(120);
  await page.setInputFiles('#bm-file', f('amfi-alpha-nav.csv'));
  await page.waitForTimeout(2000);
  ok('a file arriving ends the wait',
     (await page.locator('.pickwait').count()) === 0 &&
     (await page.locator('[data-opening="yes"]').count()) === 0);

  /* The fund path and the portfolio door have the same button and the same
     wait behind it. */
  await open('fund');
  await page.locator('#f-pick').click();
  await page.waitForTimeout(150);
  ok('the fund path’s door answers the same way',
     (await page.getAttribute('#f-pick', 'data-opening')) === 'yes' &&
     (await page.locator('#f-drop .pickwait').count()) === 1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(600);
  ok('and puts itself back', (await page.locator('.pickwait').count()) === 0);

  await page.goto(BASE_URL + '#portfolio', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.locator('#pf-pick').click();
  await page.waitForTimeout(150);
  ok('so does the portfolio door',
     (await page.getAttribute('#pf-pick', 'data-opening')) === 'yes' &&
     (await page.locator('#pf-drop .pickwait').count()) === 1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(600);
  ok('and puts itself back too', (await page.locator('.pickwait').count()) === 0);

  /* ================================================================= reset */
  section('Start again puts every box back');
  await open('index');
  await page.setInputFiles('#bm-file', f('amfi-alpha-nav.csv'));
  await page.waitForTimeout(2500);
  await page.click('#r-reset');
  await page.waitForTimeout(500);
  await page.click('#r-source .chip[data-source="index"]');
  await page.waitForTimeout(300);
  ok('the box is an invitation again',
     (await page.locator('#bm-drop.loaded').count()) === 0 &&
     /Choose a file/.test(await boxText('bm-drop')), await boxText('bm-drop'));

  ok('no script errors in the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
