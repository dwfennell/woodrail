# Town Treats and Paint Shop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give late-game coins somewhere to go that a child wants. That means two things:
- **A. Town treats.** A town's card gets a Treats row. You buy a bandstand, a fountain, a clock tower, a fair or a statue
  of your first engine, and it goes up in that town.
- **C. Paint shop.** An engine's card gets a paint pot. You can buy a new livery for it and give it a name board.

Both are looks and goals only. They never change what anything pays.

**Source:** the coin-sinks proposal of 2026-10-24 (options A and C) and its local harness diff (`BALANCE_SINK`). Neither
is committed. The parts this plan needs are copied here: the price curve, the gating and the expected table.

**Architecture:**
- **A treat is a town building.** It is one `Building` whose `landmark` field holds a treat id, so the save, dressing,
  street plans and move guards that landmarks already have cover it. The table lives in a new `src/game/treats.ts`,
  apart from `LANDMARKS`, so growth never puts a treat up by itself.
- **The map is the record.** A town has bought what stands in it. The price counts the treats standing on the map.
  There is no new progress field and no second count that could drift.
- **Buying is growth by one lot.** `TownLife` puts the treat up with the lot logic growth already uses (`nextLots`,
  then `buildOnLots`, `addTownProps`, `editLand`). Only that town's new building and plots are drawn again.
- **Moving parts follow `ClockView`.** The fountain's jets, the fair's pennants and carousel, and the clock tower's hands
  are live parts (`PROP_LIVE_PARTS`). They are posed only on frames that are drawn anyway.
- **A livery is a colour map on a car.** The car's modelled body and trim colours are swapped for the livery's in
  `blenderCar`, through `mats.lacquer`, which is already cached by colour. Livery and name are saved on the car. Only
  the repainted car's model is rebuilt.

**Tech Stack:** TypeScript, Three.js, Zod, Vitest, Playwright (e2e), Blender (`tools/blender`).

## Global Constraints

- **Each phase ships on its own.** It passes `npm test`, `npm run typecheck` and `npm run build`, has its own tests, and
  a new game stays playable.
- **No `SAVE_VERSION` bump** (it stays 13). Every new field is optional. A v12 or v13 save, and the
  `src/persist/fixtures/v12-game.json` fixture, load with nothing bought and every car as it came.
- **No coin effect.** `payFor`, `MARKET_BONUS` and growth are untouched. A treat never counts as a landmark for a
  blueprint's `requires`, and never counts as the market.
- **Performance (AGENTS.md):**
  - Buying is one tap: one `nextLots` call for one lot, then building and drawing one town's plots. It is never done
    per frame or per pointer move.
  - The card's Treats row and the paint sheet redraw on a key built from their inputs, never per frame.
  - Moving parts add no frames: an idle game with a fountain in view draws 0 frames.
  - Each phase measures before and after, and the commit records the numbers: idle CPU, frame time while panning, and
    the buy or repaint time.
- **Player text is short and clear to a child:** plain words, no jargon, one idea a line, and towns named
  ("Larkfield"). All of it is in this plan. Change it here first if it changes.
- **Phone layouts:** 360×780, 390×844 and 667×375 (on its side). Tap targets are at least 44 px (40 px on the
  slim footer at 667×375, as today).
- **Balance:** P1 and P5 each measure the seed table (`BALANCE=1`, seeds 2027, 1–6, 9, 10) and record it in the
  commit.

## Review Focus

- **Treats are not landmarks.**
  - `townLandmarks` and `landmarksOf` return only `LANDMARKS` ids.
  - `dueLandmarks` never returns a treat.
  - The market bonus is still read from `"market"` only.
- **No coins are taken without a treat standing.** The order is: check the gates, find the lot, build, and only then
  take the coins. If there is no room, nothing changes at all, coins included.
- **Only that town is touched.**
  - The treat's lot carries no `changes`, so no house becomes a shop.
  - The props store gains exactly one prop.
  - `editLand` gets only that town's plots.
- **The price comes from the map:** `treatPrice(treatsOnMap(land))`. Undo and reload can't make it drift.
- **Research comes first.** While `coinsShort(progress) > 0`, Buy and Paint are blocked, and the row says why.
- **Live parts draw nothing on their own.** They are posed after `Game.frame`'s idle return, and never set `active` or
  call `invalidate()`.
- **Repainting rebuilds one car.** The car's materials come from the lacquer cache, and nothing new is created per
  colour.

---

## Data model (all phases refer to this)

### Treats: `src/game/treats.ts` (new)

