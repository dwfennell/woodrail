# Towns in rows: landmarks, the station and the roll-out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish towns in rows: every town building in the new style (landmarks, civic places, the station), inside the phone budgets, with the `?rows` switch gone so it is simply how towns are.

**Architecture:** The landmark and civic models are added to `rows.glb` beside the houses, and reached through the same old-name table (`rowFor`) that already turns a house into its row, so growth, places and saves keep naming today's models. The station's house is drawn in the style in `buildStation`. Then a perf pass to the design's target, and the switch is removed: `rowsOn()` goes, the rows paths become the only paths.

**Tech Stack:** TypeScript, Three.js, Vitest, Blender by script (`~/.venvs/woodrail-bpy/bin/python`), gltfpack, the e2e and perf harnesses.

**Spec:** `docs/superpowers/specs/2026-11-14-town-rows-design.md` (steps 3 and 4 of its Order of work). The first plan, `2026-11-14-town-rows-houses-and-fill.md`, built steps 1 and 2.

## Global Constraints

- Nothing goes to `main` or `itch` until the user says so. Commits per task on `claude/town-rows`.
- One draw call for a town's paint, as now. No new material, no textures (spec §7).
- A town at any level draws no more than 1.3 times the triangles it does today, on the perf harness's late map (spec §7). Baseline, Larkfield levels 0–5: 37172, 53332, 79904, 98896, 126076, 147372.
- Landmarks "keep their footprints and their names" (spec §4): a remodelled landmark fits inside its old model's footprint in `src/props/towns.ts` (`FOOTPRINTS`), so `fitsLot` and `fitScale` answer as they do today.
- Budgets move only with the numbers, in the same commit (`tools/perf/budgets.json`, `memory-budgets.json` by hand).
- The play-through and its bands are unchanged: building counts per level are the same (spec §9).
- Old town models stay in the catalogue (Sandbox props already placed keep them).
- Frames cream `#f6ecd2`, panes dark `#2a3640`, as the row houses (`CREAM`, `PANE` in `tools/blender/bldg_rows.py`).

## Calls made in this plan (the developer may overrule)

1. **Thirteen new models, not twenty-five.** The spec says "about 25". Counting what a town can actually show: church, school, college, library, market hall, town hall, fire station, police station, hospital, clock tower, castle gate (theatre, stadium), lighthouse (sailing club), ice-cream kiosk (funfair). The other places stand in a shop's model today (bank in the post office, cinema in the toy shop, theatre in the café, museum in the library) and take that model's row, which exists.
2. **`scene-*` pieces stay as they are** (bandstand, fountain, playground, bunting, flagpole, lily pond, beach, statue, picnic, clock post, market stall). They are park furniture, not buildings, and read fine beside the rows.
3. **A landmark keeps its own body colour** (a church is stone, a fire station red) and takes only its roof from the town's palette, so landmarks stand out from the rows and still belong to the town.
4. **The station keeps its shape and per-town colours** (`stationTheme`); only its house changes: painted walls and a pitched roof in place of the bare block and flat lid.
5. **An opening gets its tree and bench back** only where no track, road or prop stands on the square (the first plan made openings bare pavement after the review).
6. **Removing the switch rewrites a saved town's house props as rows on load** (the first plan's ruling, now for every player). The map and the buildings are untouched; only which model dresses them.

## Review Focus

1. A save from before rows, loaded after the switch is gone: every town building draws, on its squares, at its saved storeys; the save then writes and loads again.
2. A landmark on a lot smaller than it wants (`fitScale`): the remodelled one is no bigger than the old, so it still fits and never overlaps a neighbour's row.
3. A place built by the player's path (`e2e:civic`: town hall, park, fountain) goes up as the new model and its payoff still counts.
4. A town with a big station (`e2e:big-stations`, `station-upgrade`): the new station house does not stand through the longer platform or the second track.
5. A phone: draw calls, triangles and GPU memory on the late and features maps against the budgets, with rows as the default.

---

### Task 0: Baseline numbers

**Files:** none changed. Output to the ledger.

