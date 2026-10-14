"""Wild animals for life.py, ported from src/catalogue/assets/life.ts."""

import math

from kit import TOY, Node
from life_parts import GOLD, beak, dome, egg, eyes, pivot, pond, quad, rod, spots  # noqa: F401

DROPS = ["drop-0", "drop-1", "drop-2"]
PENGUINS = ["penguin-0", "penguin-1"]
PERCHES = ["perch-0", "perch-1", "perch-2"]


def nub(k, mat, r, x, y, z, sy=1):
    """A low-poly ball for small added details (claws, spots): k.ball spends at least 24 x 14 on any size."""
    prof = [(r * math.sin(math.pi * i / 6), -r * math.cos(math.pi * i / 6)) for i in range(7)]
    prof[0], prof[-1] = (0.0, -r), (0.0, r)
    n = k.lathe(mat, prof, x, y, z, 12)
    n.scale.y = sy
    return n


def rabbit(k):
    g = Node()
    b = pivot("bunny", 0, 0, 0)
    m = k.paint("#9a9590")
    b.add(egg(k, m, 4.4, 0, 4.4, 0, 1.25, 0.95, 0.95))
    for s in (-1, 1):
        b.add(egg(k, m, 2.6, -2.2, 2.6, s * 2.6, 1.4, 1, 0.6), k.capsule(m, 0.9, 1.6, 3.4, 0, s * 1.4))
    b.add(k.ball(m, 3, 5, 8.6, 0), k.ball(k.paint(TOY.white), 1.8, -5.4, 5, 0))
    for s in (-1, 1):
        b.add(rod(k, m, (4, 10.6, s * 1.2), (2, 17, s * 2.2), 1.1, 0.8))
        b.add(rod(k, k.paint(TOY.pink), (4.4, 11.4, s * 1.2), (2.4, 16.4, s * 2.2), 0.6, 0.4))
    b.add(eyes(k, 7.3, 9.4, 1.5, 0.5), k.ball(k.paint(TOY.pink), 0.6, 7.9, 8.2, 0))
    # Added: white cheek puffs under the nose.
    for s in (-1, 1):
        b.add(nub(k, k.paint(TOY.white), 0.8, 7.4, 7.6, s * 0.7))
    g.add(b)
    g.add(
        rod(k, k.paint(TOY.orange), (9, 1.4, 6), (17, 1.4, 4), 1.4, 0.2),
        *[rod(k, k.paint(TOY.leaf), (9, 1.4, 6), (6, 4.5, 6 + dz * 3), 0.4, 0.2) for dz in (-0.6, 0, 0.6)],
    )
    return g


def fox(k):
    q = quad(k, TOY.orange, 18, 7, 7, 6, 1.3, TOY.black)
    g, head, tail = q.g, q.head, q.tail
    m = k.paint(TOY.orange)
    w = k.paint(TOY.white)
    g.add(egg(k, w, 2.6, 7, 9, 0, 1, 1, 1.1))
    head.add(k.ball(m, 3.4, 2, 2.5, 0), beak(k, m, 1.8, 5, 4, 1.6, 0), k.ball(k.paint(TOY.black), 0.7, 9, 1.6, 0))
    for s in (-1, 1):
        head.add(egg(k, w, 1.6, 3.6, 1.2, s * 2, 1.3, 0.8, 0.6))
        head.add(
            rod(k, m, (1.4, 4.8, s * 1.6), (1, 8.4, s * 2.2), 1.3, 0.1, 8),
            rod(k, k.paint(TOY.black), (1.1, 7.4, s * 2.05), (1, 8.6, s * 2.2), 0.5, 0.05, 8),
        )
    head.add(eyes(k, 4.6, 3.8, 1.4, 0.5))
    tail.add(rod(k, m, (0, 0, 0), (-7, -2, 0), 1.6, 3), k.ball(w, 3, -8.5, -2.4, 0))
    return g


