import { FEAT_BUILDING, FEAT_NONE, FEAT_STATION, SURF_GRASS, SURF_ROAD, SURF_TOWN, type Building, type Landscape, type Town } from "../landscape";
import { pieceForEdges } from "../roads/pieces";
import { MAX_REACH } from "./town-growth";
import type { LotChecker } from "./town-moves";
import type { LandBlock } from "../landscape/edit";

/**
 * Game mode (issue #18): a town's street pieces can be dragged about their own town, as its houses can (town-moves.ts),
 * to make room for track. A street square goes onto a town green or onto grass at the town's edge (within its reach),
 * where it joins another of the town's streets. The square it leaves becomes a town green (track may cross a green),
 * or grass again if it was grass the town took at its edge. The town keeps its rules: every house still faces a
 * street (one that faced this square turns to another street beside it, or the street can't go), and a street never
 * goes over track, a prop, a station's way in, or a step in the ground.
 */

/** Why a held street can't go where it's held. */
export type StreetMoveBlock = "not-street" | "other-town" | "not-town" | "station" | "building" | "street" | "no-join" | "faces" | LandBlock;

/** Where a held street would go: its square, the road bytes of every square that changes, and the houses that turn. */
export interface StreetLot {
  from: number;
  cell: number;
  /** Square → road byte after the move (the new square, and the streets beside either square, reshaped). */
  roads: [number, number][];
  /** Houses that faced the street's old square, turned to face another street beside them. */
  turns: { id: number; front: Building["front"] }[];
}

const EDGES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/** The town whose street is on square `i`, or null (not a town street). */
export function streetTown(land: Landscape, i: number): Town | null {
  const g = land.grid;
  if (i < 0 || g.surface[i] !== SURF_ROAD) return null;
  for (const t of land.towns) if (t.cells.includes(i)) return t;
  return null;
}

/** Can the street on this square be picked up and moved within its town? */
export const movableStreet = (land: Landscape, i: number): boolean => streetTown(land, i) !== null;

/**
 * Where the street on square `from` (of `town`), held over square `cell`, would go. Cheap: a few squares around the
 * two looked at, and the checker's look at one square (it runs whenever the square under the finger changes).
 */
export function streetFor(land: Landscape, town: Town, from: number, cell: number, checker: LotChecker): StreetLot | StreetMoveBlock {
  const g = land.grid;
  if (cell < 0) return "off-land";
  if (cell === from) return { from, cell, roads: [], turns: [] };
  if (g.feature[cell] === FEAT_STATION) return "station";
  if (g.feature[cell] === FEAT_BUILDING) return "building";
  if (g.surface[cell] === SURF_ROAD) return "street";
  const nb = (i: number, e: number) => g.index(g.colOf(i) + EDGES[e][0], g.rowOf(i) + EDGES[e][1]);
  /** A street square after the move. */
  const street = (i: number) => i !== -1 && (i === cell || (i !== from && g.surface[i] === SURF_ROAD));
  const own = town.cells.includes(cell);
  if (own) {
    if (g.surface[cell] !== SURF_TOWN) return "not-grass";
  } else {
    // Grass at the town's edge, within its reach: beside one of its squares.
    if (g.surface[cell] !== SURF_GRASS) return "not-town";
    if (Math.hypot(g.centreX(g.colOf(cell)) - town.centre.x, g.centreZ(g.rowOf(cell)) - town.centre.z) > MAX_REACH) return "not-town";
    let beside = false;
    for (let e = 0; e < 4; e++) {
      const j = nb(cell, e);
      if (j !== -1 && j !== from && town.cells.includes(j)) beside = true;
    }
    if (!beside) return "not-town";
  }
  if (g.feature[cell] !== FEAT_NONE) return "taken";
  // It joins another of the town's streets, level with it.
  let joins = false;
  for (let e = 0; e < 4; e++) {
    const j = nb(cell, e);
    if (j !== -1 && j !== from && g.surface[j] === SURF_ROAD && g.height[j] === g.height[cell] && town.cells.includes(j)) joins = true;
  }
  if (!joins) return "no-join";
  // Track, props, a station's way in, and (on grass) every town and depot still reachable: as town growth checks a lot.
  const why = checker.checkLot([cell], !own);
  if (why) return why;
  // Each house that faced the old square turns to another street beside it (along a two-square house's long side).
  const turns: StreetLot["turns"] = [];
  for (const b of town.buildings) {
    if (b.front === undefined || !b.cells.some((i) => nb(i, b.front!) === from)) continue;
    const across = b.cells.length === 2 ? (g.rowOf(b.cells[0]) === g.rowOf(b.cells[1]) ? [1, 3] : [0, 2]) : [0, 1, 2, 3];
    let front: Building["front"];
    for (const e of across) if (front === undefined && b.cells.some((i) => street(nb(i, e)) && !b.cells.includes(nb(i, e)))) front = e as Building["front"];
    if (front === undefined) return "faces";
    turns.push({ id: b.id, front });
  }
  // The road bytes, as a town's streets join (see `growTown`): each street square joins its street neighbours, and a
  // dead end (or a lone square) is a straight, open on for a road laid on.
  const shape = (i: number): number => {
    let mask = 0;
    for (let e = 0; e < 4; e++) if (street(nb(i, e))) mask |= 1 << e;
    if (mask === 1 || mask === 4 || mask === 0) mask = 5;
    else if (mask === 2 || mask === 8) mask = 10;
    return pieceForEdges(mask);
  };
  const roads: [number, number][] = [[cell, shape(cell)]];
  for (const at of [from, cell])
    for (let e = 0; e < 4; e++) {
      const j = nb(at, e);
      if (j === -1 || j === cell || !street(j) || roads.some(([k]) => k === j)) continue;
      const r = shape(j);
      if (r !== g.road[j]) roads.push([j, r]);
    }
  return { from, cell, roads, turns };
}

