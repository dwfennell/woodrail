"""
Storey blocks for town houses that grow (built by floors.py into floors.glb): a house that gains storeys is stacked
like a wooden toy, its door always on the ground floor. Three pieces per house, each matching its walls (colour,
footprint, rounding) and printed windows, centred, front +x, base on y = 0:

- `<id>-ground`: the bottom storey, with the house's entrance (door, doorstep, porch or shop front).
- `<id>-floor`: a plain storey of windows on every face, for any storeys between.
- `<id>-upper`: the house itself with its entrance swapped for windows, standing on top.

A house that grows by n storeys is one ground block, n - 1 floor blocks, then the upper house, each block `STOREY`
high (the apartment block's 24): the rounded edges leave a groove at each join, so the stack reads as blocks.
"""

import math

from kit import TOY, Node
from bldg_parts import BRICK, STONE, winX, winZ
import bldg_houses as H

STOREY = 20
APARTMENT_STOREY = 24


def _wall(k, g, color, w, d, h, x=0, z=0, r=3, front=(), sides=(), side_faces=(-1, 1), win=(7, 9), back=None):
    """
    A storey of wall w (x) by d (z) by h, centred at (x, z), with printed windows: at each z in `front` on the front
    face, at each z in `back` (the front's, if None) on the back, and at each x in `sides` on the faces in
    `side_faces` (-1: -z, 1: +z).
    """
    g.add(k.box(k.paint(color), w, h, d, r, x, 0, z))
    ww, wh = win
    y = (h - wh) / 2 + 0.5
    for fz in front:
        g.add(winX(k, x + w / 2, y, z + fz, ww, wh))
    for bz in front if back is None else back:
        g.add(winX(k, x - w / 2, y, z + bz, ww, wh))
    for sx in sides:
        for s in side_faces:
            g.add(winZ(k, x + sx, y, z + s * d / 2, ww, wh))
    return g


# Each house: its storey walls (front windows for a plain storey, and for the ground storey beside the entrance),
# then its three pieces.


def _ground(k, color, w, d, front, ground, sides, win, entrance, r=3):
    g = _wall(k, Node(), color, w, d, STOREY, r=r, front=ground, back=front, sides=sides, win=win)
    g.add(entrance(k))
    return g


HOUSES = {
    # id: (wall colour, w, d, rounding, plain front windows, ground front windows, side windows, window size, entrance)
    "bldg-townhouse": ("#e7d6b8", 40, 30, 3, (-8, 8), (-10,), (-8, 8), (7, 9), H.townhouse_entrance),
    "bldg-thatched-cottage": (TOY.white, 40, 34, 3, (-8, 8), (8,), (-8, 8), (8, 8), H.thatched_cottage_entrance),
    "bldg-bungalow": ("#c9dcef", 40, 44, 2, (-13, 13), (-13, 13), (-8, 8), (10, 8), H.bungalow_entrance),
    "bldg-brick-house": (BRICK, 36, 40, 3, (-10, 8), (), (-6, 6), (8, 9), H.brick_house_entrance),
    "bldg-narrow-house": ("#c76b4f", 40, 26, 1.5, (-6, 6), (), (-10, 10), (6, 9), H.narrow_house_entrance),
    "bldg-corner-shop": ("#2f7a6e", 38, 36, 3, (-10, 10), (), (-8, 8), (8, 8), lambda k: H.corner_shop_entrance(k, 16)),
    "bldg-toy-shop": (TOY.purple, 44, 32, 3, (-10, 10), (), (-10, 10), (8, 8), lambda k: H.toy_shop_entrance(k, 16)),
}


def _house_pieces(house_id, upper):
    color, w, d, r, front, ground, sides, win, entrance = HOUSES[house_id]
    return [
        (f"{house_id}-ground", lambda k: _ground(k, color, w, d, front, ground, sides, win, entrance, r)),
        (f"{house_id}-floor", lambda k: _wall(k, Node(), color, w, d, STOREY, r=r, front=front, sides=sides, win=win)),
        (f"{house_id}-upper", lambda k: upper(k, door=False)),
    ]


def timber_house_floor(k, ground=False):
    """The timber house's storey: cream panels framed in oak, as its own ground floor is."""
    g = _wall(k, Node(), "#f0e3c6", 36, 32, STOREY, r=1.5, front=(-10, 10), sides=(0,), win=(6, 8))
    oak = k.paint("#5b3a22")
    for z in (-15, -5, 5, 15):
        g.add(k.box(oak, 1.6, STOREY, 2, 0.3, 18.2, 0, z))
    g.add(k.box(oak, 1.6, 2, 34, 0.3, 18.2, STOREY - 2, 0))
    if ground:
        g.add(H.timber_house_entrance(k))
    return g


