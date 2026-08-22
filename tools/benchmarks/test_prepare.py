"""Checks that the bundling tool accepts a sound file and refuses an unsound one.

The fixtures here are synthetic and exist only to exercise the checks. They are
written to a temporary directory and are never bundled with the tool; the real
benchmarks.json is only ever written from a file downloaded from the index
provider.
"""
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile

SCRIPT = os.path.join(os.path.dirname(__file__), "prepare_benchmark.py")
failures = []


def report(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('   -- ' + detail) if detail else ''}")
    if not ok:
        failures.append(name)


def write(path, rows, header="Date,Close"):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(header + "\n")
        for d, v in rows:
            fh.write(f"{d.isoformat()},{v:.4f}\n")
    return path


def daily(start, years, rate=0.11, skip_weekends=True, gap=None):
    """A dense series. Not real data -- only ever used to test the checks."""
    rows, d, v = [], start, 1000.0
    end = dt.date(start.year + years, start.month, start.day)
    while d <= end:
        if gap and gap[0] <= d <= gap[1]:
            d += dt.timedelta(days=1)
            continue
        if not (skip_weekends and d.weekday() >= 5):
            rows.append((d, v))
        v *= (1 + rate) ** (1 / 365.2425)
        d += dt.timedelta(days=1)
    return rows


def run(args, out):
    proc = subprocess.run([sys.executable, SCRIPT, "--out", out] + args,
                          capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


BASE = ["--name", "Test Index TRI", "--kind", "TRI",
        "--source", "synthetic fixture", "--licence", "test only"]

with tempfile.TemporaryDirectory() as tmp:
    out = os.path.join(tmp, "benchmarks.json")

    print("\nA sound file is accepted")
    good = write(os.path.join(tmp, "good.csv"), daily(dt.date(2005, 1, 3), 20))
    code, log = run(["--file", good] + BASE, out)
    report("a dense 20-year file is accepted", code == 0, log.strip().splitlines()[-1] if log else "")
    data = json.load(open(out)) if os.path.exists(out) else {}
    b = (data.get("benchmarks") or [{}])[0]
    report("the bundled entry records its real first and last date",
           b.get("firstDate") == "2005-01-03" and b.get("lastDate", "").startswith("2025-01"),
           f"{b.get('firstDate')} to {b.get('lastDate')}")
    report("the source is recorded", b.get("source") == "synthetic fixture")
    report("the licence is recorded", b.get("licence") == "test only")
    report("TRI or price is recorded", b.get("kind") == "TRI")
    report("asOf matches the newest data", data.get("asOf") == b.get("lastDate"))
    report("weekends are simply absent, not invented", b.get("points", 0) < 366 * 20)

    print("\nA second benchmark joins the first")
    good2 = write(os.path.join(tmp, "good2.csv"), daily(dt.date(2008, 1, 2), 17, 0.13))
    code, log = run(["--file", good2, "--name", "Another Index TRI", "--kind", "TRI",
                     "--source", "synthetic fixture", "--licence", "test only"], out)
    data = json.load(open(out))
    report("both benchmarks are bundled", code == 0 and len(data["benchmarks"]) == 2,
           str(len(data.get("benchmarks", []))))
    report("re-running replaces rather than duplicates",
           run(["--file", good2, "--name", "Another Index TRI", "--kind", "TRI",
                "--source", "s", "--licence", "l"], out)[0] == 0
           and len(json.load(open(out))["benchmarks"]) == 2)

    print("\nUnsound files are refused")
    short = write(os.path.join(tmp, "short.csv"), daily(dt.date(2020, 1, 1), 3))
    code, log = run(["--file", short] + BASE, out)
    report("too little history is refused", code != 0 and "REFUSED" in log)
    report("and it says how many years it found", "3.0 years" in log, log[-300:])

    holed = write(os.path.join(tmp, "gap.csv"),
                  daily(dt.date(2005, 1, 3), 20, gap=(dt.date(2012, 3, 1), dt.date(2012, 8, 1))))
    code, log = run(["--file", holed] + BASE, out)
    report("a five-month hole is refused", code != 0 and "exceeds the 30-day limit" in log)

    tiny = write(os.path.join(tmp, "tiny.csv"), [(dt.date(2020, 1, 1), 100), (dt.date(2021, 1, 1), 110)])
    report("a two-point file is refused", run(["--file", tiny] + BASE, out)[0] != 0)

    junk = os.path.join(tmp, "junk.csv")
    open(junk, "w").write("hello,world\nfoo,bar\n")
    code, log = run(["--file", junk] + BASE, out)
    report("a file with no date column is refused", code != 0 and "Could not find" in log)

    print("\nWarnings that do not block, but must be said")
    code, log = run(["--file", good, "--name", "Some Index", "--kind", "TRI",
                     "--source", "s", "--licence", "l"], out)
    report("a TRI without TRI in its name is flagged", "does not say so" in log)
    code, log = run(["--file", good, "--name", "Some Price Index", "--kind", "PRICE",
                     "--source", "s", "--licence", "l"], out)
    report("a price index is flagged as excluding dividends", "excludes dividends" in log)

    print("\nNothing is written when a file is refused")
    before = open(out, "rb").read()
    run(["--file", short] + BASE, out)
    report("a refused run leaves the bundle untouched", open(out, "rb").read() == before)

    print("\nA dry run writes nothing at all")
    code, log = run(["--file", good] + BASE + ["--dry-run"], out)
    report("dry run reports without writing", code == 0 and "Dry run" in log
           and open(out, "rb").read() == before)

print()
print("FAILURES:", failures if failures else "none")
sys.exit(1 if failures else 0)
