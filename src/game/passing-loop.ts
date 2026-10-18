import { getPieceDef, type Layout } from "../track";
import { next, waysFrom } from "../economy/steer";
import type { Economy } from "../economy";
import { lineLegs } from "./route-path";

/** A passing loop: two switches, and the pieces of the two roads between them (the switches too). */
export interface PassingLoop {
  a: number;
  b: number;
  pieces: ReadonlySet<number>;
}

/** The most pieces a road of a passing loop runs through between its two switches. */
const MAX_ROAD = 40;

/** Nothing is pinned, for finding loops: every road of a switch counts. */
const NONE_PINNED = () => false;

/**
 * Where a road leaving `pieceId` by connector `exit` comes to the next switch: that switch, the end it comes in by, and
 * the pieces on the way; null at a dead end, back at the start, or after `MAX_ROAD` pieces.
 */
function roadTo(layout: Layout, pieceId: number, exit: number): { switchId: number; entry: number; pieces: number[] } | null {
  const pieces: number[] = [];
  let at = next(layout, pieceId, exit);
  for (let k = 0; at && k < MAX_ROAD; k++) {
    if (at.pieceId === pieceId) return null;
    const piece = layout.getPiece(at.pieceId);
    if (!piece) return null;
    if (getPieceDef(piece.type, piece.flipped).isSwitch) return { switchId: at.pieceId, entry: at.entry, pieces };
    const ways = waysFrom(layout, at.pieceId, at.entry, NONE_PINNED);
    if (ways.length !== 1) return null;
    pieces.push(at.pieceId);
    at = next(layout, at.pieceId, ways[0].exit);
  }
  return null;
}

const cache = new WeakMap<Layout, { revision: number; loops: PassingLoop[] }>();

/**
 * The layout's passing loops: two roads side by side between two switches (each road out of one switch's two roads
 * from a common end, round to the other's two roads into a common end). Cached per layout, by its revision.
 */
export function passingLoops(layout: Layout): readonly PassingLoop[] {
  const hit = cache.get(layout);
  if (hit && hit.revision === layout.revision) return hit.loops;
  const loops: PassingLoop[] = [];
  const seen = new Set<string>();
  for (const id of layout.pieceIds()) {
    const piece = layout.getPiece(id)!;
    const def = getPieceDef(piece.type, piece.flipped);
    if (!def.isSwitch) continue;
    // Each end two or more roads leave by (a switch's stem): every pair of them.
    for (let stem = 0; stem < def.connectors.length; stem++) {
      const ways = waysFrom(layout, id, stem, NONE_PINNED);
      for (let i = 0; i < ways.length; i++)
        for (let j = i + 1; j < ways.length; j++) {
          const r1 = roadTo(layout, id, ways[i].exit);
          const r2 = roadTo(layout, id, ways[j].exit);
          if (!r1 || !r2 || r1.switchId !== r2.switchId || r1.switchId === id || r1.entry === r2.entry) continue;
          // They come into the other switch by two of its roads that meet at one end (its stem).
          const w1 = waysFrom(layout, r1.switchId, r1.entry, NONE_PINNED);
          const w2 = waysFrom(layout, r2.switchId, r2.entry, NONE_PINNED);
          if (!w1.some((x) => w2.some((y) => y.exit === x.exit))) continue;
          const key = `${Math.min(id, r1.switchId)}:${Math.max(id, r1.switchId)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          loops.push({ a: id, b: r1.switchId, pieces: new Set([id, r1.switchId, ...r1.pieces, ...r2.pieces]) });
        }
    }
  }
  cache.set(layout, { revision: layout.revision, loops });
  return loops;
}

/** Each line's pieces (its ways between its stops), cached by its stops and the track's revisions. */
const linePieces = new WeakMap<Economy, Map<number, { key: string; pieces: Set<number> }>>();

/** Is there a passing loop on a line that has a train on it (its way between stops runs through the loop)? */
export function loopOnLine(economy: Economy): boolean {
  const loops = passingLoops(economy.layout);
  if (loops.length === 0) return false;
  let byLine = linePieces.get(economy);
  if (!byLine) linePieces.set(economy, (byLine = new Map()));
  const running = new Set<number>();
  for (const [engine, lineId] of economy.lineIdOf) if (economy.sim.findCar(engine)) running.add(lineId);
  for (const lineId of running) {
    const line = economy.lines.get(lineId);
    if (!line) continue;
    const stops = line.stops.map((s) => economy.depot(s.depotId)?.pieceId ?? -1).filter((p) => p !== -1 && economy.layout.getPiece(p));
    const key = `${stops.join(",")}|${economy.layout.revision}|${economy.layout.routingVersion}`;
    let at = byLine.get(lineId);
    if (!at || at.key !== key) {
      const pieces = new Set<number>(stops);
      for (const leg of lineLegs(economy.layout, stops)) for (const run of leg ?? []) pieces.add(run.pieceId);
      byLine.set(lineId, (at = { key, pieces }));
    }
    for (const loop of loops) for (const p of loop.pieces) if (at.pieces.has(p)) return true;
  }
  return false;
}
