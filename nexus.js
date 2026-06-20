/* =====================================================================
 * ORACLE NEXUS — the flagship experience
 * ---------------------------------------------------------------------
 * One living command center that diagnoses, forecasts and acts on a
 * mutual-fund portfolio — the full master spec (Parts 1–5) wrapped in a
 * fusion of three worlds: a cinematic Command Bridge, a breathing Living
 * Oracle core, and an editorial Atlas of chapters.
 *
 * This file is presentation + orchestration only. Every number is computed
 * by the existing, unit-tested engines:
 *   ORACLE (oracle.js) · FUTURE (oracle-future.js) · SIM/DSMC (monte carlo)
 *   WORKFLOW (oracle-workflow.js) · ORACLE_IO · ORACLE_DATA · ORACLE_CHARTS
 * Features the engines don't yet model (Behavioral Lock, Tax Router, Legacy
 * Shield, Macro Switcher, SIP Regulator, Compliance, Dust Sweeper) are
 * computed here with clearly-labelled, illustrative logic and a DEMO pill.
 * ===================================================================== */
'use strict';
(function () {
  const O = window.ORACLE, F = window.FUTURE, W = window.WORKFLOW;
  const SIM = window.SIM, DSMC = window.DSMC, CH = window.ORACLE_CHARTS;
  const IO = window.ORACLE_IO, DATA = window.ORACLE_DATA;
  if (!O || !F || !W) { console.error('ORACLE NEXUS: engines missing'); return; }

  const TODAY = '2026-06-20';

  /* ---------------- formatting ---------------- */
  const INR = (v) => {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2) + ' L';
    return s + '₹' + Math.round(a).toLocaleString('en-IN');
  };
  const R0 = (v) => (isFinite(v) ? '₹' + Math.round(v).toLocaleString('en-IN') : '—');
  const pct = (v, d = 1) => (isFinite(v) ? (v * 100).toFixed(d) + '%' : '—');
  const spct = (v, d = 1) => (isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%' : '—');
  const num = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : '—');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const $ = (id) => document.getElementById(id);

  /* ---------------- state ---------------- */
  let portfolio = null;
  const inputs = {
    yearsToGoal: 18, monthlySip: 30000, currentMonthlyExpense: 50000, sipStepUp: 0.10,
    niftyPE: 27, customEquityShock: -0.40,
    // macro (illustrative live feeds)
    fedRate: 4.5, crude: 82, cpi: 6.1,
    // tax router
    goalAmount: 5000000,
    // behavioral
    panicTaps: 0, sellLocked: false,
    // legacy
    inactiveDays: 30,
  };

  /* ---------------- boot wiring ---------------- */
  $('boot-sample').addEventListener('click', () => {
    portfolio = O.samplePortfolio(TODAY);
    launch();
  });
  $('boot-upload').addEventListener('click', () => $('file-in').click());
  $('file-in').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (/\.json$/i.test(file.name)) {
          portfolio = ensureBenchmark(IO.parsePortfolioJSON(reader.result));
        } else if (/\.csv$/i.test(file.name)) {
          const { holdings, errors } = IO.parseHoldingsCSV(reader.result);
          if (!holdings.length) { toast('Could not read that CSV. ' + (errors[0] || '')); return; }
          portfolio = ensureBenchmark({ name: 'Imported Portfolio', asOf: TODAY, holdings });
          if (errors.length) toast(errors.length + ' row(s) skipped.');
        } else {
          // CAS PDF — a live build parses CAMS/KFintech; here we demo with the sample.
          portfolio = O.samplePortfolio(TODAY);
          toast('CAS PDF parsing is a live-build feature — loaded a demo portfolio so you can explore.');
        }
        launch();
      } catch (err) { toast('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
  });

  // Imported portfolios may lack a benchmark/NAV history; borrow the demo
  // benchmark so risk math still has a series to compute against.
  function ensureBenchmark(p) {
    if (!p.benchmark || !p.benchmark.navHistory) p.benchmark = O.samplePortfolio(TODAY).benchmark;
    if (!p.asOf) p.asOf = TODAY;
    return p;
  }

  /* ---------------- launch ---------------- */
  function launch() {
    $('boot').hidden = true;
    $('bridge').hidden = false;
    $('stream').hidden = false;
    render();
    window.scrollTo({ top: 0 });
  }

  function analyze() { return W.analyze(portfolio, inputs); }

  /* =====================================================================
   * COMMAND BRIDGE
   * ===================================================================== */
  function ring(score) {
    const p = Math.max(0, Math.min(1, score / 10));
    const r = 92, c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="${r}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="6"/>
      <circle cx="100" cy="100" r="${r}" fill="none" stroke="url(#og)" stroke-width="6" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 100 100)"/>
      <defs><linearGradient id="og" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6ee7ff"/><stop offset="1" stop-color="#a78bfa"/>
      </linearGradient></defs></svg>`;
  }

  function buildBridge(A) {
    const s = A.score, dx = A.dx, pr = A.pr;
    $('orb-gauge').outerHTML = ring(s.overall).replace('<svg', '<svg id="orb-gauge"');
    $('orb-num').textContent = s.overall.toFixed(1);

    const gfc = pr.stress.find((x) => x.scenario.id === 'gfc2008') || pr.stress[0];
    const mc = miniProb(A);
    const vitals = [
      ['Net spendable', INR(dx.spendable.net), ''],
      ['Portfolio XIRR', pct(dx.portfolioXirr), dx.portfolioXirr >= 0 ? 'up' : 'down'],
      ['Reach goal', pct(mc, 0), mc >= 0.6 ? 'up' : mc >= 0.35 ? 'gold' : 'down'],
      ['2008 survival', INR(gfc.troughValue), 'gold'],
    ];
    $('vitals').innerHTML = vitals.map(([l, v, c]) =>
      `<div class="vital"><span class="vl">${l}</span><span class="vv ${c}">${v}</span></div>`).join('');

    // live macro ticker (Global Macro Regime Switcher feed)
    const tk = [
      ['Nifty PE', inputs.niftyPE.toFixed(1), inputs.niftyPE > 25 ? 'd' : inputs.niftyPE < 18 ? 'u' : ''],
      ['CPI', inputs.cpi.toFixed(1) + '%', inputs.cpi > 6 ? 'd' : 'u'],
      ['US Fed', inputs.fedRate.toFixed(2) + '%', inputs.fedRate > 4 ? 'd' : 'u'],
      ['Crude', '$' + inputs.crude.toFixed(0), inputs.crude > 85 ? 'd' : 'u'],
      ['Regime', macroRegime().label, macroRegime().risk ? 'd' : 'u'],
    ];
    const span = tk.map(([k, v, c]) => `<span>${k} <b class="${c}">${v}</b></span>`).join('  ·  ');
    $('ticker').innerHTML = `<div class="tk">${span}  ·  ${span}  ·  </div>`;

    $('orb').onclick = () => goto('ch-command');
  }

  function miniProb(A) {
    if (!DSMC) return 0;
    const mc = DSMC.simulatePortfolioDynamic(portfolio, {
      years: inputs.yearsToGoal, monthlySip: inputs.monthlySip, stepUpRate: inputs.sipStepUp,
      mode: 'glide', currentMonthlyExpense: inputs.currentMonthlyExpense, paths: 800, seed: 7,
    });
    return mc.probReachTarget || 0;
  }

  function macroRegime() {
    // illustrative composite: tight money + costly oil + rich equity => risk-off
    const score = (inputs.fedRate > 4 ? 1 : 0) + (inputs.crude > 85 ? 1 : 0) + (inputs.niftyPE > 25 ? 1 : 0) + (inputs.cpi > 6 ? 1 : 0);
    if (score >= 3) return { label: 'Risk-Off', risk: true };
    if (score >= 2) return { label: 'Cautious', risk: true };
    return { label: 'Risk-On', risk: false };
  }

  /* =====================================================================
   * CHAPTERS — each returns a DOM <section>. Order = the narrative.
   * ===================================================================== */
  const CHAPTERS = [
    { id: 'ch-spend', label: 'Truly yours', build: chSpendable },
    { id: 'ch-xray', label: 'The X-Ray', build: chXray },
    { id: 'ch-risk', label: 'Risk & quality', build: chRisk },
    { id: 'ch-leak', label: 'The Leak', build: chLeak },
    { id: 'ch-storm', label: 'The Storm', build: chStorm },
    { id: 'ch-future', label: 'Your future', build: chFuture },
    { id: 'ch-glide', label: 'Glide-path', build: chGlide },
    { id: 'ch-val', label: 'Valuation', build: chValuation },
    { id: 'ch-macro', label: 'Macro switch', build: chMacro },
    { id: 'ch-sip', label: 'SIP regulator', build: chSipReg },
    { id: 'ch-tax', label: 'Tax router', build: chTax },
    { id: 'ch-lock', label: 'Calm-down lock', build: chLock },
    { id: 'ch-legacy', label: 'Legacy shield', build: chLegacy },
    { id: 'ch-compliance', label: 'Compliance', build: chCompliance },
    { id: 'ch-dust', label: 'Dust sweeper', build: chDust },
    { id: 'ch-command', label: 'Command board', build: chCommand },
  ];

  function render() {
    const A = analyze();
    buildBridge(A);
    const stream = $('stream');
    stream.innerHTML = '';
    CHAPTERS.forEach((c) => stream.appendChild(c.build(A)));
    buildRail();
    observe();
  }

  // Re-render only one chapter in place (keeps scroll position on tweaks).
  function rerender(id) {
    const A = analyze();
    buildBridge(A);
    const old = $(id);
    const c = CHAPTERS.find((x) => x.id === id);
    if (old && c) { const fresh = c.build(A); fresh.classList.add('in'); old.replaceWith(fresh); observe(); }
  }

  function buildRail() {
    $('rail').innerHTML = CHAPTERS.map((c) =>
      `<button data-go="${c.id}" data-label="${esc(c.label)}" aria-label="${esc(c.label)}"></button>`).join('');
    $('rail').querySelectorAll('button').forEach((b) => b.onclick = () => goto(b.dataset.go));
  }
  function goto(id) { const n = $(id); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  let io;
  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          const idx = CHAPTERS.findIndex((c) => c.id === e.target.id);
          $('rail').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === idx));
        }
      });
    }, { threshold: 0.18 });
    $('stream').querySelectorAll('.chapter').forEach((n) => io.observe(n));
  }

  /* shell helper for a chapter */
  function chapter(id, no, title, lead, bodyHtml) {
    return el(`<section class="chapter" id="${id}">
      <div class="ch-no">CHAPTER ${no}</div>
      <h2 class="ch-title">${title}</h2>
      <p class="ch-lead">${lead}</p>
      ${bodyHtml}
    </section>`);
  }
  const DEMO = '<span class="demo-pill">illustrative</span>';

  /* ----------------- CH: Spendable Wealth Counter (Part 1.4) ----------------- */
  function chSpendable(A) {
    const sp = A.dx.spendable, inv = A.dx.summary.invested;
    const node = chapter('ch-spend', '01', 'The money that’s really yours',
      `Apps show you a big gross number. This is what would actually <b>reach your bank</b> if you sold everything today — after exit load and tax, with the <b>₹1.25 L LTCG exemption</b> applied live.`,
      `<div class="bignum up">${INR(sp.net)}</div>
       <div class="subnum">Gross value ${INR(sp.gross)} · invested ${INR(inv)}</div>
       <div class="flow">
         <div class="step"><span class="sl">Gross value</span><span class="sv">${INR(sp.gross)}</span></div>
         <div class="step minus"><span class="sl">− Exit load</span><span class="sv">${INR(sp.exitLoad)}</span></div>
         <div class="step minus"><span class="sl">− STCG tax</span><span class="sv">${INR(sp.stcgTax)}</span></div>
         <div class="step minus"><span class="sl">− LTCG tax</span><span class="sv">${INR(sp.ltcgTax)}</span></div>
         <div class="step net"><span class="sl">Net in hand</span><span class="sv up">${INR(sp.net)}</span></div>
       </div>
       <p class="micro">LTCG exemption used: ${INR(sp.ltcgExemptionUsed)} of the ₹${(O.TAX.LTCG_EXEMPTION / 1e5).toFixed(2)} L cap. Equity STCG @ ${pct(O.TAX.EQUITY_STCG, 0)}, LTCG @ ${pct(O.TAX.EQUITY_LTCG, 0)} (current FY rules, overridable constants).</p>`);
    return node;
  }

  /* ----------------- CH: Micro Return X-Ray (Part 1.1) ----------------- */
  function chXray(A) {
    const funds = A.dx.funds.slice().sort((a, b) => b.current - a.current);
    const rows = funds.map((f) => {
      const r3 = f.rolling && f.rolling['3y'] && isFinite(f.rolling['3y'].avg) ? f.rolling['3y'].avg : NaN;
      const tag = f.deadwood ? '<span class="badge bad">underperformer</span>' : '<span class="badge good">on track</span>';
      return `<div class="fundrow">
        <div><div class="fn">${esc(f.scheme)} ${tag}</div>
          <div class="fmeta">${esc(f.amc || f.category)} · ${esc(f.plan)} plan · ${esc(f.assetClass)}</div></div>
        <div class="fstats">
          <span>Abs <b>${spct(f.absoluteReturn)}</b></span>
          <span>CAGR <b>${pct(f.cagr)}</b></span>
          <span>XIRR <b class="${f.xirr >= 0 ? 'up' : 'down'}">${pct(f.xirr)}</b></span>
          <span>3y roll <b>${pct(r3)}</b></span>
        </div></div>`;
    }).join('');
    return chapter('ch-xray', '02', 'A live X-ray of every rupee',
      `Trackers tell you the price. This tells you the <b>truth</b>: Absolute return, lump-sum <b>CAGR</b>, dated-cash-flow <b>XIRR</b> (Newton–Raphson) and <b>3-year rolling</b> consistency — fund by fund.`,
      `<div class="bignum grad">${pct(A.dx.portfolioXirr)}</div>
       <div class="subnum">whole-portfolio XIRR, time-weighted across every cash flow</div>
       <div style="margin-top:16px">${rows}</div>`);
  }

  /* ----------------- CH: Risk & Quality gauges (Part 1.2) ----------------- */
  function chRisk(A) {
    const withRisk = A.dx.funds.filter((f) => f.risk);
    const tw = withRisk.reduce((s, f) => s + f.current, 0) || 1;
    const wavg = (k) => withRisk.reduce((s, f) => s + (f.current / tw) * (f.risk[k] || 0), 0);
    const alpha = wavg('alpha'), beta = wavg('beta'), sharpe = wavg('sharpe'), dc = wavg('downsideCapture');
    const g = (v, lab, ex, cls) => `<div class="gauge-card"><div class="gv ${cls}">${v}</div><div class="gl">${lab}</div><div class="gx">${ex}</div></div>`;
    return chapter('ch-risk', '03', 'Risk &amp; quality, on instruments',
      `Four readouts decide if your funds earn their fee: <b>Alpha</b> (skill over the index), <b>Beta</b> (how hard you fall when it falls), <b>Sharpe</b> (reward per unit of risk) and <b>Downside Capture</b> (how much of the market’s falls you actually take).`,
      `<div class="gauges">
        ${g(spct(alpha, 1), 'Alpha (α)', alpha >= 0 ? 'beating the benchmark' : 'lagging the benchmark', alpha >= 0 ? 'up' : 'down')}
        ${g(num(beta, 2), 'Beta (β)', beta < 1 ? 'calmer than the market' : 'swings more than the market', beta < 1 ? 'up' : 'gold')}
        ${g(num(sharpe, 2), 'Sharpe', sharpe >= 1 ? 'strong risk-adjusted return' : 'modest for the risk', sharpe >= 1 ? 'up' : 'gold')}
        ${g(num(dc * 100, 0) + '%', 'Downside capture', dc < 1 ? 'absorbs only part of crashes' : 'takes the full hit', dc < 0.9 ? 'up' : 'down')}
      </div>
      <p class="micro">Value-weighted across holdings with NAV history, vs your benchmark, risk-free ${pct(0.065, 1)}. A downside capture of ${num(dc * 100, 0)}% means: when the market fell ~10%, your funds fell about ${num(dc * 10, 1)}%.</p>`);
  }

  /* ----------------- CH: Leakage + Overlap (Part 1.3) ----------------- */
  function chLeak(A) {
    const lk = A.dx.leakage;
    const overlaps = A.dx.overlaps || [];
    const ov = overlaps.length ? overlaps.map((o) =>
      `<div class="fundrow"><div class="fn">${esc(o.a)} ⇆ ${esc(o.b)}</div>
       <div class="fstats"><span>overlap <b class="${o.overlap >= 0.5 ? 'down' : 'gold'}">${pct(o.overlap, 0)}</b></span></div></div>`).join('')
      : '<p class="micro">No high-overlap pairs detected — your schemes aren’t secretly the same fund.</p>';
    return chapter('ch-leak', '04', 'The leak you never see',
      `Regular plans bury a distributor trail inside the expense ratio. Over 15 years that quietly drains your corpus. Here it is in <b>absolute rupees</b> — plus the “Zoo of Schemes” overlap check, so you’re not paying twice for the same stocks.`,
      `<div class="bignum down">${INR(lk.leakageRupees)}</div>
       <div class="subnum">lost to commissions over 15 years · ${pct(lk.leakagePctOfDirect, 1)} of the Regular-plan corpus</div>
       <div class="tiles">
         <div class="tile"><span class="tl">Regular-plan value today</span><b>${INR(lk.regularValueToday)}</b></div>
         <div class="tile"><span class="tl">Fix</span><b class="up">Switch to Direct</b><span class="sub">same fund, lower TER</span></div>
       </div>
       <h3 style="font-size:15px;margin:18px 0 4px">Portfolio overlap</h3>${ov}`);
  }

  /* ----------------- CH: Stress = a storm (Part 2.4) ----------------- */
  function chStorm(A) {
    const custom = F.customStress(portfolio, { equityShock: inputs.customEquityShock, name: 'Your own crash' });
    const all = A.pr.stress.concat([custom]);
    const rows = all.map((s) => {
      const sc = s.scenario; const flat = s.flatYears > 0;
      return `<div class="stormrow"><div class="sn"><b>${esc(sc.name)}</b><span>${esc(sc.blurb || '')}</span></div>
        <div style="text-align:right">
          <div class="sd ${flat ? 'gold' : 'down'}">${flat ? '0%' : pct(s.drawdownPct, 0)}</div>
          <div class="srec">${flat ? 'patience test · ' + s.flatYears + 'y flat' : 'trough ' + INR(s.troughValue) + ' · ' + sc.recoveryMonths + ' mo to recover'}</div>
        </div></div>`;
    }).join('');
    const node = chapter('ch-storm', '05', 'The storms you’ll survive',
      `Markets are weather. Here’s what real history would do to <b>your</b> exact mix today — equity takes the blow, debt cushions, so the number is yours, not generic. Drag your own crash and watch the front roll in.`,
      `<div class="storm"><div class="sclouds"></div>${rows}</div>
       <div class="ctrl"><label>Your custom crash <b id="crash-val">${Math.round(inputs.customEquityShock * 100)}% equity</b></label>
         <input type="range" id="crash" min="-70" max="-5" step="5" value="${Math.round(inputs.customEquityShock * 100)}"></div>
       <p class="micro">Shock depths anchored to real index drawdowns (2008 ≈ −45%, COVID ≈ −35%), applied allocation-aware. Recovery times are historical, not predictions.</p>`);
    node.querySelector('#crash').addEventListener('input', (e) => {
      inputs.customEquityShock = parseFloat(e.target.value) / 100;
      node.querySelector('#crash-val').textContent = Math.round(inputs.customEquityShock * 100) + '% equity';
      rerender('ch-storm');
    });
    return node;
  }

  /* ----------------- CH: Future — Dynamic FFN + Monte Carlo (Part 2.1) ----------------- */
  function chFuture(A) {
    const ffn = A.pr.ffn;
    let chart = '', tiles = '', prob = 0;
    if (DSMC) {
      const mc = DSMC.simulatePortfolioDynamic(portfolio, {
        years: inputs.yearsToGoal, monthlySip: inputs.monthlySip, stepUpRate: inputs.sipStepUp,
        mode: 'glide', currentMonthlyExpense: inputs.currentMonthlyExpense, paths: 1400, seed: 12345,
      });
      prob = mc.probReachTarget || 0;
      const last = mc.bands[mc.bands.length - 1];
      chart = CH ? `<div class="chartwrap">${CH.fan(mc.bands, { samples: mc.samples, baseline: mc.invested, height: 230 })}</div>
        <div class="legend"><span><i style="background:rgba(143,162,221,.6)"></i>likely band</span><span><i style="background:#ffcf6b"></i>median</span><span><i style="background:repeating-linear-gradient(90deg,#888 0 4px,transparent 4px 8px)"></i>invested</span></div>` : '';
      tiles = `<div class="tiles">
        <div class="tile"><span class="tl">Pessimistic (p10)</span><b>${INR(last.p10)}</b></div>
        <div class="tile"><span class="tl">Most likely</span><b class="up">${INR(mc.median)}</b></div>
        <div class="tile"><span class="tl">Optimistic (p90)</span><b>${INR(last.p90)}</b></div>
        <div class="tile"><span class="tl">Inflated FFN target</span><b class="gold">${INR(mc.target)}</b></div>
      </div>`;
    }
    const pcol = prob >= 0.6 ? 'up' : prob >= 0.35 ? 'gold' : 'down';
    const node = chapter('ch-future', '06', 'Your future, simulated alive',
      `Not one guess — thousands of futures where allocation <b>glides</b> down as the goal nears, volatility <b>switches</b> between calm and crisis (crashes cluster like 2008/COVID), your SIP <b>steps up ${pct(inputs.sipStepUp, 0)}/yr</b>, and the freedom number itself <b>moves</b> on a live-inflation path.`,
      `<div class="bignum ${pcol}">${pct(prob, 0)}</div>
       <div class="subnum">chance of reaching financial freedom in ${inputs.yearsToGoal} years</div>
       ${chart}${tiles}
       <div class="ctrlgrid">
         <div class="ctrl"><label>Years to goal <b id="y-val">${inputs.yearsToGoal}</b></label><input type="range" id="y" min="3" max="35" step="1" value="${inputs.yearsToGoal}"></div>
         <div class="ctrl"><label>Monthly SIP</label><input class="num-in" id="sip" type="number" min="0" step="1000" value="${inputs.monthlySip}"></div>
         <div class="ctrl"><label>SIP step-up / yr <b id="step-val">${Math.round(inputs.sipStepUp * 100)}%</b></label><input type="range" id="step" min="0" max="25" step="1" value="${Math.round(inputs.sipStepUp * 100)}"></div>
         <div class="ctrl"><label>Monthly expense today</label><input class="num-in" id="exp" type="number" min="0" step="1000" value="${inputs.currentMonthlyExpense}"></div>
       </div>
       <p class="micro">Dynamic FFN: today’s ${R0(inputs.currentMonthlyExpense)}/mo grows with inflation to <b>${INR(ffn.futureMonthlyExpense || ffn.target?.futureMonthlyExpense || 0)}</b>/mo at the goal. ${ffn.onTrack ? 'You’re on track. 🎯' : `Gap of <b>${INR(ffn.gap)}</b> — lifting your SIP by <b>${R0(ffn.sipTopUp)}/mo</b> closes it.`}</p>`);
    const reFuture = () => rerender('ch-future');
    node.querySelector('#y').addEventListener('input', (e) => { inputs.yearsToGoal = +e.target.value; node.querySelector('#y-val').textContent = inputs.yearsToGoal; reFuture(); });
    node.querySelector('#step').addEventListener('input', (e) => { inputs.sipStepUp = +e.target.value / 100; node.querySelector('#step-val').textContent = Math.round(inputs.sipStepUp * 100) + '%'; reFuture(); });
    node.querySelector('#sip').addEventListener('change', (e) => { inputs.monthlySip = +e.target.value || 0; reFuture(); });
    node.querySelector('#exp').addEventListener('change', (e) => { inputs.currentMonthlyExpense = +e.target.value || 0; reFuture(); });
    return node;
  }

  /* ----------------- CH: Glide-path (Part 2.2) ----------------- */
  function chGlide(A) {
    const g = A.pr.glide;
    const onTrack = g.direction === 'on-track';
    const strip = DSMC ? (() => {
      const yrs = inputs.yearsToGoal;
      const cells = [];
      for (let y = 0; y <= Math.min(yrs, 20); y++) cells.push(DSMC.glideEquity(yrs - y));
      return `<div class="gstrip">${cells.map((w) => `<span class="gt" title="${(w * 100).toFixed(0)}% equity"><i style="height:${(w * 100).toFixed(0)}%"></i></span>`).join('')}</div>`;
    })() : '';
    return chapter('ch-glide', '07', 'The autonomous glide-path',
      `As your goal nears, equity is dialled down automatically — <b>100 → 85 → 70 → 50%</b> — so a last-minute crash can’t undo a lifetime of saving. Here’s your prescribed path, and your mix vs target right now.`,
      `${strip}
       <div class="split" style="margin-top:16px">
         <div><div class="tl" style="font-size:11px;color:var(--faint)">YOUR MIX NOW</div>${mixBar(g.currentEquity)}</div>
         <div><div class="tl" style="font-size:11px;color:var(--faint)">GLIDE-PATH TARGET (${g.yearsToGoal}y out)</div>${mixBar(g.targetEquity)}</div>
       </div>
       <p class="micro ${onTrack ? '' : 'gold'}">${onTrack ? 'Your equity/debt split matches the target — no move needed. ✅'
         : `${g.direction === 'equity->debt' ? 'Too much equity for this horizon' : 'Room for more growth'} — move <b>${INR(g.rupeesToShift)}</b> ${g.direction === 'equity->debt' ? 'into safe debt (a phased STP)' : 'into equity'} to get back on path.`}</p>`);
  }
  function mixBar(eq) {
    return `<div class="mixbar"><span class="eq" style="width:${(eq * 100).toFixed(0)}%">${(eq * 100).toFixed(0)}% equity</span><span class="dt" style="width:${((1 - eq) * 100).toFixed(0)}%">${((1 - eq) * 100).toFixed(0)}% debt</span></div>`;
  }

  /* ----------------- CH: Valuation rebalancing (Part 2.3) ----------------- */
  function chValuation(A) {
    const v = A.pr.valuation;
    const col = v.zone === 'overvalued' ? 'var(--down)' : v.zone === 'undervalued' ? 'var(--up)' : 'var(--gold)';
    const node = chapter('ch-val', '08', 'Rebalance on worth, not the calendar',
      `Most people step up blindly every year. This watches the <b>Nifty PE</b> live: rich (PE&nbsp;&gt;&nbsp;25) → book profit into debt; cheap (PE&nbsp;&lt;&nbsp;18) → deploy the buffer into equity. Drag it and watch the call change.`,
      `<div class="dial">
         <div class="zoneflag" style="border-color:${col}"><div class="zh" style="color:${col}">${esc(v.headline)}</div><div class="zr">${esc(v.rationale)}</div></div>
         <div class="zoneflag"><div class="zh">${v.moveRupees > 0 ? INR(v.moveRupees) : 'No move'}</div><div class="zr">${v.moveRupees > 0 ? (v.action === 'equity->debt' ? 'profit to book equity → debt' : 'buffer to deploy debt → equity') : 'fairly valued — hold steady'}</div></div>
       </div>
       <div class="ctrl" style="margin-top:14px"><label>Nifty PE <b id="pe-val">${inputs.niftyPE.toFixed(1)}</b></label><input type="range" id="pe" min="12" max="32" step="0.5" value="${inputs.niftyPE}"></div>
       <p class="micro">A live build feeds real PE / PB / Market-Cap-to-GDP. Thresholds (overvalued&nbsp;25, undervalued&nbsp;18) are overridable.</p>`);
    node.querySelector('#pe').addEventListener('input', (e) => {
      inputs.niftyPE = parseFloat(e.target.value);
      node.querySelector('#pe-val').textContent = inputs.niftyPE.toFixed(1);
      rerender('ch-val');
    });
    return node;
  }

  /* ----------------- CH: Global Macro Regime Switcher (Part 3.4) ----------------- */
  function chMacro(A) {
    const reg = macroRegime();
    const tilt = reg.risk
      ? 'Rotate fresh IT / pharma SIPs into <b>defensive liquid funds</b> for now; keep core holdings intact.'
      : 'Conditions are constructive — keep deploying into equity on schedule.';
    const node = chapter('ch-macro', '09', 'The global macro early-warning',
      `Your portfolio doesn’t live in India alone. This watches the <b>US Fed</b> rate, <b>crude oil</b> and global liquidity, and warns you <i>before</i> a storm reaches your funds. ${DEMO}`,
      `<div class="bignum ${reg.risk ? 'down' : 'up'}">${reg.label}</div>
       <div class="subnum">composite regime from rates · oil · valuations · inflation</div>
       <div class="ctrlgrid" style="margin-top:14px">
         <div class="ctrl"><label>US Fed rate <b id="fed-val">${inputs.fedRate.toFixed(2)}%</b></label><input type="range" id="fed" min="0" max="8" step="0.25" value="${inputs.fedRate}"></div>
         <div class="ctrl"><label>Crude (Brent) <b id="oil-val">$${inputs.crude.toFixed(0)}</b></label><input type="range" id="oil" min="40" max="140" step="1" value="${inputs.crude}"></div>
         <div class="ctrl"><label>CPI inflation <b id="cpi-val">${inputs.cpi.toFixed(1)}%</b></label><input type="range" id="cpi" min="2" max="11" step="0.1" value="${inputs.cpi}"></div>
       </div>
       <div class="zoneflag" style="border-color:${reg.risk ? 'var(--down)' : 'var(--up)'}"><div class="zr">${tilt}</div></div>`);
    const bind = (id, key, cast, fmt, vid) => node.querySelector('#' + id).addEventListener('input', (e) => {
      inputs[key] = cast(e.target.value); node.querySelector('#' + vid).textContent = fmt(inputs[key]); rerender('ch-macro');
    });
    bind('fed', 'fedRate', parseFloat, (v) => v.toFixed(2) + '%', 'fed-val');
    bind('oil', 'crude', parseFloat, (v) => '$' + v.toFixed(0), 'oil-val');
    bind('cpi', 'cpi', parseFloat, (v) => v.toFixed(1) + '%', 'cpi-val');
    return node;
  }

  /* ----------------- CH: Dynamic SIP Regulator (Part 4.1) ----------------- */
  function chSipReg(A) {
    const rich = inputs.niftyPE > 25, cheap = inputs.niftyPE < 18;
    const base = inputs.monthlySip, stepUp = base * inputs.sipStepUp;
    const verdict = rich
      ? `Market looks <b>expensive</b> (PE ${inputs.niftyPE.toFixed(1)}). Your ${R0(stepUp)} step-up is parked in a <b>safe liquid fund</b>, accumulating dry powder.`
      : cheap
        ? `Market looks <b>cheap</b> (PE ${inputs.niftyPE.toFixed(1)}). The accumulated buffer is <b>auto-deployed</b> into equity — maximum units at the lowest NAV.`
        : `Market is <b>fairly valued</b>. Step-up flows into equity as normal.`;
    return chapter('ch-sip', '10', 'A SIP that thinks about price',
      `Stepping up 10% every year — even when the market is dear — is a habit, not a strategy. This links your step-up to valuation: <b>hoard</b> when expensive, <b>pounce</b> when it crashes. ${DEMO}`,
      `<div class="tiles">
         <div class="tile"><span class="tl">Base SIP</span><b>${R0(base)}</b><span class="sub">/month</span></div>
         <div class="tile"><span class="tl">Step-up slice</span><b class="${rich ? 'gold' : 'up'}">${R0(stepUp)}</b><span class="sub">${rich ? 'accumulating in liquid' : cheap ? 'deploying to equity' : 'into equity'}</span></div>
         <div class="tile"><span class="tl">Nifty PE</span><b class="${rich ? 'down' : cheap ? 'up' : ''}">${inputs.niftyPE.toFixed(1)}</b><span class="sub">${rich ? 'expensive' : cheap ? 'cheap' : 'fair'}</span></div>
       </div>
       <div class="zoneflag" style="border-color:${rich ? 'var(--gold)' : cheap ? 'var(--up)' : 'var(--line)'}"><div class="zr">${verdict}</div></div>
       <p class="micro">Drag the Nifty PE in “Valuation” above to see the regulator switch between hoarding and deploying.</p>`);
  }

  /* ----------------- CH: Multi-Year Tax Parallel-Universe Router (Part 3.2) ----------------- */
  function chTax(A) {
    const exemption = O.TAX.LTCG_EXEMPTION, rate = O.TAX.EQUITY_LTCG;
    const gain = Math.max(0, inputs.goalAmount * 0.45); // illustrative LTCG inside the withdrawal
    const oneShot = Math.max(0, gain - exemption) * rate;
    const split = Math.max(0, gain - 2 * exemption) * rate; // two FYs => two exemptions
    const saved = oneShot - split;
    const node = chapter('ch-tax', '11', 'The tax “parallel universe” router',
      `Withdraw it all in one financial year and you waste a year’s exemption. Split the exit across <b>two FYs</b> (e.g. March then April) and you legally claim the <b>₹1.25 L exemption twice</b>. ${DEMO}`,
      `<div class="split">
         <div><div class="tl" style="font-size:11px;color:var(--faint)">WITHDRAW ALL AT ONCE</div><div class="bignum down" style="font-size:clamp(34px,8vw,56px)">${INR(oneShot)}</div><div class="subnum">LTCG tax in one FY</div></div>
         <div><div class="tl" style="font-size:11px;color:var(--faint)">SPLIT ACROSS TWO FYs</div><div class="bignum up" style="font-size:clamp(34px,8vw,56px)">${INR(split)}</div><div class="subnum">two exemptions claimed</div></div>
       </div>
       <div class="zoneflag" style="border-color:var(--up);margin-top:6px"><div class="zh up">You keep ${INR(saved)} more</div><div class="zr">Route ~40% in March and ~60% after April 1 to spread the gain across financial years.</div></div>
       <div class="ctrl" style="margin-top:14px"><label>Goal withdrawal <b id="goal-val">${INR(inputs.goalAmount)}</b></label><input type="range" id="goal" min="500000" max="20000000" step="100000" value="${inputs.goalAmount}"></div>
       <p class="micro">Illustrative: assumes ~45% of the withdrawal is long-term gain, taxed @ ${pct(rate, 0)} above the ₹${(exemption / 1e5).toFixed(2)} L exemption. A live build reads your actual cost basis per folio.</p>`);
    node.querySelector('#goal').addEventListener('input', (e) => {
      inputs.goalAmount = +e.target.value;
      node.querySelector('#goal-val').textContent = INR(inputs.goalAmount);
      rerender('ch-tax');
    });
    return node;
  }

  /* ----------------- CH: Panic-Sensing Behavioral Lock (Part 3.1) ----------------- */
  function chLock(A) {
    const taps = inputs.panicTaps, locked = inputs.sellLocked;
    const node = chapter('ch-lock', '12', 'The calm-down lock',
      `When markets crash, people refresh the app dozens of times and panic-sell at the bottom. This senses the panic — and protects you from yourself. Tap “open app” fast to feel it. ${DEMO}`,
      `<div class="lock ${locked ? 'locked' : ''}" id="lockbox">
         <div class="lstate ${locked ? 'down' : 'up'}">${locked ? '🔒 Calm-Down Mode' : '🧘 Calm'}</div>
         <p class="micro" style="margin-top:6px">${locked
           ? 'Panic detected. Losses are hidden, the <b>Sell button is locked for 24 hours</b>, and a counselling note is shown. History says staying invested wins.'
           : `App opens today: <b>${taps}</b>. ${taps >= 6 ? 'Getting twitchy…' : 'All good.'} (10+ rapid opens trips the lock.)`}</p>
         <div class="taprow">
           <button class="cta sm" id="tap">Open app</button>
           <button class="cta sm ghost" id="resetlock">Reset</button>
         </div>
       </div>`);
    node.querySelector('#tap').addEventListener('click', () => {
      inputs.panicTaps++; if (inputs.panicTaps >= 10) inputs.sellLocked = true; rerender('ch-lock');
    });
    node.querySelector('#resetlock').addEventListener('click', () => { inputs.panicTaps = 0; inputs.sellLocked = false; rerender('ch-lock'); });
    return node;
  }

  /* ----------------- CH: Legacy Shield & Nominee Auto-Pilot (Part 3.3) ----------------- */
  function chLegacy(A) {
    const d = inputs.inactiveDays;
    const stage = d >= 90 ? 2 : d >= 60 ? 1 : 0;
    const stages = [
      { t: 'Active', c: 'up', m: 'No action needed — you’re using the account normally.' },
      { t: 'Safety alerts sent', c: 'gold', m: 'No activity for 60 days. The system is pinging you to confirm you’re okay.' },
      { t: 'Nominee key released', c: 'down', m: 'No response for 90 days. An <b>encrypted digital key</b> is auto-sent to your registered nominee, who gets a step-by-step <b>Auto-Pilot Claim Guide</b> — no broker, no lawyer.' },
    ][stage];
    const node = chapter('ch-legacy', '13', 'The legacy shield',
      `If something happens to you, your family shouldn’t lose your wealth to paperwork. After long inactivity, an encrypted key reaches your nominee with a guided claim path — straight to the family bank account. ${DEMO}`,
      `<div class="bignum ${stages.c}">${stages.t}</div>
       <div class="subnum">${d} days of inactivity</div>
       <div class="zoneflag" style="border-color:var(--${stages.c === 'up' ? 'up' : stages.c === 'gold' ? 'gold' : 'down'});margin-top:6px"><div class="zr">${stages.m}</div></div>
       <div class="ctrl" style="margin-top:14px"><label>Days inactive <b id="inact-val">${d}</b></label><input type="range" id="inact" min="0" max="120" step="5" value="${d}"></div>`);
    node.querySelector('#inact').addEventListener('input', (e) => {
      inputs.inactiveDays = +e.target.value; node.querySelector('#inact-val').textContent = inputs.inactiveDays; rerender('ch-legacy');
    });
    return node;
  }

  /* ----------------- CH: Pre-Emptive Compliance Shield (Part 4.2) ----------------- */
  function chCompliance(A) {
    // illustrative statuses keyed off the demo holdings
    const items = [
      { k: 'Re-KYC', s: 'pending', m: 'Due in 10 days — renew in 2 minutes or next month’s SIP may freeze.' },
      { k: 'Bank mandate', s: 'ok', m: 'Active and sufficient.' },
      { k: 'Signature match', s: 'ok', m: 'Verified.' },
    ];
    const rows = items.map((i) => `<div class="fundrow"><div class="fn">${i.k} <span class="badge ${i.s === 'ok' ? 'good' : 'warn'}">${i.s === 'ok' ? 'clear' : 'action soon'}</span></div>
      <div class="fstats" style="max-width:60%"><span style="color:var(--muted)">${i.m}</span></div></div>`).join('');
    return chapter('ch-compliance', '14', 'The compliance shield',
      `A bounced SIP from a pending KYC can freeze your account for weeks. This watches your folio status and alerts you <b>10 days early</b>, so a 2-minute fix keeps your investing uninterrupted. ${DEMO}`,
      `${rows}<p class="micro">A live build tracks KYC / mandate / nominee status with the RTAs and fires alerts before anything bounces.</p>`);
  }

  /* ----------------- CH: Forgotten-Folio Dust Sweeper (Part 4.3) ----------------- */
  function chDust(A) {
    const found = [
      { s: 'Old ELSS (closed email)', v: 18450 },
      { s: 'Fractional units — Liquid', v: 1260 },
      { s: 'Forgotten folio (old mobile)', v: 7320 },
    ];
    const total = found.reduce((s, f) => s + f.v, 0);
    const rows = found.map((f) => `<div class="fundrow"><div class="fn">${esc(f.s)}</div><div class="fstats"><span><b class="up">${INR(f.v)}</b></span></div></div>`).join('');
    return chapter('ch-dust', '15', 'The forgotten-money sweeper',
      `Investments made years ago from an old email or a dead phone number quietly disappear. This scans every CAMS / KFintech folio linked to your PAN and reunites the “dust” with your main portfolio. ${DEMO}`,
      `<div class="bignum up">${INR(total)}</div><div class="subnum">recoverable across ${found.length} forgotten folios</div>
       <div style="margin-top:12px">${rows}</div>
       <button class="cta sm primary" style="margin-top:14px" onclick="this.textContent='✓ Merge requested'">Merge into main portfolio</button>`);
  }

  /* ----------------- CH: Command Board — Health + Actions (Part 5) ----------------- */
  function chCommand(A) {
    const s = A.score;
    const pills = [['Performance', s.pillars.performance], ['Cost', s.pillars.cost], ['Diversification', s.pillars.diversification], ['Alignment', s.pillars.alignment]]
      .map(([n, v]) => `<div class="tile"><span class="tl">${n}</span><b class="${v >= 7 ? 'up' : v >= 4 ? 'gold' : 'down'}">${v.toFixed(1)}</b></div>`).join('');
    const acts = A.actions.length ? A.actions.map((a) => {
      const sev = a.severity === 'critical' ? 'critical' : a.severity === 'warn' ? 'warn' : '';
      const ic = a.severity === 'critical' ? '🔴' : a.severity === 'warn' ? '🟡' : '🟢';
      return `<div class="action ${sev}"><div class="ico" style="background:rgba(255,255,255,0.05)">${ic}</div>
        <div class="atext"><b>${esc(a.issue)}</b><span>${esc(a.advice)}</span></div>
        <button class="cta sm act-btn" data-act="${esc(a.button)}">${esc(a.button)}</button></div>`;
    }).join('') : '<p class="micro">No urgent actions — your portfolio is in good shape. ✅</p>';
    const node = chapter('ch-command', '16', 'Your live command board',
      `Everything above, rolled into one number and one to-do list. A <b>Unified Health Score</b> across Performance, Cost, Diversification and Alignment — and the exact, ranked moves to act on, each a single tap.`,
      `<div class="split">
         <div><div class="bignum grad">${s.overall.toFixed(1)}<span style="font-size:0.4em;color:var(--faint)"> / 10</span></div><div class="subnum">${esc(s.grade)}</div></div>
         <div class="tiles" style="margin:0">${pills}</div>
       </div>
       <h3 style="font-size:16px;margin:20px 0 8px">Action board</h3>${acts}`);
    node.querySelectorAll('.act-btn').forEach((b) => b.addEventListener('click', () => {
      b.textContent = '✓ Noted'; b.disabled = true; toast('“' + b.dataset.act + '” — a live build would route this to your AMC / RTA.');
    }));
    return node;
  }

  /* ---------------- toast ---------------- */
  let toastT;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.hidden = true, 300); }, 4200);
  }
})();
