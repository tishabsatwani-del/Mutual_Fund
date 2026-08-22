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

```
pip install openpyxl segno            # and: apt-get install libreoffice-calc
python3 tools/xirr/build_xlsx.py       /tmp/raw.xlsx
python3 tools/xirr/harden.py           /tmp/raw.xlsx tool/XIRR-Calculator.xlsx
python3 tools/xirr/verify_structure.py tool/XIRR-Calculator.xlsx
python3 tools/xirr/acceptance_tests.py tool/XIRR-Calculator.xlsx
```

**Do not skip `harden.py`.** A workbook straight out of openpyxl carries
formulas with no stored results. Excel recalculates on open and is fine, but the
previewers a phone reaches for first — iOS Quick Look, the Files app, Drive's
preview — do not calculate. They render every result cell empty, which reads to a
reader as a broken file. `harden.py` recalculates the sheet once and stores the
answers, so the file shows real numbers even when nothing is calculating.

The three acceptance cases must return 9.0509%, 12.6600% and 8.1381%.

## Replacing it with a new version

1. Rebuild as above, overwriting `tool/XIRR-Calculator.xlsx` — keep the filename.
2. Bump the version and build date on the workbook's **About** tab.
3. Update the `46 KB` note in the sheet view of `tool/index.html` if the size moved.
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