```ts
export type TreatId = "bandstand" | "fountain" | "clock-tower" | "fair" | "statue";
export interface Treat {
  readonly id: TreatId;
  readonly name: string;          // "Bandstand"
  readonly level: 2 | 3 | 4;      // a Town takes it from level 2, a City from 3, a City ★ from 4
  readonly blurb: string;         // one line for the card
  readonly icon: string;          // fallback picture, until its thumbnail is drawn
  readonly models: Landmark["models"]; // the same { four?, two, one } shape that townProps already reads
}
export const TREATS: readonly Treat[];
export const treatOf = (id: string): Treat | undefined;
export const treatsFor = (level: number): Treat[];     // level 2: 2 treats, 3: 4, 4 and up: 5
export function townTreats(town: Town): Set<TreatId>;  // from town.buildings[].landmark
export function treatsOnMap(land: Landscape): number;  // the count the price curve uses
export const treatPrice = (onMap: number): number => 100 + 50 * onMap;
export const TREATS_OPEN_LEVEL = 3;                    // sold once progress.bestLevel >= 3
export type TreatState = "have" | "buy" | "short" | "saving" | "locked-level" | "closed";
export function treatRow(world: World, p: Progress, town: Town, level: number): TreatRowView; // the card's view, pure
export function hasAllTreats(town: Town, level: number): boolean; // the rosette, and the goal
```

| id | name | level | lot | model (P1 stand-in → P2) |
| --- | --- | --- | --- | --- |
| `bandstand` | Bandstand | 2 | 1 square | `scene-bandstand` (drawn at 0.85: see Task 2.3) |
| `fountain` | Fountain | 2 | 1 square | `scene-fountain` |
| `clock-tower` | Clock tower | 3 | 1 square | `scene-clock-post` → **`bldg-clock-tower`** (new, Blender) |
| `fair` | Fair | 3 | 2×2, else 2 squares | `scene-market-stall` → **`scene-fair`** (2×2) / **`scene-fair-row`** (2 squares) (new) |
| `statue` | Engine statue | 4 | 2 squares | `scene-statue` → **`bldg-engine-statue`** (new, Blender) |

- **The bought state is per town.** A town's treats are its buildings whose `landmark` is a treat id.
- **The global count** is `treatsOnMap(land)`, a sum over the towns. It is asked for only when the card opens or a
  treat is bought, so it needs no cache: 5 towns of about 30 buildings each.
- **`landmarks.ts` changes.** `townLandmarks` filters to `landmarkOf(id)`. `townProps` (`src/props/towns.ts`) looks
  up `landmarkOf(id) ?? treatOf(id)` for the models. Everything else keyed on `Building.landmark` already does what a
  treat wants:
  - `grow-town.ts` never changes it into a shop;
  - `town-moves.ts` won't move it ("The town's landmarks stay where they are");
  - `interaction.ts` won't pick it up in Game mode.

### Liveries and name boards: `src/game/paint-shop.ts` (new)

```ts
export type LiveryId = "red" | "green" | "royal" | "yellow" | "plum" | "black" | "gold";
export interface Livery { id: LiveryId; label: string; body: string; trim: string; price: number; gold?: true }
export const LIVERIES: readonly Livery[];      // 60 each; gold 400, from progress.bestLevel >= 4
export const PAINT_OPEN_LEVEL = 2;             // the paint pot shows from the first Town (open question 6)
export const NAME_MAX = 12;
export function paintState(p: Progress, id: LiveryId): "paint" | "short" | "saving" | "locked" | "have";
export function paint(world: World, p: Progress, carId: number, id: LiveryId | null): PaintResult; // null: as it came, free
export function rename(world: World, carId: number, name: string): void;                            // free
```

- **On the sim:** `src/sim/sim.ts` gets `liveries` and `names` maps next to `looks`, with `setLivery`, `liveryOf`,
  `setName` and `nameOf`. They are cosmetic. The sim never reads them, but they follow the car's id the way its look
  does.
- **Carried by hand and undo:** `interaction.ts` (the car snapshots at about lines 4059, 4118 and 4143) also carries
  `livery` and `name`, so picking a train up and putting it down keeps its paint.
- **Drawn:** `train-models.ts` gets `LIVERY_SLOTS: Record<CarLook, { body: string[]; trim: string[] }>`, the modelled
  hex colours of each engine look (from `tools/blender/trains.py`):
  - classic: body `#2d6b3f`, trim `#c8442f`;
  - goods: body `#1f4a2e`, trim `#c8442f`;
  - tank: body `#2f6db5`, trim `#c8442f`;
  - diesel: body `#e6b52c`;
  - electric: body `#c8442f`, trim `#f0ebe0`;
  - express: body `#1f5aa6`, trim `#e6b52c`.

  `buildCarModel(kind, mats, variant, look, livery?)` turns the livery into the `recolor` map `blenderCar` already
  takes. Gold uses one shared `mats.gilt` (a metallic lacquer, made once).
