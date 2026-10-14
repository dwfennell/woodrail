"""
The catalogue's building kit (src/catalogue/kit.ts), in Blender: the same calls, sizes and coordinates, so a model
written for the game's Kit ports nearly line for line, but built as Blender geometry with rounded rims, smooth
turned shapes and the toy normals of toy.py.

Coordinates are the game's: y up, models stand on y = 0 and face +x, z across. Each shape returns a `Node` that
moves like a three.js object (`position`, `rotation` (Euler XYZ), `scale`, `add`), and `realize` turns the tree into
Blender objects (Blender is Z up: the game's (x, y, z) is Blender's (x, -z, y)).

A node with a `name` is a pivot: it stays a node of its own in the exported model (named `<model>|<name>|<n>`), its
parts under it, so the catalogue can turn it by name (an arm waving, a head nodding).
"""

import math
from types import SimpleNamespace

import bpy  # first: with the pip `bpy` module, bmesh and mathutils come with it

import bmesh
from mathutils import Matrix, Vector

import toy

TOY = SimpleNamespace(
    red="#c8442f",
    blue="#2f6db5",
    green="#2d6b3f",
    leaf="#3c8f4e",
    yellow="#e6b52c",
    cream="#f0ebe0",
    black="#2a2b2e",
    orange="#e07a2e",
    purple="#6b4a8f",
    pink="#e98aa8",
    sky="#7fb7e0",
    brown="#7a4a2a",
    grey="#8d8f93",
    white="#f6f3ec",
    teal="#2a8c8c",
)

# The game's space to Blender's: (x, y, z) -> (x, -z, y).
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
C_INV = C.inverted()


class V3:
    """A three.js-style vector: x, y, z, and set()."""

    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = x, y, z

    def set(self, x, y, z):
        self.x, self.y, self.z = x, y, z
        return self

    def setScalar(self, v):
        return self.set(v, v, v)

    def copy(self, o):
        return self.set(o.x, o.y, o.z)

    def t(self):
        return (self.x, self.y, self.z)


class Node:
    """A three.js-style object: position, rotation (Euler XYZ, radians), scale, children; an optional pivot name."""

    def __init__(self, name=""):
        self.name = name
        self.position = V3()
        self.rotation = V3()
        self.scale = V3(1, 1, 1)
        self.quaternion = None  # a mathutils Quaternion, in the game's space, overriding `rotation` when set
        self.children = []
        self.parent = None
        self.userData = {}
        self.obj = None  # the Blender object of a shape

    def add(self, *children):
        for c in children:
            if c is None:
                continue
            if c.parent is not None:
                c.parent.children.remove(c)
            c.parent = self
            self.children.append(c)
        return self

    def matrix(self):
        r = self.quaternion.to_matrix().to_4x4() if self.quaternion is not None else (
            Matrix.Rotation(self.rotation.x, 4, "X") @ Matrix.Rotation(self.rotation.y, 4, "Y") @ Matrix.Rotation(self.rotation.z, 4, "Z")
        )
        return Matrix.Translation(self.position.t()) @ r @ Matrix.Diagonal((self.scale.x, self.scale.y, self.scale.z, 1))


# Fewer segments than this round a turned shape make facets, kept crisp (see `_turned`).
FACETED = 12


def _segs(n, r, step=1.1, most=48):
    """Segments round a curve of radius r: at least the game's count, more for big curves (one per `step` mm)."""
    # Few segments are a shape, not a curve (a nine-sided ice floe, a hexagonal nut): keep them.
    if n < FACETED:
        return n
    return max(8, min(most, max(n, math.ceil(2 * math.pi * r / step))))


def _shape(bm, mat, name, smooth=True, round_=0.0, seg=2, angle=35):
    """Link a bmesh built in the game's space (centred on its node) as a Blender object."""
    bmesh.ops.transform(bm, matrix=C, verts=bm.verts)
    obj = toy._link(name, bm, mat, (0, 0, 0))
    if smooth:
        toy._smooth(obj, angle)
    if round_ > 0.02:
        toy.round_edges(obj, round_, seg, angle)
    node = Node()
    node.obj = obj
    return node


