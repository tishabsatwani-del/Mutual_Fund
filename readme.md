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

## Live web tool — "Two Doors, One Storm"

A self-contained, **mobile-first**, **behaviour-driven** investing simulator.
Two people invest the same money, in the same market. One chose a **Regular**
plan (a mutual fund distributor, an MFD, invests for her, and the fund pays them
about 1%/yr out of her money — and here her MFD does the job properly; that is
the assumption). One chose **Direct** (invests alone, pays no commission). The
fee gap can be computed; the behaviour gap can only be measured. The tool
dramatises one idea: **the only variable is what holds your hand when it falls
— a person, a rule, or nothing** — and it never tells the reader which door to
take. It puts two numbers side by side and lets them do the sum.

> **Live link:** `https://tishabsatwani-del.github.io/Mutual_Fund/`
>
> The page is a **gate**: the simulator is stored inside it encrypted and opens
> with a reader's access code (the check is client-side; nothing leaves the
> phone). The readable master is kept outside the repo; `tools/two-doors/`
> holds the rebuild script and the engine tests (see its README).

**Setup, in order:** pick the **door** (crash *or* emergency), the **duration**
(10 / 15 / 20 / 25 / 30 years), the **SIP** (₹5,000 to ₹50,000, or any figure
typed from ₹500 to ₹5,00,000 — "50k" and "1.5L" work), the **fee gap** (0.5 /
0.75 / 1.0 / 1.25 / 1.5 points a year; default 1.0 — in 2026 the gap on
actively managed equity schemes averaged about 1.1–1.2 points and ran from
under 0.1 to about 2 points scheme by scheme), then the specific event.

**Two doors, off one engine**

- **The Crash** — *Live it.* You **swear an oath** while the screen is green
  (hold / pause / sell). The market climbs the years; at the midpoint a named
  storm lands — **COVID-19 2020** (peak 14 Jan 2020, trough 23 Mar 2020,
  regained 9 Nov 2020), **the 2008 crisis** (8 Jan 2008 → 27 Oct 2008 → 5 Nov
  2010), **the 2022 correction** (18 Oct 2021 → 17 Jun 2022 → 24 Nov 2022),
  **the 2026 oil war** (5 Jan 2026 → 2 Apr 2026, −16%; recovery *assumed* —
  six months on the market had not regained its January level), or **a crash
  drawn live** (drawn, not history). A **feed** of three to five items from
  fictional outlets arrives on your phone (a family forward, a BREAKING strip,
  a broker-app push, a headline; the word SIMULATION is visible). The storm
  then plays as a **tape** — the fall for about half a minute, the recovery for
  about twenty seconds — with the buttons live throughout: **Hold, Pause the
  SIP, Sell everything, Sell half, Buy the dip** (from a six-instalment cash
  reserve every path holds), **Buy back, Resume**. Every tap is priced at the
  model's price at that moment and stamped with the day and the drawdown
  ("you sold at −22%, day 9"). No tap is a hold, named as doing nothing. Only
  then does a **voice note** from the friend's MFD play — two or three short
  lines in Hindi with English captions, one script per storm, no skip — and
  one question follows: *would this have changed what you did?* The finish
  line shows **three figures** (what you did; what holding would have done on
  the same plan; what the Regular friend finished with), the oath closed in
  one sentence, the cost in years of your own SIP, and a "See the maths" panel
  that prints every tap and every rule.
- **The Emergency** — *The money, now.* The same kind of oath (where will you
  take the cash from?), the corpus you built across three funds, a severity
  chosen as a **share of what you built** (about 30% / 55% / 80%, or "let life
  decide"), a **market backdrop** (calm, or one of the storms; pandemic and war
  bring their own), then the rupee figure lands as the story beat ("you need,
  now: ₹X — about 31% of everything you have"). You raise the cash alone;
  then the MFD's voice note; then the same one question. The steady hand it is
  measured against **does not flinch** — it takes only the need, liquid first,
  and never pauses.

**The maths — exact, auditable, never rigged**

- **The fee is a charge on assets.** Direct grows at exactly 12%/yr (the
  monthly rate is the 12th root). Regular grows at the same rate and is charged
  the gap on assets, accrued daily: the monthly factor is
  `(1 − g/365)^(365/12)`, so a 1.0-point gap gives Regular ≈ 10.9% — the fee
  costs 1.11 points of return because it is charged on assets that keep
  growing. Liquid funds carry a 0.10-point gap whatever the equity gap.
- **Real unit-level accounting** — every month `units = SIP / NAV`, value =
  `units × NAV` (+ cash); a tap inside a month is priced at that moment.
  **XIRR** and **CAGR** are computed from the actual cash flows.
- **One pause convention.** In both doors paused instalments wait in cash at
  4% and go in together on resumption; the "spent instead" variant is printed
  beside it. Idle cash and the reserve earn 4%/yr.
- **"Run it yourself"** — 10,000 seeded futures, calibrated so the *typical*
  (median) calm life compounds at 12%: volatility itself costs about 1.3
  points a year, and the average path is not the typical path. The Axis quiz
  cites the industry-wide study of Indian equity-fund investors, 2003–2022
  (19.1% fund / 13.8% lump-sum / 15.2% SIP).
- **"Your two numbers" — one basis.** The fee on a calm road for your current
  inputs ("if nothing ever happens") beside your nerve, run by run, for the
  same inputs; the self-report decides whether the reading points to a person
  or to a rule with teeth. Never "CERTAIN".
- **Tax** is left out and the panel says why: it cannot change which door
  wins, it makes every sale cost a little more — and switching from Regular to
  Direct is itself a sale.
- **Self-test.** Open the tool with `#selftest` to recompute twenty golden
  figures on the phone, offline. The build prints "as built: ‹date› · source
  ‹commit›" in every maths panel.
- **No emoji, no CDN, no backend, no heartbeat.** Inline SVG icons; a service
  worker keeps the last good copy for a reader with no signal; no alarm tones,
  no red flashing, no screen shake — the tool must never push, so that what it
  measures is you.

> All outputs are illustrative **ranges of possibility, never predictions or
> advice.** Educational tool — not investment advice.

Try it locally:

```bash
python -m http.server 8000    # then open http://localhost:8000
TDOS_MASTER=/path/to/master.html node tools/two-doors/engine.test.js   # verify the engine
```

Files: `index.html` (the gate + encrypted bundle), `sw.js` (offline cache),
`voice/` (recorded clips; drop the nine voice notes in as `voice/notes/<key>.m4a`
— keys `covid gfc corr2022 oilwar2026 drawn icu business pandemic war`; until a
file exists the English captions are read by the device voice),
`tools/two-doors/` (rebuild script, engine tests),
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
