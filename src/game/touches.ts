import { CELL, FEAT_BUILDING, FEAT_NONE, SURF_GRASS, SURF_ROAD, SURF_TOWN, type Landscape, type Town } from "../landscape";
import { TRACK_WIDTH } from "../track";

/**
 * Small touches of life (pure: where they go, and what they look like). The pictures are drawn by
 * `render/touches-view.ts`.
 *
 * - **Life in town:** a cat on a garden wall, washing on a line, someone reading on a bench, on the free ground at a
 *   town's edge, more of them as the town grows; and a child at the end of the platform who waves at a train going by.
 * - **A town's own colours:** its station's canopy, roof and bunting, from its name.
 * - **The first train's spot:** a little painted marker where the player's first train first ran (`Landscape.firstTrain`).
 *
 * Looks only: nothing here is in the way of anything. Growth builds where it likes (a touch on a square it takes moves
 * on), track laid over one's spot sends it elsewhere, and none of it is saved but the first train's spot.
 */

/** A town's station colours: the canopy, the station house's roof, and the bunting's flags (in turn). */
export interface StationTheme {
  readonly canopy: string;
  readonly roof: string;
  readonly bunting: readonly string[];
}

/** The toy box's paints, paired (the first is the station every town had before: red canopy, blue roof). */
export const STATION_THEMES: readonly StationTheme[] = [
  { canopy: "#c8442f", roof: "#2f6db5", bunting: ["#e6b52c", "#2f6db5", "#fbf6ec"] },
  { canopy: "#2f6db5", roof: "#c8442f", bunting: ["#c8442f", "#e6b52c", "#fbf6ec"] },
  { canopy: "#3c8f4e", roof: "#e6b52c", bunting: ["#e6b52c", "#c8442f", "#fbf6ec"] },
  { canopy: "#e6b52c", roof: "#3c8f4e", bunting: ["#3c8f4e", "#2f6db5", "#c8442f"] },
  { canopy: "#7a3b6e", roof: "#e6b52c", bunting: ["#e6b52c", "#fbf6ec", "#3c8f4e"] },
  { canopy: "#2a8c8c", roof: "#c8442f", bunting: ["#fbf6ec", "#c8442f", "#e6b52c"] },
];

