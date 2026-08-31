/* Where You Stand — the screenshot set, review §9 step 7.
 *
 * Twenty shots: the six screens showing their readings, and four more showing
 * the door a ledger comes in through, each on the day sheet and the night, at
 * a real phone's size. Run it, and the whole set is regenerated.
 *
 * THE POINT OF THE --fund FLAG
 *
 * Step 7 asks for shots on real data. Pass a NAV file and it uses that, so the
 * day the author has an official history on disk the set is one command away
 * with no code change:
 *
 *   node tools/v3/shoot.js --fund ~/Downloads/some-real-fund.csv \
 *                          --label "Fund name, official history to DD Mon YYYY"
 *
 * With no --fund it generates a SYNTHETIC series and names the file so the
 * tool prints "not-a-real-fund" everywhere it names a fund. That is deliberate.
 * A rolling-return reading looks equally authoritative whether or not its input
 * was real, which is the whole reason tool/data/README.md forbids inventing a
 * series -- and a screenshot of such a reading carries the same danger in a
 * form that travels further than the tool does. Every shot then gets a caption
 * strip composited beneath it saying so.
 *
 *   node tools/v3/shoot.js                 # the fixture set, captioned as such
 *   node tools/v3/shoot.js --out /tmp/x    # somewhere else
 *
 * Needs a static server on the repo root at 8781, and playwright installed.
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = arg('url', process.env.PRC_URL_V3 || 'http://127.0.0.1:8781/tool/v3/');
const CHROME = arg('chrome', process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const OUT = path.resolve(arg('out', path.join(__dirname, '../../tool/v3/shots')));
const TMP = process.env.PRC_TMP || '/tmp/prc';

/* A phone, at the pixel density a phone actually has. */
const PHONE = { width: 390, height: 844 };
const SCALE = 2;

const realFund = arg('fund', null);
const label = arg('label', null);

/* ------------------------------------------------------------ the series
 *
 * Generated only when no real file is given. Nothing here is a claim about any
 * fund: it is a smooth drift with a slow wobble on it, which exists so the
 * screens have something to lay out, and it is named so that no reader of a
 * screenshot could take it for a record of anything. */
