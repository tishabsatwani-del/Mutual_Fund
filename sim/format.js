/* Where You Stand — the number standard, review v4 section 11.
 *
 * Section 11 is a specification, not a preference: every figure in the product
 * goes through this file, web and workbook, and nothing is formatted at the
 * point of use. Four conventions in one product is what the recording caught.
 *
 * THE EXPONENT BUG, since it is the reason this file exists.
 *
 * Number.prototype.toFixed falls back to exponent notation at |x| >= 1e21. The
 * goal screen divided by 1e7 for crore and then called toFixed(0), so a large
 * enough plan printed "₹1.264244546793246e+68 crore". Intl.NumberFormat never
 * produces exponent form at any magnitude. So: toFixed appears nowhere below,
 * and neither does string concatenation of a raw Number.
 *
 * No DOM, no clock, no network. Pure functions of their arguments.
 */
(function (root) {
  'use strict';

  var LAKH = 1e5, CRORE = 1e7;

  /* One locale object per shape, built once. en-IN groups the Indian way -- the
   * last three digits, then twos -- and hand-rolling that is what produced
   * ₹568,7111 in the workbook. */
  function grouped(minDp, maxDp) {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: minDp, maximumFractionDigits: maxDp
    });
  }
  var G0 = grouped(0, 0), G2 = grouped(2, 2);

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* A true minus (U+2212), not a hyphen. Applied after formatting so the digits
   * are grouped on the magnitude and the sign is set typographically. */
  function signed(text, negative, plus) {
    return (negative ? '−' : (plus ? '+' : '')) + text;
  }

  function bad(n) { return typeof n !== 'number' || !isFinite(n); }

  /* ------------------------------------------------------------- rupees
   *
   * Two shapes, and which to use is a property of WHERE the figure sits:
   *
   *   ledger   full digits. Correct in a ledger, a table of rupees, and
   *            anywhere the reader is checking their own entry against a
   *            statement. ₹4,20,000
   *   words    lakh and crore. Correct for headline figures, chart labels,
   *            and any figure inside a sentence. ₹4.20 lakh
   *
   * Two decimals below a hundred units, none above. Spelled out, singular,
   * lowercase; never "L", "Cr", "Lakhs" or "Crores". The sign closes up.
   */
  function money(n) {
    if (bad(n)) return '—';
    return signed('₹' + G0.format(Math.abs(n)), n < 0);
  }

  function moneyWords(n) {
    if (bad(n)) return '—';
    var a = Math.abs(n);
    if (a < LAKH) return money(n);

    var divisor = a < CRORE ? LAKH : CRORE;
    var unit = a < CRORE ? ' lakh' : ' crore';
    var units = a / divisor;
    /* the dp rule is about the SIZE of the unit figure, not its band, so a
       four-figure crore count prints whole and a small one prints to two */
    var text = (units < 100 ? G2 : G0).format(units);
    return signed('₹' + text + unit, n < 0);
  }

  /* The helper the review calls out as exactly right and asks for under every
   * rupee input: the reader types digits, and the words appear beneath. */
  function echo(n) {
    if (bad(n) || Math.abs(n) < LAKH) return '';
    return '= about ' + moneyWords(n);
  }

  /* ------------------------------------------------------- percentages
   * One decimal, sign closed up, a true minus, and a plus ONLY where the
   * number can go either way -- a return can, a fee cannot. */
  function pct(r, options) {
    var o = options || {};
    if (bad(r)) return '—';
    var dp = o.dp == null ? 1 : o.dp;
    var v = Math.abs(r * 100);
    var text = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: dp, maximumFractionDigits: dp
    }).format(v);
    return signed(text + '%', r < 0, o.signed && r > 0);
  }

  /* Already a percentage, not a rate: the deposit field, the step-up. */
  function points(p, options) { return pct(p / 100, options); }

  function years(y) {
    if (bad(y)) return '—';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 1, maximumFractionDigits: 1
    }).format(y) + (Math.abs(y - 1) < 0.05 ? ' year' : ' years');
  }

  function count(n) { return bad(n) ? '—' : G0.format(n); }

  /* ------------------------------------------------------------- dates
   * dd-MMM-yyyy, always, in inputs as well as output. 04/01/2022 is read as
   * 4 January by an Indian reader and meant as 1 April by an American tool,
   * and there is no way to tell which from the string. */
  function date(t) {
    if (t == null || (typeof t === 'number' && !isFinite(t))) return '—';
    var d = new Date(t);
    if (isNaN(d.getTime())) return '—';
    return String(d.getUTCDate()).padStart(2, '0') + '-' +
           MONTHS[d.getUTCMonth()] + '-' + d.getUTCFullYear();
  }

  /* "to" between dates, never a dash: a dash between two dates that already
     contain dashes cannot be read. */
  function span(from, to) { return date(from) + ' to ' + date(to); }

  /* ------------------------------------------------------- input caps
   *
   * These are what stop a figure being computed that cannot be printed. A
   * step-up of 10000000 was accepted, and no formatting rule can rescue the
   * number that comes out of it -- the refusal has to happen at the field.
   */
  var CAPS = {
    rate:      { min: 0, max: 30,   unit: '%',  name: 'A return' },
    stepUp:    { min: 0, max: 25,   unit: '%',  name: 'A step-up' },
    inflation: { min: 0, max: 20,   unit: '%',  name: 'Inflation' },
    years:     { min: 1, max: 50,   unit: '',   name: 'A number of years' },
    rupees:    { min: 0, max: 1e10, unit: '',   name: 'An amount' }   /* ₹1,000 crore */
  };

  /* Returns null when the value is fine, or a sentence naming the range.
   * The screen refuses on the field and does not compute. */
  function checkInput(kind, value) {
    var cap = CAPS[kind];
    if (!cap) return null;
    if (typeof value !== 'number' || !isFinite(value)) {
      return cap.name + ' is needed here.';
    }
    if (value < cap.min || value > cap.max) {
      var lo = kind === 'rupees' ? money(cap.min) : cap.min + cap.unit;
      var hi = kind === 'rupees' ? moneyWords(cap.max) : cap.max + cap.unit;
      return cap.name + ' has to be between ' + lo + ' and ' + hi + '.';
    }
    return null;
  }

  function withinCaps(kind, value) { return checkInput(kind, value) === null; }

  var api = {
    money: money, moneyWords: moneyWords, echo: echo,
    pct: pct, points: points, years: years, count: count,
    date: date, span: span,
    CAPS: CAPS, checkInput: checkInput, withinCaps: withinCaps,
    LAKH: LAKH, CRORE: CRORE
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
