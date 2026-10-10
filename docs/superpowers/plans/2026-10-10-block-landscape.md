# Block Landscape & Towns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen: inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rug scene with a generated block landscape on a felt mat — fixed towns with stations, stacked-block hills, felt rivers, trees — where track must route around, onto or over the landscape, and connecting stations is recognised.

**Architecture:** A new pure module `src/landscape/` (grid, generation, clearance, connections, hill slabs) tested in Node. The renderer gets `landscape-view.ts`; interaction consults `checkPlacement` while dragging; physics adds hill slabs as colliders; the save format moves to version 2 (no backward compatibility).

**Tech Stack:** TypeScript, Vitest, Three.js r186, Rapier, Zod (existing).

**Spec:** `docs/superpowers/specs/2026-10-10-block-landscape-design.md`

**Plan style ruling:** at the user's direction ("you are autonomous") this plan specifies exact interfaces, test cases and algorithms; implementation code is written during execution under TDD rather than duplicated in the plan.

## Global Constraints

- Units mm; plan coordinates (x, z); `heading` from +x toward +z; left lateral = `(-sin h, cos h)`.
- Mat 3200 × 2368 mm centred on origin; cell 64 mm; 50 cols × 37 rows; heights 0–3 blocks of 64 mm.
- `src/landscape/` imports only `src/track/` (and `src/lib/`); no Three.js, DOM.
- `checkPlacement` is called per pointer move: no allocation in its inner loop.
- No exceptions for control flow; results are discriminated unions.
- No save backward compatibility (spec §6).

## Review Focus

1. **Diagonal (45°) stations** — town areas, corridors and platform cells must be computed by distance to the station line, not axis-aligned rectangles; a diagonal station must still have both ends reachable. (Task 3 tests run all 8 headings via 200 seeds.)
2. **Pieces snapped onto a station end** — samples are inset 6 mm from each path end, so a piece seated on a station peg is not blocked by the station's own cells. (Task 4 test.)
3. **Ramps onto hills** — a ramp from ground to a 1-block hill must be clear at every sample (its rising path stays at or above ground). (Task 4 test.)
4. **Track off the mat edge** — any sample off the mat blocks the piece. (Task 4 test.)
5. **Stale towns after loading** — loading binds towns to saved station piece ids; a save whose station ids are missing is rejected rather than producing a town without a station. (Task 7 test.)

---

### Task 1: Station piece type

**Files:** Modify `src/track/pieces.ts`, `src/track/pieces.test.ts`.

**Interfaces:** Produces `PieceTypeId` member `"station"`: 216 mm straight, socket at origin, peg at x = 216, `flippable: false`, `isSwitch: false`.

- [ ] Add test: `getPieceDef("station")` has connectors `["socket","peg"]`, peg at x 216; it appears in `PIECE_TYPES` (catalog invariant test covers its paths).
- [ ] Run → FAIL. Add `station: straight("station", 216)` to CATALOG. Run → PASS. Full suite green. Commit.

### Task 2: Landscape grid

**Files:** Create `src/landscape/grid.ts`, `src/landscape/grid.test.ts`.

**Interfaces (produces):**
- Constants `MAT_WIDTH = 3200`, `MAT_DEPTH = 2368`, `CELL = 64`, `COLS = 50`, `ROWS = 37`, `MAX_HEIGHT = 3`.
- Surface codes `SURF_GRASS = 0, SURF_RIVER = 1, SURF_ROAD = 2, SURF_TOWN = 3`; feature codes `FEAT_NONE = 0, FEAT_TREE = 1, FEAT_BUILDING = 2, FEAT_STATION = 3`.
- `class LandscapeGrid { height: Uint8Array; surface: Uint8Array; feature: Uint8Array; owner: Int16Array; index(col,row): number; inBounds(col,row): boolean; colAt(x): number; rowAt(z): number; cellAtWorld(x,z): number /* -1 off mat */; centreX(col): number; centreZ(row): number; groundY(index): number }`.

**Tests:** corners map to cells 0 and COLS*ROWS-1; points just off the mat → -1; `centreX(colAt(x))` within 32 mm of x; `groundY` = height × 64.

- [ ] Write tests → FAIL → implement → PASS → commit.

### Task 3: Generation

**Files:** Create `src/landscape/generate.ts`, `src/landscape/noise.ts`, `src/landscape/generate.test.ts`.

**Interfaces (produces):**
- `interface Building { id: number; cells: number[]; floors: 1 | 2; kind: "house" | "shop"; roof: number /* palette index */ }`
- `interface Town { id: number; name: string; centre: { x: number; z: number }; station: Pose /* station piece origin (socket) pose */; cells: number[]; buildings: Building[] }`
- `interface Landscape { seed: number; starter: boolean; grid: LandscapeGrid; towns: Town[] }`
- `generateLandscape(seed: number, options?: { starter?: boolean }): Landscape`
- `stationEnds(town): { x, z, heading }[2]` — outward ends (socket end heading = station.heading + π, peg end heading = station.heading).
- `reachable(landscape): boolean` — validation BFS (exported for tests).

