"""People for life.py: townsfolk at work and play, ported from src/catalogue/assets/life.ts."""

import math

from kit import TOY, Node
from life_parts import (  # noqa: F401
    GOLD, HAND, SILVER, STRAW, apron, arm, band, band_hat, beak, boater, bobble_hat, bowler, bucket_hat, buttons, cap,
    dome, egg, eyes, fire_helmet, flag, hard_hat, hold, kepi, lantern, person, pillbox, pivot, police_helmet, r_at, rod,
    souwester, straw_hat, suitcase, toque, top_hat,
)


def fisher(k):
    g = Node()
    g.add(k.box(k.wood, 10, 6, 10, 0.8, 0, 0, 0))
    for y in (2, 4):
        g.add(k.box(k.cut, 10.2, 0.5, 10.2, 0, 0, y, 0))
    p = person(k, TOY.yellow, legs=TOY.yellow)
    p.add(souwester(k, TOY.yellow), buttons(k, TOY.black, [5, 7.5]))
    a = arm(k, TOY.yellow, 1, 1.1, "rod-arm")
    hold(a, k.group(
        rod(k, k.paint(TOY.brown), (0, 0, 0), (16, 14, 0), 0.4, 0.2),
        rod(k, k.paint(TOY.white), (16, 14, 0), (16, -6, 0), 0.08, 0.08, 4),
        k.ball(k.paint(TOY.red), 0.8, 16, -5, 0),
    ), 0, 0, 0.3)
    p.add(a, arm(k, TOY.yellow, -1, 0.9))
    g.add(k.at(p, -1, 6, 0))
    g.add(k.cyl(k.paint(TOY.blue), 2.8, 4.5, -2, 0, 9, 3.4, 16), k.ring(k.paint(TOY.grey), 2.6, 0.2, -2, 6.5, 9, True, math.pi))
    g.add(egg(k, k.paint(TOY.orange), 1.2, -2, 4.6, 9, 2, 0.8, 0.8))
    return g


def firefighter(k):
    coat = "#26324f"
    g = person(k, coat, legs=coat)
    g.add(band(k, TOY.yellow, 2.4, 3.2, 0.25), band(k, TOY.yellow, 6.5, 7.3, 0.25), fire_helmet(k, TOY.red))
    hose = k.paint(TOY.red)
    g.add(k.ring(hose, 3.3, 1, 0, 1, -8), k.ring(hose, 3.3, 1, 0, 2.6, -8), k.cyl(k.paint(TOY.grey), 1.5, 4, 0, 0, -8))
    g.add(rod(k, hose, (2.6, 2.6, -8), (5.5, 6, -2), 0.7))
    a = arm(k, coat, 1, 1.1)
    b = arm(k, coat, -1, 1.1)
    g.add(a, b)
    g.add(rod(k, hose, (5.5, 6, -2), (6, 6, 0.5), 0.7), rod(k, k.paint(GOLD), (5.4, 6.2, 0.5), (10, 6.8, 0.5), 0.8, 0.45))
    g.add(pivot("spray", 10.5, 6.8, 0.5, *[k.ball(k.paint(TOY.sky), 0.7 - i * 0.1, 2 + i * 2.5, 0, 0) for i in range(3)]))
    return g


def police(k):
    coat = "#1b2a4e"
    g = person(k, coat, legs=coat)
    g.add(buttons(k, SILVER, [4.5, 6.5, 8.5]), band(k, TOY.black, 5.4, 6, 0.25), police_helmet(k, coat))
    # Added: a silver belt buckle on the front of the black belt.
    g.add(k.box(k.paint(SILVER), 0.5, 1.0, 1.4, 0.15, r_at(5.7) + 0.3, 5.2, 0))
    a = arm(k, coat, 1, 2.5, "stop-arm")
    # Held out to the side a little, clear of the helmet.
    a.rotation.x = -0.45
    a.add(k.ball(k.paint(TOY.white), 1.35, 0, HAND, 0))
    g.add(a, arm(k, coat, -1, 0.1))
    return g


