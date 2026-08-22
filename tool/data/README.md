# Bundling benchmark history

`benchmarks.json` ships **empty**, and nothing writes to it by hand. The rolling
return engine is finished and tested; what is missing is data, and the data must
be real.

## Why it is empty

An index series cannot be approximated. A plausible-looking curve would produce a
confident *"the worst five-year period returned X%"* about a market that never
existed, and a reader would have no way to tell. Rolling-return statistics look
authoritative whether or not the input was real, which is exactly why the input
has to be.

Until it is filled, **Understand the market** works by loading an index file
directly. Everything is measured identically either way — the calculation engine
does not know or care where a series came from.

## Filling it

**Step 1 — download.** Get the official history for each index you want, from the
index provider itself. Prefer **Total Return Index** files: TRI counts dividends,
a price index does not, and a price series reads several percent a year lower
than what an investor actually earned.

**Step 2 — satisfy yourself on the licence.** This is the one check no script can
do for you. Confirm the provider's terms permit bundling and redistributing the
series with a free tool. Whatever you rely on goes into `--licence` and is shown
to readers on screen.

**Step 3 — run it through the checker.**

```
python3 tools/benchmarks/prepare_benchmark.py \
    --file ~/Downloads/nifty50tri.csv \
    --name "Nifty 50 TRI" \
    --kind TRI \
    --source "NSE Indices Limited" \
    --licence "the terms you confirmed in step 2" \
    --note "Total Return Index. Dividends included."
```

Add `--dry-run` to inspect a file without writing anything. Repeat per index; a
second run for the same `--name` replaces that entry rather than duplicating it.

**Step 4 — re-run the suites**, including `tools/tool-tests/bundled.test.js`,
which drives the whole bundled path in a browser.

## What the checker verifies

It refuses outright on: fewer than 200 points; less than ten years of history; a
gap longer than 30 days (a rolling window landing in a hole that size cannot be
measured honestly); more than 2% of rows unreadable; or no identifiable date and
value column.

It warns, without blocking, about: ambiguous date formats; duplicate dates
collapsed; sparser-than-daily data; single-day moves above 25%, which usually
mean a units change or a stitched series; a file declared TRI whose name does not
say TRI; and any price index, because it excludes dividends.

It records, and the tool then shows the reader: the exact name, TRI or price, the
real first and last date, how many days of data, the source, the licence and any
note.

**It never creates, estimates, interpolates or back-fills a single point.** A file
that fails is refused and nothing is written.

## Rules the tool relies on

- **Never mix a price index, a total return index and a fund NAV in one series.**
  Three different measurements. Label each for what it is.
- **Do not stitch two indices together** to manufacture a longer history unless
  the join is described in `--note`, in words a reader can act on.
- **Do not extend the data forward.** The `asOf` date is shown on screen; a stale
  date is honest, an invented point is not.
- A back-tested or reconstructed early portion must say so in `--note`. It is not
  a live record, and it usually flatters the numbers.

## What a reader sees

Before any result: the series name, whether it is TRI or price, its real first
and last date, how many days of data, the source and the licence. Then, in plain
words, that the results describe that dataset and nothing outside it, that the
data is fixed rather than live, and that none of it forecasts anything.

That last part matters as the years pass. A 2006–2026 dataset still describes
2006–2026 correctly in 2031 — it simply stops being the *latest* twenty years.
The tool states its dates rather than implying freshness, so it ages honestly
instead of quietly going stale.
