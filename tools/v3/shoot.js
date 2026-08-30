/* Where You Stand — the screenshot set, review §9 step 7.
 *
 * Twelve shots: the six screens, each on the day sheet and the night sheet, at
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

const FUND = realFund ? path.resolve(realFund) : writeFixture();
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

    for (const s of SCREENS) {
      await page.evaluate(h => { location.hash = h; }, s.id);
      await page.waitForTimeout(300);
      if (s.drive) await s.drive(page);
      await page.waitForTimeout(200);
      const name = `${String(SCREENS.indexOf(s) + 1).padStart(2, '0')}-${s.id}-${scheme === 'light' ? 'day' : 'night'}.png`;
      const file = path.join(OUT, name);
      await page.screenshot({ path: file, fullPage: true });
      written.push({ file, name, title: s.title, sheet: scheme === 'light' ? 'Day' : 'Night' });
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
                           ...written.map(w => w.file + '::' + w.title + ' · ' + w.sheet)],
               { stdio: 'inherit' });

  fs.writeFileSync(path.join(OUT, 'INDEX.md'),
    '# The screenshot set\n\n' +
    'Generated by `node tools/v3/shoot.js`. Twelve shots: six screens on both\n' +
    'sheets, at 390×844 and twice that in pixels, which is a phone.\n\n' +
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
