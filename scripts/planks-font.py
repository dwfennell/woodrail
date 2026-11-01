"""Build src/assets/woodrail-icons.woff2: one colour glyph, planks, at U+E000 (`GOODS_ICON.planks`).

There's no emoji for sawn boards (🪵 is a log), so planks get their own: three flat boards, stacked and staggered, with
square sawn ends and a red strap, as the town signs paint them (`drawGood` in src/render/landscape-view.ts). It's a
COLR/CPAL font (layers of flat colour, drawn by Chrome, Safari and Firefox), so it sits in any text, in costs, chips,
cards, toasts and tooltips, at the text's size and on its baseline, as an emoji does, with no DOM of its own.

Run: python3 -m pip install fonttools brotli && python3 scripts/planks-font.py
"""

from pathlib import Path

from fontTools.colorLib.builder import buildCOLR, buildCPAL
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
ADVANCE = 1160  # about an emoji's width
CODEPOINT = 0xE000

# The toy-wood colours (as on the town signs and the tray's pictures).
PALETTE = {
    "edge": "#6b4528",  # outlines: dark wood, clear on the light cards and the dark ones
    "board": "#e3bf8c",  # a board's face
    "light": "#f6dfb4",  # the lit top of each board
    "end": "#c9965a",  # the sawn end: square, darker
    "grain": "#b98652",
    "strap": "#c8442f",
}


def rect(pen, x0, y0, x1, y1, r=0):
    """A rectangle, its corners rounded by r (quadratic curves), clockwise, as TrueType draws an outer contour."""
    x0, y0, x1, y1 = round(x0), round(y0), round(x1), round(y1)
    if r <= 0:
        pen.moveTo((x0, y0))
        pen.lineTo((x0, y1))
        pen.lineTo((x1, y1))
        pen.lineTo((x1, y0))
        pen.closePath()
        return
    r = round(r)
    pen.moveTo((x0, y0 + r))
    pen.lineTo((x0, y1 - r))
    pen.qCurveTo((x0, y1), (x0 + r, y1))
    pen.lineTo((x1 - r, y1))
    pen.qCurveTo((x1, y1), (x1, y1 - r))
    pen.lineTo((x1, y0 + r))
    pen.qCurveTo((x1, y0), (x1 - r, y0))
    pen.lineTo((x0 + r, y0))
    pen.qCurveTo((x0, y0), (x0, y0 + r))
    pen.closePath()


# Three boards, bottom to top, staggered so each reads as its own piece: (left, right, bottom).
H = 250  # a board's height, outline included
LINE = 62  # outline width: about 1 px at 16 px
BOARDS = [(40, 1040, -110), (120, 1120, 190), (40, 1040, 490)]
END = 150  # how long the sawn end at the right shows
STRAP = (470, 590)

layers = {name: TTGlyphPen(None) for name in ["edge", "board", "light", "end", "grain", "strapEdge", "strap"]}
for x0, x1, y0 in BOARDS:
    y1 = y0 + H
    rect(layers["edge"], x0, y0, x1, y1, 40)
    rect(layers["board"], x0 + LINE, y0 + LINE, x1 - LINE, y1 - LINE, 8)
    rect(layers["light"], x0 + LINE, y1 - LINE - 42, x1 - END - LINE / 2, y1 - LINE)
    # The sawn end: a square block of end grain, its own outline between it and the face.
    rect(layers["end"], x1 - END + LINE / 2, y0 + LINE, x1 - LINE, y1 - LINE)
    rect(layers["edge"], x1 - END - LINE / 2 + 4, y0 + LINE, x1 - END + LINE / 2, y1 - LINE)
    # A line of grain along the face, left of the strap.
    rect(layers["grain"], x0 + LINE + 70, y0 + LINE + 44, STRAP[0] - 70, y0 + LINE + 70)
# The strap, over all three, its own outline.
rect(layers["strapEdge"], STRAP[0] - LINE / 2, -140, STRAP[1] + LINE / 2, 770, 20)
rect(layers["strap"], STRAP[0] + 4, -140 + LINE / 2, STRAP[1] - 4, 770 - LINE / 2)

COLOURS = ["edge", "board", "light", "end", "grain", "edge", "strap"]
ORDER = ["edge", "board", "light", "end", "grain", "strapEdge", "strap"]
palette_keys = list(PALETTE)

# The plain glyph (where colour fonts aren't drawn): the boards' outlines.
plain = TTGlyphPen(None)
for x0, x1, y0 in BOARDS:
    rect(plain, x0, y0, x1, y0 + H, 40)

notdef = TTGlyphPen(None)
glyphs = {".notdef": notdef.glyph(), "planks": plain.glyph()}
for name in ORDER:
    glyphs[f"planks.{name}"] = layers[name].glyph()
order = list(glyphs)

fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap({CODEPOINT: "planks"})
fb.setupGlyf(glyphs)
glyf = fb.font["glyf"]
# Each layer's left side bearing is its own left edge, so the layers stay where they're drawn.
fb.setupHorizontalMetrics({g: (ADVANCE if g.startswith("planks") else 500, getattr(glyf[g], "xMin", 0)) for g in order})
fb.setupHorizontalHeader(ascent=900, descent=-250)
fb.setupOS2(sTypoAscender=900, sTypoDescender=-250, usWinAscent=900, usWinDescent=250)
fb.setupNameTable({"familyName": "Woodrail Icons", "styleName": "Regular"})
fb.setupPost()


def rgba(hex_colour):
    h = hex_colour.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


fb.font["CPAL"] = buildCPAL([[rgba(PALETTE[k]) for k in palette_keys]])
fb.font["COLR"] = buildCOLR({"planks": [(f"planks.{n}", palette_keys.index(c)) for n, c in zip(ORDER, COLOURS)]})

out = Path(__file__).resolve().parent.parent / "src" / "assets" / "woodrail-icons.woff2"
out.parent.mkdir(parents=True, exist_ok=True)
fb.font.flavor = "woff2"
fb.save(str(out))
print(out, out.stat().st_size, "bytes")
