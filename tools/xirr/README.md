# The XIRR sheet — what is here and how to replace it

Maintenance notes and build tooling. Nothing here is served: the published
directory `xirr/` holds only the page, the file and the print artwork.

| Script | What it does |
|---|---|
| `build_xlsx.py` | Builds the workbook from scratch |
| `harden.py` | Adds cached formula results, then patches back the two number formats LibreOffice mangles |
| `acceptance_tests.py` | Types each test case into the real file, recalculates it in LibreOffice, reads back the result and the status line |
| `verify_structure.py` | Asserts the file against the brief: tab order, named ranges, locked cells, allowed functions only, no macros |

```
pip install openpyxl segno            # and: apt-get install libreoffice-calc
python3 tools/xirr/build_xlsx.py       /tmp/raw.xlsx
python3 tools/xirr/harden.py           /tmp/raw.xlsx xirr/XIRR-Calculator.xlsx
python3 tools/xirr/verify_structure.py xirr/XIRR-Calculator.xlsx
python3 tools/xirr/acceptance_tests.py xirr/XIRR-Calculator.xlsx
```

**Do not skip `harden.py`.** A workbook straight out of openpyxl carries
formulas with no stored results. Excel recalculates on open and is fine, but
the previewers a phone reaches for first — iOS Quick Look, the Files app,
Drive's preview, WhatsApp — do not calculate. They render every result cell
empty, which reads to a reader as a broken file. `harden.py` recalculates the
sheet once and stores the answers, so the file shows real numbers even when
nothing is calculating.

## The printed address

```
https://tishabsatwani-del.github.io/Mutual_Fund/xirr/
```

This is the only address that goes in the book, beside the QR code. It is
served from this repository, so nothing outside your control sits in the
chain between the printed page and the file.

## The two layers

| Layer | Path | Printed? |
|---|---|---|
| The page | `xirr/index.html` | Yes — this is the printed address |
| The file | `xirr/XIRR-Calculator.xlsx` | Never |

The printed address points at the page; the page's button points at the file.
The file path carries **no version number** so it never has to change. The
version lives inside the file, on its **About** tab, which is where a reader
in 2029 will look when they write in.

## Replacing the sheet later

1. Overwrite `xirr/XIRR-Calculator.xlsx` — keep the filename exactly.
2. Bump the version and build date on the workbook's **About** tab.
3. In `index.html`, update the `download="XIRR Calculator v1.0.xlsx"`
   attribute and the `41 KB` note. These two are the only version-bearing
   strings on the page.
4. Commit to `main`. The Pages workflow redeploys the whole repository.

The printed address and the QR code stay valid. They never need to change,
which is the entire reason for the page sitting in front of the file.

## The QR code

`qr-xirr-sheet.svg` (30 mm, vector, for print) and `qr-xirr-sheet.png`
(820 px, for proofs). Static — the address is baked into the pattern, so it
works offline, forever, with no service behind it. Black on white with a
four-module quiet zone already included in the artwork; do not crop it, do
not print it below 20 mm, do not recolour it.

Both live in `xirr/` beside the page. Regenerate only if the printed address
itself changes:

```
python3 -c "import segno; segno.make('<url>', error='m').save('qr-xirr-sheet.svg', scale=30/41, border=4, dark='#000000', light='#ffffff', unit='mm')"
```

## The one deviation from the Part B copy

The page carries Part B's copy word for word, with a single added line under
the download button:

> On a phone you will need a free spreadsheet app, such as Google Sheets, to
> open it.

It is there because Android has no built-in spreadsheet viewer. Without an
app registered for `.xlsx`, tapping the downloaded file does nothing at all —
no error, no prompt — and the reader is stranded at the last step of a
promise the book already made. Do not remove this line while "restoring" the
original copy.

## What the page deliberately does not have

No email capture, no form, no analytics, no comments, no embeds, no
"last updated" date, no contact address. Every one of those is a thing that
rots or generates work. The page is one file with no external requests of
any kind, so there is nothing in it that can break when something else
changes.
