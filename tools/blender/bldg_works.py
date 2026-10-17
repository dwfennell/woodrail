"""Railway works, farm and landmark buildings for bldg.py, ported from src/catalogue/assets/buildings.ts."""

import math

from kit import TOY, Node
from bldg_parts import (  # noqa: F401
    BRICK, FRAME, SLATE, STONE, WIN, awningX, bench, chimney, churn, clock, crate, doorX, doorZ, gable, glassBand, hip,
    house, lamp, nameBoard, named, panel, peg, pine, platform, sack, smoke, winX, winZ,
)


def _arc(cx, cy, r, a0, a1, step=2.0, least=12):
    """Points along a circular arc from angle a0 to a1 (both ends included), about one every `step` mm."""
    sweep = abs(a1 - a0)
    n = max(math.ceil(r * sweep / step), math.ceil(least * sweep / math.pi), 2)
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


# ——— Railway yard ———


def water_tower(k):
    g = Node()
    for x, z in ((-12, -12), (12, -12), (-12, 12), (12, 12)):
        g.add(k.box(k.paint(TOY.black), 3.5, 44, 3.5, 0.8, x, 0, z))
    g.add(k.box(k.wood, 32, 4, 32, 1, 0, 42, 0))
    g.add(k.cyl(k.paint(TOY.green), 18, 22, 0, 46, 0, 18, 28))
    g.add(k.ring(k.paint(TOY.black), 18.2, 0.9, 0, 52, 0), k.ring(k.paint(TOY.black), 18.2, 0.9, 0, 62, 0))
    g.add(k.cone(k.paint(TOY.red), 20, 8, 0, 68, 0, 28))
    for i in range(8):
        g.add(k.box(k.wood, 7, 1, 1, 0.2, -20, 4 + i * 5, 14))
    for x in (-23, -17):
        g.add(k.box(k.wood, 1.2, 44, 1.2, 0.2, x, 0, 14))
    # Detail: a ball finial on the cap and cross braces between the legs.
    g.add(k.ball(k.paint(TOY.black), 1.6, 0, 76, 0))
    for z in (-12, 12):
        g.add(k.box(k.paint(TOY.black), 24, 1.6, 1.6, 0.4, 0, 20, z))
    for x in (-12, 12):
        g.add(k.box(k.paint(TOY.black), 1.6, 1.6, 24, 0.4, x, 20, 0))
    # Swinging spout: it rests along the track, and swings a quarter turn out over it (the game's kit piece,
    # kit-water-tower, stands the tower beside its track, +x along it).
    spout = named(Node(), "spout")
    spout.add(k.cylX(k.paint(TOY.black), 2.4, 40, 20, 0, 0, 12), k.cyl(k.paint(TOY.black), 2.6, 8, 40, -8, 0, 2.6, 12))
    g.add(k.at(spout, 14, 64, 0))
    return g


def coal_stage(k):
    g = Node()
    g.add(k.box(k.paint(BRICK), 60, 26, 36, 1.5))
    g.add(k.box(k.wood, 64, 3, 40, 1, 0, 26, 0))
    # Ramp up the back.
    ramp = k.box(k.wood, 40, 2.5, 16, 0.6, -44, 12, 0)
    ramp.rotation.z = 0.6
    g.add(ramp)
    g.add(k.cone(k.coal, 14, 10, -10, 29, -4, 18))
    for i in range(7):
        g.add(k.ball(k.coal, 3 + (i % 3), -18 + i * 5, 30, 8 - (i % 2) * 4))
    for x in (10, 22):
        g.add(k.box(k.paint(TOY.grey), 9, 7, 8, 1, x, 29, -6))
        g.add(k.box(k.coal, 8, 2, 7, 0.6, x, 35.5, -6))
    # Chute over the track side (+z).
    black = k.paint(TOY.black)
    chute = named(Node(), "chute")
    chute.add(k.box(black, 12, 1.4, 20, 0.4, 0, 0, 10))
    chute.add(k.box(black, 1.2, 4, 20, 0.3, -6, 0, 10), k.box(black, 1.2, 4, 20, 0.3, 6, 0, 10))
    g.add(k.at(chute, 16, 29, 18))
    g.add(peg(k, TOY.black, TOY.black, -2, 29, 12))
    return g


