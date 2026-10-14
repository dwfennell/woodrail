"""People for life.py: railway staff and townsfolk, ported from src/catalogue/assets/life.ts."""

import math

from kit import TOY, Node
from life_parts import (  # noqa: F401
    GOLD, HAND, SILVER, STRAW, apron, arm, band, band_hat, beak, boater, bobble_hat, bowler, bucket_hat, buttons, cap, dome,
    egg, eyes, fire_helmet, flag, hard_hat, hold, kepi, lantern, person, pillbox, pivot, police_helmet, rod, souwester,
    straw_hat, suitcase, toque, top_hat, r_at,
)


def driver(k):
    g = person(k, TOY.blue, legs="#244f86")
    g.add(band(k, TOY.red, 9.6, 11))
    g.add(apron(k, "#244f86", 3.6, 9.5, 4))
    g.add(cap(k, "#264a7a", TOY.black), k.cyl(k.paint(TOY.white), 3.8, 0.5, 0, 17.4, 0, 3.8, 24))
    can = k.group(k.cyl(k.paint(TOY.grey), 1.6, 2.6, 0, -3.2, 0), k.cone(k.paint(TOY.grey), 1.6, 1.2, 0, -0.6, 0, 12), rod(k, k.paint(TOY.grey), (0.5, -1.5, 0), (4, 0.5, 0), 0.3))
    g.add(hold(arm(k, TOY.blue, 1, 0.3), can, 0, 0, 0.8).parent)
    g.add(arm(k, TOY.blue, -1, 2.7, "wave"))
    return g


def conductor(k):
    coat = "#7b2333"
    g = person(k, coat, legs=TOY.black)
    g.add(buttons(k, GOLD, [5, 7, 9]))
    g.add(cap(k, coat, TOY.black), k.cyl(k.paint(GOLD), 3.66, 0.5, 0, 16.2, 0, 3.7, 24))
    g.add(hold(arm(k, coat, 1, 2.4), flag(k, TOY.leaf), 0, 0, 0.4).parent)
    whistle = k.cylX(k.paint(SILVER), 0.6, 2, 1.2, 0, 0, 10)
    g.add(hold(arm(k, coat, -1, 0.5), whistle).parent)
    return g


def station_master(k):
    coat = "#1f2f57"
    g = person(k, coat, legs=TOY.black)
    g.add(k.cyl(k.paint(coat), 4.5, 3, 0, 0, 0, 4.25, 24))
    g.add(buttons(k, GOLD, [4.5, 6.3, 8.1]))
    g.add(band(k, GOLD, 6.9, 7.4, 0.25))
    g.add(kepi(k, coat))
    g.add(k.box(k.paint(TOY.white), 0.6, 1.4, 2.4, 0.2, 3.4, 9.6, 0))
    watch = k.group(k.cylX(k.paint(GOLD), 1.5, 0.6, 0, -0.3, 0, 16), k.cylX(k.paint(TOY.cream), 1.1, 0.7, 0.05, -0.3, 0, 16))
    g.add(hold(arm(k, coat, -1, 1.3, "watch-arm"), watch, 0.6, 0, -0.5).parent)
    g.add(arm(k, coat, 1, 0.1))
    return g


def guard(k):
    coat = "#2d5b3a"
    g = person(k, coat, legs=TOY.black)
    g.add(buttons(k, SILVER, [5, 7, 9]))
    g.add(band(k, TOY.black, 5.6, 6.4, 0.25))
    # Added: a silver buckle on the belt.
    g.add(k.box(k.paint(SILVER), 0.5, 1.1, 1.4, 0.15, r_at(6) + 0.45, 6, 0))
    g.add(cap(k, coat, TOY.black))
    a = arm(k, coat, 1, 0.5, "lamp-arm")
    l = hold(a, lantern(k, TOY.red), 0, 1, 0.5)
    l.name = "lamp"
    g.add(a, arm(k, coat, -1, 0.05))
    return g


