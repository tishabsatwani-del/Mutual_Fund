# FinGuardian AI — Autonomous Wealth Lifecycle Guardian

> An interactive prototype of a **zero-ops, 100% serverless** "financial
> bodyguard" for mutual-fund investors and their families. Traditional fintech
> stops at onboarding and transactions — FinGuardian guards money *after* the
> buy button: behavioural blind spots, operational lock-ups, regulatory drift,
> and the bureaucratic ordeal of inheritance.

This folder is **fully self-contained** and completely independent of the
"Two Doors, One Storm" simulator at the repository root — it shares no files,
styles, or globals with it.

## Run it

```bash
# from the repo root
python -m http.server 8000
# then open  http://localhost:8000/finguardian/
```

When the repo is deployed to GitHub Pages (the root workflow publishes the whole
repo), this app is live at `…/Mutual_Fund/finguardian/`.

## The eight pillars (each is a working demo)

| | Pillar | What the demo does |
|---|---|---|
| **A** | Family Wealth Cloud & Dynamic Consent | Household mapped on one DynamoDB partition (`FamilyID` PK / `UserID` SK); cross-member viewing requires a Step Functions consent handshake; moving another member's assets is structurally refused. |
| **B** | AI Regulatory Watchdog | Nightly EventBridge scan → Bedrock parses a circular into a structured config diff → admin approves → live config updates with **no redeploy**. |
| **C** | KYC Health Watchdog | Polls KRA APIs (CVL/NDML), flags a looming `Hold` early, sends a one-tap re-verify link so SIPs never freeze. |
| **D** | Legacy Vault & Dead Man's Switch | 180 days of silence → 15-day grace window with 3 check-ins → pre-filled transmission paperwork (Form T3, indemnity bond, AMC letters) for the nominee. |
| **E** | Buy-the-Dip & Dynamic De-risking | 4 PM IST index check; a 4%+ fall from the 52-week high triggers an STP into equity; goals glide equity→debt in their final 2 years. |
| **F** | Hidden Commission Scanner | Bedrock parses a CAS, isolates Regular plans, projects the 20-year compounding cost vs the Direct twin, offers a tax-aware switch. |
| **G** | Emergency LAMF | Pledge units for an instant overdraft; compares the interest cost against the true cost of redeeming (lost growth + tax). |
| **H** | Anti-Panic Shield | A panic-sell in a steep drop triggers a mandatory 24-hour cooling-off period with the recovery history of comparable crashes. |

## What's real vs simulated

- **Real & auditable** — the finance maths in `app.js`: exact monthly-compounded
  SIP / lump-sum future value (`sipFV`, `lumpFV`, `annualToMonthly`), the
  commission-drag projection, the LAMF pledge-vs-redeem comparison, the
  de-risking glide path, and the buy-the-dip trigger. Every on-screen figure is
  computed from the inputs — nothing is hard-coded as a "result".
- **Simulated** — all AWS service calls, KRA polling, Bedrock parsing, and
  banking-partner APIs are realistic mock flows. There is no live backend.

## Files

```
finguardian/
  index.html        # shell + nav + footer (+ full no-JS description)
  styles.css        # dark, premium, mobile-first theme (namespaced under #app)
  app.js            # router + finance engine + all 8 pillar demos + arch view
  ARCHITECTURE.md   # the serverless reference design, in depth
  README.md         # this file
```

## Architecture

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full serverless reference
design — infrastructure layers, public/private network isolation, the household
DynamoDB model, the Step Functions consent and inactivity workflows, and the
compliance guardrails (ap-south-1 localisation, AES-256 KMS key isolation,
immutable CloudTrail audit).

---

All outputs are illustrative ranges of possibility — never predictions or
advice. **Educational tool — not investment advice.**
