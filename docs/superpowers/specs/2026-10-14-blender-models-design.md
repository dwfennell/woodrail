# Woodrail — Blender Models Design

**Date:** 2026-10-14
**Status:** Phase 1 (trains) built. Phases 2 and 3 not started.

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
  (`wheel_*`, `lamp`) as their own nodes, merges everything else into one mesh per material, sets normals (see
  below), and adds planar UVs at the beech grain's scale.
- **Normals:** each corner's normal is the area-weighted average of the faces round its vertex that turn less than
  50° from its own face. Roundings shade smooth, sharper edges stay crisp, and flat faces stay flat even where cuts
  split them into slivers. Merging uses Blender's join, never bmesh, which would drop custom normals.
- **Export:** `npm run models` builds `tools/blender/out/<set>.glb`, and gltfpack (meshopt) compresses it into
  `public/models/<set>.glb`. That's 233 KB for the train set, against 3.2 MB uncompressed.
- **Materials by name:** `wood`, `metal`, `coal`, `lamp` and `lacquer #rrggbb`. The game swaps each for its own
  material (`src/render/blender-models.ts`), so a model is lit and painted like everything else. A recolour table
  can swap lacquer colours, as the classic engine's second scheme does.

## 3. In the game

- `loadBlenderModels()` runs at boot, alongside the track pieces. `buildCarModel` uses the Blender model when it is
  loaded and the code-built one otherwise.
- **Decided (to do once all phases are in):** remove the code-built models and the fallback. The game ships only
  the Blender assets and loads them reliably: retry a failed load, and hold the loading screen until the models are
  in. `?builtin`, the cache split it needs, and the code-built tests go with it.
- `?builtin` in the URL shows the code-built models, for comparison. Tray thumbnails are cached apart for the two.
- The catalogue loads the models before it starts and serves `public/` too.
- Copies share geometry (`userData.sharedGeometry`): disposing a car leaves the shared geometry alone.

## 4. Cost (per car)

| | Code-built | Blender |
| --- | --- | --- |
| Draw calls | 22–56 | 7–11 |
| Triangles | 2.8k–5.3k | 3.8k–7.5k |

The shadow pass draws each mesh again, so the saving in draw calls doubles, and so do the extra triangles. Frame
time is still to be measured on a phone.

## 5. Phases

1. **Trains** (done): five car kinds and their seven extra looks.
2. **People and animals:** the catalogue's `life` assets, used as props in Sandbox.
3. **Buildings:** the catalogue's buildings (props). The map's town buildings and stations are sized to their
   squares and track, so they will need parts (walls, roofs, windows, doors) placed by code, not whole models.
