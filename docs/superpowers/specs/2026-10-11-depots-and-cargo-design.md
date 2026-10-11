# Woodrail — Milestone 2: Depots and Cargo (Timber) Design

**Date:** 2026-10-11
**Status:** Draft for review
**Builds on:** `2026-10-10-core-sandbox-design.md`, `2026-10-10-block-landscape-design.md`, `2026-10-10-bigger-world-design.md`,
`2026-10-11-grid-72-design.md` (72 mm squares, 62 × 46 mat, stations on the grid facing map directions)

## 1. Intent

The first economy for Woodrail, inspired by how wooden toy railway sets present work: cargo is a **physical wooden
piece you can see**, depots are **buildings the train drives through**, and cranes and chutes **visibly move** the
goods. Mechanics and style are borrowed; names, logos and replicas of specific commercial sets are not.

The user's direction: **automatic by default, manual if desired.** Depots load and unload trains on their own, so the
player's job is to build a railway that runs itself. A loop of track with the right stops on it is a working supply
chain. Players who like hands-on play can still move cargo by hand at any time, or switch a depot to manual.

This milestone delivers one complete chain, end to end:

**forest → logs → sawmill → planks → town**

### Success criteria

- A new map has 1–2 forests and one sawmill, all reachable by track from the towns.
- A player can put a timber train on one loop through a forest, the sawmill and a town station, set it going, and
  walk away: it keeps carrying logs and planks with no further input.
- Every load and unload is shown: the crane swings, the cargo piece moves, piles grow and shrink.
- The same works by hand: cargo can be dragged between piles and wagons, on desktop and touch.
- Economy state saves and loads; production is deterministic per seed and input sequence.
- Performance targets from the core spec still hold with 5 timber trains running.

### Out of scope

Money, prices, goals and unlocks (milestone 3), town growth from deliveries (milestone 3, but §7 leaves the hook),
other cargo chains (coal, farm, mail, passengers, harbour; see §11), player-placed industries, timetables, signals,
cargo spilling on derail.

## 2. Cargo

- **Kinds:** `log` and `planks` (a strapped bundle). A small data table, so later kinds (coal, milk, mail) are rows,
  not code paths.
- Each cargo unit is a physical toy: a turned-wood log, or a bundle of three thin boards with a painted strap.
  One unit is always one visible piece. No hidden numbers beyond what you can see on a pile or a wagon.
- **Timber wagon** (new car kind `timber`): a flat wagon with four upright stakes. Holds **3 units**, all of one kind.
  Added to the tray as "Timber wagon" and to a new tray preset "Timber train" (engine + 3 timber wagons).
  One wagon kind for both logs and planks keeps the loop simple: the same wagon arrives with logs and leaves with
  planks.
- The existing coal hopper stays decorative this milestone.

## 3. Depots

A **depot** is a fixed, generated track piece with a building drawn around it, exactly like the existing `station`
piece: not in the tray, not movable or deletable, its squares locked, both ends free for the player to connect.
All depots are **drive-through**: the track runs under or through the building, and trains can enter from either end.

| Depot | Piece type | Takes | Gives | Building |
|---|---|---|---|---|
| Forest yard | `depot-forest` | — | logs | Open log stack, a jib crane with a magnet head, a small hut, generated trees around it |
| Sawmill | `depot-sawmill` | logs | planks | Long open-sided shed over the track, a big saw blade that spins while working, log pile on one side, plank pile on the other, overhead gantry crane |
| Town station | `station` (existing) | planks | — | Existing station plus a small goods gantry at one end of the platform and a plank pile beside it |

Depot piece length is 216 mm (as the station: exactly 3 squares of the 72 mm grid), so all depots share one clearance
and generation path. Like stations, depots face one of the four map directions, are centred on a square, and have
their ends on square edges, so a run of straights and large curves from a station closes on a depot.

### 3.1 Stock

Each depot has piles, shown as stacked cargo pieces next to the track:

- **Forest yard:** output pile, grows by 1 log every 15 s, cap 12.
- **Sawmill:** input pile (logs, cap 12) and output pile (planks, cap 12). Turns 1 log into 1 bundle every 8 s while
  it has a log and room for a bundle. The saw spins only while it works.
- **Town station:** input pile (planks, cap 12). The town takes 1 bundle every 30 s (a little cart or simply the
  bundle sliding into town and disappearing with a puff of sawdust).

All rates and caps are constants in one module. When a pile is full, the depot stops accepting that cargo
(wagons keep it) or stops producing (the forest stops growing logs). Nothing is ever lost.

