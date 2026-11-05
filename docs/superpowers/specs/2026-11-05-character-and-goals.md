# Town character, something to work towards, and more on the map (2026-11-05)

Status: **design only, nothing built.** Branch `claude/design-character`. Mock-ups (390×844, drawn over the real game
by `node tools/shots/design-character-mocks.mjs`): `docs/agents/shots/design-character-*.jpg`.

The user: "do towns/cities have enough character between them? I like our mechanics but things still feel a bit
same-y... I'd like our players to be working towards something. Could also be more possibilities out on the map
too... give me some plans to spice things up."

## 0. What I found (code and a fresh map, 390×844)

**Towns are one town with different names.**
- Every town grows on the same table, `TOWN_LEVELS` (`src/game/towns.ts`): planks, then planks + flour, then
  + stone, then + iron/furniture, then + tools. Every town pays the same `PRICES`.
- The only landmark is the **Market**, the same in every town at level 2 (`LANDMARKS`, `src/game/landmarks.ts`).
- The only look that differs is the canopy, roof and bunting colour: `stationTheme(name)` hashes the name into one of
  6 themes. Every town is generated as a street with a station beside it.
- On the fresh map, Larkfield's and Elderwick's cards are word for word the same ("Hamlet · 0 of 4 goods · Planks
  0/4 · Full pay for goods it needs, half for others"). Grown to cities, all four towns have the same mix of
  townhouses, flats, kiosk and church. From the map you can tell them apart only by the canopy colour
  (`node tools/shots/design-character.mjs` takes these pictures: `look-card-0/1`, `look-city-0..3`, `look-overview`).
- The 2026-10-15 direction spec already planned "rare towns" and "specialties to discover" (§2). None of it is
  built.

**Nothing to aim at after the tutorial.**
- There are 23 core goals. They teach the game and end with "Open a harbour" (minute ~175–440).
- After that come 27 quiet stickers and the research board. The ending branch (Rocket works → Launch pad) is on the
  board marked "Not designed yet".
- The goal bar at the top is the one thing always on screen, and when the core goals are done it has nothing left
  to say.

**The map is one meadow, everywhere.**
- `generate.ts` uses one hill noise (`rawHeight`: fixed scale, threshold and `MAX_HEIGHT`) and one tree noise for
  every plot of every seed.
- Rivers come from the plots' edge stubs, and the coast lies along one side.
- What a map can hold: the 4 ruins (farm, quarry, mine, harbour; `addPlotExtras`, at most 2 a plot) and extra towns.
- Buying a plot is a choice of price only. Every plot is the same kind of land.
- The calendar exists (`calendar.ts`: a year every 24 minutes of play), but nothing reads it except the date in the
  corner.

**Rules these plans keep** (from AGENTS.md, game-mode.md and the user's earlier calls):
- Cozy: nothing fails, expires or wears out.
- The opening is the same on every map (timber → planks → workshop → towns).
- Specialize, don't lock out.
- Looks stay wooden toys. No season tints, dusk lights or steam puffs: the user said no to them.
- The cost is near zero when idle.
- Goals are reached by the player's path in the play-through.
- Player text is short and kid-clear.

---

## ★ Town paths: what you bring a town decides what it becomes (the user's pick)

**The user picked this idea to flesh out first.** It supersedes Part 1's "trades placed by the map" (1A) as the main
idea. Geography stays only as a small nudge (below).

Mock: `docs/agents/shots/design-character-leaning.jpg`. The five landmarks are real catalogue assets (see "The
assets").

### The five paths

| Path | Pushed by | Needs a place? | Landmark (asset) |
|---|---|---|---|
| 🏭 **Industrial city** | coal, ore, iron, bricks, tools, stone | no | Engine works (`path-engine-works`) |
| 🧺 **Market town** | flour, bread, milk, cheese, fruit, juice, furniture | no | Guildhall and market (`path-guildhall`) |
| 🏖️ **Resort** | riders getting off there, ice cream, juice | the sea, or a hill 2 high, within 8 squares of its station | Pier and pavilion (`path-pier`) |
| 🎓 **University city** | goods its school takes for research | its school is a College | Observatory (`path-observatory`) |
| ⚓ **Port city** | goods traded at a harbour in reach, fish | a harbour within 12 squares | Customs house (`path-customs-house`) |

### Leaning: exact rules

1. **Nothing leans before Town (level 2).**
   - Hamlets and villages grow on planks as today, so the opening is the same on every map.
   - Planks never lean a town: every town needs them.
2. **From Town on, every unit a town takes adds lean points** (`LEAN`, a table: good → path → points). Each unit is
   counted where it's unloaded (`Economy`, beside `deliveredGoods`). The points:

   | Good | Points |
   |---|---|
   | coal, ore | Industrial 2 |
   | stone | Industrial 1 |
   | iron, bricks | Industrial 3 |
   | tools | Industrial 2 |
   | flour | Market 1 |
   | bread, cheese | Market 3 |
   | milk, fruit | Market 2 |
   | juice | Market 1, Resort 1 |
   | furniture | Market 2 |
   | ice cream | Resort 3 |
   | fish | Port 2, Market 1 |
   | a rider getting off at its station | Resort 1 |
   | a unit its school takes for research (`atSchool`) | University 1 |
   | a unit sold or bought at a harbour within reach | Port 1 |

3. **Geography nudges, once.** When a town becomes a Town, it starts with 10 points on one path:
   - Port, if it's by the coast;
   - Resort, if it's by hills and has no industry within 10 squares;
   - Industrial, if it has a mine or quarry within 10 squares;
   - Market otherwise.

   Ten points is about four deliveries, so what you bring soon outweighs it.
4. **The Town hall nudges, by choice.** The board's "Town hall" (Civic, "nudge what each one grows toward") is built
   as this.
   - Learned, a town's card has "Lean towards …". The chosen path's points count 1.5×.
   - The choice can be changed any time before the town settles.
5. **Points are kept, never lost.** Goals stay met, and nothing decays.

### Settling: exact rules

1. **A town settles when it becomes a City (level 3).** It settles on the path with the most points, among those
   whose place it has (Resort, University and Port need theirs).
2. **A close call is the player's.** If the second path is within 20% of the first (Industrial 40 vs Market 46), the
   growth sheet asks: "Larkfield is a city! Which way will it grow?" It shows the two, each with its landmark and what
   it does. Otherwise the sheet says it: "Larkfield is a Market town!"
3. **No points at all** (a city grown on planks and stone alone) settles on **Market**: the game as it plays today.
4. **Settled is for good.** The path sets:
   - the landmark: it goes up as the city's next lot, through `TownLife`'s lot logic, as the Market does today;
   - the ★ wants;
   - the power;
   - looks, places and treats.
5. **Two cities may share a path.** The second's landmark is its own copy, and its power counts once more where noted
   below.

### What each path changes, in numbers

The bands stay put:
- **City (level 3) is the same for every path** (22 planks, 12 flour, 10 stone): the "City at 60–90 min" band can't
  move.
- **From City ★ on, each path has its own wants.** At ★1 each totals 77–81 units. Today's ★1 totals 82 (33 planks,
  18 flour, 15 stone, 10 iron, 6 furniture).
- **A want whose chain isn't learned yet waits as the base good.** For example, an Industrial city wants stone in
  place of bricks until Brickworks is learned. No path can stall a city.

| Path | Wants at City ★1 (then ×1.5 a star, as today) | Power once settled | Pays | Looks |
|---|---|---|---|---|
| 🏭 Industrial | 28 planks, 14 flour, 18 stone, 13 iron, 6 bricks; tools 4 from ★2 | industries within 10 squares of its station work **1.25×** (a second Industrial city: those near it too, not stacked) | iron, bricks, tools **1.25×** | brick terraces with chimneys; soot-grey and brick-red roofs; the station canopy dark green |
| 🧺 Market | 33 planks, 24 flour, 10 stone, 6 furniture, 8 bread; cheese 4 from ★2 | **2×** riders waiting at its station; the Market's half again now covers food at full pay too | foods **1.25×** on top of the Market | shops with awnings, a market square; bright mixed roofs |
| 🏖️ Resort | 26 planks, 18 flour, 10 stone, 24 riders (count half: 12), 4 ice cream, 4 juice | Jun–Aug (calendar): **3×** riders come to its station; riders getting off count toward growth | ice cream, juice **1.25×**; fares to it **1.25×** | pastel villas, bathing huts; candy-stripe canopy |
| 🎓 University | 33 planks, 18 flour, 15 stone, 8 furniture, 4 tools | every school on the map studies **1.25×** (a second: 1.35×) | — | stone halls, quads; slate roofs, deep blue canopy |
| ⚓ Port | 30 planks, 14 flour, 15 stone, 8 iron, 10 fish | harbours within 12 squares: boats pay **1.25×** and sell for **0.75×** (the old D4 trading house) | fish **1.25×** | white houses with blue doors, a harbour wall; red-and-white canopy |

**Places and treats.** Each path brings two of the treats-plan places (2026-10-24 plan: "a treat is a town building")
to that city's Treats row, so the coins it earns have a place to go:
- Industrial: clock tower, works band;
- Market: fountain, fair;
- Resort: bandstand, beach huts;
- University: statue, botanical garden;
- Port: lighthouse, aquarium.

Every town keeps the plain ones. The paint shop offers the path's colours as liveries.

### How it fits the rest

- **Civic places:**
  - the Market landmark stays at level 2 for every town, as today;
  - the path's landmark is the city's second building of its own;
  - the Town hall becomes the lean nudge (above).
  - Later civic rows ("Fire station: a level bigger", "Hospital") are untouched.
- **The grand project:** the Exhibition's stage 3, "The stands", asks for **an exhibit from each path settled on the
  map, at least 3 of them**.
  - Each path's landmark makes **1 exhibit crate every 4 minutes** at its station: machine parts, hampers,
    souvenirs, inventions or imports. That's one new good ("exhibit", carried in vans).
  - Trains bring them to the site, so one stage needs cities of three kinds joined by rail.
  - The Cathedral asks Market cities for its bread, the Ferris wheel Resorts for their riders, and the Royal Train is
    built at an Engine works.
- **Balance:**
  - The bands are unchanged by design: leaning starts at Town, City wants are the same for every path, and ★ totals
    are within 10% of today's.
  - The balance player doesn't steer by default: it leans wherever its deliveries take it, usually Market.
  - A new `BALANCE_PATH=industrial|market|resort|university|port` makes it pick that path in the Town hall. Run the 9
    seeds per path. A path's ★ minute more than 15 min off today's is a finding; tune that path's ★1 wants.
  - The goals play-through gets one more goal reached by the player's path: "Grow a city that's settled" (a sticker,
    not a core goal).
  - Stickers: one per path ("Engine town", "Market day", "Seaside", "Seat of learning", "Old salt"), and a hidden
    "Every kind of city".
- **Saves:**
  - Two optional fields on a town: `path` (null until it settles) and `lean` (points per path). They're saved with
    the landscape. There's also a per-town count of riders getting off (`Economy.ridersOff`, saved).
  - SAVE_VERSION 15 → 16, with a migration:
    - an old save's towns below City start leaning with their geography nudge;
    - an old City or more settles on load, from its `deliveredGoods` totals scored with `LEAN` (no rider or school
      counts: those weren't kept), and nothing is asked.
    - Its landmark goes up on its next growth, not at load, so no houses move at load.
    - Its current level keeps the wants it had (no progress is lost). The path's wants begin at its next star.
  - Sandbox has no paths.
- **Phones:**
  - The meter is one row of the card: a stacked bar 16 px high, a two-line legend of icons, and one line saying what
    pushes it. It shows from Town level only.
  - The close-call choice is the growth sheet with two 44 px rows.
- **Perf:**
  - Lean points are counted in the unload path (a table lookup per unit).
  - The card redraws on the town's lean version.
  - Settling runs once.
  - Powers are cached:
    - the industry speed factor per depot, rebuilt when a city settles or depots move;
    - the summer check once a game month.
  - Landmarks are static props in the existing batches (one new model per path, about 1,400–5,300 triangles: see
    the assets).

### Size

**L in all, 6 sessions, each landing alone:**
1. Lean points and the card's meter (S–M).
2. Settling, landmarks, saves v16 (M).
3. ★ wants per path, powers, the balance runs per path (M).
4. Looks per path: palettes, house styles, liveries (S–M).
5. The Town hall nudge (S).
6. Exhibits for the Exhibition's stands (S, with Part 2's project work).

## The assets (catalogue models, 2026-11-05)

**Real catalogue assets, built so they can go straight into the game if we keep them:**
- **Where:**
  - `src/catalogue/assets/grand.ts` (`grand-*`), `secrets.ts` (`secret-*`), `paths.ts` (`path-*`);
  - shared parts in `src/catalogue/build-parts.ts`: scaffolding, a tower crane, a hoarding, stacks of goods,
    overgrowth, the dull palette for an unfound site.
- **How they're built:**
  - with the same `Kit` as the rest, in mm at train scale;
  - toy lacquers from `TOY`, and pale-blue lacquer for glass, because the game's glass material draws dark in the
    props' batches;
  - every part casts and receives shadows, as Kit parts do;
  - drawn as props, so they're merged by material into the existing batches (`bake`, `PROP_DETAIL` 0.5).
- **Where they show:**
  - each file lazy-loads as its own chunk (`registry.ts` prefixes `grand`, `secret`, `path`);
  - they're on Sandbox shelves: Buildings → "Grand projects" and "Town paths", Nature → "Secrets";
  - nothing in Game mode: no gating, no gameplay.
- **Stages and states are one builder with a parameter**, registered per variant, so the game swaps a placed prop's
  asset when a stage completes or a site is found:
  - `grand-<name>-1/2/3`: foundations, half built, finished;
  - `secret-<name>-hidden` and `secret-<name>`.
- **Tested:** `src/catalogue/assets/design-assets.test.ts` checks that each one:
  - builds;
  - stays under its triangle budget (grand 14,000, secret 6,000, path 8,000, at the props' detail);
  - loads by its file;
  - is on a shelf.

  `catalogue.test.ts` checks they stand on the ground and are a sensible size.

**Triangles, as the props draw them.** For scale: the bandstand is 2,092, the playground 2,224, the fountain 1,232.

| Asset | Stage 1 | Stage 2 | Stage 3 |
|---|---|---|---|
| Grand Exhibition hall | 2,088 | 4,378 | 5,048 |
| Cathedral | 2,832 | 3,444 | 2,108 |
| Royal Train | 2,616 | 4,124 | 4,116 |
| Grand Central station | 2,628 | 4,378 | 3,850 |
| World's Fair wheel (animated: turns, gondolas stay level) | 2,304 | 2,756 | 4,900 |

| Secret site | Hidden | Found |
|---|---|---|
| Lost mine | 3,300 | 1,860 |
| Ruined castle | 5,644 | 3,748 |
| Hidden lake | 3,204 | 2,144 |
| Shipwreck | 2,748 | 2,112 |
| Standing stones | 3,372 | 3,352 |
| Giant's footprint | 4,584 | 2,904 |

Path landmarks:

| Landmark | Triangles |
|---|---|
| Engine works | 1,900 |
| Guildhall and market | 3,504 |
| Pier and pavilion | 5,332 |
| Observatory | 1,440 |
| Customs house | 2,110 |

(Counted before the props' merge, which keeps the triangles and cuts the draw calls. The hidden sites cost more than
the found ones because of the overgrowth: bushes are balls.)

**Pictures** (`node tools/shots/design-assets.mjs`, a fresh Game map at 390×844):
- **The setup (harness shortcuts, for looking only):**
  - the towns are grown by writing their deliveries;
  - each site's trees are cleared and low hills lowered, as a player can;
  - props are put down with `props.add`;
  - each secret's line is laid with `placeRun` and its train added with `sim.addTrain`.
- **Grand projects:** `docs/agents/shots/grand-<name>-stages.jpg` (the three stages side by side on the map) and
  `grand-<name>.jpg` (a close-up, finished), for `exhibition`, `cathedral`, `royal-train`, `central`, `ferris-wheel`.
- **Secrets:** `docs/agents/shots/secret-<name>.jpg` shows the site hidden and found side by side, a train arriving
  on the line laid to the found one. `secret-<name>-close.jpg` is a close-up of the found site. The names are
  `lost-mine`, `castle`, `lake`, `shipwreck`, `stones`, `footprint`.
- **Paths:**
  - `docs/agents/shots/path-<name>.jpg`: each landmark in a city, for `engine-works`, `guildhall`, `pier`,
    `observatory`, `customs-house`;
  - `design-character-leaning.jpg`: the town card with the Leaning meter (HTML over the game, beside the Guildhall).

**What each secret finds, and its reward:**

| Secret | What you find | Reward |
|---|---|---|
| Lost mine | a cart full of gold | 300 coins; the mine reopens for half price |
| Ruined castle | a flag on the tower | day-trippers: a halt near it fills with people |
| Hidden lake | the boat mended | a boating day out (riders), fish for the towns |
| Shipwreck | a chest of gold | 300 coins; the figurehead for the museum |
| Standing stones | the stones stand again | midsummer visitors from every town |
| Giant's footprint | ducks and a sign | families come to picnic (riders) |

**Known looks to polish if we keep them:**
- The pier stands on grass when it's not by the sea. Its water is a catalogue-only underlay.
- The shipwreck's hull reads as open ribs more than a hull.
- The Royal Train is a display model on its own track, not a running train. It would need the car models' own
  machinery to run.

## 1. Town character

*Options considered first. The user has since picked town paths (above). 1A survives as the geography nudge, 1B is the paths themselves, and 1C is later polish.*

### Options

**1A. Trades: each town is born with one (recommended, with 1B on top).**

When the map is made, each town gets a **trade** from what is around it (`TRADES`, a table like `LANDMARKS`). Each
trade changes how you serve the town, not just how it looks:

| Trade | Placed where | How you serve it differently | Landmarks (catalogue models where they exist) | Palette |
|---|---|---|---|---|
| **Timber town** | by forests (the first town on every map) | as today: planks first. Pays double for furniture | sawpit, then a carved clock tower | warm browns, red roofs |
| **Mill town** | by a river with flat land | its Town level wants **grain, not flour**: its own windmill grinds the grain, and its station gives the flour out to trains (the town is also a small mill) | `bldg-windmill`, then `bldg-watermill`, then a Corn Exchange | cream and gold |
| **Fishing town** | on the coast | its quay lands a small catch (2 🐟 every few minutes, from the start, without Fishing boats). **Fish counts for its flour want** (the 10-15 spec's "flour can be met by either") | `bldg-lighthouse`, a fish market, a harbour wall | white and sea-blue, striped awnings |
| **Miners' village** | in hills, near a mine ruin | wants half its planks as **pit props** (logs). The mine ruin beside it restores for half price | winding gear, then a pithead baths | slate grey, brick |
| **Market town** | the town with the most towns within reach (a crossroads) | the Market comes at level 1, not 2. Its people ride further, so fares there are 1.25× | `bldg-market-hall` early, then a corn cross | bright, mixed |
| **Resort** (rare) | coast or hilltop, away from industries | **riders who arrive count toward growth** (passengers are a growth good here). Pays double for ice cream and juice | `scene-bandstand`, a pier, bathing huts | pastels |
| **Cathedral town** (rare) | anywhere, at most one a map | its school studies 1.5× as fast. Wants stone a level early | `bldg-church` grown into a cathedral | stone and slate |

- **Data, not code paths:** a trade is a row.
  - `wantsSwap`: which good in which level is replaced, and by what.
  - `pays`: double-pay goods.
  - `landmarks`: per level, from the catalogue.
  - `theme`: picks `stationTheme` and a weighting of house variants and storey styles.
  - `gives`: what its station puts out (flour, fish).
  - Growth (`townStatus`) reads the town's table, not the global one: `townLevel(n, trade)`.
- **The first town on every map stays a Timber town**, so the opening is the same everywhere. Trades show from the
  second town on.
- **How you see it:**
  - a chip on the card ("🌾 Mill town");
  - one line saying what's different ("A mill town grows on grain, not flour: its windmill grinds it…");
  - the landmark on the map from its first level;
  - the colours.
  - Mock: `design-character-town-card.jpg`.
- **Saves:** `Town.trade` is saved with the landscape. Old saves load as `timber`, which plays as today.
- **Size: M (2–3 sessions).**
  - Session 1: the table, `townLevel(n, trade)`, the card chip and line, saves.
  - Session 2: placement in generation, landmarks and palettes.
  - Session 3: balance on all 9 seeds and the play-through with a mill town and a fishing town reached by the
    player's path.

**1B. Paths: a city chooses which way to grow (recommended, on top of 1A).**

The 10-15 spec's "major specialty" made a **visible choice** instead of a hidden tally.
- At City (level 3) the growth sheet offers 2 paths (3 where the land allows). The first two come from the town's
  trade and what it has been brought most. The third needs a place, such as the sea for a resort (mock:
  `design-character-paths.jpg`).
- **Industrial city:**
  - builds an **Engine works**;
  - industries within reach work 1.25× as fast;
  - the ★ levels want iron and bricks;
  - looks: brick terraces, chimneys.
- **Market city:**
  - builds a **Grand station** (the Big stations terminus, free);
  - twice the riders;
  - pays half again for foods;
  - the ★ levels want bread and cheese;
  - looks: shops with awnings, a market square.
- **Seaside resort:**
  - builds a pier and bathing huts;
  - riders count toward growth;
  - summer months (the calendar) bring a crowd at its station;
  - the ★ levels want ice cream, juice and fish.
- **Seat of learning** (from a Cathedral town or a University):
  - builds an observatory;
  - the hardest research takes fewer goods there;
  - the ★ levels want books (furniture) and paint later.
- The choice is final for that city. Every path stays open to another city: specialize, don't lock out. The path
  sets `STYLES_BY_LEVEL` for its new buildings from then on (#17's storeys rules unchanged), so two cities look as
  different as they play.
- **Size: M (2 sessions).** It replaces the ★ part of `townLevel` with a per-path table, and the growth sheet gets
  a choice.

**1C. Wishes and fairs: a light layer with no table changes (recommended next, after 1A).**
- **A wish:** every so often a town asks for something it doesn't need to grow ("Brambleton would love 6 🍎 for
  its school picnic").
  - At most one per town, with no timer.
  - Shown as a small speech-bubble marker over its station: a static sprite in `map-markers`, with no motion.
  - Filled, it gives a decoration in the town (a carousel, flower beds, a statue), a few coins, and sticker
    progress.
- **A fair:** one wish a year has a month, the town's fair, read from `calendar.ts`.
  - Filled by then: bunting, a carousel for a year, twice the riders that month.
  - Missed: nothing is lost. "Next year's fair is in September."
- **Twin towns** instead of rivalries. "Rivalry" reads as competitive, which isn't cozy.
  - Two towns of different trades ask for each other's good: fish to a mill town, flour to a fishing town.
  - Served both ways, they put up a "Twinned with …" sign, and each grows 10% faster.
  - This gives routes between far towns a reason to exist.
- **Size: S–M (1–2 sessions).**

**Not recommended alone: specialties that emerge from what you bring** (the 10-15 spec's minor specialties).
- They are invisible for the first hour, and every town still starts the same, so the problem the user named stays
  until late.
- Folded into 1B: what a town has been brought decides which paths it's offered.

### Recommendation

**1A, then 1B, then 1C.** Towns differ from the moment you see them (1A). The player's choices then make them more
different (1B). Wishes and fairs give a small reason to visit each town again (1C).

**Phones:**
- The town card gains one chip row and one line. The fair or wish lines appear only when there is one. It must fit
  360 px: the chips wrap.
- The path choice is the growth sheet with 2–3 rows of 44 px or more.

**Perf:**
- Trades are data read when goods are unloaded and in the growth check, never per frame.
- Landmarks are static props in the existing batches. Each new model is one more batch, so keep it to about 2 per
  trade and reuse the catalogue (windmill, watermill, lighthouse, bandstand, church, market hall).
- A windmill's sails follow the ambient rule: they turn only while in view and big enough (`AmbientEye`, a new
  `AMBIENT_MIN_PX` row), at `AMBIENT_FRAME_MS`.
- Wish markers are static. Fairs are checked once a month of game time (2 min), in the once-a-second update.

---

## 2. Something to work towards

### Options

**2A. Grand projects: map-wide builds over hours (recommended).**

A ladder of big builds, each at a site you choose in a city.
- Each site is a depot: trains bring goods, and its crane unloads them, as at the workshop.
- Each project has stages, and each stage asks for a lot of several goods.
- The building goes up stage by stage on the map: a fenced plot, then scaffolding, then the frame, then the finished
  building.

| Project | When | Stages (illustrative) | Its day |
|---|---|---|---|
| **Town hall** (the board's "soon" Civic row) | first city, ~60–90 min | 1: 40 , 20 🪨 | a ribbon-cutting. Teaches projects |
| **Great Exhibition** | ~2–5 h | Foundations (🪨 ) → Iron hall (⚙️ 🧱) → The stands (one good from each trade on the map: 🐟 from the fishing town, flour from the mill town…) → Opening day | the **Royal Train**: a gold engine in your toy box. Route it through every city; when it has called at all of them, every town puts up bunting, you get a sticker, and the **railway's report card** |
| **The Rocket** (designs the board's "ending" rows) | 5 h + | Rocket works, then parts by train: hull (⚙️ 🔩), engines (🧰 ⚡), fuel (coal), the crew's lunch (🥖 🧀 🍦) | **Launch day**: every town's people at the pad. "The railway carries on after" |

- **The report card** (end of each big project) gives:
  - towns and their levels;
  - goods kinds carried;
  - loads moved;
  - the longest line;
  - years taken (from the calendar).
  - A rosette of 1–3 stars from a few of these. There's no fail and no timer; the stars are only for bragging.
- **Ties to Part 1:**
  - "The stands" stage asks for every trade's good, so a project needs a network that joins different towns.
  - The Exhibition's site gives a path bonus: a Market city gets twice the visitors there.
- **Always on screen:**
  - **The goal bar becomes the project ribbon** once the core goals are done: "🏛️ Great Exhibition · 2 of 4 ·
    46%". It sits where the goal bar is, with no new row.
  - Before that (a project started while core goals are left), a small 🏛️ chip shows in the goal bar beside the
    bell.
  - The ribbon's ⌖ (Show me) frames the site.
  - A tap opens the project card: stages, goods, and which train is bringing what.
  - The site is a marker in the 🗺 map view.
  - Mock: `design-character-project.jpg`.
- **Size: L (4–5 sessions).**
  1. The site depot, stages and card (Town hall only).
  2. The ribbon, the map marker and saves.
  3. Great Exhibition models and the stands stage.
  4. The Royal Train tour and the report card.
  5. The Rocket, later, as its own spec.

**2B. Chapters: the railway's storybook.**
- The 23 core goals become chapters 1–3, and new chapters 4–6 carry on. Each chapter is a page of 3–4 tasks with a
  title ("Chapter 4: The line to the coast") and a gift at the end.
- The last chapter is the Royal Train.
- Clear for children, and the goal bar already shows it.
- It's linear, though, and it repeats on every map unless chapters are drawn from the map (a coast chapter only on a
  coast map).
- **Hand-made scenario maps** (a fixed map per chapter) are **L+**, and they'd fight the generated plots.
- **Size: M** for chapters on generated maps.

**2C. Jubilee: a score and a yearly report.**
- Every game year (24 min) the railway gets a short report: what grew, what's new, a 1–5 star rating.
- After 10 years: a Jubilee celebration and the final card.
- Cheap, and it gives a rhythm, but it's a score more than a goal. On its own it doesn't give anything to build
  toward.
- **Size: S–M.**

### Recommendation

**2A, with 2C's report card at each project's end, and 2B's wording on the ribbon** ("Next: the iron hall").
- Projects make the late game about the map: something big being built where you can see it, out of every town's
  trade.
- That is the "working towards something" the user asked for, and it uses the depots, cranes, routes and goods the
  game already has.
- The Rocket keeps its place as the finale the 10-15 spec planned.

**Phones:** the ribbon replaces the goal bar (same height, same place), so there's no new row. The project card is a
bottom sheet like the town card.

**Perf:**
- Progress is counted where goods are unloaded (as towns' are). The ribbon's DOM is written only when its key (stage,
  percent) changes.
- Stage models swap once a stage, in the existing prop batches.
- The Royal Train is an ordinary train with its own paint.
- The report card is built once, when it's opened.
- Nothing per frame.

**Testing (AGENTS.md):**
- The goals play-through starts the Town hall project and fills it by train: player taps, prices paid, goods
  unloaded by the crane.
- A long-part check reaches the Exhibition's first stage. An e2e checks the ribbon's numbers move when a train
  unloads, not only that the ribbon shows.

---

## 3. More on the map

### Options

**3A. Regions: each plot has a kind of land (recommended).**

- The generator already makes each plot from `(seed, px, pz)`. A low-frequency region noise on the plot's position
  picks its kind, so neighbouring plots form runs of the same land.
- Each kind sets the generator's numbers:
  - the hill noise's scale, threshold and `MAX_HEIGHT`;
  - the tree noise's threshold and species;
  - ponds and streams;
  - which ruins and trades show up there;
  - a few dressing models.

| Region | Land | What's there | What it asks of you |
|---|---|---|---|
| **Meadows** | today's map | farm ruins, mill towns | (the start region is always this) |
| **Highlands** | steeper and higher hills (to level 4), rocks, heather | mine and quarry ruins, miners' villages, a castle | tunnels, and the **rack line** (the board's "Mountain railway") straight up what plain ramps can't climb |
| **Pinewood** | dense pines, clearings | an old logging camp to restore, timber towns | clear trees (10 🪙 a square, as ruins), forest yards galore |
| **Fens** | low, wet, many ponds and streams, reeds | ducks, a hidden find, an eel smokery | bridges everywhere, or a **causeway** (a low trestle piece) |
| **Coast** (built) | the shore | harbour ruins, fishing towns, resorts | harbours |

- **The Add land card** names the plot's region and what you can see from there (mock: `design-character-map.jpg`).
  Buying land becomes a choice, not just a price.
- **Ground colour by region** (heather on highlands, darker green in pinewood) is a **product call**. It isn't a
  season tint, but it is a tint. The alternative is dressing models only.
- **Size: M–L (2–3 sessions).** Generation by region with parameter sets, tested to agree at plot edges like
  `coast.ts` (this is the hard part). Dressing, the card line, and the rack line as its own later node.

**3B. Sights and secrets: things to find (recommended, with 3A).**

**Sights** are placed per plot like ruins (`addPlotExtras`), by region:
- a ruined castle (highlands), a stone circle (meadows), a lighthouse (coast), a waterfall (highlands with a river),
  an old viaduct (a valley: restore it to cross);
- **a sight is a destination for passengers.** With a halt within reach, towns' people ride out to it ("day-trippers"),
  so coaches have somewhere to go besides other towns;
- a sticker for serving each kind of sight.

**Secrets** are found by playing:
- a tunnel dug through a highland hill finds a **cave with a fossil** (a museum piece, a sticker);
- an old engine shed in pinewood holds a **lost engine** (restore it: a vintage engine for the toy box);
- reeds in the fens hide a **bittern's nest** (a halt nearby, and birdwatchers come);
- shown as "❓" on the map until found.
- The hidden stickers (7 today) gain real places to find them.

**Size: M (2 sessions)**, after 3A or alongside it with the sights in today's meadow.

**3C. Events: cozy, never harmful.**
- **Festival train:** a visiting circus or fair train (the board's "Circus train"). You give it a route through your
  towns, and wherever it stops, crowds come.
- **A big ship calls** at a harbour wanting 30 planks, at double pay. It waits until it's filled.
- **Harvest glut:** in September, farms give double (the calendar).
- **A royal visit** before the Exhibition: a one-off coach train to carry.
- **Not recommended:** floods, storms or snow that close lines, or anything that breaks what you built. They
  conflict with "nothing fails", and weather looks were turned down. If wanted later: an opt-in "lively" setting.
- **Size: M (2 sessions)**, best after 1C (fairs) shares the calendar hooks.

**3D. Map shapes at New game (cheap after 3A).**
- A picker on New game: River valley, Coast and islands, Mountain pass, Fens and forests, and Surprise me. Each sets
  the region weights.
- Each could end with its own finale: the Exhibition, a Regatta, the line over the pass, a Cathedral.
- Islands need ferries or long bridges (the board's "Train ferry").
- The first game stays on the starter map.
- Mock: `design-character-new-game.jpg`.
- **Size: S** after 3A (S–M with a finale per shape).

### Recommendation

**3A with 3B, then 3D.**
- Regions make buying land a decision.
- Sights and secrets give the map things to find, and give passengers somewhere to go.
- Shapes are cheap once regions exist.
- Events (3C) come later, kept to visiting trains and calendar fairs.

**Phones:** a region is one line on the Add land card. Sights use the existing map markers. The New-game picker is
a sheet of 4–5 rows of 44 px or more.

**Perf:**
- Regions cost only at generation time. The plots are cached as today.
- Dressing reuses the tree instancing. New models are about 3 per region: rocks, reeds and heather as instances,
  never one mesh per square.
- Ducks, a waterfall and windmill sails are ambient motion through `AmbientEye`, still when zoomed out.
- Sights are static props.
- Day-trippers use the existing waiting-people machinery.
- `npm run perf:check` on a highlands-heavy and a fens-heavy perf map before landing. Budgets are updated only with
  a reason.

---

## 4. Order

Each step lands alone.

| # | What | Size | Why then |
|---|---|---|---|
| 1 | **★ Town paths**, steps 1–3: lean points and the meter, settling and landmarks, ★ wants and powers | M + M + M | the user's pick: towns become what you bring them |
| 2 | **2A Town hall project** (+ ribbon) | M | proves projects early, small |
| 3 | **★ Town paths**, steps 4–5: looks per path, the Town hall nudge | S–M | cities stop looking alike |
| 4 | **3A Regions** + **3B sights** | L | plots worth choosing, things to find |
| 5 | **2A Great Exhibition + Royal Train + report card** | M–L | the long arc, using every trade |
| 6 | **1C Wishes, fairs, twin towns** | S–M | a reason to revisit towns |
| 7 | **3D Map shapes**, then **3C events** | S, M | variety between games |
| 8 | **The Rocket** | L (own spec) | the finale |

Every step:
- Run the 9 balance seeds, and report shifts in a table. Bands are never loosened.
- Run both goals play-through parts.
- Reach the new thing by the player's path.
- Add an e2e at 390×844 that checks the payoff:
  - a town leans and settles from what trains bring it (Market from bread, Industrial from iron), and its landmark
    goes up;
  - a project stage completes from deliveries;
  - a day-tripper rides to a sight.
- Add a rule to `scripts/e2e/affected.mjs` for each new module.

## 5. The mock-ups

All 390×844, drawn as HTML over the real game (`tools/shots/design-character-mocks.mjs`). The numbers are
illustrative. The 3D extras are catalogue props put down by hand as stand-ins: the windmill and bandstand at
Elderwick, and a control tower, statue, fountain and tents for the exhibition ground. The game's own icons stand in
where they exist; the rest are system emoji.

- `docs/agents/shots/design-character-town-card.jpg`: Elderwick as a **Mill town**. It has the trade chip, the fair
  chip, grain in place of flour, the line saying why, and the windmill landmark beside it.
- `docs/agents/shots/design-character-paths.jpg`: the City growth sheet with **paths**: Industrial, Market, and
  Seaside resort (locked: no sea near).
- `docs/agents/shots/design-character-project.jpg`: the **project ribbon** in the goal bar's place, the exhibition
  ground pinned on the map, and the project card's four stages.
- `docs/agents/shots/design-character-map.jpg`: neighbouring plots as **regions** (Fens, Highlands), with sights
  and a ❓ secret pinned, and the Add land card naming the region.
- `docs/agents/shots/design-character-new-game.jpg`: **map shapes** on New game.

## 6. Questions for the user

1. **Paths:**
   - Is the close-call choice (within 20%) right, or should a city always settle automatically (or always ask)?
   - Should exhibits be one new good, or should the stands take each path's existing goods?
2. **The long arc's finale:** Great Exhibition with the Royal Train, then the Rocket after? Or only one of them?
3. **Region ground colours** (heather, dark pine): allowed, or dressing models only?
4. **Events:** cozy visiting trains only, or an opt-in "lively" setting with weather?
5. **Twin towns instead of rivalries:** ok?
