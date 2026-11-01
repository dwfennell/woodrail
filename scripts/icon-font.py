"""Build src/assets/woodrail-icons.woff2, the game's own icons, from the drawings in src/icons/*.svg.

Each drawing is named for the character it draws: `u1FA99-coin.svg` is 🪙 (U+1FA99), `uE000-planks.svg` is planks
(private use: there's no emoji for sawn boards). They're compiled into one COLR/CPAL colour font: each shape of a
drawing is a layer of flat colour, which Chrome, Safari and Firefox draw. style.css lists the font ("Woodrail Icons")
first wherever a font is named, with a `unicode-range` of just these characters (written there by this script), so
the game's own strings keep their emoji ("40🪙"), a screen reader still says "coin", and on screen it's our drawing,
at the text's size and on its baseline, with no DOM of its own.

A drawing is a 24×24 viewBox of flat shapes: path, rect (rx), circle, ellipse, polygon, and <g>, with `fill` (a
#rrggbb colour, or currentColor for the text's own colour) and `transform` (translate, rotate, scale). No strokes or
gradients: an outline is a darker shape drawn under a smaller one, as the toy-wood icons are.

Run: python3 -m pip install fonttools brotli && python3 scripts/icon-font.py
"""

import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from fontTools.colorLib.builder import buildCOLR, buildCPAL
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src" / "icons"
OUT = ROOT / "src" / "assets" / "woodrail-icons.woff2"
CSS = ROOT / "src" / "style.css"

UPM = 1000
ADVANCE = 1240  # about an emoji's width
# The 24-unit drawing onto the em: 1.2 em square, from 0.23 em below the baseline (as an emoji sits).
SCALE = 1200 / 24
BASE = Transform(SCALE, 0, 0, -SCALE, (ADVANCE - 24 * SCALE) / 2, 970)
# Variation selectors (text and emoji presentation) as empty glyphs, so "⛏️" is drawn by this font whole.
SELECTORS = [0xFE0E, 0xFE0F]
FOREGROUND = 0xFFFF  # COLR's "the text's colour"

SVG = "{http://www.w3.org/2000/svg}"


def num(v, default=0.0):
    return float(v) if v not in (None, "") else default


def transform_of(text):
    t = Transform()
    for name, args in re.findall(r"(\w+)\s*\(([^)]*)\)", text or ""):
        a = [float(x) for x in re.split(r"[\s,]+", args.strip()) if x]
        if name == "translate":
            t = t.translate(a[0], a[1] if len(a) > 1 else 0)
        elif name == "scale":
            t = t.scale(a[0], a[1] if len(a) > 1 else a[0])
        elif name == "rotate":
            cx, cy = (a[1], a[2]) if len(a) > 2 else (0, 0)
            t = t.translate(cx, cy).rotate(math.radians(a[0])).translate(-cx, -cy)
        else:
            sys.exit(f"transform {name} isn't supported")
    return t


def shape_path(el):
    """An element as SVG path data."""
    tag = el.tag.replace(SVG, "")
    if tag == "path":
        return el.get("d")
    if tag == "rect":
        x, y, w, h = (num(el.get(k)) for k in ("x", "y", "width", "height"))
        r = min(num(el.get("rx"), num(el.get("ry"))), w / 2, h / 2)
        if r <= 0:
            return f"M{x},{y}h{w}v{h}h{-w}z"
        return (f"M{x + r},{y}h{w - 2 * r}a{r},{r} 0 0 1 {r},{r}v{h - 2 * r}a{r},{r} 0 0 1 {-r},{r}"
                f"h{-(w - 2 * r)}a{r},{r} 0 0 1 {-r},{-r}v{-(h - 2 * r)}a{r},{r} 0 0 1 {r},{-r}z")
    if tag in ("circle", "ellipse"):
        cx, cy = num(el.get("cx")), num(el.get("cy"))
        rx = num(el.get("r")) if tag == "circle" else num(el.get("rx"))
        ry = num(el.get("r")) if tag == "circle" else num(el.get("ry"))
        return f"M{cx - rx},{cy}a{rx},{ry} 0 1 0 {2 * rx},0a{rx},{ry} 0 1 0 {-2 * rx},0z"
    if tag == "polygon":
        pts = [float(v) for v in re.split(r"[\s,]+", el.get("points").strip())]
        return "M" + " L".join(f"{pts[i]},{pts[i + 1]}" for i in range(0, len(pts), 2)) + "z"
    sys.exit(f"<{tag}> isn't supported")


