import { GIRDER_PIER, RISER_HEIGHT, TRACK_WIDTH, TRENCH_HALF, TRENCH_INSET, TRENCH_WALL, UNDERPASS_DIP } from "./constants";
import type { Layout, PlacedPiece } from "./layout";
import { createSample, pathLength, samplePath } from "./path";
import type { Pose } from "./math";
import { ignores, type Ignore } from "./overlap";
import { getPieceDef, type PieceTypeId } from "./pieces";

/** The felt's holes for the layout's underpasses: each trench's outline in world x/z, a little inside its rim. */
export function underpassHoles(layout: Layout): { x: number; z: number }[][] {
  const holes: { x: number; z: number }[][] = [];
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    // (On a hilltop its trench is cut into the hill instead: see the landscape's cuttings.)
    if (p.type !== "underpass" || layout.isLifted(id) || p.y > 0.5) continue;
    const len = pathLength(getPieceDef(p.type, p.flipped).paths[0].geom);
    const x0 = TRENCH_INSET + 2;
    const x1 = len - TRENCH_INSET - 2;
    const h = TRENCH_HALF + TRENCH_WALL / 2;
    const c = Math.cos(p.pose.heading);
    const s = Math.sin(p.pose.heading);
    holes.push(
      [
        [x0, -h],
        [x1, -h],
        [x1, h],
        [x0, h],
      ].map(([x, z]) => ({ x: p.pose.x + x * c - z * s, z: p.pose.z + x * s + z * c })),
    );
  }
  return holes;
}

const a = createSample();
const b = createSample();

type At = Pick<PlacedPiece, "type" | "flipped" | "pose" | "y">;
const isBridgeType = (t: string): boolean => t === "bridge" || t === "bridge-curve";

/**
 * Is this bridge one level up over this underpass's dip (so it's drawn as a girder span, open underneath)? Any of its
 * track within a trench's width of the underpass's deep middle.
 */
export function girderOver(bridge: At, u: At): boolean {
  if (!isBridgeType(bridge.type) || u.type !== "underpass") return false;
  if (Math.hypot(u.pose.x - bridge.pose.x, u.pose.z - bridge.pose.z) > 600) return false;
  // One level above the underpass's ends.
  if (Math.abs(bridge.y - u.y - RISER_HEIGHT) > 1) return false;
  const mine = getPieceDef(bridge.type, bridge.flipped).paths[0].geom;
  const myLen = pathLength(mine);
  const mc = Math.cos(bridge.pose.heading);
  const ms = Math.sin(bridge.pose.heading);
  const g = getPieceDef(u.type, u.flipped).paths[0].geom;
  const len = pathLength(g);
  const uc = Math.cos(u.pose.heading);
  const us = Math.sin(u.pose.heading);
  for (let i = 0; i <= 24; i++) {
    samplePath(g, (len * i) / 24, a);
    if (a.y > -UNDERPASS_DIP * 0.9) continue;
    const ax = u.pose.x + a.x * uc - a.z * us;
    const az = u.pose.z + a.x * us + a.z * uc;
    for (let k = 0; k <= 24; k++) {
      samplePath(mine, (myLen * k) / 24, b);
      const bx = bridge.pose.x + b.x * mc - b.z * ms;
      const bz = bridge.pose.z + b.x * ms + b.z * mc;
      if (Math.hypot(ax - bx, az - bz) < TRENCH_HALF) return true;
    }
  }
  return false;
}

/** Is this a bridge drawn as a girder span: one level up over any underpass's dip on the layout? */
export function overUnderpass(layout: Layout, piece: At): boolean {
  if (!isBridgeType(piece.type)) return false;
  for (const id of layout.pieceIds()) {
    const u = layout.getPiece(id)!;
    if (u.type === "underpass" && !layout.isLifted(id) && girderOver(piece, u)) return true;
  }
  return false;
}

/**
 * Would this bridge's supports stand in this underpass's trench? A girder span stands on a pier at each end; a bridge
 * on arches (any other) on its viaduct, all along (its openings aren't counted: an arch can't reach down into a trench).
 */
export function supportInTrench(bridge: At, u: At): boolean {
  if (!isBridgeType(bridge.type) || u.type !== "underpass" || bridge.y <= u.y + 0.5) return false;
  if (Math.hypot(u.pose.x - bridge.pose.x, u.pose.z - bridge.pose.z) > 700) return false;
  const girder = girderOver(bridge, u);
  const g = getPieceDef(bridge.type, bridge.flipped).paths[0].geom;
  const len = pathLength(g);
  const ulen = pathLength(getPieceDef(u.type, u.flipped).paths[0].geom);
  const bc = Math.cos(bridge.pose.heading);
  const bs = Math.sin(bridge.pose.heading);
  const uc = Math.cos(u.pose.heading);
  const us = Math.sin(u.pose.heading);
  const out = TRENCH_HALF + TRENCH_WALL;
  // Points over the support's footprint: a pier's 22 × 38 at each end, or the viaduct's width all along.
  const along: number[] = [];
  if (girder) for (const c of [GIRDER_PIER / 2 + 2, len - GIRDER_PIER / 2 - 2]) along.push(c - GIRDER_PIER / 2, c, c + GIRDER_PIER / 2);
  else for (let s = 0; s <= len; s += 6) along.push(s);
  const half = TRACK_WIDTH / 2 - 1;
  for (const s of along) {
    samplePath(g, s, a);
    for (const w of [-half, 0, half]) {
      const lx = a.x - Math.sin(a.heading) * w;
      const lz = a.z + Math.cos(a.heading) * w;
      const x = bridge.pose.x + lx * bc - lz * bs - u.pose.x;
      const z = bridge.pose.z + lx * bs + lz * bc - u.pose.z;
      // In the underpass's own frame.
      const ux = x * uc + z * us;
      const uz = -x * us + z * uc;
      if (ux > TRENCH_INSET - 1 && ux < ulen - TRENCH_INSET + 1 && Math.abs(uz) < out + 1) return true;
    }
  }
  return false;
}

/**
 * The first piece whose underpass trench this piece's supports would stand in (a bridge), or that would stand in its
 * trench (an underpass): −1 for none. Called on every pointer move while dragging: only bridges and underpasses look.
 */
export function trenchClash(layout: Layout, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: Ignore): number {
  if (!isBridgeType(type) && type !== "underpass") return -1;
  const me: At = { type, flipped, pose, y };
  for (const id of layout.pieceIds()) {
    if (ignores(ignore, id) || layout.isLifted(id)) continue;
    const q = layout.getPiece(id)!;
    if (type === "underpass" ? supportInTrench(q, me) : supportInTrench(me, q)) return id;
  }
  return -1;
}
