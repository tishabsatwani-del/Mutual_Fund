/* Real-browser layout tests (Playwright + Chromium).
 * Run: node tests/test_ui_browser.js     (skips cleanly if Playwright is absent)
 *
 * These exist because a DOM stub is not enough: jsdom has no layout, so it
 * cannot answer the only question the scroll cue actually cares about —
 * "is there another CHOICE below the fold?". Measured on a real engine,
 * #setup's scrollHeight sits 170-210px past the viewport on EVERY wizard step
 * (trailing legal line + padding), and #setup's own box can be 872px tall
 * inside a 640px screen. Both facts broke earlier threshold-based attempts.
 */
'use strict';
let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('· test_ui_browser: playwright not installed - skipping'); process.exit(0); }
const fs = require('fs'), path = require('path');
const PAGE = 'file://' + path.join(__dirname, '..', 'index.html');
const EXE = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => { try { return fs.existsSync(f); } catch (e) { return false; } });

let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '   ' + x)); if (!c) fail++; };

(async () => {
  let b;
  try { b = await chromium.launch(EXE ? { executablePath: EXE, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] }); }
  catch (e) { console.log('· test_ui_browser: no usable chromium - skipping (' + e.message.split('\n')[0] + ')'); process.exit(0); }

  for (const vp of [{ w: 390, h: 844 }, { w: 360, h: 640 }, { w: 412, h: 915 }]) {
    const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { console.log('  !! page error: ' + e.message); fail++; });
    await p.goto(PAGE); await p.waitForTimeout(500);
    console.log(`\n  ---- ${vp.w}x${vp.h} ----`);
    const probe = () => p.evaluate(() => {
      const step = [...document.querySelectorAll('.wstep')].filter((s) => !s.hidden)[0];
      const opts = step ? [...step.querySelectorAll('.opt')] : [];
      const last = opts[opts.length - 1];
      const hidden = last ? Math.round(last.getBoundingClientRect().bottom - window.innerHeight) : null;
      return { step: step && step.id, hidden, cue: document.getElementById('scrollCue').classList.contains('on') };
    });
    const check = async (label) => {
      const r = await probe();
      const should = r.hidden !== null && r.hidden > 8;
      ok(`${label.padEnd(9)} last choice ${String(r.hidden).padStart(5)}px below fold -> cue ${r.cue ? 'ON' : 'off'}`, r.cue === should);
    };
    await p.click('#introBtn'); await p.waitForTimeout(900); await check('doors');
    await p.click('#w_scenario .crash-scn'); await p.waitForTimeout(1200); await check('duration');
    await p.click('#w_duration .opt'); await p.waitForTimeout(800); await check('sip');
    await p.click('#w_sip .opt'); await p.waitForTimeout(800); await check('storm');
    await p.evaluate(() => { const s = document.getElementById('setup'); s.scrollTop = s.scrollHeight; });
    await p.waitForTimeout(400);
    ok('scrolled to the bottom -> cue off', !(await p.evaluate(() => document.getElementById('scrollCue').classList.contains('on'))));
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `\n✗ ${fail} BROWSER FAILURES` : '\n✓ scroll cue correct on every wizard screen and viewport');
  process.exit(fail ? 1 : 0);
})();
