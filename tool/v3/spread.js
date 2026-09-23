/* Where You Stand — every window, in order.
 *
 * The life-line draws the fund's NAV over its whole life. This draws something
 * else entirely: each rolling window's ANNUALISED RETURN plotted against the
 * day that window began. Same history, a different question.
 *
 * Why it earns a place. The reading above it gives three numbers — worst,
 * typical, best — and a histogram behind "How often" gives their distribution.
 * Neither shows ORDER. A fund whose bad windows are one cluster in 2008 and a
 * fund whose bad windows are scattered through every decade produce the same
 * three figures and the same histogram, and they are not the same fund to hold.
 * The only way to see that is to put the windows back in the order they
 * happened, which is what this is.
 *
 * It reads as a reading, not as a trading chart:
 *
 *   One ink line. No marker anywhere — the marker means "you", and on this
 *   screen there is no "you"; this is the fund's record, not the reader's.
 *   No red and no green: a window that ended below zero is not a colour, it is
 *   a position relative to the zero rule.
 *
 *   Two hairlines, labelled: zero, and the typical. Everything the reader
 *   needs to place a point is one of those two.
 *
 *   Reading it is by touch or arrow key, and what it reports is a date and a
 *   figure — never a tooltip that floats and vanishes. The same information is
 *   a table underneath, because a line nobody can see is not a reading.
 */
