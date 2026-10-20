# Crossing (routes Phase 3c, block working): status

## Status: parked, 2026-10-18

**2026-10-20: looked at again, and it needs a rethink.** See `2026-10-20-crossing-rethink.md` for the root causes on
current main, and a proposed model: sections and slots, owned by the sim.

Branch `routes-blocks` (head at parking: see `git log`), built on `routes-loops` (3b) and kept up to date with main.
Nothing of it is on main. Design and rules as built: the routes spec, §3.5 "Phase 3c"
(`2026-10-17-routes-design.md`), and the header of `src/economy/crossing.ts`.

### What works in 3c

- **QA's scenarios** (`src/economy/loops.test.ts`, "QA verify" and the delayed-start, short-loop and 3-train tests;
  `src/economy/blocks.test.ts`): bare and station loops with the second train 0–40 s late, a loop too short for 4-car
  trains, and 3 trains on plain, bare and station lines all run with 0 head-on meetings (bar fixture start-up
  placements) and rising arrivals. 3b fails the short loop (74 meetings, arrivals stuck at 1/1) and every 3-train
  case; it handles late starts up to 25 s but not 40 s on a bare loop.
- **Stubs:** the stretch from a line end back to its first switch (`stubsOf`, per layout revision) is one two-way
  claim: a train enters it from outside only when no line-mate holds or stands on any of it.
- **The return slot:** a train in a stub, its way out running into the loop before it, counts as coming to that
  loop, so a line-mate from the other end waits back at the previous passing place; the one already waiting in the
  loop for it leaves it the free road.
- **Settle-only grants:** between stops, a train with no claim (or a stale one) is held (speed cap 0) and asks;
  every grant happens in `settle`, in ready order, against current claims. A nested check only ever views another
  train's way. A turn in place is approved in `settle` too, and never at a line end.

### Why it's parked

- **Idle creep (main, 7bb7f4e) removed the escape 3c leaned on.** Two trains of a line nose to tail in one block (at a
  terminus, or in a stub) used to get out because the follower crept into the leader: the sim counted a meeting and
  turned it round. Now the follower holds back at the gap. Both stand still for good; the 30 s safety net lets one
  "go", it can't move, and the release repeats (385–722 releases in a run).
- **In the play-through (`src/play/balance.test.ts`, seeds 2027, 1, 2; 1–3 trains a line, with and without a loop) 3c
  is worse than no crossing** in most runs with more than one train: on coins at 180 min in 10 of the 12, on the City
  minute in 8. Five lock up for good (stall over 120 min); long lines with no passing place for their trains take
  turns end to end. Head-on meetings: 0–3 per run for 3c, against 2–30 with no crossing.
- **3b** is about even with no crossing on coins and City, with fewer head-ons, but leaves B-L2 (the short loop jams
  for good) and the 3-train jams.

### Open ideas, for whoever resumes

- **The rear train backs out of a block:** when two trains of a line stand nose to tail in one block, the one nearer
  the way out turns round and leaves it (a claimed way back, granted in `settle`) before anyone else is let in. This
  replaces the creep-and-bounce escape that idle creep removed. Start here.
- **3d: steer-follow, so claims and switches agree.** `steer(…, avoid, follow)` landed on main: crossing should pass
  `follow` = "the held claim has (piece, path)", and `steerTrains` should aim at the claim's far end. At present,
  steering aims at the current stop; a train running through a stop inside its block reaches the next switch before
  steering aims past it, and takes a way it doesn't hold (seed 2027, two trains a line, 69 min: into a stub at piece
  134909).
- **Claim direction from the route** (Rail and road's hint on the overrun at switch 30313, seed 2027): a claim takes
  its direction from where the train faces (`drive`, bogie order) while it stands, but it leaves in its route's
  direction (as `steerTrains`' `net > 0`). Use one source for both, and claim from that end, front included, so the
  switch under its front is in the claim.
- **`steer(…, occupied)`** (`src/economy/steer.ts`; the economy passes "any train has a bogie on that piece"): a switch
  is never thrown under a train, which had split a train across both roads of a loop. This is in Rail and road's code
  and still needs their review.

### Tools

- **The three-way table** (3c, 3b, no crossing): the play-through, `BALANCE=1 BALANCE_SEED=<seed>
  BALANCE_TRAINS_PER_LINE=<n> [BALANCE_NOLOOP=1] BALANCE_CROSSING=3c|3b|off npx vitest run src/play/balance.test.ts
  --silent=false`, for seeds 2027, 1, 2, n = 1, 2, 3, with and without the loop. Its `SUMMARY` line gives coins180,
  stall, city (`level 3`), crossWait, headOn, and releases by reason. `BALANCE_CROSSING=off` is the existing
  `BALANCE_NOCROSS`; `3b` sets `crossing.blocks = false`. The scratch runner used (`rb-bal3.sh`, three at a time):

  ```sh
  # rb-bal3.sh <tree> <outdir>, env MODE=3c|3b|off, PAR=3
  run() {
    IFS=: read seed n mode <<< "$1"; extra=""; [ "$mode" = noloop ] && extra="BALANCE_NOLOOP=1"
    env BALANCE=1 BALANCE_CROSSING=$MODE BALANCE_SEED=$seed BALANCE_TRAINS_PER_LINE=$n $extra \
      npx vitest run src/play/balance.test.ts --silent=false > "$OUT/s$seed-n$n-$mode.log" 2>&1
    echo "seed $seed n $n $mode: $(grep -h '^SUMMARY' "$OUT/s$seed-n$n-$mode.log")" >> "$OUT/summary.txt"
  }
  export -f run; export OUT MODE
  printf '%s\n' 2027:1:loop 2027:2:loop 2027:3:loop 1:1:loop 1:2:loop 1:3:loop 2:1:loop 2:2:loop 2:3:loop \
    2027:2:noloop 2027:3:noloop 1:2:noloop 1:3:noloop 2:2:noloop 2:3:noloop | xargs -P ${PAR:-3} -I{} bash -c 'run {}'
  ```

  Each run takes about 10 minutes; a full three-way table about 2 hours at PAR=3. For traces, log each line
  train's pieces, speed, claim (`crossing.reservations`) and card every game second over a window of minutes, and each
  new entry of `crossing.releases` and each head-on (`lastTurn.cause === "train"`) as it happens.
- **The QA harness:** the permanent tests in `loops.test.ts` and `blocks.test.ts`, and for numbers, a scratch test
  appended to `loops.test.ts` that runs `jamWorld(kind, n)` (and the short loop) for 10 minutes and reports meetings,
  arrivals at 5 and 10 minutes, the longest hold, ticks standing in a loop with no status, releases and crossing
  µs/tick (each `Crossing` method timed, outermost call only). Set `economy.crossing.blocks = false` for 3b.
- **Scratch debug pattern:** `src/economy/loop-fixtures.ts`' `runner` plus a per-second print of each train's
  bogie pieces, speed, route `next`/`at`, claim and `engineStatus` card; worlds as in `jamWorld` (KIND
  plain/loopstop/bare, N 2/3).
