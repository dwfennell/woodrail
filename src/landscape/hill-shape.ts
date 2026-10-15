import { getPieceDef, pathLength, RISER_HEIGHT, TRACK_WIDTH, type PathGeom, type PieceTypeId, type Pose } from "../track";
import { CELL, isWater, MAX_HEIGHT, type LandscapeGrid } from "./grid";

/** Half the width of a cutting's bed (mm): the track, and a little room each side. */
export const CUT_BED_HALF = TRACK_WIDTH / 2 + 4;
/** A cutting's banks rise at this angle from the horizontal. */
export const CUT_BANK_ANGLE = (60 * Math.PI) / 180;
const BANK_RISE = Math.tan(CUT_BANK_ANGLE);
/** How far beyond its bed a cutting can reach (its banks, through the tallest hill). */
const CUT_REACH = CUT_BED_HALF + (MAX_HEIGHT * RISER_HEIGHT) / BANK_RISE + 1;

/** Can this piece cut its way into a hill? Plain ramps can (not ramps standing up on arches). */
export const cutsHills = (type: PieceTypeId): boolean => type === "ramp";

/** A ramp let into the hills: the ground is cut down to its bed, with banks rising either side and round its ends. */
export interface HillCut {
  /** The ramp's pose and base height (its low end). */
  pose: Pose;
  y: number;
  type: PieceTypeId;
  flipped: boolean;
}

/** A cut, ready for quick lookups: its path, and its reach in plan. */
interface PreparedCut {
  cut: HillCut;
  geom: PathGeom;
  length: number;
  cos: number;
  sin: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function prepare(cut: HillCut): PreparedCut {
  const geom = getPieceDef(cut.type, cut.flipped).paths[0].geom;
  const length = pathLength(geom);
  const cos = Math.cos(cut.pose.heading);
  const sin = Math.sin(cut.pose.heading);
  const ends = [0, length].map((s) => ({ x: cut.pose.x + s * cos, z: cut.pose.z + s * sin }));
  return {
    cut,
    geom,
    length,
    cos,
    sin,
    x0: Math.min(ends[0].x, ends[1].x) - CUT_REACH,
    z0: Math.min(ends[0].z, ends[1].z) - CUT_REACH,
    x1: Math.max(ends[0].x, ends[1].x) + CUT_REACH,
    z1: Math.max(ends[0].z, ends[1].z) + CUT_REACH,
  };
}

/**
 * Height of a cutting's surface at a plan point: its bed (the ramp's underside, easing up as the ramp does), and
 * beyond the bed's edges and ends, banks rising at `CUT_BANK_ANGLE`. Infinity outside its reach.
 */
function cutSurface(c: PreparedCut, x: number, z: number): number {
  if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return Infinity;
  // Ramps are straight: along and across the ramp, from its low end.
  const dx = x - c.cut.pose.x;
  const dz = z - c.cut.pose.z;
  const along = dx * c.cos + dz * c.sin;
  const across = -dx * c.sin + dz * c.cos;
  const s = along < 0 ? 0 : along > c.length ? c.length : along;
  const t = c.length > 0 ? s / c.length : 0;
  const bed = c.cut.y + c.geom.y0 + c.geom.rise * t * t * (3 - 2 * t);
  const out = Math.hypot(Math.max(0, Math.abs(across) - CUT_BED_HALF), along - s);
  return bed + out * BANK_RISE;
}

/**
 * Hill blocks have their outer corners rounded off where a hill's edge turns beside a river, so the hill follows the
 * felt river's curve. The rounding's radius (mm).
 */
export const CORNER_RADIUS = CELL / 2;

/** A block's corners by direction (+x = next column, +z = next row), and their bits in a corner mask. */
export const CORNERS = [
  { sx: 1, sz: 1, bit: 1 },
  { sx: 1, sz: -1, bit: 2 },
  { sx: -1, sz: 1, bit: 4 },
  { sx: -1, sz: -1, bit: 8 },
] as const;

/**
 * The one description of the hills: which blocks there are, and how high the ground is at any point. Everything that
 * cares about hill shape (placement, supports, bridges' arches, trees, and in time rendering, shadows and physics)
 * asks here rather than reading block heights off the grid, so they can never disagree.
 *
 * See `docs/superpowers/specs/2026-10-12-hill-shapes-design.md`.
 */
export class HillShape {
  private cuts: PreparedCut[] = [];

