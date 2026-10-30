# Train routing: one system, one owner (2026-10-30)

## Status

A design, not yet built. It covers four play-test issues:

- **#3 follow-up:** a train behind waits for points held by a train ahead.
- **#4:** more than one route.
- **#5:** routes set switches and restore them.
- **#7:** prefer running forward.

**The user's bar:**
- "A train taking the wrong road and turning back later isn't acceptable."
- "Centralize the logic and get things into a nice state."
- "The player should be able to make mistakes, but we should give them a path where things do work."
- "Even younger kids should be able to build some simple automations."
- "You can take inspiration from real-life railroads."

**Decided** (issue #5):
- A switch's **default** is the position the player last set by hand.
- A **pinned** (red) switch is never changed by routing.

**The plan:**
1. Move every routing and switch decision into one module, `src/routing/`, with no change in behaviour, proven by
   tests (§13, step 1).
2. Then add new behaviour one step at a time, each step proven in a standalone harness (§12).

## 1. Where the decisions live today

| Decision | Where | What it does |
|---|---|---|
| When to steer | `Economy.steerTrains` (`economy.ts:1699`), `STEER_TICKS` 8, `Sections.steerSoon` | Each routed train, every 8 ticks or on a sections grant |
| Which way at the next switch | `steer.ts` `steerSwitch` / `steer` / `chooseWay` / `wayToward` | Looks up to 6 pieces ahead and throws toward the stop by `distanceTo` |
| How far to a stop | `steer.ts` `distanceTo`, `waysFrom`, `next` | A piece-count search; a turn-back adds 12 pieces (`TURN_COST`) |
| Don't throw: under a train | `Economy.occupied` → `Sim.pieceOccupied` | |
| Don't throw: on another's granted way | `Sections.switchHeld` | |
| Don't throw: a train ahead comes first | `Sim.trainAhead` (#3) | |
| Steering hint inside a move | `Sections.steerHint` (`follow`, `aim`) | |
| Lever tap allowed? | `interaction.ts:4708` → `Sim.pointsHeld`, `Sim.toggleSwitch` | Toast "These points move once the train is off them" |
| Meeting paths at points and crossings | `Sim.crossCap`, `crossClaims` | Stop short, first come first served; turn back after 5 s |
| The way drawn on the map, and pinned-blocking | `route-path.ts` (`legFromCursor`, `pinnedBlocking`) | Its own copy of the search |
| Ways inside sections | `sections.ts` `wayOn`, `unreachable` (via `distanceTo`, `wayToward`) | |
| Keeping a train together through points | `advanceCursor` memory, `rememberStraddledSwitches` | Physics: stays in the sim |

**What goes wrong today:**
- When steering declines to throw a switch, nothing stops the train. It runs over the points as they lie, takes the
  wrong road, and its search later turns it back at a dead end.
- Nothing restores switches.
- The search doesn't know which way the engine faces, so a reverse is cheap.
- **#4:** each engine has its own `Route` and `lineIdOf` entry, and `startLine` replaces only that engine's line, so the
  cause isn't known yet. It's found by a failing test along the player's path (§13, step 0).

## 2. The one owner: what moves, what's deleted

**`src/routing/`** is the only code that decides which way a train goes, or sets points for it:
- `graph.ts`: `waysFrom`, `next`, `distanceTo` and `wayToward`, moved from `steer.ts`. Sections and route-path import
  them from here.
- `plan.ts`: the plan search (§3.1). Step 1 is a piece-count search identical to `distanceTo`'s choices.
- `router.ts`: `Router`, which holds plans, locks, waits and defaults.
- `harness.ts` and `*.test.ts`.

**What moves where:**

| Piece | Becomes |
|---|---|
| `Economy.steerTrains`, `STEER_TICKS`, `occupied` | `Router.tick` (step 1 keeps the 8-tick cadence) |
| `steer.ts` `steerSwitch`, `steer`, `chooseWay`, `AvoidTest`, `AheadTest` | `router.ts` (step 1), then **deleted** at step 4, replaced by locks |
| `steer.ts` itself | **deleted**. `graph.ts` holds what's left |
| `Sim.trainAhead` | **deleted** at step 4 (a train ahead holds the lock) |
| `Sections.switchHeld` | **deleted** at step 4 (a granted move's points are locked) |
| `Sections.steerHint`, `steerSoon` | kept as sections' outputs, read by the router (`granted`, `wake`) |
| `Sim.pointsHeld` | kept: the physical rule. The router calls it before every throw |
| `Sim.toggleSwitch` for points | the lever path goes `interaction` → `router.lever(pieceId)` → `sim.toggleSwitch`. One gate, one set of toasts |
| `route-path.ts`'s search | uses `plan.ts`, so the line drawn on the map is the plan the train runs |
| `crossClaims` for points | router locks at step 7. Diamond crossings stay in `crossCap` |
| decks, lifts, signals | unchanged: they belong to the sim and the player |

**After step 1:** nothing outside `src/routing/` calls `setSwitchState` for a routed train. The only other writers
are the lever (through the router), the editor (laying and undoing) and loading a save.

## 3. What the router owns

### 3.1 Plans
- A **plan**, per routed train, is the way from its front to its next stop: `Step { pieceId, path, entry, exit,
  reverse? }`.
- From step 6, it's found by a search over `(piece, entry, engineLeading)`, costed in mm (§6).
- Pinned switches offer only the road they're set to.
- It's worked out again only when one of these changes:
  - the goal: `Route.next`, or the line's stops;
  - the layout revision, or the pins;
  - the train leaves its plan;
  - the train turns: Continue, ⇄, Swap ends, a turn-back.
- Plans are memoised per (revision, goal, start state).

### 3.2 Locks: route setting, route locking, release behind
- `Lock { pieceId, state, holders }`, on points only (not decks, lifts or signals).
- **Setting:** when a train comes within its set distance of the next points on its plan, it asks for every lock up to
  its next clear point.
  - The set distance is braking distance plus `SET_LOOK`.
  - A clear point is a slot end, a stop, or plain track as long as the train.
  - The locks are granted all or none. Each switch is thrown to its road, never while `pointsHeld`.
- **Shared:** a train behind needing the same road joins `holders`. Points never move while anyone holds them.
- **Released:** when the train's last axle clears the points (release behind, switch by switch). Then:
  - a waiting request for the same road takes the lock with no move;
  - one for the other road is granted, and the points move once;
  - otherwise the points **restore** to their default, unless they're pinned or occupied.
- **Removed, derailed or put away:** a train's locks go with it.
- **A layout edit:** drops locks on pieces that are gone, and plans are worked out again.

### 3.3 Waits
- A train whose next points aren't locked for it stops `STAND_SHORT` + `OVERLAP` short of their fouling end, and
  waits.
- `RouteWait { kind: "points", pieceId, by }` names the train that holds them.
- It never runs over points set against it. This is the guarantee against a wrong road.

### 3.4 Defaults
- `defaults: Map<pieceId, state>`.
- Written by a lever tap the router allowed, and when a switch is laid.
- Never written by routing.
- No entry means the current state is the default.

## 4. API

```ts
export interface RouterHost {
  layout: Layout;
  sim: Pick<Sim, "trains" | "findCar" | "piecesUnder" | "pointsHeld" | "toggleSwitch" | "ticks">;
  granted(engine: number): { follow: AvoidTest; aim: number } | undefined; // sections' hint
  onSwitch?(pieceId: number): void;                                       // lever swing and click
}
export class Router {
  setGoal(engine: number, pieceId: number | null): void;
  wake(engine: number): void;               // sections granted a move: set its points now
  tick(): void;
  speedCap(train: Train): number;           // composed into Sim.speedCap
  lever(pieceId: number): LeverResult;      // { ok } | { refused: "under-train" | "set-for", by? }
  planOf(engine: number): readonly Step[] | null;
  waitOf(engine: number): RouteWait | null;
  save(): SavedRouting; restore(s?: SavedRouting): void; prune(engines: ReadonlySet<number>): void;
}
```

**Saving:**
- The save gains `switchDefaults?: [pieceId, state][]`, only where a default differs from the switch's state.
- Old saves: the default is the switch's state.
- Locks are rebuilt on load: each train locks the points it stands on, and nothing restores in the load itself.
- Keys are piece ids, never car ids.

## 5. Deadlock rules (with sections and slots)

Sections stays the authority on who may enter a section of a line. The router only sets, locks and waits on points.

1. **All or none, to a clear point.** A waiting train holds only the points it stands on, so points locks can't make a
   hold-and-wait ring.
2. **Inside the granted move.** A line's train locks only along the way sections granted, and only after the grant.
   Trains of one line never contend for points, so a line's own rules are untouched.
3. **Every wait names its blocker.** Sections' chain following, `unring`/`YIELD_S` and the 30 s net see a points wait
   like any other. A blocker not on the line is a foreign occupant, as today.
4. **First asked, first served,** but a later request that needs none of the head's locks may go first.
5. **No early release:** a lock holds until the last axle clears.
6. **Breaking a wait turns a train; it doesn't break a lock.** The turned train gets a new plan, and lets go of the
   points behind it once it's off them.
7. **Unplanned trains** (hand-run) take no locks. They stop short of points another train holds, and otherwise take
   the points as they lie (step 7).

## 6. Running forward (#7)

Costs, in mm:
- **A reverse** (at a dead end, or a planned turn): `REVERSE_COST` (about 2 m) plus the run back.
- **Running engine-last:** ×`PUSH_FACTOR` (about 1.5).
- **Pinned switches, decks and lifts:** fixed, not a choice.

So a loop, wye or triangle that keeps the engine in front beats a short reverse, and a dead-end siding off the way is
never entered. The search is a Dijkstra with a binary heap, capped at `SEARCH` states.

Hand-run trains aren't planned and never get switches set for them. They turn back less because they wait at held
points instead (§16 Q5).

## 7. Mistakes and the path to working

A bad layout may still run poorly or jam. That's the player's to find and fix. The router never hides it with a silent
wrong road or a mystery stall. Every train that isn't running says why on its card, in words a young child can follow,
with a hint toward the fix.

**Prevented** (the player never sees these):

| Failure | How |
|---|---|
| A routed train takes the wrong road and turns back later | It waits at points that aren't locked for it |
| A train splits on points | Points never move under a train, or while it holds them |
| The player's switches are left changed by routes | Restored after the train passes |
| A pinned switch is moved by a route | Never locked; the route is planned round it |
| Trains of one line meet head-on | Sections, as today |

**Allowed and explained** (card text to be tuned by Mobile UX):

| Mistake | What happens | What the card says |
|---|---|---|
| No track joins a stop | The train stands at its last good place | "Can't reach Mill: no track goes there." |
| A pinned switch is in the way (`pinnedBlocking`) | The train stands; the red lever pulses | "A red switch is in the way. Tap and hold it to unpin." |
| More trains than passing loops | Held, as today | "The line is full. Lay 1 more passing loop." (existing) |
| A loop pinned so no one can pass | Held, as today | "Unpin the passing loop's switches so trains can pass." (existing) |
| Waiting for points another train holds | Stops short and waits | "Waiting for the Blue train to pass the points." |
| Two lines need each other's points (a ring) | One gives way within `YIELD_S` | Toast: "The Red train went round to let the Blue one by." |
| The only way is backwards (a dead end, no loop) | It reverses, as it must | Once per line: "Add a loop at the end so it can turn round." |
| A lever tap on points set for a train (Q1) | Refused | "These points are set for the Red train. Try again once it's by." |
| A lever tap on points under a train | Refused, as today | "These points move once the train is off them." (existing) |

**Rules for the text:**
- It says what to do next, not what went wrong inside.
- It's at most 3 lines.
- A hint is toasted once per line; the card then holds it steadily.
- Where it helps, the hint points at a place: the pulsing lever, or later the loop proposal's "Show me where".

## 8. Simple automations a young kid can make

Each needs only track, stations and the engine card's route: no pins, no signals, no hidden rules. Each is a scripted
harness case (§12) that must deliver for 30 game minutes with no wait over 20 s.

1. **Shuttle:** two stations on one line, buffers at both ends, one train. Route: A, B. It runs to each and reverses
   there, never between (taps: Routes, A, B).
2. **Round and round:** a loop with two stations and one train. It runs forward forever and never reverses.
3. **Branch delivery:** a main loop with a siding to a mine. The route is Mine, Town. The switch is set for the siding,
   then put back, so the loop is as the player left it.
4. **Two trains, one passing loop:** a shuttle line with a loop in the middle and two trains on the same route. They
   wait for each other at the loop's ends and pass there. The second train just joins the line.
5. **Turn round at the end:** a terminus with a balloon loop (or a wye). The train goes in engine-first and comes out
   engine-first (step 6).

The taps above are today's engine-card flow, and the touch e2e checks each step.

## 9. Feeling nice: satisfying to watch

- **Switches swing just in time:** about a second before the train, at the set distance, not seconds early. They swing
  back just after the last car clears, so the player sees cause and effect.
- **Visible waiting:** a train eases to a stop a little short of the points (an overlap) and waits with its card saying
  who for. It starts as soon as they're clear. No creeping, and no stopping on the points.
- **Predictable:** the same layout and the same routes give the same moves. The line drawn on the map is exactly the
  way the train will take.
- **Few reversals:** forward running where the track allows (§6).
- **Smooth:** a wait begins with normal braking, because the set distance includes braking distance, never a sudden
  stop.
- **Quiet when idle:** nothing moves or redraws when nothing is happening.

## 10. The learning curve

| Automatic, for beginners | Left to care and attention |
|---|---|
| Points set for routed trains, and put back | Laying passing loops so lines can hold more trains |
| Trains waiting for each other at points | Pinning switches to keep trains off a road |
| One line's trains taking turns on single track | Signals (#16) to divide a line by hand |
| Forward running where the track allows | Turntables, lifts and decks (never thrown by routes) |
| Cards and toasts saying what's wrong and what to do | Hand-running trains with the levers |

Nothing advanced is needed for §8. Each advanced tool adds control and doesn't change what's automatic.

## 11. Borrowed from real railways

| Idea | In the game |
|---|---|
| **Interlocking:** points locked under a train and while a route is set | `pointsHeld`, plus router locks; the lever is refused |
| **Route setting:** all the points for a route set together | All-or-none locks to the next clear point |
| **Route locking with sectional release:** each piece let go behind the train | A lock released as the last axle clears each switch |
| **Overlap:** stop short of the points with a margin | `STAND_SHORT` + `OVERLAP` before the fouling end |
| **Block working:** one train per block | Sections (one train of a line per section) |
| **Single-line working:** passing loops as meeting points, and a token | Slots and sections: a granted move is the token |
| **Normal position:** points return to normal after use | Restore to the player's default |

**Rejected:**
- **Signal aspects for routes** (green, yellow, red): too much to read on a phone. The card and the train's waiting
  show it instead. #16 keeps signals as a player's tool.
- **Track circuits and axle counters as objects:** the sim knows where every axle is.
- **Approach locking timers and time releases:** fiddly and invisible to kids. The rule is just "the train has passed".
- **Train describers and timetables:** routes are enough at this scale.

## 12. The standalone harness

`src/routing/harness.ts` builds a `Layout`, a `Sim`, a `Router`, and `Sections` where a scenario has a line. There's no
`Economy` or render. It reuses `loop-fixtures.ts`.

**A scenario** is: a layout, trains, a goal list per train, scripted events (a lever tap, a pin, a save round-trip, a
piece removed), and a budget.

**Invariants, every tick:**
- **No wrong road:** a planned train's bogie enters the piece and path of its locked plan.
- **No split:** checked by the bogies' pieces and paths (joined along the way), not by axle distance.
- **Points never move under a train:** `setSwitchState` is spied on.
- **Pinned points never change.**
- **Restore:** a switch nobody holds or stands on for 1 s is at its default.
- **No deadlock:** no lever-on train is still for more than 60 s, every wait names a blocker, and the 30 s net fires 0
  times.
- **The payoff:** arrivals, and goods where there are depots, reach the scripted counts.
- **Cost:** search time and the number of ticks that did work are bounded (with a warm-up, best of N and a median).

**Scenarios:**
- §8's five automations.
- A lone train, unrouted and routed: identical to a recorded main trajectory (through step 5).
- A follower needing the same road, and one needing the other road.
- Pinned points on the route.
- A wye from its branch and a crossover at connector 3, each with a follower.
- A dead-end siding beside the way.
- Two lines over a crossover pair (a ring).
- Three trains on a line with one loop.
- A lever tap during a lock, a save mid-lock, and a piece removed under a lock.
- Seeded fuzz over the loop fixtures.

## 13. Migration (each step lands alone)

Every step runs: typecheck, vitest, build, a diff of the sections-qa `SHOW=1` rows against main, `e2e:touch`, and the
lone-train check.

0. **#4, independently.** A failing play-through test: two trains given routes by the card buttons, then a save and
   load. Find the cause and fix it.
1. **Consolidate, with behaviour unchanged.**
   - Create `src/routing/` and move the pieces per §2.
   - `Router` wraps today's logic exactly: the 8-tick cadence, `steerSwitch`, `trainAhead`, `switchHeld`.
   - Lever taps go through `router.lever`, and route-path uses `graph.ts`.
   - **The proof:**
     - the sections-qa rows are byte-identical to main;
     - recorded trajectories (position hash per second) for the harness's scenarios and the play-through seeds match
       main;
     - `e2e:touch` passes.
   - Known gaps (no restore, wrong road under a follower) go on the harness's expected-failure list.
2. **Defaults.** Lever taps and laid switches write defaults, which are saved and loaded. Player-path test: tap a
   lever, then save and reload. No behaviour change.
3. **Shadow plans.** `plan.ts` (piece-count costs) is compared against step 1's choices in the harness and QA, with no
   effect in game. Measure search time.
4. **Locks, setting and restore (#5).** These replace the step-1 wrappers. Delete `steerSwitch`, `trainAhead` and
   `switchHeld`.
5. **Waits (#3 follow-up).** The `speedCap` overlap stop, `RouteWait`, the card text from §7, and waits fed into
   sections' chains.
6. **Forward costs (#7, routed)** behind `ROUTE_FORWARD`. Compare balance windows and reversal counts (seed 2027 with
   1–3 trains; seeds 1 and 2 with 2 trains), then switch it on.
7. **Hand-run trains respect locks.** Router locks replace `crossClaims` at points, and the crossCap turn-back is tuned
   per Q5.
8. **Clean-up.** Delete `steer.ts`'s remains and update rail-road.md.

## 14. Cost

- **No routed train:** `tick` returns at once and `speedCap` is one size check, so a lone unrouted train is identical
  to main.
- **Per routed train:** the router works when the front comes onto a new piece, and when a lock it waits for is
  released (an event, not polling). Between those, a cached cap: no search and no allocation.
- **The search** runs only on the changes in §3.1, with a target of ≤ 1 ms on a phone for the QA layouts.
- **Nothing per frame.** A restore is a `setSwitchState` plus a lever swing, and only happens after a train passes,
  so 0 idle frames.

## 15. Interactions

- **#16 (signals):** a player's held signal is a wait the router respects, not one it sets.
- **The loop proposal** ("Show me where") is the natural hint for "the line is full" and "add a loop at the end".
- **#6 (a gap behind the train ahead):** `followRoom` stays in the sim, and the router's overlap stop must not stack
  with it.

## 16. Open questions for the user

1. **Tapping a lever on points a train is about to use:** say no with a toast ("These points are set for the Red
   train"), or move them and make the train wait? *Suggest: say no.*
2. **When a train behind needs the other road:** should it wait, or go another way if there is one? *Suggest: another
   way only if it's no more than about 1.5× as long.*
3. **How much further should a train go to keep its engine in front, rather than back up?** *Suggest: up to twice as
   far.*
4. **Pushing:** is it fine for a train to push its cars for a while, or should it always turn round where it can?
5. **Trains you drive by hand:** today they give up and turn back after waiting 2–5 s. Should they wait longer, say
   15 s, while the train in the way is still moving?
6. **Should routes ever set switches for a train you drive by hand?** *Suggest no.*
7. **Points going back:** should the lever visibly swing back, with a soft click? *Suggest yes.*
8. **A dead end with no way to turn:** should we suggest a loop there once ("Add a loop at the end so it can turn
   round"), or say nothing?
