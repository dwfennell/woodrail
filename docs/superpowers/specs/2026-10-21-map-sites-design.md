# Map sites: old industries you restore, and more towns

Date: 2026-10-21. Status: step 1 implemented (branch `map-sites`); step 2 planned (§7). Game mode first; the land is
the same in Sandbox.

## What the user asked

> Could be nice to have a farm depot / etc out on the map even before they are unlocked. I bought a couple surrounding
> squares but it was just kind of empty space.

And: "there could be more towns around the expanded map too... especially in strategic locations like the oceanside".

The proposal (scratchpad `sites-proposal/proposal.md`) offered fixed sites (A), prospects (B) and ruins you restore
plus free placement (C). The user picked **C with the land tweaks**: every plot gets at least one site, by what it is
rich in; sites come from their own random stream, so maps and tests don't change; the land card names them; ruins show
on the land around before it's bought. Shipped in two steps: this is step 1.

## 1. Sites

A site (`MapSite`, `src/landscape/generate.ts`) is an old industry's place on the map:

- `role`: `farm`, `quarry`, `mine` or `harbour` (the resource-bound industries; a mill needs no resource, so it isn't
  one);
- `piece`: the pose of a 216 mm **stub of track**, laid out as a depot's piece is (yard on its +lateral side), and
  `centre`, its middle; restoring it (step 2) puts the industry's piece exactly there;
- `plot`: the plot it was made for; `fields`: a farm's two fields (ids in `Landscape.fields`);
- `cleared`: cleared away by the player (ids are places in `Landscape.sites`, so a cleared site keeps its place).

On the land its yard and stub squares are `FEAT_RUIN` (owner: the site's id), its approaches (the stub's row, two
squares off each end) are corridors. In the world its stub is a real, fixed `straight-216` piece (`World.ruins`: site id
→ piece id), like a map depot's piece: track can be joined to it now, and step 2 swaps its type in place.

`FEAT_RUIN` blocks track (`checkPlacement`: "An old yard is in the way: tap it to clear it"), industries' yards
(`checkYard`: "an old yard"), placed models and land editing, exactly where a map depot's square would.

## 2. Generation (`src/game/map-sites.ts`)

Everything comes from its own stream, `rng(hashInts(seed, px, pz, w, h, SITES_SALT))`, run **after** the land's towns,
fields and depots are made (`generatePlot`, `generateLandscape` are unchanged). Tests check that the land's own towns,
fields, depots and shed are deep-equal with and without the extras, for several seeds.

**Every plot beyond the start** (`addPlotExtras`, called by `landForSale` through `plotLand`):