def postie(k):
    g = person(k, TOY.red, legs=TOY.black)
    g.add(cap(k, TOY.red, TOY.black), band(k, TOY.yellow, 10.2, 10.8, 0.3))
    g.add(egg(k, k.paint("#c9b48a"), 4, -5.2, 8.5, 0, 0.7, 1.1, 1))
    g.add(k.cyl(k.paint("#a08a5e"), 1.2, 1.6, -5.2, 12.6, 0, 0.8, 12))
    g.add(rod(k, k.paint(TOY.brown), (-3.6, 12, -2.2), (3.1, 4.5, 2.6), 0.4))
    a = arm(k, TOY.red, 1, 1.0)
    hold(a, k.box(k.paint(TOY.white), 0.4, 3, 4.4, 0.1, 1.2, -0.5, 0), 0, 0, 0)
    g.add(a, arm(k, TOY.red, -1, 0.1))
    return g


def baker(k):
    g = person(k, TOY.white, legs=TOY.grey)
    g.add(apron(k, TOY.cream, 1, 9.5, 5), pillbox(k, TOY.white))
    tray = Node()
    tray.add(k.box(k.paint(TOY.brown), 7, 0.8, 8, 0.3, 3, 0, 0))
    for z in (-2.4, 0, 2.4):
        tray.add(egg(k, k.paint("#c98a3e"), 1.3, 3, 1.5, z, 2.2, 0.9, 0.9))
    tray.add(egg(k, k.paint("#b06f2c"), 1.4, 3, 3, 0, 1.6, 1, 1))
    g.add(arm(k, TOY.white, 1, 1.45), arm(k, TOY.white, -1, 1.45))
    g.add(k.at(tray, 1.5, 9.4, 0))
    return g


def chef(k):
    g = person(k, TOY.white, legs=TOY.black)
    g.add(toque(k), band(k, TOY.red, 9.8, 11, 0.3), buttons(k, TOY.black, [4.5, 6.5, 8.5]))
    g.add(arm(k, TOY.white, 1, 1.3, "pan-arm"), arm(k, TOY.white, -1, 0.1))
    pan = k.group(k.cyl(k.paint(TOY.black), 3, 1, 9, 6.5, 2, 2.6, 20), rod(k, k.paint(TOY.black), (6.5, 7, 2), (3, 7.8, 3.8), 0.4))
    g.add(pan)
    g.add(pivot("pancake", 9, 7.6, 2, k.cyl(k.paint("#e6c27a"), 2.2, 0.5, 0, 0, 0, 2.2, 16)))
    return g


def doctor(k):
    g = person(k, TOY.white, legs=TOY.teal, hair=TOY.brown)
    g.add(apron(k, TOY.teal, 5, 10.6, 2.2))
    g.add(rod(k, k.paint(TOY.black), (3.2, 10.6, -2.4), (3.5, 6.5, -1), 0.25), rod(k, k.paint(TOY.black), (3.2, 10.6, 2.4), (3.5, 6.5, 1), 0.25))
    g.add(k.cylX(k.paint(SILVER), 0.8, 0.6, 3.7, 6.2, 0, 12))
    bag = k.group(
        k.box(k.paint(TOY.black), 6, 4, 3, 1.2, 0, -4.6, 0),
        k.ring(k.paint(GOLD), 1, 0.3, 0, -0.5, 0, True, math.pi),
        k.box(k.paint(GOLD), 6.1, 0.4, 3.1, 0.1, 0, -1.6, 0),
    )
    a = arm(k, TOY.white, 1, 0.1)
    hold(a, bag, 0, 0.8, 1.6)
    g.add(a, arm(k, TOY.white, -1, 0.15))
    return g


