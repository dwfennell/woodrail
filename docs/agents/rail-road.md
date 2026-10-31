# Rail and road — playbook

## 1. Scope
The goal: track setup and train behaviour that feel delightful. This team owns:
- **Draw:** drag-to-draw (`src/track/draw-path.ts`, `src/game/draw-hand.ts`).
- **Switches:** levers, pins, and how clearly they read.
- **Sharing lines:** sections and slots (`src/economy/sections.ts`).
- **Engine-card commands:** Go/Stop, ⇄, Swap ends, Continue, Put away.
- **The sim** (`src/sim/sim.ts`), where it bears on any of the above.
- **Routing** (`src/routing/`): which way a routed train goes, and the points set for it (the routing spec).

### Landed recently
- **Single-line working across lines** (on `claude/no-turnbacks`, after step 5b; spec §13 step 5c). The fix "add a passing loop" now works for two lines' trains.
  - **Now:** lines whose ways run through a slot or section in common are one network (`Sections.network`, worked out again only when the track, pins, the lines' stops or their trains change). Their trains share one topology (for the network's longest train), and each asks for its moves among all of them (`LineInfo.users`): one train in each stretch of single track, and trains meet at a loop, each on its own road, whatever their lines. A single-train line sharing its network is managed now. The room rule stays each line's own (its trains, its own loops). A line alone on its network, or a lone train, runs exactly as before (trajectory hashes identical).
  - **Trains on no line** (lever on, no route) on a managed network work it too (`LineInfo.loose`), going the way the points lie: they ask for moves like a line's train but are sent only onto the road their facing points lie for; a line's train meeting one at a loop takes the other road (`restRoad`: the far points' default, `SectionsHost.restsAt` = `Router.defaultOf`). They still stop short of trains ahead (`clearCap`). Parked trains (lever off) stay occupants.
  - **Cards:** in-way between two lines' trains (or one on no line) with no passing loop on the line's ways (`Sections.passingLoops` = 0): "Stuck: the train on the Blue line is in the way. Add a passing loop here" (2 lines at 360 px, measured in `e2e:touch`); with a loop there, or a line's own trains nose to nose: "… Put one away" (`Stuck.in-way.loop`, `Stalls.loopFixes`). The once-ever tip: "Trains met head on. A passing loop lets trains pass" (no signals: they don't make it work and aren't needed); before Switches, "Learn Switches, so they can pass on a loop".
  - **What changed for tests:** the router's own points wait (§3.3) is now pre-empted for line trains sharing a network (sections hold the follower at its slot's end, short of the points). The harness keeps the router's cases on their own lines (`Scenario.ownLines`, harness-only: `Sections.shared = false`), and adds the shared versions (`followerOtherRoadShared`, `followerSameRoadShared`: a line end holds one train, so the follower for X waits for the siding). `crossing-merge.test.ts`: two lines into the dead-end Y go in turn; a hand-run train with a line there goes as the points lie, out of Y for X where the line's train waits: both stand, said stuck.
  - **Play-through (balance, not the goals player):** the people train joins the line once routes are learned, the player laying it a passing loop first and putting it down on it (`peopleLoop`, `onLoop`); picked up when stuck, it's put back on its loop. The goods train standing 2 min in 10 for it, another loop where it waits (up to 4). A two-lines card saying "Add a passing loop here", the player lays one there (`stuckAt`). The 4-minute jam rule leaves a kept people train be while nothing is stuck. The goals player keeps the old rule (puts it away; its planks go to the goals): `keepsPeople()`. A/B: `BALANCE_PEOPLE_HAND=1` (by hand, as before), `BALANCE_PEOPLE_OWN=1` (a line of its own through the towns).
  - **Cost:** a line alone costs about the same (harness §8.4 2.08 → 2.26 µs a cap call; three trains one loop 1.62 → 1.75): the network check is one pass over the trains a tick. Two lines sharing, now managed: 3–5 µs a call (harness). Play-through cap 1.0 → 2.6 µs a call (two trains running all game now). Nothing per frame; a lone train returns at once.
  - **Proof:** spec §13 step 5c (harness cases, fuzz, QA, balance and goals tables, e2e).