def deer(k):
    coat = "#b07a45"
    q = quad(k, coat, 22, 9, 10, 14, 1.3, coat, TOY.black)
    g, head, tail = q.g, q.head, q.tail
    m = k.paint(coat)
    g.add(spots(k, TOY.cream, 4.55, [(-4, 20, 1), (0, 21, 0.9), (4, 20, 1), (-7, 18, 0.8)]))
    head.add(rod(k, m, (-1.5, 0, 0), (2.4, 8, 0), 2.6, 2))
    head.add(k.ball(m, 2.8, 3.5, 9.2, 0), beak(k, m, 1.8, 3.6, 5, 8.4, 0), k.ball(k.paint(TOY.black), 0.6, 8.4, 8.4, 0), eyes(k, 5.2, 10, 1.7, 0.5))
    ant = k.wood
    for s in (-1, 1):
        head.add(rod(k, m, (2.8, 11, s * 2), (2.2, 12.2, s * 4), 0.9, 0.3, 8))
        head.add(rod(k, ant, (3, 11.4, s * 1.2), (2.4, 16, s * 3.4), 0.5, 0.35), rod(k, ant, (2.4, 16, s * 3.4), (0.6, 19, s * 4.6), 0.35, 0.2))
        head.add(rod(k, ant, (2.6, 14.2, s * 2.6), (5, 16.4, s * 3.4), 0.3, 0.2), rod(k, ant, (2.4, 16, s * 3.4), (3.6, 19, s * 3.6), 0.3, 0.2))
    tail.add(rod(k, k.paint(TOY.white), (0, 0, 0), (-1.5, 2, 0), 1, 0.5))
    return g


def bear(k):
    coat = "#6a4128"
    q = quad(k, coat, 28, 17, 16, 7, 3.6)
    g, head, tail = q.g, q.head, q.tail
    m = k.paint(coat)
    head.add(k.ball(m, 6.4, 3.5, 2.5, 0), egg(k, k.paint("#d9b98a"), 2.8, 8.8, 1.2, 0, 1, 0.8, 1), k.ball(k.paint(TOY.black), 1, 11.4, 2, 0))
    for s in (-1, 1):
        head.add(k.ball(m, 2, 1.8, 8, s * 4.2), k.ball(k.paint("#d9b98a"), 1.1, 2.6, 8, s * 4.2))
    head.add(eyes(k, 8.2, 4.4, 2.2, 0.65))
    tail.add(k.ball(m, 2.2, -0.5, 0, 0))
    # Added: three cream claws on each front paw (legs at x 8.9, z +-4.6, foot radius about 3.9).
    claw = k.paint(TOY.cream)
    for sz in (-1, 1):
        for dz in (-1.3, 0, 1.3):
            g.add(nub(k, claw, 0.55, 8.9 + 3.6, 0.6, sz * 4.6 + dz, 0.8))
    return g


def owl(k):
    g = Node()
    g.add(k.cyl(k.wood, 3.6, 22, 0, 0, 0, 3.4, 16), k.cyl(k.cut, 3.42, 0.3, 0, 21.9, 0, 3.42, 16))
    m = k.paint("#7a5230")
    g.add(k.capsule(m, 4.4, 4, 0, 22, 0), egg(k, k.paint(TOY.cream), 3.4, 2, 26, 0, 0.6, 1.1, 0.9))
    for s in (-1, 1):
        g.add(egg(k, k.paint("#5a3a20"), 3.2, -0.8, 27, s * 3.6, 1.1, 1.4, 0.45))
    for s in (-1, 1):
        g.add(k.box(k.paint(TOY.yellow), 2.2, 0.8, 1.4, 0.3, 2.6, 22, s * 1.6))
    h = pivot("head", 0, 33, 0)
    h.add(k.ball(m, 4.2, 0, 1.5, 0), k.cylX(k.paint(TOY.cream), 3.4, 1, 3.4, 1.5, 0, 24))
    for s in (-1, 1):
        h.add(k.cylX(k.paint(TOY.yellow), 1.5, 1, 3.9, 2.2, s * 1.6, 16), k.ball(k.paint(TOY.black), 0.8, 4.3, 2.2, s * 1.6))
        h.add(rod(k, m, (0.5, 4.5, s * 2.4), (0, 7.6, s * 3.4), 1.2, 0.1, 8))
    h.add(rod(k, k.paint(TOY.orange), (4.2, 1.4, 0), (4.8, -0.6, 0), 0.6, 0.05, 8))
    g.add(h)
    return g


