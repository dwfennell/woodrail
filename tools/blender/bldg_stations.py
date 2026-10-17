"""Stations for bldg.py, ported from src/catalogue/assets/buildings.ts."""

import math

from kit import TOY, Node
from bldg_parts import (  # noqa: F401
    BRICK, FRAME, SLATE, STONE, WIN, awningX, bench, chimney, churn, clock, crate, doorX, doorZ, gable, glassBand, hip,
    house, lamp, nameBoard, named, panel, peg, pine, platform, sack, smoke, winX, winZ,
)


def country_halt(k):
    # 216 long, a long straight's length: the game's kit piece (src/track/kits.ts, kit-country-halt) stands it beside
    # its track, edge line (+z) to the track.
    green = k.paint(TOY.green)
    g = platform(k, 216, 28, 0, 0)
    # Lean-to shelter: back wall, two sides, sloping roof.
    g.add(k.box(green, 40, 26, 3, 1, 0, 13, -11))
    g.add(k.box(green, 3, 26, 14, 1, -18.5, 13, -5))
    g.add(k.box(green, 3, 26, 14, 1, 18.5, 13, -5))
    roof = k.box(k.paint(TOY.red), 46, 2.5, 22, 0.8, 0, 38, -3)
    roof.rotation.x = 0.18
    g.add(roof)
    g.add(bench(k, 0, -6, 0, 13, TOY.cream))
    g.add(nameBoard(k, 50, -6, 22, 13))
    g.add(lamp(k, -70, 6, 30, 13), lamp(k, 84, 6, 30, 13))
    g.add(peg(k, TOY.purple, TOY.black, -24, 13, 4))
    return g


def two_platform_station(k):
    # Two through roads 216 long, a double track apart (72), between a platform each side: the game's kit piece
    # (kit-two-platform-station) is a double straight under it.
    g = Node()
    for z in (-36, 36):
        g.add(k.trackSlab(216, 0, 0, z))
    g.add(platform(k, 216, 26, 0, -70, 13, 1))
    g.add(platform(k, 216, 26, 0, 70, 13, -1))
    # Station building on the far platform.
    b = k.at(house(k, 60, 18, 28, k.paint(TOY.cream), TOY.red, 10), -25, 13, -74)
    b.add(doorZ(k, TOY.blue, 0, 9.5, 10, 18))
    for x in (-18, 18):
        b.add(winZ(k, x, 9, 9.3))
    # Added: a step at the door.
    b.add(k.box(k.paint(STONE), 14, 1.2, 3, 0.4, 0, 0, 10.5))
    g.add(b)
    g.add(chimney(k, -40, 50, -77))
    # Canopy on the near platform.
    for x in (-50, -20, 10):
        g.add(k.cyl(k.paint(TOY.green), 1.4, 30, x, 13, 72, 1.4, 10))
    canopy = k.box(k.paint(TOY.green), 76, 2.5, 26, 0.8, -20, 43, 70)
    canopy.rotation.x = -0.12
    g.add(canopy)
    g.add(bench(k, -35, 76, math.pi, 13), bench(k, -5, 76, math.pi, 13))
    # Footbridge: two stair towers and a covered span.
    blue = k.paint(TOY.blue)
    for z in (-74, 74):
        g.add(k.box(blue, 18, 54, 14, 1.5, 48, 13, z))
        g.add(hip(k, k.paint(TOY.red), 20, 8, 48, 78, z))
    g.add(k.box(blue, 18, 4, 138, 1, 48, 62, 0))
    for x in (40, 56):
        g.add(k.box(k.paint(TOY.cream), 2, 10, 134, 0.6, x, 66, 0))
    g.add(k.box(k.paint(TOY.red), 22, 2.5, 140, 0.8, 48, 77, 0))
    for x in (-90, 20, 84):
        g.add(lamp(k, x, -60, 30, 13))
    g.add(lamp(k, 84, 60, 30, 13))
    g.add(nameBoard(k, 25, -80, 26, 13))
    return g


