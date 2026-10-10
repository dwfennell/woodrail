# Woodrail — Block Landscape & Towns (iteration 1) Design

**Date:** 2026-10-10
**Status:** Draft for review
**Builds on:** `2026-10-10-core-sandbox-design.md` (milestone 1, implemented)

## 1. Goal

Replace the rug-and-props scene with a generated **block landscape on a felt play mat**: towns of block buildings, each with a fixed station, separated by stacked-block hills, felt rivers and trees. The player builds track between towns. The landscape is a physical obstacle that track must route around, climb onto, or bridge over.

This iteration delivers the world and the building challenge only. It deliberately leaves hooks for later iterations:

- **Landscape editing** (player adds/removes hills, rivers, trees) — deferred.
- **Economy** — a mix of light cargo (goods produced/wanted), towns growing when connected, and per-town requests — deferred.
- **OpenTTD-style town growth** on the same grid — deferred.

### Success criteria

- "New map" generates a varied, deterministic (per seed) landscape with 3–4 towns, every pair reachable by track.
- Dragged track turns red with a reason when it would hit a building, cross a river without a bridge, cut into a hill, or hit a tree; it can be laid on hill tops at block height.
- Connecting two stations by track lights both town signs and announces the connection.
- Saves include the map (older saves are discarded — no compatibility until v1).
- Desktop and mobile performance targets from the core spec still hold.

### Out of scope

Landscape editing, cargo/requests/growth, functional roads, multiple mats, terrain other than flat blocks (no slopes besides track ramps).

## 2. Model (`src/landscape/`, pure TypeScript, Node-testable)

### 2.1 Grid

- The play mat is **3200 × 2368 mm**, centred on the world origin, divided into **64 mm squares** (50 columns × 37 rows). 64 mm equals `RISER_HEIGHT`, so block heights line up with risers and ramps.
- `LandscapeGrid` stores per square, in flat typed arrays:
  - `height`: 0–3 blocks (`height × 64 mm`).
  - `surface`: `grass | river | road | town`.
  - `feature`: `none | tree | building | station`, plus an owner id (building or town id) where relevant.
- Conversions: `cellAt(x, z)` → `(col, row)` or none if off the mat; `cellCentre(col, row)` → plan position.

### 2.2 Towns and stations

- `Town { id, name, cells, stationPieceId, buildings[] }`; `Building { cells, floors, roof: colour, kind: "house" | "shop" }`.
- Towns and stations are fixed: not movable, not deletable, their squares locked.
- **Station** is a new track piece type `station`: a 216 mm straight (socket at start, peg at end) whose render includes a platform, canopy, station building and name board on one side. It is not in the tray. The generator places one per town; both ends are free pegs/sockets for the player to connect to.

### 2.3 Generation — `generateLandscape(seed): Landscape`

Deterministic (seeded PRNG). Steps:

1. **Towns:** choose a town count of 3 or 4. Place town centres at random positions with a minimum separation of **900 mm between stations** and a margin of 4 squares from the mat edge (rejection sampling). Distances otherwise vary freely — some towns close together, some far. Each station's heading is a random multiple of 45°. Each town reserves a roughly 6 × 5-square flat area around its station.
2. **Hills:** smooth value noise sampled per square, thresholded into heights 0–3. Then force height 0 on town areas and on a **clear corridor 4 squares wide extending 6 squares from each station end**, and smooth so no square differs from a neighbour by more than 1 block (no cliffs taller than one block — rampable).
3. **Rivers:** 1–2 rivers traced edge-to-edge as a smoothed random walk that avoids town areas and corridors; river squares are height 0.
4. **Buildings:** fill each town area (except the station and its corridor squares) with 4–8 buildings of 1–2 squares and 1–2 floors; road squares between them.
5. **Trees:** clustered scatter on grass squares outside towns and corridors (~8% of free squares).
6. **Validation:** for every pair of stations, grid A* from each station's corridor end over squares that are not buildings/trees/town, treating river squares as crossable (bridges) and height changes of ≤ 1 as climbable. If any pair fails, regenerate with `seed + 1` (bounded attempts).

`Landscape = { seed, grid, towns }`.

### 2.4 Clearance — `checkPlacement(landscape, layout, type, flipped, pose, y): Clearance`

`Clearance = { kind: "clear" } | { kind: "blocked"; reason: BlockReason }`, `BlockReason = "building" | "station" | "town" | "river" | "hill" | "tree" | "off-mat"`.

