# Draw N2: junctions, crossings, loops, ramps and bridges in a drawn line

Status: proposed (design only). Branch `claude/draw-n2-design`. Follows
[2026-10-15-draw-track-design.md](2026-10-15-draw-track-design.md) (N1).

## Why

Players say Draw "works well! The next level would be it using available junctions, ramps and bridges." Today a
drawn line uses only plain straights and the three curves (`DRAW_TYPES` in `src/track/draw-path.ts`), stays at the
height it started at, and stops at a red ghost when anything is in the way. A hill shows "The hill is a level up
here: add a ramp before it". A river shows "Needs a bridge over the river". Other track shows "Another piece is in
the way". And you can't start a line from the middle of a line at all. N2 has the line put in the piece the player
would reach for anyway, from the tray, but only where the way is blocked or the player clearly meant it.

## Rules that hold for all of it

- **Only on need.** A ramp, bridge, switch or crossing comes in only when a plain piece the scorer chose is refused
  for the matching reason (`hill`, `river`, `unsupported`, `piece`), or when the stroke starts on a line's body.
  None of these pieces goes into `DRAW_TYPES`, so the scorer never picks one on open ground.
- **Under the finger.** A special piece is laid only where its far end still scores on the stroke, under the same
  limits as any other piece. If it doesn't fit there, the ghost stays red with today's message.
- **Same supply.** Each special piece goes through `DrawOptions.allow` (Game mode: `pieceStock` in `main.ts`, which
  returns 0 for a piece not learned yet and the toy-box count otherwise). If the piece the line needed is missing,
  `DrawLine.refused` is set, and DrawHand already says "Out of …" (`pieceName`), or "No … left: the line used other
  pieces" when you lift. A piece that isn't learned shows the tray's wording instead: "Switch: not learned yet".
  In Game mode, switches and bridges (ramp, riser, bridge, curved bridge) are known from the start (`STARTING_BOARD`).
  The three-way switch, crossings and balloon loops need `junctions`. In Sandbox, everything is available.
