"""Town buildings for bldg.py, ported from src/catalogue/assets/buildings.ts."""

import math

from kit import TOY, Node
from bldg_parts import (  # noqa: F401
    BRICK, FRAME, SLATE, STONE, WIN, awningX, bench, chimney, churn, clock, crate, doorX, doorZ, gable, glassBand, hip,
    house, lamp, nameBoard, named, panel, peg, pine, platform, sack, smoke, winX, winZ,
)


def _arc(cx, cy, r, a0, a1, step=2.0, least=12):
    """Points along an arc from angle a0 to a1 (either way round), ends included, about one every `step` mm."""
    span = abs(a1 - a0)
    n = max(math.ceil(r * span / step), math.ceil(least * span / math.pi), 2)
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def _step(k, x, z, w, d=4):
    """A stone doorstep in front of a door facing +x at x (detail added in the port)."""
    return k.box(k.paint(STONE), d, 1.2, w + 4, 0.4, x + d / 2, 0, z)


def fire_station(k):
    g = Node()
    g.add(k.box(k.paint(BRICK), 56, 44, 44, 2))
    g.add(k.box(k.paint(TOY.cream), 60, 4, 48, 1, 0, 44, 0))
    for z in (-11.5, 11.5):
        g.add(k.box(k.paint(WIN), 1.4, 28, 19, 0.3, 28.2, 0, z))
        d = named(Node(), "door")
        d.add(k.box(k.paint(TOY.red), 1.8, 28, 19, 0.5, 0, 0, 0))
        for y in (7, 14, 21):
            d.add(k.box(k.paint(TOY.white), 2.2, 0.8, 18, 0.2, 0, y, 0))
        g.add(k.at(d, 29.4, 0, z))
    # Detail: a cream pier between the two bays and a concrete apron in front of them.
    g.add(k.box(k.paint(TOY.cream), 2.6, 30, 3.4, 0.5, 28.4, 0, 0))
    g.add(k.box(k.paint(STONE), 6, 0.8, 48, 0.3, 31, 0, 0))
    g.add(k.box(k.paint(TOY.white), 2, 6, 40, 0.5, 29, 32, 0))
    g.add(k.box(k.paint(TOY.red), 2.4, 3, 30, 0.4, 29.4, 33.5, 0))
    # Hose tower at the back.
    g.add(k.box(k.paint(BRICK), 18, 76, 18, 2, -22, 0, -14))
    g.add(hip(k, k.paint(TOY.red), 22, 10, -22, 76, -14))
    for y in (52, 64):
        g.add(winX(k, -13, y, -14, 6, 8))
    # Bell on a bracket.
    g.add(k.box(k.paint(TOY.black), 6, 1.5, 1.5, 0.3, 31, 40, -18))
    g.add(k.lathe(k.paint(TOY.yellow), [(0, 0), (3.6, 0), (3, 2), (2, 5), (0, 5.6)], 34, 34, -18, 16))
    return g


def police_station(k):
    g = house(k, 56, 36, 38, k.paint(TOY.white), TOY.blue, 14)
    g.add(doorX(k, TOY.blue, 28, 0, 11, 20))
    g.add(_step(k, 28, 0, 11))
    g.add(k.box(k.paint(TOY.blue), 4, 2, 22, 0.5, 30, 20, 0))
    for z in (-12, 12):
        g.add(winX(k, 28, 10, z, 7, 9), winX(k, 28, 28, z, 7, 9))
    g.add(winX(k, 28, 28, 0, 7, 9))
    g.add(k.box(k.paint(TOY.blue), 2, 4, 50, 0.4, 28.4, 35, 0))
    g.add(k.box(k.paint(TOY.white), 2.2, 2, 30, 0.4, 28.8, 36, 0))
    g.add(k.box(k.paint(TOY.black), 6, 1.5, 1.5, 0.3, 31, 24, 0))
    g.add(k.box(k.paint("#3a4f80"), 4, 5, 4, 1, 34, 23, 0))
    g.add(named(k.box(k.paint("#5ea8ff"), 4.4, 3.4, 4.4, 1, 34, 23.8, 0), "blue"))
    g.add(chimney(k, -18, 44, 8))
    g.add(peg(k, TOY.blue, TOY.blue, 38, 0, 12))
    return g


