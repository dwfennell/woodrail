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

  | Tier | Examples (goods; coins from tier 2 only, at today's prices) |
  | --- | --- |
  | 1 | Switches 4🪵 · Signals 8🪵 · Bridges 10🪵 · Farming 12🪵 · Passengers 10🪵 |
  | 2 | Mills 12🪵 6🌾 · Routes 10🪵 20🪙 · Goods engine 12🪵 6🍞 40🪙 · Diesel 14🪵 8🍞 60🪙 |
  | 3 | Quarries 16🪵 10🍞 · Mines 12🪵 10🪨 · Foundry 10🪨 10⚫ · Electricity 10🔩 10⚫ 120🪙 |

  - **Coins:** tier 1 costs goods only (Halts loses its 20🪙). From tier 2, a research keeps today's coins. They are
    paid when it starts; a pick you can't pay for yet waits in Next up (its card says how many coins are short).
    Coins never stand in for goods.
  - The exact numbers are tuned with the play-through (plan P5).

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

| Measure | Today | Target |
| --- | --- | --- |
| First research done (Switches) | (new) | **by minute 8** |
| Longest research stall (one picked, no goods into a school) | (new) | **under 10 min** |
| Research done at minutes 60 / 120 / 180 | (new) | logged; 180: at least as many blueprints as today |
| City minute | 84–123 | each seed within ±15% of today |
| Coins at 180 | 124–653 | **150–600**, no seed under 100 |
| Longest stretch with no planks into a town | 41–77 min | no worse on any seed |

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

## 6. Saves

- `SAVE_VERSION` goes to 12. Older saves are turned away with `OLDER_SAVE` and kept aside under their backup key,
  with today's kind toast.
- Mapping learned blueprints across would be cheap (the ids stay), but an old map has no school and its board and
  offers mean nothing now. As agreed, we discard old saves instead.

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
