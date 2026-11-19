# Dispatcher step 1: the per-stretch search and the grant/hold model in shadow (2026-11-19)

Branch `claude/dispatch-stretch`, on top of `claude/dispatch-shadow` (07977287) and main b19bcac. Spec:
`docs/superpowers/specs/2026-11-18-dispatcher.md` (§2.2, §4, §5, §8 step 1, §12). Test and script only: nothing in the
game imports any of it, so main's behaviour and bench:tick are unchanged.

Reproduce: `npm run dispatch:report` (about 6 min on 4 cores; `DISPATCH_PROBE=1` adds the at-the-cap timing).
`npm run bench:dispatch` runs the maps alone in plain Node.

## 1. What was built

**`src/routing/stretch.ts`: the per-stretch search.**

The booked way:
- Each train's way runs from where it stands through its next three stops, by its plan (`plan.ts`, the router's
  costs), turning only where the plan turns (a line's end).
- It's cut into positions a piece apart. Each position holds the pieces under the train, front back, as far as it's
  long.
- A loop's other road is a branch: off at facing points, back on at trailing points, within 24 pieces, costing at most
  2,000 mm more (the router's `ROAD_SLACK`), and never bypassing one of its stops.
- One train length of the way it came is kept behind it, for a back-up.

Waiting points:
- A train may rest at a position clear of points, or at one of its own stops (a train too long for its yard stands
  over the points there, as the game allows).
- The waiting points are the last such position before points, a stop, and a line end. Signals aren't waiting points
  in this model: under the dispatcher, a signal's aspect is the hold.

The stretch for a decision:
- It takes the deciding train, then every train standing on, or whose next move runs onto, the way any member is booked
  on to its goal (closure, up to 8 trains, nearest first).
- The others stand where they are, as track that's taken.
- Hand-run and parked trains never move (they're respected, §4.4).

The search:
- **Moves.** A move runs all at once to the next waiting point on each road, over pieces no one stands on. Short of
  that, it closes up behind the train in the way, if clear of points.
- **Memoised DFS.** States are each member's position plus a back-up mask. They form a DAG (moves only go on; a back-up
  happens once per train). The longest waiter goes first.
- **Score.** Trains reaching their goal (stops ahead: 1 for a decision, 2 for the judge) × 64, minus back-ups used, so
  the fewest back-ups win.
- **Back-ups (§2.2 step 5).** Reverse along the way it came, at most one train length, onto free track, to rest clear
  of points, then on the way it was going.
  - Decisions search them only at a standstill (no member can move): "only when nothing else works".
  - The judge tries them whenever no order keeps every train going.
- **Independent moves.** A train's only move that no other member's way will ever need is taken alone. This is a sound
  reduction; it rarely fires on these maps.
- **Cap.** `DISPATCH_STATES` = **500** per decision, with the best order found so far at the cap. `JUDGE_STATES` =
  1,000,000.

**`src/routing/dispatch-stretch-shadow.ts`: the grant/hold model beside today's rules.**

When it decides:
- Event-driven: it looks every 12 ticks (sections' ask rate) for a change in what it reads: a train's front or tail
  piece, standing or moving, its route's next stop or at-stop, its lever.
- No change means no decision. Paused or idle, it does nothing.
- On an event, each train standing waiting (lever on, routed, not busy at a stop) is decided again, longest waiter
  first.
- Ways are built once and moved along (`relocate`): about 5–20 moves to every build.

The decision: **grant** if its best first move keeps the stretch's best; **hold** otherwise. The kinds counted:

| kind | what it means |
| --- | --- |
| grant-held | the dispatcher grants, but today the train stands 5 s |
| hold-granted:blocked | today it went; the model saw its next move onto a piece a *standing* train is on |
| hold-granted:follow | as blocked, but the train in the way was moving off: today follows within a piece, the model a whole piece back (granularity, not a danger) |
| hold-granted:order | today it went; its move was free, but another train goes first in the best order |
| reroute | granted by a loop's other road |
| backup | the stretch at a standstill; a back-up keeps more going |
| no-order / order-found / order-found-backup | a train stuck 30 s today, judged |

**Judge, per jam** (`judgeStretch`, used by `bench/dispatch.bench.ts` with `runJams`, the jams bar's clearing):
- The stretch round the stuck train, goal two stops ahead, searched to the end.
- The same trains judged as they stood 30 s before.
- Then with one back-up.

**Tests:** `src/routing/stretch.test.ts`, five small layouts:
- a lone train delivers;
- head-on with no loop: 0, and no back-up helps;
- head-on with a passing loop: both pass, one on each road;
- a train nose-on over points: no order, but its back-up frees both;
- followers round an oval: both deliver.

## 2. The 141 jams re-judged (eight maps, 1800 s, main's rules and clearing)

| map | jams | resolvable now | avoidable 30 s before | one back-up frees | layout | capped |
| --- | --- | --- | --- | --- | --- | --- |
| complex 1 | 11 | 1 | 6 | 0 | 4 | 0 |
| complex 2 | 19 | 0 | 13 | 0 | 6 | 0 |
| complex 3 | 12 | 2 | 8 | 0 | 2 | 0 |
| Dandelion | 18 | 3 | 1 | 3 | 10 | 1 |
| Rowan 1 | 29 | 2 | 7 | 4 | 16 | 0 |
| Rowan 2 | 31 | 5 | 8 | 0 | 18 | 0 |
| Rowan 3 | 6 | 0 | 0 | 0 | 5 | 1 |
| Wren | 15 | 15 | 0 | 0 | 0 | 0 |
| **all** | **141** | **28** | **43** | **7** | **61** | **2** |

**It finishes:** 139 of 141, against the whole-map oracle's 6 of 141.
- Stretches hold 2–8 trains.
- A judge takes up to about 2 s at its 1M cap. Most take a few ms (complex 1–3: 1–129 states).

**Verdicts:**
- **resolvable:** an order keeps every train of the stretch reaching its stop after next, from the jam.
- **avoidable:** none now, but one from where the same trains stood 30 s before.
- **back-up:** neither, but one back-up keeps more going.
- **layout:** none of these.

**Against the spec's step-1 bar (§9):**
- **Wren's map rings: an order is found.** Wren, Juniper, Pickle, Poppy, Bluebell and Willow at 113 s: 6/6, and every
  one of Wren's 15 jams is resolvable. Today's rules jam there; the dispatcher wouldn't need the player.
- **The complex map's head-ons between the two longest trains: no order** (complex 1 and 2 at 36 s: 0/3 and 1/4;
  back-up 0). As expected.
- **The save 3 stand-off (complex 3, 36 s, Wren, Bluebell and Willow): not found.** 1/3, and a back-up doesn't help.
  Its fix (§1.2 item 4) is Bluebell's straight-on detour, about 9× the direct way. The model re-routes only by a loop's
  other road within 2,000 mm. §2.2 step 4's "stuck: any way that frees what the other needs" is **not built** yet. It's
  the next piece of the search.

**How this compares with the oracle's report (§12):**
- The oracle searches the whole map, forever, with every lever.
- This judge searches the stretch, two stops ahead, along booked ways (plus loop roads).
- So "avoidable" here (43) is a weaker claim than the oracle's: an order existed for those trains for their next two
  stops. It's the claim a dispatcher acts on.
- Not matched jam by jam with the oracle's 6 finished verdicts (complex 1–2: 3 avoidable, 3 layout). In total, this
  judge calls 10 of complex 1–2's 30 jams layout and 19 avoidable.

## 3. Where the dispatcher would decide differently (shadow beside today's rules)

The eight maps (1800 s each, main's rules and clearing) and the fuzz (40 seeds × 600 s, plain and with signals; the
ring fuzz's trains are all hand-run, so there's nothing to decide there). Counts are once a stand.

| kind | 8 maps | fuzz |
| --- | --- | --- |
| grant-held | 741 | 670 |
| hold-granted:blocked | 230 | 48 |
| hold-granted:follow | 147 | 0 |
| hold-granted:order | 3 | 0 |
| reroute | 5 | 96 |
| backup | 6 | 0 |
| no-order (a train stuck 30 s) | 183 | 3 |
| order-found | 38 | 3 |
| order-found-backup | 5 | 0 |
| agreed: went when granted | 997 | 1233 |
| agreed: held where it stood | 548 | 1202 |
| events / decisions | 50,160 / 135,333 | 16,215 / 17,703 |

By map (8 maps):

| map | grant-held | blocked | follow | order | reroute | backup | no-order | order-found (+backup) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| complex 1 | 16 | 11 | 32 | 1 | 0 | 0 | 21 | 2 |
| complex 2 | 21 | 25 | 35 | 0 | 0 | 0 | 37 | 0 |
| complex 3 | 30 | 10 | 42 | 1 | 0 | 0 | 19 | 5 |
| Dandelion | 150 | 54 | 20 | 1 | 0 | 3 | 25 | 2 |
| Rowan 1 | 139 | 26 | 7 | 0 | 2 | 3 | 34 | 5 (+5) |
| Rowan 2 | 127 | 30 | 1 | 0 | 3 | 0 | 41 | 6 |
| Rowan 3 | 156 | 49 | 8 | 0 | 0 | 0 | 6 | 0 |
| Wren | 102 | 25 | 2 | 0 | 0 | 0 | 0 | 18 |

How to read it:

- **grant-held** is the payoff side: trains today's rules hold that the search would let go now. On the maps, by what
  holds them today:

  | held by | count |
  | --- | --- |
  | line-wait-for | 487 |
  | red-signal | 96 |
  | line-wait | 63 |
  | stuck:in-way | 40 |
  | stuck:signals | 23 |
  | points-wait | 15 |
  | stuck:single-track | 9 |
  | aside | 5 |
  | stuck:loop-signal | 2 |
  | held-up | 1 |

  In the fuzz it's sections' section (462) and slot (132) waits, and the router's points (69). So most of today's
  holds the dispatcher would lift are the line and section waits.

  Not checked yet: whether each such grant is safe in replay. That's the spec's "nothing it would grant breaks an
  invariant in replay". It needs the grant acted on, which is step 2.
- **hold-granted:blocked** mostly comes from the model's whole-piece granularity: a train standing partly on a piece
  is on all of it. **follow** is the same with the train in the way moving off. Neither is a danger, but step 2 will
  need finer holds (part pieces, as §R's table) or it will hold trains today lets go.
- **hold-granted:order** is rare (3): when its move is free, the search almost always agrees with today's first-come.
- **reroute** (a loop's other road): 96 in the fuzz, 5 on the maps. Few loops on the maps hold these trains.
- **backup:** 6 on the maps (Dandelion and Rowan 1). One example: Dandelion at 1739 s, no order keeps 3 going, but
  with train 171 backing up, 2 do.
- **Jams today** (a train stuck 30 s; each stuck train judged, so a jam of three counts three):
  - the dispatcher finds no order for 183;
  - finds an order for 38, 18 of them on Wren's map;
  - finds one with a back-up for 5 (Rowan 1 at 1019 s: 1/5 without, 5/5 with).

## 4. Cost

**Plain Node** (`bench/dispatch.bench.ts`), 4 maps at once on 4 cores, with the probe running too. These are
conservative.

| | p50 | p98 | max |
| --- | --- | --- | --- |
| one decision, 8 maps (135,333) | 0.067 ms | **0.93 ms** | 24.5 ms |
| one decision, fuzz (17,703) | 0.076 ms | 0.29 ms | 9.7 ms |

p98 per map:

| map | p98 |
| --- | --- |
| complex 1 | 0.42 ms |
| complex 2 | 0.59 ms |
| complex 3 | 0.34 ms |
| Dandelion | 0.96 ms |
| Rowan 1 | 1.05 ms |
| Rowan 2 | 0.91 ms |
| Rowan 3 | 0.89 ms |
| Wren | 0.21 ms |

**At the cap:** 0.9–1.4 µs a state warm (the same search repeated, fastest of five; more on 8-train stretches). So:
- a capped decision costs about 0.5–0.7 ms at 500 states;
- 2,000 (the spec's number) would be 2–3 ms, over §5's 1 ms;
- **the cap is 500.**
- 1.7–3.3% of decisions hit it, on Dandelion and Rowan 1–3 only; complex 1–3 and Wren never do.
- With the cap at 1,000 the disagreement counts were identical, and p98 was 1.69 ms.

**The max** (8–25 ms) is on searches of fewer than 100 states, so it's pauses, not search. The likeliest cause is GC
from the judge's large tables (1M-state cap) and the sim in the same process.

**Rowan 1's p98 (1.05 ms)** is just over the budget in this contended run. The search itself is under it; the decision
also builds the stretch and moves the ways on.

**Builds:** each train's way is built when its route moves on or it leaves its way (a few `plan` calls), and is
otherwise moved along. Building is about 15–40 ms a map-run in total.

**bench:tick:** no game code changed (nothing outside tests, bench and scripts imports the new modules). A 60 s run of
main and the branch differed both ways by −26% to +30% per map, which is run-to-run noise on identical game code.

**Idle and paused:** no events, so no decisions. The shadow's look is a signature compare every 12 ticks; a real
dispatcher would be called on the events themselves (§5).

## 5. Open, before step 2

1. **Stuck re-routing (§2.2 step 4)**, any way that frees the other's need. This is the save 3 stand-off.
2. **Finer holds than whole pieces**, or the dispatcher holds trains today lets follow (blocked/follow, 377 on the maps).
3. **Replay safety of grant-held:** act on each grant in a replay and check the invariants.
4. **Signals as waiting points.** Today's model rests only clear of points. The spec makes a signal whose block fits the
   train a waiting point (the hold shows as its aspect). Wren's map's 42 usable waiting points from 134 signals means
   the two differ little there, but it isn't modelled.
5. **The goal horizon:** 1 stop for decisions, 2 for the judge. "Keeps delivering" for ever (the oracle's) is not
   checked. A train that reaches its stop after next and then can't go on counts as delivering.
