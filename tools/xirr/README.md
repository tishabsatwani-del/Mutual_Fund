# The spreadsheet — build tooling and maintenance

The XIRR sheet is no longer a separate destination. It is delivered from inside
The Portfolio Reality Check, at `/Mutual_Fund/tool/#sheet`, because the book can
carry only one printed address.

| What | Where |
|---|---|
| The file readers download | `tool/XIRR-Calculator.xlsx` |
| The screen that offers it | the **sheet** view in `tool/index.html` |
| The old separate page | `xirr/index.html`, now a redirect to the tool |

## Rebuilding the sheet

| Script | What it does |
|---|---|
| `build_xlsx.py` | Builds the workbook from scratch |
| `harden.py` | Adds cached formula results, then patches back the two number formats LibreOffice mangles |
| `acceptance_tests.py` | Types each test case into the real file, recalculates it in LibreOffice, reads back the result and the status line |
| `verify_structure.py` | Asserts the file against the brief: tab order, named ranges, locked cells, allowed functions only, no macros |
| `holdings_acceptance.py` | Enters two named holdings, recalculates outside Excel, and checks each one's XIRR against a bisection solver written in the test |
| `goal_acceptance.py` | Types goals into the **Plan my goal** tab, recalculates outside Excel, and checks every figure against the same sum done month by month in Python |

```
pip install openpyxl segno            # and: apt-get install libreoffice-calc
python3 tools/xirr/build_xlsx.py       /tmp/raw.xlsx
python3 tools/xirr/harden.py           /tmp/raw.xlsx tool/XIRR-Calculator.xlsx
python3 tools/xirr/verify_structure.py tool/XIRR-Calculator.xlsx
python3 tools/xirr/acceptance_tests.py tool/XIRR-Calculator.xlsx
python3 tools/xirr/goal_acceptance.py  tool/XIRR-Calculator.xlsx
python3 tools/xirr/holdings_acceptance.py tool/XIRR-Calculator.xlsx
```

**Do not skip `harden.py`.** A workbook straight out of openpyxl carries
formulas with no stored results. Excel recalculates on open and is fine, but the
previewers a phone reaches for first — iOS Quick Look, the Files app, Drive's
preview — do not calculate. They render every result cell empty, which reads to a
reader as a broken file. `harden.py` recalculates the sheet once and stores the
answers, so the file shows real numbers even when nothing is calculating.

The three acceptance cases must return 9.0509%, 12.6600% and 8.1381%.

## Per-holding returns

Each named holding is measured by handing XIRR a column that carries that
holding's own cash flow and a zero on every other row. A zero contributes
nothing to the present value, so the answer is that holding's own return, with
every date left in place — which is how a subset gets measured without a
function that filters. `holdings_acceptance.py` exists because that is a trick,
and tricks deserve a test rather than trust.

Helper columns live from `AA` rightwards specifically so they can never collide
with the goal tab's terms in `F` to `I`. An earlier edit did exactly that and
silently deleted the goal block; the goal suite caught it. **Run every suite
after any change to the Calc tab**, not just the one you think you touched.

## The goal tab

Excel cannot loop, so a year of month-start instalments is summed in closed form
on the hidden `Calc` tab and then compounded forward. That closed form was
checked against the same calculation done month by month and agrees to fourteen
decimal places, which is what keeps the workbook and the website from giving a
reader two different answers.

Percentages are entered as **plain numbers** — 10 means 10% — and divided by 100
in the formulas. A cell pre-formatted as a percentage turns a typed `10` into
either 10% or 1000% depending on one Excel setting, and a reader has no way to
tell which they got.

`goal_acceptance.py` caught three real bugs on its first run, including a total
contributed figure that was correct with no step-up and badly wrong with one.
Run it after any change to the tab.

## Replacing it with a new version

1. Rebuild as above, overwriting `tool/XIRR-Calculator.xlsx` — keep the filename.
2. Bump the version and build date on the workbook's **About** tab.
3. Update the `102 KB` note in the sheet view of `tool/index.html` if the size moved.
4. Commit to `main`. The printed address does not change, which is the whole
   point of the reader landing on a page rather than on a file.

## The printed address and the QR code

```
https://tishabsatwani-del.github.io/Mutual_Fund/tool/
```

One address, in the book, beside the QR code. `tool/qr-portfolio-reality-check.svg`
is the print artwork: static, 30 mm, black on white, with a four-module quiet zone
already in the file. Do not crop it, do not print it below 20 mm, do not recolour
it, and do not replace it with a dynamic or trackable QR — those route through
someone else's server and stop working the day that service does.

Regenerate only if the printed address itself changes:

```
python3 -c "import segno; q=segno.make('<url>', error='m'); q.save('tool/qr-portfolio-reality-check.svg', scale=30/q.symbol_size(border=4)[0], border=4, dark='#000000', light='#ffffff', unit='mm')"
```

Then decode the result and check it character for character before it goes to
print. A wrong QR in a printed book cannot be corrected.
