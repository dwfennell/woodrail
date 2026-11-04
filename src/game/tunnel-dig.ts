import { hillsOf, type BlockReason } from "../landscape";
import {
  candidatesFrom,
  connectorRef,
  getPieceDef,
  ignores,
  isPlainStraight,
  SHORT_MOUTH_DEPTH,
  SHORT_MOUTH_LENGTH,
  straightLength,
  straightsFor,
  type DrawEnd,
  type Ignore,
  type PieceTypeId,
  type Pose,
} from "../track";
import { trackPlacement, type TrackRules } from "./track-rules";

/** A piece to put down for a tunnel. */
export interface TunnelPiece {
  readonly type: PieceTypeId;
  readonly pose: Pose;
  readonly y: number;
  readonly flipped: boolean;
}

/** Why a straight line from here can't be bored under the hill ahead. */
export type TunnelRefusal = "none" | "square" | "felt" | "low" | "long" | "edge" | "near" | "far" | "busy";

export const TUNNEL_MESSAGES: Record<TunnelRefusal, string> = {
  none: "No hill ahead to tunnel under",
  square: "Meet the hill's side square for a tunnel",
  felt: "A tunnel starts from the felt, up to a hill's side",
  low: "The hill dips to the felt on the way through: tunnel under one hill at a time",
  long: "Too long for a tunnel: the far side is more than 20 squares away",
  edge: "The hill runs to the edge of the map",
  near: "Too near the hill for a tunnel mouth: start a square further back",
  far: "No room past the hill for the tunnel to come up",
  busy: "Something's in the way of the tunnel",
};

/** The longest tunnel under a hill (mm): 20 squares. */
export const MAX_TUNNEL = 20 * 72;
const STEP = 6;
const LATTICE = 18;
/** The line runs on this far past the far mouth, so it ends on open ground. */
const PAST = 36;
/** Across the line, these offsets are looked at (the train's width, and a little). */
const SIDES = [-20, 0, 20];

export type TunnelPlan =
  | {
      readonly kind: "bore";
      /** Straights the tunnel is laid in place of (behind the line's end), to be taken up. */
      readonly covers: readonly number[];
      readonly pieces: readonly TunnelPiece[];
      /** The pieces' types in turn, and how far each takes the line up or down (for Draw to seat them). */
      readonly steps: readonly { type: PieceTypeId; dy: number }[];
      /** Along the line from where it starts: the hill's near side and far side (mm). */
      readonly face: number;
      readonly exit: number;
    }
  | { readonly kind: "refused"; readonly why: TunnelRefusal; readonly block?: BlockReason };

/**
 * Pieces seated one after another from `end`, the way it faces: each the candidate of its type that goes on straight
 * and comes out at the height wanted (a mouth down or up). Pegs and holes as the Draw tool seats them. Null if one won't.
 */
function chain(end: DrawEnd, steps: readonly { type: PieceTypeId; dy: number }[]): TunnelPiece[] | null {
  const out: TunnelPiece[] = [];
  let e = end;
  for (const { type, dy } of steps) {
    const c = candidatesFrom(e, [type]).find((q) => Math.abs(Math.sin(q.end.heading - e.heading)) < 1e-6 && Math.cos(q.end.heading - e.heading) > 0 && Math.abs(q.end.y - (e.y + dy)) < 0.5);
    if (!c) return null;
    out.push({ type: c.type, pose: c.pose, y: c.y, flipped: c.flipped });
    e = c.end;
  }
  return out;
}

/** Plain straights making up `length` (a multiple of 18), longest first, or null. */
function straights(length: number): PieceTypeId[] | null {
  const out: PieceTypeId[] = [];
  let left = length;
  while (left > 432.5) {
    out.push("straight-216");
    left -= 216;
  }
  if (left < 0.5) return out;
  const rest = straightsFor(left);
  return rest ? [...out, ...rest] : null;
}

