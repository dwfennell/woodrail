"""Houses for bldg.py, ported from src/catalogue/assets/buildings.ts."""

import math

from kit import TOY, Node
from bldg_parts import (  # noqa: F401
    BRICK, FRAME, SLATE, STONE, WIN, awningX, bench, chimney, churn, clock, crate, doorX, doorZ, gable, glassBand, hip,
    house, lamp, nameBoard, named, panel, peg, pine, platform, sack, smoke, winX, winZ,
)


# ——— Small additions (not in the code): ridge rolls, doorsteps, number plates ———


def ridge(k, color, length, d, h, y0, x=0, z=0, ry=0, t=3):
    """A rounded ridge roll along the top of a k.roof(w, d, h) whose eaves are on y0 (ridge along x, turn with ry)."""
    slope = math.hypot(d / 2, h)
    th = math.atan2(h, d / 2)
    y = y0 + h + h / slope + t / 2 * math.cos(th) - 0.7
    return k.at(k.group(k.cylX(k.paint(color), 1.7, length + 1, 0, y, 0, 16)), x, 0, z, ry)


def house_ridge(k, color, w, d, h, rh, x=0, z=0, o=4):
    """The ridge roll for bldg_parts.house(k, w, d, h, ..., rh, x, z, o)."""
    drop = (2 * o * rh) / d
    return ridge(k, color, w + 2 * o, d + 2 * o, rh + drop, h - drop + 1.4, x, z)


def step(k, x, z, w, ry=0):
    """A stone doorstep in front of a door on a wall facing +x at x (turn with ry for other walls)."""
    return k.at(k.group(k.box(k.paint(STONE), 4, 1.6, w + 4, 0.5, 2, 0, 0)), x, 0, z, ry)


def plate(k, x, y, z, color=TOY.white):
    """A little enamel house-number plate on a wall facing +x."""
    return k.group(k.box(k.paint(TOY.black), 1.0, 3.4, 4.4, 0.4, x + 0.4, y - 0.2, z), k.box(k.paint(color), 1.4, 3.0, 4.0, 0.4, x + 0.6, y, z))


# ——— The assets ———


def cottage_row(k):
    g = Node()
    cols = [TOY.pink, TOY.sky, TOY.yellow]
    roofs = [TOY.red, TOY.blue, TOY.green]
    for i in range(3):
        x = -34 + i * 34
        h = 30 + (i % 2) * 4
        c = k.at(house(k, 34, 30, h, k.paint(cols[i]), roofs[i], 13, 0, 0, 3), x, 0, 0)
        c.add(doorZ(k, [TOY.green, TOY.red, TOY.blue][i], -6, 15, 8, 16))
        c.add(winZ(k, 8, 8, 15, 8, 8), winZ(k, -6, h - 10, 15, 8, 7), winZ(k, 8, h - 10, 15, 8, 7))
        c.add(chimney(k, 12, h + 6, -4, 12))
        # Added: a ridge roll and a doorstep.
        c.add(house_ridge(k, roofs[i], 34, 30, h, 13, 0, 0, 3))
        c.add(step(k, -6, 15, 8, -math.pi / 2))
        g.add(c)
    return k.at(g, 0, 0, 0, math.pi / 2)


def apartment_block(k):
    g = Node()
    g.add(k.box(k.paint(TOY.cream), 60, 104, 48, 2))
    g.add(k.box(k.paint(TOY.teal), 64, 4, 52, 1, 0, 104, 0))
    g.add(k.box(k.paint(TOY.cream), 16, 10, 14, 1.5, -12, 108, -8))
    for f in range(4):
        y = 12 + f * 24
        for z in (-16, 0, 16):
            g.add(winX(k, 30, y, z, 8, 12))
        for x in (-18, 0, 18):
            g.add(winZ(k, x, y, 24, 8, 12))
        if f > 0:
            g.add(k.box(k.wood, 12, 2, 50, 0.5, 34, y - 4, 0))
            g.add(k.box(k.paint(TOY.orange), 1.4, 6, 50, 0.4, 39.4, y - 2, 0))
    g.add(doorX(k, TOY.teal, 30, 0, 12, 10, 0))
    g.add(k.box(k.paint(TOY.teal), 10, 2, 18, 0.5, 34, 14, 0))
    # Added: a door on the roof hut.
    g.add(doorX(k, TOY.teal, -4, -8, 6, 8, 108))
    return g


