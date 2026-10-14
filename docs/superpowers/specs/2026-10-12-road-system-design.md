# Road system — design

Status: **agreed** (2026-10-12). Roads are a first-class system: pieces that snap, each filling one square (a curve
is a quarter turn within one square). Generated maps have no roads between towns, only town gates to build from. Roads meet track at level crossings, road
pieces can join town streets, and roads are in both modes. Each square's piece is saved as a byte. Vehicles and
one-way roads come later, and the foundation leaves room for both. Nothing is built yet.

## 1. Roads today

- **Squares.** A road is a surface on the map grid. `SURF_ROAD` covers town streets, which are the town squares left
  over after buildings. `SURF_LANE` covers country lanes. Both are in `src/landscape/grid.ts` and sit at height 0.
- **Generated.** `generate.ts` lays lanes out from a town's platform side and from the plot-edge stubs (`regionStubs`
  and `edgeContract` in `edges.ts`), then joins them with `joinLanes` / `cheapestPath`. The player can't add or remove
  a road.
- **Drawn as felt.** `buildFeltTiles` (in `render/dressing/felt.ts`) traces road and lane squares into smoothed felt
  ribbons, one set per 2×2-plot tile, cached by a hash of each tile's squares. Roads have no markings.
- **Track.** Town streets block track (`clearance.ts`). Lanes don't: ground-level track over a lane square makes a
  level crossing (`findCrossings` in `crossings.ts`, drawn by `CrossingsView`).
- **Saves.** Surfaces are saved one byte per square (`landscape-data.ts`). Track is a piece list (`save.ts` v8).
- **Catalogue.** Road straight, curve, T-junction, roundabout, zebra and car park exist only as models. Their sizes
  don't match the 72 mm square (a 96 straight, 48 felt on a 56 board).
- **Next door.** Land editing (branch `claude/bold-bohr-fvqt5w`) keeps road and lane squares at height 0, rebuilds
  towns from catalogue models, and turns the tray into data (`src/ui/tray-catalogue.ts`). A Roads tab is planned
  there for this work.

## 2. Chosen: square road pieces

Every road piece fills one 72 mm square. Its road ends sit at the middle of the square's edges, so the pieces are:

| piece | ends (before turning) |
| --- | --- |
| straight | W, E |
| curve | W, S: a quarter turn of radius 36 about the SW corner, all within the square |
| T-junction | W, E, S |
| crossroads | W, E, N, S |
| dead end | W, with a rounded turning end |
| zebra crossing | a straight with stripes and beacons |

Each piece can be turned in 90° steps, which gives 1–4 distinct orientations depending on the piece.

**Foundation: ports, not shapes.** A piece is data: a list of *ports* on its square's edges, and the links between
them. A port is an edge (N/E/S/W) and a slot: the middle of the edge for a two-way road, or the left or right half for
a one-way road half a square wide, with a direction (in or out). Two squares join where they have matching ports on
their shared edge (two-way to two-way, or a one-way out to a one-way in at the same half). The pieces above use only
middle ports. One-way half-square pieces (a one-way straight on either half, a pair of opposite one-ways) are new
entries in the piece table later, with no change to the data, the save or snapping. Vehicles later follow the links.
Drawing, snapping, crossings and clearance all read the piece table, never a hard-coded shape.

**Snapping.** From the Roads tab, the player picks a piece and drags it. It snaps to the square under the finger and
auto-turns so that as many of its ends as possible meet road ends on the neighbouring squares. Neighbouring ends can
come from other pieces or town streets. A tap on a placed piece turns it, and dragging it off removes it.
Snapping needs no connector search: each piece checks the four neighbouring squares, which costs a few lookups per
pointer move.

**Joins are explicit.** Two road squares join only where both have an end on their shared edge. This allows parallel
roads and dead ends next to each other, which a "join every road neighbour" rule would not.

**Where a piece can go.** On grass at height 0 with nothing standing on it. Trees step aside the way they do for
track. A piece can't go on a river, building, station, depot, field, the shed or a hill. It can't go on a town square
either, but it can join one (§3).

**Size on the square.** The road felt is 56 wide on a 64 board, centred on the square (two 28 mm lanes, so a 26 mm toy car fits its lane). That is the catalogue's look
scaled to the square, and it leaves a 4 mm verge on each side. A curve.s felt runs from radius 8 to 64.

**Auto roads (added after the user tried laying roads).** The first item in the Roads tab, "Road", is an auto road.
Each auto square takes its shape from the roads around it: one neighbour makes a straight on through, two a straight
or a bend, three a T, and four a crossroads. Placing, moving or deleting any road reshapes the auto squares beside it
in the same undo step, so a road laid beside another bends to meet it and straightens again when that road goes.
Auto squares join every auto square beside them at the same level, and every other road with an end facing them
(town gates, open street ends, bridges, ramps). They never join the side of a hand-laid piece. The hand-laid pieces
(Straight, Bend, T-junction and the rest) are never reshaped, so parallel roads and deliberate dead ends still work.
Turning an auto road by hand makes it a hand-laid piece. An auto road under a level crossing keeps a shape the track
can cross. A road byte's bit 5 marks an auto road (piece codes stay under 32), so saves don't change format.

