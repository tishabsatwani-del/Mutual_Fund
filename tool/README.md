# Where You Stand

A static, offline-capable companion tool for readers of the book, published at
`/Mutual_Fund/tool/`. **That is the single address printed in the book**, and it
never moves. Everything a reader is promised lives behind it, including the
spreadsheet; `/Mutual_Fund/xirr/` is only a redirect for links already pointing
there.

Three screens on one page: Check my portfolio, Plan my goal and Rolling returns,
with the spreadsheet download and an About page that sets out how every figure
is calculated. The ideas themselves are taught in the book, not here.

## What it does, and what it never does

It explains and calculates. It never gives investment advice, never tells the
reader to buy or sell, and never rates, ranks or recommends funds. Readers bring
their own files: a statement, a fund's NAV history, an index's history. The page
fetches nothing from the internet, needs no maintenance, and nothing the reader
enters leaves their device. The interface carries no fund names, dates or
market references, so it does not go stale.

## Files

| File | Role |
|---|---|
| `index.html` | The whole interface. No build step. |
| `styles.css` | One stylesheet. No framework, no font requests. |
| `engine.js` | Every calculation: XIRR (all roots), CAGR, rolling returns, drawdown, benchmark-equivalent flows, capture ratios, information ratio, tracking, calendar and trailing returns, goal maths. Pure functions, no DOM. |
| `parse.js` | Turns a messy CSV, text or pasted table into a clean dated series and reports what it dropped. Reads day-first and month-first dates. Picks the value column by its heading (never a code, ISIN or whole-number column) and refuses a column that never moves. Tells price data from payments, and a fund's NAV file from an index file. Reads each scheme's plan and option (Direct, Regular, Growth, IDCW and the rest) and never mixes two: a file holding several asks which one. Picks the daily table out of a whole page pasted or saved as text (menus, headings and NAV Range tables ignored), held to the strict standard. Calls a one-day list of every scheme a snapshot. Reads AMFI's download in its old text layout and its new one (scheme code, scheme NAV name, plan, option, ISINs, net asset value, date). |
| `upload.js` | Reads a statement: a transaction ledger, a holdings file, or the tool's own saved entries. Lines a Status column marks rejected, failed or cancelled are left out and counted; a broker's tradebook of shares is refused as one. A stamp duty, STT or TDS line is folded into the payment it belongs to; a Net Amount column settles what moved in cash; a unit-balance column that shows units held before the first row marks the fund as starting with units bought earlier; the same transaction met in two statements is counted once. |
| `listing.js` | Reads a fund house's or registrar's own statement laid out in scheme blocks (KFintech's Partial Transaction Listing is one): a scheme line, its dated transactions with amount, NAV, units and running balance, its market value, then an Account Summary; as a PDF (through `pdfrows.js`, every word placed under its heading), a workbook or text. Read on one proof alone: for every scheme the opening units plus every transaction's units equal the closing units exactly, and every running balance follows from the line before; a scheme that does not add up is named and shows nothing. A purchase whose line names its gross amount and stamp duty is money out of pocket at the gross. A listing that covers only some of the transactions, and any statement that starts with units bought earlier, gives no yearly rate: the cost value, the value today and the gain so far its own summary states, with the message that sends the reader to the detailed CAS. |
| `cas.js` | Reads the Consolidated Account Statement (CAS) that CAMS and KFintech issue jointly, line by line in its documented layout: folio, scheme, ISIN, registrar, opening units, every transaction with its running balance, the stamp duty, STT and TDS lines, closing units, NAV and market value. A scheme whose units do not add up is named and not read; a Summary CAS is read as holdings; a CAS in another layout, a depository's demat statement, and the statements that are not a complete history (Single Folio, Capital Gain, Pay-In Pay-Out, IDCW, ELSS One View, SFT, Exit Load, Grandfathered) are refused by name. |
| `locked.js` | Opens a locked statement on the device with the password the reader types, which is used once and kept nowhere: an Excel workbook locked by Office (the standard and agile forms), an old `.xls` with a FILEPASS record (RC4, the Excel 97 and CryptoAPI ways), a zip (the traditional cipher or WinZip AES). The hashes, AES and RC4 are written out here and checked against Node's crypto in `../tests/locked.test.js`. A locked PDF is opened by pdf.js with the same password. |
| `pieces.js` | The rules for a history that arrives in several pieces (files, pastes, or both, in any order): one scheme by code or name, one plan and option, never a total return index with a price index, every shared date carrying the same value to its last decimal, a question once when nothing can be checked, a warning where a join jumps, the gaps between pieces. Pure functions, shared by the door and the tests. |
| `workbook.js` | Reads `.xlsx` by unzipping it with the browser's own `DecompressionStream`; no spreadsheet library. |
| `xls.js` | Reads an old `.xls` in each of its forms (an Excel 97-2003 workbook, an HTML table, Excel 2003 XML or a newer `.xlsx` package under that name) in every slot. |
| `pdfrows.js` + `vendor/pdfjs/` | Reads the words of a PDF on the device with pdf.js, back into rows (a fund house's or an exchange's history in every price slot, a statement that is one plain table of text at step 1), into lines (the CAS, for `cas.js`), or into every line placed under the headings above it (a statement in scheme blocks, for `listing.js`); a locked PDF takes the reader's password; a scanned page, a doubtful reading or a statement laid out as several tables is refused. |
| `format.js` | Rupees, percentages and dates, one way everywhere. |
| `dates.js` | Spells every chosen date as dd-Mmm-yyyy under the native date control. |
| `charts.js` | Inline SVG: histogram, growth of ₹10,000, rolling line, fan chart, goal bar. |
| `doors.js` | The file doors: drop zone, paste box (two columns or a whole page), scheme and plan picker (one choice for every piece), the list of pieces with a Remove on each, the how-to guides and the index download's video. |
| `app.js` | Formatting helpers, routing, result tabs, file intake. |
| `portfolio.js`, `goal.js`, `rolling.js` | The three screens. |
| `boot.js` | Start-up and the handlers every result screen shares (tabs, rate boxes, PDF). |
| `pdf.js` + `vendor/` | Save as PDF, rendered on the device. |
| `media/` | A short recording of an index download, made on a phone. |
| `XIRR-Calculator.xlsx` | The spreadsheet: the same calculations as plain formulas, saved with every result already worked out so a phone viewer shows them. `XIRR-Calculator-2.1.xlsx` and `XIRR-Calculator-4.xlsx` are identical copies kept for links already in circulation. |
| `qr-portfolio-reality-check.svg` / `.png` | Print artwork for the address in the book. |

**No dependencies, no CDN, no API, no backend, no analytics, no storage.** The
page requests only its own files from its own address. A browser test asserts
that nothing else is ever requested, because the privacy claim on the About
screen is only worth making if something checks it.

## Conventions

XIRR on a 365-day year, the convention of a spreadsheet's XIRR and of the CAGR
funds publish. One pricing rule for fund and index: a payment is priced at the
value on its date, or the next value on or after it. Where the tool works out
units from a NAV file (typed rows, a statement without units), the purchase
carries stamp duty of 0.005% from 1 July 2020, rounded down to the paisa (₹0.07
on ₹1,500, as a real statement charges it), taken off before dividing; where a
statement prints its units they stand, rounded to three decimals half up as the
registrar prints them; the index takes none. Rolling windows end on the same calendar date years later, or
the last value up to seven days before it; never stretched. Real return is
(1 + return) ÷ (1 + inflation) − 1. Monthly instalments are added at the start
of each month; a step-up applies once a year. Every figure is before tax and
exit load. The spreadsheet uses the same conventions and gives the same answers
for the same entries.

## Zero maintenance

Nothing here expires on a schedule. There is no fund list, no bundled index and
no dated data: the reader brings the history, so a scheme launched years after
this was written still works.
