"""
The grand projects' finished stages (src/catalogue/assets/grand.ts), modelled in Blender.

    npm run models     # builds every model file (with `python3`, or $BLENDER_PYTHON), then compresses them

Writes tools/blender/grand.blend and tools/blender/out/grand.glb: one node per asset, named by its id
(`grand-cathedral-4`), in the same frame as grand.ts builds it (fronts facing +x, standing on y = 0).

Only the two buildings, finished: the Exhibition hall (3, and 4, its opening day) and the Cathedral (3, and 4, its
stained glass). They're a city's trophies, looked at close. The building sites (stages 0 to 2) stay in grand.ts, seen
for a while only; so do Grand Central (a kit piece: real track runs through it, src/track/kits.ts), the World's Fair
wheel (its gondolas tinted one by one as they're drawn) and the Royal Train (the game's own cars, royal-train.ts).

Ported from grand.ts line for line (kit.py mirrors the Kit). ONLY=<id>[,<id>...] builds just those, and NOEXPORT=1
checks the build without writing the .blend or the .glb.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit  # noqa: E402
import toy  # noqa: E402
from kit import TOY, Node  # noqa: E402

PI = math.pi

# Segments round an iron rib's tube (and a flying buttress's): thin, and many of them.
RIB_TUBE = 8

# Glass as the toys paint it: a pale sky-blue lacquer.
GLASS = "#bcdcea"
# The town buildings' colours (bldg_parts.py): printed-look windows, stone, frames.
WIN = "#2b3644"
STONE = "#b9b2a5"
FRAME = "#fbf6ec"
# Victorian ironwork, in the toy's green.
IRON = "#2d6b3f"


# ——— Shared parts (src/catalogue/build-parts.ts) ———


def pennant(k, color, h=30, x=0, y=0, z=0):
    k = k.small
    g = Node()
    g.add(k.cyl(k.wood, 0.9, h, 0, 0, 0, 0.9, 8))
    g.add(k.extrude(k.paint(color), [(0, 0), (14, -4), (0, -8)], 1, 1, h - 1, 0, 0.2))
    g.add(k.ball(k.paint(TOY.yellow), 1.6, 0, h + 1, 0))
    return k.at(g, x, y, z)


def vault(k, mat, r, length, x=0, y=0, z=0):
    """Half a barrel vault along x: radius r, `length` long, springing on y; a thin shell (the code's is a bare
    surface), its edges rounded."""
    n = 24
    t = 1.2
    outer = [(r * math.cos(PI * i / n), r * math.sin(PI * i / n)) for i in range(n + 1)]
    inner = [((r - t) * math.cos(PI * i / n), (r - t) * math.sin(PI * i / n)) for i in range(n, -1, -1)]
    # (Drawn across z in its outline's x, along x by the turn.)
    shell = k.extrude(mat, outer + inner, length, 0, 0, 0, 0.4)
    return k.at(shell, x, y, z, PI / 2)


def ribs(k, mat, r, length, n, x=0, y=0, z=0, tube=1.4):
    g = Node()
    for i in range(n):
        rib = k.ring(mat, r, tube, 0, 0, 0, True, PI, RIB_TUBE)
        rib.rotation.y = PI / 2
        rib.position.set(x - length / 2 + (length * i) / max(1, n - 1), y, z)
        g.add(rib)
    return g


# ——— The Grand Exhibition hall ———


def win_z(k, x, y, z, w=9, h=13):
    g = Node()
    g.add(k.box(k.paint(FRAME), w + 2, h + 2, 1, 0, 0, -1, 0), k.box(k.paint(WIN), w, h, 1.3, 0, 0, 0, 0))
    return k.at(g, x, y, z)


def win_x(k, x, y, z, w=9, h=13):
    return k.at(win_z(k, 0, 0, 0, w, h), x, y, z, PI / 2)


def vault_end(k, r, x, y, z=0):
    g = Node()
    pts = [(math.cos(i / 12 * PI) * r, math.sin(i / 12 * PI) * r) for i in range(13)]
    g.add(k.extrude(k.paint(GLASS), pts, 2, 0, 0, 0, 0.3))
    g.add(k.ring(k.paint(IRON), r, 2, 0, 0, 0, True, PI, RIB_TUBE))
    for a in (PI / 4, PI / 2, 3 * PI / 4):
        # (A bar from the middle out: its foot at the turn.)
        bar = Node()
        bar.add(k.box(k.paint(IRON), 2, r, 2.6, 0, 0, 0, 0))
        bar.rotation.z = a - PI / 2
        g.add(bar)
    g.add(k.box(k.paint(IRON), 2 * r, 2.4, 2.6, 0.6, 0, 0, 0))
    return k.at(g, x, y, z, PI / 2)


def glass_vault(k, r, length, x, y, z, glazed=None):
    glazed = length if glazed is None else glazed
    g = Node()
    n = max(2, round(length / 26))
    g.add(ribs(k, k.paint(IRON), r + 0.5, length, n + 1, x, y, z, 2.2))
    if glazed > 0:
        # (A little shorter than the ridge and purlins over it: their ends were in one plane.)
        g.add(vault(k, k.paint(GLASS), r, glazed - 0.4, x - length / 2 + glazed / 2, y, z))
        g.add(k.box(k.paint(IRON), glazed, 3, 4, 1, x - length / 2 + glazed / 2, y + r - 1, z))
        for s in (-1, 1):
            p = k.box(k.paint(IRON), glazed, 2, 2.5, 0, 0, 0, 0)
            p.position.set(x - length / 2 + glazed / 2, y + r * math.sin(PI / 4) - 1, z + s * r * math.cos(PI / 4))
            p.rotation.x = -s * (PI / 4)
            g.add(p)
    return g


def porch(k, x, y):
    g = Node()
    cream = k.paint(TOY.cream)
    g.add(k.box(cream, 26, 30, 40, 3, 0, 0, 0))
    # (27 deep, not 28: its back was in one plane with the hall's glass end.)
    ped = k.extrude(cream, [(-22, 0), (22, 0), (0, 12)], 27, 0, 0, 0, 0.6)
    ped.rotation.y = PI / 2
    ped.position.y += 30
    g.add(ped)
    g.add(k.box(k.paint(TOY.red), 1.4, 18, 12, 0.8, 13.4, 0, 0), k.box(k.paint(TOY.yellow), 1.6, 1.6, 4, 0.4, 14, 9, 3))
    for z in (-13, 13):
        g.add(win_x(k, 13.4, 12, z, 7, 11))
    # The clock lantern.
    g.add(k.box(k.paint(TOY.white), 12, 10, 12, 1.4, 0, 40, 0))
    g.add(k.cylX(k.paint(TOY.white), 3.8, 1.2, 6.4, 45, 0, 16), k.box(k.paint(TOY.black), 0.6, 3, 0.6, 0, 7.1, 45, 0), k.box(k.paint(TOY.black), 0.6, 0.6, 2.4, 0, 7.1, 45, 1))
    cap = k.cone(k.paint(TOY.teal), 10.6, 9, 0, 50, 0, 4)
    cap.rotation.y = PI / 4
    g.add(cap, k.ball(k.paint(TOY.yellow), 1.6, 0, 60, 0))
    return k.at(g, x, y, 0)


def lamp_post(k, x, y, z):
    k = k.small
    g = Node()
    g.add(k.cyl(k.paint(TOY.black), 2.4, 3, 0, 0, 0, 2, 10), k.cyl(k.paint(TOY.black), 1, 26, 0, 3, 0, 1, 8))
    g.add(k.ball(k.paint(TOY.yellow), 2.8, 0, 31, 0), k.cone(k.paint(TOY.black), 3, 3, 0, 33, 0, 8))
    return k.at(g, x, y, z)


def bunting(k, x0, z0, x1, z1, y):
    k = k.small
    g = Node()
    length = math.hypot(x1 - x0, z1 - z0)
    ry = -math.atan2(z1 - z0, x1 - x0)
    cord = k.box(k.paint(TOY.white), length, 0.6, 0.6, 0, 0, 0, 0)
    cord.position.set((x0 + x1) / 2, y, (z0 + z1) / 2)
    cord.rotation.y = ry
    g.add(cord)
    n = max(3, round(length / 9))
    colors = [TOY.red, TOY.yellow, TOY.blue, TOY.green, TOY.orange]
    for i in range(n):
        t = (i + 0.5) / n
        # (0.5 thick, inside the cord's 0.6: as thick, their faces were in its planes.)
        tri = k.extrude(k.paint(colors[i % len(colors)]), [(-3, 0), (3, 0), (0, -6)], 0.5, 0, 0, 0, 0)
        tri.position.set(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t)
        tri.rotation.y = ry
        g.add(tri)
    return g


def elm(k, x, z):
    k = k.small
    g = Node()
    g.add(k.cyl(k.paint(TOY.cream), 7, 3, 0, 0, 0, 7, 10), k.cyl(k.paint("#8a5a34"), 3, 34, 0, 3, 0, 2.4, 8))
    for dx, dy, dz, r in ((0, 44, 0, 16), (-7, 34, 5, 11)):
        g.add(k.ball(k.paint(TOY.leaf), r, dx, dy, dz))
    return k.at(g, x, 0, z)


def statue(k, x, y, z):
    k = k.small
    g = Node()
    gilt = k.paint("#d9a441")
    g.add(k.box(k.paint(STONE), 12, 14, 12, 0, 0, 0, 0), k.box(k.paint(FRAME), 14, 2, 14, 0, 0, 14, 0))
    g.add(k.cyl(gilt, 3.6, 11, 0, 16, 0, 2.8, 10), k.ball(gilt, 2.8, 0, 29, 0))
    arm = k.box(gilt, 1.6, 8, 1.6, 0, 0, 0, 0)
    arm.position.set(2.6, 28, 0)
    arm.rotation.z = -0.5
    g.add(arm)
    return k.at(g, x, y, z)


def stand(k, x, z, a, ry=0):
    k = k.small
    g = Node()
    g.add(k.box(k.wood, 18, 10, 10, 0, 0, 0, 0))
    for j in range(4):
        g.add(k.box(k.paint(TOY.white if j % 2 else a), 4.8, 1.2, 14, 0, -7.2 + j * 4.8, 22, 0))
    for dx in (-8, 8):
        g.add(k.cyl(k.wood, 0.8, 12, dx, 10, -5, 0.8, 6))
    g.add(k.ball(k.paint(TOY.red), 2.4, -4, 12.4, 0), k.box(k.paint(TOY.blue), 4, 4, 4, 0, 3, 10, 0), k.cyl(k.paint(TOY.yellow), 2, 5, 7, 10, 1, 2, 8))
    return k.at(g, x, 0, z, ry)


def flourishes(k, L, W, top, y0):
    """The Exhibition's opening day (stage 4)."""
    g = Node()
    iron = k.paint(IRON)
    gold = k.paint("#d9a441")
    fx = L / 2 + 26
    g.add(k.box(k.paint("#d9cdb6"), 90, 1, 22, 0.4, fx + 45, y0, 0))
    for s in (-1, 1):
        g.add(lamp_post(k, fx + 60, y0, s * 16))
        g.add(bunting(k, fx + 10, s * 18, fx + 30, s * 16, y0 + 26), bunting(k, fx + 30, s * 16, fx + 60, s * 16, y0 + 26), bunting(k, fx + 60, s * 16, fx + 86, s * 20, y0 + 26))
    # The crystal fountain.
    cx = fx + 45
    g.add(k.cyl(k.paint(STONE), 15, 5, cx, y0, 0, 15, 16), k.cyl(k.water, 13, 1, cx, y0 + 4.6, 0, 13, 16))
    g.add(k.lathe(k.paint(GLASS), [(0.1, 0), (3, 0), (3, 10), (9, 12), (2.4, 14), (2.4, 22), (6, 24), (1.6, 26), (0.1, 30)], cx, y0 + 5, 0, 12))
    g.add(k.ball(k.paint(FRAME), 2.4, cx, y0 + 36, 0))
    # The gates.
    gx = fx + 90
    for s in (-1, 1):
        g.add(k.box(k.paint(STONE), 9, 28, 9, 0, gx, y0, s * 19), k.ball(gold, 3, gx, y0 + 31, s * 19))
        for i in range(4):
            g.add(k.box(iron, 1.2, 20, 1.2, 0, gx, y0, s * (5 + i * 3.4)))
        g.add(k.box(iron, 1.4, 1.4, 14, 0, gx, y0 + 18, s * 10))
        for i in range(4):
            g.add(k.box(iron, 1.2, 14, 1.2, 0, gx, y0, s * (28 + i * 6)))
        g.add(k.box(iron, 1.4, 1.4, 24, 0, gx, y0 + 13, s * 37))
    g.add(k.at(k.ring(iron, 15, 1.6, 0, 0, 0, True, PI), gx, y0 + 22, 0, PI / 2))
    g.add(k.cylX(gold, 5, 1.6, gx, y0 + 40, 0, 14), k.cylX(k.paint("#b0283a"), 3, 2, gx, y0 + 40, 0, 10))
    for s in (-1, 1):
        g.add(statue(k, gx - 14, y0, s * 30))
    # The clock over the entrance.
    g.add(k.cylX(k.paint(FRAME), 10, 1.6, L / 2 + 2, top + 3 + 22, 0, 18), k.at(k.ring(gold, 10.5, 1.2, 0, 0, 0, True), L / 2 + 2.6, top + 25, 0, PI / 2))
    g.add(k.box(k.paint(TOY.black), 1, 8, 1, 0, L / 2 + 3, top + 25, 0), k.box(k.paint(TOY.black), 1, 1, 6, 0, L / 2 + 3, top + 25, 2.4))
    for s in (-1, 1):
        g.add(stand(k, 60, s * (W / 2 + 22), TOY.red if s > 0 else TOY.blue, 0 if s > 0 else PI))
        g.add(elm(k, -50, s * (W / 2 + 62)))
    g.add(k.small.peg(TOY.green, None, cx - 14, y0, 10), k.small.peg(TOY.pink, TOY.yellow, cx + 14, y0, -10), k.small.peg(TOY.yellow, TOY.red, gx + 8, y0, 4))
    return g


