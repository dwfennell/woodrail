"""Railway works, farm and landmark buildings for bldg.py, ported from src/catalogue/assets/buildings.ts."""

import math

from kit import TOY, Node
from bldg_parts import (  # noqa: F401
    BRICK, FRAME, SLATE, STONE, WIN, YARD_RIDGE, YARD_SLATE, YARD_STONE, YARD_TRIM, YARD_WALL, awningX, barredX, barredZ,
    barsX, barsZ, bench, braced, chimney, churn, clock, crate, doorX, doorZ, gable, glassBand, hip, house, lamp, nameBoard,
    named, panel, peg, pine, platform, sack, smoke, winX, winZ,
)


def _arc(cx, cy, r, a0, a1, step=2.0, least=12):
    """Points along a circular arc from angle a0 to a1 (both ends included), about one every `step` mm."""
    sweep = abs(a1 - a0)
    n = max(math.ceil(r * sweep / step), math.ceil(least * sweep / math.pi), 2)
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


# ——— Railway yard ———


def water_tower(k):
    """The water tower, in the yard's colours: a green tank on black legs, each on a stone foot, a cream band under its red cap."""
    g = Node()
    for x, z in ((-12, -12), (12, -12), (-12, 12), (12, 12)):
        g.add(k.box(k.paint(YARD_STONE), 7.5, 2.4, 7.5, 0.8, x, 0, z, seg=1))
        g.add(k.box(k.paint(TOY.black), 3.5, 44, 3.5, 0.8, x, 0, z))
    g.add(k.box(k.wood, 32, 4, 32, 1, 0, 42, 0))
    g.add(k.cyl(k.paint(YARD_TRIM), 18, 22, 0, 46, 0, 18, 28))
    g.add(k.ring(k.paint(TOY.black), 18.2, 0.9, 0, 52, 0), k.ring(k.paint(TOY.black), 18.2, 0.9, 0, 62, 0))
    g.add(k.cyl(k.paint(YARD_WALL), 18.6, 2.2, 0, 66.2, 0, 18.6, 28))
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
    """The coal stage: a brick bunker with piers on a stone course, a timber deck with a rail round three sides."""
    g = Node()
    brick = k.paint(BRICK)
    g.add(k.box(k.paint(YARD_STONE), 61.6, 4, 37.6, 0.8, seg=1))
    g.add(k.box(brick, 60, 26, 36, 1.5))
    for x in (-29, -10, 10, 29):
        g.add(k.box(brick, 4.4, 24, 37.4, 0.8, x, 0, 0))
    # (Dark arches between the piers on the back, where the coal is kept.)
    for x in (-19.5, 0, 19.5):
        g.add(k.box(k.paint(WIN), 11, 13, 1, 0.3, x, 4, -17.8))
    g.add(k.box(k.wood, 64, 3, 40, 1, 0, 26, 0))
    # The deck's rail: along the back and both ends (the track side, +z, is open for the chute).
    trim = k.paint(YARD_TRIM)
    for x in (-30.5, -10, 10, 30.5):
        g.add(k.box(trim, 1.6, 8, 1.6, 0.4, x, 29, -18.5, seg=1))
    for x in (-30.5, 30.5):
        g.add(k.box(trim, 1.6, 8, 1.6, 0.4, x, 29, 6, seg=1))
        g.add(k.box(trim, 1.4, 1.4, 26, 0.4, x, 36, -6.2, seg=1))
    g.add(k.box(trim, 62.6, 1.4, 1.4, 0.4, 0, 36, -18.5, seg=1))
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
    # Its doorways clear the tallest car on the rails (73 above the ground: the arches' crowns are at 84, and 75 at a coach's corners) and the
    # widest (45: they are 48 across); the leaves hang clear of the rails' tops and stand proud of the wall.
    g = Node()
    brick = k.paint(BRICK)
    wall, spring, r = 90, 60, 24
    for z in (-36, 36):
        g.add(k.trackSlab(184, 32, 0, z))
        # The buffer stop at the road's end (its face 22 past the end, where an engine's front comes to rest).
        g.add(k.box(k.paint(TOY.red), 6, 12, 30, 1.5, -63, 12, z))
        for s in (-10, 10):
            g.add(k.cylX(k.paint(TOY.black), 2.5, 4, -59, 18, z + s, 12))
    for z in (-70, 70):
        g.add(k.box(brick, 140, wall, 4, 1, 0, 0, z))
    g.add(k.box(brick, 4, wall, 144, 1, -68, 0, 0))
    # Front wall with two arched openings.
    s = [(-72, 0), (-36 - r, 0), (-36 - r, spring)]
    s += _arc(-36, spring, r, math.pi, 0)[1:]
    s += [(-36 + r, 0), (36 - r, 0), (36 - r, spring)]
    s += _arc(36, spring, r, math.pi, 0)[1:]
    s += [(36 + r, 0), (72, 0), (72, wall), (-72, wall)]
    g.add(k.at(k.extrude(brick, s, 4, 0, 0, 0, 0.6), 68, 0, 0, math.pi / 2))
    g.add(gable(k, brick, 138, 144, 26, 0, wall, 0))
    drop = (2 * 5 * 26) / 144
    g.add(k.roof(k.paint(YARD_SLATE), 148, 154, 26 + drop, 0, wall - drop + 1.4, 0))
    # The smoke vent along the ridge: cream boards under a slate lid.
    g.add(k.box(k.paint(YARD_WALL), 96, 6, 12, 1, 0, wall + 26, 0, seg=1))
    g.add(k.box(k.paint(YARD_RIDGE), 102, 2, 18, 0.6, 0, wall + 32, 0, seg=1))
    # A stone course round the foot (not across the doorways), and a cream band under the eaves.
    stone, band = k.paint(YARD_STONE), k.paint(YARD_WALL)
    for z in (-70, 70):
        g.add(k.box(stone, 141, 5, 5.2, 0.6, 0, 0, z, seg=1), k.box(band, 140.6, 3.2, 4.8, 0.5, 0, wall - 7, z, seg=1))
    g.add(k.box(stone, 5.2, 5, 145, 0.6, -68, 0, 0, seg=1), k.box(band, 4.8, 3.2, 144.6, 0.5, -68, wall - 7, 0, seg=1))
    # (Each stops just short of a doorway's side, and stands just past the wall's end.)
    for z in (-66.4, 0, 66.4):
        g.add(k.box(stone, 5.2, 5, 12 if z else 23.2, 0.6, 68, 0, z, seg=1))
    g.add(k.box(band, 4.8, 3.2, 144.6, 0.5, 68, wall - 4.4, 0, seg=1))
    for x in (-44, -15, 15, 44):
        g.add(barredZ(k, x, 30, 72, 12, 28), barredZ(k, x, 30, -72, 12, 28))
    for z in (-36, 36):
        g.add(barredX(k, -70, 30, z, 12, 28))
    # A round light in each gable.
    for x in (74.2, -74.2):
        g.add(k.cylX(k.paint(FRAME), 7, 1.4, x, wall + 11, 0, 24), k.cylX(k.paint(WIN), 5.2, 2.0, x, wall + 11, 0, 24))
    # Doors: two leaves per road, hinged at the opening's sides, swinging out. Each is its half of the arch, its foot
    # just over the rails' tops (so it sweeps over the track outside, not through it); a stone sill fills the doorway
    # beside the track.
    foot = 12.5
    for zc in (-36, 36):
        for name, side in (("leafL", 1), ("leafR", -1)):
            leaf = named(Node(), name)
            # (The outline as drawn on paper: x is across the leaf from its hinge, turned to lie along z.)
            w = r - 0.3
            top = [(u, spring + math.sqrt(max(0.0, (r - 0.4) ** 2 - (r - u) ** 2))) for u in (w, 21, 18, 14, 10, 7, 4, 2, 0.4)]
            pts = [(-side * u, y) for u, y in [(0, foot), (w, foot)] + top + [(0, spring)]]
            # (Counter-clockwise as drawn, whichever way the leaf lies.)
            if side > 0:
                pts.reverse()
            leaf.add(k.at(k.extrude(k.paint(YARD_TRIM), pts, 2, 0, 0, 0, 0.3), 0, 0, 0, math.pi / 2))
            braced(k, leaf, r - 0.3, spring - foot, foot, side * (r - 0.3) / 2)
            g.add(k.at(leaf, 71.4, 0, zc - side * r))
        for z in (zc - 22.1, zc + 22.1):
            g.add(k.box(stone, 7.4, 11.8, 4.6, 0.5, 68.5, 0, z, seg=1))
    return g


