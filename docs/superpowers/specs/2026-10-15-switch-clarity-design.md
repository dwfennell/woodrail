# Clearer switches: see the way they're set, and pin them there

Status: proposed (next after drawing track). Branch `claude/zen-lamport-ktlz8y`.

## Why

You set a switch by tapping its lever. The lever leans toward the route that's set, and the semaphore beside the
trunk lifts for the branch. Both are small, both are side-on, and from the usual high camera you can't tell at a
glance which way a train will go. Routed engines (the engine card's stops) also throw switches themselves, a few
pieces ahead (`steer.ts`). A switch the player set by hand can quietly change back, and nothing says why.

## What changes

1. **The set route shows on the track.** On every switch, the route that's set has a row of small painted chevrons
   along its groove, pointing away from the trunk. They are a light cream, like the stencilled arrows on toy track.
   The route that isn't set has none. Two-way, Y and three-way switches all work the same way; a wye shows the route
   from its trunk.
   - This is drawn as one instanced mesh of chevrons for all switches. It is rebuilt only in `syncSwitches()` (after a
     flip) and when the layout changes. Nothing is drawn per frame.
2. **Flipping feels like flipping.** A tap on the lever (or the semaphore) now:
   - swings the lever over in about 120 ms, instead of jumping;
   - slides the chevrons across to the new route;
   - plays a wooden *clunk*: the existing `clunk` sound, with a lower knock under it.

   These are flourishes, so rendering stops once they settle.
3. **Pin a switch.** A long press on a lever (about 450 ms) pins the switch, or unpins it.
   - A pinned switch shows a small red peg in its lever's base, and its chevrons go a warmer orange.
   - Routed engines don't throw a pinned switch. `steer` treats it as fixed, and the route search sees only the route
     it's pinned to.
   - A tap still flips a pinned switch by hand. Pinning stops the trains, not the player.
   - A toast explains it the first time: "Pinned: trains on a route won't change this switch. Hold again to unpin."
   - The pin is saved with the switch. Saves gain an optional `pinned: number[]`, and old saves load with none.
4. **Who threw it.** When a routed engine throws a switch that's in view, the lever swings with the same flourish.
   That way a change never happens without anything showing it.

## Code

- `src/render/track-view.ts`: the chevrons (`switchArrows`), a lever swing flourish, and the pin peg.
- `src/track/layout.ts`: `pinned` set (`isPinned`, `setPinned`), carried through undo and redo of the piece's removal.
- `src/economy/steer.ts`: skip pinned switches; the distance search follows only a pinned switch's set route.
- `src/game/interaction.ts`: a long press on a lever pins it; a tap still flips.
- `src/persist/save.ts`: `pinned`.
- Tests: steer leaves a pinned switch alone and routes around it; save round-trip; layout pin survives undo.

Status (2026-10-18): the data side of pinning has landed: `Layout.isPinned` / `setPinned` (pin changes bump
`switchesVersion`), `steer`/`waysFrom` treating a pinned switch as fixed, and the save's optional `pinned`. The UI
(long press, peg, warmer chevrons, the first-time toast) is still to come.

## Later (with route planning, C)

The engine card's stop list offers only the stops a train can actually reach from where it is, taking pinned
switches into account. The chosen route is drawn on the track as a dotted line while the card is open.
