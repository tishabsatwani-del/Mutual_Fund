"""Build XIRR Calculator v1.0.xlsx exactly to the Part A brief.

Allowed functions only: XIRR, IF, IFERROR, DATE, EDATE, TODAY, COUNT, COUNTA,
OFFSET, SUM, TEXT.  No dynamic arrays, no macros, no COUNTIF (not on the list) --
the two row counts the status line needs come from a hidden Calc tab, which the
brief explicitly permits.
"""
import datetime as dt
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Protection, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName

OUT = sys.argv[1]

VERSION = "1.0"
BUILT = "15-Aug-2026"

FIRST_ROW, LAST_ROW = 8, 507
HEAD_ROW = 7

DATE_FMT = "dd-mmm-yyyy"
MONEY_FMT = '"₹"\\ ##,##,##0'
PCT_FMT = "0.0%"

BODY = Font(name="Calibri", size=12)
BODY_BOLD = Font(name="Calibri", size=12, bold=True)
GREY = Font(name="Calibri", size=12, color="FF808080")
HEAD_FONT = Font(name="Calibri", size=12, bold=True, color="FFFFFFFF")
HEAD_FILL = PatternFill("solid", fgColor="FF1F4E5F")
RESULT_FONT = Font(name="Calibri", size=28, bold=True, color="FF1F4E5F")
RESULT_FILL = PatternFill("solid", fgColor="FFEAF3F6")
GREY_FILL = PatternFill("solid", fgColor="FFF2F2F2")
STATUS_FONT = Font(name="Calibri", size=12, color="FFB00020")
LABEL_FONT = Font(name="Calibri", size=12, bold=True)

UNLOCKED = Protection(locked=False)
THIN = Side(style="thin", color="FFBFBFBF")
CELL_BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

INSTRUCTION = (
    "One row for every payment, with no blank rows in between. The last row "
    "must be today's date, Value today, and what the holding is worth now."
)

RESULT_FORMULA = (
    "=IFERROR(XIRR(Flow_Values,Flow_Dates),"
    "IFERROR(XIRR(Flow_Values,Flow_Dates,-0.5),"
    '"Check the status line below"))'
)

STATUS_FORMULA = (
    '=IF(COUNT($B$8:$B$507)=0,"Add your first investment above.",'
    'IF(Calc!$D$1=0,"Add a last row: today\'s date, Value today, and what the '
    'holding is worth now.",'
    'IF(Calc!$D$2=0,"Add at least one investment.","")))'
)

HEADINGS = ["Date", "What happened", "Amount", "Used by the sheet"]


def excel_serial(d):
    return (d - dt.date(1899, 12, 30)).days


def flow_formula(row):
    return f'=IF($B{row}="","",IF($C{row}="Investment",-$D{row},$D{row}))'


def widths(ws):
    ws.column_dimensions["A"].width = 2.5
    ws.column_dimensions["B"].width = 13.5
    ws.column_dimensions["C"].width = 17
    ws.column_dimensions["D"].width = 14
    ws.column_dimensions["E"].width = 15


def header_block(ws, fund_name=None):
    """Rows 1-6: fund name, the result, the status line, the instruction."""
    widths(ws)

    ws["A2"] = "Fund name"
    ws["A2"].font = LABEL_FONT
    ws["B2"] = fund_name
    ws["B2"].font = BODY

    ws["A4"] = "Your XIRR"
    ws["A4"].font = LABEL_FONT
    ws["A4"].alignment = Alignment(vertical="center")
    ws["B4"].font = RESULT_FONT
    ws["B4"].fill = RESULT_FILL
    ws["B4"].number_format = PCT_FMT
    ws["B4"].alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[4].height = 38

    ws["B5"].font = STATUS_FONT
    ws["B5"].alignment = Alignment(vertical="center")

    ws["B6"] = INSTRUCTION
    ws["B6"].font = BODY
    ws.row_dimensions[6].height = 16

    for col, heading in zip("BCDE", HEADINGS):
        c = ws[f"{col}{HEAD_ROW}"]
        c.value = heading
        c.font = HEAD_FONT
        c.fill = HEAD_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[HEAD_ROW].height = 30
    ws.freeze_panes = "A8"


def entry_rows(ws, unlock):
    """Pre-format rows 8-507 and drop the flow formula into column E."""
    for row in range(FIRST_ROW, LAST_ROW + 1):
        b, c, d, e = (ws[f"{x}{row}"] for x in "BCDE")
        for cell in (b, c, d):
            cell.font = BODY
            cell.border = CELL_BORDER
            if unlock:
                cell.protection = UNLOCKED
        b.number_format = DATE_FMT
        d.number_format = MONEY_FMT
        e.value = flow_formula(row)
        e.font = GREY
        e.fill = GREY_FILL
        e.border = CELL_BORDER
        e.number_format = MONEY_FMT


def validations(ws):
    lo, hi = excel_serial(dt.date(1990, 1, 1)), excel_serial(dt.date(2100, 12, 31))
    rng = f"B{FIRST_ROW}:B{LAST_ROW}"
    dv_date = DataValidation(
        type="date", operator="between", formula1=str(lo), formula2=str(hi),
        allow_blank=True, showErrorMessage=True,
        errorTitle="Check the date",
        error="Enter a real date between 1-Jan-1990 and 31-Dec-2100.",
    )
    dv_kind = DataValidation(
        type="list", formula1='"Investment,Withdrawal,Value today"',
        allow_blank=True, showErrorMessage=True,
        errorTitle="Pick one of the three",
        error="Choose Investment, Withdrawal or Value today from the list.",
    )
    dv_amt = DataValidation(
        type="decimal", operator="greaterThan", formula1="0",
        allow_blank=True, showErrorMessage=True,
        errorTitle="Positive numbers only",
        error="Type the amount as a plain positive number. Never type a minus sign.",
    )
    for dv, ref in ((dv_date, rng), (dv_kind, f"C{FIRST_ROW}:C{LAST_ROW}"),
                    (dv_amt, f"D{FIRST_ROW}:D{LAST_ROW}")):
        ws.add_data_validation(dv)
        dv.add(ref)


