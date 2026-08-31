# Where You Stand — the v3 screens

Built to the review of 30 August, v4. All four tools now exist. The old twelve
screens are still live at `../`; these replace them.

| File | What it is |
|---|---|
| `theme.css` | The materials of review §6: paper, ink, ruling, marker |
| `lifeline.js` | The signature — the fund's whole life with the reader's stretch marked |
| `spread.js` | Every window, in the order it happened |
| `shared.js` | Formatting, the copy-slot reader, the data door, the router |
| `mine.js` | Tool 1, *My return* |
| `record.js` | Tool 2, *This fund's record* |
| `stand.js` | Tool 3, *My money in this fund* |
| `plan.js` | Tool 4, *My plan, tested* |
| `boot.js` | Starts the four tools, draws About, registers the shell |
| `reading.js` | Draws a saved reading as an image, always on day paper |
| `sw.js`, `manifest.webmanifest`, `icon/` | The offline shell |
| `tokens.html`, `tokens.js` | The token sheet, built from the build |
| *(shared)* `sim/upload.js` | The §5 door: its questions, its stitching, its messages |
| *(shared)* `sim/workbook.js` | Reads an .xlsx without a library |
| `shots/` | The twelve screenshots — run `node tools/v3/shoot.js` |
| `deck.js` | Generated. Do not edit — run `python3 tools/v3/build_deck.py` |

```
python3 tools/v3/build_deck.py     # after editing sim/copy.json or sim/states.json
node tools/tool-tests/v3.test.js   # 320 checks, needs a server on 8781
node sim/tests/upload.test.js      # 69 checks on the door, headless
node tools/v3/shoot.js             # the twelve screenshots, same server
```

## The materials

Two sheets, following the phone's own day/night setting with no toggle. Every
value is measured in the suite, so a change that makes a pair unreadable fails
there rather than in front of a reader.

| | Day | Night | Measured |
|---|---|---|---|
| Paper | `#F1EFEA` | `#12161E` | the ground |
| Ink | `#1E2433` | `#E8E6E1` | 13.48 · 14.52 |
| Muted | `#5F6779` | `#9AA1AE` | 4.94 · 6.97 |
| Slate — the comparison series only | `#4C6A9C` | `#8FA8D3` | 4.75 · 7.51 |
| Marker — the reader, and nothing else | band at 55% | `#F2CF5B` as ink | 12.77 · 11.95 |

**Two grades of ruling.** A line that only divides may be quiet: `#B7C1D3` and
`#2C3442`, at 1.58 and 1.45. A line that is the *edge of something tappable* is
an affordance and reaches 3:1: `#7D8AA0` and `#5A6475`, at 3.04 and 3.03. The
review proposed `#93A0B6` and `#3C4657` for the edges; measured, those came to
2.30 and 1.90, so they were walked to the nearest values in the same slate that
clear the floor.

**Type.** §6 asks for Source Serif 4 and IBM Plex Sans, self-hosted and subset
so no request leaves the site. The font files are not in the repository yet, so
the stacks name them first and fall back to the system's own faces. Adding the
subsets is a drop-in. The suite asserts the page makes no external request
either way.

## The life-line

The fund's whole life as one thin ink line, the reader's stretch marked — a
marker band under that segment by day, the segment itself in marker by night —
and three marks: the worst window of the reader's length, the best, and the
latest.

Two decisions worth knowing. It is **inline SVG**, not canvas: after min/max
bucketing to 600 points it is small, and SVG stays crisp at any pixel ratio,
prints, and carries its own accessible description without a second code path.
And the axis is **logarithmic**, because over two decades a linear axis squashes
the first ten years flat against the floor — which misrepresents exactly the
years the reader is being asked to look at. Nobody reads a value off this line;
the three marks carry the figures, so the axis owes the reader shape, and log is
the shape that is true.

## Upload only, and why the screen says so

Review v4 §3 settles it: the tool fetches nothing. There is one door and it is
the file the reader downloaded themselves, so there is no provider seam to
register anything into and no search box that could quietly start making
requests. Every screen's door now says the reason out loud — *Bring your own
file. Nothing is fetched and nothing is sent.* — because a reader arriving from
a calculator that fetches will read "load a file" as this tool being less
capable unless the first thing they meet is why. §5's guide sits behind one
tap so the door itself keeps to its word budget.

