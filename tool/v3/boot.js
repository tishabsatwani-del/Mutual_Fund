/* Where You Stand — start the four tools.
 *
 * The home screen's own line and the footer refrains are the author's, so both
 * are slots. Where one is unwritten the page names it, exactly as every other
 * screen does.
 */
(function (root) {
  'use strict';
  var W = root.WYS;

  W.view('home', {});
  W.view('mine', {});
  W.view('plan', {});

  function boot() {
    W.$('#home-promise').innerHTML = W.slot('LANDING-PROMISE');
    W.$('#foot-refrains').innerHTML = W.slot('FOOTER-REFRAINS');
    root.WYSRecord.init();
    root.WhereYouStand.init();
    W.start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
