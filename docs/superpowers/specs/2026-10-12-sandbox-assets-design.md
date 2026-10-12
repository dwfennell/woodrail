# Woodrail — Sandbox Assets Design

**Date:** 2026-10-12
**Status:** Building (epic: more to build with in Sandbox)

## 1. Goal

Bring most of the catalogue (`src/catalogue/assets`, ~300 models) into Sandbox, so players can furnish their
railway with buildings, people, animals, vehicles, trees, machines and bridges. Three things change:

1. **Tray hierarchy:** tabs for each kind of thing, each holding shelves, each holding items.
2. **Props:** a new kind of placed object, decorative for now, saved with the railway.
3. **Lazy loading:** a model's code, picture and mesh cost nothing until someone opens its tab or places it.

Later in this epic:

- the catalogue's trains as runnable cars;
- a better road system (the catalogue's road pieces wait for it);
- editing the map itself (blocks, trees, fields).

The design leaves room for all three.

## 2. Tray

**Tabs**, left to right. A tab bar wider than the screen scrolls sideways on a phone.

| Tab | Shelves | Modes |
| --- | --- | --- |
| Track | Straight, Curve, Switch, Ups & downs (ramps, riser), Ends, Adapters | both |
| Trains | Trains, Engines, Wagons, Coaches | both |
| Bridges | Track bridges (bridge, curved bridge), Bridges, Tunnels | both (props: Sandbox) |
| Buildings | Railway, Houses & shops, Town, Farm & industry | Sandbox |
| Nature | Trees, Plants & flowers, Rocks & water, Farm | Sandbox |
| Town | Street, Park, Fences & walls | Sandbox |
| Vehicles | Road, Work, Water, Air | Sandbox |
| People & animals | People, Farm animals, Wild animals | Sandbox |
| Machines | Cranes & loaders, Signals & crossings, Railway kit | Sandbox |
| *(later)* Roads, Land | | |

- **Data:** the tray is data (`src/ui/tray-catalogue.ts`).
  - `TrayTab { id, label, modes, shelves }`.
  - A prop tab's shelves load asynchronously (see §4).
  - `TrayItem` gains `{ kind: "prop"; asset: string; label }`.
- **Shelves:** which shelf each catalogue asset sits on is a table (`src/catalogue/shelves.ts`). An asset not in the
  table isn't in the game yet: roads (waiting for the road system), the catalogue's own track ideas (they need
  mechanics), trains (a later step), and a few that don't stand on a floor (clouds, rainbow, sun and moon).
- **Game mode:** shows only Track, Trains and the track bridges. Props are Sandbox's for now.

## 3. Props

**A prop** is one placed catalogue model: `{ id, asset, x, z, heading, y }`.

- `y` is the ground under it when placed: `hillsOf(grid).groundAt`, so a prop stands on a hill block.
- Props are decorative: no mechanics yet.

**Where a prop may stand:**

- on owned land (`grid.cellAtWorld ≠ −1`);
- not on a river, except boats, which go only on a river;
- not on a town building, station or depot square;
- not over track, and not over another prop;
- fields, grass, roads and town lanes are fine.

**Footprint:** the model's bounding rectangle, measured once when the model is first built, turned with the prop.

**Track and props:**

- Track can't be laid through a prop: "Something's in the way". This adds a `prop` block reason, as buildings
  already have.
- Props don't hop aside like trees. Making them would be a later nicety.

**Handling** works like a track piece:

- drag one out of the tray;
- tap to select it (highlight, plus a card with **Turn** and **Delete**);
- drag it to move it;
- drop it on the tray to put it away.

Turns are eighths, as for pieces. Edits go through the Editor's undo stack. A prop-only edit doesn't trigger the
track's work (`sim.trackChanged`, cuttings, connections).

**Saved** as an optional `props` array in the save. It's optional so that current v8 saves still load.

## 4. Lazy loading and drawing cost

**Code:** each catalogue file becomes its own chunk, loaded with `import()` the first time a tab that needs it opens.
Opening the tab shows its shelves once the chunk arrives, which is a few tens of ms. A saved railway with props
loads the chunks those props need at boot.

**Pictures:** a shelf's tray pictures are drawn when the shelf first opens, a few per frame so the tray stays
responsive. They're cached in IndexedDB with the build id, like today's pictures.

**Models:** `PropLibrary.template(asset)` builds a model the first time it's needed (held, placed, or loaded) and
**bakes** it:

- every mesh's transform is applied;
- meshes are merged by material, with all lacquer colours folded into one vertex-coloured paint material (as
  `Batcher` does).

A typical model comes out as 2–5 meshes. The template, its footprint and its height are cached per asset.

**Drawing:**

- **Static props** are drawn by `PropsView` with one `InstancedMesh` per (asset, material). Adding, moving or
  removing a prop rewrites one instance matrix: no rebuild.
- **Draw calls** grow with the number of different models placed, not with the number of copies.
- **Culling:** props join `cullTiles` by tile, as depots do.
- **Redrawing:**
  - shadows redraw only when a prop changes (`invalidate`);
  - the held prop is a separate live mesh (`moveShadows` while it moves);
  - nothing runs per frame when nothing changes.
- **Animation:** the catalogue's animations (cranes, windmills) are off for now. They would need a frame every frame.
  A later "poke" (tap and it runs for a few seconds) can swap one instance for a live copy while it plays.

## 5. Steps

1. **P1, tray:** the tray as data, the tab bar, the Bridges tab, tabs filtered by mode. No props yet.
2. **P2, props core:**
   - prop store in the world, and saves;
   - `PropLibrary` (build, bake, footprint);
   - `PropsView` (instancing);
   - placement rules: pure functions, with tests.
3. **P3, handling:** placing from the tray, select / move / turn / delete, undo, track blocked by props.
4. **P4, the rest of the catalogue:**
   - chunks per catalogue file;
   - the shelf table for all assets;
   - pictures drawn on demand and cached.
5. **P5, measure and polish:** draws and frame time with 100+ props, load time with and without props, phone layout.

Later in the epic: catalogue trains as cars (cars of their own length), roads, map editing.

## 6. Coordination

`src/game/world.ts` and `src/persist/landscape-data.ts` belong to the map expansion work. Props add one field to
`World` and one optional array to the save, kept apart from the landscape data. Tell that session before merging.
