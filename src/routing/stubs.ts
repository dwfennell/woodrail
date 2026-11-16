/**
 * Line ends too short to turn and take another road (the long goals play-through, 2026-11-16): a train turns back where
 * the track ends, and the plan (plan.ts) let it come out of that dead end onto any road at the points outside it. But a
 * train longer than the dead end stands, turned at its end, with its tail over those points: they can't be thrown under
 * it, so it leaves by the road it came in on. A goods train of eight cars (776 mm) went into the mine's 720 mm dead end
 * on one road and its next stop was up the other: planned out that way, it went round, came back to the mine to turn
 * again, and went round for good.
 *
 * Here: each dead end of the track (where a train turns), its mouth (the first points with a choice on the way out of it)
 * and its length (from the end to the mouth). For a train's length, those too short for it (`stubRule`): the plan, given
 * that, takes a train that came into one of them by a road out of it by that road again.
 *
 * Cost: the dead ends are found once a track (`piecesVersion`), walking out of each end (a few pieces each). A rule is
 * made once a track and length, and only when some dead end is too short for the train: for the rest the plan is as it
 * was (no rule), its cache too.
 */
import { getPieceDef, MAX_CONNECTORS, pathLength, type Layout } from "../track";
import { next, waysFrom } from "./graph";

/** A dead end this much (mm) longer than a train is long enough to turn in clear of the points outside it. */
export const STUB_MARGIN = 12;
/** Dead ends longer than this (mm) are long enough for any train: not looked at past it. */
const STUB_LOOK = 4000;
/** How many pieces a walk out of a dead end goes, at most. */
const STUB_WALK = 64;

const ALL_ROADS = () => false;

/** A dead end: where a train turns (a piece and the end it comes onto it by), its mouth's points and its length. */
interface Stub {
  /** The turn: the piece the track ends on × `MAX_CONNECTORS` + the end it's come onto by. */
  turn: number;
  /** The mouth: its points × `MAX_CONNECTORS` + the end a train coming out of the dead end comes onto them by. */
  mouth: number;
  length: number;
}

/**
 * For one train length: the dead ends too short for it, as the plan uses them. `id`: which ones (the number of the
 * track's dead ends shorter than the train, as they only grow with it), for caches. `mouths`: their mouths, each with an
 * index; `turns`: each short dead end's turn, to its mouth's index.
 */
export interface StubRule {
  id: number;
  mouths: ReadonlyMap<number, number>;
  turns: ReadonlyMap<number, number>;
}

interface StubTable {
  version: number;
  /** Shortest first. */
  stubs: Stub[];
  rules: Map<number, StubRule | undefined>;
}

const tables = new WeakMap<Layout, StubTable>();

/** The track's dead ends shorter than `STUB_LOOK`, shortest first, worked out once a track. */
function tableOf(layout: Layout): StubTable {
  let t = tables.get(layout);
  if (t && t.version === layout.piecesVersion) return t;
  const stubs: Stub[] = [];
  for (const id of layout.pieceIds()) {
    const piece = layout.getPiece(id);
    if (!piece) continue;
    const def = getPieceDef(piece.type, piece.flipped);
    for (let entry = 0; entry < def.connectors.length; entry++) {
      // (A turn: come onto the piece by this end, a way on from it leads nowhere.)
      const dead = waysFrom(layout, id, entry, ALL_ROADS).find((w) => !next(layout, id, w.exit));
      if (!dead) continue;
      // (Out of it: back the way it came, as the plan turns, to the first points with a choice.)
      let length = pathLength(def.paths[dead.path].geom);
      let at = next(layout, id, entry);
      let mouth = -1;
      for (let k = 0; at && k < STUB_WALK && length < STUB_LOOK; k++) {
        const ways = waysFrom(layout, at.pieceId, at.entry, ALL_ROADS);
        if (ways.length !== 1) {
          if (ways.length > 1) mouth = at.pieceId * MAX_CONNECTORS + at.entry;
          break;
        }
        const p = layout.getPiece(at.pieceId)!;
        length += pathLength(getPieceDef(p.type, p.flipped).paths[ways[0].path].geom);
        at = next(layout, at.pieceId, ways[0].exit);
      }
      if (mouth !== -1 && length < STUB_LOOK) stubs.push({ turn: id * MAX_CONNECTORS + entry, mouth, length });
    }
  }
  stubs.sort((a, b) => a.length - b.length);
  t = { version: layout.piecesVersion, stubs, rules: new Map() };
  tables.set(layout, t);
  return t;
}

/**
 * The dead ends too short for a train `length` mm long to turn in and take another road out (`STUB_MARGIN`), for the
 * plan; undefined when none is (the plan as it was).
 */
export function stubRule(layout: Layout, length: number): StubRule | undefined {
  const t = tableOf(layout);
  let n = 0;
  while (n < t.stubs.length && t.stubs[n].length < length + STUB_MARGIN) n++;
  if (n === 0) return undefined;
  if (t.rules.has(n)) return t.rules.get(n);
  const mouths = new Map<number, number>();
  const turns = new Map<number, number>();
  for (let k = 0; k < n; k++) {
    const s = t.stubs[k];
    let i = mouths.get(s.mouth);
    if (i === undefined) mouths.set(s.mouth, (i = mouths.size));
    turns.set(s.turn, i);
  }
  const rule = { id: n, mouths, turns };
  t.rules.set(n, rule);
  return rule;
}

/**
 * Points come onto by this end from a dead end too short for the rule's train: the mouth it comes out of it by, the
 * points under its nose since it turned there, lying for the road it came in by.
 */
export function outOfShort(rule: StubRule, pieceId: number, entry: number): boolean {
  return rule.mouths.has(pieceId * MAX_CONNECTORS + entry);
}
