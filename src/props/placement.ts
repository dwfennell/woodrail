import { addTrackPoints, BUCKET, bucketKey, crossingStyleOf, FEAT_BUILDING, FEAT_DEPOT, FEAT_SHED, FEAT_STATION, hillsOf, isWater, trackPoints, type Landscape } from "../landscape";
import { TRACK_WIDTH, type Layout, type PieceTypeId, type Pose } from "../track";
import type { PlaceOn } from "./kinds";
import type { PropStore } from "./store";

/** A model's ground footprint: a rectangle in its own frame (x forward), centred at (cx, cz), half sizes hw × hd. */
export interface Footprint {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
}

/** Why a prop can't stand somewhere. */
export type PropBlock = "off-land" | "river" | "dry" | "building" | "station" | "depot" | "track" | "prop" | "uneven" | "yard" | "no-crossing" | "town";

export const PROP_MESSAGES: Record<PropBlock, string> = {
  "off-land": "That's past the edge of your land",
  river: "That would sink in the river",
  dry: "Boats go on the river",
  building: "There's a house there",
  station: "The station is in the way",
  depot: "The depot is in the way",
  track: "That's on the track",
  prop: "Something's already there",
  uneven: "Needs level ground — not over a hill's edge",
  yard: "That's a depot's yard",
  "no-crossing": "Drop it where the track crosses a road",
  // (A town's house in Game mode is told why by town-moves.ts: this is only its outline's red.)
  town: "A house goes on one of its town's lots",
};

/**
 * A crossing prop (the level crossing, the gated crossing: `crossingStyleOf`) stands on a crossing's track and road,
 * as its style: it neither blocks anything nor is blocked (see `styleCrossings`).
 */
export const standsAside = (asset: string): boolean => crossingStyleOf(asset) !== undefined;

export type PropClearance = { readonly kind: "clear"; readonly y: number } | { readonly kind: "blocked"; readonly reason: PropBlock };

const NO_SQUARES: ReadonlySet<number> = new Set();

/** Sample spacing over a footprint (mm): under half a track's width, so no rail slips between samples. */
const STEP = 16;
/** Ground heights closer than this (mm) count as level. */
const LEVEL = 1;

/** A footprint at a prop's own scale (`Prop.scale`: a landmark drawn smaller on a smaller lot), or as it is. */
export function scaleFootprint(fp: Footprint, scale: number | undefined): Footprint;
export function scaleFootprint(fp: Footprint | undefined, scale: number | undefined): Footprint | undefined;
export function scaleFootprint(fp: Footprint | undefined, scale: number | undefined): Footprint | undefined {
  if (!fp || !scale || scale === 1) return fp;
  return { cx: fp.cx * scale, cz: fp.cz * scale, hw: fp.hw * scale, hd: fp.hd * scale };
}

/** The footprint's corners in world space (x, z pairs), for a prop at `pose`. */
export function footprintCorners(fp: Footprint, pose: Pick<Pose, "x" | "z" | "heading">): number[] {
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const out: number[] = [];
  for (const [lx, lz] of [
    [fp.cx - fp.hw, fp.cz - fp.hd],
    [fp.cx + fp.hw, fp.cz - fp.hd],
    [fp.cx + fp.hw, fp.cz + fp.hd],
    [fp.cx - fp.hw, fp.cz + fp.hd],
  ]) out.push(pose.x + lx * c - lz * s, pose.z + lx * s + lz * c);
  return out;
}

/** Points covering the footprint, edges included (x, z pairs, world space). */
function samples(fp: Footprint, pose: Pick<Pose, "x" | "z" | "heading">): number[] {
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const nx = Math.max(1, Math.ceil((2 * fp.hw) / STEP));
  const nz = Math.max(1, Math.ceil((2 * fp.hd) / STEP));
  const out: number[] = [];
  for (let i = 0; i <= nx; i++) {
    const lx = fp.cx - fp.hw + (2 * fp.hw * i) / nx;
    for (let k = 0; k <= nz; k++) {
      const lz = fp.cz - fp.hd + (2 * fp.hd * k) / nz;
      out.push(pose.x + lx * c - lz * s, pose.z + lx * s + lz * c);
    }
  }
  return out;
}

/** Is world point (x, z) within `margin` of the footprint placed at `pose`? */
export function inFootprint(fp: Footprint, pose: Pick<Pose, "x" | "z" | "heading">, x: number, z: number, margin = 0): boolean {
  const dx = x - pose.x;
  const dz = z - pose.z;
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const lx = dx * c + dz * s - fp.cx;
  const lz = -dx * s + dz * c - fp.cz;
  return Math.abs(lx) <= fp.hw + margin && Math.abs(lz) <= fp.hd + margin;
}