def engine_shed(k):
    # Two roads a double track apart (72), each 162 from the doorway's approach to its end, a buffer just past that:
    # the game's kit piece (kit-engine-shed) puts its track under them, the doors 54 in from where its roads start.
    g = Node()
    brick = k.paint(BRICK)
    for z in (-36, 36):
        g.add(k.trackSlab(184, 32, 0, z))
        # The buffer stop at the road's end (its face 22 past the end, where an engine's front comes to rest).
        g.add(k.box(k.paint(TOY.red), 6, 12, 30, 1.5, -63, 12, z))
        for s in (-10, 10):
            g.add(k.cylX(k.paint(TOY.black), 2.5, 4, -59, 18, z + s, 12))
    for z in (-70, 70):
        g.add(k.box(brick, 140, 60, 4, 1, 0, 0, z))
    g.add(k.box(brick, 4, 60, 144, 1, -68, 0, 0))
    # Front wall with two arched openings.
    s = [(-72, 0), (-58, 0), (-58, 32)]
    s += _arc(-36, 32, 22, math.pi, 0)[1:]
    s += [(-14, 0), (14, 0), (14, 32)]
    s += _arc(36, 32, 22, math.pi, 0)[1:]
    s += [(58, 0), (72, 0), (72, 60), (-72, 60)]
    g.add(k.at(k.extrude(brick, s, 4, 0, 0, 0, 0.6), 68, 0, 0, math.pi / 2))
    g.add(gable(k, brick, 138, 144, 26, 0, 60, 0))
    drop = (2 * 5 * 26) / 144
    g.add(k.roof(k.paint(SLATE), 148, 154, 26 + drop, 0, 60 - drop + 1.4, 0))
    g.add(k.box(k.paint(SLATE), 96, 6, 12, 1, 0, 86, 0))
    g.add(k.box(k.paint(SLATE), 102, 2, 18, 0.6, 0, 92, 0))
    for x in (-40, 0, 40):
        g.add(winZ(k, x, 30, 72, 10, 12), winZ(k, x, 30, -72, 10, 12))
    # Doors: two leaves per road, hinged at the opening's sides, swinging out.
    for zc in (-36, 36):
        left = named(Node(), "leafL")
        left.add(k.box(k.paint(TOY.green), 2, 44, 22, 0.6, 0, 0, 11))
        g.add(k.at(left, 71, 0, zc - 22))
        right = named(Node(), "leafR")
        right.add(k.box(k.paint(TOY.green), 2, 44, 22, 0.6, 0, 0, -11))
        g.add(k.at(right, 71, 0, zc + 22))
    return g


def roundhouse_segment(k):
    # Three stalls fanned an eighth of a turn apart round a turntable's centre (the origin), each road 108 long from the
    # pit's rim (radius 92) out to its end, a buffer just past that: the game's kit piece (kit-roundhouse-segment).
    g = Node()
    brick = k.paint(BRICK)
    rim = 92
    for a in (-math.pi / 4, 0, math.pi / 4):
        stall = Node()
        stall.add(k.trackSlab(130, rim + 65, 0, 0))
        stall.add(k.box(k.paint(TOY.red), 6, 12, 30, 1.5, rim + 133, 12, 0))
        for s in (-10, 10):
            stall.add(k.cylX(k.paint(TOY.black), 2.5, 4, rim + 129, 18, s, 12))
        # Side walls and back, open front.
        for z in (-26, 26):
            stall.add(k.box(brick, 120, 46, 3, 1, rim + 82, 0, z))
        stall.add(k.box(brick, 3, 46, 55, 1, rim + 143.5, 0, 0))
        stall.add(k.box(brick, 3, 12, 55, 1, rim + 22.5, 34, 0))
        roof = k.box(k.paint(SLATE), 128, 3, 60, 1, rim + 82, 46, 0)
        roof.rotation.z = 0.06
        stall.add(roof)
        stall.add(k.cyl(k.paint(TOY.black), 3, 14, rim + 90, 50, 0, 2.4, 12), k.box(k.paint(TOY.black), 9, 1.5, 9, 0.4, rim + 90, 64, 0))
        stall.rotation.y = a
        g.add(stall)
    return g


