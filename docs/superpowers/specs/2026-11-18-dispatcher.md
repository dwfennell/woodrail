# The dispatcher: one place that decides who goes (2026-11-18)

## Status

Design only. Nothing here is built, and nothing will be until the user has read it.

**2026-11-22:** built behind ☰ "Train dispatcher (beta)", off by default. Not on by default: no rule tried since has
cleared the bar on every reference map. Where it stands, what was tried and why it stopped: §13.

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

## 13. Where it stands (2026-11-22)

### 13.1 What's in

- **The dispatcher** (`src/routing/dispatcher.ts`), acting (§8 step 2): holds, grants by the per-stretch search
  (`stretch.ts`), detours, fair turns. It owns the signals' aspects for the trains it holds (`Sim.signalOwner`), and
  keeps a move from stopping inside a path signal's block (`BLOCK_RULE`).
- **The ☰ switch**, "Train dispatcher (beta)": off by default, saved with the game (`dispatcher: true`), its e2e
  `e2e:dispatcher`.
- **A routed train turns back at a stop that ends its line on through track** (`Economy.turnAtLineEnds`): its next stop
  can't be reached going on, but can turned round. The user's two-train map (reference map `user-2026-11-22-two-train`)
  stood for good with the dispatcher on, and ran round the loops for good with it off. Both modes.
- **The jams bar's measures:** `--seeds N` (a seeded run sets each train going 0–9 s late: the sim draws no dice of its
  own), `--against`, the first jam and the stuck-train-seconds before it (`--bar first-jam`), and the decision time.

**The bar for default-on** (the coordinator's, 2026-11-22): 3 seeds, 22 maps, dispatcher on against main with it on.
The first jam no sooner on any map, stops no lower than main's lowest seed, no new invariant break, decision p98 ≤
1.5 ms. Single runs swing ±150 stops a map (each change reshuffles the traffic after it), so a rule is judged on seeds,
and on the first jam: after it, the stops count measures the luck of the jam clearing as much as the rule.

### 13.2 What was tried

Each is on its branch, judged on the reference maps (from the seeds on, on the seeded bar). None landed.

| Rule | Branch | What it did | Why not |
|---|---|---|---|
| A held train waiting on the asker isn't "coming" at its points (router) | `dispatch-starvation` (deleted) | broke dandelion's three-train ring | rowan-2 −186: two trains sent head-on; netActed breaks |
| No grant into a head-on past the stop (by the booked ways) | `dispatch-headon` (deleted) | rowan-2 +161 | own-11 −119 (one-way ring read as head-on), dandelion −171; trains get by on roads the booked ways don't have |
| Back-ups (§2.2 step 5): levers set the other way, a hold along the way back, the card "Backing up to let … by" | `dispatch-backup-2` (deleted; in `dispatch-delivered`) | works as built; rowan-3 +47, rowan-2 +29 | dandelion −77: the search, a stop ahead, counts moving a deadlock a stop on as a delivery |
| A train at its goal head-on into a member isn't delivering | `dispatch-delivered` | own-07 +42, own-11 +45 | rowan-1 −70, complex-3 −48: false positives where the booked ways aren't the whole story |
| …the same, only where the stretch's ways are exact (no points off them) | `dispatch-delivered` | own-07 +42; 20 maps as main | own-01 −16 (its three-train knot, not the rule) |
| …plus back-ups | `dispatch-delivered` | +118 stops over rowan-2, rowan-3, own-07 | first jam sooner on dandelion (234 s, main 318), own-01 (52, 87), rowan-3 (296, 348) |
| Every decision judged two stops ahead | `dispatch-delivered` | — | 16 maps lower; p98 +0.1–0.5 ms; the 500-state cap cuts deeper searches short |
| Wider loop roads (8 m, 60 pieces) | `dispatch-delivered` | — | no change; trains leave their booked ways 2–6 times in 900 s on the busy maps |
| A grant given back isn't granted again for 10 s | `dispatch-veto` (deleted) | wren's first jam later | 13 maps lower; own-02 jams for the first time (1032 s); wrongRoad on own-05, own-06 |
| No grant over points the router has locked for another train | `dispatch-pathblocks` | dandelion +12, wren +15 | 6 maps lower: rowan-3 −76 (first jam sooner), rowan-2 −50, complex-2/3, own-09, user |

### 13.3 The first jams, traced

Main, dispatcher on, seed 1, the three maps that keep recurring:

- **Dandelion** (first jam 312 s): Dandelion and Conker. For 90 s before it, each is granted a move every 1.5 s and
  neither moves: Dandelion stands at a red signal "by Conker", Conker waits at signal 308 for Dandelion. 210 grants
  given back in 600 s.
- **Rowan 3** (405 s): Dandelion granted 360 → 361 → 354 → 133 → 7 every 3 s for 90 s, held at red signal 360 by Conker
  in its block; Conker waits on Dandelion. 115 given back.
- **Own 01** (47 s): Hopper granted the single line through 37 and 35 at 2.7 s, held by the router at points 47 (a
  points wait, "by" Middle); it gives the grant back, and at 7.6 s Middle is granted 33 → 35 → 37 into it. Then the three
  trains on that line wait on each other.

### 13.4 The root cause

Each circle starts where the dispatcher grants a move that the layout's own guards overrule: the router's point locks
and its "a train is coming" rule (`comingAt`), and the sim's path signals reading them. The granted train stands short,
its hold still takes the track, and the train it should let by waits on it. Each rule in §13.2 patches one side, and
the deadlock moves elsewhere.

§8 step 3 assumed the dispatcher replaces sections' holds and that's enough. It isn't, while the router's points rules
still decide on their own beside it: two owners of the same track, judging by different models.

### 13.5 Next design (a proposal, not a plan)

**One owner of all track grants.** The dispatcher grants a move together with the points on it. The router sets the
points as granted and keeps no rule of its own about who goes over them.

Rough steps, each behind the ☰ switch, each judged on the seeded bar:
1. **Measure the disagreement.** Count, per map, the grants the router's locks or `comingAt` overrule (the traces
   above, made a counter, as `leftWay` is). Each later step should bring it to near zero.
