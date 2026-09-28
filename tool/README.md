# Where You Stand

A static, offline-capable companion tool for readers of the book, published at
`/Mutual_Fund/tool/`. **That is the single address printed in the book**, and it
never moves. Everything a reader is promised lives behind it, including the
spreadsheet; `/Mutual_Fund/xirr/` is only a redirect for links already pointing
there.

Four screens and a glossary on one page: Check my portfolio, Plan my goal,
Rolling returns, Understand every number, and the spreadsheet download.

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
| `parse.js` | Turns a messy CSV, text or pasted table into a clean dated series and reports what it dropped. Reads day-first and month-first dates. |
| `upload.js` | Reads a statement: a transaction ledger, a holdings file, or the tool's own saved entries. |
| `workbook.js` | Reads `.xlsx` by unzipping it with the browser's own `DecompressionStream`; no spreadsheet library. |
| `format.js` | Rupees, percentages and dates, one way everywhere. |
| `dates.js` | Spells every chosen date as dd-Mmm-yyyy under the native date control. |
| `charts.js` | Inline SVG: histogram, growth of ₹10,000, rolling line, fan chart, goal bar. |
| `doors.js` | The file doors: drop zone, paste box, scheme picker, the how-to guides and their videos. |
| `app.js` | Formatting helpers, routing, result tabs, file intake. |
| `portfolio.js`, `goal.js`, `rolling.js`, `understand.js` | The four screens. |
| `boot.js` | Start-up and the handlers every result screen shares (tabs, rate boxes, PDF). |
| `pdf.js` + `vendor/` | Save as PDF, rendered on the device. |
| `media/` | Two short recordings of the downloads, made on a phone. |
| `XIRR-Calculator.xlsx` | The spreadsheet: the same calculations as plain formulas. `XIRR-Calculator-2.1.xlsx` and `XIRR-Calculator-4.xlsx` are identical copies kept for links already in circulation. |
| `qr-portfolio-reality-check.svg` / `.png` | Print artwork for the address in the book. |

**No dependencies, no CDN, no API, no backend, no analytics, no storage.** The
page requests only its own files from its own address. A browser test asserts
that nothing else is ever requested, because the privacy claim on the About
screen is only worth making if something checks it.

## Conventions

XIRR on a 365-day year, the convention of a spreadsheet's XIRR and of the CAGR
funds publish. Rolling windows end on the same calendar date years later, or
the last value up to seven days before it; never stretched. Real return is
(1 + return) ÷ (1 + inflation) − 1. Monthly instalments are added at the start
of each month; a step-up applies once a year. Every figure is before tax and
exit load. The spreadsheet uses the same conventions and gives the same answers
for the same entries.

## Zero maintenance

Nothing here expires on a schedule. There is no fund list, no bundled index and
no dated data: the reader brings the history, so a scheme launched years after
this was written still works.