## 3. Generated roads and town streets

- **Town streets are road pieces, laid streets first (chosen).** See §3a.
- **No generated roads between towns (chosen).** The generator stops laying country lanes (`joinLanes`, and the
  lane stubs that cross plot edges). Rivers, towns and trees must come out exactly as before, so dropping the lanes
  must not change any other random stream: the generator still draws the numbers the lanes used. Hills change only
  where a lane used to flatten them. On 200 seeds, rivers, towns, buildings and depots come out the same on 199. On
  the last one (seed 156), the first attempt no longer passes the check that every town can reach every other, so
  the generator retries and makes a different map.
- **Places to snap into towns.** Each town gets one or two *town gates*: a straight road piece on the grass just
  outside the town, leading out of one of its streets. One goes on the platform side and one on the far side, each as
  nearly straight out from the centre as there's room for. If neither side has room, one goes out of a side instead.
  A gate square one block up is brought down to the felt, as long as that leaves no step of two beside it. Gates
  never go on a station's approach or beside its track. A gate is an ordinary piece, so the player can see where to
  start a road, and can remove or extend it. With §3a, gates sit at the outer end of each main street.
  Measured on 200 seeds: 98.7% of towns get a gate, 1.7 per town on average.
- **Old saves.** Lanes already in a save are kept. On load, a lane square without a piece gets the piece that fits
  its lane neighbours.

## 3a. Town streets (chosen: streets first)

Town interiors are made of road pieces and are read-only to the player. The street plan is laid first, then
buildings go on lots facing the streets. The aim is a network that makes sense (every building on a street, every
street reaching the station and a gate) and looks like a small toy town.

**Town size (chosen).** Towns grow from a radius of 210 mm (about 13 squares besides the station) to 288 mm (four
squares, about 27), so each side has room for a street and houses.

**The plan.** A town is a disc of squares (radius 288 mm, four squares) around its station. The track runs
through it along a map axis, and the platform is on one side. The plan works in the town's own axes: *along* the
track and *out* to each side. `planTown(grid, town)` in `src/roads/town-plan.ts` is pure and its own random stream,
and gives:

- **Station Road:** on each side, the row two squares out from the track: along the platform's front on the platform
  side, and one row of houses back from the track on the far side. It runs as far as the town does, and its ends stay
  open for roads laid on.
- **Main street:** on each side, from the middle of Station Road straight out to the town's edge. Its outer end
  leads on to that side's town gate.
- **Lots:** every other town square that touches a street is a building lot, 1 or 2 squares along the street. Each
  lot records the street it faces (its door side). Corners can face either street.
- **The rest:** squares that touch no street stay as town squares without a road (a little green). Track still
  can't cross them, and they're left free for a fountain, trees or a bandstand.
- **Pieces:** each street square gets the piece for its street neighbours (straight, bend, T, crossroads, or a
  rounded dead end where a street stops). Street squares stay `SURF_ROAD` with a road byte, so track still can't
  cross them and the player can't change them.
- The near and far sides aren't joined inside the town, because the track runs between them. Each side has its own
  gate, so the player's roads can join them up outside the town, over a level crossing.

Measured on 60 seeds: per town, 8.4 buildings (4.6 before), 14.8 street squares, 0.6 greens and 1.5 gates.
Generation takes the same time (12.7 ms a map), with 6 towns a map as before.

**Buildings.** Today's house and shop records go on the lots: one building per lot, with its door facing the street.
Land editing's L4 (catalogue towns) then chooses what model stands on each lot, from the lot's size and facing. Town
furniture keeps going along the street edges. Every seed gives a different town from today, which the user has
accepted.

**Old saves.** Town street squares saved without road bytes are still drawn as felt, as before, so old towns keep
their look. The felt draws only street squares that have no road piece.

**The player's roads** join a town only at its gates or where a street ends at the town's edge, where a street has
an open end. A road built up against the side of a street doesn't join it.

## 3b. Rivers and hills (bridges and ramps)

Measured on 40 maps, with roads only on level grass, just 29.7% of town pairs could ever be joined by road. Rivers
were the main barrier, and hills the rest.

- **Road bridge:** a one-square piece that goes only on a river square, which stays river underneath. It's a wooden
  deck humped 9 mm over the water, with low parapets. A wider river takes two bridges in a row.
- **Roads on hills:** any piece goes on a hilltop square, at that square's height. Road ends carry a height (`Port.rise`,
  in half blocks), so two roads join only where their ends meet at the same level.
- **Ramp:** climbs one block (64 mm) over two squares on the lower ground, a bottom half and a top half (24° each). The
  tray has one Ramp item, and the half and its direction are chosen from the ground and the roads beside it.