def goods_shed(k):
    g = Node()
    b = house(k, 90, 40, 38, k.paint(TOY.brown), TOY.red, 14)
    g.add(b)
    g.add(winX(k, 45, 22, 0, 10, 10), winX(k, -45, 22, 0, 10, 10))
    g.add(k.box(k.paint(WIN), 34, 28, 1, 0.3, 0, 0, 20.2))
    door = named(Node(), "door")
    door.add(k.box(k.paint(TOY.cream), 34, 28, 2, 0.6, 0, 0, 0), k.box(k.paint(TOY.red), 2, 26, 2.6, 0.3, 0, 1, 0))
    g.add(k.at(door, 0, 0, 21.8))
    g.add(k.box(k.paint(TOY.cream), 80, 2, 3, 0.4, 0, 29, 21.5))
    g.add(k.box(k.wood, 100, 12, 18, 1.2, 0, 0, 30))
    g.add(crate(k, -38, 12, 30), crate(k, -28, 12, 33, 8, TOY.blue), crate(k, -36, 21, 31, 7, TOY.red))
    g.add(sack(k, 24, 12, 32), sack(k, 31, 12, 30), sack(k, 27, 18, 31))
    # Hand crane at the dock's end.
    crane = named(Node(), "jib")
    crane.add(k.cyl(k.paint(TOY.yellow), 2.4, 30, 0, 0, 0, 2, 12))
    jib = k.box(k.paint(TOY.yellow), 28, 2.4, 2.4, 0.5, 12, 26, 0)
    jib.rotation.z = 0.25
    crane.add(jib, k.cyl(k.paint(TOY.black), 0.4, 14, 25, 15, 0, 0.4, 6), k.box(k.paint(TOY.black), 3, 3, 3, 0.5, 25, 12, 0))
    g.add(k.at(crane, 45, 12, 32))
    return g


def warehouse(k):
    g = Node()
    g.add(k.box(k.paint(BRICK), 60, 96, 46, 2))
    g.add(gable(k, k.paint(BRICK), 59.5, 46, 14, 0, 96, 0))
    drop = (2 * 4 * 14) / 46
    g.add(k.roof(k.paint(SLATE), 68, 54, 14 + drop, 0, 96 - drop + 1.4, 0))
    for f in range(4):
        g.add(k.box(k.paint(TOY.green), 1.8, 16, 14, 0.5, 30, 4 + f * 23, 0))
        for z in (-15, 15):
            g.add(winX(k, 30, 7 + f * 23, z, 8, 10))
        for x in (-18, 0, 18):
            g.add(winZ(k, x, 7 + f * 23, 23, 8, 10))
    # Detail: a stone plinth course round the foot.
    g.add(k.box(k.paint(STONE), 61.5, 4, 47.5, 0.6))
    # Hoist beam, rope and load.
    g.add(k.box(k.paint(TOY.black), 18, 3, 3, 0.6, 38, 100, 0))
    rope = named(Node(), "rope")
    rope.add(k.cyl(k.paint(TOY.cream), 0.5, 1, 0, 0, 0, 0.5, 6))
    g.add(k.at(rope, 44, 30, 0))
    hook = named(Node(), "hook")
    hook.add(sack(k, 0, -9, 0), k.box(k.paint(TOY.black), 2, 2, 2, 0.4, 0, -1.5, 0))
    g.add(k.at(hook, 44, 30, 0))
    return g


# ——— Countryside ———


def farmhouse(k):
    g = house(k, 60, 34, 36, k.paint(TOY.cream), TOY.red, 18)
    g.add(doorX(k, TOY.green, 30, 0, 10, 18))
    for z in (-10, 10):
        g.add(winX(k, 30, 26, z))
    for z in (-11,):
        g.add(winX(k, 30, 8, z))
    for x in (-18, 0, 18):
        g.add(winZ(k, x, 18, 17, 8, 10))
    g.add(chimney(k, -24, 46, 0, 14), chimney(k, 24, 46, 0, 14))
    # Porch.
    g.add(k.box(k.wood, 12, 2, 24, 0.6, 36, 0, 4))
    for z in (-7, 15):
        g.add(k.cyl(k.paint(TOY.white), 1, 20, 41, 2, z, 1, 8))
    pr = k.box(k.paint(TOY.red), 14, 2, 28, 0.6, 37, 22, 4)
    pr.rotation.z = -0.2
    g.add(pr)
    # Detail: a step down off the porch.
    g.add(k.box(k.wood, 4, 1, 10, 0.4, 43.5, 0, 4))
    return g


