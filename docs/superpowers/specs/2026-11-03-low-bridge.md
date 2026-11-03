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

## With and without the double-deckers

The user would cut the double-decker coaches if that helps. They're the tallest, but only just: the electric engine's pantograph is 71.6, 0.9 lower. Headroom needed is the tallest car plus about 3.5:

| Stock | Tallest | Headroom | Dip under a one-level deck (48) | 1.5 levels (72) with a girder deck |
|---|---|---|---|---|
| All (today) | 72.5 double-decker | 76 | 28 (prototype: 30) | 0.5 short |
| No double-deckers | 71.6 electric pantograph | 75 | 27 | 0.4 to spare: not enough |
| No double-deckers, pantograph folded down to the roof (or the electric capped at 68) | 68.0 caboose | 71.5 | **24, half a level** | 4 to spare |

So cutting the double-deckers alone buys about 1 mm and makes nothing easy. The pantograph is the next limit. Cut the double-deckers and lower the pantograph (a toy pantograph folded flat, about 4 mm lower), and:

- **A gets neater:** the dip is exactly half a level (24). The underpass can be 216 long, a bridge's length: eased over 72 at each end (steepest slope 0.50, a ramp's own) and flat for 72. The trench is shallower too.
- **C becomes possible on clearance** (72 against 71.5), but only with a girder deck, and it still puts track halfway between levels. Not recommended either way.
- **A girder bridge alone at one level** never works (48 against 68).
- **D is unchanged** (it never needed the cut).

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

**A.** With all stock kept, the dip is 30 and the underpass 288 long, as prototyped. If the double-deckers go and the electric's pantograph folds down, make it **half a level (24) and 216 long** (a bridge's length), with `TRAIN_HEADROOM` 72 and the headroom test guarding 68.5. Cutting only the double-deckers isn't worth it (about 1 mm). The prototype has the underpass piece, the dip in the path, the trench, the felt hole, the girder span and the 76 mm rule (`tools/shots/low-bridge.mjs`). Pictures:

- `docs/agents/shots/low-bridge-wide.jpg`: the crossing, a train with the electric engine and two double-deckers under it.
- `docs/agents/shots/low-bridge-under.jpg`: looking along the lower line, the pantograph under the girder.
- `docs/agents/shots/low-bridge-trench.jpg`: the trench and the girder span with no train.

## Built (phase 2): option A, all stock kept

The user liked the girder look. The CoS chose all stock kept: a 30 dip and a 288-long underpass.

**Which look a bridge gets.** Only a Bridge or Curved bridge exactly one level above an underpass, with its track within the trench's width of the underpass's deep middle (`girderOver`), is a girder span. Every other bridge keeps its arches: two or more levels up, over a river or a road, a one-level bridge between raised track, or one beside an underpass rather than across it. It's worked out from the layout each time it's drawn (`Game.archFloorsOf`). Lift a girder span off its underpass and it has arches again.

**Placing.**
- A Bridge (or Curved bridge) put down one level up across a line on the ground swaps the straights under it for an underpass, in one undo step, and says "Dug an underpass so trains fit under".
- `planUnderpass` (`src/game/underpass-dig.ts`) walks the run of plain straights under the bridge and puts the underpass's middle under the crossing, on the 18 mm lattice, or a step either side when the straights left over can't be made (18 can't). It fills each side with one or two straights (`straightsFor`) and checks every new piece and the bridge with the game's own track rules.
- A loose bridge held over track stays one level up where it can dig; elsewhere it rises to two levels as before.
- The Underpass is also on the Bridges shelf, for laying by hand.
- In Game mode it's free once Bridges is learned (it's dug, not made).

**Rules.**
- Track over track needs `TRAIN_HEADROOM` (76) between bases. Over an underpass, track lines closer than half a deck plus half a car (36, not the usual 28) count as crossing.
- A bridge's supports may not stand in an underpass's trench (`trenchClash`, the "trench" refusal). A girder span's piers (14 long) must stand clear, and so must an arched bridge's viaduct (so no two-level bridge over an underpass).
- An underpass goes only on flat ground level with its ends (the "dip" refusal: "An underpass needs flat open ground, level with its ends").

**Supported and refused, as tested** (unit: `underpass-dig.test.ts`; e2e: `npm run e2e:low-bridge`, 20 checks on a 390×844 phone):

| Case | Result |
|---|---|
| Straight bridge square across a straight line, either way round, either line direction | Dug, girder span; one undo takes both back; a train with the electric and two double-deckers runs under at −30 |
| Straight bridge at 45° | Dug. Anything from 30° up digs. |
| Shallower than about 25° | Refused: "Cross the line more squarely for an underpass to fit under" (the deck would reach the underpass's slopes) |
| Curved bridge with the line under the middle of its curve | Dug, girder span. Two of the 18 mm steps along it fit: a curved bridge is only 141 long. |
| Curved bridge crossing near its end | Refused: "The bridge's end would stand in the underpass: cross the line nearer the bridge's middle" |
| A curve in the line under the bridge | Refused: "An underpass needs straight track under the bridge: this is a curve" |
| Points (or a crossing, wye, double track) under the bridge | Refused: "Points can't go in an underpass: put the bridge over plain straight track" |
| Two lines under one bridge | Refused: "Only one line can go under a bridge one level up" |
| Under 288 of straight track to dig in | Refused: "Not enough straight track here for an underpass: it needs two long straights' worth" |
| A bridge over an underpass laid by hand, off its middle | Refused: "Put the bridge over the middle of the underpass" |
| Anything else under it (a ramp, a signal piece, a station) | Refused: "Something's in the way of an underpass under this bridge" |
| A train on the straights to be dug | Refused at the drop: "A train's on the track under the bridge: move it first" (the editor's train check; not covered by a test yet) |

**Costs** (e2e, headless, software GL): a plan on a pointer move 0.32 ms. The felt sheet cut again for 3 underpasses 0.36 ms, only when the set of underpasses changes. 0 frames drawn idle with underpasses and girder spans standing.

**Not done yet:**
- Draw still crosses a line two levels up. Teaching it "one level up and dig" is the next step.
- An underpass in a hill or under a road is refused, not cut.
- A straight laid by hand under an existing one-level bridge isn't swapped (use the Underpass from the shelf).
- Signals on the dug straights' joints aren't carried over (the swap is refused only for trains).
