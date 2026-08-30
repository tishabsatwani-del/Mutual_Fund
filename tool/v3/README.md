# Where You Stand — the v3 screens

Built to the review of 30 August. The old twelve screens are still live at
`../`; these replace them once all four tools exist.

| File | What it is |
|---|---|
| `theme.css` | The materials of review §6: paper, ink, ruling, marker |
| `lifeline.js` | The signature — the fund's whole life with the reader's stretch marked |
| `shared.js` | Formatting, the copy-slot reader, the data door, the router |
| `record.js` | Tool 2, *This fund's record* |
| `stand.js` | Tool 3, *My money in this fund* |
| `boot.js` | Starts the four tools |
| `deck.js` | Generated. Do not edit — run `python3 tools/v3/build_deck.py` |

```
python3 tools/v3/build_deck.py     # after editing sim/copy.json or sim/states.json
node tools/tool-tests/v3.test.js   # 84 checks, needs a server on 8781
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

## Two bugs the browser pass caught, both worth knowing

**The router hid the whole page.** Sections are hidden by `[data-view]`, and
`<body>` carries the same attribute as a styling hook. An unscoped selector
matched the body, set `hidden` on it, and everything was in the DOM with nothing
clickable. The selector is now `#main > [data-view]`, and a check asserts the
body is never hidden.

**The histogram's bar was also the sticky header.** Both were `.bar`; the later
rule won, so the header rendered as a small dark inline-block with a browser-blue
link in it. The histogram's is now `.hist-bar`, and three checks pin the header's
width, ground and brand colour.

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
