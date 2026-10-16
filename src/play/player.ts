import type { Editor } from "../editor/editor";
import { appendPiece, connectorRef, createWorldConnector, fitAutoStraight, getPieceDef, indexOfRef, normalizeAngle, pieceOfRef, type Layout, type PieceTypeId } from "../track";

/**
 * A simulated player laying track from one free end to another, the way a person does: steering with the tray's
 * ordinary pieces (long and medium straights, large curves either way), looking three pieces ahead, and finishing
 * with the Auto piece when the end is in its reach. Everything goes through the Editor, so the game's own help
 * (Auto's fitting, near misses pulled closed) is what gets measured. Used by the buildability harness.
 */

/** Why a piece can't go at this pose (the game's placement rules), or null. */
export type Blocked = (type: PieceTypeId, flipped: boolean, pose: { x: number; z: number; heading: number }, y: number, ignoreId: number) => string | null;

export interface PlayResult {
  /** Joined to the target end. */
  ok: boolean;
  /** Pieces put down (whether or not it got there). */
  pieces: number;
  /** How it ended: joined, gave up (no piece improved things or out of pieces), or a piece wouldn't go. */
  how: "joined" | "lost" | "too-many" | "plan-drifted" | "auto-unjoined" | "slack-refused" | "boxed-in";
  /** What stopped pieces most often on the way (the placement rule), if anything did. */
  blockedBy?: string;
  /** Where it ended up, from the target: distance (mm), how far from facing it (degrees), and the ends' kinds alike. */
  miss?: { d: number; angle: number; alike: boolean };
}

const STEPS: readonly { type: PieceTypeId; flipped: boolean }[] = [
  { type: "straight-216", flipped: false },
  { type: "straight-144", flipped: false },
  { type: "curve-large", flipped: false },
  { type: "curve-large", flipped: true },
];

/** Looking ahead, a player also thinks of going up or down a level: to climb a hill, or to bridge a river. */
const AHEAD: readonly { type: PieceTypeId; flipped: boolean }[] = [...STEPS, { type: "ramp", flipped: false }, { type: "ramp", flipped: true }];

/** A continuation that runs into something with no piece to go on with: a player sees it coming and avoids it. */
const DEAD_END = 600;

/** Fiddling near the end, a player reaches for the small curves and short straights too. */
const FINISH: readonly { type: PieceTypeId; flipped: boolean }[] = [
  ...STEPS,
  { type: "straight-72", flipped: false },
  { type: "curve-small", flipped: false },
  { type: "curve-small", flipped: true },
  { type: "ramp", flipped: false },
  { type: "ramp", flipped: true },
];

/** A near miss the game pulls closed (the Editor's near-miss reach): a player leaves such a gap for it. */
const NEAR = 45;
const NEAR_TURN = (12 * Math.PI) / 180;

const a = createWorldConnector();

type Step = { type: PieceTypeId; flipped: boolean };

/**
 * What a player reaches for when a piece won't go: the bridge of the same shape over a river (it must be up a level:
 * a bridge at ground level has no arches), or a ramp (up, or down) where a hill is in the way or the track would be
 * left in the air.
 */
function alternatives(s: Step, why: string | null): Step[] {
  if (why === "river") return [s.type.startsWith("curve") ? { type: "bridge-curve", flipped: s.flipped } : { type: "bridge", flipped: false }];
  if (why === "hill" || why === "unsupported") return [{ type: "ramp", flipped: false }, { type: "ramp", flipped: true }];
  return [];
}

/** Put step `s` on free end `ref`, or what a player would use instead where it won't go; the piece actually used. */
function addStep(layout: Layout, ref: number, s: Step): { id: number; next: number; step: Step } | null {
  const r = addOn(layout, ref, s.type, s.flipped);
  if (r) return { ...r, step: s };
  for (const alt of alternatives(s, lastRefusal)) {
    const a = addOn(layout, ref, alt.type, alt.flipped);
    if (a) return { ...a, step: alt };
  }
  return null;
}

/** Where a free end is and which way it points (outward). */
function endOf(layout: Layout, ref: number): { x: number; z: number; heading: number; y: number; kind: "peg" | "socket" } {
  layout.worldConnector(ref, a);
  return { x: a.x, z: a.z, heading: a.heading, y: a.y, kind: a.kind };
}

/** The placement rules in force for this play (none on bare felt), and how often each refused a piece. */
let rules: Blocked | null = null;
const refusals = new Map<string, number>();
/** What refused the last piece `addOn` tried (null: it went). */
let lastRefusal: string | null = null;