- **One undo.** A line that takes up existing track takes it up in the same undo step as the line itself.
- **Nothing is checked twice.** `DrawOptions.check` gives back the reason code as well as the message. (Today it
  gives only the message string, so the line can't tell a hill from a river.)

## 1. Ramps (phase 1)

**Up.** The chosen piece is refused with `hill` (from `checkPlacement`: below the ground, and not a ramp that may
cut there). `levelsAbove` then says how far up the hill is.

- If it is one level up, try a `ramp` (144 mm, rising `RISER_HEIGHT` 48 mm) seated on the line's end, along its
  heading, then a ramp seated one piece back when the last piece is a straight (that straight is taken off and the
  ramp laid in its place). A plain ramp may cut into the hill up to its top end (`cutsHills`, `HillShape` cuts), so
  it can lie partly in a cutting. If a cut would take the ground from under other track (`cutUndermines`), the ghost
  is red and shows the "undercut" message.
- If it is two or more levels up, there is no climb. The ghost is red and shows `hillMessage` ("…climb with two ramps
  in a row"), as today. Once on a hilltop, the line can climb the next level step by step.
- At most two ramp placements are checked for each refusal. When the line's end has moved up, the stroke is
  projected at `line.end.y`, not at `line.start.y` (`DrawHand.move` → `planeAt`), so the finger stays on the hilltop.

**Down.** The chosen piece is refused with `unsupported` (DrawHand turns "needs risers" into that). The ground ahead
is whole levels lower, as happens off a hilltop or a bridge, or at a free end standing on risers. Try a flipped
`ramp` seated by its high end (`candidatesFrom` gives a base of `end.y − 48`). Coming down is never pointless: risers
stay out of drawn lines, so the only other choice is a red ghost.

**Not used:** `ramp-curve`. It can't cut (`cutsHills` is for `ramp` only), and it turns a quarter, which is rarely
what a stroke into a hill means. Curving climbs stay a tray piece for now.

## 2. Bridges (phase 1)

A bridge only stands up if `bridgeLevels ≥ 1`: its deck must be a whole number of levels above the lowest ground
under it, and no more than `MAX_BRIDGE_LEVELS`. A bridge at ground level is "unsupported". The catalogue has a twin
for each of two draw pieces: `bridge` is a 216 mm straight, the same as `straight-216`, and `bridge-curve` is the
same shape as `curve-large`. The simulated player already swaps them on a `river` refusal (`alternatives` in
`src/play/player.ts`).

- **Already a level up** (on a hilltop or raised track next to the water): when a `straight-216` or `curve-large`
  is refused with `river`, its bridge twin takes its place. While the next piece would reach water, the scorer is
  given only those two types, because other lengths and radii have no twin.
- **At ground level:** when a piece is refused with `river`, ramp up first. Lay a `ramp` with its top end on the
  bank, at the line's end or one straight back (as in section 1). Ramps can't stand in the river: `checkPlacement`
  lets only bridges over it (`isBridge`), with `RIVER_GRACE` 12 mm. Then bridges at level 1, one for each move, then
  a flipped ramp down once the next piece is clear of the water. A bank that is a level-1 hill needs no ramp down.
- If the bank is too short for a ramp, or the line meets the water on a curve that isn't a large curve, the ghost
  is red and shows "Needs a bridge over the river".
- Arches and arch floors follow from `bridgeLevelsOf`/`archFloorsOf`, as for any placed bridge. The ghosts use the
  bridge's mesh (`ghostMesh(type, flipped, mat, levels, floors)`).

## 3. Junctions: replacing the piece the stroke meets (phase 2)

The line always takes the place of a piece in the existing line, as dropping a depot onto a line does
(`findSplice`, `Editor.replace`, 1cddfa9 and 18b5808). It never needs a joint already there.

**Decision: splice, don't require a joint.** A switch is 144 mm (`SWITCH_LENGTH`), so even at a joint, something
has to come up to make room unless the end is free. Joints on a long line are 216 mm apart and hard to see from the
usual camera, so "start at a joint" would feel like a missed target. The depot path already has every part this
needs: walking a run of straights (`side()` in `findSplice`), refusing with "A train is on that straight" when a
train is on it (`sim.pieceOccupied`, `splice-busy`), the taken-up straights shrinking away
(`shrinkStandIn`, "Straight back in the box"), and one undo step (`Editor.replace`). In Game mode, the toy box counts
pieces against the map (`Progress.available` = owned − `inUse`), so anything taken up goes back to the box with no
extra bookkeeping. Splice positions where the switch exactly covers whole straights (no left-over lengths) are
preferred when they are within 36 mm of the finger. This keeps odd lengths rare.

New in `src/track/splice.ts`: **`findPieceSwap(layout, piece, at, heading, canTake)`**. It is `findSplice`'s walk,
except that the new piece may be shorter than the run. The left-over length either side is filled with plain
straights from `straightsFor`: 0 mm or at least 36 mm, in 18 mm steps (`FIT_LENGTHS`), cut as the Auto piece cuts.
Plain straights are free in Game mode (not in `THING_RULES`). It returns `{ covers, pieces }`. A new
`Editor.replaceRun(covers, pieces)` generalises `replace` and `placeRun`: it takes up the covers and puts down the
swap pieces and the drawn line, all in one undo step.

What it swaps, using only shapes the catalogue already has:

| The stroke… | Meets | Becomes |
| --- | --- | --- |
| starts on a line's body and leaves at an angle | plain straight run | `switch`, its hand (`flipped`) on the side the stroke leaves, its trunk behind. The branch end is where the line starts |
| starts on a line's body | `curve-large` | `switch`, whose branch leg is the old curve (the new line goes straight on), or `switch-y` (the new line curves the other way). An exact swap with no left-over length |
| starts beside an existing `switch`, on its open side | `switch` | `switch-3way`, with the same trunk, the same straight and both curves. Every joint is kept (Game: `junctions`, and a three-way in the box; the old switch goes back) |
| ends on a line, arriving about 45° to it | plain straight run | `switch`, merging. Its branch end meets the line's end through the Auto fit (`fitAutoStraight`, within `AUTO_ANGLE` 12°) |
| goes across a line and on past it | plain straight run | `crossing` (90°, 144 mm square) or `crossing-45`. Its cross path takes the line on, with the Auto fit into its near end |

- **No surprise switches.**
  - A free end within `END_REACH_PX` always wins: the line just goes on from it.
  - A branch needs the press to start on track and the finger to leave it at an angle. The switch ghost shows once
    the finger has gone `START_MOVE` (30 mm) off the line, and goes away if you lift before any piece follows.
  - Merges are made only when you lift on or close to a line (like closing up today).
  - A crossing is made only once the stroke has gone `DRAW_LOOKAHEAD` (250 mm) past the line, so the line is
    clearly going across. Until it's clear whether the stroke stops or goes on, no ghost is shown.
- **Routes stay as they were.** A new switch is set to the old line: state 0, which is the straight, or the branch
  when it replaced a curve. A three-way keeps the old line's route. So trains on the old line aren't sent onto the
  new one until the player flips the lever. The chevrons from the switch-clarity spec, once built, show this.
- **Ghosts.** The pieces being replaced are hidden while the line is drawn (`trackView.setHidden`, as a held
  depot's stand-ins are), and the switch shows as a ghost. If a train is on the piece, the ghost is red and shows
  "A train is on that straight". This is checked again when you lift.
- **Not swapped:** stations, depots, signals, bridges, or ramps (`isPlainStraight` only), and track at another
  height (it passes over, with the existing `headroom` rule). Two-level crossings stay with ramps and bridges.

**Input change.** With Draw on, a drag that starts on a plain straight's body or a large curve's body draws a
branch. Today it picks the piece up and moves it. Moving track then needs Draw off (or a long press: see the open
questions).

## 4. Loops (phase 3)

Today a line that comes round to *its own start* closes there (`closeOnStart`, `backAtStart`; e2e "a loop back to
its start closes there"). That works only when the start is a free end or a new line's first end. N2 adds loops that
meet the line part-way along:

- **A loop that crosses or rejoins its own line.** Drawn from a free end, it comes back onto its own earlier
  pieces, and today shows red with "The line would cross itself". Instead, apply section 3's swap to the line's own
  ghost pieces, in the scratch `own` layout. Arriving at about 45° makes a switch there (a reversing loop). Crossing
  square, or at 45° and going on, makes a `crossing` / `crossing-45` (a figure of eight). Those pieces haven't been
  laid yet, so no train can be on them. Their ghosts are just re-planned.
- **A loop off the middle of a line.** It branches with a switch (section 3) and merges back into the same line
  with a second switch (a passing loop), or into its own branch (a reversing loop).
- **Option A, a dedicated loop piece:** `balloon-loop` (`LOOP_RADIUS` 144) and `balloon-loop-small` (108). Each has
  one end: a turning loop in one piece, fixed in size, and Game mode needs `junctions` and 3 planks.
- **Option B, curves and a switch where the loop rejoins itself:** any size the stroke draws, built only from
  pieces already in DRAW_TYPES plus one switch (known from the start).

**Recommendation: B.** It follows the finger, works at every size above "Too sharp", and needs nothing to be
learned. Use A only as a quiet fallback: when the stroke is a closed teardrop within about 25 mm of the balloon
loop's own outline, and the player has one in the box. Even then, only if QA likes it (open question 4).

## 5. Feel and cost

- **At most one piece is decided per pointer move**, as in N1. Taking back and re-laying the last piece for a ramp
  counts as that move's one change.
- **Bounded search.**
  - Ramps: at most 2 extra placement checks for each refusal.
  - Bridges: one twin per piece.
  - Junctions: the swap walks only the run of the piece that `findOverlap` (or the press's pick) named, at most
    about 12 positions 18 mm apart within reach × 2 facings. Each is a pose comparison, and only the best one gets a
    placement check.
  - None of this runs unless a plain piece was refused, so a stroke on open felt costs exactly what N1 costs.
- **Placement is the cost to watch.** `cutUndermines` loops over every piece in the layout, with a quick box test
  each. Only a ramp candidate pays for it, at most twice for each refusal.
- **Target.** About 1 ms per laying move in the worst case on Node (N1's laying move: median about 0.2 ms, p95
  about 0.5 ms), and under 2 ms on a phone. Time these in `draw-path.test.ts` and in a DrawHand-level bench: a
  river crossing, a hill climb, and a branch off a 40-piece line. Note before/after numbers in the commit, as N1 did.
- Nothing runs per frame. Ghosts and the rest change only when the line changes, through `sync` and `invalidate`.

## 6. Phasing

1. **Ramps and bridges.** These only substitute pieces inside `DrawLine`: no existing track changes and no input
   changes, so they're the least surprising and the cheapest to ship. Tests: a stroke across a river from the felt
   gives ramp, bridges, ramp. A stroke into a level-1 hill gives a ramp in a cutting. A stroke off a hilltop gives a
   ramp down. A stroke beside a hill, or on plain ground, never gives a ramp. Game mode with no ramps: "Out of ramp
   pieces".
2. **Junctions.** `findPieceSwap`, `Editor.replaceRun`, a branch from a line's body, merging when you lift, the
   curve-to-switch/Y swap, and the switch-to-three-way upgrade. The input change from section 3 lands here.
3. **Crossings and loops.** Crossings (`crossing`, `crossing-45`), loops that rejoin themselves, and passing loops.

## Open questions for the user

1. **Drag on a line with Draw on:** should it draw a branch (proposed), or keep moving the piece? If it draws,
   should a long press still pick the piece up?
2. **Climbing two levels:** today `hillMessage` asks for "two ramps in a row", but the second ramp's foot may need a
   riser, and drawn lines put in no risers. Should the line put in risers under a drawn ramp only, or stop and say
   so?
3. **A branch square off a line:** a switch leaves at 45°. For a stroke that leaves at about 90°, should the switch
   face the way the finger then bends (wait up to about 60 mm to see), or face the way the old line was drawn?
4. **Loops:** is option B alone enough, or should a teardrop the size of the balloon loop become one piece?
5. **Merge or cross at 45°:** lifting on the line merges, and going on through it crosses. Does that read right, or
   should crossing need a 90° approach?
6. **Coming down:** should a line drawn off raised track always ramp down when the ground falls away, or stay red so
   the player can put in risers by hand (to cross over another line)?

## Code (when built)

- `src/track/draw-path.ts`: the reason code from `check`. The climb, descent and bridge-twin substitutions in
  `lay`/`choose`. Taking the last piece back to re-lay it, in the same way as `retrace`.
- `src/track/splice.ts`: `findPieceSwap` (with tests next to `findSplice`'s).
- `src/editor/editor.ts`: `replaceRun`, as one undo step that also restores the covers.
- `src/game/draw-hand.ts`: `begin` on a line's body, hiding the covers, swap ghosts, projecting at `line.end.y`,
  and the not-learned wording.
- `src/game/interaction.ts`: a press on a line's body with Draw on goes to `draw-track`, and passes the reason codes
  through to `placement`.
- `scripts/e2e/draw.mjs`: river, hill, branch, merge and loop strokes.