def terrace_floor(k, ground=False):
    """A storey of the terrace: three houses' windows along the front (or their doors), the cream pilasters between."""
    front = (-48, -32, -8, 8, 32, 48)
    g = _wall(k, Node(), "#e4d2b0", 34, 120, STOREY, r=2, front=() if ground else front, back=front, sides=(-8, 8), win=(8, 8))
    for z in (-20, 20):
        g.add(k.box(k.paint(TOY.cream), 1.4, STOREY, 1.4, 0.3, 17.4, 0, z))
    if ground:
        g.add(H.terrace_entrance(k))
    return g


def semi_detached_floor(k, ground=False):
    """A storey of each half, in its own colour, windows on the outer ends only (or the halves' doors and porches)."""
    g = Node()
    for s, wall, _ in H.SEMI_HALVES:
        front = (s * 6, -s * 14)
        _wall(k, g, wall, 36, 56, STOREY, -4, s * 28, r=2, front=() if ground else front, back=front, sides=(-6, 6), side_faces=(s,), win=(9, 8))
    if ground:
        g.add(H.semi_detached_entrance(k))
    return g


def villa_floor(k, ground=False):
    """A storey of the villa, with its stone band along the top (or its porch and door)."""
    g = _wall(k, Node(), "#efe7d6", 40, 104, STOREY, r=2, front=(-40, -26, 26, 40), sides=(-8, 8), win=(8, 11))
    g.add(k.box(k.paint(STONE), 42, 2, 106, 0.6, 0, STOREY - 2, 0))
    if ground:
        g.add(H.villa_entrance(k))
    return g


def cottage_row_floor(k, ground=False):
    """A storey of the three cottages in their colours (built along x as the row is, then turned to face +x)."""
    g = Node()
    for i, wall in enumerate((TOY.pink, TOY.sky, TOY.yellow)):
        x = -34 + i * 34
        c = Node()
        c.add(k.box(k.paint(wall), 34, STOREY, 30, 3))
        y = (STOREY - 8) / 2 + 0.5
        c.add(winZ(k, 8, y, 15, 8, 8), winZ(k, 8, y, -15, 8, 8), winZ(k, -6, y, -15, 8, 8))
        c.add(H.cottage_row_entrance(k, i) if ground else winZ(k, -6, y, 15, 8, 8))
        if i != 1:
            c.add(winX(k, (i - 1) * 17, y, 0, 8, 8))
        g.add(k.at(c, x, 0, 0))
    return k.at(g, 0, 0, 0, math.pi / 2)


def apartment_block_floor(k, ground=False):
    """Another storey of flats (24 high, the block's own storeys): windows at its storeys' height, and a balcony along
    the front (or, on the ground, the front door and its canopy)."""
    h = APARTMENT_STOREY
    g = Node()
    g.add(k.box(k.paint(TOY.cream), 60, h, 48, 2))
    for z in (-16, 0, 16):
        g.add(winX(k, 30, 12, z, 8, 12), winX(k, -30, 12, z, 8, 12))
    for x in (-18, 0, 18):
        g.add(winZ(k, x, 12, 24, 8, 12), winZ(k, x, 12, -24, 8, 12))
    if ground:
        g.add(H.apartment_block_entrance(k))
    else:
        g.add(k.box(k.wood, 12, 2, 50, 0.5, 34, 8, 0))
        g.add(k.box(k.paint(TOY.orange), 1.4, 6, 50, 0.4, 39.4, 10, 0))
    return g


def _pieces(house_id, floor, upper):
    return [
        (f"{house_id}-ground", lambda k: floor(k, ground=True)),
        (f"{house_id}-floor", lambda k: floor(k)),
        (f"{house_id}-upper", lambda k: upper(k, door=False)),
    ]


ASSETS = [
    *_house_pieces("bldg-townhouse", H.townhouse),
    *_house_pieces("bldg-thatched-cottage", H.thatched_cottage),
    *_pieces("bldg-timber-house", timber_house_floor, H.timber_house),
    *_house_pieces("bldg-bungalow", H.bungalow),
    *_house_pieces("bldg-brick-house", H.brick_house),
    *_house_pieces("bldg-narrow-house", H.narrow_house),
    *_house_pieces("bldg-corner-shop", H.corner_shop),
    *_house_pieces("bldg-toy-shop", H.toy_shop),
    *_pieces("bldg-terrace", terrace_floor, H.terrace),
    *_pieces("bldg-semi-detached", semi_detached_floor, H.semi_detached),
    *_pieces("bldg-villa", villa_floor, H.villa),
    *_pieces("bldg-cottage-row", cottage_row_floor, H.cottage_row),
    *_pieces("bldg-apartment-block", apartment_block_floor, H.apartment_block),
]
