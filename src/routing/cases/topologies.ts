/**
 * The routing cases' track (docs/agents/routing-cases.md): small layouts a player lays, each with the pieces a train may
 * be put down on in running order, its stops by kind, and where signals go. Test-only.
 */
import { appendPiece, connectorRef, getPieceDef, pieceOfRef, type Layout, type PieceTypeId } from "../../track";
import { chain, loopOn } from "../../economy/loop-fixtures";
import { ringTwoLoops, ringWithLoop } from "../scenarios";
import { next, waysFrom } from "../graph";

const S: PieceTypeId = "straight-216";
const C: PieceTypeId = "curve-large";
const STOP: PieceTypeId = "depot-forest";
const BUFFER: PieceTypeId = "buffer-turnback";

export type StopKind = "ends" | "mid" | "loop" | "far";

export interface Topo {
  id: string;
  /** A ring (no line ends on its main way) or a line. */
  ring: boolean;
  loops: number;
  /** Plain pieces a train may be put down on, in running order along the main way (a train "forward" runs this way). */
  places: number[];
  /** Per place: put down unreversed, does a train run the main way (toward the next place)? */
  fwd: boolean[];
  /** Stops by kind: the route a train runs for each (ends: the main way's two ends, or a ring's two stations). */
  stops: Partial<Record<StopKind, number[]>>;
  /** Joints of plain track along the main way, in running order (signal cuts are picked from these), as connector refs leaving the piece the main way. */
  joints: number[];
  /** Joints at the ends of the loops' roads (against the points), inside a loop's main road, and just before the first points the main way. */
  loopEnds: number[];
  inLoop: number[];
  beforePoints: number | null;
  /** A switch on the main way (for a train put down standing on points). */
  points: number | null;
  /** A second line's places (double track, a crossing), for the trains of a second route. */
  alt?: { places: number[]; fwd: boolean[] };
}

const isPlain = (layout: Layout, p: number) => {
  const piece = layout.getPiece(p);
  if (!piece) return false;
  const def = getPieceDef(piece.type, piece.flipped);
  return def.paths.length === 1 && !piece.type.startsWith("depot") && !piece.type.startsWith("buffer");
};
const isSwitch = (layout: Layout, p: number) => {
  const piece = layout.getPiece(p);
  return !!piece && getPieceDef(piece.type, piece.flipped).paths.length > 1;
};

/**
 * From the main way's pieces in running order (`way`, switches and stops too): which way each runs, the places, and the
 * joints between two plain pieces (the ref leaving the first). `closed`: the way comes back to its start (a ring).
 */
function along(layout: Layout, way: number[], closed: boolean) {
  // (Each piece's exit the main way: the connector of it joined to the next piece.)
  const exitOf = (i: number): number => {
    const p = way[i];
    const q = way[(i + 1) % way.length];
    for (let c = 0; c < 4; c++) {
      const j = layout.joinedConnector(connectorRef(p, c));
      if (j !== -1 && pieceOfRef(j) === q) return c;
    }
    return -1;
  };
  const n = closed ? way.length : way.length - 1;
  const exits = way.map((_, i) => (i < n ? exitOf(i) : -1));
  // (The last piece of a line: forward if the one before it leaves into it by its end 0.)
  const fwdAt = (i: number): boolean => {
    if (exits[i] >= 0) return exits[i] === 1;
    const prev = way[i - 1];
    const j = layout.joinedConnector(connectorRef(prev, exits[i - 1]));
    return j !== -1 && j === connectorRef(way[i], 0);
  };
  const places: number[] = [];
  const fwd: boolean[] = [];
  way.forEach((p, i) => {
    if (!isPlain(layout, p)) return;
    places.push(p);
    fwd.push(fwdAt(i));
  });
  const joints: number[] = [];
  for (let i = 0; i < n; i++) if (isPlain(layout, way[i]) && isPlain(layout, way[(i + 1) % way.length]) && exits[i] >= 0) joints.push(connectorRef(way[i], exits[i]));
  const sw = way.find((p) => isSwitch(layout, p)) ?? null;
  let beforePoints: number | null = null;
  for (let i = 0; i < n; i++) if (isSwitch(layout, way[(i + 1) % way.length]) && isPlain(layout, way[i]) && exits[i] >= 0) {
    beforePoints = connectorRef(way[i], exits[i]);
    break;
  }
  return { places, fwd, joints, points: sw, beforePoints };
}

