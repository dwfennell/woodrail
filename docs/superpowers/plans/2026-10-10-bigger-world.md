# Bigger World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double the buildable mat and replace the bedroom with a toy landscape that fades into haze at the horizon.

**Architecture:** Grid constants grow and the generator scales its town/river counts. A new pure module
`src/landscape/surroundings.ts` generates the decorative ring (blocks, trees, hamlets) from the seed. Rendering
replaces `room.ts` with `stage.ts` (lights, sky dome, felt ground, edge-distance haze installed as a fog shader
chunk) and adds `dressing/surroundings.ts` to draw the ring. The camera director clamps its target to the mat.

**Tech Stack:** TypeScript, Three.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-bigger-world-design.md`

## Global Constraints

- Grid 70 × 52 squares of 64 mm.
- 5–7 towns (starter: 5); 1–3 rivers.
- Save version 3, no back-compat.
- Off-mat message: "That's past the edge of the map".
- ≤10% frame-time regression per tier against `main`.

## Review Focus

- Zooming to the pointer over the outer ring: target must stay on the mat, no jitter at the clamp.
- Following a train near the mat edge: clamp must not fight the follow (train is always on the mat, so target ≤ edge).
- Haze on the mat itself at max zoom-out: mat must stay unhazed (camera-distance term small).
- Map change (new game): the outer ring's instanced meshes and owned materials are disposed with the landscape view.
- Phone portrait whole-mat framing: fits within the raised max distance.

---

### Task 1: Bigger grid and generator

**Files:** Modify `src/landscape/grid.ts`, `src/landscape/generate.ts`, `src/persist/save.ts`,
`src/landscape/clearance.ts`; tests `generate.test.ts`, `grid.test.ts`, `clearance.test.ts`.

- [ ] Update tests first: towns 5–7 (`generate.test.ts`), grid round-trip points inside the new mat, off-mat
  message text, save version 3. Run, watch fail.
- [ ] `COLS = 70`, `ROWS = 52`; `placeTowns` count `starter ? 5 : 5 + floor(random() * 3)`; rivers
  `r < 0.35 ? 1 : r < 0.8 ? 2 : 3`; add 6 names; `SAVE_VERSION = 3`; message text.
- [ ] Run whole suite (200-seed tests, sign test), fix fallout. Commit.

### Task 2: Surroundings generator

**Files:** Create `src/landscape/surroundings.ts`, `src/landscape/surroundings.test.ts`; export from
`src/landscape/index.ts`.

**Produces:**
```ts
export const RING_WIDTH = 3000; // mm beyond the mat edge
export interface OuterBlock { x: number; z: number; y: number; size: number; height: number; top: boolean; tone: number }
export interface OuterTree { x: number; z: number; y: number; scale: number }
export interface OuterHouse { cx: number; cz: number; w: number; d: number; floors: 1 | 2; roof: number; facing: { x: number; z: number } }
export interface Surroundings { blocks: OuterBlock[]; trees: OuterTree[]; houses: OuterHouse[]; slabs: Slab[] }
export function generateSurroundings(seed: number): Surroundings
export function outsideDistance(x: number, z: number): number // distance outside the mat rectangle, 0 inside
```

- [ ] Tests: deterministic per seed; every block/tree/house footprint has `outsideDistance ≥ 2 * CELL`; nothing
  beyond `RING_WIDTH + 2 * CELL`; mean top height in the far band > near band; buried blocks excluded (each block
  is a top or has a lower neighbour column); 3–4 hamlets; houses don't overlap blocks or each other.
- [ ] Implement: near band = cells of 64 mm (heights 0–3 by noise, ramped outward); far band = cells of 128 mm with
  128 mm-tall blocks (heights 0–6). Houses on flat clearings; trees by noise on flat or top cells. `slabs` = near-band
  merged rectangles for the shadow proxy.
- [ ] Commit.

### Task 3: Stage, sky, haze and ground (bedroom removed)

**Files:** Create `src/render/stage.ts`, `src/render/haze.ts` (+ `haze.test.ts`); delete `src/render/room.ts`;
modify `src/game/game.ts`, `src/render/materials.ts` (drop floor/wall/skirting), `src/render/dressing/felt.ts`
(ground sheet instead of slab), `src/render/textures.ts` (drop unused floor/wall textures).

- [ ] `haze.test.ts`: `installHaze()` rewrites `ShaderChunk.fog_vertex` to use the mat half extents and is
  idempotent; `HAZE_NEAR < HAZE_FAR`.
- [ ] Stage: same sun/hemisphere/env; sky dome (vertex-coloured `MeshBasicMaterial`, `fog: false`, follows camera);
  `scene.fog = new Fog(HAZE_COLOR, HAZE_NEAR, HAZE_FAR)`.
- [ ] Felt: a 60 m ground sheet with top at y = 0 replaces the slab; hem stays.
- [ ] Commit.

### Task 4: Draw the surroundings

**Files:** Create `src/render/dressing/surroundings.ts`; modify `src/render/landscape-view.ts`,
`src/render/dressing/trees.ts` (accept outer trees), `src/render/dressing/buildings.ts` (export `building`),
`src/render/dressing/blocks.ts` (proxy slabs param).

- [ ] Near blocks: rounded instanced; far blocks: plain boxes instanced; grass tops; trees via `buildTrees`;
  houses into the shared `Batcher`. No shadow casting except proxy slabs.
- [ ] Commit.

### Task 5: Camera

**Files:** `src/game/camera-director.ts` (+ test), `src/game/game.ts`, `src/render/shadow-fit.ts` (+ test).

- [ ] Tests: `clampTarget` keeps target in the mat rect and shifts position by the same amount; shadow radius cap
  3200.
- [ ] Implement; `maxDistance` 12000. Commit.

### Task 6: Performance and visual check, final review

- [ ] Screenshots desktop and 390×844; perf both tiers vs `main`; tune; whole-branch review; fix pass.