2. **Points with the grant.** A grant names the points on its way and how they lie for it. The router throws them as
   the train comes, and `comingAt` and its locks stand down for trains the dispatcher holds. Path signals then read the
   grant alone (the dispatcher already owns their aspect).
3. **The router as a steerer only.** For held trains: no waits of its own, only the way to the next stop for the
   dispatcher's booked ways, and the points set as granted.
4. **Then back-ups and head-on scoring again**, on a model where a grant means the train goes: §13.2's best combination
   was judged where grants were overruled.

**Risks:**
- The router's points rules are what keep trains apart today, with the dispatcher off too. Step 2 must leave them
  untouched for trains the dispatcher doesn't hold (hand-run, parked, dispatcher off), and the jams bar off must stay
  identical to the pins.
- The search's booked ways become the whole truth for the points. Where they miss a road the router used to find
  (rare: §13.2, wider loop roads), a train is held where it went before.
- netActed and wrongRoad: grants and points must never disagree, even for a tick. The invariants already watch both.
- Cost: points with every grant adds work to each decision. p98 is about 1 ms on the big maps today, against a bar of
  1.5 ms.

**Parked: own-08 needs deeper lookahead.** own-08 has four trains on two passing loops and three dead ends, and its
shuttle can only turn at the forest's buffer (points 33 give the branch no way east to the farm). The search looks one
stop ahead per train ("of 4": a goal each), so it can't see a gridlock that forms after those goals. By 41 s, the
shuttle is in loop 1's last free road on its way to turn. The other road holds a train going the other way. One train
is in the forest's dead end, and one is behind the loop.
- **Local rules tried:**
  - Following another train's way past its next stop in `headOnAhead` over-refused: rowan-2 fell to 489 with a
    deadlock, and own-01 and dandelion dropped too.
  - Booking a dead end whole, whichever way a train heads, cost own-01 (52 → 13) and did nothing for own-08.
- **Kept:** a train in a dead end of its own waits there while the one it turns in is busy (`deadEndBy`, 4917a290).
  It took own-08 from 25 to 29, but the gridlock comes back one loop further on.