## 4. Automatic loading

This is the core of the milestone.

### 4.1 Servicing a train

Each depot has one **crane point** on its track. When a train runs onto a depot whose automation is on:

1. The train slows to a crawl (30 mm/s) while any part of it is on the depot piece.
2. When a car that **needs service** reaches the crane point, the train halts with that car centred under the crane.
3. The crane works the car, one unit at a time (≈1.2 s per unit, animated):
   - first **unload** every unit the depot takes and has room for;
   - then **load** units the depot gives, while the car has room and is empty or already holds that kind.
4. The train creeps on to the next car that needs service, and repeats.
5. When the last car has cleared the crane point, the train speeds back up under its engine lever as normal.

A car **needs service** when there is something to unload into the depot (and room for it), or something to load
from the depot (and room on the car). Cars that need nothing roll past at a crawl. Trains that have nothing to do
here still crawl through, which reads as "this train stopped at the depot" and keeps behaviour predictable.

The engine lever stays the master control: an engine set to off stays stopped; reversing the lever while being
serviced cancels the service and the train leaves the other way. Direction of travel does not matter to the depot.

### 4.2 Waiting

Each depot has a **"Trains wait for a full load"** toggle (off by default):

- **Off:** load what is there and go. Keeps trains moving; with several trains on a loop, they share the stock.
- **On:** a car that could take more waits under the crane until it is full. Useful for a dedicated shuttle.

### 4.3 Turning back automatically

Point-to-point lines need trains to turn round without the player. A new tray piece:

- **Turnback buffer** (`buffer-turnback`): a stop buffer with a small striped flag. A train that stops at it waits
  2 s, then its engine lever flips and it drives back. Ordinary buffers keep their current behaviour.

With this piece, two layouts both run on their own:

- **Loop:** forest → sawmill → town → back to the forest.
- **Shuttle:** turnback buffer at each end of a line with depots along it.

### 4.4 What automation does not do

No routing, orders or timetables. Trains go where the track and switch levers take them; the layout is the
program. This keeps the game light and makes the railway the thing you build.

## 5. Manual play

Manual play is always available alongside automation:

- **Drag cargo by hand.** Any cargo piece on a pile or a wagon can be picked up and dropped onto a wagon (with room,
  and same kind) or onto a pile that takes that cargo. Uses the same pick-up rules and float-above-the-finger
  behaviour as cars. Dropping anywhere else snaps the piece back to where it came from.
- **Depot card** (tap the depot building): pile counts as small cargo icons, the **Automatic** toggle (on by default),
  and the **wait for full load** toggle. With Automatic off, trains run through the depot at normal speed and only
  hand-moved cargo changes the piles. Production (forest, sawmill, town use) carries on either way.
- **Crank the crane** (stretch goal, desktop and touch): with Automatic off, dragging the crane's crank swings the
  crane and lifts or drops the top unit. Ships only if it feels good on a phone; dragging cargo is the baseline.

## 6. Simulation (`src/economy/`)

- New pure TypeScript module, no Three.js, Node-testable, inside the worker-ready simulation core
  (core spec §3.1): **commands in, snapshot out**.
- **Commands:** `setDepotAuto(depotId, on)`, `setDepotWaitFull(depotId, on)`, `moveCargo(from, to)` where `from` and
  `to` are pile or wagon slots.
- **State:** per depot, pile counts and production timers; per timber car, cargo kind and count; per train, a
  service state (`none | crawling | halted(carId, step)`).
- **Ticking:** production timers advance on the fixed 120 Hz sim tick using integer tick counts (no floating timers,
  no wall clock). Servicing runs in the train step: the economy sets a train's target speed (crawl / halt) and the
  existing motion model does the rest, so slopes, couplers and collisions are unchanged.
- **Snapshot:** flat typed arrays (pile counts per depot, cargo per car, crane phase per depot for animation) plus
  events (`loaded`, `unloaded`, `produced`, `consumed`) for sounds and small effects.
- Hot-path rules from the core spec apply: no allocation per tick, depots looked up by piece id, not scanned.
- **Derailing:** cargo stays on its wagon as part of the wagon's physics body, and is still there after re-rail.

## 7. Towns

- Delivered planks count per town and show on the town sign (a small plank icon and a number).
- No other effect this milestone. Milestone 3 uses the count to grow the town (new blocks and houses). The counter
  is saved so growth can start from real history.

## 8. Generation

