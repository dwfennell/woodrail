import { hillsOf, type BlockReason } from "../landscape";
import { straightLength, straightsFor, TUNNEL_COVER, type PieceTypeId, type Pose } from "../track";
import { trackBlock, type TrackRules } from "./track-rules";

/** A piece to put down for a tunnel. */
export interface TunnelPiece {
  readonly type: PieceTypeId;
  readonly pose: Pose;
  readonly y: number;
  readonly flipped: boolean;
}

/** Why a straight line from here can't be bored through the hill ahead. */
export type TunnelRefusal = "none" | "square" | "shallow" | "drop" | "long" | "edge" | "busy";

export const TUNNEL_MESSAGES: Record<TunnelRefusal, string> = {
  none: "No hill ahead to tunnel through",
  square: "Run into the hill square to its side for a tunnel mouth",
  shallow: "The hill is only one level over the line here: a tunnel needs two",
  drop: "The far side is lower: the tunnel would come out in mid-air",
  long: "Too long for a tunnel: the far side is more than 20 squares away",
  edge: "The hill runs to the edge of the map",
  busy: "Something's in the way on the far side",
};

/** The longest tunnel (mm): 20 squares. */
export const MAX_TUNNEL = 20 * 72;
const STEP = 6;
/** The line runs on this far past the far portal, so it ends on open ground. */
const PAST = 36;

export type TunnelPlan = { readonly kind: "bore"; readonly pieces: readonly TunnelPiece[]; readonly length: number; readonly inside: number; readonly hillAt: number; readonly entry: number; readonly exit: number } | { readonly kind: "refused"; readonly why: TunnelRefusal; readonly block?: BlockReason };

/**
 * A straight bored through the hill ahead of a track end (`from`, its base `y`, heading into the hill): plain straights
 * from it, in through the hill's side, on under two levels of hill or more, and out where the ground comes back down
 * to the line's level, a little past. Refused if the line meets the hill at a slant, passes under a single level
 * (too low to bore), comes out over lower ground, or runs too long. Bounded: one walk ahead, and the track rules for
 * the few pieces. (The prototype's planner: what a straight dropped into a hill's side, or Draw, would lay.)
 */
export function planTunnel(rules: TrackRules, from: Pose, y: number): TunnelPlan {
  const hills = hillsOf(rules.land.grid);
  const ux = Math.cos(from.heading);
  const uz = Math.sin(from.heading);
  if (Math.abs(Math.sin(2 * from.heading)) > 0.02) return { kind: "refused", why: "square" };
  const ground = (d: number, side: number) => hills.groundAt(from.x + ux * d - uz * side, from.z + uz * d + ux * side);
  let entry = -1;
  let exit = -1;
  let hillAt = -1;
  for (let d = 0; d <= MAX_TUNNEL + 600; d += STEP) {
    if (rules.land.grid.cellAtWorld(from.x + ux * d, from.z + uz * d) === -1) return { kind: "refused", why: "edge" };
    let lowest = Infinity;
    let highest = -Infinity;
    for (const side of [-18, 0, 18]) {
      const g = ground(d, side);
      lowest = Math.min(lowest, g);
      highest = Math.max(highest, g);
    }
    if (lowest < y - 0.5) return { kind: "refused", why: hillAt >= 0 ? "drop" : "none" };
    if (highest > y + 0.5) {
      // In the hill: a level over the line is cut (a cutting), two or more bored (the tunnel).
      if (hillAt < 0) hillAt = d;
      if (entry < 0 && lowest >= y + TUNNEL_COVER - 0.5) entry = d;
      continue;
    }
    if (hillAt >= 0) {
      exit = d;
      break;
    }
    if (d > 600) return { kind: "refused", why: "none" };
  }
  if (entry < 0) entry = exit;
  if (exit < 0 || exit - hillAt > MAX_TUNNEL) return { kind: "refused", why: "long" };
  // Straights to reach past the far side, on the 18 mm lattice.
  let want = Math.ceil((exit + PAST) / 18) * 18;
  const pieces: TunnelPiece[] = [];
  let s = 0;
  while (want - s > 0.5) {
    const left = want - s;
    const fill = left > 432 ? (["straight-216"] as PieceTypeId[]) : straightsFor(left) ?? (["straight-216"] as PieceTypeId[]);
    for (const type of fill) {
      pieces.push({ type, pose: { x: from.x + ux * s, z: from.z + uz * s, heading: from.heading }, y, flipped: false });
      s += straightLength(type, false);
    }
    if (s > want) want = s;
  }
  for (const p of pieces) {
    const why = trackBlock(rules, p.type, p.flipped, p.pose, p.y, -1);
    if (why) return { kind: "refused", why: why === "shallow" ? "shallow" : why === "portal" ? "square" : "busy", block: why };
  }
  return { kind: "bore", pieces, length: s, inside: exit - entry, hillAt, entry, exit };
}
