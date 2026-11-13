# Routing cases: every layout we can think of, judged by an exhaustive search (2026-11-11)

The user, in place of the long fuzz: "exhaustive unit tests of all cases you can think of". `src/routing/cases/` is a
deterministic suite in `npm test` (about 50 s on 4 cores, 414 cases in eight files run side by side). Each case is a
small layout a player could lay, with trains on it. The expected verdict comes from an exhaustive search, not from
anyone's guess:

- **The oracle** (`cases/oracle.ts`) searches every sequence of moves a perfect dispatcher could make under the game's
  rules. Trains fill whole pieces (2 for a 3-car train, more for longer ones) and never come to rest on points. They turn
  round only at the end of the track, or close behind a train standing at one (routing spec §16 Q9). A routed train may
  take any road at points. A hand-run one takes points as they're set, or any road for the upper bound. Signals hold as
  the game's do: a plain block must be clear to pass its signal, and a path signal (a block with points in it) needs
  only the train's own way. The oracle then finds the largest set of trains that can keep delivering for ever (a
  strongly connected set of reachable states in which each train comes to all its stops).
- **The game** is the routing harness (sim, sections, router, stalls, every train invariant), run for a few trips (150
  s or more, by the layout's size; 300 s for a fuzz seed). A run stops 20 s after a stall is said.
- **The judge** (`cases/judge.ts`) compares the two:
  - If the oracle says every train can keep running, each must deliver in the run's second half (a stop, or 2 m for a
    hand-run train), with no stall said and no invariant broken.
  - If the oracle says not all can, the game must say so: a train stuck with a card, or held by its line for want of
    room ("the line is full"), never standing unsaid.
  - In every case: no train said stuck while standing on points (unless put down there and never moved), no "Add a
    signal" where no signal would help, and no invariant broken (all but `heldFree`, the booking core in shadow).
  - Hand-run trains are the player's to run: no one dispatches them. So a stall with hand-run trains on a layout the
    oracle calls live isn't held against the game; everything else is.

A case the game gets wrong today is listed in `cases/known.ts` with its mismatches, and the suite checks that it still
goes wrong in exactly that way. So the suite is green, it lists exactly what's broken, and a change that clears a case
(or breaks it differently) turns it red, to be taken off the list (`node tools/cases-known.mjs <dir>`).

Run: `npx vitest run src/routing/cases/`. The table below: `rm -rf .cases; CASES_OUT=.cases npx vitest run src/routing/cases/; node tools/cases-report.mjs .cases`.

## The families (generated, not hand-picked: `cases/cases.ts`)

- **ring** (18): the user's question: two trains the same way round a ring cut into three blocks, by pairs or by
  single signals, on one line, own lines, or a routed train with a hand-run one. Plus three trains, one per block, and
  two facing each other.
- **trains** (188): every track × 1 train up to one more than it can hold × the same way or opposed × one line, own
  lines, hand-run, or one routed among hand-run. The tracks:
  - a plain line, and lines with 1, 2 and 3 passing loops;
  - a line with a dead-end siding, and a line with a loop and a siding;
  - a plain ring, a ring with one loop, a ring with two;
  - a branch line off a ring;
  - a terminus with two platforms, and a wye;
  - double track with a crossover;
  - two lines over a crossing.
- **signals** (104): plain line, line with a loop, plain ring, ring with a loop, each with:
  - a pair of signals;
  - a pair at each cut for 2, 3 and 4 blocks;
  - single one-way signals for 3 blocks;
  - pairs at both ends of each loop road;
  - a pair inside a loop's main road (issue #31);
  - a pair just before points.

  Each with two trains (same way and opposed) and three.
- **placement** (30): nose to tail, facing each other, one put down on points, one straddling a signal; routed and
  hand-run.
- **stops** (50): a stop mid-line, in a loop's side road, or beyond points (a siding, a branch, the second platform, the
  other track over a crossover).
- **lengths** (6): an engine alone, and a 6-car train (longer than a loop's main road).
- **fuzz** (18): the long fuzz's stalled seeds, at least one from each of its groups (`stalls-verify-2026-11-10.md`).

Figure-8s aren't in: they don't close from the fixtures' pieces. Crossings are covered by the two lines over a
crossing.

## Update: main with fixes 1 and 3 (b124522, 2026-11-13)

Main has since gained the room rule counting a line's ends and a hand-run train asking short of the points
(`claude/routing-room-line-ends`). Merged into this branch, the suite turned 25 known cases red, as it should:

- **22 cleared.** All 18 of fix 1's (three trains on one loop, with and without signals; fuzz seeds 34, 37, 91) and all
  4 of fix 3's (a routed train among hand-run ones on a siding or a wye).
- **3 changed, the same 3 the patches changed, now on main:**
  - `line1 3×one same sig:loopEnds` and `line1 3×one opposed sig:loopEnds` stop stalling, but break `greenHeld` (a
    train stands 5 s at a signal showing clear), with pairs of signals at the loop roads' ends;
  - fuzz seed 161 still waits on points, and now also breaks `netActed`.
- **No new mismatch.**

`known.ts` now lists **84**:

| Family | Cases | Mismatched |
|---|---|---|
| ring | 18 | 3 |
| trains | 188 | 30 |
| signals | 104 | 25 |
| placement | 30 | 1 |
| stops | 50 | 16 |
| lengths | 6 | 2 |
| fuzz | 18 | 7 |

The fixes since (2026-11-13), one cause a branch, landing together as `claude/routing-zero-batch1`. With all four, `known.ts`
lists **53** (from 84); fuzz seeds 125, 136 and 149 there are the user's decision 4 (boxed-in convoys stall, the card
says add a passing loop), said so in their titles and the table (`cases/reasons.ts`):

**The head-on card** (`claude/routing-zero-head-on-card`): a ring of waits through signals in which a train waits on
one coming toward it stays a signals stall, marked `headOn`, and its card says "Stuck: … faces it between the signals.
Move one of them" (or, for two lines' trains, "Add a passing loop here"), not "too many trains for these signals. Add
a signal". All 16 wrong cards clear and nothing else changes: 68 known. The table at
the end is this run's. The sections below are as first written, on f10b8ee.

