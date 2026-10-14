"""
Parts for people and animals (the helpers at the top of src/catalogue/assets/life.ts), on kit.py: peg-doll people
(turned bodies, round beech heads, painted uniforms, about 18 mm tall) told apart by hats, bags and tools, and chunky
turned-and-sawn wooden animals. Facing +x, standing on y = 0, the game's coordinates.
"""

import math

from mathutils import Vector

from kit import TOY, Node

GOLD = "#d9a93a"
STRAW = "#d9b25a"
SILVER = "#c9ccd1"

# ——— Small helpers ———


def rod(k, mat, a, b, r0, r1=None, seg=12):
    """A cylinder from a to b (radius r0 at a, r1 at b): limbs, poles, necks, tails, horns."""
    r1 = r0 if r1 is None else r1
    d = Vector(b) - Vector(a)
    m = k.cyl(mat, r0, max(0.01, d.length), 0, 0, 0, r1, seg)
    # The shape's base is at its node's y - length/2: centre it, then turn y onto d.
    m.position.set(0, 0, 0)
    g = Node()
    g.add(m)
    g.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
    g.quaternion = Vector((0, 1, 0)).rotation_difference(d.normalized()) if d.length > 1e-6 else None
    return g


def pivot(name, x, y, z, *parts):
    """A named group (a pivot for animation) at (x, y, z)."""
    g = Node(name)
    g.position.set(x, y, z)
    g.add(*parts)
    return g


def dome(k, mat, r, h, x=0, y=0, z=0):
    """A turned dome (a hat crown, a helmet, hair), its base on y."""
    p = [(0.01, 0)]
    for i in range(9):
        a = i / 8 * (math.pi / 2)
        p.append((max(0.01, r * math.cos(a)), h * math.sin(a)))
    return k.lathe(mat, p, x, y, z, 24)


def egg(k, mat, r, x, y, z, sx=1, sy=1, sz=1):
    """A ball stretched along x (bodies of birds, fish, rabbits)."""
    m = k.ball(mat, r, x, y, z)
    m.scale.set(sx, sy, sz)
    return m


def eyes(k, x, y, half, r=0.6, col=TOY.black):
    """A pair of eyes looking +x, `half` either side of centre."""
    return k.group(k.ball(k.paint(col), r, x, y, -half), k.ball(k.paint(col), r, x, y, half))


def beak(k, mat, r, length, x, y, z=0):
    """A cone pointing +x (a beak, a snout), its base at x."""
    return rod(k, mat, (x, y, z), (x + length, y, z), r, 0.05, 10)


# ——— Peg people ———

BODY_H = 11
HAND = -5.2


def r_at(y):
    """Radius of the turned body at height y."""
    return 4.2 - (y / BODY_H) * 1.0


def body_profile():
    """The turned body: a rounded foot rim, a gentle taper (r_at), rounded shoulders under the head."""
    pts = [(0.0, 0.0), (3.8, 0.0), (4.1, 0.1), (4.24, 0.4), (4.2, 0.8)]
    for y in (2.0, 4.0, 6.0, 8.0, 9.4):
        pts.append((r_at(y), y))
    pts += [(3.25, 10.2), (3.0, 10.75), (2.55, 11.15), (1.9, 11.4), (0.0, 11.5)]
    return pts


def face(k, cheeks=True):
    """Painted eyes and rosy cheeks on the head (centred at y 14, radius 3.4), looking +x: the same in every colour variant."""
    g = Node()
    for s in (-1, 1):
        g.add(k.ball(k.fixed(TOY.black), 0.36, 3.12, 14.5, s * 1.15, 1.25))
        if cheeks:
            c = k.ball(k.fixed("#e8a39a"), 0.62, 3.05, 13.3, s * 1.75)
            c.scale.set(0.35, 0.8, 1)
            g.add(c)
    return g


def person(k, coat, legs=None, hair=None, cheeks=True):
    """A peg person: turned body in `coat`, beech head with a painted face, optional trousers and hair."""
    g = Node()
    g.add(k.lathe(k.paint(coat), body_profile(), 0, 0, 0, 32))
    if legs:
        g.add(band(k, legs, 0, 3.6))
    g.add(k.ball(k.wood, 3.4, 0, 14, 0))
    g.add(face(k, cheeks))
    if hair:
        g.add(dome(k, k.paint(hair), 3.6, 3.7, -0.5, 13.9, 0))
    return g


