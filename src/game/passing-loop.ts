import { getPieceDef, pathLength, type Layout } from "../track";
import { CAR_SPECS, COUPLER_GAP, type CarKind } from "../sim";
import { next, waysFrom } from "../economy/steer";
import type { Economy } from "../economy";
import { lineLegs } from "./route-path";

/** One of a passing loop's two roads: its pieces in order from switch `a` to `b`, each with the end it faces `a` by. */
export interface LoopRoad {
  pieces: readonly number[];
  aEnds: readonly number[];
  /** Its length (mm) between the two switches. */
  length: number;
}

/** A passing loop: two switches, and the pieces of the two roads between them (the switches too). */
export interface PassingLoop {
  a: number;
  b: number;
  /** Each switch's end the two roads meet at (its stem). */
  stemA: number;
  stemB: number;
  roads: readonly [LoopRoad, LoopRoad];
  pieces: ReadonlySet<number>;
}

/** Where a piece lies on a loop's road: the loop's index in `passingLoops`, the road, and the end it faces `a` by. */
export interface RoadAt {
  loop: number;
  road: number;
  aEnd: number;
}

/** The most pieces a road of a passing loop runs through between its two switches. */
const MAX_ROAD = 40;

/** Nothing is pinned, for finding loops: every road of a switch counts. */
const NONE_PINNED = () => false;

/**
 * Where a road leaving `pieceId` by connector `exit` comes to the next switch: that switch, the end it comes in by, and
 * the pieces on the way (with the ends they're come in by); null at a dead end, back at the start, or after `MAX_ROAD`
 * pieces.
 */
function roadTo(layout: Layout, pieceId: number, exit: number): { switchId: number; entry: number; pieces: number[]; entries: number[]; length: number } | null {
  const pieces: number[] = [];
  const entries: number[] = [];
  let length = 0;
  let at = next(layout, pieceId, exit);
  for (let k = 0; at && k < MAX_ROAD; k++) {
    if (at.pieceId === pieceId) return null;
    const piece = layout.getPiece(at.pieceId);
    if (!piece) return null;
    const def = getPieceDef(piece.type, piece.flipped);
    if (def.isSwitch) return { switchId: at.pieceId, entry: at.entry, pieces, entries, length };
    const ways = waysFrom(layout, at.pieceId, at.entry, NONE_PINNED);
    if (ways.length !== 1) return null;
    pieces.push(at.pieceId);
    entries.push(at.entry);
    length += pathLength(def.paths[ways[0].path].geom);
    at = next(layout, at.pieceId, ways[0].exit);
  }
  return null;
}

interface Found {
  revision: number;
  loops: PassingLoop[];
  roadAt: Map<number, RoadAt>;
  switches: Map<number, number[]>;
}

const cache = new WeakMap<Layout, Found>();

function found(layout: Layout): Found {
  const hit = cache.get(layout);
  if (hit && hit.revision === layout.revision) return hit;
  const loops = findLoops(layout);
  const roadAt = new Map<number, RoadAt>();
  const switches = new Map<number, number[]>();
  loops.forEach((l, loop) => {
    l.roads.forEach((r, road) => r.pieces.forEach((p, k) => roadAt.set(p, { loop, road, aEnd: r.aEnds[k] })));
    for (const s of [l.a, l.b]) {
      const at = switches.get(s);
      if (at) at.push(loop);
      else switches.set(s, [loop]);
    }
  });
  const entry = { revision: layout.revision, loops, roadAt, switches };
  cache.set(layout, entry);
  return entry;
}

/**
 * The layout's passing loops: two roads side by side between two switches (each road out of one switch's two roads
 * from a common end, round to the other's two roads into a common end). Cached per layout, by its revision.
 */
export function passingLoops(layout: Layout): readonly PassingLoop[] {
  return found(layout).loops;
}

/** The loops' road pieces: which loop and road each lies on (see `RoadAt`). Cached with `passingLoops`. */
export function loopRoadAt(layout: Layout): ReadonlyMap<number, RoadAt> {
  return found(layout).roadAt;
}

/** The loops (indices in `passingLoops`) each switch is an end of. Cached with `passingLoops`. */
export function loopsAtSwitch(layout: Layout): ReadonlyMap<number, readonly number[]> {
  return found(layout).switches;
}

