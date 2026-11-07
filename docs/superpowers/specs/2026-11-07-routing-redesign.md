# Routing redesign: one reservation table instead of five guards (2026-11-07)

## Status

Research and design only. No game code has changed. This was written for the user's concern: "I am a little concerned
about our inability to build a good routing system... we are improving but things break too often. I wonder if you
could take a look at the OpenTTD routing code for inspiration."

**Firm rule (the user):** trains never turn round except at the end of their line.

**Built (2026-11-07, the user: "yes start steps 0-2"):** step 0 (the new invariants, the #31/#32 bug maps and a
liveness check, known lists) and step 2 (the reservation table in shadow, `src/routing/shadow.ts`, and
`npm run shadow:report`). Step 1 is built on its own branch. What each found is in §4.1 below.

**Sources.** OpenTTD's source on GitHub (master, read 2026-11-07 through raw.githubusercontent.com): `src/pbs.cpp`,
`src/pbs.h`, `src/signal.cpp`, `src/train_cmd.cpp`, `src/pathfinder/yapf/yapf_rail.cpp`,
`src/pathfinder/yapf/yapf_costrail.hpp`, `src/pathfinder/follow_track.hpp`, and
`src/table/settings/pathfinding_settings.ini` for defaults. The OpenTTD wiki (wiki.openttd.org) was blocked by this
session's network proxy, so nothing here comes from it.

**Licence.** OpenTTD is GPL-2.0 and Woodrail is ISC. This doc describes OpenTTD's mechanisms in my own words and names
its files and functions so they can be looked up. It quotes no OpenTTD code. Nothing built from this plan may copy,
translate or closely paraphrase OpenTTD code. We take the ideas (path reservation, safe waiting positions) and write our
own code for our own track model, which is quite different anyway: pieces and joints, not tiles and trackdirs.

---

## 1. How OpenTTD does it

### 1.1 Blocks and signals

- **Track** is tiles. Each tile carries up to six short "tracks" (straights and quarter-curves). Points are just a tile
  with more than one track. A diamond crossing is two tracks on one tile that overlap.
- **A block** (`signal.cpp`, `ExploreSegment`) is everything you can reach from a signal without passing another signal,
  through points and all.
- **Block signals** (plain, entry, exit, combo) are red while any train is in the block beyond them.
  `UpdateSignalsAroundSegment` sets them from a flood fill of the block.
- **Path signals** don't care whether a train is in the block. They care whether a path through it is free:
  - At rest a path signal shows red (`UpdateSignalsAroundSegment` leaves reserved path signals alone, and turns path
    signals red if their block has a junction or more than one way in).
  - A path signal turns green only when a train reserves a path through it, and only for that train.
  - Two trains can be in one path-signal block at once, on routes that don't overlap.
- **One-way path signals** can't be passed from behind. **Two-way** ones can be passed from behind, and then act as
  nothing.
- A block that holds any path signal is a "path" block (`SigSegState::Path`). Trains there must hold a reservation.

### 1.2 Path reservation

The heart of it is `pbs.cpp` plus the reservation parts of `train_cmd.cpp` and `yapf_rail.cpp`.

- **What is held.** Each track on each tile has a reserved bit. One bit, no owner stored. The owner is recovered when
  needed by following the reservation to its ends and looking for a train (`GetTrainForReservation`).
- **Taking one track** (`TryReserveRailTrack`) fails if that track, or any track it crosses on the same tile, is already
  reserved. That one rule is what stops two trains holding the same piece of rail, or two crossing tracks, or two routes
  through one set of points.
- **A safe waiting position** (`IsSafeWaitingPosition`) is where a reservation may end. It is one of:
  - a depot;
  - a tile with a block signal facing the train;
  - the tile just before a path signal facing the train, on track with no choice of way;
  - the end of the line (buffers), when allowed.

  It is never inside a junction. A train that stops there can't be standing on track another route needs.
- **The free check** (`IsWaitingPositionFree`) says a waiting position is usable only if it and the next tile aren't
  reserved, so reservations never join up end to end.
- **Reserving a path.** When a train comes to a path signal, or leaves a station or depot in a path block:
  1. The pathfinder (YAPF, `CYapfFollowRailT::ChooseRailTrack`) finds the best route to the train's destination. On the
     way it marks the first safe waiting position along that route (`FindSafePositionOnNode`). It never looks further
     than two signals ahead for it.
  2. `CYapfReserveTrack::TryReservePath` reserves every track from the train to that position, one track at a time.
  3. If any track can't be taken, it un-reserves everything it took in that attempt, puts back any signals it turned,
     and reports failure.

  So a reservation is **all or nothing**. The game is single-threaded and does the whole attempt inside one tick, so
  nothing can slip in halfway.
- **Extending.** `ExtendTrainReservation` walks on from the end of an existing reservation along track with no choice
  of way, until it reaches a safe position (done), a choice of way (handed to the pathfinder), or a reserved track
  (failure, and everything is rolled back). `CheckNextTrainTile` tries to extend as the train enters each tile, and
  every `path_backoff_interval` ticks (default 20).
