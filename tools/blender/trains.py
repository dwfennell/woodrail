"""
The game's engines, wagons and coaches, in the style of wooden toy trains: chunky lacquered bodies with every edge
rounded, on a natural beech chassis with red wheels and a round magnet at each end.

    npm run models     # builds every model file (with `python3`, or $BLENDER_PYTHON), then compresses them

Writes tools/blender/trains.blend (every model laid out side by side) and tools/blender/out/trains.glb: one node per
car and look (`engine-classic`, `passenger-sleeper`, ...), facing +x, centred on its axles, y = 0 at the track base.
Each has four wheels (`wheel_0`..`wheel_3`, centred on their axles) and engines a `lamp`. Sizes match
src/sim/cars.ts; the deck heights match src/render/train-models.ts (DECK, TIMBER_DECK).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import toy  # noqa: E402
from toy import arch_roof, ball, box, cut, recess, cutter_box, cutter_boxes, cutter_cylinder, cylinder, dome, lathe, lumps, moving, paint  # noqa: E402

W = 32.0
WHEEL_R = 6.5
WHEEL_W = 4.5
GROOVE_SPACING = 26.0
AXLE_Z = 15.0
DECK = 19.0  # centre of the chassis slab
TOP = DECK + 4  # top of the chassis slab: bodies sit here

RED = "#c8442f"
BLUE = "#2f6db5"
GREEN = "#2d6b3f"
YELLOW = "#e6b52c"
CREAM = "#f0ebe0"
NIGHT = "#1f3f73"
CLARET = "#7a2a3a"
BROWN = "#7a4a2a"
DARK = "#2a2b2e"
GREY = "#8d8f93"
WHEEL = "#b8432f"
PANE = "#a9cfe6"
EXPRESS = "#1f5aa6"
MAROON = "#6e1f2e"
MAROON_ROOF = "#4a1823"
GOLD = "#d9a93a"
LIT = "#f3d27a"
CURTAIN = "#b0303f"

SPECS = {"engine": (96, 20), "hopper": (80, 18), "passenger": (88, 18), "caboose": (76, 18), "timber": (84, 18)}


# ——— Running gear, shared by every car ———


def running_gear(L, inset):
    """A beech slab with an arch over each wheel, four red wheels with domed hubs, and a magnet coupler at each end."""
    chassis = box("wood", (L - 6, W - 2, 8), (0, 0, DECK), r=2.2)
    ax = L / 2 - inset
    inner = GROOVE_SPACING / 2 - WHEEL_W / 2 - 1.5
    depth = W / 2 - inner + 2
    for x in (-ax, ax):
        for s in (-1, 1):
            cut(chassis, cutter_cylinder(WHEEL_R + 1.5, depth, (x, s * (inner + depth / 2), AXLE_Z), "Y", 24))
    r, hw = WHEEL_R, WHEEL_W / 2
    profile = [(0.0, -hw + 0.6), (r - 2.4, -hw + 0.6), (r - 1.2, -hw), (r - 0.4, -hw + 0.3), (r, -hw + 1.0), (r, hw - 1.0), (r - 0.4, hw - 0.3), (r - 1.2, hw), (r - 2.4, hw - 0.6), (0.0, hw - 0.6)]
    i = 0
    for x in (ax, -ax):
        for y in (GROOVE_SPACING / 2, -GROOVE_SPACING / 2):
            moving(lathe(paint(WHEEL), profile, (x, y, AXLE_Z), "Y", 28, f"wheel_{i}"))
            s = 1 if y > 0 else -1
            hub = [(1.9, 0), (1.9, 1.0), (1.3, 1.9), (0.0, 2.2)]
            if s < 0:
                hub = [(rr, -h) for rr, h in reversed(hub)]
            lathe("metal", hub, (x, y + s * (hw - 0.6), AXLE_Z), "Y", 14)
            i += 1
    for s in (-1, 1):
        box("wood", (8, 6, 4), (s * (L / 2 - 6), 0, DECK), r=0.8)
        lathe("metal", [(0.0, -2), (4.4, -2), (5, -1.4), (5, 1.4), (4.4, 2), (0.0, 2)], (s * (L / 2 - 2), 0, DECK), "X", 24)


def side_windows(body, panes, half_width, depth=1.2, color=PANE):
    """Set printed panes into shallow recesses on both sides of `body`: panes are (x, z, w, h)."""
    if not panes:
        return
    recess(body, cutter_boxes([((w, depth * 2, h), (x, s * half_width, z)) for x, z, w, h in panes for s in (-1, 1)]))
    for x, z, w, h in panes:
        for s in (-1, 1):
            # Half sunk into the recess floor, its face 0.5 mm proud of it.
            box(paint(color), (w - 0.2, 1.0, h - 0.2), (x, s * (half_width - depth), z), r=0)


def end_windows(body, panes, x_face, depth=1.2, color=PANE):
    """Panes set into the front or back face at x = `x_face`: panes are (y, z, w, h)."""
    s = 1 if x_face > 0 else -1
    recess(body, cutter_boxes([((depth * 2, w, h), (x_face, y, z)) for y, z, w, h in panes]))
    for y, z, w, h in panes:
        box(paint(color), (1.0, w - 0.2, h - 0.2), (x_face - s * depth, y, z), r=0)


def lamp(at):
    """The lamp on a cab roof: a dark base and the bulb that glows to show the lever."""
    lathe("metal", [(0.0, 0), (2.6, 0), (2.6, 1.6), (0.0, 1.6)], at, "Z", 16)
    prof = [(0.0, 0)] + [(3.2 * math.sin(math.pi * k / 8), 3.2 - 3.2 * math.cos(math.pi * k / 8)) for k in range(1, 8)] + [(0.0, 6.4)]
    moving(lathe("lamp", prof, (at[0], at[1], at[2] + 0.8), "Z", 20, "lamp"))


def cab(color, x0, x1, height, roof_color, wall=2.4, spectacles=True, roof_overhang=4):
    """An engine's cab: open at the back, a window cut through each side, round spectacles in front, an arched roof."""
    length = x1 - x0
    top = TOP + height
    c = box(paint(color), (length, W, height), ((x0 + x1) / 2, 0, TOP + height / 2), r=2.5)
    cut(
        c,
        cutter_box((length, W - 2 * wall, height - 4), ((x0 + x1) / 2 - wall, 0, TOP + height / 2 + 2.01)),
        cutter_box((length * 0.52, W + 4, 11), ((x0 + x1) / 2 - 1, 0, top - 10)),
    )
    for s in (-1, 1):
        box(paint(PANE), (length * 0.52, 0.6, 11), ((x0 + x1) / 2 - 1, s * (W / 2 - wall + 0.4), top - 10), r=0)
    if spectacles:
        for s in (-1, 1):
            cut(c, cutter_cylinder(3.4, 8, (x1, s * 9.5, top - 8), "X", 24))
            lathe(paint(PANE), [(0.0, 0), (3.5, 0), (3.5, 0.6), (0.0, 0.6)], (x1 - wall + 0.3, s * 9.5, top - 8), "X", 24)
    box("metal", (length - wall - 1, W - 2 * wall - 0.4, 1.2), ((x0 + x1) / 2 - wall / 2, 0, TOP + 2.6), r=0.3, seg=1)
    arch_roof(paint(roof_color), length + 2 * roof_overhang, W + 7, 3.5, 2.6, ((x0 + x1) / 2 - 2, 0, top - 1.4))
    return top + 3.5 + 1


