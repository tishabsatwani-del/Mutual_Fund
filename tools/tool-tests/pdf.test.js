/* Save as PDF: built in the browser from a light print layout, every result
 * tab in it, a footer on every page, downloaded as a file -- and not one
 * request to any other site while it happens.
 *
 * Run: node tools/tool-tests/pdf.test.js   (server: python3 -m http.server 8781 from the repo root)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = process.env.PRC_TMP || '/tmp/prc';
const CHROME = process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE_URL = process.env.PRC_URL || 'http://127.0.0.1:8781/tool/';
fs.mkdirSync(path.join(TMP, 'pdf'), { recursive: true });

let pass = 0; const fails = [];
function ok(n, c, d) {
  if (c) { pass++; console.log('  pass  ' + n); }
  else { fails.push(n); console.log('  FAIL  ' + n + (d ? '  -- ' + String(d).slice(0, 240) : '')); }
}
function section(t) { console.log('\n' + t); }

function navFile(file, rate, fromY, toY, start, head) {
  const out = [head || 'Date,NAV']; let v = start || 100, t = Date.UTC(fromY, 0, 1);
  while (t <= Date.UTC(toY, 0, 1)) {
    out.push(new Date(t).toISOString().slice(0, 10) + ',' + v.toFixed(4));
    v *= Math.pow(1 + rate, 1 / 365.2425); t += 86400000;
  }
  fs.writeFileSync(file, out.join('\n')); return file;
}
function pdfText(file) {
  try { return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }); }
  catch (e) { return null; }
}
function pageCount(buf) {
  const s = buf.toString('latin1');
  const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  return pages;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], foreign = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith(BASE_URL.replace(/tool\/$/, ''))) foreign.push(r.url()); });

  const fund = navFile(TMP + '/pdf-fund.csv', 0.12, 2016, 2025, 100);
  const tri = navFile(TMP + '/pdf-nifty-50-tri.csv', 0.10, 2016, 2025, 1000, 'Date,Index Value');

  section('Rolling returns: the PDF button on the tab row');
  await page.goto(BASE_URL + '#rolling', { waitUntil: 'networkidle' });
  await page.click('#r-source .chip[data-source="index"]');
  await page.waitForTimeout(300);
  await page.setInputFiles('#bm-file', fund);
  await page.waitForTimeout(1500);
  await page.setInputFiles('#cmp-file', tri);
  await page.waitForTimeout(1500);
  await page.locator('#r-years .chip[data-years="3"]').click();
  await page.waitForTimeout(250);
  await page.click('#r-run');
  await page.waitForTimeout(2500);
  ok('the button sits at the right end of the tab row, and again at the foot',
     (await page.locator('#r-out .ixtabs .pdfbtn').count()) === 1 &&
     (await page.locator('#r-out .pdfrow .pdfbtn').count()) === 1);
  ok('nothing on the results sticks: the header card is static and appears once',
     (await page.locator('#r-out .resulthead').count()) === 1 &&
     (await page.locator('#r-out .stickybar').count()) === 0 &&
     await page.evaluate(() => getComputedStyle(document.querySelector('#r-out .resulthead')).position === 'static'));
  ok('no Print button remains', (await page.locator('.printbtn').count()) === 0);

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('#r-out .ixtabs .pdfbtn').click()
  ]);
  const name = dl.suggestedFilename();
  ok('the file is named Where-You-Stand-<fund>-<date>.pdf',
     /^Where-You-Stand-[A-Za-z0-9-]+-\d{4}-\d{2}-\d{2}\.pdf$/.test(name), name);
  const saved = path.join(TMP, 'pdf', name);
  await dl.saveAs(saved);
  const buf = fs.readFileSync(saved);
  ok('it is a PDF of some size', buf.slice(0, 4).toString() === '%PDF' && buf.length > 20000, buf.length);
  ok('with more than one page', pageCount(buf) >= 2, pageCount(buf));
  const text = pdfText(saved);
  if (text == null) console.log('  (pdftotext not available; text checks skipped)');
  else {
    ok('every page carries a page number and the not-a-forecast footer',
       /Page 1 of \d+/.test(text) && /Page 2 of \d+/.test(text) && /not a forecast/.test(text));
  }
  /* The body is rasterised (html2canvas), so what went in is read from the
     build record rather than from the PDF's text layer. */
  const built = await page.evaluate(() => window.PRCPdf.lastBuild);
  ok('all four result tabs went into the print layout, every table open',
     built && built.panels === 4 && built.details > 0, JSON.stringify(built));
  ok('and the full window table went in as text pages, one row per window',
     built && built.appendixRows > 1000, JSON.stringify(built));
  if (text != null) {
    ok('the window rows are real text in the PDF (searchable, legible)',
       /Every 3-year window, one per row/.test(text) && /Window starts/.test(text) &&
       (text.match(/\d{2}-[A-Z][a-z]{2}-\d{4}/g) || []).length > 1000,
       (text.match(/\d{2}-[A-Z][a-z]{2}-\d{4}/g) || []).length + ' dates found');
  }
  ok('and the page count matches what jsPDF wrote', built && built.pages === pageCount(buf),
     built && built.pages + ' vs ' + pageCount(buf));
  /* A rendered page that is not blank: page 2 as a PNG is far larger than a
     white sheet. */
  /* The rasterised body: page 1 must carry ink well beyond the footer line. */
  try {
    const dark = execFileSync('python3', ['-c', `
import sys
from PIL import Image
import subprocess, glob, os
subprocess.run(['pdftoppm','-png','-r','40','-f','1','-l','1',sys.argv[1],sys.argv[2]+'/chk'],check=True)
f=sorted(glob.glob(sys.argv[2]+'/chk*.png'))[0]
im=Image.open(f).convert('L'); px=list(im.getdata())
print(sum(1 for v in px if v<200))`, saved, path.join(TMP, 'pdf')], { encoding: 'utf8' }).trim();
    ok('page 1 renders with content on it, not a blank sheet', +dark > 3000, dark + ' dark pixels');
  } catch (e) { console.log('  (render check skipped: ' + e.message.slice(0, 80) + ')'); }
  await page.waitForTimeout(500);
  ok('the button is back to rest after the download',
     (await page.locator('#r-out .ixtabs .pdfbtn[data-busy]').count()) === 0);
  ok('the print clone was removed from the page', (await page.locator('.pdfclone, .pdfhide').count()) === 0);

  section('Plan my goal and Check my portfolio carry the same button');
  await page.goto(BASE_URL + '#goal', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.click('#g-calc');
  await page.waitForTimeout(800);
  ok('the goal result ends with Save as PDF', (await page.locator('#g-out .pdfrow .pdfbtn').count()) === 1);
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('#g-out .pdfbtn').click()
  ]);
  ok('and it downloads a PDF', /^Where-You-Stand-.*\.pdf$/.test(dl2.suggestedFilename()), dl2.suggestedFilename());

  await page.goto(BASE_URL + '#portfolio', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.click('#pf-manual');
  await page.waitForTimeout(300);
  await page.click('#pf-demo');
  await page.waitForTimeout(300);
  await page.click('#pf-calc');
  await page.waitForTimeout(1200);
  ok('the portfolio result ends with Save as PDF', (await page.locator('#pf-out .pdfrow .pdfbtn').count()) === 1);

  section('The failure path says what to do instead');
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('blocked'); }; });
  await page.locator('#pf-out .pdfbtn').click();
  await page.waitForTimeout(6000);
  ok('one line, in the specified words',
     (await page.locator('#pf-out .pdfnote').innerText()).trim() ===
       'Your browser blocked the download. Use Share → Print → Save as PDF.',
     await page.locator('#pf-out .pdfnote').innerText());

  ok('no request left this site at any point', foreign.length === 0, foreign.slice(0, 3).join(' | '));
  ok('no script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})();
