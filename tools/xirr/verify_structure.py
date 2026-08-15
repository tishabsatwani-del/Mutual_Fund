"""Assert the shipped file matches the brief, clause by clause."""
import re
import sys
import zipfile

from openpyxl import load_workbook

PATH = sys.argv[1]
wb = load_workbook(PATH)
fails = []


def check(label, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{('  -- ' + detail) if detail else ''}")
    if not ok:
        fails.append(label)


# tab order and visibility
check("four visible tabs, in order",
      [ws.title for ws in wb.worksheets if ws.sheet_state == "visible"]
      == ["Start here", "My investments", "Example", "About"])
check("only Calc is hidden",
      [ws.title for ws in wb.worksheets if ws.sheet_state != "visible"] == ["Calc"])

inv = wb["My investments"]

# named ranges
names = {n: d.value for n, d in wb.defined_names.items()}
for n, col in (("Flow_Dates", "B"), ("Flow_Values", "E")):
    check(f"named range {n}", names.get(n) ==
          f"OFFSET('My investments'!${col}$8,0,0,COUNT('My investments'!$B$8:$B$507),1)")

# result and status formulas
check("B4 double XIRR with -0.5 fallback",
      inv["B4"].value.count("XIRR") == 2 and "-0.5" in inv["B4"].value
      and "Check the status line below" in inv["B4"].value)
check("B4 formatted as percent, one decimal", inv["B4"].number_format == "0.0%")
for phrase in ("Add your first investment above.",
               "Add a last row: today's date, Value today,",
               "Add at least one investment."):
    check(f"status line: {phrase[:34]}...", phrase in inv["B5"].value)

# entry table
check("headings on row 7",
      [inv[f"{c}7"].value for c in "BCDE"]
      == ["Date", "What happened", "Amount", "Used by the sheet"])
check("500 pre-formatted rows, 8 to 507",
      inv["E8"].value == '=IF($B8="","",IF($C8="Investment",-$D8,$D8))'
      and inv["E507"].value == '=IF($B507="","",IF($C507="Investment",-$D507,$D507))')
check("dates shown dd-mmm-yyyy", inv["B8"].number_format == "dd-mmm-yyyy")
check("freeze panes at row 8", inv.freeze_panes == "A8")
check("no merged cells anywhere",
      all(not ws.merged_cells.ranges for ws in wb.worksheets))
check("no conditional formatting",
      all(not list(ws.conditional_formatting) for ws in wb.worksheets))

# fonts: nothing under 12pt
small = [f"{ws.title}!{c.coordinate}" for ws in wb.worksheets for row in ws.iter_rows()
         for c in row if c.value is not None and c.font and c.font.size
         and c.font.size < 12]
check("no font below 12pt", not small, ", ".join(small[:4]))

# validation
dvs = {dv.type: dv for dv in inv.data_validations.dataValidation}
check("date validation 1990-2100",
      dvs["date"].formula1 == "32874" and dvs["date"].formula2 == "73415")
check("three dropdown options only",
      dvs["list"].formula1 == '"Investment,Withdrawal,Value today"')
check("amount must be positive",
      dvs["decimal"].operator == "greaterThan" and dvs["decimal"].formula1 == "0")

# protection
check("every sheet protected", all(ws.protection.sheet for ws in wb.worksheets))
check("no sheet password",
      all(not ws.protection.password for ws in wb.worksheets))
unlocked = [c.coordinate for row in inv.iter_rows(min_row=1, max_row=507, max_col=6)
            for c in row if c.protection and c.protection.locked is False]
check("only B2 and B8:D507 unlocked",
      set(unlocked) == {"B2"} | {f"{c}{r}" for c in "BCD" for r in range(8, 508)},
      f"{len(unlocked)} cells")
check("result cell and column E locked",
      inv["B4"].protection.locked is not False and inv["E8"].protection.locked is not False)
check("Example tab fully locked",
      not [c for row in wb["Example"].iter_rows() for c in row
           if c.protection and c.protection.locked is False])

# forbidden functions, anywhere in the workbook
ALLOWED = {"XIRR", "IF", "IFERROR", "DATE", "EDATE", "TODAY", "COUNT", "COUNTA",
           "OFFSET", "SUM", "TEXT"}
used = set()
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("="):
                used |= set(re.findall(r"([A-Z][A-Z0-9_.]*)\s*\(", c.value.upper()))
for n, formula in names.items():
    used |= set(re.findall(r"([A-Z][A-Z0-9_.]*)\s*\(", formula.upper()))
check("only allowed functions used", used <= ALLOWED, f"used: {sorted(used)}")
check("no _xlfn future-function prefixes anywhere",
      not any("_xlfn" in str(c.value) for ws in wb.worksheets
              for row in ws.iter_rows() for c in row))

# file-level
with zipfile.ZipFile(PATH) as z:
    parts = z.namelist()
check("no macros in the package",
      not [p for p in parts if "vbaProject" in p or p.endswith(".bin")], "")
check("no external links or data connections",
      not [p for p in parts if "externalLink" in p or "connections" in p])
check("single file, no workbook protection", wb.security is None
      or not getattr(wb.security, "lockStructure", False))

print()
print("FAILURES:", fails if fails else "none")
sys.exit(1 if fails else 0)