def boiler(color, band, x0, x1, r, z, front="metal", bands=2):
    """A boiler along X from x0 to x1, a domed smokebox door at the front and lacquered bands round it."""
    lathe(paint(color), [(r, 0), (r, x1 - x0)], (x0, 0, z), "X", 40)
    for k in range(bands):
        bx = x0 + (x1 - x0) * (0.3 + 0.42 * k / max(1, bands - 1))
        prof = [(r - 0.2, -1.8), (r + 0.7, -1.6), (r + 1.3, -0.8), (r + 1.4, 0), (r + 1.3, 0.8), (r + 0.7, 1.6), (r - 0.2, 1.8)]
        lathe(paint(band), prof, (bx, 0, z), "X", 40)
    door = [(r + 0.4, 0), (r + 0.4, 1.4), (r - 0.6, 2.3), (r - 1.8, 2.5), (r * 0.62, 3.6), (r * 0.3, 4.3), (0, 4.5)]
    lathe(front, door, (x1, 0, z), "X", 40)
    # The smokebox door's handle.
    box(paint(band), (1.4, 1.4, 6), (x1 + 4.6, 0, z), r=0.5)


def handrails(x0, x1, r, z, height=4):
    """A rail along each side of the boiler on two stanchions, `height` above its centre line."""
    for s in (-1, 1):
        lathe("metal", [(0.7, 0), (0.7, x1 - x0)], (x0, s * (r + 1.6), z + height), "X", 10)
        for hx in (x0 + 4, x1 - 4):
            box("metal", (1.0, 2.4, 1.0), (hx, s * (r + 0.6), z + height), r=0.3)