/** A string's hash (FNV-1a): the same name always gives the same number, on any device. */
export function nameHash(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A town's station colours, from its name (saved with the map, so they never change). */
export function stationTheme(name: string): StationTheme {
  return STATION_THEMES[nameHash(name) % STATION_THEMES.length];
}

export type TouchKind = "cat" | "washing" | "bench";
export const TOUCH_KINDS: readonly TouchKind[] = ["cat", "washing", "bench"];

/** One touch of life: what, where (world mm, on the ground at `y`), and which way it runs (along the town's edge). */
export interface TouchSpot {
  readonly kind: TouchKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Its long side runs along this heading (radians, as a piece's); its front faces away from the town. */
  readonly heading: number;
  /** The square it stands on. */
  readonly cell: number;
  /** A number of its own, for its colours (a black cat or a ginger one). */
  readonly variant: number;
}

/** How many touches a town has at a level (0 = a hamlet): a few more each time it grows. */
export function touchesWanted(level: number): number {
  return Math.min(10, [1, 2, 4, 6][level] ?? 6 + (level - 3));
}

/**
 * A town's level as the picture counts it where there are no levels (Sandbox): by how many buildings it has, as a
 * Game mode town of about that size would be.
 */
export function levelBySize(town: Town): number {
  return Math.min(3, Math.floor(town.buildings.length / 5));
}

/** How near track (mm) a touch may stand: clear of a train going by. */
export const TOUCH_TRACK_CLEARANCE = 46;

const STEPS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/** A number from a square and the map's seed, for picking (the same every time). */
const pickOf = (seed: number, i: number) => Math.imul((i + 1) ^ Math.imul(seed, 0x27d4eb2d), 0x9e3779b1) >>> 0;

/**
 * Where a town's touches go: on plain grass squares next to it (its free lots, where it will grow), at the same
 * height, with no road or track there, on the half of the square toward the town. Each square's kind and its place in
 * line come from the square and the map's seed, so as the town grows, those it keeps stay put. `blocked`: is something
 * of the player's there (track within `TOUCH_TRACK_CLEARANCE`, a prop)?
 */
export function townTouches(land: Landscape, town: Town, level: number, blocked: (x: number, z: number) => boolean): TouchSpot[] {
  const g = land.grid;
  const corridors = new Set(land.corridors);
  const seen = new Set<number>();
  const spots: TouchSpot[] = [];
  for (const c of town.cells) {
    if (g.feature[c] !== FEAT_BUILDING && g.surface[c] !== SURF_ROAD && g.surface[c] !== SURF_TOWN) continue;
    const col = g.colOf(c);
    const row = g.rowOf(c);
    for (const [dc, dr] of STEPS) {
      if (!g.inBounds(col + dc, row + dr)) continue;
      const n = g.index(col + dc, row + dr);
      if (seen.has(n)) continue;
      if (g.surface[n] !== SURF_GRASS || g.feature[n] !== FEAT_NONE || g.road[n] !== 0 || g.height[n] !== g.height[c] || corridors.has(n)) continue;
      seen.add(n);
      // A little toward the town's side of the square (clear of the houses' backs), its length along their edge.
      const x = g.centreX(col + dc) - dc * CELL * 0.08;
      const z = g.centreZ(row + dr) - dr * CELL * 0.08;
      if (blocked(x, z)) continue;
      const pick = pickOf(land.seed, n);
      spots.push({ kind: TOUCH_KINDS[pick % TOUCH_KINDS.length], x, y: g.groundY(n), z, heading: Math.atan2(dc, -dr), cell: n, variant: pick >>> 8 });
    }
  }
  // In line by the square's own number: a town keeps its touches as it grows, but for one on a square it built on.
  spots.sort((a, b) => pickOf(land.seed ^ 0x5bd1e995, a.cell) - pickOf(land.seed ^ 0x5bd1e995, b.cell) || a.cell - b.cell);
  return spots.slice(0, touchesWanted(level));
}

/** A station's frame: `t` mm along its track from its socket end, `lateral` across (toward its platform +), `y` up. */
export function stationPoint(town: Town, t: number, lateral: number, y: number): { x: number; y: number; z: number } {
  const s = town.station;
  const dx = Math.cos(s.heading);
  const dz = Math.sin(s.heading);
  return { x: s.x + dx * t - dz * lateral, y, z: s.z + dz * t + dx * lateral };
}

/** The platform's top (mm up), where the child stands. */
export const PLATFORM_TOP = 14;

/**
 * Where a town's child stands: at the far end of the platform, past the canopy (seen from above), at its back (clear
 * of the conductor), facing the track. `heading` is the way the child faces.
 */
export function kidSpot(town: Town): { x: number; y: number; z: number; heading: number } {
  const p = stationPoint(town, 202, TRACK_WIDTH / 2 + 30, PLATFORM_TOP);
  return { ...p, heading: town.station.heading - Math.PI / 2 };
}

/** A train this near the child (mm, a car's middle) has the child wave; it waves again once none is this near. */
export const WAVE_NEAR = 130;
export const WAVE_REARM = 190;
/** How long a wave lasts (s). */
export const WAVE_SECONDS = 1.8;

/**
 * One child's wave: started when a train comes near (once per pass: not again until no train is near), lasting
 * `WAVE_SECONDS`. `update` with the nearest car's distance and the time gone; `arm` is how far the arm is raised
 * (0 down, 1 up), with a little to-and-fro while up.
 */
export class Wave {
  /** Seconds into the wave now (-1: not waving). */
  at = -1;
  private armed = true;

  update(nearest: number, dt: number): void {
    if (nearest > WAVE_REARM) this.armed = true;
    if (this.at >= 0) {
      this.at += dt;
      if (this.at >= WAVE_SECONDS) this.at = -1;
    }
    if (this.armed && nearest < WAVE_NEAR) {
      this.armed = false;
      if (this.at < 0) this.at = 0;
    }
  }

  get waving(): boolean {
    return this.at >= 0;
  }

  /** The arm's lift (0–1) and its swing (radians either way), now. */
  arm(): { lift: number; swing: number } {
    if (this.at < 0) return { lift: 0, swing: 0 };
    const up = Math.min(1, this.at / 0.25, (WAVE_SECONDS - this.at) / 0.3);
    return { lift: up, swing: up * 0.38 * Math.sin(this.at * 15) };
  }
}

/** The first train's marker: where it stands, beside the track where the train was (world mm), and its ground. */
export interface FirstTrainMark {
  x: number;
  z: number;
  heading: number;
}

/** How far (mm) from the track's middle the marker lies: just off the rails, on the ground beside them. */
export const MARK_ASIDE = TRACK_WIDTH / 2 + 12;

/**
 * The marker for a train standing at x, z, heading along `heading`: beside the track, on the side `fit` scores higher
 * (plain ground before a street, anything before a platform), its left on a tie.
 */
export function firstTrainMark(x: number, z: number, heading: number, fit: (x: number, z: number) => number = () => 0): FirstTrainMark {
  const left = { x: x + Math.sin(heading) * MARK_ASIDE, z: z - Math.cos(heading) * MARK_ASIDE, heading };
  const right = { x: x - Math.sin(heading) * MARK_ASIDE, z: z + Math.cos(heading) * MARK_ASIDE, heading };
  return fit(right.x, right.z) > fit(left.x, left.z) ? right : left;
}
