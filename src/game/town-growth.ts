import { FEAT_BUILDING, FEAT_NONE, SURF_GRASS, SURF_ROAD, SURF_TOWN, type Building, type Landscape, type Town } from "../landscape";
import { plotSlotOf, type LandEditor } from "../landscape/edit";
import { rng } from "../lib/rng";

/** A square a new building can stand on, and the grid edge its front door faces (none: it faces the town's centre). */
export interface Lot {
  cell: number;
  front?: 0 | 1 | 2 | 3;
}

/** How far from its centre (mm) a town may spread: about six squares. */
const MAX_REACH = 6.5 * 72;

/** Grid edges +col, +row, −col, −row. */
const EDGES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/**
 * Where a growing town's next `n` buildings go: first its greens beside a street, then grass bordering the town
 * (felling any tree there, and up onto hills), nearest its centre first, spreading outward as it fills. Each is checked by `editor` (clear of track, props and stations'
 * ways in, every town and depot still reachable), counting the lots chosen before it. Changes nothing.
 *
 * The one place growth asks for room: a street plan that grows (the roads design) can take over here.
 */
export function nextLots(land: Landscape, town: Town, editor: LandEditor, n: number): Lot[] {
  const g = land.grid;
  const own = new Set(town.cells);
  for (const b of town.buildings) for (const c of b.cells) own.add(c);
  const streetEdge = (i: number): Lot["front"] => {
    for (let e = 0; e < 4; e++) {
      const nb = g.index(g.colOf(i) + EDGES[e][0], g.rowOf(i) + EDGES[e][1]);
      if (nb !== -1 && g.surface[nb] === SURF_ROAD) return e as Lot["front"];
    }
    return undefined;
  };
  const greens = [...own].filter((i) => g.surface[i] === SURF_TOWN && g.feature[i] === FEAT_NONE && streetEdge(i) !== undefined);
  const away = (i: number) => Math.hypot(g.centreX(g.colOf(i)) - town.centre.x, g.centreZ(g.rowOf(i)) - town.centre.z);
  const byDistance = (a: number, b: number) => away(a) - away(b) || a - b;
  /** Grass bordering the town (as it is with the lots chosen so far), nearest the centre first. */
  const border = (): number[] => {
    const out = new Set<number>();
    for (const i of own) {
      for (const [dc, dr] of EDGES) {
        const nb = g.index(g.colOf(i) + dc, g.rowOf(i) + dr);
        if (nb !== -1 && !own.has(nb) && g.surface[nb] === SURF_GRASS && away(nb) <= MAX_REACH) out.add(nb);
      }
    }
    return [...out].sort(byDistance);
  };

  const lots: Lot[] = [];
  const taken: [number, number][] = [];
  const choose = (i: number): boolean => {
    if (editor.checkLot([i]) !== null) return false;
    lots.push({ cell: i, front: streetEdge(i) });
    // Count it as built while checking the rest (reachability), and let the town spread from it.
    taken.push([i, g.feature[i]]);
    g.feature[i] = FEAT_BUILDING;
    own.add(i);
    return true;
  };
  try {
    for (const i of greens.sort(byDistance)) if (lots.length < n) choose(i);
    // Then outward, a square at a time: each new building opens the squares beside it.
    while (lots.length < n) {
      const next = border().find(choose);
      if (next === undefined) break;
    }
  } finally {
    for (const [i, f] of taken) g.feature[i] = f;
  }
  return lots;
}

/**
 * Put up a building on each lot: a town square from now on, recorded in the town (so it saves with the map and is
 * dressed with a catalogue model by `addTownProps`). Returns the plot slots changed.
 */
export function buildOnLots(land: Landscape, town: Town, lots: readonly Lot[]): number[] {
  const g = land.grid;
  const r = rng((Math.imul(land.seed, 97) + town.id * 389 + town.buildings.length * 31 + 7) >>> 0);
  const slots = new Set<number>();
  for (const lot of lots) {
    const b: Building = {
      id: land.nextBuildingId++,
      cells: [lot.cell],
      floors: r() < 0.35 ? 2 : 1,
      kind: r() < 0.25 ? "shop" : "house",
      roof: Math.floor(r() * 4),
      ...(lot.front !== undefined ? { front: lot.front } : {}),
    };
    if (g.surface[lot.cell] === SURF_GRASS) g.surface[lot.cell] = SURF_TOWN;
    g.feature[lot.cell] = FEAT_BUILDING;
    g.owner[lot.cell] = b.id;
    if (!town.cells.includes(lot.cell)) town.cells.push(lot.cell);
    town.buildings.push(b);
    slots.add(plotSlotOf(lot.cell));
  }
  for (const s of slots) g.touch(s);
  return [...slots];
}

/** A lot's square centre (for a camera or a puff of sawdust). */
export function lotPoint(land: Landscape, lot: Lot): { x: number; z: number } {
  const g = land.grid;
  return { x: g.centreX(g.colOf(lot.cell)), z: g.centreZ(g.rowOf(lot.cell)) };
}

