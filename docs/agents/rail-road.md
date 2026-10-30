# Rail and road — playbook

## 1. Scope
The goal: track setup and train behaviour that feel delightful. This team owns:
- **Draw:** drag-to-draw (`src/track/draw-path.ts`, `src/game/draw-hand.ts`).
- **Switches:** levers, pins, and how clearly they read.
- **Sharing lines:** sections and slots (`src/economy/sections.ts`).
- **Engine-card commands:** Go/Stop, ⇄, Swap ends, Continue, Put away.
- **The sim** (`src/sim/sim.ts`), where it bears on any of the above.

### Landed recently
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
  - **Waits:** a wait where both trains stand for 5 s (`CROSS_TURN_TICKS`) turns the waiter back, as a bump used to.
  - **Cost:** it only runs when there's more than one train, and walks a piece or two.
- **Points never move under a train (#3)** (tests in `src/economy/switch-under-train.test.ts`).
  - **Causes:** two. (1) Route steering ran each routed train in turn, and the one behind re-threw the points the one ahead was about to take (the last writer won every 8 ticks), sending the first down the second's road. (2) A lever tap threw points whatever stood on them. The sim's switch memory keeps a train together through points entered from the trunk, but a wye entered from a branch, or a crossover from its connector 3, picks its road by the lever and isn't remembered, so the cars still to come took the other road and the train split.
  - **Now:** `steerSwitch` takes `ahead` (`Sim.trainAhead`): points another train is ahead on the way to, going the same way, are left for it. `Sim.toggleSwitch` refuses points with any car on or over them (`Sim.pointsHeld`, `piecesUnder` occupancy), and the lever tap toasts "These points move once the train is off them". Decks, lifts and signals are unchanged.
  - **Cost:** `trainAhead` is asked only when a switch is about to be thrown, and returns at once for a lone train.

## 2. How to test

**Machine:** 4 cores, and SwiftShader is heavy.
- Run one browser job and one heavy vitest job at a time.
- Check `ps aux | grep -E "e2e|vite|chrom"` first. Never pkill by a broad pattern.
- Push WIP early, marked "don't land".

**Unit and type checks:**
- `npm test`, `npm run typecheck`, `npm run build`.
- **Timing guards:** use a warm-up, best of N, and a mean or median bound, so a 10× slowdown fails but load doesn't.

**Browser e2e:**
- `npm run e2e:touch`: 71 checks, about 25 min. `E2E_ONLY=dead-end` takes about 2 min; `E2E_ONLY=trap` about 4 min.
- `node scripts/e2e/draw.mjs` with `E2E_ONLY=` one of `junctions` (27), `qa-slant` (49, slow), `specials` (10), `phone`, `terrace-repeat`, `terrace-qa`, `ghosts`, `lift` or `loop`. The full run takes 2 h or more.
- `npm run e2e:joints`.
- **Screenshots and idle:** a small Playwright script. Load playwright-core with `createRequire("<repo>/package.json")`, wait for `settled()`, then check `framesDrawn` stays at 0 over 5 s.

**Sections and lines** (`src/economy/sections.test.ts`, `sections-qa.test.ts`; about 320 QA rows):
- Run with `SHOW=1` for arrivals, all-still time, the longest wait ring, meets, releases, turn-backs, card changes and overlaps.
- Diff the rows on main against the branch, and explain every difference.
- **To isolate a sim change:** keep the branch's test file and swap in `sim.ts` from main. Restore it afterwards.
- **Flags:** `TRACE=1`, `PREFILL=1`, `SAW_FULL=1`, `CARDS`; `idleOf.add(q)` marks a world idle.
- Count goods, not arrivals.

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
- **Pinned loops** (`findLoops`, `Loop.into`): trains entering at each end must be able to use different roads under the pins.
  - Trailing through a pinned switch from the branch side is allowed.
  - With one end pinned, the free end's trains keep to the other road.
  - Same-road pins: not a loop, and the card says unpin.
  - The pins are in the topology key.
- **Admission is stable:** never demote mid-move. Held means held, moving or not. Never admit a train standing in another's way. Admission survives a reload.
- **No wait may last:**
  - every wait names a real blocker;
  - wait chains are followed every CHECK_TICKS;
  - an unnamed or unmovable blocker, or a ring, turns back the nearest train with a free slot behind it (the newest, in a ring) after YIELD_S (3 s);
  - ordinary meets are left alone;
  - the 30 s safety net should fire 0 times.
- **Hand-over:** when the chain ends at the line's own held train, that train takes the room, at most once a minute per line. It's skipped when the held train is the newest, the line is over room, and the train it would hold blocks a stop (`blocksStop`).
- **Other trains:**
  - spares and lineless trains are occupants;
  - a running lineless train is a moving occupant: line trains stop short of it, and it turns back after 2 s;
  - a lineless train stopped short of another counts as stuck.
- **Stand-still:**
  - a line that can deliver nothing stands still with one steady card;
  - the stall key holds only its own network's standing trains, plus lever changes;
  - wake-ups are a train joining or leaving, admission changing, a foreign train stopping on or leaving its roads, a track edit, or Stop then Go.
- **Naming:** name trains by their engine (`nameOf`), never `cars[0]`.
- **Removing a train** prunes it from its line at once (`economy.prune()`).
- **Occupancy:** from the last axle to the first (`Sim.piecesUnder`).
- **Cost:** a lone train costs the same as main; about 0.05 ms a tick with 5 trains.

### The sim around switches
Any operation that turns, flips or splits a train must call `rememberStraddledSwitches`. Today that's runAround, decouple, flipTrain and turnAround.

Nothing may change points under a train. The switch memory only covers points entered from the trunk; a wye's branch or a crossover's connector 3 choose by the lever, so a change there splits the train. Anything new that sets switch state (routes setting and restoring switches, #5) must check `Sim.pointsHeld` and steer's `ahead`.

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
  - #4: only one route;
  - #5: routes set switches and restore them;
  - #6: a gap behind the train ahead;
  - #7: trains reverse too often;
  - #8: curves flip when auto-placing (shared with Sandbox);
  - #15: wyes;
  - #16: signals.
- **Loop proposal,** waiting on the user: "Show me where" plus a ghost loop, a one-tap Build loop, and a toast.
- **Parked:** routes-blocks and routes-loops, and sections P3 (sidings as slots).
- **Stand-still card on admitted trains** after a trap stall: revisit with the loop proposal.
- **Don't land:** `claude/switch-style-proto`, `claude/handover-off-stop`.

## 5. Gotchas
- Touch moves need CDP timestamps. Use the evaluate-click `tapSel`, not `page.tap`. A fresh Game may show the title screen, so click its primary button.
- **The click shield:** wait for a control's rect to hold still before tapping.
- **Shared recorders:** give toast recorders unique names, or other checks' toasts get double-counted.
- **Reloads:** car ids change. Find trains by world position (the nearest within 400 mm).
- SwiftShader frames are slow, and the sim is capped at 0.1 s a frame. Tick ahead in `evaluate`, and say so in a comment.
- A `pgrep -f` wait loop matches itself; use background-job completion instead.
- **Known flakes:** touch's "how to pin was said once", touch's "no frames once settled", and the spacing and restore-survey timeouts.
- **QA's all-still can miss a stall:** trains edging along under `clearCap` read as moving. Check positions (or arrivals) over time when a row's arrivals drop. For example, OFF k2 at20 stood 180 s while reporting "still 3", until `clearCap` kept a lineless train's wait while it edged within 2 × `CLEAR_STEP`.
- Any sim change shifts RND and OFF arrivals in the sections QA rows. Explain the drift, and watch meets, all-still over 60 s and rings.