/**
 * A tunnel under the hill ahead of a line's end on the felt (`from`, heading at the hill): straights up to a short
 * tunnel mouth that runs down a level into the board, its foot just under the hill's side; straights a level under the
 * felt on under the hill (a level of hill and the board over them: two levels); a short mouth turned round, up out of
 * the far side; and a straight or two on, to open ground. Every point under the hill must have at least a level of it
 * over the line. Refused if the line meets the hill at a slant, the hill dips to the felt on the way, the far side is
 * more than 20 squares on, or there's no room for a mouth either side. Bounded: one walk ahead, and the track rules for
 * the few pieces. (What a straight dropped against a hill's side, or a drawn line across one, lays.)
 */
export function planTunnel(rules: TrackRules, from: DrawEnd, ignore: Ignore = -1): TunnelPlan {
  if (Math.abs(from.y) > 0.5) return { kind: "refused", why: "felt" };
  if (Math.abs(Math.sin(2 * from.heading)) > 0.02) return { kind: "refused", why: "square" };
  const hills = hillsOf(rules.land.grid);
  const ux = Math.cos(from.heading);
  const uz = Math.sin(from.heading);
  const grid = rules.land.grid;
  /** The lowest and highest ground across the line at `d` along it, or null off the map. */
  const across = (d: number): { lo: number; hi: number } | null => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const side of SIDES) {
      const x = from.x + ux * d - uz * side;
      const z = from.z + uz * d + ux * side;
      if (grid.cellAtWorld(x, z) === -1) return null;
      const g = hills.groundAt(x, z);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    return { lo, hi };
  };
  let face = -1;
  let exit = -1;
  for (let d = 0; d <= MAX_TUNNEL + 800; d += STEP) {
    const g = across(d);
    if (!g) return { kind: "refused", why: face < 0 ? "none" : "edge" };
    if (face < 0) {
      if (g.hi > 0.5) {
        // The hill's side: met square, all across at once.
        if (g.lo < 0.5) return { kind: "refused", why: "square" };
        face = d;
      } else if (d > 600) return { kind: "refused", why: "none" };
      continue;
    }
    if (g.lo >= SHORT_MOUTH_DEPTH - 0.5) continue;
    // Out the far side: square, and onto the felt (not a dip back up into the hill).
    if (g.hi > 0.5) return { kind: "refused", why: g.lo < 0.5 ? "square" : "low" };
    exit = d;
    break;
  }
  if (face < 0) return { kind: "refused", why: "none" };
  if (exit < 0 || exit - face > MAX_TUNNEL) return { kind: "refused", why: "long" };
  // Halve the steps down to the sides (to a fraction of a mm).
  const side = (lo: number, hi: number, inHill: boolean): number => {
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const g = across(mid)!;
      if ((g.hi > 0.5) === inHill) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  // Felt past the far side for the mouth up and a little more: else the hill only dips there (a valley in it).
  for (let d = exit; d <= exit + SHORT_MOUTH_LENGTH + PAST; d += STEP) {
    const g = across(d);
    if (!g) return { kind: "refused", why: "far" };
    if (g.hi > 0.5) return { kind: "refused", why: "low" };
  }
  face = side(face - STEP, face, true);
  exit = side(exit - STEP, exit, false);
  // The mouth down: its foot on the 18 mm lattice just under the hill's side (never on it: the track on from there is
  // all under the hill).
  const start = Math.ceil((face + 1 - SHORT_MOUTH_LENGTH) / LATTICE) * LATTICE;
  if (start < -0.5) return { kind: "refused", why: "near" };
  const foot = start + SHORT_MOUTH_LENGTH;
  // The mouth up: its foot just inside the far side.
  const under = Math.floor((exit - 1 - foot) / LATTICE) * LATTICE;
  const before = straights(start);
  const below = straights(under);
  if (!before || !below) return { kind: "refused", why: "busy" };
  const steps = [
    ...before.map((type) => ({ type, dy: 0 })),
    { type: "tunnel-mouth-short" as PieceTypeId, dy: -SHORT_MOUTH_DEPTH },
    ...below.map((type) => ({ type, dy: 0 })),
    { type: "tunnel-mouth-short" as PieceTypeId, dy: SHORT_MOUTH_DEPTH },
    ...(straights(Math.ceil(PAST / LATTICE) * LATTICE) ?? []).map((type) => ({ type, dy: 0 })),
  ];
  const pieces = chain(from, steps);
  if (!pieces) return { kind: "refused", why: "busy" };
  for (const p of pieces) {
    const placed = trackPlacement(rules, p.type, p.flipped, p.pose, p.y, ignore);
    const why: BlockReason | null = placed.reason ?? (placed.risers.length > 0 ? "unsupported" : null);
    if (why) return { kind: "refused", why: why === "portal" ? "square" : pieces.indexOf(p) > before.length + below.length ? "far" : "busy", block: why };
  }
  return { kind: "bore", covers: [], pieces, steps, face, exit };
}

