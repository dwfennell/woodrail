# Depot tracks: an industry with two or three tracks

Status: **Phase 1, design and prototype. Waiting for a decision** (§9). Branch `claude/depot-tracks`.

The owner, playing, at a mill (a depot whose crane serves one track): "what if we made it so you could just expand the
number of tracks at a location ... maybe it costs planks for the first one and planks and stone for the second one or
something, just adds to the crane".

## 1. The head

From its card, an industry is upgraded to **2 tracks, then 3**. Each tap lays one more track beside it, on the side
away from its yard, a double track (72 mm, one square) apart, joined to the line at both ends by crossovers. That is
**one undo step**, priced like a piece from the workshop. **Each track has a crane of its own** working the same yard
and piles (the gantry gets longer to reach over to it). Two or three trains are loaded and unloaded **at once**, or one
waits for a full load without blocking the line. To the rest of the game the industry is still one stop: routes,
goals, the chain hints and counts don't change. A routed train goes to the **first free track** in a fixed order.

| | Cost | Lays | Needs on the line |
|---|---|---|---|
| 2nd track | **10 planks** | 2 crossovers, 1 straight, 2 buffers | 3 squares of straight track at each end |
| 3rd track | **12 planks + 10 stone** | 2 more crossovers, 3 straights, 2 more buffers (the first two crossovers move out one length) | 6 squares at each end |

