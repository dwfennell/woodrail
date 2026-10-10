# Visual & Feel Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Woodrail read as a macro photo of real wooden toys on felt, and make building feel tactile and fluid.

**Architecture:** Pure, unit-tested helpers (tweens, outline tracing, placement/framing maths, drop outcome) drive
thin Three.js/DOM layers. Scenery moves to instanced meshes under `src/render/dressing/`; camera behaviour moves to
`src/game/camera-director.ts`; transient animations live in a per-frame `Flourishes` runner.

**Tech Stack:** TypeScript, Three.js 0.18x, Vite, Vitest, Web Audio (synthesised), agent-browser for visual checks.

**Spec:** `docs/superpowers/specs/2026-10-10-visual-polish-design.md`

## Global Constraints

- Mobile first-class; everything works by touch. Phone tier gets the lighter variant of every effect.
- Frame time must not regress more than ~10% per tier. Baseline (headless, starter map, 1440×900):
  mobile 3.3 ms / high 7.4 ms, 358 draws, 307k tris (measured with `scratchpad/perf.js`).
- No per-frame allocations in new per-frame code (tweens, director, flourishes).
- No audio files: all new sounds synthesised in `ToyAudio`.
- No thrown errors for control flow; no leftover console logs.
- Plan specifies interfaces, algorithms and tests; code is written test-first during execution (same ruling as the
  landscape plan).

## Review Focus

1. Interrupting animations: starting a new drag / undo / new map while a settle, wobble or fly-in is running must
   leave no orphan meshes and the layout must equal the editor's state. (Task 7 test: `Flourishes.clear` disposes.)
2. Touch: double-tap focus must not fire on two quick single taps on different objects, nor during pinch.
   (Task 6 test: `isDoubleTap` distance/time window.)
3. Camera never ends below the mat or beyond max distance after focus/fly-in/edge pan. (Task 6 test: clamp.)
4. Muted state persists across reload and new sounds respect it. (Task 9 test: `loadMuted`/`saveMuted`.)
5. River/road ribbons on map edges and single-cell spurs still cover exactly their cells. (Task 2 test.)

---

### Task 1: Tween & spring helpers

**Files:** Create `src/lib/tween.ts`, `src/lib/tween.test.ts`

**Interfaces — Produces:**
- `easeOutCubic(t)`, `easeInOutCubic(t)`, `easeOutBack(t, overshoot = 1.4)` — `t` clamped to [0,1].
- `damp(current, target, lambda, dt): number` — frame-rate independent exponential approach.
- `class Spring { value; velocity; constructor(stiffness, damping); step(target, dt): number; settled(target, eps): boolean }`
  (semi-implicit Euler, sub-stepped at ≤1/120 s).

- [ ] Tests: eases hit 0 and 1 at ends and clamp outside; `easeOutBack` peaks above 1 by < 0.12 at default;
      `damp` with dt split into 1×1/30 vs 2×1/60 gives the same result (±1e-9); an underdamped spring
      (k=600, c=18) from 0→1 overshoots by < 15% and settles within 0.6 s; a critically damped spring never exceeds 1.
- [ ] Run RED, implement, GREEN, commit `feat(lib): tween and spring helpers`.

### Task 2: Felt mat & felt ribbons

**Files:** Create `src/landscape/outline.ts` (+test), `src/render/dressing/felt.ts`; modify `src/render/textures.ts`
(felt: finer fibre bump + low-frequency mottling in map), `src/render/materials.ts` (sheen 0.9, hem material),
`src/render/landscape-view.ts` (use dressing).

**Interfaces — Produces:**
- `traceRegions(mask: (col,row)=>boolean, cols, rows): {x:number;z:number}[][]` — closed outer boundary loops
  (cell-corner coordinates in grid units, CCW), one per 4-connected region, holes as separate loops (CW).
- `smoothLoop(loop, iterations = 2): loop` — Chaikin corner cutting.
- `buildFeltMat(mats): Group` — 4 mm rounded slab + darker hem strip (inset 10 mm, raised 0.3 mm) with dashed
  stitch texture.
- `buildFeltRibbons(grid, surface, material, thickness): Mesh` — ExtrudeGeometry from smoothed loops (world mm),
  bevelled 0.6 mm, top at `thickness`.

- [ ] Tests: on a 6×5 mask with an L-shaped region and a single isolated cell, `traceRegions` returns 2 loops and a
      point-in-polygon test classifies every cell centre correctly; region touching the grid edge traced along the
      edge; for 50 generated maps, every river cell centre is inside a smoothed river loop and every non-river cell
      centre whose 8 neighbours are all non-river is outside (smoothing only bites corners).
- [ ] Implement; replace per-cell river/road boxes in `LandscapeView`. Screenshot desktop close-up; commit
      `feat(render): felt mat with hem and smooth felt rivers and roads`.

