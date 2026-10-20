# Research: a school you deliver to, and growth that gives resources

Date: 2026-10-18. Status: design, decided with the user on 2026-10-18 (§8). Plan: `docs/superpowers/plans/2026-10-18-research-plan.md`.
Game mode only.

## What the user asked

> I don't love how levelling up cities gets you free techs. I think it should always give you a choice of resources,
> and all techs should be researchable. I am coming around on the idea of a research building you deliver resources to.

And later: "I think the research building should be placed near a town though, maybe." (Taken up: §8, decision 1.)

## Where we start from

- **Three ways to learn a blueprint** (`tech.ts`, `rewards.ts`):
  - a growing town offers two, one learned free (`offerOnGrowth`, `takeBlueprint`);
  - a school puts one on the board every 480 s while its town is supplied, up to `SCHOOL_BOARD_CAP` 3 (`schoolIdeas`);
  - the board starts with `STARTING_BOARD` (switches, bridges, farming, mills), learned at its price with planks and
    goods from the workshop's yard plus coins (`learnWithGoods`).
- **7 learn by themselves** (`learn: "auto"`): school and library when a town builds one, and the passenger line by
  riders. The other 38 built blueprints are learned on the board.
- **Planks are double-dipped.** The workshop's yard (`WORKSHOP_CAP` 30) holds planks both for making pieces and for
  paying for blueprints. `planksWanted` / `keepsPlanks` stop towns taking planks from unrouted trains until the yard
  holds enough for the cheapest ready blueprint, or for the goal's (`Goal.blueprint`). That rule has starved towns
  before (5f55a26: a City up to 76 min later).
- **Landmarks:** a school at village level (ideas), a market at town level (×1.5 pay), a library at city level (gates
  tier 3, such as Quarries), and a college once learned (ideas ×2, planks −20%).
- **Today's balance, at 180 min with 1 train a line:** first delivery at about 2.7 min, village at about 4 min. Per
  seed:

  | Seed | Coins at 180 | City minute |
  | --- | --- | --- |
  | 2027 | 133 | 84 |
  | 1 | 538 | 106 |
  | 2 | 653 | 102 |
  | 3 | 124 | 99 |
  | 4 | 630 | 123 |
  | 5 | 154 | 98 |

## 1. The research building: the school, now a depot beside a town

- **It's the school, made into a depot** (`RECIPES.school`) instead of a landmark that has ideas. The name and model
  already exist, and players already link "school" with blueprints. A second building next to the school would only
  confuse them.
- **Where it comes from:** your **first village's present** is a school, in the toy box (along with today's engine
  and timber wagon). More schools cost coins from the Industries tab, one per town.
- **Placement:** a depot on a straight, like the others (splice, footprint, Flip hint). It has a new `SITE_RULES` row:
  the yard must be within 300 mm of a town's lots.
  - It takes that town's name ("Larkfield school").
  - It sits on your line beside the town, not on the town's lots, so no new rules for lots or roads.
  - "Show me" uses `depotSpot` near that town's station.
