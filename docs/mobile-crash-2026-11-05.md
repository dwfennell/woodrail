# Mobile crash on a Pixel 10 (itch.io, v1.1.0): what was measured, 2026-11-05

Report: players on itch.io say the game crashes on a Pixel 10 (Android, Chrome; a 1080×2424 screen, DPR about 2.6).
No device, no logs, no detail of when or what "crash" means. This is what could be measured without one, what was
changed, and what we'll learn next (crash reports).

## How it was measured

Headless Chromium (SwiftShader) emulating the phone: a 412×915 page at DPR 2.625, touch, mobile, a Pixel 10 user
agent, CPU throttled 2×, `--enable-precise-memory-info`. Scripts (in `tools/perf/`, run against a build's `dist/`):

- `gpu-soak.mjs <root> <late|sandbox> <minutes> <out.json>`: GPU memory as WebGL is asked for it (`gltrack.js` wraps
  every `texImage2D`/`texStorage2D`, `renderbufferStorage*` and `bufferData`, and their deletes: the bytes each
  texture, renderbuffer and buffer holds), plus the canvas's own buffers, the JS heap after a GC, three's counts; at
  load and every minute of play (pans, zooms, a piece laid and taken up), then a `WEBGL_lose_context` loss and restore.
  `DPR=1` for long runs, `LEAN=1` for the lean settings, `GL_STACKS=1` (with an unminified build) for who allocated.
- `rebuild-leak.mjs <root> <map> <rounds>`: pieces laid and taken up (track rebuilds), zoom out and back, many times
  over; geometries, textures, programs, GPU bytes, V8 heap and ArrayBuffers before and after.
- `heap-growth.mjs`: what the JS heap holds (V8 objects vs ArrayBuffers), and the sampling heap profiler's live
  allocations by where they were made.
- `gl-errors.mjs`: which draws the browser refuses, by program, with the textures bound to its samplers.

The maps are the perf harness's `late` (440 game minutes, the goals play-through's) and `sandbox` (277 pieces, 16
trains). SwiftShader is software: GPU memory is what WebGL allocates (a real driver adds its own overhead on top), and
times are not a phone's.

v1.1.0 and main draw the same way: `quality.ts`, `post.ts`, `stage.ts` and `resolution.ts` are unchanged between
them, and `game.ts` only gained shader warming. What's below holds for both.

## What it costs on a Pixel 10 (main, before)

The pixel ratio is already capped (mobile tier: 2, stepping down to 1.5 if frames are slow), so the drawing is
824×1830. On the late map, at load:

| GPU (WebGL allocations) | MB |
| --- | ---: |
| scene target, 4× MSAA half-float colour (renderbuffer) | 46 |
| its 4× MSAA depth | 23 |
| scene target resolved (half-float) | 11.5 |
| composer's buffer (half-float), only copied through on the mobile tier | 11.5 |
| scene depth texture, read by nothing on the mobile tier | 5.8 |
| shadow map 2048² (depth 16 + an unused colour attachment three makes, 16) | 32 |
| environment map (PMREM) 6, plus its working target kept for nothing, 6 | 12 |
| other textures (wood, felt, labels…) | ~18 |
| geometry buffers (2869) | 140 |
| **tracked total** | **325** |
| canvas (front, back, depth) | ~17 |

JS: `usedJSHeapSize` 291 MB at load, and about 350 MB once the background build (surroundings, scenery) has finished.
V8's own objects are only about 50 MB of that: 243 MB is ArrayBuffers, 141 MB of them three's CPU copy of the
scene's geometry (the same bytes as the GPU buffers), and the rest the game's caches. The big Sandbox map: 483 MB at
load, 503 MB once settled.

So a late map holds about 650–700 MB between the tab and the GPU process, and a big Sandbox map more. On Android,
graphics memory is in the same RAM, and Chrome's renderer and GPU processes are killed by the system when memory runs
short: a tab killed while showing is "Aw, Snap" or a reload; a GPU process killed (or a driver reset) is a lost WebGL
context.

### Leaks: none found

- **Long play** (Sandbox map, 16 trains, 25 min, DPR 1; under SwiftShader the sim covers only ~47 s of game time in that
  time): the heap settles at 503 MB by minute 7 and stays there (503.2 → 503.9 MB over the next 16 min); GPU bytes and
  three's geometries flat after the first minutes (new objects coming into view the first time).
- **Rebuilds** (late map, 180 pieces laid and undone, 12 zoom-outs): geometries 684 → 685, textures 48 → 48, programs
  66 → 66, GPU 267.1 → 267.4 MB, ArrayBuffers 317.7 → 318.4 MB, V8 34.7 → 40.1 MB. WebGL buffer objects grew in count
  (first uploads of shadow casters and tiles first seen on the zoom-outs), not in bytes.