/**
 * A tunnel for a plain straight dropped against a hill's side: from its end that isn't in the hill, the way it runs
 * into it. If there's no room before the hill for the mouth, one or two plain straights of the line behind it are taken
 * up and the tunnel laid from further back (`covers`). Null if it doesn't apply (not a plain straight, no hill ahead).
 */
export function planBore(rules: TrackRules, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: Ignore = -1): TunnelPlan | null {
  if (!isPlainStraight(type) || Math.abs(y) > 0.5) return null;
  const def = getPieceDef(type, flipped);
  const len = straightLength(type, flipped);
  const hills = hillsOf(rules.land.grid);
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const ends = [0, 1].map((k) => {
    const q = def.connectors[k];
    return { x: pose.x + q.pose.x * c - q.pose.z * s, z: pose.z + q.pose.x * s + q.pose.z * c, kind: q.kind };
  });
  // Which end is out of the hill (the line's side), and so which way it runs in.
  const inHill = ends.map((e) => hills.groundAt(e.x, e.z) > 0.5);
  if (inHill[0] === inHill[1]) {
    // Both ends out: it runs into the hill only if its middle is in.
    if (inHill[0] || hills.groundAt(pose.x + (len / 2) * c, pose.z + (len / 2) * s) <= 0.5) return null;
  }
  const k = inHill[0] && !inHill[1] ? 1 : 0;
  const o = ends[k];
  const t = ends[1 - k];
  const heading = Math.atan2(t.z - o.z, t.x - o.x);
  // The line's end it's dropped on: a hole there takes a peg (the straight's own end kind is what the end meets).
  const start: DrawEnd = { x: o.x, z: o.z, heading, y, kind: o.kind === "peg" ? "socket" : "peg" };
  const layout = rules.layout;
  // The plain straights behind it, in line, taken up if the mouth needs the room.
  const behind: number[] = [];
  const ends2: DrawEnd[] = [start];
  let at = start;
  for (let n = 0; n < 2; n++) {
    let found = -1;
    for (const id of layout.pieceIds()) {
      if (ignores(ignore, id) || layout.isLifted(id) || behind.includes(id)) continue;
      const p = layout.getPiece(id)!;
      if (!isPlainStraight(p.type) || Math.abs(p.y - y) > 0.5) continue;
      if (Math.abs(p.pose.x - at.x) > 300 || Math.abs(p.pose.z - at.z) > 300) continue;
      for (let j = 0; j < 2 && found < 0; j++) {
        const w = layout.worldConnector(connectorRef(id, j), endScratch);
        if (Math.hypot(w.x - at.x, w.z - at.z) > 2) continue;
        const far = layout.worldConnector(connectorRef(id, 1 - j), farScratch);
        const h = Math.atan2(at.z - far.z, at.x - far.x);
        if (Math.abs(Math.sin(h - heading)) > 1e-3 || Math.cos(h - heading) < 0) continue;
        found = id;
        at = { x: far.x, z: far.z, heading, y, kind: far.kind === "peg" ? "socket" : "peg" };
      }
      if (found >= 0) break;
    }
    if (found < 0) break;
    behind.push(found);
    ends2.push(at);
  }
  let last: TunnelPlan | null = null;
  for (let n = 0; n < ends2.length; n++) {
    const covers = behind.slice(0, n);
    const without: Set<number> = new Set(covers);
    if (typeof ignore === "number") without.add(ignore);
    else for (const id of ignore) without.add(id);
    const plan = planTunnel(rules, ends2[n], without);
    if (plan.kind === "bore") return { ...plan, covers };
    last = plan;
    if (plan.why !== "near") return plan;
  }
  return last;
}
const endScratch = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" as const };
const farScratch = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" as const };
