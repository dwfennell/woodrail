import { RISER_HEIGHT, TRENCH_HALF, TRENCH_INSET, TRENCH_WALL, UNDERPASS_DIP } from "./constants";
import type { Layout, PlacedPiece } from "./layout";
import { createSample, pathLength, samplePath } from "./path";
import { getPieceDef } from "./pieces";

/** The felt's holes for the layout's underpasses: each trench's outline in world x/z, a little inside its rim. */
export function underpassHoles(layout: Layout): { x: number; z: number }[][] {
  const holes: { x: number; z: number }[][] = [];
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    if (p.type !== "underpass" || layout.isLifted(id)) continue;
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

/**
 * Is this a bridge one level up over an underpass's dip (so it's drawn as a girder span, open underneath)? Any of its
 * track within a trench's width of the underpass's deep middle.
 */
export function overUnderpass(layout: Layout, piece: PlacedPiece): boolean {
  if (piece.type !== "bridge" && piece.type !== "bridge-curve") return false;
  const mine = getPieceDef(piece.type, piece.flipped).paths[0].geom;
  const myLen = pathLength(mine);
  const mc = Math.cos(piece.pose.heading);
  const ms = Math.sin(piece.pose.heading);
  for (const id of layout.pieceIds()) {
    const u = layout.getPiece(id)!;
    if (u.type !== "underpass" || layout.isLifted(id)) continue;
    if (Math.hypot(u.pose.x - piece.pose.x, u.pose.z - piece.pose.z) > 600) continue;
    // One level above the underpass's ends.
    if (Math.abs(piece.y - u.y - RISER_HEIGHT) > 1) continue;
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
        const bx = piece.pose.x + b.x * mc - b.z * ms;
        const bz = piece.pose.z + b.x * ms + b.z * mc;
        if (Math.hypot(ax - bx, az - bz) < TRENCH_HALF) return true;
      }
    }
  }
  return false;
}