- **Name board:** a small plaque on each side of the cab. It is a `CanvasTexture` cached by its text (a 256×64 canvas,
  shared by engines with the same name) and released with the car. Unnamed engines have none.

---

## P1: treats data, the buy flow and placement (catalogue stand-ins)

**Size:** 2 days. **Ships:** a City's card sells treats, and a bought treat stands in its town, using today's catalogue
models as stand-ins. **QA:** grow Larkfield to a city, buy all four treats, reload, and they are still there.

### Task 1.1: the table and the rules (`src/game/treats.ts`)
- [ ] `TREATS`, `treatOf`, `treatsFor`, `townTreats`, `treatsOnMap`, `treatPrice`, `hasAllTreats`, as in the data model.
- [ ] `treatRow(world, p, town, level)` returns `{ open, cards: { id, name, blurb, icon, state, price, why }[], selected
  }`. It is pure, and the card draws it. The states, in order:
  - `closed`: `p.bestLevel < 3`, so no town is a City yet;
  - `have`: the town has it;
  - `locked-level`: its level is above the town's;
  - `saving`: `coinsShort(p) > 0`;
  - `short`: `p.coins < price`;
  - otherwise `buy`.
- [ ] `townLandmarks` (`landmarks.ts`) filters to `LANDMARKS` ids, and `townProps` looks up treats' models.
- [ ] Tests (`treats.test.ts`):
  - prices 100, 150 … 550 for 0 to 9 on the map;
  - `treatsFor` gives 0, 0, 2, 4 and 5 treats at levels 0 to 4, and 5 above that;
  - every state, including `saving` winning over `buy`;
  - `closed` until any town is a City;
  - a treat's building is not in `landmarksOf` or `landmarksAt`, and `dueLandmarks` never returns a treat.

### Task 1.2: putting it up (`src/game/town-life.ts`)
- [ ] Split `TownLife.grow`'s tail (build on the lots, swap any changed props, `addTownProps`, `editLand`,
  `propsChanged`) into a private `raise(town, lots)`. `grow` calls it, and its behaviour doesn't change.
- [ ] Add `TownLife.addTreat(town, treat): { x: number; z: number } | null`:
  - It asks `nextLots(land, town, editor, 1, { wide: lot >= 2 ? 1 : 0, big: lot === 4 ? 1 : 0 })`.
  - It takes the first lot that fits one of the treat's models (`fitScale`), the same way `grow` places landmarks.
  - It sets `lot.landmark = treat.id` and drops `lot.changes` (buying a treat changes no other house).
  - Then it calls `raise`.
  - It returns the lot's point (`lotPoint`), or `null` with nothing changed when no lot fits.
- [ ] A fair that finds no 2×2 block takes two squares (`models.two`). It never takes one square.
- [ ] Tests (`treats-place.test.ts`, using `growToCity` and `noRoomForBlocks` from `town-testing.ts`):
  - the treat stands in that town on squares it owns;
  - the props store gains exactly one prop, carrying the building id;
  - no other building's `kind`, `floors` or prop changes;
  - `editLand` gets only that town's plots;
  - with no room (the town boxed in by track and other towns), `addTreat` returns `null` and the grid, buildings and
    props are byte-equal to before;
  - a treat never becomes a shop on later growth (`grow-town.ts`), and can't be moved (`town-moves.ts`).

### Task 1.3: buying (`treats.ts` and `main.ts`)
- [ ] `buyTreat(life, world, p, town, id)` returns `"bought" | "no-room" | "saving" | "short" | "locked"`. It checks
  the state, calls `addTreat`, and only then takes `treatPrice(onMap)` coins.
- [ ] In `main.ts`, Buy from the card does this:
  - calls `buyTreat`;
  - on `bought`, notes a milestone (toast and Journal, at the lot), schedules the save, saves progress, and checks the
    goals;
  - on `no-room`, shows a refusal toast, which is not logged.
- [ ] Tests (`treats.test.ts`):
  - coins go down by the price only on `bought`;
  - the next price is 50 more;
  - `no-room` and `saving` take nothing.

