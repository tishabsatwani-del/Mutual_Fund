# BUILD BRIEF — "Two Doors, One Storm" (v2)
### An advanced Monte Carlo behavioural investing simulator

A companion to the book chapter on Direct vs Regular mutual fund plans.
Mobile-first, single self-contained web page, no backend, all in memory.
Premium, cinematic, emotionally restrained.

> **v2 adds the full "10,000 Lifetimes" reveal sequence (Section 10).**

---

## 0. North star

This is **NOT** a simple SIP calculator. Build it as an **advanced Monte Carlo
simulator** that models real human behaviour, financial emergencies,
decision-making under stress, and the difference between facing the worst
moments **alone** versus **with someone to call**.

The whole thing dramatises one idea: two people invest the same money, in the
same market — one through a **Regular** plan (pays ~1% more a year, but has a
relationship manager / MD to call when life hits), one through **Direct** (pays
nothing extra, but faces every storm alone). **The only real variable is who is
beside you when it falls.**

> **Note on language:** never use the word "advisor." The guided investor's
> contact is a **relationship manager (RM)** or **MD**.

---

## 1. The one truth it must prove

Across every path it simulates, the user must be able to reach all of these
endings, honestly:

- Direct ends **ahead** of Regular (both stayed calm — the fee saving wins).
- Direct ends **equal** to Regular.
- Direct ends **below** Regular (Direct panicked alone while the RM talked
  Regular into holding).

The fee gap is small and steady. The behaviour gap is enormous. The entire
value of paying for guidance is whether it changes your behaviour in the one
moment that matters. **Never rig it so Regular always wins — prove the door was
never the point.**

---

## 2. This is a Monte Carlo simulator — engine & accuracy mandate (read first)

**Engine:** simulate **1,000–10,000 market paths**, with monthly returns
**block-bootstrapped from real Indian equity history** (so real crashes, fat
tails, and volatility clustering are preserved). If a parametric distribution is
used instead, document it: mean ≈ 12%/yr, volatility ≈ 15–18%/yr.

**Two modes off the same engine:**

- **"Live it"** (single path): one storm — a real historical crash or one drawn
  path — where the user makes the decision and feels it.
- **"10,000 lifetimes"** (distribution): each investor follows a defined
  behavioural policy applied across all paths, producing a distribution of
  outcomes — presented as the reveal sequence in Section 10.

**Math — exact and auditable, no shortcuts:**

- Real **unit-level accounting** (units × NAV every month), never just applied
  percentages.
- Correct **SIP cash-flow timing** (contribution at the start of each month).
- **Fees charged monthly:** Direct net 12%/yr (1.000%/mo), Regular net 11%/yr
  (0.9167%/mo). The 1% gap is the only fee difference; track and display the
  cumulative rupees it costs.
- **XIRR** computed from the actual monthly cash flows + final value for every
  investor, shown alongside the rupee figure.
- Every number on screen must be **reproducible from the code**, in clearly
  commented functions.
- Translate Monte Carlo output into **plain odds, not statistics** — "In 7,900
  of 10,000 futures, the calm investor finished ahead," not "79th percentile."
- All outputs are **illustrative probability ranges** — never predictions or
  advice. State this prominently on every results screen.

---

## 3. Shared structure

- **Two doors:** every scenario runs a **Regular** investor (has the RM/MD call)
  and a **Direct** investor (alone), same SIP, same market.
- **Two scenarios:** **The Crash** (does the market falling make you sell?) and
  **The Emergency** (you need a large sum now — how do you raise it without
  destroying your future?).
- **Inputs (keep minimal — confusion is the enemy):**
  - Monthly SIP: chips **₹5,000 / ₹10,000 / ₹25,000**.
  - Horizon: fixed at **20 years** (long enough for the fee to compound).
  - In Scenario A: pick which real crash you live through.
  - In Scenario B: pick the emergency type.
  - Nothing else on the main screen.

---

## 4. The math model (every variable defined)

**Base SIP path (per investor):**

