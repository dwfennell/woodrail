import { edgesOf, encodeRoad, pieceForEdges, RoadPlacer, setRoadSquare } from "../roads";
import { appendPiece, connectorRef } from "../track";
import type { Town } from "../landscape";
import type { World } from "./world";

/**
 * Test setup for road feeders (roads spec D5, D6) on the starter map (tests only). Shortcuts, named: the road laid
 * square by square as `RoadHand` lays it (each square shaped to join its neighbours), and track joined to a station by
 * `appendPiece`.
 */

/** The shortest road two towns' street ends could have between them (open squares, level), and a way to lay it. */
export function roadBetween(w: World, a: Town, b: Town): { squares: number[]; lay(): void } {
  const land = w.landscape;
  const G = land.grid;
  const nb = G.neighbours();
  const placer = new RoadPlacer(land, w.layout, { inRect: () => false });
  const open = (i: number) => i !== -1 && G.road[i] === 0 && placer.check(i, encodeRoad("curve", 0)) === null && placer.check(i, encodeRoad("straight", 0)) === null;
  // Street ends: a street square, and the open square its piece points at.
  const ends = (t: Town) => {
    const out: [number, number][] = [];
    for (const s of t.cells) {
      if (G.surface[s] !== 2 || G.road[s] === 0) continue;
      for (let e = 0; e < 4; e++) if (edgesOf(G.road[s]) & (1 << e) && open(nb[s * 4 + e]) && G.height[nb[s * 4 + e]] === G.height[s]) out.push([s, nb[s * 4 + e]]);
    }
    return out;
  };
  const targets = new Map(ends(b).map(([s, j]) => [j, s]));
  const from = new Map<number, number>();
  const q: number[] = [];
  for (const [s, j] of ends(a)) if (!from.has(j)) (from.set(j, s), q.push(j));
  let path: number[] = [];
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    if (targets.has(i)) {
      const chain = [targets.get(i)!];
      for (let x: number | undefined = i; x !== undefined; x = from.get(x)) chain.unshift(x);
      path = chain;
      break;
    }
    for (let e = 0; e < 4; e++) {
      const j = nb[i * 4 + e];
      if (from.has(j) || !open(j) || G.height[j] !== G.height[i]) continue;
      from.set(j, i);
      q.push(j);
    }
  }
  // (The chain: a street of A, the road squares, a street of B.)
  return {
    squares: path.slice(1, -1),
    lay: () => {
      for (let k = 1; k < path.length - 1; k++) {
        let mask = 0;
        for (const n of [path[k - 1], path[k + 1]]) for (let e = 0; e < 4; e++) if (nb[path[k] * 4 + e] === n) mask |= 1 << e;
        setRoadSquare(G, path[k], pieceForEdges(mask));
      }
      G.touch();
    },
  };
}

/** Put a town's station on the line: two straights joined to it. */
export function onTheLine(w: World, townId: number): void {
  const station = w.stations.get(townId)!;
  appendPiece(w.layout, "straight-216", false, connectorRef(appendPiece(w.layout, "straight-216", false, connectorRef(station, 1)), 1));
}
