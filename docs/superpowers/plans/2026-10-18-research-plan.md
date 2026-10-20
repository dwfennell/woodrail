# Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Not before the crossing work lands.** Building starts only after the crossing branches (`routes-loops`,
> `routes-blocks` and the 3d follow-up, steer following the held claim) are merged to main. Each phase then branches from main as it is.

**Goal:** Every blueprint is learned by research at a school, a depot beside a town that trains deliver goods to.
Town growth always offers a choice of resources, never a blueprint.

**Architecture:**
- **The school is a depot role** (`RECIPES.school`) with a `SITE_RULES` row that says "beside a town".
- **A small `src/game/research.ts` holds the research state** on `Progress`: `current`, `next`, the goods delivered
  so far, and the study clock. The economy's `accepts` hook asks this state what the school still needs.
- **The UI reads the same state.** The blueprint board becomes the picker, and a HUD pill shows progress.
- **The workshop only makes things.**

**Tech Stack:** TypeScript, Three.js, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-research-design.md` (the decisions are its §8: a depot beside a town,
one research plus Next up, coins from tier 2).

## Global Constraints

- **Each phase ships on its own:** green `npm test`, `npm run typecheck` and `npm run build`, with its own tests, and
  the game playable from a new game.
- **Each phase measures the seed table** and puts it in the commit:
  - Run `for s in 2027 1 2 3 4 5; do BALANCE=1 BALANCE_SEED=$s npx vitest run src/play/balance.test.ts; done`.
  - Record the `SUMMARY` line for each seed: coins at 180, City minute, stall, kept, town gap.
  - From P1, also record the new `research` fields: minute of the first research, longest research stall, and the
    number learned at 60, 120 and 180 min.
- **Performance (AGENTS.md):**
  - Research advances only on a delivery or the study tick, which runs on the existing `CRAFT_STEP` timer. It is not
    a per-frame step.
  - The pill and the picker redraw on change only.
  - `accepts` for a school is an O(1) lookup, because it runs in the crane's hot path.
- **No `Math.random` in `src/economy/`.** Research state holds no wall clock.
- **Cozy:** goods are never lost. A school with nothing picked accepts nothing.

## Review Focus

- **No double-dipping.**
  - A school accepts only what `current` still lacks: never more than that, and never a good it doesn't need.
  - From P1, the workshop doesn't keep planks for blueprints.
  - The test: an unrouted plank train passing a school, then the workshop, then a town drops exactly the remainder
    at the school.
- **Next up.**
  - When `current` finishes, `next` starts at once. It stays waiting if its coins are short, and the card says so.
  - Picking the one in Next up as `current` swaps the two.
- **Saves at v12** round-trip `current`, `next`, delivered goods and the study clock exactly.

---

## P1: the school depot and the research engine

**Ships:** you learn blueprints by research at a school.
- **Stopgap:** the existing board's tap on a ready card picks it as research, instead of `learnWithGoods`.
- **Unchanged until P3:** town offers still give blueprints.

**Removes:**
- The board's pay-at-the-workshop path, from the UI.
- Holding planks for blueprints: `planksWanted` returns 0 for blueprints. The code itself goes in P4.

### Task 1.1: the school depot and its site rule
- [ ] Add `school` to `DepotRole`:
  - `RECIPES.school`: takes every good except logs, gives nothing, `cap` 30.
  - A `piece:depot-school` thing in `THING_RULES`, in the Industries tab.
- [ ] Add `SITE_RULES.school`, which counts a town's lots within reach 300 (need 1).
  - `siteWhy` gives the refusal "Needs to be beside a town".
  - A second school at the same town is refused with "Larkfield has a school".
- [ ] Name the school after its town, and record its town id on the depot.
- [ ] The school's model is the existing school model, drawn by `DepotView` on the depot yard.
- [ ] Tests (`industries.test.ts`, `depot-footprint.test.ts`): a school fits beside a town, is refused away from
  one, is refused as a second at the same town, and its splice and footprint behave as other depots'.

### Task 1.2: research state (`src/game/research.ts`)
- [ ] Add `Research { current: string | null; next: string | null; got: Bag; study: number }` on `Progress`.
- [ ] Add these functions:
  - `pick(p, id)`: becomes `current` if idle, else `next`; picking `next` again swaps the two.
  - `costOf(p, id)`: goods, plus coins from tier 2.
  - `lacks(p)`: what the school still needs.
  - `deliver(p, kind, n)`: returns the number taken.
  - `tick(p, seconds, speed)`.
- [ ] Coins are paid when a research starts (taken on `pick` if idle, or on promotion from `next`). If they're
  short, it stays in `next`.
- [ ] Study time is 20 s, 45 s or 90 s by tier, at speed 1 for now (P4 adds the college).
  - Done: the blueprint is learned, `learnAuto` runs, and `next` is promoted.
- [ ] Add research costs to `blueprints.ts` as `research: { goods, coins? }`, derived from today's `price`:
  - tier 1 costs goods only;
  - from tier 2, add the spec's chain good.
  - These are placeholder numbers; P5 tunes them.
- [ ] Tests (`research.test.ts`):
  - pick, swap and promote;
  - coins short keeps it in `next`;
  - `deliver` caps at the remainder;
  - study finishes, then promotes;
  - nothing decays over a long wait.

### Task 1.3: goods into the school
- [ ] In the economy's `accepts`, a school accepts kind `k` only while `lacks(p)[k] > 0`. On unload, call
  `deliver` and leave the pile empty: the goods count as progress.
- [ ] Turn off holding planks for blueprints: `planksWanted` returns 0 for them. The goal's aim stays only for
  ordering, and the workshop keeps planks only for its waiting tray order.
- [ ] Tests (`cargo-drop.test.ts` or a new `school-cargo.test.ts`):
  - an unrouted train leaves exactly the remainder;
  - a routed drop is capped the same way;
  - with nothing picked, nothing is taken;
  - the town after the school gets the rest.

### Task 1.4: the first village's present, and the stopgap tap
- [ ] `firstTimeGift` at level 1 also gives one `piece:depot-school`. More schools cost coins (40🪙).
- [ ] The board's `ready` card tap calls `pick` instead of `learnWithGoods`, and shows "Researching…" or
  "Next up". (This is a stopgap: the real picker comes in P2.)
- [ ] Remove the starting board: everything `ready` can be picked.

### Task 1.5: save v12
- [ ] Bump `SAVE_VERSION` to 12. Save and load `Research` in the progress data. The school depot saves like other
  depots, with its town id.
- [ ] Older saves get `OLDER_SAVE` (kept aside, with today's toast).
- [ ] Tests (`save.test.ts`, `progress.test.ts`): a round-trip mid-research and mid-study; a v11 save is turned
  away and backed up.

### Task 1.6: the play-through picks research
- [ ] In `balance.test.ts`, the simulated player:
  - places its school beside the first village;
  - picks `current` and `next` from `WISH`;
  - routes nothing specially, so goods reach the school by the economy's own rules.
- [ ] Replace `learnWithGoods` in the harness, and update `grand-tour.test.ts` and `playthrough.test.ts` to match.
- [ ] Add `research` fields to the `SUMMARY` line: first research minute, longest research stall (one picked and
  no goods in), and the number learned at 60, 120 and 180 min.
- [ ] Measure the seed table and put it in the commit.

---

## P2: the research picker UI

**Depends on:** P1. **Ships:** the Research picker and the HUD pill on a phone.
**Removes:** the stopgap tap, and the board's "offered" and pay-at-price card text.
**Built (research-p2):** as below, with one change for the phone: while the pill shows, it stands in for the Research
button on a phone (same tap, and the button's glow and dot), as the 390 px bar can't hold both beside the coins. "Needs a
school beside a city" waits for P4.

### Task 2.1: the board becomes the Research picker
- [x] Rename the Blueprints button and title to Research. In `blueprint-board.ts`, the `Station.state` values
  become `learned | researching | next | ready | locked | soon`.
- [x] A card shows:
  - goods chips "🪵 6/10 · 🌾 0/6", plus the coins chip from tier 2, red when short;
  - its study time;
  - one button, Research or Next up, at least 44 px.
- [x] `why` lines: "Needs a school", "Waiting for 20🪙", "Needs a school beside a city" (from P4).
- [x] Tests (`blueprint-board.test.ts`): states, chips, button label, swap.

### Task 2.2: the HUD pill
- [x] Add a pill, for example "📘 Bridges 6/10🪵". While studying it shows a bar; when idle it says "Pick
  research". Tap it to open the picker.
- [x] It redraws only when the research state changes, using a signature key.
- [x] Tests (`hud-board.test.ts`): the pill text for each state, and no redraw on an unchanged state.

### Task 2.3: the goal pre-pick
- [x] When a goal with `blueprint` is current and research is idle, the picker opens on that card with Research
  highlighted. Nothing is picked without a tap.
- [x] "Show me" for a research goal points at the school, or at the picker if one is placed.
- [x] Tests (`goals.test.ts`).

---

## P3: the growth menu

**Depends on:** P1 (the research boost card needs research state). It can come before or alongside P2.
**Ships:** "Larkfield grew! Pick one", with 3 cards.

**Removes:**
- `offerFor`, `choose`, `takeBlueprint`, `refreshOffers`, and blueprint ids in `p.offers`;
- `schoolIdeas`, `SCHOOL_BOARD_CAP`, `SCHOOL_IDEA_SECONDS`, and the school's ideas clock in `main.ts`.

### Task 3.1: the offer cards (`rewards.ts`)
- [ ] `offerOnGrowth` draws 3 different kinds from the pool, with amounts by level (spec §3 table):
  - planks to the workshop's yard;
  - coins;
  - a crate (`crateFor`);
  - a wagon, or an engine at city level and up;
  - a research boost (only while `current` is set);
  - rare cargo at the school (from town level, and only with a school).
- [ ] `takeCard(p, world, k, card)` applies it. The planks card offers only what fits in the yards (the card shows
  that amount), so nothing is lost. Rare cargo counts only toward what `current` lacks.
- [ ] Save `p.offers` as cards. This is a schema change, so bump `SAVE_VERSION` to 13. Older saves are turned away
  as in P1.
- [ ] Tests (`rewards.test.ts`): 3 distinct kinds; amounts by level; no boost card when idle; each card applies.

### Task 3.2: the bottom sheet
- [ ] A sheet titled "Larkfield grew! Pick one" with 3 large cards (icon, amount, one line each). One tap takes a
  card. Closing the sheet keeps the offer waiting, with a badge on the town's sign.
- [ ] Tests (`hud-board.test.ts`): it renders 3 cards; one tap applies; closing keeps the offer.

### Task 3.3: remove school ideas
- [ ] Delete the ideas code and its tests. The school landmark's blurb goes, and towns no longer build a school
  landmark: the player's school depot replaces it.
- [ ] Update the harness to take the card the spec names (a boost when waiting on goods, else planks before Farming,
  else coins). Measure the seed table.

---

## P4: the workshop split and tree cleanup

**Depends on:** P1. For the tutorial text, P2 and P3 too. **Ships:** the tree as the spec has it, and the new
opening.

**Removes:**
- `learnWithGoods`, `goodsOf`, `planksWanted`, `keepsPlanks`, `priceOf`'s college discount, `STARTING_BOARD` and
  `p.board`;
- the `school` and `library` blueprint rows and the school and library landmarks;
- `learn: "auto"` (the passenger line is researched, gated by `requires`).

### Task 4.1: the workshop only makes things
- [ ] Delete the blueprint-payment code and its tests. Holding planks becomes "for the waiting tray order" only, in
  `crafting.ts`. The balance `kept` column measures it.
- [ ] Tests (`crafting.test.ts`, `tech.test.ts`).

### Task 4.2: a school that grows with its town
- [ ] Research speed is ×2 at a school whose town is at town level or above, once College is learned. Its model
  becomes the college.
- [ ] A school beside a city gets a library wing (a model change). Tier-3 research `requires` "a school beside a
  city", replacing `landmark("library")`.
- [ ] The model swaps on the town's level-up only, not per frame.
- [ ] Tests (`landmarks.test.ts`, `research.test.ts`): speed by town level; the tier-3 gate; College needs Routes.

### Task 4.3: the tree, and the tutorial order
- [ ] Remove the school and library rows. Passenger blueprints become research with their riders `requires`.
  `seenOf` stays.
- [ ] Goals, in this order:
  1. deliver planks
  2. grow a village
  3. **place a school by a town** (new; "Show me" uses `depotSpot` by the village's station)
  4. **research switches** (`blueprint: "switches"`)
  5. place the workshop
  6. bring it planks
  7. lay a switch
  8. build a bridge (research bridges)
- [ ] Rewrite the goal hints for research.
- [ ] Tests (`goals.test.ts`, `goal-ticks.test.ts`, `starter-line.test.ts`): the order, checks and guides.
- [ ] `npm run blueprints:page` regenerates `docs/blueprints.html` with research costs.

---

## P5: balance

**Depends on:** P1–P4. **Ships:** costs tuned to the spec's §5 targets.

### Task 5.1: tune and measure
- [ ] Tune `research` costs, study times and the growth-card amounts with the seed table, until every seed meets
  these targets:
  - first research by minute 8;
  - longest research stall under 10 min;
  - City minute within ±15% of today's (84 / 106 / 102 / 99 / 123 / 98);
  - coins at 180 within 150–600, and no seed under 100;
  - the town gap no worse than today's (41–77 min);
  - research learned at 180 no fewer than today's blueprints learned.
- [ ] Change one knob per commit, with the table before and after in each commit.
- [ ] Add assertions to the balance test for the bands, so it stays skipped unless `BALANCE=1`.
- [ ] Time a phone run of `npm run dev` for idle CPU with a research running and none running. It should stay at
  today's figure (research adds no per-frame work).
