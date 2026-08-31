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
check("five visible tabs, in order",
      [ws.title for ws in wb.worksheets if ws.sheet_state == "visible"]
      == ["Start here", "My investments", "Plan my goal", "Example", "About"])
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
               "Add a last row: today's date, Worth today,",
               "Add at least one investment."):
    check(f"status line: {phrase[:34]}...", phrase in inv["B5"].value)

# entry table
check("headings on row 7",
      [inv[f"{c}7"].value for c in "BCDEF"]
      == ["Date", "What happened", "Amount", "Used by the sheet", "Which holding"])
check("500 pre-formatted rows, 8 to 507",
      inv["E8"].value == '=IF($B8="","",IF($C8="Money in",-$D8,$D8))'
      and inv["E507"].value == '=IF($B507="","",IF($C507="Money in",-$D507,$D507))')
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
      dvs["list"].formula1 == '"Money in,Money out,Worth today"')
check("amount must be positive",
      dvs["decimal"].operator == "greaterThan" and dvs["decimal"].formula1 == "0")

# protection
check("every sheet protected", all(ws.protection.sheet for ws in wb.worksheets))
check("no sheet password",
      all(not ws.protection.password for ws in wb.worksheets))
unlocked = [c.coordinate for row in inv.iter_rows(min_row=1, max_row=507, max_col=10)
            for c in row if c.protection and c.protection.locked is False]
check("inputs unlocked: fund name, the entry table and the holding names",
      set(unlocked) == ({"B2"} | {f"{c}{r}" for c in "BCDF" for r in range(8, 508)}
                        | {f"H{r}" for r in range(11, 16)}),
      f"{len(unlocked)} cells")
check("result cell and column E locked",
      inv["B4"].protection.locked is not False and inv["E8"].protection.locked is not False)
check("Example tab fully locked",
      not [c for row in wb["Example"].iter_rows() for c in row
           if c.protection and c.protection.locked is False])

check("each holding can be measured on its own",
      "XIRR" in str(inv["J11"].value) and "not enough entries" in str(inv["J11"].value))
check("the portfolio summary is on the working tab",
      [inv[f"H{r}"].value for r in range(3, 8)]
      == ["You put in", "You took out", "Worth now", "Gain or loss", "How long you have held it"])
check("the sheet says the portfolio is not an average of the holdings",
      "not the average" in str(inv["H18"].value))

# the goal tab
goal = wb["Plan my goal"]
calc = wb["Calc"]
check("goal inputs are the only unlocked cells on the goal tab",
      set(c.coordinate for row in goal.iter_rows() for c in row
          if c.protection and c.protection.locked is False)
      == {"B3", "B4", "B5", "B6", "B7", "B8", "B9"})
check("the projected value is locked", goal["B11"].protection.locked is not False)
# The one place a typed input could quietly produce a wrong number: a holding
# name that does not match is silently excluded from that holding's XIRR.
hold_dv = [dv for dv in inv.data_validations.dataValidation
           if dv.type == "list" and "F8" in dv.sqref]
# The SHIPPED file is the hardened one, and the round trip through LibreOffice
# normalises openpyxl's "=$H$11:$H$15" to the stored form "$H$11:$H$15". Assert
# the range, not the punctuation, or this check passes on the build and fails on
# the artifact readers actually download.
check("the holding column offers the names it must match",
      len(hold_dv) == 1 and hold_dv[0].formula1.lstrip("=") == "$H$11:$H$15",
      hold_dv[0].formula1 if hold_dv else "no list validation on F")
check("and warns rather than blocking, so a blank list is still usable",
      bool(hold_dv) and hold_dv[0].errorStyle == "warning",
      hold_dv[0].errorStyle if hold_dv else "")
check("no example holdings are seeded into the reader's own sheet",
      all(inv[f"H{r}"].value in (None, "") for r in range(11, 16)),
      str([inv[f"H{r}"].value for r in range(11, 16)]))

# Review v4 §11's caps, on the sheet as well as on the web. The step-up had
# neither a validation nor a gate, so an absurd raise printed an enormous figure
# with nothing flagged -- the workbook's version of the web planner's 68-digit
# defect.
def goal_dv_for(cell):
    for dv in goal.data_validations.dataValidation:
        if cell in dv.sqref:
            return dv
    return None

for cell, lo, hi in (("B8", "0", "30"), ("B9", "0", "25")):
    dv = goal_dv_for(cell)
    check(f"goal {cell} is bounded {lo} to {hi}",
          dv is not None and dv.formula1 == lo and dv.formula2 == hi,
          f"{cell}: {dv.formula1 if dv else 'no validation'}-{dv.formula2 if dv else ''}")
    check(f"goal {cell} explains itself when refused",
          dv is not None and bool(dv.error) and bool(dv.errorTitle))

# and the gate behind them, which a paste cannot bypass
gate = calc["G10"].value
for ref, bound in (("$B$8", "30"), ("$B$9", "25")):
    check(f"the gate tests {ref} against {bound}",
          f"{ref}>{bound}" in gate.replace("'Plan my goal'!", ""), gate[:120])

check("years are limited to whole numbers",
      any(dv.type == "whole" for dv in goal.data_validations.dataValidation))
check("the goal tab never shows a bare error",
      'Check the line below' in str(goal["B11"].value))
check("the goal tab says the return is an assumption",
      any("assumption, not a forecast" in str(c.value)
          for row in goal.iter_rows() for c in row if c.value))

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
