# Crossing: a rethink (2026-10-20)

## Status

Crossing (routes Phase 3b/3c, "trains wait for each other") stays parked. Branch `claude/crossing-rethink` is
`routes-blocks` merged with main fca216f (typecheck and the unit suite green), plus play-through tooling and 3d
below. It doesn't reach the bar (no head-on meetings, no lock-ups on the play-through seeds) and I don't think the
current model can: this note says why, and proposes one that can. Background: `2026-10-18-crossing-parked.md`, the
routes spec §3.5, the header of `src/economy/crossing.ts`.

## What was done on the branch

- **Merged main** (idle creep, steer `avoid`/`follow`/`occupied`, game date). `steerTrains` keeps crossing's avoid
  hint and uses main's `sim.pieceOccupied` for `occupied`.
- **3d, wired:** a train holding a block is steered with `follow` = the pieces and paths it holds, aimed at its block's
  last stop (`Crossing.steerFollow`). A lone train holds nothing, so it steers as on main. Effect: one run in 15
  changed (seed 2, three trains, loop: stall 62 → 6 min, arrivals 346 → 594, head-ons 9 → 7, releases 1 → 0). The QA
  scenarios didn't change.
- **Play-through tooling:** arrivals in `SUMMARY`; `BALANCE_XTRACE=from-to` traces each line train's pieces, speed,
  route, claim and wait every game second, and each release.
- **Seed 1 with a loop is a play-through bug, not crossing's (still open).** When `spliceLoop` lays the loop at minute
  56, the line is left open (first at a restored straight beside the loop, piece 812709). After the jam cut, the lone
  train shuttles between that gap and a buffer, and never reaches its stop again. This happens with crossing on or off
  (coins 102, arrivals 138 either way). Two tries at a fix didn't close it, so both were dropped:
  - skipping runs with stale ids changed nothing;
  - undoing a failed try with the editor's undo moved the gap to the far side of the loop (piece 3557).
  - Next step: check the line's legs after `spliceLoop` and abandon a splice that leaves any leg unjoined. Until then,
    seed 1's loop rows say nothing about crossing.

## Root causes found (with traces)

1. **The lock-up after idle creep: a block granted through a standing line-mate.** Seeds 2027 and 2, no loop, two
   trains: both trains stand still from minute 16–19 to 180, with no wait on either card and no release (26 and 37
   arrivals in 180 min).
   - The sequence (2027): e1 turns round where it stands at stop 0 (piece 6/1293, turn cause `short`). In the tick it
     starts to move, e5 is granted a no-loop block `3> … 1625> 6> 1293> … 7> 7<` that runs through e1's stop.
     - e1 was moving, so the "standing on our way" test missed it.
     - e1 was going the same way as e5, so there was no head-on clash.
   - e5 runs up behind e1. Idle creep holds it at the follow gap.
   - e1, at its stop, is capped to 0 by `stopCap`, because e5 holds the track ahead of it.
   - So there's a circular wait: e1 waits on e5's claim, and e5 waits physically on e1. Neither is a crossing "wait",
     so no safety net ever fires. Before idle creep, e5 crept into e1 and the bounce broke the stack.
2. **Following into a stub.** Seed 2027, three trains, loop, minute 65: the player puts a third train down mid-line,
   inside the long stub, behind a line-mate heading for the terminus.
   - From its tail, it's given a block that follows the leader. They're going the same way, so there's no clash. The
     stub rule exempts a stub the train is already in.
   - The leader at the terminus can't come back out. That makes a mutual wait, then a 30 s release, then head-ons:
     4 head-ons, and the player lifts 2 trains.
3. **3d (confirmed and wired):** steering aimed at the current stop and stopped looking at it. So a train running
   through a stop inside its block met the switch beyond before steering looked past the stop.
4. **Claim direction and departure direction.** Both come from `drive()` (the lever × facing sign), so they agree
   while the train keeps its direction. They part when something else turns the train between the claim and the
   departure:
   - the sim at a buffer or an open end;
   - the sim at a head-on meeting;
   - crossing's own `turnBack` (short calls, `stacked`, `backOff`).

   There are about ten staleness rules (`turned`, `faced`, `trainId`, revisions, targets) to catch this afterwards.
   That is the `[2< 1313<]` case: no single source can fix it while four agents can turn a train.

## What was tried and why it can't be finished in this model