/**
 * A loop's road ends: the joints at both ends of both its roads, against the points (the ref leaving the road's own
 * piece; a pair there guards the way into the road too). And a joint inside its main road (a signal there: issue #31).
 */
function loopJoints(loop: { main: number[]; side: number[] }): { ends: number[]; inside: number[] } {
  const m = loop.main;
  const sd = loop.side;
  return {
    ends: [connectorRef(m[0], 0), connectorRef(m[m.length - 1], 1), connectorRef(sd[0], 0), connectorRef(sd[sd.length - 1], 1)],
    inside: m.length > 1 ? [connectorRef(m[0], 1)] : [],
  };
}

/** ⊐ A ══ (mid) ══ [loop ══ ══]×k ══ B ⊏: a line with k passing loops, a mid stop near A, a stop on the first loop's side road. */
function line(layout: Layout, k: number, opts: { mid?: boolean; loopStop?: boolean; siding?: boolean; spare?: boolean } = {}): Topo {
  const [a, w1, w2, w3] = chain(layout, [STOP, S, opts.mid ? STOP : S, S]);
  appendPiece(layout, BUFFER, false, connectorRef(a, 0));
  const way = [a, w1, w2, w3];
  const loopEnds: number[] = [];
  const inLoop: number[] = [];
  let from = connectorRef(w3, 1);
  let loopStop = -1;
  for (let i = 0; i < k; i++) {
    const l = loopOn(layout, from, [S, S], i === 0 && opts.loopStop ? [STOP] : [S]);
    if (i === 0 && opts.loopStop) loopStop = l.side[1];
    const lj = loopJoints(l);
    loopEnds.push(...lj.ends);
    inLoop.push(...lj.inside);
    const m = chain(layout, [S, S], connectorRef(l.s2, 0));
    way.push(l.s1, ...l.main, l.s2, ...m);
    from = connectorRef(m[1], 1);
  }
  let far = -1;
  if (opts.siding) {
    const sw = appendPiece(layout, "switch", false, from);
    // (An industry's siding (a depot at its end), or a spare one: plain track to its buffer.)
    const siding = chain(layout, [C, S, opts.spare ? S : STOP], connectorRef(sw, 2), [true]);
    appendPiece(layout, BUFFER, false, connectorRef(siding[2], 1));
    far = siding[2];
    way.push(sw);
    from = connectorRef(sw, 1);
  }
  const [e1, e2, b] = chain(layout, [S, S, STOP], from);
  appendPiece(layout, BUFFER, false, connectorRef(b, 1));
  way.push(e1, e2, b);
  const al = along(layout, way, false);
  const stops: Topo["stops"] = { ends: [a, b] };
  if (opts.mid) stops.mid = [w2, b];
  if (loopStop >= 0) stops.loop = [a, loopStop];
  if (far >= 0 && !opts.spare) stops.far = [a, far];
  return { id: `line${k}${opts.siding ? "+siding" : ""}${opts.spare ? "-spare" : ""}`, ring: false, loops: k, ...al, stops, loopEnds, inLoop };
}

/** ▣A ══ ══ ══ (half round) ▣B ══ ══ ══ (half round): a plain ring of 16 pieces (room for four blocks). */
function ring0(layout: Layout): Topo {
  const ids = chain(layout, [STOP, S, S, S, C, C, C, C, STOP, S, S, S, C, C, C, C]);
  if (layout.joinedConnector(connectorRef(ids[0], 0)) === -1) throw new Error("the ring doesn't close");
  return { id: "ring0", ring: true, loops: 0, ...along(layout, ids, true), stops: { ends: [ids[0], ids[8]] }, loopEnds: [], inLoop: [] };
}

function ring1(layout: Layout): Topo {
  const r = ringWithLoop(layout);
  return { id: "ring1", ring: true, loops: 1, ...along(layout, walkMain(layout, r.a), true), stops: { ends: [r.a, r.b] }, loopEnds: loopJoints(r.loop).ends, inLoop: loopJoints(r.loop).inside };
}