### Task 1.4: the Treats row on the town card
- [ ] In `src/ui/town-ledger.ts`, add `drawTreats(box, view, on)` and a `.ledger-treats` element. It goes after the
  goods bars and before the school, market and station rows. It is a separate element with its own key
  (`treatsKey`: the town's treat ids, `treatsOnMap`, `bestLevel >= 3`, the town's level, `coinsShort > 0`, and
  whether the selected treat is affordable, as a boolean and not the coin count). So a delivery's coins don't rebuild
  the whole ledger.
- [ ] A row of 2 to 5 pictures, 56×56 px each (48 at 360 px wide), with the name under each:
  - **Bought:** a ✓ badge.
  - **Locked by level:** greyed, with a 🔒.
  - **Before any City:** all greyed, with one line under them.
- [ ] Pictures: an emoji fallback first (🎺 ⛲ 🕰️ 🎠 🗿). From P2, a catalogue thumbnail: `ThumbnailStudio` gets a
  `{ kind: "prop", asset }` subject, drawn once per treat and cached as a data URL.
- [ ] **Tap a picture to select it.** The line under the row shows its name, blurb and price ("🪙 150"), or why it
  can't be bought.
- [ ] **The pinned action row.** The depot card's sticky footer (`.depot-card:has(.depot-extra.ledger) > .card-row`)
  gains a Buy chip beside Automatic while a buyable or short treat is selected:
  - "Buy 🪙 150", 44 px tall, or 40 px on the 667×375 slim footer;
  - disabled when the treat is `short` or `saving`, with the reason in the line above.
  - Only one Buy shows at a time. With nothing selected, the first buyable treat is selected when the card opens.
- [ ] Layout:
  - **360:** 4 pictures at 48 px with 8 px gaps fit in 336 px, and a fifth wraps to a second row (City ★ only). The
    footer holds Automatic and Buy side by side, with the label shortened to "🪙 150".
  - **390:** 5 at 56 px in one row.
  - **667×375:** the row sits under the goods, inside the scrolling ledger, as a scroll-snap stop
    (`scroll-snap-align: start`). The footer's ✕ stays at its left, and Buy goes to the right of Automatic.
- [ ] Tests (`hud-board.test.ts` or a new `town-treats-card.test.ts`):
  - the row's states;
  - the key doesn't change when only coins change and affordability stays the same;
  - Buy is disabled while saving, and its line names the research.

### Task 1.5: the harness buys for real (`src/play/balance.test.ts`)
- [ ] Bring over the diff's `sink()` as `BALANCE_SINK=treats` (default off in P1). Its pure-cost buy becomes the game's
  `buyTreat`:
  - it buys from the first City only;
  - it keeps a reserve (`BALANCE_SINK_RESERVE`, default 200);
  - it doesn't buy while a research waits on coins;
  - it picks the town with the highest level first, then its first `buy` treat.
  - A `no-room` is counted in SUMMARY as `noRoom`. The diff's `BALANCE_LOOP_UNPIN` hunk is dropped: main already
    leaves loops unpinned (`BALANCE_LOOP_PIN`).
- [ ] Keep the diff's `SUMMARY sink` line (`sinkN`, `sinkCoins`, at120, at150, at180, log), and add `noRoom`.
- [ ] Measure, with `BALANCE_SINK` off and on, against main 52ce3d8, and record both tables in the commit.

---

## P2: models and motion

**Depends on:** P1. **Size:** 2 days. **Ships:** every treat in its own model, the fountain and fair moving while the
view is drawn, and the clock tower showing the game's time. **QA:** buy each treat, pan past it (it moves), let go
(0 frames drawn).

### Task 2.1: new models
- [ ] **`bldg-clock-tower`**, in `tools/blender/bldg_town.py`, in the buildings set:
  - a square brick tower on one square, about 56×56 mm and 150 mm tall, with a slate pyramid roof and a gold ball;
  - four faces, built with `bldg_parts.clock` so the hands are the nodes `hour` and `minute`, as the station clock's
    are.
  - Add it to `ASSETS`, then run `npm run models`.
- [ ] **`bldg-engine-statue`**, in `bldg_town.py`:
  - a stepped stone plinth, about 120×48 mm, with the classic engine on it in bronze (`C.bronze` `#6f7d5c`);
  - built by calling `trains.engine_classic` with a paint override, so the model stays one source. Add a
    `toy.repaint({...})` context that maps every `paint(...)` colour to bronze.
  - It lies along a two-square lot, with its front on the long side (`frontAxis` in `poseFor`).
  - Open question 2 asks whether it should be the player's first engine as painted.