def hospital(k):
    g = Node()
    g.add(k.box(k.paint(TOY.white), 50, 58, 80, 2))
    g.add(k.box(k.paint(TOY.white), 40, 34, 30, 2, -40, 0, 0))
    for f in range(3):
        for z in (-30, -18, 18, 30):
            g.add(winX(k, 25, 10 + f * 17, z, 8, 9))
    for f in range(2):
        for x in (-48, -32):
            g.add(winZ(k, x, 10 + f * 14, 15, 8, 8))
    # Red cross.
    g.add(k.box(k.paint(TOY.red), 2, 14, 4.5, 0.4, 25.6, 40, 0), k.box(k.paint(TOY.red), 2, 4.5, 14, 0.4, 25.6, 44.75, 0))
    # Entrance canopy.
    g.add(k.box(k.paint(TOY.sky), 1.6, 18, 20, 0.4, 25.2, 0, 0))
    g.add(k.box(k.paint(TOY.red), 16, 2, 26, 0.6, 32, 20, 0))
    for z in (-11, 11):
        g.add(k.cyl(k.paint(TOY.white), 1, 20, 39, 0, z, 1, 8))
    # Helipad.
    g.add(k.cyl(k.paint(TOY.green), 18, 1, 0, 58, 0, 18, 28))
    g.add(
        k.box(k.paint(TOY.white), 2, 0.6, 12, 0.2, -4, 59, 0),
        k.box(k.paint(TOY.white), 2, 0.6, 12, 0.2, 4, 59, 0),
        k.box(k.paint(TOY.white), 8, 0.6, 2, 0.2, 0, 59, 0),
    )
    return g


def control_tower(k):
    g = Node()
    g.add(k.box(k.paint(TOY.white), 44, 18, 30, 2, -6, 0, 0))
    g.add(k.box(k.paint(WIN), 1.6, 8, 24, 0.4, 16, 6, 0))
    g.add(k.lathe(k.paint(TOY.white), [(0, 0), (11, 0), (9, 76), (0, 76)], 0, 0, 0, 24))
    g.add(k.ring(k.paint(TOY.orange), 10, 1, 0, 50, 0))
    g.add(k.cyl(k.paint(TOY.white), 10, 4, 0, 76, 0, 17, 24))
    g.add(k.cyl(k.paint(WIN), 17, 14, 0, 80, 0, 19, 24))
    g.add(k.cyl(k.paint(TOY.orange), 20, 3, 0, 94, 0, 20, 24))
    g.add(k.cyl(k.paint(TOY.grey), 1.4, 8, 0, 97, 0, 1.4, 8))
    radar = named(Node(), "radar")
    dish = k.box(k.paint(TOY.white), 3, 6, 22, 1, 0, 0, 0)
    dish.rotation.z = 0.3
    radar.add(dish, k.box(k.paint(TOY.grey), 4, 2, 2, 0.4, -2, 2, 0))
    g.add(k.at(radar, 0, 104, 0))
    g.add(named(k.ball(k.paint(TOY.red), 1.6, 0, 112, 0), "beacon"))
    g.add(k.cyl(k.paint(TOY.grey), 0.6, 6, 0, 106, 0, 0.6, 6))
    return g


