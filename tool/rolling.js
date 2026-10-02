/* Where You Stand: Rolling returns.
 *
 * One path: a fund or an index to measure, and, if the reader wants, a second
 * file to measure it against. Every holding period of the chosen length, in
 * the order it happened. The first tab is the whole story in a few screens;
 * every other measure is a tab away.
 */
(function (root) {
  'use strict';
  var A = root.PRCApp, E = root.PRCEngine, P = root.PRCParse, D = root.PRCDoors, C = root.PRCCharts;
  var $ = A.$, $$ = A.$$, esc = A.esc, pct = A.pct, share = A.share, money = A.money, notice = A.notice, fmtDate = A.fmtDate;
  var stat = A.stat, term = A.term, fold = A.fold;

  var DEFAULT_YEARS = 3;
  var R = { a: null, b: null, bKind: null, years: DEFAULT_YEARS, frequency: 'daily', datesTouched: false, ran: false, blockMessage: null, doorA: null, doorB: null };
  var WINDOW_ROWS = null;
  root.PRCRateData = root.PRCRateData || {};
  root.PRCHorizonData = root.PRCHorizonData || {};

  function schemaGate(rows, name) {
    var v = P.checkSchema(rows, { slot: 'any' });
    if (v.ok) return null;
    var found = (v.detected || []).filter(Boolean).slice(0, 8);
    return notice('bad', esc(v.message) + (found.length ? ' <br>The columns found: <strong>' + found.map(function (n) { return esc(String(n)); }).join('</strong>, <strong>') + '</strong>.' : ''));
  }
  var TRI_RE = /\b(tri|total\s*returns?\s*index|total\s*returns?)\b/i, PRICE_RE = /\b(pri|price\s*returns?\s*index|price\s*returns?|price\s*index)\b/i;
  function guessKind(name, rows) {
    var t = String(name || '').replace(/[_.\-]+/g, ' ') + ' ' + (rows || []).slice(0, 3).map(function (r) { return (r || []).join(' '); }).join(' ');
    if (PRICE_RE.test(t) && !TRI_RE.test(t)) return 'PRICE';
    if (TRI_RE.test(t)) return 'TRI';
    return null;
  }

  /* ================================================================ step 1 */
  function mountDoors() {
    $('#r-a-howto').innerHTML = D.guide('any');
    $('#r-b-howto').innerHTML = D.guide('index');
    R.doorA = D.mount($('#r-a-door'), {
      prefix: 'ra', kind: 'any', noun: 'fund or index', label: 'The history file', hint: 'CSV, Excel or text · a date column and the NAV or index value on that date · several files of one history are joined',
      gate: schemaGate,
      onLoaded: function (res) { R.a = res; setLoaded(); }
    });
    R.doorB = D.mount($('#r-b-door'), {
      prefix: 'rb', kind: 'index', noun: 'fund or index', label: 'The file to compare against', hint: 'An index’s total return values, or another fund’s NAV history',
      gate: schemaGate,
      onLoaded: function (res) {
        R.b = res;
        R.bKind = res ? (res.kindGuess === 'nav' ? 'NAV' : guessKind(res.name, res.rows)) : null;
        drawKind(); setLoaded();
      }
    });
  }
  function drawKind() {
    var host = $('#r-b-kind');
    if (!R.b) { host.innerHTML = ''; return; }
    if (R.bKind === 'NAV') {
      host.innerHTML = notice('', 'This looks like a fund’s NAV history, so the comparison is fund against fund over the dates both files cover. Both sides carry their own costs.');
      return;
    }
    host.innerHTML = '<div class="field" style="margin-top:.8rem"><span class="fieldlabel" id="r-kind-label">Does <strong>' + esc(R.b.name) + '</strong> include dividends?</span>' +
      '<div class="chips" id="r-kind-chips" role="radiogroup" aria-labelledby="r-kind-label">' +
      ['TRI', 'PRICE'].map(function (k) { return '<button class="chip" type="button" role="radio" data-kind="' + k + '" aria-checked="' + (R.bKind === k) + '">' + (k === 'TRI' ? 'Total return index: dividends included' : 'Price index: dividends left out') + '</button>'; }).join('') +
      '</div><p class="hint" id="r-kind-why"></p></div>';
    $$('#r-kind-chips .chip').forEach(function (b) {
      b.addEventListener('click', function () { R.bKind = b.dataset.kind; $$('#r-kind-chips .chip').forEach(function (c) { c.setAttribute('aria-checked', String(c === b)); }); sayKind(); if (R.ran) runRolling(); });
    });
    sayKind();
  }
  function sayKind() {
    var why = $('#r-kind-why'); if (!why) return;
    why.textContent = R.bKind === 'PRICE' ? 'A price index leaves dividends out while a fund’s NAV puts them back in, so every gap below flatters the fund by about the index’s dividend yield each year. Use the total return version if the provider offers one.'
      : R.bKind === 'TRI' ? 'Dividends are counted on both sides, so the comparison is like for like.' + (guessKind(R.b.name) === 'TRI' ? ' Read from the file’s name; change it if that is wrong.' : '')
      : 'Not established. Until you say, the figures cannot tell whether a gap is real or only the dividends the index leaves out. The download page names which report you took.';
  }

  function setLoaded() {
    var a = R.a;
    if (!a) { clearLoaded(); return; }
    var series = a.series, first = series[0].t, last = series[series.length - 1].t;
    var lo = A.isoOf(first), hi = A.isoOf(last);
    ['r-start', 'r-end'].forEach(function (id) { var el = $('#' + id); el.disabled = false; el.min = lo; el.max = hi; });
    var reset = false;
    ['r-start', 'r-end'].forEach(function (id) {
      var el = $('#' + id), v = el.value, mine = R.datesTouched && v && v >= lo && v <= hi;
      if (!mine) { el.value = (id === 'r-start' ? lo : hi); if (v && R.datesTouched) reset = true; }
    });
    $('#r-all').disabled = false; updateAllBtn();
    var spanYears = E.spanYearsOf(series);
    $('#r-range').textContent = 'Data available: ' + fmtDate(first) + ' to ' + fmtDate(last) + ', ' + floor1(spanYears) + ' years, ' + series.length.toLocaleString('en-IN') + ' observations.';
    if (!R.ran) $('#r-out').innerHTML = '';
    holdError(null);
    yearChips(); freqChips(); limitYears(selectedSpanYears()); updateWindowNote(); runGate();
    $('#step-period').dataset.done = 'yes';
    $('#step-source').dataset.done = 'yes'; $('#step-source').dataset.error = 'no';
    gateSteps();
    var gapDays = E.medianGapDays(series);
    var sparse = (gapDays != null && gapDays > 7) ? ' This file holds a value about every ' + Math.round(gapDays) + ' days, so rolling periods can only start on the dates it has, and the figures will not be fine-grained.' : '';
    var lines = 'Ready to analyse <strong>' + esc(a.name) + '</strong>' + (R.b ? ' against <strong>' + esc(R.b.name) + '</strong>' : '') + '.' +
      (reset ? ' Your dates fell outside this data, so they have been set to its full range.' : '') + sparse;
    var ov = '';
    if (R.b) {
      var o = E.rangeOverlap(series, R.b.series);
      if (!o.ok) ov = notice('bad', '<strong>These two files share no dates.</strong> ' + esc(a.name) + ': ' + fmtDate(o.aFrom) + ' to ' + fmtDate(o.aTo) + '. ' + esc(R.b.name) + ': ' + fmtDate(o.bFrom) + ' to ' + fmtDate(o.bTo) + '. No comparison can be made from them.');
      else if (!o.full) ov = notice('warn', 'The comparison is restricted to the stretch both files cover, ' + fmtDate(o.from) + ' to ' + fmtDate(o.to) + ', ' + o.years.toFixed(1) + ' years.' + droppedPhrase(o));
      ov += classMismatchNote(a.name, R.b.name, series, R.b.series);
    }
    $('#r-loaded').innerHTML = notice(sparse ? 'warn' : 'ok', lines) + ov;
    if (R.ran) runRolling();
  }
  function droppedPhrase(o) {
    var bits = [];
    if (o.lostA >= 0.05) bits.push(o.lostA.toFixed(1) + ' years of the first file');
    if (o.lostB >= 0.05) bits.push(o.lostB.toFixed(1) + ' years of the second');
    return bits.length ? ' Outside it, ' + bits.join(' and ') + ' ' + (bits.length > 1 ? 'are' : 'is') + ' not used.' : '';
  }
  function clearLoaded() {
    ['r-start', 'r-end'].forEach(function (id) { $('#' + id).disabled = true; $('#' + id).value = ''; });
    $('#r-all').disabled = true; $('#r-all').hidden = false;
    limitYears(null); runGate();
    $('#step-period').dataset.done = 'no'; $('#step-hold').dataset.done = R.years === null ? 'no' : 'yes';
    holdError(null);
    $('#r-range').textContent = 'Load a file first.';
    $('#r-window-note').textContent = ''; $('#r-out').innerHTML = ''; $('#r-loaded').innerHTML = '';
    $('#step-source').dataset.done = 'no';
    gateSteps();
  }
  function selectedSpanYears() {
    if (!R.a) return null;
    var from = A.isoToTs($('#r-start').value), to = A.isoToTs($('#r-end').value);
    if (isNaN(from) || isNaN(to) || to <= from) return null;
    return (to - from) / (365.2425 * 86400000);
  }
  function updateWindowNote() {
    var note = $('#r-window-note');
    var to = A.isoToTs($('#r-end').value), from = A.isoToTs($('#r-start').value);
    if (!R.a || isNaN(to) || isNaN(from) || to <= from || R.years === null) { note.textContent = ''; return; }
    var lastStart = E.addYears(to, -R.years);
    note.textContent = lastStart <= from ? 'These dates leave less than one ' + R.years + '-year holding period.'
      : 'With a ' + R.years + '-year holding period, start dates from ' + fmtDate(from) + ' to ' + fmtDate(lastStart) + ' are measured.';
  }
  function updateAllBtn() {
    var b = $('#r-all');
    if (!R.a) { b.hidden = false; return; }
    b.hidden = $('#r-start').value === A.isoOf(R.a.series[0].t) && $('#r-end').value === A.isoOf(R.a.series[R.a.series.length - 1].t);
  }
  function gateSteps() {
    var have = !!R.a;
    ['#step-period', '#step-hold'].forEach(function (sel) {
      var card = $(sel);
      card.dataset.locked = have ? 'no' : 'yes';
      $$('input, select, button', card).forEach(function (el) { el.disabled = !have || el.dataset.infeasible === 'yes'; });
    });
    if (!have) $('#r-range').textContent = 'Load a file first.';
  }
  function holdError(message) {
    var step = $('#step-hold'), slot = $('#r-hold-error');
    if (!message) { step.dataset.error = 'no'; slot.hidden = true; slot.textContent = ''; return; }
    step.dataset.error = 'yes'; slot.hidden = false; slot.textContent = message;
    step.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function spanWarning() {
    var slot = $('#r-span-warn');
    if (!R.a || R.years === null) { slot.hidden = true; slot.textContent = ''; return; }
    var span = E.spanYearsOf(R.a.series), want = R.years + 3;
    if (span >= want) { slot.hidden = true; slot.textContent = ''; return; }
    slot.hidden = false;
    slot.textContent = 'This file covers ' + floor1(span) + ' years; a ' + R.years + '-year window wants at least ' + want + '. The figures will still be worked out, but every window will begin inside a narrow band of dates.';
  }
  function yearChips() {
    var box = $('#r-years');
    box.innerHTML = '';
    $('#step-hold').dataset.done = R.years === null ? 'no' : 'yes';
    var horizons = A.HORIZONS.slice(), extra = null;
    if (R.a) { var m = E.maxHorizon(R.a.series); if (m !== null && horizons.indexOf(m) === -1) { horizons.push(m); extra = m; } }
    horizons.sort(function (a, b) { return a - b; });
    horizons.forEach(function (h) {
      var b = A.el('button', { class: 'chip', type: 'button', role: 'radio', 'aria-checked': String(h === R.years) });
      b.dataset.years = h;
      if (h === extra) b.dataset.label = 'Longest the file allows: ' + h + ' years';
      b.textContent = chipLabel(b, h);
      b.addEventListener('click', function () {
        if (b.disabled) return;
        R.years = h;
        $$('#r-years .chip').forEach(function (c) { c.setAttribute('aria-checked', String(c === b)); });
        $('#step-hold').dataset.done = 'yes'; R.blockMessage = null; holdError(null); updateWindowNote(); spanWarning(); runGate();
        if (R.ran) runRolling(); else if (!R.blockMessage) $('#r-out').innerHTML = '';
      });
      box.appendChild(b);
    });
  }
  function chipLabel(chip, h) { return chip.dataset.label || (h + (h === 1 ? ' year' : ' years')); }
  function freqChips() {
    var box = $('#r-freq');
    box.innerHTML = '';
    var gap = R.a ? E.medianGapDays(R.a.series) : null;
    var can = { daily: gap == null || gap <= 3.5, weekly: gap == null || gap <= 10, monthly: true };
    if (!can[R.frequency]) R.frequency = can.weekly ? 'weekly' : 'monthly';
    var says = { daily: 'Daily (every start date)', weekly: 'Weekly', monthly: 'Monthly' };
    ['daily', 'weekly', 'monthly'].forEach(function (key) {
      var b = A.el('button', { class: 'chip', type: 'button', role: 'radio', 'aria-checked': String(key === R.frequency) });
      b.dataset.frequency = key; b.disabled = !can[key]; b.dataset.infeasible = can[key] ? 'no' : 'yes';
      b.textContent = can[key] ? says[key] : says[key] + ': this file has a value about every ' + Math.round(gap) + ' days';
      b.addEventListener('click', function () { if (b.disabled) return; R.frequency = key; $$('#r-freq .chip').forEach(function (c) { c.setAttribute('aria-checked', String(c === b)); }); if (R.ran) runRolling(); });
      box.appendChild(b);
    });
  }
  function limitYears(spanYears) {
    var best = null;
    R.blockMessage = null;
    $$('#r-years .chip').forEach(function (c) {
      var h = +c.dataset.years, possible = spanYears == null || h <= spanYears;
      c.dataset.infeasible = possible ? 'no' : 'yes'; c.disabled = !possible;
      c.textContent = chipLabel(c, h) + (possible ? '' : shortLabel(h, spanYears));
      if (possible) best = h;
    });
    if (R.years !== null && best !== null && R.years > best) {
      var wanted = R.years;
      R.years = null; $('#step-hold').dataset.done = 'no';
      $$('#r-years .chip').forEach(function (c) { c.setAttribute('aria-checked', 'false'); });
      R.blockMessage = notice('bad', '<strong>This history is shorter than the holding period.</strong> ' + (coverPhrase(spanYears, wanted) || 'It covers ' + spanYears.toFixed(1) + ' years and ' + wanted + '-year windows need ' + wanted + ', so not one full ' + wanted + '-year period fits inside it.') +
        ' ' + (best === null ? 'Load a longer history.' : 'Choose ' + best + (best === 1 ? ' year' : ' years') + ' or shorter in step 3, or load a longer history.'));
      $('#r-out').innerHTML = R.blockMessage;
    }
    spanWarning(); runGate();
  }
  function chosenDays(h) {
    var from = A.isoToTs($('#r-start').value), to = A.isoToTs($('#r-end').value);
    if (isNaN(from) || isNaN(to) || to <= from) return null;
    return { covered: Math.round((to - from) / 86400000), needed: Math.round((E.addYears(from, h) - from) / 86400000) };
  }
  function shortLabel(h, spanYears) {
    if (spanYears == null) return ': needs ' + h + ' years of data';
    if (h - spanYears < 1) {
      var d = chosenDays(h);
      var days = d ? d.needed - d.covered : Math.ceil((h - spanYears) * 365.2425 - 1e-9);
      days = Math.max(1, days);
      return ': ' + days.toLocaleString('en-IN') + (days === 1 ? ' day' : ' days') + ' short';
    }
    return ': needs ' + h + ' years of data';
  }
  function coverPhrase(spanYears, wanted) {
    if (spanYears == null || wanted - spanYears >= 1) return null;
    var d = chosenDays(wanted);
    var covered = d ? d.covered : Math.round(spanYears * 365.2425), needed = d ? d.needed : Math.round(wanted * 365.2425);
    return 'It covers ' + covered.toLocaleString('en-IN') + ' days; one ' + wanted + '-year window needs ' + needed.toLocaleString('en-IN') + '.';
  }
  function floor1(v) { return (Math.floor(v * 10 + 1e-9) / 10).toFixed(1); }
  function runGate() { $('#r-run').disabled = !(R.a && R.years !== null && selectedSpanYears() !== null); }

  /* ------------------------------------------- which kind of thing is it */
  var CLASS_WORDS = [
    ['debt', /\b(bond|debt|gilt|g[\s-]?sec|liquid|overnight|money\s*market|ultra\s*short|low\s*duration|short\s*duration|medium\s*duration|long\s*duration|dynamic\s*bond|corporate\s*bond|credit\s*risk|banking\s*(&|and)\s*psu|floater|floating\s*rate|treasury|arbitrage|savings\s*fund|income\s*fund|fixed\s*income)\b/i],
    ['gold', /\b(gold|silver|commodit)\w*\b/i],
    ['equity', /\b(equity|flexi[\s-]?cap|multi[\s-]?cap|large[\s-]?cap|mid[\s-]?cap|small[\s-]?cap|elss|bluechip|blue[\s-]?chip|focused|value\s*fund|contra|dividend\s*yield|midcap|smallcap|opportunities|index\s*fund|\d+\s*(tri|index))\b/i]
  ];
  function assetClassOf(name) { var n = String(name || ''); for (var i = 0; i < CLASS_WORDS.length; i++) if (CLASS_WORDS[i][1].test(n)) return CLASS_WORDS[i][0]; return null; }
  function classFromSigma(series) {
    var v = E.annualisedVolatility(series);
    if (!v.ok) return null;
    return { sigma: v.sigma, cls: v.sigma <= 0.06 ? 'debt' : v.sigma >= 0.12 ? 'equity' : null };
  }
  function classMismatchNote(name, compareName, series, compareSeries) {
    var a = assetClassOf(name), b = assetClassOf(compareName), how = [];
    if (a) how.push('<strong>' + esc(name) + '</strong> is read from its name as ' + a);
    if (b) how.push('<strong>' + esc(compareName) + '</strong> is read from its name as ' + b);
    if (!a) { var sa = classFromSigma(series); if (sa && sa.cls) { a = sa.cls; how.push('<strong>' + esc(name) + '</strong> moved with a volatility of ' + pct(sa.sigma, 1) + ', which reads as ' + sa.cls); } }
    if (!b) { var sb = classFromSigma(compareSeries); if (sb && sb.cls) { b = sb.cls; how.push('<strong>' + esc(compareName) + '</strong> moved with a volatility of ' + pct(sb.sigma, 1) + ', which reads as ' + sb.cls); } }
    if (!a || !b || a === b) return '';
    var SAY = { debt: 'a debt or fixed-income holding', equity: 'an equity holding or index', gold: 'a gold or commodity holding' };
    return notice('info', '<strong>Two different kinds of thing.</strong> ' + esc(name) + ' reads as ' + SAY[a] + ' and ' + esc(compareName) + ' as ' + SAY[b] + '. Their risk and return live on different scales, so the gap below mostly measures the difference between the kinds, not the quality of the fund. A like-for-like benchmark would say more.' +
      '<p class="hint" style="margin:.4rem 0 0">How this was decided: ' + how.join('; ') + '. If a name has misled this note, ignore it.</p>');
  }

  /* ================================================================== run */
  function runRolling() {
    var out = $('#r-out');
    if (!R.a) { out.innerHTML = ''; return; }
    if (R.years === null) { out.innerHTML = R.blockMessage || ''; holdError('Please select a holding period to continue'); return; }
    holdError(null);
    var from = A.isoToTs($('#r-start').value), to = A.isoToTs($('#r-end').value);
    if (isNaN(from) || isNaN(to)) { out.innerHTML = notice('bad', 'Enter both a start date and an end date.'); return; }
    if (from >= to) { out.innerHTML = notice('bad', 'The end date must be after the start date.'); return; }
    var series = P.sliceSeries(R.a.series, from, to);
    if (series.length < 2) { out.innerHTML = notice('bad', 'There is no data between those two dates.'); return; }
    var chosenSpan = (to - from) / (365.2425 * 86400000);
    if (chosenSpan < R.years) {
      out.innerHTML = notice('bad', '<strong>This stretch is shorter than the holding period.</strong> The dates in step 2 cover ' + chosenSpan.toFixed(1) + ' years and you asked for ' + R.years + '-year windows, so not one full period fits. Choose a shorter holding period in step 3, or widen the dates in step 2.');
      return;
    }
    var usedFrom = series[0].t, usedTo = series[series.length - 1].t;
    if (E.spanYearsOf(series) < R.years) { out.innerHTML = notice('bad', 'That leaves ' + E.spanYearsOf(series).toFixed(1) + ' years of history, and each holding period is ' + R.years + ' years long. Widen the dates, or choose a shorter holding period.'); return; }
    var cmp = R.b ? P.sliceSeries(R.b.series, from, to) : null;
    var warning = '';
    if (R.b && cmp.length < 2) { cmp = null; warning = notice('bad', esc(R.b.name) + ' has no data between those dates, so no comparison is shown. Widen the dates, or load a different file.'); }
    R.ran = true;
    out.innerHTML = '<p class="pastnote"><strong>Already happened, not a forecast.</strong></p>' + warning + render(series, cmp, from, to, usedFrom, usedTo);
    out.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function render(series, cmp, from, to, usedFrom, usedTo) {
    var years = R.years, name = R.a.name, cname = R.b ? R.b.name : '';
    var calc = { frequency: R.frequency };
    var r = E.rollingReturns(series, years, calc);
    if (!r.ok) return notice('bad', esc(r.message));
    var s = r.stats;
    /* C2's belt and braces: windows that all return the same are not a
       price's windows; the column read was the wrong one. */
    if (s.count > 1 && s.max - s.min < 1e-12) return notice('bad', esc(P.flatCopy(R.a.report && R.a.report.headers)));
    var paired = cmp ? E.compareRolling(series, cmp, years, calc) : null;
    if (paired && !paired.ok) { paired = null; }
    root.PRCRateData.rolling = r.values;
    var thin = s.count < 3;
    var spanYears = E.spanYearsOf(series);
    var head = '<div class="resulthead"><span class="sb-name">' + esc(name) + '</span><span class="sb-fact">' + years + 'y · median ' + pct(s.median) + ' · worst ' + pct(s.min) + '</span></div>';
    return head + A.tabs('r-tabs', [
      { key: 'record', label: 'The record', html: recordTab(series, cmp, r, paired, years, name, cname, from, to, usedFrom, usedTo, thin, spanYears) },
      { key: 'falls', label: 'Falls and spread', html: thin ? null : fallsTab(series, cmp, r, paired, years, name, cname, calc) },
      { key: 'years', label: 'Over the years', html: yearsTab(series, cmp, years, name, cname) },
      { key: 'against', label: R.bKind === 'NAV' ? 'Against ' + A.shortName(cname, name) : 'Against the index', html: cmp ? againstTab(series, cmp, paired, years, name, cname) : null },
      { key: 'all', label: 'All the numbers', html: allTab(series, cmp, r, paired, years, name, cname, calc) }
    ]) + A.pdfFoot('rolling', name);
  }

  /* --------------------------------------------------------- The record */
  function recordTab(series, cmp, r, paired, years, name, cname, from, to, usedFrom, usedTo, thin, spanYears) {
    var s = r.stats, rep = R.a.report, html = '';
    var drifted = Math.abs(E.dayCount(from, usedFrom)) > 3 || Math.abs(E.dayCount(to, usedTo)) > 3;
    var lastStart = E.addYears(usedTo, -years);
    var skipped = rep ? rep.skipped.badDate + rep.skipped.badValue + rep.skipped.duplicate : 0;
    html += '<div class="card"><h2>What was measured</h2><div class="scroll"><table class="data prose"><tbody>' +
      '<tr><td>Fund or index</td><td>' + esc(name) + (cmp ? ' against ' + esc(cname) : '') + '</td></tr>' +
      '<tr><td>History used</td><td>' + fmtDate(usedFrom) + ' to ' + fmtDate(usedTo) + (drifted ? ' <span class="qsub">(you asked for ' + fmtDate(from) + ' to ' + fmtDate(to) + '; this is the nearest data)</span>' : '') + '</td></tr>' +
      '<tr><td>' + term('windows', 'Each holding period') + '</td><td>' + years + (years === 1 ? ' year' : ' years') + ', starting on every ' + (R.frequency === 'daily' ? 'date the file has' : R.frequency === 'weekly' ? 'seventh day' : 'month') + ', ' + fmtDate(usedFrom) + ' to ' + fmtDate(lastStart) + '</td></tr>' +
      '</tbody></table></div>' +
      '<p class="cardtext">' + (thin ? 'Only ' + s.count + (s.count === 1 ? ' full window of this length fits' : ' full windows of this length fit') + ' in this file.'
        : 'These ' + s.count.toLocaleString('en-IN') + ' holding periods (windows) overlap, as rolling windows are meant to; only <strong>' + r.independent + ' ' + (r.independent === 1 ? 'stretch' : 'stretches') + ' of ' + years + ' years</strong> fit inside ' + spanYears.toFixed(1) + ' years without touching. Read the range below as the shape of that much market and no more.' +
          (spanYears < years + 3 ? ' <strong>Read it with suspicion:</strong> every window here begins inside a band of about ' + Math.max(0, spanYears - years).toFixed(1) + ' years, so they are one stretch measured over and over with its edges moved a little. Three spare years is roughly the least it takes for windows to begin in genuinely different markets.' : '')) +
      '</p></div>';
    if (thin) {
      html += '<div class="result"><div class="label">' + (s.count === 1 ? 'The only ' + years + '-year period in this data' : 'The only ' + s.count + ' ' + years + '-year periods in this data') + ', % a year</div>' +
        '<div class="value">' + (s.count === 1 ? pct(r.values[0]) : pct(s.min) + ' to ' + pct(s.max)) + '</div>' +
        '<div class="sub"><strong>' + (s.count === 1 ? 'One measurement' : 'Two measurements') + ', not a distribution.</strong> There is no median, no worst case and no best case here, because there is nothing to be in the middle of. Choose a shorter holding period to see a range.</div></div>' +
        '<div class="scroll"><table class="data"><tbody>' + r.pairs.map(function (p, i) { return '<tr><td>Period ' + (i + 1) + '</td><td>' + fmtDate(p.t) + ' to ' + fmtDate(p.endT) + '</td><td><strong>' + pct(p.r) + ' a year</strong></td></tr>'; }).join('') + '</tbody></table></div>';
      return html;
    }
    html += '<div class="result"><div class="label">' + term('median', 'Median ' + years + '-year return') + ', % a year</div><div class="value">' + pct(s.median) + '</div>' +
      '<div class="sub">the middle of ' + s.count.toLocaleString('en-IN') + ' holding periods, ' + fmtDate(series[0].t) + ' to ' + fmtDate(series[series.length - 1].t) + '. Half did better, half did worse.</div></div>';
    html += '<div class="stats topline">' + stat('Worst', pct(s.min), 'percentiles') + stat('Median', pct(s.median), 'median') + stat('Best', pct(s.max), 'percentiles') +
      stat('Ended below zero', s.below.toLocaleString('en-IN') + ' of ' + s.count.toLocaleString('en-IN')) +
      (paired ? stat('Ahead of ' + cname, share(paired.fundAheadShare) + ' of windows', 'ahead') : '') + '</div>';
    html += '<p class="cardtext"><strong class="key">Read the worst figure first.</strong> It is what this ' + (R.a.kindGuess === 'index' ? 'market' : 'fund') + ' did over your holding period at its most unkind, and nobody tells you in advance which stretch they are walking into. Read the average last, and never on its own.</p>';
    html += '<div class="card"><h2>' + term('startDates', 'Same ' + (R.a.kindGuess === 'index' ? 'index' : 'fund') + ', two start dates') + '</h2>' +
      '<div class="scroll"><table class="data"><thead><tr><th></th><th>Started</th><th>Held until</th><th>Got</th></tr></thead><tbody>' +
      '<tr><td><strong>Best start</strong></td><td>' + fmtDate(r.best.t) + '</td><td>' + fmtDate(r.best.endT) + '</td><td>' + pct(r.best.r) + ' a year</td></tr>' +
      '<tr><td><strong>Worst start</strong></td><td>' + fmtDate(r.worst.t) + '</td><td>' + fmtDate(r.worst.endT) + '</td><td>' + pct(r.worst.r) + ' a year</td></tr></tbody></table></div>' +
      '<p class="cardtext">Both held for the same ' + years + ' years in the same market. The only difference between them was the day they started, and that difference is worth <strong class="key">' + pct(r.best.r - r.worst.r) + ' a year</strong>. Nobody chooses their starting day on purpose; it is worth knowing how much of any headline return was decided by it. The worst here is the worst of the years this file covers, from ' + fmtDate(series[0].t) + '; a fall that happened before that is not in it, so treat the figure as the worst so far, not the worst there is.</p></div>';
    html += '<div class="card">' + C.histogram(paired ? paired.fundValues : r.values, { years: years, name: name, compare: paired ? paired.benchValues : null, compareName: cname,
      caption: 'Each bar counts the ' + years + '-year periods that ended in that range of return' + (paired ? '; both files over the same ' + paired.pairs.toLocaleString('en-IN') + ' windows' : '') }) +
      '<p class="hint">' + (A.relation(s.p75, s.p25) === 'equal' ? 'The middle half of the periods all returned ' + pct(s.median) + '.'
        : 'A quarter of periods fell below ' + pct(s.p25) + ', and a quarter came in above ' + pct(s.p75) + '. <strong class="key">The spread is what decided what any one investor actually got.</strong>') + '</p></div>';
    html += rateCard('rolling', years, r.values);
    html += threeQuestions(series, years);
    html += fold('What these figures are not', '<ul class="points"><li><strong>Not a forecast.</strong> This is what already happened, over the dates in this file and no others.</li>' +
      '<li><strong>Not independent samples.</strong> The windows overlap; only ' + r.independent + ' of them could stand side by side without touching.</li>' +
      '<li><strong>Not anyone’s experience.</strong> The median is the middle of many possible starting days, not a result anybody actually had. A monthly investor’s figures are on the <em>Falls and spread</em> tab.</li></ul>');
    return html;
  }
  function rateCard(key, years, values) {
    var start = 0.07, res = E.shareAbove(values, start);
    return '<div class="card"><h2>' + term('beatRate', 'How often did it beat a rate you choose?') + '</h2>' +
      '<p class="hint tight">Your own target: the return you need, a deposit rate you could get instead, your guess at inflation plus a margin. This tool does not know today’s rates and does not pretend to.</p>' +
      '<div class="chips ratepresets" data-key="' + key + '">' + [6, 8, 10, 12].map(function (x) { return '<button class="chip" type="button" data-rate="' + x + '">' + x + '%</button>'; }).join('') + '</div>' +
      '<div class="field" style="max-width:16rem"><label for="rate-' + key + '">Rate to compare against, % a year</label><input type="number" id="rate-' + key + '" class="ratecheck" data-key="' + key + '" data-years="' + years + '" value="7" step="0.5" min="-50" max="100" inputmode="decimal"></div>' +
      '<div class="result" style="margin:.6rem 0 0"><div class="label">Periods that beat it</div><div class="value" id="rateout-' + key + '">' + share(res.share) + '</div>' +
      '<div class="sub" id="ratesub-' + key + '">In ' + share(res.share) + ' of the ' + years + '-year holding periods in this data (' + res.above.toLocaleString('en-IN') + ' of ' + res.count.toLocaleString('en-IN') + '), the return beat ' + pct(start, 1) + ' a year. Past periods, not future odds.</div></div>' +
      '</div>';
  }
  function threeQuestions(series, years) {
    var dd = E.maxDrawdown(series);
    var months = dd.ok && dd.to ? A.months(dd.fallDays + (dd.recoveryDays || 0)) : null;
    return '<div class="card"><h2>Three questions only you can answer</h2><ol class="insights reflectlist">' +
      '<li><span class="ins-h">Time</span><span class="ins-b">The figures describe ' + years + '-year holds. Is the money you are thinking of actually free for ' + years + (years === 1 ? ' year' : ' years') + ', with no planned purchase, fee or commitment inside that window?</span></li>' +
      '<li><span class="ins-h">Falls</span><span class="ins-b">' + (dd.ok && dd.to ? 'The deepest fall in this data was <strong>' + pct(dd.depth) + '</strong>' + (dd.recoveredOn ? ', and the round trip from peak to recovery took about <strong>' + months + ' months</strong>' : ', not yet recovered by the end of this data') + '. If that stretch began the month after you invested, could you, in money and in nerve, stay to the end of it?' : 'This data shows no fall, which says more about the dates it covers than about the future.') + '</span></li>' +
      '<li><span class="ins-h">Target</span><span class="ins-b">The rate box above holds your own required rate. Did enough of the past periods clear it for this record to fit the plan you are funding? That judgement is yours, not this page’s.</span></li></ol></div>';
  }

  /* ---------------------------------------------------- Falls and spread */
  function fallsTab(series, cmp, r, paired, years, name, cname, calc) {
    var s = r.stats, html = '';
    var dd = E.maxDrawdown(series), uw = E.longestUnderwater(series);
    var bdd = cmp ? E.maxDrawdown(cmp) : null;
    if (dd.ok && dd.depth < 0) {
      var bottom = Math.round(10000 * (1 + dd.depth));
      html += '<div class="card"><h2>' + term('drawdown', 'The worst fall along the way') + '</h2>' +
        '<div class="stats">' + stat('Deepest fall', pct(dd.depth), 'drawdown') + stat('It began', fmtDate(dd.from.t)) + stat('The fall took', A.monthsText(dd.fallDays)) +
        stat('Back to the old high', dd.recoveredOn ? fmtDate(dd.recoveredOn) + ', ' + A.monthsText(dd.recoveryDays) + ' after the bottom' : 'not yet in this data') +
        (bdd && bdd.ok && bdd.depth < 0 ? stat(cname + '’s deepest fall', pct(bdd.depth) + (bdd.recoveredOn ? ', back to its old high ' + A.monthsText(bdd.recoveryDays) + ' after the bottom' : ', not yet back')) : '') +
        (uw.ok && uw.days > 0 ? stat('Longest below a high', A.monthsText(uw.days) + (uw.ongoing ? ', still' : ''), 'underwater') : '') + '</div>' +
        (uw.ok && uw.days > 0 ? '<p class="hint tight">Longest below a high: the longest time the value spent under an earlier peak before passing it.</p>' : '') +
        '<p class="cardtext">A return says what was earned; this says what had to be sat through to earn it. Every ₹10,000 held through this was worth about <strong class="key">₹' + bottom.toLocaleString('en-IN') + '</strong> at the bottom' +
        (dd.recoveredOn ? ', and took until ' + fmtDate(dd.recoveredOn) + ' to be ₹10,000 again' : ', and had not got back to ₹10,000 by the end of this data') + '. ' +
        (uw.ok && uw.days > dd.fallDays + (dd.recoveryDays || 0) ? 'The longest stretch spent below a previous high was ' + A.monthsText(uw.days) + ', from ' + fmtDate(uw.from) + (uw.ongoing ? ' and still running at the end of the file' : ' to ' + fmtDate(uw.to)) + ', which is a different stretch from the deepest fall. ' : '') +
        'This is a different measurement from the worst window above: a value can fall steeply inside a window that still ends positive. If this fall began the month after you invested, would anything, a fee due, a purchase planned, your own nerve, force you to take the money out before it climbed back? Whoever sells at the bottom turns this dip into their permanent result.' +
        (dd.recoveredOn && years * 12 <= A.months(dd.fallDays + dd.recoveryDays) ? ' <strong>Your chosen ' + years + '-year holding period is not longer than this fall-and-recovery.</strong> A hold of that length starting on ' + fmtDate(dd.from.t) + ' would have ended before the money was whole again.' : '') + '</p></div>';
    }
    html += horizonCard(series, cmp, years, calc, name, cname);
    html += '<div class="card"><h2>' + term('windows', 'Every window, in the order it happened') + '</h2>' + C.rollingLine(r.pairs, years, s, paired ? paired.matched : null, cname, name) +
      '<p class="hint">Neighbouring points share almost all their days, which is why the line moves smoothly: these are overlapping windows, not independent results.</p></div>';
    var sip = E.rollingSip(series, years, {});
    if (sip.ok && sip.stats.count >= 3) {
      var ss = sip.stats;
      html += '<div class="card"><h2>' + term('rollingSip', 'A fixed sum every month, over every ' + years + '-year stretch') + '</h2>' +
        '<div class="stats">' + stat('Worst', pct(ss.min)) + stat('Median', pct(ss.median)) + stat('Best', pct(ss.max)) + stat('Stretches', ss.count.toLocaleString('en-IN')) + '</div>' +
        '<p class="cardtext">The windows above measure one sum put in on day one. Most people pay in monthly, and a monthly investor’s money spends less time invested, so its rate is a different number. Here the same amount goes in every month for ' + years + ' years, from every month in the file, and each stretch is valued at its end: the yearly rate (XIRR) those instalments earned. ' +
        'The worst stretch began ' + fmtDate(sip.worst.t) + ' and ended ' + fmtDate(sip.worst.endT) + '; the best began ' + fmtDate(sip.best.t) + '.' +
        (ss.median < s.median - 0.005 ? ' The monthly median is below the lump-sum median because in a rising stretch later instalments buy fewer units; the reverse holds in a falling one.' : '') + '</p></div>';
    }
    return html;
  }
  function horizonCard(series, cmp, chosenYears, calc, name, cname) {
    var spanYears = E.spanYearsOf(series), horizons = A.HORIZONS.slice();
    var m = E.maxHorizon(series);
    if (m !== null && horizons.indexOf(m) === -1) horizons.push(m);
    horizons.sort(function (a, b) { return a - b; });
    var rows = [];
    horizons.forEach(function (h) {
      if (h > spanYears) return;
      var r = E.rollingReturns(series, h, calc);
      if (!r.ok || r.stats.count < 3) return;
      rows.push({ h: h, s: r.stats, values: r.values });
    });
    if (rows.length < 2) return '';
    root.PRCHorizonData.rolling = rows.map(function (row) { return { h: row.h, values: row.values }; });
    var benchRows = {};
    if (cmp) rows.forEach(function (row) { var c = E.compareRolling(series, cmp, row.h, calc); if (c.ok && c.pairs >= 3) benchRows[row.h] = c.bench; });
    var startRate = 0.07;
    return '<div class="card"><h2>' + term('percentiles', 'The same data, held for longer') + '</h2>' +
      C.fan(rows, benchRows, chosenYears, 'rolling', cname, name) +
      '<p class="hint tight">Every row is every holding period of that length in this file. The 10th and 90th columns are the outer tenths: 8 of every 10 windows ended between them. <strong>Beat your target</strong> follows the rate box on <em>The record</em> tab.</p>' +
      '<div class="scroll"><table class="data spread hmatrix"><thead><tr><th>Held for</th><th>Worst</th><th>10th</th><th>Median</th><th>90th</th><th>Best</th><th>Below zero</th><th>Beat your target</th></tr></thead><tbody>' +
      rows.map(function (row) {
        var em = row.h === chosenYears, beat = E.shareAbove(row.values, startRate);
        return '<tr' + (em ? ' class="now"' : '') + '><td>' + row.h + (row.h === 1 ? ' year' : ' years') + (em ? ' ← chosen' : '') + '</td><td>' + pct(row.s.min) + '</td><td>' + pct(row.s.p10) + '</td><td>' + pct(row.s.median) + '</td><td>' + pct(row.s.p90) + '</td><td>' + pct(row.s.max) + '</td><td>' + share(row.s.below / row.s.count) + '</td>' +
          '<td data-beat-h="' + row.h + '" data-key="rolling">' + (beat.ok ? share(beat.share) : 'none') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="cardtext">Where the Worst column rises and the band narrows as the holding period grows, longer holds narrowed the range of outcomes <em>in this data</em>. That is a description of these dates, not a law, and not a promise about the next period of any length. Longer horizons hold fewer windows, and all of them overlap.</p></div>';
  }

  /* a fund's full name is too long for a column heading; the heading takes
     its first words and the full names sit under the table */
  function colName(n) { n = String(n || ''); return n.length > 18 ? n.slice(0, 17).replace(/[\s\-\u2013\u2014,·]+$/, '') + '…' : n; }
  /* what the Gap column is, under the table it heads */
  function gapLine(name, cname) {
    return '<p class="hint tight">Gap: ' + (R.bKind === 'NAV' ? esc(A.shortName(name, cname)) + '’s figure minus ' + esc(A.shortName(cname, name)) + '’s' : 'the fund’s figure minus the index’s') +
      ', in percentage points, worked out before rounding (so it can differ by 0.1 from the figures beside it).</p>';
  }
  function namesNote(name, cname) {
    var parts = [];
    if (colName(name) !== name) parts.push('<strong>' + esc(colName(name)) + '</strong> is ' + esc(name));
    if (cname && colName(cname) !== cname) parts.push('<strong>' + esc(colName(cname)) + '</strong> is ' + esc(cname));
    return parts.length ? '<p class="hint tight">' + parts.join('; ') + '.</p>' : '';
  }

  /* ------------------------------------------------------ Over the years */
  /* Section 6: year by year and the trailing figures are one card, so the tab
     is shorter; what ₹10,000 became follows it. */
  function yearsTab(series, cmp, years, name, cname) {
    var html = '';
    var cal = cmp ? E.calendarYearsPaired(series, cmp) : E.calendarYears(series).map(function (r) { return { year: r.year, from: r.from, to: r.to, fund: r.r, bench: null, partial: r.partial }; });
    var tr = cmp ? E.trailingPaired(series, cmp, [1, 3, 5, 10]) : E.trailingReturns(series, [1, 3, 5, 10]).map(function (r) { return { years: r.years, sinceStart: !!r.sinceStart, ok: r.ok, fund: r.ok ? r.rate : null, bench: null, from: r.from, to: r.to }; });
    var rr = {};
    A.HORIZONS.forEach(function (h) { var x = E.rollingReturns(series, h, {}); if (x.ok && x.stats.count >= 3) rr[h] = x.stats; });
    html += '<div class="card"><h2>Year by year</h2>';
    if (cal.length) {
      html += '<div class="scroll"><table class="data"><thead><tr><th>Year</th><th>' + esc(colName(name)) + '</th>' + (cmp ? '<th>' + esc(colName(cname)) + '</th><th>Gap</th>' : '') + '</tr></thead><tbody>' +
        cal.map(function (r) {
          return '<tr><td>' + r.year + (r.partial ? ' <span class="qsub">(' + (r.partial === 'start' ? 'from ' + fmtDate(r.from) : r.partial === 'end' ? 'to ' + fmtDate(r.to) : fmtDate(r.from) + ' to ' + fmtDate(r.to)) + ')</span>' : '') + '</td>' +
            '<td>' + A.signedPct(r.fund) + '</td>' + (cmp ? '<td>' + (r.bench == null ? 'not covered' : A.signedPct(r.bench)) + '</td><td>' + (r.bench == null ? 'not known' : A.signedPct(r.fund - r.bench)) + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table></div>' + (cmp ? gapLine(name, cname) : '');
    }
    html += '<h3 class="subhead">The numbers a factsheet prints, to ' + fmtDate(series[series.length - 1].t) + '</h3>' +
      '<div class="scroll"><table class="data"><thead><tr><th>Held for</th><th>' + esc(colName(name)) + '</th>' + (cmp ? '<th>' + esc(colName(cname)) + '</th>' : '') + '<th>Rolling median</th><th>Rolling worst to best</th></tr></thead><tbody>' +
      tr.map(function (row) {
        var label = row.sinceStart ? 'Since ' + fmtDate(row.from) : row.years + (row.years === 1 ? ' year' : ' years');
        var st = row.years ? rr[row.years] : null;
        return '<tr><td>' + label + '</td><td>' + (row.ok ? pct(row.fund) : '<span class="qsub">not in file</span>') + '</td>' + (cmp ? '<td>' + (row.bench == null ? 'not covered' : pct(row.bench)) + '</td>' : '') +
          '<td>' + (st ? pct(st.median) : 'too few windows') + '</td><td>' + (st ? pct(st.min) + ' to ' + pct(st.max) : 'too few windows') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + namesNote(name, cmp ? cname : null) +
      '<p class="cardtext">Each calendar year runs from the last value of the year before to its own last value. The factsheet figures end on the file’s last date and are annualised on a 365-day year; beside them, the median and the range of every window of the same length. Each factsheet figure is one window, the one ending on the file’s last date. Beside the range, it shows whether that one figure sits near the middle of the record or near an end.</p></div>';
    var aligned = cmp ? E.alignCalendar(series, cmp) : null;
    var gf = aligned && aligned.ok ? E.growthOf(aligned.a, 10000) : E.growthOf(series, 10000);
    var gb = aligned && aligned.ok ? E.growthOf(aligned.b, 10000) : null;
    html += '<div class="card"><h2>What ₹10,000 became</h2>' + C.growth(gf, { name: name, compare: gb, compareName: cname }) +
      '<p class="cardtext">One sum on the first ' + (cmp ? 'shared ' : '') + 'date, never touched: ' + money(10000) + ' became <strong class="key">' + money(gf[gf.length - 1].v) + '</strong>' + (gb ? ' in ' + esc(name) + ' and <strong>' + money(gb[gb.length - 1].v) + '</strong> in ' + esc(cname) : '') + ' by ' + fmtDate(gf[gf.length - 1].t) + '. The picture fund houses are required to show; here it is drawn on your file. Because the axis is logarithmic, a doubling looks the same size anywhere on it.</p></div>';
    return html;
  }

  /* ---------------------------------------------------- Against the index */
  function againstTab(series, cmp, paired, years, name, cname) {
    var html = classMismatchNote(name, cname, series, cmp);
    var sd = E.sharedDates(series, cmp);
    var fv = E.annualisedVolatility(sd.a), bv = E.annualisedVolatility(sd.b);
    var fd = E.maxDrawdown(sd.a), bd = E.maxDrawdown(sd.b);
    var cap = E.captureRatios(series, cmp), ir = E.informationRatio(series, cmp), tk = E.tracking(series, cmp);
    /* Section 7: tracking difference and error are shown only for a scheme
       whose name says it follows an index; for an active fund they describe
       nothing and only confuse. */
    var tracks = /\b(index|etf|nifty|sensex|bse|nse)\b/i.test(name);
    /* The comparison file is another fund's NAV: it is named, never called the
       index, and what is only true of an index (it carries no costs, the
       regulator has the ratio published against it) is not said of it. */
    var fundCmp = R.bKind === 'NAV', other = A.shortName(cname, name);
    function row(label, a, b, fmt, key) {
      var have = a != null && b != null;
      return '<tr><td>' + (key ? term(key, label) : esc(label)) + '</td><td>' + (a == null ? 'not known' : fmt(a)) + '</td><td>' + (b == null ? 'not known' : fmt(b)) + '</td><td>' + (have ? A.signedPct(a - b) : 'not known') + '</td></tr>';
    }
    html += '<div class="card"><h2>Side by side, over the same dates</h2>' +
      (paired ? '<p class="hint tight">Window figures come from the ' + paired.pairs.toLocaleString('en-IN') + ' paired ' + years + '-year windows, ' + fmtDate(paired.from) + ' to ' + fmtDate(paired.to) + (paired.filledFund || paired.filledBench ? ', with ' + (paired.filledFund + paired.filledBench) + ' dates one file lacked filled from that file’s previous value' : '') + '; the rest from the daily values on the dates both files have.</p>' : '') +
      '<div class="scroll"><table class="data charmatrix"><thead><tr><th></th><th>' + esc(colName(name)) + '</th><th>' + esc(colName(cname)) + '</th><th>Gap</th></tr></thead><tbody>' +
      (paired ? row('Median ' + years + '-year window', paired.fund.median, paired.bench.median, pct, 'median') + row('Worst window', paired.fund.min, paired.bench.min, pct, 'percentiles') + row('Best window', paired.fund.max, paired.bench.max, pct, 'percentiles') +
        row('Windows ending above zero', paired.fund.positiveShare, paired.bench.positiveShare, function (v) { return share(v); }) : '') +
      row('Typical size of a year’s swing', fv.ok ? fv.sigma : null, bv.ok ? bv.sigma : null, function (v) { return pct(v, 1); }, 'volatility') +
      row('Deepest fall', fd.ok ? fd.depth : null, bd.ok ? bd.depth : null, pct, 'drawdown') +
      '</tbody></table></div>' + gapLine(name, cname) +
      A.means('<p>Typical size of a year’s swing: how far a year’s return typically strays from its average, up or down (the standard deviation of daily moves, scaled to a year). Larger means a bumpier ride; it says nothing about how much was earned.</p>') +
      namesNote(name, cname) +
      (paired ? '<p class="cardtext"><strong class="key">' + esc(name) + ' came out ahead in ' + share(paired.fundAheadShare) + ' of the paired windows</strong>, ' + paired.fundAhead.toLocaleString('en-IN') + ' of ' + paired.pairs.toLocaleString('en-IN') + '. Leading in most windows is a different statement from leading over one stretch: a fund can win on the dates you happen to look at and lose on most others.' + (fundCmp ? '' : ' A benchmark carries no costs, holds no cash and makes no decisions; a fund does all three.') + '</p>' : '') +
      '</div>';
    if (cap.ok) {
      /* labels go to term() and stat(), which escape; sentences are escaped here */
      var them = fundCmp ? other : 'the index', theirs = them + '’s';
      html += '<div class="card"><h2>' + term('capture', 'When ' + them + ' rose, and when it fell') + '</h2>' +
        '<div class="stats">' + stat('Of ' + theirs + ' rises, it took', pct(cap.upside, 0)) + stat('Of ' + theirs + ' falls, it took', pct(cap.downside, 0)) + stat('Months compared', String(cap.months)) + '</div>' +
        '<p class="cardtext">In the ' + cap.upMonths + ' months ' + esc(them) + ' rose, ' + (fundCmp ? esc(name) : 'this fund') + ' captured <strong>' + pct(cap.upside, 0) + '</strong> of the rise; in the ' + cap.downMonths + ' months it fell, <strong>' + pct(cap.downside, 0) + '</strong> of the fall. Over 100% in up months means more than ' + esc(theirs) + ' rises; under 100% in down months means less of its falls. ' +
        (cap.downside != null && cap.downside < 0 ? 'A negative figure in down months means ' + (fundCmp ? esc(name) : 'the fund') + ' rose, on average, while ' + esc(them) + ' fell. ' : '') +
        'A fund that takes less of the falls and less of the rises is a steadier thing, not a better or worse one; the two figures describe its shape.</p>' +
        (tk.ok && !tk.closely && Math.abs(tk.correlation) < 0.5 ? '<p class="hint">These two files barely move together (daily correlation ' + tk.correlation.toFixed(2) + '), so capture figures describe coincidence more than behaviour; they are meant for a fund and the index it is measured against.</p>' : '') + '</div>';
    }
    if (ir.ok || (tk.ok && tracks)) {
      html += '<div class="card"><h2>' + term('ir', fundCmp ? 'The yearly gap, and how steady it was' : 'Two figures the regulator has funds publish') + '</h2><div class="stats">' +
        (ir.ok ? stat('Excess return a year', A.signedPct(ir.excess)) + stat('Its unsteadiness', pct(ir.trackingError, 1)) + stat('Information ratio', ir.ratio.toFixed(2).replace(/^-/, '−'), 'ir') : '') +
        (tk.ok && tk.closely && tracks && !fundCmp ? stat('Tracking difference', A.signedPct(tk.difference), 'tracking') + stat('Tracking error', pct(tk.trackingError, 2), 'tracking') : '') + '</div>' +
        (ir.ok ? A.means('<p>Excess return a year: the average daily difference, scaled to a year; averaged day by day, it need not equal the gap between the two yearly returns.</p>' +
          '<p>Its unsteadiness: how much that daily difference swung, scaled to a year (tracking error).</p>' +
          '<p>Information ratio: above 0, ' + (fundCmp ? esc(name) + ' ran ahead of ' + esc(other) : 'the fund ran ahead of the index') + ' on average; below 0, behind; the further from 0, the more steadily.</p>') : '') +
        (ir.ok && fundCmp ? '<p class="cardtext">The <strong>information ratio</strong> is ' + esc(name) + '’s excess return over ' + esc(cname) + ' divided by how unsteady that excess was, on daily returns, ' + fmtDate(ir.from) + ' to ' + fmtDate(ir.to) + ': ' + A.signedPct(ir.excess) + ' ÷ ' + pct(ir.trackingError, 1) + ' = ' + ir.ratio.toFixed(2).replace(/^-/, '−') + '. It is a ratio, not a rate: it says how consistently the difference between the two was earned, and it only compares across the same pair and period.</p>' : '') +
        (ir.ok && !fundCmp ? '<p class="cardtext">The <strong>information ratio</strong> is the fund’s excess return over the index divided by how unsteady that excess was, on daily returns, ' + fmtDate(ir.from) + ' to ' + fmtDate(ir.to) + ': ' + A.signedPct(ir.excess) + ' ÷ ' + pct(ir.trackingError, 1) + ' = ' + ir.ratio.toFixed(2).replace(/^-/, '−') + '. Equity schemes must publish it daily. It is a ratio, not a rate: it says how consistently the fund’s difference from its index was earned, and it only compares across the same index and period.</p>' : '') +
        (tk.ok && tracks && fundCmp ? '<p class="hint">Tracking difference and error are not shown: they are measured against the index a fund follows, and ' + esc(cname) + ' is a fund.</p>' : '') +
        (tk.ok && tracks && !fundCmp ? (tk.closely ? '<p class="cardtext">These two move almost together (daily correlation ' + tk.correlation.toFixed(3) + '), which is how a fund that tracks an index behaves. The <strong>tracking difference</strong> is what the tracking cost over ' + fmtDate(tk.from) + ' to ' + fmtDate(tk.to) + ': ' + A.signedPct(tk.difference) + ' a year against the index' + (tk.lastYearDifference != null ? ', ' + A.signedPct(tk.lastYearDifference) + ' over the last year' : '') + '. The <strong>tracking error</strong> is how steadily it tracked: ' + pct(tk.trackingError, 2) + (tk.lastYearError != null ? ', ' + pct(tk.lastYearError, 2) + ' over the last year' : '') + '. The rule for equity index funds and ETFs caps the one-year tracking error at 2%.</p>'
          : '<p class="hint">Tracking difference and error are not shown: the two files move with a daily correlation of ' + tk.correlation.toFixed(2) + ', so this is not a fund following that index, and those figures would describe nothing.</p>') : '') +
        '</div>';
    }
    if (R.bKind === 'PRICE') html += notice('warn', '<strong>' + esc(cname) + ' leaves dividends out while a fund’s NAV includes them.</strong> Every gap on this tab flatters the fund by about the index’s dividend yield each year.');
    else if (R.bKind !== 'TRI' && R.bKind !== 'NAV') html += notice('warn', '<strong>Whether ' + esc(cname) + ' counts dividends has not been established.</strong> If it is a price index, every gap here overstates the fund by about the index’s dividend yield. Say which it is in step 1.');
    return html;
  }

  /* ----------------------------------------------------- All the numbers */
  function allTab(series, cmp, r, paired, years, name, cname, calc) {
    var s = r.stats, html = '';
    function cell(v) { return v == null ? 'none' : v; }
    function row(label, a, b) { return '<tr><td>' + label + '</td><td>' + cell(a) + '</td>' + (cmp ? '<td>' + cell(b) + '</td>' : '') + '</tr>'; }
    var f = paired ? paired.fund : s, b = paired ? paired.bench : null;
    html += '<div class="card"><h2>The record in numbers</h2><div class="scroll"><table class="data' + (cmp ? ' stickyfirst' : '') + '"><caption>' + years + '-year rolling returns, ' + esc((E.FREQUENCY[calc.frequency] || E.FREQUENCY.daily).label.toLowerCase()) + ' start dates' + (paired ? ', the ' + paired.pairs.toLocaleString('en-IN') + ' windows both files cover' : '') + '</caption>' +
      '<thead><tr><th>Measure</th><th>' + esc(colName(name)) + '</th>' + (cmp ? '<th>' + esc(colName(cname)) + '</th>' : '') + '</tr></thead><tbody>' +
      row(term('windows', 'Windows measured'), f.count.toLocaleString('en-IN'), b ? b.count.toLocaleString('en-IN') : null) +
      row('Stretches that do not overlap', String(paired ? paired.independent : r.independent), paired ? String(paired.independent) : null) +
      row(term('percentiles', 'Worst'), pct(f.min), b ? pct(b.min) : null) + row('10th percentile', pct(f.p10), b ? pct(b.p10) : null) + row('25th percentile', pct(f.p25), b ? pct(b.p25) : null) +
      row(term('median', 'Median'), pct(f.median), b ? pct(b.median) : null) + row('75th percentile', pct(f.p75), b ? pct(b.p75) : null) + row('90th percentile', pct(f.p90), b ? pct(b.p90) : null) + row('Best', pct(f.max), b ? pct(b.max) : null) +
      row('Mean (average)', pct(f.mean), b ? pct(b.mean) : null) + row('Spread of the windows (standard deviation)', f.stdev == null ? 'one window' : pct(f.stdev), b ? (b.stdev == null ? 'one window' : pct(b.stdev)) : null) +
      row('Ended below zero', f.below.toLocaleString('en-IN') + ' (' + share(f.below / f.count, 1) + ')', b ? b.below.toLocaleString('en-IN') + ' (' + share(b.below / b.count, 1) + ')' : null) +
      (paired ? row(term('ahead', 'Windows ahead of ' + esc(cname)), paired.fundAhead.toLocaleString('en-IN') + ' (' + share(paired.fundAheadShare, 1) + ')', 'not applicable') : '') +
      '</tbody></table></div>' +
      A.means('<p>The 10th percentile is the return 1 window in 10 fell below; the 25th, 1 in 4. The 75th and 90th count the same way from the top.</p>' +
        '<p>Spread of the windows (standard deviation): how far a typical window’s return sat from the average. The larger it is, the more the start date decided what an investor got.</p>') +
      namesNote(name, cmp ? cname : null) +
      '<p class="hint"><strong>The headline uses the median, not the mean</strong>: a handful of exceptional stretches cannot pull the median upward, while a mean can be lifted into a figure no ordinary holding period ever produced. Every figure describes the dates in these files; none is a probability or a forecast.</p></div>';
    var bins = E.histogram(paired ? paired.fundValues : r.values, { bins: 8 });
    var dp = bins.some(function (x) { return Math.abs(x.from * 100 - Math.round(x.from * 100)) > 1e-9; }) ? 1 : 0;
    html += '<div class="card"><h2>How many windows ended in each range</h2><div class="scroll"><table class="data bins"><thead><tr><th>Return range, a year</th><th>Windows</th><th>Share</th></tr></thead><tbody>' +
      bins.map(function (x) { return '<tr><td>' + pct(x.from, dp) + ' to ' + pct(x.to, dp) + '</td><td>' + x.count + '</td><td>' + share(x.count / (paired ? paired.fundValues.length : r.values.length)) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    html += windowTable(r.pairs, years, paired ? paired.matched : null, name, cname);
    var rep = R.a.report;
    if (rep) {
      var skipped = rep.skipped.badDate + rep.skipped.badValue + rep.skipped.duplicate;
      /* rows with neither a date nor a price (an AMFI download's section
         headings, a note) and dates a second file repeated are not left-out
         rows, so the sentence below does not count them; this line does */
      var others = [];
      if (rep.skipped.blank) others.push('headings or notes in the file' + (rep.files > 1 ? 's' : ''));
      if (rep.overlaps) others.push('dates another of your files already held');
      if (others.length && skipped) others.push('the rows left out below');
      html += '<div class="card"><h2>What was read from your file' + (rep.files > 1 ? 's' : '') + '</h2><div class="stats">' + stat('Rows in file', rep.rowsRead.toLocaleString('en-IN')) + stat('Rows used', rep.used.toLocaleString('en-IN')) + stat('First date', fmtDate(rep.firstDate)) + stat('Last date', fmtDate(rep.lastDate)) + '</div>' +
        (rep.rowsRead > rep.used && others.length ? '<p class="hint tight">Rows used are the dated prices every figure here rests on; the other rows are ' + (others.length === 1 ? others[0] : others.slice(0, -1).join(', ') + ' or ' + others[others.length - 1]) + '.</p>' : '') +
        (skipped ? '<p class="cardtext">' + skipped + ' row' + (skipped === 1 ? ' was' : 's were') + ' left out: ' + rep.skipped.badDate + ' with a date that could not be read, ' + rep.skipped.badValue + ' with a missing, zero or negative value, ' + rep.skipped.duplicate + ' repeating a date already seen.</p>' +
          (rep.examples.length ? fold('Show me which rows', '<ul class="plainlist">' + rep.examples.map(function (x) { return '<li>Line ' + x.line + ': “' + esc(x.value) + '”: ' + esc(x.why) + '</li>'; }).join('') + '</ul>') : '') : '') +
        (rep.warnings || []).map(function (w) { return notice('warn', esc(w)); }).join('') + '</div>';
    }
    return html;
  }
  function windowTable(pairs, years, matched, name, cname) {
    if (!pairs || !pairs.length) return '';
    var byT = {};
    if (matched) matched.forEach(function (m) { byT[m.t] = m.bench; });
    var lastYear = null, yearList = [];
    var rows = pairs.map(function (p) {
      var y = new Date(p.t).getUTCFullYear(), first = y !== lastYear;
      if (first) { yearList.push(y); lastYear = y; }
      return '<tr data-year="' + y + '"><td>' + fmtDate(p.t) + ' to ' + fmtDate(p.endT) + '</td><td>' + pct(p.r) + '</td>' + (matched ? '<td>' + (byT[p.t] == null ? 'not covered' : pct(byT[p.t])) + '</td>' : '') + '</tr>';
    });
    WINDOW_ROWS = { pairs: pairs, byT: matched ? byT : null, years: years, name: name, compareName: cname };
    return fold('Every ' + years + '-year window, one per row (' + pairs.length.toLocaleString('en-IN') + ')',
      (yearList.length > 1 ? '<div class="yearchips" role="group" aria-label="Jump to a year">' + yearList.map(function (y) { return '<button class="chip" type="button" data-jump-year="' + y + '">' + y + '</button>'; }).join('') + '</div>' : '') +
      '<div class="winbox" id="winbox-rolling" tabindex="0"><table class="data"><thead><tr><th>Window</th><th>' + esc(colName(name)) + '</th>' + (matched ? '<th>' + esc(colName(cname)) + '</th>' : '') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      '<div class="winrow"><button class="secondary wincsv" type="button">Download these rows as CSV</button></div>' +
      (matched ? '<p class="hint">“Not covered” means the second file does not cover that window.</p>' : ''));
  }
  function windowCsv() {
    var w = WINDOW_ROWS;
    if (!w) return null;
    var head = ['Window starts', 'Window ends', w.name + ' (% a year)'];
    if (w.byT) head.push(w.compareName + ' (% a year)');
    var lines = [head.map(A.csvCell).join(',')];
    w.pairs.forEach(function (p) {
      var row = [A.isoOf(p.t), A.isoOf(p.endT), (p.r * 100).toFixed(2)];
      if (w.byT) row.push(w.byT[p.t] == null ? '' : (w.byT[p.t] * 100).toFixed(2));
      lines.push(row.map(A.csvCell).join(','));
    });
    return { text: lines.join('\r\n'), name: w.name };
  }
  function windowAppendix() {
    var w = WINDOW_ROWS;
    if (!w) return null;
    var cols = ['Window starts', 'Window ends', w.name + ' (% a year)'];
    if (w.byT) cols.push(w.compareName + ' (% a year)');
    return { title: 'Every ' + w.years + '-year window, one per row (' + w.pairs.length.toLocaleString('en-IN') + ')', columns: cols, widths: w.byT ? [40, 40, 53, 53] : [46, 46, 94],
      rows: w.pairs.map(function (p) { var row = [fmtDate(p.t), fmtDate(p.endT), pct(p.r)]; if (w.byT) row.push(w.byT[p.t] == null ? 'not covered' : pct(w.byT[p.t])); return row; }) };
  }

  /* ================================================================= init */
  function init() {
    mountDoors();
    yearChips(); freqChips(); gateSteps();
    ['r-start', 'r-end'].forEach(function (id) {
      $('#' + id).addEventListener('change', function () { R.datesTouched = true; limitYears(selectedSpanYears()); updateWindowNote(); updateAllBtn(); runGate(); if (R.ran) runRolling(); });
    });
    $('#r-all').addEventListener('click', function () {
      if (!R.a) return;
      $('#r-start').value = A.isoOf(R.a.series[0].t); $('#r-end').value = A.isoOf(R.a.series[R.a.series.length - 1].t);
      R.datesTouched = false; limitYears(selectedSpanYears()); updateWindowNote(); updateAllBtn(); runGate(); if (R.ran) runRolling();
    });
    $('#r-run').addEventListener('click', runRolling);
    $('#r-reset').addEventListener('click', function () {
      R.ran = false; R.years = DEFAULT_YEARS; R.frequency = 'daily'; R.datesTouched = false; R.a = null; R.b = null; R.bKind = null;
      R.doorA.clear(); R.doorB.clear(); drawKind(); yearChips(); freqChips(); clearLoaded();
    });
  }
  root.PRCRolling = { init: init, state: R, windowCsv: windowCsv, windowAppendix: windowAppendix, run: runRolling };
})(typeof globalThis !== 'undefined' ? globalThis : this);
