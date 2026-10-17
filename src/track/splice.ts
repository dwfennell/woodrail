import { connectorRef, createWorldConnector, indexOfRef, pieceOfRef, type Layout } from "./layout";
import { angleDiff, normalizeAngle, type Pose } from "./math";
import { getPieceDef, PIECE_TYPES, type PieceTypeId } from "./pieces";

/**
 * A straight-shaped piece (a depot, a station) dropped onto a line: the plain straights it takes the place of, and
 * where it goes, end to end with the track either side. `misfit`: over a straight, but no run of straights there is
 * its length; `busy`: a train stands on that straight.
 */
export type Splice =
  | { readonly kind: "splice"; readonly covers: readonly number[]; readonly pose: Pose; readonly y: number }
  | { readonly kind: "misfit" | "busy"; readonly onto: number }
  | { readonly kind: "none" };

const NONE: Splice = { kind: "none" };
/** Lengths (mm) that add up within this count as equal (track joints have a little play). */
const LENGTH_SLACK = 0.5;
/** Joined straights this far off parallel (radians) are still one line. */
const LINE_ANGLE = 0.02;
/** A gap's two ends this far off facing each other along it (radians: a joint's play) are still in line. */
const GAP_ANGLE = 0.05;
/** Pieces placed in the same spot as the straight they'd replace this far up or down (mm) count as on it. */
const SAME_HEIGHT = 1;
/** Held square across a line, the piece lies along it as if held turned this little (radians) further back. */
const TIE_TURN = 1e-3;
/** Choosing which straight its track is over: each mm from its middle counts as this many mm off the line. */
const MIDDLE_WEIGHT = 0.25;

const PLAIN_STRAIGHT = /^straight-\d+$/;

/** A plain straight (not a signal, bridge, adapter or joiner): what a depot may be dropped onto. */
export const isPlainStraight = (type: PieceTypeId): boolean => PLAIN_STRAIGHT.test(type);

/** Each piece type's length as a plain straight, or 0 (worked out once per type: read on every pointer move). */
const plainLengths = new Map<PieceTypeId, number>();
function plainLength(type: PieceTypeId): number {
  let l = plainLengths.get(type);
  if (l === undefined) {
    l = isPlainStraight(type) ? straightLength(type, false) : 0;
    plainLengths.set(type, l);
  }
  return l;
}

/** A straight piece's length, or 0 if it isn't one straight line between two ends (curves, switches, ramps). */
export function straightLength(type: PieceTypeId, flipped: boolean): number {
  const def = getPieceDef(type, flipped);
  if (def.connectors.length !== 2 || def.paths.length !== 1 || def.isSwitch) return 0;
  const g = def.paths[0].geom;
  if (g.kind !== "line" || g.rise !== 0 || g.start.x !== 0 || g.start.z !== 0 || g.start.heading !== 0) return 0;
  const end = def.connectors[1].pose;
  return Math.abs(end.z) < 1e-6 && Math.abs(end.x - g.length) < 1e-6 ? g.length : 0;
}

const a = createWorldConnector();
const b = createWorldConnector();

/**
 * Where a held piece's centre is, seen at a height (it's under the finger, which points at different spots at
 * different heights), or null if the finger points nowhere at that height. A point: the same at every height.
 */
export type HeldCentre = { x: number; z: number } | ((y: number) => { x: number; z: number } | null);

/**
 * Where would a straight-shaped piece `type`, held with its centre at `centre` (seen at the height of each straight
 * it may be over) and turned to `heading`, go if it were dropped onto the plain straight its track is over (some
 * part of its track within `reach` mm of the straight's centre line: held across a line, its middle may be well off
 * it)? It takes the place of that straight, or of a run of straights joined in line with it whose
 * lengths add up to its own, and lies along the line, whichever way round is nearer to how it's held (so turning it
 * right round puts its building on the other side).
 * `canTake` says which straights may be taken up (none a train stands on). Called on pointer move while a depot is
 * held: one pass over the pieces, then a short walk along the line.
 */
