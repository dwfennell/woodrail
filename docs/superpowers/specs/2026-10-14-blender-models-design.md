# Woodrail — Blender Models Design

**Date:** 2026-10-14
**Status:** Done: all three phases built, and the code-built models removed (§3).

## 1. Goal

Remodel the game's toys in Blender, keeping the wooden-toy style: chunky lacquered shapes, every edge rounded,
natural beech, red wheels, round magnets. Blender gives shapes that are hard to write in code (lathed chimneys and
domes, recessed windows, arched roofs) and fewer draw calls per model.

## 2. Pipeline

- **Source:** Python scripts in `tools/blender/`, run with Blender's `bpy` module (`pip install bpy==5.2.2`, Python
  3.13) or with Blender itself (`blender -b -P <script>`). The scripts are the source of truth. Each also saves a
  `.blend` that lays out its models to look at (built locally, not committed).
- **`toy.py`:** shared shapes (rounded box, lathe, arched roof, rod, coal heap), cuts (`cut` before the rounding,
  `recess` after it with crisp edges for windows), and the bake. The bake applies modifiers, keeps moving parts
  (`wheel_*`, `lamp`) as their own nodes, merges everything else into one mesh per material and sets normals (see
  below).
- **Normals:** each corner's normal is the area-weighted average of the faces round its vertex that turn less than
  50° from its own face. Roundings shade smooth, sharper edges stay crisp, and flat faces stay flat even where cuts
  split them into slivers. Merging uses Blender's join, never bmesh, which would drop custom normals.
- **Export:** `npm run models` builds `tools/blender/out/<set>.glb` for each set (trains, life, buildings,
  dressing), and gltfpack (meshopt) compresses it into `public/models/<set>.glb`.
- **Texture coordinates** aren't shipped (gltfpack drops them, as no material has a texture): the loader makes them,
  a planar projection from each vertex's main direction, one beech-grain repeat per 60 mm. Every mesh gets them, as
  the wood grain, the lacquer's bump and batching all need.
- **Materials by name:** `wood`, `metal`, `coal`, `lamp` and `lacquer #rrggbb`. The game swaps each for its own
  material (`src/render/blender-models.ts`), so a model is lit and painted like everything else. A recolour table
  can swap lacquer colours, as the classic engine's second scheme does.

## 3. In the game

- The game ships only the Blender models; the code-built ones are gone (the catalogue's `life.ts` and
  `buildings.ts` keep each asset's name, notes and animation, and its `build` dresses the model).
- **Loading:** each fetch retries (4 tries, backing off from 0.5 s). At boot the loading screen stays until the trains
  and the map's parts are in; if they can't be had it says so and offers to try again. People, animals and buildings
  load when the catalogue first needs them: the registry fetches the model set before importing the file (a module
  that failed would stay failed), and a failed load is forgotten so the next request retries (registry, prop
  library, props view).
- **Loading screen:** a wooden progress bar (model sets, then track pieces carved), and toys hopping onto stepped
  shelves as their sets arrive: the train, the platform's folk and the street's furniture (boot sets), then a few
  buildings, fetched only after the boot sets so they never hold the game up (they warm the cache for the catalogue).
- **Tests** read the model files from disk (no server), so they build the real models; tests that build cars or towns
  call `loadBlenderModels()` first.
- The catalogue loads the models before it starts and serves `public/` too.
- Copies share geometry (`userData.sharedGeometry`): disposing a car leaves the shared geometry alone.

## 4. Cost (per car)

| | Code-built | Blender |
| --- | --- | --- |
| Draw calls | 22–56 | 7–11 |
| Triangles | 2.8k–5.3k | 5.7k–12.1k |

Detail is kept at the level of the first engine (three-step roundings, 32–40 segments round the larger turned parts,
handrails and handles where a real toy would have them): the user prefers that to a lower triangle count. The shadow
pass draws each mesh again, so the saving in draw calls doubles, and so do the extra triangles. Frame
time is still to be measured on a phone.

## 5. Phases

1. **Trains** (done): five car kinds and their seven extra looks.
2. **People and animals** (done): all 48 of the catalogue's `life` assets, used as props in Sandbox. See §6.
3. **Buildings** (done): the catalogue's 52 buildings, and parts for the map's own towns and stations. See §7.

## 6. People and animals

- **Kit:** `tools/blender/kit.py` mirrors the catalogue's `Kit` (same calls, sizes and y-up coordinates), so each model
  ports from `life.ts` nearly line for line; `life_parts.py` ports its helpers (peg person, arms, hats, carried
  things, four-legged and bird bodies). The models are in `life_people.py`, `life_town.py`, `life_farm.py` and
  `life_wild.py`; `life.py` builds them into `public/models/life.glb` (1.7 MB, 387k triangles for all 48, against
  439k for the code-built ones at full detail).
- **Upgrades over the code:** a turned peg body (foot rim, taper, rounded shoulders), a painted face (eyes and
  cheeks), turned and tapered animal legs, rounded rims everywhere, and a few small details per model.
- **Pivots:** a named node in the kit (an arm, a head, a flag) stays a node of its own, named `<id>|<part>|<n>` (unique in the file); the
  loader keeps the part's name, so the catalogue's `animate` functions work unchanged.
- **Colour variants:** lacquer goes through the kit's `paint`, so towns' hue-shifted variants work. Faces use
  `lacquer fixed #rrggbb`, which keeps its colour.
- **Props:** `life.ts` waits for the model file when its chunk loads, then each asset's `build` returns a dressed copy
  of its model. Props are merged and batched, so the loader decodes this set's vertex data to plain floats.
- **Facets:** turned shapes with fewer than 12 sides are kept as given with crisp facets (the ice floe), as the code
  kit keeps them.

## 7. Buildings

- **Catalogue buildings** (props): `bldg.py` builds the 52 assets of `buildings.ts` from `bldg_stations.py`,
  `bldg_works.py`, `bldg_town.py` and `bldg_houses.py` on `bldg_parts.py` (its helpers, upgraded: framed windows with
  glazing bars, door frames, chimney pots, turned lamp posts, clock marks; peg figures with the life set's body and
  face). `public/models/buildings.glb`: 2.4 MB, 404k triangles for all 52 (code-built at full detail: 453k), loaded
  when the first building is needed. Window and door bars round in one step: there are many, and they're small.
- **Shared part names:** several parts may share a name (every chimney's "smoke"), so pivots are named
  `<id>|<part>|<n>`; smoke puffs are parts of their own, as the catalogue moves each.
- **The map's towns and stations** stay generated by `src/render/dressing/buildings.ts`, which sizes walls and roofs
  to their squares. `dressing.py` models the fixed-size details it places: doors, flower boxes, chimney tops, the
  station's canopy posts, clock, benches and people, the waiting peg dolls, the engine shed's doors and windows, and
  the eight kinds of street furniture. `public/models/dressing.glb` (232 KB) loads at boot with the trains.
  `addPart(b, mats, name, place, slots)` draws one into a town's batch the way the code placed its own geometry (and
  throws if the parts aren't loaded). Colours that vary per copy are slots
  (`lacquer slot door`), filled in per copy.
- **Lean parts:** the parts on every house (door, flower box, chimney top) are built lean (`Kit(lean=True)`: one-step
  roundings, the code's segment counts); a map has hundreds. Windows stay in code: they're already a printed pane
  with glazing bars in a frame.
- **Cost** (seed 4242, the first town from the same camera): station view 331k triangles against 253k with the code
  shapes, town view 348k against 260k; draw calls unchanged (the parts join the towns' existing batches).
