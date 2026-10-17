import {
  ADAPTER_LENGTH,
  DOUBLE_TRACK_SPACING,
  LOOP_RADIUS,
  SMALL_LOOP_RADIUS,
  JOINER_LENGTH,
  BRIDGE_LENGTH,
  BUFFER_LENGTH,
  CROSSING_SIZE,
  CURVE_SWEEP,
  LARGE_CURVE_RADIUS,
  RAMP_LENGTH,
  RISER_HEIGHT,
  SMALL_CURVE_RADIUS,
  SWITCH_LENGTH,
  WIDE_CURVE_RADIUS,
} from "./constants";
import { normalizeAngle, type Pose } from "./math";
import type { PathGeom } from "./path";
import { KITS, type KitTypeId } from "./kits";
import { pose, straight } from "./shapes";

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
  | "straight-36"
  | "straight-288"
  | "straight-72"
  | "straight-90"
  | "straight-126"
  | "straight-162"
  | "straight-180"
  | "straight-198"
  | "curve-large"
  | "curve-small"
  | "curve-wide"
  | "s-curve"
  | "s-curve-short"
  | "switch"
  | "switch-y"
  | "switch-3way"
  | "crossing"
  | "crossing-45"
  | "signal"
  | "ramp"
  | "riser"
  | "bridge"
  | "bridge-curve"
  | "buffer"
  | "buffer-turnback"
  | "adapter-peg"
  | "adapter-socket"
  | "joiner"
  | "balloon-loop"
  | "double-straight"
  | "crossover"
  | "double-curve"
  | "ramp-curve"
  | "balloon-loop-small"
  | "wye"
  | "station"
  | "depot-forest"
  | "depot-sawmill"
  | "depot-workshop"
  | "depot-farm"
  | "depot-mill"
  | "depot-quarry"
  | "depot-mine"
  | "depot-foundry"
  | "depot-carpenter"
  | "depot-smithy"
  | "depot-power"
  | "depot-harbour"
  | "depot-warehouse"
  | JoinTypeId
  | FitTypeId
  | KitTypeId;

/**
 * Join pieces: S-bends `length` long shifting the line `offset` to the left (flipped: right), on the 18 mm track
 * lattice. Never in the tray: the Auto piece becomes one to meet a free end a little to one side (`fitAutoStraight`).
 */
export type JoinTypeId = `join-${number}-${number}`;

/**
 * The Auto piece's shapes with a peg at both ends ("pp") or a hole at both ends ("hh"): a straight (`offset` 0) or a
 * join `length` long, for meeting two ends of the same kind (two holes facing each other). Never in the tray.
 */
export type FitTypeId = `fit-${number}-${number}-${"pp" | "hh"}`;

export interface PieceDef {
  readonly type: PieceTypeId;
  readonly connectors: readonly ConnectorDef[];
  readonly paths: readonly PathDef[];
  readonly flippable: boolean;
  readonly isSwitch: boolean;
  /** Height this piece provides to pieces resting on top of it (risers). 0 for track. */
  readonly supportHeight: number;
  /** Double track: the centre line of the board between its two lines (drawing only). */
  readonly web?: PathGeom;
  /**
   * A signal: guards trains running from connector 0 toward 1, stopping them at `stopAt` (mm along the path) while the
   * line ahead is occupied or it's held at red (see the sim's block working).
   */
  readonly signal?: { readonly stopAt: number };
}

export const MAX_CONNECTORS = 4;

const offsetPose = (p: Pose, dx: number, dz: number): Pose => ({ x: p.x + dx, z: p.z + dz, heading: p.heading });