- **No turn-backs; stalls said on the cards (§16 Q3, the user: "I would rather they don't turn back, better to get stuck so the player sees what's happened")** (on `claude/no-turnbacks`; spec §13 step 5b).
  - **Now:** a train turns round only at the end of the track (a buffer, an open end; the automatic Swap ends at a dead end stays). One a train blocks stands and waits as long as the blocker stays. `TurnCause` is `buffer | open-end`; `Sim.turnBack` is gone.
  - **Removed:** sim `crossCap`'s 5 s turn-back (`CROSS_TURN_TICKS`, `crossWaits`); the head-on bump's turn-back (`meet`: now the two stop nose to nose, `followRoom` looks at the other's front too and stops them `FOLLOW_GAP` apart); the side hit's; the lift's give-way (one coming off and one running at it both stand); sections' `deadEndCap` and the granted dead-end move (a dead end short of a held train is now a wait in the slot, `deadEndWait`); `facing`'s give-way and `aloneIn`'s (both trains put down face to face wait on each other); `unring`'s turn-backs (`giveWay`, `YIELD_S`, `yielded`, `turnedShort`, `gaveWay`, `giveWayRefused`); the lineless train's 2 s turn-back in `clearCap` (`clearTurns`); the 30 s safety net (`MUTUAL_S`: it let one run on into the other; `released` stays at 0 for the reports); the once-a-minute room hand-over (`unring` itself, `SWAP_S`, `swapped`: with turn-backs gone it made an over-room line crawl, the stuck card flickering on and off every minute); the stood-still line (`stalledLine`, `BlockWait` "stalled": it counted turn-backs). `SectionsHost.routeWait` and `atStop` went with them.
  - **Stalls** (`src/economy/stalls.ts`, `Economy.stalls`, run in `Economy.tick` and the harness every `CHECK_TICKS`, with two trains or more; nothing per frame): each standing train with its lever on names who it waits for: sections' wait, the router's (`waitingOn`), the sim's (`Sim.heldBy`/`heldHow`: short of a crossing or switch, close behind, nose to nose, against its side, or at a lift another is on), or a lineless train's short of one ahead (`Sections.clearWait`). Chains are followed (each waits on at most one): a ring is **in-way** (nose to nose is the smallest), a chain ending at a train its line holds for room is **too-many**, one ending at a train standing lever off is **parked**. Said once it has held `STUCK_S` (5 s), so ordinary meets never are. `onStuck` fires once a stall; the game shows the old head-on loop tip once ever (`showLoopTip`).
  - **Cards** (2 lines at 360 px, measured with Nunito 700 14 px; names over 12 characters say "another train"): "Stuck: the train on the Red line is in the way. Put one away" (or "another train"; "… Add a passing loop here" for two lines with no loop, since single-line working across lines, above); "Stuck: too many trains for this line. Put one away or add a loop"; "Stuck: a parked train is in the way. Move it" (also for too-many when a train not on the line stands on a loop road). Too-many on a pinned loop keeps the line's "Waiting: unpin the passing loop's switches…". The points wait now reads "Waiting for the train on the Red line to pass the points", and the lever toast "Set for the train on the Red line. …" (an engine's colour may differ from its line's).
  - **Also:** `Sections.prune` drops waits on a train taken off the track (put away); `facing`/`deadEndWait` give a held train its room card, not a slot wait.
  - **Layouts changed, the way a player would:** sections QA's `scen` takes `fix`: once a train's been said stuck 10 s the player taps Put away (the held one for too-many; a train on no line, else the one last put down, for in-way): used by the offline, stopLine, lineless-shuttle runs. The play-through's player looks at the cards once a minute and, a train stuck, picks up the newest (as its 4-minute jam rule did): the people train (1 train a line) or line train 2 (since single-line working across lines, the balance player keeps the people train on its own passing loop instead, above). The starter-map play-through puts its second (hand-run) train away when the card says stuck. Harness: `threeTrainsPutAway` (the held one put away at 2 min). No turn-back was brought back anywhere.
  - **Proof:** see spec §13 step 5b (tables: balance seeds 2027, 1, 2 × 1/2 trains a line; goals long; QA; fuzz).
- **Routing, step 5: waits (#3 follow-up)** (on `claude/routing-5`; spec §13 has the design as built).
  - **Now:** a routed train refused its points (locked for another train's road, or for the same road from the other end, or points that must move with a car on them) holds nothing new and stands `STAND_SHORT` + `OVERLAP` (6 + 30 mm) short of them (`Router.speedCap`, in `Economy.capFor`), braking as usual. It never runs over points set against it. `RouteWait { kind: "points", pieceId, by }` names the holder (`Router.waitOf`). When the holder lets go, a waiter asks again at once, so the points move once, straight to its road. A lock is shared only by trains coming onto the points the same way (`Lock.entry`).
  - **Red switches:** points pinned on a road that leads nowhere toward the stop, where unpinned they would, stop the train short of them (`RouteWait { kind: "pinned" }`); before, it ran over them and shuttled.
  - **Wait chains:** `SectionsHost.routeWait` (`Router.waitingOn`). `unring` follows it like a line's own wait, through foreign trains too.
  - **Cards:** "Waiting for the Red line train to pass the points" (or "another train"); "A red switch is in the way. Tap and hold it to unpin".
  - **Lever taps (§16 Q1, changed by the user during step 5):** a tap on locked points doesn't move them and keeps the lock. The tap is their default at once (from the way they're shown; more taps on the same lock go on round), toasted "Set for the Red line train. They'll switch to your way after it passes" (`pointsSetFor`), and they go back to it once the train has passed. Unlocked points move at once. `Router.tappedFor` is gone.
  - **Turn-back breakers (§16 Q3):** none added, none removed. Counted in the harness (`Report.breakers`: cross, yielded, short, gaveWay, clear) and 0 on the §8 automations, the followers, the #3 case and the crossover ring. Where they still fire is under "Open items".
  - **Not yet:** Q5 (hand-run trains wait about 15 s while the train in the way moves) is step 7: hand-run trains take no locks, and their waits are `crossCap`/`clearCap`. Nor the red lever's pulse (§7).
  - **Proof:** trains-only hashes identical to main for the lone trains, the 8 default fuzz seeds, the play-through on seeds 2027, 1 and 2 (1 and 2 trains a line) and the goals play-through fast and long (19/22, 22/22): no ask is refused there, so no train waits. Sections QA 85/85: 3 of 256 sims drift (B5 park sweeps), two SHOW rows (B5 l0.side flips 39 → 38; B5 l0.main ring 2.0 → 1.9 s), meets and releases 0. Long fuzz (200 × 30 min): 9 seeds drift (lever taps now wait for the train, and waits), breaker counts identical, the same invariant breaks as main (below).
  - **Cost:** QA 8.7 µs a look (was 7.2; the pinned-points check is a cached plan lookup through each pinned points on the walk). No wait: `speedCap` is one size check. Idle 0 frames (`E2E_ONLY=restore`).
- **Routing, step 4: locks, setting and restore (#5)** (on `claude/routing-4`; spec §13 has the design as built).
  - **Now:** the plan (`planWay`, cached per layout) chooses at points for the router, sections' `wayOn`/`unreachable`/`wayPieces` and the drawn line. A routed train, within braking distance + `SET_LOOK` (400 mm) of its next points, asks for every lock up to the next clear point, all or none; shared by a train behind for the same road; let go behind the last car, then the points swing back to the player's default with the soft clunk (`onSwitch`). A line's train with no grant sets nothing (`Sections.awaitingGrant`, §5.2). Hand-run trains take no locks.
  - **Lever taps (§16 Q1):** refused only with a car on the points. Points set for a train move; its lock drops and the points count as pinned for it until it's by them (`Router.tappedFor`). (Replaced at step 5.)
  - **Deleted:** `steerSwitch`, `steer`, `chooseWay`, `Sim.trainAhead`, `Sections.switchHeld`, `shadow.ts`.
  - **Not yet (step 5, now done):** a train refused a lock (points held for another road) runs over them as they lie, as before: the crossover ring takes the wrong road (`wrongRoad` expected to fail, step 5). With `trainAhead` gone, a routed train may set points ahead of a hand-run or lineless one (step 7).
  - **Proof:** trains-only hashes (`--env TRAJ_SWITCHES=0`) identical to main for the lone-train harness cases, every fuzz seed, seeds 1 and 2 (1 and 2 trains a line) and 2027 with 2. Seed 2027 with 1 train a line (two lines over shared points) drifts from minute 129, all bands hold or improve (riders 207 → 242, coins 1104 → 1216, research stall 14.8 → 13.0 min). Goals 19/22 and 22/22, later goals sooner (every town 355 → 219, harbour 397 → 295 min).
  - **Sections QA drift** (85/85; meets 0, releases 0 everywhere; arrivals over the changed rows 210 → 225). Causes: (1) a held line train no longer sets points (before, it threw the next ones ahead while waiting); (2) points go back to the player's default after each train, so lineless, taken-off and parked trains, which take points as they lie, meet the default rather than the last route's way; (3) points locked for one train aren't thrown for another (all or none), and `trainAhead` no longer protects a lineless train ahead. Rows: RND 3 23 → 21 arrivals, still 0 → 2 s; RND 22 still 164 → 178 s (arrivals the same); B5 pinned l0.side 3 → 9 arrivals, still 115 → 2 s (its stand-still card row goes); B5 pinned l0.main flips 40 → 39; PARK offline 15 → 14; OFF k0 at40 15 → 14; OFF k1 53 → 58; OFF k2 37 → 38; PARK stopLine 14 → 12 (STOPLINE off e4 8 → 6; a new card, "Waiting: a parked train is in the way. Move it"); UNRING road 7 → 17; LINELESS k0/k2/k4 6/3/0 → 4/5/0 (same total), k3 8 → 9, line still 9 → 10 s.
  - **Cost:** a look 2.7 µs mean (harness, 157,557 looks); about 90 µs of router time per piece a routed train comes onto (its looks every 8 ticks while on it). QA (`ROUTING=1`): 919,853 looks over 321 worlds, 5.6 µs each; 13,033 locks, 7 asks refused, 6,016 points put back; plan choices 1,008 worked out, 123,597 cached. 0 idle frames (`E2E_ONLY=restore`).
- **Routing, steps 2 (defaults) and 3 (shadow plans)** (on `claude/routing-3`; spec §13). No behaviour change: trajectory hashes identical to main (sections QA with the shadow on, its SHOW rows byte-identical; goals play-through; harness and fuzz; seed 2027).
  - **Defaults:** `Router.defaultOf`, written by `router.lever` and by `laid()` (points laid take the way they lie; called from `Economy.prune` on every track edit). Never written by routing. Saved as `switchDefaults` only where they differ from the switch's state; old saves load with defaults as the points lie. e2e: `E2E_ONLY=defaults`. Its spot is found outward from wherever the full run leaves the view; it once landed points on flat ground beside a hill's square, their lever buried in the block (not seen, so rightly not tapped: a tap picked null). The spot must now be flat for 500 mm round, and the tap waits until the view is still and a pick there is the lever (turning the view a quarter if a hill's between).
  - **Plans:** `plan.ts` `plan` (Dijkstra over piece, entry, engine leading; `PIECE_COSTS` now, `MM_COSTS` for step 6) and `planChoice`. `shadow.ts` `ShadowPlans` sits on `Router.shadow` (null in the game), compares the plan's choice with today's once per approach to points, caches plans by track, pins and decks.
  - **Findings:** the plan agrees with today except (1) inside a sections grant (a loop's side road, one piece longer: 62 of 27,329 QA choices), and (2) `distanceTo` overcounts behind a switch with an open road: it marks states seen when pushed, so a turn-back hides a shorter way round a balloon (`balloonBehindOpenRoad`: today the siding and a reverse, the plan the balloon). Cost: 0.09 ms a choice mean, 99% cached.
- **Routing, step 2: the §12 harness** (on `claude/routing-2`; spec §13). Test code only. See "Routing harness" in §2. Today's gaps, as expected failures: no restore (step 4); a follower needing the other road takes the first train's road (step 5); pinned points in the way: the train shuttles (step 5); two single-train lines over a crossover pair turn each other back forever and deliver nothing (step 5).
- **Routing, step 1: one owner** (on `claude/routing-1`; spec §13).
  - **Moved, behaviour unchanged:** `src/routing/graph.ts` (`waysFrom`, `next`, `distanceTo`, `wayToward`, `SEARCH`, `TURN_COST`), `plan.ts` (`walkTo`, from `route-path.ts`: the way drawn on the map), `router.ts` (`steerSwitch`, `steer`, `chooseWay`, `AvoidTest`, `AheadTest`, and `Router`). `steer.ts` is gone; its tests are `src/routing/router.test.ts`.
  - **`Router`** is built by the economy (`economy.router`). `Router.tick` replaces `Economy.steerTrains` (8-tick cadence, `steerSoon`); it reads the goals from its host each steer, in the routes' order. `router.onSwitch` replaces `economy.onSwitch`. A lever tap on points goes `throwLever` → `router.lever` → `Sim.toggleSwitch`; signals, decks and lifts don't.
  - **Proof:** trajectory hashes identical to main on the whole sections QA, seeds 2027, 1 and 2 (1 and 2 trains a line), and the goals play-through (fast and `GOALS_LONG=1`); QA rows byte-identical; `e2e:touch` 76/76. Cost unchanged (an economy tick about 2.8 µs, steering about 10 µs a call).
  - **Still outside:** `Sim.trainAhead`, `Sections.switchHeld`, `steerHint`, `steerSoon` (read through `RouterHost`), until step 4.
- **Continue at a dead end** (`src/game/continue-on.ts`).
  - **Shows when:** the train is routed, its route has ≥ 2 different stops, and it's waiting to turn back at an open end. Hidden at buffers.
  - **A tap:** `Economy.skipVisit`, then `Sim.turnNow`. A pushing train's engine runs round. Sections admit the move. Not undoable.
- **Third-train trap.**
  - A line over room holds its newest train (`joinedAt`).
  - A toast, once per line.
  - **Put away** (`src/game/put-away.ts`): one undo step, refused if the spot has been taken.
  - **Saved:** per engine, `line.joined` and `line.held`; per line, `toldFull`. Loading restores them (`Sections.restorePlace`). **Car ids change on load,** so never key anything persistent by car id.
- **Shorter shadows:** sun elevation 55°, bearing (0.72, 0.48), in `src/render/stage.ts`.
- **Straddled-switch lift-turn:** `Sim.turnAround` calls `rememberStraddledSwitches`.
- **Crossings and joining switches (#2)** (`Sim.crossCap`, tests in `src/economy/crossing-merge.test.ts`).
  - **Cause:** sections only keep a line's own trains apart, and a line with one train isn't managed at all. Between lines (or lineless trains), the sim only reacted on `hitsSide`, when a train's front was already 12 mm from the other's centreline, so the trains ended up inside each other.
  - **Now:** a moving train looks ahead `v²/2a + CROSS_LOOK` for a piece whose path meets another path (`crossMasks`: a crossing's two lines, a switch's roads; not decks, lifts or double track). It stops `CROSS_GAP` short when another train is on that piece by a meeting path, or has claimed it (`crossClaims`, valid this tick and the next). Otherwise it claims the piece itself, so the first to come near goes first, whatever its line.
  - **Waits:** a wait where both trains stand for 5 s (`CROSS_TURN_TICKS`) turned the waiter back, as a bump used to. (Gone: no turn-backs, above. It waits, `Sim.heldBy`.)
  - **Cost:** it only runs when there's more than one train, and walks a piece or two.
- **Points never move under a train (#3)** (tests in `src/economy/switch-under-train.test.ts`).
  - **Causes:** two. (1) Route steering ran each routed train in turn, and the one behind re-threw the points the one ahead was about to take (the last writer won every 8 ticks), sending the first down the second's road. (2) A lever tap threw points whatever stood on them. The sim's switch memory keeps a train together through points entered from the trunk, but a wye entered from a branch, or a crossover from its connector 3, picks its road by the lever and isn't remembered, so the cars still to come took the other road and the train split.
  - **Now:** `steerSwitch` takes `ahead` (`Sim.trainAhead`): points another train is ahead on the way to, going the same way, are left for it. `Sim.toggleSwitch` refuses points with any car on or over them (`Sim.pointsHeld`, `piecesUnder` occupancy), and the lever tap toasts "These points move once the train is off them". Decks, lifts and signals are unchanged.
  - **Cost:** `trainAhead` is asked only when a switch is about to be thrown, and returns at once for a lone train.
  - **Sections QA drift:** only OFF k1 at20 (7/1/6 → 6/1/5) and OFF k2 at20 (4/5/1 → 5/6/1). A lineless train runs among the line's trains there, and the line's steering now leaves points to it when it's ahead on the way. Meets stay at 0.
- **Only one route (#4)** (on `claude/one-route`; e2e `E2E_ONLY=routes` in `e2e:touch`).
  - **Cause:** not the line storage. Picking a train up (a 380 ms rest then a move on touch, or any drag on the train whose card is open) took it off the sim, then called `changed()`, whose `trackChanged()` runs `economy.prune()`. The train in the hand wasn't on the track, so prune dropped its route, its line entry and (as its last train) the line. Put down again, it ran no line and its card showed "Plan a route". Cargo survived only because the hand carries it; coach riders were lost the same way.
  - **Fix:** `beginTrainPickup` calls `changed()` before `removeTrain` (`src/game/interaction.ts`). Dropped over the tray, `dropTrain` still prunes it.
  - **Rule:** nothing may prune the economy while a train is off the sim but coming back. A routed engine missing from the sim is skipped by the economy's loops, so keeping its entries meanwhile is safe.

## 2. How to test

**Machine:** 4 cores, and SwiftShader is heavy.
- Run one browser job and one heavy vitest job at a time.
- Check `ps aux | grep -E "e2e|vite|chrom"` first. Never pkill by a broad pattern.
- Push WIP early, marked "don't land".

**Unit and type checks:**
- `npm test`, `npm run typecheck`, `npm run build`.
- **Timing guards:** use a warm-up, best of N, and a mean or median bound, so a 10× slowdown fails but load doesn't.

**Browser e2e:**
- `npm run e2e:touch`: 104 checks, about 33 min. `npm run e2e:click`: 27 checks, about 8 min. `E2E_ONLY=dead-end` takes about 2 min; `E2E_ONLY=trap` about 4 min; `E2E_ONLY=routes` about 3 min; `E2E_ONLY=defaults` about 2 min (`routes,defaults`: the two in the full run's order, after a reload; `E2E_ONLY` takes any of Sandbox's check names, comma-separated, run in the full run's order: `map-taps`, `select-drag`, `redrawn`, `flick`, `lever-pins`, `under-car`, `toast-through`, `trap`, `dead-end`, `routes`, `defaults`, `restore`, `wait`, `stuck`, `stuck-lines`); `E2E_ONLY=restore` (a route throws points and they swing back) about 2 min; `E2E_ONLY=wait` (#3: two routes by taps, the second stands short of the points, its card, two lever taps on locked points, both deliver) about 8 min; `E2E_ONLY=stuck` (two trains head on along one line, no loop: both stand, the card says stuck and the fix in two lines at 360 px, the missing loop straight dragged from the tray, both deliver) about 3 min; `E2E_ONLY=stuck-lines` (the same, two lines' trains: neither held, both stuck in each other's way, the card says "… Add a passing loop here", the loop laid from the tray, they pass and both deliver) about 3 min (`stuck,stuck-lines` together: the second finds the Straight shelf open). In `wait`, the game is paused while the card is read (its real frames would run the sim on), and a sawmill sawing in view draws frames: the idle check counts those, and routing's own part (no points set or put back). Open item: `routes: a train picked up and moved…` failed once in four full runs (79/80, `lifted: "idle"`, the hold didn't pick the train up); its message now says what the finger came down on (`pressed`), for next time.
- `node scripts/e2e/draw.mjs` with `E2E_ONLY=` one of `junctions` (27), `qa-slant` (49, slow), `specials` (10), `phone`, `terrace-repeat`, `terrace-qa`, `ghosts`, `lift` or `loop`. The full run takes 2 h or more.
- `npm run e2e:joints`.
- **Screenshots and idle:** a small Playwright script. Load playwright-core with `createRequire("<repo>/package.json")`, wait for `settled()`, then check `framesDrawn` stays at 0 over 5 s.

**Sections and lines** (`src/economy/sections.test.ts`, `sections-qa.test.ts`; about 320 QA rows):
- Run with `SHOW=1` for arrivals, all-still time, the longest wait ring, meets, releases, turn-backs, card changes and overlaps.
- Diff the rows on main against the branch, and explain every difference.
- **To isolate a sim change:** keep the branch's test file and swap in `sim.ts` from main. Restore it afterwards.
- **Flags:** `TRACE=1`, `PREFILL=1`, `SAW_FULL=1`, `CARDS`; `idleOf.add(q)` marks a world idle.
- Count goods, not arrivals.

**Trajectory hashes** (`scripts/trajectory/trajectory.mjs`): for a change that must not change behaviour.
- `node scripts/trajectory/trajectory.mjs [--env K=V]... -- <vitest args>` runs the tests on `origin/main` (a worktree in `.trajectory/`) and on this tree, records a hash of every Sim's trains and switches each simulated second, and prints the first second that differs. The base's recording is reused.
- e.g. `--env BALANCE=1 --env BALANCE_SEED=1 -- --silent=false src/play/balance.test.ts`, or `--env SHOW=1 -- --silent=false src/economy/sections-qa.test.ts`. Each run's output is kept (`.trajectory/…/vitest.log`), so SHOW rows can be diffed from it.
- `--rename new=old` for a test file that moved. It samples once a second, so a change that comes back together within a second can slip by: a negative control (`LOOK_AHEAD` 2) shows at 24 s.
- **Vitest 5 hides a passing test's console:** SHOW rows and play-through logs need `--silent=false`.

**Routing harness** (`src/routing/harness.ts`, spec §12): scripted layouts on a `Sim`, `Sections` and `Router`, no `Economy`; the routing invariants checked every tick.
- `npx vitest run src/routing/harness.test.ts` (about 13 s; `SHOW=1 … --silent=false` prints each case's report: stops, turn-backs by cause, the longest stand-still, router µs a tick, each broken invariant's first few times).
- **Router cost:** the harness's `SHOW=1` report gives each case's locks, refusals, points put back, looks and µs. Sections QA: `ROUTING=1 … --silent=false src/economy/sections-qa.test.ts` prints the same over every world. (The step-3 shadow is gone: the plan decides.) `plan.test.ts` still compares the plan with `distanceTo` on 56 layouts.
- `src/routing/harness-fuzz.test.ts`: 8 seeds × 5 min. Long: `ROUTING_FUZZ=200 ROUTING_FUZZ_SECONDS=1800 npx vitest run --silent=false src/routing/harness-fuzz.test.ts` prints a line per seed that broke anything.
- Cases are in `scenarios.ts`. Each invariant and payoff is its own test; one today's router fails is `it.fails` with the step expected to fix it (in `fails`). **When a step fixes one, flip it to passing** (an `it.fails` that passes fails the run). None are left since step 5. `SHOW=1` also prints waits, time stood waiting, and stalls (`Report.stalls`: begun, time stuck and why per train; a stuck train is exempt from the 60 s deadlock check, being said on its card); the long fuzz prints a line per seed where a stall began. Stuck kinds each have a case: `threeTrainsOneLoop` (too-many), `headOnTwoLines` (in-way, nose to nose), `facingInLineEnd` (in-way, a ring of sections' waits), `twoLinesNoLoop` (in-way, two lines, the card's fix a loop), and the fix `threeTrainsPutAway`. Single-line working across lines (`SHARED` in harness.test.ts, 30 min each, no wait over 20 s): `twoLinesOneLoop`, `threeLinesTwoLoops`, `twoLinesThreeTrains`, `linelessWithLine`. Router cases that test its own points wait run each line on its own (`ownLines`, harness-only).
- The lone-train trajectory hashes (`LONE_UNROUTED`, `LONE_ROUTED`) must hold through step 5; record them again only with a reason. They hash trains only (not switches): restores change switches, not where a train runs. For the same with `trajectory.mjs`, pass `--env TRAJ_SWITCHES=0`.
- The harness's stand-ins for the economy are named in its header: trains run through stops (no dwell) and turn only where the track ends.

**Play-through:** `BALANCE=1 BALANCE_SEED=<n> npx vitest run --silent=false src/play/balance.test.ts`. See game-mode.md for the flags.
- **Pinned repro:** `BALANCE_SEED=2027 BALANCE_SECOND_GOODS=15 BALANCE_LOOP_PIN=1`, also seeds 3, 1 and 5.
- **Usual subset:** 2027 with 1, 2 and 3 trains; seeds 1 and 2 with 2 trains.
- **Lone-train check:** a line with one train must be identical to main.
- **Runs drift:** compare windows, not just totals.

**The player's path:**
- e2e tests assert the payoff (goods delivered, the stop reached) and tap the real control.
- Name setup shortcuts in comments.
- Never stub the thing under test.

## 3. Design rules

### Sections and slots
- **Slots** are loop roads and line ends; **sections** are everything else. A train enters a section only if it's free and there's a free slot at the far end.
- **Room:** loops + 1 trains per line. The newest is held. Only the line's own loops count. A loop with a spare or a held train on a road loses that road.
- **Lines sharing track** are one network (`network`: ways through a slot or section in common): one topology, every train of the network's lines (and running trains on no line there) a user of each line's sections and slots. Room stays per line. A line alone on its network is untouched. Anything new that admits a train must look at `info.users`, not `info.engines`, and ask `hasRoom` for another line's train.
- **Pinned loops** (`findLoops`, `Loop.into`): trains entering at each end must be able to use different roads under the pins.
  - Trailing through a pinned switch from the branch side is allowed.
  - With one end pinned, the free end's trains keep to the other road.
  - Same-road pins: not a loop, and the card says unpin.
  - The pins are in the topology key.
- **Admission is stable:** never demote mid-move. Held means held, moving or not. Never admit a train standing in another's way. Admission survives a reload.
- **A wait that can't end is shown, never broken (§16 Q3):**
  - every wait names a real blocker (sections, the router, the sim's `heldBy`, `clearWait`);
  - nothing turns a train back short of the end of the track, nor hands its room round: it stands as long as its blocker does;
  - stalls.ts follows the chains every CHECK_TICKS: a ring, a line's held train, or a parked train at the end is a stall, said on the cards after `STUCK_S` with the fix;
  - ordinary meets are left alone (they end before `STUCK_S`).
- **Other trains:**
  - spares and lineless trains are occupants;
  - a running lineless train is a moving occupant: line trains stop short of it, and it of them (`clearCap`), and waits.
- **Naming:** name trains by their engine (`nameOf`), never `cars[0]`.
- **Removing a train** prunes it from its line at once (`economy.prune()`).
- **Occupancy:** from the last axle to the first (`Sim.piecesUnder`).
- **Cost:** a lone train costs the same as main; about 0.05 ms a tick with 5 trains.

### The sim around switches
Any operation that turns, flips or splits a train must call `rememberStraddledSwitches`. Today that's runAround, decouple, flipTrain and turnAround.

Nothing may change points under a train. The switch memory only covers points entered from the trunk; a wye's branch or a crossover's connector 3 choose by the lever, so a change there splits the train. Only the router sets points for trains (locks, restore), and it checks `Sim.pointsHeld` before every throw; anything else that sets switch state must too, and must not move locked points (`Router.locked`); since step 5 not even the player's lever does (§16 Q1: the tap waits till the train has passed).

A routed train never runs over points set against it: refused, it stands short of them (`Router.speedCap`). Anything new that stops a routed train at points must name who it waits for (`RouteWait`), so sections' chains see it.

### Cards
- Cards fit 2 lines at 360 px; toasts 3 lines at most (about 33 characters a line).
- Buttons are 44 px or more.
- An admitted train never shows "Waiting: lay N more" for itself.

### Draw
- **One piece per pointer move.** The ghost preview is worked out in 1.5 ms slices per frame.
- **Laid equals the ghosts shown.** A pending lift is flushed on undo, redo, a press, save, setWorld and page hide.
- **Joints:**
  - never mirror a held piece to make it fit;
  - closes bend within 9 mm / 4°;
  - stations never move;
  - a bend into a house is refused.
- **Close rates** stay ≥ 97 / 95 / 97% (`draw-station-close.test.ts`).

### Switches
- Burned arrows; pinned is red.
- A double tap zooms. Pinning is within 7 px of the lever, on a 450 ms hold. Hidden levers take no tap.
- One instanced draw; 0 idle frames.

## 4. Open items
- **GitHub issues, from the user's play-test:**
  - #2: trains merge at crossings (fixed on `claude/crossing-merge`, waiting to land);
  - #3: derailment when a switch is thrown for the train behind (fixed on `claude/switch-derail`, waiting to land);
  - #4: only one route (fixed on `claude/one-route`, waiting to land);
  - #5: routes set switches and restore them (step 4 on `claude/routing-4`, waiting to land);
  - #6: a gap behind the train ahead;
  - #7: trains reverse too often;
  - #8: curves flip when auto-placing (shared with Sandbox);
  - #15: wyes;
  - #16: signals.
- **Routing system** (#3 follow-up, #4, #5, #7): designed in `docs/superpowers/specs/2026-10-30-train-routing.md` (§16 has the user's decisions). Steps 0–5 are on main; no turn-backs (step 5b, §16 Q3) is on `claude/no-turnbacks`. Next: step 6 (forward costs; §16 Q4 now answered: avoid running engine-last unless the player set it up, keep the end-of-line flip). Follow the spec's migration steps.
- **Turn-back breakers:** all gone (`claude/no-turnbacks`). Where they fired on main (long fuzz: cross 29 seeds 7,440 turns, short 39 seeds 4,131, yielded 17 seeds 203, gaveWay 4 seeds 4) the trains now stand, said stuck. With single-line working across lines: 57 seeds with a stall (was 74 at step 5b), 73 stalls (96), in-way 38 trains (80), too-many 53 (53), 26 seeds deliver nothing (36), all said; no seed stalls that didn't.
- **Answered (via the CoS):** lifts both standing is OK; the room hand-over's removal is OK; a line's own trains nose to nose keep "Put one away" (no ⇄ offer).
- **Questions for the user:** (1) The play-through's people train now runs all game on the line with its passing loop: riders ×1.6–2.3 and coins up, but the goods train waits for it (about 75 train-minutes of section waits in 180 on seeds 1 and 2), research by 180 falls 17 → 13 and 16 → 12 there (above the floors) and City ★ isn't reached by 180 there. Is that the trade a player should make, or should Game Mode make passing loops cheaper (or the player put the people train away when the goods train waits)? (2) Goals text still says "with signals" ("Put a second engine on the track, then lay a passing loop with signals", the two-trains goal's hint): signals aren't needed for trains to pass now; Game Mode's to change. (3) A hand-run train goes the way the points lie, so with a line on a branched dead-end layout (crossing-merge's Y) the two can still stand stuck: card "Put one away". Fine?
- **Long fuzz:** on main, seeds 74, 127, 135 and 183 had a sections wait naming a train that isn't there from 0 s; 19, 90 and 136 a train still 60 s; 125 one 30 s net. On `claude/no-turnbacks` none breaks an invariant (stalls are said, the net is gone). Seeds 9, 41, 106 and 140 deliver nothing with no stall, as on main (a lone train never reaching its stop); main had 17 such. (The fuzz's "trains deliver" test fails on those four, on 77ffa16 and on this branch alike.)
- **Loop proposal,** waiting on the user: "Show me where" plus a ghost loop, a one-tap Build loop, and a toast.
- **Parked:** routes-blocks and routes-loops, and sections P3 (sidings as slots).
- **Stand-still card on admitted trains** after a trap stall: revisit with the loop proposal.
- **Don't land:** `claude/switch-style-proto`, `claude/handover-off-stop`.

## 5. Gotchas
- Touch moves need CDP timestamps. Use the evaluate-click `tapSel`, not `page.tap`. A fresh Game may show the title screen, so click its primary button.
- **The click shield:** wait for a control's rect to hold still before tapping.
- **Shared recorders:** give toast recorders unique names, or other checks' toasts get double-counted.
- **Reloads:** car ids change. Find trains by world position (the nearest within 400 mm).
- **Lifting a train by touch:** a still hold only arms it; it lifts on the first move past the slop (10 px). Move a fixed distance (not a fraction of a distance that may be tiny), stamp every CDP event after the last, the touchEnd too, or Playwright's next tap gets no click. A drag can pan the view at the edge: re-frame before tapping something else.
- SwiftShader frames are slow, and the sim is capped at 0.1 s a frame. Tick ahead in `evaluate`, and say so in a comment.
- A `pgrep -f` wait loop matches itself; use background-job completion instead.
- **Room on the Sandbox map (e2e:touch):** seed 7's land is about 4.2 × 3.2 m, most of it hills, a town and its own track; the view's bounds go about 0.9 m past its edge. Each Sandbox check runs in `step()`: one that throws fails only itself (`<name>: ran to the end`), and its pieces (by type and position, not id) and the trains on them are taken up after it. Without that, 13 checks' runs filled the map and `wait` found "no open ground", which used to end the whole run. Spots come from `window.__openGround(footprint)`: points every 108 mm, each where `checkPlacement` would take a straight either way round, or past the land's edge on the flat table (a named harness shortcut: the trap, restore and wait runs, 2 to 2.6 m, don't fit on the open land), inside the bounds, clear of pieces and models. A reload gives out car, piece and depot ids afresh: find things by where they stand.
- **Toast lines:** count them by a one-line toast's laid-out height, not font size × 1.25 (Nunito's "normal" line is about 1.36) or the tilted on-screen box. The trap toast is 3 lines, but it measured 4 whenever the web font had loaded.
- **Known flakes:** touch's "how to pin was said once", touch's "no frames once settled", and the spacing and restore-survey timeouts.
- **QA's all-still can miss a stall:** trains edging along under `clearCap` read as moving. Check positions (or arrivals) over time when a row's arrivals drop. For example, OFF k2 at20 stood 180 s while reporting "still 3", until `clearCap` kept a lineless train's wait while it edged within 2 × `CLEAR_STEP`.
- **Joint gaps read as splits:** a split detector that compares axle spacing against the car's wheelbase fires at loose joints too (QA B1's loop closes about 5 mm open between pieces 6 and 10, even with a lone train). Check the axles' pieces and paths, not only the distance.
- Any sim change shifts RND and OFF arrivals in the sections QA rows. Explain the drift, and watch meets, all-still over 60 s and rings.
