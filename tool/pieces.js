/* Where You Stand: a history that arrives in several pieces.
 *
 * Official sites hand out a long history a stretch at a time (AMFI, ninety
 * days; the exchanges, a fixed period or a custom range), and a phone cannot
 * copy a very long table in one go. So a reader brings pieces: files, pastes,
 * or both, in any order, each in its own layout and date form. This module
 * holds the rules for joining them, as pure functions, so the door (doors.js)
 * and the tests share one set:
 *
 *   PRCPieces.check(pieces, options) -> {
 *     ok, refusal (a sentence, when the pieces cannot be one history),
 *     ask (a question, when nothing in the pieces can say they are one),
 *     warnings [sentences], joins [{ from, to, days, jump }], summary
 *   }
 *   piece: { name, series: [{ t, v }], report: { code, scheme, fund, title, variant }, kind: 'TRI'|'PRICE'|null }
 *
 * The rules. Two pieces that name a scheme (a code, or a name) must name the
 * same one. Two that state a plan or an option must state the same. An
 * index's total return piece is never joined with its price piece. Where two
 * pieces share a date they must carry the same value, to the last decimal
 * place written; one shared date that disagrees refuses the lot, naming the
 * date. Pieces that carry no name and share no date cannot be checked, so
 * the reader is asked once whether they are all one fund, plan and option,
 * and the jump at each join is compared with the history's own daily moves:
 * far larger, and the card says so. Nothing here changes a value.
 */
