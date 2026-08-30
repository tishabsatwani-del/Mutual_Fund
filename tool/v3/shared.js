/* Where You Stand — the parts every tool uses.
 *
 * Formatting, the copy-slot reader, the data door, and the router. Four tools
 * share one search, one data layer and one design system, so they share this.
 */
(function (root) {
  'use strict';

  var E = root.SimEngines, S = root.SimSchemes, COPY = root.SIM_COPY;

  /* Review v4 §11 and §13: every figure in the product goes through ONE
   * formatting module, and nothing is formatted at the point of use. These
   * four are thin adapters onto sim/format.js so the four screens, the older
   * tool and the workbook cannot drift apart again. */
  var F = root.SimFormat;

  function $(s, within) { return (within || document).querySelector(s); }
  function $$(s, within) { return Array.prototype.slice.call((within || document).querySelectorAll(s)); }

  function money(n) { return F.money(n); }
  function moneyWords(n) { return F.moneyWords(n); }
  function pct(r, dp) { return F.pct(r, { dp: dp }); }
  function date(t) { return F.date(t); }
  function years(y) { return F.years(y); }
  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function count(n) { return F.count(n); }

  /* A slot the author has not written is NAMED on screen. A blank where a
   * sentence belongs looks like a bug; a named empty slot looks like what it
   * is, and tells whoever is reviewing exactly what to send. */
  /* Where each tool name goes when the author writes it in brackets. Her next
   * steps read "[This fund's record], and the worst window there", so the tool
   * name is the action -- it should be the thing you tap. Both apostrophes are
   * accepted, because a deck edited in a word processor will carry the curly
   * one and a deck edited in an editor will carry the straight one. */
  var TOOL_HREF = { mine: 'mine', record: 'record', stand: 'stand', plan: 'plan' };
  function toolLinks(html) {
    var names = COPY.tools || {};
    var order = [['myReturn','mine'], ['thisFundsRecord','record'],
                 ['myMoneyInThisFund','stand'], ['myPlanTested','plan']];
    order.forEach(function (pair) {
      var name = names[pair[0]];
      if (!name) return;
      var loose = esc(name).replace(/['\u2019]/g, "['\u2019]");
      html = html.replace(new RegExp('\\[' + loose + '\\]', 'g'),
        '<a href="#' + TOOL_HREF[pair[1]] + '">' + esc(name) + '</a>');
    });
    return html;
  }

  /* A slot the author has not written is NAMED on screen. A blank where a
   * sentence belongs looks like a bug; a named empty slot looks like what it
   * is, and tells whoever is reviewing exactly what to send.
   *
   * Order matters here: the text is escaped FIRST, then the engine's figures
   * are substituted in (escaped themselves), then the author's tool names
   * become links. Substituting before escaping would let a figure carry markup
   * into the page, and linkifying before escaping would have the escape eat
   * the anchor it had just written. */
  function slot(id, subs, tone) {
    var s = COPY.slots[id];
    if (s && s.text) {
      var text = esc(s.text);
      if (subs) Object.keys(subs).forEach(function (k) {
        text = text.split('[' + k + ']').join(esc(subs[k]));
      });
      return '<p class="sentence' + (tone ? ' ' + tone : '') + '">' + toolLinks(text) + '</p>';
    }
    return '<p class="slot-empty">Awaiting copy slot <code>' + esc(id) + '</code></p>';
  }

  /* Is this slot written yet? The screens print their own arithmetic beside a
   * slot only while it is empty, so a safety warning is never silent -- and
   * stand down the moment the author's sentence arrives, which is both the
   * copy rule and the word budget. */
  function written(id) {
    var s = COPY.slots[id];
    return !!(s && s.text);
  }

  /* A reading: the author's sentence where she has written one, and the
   * arithmetic plus the named slot where she has not. */
  function saying(id, subs, arithmetic, tone) {
    if (written(id)) return slot(id, subs, tone);
    return '<div class="refusal"><p>' + esc(arithmetic) + '</p>' + slot(id, subs) + '</div>';
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
    $: $, $$: $$, money: money, moneyWords: moneyWords, pct: pct, date: date,
    years: years, esc: esc, count: count, checkInput: F.checkInput, echo: F.echo,
    slot: slot, saying: saying, written: written, land: land,
    registerProvider: registerProvider, hasProvider: hasProvider, search: search, readFile: readFile,
    view: view, go: go, start: start, render: render,
    copy: COPY
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