### Paste, where the reader already has it

A reader with the NAV column open in a spreadsheet has the data in their hands
and no file to give. Downloading a sheet in order to upload it back is a step
that existed only because the door had one shape. Every door takes a paste now,
and pasted columns go through **exactly the same `read()`** as a file — the
day-first question, the scheme picker, the IDCW refusal, stitching, the gap
report and the confirmation all behave identically. The one thing that changes
is the instruction when it fails: *copy two columns out of the sheet*, not
*download the table*, because there is no file to download again.

Both ledgers share one reader too, `SimUpload.ledgerRows`. It is deliberately
**not** a call into `rowsToSeries`: that drops any value at or below zero, and
in a ledger the negatives are the whole point. It finds columns by content in
any order, recognises a header by content rather than by name — so the word
"Date" is no longer counted as a line it could not read — and reads a bracketed
or true-minus figure as money out, which is how a statement writes it.

Two decisions worth knowing. A `Dr`/`Cr` suffix is deliberately **unread**:
taking direction from a bank's abbreviation is a guess about the reader's own
money, and a wrong guess is silent and backwards. Those rows are skipped and
counted where the reader can see them. And a fund is never inferred from a
narration column — that would be the tool inventing an attribution.

The paste also closed a real hole. `POS-WITHDRAWALS` is one of the author's
written sentences, and Tool 3's engine has always handled money out — but no
control on that screen could **create** a money-out row, so her sentence was
unreachable through the interface. A paste can write both, which is what a
statement holds anyway.

### The door holds a conversation

Because it is the only door, it cannot just parse. Three of §5's rules are
**questions the reader is the only one who can answer**, and each is asked once
and then remembered for that pile of files:

* **Dates that read two ways.** Where day-first and month-first are both valid
  for every row, the door shows the first row set both ways and offers two
  answers. It used to default to day-first with a warning, and a warning is not
  a question.
* **A file holding many schemes.** Listed **grouped by family**, each row named
  by what actually differs — *Direct · Growth* — with Direct before Regular and
  Growth before IDCW, and a search box for a file with two hundred of them.
* **An IDCW row.** Refused, with the reason and the row to pick instead: its
  NAV falls at every payout, so every return on it reads low.

And two of §5's rules are arithmetic over the whole pile. AMFI caps a download
at 90 days, so a full history arrives in pieces: the door **stitches by date,
removes the overlaps** readers leave to be safe, and **reports the gaps** that
remain, naming the days and both dates and saying that a downloaded piece may
be missing. A weekend is not a gap.

Then it **confirms before computing**, in §5's own form: *Found 4,812 NAVs for
[name as in the file], 12-Mar-2007 to 28-Aug-2026, no gaps.*

All of it lives in `sim/upload.js` as pure functions over rows, so the whole
conversation is tested headlessly (41 checks) as well as driven through a real
screen. The index fund goes through the same door, with §5's *same source, same
steps* note under it.

## About, and the footer

`ABOUT-MAIN` is the one slot the author has written and signed off — §8's draft,
kept — and until step 6 it was rendered nowhere in the app. It now leads the
**About** screen, set as a reading in the serif rather than as small print, and
the footer rides on every screen so About is one tap from anywhere. On About
itself the link steps out, separator and all.

Beneath it: the four tools named **from the deck**, so renaming one never
touches this file; the five chapter pointers, each naming itself until the
author writes it; and **what this build reads** — a four-row statement of what
the code in front of the reader actually does. That last table asks
`WYS.hasProvider()` rather than asserting anything, so with no provider
registered it says a fund's prices are *read from a file you choose*, and it
will change by itself the day one is wired. A privacy note is worth nothing if
it cannot be checked against the build it ships with.

## The two rare touches

**Add to home screen.** A manifest and an offline shell, so the tool sits on the
phone as an icon and opens instantly. On an upload-only tool this is not a
nicety: the tool fetches no data by design, so once the shell is on the phone
there is nothing left for a network to be needed for — the reader's file comes
off their own device and every figure is worked out there. It works on a plane,
which no fetching calculator can claim, and the suite proves it by turning the
network off and opening the tool.

