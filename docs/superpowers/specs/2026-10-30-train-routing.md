# Train routing: one system, one owner (2026-10-30)

## Status

A design, being built step by step (§13): steps 0 to 5 are done (step 2: the §12 harness and defaults; step 3: shadow
plans; step 4: locks, setting and restore; step 5: waits), step 5b (no turn-backs: §16 Q3, stalls said on the cards), step 5c
(single-line working across lines: two lines' trains pass at a loop), step 6 (forward costs, #7) and step 7 (hand-run
trains respect locks). It covers four play-test
issues:

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
- **#4:** not routing. Picking a train up pruned the economy while the train was off the track, so it lost its route
  and line (§13, step 0, done).

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
| `crossClaims` for points | router locks at step 7 (claims stay as the close-range backstop; a waiter claims nothing). Diamond crossings stay in `crossCap` |
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
Lines sharing track are one network for sections (step 5c): every train of the network's lines, and a running train on
no line there, asks for its moves among them all, so they meet only at passing loops.

1. **All or none, to a clear point.** A waiting train holds only the points it stands on, so points locks can't make a
   hold-and-wait ring.
2. **Inside the granted move.** A line's train locks only along the way sections granted, and only after the grant.
   Trains of one line never contend for points, so a line's own rules are untouched.
3. **Every wait names its blocker.** Stalls (`stalls.ts`, step 5b) follow a points wait like any other, with sections'
   waits and the sim's (`Sim.heldBy`). A blocker not on the line is a foreign occupant, as today.
