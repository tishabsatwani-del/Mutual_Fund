/* Where You Stand — the life-line.
 *
 * Review v3, section 6: the fund's whole life as one thin ink line across the
 * screen, with the reader's own stretch marked — a marker band under that
 * segment by day, the segment itself in marker by night. Three small marks
 * with their figures beside them: the worst window of the reader's length, the
 * best, and the latest.
 *
 * It is the chapter's question drawn — which window is this? — and it is the
 * product's name drawn. It appears on Tool 2 and Tool 3, and nowhere else in
 * the product is the marker used on a chart.
 *
 * Inline SVG rather than canvas: after decimation there are only a few hundred
 * points, and SVG stays crisp at any pixel ratio, prints, and can carry its own
 * accessible description without a second code path.
 */
(function (root) {
  'use strict';

  var W = 1000, H = 190;                    /* a viewBox; the CSS sizes it */
  var PAD = { l: 2, r: 2, t: 26, b: 22 };

  /* Min/max bucketing rather than plain sampling: it keeps every peak and every
   * trough, so a crash that lasted a fortnight cannot vanish because no sample
   * happened to land in it. */
  function decimate(series, target) {
    if (series.length <= target) return series.slice();
    var out = [], step = series.length / (target / 2);
    for (var i = 0; i < series.length; i += step) {
      var lo = series[Math.floor(i)], hi = lo;
      for (var j = Math.floor(i); j < Math.min(series.length, i + step); j++) {
        if (series[j].v < lo.v) lo = series[j];
        if (series[j].v > hi.v) hi = series[j];
      }
      if (lo.t <= hi.t) { out.push(lo); if (hi !== lo) out.push(hi); }
      else { out.push(hi); out.push(lo); }
    }
    if (out[out.length - 1] !== series[series.length - 1]) out.push(series[series.length - 1]);
    return out;
  }

  /* A fund's whole life is drawn on a log scale. Over two decades a linear axis
   * squashes the first ten years flat against the floor, which misrepresents
   * exactly the years the reader is being asked to look at. Nobody reads a
   * value off this line — the three marks carry the figures — so the axis owes
   * the reader shape, and log is the shape that is true. */
  function scales(series) {
    var t0 = series[0].t, t1 = series[series.length - 1].t;
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < series.length; i++) {
      if (series[i].v < lo) lo = series[i].v;
      if (series[i].v > hi) hi = series[i].v;
    }
    var a = Math.log(lo), b = Math.log(hi), span = (b - a) || 1;
    return {
      x: function (t) { return PAD.l + (t - t0) / ((t1 - t0) || 1) * (W - PAD.l - PAD.r); },
      y: function (v) { return H - PAD.b - (Math.log(v) - a) / span * (H - PAD.t - PAD.b); },
      t0: t0, t1: t1
    };
  }

  function path(points, s) {
    var d = '';
    for (var i = 0; i < points.length; i++) {
      d += (i ? 'L' : 'M') + s.x(points[i].t).toFixed(1) + ' ' + s.y(points[i].v).toFixed(1);
    }
    return d;
  }

  function esc(x) {
    return String(x).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  /* options:
   *   series   [{t, v}] the fund's whole life, ascending
   *   stretch  { from, to } the reader's own stretch, or null
   *   marks    [{ t, kind: 'worst'|'best'|'latest', text }] at most three
   *   describe a sentence for a screen reader, built by the caller from copy
   */
  function render(options) {
    var o = options || {};
    var series = o.series || [];
    if (series.length < 2) return '';
    var full = decimate(series, 600);
    var s = scales(full);

    var svg = '';
    svg += '<svg class="lifeline" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
           'role="img" aria-label="' + esc(o.describe || 'The fund\'s whole recorded life.') + '">';

    /* the reader's stretch: a band under the segment by day, and the segment
       redrawn in marker for the night sheet. Both ship; CSS shows one. */
    if (o.stretch && isFinite(o.stretch.from) && isFinite(o.stretch.to)) {
      var x0 = s.x(o.stretch.from), x1 = s.x(o.stretch.to);
      svg += '<rect class="ll-band" x="' + x0.toFixed(1) + '" y="' + PAD.t + '" ' +
             'width="' + Math.max(1, x1 - x0).toFixed(1) + '" height="' + (H - PAD.t - PAD.b) + '"/>';
      var inside = full.filter(function (p) { return p.t >= o.stretch.from && p.t <= o.stretch.to; });
      if (inside.length > 1) {
        svg += '<path class="ll-mine" d="' + path(inside, s) + '" fill="none"/>';
      }
    }

    svg += '<path class="ll-life" d="' + path(full, s) + '" fill="none"/>';

    (o.marks || []).slice(0, 3).forEach(function (m, i) {
      if (!isFinite(m.t)) return;
      var x = s.x(m.t);
      svg += '<line class="ll-mark" x1="' + x.toFixed(1) + '" y1="' + PAD.t + '" ' +
             'x2="' + x.toFixed(1) + '" y2="' + (H - PAD.b) + '"/>';
      var anchor = x > W * 0.75 ? 'end' : x < W * 0.25 ? 'start' : 'middle';
      svg += '<text class="ll-mark-text" x="' + x.toFixed(1) + '" y="' + (PAD.t - 9) + '" ' +
             'text-anchor="' + anchor + '">' + esc(m.text || '') + '</text>';
    });

    svg += '</svg>';
    return svg;
  }

  /* The same information as words, because a line nobody can see is not a
   * reading. The caller supplies the phrasing; this supplies the shape. */
  function tableRows(options) {
    var o = options || {}, rows = [];
    var series = o.series || [];
    if (series.length) {
      rows.push(['First NAV in this history', o.fmtDate(series[0].t)]);
      rows.push(['Latest NAV', o.fmtDate(series[series.length - 1].t)]);
    }
    if (o.stretch) {
      rows.push(['Your stretch', o.fmtDate(o.stretch.from) + ' to ' + o.fmtDate(o.stretch.to)]);
    }
    (o.marks || []).forEach(function (m) { rows.push([m.rowLabel || m.text, o.fmtDate(m.t)]); });
    return rows;
  }

  var api = { render: render, tableRows: tableRows, decimate: decimate, scales: scales };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LifeLine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
