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
        self.z = 0.0  # how high this storey's floor is over the pavement (a civic building, drawn whole: see `raised`)

    @property
    def cx(self):
        return FX - self.d / 2

    @property
    def b(self):
        return BASE + self.z

    def face(self, along, z, facing=FRONT):
        """A point on one of the unit's faces: `along` it from its middle, `z` over the storey's floor."""
        if facing in (FRONT, BACK):
            return (FX if facing == FRONT else FX - self.d, self.y + along, self.b + z)
        return (self.cx + along, self.y + (self.w / 2 if facing == RIGHT else -self.w / 2), self.b + z)

    def arch(self, along, z, w=6.4, h=12.0, facing=FRONT, pane=None):
        """A printed window with a round top (a church's, a hall's opening)."""
        at = self.face(along, z, facing)
        plate(CREAM, w, h, at, facing, w / 2, 0.3)
        plate(pane or PANE, w - 1.6, h - 1.6, at, facing, (w - 1.6) / 2, 0.5)

    def window(self, along, z, w=6.4, h=8.6, facing=FRONT, bars=True):
        """A printed window on one of the unit's faces, `along` it from its middle, its middle `z` over the storey's floor."""
        at = self.face(along, z, facing)
        plate(CREAM, w, h, at, facing, 0, 0.3)
        plate(PANE, w - 1.6, h - 1.6, at, facing, 0, 0.5)
        if bars:
            plate(CREAM, w - 1.6, 0.5, at, facing, 0, 0.7)
            plate(CREAM, 0.5, h - 1.6, at, facing, 0, 0.7)

    def door(self, along, w=7.2, h=12.6, mat=DOOR):
        """A printed door, its top rounded, in a cream surround; a step before it and a brass knob."""
        y = self.y + along
        plate(CREAM, w + 2.0, h + 1.0, (FX, y, self.b + (h + 1.0) / 2), FRONT, (w + 2.0) / 2, 0.3)
        plate(mat, w, h, (FX, y, self.b + h / 2), FRONT, w / 2, 0.5)
        lathe(BRASS, [(0.0, -0.7), (0.7, 0), (0.0, 0.7)], (FX + 0.6, y + w / 2 - 1.7, self.b + h * 0.45), "X", 6)
        block(STONE, (3.0, w + 3.6, 1.1), (FX + 1.5, y, self.b + 0.55), 0.4)

    def storey(self, ground):
        """The storey's block and what's printed on it: the ground floor's own front, or a plain floor's windows."""
        block(self.body, (self.d, self.w, self.h), (self.cx, self.y, self.b + self.h / 2))
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
            block(CREAM, (self.d + 0.8, self.w + 0.8, 1.4), (self.cx, self.y, self.b + 0.7), 0.4)

    def top(self):
        """The roof block on a storey, and its chimney."""
        z = self.b + self.h - 0.4
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


def tile(squares=1, deep=1, trees=(), cones=(), lamps=(), extra=None, garden=True, back=()):
    """The lot's tile: pavement over it all, a strip of garden behind, trees in the garden, what stands by the kerb."""
    w = CELL * squares
    x0 = CELL / 2 - CELL * deep  # the lot's back edge
    block(STONE, (CELL * deep, w, BASE), (x0 + CELL * deep / 2, 0, BASE / 2), 0.6)
    gd = (FX - 40.0) - x0 - 2.5  # the garden: from behind the shallowest building to the back edge
    if garden:
        block(GRASS, (gd, w - 6, 0.9), (x0 + 1.5 + gd / 2, 0, BASE + 0.35), 0.4)
    for x, y, cone in back:  # trees in the grounds of a 2 x 2 block, `x` in from its back edge
        tree(x0 + x, y, 5.6 if cone else 7.0, 8.0 if cone else 9.0, cone)
    for y in trees:
        tree(x0 + 7, y)
    for y in cones:
        tree(x0 + 7.5, y, 5.6, 8.0, True)
    for y in lamps:
        lamp(y)
    if extra:
        extra()


# ——— Landmarks and civic places (each drawn whole, for one lot: they don't gain storeys) ———

