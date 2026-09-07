# Two Doors, One Storm — build and tests

The live page (`/index.html`) is a **gate**: the simulator's HTML is stored
inside it encrypted, and opens only with a reader's access code. The readable
source (the *master*) is deliberately **not** in this repository. Keep two dated
copies of it in two places (see the audit's T4), and use these scripts to
publish changes and to prove the engine.

## Rebuild the published page from the master

```bash
TDOS_CODE='<a reader access code>' node tools/two-doors/build.js /path/to/master.html
```

- Unwraps the existing master key with the code you give, re-encrypts the new
  master with that same key and a fresh IV, and writes `index.html`. Every
  other access code keeps working — none needs to be known here.
- Verifies that the rebuilt gate opens and yields the master byte-for-byte
  before writing anything.
- To add a reader code without touching anything else:
  `TDOS_ADD_CODE='<new code>' TDOS_CODE='<existing code>' node tools/two-doors/build.js …`

Then commit `index.html` and merge to `main`; the Pages workflow deploys it.

## Run the engine tests

```bash
TDOS_MASTER=/path/to/master.html node tools/two-doors/engine.test.js
```

Covers the reviewer's acceptance test from the September 2026 audit (run C
reproduces ₹3,04,53,950 / ₹2,63,05,172 / 11.3% / 10.4%), the internal
identities on every path, the fee-gap selector, the printed behaviour rules
(sale at the bottom, re-entry months, one idle-cash rate), and edge cases
E1–E12 (late crash, early crash, oath reversals, cost exceeding the total
invested, need bigger than the corpus, the sell waterfall, hardest-mode flag,
seeded futures, the named war anchor and drawn-crash ranges, SIP changes).

E8/E9 (sound off, no speech engine), E13 (the session record), E14 (360 px
reflow) and E15 (back from the friend's phone) are browser behaviours; check
them in the page itself (sound off → every button live at once; sound on →
live within four seconds; the "Your two numbers" totals match the runs).
