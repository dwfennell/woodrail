/**
 * Dead-end regions (routing spec §5 rule 8): track a train can only leave the way it came in. The pieces on no cycle of
 * the track (a ring, a passing loop and a wye's triangle are cycles) that join the rest at one place, their mouth. A
 * train goes in at the mouth only while no other train is in the region (sections, `Sections.wayOn`); one coming out
 * takes a road at the points outside the mouth that no train stands on facing it (`mouthWay`).
 *
 * Worked out once per layout revision: bridges of the track's graph (Tarjan's lowlink, iterative), then the pieces off
 * every cycle grouped, and those that meet the cycles at exactly one joint kept.
 */
import { connectorRef, getPieceDef, type Layout } from "../track";
import { flipCursor, type Cursor, type Sim, type Train } from "../sim";

/** What `roadFacing` and `mouthWay` look at: the trains. */
type Trains = Pick<Sim, "trainIds" | "getTrain">;
import { next, SEARCH, waysFrom } from "./graph";
import { driveOf } from "../sim/train-cars";

export interface DeadEnds {
  /** Piece → its region (index into `mouths`). */
  regionOf: ReadonlyMap<number, number>;
  /** Per region: the piece just outside the mouth and the end of it the region joins (a connector ref), and its pieces. */
  mouths: readonly { outer: number; outerEnd: number; pieces: ReadonlySet<number> }[];
  /** Pieces just outside a mouth, by connector ref (piece × 8 + end) that leads into the region: the region. */
  intoAt: ReadonlyMap<number, number>;
}

const cache = new WeakMap<Layout, { rev: number; d: DeadEnds }>();

/** The layout's dead-end regions (cached per revision). */
export function deadEndsOf(layout: Layout): DeadEnds {
  const hit = cache.get(layout);
  if (hit && hit.rev === layout.revision) return hit.d;
  const d = build(layout);
  cache.set(layout, { rev: layout.revision, d });
  return d;
}

function build(layout: Layout): DeadEnds {
  // Edges: each joint once (lower connector ref first), by id.
  const ids = [...layout.pieceIds()];
  const adj = new Map<number, { to: number; edge: number }[]>();
  for (const id of ids) adj.set(id, []);
  let edges = 0;
  for (const id of ids) {
    const p = layout.getPiece(id)!;
    const def = getPieceDef(p.type, p.flipped);
    for (let c = 0; c < def.connectors.length; c++) {
      const n = next(layout, id, c);
      if (!n) continue;
      const a = connectorRef(id, c);
      const b = connectorRef(n.pieceId, n.entry);
      if (a > b) continue;
      const e = edges++;
      adj.get(id)!.push({ to: n.pieceId, edge: e });
      adj.get(n.pieceId)?.push({ to: id, edge: e });
    }
  }
  // Bridges: an edge whose far side's lowest reachable discovery time is past the near side's.
  const disc = new Map<number, number>();
  const low = new Map<number, number>();
  const bridge = new Set<number>();
  let time = 0;
  for (const root of ids) {
    if (disc.has(root)) continue;
    const stack: { v: number; via: number; i: number }[] = [{ v: root, via: -1, i: 0 }];
    disc.set(root, time);
    low.set(root, time++);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const list = adj.get(top.v)!;
      if (top.i < list.length) {
        const { to, edge } = list[top.i++];
        if (edge === top.via) continue;
        if (!disc.has(to)) {
          disc.set(to, time);
          low.set(to, time++);
          stack.push({ v: to, via: edge, i: 0 });
        } else low.set(top.v, Math.min(low.get(top.v)!, disc.get(to)!));
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) {
          low.set(parent.v, Math.min(low.get(parent.v)!, low.get(top.v)!));
          if (low.get(top.v)! > disc.get(parent.v)!) bridge.add(top.via);
        }
      }
    }
  }
  // On a cycle: a piece with a non-bridge edge.
  const cyclic = new Set<number>();
  for (const [v, list] of adj) if (list.some((x) => !bridge.has(x.edge))) cyclic.add(v);
  // The rest, grouped; a group meeting the cycles at exactly one joint is a region.
  const regionOf = new Map<number, number>();
  const mouths: { outer: number; outerEnd: number; pieces: Set<number> }[] = [];
  const intoAt = new Map<number, number>();
  const seen = new Set<number>();
  for (const start of ids) {
    if (cyclic.has(start) || seen.has(start)) continue;
    const group = new Set<number>([start]);
    const stack = [start];
    seen.add(start);
    const joints: { outer: number; inner: number }[] = [];
    while (stack.length > 0) {
      const v = stack.pop()!;
      for (const { to } of adj.get(v)!) {
        if (cyclic.has(to)) {
          joints.push({ outer: to, inner: v });
          continue;
        }
        if (seen.has(to)) continue;
        seen.add(to);
        group.add(to);
        stack.push(to);
      }
    }
    if (joints.length !== 1) continue;
    const { outer, inner } = joints[0];
    const p = layout.getPiece(outer)!;
    const def = getPieceDef(p.type, p.flipped);
    let outerEnd = -1;
    for (let c = 0; c < def.connectors.length; c++) if (next(layout, outer, c)?.pieceId === inner) outerEnd = connectorRef(outer, c);
    if (outerEnd < 0) continue;
    const r = mouths.length;
    mouths.push({ outer, outerEnd, pieces: group });
    for (const g of group) regionOf.set(g, r);
    intoAt.set(outerEnd, r);
  }
  return { regionOf, mouths, intoAt };
}

