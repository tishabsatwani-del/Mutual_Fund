/* dates.js -- one date, one spelling.
 *
 * A native <input type="date"> spells its value in the browser's locale, which
 * on many Indian phones is the US order: 09/02/2026 for the second of
 * September. Every other date in the tool reads 02-Sep-2026, and an Indian
 * reader takes 03/09/2021 to be the third of September. So the native input
 * stays -- it is still the tap target, still opens the platform picker, still
 * takes keyboard entry -- but it is drawn transparent, and a sibling
 * <span class="dateshow"> underneath it spells the chosen date dd-Mmm-yyyy.
 *
 *   window.PRCDates.format('2026-09-02')  -> '02-Sep-2026'   ('' when invalid)
 *   window.PRCDates.decorate(root)        -> wraps every undecorated
 *                                            input[type=date] under root
 *                                            (root defaults to document)
 *   window.PRCDates.refresh(root)         -> re-reads values right now
 *
 * The input keeps its id, name and type, so code and tests that set its value
 * or fill it keep working. Values set from code (el.value = ...) fire no
 * event, so a 250ms tick compares each decorated input's value against what is
 * shown and redraws when they differ. A MutationObserver on document.body
 * decorates date inputs added later (the portfolio screen adds rows).
 *
 * Markup after decoration:
 *   <span class="datewrap">
 *     <input type="date" id="...">                 (transparent, on top)
 *     <span class="dateshow" aria-hidden="true">02-Sep-2026</span>
 *   </span>
 * State classes on .dateshow: is-empty, is-disabled, is-focus.
 */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PLACEHOLDER = 'dd-Mmm-yyyy';
  var TICK_MS = 250;
  var CSS_ID = 'prc-dates-css';

  var CSS =
    '.datewrap{position:relative;display:block;margin:0;padding:0;' +
      'max-width:100%;vertical-align:middle;}' +
    '.datewrap--inline{display:inline-block;}' +
    /* The native input is the layout box and the topmost hit target. It is
       transparent, not hidden: taps, focus and typing all still reach it. */
    '.datewrap>input[type="date"]{display:block;width:100%;position:relative;' +
      'z-index:2;opacity:0;margin:0;-webkit-appearance:none;appearance:none;}' +
    '.dateshow{position:absolute;left:0;top:0;right:0;bottom:0;z-index:1;' +
      'box-sizing:border-box;display:flex;align-items:center;' +
      'pointer-events:none;overflow:hidden;white-space:nowrap;' +
      'font-family:var(--sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);' +
      'font-size:1rem;line-height:1.2;padding:.55rem .7rem;min-height:44px;' +
      'border:1px solid var(--line-strong,rgba(0,242,254,.46));border-radius:9px;' +
      'background:var(--surface-3,var(--surface,#0E1522));color:var(--ink,#F2F6FC);' +
      'font-variant-numeric:tabular-nums;' +
      'box-shadow:inset 0 1px 2px rgba(0,0,0,.5);' +
      'transition:border-color .12s ease,box-shadow .12s ease,opacity .12s ease;}' +
    '.dateshow.is-empty{color:var(--muted,#A5B0BF);}' +
    '.dateshow.is-disabled{opacity:.5;}' +
    '.datewrap:hover>.dateshow:not(.is-disabled){border-color:var(--accent,rgba(0,242,254,.5));}' +
    '.dateshow.is-focus{outline:3px solid var(--accent,#00F2FE);outline-offset:2px;}';

  /* Properties copied from the input's own computed style so the overlay sits
     exactly where the input's text would, wherever the input lives (the
     portfolio rows style their inputs smaller than the form fields). */
  var COPY = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
              'borderTopLeftRadius', 'borderTopRightRadius',
              'borderBottomRightRadius', 'borderBottomLeftRadius',
              'minHeight', 'fontSize', 'fontWeight', 'textAlign'];

  var registry = [];          /* every decorated input still in the page */
  var ticking = null;
  var bodyObserver = null;

  function format(iso) {
    if (typeof iso !== 'string') return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!m) return '';
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    /* reject 31-Apr and 30-Feb rather than spell them */
    var probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return '';
    return m[3] + '-' + MONTHS[mo - 1] + '-' + m[1];
  }

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function isDecorated(input) {
    return !!(input.parentNode && input.parentNode.nodeType === 1 &&
              input.parentNode.className &&
              (' ' + input.parentNode.className + ' ').indexOf(' datewrap ') !== -1);
  }

  /* Does this input fill its line? Then the wrap must too, or the layout
     changes underneath it. Read the computed width first: for an input in a
     hidden screen the box is 0 wide, but the computed value still says '100%'. */
  function fillsLine(input, cs) {
    if (cs.width === '100%') return true;
    var parent = input.parentNode;
    if (!parent || !parent.getBoundingClientRect) return false;
    var w = input.getBoundingClientRect().width;
    if (!w) return cs.display === 'block';
    var pcs = window.getComputedStyle(parent);
    var inner = parent.clientWidth -
      (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
    return inner > 0 && w >= inner * 0.95;
  }

  function sync(input) {
    var show = input.__prcShow;
    if (!show) return;
    var value = input.value || '';
    var text = format(value);
    var disabled = !!input.disabled;
    if (text) {
      if (show.textContent !== text) show.textContent = text;
      show.classList.remove('is-empty');
    } else {
      var ph = input.getAttribute('placeholder') || PLACEHOLDER;
      if (show.textContent !== ph) show.textContent = ph;
      show.classList.add('is-empty');
    }
    if (disabled) show.classList.add('is-disabled');
    else show.classList.remove('is-disabled');
    input.__prcLast = value;
    input.__prcLastDisabled = disabled;
  }

  function decorateOne(input) {
    if (isDecorated(input) || !input.parentNode) return;
    var cs = window.getComputedStyle(input);
    var wrap = document.createElement('span');
    wrap.className = 'datewrap' + (fillsLine(input, cs) ? '' : ' datewrap--inline');
    var show = document.createElement('span');
    show.className = 'dateshow is-empty';
    show.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < COPY.length; i++) {
      var v = cs[COPY[i]];
      if (v && v !== 'normal' && v !== 'auto') show.style[COPY[i]] = v;
    }

    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(show);
    input.__prcShow = show;

    input.addEventListener('input', function () { sync(input); });
    input.addEventListener('change', function () { sync(input); });
    input.addEventListener('focus', function () { show.classList.add('is-focus'); });
    input.addEventListener('blur', function () { show.classList.remove('is-focus'); });
    /* Desktop Chrome draws its calendar button inside the (now transparent)
       input; clicking the text part does not open the picker there. showPicker
       does, when the browser has it and the click counts as user activation. */
    input.addEventListener('click', function () {
      if (input.disabled) return;
      if (typeof input.showPicker === 'function') {
        try { input.showPicker(); } catch (e) { /* not activated, or unsupported */ }
      }
    });
    if (typeof MutationObserver === 'function') {
      var mo = new MutationObserver(function () { sync(input); });
      mo.observe(input, { attributes: true, attributeFilter: ['disabled', 'placeholder'] });
      input.__prcObserver = mo;
    }
    registry.push(input);
    sync(input);
  }

  function collect(root) {
    var out = [];
    if (!root) return out;
    if (root.nodeType === 1 && root.tagName === 'INPUT') {
      if ((root.getAttribute('type') || '').toLowerCase() === 'date') out.push(root);
      return out;
    }
    if (!root.querySelectorAll) return out;
    var list = root.querySelectorAll('input[type="date"]');
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  /* Values set from code raise no event. A cheap tick over a handful of
     inputs catches them; anything that fell out of the page is forgotten. */
  function tick() {
    for (var i = registry.length - 1; i >= 0; i--) {
      var input = registry[i];
      if (!document.contains(input)) {
        if (input.__prcObserver) input.__prcObserver.disconnect();
        registry.splice(i, 1);
        continue;
      }
      if ((input.value || '') !== input.__prcLast || !!input.disabled !== input.__prcLastDisabled) {
        sync(input);
      }
    }
  }

  function startWatching() {
    if (ticking === null) ticking = setInterval(tick, TICK_MS);
    if (bodyObserver || typeof MutationObserver !== 'function') return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', startWatching);
      return;
    }
    bodyObserver = new MutationObserver(function (records) {
      for (var r = 0; r < records.length; r++) {
        var added = records[r].addedNodes;
        for (var a = 0; a < added.length; a++) {
          if (added[a].nodeType !== 1) continue;
          var found = collect(added[a]);
          for (var f = 0; f < found.length; f++) decorateOne(found[f]);
        }
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  function decorate(root) {
    injectCSS();
    var inputs = collect(root || document);
    for (var i = 0; i < inputs.length; i++) decorateOne(inputs[i]);
    startWatching();
  }

  function refresh(root) {
    var inputs = collect(root || document);
    for (var i = 0; i < inputs.length; i++) if (inputs[i].__prcShow) sync(inputs[i]);
  }

  window.PRCDates = { decorate: decorate, refresh: refresh, format: format };
})();