- **It grows with its town.** The model changes as the town levels up, and research gets faster:

  | Town level | Building | Effect |
  | --- | --- | --- |
  | village | schoolhouse | study at 1× |
  | town (and College learned) | college | study at 2× |
  | city | library wing | opens tier-3 research (replaces the library landmark's need) |

- **What it takes:** only the goods the current research still needs, and no more. Its `accepts` hook stops it
  taking anything else, so unrouted trains carry the rest on to towns. Goods are used up on arrival and count as
  progress, so the pile is the progress bar.
- **Pacing:** one research at a time, plus one **Next up** slot, so finishing one never leaves the school idle. All
  schools feed the same research.
  - A research is done when its goods are all in, plus a short study time: 20 s at tier 1, 45 s at tier 2, 90 s at
    tier 3, divided by the school's speed.
  - **If goods stop arriving,** the research just waits. Nothing is lost or decays (cozy).
- **The cost is mixed goods, so research pulls on the whole economy.** The prices in `blueprints.ts` become research
  costs. From tier 2, each one also asks for a good from the chain that comes before it:

  | Tier | Examples (goods; coins from tier 2 only; as tuned in P5, §5) |
  | --- | --- |
  | 1 | Switches 4🪵 · Signals 4🪵 · Bridges 10🪵 · Farming 6🪵 · Passengers 6🪵 |
  | 2 | Mills 6🪵 6🌾 40🪙 · Routes 5🪵 40🪙 · Goods engine 6🪵 6🍞 80🪙 · Diesel 7🪵 8🍞 120🪙 |
  | 3 | Quarries 8🪵 6🍞 80🪙 · Mines 6🪵 10🪨 160🪙 · Foundry 10🪨 10⚫ 240🪙 · Electricity 10🔩 10⚫ 240🪙 |

  - **Coins:** tier 1 costs goods only (Halts loses its 20🪙). From tier 2, a research takes coins (P5: twice the
    old prices). They are paid when it starts; a pick you can't pay for yet waits in Next up (its card says how many
    coins are short). Coins never stand in for goods.
  - The numbers were tuned with the play-through in P5 (§5): half the old planks (Switches and Bridges kept),
    Quarries 6 flour instead of 10, twice the old coins, and the passenger line's own costs (Passengers 6🪵, Halts
    6🪵, Dining car 4🪵, First class 6🪵 120🪙, Busy stations 8🪵 160🪙, Double-decker 8🪵 200🪙, Express 10🪵 240🪙).

## 2. The workshop makes things, the school learns them

- The workshop keeps doing one job: it **makes** pieces, cars and buildings from planks and iron. It no longer pays
  for blueprints.
- **What goes:** `learnWithGoods`, `goodsOf` and paying for blueprints at the workshop's yard, and also
  `planksWanted` / `keepsPlanks` in their current form.