def builder(k):
    g = Node()
    p = person(k, TOY.blue, legs="#244f86")
    p.add(apron(k, TOY.orange, 3.5, 10, 6), band(k, TOY.white, 6.5, 7.2, 0.35), hard_hat(k, TOY.yellow))
    p.add(arm(k, TOY.blue, 1, 0.9), arm(k, TOY.blue, -1, 0.9))
    g.add(k.at(p, -13, 0, 0))
    # Barrow: a tray on a front wheel, two legs, two handles back to the builder's hands.
    green = k.paint(TOY.green)
    g.add(k.cylZ(k.paint(TOY.black), 3, 2.2, 8, 3, 0, 20), k.cylZ(k.metal, 0.9, 3.4, 8, 3, 0, 10))
    g.add(k.box(green, 12, 5, 10, 1.6, 1.5, 5, 0))
    g.add(dome(k, k.paint("#d9b97a"), 4.6, 2.4, 1.5, 9.8, 0))
    for z in (-3.6, 3.6):
        g.add(rod(k, k.metal, (8, 3, z * 0.4), (-8.8, 6.7, z), 0.5))
        g.add(rod(k, k.metal, (-3, 5, z), (-3, 0, z), 0.5))
    g.add(k.group(rod(k, k.paint(TOY.brown), (0, 11, 2), (-5, 22, 3), 0.4), k.box(k.metal, 1, 4, 3.4, 0.3, 1.6, 8, 1.8)))
    return g


def crane_operator(k):
    g = person(k, TOY.grey, legs="#244f86")
    g.add(band(k, TOY.yellow, 4, 10.4, 0.25), band(k, SILVER, 6.6, 7.2, 0.35), hard_hat(k, TOY.orange))
    g.add(arm(k, TOY.grey, 1, 1.0), arm(k, TOY.grey, -1, 1.0))
    pend = Node()
    pend.add(k.box(k.paint(TOY.yellow), 2.6, 5, 2.6, 0.8, 0, -2.5, 0))
    pend.add(k.ball(k.paint(TOY.green), 0.5, 1.35, 1, 0.5), k.ball(k.paint(TOY.red), 0.5, 1.35, 1, -0.5))
    pend.add(pivot("go", 1.35, -1, 0, k.ball(k.paint(TOY.green), 0.55, 0, 0, 0)))
    pend.add(rod(k, k.paint(TOY.black), (0, 2.5, 0), (2.5, 10.5, 4.5), 0.25))
    pend.userData["held"] = True
    g.add(k.at(pend, 4.8, 7, 0))
    return g


def ice_cream_seller(k):
    g = Node()
    cart = Node()
    cart.add(k.box(k.paint(TOY.cream), 16, 10, 12, 2, 0, 5, 0))
    cart.add(k.box(k.paint(TOY.pink), 16.4, 2, 12.4, 0.8, 0, 9, 0))
    cart.add(k.box(k.paint(TOY.sky), 16.4, 1.4, 12.4, 0.6, 0, 5.4, 0))
    for z in (-6.8, 6.8):
        cart.add(k.wheel(5, -2, 5, z, TOY.red, 1.6))
    cart.add(rod(k, k.wood, (7, 5, 0), (7, 0, 0), 0.8))
    cart.add(k.cyl(k.paint(TOY.white), 6.5, 1, 0, 15, 0, 6.8, 20))
    for i, c in enumerate((TOY.pink, TOY.cream, "#7a4a2a")):
        cart.add(k.ball(k.paint(c), 1.8, -4 + i * 4, 16.2, 0))
    cart.add(rod(k, k.wood, (-6, 15, 0), (-6, 36, 0), 0.5))
    cart.add(k.cone(k.paint(TOY.pink), 13, 5, -6, 33, 0, 24), k.ring(k.paint(TOY.white), 12.6, 0.6, -6, 33.2, 0), k.ball(k.paint(TOY.yellow), 1, -6, 38.4, 0))
    g.add(k.at(cart, 6, 0, 0))
    p = person(k, TOY.white, legs=TOY.sky)
    p.add(band(k, TOY.pink, 2, 3, 0.25), band(k, TOY.pink, 5, 6, 0.25), band(k, TOY.pink, 8, 9, 0.25), boater(k, TOY.red))
    a = arm(k, TOY.white, 1, 1.3)
    hold(a, k.group(rod(k, k.paint("#d9a868"), (0, -2.5, 0), (0, 1, 0), 0.05, 1.2), k.ball(k.paint(TOY.pink), 1.5, 0, 1.8, 0)), 0, 0, 0.6)
    p.add(a, arm(k, TOY.white, -1, 0.2))
    g.add(k.at(p, -10, 0, 7))
    return g