def post_office(k):
    g = house(k, 52, 34, 34, k.paint(TOY.cream), TOY.red, 14)
    g.add(k.box(k.paint(TOY.red), 2, 4, 34, 0.5, 26.4, 22, 0))
    g.add(doorX(k, TOY.red, 26, -10, 10, 18))
    g.add(_step(k, 26, -10, 10))
    g.add(k.box(k.paint(WIN), 1.6, 14, 18, 0.4, 26, 4, 8))
    # Detail: a white sill under the shop window.
    g.add(k.box(k.paint(FRAME), 2.6, 1.4, 20, 0.4, 26.4, 2.6, 8))
    g.add(winX(k, 26, 28, -8, 8, 7), winX(k, 26, 28, 8, 8, 7))
    # Envelope sign.
    g.add(k.box(k.paint(TOY.white), 2, 9, 14, 0.4, 28, 40, 0))
    for s in (-1, 1):
        flap = k.box(k.paint(TOY.red), 2.4, 0.8, 8.4, 0.2, 28.2, 46, s * 3.4)
        flap.rotation.x = s * 0.6
        g.add(flap)
    # Pillar box.
    g.add(k.cyl(k.paint(TOY.red), 3.6, 18, 36, 0, 14, 3.6, 18), k.ball(k.paint(TOY.red), 3.8, 36, 18, 14, 0.6))
    g.add(k.box(k.paint(TOY.black), 1, 1, 4, 0.2, 39.4, 14, 14))
    g.add(chimney(k, 16, 44, -6))
    return g


def bakery(k):
    g = house(k, 46, 32, 34, k.paint(TOY.cream), TOY.brown, 13)
    g.add(doorX(k, TOY.brown, 23, 10, 9, 18))
    g.add(_step(k, 23, 10, 9))
    g.add(k.box(k.paint(WIN), 1.6, 12, 16, 0.4, 23, 5, -6))
    g.add(k.box(k.paint(FRAME), 2.6, 1.4, 18, 0.4, 23.4, 3.6, -6))
    g.add(awningX(k, 23, 24, 0, 32, TOY.orange, TOY.cream))
    g.add(winX(k, 23, 30, 0, 9, 7))
    g.add(chimney(k, -14, 42, 6, 16), smoke(k, -14, 60, 6))
    # Giant loaf on the ridge.
    loaf = k.ball(k.paint("#c98a46"), 9, 4, 54, 0, 0.55)
    loaf.scale.x = 1.7
    g.add(loaf)
    for x in (-6, 0, 6):
        g.add(k.box(k.paint("#e8c48a"), 1.2, 1, 9, 0.2, 4 + x, 58.4, 0))
    return g


def cafe(k):
    g = house(k, 40, 30, 30, k.paint(TOY.green), TOY.cream, 12)
    g.add(doorX(k, TOY.cream, 20, -8, 9, 17))
    g.add(_step(k, 20, -8, 9))
    g.add(k.box(k.paint(WIN), 1.6, 12, 12, 0.4, 20, 5, 6))
    g.add(k.box(k.paint(FRAME), 2.6, 1.4, 14, 0.4, 20.4, 3.6, 6))
    g.add(awningX(k, 20, 23, 0, 28, TOY.green, TOY.cream))
    # Cup sign on the gable.
    g.add(
        k.lathe(k.paint(TOY.white), [(0, 0), (2.4, 0), (3.4, 5), (0, 5)], 21.5, 30, 0, 14),
        k.ring(k.paint(TOY.white), 1.6, 0.6, 21.5, 33, 3.2, True),
    )
    for x, z, c in ((36, -10, TOY.red), (36, 12, TOY.yellow)):
        g.add(k.cyl(k.wood, 5, 1, x, 9, z, 5, 18), k.cyl(k.paint(TOY.black), 0.8, 9, x, 0, z, 0.8, 8))
        g.add(k.cyl(k.paint(TOY.white), 0.5, 26, x, 0, z, 0.5, 6), k.cone(k.paint(c), 11, 5, x, 24, z, 8))
        g.add(k.box(k.wood, 4, 5, 4, 0.6, x + 8, 0, z), k.box(k.wood, 4, 5, 4, 0.6, x - 8, 0, z))
    g.add(peg(k, TOY.pink, None, 44, 0, -10))
    return g