- **Rapier**: no longer in the game (no WASM). The models (6 `.glb`, 5.5 MB with meshopt) decode once; their peak is
  small against the above.

### Context loss: not handled

There was no `webglcontextlost` handling of the game's own. three asks for the context back and uploads geometry and
textures again when it comes, but:

- what was drawn into render targets is gone: the **environment map** (PMREM) came back empty;
- three makes a **new shadow map renderer** on restore, dropping the stage's hook on it (the shadow-only stand-ins for
  track pieces);
- if the browser **doesn't give it back** (the usual case after a GPU process crash on a phone), the picture stays
  frozen or black with nothing to say why or what to do. To a player, that's a crash.

### Also seen

- **Frame 0's refused draws**: on the very first frame (behind the loading cover) the game skips the shadow pass (to
  save compiling every depth shader twice), so every shadow-receiving draw has a `sampler2DShadow` bound to three's
  plain empty texture: Chrome refuses about 440 draws with `GL_INVALID_OPERATION: Mismatch between texture format and
  sampler type`. Only that frame, never after (`gl-errors.mjs`), and it draws nothing anyone sees. Left as it is.
- On this emulator the resolution governor steps the pixel ratio down to 1.5 within minutes; a Pixel 10's GPU probably
  holds 2.

## What changed (commit 1: memory and context loss)

- **Mobile tier draws straight from the scene's target** (`post.ts`): with no ambient occlusion or depth of field
  there's nothing between the scene and the lens pass, so the lens reads the scene's own target and draws to the
  screen. No composer: its buffer and the full-screen copy into it are gone, and no depth texture is resolved (a
  depth buffer instead). The same picture. Desktop (high tier) is unchanged.
- **PMREM's working target freed** after the environment map is made (`stage.ts`): 6 MB.
- **Lean settings** (`quality.ts` `leanOf`) for the mobile tier when the phone reports 4 GB or less
  (`navigator.deviceMemory`), or when this device's drawing was lost in the last 3 days (`noteContextLost`): pixel
  ratio at most 1.5, a 1024 shadow map, 2× multisampling. The desktop tier never goes lean.
- **Context loss handled** (`game.ts`, `main.ts`, `ui/context-lost.ts`): on a loss the railway is saved at once and the
  device marked lean; nothing is drawn meanwhile. If the context comes back, the environment map is made again, the
  shadow hook put back, and the game draws on. If it isn't back in 2.5 s, a card: "The picture stopped. Your device ran
  short of memory for the game's picture. Your railway is saved. **Tap to reload**", which reloads straight into play,
  lean.

| Late map, Pixel 10 page | GPU tracked | canvas |
| --- | ---: | ---: |
| main | 325 MB | 17 MB |
| this branch | 300 MB | 17 MB |
| this branch, lean | 219 MB | 10 MB |

Tested: `npm run e2e:gl-lost` (lost and back: draws again, no card; lost for good: the card, Tap to reload, back in
play with the railway kept, lean at 1.5 and a 1024 shadow map; 0 idle frames before and after), unit tests for the lean
choice (`quality.test.ts`).

## Crash reports (commit 2, to approve before it ships)

We still don't know what the Pixel 10's crash is: memory (most likely, from the above), a driver fault on its new GPU,
or something else. Errors on players' phones never reached us. Commit 2 adds a small crash report through the feedback
Worker (`POST /crash`): on an uncaught error or rejection, or a lost context, at most one a session, holding only the
message and stack, the build, the user agent, the screen's size and DPR, the pixel ratio and the tier. No map, no save.
An opt-out line in ☰ ("Crash reports: on/off"). See `docs/feedback.md`, "Crash reports". It needs the Worker deployed
with `crash.ts` (no new secret).

## Not done, worth doing

- **Geometry arrays kept on the CPU** (141 MB on the late map): three keeps every attribute's array after uploading
  it. Much of it may be needed (picking, placement, BVH), but freeing what isn't (say, scenery and land tiles after
  upload) could halve the JS side.
- **The shadow map's unused colour attachment** (16 MB at 2048², 64 MB at the desktop's 4096²): three makes one for
  every shadow map; a depth-only target would need a patch to three's `WebGLShadowMap`.
- **The other ~100 MB of ArrayBuffers** outside the scene (caches): not looked into yet.
- A real Pixel 10 (or any PowerVR phone) through `chrome://inspect`, once crash reports say when it happens.