Two strategies, deliberately. The **page** is network-first, falling back to
cache: every sentence comes from the copy deck and the author is still writing
it, so a cache-first document would show a reader last month's sentences for as
long as the icon sat on their phone. **Everything else** is
stale-while-revalidate — instant from cache, refreshed behind you — which is
what makes it open at once and self-heal without anyone bumping a version.

The icon is the book's own materials: a page with lines written on it, and one
of them marked. A bare highlighter band was abstract at 48 pixels; a marked
*line* among unmarked ones reads at any size.

**Save this reading.** One tap renders the four figures, the sentence and the
date as an image, on the phone. It is **drawn, not screenshotted** — a
screenshot carries whatever else is on the screen; this carries exactly what it
was handed. It **always renders in the day palette**, whatever sheet the reader
is on, so it looks like a page from the book wherever it ends up. And it takes a
figures object rather than scraping the DOM, which is how "no fund advice on it,
ever" is enforced rather than merely intended: the next step is a thing to do
*inside* the tool, so it is never handed over at all.

Two overflows the suite caught, both of them section 11's "never wider than its
container" in text: the footer ran off the right edge, and so did an AMFI-length
fund name. Both wrap now, and a check paints the right margin and fails if a
single pixel lands in it.

## The token sheet

`tokens.html` is §13's last deliverable: colours, type scale, spacing, radii and
the number formats, on one page. It is **generated from the build** — it fetches
`theme.css`, parses both palettes out of it, and calls `sim/format.js` for every
example — so the sheet and the product cannot disagree. If a value on that page
is wrong, it is wrong in the product.

Every contrast ratio is **measured there, not quoted**. A number a designer
cannot check is one they have to take on trust, and this whole product is an
argument against doing that. Each token is measured against the ground it
actually sits on: the reader's own figures against the composited marker band,
button text against ink. A ratio taken against a colour the pair never meets on
screen proves nothing.

Building it that way surfaced two things immediately. `--marker-ink` had been
documented against paper when by day it always sits on the band — the sheet now
reports 12.77:1, which is the review's own figure and the pair that actually
appears. And `--marker-line`'s day value is **never used**: every use of it sits
inside a dark-scheme block. The sheet reads usage out of the stylesheet and says
so, rather than showing a ratio for a colour nobody sees.

The suite drives the sheet too, so it is a **checker** as well as a document: if
a colour drops below the floor its job needs, or a number format drifts, the
build fails rather than the sheet quietly lying.

## Copy

Every sentence comes from `sim/copy.json` by slot id. Where a slot is unwritten
the screen **names it** — `Awaiting copy slot POS-CELL-LOWER-TOP` — rather than
printing nothing or inventing a sentence. A blank where a sentence belongs looks
like a bug; a named empty slot looks like what it is.

The eighteen Tool 3 slots and their nine next steps are the author's, drafted in
§10 of the review. They are addressable by id alone, so wording can change at any
time without a line of code moving.

## Four bugs the browser pass caught, all worth knowing

**The router hid the whole page.** Sections are hidden by `[data-view]`, and
`<body>` carries the same attribute as a styling hook. An unscoped selector
matched the body, set `hidden` on it, and everything was in the DOM with nothing
clickable. The selector is now `#main > [data-view]`, and a check asserts the
body is never hidden.

**The histogram's bar was also the sticky header.** Both were `.bar`; the later
rule won, so the header rendered as a small dark inline-block with a browser-blue
link in it. The histogram's is now `.hist-bar`, and three checks pin the header's
width, ground and brand colour.

**`[hidden]` lost to `label.field`.** The browser's own sheet sets `[hidden]` at
the lowest specificity there is, so `label.field { display: block }` silently
outranked it and every field the script hid stayed on screen — the in-or-out
question sat there on a run of instalments, which are always money in. The sheet
now states the intent once, `[hidden] { display: none !important }`.

**A ruled line only worked inside a box.** `.line` was written as
`.reading .line`, so the levers on Tool 4 and the inflation line on Tool 1 lost
their layout and dropped each figure onto the row beneath its own label. The
layout belongs to the line, not to the box it happens to sit in.

## Step 6 · the copy, cut to budgets

The author's deck is linted where it lives. The *other* half — the labels,
glosses and readings the screens themselves carry — had never been counted, and
those are words a reader reads. The suite now lints them too:

