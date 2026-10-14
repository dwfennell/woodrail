import { FEAT_BUILDING, FEAT_NONE, FEAT_TREE, SURF_GRASS, SURF_LANE, SURF_ROAD, SURF_TOWN, type Building, type Landscape, type Town } from "../landscape";
import { plotSlotOf, type LandEditor } from "../landscape/edit";
import { rng } from "../lib/rng";
import { planTown } from "../roads/town-plan";

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
 * Where a growing town's next `n` buildings go. First along its streets as they'd run on (the town's street plan,
 * `planTown`, laid over the land around it): lots facing a street, nearest the centre first, each with the street
 * squares that lead to it. Then, if the streets can't reach far enough (a river, a hill, track), its greens beside a
 * street and the grass bordering the town. Each is checked by `editor` (clear of track, props and stations' ways in,
 * every town and depot still reachable), counting the lots chosen before it. Changes nothing.
 */
export function nextLots(land: Landscape, town: Town, editor: LandEditor, n: number): Lot[] {
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
    for (const lot of streetLots(land, town, editor, n)) {
      if (lots.length >= n) break;
      const streets = (lot.streets ?? []).map(([i]) => i).filter((i) => !taken.some(([t]) => t === i));
      if (editor.checkLot([...lot.cells, ...streets]) !== null) continue;
      lots.push({ ...lot, streets: (lot.streets ?? []).filter(([i]) => streets.includes(i)) });
      hold([...lot.cells, ...streets]);
    }
    if (lots.length < n) for (const cell of spreadLots(land, town, editor, n - lots.length, hold)) lots.push({ cells: [cell], front: streetEdge(land, cell) });
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
 * Lots along the town's streets run on: the street plan laid over the town and the level, open land around it within
 * reach, and every lot of it not built on yet, nearest the centre first, with the new street squares between it and
 * the streets there are now. Changes nothing (squares are marked for the plan and put back).
 */
function streetLots(land: Landscape, town: Town, editor: LandEditor, n: number): Lot[] {
  const g = land.grid;
  const nb = g.neighbours();
  const own = new Set(town.cells);
  const level = g.height[town.cells[0]];
  const away = (i: number) => Math.hypot(g.centreX(g.colOf(i)) - town.centre.x, g.centreZ(g.rowOf(i)) - town.centre.z);
  const isRoad = (i: number) => g.surface[i] === SURF_ROAD || g.surface[i] === SURF_LANE;
  // The area the plan may use: the town, and level land joined to it within reach (roads, or open grass that a
  // building could stand on).
  const area = new Set(own);
  const queue = [...own];
  while (queue.length > 0) {
    const i = queue.pop()!;
    for (let e = 0; e < 4; e++) {
      const j = nb[i * 4 + e];
      if (j === -1 || area.has(j) || g.height[j] !== level || away(j) > MAX_REACH) continue;
      if (!isRoad(j) && (g.surface[j] !== SURF_GRASS || editor.checkLot([j]) !== null)) continue;
      area.add(j);
      queue.push(j);
    }
  }
  if (area.size === own.size) return [];
  // Plan it as all town: roads and grass read as open town squares (trees felled), then put back.
  const saved = [...area].map((i) => [i, g.surface[i], g.feature[i]] as const);
  const roads = new Set([...area].filter(isRoad));
  for (const i of area) {
    if (isRoad(i) || g.surface[i] === SURF_GRASS) g.surface[i] = SURF_TOWN;
    if (g.feature[i] === FEAT_TREE) g.feature[i] = FEAT_NONE;
  }
  const random = rng((Math.imul(land.seed, 131) + town.id * 977 + town.buildings.length * 17 + 3) >>> 0);
  let plan: ReturnType<typeof planTown>;
  try {
    plan = planTown(g, { centre: town.centre, heading: town.station.heading, cells: [...area] }, () => random() < 0.4);
  } finally {
    for (const [i, s, f] of saved) {
      g.surface[i] = s;
      g.feature[i] = f;
    }
  }
  /** The new street squares from `start` back to a street there is now (along the plan's streets), or null. */
  const pathFrom = (start: number): number[] | null => {
    if (roads.has(start)) return [];
    const back = new Map<number, number>([[start, -1]]);
    const todo = [start];
    for (let k = 0; k < todo.length; k++) {
      const i = todo[k];
      for (let e = 0; e < 4; e++) {
        const j = nb[i * 4 + e];
        if (j === -1 || back.has(j) || !plan.streets.has(j)) continue;
        back.set(j, i);
        if (roads.has(j)) {
          const out: number[] = [];
          for (let c = i; c !== -1; c = back.get(c)!) out.push(c);
          return out;
        }
        todo.push(j);
      }
    }
    return null;
  };
  const free = (i: number) => (g.surface[i] === SURF_TOWN || g.surface[i] === SURF_GRASS) && (g.feature[i] === FEAT_NONE || g.feature[i] === FEAT_TREE);
  const out: (Lot & { d: number })[] = [];
  for (const lot of plan.lots) {
    if (!lot.cells.every(free)) continue;
    const c = lot.cells[0];
    const street = nb[c * 4 + lot.front];
    const path = street === -1 ? null : pathFrom(street);
    if (!path) continue;
    out.push({ cells: lot.cells, front: lot.front, corner: lot.corner, streets: path.map((i) => [i, plan.streets.get(i)!]), d: Math.min(...lot.cells.map(away)) });
  }
  out.sort((a, b) => a.d - b.d || a.cells[0] - b.cells[0]);
  return out.slice(0, n * 4).map(({ d: _, ...lot }) => lot);
}

/**
 * The squares for `n` buildings where the streets don't reach: the town's greens beside a street, then grass bordering
 * the town (felling any tree there, and up onto hills), nearest its centre first, spreading outward as it fills.
 * `hold` marks a square chosen (as built on) so the next checks count it.
 */
function spreadLots(land: Landscape, town: Town, editor: LandEditor, n: number, hold: (cells: readonly number[]) => void): number[] {
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
  const cells: number[] = [];
  const choose = (i: number): boolean => {
    if (g.feature[i] !== FEAT_NONE && g.feature[i] !== FEAT_TREE) return false;
    if (editor.checkLot([i]) !== null) return false;
    cells.push(i);
    hold([i]);
    own.add(i);
    return true;
  };
  for (const i of greens.sort(byDistance)) if (cells.length < n) choose(i);
  // Then outward, a square at a time: each new building opens the squares beside it.
  while (cells.length < n) {
    const next = border().find(choose);
    if (next === undefined) break;
  }
  return cells;
}

/**
 * Lay each lot's new streets and put up its building: town squares from now on, recorded in the town (so they save
 * with the map, and the building is dressed with a catalogue model by `addTownProps`). Returns the plot slots changed.
 */
export function buildOnLots(land: Landscape, town: Town, lots: readonly Lot[]): number[] {
  const g = land.grid;
  const r = rng((Math.imul(land.seed, 97) + town.id * 389 + town.buildings.length * 31 + 7) >>> 0);
  const slots = new Set<number>();
  const claim = (i: number) => {
    if (!town.cells.includes(i)) town.cells.push(i);
    slots.add(plotSlotOf(i));
  };
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
      floors: r() < 0.35 ? 2 : 1,
      kind: lot.corner || r() < 0.25 ? "shop" : "house",
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
  }
  for (const s of slots) g.touch(s);
  return [...slots];
}

/** A lot's centre (for a camera or a puff of sawdust). */
export function lotPoint(land: Landscape, lot: Lot): { x: number; z: number } {
  const g = land.grid;
  const xs = lot.cells.map((c) => g.centreX(g.colOf(c)));
  const zs = lot.cells.map((c) => g.centreZ(g.rowOf(c)));
  return { x: xs.reduce((a, b) => a + b, 0) / xs.length, z: zs.reduce((a, b) => a + b, 0) / zs.length };
}