def school(k):
    """
    A schoolhouse for a two-square town lot (about 50 x 78): the long yellow front faces +x, with the door in the middle
    under a bell cupola on the ridge (the bell, "bell", swings), printed windows either side, and a playground fence
    along the front, open at the gate.
    """
    g = Node()
    body = house(k, 70, 34, 32, k.paint(TOY.yellow), TOY.red, 15)
    g.add(k.at(body, 0, 0, 0, math.pi / 2))
    g.add(doorX(k, TOY.blue, 17, 0, 11, 20))
    g.add(_step(k, 17, 0, 11))
    for z in (-26, -12, 12, 26):
        g.add(winX(k, 17, 14, z, 8, 13))
    # Cupola on the ridge, over the door.
    white = k.paint(TOY.white)
    g.add(k.box(white, 14, 6, 14, 1, 0, 43, 0))
    for x, z in ((-5.5, -5.5), (5.5, -5.5), (-5.5, 5.5), (5.5, 5.5)):
        g.add(k.box(white, 2, 12, 2, 0.4, x, 49, z))
    g.add(hip(k, k.paint(TOY.red), 17, 9, 0, 61, 0), k.cyl(k.paint(TOY.yellow), 0.6, 6, 0, 69, 0, 0.4, 6))
    bell = named(Node(), "bell")
    bell.add(
        k.lathe(k.paint(TOY.yellow), [(0, -8), (4, -8), (3.4, -6), (2.4, -2), (0, -1)], 0, 0, 0, 16),
        k.ball(k.paint(TOY.black), 1, 0, -8.4, 0),
    )
    g.add(k.at(bell, 0, 60, 0))
    # Playground fence along the front, open at the gate in front of the door.
    for z in (-36, -24, -12, 12, 24, 36):
        g.add(k.box(white, 1.6, 9, 1.6, 0.3, 27, 0, z))
    for z in (-24, 24):
        g.add(k.box(white, 1.4, 1.6, 25.6, 0.3, 27, 6, z))
    for z in (-8, 8):
        g.add(k.box(k.paint(TOY.blue), 2.2, 12, 2.2, 0.4, 27, 0, z))
    g.add(peg(k, TOY.red, None, 23, 0, -30), peg(k, TOY.blue, None, 23, 0, 31))
    return g


def church(k):
    g = Node()
    n = k.at(house(k, 70, 34, 34, k.paint(STONE), SLATE, 22), -14, 0, 0)
    for x in (-26, -10, 6, 22):
        n.add(winZ(k, x, 12, 17.2, 7, 16), winZ(k, x, 12, -17.2, 7, 16))
    g.add(n)
    g.add(k.box(k.paint(STONE), 26, 70, 26, 2, 30, 0, 0))
    g.add(k.box(k.paint(TOY.cream), 30, 3, 30, 1, 30, 70, 0))
    g.add(hip(k, k.paint(SLATE), 26, 54, 30, 73, 0))
    g.add(k.cyl(k.paint(TOY.yellow), 0.8, 12, 30, 124, 0, 0.8, 8), k.box(k.paint(TOY.yellow), 1.6, 1.6, 7, 0.3, 30, 132, 0))
    outline = [(-6, 0), (6, 0)] + _arc(0, 14, 6, 0, math.pi)
    door = k.extrude(k.paint(TOY.red), outline, 2, 0, 0, 0, 0.3)
    g.add(k.at(door, 43.2, 0, 0, math.pi / 2))
    # Detail: a stone step under the arched door.
    g.add(k.box(k.paint(STONE), 4, 1.2, 16, 0.4, 45, 0, 0))
    g.add(k.cylX(k.paint(TOY.blue), 6, 1.6, 43.2, 40, 0, 20), k.cylX(k.paint(TOY.yellow), 2.2, 2, 43.4, 40, 0, 12))
    for z in (-5, 5):
        g.add(k.box(k.paint(WIN), 1.6, 10, 4, 0.4, 43, 56, z))
    return g