function arcEnd(radius: number, sweep: number): Pose {
  const a = Math.abs(sweep);
  const sign = sweep >= 0 ? 1 : -1;
  return pose(radius * Math.sin(a), sign * radius * (1 - Math.cos(a)), sweep);
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

/**
 * An S-curve `length` long that shifts the line `offset` to the left (flip it for right), ending on its starting
 * heading: two equal arcs bending opposite ways.
 */
function sCurve(type: PieceTypeId, length: number, offset: number): PieceDef {
  // Each arc turns θ with radius r: 2r·sin θ = length and 2r·(1 − cos θ) = offset, so tan(θ/2) = offset / length.
  const sweep = 2 * Math.atan(offset / length);
  const radius = length / (2 * Math.sin(sweep));
  return {
    type,
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(length, offset, 0), y: 0 },
    ],
    paths: [{ from: 0, to: 1, geom: { kind: "s", start: pose(0, 0, 0), radius, sweep, y0: 0, rise: 0 } }],
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
  };
}

const half = CROSSING_SIZE / 2;
const diag = half * Math.SQRT1_2;

const arcPath = (to: number, sweep: number): PathDef => ({
  from: 0,
  to,
  geom: { kind: "arc", start: pose(0, 0, 0), radius: LARGE_CURVE_RADIUS, sweep, y0: 0, rise: 0 },
});
const linePath = (to: number, length: number): PathDef => ({ from: 0, to, geom: { kind: "line", start: pose(0, 0, 0), length, y0: 0, rise: 0 } });

