# Research: a school you deliver to, and growth that gives resources

Date: 2026-10-18. Status: design, for review. Game mode only.

## What the user asked

> I don't love how levelling up cities gets you free techs. I think it should always give you a choice of resources,
> and all techs should be researchable. I am coming around on the idea of a research building you deliver resources to.

And later: "I think the research building should be placed near a town though, maybe." (A leaning, not a rule.)

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

  | Tier | Examples (goods, plus coins where today's price has them) |
  | --- | --- |
  | 1 | Switches 4🪵 · Signals 8🪵 · Bridges 10🪵 · Farming 12🪵 · Passengers 10🪵 |
  | 2 | Mills 12🪵 6🌾 · Routes 10🪵 20🪙 · Goods engine 12🪵 6🍞 40🪙 · Diesel 14🪵 8🍞 60🪙 |
  | 3 | Quarries 16🪵 10🍞 · Mines 12🪵 10🪨 · Foundry 10🪨 10⚫ · Electricity 10🔩 10⚫ 120🪙 |

  Coins are paid when a research starts. The exact numbers are tuned with the play-through.

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

## 8. Open questions

1. **Where does the research building go?**
   - (a) A depot on your line beside a town, using a site rule.
   - (b) A landmark on the town's own lots, fed through the town's station.
   - (c) A depot anywhere, like the workshop.

   **Recommend (a).** It gives a reason to grow towns, and research trains share passenger lines. It reuses depots
   and site rules, so there's no work on lots or roads. (b) splits one station's deliveries between growth and
   research, which is hard to read. (c) loses the link to towns.
2. **One research, a queue, or one per school?**
   - (a) One at a time, plus a Next up slot.
   - (b) A full queue.
   - (c) Each school researches its own blueprint.

   **Recommend (a).** It's simple to read on a phone, and the school never sits idle. (c) adds a decision per school
   and splits deliveries.
3. **Do coins buy research?**
   - (a) Goods only.
   - (b) Coins are part of the price from tier 2, as today's prices are.
   - (c) Coins can also hurry the goods still missing.

   **Recommend (b).** Coins stay a sink, which keeps the coins-at-180 band. (c) would let coins skip the deliveries,
   which are the point of research.
