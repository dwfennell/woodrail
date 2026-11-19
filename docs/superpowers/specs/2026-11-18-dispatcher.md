# The dispatcher: one place that decides who goes (2026-11-18)

## Status

Design only. Nothing here is built, and nothing will be until the user has read it.

The user (via the routing coordinator, 2026-11-18): per-train rules aren't cutting it, so we're building a dispatcher.

It builds on `2026-11-07-routing-redesign.md` (the reservation core, "§R" below). §R's table, waiting points, release
and one cap stay as written. What §R left to each train asking on its own (§R 3.4: "tried in order of how long the
train has waited") becomes one dispatcher deciding for a whole connected network at once.

The test bar is the eight reference maps and the auto-clear probe, in `evidence/2026-11-18-dispatcher/` (§9).

## 1. Why: what per-train rules can't do

All found on 2026-11-18, on the user's complex map (three saves) and Wren's map. Each rule below fixed the ring it was
aimed at and made another one somewhere else.

### 1.1 The maps have almost nowhere to pass or wait

- **The complex map:** sections' topology (`topologyOf`) finds one passing loop, roads of 432 and 499 mm, which holds
  trains up to about 420 mm. Its two longest trains are 440 and 456 mm. For them, the shared trunk is one two-way
  stretch from end to end.
- **Wren's map:** 134 signals make 42 waiting points; the rest have blocks too short to wait in clear of points. Wren's
  move from its waiting point past Teasel End runs about 55 pieces and 11 sections before the next one.

On such maps, every move a train asks for covers most of the network. Any two trains going opposite ways, or the same
way round a ring, end in a ring of waits. Whether one of them may go depends on the whole network, not on what that one
train can see.

### 1.2 What was tried, and how each failed

1. **The two-way signal check** (`54742bad`, landed and reverted as `e2ad5f37`). Before a signal clears a train, it
   checks the two-way track beyond: if a train is coming the other way or has been let in from the far end, the train
   is held. Claims are made one train at a time, so two trains at once go in order.
   - **With claims that lapse once the train passes its signal:** a train let in at one end ran on toward the part the
     other's way shared, and in that gap a train was let in at the other end. On save 3, two trains then held each
     other at red from signals far apart (pieces 45 and 96), each on the other's stretch, for most of 1800 s.
   - **With claims that hold while the train is on its stretch:** trains standing at stops on each other's long stretch
     waited on each other for good. Save 1 had 17 jams, against 4.
   - **Asked of a signal past the nearest one:** a train held by the check at signal −20, 360 mm on, stood still at
     signal −88, which showed clear (a `greenHeld` break on Wren's map). Asking only within stopping distance made
     every map worse (15–18 jams, `greenHeld` on three maps).
   - **The stand-off flickers:** stalls saw it as "stuck" and then "waiting at a red" every 10 s. So the card
     flickered, and the probe and the player never saw it settle.
2. **First-come at signal waiting points** (Wren). The longest waiter at a stretch's ends goes next. Wren's map got
   worse: 21 jams and 219 arrivals, against main's 16 and 307.
3. **Cross-line follow** (Wren, `cross-line-follow.diff`). A train may go into another line's waiting point behind a
   train that waits only for it and leaves the same way. Wren's own ring rotated, but the map jammed again at once in
   other pairs: 18 jams and 235 arrivals, against 15 and 344.
4. **What the planner never does** (Bluebell, save 3). Bluebell and Wren wait on each other at points 94. Bluebell
   could go straight on round by 53 … 102 and come into the workshop from its other end, which frees Wren. That detour
   costs about 9× the direct way. Nothing re-plans a train while it's held, and nothing in sections manages these
   signalled trains.

### 1.3 The common cause

Each rule asks "may *this* train go now?" with only what it can see. None can answer "in what order should *these*
trains go so that all of them get where they're going?". That needs:
- one view of every train's next moves on a connected network;
- a search over orders, the feasibility search (`feasible`, `86b09469`), as a planner rather than a guard;
- the means to change a train's plan: another road, or a short back-up.

That is a dispatcher.

## 2. What it is

One `Dispatcher` per world, the only place that grants track.

### 2.1 What it knows

- **The reservation table (§R 3.2):** who holds each piece, and each train's held run.
- **Waiting points (§R 3.3)** per train length: loop roads, line ends, sidings, depot tracks, and signals whose block
  fits the train clear of points. A signal whose block is too short is not a waiting point. That replaces today's mix
  of signal slots and "plain behind".
- **Each train's booked next moves:** its plan (`plan.ts`) from where it stands, through its next stop and on to the
  stop after, cut into moves from one waiting point to the next. The plan is redone only on the events in §5.
- **Connected networks:** the components of track that trains' plans share. Each is decided on its own.

### 2.2 What it decides, and when

The dispatcher runs on events (§5), for the networks those events touch.

1. **Grants:** which waiting trains get their next move now. A move is granted all at once, as in §R 3.4, along the
   train's plan to the next waiting point that fits it.
2. **Order:** a bounded search (§5) over the network's waiting trains. **The goal is to keep the most trains
   delivering, with fair turns, and to say who waits for room.** Keeping every train going is often impossible: on the
   reference maps not even a perfect dispatcher keeps all of them going (§12). A grant order is chosen when, after it,
   at least as many trains can still keep reaching their stops as before it, and never one that strands a train for
   good where another order wouldn't. This is `feasible` grown into the planner. The search's state is each train's
   waiting point plus what it holds; its moves are the booked next moves, and the alternatives in steps 4–5. The
   trains it can't keep going wait their turn, and their cards say so (§2.2a).
3. **Fair queues:** among orders that work, the one serving the longest waiter first. Each waiting point keeps a
   queue: the time each train began waiting, and the trains granted past it since (for the card, §7).
4. **Re-routing** when the booked way is blocked:
   - **Held, not stuck:** another way to the next stop, free now, costing at most 1.5× the booked one (the late fork,
     re-plan when held).
   - **Stuck,** where the search finds no order with the booked ways: any way to the next stop that frees what the
     train it waits on needs (Bluebell's straight on).
     - Guard: if the detour passes the stop after next, it serves that stop on the way. The line's service must not get
       much worse.
5. **Back-up**, only when the search finds nothing else:
   - **Length:** a reverse of at most one train length, onto track held and clear for it.
   - **Points:** it may run back over points but never stops on them.
   - **After:** once the other has passed, it goes on the way it was heading, never on in reverse.
   - **How often:** once per train per jam.
   - **Card:** "Backing up to let Muffin by".
6. **No order at all:** the trains stand. The cards say the cause and the fix (§7), and the dispatcher tries again only
   on the next event.

### 2.2a When the layout simply has no room

Often there's nothing clever to find: the complex map's two longest trains fit no passing place on it. The answer is
honest. **One at a time.**

- **Shared track:** a stretch of two-way track with no passing place long enough for the trains that use it is given
  to one train at a time, through to a place it can wait. A train coming the other way waits at its end.
- **Who goes:** the longest waiter goes next, so no train waits for ever. The trains take turns across it; they never
  meet on it.
- **The card says so** in steady words, with the fix:
  - the train waiting: "Waiting its turn for the track to the mill: it has no passing place long enough for two trains.
    A longer loop lets them pass";
  - the train on it: "Has the track to the mill to itself: Bluebell waits at Ashby".
- **The cost:** service slows. Measured on the eight maps (§9), it's the price of no jams. On save 3 of the complex map
  this is where arrivals may fall below main, and §9 allows it only where this card is what the waiting trains say.
- **Not run out of turns:** a train that turns at a line end inside such a stretch holds it until it has come back out
  past its far end. It doesn't hand it on halfway and meet the next one coming in.

### 2.3 What it doesn't do

- **It doesn't move trains itself.** The sim drives them; the cap is §R 3.5's one cap to the end of the hold.
- **It doesn't throw points the player pinned, or route a hand-run train.** Hand-run trains are respected (§4): booked
  as they stand and as their levers take them, never re-routed or backed up.
- **It doesn't turn trains mid-line.** A back-up is a reverse along held track and then on the same way. It isn't a
  turn: the train's direction of travel is unchanged.

## 3. What it retires

Everything that decides grants today, in favour of the one place. Kept as views or inputs: `plan.ts`, `graph.ts`,
`stubs.ts` (short line ends), `via.ts`, `dead-ends.ts`, the topology builders, the room rule as admission, line-end
turning, stall *detection* for the cards, and `followCap` and `resolveContacts` as a safety net.

**`sections.ts` (4,843 lines):**
- `ask`, `grant`, `hold`, `wayOn`, `onwardStretch`, `walkOnward`, `walkAlong`, `alongOf`.
- `comingAt`, `comingOnto`: the single-line rules. They become the search's own constraint.
- `headOnAlong`, `facing`, `aheadIn`, `otherWayRound`.
- `firstCome`, `wantOf`: fairness becomes the queues.
- `feasible`, `feasibleNow`, `nextWaits`: the per-ask guard. It becomes the search.
- The swap planner: `swapCap`, `startSwapMoves`, `stalledForSwap`, `swapWay`, `swapMoveOf`, `liveSwap`, `swapping`,
  `swapHolds`, `turnsNose`, `swapSig`, and `oracle.ts`'s game-side use.
- The convoy and follow rules: `convoy`, `followsInto`, `followsIntoRegion`, `permits`, `follows`, `mayFollow`,
  `circling`, `clearOfCircling`, `sameWayAhead`, `oneWayRound`.
- Step-aside: `stepAside`, `waitsAside`, `refugesOf`, `lettingBy`, `standsAside`.
- `lapYield`, `againstLap`: the lap rule as a guard.
- `recover`, `recoverWait`, `cutMoves`, `clearCap`, `capWith`, `capIn`, `zoneOf`, `sectionUser`, `slotUser`, `inWayOf`,
  `standingOn`, `deadEndWait`.
- `gateAt`, `refreshGate`, `callOnAt`: signals read the hold instead (§R 3.6).

**The router (`router.ts`):** the `Lock` table as its own store (it becomes a view of the hold), `speedCap`,
`pathLocks`, `awaitingGrant`, `steerSoon`, `giveWayRoad`, and points-waits as a source of truth.

**`stalls.ts`:** `giveWay` (both passes), the yield and retry timers, and `otherRoad`. Stall *detection* stays,
reading the dispatcher's wait graph.

**`sim.ts`:** `signalCap`, `pathFor`, the junction-block logic and `crossCap` for trains holding their way. A signal's
aspect is the hold's (§R 3.6).

**Elsewhere:** `routing/give-way.ts`, `boxed.ts` (the convoy excuse), and the per-train skip of unreachable stops
(`Economy.skipShort`). Re-routing covers that; its card stays.

## 4. Rules that hold

1. **Trains turn only at line ends.** A back-up is a reverse along held track and then on the same way, never a turn.
2. **Points are never a place to wait.** No hold ends with a car over points or a crossing, and no back-up stops on
   them.
   - **The one exception, as the game has it today:** a train too long for its own stop's plain track may stand there
     to load with its tail over points ("too long for its yard, its tail is on the points").
   - **Why it must stay:** without it, a train longer than every stop's clear track never comes to a stop. That's true
     of the complex map's 440 and 456 mm trains (§12).
   - **How it's held:** those points stay held by that train while it stands. Its card keeps saying so, with the fix
     (a longer platform).
3. **Placement is forgiving** (§R 3.12a). A waiting point is a stretch, not a spot. Tolerances are in train lengths and
   pieces, never millimetres.
4. **Trains placed by hand are respected.** A train put down mid-line is booked where it stands, and the dispatcher
   plans around it. A hand-run train is never re-routed or backed up. A parked train is track that's taken.
5. **One decides.** No other code holds a train for routing reasons. Every hold names its cause, and the cards read
   only the dispatcher.

## 5. Cost

**Event-driven only, never per frame or per tick.** The dispatcher runs for a network when:
- a train comes within braking distance and `ASK_LOOK` of the end of its hold (a signal or waiting point approached);
- a train finishes at a stop;
- a hold is released (a tail clears a piece someone waits on);
- the track, a signal, points or a lever change, or a train is added, removed or re-routed.

A network where nothing changed costs nothing. A paused game costs nothing.

**Bounded per network:**
- The search's states are each waiting train's position: a waiting point, or "granted to the next".
- At most `DISPATCH_STATES` = 2,000 states per run. That's the size `feasible` already uses (500), scaled for networks
  of up to 8 trains.
- At the cap, the dispatcher takes the best order found so far, if it frees anyone. Otherwise it keeps the current
  holds and tries again at the next event.
- Plans are cached per train by stops, track revision and pins, as `planWay`'s cache is.

**Budget:**
- **bench:tick** on every bug map within +10% of main, at every step of §8.
- **One dispatch** ≤ 1 ms in Node (about 4 ms on a mid phone) at the 2,000-state cap. Measured on the eight maps; the
  98th percentile is reported.
- **Idle and paused:** 0 dispatches, checked by a counter in the probe.
- **Memory:** the table (one `Int32Array` per layout) plus per-train plan caches. No per-tick allocation.

## 6. Fair queues in detail

- **Each waiting point** that a stretch can be asked from keeps the trains waiting there, in order of when they began.
- **Among orders the search finds feasible,** the one granting the longest waiter first wins; ties go by train id. A
  train asking later never takes a stretch a longer waiter at its other end was waiting for (Wren's starvation).
- **The count:** how many trains were granted past a waiter since it began, kept for the card.

## 7. What the player sees

**One steady reason per train.** It changes only when the cause changes, never with whichever train is in the way this
second.
- "Third in line for the track to the mill"
- "Waiting for the line to Teasel End: 3 trains have gone first"
- "Going round by the harbour: the direct way is busy"
- "Backing up to let Muffin by"
- **Stuck, with the cause and the lasting fix:**
  - "Stuck: two lines use the track from Ashby to the mill and it has no passing place long enough. A longer loop lets
    them pass"
  - "Stuck: no place to wait on the way is long enough for this train. A longer loop or a signal further from the
    points lets it wait"

The current blocker is named only under **Show** on the card, which highlights it. Lines are named as the player wrote
them ("the Passengers line's train").

**Optionally:** a signal box shows its area's queue: trains waiting, in order, and who goes next.

**Laying signals:** a block too short for the line's longest train is said on the signal's card and tinted by the
Signal tool: "Too short to wait in for Bluebell (456 mm)". Most of Wren's map's signals are like this.

## 8. Migration

Each step lands on its own, with its gates: routing cases, fuzz:long seed for seed (or improved and explained), npm
test, BALANCE play-through, bug-map replays, bench:tick, the eight maps under the probe (§9), CI.

0. **The test bar in the repo.** The eight maps go into `src/play/bugmaps/reference/` and the auto-clear probe becomes
   `npm run jams` (each map 1800 s; jams, arrivals, per-train longest stand, invariant breaks).
   - A test pins main's numbers as the floor.
   - Not built yet: the maps and the probe sit in `evidence/2026-11-18-dispatcher/` meanwhile.
1. **The dispatcher in shadow,** beside today's rules, deciding but not acting. A disagreement report on the eight maps
   and the fuzz, by kind:
   - it would grant where today's rules hold;
   - it would hold where they grant;
   - it would re-route;
   - it would back up;
   - it finds no order where today's rules jam (expected);
   - it finds an order where today's rules jam (the payoff).

   Reviewed with the user before step 2.
2. **Behind a setting** (dev setting first, then a Settings toggle "New dispatcher"), off by default. The fuzz and the
   eight maps run both ways in CI.
3. **On by default.** The old rules are kept behind the setting for one release.
4. **The old rules deleted** (§3), in a few landable cuts: sections' guards, the swap planner, step-aside, stalls'
   give-way, the router's locks.

## 9. What the eight maps should show

**The maps:** Rowan 1–3, Dandelion, the complex map's three saves, and Wren. They're in
`evidence/2026-11-18-dispatcher/maps/`; probe in `jams-probe.test.ts.txt`.

**Main e2ad5f37** (1800 s, auto-clear: each jam cleared as a player would, one train of a stuck pair put back at its
line's first stop 60 s after 30 s stuck):

| map | jams | arrivals |
| --- | --- | --- |
| complex 1 | 11 | 511 |
| complex 2 | 19 | 430 |
| complex 3 | 12 | 519 (a greenHeld break) |
| Wren | 15 | 344 |

From each save (600 s, no clearing), stops / trains with none / train-seconds said stuck:

| map | stops / none / stuck |
| --- | --- |
| Rowan 1 | 152 / 1 / 869 |
| Rowan 2 | 162 / 5 / 2962 |
| Rowan 3 | 181 / 0 / 218 |
| Dandelion | 173 / 0 / 242 |
| complex 1 | 139 / 3 / 1782 |
| complex 2 | 139 / 2 / 1782 |
| complex 3 | 139 / 2 / 1782 |
| Wren | 75 / 1 / 2405 |

**At each step:**
- **Step 1 (shadow):**
  - The report finds an order on at least the rings §1.2 names: Bluebell and Wren, Wren and Juniper, and the save 3
    stand-off.
  - No order on the complex map's head-ons between the two longest trains.
  - Nothing it would grant that breaks an invariant in replay.
- **Steps 2–3:**
  - No lasting ring on any map. A ring may form, but it's broken within 60 s by a grant order, a detour or a back-up,
    or else the cause is a layout limit and its card says so.
  - Arrivals at least main's on every map, except where trains wait their turn on track with no room (§2.2a). There,
    the waiting trains' cards say so, and the shortfall is listed by map and train.
  - No invariant break on any map.
  - The saved jams in complex 1–3 clear without the player where a back-up or detour frees them. Where they don't, the
    stuck card names the track and the fix.
- **Step 4:** the same numbers as step 3, with the old code gone.

## 10. Risks

- **The search is too big on real maps.** Mitigations:
  - networks split at stations and depots, since a stop is a natural waiting point;
  - the 2,000-state cap with a best-so-far answer;
  - plans cached;
  - the shadow step measures the 98th percentile before anything acts.
- **Re-routing makes service worse:** trains taking detours when a short wait would do. Mitigations:
  - the 1.5× bound when held, not stuck;
  - re-route only on an event, not while the wait is young (`REROUTE_AFTER` seconds);
  - the stop after next is served on a long detour.
- **Back-up surprises the player.**
  - At most one train length, once per jam, only when nothing else works.
  - Its card says why.
  - It's never done to a hand-run train.
- **Shadow disagreements are hard to read.** The report groups by kind and map, with a replay link for each first
  instance, as `shadow:report` does today.
- **Saves:** nothing new is saved. Holds and queues are rebuilt on load (§R 3.2), so a loaded jam is decided afresh.
  That's also how saved jams clear.
- **Two systems at once during migration.** The setting switches the whole decision path, never a mix. CI runs both
  until step 4.

## 11. In plain words

Today every train decides for itself whether it may go, from what it can see. On big maps with few places to pass,
that leads to trains facing each other and waiting for good. Each fix for one kind of jam made another.

The dispatcher is like a signal box for the whole railway. It knows where every train is going. It lets them go in an
order that works for all of them, and it lets the train that has waited longest go first. When the direct way is
blocked it sends a train round another way. As a last resort it has one back up a little. When even that can't help,
each card says plainly what's wrong with the track and how to fix it.

## 12. What the first shadow report found (2026-11-18)

`npm run jams -- --shadow` (branch `claude/dispatch-shadow`, `src/routing/dispatch-shadow.ts`). Each jam today's
rules make on the eight maps, judged by the oracle (`oracle.ts`: every sequence of moves under the user's rules) over
every train on the map. The question: could an order keep them all going, from the jam, or from 30 s before it?

Main e2ad5f37, 1800 s, 141 jams.

**The complex saves:**
- 19 judged, all "layout". From the jam, a perfect dispatcher keeps at most 1–2 of 5 trains delivering together, and
  no more 30 s before.
- On the saved jams, whichever line ends trains may turn at (own, spare, any), only the two free trains keep going. No
  sequence of forward moves frees the three stuck ones.

**Dandelion, Rowan 1–3 and Wren** (6–9 trains): every search hit the 200,000-state cap, taking 30–66 s each.

**What follows:**
1. **The goal** is "keep the most trains delivering, with fair turns, and say who waits for room", not "keep every
   train going" (§2.2, amended).
2. **The back-up (§2.2 step 5)** is the only way out of the saved jams. The next report adds it to the oracle's moves
   and counts the jams it frees.
3. **Cost:** a whole-map search costs four to five orders of magnitude more than the budget (§5). The dispatcher
   decides per stretch: the trains in a ring of waits and those booked onto the same stretches, cut at waiting points.
   On these maps a "connected network" is the whole map, so §2.1's networks must be cut finer than that.

### 12.1 Corrected (2026-11-18, `claude/dispatch-shadow` 07977287)

The first run's "layout" verdicts were partly the oracle's: it never let a train rest with any of it over points, so
the complex map's long trains could never be at their stops. Each stuck train "couldn't deliver even alone".
`oracle.ts` now has `stopOnPoints` (off by default) for the exception in §4 rule 2.

**With it:**
- each stuck train delivers alone;
- from saves 1 and 2 the three stuck together are truly locked, and no single back-up frees them;
- from save 3 (Bluebell's) all three keep going.

**Over 141 jams:** 3 avoidable (complex 2), 3 layout (complex 1–2), none resolvable from the jam, none freed by one
back-up. 135 are unknown: nearly every whole-map search now hits the 200,000-state cap (23–47 s each).

The whole-map oracle can't judge these maps either way. The per-stretch search (§12, point 3) is needed both as the
dispatcher's way to meet §5's budget and as a judge that finishes.