def roundhouse_segment(k):
    # Three stalls fanned an eighth of a turn apart round a turntable's centre (the origin), each road 108 long from the
    # pit's rim (radius 92) out to its end, a buffer just past that: the game's kit piece (kit-roundhouse-segment).
    g = Node()
    brick = k.paint(BRICK)
    rim = 92
    # (Walls and doorway high enough for the tallest car on the rails, 73 above the ground; the doors' feet over the rails.)
    wall, door, foot = 84, 76, 12.5
    for a in (-math.pi / 4, 0, math.pi / 4):
        stall = Node()
        stall.add(k.trackSlab(130, rim + 65, 0, 0))
        stall.add(k.box(k.paint(TOY.red), 6, 12, 30, 1.5, rim + 133, 12, 0))
        for s in (-10, 10):
            stall.add(k.cylX(k.paint(TOY.black), 2.5, 4, rim + 129, 18, s, 12))
        # Side walls and back, open front.
        for z in (-26, 26):
            stall.add(k.box(brick, 120, wall, 3, 1, rim + 82, 0, z))
        stall.add(k.box(brick, 3, wall, 55, 1, rim + 143.5, 0, 0))
        # (The beam over the doors, in cream; a brick gable over it and over the back wall.)
        stall.add(k.box(k.paint(YARD_WALL), 3.4, wall - door - 0.4, 55.4, 1, rim + 22.5, door, 0, seg=1))
        for x in (rim + 22.5, rim + 143.5):
            stall.add(gable(k, brick, 3, 55, 12, x, wall - 0.5, 0))
        # A slate roof, its ridge along the road, and a stone course along the walls.
        stall.add(k.roof(k.paint(YARD_SLATE), 128, 61, 14.6, rim + 83, wall - 1.4, 0))
        for z in (-26, 26):
            stall.add(k.box(k.paint(YARD_STONE), 121, 4.5, 4.2, 0.6, rim + 82, 0, z, seg=1))
            for x in (rim + 60, rim + 108):
                stall.add(barredZ(k, x, 28, z + (1.5 if z > 0 else -1.5), 11, 26))
        stall.add(k.box(k.paint(YARD_STONE), 4.2, 4.5, 56, 0.6, rim + 143.5, 0, 0, seg=1))
        stall.add(barredX(k, rim + 145, 28, 0, 11, 26))
        stall.add(k.cylX(k.paint(FRAME), 4, 1.2, rim + 18.8, wall + 4.5, 0, 18), k.cylX(k.paint(WIN), 2.8, 1.7, rim + 18.8, wall + 4.5, 0, 18))
        stall.add(k.cyl(k.paint(TOY.black), 3, 12, rim + 90, wall + 10, 0, 2.4, 12), k.box(k.paint(TOY.black), 9, 1.5, 9, 0.4, rim + 90, wall + 22, 0))
        # Doors across the open front (facing the turntable), two leaves hinged at the walls, swinging out toward it.
        left = named(Node(), "stallL")
        left.add(k.box(k.paint(YARD_TRIM), 2, door - foot - 0.4, 24, 0.6, 0, foot, 12, seg=1))
        braced(k, left, 24, door - foot - 0.4, foot, 12)
        stall.add(k.at(left, rim + 19.6, 0, -24.5))
        right = named(Node(), "stallR")
        right.add(k.box(k.paint(YARD_TRIM), 2, door - foot - 0.4, 24, 0.6, 0, foot, -12, seg=1))
        braced(k, right, 24, door - foot - 0.4, foot, -12)
        stall.add(k.at(right, rim + 19.6, 0, 24.5))
        # (A stone sill in the doorway beside the track: the leaves hang over the rails' tops.)
        for z in (-22.2, 22.2):
            stall.add(k.box(k.paint(YARD_STONE), 5, 11.8, 4.6, 0.5, rim + 22, 0, z, seg=1))
        stall.rotation.y = a
        g.add(stall)
    return g