* **Rules 1 and 3** — no sentence tells the reader to act, and the excluded
  words never appear — over every word on screen, readings included. Clean.
* **Rule 2**, timeless, over the **static markup only**. A reading prints the
  reader's own dates and percentages by design; those come from their data, not
  from a sheet that has to outlive a printed QR code. This caught one real hit:
  *Worth today*, and *what a fixed deposit pays today*. Both are now written
  without the moment — and *What it is worth · On this date* was the more
  accurate label anyway, since the reader picks that date.
* **The budgets.** Review §4 gives Tool 1 forty words of ledger labels and a
  hundred and thirty for the reading: measured at 39 and 127. Home is fifty
  words for the *whole* screen, and the author's line has not landed yet — her
  slot is budgeted at 120 characters, so twenty of the fifty are hers. The home
  screen was at 46 of its own, which would have blown the budget the moment her
  line arrived; it is cut to 30. The header already carries the product name, so
  home no longer repeats it as a visible heading.

Screens the review has not budgeted are measured and printed, so those numbers
get set against something real: record 138, plan 126.

## Step 6 · the design pass

Measured at **320px as well as 390**, on all six screens, in the suite:

* **Nothing scrolls sideways.** Every tool screen did, by 35–51px on a 320px
  phone, because a three-column table cannot fit there. Tables now scroll
  inside their own box; the page never does.
* **One h1 per screen.** Tool 3 printed the fund's name as a second h1 inside
  its reading, which leaves a screen reader with no top to the page. The fund is
  an h2 beneath the screen's own heading.
* **Every control is a finger wide.** The header's brand, the footer's link and
  About's rows were 15–27px tall. All are 44 now, and the whole row is the
  target rather than the words in it.

One regression this pass caught and fixed: the `nowrap` added to the ledger's
date column in step 5 was written unscoped, so it also caught the tables whose
first column is a sentence and pushed those clean off the edge of a phone.

## Step 7 · the screenshot set

`node tools/v3/shoot.js` writes twelve shots into `shots/`: the six screens on
both sheets, at 390×844 and twice that in pixels, which is a phone. It drives
each screen to the state worth photographing — the readings, not the empty
forms — and shoots with reduced motion on, because a still of a mid-animation
frame is a lie about the design.

**On real data.** Step 7 asks for the set on real data, and no NAV source is
reachable from the build environment: every request to AMFI and to the public
mirrors is refused at the network gateway, and `tool/data/` ships empty by
design. So the harness takes a `--fund` flag and the shipped set does not use
it:

```
node tools/v3/shoot.js --fund ~/Downloads/some-real-fund.csv \
                       --label "Fund name, official history to DD Mon YYYY"
```

With a real file the same command regenerates the whole set, captioned with
whatever `--label` says. With no `--fund` it generates a synthetic series and
names the file so the tool prints **not-a-real-fund** everywhere it names a
fund, and every shot carries a caption strip saying the figures describe
nothing that happened. That is not caution for its own sake: a rolling-return
reading looks equally authoritative whether or not its input was real, which is
exactly why `tool/data/README.md` forbids inventing a series — and a screenshot
of such a reading carries the same danger in a form that travels further than
the tool does. The caption is composited **beneath** the capture, never across
it, so every pixel above the hairline is what the browser actually rendered.

### Three things the full-resolution shots caught

**The life-line's names were squashed to a third of their width.** The viewBox
is 1000 units wide and a phone gives it about 340, with
`preserveAspectRatio="none"` so the line stretches to whatever width there is.
That stretch applies to glyphs too — legible on a desktop, a smear on the
device this is read on. The dots stay in the drawing; the names are HTML
underneath, positioned by percentage, set in the page's own type, and the suite
now asserts there is no `<text>` inside the drawing at all. The first and last
names anchor to their edge rather than centring, so a mark on the first NAV in
a history no longer hangs half off the page.

**Four "now" words survived the step-6 cut.** That pass linted rule 2 against
the static markup, and these four are generated by the screens, so the lint
could not see them: *what a fixed deposit pays today*, *what this fund's own
page prints today*, *worth today, as you entered it*, and two in Tool 1's
refusals. The README of that commit said the word was gone; it was gone from
the markup only. All four are rewritten, and the lint now applies rule 2's
now-word half to the **rendered** screens as well — a date or a percentage on
screen is the reader's own data and belongs there, but a word meaning "now"
never is.

