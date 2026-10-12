import {
  ADAPTER_LENGTH,
  BRIDGE_LENGTH,
  BUFFER_LENGTH,
  CROSSING_SIZE,
  CURVE_SWEEP,
  LARGE_CURVE_RADIUS,
  RAMP_LENGTH,
  RISER_HEIGHT,
  SMALL_CURVE_RADIUS,
  SWITCH_LENGTH,
} from "./constants";
import { normalizeAngle, type Pose } from "./math";
import type { PathGeom } from "./path";

export type ConnectorKind = "peg" | "socket";

/** pose.heading points outward from the piece. */
export interface ConnectorDef {
  readonly kind: ConnectorKind;
  readonly pose: Pose;
  readonly y: number;
}

/** to === null means the path ends at a buffer inside the piece. */
export interface PathDef {
  readonly from: number;
  readonly to: number | null;
  readonly geom: PathGeom;
}

export type PieceTypeId =
  | "straight-54"
  | "straight-108"
  | "straight-144"
  | "straight-216"
  | "curve-large"
  | "curve-small"
  | "switch"
  | "crossing"
  | "ramp"
  | "riser"
  | "bridge"
  | "bridge-curve"
  | "buffer"
  | "buffer-turnback"
  | "adapter-peg"
  | "adapter-socket"
  | "station"
  | "depot-forest"
  | "depot-sawmill";

export interface PieceDef {
  readonly type: PieceTypeId;
  readonly connectors: readonly ConnectorDef[];
  readonly paths: readonly PathDef[];
  readonly flippable: boolean;
  readonly isSwitch: boolean;
  /** Height this piece provides to pieces resting on top of it (risers). 0 for track. */
  readonly supportHeight: number;
}

export const MAX_CONNECTORS = 4;

const pose = (x: number, z: number, heading: number): Pose => ({ x, z, heading });

function arcEnd(radius: number, sweep: number): Pose {
  const a = Math.abs(sweep);
  const sign = sweep >= 0 ? 1 : -1;
  return pose(radius * Math.sin(a), sign * radius * (1 - Math.cos(a)), sweep);
}

function straight(
  type: PieceTypeId,
  length: number,
  a: ConnectorKind = "socket",
  b: ConnectorKind = "peg",
  y = 0,
): PieceDef {
  return {
    type,
    connectors: [
      { kind: a, pose: pose(0, 0, Math.PI), y },
      { kind: b, pose: pose(length, 0, 0), y },
    ],
    paths: [{ from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length, y0: y, rise: 0 } }],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  };
}

function curve(type: PieceTypeId, radius: number): PieceDef {
  return {
    type,
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: arcEnd(radius, CURVE_SWEEP), y: 0 },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "arc", start: pose(0, 0, 0), radius, sweep: CURVE_SWEEP, y0: 0, rise: 0 } },
    ],
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
  };
}

const half = CROSSING_SIZE / 2;