def chimney(x, base_z, height=17.8, color="metal"):
    h = height
    prof = [(0.0, 0), (7.0, 0), (5.2, 2.0), (4.3, 4.0), (4.0, h * 0.5), (4.2, h * 0.73), (5.7, h * 0.85), (6.5, h * 0.94), (6.3, h), (4.6, h + 0.2), (3.4, h * 0.91), (0.0, h * 0.91)]
    lathe(color, prof, (x, 0, base_z), "Z", 32)


def steam_dome(x, base_z, color, r=6.0, h=10.5):
    prof = [(0.0, 0), (r + 2, 0), (r + 0.4, 1.6), (r - 0.6, 3.4), (r - 0.8, h * 0.57), (r - 1.4, h * 0.8), (r - 2.8, h * 0.93), (1.4, h * 0.99), (0.0, h)]
    lathe(paint(color), prof, (x, 0, base_z), "Z", 32)


def buffer_beam(L, color):
    box(paint(color), (4, W, 8), (L / 2 - 9, 0, DECK - 1), r=1.2)
    for s in (-1, 1):
        lathe("metal", [(0.0, 0), (1.6, 0), (1.6, 3.0), (2.8, 3.4), (2.8, 4.4), (0.0, 4.6)], (L / 2 - 7, s * 10, DECK + 1), "X", 16)


# ——— Engines ———


def engine_classic():
    L = 96
    running_gear(L, 20)
    bz = TOP + 12.5
    boiler(GREEN, RED, -10, 42, 12.5, bz)
    handrails(-6, 32, 12.5, bz)
    box(paint(GREEN), (44, 18, 12.5), (18, 0, TOP + 6.25), r=1.5)
    chimney(30, bz + 10)
    steam_dome(16, bz + 10, RED)
    lathe(paint(RED), [(0.0, 0), (2.2, 0), (1.2, 1.2), (1.1, 4.5), (1.8, 5.2), (1.8, 6.6), (0.0, 7.0)], (-6, 0, bz + 11.5), "Z", 16)
    roof = cab(GREEN, -44, -12, 32, RED)
    lamp((-30, 0, roof))
    buffer_beam(L, RED)


def engine_tank():
    L = 96
    running_gear(L, 20)
    bz = TOP + 13
    boiler(BLUE, RED, -10.6, 38, 11, bz, bands=1)
    lathe(paint(RED), [(0.0, 0), (2.2, 0), (1.2, 1.2), (1.1, 4.5), (1.8, 5.2), (1.8, 6.6), (0.0, 7.0)], (-6, 0, bz + 10), "Z", 16)
    for s in (-1, 1):
        t = box(paint(BLUE), (40, 9, 18), (11, s * (W / 2 - 4.5), TOP + 9), r=2.8)
        box(paint(RED), (41, 10, 2.6), (11, s * (W / 2 - 4.5), TOP + 18.6), r=1.2)
    chimney(29, bz + 8.5, 19)
    steam_dome(10, bz + 8.5, YELLOW, 5.5, 10)
    roof = cab(BLUE, -43, -10.6, 30, RED)
    lamp((-29, 0, roof))
    buffer_beam(L, RED)


