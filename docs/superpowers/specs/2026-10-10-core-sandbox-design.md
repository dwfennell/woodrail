# Woodrail — Milestone 1: Core Sandbox Design

**Date:** 2026-10-10
**Status:** Draft for review

## 1. Vision and scope

Woodrail is a 3D wooden toy railway (Brio-style, generic) that runs in the browser on desktop and mobile. It is a **light game**: an open sandbox with optional progression the player can ignore. The look is a **photoreal toy on a real floor**: lacquered beech track on a play-room floor, as if photographed with a macro lens. Everything in the world is a physical toy.

### Project decomposition

| # | Milestone | Summary |
|---|-----------|---------|
| **1** | **Core sandbox (this spec)** | Photoreal room, real-geometry track building, battery engines, couplers, hybrid derailing, save/load, desktop + mobile |
| 2 | Depots and cargo | Stations, loading/unloading, goods moving between depots |
| 3 | Progression and town | Optional goals, piece unlocks, toy-block town that grows |
| 4 | Desktop packaging | Wrap web build for desktop distribution (Steam specifics deferred) |
| 5 | Polish | Audio, more pieces, lighting presets |

### Milestone 1 success criteria

- A player can build a layout from the starter piece set using real-geometry snapping with joint play, on both desktop (mouse/keyboard) and phone (touch).
- Battery engines pull cars around the layout, respond to slopes, couple magnetically and take switches correctly.
- Derailments and collisions tumble cars realistically; the player can re-rail them.
- The scene reads as a photo of a real toy on a real floor on desktop and looks recognizably the same (less polish) on a mid-range phone.
- Layouts autosave and can be exported/imported as files.
- Performance targets in §9 are met.

### Out of scope for milestone 1

Depots and cargo, progression, town, audio, Steam/desktop packaging, multiple rooms, multiplayer, user-made models.

## 2. Platform and technology

- **Language/build:** TypeScript, Vite.
- **Rendering:** Three.js, WebGL renderer initially; migrate to the WebGPU renderer when its post-processing support is sufficient. Scene code must not depend on WebGL-only APIs beyond the renderer/post-processing setup.
- **Physics:** Rapier (WASM), loaded lazily on first derail.
- **UI:** HTML/CSS overlay with Preact or Solid (choice made in the implementation plan). No React.
- **Validation:** Zod.
- **Tests:** Vitest (unit/simulation), Playwright (end-to-end, desktop + emulated phone).
- **Mobile is first-class.** Every feature must work well with touch on a phone and with mouse/keyboard on desktop before it is done.

## 3. Architecture

Simulation is strictly separate from rendering. `track/` and `sim/` are pure TypeScript with no Three.js imports, testable in Node. The renderer reads simulation state; it never owns game state.

```
src/
  track/     Piece catalog, connectors, layout graph, snapping + joint play
  sim/       Fixed-timestep loop, trains on track, couplers, switches
  physics/   Rapier wrapper — derail mode rigid bodies only
  render/    Three.js scene, procedural piece meshes, materials, lighting, post-FX, camera, quality tiers
  input/     Pointer/touch/keyboard → editor commands
  editor/    Selection, placement, move, delete, undo/redo (command pattern)
  persist/   Save container, schema validation, migrations, IndexedDB, file import/export
  ui/        Overlay: piece tray, top bar, engine card, piece toolbar, settings
  assets/    Textures (KTX2), HDRI environment, background props
```

**Frame/tick order** (simulation at fixed 120 Hz, physics at 60 Hz, rendering at display rate with interpolation):

1. Read input → apply editor commands
2. Update switch states
3. Advance trains along paths
4. Detect couplings, collisions and derail triggers
5. Hand derailed cars to physics
6. Step physics (only if any body is awake)
7. Publish state snapshot → renderer interpolates and draws

### 3.1 Worker-ready simulation boundary

Later milestones (cargo, town simulation) will add CPU load that should not compete with rendering on phones. The simulation core is therefore designed from day one to be movable into a Web Worker without restructuring:

- **Commands in, snapshots out.** The only ways into the simulation core (`track/` + `sim/` + `physics/`) are serializable commands (place piece, flip switch, pick up car, …). The only way out is a state snapshot. No caller holds references to live simulation objects.
- **Snapshots are flat typed arrays** (e.g. one `Float32Array` of car transforms, one of piece states) plus a small change list for structural edits (piece added/removed). They are cheap to copy or transfer to another thread and need no per-frame object allocation.
- **Milestone 1 runs the core on the main thread** behind this interface. Moving it to a worker is a later, local change when profiling justifies it (and will require cross-origin isolation headers if we use `SharedArrayBuffer`).
- **Drag previews stay on the main thread.** The dragged piece's position and its snap preview are computed locally against a read-only copy of connector positions, so dragging never waits on a round-trip.

