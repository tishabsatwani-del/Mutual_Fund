/* Where You Stand: Plan my goal. */
(function (root) {
  'use strict';
  var A = root.PRCApp, E = root.PRCEngine, D = root.PRCDoors, C = root.PRCCharts;
  var $ = A.$, $$ = A.$$, esc = A.esc, money = A.money, pct = A.pct, share = A.share, notice = A.notice, fmtDate = A.fmtDate;
  var stat = A.stat, term = A.term, fold = A.fold;

  var G = { history: null, door: null, ran: false, last: null };
  var FIELDS = [
    { id: 'g-target', kind: 'rupees' }, { id: 'g-current', kind: 'rupees' }, { id: 'g-sip', kind: 'rupees' },
    { id: 'g-years', kind: 'years' }, { id: 'g-rate', kind: 'rate' }, { id: 'g-step', kind: 'stepUp' }
  ];
  function outOfRange() {
    var broken = [];
    FIELDS.forEach(function (f) {
      var el = $('#' + f.id), v = parseFloat(el.value), say = A.checkInput(f.kind, v), note = $('#' + f.id + '-bad');
      if (note) { note.textContent = say || ''; note.hidden = !say; }
      el.setAttribute('aria-invalid', say ? 'true' : 'false');
      if (say) broken.push(say);
    });
    var infl = $('#g-infl'), iv = parseFloat(infl.value), ibad = $('#g-infl-bad');
    var isay = infl.value.trim() === '' ? null : A.checkInput('inflation', iv);
    if (ibad) { ibad.textContent = isay || ''; ibad.hidden = !isay; }
    if (isay) broken.push(isay);
    return broken;
  }
  /* H6: every lever starts at exactly what was typed, even between steps,
     and "Put them back" restores it exactly. Each slider's steps are laid
     from the typed value (its minimum is shifted onto the same lattice), so
     the typed value is a position the slider can actually hold. */
  var LEVERS = [
    { id: 'g-scn-sip', key: 'monthlySip', label: 'Monthly investment', min: 0, step: 500, from: function (i) { return i.monthlySip; },
      max: function (i, plan) { var needed = i.monthlySip + ((plan && plan.extraMonthly) || 0); return Math.max(5000, Math.ceil(Math.max(i.monthlySip * 4, needed * 1.5) / 500) * 500); }, say: function (v) { return money(v) + ' a month'; } },
    { id: 'g-scn-step', key: 'annualStepUpRate', label: 'Raised each year by', min: 0, step: 1, from: function (i) { return Math.round(i.annualStepUpRate * 1e8) / 1e6; }, max: function () { return 25; }, scale: 0.01, say: function (v) { return trim(v) + '% a year'; } },
    { id: 'g-scn-years', key: 'years', label: 'Years left', min: 1, step: 1, from: function (i) { return i.years; }, max: function (i) { return Math.min(50, Math.max(10, Math.round(i.years) + 15)); }, say: function (v) { return trim(v) + (v === 1 ? ' year' : ' years'); } },
    { id: 'g-scn-target', key: 'target', label: 'Amount you are aiming for', min: 0, step: 50000, from: function (i) { return i.target; }, max: function (i) { return Math.max(500000, Math.round(i.target * 2 / 50000) * 50000); }, say: function (v) { return A.moneyWords(v); } }
  ];
  function trim(v) { return String(Math.round(v * 1000) / 1000); }
  /* the slider's range, laid on a lattice that passes through the typed value */
  function lattice(L, input, plan) {
    var exact = L.from(input), step = L.step;
    var off = ((exact - L.min) % step + step) % step;
    var min = L.min + off;
    var max = Math.max(L.max(input, plan), exact);
    max = min + Math.ceil((max - min) / step - 1e-9) * step;
    return { min: min, max: max, value: exact };
  }
  function wireScenario(input) {
    var touched = {};
    function read() {
      var v = { currentValue: input.currentValue, monthlySip: input.monthlySip, years: input.years, annualRate: input.annualRate, annualStepUpRate: input.annualStepUpRate, target: input.target };
      LEVERS.forEach(function (L) {
        var el = $('#' + L.id); if (!el) return;
        var n = touched[L.id] ? parseFloat(el.value) : L.from(input);
        v[L.key] = isFinite(n) ? n * (L.scale || 1) : v[L.key];
        var out = $('#' + L.id + '-v'); if (out) out.textContent = L.say(isFinite(n) ? n : L.from(input));
      });
      return v;
    }
    function draw() {
      var v = read(), p = E.projectGoal(v), slot = $('#g-scn-out');
      if (!slot) return;
      var moved = LEVERS.filter(function (L) { return touched[L.id] && Math.abs(parseFloat($('#' + L.id).value) - L.from(input)) > 1e-9; }).length;
      if (!moved) { slot.innerHTML = ''; return; }
      if (!p.ok) { slot.innerHTML = notice('bad', esc(p.message)); return; }
      var diff = p.projected - v.target;
      slot.innerHTML = '<div class="result" style="margin:.9rem 0 0"><div class="label">On these four, you reach</div><div class="value small">' + A.moneyWords(p.projected) + '</div>' +
        '<div class="sub">' + money(p.projected) + ' · against ' + money(v.target) + ' · ' + (diff >= 0 ? 'covered, ' + money(diff) + ' to spare' : 'short by ' + money(-diff)) + '</div></div>' +
        '<p class="hint">Over ' + trim(v.years) + ' years you would pay in ' + money(p.totalContributed) + ' of your own money, on top of the ' + money(v.currentValue) + ' you already hold.</p>';
    }
    LEVERS.forEach(function (L) { var el = $('#' + L.id); if (el) el.addEventListener('input', function () { touched[L.id] = true; draw(); }); });
    read();
    var reset = $('#g-scn-reset');
    if (reset) reset.addEventListener('click', function () {
      LEVERS.forEach(function (L) { var el = $('#' + L.id); if (el) { el.value = L.from(input); touched[L.id] = false; } });
      draw();
    });
  }

  function calcGoal() {
    var out = $('#g-out');
    var broken = outOfRange();
    if (broken.length) { out.innerHTML = notice('bad', esc(broken[0]) + (broken.length > 1 ? ' And ' + (broken.length - 1) + ' other field' + (broken.length > 2 ? 's are' : ' is') + ' out of range.' : '')); return; }
    var input = {
      currentValue: parseFloat($('#g-current').value), monthlySip: parseFloat($('#g-sip').value), years: parseFloat($('#g-years').value),
      annualRate: parseFloat($('#g-rate').value) / 100, annualStepUpRate: parseFloat($('#g-step').value) / 100, target: parseFloat($('#g-target').value)
    };
    var infl = $('#g-infl').value.trim() === '' ? null : parseFloat($('#g-infl').value) / 100;
    var plan = E.projectGoal(input);
    if (!plan.ok) { out.innerHTML = notice('bad', esc(plan.message)); return; }
    G.ran = true; G.last = input;
    var name = $('#g-name').value.trim() || 'this goal';
    var main = '', market = '', numbers = '';
    main += '<div class="result"><div class="label">' + term('goal', 'If nothing changes, you reach') + '</div><div class="value">' + A.moneyWords(plan.projected) + '</div><div class="sub">' + money(plan.projected) + ' · Goal: ' + money(plan.target) + '</div></div>';
    main += plan.onTrack ? notice('', '<strong>Covered, on the return you assumed.</strong> ' + esc(A.moneyWords(plan.surplus)) + ' to spare for ' + esc(name) + '.')
      : notice('bad', '<strong>Short by ' + esc(money(plan.gap)) + '.</strong> On the return you assumed, ' + esc(name) + ' is not covered by what you are doing now.');
    main += '<div class="stats topline">' + stat('You reach', A.moneyWords(plan.projected)) + stat('Your goal', A.moneyWords(plan.target)) +
      stat(plan.onTrack ? 'To spare' : 'Short by', A.moneyWords(plan.onTrack ? plan.surplus : plan.gap)) + stat(plan.onTrack ? 'Needed each month' : 'More each month', plan.onTrack ? 'nothing more' : money(plan.extraMonthly)) + '</div>';
    main += '<div class="card">' + C.goalBar(plan) + '</div>';

    /* what it would take: the extra, the rate the goal needs, the four levers */
    var req = E.requiredRate(input);
    main += '<div class="card"><h2>What it would take</h2>';
    if (!plan.onTrack) {
      main += '<div class="result" style="margin:0 0 .6rem"><div class="label">More each month</div><div class="value small">' + money(plan.extraMonthly) + (input.annualStepUpRate > 0 ? ' now' : ', every month') + '</div>' +
        '<div class="sub">' + (input.annualStepUpRate > 0 ? 'rising ' + pct(input.annualStepUpRate, 0) + ' a year with the rest of your instalment, ' : '') + 'on top of the ' + money(input.monthlySip) + ' a month you already invest</div></div>';
    } else main += '<p class="cardtext">Nothing more is required on these assumptions. The levers below show what happens if you do more anyway.</p>';
    if (req.ok) {
      main += '<p class="cardtext"><strong>' + term('requiredRate', 'The return this goal needs') + ':</strong> ' +
        (req.rate != null ? 'with what you have and what you add, ' + esc(name) + ' is reached at exactly <strong class="key">' + pct(req.rate) + ' a year</strong>. ' +
          (req.rate < 0 && pct(-req.rate) !== pct(0) ? 'A rate below zero means what you have and pay in already comes to more than the goal: the money could lose ' + pct(-req.rate) + ' a year and still reach it. ' : '') +
          'You assumed ' + pct(input.annualRate) + '. ' +
          (req.rate > input.annualRate ? 'The gap between the two is the return you are hoping the market will supply; the levers below are the parts you control.' : 'Anything above the required rate is margin.') +
          (G.history ? historyBeat(req.rate, input.years) : ' Load a history below the form and this line also says how often stretches of your length delivered it.')
          : esc(req.message)) + '</p>';
    }
    main += '<div class="scenario" id="g-scn"><p class="hint tight">Move any of these four. The figure moves with them; your entries above are untouched. The return is not a lever: it is the one thing nobody controls.</p>' +
      LEVERS.map(function (L) { var r = lattice(L, input, plan); return '<div class="lever"><label for="' + L.id + '">' + L.label + '</label><input type="range" id="' + L.id + '" min="' + r.min + '" max="' + r.max + '" step="' + L.step + '" value="' + r.value + '"><output id="' + L.id + '-v" for="' + L.id + '"></output></div>'; }).join('') +
      '<div id="g-scn-out" aria-live="polite"></div><button class="secondary" type="button" id="g-scn-reset">Put them back</button></div></div>';
    main += fold('What this figure is not', '<p>The ' + pct(input.annualRate) + ' is an assumption you typed in, not a rate anyone can promise. Real markets do not deliver the same return every year, and a run of poor years early on hurts more than the same years late. The projection is an illustration of arithmetic, not a forecast, and it leaves out tax and exit loads.</p>');
    var readPlan = readingPlan(input, plan, infl);
    main += '<div class="meaning"><h3>What to look at next</h3><p>The <em>If the market differs</em> tab shows the same plan at four other returns' + (G.history ? ', and under the worst, middle and best stretches in ' + esc(G.history.name) : ', and under a history file’s own stretches once one is loaded') + '. The <em>All the numbers</em> tab separates your own money from growth' + (infl != null ? ' and puts the goal in today’s rupees' : '') + '.</p></div>';

    main += readPlan;

    /* the market's say: four rates, the file's own stretches, and waiting */
    market += '<div class="card"><h2>It depends what the market does</h2><ul class="scnlines">';
    E.requiredAcrossRates(input, [0.06, 0.08, 0.10, 0.12]).forEach(function (row) {
      if (row.error) return;
      market += '<li' + (Math.abs(row.rate - input.annualRate) < 1e-9 ? ' class="now"' : '') + '>At ' + pct(row.rate, 0) + ' a year: <strong>' + esc(A.moneyWords(row.projected)) + '</strong>, ' + (row.onTrack ? 'nothing more needed.' : esc(money(row.extraMonthly)) + ' more needed each month.') + '</li>';
    });
    market += '</ul><p class="hint">' + (E.requiredAcrossRates(input, [input.annualRate])[0] && [0.06, 0.08, 0.10, 0.12].some(function (r) { return Math.abs(r - input.annualRate) < 1e-9; }) ? 'Your own assumption of ' + pct(input.annualRate, 0) + ' is highlighted. ' : 'Your own assumption is ' + pct(input.annualRate) + '. ') + 'Nobody can tell you which of these rows the future will resemble.</p>';
    if (G.history) market += historyRows(input);
    else market += '<p class="cardtext">Load a NAV or index history file under the form and this card also runs your plan through the worst, the middle and the best stretch of your length that the file holds.</p>';
    market += '</div>';
    var waits = E.costOfWaiting(input, [0, 5, 10]).filter(function (w) { return !w.error; });
    if (waits.length > 1) {
      market += '<div class="card"><h2>What waiting costs</h2><div class="scroll"><table class="data"><thead><tr><th>If you start</th><th>Years left</th><th>Needed each month</th><th>Total you pay in</th></tr></thead><tbody>';
      waits.forEach(function (w) {
        market += '<tr><td>' + (w.delay === 0 ? 'now' : 'in ' + w.delay + ' years') + '</td>' + (w.impossible ? '<td colspan="3">the goal date has already passed</td>' : '<td>' + w.yearsLeft + '</td><td>' + money(w.monthlyNeeded) + '</td><td>' + money(w.totalPaid) + '</td>') + '</tr>';
      });
      market += '</tbody></table></div>';
      if (waits[0].monthlyNeeded > 0 && !waits[1].impossible) market += '<p class="cardtext">Same goal, same date, same assumed return. Waiting ' + waits[1].delay + ' years raises what is needed each month from ' + money(waits[0].monthlyNeeded) + ' to <strong class="key">' + money(waits[1].monthlyNeeded) + '</strong>, and the total you pay in from ' + money(waits[0].totalPaid) + ' to ' + money(waits[1].totalPaid) + '. Nothing about the market changed between those rows; only the number of years did.</p>';
      market += '</div>';
    }

    /* own money and growth; today's rupees */
    var ownMoney = input.currentValue + plan.totalContributed, growth = plan.projected - ownMoney;
    numbers += '<div class="card"><h2>Your money, and growth on it</h2><div class="stats">' + stat('Already saved', money(input.currentValue)) + stat('Still to pay in', money(plan.totalContributed)) + stat('Growth on both', money(growth)) + stat('Growth’s share of the end', growth > 0 ? share(growth / plan.projected) : 'none') + '</div>' +
      '<p class="cardtext">Of the ' + money(plan.projected) + ' at the end, ' + money(ownMoney) + ' is money you hand over yourself and <strong class="key">' + money(growth) + ' is what it earns while you leave it alone</strong>. The longer the period, the more the second number does the work.</p></div>';
    if (infl != null) {
      var tr = E.todaysRupees(input.target, infl, input.years);
      numbers += '<div class="card"><h2>' + term('todaysRupees', 'The goal in today’s rupees') + '</h2><div class="stats">' + stat('Your target', money(input.target)) + stat('Buys, in today’s money', money(tr.buysToday)) + stat('To keep today’s buying power, aim for', money(tr.targetForToday)) + '</div>' +
        '<p class="cardtext">At ' + pct(infl, 1) + ' inflation for ' + input.years + ' years, prices multiply by ' + tr.factor.toFixed(2) + '. So <strong class="key">' + money(input.target) + ' then buys what ' + money(tr.buysToday) + ' buys today</strong>, and a goal worth ' + money(input.target) + ' in today’s money is ' + money(tr.targetForToday) + ' by then. Move the last lever on the <em>Your plan</em> tab to ' + A.moneyWords(tr.targetForToday) + ' to see what that takes.</p></div>';
    } else {
      numbers += notice('', '<strong>These are future rupees, not today’s.</strong> Type an inflation figure in the form above and this tab says what the goal buys in today’s money, and what target keeps today’s buying power.');
    }
    numbers += '<div class="card"><h2>The arithmetic</h2><div class="scroll"><table class="data prose"><tbody>' +
      A.trow('Years', String(input.years)) + A.trow('Return assumed', pct(input.annualRate) + ' a year, compounded monthly at ' + pct(Math.pow(1 + input.annualRate, 1 / 12) - 1, 3) + ' a month') +
      A.trow('Monthly amount', money(input.monthlySip) + (input.annualStepUpRate > 0 ? ', rising ' + pct(input.annualStepUpRate, 0) + ' each year' : ', level')) +
      A.trow('Instalments', String(Math.round(input.years * 12))) + A.trow('Paid in over the years', money(plan.totalContributed)) +
      A.trow('What you already have grows to', money(input.currentValue * Math.pow(1 + input.annualRate, input.years))) +
      A.trow('End value', money(plan.projected)) + '</tbody></table></div>' +
      '<p class="hint">Each month’s instalment is added at the start of the month and earns from then. The step-up applies once a year, on the anniversary of the first instalment.</p></div>';

    var html = A.tabs('g-tabs', [
      { key: 'plan', label: 'Your plan', html: main },
      { key: 'market', label: 'If the market differs', html: market },
      { key: 'numbers', label: 'All the numbers', html: numbers }
    ]) + A.pdfFoot('goal', name);
    out.innerHTML = html;
    wireScenario(input);
  }
  /* Reading your plan together: what is the reader's own money and what the
     return must supply, what the goal is worth today, and the questions only
     the reader can answer. Short sentences; each only when its figures exist;
     none says what to do. */
  function readingPlan(input, plan, infl) {
    var facts = [], asks = [], rate = function (r) { return Math.abs(r * 100 - Math.round(r * 100)) < 1e-9 ? pct(r, 0) : pct(r); };
    var own = input.currentValue + plan.totalContributed, grown = plan.projected - own;
    facts.push('Of the ' + A.moneyWords(plan.projected) + ' you reach, ' + A.moneyWords(own) + ' is money you put in yourself.');
    if (grown > 0) facts.push('<strong class="key">The other ' + A.moneyWords(grown) + ' is growth the return has to supply.</strong>');
    var rows = E.requiredAcrossRates(input, [0.06, 0.08, 0.10, 0.12]).filter(function (r) { return !r.error; });
    var six = rows.filter(function (r) { return Math.abs(r.rate - 0.06) < 1e-9; })[0];
    if (six && input.annualRate > 0.06 + 1e-9) facts.push('At 6% a year instead of ' + rate(input.annualRate) + ', the same payments reach ' + A.moneyWords(six.projected) + '.');
    var tr = infl != null ? E.todaysRupees(input.target, infl, input.years) : null;
    if (tr) facts.push('At ' + pct(infl, 1) + ' inflation, ' + A.moneyWords(input.target) + ' in ' + input.years + ' years buys what <strong>' + A.moneyWords(tr.buysToday) + '</strong> buys today.');
    asks.push(['Today’s price or then?', 'Is ' + A.moneyWords(input.target) + ' what this goal costs today, or what it will cost in ' + input.years + ' years?' +
      (tr ? ' If it is today’s price, the same goal costs ' + A.moneyWords(tr.targetForToday) + ' by then.' : '')]);
    /* a lower return than the one assumed: the row nearest four points below
       it, leaving 6% to the sentence above when another row is there */
    var below = rows.filter(function (r) { return r.rate < input.annualRate - 1e-9; });
    var pick = below.filter(function (r) { return Math.abs(r.rate - 0.06) > 1e-9; });
    if (!pick.length && !(six && input.annualRate > 0.06 + 1e-9)) pick = below;
    var aim = input.annualRate - 0.04, low = pick.reduce(function (a, b) { return !a || Math.abs(b.rate - aim) < Math.abs(a.rate - aim) - 1e-9 ? b : a; }, null);
    asks.push(['What is fixed', (low ? 'At ' + pct(low.rate, 0) + ' a year this plan reaches ' + A.moneyWords(low.projected) + '. ' : '') + 'Which is fixed for you: the amount, the date, or what you can put in each month?']);
    if (G.history) {
      var h = E.goalUnderHistory(input, G.history.series), ser = G.history.series;
      if (h.ok && h.windows > 0) {
        var span = (ser[ser.length - 1].t - ser[0].t) / (365.2425 * 86400000);
        asks.push(['The history', 'Every ' + h.years + '-year stretch in ' + esc(G.history.name) + ' returned ' + pct(h.worst.rate, 1) + ' a year or more. The file covers ' + span.toFixed(1) + ' years. ' +
          'How much of the next ' + input.years + ' years do you expect to look like them?']);
      }
    }
    return '<div class="card readtogether" id="g-together"><h2>Reading your plan together</h2><p class="cardtext">' + facts.join(' ') + '</p>' +
      '<h3 class="subhead">Questions only you can answer</h3><ol class="insights reflectlist">' +
      asks.map(function (q) { return '<li><span class="ins-h">' + q[0] + '</span><span class="ins-b">' + q[1] + '</span></li>'; }).join('') + '</ol></div>';
  }
  function historyBeat(rate, years) {
    var r = E.rollingReturns(G.history.series, Math.max(1, Math.round(years)), {});
    if (!r.ok) return '';
    var sh = E.shareAbove(r.values, rate);
    return ' In ' + esc(G.history.name) + ', ' + share(sh.share) + ' of the ' + Math.max(1, Math.round(years)) + '-year stretches (' + sh.above.toLocaleString('en-IN') + ' of ' + sh.count.toLocaleString('en-IN') + ') delivered at least that. Past stretches, not odds.';
  }
  function historyRows(input) {
    var g = E.goalUnderHistory(input, G.history.series);
    if (!g.ok) return notice('warn', esc(G.history.name) + ': ' + esc(g.message));
    function row(label, x, dates) {
      return '<tr><td>' + label + (dates ? ' <span class="qsub">' + dates + '</span>' : '') + '</td><td>' + pct(x.rate, 1) + ' a year</td><td>' + money(x.plan.projected) + '</td><td>' + (x.plan.onTrack ? 'nothing more' : money(x.plan.extraMonthly) + ' a month') + '</td></tr>';
    }
    return '<h3 class="subhead">' + term('goalHistory', 'Under ' + esc(G.history.name) + '’s own stretches of ' + g.years + ' years') + '</h3>' +
      '<div class="scroll"><table class="data"><thead><tr><th>Stretch</th><th>It returned</th><th>You reach</th><th>Extra needed</th></tr></thead><tbody>' +
      row('Worst', g.worst, fmtDate(g.worst.from) + ' to ' + fmtDate(g.worst.to)) + row('Median of ' + g.windows.toLocaleString('en-IN') + ' stretches', g.median, '') + row('Best', g.best, fmtDate(g.best.from) + ' to ' + fmtDate(g.best.to)) +
      '</tbody></table></div><p class="hint">Three stretches that already happened in this file, each ' + g.years + ' years long, applied to your plan. They are the range that history holds, not the range the future will hold' + (g.best.rate > 0.5 ? '; a rate above 50% is capped at 50% in the plan' : '') + '.</p>';
  }

  function init() {
    $('#g-history-howto').innerHTML = D.guide('any');
    G.door = D.mount($('#g-history-door'), {
      prefix: 'gh', kind: 'any', label: 'A NAV or index history file', hint: 'CSV, Excel or text · a date column and a value column',
      gate: function (rows) { var v = A.P.checkSchema(rows); return v.ok ? null : notice('bad', esc(v.message)); },
      onLoaded: function (res) { G.history = res; if (G.ran) calcGoal(); }
    });
    FIELDS.forEach(function (f) { $('#' + f.id).addEventListener('input', outOfRange); });
    $('#g-infl').addEventListener('input', outOfRange);
    $('#g-calc').addEventListener('click', calcGoal);
  }
  root.PRCGoal = { init: init, calc: calcGoal, state: G };
})(typeof globalThis !== 'undefined' ? globalThis : this);