/** The end of `type` a player puts on a free end of kind `kind`: any end joins, but one of the other kind reads as usual. */
function viaFor(type: PieceTypeId, flipped: boolean, kind: string): number {
  const via = getPieceDef(type, flipped).connectors.findIndex((c) => c.kind !== kind);
  return via === -1 ? 0 : via;
}

/**
 * Put `type` on the free end `ref` (seated by an end of the other kind where it has one, else its first: any two ends
 * join), returning its other free end, or null (the placement rules refuse it there).
 */
function addOn(layout: Layout, ref: number, type: PieceTypeId, flipped: boolean): { id: number; next: number } | null {
  const end = endOf(layout, ref);
  const def = getPieceDef(type, flipped);
  if (def.connectors.length === 0) return null;
  const via = viaFor(type, flipped, end.kind);
  const id = appendPiece(layout, type, flipped, ref, via);
  if (rules) {
    const p = layout.getPiece(id)!;
    const why = rules(type, flipped, p.pose, p.y, id);
    if (why) {
      layout.removePiece(id);
      refusals.set(why, (refusals.get(why) ?? 0) + 1);
      lastRefusal = why;
      return null;
    }
  }
  lastRefusal = null;
  const other = def.connectors.findIndex((_, k) => k !== via);
  return { id, next: connectorRef(id, other) };
}

/** How far a free end is from meeting the target: distance to a point a little in front of it, plus how far off it points. */
function cost(end: { x: number; z: number; heading: number; y: number }, target: { x: number; z: number; heading: number; y: number }): number {
  // Arrive along the target's line: aim at a point in front of it, then at it.
  // Far off, aim two curves' width in front of it (room to turn in); close, straight at it.
  const lead = Math.min(360, Math.hypot(target.x - end.x, target.z - end.z) / 2);
  const ax = target.x + Math.cos(target.heading) * lead;
  const az = target.z + Math.sin(target.heading) * lead;
  const d = Math.hypot(ax - end.x, az - end.z);
  const bearing = Math.atan2(az - end.z, ax - end.x);
  const off = Math.abs(normalizeAngle(end.heading - bearing));
  const facing = Math.abs(normalizeAngle(end.heading - (target.heading + Math.PI)));
  // Off the target's level: a ramp's worth of track (and more) to put right.
  const level = Math.abs(end.y - target.y) * 4;
  return d + 140 * off + (d < 300 ? 120 * facing : 0) + level;
}

/** Can Auto close the gap from free end `ref` now? Its fit (piece, pose, height), or null. */
function autoFrom(layout: Layout, ref: number, to: number): { type: PieceTypeId; pose: { x: number; z: number; heading: number }; y: number; flipped: boolean } | null {
  const end = endOf(layout, ref);
  const auto = addOn(layout, ref, "straight-216", false);
  if (!auto) return null;
  const p = layout.getPiece(auto.id)!;
  const seated = viaFor("straight-216", false, end.kind) as 0 | 1;
  layout.removePiece(auto.id);
  // Only a fit that meets the target end (Auto meets the nearest end it can; a player puts it where that's the target).
  const others = [...layout.pieceIds()].filter((id) => id !== pieceOfRef(to));
  const fit = fitAutoStraight(layout, p.pose, p.y, seated, others);
  return fit && { type: fit.type, pose: fit.pose, y: p.y, flipped: fit.flipped };
}

/** Near the end, a player tries pieces in hand: up to `depth` of them, after which Auto (or the slack) closes it. */
function finish(layout: Layout, ref: number, to: number, depth: number): { type: PieceTypeId; flipped: boolean }[] | null {
  const target = endOf(layout, to);
  const end = endOf(layout, ref);
  if (autoFrom(layout, ref, to)) return [];
  // A near miss the slack can pull closed counts too.
  const facing = Math.abs(normalizeAngle(end.heading - target.heading - Math.PI));
  if (Math.abs(end.y - target.y) < 1 && Math.hypot(end.x - target.x, end.z - target.z) < NEAR && facing < NEAR_TURN) return [];
  if (depth === 0) return null;
  for (const s of FINISH) {
    const next = addStep(layout, ref, s);
    if (!next) continue;
    const rest = finish(layout, next.next, to, depth - 1);
    layout.removePiece(next.id);
    if (rest) return [next.step, ...rest];
  }
  return null;
}

/** Put a piece down through the Editor on free end `ref`; returns its other free end. */
function lay(layout: Layout, editor: Editor, ref: number, type: PieceTypeId, flipped: boolean): number {
  const tmp = addOn(layout, ref, type, flipped)!;
  const placed = layout.getPiece(tmp.id)!;
  const via = indexOfRef(tmp.next);
  layout.removePiece(tmp.id);
  const id = editor.place(type, placed.pose, placed.y, flipped);
  return connectorRef(id, via);
}