def _turned(bm, mat, name, seg):
    """Link a turned shape: smooth round its axis, unless it has so few sides they're meant as facets."""
    n = _shape(bm, mat, name, angle=50)
    if seg < FACETED:
        n.obj["smooth_angle"] = 30
    return n


def _lathe_bm(profile, seg, arc=None):
    """A bmesh of `profile` ((radius, height) points) spun round the game's y axis."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), h, r * math.sin(2 * math.pi * i / seg))) for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], b[i], b[j], a[j]))
    for k in (0, -1):
        if profile[k][0] > 1e-3:
            bm.faces.new(rings[k])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _rim(r_bottom, r_top, h, k):
    """A cylinder's profile, centred on its middle, its rims rounded by k."""
    hh = h / 2
    k = min(k, r_bottom * 0.45, r_top * 0.45 if r_top > 0.05 else k, hh * 0.45)
    if k < 0.04:
        return [(0.0, -hh), (r_bottom, -hh), (max(r_top, 0.0), hh), (0.0, hh)]
    pts = [(0.0, -hh)]
    for i in range(4):
        a = math.pi / 2 * i / 3
        pts.append((r_bottom - k + k * math.sin(a), -hh + k - k * math.cos(a)))
    if r_top > 0.05:
        for i in range(4):
            a = math.pi / 2 * i / 3
            pts.append((r_top - k + k * math.cos(a), hh - k + k * math.sin(a)))
    pts.append((0.0, hh))
    return pts