def exhibition(k, stage):
    g = Node()
    L, W, WALL = 220, 80, 22
    cream = k.paint(TOY.cream)
    iron = k.paint(IRON)
    g.add(k.box(k.paint(STONE), L + 60, 2, W + 70, 0.8, 0, 0, 0))
    g.add(k.box(k.wood, L + 50, 2, W + 60, 1, 0, 2, 0))
    if stage < 4:
        # (The grounds as wide as opening day's: EXHIBITION_SITE.)
        g.add(k.box(k.paint("#d9cdb6"), 238 + 140, 0.6, 236, 0.2, (238 - 140) / 2, 0, 0))
    y0 = 4
    for s in (-1, 1):
        g.add(k.box(cream, L, WALL, 8, 3, 0, y0, s * (W / 2 - 4)))
        for i in range(9):
            g.add(win_z(k, -L / 2 + 14 + i * ((L - 28) / 8), y0 + 6, s * W / 2 + s * 0.4))
        for i in range(9):
            # (3.8 wide, not grand.ts's 4: their sides were in one plane with the windows' frames.)
            g.add(k.box(iron, 3.8, WALL + 2, 4, 0, -L / 2 + (L * i) / 8, y0, s * (W / 2 + 1)))
    g.add(k.box(cream, 8, WALL, W, 3, -L / 2 + 4, y0, 0))
    g.add(k.box(cream, 8, WALL, W, 3, L / 2 - 4, y0, 0))
    top = y0 + WALL
    for s in (-1, 1):
        # (grand.ts: L + 4, flush with the end columns' faces; a little past them, so the two don't fight.)
        g.add(k.box(k.paint(TOY.white), L + 5, 3, 10, 1, 0, top, s * (W / 2 - 3)))
    g.add(glass_vault(k, W / 2, L, 0, top + 3, 0))
    g.add(vault_end(k, W / 2, -L / 2, top + 3), vault_end(k, W / 2, L / 2, top + 3))
    # The transept.
    T = 64
    TW = W + 50
    for s in (-1, 1):
        g.add(k.box(cream, T, WALL + 6, 8, 3, 0, y0, s * (TW / 2 - 4)))
        for dx in (-16, 16):
            g.add(win_z(k, dx, y0 + 6, s * TW / 2 + s * 0.4, 9, 16))
        for sx in (-1, 1):
            g.add(k.box(cream, 8, WALL + 6, (TW - W) / 2, 3, sx * (T / 2 - 4), y0, s * (W / 2 + (TW - W) / 4)))
    tv = Node()
    tv.add(glass_vault(k, T / 2, TW, 0, 0, 0))
    tv.add(vault_end(k, T / 2, -TW / 2, 0), vault_end(k, T / 2, TW / 2, 0))
    tv.rotation.y = PI / 2
    tv.position.set(0, top + 9, 0)
    g.add(tv)
    g.add(k.box(k.paint(TOY.white), T + 4, 3, TW + 4, 1, 0, top + 6, 0))
    g.add(k.cyl(k.paint(FRAME), 9, 10, 0, top + 9 + T / 2, 0, 9, 10), k.cone(k.paint(TOY.teal), 11, 12, 0, top + 19 + T / 2, 0, 10))
    g.add(pennant(k, TOY.red, 22, 0, top + 31 + T / 2, 0))
    for fx in (-L / 2 + 22, -60, 60, L / 2 - 22):
        g.add(pennant(k, TOY.blue if fx < 0 else TOY.yellow, 18, fx, top + 3 + W / 2, 0))
    g.add(porch(k, L / 2 + 13, y0))
    g.add(k.box(k.paint("#d9cdb6"), 22, 1, 20, 0.4, L / 2 + 37, y0, 0))
    for s in (-1, 1):
        g.add(lamp_post(k, L / 2 + 36, y0, s * 18))
    g.add(k.small.peg(TOY.red, TOY.black, L / 2 + 40, y0, 6), k.small.peg(TOY.blue, None, L / 2 + 44, y0, -6), k.small.peg(TOY.purple, TOY.yellow, L / 2 + 34, y0, -2))
    if stage == 4:
        g.add(flourishes(k, L, W, top, y0))
    return g


