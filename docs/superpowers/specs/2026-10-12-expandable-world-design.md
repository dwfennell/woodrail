# Woodrail — Expandable World: Plots and a Saved Landscape Design

**Date:** 2026-10-12
**Status:** Implemented (user approved plot size, free expansion and a saved landscape in chat, 2026-10-12). See §11 for where the build differs from the plan.
**Builds on:** `2026-10-10-bigger-world-design.md`, `2026-10-11-grid-72-design.md`, `2026-10-12-hill-shapes-design.md`

## 1. Goal

Today's mat has a fixed size: 62 × 46 squares (4464 × 3312 mm), and the size is set by constants that about 15 modules
import. Let the player grow the world, like buying land tiles in Cities: Skylines. The world is made of **plots**, and
the player unlocks any plot next to land they already own. Expansion is free for now, because there is no money yet.

The same change also stops saves from regenerating the landscape from its seed. Saves store the landscape itself, so
scenery editing (planned soon) only has to change the stored squares, without inventing a new save format.

### Success criteria

- A new game looks and plays like today: it starts with 2 × 2 plots, which is exactly today's mat.
- Unlocking a plot adds land whose rivers, roads, lanes and hills meet the land next to it with no seams.
- Unlocking rebuilds only the new plot and the squares along its borders, never the whole world. On a phone, the
  rebuild finishes in under 100 ms. The plot's generation may run ahead of time, while it is shown for sale.
- When nothing is happening, CPU use is the same as on `main`, and frame time with 2 × 2 plots matches `main`.
- A save holds the landscape squares and scenery objects. Loading a save never runs the generator.
- The seed is used only to generate plots not yet unlocked.

### Out of scope

Scenery editing itself, money or costs for expansion, lower detail for distant plots, selling plots back, and save
migration (version 7 saves stop loading; before v1 this is accepted, as with earlier save version bumps).

## 2. Plots

- A plot is **31 × 23 squares** (2232 × 1656 mm), a quarter of today's mat. Plot `(px, pz)` covers world
  `x ∈ [px·2232, (px+1)·2232)` and `z ∈ [pz·1656, (pz+1)·1656)`.
- A new game owns plots `px, pz ∈ {-1, 0}`. That is today's mat, still centred on the world origin, so existing
  world positions (such as the starter towns at x = ±540) don't move.
- Columns and rows become **global**: square `(col, row)` lies at `x = col·72`, so `col = floor(x / 72)`. Columns and
  rows can be negative. A square's plot is `(floor(col/31), floor(row/23))`.
- Plots the player can unlock are the ones that share an edge with an owned plot. A plot that only touches at a corner
  can't be unlocked.

## 3. The grid by plot

`LandscapeGrid` becomes a sparse map from a plot key to that plot's arrays: `height`, `surface` and `feature`
(`Uint8Array`), plus `owner`, widened to `Int32Array` because ids now grow across the whole world. Each array holds
31 × 23 = 713 entries.

- **Square ids.** Code that keeps `number[]` lists of squares (town cells, corridors, field cells, shed cells) keeps
  them, but the number is now a global square id: `cellId(col, row)` packs both coordinates into one integer (an
  offset of 2¹⁵ on each, so the id stays an exact integer in a double). `index()`, `colAt`/`rowAt`, `centreX`/`centreZ`
  and `cellAtWorld` keep their meaning. `cellAtWorld` returns -1 for a point outside owned land, so placement still
  reports "off-mat".
- **Reading squares.** Direct reads such as `g.height[i]` become `g.heightAt(i)`, `g.surfaceAt(i)` and so on, and
  writes become setters. A read finds the plot, then the entry. The grid caches the last plot it looked up, so loops
  over neighbouring squares stay about as fast as indexing an array. Benchmark the placement check and the hill-shape
  queries before and after this change.
- **Squares outside owned land** read as grass at height 0 with no feature. The one exception is the hill-shape rule
  that treats off-mat squares as solid when rounding corners: it now asks "is this square in an owned plot?", so a hill
  at the edge of owned land looks the same as a hill at today's mat edge.
- **Change signals.** Each plot keeps a `version` that goes up whenever one of its squares changes. Views cache their
  meshes per plot, keyed by that version (and by the versions of neighbouring plots wherever they look across a
  border). Unlocking uses this now, and scenery editing will use it later.
