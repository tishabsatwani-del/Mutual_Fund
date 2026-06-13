# Mutual Fund Portfolio Tracker

A small, **dependency-free** Python toolkit for modelling mutual fund
holdings, tracking portfolio value and returns, and running common
investment calculators (lumpsum, SIP, CAGR, XIRR).

Everything uses only the Python standard library, so there is nothing to
install — just clone and run.

---

## 🌐 Live web tool — "The Cost of Panic" SIP Crash Simulator

A zero-dependency, **shareable** web simulator built on top of this library's
math. Same SIP on every line, one market crash — **only your reaction to it
changes** — and watch how panic-selling, staying out, or a quietly leaking
expense ratio hands back crores.

> **Live link:** `https://tishabsatwani-del.github.io/Mutual_Fund/`

**Turn the link on (one-time, ~10 seconds — repo owner only):**

GitHub Pages must be switched on once before the public link works. Pick either:

1. **GitHub Actions (recommended).** Repo **Settings → Pages → Build and
   deployment → Source → "GitHub Actions"**. The bundled
   `.github/workflows/pages.yml` then publishes the site on every push to
   `main` (or run it manually from the **Actions** tab → *Deploy to GitHub
   Pages* → *Run workflow*).
2. **Deploy from a branch (zero-config).** Repo **Settings → Pages → Source →
   "Deploy from a branch" → `main` / `/ (root)`**. The whole app is plain
   static files at the repo root (with `.nojekyll`), so it serves as-is with no
   workflow at all.

Either way, the site appears at the link above within a minute and is then
clickable from anywhere on Earth. *(Until Pages is enabled, the Actions deploy
job is blocked at the `github-pages` environment gate — a settings step, not a
code error.)*

**Why it's different**

- **Behavior-gap framing** — it quantifies the *rupee cost of emotion* (panic
  cost, expense-ratio toll), not just "money grows."
- **Unit-accounting engine** — every reaction buys units at that month's NAV,
  so selling and buying back later *naturally* forfeits the rebound.
- **Fully shareable & reproducible** — every input is encoded in the URL hash,
  so a link reproduces the *exact* scenario the sender saw, anywhere on Earth.
- **Works offline, no CDN, no backend** — hand-rolled Canvas charts, instant
  load, runs behind any firewall.
- **Deterministic + Monte-Carlo** modes, real-event presets (2008, COVID,
  Dot-com), and a global currency switcher (₹ lakh/crore, $, €, £, ¥…).

Try it locally:

```bash
python -m http.server 8000   # then open http://localhost:8000
node tests/test_simulator.js  # verify the simulation engine
```

Files: `index.html`, `styles.css`, `app.js` (engine + charts + URL state),
`.github/workflows/pages.yml` (auto-deploy).

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
