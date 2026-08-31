# Fixtures

`three-tab-statement.xlsx` — a consolidated statement in the shape CAMS and
KFintech write one: a cover, a summary, and the transactions on a **third** tab.
It exists because reading `sheet1` out of that file hands the reader a cover
page and a refusal, and no fixture generated inside the suite would have caught
it — the bug is in which tab gets read, so the file has to have several.

Its transaction tab also carries `Purchase`, `SIP` and `Switch Out`, which is
what the broker-term dictionary is measured against: the first two are money in,
the third is money leaving one fund for another on the same day, and reading it
as a plain redemption inflates the return of whatever it left.

Rebuild it with `python3 tools/tool-tests/fixtures/build.py`.
