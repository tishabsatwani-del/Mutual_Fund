/* Where You Stand: the charts. Inline SVG sized by viewBox so it scales on a
 * phone; one hue per series, and the axis carries the meaning, never colour
 * alone. Every chart has a caption and an aria-label that says the same thing
 * in words. */
(function (root) {
  'use strict';
  var A = root.PRCApp, E = root.PRCEngine;
  var esc = A.esc, pct = A.pct, money = A.money, fmtDate = A.fmtDate;

  function fig(caption, svg, legend, alt, cls) {
    return '<figure class="chart' + (cls ? ' ' + cls : '') + '"><figcaption>' + esc(caption) + '</figcaption>' +
      svg.replace('<svg ', '<svg role="img" aria-label="' + esc(alt) + '" ') +
      (legend ? '<div class="legend">' + legend + '</div>' : '') + '</figure>';
  }
  function key(cls, text) { return '<span class="key"><span class="legend-dot ' + cls + '"></span>' + esc(text) + '</span>'; }
  function niceStep(span, target) {
    var raw = span / target, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var cands = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; });
    for (var i = 0; i < cands.length; i++) if (cands[i] >= raw) return cands[i];
    return cands[cands.length - 1];
  }

  /* ---------------------------------------------------------- histogram
   * Bins fitted to the data (engine.histogram); zero is always an edge. With a
   * second series the bins are shared and drawn as pairs. */
  function histogram(values, opts) {
    var o = opts || {};
    var bins = E.histogram(values, { bins: o.bins || 8 });
    if (!bins.length) return '';
    var edges = bins.map(function (b) { return b.from; }).concat([bins[bins.length - 1].to]);
    var bbins = o.compare ? E.histogram(o.compare, { edges: edges }) : null;
    var W = 640, H = 270, padL = 36, padR = 12, padT = 16, padB = 56;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var maxCount = 1;
    bins.forEach(function (b) { if (b.count > maxCount) maxCount = b.count; });
    if (bbins) bbins.forEach(function (b) { if (b.count > maxCount) maxCount = b.count; });
    var gap = 8, slot = innerW / bins.length, bw = slot - gap;
    var parts = [];
    var lossBins = bins.filter(function (b) { return b.to <= 0; }).length;
    if (lossBins) parts.push('<rect class="ix-lossground" x="' + padL + '" y="' + padT + '" width="' + (lossBins * slot).toFixed(1) + '" height="' + innerH + '"/>');
    for (var g = 0; g <= 4; g++) {
      var yv = Math.round(maxCount * g / 4), y = padT + innerH - (yv / maxCount) * innerH;
      parts.push('<line class="grid" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '"/>');
      parts.push('<text class="axis" x="' + (padL - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + yv + '</text>');
    }
    function bar(cls, count, total, x, w, label, who) {
      var h = (count / maxCount) * innerH;
      if (h <= 0.5) return;
      var y = padT + innerH - h;
      parts.push('<rect class="ixbar ' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"><title>' +
        esc(who + ': ' + count + ' of ' + total + ' periods returned ' + label) + '</title></rect>');
      parts.push('<text class="barlabel" x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="middle">' + count + '</text>');
    }
    var dp = edges.some(function (e) { return Math.abs(e * 100 - Math.round(e * 100)) > 1e-9; }) ? 1 : 0;
    bins.forEach(function (b, i) {
      var x0 = padL + i * slot + gap / 2;
      var label = pct(b.from, dp) + ' to ' + pct(b.to, dp) + ' a year';
      if (bbins) {
        var half = bw / 2 - 1;
        bar('fund', b.count, values.length, x0, half, label, o.name || 'this fund');
        bar('bench', bbins[i].count, o.compare.length, x0 + half + 2, half, label, o.compareName || 'the index');
      } else bar('fund', b.count, values.length, x0, bw, label, o.name || 'this fund');
      parts.push('<text class="axis" x="' + (x0 - gap / 2).toFixed(1) + '" y="' + (padT + innerH + 17) + '" text-anchor="middle">' + (b.from * 100).toFixed(dp) + '</text>');
      if (i === bins.length - 1) parts.push('<text class="axis" x="' + (x0 + bw + gap / 2).toFixed(1) + '" y="' + (padT + innerH + 17) + '" text-anchor="middle">' + (b.to * 100).toFixed(dp) + '</text>');
    });
    if (lossBins) {
      var zx = padL + lossBins * slot;
      parts.push('<line class="ix-zerorule" x1="' + zx.toFixed(1) + '" y1="' + padT + '" x2="' + zx.toFixed(1) + '" y2="' + (padT + innerH) + '"/>');
      parts.push('<text class="axis ix-lossword" x="' + (padL + 4) + '" y="' + (padT + 12) + '">Lost money</text>');
    }
    parts.push('<line class="zero" x1="' + padL + '" y1="' + (padT + innerH) + '" x2="' + (W - padR) + '" y2="' + (padT + innerH) + '"/>');
    parts.push('<text class="axis" x="' + (padL + innerW / 2) + '" y="' + (H - 8) + '" text-anchor="middle">Return, % a year, over each ' + o.years + '-year holding period</text>');
    var alt = 'How many ' + o.years + '-year periods ended in each range of return. ' +
      bins.filter(function (b) { return b.count; }).map(function (b) { return b.count + ' between ' + pct(b.from, dp) + ' and ' + pct(b.to, dp); }).join('; ') + '.';
    var legend = key('fund', o.name || 'this fund') + (bbins ? key('bench', o.compareName || 'the index') : '') +
      (lossBins ? '<span class="key"><span class="swatch ix-lossswatch"></span>Shaded: periods that lost money</span>' : '');
    return fig(o.caption || ('Each bar counts the ' + o.years + '-year periods that ended in that range'),
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + parts.join('') + '</svg>', legend, alt, 'ixhist');
  }

  /* ------------------------------------------------ growth of a fixed sum
   * Fund and index rebased on the first shared date, logarithmic axis so the
   * early years are not squashed flat; marks on the reader's own dates. */
  function growth(series, opts) {
    var o = opts || {};
    if (!series || series.length < 2) return '';
    var W = 640, H = 280, padL = 58, padR = 14, padT = 14, padB = 34;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var all = series.slice();
    if (o.compare) all = all.concat(o.compare);
    var lo = Infinity, hi = -Infinity, t0 = Infinity, t1 = -Infinity;
    all.forEach(function (p) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t; });
    if (!(lo > 0) || t1 <= t0) return '';
    var llo = Math.log(lo) - 0.04, lhi = Math.log(hi) + 0.04;
    function x(t) { return padL + (t - t0) / (t1 - t0) * innerW; }
    function y(v) { return padT + (lhi - Math.log(v)) / (lhi - llo) * innerH; }
    function thin(s) {
      var step = Math.max(1, Math.ceil(s.length / 700)), pts = [];
      for (var i = 0; i < s.length; i += step) pts.push(x(s[i].t).toFixed(1) + ',' + y(s[i].v).toFixed(1));
      pts.push(x(s[s.length - 1].t).toFixed(1) + ',' + y(s[s.length - 1].v).toFixed(1));
      return pts.join(' ');
    }
    var parts = [];
    /* guides at round multiples of the base */
    var base = o.base || 10000;
    var mults = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128];
    mults.forEach(function (m) {
      var v = base * m;
      if (v < lo || v > hi) return;
      parts.push('<line class="grid" x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(v).toFixed(1) + '"/>');
      parts.push('<text class="axis" x="' + (padL - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(A.short(v)) + '</text>');
    });
    if (o.compare) parts.push('<polyline class="rl-line bench" points="' + thin(o.compare) + '"/>');
    parts.push('<polyline class="rl-line" points="' + thin(series) + '"/>');
    var marks = o.marks || [], mr = marks.length > 60 ? 2.4 : marks.length > 24 ? 3 : 4;
    marks.forEach(function (m) {
      if (m.t < t0 || m.t > t1) return;
      var obs = E.atOrBefore(series, m.t, 10);
      if (!obs) return;
      parts.push('<circle class="mark ' + (m.kind === 'out' ? 'out' : 'in') + '" cx="' + x(m.t).toFixed(1) + '" cy="' + y(obs.v).toFixed(1) + '" r="' + mr + '"><title>' +
        esc(fmtDate(m.t) + ': ' + (m.kind === 'out' ? 'money out ' : 'money in ') + money(m.amount)) + '</title></circle>');
    });
    parts.push('<text x="' + padL + '" y="' + (H - 8) + '" class="rl-axis">' + fmtDate(t0) + '</text>');
    parts.push('<text x="' + (W - padR) + '" y="' + (H - 8) + '" class="rl-axis" text-anchor="end">' + fmtDate(t1) + '</text>');
    var legend = key('fund', o.name || 'this fund') + (o.compare ? key('bench', o.compareName || 'the index') : '') +
      (o.marks && o.marks.length ? '<span class="key"><span class="legend-dot markin"></span>your money in</span>' +
        (o.marks.some(function (m) { return m.kind === 'out'; }) ? '<span class="key"><span class="legend-dot markout"></span>money out</span>' : '') : '');
    var last = series[series.length - 1].v;
    var alt = money(base) + ' on ' + fmtDate(t0) + ' would be ' + money(last) + ' on ' + fmtDate(t1) +
      (o.compare ? ' in ' + (o.name || 'this fund') + ', and ' + money(o.compare[o.compare.length - 1].v) + ' in ' + (o.compareName || 'the index') : '') + '.';
    return fig(o.caption || ('What ' + money(base) + ' on ' + fmtDate(t0) + ' became, day by day. The axis is logarithmic, so an equal rise anywhere is the same slope.'),
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + parts.join('') + '</svg>', legend, alt, 'growth');
  }

  /* --------------------------------------- every window, in start-date order */
  function rollingLine(pairs, years, s, benchPairs, compareName, name) {
    if (!pairs || pairs.length < 3) return '';
    var W = 640, H = 240, padL = 8, padR = 72, padT = 12, padB = 26;
    var t0 = pairs[0].t, t1 = pairs[pairs.length - 1].t;
    if (t1 <= t0) return '';
    var lo = Math.min(s.min, 0), hi = Math.max(s.max, 0);
    var bp = benchPairs && benchPairs.length >= 3 ? benchPairs : null;
    if (bp) bp.forEach(function (m) { if (m.bench < lo) lo = m.bench; if (m.bench > hi) hi = m.bench; });
    var span = hi - lo || 1;
    lo -= span * 0.06; hi += span * 0.06; span = hi - lo;
    function x(t) { return padL + (t - t0) / (t1 - t0) * (W - padL - padR); }
    function y(v) { return padT + (hi - v) / span * (H - padT - padB); }
    var step = Math.max(1, Math.ceil(pairs.length / 700)), pts = [];
    for (var i = 0; i < pairs.length; i += step) pts.push(x(pairs[i].t).toFixed(1) + ',' + y(pairs[i].r).toFixed(1));
    pts.push(x(t1).toFixed(1) + ',' + y(pairs[pairs.length - 1].r).toFixed(1));
    var bpts = [];
    if (bp) {
      var bstep = Math.max(1, Math.ceil(bp.length / 700));
      for (var k = 0; k < bp.length; k += bstep) { if (bp[k].t < t0 || bp[k].t > t1) continue; bpts.push(x(bp[k].t).toFixed(1) + ',' + y(bp[k].bench).toFixed(1)); }
    }
    var guides = [{ v: s.p90, label: '90th ' + pct(s.p90) }, { v: s.median, label: 'median ' + pct(s.median) }, { v: s.p10, label: '10th ' + pct(s.p10) }];
    guides.forEach(function (g) { g.ly = y(g.v); });
    guides.sort(function (a, b) { return a.ly - b.ly; });
    for (var gi = 1; gi < guides.length; gi++) if (guides[gi].ly - guides[gi - 1].ly < 13) guides[gi].ly = guides[gi - 1].ly + 13;
    var guideSvg = guides.map(function (g) {
      var yy = y(g.v).toFixed(1);
      return '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" class="rl-guide"/><text x="' + (W - padR + 5) + '" y="' + g.ly.toFixed(1) + '" class="rl-glabel" dominant-baseline="middle">' + esc(g.label) + '</text>';
    }).join('');
    var zero = (0 >= lo && 0 <= hi) ? '<line x1="' + padL + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(0).toFixed(1) + '" class="rl-zero"/>' : '';
    var svg = '<svg class="rollline" viewBox="0 0 ' + W + ' ' + H + '">' + zero + guideSvg +
      (bpts.length ? '<polyline class="rl-line bench" points="' + bpts.join(' ') + '"/>' : '') +
      '<polyline class="rl-line" points="' + pts.join(' ') + '"/>' +
      '<text x="' + padL + '" y="' + (H - 8) + '" class="rl-axis">' + fmtDate(t0) + '</text>' +
      '<text x="' + (W - padR) + '" y="' + (H - 8) + '" class="rl-axis" text-anchor="end">' + fmtDate(t1) + '</text></svg>';
    var legend = key('fund', name || 'this fund') + (bpts.length ? key('bench', compareName || 'the index') : '');
    return fig('Each point is the return of one ' + years + '-year holding period, plotted at the date it began. The lines mark the middle and the outer tenths.',
      svg, legend, 'Rolling ' + years + '-year returns by start date, from ' + fmtDate(t0) + ' to ' + fmtDate(t1) + '.', 'rollfig');
  }

  /* --------------------------------------------------- the fan by horizon */
  function fan(rows, benchRows, chosenYears, key_, compareName, name) {
    if (!rows || rows.length < 2) return '';
    var W = 640, H = 250, padL = 46, padR = 16, padT = 14, padB = 34;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var lo = 0, hi = 0;
    rows.forEach(function (row) {
      lo = Math.min(lo, row.s.p10, row.s.min); hi = Math.max(hi, row.s.p90, row.s.max);
      var b = benchRows && benchRows[row.h];
      if (b) { lo = Math.min(lo, b.p10); hi = Math.max(hi, b.p90); }
    });
    var span = hi - lo || 1;
    lo -= span * 0.08; hi += span * 0.08; span = hi - lo;
    var h0 = rows[0].h, h1 = rows[rows.length - 1].h;
    function x(h) { return h1 === h0 ? padL : padL + (h - h0) / (h1 - h0) * innerW; }
    function y(v) { return padT + (hi - v) / span * innerH; }
    function pt(h, v) { return x(h).toFixed(1) + ',' + y(v).toFixed(1); }
    var parts = [];
    var stepPct = niceStep(span, 6);
    for (var g = Math.ceil(lo / stepPct) * stepPct; g <= hi; g += stepPct) {
      var gy = y(g).toFixed(1);
      parts.push('<line class="grid" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>');
      parts.push('<text class="axis" x="' + (padL - 6) + '" y="' + (y(g) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(g * 100) + '%</text>');
    }
    if (lo < 0 && hi > 0) parts.push('<line class="rl-zero" x1="' + padL + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(0).toFixed(1) + '"/>');
    var upper = rows.map(function (row) { return pt(row.h, row.s.p90); });
    var lower = rows.slice().reverse().map(function (row) { return pt(row.h, row.s.p10); });
    parts.push('<polygon class="fan-band fund" points="' + upper.concat(lower).join(' ') + '"/>');
    parts.push('<polyline class="fan-line fund" points="' + rows.map(function (row) { return pt(row.h, row.s.median); }).join(' ') + '"/>');
    var withBench = benchRows ? rows.filter(function (row) { return !!benchRows[row.h]; }) : [];
    if (withBench.length >= 2) {
      parts.push('<polyline class="fan-edge bench" points="' + withBench.map(function (row) { return pt(row.h, benchRows[row.h].p90); }).join(' ') + '"/>');
      parts.push('<polyline class="fan-edge bench" points="' + withBench.map(function (row) { return pt(row.h, benchRows[row.h].p10); }).join(' ') + '"/>');
      parts.push('<polyline class="fan-line bench" points="' + withBench.map(function (row) { return pt(row.h, benchRows[row.h].median); }).join(' ') + '"/>');
    }
    rows.forEach(function (row, i) {
      var cx = x(row.h);
      var left = i === 0 ? padL : (x(rows[i - 1].h) + cx) / 2;
      var right = i === rows.length - 1 ? W - padR : (x(rows[i + 1].h) + cx) / 2;
      var b = benchRows && benchRows[row.h];
      parts.push('<circle class="fan-dot fund' + (row.h === chosenYears ? ' now' : '') + '" cx="' + cx.toFixed(1) + '" cy="' + y(row.s.median).toFixed(1) + '" r="4"/>');
      parts.push('<text class="axis" x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + row.h + 'y</text>');
      parts.push('<rect class="fan-hit" data-fan-h="' + row.h + '" data-key="' + esc(key_) + '" data-p10="' + pct(row.s.p10) + '" data-med="' + pct(row.s.median) + '" data-p90="' + pct(row.s.p90) + '" data-n="' + row.s.count + '"' +
        (b ? ' data-b10="' + pct(b.p10) + '" data-bmed="' + pct(b.median) + '" data-b90="' + pct(b.p90) + '"' : '') +
        ' x="' + left.toFixed(1) + '" y="' + padT + '" width="' + (right - left).toFixed(1) + '" height="' + innerH + '" tabindex="0" role="button" aria-label="' + row.h +
        '-year horizon: 10th ' + pct(row.s.p10) + ', median ' + pct(row.s.median) + ', 90th ' + pct(row.s.p90) + '"><title>' + row.h + ' years: 10th ' + pct(row.s.p10) + ' · median ' + pct(row.s.median) + ' · 90th ' + pct(row.s.p90) + '</title></rect>');
    });
    parts.push('<text class="axis" x="' + (padL + innerW / 2) + '" y="' + (H - 1) + '" text-anchor="middle">Holding period, years</text>');
    var chosen = rows.filter(function (row) { return row.h === chosenYears; })[0] || rows[0];
    var legend = '<span class="key"><span class="legend-dot fund"></span>' + esc(name || 'this fund') + ' (band and median)</span>' +
      (withBench.length >= 2 ? '<span class="key"><span class="legend-dot bench"></span>' + esc(compareName) + ' (dashed)</span>' : '');
    return fig('Return by holding period: the shaded band runs from the 10th to the 90th percentile, the line through it is the median' +
      (withBench.length >= 2 ? '; dashed, ' + compareName + ' over the windows both files cover' : '') + '. Tap a horizon for its figures.',
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + parts.join('') + '</svg>',
      legend + '<p class="hint fan-readout" id="fanout-' + esc(key_) + '" aria-live="polite">' +
        fanReadout(chosen.h, chosen.s.p10, chosen.s.median, chosen.s.p90, chosen.s.count, benchRows && benchRows[chosen.h], compareName) + '</p>',
      'Fan chart of rolling returns by holding period', 'fanchart');
  }
  function fanReadout(h, p10, med, p90, n, b, compareName) {
    function f(v) { return typeof v === 'number' ? pct(v) : v; }
    var text = h + (+h === 1 ? ' year' : ' years') + ': 10th percentile ' + f(p10) + ' · median ' + f(med) + ' · 90th percentile ' + f(p90) + ' (' + Number(n).toLocaleString('en-IN') + ' windows)';
    if (b) text += '; ' + (compareName || 'the index') + ': 10th ' + f(b.p10) + ' · median ' + f(b.median) + ' · 90th ' + f(b.p90);
    return text;
  }

  /* -------------------------------------------------------------- the goal bar */
  function goalBar(plan) {
    var W = 360, H = 112, padL = 8, padR = 8, padT = 30;
    var innerW = W - padL - padR;
    var top = Math.max(plan.projected, plan.target) * 1.06;
    var barH = 34, y = padT;
    var wCorpus = (plan.fromCorpus / top) * innerW, wSip = (plan.fromSip / top) * innerW;
    var xTarget = padL + (plan.target / top) * innerW;
    var parts = [];
    if (wCorpus > 1) parts.push('<rect x="' + padL + '" y="' + y + '" width="' + wCorpus.toFixed(1) + '" height="' + barH + '" rx="4" fill="var(--series-1)"><title>' + esc('From what you already have: ' + money(plan.fromCorpus)) + '</title></rect>');
    if (wSip > 1) parts.push('<rect x="' + (padL + wCorpus + 2).toFixed(1) + '" y="' + y + '" width="' + Math.max(0, wSip - 2).toFixed(1) + '" height="' + barH + '" rx="4" fill="var(--series-2)"><title>' + esc('From your monthly investing: ' + money(plan.fromSip)) + '</title></rect>');
    if (plan.projected < plan.target) {
      var xEnd = padL + ((plan.fromCorpus + plan.fromSip) / top) * innerW, wGap = Math.max(0, xTarget - xEnd);
      if (wGap > 1) {
        parts.push('<defs><pattern id="gaphatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted)" stroke-width="2"/></pattern></defs>');
        parts.push('<rect x="' + (xEnd + 2).toFixed(1) + '" y="' + y + '" width="' + Math.max(0, wGap - 2).toFixed(1) + '" height="' + barH + '" rx="4" fill="url(#gaphatch)" stroke="var(--muted)" stroke-width="1"><title>' + esc('Still to find: ' + money(plan.target - plan.projected)) + '</title></rect>');
        parts.push('<text class="barlabel gap" x="' + ((xEnd + xTarget) / 2).toFixed(1) + '" y="' + (y + barH / 2 + 4) + '" text-anchor="middle" stroke="var(--surface)" stroke-width="4" paint-order="stroke">' + esc(A.short(plan.target - plan.projected)) + ' short</text>');
      }
    }
    parts.push('<line x1="' + xTarget.toFixed(1) + '" y1="' + (y - 12) + '" x2="' + xTarget.toFixed(1) + '" y2="' + (y + barH + 12) + '" stroke="var(--ink)" stroke-width="2" stroke-dasharray="4 3"/>');
    parts.push('<text class="barlabel" x="' + xTarget.toFixed(1) + '" y="' + (y - 14) + '" text-anchor="' + (xTarget > W * 0.7 ? 'end' : 'middle') + '">Goal ' + esc(money(plan.target)) + '</text>');
    parts.push('<text class="barlabel" x="' + padL + '" y="' + (y + barH + 22) + '">You land at ' + esc(money(plan.projected)) + '</text>');
    var legend = '<span class="key"><span class="swatch" style="background:var(--series-1)"></span>What you already have, grown</span>' +
      '<span class="key"><span class="swatch" style="background:var(--series-2)"></span>What your monthly investing adds</span>' +
      (plan.projected < plan.target ? '<span class="key"><span class="swatch hatched"></span>Still to find</span>' : '');
    return fig('Where your money comes from, against the goal line', '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:36rem">' + parts.join('') + '</svg>', legend,
      'Projected ' + money(plan.projected) + ' against a goal of ' + money(plan.target) + ', made up of ' + money(plan.fromCorpus) + ' from existing savings and ' + money(plan.fromSip) + ' from monthly investing.');
  }

  root.PRCCharts = { histogram: histogram, growth: growth, rollingLine: rollingLine, fan: fan, fanReadout: fanReadout, goalBar: goalBar };
})(typeof globalThis !== 'undefined' ? globalThis : this);
