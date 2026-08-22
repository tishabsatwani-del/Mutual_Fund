# Checking The Portfolio Reality Check

Three suites. The first needs nothing installed; the other two drive a real
browser.

```
node  tools/tool-tests/engine.test.js      # 82 checks, no dependencies

npm install playwright                     # once
python3 -m http.server 8781                # from the repository root
node  tools/tool-tests/browser.test.js     # 35 checks in a real browser
node  tools/tool-tests/grouped.test.js     # 7 checks on fund vs portfolio
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

## Before publishing a change

Run all three. The browser suite writes screenshots to `$PRC_TMP/shots` — look
at them, because the tests check behaviour and colour contrast, not whether two
labels have collided.