  constructor(readonly grid: LandscapeGrid) {}

  /** The ramps cut into the hills (from the layout: call when it changes). */
  setCuts(cuts: readonly HillCut[]): void {
    this.cuts = cuts.map(prepare);
  }

  /** Height of the ground at a plan point: the hill there (minding rounded corners and cuttings), or the felt (0). */
  groundAt(x: number, z: number): number {
    return this.groundWith(this.cuts, x, z);
  }

  /**
   * Ground height as it would be with one more cutting (a ramp being placed): for checking what it would do to the
   * ground under other track.
   */
  groundWithCut(extra: HillCut, x: number, z: number): number {
    return this.groundWith([...this.cuts, prepare(extra)], x, z);
  }

  /** Lowest cutting surface at a plan point (Infinity where no cutting reaches), from these cuts and an extra one. */
  cutSurfaceAt(x: number, z: number, extra?: HillCut): number {
    let surface = Infinity;
    for (const c of this.cuts) surface = Math.min(surface, cutSurface(c, x, z));
    if (extra) surface = Math.min(surface, cutSurface(prepare(extra), x, z));
    return surface;
  }

  /**
   * The blocks the cuttings (and an extra one) cut into: those whose top a cutting surface dips below anywhere inside
   * the block's outline. With a key per block of what cuts it, so a renderer can tell which changed.
   */
  cutBlocks(extra?: HillCut): { col: number; row: number; level: number; key: string }[] {
    const all = extra ? [...this.cuts, prepare(extra)] : this.cuts;
    const found = new Map<string, { col: number; row: number; level: number; key: string }>();
    const g = this.grid;
    all.forEach((c) => {
      const c0 = Math.floor(c.x0 / CELL);
      const c1 = Math.floor(c.x1 / CELL);
      const r0 = Math.floor(c.z0 / CELL);
      const r1 = Math.floor(c.z1 / CELL);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const i = g.index(col, row);
          if (i === -1) continue;
          const h = g.height[i];
          for (let level = 0; level < h; level++) {
            const corners = this.blockCorners(col, row, level);
            const top = (level + 1) * RISER_HEIGHT;
            // Sample the block's top: does this cutting dip below it anywhere inside the outline?
            let cuts = false;
            for (let i = 0; i <= 12 && !cuts; i++) {
              for (let j = 0; j <= 12 && !cuts; j++) {
                const ox = -CELL / 2 + (CELL * i) / 12;
                const oz = -CELL / 2 + (CELL * j) / 12;
                if (!insideBlock(corners, ox, oz)) continue;
                if (cutSurface(c, g.centreX(col) + ox, g.centreZ(row) + oz) < top - 0.3) cuts = true;
              }
            }
            if (!cuts) continue;
            const id = `${col},${row},${level}`;
            const sig = `${c.cut.pose.x.toFixed(2)},${c.cut.pose.z.toFixed(2)},${c.cut.pose.heading.toFixed(4)},${c.cut.y},${c.cut.type},${c.cut.flipped}`;
            const prev = found.get(id);
            found.set(id, { col, row, level, key: prev ? `${prev.key};${sig}` : sig });
          }
        }
      }
    });
    return [...found.values()];
  }

  /** Height of the hill's blocks alone at a plan point, before any cutting (rounded corners only). */
  blocksAt(x: number, z: number): number {
    const i = this.grid.cellAtWorld(x, z);
    if (i === -1) return 0;
    const col = Math.floor(x / CELL);
    const row = Math.floor(z / CELL);
    const ox = x - this.grid.centreX(col);
    const oz = z - this.grid.centreZ(row);
    for (let level = this.grid.height[i] - 1; level >= 0; level--) {
      if (insideBlock(this.blockCorners(col, row, level), ox, oz)) return (level + 1) * RISER_HEIGHT;
    }
    return 0;
  }

  private groundWith(cuts: readonly PreparedCut[], x: number, z: number): number {
    let ground = this.blocksAt(x, z);
    if (ground === 0) return 0;
    for (const c of cuts) ground = Math.min(ground, cutSurface(c, x, z));
    return Math.max(0, ground);
  }

  /** Is there a block at this level (0 = on the felt) in this square? */
  hasBlock(col: number, row: number, level: number): boolean {
    const i = this.grid.index(col, row);
    return i !== -1 && this.grid.height[i] > level;
  }

  /**
   * Which corners of the block at `level` in this square are rounded off (a mask of `CORNERS` bits): those where the
   * hill's edge turns outward — the squares beside the corner and the one across it have no block at this level —
   * beside a river, so the hill follows the river's curve. Off the land counts as solid, so the land's own edge stays
   * square (and a block's corners can change only when its own plot or one beside it does). 0 if there's no block.
   */
  blockCorners(col: number, row: number, level: number): number {
    if (!this.hasBlock(col, row, level)) return 0;
    const g = this.grid;
    const solid = (c: number, r: number) => {
      const i = g.index(c, r);
      return i === -1 || g.height[i] > level;
    };
    const river = (c: number, r: number) => {
      const i = g.index(c, r);
      return i !== -1 && isWater(g.surface[i]);
    };
    let mask = 0;
    for (const { sx, sz, bit } of CORNERS) {
      const open = !solid(col + sx, row) && !solid(col, row + sz) && !solid(col + sx, row + sz);
      // Only where a (curving) river runs past the corner: elsewhere hills stay square-cornered blocks.
      if (open && (river(col + sx, row) || river(col, row + sz) || river(col + sx, row + sz))) mask |= bit;
    }
    return mask;
  }
}

