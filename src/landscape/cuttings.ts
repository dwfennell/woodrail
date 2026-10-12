import { createSample, getPieceDef, pathLength, samplePath, TRACK_WIDTH, type Layout, type PieceTypeId, type Pose } from "../track";
import type { Landscape } from "./generate";
import { cutsHills, hillsOf, type HillCut } from "./hill-shape";
import { bridgeLevels } from "./support";

/**
 * The cuttings the ramps on a layout make in the hills: one for each plain ramp (not one up on arches). Sets them on
 * the map's `HillShape`; call whenever the layout changes.
 */
export function syncCuttings(land: Landscape, layout: Layout): void {
  const hills = hillsOf(land.grid);
  // Whether a ramp stands on arches is judged on the uncut hills.
  hills.setCuts([]);
  const cuts: HillCut[] = [];
  for (const id of layout.pieceIds()) {
    if (layout.isLifted(id)) continue;
    const p = layout.getPiece(id)!;
    if (!cutsHills(p.type) || bridgeLevels(land, p.type, p.flipped, p.pose, p.y) > 0) continue;
    cuts.push({ pose: { ...p.pose }, y: p.y, type: p.type, flipped: p.flipped });
  }
  hills.setCuts(cuts);
}

const sample = createSample();
/** Track is checked this often (mm) along its paths for ground a cutting would take away. */
const STEP = 8;

/**
 * Would a ramp put down here cut away the ground under track already resting on it (beside the cutting, or past its
 * ends)? Returns the first such piece, or −1. `ignoreId` is the piece being moved.
 */
export function cutUndermines(land: Landscape, layout: Layout, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: number): number {
  if (!cutsHills(type) || bridgeLevels(land, type, flipped, pose, y) > 0) return -1;
  const hills = hillsOf(land.grid);
  const cut: HillCut = { pose, y, type, flipped };
  const reach = 400;
  for (const id of layout.pieceIds()) {
    if (id === ignoreId || layout.isLifted(id)) continue;
    const p = layout.getPiece(id)!;
    if (Math.abs(p.pose.x - pose.x) > reach || Math.abs(p.pose.z - pose.z) > reach) continue;
    const def = getPieceDef(p.type, p.flipped);
    const ch = Math.cos(p.pose.heading);
    const sh = Math.sin(p.pose.heading);
    const points: { x: number; z: number; y: number }[] = [];
    if (def.paths.length === 0) points.push({ x: p.pose.x, z: p.pose.z, y: p.y });
    for (const path of def.paths) {
      const len = pathLength(path.geom);
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let k = 0; k <= n; k++) {
        samplePath(path.geom, (len * k) / n, sample);
        // Across the track's full width: it rests on its edges too.
        for (const lat of [-TRACK_WIDTH / 2, 0, TRACK_WIDTH / 2]) {
          const lx = sample.x - Math.sin(sample.heading) * lat;
          const lz = sample.z + Math.cos(sample.heading) * lat;
          points.push({ x: p.pose.x + lx * ch - lz * sh, z: p.pose.z + lx * sh + lz * ch, y: p.y + sample.y });
        }
      }
    }
    for (const q of points) {
      const before = hills.groundAt(q.x, q.z);
      // Resting on the ground here (not up on risers or a bridge), and the cutting would take it away.
      if (Math.abs(q.y - before) <= 0.5 && hills.groundWithCut(cut, q.x, q.z) < before - 0.5) return id;
    }
  }
  return -1;
}
