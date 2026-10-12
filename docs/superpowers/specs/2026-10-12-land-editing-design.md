# Woodrail — Land Editing Design

**Date:** 2026-10-12
**Status:** L1 (select first), L2 (Land tab, grass blocks by tapping) and L3 (Move tool: trees, fields, the shed) built. This session does all of it (the user's call); the map expansion session is not reviewing.
**Part of:** the Sandbox assets epic (see `2026-10-12-sandbox-assets-design.md`)

## 1. Goal

In Sandbox, the map itself becomes something you can change:

1. **Edit the scenery:** move or remove the map's trees, rocks, fields, the engine shed, and town buildings.
2. **Grass blocks:** raise or lower the map's squares a block at a time, so track can run on top, ramps can cut in,
   and trains can climb.
3. **Catalogue towns:** towns are built from catalogue models, placed as props by the generator, so they match the new
   models and are edited with the same tools.

Getting around must stay as easy as it is now.

## 2. Handling: select first, for props and scenery (built: L1)

A press and drag on a prop or scenery that isn't selected pans the view, like the floor. A tap selects it: an outline
and a card appear. Dragging a selected thing moves it at once.

- Something just placed or moved stays selected, so you can nudge it again.
- Track and trains keep direct dragging, guarded by the existing reach rule.

Why: towns built from props make towns dense with things to grab. With direct dragging, panning over a town on a phone
would move houses by accident.

## 3. Edit-land mode

A **Land** tab in Sandbox's tray. Opening it switches the edit-land mode on, and leaving it switches it off.
`setExpanding` (Add land) is the pattern to follow: a mode flag in `main.ts`, the floor tap handler, and a card.

**Tools** on the Land tab:

- **Move** (the default): the map's scenery can be selected (tap), then dragged or removed (card: Turn, Delete). Trees,
  rocks, fields, the shed and buildings; towns once they're props (§5).
- **Raise** and **Lower:** tap a square to raise or lower it a block. With a mouse, the square under the pointer is
  outlined. A drag still pans, so getting around in the Land tab is as easy as anywhere else. Painting a stroke by
  dragging is deferred (§9): it needs a gesture that doesn't clash with panning.

Outside the mode, the map's scenery can't be picked: presses on it pan, as now.

**Picking scenery:** there's no mesh picking for scenery. The pointer's square is found from the ground (`planeAt` at
the hill's height, then `grid.cellAtWorld`), then its `feature` and `owner` say what's there.

## 4. Grass blocks (heights)

A pure module, `src/landscape/edit.ts`, tested in Node.

**Rules:** a square can change height only if:

- it's open grass: not river, road, lane, town, station, depot or corridor square (these stay at height 0);
- its height stays within `0..MAX_HEIGHT` (3);
- it stays within one block of its four neighbours (`settleHeights`' rule). A stroke raises in order, so painting a
  hill works;
- nothing stands on it or its four neighbours (corners round off and cuttings reach into them): no track (track points
  near the squares), no props, and no field or shed squares;
- every station and depot can still reach the others and the land's edge (`reachable()`).

A refused square says why, as track does.

**Applying an edit:**

- `grid.height` is changed and `grid.touch(slot)` called for the plots touched.
- In `Game`, `editLand(slots)`:
  - sets `hillsFor = null`;
  - calls `landscapeView.landEdited(slots)`, a new public method modelled on `addPlots`: `buildPlot` + `buildTile` for
    the plots touched and their neighbours, then `cuts.plotsRebuilt`, `buildTrees` and `syncTrees`;
  - calls `trackChanged()`, which re-runs cuttings, tree clearance, hill physics and crossings.
- Measured: 38–79 ms per tap (software GL, one plot and its tile). The map expansion session had expected 150–350 ms
  per plot.

**Undo:** each tap or stroke is one undo step, holding each square's height before and after (land edits go through
the Editor, like props).

**Saves:** heights are already saved square by square, so there's no format change.

**Edges:** land for sale beside an edited plot was generated from the seed. Its preview is regenerated, by dropping the
neighbours' `aroundParts`. A plot bought later can sit two blocks off an edited edge square. Accept that (a sheer step,
like a cliff), or refuse edits on the outermost ring of squares. Proposed: accept.

## 5. Catalogue towns

Town buildings become props placed by the generator, with a `town` id. Each `towns[].buildings` record (`cells`,
`floors`, `kind`, `roof`) is turned into a catalogue model that fits its squares:

- houses become cottages, cottage rows, apartment blocks (by floors) and shops;
- the specials (bakery, café, post office, church, school) become their catalogue namesakes;
- each model is turned to face its street (as today, from the cells relative to `town.centre`).

The models must fit a building's squares: one square is 72 mm, a cottage row about 90 × 52. The plan:

- **Table:** a fit table per catalogue building (squares wide × deep), used by generation.
- **Missing sizes:** where none fits, add a few town models sized to 1×1 and 1×2 squares to the catalogue (a narrow
  house, a corner shop).
- **Variety:** catalogue models have fixed colours, so a town of repeats would look samey. Give town buildings a few
  colour variants (walls and roof, from the town's own palette) through per-instance colour. BatchedMesh supports
  `setColorAt`.

**Data:**

- Building props are stored in the props save, with their town.
- The squares keep `FEAT_BUILDING` (track still can't be laid through a house), owned by the prop.
- Moving or removing a building moves its squares' feature with it.
- `towns[].buildings` stays as the generator's record, or is dropped once props carry it (to be settled with the map
  expansion session).

**Drawing:** town props join the props' BatchedMeshes, culled by tile with `setCullRects` and `cullTiles` (with the
`detail` argument). The land around the world (`aroundScenery`) draws towns as simple houses. It moves to a coarse bake
of the same catalogue models, so the preview and the bought land look alike.

**Old saves:** at load, town records without props are turned into props once (§5's mapping), then saved as props.

**Measure first:** a full town as props (draw calls, triangles, frame time on a phone-sized view) against today's
batched towns, before switching over.

## 6. Trees, fields, the shed (Move tool)

- **Trees and rocks:** a tree is a `FEAT_TREE` square. Its look comes from a random stream that runs through the plot in
  order, so removing one tree would change every later tree in the plot. Change that to a hash of the square, so each
  tree keeps its look. Moving a tree moves the flag to another open grass square (whole squares). Free placement would
  make trees props, which is deferred: thousands of tree props need the tiled, far-detail tree drawing that props don't
  have yet.
- **Fields and the shed:** moving one keeps its look, since a field's look comes from its id. Fields move by whole
  squares, to 2×2 equal-height clear squares. Removing one needs a free slot in the list: `deserializeLandscape` wants
  ids equal to list positions, so allow empty slots (`null`) in the save. The shed becomes `null` when removed.
- **Town furniture** (lamps, benches): it's placed from the town's road squares, so it stays generated for now.

## 7. Steps

1. **L1, select first:** props become select-first (§2). Small, and the rest builds on it.
2. **L2, edit-land mode and grass blocks:** the Land tab; the Raise and Lower tools; `edit.ts` with tests;
   `landEdited`; undo.
3. **L3, moving scenery:** the Move tool for trees, fields and the shed; tree looks that are stable under edits;
   fields and the shed removable (save change).
4. **L4, catalogue towns:**
   - measure first (§5);
   - the fit table and a few new town models;
   - **more house styles** for the catalogue (the user asked): terraces, a townhouse, a thatched cottage, a timber
     house, a corner shop, a bungalow, a villa, a narrow 1×1 house and so on, in the toy style, sized to town squares;
   - colour variants;
   - generation places town props;
   - old saves converted;
   - the around-land preview updated.
5. **L5, measure and polish:** cost of a stroke and of a town; idle cost; phone layout.

## 8. Ownership

The landscape files (grid, generate, landscape-view, blocks, hill-cuts, trees, tiles, landscape-data, buildings' town
dressing) belong to the map expansion session. **Proposed split** (the user's call):

- this session writes it all;
- the map expansion session reviews the landscape parts of L2–L4 before they reach main.

## 9. Deferred

- Scenery drawn in the hand while it's being moved: today only an outline shows where it will go, and the thing jumps
  there when let go.

- Painting heights by dragging (a stroke): it needs a gesture that doesn't clash with panning, such as hold then
  drag, or two-finger pan only while a tool is on.
- Regenerating the land-for-sale preview beside an edited edge square (its around-land is cached per plot).

- Trees placed freely (tree props).
- Town furniture editing.
- Painting surfaces (grass to road or river): waits for the road system.
- Raising town or station squares.
