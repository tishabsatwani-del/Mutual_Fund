# Two Doors, One Storm — build and tests

The live page (`/index.html`) is a **gate**: the simulator's HTML is stored
inside it encrypted, and opens only with a reader's access code (checked on the
phone; nothing leaves it). The readable source (the *master*) is deliberately
**not** in this repository. Keep two dated copies of it in two places, and use
these scripts to publish changes and to prove the engine.

## Rebuild the published page from the master

```bash
TDOS_CODE='<a reader access code>' node tools/two-doors/build.js /path/to/master.html
```

- Unwraps the existing master key with the code you give, re-encrypts the new
  master with that same key and a fresh IV, and writes `index.html`. Every
  other access code keeps working — none needs to be known here.
- Stamps the as-built line (`as built: <date> · source <commit>`) into the
  master's maths panels and self-test page, and refuses to build a master that
  contains emoji (the UI is inline SVG only). The exact stamped text is written
  beside the master as `<master>.built.html`.
- Verifies that the rebuilt gate opens and yields the master byte-for-byte
  before writing anything.
- To add a reader code without touching anything else:
  `TDOS_ADD_CODE='<new code>' TDOS_CODE='<existing code>' node tools/two-doors/build.js …`

Then commit `index.html` and merge to `main`; the Pages workflow deploys it.

## Run the engine tests

```bash
TDOS_MASTER=/path/to/master.html node tools/two-doors/engine.test.js
```

Covers the fourth audit (September 2026): the twenty golden vectors (Appendix
A, regenerated under the asset-charge fee and decision-time pricing, frozen in
the master and recomputed by the hidden `#selftest` page), and the relationship
each developer area states as its test — the fee as a daily charge on assets
(φ, 10.886% at a 1.00-point gap, g = 0 identical paths), the 0.10-point liquid
gap, one pause convention in both doors (S × N invested on every path; parked
beats spent), a steady hand that does not flinch, the tape (no tap = hold
exactly; sale cost monotonic in depth; trough = the matrix figure; buy-the-dip
identity; the day-and-drawdown stamp), the exact regain in every storm ×
horizon × gap, adaptive need rounding (strictly increasing for every SIP and
horizon), the calm-road fee, the futures' median calm CAGR of 12.0% ± 0.1% at
the frozen base drift, the dated storms and the bounded drawn crash, the chosen
emergency backdrop, the copy branches (verdict kind, oath sentence, cost-line
kind, crash-cost sign, "about the same"), and the build itself (no emoji, no
real outlet names in the feed, the industry-wide Axis attribution, the tax
sentence, the sources).

Browser behaviours (the scroll pill, Back mid-tape, the voice note unlocking on
the caption clock with sound off, the header slot, keyboard focus) are checked
in the page itself; open it with `#selftest` to see the golden vectors pass on
any phone, offline.
