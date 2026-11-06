# Performance: measuring, budgets, and what to check

Woodrail runs on phones. AGENTS.md's "Performance" section has the rules; this is how to measure, and the budgets that
`npm run perf:check` holds the game to.

## The harness (`tools/perf/`)

| Tool | What it does |
|---|---|
| `npm run perf -- [options]` (`tools/perf/run.mjs`) | Loads representative maps in a 390×844 phone page (DPR 2, CPU throttled 4×) and measures what a player pays for. Writes `perf.json` and `perf.md` (a table) to `--out` (default `perf-out/<time>`). |
| `npm run perf:check` (`tools/perf/check.mjs`) | A short run checked against `tools/perf/budgets.json`: `--quick` with the options in `budgets.json`'s `run` (the fresh, Sandbox and features maps, CPU 2×, DPR 1, a first visit only, short stretches, 3 s a spot), then `perf:memory`. Exit 1 when a measure is over budget by more than its margin, or over a memory budget. About 16 min (11 the run, the features map most of it; 4.5 memory). `--no-memory` leaves the memory check out. Each map's time by phase is printed (`perf: <map> phases`) and kept (`phases`). |
| `npm run perf:memory` (`tools/perf/memory-check.mjs`) | The memory budget check (below, Memory budgets): the features map on a Pixel-10-like phone and a desktop page, checked against `tools/perf/memory-budgets.json`. About 4.5 min. `--suggest` prints the budgets this run would give; `--from <memory.json>` checks a run already made. |
| `node tools/perf/compare.mjs <before.json> <after.json>` | Two runs side by side, the main measures per map with the change: for a commit message. |
| `node tools/perf/profile-top.mjs <file.cpuprofile> [<regex>]` | The top functions of a `--profile` CPU profile, by total and self time. |
| `node tools/perf/scene.mjs [<root>] [<map file>]` | What the scene holds to draw: its biggest meshes by triangles (instances counted), what casts shadows. Use an unminified build for names. |
| `node tools/perf/geometry.mjs [--root <dir>] [--map late] [--json <file>]` | What the map's geometry costs: the GPU's vertex and index buffers in all (every `bufferData`), the scene's meshes by owner (`landscapeView`, `propsView`, …) ranked by triangles × instances and by buffer bytes, their index and attribute formats, copies of one geometry kept apart. For the audit below. |
| `node tools/shots/geometry-diff.mjs --before <dir> --after <dir> [--out <dir>]` | The late map from two builds at the same seven views (390×844, DPR 2 held, paused from the start, clock fixed, trains hidden): pictures, the pixels that differ (by more than 24 and 8 of 255), a full frame's triangles each. Same build twice for the noise floor. For geometry changes that should look the same. |
| `node tools/perf/threads.mjs [<s>]` | Which Chromium threads are busy while the game sits idle (a worker, the GPU process, audio). |
| `node tools/perf/idle-frames.mjs`, `idle-cpu.mjs` | Older, narrower checks: frames drawn and CPU over 20 s idle; audio threads. |
| `node tools/perf/first-download.mjs [<dist>]` | The first download: the entry script and the chunks it imports statically (what a first visit fetches before the game runs), against what loads later. `bundle.firstJsKB` in a run. Workers are chunks of the same build (`import url from "./x-worker.ts?worker-chunk"`, `scripts/worker-chunks.mjs`), so they share its three and track code rather than carrying copies (Vite's own `new Worker(new URL(…))` builds each worker on its own). |
| `node tools/perf/research-tap.mjs [--taps 4] [--trace <f>] [--profile <f>]` | The research board's tap on its own, on the late map: the tap handler's time each tap, and with `--trace` the style and layout it forces. |
| `node tools/shots/track-far.mjs [<out>]` | Track carved and in its far version, at four zooms on the Sandbox map: pictures, the pixels that differ, the triangles. |
| `node tools/perf/memory.mjs [--map late] [--play 600] [--early] [--snapshots]` | Memory on an emulated Pixel 10 (412×915, DPR 2.625): the JS heap and the ArrayBuffers outside it, the GPU's allocations (`gpu-tally.js`: every WebGL buffer, texture and renderbuffer, by a hook on the context), at load and after `--play` seconds of play; load and frame time. `--early` measures the moment it's ready (what grows after), `--snapshots` writes heap snapshots. |
| `node tools/perf/buffers.mjs <file.heapsnapshot>` | Where a snapshot's ArrayBuffer memory is (vertex data: most of what a map holds), summed by the path that holds it. |

Run them after `npm run build` (they measure `dist/`). `--root <dir>` measures another build (a directory with a
`dist/` in it): keep a copy of main's build to compare a change against it on the same machine, in the same hour.

### The maps (`tools/perf/maps/`)

| `--maps` id | Map | Made by |
|---|---|---|
| `fresh` | A new Game map (the starter line, nothing built) | the title's New game |
| `late` | The goals play-through's map at minute 440: every town on the line, farm, mill, quarry, mine, harbour, grown towns | `GOALS_LONG=1 PERF_MAP_OUT=tools/perf/maps/late-game.txt npx vitest run src/play/balance.test.ts -t "long goals"` (the player's own path) |
| `sandbox` | A big Sandbox map: seed 7 with 24 plots of land added, 24 ovals (277 pieces), 16 trains of 4 cars running | `PERF_MAPS=1 npx vitest run src/play/perf-maps.test.ts` |
| `features` | The late map with every newer feature built on it, each in a spot of its own (`features.json`: a centre, a camera distance, its ids): a breakdown crane train on a siding, an oil well and a water pump, a sawmill with three depot tracks and the gantry, the six goods-chain yards, a signal box with telegraph poles and wires, a tunnel with a train through it (ghosts, portals), an underpass on a plinth off a hill's edge under a bridge with a train, a post office with mail vans and post vans in two towns, a town hall, park and fountain and a painted engine, a metro line under a town with its train. Two plots of land bought for room (three more small towns) | `node tools/perf/feature-map.mjs` (after a build; ~5 min; a harness map: placed by the editor and the cards' own buttons, research learned, yards stocked; it checks every feature is there after a reload) |