- `COLS`, `ROWS`, `MAT_WIDTH` and `MAT_DEPTH` stop being exported. Code that needs the extent of the land reads
  `world.bounds()` (the bounding box of owned plots) or iterates `grid.plots()`.

## 4. Generating plots

Generation works on any rectangle of plots, given a fixed **edge contract** on each of the rectangle's outer edges. A
new game generates its 2 × 2 start as one rectangle, so towns, rivers and the starter pair can lie across the inner
borders, as they do today. Each expansion generates a single plot.

### Edge contracts

The contract for the edge between two plots depends only on the seed and that edge's coordinates. It is computed from a
hash of them, so the plots on either side agree on it, whichever is generated first. A contract lists what crosses the
edge, square by square along it:

- **Rivers:** where a river crosses, and how wide it is. About one in four edges has a river.
- **Roads and lanes:** where each one crosses.
- **Hills:** a height for each square along the edge, drawn from the same low-frequency noise that places hills, so
  hills run on across borders instead of stopping at a line.

The generator for a rectangle must meet every contract on its outer edges:

- **Rivers:** each river enters at one contract point and leaves at another, or ends in a pond if only one point
  exists. This replaces the edge-to-edge random walk.
- **Lanes:** each lane runs from its contract point to the nearest town or road inside the rectangle, or across to
  another contract point.
- **Hill heights** at the rectangle's border squares are fixed to the contract, and the inside is filled as it is today.

### What goes in a plot

The amount of scenery per area stays as it is today: a plot holds 0 or 1 town (with the same spacing rules, measured
against towns in neighbouring plots that are owned or already generated), depots in proportion to its area, paddocks
and trees. Ids for towns, buildings, depots and fields come from world-wide counters (`nextIds`, stored in the save).
`EDGE_MARGIN` applies only at the edges of the whole world, so a town can sit next to a border between plots.

### For-sale plots

A plot next to owned land is generated when it first becomes for sale, at idle time, one plot per idle slice. The
result is cached in memory but not saved. When the player unlocks it, that cached result becomes the plot's saved data,
so they get exactly the plot they saw. Because generation is deterministic, regenerating a for-sale plot after a reload
gives the same result. If generation rules change between versions, a for-sale plot may change, but owned land never
does.

## 5. Saving: the landscape is data (version 8)

```
landscape: {
  seed, nextIds,
  plots: [{ px, pz, height, surface, feature, owner }],   // arrays as base64
  towns, depots, fields, shed, corridors                  // full objects, as Landscape holds them
}
```

- One plot is about 5 kB of arrays, or about 7 kB in base64, plus its objects. 100 plots come to under 1 MB, which is
  well within localStorage. The zipped binary format in the core-sandbox spec stays future work.
- Loading checks the arrays' lengths, the value ranges and that ids point at objects that exist. It also keeps today's
  check that each town's station piece and each depot piece is where the landscape says. It never calls the generator.
- `SAVE_VERSION` 7 → 8. Versions 6 and 7 no longer load, and the `BRIDGE_FEET_VERSION` migration goes away.
- The economy gains `addTown`/`addDepot`, so unlocking a plot can add its towns and depots while a game is running.
  The station and depot pieces that the generator places are added to the layout the same way as in a new game.

## 6. Views and physics, per plot

| Part | Today | Per plot |
|---|---|---|
| Felt ground | one plane: the mat plus `GROUND_REACH` | one felt tile per owned plot, plus the ground beyond, sized to the world's bounds |
| Hem and stitching | the mat's rectangle | traced around the outline of the owned plots |
| River, road and lane ribbons | traced over the whole grid | traced per plot, reading neighbours across the border so curves meet |
| Blocks and slabs | instanced over the whole grid | instanced per plot, with slabs merged within a plot |
| Hill core and shadow mesh | the whole grid | per plot (`HillCutsView` keeps its per-block cut cache) |
| Trees, buildings, fields | the whole grid | per plot |
| Hill colliders | `hillPieces(grid)` over the whole grid | per plot, added and removed as a group |
| Rapier floor | 50 m half-extent | 1 km half-extent (still a single cuboid) |
| `hillsOf(grid)` | cached for the whole grid | cached per plot, keyed by the plot's version and its neighbours' versions |

When a plot is unlocked, its views and colliders are built. Each of its four neighbours rebuilds only if the contents
of its border squares change, which they can: rounded hill corners and ribbon ends look across the border. Nothing
else is touched.

### Surroundings and for-sale plots