- [ ] **`scene-carousel`**, in `src/catalogue/assets/scenery.ts` (a Kit code model, as the other `scene-` props are):
  - a round striped canopy on a centre pole, with four horses on twisted poles;
  - its moving node, `spin`, turns, and `horse0` to `horse3` bob;
  - `animate` poses them, as `scene-playground` does.
- [ ] **`scene-fair`** (2×2) and **`scene-fair-row`** (2 squares), in `scenery.ts`. Both are built from the existing
  builders, found by id in `ASSETS`:
  - `scene-fair`: bunting across the front, two `scene-market-stall`s, and the carousel;
  - `scene-fair-row`: bunting and two stalls, with no carousel;
  - their `animate` calls the parts' own.
- [ ] Add every treat model's ground box to `BOX` in `src/props/towns.ts`, measured. Add them to `townModels()` so the
  fit tests cover them.

### Task 2.2: swap the stand-ins
- [ ] Each `TREATS` row's `models` lists its new model first and the stand-in after, as `Landmark.models` does. A town
  dressed before P2 keeps its stand-in props until it is redressed. Note that `addTownProps` adds only missing props.
- [ ] Decide in the code review whether a one-off `redressTreats` should run on load. Keep it small: it would remove
  and re-add props whose building is a treat and whose asset isn't the treat's first fitting model.

### Task 2.3: fitting
- [ ] The bandstand's roof is 80 mm across, more than a square's 70 mm of room. Draw it at 0.85
  (`BUILDING_SCALE["scene-bandstand"]`), and let `fitScale`'s floor be `min(1, scaleOf(asset))` instead of 1, so a
  model scaled below 1 can still fit. Check that `scaleOf` reaches `scene-` assets (today it is applied in
  `buildings.ts`), and apply it in `PropLibrary` if not.
- [ ] Tests (`towns-fit.test.ts`):
  - the new boxes match the models;
  - with every treat bought in every town grown to a city (blocks on and off), nothing hangs over its squares.

### Task 2.4: moving parts only on drawn frames
- [ ] `PROP_LIVE_PARTS` (`src/render/props/library.ts`) gains these entries:
  - `scene-fountain`: `jet`, `spray`;
  - `scene-fair`: `spin`, `horse*`, `pennant*`;
  - `scene-fair-row`: `pennant*`;
  - `bldg-clock-tower`: `hour`, `minute`.

  Each is drawn bare by `PropsView`, with its parts in a small live group, as the station clock is.
- [ ] **The clock tower:** `ClockView` keys on a set, `CLOCK_ASSETS = { "bldg-station-clock", "bldg-clock-tower" }`,
  not on one asset. Its hands tick on the game minute as today, and it draws a frame only when a clock is in view.
- [ ] **New `src/render/treat-motion-view.ts` (`TreatMotionView`):**
  - `sync(props, hidden)` is keyed on `props.version` and keeps a live group per moving treat prop.
  - `pose(now, camera)` calls the asset's own `animate(group, now)` on each group in the frustum within `detailReach`,
    and nothing else.
  - `Game.frame` calls `pose` after the idle early return (`now - this.lastActive > IDLE_TAIL`) and before
    `post.render`. So it runs only on a frame being drawn anyway: a camera move, a train, or an `invalidate()`.
  - It never sets `active`, never calls `invalidate()`, and its parts cast no shadow (the shadow map isn't redrawn for
    them).
- [ ] Tests (`treat-motion-view.test.ts`):
  - `pose` is not called on an idle tick (spy on it through a `Game`-less harness, as `clock-view.test.ts` does);
  - a group out of view isn't posed;
  - `sync` with an unchanged version does nothing.

---

## P3: the rosette and the goal

**Depends on:** P1 (P2 is not needed). **Size:** 1 day. **Ships:** a rosette on the map view for a town with all its
treats, and the goal "Give a city all its treats". **QA:** buy a city's last treat: the toast, the goal ticks, and the
rosette shows on the map.

### Task 3.1: the rosette (`src/game/map-markers.ts`, `src/ui/map-view.ts`)
- [ ] `MapMarker` gets `rosette?: true`. `mapMarkers` sets it for a town where `hasAllTreats(town, level)`.
- [ ] `MapView.show`'s key adds `R` for a rosette, so the label is built again only when that changes.
- [ ] The label shows 🏵️ before the town's name, and its detail line ends "· all its treats". On the 667×375 strip the
  compact label keeps the 🏵️ and drops the detail.
- [ ] The town card's title also reads "Larkfield 🏵️".
- [ ] Tests (`map-markers.test.ts`, `map-view.test.ts`):
  - the flag is set by level (a City with all 4, a City ★ with all 5);
  - the key is unchanged with no change.

