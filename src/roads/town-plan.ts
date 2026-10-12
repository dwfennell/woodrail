import { CELL, FEAT_NONE, SURF_TOWN, type LandscapeGrid } from "../landscape/grid";
import { pieceForEdges, type Edge } from "./pieces";

/** A town as the street plan sees it: its centre (a square centre, on the station line), heading and squares. */
export interface TownSite {
  centre: { x: number; z: number };
  /** The station's heading: along a map axis. The platform is on its +lateral side. */
  heading: number;
  cells: readonly number[];
}

/** Squares a building can stand on, side by side along a street, with the edge its front door faces (onto the street). */
export interface Lot {
  cells: number[];
  front: Edge;
  /** On a corner: it touches two streets, or a street on two sides (a good spot for a shop). */
  corner: boolean;
  /** On a main street (lots come in that order: main streets first, then Station Road's). */
  main: boolean;
}

export interface TownPlan {
  /** Street squares, each with the road byte that joins it to its street neighbours. */
  streets: Map<number, number>;
  lots: Lot[];
  /** Where each side's main street leaves the town: the street square at its end and the edge it leaves by. */
  exits: { cell: number; edge: Edge }[];
  /** Station Road's ends: open to a road laid on beyond them (no gate). */
  ends: { cell: number; edge: Edge }[];
}

/**
 * A town's street plan, laid before its buildings (see the road-system design, §3a). On each side of the station:
 * Station Road, the row two squares out from the track (along the platform's front on the platform side, a row of
 * houses back from the track on the far side), and a main street from its middle straight out to the town's edge,
 * where the town's gate continues it. Every other town square beside a street is a lot facing that street (Station
 * Road first); the rest are left as greens. Station Road's ends stay open for roads laid on. `pair()` decides whether two neighbouring lots on the same
 * street become one long building (the caller's random stream).
 */
export function planTown(grid: LandscapeGrid, site: TownSite, pair: () => boolean): TownPlan {
  const own = new Set(site.cells);
  const open = (i: number) => i !== -1 && own.has(i) && grid.surface[i] === SURF_TOWN && grid.feature[i] === FEAT_NONE;
  // Town axes in squares: along the track, and out to the platform side.
  const ac = Math.round(Math.cos(site.heading));
  const ar = Math.round(Math.sin(site.heading));
  const lc = -ar;
  const lr = ac;
  const cc = Math.floor(site.centre.x / CELL);
  const cr = Math.floor(site.centre.z / CELL);
  const at = (a: number, b: number) => grid.index(cc + a * ac + b * lc, cr + a * ar + b * lr);
  /** The grid edge (+col, +row, −col, −row) that points along (dc, dr). */
  const edgeOf = (dc: number, dr: number): Edge => (dc === 1 ? 0 : dr === 1 ? 1 : dc === -1 ? 2 : 3);

  const streets = new Map<number, number>();
  /** Street squares by street, in order: Station Road first, so lots face it when they can. */
  const order: number[][] = [];
  const mainStreet = new Set<number>();
  const exits: TownPlan["exits"] = [];
  const ends: TownPlan["ends"] = [];
  for (const s of [1, -1]) {
    const high = 2 * s;
    if (!open(at(0, high))) continue;
    const road = [at(0, high)];
    for (const dir of [1, -1]) {
      let a = dir;
      for (; open(at(a, high)); a += dir) road.push(at(a, high));
      if (a !== dir) ends.push({ cell: at(a - dir, high), edge: edgeOf(dir * ac, dir * ar) });
    }
    const main: number[] = [];
    let b = high + s;
    for (; open(at(0, b)); b += s) main.push(at(0, b));
    order.push(road, main);
    for (const i of main) mainStreet.add(i);
    for (const i of [...road, ...main]) streets.set(i, 0);
    const end = main.length > 0 ? main[main.length - 1] : road[0];
    exits.push({ cell: end, edge: edgeOf(s * lc, s * lr) });
  }

  // Pieces: each street square joins its street neighbours, and the main streets' ends lead on out of town.
  const nb = grid.neighbours();
  for (const i of streets.keys()) {
    let mask = 0;
    for (let e = 0; e < 4; e++) if (streets.has(nb[i * 4 + e])) mask |= 1 << e;
    for (const x of [...exits, ...ends]) if (x.cell === i) mask |= 1 << x.edge;
    streets.set(i, pieceForEdges(mask));
  }

  // Lots: town squares beside a street, facing the first street (in `order`) they touch.
  const front = new Map<number, Edge>();
  for (const street of order) {
    for (const i of street) {
      for (let e = 0; e < 4; e++) {
        const j = nb[i * 4 + e];
        if (!open(j) || streets.has(j) || front.has(j)) continue;
        // The lot faces back across the edge it shares with the street.
        front.set(j, ((e + 2) & 3) as Edge);
      }
    }
  }
  const lots: Lot[] = [];
  const taken = new Set<number>();
  for (const [i, f] of front) {
    if (taken.has(i)) continue;
    taken.add(i);
    const cells = [i];
    // Its neighbour along the street (either way), facing the same street, may join it.
    for (const side of [(f + 1) & 3, (f + 3) & 3]) {
      const j = nb[i * 4 + side];
      if (cells.length === 1 && j !== -1 && !taken.has(j) && front.get(j) === f && pair()) {
        cells.push(j);
        taken.add(j);
      }
    }
    // Which sides of the lot have street, and whether any of it is main street.
    let sides = 0;
    let main = false;
    for (const c of cells) {
      for (let e = 0; e < 4; e++) {
        const j = nb[c * 4 + e];
        if (!streets.has(j)) continue;
        sides |= 1 << e;
        if (mainStreet.has(j)) main = true;
      }
    }
    const corner = (sides & 5) !== 0 && (sides & 10) !== 0;
    lots.push({ cells, front: f, corner, main });
  }
  // Main-street lots first (town looks give the first lots the special buildings).
  lots.sort((a, b) => Number(b.main) - Number(a.main));
  return { streets, lots, exits, ends };
}
