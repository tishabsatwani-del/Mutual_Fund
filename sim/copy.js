/* The Simulator - the copy deck's three hard rules, from section 13.
 *
 * Section 16.8: wire every prose surface to copy.json and run the vocabulary
 * and transaction-verb checks in CI. This module is the check. It is exported
 * as well as runnable, so the same rules apply in CI and in any editing tool
 * the author is given.
 *
 * It reads prose the author wrote and reports on it. It never rewrites it.
 */
(function (root) {
  'use strict';

  /* Rule 3: the author's standing editorial exclusions. */
  var EXCLUDED = ['insider', 'insiders', 'veteran', 'veterans'];

  /* Rule 1: no sentence may tell the reader to act on an investment. Bare
   * mentions are allowed -- "the day you sell" explains, it does not instruct --
   * so the check looks for the shapes an instruction actually takes: the verb
   * opening a sentence or a clause, or following an advising construction. */
  var ACT = 'buy|sell|switch|hold|redeem|stop|start|continue|invest|exit|book|withdraw';
  var ADVISE = [
    new RegExp('\\b(?:you\\s+(?:should|must|could|can|may|might|need\\s+to|ought\\s+to|want\\s+to|would|will))\\s+(?:' + ACT + ')\\b', 'i'),
    new RegExp('\\b(?:consider|try|avoid|prefer|remember\\s+to|make\\s+sure\\s+to|it\\s+is\\s+worth|why\\s+not)\\s+(?:\\w+ing\\b|to\\s+)?(?:' + ACT + ')', 'i'),
    new RegExp('\\b(?:do\\s+not|don\'t|never|always)\\s+(?:' + ACT + ')\\b', 'i'),
    new RegExp('(?:^|[.!?]\\s+|;\\s+|:\\s+|,\\s+(?:(?:and|or|but)\\s+(?:then\\s+)?|then\\s+))(?:' + ACT + ')\\b', 'i')
  ];

  /* Rule 2: timeless by construction. Nothing may reference a moment, because
   * a printed QR code cannot be reissued when the sentence goes stale. */
  var TIMEBOUND = [
    { name: 'a year', re: /\b(?:19|20)\d{2}\b/ },
    { name: 'a month name', re: /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i },
    { name: 'a numeric percentage', re: /\d+(?:\.\d+)?\s*(?:%|per\s?cent)/i },
    { name: 'a word that means "now"', re: /\b(?:today|currently|current(?:ly)?|right\s+now|at\s+present|nowadays|this\s+year|last\s+year|recent(?:ly)?|these\s+days|as\s+of\s+now)\b/i },
    { name: 'an index level', re: /\b(?:nifty|sensex|bse|nse)\b/i }
  ];

  /* Substitution tokens the app fills in are not the author referencing a
   * moment; they are placeholders. They are removed before rule 2 is applied. */
  var TOKEN = /\[[A-Z0-9:_-]+\]|\{\{[^}]+\}\}/g;

  function check(deck) {
    var findings = [];
    var slots = deck.slots || {};
    Object.keys(slots).forEach(function (id) {
      var slot = slots[id];
      var text = String(slot.text || '');
      if (!text) return;                     /* an unwritten slot breaks no rule */

      EXCLUDED.forEach(function (word) {
        if (new RegExp('\\b' + word + '\\b', 'i').test(text)) {
          findings.push({ slot: id, rule: 'vocabulary', detail: 'contains "' + word + '"' });
        }
      });

      ADVISE.forEach(function (re) {
        var m = re.exec(text);
        if (m) findings.push({ slot: id, rule: 'transaction-verb', detail: 'reads as an instruction: "' + m[0].trim() + '"' });
      });

      var timeless = text.replace(TOKEN, ' ');
      TIMEBOUND.forEach(function (t) {
        var m = t.re.exec(timeless);
        if (m) findings.push({ slot: id, rule: 'timeless', detail: 'references ' + t.name + ': "' + m[0].trim() + '"' });
      });

      if (slot.budget && text.length > slot.budget) {
        findings.push({ slot: id, rule: 'budget', detail: text.length + ' characters against a budget of ' + slot.budget });
      }
    });
    return findings;
  }

  /* Which slots the author still has to write, so a build can say so plainly
   * instead of shipping a screen with a hole in it. */
  function unwritten(deck) {
    var slots = deck.slots || {};
    var out = Object.keys(slots).filter(function (id) { return !String(slots[id].text || '').trim(); });
    Object.keys(deck.chapterRefs || {}).forEach(function (k) {
      if (k.charAt(0) !== '$' && !String(deck.chapterRefs[k] || '').trim()) out.push('chapterRefs.' + k);
    });
    return out;
  }

  var api = { check: check, unwritten: unwritten, EXCLUDED: EXCLUDED };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimCopy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