They're copied maps (`woodrail-map:1:…`) opened with the dev-only `?dev#load=`. Make them again when the save format
moves on (an old save is turned away), and say so in the commit: numbers before and after aren't comparable.

### What it measures, per map

- **Load**: a first visit (nothing cached) to ready (the loading cover gone, in play), the first visit's own work after
  that (tray pictures, track carving: cached per build), then a reload to ready (a returning player).
- **Idle**: 20 s with nothing touched: frames drawn, main-thread time (% of wall time, throttled), the browser's CPU
  (every process: SwiftShader's drawing lands here), rAF callback time a second, timers (`interval:5000` is the
  autosave, `interval:1000` the HUD's once a second). On a map whose trains run this is the steady state, and a
  **paused** stretch follows (the floor: should draw nothing).
- **Pan**: drags and wheel zooms for up to 40 s: frame cost (the rAF callback of each drawn frame: the game's frame and
  three's render calls), the gap between drawn frames, pointer-move handler cost, long tasks, draw calls and triangles
  of the frames drawn (the camera moving doesn't redraw shadows).
- **Operations**: the ☰ menu and the research board (tap handler, and to the frame after), a train's card (a tap on
  its engine), a tray drag (a straight from the tray across the map: its pointer moves), the autosave.
- **Frame**: one full frame (with its shadow pass): draw calls, triangles, programs, geometries, textures, scene
  objects, DOM nodes, the pixel ratio the resolution governor settled on; the JS heap after GC.
- **Spots** (a map with spots: `features`; `--spot <s>` a stretch, `--only-spots crane,tunnel`): the camera on each
  feature alone, as a player looks at it. For each: one full frame there (draw calls, triangles), the game running
  (frames, frame cost, main thread), paused (should draw nothing), and changes beside it (a straight laid and taken
  up, a tree planted and taken out: the call, and the main thread's part of the frame after, `frameMs`, which pays for
  the rebuild). Then the camera away from them all, running; then every train stopped (levers to 0) and each spot
  again, `still` (what's left is ambient motion, drawn only where it's seen), and away, `awayStill` (should draw
  nothing); last, the crane sent to lift a train off (`craneWork`): working in view, paused, and away (no frames).
- **Soak** (`--soak <s>`): heap and geometries before and after a long run with pans now and then (leaks).

`--profile` saves CPU profiles of the idle and pan stretches (`<map>-idle.cpuprofile`, open in Chrome DevTools) and
lists the top functions by self and total time in the JSON. Profile an unminified build so the names mean something:
`npx vite build --minify false --outDir perf-out/prof-root/dist`, then `--root perf-out/prof-root`. `--trace` saves a
Chrome performance trace of the pan.

### Reading the numbers

The browser here draws with SwiftShader (software WebGL), so the GPU's work is CPU work in the GPU process, and frames
come slowly (a second or two at DPR 2). So:

- Compare **main-thread** numbers (frame ms, pointer-move ms, main thread %, timers) between runs: they're the game's
  own JavaScript, throttled as a phone's slower CPU.
- Counts (frames drawn, draw calls, triangles, programs, geometries, heap) are exact and the same from run to run.
- Wall times to a paint, fps and browser CPU are SwiftShader's, not a phone GPU's: compare them only run to run on one
  machine, and only for big moves.
- Timings move by ±20% between runs: measure before and after in the same session, and run twice when it's close.

## Budgets (`tools/perf/budgets.json`)

The check's numbers are for its own settings (CPU 2×, DPR 1, a first visit), not the full run's: compare like with like.
Each measure has a `max` and a kind: `frames` (idle frames: no margin), `count` (draw calls, triangles, programs,
heap: 10%), `size` (bundle KB: 5%), `time` (main-thread timings: 50%, they're noisy). `perf:check` fails
when a measure is over `max × (1 + margin)`.

A change that rightly costs more (a new kind of thing on the map, a bigger feature): `npm run perf:check -- --update`
writes the budgets from that run; commit them with the reason and the numbers. A change that saves a lot: update them
too, so the saving is kept.

## Memory

A phone kills the tab well before its RAM is full (a Pixel 10 at about 300 MB for the renderer and the GPU together),
so memory is a budget like frame time. Measure with `tools/perf/memory.mjs` (above). What to know:

- **The JS heap's "used size" misses most of it.** Typed arrays (vertex data) live outside the V8 heap: on the late map
  the heap is ~35 MB and the ArrayBuffers were ~315 MB. `memory.mjs` reports both (`jsTotalMB`).
- **Drawn-only geometry frees its CPU copy** (`gpuOnly`, `src/render/gpu-only.ts`): three keeps every attribute's array
  after upload, so a static mesh was held twice. Mark what's only drawn (the land's tiles, felt, scenery, waiting
  dolls), `pickable` what a raycast hits (ruins, depots: positions and index kept). Don't mark a cache's sources, what
  is merged or cloned later, or anything that's disposed and drawn again: a freed geometry uploaded again draws
  nothing (it says so in the console). Its normals and colours are made compact too (`compact-vertices.ts`).
- **Prop models**: baked in compact vertices; a plain model's geometry is let go once its batch has it
  (`PropLibrary.release`) and baked again if it's wanted (a prop picked up, a tray picture).
- **Textures**: most of the GPU's texture memory is render targets (the shadow map, the post passes), not maps. The
  generated maps' canvases are freed once uploaded (`freedOnUpload`, textures.ts, only while `gpuOnlyEnabled`), the
  felts share one speckle and one fibre tile (their colour is the material's), the felt is half size on the mobile
  tier, and the env map is 128 a face there with its generator freed. The beech stays full size. Compare pictures
  with the drawing resolution pinned: the resolution governor steps down on a busy machine, which softens a
  picture more than any of this.
- **What grows after load is the map finishing itself** (the land around, props, track carving), not a leak: it levels
  off within a minute. `--early` shows the curve.

## Memory budgets (`tools/perf/memory-budgets.json`)

Players on phones (a Pixel 10, on itch) lost the game at about 650–700 MB between the tab and the GPU process
(`docs/mobile-crash-2026-11-05.md`). `npm run perf:memory`, run by `perf:check`, holds memory to budgets so a growth
fails the release gate before it ships.

What it does: the features map (the late Game map with every newer feature on it) opened in two pages, one after the
other: a Pixel-10-like phone (412×915 at DPR 2.625, touch, a Pixel 10 user agent: the mobile tier, drawing at a pixel
ratio of 2, as in e2e:gl-lost) and a desktop page (1440×900, DPR 1: the high tier, with ambient occlusion, depth of
field and a 4096 shadow map). No CPU throttling (counts and bytes don't depend on it). It waits for the first visit's
own work (tray pictures) and then until the GPU tally and three's counts are the same at two looks a few seconds apart,
and measures:

| measure | what |
|---|---|
| `gpu.totalMB` | everything WebGL holds by the game's own tally (`gpu-tally.js`: every buffer, texture and renderbuffer as it's allocated and deleted), plus the canvas |
| `gpu.geometryMB` | vertex and index buffers |
| `gpu.texturesMB` | textures not drawn into (maps: wood, felt, labels, the env map) |
| `gpu.targetsMB` | render targets: textures attached to a framebuffer (the shadow map, the scene's target, post passes) and renderbuffers (multisampled colour and depth) |
| `gpu.canvasMB` | the canvas's own buffers (colour, back buffer, depth) |
| `js.heapMB` | V8's heap after two GCs |
| `js.arrayBuffersMB` | ArrayBuffers outside it (typed arrays: three's CPU copies of geometry, the game's caches) |
| `counts.*` | three's geometries, textures and programs; WebGL's live buffers and textures |
| `leak.*` (mobile) | growth over 4 rebuild cycles after a first one: pieces laid and undone (track rebuilds), a zoom out and back every other cycle (far detail, culling), ☰ opened and shut: heap, ArrayBuffers, GPU, geometries, textures |

Deterministic: one map file, a browser of its own for each tier (in one browser the second load was quicker, and
what it left built moved with that), the game held paused from the moment it exists (the trains and the sim hold
still: a harness shortcut), the
drawing resolution held at the tier's own (the check fails if it isn't: a smaller target isn't comparable), the
device's memory pinned at 8 GB (a 4 GB machine would make the game lean), the clocks pinned and the industries'
movers still.

The budgets: each measure's `max`, and `measured` (its value when it was set). A measure over its `max` fails, and the
table says by how much and against what. The maxes are three runs' highest value plus a margin (6% for MB, 5% for
counts, at least 1 MB or 2; leaks 1 MB or 2 objects over the most three runs saw), above the noise:

Three runs (2026-11-05, this container's 4 cores; each about 4.5 min). Desktop repeats exactly but for the heap's
0.3 MB; the phone's load leaves a few geometries more or fewer (816–822: what it builds depends on the load's timing),
0.7% at most. Leak growth is over 4 cycles (the heap's 1.2–1.3 MB, steady from run to run, not looked into yet; nothing on the GPU).

| measure | run 1 | run 2 | run 3 | spread | budget (max) |
|---|---|---|---|---|---|
| mobile.gpu.totalMB | 263.5 | 263 | 263 | 0.5 (0.2%) | 280 |
| mobile.gpu.geometryMB | 134.1 | 133.6 | 133.6 | 0.5 (0.4%) | 143 |
| mobile.gpu.texturesMB | 8.4 | 8.4 | 8.4 | 0.0 (0.0%) | 9.4 |
| mobile.gpu.targetsMB | 109.5 | 109.5 | 109.5 | 0.0 (0.0%) | 117 |
| mobile.gpu.canvasMB | 11.5 | 11.5 | 11.5 | 0.0 (0.0%) | 13 |
| mobile.js.heapMB | 39.9 | 39.8 | 39.8 | 0.1 (0.3%) | 43 |
| mobile.js.arrayBuffersMB | 243.4 | 243.2 | 243 | 0.4 (0.2%) | 260 |
| mobile.counts.geometries | 822 | 816 | 816 | 6 (0.7%) | 864 |
| mobile.counts.textures | 43 | 43 | 43 | 0 (0.0%) | 46 |
| mobile.counts.programs | 64 | 64 | 64 | 0 (0.0%) | 68 |
| mobile.counts.glBuffers | 3476 | 3458 | 3458 | 18 (0.5%) | 3650 |
| mobile.counts.glTextures | 47 | 47 | 47 | 0 (0.0%) | 50 |
| mobile.leak.heapMB | 1.2 | 1.3 | 1.3 | 0.1 | 2.3 |
| mobile.leak.arrayBuffersMB | 0 | 0.1 | 0.1 | 0.1 | 1.1 |
| mobile.leak.gpuMB | 0 | 0 | 0 | 0 | 1 |
| mobile.leak.geometries | 1 | 1 | 1 | 0 | 3 |
| mobile.leak.textures | 0 | 0 | 0 | 0 | 2 |
| desktop.gpu.totalMB | 363.4 | 363.4 | 363.4 | 0.0 (0.0%) | 390 |
| desktop.gpu.geometryMB | 143.6 | 143.6 | 143.6 | 0.0 (0.0%) | 153 |
| desktop.gpu.texturesMB | 11.1 | 11.1 | 11.1 | 0.0 (0.0%) | 13 |
| desktop.gpu.targetsMB | 198.7 | 198.7 | 198.7 | 0.0 (0.0%) | 215 |
| desktop.gpu.canvasMB | 9.9 | 9.9 | 9.9 | 0.0 (0.0%) | 11 |
| desktop.js.heapMB | 40.5 | 40.2 | 40.5 | 0.3 (0.7%) | 43 |
| desktop.js.arrayBuffersMB | 242.5 | 242.5 | 242.5 | 0.0 (0.0%) | 260 |
| desktop.counts.geometries | 857 | 857 | 857 | 0 (0.0%) | 900 |
| desktop.counts.textures | 42 | 42 | 42 | 0 (0.0%) | 45 |
| desktop.counts.programs | 69 | 69 | 69 | 0 (0.0%) | 73 |
| desktop.counts.glBuffers | 3609 | 3609 | 3609 | 0 (0.0%) | 3790 |
| desktop.counts.glTextures | 46 | 46 | 46 | 0 (0.0%) | 49 |

**Changing a budget** is an edit of `memory-budgets.json` by hand, in the commit that changes the memory, with the
reason and the numbers in the message. `npm run perf:memory -- --suggest` prints the file as this run would make it;
copy in what you mean to change. A change that saves a lot tightens the maxes too, so the saving is kept.

## Before adding per-frame work

- Does it need to run every frame? Most things change on an event (a piece placed, a train stopping, a version
  counter moving): run it then. Compare a version or a key a frame, not the data.
- Does it run when nothing draws? `Game.frame` runs every tick (30 a second) even when it draws nothing: work in it,
  in `onFrame` (main.ts), or in a once-a-second timer is paid all the time the game is open.
- Does it allocate? A frame's arrays, closures, spread objects and strings are garbage 30 times a second: reuse a
  scratch object.
- Does it touch the DOM? Write text or classes only when they change (`hud` does: keep it so).
- Does it draw? A new mesh is a draw call (and a shadow-pass draw call if it casts): batch or instance many small
  things, merge static ones, and share materials (a new material can be a new shader program to compile).
- Then measure: `npm run perf -- --maps fresh,late` before and after, and put the numbers in the commit.

## Known costs and leads (November 2026)

Measured with the harness (4× CPU, DPR 2 unless said); fixed ones are in the branch history (`git log -- tools/perf`).
Open ones, biggest first:

- **Shader programs at load.** 44–54 programs after the fixes below; three checks each on first use, which waits for
  its compile on the main thread, one after another (in SwiftShader, tens of seconds of a reload at 4×). Fixed: the
  shadow pass's depth programs were compiled twice (its first frame ran before the lights were set up; now the first
  frame skips the shadow pass), and the held piece's are warmed after load (`Game.warmShaders`). Tried twice and
  dropped: `compileAsync` of the whole scene before the first frame. Compiled for the screen it built other programs
  than the frames use (sRGB, ACES: compile for a render target, as `Game.compileFor` does); with that fixed it still
  built variants the frames didn't use on some loads (possibly the far-detail materials), and held the first frame
  rather than saving time. Leads: fewer material variants (25 `MeshPhysicalMaterial` programs on the Sandbox map), or
  precompiling for the view the first frames actually show. `tools/perf/programs.mjs` and `program-origins.mjs` show
  what's compiled, where and when.
- **Building the map at load.** The `Game` constructor was ~20 s of a reload at 4× on the big Sandbox map. Fixed:
  the beech and felt textures are kept per build (IndexedDB) and made once a page; the dressing's vertex colours no
  longer allocate per vertex. Left: `LandscapeView`'s dressing (`addPart`, `mergeGeometries`, ~10 s at 4×) and the
  geometry upload (`bufferData`). Lead: build far tiles' dressing after the first frame, or keep it per build.
- **Tray and research pictures** (first visit, or a new build). Fixed: the studio's 2D canvas is on the CPU (encoding
  a picture waited on the GPU), and pictures asked for on demand are read back asynchronously. In SwiftShader the
  readback itself still costs the same either way.
- **Triangles.** A curved track piece is ~3.1k triangles (an S-curve 10k), carved. Fixed: plain track (straights,
  curves, S-curves, joins) is drawn in its far version (`buildPieceFar`: its body and grooves swept as one, no holes,
  its curve every 7.5°; ~250 triangles a curve) where a millimetre is under half a pixel (`FAR_TRACK_PX_PER_MM`;
  beyond ~6.3 m at DPR 2), a tile at a time (`TrackView.setDetail`): the late map's full frame 1.81 M → 1.38 M. At
  normal zoom nothing changes (`tools/shots/track-far.mjs`: 0 pixels differ). Left: the big Sandbox map, 1.56 M, is
  mostly near; switches, ramps and bridges are always carved.
- **Research board** tap. Fixed: the board was laid out twice in the tap (a scroll position read before its tags went
  in, then written after: now kept from scroll events), every blueprint's "Unlocks" pictures were made for the web
  though only the ticket shows them (now when read), and a board opened again on the same tag with nothing changed
  was built and laid out afresh (now kept). Tap handler at 4× on the late map, 8 taps (`tools/perf/research-tap.mjs`):
  median 129 → 22 ms. Left: the first open of a visit, ~200 ms, most of it the browser's first style and layout of the
  board (~100 ms). Lead: to paint, on a first visit, the ticket's tray pictures drawn on demand
  (`drawWantedPictures`) wait on their shader programs' compiles (`getShaderInfoLog`, `getProgramInfoLog`: 8.5 s of a
  13.7 s tap-to-paint at 4× in SwiftShader).
- **Bundle**. Fixed: the CSG carving (three-bvh-csg, three-mesh-bvh, polygon-clipping: `piece-carve.ts`) and Zod
  (the save's schemas: `save-schema.ts`) load on their own (`carver.ts`, `persist/schemas.ts`), not in the first
  download: 2377 → 2153 KB (723 → 661 KB gzipped). The schemas are fetched as loading starts, beside the models; the
  carver only when the main thread carves (a join piece, or no workers).
- **The newer features** (batch H, the `features` map's spots, 4× CPU, DPR 2). Fixed: the depot goods sent every
  kind's whole instance buffer (2048 matrices) to the GPU every frame a train moved (~7 MB a frame with the goods
  chains: the batch-fg idle regression); a working breakdown crane drew every frame, paused or out of view; the
  small touches were all rebuilt on any track or props change (130–200 ms of the frame after a tree planted or a
  straight laid, now 30–100); the telegraph wires on any props change; the yards on every catalogue model that came in;
  `TownLife.update` and a town card's places row allocated every frame; metro trains drew coal while paused. Costs as
  measured: each feature's spot adds no draw calls or triangles beyond its own models (the pumps, gantry and chains
  are batched with their yard: 0 draw calls of their own); paused, no spot draws; with every train stopped, a spot
  draws 0–3 frames in 6 s (SwiftShader: a frame a second or two at DPR 2), the most at the gantry (its sawmill's saw)
  and the telegraph, and away from them all none. Left: a track change
  rebuilds every piece's instances (`TrackView.sync`, ~50 ms at 4× on this map); an underpass laid or taken up
  rebuilds the whole felt sheet (`LandscapeView.setFeltHoles`); the depots' piles are placed again on every frame a
  train moves (their CPU part; the upload is now only what's placed).
- **Idle tick**: `Game.frame` and `onFrame` cost ~1.3 ms a tick at 4× when nothing draws (~4% of the main thread),
  many small checks; nothing large left.

## Geometry: the late map's audit (November 2026)

Players' phones (a Pixel 10) crashed on late maps. On an emulated Pixel 10 with the late map, geometry buffers were
about 140 MB of the 325 MB the GPU held; the aim is under about 300 MB for the renderer and GPU together.
`node tools/perf/geometry.mjs --map late` (unminified builds of main and of claude/memory-b) lists what the geometry
is. Main: **149–153 MB** of vertex and index buffers uploaded to the GPU after loading (it varies with what's been
drawn), 175 MB of geometry in the scene (the same arrays are kept in the JS heap: three keeps them), 3.2 M triangles.
Now: **42–53 MB** uploaded, 53 MB in the scene.

What it was: merged static scenery (towns, stations, fields, ruins, the scenery around, the yards, props) made by
`mergeGeometries` of parts expanded with `toNonIndexed`, so stored non-indexed, in four float attributes (44 bytes a
vertex), and 72% of its vertices exact copies of another (a rounded box's corners, shared by its triangles). The
props' `BatchedMesh` had grown by doubling to a million vertices for 850k used.

What's done (src/render/compact.ts, far-detail.ts; the commits say more):

- **Welded and quantised** (`compact`): finished merged geometry indexed (exact copies kept once, 16-bit indices where
  the vertices fit), normals as normalised 8-bit, vertex colours as normalised 16-bit. Positions and uvs as they were.
  Pictures: the same to the pixel at close and normal zoom.
- **Shared**: each tree shape and hill-block shape made once for every tile's instanced draw (a dozen copies each).
- **Hidden faces**: hill blocks without their faces straight down (on the felt, a block or under their painted top).
- **Instance buffers sized to use**: the yards' 58 kinds of goods had room for 2048 each (7 MB of matrices).
- **Far versions** (`far-detail.ts`): where a millimetre is under half a pixel (and back 10% nearer), towns, yards,
  ruins, the felt, the scenery around, and props and kits are drawn in a version simplified within half a millimetre
  of the surface and its normals (meshoptimizer's simplifier, fetched then: 55 kB). A plain mesh's far version is a
  new index over its own vertices (on the GPU, that index alone); a prop's is copied into its batch. Made once wanted
  on a dozen frames drawn with the camera moving (zooming out), by a worker (`far-worker.ts`: a tile's simplification
  is a long task, and on the main thread it held up taps): nothing at load, nothing while a still or paused game sits
  there.

Pictures (`tools/shots/geometry-diff.mjs`, main vs now, the late map at 390×844 and DPR 2): pixels differing by more
than 24 of 255 at the town close, low and normal, and the industry close and normal: 0–0.005% (max difference 5 of
255 close up); wide (3.5 m) 0.29% and far (9 m) 0.08%, as between two runs of one build (0.29%, 0.07%: ambient motion).
Triangles a full frame: the same close up (the blocks' undersides off: −0.5%); far, 3.21 M → 2.43 M (−24%).

The tables: main → now, in the scene (instances counted; a batch's drawn instances), both at rest (nothing far).
Formats (a group's first mesh's): `idx16`/`idx32` an index, `f32` floats, `i8n`/`u16n` normalised integers.

**Top 20 by triangles × instances** (main's ranking)

| # | What | Meshes / drawn | Triangles (k) | Buffers (MB) | Formats, main → now |
|---|---|---|---|---|---|
| 1 | hill blocks of the land around (instanced boxes) (`landscapeView/landscapeView.aroundGroup/InstancedMesh [MeshStandardMaterial]`) | 151 / 25692 | 674 → 630 | 2.5 → 1.9 | — pos f32 nrm f32 uv f32 → idx16 pos f32 nrm f32 uv f32 |
| 2 | trees, bushes, rocks (instanced) (`landscapeView/landscapeView.treeGroup/InstancedMesh [MeshPhysicalMaterial]`) | 99 / 3146 | 569 → 569 | 1.5 → 0.3 | idx16 pos f32 nrm f32 uv f32 (same) |
| 3 | props: town houses, landmarks (BatchedMesh, lacquer) (`propsView/props [MeshPhysicalMaterial]`) | 2 / 131 | 518 → 518 | 46.0 → 11.6 | — pos f32 nrm f32 uv f32 col f32 → idx32 pos f32 nrm i8n uv f32 col u16n |
| 4 | track pieces (instanced, carved) (`trackView/InstancedMesh [MeshPhysicalMaterial]`) | 58 / 269 | 378 → 378 | 3.5 → 3.5 | idx16 pos f32 nrm f32 uv f32 (same) |
| 5 | town tiles: towns, stations, fields, waiting dolls (merged) (`landscapeView/Mesh [MeshPhysicalMaterial]`) | 20 / 20 | 332 → 332 | 52.4 → 9.5 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 6 | old industries' ruins (merged) (`ruinsView/ruins/Mesh [MeshPhysicalMaterial]`) | 6 / 6 | 144 → 144 | 18.1 → 4.1 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 7 | scenery around: its houses (merged) (`landscapeView/landscapeView.aroundGroup/Mesh [MeshPhysicalMaterial]`) | 7 / 7 | 136 → 136 | 17.1 → 6.1 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 8 | felt: ground, rivers, sand, old streets (`landscapeView/landscapeView.feltGroup/Mesh [MeshPhysicalMaterial]`) | 32 / 32 | 122 → 122 | 11.1 → 6.1 | idx16 pos f32 nrm f32 uv f32 (same) |
| 9 | hill blocks on the land (instanced, rounded) (`landscapeView/InstancedMesh [MeshStandardMaterial]`) | 60 / 1896 | 110 → 106 | 2.7 → 2.6 | — pos f32 nrm f32 uv f32 → idx16 pos f32 nrm f32 uv f32 |
| 10 | industries' yards (merged per tile) (`depotView/depotStatic/Mesh [MeshPhysicalMaterial]`) | 8 / 8 | 63 → 63 | 7.5 → 1.6 | — pos f32 nrm f32 uv f32 → idx16 pos f32 nrm i8n uv f32 |
| 11 | shadow stand-ins (positions only) (`landscapeView/Mesh [MeshBasicMaterial]`) | 45 / 45 | 32 → 32 | 1.9 → 1.9 | idx16 pos f32 (same) |
| 12 | goods and heaps in yards and wagons (instanced) (`depotView/InstancedMesh [MeshPhysicalMaterial]`) | 58 / 190 | 28 → 28 | 7.2 → 0.9 | idx16 pos f32 nrm f32 uv f32 (same) |
| 13 | scenery around: houses' textured parts (`landscapeView/landscapeView.aroundGroup/Mesh [MeshStandardMaterial]`) | 7 / 7 | 27 → 27 | 2.4 → 0.6 | — pos f32 nrm f32 uv f32 → idx16 pos f32 nrm i8n uv f32 |
| 14 | scenery around: shadow stand-ins (`landscapeView/landscapeView.aroundGroup/Mesh [MeshBasicMaterial]`) | 10 / 10 | 15 → 15 | 0.5 → 0.2 | — pos f32 → idx16 pos f32 |
| 15 | track: shadow casters (`trackView/kind/InstancedMesh [MeshBasicMaterial]`) | 50 / 118 | 13 → 13 | 0.2 → 0.2 | — pos f32 nrm f32 (same) |
| 16 | towns' touches (`touches/Mesh [MeshPhysicalMaterial]`) | 5 / 5 | 10 → 10 | 1.3 → 0.3 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 17 | yards' moving machines (`depotView/depotMoving/Mesh [MeshPhysicalMaterial]`) | 47 / 47 | 10 → 10 | 0.5 → 0.5 | — pos f32 nrm f32 uv f32 (same) |
| 18 | yards' cranes and parts (`depotView/Mesh [MeshPhysicalMaterial]`) | 58 / 58 | 9 → 9 | 0.6 → 0.6 | idx16 pos f32 nrm f32 uv f32 (same) |
| 19 | kits: big stations, halts (BatchedMesh) (`kitView/props/props [MeshPhysicalMaterial]`) | 2 / 2 | 9 → 9 | 4.8 → 2.1 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 20 | a timber wagon's planks (a glTF model: quantised already) (`trainView/timber-classic/mesh_71 [MeshPhysicalMaterial]`) | 3 / 3 | 7 → 7 | 0.0 → 0.0 | idx16 pos u16 nrm i8n uv f32 (same) |

**Top 20 by buffer bytes** (main's ranking)

| # | What | Meshes / drawn | Triangles (k) | Buffers (MB) | Formats, main → now |
|---|---|---|---|---|---|
| 1 | town tiles: towns, stations, fields, waiting dolls (merged) (`landscapeView/Mesh [MeshPhysicalMaterial]`) | 20 / 20 | 332 → 332 | 52.4 → 9.5 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 2 | props: town houses, landmarks (BatchedMesh, lacquer) (`propsView/props [MeshPhysicalMaterial]`) | 2 / 131 | 518 → 518 | 46.0 → 11.6 | — pos f32 nrm f32 uv f32 col f32 → idx32 pos f32 nrm i8n uv f32 col u16n |
| 3 | old industries' ruins (merged) (`ruinsView/ruins/Mesh [MeshPhysicalMaterial]`) | 6 / 6 | 144 → 144 | 18.1 → 4.1 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 4 | scenery around: its houses (merged) (`landscapeView/landscapeView.aroundGroup/Mesh [MeshPhysicalMaterial]`) | 7 / 7 | 136 → 136 | 17.1 → 6.1 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 5 | felt: ground, rivers, sand, old streets (`landscapeView/landscapeView.feltGroup/Mesh [MeshPhysicalMaterial]`) | 32 / 32 | 122 → 122 | 11.1 → 6.1 | idx16 pos f32 nrm f32 uv f32 (same) |
| 6 | industries' yards (merged per tile) (`depotView/depotStatic/Mesh [MeshPhysicalMaterial]`) | 8 / 8 | 63 → 63 | 7.5 → 1.6 | — pos f32 nrm f32 uv f32 → idx16 pos f32 nrm i8n uv f32 |
| 7 | goods and heaps in yards and wagons (instanced) (`depotView/InstancedMesh [MeshPhysicalMaterial]`) | 58 / 190 | 28 → 28 | 7.2 → 0.9 | idx16 pos f32 nrm f32 uv f32 (same) |
| 8 | kits: big stations, halts (BatchedMesh) (`kitView/props/props [MeshPhysicalMaterial]`) | 2 / 2 | 9 → 9 | 4.8 → 2.1 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 9 | track pieces (instanced, carved) (`trackView/InstancedMesh [MeshPhysicalMaterial]`) | 58 / 269 | 378 → 378 | 3.5 → 3.5 | idx16 pos f32 nrm f32 uv f32 (same) |
| 10 | hill blocks on the land (instanced, rounded) (`landscapeView/InstancedMesh [MeshStandardMaterial]`) | 60 / 1896 | 110 → 106 | 2.7 → 2.6 | — pos f32 nrm f32 uv f32 → idx16 pos f32 nrm f32 uv f32 |
| 11 | hill blocks of the land around (instanced boxes) (`landscapeView/landscapeView.aroundGroup/InstancedMesh [MeshStandardMaterial]`) | 151 / 25692 | 674 → 630 | 2.5 → 1.9 | — pos f32 nrm f32 uv f32 → idx16 pos f32 nrm f32 uv f32 |
| 12 | scenery around: houses' textured parts (`landscapeView/landscapeView.aroundGroup/Mesh [MeshStandardMaterial]`) | 7 / 7 | 27 → 27 | 2.4 → 0.6 | — pos f32 nrm f32 uv f32 → idx16 pos f32 nrm i8n uv f32 |
| 13 | props' metal (BatchedMesh) (`propsView/props [MeshStandardMaterial]`) | 1 / 5 | 3 → 3 | 2.0 → 1.0 | — pos f32 nrm f32 uv f32 → idx16 pos f32 nrm i8n uv f32 |
| 14 | shadow stand-ins (positions only) (`landscapeView/Mesh [MeshBasicMaterial]`) | 45 / 45 | 32 → 32 | 1.9 → 1.9 | idx16 pos f32 (same) |
| 15 | trees, bushes, rocks (instanced) (`landscapeView/landscapeView.treeGroup/InstancedMesh [MeshPhysicalMaterial]`) | 99 / 3146 | 569 → 569 | 1.5 → 0.3 | idx16 pos f32 nrm f32 uv f32 (same) |
| 16 | towns' touches (`touches/Mesh [MeshPhysicalMaterial]`) | 5 / 5 | 10 → 10 | 1.3 → 0.3 | — pos f32 nrm f32 uv f32 col f32 → idx16 pos f32 nrm i8n uv f32 col u16n |
| 17 | yards' cranes and parts (`depotView/Mesh [MeshPhysicalMaterial]`) | 58 / 58 | 9 → 9 | 0.6 → 0.6 | idx16 pos f32 nrm f32 uv f32 (same) |
| 18 | yards' moving machines (`depotView/depotMoving/Mesh [MeshPhysicalMaterial]`) | 47 / 47 | 10 → 10 | 0.5 → 0.5 | — pos f32 nrm f32 uv f32 (same) |
| 19 | scenery around: shadow stand-ins (`landscapeView/landscapeView.aroundGroup/Mesh [MeshBasicMaterial]`) | 10 / 10 | 15 → 15 | 0.5 → 0.2 | — pos f32 → idx16 pos f32 |
| 20 | station signs and small parts (`landscapeView/Mesh [MeshStandardMaterial]`) | 10 / 10 | 4 → 4 | 0.4 → under 0.2 (out of the top 20) | idx16 pos f32 nrm f32 uv f32 → welded and quantised |

What's left, biggest first:

- **Hill blocks** (25,700 instanced around the land, 1,900 on it): 736k triangles, cheap in bytes (one shape each).
  Each is a chamfered box; a far version (a plain box past a few metres) would take a third of a frame's triangles off
  a wide view.
- **Trees** (3,146): 569k triangles. Their far version could be the scenery's low-detail shapes (`buildTrees(…,
  lowDetail)`, half the segments) past the far line: shared shapes, so no more memory.
- **Track** (claude/perf-4 has its far version).
- **Positions as floats** (12 of the 29 bytes a vertex left): a tile's merged mesh could keep them as normalised
  16-bit about its middle (a uniform scale on the mesh: 0.04 mm steps across a 2.5 m tile), another 8 MB.
- **Colour variants**: a catalogue house's three colour variants are three full models in the props' batch (only
  their colours differ). A palette index per vertex and a colour per variant would keep one.
- **The JS heap's copies**: three keeps every geometry's arrays after uploading them (raycasts, bounds, merging again).
  The merged scenery's could be let go once uploaded where nothing reads them again.
