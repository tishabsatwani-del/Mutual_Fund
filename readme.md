# Mutual Fund Portfolio Tracker

A small, **dependency-free** Python toolkit for modelling mutual fund
holdings, tracking portfolio value and returns, and running common
investment calculators (lumpsum, SIP, CAGR, XIRR).

Everything uses only the Python standard library, so there is nothing to
install — just clone and run.

---

## 🌐 Live web tool — "Two Doors, One Storm"

A self-contained, **mobile-first**, **behaviour-driven** investing simulator.
Two people invest the same money, in the same market. One chose a **Regular**
plan (pays ~1%/yr more, but has a *relationship manager / MD* to call when life
hits). One chose **Direct** (pays nothing extra, but faces every storm alone).
The fee gap is small and steady. The behaviour gap is enormous. The tool
dramatises one idea: **the only real variable is who is beside you when it
falls.**

> **Live link:** `https://tishabsatwani-del.github.io/Mutual_Fund/`
> *(one-time setup: repo **Settings → Pages → Source = "GitHub Actions"**, then
> merge to `main` — the included workflow deploys automatically.)*

**Setup, in order:** pick the **scenario** (crash *or* emergency — two very
different situations), the **duration** (15 / 20 / 30 years), the **SIP**
(₹5,000 / ₹10,000 / ₹20,000 / ₹50,000), then the specific event. The crash
always hits at the **exact midpoint** (30y → year 15, 20y → year 10), stated
upfront so it's never a surprise.

**Two scenarios, off one engine**

- **The Crash** — *Live it.* Both wealth lines climb the years (a clear "Year
  N / 20" progress bar marks the crash ahead). At the midpoint a real, named
  crash hits — **COVID-19, the 2008 crisis, the 2022 correction, an Iran–USA
  war, or an India–Pakistan war** — each with a plain-language explanation of
  what actually happened. Your side goes **silent** (the loss shown at a
  glance: a big −X% and `₹before ▸ ₹after`); her phone **rings**. Every heavy
  beat **holds until you tap** — nothing flashes past. You pick one of four
  behaviours; then one headline (YOU vs FRIEND) and a "See the maths" panel.
- **The Emergency** — *The money, now.* A **staged, interactive** ordeal:
  you've quietly built a corpus across three sleeves; then life strikes —
  **hospitalisation/ICU, a business loss, a pandemic (COVID), or war** — at a
  **severity you choose** (Manageable / Serious / Devastating). *You* must
  decide how to raise the cash: redeem everything, take only what you need,
  sell the fallen fund, or kill the SIP. Then her RM makes the call she can
  make. Pandemics and wars arrive *with* a market crash.

**The maths — exact, auditable, never rigged**

- **Correct rates.** Returns are stored so the *effective annual CAGR* is
  **exactly 12% (Direct) / 11% (Regular)** — the monthly rate is the 12th root,
  not a naive 1%/month (which would compound to 12.68%). The fee is a
  multiplicative monthly drag, so Regular's CAGR is exactly 1 point lower on
  every path.
- **Real unit-level accounting** — every month `units = SIP / NAV`, value =
  `units × NAV` (+ idle cash), with correct start-of-month SIP timing. **XIRR**
  (Newton–Raphson + bisection) and **CAGR** computed from the actual cash flows.
- **Computed vs assumption.** Every figure is labelled: results (corpus, XIRR,
  CAGR, fee cost) are **computed live**; only the returns and the
  drawdown/emergency size are **inputs**. Nothing is invented.
- **"Was it luck?"** — the rigorous Monte Carlo engine (1,000 paths; mean ≈
  12%/yr, vol ≈ 15–18%/yr, fat tails + clustered crashes) reduced to one plain
  line and a **100-dot grid**: *"Held through every crash → ahead in X of 100
  futures; sold in the fall → ahead in only Y of 100."*
- **Honest, not rigged** — across paths, Direct can finish **above, equal to,
  or below** Regular. The tool never claims one door is better — it proves the
  door was never the point.
- **Real events (illustrative)** — COVID-19 2020 (~−38%), 2008 GFC (~−60%), the
  2022 correction (~−18%), an Iran–USA war (~−16%), an India–Pakistan war
  (~−10%, historically short and shallow). *Based on actual index drawdowns;
  exact figures vary by index and dates and must be locked against real data
  before shipping.*
- **Works offline, no CDN, no backend** — hand-rolled Canvas, instant load.

> All outputs are illustrative **ranges of possibility, never predictions or
> advice.** Educational tool — not investment advice.


Try it locally:

```bash
python -m http.server 8000    # then open http://localhost:8000
node tests/test_simulator.js  # verify the engine: ordering, XIRR, MC calibration
```

Files: `index.html`, `styles.css`, `app.js` (math engine + cinematic
experience), `.github/workflows/pages.yml` (auto-deploy).

---

## Features

- **Fund & Holding models** — represent schemes (NAV, category) and the
  units you hold, with per-holding profit/loss and average cost.
- **Portfolio aggregation** — add investments, merge repeat buys, and read
  aggregate invested amount, current value, P&L, total return and
  allocation breakdown.
- **Calculators**
  - `absolute_return` — simple gain/loss as a fraction
  - `cagr` — compound annual growth rate
  - `lumpsum_future_value` — future value of a one-time investment
  - `sip_future_value` — future value of a monthly SIP (annuity-due)
  - `xirr` — internal rate of return for dated, irregular cashflows

## Quick start

```python
from datetime import date
from mutual_fund import Fund, Portfolio, sip_future_value, xirr

bluechip = Fund("100001", "Bluechip Equity Fund", nav=20.0, category="Equity")
liquid   = Fund("200002", "Liquid Debt Fund", nav=10.0, category="Debt")

portfolio = Portfolio()
portfolio.add_investment(bluechip, 75_000)
portfolio.add_investment(liquid,   25_000)

print(portfolio.current_value)        # 100000.0
print(portfolio.total_return)         # 0.0 (just bought at NAV)
print(portfolio.allocation())         # {'100001': 0.75, '200002': 0.25}

# Project a SIP: 5,000/month at 12% p.a. for 15 years
print(sip_future_value(5000, 0.12, 15))

# XIRR of dated cashflows (investments negative, redemption positive)
flows = [
    (date(2022, 1, 1), -50_000.0),
    (date(2023, 1, 1), -50_000.0),
    (date(2024, 1, 1), 120_000.0),
]
print(xirr(flows))
```

Run the bundled demo:

```bash
python examples/demo.py
```

## Project layout

```
mutual_fund/
  __init__.py       # public API
  fund.py           # Fund, Holding data models
  portfolio.py      # Portfolio aggregation
  calculators.py    # returns / SIP / XIRR calculators
examples/
  demo.py           # end-to-end usage example
tests/
  test_calculators.py
  test_portfolio.py
```

## Running the tests

```bash
python -m unittest discover -s tests -v
```

## Notes

- NAVs are treated as static snapshots; wire in a data source (e.g. AMFI)
  to refresh them.
- `sip_future_value` assumes contributions at the **start** of each month
  (annuity-due).
- `xirr` uses Newton-Raphson with a bisection fallback and a 365-day count
  basis.

## License

MIT
