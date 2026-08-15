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

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)

with zipfile.ZipFile(OUT) as z:
    sheet2 = z.read("xl/worksheets/sheet2.xml").decode()
    print("formulas kept:", len(re.findall(r"<f[ >]", sheet2)))
    print("cached values:", len(re.findall(r"<v>", sheet2)))
    print("zip ok:", z.testzip() is None, "| members:", len(z.namelist()))
print("wrote", OUT)