def squirrel(k):
    g = Node()
    g.add(k.cyl(k.paint(TOY.brown), 7.5, 7, 0, 0, 0, 7, 20), k.cyl(k.wood, 7, 0.4, 0, 7, 0, 7, 20), k.ring(k.cut, 4, 0.2, 0, 7.4, 0), k.ring(k.cut, 1.8, 0.2, 0, 7.4, 0))
    m = k.paint("#b8552a")
    s = Node()
    s.add(egg(k, m, 3.2, 0, 4, 0, 1, 1.3, 0.9), egg(k, k.paint(TOY.cream), 2, 1.7, 4.6, 0, 0.6, 1.3, 1))
    for z in (-1, 1):
        s.add(egg(k, m, 1.8, -0.4, 1.6, z * 2.2, 1.6, 0.9, 0.7))
    s.add(k.ball(m, 2.4, 1.6, 9.2, 0), eyes(k, 3.5, 9.8, 1, 0.42), k.ball(k.paint(TOY.black), 0.4, 4, 8.8, 0))
    for z in (-1, 1):
        s.add(rod(k, m, (1, 10.8, z * 1.2), (0.8, 13, z * 1.6), 0.8, 0.1, 8))
    s.add(egg(k, k.paint("#8a5a2a"), 1, 3.6, 6.6, 0, 1, 1.2, 1), k.cyl(k.paint("#5a3a1a"), 1.05, 0.8, 3.6, 7.4, 0, 0.9, 12))
    tail = pivot("tail", -2.4, 2, 0)
    pts = [(-1, 1, 1.8), (-3, 4, 2.4), (-3.6, 8, 2.8), (-2.6, 11.6, 2.8), (-0.6, 13.8, 2.4)]
    for x, y, r in pts:
        tail.add(k.ball(m, r, x, y, 0))
    s.add(tail)
    g.add(k.at(s, 0, 7.4, 0))
    return g


def frog(k):
    g = Node()
    g.add(pond(k, 18))
    g.add(k.cyl(k.paint(TOY.leaf), 8, 0.8, 0, 1.2, 0, 8, 28), k.cyl(k.paint(TOY.leaf), 4, 0.8, 10, 1.2, 8, 4, 20))
    for i in range(6):
        g.add(k.ball(k.paint(TOY.pink), 1.3, 10 + math.cos(i) * 1.6, 2.6, 8 + math.sin(i) * 1.6, 0.6))
    g.add(k.ball(k.paint(TOY.yellow), 1, 10, 3, 8))
    f = pivot("frog", 0, 2, 0)
    m = k.paint("#4fa04a")
    f.add(egg(k, m, 4, 0, 2.8, 0, 1.2, 0.7, 1), egg(k, k.paint(TOY.yellow), 3, 1.5, 2, 0, 1, 0.5, 1))
    for s in (-1, 1):
        f.add(k.ball(m, 1.6, 2.4, 5.2, s * 2), k.ball(k.paint(TOY.white), 1, 3.2, 5.6, s * 2), k.ball(k.paint(TOY.black), 0.5, 4, 5.8, s * 2))
        f.add(egg(k, m, 2.2, -3, 1.4, s * 3.8, 1.6, 0.6, 0.8), k.box(m, 2.6, 0.6, 2, 0.25, -0.8, 0, s * 5))
        f.add(k.capsule(m, 0.7, 1.4, 3.5, 0, s * 2.4))
    f.add(k.box(k.paint("#2d6b3f"), 0.4, 0.4, 4, 0.15, 4.6, 2.8, 0))
    # Added: darker green painted spots on the back.
    for x, z in ((-1.5, -1.6), (0.8, 1.4), (-2.6, 1.2)):
        sp = nub(k, k.paint("#2d6b3f"), 0.9, x, 5.4, z, 0.3)
        f.add(sp)
    g.add(f)
    return g