/** A train's net drive toward its front (sign only matters; 0: not driven), from its engines' levers. */

/**
 * Out of points `pieceId` by `exit`, as the points beyond lie, up to the next points with a choice (or the end): is a
 * train (not `own`) on that road facing this way, coming at it or standing to come (its front, the way it's driven,
 * leaving a piece of the road by the end the road comes in by)?
 */
export function roadFacing(layout: Layout, sim: Trains, own: Train | undefined, pieceId: number, exit: number): boolean {
  const road = new Map<number, number>();
  let at = next(layout, pieceId, exit);
  for (let k = 0; at && k < SEARCH; k++) {
    if (road.has(at.pieceId)) break;
    road.set(at.pieceId, at.entry);
    const ways = waysFrom(layout, at.pieceId, at.entry);
    if (ways.length !== 1 || ways[0].exit < 0) break;
    at = next(layout, at.pieceId, ways[0].exit);
  }
  for (const id of sim.trainIds()) {
    const t = sim.getTrain(id);
    if (!t || t === own || t.derailed || !t.bogies.some((b) => road.has(b.pieceId))) continue;
    const net = driveOf(t);
    if (net === 0) continue;
    const c: Cursor = { ...(net > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]) };
    if (net < 0) flipCursor(layout, c);
    const e = road.get(c.pieceId);
    if (e === undefined) continue;
    const piece = layout.getPiece(c.pieceId);
    if (!piece) continue;
    const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
    if ((c.reversed ? path.from : (path.to ?? -1)) === e) return true;
  }
  return false;
}

/**
 * Coming out of a dead end (onto the points just outside its mouth, by the end that leads into it): of `ways` (from
 * `waysFrom`), `option` unless a train stands or comes on its road facing this one (`roadFacing`) and another way has
 * none (and, given `reaches`, gets where it's going): then that one. Elsewhere, `option`.
 */
export function mouthWay(
  layout: Layout,
  sim: Trains,
  own: Train | undefined,
  pieceId: number,
  entry: number,
  ways: readonly { option: number; path: number; exit: number }[],
  option: number,
  reaches?: (w: { option: number; path: number; exit: number }) => boolean,
): number {
  if (ways.length < 2 || !deadEndsOf(layout).intoAt.has(connectorRef(pieceId, entry))) return option;
  const now = ways.find((w) => w.option === option);
  if (!now || !roadFacing(layout, sim, own, pieceId, now.exit)) return option;
  for (const w of ways) {
    if (w.option === option || (reaches && !reaches(w)) || roadFacing(layout, sim, own, pieceId, w.exit)) continue;
    return w.option;
  }
  return option;
}