def protect(ws):
    ws.protection.sheet = True  # no password: an unopenable file is a dead file
    ws.protection.selectLockedCells = False
    ws.protection.selectUnlockedCells = False
    ws.protection.formatCells = False


wb = Workbook()

# ---------------------------------------------------------------- Start here
start = wb.active
start.title = "Start here"
start.column_dimensions["A"].width = 3
start.column_dimensions["B"].width = 92
lines = [
    "1. This sheet works out your XIRR: the yearly rate the money you actually "
    "invested has earned.",
    "2. Save your own copy before you type anything, so you always have a clean one.",
    "3. On the My investments tab, enter one row for every payment you made: the "
    "date, then Investment or Withdrawal from the dropdown, then the amount as a "
    "plain positive number.",
    "4. In the last row, enter today's date, choose Value today, and type what the "
    "holding is worth right now.",
    "5. Your XIRR appears at the top of that tab. If it does not, read the line "
    "underneath it: it says what is still missing.",
    "6. The Example tab is the same thing already filled in, if you get stuck.",
]
for i, text in enumerate(lines):
    cell = start.cell(row=2 + i * 2, column=2, value=text)
    cell.font = BODY
    cell.alignment = Alignment(wrap_text=True, vertical="top")
    start.row_dimensions[2 + i * 2].height = 32
protect(start)

# ----------------------------------------------------------- My investments
inv = wb.create_sheet("My investments")
header_block(inv)
inv["B2"].protection = UNLOCKED
inv["B4"] = RESULT_FORMULA
inv["B5"] = STATUS_FORMULA
entry_rows(inv, unlock=True)
validations(inv)
protect(inv)

# ------------------------------------------------------------------ Example
ex = wb.create_sheet("Example")
header_block(ex, fund_name="An example, already filled in")
ex["B4"] = (
    "=IFERROR(XIRR($E$8:$E$10,$B$8:$B$10),"
    "IFERROR(XIRR($E$8:$E$10,$B$8:$B$10,-0.5),"
    '"Check the status line below"))'
)
entry_rows(ex, unlock=False)
for row, (d, kind, amount) in enumerate(
    [
        (dt.datetime(2024, 1, 1), "Investment", 100000),
        (dt.datetime(2025, 1, 1), "Investment", 100000),
        (dt.datetime(2026, 1, 1), "Value today", 228000),
    ],
    start=FIRST_ROW,
):
    ex[f"B{row}"], ex[f"C{row}"], ex[f"D{row}"] = d, kind, amount
    ex[f"B{row}"].number_format = DATE_FMT
    ex[f"D{row}"].number_format = MONEY_FMT
protect(ex)

# -------------------------------------------------------------------- About
about = wb.create_sheet("About")
about.column_dimensions["A"].width = 3
about.column_dimensions["B"].width = 92
about_lines = [
    f"XIRR Calculator, version {VERSION}",
    f"Built {BUILT}",
    "This is an educational tool for readers. The figure it produces is before "
    "exit load and before tax, and it is not investment advice.",
    "Questions: use the channels listed in the book.",
    "The tabs are protected without a password. To adapt this sheet, choose "
    "Review, then Unprotect Sheet.",
    "No Excel? Upload this file to Google Sheets and it works there too, unchanged.",
]
for i, text in enumerate(about_lines):
    cell = about.cell(row=2 + i * 2, column=2, value=text)
    cell.font = BODY_BOLD if i == 0 else BODY
    cell.alignment = Alignment(wrap_text=True, vertical="top")
    about.row_dimensions[2 + i * 2].height = 30
protect(about)

# --------------------------------------------------------------- Calc (hidden)
calc = wb.create_sheet("Calc")
calc["C1"] = "Rows marked Value today"
calc["D1"] = f"=SUM($A${FIRST_ROW}:$A${LAST_ROW})"
calc["C2"] = "Rows marked Investment"
calc["D2"] = f"=SUM($B${FIRST_ROW}:$B${LAST_ROW})"
for row in range(FIRST_ROW, LAST_ROW + 1):
    calc[f"A{row}"] = f"=IF('My investments'!$C{row}=\"Value today\",1,0)"
    calc[f"B{row}"] = f"=IF('My investments'!$C{row}=\"Investment\",1,0)"
for row in calc.iter_rows():
    for c in row:
        if c.value is not None:
            c.font = BODY
protect(calc)
calc.sheet_state = "hidden"

# ------------------------------------------------------------- Named ranges
for name, col in (("Flow_Dates", "B"), ("Flow_Values", "E")):
    wb.defined_names.add(
        DefinedName(
            name,
            attr_text=(
                f"OFFSET('My investments'!${col}${FIRST_ROW},0,0,"
                f"COUNT('My investments'!$B${FIRST_ROW}:$B${LAST_ROW}),1)"
            ),
        )
    )

wb.active = 0
wb.save(OUT)
print("wrote", OUT)
