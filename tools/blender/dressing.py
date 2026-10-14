"""
Parts for the map's own buildings, stations and streets (src/render/dressing/buildings.ts), modelled in Blender.

    npm run models     # builds every model file (with `python3`, or $BLENDER_PYTHON), then compresses them

The map's buildings are sized to their squares, so their walls, roofs and windows stay in code; these are the
fixed-size details the code places on them: doors, flower boxes and chimney tops, the station's canopy posts, clock,
benches and people, the engine shed's doors and windows, and the street furniture. Each is authored as the code
authors it (facing +z, the game's coordinates; see each part's note for its origin), so the code places it the same
way it placed its boxes.

A colour that changes from copy to copy (a door, a coat, a flower) is a slot: lacquer named "lacquer slot <name>", which
the game fills in when it places the part.

Writes tools/blender/dressing.blend and tools/blender/out/dressing.glb (one node per part, named by it).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit  # noqa: E402
import toy  # noqa: E402
from kit import TOY, Node  # noqa: E402
from life_parts import face  # noqa: E402

CREAM = "#fbf6ec"
IRON = "#2f5d3a"
PANE = "#a9cfe6"
STONE = "#e4dccb"
GOLD = "#d9a93a"
DARK = "#2a2b2e"
RED = "#c8442f"


def slot(name):
    return f"slot {name}"


# ——— Building details ———


def door(k):
    """
    A door 13 wide and 24 high (slot "door"; scaled to other sizes), centred on its middle, its back on z = 0: two
    raised panels, a cream frame and a brass knob at +x.
    """
    g = Node()
    w, h = 13, 24
    g.add(k.box(k.paint(slot("door")), w, h, 2, 0.8, 0, -h / 2, 1))
    for y in (-h * 0.27, h * 0.2):
        g.add(k.box(k.paint(slot("door")), w - 5, h * 0.3, 0.8, 0.35, 0, y - h * 0.15, 2.2))
    cream = k.paint(CREAM)
    g.add(k.box(cream, w + 3, 1.5, 2.4, 0.5, 0, h / 2 - 0.2, 1.2))
    for s in (-1, 1):
        g.add(k.box(cream, 1.5, h, 2.4, 0.5, s * (w / 2 + 0.75), -h / 2, 1.2))
    g.add(k.lathe(k.paint(GOLD), [(0.0, 0), (0.7, 0), (0.6, 0.6), (1.2, 1.2), (1.1, 1.8), (0.0, 2.0)], 0, 0, 0, 16))
    g.children[-1].rotation.x = math.pi / 2
    g.children[-1].position.set(w * 0.3, 0, 2)
    return g


def flower_box(k):
    """A window box 18 wide (scaled), centred on its base at the front of the wall: green box, flowers (slot "flower")."""
    g = Node()
    g.add(k.box(k.paint("#3c8f4e"), 18, 4, 4, 1.2, 0, 0, 0))
    g.add(k.box(k.paint("#2f6d3c"), 17, 1.2, 3.4, 0.4, 0, 3.4, 0))
    for i in range(6):
        x = -7.5 + i * 3
        g.add(k.ball(k.paint(slot("flower")), 1.35, x, 5.4 + (i % 2) * 0.5, -0.3 + (i % 2) * 0.6))
    return g


def chimney_top(k):
    """The top of a house chimney (its shaft is code, sized to the roof): a cap 11 square on y = 0, and two pots."""
    g = Node()
    g.add(k.box(k.paint("#7a3b26"), 11, 2.4, 11, 0.8, 0, 0, 0))
    for x in (-2.4, 2.4):
        g.add(k.lathe(k.paint("#b8643f"), [(0.0, 0), (1.9, 0), (1.6, 3.2), (2.1, 3.8), (1.4, 4.0), (0.0, 3.6)], x, 2.4, 0, 16))
    return g


# ——— Station ———


def canopy_post(height):
    def build(k):
        """A canopy column `height` tall on y = 0: a square plinth, a turned shaft, a capital."""
        g = Node()
        cream = k.paint("#f0ebe0")
        g.add(k.box(cream, 6, 2.4, 6, 0.6, 0, 0, 0))
        g.add(k.lathe(cream, [(0.0, 2.4), (3.0, 2.4), (2.6, 3.6), (2.2, 4.6), (2.2, height - 4.6), (2.6, height - 3.2), (3.4, height - 2.2), (0.0, height - 2.2)], 0, 0, 0, 24))
        g.add(k.box(cream, 7.5, 2.2, 7.5, 0.6, 0, height - 2.2, 0))
        return g

    return build


def station_clock(k):
    """The clock over the station door, facing +z and centred on its face: a red rim, a cream face, marks and hands."""
    g = Node()
    rim = k.cylZ(k.paint(RED), 6.5, 1.6, 0, 0, 0.8, 40)
    g.add(rim)
    g.add(k.cylZ(k.paint(CREAM), 5.2, 1.6, 0, 0, 1.4, 40))
    dark = k.paint(DARK)
    for i in range(12):
        a = i / 12 * math.pi * 2
        g.add(k.ball(dark, 0.42 if i % 3 == 0 else 0.26, math.cos(a) * 4.3, math.sin(a) * 4.3, 2.25))
    g.add(k.box(dark, 0.9, 3.8, 0.6, 0.25, 0, 0, 2.4))
    hand = k.box(dark, 3.2, 0.9, 0.6, 0.25, 1.4, -0.45, 2.4)
    g.add(hand)
    g.add(k.ball(dark, 0.7, 0, 0, 2.6))
    return g


def station_bench(k):
    """A platform bench, centred on its seat (its back toward +z): beech seat and back, blue legs with armrests."""
    g = Node()
    g.add(k.box(k.wood, 24, 2, 7, 0.8, 0, 5, 0))
    g.add(k.box(k.wood, 24, 7, 1.6, 0.6, 0, 6.5, 3.5))
    blue = k.paint("#2f6db5")
    for e in (-10, 10):
        g.add(k.box(blue, 2, 5, 6, 0.4, e, 0, 0))
        g.add(k.box(blue, 1.6, 1.2, 6.5, 0.5, e, 8.6, 0))
        g.add(k.box(blue, 1.6, 3.6, 1.4, 0.4, e, 5.6, -2.6))
    return g


def peg_body(k, coat):
    """A peg body and painted head facing +z (the code's people face +z; life_parts faces +x)."""
    from life_parts import body_profile

    g = Node()
    g.add(k.lathe(k.paint(coat), body_profile(), 0, 0, 0, 32))
    g.add(k.ball(k.wood, 3.4, 0, 14, 0))
    f = face(k)
    f.rotation.y = -math.pi / 2
    g.add(f)
    return g


def peg_doll(hat):
    def build(k):
        """A waiting passenger: coat (slot "coat"), and a hat (slot "hat") if `hat`."""
        g = peg_body(k, slot("coat"))
        if hat:
            g.add(k.cyl(k.paint(slot("hat")), 4, 0.9, 0, 15.95, 0, 4, 28))
            g.add(k.cyl(k.paint(slot("hat")), 2.6, 3, 0, 16.7, 0, 2.8, 24))
        return g

    return build


def conductor(k):
    """A conductor in a maroon coat and peaked cap, holding a green flag out to the side (+x)."""
    coat = "#7b2333"
    g = peg_body(k, coat)
    for y in (4.5, 7, 9.5):
        g.add(k.ball(k.paint(GOLD), 0.6, 0, y, 3.75 - y * 0.08))
    g.add(k.cyl(k.paint("#1f2f57"), 3.5, 2.6, 0, 15.9, 0, 3.5, 28))
    g.add(k.cyl(k.paint(GOLD), 3.56, 0.6, 0, 16.0, 0, 3.56, 28))
    g.add(k.box(k.paint(DARK), 4, 0.6, 2.4, 0.25, 0, 15.8, 3.4))
    g.add(k.capsule(k.paint(coat), 1.1, 3, 4.2, 5.6, 0.6))
    g.add(k.ball(k.wood, 1.2, 4.6, 10.5, 0.6))
    g.add(k.cyl(k.wood, 0.35, 13, 4.8, 7.5, 0.6, 0.35, 10))
    g.add(k.box(k.paint("#3c8f4e"), 6, 4.4, 0.5, 0.2, 7.8, 16, 0.6))
    return g


def porter(k):
    """A porter in a brown coat and cap pushing a luggage barrow piled with cases; the barrow runs toward +x."""
    coat = "#6b3f22"
    g = Node()
    p = peg_body(k, coat)
    p.add(k.cyl(k.paint(coat), 3.5, 2.4, 0, 15.9, 0, 3.5, 28))
    p.add(k.box(k.paint(DARK), 2.4, 0.6, 4, 0.25, 3.4, 15.8, 0))
    g.add(k.at(p, -16, 0, 0))
    g.add(k.box(k.wood, 22, 2, 9, 0.6, 0, 3.5, 0))
    for x in (-7, 7):
        for z in (-4.4, 4.4):
            g.add(k.cylZ(k.paint(DARK), 2.2, 1.4, x, 2.2, z, 24))
            g.add(k.cylZ(k.paint(GOLD), 0.7, 1.8, x, 2.2, z, 12))
    for z in (-3.6, 3.6):
        g.add(k.box(k.paint(IRON), 1, 6, 1, 0.3, -11, 5, z))
    g.add(k.cylZ(k.paint(IRON), 0.6, 9, -11, 11, 0, 12))
    g.add(k.box(k.paint("#7a3b26"), 10, 6, 8, 1, -3, 5.5, 0))
    g.add(k.box(k.paint(GOLD), 10.2, 0.8, 8.2, 0.2, -3, 8.6, 0))
    g.add(k.box(k.paint("#2f6db5"), 8, 3, 6, 0.8, -3, 11.5, -0.5))
    g.add(k.box(k.paint(RED), 6, 2.6, 5, 0.8, -3, 14.5, -0.5))
    g.add(k.cyl(k.paint("#e98aa8"), 3, 3.5, 5, 5.55, 1, 3, 28))
    g.add(k.cyl(k.paint(CREAM), 3.05, 0.7, 5, 8.25, 1, 3.05, 28))
    return g


def traveller(k):
    """A traveller in a green coat and bowler hat with a brown suitcase at their side (+x)."""
    g = peg_body(k, "#3c8f4e")
    from life_parts import dome

    g.add(dome(k, k.paint(DARK), 3, 3, 0, 16.3, 0))
    g.add(k.cyl(k.paint(DARK), 4.3, 0.6, 0, 16.1, 0, 4.3, 28))
    g.add(k.box(k.paint("#7a3b26"), 7, 5.5, 2.4, 0.6, 7.4, 0.65, 0))
    for x in (5.6, 9.2):
        g.add(k.box(k.paint(GOLD), 0.6, 5.6, 2.5, 0.15, x, 0.6, 0))
    g.add(k.ring(k.paint(DARK), 1.1, 0.35, 7.4, 6.2, 0, True, math.pi))
    return g


# ——— Engine shed ———


def _arch(w, h, steps=16):
    pts = [(-w / 2, 0), (w / 2, 0), (w / 2, h - w / 2)]
    for i in range(1, steps):
        a = math.pi * i / steps
        pts.append((math.cos(a) * w / 2, h - w / 2 + math.sin(a) * w / 2))
    pts.append((-w / 2, h - w / 2))
    return pts


def shed_door(k):
    """One of the engine shed's arched doors, its foot centred on y = 0, its back on z = 0: cream arch, green door, bars."""
    g = Node()
    g.add(k.extrude(k.paint(CREAM), _arch(38, 46), 1.6, 0, 0, 0.6, 0.4))
    g.add(k.extrude(k.paint("#2f5d3a"), _arch(32, 42), 1.6, 0, 0, 1.2, 0.4))
    cream = k.paint(CREAM)
    g.add(k.box(cream, 1.4, 26, 1, 0.3, 0, 0, 2.4))
    for y in (8, 20):
        g.add(k.box(cream, 30, 1.2, 1, 0.3, 0, y, 2.4))
    for x in (-3, 3):
        g.add(k.ball(k.paint(GOLD), 0.8, x, 13, 2.8))
    return g


def shed_window(k):
    """A window down the shed's side, 20 by 16, centred, its back on z = 0: cream frame, pale pane, glazing bars."""
    g = Node()
    cream = k.paint(CREAM)
    g.add(k.box(cream, 20, 16, 1.6, 0.5, 0, -8, 0.8))
    g.add(k.box(k.paint(PANE), 16, 12, 1, 0, 0, -6, 1.3))
    g.add(k.box(cream, 1.2, 12, 1.2, 0.3, 0, -6, 1.8))
    g.add(k.box(cream, 16, 1.2, 1.2, 0.3, 0, -0.6, 1.8))
    return g


# ——— Street furniture (each facing +z, centred on its base) ———


def street_lamp(k):
    iron = k.paint(IRON)
    g = Node()
    g.add(k.lathe(iron, [(0.0, 0), (3.4, 0), (3.4, 0.8), (2.8, 2.5), (1.6, 3.4), (1.3, 5), (1.0, 33), (1.6, 33.8), (2.0, 35.2), (0.0, 35.2)], 0, 0, 0, 24))
    glass = k.cyl(k.paint("#f6e3a1"), 2.6, 6, 0, 35.2, 0, 3.4, 4)
    glass.rotation.y = math.pi / 4
    g.add(glass)
    cap = k.cone(iron, 4.6, 3.4, 0, 41.2, 0, 4)
    cap.rotation.y = math.pi / 4
    g.add(cap)
    g.add(k.ball(iron, 1, 0, 45, 0))
    return g


def street_bench(k):
    iron = k.paint(IRON)
    g = Node()
    for i in range(3):
        g.add(k.box(k.wood, 22, 1.4, 1.8, 0.5, 0, 5.3, 2.6 - i * 2.1))
    for i in range(2):
        g.add(k.box(k.wood, 22, 1.8, 1.4, 0.5, 0, 9 + i * 2.6, -2.8))
    for e in (-9, 9):
        g.add(k.box(iron, 1.8, 5.3, 6, 0.4, e, 0, 0.2))
        g.add(k.box(iron, 1.4, 8, 1.4, 0.4, e, 5.3, -2.8))
        g.add(k.box(iron, 1.6, 1.2, 6, 0.5, e, 8.4, 0.4))
    return g


def planter(k):
    g = Node()
    g.add(k.box(k.paint("#a5503a"), 14, 6, 7, 1.2, 0, 0, 0))
    g.add(k.box(k.paint("#8a3f2c"), 14.6, 1.4, 7.6, 0.5, 0, 5, 0))
    g.add(k.box(k.paint("#3c8f4e"), 12, 3.2, 5, 1.4, 0, 5.4, 0))
    for i in range(4):
        x = -4.5 + i * 3
        z = 0.8 if i % 2 else -0.8
        g.add(k.ball(k.paint(slot(f"flower{i}")), 1.5, x, 9.4, z))
        g.add(k.ball(k.paint("#f6e7a8"), 0.5, x, 10.6, z))
    return g


def postbox(k):
    red = k.paint(RED)
    g = Node()
    g.add(k.lathe(red, [(0.0, 0), (3.8, 0), (3.8, 0.8), (3.5, 1.4), (3.3, 12.6), (3.9, 13.0), (3.9, 14.0), (3.4, 14.0)] + [(3.4 * math.cos(a), 14 + 3.4 * math.sin(a)) for a in [math.pi / 2 * i / 6 for i in range(1, 7)]], 0, 0, 0, 32))
    g.add(k.box(k.paint(DARK), 3.6, 0.8, 1, 0.25, 0, 10.1, 3.2))
    g.add(k.box(k.paint(GOLD), 2.4, 1.6, 0.6, 0.2, 0, 6.5, 3.35))
    return g


def phone_box(k):
    red = k.paint(RED)
    g = Node()
    g.add(k.box(red, 14, 1.5, 14, 0.5, 0, 0, 0))
    g.add(k.box(k.paint(PANE), 11, 26, 11, 0, 0, 2, 0))
    for x, z in ((-5.6, -5.6), (5.6, -5.6), (-5.6, 5.6), (5.6, 5.6)):
        g.add(k.box(red, 2.6, 28, 2.6, 0.5, x, 1, z))
    for y in (8, 15, 22):
        g.add(k.box(red, 11.6, 1, 11.6, 0.2, 0, y - 0.5, 0))
    for x in (-1.9, 1.9):
        g.add(k.box(red, 1, 26, 11.6, 0.2, x, 2, 0))
        g.add(k.box(red, 11.6, 26, 1, 0.2, 0, 2, x))
    g.add(k.box(red, 14, 3, 14, 0.8, 0, 29, 0))
    top = k.cyl(red, 9, 2.6, 0, 32, 0, 5, 4)
    top.rotation.y = math.pi / 4
    g.add(top)
    g.add(k.ball(red, 1.2, 0, 35, 0))
    for s in (1, -1):
        g.add(k.box(k.paint(CREAM), 9, 2.2, 0.6, 0.2, 0, 26.3, s * 6.2))
        g.add(k.box(k.paint(CREAM), 0.6, 2.2, 9, 0.2, s * 6.2, 26.3, 0))
    return g


def bus_stop(k):
    red = k.paint(RED)
    g = Node()
    g.add(k.box(k.paint(PANE), 26, 17, 1, 0, 0, 3, -4.5))
    for x in (-14, 14):
        g.add(k.box(red, 2.2, 24, 2.2, 0.5, x, 0, -4.5))
    g.add(k.box(red, 27, 1.4, 1.6, 0.4, 0, 2.6, -4.5))
    g.add(k.box(red, 32, 2, 11, 0.8, 0, 24, -1.5))
    g.add(k.box(k.wood, 20, 1.6, 4.5, 0.6, 0, 6.7, -1.5))
    for x in (-8, 8):
        g.add(k.box(red, 1.6, 7, 1.6, 0.4, x, 0, -1.5))
    g.add(k.cyl(k.paint("#8a8f96"), 0.7, 28, 18.5, 0, 3, 0.7, 12))
    g.add(k.cylZ(red, 4, 1, 18.5, 28, 3, 32))
    g.add(k.cylZ(k.paint(CREAM), 2.6, 1.2, 18.5, 28, 3, 32))
    g.add(k.box(k.paint("#2f6db5"), 9, 1.8, 1.4, 0.3, 18.5, 27.1, 3))
    return g


def fountain(k):
    stone = k.paint(STONE)
    g = Node()
    g.add(k.lathe(stone, [(0.0, 0), (13.6, 0), (13.6, 0.6), (13.0, 4.4), (13.4, 5.0), (12.2, 5.4), (11.6, 4.6), (0.0, 4.6)], 0, 0, 0, 48))
    g.add(k.cyl(k.paint("#7cc0e0"), 11.6, 0.6, 0, 4.6, 0, 11.6, 48))
    g.add(k.lathe(stone, [(0.0, 4.6), (2.8, 4.6), (2.0, 6.5), (1.8, 13), (2.4, 14), (5.6, 15.4), (5.8, 16.6), (4.8, 16.8), (0.0, 16.4)], 0, 0, 0, 32))
    g.add(k.cyl(k.paint("#7cc0e0"), 4.8, 0.5, 0, 16.2, 0, 4.8, 32))
    g.add(k.ball(k.paint("#a9d8ee"), 1.8, 0, 18.4, 0))
    for i in range(6):
        a = i / 6 * math.pi * 2
        g.add(k.ball(k.paint("#a9d8ee"), 0.9, math.cos(a) * 7, 6.2, math.sin(a) * 7))
    return g


def statue(k):
    bronze = k.paint("#4f7d62")
    g = Node()
    g.add(k.box(k.paint(STONE), 15, 3, 15, 0.8, 0, 0, 0))
    g.add(k.box(k.paint("#bdb6a8"), 10, 12, 10, 1, 0, 3, 0))
    g.add(k.box(k.paint(STONE), 12, 2, 12, 0.6, 0, 15, 0))
    from life_parts import body_profile

    body = k.lathe(bronze, body_profile(), 0, 17, 0, 32)
    g.add(body)
    g.add(k.ball(bronze, 2.8, 0, 29.6, 0))
    arm = k.capsule(bronze, 0.9, 6, 0, -4, 0)
    pivot = Node()
    pivot.add(arm)
    pivot.position.set(2.6, 27, 0)
    pivot.rotation.z = -2.4
    g.add(pivot)
    g.add(k.box(k.paint(CREAM), 6, 2.4, 0.4, 0.15, 0, 8.8, 5.1))
    return g


# ——— Industries (Game mode's depots) ———
#
# Authored in the depot's own frame, as src/render/depot-view.ts lays a depot out: the origin is the depot track
# piece's socket end, on the track's centreline at its base (y = 0); +x runs along the track (0 to 216), +z is the yard
# side. The track covers z -20 to +20, the yard pad is 4 high at x 10-206, z 30-114, and anything over the track clears
# 70 mm. Cranes and piles stay in code; these keep clear of them.

PAD = 4
SHED_POST = "#f0ebe0"


def industry_workshop(k):
    """
    The workshop, where planks become toys: a long beech shed (84 x 54, walls 36 high) at x 156, z 84, under a solid
    pitched roof (slot "roof", ridge along x), with big double doors (slot "doors") facing the track, a printed window
    either side, a stubby chimney, and a sign board on the ridge (slot "sign").
    """
    from bldg_parts import winZ

    g = Node()
    x, z, w, d, h = 156, 84, 84, 54, 36
    front = z - d / 2
    g.add(k.box(k.wood, w, h, d, 3, x, PAD, z))
    g.add(k.roof(k.paint(slot("roof")), w + 5, d + 5, 13, x, PAD + h - 0.5, z, 3.5))
    # Double doors, a hair apart, with a cross brace each: the track side's centre.
    for s in (-1, 1):
        cx = x + s * 7.6
        g.add(k.box(k.paint(slot("doors")), 14.4, 27, 1.6, 0.8, cx, PAD, front - 0.4))
        g.add(k.box(k.paint(slot("doors")), 11, 2.2, 1.2, 0.5, cx, PAD + 12.5, front - 1.2))
    g.add(k.box(k.paint(CREAM), 33, 2.4, 2.2, 0.8, x, PAD + 27.2, front - 0.4))
    for wx in (x - 30, x + 30):
        g.add(winZ(k, wx, PAD + 15, front, 12, 10))
    g.add(k.box(k.paint("#a8553a"), 7, 12, 7, 1.8, x + 26, PAD + h + 2, z + 10))
    # Sign board standing on the ridge.
    ridge = PAD + h - 0.5 + 13
    g.add(k.box(k.paint(slot("sign")), 30, 10, 2.4, 1, x, ridge - 2.5, z))
    return g


def _slab(k, mat, length, width, t, angle, x, y, z):
    """A roof slab `length` along x, `width` down its slope, `t` thick, tipped `angle` about x, centred at (x, y, z)."""
    n = Node()
    n.add(k.box(mat, length, t, width, 2, 0, -t / 2, 0))
    n.rotation.x = angle
    n.position.set(x, y, z)
    return n


def industry_sawmill_shed(k):
    """
    The sawmill's saw shed: an open-sided shed over the track at the near end (posts at x 16 and 74, at z -28 and
    104), its gable roof's ridge along x at z 38 (slot "roof", about 87 at the top; 70 clear at the track's near edge,
    74 over its middle), and the saw table at x 44, z 74. The blade is a part of its own ("industry-saw-blade"), as
    the code spins it.
    """
    g = Node()
    ridge_z, under, pitch = 38, 82, math.atan(0.2)
    span, t, x0, x1 = 78, 5, 9, 81
    for s in (-1, 1):
        # Centre of each slab: half its width out from the ridge, down the pitch, and half its thickness up.
        cz = ridge_z + s * (span / 2) * math.cos(pitch) - s * (t / 2) * math.sin(pitch)
        cy = under - (span / 2) * math.sin(pitch) + (t / 2) * math.cos(pitch)
        g.add(_slab(k, k.paint(slot("roof")), x1 - x0, span, t, s * pitch, (x0 + x1) / 2, cy, cz))
    g.add(k.cylX(k.paint(slot("roof")), 3.6, x1 - x0 + 2, (x0 + x1) / 2, under + t - 0.6, ridge_z, 24))
    post = k.paint(SHED_POST)
    for px in (16, 74):
        for pz in (-28, 104):
            top = under - abs(pz - ridge_z) * math.tan(pitch) + 1.5
            g.add(k.box(post, 5, top, 5, 1.4, px, 0, pz))
            g.add(k.box(post, 7.5, 3, 7.5, 1.2, px, 0 if pz < 0 else PAD, pz))
    # The saw table: a beech block with a cream top and a slot for the blade (centred at y 22).
    g.add(k.box(k.wood, 44, 13, 26, 2.5, 44, PAD, 74))
    g.add(k.box(k.paint(CREAM), 44, 1.6, 26, 0.7, 44, PAD + 12.4, 74))
    g.add(k.box(k.paint(DARK), 26, 0.6, 3, 0.25, 44, PAD + 13.8, 74))
    for lx in (26, 62):
        g.add(k.box(k.paint(RED), 4, 4, 4, 1, lx, PAD + 14, 64))
    return g


def industry_saw_blade(k):
    """The sawmill's blade: a toothed disc 22 across and 1.4 thick, upright in the x/y plane, its hub at the origin."""
    teeth, ro, ri = 18, 11, 9.4
    outline = []
    for i in range(teeth):
        a0 = 2 * math.pi * i / teeth
        a1 = 2 * math.pi * (i + 0.6) / teeth
        outline += [(ri * math.cos(a0), ri * math.sin(a0)), (ro * math.cos(a1), ro * math.sin(a1))]
    g = Node()
    g.add(k.extrude(k.metal, outline, 1.4, 0, 0, 0, bevel=0.25))
    g.add(k.cylZ(k.paint(RED), 3.2, 3, 0, 0, 0, 20))
    return g


def industry_forest_hut(k):
    """
    The forest yard's hut: a small beech hut (30 x 24, walls 24 high) at x 186, z 96 under a solid green roof (slot
    "roof"), a door and a printed window facing the track, a stovepipe, and a chopping block with an axe in it by the
    door.
    """
    from bldg_parts import winZ

    g = Node()
    x, z, w, d, h = 186, 96, 30, 24, 24
    front = z - d / 2
    g.add(k.box(k.wood, w, h, d, 2.5, x, PAD, z))
    g.add(k.roof(k.paint(slot("roof")), w + 5, d + 5, 11, x, PAD + h - 0.5, z, 3))
    g.add(k.box(k.paint("#9a4a2c"), 9, 16, 1.6, 0.8, x - 6, PAD, front - 0.4))
    g.add(winZ(k, x + 7, PAD + 9, front, 7, 7))
    g.add(k.cyl(k.paint(DARK), 1.8, 10, x + 8, PAD + h + 2, z + 4, None, 14))
    # Chopping block and axe, left of the hut.
    bx, bz = 164, 88
    g.add(k.cyl(k.wood, 5.2, 7, bx, PAD, bz, 5.6, 20))
    axe = Node()
    axe.add(k.cyl(k.paint("#c99a5b"), 0.9, 13, 0, 0, 0, None, 10))
    axe.add(k.box(k.metal, 5, 3.2, 1.6, 0.5, 1.8, 10.5, 0))
    axe.rotation.z = -0.5
    axe.position.set(bx - 1, PAD + 6.2, bz)
    g.add(axe)
    for i, (rx, rz) in enumerate(((bx + 1, bz + 11), (bx + 7, bz + 12))):
        g.add(k.cyl(k.wood, 3.6, 3.2, rx, PAD, rz, None, 18))
    return g


def industry_farm(k):
    """
    The farm yard, where grain is loaded: a round grain silo (slot "silo", 26 across, 60 tall) at the clear end of the
    yard (x 186, z 50), with a chute angled down toward the track, and a little barn (40 x 30, walls 22 high, slot
    "roof") at x 170, z 90 with big printed doors facing the track.
    """
    g = Node()
    sx, sz, r = 186, 50, 13
    silo = k.paint(slot("silo"))
    g.add(k.cyl(silo, r, 48, sx, PAD, sz, None, 32))
    g.add(k.lathe(silo, [(0.0, 0), (r, 0)] + [(r * math.cos(a), 8 * math.sin(a)) for a in (0.35, 0.7, 1.05, 1.35)] + [(0.0, 8)], sx, PAD + 48, sz, 32))
    for y in (PAD + 14, PAD + 32):
        g.add(k.cyl(k.paint(CREAM), r + 0.8, 2.4, sx, y, sz, None, 32))
    g.add(k.ball(k.paint(RED), 2.4, sx, PAD + 56.5, sz))
    # The chute: a square trough leaving the silo low down, sloping toward the track (-z), on a post.
    chute = Node()
    chute.add(k.box(k.paint(RED), 6, 4, 24, 1.2, 0, -2, 0))
    chute.rotation.x = -0.45
    chute.position.set(sx - 4, PAD + 22, sz - r - 9)
    g.add(chute)
    g.add(k.box(k.wood, 3, 14, 3, 0.8, sx - 4, PAD, sz - r - 16))
    # The barn.
    bx, bz, w, d, h = 170, 90, 40, 30, 22
    g.add(k.box(k.paint(RED), w, h, d, 3, bx, PAD, bz))
    g.add(k.roof(k.paint(slot("roof")), w + 5, d + 5, 11, bx, PAD + h - 0.5, bz, 3))
    front = bz - d / 2
    g.add(k.box(k.paint(CREAM), 18, 17, 1.4, 0.8, bx, PAD, front - 0.3))
    g.add(k.box(k.paint(RED), 14.4, 13.4, 1.4, 0.6, bx, PAD + 1.8, front - 0.7))
    for a in (0.83, -0.83):
        brace = Node()
        brace.add(k.box(k.paint(CREAM), 1.6, 18, 0.8, 0.3, 0, -9, 0))
        brace.rotation.z = a
        brace.position.set(bx, PAD + 8.5, front - 1.4)
        g.add(brace)
    return g


def industry_mill(k):
    """
    The mill, where grain becomes flour: a beech windmill tower (34 across at its foot, 62 high) at x 160, z 86 under a
    cap (slot "cap", to about 74), its door and a window facing the track. The sails are a part of their own
    ("industry-mill-sails"), as the code spins them; their hub goes at x 160, y 60, z 64.
    """
    g = Node()
    x, z, h = 160, 86, 62
    g.add(k.cyl(k.wood, 17, h, x, PAD, z, 13, 32))
    g.add(k.cyl(k.paint(CREAM), 17.8, 2.4, x, PAD, z, 17.4, 32))
    cap = k.paint(slot("cap"))
    g.add(k.cyl(cap, 14.6, 3, x, PAD + h - 1, z, 14.6, 32))
    g.add(k.lathe(cap, [(0.0, 0), (14.6, 0)] + [(14.6 * math.cos(a), 11 * math.sin(a)) for a in (0.3, 0.6, 0.9, 1.2, 1.45)] + [(0.0, 11)], x, PAD + h + 2, z, 32))
    g.add(k.ball(k.paint(GOLD), 2.2, x, PAD + h + 13.6, z))
    # The axle the sails turn on, out of the cap toward the track.
    g.add(k.cylZ(k.wood, 2.6, 12, x, 60, z - 16.5, 16))
    # A door and a window on the track side, set to the tower's taper.
    for y, w, hh, color in ((PAD, 11, 16, "#9a4a2c"), (PAD + 30, 8, 9, "#2b3644")):
        rr = 17 - 4 * (y - PAD + hh / 2) / h
        panel = Node()
        panel.add(k.box(k.paint(color), w, hh, 2.4, 1, 0, 0, 0))
        panel.rotation.x = math.atan(4 / h)
        panel.position.set(x, y, z - rr + 0.2)
        g.add(panel)
    return g


def industry_mill_sails(k):
    """The mill's sails: four sails 70 across on a hub, in the x/y plane facing -z, the hub at the origin (spin on z)."""
    g = Node()
    for i in range(4):
        arm = Node()
        arm.add(k.box(k.wood, 2.6, 34, 2.2, 0.8, 0, 2, 0))
        arm.add(k.box(k.paint(slot("sails")), 10, 24, 1.4, 1.2, 4.6, 11, 0.6))
        for y in (17, 25):
            arm.add(k.box(k.wood, 10.4, 1.2, 1.6, 0.4, 4.6, y, -0.4))
        arm.rotation.z = i * math.pi / 2
        g.add(arm)
    g.add(k.cylZ(k.paint(RED), 4.6, 4, 0, 0, -1, 20))
    g.add(k.ball(k.paint(RED), 2.4, 0, 0, -3.2))
    return g


def load_flour_sack(k):
    """One flour sack lying down, 14 (x) by 9 (z) by 6 high, a soft-cornered block with a printed blue band; centred on
    its footprint, its base on y = 0."""
    g = Node()
    g.add(k.box(k.paint("#f3ead8"), 14, 6, 9, 2.6, 0, 0, 0))
    g.add(k.box(k.paint("#2f6db5"), 3.2, 6.2, 9.2, 1.4, 0, -0.1, 0, seg=2))
    return g


def load_grain_heap(k):
    """A low mound of grain that fills a hopper's bin top (59 x 25, 8 high), centred on its footprint, its base on y = 0;
    scale it in y by how full the hopper is."""
    g = Node()
    mound = Node()
    prof = [(0.0, 0), (1.0, 0), (0.98, 0.18), (0.9, 0.42), (0.74, 0.68), (0.52, 0.86), (0.26, 0.97), (0.0, 1.0)]
    mound.add(k.lathe(k.paint("#e2b84a"), prof, 0, 0, 0, 24))
    mound.scale.set(29.5, 8, 12.5)
    g.add(mound)
    return g


def industry_quarry(k):
    """
    The quarry yard: cut stone blocks stepping up to a rock face about 50 high along the far side (x 120-200, z 95-114),
    and a little tool shed at x 30, z 100 (slot "roof") with a pick and a barrow of stone by it.
    """
    g = Node()
    greys = ("#b9b7b0", "#a7a59d", "#c6c3ba", "#9d9a92")
    i = 0
    # Three tiers, each set back from the one below, of blocks a hair apart.
    for z0, h, xs in ((95, 18, (120, 146, 172)), (101, 34, (124, 150, 176)), (107, 50, (128, 152, 176))):
        y0 = 0 if z0 == 95 else (18 if z0 == 101 else 34)
        for x in xs:
            w = 25 if x < 176 else 200 - x
            g.add(k.box(k.paint(greys[i % 4]), w - 1, (h - y0) - 0.6, 114 - z0 - 0.6, 1.8, x + w / 2, PAD + y0, (z0 + 114) / 2))
            i += 1
    # A few loose blocks at the foot of the face.
    for x, z, a in ((134, 90, 0.2), (184, 89, -0.3)):
        b = Node()
        b.add(k.box(k.paint(greys[(int(x) // 7) % 4]), 10, 7, 8, 1.6, 0, 0, 0))
        b.rotation.y = a
        b.position.set(x, PAD, z)
        g.add(b)
    # The tool shed.
    sx, sz, w, d, h = 30, 100, 24, 18, 18
    g.add(k.box(k.wood, w, h, d, 2.2, sx, PAD, sz))
    g.add(k.roof(k.paint(slot("roof")), w + 5, d + 5, 9, sx, PAD + h - 0.5, sz, 2.8))
    g.add(k.box(k.paint("#9a4a2c"), 8, 13, 1.6, 0.8, sx - 4, PAD, sz - d / 2 - 0.4))
    # A pick leaning on the shed, and a barrow of stone.
    pick = Node()
    pick.add(k.cyl(k.paint("#c99a5b"), 0.9, 15, 0, 0, 0, None, 10))
    head = Node()
    head.add(k.box(k.metal, 9, 1.8, 1.8, 0.6, 0, -0.9, 0))
    head.position.set(0, 15, 0)
    pick.add(head)
    pick.rotation.x = 0.3
    pick.position.set(sx + 9, PAD, sz - d / 2 - 4)
    g.add(pick)
    g.add(k.box(k.paint(RED), 12, 5, 8, 1.4, 52, PAD + 3, 96))
    g.add(k.cylZ(k.paint(DARK), 2.6, 2, 58, PAD + 2.6, 96, 14))
    for x, z in ((49, 94), (54, 98), (51, 98.5)):
        g.add(k.box(k.paint(greys[0]), 4, 3, 3.6, 1, x, PAD + 8, z))
    return g


def industry_warehouse(k):
    """
    The warehouse: a long beech goods shed (120 x 28, walls 32 high) at x 130, z 100 under a solid roof (slot "roof"),
    three big doors facing the track (slot "doors") with cream lintels, printed windows between them, a name board.
    """
    from bldg_parts import winZ

    g = Node()
    x, z, w, d, h = 130, 100, 120, 28, 32
    front = z - d / 2
    g.add(k.box(k.wood, w, h, d, 3, x, PAD, z))
    g.add(k.roof(k.paint(slot("roof")), w + 5, d + 6, 13, x, PAD + h - 0.5, z, 3.5))
    for dx in (-38, 0, 38):
        g.add(k.box(k.paint(slot("doors")), 20, 24, 1.6, 1, x + dx, PAD, front - 0.4))
        g.add(k.box(k.paint(CREAM), 23, 2.4, 2.2, 0.8, x + dx, PAD + 24.2, front - 0.4))
        g.add(k.box(k.paint(CREAM), 1.4, 22, 0.8, 0.3, x + dx, PAD + 1, front - 1.3))
    for dx in (-19, 19):
        g.add(winZ(k, x + dx, PAD + 14, front, 9, 9))
    for dx in (-55, 55):
        g.add(winZ(k, x + dx, PAD + 14, front, 6, 9))
    g.add(k.box(k.paint(CREAM), 40, 7, 2, 1, x, PAD + h - 6, front - 0.6))
    return g


def load_stone_block(k):
    """A cut stone block, 14 (x) by 8 high by 9 (z), light grey with soft corners; centred on its footprint, base y 0."""
    g = Node()
    g.add(k.box(k.paint("#bdbab2"), 14, 8, 9, 1.8, 0, 0, 0))
    return g


def load_stone_heap(k):
    """
    A heap of grey rubble for a hopper's bin (the grain heap's mound, 59 x 25, 8 high, with chunky stones on it);
    centred on its footprint, its base on y = 0: scale it in y by how full the hopper is.
    """
    g = Node()
    mound = Node()
    prof = [(0.0, 0), (1.0, 0), (0.98, 0.18), (0.9, 0.42), (0.74, 0.68), (0.52, 0.86), (0.26, 0.97), (0.0, 1.0)]
    mound.add(k.lathe(k.paint("#a3a098"), prof, 0, 0, 0, 24))
    mound.scale.set(29.5, 6.5, 12.5)
    g.add(mound)
    greys = ("#bdbab2", "#9d9a92", "#b0ada5", "#c8c5bd")
    import random

    rnd = random.Random(11)
    for i in range(16):
        u, v = rnd.uniform(-0.85, 0.85), rnd.uniform(-0.8, 0.8)
        if u * u + v * v > 0.8:
            continue
        rr = math.sqrt(u * u + v * v)
        top = 6.5 * (1 - rr * rr * 0.9)
        st = Node()
        sz = rnd.uniform(3.4, 5.2)
        st.add(k.box(k.paint(greys[i % 4]), sz, sz * 0.7, sz * 0.85, 0.7, 0, -sz * 0.35, 0, seg=1))
        st.rotation.y = rnd.uniform(0, math.pi)
        st.rotation.x = rnd.uniform(-0.3, 0.3)
        st.position.set(u * 29.5, top, v * 12.5)
        g.add(st)
    return g


PARTS = [
    ("door", door),
    ("flower-box", flower_box),
    ("chimney-top", chimney_top),
    ("canopy-post-62", canopy_post(62)),
    ("canopy-post-76", canopy_post(76)),
    ("station-clock", station_clock),
    ("station-bench", station_bench),
    ("peg-doll", peg_doll(False)),
    ("peg-doll-hat", peg_doll(True)),
    ("conductor", conductor),
    ("porter", porter),
    ("traveller", traveller),
    ("shed-door", shed_door),
    ("shed-window", shed_window),
    ("lamp", street_lamp),
    ("bench", street_bench),
    ("planter", planter),
    ("postbox", postbox),
    ("phone", phone_box),
    ("busstop", bus_stop),
    ("fountain", fountain),
    ("statue", statue),
    ("industry-workshop", industry_workshop),
    ("industry-sawmill-shed", industry_sawmill_shed),
    ("industry-saw-blade", industry_saw_blade),
    ("industry-forest-hut", industry_forest_hut),
    ("industry-farm", industry_farm),
    ("industry-mill", industry_mill),
    ("industry-mill-sails", industry_mill_sails),
    ("load-flour-sack", load_flour_sack),
    ("load-grain-heap", load_grain_heap),
    ("industry-quarry", industry_quarry),
    ("industry-warehouse", industry_warehouse),
    ("load-stone-block", load_stone_block),
    ("load-stone-heap", load_stone_heap),
]


# Parts on every house: built lean (see kit.Kit), as a map has hundreds of them.
LEAN = {"door", "flower-box", "chimney-top"}


def main():
    toy.reset()
    only = set(filter(None, os.environ.get("ONLY", "").split(",")))
    for i, (name, build) in enumerate(PARTS):
        if only and name not in only:
            continue
        toy.begin()
        root = build(kit.Kit(lean=name in LEAN))
        pivots = kit.realize(root, name)
        toy.finish(name, (i % 8 * 60, -(i // 8) * 60, 0), pivots)
    print(f"{len(PARTS)} parts")
    if not os.environ.get("NOEXPORT"):
        toy.save_and_export("dressing")


main()
