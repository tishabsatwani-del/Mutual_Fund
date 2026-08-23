# The Simulator — engines, data layer and state system

Build Specification v2. This directory holds the parts the spec says to build
first: *"Build engines before UI; pass all Section 17 fixtures headlessly first,
including the Module A state fixtures"* (§16.5). No interface is written yet, on
purpose.

The live v1 tool at `/Mutual_Fund/tool/` is untouched and still the thing readers
reach. Nothing here is wired to it.

## What is here

| File | What it is |
|---|---|
| `engines.js` | The two calculation engines: XIRR (§9.3) and rolling returns (§8.2), plus the date arithmetic they share |
| `schemes.js` | The data contract of §5.2, the family grouping of §5.3, and the plan/option parser of §5.4 |
| `position.js` | Module A's six computations, §7.2 steps a–f, with the §7.6 guards |
| `states.js` | The state evaluator of §7.3, as a pure function |
| `states.json` | Thresholds and the next-step mapping. Numbers and identifiers only |
| `copy.js` | The three copy rules of §13, as a lint |
| `copy.json` | The slot inventory with character budgets. Every string empty, by design |
| `access.js` | The data access layer of §5.1, §5.3 and §5.5: the chain, the failover, the caches, the queue |
| `cache.js` | The on-device cache of §5.5 — IndexedDB in a browser, memory everywhere else |
| `providers/contract.js` | The one interface every provider is reached through, and the validation that decides what "malformed" means |
| `providers/mfapi.js` | Provider 1, api.mfapi.in |
| `providers/tigzig.js` | Provider 2, TIGZIG MFPRO API — endpoint shapes provisional, see below |
| `providers/worker.js` | Provider 3, the Cloudflare Worker — holds its place, deliberately not built |
| `tests/fixtures.test.js` | §17 acceptance criteria 1–9 |
| `tests/copy.test.js` | §13 and §16.8 |
| `tests/access.test.js` | §5.1, §5.3, §5.5 and the criterion 12 drill |
| `tests/idb.test.js` | The IndexedDB half of §5.5, in real Chromium |

```
node sim/tests/fixtures.test.js     # 97 checks
node sim/tests/copy.test.js         # 27 checks
node sim/tests/access.test.js       # 47 checks
python3 -m http.server 8781 &       # tests/idb.test.js needs an origin
node sim/tests/idb.test.js          # 11 checks
```

## The access layer

Everything the app knows about data arrives through `access.js`. Adapters never
call `fetch`: they are handed a transport, which is what keeps the 8-second
timeout, the failure classification and the failover policy in one file instead
of three, and what lets the whole chain be tested against canned bodies — the
same mechanism the criterion 12 drill uses in the browser, by blocking providers
at the layer rather than at the firewall.

```
access.block('mfapi'); access.block('tigzig');   // the drill
access.state()                                    // which provider answered, and why the others did not
```

### Judgment calls in the chain

**A 404 is an answer, not a failure.** §5.1 says a provider that "errors, times
out, or returns malformed data is skipped for the rest of the session". Read
strictly, that blacklists a provider for correctly answering *no such scheme* —
one bad code would burn the chain for the whole session. So a reply that is a
valid answer meaning "not here" (404, 400, 410) moves the chain on without
marking the provider unhealthy. Network errors, timeouts, 5xx and malformed
payloads all skip the provider exactly as written.

**One in-flight fetch per scheme.** Module A asks for the fund and its proxy,
and Module B may ask for the same fund moments later. Concurrent callers for one
scheme share a single request. §5.5 asks integrators to respect rate limiting,
and the cheapest request is the one never sent.

**The TTL day is the visitor's day, not UTC's.** AMFI publishes a NAV late in
the IST evening. Stamping the cache in UTC would call yesterday's copy fresh for
anyone opening the app before about 5:30 am IST, hiding the NAV that had already
been published. The stamp uses local date parts, and the suite pins this by
running the same instant under `TZ=UTC` and `TZ=Asia/Kolkata`.