### 3.2 Hot-path rules

Code that runs every tick or every frame (`sim/`, physics sync, render sync, input) follows these rules:

- No per-tick allocation: reuse scratch vectors and matrices; no closures, spread, or array methods that allocate (`map`, `filter`) in hot loops.
- No Zod, `Result` objects, or other wrappers in hot paths; use plain discriminated unions or numeric codes.
- Spatial lookups (snapping candidates, collision candidates, picking) use a uniform-grid spatial hash, not linear scans, so cost stays flat as layouts grow into the thousands of pieces.
- Track geometry evaluation (position/tangent at distance along a path) is closed-form for lines and arcs; no iterative curve sampling at runtime.

## 4. Track system (`track/`)

### 4.1 Dimensions

Based on common wooden-rail standards; to be tuned against physical measurement.

- Track: 40 mm wide, 12 mm thick, two grooves ~6 mm wide at ~26 mm centre spacing.
- Straights: 54, 108, 144, 216 mm.
- Curves: large (~182 mm radius) and small (~90 mm radius), 45° each — eight close a circle.
- Peg: neck + round head ~12 mm diameter. Socket: matching keyhole cutout.

All dimensions live in one constants module so tuning is a single change.

### 4.2 Starter piece set

Straights ×4 lengths, large curve, small curve, Y-switch (left/right via flip), 90° crossing, ascending ramp, riser/support, bridge, stop buffer, peg-peg adapter, socket-socket adapter.

### 4.3 Piece definitions (data, not code)

Each piece type is a data record:

- **Connectors:** local position, outward direction, type (`peg` | `socket`), height.
- **Paths:** parametric curves (line, arc, or ramp-lifted line/arc) between two connectors. Straights/curves: one path. Switch: two paths sharing the entry connector. Crossing: two independent crossing paths.
- **Profile:** cross-section reference (standard grooved profile, or variants for bridge/buffer).
- **Collision shape** for physics.
- **Flippable** flag (mirrors geometry, connectors and paths).

Adding a piece type means adding a data record (and, for unusual shapes, a profile); no new code paths.

### 4.4 Layout and graph

- A **layout** holds placed pieces: type, position (x, z, base height), yaw, flipped.
- The **track graph**: pieces are nodes; seated connector pairs are edges. Each edge stores its seating error (position offset mm, angle °).
- Routing follows paths across edges. At a switch, trains entering from the shared (trunk) end take the currently selected branch; trains entering from either branch always merge onto the trunk (trailing-point behaviour, like the real toy).

### 4.5 Snapping and joint play

- A peg can seat in a socket if the connector positions are within **±1.5 mm** and directions within **±2°** (both tunable constants), at matching height (within the same tolerance).
- **While dragging**, a piece snaps to the exact seating of the nearest compatible free connector within a capture radius, so placement feels crisp.
- **On placement**, every other free connector on the piece is checked against nearby free connectors; any pair within joint-play tolerance also seats. This is how loops close.
- Seats near the tolerance limit show a subtle visible gap. Trains run over any seated joint.
- Moving a piece unseats any joints that fall outside tolerance after the move.
- Snapping returns a result value (`{ kind: "seated", error }` | `{ kind: "none" }`), never throws.

### 4.6 Height

Pieces rest on the floor or on risers. Ramps transition between heights. Connectors only match at equal height (within tolerance). Riser stacks define base height for pieces resting on them.

## 5. Trains and simulation (`sim/`)

### 5.1 Rolling stock

Milestone 1: one battery engine, coal hopper, passenger car, caboose. Each car has front and rear **magnetic couplers** with polarity (N/S). Like poles repel. Cars can be flipped to reverse polarity order.

### 5.2 Motion model

- Each car has two **bogie points** (front/rear axle) located on track paths as (piece, path, distance). The car body is positioned between them, so it cuts curves naturally and tilts on ramps.
- A **train** is a chain of coupled cars. Engines drive at ~120 mm/s nominal on level track; speed is adjusted by grade and load (number of cars), slower uphill, faster downhill.
- Light coasting with friction after the engine stops; no full inertia simulation.
- Couplers are modelled as slack-limited distance constraints (a little play) producing a gentle concertina on start/stop.
- Engine has a direction lever: forward / off / reverse.

### 5.3 Interactions

