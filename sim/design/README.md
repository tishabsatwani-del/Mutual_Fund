# Brass Rule — the design system

The visual and interaction direction for the Simulator, built as a working
prototype rather than a mockup: `your-xirr.html` is Module C (§9) with the real
XIRR engine in it. Type payments into it and the answer is the answer.

Published at <https://claude.ai/code/artifact/c88d58d0-f1bb-4a83-acc1-71c8a4dc7fe2>.

## The direction

Four directions were drafted independently and scored by three judges — one for
taste, one for a first-time user on a mid-range Android in poor light, one for
performance under the §14 budget. All three picked the same one, unanimously.

**The Simulator is the back pages of the book, not an app the book links to.**
Two stocks and one metal:

| | |
|---|---|
| **Board** — warm near-black `#12100D` | the guided questions, the chrome |
| **Leaf** — cream paper `#F5F0E4` | every screen that carries numbers |
| **Brass** — `#C9A24D` | what you chose, and where the reading is |

The cover opens onto paper the moment numbers begin. That is the one big moment
in the product, and it is also the largest legibility win available: it puts the
ledger and every figure in 14.3:1 dark ink on light stock, which is what a
reader over fifty on a phone in daylight actually needs. Every rival direction
asked them to read small figures on near-black.

Board and leaf are **semantic, not thematic**. The page commits to one visual
world and paints every colour explicitly; it deliberately does not flip the
paper to dark for a viewer whose OS is dark, because that would discard the
legibility the whole design rests on.

## Type

| Face | Job |
|---|---|
| Spectral 300/400/600 + italic | display and prose — one voice |
| IBM Plex Sans 400/600 | labels, buttons, form fields, errors |
| IBM Plex Mono 500 | every figure, `tabular-nums slashed-zero` |

Fraunces was in the first draft and was cut on the judges' advice: it was the
one trend face in an otherwise trend-free system, and Spectral does both jobs
with half the payload.

## Decisions worth keeping

**Two grades of rule.** A hairline that merely divides may be faint
(`--rule-*`). A line that *is* an affordance — a card edge, an input well —
uses `--rule-*-signal` at 3:1 or better. Conflating them is how dark interfaces
end up with invisible buttons.

**Two grades of brass.** `--brass-ink #A87B31` is the data mark, and it is the
value the palette validator passed for the chart. `--brass-text #7A591C` is for
actual words on leaf, at 5.6:1. Text and a graphical mark are held to different
floors, so they cannot be the same token.

**Two finishes of one metal.** A chosen card is matte and seated; the primary
button is burnished and is the only thing on any screen that glows. When both
were fully struck, a *state* and an *action* competed for the same weight.

**No count-up, ever.** A counting number is a slot machine. The figure arrives
set; only the brass rule beneath it draws in.

**Every mutable numeral is width-locked in `ch`**, so a recalculation cannot
move the layout by a pixel.

**The readout sits above the chart.** On a phone, a floating tooltip appears
exactly where the reader's thumb already is.

**Sign is texture, never colour.** There is no green and no red in the system,
and no plus sign in front of a gain. Where a holding is under water the area
fill is hatched rather than recoloured.

## The chart palette

`#A87B31` brass and `#39479B` indigo on `#F5F0E4`, which is gold stamped on
indigo cloth — how a book is actually bound. Validated:

```
node scripts/validate_palette.js "#A87B31,#39479B" --mode light --surface "#F5F0E4"
  PASS lightness · PASS chroma · PASS CVD ΔE 27.4 protan · PASS normal ΔE 30.0 · PASS contrast
```

## What the browser pass caught

The prototype was driven end to end in Chromium before publishing. Four defects
that would otherwise have shipped:

1. **An invisible heading** — `body` set the board's near-white ink and never
   switched it on leaf, so the `<h1>` rendered cream on cream.
2. **Both chart lines collapsing to zero on the final day** — the closing value
   was being summed as though it were a payment the reader had made.
3. **A card subtitle at 2.77:1** against the gold gradient's darkest stop.
4. **Two tap targets at 40–41px**, under the 44px floor.

Contrast now passes AA on every text token, nothing scrolls sideways at 320px,
`prefers-reduced-motion` is honoured, and the short-span case suppresses the
annualised figure with an em dash rather than printing a misleading rate.

## Still the author's

The "What this means" panel renders `XIRR-MEANING` as an empty slot marker. No
prose in this interface is written by the developer (§13); the prototype shows
the shape it will arrive in and the room it has been given.