- Sample each path of the piece every 16 mm, at the centre line and at ±18 mm laterally (the track's sides).
- For each sample, look up the square:
  - Off the mat → `off-mat` (track must stay on the mat).
  - `building`, `tree` → blocked with that reason.
  - `town` surface → `town`, except samples within the station piece's own connector capture zone.
  - `river` → `river`, unless the piece is a `bridge` (its deck spans it).
  - **Height:** with piece track height `h(s) = y + pathY(s)` and ground `g = height × 64`, blocked (`hill`) if `h(s) < g` (cutting into the hill). Track resting on top (`h(s) == g`, within 1 mm) or above it is clear.
- Pure and allocation-light (called per pointer move).
- **Drop height:** for a loose drop (no snap), the piece's base height is the maximum ground height under its samples, so track can be laid on hill tops.

### 2.5 Connections — `connectedTowns(landscape, layout): [townA, townB][]`

Two towns are connected when their station pieces are in the same connected component of the layout's joint graph (direction and switch state ignored). Computed with a union-find over joints after each layout change.

## 3. Rendering (`src/render/landscape-view.ts`)

- **Felt mat:** replaces the rug. Green felt, soft fibre bump, high roughness with sheen, slightly rounded and stitched edges, ~4 mm thick on the existing oak floorboards. Track base height 0 is the mat's top.
- **Hill blocks:** each hill square stack is rendered as wooden blocks; contiguous squares at the same height merge into larger slabs (greedy rectangle merge per level) so hills read as stacked lumber, not voxels. Sides show the beech wood (alternating tones per layer); tops are painted green lacquer. Instanced/merged meshes; static, rebuilt only on new map.
- **Rivers:** blue felt strips following river squares with rounded corners, slightly raised (1 mm), subtle sheen.
- **Trees:** existing cone trees plus a round "lollipop" tree; deterministic variety per square.
- **Towns:** block houses (existing style) and flat-roof shops on their squares; grey felt road strips; a wooden name sign per town that glows warm when connected.
- **Station:** platform, canopy, building and name board beside the station piece's track (part of the station piece's render).
- The scene's scattered props and rug are removed; the room walls, toy box and floor remain.
- Camera framing (`frameLayout`) frames the mat on a new map.

## 4. Interaction

- Track placement (tray drag and moving pieces) calls `checkPlacement` each pointer move. Blocked → red ghost (new ghost material) and a short reason message ("Needs a bridge over the river", "That's a house", "Too low — the hill is in the way", "Keep the track on the mat"); dropping a blocked piece does nothing (a new piece returns to the tray; a moved piece returns to where it was).
- Station pieces cannot be selected for move/rotate/flip/delete (tap shows the town name instead).
- When `connectedTowns` gains a pair: both town signs light up and a toast announces "Applebury ↔ Millbrook connected!" with a soft chime.
- **Menu:** "New map" (new random seed). "Starter layout" becomes "Starter map": a fixed seed with a short line already joining two towns and a train running.
- No Landscape tray tab in this iteration.

## 5. Physics

Hill block stacks become static cuboid colliders (merged per slab) when derail physics builds its static world, so tumbling cars land on hills. Rivers and the mat are flat ground.

## 6. Persistence

- Save format **version 2** adds `landscape: { seed }` and `towns: [{ id, stationPieceId }]` (towns are regenerated from the seed; the ids bind them to the saved station pieces).
- **No backward compatibility yet:** until a working v1 of the game exists, older saves are simply rejected (the result is an `invalid` value) and the game starts the starter map. No migrations.
- Loading validates as before (Zod, result values, never throws).

## 7. Testing

- **Generation** (200 seeds): deterministic per seed; 3–4 towns; station separation ≥ 900 mm; town areas flat and locked; corridors clear; no neighbouring height step > 1; every station pair connectable by the validation A*.
- **Clearance:** straight over river blocked, bridge over river clear; piece at y = 64 on a 1-block hill clear, at y = 0 blocked (`hill`); house square blocked; tree blocked; off-mat blocked; snapping onto a station's free peg allowed.
- **Drop height:** loose drop on a 2-block hill gets y = 128.
- **Connections:** route between two stations → connected; removing a middle piece → disconnected; switch state irrelevant.
- **Persistence:** v2 round-trip reproduces the identical landscape; a v1 save is rejected with a reason.
- **Benchmarks:** `checkPlacement` per drag frame stays under 20 µs at 2,000 pieces.
- Visual review via screenshots on desktop and phone viewports.