**The cache fails closed, never open.** An IndexedDB request that neither
succeeds nor errors — blocked by another tab holding an older version, or a
browser whose `result` getter raises instead of returning — would leave a promise
pending forever, and a pending cache read is a page that never finishes loading.
Every branch settles. Reaching for the global is itself guarded, because a
browser told to block site data raises `SecurityError` from the `indexedDB`
getter, so even `typeof indexedDB` is not a safe question. Anything going wrong
means the memory store and a network call. §14 says the app never white-screens;
this is where that is won or lost, and `tests/idb.test.js` runs both hostile
browsers.

### Provider status

| Provider | State |
|---|---|
| 1 · api.mfapi.in | Written against its documented shapes. `verified: false` until §16.2's live check of CORS headers, rate-limit behaviour and date format |
| 2 · TIGZIG MFPRO API | Written, but §5.1 says *"confirm exact endpoint shapes from its live documentation at build time; do not hardcode from this spec"*. The paths and payload locations sit in one `ENDPOINTS` block at the top of the file; confirming the live docs should be an edit to that block and nothing else. Then run `tests/access.test.js` — the conformance harness is what proves the adapter, and it is the same harness provider 1 passes |
| 3 · own Cloudflare Worker | Not built. AMFI's old NAV download format retires **28 August 2026**, and both §5.1 and the author's instruction say to build the parser against the new format inspected live. The adapter exists, holds its place in the chain, and refuses with a reason the layer understands, so it is skipped like any unavailable provider |

No adapter claims `verified: true`, and a fixture asserts that none does. Nothing
should flip that flag except a person who has actually looked at the live
responses.

## Runbook (§15)

| Event | What happens | What anyone has to do |
|---|---|---|
| mfapi.in slow, down or retired | The layer times out at 8 s or catches the error, skips it for the session, and provider 2 answers | Nothing |
| All public mirrors gone | The Worker serves directly from AMFI | Nothing — once the Worker is built |
| AMFI changes its file format | Provider 3 only; providers 1–2 usually adapt first | One small Worker update. This is the 28 Aug 2026 case |
| A provider renames a field | The adapters try several spellings before giving up; a rename that defeats them makes the reply malformed, which fails over rather than producing a wrong number | Edit that adapter's mapping; run `tests/access.test.js` |
| SEBI redraws fund categories | Unmapped categories degrade to fund-only statistics | Review `benchmarks.json` once |
| GitHub Pages policy change | The site is a static folder | Re-point DNS to any static host |
| Every live provider disappears | Cached last-good data is shown, labelled, behind the `ERR-DATA-DOWN` slot | Re-point the Worker at a copy of the archival floor: the community SQLite archive at `captn3m0/historical-mf-data`, which is never called at runtime and exists precisely for this |
| Domain lapses | The printed QR dies. The only unrecoverable failure | Prevented by multi-year registration, auto-renew, and a calendar reminder |

After launch the system has no scheduled tasks. The one standing obligation is
that the domain stays paid.

## Decisions taken under "should", recorded as §0 asks

**§8.2 annualisation divides by actual elapsed days, not the nominal window.**
The clause reads *"(NAV_end / NAV_start) ^ (365 / days) − 1, where days = actual
calendar days between the two NAV dates"*, and that is taken literally. The
distinction only exists because of the 7-day matching rule in step 2: when a
six-year target lands on a weekend, the window ends on the Friday and is a day or
two short of six years.

Worth being precise about what settles this, because the fixture does not. On a
gap-free daily series the two readings are arithmetically identical. On a
weekday-only series — that is, on every real fund — they part: the actual-days
reading holds the doubling fixture perfectly flat (drift 0.000000 points), while
the nominal-length reading drifts by 0.005910 points. Both sit inside §17.4's
0.01-point tolerance, so the fixture admits either. The spec's own wording is
what decides it. `tests/fixtures.test.js` asserts the wording directly, against a
window that ended short, rather than leaning on the tolerance.