**A long figure squeezed its own label.** *Higher than 85 of 100* is wider than
the column it shares, so it crushed *Your stretch, placed* into two cramped
lines to stay on the same row. A ruled line wraps now, with the figure still
against the right margin.

## Tool 1

A **ledger, not a form**: one ruled line per entry, and the whole line is the
control — tap anywhere on it to edit or remove. Sixty instalments are written as
**one line** — *₹5,000 monthly, Apr 2021 to Mar 2026, 60 instalments* — and the
engine expands them at run time. Sixty rows of the same number is a wall the
reader has to proof-read; one line is a sentence they can check at a glance, and
it stays editable as one thing.

*Paste from a spreadsheet* takes two columns, a date and an amount, with a minus
for money out — which is what a bank statement and a fund's own transaction
export already look like. **Worth today** is one fixed field at the foot, not a
row type: no money moved, and every reader asked to enter it as a row has
wondered whether to sign it. *Save entries* and *Load entries* write to this
device and nowhere else, when the reader presses them.

The reading is the rate wearing the marker, the span line, and then **absolute
return standing beside XIRR**, each with the one gloss that says which question
it answers — two numbers that do not match is the commonest reason a reader
thinks a tool is broken. One crossover line follows, and it counts the reader's
own years rather than naming a fixed mark: a lump sum crosses at exactly twelve
months, a monthly plan later. Inflation ships blank; a rate printed there would
be the tool telling the reader what to expect.

## Tool 4

Five inputs, tested at rates taken from a real fund's **own record** rather than
at one assumed number. Every goal calculator in the market asks the reader to
type a rate, and the rate they type is the rate they hope for. This one takes the
worst, the typical and the best window of exactly their length out of a published
history and lands the same plan three times. The worst goes first and largest;
the best is printed last and small, because it is the one figure a reader will
otherwise plan around.

A fund loaded in any of the four tools is the fund here. Where the history cannot
reach the reader's horizon, the longest it *can* give is used and the screen says
so in one line. Where the history is so short that the worst, the typical and the
best all print the same figure, the screen says that too — triggered by the fact
itself, not by a threshold anyone had to choose. With no fund at all there is one
*Suppose* field, and the reading states out loud that nothing on it has been
measured against a market that happened.

**Two levers, never a third**: the monthly amount that arrives at the typical
rate, and the years the worst rate would add. Both are the reader's own. The only
other levers a calculator could offer are *pick a better fund* and *need less*,
and neither is a calculation.

## Tool 2

Fund, then plan, then *how long will you hold?* — six lengths with **no default
and nothing rendered until one is chosen**, because the length a reader means to
hold is the one thing this screen must not guess. Lengths the history cannot
measure are disabled.

The reading puts the **worst window first and largest**, the typical one second,
the best third, and the mean appears nowhere. Then the life-line with the worst,
best and latest windows marked — and no marker band, because on this screen the
stretch shown is not the reader's own. Then which window is which, and where the
latest one places out of a hundred, which is the question a fund's own page can
never answer.

**Two distributions, each one tap away.** "How often" answers how the windows
are spread. "In the order they happened" answers what the spread cannot: where
they sit in time. A fund whose poor windows are one cluster around a single
crash and a fund whose poor windows turn up in every decade produce the same
three figures and the same histogram, and they are not the same fund to hold.
One ink line, no marker — the marker means "you", and on this screen there is
no "you" — read by drag or arrow key into a live region, with the same record
as a table underneath. It is one step beyond what §4 fixes for this screen, so
it sits closed, behind its own disclosure.

The deposit rate ships empty. Below-zero windows are a **count**, not a share: a
share reads as a property of the fund when it is a property of the dates the
history happens to cover.

Guards are set as readings, never as alert boxes. The screen prints the
arithmetic itself — *this history is 6.0 years and you asked for 5-year windows,
so every window begins inside a band of 1.0 years* — and names the author's
sentence beside it. The figures are a reading of the reader's own data and belong
on screen; the meaning is the author's and is never invented here.