export function findSplice(
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  centre: HeldCentre,
  heading: number,
  reach: number,
  canTake: (pieceId: number) => boolean = () => true,
): Splice {
  const length = straightLength(type, flipped);
  if (length === 0) return NONE;
  const at = typeof centre === "function" ? centre : () => centre;
  const half = length / 2;
  const hc = Math.cos(heading);
  const hs = Math.sin(heading);
  // The plain straight its own track (held along `heading`, `length` long, through the held centre) comes nearest,
  // within `reach` of its centre line: held across a line with its middle well off it, its track still crosses it.
  // Of those, the one met nearest its middle (a straight under the middle is taken over one under an end).
  let onto = -1;
  let best = Infinity;
  const held = { x: 0, z: 0 };
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    const l = plainLength(p.type);
    if (l === 0 || layout.isLifted(id)) continue;
    const c = at(p.y);
    if (!c) continue;
    const dx = c.x - p.pose.x;
    const dz = c.z - p.pose.z;
    if (Math.abs(dx) > l + half + reach || Math.abs(dz) > l + half + reach) continue;
    const ch = Math.cos(p.pose.heading);
    const sh = Math.sin(p.pose.heading);
    // The held track in this straight's frame: along = a0 + t·ca, across = c0 + t·sa, for t in [−half, half].
    const a0 = ch * dx + sh * dz;
    const c0 = -sh * dx + ch * dz;
    const ca = ch * hc + sh * hs;
    const sa = ch * hs - sh * hc;
    // The part of it beside the straight (0 ≤ along ≤ l).
    let lo = -half;
    let hi = half;
    if (Math.abs(ca) > 1e-9) {
      const t0 = -a0 / ca;
      const t1 = (l - a0) / ca;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    } else if (a0 < 0 || a0 > l) continue;
    if (lo > hi) continue;
    // Where on that part it comes nearest the centre line (nearest its own middle, if all of it is as near).
    const t = Math.abs(sa) > 1e-9 ? Math.min(hi, Math.max(lo, -c0 / sa)) : Math.min(hi, Math.max(lo, 0));
    const across = Math.abs(c0 + t * sa);
    if (across >= reach) continue;
    const score = across + MIDDLE_WEIGHT * Math.abs(t);
    if (score >= best) continue;
    onto = id;
    best = score;
    held.x = c.x + t * hc;
    held.z = c.z + t * hs;
  }
  if (onto === -1) return NONE;
  if (!canTake(onto)) return { kind: "busy", onto };
  const here = layout.getPiece(onto)!;
  const own = plainLength(here.type);
  // The straights joined in line beyond each end, as far as could be needed: [ids, lengths, the run's far end].
  const side = (end: 0 | 1) => {
    const ids: number[] = [];
    const lengths: number[] = [];
    const ends: number[] = [connectorRef(onto, end)];
    let total = own;
    let ref = connectorRef(onto, end);
    while (total < length - LENGTH_SLACK) {
      const partner = layout.joinedConnector(ref);
      if (partner === -1) break;
      const id = pieceOfRef(partner);
      const p = layout.getPiece(id);
      const l = p ? plainLength(p.type) : 0;
      if (!p || l === 0 || id === onto || ids.includes(id) || !canTake(id)) break;
      if (Math.abs(p.y - here.y) > SAME_HEIGHT || angleDiff(2 * p.pose.heading, 2 * here.pose.heading) > 2 * LINE_ANGLE) break;
      ids.push(id);
      lengths.push(l);
      total += l;
      ref = connectorRef(id, 1 - indexOfRef(partner));
      ends.push(ref);
    }
    return { ids, lengths, ends };
  };
  const back = side(0);
  const ahead = side(1);
  // Of the runs through this straight that are just the right length, the one centred nearest where it's held.
  let pick: { from: number; to: number; off: number } | null = null;
  let behind = 0;
  for (let i = 0; i <= back.ids.length; i++) {
    if (i > 0) behind += back.lengths[i - 1];
    let beyond = 0;
    for (let j = 0; j <= ahead.ids.length; j++) {
      if (j > 0) beyond += ahead.lengths[j - 1];
      const total = own + behind + beyond;
      if (total > length + LENGTH_SLACK) break;
      if (total < length - LENGTH_SLACK) continue;
      layout.worldConnector(back.ends[i], a);
      layout.worldConnector(ahead.ends[j], b);
      const off = Math.hypot((a.x + b.x) / 2 - held.x, (a.z + b.z) / 2 - held.z);
      if (!pick || off < pick.off) pick = { from: i, to: j, off };
    }
  }
  if (!pick) return { kind: "misfit", onto };
  layout.worldConnector(back.ends[pick.from], a);
  layout.worldConnector(ahead.ends[pick.to], b);
  const covers = [...back.ids.slice(0, pick.from).reverse(), onto, ...ahead.ids.slice(0, pick.to)];
  // Lie along the line from one far end to the other, whichever way round is nearer to how it's held. Held square
  // across the line, it's a tie: a hair's turn decides it, the same way every time, so turning it right round (Flip)
  // always swaps it.
  const h = Math.atan2(b.z - a.z, b.x - a.x);
  const pose = angleDiff(h, heading - TIE_TURN) < Math.PI / 2 ? { x: a.x, z: a.z, heading: normalizeAngle(h) } : { x: b.x, z: b.z, heading: normalizeAngle(h + Math.PI) };
  return { kind: "splice", covers, pose, y: here.y };
}