const shapes = new WeakMap<LandscapeGrid, HillShape>();

/** The hill shape of a map (one per grid, made on first use). */
export function hillsOf(grid: LandscapeGrid): HillShape {
  let h = shapes.get(grid);
  if (!h) shapes.set(grid, (h = new HillShape(grid)));
  return h;
}

/** Is a point (offsets from a square's centre) inside a block with these corners rounded off? */
export function insideBlock(corners: number, ox: number, oz: number): boolean {
  if (corners === 0) return true;
  const half = CELL / 2;
  for (const { sx, sz, bit } of CORNERS) {
    if (!(corners & bit)) continue;
    // In the corner's square of the rounding and outside its quarter circle: cut away.
    const cx = sx * (half - CORNER_RADIUS);
    const cz = sz * (half - CORNER_RADIUS);
    if ((ox - cx) * sx > 0 && (oz - cz) * sz > 0 && Math.hypot(ox - cx, oz - cz) > CORNER_RADIUS) return false;
  }
  return true;
}

/**
 * A block's plan outline (offsets from its square's centre, anticlockwise from above in x/z), its rounded corners
 * as arcs of `steps` segments. `inset` shrinks it (for the gap between blocks, or a core inside them).
 */
export function blockOutline(corners: number, inset = 0, steps = 6): { x: number; z: number }[] {
  const half = CELL / 2 - inset;
  const round = CORNER_RADIUS - inset;
  const out: { x: number; z: number }[] = [];
  // Corners in turn round the square: (+,+), (−,+), (−,−), (+,−).
  const order = [CORNERS[0], CORNERS[2], CORNERS[3], CORNERS[1]];
  const startAngle = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  order.forEach(({ sx, sz, bit }, k) => {
    if (!(corners & bit) || round <= 0) {
      out.push({ x: sx * half, z: sz * half });
      return;
    }
    const cx = sx * (half - round);
    const cz = sz * (half - round);
    for (let j = 0; j <= steps; j++) {
      const a = startAngle[k] + (j / steps) * (Math.PI / 2);
      out.push({ x: cx + Math.cos(a) * round, z: cz + Math.sin(a) * round });
    }
  });
  return out;
}
