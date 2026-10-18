"""
Parts for buildings (the helpers at the top of src/catalogue/assets/buildings.ts), on kit.py: chunky toy architecture,
beech or lacquered walls, gloss roofs and doors, windows as dark printed-look insets in a white frame. Fronts face +x;
anything a train runs through runs along x. The game's coordinates.

Kept to the look of wooden toy blocks: bodies are well-rounded blocks, roofs solid blocks, windows and doors printed-look
panels just proud of the wall, chimneys small blocks. Lamps get a turned post, clocks their hour marks. Window and door
parts round their edges in one step: there are many of them, and they're small. They're symmetric through the wall, so
they suit a wall facing either way.
"""

import math

from kit import TOY, Node

WIN = "#2b3644"
BRICK = "#a8553a"
STONE = "#b9b2a5"
SLATE = "#4a5560"
FRAME = "#fbf6ec"


def named(o, name):
    o.name = name
    return o


def gable(k, mat, length, d, rh, x=0, y=0, z=0):
    """A triangular prism along x (gable infill, a pediment): `length` long, `d` across, `rh` high, its base on y."""
    return k.at(k.extrude(mat, [(-d / 2, 0), (d / 2, 0), (0, rh)], length, 0, 0, 0, 0), x, y, z, math.pi / 2)


def house(k, w, d, h, wall, roof, rh=None, x=0, z=0, o=2.5):
    """A house body like a toy's: a well-rounded block of walls w (x) by d (z) by h, and a solid roof block on top
    (ridge along x, rh high, overhanging by o)."""
    rh = d * 0.45 if rh is None else rh
    g = Node()
    g.add(k.box(wall, w, h, d, 3))
    g.add(k.roof(k.paint(roof), w + 2 * o, d + 2 * o, rh + 3, 0, h - 0.5, 0, 3.5))
    return k.at(g, x, 0, z)


def hip(k, mat, side, h, x=0, y=0, z=0):
    """A four-sided pyramid roof, `side` across at its base on y."""
    return k.at(k.cone(mat, side / math.sqrt(2), h, 0, 0, 0, 4), x, y, z, math.pi / 4)


def _window(k, w, h, cross):
    """A printed-look window round the origin in the y/z plane (a wall facing x): a dark pane in a white surround,
    standing just proud of the wall. (`cross` is kept for callers; toy windows are plain.)"""
    g = Node()
    g.add(k.box(k.paint(FRAME), 1.0, h + 2, w + 2, 0.8, 0, -1, 0, seg=1))
    g.add(k.box(k.paint(WIN), 1.3, h, w, 0.6, 0, 0, 0, seg=1))
    return g


def winX(k, x, y, z, w=9, h=11, cross=True):
    """A window on a wall facing ±x (the wall's face at x), base at y: dark pane, white frame and bars, a sill."""
    return k.at(_window(k, w, h, cross), x, y, z)


def winZ(k, x, y, z, w=9, h=11, cross=True):
    """A window on a wall facing ±z (the wall's face at z)."""
    return k.at(_window(k, w, h, cross), x, y, z, math.pi / 2)


def _door(k, color, w, h):
    """A printed-look door round the origin in the y/z plane: a painted panel standing just proud of the wall."""
    g = Node()
    g.add(k.box(k.paint(color), 1.3, h, w, 0.8, 0, 0, 0, seg=1))
    return g


def doorX(k, color, x, z, w=10, h=18, y=0):
    """A door on a wall facing +x, with a brass knob."""
    return k.at(_door(k, color, w, h), x, y, z)


def doorZ(k, color, x, z, w=10, h=18):
    """A door on a wall facing +z."""
    return k.at(_door(k, color, w, h), x, 0, z, math.pi / 2)


def lamp(k, x, z, h=34, y=0):
    """A platform lamp post: a turned post, a lantern globe, a cap with a finial."""
    black = k.paint(TOY.black)
    return k.group(
        k.lathe(black, [(0.0, 0), (3.0, 0), (3.0, 0.8), (2.2, 1.6), (1.5, 2.4), (1.2, 4), (1.1, h - 0.6), (1.6, h), (1.9, h + 0.6), (0.0, h + 0.6)], x, y, z, 20),
        k.ball(k.paint("#f6e7a8"), 3, x, y + h + 2, z),
        k.cone(black, 3.6, 3, x, y + h + 4, z, 10),
        k.ball(black, 0.8, x, y + h + 7.3, z),
    )