WALL = fixed("#d9d2c0")  # a church's, a tower's stone
WHITE = fixed("#f4f1e8")
HALL = fixed("#ecd9a0")
FIRE = fixed("#c8483a")
POLICE = fixed("#6f8fa8")
BOOK = fixed("#a9bfa0")
TIMBER = fixed("#c9a26b")
PLUM = fixed("#7a3f6a")
GATE = fixed("#b9b4a8")
DARK_RED = fixed("#8f2f25")
BLUE = fixed("#3f6fb0")
W1, W2 = 69.4, 140.6


def raised(u, floors, roof=True):
    """A unit drawn `floors` storeys high, its roof on top."""
    for k in range(floors):
        u.z = k * u.h
        u.storey(k == 0)
    if roof:
        u.top()
    u.z = 0.0
    return u


def disc(mat, r, at, thick=0.6, seg=16):
    """A round plate facing the street (a clock's face, a sign)."""
    return lathe(mat, [(0.0, 0), (r, 0), (r, thick), (0.0, thick)], at, "X", seg)


def clock_face(at, r=6.0):
    """A clock printed on a front: white in a dark rim, its hands at ten past ten."""
    x, y, z = at
    disc(BLACK, r + 0.9, (x, y, z), 0.5)
    disc(fixed("#fbf6ec"), r, (x + 0.3, y, z), 0.5)
    for deg, long in ((-60, r * 0.55), (60, r * 0.8)):
        a = math.radians(deg)
        hand = block(BLACK, (0.5, 0.9, long), (x + 1.1, y + math.sin(a) * long / 2, z + math.cos(a) * long / 2), 0.2)
        hand.rotation_euler = (-a, 0, 0)


def pediment(mat, w, rise, depth, at):
    """A low triangle over a porch or a bay, its point up, facing the street."""
    return prism(mat, [(-w / 2, 0), (w / 2, 0), (0, rise)], depth, "X", at, 0.5, "pediment")


def columns(ys, h, x=FX + 5.0, r=1.7):
    for y in ys:
        lathe(CREAM, [(0.0, 0), (r + 0.7, 0), (r + 0.7, 1.0), (r, 1.6), (r, h - 1.6), (r + 0.7, h - 1.0), (r + 0.7, h), (0.0, h)], (x, y, BASE), "Z", 8)


def steps(y, w, n=2, x=FX):
    for k in range(n):
        block(STONE, (3.0 * (n - k), w + 2.0 * (n - k), 1.3), (x + 1.5 * (n - k), y, BASE + 0.65 + 1.3 * k), 0.4)


def spire(at, r, h, mat=ROOF, seg=8):
    x, y, z = at
    lathe(mat, [(0.0, 0), (r, 0), (r + 0.6, 1.4), (1.0, h), (0.0, h + 0.4)], (x, y, z), "Z", seg)
    lathe(BRASS, [(0.0, -1.3), (1.0, -0.9), (1.3, 0), (1.0, 0.9), (0.0, 1.3)], (x, y, z + h + 1.4), "Z", 8)


def church():
    nave = Unit(-16.3, 106, d=42, h=27, body=WALL, rise=21, chimney=0, ups=(), ground=lambda u: [u.arch(a, 13.5, 7.4, 16) for a in (-40, -20, 0, 20, 40)] + [u.arch(a, 13.5, 7.4, 16, BACK) for a in (-30, 0, 30)] + [u.arch(0, 14, 9, 18, LEFT)])
    raised(nave, 1)
    tower = Unit(53.5, 33, d=34, h=64, body=WALL, ups=(), chimney=0)
    block(WALL, (tower.d, tower.w, tower.h), (tower.cx, tower.y, BASE + tower.h / 2))
    tower.door(0, 9.4, 16.0, fixed("#5b3a2a"))
    disc(CREAM, 4.4, (FX, tower.y, BASE + 30), 0.4)
    disc(PANE, 3.4, (FX + 0.2, tower.y, BASE + 30), 0.4)
    for facing in (FRONT, BACK, RIGHT):
        tower.arch(0, 50, 7.0, 13, facing)
    block(CREAM, (tower.d + 2.4, tower.w + 2.4, 2.2), (tower.cx, tower.y, BASE + tower.h + 0.6), 0.6)
    spire((tower.cx, tower.y, BASE + tower.h + 1.6), 15.5, 40)