# ——— The cathedral ———

JEWELS = ("#b0283a", "#2f5fb5", "#e3a92c", "#2d8a55", "#7a3f9a")
CLEAR = "#5d7488"
CATHEDRAL_SCALE = 1.2


def lancet(k, x, y, z, w, h, color):
    g = Node()
    pts = [(-w / 2, 0), (w / 2, 0), (w / 2, h - w * 0.7), (0, h), (-w / 2, h - w * 0.7)]
    g.add(k.extrude(k.paint(color), pts, 1.4, 0, 0, 0, 0))
    return k.at(g, x, y, z)


def rose(k, r, stained, x, y, z, ry=0):
    g = Node()
    g.add(k.ring(k.paint("#e8dfcc"), r, 2.2, 0, 0, 0, True))
    g.add(k.cylZ(k.paint("#2f5fb5" if stained else CLEAR), r, 1.2, 0, 0, 0, 16))
    if stained:
        for i in range(8):
            a = i / 8 * PI * 2
            g.add(k.cylZ(k.paint(JEWELS[i % len(JEWELS)]), r * 0.26, 1.8, math.cos(a) * r * 0.62, math.sin(a) * r * 0.62, 0, 10))
        g.add(k.cylZ(k.paint("#e3a92c"), r * 0.28, 2, 0, 0, 0, 10))
    else:
        for a in (0, PI / 4, PI / 2, 3 * PI / 4):
            bar = k.box(k.paint("#e8dfcc"), 2 * r, 1.6, 2, 0, 0, 0, 0)
            bar.position.set(0, 0, 0)
            bar.rotation.z = a
            g.add(bar)
    return k.at(g, x, y, z, ry)


