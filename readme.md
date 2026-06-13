# Mutual Fund Portfolio Tracker

A small, **dependency-free** Python toolkit for modelling mutual fund
holdings, tracking portfolio value and returns, and running common
investment calculators (lumpsum, SIP, CAGR, XIRR).

Everything uses only the Python standard library, so there is nothing to
install — just clone and run.

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
