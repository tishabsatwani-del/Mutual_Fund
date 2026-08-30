# Where You Stand — the v3 screens

Built to the review of 30 August. All four tools now exist. The old twelve
screens are still live at `../`; these replace them.

| File | What it is |
|---|---|
| `theme.css` | The materials of review §6: paper, ink, ruling, marker |
| `lifeline.js` | The signature — the fund's whole life with the reader's stretch marked |
| `shared.js` | Formatting, the copy-slot reader, the data door, the router |
| `mine.js` | Tool 1, *My return* |
| `record.js` | Tool 2, *This fund's record* |
| `stand.js` | Tool 3, *My money in this fund* |
| `plan.js` | Tool 4, *My plan, tested* |
| `boot.js` | Starts the four tools |
| `deck.js` | Generated. Do not edit — run `python3 tools/v3/build_deck.py` |

```
python3 tools/v3/build_deck.py     # after editing sim/copy.json or sim/states.json
node tools/tool-tests/v3.test.js   # 150 checks, needs a server on 8781
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

The deposit rate ships empty. Below-zero windows are a **count**, not a share: a
share reads as a property of the fund when it is a property of the dates the
history happens to cover.

Guards are set as readings, never as alert boxes. The screen prints the
arithmetic itself — *this history is 6.0 years and you asked for 5-year windows,
so every window begins inside a band of 1.0 years* — and names the author's
sentence beside it. The figures are a reading of the reader's own data and belong
on screen; the meaning is the author's and is never invented here.