def market_hall():
    def front(u):
        for a in (-52, -26, 0, 26, 52):
            u.arch(a, 9.5, 19, 19, pane=fixed("#3a2e26"))
        block(fixed("#2f6048"), (1.6, u.w - 3, 3.2), (FX + 0.6, u.y, u.b + 21.2), 0.5)
        plate(CREAM, 30, 1.3, (FX + 1.4, u.y, u.b + 21.2), FRONT, 0, 0.3)

    hall = raised(Unit(0, W2, d=46, h=24, body=TIMBER, rise=17, chimney=0, ups=(-52, -26, 0, 26, 52), ground=front, sides=(LEFT, RIGHT)), 1)
    # A little clock turret on the ridge.
    top = BASE + hall.h + 15
    block(CREAM, (11, 11, 11), (hall.cx, 0, top + 4), 0.8)
    clock_face((hall.cx + 5.5, 0, top + 4.5), 3.6)
    spire((hall.cx, 0, top + 9.5), 7.6, 9)
    # Two stalls by the kerb, under striped cloths.
    for y, stripes in ((-44, STRIPES), (44, (fixed("#e6ae3e"), CREAM))):
        block(TIMBER, (8, 20, 6), (CELL / 2 - 7, y, BASE + 3), 0.6)
        for k in range(4):
            block(stripes[k % 2], (10.5, 5.5, 1.0), (CELL / 2 - 7, y - 8.25 + k * 5.5, BASE + 13), 0.3)
        for dy in (-9.5, 9.5):
            lathe(CREAM, [(0.0, 0), (0.5, 0), (0.5, 12.6), (0.0, 12.6)], (CELL / 2 - 11.5, y + dy, BASE), "Z", 6)


def library(w):
    ups = (-52, -30, 30, 52) if w > 100 else (-24, 24)
    u = Unit(0, w, d=44, h=20, body=BOOK, roof="hip", rise=9, chimney=0, band=True, sides=(LEFT, RIGHT), ups=ups + (0,), ground=lambda u: (u.door(0, 9.4, 14.6, fixed("#5b3a2a")), [u.window(a, u.h * 0.53, 8.4, 10.4) for a in ups]))
    raised(u, 2)
    # A porch: columns under a low pediment.
    half = 9.0
    columns((-half, half) if w < 100 else (-half - 9, -half, half, half + 9), 22)
    pw = 2 * half + (26 if w > 100 else 8)
    block(CREAM, (9.0, pw, 2.4), (FX + 3.6, 0, BASE + 23.2), 0.5)
    pediment(CREAM, pw, 7.0, 9.0, (FX + 3.6, 0, BASE + 24.2))
    steps(0, 2 * half + 4)


def town_hall():
    ups = (-56, -42, -28, 28, 42, 56)
    u = raised(Unit(0, W2, d=44, h=22, body=HALL, roof="hip", rise=10, chimney=0, band=True, sides=(LEFT, RIGHT), ups=ups, ground=lambda u: [u.window(a, u.h * 0.53, 8.0, 11.0) for a in ups]), 2)
    # Its middle bay stands forward under a pediment, steps up to its door, a clock over it.
    bw, bh = 34.0, 2 * u.h + 2
    block(CREAM, (6.0, bw, bh), (FX + 1.0, 0, BASE + bh / 2), 0.8)
    plate(CREAM, 12.6, 16.6, (FX + 4.0, 0, BASE + 8.3), FRONT, 6.3, 0.3)
    plate(fixed("#2f6048"), 10.6, 15.6, (FX + 4.0, 0, BASE + 7.8), FRONT, 5.3, 0.5)
    for a in (-10.5, 10.5):
        plate(PANE, 5.6, 9.6, (FX + 4.0, a, BASE + u.h + 11), FRONT, 2.8, 0.5)
    pediment(HALL, bw + 2, 9.0, 7.0, (FX + 1.0, 0, BASE + bh))
    clock_face((FX + 4.2, 0, BASE + u.h + 11.5), 4.4)
    steps(0, 16, 3, FX + 4.0)
    # A cupola on the roof.
    top = BASE + 2 * u.h + 10
    block(CREAM, (12, 12, 9), (u.cx, 0, top + 4), 0.8)
    lathe(ROOF, [(0.0, 0), (7.4, 0), (7.4, 1.0), (6.0, 4.0), (3.2, 6.6), (0.0, 7.6)], (u.cx, 0, top + 8.4), "Z", 10)
    lathe(BRASS, [(0.0, 0), (0.5, 0), (0.5, 7), (0.0, 7)], (u.cx, 0, top + 15.6), "Z", 6)


