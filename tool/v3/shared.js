/* Where You Stand — the parts every tool uses.
 *
 * Formatting, the copy-slot reader, the data door, and the router. Four tools
 * share one search, one data layer and one design system, so they share this.
 */
(function (root) {
  'use strict';

  var E = root.SimEngines, S = root.SimSchemes, COPY = root.SIM_COPY;

  var inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function $(s, within) { return (within || document).querySelector(s); }
  function $$(s, within) { return Array.prototype.slice.call((within || document).querySelectorAll(s)); }

  function money(n) { return '₹' + inr.format(Math.round(n)); }

  /* A true minus, not a hyphen, and the percent sign closed up. */
  function pct(r, dp) {
    if (!isFinite(r)) return '—';
    var v = (r * 100).toFixed(dp == null ? 1 : dp);
    return (v.charAt(0) === '-' ? '−' + v.slice(1) : v) + '%';
  }
  function date(t) {
    var d = new Date(t);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function count(n) { return inr.format(n); }

  /* A slot the author has not written is NAMED on screen. A blank where a
   * sentence belongs looks like a bug; a named empty slot looks like what it
   * is, and tells whoever is reviewing exactly what to send. */
  function slot(id, subs) {
    var s = COPY.slots[id];
    if (s && s.text) {
      var text = s.text;
      if (subs) Object.keys(subs).forEach(function (k) {
        text = text.split('[' + k + ']').join(subs[k]);
      });
      return '<p class="sentence">' + esc(text) + '</p>';
    }
    return '<p class="slot-empty">Awaiting copy slot <code>' + esc(id) + '</code></p>';
  }

  /* ------------------------------------------------------------- the door
   *
   * Live first: the reader types a name and taps once. When the sources cannot
   * serve, the upload door appears and is complete on its own — and it is
   * always reachable anyway, from every search screen.
   *
   * There is no provider registered in this build, so every search reports the
   * door rather than pretending to look. Registering one is the only change
   * needed here.
   */
  var PROVIDER = null;
  function registerProvider(p) { PROVIDER = p; }
  /* About says what this build reads. With no provider registered the honest
     answer is "a file you choose", and it must change by itself when one is. */
  function hasProvider() { return !!PROVIDER; }

  function search(query) {
    if (!PROVIDER) return Promise.resolve({ ok: false, reason: 'no-provider', schemes: [] });
    return PROVIDER.search(query);
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That file could not be read.')); };
      reader.onload = function () {
        var parsed = root.PRCParse.parseSeriesText(String(reader.result));
        if (!parsed.ok) { reject(new Error(parsed.message)); return; }
        resolve({ series: parsed.series, name: file.name.replace(/\.[^.]+$/, '') });
      };
      reader.readAsText(file);
    });
  }

  /* --------------------------------------------------------------- routing */
  var views = {};
  function view(name, fns) { views[name] = fns; }

  function go(name) {
    if (location.hash.slice(1) !== name) { location.hash = name; return; }
    render();
  }

  function render() {
    var name = location.hash.slice(1) || 'home';
    if (!views[name]) name = 'home';
    /* Scoped to the sections inside main. An unscoped [data-view] also matches
       <body>, which carries the same attribute as a styling hook — and hiding
       the body hides the whole page. */
    $$('#main > [data-view]').forEach(function (el) { el.hidden = el.dataset.view !== name; });
    var back = $('#back');
    if (back) back.hidden = name === 'home';
    if (views[name].enter) views[name].enter();
    document.body.dataset.view = name;
    window.scrollTo(0, 0);
  }

  function start() {
    window.addEventListener('hashchange', render);
    var back = $('#back');
    if (back) back.addEventListener('click', function () { location.hash = 'home'; });
    render();
  }

  /* One orchestrated moment: the figures land in reading order, 250ms apart. */
  function land(i) { return ' class="land" style="animation-delay:' + (i * 250) + 'ms"'; }

  root.WYS = {
    $: $, $$: $$, money: money, pct: pct, date: date, esc: esc, count: count,
    slot: slot, land: land,
    registerProvider: registerProvider, hasProvider: hasProvider, search: search, readFile: readFile,
    view: view, go: go, start: start, render: render,
    copy: COPY
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
