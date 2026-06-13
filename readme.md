# Mutual Fund Portfolio Tracker

A small, **dependency-free** Python toolkit for modelling mutual fund
holdings, tracking portfolio value and returns, and running common
investment calculators (lumpsum, SIP, CAGR, XIRR).

Everything uses only the Python standard library, so there is nothing to
install — just clone and run.

---

## 🌐 Live web tool — "Two Doors, One Storm"

A self-contained, **mobile-first**, advanced **Monte Carlo behavioural
investing simulator**. Two people invest the same money, in the same market.
One chose a **Regular** plan (pays ~1%/yr more, but has a *relationship
manager / MD* to call when life hits). One chose **Direct** (pays nothing
extra, but faces every storm alone). The fee gap is small and steady. The
behaviour gap is enormous. The tool dramatises one idea: **the only real
variable is who is beside you when it falls.**

> **Live link:** `https://tishabsatwani-del.github.io/Mutual_Fund/`
> *(one-time setup: repo **Settings → Pages → Source = "GitHub Actions"**, then
> merge to `main` — the included workflow deploys automatically.)*

**Two scenarios, off one engine**

- **The Crash** — *Live it.* Your wealth line (and your friend's, a step
  below, the fee toll widening) climbs the years. At the midpoint a real,
  named crash hits. Your side goes **silent**; her phone **rings** — her RM
  talks her through it. You pick one of four behaviours (**Hold · Pause ·
  Sell & buy back · Sell & wait**); her path plays on its own. Then two
  corpora, two XIRRs, the fee she paid for, and the rupees your one decision
  cost — with a verdict caption that resonates with the book chapter.
- **The Emergency** — *The money, now.* Life demands a large sum fast. Alone,
  fear says *take it all* and the SIP dies in one tap. Her RM says take exactly
  what's needed — liquid first, then a little large-cap, **leave the down
  mid-cap**, pause (don't cancel) the SIP. Watch the gap play to the horizon.
  *Hardest mode:* the emergency lands during a market fall.

**The maths — exact, auditable, never rigged**

- **Real unit-level accounting** — every month `units = SIP / NAV`, value =
  `units × NAV` (+ idle cash). Correct SIP timing (contribution at the start of
  each month). Fees charged as the only difference: Direct net 12%/yr
  (1.000%/mo), Regular net 11%/yr (0.9167%/mo) — the 1%/yr gap, compounded and
  shown in rupees. **XIRR** from the actual monthly cash flows for every
  investor.
- **Monte Carlo** — *10,000 lifetimes.* 1,000–10,000 paths of 240 monthly
  returns from a documented model (mean ≈ 12%/yr, vol ≈ 15–18%/yr) with **fat
  tails** and **volatility clustering** (a two-state calm/stress regime, so deep
  drawdowns arrive in clusters). Output is translated to **plain odds** — *"in
  X of 10,000 futures the calm Direct investor finished ahead"* — never raw
  percentiles, on a fan chart.
- **Honest, not rigged** — across the paths, Direct can finish **above, equal
  to, or below** Regular. You can set *both* investors' behaviour, including the
  case where the guided friend panics and calm Direct wins. The tool never
  claims one door is better — it proves the door was never the point.
- **Real events (illustrative)** — COVID-19 2020 (~−38%), GFC 2008 (~−60%), the
  2022 correction (~−18%), and the 2025–26 storm (~−14%, ending on uncertainty).
  *Based on actual index drawdowns; exact figures vary by index and dates and
  must be locked against real data before shipping.*
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
