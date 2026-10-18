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

Writes tools/blender/dressing.blend and tools/blender/out/dressing.glb (one node per part, named by it); with SET=industry,
Game mode's parts (see `game_only`) into industry.blend and out/industry.glb instead.
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
    The warehouse, in the goods-shed kit's look (bldg_works.goods_shed): a brown timber shed (90 x 40, walls 38 high)
    with a red roof at x 154, z 92, its loading dock (100 x 18, 12 high) along the track side (-z) with crates and
    sacks on it, a cream sliding door and a yellow hand crane at the dock's far end reaching toward the track. It stands
    on the far half of the yard, clear of the piles (x 24-92) and the jib crane (x 60).
    """
    from bldg_parts import WIN, crate, house, sack, winX

    s = Node()
    # The goods shed in its own frame, turned so the dock faces -z (the kit's is on +z).
    s.add(house(k, 90, 40, 38, k.paint(TOY.brown), TOY.red, 14))
    s.add(winX(k, 45, 22, 0, 10, 10), winX(k, -45, 22, 0, 10, 10))
    s.add(k.box(k.paint(WIN), 34, 28, 1, 0.3, 0, 0, -20.2))
    s.add(k.box(k.paint(TOY.cream), 34, 28, 2, 0.6, 0, 0, -21.8), k.box(k.paint(TOY.red), 2, 26, 2.6, 0.3, 0, 1, -21.8))
    s.add(k.box(k.paint(TOY.cream), 80, 2, 3, 0.4, 0, 29, -21.5))
    s.add(k.box(k.wood, 100, 12, 18, 1.2, 0, 0, -30))
    s.add(crate(k, -38, 12, -30), crate(k, -28, 12, -33, 8, TOY.blue), crate(k, -36, 21, -31, 7, TOY.red))
    s.add(sack(k, 24, 12, -32), sack(k, 31, 12, -30), sack(k, 27, 18, -31))
    crane = Node()
    crane.add(k.cyl(k.paint(TOY.yellow), 2.4, 30, 0, 0, 0, 2, 12))
    jib = k.box(k.paint(TOY.yellow), 28, 2.4, 2.4, 0.5, 12, 26, 0)
    jib.rotation.z = 0.25
    crane.add(jib, k.cyl(k.paint(TOY.black), 0.4, 14, 25, 15, 0, 0.4, 6), k.box(k.paint(TOY.black), 3, 3, 3, 0.5, 25, 12, 0))
    # (Its jib swung a quarter turn from along the dock to out over the track side.)
    s.add(k.at(crane, 45, 12, -32, math.pi / 2))
    g = Node()
    g.add(k.at(s, 154, PAD, 92))
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


# ——— Industry upgrades (Game mode): a machine that appears in a yard once its upgrade is learned ———
#
# Each centred on its own footprint, its base on y = 0 (stand it on the pad: y 4), in the depot's frame: +x along the
# track, the track side toward -z. All static (the code places them with the yard's other parts).

YELLOW = "#e6b52c"
IRON_GREY = "#6d7178"
BRICK = "#a8553a"


def _log(k, length, r, x, y, z, ry=0):
    """A log lying along x (turned by ry): beech with a darker end grain ring at each end."""
    g = Node()
    g.add(k.cylX(k.wood, r, length, 0, 0, 0, 20))
    for e in (-1, 1):
        g.add(k.cylX(k.paint("#a87b4f"), r * 0.72, 0.8, e * (length / 2 + 0.1), 0, 0, 16))
    g.rotation.y = ry
    g.position.set(x, y, z)
    return g


def upgrade_log_loader(k):
    """
    Harvesters II: a log loader. A yellow base and post with a red boom reaching out toward the track, a grab hanging
    from its tip holding a log. About 46 x 18, 34 high.
    """
    g = Node()
    g.add(k.box(k.paint(YELLOW), 16, 6, 16, 2, -12, 0, 0))
    g.add(k.cyl(k.paint(YELLOW), 3, 24, -12, 6, 0, 2.6, 20))
    g.add(k.box(k.paint(DARK), 7, 6, 7, 1.4, -12, 28, 0))
    boom = Node()
    boom.add(k.box(k.paint(RED), 34, 4, 4, 1.2, 15, -2, 0))
    boom.rotation.z = -0.32
    boom.position.set(-12, 31, 0)
    g.add(boom)
    tip_x, tip_y = -12 + 32 * math.cos(0.32), 31 - 32 * math.sin(0.32)
    g.add(k.cyl(k.paint(DARK), 0.5, 7, tip_x, tip_y - 7, 0, 0.5, 6))
    for s in (-1, 1):
        claw = Node()
        claw.add(k.box(k.paint(IRON_GREY), 1.6, 8, 3, 0.5, 0, -8, 0))
        claw.rotation.x = s * 0.45
        claw.position.set(tip_x, tip_y - 7, 0)
        g.add(claw)
    g.add(_log(k, 22, 2.6, tip_x, tip_y - 14, 0))
    return g


def upgrade_steam_log_crane(k):
    """
    Harvesters III: a steam log crane. A turntable platform with an upright green boiler and black chimney, a cab, and
    a long lattice boom reaching out with a hook and a log. About 64 x 26, 52 high.
    """
    g = Node()
    g.add(k.cyl(k.paint(DARK), 13, 3, -18, 0, 0, 13, 32))
    g.add(k.box(k.paint("#1f4a2e"), 26, 14, 22, 2.2, -20, 3, 0))
    g.add(k.box(k.paint(RED), 27, 2, 23, 0.8, -20, 17, 0))
    g.add(k.cyl(k.paint("#1f4a2e"), 6, 16, -28, 19, 0, 6, 24))
    g.add(k.cyl(k.paint(DARK), 2.4, 16, -28, 35, 0, 3, 16))
    g.add(k.box(k.paint(YELLOW), 12, 14, 18, 1.6, -14, 19, 0))
    g.add(k.box(k.paint(DARK), 14, 2, 20, 0.8, -14, 33, 0))
    boom = Node()
    for s in (-1, 1):
        boom.add(k.box(k.paint(RED), 48, 2.4, 2.4, 0.8, 24, 0, s * 3.4))
    for i in range(6):
        boom.add(k.box(k.paint(RED), 1.6, 2, 7, 0.4, 4 + i * 8, 0, 0))
    boom.rotation.z = 0.42
    boom.position.set(-8, 22, 0)
    g.add(boom)
    tip_x, tip_y = -8 + 46 * math.cos(0.42), 22 + 46 * math.sin(0.42)
    g.add(k.cyl(k.paint(DARK), 0.5, 24, tip_x, tip_y - 24, 0, 0.5, 6))
    g.add(k.box(k.paint(IRON_GREY), 4, 3, 4, 0.8, tip_x, tip_y - 27, 0))
    g.add(_log(k, 24, 3, tip_x, tip_y - 30.5, 0))
    return g


def upgrade_saw_bench(k):
    """Sawmills II: a second saw bench, as the first: a beech block, cream top, a blade standing in its slot, red stops,
    and a plank waiting on it. About 40 x 22, 22 high."""
    g = Node()
    g.add(k.box(k.wood, 40, 12, 22, 2.4, 0, 0, 0))
    g.add(k.box(k.paint(CREAM), 40, 1.6, 22, 0.7, 0, 11.4, 0))
    g.add(k.box(k.paint(DARK), 22, 0.6, 2.6, 0.25, 0, 12.8, 0))
    blade = Node()
    blade.add(k.cylZ(k.metal, 9, 1.4, 0, 0, 0, 28))
    blade.add(k.cylZ(k.paint(RED), 2.6, 2.6, 0, 0, 0, 16))
    blade.position.set(4, 13, 0)
    g.add(blade)
    for x in (-16, 16):
        g.add(k.box(k.paint(RED), 3.4, 3.4, 3.4, 0.9, x, 13, -8))
    g.add(k.box(k.wood, 18, 1.8, 6, 0.6, -10, 13, 5))
    return g


def upgrade_steam_saw_house(k):
    """
    Sawmills III: a steam saw house. A beech shed with a red roof and a tall brick chimney, a big red flywheel at its
    +x end driving a saw bench beside it by a dark belt. About 70 x 34, 58 high to the chimney top.
    """
    g = Node()
    x, w, d, h = -12, 40, 30, 22
    g.add(k.box(k.wood, w, h, d, 2.6, x, 0, 0))
    g.add(k.roof(k.paint(RED), w + 5, d + 5, 11, x, h - 0.5, 0, 3))
    g.add(k.box(k.paint("#9a4a2c"), 10, 15, 1.6, 0.8, x - 6, 0, -d / 2 - 0.4))
    g.add(k.box(k.paint(DARK), 8, 8, 1.4, 0.8, x + 9, 7, -d / 2 - 0.3))
    g.add(k.cyl(k.paint(BRICK), 4, 42, x - 10, 0, d / 2 - 6, 3.4, 20))
    g.add(k.cyl(k.paint(DARK), 4.2, 2.4, x - 10, 42, d / 2 - 6, 4.2, 20))
    # Flywheel on the end wall, belt to the saw.
    g.add(k.cylX(k.paint(RED), 9, 2.4, x + w / 2 + 1.6, 12, -4, 32))
    g.add(k.cylX(k.paint(DARK), 2.6, 4, x + w / 2 + 1.6, 12, -4, 16))
    bx = x + w / 2 + 14
    g.add(k.box(k.wood, 18, 10, 14, 1.6, bx, 0, -4))
    g.add(k.box(k.paint(CREAM), 18, 1.2, 14, 0.5, bx, 9.6, -4))
    sb = Node()
    sb.add(k.cylX(k.metal, 6.5, 1.2, 0, 0, 0, 24))
    sb.position.set(bx, 11, -4)
    sb.rotation.y = math.pi / 2
    g.add(sb)
    for y in (21, 3):
        belt = Node()
        belt.add(k.box(k.paint(DARK), 14, 0.8, 2, 0.3, 0, 0, 0))
        belt.rotation.z = (11 - y) / 30
        belt.position.set(x + w / 2 + 8, (y + 11) / 2 + (y - 12) * 0.2, -4)
        g.add(belt)
    return g


def upgrade_tractor(k):
    """Farming II: a toy tractor facing +x. A red body and bonnet, big black rear wheels with yellow hubs, small front
    wheels, a seat and steering wheel, and an exhaust stack. About 26 x 18, 19 high."""
    g = Node()
    red = k.paint(RED)
    g.add(k.box(red, 14, 7, 10, 2, 4, 5, 0))
    g.add(k.box(red, 10, 8, 12, 2, -6, 5, 0))
    g.add(k.box(k.paint(DARK), 6, 1.6, 7, 0.6, -7, 13, 0))
    g.add(k.box(k.paint(DARK), 2, 5, 6, 0.6, -10, 13, 0))
    g.add(k.cyl(k.paint(DARK), 0.5, 5, -1, 13, 0, 0.5, 8))
    g.add(k.cylZ(k.paint(DARK), 2.6, 0.8, -0.4, 17.5, 0, 16))
    g.add(k.cyl(k.paint(DARK), 0.9, 8, 8, 12, -2.5, 0.9, 10))
    for s in (-1, 1):
        g.add(k.cylZ(k.paint(DARK), 6.5, 4, -6, 6.5, s * 8, 24))
        g.add(k.cylZ(k.paint(YELLOW), 3, 4.6, -6, 6.5, s * 8, 16))
        g.add(k.cylZ(k.paint(DARK), 3.6, 3, 7, 3.6, s * 6.5, 20))
        g.add(k.cylZ(k.paint(YELLOW), 1.6, 3.4, 7, 3.6, s * 6.5, 12))
    g.add(k.box(k.paint(CREAM), 1.2, 3, 6, 0.4, 11.2, 7, 0))
    return g


def upgrade_millstones(k):
    """
    Mills II: a second pair of millstones under a hopper. A beech frame carrying two grey stones, a wooden hopper
    above feeding them, a chute and a sack catching the flour. About 30 x 24, 34 high.
    """
    g = Node()
    for x in (-10, 10):
        for z in (-8, 8):
            g.add(k.box(k.wood, 3, 14, 3, 0.8, x, 0, z))
    g.add(k.box(k.wood, 26, 3, 22, 1.2, 0, 14, 0))
    g.add(k.cyl(k.paint("#b9b7b0"), 10, 4, 0, 17, 0, 10, 32))
    g.add(k.cyl(k.paint("#a3a098"), 10, 4, 0, 21.2, 0, 10, 32))
    g.add(k.cyl(k.paint(DARK), 1.6, 1.2, 0, 25, 0, 1.6, 12))
    g.add(k.lathe(k.wood, [(0.0, 0), (1.6, 0), (9, 10), (9, 11), (0.0, 11)], 0, 25, 0, 4))
    g.add(k.lathe(k.paint("#e2b84a"), [(0.0, 0), (8, 0), (6, 1.2), (0.0, 1.8)], 0, 35.2, 0, 4))
    chute = Node()
    chute.add(k.box(k.wood, 3, 1.4, 10, 0.4, 0, 0, -5))
    chute.rotation.x = 0.5
    chute.position.set(0, 16, -11)
    g.add(chute)
    g.add(k.box(k.paint("#f3ead8"), 7, 8, 6, 2.2, 0, 0, -18))
    g.add(k.box(k.paint("#2f6db5"), 7.2, 1.8, 6.2, 0.6, 0, 3, -18, seg=1))
    return g


def upgrade_stone_crusher(k):
    """
    Quarries II: a stone crusher. A grey hopper on top of an iron jaw box with a big red flywheel at its side, on legs,
    and a short chute dropping gravel toward the track. About 40 x 30, 42 high.
    """
    g = Node()
    for x in (-10, 10):
        for z in (-8, 8):
            g.add(k.box(k.paint(DARK), 3, 12, 3, 0.8, x, 0, z))
    g.add(k.box(k.paint(IRON_GREY), 26, 14, 20, 2.4, 0, 12, 0))
    for z in (-10.6, 10.6):
        g.add(k.box(k.paint(DARK), 20, 1.4, 1.2, 0.4, 0, 18, z))
    g.add(k.lathe(k.paint("#a7a59d"), [(0.0, 0), (6, 0), (16, 14), (16, 16), (0.0, 16)], 0, 26, 0, 4))
    for i, (x, z) in enumerate(((-4, 2), (3, -3), (5, 4), (-2, -5))):
        g.add(k.box(k.paint(("#bdbab2", "#9d9a92")[i % 2]), 4, 3, 4, 1, x, 40.5, z, seg=1))
    g.add(k.cylX(k.paint(RED), 10, 2.4, 14.6, 19, 0, 32))
    g.add(k.cylX(k.paint(DARK), 2.6, 4, 14.6, 19, 0, 16))
    chute = Node()
    chute.add(k.box(k.paint(IRON_GREY), 8, 1.6, 14, 0.5, 0, 0, -7))
    chute.rotation.x = 0.55
    chute.position.set(0, 12, -10)
    g.add(chute)
    for x, z in ((-3, -22), (2, -21), (0, -24)):
        g.add(k.box(k.paint("#a7a59d"), 3, 2, 3, 0.8, x, 0, z, seg=1))
    return g


# ——— Phase C: mining and iron ———

ROCK = ("#9d9a92", "#b0ada5", "#8f8b83")
RUST = ("#8a4a2c", "#a0593a", "#7a3f26")
IRON_BAR = "#8d9096"


def _arch(w, h):
    """An arch outline w wide and h high at the crown (x/y, its base on y = 0)."""
    r = w / 2
    pts = [(-r, 0), (r, 0), (r, h - r)]
    for i in range(1, 12):
        a = math.pi * i / 12
        pts.append((r * math.cos(a), h - r + r * math.sin(a)))
    pts.append((-r, h - r))
    return pts


def industry_mine(k):
    """
    The mine: a rocky hill at the far end (x 150-206, z 60-114) with a timbered tunnel mouth facing the yard and rails
    running out of it, a red winding tower (its wheel is a part of its own, "industry-mine-wheel": hub at x 112,
    y 66, z 96, turning on z), and a brick engine house with a tall chimney at x 72, z 100.
    """
    g = Node()
    # The hill: rock blocks stepping up, grass on top.
    for x0, x1, z0, h, c in ((150, 206, 60, 22, 0), (158, 206, 72, 36, 1), (170, 206, 86, 48, 2)):
        g.add(k.box(k.paint(ROCK[c]), x1 - x0, h, 114 - z0, 4, (x0 + x1) / 2, PAD, (z0 + 114) / 2))
    g.add(k.box(k.paint("#5d8a45"), 36, 3, 28, 1.5, 188, PAD + 48, 100))
    # The tunnel mouth on the hill's front (-x) face, framed in timber, rails running out across the yard.
    portal = Node()
    portal.add(k.extrude(k.paint("#c6c3ba"), _arch(26, 26), 3, 0, 0, 0, 0.8))
    portal.add(k.extrude(k.paint("#1c1c1f"), _arch(18, 19), 3.6, 0, 0, 0.2, 0.4))
    portal.rotation.y = math.pi / 2
    portal.position.set(150, PAD, 86)
    g.add(portal)
    for dz in (-10.5, 10.5):
        g.add(k.box(k.wood, 3, 21, 3, 0.8, 147.5, PAD, 86 + dz))
    g.add(k.box(k.wood, 3, 3, 26, 0.8, 147.5, PAD + 21, 86))
    for dz in (-4, 4):
        g.add(k.box(k.metal, 46, 1.2, 1.2, 0.3, 127, PAD, 86 + dz, seg=1))
    for x in range(108, 150, 7):
        g.add(k.box(k.wood, 2.4, 0.8, 12, 0.3, x, PAD, 86, seg=1))
    # A little tub of ore on the rails.
    g.add(k.box(k.paint(DARK), 10, 6, 8, 1.4, 128, PAD + 2, 86))
    for i, (dx, dz) in enumerate(((-2.5, -1.5), (2, 1.5), (0, -2), (-1, 2))):
        g.add(k.box(k.paint(RUST[i % 3]), 3.2, 2.6, 3, 0.8, 128 + dx, PAD + 8, 86 + dz, seg=1))
    # The winding tower: four red legs leaning in, cross braces, a platform, a back stay toward the engine house.
    red = k.paint(RED)
    tx, tz, top = 112, 96, PAD + 62
    for sx in (-1, 1):
        for sz in (-1, 1):
            leg = Node()
            leg.add(k.box(red, 2.6, 60, 2.6, 0.8, 0, 0, 0))
            # Leaning in: each leg's top 6 in from its foot.
            leg.rotation.z = sx * 0.1
            leg.rotation.x = -sz * 0.1
            leg.position.set(tx + sx * 9, PAD, tz + sz * 9)
            g.add(leg)
    for y in (20, 40):
        g.add(k.box(red, 18 - y * 0.18, 1.6, 1.6, 0.4, tx, PAD + y, tz - 9 + y * 0.1))
        g.add(k.box(red, 18 - y * 0.18, 1.6, 1.6, 0.4, tx, PAD + y, tz + 9 - y * 0.1))
    g.add(k.box(k.wood, 12, 2, 12, 0.6, tx, top - 2, tz))
    stay = Node()
    stay.add(k.box(red, 2.4, 52, 2.4, 0.6, 0, 0, 0))
    stay.rotation.z = 0.62
    stay.position.set(tx - 2 + 30, PAD, tz)
    g.add(stay)
    g.add(k.cyl(k.paint(DARK), 0.5, 52, tx, PAD + 10, tz - 4, 0.5, 6))
    # The engine house.
    ex, ez = 72, 100
    g.add(k.box(k.paint(BRICK), 26, 22, 22, 2.4, ex, PAD, ez))
    g.add(k.roof(k.paint(DARK), 30, 26, 10, ex, PAD + 21.5, ez, 3))
    g.add(k.box(k.paint("#9a4a2c"), 8, 13, 1.6, 0.8, ex - 5, PAD, ez - 11.4))
    g.add(k.box(k.paint(DARK), 6, 6, 1.4, 0.8, ex + 6, PAD + 8, ez - 11.3))
    g.add(k.cyl(k.paint(BRICK), 4.2, 52, ex - 8, PAD, ez + 8, 3.4, 20))
    g.add(k.cyl(k.paint(DARK), 4.2, 2.4, ex - 8, PAD + 52, ez + 8, 4.2, 20))
    return g


def industry_mine_wheel(k):
    """The winding tower's wheel: 22 across with four spokes and a hub, in the x/y plane, its hub at the origin (turn
    it on z)."""
    g = Node()
    g.add(k.extrude(k.paint(DARK), [(11 * math.cos(2 * math.pi * i / 32), 11 * math.sin(2 * math.pi * i / 32)) for i in range(32)], 2.4, 0, 0, 0, 0.5))
    g.add(k.extrude(k.paint("#e9e2d4"), [(8.6 * math.cos(2 * math.pi * i / 32), 8.6 * math.sin(2 * math.pi * i / 32)) for i in range(32)], 2.8, 0, 0, 0, 0.4))
    for i in range(4):
        sp = Node()
        sp.add(k.box(k.paint(RED), 1.6, 17, 1.6, 0.4, 0, -8.5, 0))
        sp.rotation.z = i * math.pi / 4
        g.add(sp)
    g.add(k.cylZ(k.paint(RED), 2.6, 4, 0, 0, 0, 16))
    return g


def industry_foundry(k):
    """
    The foundry: a brick furnace (x 166, z 88) glowing orange at its mouth, its tall chimney behind it; an open
    casting shed (x 70-126, z 80-112) over rows of iron moulds; and a ladle on a little cart by the yard's front at
    x 140, z 44, on a short length of rail.
    """
    g = Node()
    brick = k.paint(BRICK)
    fx, fz = 166, 88
    g.add(k.cyl(brick, 17, 34, fx, PAD, fz, 13, 32))
    g.add(k.cyl(k.paint(DARK), 14, 3, fx, PAD + 34, fz, 13, 32))
    mouth = Node()
    mouth.add(k.extrude(k.paint(DARK), _arch(14, 15), 3, 0, 0, 0, 0.6))
    mouth.add(k.extrude(k.paint("#ff8a2a"), _arch(10, 11), 1.2, 0, 0.6, -1.6, 0.3))
    mouth.position.set(fx, PAD, fz - 16)
    g.add(mouth)
    g.add(k.cyl(brick, 6, 66, fx + 18, PAD, fz + 14, 4.6, 24))
    g.add(k.cyl(k.paint(DARK), 5, 3, fx + 18, PAD + 66, fz + 14, 5, 24))
    # Coal and ore waiting by the furnace.
    for i, (dx, dz, c) in enumerate(((-26, -6, DARK), (-24, 4, RUST[0]), (-30, 0, RUST[1]))):
        g.add(k.box(k.paint(c), 6, 4, 6, 1.2, fx + dx, PAD, fz + dz, seg=1))
    # The casting shed: posts and a red roof, open on every side, iron moulds in rows under it.
    for x in (72, 98, 124):
        for z in (82, 110):
            g.add(k.box(k.paint(SHED_POST), 3.6, 26, 3.6, 1, x, PAD, z))
    g.add(k.roof(k.paint(RED), 62, 38, 11, 98, PAD + 25.5, 96, 3))
    for x in (80, 92, 104, 116):
        for z in (90, 102):
            g.add(k.box(k.paint(DARK), 9, 3, 8, 1, x, PAD, z))
            g.add(k.box(k.paint(IRON_BAR), 6.4, 0.8, 5, 0.4, x, PAD + 2.6, z, seg=1))
    # The ladle on its cart and rails.
    for dz in (-4, 4):
        g.add(k.box(k.metal, 30, 1.2, 1.2, 0.3, 140, PAD, 44 + dz, seg=1))
    g.add(k.box(k.paint(DARK), 14, 4, 10, 1.2, 140, PAD + 3, 44))
    for dx in (-4.5, 4.5):
        for dz in (-4, 4):
            g.add(k.cylZ(k.paint(RED), 2.2, 1.6, 140 + dx, PAD + 2.4, 44 + dz, 14))
    ladle = Node()
    ladle.add(k.cyl(k.paint(IRON_BAR), 5.6, 9, 0, 0, 0, 7, 24))
    ladle.add(k.cyl(k.paint("#ff8a2a"), 6.4, 0.8, 0, 8.6, 0, 6.4, 24))
    ladle.rotation.x = -0.25
    ladle.position.set(140, PAD + 7, 44)
    g.add(ladle)
    return g


def load_coal(k):
    """A unit of coal, 14 (x) by 6 high by 9 (z): a soft black block with chunky lumps set in its sides, flat on top so
    units stack; centred on its footprint, its base on y = 0."""
    g = Node()
    g.add(k.box("coal", 14, 6, 9, 1.6, 0, 0, 0))
    for x, y, z in ((-4, 2, 4.4), (3, 3.4, 4.4), (-1, 1.6, -4.4), (5, 2.6, -4.4), (6.8, 2.4, 1), (-6.8, 3.2, -1)):
        g.add(k.box("coal", 3.2, 2.6, 2.4, 0.6, x, y, z, seg=1))
    return g


def load_ore(k):
    """A unit of iron ore, 14 (x) by 6 high by 9 (z): a rusty red-brown block of rock with darker and lighter chunks
    set in its sides; flat on top so units stack; centred on its footprint, its base on y = 0."""
    g = Node()
    g.add(k.box(k.paint(RUST[0]), 14, 6, 9, 1.8, 0, 0, 0))
    for i, (x, y, z) in enumerate(((-4, 2, 4.4), (3, 3.2, 4.4), (-1, 1.8, -4.4), (5, 2.6, -4.4), (6.8, 2.4, 1), (-6.8, 3, -1))):
        g.add(k.box(k.paint(RUST[1 + i % 2]), 3.4, 2.8, 2.6, 0.7, x, y, z, seg=1))
    return g


def load_iron(k):
    """A bundle of iron ingots (a planks bundle's size: 32 (x) by 7.5 high by 12 (z)): six grey bars in two layers,
    strapped twice in dark iron; centred on its footprint, its base on y = 0."""
    g = Node()
    bar = k.paint(IRON_BAR)
    for layer in range(2):
        for i in range(3):
            g.add(k.box(bar, 31 - layer * 1.5, 3.5, 3.7, 1, 0, layer * 3.7, (i - 1) * 4))
    for x in (-9, 9):
        g.add(k.box(k.paint(DARK), 1.6, 7.7, 12.2, 0.5, x, -0.1, 0))
    return g


def _heap(k, g, base, lumps, seed):
    """A low mound fitting a hopper's bin top (59 x 25, about 8 high) with chunky lumps on it."""
    import random

    mound = Node()
    prof = [(0.0, 0), (1.0, 0), (0.98, 0.18), (0.9, 0.42), (0.74, 0.68), (0.52, 0.86), (0.26, 0.97), (0.0, 1.0)]
    mound.add(k.lathe(base, prof, 0, 0, 0, 24))
    mound.scale.set(29.5, 6.5, 12.5)
    g.add(mound)
    rnd = random.Random(seed)
    for i in range(16):
        u, v = rnd.uniform(-0.85, 0.85), rnd.uniform(-0.8, 0.8)
        if u * u + v * v > 0.8:
            continue
        rr = math.sqrt(u * u + v * v)
        st = Node()
        sz = rnd.uniform(3.4, 5.2)
        st.add(k.box(lumps[i % len(lumps)], sz, sz * 0.7, sz * 0.85, 0.7, 0, -sz * 0.35, 0, seg=1))
        st.rotation.y = rnd.uniform(0, math.pi)
        st.rotation.x = rnd.uniform(-0.3, 0.3)
        st.position.set(u * 29.5, 6.5 * (1 - rr * rr * 0.9), v * 12.5)
        g.add(st)
    return g


def load_coal_heap(k):
    """A heap of coal for a hopper's bin (the grain heap's 59 x 25 mound, black, lumpy); base on y = 0, scale y by how
    full the hopper is."""
    return _heap(k, Node(), "coal", ["coal"], 5)


def load_ore_heap(k):
    """A heap of iron ore for a hopper's bin (rusty red-brown rocks); base on y = 0, scale y by how full."""
    return _heap(k, Node(), k.paint(RUST[0]), [k.paint(c) for c in RUST], 9)


# ——— Phase C, second batch: furniture, tools and power ———

STONE_GREY = ("#a9a59c", "#b8b4ab", "#9a968d")


def _planks_stack(k, g, x, z, n=4):
    """A stack of n beech boards, 30 long along x, at (x, z) on the pad, with a red strap."""
    for i in range(n):
        g.add(k.box(k.wood, 30, 2, 10, 0.6, x, PAD + i * 2.1, z, seg=1))
    g.add(k.box(k.paint(RED), 1.6, n * 2.1 + 0.4, 10.4, 0.4, x, PAD - 0.1, z, seg=1))


def industry_carpenter(k):
    """
    The carpenter's yard: a beech workshop (x 126-194, z 74-110) under a saw-tooth roof of four red teeth with skylights
    facing the track side, a big door; stacks of planks at the left of it; a bench in the yard with a half-built chair
    and table.
    """
    g = Node()
    x0, x1, z0, z1, h = 126, 194, 74, 110, 22
    g.add(k.box(k.wood, x1 - x0, h, z1 - z0, 2.4, (x0 + x1) / 2, PAD, (z0 + z1) / 2))
    tooth = (x1 - x0) / 4
    for i in range(4):
        tx = x0 + i * tooth
        t = k.extrude(k.paint(RED), [(0, 0), (tooth, 0), (0, 11)], z1 - z0 + 3, 0, 0, 0, 0.8)
        n = Node()
        n.add(t)
        n.position.set(tx, PAD + h - 0.5, (z0 + z1) / 2)
        g.add(n)
        # The skylight on the tooth's upright face (glass toward -x), seen as a pale band.
        g.add(k.box(k.paint("#a9cfe6"), 1, 8, z1 - z0 - 4, 0.3, tx + 0.6, PAD + h + 1, (z0 + z1) / 2, seg=1))
    g.add(k.box(k.paint("#9a4a2c"), 18, 17, 1.6, 0.8, 150, PAD, z0 - 0.4))
    g.add(k.box(k.paint(CREAM), 21, 2, 2.2, 0.6, 150, PAD + 17, z0 - 0.4))
    for wx in (134, 178):
        g.add(k.box(k.paint("#2b3644"), 9, 8, 1.4, 0.6, wx, PAD + 8, z0 - 0.3))
    for i, z in enumerate((84, 100)):
        _planks_stack(k, g, 104, z, 4 - i)
    # The bench with a half-built chair and table on it.
    bx, bz = 112, 64
    g.add(k.box(k.wood, 24, 2, 10, 0.6, bx, PAD + 8, bz))
    for dx in (-10, 10):
        for dz in (-3.5, 3.5):
            g.add(k.box(k.wood, 1.6, 8, 1.6, 0.4, bx + dx, PAD, bz + dz))
    chair = k.paint("#c99a5b")
    cx = bx - 5
    g.add(k.box(chair, 6, 1, 6, 0.3, cx, PAD + 13.5, bz))
    for dx in (-2.4, 2.4):
        for dz in (-2.4, 2.4):
            g.add(k.box(chair, 1, 3.5, 1, 0.2, cx + dx, PAD + 10, bz + dz))
    g.add(k.box(chair, 1, 6, 6, 0.3, cx - 2.6, PAD + 14.5, bz))
    tx = bx + 5
    g.add(k.box(chair, 8, 1, 7, 0.3, tx, PAD + 14, bz))
    for dx, dz in ((-3.2, -2.6), (3.2, -2.6), (-3.2, 2.6)):
        g.add(k.box(chair, 1, 4, 1, 0.2, tx + dx, PAD + 10, bz + dz))
    g.add(k.box(chair, 1, 1, 4, 0.2, tx + 4, PAD + 10, bz + 5))
    return g


def industry_smithy(k):
    """
    The smithy: a stone forge house (x 150-190, z 80-110) with a dark roof and a tall stone chimney, open at the front
    on its glowing hearth; an anvil on a stump; a rack of tools; a cartwheel leaning by the door.
    """
    g = Node()
    fx, fz, w, d, h = 170, 95, 40, 30, 22
    stone = k.paint(STONE_GREY[0])
    g.add(k.box(stone, w, h, d, 2.6, fx, PAD, fz))
    g.add(k.roof(k.paint(DARK), w + 5, d + 5, 11, fx, PAD + h - 0.5, fz, 3))
    g.add(k.box(k.paint(STONE_GREY[1]), 7, 46, 7, 1.8, fx + 13, PAD, fz + 8))
    g.add(k.box(k.paint(DARK), 8, 2, 8, 0.8, fx + 13, PAD + 46, fz + 8))
    # The hearth: a stone block before the front wall, glowing coals on it, a hood over it.
    hx, hz = fx - 6, fz - d / 2 - 6
    g.add(k.box(k.paint(STONE_GREY[2]), 16, 9, 10, 1.6, hx, PAD, hz))
    g.add(k.box(k.paint("#ff8a2a"), 11, 1.6, 6, 0.6, hx, PAD + 9, hz))
    g.add(k.box(k.paint("#ffcf6b"), 5, 1.2, 3, 0.4, hx, PAD + 10, hz))
    g.add(k.box(k.paint(DARK), 14, 3, 10, 1, hx, PAD + 18, hz + 1))
    g.add(k.box(k.paint(DARK), 6, 4, 6, 0.8, hx, PAD + 21, hz + 3))
    # The anvil on its stump.
    ax, az = 132, 76
    g.add(k.cyl(k.wood, 4.5, 7, ax, PAD, az, 4.8, 18))
    g.add(k.box(k.paint(DARK), 4, 3, 3, 0.6, ax, PAD + 7, az))
    g.add(k.box(k.paint(DARK), 8, 2.4, 4, 0.6, ax, PAD + 10, az))
    horn = Node()
    horn.add(k.cone(k.paint(DARK), 1.4, 4, 0, 0, 0, 12))
    horn.rotation.z = -math.pi / 2
    horn.position.set(ax + 4, PAD + 11.2, az)
    g.add(horn)
    # The tool rack: two posts and a rail, tools hanging from it.
    rx, rz = 196, 72
    for dx in (-8, 8):
        g.add(k.box(k.wood, 1.8, 16, 1.8, 0.4, rx + dx, PAD, rz))
    g.add(k.box(k.wood, 18, 1.6, 1.6, 0.4, rx, PAD + 14, rz))
    for i, dx in enumerate((-5, -1.5, 2, 5.5)):
        g.add(k.box(k.wood, 0.9, 8, 0.9, 0.2, rx + dx, PAD + 6, rz))
        g.add(k.box(k.paint(DARK), 2.6 if i % 2 else 1.6, 1.6 if i % 2 else 3, 1.2, 0.3, rx + dx, PAD + 4.5, rz))
    # A cartwheel leaning by the forge.
    wheel = Node()
    wheel.add(k.cylZ(k.paint(DARK), 9, 1.8, 0, 0, 0, 28))
    wheel.add(k.cylZ(k.wood, 7.6, 2, 0, 0, 0, 28))
    wheel.add(k.cylZ(k.paint(DARK), 2, 3, 0, 0, 0, 14))
    for i in range(6):
        sp = Node()
        sp.add(k.box(k.wood, 1, 7, 1, 0.3, 0, 0, 0))
        sp.rotation.z = i * math.pi / 6
        wheel.add(sp)
    wheel.rotation.x = -0.2
    wheel.position.set(fx - w / 2 - 3, PAD + 9, fz + 6)
    wheel.rotation.y = math.pi / 2
    g.add(wheel)
    return g


def industry_power(k):
    """
    The coal power station: a brick turbine hall (x 124-194, z 80-112) with tall arched windows along its front, two
    tall chimneys behind, a coal bunker on legs at its left heaped with coal; and the engine's flywheel, a part of its
    own ("industry-power-wheel": hub at x 112, y 22, z 72, turning on z) on a stand before the hall.
    """
    g = Node()
    hx, hz, w, d, h = 159, 96, 70, 32, 32
    g.add(k.box(k.paint(BRICK), w, h, d, 2.8, hx, PAD, hz))
    g.add(k.roof(k.paint(DARK), w + 4, d + 4, 8, hx, PAD + h - 0.5, hz, 3))
    front = hz - d / 2
    for wx in range(hx - 28, hx + 29, 14):
        win = Node()
        win.add(k.extrude(k.paint(CREAM), [(-4.6, 0), (4.6, 0), (4.6, 16)] + [(4.6 * math.cos(a), 16 + 4.6 * math.sin(a)) for a in (0.5, 1.0, 1.57, 2.1, 2.6)] + [(-4.6, 16)], 1.0, 0, 0, 0, 0.3))
        win.add(k.extrude(k.paint("#2b3644"), [(-3.4, 0), (3.4, 0), (3.4, 15)] + [(3.4 * math.cos(a), 15 + 3.4 * math.sin(a)) for a in (0.5, 1.0, 1.57, 2.1, 2.6)] + [(-3.4, 15)], 1.4, 0, 0.6, -0.3, 0.2))
        win.position.set(wx, PAD + 6, front - 0.3)
        g.add(win)
    for cx in (140, 176):
        g.add(k.cyl(k.paint(BRICK), 5, 72, cx, PAD, hz + 10, 4, 24))
        g.add(k.cyl(k.paint(CREAM), 5.2, 2.4, cx, PAD + 60, hz + 10, 4.6, 24))
        g.add(k.cyl(k.paint(DARK), 4.4, 2.4, cx, PAD + 72, hz + 10, 4.4, 24))
    # The coal bunker: a dark box on four legs, heaped with coal, a chute into the hall.
    bx, bz = 108, 98
    for dx in (-8, 8):
        for dz in (-8, 8):
            g.add(k.box(k.paint(DARK), 2.4, 16, 2.4, 0.6, bx + dx, PAD, bz + dz))
    g.add(k.box(k.paint(IRON_GREY), 22, 12, 22, 2, bx, PAD + 16, bz))
    g.add(k.box("coal", 19, 2, 19, 0.6, bx, PAD + 27, bz))
    for i, (dx, dz) in enumerate(((-4, -3), (3, 4), (0, 0), (5, -5), (-5, 5))):
        g.add(k.box("coal", 4, 3, 4, 0.8, bx + dx, PAD + 28, bz + dz, seg=1))
    chute = Node()
    chute.add(k.box(k.paint(IRON_GREY), 12, 1.6, 5, 0.5, 6, 0, 0))
    chute.rotation.z = -0.4
    chute.position.set(bx + 10, PAD + 22, bz)
    g.add(chute)
    # The flywheel's stand (the wheel is its own part).
    g.add(k.box(k.paint(DARK), 4, 20, 8, 1, 112, PAD, 76))
    g.add(k.box(k.paint(IRON_GREY), 14, 4, 12, 1.4, 112, PAD, 76))
    return g


def industry_power_wheel(k):
    """The power station's flywheel: 30 across, red with six spokes, in the x/y plane, its hub at the origin (turn on z)."""
    g = Node()
    g.add(k.extrude(k.paint(RED), [(15 * math.cos(2 * math.pi * i / 40), 15 * math.sin(2 * math.pi * i / 40)) for i in range(40)], 3, 0, 0, 0, 0.8))
    g.add(k.extrude(k.paint(DARK), [(12 * math.cos(2 * math.pi * i / 40), 12 * math.sin(2 * math.pi * i / 40)) for i in range(40)], 3.4, 0, 0, 0, 0.4))
    for i in range(6):
        sp = Node()
        sp.add(k.box(k.paint(RED), 2, 24, 2, 0.6, 0, -12, 0))
        sp.rotation.z = i * math.pi / 3
        g.add(sp)
    g.add(k.cylZ(k.paint(CREAM), 3, 5, 0, 0, 0, 18))
    return g


def load_furniture(k):
    """A unit of furniture, sack-sized (14 x 9 high x 9): a slatted beech crate with a chair and a little table inside
    (seen between the slats) and a red strap; flat on top so units stack; centred on its footprint, base y 0."""
    g = Node()
    g.add(k.box(k.paint("#8a5a33"), 12.4, 8, 7.4, 0.8, 0, 0.4, 0))
    for y in (0, 3.2, 6.4):
        for z in (-4.1, 4.1):
            g.add(k.box(k.wood, 14, 2.4, 0.9, 0.3, 0, y, z, seg=1))
        for x in (-6.6, 6.6):
            g.add(k.box(k.wood, 0.9, 2.4, 9, 0.3, x, y, 0, seg=1))
    for x in (-4, 0, 4):
        g.add(k.box(k.wood, 3, 0.9, 9, 0.3, x, 8.1, 0, seg=1))
    g.add(k.box(k.paint(RED), 1.4, 9.2, 9.3, 0.3, 2, -0.1, 0, seg=1))
    return g


def load_tools(k):
    """A unit of tools, sack-sized (14 x 6 x 9): a wooden tool box with a hammer and a saw's handles poking out of it,
    its top flat beside them; centred on its footprint, base y 0."""
    g = Node()
    g.add(k.box(k.wood, 14, 5, 9, 1, 0, 0, 0))
    g.add(k.box(k.paint("#8a5a33"), 12.6, 0.6, 7.6, 0.3, 0, 4.7, 0, seg=1))
    g.add(k.box(k.paint(RED), 14.2, 1, 9.2, 0.3, 0, 1.6, 0, seg=1))
    hammer = Node()
    hammer.add(k.box(k.paint("#c99a5b"), 1, 6, 1, 0.3, 0, 0, 0))
    hammer.add(k.box(k.paint(DARK), 3.4, 1.4, 1.4, 0.4, 0, 6, 0))
    hammer.rotation.z = 0.5
    hammer.position.set(-3, 3.2, -1.5)
    g.add(hammer)
    g.add(k.box(k.paint(RED), 3, 2.6, 1.2, 0.5, 3.5, 4.6, 1.8))
    return g


# ——— Harbours (Game mode) ———

SEA_STONE = ("#c9c3b4", "#b7b1a3", "#d4cebf")
TAR = "#4a3a2c"


def _crate(k, g, x, y, z, s=8, c="#c99a5b", a=0.0):
    """A slatted crate s across, its base at (x, y, z), turned a about y."""
    n = Node()
    n.add(k.box(k.paint(c), s, s * 0.85, s, 0.6, 0, 0, 0, seg=1))
    for dy in (0.15, 0.55):
        n.add(k.box(k.wood, s + 0.4, s * 0.12, s + 0.4, 0.2, 0, s * dy, 0, seg=1))
    n.rotation.y = a
    n.position.set(x, y, z)
    g.add(n)


def industry_harbour(k):
    """
    The harbour: the yard's far side is a quay on the water (its edge at z 112, the water beyond). A stone quay edge
    (x 10-206, z 102-112, its sea face dropping to y -10) with a timber capping and fenders, bollards at x 30, 80, 130
    and 180 on z 110; a little harbour office at the far end (x 175-193, z 89-103, slot "roof"), a barrel and crates by
    it; and the derrick's mast and footing at x 199, z 105 (its jib, the part "industry-harbour-jib", turns on y about
    the mast's top at x 199, y 62, z 105, reaching out over the water toward +z). Clear: the piles' strip (x 15-190,
    z 35-90) and z 90-110 between the bollards, where the dock sheds stand (x 55, 105, 155).
    """
    g = Node()
    # The quay edge: dressed stone blocks along the far side, flush with the pad, the sea face below.
    i = 0
    for x0 in range(10, 206, 28):
        w = min(28, 206 - x0)
        g.add(k.box(k.paint(SEA_STONE[i % 3]), w - 0.6, PAD + 10, 10, 1.6, x0 + w / 2, -10, 107, seg=1))
        i += 1
    # Timber capping along the edge, tarred fenders down its face.
    g.add(k.box(k.wood, 196, 1.4, 3, 0.5, 108, PAD, 110.6, seg=1))
    for x in range(17, 206, 14):
        g.add(k.box(k.paint(TAR), 2.4, 13, 2, 0.6, x, -9, 113, seg=1))
    g.add(k.box(k.paint(TAR), 196, 2, 1.6, 0.5, 108, -1, 114.2, seg=1))
    # Bollards.
    for x in (30, 80, 130, 180):
        g.add(k.cyl(k.paint(DARK), 2.2, 5, x, PAD, 110, 1.8, 10))
        g.add(k.cyl(k.paint(DARK), 2.8, 1.4, x, PAD + 5, 110, 2.8, 10))
    # The harbour office: beech walls, a slot roof, a door and a window to the track side, a name board, a lamp.
    from bldg_parts import winZ

    ox, oz, w, d, h = 184, 96, 18, 14, 18
    front = oz - d / 2
    g.add(k.box(k.wood, w, h, d, 2, ox, PAD, oz))
    g.add(k.roof(k.paint(slot("roof")), w + 4, d + 4, 8, ox, PAD + h - 0.5, oz, 2.4))
    g.add(k.box(k.paint("#2f5d7a"), 6, 12, 1.4, 0.6, ox - 4.5, PAD, front - 0.4))
    g.add(winZ(k, ox + 4.5, PAD + 6, front, 6, 6))
    g.add(k.box(k.paint(CREAM), 14, 3.4, 1.4, 0.6, ox, PAD + h - 3.6, front - 0.5))
    g.add(k.box(k.paint(GOLD), 1.8, 2.4, 1.8, 0.5, ox - 4.5, PAD + 13, front - 1.6))
    g.add(k.cyl(k.paint("#8a5a33"), 3, 8, 198, PAD, 92, 3, 14))
    g.add(k.cyl(k.paint(DARK), 3.2, 0.9, 198, PAD + 1.3, 92, 3.2, 14))
    g.add(k.cyl(k.paint(DARK), 3.2, 0.9, 198, PAD + 5.8, 92, 3.2, 14))
    _crate(k, g, 199, PAD, 82, 8, "#c99a5b", 0.1)
    _crate(k, g, 199, PAD + 6.8, 82, 6, "#d8b07a", 0.5)
    # The derrick: a stone footing, a red mast with a cream cap, a winch at its foot; the jib turns on its top.
    mx, mz = 199, 105
    g.add(k.box(k.paint(SEA_STONE[1]), 10, 3, 10, 1.2, mx, PAD, mz))
    g.add(k.cyl(k.paint(RED), 2.8, 55, mx, PAD + 3, mz, 2.2, 16))
    g.add(k.cyl(k.paint(CREAM), 3.2, 2, mx, PAD + 56, mz, 3.2, 16))
    g.add(k.cylZ(k.paint(DARK), 2, 6, mx, PAD + 7, mz - 6, 12))
    return g


def industry_harbour_jib(k):
    """
    The harbour derrick's jib: turns on y about the origin (the mast's top, x 199, y 62, z 105 in the yard). A red boom
    rising out along +z (reaching 44 out), a counterweight behind the mast, a stay from the mast's top to the boom's tip, a rope hanging from its tip to a hook with a crate.
    """
    g = Node()
    red = k.paint(RED)
    boom = Node()
    boom.add(k.box(red, 2.6, 2.6, 46, 0.8, 0, -1.3, 23))
    boom.rotation.x = -0.18
    boom.position.set(0, -14, 0)
    g.add(boom)
    # Where the boom ends: 46 out along it, lifted by its tilt.
    tz, ty = 46 * math.cos(0.18), -14 + 46 * math.sin(0.18)
    g.add(k.cyl(k.paint(CREAM), 2.6, 2.4, 0, -1.2, 0, 2.6, 14))
    stay = Node()
    length = math.hypot(tz, ty + 1)
    stay.add(k.box(k.paint(DARK), 0.8, 0.8, length, 0.2, 0, -0.4, length / 2, seg=1))
    stay.rotation.x = math.atan2(-(ty + 1), tz)
    g.add(stay)
    # A short tail behind the mast with a counterweight.
    g.add(k.box(red, 2.6, 2.6, 12, 0.8, 0, -15.3, -6))
    g.add(k.box(k.paint(DARK), 7, 7, 6, 1.4, 0, -19, -10))
    g.add(k.cyl(k.paint(DARK), 0.5, 26, 0, ty - 26, tz, 0.5, 6))
    g.add(k.box(k.paint(DARK), 3, 2, 3, 0.5, 0, ty - 28, tz))
    _crate(k, g, 0, ty - 37, tz, 8, "#c99a5b")
    return g


def industry_dock_shed(k):
    """
    A dock shed on a harbour's quay: about 30 (x, with its crate) by 20 (z) by 20 high, centred on its footprint, its base on y 0,
    doors toward -z (the piles). Beech walls under a pitched roof (slot "roof", ridge along x), double doors (slot
    "doors") with a cream lintel, a lamp over them, a crate against its +x end.
    """
    g = Node()
    w, d, h = 24, 18, 13
    front = -d / 2
    g.add(k.box(k.wood, w, h, d, 1.8, 0, 0, 0))
    g.add(k.roof(k.paint(slot("roof")), w + 2, d + 2, 7, 0, h - 0.5, 0, 2.2))
    for s in (-1, 1):
        g.add(k.box(k.paint(slot("doors")), 5.6, 10, 1.4, 0.5, s * 2.9, 0, front - 0.3))
    g.add(k.box(k.paint(CREAM), 13, 1.4, 1.8, 0.4, 0, 10, front - 0.3))
    g.add(k.box(k.paint(GOLD), 1.6, 2, 1.6, 0.4, 0, 11.6, front - 1.4))
    for wx in (-8.6, 8.6):
        g.add(k.box(k.paint("#2b3644"), 3.6, 4, 1, 0.4, wx, 5, front - 0.2))
    _crate(k, g, 14.8, 0, 4, 5, "#c99a5b", 0.2)
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
    ("upgrade-log-loader", upgrade_log_loader),
    ("upgrade-steam-log-crane", upgrade_steam_log_crane),
    ("upgrade-saw-bench", upgrade_saw_bench),
    ("upgrade-steam-saw-house", upgrade_steam_saw_house),
    ("upgrade-tractor", upgrade_tractor),
    ("upgrade-millstones", upgrade_millstones),
    ("upgrade-stone-crusher", upgrade_stone_crusher),
    ("industry-mine", industry_mine),
    ("industry-mine-wheel", industry_mine_wheel),
    ("industry-foundry", industry_foundry),
    ("load-coal", load_coal),
    ("load-ore", load_ore),
    ("load-iron", load_iron),
    ("load-coal-heap", load_coal_heap),
    ("load-ore-heap", load_ore_heap),
    ("industry-carpenter", industry_carpenter),
    ("industry-smithy", industry_smithy),
    ("industry-power", industry_power),
    ("industry-power-wheel", industry_power_wheel),
    ("load-furniture", load_furniture),
    ("load-tools", load_tools),
    ("industry-harbour", industry_harbour),
    ("industry-harbour-jib", industry_harbour_jib),
    ("industry-dock-shed", industry_dock_shed),
]