(function (root) {
  'use strict';
  var P = (typeof require === 'function') ? require('./parse.js') : root.PRCParse;
  var MS_DAY = 86400000;
  var PIECE_GAP_DAYS = 7;

  function nameOf(p) { var r = p.report || {}; return r.scheme || r.title || r.fund || ''; }
  var STOP = ['fund', 'plan', 'option', 'the', 'of', 'and', 'scheme', 'mutual', 'growth', 'direct', 'regular', 'idcw', 'dividend', 'payout',
              'reinvestment', 'reinvest', 'investment', 'formerly', 'known', 'as', 'erstwhile', 'an', 'a', 'open', 'ended', 'with', 'g', 'd', 'gr', 'nav', 'history'];
  function words(n) { return String(n || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(function (w) { return w && STOP.indexOf(w) === -1; }).join(' '); }
  function fundWords(p) {
    var n = nameOf(p);
    if (!n) return '';
    var w = words(P.fundName(n) || n);
    /* a name made only of stop words ("Scheme A") keeps its letters */
    return w || String(P.fundName(n) || n).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function decimals(v) { var s = String(v); var m = /\.(\d+)$/.exec(s); return m ? m[1].length : 0; }
  function fmt(t) { var d = new Date(t); var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return String(d.getUTCDate()).padStart(2, '0') + '-' + M[d.getUTCMonth()] + '-' + d.getUTCFullYear(); }
  function pct(x) { return (Math.abs(x) * 100).toFixed(1) + '%'; }
  function median(list) { if (!list.length) return null; var a = list.slice().sort(function (x, y) { return x - y; }); var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

  function check(pieces, options) {
    var o = options || {};
    var out = { ok: true, refusal: null, ask: null, warnings: [], joins: [], gaps: [], summary: null };
    var list = (pieces || []).filter(function (p) { return p && p.series && p.series.length; });
    if (!list.length) return out;
    var i, j;

    /* 1. one scheme: codes first, then names */
    var coded = list.filter(function (p) { return p.report && p.report.code; });
    for (i = 1; i < coded.length; i++) {
      if (String(coded[i].report.code) !== String(coded[0].report.code)) {
        return refuse(out, 'These pieces are not the same scheme: ' + coded[0].name + ' holds scheme code ' + coded[0].report.code + ' and ' + coded[i].name + ' holds code ' + coded[i].report.code + '. Add the pieces of one scheme only.');
      }
    }
    /* names are compared where no code settles it: pieces of one code may
       carry the scheme's older and newer names */
    var named = coded.length === list.length ? [] : list.filter(function (p) { return fundWords(p); });
    for (i = 1; i < named.length; i++) {
      var a = fundWords(named[0]), b = fundWords(named[i]);
      if (a !== b && a.indexOf(b) === -1 && b.indexOf(a) === -1) {
        return refuse(out, 'These pieces are not the same fund: ' + named[0].name + ' holds ' + nameOf(named[0]) + ' and ' + named[i].name + ' holds ' + nameOf(named[i]) + '. Add the pieces of one fund only.');
      }
    }
    /* 2. one plan and option */
    var stated = list.filter(function (p) { return p.report && P.variantKnown(p.report.variant); });
    for (i = 1; i < stated.length; i++) {
      if (P.variantsDiffer(stated[0].report.variant, stated[i].report.variant)) {
        return refuse(out, 'These pieces are different plans or options: ' + stated[0].name + ' holds the ' + P.variantLabel(stated[0].report.variant) + ' and ' + stated[i].name + ' holds the ' + P.variantLabel(stated[i].report.variant) + '. Two plans or options are never joined into one history.');
      }
    }
    /* 3. an index: never a total return piece with a price piece */
    var kinds = list.filter(function (p) { return p.kind; });
    for (i = 1; i < kinds.length; i++) {
      if (kinds[i].kind !== kinds[0].kind) {
        return refuse(out, 'These pieces cannot be joined: ' + kinds[0].name + ' is the ' + kindWords(kinds[0].kind) + ' and ' + kinds[i].name + ' is the ' + kindWords(kinds[i].kind) + '. Download every piece from the same report.');
      }
    }
    /* 4. every shared date carries the same value, to the last decimal place written */
    var byDate = {}, overlapPairs = {};
    list.forEach(function (p, k) {
      p.series.forEach(function (pt) {
        var have = byDate[pt.t];
        if (have) {
          overlapPairs[have.k + '|' + k] = true;
          var dp = Math.min(decimals(have.v), decimals(pt.v)), tol = Math.pow(10, -dp) * 1.0000001;
          if (Math.abs(have.v - pt.v) > tol) {
            out.mismatch = { t: pt.t, a: have.v, b: pt.v, from: list[have.k].name, to: p.name };
          }
        } else byDate[pt.t] = { v: pt.v, k: k };
      });
    });
    if (out.mismatch) {
      return refuse(out, 'These pieces do not match on ' + fmt(out.mismatch.t) + ': ' + out.mismatch.from + ' says ' + out.mismatch.a + ' and ' + out.mismatch.to + ' says ' + out.mismatch.b + '. They may be different funds or plans.');
    }
    /* 5. nothing to check them by: ask once */
    var unnamed = list.filter(function (p) { return !fundWords(p) && !(p.report && p.report.code); });
    if (list.length > 1 && unnamed.length) {
      var checked = unnamed.every(function (p) {
        var k = list.indexOf(p);
        return Object.keys(overlapPairs).some(function (key) { var ab = key.split('|'); return +ab[0] === k || +ab[1] === k; });
      });
      if (!checked) out.ask = 'Are all these pieces the same fund, plan and option?';
    }
    /* 6. the joins: the gap between pieces, and the jump across it */
    var ordered = list.slice().sort(function (x, y) { return x.series[0].t - y.series[0].t; });
    var steps = [];
    list.forEach(function (p) {
      for (var s = 1; s < p.series.length; s++) {
        var days = (p.series[s].t - p.series[s - 1].t) / MS_DAY;
        if (days > 0 && p.series[s - 1].v > 0 && p.series[s].v > 0) steps.push(Math.abs(Math.log(p.series[s].v / p.series[s - 1].v)) / Math.sqrt(days));
      }
    });
    var typical = median(steps);
    var reach = ordered[0];
    for (i = 1; i < ordered.length; i++) {
      var next = ordered[i], last = reach.series[reach.series.length - 1];
      var first = null;
      for (j = 0; j < next.series.length && !first; j++) if (next.series[j].t > last.t) first = next.series[j];
      if (first) {
        var days = (first.t - last.t) / MS_DAY, jump = Math.log(first.v / last.v);
        var join = { from: reach.name, to: next.name, fromT: last.t, toT: first.t, days: Math.round(days), jump: jump };
        out.joins.push(join);
        if (days > PIECE_GAP_DAYS) out.gaps.push(join);
        /* far larger than the history's own moves: ten times the typical
           move, each scaled by the square root of the days it spans (a move
           over a longer gap is allowed to be larger), and at least two percent */
        if (typical != null && typical > 0 && Math.abs(jump) / Math.sqrt(days) > 10 * typical && Math.abs(jump) > 0.02) {
          out.warnings.push('The join between ' + reach.name + ' (' + fmt(last.t) + ', ' + last.v + ') and ' + next.name + ' (' + fmt(first.t) + ', ' + first.v + ') jumps ' + pct(jump) + ', far more than this history moves from one day to the next. Check that both pieces are the same fund, plan and option.');
        }
      }
      if (next.series[next.series.length - 1].t > last.t) reach = next;
    }
    /* the whole, joined */
    var all = Object.keys(byDate).map(function (t) { return { t: +t, v: byDate[t].v }; }).sort(function (x, y) { return x.t - y.t; });
    out.summary = { pieces: list.length, navs: all.length, first: all[0].t, last: all[all.length - 1].t, gaps: out.gaps.map(function (g) {
      return { days: g.days, from: g.fromT, to: g.toT, between: [g.from, g.to] };
    }) };
    return out;
  }
  function kindWords(k) { return k === 'TRI' ? 'total return index' : k === 'PRICE' ? 'price index' : 'index'; }
  function refuse(out, sentence) { out.ok = false; out.refusal = sentence; return out; }

  /* the one-line account of what was joined, for the card */
  function summaryLine(s) {
    if (!s) return '';
    return s.pieces + ' pieces joined · ' + s.navs.toLocaleString('en-IN') + ' NAVs · ' + fmt(s.first) + ' to ' + fmt(s.last);
  }
  function gapSentence(g) {
    return 'A gap of ' + g.days.toLocaleString('en-IN') + ' days between ' + g.between[0] + ' (ends ' + fmt(g.from) + ') and ' + g.between[1] + ' (starts ' + fmt(g.to) + '). If a piece is missing, add it.';
  }

  var api = { check: check, summaryLine: summaryLine, gapSentence: gapSentence, PIECE_GAP_DAYS: PIECE_GAP_DAYS, fundWords: fundWords };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PRCPieces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