def town_hall(k):
    g = Node()
    cream = k.paint(TOY.cream)
    g.add(k.box(k.paint(STONE), 70, 4, 80, 1, 0, 0, 0))
    g.add(k.box(cream, 50, 40, 76, 2, -8, 4, 0))
    g.add(k.box(k.paint(TOY.blue), 54, 3, 80, 1, -8, 44, 0))
    for z in (-30, -18, 18, 30):
        g.add(winX(k, 17, 26, z, 7, 10), winX(k, 17, 10, z, 7, 10))
    # Portico.
    for z in (-15, -5, 5, 15):
        g.add(k.lathe(k.paint(TOY.white), [(0, 0), (3, 0), (3, 1.5), (2.2, 2.5), (2.2, 34), (3, 35), (3, 36), (0, 36)], 26, 4, z, 16))
    g.add(k.box(cream, 14, 3, 42, 0.8, 23, 40, 0))
    g.add(k.at(gable(k, cream, 14, 42, 10, 0, 0, 0), 23, 43, 0, 0))
    g.add(doorX(k, TOY.blue, 17, 0, 12, 22, 4))
    # Detail: two steps up to the plinth in front of the portico.
    g.add(k.box(k.paint(STONE), 4, 1.4, 44, 0.4, 37, 0, 0), k.box(k.paint(STONE), 4, 2.8, 44, 0.4, 35, 0, 0))
    # Clock turret and flag.
    g.add(k.box(cream, 22, 22, 22, 2, -8, 47, 0))
    g.add(clock(k, 7, 3.4, 58, 0))
    g.add(k.ball(k.paint(TOY.teal), 11, -8, 69, 0, 0.8))
    g.add(k.cyl(k.paint(TOY.black), 0.8, 26, -8, 76, 0, 0.6, 8))
    flag = named(Node(), "flag")
    flag.add(k.box(k.paint(TOY.red), 14, 8, 0.8, 0.2, 7, 0, 0), k.box(k.paint(TOY.yellow), 14.2, 2, 1, 0.2, 7, 3, 0))
    g.add(k.at(flag, -8, 93, 0))
    return g


def castle_gate(k):
    # The line runs through on a 108 straight (the game's kit piece, kit-castle-gate), the gate across its middle.
    g = Node()
    stone = k.paint(STONE)
    g.add(k.trackSlab(108))
    s = [(-40, 0), (-25, 0), (-25, 38)]
    s += _arc(0, 38, 25, math.pi, 0)[1:]  # over the top, clockwise, from (-25, 38) to (25, 38)
    s += [(25, 0), (40, 0), (40, 80), (-40, 80)]
    g.add(k.at(k.extrude(stone, s, 16, 0, 0, 0, 0.8), 0, 0, 0, math.pi / 2))
    for i in range(5):
        for x in (-6, 6):
            g.add(k.box(stone, 4, 6, 7, 0.8, x, 80, -32 + i * 16))
    for z in (-46, 46):
        g.add(k.cyl(stone, 20, 100, 0, 0, z, 19, 28))
        for i in range(8):
            a = i * math.pi / 4
            g.add(k.box(stone, 6, 7, 6, 0.8, 17 * math.cos(a), 100, z + 17 * math.sin(a)))
        g.add(winX(k, 19.4, 60, z, 3, 10), k.cyl(k.paint(TOY.black), 0.8, 18, 0, 100, z, 0.6, 8))
        g.add(k.at(k.extrude(k.paint(TOY.blue if z < 0 else TOY.red), [(0, 0), (12, 3), (0, 7)], 0.8, 0, 0, 0, 0.2), 0, 110, z))
    port = named(Node(), "portcullis")
    black = k.paint(TOY.black)
    for i in range(6):
        port.add(k.box(black, 1.6, 52, 1.6, 0.3, 0, 0, -21 + i * 8.4))
    for y in (12, 26, 40):
        port.add(k.box(black, 1.6, 1.6, 48, 0.3, 0, y, 0))
    g.add(k.at(port, 10, 0, 0))
    return g


