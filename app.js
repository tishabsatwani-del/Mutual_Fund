/* =====================================================================
 * "Live It" — a Behavioral Investing Simulator
 * ---------------------------------------------------------------------
 * One market, one crash. The only variable is the investor's reaction.
 *
 * This file has two clearly separated halves:
 *   1. THE MATH ENGINE  — deterministic, dependency-free, auditable, and
 *      exported for Node so it can be unit-tested (tests/test_simulator.js).
 *      It uses real unit accounting (units x NAV), never bare percentages.
 *   2. THE EXPERIENCE   — the cinematic, mobile-first animation. Runs only
 *      in a browser; the engine half is untouched by it.
 *
 * Integrity note: this is an *illustration*, not a prediction. Every
 * number on screen is computed live by the functions below — nothing is
 * hardcoded.
 * ===================================================================== */
'use strict';

/* =====================================================================
 * 1. THE MATH ENGINE
 * ===================================================================== */

// Normal monthly growth — the commission gap made concrete.
const DIRECT_MONTHLY  = 0.01;        // Direct plan:  1.0000%/mo  (~12% / yr)
const REGULAR_MONTHLY = 0.11 / 12;   // Regular plan: 0.9167%/mo  (~11% / yr)

/**
 * Build the NAV (price-per-unit) series for one plan.
 *
 * The series starts at 100. It grows at `rate` every normal month. A single
 * crash is hard-wired to the journey's midpoint month C = 6 x years:
 *
 *   • Months C   -> C+3 : NAV falls smoothly to 60% of NAV[C]   (a 40% drop)
 *   • Months C+3 -> C+18: NAV climbs smoothly back to *exactly* the level the
 *                         original trend would have reached at C+18
 *                         (full recovery to trend, i.e. NAV[C] x (1+rate)^18)
 *   • Month  C+18 onward: normal monthly growth resumes.
 *
 * Because NAV[C+18] lands exactly on the undisturbed trend, every month from
 * C+18 on is identical to a no-crash world — the crash leaves no scar on the
 * price. Within each phase the move is geometric (a constant monthly factor),
 * which is the honest way prices move and reads as a smooth curve.
 *
 * @param {number} rate  monthly growth rate (e.g. 0.01)
 * @param {number} N     total months in the journey (12 x years)
 * @param {number} C     crash-start month (midpoint, 6 x years)
 * @returns {number[]}   NAV indexed 0..N inclusive
 */
function buildNav(rate, N, C) {
  const nav = new Array(N + 1);
  nav[0] = 100;
  for (let t = 1; t <= N; t++) {
    if (t <= C) {
      // Calm pre-crash climb.
      nav[t] = nav[t - 1] * (1 + rate);
    } else if (t <= C + 3) {
      // The fall: geometric glide from NAV[C] down to 0.6 x NAV[C] over 3 months.
      const k = t - C;                                  // 1, 2, 3
      nav[t] = nav[C] * Math.pow(0.6, k / 3);
    } else if (t <= C + 18) {
      // The recovery: geometric glide from the 60% bottom back up to trend.
      const start  = nav[C] * 0.6;                      // the bottom (= NAV[C+3])
      const target = nav[C] * Math.pow(1 + rate, 18);   // trend value at C+18
      const k = t - (C + 3);                            // 1..15
      nav[t] = start * Math.pow(target / start, k / 15);
    } else {
      // Healed. Normal growth resumes; we are back on the original trend.
      nav[t] = nav[t - 1] * (1 + rate);
    }
  }
  return nav;
}

/** A no-crash control series (pure trend) — used only to show that staying
 *  invested through a crash ends *slightly richer* than a calm market. */
function buildNavNoCrash(rate, N) {
  const nav = new Array(N + 1);
  nav[0] = 100;
  for (let t = 1; t <= N; t++) nav[t] = nav[t - 1] * (1 + rate);
  return nav;
}