def fire_station(w):
    bays = (-44, -14) if w > 100 else (-18,)
    door_at = 44 if w > 100 else 8

    def front(u):
        for a in bays:
            plate(CREAM, 24.6, 17.6, u.face(a, 8.8), FRONT, 5, 0.3)
            plate(DARK_RED, 22.6, 16.6, u.face(a, 8.3), FRONT, 4.5, 0.5)
            for k in (-7.4, 0, 7.4):
                plate(PANE, 5.0, 4.0, u.face(a + k, 12.4), FRONT, 0, 0.7)
        u.door(door_at, 7.6, 13.4, DARK_RED)
        if w > 100:
            u.window(22, u.h * 0.55, 8.0, 9.4)

    ups = (-52, -32, -12, 12, 32) if w > 100 else (-22, -4)
    tw = 16.0
    main_w = w - tw
    u = raised(Unit(-tw / 2, main_w, d=44, h=22, body=FIRE, roof="hip", rise=7, chimney=0, band=True, sides=(LEFT,), ups=tuple(a + tw / 2 for a in ups), ground=lambda u: front(Unit(0, w, d=44, h=22))), 2)
    # The hose tower at its end, a brass bell under its cap.
    ty = w / 2 - tw / 2 - 1.5
    th = 62.0
    block(FIRE, (18, tw, th), (FX - 9, ty, BASE + th / 2))
    t = Unit(ty, tw, d=18, h=th)
    for z in (30, 48):
        t.window(0, z, 6.0, 8.0)
    block(CREAM, (20.4, tw + 2.4, 2.0), (FX - 9, ty, BASE + th + 0.6), 0.6)
    spire((FX - 9, ty, BASE + th + 1.6), 8.8, 12)
    lathe(BRASS, [(0.0, 0), (2.4, 0), (1.8, 2.4), (0.0, 3.2)], (FX + 1.0, ty, BASE + th - 8), "Z", 8)


def police_station(w):
    ups = (-52, -30, 30, 52) if w > 100 else (-24, 24)

    def front(u):
        u.door(0, 8.6, 14.0, BLUE)
        for a in ups:
            u.window(a, u.h * 0.53, 8.4, 9.8)
        block(BLUE, (1.6, 30, 3.4), (FX + 0.6, u.y, u.b + 18.2), 0.5)
        plate(CREAM, 20, 1.3, (FX + 1.4, u.y, u.b + 18.2), FRONT, 0, 0.3)

    raised(Unit(0, w, d=44, h=21, body=POLICE, rise=13, chimney=2 if w > 100 else 1, band=True, sides=(LEFT, RIGHT), ups=ups + (0,), ground=front), 2)
    # The blue lamp by its door.
    for y in (-9.5, 9.5):
        lathe(BLACK, [(0.0, 0), (1.6, 0), (1.6, 0.7), (0.6, 1.4), (0.6, 15), (0.0, 15)], (FX + 4.5, y, BASE), "Z", 6)
        lathe(BLUE, [(0.0, -2.2), (1.6, -1.6), (2.2, 0), (1.6, 1.6), (0.0, 2.2)], (FX + 4.5, y, BASE + 17.0), "Z", 8)
    steps(0, 12)


def hospital(w):
    ups = (-56, -42, -28, -14, 14, 28, 42, 56) if w > 100 else (-24, -12, 12, 24)
    floors = 3 if w > 100 else 2
    u = raised(Unit(0, w, d=46, h=20, body=WHITE, roof="hip", rise=5, chimney=0, band=True, sides=(LEFT, RIGHT), ups=ups + (0,), ground=lambda u: [u.window(a, u.h * 0.5, 6.6, 9.6) for a in ups]), floors)
    # Glass doors under a canopy, and its red cross.
    plate(CREAM, 14.6, 15.0, (FX, 0, BASE + 7.5), FRONT, 0, 0.3)
    for a in (-3.3, 3.3):
        plate(PANE, 5.8, 13.4, (FX, a, BASE + 6.9), FRONT, 0, 0.5)
    block(ROOF, (10, 22, 1.5), (FX + 4.6, 0, BASE + 16.6), 0.5)
    for y in (-9.5, 9.5):
        lathe(CREAM, [(0.0, 0), (0.7, 0), (0.7, 16), (0.0, 16)], (FX + 8.4, y, BASE), "Z", 6)
    top = BASE + floors * u.h
    block(WHITE, (3.0, 16, 13), (FX - 1.2, 0, top + 5.5), 0.6)
    plate(RED, 3.4, 9.6, (FX + 0.3, 0, top + 5.8), FRONT, 0, 0.3)
    plate(RED, 9.6, 3.4, (FX + 0.3, 0, top + 5.8), FRONT, 0, 0.3)