def factory(k):
    g = Node()
    g.add(k.box(k.paint(BRICK), 96, 30, 60, 2))
    pts = [(-48, 0), (48, 0), (48, 16)]
    for i in range(3, -1, -1):
        x0 = -48 + i * 24
        pts += [(x0, 2), (x0, 16)]
    pts.pop()
    g.add(k.extrude(k.paint(SLATE), pts, 62, 0, 30, 0, 0.6))
    for i in range(4):
        g.add(k.box(k.paint(TOY.sky), 1.2, 12, 56, 0.3, -48 + (i + 1) * 24 - 0.8, 32, 0))
    for x in (-34, -12, 12, 34):
        g.add(winZ(k, x, 12, 30, 12, 12))
    g.add(k.box(k.paint(TOY.blue), 1.8, 22, 22, 0.6, 48, 0, 0))
    g.add(k.box(k.paint(TOY.yellow), 2.4, 3, 30, 0.5, 48.4, 25, 0))
    g.add(k.lathe(k.paint(BRICK), [(0, 0), (9, 0), (9, 4), (6, 120), (7.5, 122), (7.5, 126), (0, 126)], -36, 0, -14, 20))
    for y in (40, 80):
        g.add(k.cyl(k.paint(TOY.white), 8.1 - (y / 120) * 3 + 0.2, 4, -36, y, -14, 8.1 - ((y + 4) / 120) * 3 + 0.2, 20))
    g.add(smoke(k, -36, 130, -14))
    return g


def sawmill(k):
    g = Node()
    for x in (-30, 0, 30):
        for z in (-18, 18):
            g.add(k.box(k.paint(TOY.brown), 4, 34, 4, 0.8, x, 0, z))
    g.add(gable(k, k.paint(TOY.brown), 66, 40, 12, 0, 34, 0))
    drop = (2 * 5 * 12) / 40
    g.add(k.roof(k.paint(TOY.green), 76, 50, 12 + drop, 0, 34 - drop + 1.4, 0))
    # Detail: an eaves beam along each side, over the posts.
    for z in (-18, 18):
        g.add(k.box(k.paint(TOY.brown), 66, 3, 4.4, 0.6, 0, 31.5, z))
    # Saw bench.
    g.add(k.box(k.wood, 40, 10, 12, 1, 0, 0, 0))
    g.add(k.cylX(k.wood, 3.5, 30, -6, 13.5, 0, 14))
    blade = named(Node(), "blade")
    blade.add(k.cylZ(k.metal, 9, 1, 0, 0, 0, 20), k.cylZ(k.paint(TOY.red), 2.5, 2, 0, 0, 0, 12))
    g.add(k.at(blade, 10, 10, 0))
    # Logs and planks.
    for i in range(3):
        g.add(k.cylX(k.wood, 4, 34, -10, 4, 26 + i * 8.5, 14))
    for i in range(2):
        g.add(k.cylX(k.wood, 4, 34, -10, 11.5, 30 + i * 8.5, 14))
    for i in range(4):
        g.add(k.box(k.wood, 34, 2, 12, 0.3, 50, i * 2.4, -4 + (i % 2)))
    g.add(peg(k, TOY.red, TOY.yellow, -4, 0, -10))
    return g


def dairy(k):
    g = house(k, 52, 32, 30, k.paint(TOY.white), TOY.blue, 13)
    g.add(doorX(k, TOY.blue, 26, -8, 10, 18))
    g.add(_step(k, 26, -8, 10))
    g.add(winX(k, 26, 12, 8, 9, 9))
    for x in (-12, 12):
        g.add(winZ(k, x, 14, 16.2, 9, 9))
    g.add(
        k.lathe(k.paint(TOY.white), [(0, 0), (6, 0), (6, 10), (3, 15), (3, 18), (0, 18)], 0, 43, 0, 20),
        k.cyl(k.paint(TOY.blue), 3.4, 2.4, 0, 61, 0, 3.4, 16),
    )
    # Churn stand.
    g.add(k.box(k.wood, 24, 9, 12, 1, 38, 0, 6))
    for z in (-2, 6, 14):
        g.add(churn(k, 34, 9, z))
    g.add(churn(k, 42, 9, 2), churn(k, 42, 9, 10))
    return g


