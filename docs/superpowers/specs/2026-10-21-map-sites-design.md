# Map sites: old industries you restore, and more towns

Date: 2026-10-21. Status: step 1 implemented (branch `map-sites`); step 2 implemented (branch `map-sites-2`, §7; the starter's old farm, the harness's spur and the placement study at the end of §7's Balance). **Game mode only**: Sandbox
maps (`Landscape.siteless`) never get sites or ruins (it has no research to open them), and an old Sandbox save gains
none; land added in Sandbox still gets the extra towns (§3), from the same generation path.

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
   - its role's `SITE_RULES` are met **in full** (12 hillside squares, 5 water squares, a farm's two 2 × 2 fields
     planted beside it, 8 of 8) and a harbour's boats can reach it **from the open sea** (`waterWay(…, seaOnly)`: not off
     the edge of the land, a way that buying the land beyond would cut; so no harbour on a river plot, which gets the
     next kind instead, since 2026-10-23; an old save's river harbour stays, and its card says when boats can't reach it).
   - Its yard and approaches (and a farm's fields) are **flattened** into the hillside (`flattenUnder`: only lowers,
     within `MAX_HEIGHT` squares, never across the plot's edge), and it is kept only if every town, depot and site can
     still be reached (`reachable`).
   If no random spot fits, every other square's middle is tried, then every square's, still **in full** (since
   2026-10-23: a restored industry runs at full speed); a kind that can't have all it needs on a plot gives way to the
   next. Over 232 plots of 8 seeds every plot has a site.
   - **Harbours' water** (fixed 2026-10-23). QA: old harbours showed "Water nearby: 5–6 of 8" and ran at 0.75. A
     harbour counts water within 110 mm of its quay (150 mm across its track): 9 squares on the squares' grid, 3 of
     them its own yard's row, which stands on land. So 6 was all the water any harbour could have (7 off the grid, a
     player's), and the rule wanted 8: no harbour, old or new, ever had it, and every old harbour came from the search's
     last pass "at half the resource" (4 to 6). The rule now wants **5** (`SITE_RULES.harbour.need`: 6 square on to a
     straight shore, 5 on a bend of it), the least a harbour is placed with stays 4 (`least`), and that last pass is gone.
     A harbour has no recipe of its own, so its rate is only what its card says: nothing else plays differently. With 6
     the search left 2 coast plots of 232 (seeds 42 and 99, a strip of sand) with no site at all; with 5 every plot has
     one.
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
have a town at their middle already, which leaves no room for another. Sites: 1.16 a plot (farm 99, quarry 80, mine
55, harbour 36, all on coast plots, every one with all its site rule wants; before full need, 2026-10-23: farm 109,
quarry 81, mine 57, harbour 22, the harbours at 4–6 of 8; before harbours needed the sea: farm 99, quarry 77, mine 53,
harbour 40, 18 of them on river plots); no plot without one. Full need moved a few coast plots' extra towns: 36 of 48
coast plots get one (39 before), where a harbour now takes the room the town wanted (the town gives way).

| sites (232 plots) | before (need 8, last pass at half) | after (harbour need 5, in full) |
|---|---|---|
| farm | 109, rate 1.0 | 99, rate 1.0 |
| quarry | 81, rate 1.0 | 80, rate 1.0 |
| mine | 57, rate 1.0 | 55, rate 1.0 |
| harbour | 22, rate min 0.50, avg 0.65 | 36, rate min 1.0, avg 1.0 |
| plots with none | 0 | 0 |

The starter map's two coast plots to the south, which the user bought and found empty, now bring "A town by the sea, an
old harbour and a river" and "A town by the sea and an old harbour" (an old farm before harbours wanted 5).

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
  **One undo step** (since 2026-10-23, `clearRuinEdit` in restore.ts, `Editor.takeUp`): undone, the stub (the same
  piece) and the ruin come back and the 10 coins are given back; redone, paid again (refused, and said, if it can't be).
  It's saved like any edit. QA found Restore → Undo → Clear → Redo built the farm on the cleared site and charged again,
  the 10 coins never given back: Clear was outside the history, so the restore's redo stayed. Now Clear is the newest
  step and takes the redo with it, as any edit does; the history stays one story. (Only clearing the redo stack was the
  fallback; it would have left the 10 coins out of undo, which is what the player tries next.) An undo onto ground used
  since by something that isn't an undo step is refused: "Something is on that ground now". A restore's redo onto a
  ruin that's gone is refused too ("It's gone already"), which the history no longer allows anyway.

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

- **The card.** Once the ruin's blueprint is learned the status line reads "🔧 Half the price of
  a new farm yard" and the card's first button is **Restore · 3🪵 45🪙**. "Or build your own
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
- **A ruin isn't refused for what it was made beside** (fixed 2026-10-23). A site keeps one row of yard squares beside
  its stub's row (`siteSquares`: middles 72 mm across the track, the row's far edge at 108 mm), but an industry's pad
  is 84 mm deep round 72 mm, so its ground samples reach 112 mm: a few mm onto the next row, which a site doesn't keep
  clear. A farm's fields are planted against its yard there, a quarry's or mine's hillside rises there, water lies
  there; and the yard check refused the ruin for them ("a field is in the way", "the quarry's yard is on a hill"): **146
  of 175 ruins** round 8 starts (2 rings of plots bought, no player track) couldn't be restored: farms every way round
  (64, most by a field, some on a hill or by the river), 39 quarries and 38 mines (mostly a hill, a few the river), 5
  harbours (a hill). The starter's old farm passed only because the row behind its yard happens to be open grass. Now
  `restoreWhy` checks the ground only to the ruin's own row (`RUIN_YARD_REACH`, 108 mm: `checkYard`'s `groundTo`);
  other track and props are still looked for over the whole pad, and placing a new industry is unchanged. Survey
  (`restore-survey.test.ts`, the same 8 starts): all 175 pass `restoreWhy` (21 harbours, each reaching the open sea), and every one meets its site rule in full,
  so restored it runs at full speed (rate 1: farm 69, quarry 43, mine 42, harbour 21; before 2026-10-23's full need
  the 15 harbours there had 4–6 of 8, rate min 0.50, avg 0.63).
  Before harbours had to reach the sea, one (a river harbour, seed 42) failed: its river no longer led off the land
  once the plots round it were bought. Such a harbour in an old save keeps its site; its card says "⛵ Boats can't
  reach this water now" (`HARBOUR_STRANDED`) and offers no Restore. The restored pad overhangs the field, hillside or
  water beside it by those few mm.

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