const CATALOG: Record<PieceTypeId, PieceDef> = {
  "straight-54": straight("straight-54", 54),
  "straight-108": straight("straight-108", 108),
  "straight-144": straight("straight-144", 144),
  // A straight with a semaphore beside its far end: a train stops just short of it at red.
  signal: { ...straight("signal", 144), signal: { stopAt: 100 } },
  "straight-216": straight("straight-216", 216),
  "curve-large": curve("curve-large", LARGE_CURVE_RADIUS),
  "curve-small": curve("curve-small", SMALL_CURVE_RADIUS),
  "curve-wide": curve("curve-wide", WIDE_CURVE_RADIUS),
  // A tiny straight for closing small gaps, and an extra-long one for big runs.
  "straight-36": straight("straight-36", 36),
  "straight-288": straight("straight-288", 288),
  // The lengths in between, every 18 mm: what the auto straight shrinks to (not in the tray on their own).
  "straight-72": straight("straight-72", 72),
  "straight-90": straight("straight-90", 90),
  "straight-126": straight("straight-126", 126),
  "straight-162": straight("straight-162", 162),
  "straight-180": straight("straight-180", 180),
  "straight-198": straight("straight-198", 198),
  // S-curves shift the line sideways by a square, or half a square, ending the way they started.
  "s-curve": sCurve("s-curve", 216, 72),
  "s-curve-short": sCurve("s-curve-short", 144, 36),
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
  // A Y: the trunk splits into a curve each way (the lever picks which).
  "switch-y": {
    type: "switch-y",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS, -CURVE_SWEEP), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS, CURVE_SWEEP), y: 0 },
    ],
    paths: [arcPath(1, -CURVE_SWEEP), arcPath(2, CURVE_SWEEP)],
    flippable: false,
    isSwitch: true,
    supportHeight: 0,
  },
  // Three ways: straight on, or a curve either side (the lever steps through them).
  "switch-3way": {
    type: "switch-3way",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(SWITCH_LENGTH, 0, 0), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS, CURVE_SWEEP), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS, -CURVE_SWEEP), y: 0 },
    ],
    paths: [linePath(1, SWITCH_LENGTH), arcPath(2, CURVE_SWEEP), arcPath(3, -CURVE_SWEEP)],
    flippable: false,
    isSwitch: true,
    supportHeight: 0,
  },
  // Two straights crossing at 45°, for lines meeting on the diagonal.
  "crossing-45": {
    type: "crossing-45",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(CROSSING_SIZE, 0, 0), y: 0 },
      { kind: "socket", pose: pose(half - diag, -diag, Math.PI + Math.PI / 4), y: 0 },
      { kind: "peg", pose: pose(half + diag, diag, Math.PI / 4), y: 0 },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length: CROSSING_SIZE, y0: 0, rise: 0 } },
      { from: 2, to: 3, geom: { kind: "line", start: pose(half - diag, -diag, Math.PI / 4), length: CROSSING_SIZE, y0: 0, rise: 0 } },
    ],
    flippable: true,
    isSwitch: false,
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
    // Flipped, its ends swap: a peg at the foot and a hole at the top, to come down from a peg (see `SWAPS_ENDS`).
    flippable: true,
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
    // Flipped, its end is a peg (to stop a line that ends in a hole; see `SWAPS_ENDS`).
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
  },
  // A yellow buffer with a flag. Every end of the line turns trains back now (see `Sim.move`): it differs only in looks.
  "buffer-turnback": {
    type: "buffer-turnback",
    connectors: [{ kind: "socket", pose: pose(0, 0, Math.PI), y: 0 }],
    paths: [{ from: 0, to: null, geom: { kind: "line", start: pose(0, 0, 0), length: BUFFER_LENGTH, y0: 0, rise: 0 } }],
    // Flipped, its end is a peg (to stop a line that ends in a hole; see `SWAPS_ENDS`).
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
  },
  "adapter-peg": straight("adapter-peg", ADAPTER_LENGTH, "peg", "peg"),
  "adapter-socket": straight("adapter-socket", ADAPTER_LENGTH, "socket", "socket"),
  // A dog-bone: two pegs back to back, joining two track ends whose holes meet (no track of its own).
  joiner: straight("joiner", JOINER_LENGTH, "peg", "peg"),
  // Two straight lines side by side on one board.
  "double-straight": {
    type: "double-straight",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(216, 0, 0), y: 0 },
      { kind: "socket", pose: pose(0, DOUBLE_TRACK_SPACING, Math.PI), y: 0 },
      { kind: "peg", pose: pose(216, DOUBLE_TRACK_SPACING, 0), y: 0 },
    ],
    paths: [linePath(1, 216), { from: 2, to: 3, geom: { kind: "line", start: pose(0, DOUBLE_TRACK_SPACING, 0), length: 216, y0: 0, rise: 0 } }],
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
    web: { kind: "line", start: pose(0, DOUBLE_TRACK_SPACING / 2, 0), length: 216, y0: 0, rise: 0 },
  },
  // Double track round an eighth of a turn: the two lines on concentric curves, still a square apart.
  "double-curve": {
    type: "double-curve",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS + DOUBLE_TRACK_SPACING, CURVE_SWEEP), y: 0 },
      { kind: "socket", pose: pose(0, DOUBLE_TRACK_SPACING, Math.PI), y: 0 },
      { kind: "peg", pose: offsetPose(arcEnd(LARGE_CURVE_RADIUS, CURVE_SWEEP), 0, DOUBLE_TRACK_SPACING), y: 0 },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "arc", start: pose(0, 0, 0), radius: LARGE_CURVE_RADIUS + DOUBLE_TRACK_SPACING, sweep: CURVE_SWEEP, y0: 0, rise: 0 } },
      { from: 2, to: 3, geom: { kind: "arc", start: pose(0, DOUBLE_TRACK_SPACING, 0), radius: LARGE_CURVE_RADIUS, sweep: CURVE_SWEEP, y0: 0, rise: 0 } },
    ],
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
    web: { kind: "arc", start: pose(0, DOUBLE_TRACK_SPACING / 2, 0), radius: LARGE_CURVE_RADIUS + DOUBLE_TRACK_SPACING / 2, sweep: CURVE_SWEEP, y0: 0, rise: 0 },
  },
  // A ramp round a quarter turn (two large curves' worth), up one level: for spiralling up a hill.
  "ramp-curve": {
    type: "ramp-curve",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS, 2 * CURVE_SWEEP), y: RISER_HEIGHT },
    ],
    paths: [{ from: 0, to: 1, geom: { kind: "arc", start: pose(0, 0, 0), radius: LARGE_CURVE_RADIUS, sweep: 2 * CURVE_SWEEP, y0: 0, rise: RISER_HEIGHT } }],
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
  },
  // A tighter turning loop: peels off on the tight curve round a smaller circle (still longer round than a train).
  "balloon-loop-small": {
    type: "balloon-loop-small",
    connectors: [{ kind: "socket", pose: pose(0, 0, Math.PI), y: 0 }],
    paths: [
      {
        from: 0,
        to: 0,
        geom: { kind: "loop", start: pose(0, 0, 0), radius: SMALL_CURVE_RADIUS, sweep: -Math.acos(SMALL_CURVE_RADIUS / (SMALL_CURVE_RADIUS + SMALL_LOOP_RADIUS)), loopRadius: SMALL_LOOP_RADIUS, y0: 0, rise: 0 },
      },
    ],
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
  },
  // A wye: a trunk splitting into a quarter turn each way, the two ends joined by a straight across, so a train can
  // run in on one leg, reverse out along another and come back turned round. Every end is a switch (one lever).
  wye: {
    type: "wye",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS, 2 * CURVE_SWEEP), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS, -2 * CURVE_SWEEP), y: 0 },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "arc", start: pose(0, 0, 0), radius: LARGE_CURVE_RADIUS, sweep: 2 * CURVE_SWEEP, y0: 0, rise: 0 } },
      { from: 0, to: 2, geom: { kind: "arc", start: pose(0, 0, 0), radius: LARGE_CURVE_RADIUS, sweep: -2 * CURVE_SWEEP, y0: 0, rise: 0 } },
      { from: 1, to: 2, geom: { kind: "line", start: pose(LARGE_CURVE_RADIUS, LARGE_CURVE_RADIUS, -Math.PI / 2), length: 2 * LARGE_CURVE_RADIUS, y0: 0, rise: 0 } },
    ],
    flippable: false,
    isSwitch: true,
    supportHeight: 0,
  },
  // Double track with a link across: from the first line's start, the lever sends trains on or over to the other.
  crossover: {
    type: "crossover",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(216, 0, 0), y: 0 },
      { kind: "socket", pose: pose(0, DOUBLE_TRACK_SPACING, Math.PI), y: 0 },
      { kind: "peg", pose: pose(216, DOUBLE_TRACK_SPACING, 0), y: 0 },
    ],
    // The link comes last, so the lever's "over" (state 1) picks it from either line.
    paths: [
      linePath(1, 216),
      { from: 2, to: 3, geom: { kind: "line", start: pose(0, DOUBLE_TRACK_SPACING, 0), length: 216, y0: 0, rise: 0 } },
      {
        from: 0,
        to: 3,
        geom: { kind: "s", start: pose(0, 0, 0), sweep: 2 * Math.atan(DOUBLE_TRACK_SPACING / 216), radius: 216 / (2 * Math.sin(2 * Math.atan(DOUBLE_TRACK_SPACING / 216))), y0: 0, rise: 0 },
      },
    ],
    flippable: true,
    isSwitch: true,
    supportHeight: 0,
    web: { kind: "line", start: pose(0, DOUBLE_TRACK_SPACING / 2, 0), length: 216, y0: 0, rise: 0 },
  },
  // A turning loop: in at its one end, round, and back out the same end facing the other way.
  "balloon-loop": {
    type: "balloon-loop",
    connectors: [{ kind: "socket", pose: pose(0, 0, Math.PI), y: 0 }],
    paths: [
      {
        from: 0,
        to: 0,
        // Peel off along the large curve until the big circle's centre is on the line, so the loop is symmetric.
        geom: { kind: "loop", start: pose(0, 0, 0), radius: LARGE_CURVE_RADIUS, sweep: -Math.acos(LARGE_CURVE_RADIUS / (LARGE_CURVE_RADIUS + LOOP_RADIUS)), loopRadius: LOOP_RADIUS, y0: 0, rise: 0 },
      },
    ],
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
  },
  // Placed by the landscape generator in each town; the platform and building are render-only dressing.
  station: straight("station", 216),
  // Goods depots, placed by the landscape generator like stations; their buildings are render-only dressing.
  "depot-forest": straight("depot-forest", 216),
  "depot-sawmill": straight("depot-sawmill", 216),
  "depot-workshop": straight("depot-workshop", 216),
  "depot-farm": straight("depot-farm", 216),
  "depot-mill": straight("depot-mill", 216),
  "depot-quarry": straight("depot-quarry", 216),
  "depot-mine": straight("depot-mine", 216),
  "depot-foundry": straight("depot-foundry", 216),
  "depot-carpenter": straight("depot-carpenter", 216),
  "depot-smithy": straight("depot-smithy", 216),
  "depot-power": straight("depot-power", 216),
  "depot-harbour": straight("depot-harbour", 216),
  "depot-warehouse": straight("depot-warehouse", 216),
};

