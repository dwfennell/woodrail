import { FEAT_NONE, SURF_ROAD, type Landscape } from "../landscape";
import { encodeRoad, roadsJoin, type Edge } from "./pieces";

/**
 * The road graph, as Game mode's linked towns need it (roads spec D2): which towns are joined to which by road. A node
 * per road square (a town's street, a lane, a road the player laid, a road bridge), an edge between two squares side
 * by side whose pieces meet (`roadsJoin`, heights and ramps included). A flood fill from each town's streets finds
 * the other towns' streets it reaches.
 *
 * Worked out once per change of the land (keyed by the grid's revision, which every road edit bumps), only when asked,
 * never per frame: a breadth-first walk over the road squares, well under a millisecond on a whole map.
 */

/** Town id → the other towns joined to it by road (empty for none). */
export type TownLinks = ReadonlyMap<number, readonly number[]>;

/** A square's road for joining: its piece, or a crossroads for an old town street square with no piece. */
export function roadAt(land: Landscape, i: number): number {
  const g = land.grid;
  if (g.road[i] !== 0) return g.road[i];
  return g.surface[i] === SURF_ROAD && g.feature[i] === FEAT_NONE ? encodeRoad("cross", 0) : 0;
}

/** Work out which towns are joined by road (see `townLinks`, which caches it). */
export function findTownLinks(land: Landscape): Map<number, number[]> {
  const g = land.grid;
  const nb = g.neighbours();
  // Each town's street squares: where its flood starts, and what tells another town's streets apart.
  const streetOf = new Map<number, number>();
  for (const t of land.towns) for (const i of t.cells) if (g.surface[i] === SURF_ROAD && roadAt(land, i) !== 0) streetOf.set(i, t.id);
  // Joined road squares in one group: a group number per square (−1 not yet reached), filled a group at a time.
  const group = new Int32Array(g.road.length).fill(-1);
  const townsIn: Set<number>[] = [];
  const queue: number[] = [];
  for (const [start] of streetOf) {
    if (group[start] !== -1) continue;
    const id = townsIn.length;
    const towns = new Set<number>();
    townsIn.push(towns);
    group[start] = id;
    queue.length = 0;
    queue.push(start);
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const town = streetOf.get(i);
      if (town !== undefined) towns.add(town);
      const a = roadAt(land, i);
      for (let e = 0; e < 4; e++) {
        const j = nb[i * 4 + e];
        if (j === -1 || group[j] !== -1) continue;
        const b = roadAt(land, j);
        if (b === 0 || !roadsJoin(a, e as Edge, b, g.height[j] - g.height[i])) continue;
        group[j] = id;
        queue.push(j);
      }
    }
  }
  const links = new Map<number, number[]>(land.towns.map((t) => [t.id, []]));
  for (const towns of townsIn) {
    if (towns.size < 2) continue;
    for (const t of towns) for (const u of towns) if (u !== t && !links.get(t)!.includes(u)) links.get(t)!.push(u);
  }
  return links;
}

const cache = new WeakMap<Landscape, { revision: number; towns: number; links: Map<number, number[]> }>();

/** Which towns are joined to which by road, cached by the grid's revision (and the number of towns). */
export function townLinks(land: Landscape): TownLinks {
  const c = cache.get(land);
  if (c && c.revision === land.grid.revision && c.towns === land.towns.length) return c.links;
  const links = findTownLinks(land);
  cache.set(land, { revision: land.grid.revision, towns: land.towns.length, links });
  return links;
}

/** Is this town joined by road to another town? */
export const joinedByRoad = (land: Landscape, townId: number): boolean => (townLinks(land).get(townId)?.length ?? 0) > 0;
