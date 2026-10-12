# Road system — design

Status: **proposed** — options below are waiting on the user's choices. Nothing is built yet.

## 1. Where roads are today

- **Squares, not pieces.** A road is a surface on the map grid: `SURF_ROAD` (town streets, the town squares left over
  after buildings) and `SURF_LANE` (country lanes) in `src/landscape/grid.ts`. Both sit at height 0.
- **Generated.** `generate.ts` lays lanes from a town's platform side and from the plot-edge stubs (`regionStubs`,
  `edgeContract` in `edges.ts`), joined by `joinLanes` / `cheapestPath`. Leftover town squares become `SURF_ROAD`.
  There's no way for the player to add or remove a road.
- **Drawn as felt.** `buildFeltTiles` (`render/dressing/felt.ts`) traces road + lane squares into smoothed felt
  ribbons, per 2×2-plot tile, cached by a hash of each tile's squares (8-square margin). No markings: plain grey.
- **Track and roads.** Town streets block track (`clearance.ts`, `BLOCKED.town`). Lanes don't: ground-level track over
  a lane makes a level crossing (`findCrossings` in `crossings.ts`, barriers in `CrossingsView`), recomputed from the
  whole layout whenever track changes. Track on a bridge or riser (y > 4) crosses over without one.
- **Saves.** Surfaces are saved byte per square (`landscape-data.ts`); any change to road squares already saves and
  loads, with no format change.
- **Catalogue.** Road straight/curve/T-junction/roundabout/zebra/car park, traffic lights, bus stop and a
  road-over-rail bridge exist as models only — no connectors. Their sizes (96 straight, 48 felt on a 56 board, 120
  roundabout) don't fit the 72 mm square or the 18 mm track lattice. Vehicles (cars 58×26, vans 64, buses 88) exist
  as models; nothing drives.
- **Next door.** The land-editing work (branch `claude/bold-bohr-fvqt5w`, `2026-10-12-land-editing-design.md`) adds an
  edit-land mode with Raise/Lower on squares in `src/landscape/edit.ts`, keeps road/lane squares at height 0, and
  defers "painting surfaces (grass → road or river): waits for the road system". The tray is data
  (`src/ui/tray-catalogue.ts`) with a Roads tab planned for this work.

## 2. How the player lays roads

**A. Paint squares (recommended).** A Roads tab with a road brush: tap or drag across grass squares to make them road,
an eraser to turn them back. The square stays the unit, so everything that already reads the grid (felt, crossings,
clearance, saves, generation, land editing's rules) keeps working. Fits the land-editing tools (same stroke, redraw on
release, one undo step per stroke) and its deferred "painting surfaces". The look comes from §3.
Cost: roads only turn at square corners (as lanes already do).

**B. Snap pieces like track.** Road pieces with connectors, placed and snapped like track. Free angles and the
catalogue's look, but it's a second track system: new `PieceDef`s on a road lattice, a road layout, its own save
array, its own overlap and clearance against track, trees, hills and towns, and crossings worked out from two
free-form layouts. Generated lanes and town streets would have to become pieces too, or the map has two kinds of
road. Several times the work of A.

**C. Paint squares, place special pieces.** A, plus a few square-sized "pieces" dropped onto road squares from the
same tab: roundabout (3×3), car park (2×1 or 2×2), zebra crossing and traffic lights (on a road square), bus stop
(beside one). These are props bound to squares (land editing's prop store), not snapping track. A first, C later.

## 3. How roads look

Each road square reads its four neighbours (road or lane) and gets markings on top of the felt: dashed centre line
on straights, a quarter arc on corners, give-way lines at a T, a box at a crossroads, a rounded end at a dead end.
Built per felt tile, keyed by the same hash of the tile's squares, so painting one square rebuilds only the tiles it
touches. One merged mesh per tile, one material (white), no per-frame work.

## 4. Roads and track

**A. Level crossings, and track bridges over roads (recommended).** Player roads are lanes (`SURF_LANE`): track may
cross them and gets barriers, as today. Track on a bridge or riser already passes over without a crossing. Town
streets keep blocking track. Crossings recompute when a road stroke ends, not only when track changes.

**B. Also road-over-rail bridges.** The catalogue's road bridge as a road piece that lifts the road over track.
Roads leave height 0, which the land-editing rules and the felt both assume. Better deferred.

Rule for painting under track: allowed on any square ground-level track crosses, as for generated lanes today; the
crossing finder copes with a road running along the track by grouping touching squares (one crossing per group).

## 5. Roads and towns

**A. Join, don't edit (recommended).** Player roads connect to town streets (markings treat `SURF_ROAD` and
`SURF_LANE` as one network), but town squares can't be painted or erased. Towns stay as the generator (or land
editing's catalogue towns) make them.