- **Rule** (`restoreOld`): once Farming is learned, the standing farm ruin nearest the line, if it's within
  `RUIN_REACH` (1500 mm, `BALANCE_RUIN_REACH`) and cheaper than a new one (it always is, unless a farm yard is in the
  toy box already): the line is run on from one of its ends to the stub (`extend` to the stub's free connectors), then
  restored as the card does it (`restoreRuin` with `gamePayment`). It waits while it can't be paid for. If the line
  can't be run to it from a line end, a new farm yard is built that same minute, as without ruins (waiting for the ruin
  held the farm back 10 minutes and moved every seed's figures); it's tried again 5 minutes on while there's still no
  farm. On the starter line no line end reaches the old farm, so **by default the starter's old farm is never restored**
  (the CoS's choice, below). `BALANCE_NORUINS=1` never restores; `BALANCE_RUIN_TRACE=1` logs each line end's try.
- **`BALANCE_SPUR=1`, an A/B**: failing a line end, **a short spur** is laid to it (`spurTo`, once Switches is learned,
  which it always is by then): a straight of the line nearest the ruin becomes a switch (made at the workshop) and a
  short straight, as `branchOff` does, and track runs from the switch's branch to the stub, at most 24 pieces
  (`BALANCE_SPUR_PIECES`). On the starter map that's 4 pieces from the line between Larkfield and Elderwick, down the gap between the two towns' houses.
- **A spur before Routes** (`BALANCE_SPUR=1`, `tendSpur`): the goods train runs end to end with the switch set for the line, so it never
  calls at the farm by itself (what stalled step 1). The player sets the switch by hand, as a child does: toward the
  farm while grain is wanted (Mills being researched, or a mill), the goods train is on the line's side of the switch,
  its hoppers are empty and the farm has a load; back for the line otherwise, so once it's loaded. Checked each second
  of play, never while a train is on the switch; stops once Routes is learned (the routed line then calls at the farm
  on its spur). `BALANCE_SPUR=routes` instead lays the spur and has the player learn Routes before Mills and leave the switch alone.
- **The step 1 workaround** (a new farm yard sited by the map's own fields, not the ruin's) stays, as the fallback.
- The goal the harness works on skips "Open a farm" (the farm comes by its own rule), so the other goals come as they
  did.

### Balance (180 min, 1 train a line; `BALANCE=1`, seeds 2027, 1–6, 9, 10)

**The bands' run** (`BALANCE=1`, no flags), on the branch merged with main at 2fc79a3 (since step 1 the mill costs
400 coins, switches 3 planks, early flour 12 coins, and the workshop's yard keeps fewer planks): **all 9 seeds pass**.
Farming comes at minute 14–23, when the line's ends are the forest yard's (east) and Thimble Cross's (north); from both
the track layer is boxed in short of the old farm's stub (towns, fields and the ruin's own yard in the way: `boxed-in`
after 22–40 pieces, trace on seed 2027), so the harness builds a new farm yard and the old farm isn't restored. Against
the branch at 040cd60 (where the tables below were measured) only coins moved: 60 more from some point between minute 45 and 180 on
every seed (main's changes since), and seed 9's City★ came at 164 (was 166) with a 10.8-minute stall (was 11.1).
Without ruins (`BALANCE_NORUINS=1`) it's the same table; at 040cd60 every placement below gave it row for row.

| seed | first research | City | City★ | research stall (min) | town gap (min) | coins 15/45/60/75/180 | researched | farm | bands |
|---|---|---|---|---|---|---|---|---|---|
| 2027 | 4.4 | 62 | - | 12.1 | 12.0 | 296/122/260/294/1314 | 14 | 29 new | pass |
| 1 | 4.4 | 61 | 160 | 8.1 | 22.1 | 78/384/136/287/1455 | 15 | 25 new | pass |
| 2 | 4.4 | 73 | 169 | 7.2 | 18.7 | 48/468/224/416/1086 | 15 | 25 new | pass |
| 3 | 4.4 | 80 | 179 | 7.2 | 37.2 | 326/666/754/494/1503 | 14 | 33 new | pass |
| 4 | 4.4 | 80 | 164 | 9.3 | 22.4 | 296/562/737/487/1366 | 14 | 33 new | pass |
| 5 | 4.4 | 73 | 172 | 10.1 | 18.1 | 48/462/350/562/1171 | 15 | 25 new | pass |
| 6 | 4.4 | 67 | 141 | 7.8 | 16.6 | 326/10/130/433/1872 | 17 | 23 new | pass |
| 9 | 4.4 | 69 | 164 | 10.8 | 18.6 | 296/380/6/171/1148 | 14 | 23 new | pass |
| 10 | 4.4 | 82 | 179 | 6.5 | 18.3 | 78/464/782/464/1828 | 14 | 25 new | pass |

**With the spur, `BALANCE_SPUR=1`** (informational, an A/B: not the default; the player setting the switch by hand;
the old farm where it was, 8 of 8): the old farm is **restored on all 9 seeds**, on a 4-piece spur, at minute 15–23 (the minute Farming is learned, or the next); **7 of 9
pass**.

| seed | first research | City | City★ | research stall (min) | town gap (min) | coins 15/45/60/75/180 | researched | farm | Routes | Mills | bands |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2027 | 4.4 | 87 | - | 9.5 | 29.4 | 296/39/129/203/615 | 13 | 19 restored (spur) | 42.5 | 35.1 | pass |
| 1 | 4.4 | 70 | - | 8.4 | 27.9 | 123/359/25/369/935 | 11 | 15 restored (spur) | 40.8 | 33.4 | pass |
| 2 | 4.4 | 83 | - | 7.9 | 19.1 | 93/1/85/217/643 | 11 | 15 restored (spur) | 40.8 | 33.4 | pass |
| 3 | 4.4 | 83 | - | 12.4 | 15.1 | 326/1/159/303/652 | 13 | 23 restored (spur) | 52.9 | 40.3 | pass |
| 4 | 4.4 | 87 | - | 11.4 | 11.8 | 296/55/187/337/679 | 13 | 23 restored (spur) | 51.9 | 42.7 | pass |
| 5 | 4.4 | **109** | - | 7.6 | 29.1 | 93/439/673/937/1241 | 11 | 15 restored (spur) | 40.8 | 33.4 | FAIL: City by 90; City ≤ main's +20% (87) |
| 6 | 4.4 | 69 | 180 | 9.1 | 19.1 | 326/7/121/363/931 | 12 | 23 restored (spur) | 50.8 | 42.6 | pass |
| 9 | 4.4 | **98** | - | 13.1 | **47.2** | 296/457/731/845/815 | 12 | 23 restored (spur) | 47.4 | 42.6 | FAIL: City by 90; no planks into a town for 45 min |
| 10 | 4.4 | 81 | - | 8.1 | 19.1 | 123/27/111/243/896 | 11 | 15 restored (spur) | 40.8 | 33.4 | pass |

The City now comes **later** than without ruins on 8 of 9 seeds (62–82 → 69–109), not earlier as when the restored farm
was the line's end (step 1: 54–57): the opposite failure. Mills is learned up to 8 minutes *earlier* on 7 seeds (the farm comes up to 10
minutes sooner, and the switch set by hand brings its grain; 3 minutes later on 6 and 9), so what costs time is after it: from Routes on the routed
train calls at the farm down its spur and back, and on every seed the sawmill went without logs for 5 minutes far more
often (`STALL: no planks sawn` 14–17 times in 180 minutes, against 3–7 without ruins). On 5 and 9 that starved the
workshop: its yard sat at 7 planks, one short of the mill's 8, for most of an hour (mill at minute 85 and 76, against 57 and
49), so the flour, and the City, came late. Fewer blueprints too (11–13 against 14–17), all above main's floors. Coins
at 180 are lower (615–1241 against 1026–1812) and nearer the 150–600 "nice to have".

