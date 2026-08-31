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

section('A ledger pasted out of a spreadsheet');
{
  /* A NAV column and a ledger column are not the same kind of number, which is
     why this is its own reader: rowsToSeries drops anything at or below zero
     and takes the LAST numeric column, and in a ledger the negatives are the
     whole point. */
  var block = 'Date\tAmount\n01-04-2021\t5000\n01-05-2021\t5000\n14-08-2023\t-50000\n';
  var r = U.ledgerRows(block);
  ok('an Excel block is read', r.ok && r.rows.length === 3, JSON.stringify(r.code));
  ok('the header is recognised by content, not counted as an unreadable line',
     r.skipped === 0 && r.header !== null, 'skipped ' + r.skipped);
  eq('a minus is money out', r.rows[2].dir, 'out');
  eq('and its amount is carried positive', r.rows[2].amount, 50000);
  eq('money in stays money in', r.rows[0].dir, 'in');

  /* How a statement actually writes it. */
  var bank = 'Date,Narration,Withdrawal,Balance\n05-04-2021,SIP ACME,(5000),120000\n' +
             '05-05-2021,SIP ACME,(5000),115000\n';
  var b = U.ledgerRows(bank);
  ok('a bracketed figure is money out', b.ok && b.rows.every(function (x) { return x.dir === 'out'; }),
     JSON.stringify(b.rows.map(function (x) { return x.dir; })));
  ok('and the balance column is not mistaken for the amount', b.amountCol === 2,
     'amountCol ' + b.amountCol);

  ok('columns are found by content, whatever their order',
     U.ledgerRows('Amount,Date\n5000,01-04-2021\n6000,01-05-2021\n').ok);

  var three = U.ledgerRows('01-04-2021,5000,Acme Fund\n01-05-2021,5000,Acme Fund\n');
  eq('three columns with no header keep the fund', three.rows[0].fund, 'Acme Fund');

  ok('a fund is never inferred from a narration column',
     U.ledgerRows(bank).fundCol === -1, String(U.ledgerRows(bank).fundCol));

  /* Refusals, each saying what to do rather than only what went wrong. */
  var noDates = U.ledgerRows('Fund,Rating\nAcme,Five stars\n');
  ok('no dates is refused with an instruction',
     !noDates.ok && /Copy two columns: the date, and the amount\./.test(noDates.message), noDates.message);
  var noAmt = U.ledgerRows('Date\n01-04-2021\n02-04-2021\n');
  ok('dates with no amounts beside them is its own refusal',
     !noAmt.ok && /no column of amounts beside them/.test(noAmt.message), noAmt.message);
  ok('and it says how money out is written',
     /minus or brackets/.test(noAmt.message), noAmt.message);

  /* Dates that read two ways get the same treatment as the NAV door's. */
  var amb = U.ledgerRows('Date\tAmount\n01/02/2020\t100\n02/03/2020\t200\n');
  ok('an ambiguous date is flagged rather than silently chosen',
     amb.ok && amb.dateCertain === false && amb.example !== null, JSON.stringify(amb.example));
  ok('and the reader can settle it',
     U.ledgerRows('Date\tAmount\n01/02/2020\t100\n', { dayFirst: false }).rows[0].t ===
     Date.UTC(2020, 0, 2));

  /* Dr/Cr is deliberately unread: taking direction from a bank's abbreviation
     is a guess about the reader's money, and a wrong guess is silent. */
  var drcr = U.ledgerRows('Date,Amount\n01-04-2021,5000 Dr\n02-04-2021,6000\n');
  ok('a Dr/Cr suffix is skipped and counted, not guessed at',
     drcr.skipped >= 1, 'skipped ' + drcr.skipped);
}