/** Do two placed footprints overlap? (Separating axes of two rectangles.) */
export function footprintsOverlap(a: Footprint, pa: Pick<Pose, "x" | "z" | "heading">, b: Footprint, pb: Pick<Pose, "x" | "z" | "heading">): boolean {
  const ca = footprintCorners(a, pa);
  const cb = footprintCorners(b, pb);
  for (const h of [pa.heading, pb.heading]) {
    for (const [ax, az] of [
      [Math.cos(h), Math.sin(h)],
      [-Math.sin(h), Math.cos(h)],
    ]) {
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (let i = 0; i < 8; i += 2) {
        const pA = ca[i] * ax + ca[i + 1] * az;
        const pB = cb[i] * ax + cb[i + 1] * az;
        minA = Math.min(minA, pA);
        maxA = Math.max(maxA, pA);
        minB = Math.min(minB, pB);
        maxB = Math.max(maxB, pB);
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

/** Track sample points of a layout, for prop checks while dragging (build one per drag: the track doesn't change). */
export class TrackIndex {
  private readonly buckets: Map<number, number[]>;

  constructor(layout: Layout) {
    this.buckets = trackPoints(layout);
  }

  /** Does any track come within a rail's half width of the footprint? */
  hits(fp: Footprint, pose: Pick<Pose, "x" | "z" | "heading">): boolean {
    const margin = TRACK_WIDTH / 2;
    const reach = Math.hypot(Math.abs(fp.cx) + fp.hw, Math.abs(fp.cz) + fp.hd) + margin;
    const x0 = Math.floor((pose.x - reach) / BUCKET);
    const x1 = Math.floor((pose.x + reach) / BUCKET);
    const z0 = Math.floor((pose.z - reach) / BUCKET);
    const z1 = Math.floor((pose.z + reach) / BUCKET);
    for (let bx = x0; bx <= x1; bx++) {
      for (let bz = z0; bz <= z1; bz++) {
        const list = this.buckets.get(bucketKey(bx, bz));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 2) if (inFootprint(fp, pose, list[i], list[i + 1], margin)) return true;
      }
    }
    return false;
  }
}

export interface PropCheck {
  land: Landscape;
  track: TrackIndex;
  props: PropStore;
  /** Footprints of models built so far (a prop whose model isn't built yet doesn't block). */
  footprint(asset: string): Footprint | undefined;
}

/**
 * Can a prop with footprint `fp` stand at `pose`? On owned land, level, clear of buildings, stations, depots, track
 * and other props. Boats (`on` water) float with their middle on the river; bridges (`any`) may span it; nothing else
 * may touch it. Gives the height it stands at.
 */
export function checkProp(ctx: PropCheck, fp: Footprint, pose: Pick<Pose, "x" | "z" | "heading">, on: PlaceOn, ignoreId = -1, ownSquares: ReadonlySet<number> = NO_SQUARES): PropClearance {
  const water = on === "water";
  const grid = ctx.land.grid;
  const hills = hillsOf(grid);
  const pts = samples(fp, pose);
  let y = NaN;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const z = pts[i + 1];
    const cell = grid.cellAtWorld(x, z);
    if (cell === -1) return { kind: "blocked", reason: "off-land" };
    const f = grid.feature[cell];
    // A town building's own squares are free to it (it can shift about on them).
    if ((f === FEAT_BUILDING && !ownSquares.has(cell)) || f === FEAT_SHED) return { kind: "blocked", reason: "building" };
    if (f === FEAT_STATION) return { kind: "blocked", reason: "station" };
    if (f === FEAT_DEPOT) return { kind: "blocked", reason: "depot" };
    const river = isWater(grid.surface[cell]);
    if (river && on === "land") return { kind: "blocked", reason: "river" };
    const g = hills.groundAt(x, z);
    if (Number.isNaN(y)) y = g;
    else if (Math.abs(g - y) > LEVEL) return { kind: "blocked", reason: "uneven" };
  }
  // A boat floats with its middle on the river (rivers are a square wide: a hull may overhang the bank).
  if (water) {
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    const mid = grid.cellAtWorld(pose.x + fp.cx * c - fp.cz * s, pose.z + fp.cx * s + fp.cz * c);
    if (mid === -1 || !isWater(grid.surface[mid])) return { kind: "blocked", reason: "dry" };
  }
  if (ctx.track.hits(fp, pose)) return { kind: "blocked", reason: "track" };
  for (const other of ctx.props.all()) {
    if (other.id === ignoreId || standsAside(other.asset)) continue;
    const ofp = scaleFootprint(ctx.footprint(other.asset), other.scale);
    if (ofp && footprintsOverlap(fp, pose, ofp, other)) return { kind: "blocked", reason: "prop" };
  }
  return { kind: "clear", y: Number.isNaN(y) ? 0 : y };
}

/** Would a track piece at `pose` run through a prop? (Track is refused through props; they don't step aside yet.) */
export function pieceHitsProp(props: PropStore, footprint: (asset: string) => Footprint | undefined, type: PieceTypeId, flipped: boolean, pose: Pose): boolean {
  if (props.size === 0) return false;
  const buckets = new Map<number, number[]>();
  addTrackPoints(buckets, type, flipped, pose);
  const margin = TRACK_WIDTH / 2;
  for (const prop of props.all()) {
    const fp = standsAside(prop.asset) ? undefined : scaleFootprint(footprint(prop.asset), prop.scale);
    if (!fp) continue;
    for (const list of buckets.values()) for (let i = 0; i < list.length; i += 2) if (inFootprint(fp, prop, list[i], list[i + 1], margin)) return true;
  }
  return false;
}

/** Does any prop's footprint reach into the world rectangle (x0, z0)–(x1, z1)? (Bounding boxes of the footprints.) */
export function propsInRect(props: PropStore, footprint: (asset: string) => Footprint | undefined, x0: number, z0: number, x1: number, z1: number): boolean {
  for (const p of props.all()) {
    const fp = standsAside(p.asset) ? undefined : scaleFootprint(footprint(p.asset), p.scale);
    if (!fp) continue;
    const c = footprintCorners(fp, p);
    const minX = Math.min(c[0], c[2], c[4], c[6]);
    const maxX = Math.max(c[0], c[2], c[4], c[6]);
    const minZ = Math.min(c[1], c[3], c[5], c[7]);
    const maxZ = Math.max(c[1], c[3], c[5], c[7]);
    if (maxX > x0 && minX < x1 && maxZ > z0 && minZ < z1) return true;
  }
  return false;
}