### Where the starter's old farm stands (the CoS's question: reachable, but a trade-off)

The CoS asked to place the starter's ruin so restoring it is reachable but not ideal, and to try placements: off a
natural line end, fewer fields (4 of 8, the player planting more at 40 coins), or slightly off the main line behind a
short branch. Each variant below was run on all 9 seeds with and without ruins; **without ruins every variant gives
the table above row for row**, so only the runs with ruins are shown. "Spur: Routes first" is `BALANCE_SPUR=routes`;
"by hand" is the default. City by seed in the order 2027, 1, 2, 3, 4, 5, 6, 9, 10 (bold: outside 60–90).

| variant | where (yard middle), fields | restored | City | bands pass |
|---|---|---|---|---|
| A | where it was (−36, 468: south of the line between Larkfield and Elderwick, behind the gap in their houses), 8 of 8; spur, Routes first | 9/9, spur, min 15–23 | 89, **94**, **92**, 89, 89, **119**, 72, **119**, 85 | 4 |
| **A, by hand (chosen)** | as A; spur, switch by hand | 9/9, spur, min 15–23 | 87, 70, 83, 83, 87, **109**, 69, **98**, 81 | **7** |
| B | as A, 4 of 8 (the field toward Larkfield); spur, Routes first | 9/9: 7 spur (15–23), 2 from a line end (25: 6 and 9) | 89, 79, 90, 89, 89, **119**, **51**, **51**, 85 | 3 |
| B, by hand | as B; switch by hand | as B | 87, 72, 70, 83, 86, **109**, **51**, **51**, 70 | 6 |
| B′, by hand | as A, 4 of 8 (the field toward Elderwick) | 9/9, spur, 15–23 | 87, 72, 70, **53**, **52**, **109**, **53**, **98**, 70 | 4 |
| C | (−540, 684): under Larkfield, 8 rows off the line, its yard toward the river, 4 of 8 | 0/9: the line run to it, then "a field is in the way" | 67, **52**, 84, 86, **91**, 85, **–**, **–**, **99** | 4 |
| D | (−324, 612): south-west, its yard toward the line, 4 of 8 | 0/9: Larkfield's roads grow onto its yard ("a road is in the way") | 66, **52**, 85, 85, **91**, 85, **–**, **–**, **98** | 2 |
| E | (252, 612): south of Elderwick, its yard toward the line, 4 of 8 | 2/9, from a line end (25: 6 and 9); the spur can't get round its yard | 62, 62, 73, 80, 80, 73, **57**, 62, 82 | 7 |

