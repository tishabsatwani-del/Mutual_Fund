/* The number standard of review v4 section 11, pinned.
 *
 * Section 11 is a specification, so this reads as one: every row of the
 * author's own table, every "never", and the four wrong conventions the
 * recording caught, each asserted against the figure that was on screen.
 *
 * Run: node sim/tests/format.test.js
 */
'use strict';
var F = require('../format.js');

var passed = 0, failed = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  pass  ' + name); }
  else { failed.push(name); console.log('  FAIL  ' + name + (detail ? '   -- ' + detail : '')); }
}
function eq(name, actual, expected) { ok(name, actual === expected, 'got ' + actual + ', expected ' + expected); }
function section(t) { console.log('\n' + t); }

section('The author’s own table, both columns');
[
  [87500,       '₹87,500',      '₹87,500'],
  [420000,      '₹4.20 lakh',   '₹4,20,000'],
  [12642444,    '₹1.26 crore',  '₹1,26,42,444'],
  [43120000000, '₹4,312 crore', '₹43,12,00,00,000']
].forEach(function (row) {
  eq('headline ' + row[0], F.moneyWords(row[0]), row[1]);
  eq('ledger   ' + row[0], F.money(row[0]), row[2]);
});

section('Grouping is Indian, always');
eq('the workbook figure that grouped four digits', F.money(5687111), '₹56,87,111');
eq('and the spare line that grouped the Western way', F.money(687111), '₹6,87,111');
ok('never a Western group of three past the first',
   !/,\d{3},\d{3}$/.test(F.money(12345678)), F.money(12345678));

section('The four "never"s');
/* toFixed falls back to exponent at 1e21; the crore path divided by 1e7 and
   called it, which is how a plan printed ₹1.264244546793246e+68 crore. */
[1.264244546793246e+68, 1e21, 1e30, 5e10].forEach(function (n) {
  ok('no exponent form at ' + n, !/e[+-]/i.test(F.moneyWords(n)) && !/e[+-]/i.test(F.money(n)),
     F.moneyWords(n).slice(0, 40));
});
ok('never more than two decimals on a rupee figure',
   !/\.\d{3}/.test(F.moneyWords(1234567)) && !/\.\d{3}/.test(F.money(1234567)));
ok('never a rupee figure without ₹',
   F.money(5).indexOf('₹') === 0 && F.moneyWords(5000000).indexOf('₹') === 0);
ok('a figure that cannot be computed is an em dash, not NaN or Infinity',
   F.money(NaN) === '—' && F.money(Infinity) === '—' && F.moneyWords(-Infinity) === '—');

section('Two decimals below a hundred units, none above');
eq('1.26 crore keeps its decimals', F.moneyWords(12642444), '₹1.26 crore');
eq('99.99 lakh keeps them too', F.moneyWords(9999000), '₹99.99 lakh');
eq('4,312 crore drops them', F.moneyWords(43120000000), '₹4,312 crore');
ok('and the unit word is singular and spelled out',
   / lakh$/.test(F.moneyWords(420000)) && / crore$/.test(F.moneyWords(12642444)) &&
   !/lakhs|crores|\bL\b|\bCr\b/i.test(F.moneyWords(420000) + F.moneyWords(12642444)));

section('Percentages, years, dates');
eq('one decimal, sign closed up', F.pct(0.092), '9.2%');
eq('a true minus, not a hyphen', F.pct(-0.0342), '−3.4%');
ok('and it really is U+2212', F.pct(-0.0342).charCodeAt(0) === 0x2212);
eq('a plus only where asked for', F.pct(0.092, { signed: true }), '+9.2%');
eq('and not otherwise', F.pct(0.092), '9.2%');
eq('years to one decimal', F.years(5.4), '5.4 years');
/* 04/01/2022 is 4 January to an Indian reader and 1 April to the tool. */
eq('dates are dd-MMM-yyyy', F.date(Date.UTC(2022, 3, 1)), '01-Apr-2022');
eq('and never American', F.date(Date.UTC(2026, 7, 30)), '30-Aug-2026');
eq('"to" between dates, never a dash',
   F.span(Date.UTC(2021, 3, 1), Date.UTC(2026, 7, 30)), '01-Apr-2021 to 30-Aug-2026');
eq('a date that is not one is an em dash', F.date('not a date'), '—');

section('Input caps — what stops the figure being computed at all');
eq('the step-up the recording accepted', F.checkInput('stepUp', 10000000),
   'A step-up has to be between 0% and 25%.');
ok('a return above thirty is refused', F.checkInput('rate', 45) !== null);
ok('and one inside it is not', F.checkInput('rate', 12) === null);
/* Raised from 20 to 25 at the author's instruction, 31 August 2026, so it now
   matches the step-up cap. Review v4 §11 set 20; both numbers in circulation
   would have the code and the review disagreeing about one field. */
ok('inflation stops at twenty-five',
   F.checkInput('inflation', 25) === null && F.checkInput('inflation', 26) !== null);
ok('years run one to fifty',
   F.checkInput('years', 0) !== null && F.checkInput('years', 51) !== null &&
   F.checkInput('years', 50) === null);
eq('rupees stop at ₹1,000 crore', F.checkInput('rupees', 5e10),
   'An amount has to be between ₹0 and ₹1,000 crore.');
ok('and ₹1,000 crore itself is allowed', F.checkInput('rupees', 1e10) === null);
ok('a blank field is refused rather than treated as zero',
   F.checkInput('rate', NaN) !== null);

section('The helper the review asks for under every rupee input');
eq('a typed crore echoes in words', F.echo(10000000), '= about ₹1.00 crore');
eq('and a small amount needs no echo', F.echo(87500), '');

console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) { console.log('\nFAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
