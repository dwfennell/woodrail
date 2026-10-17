import { connectorRef, createWorldConnector, indexOfRef, pieceOfRef, type Layout } from "./layout";
import { angleDiff, normalizeAngle, type Pose } from "./math";
import { getPieceDef, type PieceTypeId } from "./pieces";

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
/** Pieces placed in the same spot as the straight they'd replace this far up or down (mm) count as on it. */
const SAME_HEIGHT = 1;
/** Held square across a line, the piece lies along it as if held turned this little (radians) further back. */
const TIE_TURN = 1e-3;

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
 * it may be over) and turned to `heading`, go if it were dropped onto the plain straight under it (within `reach` mm
 * of its centre line)? It takes the place of that straight, or of a run of straights joined in line with it whose
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
  // The plain straight whose centre line passes nearest the held centre.
  let onto = -1;
  let best = reach;
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    const l = plainLength(p.type);
    if (l === 0 || layout.isLifted(id)) continue;
    const c = at(p.y);
    if (!c) continue;
    const dx = c.x - p.pose.x;
    const dz = c.z - p.pose.z;
    if (Math.abs(dx) > l + reach || Math.abs(dz) > l + reach) continue;
    const ch = Math.cos(p.pose.heading);
    const sh = Math.sin(p.pose.heading);
    const along = ch * dx + sh * dz;
    const across = Math.abs(-sh * dx + ch * dz);
    if (along < 0 || along > l || across >= best) continue;
    onto = id;
    best = across;
  }
  if (onto === -1) return NONE;
  if (!canTake(onto)) return { kind: "busy", onto };
  const here = layout.getPiece(onto)!;
  const held = at(here.y)!;
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
