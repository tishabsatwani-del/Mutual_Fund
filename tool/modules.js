/* The Portfolio Reality Check — the four modules.
 *
 * Every result follows the same shape: the number, what it means, what it does
 * not mean, and what to look at next. A number on its own is what ordinary
 * calculators already give people.
 */
(function () {
  'use strict';
  var A = window.PRCApp, E = window.PRCEngine, P = window.PRCParse;
  var $ = A.$, $$ = A.$$, esc = A.esc, money = A.money, moneyLong = A.moneyLong;
  var pct = A.pct, notice = A.notice, fmtDate = A.fmtDate;

  /* ============================================================== PORTFOLIO */

  var KINDS = ['Investment', 'Withdrawal', 'Value today'];
  var rowSeq = 0;

  function addRow(values) {
    var v = values || {};
    var id = 'r' + (rowSeq++);
    var wrap = A.el('div', { class: 'entry', 'data-row': id });
    wrap.innerHTML =
      '<div class="c-date"><label class="sr-only" for="' + id + 'd">Date</label>' +
        '<input type="date" id="' + id + 'd" class="in-date" value="' + esc(v.date || '') + '"></div>' +
      '<div class="c-kind"><label class="sr-only" for="' + id + 'k">What happened</label>' +
        '<select id="' + id + 'k" class="in-kind">' +
        KINDS.map(function (k) {
          return '<option' + (v.kind === k ? ' selected' : '') + '>' + k + '</option>';
        }).join('') + '</select></div>' +
      '<div class="c-amt"><label class="sr-only" for="' + id + 'a">Amount in rupees</label>' +
        '<input type="number" id="' + id + 'a" class="in-amt" inputmode="decimal" min="0" step="1" ' +
        'placeholder="Amount" value="' + (v.amount != null ? esc(v.amount) : '') + '"></div>' +
      '<div class="c-tag"><label class="sr-only" for="' + id + 't">Which fund or goal</label>' +
        '<input type="text" id="' + id + 't" class="in-tag" autocomplete="off" ' +
        'placeholder="Which fund?" value="' + esc(v.label || '') + '"></div>' +
      '<button type="button" class="del" aria-label="Remove this row">&times;</button>';
    wrap.querySelector('.del').addEventListener('click', function () { wrap.remove(); });
    $('#pf-rows').appendChild(wrap);
    return wrap;
  }

  function readRows() {
    return $$('#pf-rows .entry').map(function (r) {
      return {
        date: r.querySelector('.in-date').value,
        kind: r.querySelector('.in-kind').value,
        amount: parseFloat(r.querySelector('.in-amt').value),
        label: (r.querySelector('.in-tag').value || '').trim()
      };
    });
  }

  function calcPortfolio() {
    var rows = readRows();
    var out = $('#pf-out');
    var flows = [], problems = [], invested = 0, withdrawn = 0, current = 0, currentDate = null;

    rows.forEach(function (r, i) {
      var blank = !r.date && !isFinite(r.amount);
      if (blank) return;
      var t = A.isoToTs(r.date);
      if (isNaN(t)) { problems.push('Row ' + (i + 1) + ' has no date.'); return; }
      if (!isFinite(r.amount) || r.amount <= 0) {
        problems.push('Row ' + (i + 1) + ' needs an amount greater than zero, typed as a plain positive number.');
        return;
      }
      var signed = r.kind === 'Investment' ? -r.amount : r.amount;
      if (r.kind === 'Investment') invested += r.amount;
      else if (r.kind === 'Withdrawal') withdrawn += r.amount;
      else { current += r.amount; currentDate = currentDate == null ? t : Math.max(currentDate, t); }
      flows.push({ t: t, amount: signed, kind: r.kind, label: r.label });
    });

    if (problems.length) {
      out.innerHTML = notice('bad', problems.slice(0, 4).map(esc).join('<br>'));
      return;
    }
    var res = E.xirr(flows);
    if (!res.ok) {
      var extra = res.code === 'NO_VALUE'
        ? ' Add a last row with today\'s date, <strong>Value today</strong>, and what the holding is worth now.'
        : '';
      out.innerHTML = notice('bad', esc(res.message) + extra);
      return;
    }

    var rate = res.rate;
    var net = current + withdrawn - invested;
    var abs = invested > 0 ? net / invested : 0;
    var first = flows.reduce(function (m, f) { return Math.min(m, f.t); }, Infinity);
    var last = flows.reduce(function (m, f) { return Math.max(m, f.t); }, -Infinity);
    var years = (last - first) / (365.2425 * 86400000);

    var html = '';
    html += '<div class="result"><div class="label">Your portfolio XIRR</div>' +
      '<div class="value">' + pct(rate) + '</div>' +
      '<div class="sub">Across ' + years.toFixed(1) + ' years, from ' + fmtDate(first) + ' to ' + fmtDate(last) + '</div></div>';

    html += '<div class="card"><h2>The numbers behind it</h2><div class="stats">' +
      stat('You put in', money(invested)) +
      stat('You took out', money(withdrawn)) +
      stat('Worth now', money(current)) +
      stat('Gain or loss', (net >= 0 ? '+' : '') + money(net)) +
      '</div>' +
      '<table class="data"><tbody>' +
      trow('Absolute return', A.signedPct(abs) + ' in total, not per year') +
      trow('XIRR', pct(rate) + ' a year, counting when each rupee moved') +
      trow('Period', years.toFixed(1) + ' years') +
      '</tbody></table>';

    html += '<div class="meaning"><h3>What this means</h3>' +
      '<p>Your money grew at about <strong>' + pct(rate) + ' a year</strong>, taking into account the date ' +
      'every rupee went in and came out. Money you invested early had longer to work than money you ' +
      'invested last month, and this number already accounts for that.</p>' +
      '<p>Your total gain of ' + esc(A.signedPct(abs)) + ' is <em>not</em> a yearly figure. Spread across ' +
      years.toFixed(1) + ' years, it works out at the ' + pct(rate) + ' above.</p>' +
      '</div>';

    html += '<div class="meaning"><h3>What it does not mean</h3>' +
      '<p>This is not the fund\'s return. A fund can publish a strong number while your own is weaker, ' +
      'simply because of when you happened to invest. The fund\'s figure describes the fund. This one ' +
      'describes you.</p>' +
      '<p>It is before exit load and before tax, so what you finally keep will be a little less.</p></div>';

    html += '<div class="meaning"><h3>What to look at next</h3>' +
      '<p>A return means little without a period and a comparison. Use <button class="link" data-go="history">' +
      'Understand market history</button> to see the range this kind of market has actually delivered over ' +
      'the same length of time, and <button class="link" data-go="goal">Plan my goal</button> to see whether ' +
      'this rate gets you where you are going.</p></div>';

    html += '</div>';

    if ($('#pf-group').value === 'on') html += byLabel(flows, rate);
    out.innerHTML = html;
  }

  function byLabel(flows, portfolioRate) {
    var groups = {};
    flows.forEach(function (f) {
      var k = f.label || 'Not named';
      (groups[k] = groups[k] || []).push(f);
    });
    var keys = Object.keys(groups);
    if (keys.length < 2) {
      return '<div class="card">' + notice('', 'To compare holdings, name each row in the ' +
        '<strong>Which fund?</strong> box — one name per fund or goal. Rows sharing a name are ' +
        'measured together.') + '</div>';
    }
    var rows = keys.map(function (k) {
      var r = E.xirr(groups[k]);
      var put = groups[k].reduce(function (t, f) { return t + (f.amount < 0 ? -f.amount : 0); }, 0);
      return '<tr><td>' + esc(k) + '</td><td>' + money(put) + '</td><td>' +
        (r.ok ? pct(r.rate) : 'not enough entries') + '</td></tr>';
    }).join('');
    var total = flows.reduce(function (t, f) { return t + (f.amount < 0 ? -f.amount : 0); }, 0);
    rows += '<tr style="border-top:2px solid var(--line-strong)"><td><strong>Your whole portfolio</strong></td>' +
      '<td><strong>' + money(total) + '</strong></td><td><strong>' + pct(portfolioRate) + '</strong></td></tr>';
    return '<div class="card"><h2>Each holding, and the whole</h2>' +
      '<div class="scroll"><table class="data"><thead><tr><th>Holding</th><th>You put in</th>' +
      '<th>Its own XIRR</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="meaning"><h3>Why these differ from your portfolio number</h3>' +
      '<p>Each line above is the return of that holding on its own. Your portfolio number weighs them by ' +
      'how much money you actually had in each, and when. A brilliant return on a small, late investment ' +
      'moves your total far less than a mediocre one on a large, early holding.</p></div></div>';
  }

  function stat(k, v) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }
  function trow(k, v) { return '<tr><td>' + esc(k) + '</td><td>' + esc(v) + '</td></tr>'; }

  function addSip() {
    var start = window.prompt('First instalment date (YYYY-MM-DD)', A.isoToday().slice(0, 8) + '01');
    if (!start) return;
    var t0 = A.isoToTs(start);
    if (isNaN(t0)) { window.alert('That date could not be read. Use the form 2024-01-01.'); return; }
    var amount = parseFloat(window.prompt('Monthly amount in rupees', '10000'));
    if (!isFinite(amount) || amount <= 0) { window.alert('Enter the amount as a plain positive number.'); return; }
    var count = parseInt(window.prompt('How many instalments?', '12'), 10);
    if (!isFinite(count) || count < 1 || count > 480) { window.alert('Enter between 1 and 480 instalments.'); return; }
    for (var i = 0; i < count; i++) {
      var t = E.addMonths(t0, i);
      addRow({ date: new Date(t).toISOString().slice(0, 10), kind: 'Investment', amount: amount });
    }
  }

  function fillExample() {
    $('#pf-rows').innerHTML = '';
    addRow({ date: '2021-04-01', kind: 'Investment', amount: 200000 });
    addRow({ date: '2022-04-01', kind: 'Investment', amount: 150000 });
    addRow({ date: '2024-04-01', kind: 'Withdrawal', amount: 100000 });
    addRow({ date: A.isoToday(), kind: 'Value today', amount: 420000 });
  }

  function exportRows() {
    var lines = ['Date,What happened,Amount'];
    readRows().forEach(function (r) {
      if (r.date || isFinite(r.amount)) lines.push([r.date, r.kind, isFinite(r.amount) ? r.amount : ''].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'my-investments.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* =================================================================== GOAL */

  function calcGoal() {
    var input = {
      currentValue: parseFloat($('#g-current').value),
      monthlySip: parseFloat($('#g-sip').value),
      years: parseFloat($('#g-years').value),
      annualRate: parseFloat($('#g-rate').value) / 100,
      annualStepUpRate: parseFloat($('#g-step').value) / 100,
      target: parseFloat($('#g-target').value)
    };
    var out = $('#g-out');
    var plan = E.projectGoal(input);
    if (!plan.ok) { out.innerHTML = notice('bad', esc(plan.message)); return; }

    var name = $('#g-name').value.trim() || 'this goal';
    var html = '';

    html += '<div class="result"><div class="label">If nothing changes, you reach</div>' +
      '<div class="value">' + money(plan.projected) + '</div>' +
      '<div class="sub">' + (A.scale(plan.projected) ? 'About ₹' + A.scale(plan.projected) + '. ' : '') +
      'Goal: ' + money(plan.target) + '</div></div>';

    if (plan.onTrack) {
      html += notice('ok', '<strong>On track.</strong> On the return you assumed, ' + esc(name) +
        ' is covered with ' + esc(money(-plan.gap)) + ' to spare.');
    } else {
      html += notice('bad', '<strong>Short by ' + esc(money(plan.gap)) + '.</strong> On the return you ' +
        'assumed, ' + esc(name) + ' is not covered by what you are doing now.');
    }

    html += '<div class="card">' + A.goalChart(plan) + '</div>';

    html += '<div class="card"><h2>What it would take</h2>';
    if (plan.onTrack) {
      html += '<p style="margin:0 0 .8rem">Nothing more is required on these assumptions. The scenarios below ' +
        'show what happens if you do more anyway.</p>';
    } else {
      html += '<div class="result" style="margin:0 0 1rem"><div class="label">Additional monthly investment needed</div>' +
        '<div class="value small">' + money(plan.extraMonthly) + ' a month</div>' +
        '<div class="sub">On top of the ' + money(input.monthlySip) + ' a month you already invest</div></div>';
    }

    var scenarios = [
      { name: 'Carry on exactly as you are', extra: 0, step: input.annualStepUpRate },
      { name: 'Add ₹2,000 a month', extra: 2000, step: input.annualStepUpRate },
      { name: 'Add ₹5,000 a month', extra: 5000, step: input.annualStepUpRate },
      { name: 'Same amount, raised 10% every year', extra: 0, step: Math.max(0.10, input.annualStepUpRate) }
    ];
    html += '<div class="scroll"><table class="data"><thead><tr><th>Scenario</th><th>You reach</th><th>Against goal</th></tr></thead><tbody>';
    scenarios.forEach(function (s) {
      var p = E.projectGoal({
        currentValue: input.currentValue, monthlySip: input.monthlySip + s.extra,
        years: input.years, annualRate: input.annualRate, annualStepUpRate: s.step, target: input.target
      });
      if (!p.ok) return;
      var diff = p.projected - input.target;
      html += '<tr><td>' + esc(s.name) + '</td><td>' + money(p.projected) + '</td><td>' +
        (diff >= 0 ? 'covered, +' + money(diff) : 'short by ' + money(-diff)) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<p class="hint" style="margin-top:.6rem">Every row uses the same assumed return of ' +
      pct(input.annualRate) + ' a year.</p></div>';

    html += '<div class="meaning"><h3>What this means</h3>' +
      '<p>Of the ' + money(plan.projected) + ' above, ' + money(plan.fromCorpus) + ' comes from what you ' +
      'already hold and ' + money(plan.fromSip) + ' from what you keep adding. Over ' + plan.years.toFixed(1) +
      ' years you would pay in ' + money(plan.totalContributed) + ' of your own money.</p>' +
      '<p>Notice how much the scenarios differ from each other. That difference is the point of this screen: ' +
      'small, steady changes compound into large ones, and they are almost always easier to control than ' +
      'the return.</p></div>';

    html += '<div class="meaning"><h3>What it does not mean</h3>' +
      '<p>The ' + pct(input.annualRate) + ' is an assumption you typed in, not a rate anyone can promise. ' +
      'Real markets do not deliver the same return every year, and a run of poor years early on hurts more ' +
      'than the same years late. Treat this as an illustration of arithmetic, not a forecast.</p>' +
      '<p>Inflation is not deducted. A goal set in today\'s rupees will cost more by the time it arrives.</p></div>';

    out.innerHTML = html;
  }

  /* ================================================ ROLLING RETURN RENDERER */

  var RATE_DATA = {};

  function renderRolling(series, years, meta, compareSeries, compareName, prefix) {
    var r = E.rollingReturns(series, years);
    if (!r.ok) return notice('bad', esc(r.message));
    var s = r.stats;
    var key = prefix || 'x';
    RATE_DATA[key] = r.values;
    var html = '';

    html += '<div class="result"><div class="label">' + esc(meta.name) + ' &middot; every ' + years +
      '-year period in this data</div>' +
      '<div class="value">' + pct(s.median) + '</div>' +
      '<div class="sub">Median annual return across ' + s.count.toLocaleString() + ' overlapping periods, ' +
      fmtDate(series[0].t) + ' to ' + fmtDate(series[series.length - 1].t) + '</div></div>';

    html += '<div class="card"><h2>The range, not the average</h2><div class="stats">' +
      stat('Worst', pct(s.min)) + stat('Median', pct(s.median)) +
      stat('Average', pct(s.mean)) + stat('Best', pct(s.max)) +
      '</div><div class="stats">' +
      stat('Made money', pct(s.positiveShare, 0) + ' of periods') +
      stat('Lost money', pct(s.negativeShare, 0) + ' of periods') +
      stat('Lower quarter', 'below ' + pct(s.p25)) +
      stat('Upper quarter', 'above ' + pct(s.p75)) +
      '</div>' + A.histogramChart(r.values, {
        years: years,
        caption: 'Each bar counts the ' + years + '-year periods that ended in that range'
      }) + '</div>';

    html += rateCheckCard(key, years, r.values);

    if (compareSeries) {
      var c = E.rollingReturns(compareSeries, years);
      if (c.ok) {
        html += '<div class="card"><h2>Against ' + esc(compareName) + '</h2><div class="scroll">' +
          '<table class="data"><thead><tr><th>Over ' + years + ' years</th><th>' + esc(meta.name) +
          '</th><th>' + esc(compareName) + '</th></tr></thead><tbody>' +
          cmp('Worst period', s.min, c.stats.min) +
          cmp('Median period', s.median, c.stats.median) +
          cmp('Best period', s.max, c.stats.max) +
          '<tr><td>Periods measured</td><td>' + s.count.toLocaleString() + '</td><td>' +
          c.stats.count.toLocaleString() + '</td></tr>' +
          '</tbody></table></div>' +
          '<div class="meaning"><h3>Read this carefully</h3>' +
          '<p>The two series may not cover identical dates, and a benchmark carries no costs while a fund ' +
          'carries expenses, cash holdings and portfolio decisions. A benchmark comparison is a reference ' +
          'point, not a complete evaluation of a fund.</p></div></div>';
      } else {
        html += '<div class="card">' + notice('', 'The comparison series does not cover a ' + years +
          '-year period, so no side-by-side is shown.') + '</div>';
      }
    }

    html += '<div class="meaning"><h3>What this means</h3>' +
      '<p>Someone who invested at the worst possible moment in this data and held for ' + years +
      ' years earned <strong>' + pct(s.min) + ' a year</strong>. Someone who started at the best moment ' +
      'earned <strong>' + pct(s.max) + '</strong>. Same market, same holding period — the only difference ' +
      'was the day they started.</p>' +
      '<p>' + pct(s.positiveShare, 0) + ' of these ' + years + '-year periods made money and ' +
      pct(s.negativeShare, 0) + ' lost money.</p></div>';

    html += '<div class="meaning"><h3>What it does not mean</h3>' +
      '<p>This is what already happened, over the dates in this file and no others. It is not a forecast, ' +
      'not a promise, and not a claim that the next ' + years + ' years will land inside this range.</p>' +
      '<p>Periods overlap, so they are not independent samples. And the median is not a typical experience ' +
      'anyone actually had — it is the middle of many possible starting days.</p></div>';

    html += '<details class="explain"><summary>See the numbers as a table</summary><div class="body"><div class="scroll">' +
      '<table class="data"><thead><tr><th>Return range</th><th>Periods</th><th>Share</th></tr></thead><tbody>' +
      E.histogram(r.values).map(function (b) {
        return '<tr><td>' + esc(binText(b)) + '</td><td>' + b.count + '</td><td>' +
          pct(b.count / r.values.length, 0) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p style="margin-top:.7rem">Windows are matched on calendar dates, with up to seven days of ' +
      'tolerance when a market was shut. Periods falling inside a longer gap in the data are left out ' +
      'rather than stretched.</p></div></details>';

    return html;
  }

  /* The reader names the rate. The screen reports arithmetic on the data above
   * and nothing else -- no product, no promise, no comparison anybody has to
   * take on trust. */
  function rateCheckCard(key, years, values) {
    var start = 0.07;
    var res = E.shareAbove(values, start);
    return '<div class="card"><h2>How often did it beat a rate you choose?</h2>' +
      '<div class="field" style="max-width:16rem">' +
      '<label for="rate-' + key + '">Rate to compare against, % a year</label>' +
      '<input type="number" id="rate-' + key + '" class="ratecheck" data-key="' + key +
      '" data-years="' + years + '" value="7" step="0.5" min="-50" max="100" inputmode="decimal">' +
      '</div>' +
      '<div class="result" style="margin:.6rem 0 0"><div class="label">Periods that beat it</div>' +
      '<div class="value" id="rateout-' + key + '">' + pct(res.share, 0) + '</div>' +
      '<div class="sub" id="ratesub-' + key + '">' + rateSentence(res, start, years) + '</div></div>' +
      '<div class="meaning"><h3>Read this carefully</h3>' +
      '<p>You chose that rate, so this is arithmetic on the data above and nothing more. It is not a ' +
      'comparison with any particular product, and it says nothing about what a deposit, a bond or any ' +
      'other investment actually paid over these dates.</p>' +
      '<p>The figures are before tax and before costs, on both sides of the comparison. Periods overlap, ' +
      'and none of this is a statement about what comes next.</p></div></div>';
  }

  function rateSentence(res, rate, years) {
    if (!res.ok) return '';
    return res.above.toLocaleString() + ' of ' + res.count.toLocaleString() + ' ' + years +
      '-year periods returned more than ' + pct(rate, 1) + ' a year.';
  }

  function cmp(label, a, b) {
    return '<tr><td>' + esc(label) + '</td><td>' + pct(a) + '</td><td>' + pct(b) + '</td></tr>';
  }
  function binText(b) {
    if (b.from === -Infinity) return 'Worse than ' + pct(b.to, 0) + ' a year';
    if (b.to === Infinity) return 'Above ' + pct(b.from, 0) + ' a year';
    return pct(b.from, 0) + ' to ' + pct(b.to, 0) + ' a year';
  }

  /* ================================================================ HISTORY */

  var state = { bmSeries: null, bmName: '', bmYears: 5, fundSeries: null, fundName: '', fundYears: 5, bundled: {} };

  function horizonChips(containerId, current, onPick) {
    var box = $('#' + containerId);
    box.innerHTML = '';
    A.HORIZONS.forEach(function (h) {
      var b = A.el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(h === current)
      });
      b.textContent = h + (h === 1 ? ' year' : ' years');
      b.addEventListener('click', function () { onPick(h); });
      box.appendChild(b);
    });
  }

  function drawHistory() {
    if (!state.bmSeries) return;
    $('#h-controls').hidden = false;
    horizonChips('h-horizons', state.bmYears, function (h) { state.bmYears = h; drawHistory(); });
    $('#h-out').innerHTML = renderRolling(state.bmSeries, state.bmYears, { name: state.bmName },
      null, '', 'market');
  }

  function loadBenchmarks() {
    var box = $('#bm-list');
    fetch('data/benchmarks.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var list = (data && data.benchmarks) || [];
        if (!list.length) {
          box.innerHTML = notice('', '<strong>No market data is bundled with this version.</strong> ' +
            'Nothing has been invented to fill the gap: an index series that was guessed at would produce ' +
            'confident numbers about a market that never existed. Load an official index file below and ' +
            'every measurement on this screen works exactly the same way.');
          return;
        }
        $('#asof').textContent = data.asOf ? 'through ' + esc(data.asOf) : 'included';
        box.innerHTML = '';
        list.forEach(function (b) {
          var btn = A.el('button', { class: 'tile', type: 'button' });
          btn.innerHTML = '<h2>' + esc(b.name) + '</h2><p>' + esc(b.note || '') + '</p>';
          btn.addEventListener('click', function () {
            state.bmSeries = b.series.map(function (p) { return { t: A.isoToTs(p[0]), v: p[1] }; })
              .filter(function (p) { return !isNaN(p.t) && p.v > 0; })
              .sort(function (x, y) { return x.t - y.t; });
            state.bmName = b.name;
            state.bundled[b.name] = state.bmSeries;
            refreshCompareOptions();
            drawHistory();
          });
          box.appendChild(btn);
        });
      });
  }

  /* =================================================================== FUND */

  function drawFund() {
    if (!state.fundSeries) return;
    $('#f-controls').hidden = false;
    horizonChips('f-horizons', state.fundYears, function (h) { state.fundYears = h; drawFund(); });
    var sel = $('#f-compare');
    var chosen = sel.value;
    var compare = null, compareName = '';
    if (chosen && chosen !== 'none') {
      compare = chosen === '__loaded__' ? state.bmSeries : state.bundled[chosen];
      compareName = chosen === '__loaded__' ? state.bmName : chosen;
    }
    $('#f-out').innerHTML =
      importReport(state.fundReport, state.fundName) +
      renderRolling(state.fundSeries, state.fundYears, { name: state.fundName }, compare, compareName, 'fund');
  }

  function refreshCompareOptions() {
    var sel = $('#f-compare');
    if (!sel) return;
    var names = Object.keys(state.bundled);
    var opts = ['<option value="none">Nothing — just my fund</option>'];
    names.forEach(function (n) { opts.push('<option value="' + esc(n) + '">' + esc(n) + '</option>'); });
    if (state.bmSeries && names.indexOf(state.bmName) === -1) {
      opts.push('<option value="__loaded__">' + esc(state.bmName) + ' (the file you loaded)</option>');
    }
    sel.innerHTML = opts.join('');
    $('#f-compare-wrap').hidden = opts.length < 2;
  }

  function importReport(rep, name) {
    if (!rep) return '';
    var skipped = rep.skipped.badDate + rep.skipped.badValue + rep.skipped.duplicate;
    var html = '<div class="card"><h2>What was read from your file</h2><div class="stats">' +
      stat('Rows in file', rep.rowsRead.toLocaleString()) +
      stat('Rows used', rep.used.toLocaleString()) +
      stat('First date', fmtDate(rep.firstDate)) +
      stat('Last date', fmtDate(rep.lastDate)) +
      '</div>';
    html += '<p style="margin:.2rem 0 0;color:var(--ink-2);font-size:.93rem">' +
      esc(name) + ' covers about ' + rep.spanYears.toFixed(1) + ' years.</p>';
    if (skipped) {
      html += '<p style="margin:.6rem 0 0;color:var(--ink-2);font-size:.93rem">' + skipped +
        ' row' + (skipped === 1 ? ' was' : 's were') + ' left out: ' +
        [rep.skipped.badDate + ' with a date that could not be read',
         rep.skipped.badValue + ' with a missing, zero or negative value',
         rep.skipped.duplicate + ' repeating a date already seen'].join(', ') + '.</p>';
      if (rep.examples.length) {
        html += '<details class="explain"><summary>Show me which rows</summary><div class="body"><ul style="margin:0;padding-left:1.1rem">' +
          rep.examples.map(function (x) {
            return '<li>Line ' + x.line + ': "' + esc(x.value) + '" — ' + esc(x.why) + '</li>';
          }).join('') + '</ul></div></details>';
      }
    }
    (rep.warnings || []).forEach(function (w) { html += notice('bad', esc(w)); });
    return html + '</div>';
  }

  /* =================================================================== INIT */

  function wireRateChecks() {
    document.addEventListener('input', function (ev) {
      var input = ev.target;
      if (!input.classList || !input.classList.contains('ratecheck')) return;
      var key = input.dataset.key, years = input.dataset.years;
      var values = RATE_DATA[key];
      var rate = parseFloat(input.value) / 100;
      var out = document.getElementById('rateout-' + key);
      var sub = document.getElementById('ratesub-' + key);
      if (!out || !values) return;
      var res = E.shareAbove(values, rate);
      if (!res.ok) { out.textContent = '—'; sub.textContent = 'Enter a rate.'; return; }
      out.textContent = pct(res.share, 0);
      sub.textContent = rateSentence(res, rate, years);
    });
  }

  function init() {
    A.initRouter();
    wireRateChecks();
    $('#ver').textContent = A.VERSION;

    /* portfolio */
    for (var i = 0; i < 3; i++) addRow({});
    addRow({ date: A.isoToday(), kind: 'Value today' });
    $('#pf-add').addEventListener('click', function () { addRow({}); });
    $('#pf-sip').addEventListener('click', addSip);
    $('#pf-demo').addEventListener('click', fillExample);
    $('#pf-clear').addEventListener('click', function () {
      $('#pf-rows').innerHTML = ''; $('#pf-out').innerHTML = '';
      for (var k = 0; k < 3; k++) addRow({});
      addRow({ date: A.isoToday(), kind: 'Value today' });
    });
    $('#pf-group').addEventListener('change', function () {
      $('#pf-rows').classList.toggle('tagged', this.value === 'on');
    });
    $('#pf-calc').addEventListener('click', calcPortfolio);
    $('#pf-export').addEventListener('click', exportRows);

    /* goal */
    $('#g-calc').addEventListener('click', calcGoal);

    /* history */
    loadBenchmarks();
    A.wireDrop('bm-drop', 'bm-file', 'bm-pick', function (file) {
      A.readFile(file, function (res) {
        state.bmSeries = res.series;
        state.bmName = file.name.replace(/\.[^.]+$/, '');
        state.bmReport = res.report;
        refreshCompareOptions();
        drawHistory();
      }, function (msg) { $('#h-out').innerHTML = notice('bad', esc(msg)); });
    });

    /* fund */
    A.wireDrop('f-drop', 'f-file', 'f-pick', function (file) {
      A.readFile(file, function (res) {
        state.fundSeries = res.series;
        state.fundReport = res.report;
        state.fundName = file.name.replace(/\.[^.]+$/, '');
        refreshCompareOptions();
        drawFund();
      }, function (msg) { $('#f-out').innerHTML = notice('bad', esc(msg)); });
    });
    $('#f-compare').addEventListener('change', drawFund);
    refreshCompareOptions();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
