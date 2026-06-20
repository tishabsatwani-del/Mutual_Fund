/* =====================================================================
 * Autonomous Portfolio Oracle — inline-SVG chart helpers
 * ---------------------------------------------------------------------
 * Hand-rolled SVG string builders so the dashboard gets professional,
 * print-ready visuals with ZERO dependencies (no Chart.js, no CDN — stays
 * offline). Each function is pure: data in, SVG markup out. Node-exported
 * so the markup can be smoke-tested without a browser.
 * ===================================================================== */
'use strict';

(function (root, factory) {
  const C = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  if (typeof window !== 'undefined') window.ORACLE_CHARTS = C;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => (Math.round(n * 100) / 100);

  /** Polar -> cartesian (0° at 12 o'clock, clockwise). */
  function polar(cx, cy, r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function arc(cx, cy, r, startDeg, endDeg) {
    const [x0, y0] = polar(cx, cy, r, endDeg);
    const [x1, y1] = polar(cx, cy, r, startDeg);
    const large = endDeg - startDeg <= 180 ? 0 : 1;
    return `M ${fmt(x0)} ${fmt(y0)} A ${r} ${r} 0 ${large} 0 ${fmt(x1)} ${fmt(y1)}`;
  }

  /** Donut chart from [{label,value,color}]. Returns an <svg>. */
  function donut(segments, opts = {}) {
    const size = opts.size || 160, sw = opts.stroke || 22, r = (size - sw) / 2, cx = size / 2, cy = size / 2;
    const circ = 2 * Math.PI * r;
    const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
    let offset = 0;
    const rings = segments.map((s) => {
      const frac = Math.max(0, s.value) / total;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${fmt(r)}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${fmt(frac * circ)} ${fmt(circ - frac * circ)}" stroke-dashoffset="${fmt(-offset * circ)}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"><title>${esc(s.label)}: ${(frac * 100).toFixed(1)}%</title></circle>`;
      offset += frac;
      return seg;
    }).join('');
    const center = opts.centerLabel
      ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="${opts.centerSize || 19}" font-weight="700" fill="${opts.centerColor || 'var(--ink)'}">${esc(opts.centerLabel)}</text>${opts.centerSub ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="var(--faint)">${esc(opts.centerSub)}</text>` : ''}`
      : '';
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" class="chart donut">${rings}${center}</svg>`;
  }

  /** Semicircular gauge for a 0..max score. */
  function gauge(value, opts = {}) {
    const max = opts.max || 10, size = opts.size || 200, h = size * 0.62, sw = opts.stroke || 16;
    const r = (size - sw) / 2, cx = size / 2, cy = size / 2;
    const START = -120, END = 120, span = END - START;
    const v = Math.max(0, Math.min(max, value));
    const valDeg = START + span * (v / max);
    const color = opts.color || 'var(--gold)';
    return `<svg viewBox="0 0 ${size} ${h}" width="${size}" height="${h}" role="img" class="chart gauge">
      <path d="${arc(cx, cy, r, START, END)}" fill="none" stroke="var(--track)" stroke-width="${sw}" stroke-linecap="round"/>
      <path d="${arc(cx, cy, r, START, valDeg)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
      <text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="${size * 0.22}" font-weight="700" fill="${color}">${fmt(value)}</text>
      <text x="${cx}" y="${cy + size * 0.16}" text-anchor="middle" font-size="${size * 0.07}" fill="var(--faint)">/ ${max}</text>
    </svg>`;
  }

  /** Simple line chart from a numeric series (optionally a zero baseline). */
  function line(series, opts = {}) {
    const w = opts.width || 280, h = opts.height || 70, pad = opts.pad || 4;
    if (!series || series.length < 2) return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="chart line"></svg>`;
    let lo = Math.min(...series), hi = Math.max(...series);
    if (opts.includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi === lo) hi = lo + 1;
    const x = (i) => pad + (w - 2 * pad) * (i / (series.length - 1));
    const y = (val) => h - pad - (h - 2 * pad) * (val - lo) / (hi - lo);
    const pts = series.map((v, i) => `${fmt(x(i))},${fmt(y(v))}`).join(' ');
    const color = opts.color || 'var(--up)';
    const zero = (opts.includeZero && lo < 0 && hi > 0) ? `<line x1="${pad}" y1="${fmt(y(0))}" x2="${w - pad}" y2="${fmt(y(0))}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3"/>` : '';
    const area = opts.fill ? `<polygon points="${fmt(x(0))},${fmt(h - pad)} ${pts} ${fmt(x(series.length - 1))},${fmt(h - pad)}" fill="${color}" opacity="0.10"/>` : '';
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" class="chart line">${zero}${area}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }

  /** Monte Carlo fan chart from yearly bands [{year,p5,p10,p25,p50,p75,p90,p95}].
   *  Layers the p5–p95, p10–p90 and p25–p75 ranges, draws the median, and an
   *  optional invested baseline. */
  function fan(bands, opts = {}) {
    const w = opts.width || 560, h = opts.height || 240, padL = 8, padR = 8, padT = 10, padB = 18;
    if (!bands || bands.length < 2) return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="chart fan"></svg>`;
    const lo = 0;
    let hi = Math.max(...bands.map((b) => b.p95));
    if (opts.baseline) hi = Math.max(hi, opts.baseline);
    if (hi === lo) hi = 1;
    const x = (i) => padL + (w - padL - padR) * (i / (bands.length - 1));
    const y = (v) => h - padB - (h - padT - padB) * (v - lo) / (hi - lo);
    const bandArea = (loKey, hiKey, fill, op) => {
      const top = bands.map((b, i) => `${fmt(x(i))},${fmt(y(b[hiKey]))}`).join(' ');
      const bot = bands.map((b, i) => `${fmt(x(i))},${fmt(y(b[loKey]))}`).reverse().join(' ');
      return `<polygon points="${top} ${bot}" fill="${fill}" opacity="${op}"/>`;
    };
    const a1 = bandArea('p5', 'p95', opts.color || 'var(--cool)', 0.14);
    const a2 = bandArea('p10', 'p90', opts.color || 'var(--cool)', 0.18);
    const a3 = bandArea('p25', 'p75', opts.color || 'var(--cool)', 0.26);
    const median = `<polyline points="${bands.map((b, i) => `${fmt(x(i))},${fmt(y(b.p50))}`).join(' ')}" fill="none" stroke="${opts.medianColor || 'var(--gold)'}" stroke-width="2.4"/>`;
    const base = opts.baseline ? `<line x1="${padL}" y1="${fmt(y(opts.baseline))}" x2="${w - padR}" y2="${fmt(y(opts.baseline))}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4"/>` : '';
    const samples = (opts.samples || []).slice(0, 12).map((p) =>
      `<polyline points="${p.map((v, i) => `${fmt(x(i))},${fmt(y(v))}`).join(' ')}" fill="none" stroke="var(--line)" stroke-width="1"/>`
    ).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" class="chart fan">${a1}${a2}${a3}${samples}${base}${median}</svg>`;
  }

  /** Horizontal bars from [{label,value,color,caption}] (value is a fraction
   *  of `maxAbs`; negative draws left-to-right but coloured as a loss). */
  function bars(items, opts = {}) {
    const w = opts.width || 520, rowH = opts.rowH || 34, gap = 8, labelW = opts.labelW || 150;
    const maxAbs = opts.maxAbs || Math.max(1e-9, ...items.map((it) => Math.abs(it.value)));
    const h = items.length * (rowH + gap);
    const rows = items.map((it, i) => {
      const yy = i * (rowH + gap);
      const bw = (w - labelW - 70) * Math.abs(it.value) / maxAbs;
      return `<g transform="translate(0 ${yy})">
        <text x="0" y="${rowH / 2 + 4}" font-size="12.5" fill="var(--muted)">${esc(it.label)}</text>
        <rect x="${labelW}" y="4" width="${fmt(bw)}" height="${rowH - 8}" rx="5" fill="${it.color || 'var(--up)'}"/>
        <text x="${labelW + bw + 8}" y="${rowH / 2 + 4}" font-size="12.5" font-weight="700" fill="var(--ink)">${esc(it.caption || '')}</text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" class="chart bars">${rows}</svg>`;
  }

  return { polar, arc, donut, gauge, line, fan, bars };
});
