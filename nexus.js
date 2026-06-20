/* =====================================================================
 * THE ORACLE — your money's command room (guided console)
 * ---------------------------------------------------------------------
 * One screen at a time. Plain words. Three rooms that never mix:
 *   NOW  — where you stand today (current reality)
 *   NEXT — will you be okay (future projections, clearly labelled)
 *   DO   — what to do (decisions, one tap each)
 * Choose, see, feel — the Two-Doors mechanic, applied to your whole money.
 *
 * Presentation only. Every number is computed by the existing engines
 * (ORACLE/FUTURE/SIM/DSMC/WORKFLOW/IO/DATA/CHARTS). Features the engines
 * don't model yet carry a DEMO pill and clearly-labelled illustrative math.
 * ===================================================================== */
'use strict';
(function () {
  const O = window.ORACLE, F = window.FUTURE, W = window.WORKFLOW, ADV = window.ADVICE;
  const SIM = window.SIM, DSMC = window.DSMC, CH = window.ORACLE_CHARTS;
  const IO = window.ORACLE_IO, DATA = window.ORACLE_DATA;
  if (!O || !F || !W) { console.error('Oracle: engines missing'); return; }
  const TODAY = '2026-06-20';
  const app = document.getElementById('app');

  /* ---------------- format ---------------- */
  const INR = (v) => { if (!isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2) + ' L';
    return s + '₹' + Math.round(a).toLocaleString('en-IN'); };
  const R0 = (v) => (isFinite(v) ? '₹' + Math.round(v).toLocaleString('en-IN') : '—');
  const pct = (v, d = 1) => (isFinite(v) ? (v * 100).toFixed(d) + '%' : '—');
  const spct = (v, d = 1) => (isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%' : '—');
  const num = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : '—');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const DEMO = '<span class="demo-pill">illustrative</span>';

  /* ---------------- state ---------------- */
  let portfolio = null;
  let dataSource = 'demo'; // 'demo' | 'real' | 'imported'
  const inputs = {
    yearsToGoal: 18, monthlySip: 30000, currentMonthlyExpense: 50000, sipStepUp: 0.10,
    niftyPE: 27, fedRate: 4.5, crude: 82, cpi: 6.1, goalAmount: 5000000,
    riskProfile: 'Moderate', liquidSavings: 0,
  };
  const planOpts = () => ({ profile: inputs.riskProfile, yearsToGoal: inputs.yearsToGoal, monthlyExpense: inputs.currentMonthlyExpense, liquidSavings: inputs.liquidSavings });

  /* ---------------- persistence (localStorage; never leaves the device) ---- */
  const PKEY = 'oracle.nexus.pf', IKEY = 'oracle.nexus.inputs', SKEY = 'oracle.nexus.src';
  function save() {
    try {
      if (portfolio && portfolio.holdings.length) localStorage.setItem(PKEY, IO.portfolioToJSON(portfolio));
      else localStorage.removeItem(PKEY);
      localStorage.setItem(IKEY, JSON.stringify(inputs));
      localStorage.setItem(SKEY, dataSource);
    } catch (e) { /* storage full / disabled — non-fatal */ }
  }
  function loadSaved() {
    try {
      const ij = localStorage.getItem(IKEY); if (ij) Object.assign(inputs, JSON.parse(ij));
      const pj = localStorage.getItem(PKEY);
      if (pj) { portfolio = ensureBench(IO.parsePortfolioJSON(pj)); dataSource = localStorage.getItem(SKEY) || 'imported'; return true; }
    } catch (e) { /* ignore corrupt state */ }
    return false;
  }

  /* ---------------- router (screen stack) ---------------- */
  let stack = [{ id: 'boot' }];
  const cur = () => stack[stack.length - 1];
  function go(id, params = {}) { stack.push({ id, params }); render('fwd'); }
  function back() { if (stack.length > 1) { stack.pop(); render('back'); } }
  function home() { stack = [{ id: 'home' }]; render('fwd'); }

  function render(dir) {
    const c = cur();
    const node = (SCREENS[c.id] || SCREENS.home)(c.params || {});
    node.classList.add(dir === 'back' ? 'enter-back' : 'enter');
    app.innerHTML = ''; app.appendChild(node);
    // generic wiring
    node.querySelectorAll('[data-back]').forEach((b) => b.onclick = back);
    node.querySelectorAll('[data-home]').forEach((b) => b.onclick = home);
    node.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
    node.querySelectorAll('.maths-toggle').forEach((b) => b.onclick = () => {
      const p = b.nextElementSibling; const open = p.hasAttribute('hidden');
      if (open) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
      b.textContent = (open ? 'Hide the maths ▴' : b.dataset.label || 'Show me the maths ▾');
    });
    node.scrollTop = 0;
    if (portfolio) save();
  }

  function analyze() { return W.analyze(portfolio, inputs); }

  /* ---------------- shared bits ---------------- */
  function ring(score) {
    const p = Math.max(0, Math.min(1, score / 10)), r = 92, c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7"/>
      <circle cx="100" cy="100" r="${r}" fill="none" stroke="url(#og)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 100 100)"/>
      <defs><linearGradient id="og" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ee7ff"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs></svg>`;
  }
  function topbar(roomCls, label) {
    return `<div class="topbar"><button class="back" data-back aria-label="Back">‹</button><span class="roomtag ${roomCls}">${label}</span></div>`;
  }
  function guide(text) { return `<div class="guide"><span class="gico">🧭</span><span class="gtext">${text}</span></div>`; }
  function maths(rowsHtml, label) {
    return `<button class="maths-toggle" data-label="${esc(label || 'Show me the maths ▾')}">${esc(label || 'Show me the maths ▾')}</button><div class="maths" hidden>${rowsHtml}</div>`;
  }
  function mcRun(paths, seed) {
    return DSMC.simulatePortfolioDynamic(portfolio, {
      years: inputs.yearsToGoal, monthlySip: inputs.monthlySip, stepUpRate: inputs.sipStepUp,
      mode: 'glide', currentMonthlyExpense: inputs.currentMonthlyExpense, paths: paths || 1000, seed: seed || 12345,
    });
  }

  /* =====================================================================
   * SCREENS
   * ===================================================================== */
  const SCREENS = {};

  /* ---- BOOT ---- */
  SCREENS.boot = () => {
    const n = el(`<section class="screen center"><div class="wrap">
      <p class="boot-kicker">Your money, in plain words</p>
      <h1 class="boot-title">The <span>Oracle</span></h1>
      <p class="boot-sub">Ask your money anything. In one calm room you'll see — in plain language — <b>where you stand today</b>, <b>whether you'll be okay</b>, and <b>exactly what to do</b>. One screen at a time. Nothing confusing.</p>
      <div class="boot-actions">
        <button class="cta primary" id="b-build">🔎 &nbsp;Build my real portfolio</button>
        <button class="cta ghost" id="b-up">⤴ &nbsp;Upload CAS / CSV</button>
        <button class="cta ghost" id="b-sample">▶ &nbsp;Try a demo</button>
      </div>
      <p class="boot-foot">Real fund data is pulled live from public NAV records · your portfolio is saved only on this device</p>
      <input type="file" id="file-in" accept=".csv,.json,.pdf" hidden>
    </div></section>`);
    n.querySelector('#b-build').onclick = () => go('build');
    n.querySelector('#b-sample').onclick = () => { portfolio = O.samplePortfolio(TODAY); dataSource = 'demo'; home(); };
    n.querySelector('#b-up').onclick = () => n.querySelector('#file-in').click();
    n.querySelector('#file-in').onchange = (e) => importFile(e.target.files[0]);
    return n;
  };

  function importFile(file) {
    if (!file) return; const reader = new FileReader();
    reader.onload = () => {
      try {
        if (/\.json$/i.test(file.name)) { portfolio = ensureBench(IO.parsePortfolioJSON(reader.result)); dataSource = 'imported'; }
        else if (/\.csv$/i.test(file.name)) {
          const { holdings, errors } = IO.parseHoldingsCSV(reader.result);
          if (!holdings.length) return toast('Could not read that CSV.');
          portfolio = ensureBench({ name: 'Imported', asOf: TODAY, holdings }); dataSource = 'imported';
          if (errors.length) toast(errors.length + ' row(s) skipped.');
        } else { portfolio = O.samplePortfolio(TODAY); dataSource = 'demo'; toast('CAS PDF parsing needs a backend — loaded a demo so you can explore. Use “Build my real portfolio” to add live funds.'); }
        home();
      } catch (err) { toast('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
  }
  function ensureBench(p) { if (!p.benchmark || !p.benchmark.navHistory) p.benchmark = O.samplePortfolio(TODAY).benchmark; if (!p.asOf) p.asOf = TODAY; return p; }

  /* ---- HOME ---- */
  SCREENS.home = () => {
    const A = analyze();
    const plan = ADV.allocationPlan(portfolio, planOpts());
    let urgent = A.actions.filter((a) => a.severity === 'critical' || a.severity === 'warn').length;
    if (!plan.emergency.ok || plan.direction !== 'on-track') urgent += 1;
    const verdict = urgent === 0
      ? `Your money looks healthy. <b>Nothing urgent</b> right now.`
      : `Your money is in <b>${A.score.grade.toLowerCase()}</b> shape — but <b>${urgent} thing${urgent > 1 ? 's' : ''}</b> need${urgent > 1 ? '' : 's'} your attention.`;
    const srcLabel = dataSource === 'real' ? '● Live fund data' : dataSource === 'imported' ? '● Your imported data' : '○ Demo data';
    const srcCls = dataSource === 'real' ? 'up' : dataSource === 'imported' ? 'up' : 'gold';
    const n = el(`<section class="screen center"><div class="wrap">
      <div class="orb">${ring(A.score.overall)}<b>${A.score.overall.toFixed(1)}</b><small>HEALTH</small></div>
      <div class="srcbadge ${srcCls}">${srcLabel}</div>
      <h2 class="home-verdict">${verdict}</h2>
      <p class="home-sub">Pick a door. Each one answers a plain question, one screen at a time.</p>
      <div class="doors">
        <button class="door now" data-go="room-now"><span class="dico">📍</span><span><span class="dtitle">Where I stand today</span><span class="dsub">Your money right now — what's real</span></span><span class="darrow">›</span></button>
        <button class="door next" data-go="room-next"><span class="dico">🔭</span><span><span class="dtitle">Will I be okay?</span><span class="dsub">Your future — projections, clearly marked</span></span><span class="darrow">›</span></button>
        <button class="door do" data-go="room-do"><span class="dico">✅</span><span><span class="dtitle">What should I do?</span><span class="dsub">Your to-do list — one tap each</span></span>${urgent ? `<span class="dbadge">${urgent}</span>` : '<span class="darrow">›</span>'}</button>
      </div>
      <div class="home-foot"><button class="linkbtn" id="plan">⚙ My plan &amp; holdings</button><button class="linkbtn" id="restart">↺ Use a different portfolio</button></div>
    </div></section>`);
    n.querySelector('#plan').onclick = () => go('plan');
    n.querySelector('#restart').onclick = () => { try { localStorage.removeItem(PKEY); } catch (e) {} portfolio = null; dataSource = 'demo'; stack = [{ id: 'boot' }]; render('back'); };
    return n;
  };

  /* ---- ROOM: NOW ---- */
  SCREENS['room-now'] = () => {
    const A = analyze();
    const sp = A.dx.spendable;
    const anyBad = A.dx.funds.some((f) => f.deadwood);
    const leakBad = A.dx.leakage.leakageRupees > A.dx.summary.current * 0.03;
    const q = [
      ['now-spendable', 'How much is actually mine?', 'If you sold everything today — after tax & charges', `<span class="chip good">${INR(sp.net)}</span>`],
      ['now-funds', 'How are my funds &amp; SIPs doing?', 'Each fund’s real return, and whether any is lagging', anyBad ? '<span class="chip warn">1 lagging</span>' : '<span class="chip good">all healthy</span>'],
      ['now-leak', 'Am I leaking money in fees?', 'The hidden commission drain, in real rupees', leakBad ? `<span class="chip bad">${INR(A.dx.leakage.leakageRupees)}</span>` : '<span class="chip good">low</span>'],
      ['now-alloc', 'What am I holding, and where?', 'Your equity/debt mix and Direct vs Regular split', `<span class="chip">${pct(A.dx.summary.allocation.Equity || 0, 0)} equity</span>`],
    ];
    return el(`<section class="screen"><div class="wrap">
      ${topbar('now', 'NOW · TODAY')}
      <h2 class="roomtitle">Where you stand today</h2>
      <p class="roomguide">Only what’s true <b>right now</b> — no forecasts here. Tap a question.</p>
      <div class="qlist">${q.map(([id, qq, qa, chip]) =>
        `<button class="qcard now" data-go="${id}"><span><span class="qq">${qq}</span><span class="qa">${qa}</span></span><span class="qright">${chip}<span class="qarrow">›</span></span></button>`).join('')}</div>
    </div></section>`);
  };

  /* ---- ROOM: NEXT ---- */
  SCREENS['room-next'] = () => {
    const A = analyze();
    const prob = mcRun(700, 7).probReachTarget || 0;
    const plan = ADV.allocationPlan(portfolio, planOpts());
    const allocChip = !plan.emergency.ok ? '<span class="chip bad">emergency fund first</span>' : plan.direction === 'on-track' ? '<span class="chip good">well allocated</span>' : '<span class="chip warn">rebalance</span>';
    const q = [
      ['next-freedom', 'When can I be financially free?', 'The corpus that funds your life — and your odds', `<span class="chip ${prob >= 0.6 ? 'good' : prob >= 0.35 ? 'warn' : 'bad'}">${pct(prob, 0)} likely</span>`],
      ['next-crash', 'What if the market crashes tomorrow?', 'Live a real crash on your money — and choose', '<span class="chip warn">feel it</span>'],
      ['next-glide', 'Is my money allocated safely?', 'Emergency fund first, then a risk-suited mix', allocChip],
      ['next-weather', 'Is the market expensive right now?', 'The valuation & global weather, in one read', `<span class="chip">PE ${inputs.niftyPE.toFixed(0)}</span>`],
    ];
    return el(`<section class="screen"><div class="wrap">
      ${topbar('next', 'NEXT · YOUR FUTURE')}
      <h2 class="roomtitle">Will you be okay?</h2>
      <p class="roomguide">These are <b>projections</b>, not promises — ranges of possibility, never predictions. Tap a question.</p>
      <div class="qlist">${q.map(([id, qq, qa, chip]) =>
        `<button class="qcard next" data-go="${id}"><span><span class="qq">${qq}</span><span class="qa">${qa}</span></span><span class="qright">${chip}<span class="qarrow">›</span></span></button>`).join('')}</div>
    </div></section>`);
  };

  /* ---- ROOM: DO (action board) ---- */
  SCREENS['room-do'] = () => {
    const A = analyze();
    const plan = ADV.allocationPlan(portfolio, planOpts());
    // Drop the workflow's allocation/equity actions — ADVICE owns allocation now,
    // so we never show an un-guarded "add equity" suggestion.
    const acts = A.actions.filter((a) => !/equity|allocation|glide/i.test(a.issue));
    // Safety-first actions, prepended in priority order.
    const safety = [];
    if (!plan.emergency.ok) safety.push({ severity: 'critical', issue: 'Build your emergency fund first',
      advice: `Park about ${INR(plan.emergency.gap)} more in a liquid fund to reach ${plan.emergency.months} months of expenses. This must come before any equity — it's what keeps an emergency from forcing a bad sale.`, button: 'How to do this' });
    else if (plan.direction !== 'on-track') safety.push({ severity: 'warn', issue: plan.direction === 'trim-equity' ? 'Trim equity to a safer mix' : 'Add to equity (gradually)',
      advice: `Your ${pct(plan.currentEquity, 0)} equity vs a suitable ${pct(plan.targetEquity, 0)} (${inputs.riskProfile}, ${inputs.yearsToGoal}y). Move about ${INR(plan.moveRupees)} ${plan.direction === 'trim-equity' ? 'into debt/gold' : 'in via a phased STP, never a lump sum'}.`, button: 'See allocation plan', _go: 'next-glide' });
    // a couple of always-useful rare moves, framed as actions
    const extra = [
      { _go: 'do-tax', severity: 'info', issue: 'Plan a tax-free exit', advice: 'When you withdraw at your goal, splitting it across two financial years can legally cut the tax — often to ₹0.', button: 'Open tax router' },
      { _go: 'do-dust', severity: 'info', issue: 'Find forgotten money', advice: 'Old folios from a dead email or phone number may still hold units in your name. Sweep them into one place.', button: 'Scan for lost folios' },
    ];
    const all = safety.concat(acts, extra);
    const body = all.length ? all.map((a) => {
      const sev = a.severity === 'critical' ? 'critical' : a.severity === 'warn' ? 'warn' : '';
      const ic = a.severity === 'critical' ? '🔴' : a.severity === 'warn' ? '🟡' : '🔧';
      const btn = a._go ? `<button class="cta sm" data-go="${a._go}">${esc(a.button)} →</button>`
        : `<button class="cta sm act-btn" data-act="${esc(a.button)}">${esc(a.button)}</button>`;
      return `<div class="action ${sev}"><div class="aico">${ic}</div><div><div class="ah">${esc(a.issue)}</div><div class="ad">${esc(a.advice)}</div>${btn}</div></div>`;
    }).join('') : '<p class="means">Nothing needs doing right now. Your portfolio is in good shape. ✅</p>';
    const n = el(`<section class="screen"><div class="wrap">
      ${topbar('do', 'DO · YOUR MOVES')}
      <h2 class="roomtitle">What to do</h2>
      <p class="roomguide">Ranked by what matters most. Each is one clear move — tap to act.</p>
      ${body}
      <p class="micro">Action buttons are illustrative — a connected build routes the transaction to your AMC / RTA.</p>
    </div></section>`);
    n.querySelectorAll('.act-btn').forEach((b) => b.onclick = () => { b.textContent = '✓ Done'; b.disabled = true; toast('“' + b.dataset.act + '” — a live build would execute this with your AMC / RTA.'); });
    return n;
  };

  /* =====================================================================
   * NOW answers
   * ===================================================================== */
  SCREENS['now-spendable'] = () => {
    const A = analyze(); const sp = A.dx.spendable, inv = A.dx.summary.invested;
    const haircut = sp.gross - sp.net;
    return el(`<section class="screen answer"><div class="wrap">
      ${topbar('now', 'NOW · TODAY')}
      ${guide(`Apps show a big number. This is what would actually <b>land in your bank</b> today.`)}
      <h2 class="atitle">How much is actually mine?</h2>
      <div class="bignum up">${INR(sp.net)}</div>
      <div class="subnum">reaches your bank · the app shows ${INR(sp.gross)}</div>
      <div class="flow">
        <div class="step"><span class="sl">Gross value</span><span class="sv">${INR(sp.gross)}</span></div>
        <div class="step minus"><span class="sl">− Exit load</span><span class="sv">${INR(sp.exitLoad)}</span></div>
        <div class="step minus"><span class="sl">− Tax</span><span class="sv">${INR(sp.totalTax)}</span></div>
        <div class="step net"><span class="sl">In hand</span><span class="sv up">${INR(sp.net)}</span></div>
      </div>
      <p class="means">You'd lose <b>${INR(haircut)}</b> to exit load and tax — that's <b>${pct(haircut / sp.gross, 1)}</b> of the screen value. The ₹1.25 L long-term gains exemption is already used for you.</p>
      ${maths(`
        <div class="row"><span>Invested</span><b>${INR(inv)}</b></div>
        <div class="row"><span>Gross value today</span><b>${INR(sp.gross)}</b></div>
        <div class="row"><span>Exit load</span><b>${INR(sp.exitLoad)}</b></div>
        <div class="row"><span>Short-term gains tax</span><b>${INR(sp.stcgTax)}</b></div>
        <div class="row"><span>Long-term gains tax (after ₹${(O.TAX.LTCG_EXEMPTION / 1e5).toFixed(2)}L exempt)</span><b>${INR(sp.ltcgTax)}</b></div>
        <div class="row"><span>Net in hand</span><b>${INR(sp.net)}</b></div>`)}
    </div></section>`);
  };

  SCREENS['now-funds'] = () => {
    const A = analyze();
    const funds = A.dx.funds.slice().sort((a, b) => b.current - a.current);
    const kyc = `<div class="action warn" style="margin:8px 0 18px"><div class="aico">🟡</div><div><div class="ah">SIP safety: Re-KYC due soon ${DEMO}</div><div class="ad">A pending KYC can freeze next month's SIP. Fixing it takes 2 minutes.</div><button class="cta sm" data-go="room-do">Fix it in the DO room →</button></div></div>`;
    const rows = funds.map((f) => {
      const sc = ADV.fundScore(f);
      const cls = sc.score >= 75 ? 'good' : sc.score >= 60 ? 'good' : sc.score >= 45 ? 'warn' : 'bad';
      const chip = `<span class="chip ${cls}">${sc.score}/100 ${sc.grade}</span>`;
      return `<button class="frow frow-tap" data-fund="${esc(f.scheme)}"><div style="text-align:left"><div class="fn">${esc(f.scheme)} ${chip}</div><div class="fm">${esc(f.amc || f.category)} · ${esc(f.plan)} · tap for full scorecard ›</div></div>
        <div class="fr"><b class="${f.xirr >= 0 ? 'up' : 'down'}">${pct(f.xirr)}</b>XIRR</div></button>`;
    }).join('');
    const mrows = funds.map((f) => f.risk ? `<div class="row"><span>${esc(f.scheme)}</span><b>α ${spct(f.risk.alpha, 1)} · β ${num(f.risk.beta, 2)} · Sharpe ${num(f.risk.sharpe, 2)}</b></div>` : `<div class="row"><span>${esc(f.scheme)}</span><b>no history</b></div>`).join('');
    const n = el(`<section class="screen answer"><div class="wrap">
      ${topbar('now', 'NOW · TODAY')}
      ${guide(`Your real, time-weighted return — and a plain flag if a fund isn't pulling its weight.`)}
      <h2 class="atitle">How are my funds &amp; SIPs doing?</h2>
      <div class="bignum grad">${pct(A.dx.portfolioXirr)}</div>
      <div class="subnum">your whole-portfolio XIRR (counts every SIP date)</div>
      ${kyc}
      ${rows}
      <p class="means">Tap any fund for the full story. A <b>🟢 healthy</b> fund is beating its benchmark for the risk it takes; a <b>🔴 lagging</b> one keeps falling behind — consider switching it. Your SIPs are all running.</p>
      ${maths(mrows + `<div class="row"><span>α=Alpha (skill) · β=Beta (swing) · Sharpe=reward per risk</span><b></b></div>`, 'Show the pro metrics ▾')}
    </div></section>`);
    n.querySelectorAll('.frow-tap').forEach((b) => b.onclick = () => go('fund-detail', { scheme: b.dataset.fund }));
    return n;
  };

  SCREENS['now-leak'] = () => {
    const A = analyze(); const lk = A.dx.leakage, ov = A.dx.overlaps || [];
    const ovHtml = ov.length ? ov.map((o) => `<div class="frow"><div class="fn">${esc(o.a)} ⇆ ${esc(o.b)}</div><div class="fr"><b class="${o.overlap >= 0.5 ? 'down' : 'gold'}">${pct(o.overlap, 0)}</b>same stocks</div></div>`).join('')
      : '<p class="micro">Good news — no two funds are secretly holding the same stocks.</p>';
    return el(`<section class="screen answer"><div class="wrap">
      ${topbar('now', 'NOW · TODAY')}
      ${guide(`Regular plans hide a commission inside the fee. Over 15 years it quietly adds up.`)}
      <h2 class="atitle">Am I leaking money in fees?</h2>
      <div class="bignum down">${INR(lk.leakageRupees)}</div>
      <div class="subnum">drained to commissions over 15 years · ${pct(lk.leakagePctOfDirect, 1)} of the Regular slice</div>
      <p class="means">Switching your Regular-plan funds to <b>Direct</b> (the exact same fund, lower fee) keeps this money in your corpus. Find it as a one-tap move in the <b>DO</b> room.</p>
      <h3 style="font-size:16px;margin:20px 0 6px">Are you paying twice for the same stocks?</h3>${ovHtml}
      ${maths(`<div class="row"><span>Regular-plan value today</span><b>${INR(lk.regularValueToday)}</b></div><div class="row"><span>Projected fee gap (15y, 12% gross)</span><b>${INR(lk.leakageRupees)}</b></div>`)}
    </div></section>`);
  };

  SCREENS['now-alloc'] = () => {
    const A = analyze(); const s = A.dx.summary;
    const alloc = Object.entries(s.allocation).sort((a, b) => b[1] - a[1]);
    const colors = { Equity: '#6ee7ff', Debt: '#8ea2ff', Hybrid: '#ffcf6b' };
    const donut = CH ? CH.donut(alloc.map(([k, v]) => ({ label: k, value: v, color: colors[k] || '#8fa2dd' })), { size: 168, stroke: 26, centerLabel: INR(s.current), centerSub: 'value' }) : '';
    const legend = alloc.map(([k, v]) => `<span><i style="background:${colors[k] || '#8fa2dd'}"></i>${esc(k)} ${pct(v, 0)}</span>`).join('');
    return el(`<section class="screen answer"><div class="wrap">
      ${topbar('now', 'NOW · TODAY')}
      ${guide(`A quick map of where your money actually sits.`)}
      <h2 class="atitle">What am I holding, and where?</h2>
      <div class="chartwrap" style="display:grid;place-items:center">${donut}</div>
      <div class="legend" style="justify-content:center">${legend}</div>
      <div class="tiles">
        <div class="tile"><span class="tl">Invested</span><b>${INR(s.invested)}</b></div>
        <div class="tile"><span class="tl">Value now</span><b>${INR(s.current)}</b></div>
        <div class="tile"><span class="tl">Profit/loss</span><b class="${s.pnl >= 0 ? 'up' : 'down'}">${spct(s.absoluteReturn)}</b></div>
        <div class="tile"><span class="tl">Direct vs Regular</span><b>${pct(s.planSplit.Direct, 0)} / ${pct(s.planSplit.Regular, 0)}</b></div>
      </div>
      <p class="means">More <b>equity</b> means more growth but bigger swings; <b>debt</b> steadies the ride. Whether this mix is right for you depends on how near your goal is — see the <b>NEXT</b> room.</p>
    </div></section>`);
  };

  /* =====================================================================
   * NEXT answers
   * ===================================================================== */
  SCREENS['next-freedom'] = () => {
    const n = el(`<section class="screen answer"><div class="wrap">
      ${topbar('next', 'NEXT · YOUR FUTURE')}
      ${guide(`“Financial freedom” = a pot big enough that its returns cover your living costs for life. Drag the sliders and watch your odds move.`)}
      <h2 class="atitle">When can I be financially free?</h2>
      <div class="bignum" id="fn-big">—</div>
      <div class="subnum" id="fn-sub"></div>
      <div class="chartwrap" id="fn-chart"></div>
      <div class="ctrl"><label>I’ll invest for <b id="fn-ylab"></b></label><input type="range" id="fn-y" min="3" max="35" step="1" value="${inputs.yearsToGoal}"></div>
      <div class="ctrl"><label>Monthly SIP <b id="fn-slab"></b></label><input type="range" id="fn-s" min="0" max="200000" step="2500" value="${inputs.monthlySip}"></div>
      <p class="means" id="fn-means"></p>
      <div id="fn-maths"></div>
    </div></section>`);
    const draw = () => {
      const mc = mcRun(900, 12);
      const prob = mc.probReachTarget || 0;
      const cls = prob >= 0.6 ? 'up' : prob >= 0.35 ? 'gold' : 'down';
      const big = n.querySelector('#fn-big'); big.className = 'bignum ' + cls; big.textContent = pct(prob, 0);
      n.querySelector('#fn-sub').textContent = `chance of reaching freedom in ${inputs.yearsToGoal} years`;
      n.querySelector('#fn-ylab').textContent = inputs.yearsToGoal + ' years';
      n.querySelector('#fn-slab').textContent = R0(inputs.monthlySip);
      const last = mc.bands[mc.bands.length - 1];
      n.querySelector('#fn-chart').innerHTML = CH ? CH.fan(mc.bands, { samples: mc.samples, baseline: mc.invested, height: 200 }) : '';
      n.querySelector('#fn-means').innerHTML = `Most likely you'll have <b>${INR(mc.median)}</b>. You'll need about <b>${INR(mc.target)}</b> (today's ${R0(inputs.currentMonthlyExpense)}/mo, grown by inflation). ${prob >= 0.6 ? 'You’re on a strong path. 🎯' : 'Raising your SIP or your horizon lifts the odds fast.'}`;
      n.querySelector('#fn-maths').innerHTML = maths(`
        <div class="row"><span>Pessimistic (1-in-10)</span><b>${INR(last.p10)}</b></div>
        <div class="row"><span>Most likely</span><b>${INR(mc.median)}</b></div>
        <div class="row"><span>Optimistic (1-in-10)</span><b>${INR(last.p90)}</b></div>
        <div class="row"><span>Freedom target (inflated)</span><b>${INR(mc.target)}</b></div>
        <div class="row"><span>Engine</span><b>${mc.paths.toLocaleString()} dynamic stochastic paths</b></div>`, 'Show the numbers ▾');
      n.querySelector('#fn-maths .maths-toggle').onclick = function () { const p = this.nextElementSibling, o = p.hasAttribute('hidden'); o ? p.removeAttribute('hidden') : p.setAttribute('hidden', ''); this.textContent = o ? 'Hide the numbers ▴' : 'Show the numbers ▾'; };
    };
    n.querySelector('#fn-y').addEventListener('input', (e) => { inputs.yearsToGoal = +e.target.value; n.querySelector('#fn-ylab').textContent = inputs.yearsToGoal + ' years'; });
    n.querySelector('#fn-y').addEventListener('change', draw);
    n.querySelector('#fn-s').addEventListener('input', (e) => { inputs.monthlySip = +e.target.value; n.querySelector('#fn-slab').textContent = R0(inputs.monthlySip); });
    n.querySelector('#fn-s').addEventListener('change', draw);
    setTimeout(draw, 0);
    return n;
  };

  /* NEXT — crash: the Two-Doors "feel it" moment, on YOUR money */
  SCREENS['next-crash'] = () => {
    const A = analyze();
    const gfc = A.pr.stress.find((s) => s.scenario.id === 'gfc2008') || A.pr.stress[0];
    const cur = A.dx.summary.current;
    const trough = gfc.troughValue, drop = gfc.drawdownPct, rec = gfc.scenario.recoveryMonths;
    const n = el(`<section class="screen answer"><div class="wrap">
      ${topbar('next', 'NEXT · YOUR FUTURE')}
      ${guide(`You can't dodge a crash — but you can decide who you'll be in one. Live it now, while it's calm.`)}
      <h2 class="atitle">What if the market crashes tomorrow?</h2>
      <p class="means">Today your portfolio is worth <b>${INR(cur)}</b>. Imagine a <b>2008-style crash</b> hits it tomorrow.</p>
      <button class="cta primary block" id="live">Live it →</button>
    </div></section>`);
    n.querySelector('#live').onclick = () => {
      const w = n.querySelector('.wrap');
      w.innerHTML = `${topbar('next', 'NEXT · YOUR FUTURE')}
        <div class="felt">
          <p class="subnum">The market cracks. Your money falls.</p>
          <div class="drop">${pct(drop, 0)}</div>
          <p class="frfrom">${INR(cur)} <span class="ar">▸</span> <b>${INR(trough)}</b></p>
          <p class="means" style="text-align:left">No headline tells you it recovers. It's just you and a red number. <b>What do you do?</b></p>
        </div>
        <div class="feel-choices">
          <button data-c="hold"><b>Hold — keep investing</b><span>buy through the fear, ride it back up</span></button>
          <button data-c="sell"><b>Sell — get to safety</b><span>stop the bleeding, sit in cash</span></button>
        </div>`;
      w.querySelector('.back').onclick = back;
      w.querySelectorAll('.feel-choices button').forEach((b) => b.onclick = () => showOutcome(w, b.dataset.c, cur, trough, drop, rec));
    };
    return n;
  };
  function showOutcome(w, choice, cur, trough, drop, rec) {
    // Hold: market regains its prior peak over `rec` months -> back to ~cur (the pre-crash level).
    // Sell at bottom: lock the loss, miss the rally -> stays near trough (modest cash growth).
    const held = cur; // recovers to the prior high (engine's stress convention)
    const sold = trough * 1.02; // small cash return, misses the rebound
    const win = choice === 'hold';
    const cost = held - sold;
    w.innerHTML = `${topbar('next', 'NEXT · YOUR FUTURE')}
      <h2 class="atitle">${win ? 'You held. 💪' : 'You sold. 😟'}</h2>
      <div class="bignum ${win ? 'up' : 'down'}">${INR(win ? held : sold)}</div>
      <div class="subnum">about ${rec} months later</div>
      <p class="means">${win
        ? `By staying in, your money rode the recovery back to roughly where it began — <b>${INR(held)}</b>. The crash became a dip in the story, not the end of it.`
        : `Selling at the bottom locked the loss at <b>${INR(trough)}</b>. Cash crept to <b>${INR(sold)}</b>, but you missed the rebound the holder caught — a gap of about <b>${INR(cost)}</b>.`}</p>
      <p class="means" style="border-color:var(--gold);background:rgba(255,207,107,.07)">The lesson Two Doors teaches: in a crash, <b>your nerve moves the outcome more than anything else.</b></p>
      <div class="feel-choices"><button id="again"><b>Try the other choice</b><span>see what the other you would get</span></button></div>`;
    w.querySelector('.back').onclick = back;
    w.querySelector('#again').onclick = () => showOutcome(w, win ? 'sell' : 'hold', cur, trough, drop, rec);
  }

  SCREENS['next-glide'] = () => {
    const plan = ADV.allocationPlan(portfolio, planOpts());
    const ef = plan.emergency, t = plan.target;
    const onTrack = plan.direction === 'on-track';
    const profChips = ['Conservative', 'Moderate', 'Aggressive'].map((p) =>
      `<button class="profchip${p === inputs.riskProfile ? ' on' : ''}" data-prof="${p}">${p}</button>`).join('');
    const n = el(`<section class="screen answer"><div class="wrap">
      ${topbar('next', 'NEXT · YOUR FUTURE')}
      ${guide(`Real planning has an order: <b>build an emergency fund first</b>, then choose an allocation that fits your risk — <b>never 100% equity</b>, so an emergency can't force you to sell at the worst time.`)}
      <h2 class="atitle">Is my money allocated safely?</h2>

      <div class="step-card ${ef.ok ? 'okstep' : 'warnstep'}">
        <div class="step-h"><span class="step-n">STEP 1</span> Emergency fund ${ef.ok ? '<span class="chip good">funded ✓</span>' : '<span class="chip bad">not yet</span>'}</div>
        <p class="means" style="margin:8px 0 0;border-color:${ef.ok ? 'var(--up)' : 'var(--down)'}">${ef.ok
          ? `You hold about <b>${INR(ef.have)}</b> in safe, liquid money — at least <b>${ef.months} months</b> of expenses. Good. Now we can invest the rest for growth.`
          : `You need about <b>${INR(ef.needed)}</b> (<b>${ef.months} months</b> of your ${R0(inputs.currentMonthlyExpense)} expenses) parked in a <b>liquid fund first</b>. You're short by <b>${INR(ef.gap)}</b>. <b>Build this before adding equity</b> — it's what protects you in a personal emergency.`}</p>
      </div>

      <div class="step-card">
        <div class="step-h"><span class="step-n">STEP 2</span> Your right allocation</div>
        <div class="profrow">${profChips}</div>
        <div class="subnum" style="margin-top:10px">RECOMMENDED (${inputs.riskProfile}, ${inputs.yearsToGoal}y goal)</div>
        ${tripleBar(t.equity, t.debt, t.gold)}
        <div class="subnum" style="margin-top:10px">YOUR MIX NOW</div>
        ${mixBar(plan.currentEquity)}
        <ul class="reasons">${t.reasoning.map((r) => `<li>${r}</li>`).join('')}</ul>
      </div>

      <p class="means">${plan.firstAction === 'build-emergency'
        ? `<b>First, build your emergency fund.</b> Allocation changes come after that safety net is in place.`
        : onTrack ? 'Your mix already matches a safe, suitable allocation — nothing to change. ✅'
          : `You're holding <b>${pct(plan.currentEquity, 0)}</b> equity vs a suitable <b>${pct(plan.targetEquity, 0)}</b>. Move about <b>${INR(plan.moveRupees)}</b> ${plan.direction === 'trim-equity' ? 'from equity into debt/gold' : 'into equity (gradually, via STP)'} — see the <b>DO</b> room.`}</p>
      <p class="micro">Educational, not advice. Caps are sensible planner defaults (aggressive tops out near 85% equity); your real adviser may tailor them.</p>
    </div></section>`);
    n.querySelectorAll('.profchip').forEach((b) => b.onclick = () => { inputs.riskProfile = b.dataset.prof; save(); render('fwd'); stack[stack.length - 1] = { id: 'next-glide' }; });
    return n;
  };
  function mixBar(eq) { return `<div class="mixbar"><span class="eq" style="width:${(eq * 100).toFixed(0)}%">${(eq * 100).toFixed(0)}% equity</span><span class="dt" style="width:${((1 - eq) * 100).toFixed(0)}%">${((1 - eq) * 100).toFixed(0)}% debt</span></div>`; }
  function tripleBar(eq, dt, gold) {
    return `<div class="mixbar"><span class="eq" style="width:${(eq * 100).toFixed(0)}%">${(eq * 100).toFixed(0)}% equity</span><span class="dt" style="width:${(dt * 100).toFixed(0)}%">${(dt * 100).toFixed(0)}% debt</span><span class="gd" style="width:${(gold * 100).toFixed(0)}%">${(gold * 100).toFixed(0)}% gold</span></div>`;
  }

  SCREENS['next-weather'] = () => {
    const A = analyze(); const v = A.pr.valuation;
    const reg = macroRegime();
    const col = v.zone === 'overvalued' ? 'var(--down)' : v.zone === 'undervalued' ? 'var(--up)' : 'var(--gold)';
    const n = el(`<section class="screen answer"><div class="wrap">
      ${topbar('next', 'NEXT · YOUR FUTURE')}
      ${guide(`Two readings: is the Indian market cheap or dear, and is the global weather calm or stormy.`)}
      <h2 class="atitle">Is now a good time?</h2>
      <div class="zone" style="border-color:${col}"><div class="zh" style="color:${col}">${esc(v.headline)}</div><div class="zr">${esc(v.rationale)}</div></div>
      <div class="ctrl"><label>Nifty PE (market richness) <b id="pe-lab">${inputs.niftyPE.toFixed(1)}</b></label><input type="range" id="pe" min="12" max="32" step="0.5" value="${inputs.niftyPE}"></div>
      <div class="zone" style="border-color:${reg.risk ? 'var(--down)' : 'var(--up)'}"><div class="zh ${reg.risk ? 'down' : 'up'}">Global weather: ${reg.label}</div><div class="zr">${reg.risk ? 'Tight money and costly oil — keep core holdings, steer fresh money toward safer funds for now.' : 'Conditions are constructive — keep investing on schedule.'} ${DEMO}</div></div>
      <p class="means">Expensive markets (PE&nbsp;&gt;&nbsp;25) reward booking a little profit; cheap ones (PE&nbsp;&lt;&nbsp;18) reward buying more. But for a long SIP, <b>staying invested beats timing</b> — this is a nudge, not a trigger.</p>
    </div></section>`);
    n.querySelector('#pe').addEventListener('input', (e) => { inputs.niftyPE = parseFloat(e.target.value); n.querySelector('#pe-lab').textContent = inputs.niftyPE.toFixed(1); });
    n.querySelector('#pe').addEventListener('change', () => { const c = cur(); render('fwd'); stack[stack.length - 1] = c; });
    return n;
  };
  function macroRegime() {
    const s = (inputs.fedRate > 4) + (inputs.crude > 85) + (inputs.niftyPE > 25) + (inputs.cpi > 6);
    return s >= 3 ? { label: 'Stormy', risk: true } : s >= 2 ? { label: 'Cloudy', risk: true } : { label: 'Clear', risk: false };
  }

  /* =====================================================================
   * DO sub-screens (rare moves)
   * ===================================================================== */
  SCREENS['do-tax'] = () => {
    const exemption = O.TAX.LTCG_EXEMPTION, rate = O.TAX.EQUITY_LTCG;
    const n = el(`<section class="screen answer"><div class="wrap">
      ${topbar('do', 'DO · YOUR MOVES')}
      ${guide(`Each financial year gives you a tax-free gains allowance. Spend the withdrawal across two years and you claim it twice.`)}
      <h2 class="atitle">Plan a tax-free exit ${DEMO}</h2>
      <div id="tx-body"></div>
      <div class="ctrl"><label>How much you'll withdraw <b id="g-lab">${INR(inputs.goalAmount)}</b></label><input type="range" id="g" min="500000" max="20000000" step="100000" value="${inputs.goalAmount}"></div>
      <p class="micro">Illustrative: assumes ~45% of the withdrawal is long-term gain, taxed @ ${pct(rate, 0)} above the ₹${(exemption / 1e5).toFixed(2)} L yearly exemption. A live build uses your real cost basis.</p>
    </div></section>`);
    const draw = () => {
      const gain = Math.max(0, inputs.goalAmount * 0.45);
      const one = Math.max(0, gain - exemption) * rate;
      const two = Math.max(0, gain - 2 * exemption) * rate;
      n.querySelector('#g-lab').textContent = INR(inputs.goalAmount);
      n.querySelector('#tx-body').innerHTML = `
        <div class="flow">
          <div class="step minus"><span class="sl">All in one year</span><span class="sv">${INR(one)}</span></div>
          <div class="step net"><span class="sl">Split over two years</span><span class="sv up">${INR(two)}</span></div>
        </div>
        <p class="means">You keep <b class="up">${INR(one - two)}</b> more, completely legally — take ~40% before March 31 and ~60% after April 1.</p>`;
    };
    n.querySelector('#g').addEventListener('input', (e) => { inputs.goalAmount = +e.target.value; draw(); });
    draw();
    return n;
  };

  SCREENS['do-dust'] = () => {
    const found = [['Old ELSS (closed email)', 18450], ['Fractional units — Liquid', 1260], ['Forgotten folio (old mobile)', 7320]];
    const total = found.reduce((s, f) => s + f[1], 0);
    const n = el(`<section class="screen answer"><div class="wrap">
      ${topbar('do', 'DO · YOUR MOVES')}
      ${guide(`We scan every folio linked to your PAN across CAMS & KFintech to find money you forgot you had.`)}
      <h2 class="atitle">Find forgotten money ${DEMO}</h2>
      <div class="bignum up">${INR(total)}</div>
      <div class="subnum">across ${found.length} old folios in your name</div>
      ${found.map((f) => `<div class="frow"><div class="fn">${esc(f[0])}</div><div class="fr"><b class="up">${INR(f[1])}</b></div></div>`).join('')}
      <button class="cta primary block" style="margin-top:16px" id="merge">Merge into my main portfolio</button>
    </div></section>`);
    n.querySelector('#merge').onclick = () => { n.querySelector('#merge').textContent = '✓ Merge requested'; n.querySelector('#merge').disabled = true; toast('A live build would consolidate these folios into your main portfolio.'); };
    return n;
  };

  /* =====================================================================
   * BUILD — assemble a real portfolio from live fund data (mfapi.in)
   * ===================================================================== */
  let bs = { results: null, picks: [], selected: null, status: '', q: '' };
  function dateYearsAgo(y) { const d = new Date(TODAY); d.setFullYear(d.getFullYear() - Math.round(y)); return d.toISOString().slice(0, 10); }
  function withTimeout(promise, ms) { return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
  // single-fetch with one retry + timeout (the free API is sometimes slow)
  async function robust(fn, ms = 11000) { try { return await withTimeout(fn(), ms); } catch (e) { return await withTimeout(fn(), ms); } }
  // quick standalone stats from a fund's NAV history (no benchmark needed)
  function quickStats(hist) {
    if (!hist || hist.length < 13) return null;
    const rets = O.periodReturns(hist);
    const yrs = (hist.length - 1) / 12;
    const cagr = Math.pow(hist[hist.length - 1] / hist[0], 1 / yrs) - 1;
    return { cagr, vol: O.annualizedVol(rets, 12), mdd: O.maxDrawdown(hist).maxDrawdown, sharpe: O.sharpe(rets, 0.065, 12), years: yrs };
  }
  const CATS = [['Flexi Cap', 'flexi cap'], ['Large Cap', 'large cap'], ['Mid Cap', 'mid cap'], ['Small Cap', 'small cap'], ['ELSS (tax)', 'elss'], ['Index', 'index fund'], ['Balanced', 'balanced advantage'], ['Liquid/Debt', 'liquid fund']];

  SCREENS.build = () => {
    const n = el(`<section class="screen"><div class="wrap">
      ${topbar('now', 'BUILD · REAL FUNDS')}
      <h2 class="roomtitle">Build your real portfolio</h2>
      <p class="roomguide">Browse a category or search by name. We pull each fund's <b>real NAV history</b> so every number is genuinely yours.</p>
      <div class="catrow">${CATS.map(([lab, q]) => `<button class="catchip" data-q="${q}">${lab}</button>`).join('')}</div>
      <div class="search"><input class="search-in" id="q" placeholder="…or search a name — e.g. Parag Parikh" autocomplete="off"><button class="cta sm" id="qbtn">Search</button></div>
      <div id="bmsg" class="bstatus"></div>
      <div id="picksec"></div>
      <div id="ressec"></div>
      <div id="bfoot"></div>
    </div></section>`);
    const $ = (s) => n.querySelector(s);
    const paint = () => {
      $('#picksec').innerHTML = bs.picks.length ? `<h3 style="font-size:15px;margin:16px 0 6px">Your funds (${bs.picks.length})</h3>` +
        bs.picks.map((h, i) => `<div class="frow"><div><div class="fn">${esc(h.scheme)}</div><div class="fm">${esc(h.amc)} · invested ${INR(h.invested)}</div></div><div class="fr"><button class="linkbtn" data-rm="${i}">remove</button></div></div>`).join('') : '';
      if (bs.selected) {
        const p = bs.selected; const st = quickStats(p.navHistory);
        const stats = st ? `<div class="tiles" style="margin:12px 0">
          <div class="tile"><span class="tl">Return p.a. (${st.years.toFixed(0)}y)</span><b class="${st.cagr >= 0 ? 'up' : 'down'}">${pct(st.cagr)}</b></div>
          <div class="tile"><span class="tl">Volatility</span><b>${pct(st.vol, 0)}</b></div>
          <div class="tile"><span class="tl">Sharpe</span><b>${num(st.sharpe, 2)}</b></div>
          <div class="tile"><span class="tl">Worst fall</span><b class="down">${pct(st.mdd, 0)}</b></div></div>
          <p class="micro">Computed live from this fund's real NAV history — so you choose informed, not blind.</p>` : '<p class="micro">Limited history for stats; you can still add it.</p>';
        $('#ressec').innerHTML = `<div class="addform"><div class="fn">${esc(p.scheme)}</div><div class="fm">${esc(p.amc)} · ${esc(p.category)} · NAV ${num(p.latestNav, 2)}</div>
          ${stats}
          <div class="ctrl"><label>How much have you invested?</label><input class="search-in" id="amt" type="number" min="1000" step="1000" placeholder="₹ amount" value="100000"></div>
          <div class="ctrl"><label>Roughly how long ago did you start? <b id="ya-lab">3 years</b></label><input type="range" id="ya" min="0" max="5" step="1" value="3"></div>
          <div class="search"><button class="cta sm primary" id="addf">Add this fund</button><button class="cta sm ghost" id="cancelf">Cancel</button></div></div>`;
        $('#ya').oninput = (e) => $('#ya-lab').textContent = (+e.target.value) + (e.target.value === '1' ? ' year' : ' years');
        $('#addf').onclick = () => {
          const amt = parseFloat($('#amt').value); if (!(amt > 0)) return toast('Enter how much you invested.');
          const ya = +$('#ya').value; const hist = p.navHistory;
          const mo = Math.min(hist.length - 1, Math.round(ya * 12)); const idx = hist.length - 1 - mo;
          const avgCost = hist[idx] || p.latestNav; const units = amt / avgCost; const pd = dateYearsAgo(ya);
          bs.picks.push({ scheme: p.scheme, amc: p.amc, category: p.category, assetClass: p.assetClass, plan: p.plan, ter: null,
            units, nav: p.latestNav, avgCost, invested: amt, purchaseDate: pd, transactions: [{ date: pd, amount: amt }], navHistory: hist, underlying: null, schemeCode: p.schemeCode });
          bs.selected = null; bs.results = null; toast('Added ' + p.scheme.slice(0, 40));
          paint();
        };
        $('#cancelf').onclick = () => { bs.selected = null; paint(); };
      } else if (bs.results) {
        // sort Direct + Growth first (the variants most people want)
        const sorted = bs.results.slice().sort((a, b) => score(b) - score(a));
        function score(r) { const s = r.schemeName.toLowerCase(); return (/direct/.test(s) ? 2 : 0) + (/growth/.test(s) ? 1 : 0) - (/idcw|dividend/.test(s) ? 1 : 0); }
        $('#ressec').innerHTML = sorted.length ? `<div class="reslist">` + sorted.slice(0, 20).map((r) =>
          `<button class="resitem" data-code="${r.schemeCode}">${esc(r.schemeName)}</button>`).join('') + '</div>' : `<p class="bstatus">No funds matched “${esc(bs.q)}”. Try a shorter name (e.g. just “Parag Parikh”) or a category above.</p>`;
        $('#ressec').querySelectorAll('.resitem').forEach((b) => b.onclick = async () => {
          b.textContent = 'Loading…'; b.disabled = true;
          try { bs.selected = await robust(() => DATA.fetchFund(b.dataset.code, 60)); paint(); }
          catch (e) { toast('Could not load that fund — the data server is slow. Try again.'); b.textContent = b.dataset.code; b.disabled = false; }
        });
      } else $('#ressec').innerHTML = '';
      $('#bfoot').innerHTML = bs.picks.length ? `<button class="cta primary block" id="analyze" style="margin-top:18px">Analyze my ${bs.picks.length} fund${bs.picks.length > 1 ? 's' : ''} →</button>` : '';
      n.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { bs.picks.splice(+b.dataset.rm, 1); paint(); });
      const az = $('#analyze'); if (az) az.onclick = analyzeReal;
      $('#bmsg').innerHTML = bs.status || '';
    };
    const doSearch = async (q) => {
      q = (q || $('#q').value).trim(); if (q.length < 3) return toast('Type at least 3 letters.');
      bs.q = q; bs.selected = null; bs.results = null;
      bs.status = '<span class="spin"></span> Searching live fund data… (can take a few seconds)'; paint();
      try { const r = await robust(() => DATA.searchFunds(q)); bs.results = r; bs.status = r.length ? `${r.length} funds found` : ''; }
      catch (e) { bs.results = null; bs.status = '⚠ Couldn\'t reach the fund server. Check your connection and retry — or use a demo / CSV from the start screen.'; }
      paint();
    };
    async function analyzeReal() {
      const az = $('#analyze'); if (az) { az.textContent = 'Crunching live data…'; az.disabled = true; }
      let benchmark;
      try {
        const r = await robust(() => DATA.searchFunds('nifty 50 index fund'));
        const pick = r.find((x) => /direct/i.test(x.schemeName) && /growth/i.test(x.schemeName)) || r[0];
        const bf = await robust(() => DATA.fetchFund(pick.schemeCode, 60)); benchmark = { name: bf.scheme, navHistory: bf.navHistory };
      } catch (e) { benchmark = O.samplePortfolio(TODAY).benchmark; }
      const holds = (portfolio && portfolio.holdings ? portfolio.holdings.slice() : []).concat(bs.picks);
      portfolio = { name: 'My Portfolio', asOf: TODAY, benchmark, holdings: holds };
      dataSource = 'real'; bs = { results: null, picks: [], selected: null, status: '', q: '' };
      home();
    }
    n.querySelectorAll('.catchip').forEach((c) => c.onclick = () => { $('#q').value = ''; doSearch(c.dataset.q); });
    $('#qbtn').onclick = () => doSearch();
    $('#q').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
    paint();
    return n;
  };

  /* =====================================================================
   * MY PLAN — edit goal/SIP/expense and manage holdings (remembers you)
   * ===================================================================== */
  SCREENS.plan = () => {
    const f = (id, label, val, step, min) => `<div class="ctrl"><label>${label}</label><input class="search-in" id="${id}" type="number" value="${val}" step="${step}" min="${min || 0}"></div>`;
    const holds = portfolio ? portfolio.holdings : [];
    const rows = holds.map((h, i) => `<div class="frow"><div><div class="fn">${esc(h.scheme)}</div><div class="fm">${esc(h.amc || h.category)} · ${INR(h.units * h.nav)}</div></div><div class="fr"><button class="linkbtn" data-rm="${i}">remove</button></div></div>`).join('');
    const n = el(`<section class="screen"><div class="wrap">
      ${topbar('now', 'MY PLAN')}
      <h2 class="roomtitle">My plan &amp; holdings</h2>
      <p class="roomguide">Set your real goal, risk comfort and safety buffer — every recommendation recalculates from these. Saved on your device.</p>
      <div class="ctrl"><label>My risk comfort</label><div class="profrow">${['Conservative', 'Moderate', 'Aggressive'].map((p) => `<button class="profchip${p === inputs.riskProfile ? ' on' : ''}" data-prof="${p}">${p}</button>`).join('')}</div><div class="micro" id="prof-desc" style="margin-top:6px">${esc(ADV.PROFILES[inputs.riskProfile].blurb)}</div></div>
      ${f('p-y', 'Years until my goal', inputs.yearsToGoal, 1, 1)}
      ${f('p-sip', 'Monthly SIP (₹)', inputs.monthlySip, 1000)}
      ${f('p-exp', 'Monthly expense today (₹)', inputs.currentMonthlyExpense, 1000)}
      ${f('p-liq', 'Safe/liquid savings I already have (₹)', inputs.liquidSavings, 5000)}
      ${f('p-step', 'Yearly SIP step-up (%)', Math.round(inputs.sipStepUp * 100), 1)}
      <button class="cta primary block" id="psave" style="margin-top:8px">Save my plan</button>
      <h3 style="font-size:16px;margin:24px 0 6px">Holdings ${holds.length ? '(' + holds.length + ')' : ''}</h3>
      ${rows || '<p class="micro">No holdings yet.</p>'}
      <button class="cta sm" id="addmore" style="margin-top:12px">＋ Add funds</button>
    </div></section>`);
    n.querySelectorAll('.profchip').forEach((b) => b.onclick = () => {
      inputs.riskProfile = b.dataset.prof;
      n.querySelectorAll('.profchip').forEach((x) => x.classList.toggle('on', x === b));
      n.querySelector('#prof-desc').textContent = ADV.PROFILES[inputs.riskProfile].blurb;
    });
    n.querySelector('#psave').onclick = () => {
      inputs.yearsToGoal = +n.querySelector('#p-y').value || inputs.yearsToGoal;
      inputs.monthlySip = +n.querySelector('#p-sip').value || 0;
      inputs.currentMonthlyExpense = +n.querySelector('#p-exp').value || 0;
      inputs.liquidSavings = +n.querySelector('#p-liq').value || 0;
      inputs.sipStepUp = (+n.querySelector('#p-step').value || 0) / 100;
      save(); toast('Plan saved.'); back();
    };
    n.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
      portfolio.holdings.splice(+b.dataset.rm, 1); save();
      if (!portfolio.holdings.length) { toast('All holdings removed.'); }
      render('fwd'); stack[stack.length - 1] = { id: 'plan' };
    });
    n.querySelector('#addmore').onclick = () => go('build');
    return n;
  };

  /* =====================================================================
   * FUND DETAIL — drill into one fund (deeper, still simple)
   * ===================================================================== */
  SCREENS['fund-detail'] = (params) => {
    const A = analyze();
    const f = A.dx.funds.find((x) => x.scheme === params.scheme) || A.dx.funds[0];
    const spark = (CH && f.navHistory && f.navHistory.length > 2) ? `<div class="chartwrap">${CH.line(f.navHistory, { height: 120, color: '#6ee7ff' })}</div>` : '';
    const r = f.risk;
    const gauges = r ? `<div class="tiles">
      <div class="tile"><span class="tl">Alpha (skill)</span><b class="${r.alpha >= 0 ? 'up' : 'down'}">${spct(r.alpha, 1)}</b></div>
      <div class="tile"><span class="tl">Beta (swing)</span><b>${num(r.beta, 2)}</b></div>
      <div class="tile"><span class="tl">Sharpe</span><b>${num(r.sharpe, 2)}</b></div>
      <div class="tile"><span class="tl">Worst fall</span><b class="down">${pct(r.maxDrawdown, 0)}</b></div></div>` : '<p class="micro">No NAV history for deeper risk stats on this fund.</p>';
    const r3 = f.rolling && f.rolling['3y'] && isFinite(f.rolling['3y'].avg) ? f.rolling['3y'] : null;
    const sc = ADV.fundScore(f);
    const scol = sc.score >= 60 ? 'var(--up)' : sc.score >= 45 ? 'var(--gold)' : 'var(--down)';
    const labels = { returns: 'Returns', riskAdj: 'Risk-adjusted', downside: 'Downside protection', consistency: 'Consistency', cost: 'Low cost', alpha: 'Alpha vs index' };
    const bars = Object.keys(labels).map((k) => {
      const v = Math.round(sc.breakdown[k]);
      return `<div class="scorebar"><span class="sbl">${labels[k]}</span><div class="sbtrack"><i style="width:${v}%;background:${v >= 60 ? 'var(--up)' : v >= 45 ? 'var(--gold)' : 'var(--down)'}"></i></div><span class="sbv">${v}</span></div>`;
    }).join('');
    const verdict = sc.score >= 60
      ? `Overall this is a <b>${sc.grade.toLowerCase()}</b> fund — it earns its place. ${sc.cautions.length ? 'Watch: ' + sc.cautions[0] + '.' : 'No red flags.'}`
      : `This fund scores <b>${sc.grade.toLowerCase()}</b> (${sc.score}/100). ${sc.cautions.length ? 'Concerns: ' + sc.cautions.join('; ') + '.' : ''} A higher-scoring peer (or its Direct plan) may serve you better — weigh it in the <b>DO</b> room.`;
    return el(`<section class="screen answer"><div class="wrap">
      ${topbar('now', 'NOW · ONE FUND')}
      ${guide(`A fund isn't one number. Here's the full scorecard — returns, risk, downside, consistency, cost and skill.`)}
      <h2 class="atitle">${esc(f.scheme)}</h2>
      <div class="subnum">${esc(f.amc || f.category)} · ${esc(f.plan)} plan · ${esc(f.assetClass)}</div>
      <div class="scorehead"><div class="scorering" style="--c:${scol}"><b>${sc.score}</b><small>/100</small></div><div><div class="scoregrade" style="color:${scol}">${sc.grade}</div><div class="micro" style="margin:0">weighted across 6 professional factors</div></div></div>
      <div class="scorebars">${bars}</div>
      ${spark}
      <div class="tiles">
        <div class="tile"><span class="tl">Value now</span><b>${INR(f.current)}</b></div>
        <div class="tile"><span class="tl">Total return</span><b class="${f.absoluteReturn >= 0 ? 'up' : 'down'}">${spct(f.absoluteReturn)}</b></div>
        <div class="tile"><span class="tl">XIRR</span><b class="${f.xirr >= 0 ? 'up' : 'down'}">${pct(f.xirr)}</b></div>
      </div>
      <p class="means">${verdict}</p>
      <h3 style="font-size:15px;margin:18px 0 6px">Risk &amp; consistency</h3>
      ${gauges}
      ${r3 ? `<p class="micro">Over rolling 3-year windows this fund returned <b>${pct(r3.avg)}</b> on average (worst ${pct(r3.min)}, best ${pct(r3.max)}), beating its hurdle <b>${pct(r3.consistency, 0)}</b> of the time.</p>` : ''}
    </div></section>`);
  };

  /* ---------------- toast ---------------- */
  let tT;
  function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; requestAnimationFrame(() => t.classList.add('show')); clearTimeout(tT); tT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.hidden = true, 300); }, 4200); }

  /* ---------------- boot ---------------- */
  if (loadSaved() && portfolio) stack = [{ id: 'home' }];
  render('fwd');
})();