### Task 3.2: the goal (`src/game/goals.ts`)
- [ ] `id: "all-treats"`, placed last, after `join-all`. It has no `needs`, because `needs` takes only blueprints. Until
  any town is a City, it shows its waiting hint.
- [ ] `check`: done when some town at level 3 or above `hasAllTreats`. Its count is the best city's treats against its
  level's total, with unit `"treats"`. It reads only the world, so it holds after a reload.
- [ ] `guide`: it frames the city closest to done (or the biggest town before any City), lists it in `towns`, and sets
  `card` to that town's station depot id, so Show me opens the town card on its Treats row.
- [ ] A treat bought calls the goal check, as a delivery does. The goal ticks off as an open goal.
- [ ] Tests (`goals.test.ts`, `goal-ticks.test.ts`):
  - it is placed last;
  - it is not done with 3 of 4;
  - it is done with 4 of 4;
  - the waiting hint shows before a City;
  - Show me's `card` is the station depot.

---

## P4: the paint shop

**Depends on:** P1 only for the shared block (`coinsShort`). **Size:** 2 days. **Ships:** a paint pot on the engine card,
seven liveries, a name board, and both saved. **QA:** paint the engine royal blue, name it "Puffin", reload: it is
still blue and named. Pick it up and put it down: the same.

### Task 4.1: data, sim and save
- [ ] `src/game/paint-shop.ts` as in the data model. `paint()`:
  - checks `paintState`;
  - sets `sim.setLivery`;
  - takes the coins;
  - "As it came" (`null`) is free and clears the livery.
- [ ] The sim's `liveries` and `names` maps go with the car: they are cleared when the car is removed, and carried by
  hand and through undo (`interaction.ts`).
- [ ] Save (`src/persist/save.ts`): `trainSchema`'s car gets two fields, saved only when set:
  - `livery: z.enum(LIVERY_IDS).optional()`;
  - `name: z.string().min(1).max(NAME_MAX).optional()`.

  Load sets them. There is no version bump.
- [ ] Tests (`paint-shop.test.ts`, `save.test.ts`, `undo-train.test.ts`):
  - the prices;
  - gold locked until City ★;
  - `saving` and `short` take nothing;
  - a round-trip keeps the livery and name;
  - an old save (the v12 fixture) loads with neither;
  - picking a train up and undoing keeps both.

### Task 4.2: drawing it
- [ ] `LIVERY_SLOTS` and the livery argument in `buildCarModel`, as in the data model. Every engine look has an entry
  (a test lists `CAR_LOOKS.engine`).
- [ ] `TrainView` gets `liveryOf` and `nameOf` (set in `game.ts` beside `lookOf`) and `repaint(carId)`. That call
  disposes that one car's model (`disposeObject`) and builds it again on the next `update`. It is called only from
  `paint()` and `rename()`, which also call `invalidate()`. It is never looked at per frame.
- [ ] The name board plaque, with its texture cached by its text.
- [ ] Measure: the repaint time (target under 10 ms on desktop, under 40 ms with a 4× CPU throttle), and that the
  number of lacquer materials grows by at most the new colours used.
- [ ] Tests (`train-models.test.ts`):
  - the same livery on two engines shares the same material instances;
  - `repaint` rebuilds only that car.

### Task 4.3: the paint pot and its sheet
- [ ] **The 🎨 paint pot:**
  - a corner button on the engine card, top left, opposite ✕, 44 px;
  - shown in Game mode once `bestLevel >= PAINT_OPEN_LEVEL`;
  - it opens the paint sheet.
- [ ] **The paint sheet** (`src/ui/paint-sheet.ts`), a bottom sheet like `growth-sheet.ts`:
  - the title;
  - a grid of round swatches (56 px, 4 to a row at 360 and 390), with "As it came" first;
  - the name board field;
  - the pinned action row at its foot: Paint and ✕.

  The selected swatch previews on the engine card's title chip (a colour dot), not on the 3D engine, so there is no
  rebuild before you pay.
- [ ] **667×375:** the sheet docks at the right like the cards, with `max-height` and its own scroll. The action row is
  sticky at the foot. When the name field is focused, `visualViewport` keeps the field and the row above the keyboard.
- [ ] **Its key:** the livery, the name, `bestLevel >= 4`, `coinsShort > 0`, and whether it is affordable at 60 and
  at 400.
- [ ] Tests (`paint-sheet.test.ts`):
  - the swatch states;
  - Paint disabled while saving or short;
  - the name trimmed to 12 and saved on Done;
  - the key unchanged when only coins change within a band.