def engine_diesel():
    L = 96
    running_gear(L, 20)
    hood = box(paint(YELLOW), (56, W - 6, 20), (12.5, 0, TOP + 10), r=4)
    # A grille cut into the front of the hood, and black-and-yellow bands round it.
    for k in range(4):
        cut(hood, cutter_box((1.6, W, 9), (24 + k * 3.6, 0, TOP + 12)))
    for s in (-1, 1):
        box(paint(DARK), (50, 0.8, 2.6), (12.5, s * (W / 2 - 3), TOP + 5), r=0.3, seg=1)
    cylinder("metal", 2.6, 6, (18, 0, TOP + 21), "Z", 16, 0.8)
    for s in (-1, 1):
        toy.bar("metal", (-13, s * (W / 2 - 1.2), TOP + 15), (39, s * (W / 2 - 1.2), TOP + 15), 0.6)
        for hx in (-10, 12, 36):
            box("metal", (1.0, 3.0, 1.0), (hx, s * (W / 2 - 2.4), TOP + 15), r=0.3)
    c = box(paint(YELLOW), (31, W, 32), (-29, 0, TOP + 16), r=3)
    side_windows(c, [(-29, TOP + 22, 19, 11)], W / 2)
    end_windows(c, [(-7, TOP + 22, 10, 10), (7, TOP + 22, 10, 10)], -13.5)
    box(paint(DARK), (35, W + 3, 3), (-29, 0, TOP + 33), r=1.2)
    lamp((-29, 0, TOP + 34.5))
    box(paint(DARK), (4, W, 8), (L / 2 - 9, 0, DECK - 1), r=1.2)
    for s in (-1, 1):
        box(paint(YELLOW), (4.4, 3, 8.4), (L / 2 - 9, s * 7, DECK - 1), r=0.6)


def engine_electric():
    L = 96
    running_gear(L, 20)
    bl = L - 10
    body = box(paint(RED), (bl, W, 30), (0, 0, TOP + 15), r=5)
    side_windows(body, [(-bl / 2 + 9, TOP + 21, 9, 8), (bl / 2 - 9, TOP + 21, 9, 8)] + [(i * 14, TOP + 21, 7, 6) for i in (-1, 0, 1)], W / 2)
    for s in (-1, 1):
        end_windows(body, [(-6.5, TOP + 21, 11, 9), (6.5, TOP + 21, 11, 9)], s * bl / 2)
        box(paint(CREAM), (bl - 8, 0.8, 3.5), (0, s * (W / 2 + 0.1), TOP + 11), r=0.3, seg=1)
    box(paint(GREY), (bl - 8, W - 6, 2.5), (0, 0, TOP + 30.6), r=1)
    # Pantograph: a base, a folding arm, and the bow across the roof.
    box("metal", (6, 6, 3), (6, 0, TOP + 32.5), r=0.8)
    for s in (-1, 1):
        toy.bar("metal", (6, s * 2, TOP + 33), (-4, s * 2, TOP + 40), 0.9)
        toy.bar("metal", (-4, s * 2, TOP + 40), (3, s * 2, TOP + 47), 0.9)
    toy.bar("metal", (3, -(W / 2 - 2), TOP + 47.5), (3, W / 2 - 2, TOP + 47.5), 1.1)
    lamp((bl / 2 - 6, 0, TOP + 31.8))


def engine_express():
    """
    A streamlined express: one long blue body whose nose sweeps down in a curved cowl to a low front with a headlamp,
    a valance over the wheels, a bold yellow stripe along each side, the cab's windows behind the nose and the lamp on
    the roof.
    """
    L = 96
    running_gear(L, 20)
    blue = paint(EXPRESS)
    body = box(blue, (86, W, 28), (-2, 0, TOP + 14), r=5)
    # The cowl: a big round cutter takes the top off the front, leaving a smooth slope down to the nose.
    cut(body, cutter_cylinder(36, W + 12, (44, 0, TOP + 50), "Y", 64))
    side_windows(body, [(-31, TOP + 19, 13, 9), (-15, TOP + 19, 7, 7)], W / 2)
    end_windows(body, [(-6.5, TOP + 19, 10, 8), (6.5, TOP + 19, 10, 8)], -45)
    for s in (-1, 1):
        # The valance, hiding the top of the wheels, and the stripes.
        box(blue, (82, 1.8, 9.5), (-2, s * (W / 2 + 0.7), DECK + 0.5), r=0.8)
        box(paint(YELLOW), (80, 0.8, 4.6), (-3, s * (W / 2 + 0.15), TOP + 8), r=0.3, seg=1)
        box(paint(CREAM), (78, 0.8, 1.4), (-4, s * (W / 2 + 0.15), TOP + 12), r=0.2, seg=1)
    box(paint(GREY), (44, W - 6, 2.2), (-22, 0, TOP + 28.6), r=1)
    ball(paint(CREAM), 3, (40.6, 0, TOP + 7), 20, squash=0.9)
    box(paint(YELLOW), (2.2, W - 10, 3), (40.4, 0, TOP + 2.5), r=0.6, seg=1)
    lamp((4, 0, TOP + 28.4))


