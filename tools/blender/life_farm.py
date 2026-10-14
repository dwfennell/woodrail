"""Pets and farm animals for life.py, ported from src/catalogue/assets/life.ts."""

import math

from kit import TOY, Node
from life_parts import GOLD, beak, bird, dome, egg, eyes, pivot, pond, quad, rod, spots  # noqa: F401

PECKS = ["peck-0", "peck-1", "peck-2"]
DUCKS = ["duck-0", "duck-1", "duck-2", "duck-3"]
SWANS = ["swan-0", "swan-1"]
GEESE = ["goose-0", "goose-1"]


def find(node, name):
    """three.js getObjectByName: the first node (depth first, itself included) with this name."""
    if node.name == name:
        return node
    for c in node.children:
        f = find(c, name)
        if f is not None:
            return f
    return None


def dog(k):
    q = quad(k, "#a0683a", 18, 8, 7, 5, 1.6)
    g, head, tail = q.g, q.head, q.tail
    m = k.paint("#a0683a")
    head.add(k.ball(m, 3.8, 2, 3, 0), k.box(m, 4, 3, 3.6, 1.2, 5, 0.6, 0), k.ball(k.paint(TOY.black), 0.9, 7, 2.4, 0))
    head.add(eyes(k, 4.6, 4.4, 1.5, 0.55))
    for s in (-1, 1):
        head.add(egg(k, k.paint(TOY.black), 1.5, 1, 2.6, s * 3.6, 0.9, 1.8, 0.45))
    head.add(k.ring(k.paint(TOY.red), 3, 0.5, 0, 0, 0, True))
    head.children[-1].rotation.y = math.pi / 2
    tail.add(rod(k, m, (0, 0, 0), (-3.5, 4.5, 0), 1, 0.5))
    return g


def cat(k):
    g = Node()
    m = k.paint(TOY.orange)
    g.add(egg(k, m, 4, 0, 4.4, 0, 1, 1.1, 0.9))
    for s in (-1, 1):
        g.add(egg(k, m, 2.4, -0.8, 2.2, s * 2.8, 1.3, 0.9, 0.7), k.capsule(m, 0.9, 3, 2.6, 0, s * 1.3))
    g.add(k.ball(m, 3, 1, 10.4, 0))
    for s in (-1, 1):
        g.add(rod(k, m, (0.8, 12, s * 1.6), (0.6, 14.4, s * 2.1), 1.1, 0.1, 8))
    g.add(eyes(k, 3.6, 11, 1.1, 0.5, TOY.leaf), k.ball(k.paint(TOY.pink), 0.45, 4, 10, 0))
    g.add(egg(k, k.paint(TOY.cream), 2, 2.5, 6, 0, 0.6, 1.3, 1))
    # Added: a cream tip on the tail, painted over the end ball.
    tail = pivot(
        "tail", -3.5, 1.5, 0,
        rod(k, m, (0, 0, 0), (-3, 1, 2), 0.9),
        rod(k, m, (-3, 1, 2), (-3.5, 5, 4), 0.9, 0.7),
        k.ball(m, 0.7, -3.5, 5, 4),
        k.ball(k.paint(TOY.cream), 0.78, -3.5, 5.15, 4),
    )
    g.add(tail)
    return g


def cow(k):
    q = quad(k, TOY.white, 32, 15, 15, 10, 2.5, TOY.white, TOY.black)
    g, head, tail = q.g, q.head, q.tail
    g.add(spots(k, TOY.black, 7.55, [(-6, 18, 3.4), (6, 15, 2.8), (-10, 13, 2)]))
    g.add(k.cyl(k.paint(TOY.black), 3.5, 0.5, 2, 25, 1.5, 3.5, 16))
    g.add(
        egg(k, k.paint(TOY.pink), 3, -8, 10, 0, 1, 0.6, 1),
        k.many(4, lambda i: k.cyl(k.paint(TOY.pink), 0.5, 1.5, -9 + (i % 2) * 2, 7.5, -1 if i < 2 else 1)),
    )
    w = k.paint(TOY.white)
    head.add(k.box(w, 9, 9, 8, 3, 5, -5, 0), k.box(k.paint(TOY.pink), 4, 5, 8.4, 2, 9, -6, 0), eyes(k, 7, 1.5, 2.6, 0.7))
    head.add(k.ball(k.paint(TOY.black), 0.5, 11, -3, -1.5), k.ball(k.paint(TOY.black), 0.5, 11, -3, 1.5))
    for s in (-1, 1):
        head.add(rod(k, k.paint(TOY.cream), (4, 3.5, s * 2.5), (4.5, 6.5, s * 5.5), 0.9, 0.3))
        head.add(k.box(w, 2.5, 1.5, 3, 0.5, 2.5, 1.5, s * 5))
    head.add(k.cone(k.paint(GOLD), 1.5, 2.5, 2, -8, 0, 12))
    # Added: the bell's clapper peeping out under its rim.
    head.add(k.ball(k.paint(GOLD), 0.55, 2, -8.2, 0))
    tail.add(rod(k, w, (0, 0, 0), (-1.5, -11, 0), 0.6), k.ball(k.paint(TOY.black), 1.2, -1.5, -11.5, 0, 1.4))
    return g


