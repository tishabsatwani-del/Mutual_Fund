"""Verify an official index file and bundle it with the tool.

Nothing here invents, estimates, interpolates or back-fills a single point. It
reads a file you downloaded from the index provider, runs every check that
should be run before a number reaches a reader, and refuses to bundle anything
that fails one.

    python3 tools/benchmarks/prepare_benchmark.py \\
        --file ~/Downloads/nifty50tri.csv \\
        --name "Nifty 50 TRI" \\
        --kind TRI \\
        --source "NSE Indices Limited" \\
        --licence "Downloaded from the index provider; personal/educational use" \\
        --note "Total Return Index. Dividends included."

Add --dry-run to check a file without writing anything.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}

DATE_HEADERS = {"date", "nav date", "as on", "as on date", "day", "period", "index date"}
VALUE_HEADERS = {"close", "closing", "closing value", "close price", "index value", "value",
                 "total returns index", "tri", "nav", "price", "closing index value"}

problems = []
warnings = []


def fail(message):
    problems.append(message)


def warn(message):
    warnings.append(message)


# ------------------------------------------------------------------ parsing
def split_line(line, delim):
    out, cur, quoted = [], "", False
    for i, ch in enumerate(line):
        if ch == '"':
            if quoted and i + 1 < len(line) and line[i + 1] == '"':
                cur += '"'
            else:
                quoted = not quoted
        elif ch == delim and not quoted:
            out.append(cur); cur = ""
        else:
            cur += ch
    out.append(cur)
    return [c.strip() for c in out]


def detect_delimiter(text):
    sample = text.splitlines()[:25]
    best, best_score = ",", -1
    for d in [";", ",", "\t", "|"]:
        counts = [ln.count(d) for ln in sample if ln.count(d) > 0]
        if len(counts) < 2:
            continue
        counts.sort()
        mode = counts[len(counts) // 2]
        score = mode * sum(1 for c in counts if c == mode)
        if score > best_score:
            best, best_score = d, score
    return best


def parse_date(raw, day_first=True):
    s = str(raw).strip().strip('"')
    if not s:
        return None
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = re.match(r"^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})", s)
        if m:
            mo = MONTHS.get(m.group(2)[:3].lower())
            if not mo:
                return None
            d, y = int(m.group(1)), int(m.group(3))
            y = y if y >= 100 else (2000 + y if y < 70 else 1900 + y)
        else:
            m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", s)
            if not m:
                return None
            a, b = int(m.group(1)), int(m.group(2))
            y = int(m.group(3))
            y = y if y >= 100 else (2000 + y if y < 70 else 1900 + y)
            d, mo = (a, b) if day_first else (b, a)
    try:
        return dt.date(y, mo, d)
    except ValueError:
        return None


def parse_number(raw):
    s = re.sub(r"[₹$,\s]", "", str(raw)).strip('"')
    if s in ("", "-") or re.fullmatch(r"n\.?a\.?", s, re.I):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v


def detect_day_first(rows, col):
    first_over, second_over, ambiguous = False, False, False
    for r in rows:
        m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", str(r[col]).strip())
        if not m:
            continue
        ambiguous = True
        if int(m.group(1)) > 12:
            first_over = True
        if int(m.group(2)) > 12:
            second_over = True
    if not ambiguous:
        return True, True
    if first_over and not second_over:
        return True, True
    if second_over and not first_over:
        return False, True
    return True, False


def read_series(path):
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        text = fh.read()
    delim = detect_delimiter(text)
    rows = [split_line(ln, delim) for ln in text.splitlines() if ln.strip()]
    if len(rows) < 2:
        fail("The file has fewer than two rows.")
        return []

    header = rows[0]
    lowered = [h.lower().strip() for h in header]
    date_col = value_col = -1
    for i, h in enumerate(lowered):
        if date_col == -1 and (h in DATE_HEADERS or "date" in h):
            date_col = i
    for i, h in enumerate(lowered):
        if value_col == -1 and i != date_col and (h in VALUE_HEADERS or
                                                  re.search(r"(close|value|index|price|tri)", h)):
            value_col = i
    if date_col == -1 or value_col == -1:
        fail(f"Could not find a date column and a value column. Headers seen: {header}")
        return []
    print(f"  columns: date = {header[date_col]!r}, value = {header[value_col]!r}")

    body = rows[1:]
    day_first, certain = detect_day_first(body, date_col)
    if not certain:
        warn("Dates could be read either way; assumed day-first. Check the first and last "
             "dates below against the provider's own page before publishing.")

    seen, series = {}, []
    bad_date = bad_value = duplicate = 0
    for r in body:
        if len(r) <= max(date_col, value_col):
            bad_value += 1
            continue
        d = parse_date(r[date_col], day_first)
        if d is None:
            bad_date += 1
            continue
        v = parse_number(r[value_col])
        if v is None or v <= 0:
            bad_value += 1
            continue
        if d in seen:
            duplicate += 1
            seen[d] = v
            continue
        seen[d] = v
    series = sorted(seen.items())

    total = len(body)
    print(f"  rows: {total} read, {len(series)} usable, {bad_date} unreadable dates, "
          f"{bad_value} unusable values, {duplicate} duplicate dates")
    if total and (bad_date + bad_value) / total > 0.02:
        fail(f"{bad_date + bad_value} of {total} rows could not be read. That is more than 2%, "
             "which usually means the wrong column or the wrong file.")
    if duplicate:
        warn(f"{duplicate} duplicate dates collapsed, keeping the last value for each.")
    return series


# ------------------------------------------------------------------- checks
def check_series(series, args):
    if len(series) < 200:
        fail(f"Only {len(series)} usable points. An index history should have thousands.")
        return
    first, last = series[0][0], series[-1][0]
    span = (last - first).days / 365.2425
    print(f"  dates: {first.isoformat()} to {last.isoformat()}  ({span:.1f} years)")
    if span < args.min_years:
        fail(f"The series covers {span:.1f} years; at least {args.min_years} were required.")

    gaps = [((series[i][0] - series[i - 1][0]).days, series[i - 1][0], series[i][0])
            for i in range(1, len(series))]
    worst = max(gaps)
    print(f"  largest gap: {worst[0]} days ({worst[1].isoformat()} to {worst[2].isoformat()})")
    if worst[0] > args.max_gap:
        fail(f"A {worst[0]}-day gap between {worst[1]} and {worst[2]} exceeds the {args.max_gap}-day "
             "limit. A rolling window landing inside a hole that size cannot be measured honestly.")

    per_year = len(series) / max(span, 0.01)
    print(f"  density: about {per_year:.0f} points a year")
    if per_year < 200:
        warn(f"About {per_year:.0f} points a year is sparser than daily. Rolling windows will be "
             "dropped wherever a date cannot be matched within seven days.")

    jumps = [(series[i][1] / series[i - 1][1] - 1, series[i][0])
             for i in range(1, len(series)) if series[i - 1][1] > 0]
    big = [j for j in jumps if abs(j[0]) > 0.25]
    if big:
        warn(f"{len(big)} day(s) move more than 25%, the largest {big[0][0] * 100:.1f}% on "
             f"{big[0][1]}. Check these are real and not a units change or a stitched series.")

    if args.kind == "TRI" and not re.search(r"tri|total return", args.name, re.I):
        warn(f"Declared as TRI but the name {args.name!r} does not say so. A price index reads "
             "several percent a year lower and must not be labelled TRI.")
    if args.kind == "PRICE":
        warn("This is a price index: it excludes dividends and will read lower than what an "
             "investor actually earned. Make sure the name says so.")


# --------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", required=True, help="the file you downloaded from the provider")
    ap.add_argument("--name", required=True, help='exact published name, e.g. "Nifty 50 TRI"')
    ap.add_argument("--kind", required=True, choices=["TRI", "PRICE"],
                    help="TRI includes dividends; PRICE does not")
    ap.add_argument("--source", required=True, help="who published it")
    ap.add_argument("--licence", required=True,
                    help="the usage rights you are relying on to bundle this")
    ap.add_argument("--note", default="", help="anything a reader should know, e.g. a stitched join")
    ap.add_argument("--out", default="tool/data/benchmarks.json")
    ap.add_argument("--min-years", type=float, default=10.0)
    ap.add_argument("--max-gap", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print(f"\nReading {args.file}")
    series = read_series(args.file)
    if series:
        check_series(series, args)

    if warnings:
        print("\nWARNINGS — read these before publishing:")
        for w in warnings:
            print(f"  ! {w}")
    if problems:
        print("\nREFUSED:")
        for pr in problems:
            print(f"  x {pr}")
        print("\nNothing was written. Fix the file or the arguments and run again.")
        return 1

    entry = {
        "name": args.name,
        "kind": args.kind,
        "source": args.source,
        "licence": args.licence,
        "note": args.note,
        "firstDate": series[0][0].isoformat(),
        "lastDate": series[-1][0].isoformat(),
        "points": len(series),
        "series": [[d.isoformat(), round(v, 4)] for d, v in series],
    }

    if args.dry_run:
        print(f"\nDry run: {args.name} would be bundled with {len(series)} points, "
              f"{entry['firstDate']} to {entry['lastDate']}.")
        return 0

    data = {"asOf": None, "benchmarks": []}
    if os.path.exists(args.out):
        with open(args.out, encoding="utf-8") as fh:
            existing = json.load(fh)
        data["benchmarks"] = [b for b in existing.get("benchmarks", [])
                              if b.get("name") != args.name]
    data["benchmarks"].append(entry)
    data["benchmarks"].sort(key=lambda b: b["name"])
    data["asOf"] = max(b["lastDate"] for b in data["benchmarks"])
    data["_comment"] = ("Bundled benchmark history. Written only by "
                        "tools/benchmarks/prepare_benchmark.py, which refuses anything it cannot "
                        "verify. Never edited by hand, and never generated.")

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    size = os.path.getsize(args.out) / 1024
    print(f"\nBundled {args.name}: {len(series)} points, {entry['firstDate']} to "
          f"{entry['lastDate']}.")
    print(f"{args.out} is now {size:.0f} KB and holds "
          f"{len(data['benchmarks'])} benchmark(s), as of {data['asOf']}.")
    print("\nNow run:  node tools/tool-tests/engine.test.js  and the browser suites.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
