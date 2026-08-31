/* The upload door, review v4 section 5.
 *
 * Upload is the only door, so it has to hold a conversation rather than just
 * parse. Three of section 5's rules are questions and two are arithmetic over
 * several files at once; all five are driven here, headlessly, along with
 * every message the section writes out.
 *
 * Run: node sim/tests/upload.test.js
 */
'use strict';
var U = require('../upload.js');
var F = require('../format.js');

var passed = 0, failed = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  pass  ' + name); }
  else { failed.push(name); console.log('  FAIL  ' + name + (detail ? '   -- ' + detail : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }
function section(t) { console.log('\n' + t); }

var d = Date.UTC;
function iso(t) { return new Date(t).toISOString().slice(0, 10); }

/* A daily file, written the way a fund house exports one. */
function csv(fromT, days, startNav, opts) {
  var o = opts || {};
  var lines = [o.header || 'Date,NAV'];
  for (var i = 0; i < days; i++) {
    var t = fromT + i * 86400000;
    var dd = new Date(t);
    var date = o.slashes
      ? String(dd.getUTCDate()).padStart(2, '0') + '/' + String(dd.getUTCMonth() + 1).padStart(2, '0') + '/' + dd.getUTCFullYear()
      : iso(t);
    lines.push(date + ',' + (startNav * Math.pow(1.10, i / 365)).toFixed(4));
  }
  return lines.join('\n');
}

section('Section 5 · a file whose dates read only one way needs no question');
{
  var r = U.read([{ name: 'fund.csv', text: csv(d(2015, 0, 1), 400, 10) }]);
  ok('it is read straight through', r.ok === true, JSON.stringify(r).slice(0, 160));
  ok('and nothing is asked', r.ask === null);
  ok('the confirmation names the count, the fund and the dates',
     /^Found 400 NAVs for fund, 01-Jan-2015 to 04-Feb-2016, no gaps\.$/.test(r.confirmation),
     r.confirmation);
}

section('Section 5 · dates that read two ways are asked about ONCE');
{
  /* every date in this file is valid read either way */
  var text = 'Date,NAV\n01/02/2020,10\n02/03/2020,11\n03/04/2020,12\n04/05/2020,13\n';
  var r = U.read([{ name: 'ambiguous.csv', text: text }]);
  eq('the door asks rather than guessing', r.ask, 'day-first');
  ok('and it shows the first row read both ways',
     /The first row is 01-Feb-2020 one way, 02-Jan-2020 the other/.test(r.message), r.message);
  ok('the message is section 5’s, and it ends in a question',
     /^These dates read two ways\./.test(r.message) && /Which is right\?$/.test(r.message), r.message);

  /* answering it settles the whole pile, and it is never asked again */
  var dayFirst = U.read([{ name: 'ambiguous.csv', text: text }], { dayFirst: true });
  ok('answering day-first reads it that way',
     dayFirst.ok && F.date(dayFirst.series[0].t) === '01-Feb-2020',
     dayFirst.ok ? F.date(dayFirst.series[0].t) : dayFirst.message);
  var monthFirst = U.read([{ name: 'ambiguous.csv', text: text }], { dayFirst: false });
  ok('and answering month-first reads it the other way',
     monthFirst.ok && F.date(monthFirst.series[0].t) === '02-Jan-2020',
     monthFirst.ok ? F.date(monthFirst.series[0].t) : monthFirst.message);
  ok('neither answer is asked again', dayFirst.ask === null && monthFirst.ask === null);
}

section('Section 5 · a file holding many schemes is listed, grouped');
{
  var rows = [['Scheme Name', 'Date', 'NAV']];
  var names = ['Acme Bluechip Fund - Direct Plan - Growth',
               'Acme Bluechip Fund - Direct Plan - IDCW',
               'Acme Bluechip Fund - Regular Plan - Growth',
               'Zenith Midcap Fund - Direct Plan - Growth'];
  names.forEach(function (n, k) {
    for (var i = 0; i < 30; i++) {
      rows.push([n, iso(d(2020, 0, 1) + i * 86400000), (10 + k + i * 0.01).toFixed(4)]);
    }
  });
  var r = U.read([{ name: 'all-schemes.csv', rows: rows }]);
  eq('the door asks which one', r.ask, 'scheme');
  ok('and counts them in the message',
     /This file has 4 schemes\. Pick the one you own\./.test(r.message), r.message);
  ok('they are grouped by family, not listed flat', r.groups.length === 2,
     JSON.stringify(r.groups.map(function (g) { return g.family; })));
  var acme = r.groups[0];
  ok('each family lists its plans and options', acme.rows.length === 3,
     JSON.stringify(acme.rows.map(function (x) { return x.plan + '/' + x.option; })));
  ok('Direct before Regular, Growth before IDCW',
     acme.rows[0].plan === 'direct' && acme.rows[0].option === 'growth' &&
     acme.rows[1].option === 'idcw',
     JSON.stringify(acme.rows.map(function (x) { return x.plan + '/' + x.option; })));

  /* picking one settles it */
  var picked = U.read([{ name: 'all-schemes.csv', rows: rows }],
                      { scheme: 'Zenith Midcap Fund - Direct Plan - Growth' });
  ok('picking one reads only that scheme', picked.ok && picked.series.length === 30,
     picked.ok ? String(picked.series.length) : picked.message);
  ok('and the confirmation names it',
     /Found 30 NAVs for Zenith Midcap Fund - Direct Plan - Growth/.test(picked.confirmation),
     picked.confirmation);
}

section('Section 5 · an IDCW row is refused, and told which row to pick');
{
  var rows = [['Scheme Name', 'Date', 'NAV']];
  for (var i = 0; i < 30; i++) {
    rows.push(['Acme Bluechip Fund - Direct Plan - IDCW', iso(d(2020, 0, 1) + i * 86400000), (10 + i * 0.01).toFixed(4)]);
  }
  var r = U.read([{ name: 'idcw.csv', rows: rows }], { scheme: 'Acme Bluechip Fund - Direct Plan - IDCW' });
  eq('it is refused', r.ok, false);
  eq('with the IDCW code', r.code, 'IDCW');
  ok('and section 5’s message, which says why AND what to pick instead',
     /Its NAV falls at every payout, so every return on it reads low\./.test(r.message) &&
     /Pick the Growth row of the same plan\./.test(r.message), r.message);
  ok('a refusal is not a question', r.ask === null);
}

section('Section 5 · many files stitched by date, overlaps removed, gaps reported');
{
  /* AMFI caps a download at 90 days, so a full history arrives in pieces --
     and readers overlap them, because the alternative is missing a day. */
  var a = csv(d(2020, 0, 1), 100, 10);
  var b = csv(d(2020, 2, 1), 100, 10);          /* starts inside a */
  var r = U.read([{ name: 'piece-1.csv', text: a }, { name: 'piece-2.csv', text: b }]);
  ok('the pieces become one series', r.ok, r.message);
  var dates = r.series.map(function (p) { return p.t; });
  ok('sorted, with no date appearing twice',
     dates.every(function (t, i) { return i === 0 || t > dates[i - 1]; }), 'not strictly ascending');
  ok('and the overlap is counted rather than duplicated', r.overlaps > 0, String(r.overlaps));
  var expected = Math.round((Math.max(d(2020, 0, 1) + 99 * 86400000, d(2020, 2, 1) + 99 * 86400000) -
                             d(2020, 0, 1)) / 86400000) + 1;
  eq('every day between the ends is present once', r.series.length, expected);
  ok('no gaps are reported where there are none', r.gaps.length === 0, JSON.stringify(r.gaps));
  ok('and the confirmation says so', /no gaps\.$/.test(r.confirmation), r.confirmation);
}

section('Section 5 · a gap between pieces is reported, with the instruction');
{
  var a = csv(d(2019, 0, 1), 12, 10);
  var b = csv(d(2019, 7, 14), 12, 12);          /* a long way after a ends */
  var r = U.read([{ name: 'p1.csv', text: a }, { name: 'p2.csv', text: b }]);
  ok('the gap is found', r.ok && r.gaps.length === 1, JSON.stringify(r.gaps));
  ok('the confirmation stops saying "no gaps"', /one gap\.$/.test(r.confirmation), r.confirmation);
  ok('and the message names the days, both dates, and what to do',
     /^There is a gap of \d+ days, \d\d-[A-Z][a-z]{2}-\d{4} to \d\d-[A-Z][a-z]{2}-\d{4}\./.test(r.gapMessage) &&
     /Windows crossing it use the last NAV before it\./.test(r.gapMessage) &&
     /If you downloaded in pieces, one may be missing\./.test(r.gapMessage), r.gapMessage);
  ok('a weekend is not a gap', U.gapsIn([{ t: d(2020,0,3), v: 1 }, { t: d(2020,0,6), v: 1 }]).length === 0);
}

section('Section 5 · a file with no dates in it');
{
  var r = U.read([{ name: 'notes.csv', text: 'Fund,Rating\nAcme,Five stars\nZenith,Four stars\n' }]);
  eq('it is refused', r.ok, false);
  ok('and told what the file should hold, and what will not work',
     /One column should be dates and one NAV\./.test(r.message) &&
     /A screenshot or PDF will not work; download the table\./.test(r.message), r.message);
  /* Nothing in it reads as a date OR as a number, so there is nothing to point
     at. Asking "which column holds the dates" of a file that has none would
     waste the reader's time twice. */
  ok('and is NOT asked to map columns it does not have', r.ask === null, String(r.ask));
}

section('A file whose columns cannot be found is a question, not a dead end');
{
  /* Two numeric columns and dates in a shape the parser cannot read: the file
     is fine, the guess is not, and the reader can see what the tool cannot. */
  var rows = [['Ref', 'Booked', 'Units', 'Price']];
  for (var i = 0; i < 12; i++) rows.push(['x', 'week ' + i, String(1 + i), (100 + i * 0.5).toFixed(4)]);
  var q = U.read([{ name: 'odd.csv', rows: rows }]);
  eq('the door asks which columns to read', q.ask, 'columns');
  ok('showing the reader their own file rather than describing it',
     q.columns.length === 4 && q.columns.every(function (c) { return c.samples.length > 0; }),
     JSON.stringify(q.columns.map(function (c) { return c.samples[0]; })));
  ok('each column says whether it reads as a date or as a number',
     q.columns.some(function (c) { return c.looksLikeNumber; }),
     JSON.stringify(q.columns.map(function (c) { return c.looksLikeDate + '/' + c.looksLikeNumber; })));
  ok('and it starts from its own best guess rather than from nothing',
     q.guess.valueCol >= 0, JSON.stringify(q.guess));

  /* Answering it settles the file. */
  var rows2 = [['Ref', 'When', 'Units', 'Price']];
  for (var k = 0; k < 40; k++) {
    rows2.push(['x', '2021-04-' + String((k % 28) + 1).padStart(2, '0'), '1', (100 + k * 0.1).toFixed(4)]);
  }
  var told = U.read([{ name: 'odd2.csv', rows: rows2 }], { dateCol: 1, valueCol: 3 });
  ok('pointing at two columns reads the file', told.ok, told.message);
  ok('and it is not asked again', told.ask === null);
  ok('the reader\'s choice beats the parser\'s guess',
     told.ok && told.series.length === 28, told.ok ? String(told.series.length) : '');
}

section('Section 5 · the shapes the door accepts');
{
  var recs = [];
  for (var i = 0; i < 40; i++) recs.push({ date: iso(d(2021, 0, 1) + i * 86400000), nav: (10 + i * 0.01).toFixed(4) });
  var r = U.read([{ name: 'mfapi.json', text: JSON.stringify({ data: recs }) }]);
  ok('a JSON export is read like any other file', r.ok && r.series.length === 40,
     r.ok ? String(r.series.length) : r.message);
  ok('and its keys are found by what is in them, not by their names',
     U.jsonRows(JSON.stringify([{ whenever: '2021-01-01', howMuch: '10.5' },
                                { whenever: '2021-01-02', howMuch: '10.6' }])) !== null);

  var rows = [['Date', 'NAV']];
  for (var k = 0; k < 40; k++) rows.push([iso(d(2021, 0, 1) + k * 86400000), 10 + k * 0.01]);
  ok('rows handed straight in from a workbook work too',
     U.read([{ name: 'book.xlsx', rows: rows }]).ok);
}

section('The rest of section 5’s messages, as written');
{
  var M = U.MESSAGES;
  ok('too young names both lengths and the way out',
     /4\.2 years long and you asked for 5-year windows/.test(M.tooYoung(4.2, 5)) &&
     /Choose a shorter window\.$/.test(M.tooYoung(4.2, 5)), M.tooYoung(4.2, 5));
  ok('the age guard explains what is wrong with the windows themselves',
     /every window starts inside the same 1\.0-year band/.test(M.ageGuard(6, 5)) &&
     /one stretch measured over and over/.test(M.ageGuard(6, 5)) &&
     /Three spare years is the least it takes/.test(M.ageGuard(6, 5)), M.ageGuard(6, 5));
  ok('a missing value asks for the date as well as the amount',
     /Add what it is all worth today, and the date you read it\./.test(M.valueMissing));
  ok('under a year sends the reader to the total',
     /A yearly rate on 7 months is a stretch\./.test(M.underAYear(7)) &&
     /the yearly rate starts meaning something after a year/.test(M.underAYear(7)));
  ok('no overlap names the shared span', /share only 1\.8 years/.test(M.noOverlap(1.8)));
  ok('direct-before-2013 names the substitute and its cost',
     /Regular\s+plan carries the same history, about 0\.5 to 1 point a year lower/.test(M.directBefore2013),
     M.directBefore2013);
}

console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) { console.log('\nFAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