- **Exclusive blocks where a block turns back** (any shared piece clashes, either way, if either way has a turn), and
  **closing the stub hole** (a train already in a stub, heading deeper, waits for any line-mate in it). These close
  causes 1 and 2, but they break QA's bare loop with three trains (arrivals 14/15/14 → 1/0/1).
  - The fixture puts a train on the loop's far switch facing into the stub where another stands. It must back out.
  - Backing out (`backOff`) works out its way back to its *next stop*, cut at the first loop it could wait in. But
    that loop's other road holds the third train, so the three-trains-two-roads rule (`comingTo`) refuses it.
  - Clearing the jam needs "back through the loop into the far stub and wait there". In the current model a way is
    always the route to the next stop, so that can't be said.
  - Each rule added exposes the next missing one. (The diff was kept as a scratch file and is not on the branch.)
- **The structural problems:**
  - **Claims are predictions.** A claim is `legFromCursor`'s walk of what steering and the sim will do, from the
    direction the train faces now. Four agents can change that direction, and the sim makes a new train id at every
    turn. Most of `crossing.ts` (2,100 lines: re-legs, staleness rules, nested scans, `shortCall`, `stacked`,
    `backOff`, `wrongWay`, `comingTo`) exists to repair predictions that went stale.
  - **Blocks aren't exclusive.** Claims clash only head on, so line-mates may share a block. Any later reversal of
    the leader (at a terminus, a short call, a meeting) makes a circular wait. Making blocks exclusive is right, but
    then a train that must make room needs a move that isn't its route, and the model has none.
  - **Waits happen at places that block others:**
    - at stops on single track;
    - at the end of partial claims ("as far as it's clear");
    - at the follow gap behind a line-mate;
    - anywhere after a release.

    Deadlock freedom needs every wait to be at a place that blocks nobody.
  - **The safety nets only see crossing's own waits.** A physical hold (the follow gap, `stopCap`) freezes silently
    and for good.

## Proposed model: sections and slots, owned by the sim (token working)

Something a real single line already proves deadlock-free: a train enters a single-track section only holding its
token **and** a reserved place to stand at the far end.

- **The graph (per layout revision, cached).**
  - **Slots** are places a train can stand without blocking anyone:
    - each road of a usable passing loop (long enough for the train, unpinned);
    - each stub (a terminus and its platform, from the line end back to its first switch), capacity 1;
    - a depot siding off the line.
  - **Sections** are the single track between slots, and switches belong to the section they lead into.
  - A line's ways become a path of slots and sections.
  - Piece → section/slot maps make every lookup O(1).
- **Moves.** A train in a slot asks for a *move*: (section, direction, the slot it will stand in at the far end). The
  move is granted only if:
  - the section is free (no other train holds it or has an axle in it, either way);
  - and the far slot has room for it.

  The section and the far slot are then held together. A move through a slot (a loop it won't stop in, or a stop
  inside the section) is part of the same move. The section is let go as the tail clears it, and the near slot as the
  tail leaves it.
- **Direction has one source.** The move's direction is decided once, when it's granted, from the route (which way
  the next stop lies along the line's path). The sim turns a train only in a slot (at a buffer, or when a move the
  other way is granted), never between, so the claim and the departure can't disagree. Head-on meetings can't happen
  between granted moves; they remain only for unrouted trains.
