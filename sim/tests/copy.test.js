/* The Simulator - the copy deck checks of sections 13 and 16.8.
 *
 * Two jobs. First, prove the rules actually catch what they claim to, by running
 * them over sentences written here to break each one; a lint nobody has tried to
 * fool is a lint that passes everything. Second, run them over the real deck.
 *
 * Run: node sim/tests/copy.test.js
 */
'use strict';

var C = require('../copy.js');
var deck = require('../copy.json');
var States = require('../states.js');

var passed = 0, failed = [];
function ok(name, condition, detail) {
  if (condition) { passed++; console.log('  pass  ' + name); }
  else { failed.push(name); console.log('  FAIL  ' + name + (detail ? '   -- ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

function lint(text) { return C.check({ slots: { T: { text: text, budget: 10000 } } }); }
function breaks(text, rule) { return lint(text).some(function (f) { return f.rule === rule; }); }

section('Rule 1 - no sentence may tell the reader to act on an investment');
[
  'You should sell the fund that lags.',
  'Consider switching to the cheaper plan.',
  'Never redeem in a falling market.',
  'Stop the instalment when the gap widens.',
  'Read the gap, and then buy more of it.',
  'It is worth booking the gain here.'
].forEach(function (t) { ok('caught: "' + t + '"', breaks(t, 'transaction-verb')); });

[
  'A fund is bought at the price of the day it is processed, not the day it is entered.',
  'The rate below is what your money earned, not what the fund earned.',
  'This reading tells you where you stand. It does not tell you what to do.',
  'Selling costs and taxes sit outside this figure.'
].forEach(function (t) { ok('allowed: "' + t.slice(0, 48) + '"', !breaks(t, 'transaction-verb'), JSON.stringify(lint(t))); });

section('Rule 2 - timeless by construction');
[
  ['a year', 'Between 2008 and 2013 this looked very different.'],
  ['a month name', 'The rule changed in January.'],
  ['a percentage', 'A fixed deposit pays about 7% a year.'],
  ['a word meaning now', 'Rates are currently low.'],
  ['an index level', 'The Nifty has doubled since then.']
].forEach(function (row) {
  ok('caught ' + row[0] + ': "' + row[1].slice(0, 40) + '"', breaks(row[1], 'timeless'));
});
ok('a substitution token is not a reference to a moment',
   !breaks('This fund last published a NAV on [DATE].', 'timeless'),
   JSON.stringify(lint('This fund last published a NAV on [DATE].')));
ok('a book pointer is not a reference to a moment',
   !breaks('The short-period rule is set out in [CH-REF:SHORT-PERIOD].', 'timeless'));

section('Rule 3 - the vocabulary exclusions');
ok('caught "insider"', breaks('What the insiders know.', 'vocabulary'));
ok('caught "veterans"', breaks('Ask any of the veterans.', 'vocabulary'));
ok('ordinary prose passes all three rules', lint('Your money moved at one speed. The fund moved at another.').length === 0);

section('Budgets');
ok('a slot over its budget is reported',
   C.check({ slots: { T: { text: 'aaaaaaaaaa', budget: 5 } } }).some(function (f) { return f.rule === 'budget'; }));

section('The deck itself');
var findings = C.check(deck);
ok('sim/copy.json breaks none of the rules', findings.length === 0, JSON.stringify(findings));
ok('every slot declares a character budget',
   Object.keys(deck.slots).every(function (k) { return deck.slots[k].budget > 0; }));
ok('every slot says where it appears',
   Object.keys(deck.slots).every(function (k) { return String(deck.slots[k].where || '').length > 10; }));

section('The deck covers every slot the code asks for');
var have = Object.keys(deck.slots);
var missing = States.allSlots().filter(function (id) { return have.indexOf(id) < 0; });
ok('every slot the evaluator can ask for exists in the deck', missing.length === 0, missing.join(', '));

section('The eighteen Tool 3 slots are addressable');
var t3 = States.config.tools.myMoneyInThisFund;
var eighteen = t3.cells.map(function (c) { return c.slot; })
  .concat(t3.overrides.map(function (o) { return o.slot; }))
  .concat(t3.replay.map(function (r) { return r.slot; }))
  .concat(t3.drip.lines.map(function (d) { return d.slot; }))
  .concat(t3.extra.map(function (e) { return e.slot; }));
ok('there are exactly eighteen of them', eighteen.length === 18, 'found ' + eighteen.length);
ok('and nine next steps beside them', t3.cells.filter(function (c) { return c.nextSlot; }).length === 9);
ok('every one resolves in the deck',
   eighteen.concat(t3.cells.map(function (c) { return c.nextSlot; }))
     .every(function (id) { return deck.slots[id]; }));
ok('the ids are unique, so wording can change without touching code',
   new Set(eighteen).size === 18);
ok('the thresholds are signed off and dated',
   States.config.signedOff === true && /^\d{4}-\d{2}-\d{2}$/.test(States.config.signedOffOn || ''));
ok('and they are the values the author signed', (function () {
  var t = States.config.thresholds;
  return t.similarPoints === 0.5 && t.placementLowPercentile === 25 &&
         t.placementHighPercentile === 75 && t.comparisonPoints === 1.0 &&
         t.recentLumpShare === 0.40 && t.recentLumpMonths === 12 &&
         t.dripLumpMultiple === 3 && t.dripGapMonths === 2;
})());

section('The About paragraph the author kept');
ok('ABOUT-MAIN is written', !!deck.slots['ABOUT-MAIN'].text);
ok('and it breaks none of the three rules',
   C.check({ slots: { A: deck.slots['ABOUT-MAIN'] } }).length === 0);
ok('the product is named', deck.product === 'Where You Stand');
ok('and the four tools are named',
   Object.values(deck.tools).join(' | ') ===
   'My return | This fund\'s record | My money in this fund | My plan, tested');

var refs = Object.keys(deck.chapterRefs).filter(function (k) { return k.charAt(0) !== '$'; });
ok('the chapter-pointer table has entries for the five questions', refs.length === 5, refs.join(', '));

section('What the author still has to write');
var todo = C.unwritten(deck);
console.log('  ' + todo.length + ' slots are still empty, which is the expected state before the author writes.');
ok('the build can name every slot still waiting',
   todo.length === Object.keys(deck.slots).length - 1 + Object.keys(deck.chapterRefs).length - 1,
   'named ' + todo.length + ' of ' + Object.keys(deck.slots).length + ' slots');

console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) { console.log('\nFAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
