# Performance: measuring, budgets, and what to check

Woodrail runs on phones. AGENTS.md's "Performance" section has the rules; this is how to measure, and the budgets that
`npm run perf:check` holds the game to.

## The harness (`tools/perf/`)

| Tool | What it does |
|---|---|
| `npm run perf -- [options]` (`tools/perf/run.mjs`) | Loads representative maps in a 390×844 phone page (DPR 2, CPU throttled 4×) and measures what a player pays for. Writes `perf.json` and `perf.md` (a table) to `--out` (default `perf-out/<time>`). |
| `npm run perf:check` (`tools/perf/check.mjs`) | A short run checked against `tools/perf/budgets.json`: `--quick` with the options in `budgets.json`'s `run` (the fresh and Sandbox maps, CPU 2×, DPR 1, a first visit only, short stretches). Exit 1 when a measure is over budget by more than its margin. About 5 min. |
| `node tools/perf/compare.mjs <before.json> <after.json>` | Two runs side by side, the main measures per map with the change: for a commit message. |
| `node tools/perf/profile-top.mjs <file.cpuprofile> [<regex>]` | The top functions of a `--profile` CPU profile, by total and self time. |
| `node tools/perf/scene.mjs [<root>] [<map file>]` | What the scene holds to draw: its biggest meshes by triangles (instances counted), what casts shadows. Use an unminified build for names. |
| `node tools/perf/threads.mjs [<s>]` | Which Chromium threads are busy while the game sits idle (a worker, the GPU process, audio). |
| `node tools/perf/idle-frames.mjs`, `idle-cpu.mjs` | Older, narrower checks: frames drawn and CPU over 20 s idle; audio threads. |
| `node tools/perf/first-download.mjs [<dist>]` | The first download: the entry script and the chunks it imports statically (what a first visit fetches before the game runs), against what loads later. `bundle.firstJsKB` in a run. |
| `node tools/perf/research-tap.mjs [--taps 4] [--trace <f>] [--profile <f>]` | The research board's tap on its own, on the late map: the tap handler's time each tap, and with `--trace` the style and layout it forces. |
| `node tools/shots/track-far.mjs [<out>]` | Track carved and in its far version, at four zooms on the Sandbox map: pictures, the pixels that differ, the triangles. |

Run them after `npm run build` (they measure `dist/`). `--root <dir>` measures another build (a directory with a
`dist/` in it): keep a copy of main's build to compare a change against it on the same machine, in the same hour.

### The maps (`tools/perf/maps/`)

| `--maps` id | Map | Made by |
|---|---|---|
| `fresh` | A new Game map (the starter line, nothing built) | the title's New game |
| `late` | The goals play-through's map at minute 440: every town on the line, farm, mill, quarry, mine, harbour, grown towns | `GOALS_LONG=1 PERF_MAP_OUT=tools/perf/maps/late-game.txt npx vitest run src/play/balance.test.ts -t "long goals"` (the player's own path) |
| `sandbox` | A big Sandbox map: seed 7 with 24 plots of land added, 24 ovals (277 pieces), 16 trains of 4 cars running | `PERF_MAPS=1 npx vitest run src/play/perf-maps.test.ts` |

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
- **Idle tick**: `Game.frame` and `onFrame` cost ~1.3 ms a tick at 4× when nothing draws (~4% of the main thread),
  many small checks; nothing large left.