- Extend `generateLandscape` (deterministic per seed):
  - 1–2 **forest yards** on grass near tree clusters, preferring the foot of hills; extra trees planted around them.
  - 1 **sawmill**, placed between the forests and the towns (closer to the middle of the map than the forests).
  - Depots use the same flat area, approach corridors, grid snapping and minimum separation rules as stations
    (900 mm from any station or depot).
- Reachability validation covers every station and depot pair (the existing grid A* check).
- **Starter map:** one forest and the sawmill sit on reasonable routes from the first two towns, so the first timber
  loop is easy to find. After the first two towns are joined, a hint suggests "Try a timber train".
- The 200-seed generation checks are extended: depot counts, flat depot areas and corridors, reachability.

## 9. Rendering and audio

- Depot buildings follow the toy style rules (§9.1) and reuse `render/dressing/buildings.ts` helpers.
- **Moving parts:** crane swing and lift, saw blade spin, plank pile slide. Driven by the snapshot's crane phase,
  interpolated like train motion.
- Cargo pieces are instanced per kind (one draw call per kind for all piles and wagons).
- Sounds: soft wooden clunk on load and unload, saw whirr while the sawmill works, a gentle chime when planks reach
  a town. All through the existing audio module and its toggle.

### 9.1 Toy style rules

Every building, car and prop follows the same rules, taken from wooden toy railway sets. The first pass of these
rules has been applied to the existing towns, stations and trains (see §9.2).

- **Bare beech first.** Bodies and working parts (walls, crane arms, stakes, platforms, saw tables) are natural beech;
  colour goes on roofs, trims, doors and a few accents. Some buildings are painted for variety.
- **A few strong colours:** the existing toy palette (red, blue, green, yellow, purple), lacquered.
- **Printed, not modelled, detail.** Windows are pale sky-blue panes with cream glazing bars, as if printed on;
  never dark glass holes. Signs and markings are decals.
- **Drive-through.** Buildings that serve trains put their roof over the track, so trains run under it.
- **Chunky working parts** a child could grab: cranks, chutes, levers, oversized crane hooks.
- **Rounded edges** on everything (rounded boxes, bevels), and scenery stays batched into few draw calls.

### 9.2 Applied to what exists

- **Houses and shops:** most walls bare beech under coloured roofs (some still painted), printed windows, flower
  boxes under the front windows of houses, a red-and-white striped awning on shops.
- **Stations:** the canopy now spans platform and track on posts both sides, its underside 76 mm up (clear of the
  engine's chimney); the station house is beech with printed windows; the name board stands higher, above the canopy.
- **Trains:** car and cab windows are printed panes instead of dark glass.

## 10. Persistence

- Save version 5 (the 72 mm grid took version 4). Adds: depots (piece id, auto, wait-full, piles, timers), cargo per car, per-town delivered count,
  `timber` car kind and `buffer-turnback` pieces.
- Older saves are discarded, as with previous version bumps (no compatibility before v1).

## 11. Later (not this milestone)

Recorded so the design leaves room for them:

- **More chains**, each a data row plus a building: mine → ore/coal (uses the coal hopper) → power station;
  farm → milk tanker / hay → town; harbour on the map edge → containers → towns; mail and passengers between stations.
- **Alternating switch** that sends trains left and right in turn, for sharing one line between several depots.
- **Player-placed depots** and buildings.
- **Lifting bridge** over rivers, **level crossings** on roads, **turntable** and **engine shed**.
- **Cargo spills** on derail, picked up by hand.

## 12. Testing

- **Unit (Vitest, Node):** production rates and caps; sawmill conversion; town consumption; service rules (unload
  before load, one kind per wagon, full piles refuse); crawl / halt / creep sequence for a 3-wagon train; wait-for-full
  on and off; lever off and lever reversal during service; turnback buffer; manual cargo moves (valid and refused).
- **Deterministic scenario:** a forest → sawmill → town loop with one timber train runs 10 simulated minutes and
  delivers an exact, repeatable number of plank bundles.
- **Generation:** 200 seeds — depot counts, flat areas, corridors, reachability of every station and depot.
- **Save:** round trip of economy state, including a train halted mid-service.
- **End-to-end (Playwright, desktop + emulated phone):** place a timber train on the starter loop and see a load
  happen; drag a log by hand onto a wagon; toggle a depot to manual and see trains pass without stopping.
- **Performance:** the core-spec benchmarks plus a sim tick with 20 depots and 20 timber trains; the 2,000-piece,
  20-train budget (under 2 ms per tick) still holds.