What they show:

- **Fewer fields doesn't make it a trade-off here; it makes it chaotic.** With 4 of 8 the ground the second field
  stood on is open, the line comes past the ruin on seeds 6 and 9 (173 mm off it) and runs on to its stub: the free win
  again, City at 51. With the other field kept instead (B′) the line keeps off it, but the Cities spread both ways
  (52–109). The field's price (40 coins at minute 15–25, when the player holds 100–330) is too small to steer anything.
- **Moving it further off the line breaks it.** Under Larkfield (C, D) the town's roads and fields grow onto the yard
  before Farming comes (the line is run to the stub, then Restore is refused), and the failed tries move the play
  enough that 6 and 9 never learn Mills. South of Elderwick (E) the ruin's yard lies between the stub and the line, so
  no short spur gets round it: it's restored only where the line happens to pass (2 seeds, both the free win).
  Further east or west the opening view (390 × 844, framing the two towns' stations) doesn't show it: its near edge
  is Elderwick, its sides rows −4 to 10 at Elderwick's end (cols up to about 9).
- **Where it was is already off the main line behind a short branch**: 5 rows south of the line between the towns,
  its stub across the gap between their houses, so the only way in is a 4-piece spur off a switch, never a line end
  (on every seed). What was missing was a player who lays that spur; with one, the old farm is restored on every seed.

**The placement: the old farm stays where it was, with 8 of 8 fields** (`addStartSites` unchanged). It's visible in the opening view (as step 1 made it) and nowhere near the grand tour's foundry and power
station (unchanged; the tour passes). The trade-off a player feels:

- **The good**: an old farm at half a new farm yard's price (3🪵 45🪙 against 6🪵 90🪙), full speed at once (no field to
  plant), right beside the first line, and Show me points at it.
