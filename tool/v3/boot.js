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

  /* About is the one screen made entirely of the author's own writing plus
   * facts about the software. ABOUT-MAIN is §8's draft, kept as she signed it
   * off; the tool names and the chapter pointers come out of the same deck, so
   * renaming a tool or renumbering a chapter never touches this file.
   *
   * "What this build reads" is not prose. It is a statement of what the code in
   * front of the reader actually does, which is the one thing a privacy note
   * has to be checkable against. */
  W.view('about', {});

  function drawAbout() {
    W.$('#about-main').innerHTML = '<div class="reading">' + W.slot('ABOUT-MAIN') + '</div>';

    var tools = W.copy.tools;
    W.$('#about-tools').innerHTML = [
      ['mine', 'myReturn'], ['record', 'thisFundsRecord'],
      ['stand', 'myMoneyInThisFund'], ['plan', 'myPlanTested']
    ].map(function (pair) {
      return '<li><a href="#' + pair[0] + '">' + W.esc(tools[pair[1]]) + '</a></li>';
    }).join('');

    /* A pointer the author has not written names itself, exactly as a sentence
       slot does. Chapter numbering stays hers. */
    var refs = W.copy.chapterRefs;
    W.$('#about-refs').innerHTML = Object.keys(refs)
      .filter(function (k) { return k.charAt(0) !== '$'; })
      .map(function (k) {
        return refs[k]
          ? '<li>' + W.esc(refs[k]) + '</li>'
          : '<li class="slot-empty">Awaiting chapter pointer <code>' + W.esc(k) + '</code></li>';
      }).join('');

    W.$('#about-build').innerHTML = [
      ['Your entries', 'kept in this browser, only when you press Save'],
      ['A fund’s prices', W.hasProvider() ? 'fetched from a public source' : 'read from a file you choose'],
      ['What is sent anywhere', 'nothing'],
      ['What the figures leave out', 'tax and exit load']
    ].map(function (r) {
      /* Not .n: that column is for figures, and a sentence pushed to the right
         margin has to be read backwards from its ragged left edge. */
      return '<tr><td class="what">' + r[0] + '</td><td>' + r[1] + '</td></tr>';
    }).join('');
  }

  function boot() {
    W.$('#home-promise').innerHTML = W.slot('LANDING-PROMISE');
    W.$('#foot-refrains').innerHTML = W.slot('FOOTER-REFRAINS');
    drawAbout();
    root.WYSRecord.init();
    root.WhereYouStand.init();
    root.WYSMine.init();
    root.WYSPlan.init();
    W.start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