# Parts on every house: built lean (see kit.Kit), as a map has hundreds of them.
LEAN = {"door", "flower-box", "chimney-top"}

# Industries both modes show (the map's own forest yards and sawmills): in dressing.glb with the rest.
SHARED_INDUSTRY = {"industry-forest-hut", "industry-sawmill-shed", "industry-saw-blade"}


def game_only(name):
    """Game mode's parts (its other industries, the upgrade machines, the cargo loads): built into industry.glb, which
    the game loads only when Game mode starts, so Sandbox never fetches them."""
    return name.startswith(("industry-", "upgrade-", "load-")) and name not in SHARED_INDUSTRY


def main():
    # SET=industry builds industry.glb (Game mode's parts); otherwise dressing.glb (the rest).
    which = os.environ.get("SET", "dressing")
    parts = [(n, b) for n, b in PARTS if game_only(n) == (which == "industry")]
    toy.reset()
    only = set(filter(None, os.environ.get("ONLY", "").split(",")))
    for i, (name, build) in enumerate(parts):
        if only and name not in only:
            continue
        toy.begin()
        root = build(kit.Kit(lean=name in LEAN))
        pivots = kit.realize(root, name)
        toy.finish(name, (i % 8 * 60, -(i // 8) * 60, 0), pivots)
    print(f"{len(parts)} parts ({which})")
    if not os.environ.get("NOEXPORT"):
        toy.save_and_export(which)


main()
