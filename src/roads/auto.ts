import { SURF_ROAD, type LandscapeGrid } from "../landscape/grid";
import { AUTO_ROAD, encodeRoad, isAutoRoad, pieceForEdges, roadsJoin, turnOf, type Edge } from "./pieces";

/**
 * Auto roads: squares that take their shape from the roads around them, so a road laid beside another bends, branches
 * or crosses to meet it, and goes back when that road is taken away. An auto square joins every auto square beside it
 * at its level, and every other road with an end facing it (a town gate, a street's open end, a bridge, a ramp); it
 * never joins the side of a piece that has no end there. One road beside it makes a straight on through, two a
 * straight or bend, three a T, four a crossroads. Alone, it keeps the turn it has (or is held at).
 */

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
    if (isAutoRoad(road) ? up === 0 : roadsJoin(encodeRoad("cross", 0), e as Edge, road, up)) mask |= 1 << e;
  }
  return mask;
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
 * The auto squares a change touches, reshaped: after `changes` (square → road byte, 0 to take one away) are made, each
 * auto square among them and beside them, with the shape it takes then. Changes nothing (the grid is put back).
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
    for (const i of near) {
      const road = grid.road[i];
      if (!isAutoRoad(road)) continue;
      const shaped = autoShape(grid, i, turnOf(road));
      if (shaped !== road && !keep(i, shaped)) out.set(i, shaped);
    }
  } finally {
    for (const [i, road] of before) grid.road[i] = road;
  }
  return out;
}
