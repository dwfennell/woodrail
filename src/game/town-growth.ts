import { FEAT_BUILDING, FEAT_NONE, FEAT_TREE, SURF_GRASS, SURF_ROAD, SURF_TOWN, type Building, type Landscape, type Town } from "../landscape";
import { plotSlotOf, type LandEditor } from "../landscape/edit";
import { rng } from "../lib/rng";
import { growTown } from "../roads/grow-town";

/**
 * Squares a new building stands on (one, or two side by side along a street), the grid edge its front door faces (none:
 * it faces the town's centre), and the new street squares it needs laid first (square → road piece).
 */
export interface Lot {
  cells: number[];
  front?: 0 | 1 | 2 | 3;
  corner?: boolean;
  streets?: [number, number][];
  /** A landmark goes up here (see game/landmarks.ts). */
  landmark?: string;
  /**
   * Buildings that change as the town grows (a house becomes a shop, or gains a floor). By id; an id below zero is the
   * building of lot `-1 - id` of the same `nextLots`.
   */
  changes?: { id: number; kind?: "shop"; floors?: 2 }[];
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
 * Where a growing town's next `n` buildings go: the town's next steps of growth (`growTown`), each a lot facing a
 * street with the street squares laid for it, on level land the editor allows. Then, if the streets can't reach far
 * enough (a river, a hill, track), its greens beside a street and the grass bordering the town. Each is checked by
 * `editor` (clear of track, props and stations' ways in, every town and depot still reachable), counting the lots
 * chosen before it. With `wide`, that many lots take two squares where any lot has them (landmarks are big
 * buildings), at the edge of town if the streets have none (one more lot each). Changes nothing.
 */
export function nextLots(land: Landscape, town: Town, editor: LandEditor, n: number, options: { wide?: number } = {}): Lot[] {
  const g = land.grid;
  const lots: Lot[] = [];
  const taken: [number, number][] = [];
  /** Count squares as built on while checking the rest (reachability); put back before returning. */
  const hold = (cells: readonly number[]) => {
    for (const i of cells) {
      taken.push([i, g.feature[i]]);
      g.feature[i] = FEAT_BUILDING;
    }
  };
  try {
    const steps = growTown(g, { centre: town.centre, heading: town.station.heading, cells: town.cells, buildings: town.buildings }, n, {
      // A quick look at each square; each lot is checked in full (every town still reachable) below.
      canUse: (i) => editor.checkLot([i], false) === null,
      toward: land.towns.filter((t) => t !== town).map((t) => t.centre),
      wide: options.wide,
    });
    for (const step of steps) {
      // Each step builds on the ones before: the first that the editor refuses as a whole ends the run.
      const fresh = step.streets.map(([i]) => i).filter((i) => g.surface[i] !== SURF_ROAD);
      if (editor.checkLot([...step.cells, ...fresh]) !== null) break;
      lots.push({ cells: step.cells, front: step.front, ...(step.corner ? { corner: true } : {}), streets: step.streets, ...(step.changes.length ? { changes: step.changes } : {}) });
      hold([...step.cells, ...fresh]);
    }
    const wideLeft = () => Math.max(0, (options.wide ?? 0) - lots.filter((l) => l.cells.length > 1).length);
    const add = (cells: number[]) => lots.push({ cells, front: streetEdge(land, cells[0]) ?? streetEdge(land, cells[1] ?? cells[0]) });
    // Landmarks still wanting a two-square lot get one beyond the streets if they can.
    if (lots.length < n) for (const cells of spreadLots(land, town, editor, n - lots.length, hold, wideLeft())) add(cells);
    // Still none (the streets' lots are all one square): a two-square lot of its own at the edge of town, as well.
    const more = wideLeft();
    if (more > 0) for (const cells of spreadLots(land, town, editor, more, hold, more)) if (cells.length > 1) add(cells);
  } finally {
    for (let k = taken.length - 1; k >= 0; k--) g.feature[taken[k][0]] = taken[k][1];
  }
  return lots;
}

/** The edge of square `i` that has a street beside it, if any. */
function streetEdge(land: Landscape, i: number): Lot["front"] {
  const g = land.grid;
  for (let e = 0; e < 4; e++) {
    const nb = g.index(g.colOf(i) + EDGES[e][0], g.rowOf(i) + EDGES[e][1]);
    if (nb !== -1 && g.surface[nb] === SURF_ROAD) return e as Lot["front"];
  }
  return undefined;
}

/**
 * The squares for `n` buildings where the streets don't reach: the town's greens beside a street, then grass bordering
 * the town (felling any tree there, and up onto hills), nearest its centre first, spreading outward as it fills.
 * `hold` marks a square chosen (as built on) so the next checks count it. The first `wide` take two squares side by
 * side where they can (the square and a free one beside it).
 */
function spreadLots(land: Landscape, town: Town, editor: LandEditor, n: number, hold: (cells: readonly number[]) => void, wide = 0): number[][] {
  const g = land.grid;
  const own = new Set(town.cells);
  for (const b of town.buildings) for (const c of b.cells) own.add(c);
  const greens = [...own].filter((i) => g.surface[i] === SURF_TOWN && g.feature[i] === FEAT_NONE && streetEdge(land, i) !== undefined);
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
  const lots: number[][] = [];
  const free = (i: number) => g.feature[i] === FEAT_NONE || g.feature[i] === FEAT_TREE;
  const choose = (i: number): boolean => {
    if (!free(i)) return false;
    let cells = [i];
    if (lots.filter((l) => l.length > 1).length < wide) {
      // A two-square lot: this square and a free one beside it (green or grass), if the editor allows both.
      for (const [dc, dr] of EDGES) {
        const nb = g.index(g.colOf(i) + dc, g.rowOf(i) + dr);
        if (nb === -1 || !free(nb) || (g.surface[nb] !== SURF_GRASS && g.surface[nb] !== SURF_TOWN) || (own.has(nb) && g.surface[nb] !== SURF_TOWN)) continue;
        if (town.buildings.some((b) => b.cells.includes(nb))) continue;
        if (editor.checkLot([i, nb]) === null) {
          cells = [i, nb];
          break;
        }
      }
    }
    if (cells.length === 1 && editor.checkLot([i]) !== null) return false;
    lots.push(cells);
    hold(cells);
    for (const c of cells) own.add(c);
    return true;
  };
  for (const i of greens.sort(byDistance)) if (lots.length < n) choose(i);
  // Then outward, a square at a time: each new building opens the squares beside it.
  while (lots.length < n) {
    const next = border().find(choose);
    if (next === undefined) break;
  }
  return lots;
}

/**
 * Lay each lot's new streets and put up its building: town squares from now on, recorded in the town (so they save
 * with the map, and the building is dressed with a catalogue model by `addTownProps`). A new building is a one-floor
 * house; as the town grows, its middle changes (the lots' `changes`: houses become shops and gain floors). Returns the
 * plot slots changed (a changed building's model must be dressed again: see `changedBuildings`).
 */
export function buildOnLots(land: Landscape, town: Town, lots: readonly Lot[]): number[] {
  const g = land.grid;
  const r = rng((Math.imul(land.seed, 97) + town.id * 389 + town.buildings.length * 31 + 7) >>> 0);
  const slots = new Set<number>();
  const claim = (i: number) => {
    if (!town.cells.includes(i)) town.cells.push(i);
    slots.add(plotSlotOf(i));
  };
  const ids: number[] = [];
  for (const lot of lots) {
    for (const [i, road] of lot.streets ?? []) {
      g.surface[i] = SURF_ROAD;
      g.road[i] = road;
      g.feature[i] = FEAT_NONE;
      claim(i);
    }
    const b: Building = {
      id: land.nextBuildingId++,
      cells: [...lot.cells],
      floors: 1,
      kind: "house",
      roof: Math.floor(r() * 4),
      ...(lot.front !== undefined ? { front: lot.front } : {}),
      ...(lot.corner ? { corner: true } : {}),
      ...(lot.landmark ? { landmark: lot.landmark } : {}),
    };
    for (const c of lot.cells) {
      if (g.surface[c] === SURF_GRASS) g.surface[c] = SURF_TOWN;
      g.feature[c] = FEAT_BUILDING;
      g.owner[c] = b.id;
      claim(c);
    }
    town.buildings.push(b);
    ids.push(b.id);
  }
  for (const lot of lots) {
    for (const c of lot.changes ?? []) {
      const b = town.buildings.find((x) => x.id === (c.id < 0 ? ids[-1 - c.id] : c.id));
      if (!b) continue;
      if (c.kind) b.kind = c.kind;
      if (c.floors) b.floors = c.floors;
      for (const i of b.cells) claim(i);
    }
  }
  for (const s of slots) g.touch(s);
  return [...slots];
}

/** The buildings already standing that `lots` change (their models must be dressed again once they're built). */
export function changedBuildings(lots: readonly Lot[]): number[] {
  return [...new Set(lots.flatMap((l) => (l.changes ?? []).map((c) => c.id)).filter((id) => id >= 0))];
}

/** A lot's centre (for a camera or a puff of sawdust). */
export function lotPoint(land: Landscape, lot: Lot): { x: number; z: number } {
  const g = land.grid;
  const xs = lot.cells.map((c) => g.centreX(g.colOf(c)));
  const zs = lot.cells.map((c) => g.centreZ(g.rowOf(c)));
  return { x: xs.reduce((a, b) => a + b, 0) / xs.length, z: zs.reduce((a, b) => a + b, 0) / zs.length };
}