def band(k, col, y0, y1, out=0.2):
    """A painted band round the body between y0 and y1 (a belt, an apron, a scarf, a hi-vis stripe)."""
    return k.cyl(k.paint(col), r_at(y0) + out, y1 - y0, 0, y0, 0, r_at(y1) + out, 24)


def apron(k, col, y0, y1, w=4.4):
    """A front panel (an apron, a bib, a waistcoat front) painted on the body."""
    m = k.box(k.paint(col), 0.6, y1 - y0, w, 0.25, 0, y0, 0)
    m.position.x = r_at((y0 + y1) / 2) - 0.05
    m.rotation.z = math.atan2(1, BODY_H)
    return m


def buttons(k, col, ys):
    """Buttons down the front."""
    return k.group(*[k.ball(k.paint(col), 0.45, r_at(y) + 0.1, y, 0) for y in ys])


def arm(k, coat, side, swing=0, name=""):
    """An arm on `side` (+1 right, -1 left), pivoting at the shoulder; `swing` lifts it forward (radians)."""
    g = pivot(name, 0, 9.6, side * 3.6)
    g.userData["arm"] = True
    g.add(k.capsule(k.paint(coat), 1.1, 3.2, 0, -5.4, 0))
    g.add(k.ball(k.wood, 1.2, 0, HAND, 0))
    g.rotation.z = swing
    g.rotation.x = -side * 0.12
    return g


def hold(arm_g, item, dx=0, dy=0, dz=0):
    """Put `item` in an arm's hand, kept upright. Returns the item (its parent is the arm)."""
    item.position.set(item.position.x + dx, item.position.y + HAND + dy, item.position.z + dz)
    item.rotation.z = -arm_g.rotation.z
    item.userData["held"] = True
    arm_g.add(item)
    return item


# Hats, placed for a head centred at y 14 (radius 3.4).


def cap(k, col, peak=None):
    peak = col if peak is None else peak
    return k.group(k.cyl(k.paint(col), 3.55, 2.4, 0, 15.6, 0, 3.75, 24), k.box(k.paint(peak), 3.2, 0.6, 5.2, 0.3, 3.4, 15.7, 0))


def kepi(k, col):
    g = cap(k, col, TOY.black)
    g.add(k.cyl(k.paint(GOLD), 3.66, 0.6, 0, 16.2, 0, 3.7, 24))
    g.add(k.ball(k.paint(GOLD), 0.6, 3.7, 17, 0))
    return g


def top_hat(k, col):
    return k.group(k.cyl(k.paint(col), 5, 0.7, 0, 16.3, 0, 5, 28), k.cyl(k.paint(col), 3.1, 5.5, 0, 16.6, 0, 3.2, 24))


def bowler(k, col):
    return k.group(k.cyl(k.paint(col), 4.6, 0.6, 0, 16.2, 0, 4.6, 28), dome(k, k.paint(col), 3.2, 3.2, 0, 16.4, 0))


def hard_hat(k, col):
    return k.group(
        dome(k, k.paint(col), 3.9, 3.6, 0, 15.3, 0),
        k.cyl(k.paint(col), 4.4, 0.5, 0, 15.2, 0, 4.4, 28),
        k.box(k.paint(col), 2.5, 0.5, 5, 0.2, 4, 15.2, 0),
        k.box(k.paint(col), 6.5, 1, 1.2, 0.5, 0, 18.3, 0),
    )


def fire_helmet(k, col):
    return k.group(
        dome(k, k.paint(col), 3.9, 3.8, 0, 15.2, 0),
        k.cyl(k.paint(col), 4.8, 0.5, -0.9, 15.1, 0, 4.8, 28),
        k.box(k.paint(col), 7, 1.4, 1, 0.5, -0.4, 18, 0),
        k.box(k.paint(GOLD), 0.6, 1.8, 1.8, 0.3, 3.7, 16, 0),
    )