- **Coupling:** compatible poles meeting at low closing speed couple. Repelling poles stop with a small bounce. Closing speed above a threshold → collision → derail mode.
- **Switches:** tapping a switch lever flips it. Route is committed when a train's leading bogie enters the switch.
- **Dead ends:** stop buffer → gentle stop. Open end → leading car runs off → derail mode.
- **Picking up:** dragging an engine picks up its whole train; dragging a car picks up that car and uncouples it from neighbours. Dropping onto track re-rails to the nearest path; dropping elsewhere places it on the floor in derail (physics) state.
- **Track moved under a train:** the train pauses while the piece is dragged. If track remains connected under it after the drop, it resumes; otherwise the affected cars enter derail mode.

### 5.4 Determinism

Fixed timestep, no wall-clock or unseeded randomness in `sim/`. A recorded input sequence reproduces identical state.

## 6. Derail mode (`physics/`)

- **Triggers:** running off an open end; excessive speed over a near-limit joint; collision above closing-speed threshold; track removed from under a train (§5.3). Switches never cause derailment: trailing moves always merge (§4.4).
- **Hand-off:** the affected car and all cars coupled to it become Rapier rigid bodies with their current velocities.
- **Bodies:** compound collider per car (body box + wheel cylinders). Couplers become spring joints that break above a force threshold.
- **Static world:** track pieces as static colliders from their collision shapes; floor and rug as static ground. Track never moves in physics.
- **Budget:** physics at 60 Hz, ~30 active bodies max; bodies sleep at rest and physics stops stepping when nothing is awake.
- **Materials:** friction/restitution tuned for wood-on-wood and wood-on-rug (light, hollow, not bouncy).
- **Recovery:** pick up and drop a car on track to re-rail it. "Re-rail all" places every derailed car on the nearest free track.

## 7. Rendering (`render/`)

### 7.1 Scene

A sunlit play-room corner: wooden plank floor, a woven rug as the main play area, low-detail out-of-focus background props (skirting board, sofa leg, toy box edge) to sell scale.

### 7.2 Lighting

Interior HDRI (Poly Haven, CC0) for image-based lighting and reflections, plus one warm directional "window" light casting shadows. Contact shadows under every piece and car.

### 7.3 Procedural track meshes

Track geometry is generated from piece data: the groove profile is extruded along each path, ends are cut with peg/socket shapes, and edges get small bevels. Geometry is cached per piece type (and flipped variant). This guarantees visual geometry matches simulation geometry.

### 7.4 Materials (PBR)

- **Beech track:** tiling grain texture (ambientCG/Poly Haven, CC0), UVs aligned to the grain direction, satin finish, slight per-piece tint variation.
- **Painted cars:** colour base with clearcoat lacquer and subtle edge wear exposing bare wood.
- **Floor and rug:** CC0 wood and fabric textures.

### 7.5 Rolling stock models

Milestone 1 builds engines and cars procedurally from rounded boxes, cylinders (wheels) and magnet caps. The model interface allows swapping in glTF models later without changing other code.

### 7.6 Camera

Orbit around a floor target with a minimum height (never below the floor). Depth of field focused at the target. "Follow train" mode: low, toy-level chase camera on a selected engine.

### 7.7 Quality tiers

| | Desktop | Mobile |
|---|---|---|
| Shadows | 4K soft + contact | 2K + contact |
| Ambient occlusion | On | Lightweight or off |
| Depth of field | On | Off (or follow mode only) |
| Reflections | SSR on lacquer | Environment map only |
| Resolution | Native | Pixel ratio capped at 1.5–2 |
| Tone mapping, materials | Same | Same |

Tier is auto-selected from device capabilities and overridable in settings. Materials and tone mapping are identical across tiers so the toy looks the same.

### 7.8 Robustness

WebGL context loss (common when mobile apps are backgrounded) triggers a full GPU resource rebuild from simulation state, not a blank screen.

## 8. Interaction and UI (`input/`, `editor/`, `ui/`)

### 8.1 Modeless interaction

There are no build/play modes. What you touch determines the action:

| Target | Tap / click | Drag |
|---|---|---|
| Track piece | Select (shows piece toolbar) | Move piece |
| Switch lever (enlarged hit area) | Flip switch | — |
| Engine | Open engine card | Pick up whole train |
| Car | — | Pick up car (uncouples) |
| Floor | Deselect | Desktop: box-select. Touch: pan camera; long-press then drag to box-select |
| Tray item | — | Drag out new piece |

### 8.2 Placing pieces

- Dragged pieces float above the floor; on touch they float up and slightly forward so the finger doesn't cover them. A ghost shadow shows the landing spot. Nearby compatible connectors glow; the piece snaps in range.
- Release to place; a successful seat shows a small settle animation.
- **Piece toolbar** (on selection): rotate (15° steps when loose; pivot around the seated joint when connected), flip, duplicate, delete. Desktop shortcuts: R, F, Ctrl/Cmd+D, Delete/Backspace.
- Box-selected groups move together.