function ring2(layout: Layout): Topo {
  const r = ringTwoLoops(layout);
  const way = walkMain(layout, r.a);
  return { id: "ring2", ring: true, loops: 2, ...along(layout, way, true), stops: { ends: [r.a, r.b] }, loopEnds: [...loopJoints(r.north).ends, ...loopJoints(r.south).ends], inLoop: [...loopJoints(r.north).inside, ...loopJoints(r.south).inside] };
}

/**
 * The oval with a siding (scenarios.ts's `ovalWithSiding`, kept apart here): A ══ ══ (round) B ═ wye ═ (round) A, the
 * wye's stem ══ Mine ⊏, the wye set for the oval (its straight across), as a player lays it.
 */
function ovalWithSiding(layout: Layout, spare = false) {
  const [a, , , , , , , b] = chain(layout, [STOP, S, S, C, C, C, C, STOP]);
  const wye = appendPiece(layout, "wye", false, connectorRef(b, 1), 2);
  chain(layout, ["straight-72", C, C, C, C], connectorRef(wye, 1));
  if (layout.joinedConnector(connectorRef(a, 0)) === -1) throw new Error("the oval doesn't close");
  const [, mine] = chain(layout, [S, spare ? S : STOP], connectorRef(wye, 0));
  appendPiece(layout, BUFFER, false, connectorRef(mine, 1));
  layout.setSwitchState(wye, 0b110);
  return { a, b, mine };
}

/** A ring with a branch line off it by a wye to a stop. */
function branch(layout: Layout, spare = false): Topo {
  const o = ovalWithSiding(layout, spare);
  const way = walkMain(layout, o.a);
  return { id: spare ? "branch-spare" : "branch", ring: true, loops: 0, ...along(layout, way, true), stops: spare ? { ends: [o.a, o.b] } : { ends: [o.a, o.b], far: [o.a, o.mine] }, loopEnds: [], inLoop: [] };
}

/**
 * A terminus: a trunk from a stop Y up to points, two platforms beyond (`switch`), or a wye's two ways (scenarios.ts's
 * `junction`, kept here). The second platform, P, an industry's (a depot on it) or, `spare`, plain track.
 */
function terminus(layout: Layout, type: "switch" | "wye", spare = false): Topo {
  const ids = chain(layout, [STOP, S, S, S]);
  const y = ids[0];
  appendPiece(layout, BUFFER, false, connectorRef(y, 0));
  const sw = appendPiece(layout, type, false, connectorRef(ids[3], 1), 0);
  const [x, p] = ([1, 2] as const).map((c, k) => {
    const curved = type === "switch" && k === 1;
    const stop = k === 1 && spare ? S : STOP;
    const road = chain(layout, curved ? [C, S, stop, S, S] : [S, stop, S, S], connectorRef(sw, c), [curved]);
    appendPiece(layout, BUFFER, false, connectorRef(road[road.length - 1], 1));
    return road[road.length - 3];
  });
  // (The main way: the trunk, the points and the way to platform X.)
  const way = [...ids, sw, ...walkFrom(layout, sw, 1)];
  const stops: Topo["stops"] = { ends: [y, x] };
  if (!spare) stops.far = [y, p];
  return { id: `${type === "switch" ? "terminus" : "wye"}${spare ? "-spare" : ""}`, ring: false, loops: 0, ...along(layout, way, false), stops, loopEnds: [], inLoop: [] };
}

/** Double track with a crossover: ⊐ A1 ══ ══ X ══ ══ B1 ⊏ and ⊐ A2 ══ ══ X ══ ══ B2 ⊏ beside it. */
function doubleTrack(layout: Layout): Topo {
  const [a1, , , x, , , b1] = chain(layout, [STOP, S, S, "crossover", S, S, STOP]);
  appendPiece(layout, BUFFER, false, connectorRef(a1, 0));
  appendPiece(layout, BUFFER, false, connectorRef(b1, 1));
  const [, , b2] = chain(layout, [S, S, STOP], connectorRef(x, 3));
  appendPiece(layout, BUFFER, false, connectorRef(b2, 1));
  // (Back from the crossover's other start: pieces laid by their end 1 onto it, running toward it.)
  const s1 = appendPiece(layout, S, false, connectorRef(x, 2), 1);
  const s2 = appendPiece(layout, S, false, connectorRef(s1, 0), 1);
  const a2 = appendPiece(layout, STOP, false, connectorRef(s2, 0), 1);
  appendPiece(layout, BUFFER, false, connectorRef(a2, 0));
  const way = walkFrom(layout, a1, 1, true);
  const alt = along(layout, walkFrom(layout, a2, 1, true), false);
  return { id: "double", ring: false, loops: 0, ...along(layout, way, false), stops: { ends: [a1, b1], far: [a2, b2] }, loopEnds: [], inLoop: [], alt };
}