def red_barn(k):
    g = Node()
    red = k.paint(TOY.red)
    w = 70
    a = 22
    h = 30
    pts = [(-a, 0), (a, 0), (a, h), (a * 0.55, h + 16), (0, h + 24), (-a * 0.55, h + 16), (-a, h)]
    g.add(k.at(k.extrude(red, pts, w, 0, 0, 0, 0.8), 0, 0, 0, math.pi / 2))
    roof = k.paint(SLATE)
    lift = 1.4
    for s in (-1, 1):
        g.add(panel(k, roof, w + 4, s * (a + 3), h - 2 + lift, s * a * 0.55, h + 16 + lift))
        g.add(panel(k, roof, w + 4, s * a * 0.55, h + 16 + lift, 0, h + 24 + lift))
    # Detail: a ridge cap along the top.
    g.add(k.cylX(roof, 1.8, w + 5, 0, h + 24 + lift + 0.6, 0, 12))
    # Big doors with white crosses on the front gable end (+x).
    white = k.paint(TOY.white)
    for z in (-7.5, 7.5):
        g.add(k.box(red, 1.6, 26, 15, 0.4, w / 2 + 0.8, 0, z))
        c1 = k.box(white, 1, 32, 2, 0.2, w / 2 + 1.8, 13, z)
        c1.rotation.x = 0.55
        c2 = k.box(white, 1, 32, 2, 0.2, w / 2 + 1.8, 13, z)
        c2.rotation.x = -0.55
        c1.position.y = c2.position.y = 13
        g.add(c1, c2)
        g.add(k.box(white, 1.4, 26, 1.6, 0.2, w / 2 + 1.6, 0, z + 7.2), k.box(white, 1.4, 1.6, 16, 0.2, w / 2 + 1.6, 25, z))
    loft = named(Node(), "loft")
    loft.add(k.box(k.paint(TOY.white), 1.6, 12, 12, 0.4, 0, 0, 6))
    g.add(k.box(k.paint(WIN), 1.2, 12, 12, 0.3, w / 2 + 0.4, 34, 0))
    g.add(k.at(loft, w / 2 + 1.2, 34, -6))
    g.add(k.cyl(k.paint("#e8cf6a"), 6, 10, w / 2 + 12, 0, 18, 6, 18))
    return g


def silo(k):
    g = Node()
    g.add(k.cyl(k.paint(STONE), 18, 6, 0, 0, 0, 18, 28))
    g.add(k.cyl(k.paint(TOY.sky), 16, 84, 0, 6, 0, 16, 28))
    for i in range(1, 5):
        g.add(k.ring(k.paint(TOY.white), 16.2, 0.9, 0, 6 + i * 17, 0))
    g.add(k.ball(k.paint(TOY.red), 16.5, 0, 90, 0, 0.5))
    g.add(k.cyl(k.paint(TOY.red), 2, 5, 0, 97, 0, 1, 10))
    for z in (-3, 3):
        g.add(k.box(k.paint(TOY.black), 1, 82, 1, 0.2, 16.5, 6, z))
    for i in range(14):
        g.add(k.box(k.paint(TOY.black), 1, 0.8, 6, 0.2, 16.5, 10 + i * 5.5, 0))
    spout = k.cylX(k.paint(TOY.grey), 2.5, 22, -24, 40, 0, 12)
    spout.rotation.z = math.pi / 2 + 0.7
    g.add(spout)
    return g


def windmill(k):
    g = Node()
    g.add(k.lathe(k.paint(TOY.cream), [(0, 0), (22, 0), (22, 3), (15, 64), (0, 64)], 0, 0, 0, 32))
    g.add(k.ring(k.paint(TOY.brown), 17, 1.6, 0, 40, 0))
    g.add(k.cyl(k.wood, 21, 2, 0, 38, 0, 21, 28))
    g.add(k.ball(k.paint(TOY.red), 16, 0, 64, 0, 0.75))
    g.add(doorX(k, TOY.green, 21.4, 0, 9, 16))
    for y in (24, 50):
        g.add(winX(k, 22.3 - (7 * (y + 5)) / 61, y, 0, 6, 8))
    sails = named(Node(), "sails")
    sails.add(k.cylX(k.paint(TOY.red), 4, 6, 0, 0, 0, 16))
    for i in range(4):
        arm = Node()
        arm.add(k.box(k.wood, 1.8, 42, 2, 0.4, 0, 0, 0))
        arm.add(k.box(k.paint(TOY.white), 1.2, 30, 10, 0.4, 0.4, 10, 5.5))
        for j in range(4):
            arm.add(k.box(k.wood, 1.6, 1, 11, 0.2, 0.8, 12 + j * 9, 5.5))
        arm.rotation.x = (i * math.pi) / 2
        sails.add(arm)
    g.add(k.at(sails, 17, 66, 0))
    return g