# ——— Wagons and coaches ———


def hopper():
    L = 80
    running_gear(L, 18)
    inner, h = L - 14, 22
    tub = box(paint(YELLOW), (inner, W, h), (0, 0, TOP + h / 2), r=2.5)
    cut(tub, cutter_box((inner - 7, W - 7, h), (0, 0, TOP + h / 2 + 3.5)))
    rim = box(paint(BLUE), (inner + 4, W + 3, 3.2), (0, 0, TOP + h), r=1.4)
    cut(rim, cutter_box((inner - 7, W - 7, 6), (0, 0, TOP + h)))
    for x in (-inner / 4, inner / 4):
        for s in (-1, 1):
            box(paint(BLUE), (3.2, 1.6, h - 4), (x, s * (W / 2 + 0.3), TOP + h / 2), r=0.7)
    # Loaded to the brim: a bed of coal level with the rim, heaped with lumps well above it. Nodes of their own
    # ("coal_bed", "coal_lumps"), so the game can hide the coal to carry something else.
    moving(box("coal", (inner - 7.2, W - 7.2, 2), (0, 0, TOP + h - 2), r=0.4, name="coal_bed"))
    moving(lumps("coal", (0, 0, TOP + h - 1.5), (inner - 10, W - 10, 8), count=110, lump=4.6, seed=7, name="coal_lumps", subdivisions=0))


def coach(color, h, windows, roof_color, L=88):
    running_gear(L, 18)
    bl = L - 12
    body = box(paint(color), (bl, W, h), (0, 0, TOP + h / 2), r=3)
    side_windows(body, windows, W / 2)
    arch_roof(paint(roof_color), bl + 8, W + 5, 3, 3, (0, 0, TOP + h - 0.5))
    return body, bl


def passenger_classic():
    bl = 76
    wins = [(-bl / 2 + bl / 4 * (i + 0.5), TOP + 30 * 0.6, bl / 4 - 7, 11) for i in range(4)]
    coach(BLUE, 30, wins, CREAM)
    for s in (-1, 1):
        box(paint(CREAM), (bl - 4, 0.8, 2.4), (0, s * (W / 2 + 0.1), TOP + 8), r=0.3, seg=1)


def passenger_dining():
    bl = 76
    wins = [(i * bl / 3, TOP + 18, bl / 3 - 9, 9) for i in (-1, 0, 1)]
    for s in (-1, 1):
        box(paint(CREAM), (bl - 4, 0.8, 13), (0, s * (W / 2 + 0.1), TOP + 18), r=0.4, seg=1)
    _, _ = coach(CLARET, 30, [], CREAM)
    # Windows over the cream band: set into the band's face.
    for x, z, w, hh in wins:
        for s in (-1, 1):
            box(paint(PANE), (w, 0.6, hh), (x, s * (W / 2 + 0.55), z), r=0)
    cylinder("metal", 2.6, 8, (-bl / 2 + 10, 0, TOP + 34), "Z", 14, 0.8)


