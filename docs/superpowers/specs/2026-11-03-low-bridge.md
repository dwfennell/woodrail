# Low bridges: track under a one-level bridge

Phase 1: measurements, options and a prototype (branch `claude/low-bridge`). Not built out yet.

The user: "our bridges don't let a track pass under with only one level. One is too short but two is too high… I don't really want to raise the height of the levels."

## Measurements

All heights from the track's base (y = 0 under the wheels' track), mm.

- **A level** (`RISER_HEIGHT`): 48. Track is 12 thick.
- **A bridge** is track whose base is its deck, on a painted viaduct down to the ground. Its arches' crowns are 12 below the deck (`ARCH_CROWN_DROP`), radius up to 41 (`ARCH_RADIUS` × 216), shrunk to spring above the ground. At one level an arch opening is 36 high and about 64 wide; at two levels, 84 high.
- **The cars**, measured from the Blender models (`src/render/train-headroom.test.ts` now guards this): double-decker coach **72.5**, electric engine (pantograph) 71.6, caboose 68.0, classic engine (chimney) 66.7, tank/diesel/goods engines 64.7, dining 61.0, cleaner 59.9, sleeper 59.5, express 58.6, coach 58.5, bay-window caboose 57.0, van 56.5, hopper heaped 53.6, milk tanker 50.9, timber wagon 47.4 (logs on top to check). No catenary, no crane wagons.
- **The rule now** (`findLowCrossing`, the "headroom" refusal in `trackBlock`): track over track needs `TRAIN_CLEARANCE` = 96 (two levels) between their bases; any gap between 2 and 94 is refused. Bridge viaducts are also solid but for their arch openings (`findOverlap` with `arches`).
- **How short one level falls:** 48 against 72.5 is **24.5 short** at the deck (28 with a few mm to spare), and 36.5 short under a one-level arch (36). Two levels leave 23.5 at the deck and 11.5 under the arch. So 1.5 levels (72) would still be 0.5 short.

## Options

### A. Underpass: the lower line dips into the board, the bridge over it is a girder span (recommended)

- **Piece:** `underpass`, a straight 288 long (two 144s) whose middle sinks 30 mm into the board: eased down over 96 at each end (steepest slope 0.47, a ramp's is 0.50), flat for 96 under the bridge. Both ends at the ground, so it fits the level lattice like any straight. It sits in a wooden trench, its rim just proud of the felt.
- **Bridge:** one level up over an underpass's dip, a bridge is drawn as a girder span: no arches, a pier at each end, a red side plate along each side, nothing below the deck (that's the headroom).
- **Rule:** `TRAIN_HEADROOM` = 76 between bases (the tallest car, 72.5, and 3.5 to spare) instead of 96. Whole levels behave exactly as now (48 refused, 96 fine); only a dip opens a one-level crossing (48 + 30 = 78).
- **Placement UX (to build):** it should just work. A bridge dropped (or drawn) one level up across ground track that's straight there swaps the straights under it for an underpass, as one undo step, with a toast ("Dug an underpass so trains fit under"). The underpass is also on the Ups & downs shelf for laying by hand. Draw prefers one level up plus an underpass when the line it crosses is straight there: two ramps on the upper line instead of four.
- **Routing and sim:** no change. The path's height and slope come from `samplePath` (a `dip` on a line), so cars pitch down and up through it as on a ramp. Speed is unchanged (slopes don't change speed). Prototype: all four cars ran through at −30 under the deck.
- **Saves:** a new piece type. Old saves load as before; a save with an underpass in it needs this version.
- **Cost:** small. One piece, one path option, a trench in the carved geometry, a hole in the felt sheet (rebuilt only when the underpasses change), a girder variant of the bridge support (keyed like the arch variants).
- **Risks:** only on flat felt for now (not in hills, rivers, roads; the prototype refuses off level ground as "hill"). Shadows and AO in the trench. The felt hole must stay incremental (it rebuilds one sheet today). Draw and the auto-swap need e2e on the player's path. The girder look needs a design pass.

### B. A thin girder bridge with a clearance rule from the tallest car

On its own it can't work: one level is 48 and the tallest car 72.5, however thin the deck. It's the bridge half of A.

### C. A half-level ramp or riser step (a 1.5-level crossing)

72 is still 0.5 short of the double-decker, even with no deck at all, so the tallest cars would need trimming too. And track at 24 or 72 sits halfway between levels: snapping takes ends within half a level (`SNAP_HEIGHT_TOLERANCE` = 24), and risers, support, hills and cuttings all assume whole levels. Not recommended.

### D. A full-level dip under the existing arched bridge

The lower line sinks a whole level (−48) under a normal one-level bridge. The old 96 rule holds and the arches stay (a car's top at 24.5 under an arch about 31.7 high at the car's edge). But the trench is 48 deep, deeper than track is wide, so from the camera's angle trains vanish into it. The piece is about 360 long to keep a ramp's grade, and the line must thread an arch opening. This is the fallback if we don't want a girder look.

### E. Auto-dip: the lower track sinks by itself wherever a one-level bridge passes over

No new piece in the tray, but a placed piece's shape (and its path, joints and save) would depend on what's above it. That's much riskier for the sim, snapping and saves. A's auto-swap gives the player the same "it just works" with an ordinary piece.

## Recommendation

**A.** The prototype has the underpass piece, the dip in the path, the trench, the felt hole, the girder span and the 76 mm rule (`tools/shots/low-bridge.mjs`). Pictures:

- `docs/agents/shots/low-bridge-wide.jpg`: the crossing, a train with the electric engine and two double-deckers under it.
- `docs/agents/shots/low-bridge-under.jpg`: looking along the lower line, the pantograph under the girder.
- `docs/agents/shots/low-bridge-trench.jpg`: the trench and the girder span with no train.