section('Pasted columns go through the same door as a file');
{
  var lines = ['Date,NAV'];
  for (var i = 0; i < 40; i++) {
    lines.push(iso(d(2021, 0, 1) + i * 86400000) + ',' + (10 + i * 0.01).toFixed(4));
  }
  var r = U.read([{ name: '', pasted: true, text: lines.join('\n') }]);
  ok('a pasted NAV column is read like a file', r.ok && r.series.length === 40,
     r.ok ? String(r.series.length) : r.message);
  ok('and confirms itself honestly, having no filename to use',
     /^Found 40 NAVs for pasted columns, /.test(r.confirmation), r.confirmation);

  /* The instruction has to change: there is no file to download again. */
  var bad = U.read([{ name: '', pasted: true, text: 'Fund,Rating\nAcme,Five\nZenith,Four\n' }]);
  ok('a pasted refusal says copy the columns, not download the table',
     /Copy two columns out of the sheet/.test(bad.message) &&
     !/download the table/.test(bad.message), bad.message);
  var fromFile = U.read([{ name: 'notes.csv', text: 'Fund,Rating\nAcme,Five\nZenith,Four\n' }]);
  ok('while a file still says download the table',
     /download the table/.test(fromFile.message), fromFile.message);
}


/* -------------------------------------------------------------------------
 * Which way the money went.
 *
 * The rule this section holds: direction is never inferred from a word the
 * tool has decided it understands. A sign the reader wrote wins outright; an
 * unsigned file with a type column becomes a question; an answered question is
 * applied to every line and to nothing else.
 */
section('An unsigned ledger with a type column asks which way');
{
  var typed = 'Date,Type,Amount\n' +
              '2021-04-05,Purchase,5000\n' +
              '2021-05-05,Purchase,5000\n' +
              '2023-08-14,Redemption,50000\n';

  var q = U.ledgerRows(typed);
  ok('it does not guess', q.ok === false && q.ask === 'direction', q.code);
  eq('and it names the column it found', q.typeCol, 1);
  ok('with each word and how many lines it covers',
     JSON.stringify(q.words) === JSON.stringify([{ word: 'Purchase', count: 2 },
                                                 { word: 'Redemption', count: 1 }]),
     JSON.stringify(q.words));
  ok('asking for the words that mean money out',
     /Tick the words that mean money going OUT/.test(q.message), q.message);

  var a = U.ledgerRows(typed, { direction: { Purchase: 'in', Redemption: 'out' } });
  ok('answered, it reads every line that way',
     a.ok && a.rows.length === 3 && a.rows[2].dir === 'out' && a.rows[0].dir === 'in',
     JSON.stringify(a.rows.map(function (r) { return r.dir; })));
  eq('and skips nothing it was told about', a.skipped, 0);

  /* Ticking nothing is a real answer, not a dead end: it reads the file the
     way it read before this question existed. */
  var none = U.ledgerRows(typed, { direction: { Purchase: 'in', Redemption: 'in' } });
  ok('ticking nothing reads every line as money in',
     none.ok && none.rows.every(function (r) { return r.dir === 'in'; }),
     JSON.stringify(none.rows.map(function (r) { return r.dir; })));

  /* A word the reader never saw must not be filed as money in behind their
     back. It is dropped, and the count of dropped lines is on the screen. */
  var partial = U.ledgerRows(typed + '2024-01-09,Switch Out,7000\n',
                             { direction: { Purchase: 'in', Redemption: 'out' } });
  eq('a word with no answer is skipped, not assumed', partial.skipped, 1);
  eq('and the lines that were answered still read', partial.rows.length, 3);
}

section('A sign the reader wrote wins outright');
{
  var signed = 'Date,Type,Amount\n' +
               '2021-04-05,Purchase,5000\n' +
               '2023-08-14,Redemption,-50000\n';
  var r = U.ledgerRows(signed);
  ok('one minus anywhere and there is no question', r.ok && r.ask !== 'direction', r.code);
  eq('the sign decides', r.rows[1].dir, 'out');
  eq('and the type column is left alone', r.typeCol, -1);

  var brackets = U.ledgerRows('2021-04-05,Purchase,5000\n2023-08-14,Redemption,(50000)\n');
  ok('brackets count as a sign the same way',
     brackets.ok && brackets.rows[1].dir === 'out' && brackets.ask !== 'direction',
     brackets.code);
}

