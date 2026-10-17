# Woodrail — Hill Shapes: Rounded Corners and Ramp Cuttings Design

**Date:** 2026-10-12
**Status:** Implemented (S1–S6)
**Builds on:** `2026-10-10-block-landscape-design.md`, `2026-10-11-grid-72-design.md`

## 1. Goal

Two playtest requests change what a hill *is*, not just how it looks:

1. **Rounded corners.** Felt rivers and roads are drawn with smoothed curves, but hills are hard-edged squares, so a curving river runs between square block corners with strips of grass left over. Round off a hill's outer corners so hills curve the way the felt does, and track can use the space.
2. **Ramp cuttings.** A ramp up onto a hill must end exactly on a block edge, which is unforgiving. Let a ramp run *into* a hill, cutting a sloping channel through the blocks, previewed while the ramp is held.

A first attempt (since backed out: `a730cb5`, `abc9f82`, reverted in `d1cdab5`) showed the risks:

- **Rounded corners** changed ground height on every hill edge. Placement and supports moved to the new shape, but shadows and the physics hills derailed cars land on stayed square.
- **Cuttings** used 3D CSG on each block. Some cut blocks came out with missing faces, so the player saw block-sized dark holes into the hill.

This design makes both rest on **one description of the hills** that everything reads, and builds the cut geometry in a way that can't produce holes.

### Success criteria

- One module answers every question about hill shape. Rendering, placement, supports, bridges' arches, trees, shadows and physics all use it, and tests check they agree.
- Rounded corners and cuttings each look right in screenshots across a fixed set of cases (§7), with no gaps, holes or flicker.
- Every generated block mesh is closed (watertight) and has the expected volume. Tests check this for every case.
- Holding a ramp over a hill previews its cutting with no visible stutter on a phone (target: under 4 ms per update).
- Nothing new is saved: cuttings come from the track layout, and corners come from the map.

### Out of scope