def porter(k):
    g = Node()
    coat = "#6b3f22"
    p = person(k, TOY.cream, legs=TOY.black)
    p.add(apron(k, coat, 4, 10, 5), cap(k, coat, TOY.black))
    p.add(arm(k, TOY.cream, 1, 1.2), arm(k, TOY.cream, -1, 1.2))
    g.add(k.at(p, -15, 0, 0))
    # The barrow.
    blk = k.paint(TOY.black)
    g.add(k.box(k.wood, 24, 2, 14, 0.8, 4, 4.5, 0))
    for x in (-5, 13):
        for z in (-6, 6):
            g.add(k.cylZ(blk, 2.4, 1.6, x, 2.4, z * 1.05, 16))
    for z in (-5.5, 5.5):
        g.add(rod(k, k.paint(TOY.green), (-7.5, 6.5, z), (-10, 8.2, z), 0.5))
    g.add(k.cylZ(k.paint(TOY.green), 0.6, 12, -10, 8.2, 0, 10))
    # The luggage.
    g.add(k.box(k.paint(TOY.brown), 10, 6, 11, 1, 0, 6.5, 0))
    g.add(k.box(k.paint(GOLD), 10.2, 0.8, 11.2, 0.3, 0, 9, 0))
    g.add(k.box(k.paint(TOY.blue), 8, 3, 6, 0.8, 0.5, 12.5, -1.5))
    g.add(k.box(k.paint(TOY.red), 6, 2.6, 5, 0.8, 0, 15.5, -1))
    g.add(k.cyl(k.paint(TOY.pink), 3.2, 3.5, 10, 6.5, 2.8, 3.2, 20), k.cyl(k.paint(TOY.white), 3.3, 0.7, 10, 9.4, 2.8, 3.3, 20))
    g.add(k.box(k.paint(TOY.green), 5, 5, 3, 0.8, 11, 6.5, -4))
    return g


def signal_operator(k):
    g = Node()
    p = person(k, TOY.white, legs=TOY.black, hair=TOY.brown)
    p.add(apron(k, TOY.black, 4, 10, 5.5), band(k, TOY.red, 7.2, 7.6, 0.3))
    p.add(arm(k, TOY.white, 1, 1.25), arm(k, TOY.white, -1, 1.25, "op-arm"))
    g.add(k.at(p, -2, 0, 0))
    g.add(k.box(k.cut, 6, 3, 28, 1, 9, 0, 0))
    cols = [TOY.red, TOY.red, TOY.yellow, TOY.black, TOY.blue]
    for i, c in enumerate(cols):
        z = -10 + i * 5
        lever = pivot(
            f"lever-{i}", 9, 3, z,
            rod(k, k.metal, (0, 0, 0), (0, 12, 0), 0.55, 0.45),
            rod(k, k.paint(c), (0, 6, 0), (0, 10, 0), 0.75),
            k.cylX(k.paint(SILVER), 0.7, 1.6, 0, 12.4, 0, 10),
        )
        lever.rotation.z = 0.5 if i == 3 else -0.25
        g.add(lever)
    return g


def child_balloon(k):
    g = person(k, TOY.yellow, legs=TOY.blue)
    g.add(bobble_hat(k, TOY.red, TOY.white), buttons(k, TOY.blue, [5, 7.5]))
    a = arm(k, TOY.yellow, 1, 2.2)
    a.add(pivot(
        "balloon", 0, HAND, 0,
        rod(k, k.paint(TOY.white), (0, 0, 0), (0, 14, 0), 0.15, 0.15, 6),
        egg(k, k.paint(TOY.red), 3, 0, 17, 0, 1, 1.15, 1),
        k.cone(k.paint(TOY.red), 0.7, 1, 0, 13.5, 0, 8),
    ))
    a.children[-1].rotation.z = -2.2
    g.add(a, arm(k, TOY.yellow, -1, 0.1))
    g.scale.setScalar(0.72)
    return k.group(g)