**Algorithm (seeded mulberry32 from `src/render/textures.ts` moved to `src/lib/rng.ts`):**
1. Towns: count 3 or 4; rejection-sample centres with margin 4 cells, station centre separation ≥ 900 mm; heading = random multiple of π/4; station origin = centre − 108·dir. Starter option: exactly 3 towns where towns 0 and 1 share a row, heading 0, 1080 mm apart (station centres), so 4 × 216 straights join peg of town 0 to socket of town 1.
2. Classify cells by distance to each station line (along `d`, lateral `l`, relative to centre and heading):
   - station track: |d| < 108 and |l| < 26 → `FEAT_STATION`;
   - platform: |d| < 100 and 26 ≤ l < 120 (left side) → `FEAT_STATION`;
   - corridor: 76 ≤ |d| < 108 + 6·64 and |l| < 2·64 → protected clear (grass, height 0, feature none);
   - town area: distance from centre < 210 mm and not corridor/station → `SURF_TOWN`.
   - Starter: the strip between towns 0 and 1 (along their shared row, |l| < 128) is protected clear.
3. Hills: fbm value noise (scale ~8 cells) → `h = clamp(floor((n − 0.42) × 7), 0, 3)`; zero on protected/town/station cells; relax until every 4-neighbour step ≤ 1 (`h = min(h, minNeighbour + 1)` iterated).
4. Rivers: 1–2 random walks from one edge to the opposite edge, biased toward the target edge, never entering protected/town/station cells (retry a few times, else skip); river cells height 0, surface river; re-relax heights.
5. Buildings: in each town's `SURF_TOWN` cells, place 4–8 buildings (1 cell, or 2 adjacent cells) — feature building with owner id; remaining town cells become `SURF_ROAD`.
6. Trees: on grass, non-protected, non-river cells where a second noise > 0.62 and rng < 0.55.
7. Validate with `reachable`: BFS over passable cells (feature none, surface grass or river, |Δh| ≤ 1) from each station's two corridor-end cells; every pair of towns must share a component. If not, regenerate with seed + 1000·attempt (max 20).

**Tests (generate.test.ts):**
- same seed → identical arrays and towns; different seeds differ.
- for seeds 1..200: 3–4 towns; station centre separation ≥ 900; all town/station/corridor cells have height 0; no 4-neighbour height step > 1; `reachable` true; no tree/building/river on corridor cells; station headings are multiples of π/4.
- starter: towns 0 and 1 heading 0, same z, 1080 apart; cells along the strip between them are clear and flat.

- [ ] Move `rng` to `src/lib/rng.ts` (update textures import). Write tests → FAIL → implement → PASS → commit.

### Task 4: Clearance and drop height

**Files:** Create `src/landscape/clearance.ts`, `src/landscape/clearance.test.ts`.

**Interfaces (produces):**
- `type BlockReason = "building" | "station" | "town" | "river" | "hill" | "tree" | "off-mat"`
- `type Clearance = { kind: "clear" } | { kind: "blocked"; reason: BlockReason }`
- `checkPlacement(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): Clearance`
- `groundUnder(land, type, flipped, pose): number` — max ground height (mm) under the piece's samples.
- `BLOCK_MESSAGES: Record<BlockReason, string>`.

**Rules:** samples along each path from s = 6 to len − 6 every 16 mm (always both ends), at lateral 0 and ±18; risers sample their footprint centre and corners (±20). Per sample: off mat → `off-mat`; feature tree/building/station → that reason; surface town/road → `town`; surface river → `river` unless type is `bridge`; height: track base `y + pathY(s)` < ground − 0.5 → `hill`.

**Tests** (build small hand-made `Landscape` fixtures with a helper `flatLandscape()` + setters):
- straight on flat grass clear; over a river cell blocked `river`; bridge over river clear.
- straight with base y = 64 over a 1-block hill clear; y = 0 blocked `hill`.
- ramp starting on ground 0 and ending over a 1-block hill (high end on the hill) clear.
- building cell → `building`; tree → `tree`; town cell → `town`; off the mat → `off-mat`.
- a straight seated on a generated station's peg (pose from `stationEnds`) on a starter map → clear.
- `groundUnder` on a 2-block hill → 128.

- [ ] Write tests → FAIL → implement → PASS → commit.

### Task 5: Connections and hill slabs

**Files:** Create `src/landscape/connections.ts`, `src/landscape/slabs.ts`, tests for each.

**Interfaces (produces):**
- `connectedPairs(layout: Layout, stationPieceIds: Map<number /*townId*/, number /*pieceId*/>): [number, number][]` (sorted pairs, a < b) — union-find over `layout.joints()`.
- `interface Slab { x0: number; z0: number; x1: number; z1: number; level: number /* 1..3 */ }` (world mm rectangle of one block layer)
- `hillSlabs(grid): Slab[]` — per level L = 1..3, greedy rectangle merge over cells with height ≥ L.

