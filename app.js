/* ============================================================================
 *  The Cost of Panic — SIP Crash Behavior Simulator
 *  Zero-dependency, offline-capable, fully URL-encoded.
 *
 *  Math mirrors the repo's Python source of truth
 *  (mutual_fund/calculators.py: sip_future_value annuity-due, xirr) but is
 *  re-expressed as a month-by-month UNIT-ACCOUNTING engine so that
 *  panic-selling and buying back naturally forfeit the rebound.
 * ========================================================================== */
'use strict';

/* ----------------------------- input schema ------------------------------ */
/* short stable URL keys -> defaults (the defaults reproduce the example) */
const FIELDS = {
  sip:   { def: 10000, min: 0,   max: 1e9 },   // monthly SIP
  yrs:   { def: 30,    min: 1,   max: 60  },   // duration (years)
  ret:   { def: 12,    min: 0,   max: 40  },   // expected annual return %
  crash: { def: 40,    min: 0,   max: 90  },   // crash magnitude %
  cy:    { def: 15,    min: 1,   max: 59  },   // crash hits in year
  cm:    { def: 6,     min: 1,   max: 60  },   // crash duration to the bottom (months)
  rm:    { def: 18,    min: 1,   max: 120 },   // recovery duration (months)
  er:    { def: 1,     min: 0,   max: 3   },   // regular-plan expense ratio %
  psd:   { def: 6,     min: 0,   max: 60  },   // panic-sell delay into crash (months)
  out:   { def: 24,    min: 1,   max: 240 },   // sell & stay out (months)
  dip:   { def: 2,     min: 1,   max: 5   },   // dip-buyer's SIP multiplier while down
  cur:   { def: 'INR' },                       // currency
  mode:  { def: 'det' },                        // 'det' | 'mc'
  vol:   { def: 16,    min: 1,   max: 60  },   // MC annual volatility %
  paths: { def: 1000,  min: 100, max: 3000 },  // MC number of paths
  seed:  { def: 42,    min: 0,   max: 1e9 },   // MC random seed
};

/* the five reactions — same market, different nerve.
 * panic → patience → courage, from the one who fled to the one who leaned in */
const SCEN = [
  { key: 'direct',   name: 'Direct · never touched',          color: '#34d399' },
  { key: 'dip',      name: 'Direct · bought the dip',         color: '#38bdf8' },
  { key: 'regular',  name: 'Regular · never touched',         color: '#fbbf24' },
  { key: 'soldback', name: 'Sold in the crash, bought back',  color: '#fb923c' },
  { key: 'out',      name: 'Sold & stayed out',               color: '#f87171' },
];

/* --------------------------- state / URL hash ---------------------------- */
function readState() {
  const p = new URLSearchParams(location.hash.slice(1));
  const s = {};
  for (const [k, spec] of Object.entries(FIELDS)) {
    let v = p.get(k);
    if (v === null) { s[k] = spec.def; continue; }
    if (k === 'cur' || k === 'mode') { s[k] = v; continue; }
    v = Number(v);
    if (!isFinite(v)) v = spec.def;
    s[k] = clamp(v, spec.min, spec.max);
  }
  if (!['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AED'].includes(s.cur)) s.cur = 'INR';
  if (!['det', 'mc'].includes(s.mode)) s.mode = 'det';
  return s;
}