def petrol_station(k):
    g = Node()
    g.add(k.box(k.road, 70, 1, 60, 0.4, 0, 0, 0))
    for z in (-14, 14):
        g.add(k.cyl(k.paint(TOY.white), 2, 34, 10, 1, z, 2, 12))
    g.add(k.box(k.paint(TOY.white), 34, 5, 44, 1.5, 10, 35, 0), k.box(k.paint(TOY.green), 35, 2, 45, 0.6, 10, 36.5, 0))
    for z, c in ((-8, TOY.red), (8, TOY.yellow)):
        g.add(k.box(k.wood, 8, 2, 8, 0.6, 10, 1, z))
        g.add(k.box(k.paint(c), 6, 16, 6, 1.2, 10, 3, z), k.box(k.paint(WIN), 6.4, 4, 3, 0.4, 10, 12, z))
        g.add(k.ring(k.paint(TOY.black), 3, 0.6, 13.5, 8, z, False))
    g.add(k.at(house(k, 20, 18, 20, k.paint(TOY.cream), TOY.green, 6), -22, 1, -14))
    g.add(k.box(k.paint(WIN), 1.6, 9, 10, 0.4, -12, 7, -14))
    g.add(k.cyl(k.paint(TOY.grey), 1.6, 50, -28, 1, 20, 1.6, 10))
    sign = named(Node(), "sign")
    sign.add(k.cylX(k.paint(TOY.green), 9, 2, 0, 0, 0, 24), k.cylX(k.paint(TOY.yellow), 6, 2.4, 0, 0, 0, 20))
    g.add(k.at(sign, -28, 58, 20))
    return g


def market_stall(k):
    g = Node()
    g.add(k.box(k.wood, 30, 12, 14, 1))
    for x in (-14, 14):
        for z in (-6, 6):
            g.add(k.cyl(k.wood, 0.9, 30, x, 0, z, 0.9, 8))
    for i in range(6):
        s = k.box(k.paint(TOY.white if i % 2 else TOY.blue), 5.4, 1.4, 20, 0.3, -13.5 + i * 5.4, 30, -1)
        s.rotation.x = 0.2
        g.add(s)
    fruit = [TOY.red, TOY.orange, TOY.leaf, TOY.yellow, TOY.purple]
    for i in range(5):
        g.add(k.box(k.paint("#c99a5b"), 5.4, 2.4, 9, 0.5, -12 + i * 6, 12, 1))
        for j in range(3):
            g.add(k.ball(k.paint(fruit[i]), 1.7, -12 + i * 6 + (j - 1) * 1.7, 15.6, 1 + (j - 1) * 2.4))
    g.add(peg(k, TOY.green, TOY.red, 0, 0, -12))
    g.add(crate(k, 20, 0, 8, 7), crate(k, 20, 7, 8, 6, TOY.leaf))
    return g


