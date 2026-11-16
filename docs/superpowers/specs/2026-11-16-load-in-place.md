# Load in place

2026-11-16. The user: "the way our trains load is a bit annoying. If the train could just load all its cars without
moving, that might be nicer to see. There's lots of starting and stopping now, and we get weird situations like these
if things are tight." (A train seemed held at a red signal after loading at a sawmill: its shunting under the crane had
put its nose past the signal at the depot's far joint.)

## Today

At an automatic depot a train with work crawls (`CRAWL_SPEED`, 60 mm/s) and stops each wagon that has work exactly
under the crane point (`DepotState.craneAt`, `Economy.depotCap`); the crane moves a unit every `CRANE_TICKS` (0.6 s),
unloading before loading; then the train crawls on to the next wagon. A coach is stopped under the crane too, and its
riders get off and on one at a time (`RIDER_TICKS`, 0.3 s). A wagon that can't come under the crane (off the depot, or
the train stopped short by a buffer or a train ahead) is "reached for" where it stands. So a train of three wagons
starts and stops three times, and when it leaves its last wagon is at the crane: a long train's engine stands well past
the depot's far end, over the joint, where a signal or points may be.

## The change

**A train pulls up once.** With work at a depot, it brakes (as for a signal: `brakeTo`) to stand with its nose
`STOP_SHORT` short of the depot's far end, the end it's heading for. It never passes the depot's far joint, so it is
never over a signal or points ahead. Then it stands still till its work there is done. A train that can't get there
(stopped short by a buffer, or a train ahead of it on the same track, for `STUCK_TICKS`) is served where it stands; one
queued behind another that hasn't had anything moved for it yet pulls up once the way is clear (it is still one stop,
the train's first). A visit that begins with the train already standing (a train set going on the depot, a game loaded
mid-load) is served where it stands. Once it has stood this visit it doesn't move again for the crane: lever off and on
again, a load waited for, a wagon gone back to (a pile with room again): all where it stands.

**Too long for the depot.** A depot is one piece (216 mm: an engine and one wagon). A longer train stands with its nose
at the far end and the rest behind, on the track it came in on, as a train stopped at a signal does. Points or a
signal behind it are passed already; what it stands on behind is the one place it may be in another train's way, and
only while it loads (as at a red signal). Nothing moves it forward over the far joint.

**The crane travels along the train.** Every wagon is served where it stands, the nearest with work first (each wagon
done, unloading before loading, before the next, as today). The crane runs along its depot to the next wagon at
`CRANE_RUN` (60 mm/s, the speed the train crept at), so a train's dwell keeps today's time for the same goods: the
time the train took creeping from wagon to wagon is now the crane's run. What gets shorter: the crawl in from the
depot's start to the first wagon (the train comes in at speed and brakes), and the stops and starts. The economy keeps
where each depot's crane is (`craneAtNow`, along the depot, not saved: a reloaded game's cranes start at their home).

**One crane, one load.** A depot of several tracks keeps its one crane serving a train at a time, a unit a move, each
track's train in turn (`craneTurn`); its run to a wagon is part of that train's turn.

**Coaches all at once.** Riders get off and on every coach of a standing train together: each coach moves a rider
every `RIDER_TICKS`, no crane. A train of three coaches is boarded three times as fast; its dwell at a station is the
busiest coach's. This is a balance change (coaches earn by the trip, so a passenger line runs a bit more often): the
balance sweep says by how much and whether its bands still hold.

**Mail, hoppers, warehouses.** Mail vans and sorting vans, hoppers and every other wagon are worked by the crane as
above (their goods don't change how). A warehouse's Lift and load lifts `LIFT_LOADS` a move as before, wherever the
wagon stands.

## How it's drawn

The crane's frame travels: a gantry's legs and beam run along two rails (at its legs, over the yard's length), a jib's
mast along one; the trolley, rope and hook as before. While a unit is moved the frame follows the hook along the
depot, clamped to its rails (a wagon beyond them is reached for: the hook goes on to it); between moves it runs to the
next wagon (the economy's `craneRun`: from, to and progress, through `craneMove`). The hook goes back empty from where it
left the last unit to the next one's source as the move begins (it jumped there before). The frame is the crane's own
mesh (one more draw per crane site; the rails are with the yard's static parts). Its motion asks for frames only as
the trolley does today: while a crane is working, not paused, and its site's moving parts are in view (`cullTiles`);
paused, nothing moves; zoomed out past the cull, nothing is drawn. A standing train, the crane idle (waiting for goods),
asks for nothing.

## Save compatibility

A visit isn't saved. A game saved with a train mid-load reloads with the train standing where it was: its visit begins
standing, so it's served there and doesn't move up (its cars that were done are worked again, as today: nothing they
have is lost). Nothing in the save's format changes.

## Tests

- Unit (`src/economy/load-in-place.test.ts`): a train with three wagons at a sawmill stops once (its position doesn't
  change from its halt till it's sent on), all its wagons are unloaded and loaded, its nose stands short of the far
  joint; its dwell against today's (measured on main) within 15%; coaches boarded together; a train behind another
  pulls up once it's clear; a visit begun standing is served there.
- The play-through and `balance:sweep` in their bands; `fuzz:long`, the routing cases: unchanged or better.
- e2e: depot-tracks, crane, train-summary, hopper-load, warehouse and what `e2e:affected` picks, still asserting the
  goods delivered; pictures of a train loading in place.
- perf: 0 idle frames, draw calls within budget.
