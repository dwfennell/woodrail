# Depot tracks: an industry with two or three tracks

Status: **built** on branch `claude/depot-tracks`, after the owner's decision on the Phase 1 design (2026-11-04):
approved as recommended, with **one crane, not one per track**: the yard's single crane is extended so its gantry spans
every track, and it serves each track's train in turn.

The owner, playing, at a mill (a depot whose crane serves one track): "what if we made it so you could just expand the
number of tracks at a location ... maybe it costs planks for the first one and planks and stone for the second one or
something, just adds to the crane".

## 1. What it is

Once **Sidings** is learned, an industry's card offers **Second track**, then **Third track**. Each tap lays one more
track beside it, on the side away from its yard, a double track (72 mm, one square) apart, joined to the line at both
ends by crossovers, with a buffer on each crossover's spare end. Track, record and price are **one undo step** (undone,
the goods go back to the workshop). The yard's **one crane** becomes a gantry over every track and **serves each
track's train in turn**, a load at a time. To routes, goals and counts the industry is still one stop. A routed train
goes to the **first free track** (the industry's own, then 2, then 3), and **waits short of the crossovers** when every
track is taken.

| | Cost (from the workshop) | Lays | Needs on the line |
|---|---|---|---|
| 2nd track | **10 planks** | 2 crossovers, 2 buffers, its track (108 + 216 + 108), 108 more on the first track at each end | 4½ squares of straight at each end |
| 3rd track | **12 planks + 10 stone** | 2 more crossovers (the first two move out a length), 2 more buffers, its track, a straight on line 1 at each end | 7½ squares at each end |

Pictures (390×844, from `npm run e2e:depot-tracks`): `docs/agents/shots/depot-tracks-1-card.jpg` (before: one track,
"Second track · 10 planks"), `-2-card.jpg` (two tracks, the gantry over both, "Third track · 12 planks 10 stone"),
`-3-card.jpg` (three, the gantry over all three), `-two-trains.jpg` (two trains standing at once, each on its own
track, the crane lifting grain from one), `-overview.jpg` (from above: the ladders, buffers, gantry and both trains).

## 2. The track

The industry lays it (option A of Phase 1): in the depot's frame (t along its track, l across, +l its yard's side), for
`n` tracks every track runs from t = −108 to 324 (**432 mm**, long enough for an engine and three wagons to stand clear
of the crossovers; at 216 a two-wagon train's tail stood on the crossover and blocked the next track). Crossover k
(1 … n−1) joins line k−1 (l = −(k−1)·72) to line k over t ∈ [−108 − (n−k)·216, −108 − (n−k−1)·216], flipped so its
link goes to −l; the far end the same turned round. Pegs and holes don't matter (any two ends that meet join).

It takes the place of plain, level, unswitched straights on the line; a straight running past where the ladder ends is
cut (the rest put back as a shorter straight). Every piece put down is asked of the game's own drop rule. Refusals, on
the card under the greyed button and as a toast:

- "The second track needs 4½ squares of straight track on the line at each end: the line ends / it bends / there are
  points in the way / it climbs";
- "No room for a second track: that's a hill" (or whatever the drop rule says: river, town, track, road, yard…);
- "A train is standing on the line beside it: move it first";
- "Another track needs 10 planks at the workshop" / "Place your workshop … another track's planks come from there".

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
- **All taken:** the router stands it short of the first crossover of that industry's ladder on its way (`fullAt`, the
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

- `src/game/depot-tracks.ts`: `planTracks` (the walk along the line, the ladder, the drop rule), `tracksAfter`, prices,
  roles, `TRACKS_TECH`.
- `src/economy/economy.ts`: `setTracks`, `tracksOf`, `roadsOf`, `trackCount`; each further track is a `DepotState` of its
  own piece and crane point reading everything else through to its industry (same id and piles); the one crane in turn;
  `trackFor`, `fullAt`, `sameDepot`. `src/routing/router.ts`: `fullAt` (wait short of the ladder).
  `src/economy/sections.ts`: `sameDepot`.
- `src/render/depot-view.ts`: `spanLayout`, `syncTracks` (only a depot whose number of tracks changed is drawn again).
- `src/main.ts`: the card row and `addTrack` (one undo step with the price). `src/persist/save.ts`: `tracks`.
- `src/game/blueprints.ts`: Sidings.

Cost: nothing per frame while nothing moves (the e2e counts 0 frames idle). The planner runs on a tap, and for the card
only when the track, the land or the workshop's stock change.

## 8. Tests

- `src/game/depot-tracks.test.ts`: 2 → 3 tracks laid and joined, refusals in words; one crane, never two loads at once,
  going back and forth; the throughput above; routed trains to the first free track, and a third waiting short of the
  ladder till one frees; a one-track depot unchanged; a save round trip, and an old save with one track; the gantry's
  span.
- `npm run e2e:depot-tracks` (about 6 min): by taps on a phone: the card, Second track (planks taken), Undo (track,
  crossovers and planks back), again, Third track (planks and stone), the gantry over 2 and 3; two trains routed by
  taps standing at the mill at once on their own tracks, the crane never moving two loads at once, both trains'
  grain unloaded; after a reload three tracks still; 0 idle frames.

Not covered: a line of several trains (sections) running for a long time through an industry of several tracks; a
three-track ladder under sections (nested loops) is untested.