section('The question is asked only where it means something');
{
  var plain = U.ledgerRows('2021-04-05,5000\n2022-01-09,20000\n');
  ok('two plain columns are not a question', plain.ok && plain.ask !== 'direction', plain.code);

  /* A fund column is already spoken for. Without that exclusion the reader is
     asked which of their own fund names means money out. */
  var funded = U.ledgerRows('2021-04-05,5000,Acme Bluechip\n' +
                            '2022-01-09,7000,Acme Bluechip\n' +
                            '2022-02-09,7000,Zenith Flexi\n');
  ok('a fund column is not mistaken for a type column',
     funded.ok && funded.ask !== 'direction', funded.code);
  eq('it is read as the fund it is', funded.rows[2].fund, 'Zenith Flexi');

  /* One repeated word says nothing on its own -- unless the column is NAMED,
     in which case a file of nothing but redemptions would otherwise read
     entirely backwards without a word said. */
  var constant = U.ledgerRows('2021-04-05,5000,NSE\n2022-01-09,7000,NSE\n2022-02-09,9000,NSE\n');
  ok('an unnamed column of one repeated word asks nothing',
     constant.ok && constant.ask !== 'direction', constant.code);
  var named = U.ledgerRows('Date,Transaction Type,Amount\n' +
                           '2021-04-05,Redemption,5000\n2022-01-09,Redemption,20000\n');
  ok('a named one holding only redemptions still asks',
     named.ask === 'direction' && named.words.length === 1,
     named.code + ' ' + JSON.stringify(named.words));

  /* A narration column is prose, not a small set of types. */
  var narration = U.ledgerRows(
    'Date,Particulars,Amount\n' +
    '2021-04-05,NEFT transfer to broker account ending 4412,5000\n' +
    '2022-01-09,NEFT transfer to broker account ending 7781,7000\n');
  ok('a narration column is not read as a type column',
     narration.ok && narration.ask !== 'direction', narration.code);
}

section('The ledger reader takes rows as well as text');
{
  /* A dropped workbook comes back from the reader as rows already. Turning
     those back into text to parse them again is a round trip that can only
     lose. */
  var rows = U.ledgerRows([['Date', 'Amount'], ['2021-04-05', 5000], ['2023-08-14', -50000]]);
  ok('rows out of a workbook read like a paste',
     rows.ok && rows.rows.length === 2 && rows.rows[1].dir === 'out',
     rows.code || JSON.stringify(rows.rows));
  ok('and an empty array is still nothing to read',
     U.ledgerRows([]).ok === false, 'read something');
}


/* -------------------------------------------------------------------------
 * The other file a reader can download.
 *
 * A holdings snapshot is what most people will find first, because it is the
 * button on the screen they are already looking at. It holds no dates, so no
 * yearly rate can come out of it -- but invested against current value is a
 * real answer, and refusing the file outright would be refusing that answer.
 */
section('A holdings snapshot is read for what it does hold');
{
  var snap = 'Scheme Name,Units,Invested Amount,Current Value\n' +
             'Acme Bluechip Direct Growth,1234.567,50000,62300\n' +
             'Zenith Flexi Cap Direct Growth,890.123,75000,71200\n';
  var r = U.portfolioFile(snap);
  eq('it is recognised as holdings, not payments', r.kind, 'holdings');
  ok('both funds are read', r.ok && r.rows.length === 2, String(r.rows.length));
  ok('with what went in and what it is worth',
     r.rows[0].invested === 50000 && r.rows[0].current === 62300, JSON.stringify(r.rows[0]));
  eq('and the units beside them', r.rows[0].units, 1234.567);

  /* Two money columns side by side, and nothing in their SHAPE tells them
     apart: 50,000 and 62,300 are both just numbers. Only the words above them
     say which is cost and which is worth, and the pair backwards turns a gain
     into a loss with nothing shown anywhere. */
  var costFirst = U.portfolioFile('Fund,Cost Value,Market Value\nAcme,50000,62300\n');
  var valueFirst = U.portfolioFile('Fund,Market Value,Cost Value\nAcme,62300,50000\n');
  ok('"Cost Value" is read as cost even though it says value',
     costFirst.rows[0].invested === 50000 && costFirst.rows[0].current === 62300,
     JSON.stringify(costFirst.rows[0]));
  ok('and the columns can arrive in either order',
     valueFirst.rows[0].invested === 50000 && valueFirst.rows[0].current === 62300,
     JSON.stringify(valueFirst.rows[0]));

  /* A snapshot almost always ends in a totals row. Counted as a holding it
     doubles every figure, and the doubling looks entirely plausible. */
  var withTotals = U.portfolioFile(snap + 'Grand Total,,125000,133500\nOverall,,1,2\n');
  eq('a totals row is not counted as a holding', withTotals.rows.length, 2);
  eq('and is reported as dropped, not silently ignored', withTotals.totalsDropped, 2);

  var noHeader = U.portfolioFile('Acme,50000,62300\nZenith,75000,71200\n');
  ok('a snapshot with no column names is refused rather than guessed at',
     noHeader.kind !== 'holdings' || !noHeader.ok, String(noHeader.kind));
}

