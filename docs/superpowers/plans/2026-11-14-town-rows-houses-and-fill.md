# Town Rows (houses, shops and fill order) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind a dev-only switch, a town's houses and shops are drawn as joined rows on pavement tiles in a per-town palette, and towns fill rows before they spread, with pictures of Larkfield at every level beside today's.

**Architecture:** New row models come from Blender into their own model set (`rows.glb`) and reach the game through the existing prop pipeline: a town building's prop gets a `row-*` asset, a colour number in `variant`, and storeys stacked by today's `stackOf`. The fill order is a new branch inside `growTown`, chosen by an option, so with the switch off growth is unchanged. Nothing in the save format changes.

**Tech Stack:** TypeScript, Three.js 0.186, Vitest, Blender (`bpy`, by script), gltfpack, Playwright for e2e and pictures.

**Spec:** `docs/superpowers/specs/2026-11-14-town-rows-design.md`. This plan covers its "Order of work" steps 1 and 2. Steps 3 (landmarks, civic places, the station) and 4 (perf pass, the switch removed, wiki pictures) get their own plan once the pictures from this one are judged.

## Global Constraints

- Branch `claude/town-rows`, cut from `main`. Not `claude/house-look` or `claude/toy-look-towns` (experiments). No merge to `main`, no move of `itch`, until the developer says so.
- Dev only: every new behaviour is behind `rowsOn()` (the dev server with `?rows`). With it off, growth, dressing and the bundle's behaviour are as on `main`: every existing test passes unedited.
- Saves: no new field, no changed field. `Building` and `Prop` keep their shapes.
- One draw call for paint: row models use only materials the loader already knows (`lacquer #rrggbb`, `lacquer fixed #rrggbb`, `wood`). No textures, no new material.
- A lot is 72 mm (`CELL`). A slice is drawn 70 mm along the street, 40 to 46 mm deep, its building line 14 mm from the street edge, its pavement 2.4 mm high.
- A storey block is 20 mm (the flats' 24).
- Most storeys in all, counting the ground floor: narrow houses and shops 3, town houses and flats 4, cottages and bungalows 2.
- Triangles: a town at any level, rows on, draws at most 1.3 times what it draws with rows off (Task 1 measures today's).
- Units mm, y up. Blender models are z up, front on +x (as `src/catalogue/assets/buildings.ts` says).
- User rules: no console logs left in; no thrown errors for control flow; say plainly in the final report anything left as a todo.

## Review Focus

1. **A saved scatter town opened with rows on.** Every building stays on its squares; detached slices draw whole; the next buildings go into the gaps. (Task 6 test.)
2. **A building with no `front`** (old save, `spreadLots`). It faces the nearest street square, else the station; it never faces away from both. (Task 4 test.)
3. **A row building picked up and moved** (`releaseBuilding`). Its tile goes with it, the square left is grass, neighbours are not rebuilt or recoloured. (Task 8 e2e.)
4. **Switch off is unchanged.** `growTown` without `rows` gives the same steps as `main` for the starter map's towns. (Task 6 test, and the untouched suites.)
5. **Storeys saved above a slice's cap** (a townhouse with 4 gained). Drawn at the cap, `Prop.storeys` not lowered. (Task 5 test.)

---

### Task 0: The branch, and today's numbers

**Files:**
- Create: `tools/perf/town-triangles.mjs`
- Bring over (untracked files from the spike branch): the spec, this plan, `tools/blender/toyblock.py` (a starting point for Task 2, deleted at the end of it)

**Interfaces:**
- Produces: `node tools/perf/town-triangles.mjs [--rows]` prints, for Larkfield at levels 0 to 5 (grown as `tools/e2e/town-shape.mjs` does), `level, buildings, triangles` where triangles is the sum over the town's props of their drawn model's triangle count; with `--rows` it opens the page with `?rows`.

- [ ] **Step 1:** `git switch -c claude/town-rows main`; confirm the spec and plan are present and `src/render/toy-look.ts` is not.
- [ ] **Step 2:** Write `town-triangles.mjs` (dev server and browser as `tools/e2e/town-shape.mjs`; count from the props library's baked geometry for each prop's `drawnKey`).
- [ ] **Step 3:** Run it. Expected: six lines, triangles rising with level. Paste them into the commit message: they are the baseline the 1.3 times target is held to.
- [ ] **Step 4:** Commit.

### Task 1: The switch, the colours, the asset tables

**Files:**
- Create: `src/props/rows.ts`, `src/props/rows.test.ts`
- Modify: `src/props/storeys.ts` (`STACKS`)

**Interfaces:**
- Produces:
  - `rowsOn(): boolean` — `import.meta.env.DEV` and `?rows` in the address; false where there is no `location`.
  - `ROW_BODIES: readonly string[]` (8 colours; the first five are the spike's `#f3e7cb`, `#c8483a`, `#e6ae3e`, `#57a394`, `#3f6fb0`) and `ROW_ROOFS: readonly string[]` (4; the first three `#b9462f`, `#4d5d6e`, `#2f6048`).
  - `rowColours(variant: number): { body: string; roof: string; door: string }` — `body = ROW_BODIES[variant % 8]`, `roof = ROW_ROOFS[Math.floor(variant / 8) % 4]`, `door` a body colour that is not `body`.
  - `townPalette(seed: number, townId: number, level: number): { bodies: number[]; roofs: number[] }` — five body indices, two roof indices (three from level 3).
  - `rowVariant(palette, hash: number, besides: readonly number[]): number` — a variant from the palette whose body is not the body of any variant in `besides`.
  - `ROW_ASSETS: { one: { pair: string[]; wide: string[]; low: string[]; shop: string[]; corner: string[] }; two: Record<"terrace" | "bakery" | "cafe" | "post" | "flats", string>; four: { court: string } }` with ids `row-pair-a|b|c`, `row-wide-a|b|c`, `row-low-a|b`, `row-shop`, `row-toy-shop`, `row-corner-shop`, `row-terrace`, `row-bakery`, `row-cafe`, `row-post`, `row-flats`, `row-court`.
  - `rowFor(old: string): string | undefined` — today's model name to its row asset: townhouse and narrow house to a pair, brick and timber house to a wide house, thatched cottage and bungalow to a low house, corner shop, toy shop, terrace, cottage row (terrace), semi-detached and villa (wide), apartment block (flats), bakery, café, post office. Landmarks, the church and every other model: undefined (they keep their model in this plan).
  - `STACKS` gains every row asset: `most` 2 for pairs and shops, 3 for wide houses and `row-flats` (storey 24), 1 for low houses, 2 for `row-terrace`, 3 for `row-court`.

- [ ] **Step 1: Tests first** in `rows.test.ts`: `rowColours(0..31)` are all distinct pairs and old values 0 to 3 give four different bodies under roof 0; `townPalette` is the same for the same inputs and has 5 bodies, 2 roofs at level 2, 3 at level 3; `rowVariant` never returns a body in `besides` when the palette has another; `rowFor` covers every name in `HOUSES_1`, `HOUSES_2` and `BY_LOOK` except `bldg-church`; every id in `ROW_ASSETS` is in `STACKS`.
- [ ] **Step 2:** Run `npx vitest run src/props/rows.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS. `npm run typecheck` clean.
- [ ] **Step 5:** Commit.

### Task 2: The models

**Files:**
- Create: `tools/blender/bldg_rows.py`, `public/models/rows.glb` (built), `src/props/rows-models.test.ts`
- Modify: `package.json` (`models` runs `bldg_rows.py` and gltfpacks `rows.glb` as it does `floors.glb`), `src/render/blender-models.ts` (`ModelSet` gains `"rows"`)
- Delete at the end: `tools/blender/toyblock.py`

**Interfaces:**
- Consumes: the ids in `ROW_ASSETS`.
- Produces: `rows.glb` with, for each id, four nodes: `<id>` (tile, one storey with its door or shop front, roof), `<id>-ground` (tile and that storey, no roof), `<id>-floor` (a plain storey), `<id>-upper` (a storey with its roof). Origin at the lot's middle on the ground; front on +x; a two-square model spans 144 mm along z, the court 144 × 144.
  - Colour slots, as fixed stand-in colours the game swaps: body `lacquer #ff00a0`, roof `lacquer #00ffa0`, door `lacquer #a000ff`. Cream frames `lacquer fixed #f6ecd2`, panes `lacquer fixed #2a3640`, pavement `lacquer fixed #d8d0bf`, garden `lacquer fixed #6aa64a`.
  - Triangle caps (printed by the script, asserted by the test): a one-square `<id>` at most 1,400; a floor at most 500; two-square models at most 2,600; the court 4,000. Bevels in 2 steps; window corners square.

- [ ] **Step 1: Test first** `rows-models.test.ts` (reads `public/models/rows.glb` as `src/render/model-overlaps.test.ts` reads its models): every id has its four nodes; each `<id>` box is 70 ± 1 mm along the street per square and within the lot; no material name outside the allowed set; triangle caps hold.
- [ ] **Step 2:** Run it. Expected: FAIL (no file).
- [ ] **Step 3:** Write `bldg_rows.py` from `toyblock.py`'s `plate`, `prism`, `gable`, `hip`, `window`, `door`, `chimney`, turned to front on +x and split into the four nodes per id. A pair is two 34 mm fronts with their own roofs (`-a` both ridges, `-b` one gable to the street, `-c` ridges at two heights); wide houses have a hipped or ridge roof; the corner shop has a second front on its −z side; the tile's street strip carries a lamp or a small tree on some ids, the garden a tree. Windows on all four sides.
- [ ] **Step 4:** `BLENDER_PYTHON=~/.venvs/woodrail-bpy/bin/python npm run models` (or the two commands for rows alone). Run the test. Expected: PASS.
- [ ] **Step 5:** Delete `toyblock.py`. Commit, with the per-model triangle counts in the message.

### Task 3: Row models in the props library

**Files:**
- Modify: `src/render/props/library.ts`, `src/catalogue/assets/buildings.ts` (register the row ids as catalogue assets from the `rows` set, category as today's houses, not on any tray)
- Test: `src/render/props/library.test.ts` (or the file that tests `drawnKey` today)

**Interfaces:**
- Consumes: `rowColours`, the `rows` model set, `stackOf`.
- Produces: for an asset starting `row-`, the library's model for `(asset, variant, storeys)` is the row model with the three slot colours replaced by `rowColours(variant)` (not `shiftHue`), stacked from the `rows` set when `storeys > 0`, with `storeys` clamped to the asset's `most`.

- [ ] **Step 1: Tests first:** a `row-pair-a` at variant 9 bakes body `ROW_BODIES[1]` and roof `ROW_ROOFS[1]`, with no stand-in colour left; frames stay cream at every variant; `storeys: 4` on `row-pair-a` gives the same key and model as `storeys: 2` (Review Focus 5); a `bldg-*` asset is baked exactly as before.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement (the colour swap where variants are applied today; the stack's set chosen by the asset's prefix).
- [ ] **Step 4:** Run. Expected: PASS; the whole `src/render` suite still passes.
- [ ] **Step 5:** Commit.

### Task 4: Dressing a town in rows

**Files:**
- Modify: `src/props/towns.ts` (`townProps`, `poseFor`/`facing`, `BOX`), `src/game/town-growth.ts` only if a caller must pass the switch
- Test: `src/props/towns.test.ts`

**Interfaces:**
- Consumes: Task 1's tables, `rowsOn()`.
- Produces: `TownDressing` gains `rows?: boolean` (callers pass `rowsOn()`). With it:
  - A building with no landmark and not a church takes a row asset: by `looks[k]`, its squares and `b.corner` (`shop` on a corner lot: `row-corner-shop`; `terrace`, `bakery`, `cafe`, `post` on two squares: theirs; a plain house on one square: a pair, a wide house or a low house, a town using three of the eight one-square house ids as it uses three styles today; plain on two: `row-terrace`; `shop` look on two: `row-flats`; four squares: `row-court`).
  - A building already dressed with an old model (`dressedAs`) takes `rowFor(old)` if there is one.
  - Its `variant` is `rowVariant(townPalette(...), hash of its first square and the town id, variants of the row props already standing on the squares beside it)`. A building already dressed keeps its variant.
  - Its pose: the model's origin on the lot's middle, its front toward `b.front`; with no `front`, toward the nearest street square within two squares, else the station (Review Focus 2).
  - Landmarks, places, treats and the church: exactly as today.

- [ ] **Step 1: Tests first:** with `rows: true` on the starter map's Larkfield, every non-landmark building's asset starts `row-`; no two row props on adjacent squares along a street share a body colour among buildings dressed in one call; the same call twice gives the same props; a building with `front` undefined beside a street faces that street; one with no street within two squares faces the station; a prop dressed as `bldg-townhouse` with variant 2 becomes a pair with variant 2; with `rows` off the result equals today's (snapshot of the current output, taken before the change).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS; `npx vitest run src/props src/game` passes.
- [ ] **Step 5:** Commit.

### Task 5: See it

**Files:**
- Create: `tools/shots/town-rows.mjs`

**Interfaces:**
- Produces: `node tools/shots/town-rows.mjs [<out>]` (real GPU, 1440 × 900, HUD hidden, as `tools/shots/house.mjs` launches): Larkfield at levels 0 to 5 with and without `?rows`, the same camera (`lookAt(centre, 1700, 0.75)`) and one closer (`620, 0.5, 0.6`), into `<out>/rows-<level>-<now|rows>-<wide|street>.jpg`.

- [ ] **Step 1:** Write and run it. Expected: 24 pictures.
- [ ] **Step 2:** Look at every `rows` picture. Fix what is plainly wrong in Tasks 2 to 4's code (a slice facing the wrong way, a gap in a row, colours clashing, z-fighting on printed windows at the wide view), re-running their tests.
- [ ] **Step 3:** `node tools/perf/town-triangles.mjs --rows`. Expected: each level at most 1.3 times Task 0's. If over, thin the models (Task 2's caps) until it holds.
- [ ] **Step 4:** Commit with both tables.

### Task 6: The fill order

**Files:**
- Modify: `src/roads/grow-town.ts`, `src/landscape/generate.ts:502`, `src/game/town-growth.ts:59` (pass `rows: rowsOn()`)
- Test: `src/roads/grow-town.test.ts`

**Interfaces:**
- Produces: `GrowOptions.rows?: boolean`. With it:
  - The opening along a street is every fourth square (`GAP_EVERY` 4), so a row is three lots.
  - A step's lot is chosen by tier, the best score within the first tier that has any unreserved lot: (1) a lot with a building on the square beside it along its street, both fronting the same street side; (2) a lot whose street square has a building on its far side; (3) a lot on a street square at distance 0 or 1 from Station Road; (4) any unreserved lot. Within a tier, nearest the station first (`dist`, then `away`), then the existing noise.
  - A street is laid only when tiers 1 to 3 are empty and an extension exists, as the loop does today for `near.length < 2`.
  - Reserved lots are used only when nothing else and no extension is left, as now.
- Also produces: `rowOpenings(grid, town): number[]` — the reserved squares of a town's streets that have a building on the square each side along the street and no street leaving them (Task 7 draws them).

- [ ] **Step 1: Tests first:** without `rows`, `growTown` on the starter map's Larkfield (and two more seeds' towns) returns the same steps as before the change (Review Focus 4: record them from `main` first); with `rows`, on a bare flat grid the first six buildings each touch another along a street or face one, and none stands alone; at 14 buildings at least 80% touch a neighbour along their street; no row is longer than three lots without an opening; a scatter (six buildings placed two squares apart on one street) gets its next three buildings in the gaps between them (Review Focus 1); two calls give the same steps.
- [ ] **Step 2:** Run. Expected: the `rows` tests FAIL, the unchanged-growth test PASS.
- [ ] **Step 3:** Implement inside `growTown` (the tiers where `pool` is chosen; `GAP_EVERY` by the option; nothing else moves).
- [ ] **Step 4:** Run. Expected: PASS. `npm test` passes whole.
- [ ] **Step 5:** Commit.

### Task 7: Openings, and the lots that aren't a house on a street

**Files:**
- Modify: `src/render/dressing/buildings.ts` (beside `townFurniture`), `src/props/towns.ts` if the court needs its pose
- Test: `src/render/dressing/buildings.test.ts` or the nearest existing dressing test

**Interfaces:**
- Consumes: `rowOpenings`, `rowsOn()`.
- Produces: with rows on, each opening square is drawn as a paved place (the pavement colour over the square, a round tree, a bench facing the street) in the town's static dressing; rebuilt only when the town's squares change, as its furniture is. Treats and places draw as today with no tile.

- [ ] **Step 1: Test first:** a town with one opening between two buildings yields one place on that square; when a side street later leaves through it, none; rows off, none.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 8: The player's path, and the pictures to judge

**Files:**
- Modify: `tools/e2e/town-shape.mjs` (a `--rows` run), `scripts/e2e/affected.mjs` (a rule for `src/props/rows.ts` and `tools/blender/bldg_rows.py`), `AGENTS.md` (the new commands, one line each)

- [ ] **Step 1:** `town-shape.mjs --rows` opens `?rows` and, at each level, checks: every row building's front square is a street; from the village on, at least 80% of buildings touch a neighbour along their street; no row building's height is more than twice 70 mm; new buildings went up; then, at the city, a row house is picked up and set down two squares away by the editor's own drag: its tile moved, the square left has no tile, and the props beside it kept their ids, assets and variants (Review Focus 3); 0 frames drawn while idle after; no page errors.
- [ ] **Step 2:** Run `npm run e2e:town-shape` (rows off). Expected: ALL PASS, as on `main`. Run with `-- --rows`. Expected: ALL PASS.
- [ ] **Step 3:** `npm test`, `npm run typecheck`, `npm run build`. Expected: all pass; the production build has no `?rows` behaviour (the switch is dev only) and its entry bundle's growth is noted.
- [ ] **Step 4:** `node tools/shots/town-rows.mjs docs/agents/shots` for the final pictures; the `/check` skill for the tier this change is (rendering and models, sim).
- [ ] **Step 5:** Commit. Report: the pictures, both triangle tables, what `/check` ran, and what is left (landmarks, places and the station still in the old style; the switch still on; seeds' towns unchanged for players until the switch goes).