def watermill(k):
    g = Node()
    b = house(k, 56, 34, 34, k.paint(STONE), TOY.brown, 16)
    b.add(doorX(k, TOY.red, 28, 0, 10, 18))
    for z in (-11, 11):
        b.add(winX(k, 28, 24, z, 8, 9))
    b.add(winZ(k, -16, 20, -17), winZ(k, 16, 20, -17))
    g.add(b, chimney(k, -18, 46, -6))
    g.add(k.box(k.water, 80, 1.6, 18, 0.4, 0, 0, 30))
    wheel = named(Node(), "wheel")
    for z in (-4.5, 4.5):
        wheel.add(k.ring(k.paint(TOY.red), 19, 1.4, 0, 0, z, True))
    wheel.add(k.cylZ(k.paint(TOY.black), 3, 14, 0, 0, 0, 14))
    for i in range(10):
        p = Node()
        p.add(k.box(k.wood, 8, 1.6, 10, 0.4, 0, 16.5, 0), k.box(k.paint(TOY.red), 1.2, 16, 1.2, 0.2, 0, 2, 0))
        p.rotation.z = (i * math.pi * 2) / 10
        wheel.add(p)
    g.add(k.at(wheel, 0, 22, 27))
    g.add(k.cylZ(k.paint(TOY.black), 1.8, 10, 0, 22, 20, 10))
    return g


def lighthouse(k):
    g = Node()
    g.add(k.cyl(k.paint(STONE), 26, 6, 0, 0, 0, 24, 24))
    g.add(k.lathe(k.paint(TOY.white), [(0, 6), (15, 6), (10.5, 88), (0, 88)], 0, 0, 0, 28))

    def r_at(y):
        return 15 - (4.5 * (y - 6)) / 82

    for y0 in (18, 44, 70):
        g.add(k.cyl(k.paint(TOY.red), r_at(y0) + 0.4, 12, 0, y0, 0, r_at(y0 + 12) + 0.4, 28))
    g.add(doorX(k, TOY.blue, 14.2, 0, 7, 12, 6))
    g.add(k.cyl(k.paint(TOY.black), 15, 2, 0, 88, 0, 15, 24))
    g.add(k.ring(k.paint(TOY.black), 14.5, 0.6, 0, 95, 0))
    for i in range(8):
        a = (i * math.pi) / 4
        g.add(k.cyl(k.paint(TOY.black), 0.5, 7, 14.5 * math.cos(a), 89, 14.5 * math.sin(a), 0.5, 6))
    g.add(k.cyl(k.glass, 8, 14, 0, 90, 0, 8, 20))
    light = named(k.ball(k.paint("#ffe36b"), 4.5, 0, 97, 0), "light")
    g.add(light)
    g.add(k.cone(k.paint(TOY.red), 10, 9, 0, 104, 0, 20), k.ball(k.paint(TOY.black), 1.6, 0, 113.5, 0))
    beam = named(Node(), "beam")
    cone = k.cone(k.paint("#fff3b0"), 5, 26, 0, 0, 0, 14)
    cone.rotation.z = math.pi / 2
    cone.position.set(18, 0, 0)
    beam.add(cone)
    g.add(k.at(beam, 0, 97, 0))
    return g


ASSETS = [
    ("bldg-water-tower", water_tower),
    ("bldg-coal-stage", coal_stage),
    ("bldg-engine-shed", engine_shed),
    ("bldg-roundhouse-segment", roundhouse_segment),
    ("bldg-goods-shed", goods_shed),
    ("bldg-warehouse", warehouse),
    ("bldg-farmhouse", farmhouse),
    ("bldg-red-barn", red_barn),
    ("bldg-silo", silo),
    ("bldg-windmill", windmill),
    ("bldg-watermill", watermill),
    ("bldg-lighthouse", lighthouse),
]