- **No deadlock, by construction.**
  - On a path of slots and sections, if one slot is free some train can always move into it, provided moves may go
    "the wrong way" (back into a loop, or the far stub) when the right way is blocked. The grant logic is allowed to
    give a train a holding move away from its stop, which today's ways can't express.
  - A line with more trains than slots − 1 has nowhere to hold the extras. Its card says so ("The Red line needs
    another passing loop for 3 trains"), and the extra train is held where it stands until a slot frees. It is never
    released into a section.
  - With no passing place at all, the two stubs are the slots: they take turns end to end, as today, with no short
    calls and no stacking.
- **Owned by the sim, not the economy:**
  - Occupancy comes from the bogies (track circuits), not from walked predictions.
  - The check runs only when a train's front comes up to a section boundary: the sim already knows piece transitions,
    so the per-tick cost is a map lookup per moving train.
  - The economy (routes) supplies only "this train wants to go toward stop S" and "it's ready".
  - Steering throws the switches of a granted move once, when it's granted, and pins them for the move (`follow`
    becomes the move's switch list).
- **Player placements, loads and track edits.** A train put down in a section occupies it. If two trains end up in one
  section (placed there, or the track edited under them), both hold, and the card says *"Two Red line trains in one
  stretch: lift one or turn one round"*, the one place the player is asked. Or, for a toy, one train is reversed back to
  the slot behind it when its way there is clear. No timed release.
- **A lone train** asks for nothing (fast path, exactly as main).
- **Saves:** nothing new. Moves are worked out again from where the trains stand (each train's slot or section).

Kept from today: `passingLoops`/`loopRoadAt` (the slots), `stubsOf` (the stubs), steer's `follow` and `occupied`, the
cards' words, and QA's scenarios as acceptance tests (`loops.test.ts`, `blocks.test.ts`), plus the play-through table.
Dropped: per-piece claims, re-legs, `shortCall`, `stacked`, `backOff`, `wrongWay`, `comingTo`, and the 20 s and 30 s
releases (Go now stays: the player's override).

## Numbers (play-through, 180 min; head-ons, longest stall in minutes, arrivals, releases, coins)

"No crossing" is `BALANCE_CROSSING=off`. "3c (before)" is `routes-blocks` merged with main fca216f. "3c+3d (after)" is
this branch's head. "cut" counts trains the simulated player lifted off a jammed line, which also changes what runs
after.
- A three-train no-loop run never gets its third train (the line jams first), so it shows two.
- One train (n = 1) runs identically in all three. The unit test "a lone train runs exactly as without blocks" holds.
- Lock-ups (stall over 100 min, arrivals stuck):
  - seeds 2027 and 2 without a loop: root cause 1;
  - seed 1 with a loop: the play-through bug above, with crossing on or off.

| seed / trains / loop | no crossing: head-on, stall min, arrivals, releases, coins | 3c (before): head-on, stall min, arrivals, releases, coins | 3c+3d (after): head-on, stall min, arrivals, releases, coins |
|---|---|---|---|
| 2027 / 2 / loop | 14, 11, 259, 0, 1329 (cut 1) | 0, 8, 573, 0, 1173 | 0, 8, 573, 0, 1173 |
| 2027 / 3 / loop | 26, 32, 450, 0, 1045 (cut 2) | 4, 13, 373, 4, 418 (cut 2) | 4, 13, 373, 4, 418 (cut 2) |
| 1 / 2 / loop | 8, 118, 138, 0, 102 (cut 1) | 4, 119, 138, 0, 102 (cut 1) | 4, 119, 138, 0, 102 (cut 1) |
| 1 / 3 / loop | 24, 114, 138, 0, 102 (cut 2) | 8, 115, 138, 0, 102 (cut 2) | 8, 115, 138, 0, 102 (cut 2) |
| 2 / 2 / loop | 27, 6, 391, 0, 463 (cut 1) | 2, 4, 443, 0, 1298 (cut 1) | 2, 4, 443, 0, 1298 (cut 1) |
| 2027 / 2 / noloop | 29, 9, 324, 0, 1203 (cut 1) | 0, 162, 26, 0, 132 | 0, 162, 26, 0, 132 |
| 2 / 3 / loop | 41, 5, 419, 0, 701 (cut 2) | 9, 62, 346, 1, 87 (cut 1) | 7, 6, 594, 0, 662 (cut 1) |
| 2027 / 3 / noloop | 39, 9, 296, 0, 1018 (cut 2) | 0, 162, 26, 0, 132 | 0, 162, 26, 0, 132 |
| 1 / 2 / noloop | 48, 13, 342, 0, 619 (cut 1) | 2, 7, 291, 3, 214 (cut 1) | 2, 7, 291, 3, 214 (cut 1) |
| 2 / 2 / noloop | 23, 6, 398, 0, 1789 (cut 1) | 2, 159, 37, 1, 132 | 2, 159, 37, 1, 132 |
| 2 / 3 / noloop | 31, 5, 410, 0, 914 (cut 2) | 2, 159, 37, 1, 132 | 2, 159, 37, 1, 132 |
| 1 / 3 / noloop | 122, 11, 308, 0, 627 (cut 2) | 4, 9, 325, 4, 215 (cut 2) | 4, 9, 325, 4, 215 (cut 2) |
| 2027 / 1 / loop | – | 0, 9, 314, 0, 1213 | 0, 9, 314, 0, 1213 |
| 1 / 1 / loop | – | 0, 6, 394, 0, 1563 | 0, 6, 394, 0, 1563 |
| 2 / 1 / loop | – | 0, 10, 299, 0, 281 | 0, 10, 299, 0, 281 |

QA scenarios (10 min each, 3c, unchanged by 3d): no passing place 2/3 trains, station loop 2/3, bare loop 2/3, short
loop (4 cars) all show rising arrivals. Head-ons are 0 except bare loop with 3 trains (2, from the fixture's start
placement on the loop's far switch). Releases: 0, except station loop with 3 trains (3) and bare loop with 3 (3). 3b:
the short loop jams (74 head-ons, 1 arrival each), and every 3-train case jams (133–551 head-ons).
