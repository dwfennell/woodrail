# Map sites: old industries you restore, and more towns

Date: 2026-10-21. Status: step 1 implemented (branch `map-sites`); step 2 implemented (branch `map-sites-2`, §7). Game mode first; the land is
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

## 7. Step 2: Restore, Show me, the harness (implemented, branch `map-sites-2`)

### Restore (`src/game/restore.ts`)

- **The card.** Once the ruin's blueprint is learned (and always in Sandbox) the status line reads "🔧 Half the price of
  a new farm yard" and the card's first button is **Restore · 3🪵 45🪙** ("Restore" in Sandbox). "Or build your own
  anywhere from the Industries tab." stays, and so does Clear the ruin.
- **The price** (`restorePrice`, `RESTORE_SHARE = 0.5` in map-sites.ts, the one knob): half the new industry's
  `THING_RULES` price, goods rounded up, coins to the nearest 5. Farm 3🪵 45🪙, quarry 4🪵 90🪙, mine 5🪵 155🪙, harbour
  8🪵 5🪨 240🪙.
- **How it's paid** (`gamePayment`): as a new industry is. A new farm yard is made at the workshop, its planks from
  the workshop's yard and its coins from hand, into the toy box, and then placed. Restoring takes the planks (and stone)
  from the workshops' yards and the coins from hand, and the farm yard is one more the player owns (`owned` + 1), so
  the toy box is unchanged and picking the farm yard up later puts it in the box like any other. The planks never come
  from the toy box: the toy box holds things, not planks, and nothing else the player buys takes planks from anywhere
  but the workshop's yard.
- **The swap** (`restoreRuin`, `Editor.swap`): one undo step. The stub piece is taken up and the industry's piece is
  put down at the same pose, height and way round (a new piece id; the joints re-seat, so track joined to the stub is
  joined to the industry). Inside the step: payment, the site marked `cleared` and `restored`, its `FEAT_RUIN` squares
  open ground, its entry out of `World.ruins`, the ruins redrawn. It's an ordinary player industry from then on:
  `syncIndustries` gives it its economy depot, `updateRates` its rate from what's around it (8 of 8 fields: 1.0), the
  depot view its yard and crane, a tap its card. Not a fixed piece: it can be moved or taken up as any industry.
- **Undo** puts the stub (its own id) and the ruin back and gives the price back (goods to the first workshop's yard,
  the coins, one fewer owned). **Redo** pays again; if it can't be paid now it's refused, said as the button says it
  (`Command.refuse`, `Editor.onRefused`), and the history is kept.
- **Saved**: `MapSite.restored` (optional, no version bump). The industry's piece is saved as any player's piece; on
  load a cleared site isn't looked for, so nothing else is needed.