- **Lifetime:**
  - Reserved ahead, up to the safe position.
  - Reserved under the train (`ReserveTrackUnderConsist`).
  - **Released behind as the last vehicle leaves each tile** (`TrainController`, which calls `ClearPathReservation`).
    The track frees tile by tile behind the tail, so a follower can reserve it at once.
  - Released ahead only in special cases: the train reverses, crashes, is sold, or the track is rebuilt
    (`FreeTrainTrackReservation` walks the reservation from the train's front, un-reserving and turning path signals
    back to red).
- **What a signal shows.** Reserving through a path signal sets it green. The train turns it red as it passes. Signals
  facing the other way along a reserved path are set red. So a path signal is green exactly when a reservation runs
  through it. It can't disagree with the train, because it isn't computed separately: it is part of the reservation.
- **Cost of reserved track to the pathfinder.** YAPF adds `rail_pbs_cross_penalty` per reserved tile (default 3 tiles'
  worth) and a station penalty for reserved platforms (`ReservationCost` in `yapf_costrail.hpp`). This only counts
  for the first few signals of the search. The pathfinder still finds routes through reserved track, but it prefers a
  free road at a loop or a free platform: giving way by choice of road, for free.

### 1.3 When a train can't reserve

- **It stops at the signal.** It doesn't creep into the block. `ChooseTrainTrack` and `TryPathReserve` fail, and
  `MarkTrainAsStuck` sets the `Stuck` flag and stops the train.
- **It retries.** Each tick a stuck train counts `wait_counter`, and retries `TryPathReserve` every
  `path_backoff_interval` ticks (`TrainLocoHandler`).
- **It might turn round.** Only if the player turned on `reverse_at_signals` (off by default). Then the train reverses
  after `wait_for_pbs_path` days (default 30). At block signals the waits are `wait_oneway_signal` (15) and
  `wait_twoway_signal` (41). With the setting off, a train in a path block never turns for a blockage.
- **After long enough it tells the player.** "Train is stuck" news after twice `wait_for_pbs_path`.
- **Lost trains** with no route still reserve to *any* safe position (`TryReserveSafeTrack`, which calls
  `YapfTrainFindNearestSafeTile`). A reservation is never left ending in the open.
- **Turning at a line end** is separate. A train at buffers turns round there (`TrainCheckIfLineEnds` and
  `ReverseTrainDirection`). After turning it drops its old reservation ahead and reserves afresh from where it stands.
  `train_flip_reverse_allowed` decides whether it flips or backs up.

### 1.4 What this guarantees, and what it doesn't

- **No two trains on the same track.** A track bit is held by one reservation at a time. A train moves only onto track
  it holds, and stands only on track it holds. Taking a track fails if any overlapping track is held. So two trains
  can't claim the same rail, the same points or crossing paths.
- **No train commits to a stretch it can't leave.** It enters a path block only once it holds a way through it to a
  safe position. A safe position is never inside a junction, so a train waiting there blocks no route but the plain
  track it stands on. A train never stands on points waiting for a train that waits for it.
- **The signal can't lie.** A path signal's aspect is the reservation.
- **What it does *not* guarantee: freedom from deadlock.** Two-way path signals in the middle of single track, or more
  trains than places to wait, can still jam. OpenTTD's answers are design (one-way signals, enough passing places),
  the opt-in turn-round, and the "stuck" news. It doesn't solve gridlock. It makes it visible and local.
- **The price.** Trains stop at path signals until a whole way to the next safe spot is free. On short blocks that is
  cheap. A badly signalled network just runs slowly, or jams in a place the player can see.

---

## 2. How Woodrail does it today

### 2.1 Five guards, each able to hold a train

Today a train's speed each tick is the minimum of several caps (`economy.ts:2380` `capFor`, then `Sim.move`
`sim.ts:2311`). Every cap is a "stop within braking distance" speed. Nothing reserves track ahead except the router's
locks on points.

