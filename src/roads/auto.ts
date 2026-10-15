import { SURF_LANE, SURF_ROAD, type LandscapeGrid } from "../landscape/grid";
import { AUTO_ROAD, edgesOf, encodeRoad, isAutoRoad, pieceForEdges, pieceOf, roadsJoin, turnOf, type Edge, type RoadPieceId } from "./pieces";

/**
 * Auto roads: squares that take their shape from the roads around them, so a road laid beside another bends, branches
 * or crosses to meet it, and goes back when that road is taken away. An auto square joins every auto square and every
 * plain road of the player's beside it at its level, and every other road with an end facing it (a street's open
 * end, a bridge, a ramp); it never joins the side of a town street, bridge or ramp. One road beside it makes a
 * straight on through, two a straight or bend, three a T, four a crossroads. Alone, it keeps the turn it has (or is
 * held at). A plain road of the player's that a road is laid against reshapes to meet it (a straight with a free end
 * bends round to it; one joined at both ends becomes a T), and from then on is an auto road itself, so it goes back
 * when that road is taken away.
 */

/** Pieces of the player's that reshape to meet a road laid against them (not bridges, ramps or zebra crossings). */
const PLAIN: readonly RoadPieceId[] = ["straight", "curve", "tee", "cross", "end"];

/** Is square `i` a plain road of the player's, laid by hand (not a town street, bridge, ramp or zebra)? */
export function plainRoad(grid: LandscapeGrid, i: number): boolean {
  const road = grid.road[i];
  return road !== 0 && grid.surface[i] === SURF_LANE && !isAutoRoad(road) && PLAIN.includes(pieceOf(road)!.id);
}

/** The edges (a bit per edge) where square `i`, as an auto road, would join the roads beside it. */
export function autoEdges(grid: LandscapeGrid, i: number): number {
  const nb = grid.neighbours();
  let mask = 0;
  for (let e = 0; e < 4; e++) {
    const j = nb[i * 4 + e];
    if (j === -1) continue;
    const road = grid.road[j];
    const up = grid.height[j] - grid.height[i];
    if (road === 0) {
      // An old save's town street, drawn as felt: open on every side.
      if (grid.surface[j] === SURF_ROAD && up === 0) mask |= 1 << e;
      continue;
    }
    if (isAutoRoad(road) || plainRoad(grid, j) ? up === 0 : roadsJoin(encodeRoad("cross", 0), e as Edge, road, up)) mask |= 1 << e;
  }
  return mask;
}

/**
 * A plain road of the player's at `i`, reshaped to meet a road laid against it: the edges where it joins its
 * neighbours now, and every edge a road beside it reaches toward (an end facing it, or an auto road). Null if nothing
 * new reaches toward it (it stays as it is).
 */
function meet(grid: LandscapeGrid, i: number): number | null {
  const nb = grid.neighbours();
  const road = grid.road[i];
  const has = edgesOf(road);
  let joined = 0;
  let toward = 0;
  for (let e = 0; e < 4; e++) {
    const j = nb[i * 4 + e];
    if (j === -1 || grid.road[j] === 0) continue;
    const up = grid.height[j] - grid.height[i];
    if (roadsJoin(road, e as Edge, grid.road[j], up)) joined |= 1 << e;
    if ((isAutoRoad(grid.road[j]) && up === 0) || roadsJoin(encodeRoad("cross", 0), e as Edge, grid.road[j], up)) toward |= 1 << e;
  }
  if ((toward & ~has) === 0) return null;
  let mask = joined | toward;
  if (mask === 1 || mask === 4) mask = 5;
  else if (mask === 2 || mask === 8) mask = 10;
  return pieceForEdges(mask) | AUTO_ROAD;
}

/** The auto road byte for square `i` given the roads beside it; alone, as a straight at quarter turn `held`. */
export function autoShape(grid: LandscapeGrid, i: number, held: number): number {
  const mask = autoEdges(grid, i);
  if (mask === 0) return encodeRoad("straight", held & 1, true);
  // One road beside it: a straight on through, open at the far end for the next.
  if (mask === 1 || mask === 4) return encodeRoad("straight", 0, true);
  if (mask === 2 || mask === 8) return encodeRoad("straight", 1, true);
  return pieceForEdges(mask) | AUTO_ROAD;
}

/**
 * The squares a change touches, reshaped: after `changes` (square → road byte, 0 to take one away) are made, each
 * auto square among them and beside them, with the shape it takes then, and each plain road of the player's beside
 * them that a road now reaches toward, reshaped to meet it (see `meet`). Changes nothing (the grid is put back).
 * `keep(i, road)` may refuse a reshape (track over the square that the new shape wouldn't let cross): it stays as it is.
 */
export function autoReshapes(grid: LandscapeGrid, changes: ReadonlyMap<number, number>, keep: (i: number, road: number) => boolean = () => false): Map<number, number> {
  const before = new Map<number, number>();
  for (const [i, road] of changes) {
    before.set(i, grid.road[i]);
    grid.road[i] = road;
  }
  const nb = grid.neighbours();
  const out = new Map<number, number>();
  try {
    const near = new Set<number>();
    for (const i of changes.keys()) {
      near.add(i);
      for (let e = 0; e < 4; e++) if (nb[i * 4 + e] !== -1) near.add(nb[i * 4 + e]);
    }
    // The player's plain roads first (they become auto roads), then every auto square with them in place.
    for (const i of near) {
      if (changes.has(i) || !plainRoad(grid, i)) continue;
      const shaped = meet(grid, i);
      if (shaped !== null && !keep(i, shaped)) out.set(i, shaped);
    }
    const met = new Set(out.keys());
    for (const [i, road] of out) {
      if (!before.has(i)) before.set(i, grid.road[i]);
      grid.road[i] = road;
    }
    for (const i of near) {
      const road = grid.road[i];
      // (A road just reshaped to meet keeps that shape: it reaches no further than what reaches toward it.)
      if (!isAutoRoad(road) || met.has(i)) continue;
      const shaped = autoShape(grid, i, turnOf(road));
      if (shaped !== road && !keep(i, shaped)) out.set(i, shaped);
    }
  } finally {
    for (const [i, road] of before) grid.road[i] = road;
  }
  return out;
}
