# Mutual Fund Portfolio Tracker

A small, **dependency-free** Python toolkit for modelling mutual fund
holdings, tracking portfolio value and returns, and running common
investment calculators (lumpsum, SIP, CAGR, XIRR).

Everything uses only the Python standard library, so there is nothing to
install — just clone and run.

---

## 🌐 Live web tool — "Live It", a Behavioral Investing Simulator

A self-contained, **mobile-first** web experience. You press *Start*, your
wealth line draws itself across the years like a time-lapse — calm and
climbing — and then, at the journey's midpoint, the market falls 40%. The
animation freezes and asks one question:

> *"The market just fell 40%. The news is screaming. Your friends are selling.
> What do you do?"*

You choose — **Hold · Pause · Sell and buy back · Sell and wait** — the line
resumes along your path next to a faint "ghost" of what staying calm would
have done, and at the finish two numbers count up side by side. One caption
lands the truth (e.g. *"Your one frightened decision cost ₹X. The market
recovered without you."*).

> **Live link:** `https://tishabsatwani-del.github.io/Mutual_Fund/`
> *(one-time setup: repo **Settings → Pages → Source = "GitHub Actions"**, then
> merge to `main` — the included workflow deploys automatically.)*

**How it works (all math is honest and auditable)**

- **Minimal inputs** — SIP (₹5k / ₹10k / ₹25k) and journey length
  (15 / 20 / 30 yrs). The crash is fixed at the midpoint. Confusion is the enemy.
- **Real unit accounting** — every month the SIP buys `units = SIP / NAV`. The
  NAV starts at 100, grows at 1.0%/mo (Direct) or 0.917%/mo (Regular — the
  commission gap), falls to 60% over 3 months at the midpoint, then recovers
  *exactly* to trend by month +18. Selling and rebuying later forfeits units
  for good — and the loss is modelled honestly, never clamped.
- **Five paths, guaranteed ordering** — held-Direct > held-Regular ≈ paused >
  sold-and-rebought > sold-and-waited. Staying invested even ends *slightly
  richer* than a crash-free market, because the months below trend buy cheaper
  units. Every rupee is computed live; nothing is hardcoded.
- **Works offline, no CDN, no backend** — hand-rolled Canvas animation, instant
  load, runs behind any firewall.

Try it locally:

```bash
python -m http.server 8000    # then open http://localhost:8000
node tests/test_simulator.js  # verify the deterministic engine + ordering
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