**Tests:** two stations joined by straights → `[[a,b]]`; remove a middle piece → `[]`; switch state irrelevant (route through a switch branch). Slabs: a 2×2 block of height 1 → one slab level 1 covering 128×128; an L shape of height 2 → slabs at level 1 and 2 whose areas sum to cell count × 64² per level; total slab area per level equals cells with height ≥ level.

- [ ] Write tests → FAIL → implement → PASS → commit.

### Task 6: World integration (stations in the layout, starter map)

**Files:** Create `src/game/world.ts` (+ test); modify `src/game/starter.ts`, `src/game/game.ts` (`GameWorld` gains `landscape`), `src/main.ts`.

**Interfaces (produces):**
- `interface World { layout: Layout; sim: Sim; landscape: Landscape; stations: Map<number, number> /* townId → station piece id */ }`
- `createWorld(seed: number): World` — generates the landscape and adds a `station` piece per town at `town.station`.
- `buildStarterWorld(): World` — `generateLandscape(STARTER_SEED, { starter: true })`, stations, 4 straight-216 from town 0's peg to town 1's socket, buffers on the two outer ends, and a running train (engine + hopper + passenger + caboose) heading toward town 1.

**Tests:** `createWorld(seed)` has one station piece per town at the town pose; starter world: `connectedPairs` contains (town0, town1); the train runs 60 s without derailing; every placed non-station piece passes `checkPlacement`.

- [ ] Write tests → FAIL → implement → PASS → commit.

### Task 7: Persistence v2

**Files:** Modify `src/persist/save.ts`, `src/persist/save.test.ts`.

**Interfaces:** `SAVE_VERSION = 2`; schema adds `landscape: { seed, starter }`, `towns: [{ id, stationPieceId }]`. `serializeWorld(world: World)`, `deserializeWorld(data): Result<World, string>` (regenerates the landscape; binds stations; rejects a missing station piece). Storage key bumps to `woodrail.autosave.v2`.

**Tests:** round-trip of the starter world reproduces identical grid arrays, towns, connections and trains; a version-1 payload → `ok: false`; a save whose town station id is missing → `ok: false` with reason mentioning the town.

- [ ] Write tests → FAIL → implement → PASS → commit.

### Task 8: Landscape rendering

**Files:** Create `src/render/landscape-view.ts`; modify `src/render/room.ts` (remove rug and scattered toys, keep floor/walls/toy box), `src/render/materials.ts` (felt, river felt, block wood, painted-green block tops, road felt), `src/render/textures.ts` (felt textures), `src/render/track-geometry.ts` (station platform/canopy/building geometry as a separate "dressing" geometry like the buffer block), `src/render/track-view.ts` (instanced station dressing), `src/game/game.ts`.

**Behaviour:** felt mat (rounded, stitched edge), hill slabs (from `hillSlabs`) as rounded wooden blocks with green tops, river felt strips, trees (cone + lollipop), town buildings (existing house style + flat-roof shops), road felt, glowing name signs (`setConnected(townIds)`), station dressing. `frameLayout` frames the mat.

**Verification:** screenshots desktop + iPhone viewport of the starter map and two random maps; check no z-fighting between felt, rivers and slabs; track sits on hill tops without floating.

- [ ] Implement → typecheck → screenshot review → iterate → commit.

### Task 9: Interaction and menu

**Files:** Modify `src/game/interaction.ts`, `src/render/materials.ts` (red ghost), `src/ui/hud.ts` (menu: New map, Starter map), `src/main.ts`, `src/audio/audio.ts` (chime).

**Behaviour:** per pointer move: loose drop height = `groundUnder`; clearance on the final pose (snapped or loose); blocked → red ghost + reason toast (only when the reason changes); drop while blocked → new piece cancelled / moved piece returns. Station pieces: tap shows "Station: <town>", no drag/select. After each change, compare `connectedPairs` with the previous set; new pairs → toast "A ↔ B connected!", chime, signs lit.

**Verification:** browser: drag a straight across a river (red, "Needs a bridge…"), drop a bridge there (clear), chain from a station end to another station (toast).

- [ ] Implement → typecheck → browser check → commit.

### Task 10: Physics hills and benchmark

**Files:** Modify `src/physics/derail-physics.ts` (accept slabs; static cuboids), `bench/track.bench.ts` (add `checkPlacement` at 2,000 pieces on a generated landscape).

- [ ] Add slab colliders; verify in browser that a car derailing on a hill rests on it. Add bench; `checkPlacement` < 20 µs. Commit.

## Done criteria

All tests, typecheck, build pass; screenshots reviewed on desktop and phone; whole-branch review dispatched and Critical/Important findings fixed.