def passenger_sleeper():
    bl = 76
    wins = [(-bl / 2 + 7 + i * ((bl - 14) / 5), TOP + 19, 7, 7) for i in range(6)]
    coach(NIGHT, 31, wins, YELLOW)
    for s in (-1, 1):
        for x, z in ((-24, 7), (-9, 5), (6, 8), (21, 6), (31, 9)):
            ball(paint(YELLOW), 1.1, (x, s * (W / 2 + 0.2), TOP + z), 8, squash=1.0)
        cylinder(paint(YELLOW), 3, 1.2, (-32, s * (W / 2 + 0.3), TOP + 10), "Y", 16, 0.4)


def passenger_double_decker():
    bl = 76
    h = 44
    wins = [(-bl / 2 + bl / 4 * (i + 0.5), TOP + h * y, bl / 4 - 6, 9) for y in (0.33, 0.75) for i in range(4)]
    coach(GREEN, h, wins, CREAM)
    for s in (-1, 1):
        box(paint(CREAM), (bl - 2, 0.8, 2.2), (0, s * (W / 2 + 0.1), TOP + h * 0.54), r=0.3, seg=1)


def passenger_first_class():
    """
    A first-class coach: maroon below and cream above, lined in gold, warm-lit windows with crimson curtains drawn
    back, a door at each end with a gold "1", and a maroon roof.
    """
    L = 88
    running_gear(L, 18)
    bl, h = 76, 30
    body = box(paint(MAROON), (bl, W, h), (0, 0, TOP + h / 2), r=3)
    arch_roof(paint(MAROON_ROOF), bl + 8, W + 5, 3, 3, (0, 0, TOP + h - 0.5))
    for s in (-1, 1):
        y = s * (W / 2 + 0.1)
        box(paint(CREAM), (bl - 18, 0.8, 13), (0, y, TOP + 19), r=0.4, seg=1)
        for z in (TOP + 12.2, TOP + 25.8):
            box(paint(GOLD), (bl - 16, 0.9, 0.9), (0, y + s * 0.1, z), r=0.2, seg=1)
        for x in (-16, 0, 16):
            # A warm-lit pane in a maroon frame, a curtain valance across its top and the curtains tied back at its
            # sides.
            box(paint(MAROON), (12.6, 0.5, 10), (x, y + s * 0.3, TOP + 19), r=0.3, seg=1)
            box(paint(LIT), (11, 0.6, 8.4), (x, y + s * 0.5, TOP + 18.8), r=0)
            box(paint(CURTAIN), (11.2, 0.7, 1.8), (x, y + s * 0.8, TOP + 22.4), r=0.3, seg=1)
            for c in (-1, 1):
                box(paint(CURTAIN), (1.4, 0.7, 5.6), (x + c * 4.6, y + s * 0.8, TOP + 19.4), r=0.3, seg=1)
        # A door at each end, with a gold "1".
        for e in (-1, 1):
            dx = e * (bl / 2 - 6.5)
            box(paint(MAROON), (8.5, 1.0, h - 7), (dx, y + s * 0.4, TOP + (h - 7) / 2 + 1.5), r=0.6, seg=1)
            box(paint(GOLD), (2, 0.7, 10), (dx + 0.4, y + s * 0.95, TOP + 17), r=0.3, seg=1)
            box(paint(GOLD), (5, 0.7, 1.6), (dx + 0.4, y + s * 0.95, TOP + 12.6), r=0.3, seg=1)
            # The 1's flag points to the viewer's left on each side (+x seen from +y, -x from -y).
            box(paint(GOLD), (2.6, 0.7, 1.6), (dx + 0.4 + s * 1.4, y + s * 0.95, TOP + 20.4), r=0.3, seg=1)
    # A gold lamp on the roof at each end.
    for e in (-1, 1):
        cylinder(paint(GOLD), 1.8, 3, (e * (bl / 2 - 6), 0, TOP + h + 4), "Z", 12, 0.5)


def caboose_classic():
    L = 76
    bl = L - 12
    h = 26
    running_gear(L, 18)
    body = box(paint(RED), (bl, W, h), (0, 0, TOP + h / 2), r=3)
    side_windows(body, [(-bl / 2 + bl / 2 * (i + 0.5), TOP + h * 0.62, bl / 2 - 7, 9) for i in range(2)], W / 2)
    arch_roof(paint(CREAM), bl + 8, W + 5, 3, 3, (0, 0, TOP + h - 0.5))
    cup = box(paint(RED), (bl * 0.36, W * 0.7, 14), (0, 0, TOP + h + 8), r=2)
    side_windows(cup, [(0, TOP + h + 9, bl * 0.22, 6)], W * 0.35)
    arch_roof(paint(CREAM), bl * 0.46, W * 0.85, 2, 2.4, (0, 0, TOP + h + 14.6))
    cylinder("metal", 2, 6, (bl / 2 - 8, 0, TOP + h + 5), "Z", 12, 0.6)


