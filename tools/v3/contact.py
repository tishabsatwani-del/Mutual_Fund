"""One sheet holding the whole set, for the README.

Twenty full-page phone captures cannot go into a document one at a time: each
is three to five thousand pixels tall, and a reader scrolls past the set rather
than seeing it. This lays one sheet's ten shots in a row at a common width, top
aligned, so the screens can be compared at a glance and any one of them opened
full size from `shots/`.

THE CAPTION IS REDRAWN HERE, LARGE.

Every shot already carries a caption strip composited beneath it by stamp.py,
and at contact-sheet scale that strip is a grey smudge. A caption that cannot
be read is not a caption. So the sheet carries its own, at a size that survives
the scale, saying the same thing the strips say -- and the strips stay on the
full-size files where they are legible.

Called by tools/v3/shoot.js. Arguments: --out <file> --title <text>
--caption <text> then "path::label" for each shot, in order.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

PAPER = (241, 239, 234)
INK = (30, 36, 51)
MUTED = (95, 103, 121)
RULE = (183, 193, 211)

SHOT_W = 220          # each capture, scaled to this width
GAP = 14
PAD = 26
LABEL_H = 22


def font(size, bold=False):
    name = ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
            else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    try:
        return ImageFont.truetype(name, size)
    except OSError:
        return ImageFont.load_default()


def wrap(draw, text, f, width):
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = (line + " " + w).strip()
        if draw.textlength(trial, font=f) <= width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def build(out, title, caption, items):
    shots = []
    for path, label in items:
        im = Image.open(path).convert("RGB")
        h = round(im.height * SHOT_W / im.width)
        shots.append((im.resize((SHOT_W, h), Image.LANCZOS), label))

    width = PAD * 2 + len(shots) * SHOT_W + (len(shots) - 1) * GAP
    inner = width - PAD * 2

    f_title = font(20, bold=True)
    f_note = font(15)
    f_label = font(12)

    scratch = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    note_lines = wrap(scratch, caption, f_note, inner)

    head_h = PAD + 26 + 8 + len(note_lines) * 21 + PAD
    body_h = LABEL_H + max(s.height for s, _ in shots)
    out_im = Image.new("RGB", (width, head_h + body_h + PAD), PAPER)
    d = ImageDraw.Draw(out_im)

    y = PAD
    d.text((PAD, y), title, font=f_title, fill=INK)
    y += 26 + 8
    for ln in note_lines:
        d.text((PAD, y), ln, font=f_note, fill=MUTED)
        y += 21
    y += PAD - 6
    d.line([(PAD, y), (width - PAD, y)], fill=RULE, width=1)

    x = PAD
    top = head_h
    for im, label in shots:
        d.text((x, top), label, font=f_label, fill=MUTED)
        out_im.paste(im, (x, top + LABEL_H))
        x += SHOT_W + GAP

    out_im.save(out, optimize=True)
    print("  sheet  " + out.rsplit("/", 1)[-1])


def main():
    args = sys.argv[1:]
    for flag in ("--out", "--title", "--caption"):
        if flag not in args:
            print("usage: contact.py --out F --title T --caption C path::label ...",
                  file=sys.stderr)
            return 1
    out = args[args.index("--out") + 1]
    title = args[args.index("--title") + 1]
    caption = args[args.index("--caption") + 1]
    items = []
    for a in args:
        if "::" in a:
            path, _, label = a.partition("::")
            items.append((path, label))
    if not items:
        print("nothing to lay out", file=sys.stderr)
        return 1
    build(out, title, caption, items)
    return 0


if __name__ == "__main__":
    sys.exit(main())