def fish_jumping(k):
    g = Node()
    g.add(pond(k, 24))
    for x in (-12, 12):
        g.add(k.ring(k.paint(TOY.white), 3, 0.35, x, 1.3, 0), k.ring(k.paint(TOY.sky), 5, 0.3, x, 1.25, 0))
    fish = pivot("fish", 0, 14, 0)
    m = k.paint(TOY.orange)
    fish.add(egg(k, m, 3, 0, 0, 0, 2, 1, 0.7))
    fish.add(k.extrude(m, [(0, 0), (-5, 3.5), (-4, 0), (-5, -3.5)], 1, -5, 0, 0, 0.3))
    fish.add(k.extrude(m, [(0, 0), (3, 0), (-1, 2.6)], 0.8, -1, 2.4, 0, 0.3))
    fish.add(eyes(k, 4.2, 0.8, 1.6, 0.55))
    for s in (-1, 1):
        fish.add(k.cylX(k.paint(TOY.cream), 1.1, 0.4, 2.6, -0.8, s * 2, 10))
    g.add(fish)
    for i in range(3):
        g.add(pivot(DROPS[i], -12, 2, 0, k.ball(k.paint(TOY.sky), 0.8, 0, 0, 0)))
    return g


def elephant(k):
    g = Node()
    g.add(k.cyl(k.paint(TOY.red), 20, 10, 0, 0, 0, 20, 36), k.cyl(k.paint(TOY.yellow), 20.4, 1.4, 0, 0, 0, 20.4, 36), k.cyl(k.paint(TOY.yellow), 20.4, 1.5, 0, 8.6, 0, 20.4, 36))  # proud of the drum's top, not level with it
    for i in range(8):
        a = i / 8 * math.pi * 2
        g.add(k.ball(k.paint(TOY.white), 1.4, math.cos(a) * 20.1, 5, math.sin(a) * 20.1))
    grey = "#9a9ea6"
    q = quad(k, grey, 34, 18, 18, 12, 3.8)
    e, head, tail = q.g, q.head, q.tail
    e.add(k.box(k.paint(TOY.red), 14, 2, 19, 0.8, 0, 28.5, 0), k.box(k.paint(GOLD), 14.4, 1, 19.4, 0.4, 0, 28, 0), k.box(k.paint(TOY.red), 12, 7, 19.2, 1, 0, 22, 0))
    m = k.paint(grey)
    head.add(k.ball(m, 8, 4, 2, 0), eyes(k, 10.4, 5, 3.6, 0.8))
    for s in (-1, 1):
        head.add(egg(k, m, 7, 1, 2, s * 8, 0.25, 1.1, 1), rod(k, k.paint(TOY.cream), (10, -1.5, s * 3), (15, -5, s * 3.5), 1.1, 0.4, 10))
    head.add(k.cone(k.paint(TOY.red), 2.6, 4, 3, 9.4, 0, 16), rod(k, k.paint(GOLD), (3, 13.2, 0), (0, 11, 0), 0.3), k.ball(k.paint(GOLD), 0.8, 0, 11, 0))
    trunk = pivot("trunk", 10.5, 0, 0, rod(k, m, (0, 0, 0), (2, -8, 0), 3, 2.2), rod(k, m, (2, -8, 0), (3, -14, 0), 2.2, 1.6), rod(k, m, (3, -14, 0), (5.5, -16, 0), 1.6, 1.3))
    head.add(trunk)
    tail.add(rod(k, m, (0, 0, 0), (-1.5, -10, 0), 0.7), k.ball(k.paint(TOY.black), 1, -1.5, -10.5, 0, 1.5))
    # Added: three cream toenails on each front foot (legs at x 11.7, z +-4.9, foot radius about 4.1).
    nail = k.paint(TOY.cream)
    for sz in (-1, 1):
        for dz in (-1.5, 0, 1.5):
            e.add(nub(k, nail, 0.75, 11.7 + 3.7, 0.8, sz * 4.9 + dz, 0.9))
    g.add(k.at(e, 0, 10, 0))
    return g