function writeFixture() {
  const file = path.join(TMP, 'not-a-real-fund.csv');
  const lines = ['Date,NAV'];
  let t = Date.UTC(2008, 0, 1), v = 10;
  while (t <= Date.UTC(2025, 0, 1)) {
    const d = new Date(t), dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      lines.push(`${String(d.getUTCDate()).padStart(2, '0')}-` +
                 `${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
                 `${d.getUTCFullYear()},${v.toFixed(4)}`);
    }
    v *= Math.pow(1.14, 1 / 365.2425) * (1 + Math.sin(t / 7e9) * 0.0016);
    t += 86400000;
  }
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

/* The ledger the door reads in shots 07-10. Unsigned amounts and a type
 * column, because that is the shape that makes the door ask which way the
 * money went -- which is the thing these four shots exist to show. The file is
 * named so that nothing in the shots could be taken for anybody's statement. */
function writeLedgerFixture() {
  const file = path.join(TMP, 'not-a-real-ledger.csv');
  const rows = [
    ['05-04-2021', 'Purchase', '25000'],
    ['05-05-2021', 'SIP', '5000'],
    ['05-06-2021', 'SIP', '5000'],
    ['05-07-2021', 'SIP', '5000'],
    ['05-08-2021', 'SIP', '5000'],
    ['14-08-2023', 'Redemption', '40000']
  ];
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(file, 'Date,Transaction Type,Amount\n' +
    rows.map(r => r.join(',')).join('\n') + '\n');
  return file;
}

const FUND = realFund ? path.resolve(realFund) : writeFixture();
const LEDGER = writeLedgerFixture();
const SYNTHETIC = !realFund;
const CAPTION = label || (SYNTHETIC
  ? 'Layout only. The series is generated, not a fund — no figure here describes anything that happened.'
  : 'Real history.');

/* ---------------------------------------------------------------- the six
 *
 * Each screen is driven to the state worth photographing: the readings, not the
 * empty forms. Home and About have only one state each. */
const SCREENS = [
  { id: 'home', title: 'Home' },
  { id: 'about', title: 'About this page' },
  { id: 'record', title: 'This fund’s record', drive: async p => {
      await p.setInputFiles('#r-file', FUND);
      await p.waitForTimeout(900);
      await p.click('#r-years .chip[data-y="5"]:not([disabled])').catch(async () => {
        await p.click('#r-years .chip:not([disabled])');
      });
      await p.waitForTimeout(900);
    } },
  { id: 'stand', title: 'My money in this fund', drive: async p => {
      await p.setInputFiles('#file', FUND);
      await p.waitForTimeout(900);
      await p.click('#example');
      await p.waitForTimeout(300);
      await p.click('#run');
      await p.waitForTimeout(900);
    } },
  { id: 'plan', title: 'My plan, tested', drive: async p => {
      await p.fill('#p-have', '100000');
      await p.fill('#p-monthly', '10000');
      await p.fill('#p-years', '10');
      await p.fill('#p-needed', '5000000');
      await p.waitForTimeout(700);
    } },
  { id: 'mine', title: 'My return', drive: async p => {
      await p.click('#m-example');
      await p.waitForTimeout(300);
      await p.click('#m-run');
      await p.waitForTimeout(700);
      await p.fill('#m-infl', '6');
      await p.waitForTimeout(300);
    } }
];

/* ------------------------------------------------- the ledger, in four states
 *
 * The six above photograph READINGS. These photograph the door: the three ways
 * a ledger gets in, the one question an unsigned file raises, and what the
 * screen says once it has been answered. They are the states a reader is in
 * while they are still working, which is most of the time they spend here.
 *
 * These four carry their own caption. The amounts in them are made up whether
 * or not --fund pointed at a real NAV history, and a shot of somebody's
 * transactions is exactly the thing that must never be ambiguous. */
const LEDGER_CAPTION =
  'The transactions here are made up, not anybody\'s. This shot is of the door, ' +
  'not of a result.';

const LEDGERS = [
  { id: 'mine', title: 'My return · from a spreadsheet', file: 'mine-spreadsheet',
    caption: LEDGER_CAPTION, drive: async p => {
      await p.click('#m-paste-open');
      await p.waitForTimeout(200);
    } },

  { id: 'mine', title: 'My return · which way the money went', file: 'mine-asking',
    caption: LEDGER_CAPTION, drive: async p => {
      await p.click('#m-paste-open');
      await p.setInputFiles('#m-file', LEDGER);
      await p.waitForTimeout(600);
    } },

  { id: 'mine', title: 'My return · answered', file: 'mine-read',
    caption: LEDGER_CAPTION, drive: async p => {
      await p.click('#m-paste-open');
      await p.setInputFiles('#m-file', LEDGER);
      await p.waitForTimeout(600);
      /* Redemption is the last word in the file, so it is the last tick. */
      const boxes = p.locator('#m-paste-ask input[type=checkbox]');
      await boxes.nth(await boxes.count() - 1).check();
      await p.click('#m-paste-ask-go');
      await p.waitForTimeout(500);
    } },

  { id: 'stand', title: 'My money in this fund · the same question', file: 'stand-asking',
    caption: LEDGER_CAPTION, drive: async p => {
      await p.setInputFiles('#file', FUND);
      await p.waitForTimeout(900);
      await p.click('#paste-open');
      await p.setInputFiles('#ledger-file', LEDGER);
      await p.waitForTimeout(600);
    } }
];

const ALL = SCREENS.concat(LEDGERS);

(async () => {
  if (!fs.existsSync(FUND)) { console.error('no such file: ' + FUND); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const written = [];

  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: PHONE, deviceScaleFactor: SCALE, colorScheme: scheme,
      reducedMotion: 'reduce'          /* a still of a mid-animation frame is a lie about the design */
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });

    for (const s of ALL) {
      /* Every shot starts from a clean page. Six of these are two states of the
         same screen, and a screen carried over from the previous shot would
         photograph the state before it as well as the one asked for. */
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.evaluate(h => { location.hash = h; }, s.id);
      await page.waitForTimeout(300);
      if (s.drive) await s.drive(page);
      /* Back to the top before the capture. The header is position:sticky, and
         a fullPage shot of a scrolled page composites it over whatever it was
         floating above -- which in the ledger shots is the screen's own title,
         sliced through the middle. */
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      const name = `${String(ALL.indexOf(s) + 1).padStart(2, '0')}-${s.file || s.id}-` +
                   `${scheme === 'light' ? 'day' : 'night'}.png`;
      const file = path.join(OUT, name);
      await page.screenshot({ path: file, fullPage: true });
      written.push({ file, name, title: s.title, sheet: scheme === 'light' ? 'Day' : 'Night',
                     caption: s.caption || null });
      console.log('  shot  ' + name);
    }
    if (errors.length) { console.error('script errors on the ' + scheme + ' pass:', errors.join(' | ')); process.exit(1); }
    await ctx.close();
  }
  await browser.close();

  /* The caption goes BENEATH the capture, never over it: the pixels above the
   * strip are exactly what the tool renders, and the strip is plainly not part
   * of it. */
  execFileSync('python3', [path.join(__dirname, 'stamp.py'), '--caption', CAPTION,
                           ...written.map(w => w.file + '::' + w.title + ' · ' + w.sheet +
                                               (w.caption ? '::' + w.caption : ''))],
               { stdio: 'inherit' });

  /* One sheet per palette, for the README. Twenty full-page phone captures
   * cannot go into a document one at a time -- each is three to five thousand
   * pixels tall, and a reader scrolls past the set rather than seeing it. The
   * sheet redraws the caption at a size that survives the scale, because the
   * strip on each capture is a grey smudge at contact width and a caption that
   * cannot be read is not a caption. */
  for (const sheet of ['Day', 'Night']) {
    const mine = written.filter(w => w.sheet === sheet);
    execFileSync('python3', [
      path.join(__dirname, 'contact.py'),
      '--out', path.join(OUT, 'CONTACT-' + sheet.toLowerCase() + '.png'),
      '--title', 'Where You Stand — ten screens on the ' + sheet.toLowerCase() + ' sheet',
      '--caption', CAPTION + '  Shots 07–10 hold made-up transactions. ' +
                   'Open any shot full size from tool/v3/shots/ for its own caption.',
      ...mine.map(w => w.file + '::' + w.name.replace(/-(day|night)\.png$/, ''))
    ], { stdio: 'inherit' });
  }

  fs.writeFileSync(path.join(OUT, 'INDEX.md'),
    '# The screenshot set\n\n' +
    'Generated by `node tools/v3/shoot.js`. Twenty shots at 390×844 and twice\n' +
    'that in pixels, which is a phone: six screens showing their readings, and\n' +
    'four more showing the door a ledger comes in through, each on both sheets.\n\n' +
    '**Shots 07–10 hold made-up transactions**, whether or not the NAV history\n' +
    'behind them is real, and are captioned as such.\n\n' +
    (SYNTHETIC
      ? '**The series in these shots is generated, not a fund.** No figure in them\n' +
        'describes anything that happened. Re-run with `--fund <file>` against an\n' +
        'official NAV history and the same command produces the real-data set.\n\n'
      : '**Source:** ' + CAPTION + '\n\n') +
    '| | Screen | Sheet |\n|---|---|---|\n' +
    written.map(w => '| `' + w.name + '` | ' + w.title + ' | ' + w.sheet + ' |').join('\n') + '\n');

  console.log('\n' + written.length + ' shots written to ' + OUT);
  if (SYNTHETIC) console.log('SYNTHETIC SERIES — captioned as such. Pass --fund <file> for the real-data set.');
})().catch(e => { console.error('shoot threw:', e); process.exit(1); });
