# Game Mode — playbook

## 1. Scope
The play layer on top of the railway:
- **Economy** (`src/economy/economy.ts`): depots, `RECIPES`, piles, caps, unloading (`canUnload`, `takesNow`), routes and stops (`picksAt`, `roomAhead`, `usedAfter`), and `owed` goods.
- **Workshop and crafting** (`src/game/crafting.ts`): `shopNeeds`, `shopOwes`, `shopOwing`, `builtOf`, `shopSpare`, `yardKeeps`, `keepsForOrder`, orders.
- **Goals** (`src/game/goals.ts`), **research** (`src/game/research.ts`, school, `SCHOOL_SHARE`) and **rewards** (`src/game/rewards.ts`).
- **Industries and map sites:** `industries.ts` (`SITE_RULES`, fields), `map-sites.ts` (ruins, `farmFields`, `placeSite`), `restore.ts` (`restoreRuin`, `restorePrice`, `trackCanReach`, payoff text), `harbours.ts` (`HarbourTrade`).
- **Balance:** `src/play/balance.test.ts`, the harness, the goals play-through and the bands.
- **Town looks as they grow** (issue #17): `src/props/storeys.ts` (storeys and styles by level), `townProps` / `setTownStoreys` in `src/props/towns.ts`, the stacked models in `src/render/props/library.ts`.

Rail and road owns the sim and sections. Send them head-ons and switch-path issues with a minimal repro; don't fix their code.

## 2. How to test
**Checks:** typecheck, the relevant vitest files, then one full `npm test` before handing off. Under load, unrelated tests time out: rerun them alone and say so. Never call a red run green, and don't pkill by name.

**Balance harness:** `BALANCE=1 npx vitest run src/play/balance.test.ts`. It isn't part of `npm test`.
- **Seeds:** `BALANCE_SEED=n`. The standard nine are 2027, 1, 2, 3, 4, 5, 6, 9 and 10; in parallel they take about 4 min.
- **What it plays:** 180 min, one train per line. It prints SUMMARY and BANDS lines.
- **Bands:**
  - City between 60 and 90 min;
  - town gap under 45 min;
  - research stall 15 min or less (with a plank-famine exemption);
  - researched count at or above each seed's floor;
  - coins at 180 of 150–600 (nice-to-have).
  - **Never loosen a band.** A failing band is a finding.
- **Compare:** a pure harness or UI change must leave the SUMMARY lines byte-identical. For game changes, report the shifts in a table.
- **Baseline, City minute (default settings):** 2027 62, 1 61, 2 73, 3 80, 4 80, 5 73, 6 67, 9 69, 10 82. **Researched by 180:** 15, 17, 15, 15, 14, 15, 14, 15, 15.
- **Flags:**
  - `BALANCE_SPUR=1`: off by default; all 9 seeds pass with it on;
  - `BALANCE_SPARE_COVERS=off`;
  - `BALANCE_CARD=first|last` and `BALANCE_CARD_SEED=n`: card-luck robustness;
  - debug: `BALANCE_GOALS_LOG`, `BALANCE_JOIN_TRACE`, `BALANCE_STOPS`, `BALANCE_NOUNSTICK`, `BALANCE_JAM_MINUTES`, `BALANCE_SECOND_GOODS`, `BALANCE_LOOP_PIN`.

**Goals play-through:**
- **Fast part:** in `npm test`, to minute 175, about 50 s (keep it under 60 s). 19 of 22 goals.
- **Long part:** `GOALS_LONG=1`, to minute 440, about 135–160 s. 22 of 22. The CoS's gate runs it for economy, goals and industry changes.
- **Allowlists:** `GOALS_NOT_REACHED` and `GOALS_LONG_NOT_REACHED` (now empty), each entry with a reason. A guard test fails on unmet goals that aren't listed, stale entries, entries with no reason, or a long list that isn't a subset of the fast one.
- **The player's route:**
  - ruins are restored with `restoreRuin`, the price paid;
  - goods arrive by train;
  - never write piles, coins or learned directly.

**Footprints:** use `loadFootprints(["bldg"])` from `src/props/footprints-testing.ts`. Never `footprintOf: () => undefined`.

**e2e:** `npm run e2e:sites` covers ruins and restores. It takes about 37 min, and its late sections have crashed under load.

## 3. Design rules
**Decisions already made:**
- The pre-flour pinch stays.
- `BALANCE_SPUR` stays off by default.
- Goals stay met once met.
- No ruins in Sandbox.
- The harbour site needs 5. The mill costs 400 coins.
- Player text is short and kid-clear. Fields count as whole fields ("2 of 2").
- **Research tickets say it in words (#11).** Every card's ticket heads its pictures "Unlocks:" and has a "Costs:" line with every good and the coins, each as amount, icon and name ("6 🪵 planks, 6 🌾 grain, 40 🪙 coins"; "(paid)" once started). Both come from `costWords` and `unlocksWords` in `research-text.ts`. Tags on the web, cost chips and the study time have `title` tooltips for desktop hover; on a phone, a tap on a tag opens its ticket. The picker's rebuild key (`pickerKey`) is unchanged, so tooltips mustn't show live coin counts.

**Workshop:**
- It takes planks and iron, and owes stone. Moving iron to owed is open.
- `shopNeeds` counts a known thing only while none of it is on the map (`builtOf`). Queued orders always count. A thing still in the toy box still owes.
- The cache is keyed by learned count, layout and `Layout.piecesVersion`. No scans per unload.
- `owes` is checked once a second in `updatePlanksKept`. Routed lines re-plan via `acceptsChanged`.

**Spare rule:**
- `WORKSHOP_SPARE` is 7 while a town on the line wants planks.
- `shopSpare` raises it only for an industry that's known and unbuilt AND that the current goal or waiting research points at. Capped at the yard's cap.
- Kits and cars never raise it.

**Auto stops:**
- An auto stop loads a unit only if a later stop has room for it now, minus what this train already carries.
- Towns and schools that want the good count as unlimited room.
- A warehouse or harbour counts only if no later stop uses the good.
- Halts and pick-only stops count as no room. Other trains aren't counted.
- Only pick up, Only drop and unrouted trains are unchanged.

**Towns grow upward (#17):**
- A house gains storeys by its town's level, less one per ring (`RING`, 1.5 squares) out past `INNER` (2.5 squares from the centre): hamlet none, village +1, town +2, city +3, city ★ +4 at the middle. Capped per model (cottages and bungalows +1, villas, terraces and semis +2, the apartment block +2). Never fewer at a higher level.
- Stacked from `floors.glb`'s storey blocks (ground with the door, floors, the house on top), loaded only once a town grows. A prop's `storeys` is saved; `TownLife.reset` and `grow` set them (`setTownStoreys`, only the props that change). Model key `asset^n#variant`: same materials, so the same batches and draw calls.
- From a town (level 2) new plain-house lots take half their styles from `STYLES_BY_LEVEL` (townhouses and narrow houses; at a city flats, a fire and a police station, a kiosk, a town hall on a 2×2; at ★ a hospital). From a city, a town with no church gets one on its next house lot of 2+ squares. Level 0 (Sandbox, new maps) dresses exactly as before.
- Measured (starter Larkfield, swiftshader, 844×600 @1.5): City ★ 229 draws both before and after; triangles 1.26M → 1.35M (+7%); idle 0 frames. Pictures: `docs/agents/shots/towns-taller-before-after.jpg`.

**Moving houses and streets in a town (#18):**
- Game mode: a town's house is dragged onto another lot of its town (a green or edge grass beside a street) or swaps with a house its size (`town-moves.ts`, from before). A street piece is dragged the same way (`street-moves.ts`, `RoadHand` with `street` set): onto a town green, or grass at the town's edge within `MAX_REACH`, where it joins another street of its town at its level. Not onto track, props, a station's way in, a step, or anything that shuts a town or depot in (`checkLot`).
- Houses keep facing a street: one that faced the street's old square turns to another street beside it (along a two-square house's long side), its prop re-posed; if it has none, "A house faces this street: move the house first".
- The square a street leaves is a town green (grass again if it was edge grass the town took, as for houses). Street road bytes are reshaped as `growTown` does (dead ends stay straights). A town's street is never selected (a finger rests on it to pick it up, a mouse drags it; a tap opens its town's card), has no turn or remove, can't go in the box, and Clear leaves it ("The town's streets stay"). Moving one may split a street in two (allowed; not checked for growth). One undo step (`recordLand`, which also redraws roads).
- **Town greens take track** (`clearance.ts`: only `SURF_ROAD` blocks as "town" now). The "garden plots" in the play-test screenshot are these greens: a painted lawn with flowers in its corners, drawn on a town square with nothing on it (`townGreens`/`green` in `render/dressing/buildings.ts`), left where a house was moved from. Growth and a moved house keep off a green with track on it (`checkLot`'s track check).
- Storeys: a moved house keeps them (`setTownStoreys` never lowers a house's storeys at a level above 0).
- Checks: `street-moves.test.ts`, `npm run e2e:town-drag` (390×844 touch: a house and a street dragged, town grows on; about 4 min).
- Not checked: undoing a move after the town has since grown onto the squares involved (the undo puts back the squares as they were; house moves are the same).

**Performance:** nothing new per frame. Cached checks go in the once-a-second update. Note timings.

## 4. Open items
1. **Real switch and bridge goals** (WIP `real-goals-wip-dont-land` d7e1c42, untested).
   - The play-through meets the switch goal with a lone switch, and the bridge goal with a bridge on dry land.
   - The switch should be on a branch a train routes through: assert that a train passes it.
   - The bridge should cross water on a running line. If the game ticks a dry-land bridge, report it.
   - The fast part must stay at about 50 s, the long part at 22/22.
2. **shop-iron-owed** (WIP `shop-iron-owed-wip-dont-land` 8b56aae, untested).
   - Move iron from takes to owed, plus a modest spare for known unbuilt iron users (smithy 4, power station 6).
   - The card says "Needs N ⚙ at the workshop".
   - Decide and explain Sandbox, and check old saves with iron still load.
   - Tests by train: iron refused when nothing is owed; owed for an unbuilt smithy; refused once it's built; pulled by an order; the school still gets Smithy's iron.
   - Run the 9 bands, both goals parts, and a 400-min seed-1 run.
3. **A long part robust to card luck:** 3 of 8 card perturbations miss open-harbour, because Harbours is learned too late with one goods train on a 28–30-stop line.
   - Fix: a second goods train, or shorter lines.
   - Target: passes on all perturbations, with and without curved-ramps.
   - Then check whether Foundry still sticks at 9/10 stone.
4. **Drop B5's empty-the-sawmill workaround** in `sections-qa.test.ts`. The idle head-on fix (39533c3) is on main; check that all sections-qa tests pass after.
5. **School priority:** deferred until item 3. Propose the smallest rule if Foundry still stalls.

Also waiting on the user: the coin-sink plan (town treats and a paint shop, plan a57a272) and the stuck-cargo hint. Related GitHub issues: #13 (caboose), #14 (research queue). #18 (moving houses and roads) is on `claude/town-drag`. #17 (towns growing taller) is on `claude/towns-taller`.

## 5. Gotchas
- **Harness gaps hide game bugs:** the old farm, the harbour's stone, and crane pile spots were all missed because tests wrote piles directly. Test by the player's route.
- **Card luck:** any new piece type shifts every later reward draw (curved-ramps did). One passing draw isn't proof; try `BALANCE_CARD_SEED`.
- **The 7-plank spare versus prices of 8 or more:** the workshop sits one short unless something is ordered. The harness uses `orderMill`, and orders the harbour.
- **One goods train is the bottleneck.** Hoppers full of unwanted goods block everything (`roomForMine`, auto-pickup).
- Interpret specs sensibly, and say how.
- **Stacked branches:** merge, never rebase or force push. Trial-merge the landing order and test the combination.
- **Reports:** head SHA, file:line, before/after tables, exact player text, check results, and what to test. Flag product calls; don't make them.