**B. Repaint town streets too.** The brush works inside towns. It collides with land editing's §5 (towns rebuilt from
catalogue models, buildings as props owning their squares) and with town furniture placement. Defer.

## 6. Vehicles

**A. Later, but ready (recommended).** Nothing drives in this work. The road squares define a graph (one node per
square, edges to road neighbours, a lane each side of the centre line) that a later step can drive toy cars and buses
along, stopping at lowered barriers. Kept out of this work's code; noted so §3 doesn't paint in a way that stops it.

**B. Ambient traffic now.** A few cars wandering the network, with stopping at crossings. Every-frame work and its own
render-on-change rules (a driving car is an animation that keeps frames coming). Bigger than the rest put together.

## 7. Saves

With 2A no format change: road squares are surface bytes, already saved. `SURF_LANE` is the player's road. If 2C's
placed pieces come, they ride on land editing's optional `props` array (with the square they sit on). Save stays v8.

## 8. Performance

- **Stroke:** pointer moves only mark squares and draw a cheap preview (one instanced quad per painted square); the
  grid, felt, markings and crossings update once, on release. Target: a pointer move under 1 ms on a phone.
- **Release:** `grid.touch` the changed squares; felt and marking tiles rebuild only where their key changed (one
  square can touch up to 4 tiles through the margin). Target: under ~30 ms on a phone for a short stroke. Measure
  the felt rebuild per tile before starting; if it's too slow, shrink the margin for road tiles.
- **Crossings:** recompute once per stroke and per track change, as now (it walks the layout once).
- **Idle:** nothing new runs per frame. Markings are static geometry in the felt tiles.
- Measurements go in each commit message: stroke-release time, tile rebuilds, idle CPU, frame time.

## 9. Steps (for options 2A / 4A / 5A / 6A)

1. **R1 Markings.** Neighbour-aware markings on existing roads and lanes, per felt tile, cached. No gameplay change.
2. **R2 Road brush.** Roads tab (Sandbox), Paint and Erase on grass squares at height 0, stroke preview, undo; pure
   rules in `src/landscape/roads.ts` (next to land editing's `edit.ts`, not inside it). Generated maps unchanged.
3. **R3 Crossings on edit.** Recompute crossings and redraw on stroke release; clearance unchanged (lanes are open).
4. **R4 Road pieces (2C).** Zebra, traffic lights, bus stop, car park, roundabout as square-bound props, if chosen.

## 10. Coordination

- `grid.ts`, `generate.ts`, `felt.ts`, `landscape-view.ts`, `landscape-data.ts`: owned by land editing (bold-bohr)
  now. Changes here kept small: a hook for marking tiles beside `buildFeltTiles`, and a `roadsEdited(cells)` beside
  their `landEdited`.
- Tray: a Roads tab in `tray-catalogue.ts` once bold-bohr's tray is on main.

## Deferred

- Road-over-rail bridges and raised roads (roads stay at height 0).
- Painting inside towns; town streets stay generated.
- Vehicles driving on roads; a road graph for them.
- Snapping road pieces (2B), unless chosen.
- Roads on slopes.
- Painting rivers (the same brush could, later).