---

## P5: balance and harness

**Depends on:** P1 (P4 for the optional paint rule). **Size:** 1 day. **Ships:** `BALANCE_SINK=treats` on by default in
the play-through, and the coin band required. **QA:** `BALANCE=1` passes on all nine seeds.

### Task 5.1: the default rule
- [ ] Treats are bought by the simulated player by default:
  - from the first City;
  - with a reserve of 200;
  - not while a research waits on coins;
  - through `buyTreat`, so placement runs.

  `BALANCE_SINK=` (empty) turns them off, for A/B runs. Unlike the diff's rule, the City ★ statue slot is counted, so a
  City ★ takes 5 treats.
- [ ] **Paint (optional, off by default):** `BALANCE_SINK=treats,livery` buys one livery (60) per engine from the first
  Town, under the same reserve and research rule. It is recorded in SUMMARY. Don't let it into the bands unless
  measured.

### Task 5.2: the bands (`checkBands`)
- [ ] Move "coins at 180 within 150–600" from nice to have to required (`expect.soft`), but only while treats are on.
  With `BALANCE_SINK=` it stays nice to have.
- [ ] Add the guards the proposal names:
  - City minute no later than with treats off on the same seed (they are sold only after the first City, so it must
    not move);
  - City ★ no more than 5 min later than with treats off;
  - town gap still under 45 min;
  - `noRoom` printed (it is not a band).
- [ ] **Expected** (the proposal's "A treats, after first City" row, on c34f3b7 with a pure-cost rule; P1 re-measures
  on 52ce3d8 first):

| Seeds 2027/1/2/3/4/5/6/9/10 | coins @120 | coins @180 | in 150–600 | bands |
|---|---|---|---|---|
| main (no sink) | 470/647/461/1031/898/679/633/163/1134 | 1560/1455/1086/1503/1144/1171/1394/843/1828 | 0/9 | 9/9 |
| A from a Town (rejected) | 341/91/238/380/63/248/184/66/434 | 219/267/307/525/71/221/271/416/478 | 8/9 | 7/9 (seeds 2027, 4, 9) |
| **A after first City (this plan)** | 220/197/211/31/198/229/79/63/434 | 210/455/386/503/444/471/345/393/478 | **9/9** | **9/9** |

  - Treats soaked 450–1350 per seed: 3–6 bought, the first at minute 67–109 and the 2nd to 6th at minutes 80–180.
  - Coins dip to 1–80 now and then (seed 10 at 150, seed 3 at 120), but no band is blocked.
  - Expect a little more soak than the table, from the fifth (statue) slot. Expect a few `noRoom` on crowded seeds,
    which buy less.
- [ ] Record the full seed table, on and off, in the commit, with each seed's SUMMARY sink line.

---

## Tests and measurements (all phases)

**Unit:** listed in each task. In short:
- prices and the curve;
- gating: closed, level, saving and short;
- placement in one town only, and a no-room case that changes nothing;
- treats are not landmarks;
- treats can't be moved or turned into shops;
- the save round-trip (treat buildings, livery, name) and the v12 fixture;
- goal order, check and guide;
- the rosette key;
- livery colour maps and the material cache;
- live parts posed only on drawn frames.

**e2e, `npm run e2e:treats` (`tools/e2e/town-treats.mjs`, modelled on `growth-menu.mjs`):**
1. At 390×844, touch: through `window.woodrail`, grow Larkfield to a city (`grow` as `school-growth.mjs` does) and give
   coins. Open its card. The Treats row shows 4 pictures, each 44 px or more, and Buy is in the pinned footer, in view
   without scrolling.
2. Buy the bandstand. Check:
   - the toast "Larkfield has a bandstand!";
   - coins down by 100, and the next price 150;
   - a prop with the treat's building id stands in Larkfield;
   - a Journal entry.
3. Set a research waiting on coins. Buy is disabled, and the line names it.
4. Buy the other three. Check the rosette on the map view, the goal ticked, and the card title's 🏵️.
5. Paint the engine royal blue and name it "Puffin". Check that the engine's body material colour is royal blue's `#2a4fb0`.
6. Reload. The treats, rosette, livery and name are all as before.
7. Run 1 to 6 again at 667×375. Buy and Paint are reachable on the slim footer and sheet, and nothing is clipped.
8. Take a 360×780 screenshot of the card and sheet, for layout review.
9. **Idle:** 30 s with the fountain and fair in view and no trains: `framesDrawn` goes up by 0. A camera pan: the
   fountain's `jet` scale differs between two drawn frames.