def ice_cream_kiosk(k):
    g = Node()
    g.add(k.cyl(k.paint(TOY.pink), 16, 24, 0, 0, 0, 16, 24))
    g.add(glassBand(k, 16.3, 9, 10))
    g.add(k.cyl(k.wood, 17.4, 1.6, 0, 9, 0, 17.4, 24))
    g.add(k.cyl(k.paint(TOY.white), 20, 2, 0, 24, 0, 20, 24))
    g.add(k.cone(k.paint(TOY.white), 20, 10, 0, 26, 0, 12))
    for i in range(6):
        a = (i * math.pi) / 3
        # The code turns each stripe in "YXZ" order (y, then its own x): a y-turned holder round an x-tilted stripe.
        s = k.box(k.paint(TOY.red), 2, 0.5, 21, 0.2, 0, 0, 0)
        s.rotation.x = math.atan2(10, 20)
        holder = k.group(s)
        holder.position.set(math.cos(a) * 10, 31.2, math.sin(a) * 10)
        holder.rotation.y = -a + math.pi / 2
        g.add(holder)
    cone = named(Node(), "cone")
    c = k.cone(k.paint("#d9a35b"), 6, 16, 0, -16, 0, 14)
    c.rotation.x = math.pi
    cone.add(c, k.ball(k.paint(TOY.pink), 6, 0, 1, 0), k.ball(k.paint(TOY.cream), 5, 0, 8, 0), k.ball(k.paint(TOY.red), 1.6, 0, 13.5, 0))
    g.add(k.at(cone, 0, 52, 0))
    # k.peg(...).translateY(1): unturned, so just one higher.
    g.add(peg(k, TOY.white, TOY.white, 6, 1, 4))
    return g


def toy_shop(k):
    g = house(k, 44, 32, 34, k.paint(TOY.purple), TOY.yellow, 13)
    g.add(doorX(k, TOY.yellow, 22, 10, 9, 18))
    g.add(k.box(k.paint(WIN), 1.6, 14, 18, 0.4, 22, 4, -5))
    g.add(k.box(k.paint(TOY.yellow), 2.2, 1.4, 20, 0.3, 22.4, 18, -5), k.box(k.paint(TOY.yellow), 2.2, 1.4, 20, 0.3, 22.4, 3, -5))
    # Tiny train on display, and blocks.
    cs = [TOY.red, TOY.blue, TOY.green]
    for i in range(3):
        g.add(k.box(k.paint(cs[i]), 3, 3, 4.6, 0.6, 23.6, 5, -12 + i * 5.4))
    g.add(k.box(k.paint(TOY.yellow), 3, 3, 3, 0.6, 23.6, 8, -12))
    g.add(awningX(k, 22, 27, 0, 30, TOY.yellow, TOY.purple, 6))
    g.add(winX(k, 22, 30, 0, 9, 7))
    for x, c in ((-14, TOY.red), (-6, TOY.blue), (2, TOY.green)):
        g.add(k.box(k.paint(c), 7, 7, 7, 1.2, x, 0, 20))
    g.add(k.box(k.paint(TOY.yellow), 7, 7, 7, 1.2, -10, 7, 20))
    # Pinwheel on the ridge.
    g.add(k.cyl(k.paint(TOY.white), 0.8, 14, 14, 46, 0, 0.8, 8))
    pin = named(Node(), "pinwheel")
    pc = [TOY.red, TOY.yellow, TOY.blue, TOY.green]
    for i in range(4):
        blade = Node()
        blade.add(k.extrude(k.paint(pc[i]), [(0, 0), (0, 8), (5, 8)], 0.8, 0, 0, 0, 0))
        blade.rotation.y = math.pi / 2
        holder = Node()
        holder.add(blade)
        holder.rotation.x = (i * math.pi) / 2
        pin.add(holder)
    pin.add(k.ball(k.paint(TOY.white), 1.4, 0, 0, 0))
    g.add(k.at(pin, 15.4, 60, 0))
    # Added: a ridge roll and a doorstep.
    g.add(house_ridge(k, TOY.yellow, 44, 32, 34, 13))
    g.add(step(k, 22, 10, 9))
    return g