- **The cost**: it's off the line. It takes a switch (3🪵 at the workshop) and a few pieces of track, and until Routes
  is learned the goods train goes straight past it unless the player sets the switch for the farm each time grain is
  wanted, and back for the line after (else the forest's logs wait). After Routes the routed train calls on its own,
  but the trip down the spur and back costs every round of the line some time: the sawmill waits for logs more often.
  A new farm yard at a line end costs more and needs a field planted, but the train calls there without help.

With the spur 7 of 9 seeds pass: 5 and 9 miss the City's ceiling (109 and 98), from the spur's extra trip after Routes
starving the workshop of the mill's last plank (above), not from restoring early.

**The CoS's choice (2026-10-23): the harness keeps to a new farm yard.** The spur is too dear for the bands' run, so
it's an A/B behind `BALANCE_SPUR=1` and the table above is for information. By default the harness restores a ruin
only from a line end, which on the starter line never reaches the old farm: the starter's old farm isn't restored, a
new farm yard is built, and all 9 seeds pass (the bands' table above).

**What restoring does when the line can reach it**, measured on step 1's main (before the merge), where Farming came at
minute 16–24 and the line reached the ruin from an end on 5 seeds. Without ruins (identical to step 1):

| seed | first research | City | City★ | research stall (min) | town gap (min) | coins 15/45/60/75/180 | researched | farm | bands |
|---|---|---|---|---|---|---|---|---|---|
| 2027 | 5.6 | 80 | 135 | 9.0 | 24.0 | 242/198/85/145/674 | 15 | 22.0 new | pass |
| 1 | 5.6 | 79 | 122 | 6.4 | 27.4 | 126/256/139/137/914 | 21 | 26.0 new | pass |
| 2 | 5.6 | 74 | 123 | 15.1 | 15.8 | 96/493/269/281/749 | 15 | 36.0 new | pass |
| 3 | 5.6 | 67 | 177 | 7.4 | 17.3 | 242/266/10/255/884 | 14 | 25.0 new | pass |
| 4 | 5.6 | 83 | 148 | 8.7 | 27.9 | 212/206/98/158/1064 | 14 | 25.0 new | pass |
| 5 | 5.6 | 71 | 120 | 13.6 | 14.3 | 96/139/209/421/1148 | 14 | 36.0 new | pass |
| 6 | 5.6 | 71 | 115 | 12.6 | 18.6 | 242/236/8/80/1000 | 15 | 25.0 new | pass |
| 9 | 5.6 | 83 | 138 | 8.7 | 28.1 | 212/206/96/156/841 | 15 | 25.0 new | pass |
| 10 | 5.6 | 79 | 122 | 6.4 | 23.7 | 126/256/219/217/1884 | 17 | 26.0 new | pass |

With ruins (`RESTORE_SHARE` 0.5):

| seed | first research | City | City★ | research stall (min) | town gap (min) | coins 15/45/60/75/180 | researched | farm | bands |
|---|---|---|---|---|---|---|---|---|---|
| 2027 | 5.6 | 54 | 164 | 12.1 | 18.9 | 242/19/124/183/623 | 14 | 22.0 restored | FAIL; City at minute 60 or later: expected 54 to be greater than or equal to |
| 1 | 5.6 | 79 | 122 | 6.4 | 27.4 | 126/256/139/137/914 | 21 | 26.0 new | pass |
| 2 | 5.6 | 74 | 123 | 15.1 | 15.8 | 96/493/269/281/749 | 15 | 36.0 new | pass |
| 3 | 5.6 | 57 | - | 8.0 | 36.1 | 242/44/344/405/348 | 13 | 25.0 restored | FAIL; City at minute 60 or later: expected 57 to be greater than or equal to |
| 4 | 5.6 | 70 | 132 | 8.3 | 16.8 | 212/276/32/341/792 | 14 | 25.0 restored | pass |
| 5 | 5.6 | 71 | 120 | 13.6 | 14.3 | 96/139/209/421/1148 | 14 | 36.0 new | pass |
| 6 | 5.6 | 57 | - | 8.0 | 38.5 | 242/32/314/366/336 | 13 | 25.0 restored | FAIL; City at minute 60 or later: expected 57 to be greater than or equal to |
| 9 | 5.6 | 70 | 135 | 13.4 | 12.6 | 212/276/32/378/875 | 14 | 25.0 restored | pass |
| 10 | 5.6 | 79 | 122 | 6.4 | 23.7 | 126/256/219/217/1884 | 17 | 26.0 new | pass |

There the old farm was restored at the minute a new farm yard went down without ruins (22–25), and the **City came 13
to 26 minutes earlier** (2027: 80 → 54; 3: 67 → 57; 4: 83 → 70; 6: 71 → 57; 9: 83 → 70): three seeds under the band's
floor of 60, two without City★ by 180, one or two fewer researched. The cause wasn't the price but the place: the
restored farm yard is the line's end with 8 of 8 fields, and the mill went straight after it (minute 42; without ruins
"the mill won't go after the farm yard" and it went at another line end, minute 49), so the first city's flour came
sooner. **The price knob didn't move it**: at minute 22–25 the player held 240–340 coins.

| `RESTORE_SHARE` | farm price | City 2027 / 3 / 6 |
|---|---|---|
| 0.5 | 3🪵 45🪙 | 54 / 57 / 57 |
| 0.75 | 5🪵 70🪙 | 57 / 57 / 55 |
| 0.9 | 6🪵 80🪙 | 70 / 57 / 70 |

**The minute-60 dip** (after the 400-coin mill; seeds 9 and 6 at 6 and 70 coins on main, the same here, as the bands' run
leaves the old farm be): with the
ruin restored on a spur (`BALANCE_SPUR=1`, above) it moves rather than eases: minute 60 is higher on 9 and 6 (731 and 121 coins) but
lower on 1, 2, 3 and 4 (25–187 against 76–754), and minute 45 drops to 1–55 coins on 2027, 2, 3, 4, 6 and 10 (the
400-coin mill bought at minute 41–44 there, against 38–66 without ruins). Where step 1's harness restored at a line end (step 1's main,
the mill 280 coins), it moved the dip rather than easing it: the mill went down sooner (minute 42, straight after the
restored farm), so the low point came at minute 45 (19–44 coins on 2027, 3 and 6, against 198–266 without ruins) and
minute 60 was higher on 2027, 3 and 6 (85 → 124, 10 → 344, 8 → 314) but lower on 4 and 9 (98 → 32, 96 → 32). The
restore itself saves 45 coins and the 40-coin field a new farm yard plants to reach full speed: about 85 coins at
minute 22–25, small beside the mill's 400.

