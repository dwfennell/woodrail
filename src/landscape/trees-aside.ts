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
/** Track sample points (and trees) are bucketed by square-ish cells of this size (mm). */
export const BUCKET = 64;

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
  /**
   * Where the trees stand with no piece held, kept until the layout or the land changes: first (`initial`) each
   * tree where it grew, or null if track is too close, then (`final`) where each such tree stepped to. A piece held
   * over the mat only changes trees near it, and trees near those it changed: the rest are as here.
   */
  private base: { revision: number; initial: (TreeSpot | null)[]; final: (TreeSpot | null)[] } | null = null;

  constructor(
    private readonly grid: LandscapeGrid,
    private readonly trees: readonly TreeSpot[],
  ) {}

  /** Call when the layout changes. */
  setLayout(layout: Layout): void {
    this.track = trackPoints(layout);
    this.base = null;
  }

  /**
   * Where each tree stands, given the layout and (optionally) a piece held over the mat. Called on every pointer move
   * while a piece is held: only the trees near it (and near trees that moved for it) are worked out again.
   */
  spots(held?: HeldPiece): (TreeSpot | null)[] {
    const { trees, track } = this;
    const extra = new Map<number, number[]>();
    if (held) addTrackPoints(extra, held.type, held.flipped, held.pose);
    if (track.size === 0 && extra.size === 0) return trees.map((t) => t);
    const base = this.baseSpots();
    if (extra.size === 0) return base.final.slice();
    // The held piece's reach: trees further than this from all of its track can't see it (its clearance, the
    // furthest a tree steps, and the buckets `nearestTrack` looks in).
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const list of extra.values()) {
      for (let i = 0; i < list.length; i += 2) {
        x0 = Math.min(x0, list[i]);
        x1 = Math.max(x1, list[i]);
        z0 = Math.min(z0, list[i + 1]);
        z1 = Math.max(z1, list[i + 1]);
      }
    }
    const reach = HELD_REACH;
    const nearHeld = (t: TreeSpot) => t.x > x0 - reach && t.x < x1 + reach && t.z > z0 - reach && t.z < z1 + reach;
    const blocked = (x: number, z: number) => nearTrack(track, x, z, TREE_CLEARANCE) || nearTrack(extra, x, z, TREE_CLEARANCE);
    const out = base.initial.slice();
    // Where trees stand (or stood, without the held piece) that differ from the base: trees near them may step
    // differently too (they mustn't crowd).
    const changed: number[] = [];
    trees.forEach((t, i) => {
      if (out[i] === null || !nearHeld(t) || !blocked(t.x, t.z)) return;
      out[i] = null;
      changed.push(t.x, t.z);
    });
    const index = new SpotIndex(out);
    const nearChange = (t: TreeSpot) => {
      for (let k = 0; k < changed.length; k += 2) if (Math.hypot(changed[k] - t.x, changed[k + 1] - t.z) < CHANGE_REACH) return true;
      return false;
    };
    trees.forEach((t, i) => {
      if (out[i] !== null) return;
      const was = base.final[i];
      const spot = base.initial[i] === null && !nearHeld(t) && !nearChange(t) ? was : this.stepAside(t, extra, blocked, index);
      out[i] = spot;
      index.set(i, null, spot);
      if (spot === was || (spot && was && spot.x === was.x && spot.z === was.z)) return;
      if (was) changed.push(was.x, was.z);
      if (spot) changed.push(spot.x, spot.z);
    });
    return out;
  }

  /** The trees with no piece held (see `base`). */
  private baseSpots(): { initial: (TreeSpot | null)[]; final: (TreeSpot | null)[] } {
    if (this.base?.revision === this.grid.revision) return this.base;
    const { trees, track } = this;
    const none = new Map<number, number[]>();
    const blocked = (x: number, z: number) => nearTrack(track, x, z, TREE_CLEARANCE);
    const initial = trees.map((t) => (blocked(t.x, t.z) ? null : t));
    const final = initial.slice();
    const index = new SpotIndex(final);
    trees.forEach((t, i) => {
      if (final[i] !== null) return;
      final[i] = this.stepAside(t, none, blocked, index);
      index.set(i, null, final[i]);
    });
    this.base = { revision: this.grid.revision, initial, final };
    return this.base;
  }

  /**
   * Where a tree too close to track steps to: away from the nearest track if there's room that way, else round to
   * either side, on the smallest ring with a clear spot (grass, clear of track and of the other trees as they stand
   * now). Null if there's none.
   */
  private stepAside(t: TreeSpot, extra: Map<number, number[]>, blocked: (x: number, z: number) => boolean, index: SpotIndex): TreeSpot | null {
    const near = nearestTrack(extra, t.x, t.z) ?? nearestTrack(this.track, t.x, t.z);
    const away = near ? Math.atan2(t.z - near.z, t.x - near.x) : 0;
    for (const r of RINGS) {
      let best: TreeSpot | null = null;
      let bestTurn = Infinity;
      for (let k = 0; k < DIRECTIONS; k++) {
        const a = away + (k * 2 * Math.PI) / DIRECTIONS;
        const x = t.x + Math.cos(a) * r;
        const z = t.z + Math.sin(a) * r;
        if (!standable(this.grid, x, z, t.y) || blocked(x, z) || index.crowded(x, z)) continue;
        const turn = Math.min(k, DIRECTIONS - k);
        if (turn < bestTurn) {
          bestTurn = turn;
          best = { x, z, y: t.y };
        }
      }
      if (best) return best;
    }
    return null;
  }
}

