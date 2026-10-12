/**
 * Road pieces: what can stand on a road square, as data. A piece fills one 72 mm square and is described by its
 * ports (where roads leave the square, on its edges) and the links between them (which ways traffic can go), so
 * drawing, snapping, crossings and, later, vehicles all read this table rather than knowing shapes.
 * See `docs/superpowers/specs/2026-10-12-road-system-design.md`.
 */

/** A square's edges, in the grid's neighbour order: +x, +z, −x, −z. Turning a piece a quarter adds one. */
export const EDGE_E = 0;
export const EDGE_S = 1;
export const EDGE_W = 2;
export const EDGE_N = 3;
export type Edge = 0 | 1 | 2 | 3;

/** Where on its edge a port is: the middle (a two-way road), or a half (a one-way road), as seen facing out. */
export type Slot = "mid" | "left" | "right";

/** Which way traffic uses a port: both ways, or (one-way roads) only into or only out of the square. */
export type Flow = "both" | "in" | "out";

export interface Port {
  readonly edge: Edge;
  readonly slot: Slot;
  readonly flow: Flow;
}

export type RoadPieceId = "straight" | "curve" | "tee" | "cross" | "end" | "zebra";

export interface RoadPieceDef {
  /** Stored in the low six bits of a square's road byte (never 0: that's no road). Never renumber. */
  readonly code: number;
  readonly id: RoadPieceId;
  readonly name: string;
  /** Ports before turning. */
  readonly ports: readonly Port[];
  /** Pairs of port indices traffic can go between (both ways unless the ports say otherwise). */
  readonly links: readonly (readonly [number, number])[];
  /** Ground-level track may cross this square, across the road's run only (a level crossing). */
  readonly trackMayCross: boolean;
}

const two = (edge: Edge): Port => ({ edge, slot: "mid", flow: "both" });

export const ROAD_PIECES: readonly RoadPieceDef[] = [
  { code: 1, id: "straight", name: "Road", ports: [two(EDGE_W), two(EDGE_E)], links: [[0, 1]], trackMayCross: true },
  { code: 2, id: "curve", name: "Road bend", ports: [two(EDGE_W), two(EDGE_S)], links: [[0, 1]], trackMayCross: false },
  { code: 3, id: "tee", name: "T-junction", ports: [two(EDGE_W), two(EDGE_E), two(EDGE_S)], links: [[0, 1], [0, 2], [1, 2]], trackMayCross: false },
  {
    code: 4,
    id: "cross",
    name: "Crossroads",
    ports: [two(EDGE_E), two(EDGE_S), two(EDGE_W), two(EDGE_N)],
    links: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]],
    trackMayCross: false,
  },
  { code: 5, id: "end", name: "Dead end", ports: [two(EDGE_W)], links: [], trackMayCross: false },
  { code: 6, id: "zebra", name: "Zebra crossing", ports: [two(EDGE_W), two(EDGE_E)], links: [[0, 1]], trackMayCross: false },
];

const byCode: (RoadPieceDef | undefined)[] = [];
const byId = new Map<RoadPieceId, RoadPieceDef>();
for (const p of ROAD_PIECES) {
  byCode[p.code] = p;
  byId.set(p.id, p);
}

export const roadPieceDef = (id: RoadPieceId): RoadPieceDef => byId.get(id)!;

/** A square's road byte: 0 for none, else the piece's code in the low six bits and its quarter turns in the top two. */
export const encodeRoad = (id: RoadPieceId, turn: number): number => byId.get(id)!.code | ((turn & 3) << 6);

/** The piece in a road byte, or null (none, or a code this build doesn't know). */
export const pieceOf = (road: number): RoadPieceDef | null => byCode[road & 63] ?? null;

export const turnOf = (road: number): number => road >> 6;

const turned = (p: Port, turn: number): Port => ({ edge: ((p.edge + turn) & 3) as Edge, slot: p.slot, flow: p.flow });

/** Every road byte's ports, turned, worked out once (`[]` for no road and unknown codes). */
const PORTS: (readonly Port[])[] = [];
/** Every road byte's edges with a port, as a bit per edge. */
const EDGES = new Uint8Array(256);
for (let b = 0; b < 256; b++) {
  const def = pieceOf(b);
  const ports = def ? def.ports.map((p) => turned(p, turnOf(b))) : [];
  PORTS[b] = ports;
  for (const p of ports) EDGES[b] |= 1 << p.edge;
}

export const portsOf = (road: number): readonly Port[] => PORTS[road & 255];

/** The edges a road byte has ports on, a bit per edge (1 << edge). */
export const edgesOf = (road: number): number => EDGES[road & 255];

export const opposite = (edge: Edge): Edge => ((edge + 2) & 3) as Edge;

const mirrorSlot: Record<Slot, Slot> = { mid: "mid", left: "right", right: "left" };
const pairFlow: Record<Flow, Flow> = { both: "both", in: "out", out: "in" };

/** Do two ports on either side of one edge meet: the same place on the edge, and traffic able to pass? */
export function portsMeet(a: Port, b: Port): boolean {
  return a.edge === opposite(b.edge) && b.slot === mirrorSlot[a.slot] && b.flow === pairFlow[a.flow];
}

/**
 * Does the road in square `a` join the road in its neighbour `b` across a's `edge`? Only where they have meeting
 * ports there: two roads side by side don't join just because they touch.
 */
export function roadsJoin(a: number, edge: Edge, b: number): boolean {
  const pb = PORTS[b & 255];
  for (const pa of PORTS[a & 255]) {
    if (pa.edge !== edge) continue;
    for (const q of pb) if (portsMeet(pa, q)) return true;
  }
  return false;
}

/** The turns that give a piece a different shape (a straight has two, a crossroads one). */
export function distinctTurns(id: RoadPieceId): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (let t = 0; t < 4; t++) {
    const key = portsOf(encodeRoad(id, t))
      .map((p) => `${p.edge}${p.slot}${p.flow}`)
      .sort()
      .join();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * The turn for a piece dropped on a square, given the road bytes of its neighbours (by edge; 0 for none): the one
 * joining the most of them, then leaving the fewest of its own ends pointing at a road it doesn't join, then the
 * nearest to `held`. Cheap enough for every pointer move (at most four turns × four edges).
 */
export function bestTurn(id: RoadPieceId, neighbours: readonly number[], held = 0): number {
  let best = held & 3;
  let bestScore = -Infinity;
  for (const t of distinctTurns(id)) {
    const road = encodeRoad(id, t);
    let joined = 0;
    let blocked = 0;
    for (let e = 0; e < 4; e++) {
      if (!(edgesOf(road) & (1 << e))) continue;
      const n = neighbours[e];
      if (n && roadsJoin(road, e as Edge, n)) joined++;
      else if (n) blocked++;
    }
    const distance = Math.min((t - held) & 3, (held - t) & 3);
    const score = joined * 16 - blocked * 4 - distance;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** The two-way piece (and turn) with ports on exactly these edges (a bit per edge); none (0) gives a dead end open to the east. */
export function pieceForEdges(mask: number): number {
  mask &= 15;
  for (const def of ROAD_PIECES) {
    if (def.id === "zebra") continue;
    for (let t = 0; t < 4; t++) {
      const road = encodeRoad(def.id, t);
      if (edgesOf(road) === mask) return road;
    }
  }
  return encodeRoad("end", 2);
}
