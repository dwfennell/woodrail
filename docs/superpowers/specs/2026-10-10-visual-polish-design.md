# Visual & Feel Polish — Design

**Date:** 2026-10-10 · **Status:** approved (user delegated spec approval)

## Intent

The user wants "realism and nice flow". Flow means moment-to-moment feel (dragging, snapping, camera, feedback),
not onboarding. Realism means it should read as a macro photograph of real wooden toys on a felt mat on a floor,
not a low-poly game. Mobile stays first-class; performance must not regress more than ~10% frame time per tier.

## 1. Look

- **Felt mat:** stronger fibre micro-texture plus broad low-frequency colour mottling; higher sheen; 4 mm thick slab
  with rounded edge and darker stitched hem. Rivers and roads become smooth felt ribbons (one mesh per river/road,
  rounded outline traced from the cell mask) sitting ~1 mm above the mat, replacing per-cell tiles.
- **Blocks:** rounded-edge (≈3 mm) instanced blocks, side grain, per-block tone variation from a small palette via
  instance colour; grass tops are painted wood (grain visible, satin), not glossy.
- **Trees:** turned-wood toys — tiered fir (lathe profile) and lacquered ball-on-dowel — on a round wooden base,
  random small lean / scale / colour; instanced.
- **Houses & stations:** painted wooden blocks with recessed windows/doors, overhanging roofs, chimneys on some,
  toy palette. Town name sign stands beside the platform, never over station track (bug fix).
- **Light & grade:** warmer, lower sun; shadow frustum tight around the camera target; stronger contact grounding
  (tuned GTAO on high tier; baked blob shadows under blocks/trees/houses on mobile); filmic tone mapping with
  slight warmth, vignette, fine grain; DOF focus follows camera target.
- **Clutter:** remove the toy box and lid.

## 2. Feel

- **Carry:** held pieces lift ~12 mm with ease-out and cast a spread shadow; slight positional lag and tilt
  (≤2°) toward motion. Held piece renders as real wood with a green (snap) / red (blocked) rim glow instead of a
  translucent ghost; reason toast retained.
- **Snap & drop:** preview eases into snapped pose (~80 ms). Drop settles with a small spring overshoot, a
  pitch-varied wooden clack and a felt-dust puff at the joint. Refused drop wobbles and floats back to its origin
  (or back to the tray for new pieces). Delete lifts and shrinks away.
- **Select:** soft outline + gentle hover on the selected piece; rotate/flip animate (~120 ms); context cards
  slide/fade in; buttons have press feedback.
- **Camera:** eased wheel/pinch zoom toward the pointer; double-tap/double-click focuses and frames the thing
  under the pointer (piece, train, town, mat point); edge-pan while dragging near screen edges (larger zones on
  touch); opening fly-in from whole mat to starter train, skippable by any input; follow eases in/out at a lower
  angle.
- **Feedback:** tray uses 3D-rendered thumbnails of real pieces with scroll fades and a peeking next item; toasts
  slide up as paper labels; connection toast pulses both station signs; soft synthesized UI/wood sounds; sound
  on/off toggle (persisted per viewer); haptics on snap and refusal where supported.

## 3. UI chrome

- Top bar: clearer undo/redo icons, Re-rail only visible while something is derailed, stateful pause/play,
  sound toggle, clean collapsed title on phones.
- Tray: light wooden finish, wooden tabs.
- Welcome: three illustrated tips (Build / Run / Look around) + "More help" for the full list.

## Architecture

- `src/lib/tween.ts` — allocation-free easing + critically-damped/underdamped spring helpers.
- `src/game/camera-director.ts` — fly-in, focus framing, follow, edge-pan, eased zoom (owns OrbitControls tuning).
- `src/render/dressing/` — instanced trees, houses, blocks, felt ribbons (keeps `landscape-view.ts` small).
- `src/render/thumbnails.ts` — one-shot offscreen render of piece thumbnails for the tray.
- Interaction gains a small "held piece" animator; refusal vs acceptance decided by a pure function.

## Testing

Unit: tween/spring convergence and overshoot bounds; camera framing maths; drop outcome function; sign never
overlaps station track across 200 seeds; felt-ribbon outline covers exactly the river cells. Visual: agent-browser
before/after screenshots desktop + 390×844. Perf: frame time on both tiers, ≤10% regression. One fresh
whole-branch review at the end.

## Out of scope

Guided tutorial, landscape editing, economy, named saves, IBL/HDRI lighting.