def police_helmet(k, col):
    profile = [(0.01, 0), (3.8, 0), (3.7, 2), (3.2, 4.5), (2.3, 6.3), (1, 7), (0.01, 7.2)]
    return k.group(
        k.lathe(k.paint(col), profile, 0, 15.2, 0, 28),
        k.cyl(k.paint(col), 4.4, 0.5, 0, 15.1, 0, 4.4, 28),
        k.ball(k.paint(SILVER), 1, 3.5, 17.6, 0, 1.3),
        k.ball(k.paint(SILVER), 0.7, 0, 22.4, 0),
    )


def toque(k):
    w = k.paint(TOY.white)
    return k.group(k.cyl(w, 3.6, 2, 0, 15.8, 0, 3.6, 24), k.cyl(w, 3.3, 4, 0, 17.6, 0, 4.2, 24), k.ball(w, 4.2, 0, 21.6, 0, 0.5))


def straw_hat(k):
    return k.group(
        k.cyl(k.paint(STRAW), 6.6, 0.6, 0, 16.2, 0, 6.6, 32),
        k.cyl(k.paint(STRAW), 3.1, 2.6, 0, 16.6, 0, 2.8, 24),
        k.cyl(k.paint(TOY.red), 3.12, 0.7, 0, 16.9, 0, 3.05, 24),
    )


def souwester(k, col):
    flap = k.box(k.paint(col), 1, 5, 7.5, 0.4, -4.2, 10.5, 0)
    flap.rotation.z = -0.3
    return k.group(dome(k, k.paint(col), 3.9, 3.4, 0, 15.3, 0), k.cyl(k.paint(col), 4.9, 0.5, 0, 15.2, 0, 4.9, 28), flap)


def bobble_hat(k, col, bobble):
    return k.group(dome(k, k.paint(col), 3.7, 3.8, 0, 15, 0), k.cyl(k.paint(bobble), 3.8, 1, 0, 14.9, 0, 3.75, 24), k.ball(k.paint(bobble), 1.3, 0, 19.1, 0))


def bucket_hat(k, col):
    return k.group(k.cyl(k.paint(col), 5, 1.2, 0, 15.6, 0, 3.6, 28), k.cyl(k.paint(col), 3.5, 2.6, 0, 16.6, 0, 3.1, 24))


def boater(k, band_col):
    return k.group(
        k.cyl(k.paint(STRAW), 5.6, 0.5, 0, 16.3, 0, 5.6, 32),
        k.cyl(k.paint(STRAW), 3.3, 2.2, 0, 16.6, 0, 3.3, 24),
        k.cyl(k.paint(band_col), 3.36, 0.9, 0, 16.8, 0, 3.36, 24),
    )


def band_hat(k, col, plume):
    return k.group(
        k.cyl(k.paint(col), 3.5, 7, 0, 15.6, 0, 3.9, 24),
        k.box(k.paint(TOY.black), 2.6, 0.5, 5, 0.2, 3.6, 15.6, 0),
        k.ball(k.paint(GOLD), 1, 3.8, 18.5, 0),
        k.capsule(k.paint(plume), 0.9, 2.5, 2.4, 21.6, 0),
    )


def pillbox(k, col):
    return k.cyl(k.paint(col), 3.7, 2.6, 0, 15.6, 0, 3.9, 24)


# Carried things (built round the hand at the origin).


def flag(k, col):
    g = Node()
    g.add(rod(k, k.wood, (0, -2, 0), (0, 10, 0), 0.35))
    g.add(pivot("flag", 0, 9.6, 0, k.box(k.paint(col), 5.5, 3.6, 0.4, 0.15, 2.8, -3.6, 0)))
    return g


def lantern(k, light):
    black = k.paint(TOY.black)
    return k.group(
        k.ring(black, 1.2, 0.25, 0, -0.6, 0, True, math.pi),
        k.box(black, 3.2, 0.7, 3.2, 0.3, 0, -1.7, 0),
        k.box(k.glass, 2.6, 3, 2.6, 0.3, 0, -4.7, 0),
        k.ball(k.paint(light), 1, 0, -3.2, 0),
        k.box(black, 3.4, 0.8, 3.4, 0.3, 0, -5.4, 0),
    )