/* ---- The five paths, each a tiny deterministic month-by-month sim. ----
 * Shared rules:
 *   • SIP is invested at the START of each of the N months.
 *   • units_bought = SIP / NAV[m]; value = units_held x NAV[m] + idle cash.
 *   • Money "set aside" while out of the market sits as cash earning nothing
 *     and is deployed in full at re-entry, so every path invests the same
 *     total (SIP x N). Apples to apples — only behavior differs.
 * Each returns { value:[N+1], units, invested, final }. value[m] is the live
 * corpus (holdings + cash) at month m, recorded after that month's action. */

/** Buy every month, hold everything, forever. The baseline discipline. */
function simHeld(nav, N, sip) {
  let units = 0;
  const value = new Array(N + 1);
  for (let m = 0; m <= N; m++) {
    if (m < N) units += sip / nav[m];      // invest at the start of month m
    value[m] = units * nav[m];
  }
  return { value, units, invested: sip * N, final: value[N] };
}

/** Hold existing units, but PAUSE all buying for months C..C+18. The paused
 *  SIP piles up as cash and is deployed in one lump at re-entry (C+19) —
 *  buying back at recovered prices, having missed the cheap units. */
function simPaused(nav, N, C, sip) {
  let units = 0, cash = 0;
  const reentry = C + 19;
  const value = new Array(N + 1);
  for (let m = 0; m <= N; m++) {
    if (m < N) {
      if (m < C)               units += sip / nav[m];   // buy as normal
      else if (m <= C + 18)    cash  += sip;            // paused: SIP -> cash
      else if (m === reentry)  { cash += sip; units += cash / nav[m]; cash = 0; } // deploy lump
      else                     units += sip / nav[m];   // back to normal SIP
    }
    value[m] = units * nav[m] + cash;
  }
  return { value, units, invested: sip * N, final: value[N] };
}

/** Sell EVERYTHING at the bottom (month C+3); sit in cash; re-enter the whole
 *  pile at `reentry`, then resume buying. Used for both "sold and bought back
 *  after recovery" (reentry = C+18) and "sold and stayed out" (reentry = C+30). */
function simSold(nav, N, C, sip, reentry) {
  let units = 0, cash = 0;
  const bottom = C + 3;
  const value = new Array(N + 1);
  for (let m = 0; m <= N; m++) {
    if (m < N) {
      if (m < bottom)          units += sip / nav[m];                 // buy until the bottom
      else if (m === bottom)   { cash += units * nav[m]; units = 0; cash += sip; } // sell all + SIP -> cash
      else if (m < reentry)    cash += sip;                           // out: SIP -> cash
      else if (m === reentry)  { cash += sip; units += cash / nav[m]; cash = 0; }  // re-enter everything
      else                     units += sip / nav[m];                 // back to normal SIP
    }
    value[m] = units * nav[m] + cash;
  }
  return { value, units, invested: sip * N, final: value[N] };
}

/**
 * Run the whole illustration for a given SIP and journey length.
 * The crash is fixed at the midpoint (C = 6 x years). Returns every path's
 * full monthly value series plus the NAV series for charting.
 *
 * Guaranteed ordering of finals (let the rupees prove it):
 *   directHeld > regularHeld ~= paused > soldBack > stayedOut
 */
function runSimulation(sip, years) {
  const N = years * 12;     // total months
  const C = years * 6;      // crash midpoint

  const navDirect        = buildNav(DIRECT_MONTHLY,  N, C);
  const navRegular       = buildNav(REGULAR_MONTHLY, N, C);
  const navDirectNoCrash = buildNavNoCrash(DIRECT_MONTHLY, N);

  const paths = {
    // 2 > 1 ~= 3 > 4 > 5, by construction:
    directHeld:  simHeld(navDirect,  N, sip),               // 2 — the best outcome
    regularHeld: simHeld(navRegular, N, sip),               // 1 — the expense-ratio toll baseline
    paused:      simPaused(navDirect, N, C, sip),           // 3 — missed the cheap units
    soldBack:    simSold(navDirect, N, C, sip, C + 18),     // 4 — sold low, rebought at trend
    stayedOut:   simSold(navDirect, N, C, sip, C + 30),     // 5 — sold low, rebought far higher
  };

  // How much being calm beat a crash-free market by (the "slightly richer" gift
  // of the months spent below trend).
  const directNoCrashFinal = simHeld(navDirectNoCrash, N, sip).final;

  return { sip, years, N, C, navDirect, navRegular, paths, directNoCrashFinal };
}