(function (root) {
  'use strict';

  var W = 1000, H = 200;
  var PAD = { l: 2, r: 2, t: 16, b: 26 };

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  /* Min/max bucketing, as the life-line does: a single savage window must not
   * vanish because no sample happened to land on it. */
  function decimate(points, target) {
    if (points.length <= target) return points.slice();
    var out = [], step = points.length / (target / 2);
    for (var i = 0; i < points.length; i += step) {
      var lo = points[Math.floor(i)], hi = lo;
      for (var j = Math.floor(i); j < Math.min(points.length, i + step); j++) {
        if (points[j].r < lo.r) lo = points[j];
        if (points[j].r > hi.r) hi = points[j];
      }
      if (lo.startT <= hi.startT) { out.push(lo); if (hi !== lo) out.push(hi); }
      else { out.push(hi); out.push(lo); }
    }
    var last = points[points.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  }

  /* A LINEAR y axis here, unlike the life-line's log one. These are rates, not
   * prices: the distance from 8% to 12% and from 20% to 24% is the same four
   * points, and a log axis would say otherwise. Zero is always inside the
   * range, even when no window reached it, because "did any window end below
   * zero" is the question this chart is most often asked. */
  function scales(points) {
    var t0 = points[0].startT, t1 = points[points.length - 1].startT;
    /* The DATA's own range, kept separate from the padded drawing range. Zero
     * is included in the axis so the reader can always see how far above it the
     * fund ran, but whether the zero RULE is worth drawing is a question about
     * the windows, not about the padding: if nothing ended below zero, a rule
     * pinned to the floor says nothing the count above it has not already said,
     * and its label has nowhere to sit. */
    var dataLo = Infinity, dataHi = -Infinity;
    for (var i = 0; i < points.length; i++) {
      if (points[i].r < dataLo) dataLo = points[i].r;
      if (points[i].r > dataHi) dataHi = points[i].r;
    }
    var lo = Math.min(0, dataLo), hi = Math.max(0, dataHi);
    var pad = (hi - lo) * 0.08 || 0.01;
    lo -= pad; hi += pad;
    return {
      x: function (t) { return PAD.l + (t - t0) / ((t1 - t0) || 1) * (W - PAD.l - PAD.r); },
      y: function (r) { return H - PAD.b - (r - lo) / ((hi - lo) || 1) * (H - PAD.t - PAD.b); },
      t0: t0, t1: t1, lo: lo, hi: hi, dataLo: dataLo, dataHi: dataHi,
      crossesZero: dataLo < 0
    };
  }

  function path(points, s) {
    var d = '';
    for (var i = 0; i < points.length; i++) {
      d += (i ? 'L' : 'M') + s.x(points[i].startT).toFixed(1) + ' ' + s.y(points[i].r).toFixed(1);
    }
    return d;
  }

  /* options:
   *   points    [{startT, endT, r, days}] every window, ascending by startT
   *   median    the typical window's rate, drawn as the second hairline
   *   years     the window length, for the description
   *   name      the fund's own name
   *   fmt       { pct, date } — the one formatter, passed in rather than reached for
   */
  function label(at, text) {
    return '<span class="sp-label' + (at.below ? ' sp-below' : '') +
      '" style="top:' + at.top + '%">' + esc(text) + '</span>';
  }

  function render(options) {
    var o = options || {};
    var all = (o.points || []).slice().sort(function (a, b) { return a.startT - b.startT; });
    if (all.length < 2) return '';
    var pts = decimate(all, 600);
    var s = scales(all);
    var fmt = o.fmt;

    var svg = '<svg class="spread" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
      'role="img" aria-label="' + esc(o.describe || '') + '">';

    /* zero first, so the line is drawn over it -- and only when a window
       actually ended below it */
    if (s.crossesZero) {
      svg += '<line class="sp-zero" x1="' + PAD.l + '" y1="' + s.y(0).toFixed(1) +
             '" x2="' + (W - PAD.r) + '" y2="' + s.y(0).toFixed(1) + '"/>';
    }
    if (isFinite(o.median)) {
      svg += '<line class="sp-median" x1="' + PAD.l + '" y1="' + s.y(o.median).toFixed(1) +
             '" x2="' + (W - PAD.r) + '" y2="' + s.y(o.median).toFixed(1) + '"/>';
    }
    svg += '<path class="sp-line" d="' + path(pts, s) + '" fill="none"/>';
    svg += '<circle class="sp-dot" cx="-99" cy="-99" r="4" opacity="0"/>';
    svg += '</svg>';

    /* The two hairlines name themselves, in the page's own type rather than
       inside a stretched viewBox where a glyph comes out a third of its width. */
    var labels = '<div class="sp-labels" aria-hidden="true">';
    if (s.crossesZero) labels += label(place(s.y(0)), 'zero');
    if (isFinite(o.median)) {
      labels += label(place(s.y(o.median)), 'typical ' + fmt.pct(o.median));
    }
    labels += '</div>';

    var ends = '<div class="sp-ends" aria-hidden="true"><span>' + esc(fmt.date(s.t0)) +
      '</span><span>' + esc(fmt.date(s.t1)) + '</span></div>';

    /* The readout is a live region, so reading the line by touch or by arrow
       key says the same thing to a screen reader that it shows on screen. */
    var readout = '<p class="sp-readout" aria-live="polite">' +
      esc(o.hint || 'Drag across the line, or use the arrow keys, to read any window.') + '</p>';

    return '<div class="sp-wrap" tabindex="0" role="application" ' +
      'aria-label="' + esc(o.describe || '') + '">' +
      svg + labels + ends + readout + '</div>';
  }

  /* A label belongs to its hairline and must stay with it. Clamping it away
   * from the bottom kept it clear of the dates but left it floating in empty
   * space with its own rule far below — worse than the collision it fixed.
   * It sits ABOVE its rule normally and BELOW it when the rule is low, which
   * uses the plot's own bottom padding and never reaches the date strip. */
  function place(y) {
    var p = y / H * 100;
    return { top: p.toFixed(2), below: p > 78 };
  }

  /* Wire reading-by-touch after the markup is in the document. Pure geometry:
   * the nearest window by start date, reported as a date and a figure. */
  function wire(wrap, points, fmt, sayWindow) {
    if (!wrap || !points || points.length < 2) return;
    var all = points.slice().sort(function (a, b) { return a.startT - b.startT; });
    var svg = wrap.querySelector('.spread');
    var dot = wrap.querySelector('.sp-dot');
    var out = wrap.querySelector('.sp-readout');
    var s = scales(all);
    var at = -1;

    function show(i) {
      if (i < 0 || i >= all.length) return;
      at = i;
      var p = all[i];
      dot.setAttribute('cx', s.x(p.startT).toFixed(1));
      dot.setAttribute('cy', s.y(p.r).toFixed(1));
      dot.setAttribute('opacity', '1');
      out.textContent = sayWindow(p);
    }

    function fromClientX(clientX) {
      var box = svg.getBoundingClientRect();
      if (!box.width) return;
      var frac = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
      var want = s.t0 + frac * (s.t1 - s.t0);
      var best = 0, gap = Infinity;
      for (var i = 0; i < all.length; i++) {
        var d = Math.abs(all[i].startT - want);
        if (d < gap) { gap = d; best = i; }
      }
      show(best);
    }

    wrap.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'mouse' && e.buttons === 0) { fromClientX(e.clientX); return; }
      fromClientX(e.clientX);
    });
    wrap.addEventListener('pointerdown', function (e) { fromClientX(e.clientX); });
    wrap.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? Math.max(1, Math.round(all.length / 20)) : 1;
      if (e.key === 'ArrowRight') { show(at < 0 ? 0 : Math.min(all.length - 1, at + step)); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { show(at < 0 ? all.length - 1 : Math.max(0, at - step)); e.preventDefault(); }
      else if (e.key === 'Home') { show(0); e.preventDefault(); }
      else if (e.key === 'End') { show(all.length - 1); e.preventDefault(); }
    });
  }

  /* The same information as rows, because a line nobody can see is not a
   * reading. The caller supplies the phrasing; this supplies the shape. */
  function tableRows(points, fmt) {
    var all = (points || []).slice().sort(function (a, b) { return a.startT - b.startT; });
    if (!all.length) return [];
    var worst = all[0], best = all[0];
    all.forEach(function (p) { if (p.r < worst.r) worst = p; if (p.r > best.r) best = p; });
    var below = all.filter(function (p) { return p.r < 0; });
    var rows = [
      ['First window began', fmt.date(all[0].startT)],
      ['Last window began', fmt.date(all[all.length - 1].startT)],
      ['The worst began', fmt.date(worst.startT) + ' · ' + fmt.pct(worst.r)],
      ['The best began', fmt.date(best.startT) + ' · ' + fmt.pct(best.r)]
    ];
    if (below.length) {
      rows.push(['Windows that ended below zero',
                 fmt.count(below.length) + ' of ' + fmt.count(all.length) +
                 ', the last beginning ' + fmt.date(below[below.length - 1].startT)]);
    }
    return rows;
  }

  var api = { render: render, wire: wire, tableRows: tableRows, decimate: decimate, scales: scales };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Spread = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