const CATALOG: Record<PieceTypeId, PieceDef> = {
  "straight-54": straight("straight-54", 54),
  "straight-108": straight("straight-108", 108),
  "straight-144": straight("straight-144", 144),
  "straight-216": straight("straight-216", 216),
  "curve-large": curve("curve-large", LARGE_CURVE_RADIUS),
  "curve-small": curve("curve-small", SMALL_CURVE_RADIUS),
  switch: {
    type: "switch",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(SWITCH_LENGTH, 0, 0), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS, CURVE_SWEEP), y: 0 },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length: SWITCH_LENGTH, y0: 0, rise: 0 } },
      {
        from: 0,
        to: 2,
        geom: { kind: "arc", start: pose(0, 0, 0), radius: LARGE_CURVE_RADIUS, sweep: CURVE_SWEEP, y0: 0, rise: 0 },
      },
    ],
    flippable: true,
    isSwitch: true,
    supportHeight: 0,
  },
  crossing: {
    type: "crossing",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(CROSSING_SIZE, 0, 0), y: 0 },
      { kind: "socket", pose: pose(half, -half, -Math.PI / 2), y: 0 },
      { kind: "peg", pose: pose(half, half, Math.PI / 2), y: 0 },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length: CROSSING_SIZE, y0: 0, rise: 0 } },
      {
        from: 2,
        to: 3,
        geom: { kind: "line", start: pose(half, -half, Math.PI / 2), length: CROSSING_SIZE, y0: 0, rise: 0 },
      },
    ],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  },
  ramp: {
    type: "ramp",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(RAMP_LENGTH, 0, 0), y: RISER_HEIGHT },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length: RAMP_LENGTH, y0: 0, rise: RISER_HEIGHT } },
    ],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  },
  riser: { type: "riser", connectors: [], paths: [], flippable: false, isSwitch: false, supportHeight: RISER_HEIGHT },
  // Bridges are track on painted arches that reach down to the ground, however high the deck is (see the landscape's
  // `bridgeLevels`): the piece's base is its deck.
  bridge: straight("bridge", BRIDGE_LENGTH),
  "bridge-curve": curve("bridge-curve", LARGE_CURVE_RADIUS),
  buffer: {
    type: "buffer",
    connectors: [{ kind: "socket", pose: pose(0, 0, Math.PI), y: 0 }],
    paths: [{ from: 0, to: null, geom: { kind: "line", start: pose(0, 0, 0), length: BUFFER_LENGTH, y0: 0, rise: 0 } }],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  },
  // A buffer that sends trains back: they wait a moment, then their engines reverse.
  "buffer-turnback": {
    type: "buffer-turnback",
    connectors: [{ kind: "socket", pose: pose(0, 0, Math.PI), y: 0 }],
    paths: [{ from: 0, to: null, geom: { kind: "line", start: pose(0, 0, 0), length: BUFFER_LENGTH, y0: 0, rise: 0 } }],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  },
  "adapter-peg": straight("adapter-peg", ADAPTER_LENGTH, "peg", "peg"),
  "adapter-socket": straight("adapter-socket", ADAPTER_LENGTH, "socket", "socket"),
  // Placed by the landscape generator in each town; the platform and building are render-only dressing.
  station: straight("station", 216),
  // Goods depots, placed by the landscape generator like stations; their buildings are render-only dressing.
  "depot-forest": straight("depot-forest", 216),
  "depot-sawmill": straight("depot-sawmill", 216),
};

export const PIECE_TYPES = Object.keys(CATALOG) as readonly PieceTypeId[];

/** Bridges stand on their own arches, down to the ground under them. */
export const isBridge = (type: PieceTypeId): boolean => type === "bridge" || type === "bridge-curve";

/** Pieces that stand on arches when raised: bridges always, a ramp when its low end is up off the ground. */
export const canStandOnArches = (type: PieceTypeId): boolean => isBridge(type) || type === "ramp";

const mirrorPose = (p: Pose): Pose => pose(p.x, -p.z, normalizeAngle(-p.heading));

function mirrorGeom(g: PathGeom): PathGeom {
  return g.kind === "line" ? { ...g, start: mirrorPose(g.start) } : { ...g, start: mirrorPose(g.start), sweep: -g.sweep };
}

function mirror(def: PieceDef): PieceDef {
  return {
    ...def,
    connectors: def.connectors.map((c) => ({ ...c, pose: mirrorPose(c.pose) })),
    paths: def.paths.map((p) => ({ ...p, geom: mirrorGeom(p.geom) })),
  };
}

const flippedCache = new Map<PieceTypeId, PieceDef>();

export function getPieceDef(type: PieceTypeId, flipped: boolean): PieceDef {
  const base = CATALOG[type];
  if (!flipped || !base.flippable) return base;
  let m = flippedCache.get(type);
  if (!m) {
    m = mirror(base);
    flippedCache.set(type, m);
  }
  return m;
}