**Measurements (each in its phase's commit, swiftshader, 390×844):**
- **Idle main-thread busy time,** 30 s × 3, no trains. Before and after, and with every treat in view. It should stay
  within noise of P1's baseline.
- **Frame time while panning,** with 0 and with 5 fountains and fairs in view, over 120 drawn frames (median and p95).
- **Buy time** (from tap to treat drawn), on desktop and with a 4× CPU throttle as a stand-in for a phone. Target
  under 50 ms throttled, since it is a tap and not a drag. Repaint time likewise (under 40 ms).
- **Draw calls:** `PropsView.drawCalls` is unchanged by bought treats (the same materials). Live groups add one each
  per moving treat in view.

---

## Open questions for the user

1. **Names and pictures.** Bandstand, Fountain, Clock tower, Fair and Engine statue, with these blurbs. Keep them, or
   rename?
2. **The statue.** Should it be the classic engine in bronze (the starter engine is always classic: proposed), or
   your first engine as it is now, in its look and livery? The second needs the statue built from the train models at
   run time, not baked.
3. **The rosette at City ★.** "All its treats" grows to 5 when a city gets its star, so its rosette would go until the
   statue is bought. Is that OK, or should the rosette stay once won, with a ★ added for the statue?
4. **Liveries.** Post-box red, Forest green, Royal blue, Sunny yellow, Plum and Coal black at 60, plus Gold at 400
   after City ★. Is that the right list? Should "As it came" be free? Should wagons and coaches be paintable too
   (proposed: engines only for now)?
5. **The name board.** Free with the paint pot (proposed), or a price? 12 letters at most? On the 3D cab, or on the
   card only (cheaper)?
6. **When the paint pot shows.** From the first Town (the proposal's harness), from the start, or with the
   "Paint your trains" research row?
7. **The planned blueprint rows that overlap:** `park` ("Park and bandstand"), `clock-tower`, `funfair` and
   `paint-trains` (all `plan: soon/later` in `blueprints.ts`). Remove them, reword them as treats, or leave them?
8. **The coin band.** Make "coins at 180 within 150–600" a required band once treats are on (proposed)?
9. **No room.** Is a toast on tap enough ("No room in Larkfield yet")? A check ahead would cost a `nextLots` per card
   open.

---

## Player text (all of it)

**The town card's Treats row:**
- The header: "Treats". Under it, small: "Just for fun. They make a town lovely."
- Before any City: "Treats come when a town becomes a city."
- A treat above the town's level: "When Larkfield is a city" or "When Larkfield is a city ★".
- A treat it has: "Larkfield has one ✓".
- The selected line: "Bandstand · A band plays on Sundays · 🪙 150".
- The blurbs:
  - Fountain: "Splash! Water for the town square."
  - Clock tower: "Tells the whole town the time."
  - Fair: "Bunting, stalls and a carousel."
  - Engine statue: "Your first engine, in bronze."
- Buy: "Buy 🪙 150", or "🪙 150" at 360.
- Short of coins: "Needs 🪙 40 more".
- Research waiting: "Saving for Quarries first (🪙 40 more)".

**Treat toasts and Journal entries:**
- Bought (milestone): "Larkfield has a bandstand!"
- The last one (milestone): "Larkfield has all its treats! 🏵️"
- No room (refusal toast, not logged): "No room in Larkfield yet. It needs a free spot by a street."

**The goal:**
- Title: "Give a city all its treats".
- Hint: "Buy treats on a city's card: a bandstand, a fountain, a clock tower and a fair."
- Waiting hint: "First grow a town into a city."
- Count: "2 / 4 treats".

**The map:** "🏵️ Larkfield", with the detail line "City · all its treats".

**The paint pot and its sheet:**
- The button's title: "Paint this engine".
- The sheet's title: "Paint Puffin", or "Paint this engine" while it has no name.
- The swatches: "As it came", "Post-box red", "Forest green", "Royal blue", "Sunny yellow", "Plum", "Coal black" and
  "Gold".
- Gold, locked: "Gold comes when a town is a city ★".
- The name board: the label "Name board", the placeholder "Give it a name", and the button "Done".
- Paint: "Paint 🪙 60", "Paint gold 🪙 400", "Paint (free)" for "As it came", "Needs 🪙 20 more", or
  "Saving for Quarries first".

**Paint toasts and Journal entries:**
- Painted (an event, toasted once): "Puffin is royal blue now!"
- Gold (milestone): "Puffin is gold! ✨"
- Renamed (an event, not toasted): "Your engine is called Puffin".