def _arc(r, a0, a1, step=2.0, least=12):
    """Points on a circle of radius r round the origin from angle a0 to a1 (both ends included), about `step` apart."""
    n = max(least, math.ceil(abs(a1 - a0) * r / step))
    return [(r * math.cos(a0 + (a1 - a0) * i / n), r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def grand_terminus(k):
    # Three roads a double track apart (72), each 216 long from the throat to its end, buffers just past that: the game's
    # kit piece (kit-grand-terminus) puts its track under them, the model's origin 205 in from where its roads start.
    g = Node()
    cream = k.paint(TOY.cream)
    # Tracks and buffer stops (the stop's face 22 past the road's end, where a train's front comes to rest).
    for z in (-72, 0, 72):
        g.add(k.trackSlab(238, -86, 0, z))
        g.add(k.box(k.paint(TOY.red), 6, 12, 30, 1.5, 36, 12, z))
        for s in (-10, 10):
            g.add(k.cylX(k.paint(TOY.black), 2.5, 4, 32, 18, z + s, 12))
    for z in (-36, 36):
        g.add(platform(k, 216, 26, -97, z, 13))
    # Shed: low side walls, ribs, half-barrel glass roof.
    for z in (-100, 100):
        g.add(k.box(k.paint(BRICK), 230, 30, 4, 1, -90, 0, z))
    # The code's open half cylinder (r 100, axis along x, arching over the top): a 1.5 mm band across z/y, extruded
    # along local z and turned so that runs along x.
    band = _arc(100.75, 0, math.pi) + _arc(99.25, math.pi, 0)
    # Pale glazing: a whole roof of the dark window glass reads as black from above.
    g.add(k.at(k.extrude(k.fixed("#cfe2ea"), band, 226, 0, 0, 0, 0.5), -90, 30, 0, math.pi / 2))
    for x in (-195, -150, -105, -60, -15, 22):
        g.add(k.at(k.ring(k.paint(TOY.green), 101, 1.6, 0, 0, 0, True, math.pi), x, 30, 0, math.pi / 2))
    g.add(k.box(k.paint(TOY.green), 226, 3, 4, 1, -90, 129, 0))
    # Concourse front and clock tower.
    g.add(k.box(cream, 30, 48, 210, 2, 58, 0, 0))
    g.add(k.box(k.paint(TOY.blue), 34, 3, 214, 1, 58, 48, 0))
    for z in (-85, -55, 55, 85):
        g.add(winX(k, 73, 26, z, 10, 14))
    for z in (-25, 25):
        g.add(doorX(k, TOY.blue, 73, z, 12, 24))
        # Added: a stone step at each door.
        g.add(k.box(k.paint(STONE), 4, 1.2, 16, 0.4, 74.5, 0, z))
    g.add(k.box(cream, 26, 138, 26, 2, 58, 0, 0))
    g.add(hip(k, k.paint(TOY.green), 30, 22, 58, 138, 0))
    g.add(k.cyl(k.paint(TOY.yellow), 1, 10, 58, 158, 0, 0.5, 8))
    g.add(clock(k, 9, 72, 120, 0))
    g.add(clock(k, 9, 44, 120, 0, math.pi))
    g.add(k.box(k.paint(WIN), 1.6, 26, 12, 0.6, 72, 70, 0))
    g.add(peg(k, TOY.red, TOY.black, 82, 0, 40), peg(k, TOY.blue, None, 84, 0, -50))
    return g


def mountain_station(k):
    # The platform 216 long (a long straight's length): the kit piece (kit-mountain-station) stands it beside its
    # track, edge line (+z) to the track.
    g = platform(k, 216, 24, 0, 18, 13, 1)
    g.add(k.box(k.paint(STONE), 60, 16, 30, 1.5, -5, 0, -12))
    upper = k.at(house(k, 60, 30, 24, k.paint(TOY.brown), TOY.red, 9, 0, 0, 8), -5, 16, -12)
    upper.add(k.roof(k.paint(TOY.white), 56, 42, 12, 0, 23.2 + 2.4, 0, 1.6))
    for x in (-18, 0, 18):
        upper.add(winZ(k, x, 9, 15.4, 8, 9))
    g.add(upper)
    # Balcony on the upper storey.
    g.add(k.box(k.wood, 52, 2, 8, 0.5, -5, 20, 7))
    g.add(k.box(k.paint(TOY.brown), 52, 6, 1.2, 0.3, -5, 22, 10.6))
    # Added: two wooden brackets under the balcony.
    for x in (-27, 17):
        br = k.box(k.wood, 2, 1.6, 8, 0.4, 0, -0.8, 0)
        br.position.set(x, 18, 6.6)
        br.rotation.x = -0.6
        g.add(br)
    g.add(doorZ(k, TOY.green, -5, 3.4, 10, 14))
    for x in (-25, 15):
        g.add(winZ(k, x, 5, 3.4, 8, 7))
    g.add(chimney(k, -25, 46, -18, 12, STONE))
    g.add(pine(k, 36, -18, 44), pine(k, 44, -6, 34))
    g.add(nameBoard(k, 60, 22, 22, 13, TOY.red))
    g.add(lamp(k, -80, 22, 30, 13), lamp(k, 90, 22, 30, 13))
    return g


def harbour_station(k):
    # The quay 216 long (a long straight's length), its edge line on the -z side: the kit piece (kit-harbour-station)
    # stands it beside its track there, the water beyond.
    g = Node()
    g.add(k.box(k.water, 216, 1.2, 50, 0.4, 0, 0, 35))
    g.add(platform(k, 216, 40, 0, -10, 13, -1))
    b = k.at(house(k, 54, 22, 26, k.paint(TOY.white), TOY.blue, 10), -20, 13, -2)
    b.add(doorZ(k, TOY.blue, 0, 11.4, 10, 17))
    for x in (-17, 17):
        b.add(winZ(k, x, 9, 11.2, 9, 9))
    for x in (-17, 0, 17):
        b.add(winZ(k, x, 9, -11.2, 9, 9))
    g.add(b)
    # Jetty on piles.
    g.add(k.box(k.wood, 18, 3, 40, 0.6, 40, 10, 32))
    for z in (20, 36, 50):
        for x in (33, 47):
            g.add(k.cyl(k.paint(TOY.brown), 1.8, 11, x, 0, z, 1.8, 10))
    for x in (10, 60):
        g.add(k.lathe(k.paint(TOY.black), [(0, 0), (3, 0), (2, 3), (2, 5), (3.4, 6), (0, 6.5)], x, 13, 6, 14))
    # Lifebuoy on a post.
    g.add(k.cyl(k.paint(TOY.white), 1.2, 22, -60, 13, 6, 1.2, 8))
    g.add(k.at(k.ring(k.paint(TOY.red), 5, 1.8, 0, 0, 0, True), -60, 30, 7.5))
    # The boat.
    boat = named(Node(), "boat")
    boat.add(k.lathe(k.paint(TOY.red), [(0, 0), (5, 0), (8, 6), (0, 6)], 0, 0, 0, 20))
    boat.children[0].scale.set(2.4, 1, 1)
    boat.add(k.box(k.paint(TOY.white), 12, 8, 10, 1.5, -2, 6, 0), k.cyl(k.paint(TOY.yellow), 2, 6, -2, 14, 0, 2, 10))
    g.add(k.at(boat, 72, 0, 50))
    g.add(lamp(k, 40, -22, 30, 13), lamp(k, -80, -22, 30, 13))
    return g


def signal_box(k):
    g = Node()
    g.add(k.box(k.paint(BRICK), 40, 26, 26, 1.5))
    for z in (-7, 7):
        g.add(winX(k, 20, 9, z, 7, 8))
    g.add(k.box(k.paint(TOY.cream), 42, 22, 28, 1.5, 0, 26, 0))
    g.add(k.box(k.paint(WIN), 38, 12, 29, 0.4, 0, 31, 0))
    g.add(k.box(k.paint(WIN), 43, 12, 22, 0.4, 0, 31, 0))
    g.add(hip(k, k.paint(SLATE), 52, 12, 0, 48, 0))
    # Added: a white name plate on the brick base, between the windows.
    g.add(k.box(k.paint(FRAME), 1.2, 4, 6, 0.3, 20.2, 12, 0))
    # Levers, visible through the glass.
    reds = [TOY.red, TOY.red, TOY.yellow, TOY.blue, TOY.red]
    for i, c in enumerate(reds):
        lever = Node()
        lever.add(k.box(k.paint(c), 1.2, 10, 1.2, 0.3, 0, 0, 0))
        lever.name = "lever" if i == 2 else ""
        g.add(k.at(lever, 15, 28, -8 + i * 4))
    # Outside stairs and landing.
    for i in range(6):
        g.add(k.box(k.wood, 8, 2, 4, 0.4, -12 + i * 4, i * 4.4, 17))
    g.add(k.box(k.wood, 12, 2, 8, 0.4, 14, 25, 17))
    d = doorZ(k, TOY.green, 14, 14, 8, 16)
    d.position.y += 26  # translateY(26): the door is only turned about y, so its local y is the world's.
    g.add(d)
    g.add(peg(k, TOY.blue, TOY.black, 8, 27, -2))
    return g


def ticket_booth(k):
    g = Node()
    g.add(k.box(k.paint(TOY.red), 22, 28, 20, 2))
    g.add(k.box(k.paint(WIN), 1.6, 10, 14, 0.4, 11, 12, 0))
    g.add(k.box(k.wood, 5, 1.6, 16, 0.5, 12.5, 11, 0))
    # Added: a cream sign board above the counter window.
    g.add(k.box(k.paint(TOY.cream), 1.4, 3.5, 14, 0.4, 11.2, 23.5, 0))
    g.add(k.box(k.paint(TOY.cream), 28, 3, 26, 1, 0, 28, 0))
    g.add(hip(k, k.paint(TOY.blue), 26, 8, 0, 31, 0))
    g.add(k.cyl(k.paint(TOY.yellow), 4, 1.2, 0, 39, 0, 4, 16))
    g.add(k.cylX(k.paint(TOY.yellow), 5, 1.2, 0, 46, 0, 20), k.cyl(k.paint(TOY.black), 0.8, 6, 0, 38, 0, 0.8, 6))
    g.add(peg(k, TOY.blue, TOY.red, 6, 2, 0))
    return g


def waiting_shelter(k):
    g = Node()
    frame = k.paint(TOY.teal)
    g.add(k.box(k.glass, 36, 26, 1.5, 0.3, 0, 0, -9))
    for x in (-17.5, 17.5):
        g.add(k.box(k.glass, 1.5, 26, 18, 0.3, x, 0, 0))
    for x in (-18, 18):
        for z in (-9, 9):
            g.add(k.cyl(frame, 1.2, 27, x, 0, z, 1.2, 10))
    roof = k.box(frame, 42, 2.4, 24, 1, 0, 27, 0)
    roof.rotation.x = -0.1
    g.add(roof)
    g.add(bench(k, 0, -4, 0, 0, TOY.teal))
    g.add(k.box(k.paint(TOY.cream), 10, 12, 1, 0.3, 10, 9, -8))
    g.add(peg(k, TOY.orange, None, -8, 6, -3))
    return g


def platform_furnished(k):
    # 216 long, a long straight's length: the game's kit piece (src/track/kits.ts, kit-platform-furnished) stands it
    # beside its track, edge line (+z) to the track.
    g = platform(k, 216, 26, 0, 0)
    for x in (-90, -30, 30, 90):
        g.add(lamp(k, x, -6, 32, 13))
    g.add(bench(k, -60, -6, 0, 13), bench(k, 60, -6, 0, 13))
    # Hanging clock on a bracket.
    g.add(k.cyl(k.paint(TOY.black), 1.2, 40, 0, 13, -9, 1.2, 8))
    g.add(k.box(k.paint(TOY.black), 2, 2, 10, 0.4, 0, 52, -5))
    g.add(clock(k, 5, 1.2, 46, 0), clock(k, 5, -1.2, 46, 0, math.pi))
    g.add(k.cyl(k.paint(TOY.green), 3, 7, 41, 13, -6, 3.4, 14))
    g.add(peg(k, TOY.yellow, None, -10, 13, 2), peg(k, TOY.green, TOY.brown, 14, 13, -2))
    return g


def station_clock(k):
    g = Node()
    g.add(k.lathe(k.paint(TOY.green), [(0, 0), (5, 0), (5, 2), (2.5, 4), (1.8, 10), (1.8, 40), (3, 42), (0, 42)], 0, 0, 0, 20))
    # A big two-faced head, its faces bold (see `clock`): read from across the layout at the usual zoom.
    g.add(k.cylZ(k.paint(TOY.green), 10.6, 6, 0, 52, 0, 28))
    g.add(clock(k, 8.6, 0, 52, 3.2, -math.pi / 2, bold=True), clock(k, 8.6, 0, 52, -3.2, math.pi / 2, bold=True))
    g.add(k.ball(k.paint(TOY.yellow), 2.2, 0, 64.2, 0))
    return g


ASSETS = [
    ("bldg-country-halt", country_halt),
    ("bldg-two-platform-station", two_platform_station),
    ("bldg-grand-terminus", grand_terminus),
    ("bldg-mountain-station", mountain_station),
    ("bldg-harbour-station", harbour_station),
    ("bldg-signal-box", signal_box),
    ("bldg-ticket-booth", ticket_booth),
    ("bldg-waiting-shelter", waiting_shelter),
    ("bldg-platform-furnished", platform_furnished),
    ("bldg-station-clock", station_clock),
]