### Task 3: Wooden blocks

**Files:** Create `src/render/dressing/blocks.ts` (+ `blocks.test.ts` for the pure part); modify `landscape-view.ts`,
`materials.ts` (painted-grass top: satin, roughness 0.55, clearcoat 0.25, colour over grain).

**Interfaces — Produces:**
- `blockInstances(grid, seed): { x; z; y; tone: number }[]` — one per cell per level (y = level base), tone in
  [0, BLOCK_TONES.length) chosen by hash of (col,row,level,seed).
- `buildBlocks(grid, seed, mats): Group` — two InstancedMeshes (wood body with 3 mm rounded edges, grass cap)
  with `instanceColor` from `BLOCK_TONES` (4 beech tones); UVs scaled so grain runs horizontally on sides.

- [ ] Tests: instance count equals Σ heights; tones deterministic per seed and at least 3 distinct tones on the
      starter map; every instance y = (level−1)·RISER_HEIGHT.
- [ ] Implement, replace slab-merged blocks (physics still uses `hillSlabs`). Perf check (draws must drop or hold).
      Commit `feat(render): individual rounded wooden blocks with tone variation`.

### Task 4: Turned-wood trees, wooden houses, station sign

**Files:** Create `src/render/dressing/trees.ts`, `src/render/dressing/buildings.ts`, `src/landscape/sign.ts` (+tests);
modify `landscape-view.ts`.

**Interfaces — Produces:**
- `treePlacements(land): { x; z; y; kind: "fir"|"ball"; scale; lean; leanDir; tint }[]` — deterministic, jitter
  ≤ 14 mm, lean ≤ 0.05 rad, scale 0.8–1.2.
- `buildTrees(placements, mats): Group` — InstancedMeshes: lathe-profile tiered fir crown, sphere crown, dowel trunk,
  round base disc (r 14 mm, 4 mm). Crowns lacquered with per-instance tint.
- `buildTowns(land, mats): Group` — houses with recessed window/door frames (inset geometry), roof overhang 5 mm,
  chimney when hash says so; toy palette walls.
- `signPose(town): { x; z; heading }` — sign on the platform side, beyond the platform's far edge from the track.

- [ ] Tests: placements within ±14 mm of cell centre and lean bound; same seed ⇒ identical placements; for 200 seeds
      the sign's 84×3 mm footprint (with 4 mm margin) is not inside `inStationFootprint`-track band (|lateral| <
      TRACK_WIDTH/2 + 4) and does not overlap any track piece's samples (`checkPlacement`-style sampling against
      the layout's station piece).
- [ ] Implement; commit `feat(render): turned-wood trees, painted wooden houses, sign beside platform`.

### Task 5: Light, grounding & grade

**Files:** modify `src/render/room.ts` (remove toy box; sun `#ffd2a1`, intensity 4.6, elevation ~32°; shadow radius
2.5; `fitShadow` called from director with radius from camera distance), `src/render/post.ts` (GTAO radius 12,
thickness 5, blend 1.0; grade in LensShader: lift shadows warm, slight S-curve, warmth; vignette 0.78),
create `src/render/dressing/contact.ts` (mobile-tier blob shadows: one InstancedMesh of quads with radial texture
under blocks edges/trees/houses).

**Interfaces — Produces:** `shadowRadiusFor(cameraDistance): number` = clamp(distance·0.9, 500, 2200).

- [ ] Tests: `shadowRadiusFor` clamps and is monotonic.
- [ ] Implement; screenshots both tiers; perf check; commit `feat(render): warmer low sun, tight shadows, contact
      grounding and colour grade`.

### Task 6: Camera director

**Files:** Create `src/game/camera-director.ts` (+test); modify `game.ts` (delegate follow/frameLayout/update),
`interaction.ts` (double-tap focus, edge-pan during drag), `main.ts` (fly-in on boot/new map).

**Interfaces — Produces:**
- `frameDistance(radius, fovDeg, aspect): number` — distance fitting a sphere.
- `clampView(target, position, minDist, maxDist, maxPolar)` — keeps camera above mat & within range (in place).
- `edgePan(x, y, w, h, zone): {dx, dy}` — normalised −1..1 push, zero outside the zone, quadratic ramp.
- `isDoubleTap(prev: {t,x,y}|null, now: {t,x,y}, maxMs = 300, maxPx = 24): boolean`.
- `class CameraDirector { constructor(camera, controls); flyIn(from, to); focus(point, radius); follow(obj|null);
   zoomAt(screenX, screenY, deltaY); edgePanFor(x, y, dt); update(dt): void; get busy(); cancel() }` — all
   transitions use `Spring`/eases from Task 1; any user camera input calls `cancel()`.

