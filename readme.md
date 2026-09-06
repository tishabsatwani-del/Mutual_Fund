# Mutual Fund Portfolio Tracker

> © 2026 Tisha Satwani. All rights reserved. This project, including the
> "Two Doors, One Storm" simulator, is proprietary — no copying, modifying,
> or redistribution without written permission. See the [LICENSE](LICENSE).

A small, **dependency-free** Python toolkit for modelling mutual fund
holdings, tracking portfolio value and returns, and running common
investment calculators (lumpsum, SIP, CAGR, XIRR).

Everything uses only the Python standard library, so there is nothing to
install — just clone and run.

---

## 🌐 Live web tool — "Two Doors, One Storm"

A self-contained, **mobile-first**, **behaviour-driven** investing simulator.
Two people invest the same money, in the same market. One chose a **Regular**
plan (a mutual fund distributor, an MFD, invests for her, and the fund pays them
about 1%/yr out of her money). One chose **Direct** (invests alone, pays no
commission). The fee gap is certain and computed; the behaviour gap is uncertain
and measured. The tool dramatises one idea: **the only variable is what holds
your hand when it falls — a person, a rule, or nothing** — and it never tells
the reader which door to take. It puts two numbers side by side and lets them
do the sum.

> **Live link:** `https://tishabsatwani-del.github.io/Mutual_Fund/`
> *(one-time setup: repo **Settings → Pages → Source = "GitHub Actions"**, then
> merge to `main` — the included workflow deploys automatically.)*
>
> The page is a **gate**: the simulator is stored inside it encrypted and opens
> with a reader's access code. The readable master is kept outside the repo;
> `tools/two-doors/` holds the rebuild script and the engine tests
> (see its README).

**Setup, in order:** pick the **door** (crash *or* emergency), the **duration**
(10 / 15 / 20 / 25 / 30 years), the **SIP** (₹5,000 / ₹10,000 / ₹20,000 /
₹25,000 / ₹50,000, or any figure typed from ₹500 to ₹5,00,000), the **fee gap**
(0.5 / 0.75 / 1.0 / 1.25 points a year; default 1.0), then the specific event.
A named crash hits at the midpoint of the horizon and the month is printed in
the maths panel; the "drawn live" crash is drawn from stated ranges.

**Two doors, off one engine**

- **The Crash** — *Live it.* You **swear an oath** while the screen is green
  (hold / pause / sell). The market climbs the years on a candlestick chart. At
  the crash month a real, named crash hits — **COVID-19 2020, the 2008 crisis,
  the 2022 correction, a war/geopolitical shock shaped on the Kargil scare of
  1999, or one drawn live** — and your side goes **silent** (a big −X% and
  `₹before ▸ ₹after`, plus the line explaining why the corpus fell less than the
  market: the instalments kept buying). One card shows the feed of that week.
  You pick one of four behaviours, alone; then her MFD's one sentence plays.
  The finish line shows **three figures**: what you did, what holding would have
  done on the same plan, and what the Regular friend finished with — the
  behaviour gap and the fee gap as two separate numbers — with the oath closed
  in one sentence ("You swore to hold. You sold."), the cost in years of your
  own SIP, and a "See the maths" panel that prints every rule the engine used.
- **The Emergency** — *The money, now.* The same kind of oath (where will you
  take the cash from?), then the corpus you built across three funds; then life
  strikes — **hospitalisation/ICU, a business loss, a pandemic, or war** — at a
  **severity you choose**, each printed in rupees on the size screen. You decide
  how to raise the cash; then her MFD makes her call (liquid first, then the
  fund that has fallen least). The same three-figure finish. When the need is
  bigger than everything built, the tool says so; when you redeem everything,
  the second decision (never going back) is named separately from the first.

**The maths — exact, auditable, never rigged**

- **Correct rates.** Returns are stored so the *effective annual CAGR* is
  **exactly 12% (Direct) / 12% minus the chosen gap (Regular)** — the monthly
  rate is the 12th root, not a naive 1%/month. The fee is a multiplicative
  monthly drag.
- **Real unit-level accounting** — every month `units = SIP / NAV`, value =
  `units × NAV` (+ idle cash), with start-of-month SIP timing. **XIRR**
  (Newton–Raphson + bisection) and **CAGR** computed from the actual cash flows.
- **Every rule printed.** A sale happens at the bottom, the worst possible day;
  "sold, bought back" re-enters the month the market regains its old level;
  "sold and waited" a year after that; a pause stops instalments at the crash
  and restarts a year after the market regains its old level, the skipped money
  waiting in cash and going in together; idle cash earns 4%/yr in a bank — in
  both doors and in the ten thousand futures. Taxes and exit loads are not
  modelled; both make every sale worse than shown. Every figure is tagged
  COMPUTED or ASSUMPTION.
- **"Run it yourself" — the interactive 10,000-life experiment.** A seeded
  Monte Carlo (10,000 paths; mean ≈ 12%/yr, vol ≈ 15–18%/yr, fat tails +
  clustered crashes; the same inputs always give the same lives), staged as a
  thing you do: **(1)** try to control one thing — every dial but *your own
  nerve* is locked; **(2)** guess what the average investor earned in funds
  that delivered 19.1%/yr, then meet the real figure (Axis Mutual Fund's study
  of its own investors, 2003–2022: 13.8% lump-sum, 15.2% SIP); **(3)** **pull
  the lever** STAY vs RUN; **(4)** decide whether to reach for a steady hand —
  which some pay 1%/yr for, some write on a card, some have neither;
  **(5)** turn the gap into years of your life, in today's money (inflation
  assumed 6%); then the seal — the door (the fee, both holding) vs the lever.
  The footnote prints the run rule, the median convention, the SIP and the seed.
- **"Your two numbers" — the close.** The fee gap over your horizon (certain)
  beside your nerve gap (the sum of what your own choices cost across the runs
  you played), the oath-versus-act record ("Three storms. Three oaths to hold.
  One hold."), one question — who or what stops your hand? — and a reading
  for each answer that states the arithmetic and stops short of a verdict.
- **Honest, not rigged** — across paths, Direct can finish **above, equal to,
  or below** Regular. In every named crash a pause costs less than the fee gap
  and a sale costs more: Direct buys you one flinch, a pause, not a sale. The
  tool never claims one plan is better, and never claims a commission buys a
  phone call.
- **Real events (illustrative)** — COVID-19 2020 (~−38%), 2008 GFC (~−60%), the
  2022 correction (~−18%), a war/geopolitical shock (~−14%, deeper and slower
  than Kargil 1999 on purpose). *Based on actual index drawdowns; exact figures
  vary by index and dates.*
- **Works offline, no CDN, no backend** — hand-rolled Canvas, instant load, a
  service worker keeps the last good copy for a reader with no signal.

> All outputs are illustrative **ranges of possibility, never predictions or
> advice.** Educational tool — not investment advice.

Try it locally:

```bash
python -m http.server 8000    # then open http://localhost:8000
TDOS_MASTER=/path/to/master.html node tools/two-doors/engine.test.js   # verify the engine
```

Files: `index.html` (the gate + encrypted bundle), `sw.js` (offline cache),
`voice/` (recorded clips), `tools/two-doors/` (rebuild script, engine tests),
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