def townhouse(k):
    g = house(k, 40, 30, 46, k.paint("#e7d6b8"), SLATE, 12)
    g.add(doorX(k, TOY.blue, 20, 0, 9, 17))
    g.add(k.cylX(k.paint("#f6e7a8"), 4, 1.6, 20.4, 18, 0, 16))
    for y in (24, 36):
        for z in (-8, 8):
            g.add(winX(k, 20, y, z, 7, 9))
    g.add(chimney(k, -12, 50, 10, 10))
    # Added: a ridge roll, a doorstep and a number plate.
    g.add(house_ridge(k, SLATE, 40, 30, 46, 12))
    g.add(step(k, 20, 0, 9))
    g.add(plate(k, 20, 10, 9.5, TOY.blue))
    return g


def thatched_cottage(k):
    g = Node()
    g.add(k.box(k.paint(TOY.white), 40, 20, 34, 3))
    # The thatch: a thick, soft-edged ridge that comes down low over the walls.
    thatch = k.paint("#d9b45a")
    g.add(k.roof(thatch, 46, 42, 18, 0, 17, 0, 5))
    g.add(k.box(thatch, 44, 4, 8, 3.5, 0, 33, 0))
    g.add(doorX(k, TOY.green, 20, -6, 8, 15))
    g.add(winX(k, 20, 8, 8, 8, 8))
    for y, z in ((3, -12), (9, -12.5), (15, -11), (5, 1), (12, 0.5)):
        g.add(k.ball(k.paint(TOY.pink), 1.6, 21, y, z))
    g.add(chimney(k, -10, 26, -10, 12, STONE))
    # Added: a doorstep.
    g.add(step(k, 20, -6, 8))
    return g


def timber_house(k):
    g = Node()
    cream = k.paint("#f0e3c6")
    oak = k.paint("#5b3a22")
    g.add(k.box(cream, 36, 20, 32, 1.5))
    # Upper floor jetties out over the front.
    g.add(k.box(cream, 42, 18, 34, 1.5, 3, 20, 0))
    g.add(gable(k, cream, 41.5, 34, 16, 3, 38, 0))
    g.add(k.roof(k.paint(TOY.red), 48, 40, 19, 3, 37, 0))
    # Beams on the front faces.
    for z in (-15, -5, 5, 15):
        g.add(k.box(oak, 1.6, 18, 2, 0.3, 24.2, 20, z), k.box(oak, 1.6, 20, 2, 0.3, 18.2, 0, z))
    g.add(k.box(oak, 1.6, 2, 34, 0.3, 24.2, 19, 0), k.box(oak, 1.6, 2, 34, 0.3, 24.2, 36.5, 0))
    for s in (-1, 1):
        brace = k.box(oak, 1.4, 12, 1.8, 0.3, 24.2, 23, s * 10)
        brace.rotation.x = s * 0.6  # rotateX: turns it in place
        g.add(brace)
    g.add(doorX(k, "#5b3a22", 18, 0, 8, 16))
    for z in (-10, 10):
        g.add(winX(k, 24, 26, z, 6, 8))
    # Added: a ridge roll and a doorstep.
    g.add(ridge(k, TOY.red, 48, 40, 19, 37, 3))
    g.add(step(k, 18, 0, 8))
    return g


def bungalow(k):
    g = Node()
    g.add(k.box(k.paint("#c9dcef"), 40, 18, 44, 2))
    g.add(hip(k, k.paint(BRICK), 56, 16, 0, 18, 0))
    g.add(doorX(k, TOY.red, 20, 0, 9, 15), k.box(k.paint(STONE), 4, 1.6, 14, 0.5, 22, 0, 0))
    for z in (-13, 13):
        g.add(winX(k, 20, 6, z, 10, 8))
        g.add(k.box(k.paint(TOY.green), 3, 2.6, 11, 0.6, 21.6, 4, z))
        for dz in (-3, 0, 3):
            g.add(k.ball(k.paint(TOY.yellow if dz == 0 else TOY.red), 1.2, 22, 7.3, z + dz))
    return g


