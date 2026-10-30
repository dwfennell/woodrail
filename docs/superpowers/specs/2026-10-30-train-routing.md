# Train routing: a system of its own (2026-10-30)

## Status

A design, not yet built. It covers four play-test issues:

- **#3 follow-up:** a following train that needs the other road at points held for a train ahead stops short and waits.
  It never takes the wrong road.
- **#4:** more than one route (each train keeps its own).
- **#5:** routes set switches, then put them back to the player's last hand-set position. Pinned switches are never
  touched.
- **#7:** prefer running forward, and reverse only when the track gives no other way.

The user's bar: **a train taking the wrong road and turning back later isn't acceptable.** So routing becomes one
system, `src/routing/`, with its own test harness. It's built and proven on its own, then wired in step by step (§7).

Decided by the user (issue #5): a switch's **default** is the position the player last set by hand (the last lever
tap). A **pinned** switch is never changed by routing.

## 1. What's there now

- **`Economy.steerTrains`** (`src/economy/economy.ts:1699`). Every 8 ticks (`STEER_TICKS`), and at once for a train
  sections has just granted a move (`steerSoon`), each routed train calls `steerSwitch`.
- **`steerSwitch`** (`src/economy/steer.ts`) looks up to 6 pieces ahead (`LOOK_AHEAD`) for the next real choice. It
  throws that switch toward the stop by `distanceTo`, a piece-count search that allows a turn-back at a dead end for
  `TURN_COST` = 12 pieces. It leaves a switch alone if:
  - a train is on it (`occupied`);
  - another line's granted move holds it (`Sections.switchHeld`);
  - another train is ahead on the way to it, going the same way (`Sim.trainAhead`, #3).
- **What's missing:**
  - Nothing puts a switch back, so the player's layout is left changed (#5).
  - When steering declines to throw a switch, nothing stops the train. It runs on over the points as they lie, takes
    the wrong road, and its route search later turns it back at a dead end. That is the behaviour the user has ruled
    out.
  - The search counts pieces and treats a turn-back as just 12 pieces more. It doesn't know which way the engine faces,
    so a reverse is cheap and pushing is free (#7).
  - A lone unrouted train turns back at buffers and open ends. With other trains about, it also turns back after
    waits: `crossCap` after 5 s (`CROSS_TURN_TICKS`), `clearCap` after 2 s for a lineless train, and the sections yield
    (`YIELD_S`).
- **`Sim.toggleSwitch` / `pointsHeld`** (`sim.ts:630`, `:662`). A lever tap is refused while any car is on the points.
  This is the physical safety rule, and it stays.
- **`Sections`** (`src/economy/sections.ts`) is token working within one line: slots, sections, room and wait chains.
  It hints the steering (`steerHint`: `follow` the granted way, `aim` past it) and holds switches on granted moves
  (`switchHeld`).
- **Switch memory** (`advanceCursor`'s `memory`, `rememberStraddledSwitches`) keeps a train together through points
  entered from the trunk. A wye entered from its branch, or a crossover entered at connector 3, picks its road by the
  lever and isn't remembered, so moving those points under a train splits it.
- **#4:** each engine has its own `Route`, and `lineIdOf` maps it to a `Line` (`src/game/lines.ts`). `startLine`
  replaces only that engine's line. So the cause of "a new route clears the others" isn't known yet. Step 0 of the
  migration starts with a failing test along the player's path.

## 2. What the router owns

The router owns three things, and nothing else writes them.

### 2.1 The plan, per routed train
- A **plan** is the way from the train's front to its next stop: an ordered list of `Step { pieceId, path, entry,
  exit, reverse? }`. `reverse` marks a turn-back at a dead end, where the plan goes on from that point.
- It's found by a search over states `(piece, entry, engineLeading)`, costed in mm (§5). A pinned switch offers only
  the road it's set to, as `waysFrom` does today. Decks, lifts and signals are not choices the router makes.
- It's worked out again only when one of these changes:
  - the goal: `Route.next`, or the line's stops;
  - the layout revision, or the routing version (pins);
  - the train leaves its plan (a lever tap, a hand-run stretch);
  - the train turns: Continue, ⇄, Swap ends, a turn-back.
- The plan also feeds the route-path view (`src/game/route-path.ts`), which works the same way out on its own today.

### 2.2 Locks on points
- A **lock** says which train holds a set of points, and the road it's set to: `Lock { pieceId, state, holders: Set<engine> }`.
- Only points are locked: switch pieces that aren't gated, signals or lifts. The router also takes a **claim** on a
  diamond crossing on its locked way, in place of the sim's `crossClaims`, at a later step (§7, step 7).
- **Route setting:** when a planned train comes within its set distance of the next points on its plan, the router
  asks for every lock on its plan up to the next clear point.
  - The set distance is braking distance `v²/2a` plus `SET_LOOK`.
  - A clear point is somewhere the whole train can stand clear of all points: a slot end for a managed line, else
    plain track at least the train's length long, or its stop.
  - The locks are granted **all or none.**
  - Granting sets each switch to its planned road. `setSwitchState` is called only when the state differs, and never
    while `pointsHeld`.
- **Sharing:** a lock already held at the same road can be shared: a following train needing the same setting joins
  `holders`. Points never move while `holders` is non-empty.
- **Release:** a holder leaves a lock once its last axle has cleared the points (`piecesUnder`). It also leaves when
  its plan no longer runs through them, if it isn't standing on them. When `holders` is empty:
  - If a waiting request wants the same road, it takes the lock with no move.
  - If a waiting request wants the other road, it's granted at once, through the normal all-or-none grant.
  - Otherwise the points are **restored** to their default, unless they're pinned or `pointsHeld`.
- **A train is removed, derails or is put away:** its locks are released.
- **A layout edit:** locks on pieces that are gone are dropped, and every plan is worked out again.

### 2.3 Waits
- A train whose next points on its plan aren't locked to its road gets a speed cap. It stops `STAND_SHORT` short of the
  points' fouling end. This is the #3 follow-up: it waits, it never runs on over the points as they lie.
- The wait names its blocker: `RouteWait { kind: "points", pieceId, by: engine }`, using `nameOf` for the engine. The
  card says "Waiting for points", and sections' wait chains can follow it (§4).

### 2.4 Defaults
- `defaults: Map<pieceId, state>` holds the last hand-set state of each switch.
- It's written by a real lever tap (`interaction.ts:4723` → `toggleSwitch` succeeds → `router.handSet`) and when a
  switch is laid (the state it's laid in).
- A switch with no entry has its current state as its default.
- It's never written by routing.

## 3. API, and how it fits

```ts
// src/routing/router.ts
export interface RouterHost {
  layout: Layout;
  sim: Pick<Sim, "trains" | "findCar" | "piecesUnder" | "pointsHeld" | "ticks">;
  /** Sections' word on a managed line's train: the way it's been granted, if any (today's steerHint). */
  granted(engine: number): { follow: AvoidTest; aim: number } | undefined;
  onSwitch?(pieceId: number): void; // lever swing and sound, as steering's are today
}

export class Router {
  constructor(host: RouterHost);
  setGoal(engine: number, pieceId: number | null): void; // the economy's Route.next, as a piece
  tick(): void;                         // event-driven inside: see §6
  speedCap(train: Train): number;       // composed into Sim.speedCap with sections' cap
  handSet(pieceId: number): void;       // after a lever tap the sim allowed: the new default
  leverRefusal(pieceId: number): "held" | "locked" | null; // gate for lever taps (§8 Q1)
  planOf(engine: number): readonly Step[] | null; // for the route-path view and tests
  waitOf(engine: number): RouteWait | null;
  save(): SavedRouting;                 // defaults only (§3.2)
  restore(saved: SavedRouting | undefined): void;
  prune(engines: ReadonlySet<number>): void;
}
```

### 3.1 What it replaces
| Today | After |
|---|---|
| `Economy.steerTrains`, `STEER_TICKS`, `steerSoon` | `router.tick()`; sections' grant calls `router.wake(engine)` |
| `steer.ts` `steer` / `steerSwitch` | gone. `waysFrom`, `next`, `distanceTo` and `wayToward` stay (sections and route-path use them) |
| `Sim.trainAhead` | gone: a train ahead holds the lock |
| `Sections.switchHeld` | gone: a granted move's points are locked by the router |
| `Sim.pointsHeld` | kept: the physical rule under everything |
| `crossClaims` for routed trains | later, router claims (step 7) |

`sim.ts` gains nothing new. The router is one more term in `speedCap`, and it calls `setSwitchState` through the
layout. `Economy` keeps routes, lines and stops, and passes the goal.

### 3.2 Saving
- The save gains `switchDefaults?: [pieceId, state][]`, with only the entries that differ from the switch's saved
  state.
- An old save has no defaults, so each default is its current state.
- Locks and plans aren't saved; they're rebuilt on load:
  1. Plans are worked out.
  2. Every routed train takes the locks for points it stands on, at their current state.
  3. Points no one holds stay as saved until the next tick's route setting, then restore normally. Nothing is restored
     in the load itself, so a reload never moves points in front of a train.
- Car ids change on load (see rail-road.md), so nothing persistent is keyed by car id. Defaults are keyed by piece id.

## 4. Deadlock rules (with sections and slots)

Sections stay the admission authority for a managed line: which train may enter which section, room, hand-over and
yields. The router never admits or holds a line train for room. It only sets, locks and waits on points.

1. **All or none.** A train asks for every lock to its next clear point at once, and holds nothing ahead while it
   waits; it holds only the points it stands on. Points locks alone therefore can't form a hold-and-wait ring.
2. **Inside a granted move.** For a managed line's train, the router locks only along the way sections granted
   (`granted().follow`). It also never asks before the grant: the clear point is the slot end. Two trains of one line
   never contend for points, because sections already keep them apart, so a line's own deadlock rules are untouched.
3. **Every wait names its blocker.** A points wait is a `BlockWait`-shaped wait with `by` set to the holder's engine.
   Sections' chain following (every `CHECK_TICKS`), ring breaking (`unring`, `YIELD_S`) and the 30 s safety net see it
   the same as a section wait. A line train waiting on a lineless or other-line holder is a wait on a foreign train,
   handled as sections handles foreign occupants today.
4. **Order is first asked, first served, all or none.** If the head request can't be granted, a later request that
   needs none of its locks may be granted, so a waiting train never blocks one going elsewhere.
5. **No early release.** A lock is held until the last axle clears, so a split can't happen, whatever the queue.
6. **Turning breaks a wait, not a lock.** When a wait is broken (a yield or a ring), the train that turns gets a new
   plan. Its locks behind the turn are released only once it's off them.
7. **A train with no plan** (unrouted or lineless) takes no locks and asks for none. It still stops short of points
   another train holds and runs on through points that are free, as they lie (step 7). This is what `crossCap` does
   for meeting paths today, extended to locked points.

Out of scope: plain-track head-on meetings between unmanaged trains. They stay with `crossCap`, `clearCap` and
`hitsSide`.

## 5. Plans that run forward (#7)

The cost is in mm along each path, plus:

- **a reverse** (at a buffer or open end, or a planned turn): `REVERSE_COST`, about 2 m equivalent, plus the run back;
- **running engine-last** (pushing): ×`PUSH_FACTOR`, about 1.5;
- **a pinned switch, a deck or a lift:** fixed, not a choice;
- **a stop on the way:** no cost.

With these costs, a loop, wye or reversing triangle that keeps the engine leading wins over a short reverse unless it's
much longer. A dead-end siding off the way is never entered, because entering it costs a reverse.

The search is a Dijkstra over `(piece, entry, engineLeading)` with a binary heap, capped at `SEARCH` states. It's
memoised per (layout revision, pins, goal, start state), so trains of one line share it.

Unrouted trains (#7's second half) aren't planned. They reverse less because (a) they wait at locked points instead of
turning back and (b) `crossCap`'s 5 s turn-back is reconsidered (§8 Q5). Nothing sets switches for them.

## 6. Cost

- **No routed train:** `router.tick()` returns at once, and `speedCap` is one `size` check. A lone unrouted train runs
  identical to main.
- **Per tick, per routed train:** work happens only when the train's front comes onto another piece, as sections does
  with `look`. The router then checks whether the next points on the plan are within the set distance, and asks for
  locks if so. Between pieces, `speedCap` reads a cached cap. That's a map lookup and a compare, with no search and no
  allocation. A waiting request is retried only when a lock it needs is released (an event), never by polling.
- **A search** runs only when a plan is worked out (§2.1). On the QA layouts it should take ≤ 1 ms on a phone; measure
  it in the harness and record it.
- **Rendering:** nothing per frame. A restore is a `setSwitchState` plus `onSwitch` (a lever swing), and it happens
  only after a train has passed, when frames are being drawn anyway. Idle stays at 0 frames: with no train moving,
  nothing is released, so nothing restores.
- **A lone routed train:**
  - Up to step 5 it takes the same roads as main, because the search's choices match `distanceTo` and the harness
    asserts it.
  - It now restores points behind it. That only matters if it passes them again, and then route setting sets them
    first.
  - At step 6 (forward costs) its roads change on purpose, behind a flag until the balance runs are compared.

## 7. Migration (each step lands alone)

Each step runs: typecheck, vitest, build, a diff of the sections-qa `SHOW=1` rows against main (every change
explained), `npm run e2e:touch`, and the lone-train check.

0. **#4, independently.**
   - Write a failing play-through test: two trains, each given a route by the card buttons, then a save and load.
     Each must keep and show its own route.
   - Find the cause and fix it.
   - Doesn't touch steering.
1. **The harness** (§9), run against today's `steerSwitch`. Known failures (wrong road under a follower, no restore)
   go on an expected-failure list, with the issue number. No behaviour change.
2. **Defaults.** `handSet` from a real lever tap; laid state; saved and loaded.
   - Player-path test: tap a lever, then save and reload; the default is kept.
   - No behaviour change: nothing restores yet.
3. **Shadow plans.** The router plans with piece-count costs (to match `distanceTo`). In the harness and in QA it's
   compared against `steerSwitch`'s choices, with no effect in game. Search time is measured.
4. **Router sets and restores (#5).**
   - Replaces `steerTrains`, `steerSwitch`, `trainAhead` and `switchHeld`.
   - Locks, sharing, release and restore; pinned never touched; lever taps go through `leverRefusal`.
   - Tests along the player's path: a routed train throws points and restores them; pinned points are untouched; a
     follower needing the same road keeps the setting; a lever tap sets the default.
5. **Waits (#3 follow-up).**
   - `speedCap` stops a train short of points locked the other way.
   - The card shows "Waiting for points".
   - Waits are fed into sections' chains.
   - Harness tests: a follower needing the other road, with no wrong road and no split; a ring of two lines at a pair
     of crossovers resolves within `YIELD_S` + 1 s.
6. **Forward costs (#7, routed)** behind `ROUTE_FORWARD`.
   - Run the balance runs (seed 2027 with 1–3 trains; seeds 1 and 2 with 2 trains) with and without the flag.
     Compare windows, count reverses, then switch it on.
7. **Unrouted trains respect locks.** Router claims take over `crossClaims` for routed trains, and the crossCap
   turn-back is retuned per §8 Q5. Count turn-backs before and after.
8. **Clean-up.** Delete what §3.1 replaces; update rail-road.md.

## 8. Open questions for the user

1. **Tapping a lever on points a train is about to use:** should the tap be refused with a toast ("Set for the Red
   line's train"), or move the points and make that train wait or find another way? *Suggest: refuse it, as we do for
   a train standing on the points.*
2. **When a train behind needs the other road:** should it wait for the points, or go another way if there is one?
   *Suggest: go another way only if it's no more than about 1.5× as long.*
3. **Running forward:** how much further should a train go to stay engine-first, rather than reverse? *Suggest: up to
   twice as far.*
4. **Pushing:** is it fine for a train to push its cars for a stretch, or should it always run round where it can?
5. **Hand-run trains:** today they give up and turn back after waiting 2–5 s. Should they wait longer (say 15 s) while
   the train in the way is still moving?
6. **Should a route ever set switches for a hand-run train?** *Suggest no: it goes where you set the levers.*
7. **Points going back:** should the lever visibly swing back, with a soft click? *Suggest yes.*

## 9. The standalone harness

`src/routing/harness.ts`, with tests in `src/routing/*.test.ts`. It builds a `Layout`, a `Sim` and a `Router`, plus
`Sections` where a scenario has a line, but no `Economy`, HUD or render. It reuses `src/economy/loop-fixtures.ts`
builders.

**A scenario** is: a layout script, trains (cars, position, facing), each train's goal list, optional events at given
ticks (a lever tap, a pin, a save and load round-trip, a piece removed), and a tick budget.

**Invariants, checked every tick:**

- **No wrong road:** at every `joint` event of a planned train, its bogie's (piece, path) is the next step of its plan
  at the time it was locked.
- **No split:**
  - consecutive bogies of a train sit on pieces that are joined along the train's way: the same piece, or adjacent
    through the path each is on;
  - the axle distance alone isn't enough, because joint gaps read as splits (rail-road.md §5).
- **Points never move under a train:** `setSwitchState` is spied on, and asserts `!pointsHeld` for points.
- **Pinned points never change.**
- **Restore:** once no train holds or stands on a switch for 1 s, its state equals its default.
- **No deadlock:** no train with its lever on stands still for more than 60 s (or `MUTUAL_S`). Every wait names a
  blocker, and the safety net fires 0 times.
- **The payoff:** each train reaches its goals the scripted number of times within the budget, counted as arrivals
  (and goods, where the scenario has depots).
- **Cost:** search time, and the number of ticks that did work, are recorded and bounded. Timing guards use a warm-up,
  best of N and a median.

**Scenarios** (each a test):

- A lone train through a passing loop, unrouted and routed: identical to a recorded main trajectory.
- One routed train: it throws the points, then they restore after it.
- A follower needing the same road: no move between the trains, and one restore after both have passed.
- A follower needing the other road: it waits short, the points move once the first train is clear, and they restore
  after the follower.
- Pinned points on a route: never moved, and the plan goes the other way or the route is reported unreachable.
- A wye entered from its branch, and a crossover entered at connector 3, with followers (the split cases).
- A reversing triangle and a loop at a terminus: an engine-first plan is chosen at step 6.
- A dead-end siding beside the way: never entered.
- Two lines crossing over a crossover pair: no deadlock.
- A single line with a loop and three trains (with sections): room and holds as today, and no wrong road.
- A lever tap during a lock (per Q1), a save and load mid-lock, and a piece removed under a lock.
- Fuzz: seeded random goals over the loop fixtures, with all the invariants.

The harness becomes the gate for routing changes, alongside sections-qa and the touch e2e. The e2e keeps the player's
path: a lever tap, the route set by card buttons, and goods delivered.
