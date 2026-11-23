# Swap engine

2026-11-23. The user: "being able to swap an engine on a train (to avoid having to reset the route, etc)".

## Today

To put a tank engine's train behind a goods engine (or an electric, or a rack engine for a hill), the player takes the
train apart: Decouple the engine, Remove it, drag the new engine out of the tray, couple it on by drag, then set its
line up again from the card (Run a line…, the line, Go). The new engine is a new car id, so everything keyed by the old
engine's id is lost on the way: its line (`Economy.lineIdOf`) and its place in it (`routeOf(engine).next`), its name and
paint (`Sim.names`, `liveries`), the dispatcher's and the economy's per-engine state (spacing, stops, waits).

## What an engine kind is

Every engine is the same car underneath: `CarKind` "engine", the same length, bogies and coupling. Its kind is only its
*look* (`Sim.lookOf`: classic, tank, diesel, electric, express, goods, rack, metro, royal), and Game mode reads its
pull, speed, pace, power and rack from that look (`ENGINES`, src/game/engines.ts) each time it asks. The toy box counts
engines as `car:engine` (6 planks each); a look costs nothing once its blueprint is learned (`LOOK_TECH`), except the
metro train's (`look:metro`, its own price) and the Royal Train's (`look:royal`, a gift, one). Those two are trains of
three cars in one look.

## The change

**Swap engine changes the engine's look in place.** Same car, same id: the train keeps its line and where it is on it,
its wagons and their loads, its riders, the engine's name, paint and lever, its stops' settings (wait for a full load,
what's dropped and taken), and anything else keyed by the engine's id. The renderer builds that one car's model again
(`Sim.looksVersion`, as a livery does); Game mode's speed, pull, pace, power and rack follow at once, as they're read
from the look every time.

**Price.** None, by the game's own rules: the toy box doesn't change (one `car:engine` before and after), and a look is
free once learned. So there's nothing to refund or take back into the box.

**Player path, phone first.**

- The engine card's tool row gets **Engine** (beside Swap ends, Decouple, Paint, Remove; 44 px). Greyed with why where
  it would be refused (see below), as Swap ends and Decouple are.
- A tap opens a short sheet, "Swap engine", over the map (as the paint shop's): one 44 px row per engine kind, its name,
  and in Game mode what it does ("Pulls 3 · 1×", the engine's numbers), with a note where it matters:
  - the engine it is now: ✓ *This one* (no tap);
  - not learned yet: *Learn Diesel first*, greyed (Sandbox: none locked);
  - too weak for the train (`pulls` of all its engines < its cars): *Too weak for 5 cars* (allowed: the card then says
    it's too heavy, and the player may be on their way to decouple);
  - electric with no spark on the map: *No ⚡ power: steam speed* (allowed: an electric engine without a spark runs at
    steam speed, never stops; the game's rule);
  - the rack engine: *Climbs racks*.
- A tap on a row swaps it at once and closes the sheet. A toast: "Rowan is a goods engine now". One undo step (Undo puts
  the old look back; Redo the new), saved as any change is.
- ✕, a tap beside the sheet, or Escape closes it with nothing changed. 0 frames drawn while it sits open, paused.

**Refused** (the button greyed, the reason as its tooltip; and the sheet's rows refuse it again if it changes):

- the train is moving: *Stop the train first* (as Swap ends; a train standing at a stop on its line counts as stopped:
  swap it there, and it carries on);
- derailed, or a breakdown crane's job (lifting it, or the crane train at work): *Not while the crane has it*;
- riding a turntable or lift deck: *Stop the train first* (`Sim.standing`);
- the metro train's motor car or the Royal Train's engine, either way (a three-car train in one look, with a price or a
  gift of its own; swapping it would let another out of the box): *The metro train keeps its own engine*;
- Game mode, standing on a rack, swapping to an engine that can't climb it with no other rack engine on the train:
  *Bring it off the rack first* (it would be stuck there).

Points are no reason to refuse: the car's length and bogies don't change, so the train covers exactly the track it did.

## Not now

- Dragging an engine from the tray onto a train's engine to swap it. The card path covers it with fewer ways to go
  wrong on a phone (a drop near a train couples today); worth adding if players look for it.
- Swapping a wagon's look (a coach into a dining car): the same mechanism would do it; not asked for.

## Code

- `src/game/swap-engine.ts`: `SWAP_LOOKS`, `swapRefusal`, `swapChoices` (the sheet's rows), `swapEngine` (the look set,
  the old one returned for undo). Pure over the sim, layout and economy.
- `Sim.looksVersion` (goes up when a look changes), `TrainView.syncModels` (was `syncLiveries`: a car built in another
  look or livery is taken down and built again on the next update), `Game.frame` asks only when the version moves.
- `src/ui/engine-sheet.ts`: the sheet, loaded the first time it opens (as the paint sheet).
- main.ts: the button's refusal with Swap ends' and Decouple's (`showRefusals`), the swap, its undo step
  (`editor.recordRoutes`), the toast and save; the summary's key takes the look, so "1×" follows.

## Tests

- `src/game/swap-engine.test.ts`: a train on a line, its engine swapped: the same car id, line, next stop, wagons and
  loads, name, livery, lever; its speed and pull as the new engine's; refusals (moving, derailed, special, locked, rack).
- `npm run e2e:swap-engine`: Game mode on a 390×844 phone, by taps: a goods train on a line round an oval, its card's
  Engine (44 px), the sheet, a tank engine swapped for a goods engine at a stop; still on its line, still heading where
  it was, its wagons and name kept; it delivers logs (the payoff); Undo and Redo; a reload keeps it; 0 idle frames.
