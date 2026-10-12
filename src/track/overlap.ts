import { ARCH_CENTRES, ARCH_CROWN_DROP, ARCH_RADIUS, RISER_HEIGHT, TRACK_THICKNESS, TRACK_WIDTH } from "./constants";
import type { Layout, PlacedPiece } from "./layout";
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

/**
 * Where a piece's viaduct would stand if it has arches (piece-local): along its track, how high the solid part comes
 * up from the ground (the arch's ceiling under the openings, else nothing: solid from the ground) to the deck.
 */
interface ArchDisc {
  x: number;
  z: number;
  /** Deck height (bottom of the track) here, above the piece's base. */
  deck: number;
  /** Under an arch opening, the arch's ceiling above the piece's base (open below it); −∞ under a pier or wall. */
  ceiling: number;
}

const RADIUS = TRACK_WIDTH / 2 - 6;
/** Far enough in that a piece pushed 9 mm into its neighbour (the joint's play) still clears it. */
const END_INSET = 20;
const STEP = 14;
/** Viaducts are sampled this often (mm): their piers are narrow. */
const WALL_STEP = 3;
/** Bands that overlap by less than this still count as clear (pieces resting on a riser touch it). */
const SLACK = 2;

const cache = new Map<string, { discs: Disc[]; arches: ArchDisc[]; reach: number }>();

function footprint(type: PieceTypeId, flipped: boolean): { discs: Disc[]; arches: ArchDisc[]; reach: number } {
  const key = `${type}:${flipped ? 1 : 0}`;
  let f = cache.get(key);
  if (f) return f;
  const def = getPieceDef(type, flipped);
  const discs: Disc[] = [];
  const arches: ArchDisc[] = [];
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
    // The viaduct, finely enough to catch its narrow piers: under an arch opening, the round top of the arch (open
    // from the ground up to it); elsewhere, solid wall.
    const r = len * ARCH_RADIUS;
    const m = Math.max(1, Math.ceil(span / WALL_STEP));
    for (let k = 0; k <= m; k++) {
      const at = END_INSET + (span * k) / m;
      samplePath(path.geom, at, s);
      let ceiling = -Infinity;
      for (const c of ARCH_CENTRES) {
        const ds = Math.abs(at - c * len);
        if (ds < r) ceiling = s.y - ARCH_CROWN_DROP - r + Math.sqrt(r * r - ds * ds);
      }
      arches.push({ x: s.x, z: s.z, deck: s.y, ceiling });
    }
  }
  let reach = 0;
  for (const d of discs) reach = Math.max(reach, Math.hypot(d.x, d.z) + RADIUS);
  f = { discs, arches, reach };
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

/** How far down (mm) each arched piece's viaduct reaches below its base (0 for pieces without arches). */
export interface ArchReach {
  /** The piece being placed, where it's going. */
  mine: number;
  /** A piece already on the layout. */
  of(piece: PlacedPiece): number;
}

// World-space viaduct bands of the piece being tested (reused between calls).
const myWall: Disc[] = [];

/** World-space solid bands of a viaduct reaching `down` below its base at `y`. */
function wallToWorld(arches: readonly ArchDisc[], pose: Pose, y: number, down: number, out: Disc[]): void {
  const c = Math.cos(pose.heading);
  const sn = Math.sin(pose.heading);
  out.length = 0;
  if (down <= 0) return;
  for (const a of arches) {
    const ground = y - down;
    out.push({ x: pose.x + a.x * c - a.z * sn, z: pose.z + a.x * sn + a.z * c, y0: Math.max(ground, y + a.ceiling), y1: y + a.deck });
  }
}

// One piece's bands at a time while testing (reused).
const theirDeck: Disc[] = [];
const theirWall: Disc[] = [];

function anyTouch(a: readonly Disc[], b: readonly Disc[], limit: number): boolean {
  for (const p of a) {
    for (const q of b) {
      const dx = p.x - q.x;
      const dz = p.z - q.z;
      if (dx * dx + dz * dz < limit && p.y0 < q.y1 - SLACK && q.y0 < p.y1 - SLACK) return true;
    }
  }
  return false;
}

/**
 * Would a piece at this pose collide with a piece already on the layout? Returns the first piece in the way, or −1.
 * `ignoreId` skips the piece being moved. With `arches`, the viaduct under a bridge (or raised ramp) is solid from
 * the ground to its deck, except under its arch openings: other track can't run through it, and it can't stand on
 * track. Called on every pointer move while dragging.
 */
export function findOverlap(layout: Layout, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: number, arches?: ArchReach): number {
  const mine = footprint(type, flipped);
  toWorld(mine.discs, pose, y, placed);
  wallToWorld(mine.arches, pose, y, arches?.mine ?? 0, myWall);
  const limit = (2 * RADIUS) ** 2;
  const isRiser = getPieceDef(type, flipped).paths.length === 0;
  for (const id of layout.pieceIds()) {
    if (id === ignoreId || layout.isLifted(id)) continue;
    const other = layout.getPiece(id)!;
    const theirs = footprint(other.type, other.flipped);
    // Broad phase: footprint circles.
    if (Math.hypot(other.pose.x - pose.x, other.pose.z - pose.z) > mine.reach + theirs.reach) continue;
    toWorld(theirs.discs, other.pose, other.y, theirDeck);
    if (anyTouch(placed, theirDeck, limit)) return id;
    // Viaducts against track (risers, which stand by bridge ends, are left out).
    const otherIsRiser = getPieceDef(other.type, other.flipped).paths.length === 0;
    if (!otherIsRiser && myWall.length > 0 && anyTouch(myWall, theirDeck, limit)) return id;
    if (!isRiser && arches) {
      wallToWorld(theirs.arches, other.pose, other.y, arches.of(other), theirWall);
      if (theirWall.length > 0 && anyTouch(placed, theirWall, limit)) return id;
    }
  }
  return -1;
}
