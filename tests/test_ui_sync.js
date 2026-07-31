/* UI behaviour tests: voice/lock synchronisation and the scroll cue.
 * Run: node tests/test_ui_sync.js      (skips cleanly if jsdom is absent)
 *
 * These lock in two things that are easy to break and impossible to eyeball:
 *   1. the amount screen, its lock and the voice must land together, and the
 *      lock must release when she stops - on engines that fire speech events
 *      AND on engines that never do (the reported Vivo behaviour);
 *   2. the scroll cue must appear only where content genuinely overflows.
 */
'use strict';
let boot;
try { boot = require('./ui_harness.js').boot; }
catch (e) {
  console.log('· test_ui_sync: jsdom not installed - skipping (npm i -D jsdom to enable)');
  process.exit(0);
}

let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? '  \u2713 ' : '  \u2717 ') + n + (c ? '' : '   ' + x)); if (!c) fail++; };


async function toStrike(mode) {
  const env = await boot(mode);
  const { d, advance, click } = env;
  click(d.getElementById('introBtn')); advance(1200);
  click(d.querySelector('#w_scenario .em-scn')); advance(1500);
  click(d.querySelector('#w_duration .opt')); advance(900);
  click(d.querySelector('#w_sip .opt')); advance(900);
  click(d.querySelector('#w_emType .opt')); advance(900);
  click(d.querySelector('#w_severity .opt')); advance(1500);
  if (d.getElementById('emIntro').hidden) throw new Error('emIntro not reached');
  env.spoken.length = 0;                       // ignore anything before the strike
  click(d.getElementById('emIntroBtn'));       // -> emToStrike, t=0
  return env;
}

async function lockTests() {
  for (const mode of [
    { name: 'phone that DOES fire speech events', fireStart: true,  fireEnd: true,  startDelay: 3000 },
    { name: 'phone that NEVER fires them (reported Vivo case)', fireStart: false, fireEnd: false, startDelay: 3000 },
    { name: 'fast phone (voice starts in 300ms)', fireStart: true, fireEnd: true, startDelay: 300 },
  ]) {
    console.log('\n════ ' + mode.name + ' ════');
    const env = await toStrike(mode);
    const { d, advance, spoken } = env;
    const shown = () => !d.getElementById('emStrike').hidden;
    const locked = () => d.body.classList.contains('voice-live');

    ok('the amount line is requested immediately', spoken.some(t => /You need/.test(t)), JSON.stringify(spoken));
    ok('at t=0: screen not yet flipped, nothing locked', !shown() && !locked());

    advance(mode.startDelay < 1000 ? 400 : 1750);
    ok('screen has appeared', shown());
    ok('lock is ON at the same moment', locked());

    advance(1500);
    ok('still locked while she is speaking', locked());

    advance(4000);
    ok('lock RELEASES after she finishes', !locked(), 'body="' + d.body.className + '"');
    ok('screen still visible after release', shown());
  }
}


async function cueTests() {
  const env = await boot({ fireStart: true, fireEnd: true });
  const { w, d, advance } = env;

  // jsdom has no layout, so drive the geometry the cue reads.
  const geom = new Map();
  const setGeom = (el, scrollH, clientH, scrollTop = 0) => geom.set(el, { scrollH, clientH, scrollTop });
  for (const el of [...d.querySelectorAll('.screen, .overlay'), d.documentElement]) {
    Object.defineProperty(el, 'scrollHeight', { get: () => (geom.get(el) || {}).scrollH || 0, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => (geom.get(el) || {}).clientH || 0, configurable: true });
    Object.defineProperty(el, 'scrollTop', { get: () => (geom.get(el) || {}).scrollTop || 0, set() {}, configurable: true });
  }
  // only #setup is a real scroll container (matches styles.css)
  const realCS = w.getComputedStyle;
  w.getComputedStyle = (el) => (el && el.id === 'setup')
    ? { overflowY: 'auto' } : { overflowY: 'visible' };

  // tap Begin so the intro overlay is closed (an open overlay is, correctly,
  // the only surface considered — that is what the app does by design).
  d.getElementById('introBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  advance(1200);
  const scroller = d.scrollingElement || d.documentElement;
  for (const el of [scroller]) {
    Object.defineProperty(el, 'scrollHeight', { get: () => (geom.get(el) || {}).scrollH || 0, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => (geom.get(el) || {}).clientH || 0, configurable: true });
    Object.defineProperty(el, 'scrollTop', { get: () => (geom.get(el) || {}).scrollTop || 0, set() {}, configurable: true });
  }
  const cue = d.getElementById('scrollCue');
  const setup = d.getElementById('setup'), stage = d.getElementById('stage'), result = d.getElementById('result');
  const refresh = () => { w.dispatchEvent(new w.Event('resize')); advance(50); };
  const showing = () => cue.classList.contains('on');
  const reset = () => { geom.clear(); [setup, stage, result].forEach(e => { e.hidden = e !== setup; }); result.classList.remove('show'); };

  console.log('\n════ scroll cue: only where content really overflows ════');

  reset(); setGeom(setup, 1400, 800); refresh();
  ok('tall wizard step (600px hidden) → cue SHOWS', showing());

  reset(); setGeom(setup, 812, 800); refresh();
  ok('short step with 12px rounding slack → NO cue', !showing());

  reset(); setGeom(setup, 900, 800); refresh();
  ok('100px slack (below the 120 threshold) → NO cue', !showing());

  reset(); setGeom(setup, 1400, 800, 1300); refresh();
  ok('scrolled to the bottom → cue HIDES', !showing());

  // an open overlay that does not scroll, over a scrollable screen behind it
  reset(); result.hidden = false; result.classList.add('show');
  setGeom(result, 700, 800); setGeom(setup, 3000, 800); refresh();
  ok('overlay open & not scrollable (scrollable screen behind) → NO cue', !showing());

  reset(); result.hidden = false; result.classList.add('show');
  setGeom(result, 2000, 800); refresh();
  ok('overlay open AND scrollable → cue SHOWS', showing());

  // a screen that is NOT its own scroll container must not be treated as one
  reset(); setup.hidden = true; stage.hidden = false;
  setGeom(stage, 3000, 800); setGeom(scroller, 800, 800); refresh();
  ok('non-scrolling screen (#stage) → NO cue', !showing());

  reset(); setup.hidden = true; stage.hidden = false;
  setGeom(stage, 800, 800); setGeom(scroller, 2000, 800); refresh();
  ok('page itself scrolls → cue SHOWS', showing());

  w.getComputedStyle = realCS;
}

(async () => {
  await lockTests();
  await cueTests();
  console.log(fail ? `\n\u2717 ${fail} UI FAILURES` : `\n\u2713 all UI sync + scroll-cue behaviour verified`);
  process.exit(fail ? 1 : 0);
})();