def market_hall(k):
    """
    An open-sided market hall for a two-square town lot (about 56 x 112): a beech floor on a stone step, cream posts
    holding up a solid roof (ridge along z) with a little clock lantern on it, and three stalls under it with striped
    awnings, produce and crates, and a shopper.
    """
    g = Node()
    w, d = 52, 108
    g.add(k.box(k.paint(STONE), w + 4, 2, d + 4, 0.8, 0, 0, 0))
    g.add(k.box(k.wood, w, 2, d, 1, 0, 2, 0))
    post = k.paint(TOY.cream)
    for x in (-w / 2 + 3, w / 2 - 3):
        for z in (-d / 2 + 3, -d / 6, d / 6, d / 2 - 3):
            g.add(k.box(post, 4, 36, 4, 1.2, x, 4, z, seg=2))
            g.add(k.box(post, 6, 2.4, 6, 1, x, 4, z, seg=1))
    roof = k.roof(k.paint(TOY.red), d + 8, w + 8, 18, 0, 0, 0, 3.5)
    holder = Node()
    holder.add(roof)
    holder.rotation.y = math.pi / 2
    holder.position.set(0, 39.5, 0)
    g.add(holder)
    # The clock lantern on the ridge.
    g.add(k.box(k.paint(TOY.white), 12, 10, 12, 1.4, 0, 54, 0))
    g.add(clock(k, 3.6, 6.2, 59, 0))
    g.add(hip(k, k.paint(TOY.teal), 15, 8, 0, 64, 0))
    g.add(k.ball(k.paint(TOY.yellow), 1.4, 0, 72.5, 0))
    # Three stalls, each a counter under a striped awning, with produce.
    fruit = [TOY.red, TOY.orange, TOY.leaf, TOY.yellow, TOY.purple]
    stripes = ((TOY.blue, TOY.white), (TOY.red, TOY.white), (TOY.leaf, TOY.white))
    for i, z in enumerate((-34, 0, 34)):
        a, b = stripes[i]
        g.add(k.box(k.wood, 14, 10, 24, 1.2, -8, 4, z, seg=2))
        for j in range(5):
            n = Node()
            n.add(k.box(k.paint(a if j % 2 == 0 else b), 16, 1.2, 4.8, 0.3, 0, 0, 0, seg=1))
            n.rotation.z = -0.35
            n.position.set(-2, 26, z - 9.6 + j * 4.8)
            g.add(n)
        for dz in (-11, 11):
            g.add(k.cyl(k.wood, 0.8, 19, 4.5, 4, z + dz, 0.8, 8))
        for j in range(3):
            g.add(k.box(k.paint("#c99a5b"), 5, 2, 6, 0.5, -8, 14, z - 7 + j * 7, seg=1))
            g.add(k.ball(k.paint(fruit[(i + j) % 5]), 2, -8, 17.6, z - 7 + j * 7, 0.8))
        g.add(crate(k, -20, 4, z + 8, 6))
    g.add(peg(k, TOY.blue, TOY.red, 12, 4, -17))
    return g


def library(k):
    """
    A grand library (the town's place of learning) for a two-square lot (about 60 x 104): a stone plinth with broad
    steps, a cream hall with tall windows, a portico of six columns under a pediment, and a dome on a drum over the
    middle with clocks ("hour", "minute") and a gold finial.
    """
    g = Node()
    cream = k.paint(TOY.cream)
    stone = k.paint(STONE)
    g.add(k.box(stone, 50, 5, 104, 1.2, -4, 0, 0))
    for i, x in enumerate((22, 25, 28)):
        g.add(k.box(stone, 4, 5 - i * 1.6, 44, 0.5, x - 0.5, 0, 0))
    g.add(k.box(cream, 36, 34, 96, 2.4, -6, 5, 0))
    g.add(k.box(cream, 40, 3, 100, 1.2, -6, 39, 0))
    g.add(k.box(k.paint(TOY.blue), 38, 4, 98, 1.6, -6, 42, 0))
    for z in (-40, -29, 29, 40):
        g.add(winX(k, 12, 12, z, 6, 18, False))
    # Portico: six columns on the top step, an entablature and a pediment.
    for z in (-19, -11.4, -3.8, 3.8, 11.4, 19):
        g.add(k.lathe(k.paint(TOY.white), [(0, 0), (3, 0), (3, 1.4), (2.3, 2.4), (2.1, 30), (2.8, 31), (3.2, 32.6), (0, 32.6)], 19, 5, z, 18))
    g.add(k.box(cream, 12, 4, 46, 1, 18, 37.6, 0))
    g.add(k.at(gable(k, k.paint(TOY.blue), 13, 48, 11, 0, 0, 0), 18, 41.4, 0, 0))
    g.add(doorX(k, TOY.blue, 12, 0, 12, 22, 5))
    # Drum, dome and lantern over the middle, with a clock facing the front.
    g.add(k.cyl(cream, 15, 14, -6, 46, 0, 15, 40))
    g.add(k.cyl(k.paint(TOY.white), 16, 2, -6, 59, 0, 16, 40))
    g.add(k.lathe(k.paint(TOY.teal), [(0.0, 0), (15.4, 0)] + [(15.4 * math.cos(a), 16 * math.sin(a)) for a in (0.25, 0.5, 0.75, 1.0, 1.25, 1.45)] + [(0.0, 16)], -6, 61, 0, 40))
    g.add(k.cyl(k.paint(TOY.white), 3, 6, -6, 76, 0, 2.6, 16))
    g.add(k.ball(k.paint(TOY.yellow), 2.6, -6, 83.5, 0))
    g.add(clock(k, 6, 9.2, 53, 0))
    # Lamp posts at the foot of the steps.
    g.add(lamp(k, 26, -26, 26, 0), lamp(k, 26, 26, 26, 0))
    return g