- **Needed:** a horizon of two stops a train, or a check that a granted state still lets every train reach its next
  stop. Either costs decision time; measure it against the 1.5 ms p98.

At 664f4efe: 25 (23–29), dispatcher on. Main with it off, seeded: 93 (89–100).

**Parked: back-ups (step 4).** Ported from `dispatch-delivered` onto ae745eda (`claude/dispatch-backup-10`, `BACKUPS=0` to switch them off). A train backs at most its length onto free track, rests clear of points, and then goes on its way with its levers back, once a jam. Its card says "Backing up to let X by".
- **They can't free the complex maps' saved starts.** On complex-1, Bluebell and Wren start nose to nose with one piece between them. Bluebell's way runs back over all of the track Wren came by. The search's back-up moves find nothing (2 states), as §12 found for saves 1 and 2: the trains there are truly locked. These starts jam at the same time with the dispatcher off (36–37 s on, 37–42 s off).
- **Elsewhere they fire 0–3 times a map and don't pay.**

  | Map, seed 1 | Stops with back-ups | Stops without | p98 with (ms) | p98 without (ms) |
  |---|---|---|---|---|
  | rowan-2 | 641 | 696 | 1.40 | 0.80 |
  | wren | 510 | 499 | | |
  | rowan-1 | | | 1.70 | 0.96 |
  | user-2026-11-21 | | | 1.54 | 0.81 |

  Wren gains stops but its first jam comes sooner (833 s against 988 s). The extra back-up search takes p98 over the 1.5 ms bar.

**Parked with own-08: own-10.** own-10 has four freight trains on one line with two passing loops, and its sawmill is a two-track yard. Trains turn only at the line's two ends, so each train runs the whole line. At about 6 s, both Logs trains are in loop 1, one in each road, heading east. Planks one is at the sawmill and must go west through that loop to the forest's end to turn.
- Asking `headOnAhead` for a way round all the oncoming trains at once (`claude/dispatch-own10-14`) only moves the knot. Planks one is held east of the sawmill, and the Logs trains then wait on it. That version also broke rowan-2 once in 3 seeds.
- Letting a train go when the train coming at it already waits on it doesn't free own-10 either. It cost rowan-2 its p98 (1.74 ms).
- What's needed is the same as own-08: whether a grant is safe depends on legs past each train's next stop.

Dispatcher on, at d60f8283: 57 (57–58) stops; first jam at 48 s. Main off, seeded: 100; first jam at 302 s.

### 13.6 Deeper lookahead (proposal)