def suitcase(k, col, w=7, h=4.6, d=2.4):
    return k.group(
        k.box(k.paint(col), w, h, d, 0.6, 0, -h - 0.4, 0),
        k.ring(k.paint(TOY.black), 1, 0.3, 0, -0.4, 0, True, math.pi),
        k.box(k.paint(GOLD), 0.5, h + 0.1, d + 0.15, 0.1, -w / 4, -h - 0.45, 0),
        k.box(k.paint(GOLD), 0.5, h + 0.1, d + 0.15, 0.1, w / 4, -h - 0.45, 0),
    )


# ——— Animals ———


class Quad:
    def __init__(self, g, head, tail):
        self.g, self.head, self.tail = g, head, tail


def quad(k, coat, L, W, H, leg_h, leg_r, leg_col=None, hoof=None):
    """A chunky four-legged animal: a rounded block body on turned legs, with head and tail pivots to fill in."""
    leg_col = coat if leg_col is None else leg_col
    g = Node()
    g.add(k.box(k.paint(coat), L, H, W, min(W, H) * 0.42, 0, leg_h, 0))
    for sx in (-1, 1):
        for sz in (-1, 1):
            x = sx * (L / 2 - leg_r - 1.5)
            z = sz * (W / 2 - leg_r - 0.3)
            # A turned leg: a little wider at the foot, tapering up into the body.
            g.add(k.lathe(k.paint(leg_col), [(0.0, 0), (leg_r * 1.02, 0), (leg_r * 1.08, 0.35), (leg_r, 1.2), (leg_r * 0.85, leg_h + 2), (0.0, leg_h + 2)], x, 0, z, 20))
            if hoof:
                g.add(k.cyl(k.paint(hoof), leg_r + 0.2, 1.6, x, 0, z, leg_r + 0.05, 20))
    head = pivot("head", L / 2 - 1, leg_h + H * 0.7, 0)
    tail = pivot("tail", -L / 2 + 0.5, leg_h + H * 0.75, 0)
    g.add(head, tail)
    return Quad(g, head, tail)


def spots(k, col, z, lst):
    """Flat painted spots on an animal's sides (and top)."""
    parts = []
    for x, y, r in lst:
        parts.append(k.cylZ(k.paint(col), r, 0.6, x, y, z, 20))
        parts.append(k.cylZ(k.paint(col), r, 0.6, x, y, -z, 20))
    return k.group(*parts)


def bird(k, body, r, head_name, legs=0, neck=0, beak_col=None):
    """A small bird (a hen, a goose): egg body, wings, tail, legs, and a named head pivot."""
    g = Node()
    leg_h = legs
    m = k.paint(body)
    g.add(egg(k, m, r, 0, leg_h + r * 0.8, 0, 1.25, 0.85, 0.9))
    for s in (-1, 1):
        g.add(egg(k, m, r * 0.6, -r * 0.2, leg_h + r * 0.9, s * r * 0.8, 1.5, 0.6, 0.35))
    g.add(rod(k, m, (-r * 0.8, leg_h + r * 0.9, 0), (-r * 1.6, leg_h + r * 1.5, 0), r * 0.55, 0.2))
    if leg_h > 0:
        leg = k.paint(TOY.orange)
        for s in (-1, 1):
            g.add(rod(k, leg, (0, 0, s * r * 0.35), (0, leg_h + r * 0.4, s * r * 0.35), 0.4))
            g.add(k.box(leg, 2.2, 0.5, 1.4, 0.2, 0.7, 0, s * r * 0.35))
    head = pivot(head_name, r * 0.8, leg_h + r * 1.1, 0)
    if neck > 0:
        head.add(rod(k, m, (0, 0, 0), (r * 0.25, neck, 0), r * 0.32, r * 0.28))
    hr = r * 0.5
    head.add(k.ball(m, hr, r * 0.3, neck + hr * 0.7, 0))
    head.add(beak(k, k.paint(beak_col or TOY.orange), hr * 0.45, hr * 1.1, r * 0.3 + hr * 0.75, neck + hr * 0.55, 0))
    head.add(eyes(k, r * 0.3 + hr * 0.45, neck + hr * 1.05, hr * 0.62, max(0.35, hr * 0.17)))
    g.add(head)
    return g


def pond(k, r):
    """A pond: a disc of blue felt."""
    return k.feltDisc(r, k.water)