**§17.1's illustrative figure is off by a hundredth.** Fixture A — ₹1,00,000 out
on 01-Jan-2020, ₹2,00,000 back on 01-Jan-2026 — spans 2192 days, so the exact
rate is `2^(365/2192) − 1` = **12.2344%**, which is **12.23%** at two decimals.
The spec prints "≈ 12.24%". The binding requirement is *"matches Excel's XIRR to
two decimals"*, and it does; only the parenthetical approximation is out. The
fixture asserts against the closed form and against a second solver written
inside the test file, never against the printed figure. Flagged for §19 sign-off,
since the number may also appear in the book.

**Percentile ties count half.** §7.2(d) places the visitor's own stretch among all
same-length windows, and that stretch is itself one of the windows measured, so
there is always at least one exact tie. Counting ties whole reports a fund that
moved at one steady rate as sitting at the very top of its own record; the
standard midpoint convention reports it as squarely in the middle, which is the
honest reading and the one that keeps S-STRETCH-MID reachable.

**A zero "Value today" is not an incomplete row.** §9.2 rule 4 says the same-sign
diagnostic *"can occur if value is zero"*, which is only possible if a zero value
reaches rule 4 rather than being turned back by rule 3. So rule 3's completeness
test admits zero for Value today rows and requires a positive amount everywhere
else. Fixture C depends on this.

**Scheme names are parsed segment by segment, keeping the separator.** AMFI
writes both `Fund - Direct Plan - Growth` and `Fund-Direct Plan-Growth`, so a
spaced-dash rule misses half the file, and splitting on every dash breaks
`Mid-Cap` and `Multi-Cap`. Each segment therefore travels with the separator that
preceded it, and pieces that turn out to be part of the name are rejoined exactly
as written. A segment counts as plan/option metadata only when *every* meaningful
word in it is one of those tokens — which is what stops `Nippon India Growth
Fund` losing its middle word and `Dividend Yield Fund` being read as an IDCW
option. Both cases are in the fixtures.

**§5.4 rule 3 is followed literally, and it has a known cost.** A name matching
neither pattern is treated as Regular-Growth if "Growth" appears anywhere in it.
For a scheme genuinely named `... Growth Fund` with no option token at all, that
rule will read the fund's own name as an option. The rule is the spec's, the
alternative is to guess, and guessing is what Principle 2 forbids. Recorded here
rather than quietly amended.

**Staleness takes "today" as an argument.** §7.3 requires the evaluator to be pure
with *"no dates-of-today logic beyond the data itself"*, yet S-STALE is defined
against the current date. The age in days is therefore computed upstream, where
the clock legitimately lives, and reaches the evaluator as one more figure. The
evaluator itself contains no clock, no network and no randomness, and the
fixtures assert all three by reading its source.

## What is deliberately not done yet

- **No interface.** §16.5 orders engines first.
- **`copy.json` ships with every string empty.** §13 is explicit: the developer
  wires slots and never writes prose. An empty slot is a slot awaiting the
  author; the lint reports all 63 by name so nothing ships with a hole in it.
- **`states.json` carries `"signedOff": false`.** The thresholds are the values
  the spec states, but §19 item 4 makes them the author's to freeze.
- **`benchmarks.json` is not written yet.** §6.2 requires resolving real scheme
  codes by inception date and verifying them by hand, which needs live provider
  data through the access layer. The resolved table goes to the author for one
  read before anything is marked verified.
- **Acceptance criterion 5 is pending, not passing.** The real-fund cross-check
  needs live provider data and a second established tool. This environment's
  proxy blocks all outbound hosts, so it cannot be run here and is reported as
  PENDING rather than skipped silently.
- **Criteria 10–15** are properties of the shipped interface — privacy, workbook
  parity, failover, performance, isolation, copy integrity — and are checked once
  those surfaces exist.