Tunnels (track below a hill's top under blocks that stay), cuttings for anything but ramps, player-edited terrain, slopes other than ramps.

## 2. Today: who reads hill shape

Each of these reads hills directly from the grid (`height` per square), assuming square blocks:

| Reader | Where | What it needs |
|---|---|---|
| Block meshes, painted tops | `render/dressing/blocks.ts` | each block's outline and height |
| Hill core (dark fill behind seams) | `blocks.ts` `hillCore` | the hill's inside |
| Shadow proxy | `blocks.ts` `shadowProxy` (merged slabs) | silhouette from the sun |
| Physics colliders (derailed cars land on hills) | `physics/derail-physics.ts` via `hillSlabs` | solid volume |
| Placement ("a hill is in the way") | `landscape/clearance.ts` | ground height at a point |
| Supports (rest on a block edge, risers to the ground) | `landscape/support.ts` | ground height at a point, near edges |
| Bridges' and raised ramps' arches | `support.ts` `bridgeLevels` | lowest and highest ground under a piece |
| Trees stepping aside | `landscape/trees-aside.ts` | ground height where a tree may stand |

## 3. One hill model (`src/landscape/hill-shape.ts`, pure, Node-testable)

`HillShape` is built from the grid, plus the cuts in force. It is the only thing that knows what is solid.

### 3.1 Block descriptor

For each block (square `col, row`, `level` 0 = on the felt):

- `outline`: the block's plan outline as a polygon. Usually the square. With rounded corners, the square minus the cut-away corner regions (§4), with arcs sampled at a fixed step.
- `y0`, `y1`: bottom and top, `level × 64` and `(level + 1) × 64`.
- `cuts`: the channels passing through it (§5), each a plan strip and a floor height along it.

### 3.2 Queries

- `groundAt(x, z)`: the top of whatever is solid at that plan point: a block's top, a channel floor, or the felt (0). It replaces every `grid.groundY(cell)` in §2.
- `solidAt(x, y, z)`: is this point inside a block, after cuts? This is the ground truth the tests compare meshes against.
- `blocksNear(x, z, r)` and `allBlocks()`: for rendering and colliders.
- `lowestUnder` and `highestUnder` (piece footprint): for bridges' arches. These replace `groundUnder` and `groundOver`.

All readers in §2 move to these queries in one step (§8 S1), with **no visual or behaviour change**. A test then pins down that, without corners or cuts, `HillShape` gives exactly the old answers.

## 4. Rounded corners

- **Rule** (as in the first attempt, which looked right): a block's corner is rounded when the two squares beside that corner and the one across it have no block at that level. In other words, where the hill's edge turns outward. Inner (concave) corners stay square. Corners on the mat's edge stay square.
- **Radius:** half a square (36 mm). This matches the felt's smoothing closely enough in screenshots; it's tunable.
- **Per level:** the rule is checked at each level, so a stepped hill rounds each step separately.
- **Outline:** square minus quarter-circle corners, so it's still convex. Meshes keep the bevelled-hull approach that already renders well.
- **Shadows and physics:** colliders become per-block convex hulls from the same outline, merged per level where blocks are plain squares (to keep the slab count low). The shadow proxy likewise uses the rounded outlines.
- **Core:** the dark core sits a fixed inset inside the *outline*, not the slab, so it never shows at a rounded corner.

## 5. Ramp cuttings

### 5.1 Rules

- Only ramps cut, and only where their bed is under the hill. A ramp up on arches over lower ground cuts nothing; one on arches whose side or top end runs into a higher block (as placement allows, up to its top end) cuts that block like a plain ramp. Other pieces never cut.
- A ramp may run into blocks whose top is no higher than the ramp's top end. A higher hill is still "a hill in the way" (no tunnels).
- **Shape of a cutting** (like a real railway cutting):
  - a **bed** as wide as the track plus 4 mm each side, along the ramp's length, its floor at the ramp's underside, sloping with it;
  - **banks** either side rising from the bed's edges at a fixed angle until they meet the hilltop;
  - the banks get wider where the cutting is deeper, and shrink to nothing where the ramp comes up level with the hilltop.

  The bank angle is a tunable constant (proposed: 60° from horizontal). Set to 90°, banks are sheer walls. At 60°, a full-level-deep cutting (64 mm) spreads about 37 mm each side beyond the bed. At 45°, it spreads 64 mm, almost a whole block.
- **Ends of the cutting:** the bed ends where the ramp ends. Beyond the top end, the hilltop is untouched, so the ramp's top meets the hilltop flush. If the top end stops short of the hilltop's height, the bank wraps round the end too, so there is never a vertical step facing the track.
- Several ramps may cut the same blocks. Where cuttings overlap, the ground is the lower of the two.
- **Other track:** placement checks the ground through `groundAt`. Track can't sit on the bed (the ramp is there), but can run along the hilltop beside a cutting. Track can lie on a bank only if it's on risers or a bridge, as on any lower ground.
- **Trees** in a cutting's footprint step aside as for any track (§ trees). They can't stand on a bank, because it isn't level.

### 5.2 Geometry: blocks with a surface on top (no 3D CSG)

A cutting lowers the ground but never undercuts it. Every vertical line through a block stays solid from the block's base up to some height, then empty. So a cut block is a **column with a shaped top**:

- `top(x, z) = min(block top, cutting surface(x, z))` over the block's outline, where the cutting surface is the bed, then the banks rising from it. If `top` drops to the block's base or below, that part of the block is gone.
- **Mesh:**
  - The top is a fine grid over the outline (about 4 mm), heights from `top(x, z)`, clipped to the outline.
  - The walls run down the outline (sampled at the same step) from the top to the base.
  - The bottom is the flat outline.
  - Watertight by construction. The holes from the first attempt can't happen.
- **Paint:** the green top layer covers the parts of the top still at the block's top. Banks and bed are bare "sawn" wood (natural beech, no paint). Each triangle is coloured by its slope, so the change from green to wood follows the cutting's edge exactly.
- **Core, shadows, physics:**
  - The dark core under a cut block is lowered to stay under `top`.
  - The shadow proxy and colliders use the same columns, at a coarser grid (colliders as a heightfield per cut block, plain boxes elsewhere).

`HillShape.groundAt(x, z)` uses the same `top(x, z)`, so what's drawn and what placement sees can't disagree. Rounded corners only change the outline the grid is clipped to.

### 5.3 Updates and preview

- Cuttings are worked out from the layout, plus a held ramp while one is held. Only blocks whose `top` changes are rebuilt.
- A cut block's mesh is a few hundred triangles, built directly. The target is under 4 ms for a held ramp crossing 4 blocks on a phone; measured in S5. If it's slower, the grid step can be coarser while the ramp is held, then refined on drop.
- Rebuilt blocks replace their instances (hidden in the instanced mesh). Restoring a block restores its instance.

## 6. Placement and supports with the new shape

- **Clearance:** a sample point is "in a hill" when the track's underside there is below `groundAt` (after corners and cuts), unless the piece is a ramp whose cut would remove it (§5.1).
- **Supports:**
  - A track end rests on ground within 10 mm of a block edge, as now, using `groundAt`. So an end can rest on a rounded corner's remaining edge, or on a channel floor at the ramp's top end.
  - Risers stack from `groundAt` under the foot.
- **Bridges' arches** stand on `lowestUnder` the piece, and the deck limit uses `highestUnder`, as now but through `HillShape`.

## 7. Test plan

**Model tests (Node):**

- Without corners or cuts, `HillShape` agrees with the old grid answers at every square centre and at points near every edge.
- Corner rule: every pattern of neighbours around a square (all 256 cases for one level) gives the expected mask.
- `groundAt` against `solidAt`: for random points on a test map, `groundAt` is the top of the solid column.

**Cut cases (each a fixed fixture):**

- a straight ramp into an edge, ending mid-block
- a ramp straddling two rows of blocks
- a ramp crossing three or more blocks
- a diagonal ramp (45°)
- a ramp into a rounded corner
- a ramp from level 1 to level 2
- two ramps cutting the same block
- a cutting with sheer walls (bank angle 90°) and with sloped banks (60°, 45°)
- a ramp whose top end stops short of the hilltop (the bank wraps round the end)
- a ramp into a hill that's too high (refused)

**Mesh tests:** for every generated block, the mesh is closed, its volume matches the model within 0.5%, and raycasts from above at sample points hit exactly where `groundAt` says (to the grid step). Banks never overhang: going outward from the bed, the top never goes down.

**Visual checks:** screenshots from fixed angles of every cut case and of a river bend beside a hill, attached to the PR for each step.

**Performance:**
- Time a held-ramp preview update.
- Measure idle cost (no change expected).
- Measure map build time with rounded corners.

## 8. Steps

Each step is merged on its own, with its tests and screenshots.

- **S1 — `HillShape`, no visible change.** Build the model. Move every reader in §2 to it. Tests prove identical answers.
- **S2 — Rounded corners.** Rule, outlines, rendering, core, shadow proxy, physics colliders. All model and mesh tests pass. Screenshots of river bends.
- **S3 — Cut model and rules.** The cutting surface (bed and banks), `groundAt` with cuts, and placement and supports allowing ramps into hills. No rendering yet: in this step, cut blocks still draw whole.
- **S4 — Cut geometry.** Columns with shaped tops, paint by slope, core, shadow and physics pieces, with mesh tests for every cut case and screenshots.
- **S5 — Hover preview.** Held ramps show their cut, with incremental rebuilds and timing on a phone.
- **S6 — Polish.** Sawn-face material and tone, tuning (corner radius, bed margin, bank angle), and any leftovers from playtesting.

## 9. Questions for review

1. **Corner radius:** half a square (36 mm), as tried? Or smaller, so hills keep more of a block look?
2. **Felt-level hills by rivers:** round these like any other corner? Or only round hills that border a river or road, so inland hills stay blocky?
3. **Cut faces:** natural sawn wood (lighter, no paint), or the block's tone continued? Or green banks (grassed over, like a real cutting) with only the bed bare?
4. **Bank angle:** 60° as proposed (about 37 mm of bank either side of a full-level cutting), steeper for a blockier look, or 45° for gentler, wider banks?
5. **Flat cuttings:** should straights or curves also be allowed to cut a trench at a hill's top level minus one? (Today: ramps only.)
6. **Tunnels:** out of scope here. Worth planning for later, since the model in §3 could support them?

## 10. As built

- **Corners** round only beside river squares (playtest request), radius 36 mm.
- **Cuttings:** 60° banks, bed track width + 4 mm each side. Cut faces are the block's own wood, in each block's own
  tone; uncut parts of a cut block keep its green paint, ending on the cut's exact edge (the grid is split there).
- **Cut block mesh:** a `steps`-square grid stretched over the block's outline (18 steps, about 4 mm), a 1.6 mm bevel
  round the top as whole blocks have, walls down the outline; no bottom when drawn (tests build it closed).
- **Preview:** blocks a held ramp cuts are drawn on a 12-step grid while it moves, and redrawn at 18 when it's put
  down. The map-wide core and shadow are rebuilt only when which blocks are cut changes. Median update 3.2 ms
  (container CPU, software GL).
- **Physics:** cut blocks are trimesh colliders from the same columns.
