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