def corner_shop(k):
    g = house(k, 38, 36, 40, k.paint("#2f7a6e"), SLATE, 11)
    g.add(doorX(k, TOY.cream, 19, 10, 8, 17))
    g.add(k.box(k.paint(WIN), 1.6, 13, 18, 0.4, 19, 3, -6))
    g.add(awningX(k, 19, 20, -2, 32, TOY.green, TOY.white, 6))
    g.add(k.box(k.paint(TOY.cream), 1.4, 5, 26, 0.6, 19.6, 25, 0))
    for z in (-10, 10):
        g.add(winX(k, 19, 31, z, 8, 7))
    for z, c in ((-14, TOY.orange), (-7, TOY.red), (0, TOY.yellow)):
        g.add(k.box(k.wood, 6, 3, 6, 0.6, 25, 0, z))
        for dz in (-1.3, 1.3):
            g.add(k.ball(k.paint(c), 1.5, 25, 4, z + dz))
    # Added: a ridge roll and a doorstep.
    g.add(house_ridge(k, SLATE, 38, 36, 40, 11))
    g.add(step(k, 19, 10, 8))
    return g


def narrow_house(k):
    g = Node()
    wall = k.paint("#c76b4f")
    g.add(k.box(wall, 40, 52, 26, 1.5))
    # Stepped gable on the front.
    for y, w in ((52, 22), (57, 15), (62, 8)):
        g.add(k.box(wall, 4, 5, w, 0.8, 18, y, 0))
    g.add(k.roof(k.paint(SLATE), 38, 28, 12, -2, 52, 0))
    g.add(doorX(k, TOY.black, 20, 0, 8, 16))
    for y in (24, 38):
        for z in (-6, 6):
            g.add(winX(k, 20, y, z, 6, 9))
    g.add(k.box(k.paint(TOY.white), 1.6, 5, 6, 0.4, 20.2, 56, 0))
    # Added: a doorstep.
    g.add(step(k, 20, 0, 8))
    return g


def brick_house(k):
    g = house(k, 36, 40, 38, k.paint(BRICK), SLATE, 13)
    # Swap the gable to face the side: a broad front with the bay.
    g.add(k.box(k.paint(TOY.white), 6, 16, 16, 1.2, 21, 0, 6))
    g.add(k.box(k.paint(WIN), 1.6, 9, 12, 0.4, 24.1, 4, 6))
    g.add(k.box(k.paint(SLATE), 8, 2, 18, 0.6, 21, 16, 6))
    g.add(doorX(k, TOY.blue, 18, -10, 8, 17))
    for z in (-10, 8):
        g.add(winX(k, 18, 26, z, 8, 9))
    for x in (-14, 14):
        g.add(chimney(k, x, 46, 0, 9))
    # Added: a ridge roll and a doorstep.
    g.add(house_ridge(k, SLATE, 36, 40, 38, 13))
    g.add(step(k, 18, -10, 8))
    return g


def terrace(k):
    g = Node()
    wall = k.paint("#e4d2b0")
    g.add(k.box(wall, 34, 34, 120, 2))
    g.add(k.at(gable(k, wall, 119.5, 34, 13, 0, 34, 0), 0, 0, 0, math.pi / 2))
    g.add(k.at(k.roof(k.paint(SLATE), 128, 42, 16, 0, 0, 0), 0, 32, 0, math.pi / 2))
    doors = [TOY.red, TOY.blue, TOY.green]
    for i in range(3):
        z = -40 + i * 40
        g.add(doorX(k, doors[i], 17, z - 8, 8, 16))
        g.add(winX(k, 17, 6, z + 8, 9, 9), winX(k, 17, 23, z - 8, 8, 8), winX(k, 17, 23, z + 8, 8, 8))
        if i < 2:
            g.add(k.box(k.paint(TOY.cream), 1.4, 34, 1.4, 0.3, 17.4, 0, z + 20))
        # Added: a doorstep for each house.
        g.add(step(k, 17, z - 8, 8))
    for z in (-20, 20):
        g.add(chimney(k, 0, 45, z, 9))
    # Added: a ridge roll.
    g.add(ridge(k, SLATE, 128, 42, 16, 32, 0, 0, math.pi / 2))
    return g


