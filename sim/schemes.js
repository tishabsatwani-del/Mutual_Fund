/* The Simulator - scheme names and NAV series, normalised.
 *
 * Build Specification v2, sections 5.2 (the data contract and its cleaning
 * rules), 5.3 (family grouping for search) and 5.4 (plan and option parsing).
 *
 * Everything here is a pure function of its arguments. No DOM, no network, no
 * clock: staleness takes "today" as a parameter rather than reading it, so the
 * same inputs always produce the same answer (a requirement the state system
 * in section 7.3 depends on).
 */
(function (root) {
  'use strict';

  var MS_PER_DAY = 86400000;

  /* Direct plans exist only from January 2013 (SEBI). Kept here so that any
   * screen wanting to explain a short Direct history has the date to hand. */
  var DIRECT_PLANS_BEGIN = '2013-01-01';

  var STALE_AFTER_DAYS = 30;   /* section 5.6 */

  /* ------------------------------------------------------------ name parsing
   *
   * AMFI encodes plan and option inside the scheme name, conventionally as
   * trailing dash-separated segments. The parser works segment by segment and
   * never on the raw string, because plenty of real fund names contain the
   * very words it is looking for: "Nippon India Growth Fund", "Aditya Birla
   * Sun Life Dividend Yield Fund". A segment counts as plan/option metadata
   * only when every meaningful word in it is one of these tokens, so a segment
   * that also carries "Yield" or "Fund" stays part of the name.
   */

  var FILLER = {
    option: 1, options: 1, opt: 1, plan: 1, plans: 1, facility: 1,
    scheme: 1, fund: 0   /* "fund" is never filler: it belongs to the name */
  };

  var PLAN_WORDS  = { direct: 'direct', regular: 'regular' };

  var GROWTH_WORDS = { growth: 1 };
  var IDCW_WORDS   = {
    idcw: 1, dividend: 1, div: 1, payout: 1, payouts: 1,
    reinvestment: 1, reinvest: 1, reinvested: 1, bonus: 1,
    distribution: 1, withdrawal: 1
  };
  /* Words that legitimately sit beside an option token and mean nothing on
   * their own ("Monthly IDCW", "Payout of Income Distribution cum capital
   * withdrawal"). They can never make a segment metadata by themselves. */
  var QUALIFIERS = {
    daily: 1, weekly: 1, fortnightly: 1, monthly: 1, quarterly: 1,
    half: 1, yearly: 1, annual: 1, annually: 1, of: 1, cum: 1,
    income: 1, capital: 1, and: 1, '&': 1
  };

  function words(segment) {
    return String(segment).toLowerCase()
      .replace(/[^a-z0-9&]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  /* Split on dashes, remembering the exact separator that preceded each piece.
   *
   * AMFI writes both "Fund - Direct Plan - Growth" and "Fund-Direct Plan-Growth",
   * so a spaced-dash-only rule misses half the file. Splitting on every dash
   * would break "Mid-Cap" and "Multi-Cap" instead, which is why the separator
   * travels with the segment: adjacent pieces that both turn out to be part of
   * the name are rejoined with the dash exactly as it was written.
   */
  function splitSegments(name) {
    var s = String(name || '');
    var out = [], last = 0, sep = '', re = /\s*[-–—]\s*/g, m;
    while ((m = re.exec(s)) !== null) {
      out.push({ text: s.slice(last, m.index).trim(), sep: sep });
      sep = m[0];
      last = m.index + m[0].length;
    }
    out.push({ text: s.slice(last).trim(), sep: sep });
    return out.filter(function (p) { return p.text.length > 0; });
  }

  function classifySegment(segment) {
    var w = words(segment).filter(function (x) { return FILLER[x] !== 1; });
    if (!w.length) return { kind: 'meta', plan: null, option: null };  /* e.g. "Option" alone */

    var plan = null, growth = false, idcw = false;
    for (var i = 0; i < w.length; i++) {
      var x = w[i];
      if (PLAN_WORDS[x]) { plan = PLAN_WORDS[x]; continue; }
      if (GROWTH_WORDS[x]) { growth = true; continue; }
      if (IDCW_WORDS[x]) { idcw = true; continue; }
      if (QUALIFIERS[x]) continue;
      return { kind: 'name' };            /* one ordinary word is enough */
    }
    if (!plan && !growth && !idcw) return { kind: 'name' };  /* qualifiers only */
    return { kind: 'meta', plan: plan, option: idcw ? 'idcw' : (growth ? 'growth' : null) };
  }

  /* Parse one scheme name into { family, plan, option, analyzable, reason }. */
  function parseName(name) {
    var segments = splitSegments(name);
    var kept = [], plan = null, option = null, sawMeta = false;

    for (var i = 0; i < segments.length; i++) {
      var c = classifySegment(segments[i].text);
      if (c.kind === 'name') { kept.push(segments[i]); continue; }
      sawMeta = true;
      if (c.plan) plan = c.plan;
      if (c.option) option = option === 'idcw' ? 'idcw' : c.option;
    }

    var family = '';
    for (var k = 0; k < kept.length; k++) {
      family += (k === 0 ? '' : kept[k].sep) + kept[k].text;
    }
    family = family.replace(/[ \t]+/g, ' ').trim();
    if (!family) family = String(name || '').trim();

    /* Section 5.4 rule 3: a name matching neither pattern is Regular-Growth
     * only if "Growth" is present, and otherwise is not analyzable. */
    var parsed = sawMeta && option !== null;
    if (!parsed) {
      var raw = words(name);
      option = raw.indexOf('growth') >= 0 ? 'growth' : null;
    }

    return {
      family: family,
      familyKey: familyKey(family),
      plan: plan || 'regular',          /* everything not Direct defaults to Regular */
      planStated: plan !== null,
      option: option,
      parsed: parsed,
      analyzable: option === 'growth',
      /* Copy slot the interface shows when this scheme cannot be analysed as-is */
      slot: option === 'growth' ? null : (option === 'idcw' ? 'RR-IDCW-ROUTE' : 'RR-IDCW-ROUTE')
    };
  }

  function familyKey(family) {
    return String(family || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* --------------------------------------------------------------- routing
   *
   * Section 5.4 rule 1: all analysis runs on Growth options only, because an
   * IDCW scheme's NAV drops when it pays out and a return read from that NAV
   * alone is silently wrong. An IDCW selection is routed to the Growth twin of
   * the same fund and the same plan; where none exists the fund is shown as
   * not analyzable, with the same explanation.
   */
  function resolveForAnalysis(scheme, universe) {
    var self = scheme.parsed ? scheme : decorate(scheme);
    if (self.analyzable) return { ok: true, scheme: self, routed: false };

    var pool = (universe || []).map(decorate).filter(function (s) {
      return s.familyKey === self.familyKey && s.analyzable;
    });
    var samePlan = pool.filter(function (s) { return s.plan === self.plan; });
    var twin = samePlan[0] || null;

    if (twin) return { ok: true, scheme: twin, routed: true, from: self, slot: 'RR-IDCW-ROUTE' };
    return { ok: false, slot: 'RR-IDCW-ROUTE', reason: 'no-growth-twin', from: self };
  }

  function decorate(scheme) {
    if (scheme && scheme.familyKey && scheme.option !== undefined) return scheme;
    var p = parseName(scheme && scheme.name);
    var out = { code: scheme && scheme.code, name: scheme && scheme.name,
                fundHouse: scheme && scheme.fundHouse };
    if (scheme && scheme.isinGrowth) out.isinGrowth = scheme.isinGrowth;
    if (scheme && scheme.isinIdcw) out.isinIdcw = scheme.isinIdcw;
    Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    return out;
  }

  /* ------------------------------------------------------- search grouping
   *
   * Section 5.3: results are grouped by family before display, one row per
   * family, with the plan choice made on the fund page rather than in the
   * result list.
   */
  function groupByFamily(schemes) {
    var order = [], byKey = {};
    (schemes || []).map(decorate).forEach(function (s) {
      var g = byKey[s.familyKey];
      if (!g) {
        g = byKey[s.familyKey] = {
          familyKey: s.familyKey, family: s.family, fundHouse: s.fundHouse,
          schemes: [], plans: {}, analyzable: false
        };
        order.push(g);
      }
      g.schemes.push(s);
      if (s.analyzable) {
        g.analyzable = true;
        if (!g.plans[s.plan]) g.plans[s.plan] = s;
      }
      if (!g.fundHouse && s.fundHouse) g.fundHouse = s.fundHouse;
    });
    return order;
  }

  /* The scheme a family should open on: the plan the visitor picked where that
   * is determinable, else Regular, simply as the older plan type (5.4 rule 2).
   * Neither plan is presented as better anywhere. */
  function pickPlan(group, preferred) {
    if (preferred && group.plans[preferred]) return group.plans[preferred];
    return group.plans.regular || group.plans.direct || null;
  }

  /* ------------------------------------------------------------- NAV series
   *
   * Section 5.2 cleaning rules, applied always: parse the provider's date
   * strings into ISO dates; drop rows whose NAV is not a positive finite
   * number (AMFI history carries #N/A, N.A., B.C. and similar, and the rule is
   * to log nothing and just drop them); de-duplicate same-date rows keeping the
   * last occurrence; sort ascending by date.
   */

  var MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
                 jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

  function parseDate(value) {
    if (value instanceof Date) return isFinite(value.getTime()) ? utcOf(value) : NaN;
    if (typeof value === 'number') return isFinite(value) ? value : NaN;
    var s = String(value == null ? '' : value).trim();
    if (!s) return NaN;
    var m;

    if ((m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec(s)))
      return make(+m[1], +m[2], +m[3]);

    /* Day-first: every source in this chain is Indian, and mfapi states
     * DD-MM-YYYY outright (5.2). No ambiguity is guessed at. */
    if ((m = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/.exec(s)))
      return make(+m[3], +m[2], +m[1]);

    if ((m = /^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{4})$/.exec(s))) {
      var mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
      return mon ? make(+m[3], mon, +m[1]) : NaN;
    }
    return NaN;
  }

  function utcOf(d) { return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

  function make(y, m, d) {
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return NaN;
    var t = Date.UTC(y, m - 1, d), back = new Date(t);
    if (back.getUTCMonth() + 1 !== m || back.getUTCDate() !== d) return NaN;
    return t;
  }

  function parseNav(value) {
    if (typeof value === 'number') return isFinite(value) && value > 0 ? value : NaN;
    var s = String(value == null ? '' : value).trim().replace(/,/g, '');
    if (!/^\d*\.?\d+$/.test(s)) return NaN;      /* rejects #N/A, N.A., B.C., "-" */
    var n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : NaN;
  }

  /* rows may be [{date, nav}] in any provider's spelling, or [[date, nav]]. */
  function cleanSeries(rows) {
    var seen = {}, order = [], dropped = 0;
    var list = rows || [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      var rawDate, rawNav;
      if (Array.isArray(row)) { rawDate = row[0]; rawNav = row[1]; }
      else if (row && typeof row === 'object') {
        rawDate = row.date != null ? row.date : row.Date;
        rawNav = row.nav != null ? row.nav : (row.NAV != null ? row.NAV : row.value);
      } else { dropped++; continue; }

      var t = parseDate(rawDate), nav = parseNav(rawNav);
      if (!isFinite(t) || !isFinite(nav)) { dropped++; continue; }
      if (!(t in seen)) order.push(t);
      seen[t] = nav;                       /* last occurrence wins */
    }
    order.sort(function (a, b) { return a - b; });
    var out = new Array(order.length);
    for (var k = 0; k < order.length; k++) {
      out[k] = { date: iso(order[k]), nav: seen[order[k]] };
    }
    return { series: out, dropped: dropped };
  }

  function iso(t) { return new Date(t).toISOString().slice(0, 10); }

  /* The engines work in milliseconds and call the value v; the contract in 5.2
   * speaks ISO dates and nav. This is the one place the two meet. */
  function toEngineSeries(navSeries) {
    return (navSeries || []).map(function (p) {
      return { t: p.t != null ? p.t : parseDate(p.date), v: p.nav != null ? p.nav : p.v };
    }).filter(function (p) { return isFinite(p.t) && p.v > 0; });
  }

  /* Section 5.6: a scheme whose latest NAV is older than 30 calendar days gets
   * a neutral badge and stays fully analyzable up to that date. asOf is passed
   * in; nothing here reads the clock. */
  function staleness(navSeries, asOfT) {
    var s = navSeries || [];
    if (!s.length) return { stale: false, ageDays: NaN, latest: null };
    var last = s[s.length - 1];
    var t = last.t != null ? last.t : parseDate(last.date);
    var age = Math.round((asOfT - t) / MS_PER_DAY);
    return {
      stale: age > STALE_AFTER_DAYS,
      ageDays: age,
      latest: iso(t),
      slot: age > STALE_AFTER_DAYS ? 'RR-STALE' : null
    };
  }

  var api = {
    DIRECT_PLANS_BEGIN: DIRECT_PLANS_BEGIN, STALE_AFTER_DAYS: STALE_AFTER_DAYS,
    parseName: parseName, familyKey: familyKey, decorate: decorate,
    resolveForAnalysis: resolveForAnalysis, groupByFamily: groupByFamily, pickPlan: pickPlan,
    parseDate: parseDate, parseNav: parseNav, cleanSeries: cleanSeries,
    toEngineSeries: toEngineSeries, staleness: staleness, iso: iso,
    splitSegments: splitSegments, classifySegment: classifySegment
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimSchemes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