| Woodrail | What it does | Nearest OpenTTD idea |
|---|---|---|
| **Sections** (`economy/sections.ts`, `Sections.cap` :670, `ask` :1726, `grant` :1971) | Token working for lines. A move holds the sections from one slot to the next. Release is implicit: other askers scan for the move or for bogies on the pieces. | A reservation from one safe position to the next, kept as a list of sections and found again by scanning. |
| **Slots** (`Slot` :70: loop roads, line ends, signal waiting points) | Places where one train can stand without blocking anyone. | Safe waiting positions. |
| **Room rule** (`line()` :2217: trains ≤ loops + 1, sticky admission) | Stops a line taking more trains than it has places to pass. | None. OpenTTD leaves this to the player. |
| **Router locks** (`routing/router.ts`, `speedCap` :346, `pathLocks` :989) | All-or-none locks on points within `SET_LOOK`, to the next clear point. Released behind the last axle. | Reservation, but only of points, not of the plain track between them. |
| **Sim guards** (`sim.ts`: `followCap` :2528, `crossCap` :2659, `resolveContacts` :2463) | Physical gaps: follow, nose, crossings and switch fouling. | Block signals on every joint. Here they're a last line, not a reservation. |
| **Signals** (`updateSignals` :2006, `signalCap` :2154, `pathFor` :2087) | Plain blocks go red on occupancy. Junction blocks act as path signals, worked out per approaching train from the router's locks. Sections' `gateAt` adds a red for a train without a grant. | Block and path signals, but the aspect is *computed* from three other systems, not *being* the reservation. |
| **"Auto blocks" with no signals** | Don't exist as such. Separation comes from slots and sections for lines, locks for points, and `followCap`/`crossCap` for everyone else. Hand-run and lineless trains are "foreign" or "loose" users with a `zoneOf` (:2656) guessed ahead of them. | None. In OpenTTD, no signals means no blocks. |
| **Waits and stalls** (`BlockWait` :108; `economy/stalls.ts` `tick` :174) | A wait graph built from four sources (router, sections, `sim.heldBy`, `clearWait`). Rings found are reported. | The `Stuck` flag. |
| **Give-way** (`Stalls.giveWay` :280; `routing/give-way.ts`; `Router.giveWayRoad` :884) | On a ring of waits, throws facing points to another road, or **turns a train round where it stands** (`sim.turnNow`, `stalls.ts:319`). | `reverse_at_signals`, which is off by default. |

### 2.2 Where it goes wrong

The problem isn't one bug. **No single structure says who holds which track.** Each of the five guards keeps its own
idea of it, and they agree only as far as the patches between them reach. Each new bug report finds another place where
two of them disagree.