- **Result:** with bridges and ramps, 100% of town pairs can be joined, and no town is left without a way out.
- Level crossings and the track rules measure height from the square's ground, so they work on hilltops too.

## 4. Roads and track: level crossings

- Ground-level track over a road square makes a level crossing, as lanes do today. Player road squares stay
  `SURF_LANE`, so `findCrossings` and `CrossingsView` work unchanged.
- **Rule:** a straight or zebra road square can be crossed only across its run, not along it. Curves, junctions and
  dead ends can't be crossed, so track can't run down a road. The placement check applies this rule to track and to
  roads alike.
- Track on a bridge or riser passes over a road, as it does now.
- Crossings are recomputed when a road piece is placed or removed, as well as when track changes.
- Road-over-rail bridges are deferred, because they would lift roads off height 0.

## 5. Vehicles

Vehicles come later. A road graph comes straight from the squares: a node per square and an edge for each pair of
matched ends. A later step can drive cars along it and stop them at lowered barriers.

## 6. Saves

**Chosen: a byte per square.** The grid gains a `road` byte array beside `height`, `surface` and `feature`. 0 means
no road. Otherwise the low 6 bits hold the piece id (up to 63 pieces, leaving room for one-way and later pieces) and
the high 2 bits hold the turn. A road square's surface is also `SURF_LANE`, so existing code that reads surfaces
(generation's flat ground, clearance, the crossing finder) keeps working. One setter in `grid.ts` keeps the two in
step.

Each plot in the landscape save gains an optional `road` base64 string. When it's missing (older v8 saves), lane
squares get pieces derived from their neighbours, as the generator does, so the save stays at v8.

## 7. Drawing

- **Recommended:** one model per piece type, built at the square size, with each tile's road squares drawn as one
  instanced mesh per type (or merged per tile, keyed like the felt tiles by a hash of that tile's road squares).
  Placing a piece rebuilds one tile.
- Road and lane squares come out of the felt ribbons. Town streets stay in them.
- The boards receive shadows but don't cast them, so road changes don't trigger shadow redraws.

## 8. Performance

- **Drag:** snapping checks four neighbouring squares, and clearance checks one square plus the track near it.
  Target: under 1 ms per pointer move on a phone.
- **Place or remove:** set the square, `grid.touch`, rebuild one road tile and recheck crossings near that square.
  Target: under 10 ms.
- **Idle:** nothing new runs per frame.
- Commits record the move time, place time, idle CPU and frame time.

## 9. Modes

**Chosen: both modes.** The Roads tab is in Sandbox and Game mode. Roads are free in Game mode for now. Costs and
goals are deferred.

## 10. Steps

1. **R1 Pieces and data.** The piece table (ports, links, turns), the `road` byte per square with its setter, the
   piece that fits a set of neighbours, and the save field. Unit tests cover ports under turns, joins and round trips.
2. **R2 Drawing and generation.** Road tiles are drawn from the pieces, and road squares leave the felt. Generation
   stops laying lanes and adds town gates, with rivers and towns unchanged. Before/after frame time and tile build
   time go in the commit.
3. **R3 Laying.** The Roads tab, with drag, snap, auto-turn, tap to turn, remove and undo. Pieces are saved.
4. **R3b Town streets.** `planTown`: streets, lots and pieces; buildings on lots; gates at the main streets' ends;
   old saves' streets still drawn as felt. Worked out with land editing (L4). Tests run on 200 seeds: every lot faces
   a street, every street reaches the station's road and a gate, and towns stay reachable. Screenshots go in the
   commit.
5. **R4 Crossings.** The across-only rule for track and roads, plus crossing recompute on road edits.
6. **R5 Zebra and dead-end polish.** Beacons are animated only while in view.

## 11. Coordination

- **Tray:** a Roads tab in `tray-catalogue.ts`, on the land-editing branch, once that branch is on main.
- **`grid.ts`:** the `road` byte array (grown with the others) and one setter.
- **`landscape-data.ts`:** the optional `road` string per plot.
- **`generate.ts` / `edges.ts`:** stop laying lanes, without disturbing other random streams, and add town gates in
  a small pass at the end.
- **Towns (`generate.ts` building placement, L4):** streets and lots come from `planTown` (this work), and what
  stands on a lot comes from land editing's L4. Agreed with that session before the code changes.
- **`felt.ts` / `landscape-view.ts`:** lanes leave the felt ribbons, and a road-tiles group is added beside them.
- **`clearance.ts`:** the across-only rule.

## Deferred

- Road-over-rail bridges.
- Multi-square pieces: roundabout, wide curves, car park.
- Bus stops, traffic lights and street furniture beside roads.
- A back street in deeper towns, and town greens with something on them (a fountain, a bandstand).
- Vehicles on roads.
- Road costs and goals in Game mode.
- One-way roads half a square wide: the port model has room for them, but no pieces yet.
- Laying road pieces inside towns, or editing town streets.
