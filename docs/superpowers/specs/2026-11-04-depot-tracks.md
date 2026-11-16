# Depot tracks: an industry with two or three tracks

Status: **built** on branch `claude/depot-tracks`, after the owner's decision on the Phase 1 design (2026-11-04):
approved as recommended, with **one crane, not one per track**: the yard's single crane is extended so its gantry spans
every track, and it serves each track's train in turn.

The owner, playing, at a mill (a depot whose crane serves one track): "what if we made it so you could just expand the
number of tracks at a location ... maybe it costs planks for the first one and planks and stone for the second one or
something, just adds to the crane".

## 1. What it is

Once **Sidings** is learned, an industry's card offers **Second track**, then **Third track**. Each tap lays one more
track beside it, on the side away from its yard, a double track (72 mm, one square) apart: **only the track** (since
2026-11-16, the owner: "keep auto, but just add the track, no crossovers"), a straight of the yard's length under the
crane, its ends left open. The player joins it to the line however they like, with points from the tray; the card
says it needs joining (the track lit on the map) until a train can reach it, and until then it's no track of the
industry to routes. Track, record and price are **one undo step** (undone, the goods go back to the workshop). The
yard's **one crane** becomes a gantry over every track and **serves each track's train in turn**, a load at a time.
To routes, goals and counts the industry is still one stop. A routed train goes to the **first free track** it can
reach (the industry's own, then 2, then 3), and **waits short of the points** into them when every track is taken.

| | Cost (from the workshop) | Lays |
|---|---|---|
| 2nd track | **10 planks** | a straight (216) beside the yard |
| 3rd track | **12 planks + 10 stone** | a straight beside the second |

(Until 2026-11-16 the card laid a ladder of crossovers and buffers to the line too, which needed 4½ squares of plain
straight at each end, 7½ for the third: real layouts often didn't have it. Those laid keep working, and a third track
added to one goes beside the second, the ladder kept.)

Pictures (390×844, from `npm run e2e:depot-tracks`, in `e2e-out/depot-tracks`): `1-one-track`, `2-two-tracks-unjoined`
(the new track lit, the card asking for it to be joined), `3-two-tracks-joined` (by a pair of splits), `4-two-trains-
served`, `5-overview`, `6-three-tracks`.

## 2. The track

In the depot's frame (t along its track, l across, +l its yard's side), track k (2, 3) is a 216 straight at
t 0 … 216, l = −(k−1)·72, at the yard's level. The game's drop rule says whether its spot is clear (river, hill, town,
track, road, yard…): "No room for a second track: that's a hill". Nothing on the line is taken up, so the line can
bend or have points right at the yard's ends.

**Joined:** a further track is the industry's to routes once it's joined to the same track as the yard's own
(`Economy.reachableTracks`: what's joined to the depot's piece, worked out once a change of the layout). The points a
routed train waits short of when every track is taken are the first points out from each track's ends (and an older
save's ladder; `Economy.joinsOf`). How long each track is clear of points is the player's: a track too short for a
train is as in load-in-place (a train loads where it stands at the crane).

## 3. The crane: one, in turn

- The yard's crane is drawn as a gantry from just beyond the last track (34 mm) to the yard's edge (l 118), at the same
  place along the depot as before; a jib crane becomes a gantry too (`spanLayout`, src/render/depot-view.ts). One
  trolley, one hook.
- **In turn:** the crane moves one unit at a time for one train. Free, it goes to the train that has waited longest
  for it (`turnAt`: when it halted, or last had the crane; ties by train id), so with two trains it goes back and
  forth, a load each. A train whose wagon is done, or that is moving up to its next wagon, lets it go at once
  (`Economy.craneTurn`, `letCraneGo`). A single-track depot is unchanged.
- **Wait for a full load** stays per train: one can wait full on track 2 while the crane works track 1.
- Crane speed upgrades apply as before; production doesn't change.

### Throughput (measured, `depot-tracks.test.ts`)

Two trains at a mill, each with work for the crane (a hopper train unloading grain, a van train loading flour):

| | Both done |
|---|---|
| One track (the second train waits on the line behind the first, then comes in) | 14.8 s |
| Two tracks, one crane in turn | 8.6 s (**42% sooner**) |

The crane moves the same units at the same speed either way; the gain is that the second train stands ready beside
the first instead of out on the line, so the crane works it while the first shunts up to its next wagon and leaves,
and nobody runs in from the line. A busy industry's loads per minute are still capped by its one crane, so the balance
bands don't move (the play-through doesn't learn Sidings).

## 4. Routing