/** A plain straight to put down: one piece of a gap's fill. */
export interface FillPiece {
  readonly type: PieceTypeId;
  readonly pose: Pose;
  readonly y: number;
}

/** Plain straights and their lengths, longest first (worked out once). */
let straightTypes: { type: PieceTypeId; length: number }[] | null = null;
function plainStraights(): { type: PieceTypeId; length: number }[] {
  return (straightTypes ??= PIECE_TYPES.map((type) => ({ type, length: plainLength(type) }))
    .filter((s) => s.length > 0)
    .sort((x, y) => y.length - x.length));
}

/**
 * Plain straights whose lengths add up to `length` (within the joints' play): one if there's one that long, else two,
 * longest first and as near the same length as can be. Null if no one or two do.
 */
export function straightsFor(length: number): PieceTypeId[] | null {
  const all = plainStraights();
  const one = all.find((s) => Math.abs(s.length - length) <= LENGTH_SLACK);
  if (one) return [one.type];
  let best: PieceTypeId[] | null = null;
  let spread = Infinity;
  for (const x of all) {
    for (const y of all) {
      if (y.length > x.length || Math.abs(x.length + y.length - length) > LENGTH_SLACK || x.length - y.length >= spread) continue;
      spread = x.length - y.length;
      best = [x.type, y.type];
    }
  }
  return best;
}

/**
 * The gap a straight-shaped piece (a depot) leaves in a line when it's taken out from between two track ends, `from`
 * and `to` (refs of the ends it was joined to, now free): plain straights to fill it, end to end from `from` to `to`,
 * aligned to the gap. Null unless both ends are still free, at the same height, facing each other along one line, and
 * the gap is a length plain straights make (see `straightsFor`).
 */
export function gapFill(layout: Layout, from: number, to: number): FillPiece[] | null {
  for (const ref of [from, to]) {
    const id = pieceOfRef(ref);
    if (!layout.getPiece(id) || layout.isLifted(id) || layout.joinedConnector(ref) !== -1) return null;
  }
  layout.worldConnector(from, a);
  layout.worldConnector(to, b);
  if (Math.abs(a.y - b.y) > SAME_HEIGHT) return null;
  const h = Math.atan2(b.z - a.z, b.x - a.x);
  // Each end faces out of its own piece, into the gap: toward the other.
  if (angleDiff(a.heading, h) > GAP_ANGLE || angleDiff(b.heading, h + Math.PI) > GAP_ANGLE) return null;
  const types = straightsFor(Math.hypot(b.x - a.x, b.z - a.z));
  if (!types) return null;
  const out: FillPiece[] = [];
  let x = a.x;
  let z = a.z;
  for (const type of types) {
    out.push({ type, pose: { x, z, heading: normalizeAngle(h) }, y: a.y });
    x += Math.cos(h) * plainLength(type);
    z += Math.sin(h) * plainLength(type);
  }
  return out;
}