- Monthly SIP for 240 months; units bought each month = SIP ÷ NAV that month;
  value = units held × current NAV.
- Direct NAV grows 1.000%/mo; Regular 0.9167%/mo, in normal months.

**The crash (single-path / "live it" mode):** inserted at the **midpoint** of
the horizon as a smooth curve matching the chosen real event's depth, fall
duration, and recovery duration (Section 5), then the market returns to its
prior trend and resumes normal growth. (An investor who stays fully invested
loses nothing to it and ends slightly richer — cheap units bought during the
dip. **Model this honestly; do not clamp it.**)

**The four behaviours — exact mechanics:**

1. **Hold** — keep all units, keep the SIP running throughout. (Buys cheap
   during the dip.)
2. **Pause** — keep units, stop contributions during the fall + recovery, resume
   after. (Misses the cheap units.)
3. **Sell, buy back on recovery** — sell all units at the bottom; contributions
   pile up as cash earning nothing; re-enter everything when the market regains
   its pre-crash level. (Sold low, bought at trend — permanent unit loss.)
4. **Sell and wait it out** — sell all at the bottom; stay in cash; re-enter a
   full year after recovery, market well above where it healed. (Deepest loss.)

**Monte Carlo mode:** behaviours become **policies** (e.g. "always hold," "sell
on any drawdown > 30%," "guided → holds") applied across all paths; output the
full distribution per investor/policy.

**Outputs per investor (always):** final corpus, XIRR, cumulative fees paid,
and — where a choice was made — the rupee cost of that choice (= the exact gap to
the calm path).

---

## 5. Real market events (use real data; label as illustrative)

Implement each as a smooth curve; show the real context. **Before shipping, lock
each figure against actual index data for the exact dates** — the book's whole
promise is accuracy.

| Event | Drawdown | Fall | Recovery | Character |
|---|---|---|---|---|
| **COVID-19, 2020** | ~ -38% | ~1 month | ~9 months | The fast one — panic was punished brutally; the rebound was nearly as fast as the crash. |
| **Global Financial Crisis, 2008** | ~ -60% | ~14 months | ~24 months | The deep, slow one — the panic "felt right" the longest. |
| **2022 correction** | ~ -18% | ~8 months | ~12 months | The moderate one. |
| **The one you're living through (geopolitics & oil), 2025–26** | ~ -14% so far | ongoing | unknown | Ends on uncertainty — because that's the real decision: you never know, in the moment, which kind it will become. |

> Label: "Based on the actual index drawdown; illustrative — exact figures vary
> by index and dates."

---

## 6. SCENARIO A — "The Crash"

**The climb:** both investors' wealth lines draw left-to-right, year by year,
money counting up. The Regular line runs visibly, slightly below Direct, and the
gap widens every year — the fee toll, shown accruing before anything dramatic
happens.

**The fall — and it's yours.** *(on-screen)*

> Eight years. The number climbing the whole way — your ₹10,000, every month,
> rupee by rupee, grown to **[₹X]**. You can feel how long it took. Then the line
> cracks. Not a dip — a fall. In a single week a third of it is gone, tumbling
> faster than you can read it.

**Then your side goes silent.** *(on-screen — the antagonist is silence, not
noise)*

> This is the part no one warns you about. For eight years your phone buzzed with
> good news — up again, all-time high, you genius. Now: nothing. No buzz. No
> call. No voice. Just you, a red number that won't stop falling, and a silence
> so complete you can hear the room. The market is screaming on every channel —
> and not one person is calling to tell you it will be okay. That was the deal.
> You went alone to save the fee. **This is what alone costs, billed at the worst
> possible second.**

**→ SPLIT — left: YOU · right: YOUR FRIEND**

**YOU — Direct. Alone.** *(on-screen)*

The four choices wait in the dark. No one will pick for you:

- Hold — keep buying into the fear
- Pause — stop, just till it's over
- Sell — buy back when it's safe
- Sell everything — make the bleeding stop

> *(The trap you can't see: the instant you tap **Sell**, the red freezes. The
> falling stops. Your shoulders drop. For one perfect moment, you feel safe —
> like the smartest thing you've ever done.)*

**YOUR FRIEND — Regular. The call.** *(on-screen)*

> Same eight years. Same ₹10,000. Same crash, the same third gone. She went
> Regular — paying that fee you were so glad to skip. Her screen is just as red.
> Then her phone rings. Her relationship manager, a steady, human voice: *"Saans
> le. Maine yeh chaar baar dekha hai. Har baar market wapas aaya."* And behind
> her, the screen flickers with proof — 2008, red then green; 2020, red then
> green; every storm, recovered. *"Kuch mat bech. Bas chalne de."* The red pulls
> back from her edges. Her line steadies. She breathes. She holds.
>
> **She isn't smarter than you. She didn't research more. She just wasn't
> alone.**

**The ending:** you choose; the two lines part and run to year 20. The friend
who paid more, who did nothing clever, is standing on the higher number — not
because of the fee, but because someone picked up the phone. Show both corpora +
XIRR + "Direct saved you ₹[fee]. Your decision in the crash cost you
₹[behaviour]." → then offer the **"10,000 Lifetimes"** reveal (Section 10).

---

## 7. SCENARIO B — "The money, now." (the emergency)

The market doesn't have to crash for the door to matter. Sometimes life just
demands a large sum, fast — and the question becomes not "do I panic-sell" but
"how do I raise this cash without destroying my future." Almost no one can answer
that alone, under stress, with a clock running.

**Setup:** you've invested [X] years — ₹[Y] across several funds (large-cap,
mid/small-cap, a liquid sleeve). You never planned to touch it. Then the
emergency (user picks one):

- your mother in the ICU — the hospital needs ₹12 lakh by morning;
- the layoff — with rent, EMIs, two kids, and six months of nothing ahead;
- the family emergency back home that can't wait.

**→ SPLIT —**

**YOU — Direct. Alone. The clock running.** *(on-screen)*

> Your funds are right there in the app. You don't have time to learn which one
> to sell, or whether selling the fund that's down locks the loss forever, or how
> much is "enough." Fear has one instruction: take it all, be safe. You redeem
> everything — far more than you needed — and the SIP you ran for eight years
> dies in one tap. No one told you there was a better way. There was no one to
> tell you.

**YOUR FRIEND — Regular. The call she can make.** *(on-screen)*

> She doesn't guess — she calls her relationship manager. A steady, practical
> voice: *"Saans le. You need ₹12 lakh — we take exactly that, not a rupee more.
> From your liquid fund first, then a little from the large-cap. Leave the
> mid-cap — it's down, selling now turns a dip into a real loss. Pause the SIP
> for three months, don't cancel it. The rest stays invested. This emergency is
> not going to cost you your future."* She redeems what she needs. The rest keeps
> working.

**The consequence (play to the horizon):** same emergency, same ₹12 lakh. She
took only the emergency. You took the emergency and your future with it. Show the
gap.

**The line:** *(on-screen)*

> It was never that she was calmer. It's that on the worst day, when no one can
> think straight, there was a number she could call — and you had only yourself,
> making the biggest financial decision of your life at the worst possible moment
> to make it.

**Hardest mode:** the emergency lands during a downturn (job losses cluster with
crashes; hospitals don't wait for green markets) — selling is doubly punishing
and the sequencing guidance matters most.

**Monte Carlo view:** the emergency strikes at a random point across thousands of
futures; prove how much more often "redeem only what's needed, from the right
place" preserves the future versus "redeem everything in panic." Keep it honest —
let the user also model a Direct investor who **does** make the smart sequencing
call, so the point lands as "the solo investor under stress usually can't, and
that's where the guidance earns its fee," not "Regular always wins."

---

## 8. The guidance asymmetry (honest, not rigged)

By default the Regular twin holds (Scenario A) / redeems smartly (Scenario B),
because that is what the evidence shows guidance does — cite it plainly in the UI:

> Guided investors stay invested far longer than solo ones — **AMFI–CRISIL:
> about 21% of guided equity money is still invested after five years, versus
> under 8% for direct.**

But in the "every outcome" view, let the user set the Regular investor's
behaviour too — so they can also see the case where the guided investor panics
and the calm Direct investor wins. **The tool never claims one door is better; it
proves the door was never the point.**

---

## 9. Outputs & views

- **Single-path result:** YOU vs YOUR FRIEND — two corpora, two XIRRs, fee saved
  vs behaviour cost, a verdict caption (Section 12).
- **"See every outcome" grid:** all four behaviour combinations (your choice ×
  her choice), so Direct-above, equal, and below Regular are all visible at once.
- **"What if you split — half Regular, half Direct?"** — show the hedge landing
  in between.
- **"10,000 lifetimes" (Monte Carlo) reveal:** NOT a fan chart — a guided,
  gut-landing sequence that collapses the distribution into the one life the user
  is dealt and translates the odds into a feeling. Built beat-by-beat in
  Section 10.

---

## 10. The "10,000 Lifetimes" reveal — the Monte Carlo sequence (build this exactly, beat by beat)

**Why it's built this way:** a distribution is a fact, and facts live in the
head. The gut only wakes for one person, one fate, one thing that can't be
undone. So this sequence does the opposite of a chart — it **collapses ten
thousand lives back down to the one the user is dealt**, and pours the odds into
a feeling they already carry. It plays after the user has lived a single crash
and made a choice (Scenario A), turning that one felt decision into proven odds.
Linear and guided — the user only watches, feels, and taps on. No inputs to
fumble.

**Beat 1 — the admission.** Near-black; one point of light at "today." A line
fades in:

> "No one can show you your future. So we ran it ten thousand times."

**Beat 2 — the spray.** From that one point, ten thousand faint threads of light
fan forward across twenty years — each wobbling through its own crashes and
rallies, a comet's tail of possible lives, shimmering. Quietly beneath:

> "Ten thousand versions of your next twenty years. Each one real. Each one
> different."

**Beat 3 — the collapse to one.** The threads freeze. Then:

> "But you don't get ten thousand. You get one."

The 9,999 dim to ghosts; a single thread ignites bright and steps forward, alone:

> "This one is yours. You didn't choose it. You won't see it coming. And you live
> it once — no replay, no refund."

Hold it. Let the aloneness sit (one beat longer than comfortable).

**Beat 4 — the odds, made physical.**

> "Here's the only question that ever mattered — not 'will I get lucky?' but 'who
> do I need to be if I don't?'"

Then, optionally with two faint counts (79 of 100 glowing steady, 30 of 100
flickering):

> "If a surgeon said an operation works 79 times out of 100, you'd book it
> tomorrow. If she said 30 out of 100, you'd walk out. Staying calm in a crash is
> the 79. Panicking is the 30. Same body. Same money. The only thing that changed
> was whether the hands holding it were steady — or shaking."

*(Use the **real simulated odds** from the engine; 79/30 are illustrative
placeholders.)*

**Beat 5 — meet the unlucky you.**

> "The reels only ever showed you the luckiest life. Here's the cruelest one —
> the worst future in all ten thousand. Watch it."

The single worst path plays, two lines on it. Even here, calm-you ends on solid
ground; panic-you is on the floor. As it settles:

> "Even in the worst life you could be dealt, the one who stayed calm was okay.
> The one who panicked never came back."

**Beat 6 — the line.** Everything else gone. Alone on black, in silence:

> The market deals you one life, face down. You live it once — no replay, no
> refund. You never choose the life. You only ever choose who you are when it
> turns face up.

**Beat 7 — seal it to the doors, then release.**

> "The door you walked through moved the number a little. The crowd you chose to
> stand in moved everything."

Then, quietly: "Now — live it yourself." → replay / back.

**Staging notes:** the spray is mesmerising but brief; the collapse-to-one is the
emotional hinge — make the 9,999 visibly die to ghosts while the one survivor
brightens. Keep motion premium and restrained (Section 11). The worst-life
playback reuses the Scenario-A line engine. **Beat 6 sits in total silence — no
motion, no sound, just the line.**

---

## 11. Animation & feel (premium — power lives in stillness and timing, not effects)

- The climb is alive and weightless; the crash is the opposite — everything
  slows, a deliberate **time-dilation** that mirrors how panic stretches one
  second into a minute.
- **The fall:** the line fractures with a faint glitch and drops; colour
  desaturates; a red vignette breathes in from the edges; a barely-there tremor
  under the whole frame.
- **The silence:** on your side, every bit of motion and every notification stops
  dead — stark, total stillness, the red number the only thing trembling. Hold it
  one beat longer than is comfortable before the choices appear. Make them endure
  it.
- A faint **heartbeat pulse** that raced during your fall slows the moment the
  friend's call lands — physiological contrast across the split.
- **Sell-as-relief:** tap a Sell option and calm floods in instantly — red
  freezes, vignette recedes, stillness — a deliberate, seductive "ahh" before the
  cost is ever shown.
- **Behind the friend during the call:** quick ghosted historical mini-charts,
  red resolving to green — history literally holding her hand, while your side has
  no history, no voice, only now.
- **The split is a slow vertical wipe.** The single most important beat: when the
  call lands, calm physically washes in on her side (red recedes, tremor stops,
  line steadies) while your side stays in the storm — the chapter in three
  seconds.
- The pressure is **environmental, not a trick** — the red, the silence, the
  friend's message lean toward sell, while the four buttons stay perfectly equal.
  The user should feel the pull, then learn what it cost.
- **After the choice:** the divergence draws with weight; the final numbers count
  up in silence. No confetti. No noise. Just the quiet, heavy truth.

---

## 12. Voice & verdict captions (resonance with the book)

The simulator is the chapter's twin — "don't believe me, live it yourself."
Verdict captions, by ending:

- **Both held →** "You did nothing. She did nothing. You simply kept more — the
  door you chose finally paid off."
- **You panicked, she held →** "You saved the fee and lost far more. Her
  'expensive' plan bought the one thing that mattered: someone to stop you
  selling."
- **Both panicked →** "Two doors, same mistake. The fee was never what decided
  this. You were."

---

## 13. Anti-confusion rules (non-negotiable)

- Minimal inputs only (Section 3).
- The central comparison is always **two lines, two plain labels — YOU and YOUR
  FRIEND** — nothing to decode.
- In "live it" mode, the user makes exactly **one decision** (theirs); the
  friend's path plays on its own.
- The "10,000 Lifetimes" reveal is **linear and guided** — the user only watches
  and taps on.
- Monte Carlo results shown as **plain odds, never statistics**.
- One screen per moment; no clutter; the only thing the user does is feel it,
  then choose.

---

## 14. Integrity & disclaimers

- Assumptions shown plainly on every results screen: "Illustration, not a
  prediction. 12% / 11% returns; real historical drawdowns; Monte Carlo ranges of
  possibility — your real results will differ."
- One-line footer everywhere: "**Educational tool — not investment advice.**"
- All math in clearly commented, auditable functions; every figure reproducible.

---

## 15. Tech & aesthetic

- Single self-contained web page; mobile-first; no backend, no external data, all
  in memory; fast and smooth.
- Dark, premium, cinematic palette (deep near-black base; restrained accent
  colours; red reserved for the crash).
- Keynote-cinematic motion, never arcade.
- Make it the kind of thing someone finishes and immediately sends to a friend —
  while staying clean and accurate enough to carry a book's name.

---

## One accuracy note before handoff

The drawdown depths/durations in Section 5 and the return assumptions in
Section 2 are **approximate and must be locked against real index data before
this ships**. The odds shown in the "10,000 Lifetimes" sequence must be the
**real simulated figures**, not the illustrative 79/30 placeholders. Treat every
number as illustrative until verified — **the book's entire promise is
accuracy.**