- A route's stop is the industry (one stop). For a routed train heading to an industry of several tracks, the economy
  gives it a track (`Economy.trackFor`, the router's goal): the one it's on already; else the one it was given, while
  no other train is on it; else the **first free** track in order (no train on it, none given it). Every train of a
  line comes to the same answer in the same state.
- **All taken:** the router stands it short of the first turnout (or, in an older save, crossover) of that industry's joins on its way (`fullAt`, the
  router's `RouteWait` of kind "points", naming a train on a track) and asks again as it steers; when a track frees,
  it's given it and goes in.
- **Sections:** a train sections send round by a passing loop's other road calls at its stop there if that road is a
  track of the same industry (`sameDepot`), instead of skipping it.
- Hand-run trains go the way the points lie; whichever track they stand on, the crane serves them.

## 5. The Goods yard, and research

The tech tree's planned Goods yard (step 10: a warehouse with three sidings) is folded in: **a warehouse with three
tracks is the goods yard**. No separate piece. The research is **Sidings** (Logistics, tier 2, needs Warehouses and
Junctions and loops, 6 planks + 120 coins): "Give an industry a second and a third track…", for every crane industry.

Industries: harvester, sawmill, workshop, farm yard, mill, quarry, warehouse, mine, foundry, carpenter, smithy, power
station, harbour (landward side), dairy, bakery, orchard, juice works, creamery, ice cream factory, brickworks, car
factory; and
those built alongside (QA 2026-11-05 #3): oil well, water pump, sugar beet field, jam kitchen, chocolate factory, flower
field, dye works, toy workshop; and batch H's post office. Not a
town's station (Big stations), a school, a halt or Sandbox's loaders.

## 6. Saves

Each industry with more tracks saves `tracks: { roads, ends, ladder }` (piece ids: the piece under the crane on each
further track, the rest of those tracks, and the ladder), only pieces still on the map. On load the economy is given
them back (`Economy.setTracks`). Old saves have none: **one track**. The number of tracks is always 1 + its further
tracks still on the map, so a track taken up with the eraser is simply a track less.

## 7. Code

- `src/game/depot-tracks.ts`: `planTracks` (the track beside, the drop rule), `tracksAfter`, prices, roles,
  `TRACKS_TECH`.
- `src/economy/economy.ts`: `setTracks`, `tracksOf`, `roadsOf`, `trackCount`; each further track is a `DepotState` of its
  own piece and crane point reading everything else through to its industry (same id and piles); the one crane in turn;
  `trackFor` (of the tracks a train can reach: `reachableTracks`), `fullAt` (the points into them: `joinsOf`),
  `unjoinedTracks` (for the card), `sameDepot`. `src/routing/router.ts`: `fullAt` (wait short of the points).
  `src/economy/sections.ts`: `sameDepot`.
- `src/render/depot-view.ts`: `spanLayout`, `syncTracks` (only a depot whose number of tracks changed is drawn again).
- `src/main.ts`: the card row (and "needs joining", the track lit by its own `RouteView`: `lightTracks`) and
  `addTrack` (one undo step with the price). `src/persist/save.ts`: `tracks`.
- `src/game/blueprints.ts`: Sidings.

Cost: nothing per frame while nothing moves (the e2e counts 0 frames idle). The planner runs on a tap, and for the card
only when the track, the land or the workshop's stock change.

## 8. Tests

- `src/game/depot-tracks.test.ts`: 2 → 3 tracks laid beside, one straight each, ends open, not the industry's to
  routes till joined (`unjoinedTracks`, `reachableTracks`); no straight needed on the line (a curve or points at the
  yard's ends); the drop rule asked at the yard's level; a routed train going to the yard's own track while the one
  beside isn't joined. Joined by a pair of splits (as a player would): one crane, never two loads at once, going back
  and forth; the throughput above; routed trains to the first free track, and a third waiting short of the points
  till one frees; a one-track depot unchanged. An older save's ladder: two routed trains served on its two tracks,
  and a third track beside it, the ladder kept. A save round trip, an old save with one track; the gantry's span.
- `npm run e2e:depot-tracks` (about 6 min): by taps on a phone: the card, Second track (only the track: planks taken,
  its ends open, "needs joining", lit), Undo (track and planks back), again; joined by a pair of splits (setup: the
  editor, each piece asked of the drop rule; a player lays them from the tray); two trains routed by taps standing at
  the mill at once on their own tracks, the crane never moving two loads at once, both trains' grain unloaded; Third
  track (planks and stone, "needs joining"), the gantry over 2 and 3; after a reload three tracks still; 0 idle frames.

Not covered: a line of several trains (sections) running for a long time through an industry of several tracks;
tracks joined in odd ways (one end only, a siding) are routed by plain reachability.