class Kit:
    """The catalogue's Kit, in Blender. Materials are names (see toy.py)."""

    def __init__(self, recolor=lambda c: c, lean=False):
        self.recolor = recolor
        # Lean: for parts repeated many times over a map (a door on every house): one-step roundings, the code's own
        # segment counts and small balls.
        self.lean = lean

    # ——— Materials ———

    wood = "wood"
    cut = "cut"
    metal = "metal"
    glass = "glass"
    coal = "coal"
    felt = "felt"
    water = "water"
    road = "road"

    def paint(self, color):
        return toy.paint(self.recolor(color))

    def fixed(self, color):
        """Lacquer that keeps its colour in every colour variant of a model (a face's eyes and cheeks)."""
        return f"lacquer fixed {color.lower()}"

    def _n(self, n, r):
        """Segments round a curve: see `_segs`; lean, the count asked for (at most 16)."""
        return min(n, 16) if self.lean else _segs(n, r)

    # ——— Shapes ———

    def box(self, mat, w, h, d, r=1.5, x=0, y=0, z=0, seg=None):
        """A box with rounded edges (radius r, in `seg` steps; by default 3, or 4 for big ones), its base on y."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector((w, h, d)), verts=bm.verts)
        rr = min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01)
        n = _shape(bm, mat, "box", round_=rr, seg=seg or (1 if self.lean else 4 if rr >= 3 else 3))
        n.position.set(x, y + h / 2, z)
        return n

    def cyl(self, mat, rBottom, h, x=0, y=0, z=0, rTop=None, segments=28):
        """An upright cylinder (a cone frustum if rTop differs), its base on y; rims gently rounded."""
        rTop = rBottom if rTop is None else rTop
        k = min(0.5, 0.18 * min(h, 2 * max(rBottom, rTop)))
        seg = self._n(segments, max(rBottom, rTop))
        if self.lean:
            k = min(k, 0.3)
        n = _turned(_lathe_bm(_rim(rBottom, rTop, h, k), seg), mat, "cyl", seg)
        n.position.set(x, y + h / 2, z)
        return n

    def cylX(self, mat, r, length, x=0, y=0, z=0, segments=28):
        n = self.cyl(mat, r, length, 0, -length / 2, 0, r, segments)
        g = Node()
        g.add(n)
        g.rotation.z = math.pi / 2
        g.position.set(x, y, z)
        return g

    def cylZ(self, mat, r, length, x=0, y=0, z=0, segments=28):
        n = self.cyl(mat, r, length, 0, -length / 2, 0, r, segments)
        g = Node()
        g.add(n)
        g.rotation.x = math.pi / 2
        g.position.set(x, y, z)
        return g

    def ball(self, mat, r, x=0, y=0, z=0, sy=1):
        # Small balls (eyes, buttons, corn) need far fewer segments than heads to look round.
        n_seg = 8 if self.lean and r < 2.5 else self._n(12 if r < 1.2 else 16 if r < 2.5 else 24, r)
        rings = 5 if self.lean and r < 2.5 else max(8, round(n_seg * 0.6))
        prof = [(r * math.sin(math.pi * i / rings), -r * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
        prof[0] = (0.0, -r)
        prof[-1] = (0.0, r)
        n = _shape(_lathe_bm(prof, n_seg), mat, "ball", angle=50)
        n.position.set(x, y, z)
        n.scale.y = sy
        return n

    def cone(self, mat, r, h, x=0, y=0, z=0, segments=24):
        prof = [(0.0, -h / 2), (r * 0.94, -h / 2), (r, -h / 2 + min(0.3, h * 0.1)), (0.0, h / 2)]
        seg = self._n(segments, r)
        n = _turned(_lathe_bm(prof, seg), mat, "cone", seg)
        n.position.set(x, y + h / 2, z)
        return n

    def capsule(self, mat, r, length, x=0, y=0, z=0):
        q = 6
        prof = [(0.0, -length / 2 - r)]
        for i in range(1, q + 1):
            a = math.pi / 2 * i / q
            prof.append((r * math.sin(a), -length / 2 - r * math.cos(a)))
        for i in range(q + 1):
            a = math.pi / 2 * i / q
            prof.append((r * math.cos(a), length / 2 + r * math.sin(a)))
        prof[-1] = (0.0, length / 2 + r)
        n = _shape(_lathe_bm(prof, _segs(16, r)), mat, "capsule", angle=50)
        n.position.set(x, y + length / 2 + r, z)
        return n

    def ring(self, mat, r, tube, x=0, y=0, z=0, upright=False, arc=math.pi * 2):
        """A torus lying flat in x/z (upright: in the x/y plane), centred at (x, y, z); `arc` for part of one."""
        nu = _segs(32, r)
        nv = _segs(12, tube, 0.6, 16)
        full = arc >= math.pi * 2 - 1e-6
        steps = nu if full else max(4, math.ceil(nu * arc / (2 * math.pi)))
        bm = bmesh.new()
        loops = []
        for i in range(steps if full else steps + 1):
            u = arc * i / steps
            loop = []
            for j in range(nv):
                v = 2 * math.pi * j / nv
                rr = r + tube * math.cos(v)
                loop.append(bm.verts.new((rr * math.cos(u), rr * math.sin(u), tube * math.sin(v))))
            loops.append(loop)
        pairs = list(zip(loops, loops[1:])) + ([(loops[-1], loops[0])] if full else [])
        for a, b in pairs:
            for j in range(nv):
                k = (j + 1) % nv
                bm.faces.new((a[j], a[k], b[k], b[j]))
        if not full:
            bm.faces.new(loops[0])
            bm.faces.new(loops[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if not upright:
            # Lie it flat as three.js does (rotateX(pi/2)): (x, y, z) -> (x, -z, y).
            bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.pi / 2, 4, "X"), verts=bm.verts)
        n = _shape(bm, mat, "ring", angle=50)
        n.position.set(x, y, z)
        return n

    def lathe(self, mat, profile, x=0, y=0, z=0, segments=32):
        """A turned shape: (radius, height) points from the bottom up, spun round y; its base on y."""
        prof = [(max(0.0, r) if r > 0.011 else 0.0, h) for r, h in profile]
        seg = self._n(segments, max(r for r, _ in prof))
        n = _turned(_lathe_bm(prof, seg), mat, "lathe", seg)
        n.position.set(x, y, z)
        return n

    def extrude(self, mat, outline, depth, x=0, y=0, z=0, bevel=0.8):
        """A flat outline (x/y points, as drawn on paper) cut `depth` thick along z, centred on z = 0; edges rounded."""
        bm = bmesh.new()
        pts = list(outline)
        if len(pts) > 2 and (Vector(pts[0]) - Vector(pts[-1])).length < 1e-4:
            pts = pts[:-1]
        back = [bm.verts.new((px, py, -depth / 2)) for px, py in pts]
        face = bm.faces.new(back)
        ext = bmesh.ops.extrude_face_region(bm, geom=[face])
        verts = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=Vector((0, 0, depth)), verts=verts)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        n = _shape(bm, mat, "extrude", round_=min(bevel, depth / 2 - 0.02), seg=2)
        n.position.set(x, y, z)
        return n

    def roof(self, mat, w, d, h, x=0, y=0, z=0, t=3):
        """A gable roof along x as one solid block, like a toy's: w long, d across, h high to the ridge, its underside on
        y, the eaves t deep; every edge well rounded."""
        lip = min(t, h * 0.4)
        outline = [(-d / 2, 0), (d / 2, 0), (d / 2, lip), (0, h), (-d / 2, lip)]
        return self.at(self.extrude(mat, outline, w, 0, 0, 0, bevel=min(1.6, lip * 0.45, w / 4)), x, y, z, math.pi / 2)

    def wheel(self, r=6, x=0, y=6, z=0, color="#c8442f", width=4.5):
        """A train wheel (painted rim), its axle along z, centred at (x, y, z)."""
        g = Node()
        g.add(self.cylZ(self.paint(color), r, width, 0, 0, 0))
        g.add(self.cylZ(self.wood, r * 0.45, width + 0.6, 0, 0, 0, 16))
        return self.at(g, x, y, z)

    def bogies(self, length, inset=18, color="#c8442f"):
        g = Node()
        for x in (-(length / 2 - inset), length / 2 - inset):
            for z in (-13, 13):
                g.add(self.wheel(6, x, 7.5, z, color))
        return g

    def coupler(self, length, end, y=10):
        return self.cylX(self.metal, 3.5, 3, end * (length / 2 + 1), y, 0, 16)

    def peg(self, coat="#2f6db5", hat=None, x=0, y=0, z=0):
        g = Node()
        g.add(self.cyl(self.paint(coat), 4.2, 11, 0, 0, 0, 3.2, 24))
        g.add(self.ball(self.wood, 3.4, 0, 14, 0))
        if hat:
            g.add(self.cyl(self.paint(hat), 4, 0.9, 0, 15.9, 0, 4, 24))
            g.add(self.cyl(self.paint(hat), 2.8, 3, 0, 16.6, 0, 2.6, 24))
        return self.at(g, x, y, z)

    def trackSlab(self, length, x=0, y=0, z=0):
        g = Node()
        g.add(self.box(self.wood, length, 12, 40, 1.5))
        for gz in (-13, 13):
            g.add(self.box(self.cut, length - 0.2, 0.6, 6, 0, 0, 11.6, gz))
        return self.at(g, x, y, z)

    def feltDisc(self, r, mat="felt"):
        return self.cyl(mat, r, 1.2, 0, 0, 0, r, 48)

    # ——— Placing ———

    def at(self, o, x=0, y=0, z=0, ry=0):
        o.position.set(o.position.x + x, o.position.y + y, o.position.z + z)
        if ry:
            o.rotation.y += ry
        return o

    def group(self, *parts):
        g = Node()
        g.add(*parts)
        return g

    def many(self, n, make):
        g = Node()
        for i in range(n):
            g.add(make(i))
        return g


def realize(root, model):
    """Place the tree's Blender objects and make its pivots; returns the pivot empties (for toy.finish)."""
    pivots = []

    def walk(node, world, owner):
        world = world @ node.matrix()
        if node.name:
            # Unique in the file (several parts may share a name, such as every chimney's "smoke"); the game keeps
            # only the part's name.
            e = bpy.data.objects.new(f"{model}|{node.name}|{len(pivots)}", None)
            bpy.context.scene.collection.objects.link(e)
            if owner is not None:
                e.parent = owner
            e.matrix_world = C @ world @ C_INV
            pivots.append(e)
            owner = e
        if node.obj is not None:
            node.obj.matrix_world = C @ world @ C_INV
            if owner is not None:
                node.obj["owner"] = owner.name
        for c in node.children:
            walk(c, world, owner)

    walk(root, Matrix.Identity(4), None)
    bpy.context.view_layer.update()
    return pivots
