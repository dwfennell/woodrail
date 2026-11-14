"""
Towns in rows (spec 2026-11-14-town-rows-design.md): a town's houses and shops as slices that fill their lots and join
their neighbours into rows. Solid blocks under paint, every edge eased; a roof a block of its own colour; windows and
doors printed flat on the faces in cream and dark; each on a tile of pavement with a strip of garden behind.

    ~/.venvs/woodrail-bpy/bin/python tools/blender/bldg_rows.py     (then gltfpack: `npm run models`)

Writes tools/blender/out/rows.glb. Each model `<id>` comes four ways, for the game to stack storeys from
(src/props/storeys.ts `stackOf`): `<id>` (its tile, one storey, its roof), `<id>-ground` (tile and storey, no roof),
`<id>-floor` (a plain storey) and `<id>-upper` (a storey under the roof). A storey is 20 mm (the flats' 24); a floor
or upper is modelled where it sits on a ground, so the game lifts it only by whole storeys.

A lot is the game's square, 72 mm. A model's origin is its lot's middle on the ground; its street is on +x; it is
drawn 70 mm along the street (y) a square, its building line 14 mm in from the street edge. A two-square model spans
two squares along y, the court two each way.

Colours the game swaps for the building's own (src/props/rows.ts `rowColours`): body `lacquer #ff00a0`, a pair's or
terrace's second house `lacquer #ffa000`, roof `lacquer #00ffa0`, door `lacquer #a000ff`. Everything else keeps its
colour in every town (`lacquer fixed …`).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402, F401

import bmesh  # noqa: E402
from mathutils import Matrix  # noqa: E402

import toy  # noqa: E402
from toy import box, lathe  # noqa: E402

BODY, SECOND, ROOF, DOOR = "lacquer #ff00a0", "lacquer #ffa000", "lacquer #00ffa0", "lacquer #a000ff"


def fixed(colour):
    return f"lacquer fixed {colour}"


CREAM = fixed("#f6ecd2")
PANE = fixed("#2a3640")
STONE = fixed("#d8d0bf")
GRASS = fixed("#6aa64a")
BLACK = fixed("#26272a")
BRASS = fixed("#e2b53c")
RED = fixed("#d8392b")
LEAF = fixed("#4b9a4f")
PINE = fixed("#2f7d4a")

CELL = 72.0
BASE = 2.4  # the pavement's top
FX = CELL / 2 - 14  # the building line
FRONT, BACK, LEFT, RIGHT = 90.0, -90.0, 0.0, 180.0  # which way a print looks: +x, -x, -y, +y


def plate(mat, w, h, at, facing, cr=0.0, lift=0.3):
    """Print on a face: a flat rectangle `w` x `h` centred at `at` on a face looking `facing`, `lift` off it; `cr` rounds its top."""
    if cr > 0.05:
        cr = min(cr, w / 2)
        pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2 - cr)]
        pts += [(w / 2 - cr + cr * math.cos(math.radians(a)), h / 2 - cr + cr * math.sin(math.radians(a))) for a in (30, 60, 90)]
        if w / 2 - cr > 0.05:
            pts.append((-w / 2 + cr, h / 2))
        pts += [(-w / 2 + cr + cr * math.cos(math.radians(a)), h / 2 - cr + cr * math.sin(math.radians(a))) for a in (120, 150, 180)]
    else:
        pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, -lift, z)) for x, z in pts])
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(facing), 3, "Z"), verts=bm.verts)
    obj = toy._link("print", bm, mat, at)
    obj["flat"] = True
    return obj


def prism(mat, outline, length, axis, at, r=0.9, name="prism"):
    """An outline of (a, z) points (anticlockwise) drawn across `axis` and cut `length` long along it, its edges eased."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((-length / 2, a, z) if axis == "X" else (a, -length / 2, z)) for a, z in outline])
    made = bmesh.ops.extrude_face_region(bm, geom=[face])["geom"]
    bmesh.ops.translate(bm, vec=(length, 0, 0) if axis == "X" else (0, length, 0), verts=[v for v in made if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return toy.round_edges(toy._smooth(toy._link(name, bm, mat, at)), r, 2)


def block(mat, size, at, r=1.4):
    return box(mat, size, at, r=r, seg=2)


class Unit:
    """One building of a slice: `w` along the street about `y`, `d` deep from the building line, a storey `h` high."""

    def __init__(self, y, w, d=40.0, h=20.0, body=BODY, roof="ridge", rise=13.0, ground=None, ups=(-8, 8), chimney=1, sides=(), band=False):
        self.y, self.w, self.d, self.h, self.body = y, w, d, h, body
        self.roof, self.rise, self.ground, self.ups, self.chimney, self.sides, self.band = roof, rise, ground, ups, chimney, sides, band

    @property
    def cx(self):
        return FX - self.d / 2

    def window(self, along, z, w=6.4, h=8.6, facing=FRONT, bars=True):
        """A printed window on one of the unit's faces, `along` it from its middle, its middle `z` over the storey's floor."""
        if facing in (FRONT, BACK):
            at = (FX if facing == FRONT else FX - self.d, self.y + along, BASE + z)
        else:
            at = (self.cx + along, self.y + (self.w / 2 if facing == RIGHT else -self.w / 2), BASE + z)
        plate(CREAM, w, h, at, facing, 0, 0.3)
        plate(PANE, w - 1.6, h - 1.6, at, facing, 0, 0.5)
        if bars:
            plate(CREAM, w - 1.6, 0.5, at, facing, 0, 0.7)
            plate(CREAM, 0.5, h - 1.6, at, facing, 0, 0.7)

    def door(self, along, w=7.2, h=12.6, mat=DOOR):
        """A printed door, its top rounded, in a cream surround; a step before it and a brass knob."""
        y = self.y + along
        plate(CREAM, w + 2.0, h + 1.0, (FX, y, BASE + (h + 1.0) / 2), FRONT, (w + 2.0) / 2, 0.3)
        plate(mat, w, h, (FX, y, BASE + h / 2), FRONT, w / 2, 0.5)
        lathe(BRASS, [(0.0, -0.7), (0.7, 0), (0.0, 0.7)], (FX + 0.6, y + w / 2 - 1.7, BASE + h * 0.45), "X", 6)
        block(STONE, (3.0, w + 3.6, 1.1), (FX + 1.5, y, BASE + 0.55), 0.4)

    def storey(self, ground):
        """The storey's block and what's printed on it: the ground floor's own front, or a plain floor's windows."""
        block(self.body, (self.d, self.w, self.h), (self.cx, self.y, BASE + self.h / 2))
        mid = self.h * 0.53
        if ground and self.ground:
            self.ground(self)
        else:
            for a in self.ups:
                self.window(a, mid)
        for a in self.ups if len(self.ups) <= 3 else self.ups[::2]:
            self.window(a, mid, facing=BACK)
        for facing in self.sides:
            for a in (-self.d / 4, self.d / 4):
                self.window(a, mid, facing=facing)
        if self.band and not ground:
            block(CREAM, (self.d + 0.8, self.w + 0.8, 1.4), (self.cx, self.y, BASE + 0.7), 0.4)

    def top(self):
        """The roof block on a storey, and its chimney."""
        z = BASE + self.h - 0.4
        lip = 2.0
        if self.roof == "ridge":  # its ridge along the street
            s = self.d + 3.0
            prism(ROOF, [(-s / 2, 0), (s / 2, 0), (s / 2, lip), (0, self.rise + lip), (-s / 2, lip)], self.w + 0.5, "Y", (self.cx, self.y, z), name="roof")
            cz = z + lip + self.rise * 0.45
        elif self.roof == "gable":  # its gable to the street: the wall runs up into it
            prism(self.body, [(-self.w / 2, 0), (self.w / 2, 0), (0, self.rise)], self.d - 2.0, "X", (self.cx, self.y, z + 0.2), 0.7, "gable")
            s = self.w + 1.6
            prism(ROOF, [(-s / 2, 0), (-s / 2 + 2.4, 0), (0, self.rise - 1.6), (s / 2 - 2.4, 0), (s / 2, 0), (s / 2, 0.9), (0, self.rise + 1.0), (-s / 2, 0.9)], self.d + 3.0, "X", (self.cx, self.y, z - 0.6), 0.5, "roof")
            plate(CREAM, 5.0, 5.0, (FX + 0.9, self.y, z + self.rise * 0.38), FRONT, 2.5, 0.3)
            plate(PANE, 3.4, 3.4, (FX + 0.9, self.y, z + self.rise * 0.38), FRONT, 1.7, 0.5)
            cz = z + self.rise * 0.5
        else:  # hipped: sloping in on all four sides to a flat top
            w, d, inset = self.w + 2.0, self.d + 2.6, min(self.w, self.d) * 0.3
            bm = bmesh.new()
            v = [bm.verts.new(p) for p in [(sx * d / 2, sy * w / 2, zz) for zz in (0, lip) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))] + [(sx * (d / 2 - inset), sy * (w / 2 - inset), lip + self.rise) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]]
            bm.faces.new(v[0:4][::-1])
            bm.faces.new(v[8:12])
            for lo in (0, 4):
                for k in range(4):
                    j = (k + 1) % 4
                    bm.faces.new((v[lo + k], v[lo + j], v[lo + 4 + j], v[lo + 4 + k]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            toy.round_edges(toy._smooth(toy._link("roof", bm, ROOF, (self.cx, self.y, z))), 0.9, 2)
            cz = z + lip + self.rise - 2
        for k in range(self.chimney):
            cy = self.y + (self.w / 2 - 6) * (-1 if k == 0 else 1) if self.roof != "gable" else self.y
            cxx = self.cx - self.d * 0.22
            block(fixed("#c9b79a"), (4.8, 4.8, 8), (cxx, cy, cz + 3), 0.7)
            block(BLACK, (5.8, 5.8, 1.4), (cxx, cy, cz + 7.4), 0.5)


# ——— Ground floors ———


def house_front(door_at, win_at, win_w=8.0):
    def draw(u):
        u.door(door_at)
        u.window(win_at, u.h * 0.53, win_w, 9.4)

    return draw


def wide_front(u):
    u.door(0, 8.0, 13.4)
    for a in (-20, 20):
        u.window(a, u.h * 0.53, 9.0, 9.8)


def shop_front(awning=None, sign=14.0, door_at=None):
    """A shop's ground floor: one wide window, the door beside it, a fascia board over both, an awning if it has one."""

    def draw(u):
        d_at = u.w / 2 - 10 if door_at is None else door_at
        ww = u.w - 30
        wy = -u.w / 2 + 6 + ww / 2
        u.window(wy, 9.6, ww, 12.4, bars=False)
        for k in range(1, int(ww // 9)):
            plate(CREAM, 0.5, 10.8, (FX, u.y + wy - ww / 2 + k * ww / int(ww // 9), BASE + 9.6), FRONT, 0, 0.7)
        u.door(d_at)
        block(DOOR, (1.6, u.w - 3, 3.6), (FX + 0.6, u.y, BASE + 17.9), 0.5)
        plate(CREAM, sign, 1.3, (FX + 1.4, u.y, BASE + 17.9), FRONT, 0, 0.3)
        if awning:
            n = max(3, int(ww // 5.4))
            for k in range(n):
                slab = block(awning[k % 2], (9.5, ww / n, 1.1), (FX + 5.0, u.y + wy - ww / 2 + (k + 0.5) * ww / n, BASE + 14.2), 0.3)
                slab.rotation_euler = (0, math.radians(20), 0)

    return draw


def flats_front(u):
    u.door(0, 9.0, 15.0)
    for a in (-56, -42, -28, -14, 14, 28, 42, 56):
        u.window(a, u.h * 0.5, 6.6, 10.0)


# ——— What stands on a tile ———


def tree(x, y, r=7.0, h=9.0, cone=False):
    lathe("wood", [(0.0, 0), (2.4, 0), (2.4, 0.8), (1.3, 1.5), (1.2, h), (0.0, h)], (x, y, BASE), "Z", 8)
    if cone:
        lathe(PINE, [(0.0, 0), (r - 0.8, 0), (r, 0.9), (r * 0.6, r * 1.05), (r * 0.72, r * 1.1), (0.5, r * 2.5), (0.0, r * 2.52)], (x, y, BASE + h - 2), "Z", 10)
    else:
        lathe(LEAF, [(0.0, -r * 0.9)] + [(r * math.sin(math.pi * k / 6), -r * 0.9 * math.cos(math.pi * k / 6)) for k in range(1, 6)] + [(0.0, r * 0.9)], (x, y, BASE + h + r * 0.72), "Z", 10)


def lamp(y):
    x = CELL / 2 - 5
    lathe(BLACK, [(0.0, 0), (1.8, 0), (1.8, 0.7), (0.7, 1.4), (0.6, 21), (1.3, 21.6), (0.0, 21.6)], (x, y, BASE), "Z", 6)
    lathe(fixed("#fbefc4"), [(0.0, -2.1), (1.5, -1.5), (2.1, 0), (1.5, 1.5), (0.0, 2.1)], (x, y, BASE + 23.4), "Z", 8)
    lathe(BLACK, [(0.0, 0), (2.5, 0), (1.6, 0.9), (0.0, 1.2)], (x, y, BASE + 25.0), "Z", 8)


def postbox(y):
    x = CELL / 2 - 6
    lathe(RED, [(0.0, 0), (2.5, 0), (2.5, 8.0), (2.8, 8.2), (2.8, 9.0), (2.0, 10.2), (0.0, 10.6)], (x, y, BASE), "Z", 10)
    lathe(BLACK, [(0.0, 0), (2.8, 0), (2.8, 1.1), (0.0, 1.1)], (x, y, BASE), "Z", 10)


def table(x, y):
    lathe(CREAM, [(0.0, 0), (1.6, 0), (0.5, 0.6), (0.5, 5.4), (3.4, 5.4), (3.4, 6.2), (0.0, 6.2)], (x, y, BASE), "Z", 8)


def tile(squares=1, deep=1, trees=(), cones=(), lamps=(), extra=None):
    """The lot's tile: pavement over it all, a strip of garden behind, trees in the garden, what stands by the kerb."""
    w = CELL * squares
    x0 = CELL / 2 - CELL * deep  # the lot's back edge
    block(STONE, (CELL * deep, w, BASE), (x0 + CELL * deep / 2, 0, BASE / 2), 0.6)
    gd = (FX - 40.0) - x0 - 2.5  # the garden: from behind the shallowest building to the back edge
    block(GRASS, (gd, w - 6, 0.9), (x0 + 1.5 + gd / 2, 0, BASE + 0.35), 0.4)
    for y in trees:
        tree(x0 + 7, y)
    for y in cones:
        tree(x0 + 7.5, y, 5.6, 8.0, True)
    for y in lamps:
        lamp(y)
    if extra:
        extra()


# ——— The models ———


def model(name, units, **on_tile):
    """`name` four ways: whole, its ground (no roof), a plain floor, and its top storey under the roof."""
    for suffix, ground, roof, with_tile in (("", True, True, True), ("-ground", True, False, True), ("-floor", False, False, False), ("-upper", False, True, False)):
        toy.begin()
        if with_tile:
            tile(**on_tile)
        for u in units:
            u.storey(ground)
            if roof:
                u.top()
        bpy.context.view_layer.update()  # (an awning's slabs are turned: their places, before they're baked)
        toy.finish(f"{name}{suffix}", (LAYOUT[0] * 180, len(MODELS) * 0 + LAYOUT[1] * 200, 0))
        LAYOUT[0] += 1
    LAYOUT[0] = 0
    LAYOUT[1] += 1


LAYOUT = [0, 0]
MODELS = []
STRIPES = (RED, CREAM)


def main():
    toy.reset()
    W = 34.6
    L, R = -17.5, 17.5
    # Two narrow houses on a square, each under its own roof.
    model("row-pair-a", [Unit(L, W, ground=house_front(-8, 8), sides=(LEFT,)), Unit(R, W, body=SECOND, ground=house_front(8, -8), sides=(RIGHT,))], trees=(-18,), cones=(16,), lamps=(0,))
    model("row-pair-b", [Unit(L, W, ground=house_front(-8, 8), sides=(LEFT,)), Unit(R, W, d=42, body=SECOND, roof="gable", rise=15, ground=house_front(8, -8), sides=(RIGHT,))], trees=(18,))
    model("row-pair-c", [Unit(L, W, d=44, rise=15, ground=house_front(8, -8), sides=(LEFT,)), Unit(R, W, body=SECOND, ground=house_front(-8, 8), sides=(RIGHT,))], cones=(-20, 4), lamps=(-30,))
    # One house the width of its lot.
    model("row-wide-a", [Unit(0, 69.4, d=44, rise=14, ground=wide_front, ups=(-20, 0, 20), chimney=2, sides=(LEFT, RIGHT))], trees=(-20, 20))
    model("row-wide-b", [Unit(0, 69.4, d=46, roof="hip", rise=10, ground=wide_front, ups=(-20, 0, 20), chimney=2, sides=(LEFT, RIGHT), band=True)], trees=(0,), lamps=(28,))
    model("row-wide-c", [Unit(-14, 41, d=44, rise=14, ground=house_front(-10, 8, 9), ups=(-10, 8), sides=(LEFT,)), Unit(20.8, 27.6, d=46, roof="gable", rise=13, ground=lambda u: u.window(0, u.h * 0.53, 10, 10), ups=(0,), chimney=0, sides=(RIGHT,))], cones=(22,), trees=(-12,))
    # A cottage and a bungalow: they stay low.
    model("row-low-a", [Unit(0, 62, d=42, roof="hip", rise=15, ground=house_front(-14, 12, 10), ups=(-16, 12), sides=(LEFT, RIGHT))], trees=(-24,), cones=(24,))
    model("row-low-b", [Unit(0, 67, d=44, rise=11, ground=wide_front, ups=(-20, 0, 20), sides=(LEFT, RIGHT))], trees=(22,), lamps=(-30,))
    # Shops.
    model("row-shop", [Unit(0, 69.4, d=44, rise=14, ground=shop_front(STRIPES), ups=(-20, 0, 20), sides=(LEFT, RIGHT))], cones=(-22,))
    model("row-toy-shop", [Unit(0, 69.4, d=44, roof="gable", rise=22, ground=shop_front((fixed("#e6ae3e"), fixed("#3f6fb0")), 20), ups=(-20, 0, 20), chimney=0, sides=(LEFT, RIGHT))], trees=(20,))

    def corner_side():
        # Its second front, on the side street (-y): a window and its fascia.
        u = Unit(0, 69.4, d=46)
        u.window(0, 9.6, 26, 12.4, facing=LEFT, bars=False)
        block(DOOR, (u.d - 3, 1.2, 3.6), (u.cx, -u.w / 2 - 0.3, BASE + 17.9), 0.4)

    model("row-corner-shop", [Unit(0, 69.4, d=46, roof="hip", rise=11, ground=shop_front(STRIPES, door_at=-24), ups=(-20, 0, 20), sides=(RIGHT,))], lamps=(30,), extra=corner_side)
    # Two squares along the street.
    T = 35.2
    model("row-terrace", [Unit(-52.8, T, ground=house_front(-8, 8), sides=(LEFT,)), Unit(-17.6, T, body=SECOND, ground=house_front(8, -8)), Unit(17.6, T, d=42, roof="gable", rise=15, ground=house_front(-8, 8)), Unit(52.8, T, body=SECOND, ground=house_front(8, -8), sides=(RIGHT,))], squares=2, trees=(-50, 10), cones=(-20, 44), lamps=(-36, 36))
    model("row-bakery", [Unit(-20, 100, d=44, rise=14, ground=shop_front(STRIPES, 30), ups=(-36, -12, 12, 36), chimney=2, sides=(LEFT,)), Unit(50.6, 40, d=40, body=SECOND, rise=11, ground=house_front(8, -8), ups=(-8, 8), chimney=0, sides=(RIGHT,))], squares=2, trees=(-40, 40), lamps=(-60,))
    model("row-cafe", [Unit(0, 140.6, d=42, roof="hip", rise=10, ground=shop_front((fixed("#57a394"), CREAM), 26), ups=(-52, -26, 0, 26, 52), sides=(LEFT, RIGHT), band=True)], squares=2, trees=(-30, 30), extra=lambda: [table(CELL / 2 - 6, y) for y in (-48, -20, 8)])
    model("row-post", [Unit(0, 140.6, d=44, rise=13, ground=lambda u: (u.door(0, 9.0, 14.0, RED), [u.window(a, u.h * 0.53, 9.0, 9.8) for a in (-52, -30, 30, 52)]), ups=(-52, -26, 0, 26, 52), chimney=2, sides=(LEFT, RIGHT))], squares=2, cones=(-44, 44), lamps=(-40,), extra=lambda: postbox(16))
    model("row-flats", [Unit(0, 140.6, d=46, h=24, roof="hip", rise=10, ground=flats_front, ups=(-56, -42, -28, -14, 0, 14, 28, 42, 56), chimney=2, sides=(LEFT, RIGHT), band=True)], squares=2, trees=(-48, 0, 48), lamps=(-30, 30))
    # A 2 x 2 block: two wide houses on the street, one garden court behind.
    model("row-court", [Unit(-36, 69.6, d=46, roof="hip", rise=10, ground=wide_front, ups=(-20, 0, 20), chimney=1, sides=(LEFT,), band=True), Unit(36, 69.6, d=46, body=SECOND, roof="hip", rise=10, ground=wide_front, ups=(-20, 0, 20), chimney=1, sides=(RIGHT,), band=True)], squares=2, deep=2, trees=(-52, -8, 40), cones=(-30, 18, 58), lamps=(0,))
    toy.save_and_export("rows")


main()