def layers_of(svg_file):
    """The drawing's shapes, in order: (path data, transform, fill)."""
    out = []

    def walk(el, t, fill):
        t = t.transform(transform_of(el.get("transform"))) if el.get("transform") else t
        fill = el.get("fill", fill)
        tag = el.tag.replace(SVG, "")
        if tag in ("svg", "g"):
            for child in el:
                walk(child, t, fill)
        elif tag in ("title", "desc"):
            pass
        else:
            if fill in (None, "none"):
                sys.exit(f"{svg_file.name}: a <{tag}> with no fill")
            out.append((shape_path(el), t, fill.lower()))

    walk(ET.parse(svg_file).getroot(), Transform(), None)
    return out


def main():
    files = sorted(ICONS.glob("u*-*.svg"))
    order, chars, layers, glyph_layers, palette = [".notdef", "vs"], {}, {}, {}, []
    for f in files:
        code, name = f.stem.split("-", 1)
        cp = int(code[1:], 16)
        base = name
        order.append(base)
        chars[cp] = base
        glyph_layers[base] = []
        for i, (d, t, fill) in enumerate(layers_of(f)):
            g = f"{base}.{i}"
            order.append(g)
            layers[g] = (d, t)
            if fill == "currentcolor":
                index = FOREGROUND
            else:
                if fill not in palette:
                    palette.append(fill)
                index = palette.index(fill)
            glyph_layers[base].append((g, index))
    for cp in SELECTORS:
        chars[cp] = "vs"

    charstrings, bounds = {}, {}

    def draw(name, items):
        pen = T2CharStringPen(ADVANCE if name not in (".notdef", "vs") else 0, None)
        bp = BoundsPen(None)
        for d, t in items:
            m = BASE.transform(t)
            parse_path(d, TransformPen(pen, m))
            parse_path(d, TransformPen(bp, m))
        charstrings[name] = pen.getCharString()
        bounds[name] = bp.bounds

    draw(".notdef", [])
    draw("vs", [])
    for base, ls in glyph_layers.items():
        draw(base, [layers[g] for g, _ in ls])  # the plain glyph: every shape, for where colour isn't drawn
        for g, _ in ls:
            draw(g, [layers[g]])

    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(chars)
    fb.setupCFF("WoodrailIcons-Regular", {"FullName": "Woodrail Icons"}, charstrings, {})
    widths = {g: (0 if g in (".notdef", "vs") else ADVANCE) for g in order}
    fb.setupHorizontalMetrics({g: (widths[g], round(bounds[g][0]) if bounds[g] else 0) for g in order})
    fb.setupHorizontalHeader(ascent=970, descent=-250)
    fb.setupOS2(sTypoAscender=970, sTypoDescender=-250, usWinAscent=970, usWinDescent=250)
    fb.setupNameTable({"familyName": "Woodrail Icons", "styleName": "Regular"})
    fb.setupPost()

    def rgba(h):
        h = h.lstrip("#")
        return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)

    fb.font["CPAL"] = buildCPAL([[rgba(c) for c in palette]])
    fb.font["COLR"] = buildCOLR(glyph_layers)
    fb.font.flavor = "woff2"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(OUT))

    # The CSS face's unicode-range: exactly the characters drawn.
    ranges = ", ".join(f"U+{cp:04X}" for cp in sorted(chars))
    css = CSS.read_text()
    new, n = re.subn(r"(font-family: \"Woodrail Icons\";[^}]*unicode-range: )[^;]*;", lambda m: m.group(1) + ranges + ";", css)
    if n != 1:
        sys.exit("style.css: no Woodrail Icons @font-face to give the unicode-range")
    CSS.write_text(new)
    print(f"{OUT.relative_to(ROOT)}: {len(files)} icons, {len(order)} glyphs, {len(palette)} colours, {OUT.stat().st_size} bytes")


main()
