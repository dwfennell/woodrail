"""
A SPIKE (not in the game): one town block in the look of a modern painted wooden toy village, to stand beside today's
town buildings. Solid blocks under smooth paint, every edge eased; a roof a block of its own colour; windows and doors
printed flat on the faces in cream lines, as the painted cars' are.

    ~/.venvs/woodrail-bpy/bin/python tools/blender/toyblock.py

Writes tools/blender/out/toyblock.glb: `toy-block`, three of the game's squares long and one deep (216 x 72 mm), its
street side on -y (the game's +z), y = 0 its middle; and `toy-street`, a street's length to lie in front of it.
A joined row: a corner shop, three terraced houses and a town house, on a pavement, a strip of garden behind.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402, F401

import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import toy  # noqa: E402
from toy import ball, box, dome, lathe, paint  # noqa: E402

CELL = 72.0
CREAM = paint("#f6ecd2")
PANE = paint("#2a3640")
STONE = paint("#d8d0bf")
SLATE = paint("#4d5d6e")
TILE = paint("#b9462f")
MOSS = paint("#2f6048")
BLACK = paint("#26272a")
FRONT = -22.0  # the building line (y): 14 mm of pavement before it
BASE = 2.4  # the pavement's top


def plate(mat, w, h, at, cr=0.8, facing=0.0, lift=0.3):
    """Print on a face: a flat rounded rectangle `w` x `h` centred at `at`, looking -y turned `facing` degrees about z, `lift` off it."""
    cr = min(cr, w / 2, h / 2)
    pts = []
    for cx, cz, a0 in ((w / 2 - cr, -h / 2 + cr, -90), (w / 2 - cr, h / 2 - cr, 0), (-w / 2 + cr, h / 2 - cr, 90), (-w / 2 + cr, -h / 2 + cr, 180)):
        n = 5 if cr > 0.05 else 0
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / max(1, n))
            pts.append((cx + cr * math.cos(a), cz + cr * math.sin(a)))
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, -lift, z)) for x, z in pts])
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(facing), 3, "Z"), verts=bm.verts)
    obj = toy._link("print", bm, mat, at)
    obj["flat"] = True
    return obj


def prism(mat, outline, length, axis, at, r=1.0, name="prism"):
    """An outline of (a, z) points (anticlockwise) drawn across `axis` and cut `length` long along it, its edges eased."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((-length / 2, a, z) if axis == "X" else (a, -length / 2, z)) for a, z in outline])
    made = bmesh.ops.extrude_face_region(bm, geom=[face])["geom"]
    bmesh.ops.translate(bm, vec=(length, 0, 0) if axis == "X" else (0, length, 0), verts=[v for v in made if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return toy.round_edges(toy._smooth(toy._link(name, bm, mat, at)), r, 3)


def gable(mat, length, span, rise, axis, at, lip=2.2):
    """A roof block: a ridge along `axis`, `span` across, `rise` over a `lip` of eaves; `at` its base's middle."""
    return prism(mat, [(-span / 2, 0), (span / 2, 0), (span / 2, lip), (0, rise + lip), (-span / 2, lip)], length, axis, at, 1.1, "roof")


def hip(mat, w, d, rise, inset, at, lip=2.2):
    """A roof block sloping in on all four sides to a flat top `inset` in from each edge."""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in [(sx * w / 2, sy * d / 2, z) for z in (0, lip) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))] + [(sx * (w / 2 - inset), sy * (d / 2 - inset), lip + rise) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]]
    bm.faces.new(v[0:4][::-1])
    bm.faces.new(v[8:12])
    for lo in (0, 4):
        for k in range(4):
            j = (k + 1) % 4
            bm.faces.new((v[lo + k], v[lo + j], v[lo + 4 + j], v[lo + 4 + k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return toy.round_edges(toy._smooth(toy._link("roof", bm, mat, at)), 1.1, 3)


def window(x, z, w=6.6, h=9.0, y=FRONT, facing=0.0, bars=True, arch=False):
    """A printed window: a cream frame, a dark pane, fine glazing bars."""
    at = (x, y, z)
    plate(CREAM, w, h, at, w / 2 if arch else 1.0, facing, 0.3)
    plate(PANE, w - 1.6, h - 1.6, at, (w - 1.6) / 2 if arch else 0.5, facing, 0.5)
    if bars:
        plate(CREAM, w - 1.6, 0.45, at, 0, facing, 0.7)
        plate(CREAM, 0.45, h - 1.6, at, 0, facing, 0.7)


def door(x, colour, w=7.4, h=13.0, y=FRONT):
    """A printed door (its top rounded) in a cream surround, a step before it and a brass knob."""
    plate(CREAM, w + 2.0, h + 1.0, (x, y, BASE + (h + 1.0) / 2), (w + 2.0) / 2, 0, 0.3)
    plate(paint(colour), w, h, (x, y, BASE + h / 2), w / 2, 0, 0.5)
    ball(paint("#e2b53c"), 0.75, (x + w / 2 - 1.7, y - 0.6, BASE + h * 0.45), 10)
    box(STONE, (w + 4, 3.2, 1.2), (x, y - 1.6, BASE + 0.6), r=0.5)


def chimney(x, y, z, colour="#c9b79a"):
    box(paint(colour), (5.2, 5.2, 9), (x, y, z + 4.5), r=0.9)
    box(BLACK, (6.2, 6.2, 1.6), (x, y, z + 9.4), r=0.6)


def body(colour, x, w, d, h):
    """A building's block: `w` along the street from its middle `x`, `d` deep from the building line, `h` to its eaves."""
    return box(paint(colour), (w, d, h), (x, FRONT + d / 2, BASE + h / 2), r=1.6)


def back(x, d, xs, zs):
    """Windows on a building's garden side."""
    for z in zs:
        for wx in xs:
            window(x + wx, BASE + z, y=FRONT + d, facing=180)


def shop(x, w=50.0, d=44.0, h=42.0):
    body("#f3e7cb", x, w, d, h)
    # The shop front: one wide window, the door beside it, a fascia board over both and a striped awning.
    window(x - 6.5, BASE + 10.5, 27, 13, bars=False)
    for k in (-1, 0, 1):
        plate(CREAM, 0.45, 11.4, (x - 6.5 + k * 6.6, FRONT, BASE + 10.5), 0, 0, 0.7)
    door(x + 16, "#2f6048")
    box(MOSS, (w - 4, 1.8, 5.2), (x, FRONT - 0.7, BASE + 21.4), r=0.6)
    plate(CREAM, 22, 1.5, (x, FRONT - 1.6, BASE + 21.4), 0.7, 0, 0.3)
    for k in range(6):
        slab = box(paint("#d8392b") if k % 2 == 0 else CREAM, (5.4, 10.5, 1.3), (x - 6.5 + (k - 2.5) * 5.4, FRONT - 5.6, BASE + 17.2), r=0.4)
        slab.rotation_euler = (math.radians(-22), 0, 0)
    for wx in (-15, 0, 15):
        window(x + wx, BASE + 32.5)
    # (The street corner: its side has windows too.)
    for wy in (10, 30):
        window(x - w / 2, BASE + 32.5, y=FRONT + wy, facing=-90)
        window(x - w / 2, BASE + 11, y=FRONT + wy, facing=-90)
    back(x, d, (-15, 0, 15), (11, 32.5))
    gable(TILE, w + 2.4, d + 3.0, 15, "X", (x, FRONT + d / 2, BASE + h - 0.4))
    chimney(x + 14, FRONT + d / 2 + 9, BASE + h + 6)


def terrace(x, colour, roof, door_colour, w=34.0, d=40.0, h=40.0, door_at=-1):
    body(colour, x, w, d, h)
    door(x + door_at * 8.5, door_colour)
    window(x - door_at * 7.5, BASE + 10.5, 8.6, 9.6)
    for wx in (-8, 8):
        window(x + wx, BASE + 29.5)
    back(x, d, (-8, 8), (10.5, 29.5))
    gable(roof, w + 0.6, d + 3.0, 13, "X", (x, FRONT + d / 2, BASE + h - 0.4))
    chimney(x - door_at * 10, FRONT + d / 2 + 6, BASE + h + 7)


def tall_gable(x, colour, roof, door_colour, w=34.0, d=42.0, h=50.0):
    """A narrow house a storey taller, its gable to the street."""
    body(colour, x, w, d, h)
    # (The gable's wall, in the house's colour, under the roof block.)
    prism(paint(colour), [(-w / 2, 0), (w / 2, 0), (0, 14.5)], d - 2.4, "Y", (x, FRONT + d / 2, BASE + h - 0.6), 0.8, "gable-wall")
    door(x - 8.5, door_colour)
    window(x + 7.5, BASE + 10.5, 8.6, 9.6)
    for z in (28.5, 43.5):
        for wx in (-8, 8):
            window(x + wx, BASE + z, 6.2, 8.4)
    window(x, BASE + h + 5.2, 5.6, 5.6, y=FRONT + 1.2, bars=False, arch=True)
    back(x, d, (-8, 8), (10.5, 28.5, 43.5))
    # The roof: two slabs meeting at the ridge, overhanging the gable.
    rise, span = 16.5, w + 4.4
    prism(roof, [(-span / 2, 0), (-span / 2 + 2.6, 0), (0, rise - 2.9), (span / 2 - 2.6, 0), (span / 2, 0), (span / 2, 0.9), (0, rise), (-span / 2, 0.9)], d + 3.0, "Y", (x, FRONT + d / 2, BASE + h - 1.4), 0.6, "roof")


def town_house(x, w=50.0, d=46.0, h=60.0):
    body("#3f6fb0", x, w, d, h)
    door(x, "#f3e7cb", 8.4, 14.5)
    for wx in (-15.5, 15.5):
        window(x + wx, BASE + 10.5, 8.0, 10.5)
    for z in (30, 48.5):
        for wx in (-15.5, 0, 15.5):
            window(x + wx, BASE + z, 6.8, 10.0)
    # String courses: a cream band at the first floor and under the eaves.
    box(CREAM, (w + 0.9, d + 0.9, 1.6), (x, FRONT + d / 2, BASE + 20.4), r=0.5)
    box(CREAM, (w + 2.6, d + 2.6, 2.4), (x, FRONT + d / 2, BASE + h - 0.4), r=0.8)
    for wy in (10, 32):
        for z in (10.5, 30, 48.5):
            window(x + w / 2, BASE + z, 6.8, 10.0, y=FRONT + wy, facing=90)
    back(x, d, (-15.5, 0, 15.5), (10.5, 30, 48.5))
    hip(SLATE, w + 3.0, d + 3.0, 11, 12, (x, FRONT + d / 2, BASE + h + 0.8))
    chimney(x - 13, FRONT + d / 2, BASE + h + 8, "#f3e7cb")
    chimney(x + 13, FRONT + d / 2, BASE + h + 8, "#f3e7cb")


def tree(x, y, r=8.5, h=13.0, colour="#3f8f4a", cone=False):
    lathe("wood", [(0.0, 0), (2.9, 0), (2.9, 0.9), (1.5, 1.6), (1.4, h), (0.0, h)], (x, y, BASE), "Z", 16)
    if cone:
        lathe(paint(colour), [(0.0, 0), (r - 1.0, 0), (r, 1.0), (r * 0.62, r * 1.05), (r * 0.74, r * 1.1), (r * 0.36, r * 2.0), (r * 0.5, r * 2.06), (0.6, r * 3.0), (0.0, r * 3.02)], (x, y, BASE + h - 2), "Z", 24)
    else:
        ball(paint(colour), r, (x, y, BASE + h + r * 0.78), 24, squash=0.92)


def lamp(x, y):
    lathe(BLACK, [(0.0, 0), (2.0, 0), (2.0, 0.8), (0.8, 1.6), (0.7, 22), (1.5, 22.6), (0.0, 22.6)], (x, y, BASE), "Z", 14)
    ball(paint("#fbefc4"), 2.3, (x, y, BASE + 24.4), 14)
    dome(BLACK, 2.7, 1.3, (x, y, BASE + 25.8), 14)


def postbox(x, y):
    lathe(paint("#d8392b"), [(0.0, 0), (2.6, 0), (2.6, 8.0), (2.9, 8.2), (2.9, 9.0)] + [(2.9 * math.cos(math.pi / 2 * k / 5), 9.0 + 1.6 * math.sin(math.pi / 2 * k / 5)) for k in range(1, 6)], (x, y, BASE), "Z", 18)
    lathe(BLACK, [(0.0, 0), (2.9, 0), (2.9, 1.2), (0.0, 1.2)], (x, y, BASE), "Z", 18)


def block():
    L = 3 * CELL
    box(STONE, (L - 1.0, CELL - 1.0, BASE), (0, 0, BASE / 2), r=0.9, name="pavement")
    box(paint("#6aa64a"), (L - 10, 13, 1.0), (0, 28, BASE + 0.4), r=0.5, name="garden")
    shop(-76)
    terrace(-34, "#c8483a", SLATE, "#f3e7cb")
    tall_gable(0, "#e6ae3e", MOSS, "#3f6fb0")
    terrace(34, "#57a394", TILE, "#f3e7cb", door_at=1)
    town_house(76)
    for x, cone in ((-88, False), (-52, True), (-12, False), (22, False), (58, True), (92, False)):
        tree(x, 28.5 + (3 if cone else 0), 6.2 if cone else 7.6, 9.5, "#2f7d4a" if cone else "#4b9a4f", cone)
    for x in (-51, 17, 51):
        lamp(x, -31)
    tree(-17, -30.5, 5.6, 11, "#5aa85a")
    postbox(-98, -30)


def street():
    """The street before the block: a grey felt-coloured strip, cream dashes down its middle."""
    L = 3 * CELL
    box(paint("#8d8a82"), (L, CELL, 0.8), (0, 0, 0.4), r=0.3, name="road")
    for k in range(9):
        p = box(CREAM, (11, 1.6, 0.2), (-L / 2 + 12 + k * 24, 0, 0.82), r=0.05)
        p["flat"] = True


def main():
    toy.reset()
    toy.begin()
    block()
    bpy.context.view_layer.update()  # (the awning's slabs are turned: their places, before they're baked)
    toy.finish("toy-block", (0, 0, 0))
    toy.begin()
    street()
    toy.finish("toy-street", (0, -120, 0))
    toy.save_and_export("toyblock")


main()
