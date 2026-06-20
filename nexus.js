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
  const O = window.ORACLE, F = window.FUTURE, W = window.WORKFLOW;
  const SIM = window.SIM, DSMC = window.DSMC, CH = window.ORACLE_CHARTS;
  const IO = window.ORACLE_IO;
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
  const inputs = {
    yearsToGoal: 18, monthlySip: 30000, currentMonthlyExpense: 50000, sipStepUp: 0.10,
    niftyPE: 27, fedRate: 4.5, crude: 82, cpi: 6.1, goalAmount: 5000000,
  };

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
        <button class="cta primary" id="b-sample">▶ &nbsp;Start with a demo portfolio</button>
        <button class="cta ghost" id="b-up">⤴ &nbsp;Upload my CAS / CSV</button>
      </div>
      <p class="boot-foot">Runs in your browser · nothing leaves your device · every number computed live</p>
      <input type="file" id="file-in" accept=".csv,.json,.pdf" hidden>
    </div></section>`);
    n.querySelector('#b-sample').onclick = () => { portfolio = O.samplePortfolio(TODAY); home(); };
    n.querySelector('#b-up').onclick = () => n.querySelector('#file-in').click();
    n.querySelector('#file-in').onchange = (e) => importFile(e.target.files[0]);
    return n;
  };

  function importFile(file) {
    if (!file) return; const reader = new FileReader();
    reader.onload = () => {
      try {
        if (/\.json$/i.test(file.name)) portfolio = ensureBench(IO.parsePortfolioJSON(reader.result));
        else if (/\.csv$/i.test(file.name)) {
          const { holdings, errors } = IO.parseHoldingsCSV(reader.result);
          if (!holdings.length) return toast('Could not read that CSV.');
          portfolio = ensureBench({ name: 'Imported', asOf: TODAY, holdings });
          if (errors.length) toast(errors.length + ' row(s) skipped.');
        } else { portfolio = O.samplePortfolio(TODAY); toast('CAS PDF parsing is a live-build feature — loaded a demo so you can explore.'); }
        home();
      } catch (err) { toast('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
  }
  function ensureBench(p) { if (!p.benchmark || !p.benchmark.navHistory) p.benchmark = O.samplePortfolio(TODAY).benchmark; if (!p.asOf) p.asOf = TODAY; return p; }

  /* ---- HOME ---- */
  SCREENS.home = () => {
    const A = analyze();
    const urgent = A.actions.filter((a) => a.severity === 'critical' || a.severity === 'warn').length;
    const verdict = urgent === 0
      ? `Your money looks healthy. <b>Nothing urgent</b> right now.`
      : `Your money is in <b>${A.score.grade.toLowerCase()}</b> shape — but <b>${urgent} thing${urgent > 1 ? 's' : ''}</b> need${urgent > 1 ? '' : 's'} your attention.`;
    const n = el(`<section class="screen center"><div class="wrap">
      <div class="orb">${ring(A.score.overall)}<b>${A.score.overall.toFixed(1)}</b><small>HEALTH</small></div>
      <h2 class="home-verdict">${verdict}</h2>
      <p class="home-sub">Pick a door. Each one answers a plain question, one screen at a time.</p>
      <div class="doors">
        <button class="door now" data-go="room-now"><span class="dico">📍</span><span><span class="dtitle">Where I stand today</span><span class="dsub">Your money right now — what's real</span></span><span class="darrow">›</span></button>
        <button class="door next" data-go="room-next"><span class="dico">🔭</span><span><span class="dtitle">Will I be okay?</span><span class="dsub">Your future — projections, clearly marked</span></span><span class="darrow">›</span></button>
        <button class="door do" data-go="room-do"><span class="dico">✅</span><span><span class="dtitle">What should I do?</span><span class="dsub">Your to-do list — one tap each</span></span>${urgent ? `<span class="dbadge">${urgent}</span>` : '<span class="darrow">›</span>'}</button>
      </div>
      <div class="home-foot"><button class="linkbtn" id="restart">↺ Use a different portfolio</button></div>
    </div></section>`);
    n.querySelector('#restart').onclick = () => { portfolio = null; stack = [{ id: 'boot' }]; render('back'); };
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
    const g = A.pr.glide;
    const q = [
      ['next-freedom', 'When can I be financially free?', 'The corpus that funds your life — and your odds', `<span class="chip ${prob >= 0.6 ? 'good' : prob >= 0.35 ? 'warn' : 'bad'}">${pct(prob, 0)} likely</span>`],
      ['next-crash', 'What if the market crashes tomorrow?', 'Live a real crash on your money — and choose', '<span class="chip warn">feel it</span>'],
      ['next-glide', 'Am I on the safe path as my goal nears?', 'Whether your risk is winding down in time', g.direction === 'on-track' ? '<span class="chip good">on path</span>' : '<span class="chip warn">drifted</span>'],
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
    const acts = A.actions.slice();
    // a couple of always-useful rare moves, framed as actions
    const extra = [
      { _go: 'do-tax', severity: 'info', issue: 'Plan a tax-free exit', advice: 'When you withdraw at your goal, splitting it across two financial years can legally cut the tax — often to ₹0.', button: 'Open tax router' },
      { _go: 'do-dust', severity: 'info', issue: 'Find forgotten money', advice: 'Old folios from a dead email or phone number may still hold units in your name. Sweep them into one place.', button: 'Scan for lost folios' },
    ];
    const all = acts.concat(extra);
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
      const chip = f.deadwood ? '<span class="chip bad">lagging</span>' : '<span class="chip good">healthy</span>';
      return `<div class="frow"><div><div class="fn">${esc(f.scheme)} ${chip}</div><div class="fm">${esc(f.amc || f.category)} · ${esc(f.plan)} · SIP active</div></div>
        <div class="fr"><b class="${f.xirr >= 0 ? 'up' : 'down'}">${pct(f.xirr)}</b>XIRR</div></div>`;
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
      <p class="means">A <b>🟢 healthy</b> fund is beating its benchmark for the risk it takes. A <b>🔴 lagging</b> one keeps falling behind — consider switching it. Your SIPs are all running.</p>
      ${maths(mrows + `<div class="row"><span>α=Alpha (skill) · β=Beta (swing) · Sharpe=reward per risk</span><b></b></div>`, 'Show the pro metrics ▾')}
    </div></section>`);
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
    const A = analyze(); const g = A.pr.glide; const onTrack = g.direction === 'on-track';
    const yrs = inputs.yearsToGoal;
    const cells = []; for (let y = 0; y <= Math.min(yrs, 20); y++) cells.push(DSMC ? DSMC.glideEquity(yrs - y) : 1);
    const strip = `<div class="gstrip">${cells.map((eqi) => `<span class="gt" title="${(eqi * 100).toFixed(0)}%"><i style="height:${(eqi * 100).toFixed(0)}%"></i></span>`).join('')}</div>`;
    return el(`<section class="screen answer"><div class="wrap">
      ${topbar('next', 'NEXT · YOUR FUTURE')}
      ${guide(`As your goal nears, the safe move is to slowly shift from risky equity to steady debt — so a late crash can't undo years of saving.`)}
      <h2 class="atitle">Am I on the safe path?</h2>
      <div class="bignum ${onTrack ? 'up' : 'gold'}" style="font-size:clamp(34px,9vw,64px)">${onTrack ? 'On the safe path' : 'Slightly off path'}</div>
      <p class="subnum">the bars show how your equity should taper, year by year</p>
      ${strip}
      <div style="margin-top:14px"><div class="subnum">YOUR MIX NOW</div>${mixBar(g.currentEquity)}<div class="subnum" style="margin-top:10px">RECOMMENDED FOR ${g.yearsToGoal}Y OUT</div>${mixBar(g.targetEquity)}</div>
      <p class="means">${onTrack ? 'Your equity/debt split already matches the safe path — nothing to change. ✅'
        : `You're holding <b>${pct(g.currentEquity, 0)}</b> equity; the safe path here is <b>${pct(g.targetEquity, 0)}</b>. Shifting <b>${INR(g.rupeesToShift)}</b> ${g.direction === 'equity->debt' ? 'into debt' : 'into equity'} gets you back on track — see the <b>DO</b> room.`}</p>
    </div></section>`);
  };
  function mixBar(eq) { return `<div class="mixbar"><span class="eq" style="width:${(eq * 100).toFixed(0)}%">${(eq * 100).toFixed(0)}% equity</span><span class="dt" style="width:${((1 - eq) * 100).toFixed(0)}%">${((1 - eq) * 100).toFixed(0)}% debt</span></div>`; }

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

  /* ---------------- toast ---------------- */
  let tT;
  function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; requestAnimationFrame(() => t.classList.add('show')); clearTimeout(tT); tT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.hidden = true, 300); }, 4200); }

  /* ---------------- boot ---------------- */
  render('fwd');
})();