def clock_tower():
    cx = 0.0
    for k, (s, h) in enumerate(((30, 3.0), (25, 3.0))):
        block(STONE, (s, s, h), (cx, 0, BASE + 1.5 + 3.0 * k), 0.6)
    s, h = 19.0, 62.0
    z0 = BASE + 6
    block(WALL, (s, s, h), (cx, 0, z0 + h / 2))
    plate(CREAM, 8.4, 13.4, (cx + s / 2, 0, z0 + 6.7), FRONT, 4.2, 0.3)
    plate(fixed("#5b3a2a"), 6.4, 12.4, (cx + s / 2, 0, z0 + 6.2), FRONT, 3.2, 0.5)
    for z in (24, 36):
        plate(PANE, 3.4, 6.4, (cx + s / 2, 0, z0 + z), FRONT, 1.7, 0.5)
    block(CREAM, (s + 3, s + 3, 2.0), (cx, 0, z0 + h - 15), 0.6)
    clock_face((cx + s / 2, 0, z0 + h - 7), 6.0)
    for facing, at in ((BACK, (cx - s / 2, 0, z0 + h - 7)), (LEFT, (cx, -s / 2, z0 + h - 7)), (RIGHT, (cx, s / 2, z0 + h - 7))):
        plate(fixed("#fbf6ec"), 11, 11, at, facing, 5.5, 0.4)
    block(CREAM, (s + 3, s + 3, 2.0), (cx, 0, z0 + h + 0.6), 0.6)
    spire((cx, 0, z0 + h + 1.6), 12.5, 20)


def castle_gate():
    # Two round towers and a wall between them with an arched gate, battlements on top; a keep's block behind.
    wall_h, tower_h, r = 34.0, 50.0, 17.0
    x = FX - 14
    block(GATE, (22, 96, wall_h), (x, 0, BASE + wall_h / 2), 1.2)
    plate(fixed("#3a2e26"), 22, 26, (x + 11, 0, BASE + 13), FRONT, 11, 0.4)
    plate(TIMBER, 19, 23.5, (x + 11, 0, BASE + 11.75), FRONT, 9.5, 0.6)
    for y in (-52, 52):
        lathe(GATE, [(0.0, 0), (r, 0), (r, tower_h), (r + 1.6, tower_h + 1.2), (r + 1.6, tower_h + 4), (0.0, tower_h + 4)], (x, y, BASE), "Z", 14)
        for k in range(8):
            a = math.radians(k * 45 + 22.5)
            block(GATE, (5.0, 5.0, 4.4), (x + math.cos(a) * (r - 0.6), y + math.sin(a) * (r - 0.6), BASE + tower_h + 6), 0.6)
        for z in (20, 36):
            plate(PANE, 2.6, 8.0, (x + r, y, BASE + z), FRONT, 1.3, 0.4)
        spire((x, y, BASE + tower_h + 4), 11, 16, fixed("#c8483a"), 10)
    for y in (-30, -18, -6, 6, 18, 30):
        block(GATE, (5.0, 6.0, 4.6), (x + 8.8, y, BASE + wall_h + 2.2), 0.6)
    # The keep.
    kx = x - 46
    block(GATE, (54, 84, 44), (kx, 0, BASE + 22), 1.4)
    for sx in (-1, 1):
        for y in (-36, -18, 0, 18, 36):
            block(GATE, (6.0, 6.0, 4.6), (kx + sx * 24, y, BASE + 46), 0.6)
    for y in (-24, 0, 24):
        plate(PANE, 3.0, 9.0, (kx + 27, y, BASE + 30), FRONT, 1.5, 0.4)
    lathe(BRASS, [(0.0, 0), (0.5, 0), (0.5, 16), (0.0, 16)], (kx, 0, BASE + 44), "Z", 6)
    block(RED, (0.6, 9, 5.4), (kx, 4.6, BASE + 56.6), 0.2)


