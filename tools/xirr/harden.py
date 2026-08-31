"""Add cached formula results to the workbook without losing anything.

openpyxl cannot hold a formula and its result at the same time, so the values
come from a LibreOffice recalculation pass.  That pass rewrites two number
formats -- it flattens the Indian digit grouping and escapes the date hyphens --
so both are patched straight back into styles.xml, which leaves every cached
value intact.
"""
import re
import shutil
import subprocess
import sys
import zipfile

SRC, OUT = sys.argv[1], sys.argv[2]
WORK = "harden_tmp"

# quotes appear XML-escaped inside formatCode, so match them that way
FIXES = [
    # what LibreOffice wrote                        what the brief asks for
    ("&quot;₹ &quot;#,###,##0", "&quot;₹&quot;\\ ##,##,##0"),  # 1,00,000 not 100,000
    (r"dd\-mmm\-yyyy", "dd-mmm-yyyy"),                         # unescaped, as authored
]

shutil.rmtree(WORK, ignore_errors=True)
subprocess.run(
    ["soffice", "-env:UserInstallation=file:///tmp/lo-profile-xirr", "--headless",
     "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", WORK, SRC],
    check=True, capture_output=True, timeout=300,
)
recalced = f"{WORK}/{SRC.rsplit('/', 1)[-1]}"

with zipfile.ZipFile(recalced) as z:
    parts = {n: z.read(n) for n in z.namelist()}

styles = parts["xl/styles.xml"].decode("utf-8")
for wrong, right in FIXES:
    before = styles
    styles = styles.replace(wrong, right)
    print(f"{'patched' if styles != before else 'NOT FOUND'}: {wrong!r} -> {right!r}")
parts["xl/styles.xml"] = styles.encode("utf-8")

# The recalculation pass also AUTO-FITS row heights, which silently undoes the
# heights the build set on the My investments header block: 28 points came back
# as 27.75 and the 38 that holds a 28-point result figure came back as 33.85,
# where the figure it exists to protect is clipped. The heights are the build's
# decision, so they are put straight back, the same way the number formats are.
ROW_HEIGHTS = {1: 28, 2: 28, 3: 28, 4: 38, 5: 28, 6: 20}
INV_SHEET = "xl/worksheets/sheet2.xml"      # My investments, in workbook order

sheet = parts[INV_SHEET].decode("utf-8")


def set_height(tag, height):
    """Rewrite one <row> opening tag with the height the build asked for.

    The whole tag is taken apart and put back rather than patched in place: a
    substitution that only INSERTS ht= leaves the one LibreOffice wrote sitting
    further along the same tag, and a row element carrying two ht attributes is
    not XML at all -- Excel and every parser reject the file outright.
    """
    attrs = re.sub(r'\s+(ht|customHeight)="[^"]*"', "", tag.rstrip("/>").rstrip())
    return f'{attrs} ht="{height}" customHeight="1">'


for row, height in ROW_HEIGHTS.items():
    match = re.search(r'<row r="%d"[^>]*>' % row, sheet)
    if not match:
        print(f"ROW NOT FOUND: row {row}")
        continue
    sheet = sheet[:match.start()] + set_height(match.group(0), height) + sheet[match.end():]
    print(f"set: row {row} height {height}")
parts[INV_SHEET] = sheet.encode("utf-8")

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)

with zipfile.ZipFile(OUT) as z:
    sheet2 = z.read("xl/worksheets/sheet2.xml").decode()
    print("formulas kept:", len(re.findall(r"<f[ >]", sheet2)))
    print("cached values:", len(re.findall(r"<v>", sheet2)))
    print("zip ok:", z.testzip() is None, "| members:", len(z.namelist()))
print("wrote", OUT)
