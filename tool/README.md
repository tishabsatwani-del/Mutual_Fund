# The Portfolio Reality Check

A static, offline-capable analysis tool for readers of the book. Four modules on
one page: portfolio XIRR, a goal planner, market rolling returns, and rolling
returns for any fund the reader can supply NAV history for.

Published at `/Mutual_Fund/tool/`. **This is the single address printed in the
book.** Everything a reader is promised lives behind it, including the XIRR
spreadsheet, which is why there is no separate download page any more —
`/Mutual_Fund/xirr/` is now only a redirect for anything already pointing there.

## Architecture, and why

| File | Role |
|---|---|
| `index.html` | The whole interface. No build step. |
| `styles.css` | One stylesheet. No framework, no font requests. |
| `engine.js` | XIRR, CAGR, rolling returns, goal maths. Pure functions, no DOM. |
| `parse.js` | Turns a messy CSV into a clean dated series, and reports what it dropped. |
| `app.js` | Formatting, routing, charts, file intake. |
| `modules.js` | The four screens. |
| `provider.js` | The seam for automatic fund lookup. No provider wired in; the contract is documented in the file. |
| `data/benchmarks.json` | Bundled index history. Empty in 1.0 — see `data/README.md`. |
| `XIRR-Calculator.xlsx` | The downloadable spreadsheet, offered from the **sheet** view. Built by `tools/xirr/` — see that README. |
| `qr-portfolio-reality-check.svg` | Print artwork for the address in the book. |

`engine.js` and `parse.js` are deliberately free of browser APIs so the same code
that runs on a reader's phone is the code the test suite exercises under Node.

**No dependencies, no CDN, no API, no backend, no analytics, no storage.** The
page makes exactly two network requests — its own CSS and its own scripts — plus
one for `data/benchmarks.json`. A browser test asserts that nothing else is ever
requested, because the privacy claim on the About screen is only worth making if
something checks it.

Excel files are read by unzipping them with the browser's own
`DecompressionStream`, so even `.xlsx` support pulls in no library. Where a
browser lacks it, the reader is told to save as CSV rather than shown a failure.

## Zero maintenance

Nothing here expires on a schedule. There is no fund list to keep current — the
reader brings the fund's history, so a scheme launched years after this was
written still works. The only dated thing in the product is
`data/benchmarks.json`, and the About screen states its date rather than implying
freshness.

## Conventions worth not breaking

- XIRR uses a 365-day year, matching a spreadsheet, so the tool and Excel agree.
- Rolling windows match on calendar dates with seven days of tolerance; anything
  wider is dropped, never stretched.
- Monthly rates are the twelfth root of the annual rate, never annual ÷ 12.
- Every result carries four things: the number, what it means, what it does not
  mean, and what to look at next. That structure is the product.
- No verdicts. The tool never calls a return good or bad, and never names a fund
  to buy, sell or switch.

## Automatic fund lookup

`provider.js` defines a two-method contract — `search(query)` and `history(id)` —
and ships with nothing behind it. The search journey appears only when a provider
is registered, because a dead search box reads as broken rather than simple.

Fetched rows go through **the same validation as an uploaded file**, so an
automatically retrieved fund is held to exactly the same standard as one a reader
typed in. `tools/tool-tests/provider.test.js` drives the whole journey against a
stub — search, disambiguation, selection, analysis, no matches, a failed lookup
and unusable data — so wiring a real provider later is configuration, not
discovery.

Before wiring one: confirm its terms permit the use, that it sends CORS headers
to a static page, that it covers the funds readers hold, and that it fails loudly
rather than returning something plausible when it has nothing.

## Testing

See `tools/tool-tests/README.md`. Run every suite before publishing.

## Version

Version 1.0. The number appears on the About screen and is set in `app.js`
(`VERSION`) and in `index.html`. Change both together.