/**
 * Move the street to `lot` (from `streetFor`): the road bytes, surfaces and the town's squares, and the houses that
 * turn. Returns what puts it all back (undo).
 */
export function moveStreet(land: Landscape, town: Town, lot: StreetLot): () => void {
  const g = land.grid;
  if (lot.cell === lot.from) return () => {};
  const squares = [...new Set([lot.from, lot.cell, ...lot.roads.map(([i]) => i)])];
  const before = squares.map((i) => [i, g.surface[i], g.road[i]] as const);
  const townCells = [...town.cells];
  const townClaimed = town.claimed && [...town.claimed];
  const fronts = lot.turns.map((t) => {
    const b = town.buildings.find((x) => x.id === t.id)!;
    return { b, front: b.front };
  });
  const claimed = new Set(town.claimed);
  // The old square: a town green; or grass again if it was grass the town took at its edge (and there's still open
  // grass beside it), so a street taken out and back leaves the town as it was.
  g.road[lot.from] = 0;
  g.surface[lot.from] = SURF_TOWN;
  if (claimed.has(lot.from)) {
    claimed.delete(lot.from);
    const open = EDGES.some(([dc, dr]) => {
      const j = g.index(g.colOf(lot.from) + dc, g.rowOf(lot.from) + dr);
      return j !== -1 && g.surface[j] === SURF_GRASS && !town.cells.includes(j);
    });
    if (open) {
      g.surface[lot.from] = SURF_GRASS;
      town.cells.splice(town.cells.indexOf(lot.from), 1);
    }
  }
  if (g.surface[lot.cell] === SURF_GRASS) claimed.add(lot.cell);
  g.surface[lot.cell] = SURF_ROAD;
  if (!town.cells.includes(lot.cell)) town.cells.push(lot.cell);
  for (const [i, r] of lot.roads) g.road[i] = r;
  if (claimed.size > 0) town.claimed = [...claimed];
  else delete town.claimed;
  for (const t of lot.turns) town.buildings.find((x) => x.id === t.id)!.front = t.front;
  return () => {
    for (const [i, s, r] of before) {
      g.surface[i] = s;
      g.road[i] = r;
    }
    town.cells.splice(0, town.cells.length, ...townCells);
    if (townClaimed) town.claimed = townClaimed;
    else delete town.claimed;
    for (const f of fronts) f.b.front = f.front;
  };
}

/** What a held street is told where it can't go. */
export function streetMoveMessage(reason: StreetMoveBlock): string {
  switch (reason) {
    case "other-town":
    case "not-town":
      return "A street stays in its own town";
    case "no-join":
      return "A street joins onto the town's streets";
    case "faces":
      return "A house faces this street: move the house first";
    case "station":
      return "That's the station";
    case "building":
      return "There's a house there";
    case "street":
      return "There's a street there already";
    case "track":
      return "There's track in the way";
    case "prop":
      return "Something's standing there";
    case "uneven":
      return "The ground isn't level there";
    case "station-way":
      return "That's the way into the station";
    case "cut-off":
      return "That would shut something in";
    default:
      return "A street goes on one of its town's greens";
  }
}
