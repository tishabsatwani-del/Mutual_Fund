/* Where You Stand — start-up, and the handlers every result screen shares. */
(function (root) {
  'use strict';
  var A = root.PRCApp, E = root.PRCEngine, C = root.PRCCharts;
  var $ = A.$, esc = A.esc, pct = A.pct;

  function shared() {
    /* result tabs: one panel at a time on a phone; the CSS decides */
    document.addEventListener('click', function (ev) {
      var tab = ev.target && ev.target.closest ? ev.target.closest('.ixtab') : null;
      if (!tab) return;
      var host = tab.closest('.ixpath');
      if (!host) return;
      var want = tab.dataset.panel;
      host.querySelectorAll('.ixtab').forEach(function (t) { var on = t.dataset.panel === want; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
      var target = null;
      host.querySelectorAll('.ixpanel').forEach(function (p) { var on = p.dataset.panel === want; p.classList.toggle('on', on); if (on) target = p; });
      if (target && window.innerWidth > 720) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else if (target) host.querySelector('.ixtabs').scrollIntoView({ block: 'start' });
    });
    /* back to the tabs once the reader is a screen down */
    window.addEventListener('scroll', function () {
      document.querySelectorAll('.ixpath').forEach(function (host) {
        var b = host.querySelector('.totop');
        if (!b) return;
        var endOnScreen = host.getBoundingClientRect().bottom < window.innerHeight + 24;
        b.hidden = !(window.scrollY > host.offsetTop + window.innerHeight) || endOnScreen;
      });
    }, { passive: true });
    document.addEventListener('click', function (ev) {
      var top = ev.target && ev.target.closest ? ev.target.closest('.totop') : null;
      if (top) { var host = top.closest('.ixpath'); (host.querySelector('.ixtabs') || host).scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    });
    /* the rate boxes: presets type for you; the box drives its card and the horizon table */
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.ratepresets .chip') : null;
      if (!btn) return;
      var input = document.getElementById('rate-' + btn.parentNode.dataset.key);
      if (!input) return;
      input.value = btn.dataset.rate;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.addEventListener('input', function (ev) {
      var input = ev.target;
      if (!input.classList || !input.classList.contains('ratecheck')) return;
      var key = input.dataset.key, years = input.dataset.years;
      var values = root.PRCRateData && root.PRCRateData[key];
      var rate = parseFloat(input.value) / 100;
      var out = document.getElementById('rateout-' + key), sub = document.getElementById('ratesub-' + key);
      if (!out || !values) return;
      var res = E.shareAbove(values, rate);
      if (!res.ok) { out.textContent = '—'; sub.textContent = 'Enter a rate.'; return; }
      out.textContent = pct(res.share, 0);
      sub.textContent = 'In ' + pct(res.share, 0) + ' of the ' + years + '-year holding periods in this data (' + res.above.toLocaleString('en-IN') + ' of ' + res.count.toLocaleString('en-IN') + '), the return beat ' + pct(rate, 1) + ' a year. Past periods, not future odds.';
      var hd = root.PRCHorizonData && root.PRCHorizonData[key];
      (hd || []).forEach(function (row) {
        var cell = document.querySelector('[data-beat-h="' + row.h + '"][data-key="' + key + '"]');
        if (!cell) return;
        var share = E.shareAbove(row.values, rate);
        cell.textContent = share.ok ? pct(share.share, 0) : '—';
      });
    });
    /* the fan chart's readout follows the horizon under the pointer, tapped, or focused */
    function fanShow(ev) {
      var hit = ev.target && ev.target.closest ? ev.target.closest('.fan-hit') : null;
      if (!hit) return;
      var out = document.getElementById('fanout-' + hit.dataset.key);
      if (!out) return;
      var fig = hit.closest('.fanchart');
      var benchName = fig && fig.querySelector('.legend .key:nth-child(2)') ? fig.querySelector('.legend .key:nth-child(2)').textContent.replace(/ \(dashed\)$/, '') : '';
      out.textContent = C.fanReadout(hit.dataset.fanH, hit.dataset.p10, hit.dataset.med, hit.dataset.p90, hit.dataset.n,
        hit.dataset.bmed ? { p10: hit.dataset.b10, median: hit.dataset.bmed, p90: hit.dataset.b90 } : null, benchName);
    }
    document.addEventListener('mouseover', fanShow);
    document.addEventListener('click', fanShow);
    document.addEventListener('focusin', fanShow);
    /* the window table: year chips jump, the CSV button hands over the rows */
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target : null;
      if (!t) return;
      var chip = t.closest('[data-jump-year]');
      if (chip) {
        var box = document.getElementById('winbox-rolling');
        var row = box && box.querySelector('tr[data-year="' + chip.dataset.jumpYear + '"]');
        if (box && row) { var head = box.querySelector('thead'); box.scrollTop = Math.max(0, row.offsetTop - (head ? head.offsetHeight : 0)); }
        return;
      }
      var csv = t.closest('.wincsv');
      if (csv && root.PRCRolling && root.PRCRolling.windowCsv) {
        var got = root.PRCRolling.windowCsv();
        if (got) A.downloadText(got.text, 'Where-You-Stand-' + A.fileSlug(got.name) + '-windows.csv', 'text/csv');
      }
    });
    /* Save as PDF */
    var PDF_ROOT = { rolling: '#r-out', portfolio: '#pf-out', goal: '#g-out' };
    var PDF_TITLE = { rolling: 'Rolling returns', portfolio: 'Check my portfolio', goal: 'Plan my goal' };
    document.addEventListener('pointerdown', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('.pdfbtn') && root.PRCPdf) root.PRCPdf.ready();
    });
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.pdfbtn') : null;
      if (!btn || btn.dataset.busy === 'yes') return;
      var which = btn.dataset.pdf || 'rolling';
      var rootEl = document.querySelector(PDF_ROOT[which] || '#r-out');
      var note = btn.parentNode ? btn.parentNode.querySelector('.pdfnote') : null;
      if (!rootEl) return;
      if (!root.PRCPdf) { if (note) note.textContent = 'Your browser blocked the download. Use Share → Print → Save as PDF.'; return; }
      btn.dataset.busy = 'yes'; btn.setAttribute('aria-busy', 'true');
      if (note) note.textContent = 'Building the PDF…';
      root.PRCPdf.save({
        root: rootEl, title: PDF_TITLE[which] + (btn.dataset.name ? ' — ' + btn.dataset.name : ''),
        shortName: A.fileSlug(btn.dataset.name || PDF_TITLE[which]), inputs: null,
        appendix: which === 'rolling' && root.PRCRolling ? root.PRCRolling.windowAppendix() : null,
        footerLine: 'Already happened, not a forecast. Educational tool, not investment advice. Figures are before tax and exit load.'
      }).then(function (got) {
        if (!note) return;
        var name = got && got.name ? got.name : 'the PDF';
        note.innerHTML = 'Saved as <strong>' + esc(name) + '</strong>' + (got && got.size ? ' (' + Math.max(1, Math.round(got.size / 1024)) + ' KB)' : '') +
          '. If nothing appeared, <a href="' + (got && got.url ? got.url : '#') + '" download="' + esc(name) + '" target="_blank" rel="noopener">open the PDF here</a>' +
          (A.inAppBrowser() ? ', or open this page in your phone’s browser' : '') + '.';
      }, function (err) {
        if (note) note.textContent = (err && err.message) || 'Your browser blocked the download. Use Share → Print → Save as PDF.';
      }).then(function () { delete btn.dataset.busy; btn.removeAttribute('aria-busy'); });
    });
    /* the goal screen's rupee echoes */
    ['g-target', 'g-current', 'g-sip'].forEach(function (id) {
      var input = $('#' + id), echo = $('#' + id + '-echo');
      if (!input || !echo) return;
      function say() {
        var v = parseFloat(input.value), bad = A.checkInput('rupees', v);
        echo.textContent = input.value.trim() === '' ? '' : bad ? bad : A.echo(v);
        echo.classList.toggle('refuse', !!bad && input.value.trim() !== '');
      }
      input.addEventListener('input', say); say();
    });
  }

  function init() {
    A.initRouter();
    shared();
    if (root.PRCDates) root.PRCDates.decorate(document);
    var ver = $('#ver'); if (ver) ver.textContent = A.VERSION;
    if (A.inAppBrowser()) {
      ['#pf-door', '#step-source', '#g-history-card'].forEach(function (sel) {
        var card = $(sel); if (!card) return;
        var n = document.createElement('div'); n.innerHTML = A.notice('warn', A.IN_APP_NOTE); n.firstChild.classList.add('inapp');
        card.insertBefore(n.firstChild, card.firstChild.nextSibling);
      });
    }
    if (root.PRCUnderstand) root.PRCUnderstand.init();
    if (root.PRCPortfolio) root.PRCPortfolio.init();
    if (root.PRCGoal) root.PRCGoal.init();
    if (root.PRCRolling) root.PRCRolling.init();
    /* a hash such as #understand/xirr on first paint: scroll once the page exists */
    var m = /^#([a-z]+)\/(.+)$/.exec(location.hash || '');
    if (m) setTimeout(function () { A.show(m[1] + '/' + m[2]); }, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