def bench(k, x, z, ry=0, y=0, back=TOY.green):
    """A slatted platform bench, its seat along x (turn with ry)."""
    black = k.paint(TOY.black)
    g = k.group(
        k.box(k.wood, 18, 1.8, 6, 0.6, 0, 5, 0),
        k.box(k.paint(back), 18, 6, 1.4, 0.5, 0, 7, -3),
        k.box(black, 1.4, 5, 6, 0.3, -7, 0, 0),
        k.box(black, 1.4, 5, 6, 0.3, 7, 0, 0),
        k.box(black, 1.4, 1.2, 6, 0.4, -7.6, 8.2, 0),
        k.box(black, 1.4, 1.2, 6, 0.4, 7.6, 8.2, 0),
    )
    return k.at(g, x, y, z, ry)


def chimney(k, x, y, z, h=14, color=BRICK):
    """A chimney: a small well-rounded block, its base on y."""
    return k.box(k.paint(color), 6.5, h + 2, 6.5, 1.8, x, y, z)


def smoke(k, x, y, z):
    """Three puffs of cotton smoke (named "smoke"), drifting up from (x, y, z). Each puff is a part of its own."""
    g = named(Node(), "smoke")
    for i in range(3):
        puff = named(Node(), "puff")
        puff.position.set(0, i * 8, 0)
        puff.add(k.ball(k.paint("#e9e6e0"), 4, 0, 0, 0))
        g.add(puff)
    return k.at(g, x, y, z)


def clock(k, r, x, y, z, ry=0, bold=False):
    """
    A clock face looking along +x with hands named "hour" and "minute", and its hour marks. `bold`: one to be read at a
    glance from across the layout (the station clock): a pure white face in a thick black rim, hour marks as bars
    (longer at the quarters), and broad hands with short tails, each standing clear of the marks.
    """
    g = Node()
    black = k.paint(TOY.black)
    if not bold:
        g.add(k.cylX(black, r + 1.2, 1.6, -0.4, 0, 0, 32))
        g.add(k.cylX(k.paint(TOY.white), r, 2, 0, 0, 0, 32))
        for i in range(12):
            a = i / 12 * math.pi * 2
            big = i % 3 == 0
            g.add(k.ball(black, r * (0.08 if big else 0.05), 1.0, math.cos(a) * r * 0.8, math.sin(a) * r * 0.8))
        hour = named(Node(), "hour")
        hour.add(k.box(black, 0.8, r * 0.55, 1.6, 0.3, 0, 0, 0))
        minute = named(Node(), "minute")
        minute.add(k.box(black, 0.8, r * 0.85, 1.1, 0.3, 0, 0, 0))
        g.add(k.at(hour, 1.3, 0, 0), k.at(minute, 1.6, 0, 0), k.ball(black, 1, 1.8, 0, 0))
        return k.at(g, x, y, z, ry)
    g.add(k.cylX(black, r + 1.4, 1.8, -0.3, 0, 0, 32))
    g.add(k.cylX(k.paint("#ffffff"), r, 2, 0, 0, 0, 32))
    for i in range(12):
        # A bar from the rim inwards, in a node turned about the face's axis (x) to its hour.
        big = i % 3 == 0
        length = r * (0.26 if big else 0.16)
        mark = Node()
        mark.add(k.box(black, 0.5, length, r * (0.13 if big else 0.08), 0.15, 1.0, r * 0.9 - length, 0))
        mark.rotation.x = i / 12 * math.pi * 2
        g.add(mark)
    # The hands: the hour's broad and short, the minute's long, both past the pivot a little (a toy clock's hands).
    hour = named(Node(), "hour")
    hour.add(k.box(black, 0.7, r * 0.66, r * 0.26, 0.3, 0, -r * 0.14, 0))
    minute = named(Node(), "minute")
    minute.add(k.box(black, 0.7, r * 0.96, r * 0.16, 0.25, 0, -r * 0.16, 0))
    g.add(k.at(hour, 1.45, 0, 0), k.at(minute, 2.2, 0, 0), k.ball(black, r * 0.11, 2.6, 0, 0))
    return k.at(g, x, y, z, ry)


