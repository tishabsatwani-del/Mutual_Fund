"""Composite a caption strip beneath each screenshot.

The strip goes BELOW the capture, never across it. Everything above the hairline
is exactly what the browser rendered; the strip is plainly an annotation and
could not be mistaken for part of the tool.

Called by tools/v3/shoot.js. Each argument after --caption is "path::title", or
"path::title::caption" where that shot needs a caption of its own -- a shot of
the door holds made-up transactions whether or not the NAV history behind it is
real, and that is not a thing to leave ambiguous.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

# the page's own materials, so the strip belongs to the same object
PAPER = (241, 239, 234)
INK = (30, 36, 51)
MUTED = (95, 103, 121)
RULE = (183, 193, 211)

SCALE = 2
PAD = 14 * SCALE
LEAD = 20 * SCALE


def font(size, bold=False):
    names = ([
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ] if bold else [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ])
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
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


def stamp(path, title, caption):
    shot = Image.open(path).convert("RGB")
    w = shot.width
    scratch = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    f_title = font(13 * SCALE, bold=True)
    f_note = font(11 * SCALE)
    inner = w - 2 * PAD
    note_lines = wrap(scratch, caption, f_note, inner)

    strip_h = PAD + LEAD + len(note_lines) * (LEAD - 2 * SCALE) + PAD
    out = Image.new("RGB", (w, shot.height + strip_h), PAPER)
    out.paste(shot, (0, 0))

    d = ImageDraw.Draw(out)
    y = shot.height
    d.line([(0, y), (w, y)], fill=RULE, width=SCALE)
    y += PAD
    d.text((PAD, y), title, font=f_title, fill=INK)
    y += LEAD
    for ln in note_lines:
        d.text((PAD, y), ln, font=f_note, fill=MUTED)
        y += LEAD - 2 * SCALE

    out.save(path, optimize=True)


def main():
    args = sys.argv[1:]
    if "--caption" not in args:
        print("usage: stamp.py --caption <text> path::title ...", file=sys.stderr)
        return 1
    i = args.index("--caption")
    caption = args[i + 1]
    for item in args[i + 2:]:
        path, _, rest = item.partition("::")
        title, _, own = rest.partition("::")
        stamp(path, title, own or caption)
        print("  stamped  " + path.rsplit("/", 1)[-1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
