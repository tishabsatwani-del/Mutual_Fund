/* =====================================================================
 * Autonomous Portfolio Oracle — unified dashboard (browser only)
 * Renders the full workflow: Health Score -> Action Board -> Future plan
 * -> Current diagnostics. Every figure comes from the engines
 * (oracle.js / oracle-future.js / oracle-workflow.js); this file only
 * formats and lays out. No number is produced here.
 * ===================================================================== */
'use strict';
(function () {
  const O = window.ORACLE, F = window.FUTURE, W = window.WORKFLOW, IO = window.ORACLE_IO;
  const SIM = window.SIM, DATA = window.ORACLE_DATA, CH = window.ORACLE_CHARTS;
  if (!O || !F || !W || !IO) return;

  /* ---------- formatting helpers ---------- */
  const INR = (v) => {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' L';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  };
  const rupees0 = (v) => (isFinite(v) ? '₹' + Math.round(v).toLocaleString('en-IN') : '—');
  const pct = (v, d = 1) => (isFinite(v) ? (v * 100).toFixed(d) + '%' : '—');
  const signPct = (v, d = 1) => (isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%' : '—');
  const num = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : '—');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  /* ---------- app state ---------- */
  const today = '2026-06-20';
  let portfolio = null;
  const inputs = { yearsToGoal: 3, monthlySip: 30000, currentMonthlyExpense: 50000, niftyPE: 27, customEquityShock: -0.40 };

  const dash = document.getElementById('dash');
  const empty = document.getElementById('empty');
  const controls = document.getElementById('controls');

  /* ---------- top-level render ---------- */
  function render() {
    if (!portfolio || !portfolio.holdings.length) {
      dash.hidden = true; empty.hidden = false; controls.hidden = true; return;
    }
    empty.hidden = true; dash.hidden = false; controls.hidden = false;
    const A = W.analyze(portfolio, inputs);
    dash.innerHTML = '';
    dash.appendChild(healthCard(A.score, A.dx));
    dash.appendChild(actionCard(A.actions));
    dash.appendChild(sectionHead('The “Future” plan', 'Prognostic engine — Part 2'));
    dash.appendChild(ffnCard(A.pr.ffn));
    if (SIM) dash.appendChild(monteCarloCard(A.pr.ffn));
    dash.appendChild(glideCard(A.pr.glide));
    dash.appendChild(valuationCard(A.pr.valuation));
    dash.appendChild(stressCard(A.pr.stress));
    dash.appendChild(sectionHead('The “Current” diagnostic X-ray', 'Diagnostic engine — Part 1'));
    dash.appendChild(summaryCard(A.dx));
    dash.appendChild(spendableCard(A.dx));
    dash.appendChild(fundsCard(A.dx));
    if (A.dx.overlaps.length) dash.appendChild(overlapCard(A.dx));
    dash.appendChild(leakageCard(A.dx));
    wireActionButtons();
    wireRemoveButtons();
    saveState();
  }

  function wireRemoveButtons() {
    dash.querySelectorAll('.rm-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const i = +b.dataset.rm;
        const removed = portfolio.holdings[i];
        portfolio.holdings.splice(i, 1);
        toast(removed ? `Removed “${removed.scheme}”.` : 'Holding removed.');
        render();
      });
    });
  }

  function sectionHead(title, kicker) {
    return el(`<div class="sechead"><span class="seckick">${esc(kicker)}</span><h2>${esc(title)}</h2></div>`);
  }

  /* ===================================================================
   * PART 3 — Health Score + Action Board (the command center)
   * =================================================================== */
  function scoreColor(v) { return v >= 8 ? 'var(--up)' : v >= 6 ? 'var(--gold)' : v >= 4 ? '#f0a85a' : 'var(--down)'; }

  function healthCard(score, dx) {
    const pillars = [
      ['Performance', score.pillars.performance, 'Underperforming “deadwood” funds'],
      ['Cost', score.pillars.cost, 'High TER / Regular-plan drag'],
      ['Diversification', score.pillars.diversification, 'Scheme overlap & concentration'],
      ['Alignment', score.pillars.alignment, 'On track for the future FFN?'],
    ];
    const bars = pillars.map(([name, v, hint]) => `
      <div class="pillar">
        <div class="ptop"><span>${name}</span><b style="color:${scoreColor(v)}">${v.toFixed(1)}</b></div>
        <div class="pbar"><span style="width:${v * 10}%;background:${scoreColor(v)}"></span></div>
        <div class="phint">${esc(hint)}</div>
      </div>`).join('');
    const c = scoreColor(score.overall);
    const gaugeSvg = CH ? CH.gauge(score.overall, { color: c, size: 168 }) : `<div class="scorenum"><b style="color:${c}">${score.overall.toFixed(1)}</b><span>/ 10</span></div>`;
    return el(`<section class="card hero score-card">
      <div class="scorewrap">
        <div class="scoregauge">${gaugeSvg}</div>
        <div class="scoremeta">
          <p class="kick2">Unified Portfolio Health Score</p>
          <h2 style="color:${c}">${esc(score.grade)}</h2>
          <p class="lead">One number across four pillars — recomputed live from everything below. ${INR(dx.summary.current)} across ${dx.funds.length} funds, as of ${esc(dx.asOf)}.</p>
        </div>
      </div>
      <div class="pillars">${bars}</div>
    </section>`);
  }

  function actionCard(actions) {
    const sevLabel = { critical: 'Act now', warn: 'Review', opportunity: 'Opportunity', good: 'All clear' };
    const rows = actions.map((a, i) => `
      <div class="action ${a.severity}">
        <div class="acol">
          <span class="sev">${sevLabel[a.severity] || a.severity}</span>
          <div class="aissue">${esc(a.issue)}</div>
          <div class="aadvice">${esc(a.advice)}</div>
        </div>
        <button class="btn act-btn" data-i="${i}" data-label="${esc(a.button)}">${esc(a.button)}</button>
      </div>`).join('');
    return el(`<section class="card actionboard">
      <h2>Live Action Board <span class="asof">every issue → one decision</span></h2>
      <p class="lead">No jargon — just what to do next, ranked by urgency. Each button is the autonomous decision you’d execute (illustrative here; real execution would route to your AMC / broker).</p>
      <div class="actions">${rows}</div>
    </section>`);
  }

  function wireActionButtons() {
    dash.querySelectorAll('.act-btn').forEach((b) => {
      b.addEventListener('click', () => toast(`“${b.dataset.label}” — illustrative. In a connected build this routes the exact transaction to your AMC / broker (RTA), pre-filled.`));
    });
  }

  /* ===================================================================
   * PART 2 — Future cards
   * =================================================================== */
  function ffnCard(f) {
    const ratio = Math.max(0, Math.min(1.2, f.alignmentRatio));
    const onTrack = f.onTrack;
    return el(`<section class="card">
      <h2>Dynamic Financial Freedom Number <span class="asof">live, inflation-aware</span></h2>
      <p class="lead">Today’s ${rupees0(f.currentMonthlyExpense)}/mo becomes <b>${rupees0(f.futureMonthlyExpense)}/mo</b> in ${f.yearsToGoal} years at 6% inflation. To fund that for life you need:</p>
      <div class="tiles">
        <div class="tile"><span class="tl">FFN corpus needed</span><b>${INR(f.requiredCorpus)}</b></div>
        <div class="tile"><span class="tl">Projected at goal</span><b class="${onTrack ? 'up' : 'down'}">${INR(f.projectedCorpus)}</b></div>
        <div class="tile"><span class="tl">${onTrack ? 'Surplus' : 'Shortfall'}</span><b class="${onTrack ? 'up' : 'down'}">${INR(Math.abs(f.gap))}</b></div>
      </div>
      <div class="ffnbar"><span style="width:${ratio * 100}%;background:${onTrack ? 'var(--up)' : 'var(--gold)'}"></span><i style="left:83.333%">FFN</i></div>
      <p class="micro">${onTrack
        ? `On track — today’s ${rupees0(f.monthlySip)}/mo SIP reaches the goal with room to spare.`
        : `<b>Off track.</b> Increase your SIP by <b>${rupees0(f.sipTopUp)}/month</b> to close the gap. Corpus from current holdings: ${INR(f.fromCurrent)} · from future SIP: ${INR(f.fromSip)}.`}</p>
    </section>`);
  }

  function monteCarloCard(ffn) {
    const target = ffn.requiredCorpus;
    const mc = SIM.simulatePortfolio(portfolio, {
      years: inputs.yearsToGoal, monthlySip: inputs.monthlySip, target,
      paths: 2000, seed: 12345,
    });
    const fanSvg = CH ? CH.fan(mc.bands, { samples: mc.samples, baseline: mc.invested, height: 230 }) : '';
    const prob = mc.probReachTarget;
    const probColor = prob >= 0.7 ? 'var(--up)' : prob >= 0.4 ? 'var(--gold)' : 'var(--down)';
    return el(`<section class="card">
      <h2>Monte Carlo projection <span class="asof">${mc.paths.toLocaleString()} simulated futures · ${inputs.yearsToGoal}y</span></h2>
      <p class="lead">Not one guess — a whole cone of outcomes. Each path compounds your ${INR(mc.startValue)} + ${rupees0(inputs.monthlySip)}/mo at this portfolio’s own return (${pct(mc.params.annualReturn, 1)}) and volatility (${pct(mc.params.annualVol, 1)}), with fat-tailed shocks.</p>
      <div class="fanwrap">${fanSvg}</div>
      <div class="fanlegend"><span><i class="band b3"></i>middle 50%</span><span><i class="band b2"></i>80%</span><span><i class="band b1"></i>90%</span><span><i class="medianline"></i>median</span><span><i class="baseline"></i>invested</span></div>
      <div class="tiles">
        <div class="tile"><span class="tl">Pessimistic (p10)</span><b>${INR(mc.bands[mc.bands.length - 1].p10)}</b></div>
        <div class="tile"><span class="tl">Median (p50)</span><b>${INR(mc.median)}</b></div>
        <div class="tile"><span class="tl">Optimistic (p90)</span><b>${INR(mc.bands[mc.bands.length - 1].p90)}</b></div>
        <div class="tile"><span class="tl">Chance of hitting your FFN</span><b style="color:${probColor}">${pct(prob, 0)}</b></div>
      </div>
      <p class="micro">Probability of finishing below what you invested: <b>${pct(mc.probLoseMoney, 0)}</b>. Parameters estimated from ${mc.params.source === 'assumption' ? 'asset-class assumptions' : 'your funds’ own NAV history'}. Illustrative ranges of possibility, never a prediction.</p>
    </section>`);
  }

  function glideCard(g) {
    const onTrack = g.direction === 'on-track';
    const dirText = onTrack ? 'On the glide-path' : (g.direction === 'equity->debt' ? 'Too much equity for this horizon' : 'Room for more growth');
    return el(`<section class="card">
      <h2>Autonomous Glide-Path <span class="asof">${g.yearsToGoal} years to goal</span></h2>
      <p class="lead">As the goal nears, equity is dialled down so a last-minute crash can’t undo the plan.</p>
      <div class="glidegrid">
        <div class="gcol"><span class="tl">Your mix now</span>${mixBar(g.currentEquity)}</div>
        <div class="gcol"><span class="tl">Glide-path target</span>${mixBar(g.targetEquity)}</div>
      </div>
      <p class="micro ${onTrack ? '' : 'warnline'}">${onTrack
        ? 'Your equity/debt split matches the target — no move needed.'
        : `${dirText}. Move <b>${INR(g.rupeesToShift)}</b> ${g.direction === 'equity->debt' ? 'from equity into safe debt (a phased STP)' : 'from debt into equity'} to get back on path.`}</p>
    </section>`);
  }

  function mixBar(eq) {
    return `<div class="mixbar"><span class="eq" style="width:${eq * 100}%">${(eq * 100).toFixed(0)}% eq</span><span class="dt" style="width:${(1 - eq) * 100}%">${((1 - eq) * 100).toFixed(0)}% debt</span></div>`;
  }

  function valuationCard(v) {
    const tone = v.zone === 'overvalued' ? 'down' : v.zone === 'undervalued' ? 'up' : '';
    const zoneColor = v.zone === 'overvalued' ? 'var(--down)' : v.zone === 'undervalued' ? 'var(--up)' : 'var(--gold)';
    return el(`<section class="card">
      <h2>Valuation-Based Rebalancing <span class="asof">Nifty PE ${v.pe.toFixed(1)} (illustrative)</span></h2>
      <div class="valzone" style="border-color:${zoneColor}">
        <div class="valhead" style="color:${zoneColor}">${esc(v.headline)}</div>
        <p class="valrat">${esc(v.rationale)}</p>
        ${v.moveRupees > 0 ? `<div class="valmove ${tone}">Suggested move: <b>${INR(v.moveRupees)}</b> ${v.action === 'equity->debt' ? 'equity → debt' : 'debt → equity'}</div>` : '<div class="valmove">No valuation-driven move needed.</div>'}
      </div>
      <p class="micro">Drag the Nifty PE control above to see profit-booking (PE &gt; 25) and buy-the-dip (PE &lt; 18) triggers. A live build would feed real PE / PB / MarketCap-to-GDP.</p>
    </section>`);
  }

  function stressCard(stress) {
    const custom = F.customStress(portfolio, { equityShock: inputs.customEquityShock, name: 'Your custom crash' });
    const all = stress.concat([custom]);
    const rows = all.map((s) => {
      const sc = s.scenario;
      const flat = s.flatYears > 0;
      const isCustom = sc.id === 'custom';
      return `<div class="stressrow${isCustom ? ' custom' : ''}">
        <div class="sname"><b>${esc(sc.name)}</b><span>${esc(sc.blurb)}</span></div>
        <div class="sstat">
          <span class="sdd ${flat ? '' : 'down'}">${flat ? '0% (flat ' + s.flatYears + 'y)' : pct(s.drawdownPct, 0)}</span>
          <span class="sval">${flat ? 'patience test' : 'trough ' + INR(s.troughValue)}</span>
          <span class="srec">${flat ? '—' : (sc.recoveryMonths + ' mo to recover')}</span>
        </div>
      </div>`;
    }).join('');
    const barSvg = CH ? CH.bars(all.filter((s) => s.flatYears === 0).map((s) => ({
      label: s.scenario.name.replace(/\s*\(.*\)/, '').slice(0, 22),
      value: s.drawdownPct,
      color: s.scenario.id === 'custom' ? '#f0a85a' : '#ff7a7a',
      caption: pct(s.drawdownPct, 0) + ' · ' + INR(s.troughValue),
    })), { labelW: 150 }) : '';
    return el(`<section class="card">
      <h2>“What-If” Stress Tests <span class="asof">your portfolio in real history</span></h2>
      <p class="lead">What real crises would do to <b>your</b> current mix today — equity takes the hit, debt cushions, so the number is yours, not generic. The last bar is <b>your own</b> crash (set its depth with the “Custom crash” control above).</p>
      <div class="stressbars">${barSvg}</div>
      <div class="stresslist">${rows}</div>
      <p class="micro">Historical shock depths are illustrative, anchored to real index drawdowns and applied allocation-aware. Recovery times are historical, not predictions.</p>
    </section>`);
  }

  /* ===================================================================
   * PART 1 — Current diagnostic cards
   * =================================================================== */
  function summaryCard(dx) {
    const s = dx.summary;
    const alloc = Object.entries(s.allocation).sort((a, b) => b[1] - a[1]);
    const colors = { Equity: 'var(--equity)', Debt: 'var(--debt)', Hybrid: 'var(--gold)' };
    const bar = alloc.map(([k, v]) => `<span class="seg" style="width:${(v * 100).toFixed(1)}%;background:${colors[k] || 'var(--cool)'}" title="${esc(k)} ${pct(v)}"></span>`).join('');
    const legend = alloc.map(([k, v]) => `<span class="lg"><i style="background:${colors[k] || 'var(--cool)'}"></i>${esc(k)} ${pct(v, 0)}</span>`).join('');
    const pnlClass = s.pnl >= 0 ? 'up' : 'down';
    const donutSvg = CH ? CH.donut(alloc.map(([k, v]) => ({ label: k, value: v, color: colors[k] || '#8fa2dd' })), { size: 150, stroke: 24, centerLabel: INR(s.current), centerSub: 'value' }) : '';
    return el(`<section class="card">
      <h2>Portfolio at a glance <span class="asof">as of ${esc(dx.asOf)}</span></h2>
      <div class="summarygrid">
        <div class="donutwrap">${donutSvg}</div>
        <div class="tiles tiles-2">
          <div class="tile"><span class="tl">Invested</span><b>${INR(s.invested)}</b></div>
          <div class="tile"><span class="tl">Current value</span><b>${INR(s.current)}</b></div>
          <div class="tile"><span class="tl">Profit / loss</span><b class="${pnlClass}">${signPct(s.absoluteReturn)} · ${INR(s.pnl)}</b></div>
          <div class="tile"><span class="tl">Portfolio XIRR</span><b class="${dx.portfolioXirr >= 0 ? 'up' : 'down'}">${pct(dx.portfolioXirr)}</b></div>
        </div>
      </div>
      <div class="allocbar">${bar}</div>
      <div class="legend">${legend}<span class="lg" style="margin-left:auto"><i style="background:var(--gold)"></i>Direct ${pct(s.planSplit.Direct, 0)} · Regular ${pct(s.planSplit.Regular, 0)}</span></div>
    </section>`);
  }

  function spendableCard(dx) {
    const sp = dx.spendable;
    const haircut = sp.gross - sp.net;
    const rows = [
      ['Gross value if sold today', sp.gross, 'g'],
      ['− Exit load', -sp.exitLoad, 'r'],
      ['− Short-term capital-gains tax (20%)', -sp.stcgTax, 'r'],
      ['− Long-term capital-gains tax (12.5% over ₹1.25 L)', -sp.ltcgTax, 'r'],
      ['− Debt gains tax (slab)', -sp.debtTax, 'r'],
    ];
    const body = rows.map(([label, v, k]) =>
      `<div class="wrow"><span>${esc(label)}</span><b class="${k === 'r' && v !== 0 ? 'down' : ''}">${v === 0 ? rupees0(0) : (k === 'r' ? '−' + rupees0(Math.abs(v)) : rupees0(v))}</b></div>`
    ).join('');
    return el(`<section class="card hero">
      <h2>Spendable Wealth Counter <span class="asof">what actually reaches your bank</span></h2>
      <p class="lead">Apps show a fantasy number — it ignores exit load and tax. This is the real in-hand cash if you liquidated the whole portfolio today.</p>
      <div class="waterfall">${body}
        <div class="wrow total"><span>Net spendable cash</span><b class="up">${rupees0(sp.net)}</b></div>
      </div>
      <p class="micro">A <b>${pct(haircut / sp.gross)}</b> haircut (${INR(haircut)}) vanishes between the app’s number and your bank. ₹1.25 L LTCG exemption applied: ${rupees0(sp.ltcgExemptionUsed)} of long-term gains shielded.</p>
    </section>`);
  }

  function fundsCard(dx) {
    const rows = dx.funds.map((f, i) => {
      const r = f.risk;
      const roll3 = f.rolling && f.rolling['3y'] && f.rolling['3y'].count ? f.rolling['3y'] : null;
      const flag = f.deadwood ? `<span class="badge bad" title="Chronic underperformer: negative risk-adjusted alpha and below-benchmark return">DEADWOOD</span>` : '';
      const spark = (CH && f.navHistory && f.navHistory.length > 2) ? CH.line(f.navHistory, { width: 84, height: 24, color: f.deadwood ? '#ff7a7a' : '#3ee0a4' }) : '';
      return `<tr class="${f.deadwood ? 'rowbad' : ''}">
        <td class="fname"><b>${esc(f.scheme)}</b>${flag}<span class="fmeta">${esc(f.category)} · ${esc(f.plan)}${f.ter != null ? ' · TER ' + (f.ter * 100).toFixed(2) + '%' : ''}</span><span class="spark">${spark}</span></td>
        <td>${INR(f.current)}</td>
        <td class="${f.absoluteReturn >= 0 ? 'up' : 'down'}">${signPct(f.absoluteReturn, 0)}</td>
        <td>${pct(f.cagr)}</td>
        <td>${pct(f.xirr)}</td>
        <td>${r ? num(r.beta) : '—'}</td>
        <td class="${r && r.alpha >= 0 ? 'up' : r ? 'down' : ''}">${r ? signPct(r.alpha) : '—'}</td>
        <td>${r ? num(r.sharpe) : '—'}</td>
        <td>${r ? num(r.sortino) : '—'}</td>
        <td class="${r ? 'down' : ''}">${r && isFinite(r.maxDrawdown) ? pct(r.maxDrawdown, 0) : '—'}</td>
        <td>${r && isFinite(r.rSquared) ? num(r.rSquared, 2) : '—'}</td>
        <td>${r && isFinite(r.downsideCapture) ? r.downsideCapture.toFixed(0) + '%' : '—'}</td>
        <td class="rollcell">${roll3 ? pct(roll3.avg, 1) + '<span class="rmm">' + pct(roll3.min, 0) + '…' + pct(roll3.max, 0) + '</span>' : '—'}</td>
        <td><button class="rm-btn" data-rm="${i}" title="Remove this holding" aria-label="Remove ${esc(f.scheme)}">✕</button></td>
      </tr>`;
    }).join('');
    return el(`<section class="card">
      <h2>Fund-by-fund X-ray <span class="asof">tap ✕ to remove a holding</span></h2>
      <div class="tablewrap">
      <table class="ftable">
        <thead><tr>
          <th>Scheme</th><th>Value</th><th>Abs</th><th>CAGR</th><th>XIRR</th>
          <th title="Sensitivity to the benchmark">β</th>
          <th title="Jensen's alpha — annualised return above CAPM expectation">α</th>
          <th title="Excess return per unit of total risk">Sharpe</th>
          <th title="Excess return per unit of DOWNSIDE risk">Sortino</th>
          <th title="Worst peak-to-trough fall in the NAV history">Max DD</th>
          <th title="Share of the fund's moves explained by the benchmark (0–1)">R²</th>
          <th title="Share of market falls the fund took — lower is safer">Down-cap</th>
          <th title="3-year rolling return: average (min…max across windows)">3y roll</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <p class="micro">β = market sensitivity · α = skill above the benchmark · Sharpe = return per unit of total risk · Sortino = per unit of downside risk · Max DD = worst peak-to-trough fall · R² = how benchmark-like the fund is · Down-capture = how much of the market’s falls it absorbed · 3y roll = average annualised return across every rolling 3-year window (worst…best in small text). Risk stats need a NAV history; manual entries show “—”.</p>
    </section>`);
  }

  function overlapCard(dx) {
    const rows = dx.overlaps.map((o) => {
      const shared = o.shared.slice(0, 6).map((s) => esc(s.stock)).join(', ');
      return `<div class="ovrow ${o.flagged ? 'flag' : ''}">
        <div class="ovhead"><b>${(o.overlap * 100).toFixed(0)}%</b> overlap ${o.flagged ? '<span class="badge bad">RED FLAG</span>' : ''}</div>
        <div class="ovpair">${esc(o.a)} <span class="vs">↔</span> ${esc(o.b)}</div>
        <div class="ovbar"><span style="width:${Math.min(100, o.overlap * 100).toFixed(0)}%"></span></div>
        <div class="ovshared">Common holdings: ${shared}${o.shared.length > 6 ? ' …' : ''}</div>
      </div>`;
    }).join('');
    return el(`<section class="card">
      <h2>The “Zoo of Schemes” filter <span class="asof">overlap detector</span></h2>
      <p class="lead">Owning ten funds isn’t diversification if they hold the same stocks. Where two schemes share more than half their portfolio, you’re paying two fees for one bet.</p>
      ${rows}
    </section>`);
  }

  function leakageCard(dx) {
    const lk = dx.leakage;
    if (!(lk.regularValueToday > 0)) {
      return el(`<section class="card"><h2>Hidden cost leakage</h2><p class="lead">No Regular-plan holdings detected — you’re already avoiding distributor commissions. Nicely done.</p></section>`);
    }
    return el(`<section class="card">
      <h2>Hidden cost leakage <span class="asof">TER vs BER · Direct vs Regular</span></h2>
      <p class="lead">Your Regular-plan holdings (${INR(lk.regularValueToday)} today) carry a higher expense ratio. That small yearly drag silently compounds into a big slice of your future corpus handed to commissions.</p>
      <div class="leakgrid">
        <div class="tile"><span class="tl">If kept Direct (15y)</span><b class="up">${INR(lk.directCorpus)}</b></div>
        <div class="tile"><span class="tl">If kept Regular (15y)</span><b>${INR(lk.regularCorpus)}</b></div>
        <div class="tile big"><span class="tl">Leaked to commissions</span><b class="down">${INR(lk.leakageRupees)}</b><span class="sublabel">${pct(lk.leakagePctOfDirect)} of the corpus</span></div>
      </div>
      <p class="micro">Projected over 15 years at a 12% gross return, comparing a ${(lk.terGap * 100).toFixed(2)}-point TER gap. Switching these to Direct plans keeps that money in your corpus.</p>
    </section>`);
  }

  /* ===================================================================
   * Controls (future inputs) — persistent, not re-rendered, so typing
   * never loses focus; changing any value re-renders the dash.
   * =================================================================== */
  function buildControls() {
    controls.innerHTML = `
      <div class="ctrlrow">
        <label>Years to goal<input id="c-years" type="number" min="1" max="40" step="1" value="${inputs.yearsToGoal}"></label>
        <label>Monthly SIP (₹)<input id="c-sip" type="number" min="0" step="1000" value="${inputs.monthlySip}"></label>
        <label>Monthly expense today (₹)<input id="c-exp" type="number" min="0" step="1000" value="${inputs.currentMonthlyExpense}"></label>
        <label>Nifty PE (<b id="c-pe-val">${inputs.niftyPE}</b>)<input id="c-pe" type="range" min="12" max="32" step="0.5" value="${inputs.niftyPE}"></label>
        <label>Custom crash (<b id="c-crash-val">${Math.round(inputs.customEquityShock * 100)}%</b> equity)<input id="c-crash" type="range" min="-70" max="-5" step="5" value="${Math.round(inputs.customEquityShock * 100)}"></label>
      </div>`;
    const bind = (id, key, cast, after) => {
      const node = document.getElementById(id);
      node.addEventListener('input', () => {
        const v = cast(node.value);
        if (!isNaN(v)) { inputs[key] = v; if (after) after(v); render(); }
      });
    };
    bind('c-years', 'yearsToGoal', parseFloat);
    bind('c-sip', 'monthlySip', parseFloat);
    bind('c-exp', 'currentMonthlyExpense', parseFloat);
    bind('c-pe', 'niftyPE', parseFloat, (v) => { document.getElementById('c-pe-val').textContent = v; });
    bind('c-crash', 'customEquityShock', (s) => parseFloat(s) / 100, (v) => { document.getElementById('c-crash-val').textContent = Math.round(v * 100) + '%'; });
  }

  /* ---------- add-holding dialog ---------- */
  const dialog = document.getElementById('add-dialog');
  const addForm = document.getElementById('add-form');
  document.getElementById('btn-add').addEventListener('click', () => {
    if (!portfolio) portfolio = emptyPortfolio();
    dialog.showModal();
  });
  addForm.addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') { addForm.reset(); return; }
    const fd = new FormData(addForm);
    const g = (k) => fd.get(k);
    const n = (k) => { const v = parseFloat(g(k)); return isNaN(v) ? null : v; };
    const units = n('units'), nav = n('nav'), avgCost = n('avgCost');
    if (units == null || nav == null || avgCost == null) return;
    const invested = n('invested'), ter = n('ter');
    portfolio.holdings.push({
      scheme: g('scheme') || 'Unnamed fund', amc: g('amc') || '',
      category: g('category'),
      assetClass: /Debt/i.test(g('category')) ? 'Debt' : (/Hybrid/i.test(g('category')) ? 'Hybrid' : 'Equity'),
      plan: g('plan'), ter: ter != null ? ter / 100 : null,
      units, nav, avgCost,
      invested: invested != null ? invested : units * avgCost,
      purchaseDate: g('purchaseDate'),
      transactions: [{ date: g('purchaseDate'), amount: invested != null ? invested : units * avgCost }],
      navHistory: null, underlying: null,
    });
    addForm.reset();
    render();
  });

  function emptyPortfolio() {
    return { name: 'My Portfolio', asOf: today, benchmark: O.samplePortfolio(today).benchmark, holdings: [] };
  }

  /* ---------- real-fund search dialog (live data) ---------- */
  const rfDialog = document.getElementById('realfund-dialog');
  const rfForm = document.getElementById('realfund-form');
  let rfChosen = null; // parsed fund awaiting a position
  if (rfDialog && DATA) {
    document.getElementById('btn-realfund').addEventListener('click', () => {
      if (!portfolio) portfolio = emptyPortfolio();
      rfChosen = null;
      document.getElementById('rf-results').innerHTML = '';
      document.getElementById('rf-position').hidden = true;
      document.getElementById('rf-add').disabled = true;
      rfDialog.showModal();
    });
    const doSearch = async () => {
      const q = document.getElementById('rf-query').value.trim();
      const box = document.getElementById('rf-results');
      if (q.length < 3) { box.innerHTML = '<p class="rf-hint">Type at least 3 characters.</p>'; return; }
      box.innerHTML = '<p class="rf-hint">Searching live data…</p>';
      try {
        const list = await DATA.searchFunds(q);
        if (!list.length) { box.innerHTML = '<p class="rf-hint">No matches. Try a different name.</p>'; return; }
        box.innerHTML = list.slice(0, 12).map((x) =>
          `<button type="button" class="rf-item" data-code="${x.schemeCode}">${esc(x.schemeName)}</button>`).join('');
        box.querySelectorAll('.rf-item').forEach((b) => b.addEventListener('click', () => chooseFund(b.dataset.code, b.textContent)));
      } catch (e) {
        box.innerHTML = `<p class="rf-hint">Couldn’t reach live data (${esc(e.message)}). You can still add this fund manually via “+ Add a holding”.</p>`;
      }
    };
    document.getElementById('rf-go').addEventListener('click', doSearch);
    document.getElementById('rf-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

    async function chooseFund(code, name) {
      const box = document.getElementById('rf-results');
      box.innerHTML = `<p class="rf-hint">Loading NAV history for “${esc(name)}”…</p>`;
      try {
        rfChosen = await DATA.fetchFund(code);
        box.innerHTML = '';
        document.getElementById('rf-chosen').innerHTML = `<b>${esc(rfChosen.scheme)}</b><br><span class="rf-meta">${esc(rfChosen.category)} · live NAV ₹${rfChosen.latestNav} (${esc(rfChosen.latestDate)}) · ${rfChosen.navHistory.length} months of history</span>`;
        document.getElementById('rf-position').hidden = false;
        document.getElementById('rf-add').disabled = false;
      } catch (e) {
        box.innerHTML = `<p class="rf-hint">Couldn’t load that fund (${esc(e.message)}).</p>`;
      }
    }

    rfForm.addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') { rfForm.reset(); return; }
      if (!rfChosen) return;
      const val = (id) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };
      const holding = DATA.buildHolding(rfChosen, {
        units: val('rf-units'), invested: val('rf-invested'), avgCost: val('rf-avgcost'),
        purchaseDate: document.getElementById('rf-date').value || undefined,
      });
      portfolio.holdings.push(holding);
      toast(`Added “${holding.scheme}” with ${holding.navHistory.length} months of real NAV history.`);
      rfForm.reset(); rfChosen = null;
      render();
    });
  } else if (document.getElementById('btn-realfund')) {
    document.getElementById('btn-realfund').addEventListener('click', () => toast('Live fund data unavailable in this build.'));
  }

  /* ---------- print / report ---------- */
  const printBtn = document.getElementById('btn-print');
  if (printBtn) printBtn.addEventListener('click', () => { if (!portfolio || !portfolio.holdings.length) { toast('Load or add holdings first.'); return; } window.print(); });

  /* ---------- persistence (localStorage; never leaves the device) ---------- */
  const PKEY = 'oracle.portfolio.v1', IKEY = 'oracle.inputs.v1';
  function saveState() {
    try {
      if (portfolio && portfolio.holdings.length) localStorage.setItem(PKEY, IO.portfolioToJSON(portfolio));
      else localStorage.removeItem(PKEY);
      localStorage.setItem(IKEY, JSON.stringify(inputs));
      const note = document.getElementById('autosave-note');
      if (note) note.hidden = !(portfolio && portfolio.holdings.length);
    } catch (e) { /* storage unavailable (private mode) — run in-memory */ }
  }
  function loadState() {
    try {
      const ij = localStorage.getItem(IKEY);
      if (ij) Object.assign(inputs, JSON.parse(ij));
      const pj = localStorage.getItem(PKEY);
      if (pj) { const p = IO.parsePortfolioJSON(pj); if (!p.benchmark) p.benchmark = emptyPortfolio().benchmark; return p; }
    } catch (e) { /* ignore corrupt/blocked storage */ }
    return null;
  }

  /* ---------- file download helper ---------- */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  /* ---------- import / export ---------- */
  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      try {
        if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
          const p = IO.parsePortfolioJSON(text);
          if (!p.benchmark) p.benchmark = emptyPortfolio().benchmark;
          p.asOf = p.asOf || today;
          portfolio = p;
          toast(`Loaded portfolio “${p.name || 'imported'}” — ${p.holdings.length} holdings.`);
        } else {
          const { holdings, errors } = IO.parseHoldingsCSV(text);
          if (!holdings.length) { toast('Import failed: ' + (errors[0] || 'no valid rows found.')); return; }
          portfolio = emptyPortfolio();
          portfolio.holdings = holdings;
          toast(errors.length
            ? `Imported ${holdings.length} holdings; skipped ${errors.length} bad row(s): ${errors[0]}`
            : `Imported ${holdings.length} holdings from CSV.`);
        }
        render();
      } catch (e) {
        toast('Could not read that file: ' + e.message);
      }
      fileInput.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    if (!portfolio || !portfolio.holdings.length) { toast('Nothing to export — load or add holdings first.'); return; }
    download('portfolio.csv', IO.holdingsToCSV(portfolio.holdings), 'text/csv');
  });
  document.getElementById('btn-export-json').addEventListener('click', () => {
    if (!portfolio || !portfolio.holdings.length) { toast('Nothing to save — load or add holdings first.'); return; }
    download('portfolio.json', IO.portfolioToJSON(portfolio), 'application/json');
  });
  document.getElementById('btn-template').addEventListener('click', () => {
    download('portfolio-template.csv', IO.csvTemplate(), 'text/csv');
    toast('Downloaded a CSV template — fill it in and Import it back.');
  });

  /* ---------- toolbar + toast ---------- */
  document.getElementById('btn-sample').addEventListener('click', () => { portfolio = O.samplePortfolio(today); render(); });
  document.getElementById('btn-clear').addEventListener('click', () => { portfolio = null; saveState(); render(); });

  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = el('<div id="toast" class="toast"></div>'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }

  /* ---------- init ---------- */
  // Restore a saved portfolio if present; otherwise open on the sample so a
  // first-time visitor sees the full diagnostic immediately.
  const restored = loadState();
  portfolio = restored || O.samplePortfolio(today);
  buildControls();
  render();
})();