def cathedral(k, stage):
    g = Node()
    stone = k.paint("#ded3bd")
    trim = k.paint("#c4b79d")
    roof_m = k.paint("#556a80")
    gold = k.paint("#e3a92c")
    stained = stage >= 4
    wi = [0]

    def glass():
        c = JEWELS[wi[0] % len(JEWELS)] if stained else CLEAR
        wi[0] += 1
        return c

    L, W, AW, H, AH = 200, 56, 26, 80, 42
    TX, TW, TL = -40, 56, W + 2 * AW + 60
    TOWER, TH = 42, 175
    g.add(k.box(k.paint(STONE), L + 140, 2, TL + 50, 0.8, -10, 0, 0))
    g.add(k.box(k.wood, L + 130, 2, TL + 40, 1, -10, 2, 0))
    y0 = 4
    h, ah, th = H, AH, TH
    # Aisles, nave, transept and apse.
    for s in (-1, 1):
        g.add(k.box(stone, L - 20, ah, AW, 2, -10, y0, s * (W / 2 + AW / 2)))
    g.add(k.box(stone, L, h, W, 2, 0, y0, 0))
    g.add(k.box(stone, TW, h, TL, 2, TX, y0, 0))
    g.add(k.cyl(stone, W / 2, h, -L / 2, y0, 0, W / 2, 12))
    bays = (-70, -10, 20, 50, 80)
    for s in (-1, 1):
        for bx in bays:
            g.add(k.box(trim, 9, min(ah + 8, AH + 8), 9, 1, bx, y0, s * (W / 2 + AW + 3)))
            g.add(k.cone(trim, 5, 14, bx, y0 + AH + 8, s * (W / 2 + AW + 3), 4))
    for s in (-1, 1):
        g.add(k.box(stone, TOWER, th, TOWER, 2, L / 2 + TOWER / 2 - 4, y0, s * (W / 2 + AW - TOWER / 2)))
    for s in (-1, 1):
        for bx in (-55, -25, 5, 35, 65):
            g.add(lancet(k, bx, y0 + 10, s * (W / 2 + AW + 0.4), 9, min(24, ah - 14), glass()))
            g.add(lancet(k, bx, y0 + AH + 10, s * (W / 2 + 0.4), 10, 26, glass()))
    # Roofs.
    top = y0 + H
    g.add(k.roof(roof_m, L, W + 6, 50, 0, top, 0, 3.5))
    tr = k.roof(roof_m, TL, TW + 6, 50, 0, 0, 0, 3.5)
    tr.rotation.y = PI / 2
    g.add(k.at(tr, TX, top, 0))
    for s in (-1, 1):
        ar = k.box(roof_m, L - 20, 3, AW + 8, 1, 0, 0, 0)
        ar.position.set(-10, y0 + AH + 6, s * (W / 2 + AW / 2))
        ar.rotation.x = s * 0.45
        g.add(ar)
    g.add(k.cone(roof_m, W / 2 + 3, 40, -L / 2, top, 0, 12))
    # Flying buttresses.
    for s in (-1, 1):
        for bx in bays:
            fly = k.ring(trim, AW + 3, 2.4, 0, 0, 0, True, PI / 2, RIB_TUBE)
            fly.rotation.y = -PI / 2 if s > 0 else PI / 2
            fly.position.set(bx, y0 + AH + 6, s * (W / 2))
            g.add(fly)
    # The crossing.
    g.add(k.box(stone, 34, 30, 34, 2, TX, top + 30, 0))
    for s in (-1, 1):
        g.add(lancet(k, TX, top + 36, s * 17.4, 8, 18, glass()))
    g.add(k.cone(roof_m, 22, 90, TX, top + 60, 0, 8))
    g.add(k.box(gold, 1.6, 16, 1.6, 0, TX, top + 150, 0), k.box(gold, 1.6, 1.6, 9, 0, TX, top + 160, 0))
    # The towers' tops.
    for s in (-1, 1):
        tx, tz = L / 2 + TOWER / 2 - 4, s * (W / 2 + AW - TOWER / 2)
        g.add(k.box(trim, TOWER + 4, 4, TOWER + 4, 1, tx, y0 + TH - 40, tz))
        for d in (-1, 1):
            g.add(lancet(k, tx + d * 9, y0 + TH - 32, tz + s * (TOWER / 2 + 0.4), 7, 24, "#2b3644"))
        for px, pz in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            g.add(k.cone(trim, 5, 22, tx + px * (TOWER / 2 - 4), y0 + TH, tz + pz * (TOWER / 2 - 4), 4))
        spire = k.cone(roof_m, 18, 64, tx, y0 + TH, tz, 4)
        spire.rotation.y = PI / 4
        g.add(spire)
        g.add(k.ball(gold, 2.4, tx, y0 + TH + 66, tz))
    # The west front.
    fx = L / 2
    gable = k.extrude(stone, [(-W / 2, 0), (W / 2, 0), (0, 50)], 6, 0, 0, 0, 0)
    gable.rotation.y = PI / 2
    # (grand.ts: translateY(top), then translateZ(fx) along its turned z, which is +x.)
    gable.position.set(fx, top, 0)
    g.add(gable)
    g.add(rose(k, 17, stained, fx + 0.8, y0 + 56, 0, PI / 2))
    for z, w, hh in ((0, 18, 34), (-(W / 2 + AW - TOWER / 2), 12, 26), (W / 2 + AW - TOWER / 2, 12, 26)):
        portal = k.extrude(k.paint("#5a3a22"), [(-w / 2, 0), (w / 2, 0), (w / 2, hh - w * 0.6), (0, hh), (-w / 2, hh - w * 0.6)], 2, 0, 0, 0, 0)
        g.add(k.at(portal, fx + 1 if z == 0 else fx + TOWER - 3, y0, z, PI / 2))
    for s in (-1, 1):
        g.add(rose(k, 14, stained, TX, y0 + 52, s * (TL / 2 + 0.8)))
    if stained:
        g.add(pennant(k, TOY.red, 22, fx + 30, y0, -26), pennant(k, TOY.blue, 22, fx + 30, y0, 26))
        g.add(k.box(k.paint("#d9cdb6"), 40, 1, 22, 0.4, fx + 30, y0, 0))
        g.add(k.small.peg(TOY.white, None, fx + 24, y0, 3), k.small.peg(TOY.black, TOY.black, fx + 24, y0, -5), k.small.peg(TOY.pink, TOY.yellow, fx + 34, y0, 8), k.small.peg(TOY.purple, None, fx + 36, y0, -9))
    # Drawn a fifth bigger than it's modelled: the biggest thing in a city.
    g.scale.setScalar(CATHEDRAL_SCALE)
    return g


MODELS = [
    ("grand-exhibition-3", lambda k: exhibition(k, 3)),
    ("grand-exhibition-4", lambda k: exhibition(k, 4)),
    ("grand-cathedral-3", lambda k: cathedral(k, 3)),
    ("grand-cathedral-4", lambda k: cathedral(k, 4)),
]


def main():
    toy.reset()
    only = set(filter(None, os.environ.get("ONLY", "").split(",")))
    for i, (asset_id, build) in enumerate(MODELS):
        if only and asset_id not in only:
            continue
        toy.begin()
        k = kit.Kit()
        # The small parts there are many of (people, lamps, flags, trees): lean, as the towns' doors are (kit.py).
        k.small = kit.Kit(lean=True)
        root = build(k)
        pivots = kit.realize(root, asset_id)
        toy.finish(asset_id, (i % 2 * 600, -(i // 2) * 600, 0), pivots)
    print(f"{len(MODELS)} models")
    if not os.environ.get("NOEXPORT"):
        toy.save_and_export("grand")


main()