### 8.3 Camera controls

| | Desktop | Touch |
|---|---|---|
| Orbit | Right-drag, or Alt+left-drag | Two-finger twist/tilt |
| Pan | Middle-drag, or Shift+right-drag | Two-finger drag, or one-finger drag on empty floor |
| Zoom | Wheel | Pinch |

Rule on touch: one finger on an object interacts; two fingers always move the camera; one finger on empty floor pans, since there is nothing there to interact with. Desktop: left button interacts (left-drag on empty floor box-selects), right/middle buttons move the camera.

### 8.4 Layout

- **Piece tray:** bottom sheet on phones (swipe up, horizontal scroll), bottom strip on desktop. Pieces shown as small 3D-rendered thumbnails.
- **Top bar:** undo/redo, re-rail all, menu (save/load, settings, new layout).
- **Engine card:** direction lever, follow camera.
- Touch targets ≥44 px; primary controls in the thumb zone on phones. Works in portrait and landscape.

### 8.5 Undo/redo

Every editor action is a reversible command. History depth ~100. Train state is not part of undo history; undoing a track change that strands a train follows the same rules as moving track under a train (§5.3).

## 9. Persistence (`persist/`)

### 9.1 Format

- A save is a **zip container** (`.woodrail`) holding `layout.json` and optional binary chunks. Milestone 1 writes `layout.json` and `thumbnail.webp`. Later milestones add binary chunks (e.g. town grids) without changing the container.
- `layout.json` contains: format version, pieces (type, position, yaw, base height, flipped), joints (connector pair + seating error), switch states, trains (cars, order, polarity, path positions, engine lever), and derailed car transforms.
- Every load is validated with Zod (one source for both TS types and runtime validation). Zod failures are converted to `invalid(reason)` results, using `safeParse`, never `parse`.
- Versioned migrations upgrade old files step by step.
- No code outside `persist/` knows the on-disk format.

### 9.2 Storage

- Autosave to IndexedDB on change (debounced). Multiple named layouts.
- Export/import `.woodrail` files.
- Invalid or unreadable files produce a friendly message and never overwrite the autosave. Loading returns a result (`ok` | `invalid(reason)`), never throws for bad input.

## 10. Error handling

- Expected outcomes (no snap, invalid file, no route) are result values, not exceptions. Domain code uses plain discriminated unions; edges that can fail in several ways (file import, IndexedDB, asset loading, Rapier load) use a small shared `Result<T, E>` type in `src/lib/result.ts`. No effect-system library.
- The frame loop has a top-level guard: an unexpected exception is logged and the loop continues.
- WebGL context loss is recovered (§7.8). Rapier load failure disables derail mode gracefully (cars stop instead of tumbling) and is reported once.

## 11. Testing

- **Unit (Vitest, Node):** piece geometry and connectors; snapping and joint play (eight large curves close a circle; a loop 3 mm off does not close); switch routing in both directions; train movement and slope speeds; coupling and polarity; derail triggers; save round-trip and migrations.
- **Deterministic scenarios:** scripted input sequences run N seconds of simulation and assert positions/states.
- **End-to-end (Playwright):** drag a piece from the tray and snap it; run a train around a loop; flip a switch; import a saved file. Run on desktop and emulated phone viewports with touch.
- **Visual review:** screenshots from fixed camera angles per quality tier, for manual comparison (not pass/fail).

## 12. Performance targets

- **Desktop:** 60 fps with 300 pieces and 5 trains (30 cars) at desktop tier.
- **Mid-range phone (iPhone 12 / Pixel 6 class):** 60 fps at mobile tier with 150 pieces and 3 trains; ≥30 fps with 300 pieces.
- **Load:** interactive in under 5 s on a decent connection. KTX2-compressed textures; Rapier loaded lazily on first derail.
- **Techniques:** shared geometry per piece type, instanced/batched draw calls, merged static scenery, shadow map updates only when something moves.
- **Headroom target (simulation core):** a 2,000-piece layout with 20 trains must simulate in under 2 ms per tick on desktop, so later milestones have budget to spend.
- **Measured, not assumed:**
  - `vitest bench` benchmarks for snapping, path advancement and a full sim tick at 300 and 2,000 pieces, run in CI; a regression of more than 20% fails the build.
  - A toggleable in-game performance overlay (frame time, sim time, draw calls, triangles, physics bodies) available in all builds.
  - A deterministic "stress layout" fixture used by both the benchmarks and manual device testing.
