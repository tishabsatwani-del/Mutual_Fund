/* jsdom harness for the UI/sync tests.
 * Boots index.html + app.js in a simulated browser with a controllable clock
 * and a configurable speech engine, so voice/lock/scroll behaviour can be
 * asserted deterministically — including on engines that never fire
 * onstart/onend (the behaviour reported on Vivo).
 * Requires jsdom:  npm i -D jsdom   (tests skip cleanly when it is absent) */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = require('path').join(__dirname, '..');

async function boot({ fireStart, fireEnd, startDelay = 3000 }) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => console.log('  !! page error:', e.message));
  const html = fs.readFileSync(ROOT + '/index.html', 'utf8')
    .replace(/<script src="app\.js[^"]*"><\/script>/, '');
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://example.org/', virtualConsole: vc, runScripts: 'dangerously' });
  const w = dom.window, d = w.document;
  if (d.readyState === 'loading') await new Promise(r => d.addEventListener('DOMContentLoaded', r));

  // controllable clock (installed AFTER the page has loaded)
  let now = 0; const timers = [];
  w.setTimeout = (fn, ms) => { const id = timers.length; timers.push({ at: now + (ms || 0), fn, id, dead: false }); return id; };
  w.clearTimeout = (id) => { if (timers[id]) timers[id].dead = true; };
  w.setInterval = () => 0; w.clearInterval = () => {};
  w.requestAnimationFrame = (fn) => { const id = timers.length; timers.push({ at: now, fn, id, dead: false }); return id; };
  w.cancelAnimationFrame = (id) => { if (timers[id]) timers[id].dead = true; };
  w.performance = { now: () => now };
  const advance = (ms) => {
    const target = now + ms;
    for (let g = 0; g < 50000; g++) {
      const due = timers.filter(t => !t.dead && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.dead = true; now = Math.max(now, due.at);
      try { due.fn(now); } catch (e) {}
    }
    now = target;
  };

  const spoken = [];
  const speech = {
    speaking: false, pending: false,
    speak(u) {
      spoken.push(u.text);
      if (u.volume === 0) return;                    // silent warm-up: ignore
      speech.pending = true;
      w.setTimeout(() => {                            // engine finally begins
        speech.pending = false; speech.speaking = true;
        if (fireStart && u.onstart) u.onstart({});
        w.setTimeout(() => {
          speech.speaking = false;
          if (fireEnd && u.onend) u.onend({});
        }, 2500);
      }, startDelay);
    },
    cancel() { speech.speaking = false; speech.pending = false; },
    resume() {}, pause() {},
    getVoices: () => [{ lang: 'en-IN', localService: true, name: 'test' }],
  };
  w.speechSynthesis = speech;
  w.SpeechSynthesisUtterance = function (t) { this.text = t; };
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  const node = () => ({ connect() {}, start() {}, stop() {}, disconnect() {},
    frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
    gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
    type: '', Q: { value: 0 }, buffer: null, loop: false, playbackRate: { value: 1 } });
  w.AudioContext = w.webkitAudioContext = function () {
    return { state: 'running', currentTime: 0, destination: {}, sampleRate: 44100, resume: () => Promise.resolve(),
      createOscillator: node, createGain: node, createBiquadFilter: node, createBufferSource: node,
      createBuffer: () => ({ getChannelData: () => new Float32Array(1024) }), createDynamicsCompressor: node };
  };
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
    get: (t, k) => (k === 'measureText' ? () => ({ width: 10 })
      : (k === 'createRadialGradient' || k === 'createLinearGradient') ? () => ({ addColorStop() {} })
      : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}),
    set: () => true });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.load = function () {};
  w.navigator.vibrate = () => {};

  const sc = d.createElement('script');
  sc.textContent = fs.readFileSync(ROOT + '/app.js', 'utf8');
  d.body.appendChild(sc);
  advance(0);
  const click = (el) => { if (!el) throw new Error('element missing'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  return { w, d, advance, spoken, speech, click, now: () => now };
}
module.exports = { boot };