- [ ] Tests: frameDistance fits (sphere tangent to the narrower frustum side); clampView corrects a below-mat
      position and over-max distance; edgePan zero in centre, ±1 at the edges, symmetric; isDoubleTap rejects
      320 ms and 30 px apart.
- [ ] Wheel zoom toward pointer replaces OrbitControls zoom (`controls.enableZoom = false` for wheel; pinch kept);
      fly-in from whole-mat framing to the starter train over 2.2 s, skipped on any pointerdown/wheel/key.
- [ ] Commit `feat(camera): director with fly-in, double-tap focus, eased zoom, edge pan, eased follow`.

### Task 7: Held-piece feel (lift, carry, snap ease, settle, refusal, delete)

**Files:** Create `src/game/drop.ts` (+test), `src/render/flourishes.ts` (+test), `src/render/dust.ts`;
modify `interaction.ts`, `track-view.ts` (`heldMesh(type, flipped)` real wood + rim material), `materials.ts`
(rim glow via `onBeforeCompile` fresnel term, uniform colour/strength).

**Interfaces — Produces:**
- `dropOutcome({ blocked, overTray, isNew }): "place" | "return" | "to-tray" | "delete"`.
- `class Flourishes { add(f: Flourish); update(dt); clear(); get count }`, where
  `Flourish = { update(dt): boolean /* false when done */; dispose(): void }`.
- Flourish factories: `settle(mesh, from, to)` (spring y + tiny overshoot), `wobbleBack(mesh, from, to, onDone)`,
  `shrinkAway(mesh, toward)`, `dustPuff(scene, x, y, z)` (≤ 12 sprite particles, pooled).
- Held mesh: lifted 12 mm (eased 120 ms), lag via `damp(λ=24)`, tilt ≤ 2° from velocity, snap transition eases
  over ~80 ms; rim colour green when snapped, red when blocked, none otherwise.

- [ ] Tests: dropOutcome table (blocked new → to-tray, blocked moved → return, over tray new → to-tray, over tray
      moved → delete, clear → place); Flourishes removes finished items and `clear()` disposes all pending;
      settle flourish finishes within 0.5 s of simulated dt and leaves mesh at exact target.
- [ ] Layout edits still happen immediately on drop (animation is cosmetic: the real piece is hidden until the
      settle flourish completes, then shown). Commit `feat: tactile piece lift, snap ease, settle, refusal wobble`.

### Task 8: Selection, rotate/flip animation, cards

**Files:** modify `track-view.ts` (selected piece: outline via back-face shell + 4 mm hover), `interaction.ts`
(rotate/flip triggers a 120 ms turn flourish on the piece's instance), `src/style.css` (cards slide/fade, button
press scale).

- [ ] Test: `turnFlourish` interpolates heading along the shortest arc and ends exactly at the target.
- [ ] Commit `feat: animated selection, rotate and flip; card transitions`.

### Task 9: Tray, top bar, toasts, welcome, sound

**Files:** Create `src/render/thumbnails.ts`, `src/ui/prefs.ts` (+test); modify `hud.ts`, `icons.ts`, `style.css`,
`audio.ts`, `main.ts`.

**Interfaces — Produces:**
- `renderThumbnails(renderer, mats, types): Map<PieceTypeId, string>` — one offscreen 128² render per type (3/4
  view, warm light), returned as data URLs; train items likewise from car models.
- `loadMuted(): boolean`, `saveMuted(m)` (key `woodrail.muted`, try/catch).
- `ToyAudio`: `pickup()`, `putdown(snapped)` (pitch ±6% random), `rotate()`, `tap()`, `refuse()`.
- Hud: `setRerailVisible(b)`, `setMuted(b)`, sound toggle handler `toggleSound`, `pulseSigns` via callback,
  `haptic(kind: "snap"|"refuse")` → `navigator.vibrate?.(…)`.

- [ ] Tests: `loadMuted` defaults false, round-trips, survives throwing storage.
- [ ] Tray: wooden finish, wooden tabs, thumbnails, edge fades + 18% peek of next item; top bar SVG icons for
      undo/redo/pause/play/sound/menu; Re-rail hidden unless a train is derailed; toasts as paper labels sliding up;
      connection toast pulses both signs (`LandscapeView.pulse(ids)`); welcome = three illustrated tips + "More help".
- [ ] Screenshots desktop + 390×844; commit `feat(ui): wooden tray with 3D thumbnails, clearer top bar, sound toggle,
      paper toasts, shorter welcome`.

### Task 10: Final verification

- [ ] `npm test`, `npm run typecheck`, `npm run build`; perf on both tiers vs baseline (≤10%); agent-browser
      before/after screenshots; whole-branch review by a fresh reviewer; fix Critical/Important with RED→GREEN.