/** The join sizes: lengths and sideways shifts on the lattice, gentle enough to run (no tighter than a small curve). */
export const JOIN_SIZES: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let length = 72; length <= 216; length += 18) {
    for (let offset = 18; offset <= 90; offset += 18) {
      const sweep = 2 * Math.atan(offset / length);
      if (sweep <= (50 * Math.PI) / 180 && length / (2 * Math.sin(sweep)) >= SMALL_CURVE_RADIUS) out.push([length, offset]);
    }
  }
  return out;
})();

export const joinType = (length: number, offset: number): JoinTypeId => `join-${length}-${offset}`;
/** Join pieces, and the Auto piece's both-ends-alike shapes: built when first used, kept out of the catalogue. */
export const isJoin = (type: PieceTypeId): type is JoinTypeId | FitTypeId => type.startsWith("join-") || type.startsWith("fit-");

for (const [length, offset] of JOIN_SIZES) CATALOG[joinType(length, offset)] = sCurve(joinType(length, offset), length, offset);

/** The lengths the Auto piece comes in, every 18 mm from the tiny straight to the long one. */
export const FIT_LENGTHS = [36, 54, 72, 90, 108, 126, 144, 162, 180, 198, 216] as const;
export const fitType = (length: number, offset: number, ends: "pp" | "hh"): FitTypeId => `fit-${length}-${offset}-${ends}`;
export const isFit = (type: PieceTypeId): type is FitTypeId => type.startsWith("fit-");
/** A piece with both ends of one kind. */
const bothEnds = (def: PieceDef, kind: "peg" | "socket"): PieceDef => ({ ...def, connectors: def.connectors.map((c) => ({ ...c, kind })) });
for (const ends of ["pp", "hh"] as const) {
  const kind = ends === "pp" ? "peg" : "socket";
  for (const length of FIT_LENGTHS) CATALOG[fitType(length, 0, ends)] = bothEnds(straight(fitType(length, 0, ends), length), kind);
  for (const [length, offset] of JOIN_SIZES) CATALOG[fitType(length, offset, ends)] = bothEnds(sCurve(fitType(length, offset, ends), length, offset), kind);
}

