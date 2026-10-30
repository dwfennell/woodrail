# Train routing: one system, one owner (2026-10-30)

## Status

A design, being built step by step (§13): steps 0 and 1 are done, and step 2's harness (§12). It covers four play-test
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
     trajectory hashes are identical to main). Defaults themselves are still to do.
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

## 16. Decisions (the user, 2026-10-30)

These override anything earlier in this spec that disagrees.

1. **Lever taps on points:**
   - The tap is refused only while a car is on the points (`pointsHeld`, as today).
   - Points that are locked for a train that hasn't reached them yet still move when tapped. That train's lock is
     dropped, and it re-plans or waits.
2. **A following train that needs the other road always waits.** It doesn't go another way, unless waiting would
   cause another problem, such as a deadlock the wait can't clear (§5).
3. **Turning around:**
   - A train turns around only at the end of the track: a dead end, or buffers.
   - It never turns because a train blocks it. It waits instead.
   - This replaces:
     - the turn-backs used to clear waits (the crossCap 5 s turn-back, a lineless train's 2 s turn-back);
     - plans that reverse mid-line to stay engine-first (§6's reverse cost applies only to where track ends);
     - §7's ring toast "went round to let … by".
   - **Still to settle with the user:** what breaks a true deadlock, where two trains wait on each other with no way
     past. The proposal is: a turn-back as the last resort, only when nothing else can clear it, counted in the
     harness (target 0 on the §8 automations), with a card that names the fix (a passing loop).
4. **Pushing (running engine-last):** asked again in plain words. Should a train push its cars from behind for a
   stretch, or should the engine always run round to the front when it can? Until the user answers, keep today's
   behaviour.
5. **Hand-run trains** wait up to about 15 s while the train in the way is still moving.
6. **Routes never set switches for hand-run trains.**
7. **Points going back:** the lever visibly swings back, with a soft click.
8. **Dead ends:** keep today's automatic Swap ends at a dead end. Don't suggest adding a loop.
