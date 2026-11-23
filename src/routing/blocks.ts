/**
 * Single-line working's track model (dispatcher spec §13.6.2): the passing places, per layout revision. A passing place
 * is a road of a passing loop or a yard: one of two or more plain-track sections (no points, a crossing or a deck: one
 * road through) joining the same pair of points. Everything else between them is a block, held one way at a time
 * (the dispatcher's reservation book, `RESERVE`).
 */
import { getPieceDef, type Layout } from "../track";
import { next } from "./graph";
import { isPoints } from "./router";

/** The most pieces a plain section runs (a longer one, or a ring with no points: not a road of anything). */
const SECTION_MAX = 400;

export interface Passing {
  /** Piece → its passing place (−1 never: only roads' pieces are here). */
  group: Map<number, number>;
  /** Each passing place's roads: their pieces. */
  roads: number[][][];
}

const cache = new WeakMap<Layout, { rev: number; p: Passing }>();

/** The layout's passing places (cached per revision). */
export function passingOf(layout: Layout): Passing {
  const c = cache.get(layout);
  if (c && c.rev === layout.revision) return c.p;
  const plain = (p: number) => {
    const piece = layout.getPiece(p);
    if (!piece) return false;
    const def = getPieceDef(piece.type, piece.flipped);
    return def.paths.length === 1 && def.connectors.length === 2 && !isPoints(layout, p);
  };
  const seen = new Set<number>();
  const byEnds = new Map<string, number[][]>();
  for (const p of layout.pieceIds()) {
    if (seen.has(p) || !plain(p)) continue;
    // (The section: plain pieces joined end to end; its two ends, the pieces past them.)
    const run = [p];
    seen.add(p);
    const ends: number[] = [];
    for (let c = 0; c < 2; c++) {
      let cur = p;
      let out = c;
      for (let n = 0; n < SECTION_MAX; n++) {
        const nx = next(layout, cur, out);
        if (!nx) {
          ends.push(-1);
          break;
        }
        if (!plain(nx.pieceId)) {
          ends.push(nx.pieceId);
          break;
        }
        if (seen.has(nx.pieceId)) {
          ends.push(-2);
          break;
        }
        seen.add(nx.pieceId);
        run.push(nx.pieceId);
        cur = nx.pieceId;
        out = nx.entry === 0 ? 1 : 0;
      }
      if (ends.length === c) ends.push(-2);
    }
    // (A road joins two points (or one twice, a balloon: not a road); a dead end, a ring, a buffer: not.)
    const [a, b] = ends;
    if (a < 0 || b < 0 || a === b) continue;
    if (!isPoints(layout, a) || !isPoints(layout, b)) continue;
    const key = a < b ? `${a}.${b}` : `${b}.${a}`;
    const list = byEnds.get(key) ?? [];
    list.push(run);
    byEnds.set(key, list);
  }
  const group = new Map<number, number>();
  const roads: number[][][] = [];
  for (const list of byEnds.values()) {
    if (list.length < 2) continue;
    const g = roads.length;
    roads.push(list);
    for (const r of list) for (const q of r) group.set(q, g);
  }
  const p = { group, roads };
  cache.set(layout, { rev: layout.revision, p });
  return p;
}