Pictures (390×844, the prototype, `node tools/shots/depot-tracks.mjs`):
`docs/agents/shots/depot-tracks-1-card.jpg` (one track, the card's "Second track · 10 planks" button),
`-2-card.jpg` (two tracks; "Third track · 12 planks 10 stone"), `-3-card.jpg` (three tracks),
`-overview.jpg` (from above: the ladders and buffers at both ends, two trains standing at once),
`-two-trains.jpg` (close: a hopper of grain unloaded and a van loaded with flour at the same moment, a crane each).

## 2. How the extra track is laid

### Options

**A. The depot lays it (recommended).** The upgrade puts a straight beside the depot and a **ladder of crossovers** at
each end in place of the plain straights on the line there, plus a buffer on each crossover's spare end, as one undo
step (`Editor.replaceRun`, as Draw swaps a switch into a line). In the depot's frame (t along its track, l across, +l
the yard's side), for `n` tracks: crossover k (1 … n−1) joins line k−1 (l = −(k−1)·72) to line k over
t ∈ [−(n−k)·216, −(n−k−1)·216], flipped so its link goes to −l; at the far end the same turned round. Line j's road
is a 216 straight beside the depot. The geometry is exact (the crossover is a double-track board, 216 long, 72 apart:
no lattice rounding), and needs no new pieces. (Pegs and holes don't matter: any two ends that meet join.)

- **Space:** 216 mm (3 squares) of straight, level, unswitched track on the line at each end for 2 tracks; 432 mm
  (6 squares) for 3. A straight that runs past that is cut (the rest put back as a shorter straight). The band beside
  it (one square for 2, two for 3) must be clear by the game's own drop rule.
- **Refusals,** said on the card under the (greyed) button and as a toast, in the drop rule's own words:
  - "The second track needs 3 squares of straight track on the line at each end: the line ends / it bends / there
    are points in the way / it climbs";
  - "No room for a second track: that's a hill" (river, town, another track, a road, a ruin, a yard…: whatever the drop
    rule says for the piece that doesn't fit);
  - "A train is standing on the line beside it: move it first";
  - "Another track needs 10 planks at the workshop" (no workshop: as other upgrades say).
- **Undo** takes it all back, as one step (prototype: the goods aren't given back yet; §8).

**B. The player lays a siding and the depot claims it.** The card says "Lay a track beside the mill, joined at both
ends, then tap to add it". Freer (any ladder, any length), but it's a puzzle a child won't solve: the geometry has to
be exact for the crane to stand over it, and the card has to explain why a near miss doesn't count. Worth adding later
as a fallback ("there's a track there already: use it") when a player has laid one exactly where A would.

**C. A new piece: the depot retyped to a wider one with its roads inside (like the big stations).** Rejected: a
retype must keep the depot's two ends where they are (`Layout.canRetype`), and 216 mm has no room for a ladder and a
standing road too. The roads would be shorter than a train.

### Which side

Always the side away from the yard (the yard, its buildings and piles stay put; the crane reaches over). No mirror
option in the first version: when that side is blocked, the card says so.

## 3. The crane

### Options

1. **One crane per track (recommended; the prototype).** Each track has its own gantry, from just beyond its track
   over the others to the yard's edge, staggered a little along the depot so the beams don't meet. Each works its own
   train exactly as today's crane does (the same `Service` per train: halt each wagon under it, unload before load,
   "Wait for a full load"). All share the yard's piles. Real payoff (2× or 3× the handling), easy to read (a crane over
   every track), and nothing new to learn: "each track has a crane".
2. **One crane moving between tracks in turn.** Only a waiting place: no faster handling, harder to read (why is my
   train standing under nothing?), and needs a rule for who's next.
3. **One crane, faster at higher levels.** A stat bump that doesn't need extra track; the extra track would then only
   be a passing place. Doesn't match "two trains served at once".

### Rules (option 1)

- Each crane works the train on its own track only; the depot's own track keeps its old crane.
- **Shared piles, first come:** cranes take turns a tick at a time in the order their trains halted, so when two want
  the last flour, the one that came first gets it. (Deterministic: ties by train id.)
- **Wait for a full load** is per train: one train can wait full on track 2 while track 1 keeps working.
- Speed upgrades (Mills II, faster cranes) apply to every crane.
- Production (`rate`, the yard's caps) doesn't change: more tracks make it quicker to load and unload, not to make.

## 4. Routing: picking a track

A route's stop stays the depot (one stop). It must stay predictable, so:

- **The router aims at the depot's tracks as a set.** At the ladder's facing crossover it sets the way to the
  **lowest-numbered free track**: the depot's own track first, then 2, then 3. Free: no train standing on it and none
  given a lock toward it (`Router` locks). Every train of a line comes to the same answer in the same state.
- **None free:** it waits short of the ladder, as at a busy passing loop, and its card says "Waiting for a free track
  at Mill".
- **Sections:** an industry with n tracks is a passing place with n roads. `sections.ts` today knows loops of two
  roads; it learns loops of n (the ladder is a nested pair of loops at 3: worked out as one "yard" of n roads). The room
  rule counts it as n − 1 passing places, so a line through a 2-track mill takes one more train. The rule that skips a
  stop when a train was sent round by the free road (`skipStops`) doesn't skip when the free road is the same depot's
  track: it calls there.
- **Hand-run trains** (no route) go the way the points lie; whichever track they stand on, its crane serves them
  (true in the prototype today).
- The ladder's crossovers are ordinary points (lever, pin, default): a player can pin one to keep a track for a line.

This is the same work Rail and road's step "route to a free siding" was waiting for (§5).

## 5. The planned Goods yard (tech tree step 10)

The goods yard (a `depot-goods-yard` piece shaped like the terminus: a warehouse with three sidings, upgraded in place
from a warehouse) is **a special case of this**: a warehouse with three tracks. Recommendation:

- **Drop the separate goods-yard piece.** A warehouse upgraded to 3 tracks is the goods yard (its cap could double at
  3 tracks, as the goods yard planned: 48, if wanted).
- **The research node becomes "Sidings"** (Logistics t2, needs Warehouses and Junctions and loops, 6 planks + 120
  coins, where Goods yard stood): "Give an industry a second and third track: a crane for each, so trains don't wait."
  It unlocks the upgrade for every industry. The third track needs stone anyway, so it comes with Quarries.
- Both wait on the same router change (§4: aim at a set of tracks, pick the first free). That change is the bulk of
  the work; the rest is small.

Why a research and not free from the start: the early game teaches one train at a time; a second track is a fix for a
busy line, which comes with Routes and Warehouses. It also keeps the crossovers (a Junctions piece) behind Junctions.

## 6. Which industries

Every industry a train is loaded or unloaded at by crane: harvester (forest), sawmill, workshop, farm yard, mill,
quarry, warehouse, mine, foundry, carpenter, smithy, power station, harbour (on the landward side; boats still use the
quay), dairy, bakery, orchard, juice works, creamery, ice cream factory, brickworks.

Not: a town's station (it has Big stations), a school (a few research loads; not worth it), Sandbox's loaders (kits),
halts.

## 7. Saves

- Per industry, what it laid: `depotTracks: [depotPieceId, roads: pieceId[], ladder: pieceId[]][]` in the save.
  Its number of tracks is 1 + its roads still on the map. Old saves have none: **1 track**.
- On load each road is given back to the economy (`Economy.addRoad`) and drawn (`DepotView`).
- The ladder pieces are ordinary pieces (saved as pieces); a road taken up by the player (the eraser) is just a track
  less: its crane goes with it. (Taking up a road needs a rule: either the depot's roads are fixed like the depot, or
  taking one up gives the upgrade back. Recommended: fixed, like the depot itself; undo is the way back.)

## 8. The prototype (on this branch)

- `src/game/depot-tracks.ts`: the planner (`planTracks`: the walk out along the line for straights, the ladder, the
  drop rule asked for every piece), `recordTracks`, prices and roles. Unit tests in `depot-tracks.test.ts` (2 → 3
  tracks laid and joined; a bend refused; two trains worked at once from one yard).
- `Economy.addRoad`: a depot's further track is a `DepotState` of its own piece and crane point that reads everything
  else through to its depot (same id, piles, settings), so a route's stop is called at on any track; it isn't in
  `allDepots` (it makes nothing and isn't counted). A train's service now remembers the depot object it's at, so two
  trains at one depot each have their own crane (`craneMove`/`cranePhase` by piece).
- `DepotView`: a road's site draws only its long gantry and its crane's moving parts; piles stay its depot's.
- The card: "One track: one train at a time" / "2 tracks: 2 trains loaded at once" and the button with its price, or
  why not (Game mode).
- `tools/shots/depot-tracks.mjs`: the pictures.

Not in the prototype (the build, after the decision): the router and sections change (§4: routed trains still aim at
the depot's own track), the save (§7), the research node (§5), the goods given back on undo, drawing a road's site on
its own instead of the whole `DepotView` again (`setWorld`, once per upgrade), the depot's own gantry's near leg (it
stands between the first and second track, clear of trains, but could go), two cranes moving the same kind of goods at
the same moment (one unit drawn on the hook: `DepotView`'s one carried unit per kind), an e2e (upgrade by taps, two
routed trains standing at once and the goods carried on), and `Object.create` for roads replaced by an explicit type.

Cost: nothing per frame while nothing moves. A road's crane costs what a depot's crane costs (drawn only near the
camera, moving only while it works). The planner runs on a tap, and on the card only when the track, the land or the
workshop's stock change (keyed).

## 9. Decisions wanted

1. **How the track is laid:** A, the depot lays the ladder (recommended), or B, the player lays it and the depot claims it?
2. **The crane:** one per track (recommended), one moving between them, or one faster?
3. **Prices:** 10 planks, then 12 planks + 10 stone?
4. **Goods yard:** fold it into this (a warehouse at 3 tracks) and make its research node "Sidings" (recommended)?
   Or free from the start, no research?
5. **Routing:** lowest-numbered free track first, wait short of the ladder when all are full?