def giraffe(k):
    q = quad(k, TOY.yellow, 24, 11, 12, 28, 1.8, TOY.yellow, TOY.brown)
    g, head, tail = q.g, q.head, q.tail
    head.name = "neck"
    m = k.paint(TOY.yellow)
    br = k.paint(TOY.brown)
    g.add(spots(k, TOY.brown, 5.55, [(-6, 34, 2.2), (0, 36, 2), (6, 33, 1.8), (-1, 31, 1.6), (-9, 37, 1.4)]))
    head.add(rod(k, m, (-1, 0, 0), (7, 28, 0), 3.4, 2.4))
    for x, y in ((0.5, 6), (2.5, 13), (4.4, 20)):
        head.add(k.cylZ(br, 1.3, 6, x, y, 0, 12))
    head.add(rod(k, br, (-3.2, 3, 0), (4.6, 29, 0), 0.9))
    face = k.box(m, 10, 4.6, 4.6, 2, 0, 0, 0)
    face.position.set(10, 27.8, 0)
    face.rotation.z = -0.25
    head.add(face, eyes(k, 9, 30.2, 2.3, 0.55))
    for s in (-1, 1):
        head.add(rod(k, m, (7.5, 30.5, s * 1.2), (7, 34, s * 1.6), 0.6), k.ball(br, 0.9, 7, 34.2, s * 1.6))
        head.add(rod(k, m, (6, 30, s * 2), (4.6, 31, s * 4.2), 0.9, 0.3, 8))
    tail.add(rod(k, m, (0, 0, 0), (-2, -10, 0), 0.6), k.ball(br, 1, -2, -10.5, 0, 1.5))
    return g


def penguins(k):
    g = Node()
    g.add(k.feltDisc(24, k.water))
    g.add(k.lathe(k.paint(TOY.white), [(0.01, 0), (16, 0), (15, 3), (0.01, 3.4)], 0, 0.6, 0, 9))
    for i, x, z, sc in ((0, 3, -4, 1), (1, -5, 5, 0.8)):
        p = pivot(PENGUINS[i], x, 3.6, z)
        b = k.paint(TOY.black)
        p.add(k.capsule(b, 4.5, 6), egg(k, k.paint(TOY.white), 3.6, 2, 6.6, 0, 0.6, 1.4, 0.95))
        p.add(beak(k, k.paint(TOY.orange), 0.9, 3, 4, 12, 0), eyes(k, 3.6, 13.2, 1.6, 0.5, TOY.white))
        for side in (-1, 1):
            fl = egg(k, b, 2.8, 0, 8, side * 4.4, 0.6, 1.6, 0.35)
            fl.rotation.x = side * 0.25
            p.add(fl, k.box(k.paint(TOY.orange), 3, 0.8, 1.8, 0.3, 2.4, 0, side * 1.8))
        p.scale.setScalar(sc)
        g.add(p)
    g.add(k.at(egg(k, k.paint(TOY.sky), 1.5, 9, 4.6, 6, 2, 0.6, 0.6), 0, 0, 0, 0.4))
    return g


def seagulls(k):
    g = Node()
    g.add(pond(k, 30))

    def gull(name, flying):
        b = pivot(name, 0, 0, 0)
        w = k.paint(TOY.white)
        b.add(egg(k, w, 3, 0, 3.5, 0, 1.4, 0.8, 0.85), k.ball(w, 2, 3.4, 5.6, 0))
        b.add(beak(k, k.paint(TOY.yellow), 0.6, 2.6, 5, 5.2, 0), k.ball(k.paint(TOY.red), 0.3, 6.2, 5, 0), eyes(k, 4.4, 6.2, 1.3, 0.35))
        b.add(rod(k, k.paint(TOY.black), (-3, 3.9, 0), (-6, 4.4, 0), 1.2, 0.3))
        for s in (-1, 1):
            wing = pivot(("flap-r" if s > 0 else "flap-l") if flying else "", -0.5, 4.6, s * 1.8)
            wm = egg(k, k.paint(TOY.grey), 3, 0 if flying else -1.5, 0, s * 5 if flying else 0, 0.9 if flying else 1.6, 0.25, 1.8 if flying else 0.5)
            wing.add(wm, k.ball(k.paint(TOY.black), 0.9, -0.5 if flying else -5, 0, s * 9.5 if flying else 0, 0.4))
            b.add(wing)
        if not flying:
            for s in (-1, 1):
                b.add(rod(k, k.paint(TOY.orange), (0, 0, s * 0.9), (0, 1.6, s * 0.9), 0.35))
        return b

    posts = [(-14, -6, 14), (0, 8, 18), (14, -4, 12)]
    for i, (x, z, h) in enumerate(posts):
        g.add(k.cyl(k.paint("#8a6a4a"), 3.4, h, x, 0, z, 3.2, 16), k.ring(k.paint(TOY.black), 3.4, 0.4, x, h * 0.6, z), dome(k, k.paint("#8a6a4a"), 3.2, 1.6, x, h, z))
        g.add(k.at(pivot(PERCHES[i], x, h + 1.4, z, gull("", False)), 0, 0, 0, i * 1.1 - 1))
    g.add(pivot("flyer", 0, 40, 0, gull("glider", True)))
    return g


