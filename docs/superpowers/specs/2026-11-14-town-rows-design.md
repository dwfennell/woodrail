# Towns in rows: how town buildings look and how towns fill (design)

2026-11-14. Status: approved 2026-11-14 with the proposals under "For the developer to decide" taken as written. Every choice below is the builder's proposal unless it says
"the developer said"; the ones that most change what gets built are gathered under "For the developer to decide".

## Why

The developer said (2026-11-13): "in general how the city buildings look, some of them could be a bit better. Maybe
re-evaluate how our towns grow in blocks in general", after asking to see the House experiment's upgraded look in the
base game.

Two spikes answered what "upgraded" means here (branch `claude/toy-look-towns`, pictures in `e2e-out/town-look/`):

- **Paint alone does nothing.** The painted cars' glossier paint on every building left a city ★★ looking the same
  (`town-street-now.jpg` beside `town-street-toy.jpg`).
- **Modelling and layout do.** One block of joined buildings (a corner shop, three terraced houses, a town house: full
  width on their lots, a roof block each in its own colour, windows and doors printed flat in cream and dark, on a
  pavement with a garden strip, trees, lamps, a postbox: `tools/blender/toyblock.py`) reads as a town at once beside
  Larkfield (`block-both.jpg`, `block-block.jpg`, `block-blocklow.jpg`).

What is wrong with a grown town today, from those pictures and the code:

- A building is a model about 49 × 35 mm standing alone in the middle of its 72 mm square, so a street is a row of
  separate little houses with grass between them. Nothing touches.
- Houses grow by gaining 20 mm storey blocks under that small house (`src/props/storeys.ts`), up to four more than
  the model has: the middle of a city is thin towers, every one under the same dark grey roof.
- A city ★★ (27 buildings) has one street and two stubs. Streets are laid only when no lot is free close in
  (`src/roads/grow-town.ts`), and when streets can't reach, buildings go on greens and the grass border, facing nothing.
- Faces are plain: black squares in white frames, no doors to speak of, no pavement, no gardens, no trees in town.
- Body colours are three hue shifts of each model, chosen with no thought for the neighbours.

## Goals

- A town reads as a town from play height: streets lined on both sides with joined rows, a denser middle, roofs in a
  few colours that go together.
- Close in, a building looks like a well-made painted wooden toy: chunky, eased edges, printed windows and doors.
- A town grows by filling rows before it spreads, so a village is a short street of joined houses, not a scatter.
- What a town is in the save (its buildings, their squares, kinds, floors, landmarks) does not change: old games open
  in the new look with no migration of the map.
- It costs a phone no more than towns do today, within the budgets.

## Non-goals

- The painted cars, beech track, the House. This design uses none of them and lands on a branch from `main`.
- Industries, depots and the things around them. They keep today's models.
- What towns want, levels, prices, how many buildings a level adds (`TOWN_LEVELS`). The economy is untouched.
- New town mechanics (districts, zoning, the player choosing where a town grows).
- Roads themselves: streets stay the game's felt road pieces, and town cars and post vans drive them as now.

## Anti-goals

- Two looks in one town: new rows beside today's little houses and towers. Players never see a half-converted town.
- A town that only looks right at one size. A hamlet of six buildings must look as considered as a city.
- Thin towers. No building is taller than about twice its width on the street.
- A saved town that changes shape (buildings moving squares, streets re-laid) when it's opened in the new build.
- A look that needs a new material or a draw call per colour.

## The design

### 1. A lot is a tile, and a building fills its frontage

Today a lot is a square with a model in the middle. In this design a lot is a tile, drawn edge to edge:

- **Pavement**: a pale stone slab over the whole square, 2.4 mm high, so pavements join along a street.
- **Building line**: 14 mm back from the street edge. Lamps, a postbox, a small tree stand on that strip.
- **The building**: the full 72 mm along the street (70 mm drawn, so a hair of shadow shows between neighbours) and
  40 to 46 mm deep.
- **Garden**: the strip behind, green, with a tree or two. Two rows back to back meet garden to garden.

One building record of one square is drawn as one **slice** 72 mm wide: either one wide building (a shop, a town
house, a villa) or a pair of narrow houses 34 mm each under their own roofs. Two squares side by side are two slices
that read as one terrace, or one long building (a bakery, a café, a post office, the apartment block). The count of
buildings in a town stays what the game says it is: a pair of narrow fronts is one building.

Slices have windows printed on all four sides. Where two slices touch, the side windows are simply inside the join, so
there are no "end" and "middle" variants to choose between.