/** Two lines crossing on a crossing: X ══ ══ ╬ ══ ══ Y and P ══ ══ ╬ ══ ══ Q. */
function crossing(layout: Layout): Topo {
  const [x, , , cross, , , y] = chain(layout, [STOP, S, S, "crossing", S, S, STOP]);
  appendPiece(layout, BUFFER, false, connectorRef(x, 0));
  appendPiece(layout, BUFFER, false, connectorRef(y, 1));
  const [, , q] = chain(layout, [S, S, STOP], connectorRef(cross, 3));
  appendPiece(layout, BUFFER, false, connectorRef(q, 1));
  const s1 = appendPiece(layout, S, false, connectorRef(cross, 2), 1);
  const s2 = appendPiece(layout, S, false, connectorRef(s1, 0), 1);
  const p = appendPiece(layout, STOP, false, connectorRef(s2, 0), 1);
  appendPiece(layout, BUFFER, false, connectorRef(p, 0));
  const way = walkFrom(layout, x, 1, true);
  const alt = along(layout, walkFrom(layout, p, 1, true), false);
  return { id: "crossing", ring: false, loops: 0, ...along(layout, way, false), stops: { ends: [x, y], far: [p, q] }, loopEnds: [], inLoop: [], alt };
}

/** The pieces from `from` by its connector `exit` on (points as set), to a buffer or back to the start. */
function walkFrom(layout: Layout, from: number, exit: number, withStart = false): number[] {
  const out: number[] = withStart ? [from] : [];
  let at = { p: from, exit };
  for (let i = 0; i < 200; i++) {
    const n = next(layout, at.p, at.exit);
    if (!n || n.pieceId === from || layout.getPiece(n.pieceId)!.type.startsWith("buffer")) break;
    out.push(n.pieceId);
    // (A pinned test true for all: the one way each switch is set to.)
    const w = waysFrom(layout, n.pieceId, n.entry, () => true)[0];
    if (!w || w.exit < 0) break;
    at = { p: n.pieceId, exit: w.exit };
  }
  return out;
}

function walkMain(layout: Layout, start: number): number[] {
  return walkFrom(layout, start, 1, true);
}
export const TOPOLOGIES: Record<string, (layout: Layout, stops: StopKind) => Topo> = {
  line0: (l, s) => line(l, 0, { mid: s === "mid" }),
  line1: (l, s) => line(l, 1, { mid: s === "mid", loopStop: s === "loop" }),
  line2: (l, s) => line(l, 2, { mid: s === "mid", loopStop: s === "loop" }),
  line3: (l, s) => line(l, 3, { mid: s === "mid", loopStop: s === "loop" }),
  siding: (l, s) => line(l, 0, { mid: s === "mid", siding: true }),
  "line1+siding": (l, s) => line(l, 1, { mid: s === "mid", loopStop: s === "loop", siding: true }),
  // (Spare sidings and platforms: no industry on them, no train's stop. A train may step aside into one (the user's A1).)
  "siding-spare": (l, s) => line(l, 0, { mid: s === "mid", siding: true, spare: true }),
  "line1+siding-spare": (l, s) => line(l, 1, { mid: s === "mid", loopStop: s === "loop", siding: true, spare: true }),
  "terminus-spare": (l) => terminus(l, "switch", true),
  "wye-spare": (l) => terminus(l, "wye", true),
  "branch-spare": (l) => branch(l, true),
  ring0: (l) => ring0(l),
  ring1: (l) => ring1(l),
  ring2: (l) => ring2(l),
  branch: (l) => branch(l),
  terminus: (l) => terminus(l, "switch"),
  wye: (l) => terminus(l, "wye"),
  double: (l) => doubleTrack(l),
  crossing: (l) => crossing(l),
};
