import { RISER_HEIGHT, TRACK_THICKNESS, TRACK_WIDTH } from "./constants";
import type { Layout } from "./layout";
import type { Pose } from "./math";
import { createSample, pathLength, samplePath } from "./path";
import { getPieceDef, type PieceTypeId } from "./pieces";

/**
 * A piece's footprint as a chain of discs along its track (piece-local), each with the height band it occupies.
 * Discs are narrower than the track and stop short of the ends, so pieces joined end to end, or laid side by side,
 * never touch; pieces stacked, crossing or overlapping at the same height do.
 */
interface Disc {
  x: number;
  z: number;
  y0: number;
  y1: number;
}

const RADIUS = TRACK_WIDTH / 2 - 6;
/** Far enough in that a piece pushed 9 mm into its neighbour (the joint's play) still clears it. */
const END_INSET = 20;
const STEP = 14;
/** Bands that overlap by less than this still count as clear (pieces resting on a riser touch it). */
const SLACK = 2;

const cache = new Map<string, { discs: Disc[]; reach: number }>();

function footprint(type: PieceTypeId, flipped: boolean): { discs: Disc[]; reach: number } {
  const key = `${type}:${flipped ? 1 : 0}`;
  let f = cache.get(key);
  if (f) return f;
  const def = getPieceDef(type, flipped);
  const discs: Disc[] = [];
  if (def.paths.length === 0) {
    // A riser: a block under the track, its full height.
    for (const [x, z] of [[0, 0], [14, 14], [14, -14], [-14, 14], [-14, -14]]) discs.push({ x, z, y0: 0, y1: def.supportHeight || RISER_HEIGHT });
  }
  const s = createSample();
  for (const path of def.paths) {
    const len = pathLength(path.geom);
    const span = Math.max(0, len - 2 * END_INSET);
    const n = Math.max(1, Math.ceil(span / STEP));
    for (let k = 0; k <= n; k++) {
      samplePath(path.geom, END_INSET + (span * k) / n, s);
      discs.push({ x: s.x, z: s.z, y0: s.y, y1: s.y + TRACK_THICKNESS });
    }
  }
  let reach = 0;
  for (const d of discs) reach = Math.max(reach, Math.hypot(d.x, d.z) + RADIUS);
  f = { discs, reach };
  cache.set(key, f);
  return f;
}

// World-space discs of the piece being tested (reused between calls).
const placed: Disc[] = [];

function toWorld(discs: readonly Disc[], pose: Pose, y: number, out: Disc[]): void {
  const c = Math.cos(pose.heading);
  const sn = Math.sin(pose.heading);
  out.length = discs.length;
  for (let i = 0; i < discs.length; i++) {
    const d = discs[i];
    const o = out[i] ?? (out[i] = { x: 0, z: 0, y0: 0, y1: 0 });
    o.x = pose.x + d.x * c - d.z * sn;
    o.z = pose.z + d.x * sn + d.z * c;
    o.y0 = y + d.y0;
    o.y1 = y + d.y1;
  }
}

/**
 * Would a piece at this pose collide with a piece already on the layout? Returns the first piece in the way, or −1.
 * `ignoreId` skips the piece being moved. Called on every pointer move while dragging.
 */
export function findOverlap(layout: Layout, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: number): number {
  const mine = footprint(type, flipped);
  toWorld(mine.discs, pose, y, placed);
  const limit = (2 * RADIUS) ** 2;
  for (const id of layout.pieceIds()) {
    if (id === ignoreId || layout.isLifted(id)) continue;
    const other = layout.getPiece(id)!;
    const theirs = footprint(other.type, other.flipped);
    // Broad phase: footprint circles.
    if (Math.hypot(other.pose.x - pose.x, other.pose.z - pose.z) > mine.reach + theirs.reach) continue;
    const c = Math.cos(other.pose.heading);
    const sn = Math.sin(other.pose.heading);
    for (const d of theirs.discs) {
      const x = other.pose.x + d.x * c - d.z * sn;
      const z = other.pose.z + d.x * sn + d.z * c;
      const y0 = other.y + d.y0;
      const y1 = other.y + d.y1;
      for (const p of placed) {
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz < limit && p.y0 < y1 - SLACK && y0 < p.y1 - SLACK) return id;
      }
    }
  }
  return -1;
}
