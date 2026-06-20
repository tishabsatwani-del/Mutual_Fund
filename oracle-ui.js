/* =====================================================================
 * Autonomous Portfolio Oracle — Part 1 dashboard (browser only)
 * Renders what oracle.js computes. No figure is produced here; this file
 * only formats and lays out the engine's diagnose() output.
 * ===================================================================== */
'use strict';
(function () {
  const O = window.ORACLE;
  if (!O) return;

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
  let portfolio = null; // { name, asOf, benchmark, holdings }
  const today = '2026-06-20';

  const dash = document.getElementById('dash');
  const empty = document.getElementById('empty');

  /* ---------- top-level render ---------- */
  function render() {
    if (!portfolio || !portfolio.holdings.length) {
      dash.hidden = true; empty.hidden = false; return;
    }
    empty.hidden = true; dash.hidden = false;
    const dx = O.diagnose(portfolio, { asOf: portfolio.asOf || today });
    dash.innerHTML = '';
    dash.appendChild(summaryCard(dx));
    dash.appendChild(spendableCard(dx));
    dash.appendChild(fundsCard(dx));
    if (dx.overlaps.length) dash.appendChild(overlapCard(dx));
    dash.appendChild(leakageCard(dx));
  }

  /* ---------- 1. Portfolio summary ---------- */
  function summaryCard(dx) {
    const s = dx.summary;
    const alloc = Object.entries(s.allocation).sort((a, b) => b[1] - a[1]);
    const colors = { Equity: 'var(--equity)', Debt: 'var(--debt)', Hybrid: 'var(--gold)' };
    const bar = alloc.map(([k, v]) => `<span class="seg" style="width:${(v * 100).toFixed(1)}%;background:${colors[k] || 'var(--cool)'}" title="${esc(k)} ${pct(v)}"></span>`).join('');
    const legend = alloc.map(([k, v]) => `<span class="lg"><i style="background:${colors[k] || 'var(--cool)'}"></i>${esc(k)} ${pct(v, 0)}</span>`).join('');
    const pnlClass = s.pnl >= 0 ? 'up' : 'down';
    return el(`<section class="card">
      <h2>Portfolio at a glance <span class="asof">as of ${esc(dx.asOf)}</span></h2>
      <div class="tiles">
        <div class="tile"><span class="tl">Invested</span><b>${INR(s.invested)}</b></div>
        <div class="tile"><span class="tl">Current value</span><b>${INR(s.current)}</b></div>
        <div class="tile"><span class="tl">Profit / loss</span><b class="${pnlClass}">${signPct(s.absoluteReturn)} · ${INR(s.pnl)}</b></div>
        <div class="tile"><span class="tl">Portfolio XIRR</span><b class="${dx.portfolioXirr >= 0 ? 'up' : 'down'}">${pct(dx.portfolioXirr)}</b></div>
      </div>
      <div class="allocbar">${bar}</div>
      <div class="legend">${legend}<span class="lg" style="margin-left:auto"><i style="background:var(--gold)"></i>Direct ${pct(s.planSplit.Direct, 0)} · Regular ${pct(s.planSplit.Regular, 0)}</span></div>
    </section>`);
  }

  /* ---------- 2. Spendable Wealth Counter ---------- */
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

  /* ---------- 3. Per-fund diagnostic table ---------- */
  function fundsCard(dx) {
    const rows = dx.funds.map((f) => {
      const r = f.risk;
      const roll3 = f.rolling && f.rolling['3y'] && f.rolling['3y'].count ? f.rolling['3y'] : null;
      const flag = f.deadwood ? `<span class="badge bad" title="Chronic underperformer: negative risk-adjusted alpha and below-benchmark return">DEADWOOD</span>` : '';
      return `<tr class="${f.deadwood ? 'rowbad' : ''}">
        <td class="fname"><b>${esc(f.scheme)}</b>${flag}<span class="fmeta">${esc(f.category)} · ${esc(f.plan)}${f.ter != null ? ' · TER ' + (f.ter * 100).toFixed(2) + '%' : ''}</span></td>
        <td>${INR(f.current)}</td>
        <td class="${f.absoluteReturn >= 0 ? 'up' : 'down'}">${signPct(f.absoluteReturn, 0)}</td>
        <td>${pct(f.cagr)}</td>
        <td>${pct(f.xirr)}</td>
        <td>${r ? num(r.beta) : '—'}</td>
        <td class="${r && r.alpha >= 0 ? 'up' : r ? 'down' : ''}">${r ? signPct(r.alpha) : '—'}</td>
        <td>${r ? num(r.sharpe) : '—'}</td>
        <td>${r && isFinite(r.downsideCapture) ? r.downsideCapture.toFixed(0) + '%' : '—'}</td>
        <td class="rollcell">${roll3 ? pct(roll3.avg, 1) + '<span class="rmm">' + pct(roll3.min, 0) + '…' + pct(roll3.max, 0) + '</span>' : '—'}</td>
      </tr>`;
    }).join('');
    return el(`<section class="card">
      <h2>Fund-by-fund X-ray</h2>
      <div class="tablewrap">
      <table class="ftable">
        <thead><tr>
          <th>Scheme</th><th>Value</th><th>Abs</th><th>CAGR</th><th>XIRR</th>
          <th title="Sensitivity to the benchmark">β</th>
          <th title="Jensen's alpha — annualised return above CAPM expectation">α</th>
          <th title="Excess return per unit of risk">Sharpe</th>
          <th title="Share of market falls the fund took — lower is safer">Down-cap</th>
          <th title="3-year rolling return: average (min…max across windows)">3y roll</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <p class="micro">β = market sensitivity · α = skill above the benchmark (annualised) · Sharpe = return per unit of risk · Down-capture = how much of the market’s falls the fund absorbed (e.g. 70% ⇒ it fell ~7% when the market fell ~10%) · 3y roll = average annualised return across every rolling 3-year window, with the worst…best in small text. Risk stats need a NAV history; manual entries without one show “—”.</p>
    </section>`);
  }

  /* ---------- 4. Overlap (Zoo of Schemes) ---------- */
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

  /* ---------- 5. Cost leakage (TER vs BER) ---------- */
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

  /* ---------- add-holding dialog ---------- */
  const dialog = document.getElementById('add-dialog');
  const addForm = document.getElementById('add-form');
  document.getElementById('btn-add').addEventListener('click', () => {
    if (!portfolio) portfolio = emptyPortfolio();
    dialog.showModal();
  });
  addForm.addEventListener('submit', (e) => {
    // Only the OK button commits; Cancel just closes.
    if (e.submitter && e.submitter.value === 'cancel') { addForm.reset(); return; }
    const fd = new FormData(addForm);
    const g = (k) => fd.get(k);
    const num_ = (k) => { const v = parseFloat(g(k)); return isNaN(v) ? null : v; };
    const units = num_('units'), nav = num_('nav'), avgCost = num_('avgCost');
    if (units == null || nav == null || avgCost == null) return;
    const invested = num_('invested');
    const ter = num_('ter');
    portfolio.holdings.push({
      scheme: g('scheme') || 'Unnamed fund', amc: g('amc') || '',
      category: g('category'), assetClass: /Debt/i.test(g('category')) ? 'Debt' : (/Hybrid/i.test(g('category')) ? 'Hybrid' : 'Equity'),
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

  /* ---------- toolbar ---------- */
  document.getElementById('btn-sample').addEventListener('click', () => { portfolio = O.samplePortfolio(today); render(); });
  document.getElementById('btn-clear').addEventListener('click', () => { portfolio = null; render(); });

  // Start on the sample so first-time visitors see the full diagnostic immediately.
  portfolio = O.samplePortfolio(today);
  render();
})();
