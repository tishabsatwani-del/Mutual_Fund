/* Where You Stand — Understand every number.
 *
 * One entry per figure on the site: what it is, how it is worked out, what it
 * is not. Every figure's name elsewhere links to its entry here. Written so a
 * reader can check any number on the site by hand.
 */
(function (root) {
  'use strict';
  var A = root.PRCApp;
  var esc = A.esc;

  var ENTRIES = [
    { key: 'xirr', title: 'XIRR, your money-weighted return',
      what: 'The one yearly rate at which every rupee you paid in, discounted from its own date, exactly pays for every rupee you took out and what you still hold. It counts the date every rupee moved, so it is the return your own money actually earned.',
      how: 'Money in is negative, money out and today’s worth are positive. Each amount is divided by (1 + rate) raised to the power of its days from the first entry ÷ 365. The rate that makes the sum zero is the XIRR. The search here finds every rate between −99.99% and one million percent that balances the entries, and reports the one a spreadsheet’s XIRR returns from its 10% starting guess; if a second rate also fits, the screen says so.',
      not: 'Not the fund’s published return, which measures one lump sum on day one. Not comparable to another investor’s, who ran on other dates. Not meaningful under a year: a short stretch stretched to a yearly pace reads absurdly high or low, so the total gain is the figure to read.' },
    { key: 'absolute', title: 'Total return, the gain with no clock in it',
      what: 'Worth today, plus what you took out, minus what you put in, as a share of what you put in.',
      how: '(worth now + money out − money in) ÷ money in.',
      not: 'It says nothing about how long the money took to earn it. A gain of 50% over ten years and 50% over one year are very different results with the same total.' },
    { key: 'cagr', title: 'CAGR, the fund’s own steady speed',
      what: 'The steady yearly rate that would carry a value from its start to its end: what one rupee on day one grew at, if never touched. The number a fund publishes for a period.',
      how: '(end value ÷ start value) raised to the power of 365 ÷ days, minus 1. A 365-day year, the convention of spreadsheets and factsheets, everywhere on this site.',
      not: 'Not your return if you invested in instalments, and not measured between your dates unless the tool is given the fund’s file and your statement, which is what the You and the fund tab does.' },
    { key: 'timing', title: 'Your timing: the fund over your dates against your own rate',
      what: 'With the fund’s NAV file loaded, the fund’s CAGR between your first payment and the valuation date sits beside your XIRR. The difference is the effect of when your money went in and out. Studies of investors’ money-weighted returns against their funds’ returns find this gap runs to several percentage points a year for many investors, from buying after rises and selling after falls.',
      how: 'Fund: (NAV on the valuation date ÷ NAV on your first payment date)^(365 ÷ days) − 1. Yours: the XIRR of your entries. Gap: fund minus yours.',
      not: 'Not a verdict on you or the fund. Money added late into a rise, or withdrawn after a fall, produces a gap by arithmetic, whatever the reason for the payment.' },
    { key: 'sameRupees', title: 'The same rupees, on the same dates, in the index',
      what: 'Your own payments and withdrawals, put into the benchmark index on the same dates, valued on your valuation date, with the same XIRR arithmetic. Yours and the index’s rate share your timing, so the difference is what the fund did with your money, not when you gave it.',
      how: 'Each payment buys index units at the index’s value on that date (the last value on or before it). Each withdrawal sells units. The units left are valued on the valuation date, and the XIRR runs on those flows.',
      not: 'The index carries no costs, holds no cash and cannot be bought as it stands; a fund that follows it pays its own costs out of the gap. A price index leaves dividends out, which flatters your side by roughly the index’s dividend yield each year; use the total return version.' },
    { key: 'ownFall', title: 'Your own money’s worst fall',
      what: 'The most your holding lost, in rupees, from price moves alone, from a high to the low that followed, and how long it took to stand where it had stood.',
      how: 'With the fund’s NAV file, the holding is valued every day the file has a value: units held that day times the NAV. Your own payments and withdrawals are removed by measuring the fall in value minus net money put in, so a withdrawal does not read as a loss and a purchase does not read as a gain.',
      not: 'Only meaningful for one fund with a complete statement. It is a fact about your dates, not a property of the fund; the fund’s own deepest fall is on the Rolling returns screen.' },
    { key: 'real', title: 'Return after inflation',
      what: 'What your money buys, after prices have moved: the nominal return with inflation divided out.',
      how: '(1 + return) ÷ (1 + inflation) − 1. Not return minus inflation: the price of things compounds against every rupee over the same years your money is compounding, so the exact figure is a little lower than the subtraction, and the gap widens as both figures grow.',
      not: 'The official basket is not your basket. If your life is heavy with fees or bills that outrun the headline figure, your real subtraction is bigger than the country’s. This tool never chooses an inflation figure for you.' },
    { key: 'doubling', title: 'Doubling time',
      what: 'How long money takes to double at a yearly rate.',
      how: 'ln 2 ÷ ln(1 + rate). At 7.2% a year, about 10 years; at 10%, about 7.3; at 12%, about 6.1.',
      not: 'An intuition aid, not a forecast: it assumes the rate holds every year, which no market does.' },
    { key: 'rolling', title: 'Rolling returns',
      what: 'The return of every holding period of a chosen length that the file contains, one window starting on every date. Instead of one figure from one start date, a range: worst, best, median and everything between.',
      how: 'A window starts at each observation and ends on the same calendar date N years later, or on the last value up to seven days before it; beyond that the window is dropped, never stretched. Each window is annualised as (end ÷ start)^(365 ÷ days) − 1. Weekly and monthly steps thin the start dates only.',
      not: 'Not a forecast: it describes the dates in the file and no others. Not independent evidence: consecutive windows share almost all their days, so thousands of windows are only a handful of genuinely different stretches, and the screen prints that number beside every large count.' },
    { key: 'windows', title: 'Windows, and why they overlap',
      what: 'A window is one holding period, from a start date to the same calendar date N years later. Every date in the file starts one, so neighbouring windows differ by a day and share almost everything.',
      how: 'The number that means something is how many windows could stand side by side without touching: the span of the file divided by the window length, rounded down. A 15-year file holds five 3-year stretches, not three thousand.',
      not: 'Overlap is a property of rolling analysis itself, not a fault in a file. It matters only when a window count is read as a count of independent observations.' },
    { key: 'median', title: 'Median, not mean',
      what: 'The middle window: half the windows did better, half did worse.',
      how: 'Sort every window’s return; take the middle value (or the average of the two middle values).',
      not: 'Not the mean. A handful of exceptional stretches cannot pull the median upward, while a mean can be lifted into a figure no ordinary holding period ever produced. The mean is on the All the numbers tab, labelled as such.' },
    { key: 'percentiles', title: 'Worst, best, and the outer tenths',
      what: 'Worst and best are the single lowest and highest windows. The 10th and 90th percentiles are the values that 10% of windows fall below and 10% rise above: 8 of every 10 windows ended between them.',
      how: 'Order statistics with linear interpolation between neighbours, the same rule a spreadsheet’s PERCENTILE uses.',
      not: 'The worst in a file is the worst of the years it covers. A fall before the file’s first date is not in it, so the worst is the worst so far, not the worst there is.' },
    { key: 'startDates', title: 'Two start dates, one fund',
      what: 'The best window and the worst window of the same length, side by side, to show how much of any headline figure was decided by the day it started.',
      how: 'The windows with the highest and lowest annualised return, with their dates.',
      not: 'Nobody chooses their start date on purpose. This is a description of the range, not advice on timing.' },
    { key: 'drawdown', title: 'The deepest fall, and the climb back',
      what: 'The largest fall in the value from any high to the low that followed, how long it took to fall, and how long until the value stood at the old high again.',
      how: 'Walk the series keeping the highest value seen so far; the deepest fall below it is the drawdown. Recovery is the first later date at or above that high.',
      not: 'A different measurement from the worst window: a value can fall steeply inside a window that still ends positive. It is what had to be sat through, not what was earned.' },
    { key: 'underwater', title: 'Longest stretch below a high',
      what: 'The longest time the value spent below a previous high, which can be longer than the deepest fall’s own recovery: a shallower fall can take longer to climb back.',
      how: 'For each new high, count the days until the next value at or above it; the longest such count. If the file ends below a high, that stretch is still running.',
      not: 'A property of the dates in the file.' },
    { key: 'volatility', title: 'The typical size of a year’s swing',
      what: 'How much the value moved day to day, scaled to a year. Larger means bigger swings both ways.',
      how: 'The standard deviation of the day-to-day log returns, multiplied by the square root of the number of observations per year in the file (about 250 for a daily file).',
      not: 'It measures movement, not loss: a fund that rises fast is volatile too. It compares only across series measured over the same dates.' },
    { key: 'capture', title: 'Up and down capture',
      what: 'In the months the index rose, how much of the rise the fund took; in the months it fell, how much of the fall.',
      how: 'Monthly returns from month-end values. Over the up months, the geometric average of the fund’s monthly returns divided by the index’s; the same over the down months. Over 100% in up months: more than the index’s rises. Under 100% in down months: less of its falls. A negative down-capture means the fund rose while the index fell.',
      not: 'Shown only with at least 12 shared months and read with care under 36. A fund that takes less of the falls and less of the rises is steadier, not better or worse; the two figures describe its shape.' },
    { key: 'ir', title: 'Information ratio',
      what: 'The fund’s excess return over its index, divided by how unsteady that excess was. The regulator has equity schemes publish it daily, so it appears on fund houses’ and the industry body’s sites.',
      how: 'On the dates both files have: each day’s fund return minus the index’s. The mean of those excess returns, annualised, divided by their standard deviation, annualised.',
      not: 'A ratio, not a rate. It says how consistently a difference was earned, not how large it was in rupees, and it only compares across the same index and period. A negative ratio means the fund trailed the index on average.' },
    { key: 'tracking', title: 'Tracking difference and tracking error',
      what: 'For a fund that follows an index: how much it fell short of (or exceeded) the index each year, and how steadily it followed it.',
      how: 'Difference: the fund’s CAGR minus the index’s over the same dates. Error: the annualised standard deviation of the day-to-day difference in returns. Shown only when the two move almost together (daily correlation of 0.98 or more), since for any other pair the figures describe nothing. The regulator caps the one-year tracking error of equity index funds and exchange-traded funds at 2%.',
      not: 'A negative difference is the normal cost of tracking: the fund’s expenses and cash come out of the index’s return.' },
    { key: 'ahead', title: 'Windows ahead of the index',
      what: 'The share of paired holding periods in which the fund’s return beat the index’s.',
      how: 'Both files are put on one calendar (a date one file lacks is filled from that file’s previous value), the same windows are measured on each, and the pairs are counted.',
      not: 'Leading in most windows is a different statement from leading over one stretch, and neither makes a fund suitable for anyone.' },
    { key: 'calendar', title: 'Year by year',
      what: 'Each calendar year’s return: the table every factsheet prints.',
      how: 'From the last value of the previous year to the last value of the year. The first year in a file starts at the file’s first date; a year the file does not finish is marked partial.',
      not: 'A calendar year is one particular twelve-month window. Rolling figures measure every twelve-month window, so one bad year can sit inside a median that looks fine.' },
    { key: 'trailing', title: 'Trailing returns, the factsheet’s numbers',
      what: 'Point-to-point returns for 1, 3, 5 and 10 years ending on the file’s last date, and since the file began: the figures a factsheet or a comparison site shows.',
      how: 'The CAGR from the value on (or just before) the date N years before the last date to the last value, on a 365-day year.',
      not: 'They depend entirely on one end date. Set beside the rolling range for the same length, a trailing figure near the top or bottom of the range is telling you about the date, not the fund.' },
    { key: 'growth', title: 'What ₹10,000 became',
      what: 'One sum on the first date, never touched, valued every day the file has a value; with an index, both rebased on the first shared date. With a statement loaded, your own dates are marked on it.',
      how: 'Each value divided by the first value, times ₹10,000. The axis is logarithmic, so an equal percentage rise is the same slope anywhere, and the early years are not squashed flat.',
      not: 'Not a forecast, and not your money unless your marks are on it.' },
    { key: 'rollingSip', title: 'A fixed sum every month, over every stretch',
      what: 'What a monthly investor got: the same amount every month for N years, starting from every month in the file, each stretch valued at its end.',
      how: 'Each instalment buys units at the first value on or after its date. At the end of the stretch the units are valued, and the XIRR of the instalments and that value is the stretch’s rate.',
      not: 'A monthly investor’s money spends less time invested than a lump sum, so the rates differ from the lump-sum windows; neither is better, they answer different questions.' },
    { key: 'beatRate', title: 'How often it beat a rate you choose',
      what: 'The share of past holding periods in which the return beat a rate you type: the return you need, a deposit rate, your own guess at inflation plus a margin.',
      how: 'Count the windows with a return above the rate; divide by the number of windows.',
      not: 'Arithmetic on the data above and nothing more. Not a comparison with any product, before tax and costs on both sides, and not the odds of anything.' },
    { key: 'tri', title: 'Total return index, price index',
      what: 'A total return index (TRI) counts the dividends its companies pay, reinvested, the way a fund’s NAV does. A price index counts only price moves and reads lower every year by roughly the dividend yield.',
      how: 'The regulator requires funds to be measured against total return indices. Index providers publish both; the download page names which report you took.',
      not: 'Comparing a fund’s NAV with a price index flatters the fund by roughly the dividend yield each year, which is larger than most gaps people argue about.' },
    { key: 'idcw', title: 'Growth and IDCW rows of the same fund',
      what: 'A fund’s NAV history appears as several rows: one per plan and per option. The Growth option keeps everything inside the NAV. An IDCW option pays part of it out, so its NAV drops at every payout and its history understates what the fund earned.',
      how: 'Pick the exact scheme name on your statement. For measuring a fund’s record, the Growth option carries the full growth.',
      not: 'This tool never says which plan or option to hold; it says which row shows the fund’s whole growth.' },
    { key: 'goal', title: 'The goal projection',
      what: 'Where you land if nothing changes: what you already have, grown at the assumed return, plus every monthly instalment, grown from its own month.',
      how: 'The yearly return is converted to a monthly rate so that twelve months compound to exactly the yearly figure ((1 + r)^(1⁄12) − 1), not divided by twelve, which overstates the outcome. Instalments are paid at the start of each month; a step-up is applied once every twelve months.',
      not: 'Every figure uses a return you typed. It is an assumption, not a forecast; real markets do not deliver the same return every year, and a run of poor years early on hurts more than the same years late.' },
    { key: 'requiredRate', title: 'The return the goal needs',
      what: 'The yearly return at which what you have and what you add land exactly on the goal.',
      how: 'The projection is run at many rates and narrowed down until it equals the target, to a hundred-millionth of a percent.',
      not: 'Not a rate to assume. With a history loaded, the screen says how often past stretches of your length delivered it; those are past stretches, not odds.' },
    { key: 'todaysRupees', title: 'The goal in today’s rupees',
      what: 'What a future sum buys in today’s money at an inflation rate you type, and the future target that keeps today’s buying power.',
      how: 'Buys today: target ÷ (1 + inflation)^years. Target for today’s buying power: target × (1 + inflation)^years.',
      not: 'This tool never chooses an inflation figure for you.' },
    { key: 'goalHistory', title: 'The goal under a real history',
      what: 'Your plan under the worst, the median and the best rolling stretch of your plan’s length inside a file you load.',
      how: 'Rolling returns of the file at your plan’s length; the plan is projected at each of the three rates (capped at 50%).',
      not: 'Three stretches that already happened, not the range the future will hold.' },
    { key: 'files', title: 'How files are read',
      what: 'A file is read by what is in its columns, not by what they are called: a column of dates and a column of positive numbers. Headings decide which of several eligible columns is the value; a date column is chosen over a units, volume or change column.',
      how: 'Numeric dates are read day-first, as India writes them; a file whose dates only make sense month-first is read month-first, and a file that reads both ways says so. Rows with no value, a zero or a negative are counted and shown, never used. The same date twice keeps the last. Several files of one history are joined by date, and gaps wider than 45 days are reported. Two files are compared only over the dates both cover; a date one lacks is filled from that file’s previous value, never a later one.',
      not: 'A PDF, a screenshot and a trade log are refused in words rather than read wrongly. A statement with unsigned amounts asks once which words mean money out, and never decides it silently.' },
    { key: 'leavesOut', title: 'What every figure leaves out',
      what: 'Tax, exit loads and any charge your platform levies. A fund’s NAV already includes its own expense ratio, so no figure here needs adjusting for it.',
      how: 'Nothing on this site models tax: the rules change, and a figure that pretends to know them would be wrong the day they did.',
      not: 'A riskometer, a category, an expense ratio, the size of a fund and its manager are live facts about a scheme that a file of prices does not carry; this tool does not fetch anything, so it does not show them.' },
    { key: 'sources', title: 'Where the conventions come from',
      what: 'The 365-day year is the convention of a spreadsheet’s XIRR and of the CAGR printed on factsheets. Funds report CAGR for one, three and five years and since inception, and absolute returns under a year, which is why this site reads the total under a year. Benchmarks must be total return indices. Equity schemes must publish an information ratio; index funds must publish tracking error and difference. The regulator’s master circular for mutual funds sets these out; the industry body’s site publishes every fund’s NAV history; index providers publish index histories.',
      how: '', not: '' }
  ];

  function render() {
    var nav = '<div class="card"><h2>On this page</h2><div class="termlist">' + ENTRIES.map(function (e) { return '<a href="#understand/' + e.key + '">' + esc(e.title) + '</a>'; }).join('') + '</div></div>';
    var body = ENTRIES.map(function (e) {
      return '<div class="card uentry" id="u-' + e.key + '"><h2>' + esc(e.title) + '</h2>' +
        '<p><strong>What it is.</strong> ' + esc(e.what) + '</p>' +
        (e.how ? '<p><strong>How it is worked out.</strong> ' + esc(e.how) + '</p>' : '') +
        (e.not ? '<p><strong>What it is not.</strong> ' + esc(e.not) + '</p>' : '') + '</div>';
    }).join('');
    var example = '<div class="card uentry" id="u-example"><h2>One worked example, by hand</h2>' +
      '<p>Three entries: ₹1,00,000 in on 1 January of year one, ₹1,00,000 in on 1 January of year two, and the holding worth ₹2,42,000 on 1 January of year three.</p>' +
      '<p><strong>Total return:</strong> (2,42,000 − 2,00,000) ÷ 2,00,000 = 21%.</p>' +
      '<p><strong>XIRR:</strong> find the rate r at which −1,00,000 − 1,00,000 ÷ (1 + r) + 2,42,000 ÷ (1 + r)² = 0. At 10%: −1,00,000 − 90,909 + 2,00,000 = +9,091, too high. At 14%: −1,00,000 − 87,719 + 1,86,211 = −1,508, too low. At 13.5%: −1,00,000 − 88,106 + 1,87,845 = −261. At 13.4%: −1,00,000 − 88,183 + 1,88,176 = −7. The rate is about 13.4% a year (the exact figure on a 365-day calendar is 13.39%). Both years are counted, and the second rupee has been invested for only one of them, which is why the yearly rate is lower than 21% ÷ 2 would suggest and higher than one steady 10%.</p>' +
      '<p><strong>Real return</strong> at 6% inflation: (1.134 ÷ 1.06) − 1 = 7.0%, not 13.4 − 6 = 7.4.</p>' +
      '<p><strong>Doubling time</strong> at 13.4%: ln 2 ÷ ln 1.134 = 5.5 years.</p></div>';
    A.$('#u-body').innerHTML = nav + body + example;
  }
  root.PRCUnderstand = { init: render, ENTRIES: ENTRIES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
