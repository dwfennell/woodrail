# Depots and Cargo (Timber) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One complete, automatic supply chain: forest → logs → sawmill → planks → town, with visible cargo, cranes
that load and unload trains on their own, and hands-on cargo moving for players who want it.

**Architecture:** Depots are fixed generated track pieces like stations. A new pure module `src/economy/` owns
depot piles, production timers and cargo on wagons. The simulation stays ignorant of cargo: it gains one hook,
`Sim.speedCap`, which the economy sets so a train crawls through a depot and halts with a wagon under the crane.
The economy ticks right after the sim on the same fixed 120 Hz step and publishes a flat snapshot (pile counts,
cargo per car, crane phase) that the renderer animates.

**Tech Stack:** TypeScript, Three.js, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-depots-and-cargo-design.md` (§9.1 toy style rules apply to every model)

## Global Constraints

- Builds on `grid-72` and `claude/bold-bohr-fvqt5w` (lanes, paddocks, shed, `SAVE_VERSION` 5).
- Depot pieces are 216 mm straights (3 squares), headings multiples of 90°, midpoint on a square centre, like
  stations. Not in the tray; not movable, rotatable, flippable or deletable.
- All rates, caps and speeds are constants in `src/economy/constants.ts`: forest 1 log / 15 s (cap 12); sawmill
  1 log → 1 bundle / 8 s (input and output caps 12); town uses 1 bundle / 30 s (cap 12); crane 1.2 s per unit;
  crawl 30 mm/s; wagon holds 3 units of one kind; turnback wait 2 s.
- Timers count whole sim ticks (`SIM_HZ` = 120); no wall clock, no `Math.random` in `src/economy/` or `src/sim/`.
- Hot-path rules (core spec §3.2): no per-tick allocation in `Economy.tick`, `Sim.move` or view updates; depots are
  looked up by piece id (a `Map`), never scanned.
- Depots, like lanes, paddocks and the shed, are placed with their own random stream. `SAVE_VERSION` = 6; older
  saves are discarded.
- Nothing is ever lost: a full pile refuses cargo (the wagon keeps it) and stops production.

## Review Focus

- **Halting precision.** A wagon must stop centred under the crane (±3 mm) at crawl speed, in both directions of
  travel and with reversed cursors. The halt is detected by the wagon centre crossing the crane point between two
  ticks, not by equality (Task 5 tests).
- **Lever authority.** Lever off keeps a train stopped; reversing the lever mid-service cancels the service and the
  train leaves the other way; the economy never moves a train by itself (Task 5).
- **Coupling during service.** A second train running into a halted one couples or bumps exactly as today; the
  halted train's service state is dropped if its train id disappears (absorbed) (Task 5).
- **Derail and re-rail.** Cargo survives derail and re-rail (keyed by car id, which `rerail` must keep — check:
  today `rerail` re-adds the train and creates new car ids; Task 4 moves cargo across).
- **Reachability.** Every station and depot pair stays reachable on 200 seeds, starter map included (Task 3).
- **Determinism.** The 10-minute loop scenario delivers an identical count on repeated runs (Task 6).

---

### Task 1: Cargo kinds and the timber wagon

**Files:**
- Create: `src/economy/cargo.ts`, `src/economy/constants.ts`, `src/economy/index.ts`
- Modify: `src/sim/cars.ts` (`CarKind` gains `"timber"`; `CAR_SPECS.timber`: length 84, bogieInset 18, mass 1)
- Modify: `src/render/train-models.ts` (timber wagon: beech flatbed with four red stakes), `src/ui/icons.ts`,
  `src/ui/hud.ts` (`TRAIN_ITEMS`: "Timber wagon", and "Timber train" = engine + 3 timber)
- Test: `src/economy/cargo.test.ts`, existing car/save tests

**Interfaces:**
- Produces: `type CargoKind = "log" | "planks"`; `CARGO: Record<CargoKind, { index: number; label: string }>`;
  `WAGON_CAPACITY = 3`; `canCarry(kind: CarKind): boolean` (true for `"timber"` only).

- [ ] **Step 1:** Failing test: `canCarry("timber")` true, others false; `CARGO` indices are 0 and 1; every
  `CAR_KINDS` entry has a `CAR_SPECS` row with a unique `index`.
- [ ] **Step 2:** Implement. The wagon model follows §9.1: bare beech deck, lacquered red stake tops, magnets and
  wheels as on the other cars. Its thumbnail renders in the tray.
- [ ] **Step 3:** `npx vitest run`, `npx tsc --noEmit`; screenshot the wagon on track (desktop + 390 × 844).
- [ ] **Step 4:** Commit `feat(cargo): timber wagon and cargo kinds`.

### Task 2: Depot pieces and fixed pieces

**Files:**
- Modify: `src/track/pieces.ts` (`"depot-forest"`, `"depot-sawmill"`: `straight(type, 216)`, not in tray)
- Modify: `src/game/world.ts` (`World.fixed: Map<number, FixedPiece>` where
  `FixedPiece = { kind: "station"; townId: number } | { kind: "depot"; depotId: number }`; `stations` stays as a
  derived getter for existing callers)
- Modify: `src/game/interaction.ts` (`townOfStation` → `fixedLabel(pieceId)`: "Willowmere station", "Pine
  forest yard", "Sawmill"; every move/rotate/flip/delete refusal uses it)
- Test: `src/game/world.test.ts`, `src/game/interaction` refusal test if present, `src/track/pieces.test.ts`

- [ ] **Step 1:** Failing tests: depot piece defs are 216 mm straights with socket/peg ends; `createWorld` registers
  every station and depot in `fixed`; deleting or moving a fixed piece through the editor is refused.
- [ ] **Step 2:** Implement; depots get no special track geometry (their building is dressing, Task 7).
- [ ] **Step 3:** Commit `feat(track): depot pieces; stations and depots share one fixed-piece registry`.

### Task 3: Depot generation

**Files:**
- Modify: `src/landscape/generate.ts` (`Depot { id; kind: "forest" | "sawmill"; centre; piece: Pose; cells }`,
  `Landscape.depots`), `src/landscape/clearance.ts` (depot footprint blocks like a station: "The forest yard is
  in the way" / "The sawmill is in the way"), `src/game/world.ts` (adds depot pieces)
- Test: `src/landscape/depots.test.ts`

**Design:**
- Placement runs inside `attemptLandscape` right after towns, with `rng(seed * 47 + 5)`, so depot areas are locked
  before hills, rivers and trees. 1–2 forests, 1 sawmill. Same snapping, flat area (track row + one yard row on one
  side), approach corridors and 900 mm separation as stations. Forests prefer spots near the map's tree noise peaks
  (sample `valueNoise(seed * 13 + 5)`, the tree noise, and take the best of 12 candidates). The sawmill takes the
  candidate closest to the mean of the town centres.
- Starter map: the sawmill sits on the far side of the starter strip from town 0 within ~1.2 m, a forest within
  ~1.5 m of town 1, both with corridors facing toward the strip.
- `reachable` treats depot corridor ends like station corridor ends.

- [ ] **Step 1:** Failing tests over 200 seeds (plus starter): 1–2 forests and exactly 1 sawmill; headings multiples
  of 90°; midpoint on a square centre; flat locked area; ≥ 900 mm from every station and depot; all stations and
  depots pairwise reachable; depot cells never lane, river, paddock or shed.
- [ ] **Step 2:** Implement; then re-run the lane, paddock and shed suites (they must still pass unchanged).
- [ ] **Step 3:** Commit `feat(landscape): forest yards and a sawmill on every map`.

### Task 4: Economy state

**Files:**
- Create: `src/economy/economy.ts`
- Modify: `src/sim/sim.ts` (`rerail` returns the old→new car id map, or keeps car ids — prefer keeping ids)
- Test: `src/economy/economy.test.ts`

**Interfaces:**

```ts
export interface DepotState {
  readonly id: number;
  readonly pieceId: number;
  readonly kind: "forest" | "sawmill" | "town";
  auto: boolean;
  waitFull: boolean;
  /** Units in each pile, by CargoKind index (forest: [logs, 0]; sawmill: [logs in, planks out]; town: [0, planks]). */
  piles: Int32Array;
  /** Ticks into the current production or consumption cycle. */
  timer: number;
}
export class Economy {
  constructor(layout: Layout, sim: Sim);
  addDepot(kind: DepotState["kind"], pieceId: number): number;
  depotAtPiece(pieceId: number): DepotState | undefined;
  cargoOf(carId: number): { kind: CargoKind | null; count: number };
  setAuto(depotId: number, on: boolean): void;
  setWaitFull(depotId: number, on: boolean): void;
  /** Hand-moved cargo: one unit between a pile and a wagon. Returns false (and changes nothing) if not allowed. */
  moveCargo(from: CargoSlot, to: CargoSlot): boolean;
  /** Production, consumption and crane work for one sim tick. */
  tick(): void;
  readonly delivered: Map<number, number>; // townId → bundles delivered
}
export type CargoSlot = { kind: "pile"; depotId: number; cargo: CargoKind } | { kind: "car"; carId: number };
```

- [ ] **Step 1:** Failing tests: forest grows 1 log per 15 s to 12 and stops; sawmill converts only with a log and
  room; town uses 1 bundle per 30 s; `moveCargo` refuses wrong kind, full wagon, full pile, mixed kinds, non-timber
  cars; cargo survives `sim.rerail`.
- [ ] **Step 2:** Implement (crane work is Task 5; `tick` handles timers only here).
- [ ] **Step 3:** Commit `feat(economy): depot piles, production and hand-moved cargo`.

### Task 5: Automatic servicing

**Files:**
- Modify: `src/sim/sim.ts` (hook), `src/economy/economy.ts` (service state machine)
- Test: `src/economy/service.test.ts`

**Interfaces:**
- `Sim.speedCap: ((train: Train) => number) | null` — called once per powered train per tick in `move`; the target
  speed becomes `min(target, cap)`; a cap of 0 also brakes to 0 that tick (no coasting past the crane).
- Economy service state per train: `none | crawling | halted { carId, step, ticks }`, held in a `Map<trainId, …>`.

**Rules (spec §4.1):** while any bogie is on an automatic depot piece, cap = crawl. Each tick, for each car that
needs service, compute its centre's distance along the depot path (mean of its two bogie cursors, mapped to the
piece's own `s` direction); when that centre crosses the crane point (path midpoint, 108 mm) between ticks, cap = 0
and enter `halted`. The crane then works one unit per 1.2 s: unload every unit the depot takes and has room for,
then load while the car has room and holds nothing or the same kind; with `waitFull`, stay until the car is full.
Then `crawling` again until the next car needing service crosses the crane point, or the train leaves the piece.
Lever 0 or a lever reversal clears the state.

- [ ] **Step 1:** Failing tests, each on a straight layout `[straight, depot, straight]` with a 1-engine,
  3-timber train: crawls on the depot; halts each wagon within ±3 mm of the crane in both directions; unloads then
  loads in that order; passes through at crawl when nothing needs service; `waitFull` holds until full; lever off
  holds; lever reversal leaves the other way; coupling a second train into a halted one behaves as today.
- [ ] **Step 2:** Implement. No allocation in the per-tick path (preallocated cursors, no closures).
- [ ] **Step 3:** `npm run bench`: sim tick at 2,000 pieces / 20 trains (+20 depots) stays under 2 ms.
- [ ] **Step 4:** Commit `feat(economy): depots load and unload trains on their own`.

### Task 6: Turnback buffer and the loop scenario

**Files:**
- Modify: `src/track/pieces.ts` (`"buffer-turnback"`: the buffer's geometry; in the tray after "Buffer"),
  `src/sim/sim.ts` (on `ADV_BUFFER` at a turnback piece: wait 240 ticks, then flip every engine's lever),
  `src/render/track-view.ts` (striped flag on the buffer block)
- Test: `src/sim/turnback.test.ts`, `src/economy/scenario.test.ts`

- [ ] **Step 1:** Failing tests: a train stops at a turnback buffer, waits 2 s, drives back; ordinary buffers
  unchanged. Scenario: a fixed loop through forest → sawmill → town with one timber train runs 10 simulated minutes
  and delivers an exact number of bundles; a second run delivers the same number.
- [ ] **Step 2:** Implement; record the delivered count in the test as a constant.
- [ ] **Step 3:** Commit `feat: turnback buffer; a timber loop runs itself`.

### Task 7: Depot buildings, piles and cranes

**Files:**
- Create: `src/render/depot-view.ts` (moving parts and cargo, per frame), `src/render/dressing/depots.ts`
  (static buildings, batched)
- Modify: `src/render/landscape-view.ts`, `src/render/dressing/buildings.ts` (station goods gantry and plank pile),
  `src/game/game.ts` (economy snapshot → view)
- Test: `src/render/depot-view.test.ts` (pile layout maths: unit positions for 0–12 units never overlap and stay
  inside the yard)

**Design (§9.1 toy style):**
- Forest yard: open log stack, a jib crane with a magnet head on a beech mast, a small hut, trees planted around.
- Sawmill: long open-sided shed over the track (drive-through), round saw blade that spins only while working, log
  pile one side, plank pile the other, an overhead gantry crane.
- Town station: a small goods gantry at the platform end and a plank pile beside it.
- Cargo: one instanced mesh per cargo kind for every pile and wagon (two draw calls in total). Crane swing and lift
  follow the snapshot's crane phase, interpolated like train motion.

- [ ] **Step 1:** Failing pile-layout tests; implement.
- [ ] **Step 2:** Screenshots desktop + 390 × 844: each depot idle and mid-load; frame time ≤ 10% over the previous
  commit on both quality tiers, whole-map view with 5 timber trains.
- [ ] **Step 3:** Commit `feat(render): forest yard, sawmill and goods gantry with working cranes and visible cargo`.

### Task 8: Hands-on play

**Files:**
- Modify: `src/game/interaction.ts` (drag a cargo unit: from a pile or wagon, float above the finger, drop on a
  wagon or pile that takes it; elsewhere it floats back), `src/ui/hud.ts` (depot card: pile icons, Automatic and
  "Wait for a full load" toggles), `src/render/depot-view.ts` (cargo picking)
- Test: interaction drop-outcome unit tests (pure function like `dropOutcome`)

- [ ] **Step 1:** Failing tests for the cargo drop outcome (allowed / back to origin) using `Economy.moveCargo` rules.
- [ ] **Step 2:** Implement; touch targets ≥ 44 px; works with mouse and touch; tapping a depot building opens the
  card; Automatic off makes trains run through at normal speed.
- [ ] **Step 3:** Commit `feat(ui): move cargo by hand; depot card with automatic and wait-for-full switches`.

### Task 9: Towns, sounds and hints

**Files:**
- Modify: `src/render/landscape-view.ts` (sign shows a plank icon and the delivered count once > 0),
  `src/audio/audio.ts` (wooden clunk per unit, saw whirr while working, chime when planks reach a town),
  `src/main.ts` (after the first two towns are joined: toast "Try a timber train")

- [ ] **Step 1:** Implement; sounds respect the mute toggle.
- [ ] **Step 2:** Commit `feat: delivery counts on town signs, cargo sounds, timber hint`.

### Task 10: Saves

**Files:** Modify `src/persist/save.ts`, `src/persist/save.test.ts`.

- [ ] **Step 1:** Failing tests: round trip of depot piles, timers, auto and waitFull; cargo per car; delivered per
  town; a train halted mid-service resumes service after load; version 5 saves are refused and the starter map
  starts.
- [ ] **Step 2:** `SAVE_VERSION` = 6; schema adds `depots`, `cargo` (by car index within its saved train) and
  `delivered`; depot pieces are validated against `landscape.depots` like stations.
- [ ] **Step 3:** Commit `feat(persist): save version 6 with depots and cargo`.

### Task 11: Whole-branch check

- [ ] `npx tsc --noEmit`, `npx vitest run` (twice), `npm run build`, `npm run bench`.
- [ ] Play the starter map on desktop and a 390 × 844 touch viewport: build the first timber loop, leave it running
  for 5 minutes, confirm piles, cranes and the town count behave; turn a depot to manual and move a log by hand.
- [ ] Fresh-eyes review of the whole branch against the spec and Review Focus; act on findings.