/** Trees further than this (mm, each way) from a held piece's track neither step for it nor choose otherwise. */
const HELD_REACH = Math.max(RINGS[RINGS.length - 1] + TREE_CLEARANCE, 3 * BUCKET) + 1;
/** A tree this near (mm) a spot a tree left or took may step differently (the furthest step, and the spacing). */
const CHANGE_REACH = RINGS[RINGS.length - 1] + TREE_SPACING + 1;

/** Where trees stand, bucketed for "is a tree too near here?" (`TREE_SPACING` is under a bucket). */
class SpotIndex {
  private readonly buckets = new Map<number, number[]>();

  constructor(private readonly spots: (TreeSpot | null)[]) {
    spots.forEach((s, i) => s && this.add(i, s));
  }

  /** Tree `i` moved from `from` (its spot as indexed, null: none) to `to`. */
  set(i: number, from: TreeSpot | null, to: TreeSpot | null): void {
    if (from) {
      const list = this.buckets.get(this.key(from.x, from.z));
      const k = list ? list.indexOf(i) : -1;
      if (k !== -1) list!.splice(k, 1);
    }
    this.spots[i] = to;
    if (to) this.add(i, to);
  }

  crowded(x: number, z: number): boolean {
    const bx = Math.floor(x / BUCKET);
    const bz = Math.floor(z / BUCKET);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.buckets.get(bucketKey(bx + dx, bz + dz));
        if (!list) continue;
        for (const i of list) {
          const o = this.spots[i]!;
          if (Math.hypot(o.x - x, o.z - z) < TREE_SPACING) return true;
        }
      }
    }
    return false;
  }

  private add(i: number, s: TreeSpot): void {
    const key = this.key(s.x, s.z);
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    list.push(i);
  }

  private key(x: number, z: number): number {
    return bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
  }
}

/** Plain grass with nothing on it (or other trees), at the tree's own ground height. */
function standable(grid: LandscapeGrid, x: number, z: number, y: number): boolean {
  const i = grid.cellAtWorld(x, z);
  if (i === -1) return false;
  return grid.surface[i] === SURF_GRASS && (grid.feature[i] === FEAT_NONE || grid.feature[i] === FEAT_TREE) && Math.abs(hillsOf(grid).groundAt(x, z) - y) < 1;
}


/** Points along all the track (every few mm), bucketed by `BUCKET` squares (see `bucketKey`): x, z pairs. */
export function trackPoints(layout: Layout): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  for (const id of layout.pieceIds()) {
    if (layout.isLifted(id)) continue;
    const p = layout.getPiece(id)!;
    addTrackPoints(buckets, p.type, p.flipped, p.pose);
  }
  return buckets;
}

/** Add a piece's sample points (along its paths; a riser's centre) to buckets. */
export function addTrackPoints(buckets: Map<number, number[]>, type: PieceTypeId, flipped: boolean, pose: Pose): void {
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

export const bucketKey = (bx: number, bz: number): number => (bx + 4096) * 8192 + (bz + 4096);

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