/**
 * Lay track from free end `from` to the piece of free end `to`. `fiddle`: how many pieces a player tries in hand near
 * the end before Auto (2 is a casual player, about fifty tries; 3 a patient one, a few hundred).
 */
export function play(layout: Layout, editor: Editor, from: number, to: number, { maxPieces = 40, fiddle = 2, blocked = null as Blocked | null } = {}): PlayResult {
  rules = blocked;
  refusals.clear();
  try {
    return playOn(layout, editor, from, to, maxPieces, fiddle);
  } finally {
    rules = null;
  }
}

function mostRefused(): string | undefined {
  let best: string | undefined;
  let n = 0;
  for (const [why, k] of refusals) if (k > n) [best, n] = [why, k];
  return best;
}

function playOn(layout: Layout, editor: Editor, from: number, to: number, maxPieces: number, fiddle: number): PlayResult {
  const target = endOf(layout, to);
  // Reaching the target's piece (a station, a depot) at either end joins it.
  const goal = pieceOfRef(to);
  const ends = getPieceDef(layout.getPiece(goal)!.type, layout.getPiece(goal)!.flipped).connectors.map((_, k) => connectorRef(goal, k));
  const reached = () => ends.some((ref) => layout.joinedConnector(ref) !== -1);
  let cur = from;
  let pieces = 0;
  while (pieces < maxPieces) {
    if (reached()) return { ok: true, pieces, how: "joined" };
    const end = endOf(layout, cur);
    // Close enough to fiddle: try a few pieces in hand, then Auto.
    if (Math.hypot(end.x - target.x, end.z - target.z) < 900) {
      const plan = finish(layout, cur, to, fiddle);
      if (plan) {
        for (const s of plan) {
          cur = lay(layout, editor, cur, s.type, s.flipped);
          pieces++;
        }
        if (reached()) return { ok: true, pieces, how: "joined" };
        const miss = missOf(layout, cur, to);
        const fit = autoFrom(layout, cur, to);
        if (fit) {
          editor.place(fit.type, fit.pose, fit.y, fit.flipped);
          pieces++;
        }
        const ok = reached();
        const how = ok ? "joined" : fit ? "auto-unjoined" : miss.d < NEAR ? "slack-refused" : "plan-drifted";
        return { ok, pieces, how, miss: ok ? undefined : miss };
      }
    }
    // Otherwise lay the piece whose best continuation (up to three pieces) ends nearest to meeting the target.
    let best: { type: PieceTypeId; flipped: boolean } | null = null;
    let bestCost = Infinity;
    for (const s1 of AHEAD) {
      const one = addStep(layout, cur, s1);
      if (!one) continue;
      // A dead end (nothing goes on after it) costs extra, so the way round or over is taken before it's too late.
      let c = cost(endOf(layout, one.next), target) + DEAD_END * 2;
      for (const s2 of AHEAD) {
        const two = addStep(layout, one.next, s2);
        if (!two) continue;
        let c2 = cost(endOf(layout, two.next), target) + 1 + DEAD_END;
        for (const s3 of AHEAD) {
          const three = addStep(layout, two.next, s3);
          if (!three) continue;
          c2 = Math.min(c2, cost(endOf(layout, two.next), target) + 1, cost(endOf(layout, three.next), target) + 2);
          layout.removePiece(three.id);
        }
        c = Math.min(c, c2);
        layout.removePiece(two.id);
      }
      // Going up or down costs a little: a player keeps to the level unless it helps.
      if (one.step.type === "ramp") c += 40;
      layout.removePiece(one.id);
      if (c < bestCost) {
        bestCost = c;
        best = one.step;
      }
    }
    if (!best) return { ok: false, pieces, how: "boxed-in", miss: missOf(layout, cur, to), blockedBy: mostRefused() };
    cur = lay(layout, editor, cur, best.type, best.flipped);
    pieces++;
  }
  const ok = reached();
  return { ok, pieces, how: ok ? "joined" : "too-many", miss: ok ? undefined : missOf(layout, cur, to), blockedBy: ok ? undefined : mostRefused() };
}

function missOf(layout: Layout, ref: number, to: number): { d: number; angle: number; alike: boolean } {
  const e = endOf(layout, ref);
  const t = endOf(layout, to);
  return { d: Math.round(Math.hypot(e.x - t.x, e.z - t.z)), angle: Math.round((Math.abs(normalizeAngle(e.heading - t.heading - Math.PI)) * 180) / Math.PI), alike: e.kind === t.kind };
}
