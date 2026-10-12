import { createSample, getPieceDef, pathLength, samplePath, TRACK_WIDTH, type Layout, type PieceTypeId, type Pose } from "../track";
import { FEAT_NONE, FEAT_TREE, SURF_GRASS, type LandscapeGrid } from "./grid";
import { hillsOf } from "./hill-shape";

/** Where a tree stands in plan, and the ground height there. */
export interface TreeSpot {
  x: number;
  z: number;
  y: number;
}

/**
 * How close (plan, mm) track may come to a tree's trunk before it steps aside: half the track, plus the widest crown
 * (a big ball tree's), plus a little air so trains pass clear of the leaves.
 */
export const TREE_CLEARANCE = TRACK_WIDTH / 2 + 24 + 8;
/** Trees that step aside keep this far (mm) from each other. */
const TREE_SPACING = 34;
/** How far (mm) a tree will step to get out of the way; further than that it's lifted off the mat. */
const RINGS = [52, 68, 84, 100, 120, 144];
const DIRECTIONS = 12;
/** Track is sampled this often (mm) along its paths. */
const STEP = 12;

const sample = createSample();

/** A piece about to go down (held over the mat): trees step aside for it as for placed track. */
export interface HeldPiece {
  type: PieceTypeId;
  flipped: boolean;
  pose: Pose;
  /** Height it would go down at (for a ramp's cutting). */
  y: number;
}

/**
 * Trees are scenery: track never has to go round them. Each tree that track (or a riser) passes over or close by
 * steps aside to the nearest clear spot on its own level — grass, clear of track and of other trees — or, with no
 * room nearby, is taken away. Pure: worked out afresh from the layout, so removing the track brings the trees back.
 *
 * Returns one entry per tree, in order: where it stands now, or null if it has been taken away.
 */
export function treesAside(grid: LandscapeGrid, layout: Layout, trees: readonly TreeSpot[], held?: HeldPiece): (TreeSpot | null)[] {
  const c = new TreeClearance(grid, trees);
  c.setLayout(layout);
  return c.spots(held);
}

/** `treesAside` for one map, keeping the placed track's sample points between calls (while a piece is held). */
export class TreeClearance {
  private track = new Map<number, number[]>();

  constructor(
    private readonly grid: LandscapeGrid,
    private readonly trees: readonly TreeSpot[],
  ) {}

  /** Call when the layout changes. */
  setLayout(layout: Layout): void {
    this.track = trackPoints(layout);
  }

  /** Where each tree stands, given the layout and (optionally) a piece held over the mat. */
  spots(held?: HeldPiece): (TreeSpot | null)[] {
    const { grid, trees, track } = this;
    const extra = new Map<number, number[]>();
    if (held) addPiece(extra, held.type, held.flipped, held.pose);
    if (track.size === 0 && extra.size === 0) return trees.map((t) => t);
    const blocked = (x: number, z: number) => nearTrack(track, x, z, TREE_CLEARANCE) || nearTrack(extra, x, z, TREE_CLEARANCE);
    const out: (TreeSpot | null)[] = trees.map((t) => (blocked(t.x, t.z) ? null : t));
    const crowded = (x: number, z: number) => out.some((o) => o !== null && Math.hypot(o.x - x, o.z - z) < TREE_SPACING);
    trees.forEach((t, i) => {
      if (out[i] !== null) return;
      // Step away from the nearest track if there's room that way, else round to either side: on the smallest ring
      // with a clear spot.
      const near = nearestTrack(extra, t.x, t.z) ?? nearestTrack(track, t.x, t.z);
      const away = near ? Math.atan2(t.z - near.z, t.x - near.x) : 0;
      for (const r of RINGS) {
        let best: TreeSpot | null = null;
        let bestTurn = Infinity;
        for (let k = 0; k < DIRECTIONS; k++) {
          const a = away + (k * 2 * Math.PI) / DIRECTIONS;
          const x = t.x + Math.cos(a) * r;
          const z = t.z + Math.sin(a) * r;
          if (!standable(grid, x, z, t.y) || blocked(x, z) || crowded(x, z)) continue;
          const turn = Math.min(k, DIRECTIONS - k);
          if (turn < bestTurn) {
            bestTurn = turn;
            best = { x, z, y: t.y };
          }
        }
        if (best) {
          out[i] = best;
          return;
        }
      }
    });
    return out;
  }
}

/** Plain grass with nothing on it (or other trees), at the tree's own ground height. */
function standable(grid: LandscapeGrid, x: number, z: number, y: number): boolean {
  const i = grid.cellAtWorld(x, z);
  if (i === -1) return false;
  return grid.surface[i] === SURF_GRASS && (grid.feature[i] === FEAT_NONE || grid.feature[i] === FEAT_TREE) && Math.abs(hillsOf(grid).groundAt(x, z) - y) < 1;
}

/** Track sample points bucketed by square-ish cells of this size (mm). */
const BUCKET = 64;

function trackPoints(layout: Layout): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  for (const id of layout.pieceIds()) {
    if (layout.isLifted(id)) continue;
    const p = layout.getPiece(id)!;
    addPiece(buckets, p.type, p.flipped, p.pose);
  }
  return buckets;
}

/** Add a piece's sample points (along its paths; a riser's centre) to buckets. */
function addPiece(buckets: Map<number, number[]>, type: PieceTypeId, flipped: boolean, pose: Pose): void {
  const add = (x: number, z: number) => {
    const key = bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(x, z);
  };
  const def = getPieceDef(type, flipped);
  if (def.paths.length === 0) {
    add(pose.x, pose.z);
    return;
  }
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  for (const path of def.paths) {
    const len = pathLength(path.geom);
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let k = 0; k <= n; k++) {
      samplePath(path.geom, (len * k) / n, sample);
      add(pose.x + sample.x * ch - sample.z * sh, pose.z + sample.x * sh + sample.z * ch);
    }
  }
}

const bucketKey = (bx: number, bz: number): number => (bx + 4096) * 8192 + (bz + 4096);

function nearestTrack(buckets: Map<number, number[]>, x: number, z: number): { x: number; z: number } | null {
  const bx = Math.floor(x / BUCKET);
  const bz = Math.floor(z / BUCKET);
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = buckets.get(bucketKey(bx + dx, bz + dz));
      if (!list) continue;
      for (let i = 0; i < list.length; i += 2) {
        const d = Math.hypot(list[i] - x, list[i + 1] - z);
        if (d < bestD) {
          bestD = d;
          best = { x: list[i], z: list[i + 1] };
        }
      }
    }
  }
  return best;
}

function nearTrack(buckets: Map<number, number[]>, x: number, z: number, reach: number): boolean {
  const bx = Math.floor(x / BUCKET);
  const bz = Math.floor(z / BUCKET);
  const span = Math.ceil(reach / BUCKET);
  for (let dx = -span; dx <= span; dx++) {
    for (let dz = -span; dz <= span; dz++) {
      const list = buckets.get(bucketKey(bx + dx, bz + dz));
      if (!list) continue;
      for (let i = 0; i < list.length; i += 2) if (Math.hypot(list[i] - x, list[i + 1] - z) < reach) return true;
    }
  }
  return false;
}