(The 0.9 row's movement is the chaotic kind; seed 3 stayed at 57 at every price.) The share stays at 0.5. Main has
since raised the mill to 400 coins "so the first City stays in its band", which holds the mill back whichever farm is
there. (That question was answered with the spur rule above: where the old farm is reached by a spur rather than a
line end, the City comes later, not earlier, and restoring stays a trade-off; the price wasn't touched.)

### Cost

Measured (dev machine; swiftshader in the e2e):

- The restore itself (`restoreRuin`: checks, swap, payment, squares; Node, starter map): 0.7 ms median (13 ms the first,
  cold).
- In the game, Restore tapped to done: 184–497 ms in swiftshader. Most of it is what follows any track edit that puts
  an industry down (`onChange`: the track, the industries' yards and depot view, the goals, the save), the same as a
  farm yard dropped from the tray; the ruins' tile, the only one rebuilt (its key changed), 72–116 ms. Undo and redo
  rebuild that one tile again (67–153 ms).
- Idle after it all, the land around in view: 0 frames in 30 s, main thread busy 3.39% (step 1: 3.82%).
- Nothing per frame: the card, the toast and Show me run on taps; the research toast once per blueprint learned.

### Still to do

- **Map view**: ruins marked on the map.
- Goals for a quarry, mine and harbour (`guideIndustry` takes any of the four).