- **For-sale plots** are drawn from their cached generation, using the views owned plots use but greyed and hazed,
  with no trees or buildings. Each shows a "+" marker in its middle. The player can see the river they would get
  before choosing. To keep phones cheap, a for-sale plot is one merged mesh with one draw call.
- **The far backdrop** (the outer ring in `surroundings.ts`) is laid around the bounding box of owned and for-sale
  plots, and rebuilt when that box grows. This happens rarely.
- **Haze** gets the world's half-extents as a uniform. They are no longer written into the shader as constants.

### Camera and shadows

- The camera target is clamped to the bounding box of owned plots, plus one plot's margin so the for-sale plots can be
  reached. `frameLayout` frames owned land, and `maxDistance` grows with the size of the world, capped at about
  twice the distance used today.
- Shadows already fit to the view, so they don't change.

## 7. Expanding

- An **Expand** button in the toolbar enters expand mode. The for-sale plots light up and show their "+".
- Tapping a for-sale plot (its square, or its "+") shows a short confirm. Confirming unlocks the plot, the camera
  frames it, and the game autosaves.
- Expansion is free and has no limit on the number of plots. Section 8 records how frame time grows as plots are added.
- Leaving expand mode hides the for-sale plots and leaves only the far backdrop.

## 8. Performance

- With nothing happening, the cost must not change. For-sale plots are generated only in idle slices, and only while
  plots are waiting to be generated.
- An unlock rebuilds only the new plot, its neighbours' border squares and the far backdrop. Generation is excluded,
  because it has already run while the plot was for sale.
- Measure and record in the commits:
  - idle CPU with 2 × 2 plots, against `main`
  - frame time with 4, 16 and 36 plots
  - the time to unlock a plot, with and without its generation cached
  - the placement check while dragging, before and after the change to square access in §3

## 9. Testing

- **Grid:** global squares round-trip through `cellId`, `colAt`/`rowAt` and `centreX`/`centreZ`, including negative
  columns and rows. `cellAtWorld` returns -1 off owned land. Plot versions go up when a square changes.
- **Edge contracts:** for 200 seeds, both plots on an edge get the same contract. Generating plots in different orders
  gives the same squares.
- **Seams:** on 200 seeds, unlocking a ring of plots around the start leaves no break in a river, road or lane at any
  border, and no height steps at borders other than those in the contracts.
- **Start:** the 2 × 2 start keeps today's guarantees: station headings, station centres on squares, ends on square
  edges, reachability and the starter pair.
- **Save:** a save round-trips to the same squares and objects. A save from an expanded world loads without running
  the generator (checked with a spy). Bad arrays, unknown ids and missing station pieces are rejected with an error,
  not an exception.
- **Views:** unlocking one plot rebuilds only that plot and neighbours whose border changed (count the builds). Hill
  shape agrees across a border: rounding, supports and colliders match, as the hill-shapes tests check today.
- **Screenshots:** the start compared with `main`, a 3 × 3 world, expand mode with plots for sale, and a river and a
  hill crossing a border.

## 10. Order of work

1. **Grid by plot, with global coordinates.** The start is fixed at 2 × 2 and generated as today, written into plots.
   Nothing changes on screen. Update the 13 test files that pin the size.
2. **Saved landscape (version 8).** Saves store squares and objects, loading stops calling the generator, and the
   economy can add towns and depots.
3. **Generation for a rectangle of plots with edge contracts.** The 2 × 2 start uses it, and so do single plots.
4. **Views and colliders per plot,** with version-keyed caches. The camera, haze and far backdrop follow the world's
   bounds.
5. **Expanding:** for-sale plots, expand mode, unlocking.
6. **Performance pass** and the measurements in §8.

## 11. As built

Where the implementation differs from the plan above, or settles what the plan left open:

- **The land around is always shown, not just in expand mode.** Every plot within one plot of the land (diagonals
  too, and any gap inside the land's bounding box) is drawn as its real terrain. It replaces the old ring of scenery
  next to the mat, and the haze greys it out with distance. The countryside beyond starts outside it. Expand mode
  adds a tint and a + badge to each plot for sale; tapping either one shows what the plot brings ("A town, a river
  and hills.") with an "Add this land" button.
- **Drawing the land around cheaply:** each plot's houses and shadow are built once (between frames) and merged with
  the others into a few draws. Its blocks are bevelled only within 150 mm of the land; further out they're plain
  beech boxes. Scenery trees use simpler crowns.
- **Felt** is traced across the land and the land around together, so it meets itself across edges. Each region's
  extruded felt is cached by a hash of its outline, so after an unlock only outlines that changed are extruded again.
- **Generation:** towns, depots and fields keep `STUB_DEPTH + 1` squares from a region's edge, so a crossing's stub
  never cuts into a station's corridor. Rivers and lanes cost more near the edge, and the main river runs through a
  point near the middle, so rivers cross a plot rather than follow its edge. A single plot is 0–2 towns, and a plot
  without a town always gets a depot. Depots keep 750 mm from other sites (towns still keep 900 mm from each other).
- **Physics** still rebuilds all hill colliders together (lazily, as before); its floor is now 1 km across.
- **Opening:** the fly-in is gone. The game opens straight onto the first train, or the first two towns with the
  "Join …" hint.

Measured (headless Chromium with software GL, so these count draws, triangles and CPU time, not phone frame times):

| | main | this |
|---|---|---|
| Opening view | 113 draws, 650k tris | 114 draws, 1.30M tris |
| Idle, 5 s | 0 frames drawn | 0 frames drawn |
| `checkPlacement` (node) | 24.3 µs | 27.8 µs |
| Start region generation (node) | 10 ms | 17 ms |
| One plot's generation (node) | — | 3.8 ms |
| Adding a plot | — | 100–140 ms |

The extra triangles come from the land around being real terrain. They could come down with per-plot culling of
the land around, at the cost of more draws when zoomed out. Adding a plot misses the 100 ms target on this
software renderer; most of what's left is merging the land around again and building the new plot's blocks.

## 12. Rendering cost that doesn't grow with the world

Goal (user, 2026-10-12): rendering costs the same on any size of map. Only the simulation may grow with it.

- **Tiles:** scenery is drawn in tiles of 2 × 2 plots (`render/dressing/tiles.ts`). Each tile has flat cull boxes,
  because three's bounding spheres for flat, wide tiles are nearly always in view. Things that fill an area (a plot's
  blocks, a tile of felt) get boxes covering their whole rectangle (`setCullRects`); scattered things (trees, scenery)
  a box per plot-sized patch of their points. `cullTiles` runs only on frames that are drawn.
- **Reach:** nothing is drawn beyond 2.5× the camera's distance (at least 8 m; it was 1.6× and 5 m, which hazed the top of a phone screen), and everything, the land too, fades
  into the haze before then (the reach is carried in `fogColor.b`). The camera's farthest zoom is fixed at 14 m, so
  only so much of the world can ever be in view.
- **Full detail at every distance** (user, playtest 2026-10-12: "reduce texture not detail"). An earlier version
  swapped tiles for plain far versions (plain blocks, cone trees, box towns, flat felt) by distance from the camera,
  which looked poor zoomed out and switched visibly while panning. Now shapes are always in full; zoomed out, the
  materials drop their fine texture instead (`Materials.setFar`). Blocks and towns are one set of draws per tile;
  trees are per plot within 3 m of the camera (better culled close up), per tile beyond (fewer draws), the same
  trees either way. Hill cores show only within `detailReach` (1.2× the camera's distance, at least 6 m), and
  cranes' moving parts within 8 m.
- **Bug fixed (same playtest):** cull boxes made from a plot's two opposite corners covered only those corners, so
  hills, felt and towns vanished whenever their corners were out of view, at any zoom.
- **Felt:** each tile is traced over a margin of 8 squares, smoothed, then clipped to the tile, so tiles meet exactly
  and a river that runs across the whole world costs no more than a pond.

Measured (software GL, one pass of the scene, 61 plots):

| | far versions (before) | full detail (now) |
|---|---|---|
| 1.2 m | 92 draws, 545k tris | 133 draws, 978k tris |
| 2.6 m | 136 draws, 643k tris | 204 draws, 1.25M tris |
| 6 m | 105 draws, 387k tris | 352 draws, 3.41M tris |
| 14 m (max) | 335 draws, 1.50M tris | 818 draws, 6.50M tris |

Full detail costs more zoomed out, but it is still bounded by the reach, not by the size of the world. Before this, 64 plots at 14 m drew 1088 draws and 2.27M triangles, and that kept growing with the world. Not yet
bounded: the track and trains (they grow with what the player builds), adding a plot (150–350 ms; it rebuilds the
tile's towns and the trees' tile index), and memory, since every owned plot stays in GPU memory.