// Kit pieces (see kits.ts): their track is a piece like any other, saved as one.
for (const [type, kit] of Object.entries(KITS) as [KitTypeId, (typeof KITS)[KitTypeId]][]) CATALOG[type] = kit.track;

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
    ...(def.web ? { web: mirrorGeom(def.web) } : {}),
  };
}

/** A straight piece (a ramp, a buffer) "flips" by swapping its ends' peg and hole (mirroring it would change nothing). */
function swapEnds(def: PieceDef): PieceDef {
  return { ...def, connectors: def.connectors.map((c) => ({ ...c, kind: c.kind === "peg" ? "socket" : "peg" })) };
}

/** Pieces whose flip swaps their ends' peg and hole, rather than mirroring them. */
const SWAPS_ENDS: ReadonlySet<PieceTypeId> = new Set<PieceTypeId>(["ramp", "buffer", "buffer-turnback"]);

/** Does flipping this piece swap its ends' peg and hole (so a moved one may flip to fit, as a new one does)? */
export const flipSwapsEnds = (type: PieceTypeId): boolean => SWAPS_ENDS.has(type);

const flippedCache = new Map<PieceTypeId, PieceDef>();

export function getPieceDef(type: PieceTypeId, flipped: boolean): PieceDef {
  const base = CATALOG[type];
  if (!flipped || !base.flippable) return base;
  let m = flippedCache.get(type);
  if (!m) {
    m = SWAPS_ENDS.has(type) ? swapEnds(base) : mirror(base);
    flippedCache.set(type, m);
  }
  return m;
}
