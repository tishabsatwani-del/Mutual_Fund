/* Where You Stand — the four modules.
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

  var KINDS = ['Money in', 'Money out', 'Worth today'];
  var rowSeq = 0;

  function addRow(values) {
    var v = values || {};
    var id = 'r' + (rowSeq++);
    var wrap = A.el('div', { class: 'entry', 'data-row': id });
    /* The labels are visible on a phone, where the column headings are not: an
     * error saying "row 4" is useless if row 4 is four unlabelled boxes. */
    /* Review v4 §12.6: the row is [fields][×]. The fields sit in their own
     * column so the × can never take space from them, and that column carries
     * min-width:0 -- without it a grid column refuses to shrink below its
     * content's minimum and the fields crush to about 60 pixels each ("Inv",
     * "Amou", "Whicl") while the × keeps its full width. */
    wrap.innerHTML =
      '<div class="c-fields">' +
        '<div class="c-num" aria-hidden="true"></div>' +
        '<div class="c-date"><label for="' + id + 'd">Date</label>' +
          '<input type="date" id="' + id + 'd" class="in-date" value="' + esc(v.date || '') + '">' +
          '<span class="date-echo" id="' + id + 'de"></span></div>' +
        '<div class="c-kind"><label for="' + id + 'k">What happened</label>' +
          '<select id="' + id + 'k" class="in-kind">' +
          KINDS.map(function (k) {
            return '<option' + (v.kind === k ? ' selected' : '') + '>' + k + '</option>';
          }).join('') + '</select></div>' +
        '<div class="c-amt"><label for="' + id + 'a">Amount in rupees</label>' +
          '<input type="number" id="' + id + 'a" class="in-amt" inputmode="decimal" min="0" step="1" ' +
          'placeholder="Amount" value="' + (v.amount != null ? esc(v.amount) : '') + '">' +
          '<span class="amt-echo" id="' + id + 'ae"></span></div>' +
        '<div class="c-tag"><label for="' + id + 't">Which fund or goal</label>' +
          '<input type="text" id="' + id + 't" class="in-tag" autocomplete="off" ' +
          'placeholder="Which fund?" value="' + esc(v.label || '') + '"></div>' +
      '</div>' +
      '<button type="button" class="del" aria-label="Remove this row">&times;</button>';
    wrap.querySelector('.del').addEventListener('click', function () { wrap.remove(); numberRows(); });

    /* Review v4 §12.5: a native date input renders in the BROWSER's locale, and
     * 04/01/2022 is 4 January to an Indian reader and 1 April to this tool.
     * The control stays -- it is the right one on a phone -- and the date it
     * holds is echoed underneath in dd-MMM-yyyy, which reads one way only. */
    var dateInput = wrap.querySelector('.in-date');
    var dateEcho = wrap.querySelector('.date-echo');
    function sayDate() {
      var t = A.isoToTs(dateInput.value);
      dateEcho.textContent = isFinite(t) ? A.fmtDate(t) : '';
    }
    dateInput.addEventListener('input', sayDate);
    dateInput.addEventListener('change', sayDate);
    sayDate();

    /* And the rupee helper the review asks for under every rupee input. */
    var amtInput = wrap.querySelector('.in-amt');
    var amtEcho = wrap.querySelector('.amt-echo');
    function sayAmt() {
      var n = parseFloat(amtInput.value);
      var say = amtInput.value.trim() === '' ? '' : A.checkInput('rupees', n);
      amtEcho.textContent = say || A.echo(n);
      amtEcho.classList.toggle('refuse', !!say);
    }
    amtInput.addEventListener('input', sayAmt);
    sayAmt();
    $('#pf-rows').appendChild(wrap);
    numberRows();
    return wrap;
  }

  /* Rows are referred to by number in every error message, so they carry one. */
  function numberRows() {
    $$('#pf-rows .entry').forEach(function (r, i) {
      var n = r.querySelector('.c-num');
      if (n) n.textContent = 'Row ' + (i + 1);
    });
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

  function todayTs() {
    var n = new Date();
    return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
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
      if (t > todayTs()) {
        problems.push('Row ' + (i + 1) + ' is dated ' + fmtDate(t) + ', which is in the future. ' +
          'This measures money that has already moved.');
        return;
      }
      if (!isFinite(r.amount) || r.amount <= 0) {
        problems.push('Row ' + (i + 1) + ' needs an amount greater than zero, typed as a plain positive number.');
        return;
      }
      var signed = r.kind === 'Money in' ? -r.amount : r.amount;
      if (r.kind === 'Money in') invested += r.amount;
      else if (r.kind === 'Money out') withdrawn += r.amount;
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
        ? ' Add a last row with today\'s date, <strong>Worth today</strong>, and what the holding is worth now.'
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

    /* ------------------------------------------------ whose maths is it?
     * Two arithmetics are on this screen and they will not match. The book's
     * first question is exactly this, so the tool answers it out loud rather
     * than leaving the reader to wonder which number is wrong. Neither is. */
    html += twoNumbersCard(abs, rate, years);

    /* ------------------------------------------- after the bill, what is left?
     * Inflation is the one return that compounds against every rupee. It ships
     * with no rate filled in: a number here would be the tool telling the
     * reader what to expect, and that is not its job. */
    html += realReturnCard(rate);

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
      '<p>It compares with nothing else, either. Not the fund\'s own return, not another investor\'s, ' +
      'not your other fund. Each of those ran on a different set of dates.</p>' +
      '<p>It is before exit load and before tax, so what you finally keep will be a little less. On an ' +
      'equity fund held for years, plan on roughly a point a year less once the tax is paid, and more ' +
      'than that if you sell early.</p></div>';

    html += disagreeCard();

    html += '<div class="meaning"><h3>What to look at next</h3>' +
      '<p>A return means little without a period and a comparison. Use <button class="link" data-go="history">' +
      'Understand market history</button> to see the range this kind of market has actually delivered over ' +
      'the same length of time, and <button class="link" data-go="goal">Plan my goal</button> to see whether ' +
      'this rate gets you where you are going.</p></div>';

    html += '</div>';

    if ($('#pf-group').value === 'on') html += byLabel(flows, rate);
    out.innerHTML = html;
    wireRealReturn(rate);
  }

  function wireRealReturn(rate) {
    var input = $('#pf-infl'), out = $('#pf-real-out');
    if (!input || !out) return;
    input.addEventListener('input', function () {
      var i = parseFloat(input.value);
      if (!isFinite(i)) { out.innerHTML = ''; return; }
      var real = (1 + rate) / (1 + i / 100) - 1;
      out.innerHTML = '<div class="stats" style="margin:.2rem 0 0">' +
        stat('Your return', pct(rate)) +
        stat('Inflation', i.toFixed(1) + '%') +
        stat('What is left', pct(real)) +
        '</div>' +
        '<p class="hint" style="margin:.7rem 0 0">' +
        (real < 0
          ? 'Below zero. Over this period your money bought less at the end than at the start, and no ' +
            'statement anywhere printed a minus sign for it.'
          : 'This is the part that actually bought you something. Everything above it went on holding ' +
            'the price of things steady.') + '</p>';
    });
  }

  /* The book's first question, answered on the reader's own numbers.
   *
   * Absolute return has no clock in it. XIRR is a yearly rate. Early on, a
   * small total gain gets stretched to a yearly pace and XIRR reads higher; as
   * the years pile up the total keeps growing while the yearly rate does not,
   * and somewhere near the two-year mark the total overtakes it for good. That
   * crossover is the single most common reason two figures on one screen look
   * like a contradiction, so the tool says which side of it the reader is on. */
  function twoNumbersCard(abs, rate, years) {
    /* The earlier wording said the total overtakes the rate "near the two-year
     * mark", which is true for a monthly SIP and false for a lump sum: a lump
     * crosses at exactly twelve months, because (1+r)^1 - 1 is r. One line
     * that is true for both is simply how many years the total has inside it. */
    var absAhead = abs > rate;
    var sentence = years < 1
      ? 'Under a year, the yearly rate is the one to ignore. It stretches a short stretch to a ' +
        'twelve-month pace: a 5% gain in two months reads as about 34% a year, which is not something ' +
        'that has happened to anyone. Read the total gain instead.'
      : absAhead
        ? 'The total is bigger than the yearly rate because it has ' + years.toFixed(1) +
          ' years inside it; the rate has one.'
        : 'The yearly rate is bigger than the total because most of this money has been invested for ' +
          'less than a year so far; the rate is still a per-year figure.';

    return '<div class="card"><h2>Two numbers, two different questions</h2>' +
      '<p class="hint" style="margin:0 0 .9rem">Both are on this screen, they do not match, and ' +
      'nothing is wrong. They are answering different questions.</p>' +
      '<div class="scroll"><table class="data"><tbody>' +
      '<tr><td><strong>Absolute return</strong><br><span class="qsub">Worth today, plus what you took ' +
      'out, minus what you put in &mdash; as a share of what you put in.</span></td><td>' +
      esc(A.signedPct(abs)) + '<br><span class="qsub">in total &middot; no clock in it</span></td></tr>' +
      '<tr><td><strong>XIRR</strong><br><span class="qsub">At what yearly speed did my own money ' +
      'travel?</span></td><td>' + pct(rate) + '<br><span class="qsub">a year &middot; counts every ' +
      'date</span></td></tr>' +
      '</tbody></table></div>' +
      '<p style="margin:.9rem 0 0;color:var(--ink-2);font-size:.95rem">' + sentence + '</p>' +
      '<details class="explain"><summary>And the third one, CAGR, which is not yours</summary>' +
      '<div class="body"><p>CAGR is the number a fund publishes. It answers one question: if a single ' +
      'rupee had gone in on the first day of the period shown and had never been touched, at what ' +
      'steady yearly speed did it grow?</p>' +
      '<p>If you invested monthly, that is not your return, because it measures one lump sum that went ' +
      'in on day one and stayed. It is also measured between the first and last day of the period the ' +
      'fund printed, not between the day you bought and the day you are reading.</p>' +
      '<p>Use CAGR to compare one fund with another over the same period. Use the XIRR above to see ' +
      'what your own money did. They are not rivals; they are answers to different questions.</p>' +
      '</div></details></div>';
  }

  /* The book's third question. The subtraction most statements never print. */
  function realReturnCard(rate) {
    return '<div class="card" id="pf-real"><h2>After the bill, what is left?</h2>' +
      '<p class="hint" style="margin:0 0 .9rem">Your return is printed on the statement. Your real ' +
      'earning is printed on the shop&rsquo;s bill. Type the inflation figure you want to measure ' +
      'against &mdash; this tool does not choose one for you.</p>' +
      '<div class="field" style="max-width:15rem"><label for="pf-infl">Inflation, % a year</label>' +
      '<input type="number" id="pf-infl" inputmode="decimal" step="0.1" min="0" max="100" ' +
      'placeholder="e.g. 6"></div>' +
      '<div id="pf-real-out"></div>' +
      '<details class="explain"><summary>How this is worked out</summary><div class="body">' +
      '<p>The quick version is your return minus inflation. The exact version, which this tool uses, ' +
      'is (1 + return) &divide; (1 + inflation) &minus; 1. On a 12% return in a 6% year the quick ' +
      'maths says 6 and the exact maths says 5.66.</p>' +
      '<p>The official basket is not your basket. If your life is heavy with school fees or hospital ' +
      'bills, both of which have outrun the headline figure for years, your real subtraction is bigger ' +
      'than the country&rsquo;s.</p></div></details></div>';
  }

  /* Five checks that dissolve almost every "these two screens disagree". */
  function disagreeCard() {
    return '<details class="explain card"><summary>When two screens disagree about the same fund</summary>' +
      '<div class="body"><p style="margin-top:0">Before you distrust anyone, run five checks.</p>' +
      '<dl>' +
      '<dt>The plan</dt><dd>Direct and Regular are different rows, and Regular carries the ' +
      'distributor&rsquo;s commission.</dd>' +
      '<dt>The option</dt><dd>Growth and IDCW are different histories. An IDCW NAV falls each time ' +
      'money is paid out.</dd>' +
      '<dt>The method</dt><dd>One screen may be showing a total while the other shows a yearly rate, ' +
      'or one shows the fund&rsquo;s CAGR while the other shows your XIRR.</dd>' +
      '<dt>The window</dt><dd>A one-year figure and a five-year figure answer different questions.</dd>' +
      '<dt>The date</dt><dd>Returns are dated. A page refreshed yesterday and one refreshed last week ' +
      'are photographs of two different days.</dd>' +
      '</dl><p>Five checks, ten seconds, and almost every mismatch dissolves.</p></div></details>';
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

  /* Three chained window.prompt dialogs on a phone is not an interface. The
   * same four questions, asked in the page, with a date picker like everywhere
   * else. */
  function toggleSip(show) {
    var panel = $('#sip-builder');
    panel.hidden = !show;
    $('#pf-sip').setAttribute('aria-expanded', String(show));
    if (show) {
      if (!$('#sip-start').value) {
        /* a year ago, not today: a SIP that starts today has no history to measure */
        var d = new Date();
        d.setUTCFullYear(d.getUTCFullYear() - 1);
        $('#sip-start').value = d.toISOString().slice(0, 10);
      }
      $('#sip-start').max = A.isoToday();
      $('#sip-msg').innerHTML = '';
      $('#sip-start').focus();
    }
  }

  function addSipRows() {
    var msg = $('#sip-msg');
    var t0 = A.isoToTs($('#sip-start').value);
    var amount = parseFloat($('#sip-amount').value);
    var count = parseInt($('#sip-count').value, 10);
    var name = $('#sip-name').value.trim();

    if (isNaN(t0)) { msg.innerHTML = notice('bad', 'Choose the date of the first instalment.'); return; }
    if (t0 > todayTs()) {
      msg.innerHTML = notice('bad', 'The first instalment cannot be in the future.');
      return;
    }
    if (!isFinite(amount) || amount <= 0) {
      msg.innerHTML = notice('bad', 'Enter the monthly amount as a plain positive number.');
      return;
    }
    if (!isFinite(count) || count < 1 || count > 480) {
      msg.innerHTML = notice('bad', 'Enter between 1 and 480 instalments.');
      return;
    }

    var added = 0, skipped = 0;
    for (var i = 0; i < count; i++) {
      var t = E.addMonths(t0, i);
      if (t > todayTs()) { skipped++; continue; }
      addRow({ date: new Date(t).toISOString().slice(0, 10), kind: 'Money in',
               amount: amount, label: name });
      added++;
    }
    if (name) $('#pf-group').value = 'on';
    msg.innerHTML = notice('ok', 'Added ' + added + ' instalment' + (added === 1 ? '' : 's') + '.' +
      (skipped ? ' ' + skipped + ' would have fallen in the future and were left out.' : ''));
    toggleSip(false);
  }

  function fillExample() {
    $('#pf-rows').innerHTML = '';
    addRow({ date: '2021-04-01', kind: 'Money in', amount: 200000 });
    addRow({ date: '2022-04-01', kind: 'Money in', amount: 150000 });
    addRow({ date: '2024-04-01', kind: 'Money out', amount: 100000 });
    addRow({ date: A.isoToday(), kind: 'Worth today', amount: 420000 });
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

  /* Review v4 §12.1: the planner accepted any number at all. A step-up of
   * 10000000 was taken as 100,000 times a year and returned a 68-digit figure.
   * No formatting rule can rescue that number -- the refusal has to happen at
   * the field, before anything is computed. Section 11 sets the ranges; the
   * field says which one it broke and the screen does not compute. */
  var GOAL_FIELDS = [
    { id: 'g-target',  kind: 'rupees' },
    { id: 'g-current', kind: 'rupees' },
    { id: 'g-sip',     kind: 'rupees' },
    { id: 'g-years',   kind: 'years'  },
    { id: 'g-rate',    kind: 'rate'   },
    { id: 'g-step',    kind: 'stepUp' }
  ];

  function goalOutOfRange() {
    var broken = [];
    GOAL_FIELDS.forEach(function (f) {
      var el = $('#' + f.id);
      if (!el) return;
      var v = parseFloat(el.value);
      var say = A.checkInput(f.kind, v);
      var note = $('#' + f.id + '-bad');
      if (note) { note.textContent = say || ''; note.hidden = !say; }
      el.setAttribute('aria-invalid', say ? 'true' : 'false');
      if (say) broken.push(say);
    });
    return broken;
  }

  function calcGoal() {
    var out = $('#g-out');
    var broken = goalOutOfRange();
    if (broken.length) {
      out.innerHTML = notice('bad', esc(broken[0]) +
        (broken.length > 1 ? ' And ' + (broken.length - 1) + ' other field' +
          (broken.length > 2 ? 's are' : ' is') + ' out of range.' : ''));
      return;
    }

    var input = {
      currentValue: parseFloat($('#g-current').value),
      monthlySip: parseFloat($('#g-sip').value),
      years: parseFloat($('#g-years').value),
      annualRate: parseFloat($('#g-rate').value) / 100,
      annualStepUpRate: parseFloat($('#g-step').value) / 100,
      target: parseFloat($('#g-target').value)
    };
    var plan = E.projectGoal(input);
    if (!plan.ok) { out.innerHTML = notice('bad', esc(plan.message)); return; }

    var name = $('#g-name').value.trim() || 'this goal';
    var html = '';

    /* The headline is the figure in words -- section 11's rule for a headline
     * and for any figure inside a sentence -- with the full digits beneath it
     * for a reader checking against their own arithmetic. Both go through the
     * one formatter, which is what makes an exponent unrepresentable. */
    html += '<div class="result"><div class="label">If nothing changes, you reach</div>' +
      '<div class="value">' + A.moneyWords(plan.projected) + '</div>' +
      '<div class="sub">' + money(plan.projected) + ' · Goal: ' + money(plan.target) + '</div></div>';

    if (plan.onTrack) {
      html += notice('ok', '<strong>On track.</strong> On the return you assumed, ' + esc(name) +
        ' is covered with ' + esc(A.moneyWords(plan.surplus)) + ' to spare.');
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

    /* ---- §8: one assumed return printed alone reads as a promise */
    html += '<div class="card"><h2>It depends what the market does</h2>' +
      '<div class="scroll"><table class="data"><thead><tr><th>If returns average</th>' +
      '<th>You reach</th><th>Extra needed each month</th></tr></thead><tbody>';
    E.requiredAcrossRates(input, [0.06, 0.08, 0.10, 0.12]).forEach(function (row) {
      if (row.error) return;
      html += '<tr' + (Math.abs(row.rate - input.annualRate) < 1e-9 ?
        ' style="background:var(--accent-soft)"' : '') + '><td>' + pct(row.rate, 0) +
        ' a year</td><td>' + money(row.projected) + '</td><td>' +
        (row.onTrack ? 'nothing more needed' : money(row.extraMonthly) + ' a month') + '</td></tr>';
    });
    html += '</tbody></table></div>' +
      '<p class="hint" style="margin-top:.6rem">Your own assumption of ' + pct(input.annualRate, 0) +
      ' is highlighted. Nobody can tell you which of these rows the future will resemble.</p></div>';

    /* ---- §9: what waiting costs */
    var waits = E.costOfWaiting(input, [0, 5, 10]).filter(function (w) { return !w.error; });
    if (waits.length > 1) {
      html += '<div class="card"><h2>What waiting costs</h2>' +
        '<div class="scroll"><table class="data"><thead><tr><th>If you start</th>' +
        '<th>Years left</th><th>Needed each month</th><th>Total you pay in</th>' +
        '</tr></thead><tbody>';
      waits.forEach(function (w) {
        html += '<tr><td>' + (w.impossible ? 'in ' + w.delay + ' years' :
          w.delay === 0 ? 'now' : 'in ' + w.delay + ' years') + '</td>' +
          (w.impossible
            ? '<td colspan="3">the goal date has already passed</td>'
            : '<td>' + w.yearsLeft + '</td><td>' + money(w.monthlyNeeded) + '</td><td>' +
              money(w.totalPaid) + '</td>') + '</tr>';
      });
      html += '</tbody></table></div>';
      if (waits.length > 1 && waits[0].monthlyNeeded > 0) {
        html += '<div class="meaning"><h3>What this means</h3>' +
          '<p>Same goal, same date, same assumed return. Waiting ' + waits[1].delay +
          ' years raises what you must put in each month from ' + money(waits[0].monthlyNeeded) +
          ' to <strong>' + money(waits[1].monthlyNeeded) + '</strong>, and raises the total you pay ' +
          'in from ' + money(waits[0].totalPaid) + ' to ' + money(waits[1].totalPaid) + '.</p>' +
          '<p>Nothing about the market changed between those rows. Only the number of years did.</p>' +
          '</div>';
      }
      html += '</div>';
    }

    /* ---- §10: how much of the end is your money, and how much is growth */
    var ownMoney = input.currentValue + plan.totalContributed;
    var growth = plan.projected - ownMoney;
    html += '<div class="card"><h2>Your money, and growth on it</h2><div class="stats">' +
      stat('Already saved', money(input.currentValue)) +
      stat('Still to pay in', money(plan.totalContributed)) +
      stat('Growth on both', money(growth)) +
      stat('Growth\u2019s share of the end', growth > 0 ? pct(growth / plan.projected, 0) : '—') +
      '</div>' +
      '<div class="meaning"><h3>What this means</h3>' +
      '<p>Of the ' + money(plan.projected) + ' at the end, ' + money(ownMoney) + ' is money you ' +
      'hand over yourself \u2014 ' + money(input.currentValue) + ' already saved and ' +
      money(plan.totalContributed) + ' still to pay in \u2014 and ' + money(growth) + ' is what it ' +
      'earns while you leave it alone. The longer the period, the more the second number does the ' +
      'work.</p></div></div>';

    /* ---- §11: the target is in today's rupees unless the reader adjusts it */
    html += '<div class="card">' + notice('',
      '<strong>These are future rupees, not today\u2019s.</strong> ' + money(input.target) +
      ' in ' + plan.years.toFixed(0) + ' years will not buy what ' + money(input.target) +
      ' buys today. This tool does not model inflation, so if you want the goal to hold its ' +
      'purchasing power, raise the target yourself before planning against it.') + '</div>';

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
      '</div>';

    out.innerHTML = html;
  }

  /* ================================================ ROLLING RETURN RENDERER */

  var RATE_DATA = {};

  function renderRolling(series, years, meta, compareSeries, compareName, prefix, compareMeta) {
    var r = E.rollingReturns(series, years);
    if (!r.ok) return notice('bad', esc(r.message));
    var s = r.stats;
    var below = r.values.filter(function (v) { return v < 0; }).length;
    var key = prefix || 'x';
    RATE_DATA[key] = r.values;
    var html = '';

    /* The book's rule for trusting this page at all: the history should be at
     * least three years longer than the window. Any less and every row starts
     * inside a narrow band of dates, so the table is one short stretch of
     * market measured over and over with its edges moved a little. The range it
     * prints then comes from one period of history, and many periods is the
     * entire point of the page. */
    var spanYears = (series[series.length - 1].t - series[0].t) / (365.2425 * 86400000);
    if (spanYears < years + 3) {
      html += notice('bad',
        '<strong>Read this range with suspicion.</strong> This data covers ' + spanYears.toFixed(1) +
        ' years and you have asked for ' + years + '-year windows, so every window here begins inside a ' +
        'band of about ' + Math.max(0, spanYears - years).toFixed(1) + ' years. They are not independent ' +
        'stretches of market &mdash; they are one stretch measured over and over with its edges moved a ' +
        'little. Three years of spare history is roughly the least it takes for windows to begin in ' +
        'genuinely different markets. Shorten the window, or load a longer history.');
    }

    html += '<div class="result"><div class="label">Median ' + years + '-year return, % a year</div>' +
      '<div class="value">' + pct(s.median) + '</div>' +
      '<div class="sub">' + esc(meta.name) + ' \u00b7 the middle of ' + s.count.toLocaleString() +
      ' overlapping holding periods, ' + fmtDate(series[0].t) + ' to ' +
      fmtDate(series[series.length - 1].t) + '. Half did better, half did worse.</div></div>';

    /* Worst to best across the quartiles, in that order. An average put at the
     * top of a screen becomes the number people remember, and it hides the
     * spread that actually decided what any one investor got. */
    html += '<div class="card"><h2>The range, not the average</h2>' +
      '<p class="hint" style="margin:0 0 .8rem"><strong>Read the worst figure first.</strong> It is what ' +
      'this market did over your holding period at its most unkind, and nobody tells you in advance ' +
      'which stretch you are walking into. Read the average last, and never on its own &mdash; on its ' +
      'own it is one more single number, which is the very thing this page exists to replace.</p>' +
      '<div class="scroll"><table class="data spread">' +
      '<caption>Annualised return, % a year, over every ' + years + '-year holding period</caption>' +
      '<thead><tr>' +
      '<th>Worst</th><th>Bottom quarter</th><th>Median</th><th>Top quarter</th><th>Best</th>' +
      '</tr></thead><tbody><tr>' +
      '<td>' + pct(s.min) + '</td><td>' + pct(s.p25) + '</td><td><strong>' + pct(s.median) +
      '</strong></td><td>' + pct(s.p75) + '</td><td>' + pct(s.max) + '</td>' +
      '</tr></tbody></table></div>' +
      '<p class="hint" style="margin:.5rem 0 1rem">A quarter of periods fell below ' +
      pct(s.p25) + ', and a quarter came in above ' + pct(s.p75) + '. The spread is what decided ' +
      'what any one investor actually got.</p>' +
      '<div class="stats">' +
      stat('Holding periods measured', s.count.toLocaleString()) +
      /* Counts, not shares. A share reads as a property of the fund when it is
       * really a property of the dates this file happens to start and end on. */
      stat('Ended below zero', below.toLocaleString() + ' of ' + s.count.toLocaleString()) +
      stat('Ended above zero', (s.count - below).toLocaleString() + ' of ' + s.count.toLocaleString()) +
      '</div>' + A.histogramChart(r.values, {
        years: years,
        caption: 'Each bar counts the ' + years + '-year periods that ended in that range'
      }) + '</div>';

    html += worstIsNotWorstCard(series, s, years);
    html += startDateCard(r, years);
    html += drawdownCard(series);
    html += rateCheckCard(key, years, r.values);

    if (compareSeries) {
      html += comparisonCards(series, compareSeries, years, meta.name, compareName, compareMeta);
    }

    html += '<div class="meaning"><h3>What this means</h3>' +
      '<p>Someone who invested at the worst possible moment in this data and held for ' + years +
      ' years earned <strong>' + pct(s.min) + ' a year</strong>. Someone who started at the best moment ' +
      'earned <strong>' + pct(s.max) + '</strong>. Same market, same holding period — the only difference ' +
      'was the day they started.</p>' +
      '<p>Of the ' + s.count.toLocaleString() + ' periods measured, ' + below.toLocaleString() +
      ' ended below zero. That count depends on the dates this file happens to cover, so read it as ' +
      'a count of what is in front of you, not as a property of the fund.</p></div>';

    html += '<div class="meaning"><h3>What it does not mean</h3>' +
      '<p>This is what already happened, over the dates in this file and no others. It is not a forecast, ' +
      'not a promise, and not a claim that the next ' + years + ' years will land inside this range.</p>' +
      '<p>Periods overlap, so they are not independent samples. And the median is not a typical experience ' +
      'anyone actually had — it is the middle of many possible starting days.</p></div>';

    html += trapsCard(years);

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

  /* The worst window in a file is only the worst of the years the file covers.
   * A history that begins after a crash has never been measured through one. */
  function worstIsNotWorstCard(series, s, years) {
    var firstT = series[0].t;
    var first = new Date(firstT);
    var startsAfter2008 = firstT > Date.UTC(2009, 5, 1);
    return '<div class="card"><h2>The worst here is not the worst possible</h2>' +
      '<p style="margin:0 0 .7rem;color:var(--ink-2)">The lowest figure on this page, ' +
      '<strong>' + pct(s.min) + ' a year</strong>, is the worst this data has ever produced over ' +
      years + ' years. It is not a floor. It is the worst of the years this file happens to cover, ' +
      'which begin on ' + fmtDate(firstT) + '.</p>' +
      (startsAfter2008
        ? '<p style="margin:0;color:var(--ink-2)">This history begins after the crash of 2008, so it ' +
          'has never been measured through that fall. Its worst window is the worst of a kinder era. ' +
          'Treat the figure above as the worst <em>so far</em>, not the worst there is.</p>'
        : '<p style="margin:0;color:var(--ink-2)">This history reaches back far enough to include the ' +
          'crash of 2008, so the worst figure above has been tested against one of the deepest falls ' +
          'this market has produced.</p>');
  }

  /* Four ways a published return misleads without anyone lying. Straight from
   * the chapter, because a reader who knows these cannot be sold with them. */
  function trapsCard(years) {
    return '<details class="explain card"><summary>Four traps in any published return</summary>' +
      '<div class="body"><dl>' +
      '<dt>The ' + years + '-year number changes while the fund does not</dt>' +
      '<dd>Both ends of the window move forward together. Most days that changes nothing, but when the ' +
      '<em>starting</em> day crosses a crash, the figure swings hard while the fund does nothing at all. ' +
      'In March 2020 the Sensex fell to about 26,000; five years later it stood near 78,000, so the ' +
      'five-year return read about 24% a year &mdash; measured from the bottom of a crash. Seventeen ' +
      'months on, the index was still near 78,000, but the starting day had moved to a market that had ' +
      'already recovered to about 55,500, and the same five-year return read about 7%. The market went ' +
      'nowhere. The starting line moved. When a fund you hold shows a sudden drop, check where the new ' +
      'number sits in the range above: inside it, what you saw was a good year leaving, not a bad year ' +
      'arriving. A sudden jump deserves the same suspicion.</dd>' +
      '<dt>Since launch depends on the launch date</dt>' +
      '<dd>Every other window slides forward daily. This one is pinned to the fund&rsquo;s first day ' +
      'forever. A fund born at the bottom of a crash spends its first years riding the recovery and ' +
      'looks brilliant for life; one born near a peak drags a poor figure for years. Put the ' +
      'since-launch figure beside the five- and ten-year figures. If it sits far from them, it is a ' +
      'fact about the fund&rsquo;s birthday, not about the fund.</dd>' +
      '<dt>The record stays when the manager leaves</dt>' +
      '<dd>A ten-year record can be the work of someone who left two years ago. The factsheet prints ' +
      'the date each manager took over, usually as <em>managing since</em>. If that date is recent, ' +
      'everything before it was somebody else&rsquo;s work.</dd>' +
      '<dt>The list you choose from has been cleaned</dt>' +
      '<dd>Funds that do badly for years are usually merged into better ones from the same house, and ' +
      'their record vanishes from every list and every average. So a category average is the average ' +
      'of the survivors, and every &ldquo;most funds beat the index&rdquo; claim counts only the funds ' +
      'that lived. Nothing brings them back and no page will footnote them, so carry the correction ' +
      'yourself: the true figure was a little worse.</dd>' +
      '</dl></div></details>';
  }

  /* Same holding period, same market, different starting day. This is the
   * question a single headline return cannot answer. */
  function startDateCard(r, years) {
    var spread = r.best.r - r.worst.r;
    return '<div class="card"><h2>Would it still look this way if you had started elsewhere?</h2>' +
      '<div class="scroll"><table class="data"><thead><tr><th></th><th>Starting on</th>' +
      '<th>Held until</th><th>You would have got</th></tr></thead><tbody>' +
      '<tr><td><strong>Best start</strong></td><td>' + fmtDate(r.best.t) + '</td><td>' +
      fmtDate(r.best.endT) + '</td><td>' + pct(r.best.r) + ' a year</td></tr>' +
      '<tr><td><strong>Worst start</strong></td><td>' + fmtDate(r.worst.t) + '</td><td>' +
      fmtDate(r.worst.endT) + '</td><td>' + pct(r.worst.r) + ' a year</td></tr>' +
      '</tbody></table></div>' +
      '<div class="meaning"><h3>What this means</h3>' +
      '<p>Both investors held for the same ' + years + ' years, in the same market. The only ' +
      'difference between them was the day they started, and that difference is worth <strong>' +
      pct(spread) + ' a year</strong>.</p>' +
      '<p>Nobody chooses their starting day on purpose. It is worth knowing how much of any ' +
      'headline return was decided by it.</p></div></div>';
  }

  /* A return says what was earned. This says what had to be sat through. */
  function drawdownCard(series) {
    var dd = E.maxDrawdown(series);
    if (!dd.ok || dd.depth === 0) return '';
    var html = '<div class="card"><h2>The worst fall along the way</h2><div class="stats">' +
      stat('Deepest fall', pct(dd.depth)) +
      stat('It began', fmtDate(dd.from.t)) +
      stat('It bottomed', fmtDate(dd.to.t)) +
      stat('Back to the old high', dd.recoveredOn ? fmtDate(dd.recoveredOn) : 'not yet in this data') +
      '</div>';
    html += '<div class="meaning"><h3>What this means</h3>';
    if (dd.recoveredOn) {
      html += '<p>Anyone holding through this watched <strong>' + pct(-dd.depth) + '</strong> of their ' +
        'money disappear over ' + Math.round(dd.fallDays / 30) + ' months, and waited a further <strong>' +
        Math.round(dd.recoveryDays / 30) + ' months</strong> just to get back to where they had already been.</p>';
    } else {
      html += '<p>The fall of <strong>' + pct(-dd.depth) + '</strong> had not been recovered by the end ' +
        'of this data.</p>';
    }
    html += '<p>Returns are earned by the people who were still there afterwards. This is the part ' +
      'of the record that decides who those people are.</p></div></div>';
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

  /* Every window both series can cover, paired by start date. One end-to-end
   * number can be an accident of where it started; how often one led the other
   * cannot. */
  function comparisonCards(series, compareSeries, years, name, compareName, compareMeta) {
    var c = E.compareRolling(series, compareSeries, years);
    if (!c.ok) {
      return '<div class="card">' + notice('bad', esc(c.message)) + '</div>';
    }
    var f = c.fund, b = c.bench;
    var html = '<div class="card"><h2>Against ' + esc(compareName) + '</h2>' +
      '<div class="result" style="margin:0 0 1rem"><div class="label">Periods where ' +
      esc(name) + ' came out ahead</div><div class="value">' + pct(c.fundAheadShare, 0) + '</div>' +
      '<div class="sub">' + c.fundAhead.toLocaleString() + ' of ' + c.pairs.toLocaleString() +
      ' matched ' + years + '-year periods, ' + fmtDate(c.from) + ' to ' + fmtDate(c.to) + '</div></div>' +
      '<div class="scroll"><table class="data"><thead><tr><th>Over ' + years + ' years</th><th>' +
      esc(name) + '</th><th>' + esc(compareName) + '</th></tr></thead><tbody>' +
      cmp('Worst period', f.min, b.min) +
      cmp('25th percentile', f.p25, b.p25) +
      cmp('Median period', f.median, b.median) +
      cmp('75th percentile', f.p75, b.p75) +
      cmp('Best period', f.max, b.max) +
      cmp('Periods that made money', f.positiveShare, b.positiveShare) +
      '<tr><td>Periods compared</td><td>' + c.pairs.toLocaleString() + '</td><td>' +
      c.pairs.toLocaleString() + '</td></tr>' +
      '</tbody></table></div>' +
      '<div class="meaning"><h3>What this means</h3>' +
      '<p>Only periods that both sets of data cover are compared, so neither is judged on dates the ' +
      'other never saw. The gap in the median is ' +
      '<strong>' + (f.median >= b.median ? '+' : '') + ((f.median - b.median) * 100).toFixed(1) +
      ' percentage points</strong> a year.</p>' +
      '<p>Leading in ' + pct(c.fundAheadShare, 0) + ' of periods is a different statement from leading ' +
      'over one stretch. A fund can win on the dates you happen to look at and lose on most others.</p>' +
      '</div>' +
      (compareMeta ? '<div class="scroll" style="margin-top:.8rem"><table class="data"><tbody>' +
        '<tr><td>' + esc(compareName) + ' is</td><td>' + (compareMeta.kind === 'PRICE'
          ? 'a price index — dividends excluded' : 'a total return index — dividends included') +
        '</td></tr>' +
        (compareMeta.firstDate ? '<tr><td>Its own data covers</td><td>' + esc(compareMeta.firstDate) +
          ' to ' + esc(compareMeta.lastDate) + '</td></tr>' : '') +
        (compareMeta.source ? '<tr><td>Source</td><td>' + esc(compareMeta.source) + '</td></tr>' : '') +
        '</tbody></table></div>' : '') +
      '<div class="meaning"><h3>What it does not mean</h3>' +
      (compareMeta && compareMeta.kind === 'PRICE'
        ? '<p>This index excludes dividends while a fund\u2019s NAV includes them, so the fund is ' +
          'flattered here by roughly the market\u2019s dividend yield each year.</p>' : '') +
      '<p>A benchmark carries no costs, holds no cash and makes no decisions; a fund does all three. ' +
      'A benchmark comparison is a reference point, not proof that a fund is good or bad, and it says ' +
      'nothing about whether the fund suits you.</p></div></div>';

    return html + realityCheck(series, compareSeries, c, name, compareName);
  }

  /* Four plain judgements, each with the rule that produced it written out, so
   * a reader can disagree with the rule rather than the label. */
  function realityCheck(series, compareSeries, c, name, compareName) {
    var medianGap = c.fund.median - c.bench.median;
    var fundDD = E.maxDrawdown(series), benchDD = E.maxDrawdown(compareSeries);
    var ddGap = (fundDD.ok && benchDD.ok) ? fundDD.depth - benchDD.depth : null;
    var overlapYears = (c.to - c.from) / (365.2425 * 86400000);

    var rows = [
      ['Return', grade(medianGap >= 0.01 ? 'Ahead' : medianGap <= -0.01 ? 'Behind' : 'Similar'),
       'Median ' + c.years + '-year return against ' + esc(compareName) + ', ' +
       (medianGap >= 0 ? '+' : '') + (medianGap * 100).toFixed(1) + ' points a year.'],
      ['Consistency', grade(c.fundAheadShare >= 0.66 ? 'Strong' : c.fundAheadShare >= 0.34 ? 'Mixed' : 'Weak'),
       'Came out ahead in ' + pct(c.fundAheadShare, 0) + ' of matched periods.'],
      ['Falls along the way', grade(ddGap === null ? 'Not measured' : ddGap >= 0.02 ? 'Shallower' :
        ddGap <= -0.02 ? 'Deeper' : 'Similar'),
       ddGap === null ? 'Not enough data to measure.' :
        'Worst fall ' + pct(fundDD.depth) + ' against ' + pct(benchDD.depth) + '.'],
      ['Weight of evidence', grade(overlapYears >= 10 ? 'Strong' : overlapYears >= 5 ? 'Moderate' : 'Limited'),
       overlapYears.toFixed(1) + ' years of overlapping history, ' +
       c.pairs.toLocaleString() + ' periods compared.']
    ];

    return '<div class="card"><h2>Reality check</h2><div class="scroll">' +
      '<table class="data"><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td><strong>' + esc(r[1]) + '</strong></td><td>' +
          r[2] + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="meaning"><h3>Before you read anything into this</h3>' +
      '<p>Every line above is a description of what already happened over these dates, against this ' +
      'benchmark. None of it establishes that the fund is suitable for you, and none of it is a ' +
      'forecast.</p>' +
      '<p>Nothing here is a recommendation to buy, hold, sell or switch. Suitability depends on your ' +
      'goal, your horizon, what else you own and what you can sit through — none of which this tool ' +
      'knows.</p></div></div>';
  }

  /* the word carries the meaning, never a colour on its own */
  function grade(word) { return word; }

  function cmp(label, a, b) {
    return '<tr><td>' + esc(label) + '</td><td>' + pct(a) + '</td><td>' + pct(b) + '</td></tr>';
  }
  function binText(b) {
    if (b.from === -Infinity) return 'Worse than ' + pct(b.to, 0) + ' a year';
    if (b.to === Infinity) return 'Above ' + pct(b.from, 0) + ' a year';
    return pct(b.from, 0) + ' to ' + pct(b.to, 0) + ' a year';
  }

  /* =============================================================== ROLLING
   *
   * One module, one set of controls, two sources. Splitting "the market" and
   * "my fund" into separate screens made the same analysis look like two
   * different things and left the inputs scattered; this asks the four
   * questions the analysis actually needs, in order, with nothing hidden.
   */

  var R = {
    source: null,          /* 'index' | 'fund' */
    series: null,          /* everything available for the chosen source */
    name: '',
    meta: null,            /* bundled-index metadata, when there is any */
    report: null,          /* import report, when it came from a file */
    rows: null,            /* raw rows, kept so the scheme can be changed */
    schemes: null,
    years: 5,
    datesTouched: false,
    bundled: {},           /* name -> series, for the comparison list */
    ran: false
  };

  function setSource(source) {
    R.source = source;
    $$('#r-source .chip').forEach(function (c) {
      c.setAttribute('aria-checked', String(c.dataset.source === source));
    });
    $('#src-index').hidden = source !== 'index';
    $('#src-fund').hidden = source !== 'fund';
    $('#step-source').dataset.done = source ? 'yes' : 'no';
    var prompt = $('#r-source-prompt');
    if (prompt) {
      prompt.textContent = source ? ''
        : 'Pick one of the two above to begin. The rest of this screen unlocks once you do.';
    }
  }

  /* Everything downstream of "what am I analysing" stays visible but inert
     until there is something to analyse, so nobody has to discover a control
     that only appears once they guess the right first move. */
  function setLoaded(series, name, opts) {
    var o = opts || {};
    R.series = series;
    R.name = name;
    R.meta = o.meta || null;
    R.report = o.report || null;

    var first = series[0].t, last = series[series.length - 1].t;
    var lo = isoOf(first), hi = isoOf(last);
    ['r-start', 'r-end'].forEach(function (id) {
      var el = $('#' + id);
      el.disabled = false;
      el.min = lo;
      el.max = hi;
    });
    /* keep dates the reader chose; replace dates this screen filled in itself */
    var reset = false;
    ['r-start', 'r-end'].forEach(function (id) {
      var el = $('#' + id);
      var v = el.value;
      var mine = R.datesTouched && v && v >= lo && v <= hi;
      if (!mine) { el.value = (id === 'r-start' ? lo : hi); if (v && R.datesTouched) reset = true; }
    });
    $('#r-all').disabled = false;
    $('#r-run').disabled = false;
    var spanYears = (last - first) / (365.2425 * 86400000);
    $('#r-range').textContent = 'Data available: ' + fmtDate(first) + ' to ' + fmtDate(last) +
      ' \u2014 ' + spanYears.toFixed(1) + ' years, ' + series.length.toLocaleString() +
      ' observations.';
    limitYears(selectedSpanYears());
    updateWindowNote();
    $('#step-period').dataset.done = 'yes';

    $('#r-loaded').innerHTML = notice('ok', 'Ready to analyse <strong>' + esc(name) + '</strong>.' +
      (reset ? ' Your dates fell outside this data, so they have been set to its full range.' : '') +
      (o.note ? ' ' + o.note : ''));
    refreshCompare();
    if (R.ran) runRolling();
  }

  function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }

  /* How much history the reader's own dates leave, which is what the holding
   * period has to fit inside -- not the span of the whole file. */
  function selectedSpanYears() {
    if (!R.series) return null;
    var from = A.isoToTs($('#r-start').value), to = A.isoToTs($('#r-end').value);
    if (isNaN(from) || isNaN(to) || to <= from) return null;
    return (to - from) / (365.2425 * 86400000);
  }

  function updateWindowNote() {
    var note = $('#r-window-note');
    if (!note) return;
    var to = A.isoToTs($('#r-end').value), from = A.isoToTs($('#r-start').value);
    if (!R.series || isNaN(to) || isNaN(from) || to <= from) { note.textContent = ''; return; }
    var lastStart = E.addYears(to, -R.years);
    note.textContent = lastStart <= from
      ? 'These dates leave less than one ' + R.years + '-year holding period.'
      : 'With a ' + R.years + '-year holding period, start dates from ' + fmtDate(from) +
        ' to ' + fmtDate(lastStart) + ' are measured.';
  }

  function clearLoaded(message) {
    R.series = null; R.name = ''; R.meta = null; R.report = null;
    ['r-start', 'r-end'].forEach(function (id) { $('#' + id).disabled = true; $('#' + id).value = ''; });
    $('#r-all').disabled = true;
    $('#r-run').disabled = true;
    limitYears(null);
    $('#step-period').dataset.done = 'no';
    $('#step-hold').dataset.done = 'no';
    $('#r-range').textContent = 'Choose something to analyse first.';
    var note = $('#r-window-note');
    if (note) note.textContent = '';
    $('#r-out').innerHTML = '';
    if (message) $('#r-loaded').innerHTML = message;
  }

  /* ---------------------------------------------------------------- index */

  function loadIndexList() {
    var sel = $('#r-index');
    fetch('data/benchmarks.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var list = (data && data.benchmarks) || [];
        R.indexList = list;
        if (data && data.asOf) $('#asof').textContent = 'through ' + data.asOf;
        if (!list.length) {
          sel.innerHTML = '<option value="">No index is bundled with this version</option>';
          sel.disabled = true;
          $('#r-index-hint').textContent = '';
          $('#r-index-upload').innerHTML =
            notice('', '<strong>No market data is bundled with this version.</strong> Nothing has ' +
              'been invented to fill the gap: a guessed-at index would produce confident numbers ' +
              'about a market that never existed. Load an official index file and every measurement ' +
              'on this screen works exactly the same way.') +
            '<label class="fieldlabel" for="bm-pick">Index data file</label>' +
            '<div class="filebox" id="bm-drop" tabindex="0" role="button" aria-label="Choose an index file">' +
            '<button class="secondary" type="button" id="bm-pick">Choose a file</button>' +
            '<p>A date column and the index value on that date</p></div>' +
            '<input type="file" id="bm-file" accept=".csv,.txt,.xlsx">';
          A.wireDrop('bm-drop', 'bm-file', 'bm-pick', function (file) { loadIndexFile(file); });
          return;
        }
        sel.disabled = false;
        sel.innerHTML = '<option value="">Choose an index…</option>' +
          list.map(function (b, i) {
            return '<option value="' + i + '">' + esc(b.name) + '</option>';
          }).join('');
        sel.addEventListener('change', function () {
          if (sel.value === '') { clearLoaded(''); return; }
          var b = list[+sel.value];
          var series = seriesOf(b);
          R.bundled[b.name] = series;
          $('#r-index-hint').textContent =
            (b.kind === 'PRICE' ? 'Price index — dividends are not included.'
                                : 'Total Return Index — dividends included.') +
            ' ' + b.firstDate + ' to ' + b.lastDate + '.';
          setLoaded(series, b.name, { meta: b, note: agingNote(b.lastDate) });
        });
      });
  }

  /* Bundled data does not update itself. Once it is materially behind, say so
   * in years rather than leaving a date for the reader to do the arithmetic on. */
  function agingNote(lastDate) {
    var last = A.isoToTs(lastDate);
    if (isNaN(last)) return '';
    var months = (Date.now() - last) / (30.44 * 86400000);
    if (months < 9) return '';
    var years = months / 12;
    return 'This data ends ' + fmtDate(last) + ', about ' +
      (years >= 1.5 ? years.toFixed(0) + ' years' : Math.round(months) + ' months') +
      ' ago, and describes the market only up to then. Load a current index file to bring it forward.';
  }

  function seriesOf(b) {
    return b.series.map(function (p) { return { t: A.isoToTs(p[0]), v: p[1] }; })
      .filter(function (p) { return !isNaN(p.t) && p.v > 0; })
      .sort(function (x, y) { return x.t - y.t; });
  }

  function loadIndexFile(file) {
    A.readFile(file, function (res) {
      var name = res.report.scheme || file.name.replace(/\.[^.]+$/, '');
      R.bundled[name] = res.series;
      setLoaded(res.series, name, { report: res.report });
    }, function (msg) { clearLoaded(notice('bad', esc(msg))); },
    function (progress) { $('#r-loaded').innerHTML = notice('', esc(progress)); });
  }

  /* ----------------------------------------------------------------- fund */

  function loadFundFile(file) {
    A.readFile(file, function (res) {
      R.rows = res.rows || null;
      R.schemes = null;
      $('#r-scheme-wrap').hidden = true;
      setLoaded(res.series, res.report.scheme || file.name.replace(/\.[^.]+$/, ''),
                { report: res.report });
    }, function (msg, extra) {
      /* one file, many schemes: let the reader pick theirs out of it */
      if (extra && extra.schemes && extra.rows) {
        R.rows = extra.rows;
        R.schemes = extra.schemes;
        showSchemePicker(extra.schemes);
        clearLoaded(notice('', 'That file holds <strong>' + extra.schemes.length +
          '</strong> funds. Choose yours below.'));
        return;
      }
      $('#r-scheme-wrap').hidden = true;
      clearLoaded(notice('bad', esc(msg)));
    }, function (progress) {
      $('#r-loaded').innerHTML = notice('', esc(progress));
    });
  }

  /* Thousands of funds cannot be chosen from a dropdown on a phone. Filter as
   * they type, cap what is drawn, and say how many more are waiting. */
  var MAX_HITS = 40;

  function showSchemePicker(schemes) {
    var wrap = $('#r-scheme-wrap'), q = $('#r-scheme-q');
    wrap.hidden = false;
    q.value = '';
    render('');
    q.oninput = function () { render(q.value); };
    q.focus();

    function render(term) {
      var needle = term.trim().toLowerCase();
      var hits = needle
        ? schemes.filter(function (sc) { return sc.name.toLowerCase().indexOf(needle) !== -1; })
        : schemes;
      $('#r-scheme-count').textContent = schemes.length.toLocaleString() +
        (schemes.length === 1 ? ' fund in this file' : ' funds in this file') +
        (needle ? ' \u00b7 ' + hits.length.toLocaleString() + ' match' + (hits.length === 1 ? '' : 'es')
                : ' \u2014 type to narrow the list');

      var list = $('#r-scheme-list');
      if (!hits.length) {
        list.innerHTML = '<p class="more">Nothing matches \u201c' + esc(term) + '\u201d.</p>';
        return;
      }
      list.innerHTML = hits.slice(0, MAX_HITS).map(function (sc, i) {
        /* rows are prices, not calendar days: a fund has no price at a weekend */
        var count = sc.rows === 1 ? 'one price only' : sc.rows.toLocaleString() + ' prices';
        return '<button class="hit" type="button" role="option" aria-selected="false" ' +
          'data-i="' + i + '"><span class="nm">' + esc(sc.name) + '</span>' +
          '<span class="sub">' + fmtDate(sc.first) + ' to ' + fmtDate(sc.last) +
          ' \u00b7 ' + count + '</span></button>';
      }).join('') +
        (hits.length > MAX_HITS
          ? '<p class="more">' + (hits.length - MAX_HITS).toLocaleString() +
            ' more \u2014 keep typing to narrow them down.</p>'
          : '');

      $$('#r-scheme-list .hit').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var sc = hits[+btn.dataset.i];
          $$('#r-scheme-list .hit').forEach(function (o) { o.setAttribute('aria-selected', 'false'); });
          btn.setAttribute('aria-selected', 'true');
          choose(sc);
        });
      });
    }

    function choose(sc) {
      var res = P.rowsToSeries(R.rows, { scheme: sc.name });
      if (!res.ok) { clearLoaded(notice('bad', esc(res.message))); return; }
      setLoaded(res.series, sc.name, { report: res.report });
    }
  }

  /* ------------------------------------------------------------- controls */

  function refreshCompare() {
    var sel = $('#r-compare');
    var keep = sel.value;
    var names = Object.keys(R.bundled).filter(function (n) { return n !== R.name; });
    (R.indexList || []).forEach(function (b) {
      if (b.name !== R.name && names.indexOf(b.name) === -1) names.push(b.name);
    });
    sel.innerHTML = '<option value="none">Nothing — just what I chose above</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    if (names.indexOf(keep) !== -1) sel.value = keep;
    sel.disabled = !names.length;
    $('#step-compare').dataset.done = sel.value !== 'none' ? 'yes' : 'no';

    var hint = $('#r-compare-hint'), box = $('#r-compare-upload');
    if (!names.length) {
      hint.textContent = 'Nothing to compare against yet. This version bundles no index data, ' +
        'so load an index file here and it becomes available as a benchmark.';
      if (!$('#cmp-file')) {
        box.innerHTML =
          '<label class="fieldlabel" for="cmp-pick">Index data file</label>' +
          '<div class="filebox" id="cmp-drop" tabindex="0" role="button" aria-label="Choose an index file">' +
          '<button class="secondary" type="button" id="cmp-pick">Choose a file</button>' +
          '<p>A date column and the index value on that date</p></div>' +
          '<input type="file" id="cmp-file" accept=".csv,.txt,.xlsx">';
        A.wireDrop('cmp-drop', 'cmp-file', 'cmp-pick', function (file) {
          A.readFile(file, function (res) {
            var nm = res.report.scheme || file.name.replace(/\.[^.]+$/, '');
            R.bundled[nm] = res.series;
            refreshCompare();
            $('#r-compare').value = nm;
            $('#step-compare').dataset.done = 'yes';
            if (R.ran) runRolling();
          }, function (msg) { box.innerHTML += notice('bad', esc(msg)); });
        });
      }
    } else {
      hint.textContent = 'A benchmark is a reference point, not a verdict. Only dates both sets ' +
        'of data cover are compared.';
      box.innerHTML = '';
    }
  }

  function compareSeries() {
    var sel = $('#r-compare');
    var name = sel.value;
    if (!name || name === 'none') return null;
    var bMeta = (R.indexList || []).filter(function (x) { return x.name === name; })[0] || null;
    if (R.bundled[name]) return { name: name, series: R.bundled[name], meta: bMeta };
    var b = (R.indexList || []).filter(function (x) { return x.name === name; })[0];
    if (!b) return null;
    R.bundled[name] = seriesOf(b);
    return { name: name, series: R.bundled[name], meta: b };
  }

  function yearChips() {
    var box = $('#r-years');
    box.innerHTML = '';
    A.HORIZONS.forEach(function (h) {
      var b = A.el('button', { class: 'chip', type: 'button', role: 'radio',
                               'aria-checked': String(h === R.years) });
      b.dataset.years = h;
      b.textContent = h + (h === 1 ? ' year' : ' years');
      b.addEventListener('click', function () {
        if (b.disabled) return;
        R.years = h;
        $$('#r-years .chip').forEach(function (c) {
          c.setAttribute('aria-checked', String(c === b));
        });
        $('#step-hold').dataset.done = 'yes';
        updateWindowNote();
        if (R.ran) runRolling();
      });
      box.appendChild(b);
    });
  }

  /* Offering "10 years" on a three-year file invites a reader to choose it and
   * only then be told no. Say it on the chip instead. */
  function limitYears(spanYears) {
    var best = null;
    $$('#r-years .chip').forEach(function (c) {
      var h = +c.dataset.years;
      var possible = spanYears == null || h <= spanYears;
      c.disabled = !possible;
      c.textContent = h + (h === 1 ? ' year' : ' years') +
        (possible ? '' : ' \u2014 needs ' + h + ' years of data');
      if (possible) best = h;
    });
    if (best !== null && R.years > best) {
      R.years = best;
      $$('#r-years .chip').forEach(function (c) {
        c.setAttribute('aria-checked', String(+c.dataset.years === best));
      });
    }
  }

  /* -------------------------------------------------------------- the run */

  function runRolling() {
    var out = $('#r-out');
    if (!R.series) { out.innerHTML = notice('bad', 'Choose something to analyse first.'); return; }

    var from = A.isoToTs($('#r-start').value);
    var to = A.isoToTs($('#r-end').value);
    if (isNaN(from) || isNaN(to)) {
      out.innerHTML = notice('bad', 'Enter both a start date and an end date.');
      return;
    }
    if (from >= to) {
      out.innerHTML = notice('bad', 'The end date must be after the start date.');
      return;
    }
    var series = P.sliceSeries(R.series, from, to);
    if (series.length < 2) {
      out.innerHTML = notice('bad', 'There is no data between those two dates.');
      return;
    }
    /* Report the dates the data actually reaches, never the ones typed: a
       weekend or a holiday would otherwise put two different periods on one
       screen. */
    var usedFrom = series[0].t, usedTo = series[series.length - 1].t;
    var span = (usedTo - usedFrom) / (365.2425 * 86400000);
    if (span < R.years) {
      out.innerHTML = notice('bad', 'That leaves ' + span.toFixed(1) + ' years of history, and each ' +
        'holding period is ' + R.years + ' years long. Widen the dates, or choose a shorter holding ' +
        'period.');
      return;
    }
    var against = compareSeries();
    var cmpSeries = against ? P.sliceSeries(against.series, from, to) : null;
    var warning = '';
    if (against && cmpSeries.length < 2) {
      cmpSeries = null;
      warning = notice('bad', esc(against.name) + ' has no data between those dates, so no ' +
        'comparison is shown. Widen the dates, or choose a different benchmark.');
    }

    R.ran = true;
    out.innerHTML = warning +
      periodCard(from, to, usedFrom, usedTo, R.years, R.name) +
      (R.meta ? datasetCard(R.meta, series) : '') +
      (R.report ? importReport(R.report, R.name) : '') +
      renderRolling(series, R.years, { name: R.name },
                    cmpSeries, against ? against.name : '', 'rolling',
                    against ? against.meta : null);
    out.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* What was actually measured, stated before any result. */
  function periodCard(from, to, usedFrom, usedTo, years, name) {
    var drifted = Math.abs(dayGap(from, usedFrom)) > 3 || Math.abs(dayGap(to, usedTo)) > 3;
    var lastStart = E.addYears(usedTo, -years);
    return '<div class="card"><h2>What was measured</h2><div class="scroll">' +
      '<table class="data"><tbody>' +
      '<tr><td>Fund or index</td><td>' + esc(name) + '</td></tr>' +
      '<tr><td>History searched</td><td>' + fmtDate(usedFrom) + ' to ' + fmtDate(usedTo) + '</td></tr>' +
      (drifted
        ? '<tr><td>You asked for</td><td>' + fmtDate(from) + ' to ' + fmtDate(to) +
          '; the nearest data is above</td></tr>'
        : '') +
      '<tr><td>Each holding period</td><td>' + years + (years === 1 ? ' year' : ' years') + '</td></tr>' +
      '<tr><td>Start dates measured</td><td>' + fmtDate(usedFrom) + ' to ' + fmtDate(lastStart) +
      '</td></tr>' +
      '</tbody></table></div>' +
      '<p class="hint" style="margin:.6rem 0 0">A holding period cannot start later than ' +
      fmtDate(lastStart) + ', because there would not be ' + years +
      (years === 1 ? ' year' : ' years') + ' of history left to measure it over.</p></div>';
  }

  function dayGap(a, b) { return Math.round((b - a) / 86400000); }

  /* Where the numbers came from, and what they can and cannot be read as. */
  function datasetCard(meta, series) {
    if (!meta) return '';
    var first = fmtDate(series[0].t), last = fmtDate(series[series.length - 1].t);
    return '<div class="card"><h2>About this data</h2><div class="scroll">' +
      '<table class="data"><tbody>' +
      '<tr><td>Series</td><td>' + esc(meta.name) + '</td></tr>' +
      '<tr><td>Type</td><td>' + (meta.kind === 'PRICE'
        ? 'Price index, dividends excluded' : 'Total Return Index, dividends included') + '</td></tr>' +
      '<tr><td>Bundled range</td><td>' + esc(meta.firstDate || '') + ' to ' + esc(meta.lastDate || '') + '</td></tr>' +
      (meta.source ? '<tr><td>Source</td><td>' + esc(meta.source) + '</td></tr>' : '') +
      (meta.licence ? '<tr><td>Used under</td><td>' + esc(meta.licence) + '</td></tr>' : '') +
      (meta.note ? '<tr><td>Note</td><td>' + esc(meta.note) + '</td></tr>' : '') +
      '</tbody></table></div>' +
      '<div class="meaning"><h3>What these results describe</h3>' +
      '<p>Everything below is calculated from this dataset and no other. It describes what happened ' +
      'between <strong>' + first + '</strong> and <strong>' + last + '</strong>, and nothing outside ' +
      'those dates.</p>' +
      '<p>This data is fixed, not live. It does not update itself, and nothing in it forecasts what ' +
      'comes next.</p></div></div>';
  }

  /* The search journey exists only when a provider does. A dead search box that
   * never returns anything is worse than no search box: it makes the tool look
   * broken rather than deliberately simple. */
  function wireFundSearch() {
    var provider = window.PRCProvider && window.PRCProvider.get();
    var card = $('#f-search-card');
    /* a missing element must never take the rest of init down with it */
    if (!provider || !card) return;
    card.hidden = false;

    function search() {
      var q = $('#f-query').value.trim();
      var out = $('#f-results');
      if (q.length < 3) {
        out.innerHTML = notice('', 'Type at least three letters of the scheme name.');
        return;
      }
      out.innerHTML = notice('', 'Looking\u2026');
      Promise.resolve()
        .then(function () { return provider.search(q); })
        .then(function (matches) {
          if (!matches || !matches.length) {
            out.innerHTML = notice('bad', 'Nothing matched \u201c' + esc(q) + '\u201d. Check the ' +
              'spelling, or load the fund\u2019s NAV file below \u2014 that works for every fund.');
            return;
          }
          /* §18: show enough to tell near-identical schemes apart */
          out.innerHTML = '<p class="hint" style="margin:.8rem 0 .4rem">' + matches.length +
            ' match' + (matches.length === 1 ? '' : 'es') + '. Check the plan and option before ' +
            'choosing \u2014 schemes with almost the same name behave differently.</p>' +
            '<div class="rows">' + matches.slice(0, 25).map(function (m, i) {
              return '<button class="tile" type="button" data-pick="' + i + '">' +
                '<h2 style="font-size:1rem">' + esc(m.name) + '</h2><p>' +
                [m.plan, m.option, m.identifier].filter(Boolean).map(esc).join(' \u00b7 ') +
                '</p></button>';
            }).join('') + '</div>';
          $$('#f-results [data-pick]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              choose(matches[+btn.dataset.pick]);
            });
          });
        })
        .catch(function (err) {
          out.innerHTML = notice('bad', 'The fund lookup could not be reached (' +
            esc(err && err.message ? err.message : 'no reply') + '). Load the fund\u2019s NAV ' +
            'file below instead \u2014 it needs no connection to anything.');
        });
    }

    function choose(match) {
      var out = $('#f-results');
      out.innerHTML = notice('', 'Fetching the history for ' + esc(match.name) + '\u2026');
      Promise.resolve()
        .then(function () { return provider.history(match.id); })
        .then(function (rows) {
          /* the same validation an uploaded file gets, so an automatically
             fetched fund is held to exactly the same standard */
          var res = P.rowsToSeries(rows);
          if (!res.ok) {
            /* the validator's wording assumes a file; this did not come from one */
            out.innerHTML = notice('bad',
              'The history that came back for ' + esc(match.name) + ' could not be used. ' +
              esc(res.message).replace('That file has', 'It has').replace('That file', 'It') +
              ' This came from the lookup service, not from you \u2014 loading the fund\u2019s own ' +
              'NAV file below will usually work.');
            return;
          }
          out.innerHTML = '';
          setLoaded(res.series, match.name, { report: res.report });
        })
        .catch(function (err) {
          out.innerHTML = notice('bad', 'That fund\u2019s history could not be fetched (' +
            esc(err && err.message ? err.message : 'no reply') + '). Load its NAV file below instead.');
        });
    }

    $('#f-search').addEventListener('click', search);
    $('#f-query').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); search(); }
    });
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
    if ($('#sheetver')) $('#sheetver').textContent = A.SHEET_VERSION;

    /* portfolio */
    for (var i = 0; i < 3; i++) addRow({});
    addRow({ date: A.isoToday(), kind: 'Worth today' });
    $('#pf-add').addEventListener('click', function () { addRow({}); });
    $('#pf-sip').addEventListener('click', function () { toggleSip($('#sip-builder').hidden); });
    $('#sip-add').addEventListener('click', addSipRows);
    $('#sip-cancel').addEventListener('click', function () { toggleSip(false); });
    $('#pf-demo').addEventListener('click', fillExample);
    $('#pf-clear').addEventListener('click', function () {
      $('#pf-rows').innerHTML = ''; $('#pf-out').innerHTML = '';
      for (var k = 0; k < 3; k++) addRow({});
      addRow({ date: A.isoToday(), kind: 'Worth today' });
    });
    $('#pf-group').addEventListener('change', function () { if ($('#pf-out').innerHTML) calcPortfolio(); });
    $('#pf-calc').addEventListener('click', calcPortfolio);
    $('#pf-export').addEventListener('click', exportRows);

    /* goal */
    ['g-target', 'g-current', 'g-sip'].forEach(function (id) {
      var input = $('#' + id), echo = $('#' + id + '-echo');
      if (!input || !echo) return;
      function say() {
        var v = parseFloat(input.value);
        /* Section 12's "not defects, worth keeping": this helper is exactly
           right and belongs under every rupee input. */
        var bad = A.checkInput('rupees', v);
        echo.textContent = input.value.trim() === '' ? ''
          : bad ? bad
          : A.echo(v);
        echo.classList.toggle('refuse', !!bad && input.value.trim() !== '');
      }
      input.addEventListener('input', say);
      say();
    });
    GOAL_FIELDS.forEach(function (f) {
      var el = $('#' + f.id);
      if (el) el.addEventListener('input', goalOutOfRange);
    });
    $('#g-calc').addEventListener('click', calcGoal);

    /* rolling returns: one module, four steps, nothing hidden */
    yearChips();
    loadIndexList();
    $$('#r-source .chip').forEach(function (c) {
      c.addEventListener('click', function () { resetSource(c.dataset.source); });
    });
    A.wireDrop('f-drop', 'f-file', 'f-pick', loadFundFile);
    try { wireFundSearch(); } catch (e) { /* optional; never fatal */ }
    $('#r-compare').addEventListener('change', function () {
      $('#step-compare').dataset.done = this.value !== 'none' ? 'yes' : 'no';
      if (R.ran) runRolling();
    });
    ['r-start', 'r-end'].forEach(function (id) {
      $('#' + id).addEventListener('change', function () {
        R.datesTouched = true;
        limitYears(selectedSpanYears());
        updateWindowNote();
        if (R.ran) runRolling();
      });
    });
    $('#r-all').addEventListener('click', function () {
      if (!R.series) return;
      $('#r-start').value = isoOf(R.series[0].t);
      $('#r-end').value = isoOf(R.series[R.series.length - 1].t);
      R.datesTouched = false;
      limitYears(selectedSpanYears());
      updateWindowNote();
      if (R.ran) runRolling();
    });
    $('#r-run').addEventListener('click', runRolling);
    refreshCompare();   /* disabled, and visibly so, until there is anything to compare with */
    applyPreset();
    $('#r-reset').addEventListener('click', function () {
      R.ran = false; R.rows = null; R.schemes = null;
      $('#r-scheme-wrap').hidden = true;
      $('#r-compare').value = 'none';
      $('#step-compare').dataset.done = 'no';
      setSource(null);
      clearLoaded('');
      $('#r-loaded').innerHTML = '';
      $('#r-index').value = '';
      refreshCompare();
    });
  }

  window.PRCRolling = {
    preset: function (source) {
      if (!source) return;
      pendingSource = source;
      if ($('#r-source')) applyPreset();
    }
  };

  var pendingSource = null;
  function applyPreset() {
    if (!pendingSource) return;
    var next = pendingSource;
    pendingSource = null;
    if (next === R.source && R.series) return;   /* already there; keep their work */
    resetSource(next);
  }

  /* Switching source must never leave the other source's series loaded under a
   * label that no longer describes it. */
  function resetSource(next) {
    setSource(next);
    R.rows = null; R.schemes = null; R.ran = false; R.datesTouched = false;
    var scheme = $('#r-scheme-wrap');
    if (scheme) scheme.hidden = true;
    var idx = $('#r-index');
    if (idx) idx.value = '';
    /* forget the chosen file too, or re-choosing the same one looks like nothing
       happened: the browser fires no change event for an unchanged selection */
    ['f-file', 'bm-file'].forEach(function (id) {
      var input = $('#' + id);
      if (input) input.value = '';
    });
    var results = $('#f-results');
    if (results) results.innerHTML = '';
    clearLoaded('');
    $('#r-loaded').innerHTML = '';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