def college(k):
    """
    A college for a two-square town lot (about 40 x 108): a long brick range under a slate roof, two rows of windows,
    and in the middle a gate tower with the arch into the quad, a clock ("hour", "minute") and a white bell cupola
    (its bell, "bell", swings).
    """
    g = Node()
    brick = k.paint(BRICK)
    stone = k.paint(STONE)
    # The range: long along z, its front on +x.
    g.add(k.box(stone, 32, 2, 106, 0.8, -6, 0, 0))
    g.add(k.box(brick, 28, 30, 104, 2.6, -6, 2, 0))
    roof = k.roof(k.paint(SLATE), 108, 33, 13, 0, 0, 0, 3.5)
    g.add(k.at(roof, -6, 31.5, 0, math.pi / 2))
    for y in (7, 19):
        for z in (-44, -34, -24, 24, 34, 44):
            g.add(winX(k, 8, y, z, 6, 9))
    g.add(k.box(stone, 1.2, 1.6, 104, 0.4, 8.2, 16, 0))
    # The gate tower, forward of the range, with the arch through it.
    tw, td, th = 30, 22, 46
    g.add(k.box(brick, td, th, tw, 2.6, 3, 2, 0))
    arch = Node()
    pts = [(-7, 0), (7, 0), (7, 11)] + [(7 * math.cos(a), 11 + 7 * math.sin(a)) for a in (0.4, 0.8, 1.2, 1.57, 1.97, 2.37, 2.74)] + [(-7, 11)]
    arch.add(k.extrude(stone, [(x * 1.25, y * 1.12) for x, y in pts], 2, 0, 0, 0, 0.5))
    arch.add(k.extrude(k.paint("#2b2420"), pts, 2.6, 0, 0, 0.4, 0.4))
    arch.rotation.y = math.pi / 2
    arch.position.set(14, 2, 0)
    g.add(arch)
    for z in (-8, 8):
        g.add(winX(k, 14, 26, z, 5, 8))
    g.add(k.box(stone, td + 2, 3, tw + 2, 1, 3, th + 2, 0))
    g.add(clock(k, 5.6, 15, 37, 0))
    # The bell cupola on the tower.
    white = k.paint(TOY.white)
    g.add(k.box(white, 12, 3, 12, 1, 3, th + 5, 0))
    for dx, dz in ((-4.5, -4.5), (4.5, -4.5), (-4.5, 4.5), (4.5, 4.5)):
        g.add(k.box(white, 1.8, 10, 1.8, 0.4, 3 + dx, th + 8, dz))
    g.add(hip(k, k.paint(SLATE), 15, 8, 3, th + 18, 0))
    g.add(k.ball(k.paint(TOY.yellow), 1.4, 3, th + 26.5, 0))
    bell = named(Node(), "bell")
    bell.add(k.lathe(k.paint(TOY.yellow), [(0, -6), (3.2, -6), (2.8, -4.4), (2, -1.6), (0, -0.8)], 0, 0, 0, 16))
    g.add(k.at(bell, 3, th + 17, 0))
    g.add(_step(k, 14, 0, 14))
    return g


ASSETS = [
    ("bldg-fire-station", fire_station),
    ("bldg-police-station", police_station),
    ("bldg-post-office", post_office),
    ("bldg-bakery", bakery),
    ("bldg-cafe", cafe),
    ("bldg-school", school),
    ("bldg-church", church),
    ("bldg-town-hall", town_hall),
    ("bldg-castle-gate", castle_gate),
    ("bldg-factory", factory),
    ("bldg-sawmill", sawmill),
    ("bldg-dairy", dairy),
    ("bldg-petrol-station", petrol_station),
    ("bldg-market-stall", market_stall),
    ("bldg-market-hall", market_hall),
    ("bldg-library", library),
    ("bldg-college", college),
]
