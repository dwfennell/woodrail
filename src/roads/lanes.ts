import { SURF_LANE, SURF_ROAD, type LandscapeGrid } from "../landscape/grid";
import { pieceForEdges } from "./pieces";

/**
 * Give road pieces to lane squares that have none (lanes from saves made before road pieces, or from the generator):
 * each gets the piece with an end toward every neighbouring lane or town street. Returns how many it filled.
 */
export function fitLaneRoads(grid: LandscapeGrid): number {
  const nb = grid.neighbours();
  let filled = 0;
  const n = grid.cellCount;
  for (let i = 0; i < n; i++) {
    if (grid.surface[i] !== SURF_LANE || grid.road[i] !== 0) continue;
    let mask = 0;
    for (let e = 0; e < 4; e++) {
      const j = nb[i * 4 + e];
      if (j !== -1 && (grid.surface[j] === SURF_LANE || grid.surface[j] === SURF_ROAD)) mask |= 1 << e;
    }
    grid.road[i] = pieceForEdges(mask);
    filled++;
  }
  return filled;
}