def band_stage(k):
    g = Node()
    g.add(k.cyl(k.wood, 22, 2, 0, 0, 0, 21, 36), k.cyl(k.paint(TOY.blue), 22.2, 0.8, 0, 0.6, 0, 22.2, 36))
    tunic = TOY.red
    # Drummer.
    d = person(k, tunic, legs=TOY.black)
    d.add(band(k, TOY.white, 6.5, 7.1, 0.25), band_hat(k, TOY.black, TOY.white))
    d.add(rod(k, k.paint(TOY.white), (2, 10.5, -3), (3.6, 5, 2.5), 0.3))
    for s in (1, -1):
        a = arm(k, tunic, s, 1.0, "stick-r" if s > 0 else "stick-l")
        hold(a, rod(k, k.wood, (0, 0, 0), (4, -1.5, -s * 2), 0.3, 0.25), 0, 0, 0)
        d.add(a)
    d.add(
        k.cyl(k.paint(TOY.blue), 4, 4.4, 8, 2.6, 0, 4, 20),
        k.cyl(k.paint(TOY.white), 4.2, 0.6, 8, 2.6, 0, 4.2, 20),
        k.cyl(k.paint(TOY.white), 4.2, 0.6, 8, 6.4, 0, 4.2, 20),
        k.cyl(k.paint(TOY.cream), 3.7, 0.2, 8, 7, 0, 3.7, 20),
    )
    d.add(rod(k, k.metal, (8, 0, 0), (8, 2.6, 0), 0.4))
    g.add(k.at(d, -4, 2, -8))
    # Trumpeter.
    tr = pivot("trumpeter", -2, 2, 9)
    p = person(k, tunic, legs=TOY.black)
    p.add(band(k, TOY.white, 6.5, 7.1, 0.25), band_hat(k, TOY.black, TOY.yellow))
    p.add(arm(k, tunic, 1, 1.5), arm(k, tunic, -1, 1.5))
    gold = k.paint(GOLD)
    p.add(
        rod(k, gold, (3.2, 13, 0), (9, 12, 0), 0.4),
        k.cyl(gold, 0.5, 2.5, 6, 12.6, 0, 0.5, 8),
        rod(k, gold, (9, 12, 0), (12.5, 11.4, 0), 0.5, 2.4),
        k.ring(gold, 1.8, 0.3, 6.5, 10.2, 0, True),
    )
    tr.add(p)
    g.add(tr)
    return g


def family(k):
    g = Node()
    g.add(k.box(k.wood, 46, 2, 14, 0.8, 0, 0, 0))
    folk = [
        (TOY.blue, TOY.grey, 1, -15, TOY.black),
        (TOY.green, TOY.blue, 0.68, -4, TOY.yellow),
        (TOY.pink, TOY.cream, 0.6, 5, TOY.brown),
        (TOY.red, TOY.black, 1, 15, "#8a5a2a"),
    ]
    for i, (coat, legs, s, z, hair) in enumerate(folk):
        p = person(k, coat, legs=legs, hair=hair)
        p.add(arm(k, coat, 1, 0.1), arm(k, coat, -1, 0.1))
        if i == 0:
            p.add(top_hat(k, TOY.black))
        p.scale.setScalar(s)
        g.add(pivot("hopper" if i == 2 else "", 0, 2, z, p))

    # Hands joined between neighbours.
    def hand(i, side):
        return (0, 2 + 4.4 * folk[i][2], folk[i][3] + side * 4.2 * folk[i][2])

    for i in range(3):
        g.add(rod(k, k.wood, hand(i, 1), hand(i + 1, -1), 0.9, 0.9, 10))
    return g


ASSETS = [
    ("life-fisher", fisher),
    ("life-firefighter", firefighter),
    ("life-police", police),
    ("life-postie", postie),
    ("life-baker", baker),
    ("life-chef", chef),
    ("life-doctor", doctor),
    ("life-builder", builder),
    ("life-crane-operator", crane_operator),
    ("life-ice-cream-seller", ice_cream_seller),
    ("life-band", band_stage),
    ("life-family", family),
]