4. **First asked, first served,** but a later request that needs none of the head's locks may go first.
5. **No early release:** a lock holds until the last axle clears.
6. **Nothing breaks a wait** (§16 Q3, step 5b): no train turns back short of the end of the track. A wait that can't end
   (a ring, a line's held train in the way, a parked train) is a stall: the trains stand, and their cards say what to do.
7. **Unplanned trains** (hand-run) lock the points just ahead as they lie while moving (nothing is ever set for them),
   stop short of points another train holds for a road that meets theirs, and otherwise take the points as they lie
   (step 7).

## 6. Running forward (#7)

Costs, in mm (`MM_COSTS`, step 6):
- **A reverse** (only where the track ends, §16 Q3): `REVERSE_COST` (6 m, step 6; was "about 2 m") plus the run there
  and back. More than the way round any loop, wye or balloon on a table-sized map.
- **The end-of-line flip** (§16 Q4, Q8): the sim turns the whole train round at the end of the line (`Sim.turnAround`),
  so a plan's reverse keeps whichever end leads (`PlanCosts.flip`).
- **Running engine-last:** ×`PUSH_FACTOR` (1.5). Since the flip keeps the leading end, a plan never starts pushing; a
  train the player set up engine-last is planned as led (`planWay` plans every train led), so it isn't penalised.
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
| A pinned switch is in the way (`pinnedBlocking`) | The train stands short of it (step 5; the lever's pulse not yet) | "A red switch is in the way. Tap and hold it to unpin" |
| More trains than passing loops | Held, as today | "The line is full. Lay 1 more passing loop." (existing) |
| A loop pinned so no one can pass | Held, as today | "Unpin the passing loop's switches so trains can pass." (existing) |
| Waiting for points another train holds | Stops short and waits | "Waiting for the train on the Blue line to pass the points" |
| Two lines' trains on single track with no passing loop (a ring) | Both stand, each at its end of the line (§16 Q3) | "Stuck: the train on the Blue line is in the way. Add a passing loop here" |
| Trains in each other's way for good, a loop there or one line's (a ring; nose to nose) | Both stand (§16 Q3) | "Stuck: the train on the Blue line is in the way. Put one away" |
| A line over room, its held train in the others' way | They stand | "Stuck: too many trains for this line. Put one away or add a loop" |
| A parked train (lever off) at the end of a chain of waits | They stand | "Stuck: a parked train is in the way. Move it" |
| The only way is backwards (a dead end, no loop) | It reverses, as it must | Once per line: "Add a loop at the end so it can turn round." |
| A lever tap on points set for a train (Q1) | They stay set for it; the tap is their new default | "Set for the Red line train. They'll switch to your way after it passes" |
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

0. **#4, independently.** Done (`claude/one-route`). The e2e `E2E_ONLY=routes` (in `e2e:touch`) plans two routes by
   taps on the cards and the map, lifts one train and moves it, then checks both cards, deliveries and a reload. The
   cause wasn't routing: `beginTrainPickup` removed the train and then called `changed()`, whose `economy.prune()`
   dropped the lifted engine's route and line. It now calls `changed()` first. No sim or sections change.
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
   - **Done** (`claude/routing-1`):
     - `graph.ts` holds `waysFrom`, `next`, `distanceTo`, `wayToward`, `SEARCH`, `TURN_COST` (sections and
       route-path import them). `plan.ts` holds `walkTo`, moved from `route-path.ts`: the piece-count walk the map
       draws. `router.ts` holds `steerSwitch`, `steer`, `chooseWay`, `AvoidTest`, `AheadTest` and `Router`.
       `steer.ts` is deleted; its tests are `src/routing/router.test.ts`.
     - `Router` is built by the economy (`economy.router`); `Router.tick` is the old `steerTrains` with its cadence.
       `router.onSwitch` replaces `economy.onSwitch`. A lever tap on points goes through `router.lever`, which
       returns `{ ok }` or `{ refused: "under-train" }`; signals, decks and lifts keep their own path.
     - **The proof:** `scripts/trajectory/trajectory.mjs` (reusable) hashes every Sim's trains and switches each
       simulated second, on `origin/main` and on the branch. Identical: the whole sections QA (256 sims, 106,610 s),
       the play-through on seeds 2027, 1 and 2 with 1 and with 2 trains a line (180 min each), the fast goals
       play-through (175 min, 19/22) and `GOALS_LONG=1` (440 min, 22/22). The QA `SHOW=1` rows are byte-identical
       except for the CLEARCAP microseconds (wall time). `e2e:touch` 76/76.
     - **Cost:** the same steering calls (123,300 on seed 2027, 2 trains a line), at about 10 µs each; an economy
       tick is 2.8 µs on both. With no routed train, `Router.tick` is one size check.
     - **Surprises and differences from §4:**
       - The router has no `setGoal` yet. It asks its host for each routed engine's goal when it steers, in the
         economy's routes order, because a pushed goal could change when or in what order switches are thrown.
         `setGoal` comes with plans.
       - `Sim.trainAhead` and `Sections.switchHeld` stay where they are until step 4. The router reaches them
         through `RouterHost` (`sim`, `heldFor`), and `steerHint` and `steerSoon` through `granted` and `soon`.
       - Vitest 5 hides a passing test's console, so `SHOW=1` rows need `--silent=false`.
       - The §12 harness wasn't started then. It's done at step 2.
2. **Defaults.** Lever taps and laid switches write defaults, which are saved and loaded. Player-path test: tap a
   lever, then save and reload. No behaviour change.
   - **The §12 harness: done** (`claude/routing-2`), test code only (nothing in `src/` outside tests changed; the
     trajectory hashes are identical to main). Defaults: done at `claude/routing-3` (below).
     - `src/routing/harness.ts`: `HarnessRun` builds a `Sim`, `Sections` and a `Router` on a scripted `Layout`, with
       no `Economy`. Its stand-ins, named in its header: routes as stop pieces (come to when an axle is on the stop,
       left when none is; no dwell, so trains run through stops and turn only where the track ends), lines by
       number, sections' speed cap alone, and a save round-trip (a new sim, new car ids, places restored).
     - **Checked every tick:** wrong road (a routed train's front onto facing points takes the way sections granted,
       else one no longer to its target than the best); split (each axle joins the next along the track, by pieces
       and paths); points moved under a train and pinned points moved (`setSwitchState` spied); restore (points
       nobody stands on for 1 s are at the player's default: as laid, or the last lever tap); stuck (a lever-on train
       still over 60 s, or `maxStill`; a held-for-room train is exempt), a wait naming a train that isn't there, and
       sections' 30 s net. Also kept: stops come to, those made pushing, turn-backs by cause, router µs a tick, and a
       hash of the trains each second.
     - **Cases** (`scenarios.ts`, `harness.test.ts`): each invariant and each payoff is its own test; today's
       failures are `it.fails` naming the step to fix them, so that step flips them. The five §8 automations (30
       game minutes, no wait over 20 s, turning only at buffers); the lone train unrouted and routed (trajectory
       hashes recorded at step 1); a follower on the same road, and on the other road through a switch, a wye from
       its branch and a crossover at connector 3; pinned points on the route; a dead-end siding left set for it;
       two lines over a crossover pair; three trains on one loop's line; a lever tap, a save and load, and the stop
       taken up while points are set for a train; controls proving the split, under-train, pinned and stuck checks
       fire. `harness-fuzz.test.ts`: 8 seeds × 5 min over the loop fixtures (`ROUTING_FUZZ`,
       `ROUTING_FUZZ_SECONDS` for long runs).
     - **Expected failures today:** restore everywhere a route throws points (step 4); the follower needing the
       other road takes the first train's road, at a switch, a wye and a crossover, and doesn't reach its stop (step
       5); pinned points in the way: the train shuttles rather than standing (step 5); two single-train lines over
       a crossover pair meet head on in the middle, turn back, and neither reaches a stop in 5 min (step 5).
     - **Passing today:** no split, nothing thrown under a train or pinned, no stuck train and no net in every case
       and fuzz seed; the §8 automations deliver (the balloon engine-first, round and round never turning).
     - **Cost:** the router takes 0.3–2.6 µs a tick in these runs (bound: 25 µs, best of 3). The default cases take
       about 13 s.
   - **Defaults: done** (`claude/routing-3`). No behaviour change: trajectory hashes identical to main (the sections QA
     with its SHOW rows byte-identical, the goals play-through, the harness and its fuzz, seed 2027).
     - `Router` holds `defaults` (§3.4): `lever` writes the tapped way when it allows the tap; `laid()` gives points
       laid since the way they lie and drops those taken up (keyed by `piecesVersion`; called from `Economy.prune`, so
       on every track edit, and before a lever tap or a save). `defaultOf(pieceId)`: no entry is the way the points lie.
       Nothing in routing writes one.
     - **Saved** as `switchDefaults?: [pieceId, state][]`, only where a default differs from the switch's state
       (`Router.save`); loaded by `Router.restore` right after the economy is made. Old saves (no field), and points
       not named, default to the way they lie. An entry for a piece that isn't points is dropped. Save version
       unchanged (13): the field is optional.
     - The harness's own map of defaults is gone: it asks the router, and its save round-trip carries them through
       `save`/`restore` as the game does.
     - **Player's path:** `E2E_ONLY=defaults` in `e2e:touch` (also in the full run): points laid (default as laid), a
       tap on their lever by touch (default the tap's), the points thrown by something else (a harness shortcut
       standing in for step 4's routes), saved on page hide and reloaded: the points lie as saved, the default is the
       tap's. A negative control (restore skipped) fails it. Also `save.test.ts` and the harness.
3. **Shadow plans.** `plan.ts` (piece-count costs) is compared against step 1's choices in the harness and QA, with no
   effect in game. Measure search time.
   - **Done** (`claude/routing-3`). No behaviour change (the hashes above were recorded with the shadow watching).
     - `plan.ts`: `plan(layout, { pieceId, entry, lead }, target, costs)`, a Dijkstra with a binary heap over (piece,
       entry, engine leading), capped at `SEARCH` states, returning the cost and `Step`s (`reverse` where it turns
       back at the end of a line, the engine then at the other end). Pinned switches and decks offer only their set
       way (`waysFrom`). Ties go to the way pushed first, as `wayToward` breaks them. `planChoice` is the choice at
       points (each way's cost through it). Costs are a `PlanCosts`: `PIECE_COSTS` (1 a piece, `TURN_COST` a
       turn-back, no push factor: today's metric) is used now; `MM_COSTS` (path lengths, `REVERSE_COST` 2000 plus
       the run there and back, `PUSH_FACTOR` 1.5) waits for step 6.
     - `shadow.ts`: `ShadowPlans`, set as `Router.shadow` (null in the game; type-only import, so not in the game's
       bundle). Each steer, it finds the next points ahead with a choice (as `steerSwitch` looks), and once per
       approach compares the plan's choice with today's (the granted way, else `wayToward`), keeping each difference
       with why. Plans are cached by (points, entry, engine leading, target) for a key of the layout's `revision`,
       `jointsVersion` and the pins' and decks' states (recomputed only when `switchesVersion` moves). Nothing per
       frame and nothing idle: it runs only inside a steer.
     - **Where it runs:** every harness case and the fuzz (`harness.test.ts`, `harness-fuzz.test.ts`, always on), the
       sections QA with `SHADOW=1` (summary at the end, with `--silent=false`), and exhaustively in `plan.test.ts`
       (every points, entry and target, engine leading or not, on 56 layouts: 5,496 choices).
     - **Findings:**
       - **Harness, fuzz and exhaustive:** the plan agrees with today everywhere except one layout:
         `balloonBehindOpenRoad` (added). `distanceTo` marks a (piece, entry) seen when it's pushed, so a turn-back
         at a switch's open road, pushed first at +12, hides the shorter way round a balloon loop to the same place.
         Its distance is too long (e.g. 17 where it's 8), so today's steering sends the train into a dead-end
         siding to reverse; the plan sends it round the balloon (engine first, no reverse). A train heading away
         from its stop there: 10 of 10 approaches differ; exhaustively, 8 of 5,496 choices, all on that layout. Open roads on points are common in unfinished layouts.
         `distanceTo` also feeds sections (`wayOn`, `unreachable`) and the drawn line, so step 4 should replace it
         there too, or the map and the train will disagree.
       - **Sections QA (`SHADOW=1`):** 27,329 choices, 27,267 agree. All 62 differences are a sections grant: the
         granted way is a passing loop's side road, one piece longer (plan cost 27 vs 28), taken so trains can pass.
         Steps 4–5 make the plan follow the grant inside a granted move. No search difference.
     - **Cost:** QA: 199 plans for 27,329 choices (99% from the cache), 357 searches, 5,248 states, 17.5 ms in all
       (mean 0.09 ms a choice, longest 2.3 ms, a cold first one). Harness: mean 0.1 ms, longest 0.6 ms. A single
       plan on the biggest fuzz layout (31 pieces): 17 µs median over all 961 pairs (bound 1 ms, in `plan.test.ts`).
4. **Locks, setting and restore (#5).** These replace the step-1 wrappers. Delete `steerSwitch`, `trainAhead` and
   `switchHeld`.
   - **Done** (`claude/routing-4`). The first step that changes how trains run.
     - **The plan decides everywhere.** `plan.ts` `planWay(layout, points, entry, ways, target, pinned?)`: the plan's
       choice (`PIECE_COSTS`, ties to the earlier way), cached per layout by the track, pins and decks (a throw of
       unpinned points changes nothing a plan sees). The router's steering, sections' `wayOn` (so `unreachable`) and
       `wayPieces`, and the drawn line (`walkTo`, so `legFromCursor`, `lineLegs`, `pinnedBlocking`) all choose by it, so
       the map and the train agree. `distanceTo` and `wayToward` stay in `graph.ts` only for the tests that compare
       with them (`plan.test.ts`); step 8 deletes them. `balloonBehindOpenRoad`: the train now goes round the balloon,
       never into the siding.
     - **Grants:** inside a granted move, the way sections granted (`follow`) wins at points, as before; that's the
       62 QA shadow differences, now the router's own choice. The shadow (`shadow.ts`, `Router.shadow`) is deleted.
     - **Locks** (`router.ts`; §3.2). Each `STEER_TICKS` (8), a routed train with a goal, driven, and not a line's
       train awaiting a grant (`Sections.awaitingGrant`, §5.2) walks its way from its front: the first points with a
       choice within its set distance (braking distance + `SET_LOOK` 400 mm: past the sim's farthest look through
       points, a red signal's 300 mm, so nothing reads the points before they're set), or any it already holds, then
       every points on to the next clear point (plain track as long as the train, its stop, or the grant's slot). It
       asks for all of them: granted all or none. Each is free or held by others for the same road (shared:
       `holders`), and points that must move have no car on them (`pointsHeld`). Granted, points that differ are thrown
       (`onSwitch`). Refused, it holds nothing new and runs over the points as they lie (today's behaviour; step 5 makes
       it wait): counted in `Router.refused`.
     - **Release behind:** a lock is let go once the train's last car is off its points, having been on them
       (`piecesUnder`), or when the train no longer wants it (its way, goal or direction changed; stopped; awaiting a
       grant; gone, derailed, no longer routed). The last holder gone, the points go back to `defaultOf` (unless
       pinned) with `onSwitch` (the lever swings back with the soft clunk, `softSwitchClunk`, in view), or once a car on
       them is off (`pending`). If another routed train is asking for them the way they're set, the lock passes to it
       with no move. Locks on pieces taken up are dropped.
     - **Lever taps (§16 Q1):** refused only with a car on the points. Points locked for a train (or on its last look's
       way) move; its lock is dropped, and for that train the points count as pinned (`tapped`) until it has been on
       and off them, or it heads elsewhere (a new target or direction): it re-plans with them as they lie, and they're
       never thrown back for it. The tap is the new default. `Router.tappedFor`.
     - **Hand-run trains (§16 Q6)** take no locks and get nothing set. With `trainAhead` gone, points ahead of a
       hand-run or lineless train may be set for a routed one (as `Sections.switchHeld`'s same-line case is now
       covered by §5.2: a line's held train sets nothing). Step 7 makes hand-run trains respect locks.
     - **Load (§4):** locks aren't saved. At the first look after `restore`, a routed train takes locks on points under
       it that aren't at their default, and asks again for those ahead; then points off their default that no train holds
       go back (a route's points saved mid-way). Nothing is put back in the load itself.
     - **Deleted:** `steerSwitch`, `steer`, `chooseWay`, `LOOK_AHEAD`, `Sim.trainAhead`, `Sections.switchHeld`,
       `RouterHost.heldFor` (now `awaitingGrant`), `shadow.ts`.
     - **The proof** (`scripts/trajectory/trajectory.mjs --env TRAJ_SWITCHES=0`: trains only, since restoring points
       changes the switches, not where trains run):
       - **Identical to main:** the lone-train harness hashes (`LONE_UNROUTED`, `LONE_ROUTED` unchanged), every fuzz
         seed, the play-through on seeds 1 and 2 (1 and 2 trains a line) and 2027 with 2 trains a line.
       - **Differ, as meant:** harness `balloonBehindOpenRoad` (the balloon), `leverDuringLock` (the tap sticks), the
         crossover ring (below). Seed 2027 with 1 train a line from minute 129 (two lines, goods and coaches, over
         shared points): every band holds or improves (riders 207 → 242, coins 1104 → 1216, research stall 14.8 →
         13.0 min). Goals play-through from minute 68: 19/22 fast and 22/22 long, each later goal sooner (quarry
         157 → 147, mine 220 → 209, every town 355 → 219, harbour 397 → 295 min).
       - **Sections QA:** 85/85; 42 of 256 sims drift, all with more than one train among a line's (lineless, taken
         off, put down, parked, pinned loops). Meets and releases 0 everywhere. The SHOW rows that change, and why, are
         in rail-road.md. Arrivals over those rows 210 → 225.
       - **Harness:** every step-4 expected failure (restore, in 11 cases and the fuzz) flipped to passing, and new
         payoffs: §8.3's wye set for the mine and put back each visit, the tap sticks, the balloon taken. New expected
         failure: the crossover ring's `wrongRoad` (each locks both crossovers to its clear point, the other is refused
         and runs over them as they lie; before, each threw them for itself and they met head on). Step 5.
       - **Player's path:** `E2E_ONLY=restore` in `e2e:touch` (also in the full run): points laid, their lever thrown
         for the curve, a route Forest, Sawmill planned by taps; the route throws them just before the train, never
         with a car on them; once it's by, the lever swings back to the curve, its swing and soft click both times;
         logs delivered; 0 frames once settled.
     - **Cost:** a look (walk, locks and release) 2.7 µs mean in the harness (157,557 looks), about 90 µs of router
       time per piece a train comes onto (its 8-tick looks while on it); plan choices 37 worked out, 12,399 from the
       cache. QA: 919,853 looks, 5.6 µs each (13,033 locks, 7 refused, 6,016 put back; 1,008 plan choices worked out, 123,597 cached). Nothing per frame: with no routed train and no lock, `tick` is a size check; a
       restore is one `setSwitchState` and a lever swing (0 idle frames, checked in the e2e).
5. **Waits (#3 follow-up).** The `speedCap` overlap stop, `RouteWait`, the card text from §7, and waits fed into
   sections' chains.
   - **Done** (`claude/routing-5`).
     - **The wait** (`router.ts`, §3.3). A routed train whose ask is refused (points locked for another train's road, or
       for the same road coming onto them from the other end; or points that must move with a car on them) holds
       nothing new, lets go any lock it held beyond where it now stops, and waits: `RouteWait { kind: "points", pieceId,
       by }`, `by` the first other holder (or the train on the points). `Router.speedCap` (composed into the sim's cap in
       `Economy.capFor` and the harness) brakes it to stand `STAND_SHORT` (6) + `OVERLAP` (30 mm) short of the first
       points on its way it doesn't hold, measured along the pieces its last walk followed (`gapTo`), so a wait begins
       with normal braking: the ask is made at braking distance + `SET_LOOK`. It never runs over points set against it.
       No wait: one size check.
     - **Hand-over:** when the holder lets go (release behind), a waiter for those points asks again at once, first come
       first served, before any restore: granted, the points move once, straight to its road (§3.2). Otherwise they go
       back to their default as before. A same-road lock is shared only by trains coming onto the points the same way
       (`Lock.entry`; a lock taken on load shares with any).
     - **Red switches (§7):** points pinned on a road from which no way leads to the train's stop, where unpinned they
       would, end its walk: `RouteWait { kind: "pinned" }`, and it stands short of them (before, it ran over them and
       shuttled). The pinned way's plan is the cached `planWay`; only when it leads nowhere is the unpinned one worked out,
       kept per train by the track and switches. Unpinned, it goes on.
     - **Wait chains:** `SectionsHost.routeWait` (`Router.waitingOn`: the engine waited for, and since when). Sections'
       `unring` follows it like a line's own wait (CHECK_TICKS, rings, `YIELD_S`), for a line's train and through a
       foreign train that is itself waiting at points. Rule 2 (§5) holds: a line's trains lock only inside a granted
       move, so a route wait inside a line names a train of another line, or none of one.
     - **Card text:** "Waiting for the Red line train to pass the points" (or "for another train", a name over 14
       characters too); "A red switch is in the way. Tap and hold it to unpin". Both two lines at 360 px
       (`engine-status.ts`, `trainState` kinds `points-wait` and `red-switch`).
     - **Lever taps (§16 Q1, as the user changed it during this step):** a tap on locked points no longer moves them or
       drops the lock. It sets their default at once (from the way they're shown; more taps on the same lock go on
       round, `Router.deferred`), toasts "Set for the Red line train. They'll switch to your way after it passes"
       (`pointsSetFor`), and they go back to it once the train has passed. `LeverResult` gains `{ deferred, by }`.
       `Router.tappedFor` and the tapped-as-pinned walk are deleted.
     - **§16 Q3 (turning):** no new turn-back. Today's breakers are kept as the last resort and counted: the harness's
       `Report.breakers` (sim crossing turn-back "cross", sections' `yielded`, `turnedShort`, `gaveWay`, `clearTurns`);
       the §8 automations assert 0. Where they still fire is in rail-road.md.
     - **Q5 (hand-run trains wait about 15 s while the train in the way moves):** not here. Hand-run trains take no locks
       and get no route wait; their waits are `crossCap` and `clearCap`, which step 7 replaces.
     - **Proof** (`trajectory.mjs --env TRAJ_SWITCHES=0`): lone-train hashes unchanged (`LONE_UNROUTED`, `LONE_ROUTED`)
       and the 8 default fuzz seeds identical; the play-through on seeds 2027, 1 and 2 with 1 and 2 trains a line, and
       the goals play-through fast and `GOALS_LONG=1` (19/22, 22/22), identical to main (no ask is refused there, so no
       train waits). Sections QA: 85/85; 3 of 256 sims differ (B5 park sweeps), SHOW rows the same but two (B5 l0.side
       flips 39 → 38, B5 l0.main ring 2.0 → 1.9 s); meets and releases 0; its 7 refused asks now waits.
     - **Harness:** every step-5 expected failure flipped (the follower at a switch, a wye and a crossover; pinned
       points: stands rather than shuttles; the crossover ring now 19/18 stops, 0 wrong roads, 0 turn-backs but at
       buffers); no `it.fails` left. New: the user's #3 case (two routed trains at one switch, the second stands 0.8 s
       its nose 36 mm short of the points, then goes; the points move once for it and once back), the follower cases'
       waits, and "no turn-back breaks a wait" on the §8 automations and the waiting cases.
     - **Player's path:** `E2E_ONLY=wait` in `e2e:touch` (also in the full run).
5b. **No turn-backs (§16 Q3).** The user: "I would rather they don't turn back, better to get stuck so the player sees
   what's happened." A train turns round only at the end of the track; the automatic flip at a dead end stays.
   - **Done** (`claude/no-turnbacks`).
     - **Removed:** every turn-back that broke a wait: the sim's crossing wait (5 s, `CROSS_TURN_TICKS`), the head-on
       bump's and the side hit's (`meet` now stops the train and records who holds it), the lift's give-way;
       sections' dead-end move (`deadEndCap`; a dead end short of a held train is a wait in the slot), `facing` and
       `aloneIn`'s give-ways, `unring` with its turn-backs and its once-a-minute room hand-over, the lineless train's
       2 s turn-back (`clearCap`), the 30 s net (`MUTUAL_S`), and the stood-still line (`stalledLine`, which counted
       turn-backs). `Sim.turnBack` and the causes `train`/`short` are gone. Head on, two trains stop nose to nose
       `FOLLOW_GAP` apart (`followRoom` looks at the other's front), not touching.
     - **Stalls** (`src/economy/stalls.ts`): every `CHECK_TICKS`, with two trains or more, each standing train with its
       lever on names who it waits for (sections' wait, `Router.waitingOn`, `Sim.heldBy`/`heldHow`, `Sections.clearWait`)
       and the chains are followed: a ring is `in-way`, a chain ending at a train held for room `too-many`, one ending
       at a train standing lever off `parked`. Said after `STUCK_S` (5 s) held: ordinary meets end sooner. Nothing per
       frame; with one train, a size check.
     - **Cards** (§7): "Stuck: the train on the Red line is in the way. Put one away" (or "another train"); "Stuck: too
       many trains for this line. Put one away or add a loop"; "Stuck: a parked train is in the way. Move it". Two
       lines at 360 px (Nunito 700, 14 px, 260 px wide; names over 12 characters say "another train"). The points wait
       reads "Waiting for the train on the Red line to pass the points". The game's once-ever head-on loop tip now
       comes with the first in-way stall (`Stalls.onStuck`).
     - **Not "Add a passing loop here"** for in-way: two lines' trains (each line unmanaged, one train) meet on single
       track whether or not there's a loop (harness experiment: a loop in the middle, two single-train lines, both
       stuck in it). "Put one away" is what works today (§16 Q3, open question).
     - **Layouts changed, as a player would:** the play-through's player reads the cards once a minute and picks up
       the newest train when one is stuck (1 train a line: the people train, which shuttled head on against the goods
       train before); the starter-map play-through puts its hand-run second train away; sections QA's runs of a train
       taken off its line among the line's trains put one away after it's said stuck 10 s (`fix`); the harness's
       `threeTrainsPutAway`. QA's other cases now assert that each train that doesn't keep delivering says what to do
       (`runsOrSays`), not that it shuttles on.
     - **Old saves** load as they are (no migration, version unchanged); a layout that leant on turning back stands
       stuck, its cards saying so (`save.test.ts`).
     - **Proof.** Lone-train hashes unchanged (`LONE_UNROUTED`, `LONE_ROUTED`); §8 automations 0 stalls, 0 stuck.
       Play-through (BALANCE=1, 180 min; main → branch; every band holds):

       | seed, trains a line | coins | City | City ★ | riders | research by 180 | research stall | head-ons | stuck (train-min) |
       |---|---|---|---|---|---|---|---|---|
       | 2027, 1 | 1216 → 1180 | 62 → 64 | 111 → 109 | 242 → 207 | 15 → 15 | 13.0 → 14.4 | 8 → 2 | 1.2 |
       | 2027, 2 | 811 → 1084 | 64 → 65 | 104 → 105 | 265 → 265 | 16 → 16 | 10.7 → 10.5 | 1 → 0 | 1.2 |
       | 1, 1 | 983 → 938 | 61 → 64 | 160 → 158 | 511 → 458 | 17 → 17 | 8.1 → 8.1 | 10 → 2 | 1.7 |
       | 1, 2 | 770 → 842 | 66 → 64 | 177 → 179 | 357 → 371 | 15 → 15 | 9.5 → 9.4 | 0 → 0 | 1.8 |
       | 2, 1 | 786 → 762 | 73 → 73 | 169 → 169 | 458 → 435 | 16 → 16 | 7.2 → 7.2 | 6 → 2 | 1.3 |
       | 2, 2 | 821 → 713 | 89 → 79 | – → 171 | 417 → 355 | 16 → 16 | 7.2 → 6.2 | 0 → 0 | 1.7 |

       Riders fall where the people train is picked up once stuck (before, it shuttled on head on); one stall each run.
       Goals (`GOALS_LONG=1`): 22/22 both; two trains 69 → 69, quarry 147 → 144, mine 209 → 206, every town 219 → 216,
       harbour 295 → 291 min. Sections QA 85/85 (rows, main → branch: B4 arrivals 1520 → 531, all-still > 60 s 0 → 71 of
       71, every one saying why; RND 480 → 246; QB5 746 → 531; PARK 837 → 280; meets the same but LINELESS 0 → 16 and
       stopLine 0 → 2, after the player's Put away leaves the line one train, unmanaged, and the stray meets it nose to
       nose). Long fuzz (200 × 30 min): invariant breaks 8 seeds → 0; stalls on 74 seeds (where main's breakers fired
       on 74), 36 delivering nothing, all said; 4 seeds deliver nothing with no stall, as on main (main 17).
5c. **Single-line working across lines (§16 Q3, the open part).** The user's principle: mistakes are fine, but the natural
   fix must work, and "add a passing loop" didn't for two lines' trains (nothing had them wait for each other at a loop).
   - **Done** (`claude/no-turnbacks`).
     - **Design:** one shared set of sections and slots per network, not a parallel system. Lines whose ways run through
       a slot or section in common (in the topology for the longest train of all) are one network (`Sections.network`,
       transitive; worked out again only when the track, the pins, the lines' stops or their trains change). Its lines
       share one topology (the network's longest train) and each line's `users` are every train of the network's lines:
       a train is granted a section only if no user holds it or stands in it, and a slot only with room, as one line's
       trains always were. So they meet at loops, taking different roads (a loop holds two only to pass). A single-train
       line is managed when it shares a network. The room rule (loops + 1) stays each line's own. Locks and `RouteWait`
       are unchanged: a line's train locks only inside its grant, so the router's own points wait is now pre-empted
       between such lines (it still serves trains sections don't manage).
     - **Trains on no line** (lever on) on a managed network are users too (`loose`): they ask for moves along the way the
       points lie and are sent only onto the road their facing points lie for; a line's train meeting one takes the
       other road at a loop (`restRoad`, from the far points' default). They still stop short of a train ahead.
     - **Cards:** in-way with another line's train (or one on no line) and no passing loop on the line's ways: "… Add a
       passing loop here"; else "… Put one away". The once-ever tip: "Trains met head on. A passing loop lets trains
       pass" (no "with signals").
     - **Proof.** Harness (30 min each, no wait over 20 s): two single-train lines, one loop: 97/97 stops, 0 stuck; three
       lines over two loops: 63/64/64, 0 stuck; a two-train line and a single-train line over two loops: 63/64/64, 0
       stuck; a hand-run train and a line over one loop: the line's 97 stops, the hand-run one 96 turns at the buffers, 0
       stuck; two lines, no loop: both stuck, the card's fix a loop. Trajectories (trains only) identical to 77ffa16 for
       the lone trains, every single-line case, the router's own-lines cases and the 8 default fuzz seeds; only the
       existing two-line cases drift (the crossover ring, two lines head on). Long fuzz (200 × 30 min) against 77ffa16:
       stall seeds 74 → 57 (none new), stalls 96 → 73, in-way trains 80 → 38, too-many 53 → 53, seeds delivering nothing
       36 → 26, invariant breaks 0 → 0. Sections QA (85/85; 52 of 256 sims drift, all with a train on no line among a
       line's, or another line's: OFF k0–k2 arrivals up (e.g. k0 at20 1/2/1 → 1/10/10), LINELESS meets 2 → 0 and the
       line's longest stand 14–15 s → 4–12 s, stopLine head-ons 2 → 0 and stalls 3 → 2, PARK offline stalls 1 → 0, N1's
       "another train is in the way" card samples 44 → 20). e2e `stuck-lines`: two lines head on stuck, the card says to add a loop, the player lays it by
       the tray, they pass and deliver (24 logs).
     - **Play-through** (BALANCE=1, 180 min; main d7308ff → this branch; the balance player keeps the people train on the
       line with a passing loop laid for it; 77ffa16 put it away when stuck). Every band holds:

       | seed, trains a line | coins | City | City ★ | riders | research by 180 | research stall | head-ons | section waits (train-min) |
       |---|---|---|---|---|---|---|---|---|
       | 2027, 1 | 1216 → 1291 | 62 → 64 | 111 → 124 | 242 → 546 | 15 → 15 | 13.0 → 12.5 | 8 → 0 | 0.0 → 27.3 |
       | 2027, 2 | 811 → 1453 | 64 → 65 | 104 → 137 | 265 → 580 | 16 → 13 | 10.7 → 14.0 | 1 → 0 | 0.7 → 79.9 |
       | 1, 1 | 983 → 1511 | 61 → 65 | 160 → – | 511 → 811 | 17 → 13 | 8.1 → 9.7 | 10 → 0 | 0.0 → 81.1 |
       | 1, 2 | 770 → 842 | 66 → 64 | 177 → 179 | 357 → 371 | 15 → 15 | 9.5 → 9.4 | 0 → 0 | 2.1 → 2.0 |
       | 2, 1 | 786 → 1547 | 73 → 73 | 169 → – | 458 → 728 | 16 → 12 | 7.2 → 9.5 | 6 → 0 | 0.0 → 74.1 |
       | 2, 2 | 821 → 713 | 89 → 79 | – → 171 | 417 → 355 | 16 → 16 | 7.2 → 6.2 | 0 → 0 | 33.0 → 1.9 |

       Riders rise where the people train now runs all game; where the goods train waits for it on long single track,
       research by 180 falls (above the floors) and City ★ comes after 180 (an open question, §16 Q3). Goals
       (`GOALS_LONG=1`; the goals player still puts the people train away): 19/22 and 22/22; quarry 147 → 144, mine
       209 → 206, every town 219 → 216, harbour 295 → 292 min (as 77ffa16).
6. **Forward costs (#7, routed)** behind `ROUTE_FORWARD`. Compare balance windows and reversal counts (seed 2027 with
   1–3 trains; seeds 1 and 2 with 2 trains), then switch it on.
   - **Done** (`claude/routing-6`; §16 Q4 answered: avoid pushing unless the player set it up, keep the end-of-line
     flip). `ROUTE_FORWARD` is on (`ROUTE_FORWARD=0` in the environment plans by piece counts, as at step 5, for A/B).
     - `plan.ts`: `ROUTE_COSTS` (`MM_COSTS` on, `PIECE_COSTS` off) is the one cost set: `planWay` (the router, sections'
       `wayOn`/`unreachable`/`wayPieces`, the drawn line's `walkTo`), `plan`'s and `planChoice`'s default (sections'
       reachability), and the harness's wrong-road check. So the plan, steering, sections and the line drawn agree.
       Choices are still cached per layout (track, pins, decks).
     - `REVERSE_COST` 2 m → 6 m. `PlanCosts.flip`: in mm, a reverse at the end of the line keeps `lead` (the sim's
       flip), so `PUSH_FACTOR` only weighs a train already engine-last, evenly; `planWay` plans every train as led, so a
       player-set pusher keeps its route and keeps pushing (the flip turns it whole). No sim change.
     - **Harness** (`FORWARD` in harness.test.ts, 10 min each; `S.FORWARD`): `balloonOverSpur` (a balloon 8 straights on,
       or a 2-piece dead-end spur), `wyeOverSpur` (a wye whose corners a loop of track joins, or the spur),
       `loopOverSpur` (round an oval of short straights to the stop just behind, or back from a spur): each goes round,
       never into the spur, engine first at every stop, turning only at the line's own buffers (the oval never), never
       stuck: 21, 27 and 45 stops. `pushingShuttle` (engine coupled at the back): 50/50 stops made pushing, turns only at
       the buffers. With `ROUTE_FORWARD=0` all three take the spur (6 checks fail: the control); `plan.test.ts` shows
       the same choice both ways, and that the flip never starts a pusher. The §8 automations, the lone-train hashes and
       every other case unchanged.
     - **e2e** `E2E_ONLY=forward` in `e2e:touch` (about 2 min): the `wyeOverSpur` layout put down beside the land
       (harness shortcut), forest and sawmill, the route planned by taps (engine, Plan a route, Forest, Sawmill, Done),
       4 game minutes ticked ahead: logs delivered, round the wye's loop (never on the spur), turns only at the
       forest's buffers, engine first at every stop (16), and the way drawn from the train's front off the sawmill goes
       round the wye. Full `e2e:touch` 121/121 (27.6 min). Control (piece costs forced): 3 of its 5 checks fail (on the spur 7,645 ticks, a turn at the spur
       each trip, the drawn line into the spur).
     - **Play-through:** seed 2027, 1 train a line: identical row to step 5c (coins 1291, City 64, City ★ 124, riders
       546, research 15 by 180, stall 12.5 min). The full A/B table (1–3 trains, seeds 1 and 2) waits for the release
       point.
     - **Cost:** a plan 12.5 → 16.2 µs median (31-piece fuzz layout; float costs); router looks 3.30 → 3.31 µs, 98 →
       101 µs a piece come onto (harness). Choices stay cached (23,557 of 23,618). Nothing per frame.
     - **Not done:** the sim's no-room fallback at the end of the line (no room to turn the train round: its levers
       reversed, so it pushes) still pushes; it isn't the player's setup, but it needs another train in the way. (Done
       at step 7: it waits for room, or is said stuck.)
7. **Hand-run trains respect locks.** Router locks replace `crossClaims` at points, and the crossCap turn-back is tuned
   per Q5.
   - **Done** (`claude/routing-7`).
     - **Hand-run trains** (lever on, no route; on no line or a loose train on a line's network) are looked after by the
       router, with two trains or more on the track (`Router.steerHand`, every `STEER_TICKS`; a lone train costs nothing
       and is untouched). Each walks the points just ahead as they lie (`walkHand`: braking distance + `HAND_LOOK` 80 mm +
       the lead car's inset, facing and trailing, up to points another train is on), and asks for them (`askHand`):
       - free, it locks them **as they lie** (never thrown for it, §16 Q6), so a route can't set them in front of it;
       - locked for another train coming the same way for the same road, it shares the lock (follows);
       - locked for a road that doesn't meet its own (a crossover's other straight, `crossMasks`), it goes on by;
       - otherwise (locked for another's road, or the same road from the other end), it holds nothing beyond, and waits
         `STAND_SHORT` + `OVERLAP` short of them, `RouteWait { kind: "points", by }`, exactly as a routed train does
         (`speedCap`); its card says "Waiting for the train on the Red line to pass the points", and stalls' chains see
         the wait (`waitingOn`). When the holder lets go, the points go back to their default and the hand-run train
         looks again as they then lie (it isn't handed the lock, so nothing is set for it).
       - **Standing, it locks nothing ahead** (and lets go of what it held ahead): only a moving train holds points it's
         coming to, so a hand-run train held by sections (or behind another) never keeps a routed one waiting for it.
         It still stands short of points locked against it.
       - Let go behind its last axle, as a routed train's; a lever tap on points only hand-run trains hold moves them at
         once (§16 Q1), and they look again.
     - **Routed trains** also ask for trailing points (no choice from where they come) when another train holds them, so
       they share them or wait, never run onto points locked for another (the harness's new invariant `lockRun`).
     - **`crossClaims`:** a train the router holds short of points claims nothing there or beyond (`Sim.waitsAt`), so a
       waiter's claim never stops the train the points are set for (a ring). Claims stay as the sim's close-range
       backstop, for diamond crossings and for trailing moves into points nobody has locked; the router's locks, taken
       further out (routed: braking + `SET_LOOK`; hand-run: braking + `HAND_LOOK`), decide first at points.
     - **§16 Q5 (about 15 s while the train in the way moves):** that rule was a turn-back timer (wait, then turn back).
       With no turn-backs (step 5b) nothing of it is left but the wait: a hand-run train waits as long as the train in
       its way holds the points, moving or not, and never turns short of the end of the track. A wait that can't end
       (the holder parked, or a ring) is a stall, said on its card after `STUCK_S` ("Stuck: a parked train is in the way.
       Move it", or in-way). No timer remains anywhere for hand-run trains (`clearCap`'s 2 s turn-back went at 5b).
     - **No room to turn round at the end of the line** (step 6's leftover): `Sim.tick` no longer reverses the levers (it
       pushed back, a setup the player never made). It waits there and tries again every `TURN_RETRY_TICKS` (0.5 s),
       held by the train in the way (`heldBy`, `heldHow` "turn", found by `turnBlocker`: `turnAround`'s room check). It
       turns once there's room; a wait that can't end (that train parked, or waiting on it) is a stall: stalls count a
       train waiting to turn when it's "turn"-held, and its card shows the stuck text rather than "turning back". With
       no train in the way (the track itself has no room) it just waits, its card "turning back".
     - **Harness** (harness.test.ts "step 7"): a hand-run train meets points set for a routed one (`handAtLock`: stands
       7 s its nose 36 mm short, never on them while set for P, then goes as they lie; 2 throws, both the route's); Q5
       (the routed one stands on the points lever off 40 s: the hand-run one waits all of it, said stuck "parked", never
       turns, and goes once it's off); no room to turn (`noRoomToTurn`: a train put down 29 mm behind one at the buffers;
       it waits, "turn"-held, said stuck "parked", engine leading, lever unchanged; driven away, it turns and goes engine
       first). Controls (the hand-run look off, the old lever flip back): all three fail. The `lockRun` invariant holds on
       every case and the fuzz. The §8 automations, `SHARED` and `FORWARD` unchanged in their checks.
     - **crossing-merge** (two lines joining at a switch into the dead-end Y, P's routed, X's hand-run): X's now locks the
       points as they lie and goes in first, P's waiting short, and comes back out to X, so both reach Y (before, both
       stood stuck). X's routed and P's hand-run: still both stuck ("Put one away", the open question in rail-road.md).
     - **Player's path:** `E2E_ONLY=hand-wait` in `e2e:touch`.
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

## 16. Decisions (the user, 2026-10-30)

These override anything earlier in this spec that disagrees.

1. **Lever taps on points** (changed by the user during step 5: routed trains keep their route):
   - The tap is refused only while a car is on the points (`pointsHeld`, as today).
   - Points locked for a routed train don't move when tapped, and the lock stays. The tap sets their default at once
     (the way the tap shows, from how they're set; more taps on the same lock go on round), a soft toast says so ("Set
     for the Red line train. They'll switch to your way after it passes"), and they go back to that default once the
     train has passed.
   - Unlocked points, and points ahead of hand-run trains, move at once, as before.
   - (At step 4 a tap moved locked points and dropped the lock, and the train went as they lay, `Router.tappedFor`. That
     is replaced.)
2. **A following train that needs the other road always waits.** It doesn't go another way, unless waiting would
   cause another problem, such as a deadlock the wait can't clear (§5).
3. **Turning around:**
   - A train turns around only at the end of the track: a dead end, or buffers.
   - It never turns because a train blocks it. It waits instead.
   - This replaces:
     - the turn-backs used to clear waits (the crossCap 5 s turn-back, a lineless train's 2 s turn-back);
     - plans that reverse mid-line to stay engine-first (§6's reverse cost applies only to where track ends);
     - §7's ring toast "went round to let … by".
   - **True deadlocks (the user, after step 5):** "I would rather they don't turn back, better to get stuck so the
     player sees what's happened." No last-resort turn-back: the trains stand, and their cards say what's wrong and the
     fix (step 5b). Two lines' trains on single track now pass at a loop (step 5c: sections shared by the lines on one
     network), so their card says to add one where there's none. Open: the play-through's people train, kept running
     with its loop, slows the goods train on long single track (step 5c's table): cheaper loops, or put it away?
4. **Pushing (running engine-last):** avoid it, unless the player set it up themselves (coupled the engine at the back
   by hand, or pressed Swap ends). Keep the automatic end-of-line flip (Swap ends at a dead end): not realistic, but a
   big quality-of-life feature, as in OpenTTD. Step 6 plans for this: forward costs that strongly avoid running
   engine-last, with the end-of-line flip as the normal way to turn.
5. **Hand-run trains** wait up to about 15 s while the train in the way is still moving.
6. **Routes never set switches for hand-run trains.**
7. **Points going back:** the lever visibly swings back, with a soft click.
8. **Dead ends:** keep today's automatic Swap ends at a dead end. Don't suggest adding a loop.