def caboose_bay_window():
    L = 76
    bl = L - 12
    h = 26
    running_gear(L, 18)
    body = box(paint(YELLOW), (bl, W, h), (0, 0, TOP + h / 2), r=3)
    side_windows(body, [(-bl / 2 + 9, TOP + h * 0.62, 9, 9), (bl / 2 - 9, TOP + h * 0.62, 9, 9)], W / 2)
    for s in (-1, 1):
        bay = box(paint(YELLOW), (18, 6, 16), (0, s * (W / 2 + 2.5), TOP + h * 0.58), r=1.8)
        side_windows(bay, [(0, TOP + h * 0.62, 12, 8)], W / 2 + 5.5)
        box(paint(BROWN), (21, 8, 2.6), (0, s * (W / 2 + 2.5), TOP + h * 0.58 + 9.2), r=1)
    arch_roof(paint(BROWN), bl + 8, W + 5, 3, 3, (0, 0, TOP + h - 0.5))
    cylinder("metal", 2, 6, (bl / 2 - 8, 0, TOP + h + 5), "Z", 12, 0.6)


def timber():
    L = 84
    running_gear(L, 18)
    inner = L - 12
    box("wood", (inner, W, 4), (0, 0, TOP + 2), r=1.5)
    for x in (-inner / 2 + 6, inner / 2 - 6):
        for s in (-1, 1):
            cylinder("wood", 1.8, 18, (x, s * (W / 2 - 2.5), TOP + 13), "Z", 10, 0.6)
            ball(paint(RED), 2.4, (x, s * (W / 2 - 2.5), TOP + 22), 16)


def van():
    """
    A closed goods van (flour, later toys): the timber wagon's length and running gear, a box body in the slot "body"
    under a cream arched roof, and a cream sliding door on each side (moving parts "door_0" at -y and "door_1" at +y,
    which slide along x) under a dark rail.
    """
    L = 84
    running_gear(L, 18)
    bl, h = L - 12, 28
    body = paint("slot body")
    box(body, (bl, W, h), (0, 0, TOP + h / 2), r=3)
    arch_roof(paint(CREAM), bl + 8, W + 5, 3, 3, (0, 0, TOP + h - 0.5))
    for i, s in enumerate((-1, 1)):
        y = s * (W / 2 + 0.9)
        # The rail the door hangs from, and the door: one cream panel, its own node so it can slide along x.
        box("metal", (bl - 10, 1.2, 1.6), (0, s * (W / 2 + 0.5), TOP + h - 3), r=0.5, seg=1)
        moving(box(paint(CREAM), (24, 1.8, h - 7), (0, y, TOP + (h - 7) / 2 + 1.5), r=0.8, seg=2, name=f"door_{i}"))


MODELS = [
    ("engine-classic", engine_classic),
    ("engine-tank", engine_tank),
    ("engine-diesel", engine_diesel),
    ("engine-electric", engine_electric),
    ("engine-express", engine_express),
    ("hopper-classic", hopper),
    ("passenger-classic", passenger_classic),
    ("passenger-dining", passenger_dining),
    ("passenger-sleeper", passenger_sleeper),
    ("passenger-double-decker", passenger_double_decker),
    ("passenger-first-class", passenger_first_class),
    ("caboose-classic", caboose_classic),
    ("caboose-bay-window", caboose_bay_window),
    ("timber-classic", timber),
    ("van-classic", van),
]


def main():
    toy.reset()
    only = os.environ.get("ONLY")
    for i, (name, build) in enumerate(MODELS):
        if only and only != name:
            continue
        toy.begin()
        build()
        toy.finish(name, (0, -i * 60, 0))
    toy.save_and_export("trains")


main()
