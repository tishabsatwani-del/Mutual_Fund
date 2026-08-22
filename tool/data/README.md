# Bundling benchmark history

`benchmarks.json` ships empty. The rolling-return engine is complete and tested;
what is missing is the data, and the data must be real.

## Why it is empty

An index series cannot be approximated. A plausible-looking curve would produce
a confident "the worst five-year period returned X%" about a market that never
existed, and a reader would have no way to tell. The one thing worse than no
benchmark is a fabricated one, so this version ships with none and says so on
the screen.

Until it is filled, the **Understand market history** module works by loading an
index file directly, which measures exactly the same way.

## Filling it

1. Download the official history for each index you want, from the index
   provider itself. Prefer **Total Return Index** (TRI) files for equity
   benchmarks: TRI counts dividends, a price index does not, and a price series
   will read several percent a year lower than what an investor actually earned.
2. Record, for each index: its exact published name, the first date the series
   genuinely begins, whether any early portion is back-tested or reconstructed
   rather than live, and the date the file ends.
3. Convert to the format below and set `asOf` to the last date in the data.

```json
{
  "asOf": "2026-03-31",
  "benchmarks": [
    {
      "name": "Nifty 50 TRI",
      "note": "Total Return Index, dividends included. Live from <date>.",
      "series": [["1999-06-30", 1000.00], ["1999-07-01", 1004.25]]
    }
  ]
}
```

Dates are `YYYY-MM-DD`. Values are numbers, not strings. The series is sorted on
load, so the file order does not matter.

## Rules the tool relies on

- **Never mix a price index, a total return index and a fund NAV in one series.**
  They are three different measurements. Label each one for what it is.
- **Do not stitch two indices together** to manufacture a longer history unless
  the join is documented in the `note`, in plain words a reader can act on.
- **Do not silently extend the data forward.** The `asOf` date is shown in the
  About screen; a stale date is honest, an invented point is not.
- A back-tested or reconstructed early portion must say so in the `note`. It is
  not the same thing as a live record, and it usually flatters the numbers.

## After editing

Re-run the checks before publishing:

```
node tools/tool-tests/engine.test.js
```