- **Refusals** (toasts): "Restoring needs 2🪵 more at the workshop and 15🪙 more" (either part alone when only one is
  short); "Restoring takes planks from your workshop. Place it first" (no workshop); "A train is on its track"; the
  yard's own message when it's blocked ("The farm yard needs open ground: a house is in the way", `checkYard` with the
  ruin's own squares not counted); the site rule's when the resource has gone ("Needs farm fields nearby: 3 of 4").
  Done: "Old farm restored! It works again".

### Show me (`guideIndustry`, goals.ts)

There was no goal asking for an industry, so step 2 adds one: **Open a farm** ("Restore an old farm, or build a farm
yard by some fields."), shown once Farming is learned, after "Lay a switch" (before "Build a bridge"); done when a farm
yard stands on the map. Its Show me is `guideIndustry(w, "farm")`, written for any of the four kinds: the standing ruin
of that kind on the player's land nearest their line (restorable or locked), framed with the nearest bit of the line,
ringed, and its card opened (Restore on it); with none, today's `depotSpot` (a straight of the line where a new one
fits and meets its site rule), the Industries tab open. A quarry, mine or harbour goal is one row more.

**Research**: when a blueprint that opens a ruin's industry is learned, a toast (and a News entry with its place)
names the standing ruin nearest the line: "Old farm by Larkfield can be restored". Tapped, it glides to the ruin and
rings it.

### The harness (`src/play/balance.test.ts`)

- **Rule** (`restoreOld`): once Farming is learned, the standing farm ruin nearest the line, if within
  `RUIN_REACH` (1500 mm, `BALANCE_RUIN_REACH`) and cheaper than new (it always is, unless a farm yard is in the toy
  box): the line is run on from one of its ends to the stub (`extend` to the stub's free connectors), then restored as
  the card does it (`restoreRuin` with `gamePayment`). It waits while it can't be paid for. If the line can't reach it,
  or it's too far, the ruin is passed over for the game and a new farm yard is built as before. `BALANCE_NORUINS=1`
  never restores.
- **The step 1 workaround** (a new farm yard sited by the map's own fields, not the ruin's) is kept, now only as the
  fallback. Restoring fixes what it worked round: the restored farm yard is the line's end (the stub joined to a line
  end, its other end capped or the mill after it), on the train's way, not a branch off a switch that the unrouted
  train never took. The fallback still can't use the ruin's fields: a new farm yard by them would stand on the ruin's
  yard or beside it, on a branch.
- The goal the harness works on skips "Open a farm" (the farm comes by its own rule), so the other goals come as they
  did.

### Balance (180 min, 1 train a line; `BALANCE=1`, seeds 2027, 1–6, 9, 10)

Without ruins (`BALANCE_NORUINS=1`): identical to step 1 and main.

| seed | first research | City | City★ | research stall (min) | town gap (min) | coins 15/60/180 | researched | farm | bands |
|---|---|---|---|---|---|---|---|---|---|
| 2027 | 5.6 | 80 | 135 | 9.0 | 24.0 | 242/85/674 | 15 | 22.0 new | pass |
| 1 | 5.6 | 79 | 122 | 6.4 | 27.4 | 126/139/914 | 21 | 26.0 new | pass |
| 2 | 5.6 | 74 | 123 | 15.1 | 15.8 | 96/269/749 | 15 | 36.0 new | pass |
| 3 | 5.6 | 67 | 177 | 7.4 | 17.3 | 242/10/884 | 14 | 25.0 new | pass |
| 4 | 5.6 | 83 | 148 | 8.7 | 27.9 | 212/98/1064 | 14 | 25.0 new | pass |
| 5 | 5.6 | 71 | 120 | 13.6 | 14.3 | 96/209/1148 | 14 | 36.0 new | pass |
| 6 | 5.6 | 71 | 115 | 12.6 | 18.6 | 242/8/1000 | 15 | 25.0 new | pass |
| 9 | 5.6 | 83 | 138 | 8.7 | 28.1 | 212/96/841 | 15 | 25.0 new | pass |
| 10 | 5.6 | 79 | 122 | 6.4 | 23.7 | 126/219/1884 | 17 | 26.0 new | pass |

With ruins (`RESTORE_SHARE` 0.5):

| seed | first research | City | City★ | research stall (min) | town gap (min) | coins 15/60/180 | researched | farm | bands |
|---|---|---|---|---|---|---|---|---|---|
| 2027 | 5.6 | 54 | 164 | 12.1 | 18.9 | 242/124/623 | 14 | 22.0 restored | FAIL; City at minute 60 or later: expected 54 to be greater than or equal to |
| 1 | 5.6 | 79 | 122 | 6.4 | 27.4 | 126/139/914 | 21 | 26.0 new | pass |
| 2 | 5.6 | 74 | 123 | 15.1 | 15.8 | 96/269/749 | 15 | 36.0 new | pass |
| 3 | 5.6 | 57 | - | 8.0 | 36.1 | 242/344/348 | 13 | 25.0 restored | FAIL; City at minute 60 or later: expected 57 to be greater than or equal to |
| 4 | 5.6 | 70 | 132 | 8.3 | 16.8 | 212/32/792 | 14 | 25.0 restored | pass |
| 5 | 5.6 | 71 | 120 | 13.6 | 14.3 | 96/209/1148 | 14 | 36.0 new | pass |
| 6 | 5.6 | 57 | - | 8.0 | 38.5 | 242/314/336 | 13 | 25.0 restored | FAIL; City at minute 60 or later: expected 57 to be greater than or equal to |
| 9 | 5.6 | 70 | 135 | 13.4 | 12.6 | 212/32/875 | 14 | 25.0 restored | pass |
| 10 | 5.6 | 79 | 122 | 6.4 | 23.7 | 126/219/1884 | 17 | 26.0 new | pass |

The old farm is restored on 5 seeds (2027, 3, 4, 6, 9), at the minute a new farm yard went down without ruins (22–25:
the restore isn't earlier, Farming is learned then). On the other 4 (1, 2, 5, 10, Farming learned at minute 16) the
line couldn't be run to it at that moment, and a new farm yard went down as before: their figures are unchanged.

Where it's restored, the **City comes 13 to 26 minutes earlier** (2027: 80 → 54; 3: 67 → 57; 4: 83 → 70; 6: 71 → 57;
9: 83 → 70), and three seeds fall under the City band's floor of 60. Two seeds lose City★ in 180 minutes and research
finishes one or two fewer. The cause isn't the price: the restored farm yard is the line's end with 8 of 8 fields, and
the mill then goes straight after it (minute 42; without ruins "the mill won't go after the farm yard" and it goes at
another line end, minute 49), so grain is milled on the way back to the towns and the first city's flour comes sooner.

**The price knob doesn't move it.** At minute 22–25 the player holds 240–340 coins, so neither price (half, or a new
one's 90 coins plus the 40-coin field that brings a new one to full speed) holds the farm back. Measured on the three
seeds that broke:

| `RESTORE_SHARE` | farm price | City 2027 / 3 / 6 |
|---|---|---|
| 0.5 | 3🪵 45🪙 | 54 / 57 / 57 |
| 0.75 | 5🪵 70🪙 | 57 / 57 / 55 |
| 0.9 | 6🪵 80🪙 | 70 / 57 / 70 |

(The 0.9 row's movement is the chaotic kind: a few planks spent differently changes later choices; seed 3 stays at 57
at every price.) So the share stays at 0.5 and the band question is open for the CoS: accept a City from minute ~55
when the old farm is restored (it's the better-placed farm, not a cheaper one, that does it), or hold the City back
by mechanics (a restored farm yard's rate, or its fields), which step 2 was told not to change.

### Cost

Measured (dev machine; swiftshader in the e2e):

- The restore itself (`restoreRuin`: checks, swap, payment, squares; Node, starter map): 0.7 ms median (13 ms the first,
  cold).
- In the game, Restore tapped to done: 411–497 ms in swiftshader. Most of it is what follows any track edit that puts
  an industry down (`onChange`: the track, the industries' yards and depot view, the goals, the save), the same as a
  farm yard dropped from the tray; the ruins' tile, the only one rebuilt (its key changed), 72–116 ms. Undo and redo
  rebuild that one tile again (67–153 ms).
- Idle after it all, the land around in view: 0 frames in 30 s, main thread busy 3.39% (step 1: 3.82%).
- Nothing per frame: the card, the toast and Show me run on taps; the research toast once per blueprint learned.

### Still to do

- **Map view**: ruins marked on the map.
- Goals for a quarry, mine and harbour (`guideIndustry` takes any of the four).