function findLoops(layout: Layout): PassingLoop[] {
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
          const stemB = w1.find((x) => w2.some((y) => y.exit === x.exit))?.exit;
          if (stemB === undefined) continue;
          const key = `${Math.min(id, r1.switchId)}:${Math.max(id, r1.switchId)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          loops.push({
            a: id,
            b: r1.switchId,
            stemA: stem,
            stemB,
            roads: [
              { pieces: r1.pieces, aEnds: r1.entries, length: r1.length },
              { pieces: r2.pieces, aEnds: r2.entries, length: r2.length },
            ],
            pieces: new Set([id, r1.switchId, ...r1.pieces, ...r2.pieces]),
          });
        }
    }
  }
  return loops;
}

/** One step of a way along the track: a piece, the ends it's come in and gone out by, and how far it runs on it. */
export interface WayStep {
  pieceId: number;
  entry: number;
  exit: number;
  len: number;
}

/**
 * A way's run through a passing loop: in at step `entry` (the near switch, by its stem; −1: the way starts in the
 * loop), along `road` (`length` mm), out at step `far` (the far switch, by its stem); `toB`: from the loop's `a` to `b`.
 */
export interface LoopRun {
  loop: number;
  road: number;
  entry: number;
  far: number;
  length: number;
  toB: boolean;
}

/**
 * The runs of a way (`steps`) through the layout's passing loops: found by the far switch (out by its stem, from one
 * of the loop's roads), back along that road to the near one (in by its stem), or to the way's start.
 */
export function loopRuns(layout: Layout, steps: readonly WayStep[]): LoopRun[] {
  const runs: LoopRun[] = [];
  const { loops, roadAt, switches } = found(layout);
  if (loops.length === 0) return runs;
  for (let j = 1; j < steps.length; j++) {
    const ls = switches.get(steps[j].pieceId);
    if (!ls) continue;
    const before = roadAt.get(steps[j - 1].pieceId);
    if (!before) continue;
    for (const li of ls) {
      const loop = loops[li];
      const toB = steps[j].pieceId === loop.b;
      if (before.loop !== li || steps[j].exit !== (toB ? loop.stemB : loop.stemA)) continue;
      let i = j - 1;
      while (i > 0 && roadAt.get(steps[i - 1].pieceId)?.loop === li && roadAt.get(steps[i - 1].pieceId)?.road === before.road) i--;
      const near = i > 0 ? steps[i - 1] : null;
      if (near) {
        if (near.pieceId !== (toB ? loop.a : loop.b) || near.entry !== (toB ? loop.stemA : loop.stemB)) continue;
        if (j - i !== loop.roads[before.road].pieces.length) continue;
      }
      runs.push({ loop: li, road: before.road, entry: near ? i - 1 : -1, far: j, length: loop.roads[before.road].length, toB });
    }
  }
  return runs;
}

/** A train's length (mm), buffer face to buffer face. */
export function carsLength(cars: readonly { kind: CarKind }[]): number {
  let len = 0;
  for (const car of cars) len += CAR_SPECS[car.kind].length;
  return len + COUPLER_GAP * Math.max(0, cars.length - 1);
}

/** How far (mm) a train waiting in a loop stands short of its far switch, and its tail clear of the near one. */
export const STAND_SHORT = 6;
export const TAIL_CLEAR = 6;

/** Each line's loops that count, cached by its stops, its trains' longest length and the track's revisions. */
const lineLoops = new WeakMap<Economy, Map<number, { key: string; has: boolean }>>();

/**
 * Is there a passing loop a line with a train on it can cross trains in, as crossing (economy/crossing.ts) uses one: a
 * way between two of its stops runs through it (in by one switch's stem, out by the other's), neither switch is
 * pinned, and the road it takes holds the line's longest train clear of both switches?
 */
export function loopOnLine(economy: Economy): boolean {
  for (const lineId of new Set(economy.lineIdOf.values())) if (loopOnLineId(economy, lineId)) return true;
  return false;
}

/** `loopOnLine` for one line (`lineId`): can its trains cross in a passing loop on it? */
export function loopOnLineId(economy: Economy, lineId: number): boolean {
  const { layout } = economy;
  const loops = passingLoops(layout);
  if (loops.length === 0) return false;
  let byLine = lineLoops.get(economy);
  if (!byLine) lineLoops.set(economy, (byLine = new Map()));
  let longest = -1;
  for (const [engine, id] of economy.lineIdOf) {
    if (id !== lineId) continue;
    const found = economy.sim.findCar(engine);
    if (found) longest = Math.max(longest, carsLength(found.train.cars));
  }
  if (longest < 0) return false;
  const len = longest;
  const line = economy.lines.get(lineId);
  if (!line) return false;
  const stops = line.stops.map((s) => economy.depot(s.depotId)?.pieceId ?? -1).filter((p) => p !== -1 && layout.getPiece(p));
  const pinned = loops.map((l) => (layout.isPinned(l.a) || layout.isPinned(l.b) ? 1 : 0)).join("");
  const key = `${stops.join(",")}|${len}|${layout.revision}|${layout.routingVersion}|${pinned}`;
  let at = byLine.get(lineId);
  if (!at || at.key !== key) {
    let has = false;
    for (const leg of lineLegs(layout, stops)) {
      if (!leg || has) continue;
      const steps: WayStep[] = leg.map((r) => {
        const piece = layout.getPiece(r.pieceId)!;
        const path = getPieceDef(piece.type, piece.flipped).paths[r.pathIndex];
        const forward = r.s1 >= r.s0;
        return { pieceId: r.pieceId, entry: forward ? path.from : (path.to ?? -1), exit: forward ? (path.to ?? -1) : path.from, len: Math.abs(r.s1 - r.s0) };
      });
      has = loopRuns(layout, steps).some((run) => run.entry !== -1 && run.length >= len + STAND_SHORT + TAIL_CLEAR && !layout.isPinned(loops[run.loop].a) && !layout.isPinned(loops[run.loop].b));
    }
    byLine.set(lineId, (at = { key, has }));
  }
  return at.has;
}