def semi_detached(k):
    g = Node()
    halves = [(-1, "#d8e6cf", TOY.red), (1, "#f2dcc2", TOY.blue)]
    for s, wall, door in halves:
        zc = s * 28
        g.add(k.box(k.paint(wall), 36, 34, 56, 2, -4, 0, zc))
        g.add(doorX(k, door, 14, zc - s * 18, 8, 16))
        g.add(k.box(k.paint(TOY.white), 6, 2, 14, 0.6, 16, 18, zc - s * 18))
        g.add(winX(k, 14, 6, zc + s * 6, 12, 9), winX(k, 14, 23, zc - s * 14, 8, 8), winX(k, 14, 23, zc + s * 6, 10, 8))
        g.add(k.box(k.paint(TOY.leaf), 4, 6, 22, 2, 22, 0, zc + s * 10))
        # Added: a doorstep under each porch.
        g.add(step(k, 14, zc - s * 18, 8))
    # A hipped roof over each half, joined along the ridge.
    for z in (-30, 30):
        g.add(hip(k, k.paint(BRICK), 44, 14, -4, 34, z))
    g.add(k.box(k.paint(BRICK), 30, 6, 60, 2, -4, 34, 0))
    g.add(chimney(k, -4, 40, 0, 9))
    return g


def villa(k):
    g = Node()
    wall = k.paint("#efe7d6")
    g.add(k.box(wall, 40, 38, 104, 2))
    g.add(k.box(k.paint(STONE), 42, 2, 106, 0.6, 0, 18, 0))
    for z in (-30, 30):
        g.add(hip(k, k.paint(SLATE), 48, 16, 0, 38, z))
    g.add(k.box(k.paint(SLATE), 36, 6, 60, 2, 0, 38, 0))
    # The porch: four columns and a pediment.
    for z in (-14, -5, 5, 14):
        g.add(k.cyl(k.paint(TOY.white), 2, 22, 26, 0, z, 2, 12))
    g.add(
        k.box(k.paint(TOY.white), 12, 3, 34, 1, 25, 22, 0),
        k.at(k.extrude(k.paint(TOY.white), [(-17, 0), (17, 0), (0, 8)], 10, 0, 0, 0, 0.6), 25, 25, 0, math.pi / 2),
    )
    g.add(doorX(k, "#2b5b3a", 20, 0, 10, 20))
    for z in (-40, -26, 26, 40):
        g.add(winX(k, 20, 4, z, 8, 13), winX(k, 20, 24, z, 8, 11))
    for z in (-46, 46):
        g.add(chimney(k, 0, 46, z, 10, STONE))
    # Added: a stone floor under the porch, so the columns stand on something.
    g.add(k.box(k.paint(STONE), 12, 1.6, 34, 0.5, 25, 0, 0))
    return g


ASSETS = [
    ("bldg-cottage-row", cottage_row),
    ("bldg-apartment-block", apartment_block),
    ("bldg-hospital", hospital),
    ("bldg-control-tower", control_tower),
    ("bldg-ice-cream-kiosk", ice_cream_kiosk),
    ("bldg-toy-shop", toy_shop),
    ("bldg-townhouse", townhouse),
    ("bldg-thatched-cottage", thatched_cottage),
    ("bldg-timber-house", timber_house),
    ("bldg-bungalow", bungalow),
    ("bldg-corner-shop", corner_shop),
    ("bldg-narrow-house", narrow_house),
    ("bldg-brick-house", brick_house),
    ("bldg-terrace", terrace),
    ("bldg-semi-detached", semi_detached),
    ("bldg-villa", villa),
]
