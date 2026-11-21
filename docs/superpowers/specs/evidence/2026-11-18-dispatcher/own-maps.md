# Our own reference maps (dispatcher spec §8 step 0)

Twelve layouts of the kinds players build, the hard cases most of all, added to the jams bar beside the user's eight
(`src/play/bugmaps/reference/own-NN-*.txt`, main's numbers pinned in `baseline.json`). Built by
`src/play/own-maps/` (`npm run own-maps`): an empty Sandbox table (flat, no water, no sea; towns, roads and fields
cleared off, a harness-only step, since the land isn't what's tested), then every piece through the Editor and the
tray's drop rules (`rulesFor`: land, overlaps, headroom, support), gaps closed by near-miss seating or the Auto piece,
signals as the Signal tool puts them (a pair, or one way, each post with room), depots as a drop makes them, a second
track as the depot's card adds it and joined by Splits from the tray, trains out of the box clear of each other, lines
as the line sheet makes them. Each map holds the invariants at 0 s. Rebuilding gives the same files byte for byte.

Schematics (`OWN_MAPS_SVG=<dir> npm run own-maps`): `own-maps.jpg` (orange: depots, blue: points, green: signals,
red: trains with their car count; own-06 is own-05 with more signals).

## Results, 1800 s each, jams cleared as a player would (`npm run jams`)

Main on 19cf3f8; dispatcher is `JAMS_DISPATCHER=1` on the same commit. Stops: arrivals at stops by all routed trains.
Longest: the longest a lever-on train stood not busy (s).

| map | trains / lines | main: jams · stops · longest · break | dispatcher: jams · stops · longest · break |
|---|---|---|---|
| 01 single line, 3 loops (middle one a straight long) | 4 / 3 | 3 · 49 · 72 · – | **19 · 45** · 145 · – |
| 02 figure of eight over a diamond | 4 / 2 | 0 · 132 · 18 · – | 0 · 131 · 19 · – |
| 03 terminus, 3 platforms, throat of points | 5 / 3 | 14 · 66 · 130 · greenHeld | **21 · 31 · 1578 · deadlock** |
| 04 wye (triangle junction), 3 arms | 4 / 3 | 25 · 57 · 87 · – | 0 · **3 · 1799** · – |
| 05 double track, 2 crossovers, signals 3 straights apart | 5 / 3 | 33 · 45 · 239 · – | 1 · **2 · 1794** · – |
| 06 the same, signals on every joint | 5 / 3 | 29 · 54 · 239 · – | 1 · **2 · 1794** · – |
| 07 ring, 2 lines opposite ways, 1 loop | 3 / 2 | 9 · 163 · 155 · – | **22 · 107** · 77 · – |
| 08 main line with a branch and a shuttle | 4 / 3 | 7 · 98 · 60 · – | **24 · 51** · 111 · – |
| 09 user's pattern: ramps, bridges over a line, short loops, signals every joint | 5 / 4 | 35 · 122 · 127 · greenHeld | 19 · **102 · 536** · – |
| 10 forest → sawmill → workshop, two 2-track yards | 4 / 2 | 4 · 95 · 89 · – | **21 · 30 · 1024 · oneOwner** |
| 11 one-way ring, overtaking loop, two-way branch | 4 / 2 | 11 · 191 · 155 · – | 3 · **5 · 1740 · deadlock** |
| 12 big mix: ring, bridge branch to a terminus, branch under it to a 2-track mill | 9 / 5 | 33 · 59 · 298 · greenHeld | 7 · **11 · 1799 · deadlock** |

Main's greenHeld breaks (03, 09, 12) are the same kind the user's complex-3 and rowan-2 pin. Main's numbers repeat
exactly run to run.

## What each map shows

1. **Single line, loops.** A 7-car train can't wait in the middle loop; three lines share one line. Main copes (3
   jams). The dispatcher has six times the jams, with stops a little down.
2. **Figure of eight.** Two lobes, a loop on each: easy for both (no jams). It shows a diamond crossing doesn't trip
   either.
3. **Terminus.** Five trains through a two-points throat and one single line with two loops. Main jams often (14). The
   dispatcher halves the stops and ends in a deadlock with a train standing 26 min.
4. **Wye.** Two lines meet head on, and the triangle is their only passing place. Main jams a lot (25) but keeps
   moving. The dispatcher has no jams and 3 stops in 30 min: it holds every train, and since a hold isn't a stall it
   never counts as a jam.
5. **Double track, signals spaced.** Trains both ways on both tracks with no rule of the road. Main has the most jams
   (33; nose to nose between crossovers). The dispatcher holds nearly everything from the start (2 stops).
6. **Double track, signals close.** Close signals barely change main (29 jams against 33, more stops). The dispatcher
   is the same as on 05.
7. **Ring both ways.** One loop for three trains running opposite ways. Main jams 9 times. The dispatcher jams 22
   times with a third fewer stops.
8. **Branch and shuttle.** The shuttle's stop is on the main line, so it crosses the through trains' path. Main is
   fair (7). The dispatcher has 3× the jams and half the stops.
9. **The user's hill pattern.** Main's worst map for jams (35) with high stops. The dispatcher has fewer jams but 16%
   fewer stops and a train standing 9 min: closest to break-even of the hard maps.
10. **Depot yards.** Two-track yards under one crane, joined by Splits. Easy for main (4 jams). Under the dispatcher,
    two trains end up on the same points (oneOwner on piece 92, one of the yard's Splits) and stops drop by two thirds.
11. **One-way signals.** A one-way ring, a loop to overtake on and a two-way branch. Main is good (191 stops, the
    most of any map). The dispatcher deadlocks almost at once (5 stops).
12. **Big mix.** Nine trains, five lines, every feature above. Main 33 jams and 59 stops. The dispatcher deadlocks
    (11 stops).

## Where the dispatcher is worse, and why if I can tell

Worse on 11 of 12 by the bar's rule (more jams, fewer stops, or a break). On 02 it's within one stop.

- **It holds rather than jams (04, 05, 06, 11, 12; 03 and 10 in part).** Its own counters over a 300 s run:
  `heldBlocked` is 1,867 of 1,933 decisions on 03, 501/696 on 04, 840/948 on 05, 1,827/1,850 on 11 and 9,376/9,510
  on 12. Trains held at their grant never count as stuck, so the jam count *falls* while stops collapse. **The jams
  count alone would read these maps as better.** Stops and longest stand are what catch it.
- **04, 05, 06 (head-on meetings with a passing place or crossover between them):** many grants handed back
  (`givenBack` 173 on 04, 90 on 05). It looks like it grants a way, finds it blocked by the other train's, gives it
  back, and both end up waiting for each other.
- **11:** one-way signals. Only 23 grants in 1,850 decisions; it seems to treat the one-way ring's blocks as unenterable. A guess:
  one-way signals aren't in its model of which way a block may be run.
- **10:** it let two trains onto one of the yard's Splits (oneOwner). The depot's second track and its Split are a
  topology it may not book as points.
- **01, 07, 08 (single lines, loops shorter or shared):** it keeps moving but jams 2–6× as often as main. I can't
  tell why from its counters (no notes logged).

## Running them

`npm run jams` now runs 20 maps (the user's 8 and these 12) in about 8 min on 4 cores; these 12 take about 3 of
those. `npm run jams -- --maps own-04-wye.txt,…` runs a few. Rebuilding the maps (`npm run own-maps`) rewrites their
files: run `npm run jams -- --update` after, on main.
