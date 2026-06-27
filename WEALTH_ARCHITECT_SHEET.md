# The Wealth Architect — Build Guide & Recommendation

> A free, zero-maintenance financial planning workbook to ship with the book.
> Pure native Google Sheets / Excel math. **No Apps Script. No API. No keys.
> Nothing that can break.**

---

## PART 0 — The decision: which of your two ideas to build

You shortlisted two ideas. Here they are by their real names:

- **Idea A — "Live NAV Tracker"**: a Google Sheet that pulls live NAV from
  `mfapi.in` via a custom Apps Script, plus a Gemini AI review button.
- **Idea B — "Wealth Architecture Simulator"**: a pure-formula planning engine
  (step-up SIP, glidepath, post-tax, fund audit) with **no script and no API**.

**Recommendation: build Idea B. Do not build Idea A as your core tool.**

This isn't a close call, and the reason is your own non-negotiable requirement:
*"build it once, works for years, zero maintenance, never shows errors, for
thousands of readers who clone it."* Score the two ideas against that one rule:

| Requirement you set | Idea A (live NAV + Gemini) | Idea B (pure formulas) |
|---|---|---|
| Works for years untouched | ❌ Depends on `mfapi.in`, a free service run by **one person**. The day it goes down or rate-limits, every reader's sheet shows `#ERROR`. You can't fix thousands of clones. | ✅ Native math has no upstream. It cannot go offline. |
| Zero authorization friction | ❌ Every clone must click through a scary Google OAuth consent screen to run *your* script. Many readers will bounce here. | ✅ Clone → use. No permission prompt, ever. |
| No paid / no-key | ⚠️ The Gemini "free" key is **per-user** — you cannot ship your own key to thousands (quota dies instantly + key gets abused). So each reader must make an AI Studio account and paste a key. That is friction *and* a support burden. | ✅ Nothing to sign up for. |
| Never crashes | ❌ Apps Script **custom functions cannot call external URLs** (they need an auth scope custom functions aren't allowed). You'd be forced into a menu/trigger that hits daily `UrlFetchApp` quotas the moment a reader has many rows. | ✅ No quota exists to hit. |
| Actually differentiated / "worth ₹50k" | ❌ Live tracking is a **commodity** — Groww, Kuvera, Zerodha Coin, ET Money all do it free, in real time, better than a sheet ever can. A reader's reaction is "my app already does this." | ✅ Goal-based step-up planning, institutional glidepath, and **post-tax** truth are exactly what fee-charging planners sell. This feels like a ₹50k advisory model, not a price ticker. |

Idea A is **both more fragile and less valuable**. It competes with free apps on
their home turf (live data) while carrying every maintenance risk you swore to
avoid. Idea B owns ground those apps *don't* touch — it answers *"am I on track,
and what will I actually keep after tax?"* — with zero moving parts.

You already proved you believe this: your existing "Two Doors" tool is
deliberately **"no backend, no external data, works offline."** Build the new
tool on the same philosophy.

### What about the live NAV you liked?
Keep the *feeling*, drop the *fragility*. The build below includes a **manual
NAV tracker** tab (the user types/pastes NAV occasionally — 10 seconds, never
breaks) and an **optional, clearly-labelled "advanced users only" script** for
those who want auto-NAV and accept it can break. The core tool you ship and
promise stays 100% script-free.

### What about the Gemini AI review?
Replicate 80% of the "wow, it understands me" effect with **0% maintenance**
using a native formula advisor (see Module 7). It reads the reader's own numbers
and writes a tailored 3–4 line review — no key, no account, no API. If you still
want true generative AI later, ship it as an optional add-on, never the core.

---

## PART 1 — Architecture overview

One Google Sheet, six tabs. Build top-to-bottom; later tabs reference earlier
ones by **named range**, so you never hardcode a rate twice.

| Tab | Purpose | Breakable? |
|---|---|---|
| `1. Control Center` | Global assumptions (inflation, returns, tax) + master verdict | No |
| `2. Goal Planner` | Step-up SIP engine — what to invest to hit a goal | No |
| `3. Engine` *(hidden)* | 30-year compounding ledger feeding the planner | No |
| `4. Portfolio & Glidepath` | Holdings, live %, glidepath directive, rebalancer alert | No |
| `5. Fund Audit & Post-Tax` | Alpha-leakage audit + true in-hand wealth | No |
| `6. NAV Tracker` *(optional)* | Manual NAV holdings + XIRR | No (manual) |

**One-time setup before any formula:** create these **named ranges**
(`Data → Named ranges`). Every formula references these names, so updating a
single cell recalibrates the whole workbook — this is your "self-reboots when
tax law changes" requirement.

| Name | Points to | Default (India, 2026) |
|---|---|---|
| `Inflation` | `'1. Control Center'!B4` | `6%` |
| `EquityReturn` | `'1. Control Center'!B5` | `12%` |
| `DebtReturn` | `'1. Control Center'!B6` | `7%` |
| `LTCGRate` | `'1. Control Center'!B7` | `12.5%` |
| `LTCGFree` | `'1. Control Center'!B8` | `125000` |

> Defaults reflect post-Budget-2024 equity LTCG (12.5%, ₹1.25 lakh exempt).
> When the law changes, the reader edits **one cell** — nothing else.

---

## PART 2 — Build each tab

### MODULE 1 — `1. Control Center` (global assumptions)

Enter labels in column A, values in column B:

| Cell | Content |
|---|---|
| `A1` | `THE WEALTH ARCHITECT` (big, bold — your brand header) |
| `A3` | `GLOBAL ASSUMPTIONS — edit these, everything else recalculates` |
| `A4` | `Inflation rate (annual)` → `B4`: `6%` |
| `A5` | `Expected equity return (annual)` → `B5`: `12%` |
| `A6` | `Expected debt / liquid return (annual)` → `B6`: `7%` |
| `A7` | `Equity LTCG tax rate` → `B7`: `12.5%` |
| `A8` | `LTCG tax-free threshold per year (₹)` → `B8`: `125000` |

Format `B4:B7` as percent, `B8` as currency. Now create the five named ranges
from Part 1. **Do this before building anything else.**

---

### MODULE 3 — `3. Engine` (hidden 30-year ledger)

Build this *before* the Planner (the Planner divides by it). Headers in row 1:
`A1` = `Year`, `B1` = `Step-Up Growth Factor`, `C1` = `Compounding Factor`.

`A2`: `1`, `A3`: `2` … fill down to `A31`: `30`. Then:

**`B2`** (drag down to `B31`):
```
=IF(A2<='2. Goal Planner'!$B$5, (1+'2. Goal Planner'!$B$6)^(A2-1), 0)
```
This is the step-up multiplier: Year 1 = ×1, and each later year scales up by
the reader's annual step-up % — but only for years inside their horizon.

**`C2`** (drag down to `C31`):
```
=IF(A2<='2. Goal Planner'!$B$5,
    (1+EquityReturn/12)^('2. Goal Planner'!$B$5*12 - A2*12)
    * ((1+EquityReturn/12)^12 - 1)/(EquityReturn/12),
   0)
```
This is the exact future-value factor for one year's twelve monthly SIPs,
compounded at the equity rate for every remaining month until the target date.
(Month-end SIP timing; mathematically exact — it reduces to the standard
annuity FV when step-up = 0%.)

Right-click the tab → **Hide sheet**. Readers never see it; it just feeds the
Planner.

---

### MODULE 2 — `2. Goal Planner` (step-up SIP engine)

Inputs (label in A, value in B):

| Cell | Label | Example value |
|---|---|---|
| `B3` | Goal name | `Child's college` |
| `B4` | Current cost of goal today (₹) | `2500000` |
| `B5` | Years left to target | `15` |
| `B6` | Annual SIP step-up you can manage (%) | `10%` |

Outputs:

**`B8` — Inflation-adjusted future cost of the goal:**
```
=B4*(1+Inflation)^B5
```

**`B9` — Required Year-1 monthly SIP (the headline number):**
```
=B8/SUMPRODUCT('3. Engine'!B2:B31, '3. Engine'!C2:C31)
```

**`B10` — A flat (non-step-up) SIP for comparison, to show the saving:**
```
=B8*(EquityReturn/12)/((1+EquityReturn/12)^(B5*12)-1)
```

**`B11` — "You start ₹X/month lower with step-up" (the selling line):**
```
="Step-up lets you START ₹"&TEXT(B10-B9,"#,##0")&"/month lower than a flat SIP — "&TEXT((B10-B9)/B10,"0%")&" easier to begin."
```

Why this beats a normal SIP calculator: it computes a **rising** contribution
(matched to salary growth), so the Year-1 number is dramatically lower — which
is exactly the "lower the barrier to entry" effect that makes a reader feel the
tool is smarter than the free apps.

---

### MODULE 3b — `4. Portfolio & Glidepath`

**Holdings input** (label A, value B):

| Cell | Label | Example |
|---|---|---|
| `B3` | Core equity assets (₹) | `800000` |
| `B4` | Debt / liquid safe assets (₹) | `150000` |
| `B5` | Gold assets (₹) | `50000` |

**Computed allocation:**
```
B6  Total portfolio       =SUM(B3:B5)
B7  Equity %              =B3/$B$6
B8  Debt / Cash %         =B4/$B$6
B9  Gold %                =B5/$B$6
```
Format `B7:B9` as percent. (This is your "Dashboard" dynamic distribution.)

**The Glidepath Directive — `B11`** (institutional, timeline-driven; reads the
Planner's "years left"):
```
=IFS(
  '2. Goal Planner'!B5>7,
    "🟢 LONG RUNWAY ("&'2. Goal Planner'!B5&" yrs): Ignore the noise. Keep equity compounding — volatility is your friend this far out.",
  AND('2. Goal Planner'!B5>=3, '2. Goal Planner'!B5<=7),
    "🟡 TRANSITION ("&'2. Goal Planner'!B5&" yrs): Stop adding high-risk/sectoral bets. Route new money into hybrid/balanced avenues.",
  '2. Goal Planner'!B5<3,
    "🔴 DE-RISK NOW ("&'2. Goal Planner'!B5&" yrs): Systematically move equity into debt/liquid to lock gains and dodge sequence-of-returns risk."
)
```

**The Smart Rebalancer Alert.** Add a target equity weight:
`A13` = `Target equity %`, `B13` = `60%`. Then **`B14`**:
```
=IFS(
  B7-B13 > 0.05, "⚠️ MARKET HIGH — BOOK PROFIT: Equity is "&TEXT(B7-B13,"0%")&" above target. Trim equity, top up debt.",
  B13-B7 > 0.05, "🔵 BUYING ZONE: Equity is "&TEXT(B13-B7,"0%")&" below target. Deploy cash / add to equity.",
  TRUE,           "✅ BALANCED: You're within 5% of target. Do nothing — discipline wins."
)
```
This is your dynamic conditional alert: it changes the message the moment the
portfolio drifts past the 5% band.

---

### MODULE 4 — `5. Fund Audit & Post-Tax`

**Alpha Leakage Audit Grid.** Headers row 2:
`A2` Fund | `B2` 3-yr return | `C2` Benchmark return | `D2` Net alpha | `E2` Verdict.

From row 3 down, reader enters A/B/C. Then:
```
D3  =B3-C3
E3  =IF(D3<0,
       "🔴 LEAKING: trailing benchmark by "&TEXT(ABS(D3),"0.0%")&" — a low-cost index fund likely beats this.",
       "🟢 EARNING ITS FEE: beating benchmark by "&TEXT(D3,"0.0%")&".")
```
Drag `D3:E3` down for as many funds as they hold.

**Post-Tax Wealth Reality Simulator** (label A, value B):
```
A12  Projected maturity value (₹)     B12  (reader enters, or = Planner B8)
A13  Total principal invested (₹)     B13  (reader enters)
A14  Capital gains                    B14  =B12-B13
A15  Taxable gains (after exemption)  B15  =MAX(0, B14-LTCGFree)
A16  Estimated LTCG tax               B16  =B15*LTCGRate
A17  TRUE in-hand net wealth          B17  =B12-B16
```
**The warning string — `B18`:**
```
="⚠️ Plan your life around ₹"&TEXT(B17,"#,##0")&", NOT ₹"&TEXT(B12,"#,##0")&". The taxman takes ₹"&TEXT(B16,"#,##0")&". Every lifestyle decision should anchor to the post-tax figure."
```
This is the module that makes a reader gasp — almost no free app shows the
*after-tax* number, and it's the only one that's real.

---

### MODULE 6 — `6. NAV Tracker` (optional, manual, unbreakable) + XIRR

A simple holdings table the reader updates by pasting NAVs occasionally. Headers
row 2: `Fund | Units | Buy NAV | Current NAV | Invested | Live Value | P/L`.
```
E3 (Invested)    =B3*C3
F3 (Live value)  =B3*D3
G3 (P/L)         =F3-E3
```
Drag down. Totals at the bottom with `SUM`. This is your "My Portfolio" tab —
live value, invested value, profit/loss — with **zero** dependency.

**XIRR setup (exact return on dated, irregular cash flows).** On the side, two
columns — dates and amounts. **Investments are negative, the current/redeemed
value is positive and dated today:**
```
 Date         Cash flow
 2024-01-01   -50000      ← SIP/lumpsum out (negative)
 2024-06-01   -50000
 2025-01-01   -50000
 =TODAY()     =F-total    ← current value, positive, dated today
```
Then:
```
=XIRR(amounts_range, dates_range)
```
e.g. `=XIRR(J3:J20, I3:I20)`. XIRR handles both SIP and lumpsum automatically —
because it works off actual dated flows, irregular SIP dates and one-off lumpsums
mix freely in the same column. Format the result cell as percent.

---

### MODULE 7 — Native "AI" review (the Gemini replacement)

Put this on the Control Center as the master verdict cell (e.g. a big merged
cell, `D3`). It reads the reader's own numbers and writes a tailored review —
**no API, no key, no script, nothing to break:**
```
="📋 YOUR REVIEW: To reach '"&'2. Goal Planner'!B3&"' you need ₹"
&TEXT('2. Goal Planner'!B9,"#,##0")&"/month (stepping up "&TEXT('2. Goal Planner'!B6,"0%")
&"/yr). "&'4. Portfolio & Glidepath'!B14&" "&'4. Portfolio & Glidepath'!B11
&" Remember: your real, spendable corpus after tax is ₹"&TEXT('5. Fund Audit & Post-Tax'!B17,"#,##0")&"."
```
It restates their goal, their required SIP, their rebalancer signal, their
glidepath stage, and their post-tax reality in 3–4 flowing lines that change as
their inputs change. Readers will swear it's AI.

---

## PART 3 — Making it bulletproof (the "never shows errors" layer)

Wrap any cell a reader could leave blank (causing `#DIV/0!` or `#ERROR`) so the
sheet *never* shows red. Pattern:
```
=IFERROR( <your formula> , "— enter your numbers above —" )
```
Apply to: `Goal Planner!B9` (blank horizon → div/0), all allocation `%` cells
(empty portfolio → div/0), and the XIRR cell (XIRR needs at least one negative
and one positive flow). Example:
```
B9: =IFERROR(B8/SUMPRODUCT('3. Engine'!B2:B31,'3. Engine'!C2:C31), "Enter years & step-up")
```
This single habit is what delivers your "never crash, no errors, ever" promise.

**Protect the formulas from accidental deletion** by thousands of readers:
`Data → Protect sheets and ranges` → protect every computed cell, leave only the
blue input cells editable. Colour input cells (e.g. light blue) and lock
everything else so a reader literally cannot break it.

---

## PART 4 — Shipping it: the auto copy-link for readers

This is how a reader gets their **own private copy** in one click — you never
touch their data, they can't touch your master.

1. Finish and test the master sheet on your own account.
2. `Share → General access → Anyone with the link → Viewer`.
3. Copy the normal share URL. It ends with `/edit?usp=sharing` (or `/edit#gid=0`).
4. **Change the ending `/edit...` to `/copy`.** That's the whole trick:
   ```
   https://docs.google.com/spreadsheets/d/FILE_ID/copy
   ```
5. Put **that** `/copy` link in your book / QR code. When a reader clicks it,
   Google shows a "Make a copy?" button → they get a private, fully-working,
   independent clone in their own Drive. Your master is never affected, and
   because there's no script, there's **no authorization prompt** — it just works.

> Tip: shorten the `/copy` link (Bitly / your domain) and print it as a QR code
> on the book's tool page. That's your one-tap, zero-friction distribution.

---

## PART 5 — The optional, "advanced users only" live-NAV script

Ship this **separately**, clearly fenced off, never as part of the core promise.
It auto-fills NAV from the free AMFI mirror. Be honest in the book that *this one
optional feature* can break if the free service changes, and needs a one-time
permission click.

```javascript
/**
 * OPTIONAL auto-NAV. Reads only the LATEST nav (data[0].nav) so it stays fast
 * even though AMFI history is huge. Menu-driven (custom functions cannot fetch
 * URLs). Put scheme codes in column A of a "NAV Tracker" tab; NAV lands in B.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💹 Update NAV')
    .addItem('Refresh all NAVs', 'refreshNAV')
    .addToUi();
}

function refreshNAV() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('6. NAV Tracker');
  const codes = sh.getRange('A3:A50').getValues();         // scheme codes
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i][0];
    if (!code) continue;
    try {
      const res  = UrlFetchApp.fetch('https://api.mfapi.in/mf/' + code + '/latest',
                                     { muteHttpExceptions: true });
      const data = JSON.parse(res.getContentText()).data;  // read ONLY latest
      if (data && data[0]) sh.getRange(i + 3, 4).setValue(parseFloat(data[0].nav)); // col D
    } catch (e) { /* leave old NAV; never crash the sheet */ }
  }
  SpreadsheetApp.getActiveSpreadsheet().toast('NAV updated.');
}
```
Notes that make it safe: it hits the `/latest` endpoint (tiny payload, never the
full history), wraps every fetch in `try/catch` so one bad code can't crash the
run, and is **menu-triggered** (no per-row quota storm). Even so — this is the
*one* part with an upstream dependency, so it stays optional.

---

## TL;DR

- **Build Idea B.** Idea A breaks the exact promise you're making to readers.
- Ship it **100% formula-based** — no script, no API, no key in the core tool.
- Recreate the live-NAV and AI "wow" safely: **manual NAV + native formula
  advisor**; offer auto-NAV and real AI only as fenced-off optional extras.
- Distribute with a **`/copy` link + QR code** → one-tap private clone, no
  permission prompt, nothing to maintain, works for years.

This is the version that genuinely feels like a ₹50k advisory engine *and*
survives thousands of readers untouched — which is the whole brief.
