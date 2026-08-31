# Checking The Portfolio Reality Check

The first suite needs nothing installed; the rest drive a real browser.

```
node  tools/tool-tests/engine.test.js      # 202 checks, no dependencies

npm install playwright                     # once
python3 -m http.server 8781                # from the repository root
node  tools/tool-tests/browser.test.js       # the whole page, driven for real
node  tools/tool-tests/grouped.test.js       # fund versus portfolio XIRR
node  tools/tool-tests/intelligence.test.js  # spread, start dates, drawdown, consistency
node  tools/tool-tests/bundled.test.js       # the bundled-benchmark path
node  tools/tool-tests/provider.test.js      # the fund-lookup seam, against a stub
node  tools/tool-tests/rolling.test.js       # the rolling screen, click by click
node  tools/tool-tests/spec-rolling-index.test.js  # the redesign specification's own QA list
node  tools/tool-tests/clarity.test.js       # wording, contrast, and what fits on a phone
node  tools/tool-tests/v3.test.js            # the four v3 screens

python3 tools/benchmarks/test_prepare.py     # the benchmark checker's refusals
```

Environment variables, all optional: `PRC_URL` (default
`http://127.0.0.1:8781/tool/`), `PRC_CHROME` (path to a Chromium binary),
`PRC_TMP` (where screenshots and generated fixtures go, default `/tmp/prc`).

## What each one is for

**`engine.test.js`** checks the arithmetic against values derived somewhere
other than the engine: closed-form formulas written out separately in the test
file, cases worked by hand, and the three acceptance cases already verified in a
spreadsheet outside this codebase. A test that only agrees with the code it is
testing proves nothing, so none of the expected values here were produced by
running the code.

Worth knowing what some of them pin down:

- A series growing at exactly 12% a year must measure 12% at every horizon and
  every starting date. If the rolling engine ever drifts, this catches it.
- SIP growth is checked against the closed-form annuity-due formula, spelled out
  independently in the test.
- The required monthly top-up is checked by feeding it back in: adding it must
  land the projection exactly on the goal.
- Windows that fall inside a gap in the data must be dropped, not stretched.
- Every refusal path must return a readable sentence, never `NaN`.

**`browser.test.js`** loads the actual page and uses it: types a portfolio in,
loads NAV files including AMFI's semicolon format, switches holding periods,
feeds it junk. It also asserts the two claims the product makes about itself —
that no request goes to any other host, and that nothing ever renders `NaN`,
`undefined` or `#VALUE!` on screen.

**`grouped.test.js`** pins the distinction the whole portfolio module exists for.
A large early holding returning 7% and a small late one returning 50% must give a
portfolio figure near 7.6%, not the 28.5% an average of the two would suggest.
If that ever collapses into an average, the tool is lying about the thing it was
built to show.

**`intelligence.test.js`** covers the parts that make this more than a
calculator: the percentile spread, start-date sensitivity, drawdown and recovery,
benchmark consistency, and the reality check — including that it issues no buy or
sell instruction and never claims a fund is suitable.

**`bundled.test.js`** writes a clearly-labelled synthetic benchmark, drives the
whole bundled path in a browser, and restores the real (empty) file afterwards
whatever happens. It asserts at the end that the shipped bundle still contains no
invented data.

**`provider.test.js`** injects a stub provider and drives the search journey
end to end, including the failure paths. Nothing touches the network.

**`spec-rolling-index.test.js`** is the Rolling Returns redesign
specification's section 7 checklist, written as clicks rather than as unit
tests, because every item on it is a claim about what a reader SEES. A
tradebook is only refused if the refusal reaches the screen. It also holds the
scope line: the last section loads the same files down the "My own fund" path
and asserts that none of the new screen appears there.

## Before publishing a change

Run all of them. The browser suites write screenshots to `$PRC_TMP/shots` — look
at them, because the tests check behaviour and colour contrast, not whether two
labels have collided.
