# Road system — design

Status: **direction chosen** (2026-10-12). Roads are pieces that snap, and every piece fills exactly one square
(a curve is a quarter turn within one square). Roads meet track at level crossings. Road pieces can join town
streets. Vehicles come later. Details still open are marked **Open**. Nothing is built yet.

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

**Snapping.** From the Roads tab, the player picks a piece and drags it. It snaps to the square under the finger and
auto-turns so that as many of its ends as possible meet road ends on the neighbouring squares. Neighbouring ends can
come from other pieces, lanes or town streets. A tap on a placed piece turns it, and dragging it off removes it.
Snapping needs no connector search: each piece checks the four neighbouring squares, which costs a few lookups per
pointer move.

**Joins are explicit.** Two road squares join only where both have an end on their shared edge. This allows parallel
roads and dead ends next to each other, which a "join every road neighbour" rule would not.

**Where a piece can go.** On grass at height 0 with nothing standing on it. Trees step aside the way they do for
track. A piece can't go on a river, building, station, depot, field, the shed or a hill. It can't go on a town square
either, but it can join one (§3).

**Size on the square.** The road felt is 48 wide on a 60 board, centred on the square. That is the catalogue's look
scaled to the square, and it leaves a verge on each side. A curve's felt runs from radius 12 to 60.

## 3. Generated roads and town streets

- **Town streets stay as felt squares.** They are open, plaza-like areas, not lines, so they don't fit pieces. Every
  edge where a town street square meets open grass counts as a road end, so a piece placed there joins the town.
- **Lanes. Open (Q1).** Recommended: generated lanes become road pieces. Lanes are one square wide, so the generator
  gives each lane square the piece that fits its lane neighbours. The map then has one kind of country road, with
  markings, and the player can remove or extend it. The alternative is to leave lanes as felt and only let pieces
  join them.

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

A road square is `SURF_LANE` in the surface bytes, as now, plus its piece and turn. **Open (Q2):**

- **Recommended:** a new optional `roads` array in the landscape save, with entries `{cell, piece, turn}`.
  It is optional, so older v8 saves still load (their lanes get pieces derived from their neighbours) and the save
  stays at v8. This is a small change to `landscape-data.ts`.
- **Alternative:** a fifth byte array per plot. It is simpler to read, but it changes the plot format.

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

**Open (Q3).** Recommended: roads in Sandbox only at first. Game mode, with cost and goals, comes later.

## 10. Steps

1. **R1 Pieces.** Piece defs (ends per turn), the road data per square, and models for each piece. Unit tests cover
   ends and turns.
2. **R2 Drawing.** Road tiles drawn from the pieces. If Q1 is yes, generated lanes get pieces and leave the felt.
   Before/after frame time and tile build time go in the commit.
3. **R3 Laying.** The Roads tab, with drag, snap, auto-turn, tap to turn, remove and undo. Pieces are saved.
4. **R4 Crossings.** The across-only rule for track and roads, plus crossing recompute on road edits.
5. **R5 Zebra and dead-end polish.** Beacons are animated only while in view.

## 11. Coordination

- **Tray:** a Roads tab in `tray-catalogue.ts`, on the land-editing branch, once that branch is on main.
- **`landscape-data.ts`:** the optional `roads` array (Q2).
- **`generate.ts`:** if Q1 is yes, lanes get pieces. This is a small pass at the end, separate from `joinLanes`.
- **`felt.ts` / `landscape-view.ts`:** lanes leave the felt ribbons, and a road-tiles group is added beside them.
- **`clearance.ts`:** the across-only rule.

## Deferred

- Road-over-rail bridges and raised roads; roads on slopes.
- Multi-square pieces: roundabout, wide curves, car park.
- Bus stops, traffic lights and street furniture beside roads.
- Vehicles on roads.
- Roads in Game mode.
- Laying road pieces inside towns, or editing town streets.