def sheep(k):
    q = quad(k, TOY.white, 20, 12, 10, 6, 1.3, TOY.black)
    g, head = q.g, q.head
    w = k.paint(TOY.white)
    for x in (-6, 0, 6):
        for s in (-1, 1):
            g.add(k.ball(w, 3.6, x, 11.5, s * 3.5))
    for x in (-3, 3):
        g.add(k.ball(w, 3.8, x, 15, 0))
    g.add(k.ball(w, 3.6, -9, 12, 0))
    b = k.paint(TOY.black)
    head.add(k.box(b, 6, 6, 5, 2.2, 4, -1, 0), eyes(k, 7, 3, 1.5, 0.55, TOY.white), k.ball(w, 2.6, 2, 5, 0))
    for s in (-1, 1):
        head.add(egg(k, b, 1.2, 3, 3, s * 3.2, 0.7, 0.7, 1.8))
    return g


def pig(k):
    q = quad(k, TOY.pink, 22, 13, 12, 5, 2.1)
    g, head, tail = q.g, q.head, q.tail
    g.add(k.cyl(k.paint("#5a3a22"), 10, 0.5, -1, 0, 0, 9.5, 24))
    m = k.paint(TOY.pink)
    head.add(k.ball(m, 5, 2, 0.5, 0), k.cylX(k.paint("#d9768f"), 2.4, 3, 7.4, -0.2, 0, 16))
    head.add(k.ball(k.paint("#7a3040"), 0.5, 8.9, -0.2, -0.9), k.ball(k.paint("#7a3040"), 0.5, 8.9, -0.2, 0.9), eyes(k, 5.6, 2.8, 2, 0.55))
    for s in (-1, 1):
        head.add(rod(k, m, (1.5, 3.5, s * 2.6), (3, 6.5, s * 3.6), 1.5, 0.1, 8))
    curl = pivot("curl", -0.6, 0, 0, k.ring(m, 1.4, 0.45, 0, 0, 0, True, math.pi * 1.6))
    curl.rotation.y = math.pi / 2
    tail.add(curl)
    return g


def horse(k):
    coat = "#9a5a2e"
    q = quad(k, coat, 30, 11, 12, 15, 1.9, coat, TOY.black)
    g, head, tail = q.g, q.head, q.tail
    m = k.paint(coat)
    b = k.paint(TOY.black)
    g.add(k.box(k.paint(TOY.red), 10, 2, 11.8, 0.8, 0, 25.5, 0), k.box(k.paint(GOLD), 10.4, 0.6, 12.2, 0.3, 0, 25.4, 0))
    head.add(rod(k, m, (-2, 0, 0), (3.5, 11, 0), 3.6, 2.8))
    face = k.box(m, 10, 5, 5, 2, 0, 0, 0)
    face.position.set(7.5, 10, 0)
    face.rotation.z = -0.55
    head.add(face, rod(k, b, (-4, 2, 0), (1.4, 13.6, 0), 1.2), eyes(k, 6, 12, 2.3, 0.6))
    for s in (-1, 1):
        head.add(rod(k, m, (3.6, 13, s * 1.3), (3.4, 16, s * 1.5), 1, 0.1, 8))
    head.add(k.ball(b, 0.5, 11.2, 6.6, -1.2), k.ball(b, 0.5, 11.2, 6.6, 1.2))
    # Added: a black forelock tuft between the ears.
    head.add(k.ball(b, 1.1, 4.4, 14.2, 0))
    tail.add(rod(k, b, (0, 0, 0), (-3, -4, 0), 1.4, 1.8), rod(k, b, (-3, -4, 0), (-3.5, -12, 0), 1.8, 1))
    return g