**Bug class A: holds that are too big or reach too far (#29).**
- With no passing place, a network is one big section, so a train is held by a train far away.
- The fix (`332b0cd`, `far-train.txt`) taught `sectionUser` and `heldIn` to count a standing foreign train only if it's
  "along" the asker's way. That's a patch on how a scan reads the section, not a smaller hold.
- Related: a hand-run train circling a ring held the one section for ever (`9fec700`, `clearOfCircling`), and a stale
  wait held a train 11 ticks in 12 (`a0c9d73`).
- In OpenTTD's terms, our holds aren't bounded by the next safe position on the train's own way, and they're found by
  scanning rather than by being recorded.

**Bug class B: a signal that disagrees with its train (#31: "stuck... the signal ahead of it is green").**
- The aspect is put together from block occupancy, the router's `pathLocks` and sections' `gateAt`.
- The gate turns a mark red only when the train stands in *that mark's own* waiting-point slot without a grant.
- A train held by sections anywhere else sees green ahead, while it is being held by the room rule, `firstCome`,
  `facing`, a loop road, a line end, a "too short" signal or a router wait.
- `pathLocks` also treats a line train still waiting for a grant as unrouted (`router.ts:1004-1006`), so the path reads
  clear.
- Earlier versions of the same thing: `e0ab738` (a pair's partner emptied the block, so it was always green), `cc76fbd`
  (a path signal waited on a grant that waited on the signal, signal fuzz seed 11), and `75c7d5a`.

**Bug class C: a signal that makes things worse (#32: "added a signal but all trains are still stuck"; audit B5).**
- A signal splits a section and makes a waiting point that sections and the sim treat differently.
- Audit B5 (`docs/agents/qa/2026-11-06-signals-audit.md`): sections grant a move into a loop road expecting the train to
  run to its far end, but the sim's block working stops it at a red inside the road with its tail on the points. Two
  trains then wait for each other. Still unfixed.
- The mill case (`signals-mill-wait.txt`): a pair at a junction made a waiting point where a line train must ask, and
  it was never granted.
- The signal makes a waiting point that isn't safe, and nothing checks whether it is.

**Bug class D: two holders of one stretch.**
- No structure records an owner, so "double-claimed track" happens in the gaps:
  - a lineless train ran into a loop road a line train was in (QA N2, fixed with `capWith`/`clearCap`);
  - a train waiting for a grant set points (QA B1, `awaitingGrant`);
  - points thrown by a give-way and never taken (`thrownTaken`; seeds 95, 77, 68, 125);
  - `cutMoves` (:2701) cancels a granted move when a train comes to stand on its way. So a grant can be taken back after
    it was given.
- Nothing in `src/sim/invariants.ts` checks "one owner per piece". Head-on contact is stopped only physically by
  `followCap`'s nose gap.

**Bug class E: turning round to break jams (the hacks the firm rule bans).**
- The routing spec's §16 Q3 already says a train turns only at the end of the track. But since `f54d071`,
  `Stalls.giveWay` turns hand-run trains round mid-line when the other road doesn't work (`sim.turnNow`), with
  anti-livelock rules on top: `YIELD_AGAIN_S`, `gaveTo`, and a road give-way retried as a turn (seed 142, `ec76a22`).
- `turnAround` (`sim.ts:2382`) makes a **new train id**, so everything that tracks a train across a turn needs
  `trainKey`.
- Each give-way patch exists because the core let trains into positions they couldn't leave.

**Bug class F: routing-fuzz regressions.**
- The fuzz histories (`harness-fuzz`, `signal-fuzz`, the town-ring fuzz in `economy/give-way.test.ts` with `KNOWN` 15,
  19 and 22 and `KNOWN_LOOP` 8 and 9, and `boxedConvoy` as an excuse) show the same pattern. Each fix moves a stall
  elsewhere, because every guard has to be taught about every other guard.

**What the invariants miss.** I replayed the maps from #29, #31 and #32 on current main (`npm run replay`, 600 s
each). **All the invariants held on all three.** The safety invariants pass, and the bugs the user hits are about
*liveness and truth*: a train held for no visible reason, or a signal that lies. The test net doesn't catch them yet.
(The replays start from the saved state, and the trains made stops, so these jams may not reproduce from a reload on
today's code. I didn't track down #32's exact cause.)

### 2.3 What's good and should stay

- **Slots are the right waiting points** for track used both ways. A loop road or a line end is where a train can stand
  while another passes.
- **The room rule is real deadlock avoidance** that OpenTTD lacks. With trains ≤ loops + 1 on a line, the token argument
  holds.
- **The pieces-and-joints graph, the planner (`plan.ts`, `planWay`), via points and stickiness** are fine. Routing *which
  way* isn't the problem. Keeping trains *apart* is.
- **Locks are all or none and released behind the last axle.** That's half of a reservation already.

---

## 3. The proposal: a reservation core

### 3.1 The one rule

> **A train moves only along track it holds, and it holds track only from where it stands up to a waiting point.**
> It takes the hold all at once or not at all, and gives it back piece by piece as its tail clears.

Everything else (signals, cards, stalls, the router's points) reads the hold. Nothing else keeps its own copy.

### 3.2 The reservation table

- **Unit: the piece.**
  - A plain piece, a switch (all its paths), a crossing (both paths) and a slip are each one unit.
  - Holding a switch or crossing whole is coarser than OpenTTD's per-track bits, but wooden pieces are short, and it
    makes "crossing paths" and "fouling" the same rule as "same piece". That deletes `crossCap`'s fouling logic for
    trains that hold their way.
  - A turntable, lift-bridge deck or ferry deck is one unit, and can't be held while it's moving or raised.
- **Owner stored.** `owner: Int32Array` indexed by piece id (−1 = free), plus per train an ordered list of held pieces
  from tail to reservation end, with the path through each.
  - Unlike OpenTTD we store the owner. JS has no desync concern, and "who holds this" becomes a lookup, not a walk.
- **Train identity is stable.** `turnAround` keeps the train's id (step 0), so a hold survives a line-end turn.
- **Derived, not saved.** On load the table is rebuilt: hold the pieces under each train, then each train reserves
  ahead. No save-format change.
- **The table also stores the path set through each held switch,** so "points are set for the train that holds them"
  is the same fact as the hold. Router `Lock`s become views of it.

### 3.3 Waiting points (safe positions), Woodrail's version

A waiting point is where a reservation may end. It must be a place where the train, standing, blocks no route but
plain track. **And**, because our players run trains both ways on single track with few signals, it must not let two
trains face each other with nowhere to go. So, for a train T:

1. **Slots** (from today's `buildTopology` and `findLoops`): a loop road, a line end (buffer or open end, back to the
   first choice of way), a dead-end siding, and a depot track. T must fit (`trainLength + ROAD_MARGIN`, as now). At a
   loop the pathfinder prefers the free road, as OpenTTD's reserved-track penalty does. That is "giving way by another
   road", done at reservation time instead of after a jam.
2. **A signal facing T,** but only if the track behind it fits T clear of points (so B5's signal inside a loop road is
   not a waiting point for a train whose tail would be on the points), *and* the stretch beyond the signal is one-way
   for the trains that use it (rule 3). A signal that fails either test is passed by the reservation: it shows green
   for the train holding a way through it, and its card says why it isn't a place to wait ("Too close to the points to
   wait here", "Trains come both ways here: a train waiting here would meet one head on").
3. **Automatic waiting points on one-way stretches.** Take a stretch of plain track that every user of the network
   runs the same way: a one-way circuit (today's `oneWayRound`), or a one-way loop road. There, every joint where T fits
   behind clear of points is a waiting point. That gives close following ("moving block", one piece at a time) with no
   signals. It replaces `follows`, `circling`, `clearOfCircling` and `sameWayAhead`. On track used both ways, waiting
   points are slots only. That is what stops two trains meeting head on mid-line, with no signals placed.
4. **The end of T's own line, behind a standing train (§16 Q9).** If T's route turns round at a line end and that end is
   occupied by a stopped train, T may reserve up to that train's tail and turn there. This is only at a line end, where
   T would have turned anyway.

Waiting points are a derived map, keyed by (layout revision, signals version, pins, train-length bucket). It's built
when those change, like today's `topologyOf`. Rule 3's "one-way" set is keyed by the network's users' routes as well,
and rebuilt when a route or a lever changes.

### 3.4 Taking and extending a reservation

- **When:** a train asks only when one of these happens:
  - its front comes within braking distance + `ASK_LOOK` of its reservation's end;
  - something it waits on is freed (a wait list keyed by blocking piece);
  - the layout, its route, the points or its lever change.

  There's no asking every N ticks.
- **How:**
  1. Walk the train's way from its reservation end, via `planWay` at each switch, as now.
  2. Stop at the first waiting point (§3.3) that is free and whose next piece is free (OpenTTD's "reservations never
     join").
  3. Take every piece in one pass. If any is held by another train, take none, and record that train as the blocker.
  4. Bound the walk (`RESERVE_MAX` pieces, about 60). Past that, the way is too long to hold and the train waits with
     the card "No place to wait on the way: add a loop or a signal".
- **Order and fairness:** reservations are tried in order of how long the train has waited (`waitSince`), then by train
  id. That keeps today's `firstCome` fairness as a property of the queue, not a rule inside `ask`.
- **The room rule stays** as admission before the first reservation of a line's train. A held train simply doesn't
  ask. It's the one deadlock-avoidance rule the core keeps, because reservations alone don't prevent too many trains on
  too few slots (§1.4).
- **Points:** taking a switch sets it for the path. Releasing it puts it back to the player's default, as today (§16
  Q1, Q7). A lever tap on held points sets the default for after (as today). A tap on points not held moves them at
  once.

### 3.5 Moving

- **One cap:** `sqrt(2·a·d)`, where `d` is the distance from the front to the reservation's end minus `STAND_SHORT`.
  It's kept as a running number, cut as the front advances and grown when the reservation extends. O(1) per train per
  tick.
- This replaces `Sections.cap`, `Router.speedCap`, `signalCap`, and `crossCap` for any train holding its way.
- **`followCap` and `resolveContacts` stay** as a physical safety net, and as the rule for coupling (a train told to
  couple may run onto the other train's held piece). If the safety net ever has to act, that's a bug: a new invariant
  (§4, step 0) fails.
- **Release:** when the tail bogie leaves a piece and the piece is still held by this train, free it, set its points
  back and wake that piece's waiters. This is detected from the cursor, which already knows piece boundaries.

### 3.6 Signals

- **One kind:** every signal is a path signal in OpenTTD's sense. The player never picks a type, which is already our
  rule.
- **The aspect is the reservation.**
  - A signal with a train coming to it is green if, and only if, that train holds a way past it.
  - At rest (no train coming), it shows green if the pieces just past it are free. That keeps "path signals green at
    rest", the user's earlier pick.
  - Worked out only when the reservation version changes.
  - This deletes `gateAt`, `refreshGate`, `pathFor` and the block flood fill for aspects.
  - A train can't be held at a green signal, because there's nothing else to hold it. That's #31's class gone by
    construction.
- **Held by hand ("Always red", a tap):** no reservation may pass it. If it's a waiting point, a reservation may end at
  it. If not, the reservation fails before it, at the previous waiting point. A train is never left standing on points
  for a held signal.
- **"Always green":** the signal's waiting point doesn't count as one (reservations run through), but the pieces beyond
  must still be free. Green never lets two trains onto one piece.
- **Hand-placed rings of signals** with too many trains still jam. That's a real deadlock, and it shows the stuck card
  "Too many trains for these signals" (as today, B6).

### 3.7 With no signals (what "automatic blocks" become)

There are no block objects. A young kid's layout gets:
- holds from slot to slot on track used both ways (passing at loops, waiting in sidings and at line ends);
- piece-by-piece following on one-way circuits and one-way roads;
- points held only by the train going through them.

That is what sections, the router's locks and `followCap` give today. The difference is that one table gives it, so
the parts can't disagree. A long single line with no loop is one hold from end to end. It's the only safe answer, and
the card says to add a loop.

### 3.8 Junctions and points

- A train never stops on a switch or crossing it doesn't hold, and never waits on one: waiting points are clear of
  points by definition.
- Points are held whole. Two routes through one switch never run at once.
  - At a big junction that serializes a little more than OpenTTD's per-track bits.
  - For toy layouts with short pieces, that's fine. If it ever matters, a switch can later be split into per-path
    units with an "overlaps" table. The rule stays the same.
- Facing points: the reservation picks the way when it's taken (`planWay` plus the free-road preference at loops).
  Trailing points: there's no choice, but the switch must be held and set.
- Diamond crossings, slips and the double three-way: one unit each.

### 3.9 Stations, depots and kit stops

- **A stop on a slot** (a loop road, a line end, a siding, a depot track) is a waiting point. A train can load there for
  as long as it likes ("wait for full load") without blocking anyone.
- **A stop mid-line on track used both ways** isn't a waiting point. The train must hold its way *past* the stop to the
  next waiting point before it enters the stop ("arrive with an exit"), as OpenTTD does at a platform that isn't a safe
  position. So a train standing to load mid-line never blocks a train it is also waiting for.
  - The cost: on a single line with a mid-line station, the next train waits at the loop until the first one has left
    and cleared.
  - That's correct single-line working, and the card can say "Waiting: the line ahead is single track".
- **Depot tracks** (Second and Third track) are slots. The reservation takes the first free one, as OpenTTD picks a
  free platform. The one crane serving a train at a time is an economy rule and is unchanged.
- **Dead ends:** a dead end is one unit for entry, as today (`2411089`): a train holds the mouth and the road to the
  buffer. Convoys into a dead end stay one train at a time, with the "add a passing loop" card (§16 Q10).

### 3.10 Hand-run and lineless trains

- They reserve too, along the points **as they lie**, to the next waiting point. There's no route, so there's no
  choice: like an OpenTTD train with no orders.
- If a switch ahead is held by another train against them, they wait. That's today's `askHand` rule.
- **The lever reversed by the player** is the one turn mid-line, and the player makes it, not the game:
  1. Drop the hold ahead.
  2. Keep the pieces under the train.
  3. Reserve the other way.
  4. If that fails, stand and wait.
- This deletes the "foreign", "loose", `zoneOf`, `clearCap`, `CLAIM_TICKS` and `capWith` cases. Every train is the same
  kind of user of the table.

### 3.11 Deadlock: no mid-line turns

- **Prevention:**
  - slots as the only two-way waiting points;
  - the room rule;
  - "arrive with an exit" at mid-line stops;
  - waiting points never on points.

  Between them these remove the jams the give-way code was written for: the ring of waits on single track, and a tail
  on the points.
- **What remains:** player-made jams. A ring of signals with too many trains, an Always-red signal, a lever left off,
  a route whose way is blocked by a parked train.
- **Detection** gets simple and exact. Every failed reservation names its blocker (the owner of the first piece it
  couldn't take, or the held signal, or the room rule). The wait graph is read straight from that. `stalls.ts` keeps its
  ring and chain reporting and its cards, but it no longer merges four sources or guesses.
- **Nothing turns a train mid-line,** ever. `Stalls.giveWay`'s `turnNow` pass, `otherRoad` after a jam, `letsBy`,
  `thrownTaken` and the anti-livelock timers are all deleted. A true deadlock stands, and the cards say what's wrong and
  the fix, which is the user's own choice (§16 Q3: "better to get stuck so the player sees what's happened").
- **Line-end turns stay:** the automatic flip at buffers and open ends, and the Q9 "standing train is the end of the
  line" turn. "Reverse on a ring line" and "Swap ends" stay too, because the player asked for them.

### 3.12 Toy scale and careless signalling

- Pieces are short and trains are a few pieces long, so holds are small, and following piece by piece is close enough
  to look natural.
- Players place few signals and place them badly. Under this design a badly placed signal **can't make things
  unsafe**: §3.3 ignores it as a waiting point, and its card says why. At worst it does nothing. Today it can create B5
  or the mill jam.
- Slots carry the network with no signals, so a kid never needs one.

### 3.12a Forgiving placement: never too particular about where a train stands

**The user (2026-11-07, on #31's map):** "I feel like we are being too particular about exactly where our trains are
positioned." In #31, a signal placed inside a loop road stopped a train with its tail over the points, and that made a
real jam. Players lay track and signals roughly. The game makes them work, and the rules say so:

- **A waiting point is a stretch, not a spot.** It's the length of plain track a train stands on clear of points: a
  slot, a signal's approach, a one-way run (§3.3). Where on it the train's nose comes to rest doesn't matter.
- **Tolerances are in train lengths and pieces, never millimetres.** A rule asks "does the train fit, clear of points,
  with a piece to spare?". It never asks "is the nose within 6 mm of the joint?". No behaviour may hinge on fractions of
  a millimetre: rounding in where a train came to rest must never decide whether it may go. That kind of rounding, and
  stop points worked out to the millimetre, are #31's class.
- **A train held at a signal stands clear of points.** If its tail would be over points behind it:
  1. **Pull forward:** if the track past the signal, up to the next points, is free and fits the rest of the train, its
     booking ends there instead (the signal is passed, shown green for it, and its card says so).
  2. **Else stop short:** the booking ends at the last joint behind those points where the whole train fits, as if the
     signal stood there. In effect the signal's stop point snaps back to where the train fits.
  3. **Else the signal can't hold a train here:** for trains of that length it's passable (§3.6). Its card says why
     ("Too close to the points to stop a train here") and the Signal tool's tint shows it while placing.
- **Points are never a place to wait.** A booking never ends with a car over points or a crossing (§3.3). So a train
  held anywhere blocks only the plain track it stands on. The shadow counts how often today's guards break this
  (`held-on-points`, §4.1).
- **Line ends and stops forgive too.** A train that fits a slot with room to spare stops anywhere in it. One a few mm
  too long for a loop road isn't sent in to foul the far points: it's treated as not fitting (decided in pieces, with
  `ROAD_MARGIN`), and its card says the loop is too short for it.
- **Cases this covers:**
  - a signal inside a loop road (audit B5, #31);
  - a signal just past points;
  - a signal on a short spur;
  - a train a little longer than the gap between two signals;
  - two signals on adjacent joints;
  - a train coming to rest a hair past a stop point;
  - a stop piece right beside points;
  - a depot track shorter than the train.

  In each the train ends up clear of points or isn't sent in, and nothing depends on where within a piece it stopped.

### 3.13 Phones' CPU budget

- **Per train per tick:** one cap from a running distance, plus a piece-boundary check on the tail for release. That's
  cheaper than today's `Sections.cap` path, which has O(trains) scans per ask (`inDeadEnd`, `inWayOf`,
  `standingOn`).
- **Event-driven asks:**
  - near the end of the hold;
  - woken by a release of the piece waited on;
  - on a layout, route or points change.

  A jammed or idle network asks nothing. That suits "not while paused or idle".
- **A reservation walk** is bounded by `RESERVE_MAX` pieces. With a typical 5–20 pieces per walk and asks a few times
  a second per moving train, it's well under a millisecond on a phone. This needs measuring in step 1, as AGENTS.md
  asks.
- **Signals' aspects** are worked out on the reservation version only. One number to compare per frame.
- **Memory:** one `Int32Array` per layout (the piece count) plus small per-train arrays. No per-tick allocation.
- **Waiting points** are rebuilt only on layout, signals or routes change, and cached like `topologyOf`.

### 3.14 What stays and what's deleted

**Stays:**
- `routing/graph.ts`, `plan.ts` (`plan`, `planWay`, costs, stickiness), `via.ts`, `dead-ends.ts` (as waiting-point and
  dead-end input).
- Sections' topology: `findLoops`, `buildTopology`, `signalSlots`, `roadTo`, which become the waiting-point builder.
- The room rule (`line()`'s admission), simplified.
- `followCap` and `resolveContacts` as a safety net.
- Stall *detection* and the stuck cards (`stalls.ts` reporting, `engine-status.ts`).
- Line-end turning (`turnAround`, `endOfLineBehind`).
- All tests and tools: harness, scenarios, invariants, fuzz, bug maps, the stall scan, e2e.

**Deleted, a little at a time (§4):**
- In `sections.ts`: `Move`, `ask`, `grant`, `recover`, `cutMoves`, `sectionUser`, `firstCome`, `facing`, `follows`,
  `circling`, `clearOfCircling`, `walkAlong`, `zoneOf`, `clearCap`, `capWith`, `foreign`/`loose`, `CLAIM_TICKS`,
  `inDeadEnd`, `inWayOf`, `refreshGate`, `gateAt`. That's most of the 2,971 lines.
- The router's `Lock` table as its own store (it becomes a view of the hold), `speedCap`, `pathLocks`, `awaitingGrant`,
  `steerSoon`.
- In `sim.ts`: `signalCap`, `pathFor`, the junction-block logic, and `crossCap` for trains holding their way.
- `Stalls.giveWay` (both passes), `Router.giveWayRoad`, `routing/give-way.ts`, `boxed.ts` (once no fuzz seed needs the
  excuse), and `thrownTaken`.

---

## 4. Migration in safe steps

Each step lands alone, behind the same gates:
- `npm test` (harness fuzz, signal fuzz, town-ring fuzz, bug maps);
- `npm run fuzz:long` for the larger steps;
- the bug-map replays (`src/play/bugmaps`);
- the e2e touch routing groups (`npm run e2e:affected -- --run` picks `TOUCH_ROUTES`: trap, dead-end, routes, wait,
  wye, stuck, stuck-lines, follow, blocker, route-ring, slips and the rest, plus `click:routes`, `e2e:signals`);
- `npm run balance:sweep` where throughput could change.

Trajectory hashes will change from step 3 on. Each step says what it expects to move.

| # | Step | What changes | Gate / known risk | Size |
|---|---|---|---|---|
| 0 | **Better nets first.** Add #31 and #32 as bug maps with *liveness* checks (each train makes progress or is said stuck by a named cause), not only invariants. New invariants: `oneOwner` (no piece under two trains' bogies unless coupling), `greenHeld` (a train standing at a green signal it faces), `midTurn` (a turn not at a line end and not asked for by the player), `netActed` (`followCap` or `resolveContacts` stopped a train that the core let go). Keep train ids across `turnAround`. | Tests, plus one sim change (stable ids). | The new invariants will fail today on some fuzz seeds. Record them as `KNOWN` lists, which shrink in later steps. Risk: low. | S–M |
| 1 | **Ban mid-line turns now** (the firm rule). Remove `Stalls.giveWay`'s turn pass and the "road give-way retried as a turn". Keep the road give-way for the moment. | Jams that were turned out of become stuck cards. | Run fuzz:long and the town-ring fuzz. Count seeds that become stuck and add them to `KNOWN`. These are what the core must fix. Risk: visible stuck trains in players' maps until step 6. Ship it together with step 6, or behind a flag until then, if that count is high. | S |
| 2 | **Reservation table in shadow.** Build the table and the waiting-point map (§3.2, §3.3). Each tick, compute what the core *would* hold. Hold nothing. Log where today's system lets a train onto a piece the shadow says another train holds, and where a train is held although the shadow would let it go. | No behaviour change. Hashes identical. | Measure walk times, asks per second and memory (perf harness). The disagreement log is a map of today's bugs. Risk: low. | M |
| 3 | **Points held by reservation.** The router's locks write into the table and read it. A routed train's hold to the next clear point is the reservation; hand-run `askHand` uses the table. | Points only. Behaviour is near identical. | touch `wye`, `slips`, `double-three-way`, `route-keep`, `blocker`. Risk: the lever-tap rules (§16 Q1). | M |
| 4 | **Signals show the table.** Aspect = reservation past it (§3.6). Delete `gateAt`, `refreshGate`, `pathFor`. A signal that isn't a safe waiting point is passed, and its card says why (fixes B5 by rule, not by refusing placement). | #31's class goes. | e2e:signals, signal-fuzz (`greenOnTrain`, `redForNothing`, `greenHeld`), `signals-mill.test.ts`. Risk: aspects at rest look different, so the shots need retaking. | M |
| 5 | **Sections grant by reserving.** `grant` takes the move's pieces in the table, all or none, and `sectionUser` reads owners instead of scanning. Release follows the tail. `cutMoves` goes, since a hold can't be cut. | Following gets closer, because pieces free behind the tail. | fuzz:long, the town-ring fuzz and the bug maps. `oneOwner` must pass everywhere. Risk: throughput changes, so run `balance:sweep`. | L |
| 6 | **Every train reserves.** Hand-run and lineless trains reserve as the points lie (§3.10). Delete `foreign`, `loose`, `zoneOf`, `clearCap`, `capWith`, `CLAIM_TICKS`. One-way stretches get automatic waiting points (§3.3 rule 3). Delete `follows`, `circling` and `clearOfCircling`. | The biggest behaviour change. | The `route-stuck`, `far-train` and `hand-made-shuttle` maps; touch `follow`, `route-ring`, `hand-wait`, `trap`, `dead-end`. Step 1's `KNOWN` list should be empty here. Risk: hand-run layouts players built that relied on loose following. | L |
| 7 | **One cap.** The movement cap is distance to the reservation's end (§3.5). Delete `Sections.cap`, `Router.speedCap`, `signalCap`, and `crossCap` for holders. `followCap` stays as the net, and `netActed` must stay clean. | Speeds near points and signals change slightly. | `e2e:clockmaker` (time scales), perf (`npm run perf:check`; budgets updated with numbers if they move). Risk: 3× time with long trains, so test at `timeScale` 3. | M |
| 8 | **Stalls read the table.** Waits come from failed reservations. Delete the four-source merge, `giveWay`'s road pass, `Router.giveWayRoad`, `give-way.ts`, `thrownTaken`, and `boxed.ts` if no seed needs it. | Cards name the exact blocker. | touch `stuck`, `stuck-lines`, the `engine-status` tests. Risk: wording of cards. | M |
| 9 | **Delete what's left** of sections' move logic. Rename what remains (topology plus room rule) to `waiting-points.ts` and `room.ts`. Update the routing and signals specs to point here. | Cleanup only. Hashes identical to step 8. | Full gates plus fuzz:long. | M |

Rough total: two to three weeks of focused work, with steps 5 and 6 the risky middle. Steps 0–2 can start at once and
are useful even if we stop there: they make today's bugs visible and measured.

**Risks across the whole plan:**
- **Throughput.** Holds from slot to slot on single track are no looser than today's sections. Piece-by-piece release
  is tighter. Expect equal or better deliveries. `balance:sweep` decides.
- **Long trains spanning many pieces,** and trains on bridges, lifts, ferries and turntables. Their pieces must be held
  for the whole train. A raised lift bridge or a moving turntable is simply unreservable.
- **The breakdown crane:** a derailed train frees its holds ahead, keeps the ones under it, and the crane reserves its
  way like any train.
- **Determinism:** fixed ask order (`waitSince`, then id). The trajectory tool (`scripts/trajectory`) checks it.
- **Mixed states while migrating:** from step 3 to step 7 the table and the old guards both act. The rule is that the
  table only *adds* holds until step 7. The old caps still apply, so a step can make a train wait more but never run
  where it couldn't before.

---

## 5. Summary for a non-programmer

- Today five different parts of the game each have their own opinion about which train may use which bit of track, and
  bugs happen where they disagree. That's why a signal can show green while its train is stuck.
- OpenTTD solves this with one rule: before a train moves, it books the track ahead up to a safe place to stop, all of
  it or none, and gives the track back as its last wagon passes.
- We'd do the same: one booking table that every train, signal and set of points reads. A signal is green only when its
  train has booked the way past it.
- Safe places to stop are passing loops, sidings, line ends and well-placed signals, so it works with no signals at
  all. A badly placed signal does nothing instead of causing a jam.
- Trains never turn round to escape a jam. If one truly can't move, it stands still and its card says why and what to
  build.
- It would be done in about nine small steps. Each one is checked by the existing stress tests and bug-map replays
  before it ships, and the first steps change nothing players see.