def lighthouse():
    x = FX - 22
    block(STONE, (40, 40, 3.0), (x, 0, BASE + 1.5), 0.8)
    bands = [(16.0, 0), (14.6, 14), (13.2, 28), (11.8, 42), (10.4, 56)]
    for k in range(4):
        (r0, z0), (r1, z1) = bands[k], bands[k + 1]
        lathe(RED if k % 2 else WHITE, [(0.0, 0), (r0, 0), (r1, z1 - z0), (0.0, z1 - z0)], (x, 0, BASE + 3 + z0), "Z", 14)
    top = BASE + 3 + 56
    lathe(BLACK, [(0.0, 0), (13.0, 0), (13.0, 1.6), (0.0, 1.6)], (x, 0, top), "Z", 14)
    lathe(fixed("#fbefc4"), [(0.0, 0), (7.4, 0), (7.4, 9.0), (0.0, 9.0)], (x, 0, top + 1.6), "Z", 12)
    lathe(RED, [(0.0, 0), (9.4, 0), (8.4, 1.6), (0.8, 8.0), (0.0, 8.2)], (x, 0, top + 10.6), "Z", 12)
    plate(CREAM, 8.0, 12.6, (x + 15.6, 0, BASE + 3 + 6.3), FRONT, 4.0, 0.9)
    plate(RED, 6.0, 11.6, (x + 15.6, 0, BASE + 3 + 5.8), FRONT, 3.0, 1.1)
    for z in (26, 42):
        plate(PANE, 3.0, 5.6, (x + 14.2 - (z - 26) * 0.09, 0, BASE + 3 + z), FRONT, 1.5, 0.7)


def boat(x, y):
    block(BLUE, (9, 20, 4.0), (x, y, BASE + 3.4), 1.6)
    block(TIMBER, (6.4, 17, 1.0), (x, y, BASE + 5.2), 0.4)
    lathe(CREAM, [(0.0, 0), (0.5, 0), (0.5, 20), (0.0, 20)], (x, y + 2, BASE + 5), "Z", 6)
    prism(WHITE, [(0, 0), (9.5, 0), (0, 14)], 0.6, "X", (x, y + 2.6, BASE + 9), 0.2, "sail")


def kiosk():
    x = FX - 16
    lathe(CREAM, [(0.0, 0), (13.0, 0), (13.0, 15), (0.0, 15)], (x, 0, BASE), "Z", 8)
    plate(PANE, 10, 7.0, (x + 12.2, 0, BASE + 10.5), FRONT, 0, 0.9)
    block(TIMBER, (3.0, 13, 1.2), (x + 13.0, 0, BASE + 6.6), 0.4)
    # A cloth roof with a cream edge, and an ice cream on its point.
    lathe(fixed("#f2a9b8"), [(0.0, 0), (17.0, 0), (17.0, 1.0), (1.6, 9.0), (0.0, 9.2)], (x, 0, BASE + 15), "Z", 8)
    lathe(CREAM, [(0.0, 0), (17.6, 0), (17.6, 1.6), (0.0, 1.6)], (x, 0, BASE + 14.2), "Z", 8)
    lathe(TIMBER, [(0.0, 0), (1.9, 6.4), (0.0, 6.4)], (x, 0, BASE + 23.6), "Z", 8)
    lathe(fixed("#f2a9b8"), [(0.0, -2.6), (1.9, -1.8), (2.6, 0), (1.9, 1.8), (0.0, 2.6)], (x, 0, BASE + 32), "Z", 8)


