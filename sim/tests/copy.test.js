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
  ['a year that has passed', 'The rule changed last year.'],
  ['an index level', 'The Nifty has doubled since then.']
].forEach(function (row) {
  ok('caught ' + row[0] + ': "' + row[1].slice(0, 40) + '"', breaks(row[1], 'timeless'));
});
ok('a substitution token is not a reference to a moment',
   !breaks('This fund last published a NAV on [DATE].', 'timeless'),
   JSON.stringify(lint('This fund last published a NAV on [DATE].')));
ok('a book pointer is not a reference to a moment',
   !breaks('The short-period rule is set out in [CH-REF:SHORT-PERIOD].', 'timeless'));
/* "Today" meaning the reader's own present does not age, and the author uses
   it that way throughout v4. A word meaning "when this was written" does. */
ok('"today" as the reader\'s own present is allowed',
   !breaks('Add what it is all worth today, and the date you read it.', 'timeless'),
   JSON.stringify(lint('Add what it is all worth today, and the date you read it.')));
ok('and so is the launch-to-today instruction in the upload guide',
   !breaks('The daily NAV history of the scheme you own, from its first day to today.', 'timeless'));
ok('but "currently" still is not', breaks('Rates are currently low.', 'timeless'));
ok('and neither is "recently"', breaks('The fund recently changed manager.', 'timeless'));

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
console.log('  ' + todo.length + ' slots are still empty, which is the expected state while the author writes.');
/* What this actually has to prove is that unwritten() agrees with the deck:
   every slot with no text is named, and no slot that HAS text is. Counting
   against a fixed total only held while exactly one slot was written. */
var emptyIds = Object.keys(deck.slots).filter(function (k) { return !String(deck.slots[k].text || '').trim(); });
var writtenIds = Object.keys(deck.slots).filter(function (k) { return String(deck.slots[k].text || '').trim(); });
ok('the build names every slot still waiting',
   emptyIds.every(function (id) { return todo.indexOf(id) >= 0; }),
   emptyIds.filter(function (id) { return todo.indexOf(id) < 0; }).join(', '));
ok('and names no slot the author has already written',
   writtenIds.every(function (id) { return todo.indexOf(id) < 0; }),
   writtenIds.filter(function (id) { return todo.indexOf(id) >= 0; }).join(', '));

section('Review v4 section 10 - the eighteen, and their nine next steps');
var t3v4 = States.config.tools.myMoneyInThisFund;
var eighteenIds = t3v4.cells.map(function (c) { return c.slot; })
  .concat(t3v4.overrides.map(function (o) { return o.slot; }))
  .concat(t3v4.replay.map(function (r) { return r.slot; }))
  .concat(t3v4.drip.lines.map(function (d) { return d.slot; }))
  .concat(t3v4.extra.map(function (e) { return e.slot; }));
ok('all eighteen are written', eighteenIds.every(function (id) { return deck.slots[id].text; }),
   eighteenIds.filter(function (id) { return !deck.slots[id].text; }).join(', '));
ok('and all nine next steps with them',
   t3v4.cells.every(function (c) { return deck.slots[c.nextSlot].text; }),
   t3v4.cells.filter(function (c) { return !deck.slots[c.nextSlot].text; }).map(function (c) { return c.nextSlot; }).join(', '));
ok('every one is inside its budget',
   eighteenIds.every(function (id) { return deck.slots[id].text.length <= deck.slots[id].budget; }));
/* The braces in her drafts became named tokens; a token the engine does not
   fill would print as literal brackets on the reader's screen. */
var TOKENS = ['GAP', 'MONTHS', 'YOURS', 'INDEX', 'DRIP', 'AMOUNT'];
var strays = [];
eighteenIds.concat(t3v4.cells.map(function (c) { return c.nextSlot; })).forEach(function (id) {
  var found = String(deck.slots[id].text).match(/\[([A-Z_]+)\]/g) || [];
  found.forEach(function (tok) {
    var name = tok.slice(1, -1);
    if (TOKENS.indexOf(name) < 0) strays.push(id + ': ' + tok);
  });
});
ok('and every figure token is one the engine knows how to fill', strays.length === 0, strays.join(', '));

console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) { console.log('\nFAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