function writeState(s) {
  const p = new URLSearchParams();
  for (const k of Object.keys(FIELDS)) {
    // omit MC-only keys when in deterministic mode to keep links tidy
    if (s.mode === 'det' && ['vol', 'paths', 'seed'].includes(k)) continue;
    p.set(k, String(s[k]));
  }
  history.replaceState(null, '', '#' + p.toString());
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ------------------------------ formatting ------------------------------- */
const LOCALE = { INR: 'en-IN', USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', JPY: 'ja-JP', AED: 'en-AE' };

function symbolFor(cur) {
  const parts = new Intl.NumberFormat(LOCALE[cur] || 'en-US',
    { style: 'currency', currency: cur, maximumFractionDigits: 0 })
    .formatToParts(0);
  return (parts.find(p => p.type === 'currency') || {}).value || cur;
}

function fmtFull(v, cur) {
  return new Intl.NumberFormat(LOCALE[cur] || 'en-US',
    { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Math.round(v));
}

/* compact, human headline: ₹3.53 Cr / $1.2M / €980K */
function fmtCompact(v, cur) {
  const sym = symbolFor(cur);
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (cur === 'INR') {
    if (a >= 1e7) return `${sign}${sym}${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${sign}${sym}${(a / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(1)}K`;
    return `${sign}${sym}${Math.round(a)}`;
  }
  if (a >= 1e9) return `${sign}${sym}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${sym}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${sym}${Math.round(a)}`;
}

/* ----------------------------- NAV path ---------------------------------- */
/* Shared deterministic NAV series. nav[t] = trend(t) * shock(t).
 * Trend uses monthly rate = annual/12 (parity with Python sip_future_value).
 * Shock dips to (1-crash) by the bottom, then returns to trend — so a missed
 * rebound is real, not an artifact. */
function buildNav(s) {
  const N = Math.round(s.yrs * 12);
  const r = s.ret / 100 / 12;
  const a = Math.round(s.cy * 12);            // crash start (months)
  const cm = Math.round(s.cm);
  const rm = Math.round(s.rm);
  const f = 1 - s.crash / 100;                // bottom factor
  const nav = new Float64Array(N + 1);
  for (let t = 0; t <= N; t++) {
    const trend = 100 * Math.pow(1 + r, t);
    let shock = 1;
    if (t <= a) shock = 1;
    else if (t <= a + cm) shock = 1 + (f - 1) * (t - a) / cm;
    else if (t < a + cm + rm) shock = f + (1 - f) * (t - (a + cm)) / rm;
    else shock = 1;
    nav[t] = trend * shock;
  }
  return { nav, N, crashStart: a, bottom: a + cm, recovered: a + cm + rm };
}

/* expense-adjusted clone (Regular plan): NAV grows slower every month */
function applyExpense(nav, erPct) {
  const k = erPct / 100 / 12;
  const out = new Float64Array(nav.length);
  for (let t = 0; t < nav.length; t++) out[t] = nav[t] * Math.pow(1 - k, t);
  return out;
}

/* --------------------------- the unit engine ----------------------------- */
/* Runs one investor's behavior over a NAV series.
 * sellMonth / rebuyMonth are internal unit moves (NOT external cashflows).
 * dip (optional) = { mult, start, end }: contribute sip*mult while start<=t<end —
 * the dip-buyer pours extra real money in at depressed prices (more invested). */
function runPath(nav, N, sip, sellMonth, rebuyMonth, dip) {
  let units = 0, cash = 0, invested = 0, inMarket = true;
  const series = new Float64Array(N + 1);
  for (let t = 0; t <= N; t++) {
    if (t === sellMonth) { cash += units * nav[t]; units = 0; inMarket = false; }
    if (t === rebuyMonth) { units += cash / nav[t]; cash = 0; inMarket = true; }
    if (t < N) {                       // beginning-of-month contribution (annuity-due)
      let contrib = sip;
      if (dip && t >= dip.start && t < dip.end) contrib = sip * dip.mult;
      invested += contrib;
      if (inMarket) units += contrib / nav[t];
      else cash += contrib;            // parked at 0% while on the sidelines
    }
    series[t] = units * nav[t] + cash;
  }
  return { final: series[N], invested, series };
}

/* annualised money-weighted return (XIRR) — ported from Python calculators.xirr.
 * cashflows: -sip at each contribution month, +final at month N. t in months. */
function xirr(sip, N, final) {
  const flows = [];
  for (let t = 0; t < N; t++) flows.push([t / 12, -sip]);
  flows.push([N / 12, final]);
  const xnpv = (rate) => flows.reduce((acc, [yr, amt]) => acc + amt / Math.pow(1 + rate, yr), 0);
  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const npv = xnpv(rate);
    if (Math.abs(npv) < 1e-4) return rate;
    const d = (xnpv(rate + 1e-6) - npv) / 1e-6;
    if (d === 0) break;
    let nr = rate - npv / d;
    if (nr <= -1) nr = (rate - 1) / 2;
    if (Math.abs(nr - rate) < 1e-7) return nr;
    rate = nr;
  }
  let lo = -0.9999, hi = 10, flo = xnpv(lo);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fmid = xnpv(mid);
    if (Math.abs(fmid) < 1e-4) return mid;
    if ((flo < 0) !== (fmid < 0)) hi = mid; else { lo = mid; flo = fmid; }
  }
  return rate;
}

/* event months for the two "panic" reactions, clamped to the horizon */
function eventMonths(s, ctx) {
  const sellMonth = clamp(ctx.crashStart + Math.round(s.psd), 1, ctx.N - 1);
  return {
    sellMonth,
    rebuyAfterRecovery: clamp(ctx.recovered, sellMonth + 1, ctx.N),
    reentryAfterOut: clamp(sellMonth + Math.round(s.out), sellMonth + 1, ctx.N),
  };
}

/* compute all four scenarios over a single NAV path */
function computeScenarios(navDirect, navRegular, s, ctx, ev) {
  const N = ctx.N;
  // no crash ⇒ nothing to panic about ⇒ no one sells (clean baseline)
  const sell = s.crash > 0 ? ev.sellMonth : null;
  // the dip-buyer leans in only when there's an actual dip to buy
  const dipWin = s.crash > 0
    ? { mult: s.dip, start: ctx.crashStart, end: Math.min(ctx.recovered, N) }
    : null;
  return {
    direct:   runPath(navDirect,  N, s.sip, null, null),
    dip:      runPath(navDirect,  N, s.sip, null, null, dipWin),
    regular:  runPath(navRegular, N, s.sip, null, null),
    soldback: runPath(navDirect,  N, s.sip, sell, s.crash > 0 ? ev.rebuyAfterRecovery : null),
    out:      runPath(navDirect,  N, s.sip, sell, s.crash > 0 ? ev.reentryAfterOut : null),
  };
}

/* ============================ DETERMINISTIC =============================== */
function simulateDeterministic(s) {
  const ctx = buildNav(s);
  const navRegular = applyExpense(ctx.nav, s.er);
  const ev = eventMonths(s, ctx);
  const res = computeScenarios(ctx.nav, navRegular, s, ctx, ev);
  const out = {};
  for (const sc of SCEN) {
    const r = res[sc.key];
    out[sc.key] = {
      final: r.final, invested: r.invested, gain: r.final - r.invested,
      xirr: xirr(s.sip, ctx.N, r.final), series: r.series,
    };
  }
  return { mode: 'det', ctx, ev, scen: out, navSeries: ctx.nav };
}

/* ============================== MONTE CARLO ============================== */
/* mulberry32 — tiny seedable PRNG (reproducible from the URL seed) */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) { // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const seedForPath = (base, i) => (base ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0;

/* a random NAV path: lognormal monthly returns, with the SAME structural
 * crash shock multiplied in, so the behavior comparison stays meaningful */
function buildRandomNav(s, ctx, seed) {
  const N = ctx.N;
  const rng = mulberry32(seed);
  const sigM = (s.vol / 100) / Math.sqrt(12);
  const muM = Math.log(1 + s.ret / 100) / 12 - 0.5 * sigM * sigM;
  const a = ctx.crashStart, cm = Math.round(s.cm), rm = Math.round(s.rm);
  const f = 1 - s.crash / 100;
  const nav = new Float64Array(N + 1);
  nav[0] = 100;
  let level = 100;
  for (let t = 1; t <= N; t++) {
    level *= Math.exp(muM + sigM * gauss(rng));
    let shock = 1;
    if (t <= a) shock = 1;
    else if (t <= a + cm) shock = 1 + (f - 1) * (t - a) / cm;
    else if (t < a + cm + rm) shock = f + (1 - f) * (t - (a + cm)) / rm;
    nav[t] = level * shock;
  }
  return nav;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = clamp(Math.round((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

function simulateMonteCarlo(s) {
  const ctx = buildNav(s);
  const ev = eventMonths(s, ctx);
  const P = Math.round(s.paths);
  const finals = {};
  for (const sc of SCEN) finals[sc.key] = [];

  for (let i = 0; i < P; i++) {
    const seed = seedForPath(s.seed, i);
    const nav = buildRandomNav(s, ctx, seed);
    const navReg = applyExpense(nav, s.er);
    const r = computeScenarios(nav, navReg, s, ctx, ev);
    for (const sc of SCEN) finals[sc.key].push(r[sc.key].final);
  }

  // representative path = the one whose "direct" final is closest to the median
  const sortedDirect = finals.direct.slice().sort((x, y) => x - y);
  const medDirect = percentile(sortedDirect, 50);
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < P; i++) {
    const d = Math.abs(finals.direct[i] - medDirect);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  const repNav = buildRandomNav(s, ctx, seedForPath(s.seed, bestI));
  const repNavReg = applyExpense(repNav, s.er);
  const repRes = computeScenarios(repNav, repNavReg, s, ctx, ev);

  const out = {};
  for (const sc of SCEN) {
    const sorted = finals[sc.key].slice().sort((x, y) => x - y);
    const median = percentile(sorted, 50);
    out[sc.key] = {
      final: median,
      p10: percentile(sorted, 10),
      p90: percentile(sorted, 90),
      invested: repRes[sc.key].invested,
      gain: median - repRes[sc.key].invested,
      xirr: xirr(s.sip, ctx.N, median),
      series: repRes[sc.key].series,
    };
  }
  return { mode: 'mc', ctx, ev, scen: out, navSeries: repNav };
}

/* ============================== RENDERING ================================ */
function render(s, sim) {
  const cur = s.cur;
  const d = sim.scen;

  /* ---- headline cards: panic → patience → courage ---- */
  const expenseToll = d.direct.final - d.regular.final;
  const panicCost = d.direct.final - d.out.final;
  const dipReward = d.dip.final - d.direct.final;
  const headline = document.getElementById('headline');
  headline.innerHTML = `
    <div class="hl-card good">
      <div class="label">Stay invested (Direct)</div>
      <div class="big">${fmtCompact(d.direct.final, cur)}</div>
      <div class="desc">Kept buying straight through the crash. This is the bar everything else is measured against.</div>
    </div>
    <div class="hl-card win">
      <div class="label">The courage bonus</div>
      <div class="big">+${fmtCompact(dipReward, cur)}</div>
      <div class="desc">Earned <em>above</em> the benchmark by pouring ${s.dip}× the SIP in while units were cheap — its money-weighted return rose to ${(d.dip.xirr * 100).toFixed(1)}% vs ${(d.direct.xirr * 100).toFixed(1)}%.</div>
    </div>
    <div class="hl-card bad">
      <div class="label">The panic cost</div>
      <div class="big">−${fmtCompact(panicCost, cur)}</div>
      <div class="desc">Handed back by selling and sitting out ${Math.round(s.out)} months — one frightened decision, ${fmtCompact(panicCost, cur)} gone.</div>
    </div>
    <div class="hl-card">
      <div class="label">The expense-ratio toll</div>
      <div class="big">−${fmtCompact(expenseToll, cur)}</div>
      <div class="desc">Lost without ever selling — just ${s.er}%/yr quietly leaking from the Regular plan, compounding for ${Math.round(s.yrs)} years.</div>
    </div>`;

  /* ---- legend ---- */
  document.getElementById('legend').innerHTML = SCEN.map(sc =>
    `<span class="item"><span class="swatch" style="background:${sc.color}"></span>${sc.name}</span>`
  ).join('') + `<span class="item"><span class="swatch" style="background:#5b6b8c"></span>Total invested</span>`;

  /* ---- result cards (ranked) ---- */
  const ranked = SCEN.map(sc => ({ sc, r: d[sc.key] }))
    .sort((x, y) => y.r.final - x.r.final);
  const TAGS = {
    direct: 'Stayed fully invested, kept buying through it.',
    dip: `Stayed in and poured ${s.dip}× the SIP in while the market was down.`,
    regular: `Stayed in — but ${s.er}%/yr leaked out every year.`,
    soldback: 'One frightened week, bought back only after it recovered.',
    out: `Sold near the bottom and stayed on the sidelines ${Math.round(s.out)} months.`,
  };
  const bench = d.direct.final;   // "staying invested" is the line everything is measured against
  document.getElementById('cards').innerHTML = ranked.map((x, i) => {
    const diff = x.r.final - bench;
    const rangeRow = sim.mode === 'mc'
      ? `<div class="row"><span>Likely range (P10–P90)</span><strong>${fmtCompact(x.r.p10, cur)} – ${fmtCompact(x.r.p90, cur)}</strong></div>` : '';
    let gapHtml;
    if (x.sc.key === 'direct') gapHtml = '<div class="gap best">★ The benchmark — stayed fully invested</div>';
    else if (diff >= 0) gapHtml = `<div class="gap win">+ ${fmtCompact(diff, cur)} vs staying invested</div>`;
    else gapHtml = `<div class="gap loss">− ${fmtCompact(-diff, cur)} vs staying invested</div>`;
    return `<div class="card" style="border-top-color:${x.sc.color}">
      <div class="rank">#${i + 1}</div>
      <h3>${x.sc.name}</h3>
      <div class="tag">${TAGS[x.sc.key]}</div>
      <div class="corpus" style="color:${x.sc.color}">${fmtCompact(x.r.final, cur)}</div>
      <div class="row"><span>${sim.mode === 'mc' ? 'Median corpus' : 'Final corpus'}</span><strong>${fmtFull(x.r.final, cur)}</strong></div>
      <div class="row"><span>Invested</span><strong>${fmtCompact(x.r.invested, cur)}</strong></div>
      <div class="row"><span>Return (XIRR)</span><strong>${(x.r.xirr * 100).toFixed(1)}%</strong></div>
      ${rangeRow}
      ${gapHtml}
    </div>`;
  }).join('');

  /* ---- line note ---- */
  document.getElementById('lineNote').textContent =
    `One ${s.crash}% crash starts in year ${s.cy}, bottoms after ${Math.round(s.cm)} months, and climbs back to trend over ${Math.round(s.rm)} months (shaded band). `
    + (sim.mode === 'mc'
        ? `Lines show a representative (median) path from ${Math.round(s.paths)} simulated markets at ${s.vol}% annual volatility.`
        : `Same money, same market — the lines split only because the investors reacted differently.`);

  /* ---- charts ---- */
  CUR = { s, sim };               // snapshot for the animator (Play button)
  drawLineChart(s, sim);
  drawBarChart(s, sim);
}

/* ============================== ANIMATION ================================ */
/* "Play the journey" — reveal the whole horizon month-by-month so you watch
 * the lines climb, the crash bite, and the dip-buyer pull ahead, live. */
let CUR = null;                                   // { s, sim } latest render
const anim = { playing: false, raf: null, startTs: 0, dur: 7000 };

function setPlayBtn(playing) {
  const b = document.getElementById('playBtn');
  if (!b) return;
  b.textContent = playing ? '■ Stop' : '▶ Play the 30-year journey';
  b.classList.toggle('playing', playing);
}

function updateTicker(s, sim, upto) {
  const N = sim.ctx.N;
  const UP = clamp(Math.floor(upto), 0, N);
  const el = document.getElementById('ticker');
  if (!el) return;
  const rows = SCEN.map(sc =>
    `<div class="trow"><span class="tdot" style="background:${sc.color}"></span>` +
    `<span class="tname">${sc.name}</span>` +
    `<span class="tval">${fmtCompact(sim.scen[sc.key].series[UP], s.cur)}</span></div>`
  ).join('');
  el.innerHTML = `<div class="tyear">Year ${(UP / 12).toFixed(1)}</div>${rows}`;
}

function animFrame(ts) {
  if (!anim.playing || !CUR) return;
  if (!anim.startTs) anim.startTs = ts;
  const N = CUR.sim.ctx.N;
  const t = ((ts - anim.startTs) / anim.dur) * N;
  if (t >= N) {                                   // arrived at the finish line
    drawLineChart(CUR.s, CUR.sim, N);
    updateTicker(CUR.s, CUR.sim, N);
    anim.playing = false; anim.raf = null; setPlayBtn(false);
    setTimeout(() => { const e = document.getElementById('ticker'); if (e && !anim.playing) e.hidden = true; }, 1800);
    return;
  }
  drawLineChart(CUR.s, CUR.sim, t);
  updateTicker(CUR.s, CUR.sim, t);
  anim.raf = requestAnimationFrame(animFrame);
}

function playAnim() {
  if (!CUR) return;
  anim.playing = true; anim.startTs = 0;
  const tk = document.getElementById('ticker'); if (tk) tk.hidden = false;
  setPlayBtn(true);
  anim.raf = requestAnimationFrame(animFrame);
}

function stopAnim() {
  anim.playing = false;
  if (anim.raf) cancelAnimationFrame(anim.raf);
  anim.raf = null;
  setPlayBtn(false);
  const tk = document.getElementById('ticker'); if (tk) tk.hidden = true;
}

/* ----------------------------- line chart -------------------------------- */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

function drawLineChart(s, sim, upto) {
  const canvas = document.getElementById('lineChart');
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const N = sim.ctx.N;
  const UP = (upto == null) ? N : clamp(Math.floor(upto), 0, N);   // animation playhead
  const mL = 64, mR = 16, mT = 16, mB = 34;
  const plotW = w - mL - mR, plotH = h - mT - mB;

  // invested reference series
  const invested = new Float64Array(N + 1);
  for (let t = 0; t <= N; t++) invested[t] = s.sip * Math.min(t, N);

  let maxY = 0;
  for (const sc of SCEN) for (const v of sim.scen[sc.key].series) if (v > maxY) maxY = v;
  for (const v of invested) if (v > maxY) maxY = v;
  maxY *= 1.08;
  const x = t => mL + (t / N) * plotW;
  const y = v => mT + plotH - (v / maxY) * plotH;

  // crash band
  ctx.fillStyle = 'rgba(248,113,113,.10)';
  ctx.fillRect(x(sim.ctx.crashStart), mT, x(Math.min(sim.ctx.recovered, N)) - x(sim.ctx.crashStart), plotH);

  // grid + y labels
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.fillStyle = '#9fb0d0';
  ctx.font = '11px -apple-system,Segoe UI,Roboto,sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const gv = (maxY / 4) * i, gy = y(gv);
    ctx.beginPath(); ctx.moveTo(mL, gy); ctx.lineTo(w - mR, gy); ctx.stroke();
    ctx.fillText(fmtCompact(gv, s.cur), mL - 8, gy);
  }
  // x labels (years)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const yrStep = s.yrs <= 12 ? 2 : s.yrs <= 25 ? 5 : 5;
  for (let yr = 0; yr <= s.yrs; yr += yrStep) {
    const px = x(yr * 12);
    ctx.fillText('Y' + yr, px, h - mB + 8);
  }
  // crash marker line
  ctx.strokeStyle = 'rgba(248,113,113,.6)';
  ctx.setLineDash([4, 4]); ctx.beginPath();
  ctx.moveTo(x(sim.ctx.crashStart), mT); ctx.lineTo(x(sim.ctx.crashStart), mT + plotH); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#f87171'; ctx.textAlign = 'left';
  ctx.fillText('crash', x(sim.ctx.crashStart) + 5, mT + 2);

  // invested dotted line
  ctx.strokeStyle = '#5b6b8c'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let t = 0; t <= N; t++) { const px = x(t), py = y(invested[t]); t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
  ctx.stroke(); ctx.setLineDash([]);

  // scenario lines (revealed up to the playhead during animation)
  ctx.lineWidth = 2.4; ctx.lineJoin = 'round';
  for (const sc of SCEN) {
    const ser = sim.scen[sc.key].series;
    ctx.strokeStyle = sc.color; ctx.beginPath();
    for (let t = 0; t <= UP; t++) { const px = x(t), py = y(ser[t]); t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke();
    if (UP < N) {                                  // leading dot at the playhead
      ctx.fillStyle = sc.color; ctx.beginPath();
      ctx.arc(x(UP), y(ser[UP]), 3.6, 0, 2 * Math.PI); ctx.fill();
    }
  }

  // moving playhead
  if (UP < N) {
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(x(UP), mT); ctx.lineTo(x(UP), mT + plotH); ctx.stroke();
    ctx.setLineDash([]);
  }
}

/* ------------------------------ bar chart -------------------------------- */
function drawBarChart(s, sim) {
  const canvas = document.getElementById('barChart');
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const mL = 64, mR = 16, mT = 20, mB = 46;
  const plotW = w - mL - mR, plotH = h - mT - mB;

  let maxY = 0;
  for (const sc of SCEN) {
    maxY = Math.max(maxY, sim.scen[sc.key].final, sim.scen[sc.key].p90 || 0);
  }
  maxY *= 1.12;
  const y = v => mT + plotH - (v / maxY) * plotH;

  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.fillStyle = '#9fb0d0';
  ctx.font = '11px -apple-system,Segoe UI,Roboto,sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const gv = (maxY / 4) * i, gy = y(gv);
    ctx.beginPath(); ctx.moveTo(mL, gy); ctx.lineTo(w - mR, gy); ctx.stroke();
    ctx.fillText(fmtCompact(gv, s.cur), mL - 8, gy);
  }

  const n = SCEN.length, slot = plotW / n, bw = Math.min(90, slot * 0.5);
  SCEN.forEach((sc, i) => {
    const r = sim.scen[sc.key];
    const cx = mL + slot * i + slot / 2;
    const bx = cx - bw / 2, by = y(r.final);
    // bar
    const grad = ctx.createLinearGradient(0, by, 0, mT + plotH);
    grad.addColorStop(0, sc.color); grad.addColorStop(1, sc.color + '55');
    ctx.fillStyle = grad;
    roundRect(ctx, bx, by, bw, mT + plotH - by, 6); ctx.fill();
    // P10-P90 whisker (MC)
    if (sim.mode === 'mc') {
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, y(r.p10)); ctx.lineTo(cx, y(r.p90));
      ctx.moveTo(cx - 6, y(r.p10)); ctx.lineTo(cx + 6, y(r.p10));
      ctx.moveTo(cx - 6, y(r.p90)); ctx.lineTo(cx + 6, y(r.p90));
      ctx.stroke();
    }
    // value label
    ctx.fillStyle = '#eaf0ff'; ctx.font = '700 13px -apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(fmtCompact(r.final, s.cur), cx, by - 6);
    // name (wrapped to 2 lines)
    ctx.fillStyle = '#9fb0d0'; ctx.font = '11px -apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textBaseline = 'top';
    wrapLabel(ctx, sc.name, cx, mT + plotH + 8, slot - 6);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLabel(ctx, text, cx, top, maxW) {
  const words = text.split(' ');
  let line = '', lines = [];
  for (const wd of words) {
    const test = line ? line + ' ' + wd : wd;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = wd; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, cx, top + i * 13));
}

/* =============================== WIRING ================================= */
const PRESETS = {
  example:   { crash: 40, cy: 15, cm: 6,  rm: 18, ret: 12 },
  gfc2008:   { crash: 56, cy: 15, cm: 16, rm: 48, ret: 12 },
  covid2020: { crash: 38, cy: 15, cm: 2,  rm: 8,  ret: 12 },
  dotcom2000:{ crash: 49, cy: 15, cm: 30, rm: 54, ret: 12 },
  mild2013:  { crash: 15, cy: 15, cm: 6,  rm: 10, ret: 12 },
};

let STATE;
function getStateFromInputs() {
  const s = { ...STATE };
  // read numeric/select inputs by id
  ['sip','yrs','ret','crash','cy','cm','rm','er','psd','out','dip','vol','paths','seed'].forEach(k => {
    const el = document.getElementById(k);
    if (el) s[k] = clamp(Number(el.value), FIELDS[k].min, FIELDS[k].max);
  });
  s.cur = document.getElementById('cur').value;
  s.mode = STATE.mode;
  return s;
}

function syncInputsFromState(s) {
  for (const k of ['sip','yrs','ret','crash','cy','cm','rm','er','psd','out','dip','vol','paths','seed']) {
    const el = document.getElementById(k); const num = document.getElementById(k + 'Num');
    if (el) el.value = s[k];
    if (num) num.value = s[k];
  }
  document.getElementById('cur').value = s.cur;
  updateLabels(s);
  // mode toggle UI
  const det = s.mode === 'det';
  document.getElementById('modeDet').classList.toggle('active', det);
  document.getElementById('modeMc').classList.toggle('active', !det);
  document.getElementById('modeDet').setAttribute('aria-selected', det);
  document.getElementById('modeMc').setAttribute('aria-selected', !det);
  document.querySelectorAll('.mc-only').forEach(e => e.hidden = det);
}

function updateLabels(s) {
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set('sipOut', fmtCompact(s.sip, s.cur) + '/mo');
  set('yrsOut', Math.round(s.yrs) + ' yrs');
  set('retOut', s.ret + '%');
  set('crashOut', '−' + s.crash + '%');
  set('cyOut', 'year ' + Math.round(s.cy));
  set('cmOut', Math.round(s.cm) + ' mo');
  set('rmOut', Math.round(s.rm) + ' mo');
  set('erOut', s.er + '%/yr');
  set('psdOut', Math.round(s.psd) + ' mo');
  set('outOut', Math.round(s.out) + ' mo');
  set('dipOut', s.dip + '× SIP');
  set('volOut', s.vol + '%');
  set('pathsOut', Math.round(s.paths));
}

function checkWarnings(s) {
  const warn = document.getElementById('warn');
  const endYr = s.cy + (s.cm + s.rm) / 12;
  if (endYr > s.yrs) warn.textContent = '⚠ Crash + recovery runs past your horizon — the market is still climbing back at the finish line.';
  else if (s.cy >= s.yrs) warn.textContent = '⚠ The crash year is at/after the end — move it earlier to see the effect.';
  else warn.textContent = '';
}

let rafId = null;
function recompute(updateInputsToo) {
  if (anim.playing) stopAnim();          // editing inputs ends any running playback
  STATE = getStateFromInputs();
  if (updateInputsToo) syncInputsFromState(STATE);
  else updateLabels(STATE);
  checkWarnings(STATE);
  writeState(STATE);
  const sim = STATE.mode === 'mc' ? simulateMonteCarlo(STATE) : simulateDeterministic(STATE);
  render(STATE, sim);
}

let debounceT = null;
function debouncedRecompute() {
  clearInterval(debounceT);
  debounceT = setTimeout(() => recompute(false), 60);
}

function init() {
  STATE = readState();
  syncInputsFromState(STATE);

  // link range <-> number pairs
  ['sip','yrs','ret','crash','cy','cm','rm','er','psd','out','dip'].forEach(k => {
    const range = document.getElementById(k), num = document.getElementById(k + 'Num');
    if (range) range.addEventListener('input', () => { if (num) num.value = range.value; debouncedRecompute(); });
    if (num) num.addEventListener('input', () => {
      const v = clamp(Number(num.value), FIELDS[k].min, FIELDS[k].max);
      if (range) range.value = v; debouncedRecompute();
    });
  });
  ['vol','paths','seed'].forEach(k => {
    const el = document.getElementById(k);
    if (el) el.addEventListener('input', debouncedRecompute);
  });
  document.getElementById('cur').addEventListener('change', () => recompute(false));

  // presets
  document.querySelectorAll('.preset').forEach(btn => btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset]; if (!p) return;
    Object.assign(STATE, p);
    syncInputsFromState(STATE);
    document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    recompute(false);
  }));

  // mode toggle
  document.getElementById('modeDet').addEventListener('click', () => { STATE.mode = 'det'; syncInputsFromState(STATE); recompute(false); });
  document.getElementById('modeMc').addEventListener('click', () => { STATE.mode = 'mc'; syncInputsFromState(STATE); recompute(false); });

  // play / stop the animated journey
  const playBtn = document.getElementById('playBtn');
  if (playBtn) playBtn.addEventListener('click', () => {
    if (anim.playing) { stopAnim(); drawLineChart(CUR.s, CUR.sim); }
    else playAnim();
  });

  // copy link
  document.getElementById('copyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Link copied — share it anywhere 🌍'); }
    catch { toast('Copy this URL from your address bar'); }
  });

  // reset
  document.getElementById('reset').addEventListener('click', () => {
    const def = {}; for (const [k, sp] of Object.entries(FIELDS)) def[k] = sp.def;
    STATE = def; syncInputsFromState(STATE);
    document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
    document.querySelector('.preset[data-preset="example"]').classList.add('active');
    recompute(false);
  });

  // mark example preset active if state matches defaults
  document.querySelector('.preset[data-preset="example"]').classList.add('active');

  window.addEventListener('resize', () => { if (rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => recompute(false)); });
  window.addEventListener('hashchange', () => { STATE = readState(); syncInputsFromState(STATE); recompute(false); });

  recompute(false);
}

let toastT = null;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2200);
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

/* exported for the Node test harness (no effect in the browser) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildNav, applyExpense, runPath, xirr, eventMonths,
    computeScenarios, simulateDeterministic, simulateMonteCarlo, FIELDS, SCEN };
}