A corner lot (growth already marks `corner`) takes a corner slice: a shop with a second front on the side street.

### 2. Height: wide and low, taller in the middle

- A storey is 20 mm (the apartment block's 24), as now. A slice is stacked from parts: a ground block with the door or
  shop front, plain floor blocks, and a roof part. (Today's stack ends in the whole original house; here the top is
  only a roof, so one set of parts makes every height.)
- Which buildings rise, and when, stays as it is (`storeysFor`, the rings and bands by town level), and the storeys a
  building has gained stay saved on its prop as now.
- The most a slice is drawn with, in all, counting its ground floor: narrow houses and shops 3 storeys, town houses
  and the apartment block 4, cottages and bungalows 2. A saved house that has gained more than its slice allows is
  drawn at the most; its saved number isn't lowered. A slice 72 mm wide and 4 storeys (about 84 mm to the eaves) is
  wider than it is tall from the street.
- Roof shapes: ridge along the street (most), a gable to the street (about one narrow house in five), a hipped roof
  (town houses, corner shops, the apartment block).

### 3. Colour: a palette per town

Each town draws, from its seed, a palette: five body colours and two roof colours (three from a city on), from a
fixed set that goes together (the spike's cream, red, mustard, sage, blue; tile red, slate, moss). Doors and shop
fascias take a contrasting colour from the same palette. Frames are always cream, panes always dark.

A slice's body and roof colours are fixed when it is built and never change after: drawn from a hash of its squares
and the town, skipping the body colour of any slice already standing beside it. Both are saved in the prop's
`variant`, the field that holds today's hue shift: a number that names a body colour and a roof colour from the fixed
set (not from the town's palette, so the number means the same in every town). A building from an old save keeps the
number it has (0 to 3), read the same way, so it has one steady colour too (two neighbours in an old town may match).
This replaces the three hue shifts (`COLOR_VARIANTS`) for town buildings.

### 4. What the models are

In today's material: the game's lacquer, baked into the one vertex-coloured `paint` batch. Printed windows and doors
are flat coloured faces in the same mesh, lifted 0.3 to 0.7 mm. So a town still costs one draw call for all its paint.

To make (Blender, by script, as every model is; a new `tools/blender/bldg_rows.py` beside the others):

| Part | Variants |
| --- | --- |
| Narrow house pair: ground, floor, roof | 3 ground fronts, 2 roofs (ridge, gable) |
| Wide house (town house, villa, brick house): ground, floor, roof | 3 fronts, 2 roofs |
| Low house (cottage, bungalow) | 2 |
| Shop: ground (window, door, fascia, awning), floor, roof | corner shop, toy shop, plain shop |
| Two-square buildings: bakery, café, post office, apartment block, terrace | one each |
| Lot tile: pavement, garden | plain, corner |
| Street dressing on the tile | lamp, tree (round, cone), postbox, bench |

Landmarks, civic places and the station (church, town hall, fire and police stations, hospital, school, library,
market hall, college, the places from the civic design, the station buildings: about 25 models) are remodelled in the
same style as a second step. They keep their footprints and their names.

### 5. How a town fills

The street pattern stays: Station Road, side streets a block's depth out, two lots between parallel streets, ribbons
toward other towns, a far side behind the station. Two things change: the length of a row, and the order lots are
taken in, so rows fill.

**Rows are three squares.** Today every third lot along a street is held back for a side street (`GAP_EVERY = 3`), so
a row is two squares and then a hole. Here the opening is every fourth square: three lots, then an opening. The fill
rules below never build on an opening while any other lot is free, as now. An opening no side street has taken is
drawn as flat pavement, not as bare grass, so a street has no holes at any size. (Flat, with nothing standing on it:
as built, the dressing can't see the player's track or props, which may be on that square.)

1. **Join a row first.** A new building takes a lot that touches an existing building on the same side of the same
   street, if there is one within reach. Among those, the one nearest the station.
2. **Then face a row.** Otherwise a lot directly opposite an existing building.
3. **Then start a row** at a street's station end.
4. **Lay street** only when 1 to 3 find nothing, as now.
5. **No building off a street.** The fall-back onto greens and the grass border (`spreadLots`) stays only for towns
   that truly have no street lot left.

**Lots that aren't a house on a street:**

- A building with no saved front (an old save's, or one from the fall-back) faces the nearest street square, or the
  station if no street is within two squares, and gets a tile like any other.
- A plain house on a 2 × 2 block is two wide slices on the street side with one garden court behind.
- Treats and places that share a building's record (a fountain, a playground, bunting, a lily pond, a beach) keep
  their own models and get no pavement tile or building line: they are greens, not houses.

The two-square share (`PAIRED`, about 35%) stays. Shops still start at 6 buildings and second floors at 12.

Because lots are chosen by rules and hashes with no random stream, a town grown from here on is as repeatable as now.
A new map's towns (6 to 14 buildings at the start) are laid out by the same rules, so new maps start in rows.

### 6. Saved games

Nothing in the saved map changes. A saved town's buildings are where they were; they are simply drawn as slices and
tiles. A saved town that grew as a scatter draws as detached slices on their tiles until growth fills the gaps
between them; rule 1 above pulls new buildings into those gaps, so old towns tidy themselves as they grow.

A player can still pick up, move and remove a town's building as now (`releaseBuilding`); its tile goes with it, and
the square it leaves is grass. The tray is unchanged: it offers no town houses today, and gains none.

Town props remember which model a building was dressed with. On load, a town building's old model name maps to its
new slice (a table: townhouse and narrow house to the narrow pair, brick and timber house to the wide house, and so
on). Buildings a player placed by hand in Sandbox from the tray keep their old models: those stay in the catalogue.

### 7. Phones

- One draw call for paint, as now. No new material, no textures.
- Triangles: the spike block is 16,500 for five buildings with their dressing, far too many. The target is a town at
  any level drawing no more than 1.3 times the triangles it does today, measured on the perf harness's late map, with
  bevels cut in two steps, window corners square beyond play zoom, and dressing counted.
- Budgets move only with the numbers, in the same commit (`tools/perf/budgets.json`, `memory-budgets.json`).
- Rebuilds stay incremental: a new building builds its own slice and tile; nothing standing is rebuilt.

### 8. Rolling it out

Built behind a dev-only switch until every town model is in the new style (houses and shops, then landmarks and the
station), so no player sees a mixed town. Then the switch goes and the old town models leave town dressing (they stay
in the catalogue for Sandbox props already placed). The wiki's pictures are drawn again (`npm run wiki:pictures`).

### 9. Testing

- `e2e:town-shape` grows Larkfield a level at a time, as now, and checks what this is for: at every level each
  building fronts a street; from a village on at least 80% of buildings touch a neighbour; no building is taller than
  twice its street width; a picture at each level.
- A unit test of the fill order on a bare map: the first six buildings form rows, none alone.
- A unit test that a saved scatter town's buildings stay on their squares and that the next buildings fill its gaps.
- The play-through (`src/play/balance.test.ts`) and the bands are unchanged: building counts per level are the same.
- `npm run perf:check` before and after, numbers in the commit.

## Order of work

1. Slices and tiles for houses and shops, stacked storeys, the town palette; behind the dev switch; pictures of
   Larkfield at each level beside today's.
2. The fill order, with its tests, and the same pictures again.
3. Landmarks, civic places and the station in the style.
4. Perf pass to the budgets; the switch removed; wiki pictures.

Steps 1 and 2 can be judged from pictures before 3 is started.

## For the developer to decide

1. **Towns only.** Industries and depots keep today's models. The spike block beside today's carousels and trees did
   not look like two games, so I think this holds, but it is your eye that decides.
2. **One building record, one slice.** A one-square building may be drawn as a pair of narrow houses, so a town of 27
   "buildings" shows more than 27 front doors. The alternative is one house per square, each 72 mm wide: simpler, but
   every house is then as wide as a shop.
3. **Old towns tidy as they grow** and are not re-laid on load. The alternative, re-laying a saved town into rows,
   moves buildings a player may have built track around.
4. **All at once.** Nothing reaches players until landmarks and the station are done too. The alternative is to ship
   houses and shops first and accept old-style landmarks among new rows for a release or two.
5. **Seeds make different towns.** A new map's towns are laid out by the same growth rules, and there is no
   generator version. With the new fill order and three-square rows, a seed or map code (the starter map's 7
   included) gives the same land but towns with their buildings on different squares. Saved games are untouched. I
   propose accepting that: the e2e suites and balance bands written on Larkfield are run and re-based in the same
   change. The alternative is a generator version saved with the map, old codes laying towns out the old way: more
   code, and old-order towns would have two-square rows forever.
6. **Where it lives.** A fresh branch from `main`, taking only the block's Blender script as a starting point. The
   spike branch was cut from the House branch and stays an experiment.

## Left to the builder

Module and file names; the exact palette values; how slices are keyed in the props library; the triangle count of
each part inside the budget; the mapping table from old model names; the dev switch's name.