def cinema():
    def front(u):
        for a in (-12, 12):
            plate(CREAM, 12.6, 15.6, u.face(a, 7.8), FRONT, 0, 0.3)
            plate(fixed("#5b2a4c"), 10.6, 14.6, u.face(a, 7.3), FRONT, 0, 0.5)
        for a in (-48, -32, 32, 48):  # the posters
            plate(CREAM, 9.6, 13.0, u.face(a, 9.5), FRONT, 0, 0.3)
            plate((RED, BLUE, fixed("#e6ae3e"), fixed("#57a394"))[int((a + 48) // 16) % 4], 8.0, 11.4, u.face(a, 9.5), FRONT, 0, 0.5)

    u = raised(Unit(0, W2, d=46, h=22, body=PLUM, roof="hip", rise=6, chimney=0, sides=(LEFT, RIGHT), ups=(), ground=front), 2)
    # The canopy over its doors, lit along its edge, and its tall sign.
    block(CREAM, (12, 52, 3.0), (FX + 5.5, 0, BASE + 19.5), 0.8)
    for y in range(-22, 23, 6):
        lathe(fixed("#fbefc4"), [(0.0, -0.9), (0.9, 0), (0.0, 0.9)], (FX + 11.6, y, BASE + 19.5), "X", 6)
    block(fixed("#e6ae3e"), (3.0, 12, 30), (FX + 1.2, 0, BASE + 38), 0.8)
    for z in (28, 34, 40, 46):
        disc(CREAM, 1.9, (FX + 2.7, 0, BASE + z + 1), 0.4, 10)
    for a in (-44, -24, 24, 44):
        u.z = u.h
        u.window(a, u.h * 0.5, 8.0, 10.0)
    u.z = 0.0


def civic(name, build, squares=1, deep=1, **on_tile):
    """A landmark `name`, whole, on the tile of its lot."""
    toy.begin()
    tile(squares=squares, deep=deep, **on_tile)
    build()
    bpy.context.view_layer.update()
    toy.finish(name, (LAYOUT[0] * 180, LAYOUT[1] * 200, 0))
    LAYOUT[0] += 1
    if LAYOUT[0] >= 4:
        LAYOUT[0] = 0
        LAYOUT[1] += 1


def civics():
    grounds = dict(back=((10, -54, False), (12, -18, True), (9, 22, False), (11, 56, True), (40, -60, True), (44, 60, False)))
    civic("row-church", church, 2, trees=(-56,), cones=(-30,))
    civic("row-church-4", church, 2, 2, **grounds)
    civic("row-market-hall", market_hall, 2, lamps=(0,))
    civic("row-market-hall-4", market_hall, 2, 2, lamps=(0,), **grounds)
    civic("row-library-1", lambda: library(W1), 1, trees=(-22,))
    civic("row-library", lambda: library(W2), 2, trees=(-50, 50), lamps=(-40, 40))
    civic("row-town-hall", town_hall, 2, cones=(-56, 56), lamps=(-44, 44))
    civic("row-town-hall-4", town_hall, 2, 2, lamps=(-44, 44), **grounds)
    civic("row-fire-station-1", lambda: fire_station(W1), 1)
    civic("row-fire-station", lambda: fire_station(W2), 2, trees=(-40,))
    civic("row-police-station-1", lambda: police_station(W1), 1, cones=(22,))
    civic("row-police-station", lambda: police_station(W2), 2, trees=(-44, 44))
    civic("row-hospital-1", lambda: hospital(W1), 1, trees=(20,))
    civic("row-hospital", lambda: hospital(W2), 2, trees=(-48, 48))
    civic("row-hospital-4", lambda: hospital(W2), 2, 2, **grounds)
    civic("row-clock-tower", clock_tower, 1, garden=False, trees=(-24, 24), lamps=(-28,))
    civic("row-clock-tower-2", clock_tower, 2, garden=False, trees=(-56, -34, 34, 56), lamps=(-48, 48))
    civic("row-castle-gate-4", castle_gate, 2, 2, garden=False)
    civic("row-lighthouse", lighthouse, 1, garden=False)
    civic("row-lighthouse-2", lighthouse, 2, garden=False, extra=lambda: (boat(FX - 20, -48), boat(FX - 26, 50)))
    civic("row-kiosk", kiosk, 1, garden=False, trees=(-24,), extra=lambda: [table(CELL / 2 - 8, y) for y in (16, 27)])
    civic("row-kiosk-2", kiosk, 2, garden=False, trees=(-56, 56), extra=lambda: [table(CELL / 2 - 8, y) for y in (-44, -32, 30, 42)])
    civic("row-cinema", cinema, 2, cones=(-50, 50))


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
    LAYOUT[0] = 0
    civics()
    toy.save_and_export("rows")


main()
