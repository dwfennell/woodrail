"""
Floor blocks for town houses that grow (built by floors.py into floors.glb): one storey of each house's walls, slid in under the house to lift it
up a storey, like a stacked wooden toy. Each matches its house's walls (colour, footprint, rounding) and printed
windows, on every face, with no roof and no door. Ids are the house's id plus "-floor"; like the houses, each is
centred, its front facing +x, its base on y = 0, so the house above simply rises by the block's height (`STOREY`, or
the apartment block's own 24). The rounded edges leave a groove at the join, so the stack reads as blocks.
"""

from kit import TOY, Node
from bldg_parts import BRICK, STONE, winX, winZ

STOREY = 20


def _wall(k, g, color, w, d, h, x=0, z=0, r=3, front=(), sides=(), side_faces=(-1, 1), win=(7, 9), back=True):
    """
    A storey of wall w (x) by d (z) by h, centred at (x, z), with printed windows: at each z in `front` on the front
    face (and the back, if `back`), and at each x in `sides` on the faces in `side_faces` (-1: -z, 1: +z).
    """
    g.add(k.box(k.paint(color), w, h, d, r, x, 0, z))
    ww, wh = win
    y = (h - wh) / 2 + 0.5
    for fz in front:
        g.add(winX(k, x + w / 2, y, z + fz, ww, wh))
        if back:
            g.add(winX(k, x - w / 2, y, z + fz, ww, wh))
    for sx in sides:
        for s in side_faces:
            g.add(winZ(k, x + sx, y, z + s * d / 2, ww, wh))
    return g


def townhouse_floor(k):
    return _wall(k, Node(), "#e7d6b8", 40, 30, STOREY, front=(-8, 8), sides=(-8, 8))


def thatched_cottage_floor(k):
    return _wall(k, Node(), TOY.white, 40, 34, STOREY, front=(-8, 8), sides=(-8, 8), win=(8, 8))


def timber_house_floor(k):
    """The timber house's ground storey: cream panels framed in oak, as its own ground floor is."""
    g = _wall(k, Node(), "#f0e3c6", 36, 32, STOREY, r=1.5, front=(-10, 10), sides=(0,), win=(6, 8))
    oak = k.paint("#5b3a22")
    for z in (-15, -5, 5, 15):
        g.add(k.box(oak, 1.6, STOREY, 2, 0.3, 18.2, 0, z))
    g.add(k.box(oak, 1.6, 2, 34, 0.3, 18.2, STOREY - 2, 0))
    return g


def bungalow_floor(k):
    return _wall(k, Node(), "#c9dcef", 40, 44, STOREY, r=2, front=(-13, 13), sides=(-8, 8), win=(10, 8))


def brick_house_floor(k):
    return _wall(k, Node(), BRICK, 36, 40, STOREY, front=(-10, 8), sides=(-6, 6), win=(8, 9))


def narrow_house_floor(k):
    return _wall(k, Node(), "#c76b4f", 40, 26, STOREY, r=1.5, front=(-6, 6), sides=(-10, 10), win=(6, 9))


def corner_shop_floor(k):
    return _wall(k, Node(), "#2f7a6e", 38, 36, STOREY, front=(-10, 10), sides=(-8, 8), win=(8, 8))


def toy_shop_floor(k):
    return _wall(k, Node(), TOY.purple, 44, 32, STOREY, front=(-10, 10), sides=(-10, 10), win=(8, 8))


def terrace_floor(k):
    """A storey of the terrace: three houses' windows along the front, with the cream pilasters between them."""
    g = _wall(k, Node(), "#e4d2b0", 34, 120, STOREY, r=2, front=(-48, -32, -8, 8, 32, 48), sides=(-8, 8), win=(8, 8))
    for z in (-20, 20):
        g.add(k.box(k.paint(TOY.cream), 1.4, STOREY, 1.4, 0.3, 17.4, 0, z))
    return g


def semi_detached_floor(k):
    """A storey of each half, in its own colour, windows on the outer ends only."""
    g = Node()
    for s, wall in ((-1, "#d8e6cf"), (1, "#f2dcc2")):
        _wall(k, g, wall, 36, 56, STOREY, -4, s * 28, r=2, front=(s * 6, -s * 14), sides=(-6, 6), side_faces=(s,), win=(9, 8))
    return g


def villa_floor(k):
    """A storey of the villa, with its stone band along the top."""
    g = _wall(k, Node(), "#efe7d6", 40, 104, STOREY, r=2, front=(-40, -26, 26, 40), sides=(-8, 8), win=(8, 11))
    g.add(k.box(k.paint(STONE), 42, 2, 106, 0.6, 0, STOREY - 2, 0))
    return g


def cottage_row_floor(k):
    """A storey of each of the three cottages, in their own colours (pink, sky, yellow from +z)."""
    g = Node()
    for z, wall in ((34, TOY.pink), (0, TOY.sky), (-34, TOY.yellow)):
        _wall(k, g, wall, 30, 34, STOREY, 0, z, front=(-6, 8), sides=(0,), side_faces=(1,) if z > 0 else (-1,) if z < 0 else (), win=(8, 8))
    return g


def apartment_block_floor(k):
    """Another storey of flats (24, the block's own storey height), with a balcony along the front like the others."""
    h = 24
    g = Node()
    g.add(k.box(k.paint(TOY.cream), 60, h, 48, 2))
    for z in (-16, 0, 16):
        g.add(winX(k, 30, 7, z, 8, 12), winX(k, -30, 7, z, 8, 12))
    for x in (-18, 0, 18):
        g.add(winZ(k, x, 7, 24, 8, 12), winZ(k, x, 7, -24, 8, 12))
    g.add(k.box(k.wood, 12, 2, 50, 0.5, 34, 3, 0))
    g.add(k.box(k.paint(TOY.orange), 1.4, 6, 50, 0.4, 39.4, 5, 0))
    return g


ASSETS = [
    ("bldg-townhouse-floor", townhouse_floor),
    ("bldg-thatched-cottage-floor", thatched_cottage_floor),
    ("bldg-timber-house-floor", timber_house_floor),
    ("bldg-bungalow-floor", bungalow_floor),
    ("bldg-brick-house-floor", brick_house_floor),
    ("bldg-narrow-house-floor", narrow_house_floor),
    ("bldg-corner-shop-floor", corner_shop_floor),
    ("bldg-toy-shop-floor", toy_shop_floor),
    ("bldg-terrace-floor", terrace_floor),
    ("bldg-semi-detached-floor", semi_detached_floor),
    ("bldg-villa-floor", villa_floor),
    ("bldg-cottage-row-floor", cottage_row_floor),
    ("bldg-apartment-block-floor", apartment_block_floor),
]