def goods_shed(k):
    """
    The goods shed, in the yard's colours: cream walls over a green boarded skirt and a stone course, a slate roof
    with a ridge board and two vents, barred windows in its ends and along its back, a round light in each gable.
    Its outline, dock, door and crane stand where they always did (the game slides `door` and swings `jib`).
    """
    g = Node()
    trim = k.paint(YARD_TRIM)
    g.add(k.box(k.paint(YARD_STONE), 92.4, 4, 42.4, 0.8, seg=1))
    g.add(house(k, 90, 40, 38, k.paint(YARD_WALL), YARD_SLATE, 14))
    g.add(k.box(trim, 91.2, 11, 41.2, 1.0, 0, 3, 0, seg=1))
    # The roof's ridge board and its two vents.
    g.add(k.box(k.paint(YARD_RIDGE), 88, 2.2, 4.4, 0.8, 0, 52.6, 0, seg=1))
    for x in (-24, 24):
        g.add(k.box(k.paint(YARD_WALL), 8, 5, 8, 0.9, x, 52, 0, seg=1), hip(k, k.paint(YARD_SLATE), 12, 4.5, x, 56.6, 0))
    # Windows: one in each end, three along the back; a round light in each gable.
    for x in (45, -45):
        g.add(winX(k, x, 19, 0, 10, 12), barsX(k, x, 19, 0, 10, 12))
    for x in (47.5, -47.5):
        g.add(k.cylX(k.paint(FRAME), 4.4, 1.2, x, 44.5, 0, 20), k.cylX(k.paint(WIN), 3.1, 1.7, x, 44.5, 0, 20))
    for x in (-28, 0, 28):
        g.add(winZ(k, x, 19, -20, 9, 11), barsZ(k, x, 19, -20, 9, 11))
    # The doorway, and its sliding door: green boards in a cream frame with a brace across.
    g.add(k.box(k.paint(WIN), 34, 28, 1, 0.3, 0, 0, 20.2))
    door = named(Node(), "door")
    door.add(k.box(trim, 34, 28, 2, 0.6, 0, 0, 0, seg=1))
    for y in (12.4, 25.4):
        door.add(k.box(k.paint(FRAME), 33, 1.8, 2.8, 0.3, 0, y, 0, seg=1))
    for x in (-15.6, 15.6):
        door.add(k.box(k.paint(FRAME), 1.8, 14.8, 2.8, 0.3, x, 12.4, 0, seg=1))
    brace = k.box(k.paint(FRAME), 31, 1.6, 2.7, 0.3, 0, 19, 0, seg=1)
    brace.rotation.z = math.atan2(10.5, 29.5)
    door.add(brace)
    g.add(k.at(door, 0, 0, 21.8))
    # (The rail the door hangs from.)
    g.add(k.box(k.paint(TOY.black), 82, 1.8, 2.6, 0.4, 0, 29.2, 21.5))
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
    g.add(k.cyl(k.paint(TOY.black), 3.4, 2, 45, 12, 32, 3.0, 14))
    return g