def platform(k, length, d, x=0, z=0, h=13, edge=1):
    """A plain platform slab `length` (x) by d (z), with a yellow edge line on its +z side (edge -1 for -z)."""
    return k.group(
        k.box(k.wood, length, h, d, 1.5, x, 0, z),
        k.box(k.paint(TOY.yellow), length - 1, 0.6, 3, 0.2, x, h, z + edge * (d / 2 - 2.5)),
    )


def nameBoard(k, x, z, w=24, y=0, color=TOY.blue):
    """A station name board on two posts (blank: the board is the sign), with ball finials."""
    black = k.paint(TOY.black)
    return k.group(
        k.cyl(black, 1, 26, x - w / 2 + 2, y, z, 1, 12),
        k.cyl(black, 1, 26, x + w / 2 - 2, y, z, 1, 12),
        k.ball(black, 1.3, x - w / 2 + 2, y + 26.6, z),
        k.ball(black, 1.3, x + w / 2 - 2, y + 26.6, z),
        k.box(k.paint(color), w, 7, 1.8, 0.6, x, y + 22, z),
        k.box(k.paint(TOY.white), w - 5, 2.4, 2.2, 0.3, x, y + 24.3, z),
    )


def awningX(k, x, y, z, w, a=TOY.red, b=TOY.white, n=6):
    """A striped awning sloping out over a wall facing +x (at x), w wide, its top edge at y."""
    g = Node()
    sw = w / n
    for i in range(n):
        g.add(k.box(k.paint(b if i % 2 else a), 12, 1.6, sw, 0.3, 6, -0.8, -w / 2 + sw * (i + 0.5)))
    g.rotation.z = -0.45
    return k.at(g, x, y, z)


def crate(k, x, y, z, s=9, color="#c99a5b"):
    """A wooden crate."""
    return k.group(k.box(k.paint(color), s, s, s, 1, x, y, z), k.box(k.cut, s + 0.4, 1.2, s + 0.4, 0.3, x, y + s * 0.45, z))


def sack(k, x, y, z):
    """A tied sack."""
    return k.group(k.ball(k.paint("#d8c49a"), 4, x, y + 3.4, z, 0.9), k.cyl(k.paint("#d8c49a"), 1.4, 3, x, y + 6, z, 2, 10))


def churn(k, x, y, z):
    """A milk churn."""
    return k.lathe(k.paint("#d9dde2"), [(0, 0), (3.4, 0), (3.4, 7), (2, 9.5), (2, 11), (2.8, 11.5), (0, 12)], x, y, z, 24)


def panel(k, mat, length, z0, y0, z1, y1, t=2.5):
    """A slope panel from (z0, y0) to (z1, y1) across, `length` long along x, t thick (for odd roofs)."""
    dz = z1 - z0
    dy = y1 - y0
    m = k.box(mat, length, t, math.hypot(dz, dy) + 1.5, 0.8)
    # k.box puts its base on y: centre it, as the code's mesh is, so it turns about its middle.
    m.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2)
    m.rotation.x = -math.atan2(dy, dz)
    return m


def pine(k, x, z, h=40):
    """A pine tree on a turned trunk."""
    return k.group(
        k.cyl(k.wood, 2.5, 8, x, 0, z, 2.5, 12),
        k.cone(k.paint(TOY.green), h * 0.32, h * 0.6, x, 6, z, 16),
        k.cone(k.paint(TOY.green), h * 0.24, h * 0.45, x, h * 0.45, z, 16),
    )


def glassBand(k, r, h, y, x=0, z=0):
    """A window band of dark glass around a cylinder, between y and y + h."""
    return k.cyl(k.paint(WIN), r, h, x, y, z, r, 32)


def peg(k, coat=TOY.blue, hat=None, x=0, y=0, z=0):
    """A peg person standing about (k.peg in the code): the turned body and painted face of life_parts, a plain hat."""
    from life_parts import person

    g = person(k, coat)
    if hat:
        g.add(k.cyl(k.paint(hat), 4, 0.9, 0, 15.9, 0, 4, 28))
        g.add(k.cyl(k.paint(hat), 2.8, 3, 0, 16.6, 0, 2.6, 24))
    return k.at(g, x, y, z)