def butterfly(k):
    g = Node()
    g.add(k.feltDisc(12))
    g.add(rod(k, k.paint(TOY.leaf), (0, 0, 0), (1, 20, 0), 0.6, 0.5))
    for s in (-1, 1):
        g.add(egg(k, k.paint(TOY.leaf), 2.4, s * 2, 7 + s, s * 0.5, 1.4, 0.3, 0.8))
    g.add(k.ball(k.paint(TOY.yellow), 1.8, 1, 21, 0, 0.8))
    for i in range(6):
        a = i / 6 * math.pi * 2
        g.add(egg(k, k.paint(TOY.pink), 1.9, 1 + math.cos(a) * 3, 21, math.sin(a) * 3, 1, 0.45, 1))
    fly = pivot("fly", 8, 24, 0)
    fly.add(rod(k, k.paint(TOY.black), (-2.2, 0, 0), (2.2, 0, 0), 0.5, 0.4))
    for s in (-1, 1):
        fly.add(rod(k, k.paint(TOY.black), (2, 0.2, s * 0.3), (3.6, 2.2, s * 1.2), 0.12, 0.12, 6), k.ball(k.paint(TOY.black), 0.3, 3.6, 2.2, s * 1.2))
        wing = pivot("wing-r" if s > 0 else "wing-l", 0, 0, s * 0.3)
        wing.add(egg(k, k.paint(TOY.blue), 2.2, 0.6, 0, s * 2.4, 1, 0.15, 1.1), egg(k, k.paint(TOY.yellow), 1.4, -1.4, 0, s * 1.8, 1, 0.12, 1))
        wing.add(k.ball(k.paint(TOY.white), 0.5, 0.8, 0.3, s * 2.8, 0.3))
        fly.add(wing)
    g.add(fly)
    return g


def dinosaur(k):
    g = Node()
    m = k.paint(TOY.leaf)
    g.add(egg(k, m, 10, 0, 17, 0, 1.5, 0.75, 0.9), egg(k, k.paint(TOY.yellow), 8, 1, 14.5, 0, 1.4, 0.55, 0.85))
    for x in (-8, 8):
        for z in (-5, 5):
            g.add(k.cyl(m, 3.6, 13, x, 0, z, 3.2, 16), k.cyl(k.paint(TOY.cream), 3.8, 1, x, 0, z, 3.7, 16))
    g.add(rod(k, m, (-12, 18, 0), (-34, 22, 0), 5, 0.8))
    plates = [-24, -16, -8, 0, 8]
    for i, x in enumerate(plates):
        y = 20.5 + (x + 24) * 0.12 if x < -12 else 24.5 - abs(x) * 0.04
        size = 2.2 + (0 if i == 0 else 0.6) + (0.4 if i > 1 else 0)
        g.add(k.cone(k.paint(TOY.orange), size, size * 1.4, x, y - 1, 0, 4))
    neck = pivot("neck", 12, 21, 0)
    neck.add(rod(k, m, (-2, -2, 0), (8, 16, 0), 4, 3))
    neck.add(egg(k, m, 4.6, 10, 18, 0, 1.4, 0.85, 0.95), eyes(k, 12, 20.2, 2.4, 0.8))
    neck.add(k.ball(k.paint(TOY.black), 0.4, 15.8, 17.6, -1.2), k.ball(k.paint(TOY.black), 0.4, 15.8, 17.6, 1.2))
    g.add(neck)
    return g


ASSETS = [
    ("life-rabbit", rabbit),
    ("life-fox", fox),
    ("life-deer", deer),
    ("life-bear", bear),
    ("life-owl", owl),
    ("life-squirrel", squirrel),
    ("life-frog", frog),
    ("life-fish-jumping", fish_jumping),
    ("life-elephant", elephant),
    ("life-giraffe", giraffe),
    ("life-penguins", penguins),
    ("life-seagulls", seagulls),
    ("life-butterfly", butterfly),
    ("life-dinosaur", dinosaur),
]