**The problem it's for.** Each of these was a grant that let a train reach its goal and doomed the leg after:
- own-08 (35 against main off's 93);
- own-10 (57 against 100);
- complex-3 (509 against 546), and complex-1's knot at 500 s;
- user-2026-11-21's first jam (fixed by the rebuild rules).

The search scores one goal a train ("of N"), so a state where two trains each reach their stop facing each other on the only way on scores as well as a good one. Each knot so far is two or three trains on single-track legs between passing places, decided one stop too early.

**Local rules tried** (the moving train's own way is in `headOnAhead`; "another's" is the way of a train coming the other way):

| Rule | Result |
|---|---|
| Another's way followed through its stop and turn (all trains) | rowan-2 −198 with a deadlock; own-01 and dandelion lower |
| Another's way to the leg after its stop, only when its hold ends there (`NEXT_LEG`, landed) | complex-1 +76, complex-2 +63 |
| A way round all coming trains at once (`ALL_AGAINST`) | moved own-10's knot; a rowan-2 deadlock |
| Go first when the train coming the other way already waits on this one | no own-10 gain; rowan-2 p98 1.74 ms |
| Admission two stops on (`ADMIT2`, off) | own-08, own-10 and complex-3 no better; rowan-2 −56 |

**The proposal: a safety check over track as resources, after the search, not a deeper search.**
- **Resources:** a stretch's sections, taken from the topology already built (`singleOf`, loops, yards, dead ends). Each single line is a resource of 1 per direction-conflict. Each passing loop counts its roads, and each yard its tracks.
- **Claims:** each held train claims its next two legs, as the sections it must hold at once to get past each conflict, using the booked ways already in hand.
- **The check:** before a grant, test that a safe order exists, as in the banker's algorithm. Find a train whose remaining claims fit what's free, let it finish its two legs, free its sections, and repeat. If any train can't finish, the grant isn't safe, and the train waits where it is (it rests now, by the hold rules).
- **Cost:** O(trains² × sections) per decision; on the big maps that's about 10 trains × 60 sections, well under 0.1 ms. It runs only for decisions that would grant, not for every retry. The search and its 500-state cap are unchanged, so p98 should move by under 0.1 ms.
- **Fit:** it sits where `singleLineBy`, `deadEndBy` and `headOnAhead` refuse today, as one more refusal (`unsafeBy`), and its card can name the train it waits for. Over time it could replace the patchwork of `headOnAhead`'s special cases.
- **Risks:**
  - The claims use booked ways. A train that would get by on a road its booked way doesn't have reads as stuck (§13.2's lesson), so loop roads must count as capacity, not as fixed roads.
  - Turns at line ends mean a leg can double back. A leg that turns claims the dead end until it's out again (§2.2a).
  - Hand-run and parked trains are fixed claims.
- **Size:** about 2–3 days, behind a switch, on the usual seeded bar. The first targets are own-08, own-10 and complex-3; the guard is rowan-2 and dandelion, which were the over-refusal canaries every time.

#### 13.6.1 The one-sided check, parked

`safeOrder` is on `claude/dispatch-safe-17` (36d4482f), off unless `SAFE=1`. Before a grant it moves the stretch's trains a leg at a time, round trains coming the other way. It refuses the grant if a train could no longer reach its stop after next, and only where the asking train can wait.

Seed 1, `SAFE=1` against without:

| Map | With the check | Without |
|---|---|---|
| own-08 | 27 | 35 |
| own-10 | 49 | 57 |
| complex-3 | 497 | 509 |
| complex-1 | 503 | 481 |
| rowan-2 | 670 | 687 |
| dandelion | 791 | 814 |

p98 reaches 1.56 ms. Why it falls short:
- **It moves one train at a time.** Trains really move together, so a train following another, or a loop where the train it would pass hasn't yet arrived, reads wrong.
- **It holds back only the asking side.** The trains it would meet aren't held, and walk into the same knot.
- **own-08 needs an order between two trains,** which a one-sided check can't express: the shuttle waits at its stop until a particular train has come out of the dead end.

#### 13.6.2 Design: two-sided reservation (single-line working)

Real railways solve this with tokens or tablets: a single line between two passing places is one train's at a time, booked whole, and the train coming the other way waits at the passing place. The rule is two-sided because both directions ask the same book. The model:

**Track model** (per layout revision, from the topology already built):
- **Sections:** the plain-track runs between points (`singleOf`'s segments; dead ends included).
- **Passing places:**
  - each road of a passing loop (two or more sections joining the same pair of points);
  - a yard's track (the depot second-track roads);
  - a stop's section, when another train can stand clear of it;
  - a long enough plain section that doesn't block a junction.
  A passing place has room for one train per road; the place's capacity is its number of roads.
- **Blocks:** the runs of non-passing sections (and the points between them) from one passing place to the next. A block holds one direction at a time.

**The book:** each block holds a queue of claims. A claim is a train, the direction it runs the block, and the time asked.
- Same-direction claims share a block: they follow, and the sim's spacing keeps them apart.
- Opposite claims exclude each other: the first in the queue holds it, and the rest wait their turn.
- Passing places count the roads booked into them.

**The rule** (one refusal, `reservedBy`, beside the others in `decide`):
- A move that enters a block must hold it, which means being first of its direction with no opposite claim ahead.
- It must also hold a free road in the passing place at the block's far end.
- Otherwise the train waits where it is, which the hold rules already keep clear of points.
- Claims are made when a train asks for the move (two legs ahead at most, as far as its next stop or turn), and freed as its tail leaves each block.
- A train that turns in a dead end holds that dead end's block until it has come back out past the points (§2.2a).

**Why it's two-sided:** the train coming the other way asks the same book, finds the block held, and waits at its own passing place. Neither side can walk into the knot.

**Order:** the longest waiter first (`stood`), as single lines already work. A claim that can't be honoured within `RESERVE_TIMEOUT_S` (a hand-run train in the way, say) is dropped and asked again, so no claim lasts for ever.

**What it replaces:** if it works, `singleLineBy`, `deadEndBy` and most of `headOnAhead`'s special cases are this, done once.

**Cost:**
- The topology is built per layout revision: blocks and passing places from `singleOf` and the loops.
- Claims update on grants and tail-leaves. The refusal check is a lookup per block on the move: O(blocks on the move), microseconds.
- The search is unchanged. p98 should not move.

**Risks:**
- Capacity: a block taken whole slows a busy line (one direction at a time). This is §2.2a's stated price, and the cards say why.
- Passing-place detection must not miss real ones. A loop too short for a train isn't a passing place for that train: the room rule, by length.
- Trains off their booked ways (detours, hand-run) claim what they stand on.

**Milestones:**
1. Topology (blocks, passing places) with tests on the own maps' known shapes.
2. The book and the refusal, behind `RESERVE=1`; measured on own-08, own-10 and complex-3, with rowan-2 and dandelion as guards.
3. The full seeded bar.
4. Retire what it replaces.

#### 13.6.3 The reservation book, measured and parked

The book is on main, off unless `RESERVE=1`: passing places by junction cluster (`blocks.ts`), the refusal (`reservedBy`), a 10 s timeout, and the "go first when the holder waits on you" rule.

Two agreed rounds, all 22 maps × 3 seeds, dispatcher on at main, without and with the book:

| Map | Book off | Round 0 (312d2619) | Round 1 (f1e756e0) |
|---|---|---|---|
| complex-3 | 509 | 539 | 539 |
| own-08 | 35 | 59 | 61 |
| own-12 | 75 | 91 | 93 |
| complex-1 | 487 | 486 | 493 |
| wren | 556 | 566 | 562 |
| own-06 | 86 | 40 | 55 |
| own-05 | 86 | 50 | 52 |
| own-11 | 255 | 210 | 235 |
| user-2026-11-22-two-train | 177 | 168 | 168 |
| complex-2 | 488 | 474 | 480 |
| own-03 | 49 | 45 | 45 |
| **Net** | | **−67** | **−25** |

- No new breaks; p98 ≤ 1.24 ms.
- The other maps are within 4 stops.

Round 2 varied what another train holds (seed 1, `RESERVE=1`). The columns are:
- **held only:** what it stands on and is granted;
- **ahead 8 / 16:** that, and 8 or 16 pieces of its way on;
- **round 1:** its whole way to its next passing place.

| Map | Off | Round 1 | Held only | Ahead 8 | Ahead 16 |
|---|---|---|---|---|---|
| own-11 | 255 | 236 | 255 | 208 | 201 |
| two-train | 177 | 168 | 178 | 169 | 169 |
| own-05 | 86 | 63 | 87 | 63 | 63 |
| own-06 | 86 | 43 | 82 | 43 | 43 |
| own-08 | 35 | 58 | 35 | 41 | 63 |
| complex-3 | 491 | 542 | 491 | 543 | 543 |
| complex-2 | 490 | 480 | 490 | 480 | 479 |

**Why parked:**
- The losses come from real head-ons within 8 pieces, near the line ends both trains turn at (own-05/06), on one-way rings (own-11), and on the two-train map.
- complex-3's gain comes from refusals at that same range, and own-08's needs more.
- How far a claim reaches can't tell the helpful refusals from the harmful ones.
- The plain dispatcher copes on double track by letting such pairs meet and sorting them out after. Why that works there and not on own-08 is the open question before the book is worth taking further.

`blocks.ts` (passing places, junction clusters) stays: it's a model of "where a train can wait" with uses beyond the book.

### 13.7 Two way-building faults (own-10, own-03)

Found on own-10. Both are on by default, behind switches for measuring.

- **A depot of several tracks** (`YARD_TRACKS=0` turns it off). The route view now gives a train's next stop as the track the economy sends it to (`trackFor`, as the router and sections use), or the track it stands on. Before, it was the depot's own piece. Logs one was planned onto the sawmill track Planks one stood on, with track 2 free, and all four trains were stuck within 10 s.
- **A turned train's way is planned again from its front** (`REPLAN_TURN=0` turns it off). The planner treats a train as a point. So a train that turns at a buffer with its tail still back over points was routed out by the points' other road, which it can't take. `buildTrain` left it unbuilt (`fixed`), and the dispatcher held it for good: own-10's deadlock on the forest's second track. own-03's terminus trains turn the same way.

3 seeds × 22 maps, dispatcher on, against today's (`de7c6f0a`):

| Map | Stops | Jams | First jam |
|---|---|---|---|
| own-03 | 49 → 80 (off: 66) | 19.7 → 28.3 | 60 s (same) |
| own-10 | 57 → 67 (off: 100) | 20.7 → 18.3 | 48 → 74 s |
| own-12 | 75 → 82 | | 162 → 136 s (off: 87) |

- The 19 other maps are unchanged.
- No new breaks; p98 ≤ 1.20 ms. `jams --check` with the dispatcher off is unchanged.

**Measured, not taken: keeping a granted loop road or detour when a train's way is rebuilt** (`KEEP_DETOUR=1`). On own-10 it cuts jams from 21 to 7 a seed, but it costs complex-1 9 stops and rowan-1 9 stops, and gives user-2026-11-21 a jam at 1647 s.

**own-07** loses to the dispatcher-off run through the bar's own clearing. Its anticlockwise train is put back at its line's first stop, between two clockwise trains with no loop between them. The same knot then comes back every 98 s, and only a back-up longer than a train would free it.

#### 13.7.1 `headOnAhead` timed, measured and parked

`clearsFirst` sits behind `TIMED=1`, with `TIMED_CUT=1` for the cut-back below. A move that `headOnAhead` refuses goes anyway if both hold:
- it clears every piece where the two ways cross the other way before the other train could reach the first of them (`TIMED_RATIO` 0.6, `TIMED_MARGIN_MM` 500);
- the other train's grant doesn't reach the crossing yet.

With `TIMED_CUT=1`, a grant into the crossing from far off is cut back to a rest short of it, but only if this move is then granted.

Seed 1, with why each refusal stood (counted by `timedWhy`):

| Map | Stops off → on | Let go | Mostly refused because |
|---|---|---|---|
| complex-1 | 481 → 481 | 1 | the other stands on the crossing (122); it's nearer (2000 mm vs 1000, 70) |
| complex-3 | 491 → 491 | 0 | stands on it (3652) |
| user-2026-11-21 | 546 → 546 | 2 | stands on it (322) |
| rowan-2 | 754 → 691 (7 jams → 19) | 7 | stands on it (1874) |

**Why parked:** the refusals that cost complex-1 its stops are real. The other train is already on the shared track facing this one, or nearer to it. The few moves timing lets through cost rowan-2. complex-1's gap against the dispatcher-off run (481 vs 546) isn't about timing.

### 13.8 The turn queue (2026-11-25)

§2.2a's "the longest waiter goes next", as the code had it, only refused a move onto a single line that another train was
on, or granted onto, heading for its other end. A train *waiting* at the far end didn't count. On a ring with one loop
and two trains going opposite ways (the routing cases' `ring1 2×one opposed`, ten variants) that starved one of them for
good: the train going round asks for the single line while it's still running (`ASK_LOOK` ahead of its hold's end), finds
it free, and is granted it; the one at the loop's far end asks once the line is taken, and is refused. Every lap the same.

**The queue.** A train refused entry to a single line by `singleLineBy` keeps the lines it asked for and the end it was
heading to (`Hold.queued`). A later move onto one of those lines heading for the *other* end isn't granted while that
train still waits there and has waited longer than the mover (a mover under way hasn't waited at all): it waits its turn
at its own end. Followers the same way aren't held (one at a time is per direction, as before).

**What it never does.**

- It doesn't hold a train already on the line: it runs on off it.
- It doesn't hold a train standing on the waiter's way to the line (the waiter couldn't go till it moves).
- A waiter that leaves (granted elsewhere, put away, its route changed) leaves the queue at its next decision.

**Measured (2026-11-25, not kept).** Built behind a switch and run on the routing cases with the dispatcher on (65 wrong
before):

- As written: 65, nothing cleared. The ring's long single line has both its ends at its one loop, so the train going
  round is still *on* it (its tail) each time it asks, and "a train on the line already runs on off it" let it through:
  its grant runs through the loop and back onto the same line from the far end.
- The exception narrowed to the track between the waiter and the line, and "on it" to the line as the move leaves it
  (coming back onto it counts as coming onto it): the waiter gets its turn once, then the other waits 60 s and more and
  breaks `deadlock`; and 12 cases new wrong (line1 2× and 3×: trains queued behind a waiter that couldn't go next).

**What it shows.** The waiter's turn needs the line *and* its way out the far side: the train it let by holds a grant
that runs on round the ring through the waiter's next move, so the turn passes back at once. A queue on the line alone
can't give that. The next attempt books the whole move: a queued train's turn includes the track from the line's far end
to its next waiting place, and a train granted past it is cut back to its last rest before (the §2.2a "through to a place
it can wait", for both). Parked till then.

### 13.9 The turn booked whole (2026-11-25, `TURNS2`, on)

Built as §13.8 proposed. A train waiting `TURN_S` (30 s) on another, refused onto a single line or blocked by that one's
grant (or its locked points), keeps its move: through the line to its next waiting place, and the whole of each single
line on it. The other's grants that would come onto it heading toward it are cut back to the last rest before. Running
along it and off it as it stands is fine; coming back onto it further on isn't (the ring's line, both ends at one loop).

- **Not for a head-on wait** (or nose to nose): there the other must go first. Protected anyway, complex-2's Willow (held
  head-on by Tansy) had Tansy held for its turn and the two jammed: complex-1/2/3 −41/−50/−29.
- **Not after 5 s:** every busy wait on the big maps became a turn (rowan-3 −114, dandelion −77, rowan-2 −62). 30 s keeps
  the ring cases (they starve for minutes); 60 s is past the 60 s stall.
- **Not only same-way:** following a waiter's way isn't cut (one at a time is per direction).

Measured with the dispatcher on: the routing cases 65 → 56 wrong (ring1 2×one/own opposed, nine; none new); the 22 maps
as main (rowan-1 +4, no new breaks, decide p98 ≤ 1.2 ms).

### 13.10 The trap's search, for one line (2026-11-25, `ONE_LINE_SHORT`, on)

Three trains of one line on one loop and two line ends (the trap; the routing cases' `line1 3×one same` and its signal
variants, and most of the fuzz seeds still wrong): the search holds other trains' granted track as taken for its whole
look-ahead, finds none deliver, and any move goes. `TAKEN_FIRST_SHORT` (§ the switch's note: searched again with that track
taken for the first moves only, where the usual search falls short) unties it, but on the big maps it cost dandelion jams.

Gated to where it belongs: three trains or more in the stretch, all of one line, and not a line the swap planner could take
(a spare end: `HANDOFF`'s). On two trains it knotted the ring's signal variants in 7 s (`TURNS2`'s turn is theirs).
Measured with the dispatcher on: the routing cases 56 → 46 wrong (none new); the 22 maps exactly as main.

### 13.11 The road the search found (2026-11-25, `ROAD_FREE`, on)

The search gives a move's node, not its road. The grant was made by the booked road (`pathTo`'s first), so a move the search
found by a loop's other road, round a train standing on the booked one, ran into that train; the single-line rule refused
it, and the two waited on each other for good (line1 2×one same sig:pair, and six like it). Now: the booked road unless a
train stands on it; else the road round, if it's no more than two nodes longer (a loop's other road); only in a stretch of
two trains. Measured with the dispatcher on: the routing cases 46 → 38 wrong (none new); the 22 maps as main, own-01 +20;
rowan-2 over 6 seeds as main. Wider (round granted track too, or any stretch, or any length) cost rowan-2 32-51 stops over
6 seeds: seeds 4 and 5 were sent the long way round the map, 150 stops each.