section('The reader chooses no file type, and is asked about none');
{
  var ledger = U.portfolioFile('Date,Amount\n05-04-2021,5000\n14-08-2023,-50000\n');
  eq('a transaction statement is read as payments', ledger.kind, 'ledger');
  ok('and keeps every rule the ledger reader already had',
     ledger.ok && ledger.rows[1].dir === 'out', JSON.stringify(ledger.rows));

  /* Holdings are tested FIRST. A snapshot can carry an "as on" date column
     that the ledger reader would latch onto, turning one row per fund into one
     payment per fund, all dated the same day. */
  var dated = U.portfolioFile('As on,Scheme,Invested,Current Value\n' +
                              '01-08-2026,Acme,50000,62300\n01-08-2026,Zenith,75000,71200\n');
  eq('a snapshot carrying a date column is still a snapshot', dated.kind, 'holdings');
  eq('and its two funds are not read as two payments', dated.rows.length, 2);

  /* A snapshot is ONE point in time, so an "as on" column holds the same date
     on every row. Rows carrying DIFFERENT dates are events, not a position --
     and reading a statement with a fund column beside the amount as holdings
     throws the dates away, and with them the yearly rate, silently. */
  var named = U.portfolioFile('Date,Amount,Fund\n' +
                              '2024-01-01,100000,Acme Bluechip\n' +
                              '2025-01-01,100000,Zenith Flexi\n');
  eq('a statement with a fund column stays a statement', named.kind, 'ledger');
  ok('and keeps the fund each payment belongs to',
     named.rows[0].fund === 'Acme Bluechip' && named.rows[1].fund === 'Zenith Flexi',
     JSON.stringify(named.rows.map(function (r) { return r.fund; })));

  /* "Amount" alone is what a statement calls a payment; a snapshot names its
     valuation column. A snapshot may still use it beside an explicit cost. */
  var bareAmount = U.portfolioFile('Scheme,Invested,Amount\nAcme,50000,62300\nZenith,75000,71200\n');
  eq('a dateless file with two money columns is still holdings', bareAmount.kind, 'holdings');

  var neither = U.portfolioFile('Fund,Rating\nAcme,Five stars\nZenith,Four stars\n');
  ok('a file that is neither shape names both downloads',
     /holdings or portfolio statement/.test(neither.message) &&
     /transaction statement/.test(neither.message), neither.message);
}

section('The right file on the wrong screen is said to be exactly that');
{
  /* A NAV history is a date column beside a money column, which is what a
     transaction statement is. The ledger reader takes it without complaint:
     4,000 daily prices become 4,000 payments of about ten rupees, and a return
     comes out. It is confident and it is nonsense. */
  var lines = ['Date,NAV'], t = d(2021, 0, 1), v = 10;
  for (var i = 0; i < 400; i++) {
    var day = new Date(t);
    if (day.getUTCDay() % 6) lines.push(iso(t) + ',' + v.toFixed(4));
    v *= 1.0003; t += 86400000;
  }
  var headed = U.portfolioFile(lines.join('\n'));
  eq('a NAV file is refused rather than read as payments', headed.kind, 'prices');
  ok('and is told which screen it belongs to',
     /Rolling returns/.test(headed.message), headed.message);

  /* AMFI's own download has no useful header, so the shape has to settle it:
     one row per trading day is not what anybody's payments look like. */
  var bare = U.portfolioFile(lines.slice(1).join('\n'));
  eq('a NAV file with no header at all is caught by its shape', bare.kind, 'prices');

  /* And the guard must not catch a real one. Four years of monthly
     instalments is 48 rows a month apart, which no price file resembles. */
  var sip = ['Date,Amount'];
  for (var m = 0; m < 48; m++) sip.push(iso(d(2021, m, 5)) + ',5000');
  var real = U.portfolioFile(sip.join('\n'));
  ok('while 48 monthly instalments are still payments',
     real.kind === 'ledger' && real.ok && real.rows.length === 48,
     real.kind + ' ' + real.rows.length);
}

console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) { console.log('\nFAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