1. Maybe an **extra town** (§3).
2. One **site**, of the kind the plot is richest in: a harbour if it has sea or a river, a quarry or a mine (60/40)
   where more than a fifth of it is hills, else a farm; then the other kinds. A spot qualifies when:
   - its yard, stub and approaches are on open grass (a harbour's yard may be on the sand), inside the plot's edge band
     (clear of the crossings' stubs), off roads, corridors and anything standing;
   - it is 540 mm (`SITE_TOWN_SPACING`) from every town's station and 450 mm from depots, sites and the shed;
   - its role's `SITE_RULES` are met **in full** (12 hillside squares, 8 water squares, a farm's two 2 × 2 fields
     planted beside it, 8 of 8) and a harbour's boats can reach it (`harbourWhy`). A river's harbour settles for half its
     water at once (a river is a square wide: the rule's least, 4).
   - Its yard and approaches (and a farm's fields) are **flattened** into the hillside (`flattenUnder`: only lowers,
     within `MAX_HEIGHT` squares, never across the plot's edge), and it is kept only if every town, depot and site can
     still be reached (`reachable`).
   If no random spot fits, every other square's middle is tried, then every square's at half the resource; over 232
   plots of 8 seeds every plot had a site.
3. A **second site** of another kind (not a second hill site) 40% of the time, where one fits. At most 2 a plot.

If the plot's town takes the room its site needs, the town tries its next best spot, then gives way: every plot has a
site.

**The start** (`addStartSites`, by `createWorld`): an **old farm** near the first two towns, its yard nearest their
midpoint, so a new player sees it in the opening view (Farming is the first industry they learn). On a starter map it
keeps off the starter line (5 rows either side of the strip from the sawmill to the forest yard) and off the sawmill's
side of the line altogether. On other starts (Sandbox's maps) a second site of the start's richest kind is added.

Why the start gets one, and only one on the starter map: the farm teaches the research loop from minute 1 (its card says
"Learn Farming at a school"), and it sits where the opening view shows it. A second, hill site, and the farm on the
sawmill's side, both took the ground the grand tour builds its foundry and power station on (the tour then failed on
its coal run); with the farm alone on the far side the tour and the balance harness pass unchanged (§6).

Cost: the extras take about as long as the plot itself (7.4 ms and 6.8 ms a plot on the dev machine, survey below), so
the land around is made a step more at a time: `prepareLandForSale` makes the plot in one slice between frames, its
extras in the next. A new map's start sites: about 6 ms (`buildStarterWorld` 20 ms, main 14 ms). `reachable` now uses
the grid's neighbour table and one stack (same answers, about twice as fast), which speeds up all generation.

## 3. More towns beyond the start

`addExtraTown` (generate.ts) on each plot beyond the start, by chance: **every coast plot, 60% of river plots, 30% of
the rest** (`EXTRA_TOWN_CHANCE`). It tries every square's middle each way round, keeps the generator's rules:
`MIN_TOWN_SPACING` (900 mm) from towns, its station and approaches on grass inside the edge band, its ground open
(trees felled, hills flattened, down to the beach or a river: at most a third water); it is a little smaller than the
generator's towns (ground 288 mm round, approaches 216 mm) so it fits beside a coast. The best spot is the one nearest
the water (the sea counts more, a river's mouth most); it is grown as the generator grows towns and named from `NAMES`
(renamed if the world has the name already). Its station is a fixed piece and its goods depot is added like any town's.

**Survey** (`SURVEY=1 npx vitest run src/game/map-sites-survey.test.ts`): 8 seeds (7, 1, 2, 3, 42, 99, 1234, 2027),
the 6 × 6 plots round each start (less the start's 2 × 2 and the open sea): 232 plots, 48 by the sea, 153 with a river,
31 inland.

| | plots | own towns | extra towns | towns a plot, before → after |
|---|---|---|---|---|
| by the sea | 48 | 0 | 39 | 0 → 0.81 |
| with a river | 153 | 101 | 41 | 0.66 → 0.93 |
| inland | 31 | 23 | 4 | 0.74 → 0.87 |
| all | 232 | 124 | 84 | **0.53 → 0.89** (+0.36) |

So about **one extra town for every three plots** (0.53 → 0.89 towns a plot), and four in five coast plots get a town
by the sea: harbours there have a town to serve. More isn't possible without breaking the 900 mm spacing: most plots
have a town at their middle already, which leaves no room for another. Sites: 1.16 a plot (farm 99, quarry 77, mine
53, harbour 40); no plot without one.

The starter map's two coast plots to the south, which the user bought and found empty, now bring "A town by the sea, an
old harbour and a river" and "A town by the sea and an old farm".

## 4. Saves

No version bump: `sites` is an optional field of the saved landscape; `FEAT_RUIN` is a new square value.

- **Round trip**: sites are saved with the land; on load each standing site's stub is found where it was put, as a
  depot's is (a stub that isn't there, which can't happen in play, marks the site cleared rather than refuse the save).
- **Old saves** (no `sites`): `addSitesToOldSave` gives the land it owns the sites and extra towns a new map would
  have there. Each owned plot's land is made again from the seed (`generatePlot`, or the start's `generateLandscape`,
  with its coast as saved) and its extras added; each extra (a town, a site) is a patch: the squares it stands on,
  keeps clear or changes, with what was there before it. It is copied in only if **every one of those squares is
  exactly as generated** (height, surface, feature, road: so not where the land was raised or lowered, a town grew or
  a house moved, a field was planted, a lane or road laid) and **nothing of the player's is on it or beside it**
  (`playerSquares`: the squares under the player's track and the square round each sample of it, an industry's or a
  kit's yard either side of its piece, a placed model; the map's own stations, depots and town houses don't count).
  Anything else is skipped. Then the stubs, stations and town depots go on, and the town houses' models.
  A save gains them once: saved again, it has `sites`.
- Old saves' plots are made again on load: about 16 ms a plot on the dev machine, once.

## 5. Rendering and the card

`RuinsView` (`src/render/ruins-view.ts`): each ruin is its industry's model (`DepotView.staticParts`: yard, buildings,
crane, no upgrades) in one grey, a fence round its yard, a small sign, and (on land not yet bought) its stub as grey
planks. All merged per tile (2 × 2 plots) into one mesh of the `paint` material (vertex colours), static, casting
shadows; built only when the ruins shown change (a tile is rebuilt only if its ruins did: a key of role, place and
stub), or the industries' models arrive. Culled with the depots. No per-frame work.

Tapping a ruin (its yard, buildings, or stub) opens its card; from far off, a tap on the ground there does. A ruin on
land not yet bought isn't tappable. The card (for a phone, a child reading):

- **Old farm** (title)
- 🌾 Farm fields nearby: 8 of 8 (⛰️ Hillside / 🌊 Water; the need, capped)
- 🔒 Learn Farming at a school to open this farm (Quarries, Mines, Harbours); once learned, or in Sandbox: 🔧 Restoring
  comes soon (step 2's Restore button goes here)
- Or build your own anywhere from the Industries tab. (Game mode)
- [Clear the ruin · 10🪙] ("Clear the ruin" in Sandbox): takes the ruin and its stub away, its fields stay. Not while a
  train is on the stub ("A train is on its track"); short of coins: "Clearing it costs 10 coins: you have 4".

The land card (`describeLand`): towns (by the sea, if they are), old sites, depots, then the land: "2 towns by the sea,
an old harbour, a forest yard and hills.", "A town, an old quarry, a river and hills."

## 6. Balance and cost

The `BALANCE=1` harness plays the starter map and never buys land, so it sees only the start's farm (and its two
fields), south of the line, away from the sawmill. One change to the harness (and the same to the grand tour): its farm
is sited by the map's own fields, not an old farm's (restoring a ruin, and building by its fields, is step 2's harness
rule). Without it the harness, on 4 of 9 seeds, ran a branch from the goal's switch to a farm by the ruin's fields that
its auto train never took, and research stalled on Mills. With it all 9 seeds (2027, 1–6, 9, 10, 180 min) pass with
the same figures as main: researched 15/21/15/14/14/14/15/15/17, City at 80/79/74/67/83/71/71/83/79 min.

Extra towns are beyond the start, so the harness can't show them. Qualitatively: a bought plot now brings 0.89 towns
on average instead of 0.53 (a coast plot 0.81 instead of none), so the demand a player can reach grows about two thirds
faster with land, and coast plots (where harbours sell at half a town's price) usually come with a town to deliver to;
planks and flour are spread over more towns, so a single town may grow a little slower unless the line reaches the new
ones.

Measured (dev machine, shared and loaded; swiftshader in the e2e):

- Idle, new Game at its opening view (the old farm in view), 30 s: 0 frames, main thread busy 3.82% (main: 0 frames,
  3.66%); pulled back over the land around (scenery ruins in view): 1 frame, 3.06% (main 1 frame, 2.93%).
- Ruins built: a tile 12–60 ms in swiftshader (all 4 tiles round a new game 280–330 ms, on the models' arrival); only
  on a land change, an unlock, a clear, or the land around changing.
- Generation: a plot's extras 7.4 ms (the plot itself 6.8 ms), in a slice of their own; a new starter world 20 ms
  (main 14 ms); an old save of 12 plots gaining its sites 147 ms once (13 ms to load it afterwards).

## 7. Step 2 (planned)

- **Restore**: on a learned ruin's card, "Restore · 3🪵 45🪙" (about half its industry's price): one editor op swaps the
  stub's piece type for the industry's in place (`depot-farm` at `site.piece`), clears its `FEAT_RUIN` squares and marks
  the site cleared; its joints stay. Undo puts the stub and the ruin back. The data has what it needs: role, pose,
  fields.
- **Show me**: the goals that point at an industry spot (`depotSpot`) prefer a standing ruin of that kind within reach of
  the player's line.
- **Harness rule**: the balance player restores a ruin within N of its line when that's cheaper than building new, else
  places as now; `BALANCE_NORUINS=1` to compare. Then a balance pass (farm and quarry earlier: the City minute and coins
  bands).
- **Map view**: ruins marked on the map.