def grandparent(k):
    g = person(k, TOY.purple, legs=TOY.grey, hair="#cfcfcf")
    g.add(k.ball(k.paint("#cfcfcf"), 1.8, -3.1, 16.3, 0))
    g.add(band(k, TOY.cream, 9.8, 11, 0.3))
    glasses = k.paint(TOY.black)
    for z in (-1.3, 1.3):
        g.add(k.ring(glasses, 0.95, 0.18, 3.25, 14.6, z, True))
    for r in g.children[-2:]:
        r.rotation.y = math.pi / 2
    a = arm(k, TOY.purple, 1, 0.45)
    hold(a, k.group(rod(k, k.paint(TOY.brown), (0, 0.5, 0), (0, -5, 0), 0.45), k.ring(k.paint(TOY.brown), 0.9, 0.45, -0.9, 0.5, 0, True, math.pi)), 0, 0, 0.5)
    g.add(a, arm(k, TOY.purple, -1, 0.1))
    g.add(k.box(k.paint(TOY.red), 4, 3.2, 1.8, 0.6, 0, 1.6, -5.4))
    return g


def traveller(k):
    g = person(k, TOY.green, legs=TOY.grey)
    g.add(bowler(k, TOY.black), buttons(k, TOY.black, [5, 7, 9]), band(k, TOY.cream, 10, 11, 0.25))
    a = arm(k, TOY.green, 1, 0.05)
    hold(a, suitcase(k, TOY.brown), 0, 1.4, 1.4)
    g.add(a, arm(k, TOY.green, -1, 0.15))
    return g


def tourist(k):
    g = person(k, TOY.orange, legs=TOY.sky)
    g.add(bucket_hat(k, TOY.cream))
    g.add(k.box(k.paint(TOY.green), 3, 6, 5.5, 1.2, -4.2, 4.5, 0))
    cam = Node()
    cam.add(k.box(k.paint(TOY.black), 2.2, 2.4, 4.2, 0.5, 0, -1.2, 0))
    cam.add(k.cylX(k.paint(TOY.grey), 0.9, 1.4, 1.5, 0, 0, 12))
    cam.add(pivot("flash", 0, 1.2, 1.4, k.ball(k.paint(TOY.white), 0.7, 0, 0, 0)))
    a = arm(k, TOY.orange, 1, 1.9)
    b = arm(k, TOY.orange, -1, 1.9)
    a.rotation.x = 0.25
    b.rotation.x = -0.25
    g.add(a, b)
    g.add(k.at(cam, 6, 12.4, 0))
    return g


def farmer(k):
    g = person(k, TOY.red, legs=TOY.blue)
    g.add(band(k, TOY.blue, 3.6, 6.5), apron(k, TOY.blue, 6, 9.6, 3.6), straw_hat(k))
    for y in (7.6, 9):
        g.add(k.box(k.paint(TOY.white), 0.4, 0.4, 7, 0.1, r_at(y), y, 0))
    fork = k.group(rod(k, k.paint(TOY.brown), (0, -4, 0), (0, 14, 0), 0.4))
    for z in (-1, 0, 1):
        fork.add(rod(k, k.metal, (0, 14, z), (0, 17.5, z), 0.25))
    fork.add(k.cylZ(k.metal, 0.3, 2.4, 0, 14, 0, 8))
    a = arm(k, TOY.red, 1, 0.6)
    # Leaning out from the shoulder, so the fork clears the straw hat's wide brim.
    hold(a, fork, 0, 0, 0.3).rotation.x = 0.42
    g.add(a, arm(k, TOY.red, -1, 0.1))
    return g


ASSETS = [
    ("life-driver", driver),
    ("life-conductor", conductor),
    ("life-station-master", station_master),
    ("life-guard", guard),
    ("life-porter", porter),
    ("life-signal-operator", signal_operator),
    ("life-child-balloon", child_balloon),
    ("life-grandparent", grandparent),
    ("life-traveller", traveller),
    ("life-tourist", tourist),
    ("life-farmer", farmer),
]