- [ ] **Step 1:** `npm run build`, then `npm run perf -- --maps late,features` (rows off: today's). Record draw calls, triangles, frame times, heap, bundle size.
- [ ] **Step 2:** `node tools/perf/town-triangles.mjs` and `-- --rows`. Record both rows (expect the figures in Global Constraints and 18022, 22950, 42130, 50092, 65714, 73500).
- [ ] **Step 3:** `npm run perf:memory`. Record.

### Task 1: Landmarks reach their row through the old-name table

**Files:**
- Modify: `src/props/rows.ts`, `src/props/towns.ts`, `src/catalogue/assets/rows.ts`
- Test: `src/props/rows.test.ts`, `src/props/towns.test.ts`

**Interfaces:**
- Produces: `ROW_ASSETS.civic: Record<string, string>` (old id → row id), e.g. `"bldg-church": "row-church"`; `rowFor(old)` answers for these too; `isCivicRow(asset: string): boolean`; `rowVariant` unchanged; `civicVariant(palette: TownPalette, hash: number): number` (roof index only, body 0).
- Consumes: `rowFor`, `townPalette`, `dressInRows`, `townProps` from the first plan.

- [ ] **Step 1: Failing tests.** In `rows.test.ts`: `rowFor("bldg-church") === "row-church"` and the same for each of the thirteen; `rowAssetIds()` has 30 ids; `civicVariant` gives `variant % 8 === 0` and a roof from the palette. In `towns.test.ts`: a town with a market (`landmark: "market"`) dresses it as `row-market-hall` with rows on; `dressInRows` turns a saved `bldg-fire-station` prop into `row-fire-station` and leaves a bank standing in `row-post` alone.
- [ ] **Step 2:** Run them: FAIL (no civic table).
- [ ] **Step 3:** Add the table and `isCivicRow`; in `townProps` map a landmark's and a place's chosen model through `rowFor`; in `dressInRows` replace "skip `building.landmark`" with "map through `rowFor`, keep the building's own choice of model" (the bank stays the post office's row because that is what it was dressed as). Catalogue entries for the thirteen ids in `src/catalogue/assets/rows.ts`.
- [ ] **Step 4:** Tests pass. `npm run typecheck`.
- [ ] **Step 5:** Commit.

### Task 2: The growth landmarks' models (church, school, college, library, market hall)

**Files:**
- Modify: `tools/blender/bldg_rows.py`, `public/models/rows.glb` (built), `src/props/storeys.ts` if a model stacks
- Test: `src/props/rows-models.test.ts`

**Interfaces:**
- Produces: models `row-church`, `row-school`, `row-college`, `row-library`, `row-market-hall` in `rows.glb`, each on its pavement tile, colour slots as the houses (`#ff00a0` body is unused: fixed body colours; `#00ffa0` roof; `#a000ff` door).

- [ ] **Step 1: Failing test.** For each id: it is in `rows.glb`; its bounds sit inside its old model's `FOOTPRINTS` rectangle (plus the 72 mm tile); it has the roof slot colour; triangles ≤ 4,000 (two squares) or ≤ 6,000 (the 2×2 market hall); nothing below y = 0.
- [ ] **Step 2:** Run: FAIL (models missing).
- [ ] **Step 3:** Model them in `bldg_rows.py` with the script's own helpers (`block`, `prism`, `plate`, `tile`): the church with its spire at the street end; the school with a bell gable and a yard on its tile; the college with a clock gable; the library with a columned porch; the market hall open-sided under one long roof. Build: `~/.venvs/woodrail-bpy/bin/python tools/blender/bldg_rows.py`, then the gltfpack step the `models` script in `package.json` runs for `rows.glb`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** `node tools/shots/town-rows.mjs <out> --only=rows --levels=2,3,5`; look at each picture; fix what reads wrong. Commit with the pictures' triangle counts in the message.

### Task 3: The civic models (town hall, fire station, police station, hospital, clock tower)

**Files:** as Task 2. Models `row-town-hall`, `row-fire-station`, `row-police-station`, `row-hospital`, `row-clock-tower`.

- [ ] **Step 1:** The same failing test, for these five (caps: hospital and town hall 6,000; clock tower 1,200).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Model them: the town hall with steps and a cupola; the fire station red with two engine doors; the police station blue-grey with a lamp over its door; the hospital white with a red cross plate; the clock tower a slim tower whose face is where `bldg-station-clock`'s is (its hands are drawn by `ClockView`: check where it reads the face from before moving it).
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** `E2E_ROWS=1 npm run e2e:civic`: ALL PASS (the town hall goes up as `row-town-hall`, the park's smile counts). Commit.

### Task 4: The leisure stand-ins (castle gate, lighthouse, kiosk)

**Files:** as Task 2. Models `row-castle-gate`, `row-lighthouse`, `row-kiosk`.

- [ ] **Step 1:** The same failing test for these three (caps: gate 6,000, lighthouse 2,000, kiosk 1,200).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Model them. Build.
- [ ] **Step 4:** Tests pass; `rows.test.ts`'s "every civic id has a model" passes (30 of 30).
- [ ] **Step 5:** Commit.

### Task 5: The station house in the style

**Files:**
- Modify: `src/render/dressing/buildings.ts` (`buildStation`)
- Test: `src/render/dressing/buildings.test.ts` (or the file that tests `buildStation` today; add one if none)

**Interfaces:**
- Consumes: `stationTheme(town.name)`, `townPalette(seed, townId, level)`.
- Produces: `buildStation(town, mats, b, rows = rowsOn())`: with rows, the house is painted walls (the town palette's first body colour), cream corner trim, and a pitched roof in `theme.roof` whose ridge is at `STATION_ROOF_TOP` (so the sign, the clock at `STATION_CLOCK_AT` and the roof's cull height stay where they are).

- [ ] **Step 1: Failing test.** With rows on, the station's batch has no `blockWood` box of 70 × 46 × 30 (the bare house) and has geometry in the palette's body colour; nothing is higher than `STATION_ROOF_TOP`; with rows off the batch is what it was (vertex count equal to today's).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Test passes. `E2E_ROWS=1` on `e2e:station-touches`, `e2e:station-clock`, `e2e:big-stations`, `e2e:station-upgrade`: ALL PASS.
- [ ] **Step 5:** Pictures of Larkfield's station close, at levels 0 and 5. Commit.

### Task 6: Loose ends from the first plan

**Files:**
- Modify: `src/render/dressing/buildings.ts` (`pavedPlace`), `src/props/rows.ts` (`rowVariant`), `src/props/towns.ts`
- Test: `src/render/dressing/buildings.test.ts`, `src/props/rows.test.ts`, `src/props/towns.test.ts`, `tools/e2e/town-shape.mjs`, `tools/e2e/town-drag.mjs`

- [ ] **Step 1: Failing tests.**
  - An opening with nothing on its square has a tree and a bench; one with a track piece, a road square or a prop on it is the flat slab only.
  - A pair's second body colour differs from the body colour of the slice beside it (`rowVariant` with `besides` holding both colours of a neighbouring pair).
  - A detached slice (no neighbour either side) draws whole: bounds within its square, windows on its side faces.
  - The no-front test's station half always runs (build the fixture so the station lot exists; no early return).
  - e2e, rows on: the square a moved house leaves is grass (`SURF_GRASS`, no tile drawn).
  - An undo that restores a pre-rows house prop, then a growth step: the prop is a row and its building id is unchanged.
- [ ] **Step 2:** Run: each FAILS for its own reason (or passes at once: note which, they were only unchecked).
- [ ] **Step 3:** Implement what fails.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit.

### Task 7: The switch goes

**Files:**
- Modify: `src/props/rows.ts` (remove `rowsOn`), every caller (`src/props/towns.ts`, `src/roads/grow-town.ts` callers in `src/landscape/generate.ts` and `src/game/town-growth.ts`, `src/render/dressing/buildings.ts`), `tools/e2e/town-shape.mjs`, `tools/e2e/town-drag.mjs` (the rows checks become the checks), `tools/shots/town-rows.mjs` (rows only; "now" pictures stay in `docs/agents/shots/` as the record), `tools/perf/town-triangles.mjs`, `scripts/e2e/affected.mjs`, `AGENTS.md` (the "Towns in rows (dev only…)" line rewritten), the spec's §8
- Test: `src/play/balance.test.ts` (unchanged, must pass), `src/persist/*.test.ts`

- [ ] **Step 1: Failing tests.** A fixture save from `main` (a grown town of old house props; make it with the game's own save from a play-through fixture) loads, every town prop is a `row-*` or a `scene-*`, each on its building's squares at its saved storeys, and saving it and loading again gives the same props. A new map's towns have rows with no `?rows`.
- [ ] **Step 2:** Run: FAIL (rows are off by default).
- [ ] **Step 3:** Remove `rowsOn()` and the `rows` parameters that only passed it along; `growTown`'s `rows` option stays (the old fill order is still what a test compares against) but defaults to true at both call sites.
- [ ] **Step 4:** `npm test`: all pass, including the play-through's bands. Any test that pinned an old town's exact layout is updated to the rows layout, each named in the commit message.
- [ ] **Step 5:** `npm run build && npm run wiki:pictures && npm run wiki`: the wiki test passes.
- [ ] **Step 6:** Commit.

### Task 8: Perf pass to the budgets

(After the switch goes: the perf harness runs a build, and the `?rows` switch only exists on the dev server.)

**Files:**
- Modify: `tools/blender/bldg_rows.py` (bevel steps, window corners), `tools/perf/budgets.json`, `tools/perf/memory-budgets.json`

- [ ] **Step 1:** `node tools/perf/town-triangles.mjs`: every level ≤ 1.3 × the baseline in Global Constraints. If one is over, cut the heaviest models first (`rows-models.test.ts` logs each model's count with `ROWS_COUNTS=1`: add that line to the test).
- [ ] **Step 2:** `npm run build`; `npm run perf -- --maps late,features`. Compare with Task 0: draw calls equal or lower; frame times within noise.
- [ ] **Step 3:** `npm run perf:memory -- --suggest`. Find what grew before raising any max (`rows.glb` is one more model file in memory; the old house models are no longer loaded for towns once the switch goes).
- [ ] **Step 4:** Budgets updated only where the numbers say so, with before and after in the commit message. Commit.

### Task 9: The gate

- [ ] **Step 1:** `/check` at the wide tier (rendering, saves and growth all changed): run what it says, report by its format.
- [ ] **Step 2:** `npm run perf:check`: passes against the budgets as Task 8 left them.
- [ ] **Step 3:** `npm run balance:sweep -- --from 0 --to 40`: every seed inside the bands (towns lay out differently now; building counts per level must not).
- [ ] **Step 4:** Final pictures of Larkfield at levels 0–5 into `docs/agents/shots/town-rows-final-*.jpg`. Commit.

Then the whole-branch review, and the developer decides about `main`.
