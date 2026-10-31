# Architecture review: why the edge cases keep coming (2026-10-31)

**The user:** "seems like we are running into a lot of edge cases and bugs these days, I wonder if our underlying
architecture could be improved."

**Scope:** a read-only review of the game logic that decides how trains move: the sim, sections and slots, the router,
stalls, the economy, interaction, `main.ts` wiring and saves. It ends with a proposal: 6 changes, ranked by bugs saved
per unit of effort, and an order to do them in. This doc changes no code.

**Short answer:** yes. Most recent bugs come from one shape: **many modules each decide part of "may this train move,
and which way", in an order nobody wrote down, and they share state keyed by ids that don't last.** Each new rule adds
one more partial decider, and the fixes add more cross-checks (`waitsAt`, `managedTick`, claims "valid this tick and
the next"). That's why every fix lands with a page of drift tables. The fix isn't a rewrite. It's one owner per train
for its *intent*, an explicit tick order, stable ids, and running the invariants we already have everywhere.

## 1. How the game logic is organised today

### 1.1 Sizes (lines, 2026-10-31, main 952094e)

| Module | Lines | Owns |
|---|---|---|
| `src/game/interaction.ts` | 5,329 | Every pointer gesture, the cards, lever taps, pick-up and drop, undo, Put away |
| `src/main.ts` | 4,091 | Wiring: HUD, toasts, cards, audio, map view, goals, research, the per-frame hook |
| `src/economy/sections.ts` | 2,033 | Sections and slots, room, admission, networks, `clearCap` for lineless trains |
| `src/sim/sim.ts` | 1,948 | Physics, cursors, switch memory, lifts, decks, signals, `followRoom`, `crossCap`, turn at the end of the line |
| `src/economy/economy.ts` | 1,758 | Depots, piles, cranes, routes, lines, cargo, spacing, the speed-cap composition, `prune` |
| `src/game/game.ts` | 1,219 | The frame loop, `trackChanged`, rendering hooks |
| `src/routing/router.ts` | 894 | Plans, locks, restore, points waits, hand-run walks |
| `src/persist/save.ts` | 707 | Save format v13 (Zod), load |
| `src/economy/stalls.ts` | 214 | Follows wait chains, says "stuck" |

The routing harness (718) and scenarios (740) are test code. In all: 84 `Map<number,…>`/`Set<number>` fields across
sim, sections, router, stalls and economy.

### 1.2 The per-tick order (as the code runs it)

`Game.frame` (`game.ts:786`) runs up to `MAX_STEPS_PER_FRAME` steps of `sim.tick(); economy.tick()` at 120 Hz. Inside:

1. **`Sim.tick`** (`sim.ts:1244`): rides, lifts, decks, `updateSignals`, then **for each train in `Map` order**:
   turn-back countdown (`turnAround` → *a new train id*), `turnBlocked`, `endBehind`, then `move(train)`.
2. **`Sim.move`** (`sim.ts:1505`) asks for a speed cap, composed from:
   - `sim.speedCap` → `Economy.capFor` (`economy.ts:1315`) = min of `depotCap` (crane holds, spacing at stops),
     `kitStops.cap`, **`sections.cap`** and **`router.speedCap`**;
   - `signalCap`, `liftCap`;
   - then `followRoom` (close behind) and `crossCap` (crossings and points, `crossClaims`, skipped where
     `waitsAt` says the router holds it).
3. **`Sections.cap` is not a query: it decides.** On the first call in a tick it works the lines out again (`line()`,
   `lineTick`); then per train it asks for moves, grants, holds, cuts moves and records waits (`grant`, `hold`,
   `cutMoves`, `clearHeld`). A grant adds the engine to `steerSoon`. So train A's grant is seen by train B's cap in the
   same tick, but not the other way round: **the order of the sim's train map is part of the rules.**
4. **`Economy.tick`** (`economy.ts:1555`): `work()` (cranes), `kitStops.tick`, `advanceRoutes`, **`router.tick`** (every
   8 ticks, or now for `steerSoon`: locks, throws, restores, hand-run walks), **`stalls.tick`** (every `CHECK_TICKS`),
   then depot production.
5. **The frame** (`main.ts:3719` `onFrame`): `interaction.tick`, sim events → audio, cards refreshed (they read
   sections' `waitOf`, router's `waitOf`, stalls' `stuckOf`, `sim.heldHow`).

**Where they feed each other:** sections → router (`steerHint`, `steerSoon`, `awaitingGrant`); router → sections
(`routeWait`, `restsAt` = `Router.defaultOf`); router → sim (`speedCap`, `waitsAt`, throws); sim → everyone (`heldBy`,
`pointsHeld`, `piecesUnder`); all of them → stalls. The router acts *after* every train moved, on caps and holds from
*before* they moved: a one-tick lag that `crossClaims` ("valid this tick and the next") and `Sections.managing`
(`ticks - managedTick > 1`) paper over.

### 1.3 Who mutates what

| State | Keyed by | Written by |
|---|---|---|
| `Economy.routes`, `lineIdOf`, `lines`, `cargo`, `riders` | engine/car id | `lines.ts`, `setRoute`, **`Economy.prune`** (deletes whatever isn't on the sim *now*) |
| `Sections.states`, `admitted`, `joinedAt`, `firstSeen` | engine car id | `Sections.cap` (inside the sim's move), `prune`, `restorePlace` |
| `Router` holding, locks, waits, defaults | engine id, piece id; waits store `trainId` | `Router.tick`, `lever`, `laid()` (from every `prune`) |
| `Sim.held`, `crossClaims`, `turnBlocked`, `endBehind` | **train id** (changes on turn, couple, split) | `Sim.move`, `Sim.tick` |
| `Stalls` | engine/train id | `stalls.tick` |
| switch state | piece id | router, lever (via router), editor, load |

`Economy.prune()` runs from `Game.trackChanged` (`game.ts:538`, every track edit), Remove, the drop over the tray and
Put away. It cascades into spacing, sections, kit stops and `router.laid()`.

### 1.4 Saves

`save.ts` (v13) saves trains by cars and their lead cursor; **car and train ids are handed out afresh on load**
(`sim.ts:192`, `putBack`), and lines are re-joined per engine (`joinSavedLine`, `restorePlace`). Piece ids and depot
ids survive (layout keeps ids, depots by index). Locks aren't saved: rebuilt from what trains stand on.

## 2. The root patterns behind recent bugs

From `git log --since=2026-10-28` (90 commits, 20 merges), the playbooks' gotchas and open items:

| Bug (where it's recorded) | Pattern |
|---|---|
| A route and line wiped by `prune` while the train was in the hand (#4, rail-road §1 "Only one route") | **E** side-effect clear, **C** no owner |
| Routes and defaults cleared or rewritten by unrelated track edits (`trackChanged` → `prune` → `router.laid`) | **E** |
| A follower re-throwing the leader's points; last writer won every 8 ticks (#3) | **A** many deciders, **B** order |
| Lever taps moving points under a train, splitting it (#3) | **A** (lever, router, sim each gate) |
| Trains inside each other at crossings: sections kept only a line's own trains apart (#2) | **A** |
| Stuck in each other after no-turnbacks: removing 11 breakers exposed waits nobody named (5b) | **A**, **F** no single "why" |
| A hand-run train held by sections keeping a routed one waiting; a waiter's claim stopping the train the points are set for (a ring, step 7, `waitsAt`) | **A**, **B** |
| Lineless train edging under `clearCap` read as moving; OFF k2 stood 180 s "still 3" (faa9200) | **F**, **C** |
| Sections wait naming a train that isn't there, from 0 s (long fuzz seeds 74, 127, 135, 183) | **D** ids, **C** |
| Car ids change on reload: tests find trains by position; "said once" state lost (rail-road gotchas, QA lessons) | **D** |
| Train ids change on every turn round (`turnAround` → `newTrainId`); `Sim.held`, claims and router waits keyed by them | **D** |
| e2e flakes: card tap guard vs undrawn buttons (#19), holds by event time, SwiftShader frames | **G** test timing |
| Playbook and spec merge conflicts; "Landed recently" re-merged into 4 branches a day | **H** process |

**The classes:**

- **A. Several systems decide the same thing.** "May this train move, how far" is decided by 11 places:
  `depotCap`, spacing, `kitStops.cap`, `sections.capIn`/`capOf`, `sections.clearCap`, `router.speedCap`, `signalCap`,
  `liftCap`, `followRoom`, `crossCap`, and the turn-back state in `Sim.tick`. "Which way" by three: the router's plan,
  sections' `wayOn` (shared cost set since step 6), and "as the points lie" for hand-run trains. Each was right alone;
  bugs live where two disagree.
- **B. Implicit ordering between ticks.** Sections decides inside the sim's per-train loop, the router after it,
  stalls after that. Fixes compensate with lags (claims valid for two ticks, `managedTick > 1`, `waitsAt`).
- **C. Derived state cached without a clear owner.** Sections' `slow`, `loopCount`, `network`, `clearHeld`; router's
  plan cache; stalls' chains. Each keys its own cache (`key: string`) and its own "forget" rule.
- **D. Ids that aren't stable.** Car ids across reloads; train ids across turns, couples and splits. 84 maps keyed by a
  number, three kinds of number.
- **E. State cleared as a side effect.** `prune` deletes by "isn't on the sim now"; the rule "nothing may prune while a
  train is in the hand" is a comment, not a guard.
- **F. No single answer to "why is this train stopped".** Stalls stitches four sources (`stalls.ts:171`); crane, kit,
  spacing, signal and lift holds name nobody, so the card, the fuzz and the player each see a different story.
- **G. Tests driven by wall time.** e2e taps and holds race frames under SwiftShader.
- **H. Process.** Long playbook sections edited by every branch.

## 3. Proposal: six changes, ranked by bugs saved per effort

### 3.1 Invariants everywhere, and the long fuzz as a standing check (rank 1)

**What:** move the harness's invariants (`wrongRoad`, `split`, `underTrain`, `pinned`, `restore`, `lockRun`,
`stuck`/named-blocker, "every wait names a train that exists") into `src/sim/invariants.ts`, run against any `Sim` +
`Sections` + `Router`. Assert them in dev builds (every N ticks, `import.meta.env.DEV`), in sections QA, the
play-throughs and the routing fuzz. Add a nightly GitHub Action (there is only `deploy-pages.yml` today): `npm test`,
the long fuzz (200 × 30 min, sharded), sections QA `SHOW=1` diff against the last green run, balance on the 9 seeds.
Post a summary to an issue; a red night opens one.

**Fixes:** catches A, B, C, D the day they're introduced, on the game's own path, not just the harness's stand-ins
(today the harness has no `Economy`: cranes, spacing and kit stops never meet the invariants).
**Risk:** low; first runs will find real breaks (seeds 9, 41, 106, 140 already fail "trains deliver").
**Size:** S–M (2–3 days). **Pinned by:** nothing changes in behaviour; trajectory hashes identical.
**Runtime:** 0 in production (stripped); dev builds pay a check every 30 ticks or so.

### 3.2 One answer to "why is this train stopped": a `Hold` record (rank 2)

**What:** every cap returns `{ cap, hold?: { by: trainId|null, why, pieceId? } }` instead of a bare number, and the
sim keeps the binding one per train (`Sim.holdOf(train)`). Stalls, cards, the fuzz and a dev overlay read only that.
Crane, spacing, kit stop, signal and lift holds get `why` values too.

**Fixes:** F outright; much of A becomes visible (two deciders disagreeing shows as a hold that flips each tick, which
an invariant can flag). Stalls loses its stitching. The card text comes from one place.
**Risk:** low–medium: the caps' order of `min` decides which reason wins; keep today's order.
**Size:** M (3–4 days). **Incremental:** add the record beside the number, one cap at a time; trajectory hashes must
stay identical (the numbers don't change). **Runtime:** one small object per capped train per tick (reuse one per train:
no allocation).

### 3.3 Explicit tick pipeline with phases (rank 3)

**What:** `Sim.tick` and `Economy.tick` become one `World.step()` with named phases:
`intent` (sections admit, router locks and throws, for all trains, in a fixed order by stable id) → `caps` (pure
queries, no writes) → `move` (physics) → `contacts` → `post` (arrivals, cranes, production, stalls). Sections' `cap`
splits into `admit()` (writes, in `intent`) and `cap()` (reads). The router runs before the moves it governs, so the
one-tick lags (`crossClaims` two-tick validity, `managedTick > 1`) can go.

**Fixes:** B; most of the ordering half of A. Makes a seeded replay deterministic by construction.
**Risk:** medium–high: it reorders decisions, so it drifts everywhere (like every sim change, rail-road gotchas).
**Size:** M–L (1–1.5 weeks). **Incremental:** first iterate trains by a stable sort with today's order preserved
(hash-identical); then split `Sections.cap` into admit/cap keeping the call site (identical); then move `router.tick`
before `move` behind a flag, and accept one drift table for that step alone. **Runtime:** neutral (the same work, in a
different order; pure caps can be cached per tick).

### 3.4 Stable entity ids, and a `trainKey` (rank 4)

**What:** save car ids and the sim's id counters (`nextCarId`, `nextTrainId`), and restore them (`addTrain` already
takes `carIds`). Give each train a stable key that survives turns, couples and splits: the engine's car id (`nameOf`),
and key `Sim.held`, `crossClaims`, `turnBlocked`, `endBehind`, router waits and stalls by it, not by `train.id`.
**Fixes:** D: "said once" state lost on reload, tests finding trains by position, waits naming a train that isn't
there, held-by surviving a turn. **Risk:** low; old saves (no ids) keep today's fresh ids.
**Size:** S–M (2 days, plus a save test). **Pinned by:** trajectory hashes (in-session ids are unchanged) and a
round-trip test (save, load, ids equal; a reload mid-wait keeps the wait). **Runtime:** 0.

### 3.5 No silent destructive side effects: commands with reasons (rank 5)

**What:** `Economy.prune()` stops guessing from "is it on the sim now". The changes that drop a route or line are
explicit: `economy.retire(engine, reason)` from Remove, the tray drop and Put away; track edits call
`economy.trackEdited(removedPieces)` which drops only what depended on those pieces (stops at a gone depot, locks on
gone points). A train in the hand is `lifted`, not missing. Each drop appends to a ring-buffer log
(`{tick, engine, what, reason}`), shown in the dev overlay and attached to bug maps (§3.6).
**Fixes:** E; the #4 class; "routes cleared by edits"; makes C smaller (each cache drops on a named event).
**Risk:** low–medium: something today relies on prune's broad sweep (a train that vanished by derailing). Find them by
asserting "prune would have deleted X but nothing retired it" in dev for a week first.
**Size:** M (3 days). **Runtime:** none per tick; a log entry per edit.

### 3.6 A bug-map loop: copy the map, replay it seeded (rank 6, but cheap to start)

**What:** a "Copy map" in the dev menu (and a hidden gesture on phones) that copies the save, the sim tick, the input
log since load (lever taps, Go/Stop, edits, as commands, see §3.5) and the drop log. `scripts/replay.mjs <file>`
loads it in vitest, replays at 120 Hz with the invariants on, and prints the first break. Any play-test report
becomes a test in `src/play/bugmaps/` that must stay green.
**Fixes:** shortens every bug's round trip; turns play-test notes into regressions; replaces many hand-built e2e
setups. Needs §3.4 (ids) to be exact, and §3.3 for full determinism, but a save-only version works today.
**Risk:** low. **Size:** S for save + seed replay (2 days), M with the input log. **Runtime:** a small input log.

### 3.7 Later: one per-train intent owner (the big one)

**What:** a `TrainController` per train (keyed by `trainKey`) holding route, plan, locks, admission, and the current
`Hold`: sections and the router become *services* it asks ("may I have the next section?", "lock these points") and
the sim obeys its one cap. `crossCap`'s points half and sections' `clearCap` for lineless trains fold into it.
**Fixes:** A at the root. It's where 3.2–3.5 lead; done after them it's mostly moving code, not changing rules.
**Risk:** high if done first (every rule touched at once); medium after 3.1–3.5. **Size:** L (2–3 weeks), in steps
like the routing migration (spec §13): one decider moved per step, each hash-identical or with its own drift table.
**Runtime:** about neutral; fewer duplicate walks (sections and router both walk the way ahead today).

### 3.8 Also: split the giant files by responsibility (do it as you touch them)

`interaction.ts` (5,329) and `main.ts` (4,091) are where merges collide and reviews miss things, but they're mostly
UI, not train logic; their bugs (holds, card guards) are class G. Split as features touch them: trains
(pick-up, drop, Put away, cards) into `src/game/train-hand.ts`; levers into `lever-hand.ts`; `main.ts`'s toasts and
cards wiring into `src/ui/wire-*.ts`. Each split is a pure move, pinned by `npm test` and the touched e2e. Not ranked:
it reduces merge pain (H) more than bugs. Same for the playbooks: "Landed recently" moves to a per-step changelog file
per branch (`docs/agents/landed/<branch>.md`), so two branches don't edit the same paragraph.

| Change | Classes | Effort | Risk | Runtime |
|---|---|---|---|---|
| 3.1 Invariants + nightly | A B C D | S–M | low | 0 (dev only) |
| 3.2 `Hold` record | F (A) | M | low–med | ~0 |
| 3.3 Tick pipeline | B (A) | M–L | med–high | neutral |
| 3.4 Stable ids | D | S–M | low | 0 |
| 3.5 Commands, no prune sweep | E C | M | low–med | 0 |
| 3.6 Bug-map replay | all (speed) | S→M | low | tiny log |
| 3.7 Train controller | A | L | high→med | neutral |

## 4. Recommended sequence

1. **Week 1 (cheap, high value):** 3.1 invariants in dev + nightly; 3.4 stable ids; the save-only half of 3.6.
   All hash-identical. These alone would have caught #4, the waits naming a missing train, and the reload gotchas.
2. **Week 2:** 3.2 `Hold` record (hash-identical), then 3.5 commands (dev assertion first, then switch).
3. **Weeks 3–4:** 3.3 tick pipeline, in its three steps; one drift table, at the router-before-move step only.
4. **Then decide on 3.7** with the invariants and the `Hold` record showing where deciders still disagree.

**Pause features?** Not entirely. Pause **new train-behaviour rules** (signals #16, sections P3, routes-blocks) until
step 2 is done: each would add another decider and another cap. UI, Game Mode balance, towns, research and Sandbox
pieces can carry on (different files, and they don't touch the tick). Signals in particular should be built on the
`Hold` record and the pipeline, not beside them.

**How to keep behaviour pinned:** every step lands with `trajectory.mjs` against main on the harness, the fuzz,
sections QA and seeds 2027/1/2 (1 and 2 trains a line); a step that's meant to change behaviour lands alone with its
drift table, as the routing migration did.

## 5. Open questions for the user

1. Is it OK to pause new train-behaviour features (signals #16 included) for about two weeks while 3.1–3.5 land?
2. A nightly GitHub Action uses CI minutes (the long fuzz is a few hours of CPU, sharded). OK to add one?
3. Would you use a "Copy map" button when you hit a bug in play-testing (the copied text pasted into Slack becomes a
   test)? On a phone, where should it live: the ☰ menu, or hidden?
4. Saving ids changes the save format (v14, old saves still load). Fine?
5. 3.7 (one controller per train) is the deepest fix but the biggest: decide now, or after seeing what 3.1–3.5 find?