**A loop's last road** (`claude/routing-zero-last-road`): a train isn't granted the last free road of a passing loop
whose other road holds a train leaving the same way while a line-mate comes at the loop from the other side, unless
that one waits, by way of others, on it (on a ring with two loops it would be a ring of waits: the §12 scenario "two
lines round a ring with two loops" caught it). Fuzz seeds 111, 126 and 165 run; 81 known. The table at
the end is this run's. The sections below are as first written, on f10b8ee.

**Signals by points** (`claude/routing-zero-signals-by-points`): two fixes.
- **`greenHeld`, 5 cases.** A train held by sections at the end of a loop road or a line end now has the signal the
  player put there show red to it, as a waiting point's does. It had stood at a green signal. This clears all 5 cases
  with pairs at the loop roads' ends, and `greenHeld` on all 7 long-fuzz seeds that had it.
- **`wrongRoad`, 1 case.** The router reads a waiting point's gate as the sim does: a path signal gated for a train
  further back in its slot no longer stops the router setting the points for the train at the front, which has its
  move granted. That front train had run onto the points as they lay (ring1, three trains, a pair just before the
  loop's points).

  That case still stalls: three trains round a ring with one loop and one pair of signals wait on each other's slots.
  79 known. The table at
the end is this run's. The sections below are as first written, on f10b8ee.

**Hand-run trains short of points** (`claude/routing-zero-hand-run-points`, the user's B1): a hand-run train doesn't come
onto points (facing or trailing) with another hand-run train on the single track beyond them, as they lie, heading back
at them; it waits short of them (the router's hand-run wait). Two hand-run trains meeting so stand off the points, said
stuck, or pass where the points lie for another road. 7 cases clear (two hand-run trains on lines with 1 to 3 loops, a
ring with 1 or 2 loops, a branch, a terminus); 77 known. A hand-run train meeting a routed one is sections' (fix 3,
`comesInto`), as before. give-way's town-ring seed 6: all hand-run, the two put down facing each other now pass by the
wye (was 169 s stuck); with the route it stands as before. The table at
the end is this run's. The sections below are as first written, on f10b8ee.

**Stepping aside into a spare siding or platform** (`claude/routing-zero-siding-move`, the user's A1):
- **The rule, in the oracle too.** A routed train may turn at its own ends (one of its stops on the plain stretch back
  from the end to the points; a line end beyond its stop counts) or at a spare dead end (a plain stretch with no
  industry on it and no train's stop). Never at an industry's siding. The verdict is the spare-only oracle's. A case
  live only through an industry siding stands, as the user chose: the table says "through an industry siding: n".
  Running where the any-ends oracle says it can isn't held against the game: a route may need an industry's line end
  to turn at.
- **New tracks:** siding-spare, line1+siding-spare, terminus-spare (a plain second platform), wye-spare and
  branch-spare. 484 cases.
- **The game: refuges.** A line's refuges are spare end slots off its way, joined to it where trains going either way
  can run in: off a wye, not off plain points (`bothWaysIn`). Each makes room for a train more.
- **The game: the move.** A train held for one coming at it head on is granted a move into a free refuge instead. It
  turns at the buffer there, waits for that one to pass, and goes on. Its card: "Letting the Red line by".
- **Off plain points, not used.** There only trains heading one way can run in, so the same train would always be the
  one to step aside and never reach its far stop. To get by, it would have to follow its line-mate into the line end
  and turn behind it (§16 Q9), and the user's decision 4 keeps convoys into a dead end one train to a section. Those
  12 cases (siding-spare ×4, terminus-spare ×6, wye-spare with 3 trains ×2) wait for the user's call, said so in
  their titles (`cases/reasons.ts`). Fuzz 136 and 149 are decision 4's already (above).
- **Also a train held in `recover`** (stopped for one in its way, coming at it, or a blocked way) steps aside the same
  way, from where it stands.
- **Also open:** branch-spare (a ring with no slots at all, so its line isn't managed), and the new tracks' copies of
  known cases: hand-run trains waiting on points on wye-spare, line1+siding-spare and branch-spare go wrong just as on
  wye, line1+siding and branch.
- **Counts,** on batch1: the industry-siding cases on siding, terminus and wye now stand as the user chose, and the
  new spare tracks add their own: **42** known (from 53). The table at
the end is this run's. The sections below are as first written, on f10b8ee.

**Following into a waiting point** (`claude/routing-zero-ring-follow`, on the siding move): on a circuit all its trains
go round one way, a train may follow another into a signal's waiting point, as it may into a loop road, where the two
fit one behind the other and no signal stands where trains come in (that one guards a plain block: one train at a
time). Three trains round ring1 with a pair of signals before the loop stood each waiting on the next: the one at the
signal for a loop road, the one in that road for the waiting point. `sig:pair` and `sig:beforePoints` clear; 40 known.
`sig:blocks2` stays: there the waiting point's way in is a plain block's signal, and the way round is for the train at
the other signal to run on into the stretch before the loop and stand short of its points, which sections don't yet
grant (a move to a stretch that is a waiting point only the other way). The table at
the end is this run's. The sections below are as first written, on f10b8ee.

**A path signal for a train held short of its slot's end** (`claude/routing-zero-in-loop`, on ring-follow): a train
held by sections in a loop road or line end it fits in will stand short of the slot's end, before the next points. When
its tail is still on points behind, a path signal it comes to on the way there now shows it clear with only that
stretch free, not the way past the points beyond (`Sim.standsWithin`, from `Sections.standsWithin`; the signal's
aspect only: the router asks for the points beyond when the train does). A pair inside a short loop road (issue #31)
stood red for a train that only had to pull up to the road's end: its tail stayed on the points behind, in the way of
the train coming the other way into the other road, and the two waited on each other. All four `sig:inLoop` cases
clear: 36 known. ring1 `sig:blocks2` cleared too while the rule held for any train held so, but at the cost of trains
pulling up past signals off no points (the bug map signal-added-still-stuck lost 5 of 101 stops in 600 s), so it
stays: there the train at the signal isn't on points.

**Pulling up short of an overhang** (`claude/routing-zero-overhang`, on in-loop): a train coming into a loop road or
line end with another standing just past its far end waited for it where it was, its tail still on the points behind.
Now, while still on points, it pulls up into its slot, short of the other's overhang (`OVERHANG_ROOM`), then waits.
Both ring2 3× `opposed` cases clear (a train put down on the far points; the oracle calls them dead, and the game no
longer leaves one standing on points): 34 known.

**The oracle measures trains and roads by their real lengths** (`claude/routing-zero-oracle-lengths`, on overhang): it
gave a train its length in 216 mm pieces (`piecesFor`, 2 at least), so a 526 mm train took 3 pieces and fit a loop road
of 3, though two of them are curves and the road is 499 mm. Now each train covers the pieces from its front back as far
as their real paths are as long as it is (`OTrain.length`), and on each move lets go of its tail only as far as the rest
still covers it. Of the 484 cases, 2 verdicts change, none the other way: line1 2× `long` (live → dead: neither road,
432 and 499 mm, holds a 526 mm train clear of the points, so no passing; the game's stall is right, and the case clears)
and ring1 2× `long` (partial → dead; still known for a train standing on points). 33 known.

**Round a ring and up a branch** (`claude/routing-zero-balloon`, on oracle-lengths): a routed train that goes round a ring
and up a branch to a line end, turning back there (the user's rule: only at line ends), now counts as circling
(`circuitFrom` turns back at the end of a dead end, in one dead end only: turning back in two is a line it shuttles
along). Who goes which way (`oneWayRound`) leaves out the dead end and its mouth: one train at a time goes in and out
there (§5 rule 8). Two trains on such a line the same way round follow each other round the ring, as on a ring with no
branch: room for both. branch 2× `same stops:far` clear (one and own): 31 known. Still open on these tracks: trains put
down facing each other (`opposed`) and branch-spare. Their way to a stop on the ring meets no slot (the ring has no
loop), so sections don't hold them, and one runs onto the wye into the other: a ring with no slot of its own.

**A lever thrown under a hand-run train's move** (`claude/routing-zero-lever-regrant`, on balloon): a train on no
line goes the way the points lie, and a lever tap moves points held only by hand-run trains at once (§16 Q1). Its
move, granted for the way they lay, was kept: fuzz seed 161's player tapped a three-way's lever ahead of a hand-run
train, which ran into the leg a routed train stood in, nose to nose on the points (`netActed`). Now when the points
change, a hand-run train whose move's way ahead no longer lies so lets it go and asks again from where it is
(`liesAsMove`). Fuzz seed 161 clears: 30 known.

## Results (on f10b8ee, before the fixes)

414 cases. The oracle calls 299 live, 100 dead, 15 partial. The game agrees on 308; **106 disagree**, all listed in
`known.ts`:

| Family | Cases | Mismatched | Mismatches |
|---|---|---|---|
| ring | 18 | 3 | wrong card 3 |
| trains | 188 | 38 | stalls-live (siding) 18, waits on points 18, stalls-live 4 |
| signals | 104 | 36 | stalls-live 20, wrong card 13, break greenHeld 5, waits on points 5, break wrongRoad 1 |
| placement | 30 | 1 | waits on points 1 |
| stops | 50 | 16 | stalls-live (siding) 7, starves-live 5, stalls-live 4, waits on points 1 |
| lengths | 6 | 2 | stalls-live 1, waits on points 1 |
| fuzz | 18 | 10 | stalls-live 7, stalls-live (siding) 2, waits on points 1 |

**The user's ring passes:** two trains the same way round a ring in three blocks keep running in all six of its
cases (pairs or single signals; one line, own lines, or with a hand-run one). Three trains, one per block, stall with
"too many trains for these signals. Add a signal", which is the right fix. Two facing each other stall too, but the card
says "Add a signal", which is wrong (fix 4 below).

What the mismatches are, by cause:

1. **The room rule is too strict** (stalls-live, 21 cases: `line1 3×…`, three trains on one loop, with or without
   signals; fuzz seeds 34, 37, 91, 111, 126, 165). Three trains fit a line with one loop, because its two ends hold a
   train each. The game holds the third and says "Add a passing loop".
2. **No train ducks into a siding or a platform to let another by** (stalls-live:siding, 27). The oracle keeps both
   trains running only by sending one to an end that isn't one of its stops (the siding, the other platform, the wye's
   other leg), turning it, and bringing it back. Today both stand. Starves-live (5) is the same thing on a line with no
   loop, where the room rule holds one train for good: the card says the line is full, but the siding is a way past.
3. **Waiting on points** (27): mostly hand-run trains meeting another on points (14), and routed trains with a
   signal inside a loop's road (issue #31: the card names the signal to move; 5). Also: a 6-car train on a ring with
   one loop, three opposed on a ring with two loops, and fuzz seed 161, a hand-run train coming back out of a siding.
4. **The wrong card for two trains nose to nose** (16): "too many trains for these signals. Add a signal", on a line or
   ring where no signal would help.
5. **Breaks with signals by points** (6):
   - `greenHeld` (a train stands 5 s at a signal showing clear) with pairs at the loop roads' ends, 5 cases;
   - `wrongRoad` (a train took a road at points it wasn't granted) on a ring with a loop and a pair just before its
     points, three trains, 1 case.

   These are on main today: real bugs, not caused by any fix.
6. **Also left:** fuzz seeds 136 and 149, live only by the game's own §16 Q9 turn behind a train standing at the line
   end. The game never gets there, because the room rule holds a train first. Then a branch with its stop beyond the
   wye, and a 6-car train opposed on a line with a loop.

## What each proposed fix clears

The fixes from `stalls-verify-2026-11-10.md`, as patches in `docs/agents/routing-cases/`: `fix1`–`fix4`, and
`all-four.patch` (fix 3 rebased by hand onto 1 and 2). Each was applied on a scratch copy of this branch (`git apply`)
and the suite run with `CASES_OUT`, then compared case by case with today's.

| Fix | Clears | New | Changed |
|---|---|---|---|
| 1. The room rule counts line ends (`exp1`) | 18 (trains 4, signals 11, fuzz 3: 34, 37, 91) | 0 | 2: `line1 3×one … sig:loopEnds` stop stalling and break `greenHeld` instead |
| 1 + 2. Keep a loop's last road for the other way (`exp1` + `exp2`) | 21 (adds fuzz 111, 126, 165) | 0 | the same 2 |
| 3. A hand-run train asks before the points (`exp3`) | 4 (a routed train among hand-run ones waiting on points: siding, wye) | 0 | 1: fuzz seed 161 still waits on points and now also breaks `netActed` |
| 4. The head-on card (`exp4`) | 16 (every wrong card) | 0 | 0 |
| All four | 41 of 106 | 0 | the 3 above |

None of the fixes makes a passing case fail. Fixes 1 and 3 each trade a stall for an invariant break in a few
cases: 1 in the loop-end-signals cases (the same `greenHeld` the long fuzz found), and 3 in seed 161. Each needs that
looked at before it lands.

Left after all four (65): the siding move (27, untested fix: park a held train in a siding), hand-run trains meeting on
points (14), signals inside a loop (5, issue #31), the loop-end `greenHeld` and before-points `wrongRoad` breaks (6),
and a few singles (above).

## The table

Every case: the oracle's verdict (trains that can keep running of all; "own ends": turning only at its own stops;
"free": hand-run trains taking any road), the game's result (stops per train in the run; a hand-run train's metres),
and pass / known.

<!-- cases table: node tools/cases-report.mjs -->
484 cases; 30 mismatched.

| Family | Cases | Mismatched | By kind |
|---|---|---|---|
| ring | 18 | 0 | – |
| trains | 258 | 22 | waits-on-points 10, stalls-live:siding 14 |
| signals | 104 | 1 | stalls-live 1 |
| placement | 30 | 1 | waits-on-points 1 |
| stops | 50 | 2 | stalls-live 2, waits-on-points 1 |
| lengths | 6 | 1 | waits-on-points 1 |
| fuzz | 18 | 3 | stalls-live:siding 1, stalls-live 2 |

### ring (18 cases, 0 mismatched)

| Case | Oracle | Game (stops per train; hand-run: metres) | Result |
|---|---|---|---|
| ring0 2×mix opposed sig:blocks3 | dead (0/2; no signals 0) | stall at 13 s (signals, signals); 1 / 0.4 m | pass |
| ring0 2×mix opposed sig:oneway3 | dead (0/2; no signals 0) | stall at 11 s (in-way, in-way); 1 / 0.6 m | pass |
| ring0 2×mix same sig:blocks3 | live (2/2) | 13 / 18 m | pass |
| ring0 2×mix same sig:oneway3 | live (2/2) | 13 / 18 m | pass |
| ring0 2×one opposed sig:blocks3 | dead (0/2; no signals 0) | stall at 13 s (signals, signals); 1 / 0 | pass |
| ring0 2×one opposed sig:oneway3 | dead (0/2; no signals 0) | stall at 11 s (in-way, in-way); 1 / 0 | pass |
| ring0 2×one same sig:blocks3 | live (2/2) | 13 / 12 | pass |
| ring0 2×one same sig:oneway3 | live (2/2) | 13 / 12 | pass |
| ring0 2×own opposed sig:blocks3 | dead (0/2; no signals 0) | stall at 13 s (signals, signals); 1 / 0 | pass |
| ring0 2×own opposed sig:oneway3 | dead (0/2; no signals 0) | stall at 11 s (in-way, in-way); 1 / 0 | pass |
| ring0 2×own same sig:blocks3 | live (2/2) | 13 / 12 | pass |
| ring0 2×own same sig:oneway3 | live (2/2) | 13 / 12 | pass |
| ring0 3×mix same sig:blocks3 | dead (0/3; no signals 3) | stall at 7 s (signals, signals, signals); 0 / 0.1 m / 0 m | pass |
| ring0 3×mix same sig:oneway3 | dead (0/3; no signals 3) | stall at 7 s (signals, signals, signals); 0 / 0.1 m / 0 m | pass |
| ring0 3×one same sig:blocks3 | dead (0/3; no signals 3) | stall at 7 s (signals, signals, signals); 0 / 1 / 0 | pass |
| ring0 3×one same sig:oneway3 | dead (0/3; no signals 3) | stall at 7 s (signals, signals, signals); 0 / 1 / 0 | pass |
| ring0 3×own same sig:blocks3 | dead (0/3; no signals 3) | stall at 7 s (signals, signals, signals); 0 / 1 / 0 | pass |
| ring0 3×own same sig:oneway3 | dead (0/3; no signals 3) | stall at 7 s (signals, signals, signals); 0 / 1 / 0 | pass |

### trains (258 cases, 22 mismatched)

| Case | Oracle | Game (stops per train; hand-run: metres) | Result |
|---|---|---|---|
| branch 1×hand | live (1/1) | 18 m | pass |
| branch 1×one | live (1/1) | 15 | pass |
| branch 2×hand opposed | dead (0/2) | 17.2 m / 16.6 m | pass |
| branch 2×hand same | live (2/2) | 18 m / 18 m | pass |
| branch 2×mix opposed | partial (1/2; through an industry siding 2) | stall at 11 s (in-way, in-way); 1 / 0.6 m | known: waits-on-points |
| branch 2×mix same | live (2/2) | 15 / 18 m | pass |
| branch 2×one opposed | partial (1/2; through an industry siding 2) | stall at 11 s (in-way, in-way); 1 / 0 | known: waits-on-points |
| branch 2×one same | live (2/2) | 15 / 14 | pass |
| branch 2×own opposed | partial (1/2; through an industry siding 2) | stall at 11 s (in-way, in-way); 1 / 0 | known: waits-on-points |
| branch 2×own same | live (2/2) | 15 / 14 | pass |
| branch 3×mix opposed | dead (0/3) | stall at 8 s (in-way, in-way, in-way); 0 / 0.2 m / 0.7 m | pass |
| branch 3×mix same | live (3/3) | 15 / 18 m / 18 m | pass |
| branch 3×one opposed | dead (0/3) | stall at 8 s (in-way, in-way, in-way); 0 / 0 / 0 | pass |
| branch 3×one same | live (3/3) | 15 / 15 / 14 | pass |
| branch-spare 1×hand | live (1/1) | 18 m | pass |
| branch-spare 1×one | live (1/1) | 15 | pass |
| branch-spare 2×hand opposed | dead (0/2) | 17.2 m / 16.6 m | pass |
| branch-spare 2×hand same | live (2/2) | 18 m / 18 m | pass |
| branch-spare 2×mix opposed | live (2/2; own ends 1) | stall at 11 s (in-way, in-way); 1 / 0.6 m | known: waits-on-points |
| branch-spare 2×mix same | live (2/2) | 15 / 18 m | pass |
| branch-spare 2×one opposed | live (2/2; own ends 1) | stall at 11 s (in-way, in-way); 1 / 0 | known: stalls-live:siding, waits-on-points |
| branch-spare 2×one same | live (2/2) | 15 / 14 | pass |
| branch-spare 2×own opposed | live (2/2; own ends 1) | stall at 11 s (in-way, in-way); 1 / 0 | known: stalls-live:siding, waits-on-points |
| branch-spare 2×own same | live (2/2) | 15 / 14 | pass |
| branch-spare 3×mix opposed | dead (0/3) | stall at 8 s (in-way, in-way, in-way); 0 / 0.2 m / 0.7 m | pass |
| branch-spare 3×mix same | live (3/3) | 15 / 18 m / 18 m | pass |
| branch-spare 3×one opposed | dead (0/3) | stall at 8 s (in-way, in-way, in-way); 0 / 0 / 0 | pass |
| branch-spare 3×one same | live (3/3) | 15 / 15 / 14 | pass |
| crossing 1×hand | live (1/1) | 15 m | pass |
| crossing 1×one | live (1/1) | 12 | pass |
| crossing 2×hand opposed | live (2/2) | 14.9 m / 15 m | pass |
| crossing 2×hand same | live (2/2) | 15 m / 14.6 m | pass |
| crossing 2×mix opposed | live (2/2) | 7 / 9.8 m | pass |
| crossing 2×mix same | live (2/2) | 7 / 8.9 m | pass |
| crossing 2×one opposed | dead (0/2) | stall at 9 s (too-many, –); 0 / 0 | pass |
| crossing 2×one same | dead (0/2) | stall at 11 s (too-many, –); 0 / 1 | pass |
| crossing 2×own opposed | live (2/2) | 7 / 8 | pass |
| crossing 2×own same | live (2/2) | 7 / 7 | pass |
| double 1×hand | live (1/1) | 15.1 m | pass |
| double 1×one | live (1/1) | 11 | pass |
| double 2×hand opposed | live (2/2) | 14.9 m / 15 m | pass |
| double 2×hand same | live (2/2) | 15.1 m / 14.6 m | pass |
| double 2×mix opposed | live (2/2) | 11 / 15 m | pass |
| double 2×mix same | live (2/2) | 11 / 14.4 m | pass |
| double 2×one opposed | partial (1/2) | stall at 9 s (too-many, –); 0 / 0 | pass |
| double 2×one same | partial (1/2) | stall at 15 s (too-many, –); 0 / 1 | pass |
| double 2×own opposed | live (2/2) | 11 / 11 | pass |
| double 2×own same | live (2/2) | 11 / 11 | pass |
| double 3×mix opposed | live (2/2) | 11 / 15 m | pass |
| double 3×mix same | live (2/2) | 11 / 14.4 m | pass |
| double 3×one opposed | partial (1/2) | stall at 9 s (too-many, –); 0 / 0 | pass |
| double 3×one same | partial (1/2) | stall at 17 s (–, too-many); 0 / 1 | pass |
| line0 1×hand | live (1/1) | 15 m | pass |
| line0 1×one | live (1/1) | 11 | pass |
| line0 2×hand opposed | dead (0/2) | stall at 8 s (in-way, in-way); 0.1 m / 0.1 m | pass |
| line0 2×hand same | live (2/2) | 13.3 m / 13.3 m | pass |
| line0 2×mix opposed | dead (0/2) | stall at 6 s (in-way, in-way); 0 / 0 m | pass |
| line0 2×mix same | partial (1/2) | stall at 13 s (in-way, in-way); 0 / 0.6 m | pass |
| line0 2×one opposed | dead (0/2) | stall at 6 s (too-many, –); 0 / 0 | pass |
| line0 2×one same | dead (0/2) | stall at 13 s (too-many, –); 0 / 1 | pass |
| line0 2×own opposed | dead (0/2) | stall at 6 s (in-way, in-way); 0 / 0 | pass |
| line0 2×own same | dead (0/2) | stall at 13 s (in-way, in-way); 0 / 1 | pass |
| line1 1×hand | live (1/1) | 16.4 m | pass |
| line1 1×one | live (1/1) | 6 | pass |
| line1 2×hand opposed | dead (0/2; own ends 2) | 15.9 m / 16 m | pass |
| line1 2×hand same | live (2/2) | stall at 17 s (in-way, in-way); 1.3 m / 1.1 m | pass |
| line1 2×mix opposed | live (2/2) | 6 / 15.8 m | pass |
| line1 2×mix same | live (2/2) | 5 / 15.8 m | pass |
| line1 2×one opposed | live (2/2) | 6 / 6 | pass |
| line1 2×one same | live (2/2) | 6 / 7 | pass |
| line1 2×own opposed | live (2/2) | 6 / 6 | pass |
| line1 2×own same | live (2/2) | 6 / 7 | pass |
| line1 3×mix opposed | live (3/3) | 4 / 11.2 m / 10.9 m | pass |
| line1 3×mix same | live (3/3) | 3 / 9.8 m / 9.6 m | pass |
| line1 3×one opposed | live (3/3) | 4 / 4 / 5 | pass |
| line1 3×one same | live (3/3) | 3 / 4 / 5 | pass |
| line1+siding 1×hand | live (1/1) | 16.4 m | pass |
| line1+siding 1×one | live (1/1) | 6 | pass |
| line1+siding 2×hand opposed | dead (0/2) | 15.5 m / 15.2 m | pass |
| line1+siding 2×hand same | dead (0/2) | stall at 19 s (in-way, in-way); 1.5 m / 1.2 m | known: waits-on-points |
| line1+siding 2×mix opposed | live (2/2) | 6 / 15.1 m | pass |
| line1+siding 2×mix same | live (2/2) | 5 / 15.4 m | pass |
| line1+siding 2×one opposed | live (2/2) | 6 / 6 | pass |
| line1+siding 2×one same | live (2/2) | 5 / 6 | pass |
| line1+siding 2×own opposed | live (2/2) | 6 / 6 | pass |
| line1+siding 2×own same | live (2/2) | 5 / 6 | pass |
| line1+siding 3×mix opposed | partial (1/3) | 4 / 10.7 m / 10.2 m | pass |
| line1+siding 3×mix same | dead (0/3) | 2 / 9.1 m / 10 m | pass |
| line1+siding 3×one opposed | live (3/3) | 4 / 4 / 4 | pass |
| line1+siding 3×one same | live (3/3) | 3 / 4 / 4 | pass |
| line1+siding-spare 1×hand | live (1/1) | 16.4 m | pass |
| line1+siding-spare 1×one | live (1/1) | 6 | pass |
| line1+siding-spare 2×hand opposed | dead (0/2) | 15.5 m / 15.2 m | pass |
| line1+siding-spare 2×hand same | dead (0/2) | stall at 19 s (in-way, in-way); 1.5 m / 1.2 m | known: waits-on-points |
| line1+siding-spare 2×mix opposed | live (2/2) | 6 / 15.1 m | pass |
| line1+siding-spare 2×mix same | live (2/2) | 5 / 15.4 m | pass |
| line1+siding-spare 2×one opposed | live (2/2) | 6 / 6 | pass |
| line1+siding-spare 2×one same | live (2/2) | 5 / 6 | pass |
| line1+siding-spare 2×own opposed | live (2/2) | 6 / 6 | pass |
| line1+siding-spare 2×own same | live (2/2) | 5 / 6 | pass |
| line1+siding-spare 3×mix opposed | partial (1/3) | 4 / 10.7 m / 10.2 m | pass |
| line1+siding-spare 3×mix same | dead (0/3) | 2 / 9.1 m / 10 m | pass |
| line1+siding-spare 3×one opposed | live (3/3) | 4 / 4 / 4 | pass |
| line1+siding-spare 3×one same | live (3/3) | 3 / 4 / 4 | pass |
| line2 1×hand | live (1/1) | 16.6 m | pass |
| line2 1×one | live (1/1) | 5 | pass |
| line2 2×hand opposed | dead (0/2) | 15.6 m / 14.4 m | pass |
| line2 2×hand same | live (2/2) | 14.3 m / 15.3 m | pass |
| line2 2×mix opposed | live (2/2) | 4 / 15.3 m | pass |
| line2 2×mix same | live (2/2) | 4 / 16 m | pass |
| line2 2×one opposed | live (2/2) | 4 / 4 | pass |
| line2 2×one same | live (2/2) | 4 / 5 | pass |
| line2 2×own opposed | live (2/2) | 4 / 4 | pass |
| line2 2×own same | live (2/2) | 4 / 5 | pass |
| line2 3×mix opposed | live (3/3) | 4 / 15.6 m / 15.4 m | pass |
| line2 3×mix same | live (3/3) | 3 / 14.2 m / 15.5 m | pass |
| line2 3×one opposed | live (3/3) | 4 / 4 / 4 | pass |
| line2 3×one same | live (3/3) | 3 / 4 / 5 | pass |
| line3 1×hand | live (1/1) | 17.3 m | pass |
| line3 1×one | live (1/1) | 4 | pass |
| line3 2×hand opposed | dead (0/2) | 15.3 m / 15.6 m | pass |
| line3 2×hand same | live (2/2) | 16.1 m / 16.6 m | pass |
| line3 2×mix opposed | live (2/2) | 3 / 16.9 m | pass |
| line3 2×mix same | live (2/2) | 3 / 16.9 m | pass |
| line3 2×one opposed | live (2/2) | 3 / 3 | pass |
| line3 2×one same | live (2/2) | 3 / 4 | pass |
| line3 2×own opposed | live (2/2) | 3 / 3 | pass |
| line3 2×own same | live (2/2) | 3 / 4 | pass |
| line3 3×mix opposed | live (3/3) | 3 / 15.9 m / 16.5 m | pass |
| line3 3×mix same | live (3/3) | 3 / 15.4 m / 16.1 m | pass |
| line3 3×one opposed | live (3/3) | 3 / 3 / 4 | pass |
| line3 3×one same | live (3/3) | 3 / 3 / 4 | pass |
| ring0 1×hand | live (1/1) | 18 m | pass |
| ring0 1×one | live (1/1) | 13 | pass |
| ring0 2×hand opposed | dead (0/2) | stall at 11 s (in-way, in-way); 0.6 m / 0.6 m | pass |
| ring0 2×hand same | live (2/2) | 18 m / 18 m | pass |
| ring0 2×mix opposed | dead (0/2) | stall at 11 s (in-way, in-way); 1 / 0.6 m | pass |
| ring0 2×mix same | live (2/2) | 13 / 18 m | pass |
| ring0 2×one opposed | dead (0/2) | stall at 11 s (in-way, in-way); 1 / 0 | pass |
| ring0 2×one same | live (2/2) | 13 / 12 | pass |
| ring0 2×own opposed | dead (0/2) | stall at 11 s (in-way, in-way); 1 / 0 | pass |
| ring0 2×own same | live (2/2) | 13 / 12 | pass |
| ring0 3×mix opposed | dead (0/3) | stall at 10 s (in-way, in-way, in-way); 0 / 0.5 m / 1.2 m | pass |
| ring0 3×mix same | live (3/3) | 13 / 18 m / 18 m | pass |
| ring0 3×one opposed | dead (0/3) | stall at 10 s (in-way, in-way, in-way); 0 / 0 / 0 | pass |
| ring0 3×one same | live (3/3) | 13 / 13 / 12 | pass |
| ring1 1×hand | live (1/1) | 18 m | pass |
| ring1 1×one | live (1/1) | 11 | pass |
| ring1 2×hand opposed | dead (0/2) | stall at 60 s (in-way, in-way); 3.1 m / 5.2 m | pass |
| ring1 2×hand same | live (2/2) | 18 m / 18 m | pass |
| ring1 2×mix opposed | live (2/2) | 5 / 10.3 m | pass |
| ring1 2×mix same | live (2/2) | 11 / 18 m | pass |
| ring1 2×one opposed | live (2/2) | 5 / 5 | pass |
| ring1 2×one same | live (2/2) | 11 / 10 | pass |
| ring1 2×own opposed | live (2/2) | 5 / 5 | pass |
| ring1 2×own same | live (2/2) | 11 / 10 | pass |
| ring1 3×mix opposed | dead (0/3) | stall at 6 s (in-way, in-way, in-way); 0 / 0 m / 0 m | pass |
| ring1 3×mix same | live (3/3) | 11 / 18 m / 18 m | pass |
| ring1 3×one opposed | dead (0/3) | stall at 6 s (in-way, in-way, –); 0 / 0 / 0 | pass |
| ring1 3×one same | live (3/3) | 11 / 11 / 10 | pass |
| ring2 1×hand | live (1/1) | 18 m | pass |
| ring2 1×one | live (1/1) | 12 | pass |
| ring2 2×hand opposed | dead (0/2) | stall at 53 s (in-way, in-way); 4 m / 3.9 m | pass |
| ring2 2×hand same | live (2/2) | 18 m / 18 m | pass |
| ring2 2×mix opposed | live (2/2) | 11 / 16.8 m | pass |
| ring2 2×mix same | live (2/2) | 11 / 18 m | pass |
| ring2 2×one opposed | live (2/2) | 11 / 9 | pass |
| ring2 2×one same | live (2/2) | 11 / 10 | pass |
| ring2 2×own opposed | live (2/2) | 11 / 9 | pass |
| ring2 2×own same | live (2/2) | 11 / 10 | pass |
| ring2 3×mix opposed | dead (0/3) | stall at 6 s (in-way, in-way, in-way); 0 / 0 m / 0.8 m | pass |
| ring2 3×mix same | live (3/3) | 11 / 18 m / 18 m | pass |
| ring2 3×one opposed | dead (0/3) | stall at 6 s (in-way, in-way, in-way); 0 / 0 / 0 | pass |
| ring2 3×one same | live (3/3) | 11 / 12 / 10 | pass |
| siding 1×hand | live (1/1) | 15.6 m | pass |
| siding 1×one | live (1/1) | 10 | pass |
| siding 2×hand opposed | dead (0/2) | stall at 28 s (in-way, in-way); 2 m / 1.3 m | pass |
| siding 2×hand same | dead (0/2) | stall at 13 s (in-way, in-way); 0.8 m / 0.6 m | pass |
| siding 2×mix opposed | partial (1/2; through an industry siding 2) | stall at 9 s (in-way, in-way); 0 / 0.1 m | pass |
| siding 2×mix same | partial (1/2; through an industry siding 2) | stall at 17 s (in-way, in-way); 0 / 1.1 m | pass |
| siding 2×one opposed | partial (1/2; through an industry siding 2) | stall at 9 s (too-many, –); 0 / 0 | pass |
| siding 2×one same | partial (1/2; through an industry siding 2) | stall at 17 s (–, too-many); 0 / 1 | pass |
| siding 2×own opposed | partial (1/2; through an industry siding 2) | stall at 9 s (in-way, in-way); 0 / 0 | pass |
| siding 2×own same | partial (1/2; through an industry siding 2) | stall at 17 s (in-way, in-way); 0 / 1 | pass |
| siding 3×mix opposed | dead (0/3) | stall at 6 s (in-way, in-way, in-way); 0 / 0 m / 0.4 m | pass |
| siding 3×mix same | dead (0/3) | stall at 21 s (in-way, in-way, in-way); 0 / 1.2 m / 0.8 m | pass |
| siding 3×one opposed | dead (0/3) | stall at 6 s (–, too-many, –); 0 / 0 / 1 | pass |
| siding 3×one same | dead (0/3) | stall at 7 s (too-many, –, –); 0 / 0 / 1 | pass |
| siding-spare 1×hand | live (1/1) | 15.6 m | pass |
| siding-spare 1×one | live (1/1) | 10 | pass |
| siding-spare 2×hand opposed | dead (0/2) | stall at 28 s (in-way, in-way); 2 m / 1.3 m | pass |
| siding-spare 2×hand same | dead (0/2) | stall at 13 s (in-way, in-way); 0.8 m / 0.6 m | pass |
| siding-spare 2×mix opposed | live (2/2; own ends 1) | stall at 9 s (in-way, in-way); 0 / 0.1 m | pass |
| siding-spare 2×mix same | live (2/2; own ends 1) | stall at 17 s (in-way, in-way); 0 / 1.1 m | pass |
| siding-spare 2×one opposed | live (2/2; own ends 1) | stall at 9 s (too-many, –); 0 / 0 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| siding-spare 2×one same | live (2/2; own ends 1) | stall at 17 s (–, too-many); 0 / 1 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| siding-spare 2×own opposed | live (2/2; own ends 1) | stall at 9 s (in-way, in-way); 0 / 0 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| siding-spare 2×own same | live (2/2; own ends 1) | stall at 17 s (in-way, in-way); 0 / 1 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| siding-spare 3×mix opposed | dead (0/3) | stall at 6 s (in-way, in-way, in-way); 0 / 0 m / 0.4 m | pass |
| siding-spare 3×mix same | dead (0/3) | stall at 21 s (in-way, in-way, in-way); 0 / 1.2 m / 0.8 m | pass |
| siding-spare 3×one opposed | dead (0/3) | stall at 6 s (–, too-many, –); 0 / 0 / 1 | pass |
| siding-spare 3×one same | dead (0/3) | stall at 7 s (too-many, –, –); 0 / 0 / 1 | pass |
| terminus 1×hand | live (1/1) | 15.5 m | pass |
| terminus 1×one | live (1/1) | 9 | pass |
| terminus 2×hand opposed | dead (0/2) | 12.9 m / 11.7 m | pass |
| terminus 2×hand same | live (2/2) | stall at 13 s (in-way, in-way); 0.8 m / 0.6 m | pass |
| terminus 2×mix opposed | partial (1/2; through an industry siding 2) | stall at 10 s (in-way, in-way); 0 / 0.5 m | pass |
| terminus 2×mix same | live (2/2) | stall at 17 s (in-way, in-way); 0 / 1.1 m | pass |
| terminus 2×one opposed | partial (1/2; through an industry siding 2) | stall at 10 s (too-many, –); 0 / 0 | pass |
| terminus 2×one same | partial (1/2; through an industry siding 2) | stall at 17 s (too-many, –); 0 / 1 | pass |
| terminus 2×own opposed | partial (1/2; through an industry siding 2) | stall at 10 s (in-way, in-way); 0 / 0 | pass |
| terminus 2×own same | partial (1/2; through an industry siding 2) | stall at 17 s (in-way, in-way); 0 / 1 | pass |
| terminus 3×mix opposed | partial (2/3; through an industry siding 3) | stall at 9 s (in-way, in-way, in-way); 0 / 0.1 m / 0.1 m | pass |
| terminus 3×mix same | partial (2/3; through an industry siding 3) | stall at 9 s (in-way, in-way, in-way); 0 / 0.1 m / 0.1 m | pass |
| terminus 3×one opposed | partial (2/3; through an industry siding 3) | stall at 9 s (too-many, –, –); 0 / 0 / 0 | pass |
| terminus 3×one same | partial (2/3; through an industry siding 3) | stall at 9 s (–, too-many, –); 0 / 1 / 0 | pass |
| terminus-spare 1×hand | live (1/1) | 15.5 m | pass |
| terminus-spare 1×one | live (1/1) | 9 | pass |
| terminus-spare 2×hand opposed | dead (0/2) | 12.9 m / 11.7 m | pass |
| terminus-spare 2×hand same | live (2/2) | stall at 13 s (in-way, in-way); 0.8 m / 0.6 m | pass |
| terminus-spare 2×mix opposed | live (2/2; own ends 1) | stall at 10 s (in-way, in-way); 0 / 0.5 m | pass |
| terminus-spare 2×mix same | live (2/2) | stall at 17 s (in-way, in-way); 0 / 1.1 m | pass |
| terminus-spare 2×one opposed | live (2/2; own ends 1) | stall at 10 s (too-many, –); 0 / 0 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| terminus-spare 2×one same | live (2/2; own ends 1) | stall at 17 s (too-many, –); 0 / 1 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| terminus-spare 2×own opposed | live (2/2; own ends 1) | stall at 10 s (in-way, in-way); 0 / 0 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| terminus-spare 2×own same | live (2/2; own ends 1) | stall at 17 s (in-way, in-way); 0 / 1 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| terminus-spare 3×mix opposed | live (3/3; own ends 2) | stall at 9 s (in-way, in-way, in-way); 0 / 0.1 m / 0.1 m | pass |
| terminus-spare 3×mix same | live (3/3; own ends 2) | stall at 9 s (in-way, in-way, in-way); 0 / 0.1 m / 0.1 m | pass |
| terminus-spare 3×one opposed | live (3/3; own ends 2) | stall at 9 s (too-many, –, –); 0 / 0 / 0 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| terminus-spare 3×one same | live (3/3; own ends 2) | stall at 9 s (–, too-many, –); 0 / 1 / 0 | known: stalls-live:siding (waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out) |
| wye 1×hand | live (1/1) | 16.1 m | pass |
| wye 1×one | live (1/1) | 9 | pass |
| wye 2×hand opposed | dead (0/2) | stall at 35 s (in-way, in-way); 2.6 m / 2.2 m | known: waits-on-points |
| wye 2×hand same | live (2/2) | stall at 14 s (in-way, in-way); 0.9 m / 0.7 m | pass |
| wye 2×mix opposed | partial (1/2; through an industry siding 2) | 5 / 12.7 m | pass |
| wye 2×mix same | live (2/2) | 5 / 12.7 m | pass |
| wye 2×one opposed | partial (1/2; through an industry siding 2) | stall at 10 s (too-many, –); 0 / 0 | pass |
| wye 2×one same | partial (1/2; through an industry siding 2) | stall at 17 s (too-many, –); 0 / 1 | pass |
| wye 2×own opposed | partial (1/2; through an industry siding 2) | stall at 10 s (in-way, in-way); 0 / 0 | pass |
| wye 2×own same | partial (1/2; through an industry siding 2) | stall at 17 s (in-way, in-way); 0 / 1 | pass |
| wye 3×mix opposed | partial (2/3; through an industry siding 3) | stall at 24 s (in-way, in-way, in-way); 0 / 2 m / 0.8 m | pass |
| wye 3×mix same | partial (2/3; through an industry siding 3) | stall at 9 s (in-way, in-way, in-way); 0 / 0.1 m / 0.1 m | pass |
| wye 3×one opposed | partial (2/3; through an industry siding 3) | stall at 9 s (too-many, –, –); 0 / 0 / 0 | pass |
| wye 3×one same | partial (2/3; through an industry siding 3) | stall at 9 s (–, too-many, –); 0 / 1 / 0 | pass |
| wye-spare 1×hand | live (1/1) | 16.1 m | pass |
| wye-spare 1×one | live (1/1) | 9 | pass |
| wye-spare 2×hand opposed | dead (0/2) | stall at 35 s (in-way, in-way); 2.6 m / 2.2 m | known: waits-on-points |
| wye-spare 2×hand same | live (2/2) | stall at 14 s (in-way, in-way); 0.9 m / 0.7 m | pass |
| wye-spare 2×mix opposed | live (2/2) | 4 / 8.1 m | pass |
| wye-spare 2×mix same | live (2/2) | 4 / 8.6 m | pass |
| wye-spare 2×one opposed | live (2/2) | 4 / 5 | pass |
| wye-spare 2×one same | live (2/2) | 4 / 6 | pass |
| wye-spare 2×own opposed | live (2/2) | 4 / 5 | pass |
| wye-spare 2×own same | live (2/2) | 4 / 6 | pass |
| wye-spare 3×mix opposed | live (3/3; own ends 2) | stall at 31 s (in-way, in-way, in-way); 0 / 1.9 m / 0.8 m | pass |
| wye-spare 3×mix same | live (3/3; own ends 2) | stall at 9 s (in-way, in-way, in-way); 0 / 0.1 m / 0.1 m | pass |
| wye-spare 3×one opposed | live (3/3; own ends 2) | stall at 15 s (too-many, too-many, –); 0 / 0 / 1 | known: stalls-live:siding (waiting on the user's call: with three trains the one aside in the spare end must wait for two to pass, the second behind it as a convoy (§16 Q9), which decision 4 keeps out) |
| wye-spare 3×one same | live (3/3; own ends 2) | stall at 9 s (too-many, too-many, –); 0 / 1 / 0 | known: stalls-live:siding (waiting on the user's call: with three trains the one aside in the spare end must wait for two to pass, the second behind it as a convoy (§16 Q9), which decision 4 keeps out) |

### signals (104 cases, 1 mismatched)

| Case | Oracle | Game (stops per train; hand-run: metres) | Result |
|---|---|---|---|
| line0 2×one opposed sig:blocks2 | dead (0/2; no signals 0) | stall at 7 s (signals, signals); 0 / 0 | pass |
| line0 2×one opposed sig:blocks3 | dead (0/2; no signals 0) | stall at 7 s (too-many, –); 0 / 0 | pass |
| line0 2×one opposed sig:oneway3 | dead (0/2; no signals 0) | stall at 7 s (too-many, –); 0 / 0 | pass |
| line0 2×one opposed sig:pair | dead (0/2; no signals 0) | stall at 7 s (signals, signals); 0 / 0 | pass |
| line0 2×one same sig:blocks2 | dead (0/2; no signals 0) | stall at 9 s (too-many, –); 0 / 0 | pass |
| line0 2×one same sig:blocks3 | dead (0/2; no signals 0) | stall at 7 s (too-many, –); 0 / 0 | pass |
| line0 2×one same sig:oneway3 | dead (0/2; no signals 0) | stall at 7 s (too-many, –); 0 / 0 | pass |
| line0 2×one same sig:pair | dead (0/2; no signals 0) | stall at 9 s (too-many, –); 0 / 0 | pass |
| line0 2×own same sig:blocks2 | dead (0/2; no signals 0) | stall at 13 s (signals, signals); 0 / 1 | pass |
| line0 2×own same sig:blocks3 | dead (0/2; no signals 0) | stall at 13 s (in-way, in-way); 0 / 1 | pass |
| line0 2×own same sig:oneway3 | dead (0/2; no signals 0) | stall at 13 s (in-way, in-way); 0 / 1 | pass |
| line0 2×own same sig:pair | dead (0/2; no signals 0) | stall at 13 s (signals, signals); 0 / 1 | pass |
| line1 2×one opposed sig:beforePoints | live (2/2) | 6 / 6 | pass |
| line1 2×one opposed sig:blocks2 | live (2/2) | 6 / 6 | pass |
| line1 2×one opposed sig:blocks3 | live (2/2) | 6 / 6 | pass |
| line1 2×one opposed sig:inLoop | live (2/2) | 6 / 6 | pass |
| line1 2×one opposed sig:loopEnds | live (2/2) | 6 / 6 | pass |
| line1 2×one opposed sig:oneway3 | live (2/2) | 6 / 6 | pass |
| line1 2×one opposed sig:pair | live (2/2) | 6 / 6 | pass |
| line1 2×one same sig:beforePoints | live (2/2) | 6 / 7 | pass |
| line1 2×one same sig:blocks2 | live (2/2) | 5 / 6 | pass |
| line1 2×one same sig:blocks3 | live (2/2) | 5 / 6 | pass |
| line1 2×one same sig:inLoop | live (2/2) | 6 / 7 | pass |
| line1 2×one same sig:loopEnds | live (2/2) | 6 / 7 | pass |
| line1 2×one same sig:oneway3 | live (2/2) | 6 / 7 | pass |
| line1 2×one same sig:pair | live (2/2) | 5 / 6 | pass |
| line1 2×own same sig:beforePoints | live (2/2) | 6 / 7 | pass |
| line1 2×own same sig:blocks2 | live (2/2) | 5 / 6 | pass |
| line1 2×own same sig:blocks3 | live (2/2) | 5 / 6 | pass |
| line1 2×own same sig:inLoop | live (2/2) | 6 / 7 | pass |
| line1 2×own same sig:loopEnds | live (2/2) | 6 / 7 | pass |
| line1 2×own same sig:oneway3 | live (2/2) | 6 / 7 | pass |
| line1 2×own same sig:pair | live (2/2) | 5 / 6 | pass |
| line1 3×one opposed sig:beforePoints | live (3/3) | 4 / 4 / 5 | pass |
| line1 3×one opposed sig:blocks2 | live (3/3) | 4 / 4 / 5 | pass |
| line1 3×one opposed sig:blocks3 | live (3/3) | 4 / 4 / 5 | pass |
| line1 3×one opposed sig:inLoop | live (3/3) | 4 / 4 / 5 | pass |
| line1 3×one opposed sig:loopEnds | live (3/3) | 4 / 4 / 5 | pass |
| line1 3×one opposed sig:oneway3 | live (3/3) | 4 / 4 / 5 | pass |
| line1 3×one opposed sig:pair | live (3/3) | 4 / 4 / 5 | pass |
| line1 3×one same sig:beforePoints | live (3/3) | 3 / 4 / 5 | pass |
| line1 3×one same sig:blocks2 | live (3/3) | 3 / 4 / 4 | pass |
| line1 3×one same sig:blocks3 | live (3/3) | 3 / 4 / 4 | pass |
| line1 3×one same sig:inLoop | live (3/3) | 3 / 4 / 5 | pass |
| line1 3×one same sig:loopEnds | live (3/3) | 3 / 4 / 5 | pass |
| line1 3×one same sig:oneway3 | live (3/3) | 3 / 4 / 5 | pass |
| line1 3×one same sig:pair | live (3/3) | 3 / 4 / 4 | pass |
| ring0 2×one opposed sig:blocks2 | dead (0/2; no signals 0) | stall at 17 s (signals, signals); 0 / 0 | pass |
| ring0 2×one opposed sig:blocks4 | dead (0/2; no signals 0) | stall at 15 s (signals, signals); 1 / 0 | pass |
| ring0 2×one opposed sig:pair | dead (0/2; no signals 0) | stall at 13 s (signals, signals); 1 / 0 | pass |
| ring0 2×one same sig:blocks2 | dead (0/2; no signals 2) | stall at 6 s (signals, signals); 0 / 0 | pass |
| ring0 2×one same sig:blocks4 | live (2/2) | 13 / 12 | pass |
| ring0 2×one same sig:pair | dead (0/2; no signals 2) | stall at 23 s (signals, signals); 1 / 1 | pass |
| ring0 2×own same sig:blocks2 | dead (0/2; no signals 2) | stall at 6 s (signals, signals); 0 / 0 | pass |
| ring0 2×own same sig:blocks4 | live (2/2) | 13 / 12 | pass |
| ring0 2×own same sig:pair | dead (0/2; no signals 2) | stall at 23 s (signals, signals); 1 / 1 | pass |
| ring0 3×one opposed sig:blocks2 | dead (0/3; no signals 0) | stall at 12 s (signals, signals, signals); 0 / 0 / 0 | pass |
| ring0 3×one opposed sig:blocks3 | dead (0/3; no signals 0) | stall at 13 s (signals, signals, signals); 0 / 0 / 0 | pass |
| ring0 3×one opposed sig:blocks4 | dead (0/3; no signals 0) | stall at 11 s (signals, signals, signals); 0 / 0 / 0 | pass |
| ring0 3×one opposed sig:oneway3 | dead (0/3; no signals 0) | stall at 13 s (signals, signals, signals); 0 / 0 / 0 | pass |
| ring0 3×one opposed sig:pair | dead (0/3; no signals 0) | stall at 10 s (in-way, in-way, in-way); 0 / 0 / 0 | pass |
| ring0 3×one same sig:blocks2 | dead (0/3; no signals 3) | stall at 15 s (signals, signals, signals); 0 / 1 / 0 | pass |
| ring0 3×one same sig:blocks4 | live (3/3) | 10 / 10 / 9 | pass |
| ring0 3×one same sig:pair | dead (0/3; no signals 3) | stall at 19 s (signals, signals, signals); 1 / 1 / 0 | pass |
| ring1 2×one opposed sig:beforePoints | live (2/2) | 5 / 5 | pass |
| ring1 2×one opposed sig:blocks2 | live (2/2) | 5 / 5 | pass |
| ring1 2×one opposed sig:blocks3 | live (2/2) | 5 / 5 | pass |
| ring1 2×one opposed sig:blocks4 | live (2/2) | 5 / 5 | pass |
| ring1 2×one opposed sig:inLoop | live (2/2) | 5 / 5 | pass |
| ring1 2×one opposed sig:loopEnds | live (2/2) | 5 / 5 | pass |
| ring1 2×one opposed sig:oneway3 | live (2/2) | 5 / 5 | pass |
| ring1 2×one opposed sig:pair | live (2/2) | 5 / 5 | pass |
| ring1 2×one same sig:beforePoints | live (2/2) | 11 / 10 | pass |
| ring1 2×one same sig:blocks2 | live (2/2) | 10 / 9 | pass |
| ring1 2×one same sig:blocks3 | live (2/2) | 11 / 10 | pass |
| ring1 2×one same sig:blocks4 | live (2/2) | 11 / 10 | pass |
| ring1 2×one same sig:inLoop | live (2/2) | 11 / 10 | pass |
| ring1 2×one same sig:loopEnds | live (2/2) | 11 / 10 | pass |
| ring1 2×one same sig:oneway3 | live (2/2) | 11 / 10 | pass |
| ring1 2×one same sig:pair | live (2/2) | 11 / 10 | pass |
| ring1 2×own same sig:beforePoints | live (2/2) | 11 / 10 | pass |
| ring1 2×own same sig:blocks2 | live (2/2) | 10 / 9 | pass |
| ring1 2×own same sig:blocks3 | live (2/2) | 11 / 10 | pass |
| ring1 2×own same sig:blocks4 | live (2/2) | 11 / 10 | pass |
| ring1 2×own same sig:inLoop | live (2/2) | 11 / 10 | pass |
| ring1 2×own same sig:loopEnds | live (2/2) | 11 / 10 | pass |
| ring1 2×own same sig:oneway3 | live (2/2) | 11 / 10 | pass |
| ring1 2×own same sig:pair | live (2/2) | 11 / 10 | pass |
| ring1 3×one opposed sig:beforePoints | dead (0/3; no signals 0) | stall at 6 s (in-way, in-way, –); 0 / 0 / 0 | pass |
| ring1 3×one opposed sig:blocks2 | dead (0/3; no signals 0) | stall at 7 s (signals, signals, –); 0 / 0 / 0 | pass |
| ring1 3×one opposed sig:blocks3 | dead (0/3; no signals 0) | stall at 7 s (signals, signals, –); 0 / 0 / 0 | pass |
| ring1 3×one opposed sig:blocks4 | dead (0/3; no signals 0) | stall at 10 s (in-way, in-way, –); 0 / 0 / 0 | pass |
| ring1 3×one opposed sig:inLoop | dead (0/3; no signals 0) | stall at 6 s (in-way, in-way, –); 0 / 0 / 0 | pass |
| ring1 3×one opposed sig:loopEnds | dead (0/3; no signals 0) | stall at 6 s (in-way, in-way, –); 0 / 0 / 0 | pass |
| ring1 3×one opposed sig:oneway3 | dead (0/3; no signals 0) | stall at 11 s (in-way, in-way, –); 0 / 0 / 0 | pass |
| ring1 3×one opposed sig:pair | dead (0/3; no signals 0) | stall at 7 s (in-way, in-way, –); 0 / 0 / 0 | pass |
| ring1 3×one same sig:beforePoints | live (3/3) | 11 / 11 / 10 | pass |
| ring1 3×one same sig:blocks2 | live (3/3) | stall at 27 s (signals, signals, signals); 1 / 1 / 0 | known: stalls-live |
| ring1 3×one same sig:blocks3 | live (3/3) | 10 / 10 / 9 | pass |
| ring1 3×one same sig:blocks4 | live (3/3) | 10 / 10 / 9 | pass |
| ring1 3×one same sig:inLoop | live (3/3) | 11 / 11 / 10 | pass |
| ring1 3×one same sig:loopEnds | live (3/3) | 11 / 11 / 10 | pass |
| ring1 3×one same sig:oneway3 | live (3/3) | 10 / 10 / 9 | pass |
| ring1 3×one same sig:pair | live (3/3) | 11 / 11 / 10 | pass |

### placement (30 cases, 1 mismatched)

| Case | Oracle | Game (stops per train; hand-run: metres) | Result |
|---|---|---|---|
| line0 2×hand opposed facing | dead (0/2) | stall at 8 s (in-way, in-way); 0.2 m / 0.2 m | pass |
| line0 2×hand same points | live (2/2) | 13.3 m / 13.3 m | pass |
| line0 2×hand same straddle sig:blocks3 | partial (1/2; no signals 2) | stall at 13 s (signals, signals); 0.4 m / 0.6 m | pass |
| line0 2×hand same tail | live (2/2) | 13.3 m / 13.3 m | pass |
| line0 2×one opposed facing | dead (0/2) | stall at 6 s (too-many, –); 0 / 0 | pass |
| line0 2×one same points | dead (0/2) | stall at 13 s (too-many, –); 0 / 1 | pass |
| line0 2×one same straddle sig:blocks3 | dead (0/2; no signals 0) | stall at 7 s (too-many, –); 0 / 0 | pass |
| line0 2×one same tail | dead (0/2) | stall at 13 s (too-many, –); 0 / 1 | pass |
| line1 2×hand opposed facing | dead (0/2) | stall at 10 s (in-way, in-way); 0.4 m / 0.4 m | known: waits-on-points |
| line1 2×hand same points | live (2/2) | stall at 17 s (in-way, in-way); 1.2 m / 1 m | pass |
| line1 2×hand same straddle sig:blocks3 | dead (0/2; no signals 2) | stall at 19 s (signals, signals); 1.3 m / 1.2 m | pass |
| line1 2×hand same tail | live (2/2) | stall at 22 s (in-way, in-way); 1.8 m / 1.6 m | pass |
| line1 2×one opposed facing | live (2/2) | 6 / 6 | pass |
| line1 2×one same points | live (2/2) | 6 / 7 | pass |
| line1 2×one same straddle sig:blocks3 | live (2/2) | 5 / 6 | pass |
| line1 2×one same tail | live (2/2) | 5 / 6 | pass |
| ring0 2×hand opposed facing | dead (0/2) | stall at 9 s (in-way, in-way); 0.3 m / 0.3 m | pass |
| ring0 2×hand same straddle sig:blocks3 | live (2/2) | 18 m / 17.9 m | pass |
| ring0 2×hand same tail | live (2/2) | 18 m / 18 m | pass |
| ring0 2×one opposed facing | dead (0/2) | stall at 9 s (in-way, in-way); 1 / 0 | pass |
| ring0 2×one same straddle sig:blocks3 | live (2/2) | 13 / 12 | pass |
| ring0 2×one same tail | live (2/2) | 12 / 13 | pass |
| ring1 2×hand opposed facing | dead (0/2) | stall at 8 s (in-way, in-way); 0.2 m / 0.2 m | pass |
| ring1 2×hand same points | live (2/2) | 18 m / 18 m | pass |
| ring1 2×hand same straddle sig:blocks3 | live (2/2) | 18 m / 18 m | pass |
| ring1 2×hand same tail | live (2/2) | 18 m / 18 m | pass |
| ring1 2×one opposed facing | dead (0/2) | stall at 6 s (in-way, in-way); 0 / 0 | pass |
| ring1 2×one same points | live (2/2) | 10 / 10 | pass |
| ring1 2×one same straddle sig:blocks3 | live (2/2) | 11 / 10 | pass |
| ring1 2×one same tail | live (2/2) | 11 / 11 | pass |

### stops (50 cases, 2 mismatched)

| Case | Oracle | Game (stops per train; hand-run: metres) | Result |
|---|---|---|---|
| branch 1×one stops:far | live (1/1) | 10 | pass |
| branch 2×one opposed stops:far | live (2/2) | stall at 11 s (in-way, in-way); 0 / 0 | known: stalls-live, waits-on-points |
| branch 2×one same stops:far | live (2/2) | 9 / 8 | pass |
| branch 2×own opposed stops:far | live (2/2) | stall at 26 s (in-way, in-way); 1 / 0 | known: stalls-live |
| branch 2×own same stops:far | live (2/2) | 9 / 8 | pass |
| double 1×one stops:far | dead (0/1; through an industry siding 1) | 9 | pass |
| double 2×one opposed stops:far | partial (1/2) | 11 / 0 | pass |
| double 2×one same stops:far | partial (1/2) | 11 / 0 | pass |
| double 2×own opposed stops:far | partial (1/2) | stall at 22 s (in-way, in-way); 1 / 1 | pass |
| double 2×own same stops:far | partial (1/2) | stall at 21 s (in-way, in-way); 1 / 0 | pass |
| line1 1×one stops:loop | dead (0/1; through an industry siding 1) | 7 | pass |
| line1 1×one stops:mid | live (1/1) | 7 | pass |
| line1 2×one opposed stops:loop | partial (1/2; through an industry siding 2) | 7 / 6 | pass |
| line1 2×one opposed stops:mid | live (2/2) | 6 / 6 | pass |
| line1 2×one same stops:loop | partial (1/2; through an industry siding 2) | 6 / 6 | pass |
| line1 2×one same stops:mid | live (2/2) | 6 / 7 | pass |
| line1 2×own opposed stops:loop | partial (1/2; through an industry siding 2) | 7 / 6 | pass |
| line1 2×own opposed stops:mid | live (2/2) | 6 / 6 | pass |
| line1 2×own same stops:loop | partial (1/2; through an industry siding 2) | 6 / 6 | pass |
| line1 2×own same stops:mid | live (2/2) | 6 / 7 | pass |
| line1+siding 1×one stops:far | live (1/1) | 6 | pass |
| line1+siding 2×one opposed stops:far | live (2/2) | 6 / 6 | pass |
| line1+siding 2×one same stops:far | live (2/2) | 5 / 6 | pass |
| line1+siding 2×own opposed stops:far | live (2/2) | 6 / 6 | pass |
| line1+siding 2×own same stops:far | live (2/2) | 5 / 6 | pass |
| line2 1×one stops:loop | dead (0/1; through an industry siding 1) | 5 | pass |
| line2 1×one stops:mid | live (1/1) | 5 | pass |
| line2 2×one opposed stops:loop | partial (1/2; through an industry siding 2) | 4 / 4 | pass |
| line2 2×one opposed stops:mid | live (2/2) | 4 / 4 | pass |
| line2 2×one same stops:loop | partial (1/2; through an industry siding 2) | 4 / 5 | pass |
| line2 2×one same stops:mid | live (2/2) | 4 / 5 | pass |
| line2 2×own opposed stops:loop | partial (1/2; through an industry siding 2) | 4 / 4 | pass |
| line2 2×own opposed stops:mid | live (2/2) | 4 / 4 | pass |
| line2 2×own same stops:loop | partial (1/2; through an industry siding 2) | 4 / 5 | pass |
| line2 2×own same stops:mid | live (2/2) | 4 / 5 | pass |
| siding 1×one stops:far | live (1/1) | 11 | pass |
| siding 2×one opposed stops:far | partial (1/2; through an industry siding 2) | 10 / 0 | pass |
| siding 2×one same stops:far | partial (1/2; through an industry siding 2) | stall at 17 s (–, too-many); 0 / 0 | pass |
| siding 2×own opposed stops:far | partial (1/2; through an industry siding 2) | stall at 29 s (in-way, in-way); 1 / 1 | pass |
| siding 2×own same stops:far | partial (1/2; through an industry siding 2) | stall at 34 s (in-way, in-way); 1 / 0 | pass |
| terminus 1×one stops:far | dead (0/1; through an industry siding 1) | 7 | pass |
| terminus 2×one opposed stops:far | partial (1/2; through an industry siding 2) | 8 / 0 | pass |
| terminus 2×one same stops:far | partial (1/2; through an industry siding 2) | 8 / 0 | pass |
| terminus 2×own opposed stops:far | partial (1/2; through an industry siding 2) | stall at 29 s (in-way, in-way); 1 / 1 | pass |
| terminus 2×own same stops:far | partial (1/2; through an industry siding 2) | stall at 34 s (in-way, in-way); 1 / 0 | pass |
| wye 1×one stops:far | dead (0/1; through an industry siding 1) | 8 | pass |
| wye 2×one opposed stops:far | partial (1/2; through an industry siding 2) | 8 / 0 | pass |
| wye 2×one same stops:far | partial (1/2; through an industry siding 2) | 8 / 0 | pass |
| wye 2×own opposed stops:far | partial (1/2; through an industry siding 2) | stall at 31 s (in-way, in-way); 1 / 1 | pass |
| wye 2×own same stops:far | partial (1/2; through an industry siding 2) | stall at 50 s (in-way, in-way); 2 / 1 | pass |

### lengths (6 cases, 1 mismatched)

| Case | Oracle | Game (stops per train; hand-run: metres) | Result |
|---|---|---|---|
| line1 2×one opposed long | dead (0/2) | stall at 9 s (too-many, –); 0 / 0 | pass |
| line1 2×one opposed short | live (2/2) | 6 / 6 | pass |
| line2 2×one opposed long | dead (0/2) | stall at 9 s (too-many, –); 0 / 0 | pass |
| line2 2×one opposed short | live (2/2) | 4 / 4 | pass |
| ring1 2×one opposed long | dead (0/2) | stall at 13 s (in-way, in-way); 1 / 0 | known: waits-on-points |
| ring1 2×one opposed short | live (2/2) | 6 / 5 | pass |

### fuzz (18 cases, 3 mismatched)

| Case | Oracle | Game (stops per train; hand-run: metres) | Result |
|---|---|---|---|
| fuzz seed 7 | partial (1/2) | stall at 9 s (too-many, –); 0 / 0 | pass |
| fuzz seed 19 | dead (0/2) | stall at 17 s (too-many, –); 0 / 0 | pass |
| fuzz seed 34 | live (3/3) | 7 / 7 / 7 | pass |
| fuzz seed 37 | live (3/3) | 7 / 8 / 7 | pass |
| fuzz seed 42 | dead (0/2) | stall at 6 s (in-way, in-way); 0 / 0 | pass |
| fuzz seed 60 | dead (0/2) | stall at 28 s (in-way, in-way); 1 / 1 | pass |
| fuzz seed 77 | live (3/3) | stall at 13 s (in-way, in-way, in-way); 1.4 m / 0 / 0.6 m | pass |
| fuzz seed 91 | live (3/3) | 8 / 9 / 8 | pass |
| fuzz seed 94 | partial (1/2) | stall at 15 s (in-way, in-way); 0 / 1 | pass |
| fuzz seed 111 | live (3/3) | 10 / 10 / 9 | pass |
| fuzz seed 125 | live (3/3; own ends 2) | stall at 15 s (in-way, in-way, in-way); 0 / 1 / 0 | known: stalls-live:siding (the user's decision 4: boxed in past a passing loop, a convoy into a dead end (boxed.ts's own case), said stuck; the oracle finds a way through stepping aside into the siding off plain points) |
| fuzz seed 126 | live (3/3) | 6 / 7 / 8 | pass |
| fuzz seed 136 | live (3/3) | stall at 11 s (in-way, in-way, in-way); 0 / 0 / 0 | known: stalls-live (the user's decision 4: two of a line's trains following into a line end stay one train to a section (the card says add a passing loop), though the oracle finds a §16 Q9 turn behind the one standing there) |
| fuzz seed 149 | live (3/3) | stall at 11 s (in-way, in-way, in-way); 0 / 0 / 0 | known: stalls-live (the user's decision 4: two of a line's trains following into a line end stay one train to a section (the card says add a passing loop), though the oracle finds a §16 Q9 turn behind the one standing there) |
| fuzz seed 161 | dead (0/2; own ends 2) | 17 / 20 m | **fixed?** |
| fuzz seed 165 | live (3/3) | 9 / 6 / 7 | pass |
| fuzz seed 189 | partial (1/2) | stall at 17 s (in-way, in-way); 1 / 0 | pass |
| fuzz seed 190 | dead (0/2) | stall at 6 s (in-way, in-way); 0 / 0 | pass |
<!-- /cases table -->