- **What replaces them:**
  - The workshop keeps planks only for the tray order waiting to be made (`Crafting`'s order).
  - The school takes only what its research still lacks.
  - No plank is counted by both. Whatever neither of them asks for goes to towns, as it does today.
- `WORKSHOP_CAP` 30 stays. The college's −20% planks discount goes; its speed-up replaces it.

## 3. What a growing town offers: pick 1 of 3

- **Town growth never gives a blueprint.** `offerFor`, `choose`, `takeBlueprint` and blueprint ids in `p.offers`
  all go. An offer becomes 3 cards drawn from this pool, never two of the same kind:

  | Card | Village | Town | City and up |
  | --- | --- | --- | --- |
  | Planks to your workshop's yard (up to its cap) | 8🪵 | 16🪵 | 30🪵 |
  | Coins | 30🪙 | 80🪙 | 200🪙 |
  | A crate of known things (today's `crateFor`) | 2 things | 3 | 4 |
  | A wagon (one you know) | ✓ | ✓ | an engine |
  | Research boost: goods into the current research | 25% of it | 40% | 60% |
  | Rare cargo at the school: goods you can't make yet (stone before Quarries) | — | 6 | 12 |

- **Amounts (settled in P3's tuning pass):** the table above, unchanged. The balance guard was met by the simulated
  player's rule (§5), not by bigger cards: larger planks or coins cards didn't move the late City, which waited on
  planks the school took before the workshop could make the goods train's cars or the farm yard and mill.
- First-time presents (`firstTimeGift`) stay. The first village's present now includes the school.
- **Phone UI:** a bottom sheet titled "Larkfield grew! Pick one" with 3 large cards (icon, amount, one line each).
  Tap a card to take it, with no confirm step. An offer you close stays waiting, as `p.offers` does today.

## 4. Goals, the tutorial and the tree

- **The new opening.** Research comes right after the first village, before the workshop:
  1. deliver planks
  2. grow a village (its present is a school)
  3. **Place a school by a town**
  4. **Research switches** (hint: "Pick Switches, then bring 4 planks to the school")
  5. place your workshop
  6. bring it planks
  7. lay a switch
  8. build a bridge (research bridges)
- **The goal's `blueprint` field** now pre-picks that research in the picker when the school is idle, instead of
  keeping planks. Goals that use `needs` are unchanged.
- **The tree:** every built blueprint is researched.
  - The passenger line keeps its riders requirement, now as a gate on research (`requires`).
  - The `school` and `library` rows leave the tree: they're the school building and its city wing now.
  - College stays a blueprint (needs Routes): it turns town-level schools into colleges.
- **What goes:** `STARTING_BOARD`, `p.board`, `SCHOOL_BOARD_CAP`, `schoolIdeas`, `SCHOOL_IDEA_SECONDS`, and the
  school and library landmarks. The market stays a landmark.
- **Visibility:** `seenOf` stays (key blueprints, plus the ones next to what you've learned).

## 5. Balance targets (seed table: 2027 and 1–5, 180 min)

P5's targets (set by the CoS on 2026-10-20, and revised the same day after P5's first pass: research counted, not
blueprints, and a City band for every seed; they replace the first draft's where they differ). "Main" is main before
research, 17dbc6f (main at 5add1ea gives the same figures, seed for seed):

| Measure | Main | Target |
| --- | --- | --- |
| First research done (Switches) | (new) | **by minute 8** |
| Blueprints researched by 180 | 9 / 9 / 8 / 11 / 7 / 8 (of 23 / 23 / 22 / 25 / 22 / 21 learned) | **at least main's researched**, each seed (7 on other seeds) |
| City minute | 73 / 112 / 92 / 110 / 84 / 87 | **60–90 min** on every seed |
| Longest stretch with no planks into a town | 48 / 41 / 57 / 50 / 57 / 49 min | **under about 45 min**, each seed |
| The guard (as P3's) | | no City more than 20% later than main; no research stall over 15 min; coins at 180 at least 100 |
| Longest research stall (one picked, no goods into a school) | (new) | nice to have: under 10 min |
| Coins at 180 | 1205 / 1563 / 281 / 1001 / 995 / 1224 | nice to have: 150–600 |

(Main's figures by seed 2027, 1, 2, 3, 4, 5.) The first draft asked for City within ±15% of 84–123 and coins within
150–600 against an older main; the first pass of P5 for blueprints learned at least main's and City within ±15% of
main (main's other 13–15 blueprints came free from growth, riders and landmarks). `src/play/balance.test.ts` checks the targets and the guard at 180 min with 1 train a
line (`checkBands`: each miss listed, any fails the run) and prints the nice-to-haves.

The simulated player picks research from today's `WISH` order and takes the growth card it most needs:
- a research boost while a research is waiting on goods;
- otherwise planks before Farming;
- otherwise coins.

It picks research only with planks to spare at the workshop (10), and (P3) not while what the line needs next waits on
the workshop's planks: cars for the goods train (a hopper, a van), or a farm yard, mill or quarry learned and not yet
built. A research picked then takes the planks at the school first, as the train passes it before the workshop.
Signals come right after Halts in its `WISH` order: the goal "Run two trains at once" waits for them, and that second
train is the one that carries people (the coins at 180 come mostly from it).

P3's guard (180 min, 1 train per line; measured against main 17dbc6f, P2, with the same harness): no seed's City more
than 20% later; no research stall over 15 min (the one-goods-train plank famine on a 22-stop line excepted, for P5);
coins at 180 not below 100. P3 meets it on every seed, with no exemption needed:

| Seed | Coins@180 | City min (vs P2) | Longest plank stall | First research | Longest research stall |
| --- | --- | --- | --- | --- | --- |
| 2027 | 1205 → 680 | 73 → 73 (0%) | 9 → 6 | 5.6 → 5.6 | 6.9 → 7.6 (Goods engine) |
| 1 | 1563 → 220 | 112 → 61 (−46%) | 6 → 7 | 7.0 → 5.6 | 6.2 → 10.0 (Quarries) |
| 2 | 281 → 592 | 92 → 73 (−21%) | 10 → 6 | 5.6 → 5.6 | 8.6 → 7.6 (Goods engine) |
| 3 | 1001 → 220 | 110 → 61 (−45%) | 4 → 7 | 7.0 → 5.6 | 12.4 → 10.0 (Quarries) |
| 4 | 995 → 366 | 84 → 54 (−36%) | 10 → 8 | 5.6 → 5.6 | 71.4 → 11.9 (Quicker cranes) |
| 5 | 1224 → 545 | 87 → 73 (−16%) | 12 → 9 | 5.6 → 5.6 | 5.1 → 10.3 (Goods engine) |

Still off the §5 targets above, for P5: City now comes earlier than ±15% on four seeds; no seed reaches a City★ by 180
(P2: four did); fewer blueprints in all by 180 (16–20 against 21–25: growth gives none free), though more researched;
the longest gap with no planks into a town is longer on seeds 1, 3 and 4 (70, 70, 104 min against 41, 50, 57); research
stalls are 7.6–11.9 min against "under 10".

### P5: the tuning (first pass, against the first targets)

Four knobs, one commit each with its table: the passenger line's costs (they were placeholders); half the planks for
every other research but Switches and Bridges; Quarries 6 flour instead of 10; twice the coins from tier 2 (costs in
§1). Study times and the growth cards are unchanged: a bigger boost card (40/60/80%) moved nothing, since the
simulated player rarely sees one while a research waits. Tried and left out: ×1.5 and ×3 coins and a slower farm
(Farming 10🪵, Mills 8🪵 9🌾) each broke the guard on some seed (research stalls of 24–52 min, or 95 coins); Mills at
12 grain left town gaps of 45–50 min on two seeds.

| Seed | Coins@180 (main → P4 → P5) | City (main → P4 → P5) | First research | Research stall (P4 → P5) | Town gap (main → P4 → P5) | Blueprints (main → P4 → P5) | Riders (P4 → P5) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2027 | 1205 → 447 → 274 | 73 → 57 → 69 | 5.6 | 9.9 → 13.1 (Carpenter's bench) | 48 → 102 → 29 | 23 → 11 → 14 | 159 → 274 |
| 1 | 1563 → 229 → 838 | 112 → 62 → 78 | 5.6 | 8.6 → 7.3 (Signals) | 41 → 73 → 30 | 23 → 12 → 20 | 187 → 821 |
| 2 | 281 → 367 → 388 | 92 → 57 → 69 | 5.6 | 9.9 → 11.6 (Carpenter's bench) | 57 → 102 → 34 | 22 → 11 → 14 | 159 → 268 |
| 3 | 1001 → 229 → 983 | 110 → 62 → 78 | 5.6 | 8.6 → 7.3 (Signals) | 50 → 73 → 30 | 25 → 12 → 13 | 187 → 388 |
| 4 | 995 → 684 → 775 | 84 → 72 → 78 | 5.6 | 6.5 → 7.3 (Signals) | 57 → 61 → 32 | 22 → 14 → 21 | 315 → 866 |
| 5 | 1224 → 232 → 341 | 87 → 71 → 60 | 5.6 | 7.6 → 11.4 (Carpenter's bench) | 49 → 55 → 39 | 21 → 14 → 14 | 130 → 211 |

Research done by 60/120/180: 6/10/14, 7/13/20, 6/10/14, 7/13/13, 7/13/21, 7/10/14. Seeds 6, 9 and 10 (checked, not
in the table) meet the guard and the gap too.

- **Met on every seed:** first research by minute 8 (5.6); the guard (stalls 7.3–13.1, coins 274–983, no City later
  than main's); town gaps under 45 min (29–39, from 55–102 in P4).
- **Nice to have:** coins within 150–600 on 2027, 2 and 5 (over on 1, 3, 4, whose Goods engine comes by minute 95–106
  and carries two coaches from then on); research stalls under 10 min on 1, 3, 4 (11.4–13.1 on the others).
- **Not met: blueprints by 180** (13–21 against 21–25). Research is limited by the one train: one research at a
  time, fed only while it passes the school, and its goods are mostly in the train's last pass, so research comes at
  roughly one per 8–15 min late in the game, whatever it costs (halving the planks took 11–14 to 13–21; cheaper still
  only takes planks the towns need). Main's 21–25 had 13–15 free blueprints from growth, riders and landmarks, which
  research now has to earn (main researched 7–11). A product change would fix it, for example: a school also takes Next up's goods once current's are
  in (two researches fed a pass), or a research slot per school.
- **Not met: City within ±15% of main on 1, 2, 3, 5** (met on 2027 and 4). The City clusters at 60–78 on every seed:
  see the next point. A slower farm (Farming 10🪵, Mills 8🪵 9🌾) moved it to 75–85 (four seeds in band) but left a
  seed with a 24 min research stall, against the guard.
- **Seeds converge (the harness, more than the game).** Since P3 the seed only changes which three growth cards are
  drawn (and a crate's things); the map is the same starter map and the sim is deterministic. The simulated player
  takes the same kind of card whenever it's on offer (boost while a research waits, else planks before Farming, else
  coins), and one of the three nearly always is, at amounts fixed by level, so most seeds play the same game: P4's
  seeds 1 and 3 were identical, 2027 and 2 nearly so; at P5, seeds 6 and 9 are identical, as are 10 and 2027. On main the
  seed changed which blueprints towns offered, which changed the whole path (and the City minute, 73–121 over
  seeds 1–11). So main's per-seed City spread can't be reproduced by costs; a real player, picking cards differently,
  would see more variety. For the seed table to mean something again, the harness could take a seeded pick among the
  sensible cards, or play a generated map per seed.
- **What a long research stall is now:** P5's longest (11.4–13.1 min) are Carpenter's bench, picked after Quarries
  at minute 107–114, waiting on planks while one train saws a few a pass on a 16–22-stop line. Worse ones (the 24 min
  that ruled out the slower farm) come when the workshop is ahead of the school from the sawmill: only towns hold back
  what the research lacks (QA fix 1), so the workshop's yard filled (9 → 21 planks) while Carpenter's bench waited.
  Keeping what the research lacks on the train past a workshop, as past a town, would fix that.

### P5: the second pass (the revised targets)

Three changes after the first pass, each a commit with its table:
- `checkBands` asks for the revised targets above (researched at least main's, City 60–90). At the first pass's end
  every band was met on every seed.
- **Past a workshop too:** what the current research lacks rides on past a workshop, as past a town (QA fix 1's
  hold-back, the same `keptForSchool` path), except what the workshop keeps for its waiting tray order. It hardly
  moves the table (the tuned costs rarely put a workshop first while research waits), but in the slower-farm variant
  above seed 4's 24 min stall became 8.0, with 19 researched instead of 13.
- **The simulated player picks a growth card at random** (its own seeded generator) among those that make sense now:
  a boost or rare cargo while a research waits on goods; planks before Farming or with the workshop short of planks
  to spare; coins; a crate while there's no workshop; a wagon while the goods train waits on cars. So seeds differ
  again: of 2027 and 1–5 plus 6, 9, 10, only 2027 and 9 still play the same game (before: 6 = 9, 10 = 2027).

| Seed | Coins@180 | City | Research stall | Town gap | Researched (main) | Riders |
| --- | --- | --- | --- | --- | --- | --- |
| 2027 | 1574 | 77 | **17.4** (Carpenter's bench) | 31 | 13 (9) | 482 |
| 1 | 187 | 63 | 12.4 (Carpenter's bench) | 39 | 14 (9) | 330 |
| 2 | 1406 | 77 | 6.8 (Signals) | 31 | 19 (8) | 913 |
| 3 | 589 | 60 | 9.3 (Quicker cranes) | 20 | 22 (11) | 576 |
| 4 | 1387 | 81 | 7.3 (Signals) | 35 | 21 (7) | 997 |
| 5 | 527 | 60 | 13.1 (Carpenter's bench) | 39 | 14 (8) | 195 |
| 6 | 1879 | 77 | 6.8 | 31 | 13 (7) | 478 |
| 9 | 1544 | 77 | **17.4** | 31 | 13 (7) | 482 |
| 10 | 167 | 74 | 11.9 | **66** | 15 (7) | 411 |

First research at 5.6 on every seed.
- **Met on 2027 and 1–5:** first research by 8; researched by 180 at least main's (13–22 against 7–11); City 60–81;
  town gaps 20–39 min; coins at 180 at least 187; no City later than main's; the passenger line's costs.
- **Not met: the guard's stall on 2027** (and 9, the same game). Carpenter's bench, picked at 146 when a planks card
  fills the workshop's yard, waits 17.4 min for planks: the one train saws a few a pass, and they head away from the
  school first, round the 22-stop line. No knob moved it (Carpenter's bench at 4 planks; a planks card of 8/12/20; a
  boost of 40/60/80%; coins ×1.5): the run is the same up to minute 146. What would: research that takes its goods
  from the workshop's yard when the yard has them, or a second train on the line (the harness runs one).
- **Seed 10 (not in the table): a 66 min gap.** Its hoppers carry grain nobody takes, so the quarry's stone never
  comes, and Larkfield, a city wanting only stone, takes no planks. A harness matter (it never empties a car of goods
  nobody wants).
- **Nice to have:** coins within 150–600 on 1, 3, 5 only (1387–1574 on 2027, 2 and 4); research stalls under 10 min on 2, 3, 4.

Idle CPU (390×844, headless, 30 s × 3, no trains): P5 the same as P4 with a research running and with none (2.9–3.7%
against 2.8–3.6%, 0 frames); figures in the plan's P5 note.

## 6. Saves

- `SAVE_VERSION` goes to 12. Older saves are turned away with `OLDER_SAVE` and kept aside under their backup key,
  with today's kind toast.
- Mapping learned blueprints across would be cheap (the ids stay), but an old map has no school and its board and
  offers mean nothing now. As agreed, we discard old saves instead.
- P3 (the growth menu) goes to 13, and a v12 save carries over (`MIGRATES_FROM`): the map's shape didn't change, so it
  loads as it is; in the progress, each waiting town offer (two blueprints, a crate) is drawn again as three cards for
  its town's level now, once the map is in (`redrawOldOffers`). Coins, learned, the board, research, the toy box and
  orders stay. Older than 12: turned away and kept aside as before.

## 7. The research picker on a phone

- **The Blueprints button becomes Research,** and the board's web stays as the picker.
- **New card states:** learned · researching · next up · ready · locked · soon. These replace offered and ready.
- **A ready card shows:**
  - its goods as chips, such as "🪵 6/10 · 🌾 0/6 · 🪙 20";
  - its study time;
  - one button: **Research** when the school is idle, otherwise **Next up**.

  One tap, and tapping again swaps it.
- **The HUD gets a small pill while research runs**, for example "📘 Bridges 6/10🪵". Tap it to open the picker.
  - It redraws only when a delivery or the study timer changes it, so there is no per-frame work.
  - When nothing is picked, the pill says "Pick research".

## 8. Decisions (the user, 2026-10-18)

1. **Where the research building goes: a depot on your line beside a town** (a site rule), not a landmark on the
   town's lots (b) or a depot anywhere (c). It gives a reason to grow towns, shares lines with passengers, and
   reuses depots and site rules with no work on lots or roads.
2. **Pacing: one research at a time, plus a Next up slot**, not a full queue or one per school. Simple on a phone,
   and the school never sits idle.
3. **Coins: part of the price from tier 2**, as today's prices are; tier 1 is goods only, and coins can't hurry
   missing goods. Coins stay a sink (the coins-at-180 band), and deliveries stay the point of research.