def warehouse(k):
    g = Node()
    g.add(k.box(k.paint(BRICK), 60, 96, 46, 2))
    g.add(gable(k, k.paint(BRICK), 59.5, 46, 14, 0, 96, 0))
    drop = (2 * 4 * 14) / 46
    g.add(k.roof(k.paint(YARD_SLATE), 68, 54, 14 + drop, 0, 96 - drop + 1.4, 0))
    for f in range(4):
        # A loading door to each floor, green boards in a cream frame; barred windows either side and down both sides.
        g.add(k.box(k.paint(FRAME), 1.4, 18, 16, 0.5, 30, 3 + f * 23, 0, seg=1))
        g.add(k.box(k.paint(YARD_TRIM), 1.9, 16, 14, 0.5, 30, 4 + f * 23, 0, seg=1))
        for z in (-15, 15):
            g.add(barredX(k, 30, 7 + f * 23, z, 8, 10))
        for x in (-18, 0, 18):
            g.add(barredZ(k, x, 7 + f * 23, 23, 8, 10), barredZ(k, x, 7 + f * 23, -23, 8, 10))
        g.add(barredX(k, -30, 7 + f * 23, 0, 8, 10))
    # A stone course round the foot, a cream band at each floor and under the eaves, a round light in each gable.
    g.add(k.box(k.paint(YARD_STONE), 61.6, 4, 47.6, 0.6, seg=1))
    for y in (23.6, 46.6, 69.6, 93):
        g.add(k.box(k.paint(YARD_WALL), 60.8, 1.8, 46.8, 0.5, 0, y, 0, seg=1))
    for x in (34.2, -34.2):
        g.add(k.cylX(k.paint(FRAME), 3.6, 1.2, x, 102, 0, 18), k.cylX(k.paint(WIN), 2.5, 1.7, x, 102, 0, 18))
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
        g.add(barredX(k, 30, 26, z))
    for z in (-11,):
        g.add(barredX(k, 30, 8, z))
    for x in (-18, 0, 18):
        g.add(barredZ(k, x, 18, 17, 8, 10))
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
        g.add(barredX(k, 22.3 - (7 * (y + 5)) / 61, y, 0, 6, 8))
    sails = named(Node(), "sails")
    sails.add(k.cylX(k.paint(TOY.red), 4, 6, 0, 0, 0, 16))
    for i in range(4):
        arm = Node()
        arm.add(k.box(k.wood, 1.8, 42, 2, 0.4, 0, 0, 0))
        arm.add(k.box(k.paint(TOY.white), 1.2, 29.5, 10, 0.4, 0.4, 10, 5.5))  # (its top under the top slat's)
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
        b.add(barredX(k, 28, 24, z, 8, 9))
    b.add(barredZ(k, -16, 20, -17), barredZ(k, 16, 20, -17))
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