def goat(k):
    g = Node()
    g.add(dome(k, k.paint(TOY.grey), 13, 8, 0, 0, 0))
    # Added: dark hooves (quad's hoof option), as on the cow and horse.
    q = quad(k, TOY.white, 20, 9, 9, 9, 1.4, None, "#4a4a4a")
    goat_g, head, tail = q.g, q.head, q.tail
    g.add(k.at(goat_g, 0, 5, 0))
    goat_g.add(k.box(k.paint(TOY.grey), 12, 3, 9.4, 1.4, 0, 15.5, 0))
    m = k.paint(TOY.white)
    face = k.box(m, 8, 5, 5, 2, 0, 0, 0)
    face.position.set(4.5, 2.5, 0)
    face.rotation.z = -0.6
    head.add(face, eyes(k, 4.4, 4.6, 2.2, 0.55), rod(k, m, (6, -0.5, 0), (6.5, -4.5, 0), 1, 0.2, 8))
    for s in (-1, 1):
        horn = k.ring(k.paint(TOY.cream), 2.6, 0.7, 0.5, 6, s * 1.6, True, math.pi * 1.1)
        head.add(horn, k.box(m, 2.5, 1.2, 2.5, 0.5, 2, 4.4, s * 3.4))
    tail.add(rod(k, m, (0, 0, 0), (-1.5, 3, 0), 0.8, 0.3))
    return g


def chickens(k):
    g = Node()
    birds = [
        (TOY.white, 0, 0, 0),
        ("#a85a2a", -9, 6, 2.2),
        ("#5a3a2a", 7, -7, -0.8),
    ]
    for i, (col, x, z, ry) in enumerate(birds):
        r = 4.4 if i == 2 else 3.6
        b = bird(k, col, r, f"peck-{i}", legs=2.5, beak_col=TOY.yellow)
        h = find(b, f"peck-{i}")
        h.add(k.many(3, lambda j: k.ball(k.paint(TOY.red), r * 0.2, r * 0.1 + j * r * 0.18, r * 1.05 + math.sin(j) * 0.4, 0)))
        h.add(k.ball(k.paint(TOY.red), r * 0.16, r * 0.75, r * 0.05, 0, 1.6))
        if i == 2:
            b.add(rod(k, k.paint(TOY.green), (-3, 7.8, 0), (-8, 12, 0), 2, 0.2), rod(k, k.paint(TOY.black), (-3.4, 7, 0), (-7.6, 9.8, 0), 1.6, 0.2))
        g.add(k.at(b, x, 0, z, ry))
    for i in range(9):
        g.add(k.ball(k.paint(TOY.yellow), 0.5, 4 + math.sin(i * 2.4) * 4, 0.4, 3 + math.cos(i * 2.4) * 4))
    return g


def ducks(k):
    g = Node()
    g.add(pond(k, 28))
    line = [
        (10, 0, 1, TOY.white),
        (0, 3, 0.55, TOY.yellow),
        (-8, -2, 0.55, TOY.yellow),
        (-16, 2, 0.55, TOY.yellow),
    ]
    for i, (x, z, s, col) in enumerate(line):
        d = bird(k, col, 4.4, "", neck=1.5)
        d.scale.setScalar(s)
        g.add(pivot(DUCKS[i], x, -0.6, z, d))
    return g


def swans(k):
    g = Node()
    g.add(pond(k, 32))
    for i, x, ry in ((0, -9, 0), (1, 9, math.pi)):
        s = Node()
        w = k.paint(TOY.white)
        s.add(egg(k, w, 6, 0, 3, 0, 1.4, 0.65, 1))
        for side in (-1, 1):
            wing = egg(k, w, 4.5, -2.5, 5.5, side * 3.5, 1.5, 0.6, 0.45)
            wing.rotation.z = 0.35
            s.add(wing)
        s.add(rod(k, w, (-7, 4.5, 0), (-10, 8, 0), 2.4, 0.4))
        s.add(rod(k, w, (5, 4, 0), (3, 11, 0), 1.6, 1.3), rod(k, w, (3, 11, 0), (4.2, 16, 0), 1.3, 1.2))
        s.add(k.ball(w, 2, 5, 16.5, 0), beak(k, k.paint(TOY.orange), 0.9, 3.6, 6.4, 16, 0), k.ball(k.paint(TOY.black), 0.8, 6.6, 16.5, 0))
        s.add(eyes(k, 5.6, 17.3, 1.4, 0.4))
        g.add(pivot(SWANS[i], x, -0.2, 0, k.at(s, 0, 0, 0, ry)))
    return g


def geese(k):
    g = Node()
    for i, x, z, ry in ((0, 4, -5, 0.3), (1, -5, 6, -0.4)):
        b = bird(k, TOY.grey if i else TOY.white, 5, GEESE[i], legs=4, neck=7)
        g.add(k.at(b, x, 0, z, ry))
    return g


ASSETS = [
    ("life-dog", dog),
    ("life-cat", cat),
    ("life-cow", cow),
    ("life-sheep", sheep),
    ("life-pig", pig),
    ("life-horse", horse),
    ("life-goat", goat),
    ("life-chickens", chickens),
    ("life-ducks", ducks),
    ("life-swans", swans),
    ("life-geese", geese),
]