// Node export for the test harness; harmless in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIRECT_MONTHLY, REGULAR_MONTHLY,
    buildNav, buildNavNoCrash, simHeld, simPaused, simSold, runSimulation,
  };
}

/* =====================================================================
 * 2. THE EXPERIENCE  (browser only)
 * ===================================================================== */
if (typeof document !== 'undefined') (function () {
  'use strict';

  // ---- Path metadata: order, label, colour. Drives charts + legends. ----
  const PATHS = {
    directHeld:  { label: 'Held and kept investing',          color: '#34d399' },
    regularHeld: { label: 'Regular plan (higher fees)',       color: '#e0a64a' },
    paused:      { label: 'Paused the SIP',                   color: '#5b9cf0' },
    soldBack:    { label: 'Sold, bought back after recovery', color: '#a78bfa' },
    stayedOut:   { label: 'Sold and waited it out',           color: '#f06b6b' },
  };
  // The four choices offered at the crash (Regular is shown only in "every path").
  const CHOICE_TO_PATH = { held: 'directHeld', paused: 'paused', soldBack: 'soldBack', stayedOut: 'stayedOut' };

  // ---- Number formatting (Indian grouping + lakh/crore short form). ----
  function inr(v) {
    const n = Math.round(v);
    const s = Math.abs(n).toString();
    let last3 = s.slice(-3), rest = s.slice(0, -3);
    if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return '₹' + (n < 0 ? '-' : '') + (rest ? rest + ',' + last3 : last3);
  }
  function inrShort(v) {
    if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr';
    if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' L';
    return inr(v);
  }

  // ---- Tiny DOM helpers. ----
  const $ = (id) => document.getElementById(id);
  const show = (el) => { el.hidden = false; requestAnimationFrame(() => el.classList.add('show')); };
  const hide = (el) => { el.classList.remove('show'); el.hidden = true; };
  const easeInOut = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

  // ---- App state. ----
  const state = {
    sip: 10000, years: 15,
    sim: null, choice: null, lastResult: null,
    head: 0, phase: 'idle', phaseStart: null, raf: 0,
    yMax: 1,
  };

  // ---- Canvas + chart primitives. ----
  const canvas = $('stageCanvas');

  function fitCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height, c };
  }

  // Build a polyline (in month/value space) up to a fractional `head`.
  function pointsUpTo(values, head) {
    const pts = [];
    const last = Math.min(Math.floor(head), values.length - 1);
    for (let m = 0; m <= last; m++) pts.push([m, values[m]]);
    if (last < values.length - 1 && head > last) {
      const f = head - last;
      pts.push([head, values[last] + (values[last + 1] - values[last]) * f]);
    }
    return pts;
  }
  function valueAt(values, head) {
    const last = Math.floor(head);
    if (last >= values.length - 1) return values[values.length - 1];
    return values[last] + (values[last + 1] - values[last]) * (head - last);
  }

  /**
   * Draw a set of lines onto a context.
   * @param lines [{ values, color, width, alpha, dash, fill, glow, dot }]
   */
  function drawChart(c, w, h, N, yMax, lines, head) {
    const padL = 16, padR = 16, padT = 28, padB = 26;
    const X = (m) => padL + (m / N) * (w - padL - padR);
    const Y = (v) => (h - padB) - (v / yMax) * (h - padT - padB);

    c.clearRect(0, 0, w, h);

    // Faint horizontal guides.
    c.strokeStyle = 'rgba(255,255,255,0.06)';
    c.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const yy = padT + i * (h - padT - padB) / 3;
      c.beginPath(); c.moveTo(padL, yy); c.lineTo(w - padR, yy); c.stroke();
    }

    for (const line of lines) {
      const pts = pointsUpTo(line.values, head);
      if (pts.length < 1) continue;

      if (line.fill) {
        c.beginPath();
        c.moveTo(X(pts[0][0]), h - padB);
        for (const [m, v] of pts) c.lineTo(X(m), Y(v));
        c.lineTo(X(pts[pts.length - 1][0]), h - padB);
        c.closePath();
        const g = c.createLinearGradient(0, padT, 0, h - padB);
        g.addColorStop(0, line.fill); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fill();
      }

      c.save();
      c.globalAlpha = line.alpha == null ? 1 : line.alpha;
      c.strokeStyle = line.color;
      c.lineWidth = line.width || 2;
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (line.dash) c.setLineDash(line.dash);
      if (line.glow) { c.shadowColor = line.color; c.shadowBlur = 14; }
      c.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [m, v] = pts[i];
        if (i === 0) c.moveTo(X(m), Y(v)); else c.lineTo(X(m), Y(v));
      }
      c.stroke();
      c.restore();

      if (line.dot && pts.length) {
        const [m, v] = pts[pts.length - 1];
        c.save();
        c.shadowColor = line.color; c.shadowBlur = 18;
        c.fillStyle = line.color;
        c.beginPath(); c.arc(X(m), Y(v), 4.5, 0, Math.PI * 2); c.fill();
        c.restore();
      }
    }
  }

  function hexToFill(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',0.16)';
  }

  // ---- Render the live stage for the current frame. ----
  function renderStage() {
    const { w, h, c } = fitCanvas(canvas);
    const sim = state.sim, N = sim.N;
    const pre = state.phase === 'climb' || state.phase === 'crash';
    const front = pre ? sim.paths.directHeld : sim.paths[CHOICE_TO_PATH[state.choice]];

    let lines;
    if (pre) {
      const crashing = state.phase === 'crash';
      lines = [{
        values: front.value,
        color: crashing ? '#6f86c9' : '#34d399',
        width: 3, glow: true, dot: true,
        fill: crashing ? 'rgba(111,134,201,0.18)' : 'rgba(52,211,153,0.18)',
      }];
    } else {
      const key = CHOICE_TO_PATH[state.choice];
      const chosen = sim.paths[key];
      const ghost = sim.paths.directHeld;
      lines = [
        // Faint "what staying calm would have done".
        { values: ghost.value, color: '#cbb26b', width: 2, alpha: 0.45, dash: [5, 6] },
        // The chosen reality.
        { values: chosen.value, color: PATHS[key].color, width: 3, glow: true, dot: true,
          fill: hexToFill(PATHS[key].color) },
      ];
    }

    drawChart(c, w, h, N, state.yMax, lines, state.head);

    // HUD numbers tick with the line.
    const corpus = valueAt(front.value, state.head);
    $('corpus').textContent = inr(corpus);
    $('corpusShort').textContent = '≈ ' + inrShort(corpus);
    const monthsElapsed = Math.min(Math.floor(state.head), N);
    const yr = Math.min(Math.floor(state.head / 12), state.years);
    $('yearLabel').textContent = 'Year ' + yr + ' of ' + state.years;
    $('invested').textContent = 'Invested ' + inrShort(state.sip * monthsElapsed);
  }

  // ---- Animation timeline. ----
  const CLIMB_MS = 4200, CRASH_MS = 1900, DIVERGE_MS = 5200;

  function loop(ts) {
    if (state.phaseStart == null) state.phaseStart = ts;
    const e = ts - state.phaseStart;
    const sim = state.sim, N = sim.N, C = sim.C;

    if (state.phase === 'climb') {
      const p = Math.min(e / CLIMB_MS, 1);
      state.head = C * easeInOut(p);
      renderStage();
      if (p >= 1) { state.phase = 'crash'; state.phaseStart = null; $('stage').classList.add('crashing'); }
      state.raf = requestAnimationFrame(loop);

    } else if (state.phase === 'crash') {
      const p = Math.min(e / CRASH_MS, 1);
      state.head = C + 3 * p;                 // plunge to the bottom (month C+3)
      renderStage();
      if (p >= 1) { cancelAnimationFrame(state.raf); openDecision(); return; }
      state.raf = requestAnimationFrame(loop);

    } else if (state.phase === 'diverge') {
      const p = Math.min(e / DIVERGE_MS, 1);
      state.head = (C + 3) + (N - (C + 3)) * easeInOut(p);
      renderStage();
      if (p >= 1) { cancelAnimationFrame(state.raf); openResult(); return; }
      state.raf = requestAnimationFrame(loop);
    }
  }

  // ---- Flow control. ----
  function startJourney() {
    state.sim = runSimulation(state.sip, state.years);
    state.choice = null;
    state.head = 0;
    state.phase = 'climb';
    state.phaseStart = null;
    // Fixed y-axis so the line climbs into frame; headroom above the best path.
    state.yMax = state.sim.paths.directHeld.final * 1.08;
    $('stage').classList.remove('crashing');

    hide($('setup')); hide($('result')); hide($('allPaths')); hide($('decision'));
    show($('stage'));
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(loop);
  }

  function openDecision() { show($('decision')); }

  function choose(choice) {
    state.choice = choice;
    hide($('decision'));
    $('stage').classList.remove('crashing');
    state.phase = 'diverge';
    state.phaseStart = null;
    state.raf = requestAnimationFrame(loop);
  }

  function openResult() {
    const sim = state.sim;
    const key = CHOICE_TO_PATH[state.choice];
    const yours = sim.paths[key].final;
    const calm = sim.paths.directHeld.final;

    $('yourLabel').textContent = PATHS[key].label;
    $('yourFinal').style.color = PATHS[key].color;

    // Count both numbers up side by side — the payoff.
    countUp($('yourFinal'), yours, 1400, inr);
    countUp($('calmFinal'), calm, 1400, inr);
    $('yourShort').textContent = '≈ ' + inrShort(yours);
    $('calmShort').textContent = '≈ ' + inrShort(calm);

    $('verdict').innerHTML = verdictFor(state.choice, yours, calm, sim);
    state.lastResult = { choice: state.choice, yours, calm };  // remembered for sharing
    const sb = $('shareBtn');
    if (sb) { sb.classList.remove('copied'); sb.textContent = 'Send this to a friend'; }
    show($('result'));
  }

  // ---- Share the outcome — the whole point is that people pass it on. ----
  // The line is built live from the actual rupees, so what you share is what
  // you lived. Uses the native share sheet on phones, clipboard everywhere else.
  function shareText() {
    const r = state.lastResult;
    if (!r) return '';
    const url = location.href.split('#')[0];
    if (r.choice === 'held') {
      return 'I sat through a 40% market crash and did nothing — and finished with '
        + inrShort(r.yours) + '. Nothing was exactly right. Could you hold your nerve?\n\nLive it: ' + url;
    }
    const cost = Math.max(0, Math.round(r.calm - r.yours));
    return 'One frightened decision in a market crash cost me ' + inrShort(cost)
      + '. The market recovered without me. Could you have held your nerve?\n\nLive it: ' + url;
  }

  async function shareResult() {
    const text = shareText();
    if (!text) return;
    const btn = $('shareBtn');
    // Native share sheet (mobile) — the smoothest "send to a friend".
    if (navigator.share) {
      try { await navigator.share({ title: 'Live It', text }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }  // user dismissed — do nothing
    }
    // Fallback: copy to clipboard and confirm in place.
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      if (btn) { btn.classList.add('copied'); btn.textContent = 'Copied — now paste it to a friend'; }
    } catch (e) {
      if (btn) btn.textContent = 'Press and hold to copy';
    }
  }

  // The one caption that lands the truth. Cost is computed live, never typed in.
  function verdictFor(choice, yours, calm, sim) {
    if (choice === 'held') {
      const surplus = calm - sim.directNoCrashFinal; // > 0: the crash made you richer
      return 'You did nothing. Nothing was exactly right.'
        + '<span class="verdict-sub">Staying invested even left you about <b>' + inrShort(Math.max(surplus, 0))
        + '</b> ahead of a crash-free market — the months below trend bought you extra units.</span>';
    }
    const cost = calm - yours;
    let sub;
    if (choice === 'paused') {
      sub = 'You held on, but skipped the cheapest units of the journey.';
    } else if (choice === 'soldBack') {
      sub = 'You sold at the bottom and bought back at the top. Those units are gone for good.';
    } else { // stayedOut
      const reg = sim.paths.regularHeld.final;
      sub = 'The market recovered without you'
        + (yours < reg ? ' — you even finished below the higher-fee Regular plan.' : '.');
    }
    return 'Your one frightened decision cost <b>' + inr(cost) + '</b>.'
      + '<span class="verdict-sub">' + sub + '</span>';
  }

  function countUp(el, to, dur, fmt) {
    const start = performance.now();
    function step(t) {
      const p = Math.min((t - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---- "See every path" overlay: all five lines at once. ----
  function openAllPaths() {
    show($('allPaths'));
    const sim = state.sim;
    const { w, h, c } = fitCanvas($('allCanvas'));
    let yMax = 0;
    for (const k in sim.paths) yMax = Math.max(yMax, sim.paths[k].final);
    yMax *= 1.08;

    const order = ['directHeld', 'regularHeld', 'paused', 'soldBack', 'stayedOut'];
    const lines = order.map((k) => ({ values: sim.paths[k].value, color: PATHS[k].color, width: 2.4 }));
    drawChart(c, w, h, sim.N, yMax, lines, sim.N);

    // Legend, sorted by outcome (best first).
    const ranked = order.slice().sort((a, b) => sim.paths[b].final - sim.paths[a].final);
    $('allLegend').innerHTML = ranked.map((k) =>
      '<div class="leg-row"><span class="leg-dot" style="background:' + PATHS[k].color + '"></span>'
      + '<span class="leg-name">' + PATHS[k].label + '</span>'
      + '<span class="leg-val">' + inrShort(sim.paths[k].final) + '</span></div>'
    ).join('');
  }

  // ---- Wiring helpers. Each guards a missing element so one bad lookup can
  //      never abort the rest of the wiring (e.g. the Start button). ----
  function on(id, type, fn) {
    const el = $(id);
    if (el) el.addEventListener(type, fn);
  }
  function wireChips(containerId, key, parse) {
    const box = $(containerId);
    if (!box) return;
    box.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.chip');
      if (!btn) return;
      [...box.querySelectorAll('.chip')].forEach((b) => b.classList.toggle('on', b === btn));
      state[key] = parse(btn.dataset.val);
    });
  }

  function boot() {
    // Start first — it is the one control that must always work.
    on('startBtn', 'click', startJourney);
    on('replayBtn', 'click', startJourney);

    wireChips('sipChips', 'sip', Number);
    wireChips('yearChips', 'years', Number);

    on('shareBtn', 'click', shareResult);
    on('allBtn', 'click', openAllPaths);
    on('allClose', 'click', () => hide($('allPaths')));
    on('changeBtn', 'click', () => { hide($('result')); hide($('stage')); show($('setup')); });

    on('choices', 'click', (ev) => {
      const btn = ev.target.closest('button[data-choice]');
      if (btn) choose(btn.dataset.choice);
    });

    // Keep charts crisp on rotation / resize.
    window.addEventListener('resize', () => {
      if (!state.sim) return;
      if (!$('stage').hidden) renderStage();
      if (!$('allPaths').hidden) openAllPaths();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
