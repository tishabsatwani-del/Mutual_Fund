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

  /* Rebase both series to 100 at the first date they share.
   *
   * A fund's NAV and an index fund's NAV are different numbers on different
   * scales; drawing them raw would put one far above the other and say nothing.
   * Rebased, the two lines answer the only question worth asking of them side
   * by side: which shape did each make over the same days. */
  function rebase(series, fromT) {
    var base = null;
    for (var i = 0; i < series.length; i++) {
      if (series[i].t >= fromT) { base = series[i].v; break; }
    }
    if (!base) return [];
    return series.filter(function (p) { return p.t >= fromT; })
                 .map(function (p) { return { t: p.t, v: p.v / base * 100 }; });
  }

  /* options:
   *   series    [{t, v}] the fund's whole life, ascending
   *   compare   [{t, v}] the index fund, drawn in slate on the same axes
   *   stretch   { from, to } the reader's own stretch, or null
   *   marks     [{ t, kind, text }] labelled beneath the line
   *   describe  a sentence for a screen reader, built by the caller from copy
   */
  function render(options) {
    var o = options || {};
    var series = o.series || [];
    if (series.length < 2) return '';

    var from = series[0].t;
    var mine = o.compare && o.compare.length ? rebase(series, from) : series;
    var theirs = o.compare && o.compare.length ? rebase(o.compare, from) : null;

    var full = decimate(mine, 600);
    var other = theirs ? decimate(theirs, 600) : null;
    var s = scales(other ? full.concat(other) : full);

    var svg = '';
    svg += '<svg class="lifeline" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
           'role="img" aria-label="' + esc(o.describe || 'The fund\'s whole recorded life.') + '">';

    /* the reader's stretch: a band under the segment by day, and the segment
       redrawn in marker for the night sheet. Both ship; CSS shows one. */
    var bandMid = null;
    if (o.stretch && isFinite(o.stretch.from) && isFinite(o.stretch.to)) {
      var x0 = s.x(o.stretch.from), x1 = s.x(o.stretch.to);
      bandMid = (x0 + x1) / 2;
      var inside = full.filter(function (p) { return p.t >= o.stretch.from && p.t <= o.stretch.to; });

      /* The band hugs the line through the reader's stretch rather than filling
       * the chart's whole height. A full-height block reads as a shaded region
       * of the axis; a band around the line reads as what it is — a highlighter
       * drawn over that part of the page. */
      var top = H - PAD.b, bot = PAD.t;
      inside.forEach(function (p) {
        var y = s.y(p.v);
        if (y < top) top = y;
        if (y > bot) bot = y;
      });
      var PADY = 9;
      top = Math.max(PAD.t, top - PADY);
      bot = Math.min(H - PAD.b, bot + PADY);
      svg += '<rect class="ll-band" x="' + x0.toFixed(1) + '" y="' + top.toFixed(1) + '" ' +
             'width="' + Math.max(1, x1 - x0).toFixed(1) + '" ' +
             'height="' + Math.max(6, bot - top).toFixed(1) + '"/>';

      if (inside.length > 1) {
        svg += '<path class="ll-mine" d="' + path(inside, s) + '" fill="none"/>';
      }
    }

    if (other) svg += '<path class="ll-compare" d="' + path(other, s) + '" fill="none"/>';
    svg += '<path class="ll-life" d="' + path(full, s) + '" fill="none"/>';

    /* Marks sit under the line with their names, so the reader reads along the
     * line rather than up into it. The DOT belongs in the drawing; the NAME
     * does not.
     *
     * The viewBox is 1000 units wide and the phone gives it about 340, with
     * preserveAspectRatio="none" so the line stretches to whatever width there
     * is. That stretch applies to glyphs too: a <text> inside this SVG comes
     * out at full height and a third of its width — legible on a desktop, a
     * squashed smear on a phone, which is where this is read. The names are
     * HTML underneath instead, positioned by percentage, so they are set in the
     * page's own type at the page's own size and cannot be distorted at all. */
    var names = [];
    (o.marks || []).slice(0, 3).forEach(function (m) {
      if (!isFinite(m.t)) return;
      var x = s.x(m.t), at = nearest(full, m.t);
      if (at) svg += '<circle class="ll-dot" cx="' + x.toFixed(1) + '" cy="' + s.y(at.v).toFixed(1) + '" r="3"/>';
      names.push({ pct: (x / W) * 100, text: m.text || '', cls: '' });
    });

    if (bandMid !== null) {
      names.push({ pct: (bandMid / W) * 100, text: 'your stretch', cls: ' ll-yours' });
    }

    svg += '</svg>';

    /* aria-hidden: the SVG's own label already describes the whole picture, so
       a screen reader hearing these three words again learns nothing. */
    var strip = '<div class="ll-names" aria-hidden="true">' + names.map(function (n) {
      var at = Math.max(0, Math.min(100, n.pct));
      /* A name is centred on its dot, except at the ends: the first mark sits
         on the first NAV in the history and the last near the final one, and a
         centred word there hangs half off the page. */
      var edge = at < 8 ? ' ll-first' : at > 92 ? ' ll-last' : '';
      return '<span class="ll-name' + n.cls + edge + '" style="left:' +
        at.toFixed(2) + '%">' + esc(n.text) + '</span>';
    }).join('') + '</div>';

    return '<div class="ll-wrap">' + svg + strip + '</div>';
  }

  function nearest(points, t) {
    var best = null, gap = Infinity;
    for (var i = 0; i < points.length; i++) {
      var d = Math.abs(points[i].t - t);
      if (d < gap) { gap = d; best = points[i]; }
    }
    return best;
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

  var api = { render: render, tableRows: tableRows, decimate: decimate, scales: scales, rebase: rebase };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LifeLine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
