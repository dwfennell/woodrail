import type { DepotRole } from "../economy";
import { normalizeAngle, type Pose } from "./math";
import type { PieceDef, PieceTypeId } from "./pieces";
import { BUFFER_LENGTH } from "./constants";
import { pose, straight } from "./shapes";

/**
 * Kit pieces: track props that trains really use (see docs/superpowers/specs/2026-10-17-track-props-design.md). A kit
 * is a piece like any other (its track is in the layout, has joints, is saved with the pieces and undone by the
 * editor), with a catalogue model drawn on it (`KitView`), ground it needs clear beside it (`checkYard`), and, if it
 * says so, a stop for trains (`Economy`).
 *
 * Piece-local coordinates throughout: t along the track from its first end (connector 0), l across it (+l to the
 * left, looking along the track), as depots lay out their yards (`DEPOT_LAYOUT`).
 */

/** A rectangle in a piece's own frame: its centre (t along, l across) and its size (w along, d across), in mm. */
export interface KitRect {
  readonly t: number;
  readonly l: number;
  readonly w: number;
  readonly d: number;
}

/** Which trains stop at a kit: those with passenger cars, those with a steam engine, or any powered train. */
export type KitStopWho = "passengers" | "steam" | "any";

export interface KitDef {
  /** The catalogue model drawn for it (its own track slabs left out: real track is drawn under it). */
  readonly asset: string;
  /** What it's called in messages, lower case ("The platform needs open ground", "That's the platform"). */
  readonly name: string;
  /** Its track: connectors and paths, built with the same helpers as pieces (straight, curve, buffer ends). */
  readonly track: PieceDef;
  /** Who draws the rails: the ordinary track (most kits), or the model itself (bridges, tunnels, the turntable deck). */
  readonly rails: "track" | "model";
  /**
   * Where the asset stands in the piece's frame: its origin at (t, l), turned `turn` radians about the vertical (as
   * three.js turns, so π puts the model's +z on the piece's −l side). Default: the middle of the track, unturned (an
   * asset authored round its own slab of track).
   */
  readonly place?: { readonly t: number; readonly l: number; readonly turn?: number };
  /** Ground it needs clear, in piece-local t/l rectangles (stations' platforms, cranes' legs, a shed's walls). */
  readonly footprint: readonly KitRect[];
  /** Can be dropped onto a run of straights to take its place, like a depot (single path, length a multiple of 54). */
  readonly splices?: boolean;
  /**
   * Trains stop here: `at` mm along its path from the end the train comes in by (where the train's front halts), for
   * `seconds` (game time), and which trains. Put `at` past a train's braking distance (about 30 mm at full speed).
   */
  readonly stop?: {
    readonly at: number;
    readonly seconds: number;
    readonly who: KitStopWho;
    /**
     * A service (water, coal, fuel): an engine that took one in the last `cooldown` seconds (game time) runs through
     * any kit's stop with a cooldown, so a busy line keeps moving.
     */
    readonly cooldown?: number;
  };
  /** Trains crawl over it at this speed (mm/s) while any of their axles is on it (a weighbridge). */
  readonly crawl?: number;
  /**
   * It's a cargo stop: registered as an economy depot of this role (`syncIndustries`, as industries' pieces are), so
   * trains stop to load and unload as at an industry. Sandbox's roles: an endless loader of one good, or an unloader
   * whose goods vanish (`KitDepotRole`). Its depot isn't drawn by `DepotView`: the kit's model is, its crane moving.
   */
  readonly depot?: DepotRole;
  /**
   * When its model moves: while a train is on it ("occupied": any axle on the piece), while one is standing at it
   * ("stopped": halted at its stop, or its depot's crane working on it), or with its state ("state": its piece's switch
   * state, a turntable's deck; or its signals' aspects, a signal skin's: see `KitStateMotion`). Which parts move, and
   * how, is `KIT_MOTIONS` (src/render/kit-motions.ts), by the kit's asset: a kit that moves needs an entry there. See
   * `KitView` for how it's drawn (live only while moving).
   */
  readonly moves?: "occupied" | "stopped" | "state";
}

/** Kit piece types: `kit-` and the asset's name without its catalogue prefix. */
export type KitTypeId = `kit-${string}`;

/** The furnished platform's depth across, and how far off the track's edge it stands (mm). */
const PLATFORM_DEPTH = 26;
const PLATFORM_GAP = 1;
/** The track's half width (mm): its edge is this far from its centre line. */
const TRACK_HALF = 20;
/** Roads side by side in a station or shed: a double track apart, so a ladder of switches and curves meets them. */
const ROADS = 72;
/** How far each leg of the signal gantry stands from its middle (mm): clear of both roads. */
const GANTRY_LEG = 70;
/** Where a platform `depth` deep stands beside a track, its edge just off the track's (l of its middle, mm). */
const beside = (depth: number) => TRACK_HALF + PLATFORM_GAP + depth / 2;

/** A station's stop: a train with coaches halts with its front near the far end of the platform, for 4 s. */
const PASSENGERS = { at: 196, seconds: 4, who: "passengers" } as const;

/**
 * An engine service's stop (water, coal): a steam engine halts for 3 s while the spout or chute swings over it, and
 * one that took a service in the last minute runs through.
 */
const STEAM_SERVICE = { at: 90, seconds: 3, who: "steam", cooldown: 60 } as const;

/**
 * Track for a kit of several roads: each starts at a connector (`starts`: the pose it runs on from, into the piece) and
 * runs `length` straight on, through to a connector at its far end, or (`buffered`) to a buffer there (the model draws
 * the buffer stop: its face is about 22 past the road's end, where a train's front comes to rest).
 */
function roads(type: PieceTypeId, starts: readonly Pose[], length: number, buffered: boolean): PieceDef {
  const connectors: PieceDef["connectors"][number][] = [];
  const paths: PieceDef["paths"][number][] = [];
  for (const s of starts) {
    const from = connectors.length;
    connectors.push({ kind: "socket", pose: pose(s.x, s.z, normalizeAngle(s.heading + Math.PI)), y: 0 });
    let to: number | null = null;
    if (!buffered) {
      to = connectors.length;
      connectors.push({ kind: "peg", pose: pose(s.x + length * Math.cos(s.heading), s.z + length * Math.sin(s.heading), s.heading), y: 0 });
    }
    paths.push({ from, to, geom: { kind: "line", start: pose(s.x, s.z, s.heading), length, y0: 0, rise: 0 } });
  }
  return { type, connectors, paths, flippable: false, isSwitch: false, supportHeight: 0 };
}

/**
 * A signal skin's track: the signal piece's own (a 144 straight, trains stopping at 100 at red), or a gantry's roads
 * with a signal on each. The sim's block working reads only `signal`, so a skin holds trains exactly as the plain one.
 */
const SIGNAL_LENGTH = 144;
const SIGNAL_STOP = { stopAt: 100 } as const;
/** Where a signal skin's post stands along its piece (the plain signal's: just past its stop point). */
const SIGNAL_POST = 124;
const signalTrack = (type: PieceTypeId): PieceDef => ({ ...straight(type, SIGNAL_LENGTH), signal: SIGNAL_STOP });

/**
 * A buffer skin's track: the buffer piece's own (one end, a path ending in the piece), flipping as a buffer does (its
 * end's peg and hole swap: see `SWAPS_ENDS` in pieces.ts). The model draws the buffer stop.
 */
const bufferTrack = (type: PieceTypeId): PieceDef => ({
  type,
  connectors: [{ kind: "socket", pose: pose(0, 0, Math.PI), y: 0 }],
  paths: [{ from: 0, to: null, geom: { kind: "line", start: pose(0, 0, 0), length: BUFFER_LENGTH, y0: 0, rise: 0 } }],
  flippable: true,
  isSwitch: false,
  supportHeight: 0,
});

/** Roads side by side along +t, `ROADS` apart, the first on the piece's own line (l 0), the rest to its left. */
const sideBySide = (n: number): Pose[] => Array.from({ length: n }, (_, i) => pose(0, i * ROADS, 0));

/** A roundhouse's stall roads: from the rim of a turntable's pit (radius 92), fanned an eighth of a turn apart. */
const PIT = 92;
const stalls = (angles: readonly number[]): Pose[] => angles.map((a) => pose(-PIT + PIT * Math.cos(a), PIT * Math.sin(a), a));

/**
 * A turntable's track: eight ends round a pit `PIT` in radius, centred `PIT` along from the first (connector k an
 * eighth of a turn on from the one before, all pegs, as a roundhouse's stalls are holes), and four ways the deck can
 * lie, path k from end k across to end k + 4 (`gated`: only the one the deck lies along is open).
 */
function turntable(type: PieceTypeId): PieceDef {
  const at = (k: number) => Math.PI + (k * Math.PI) / 4;
  const connectors = Array.from({ length: 8 }, (_, k) => ({ kind: "peg" as const, pose: pose(PIT + PIT * Math.cos(at(k)), PIT * Math.sin(at(k)), normalizeAngle(at(k))), y: 0 }));
  const paths = Array.from({ length: 4 }, (_, k) => ({
    from: k,
    to: k + 4,
    geom: { kind: "line" as const, start: pose(connectors[k].pose.x, connectors[k].pose.z, normalizeAngle(at(k) + Math.PI)), length: 2 * PIT, y0: 0, rise: 0 },
  }));
  return { type, connectors, paths, flippable: false, isSwitch: false, supportHeight: 0, gated: true };
}

/** Every kit, by piece type. */
export const KITS: Readonly<Record<KitTypeId, KitDef>> = {
  // A 216 straight with the furnished platform along its left (+l) side: passenger trains stop at it for 4 s.
  "kit-platform-furnished": {
    asset: "bldg-platform-furnished",
    name: "platform",
    track: straight("kit-platform-furnished", 216),
    rails: "track",
    // The model is a platform 216 long, centred on its origin, its edge line on its +z side: turned round, so that
    // edge faces the track, and set beside it.
    place: { t: 108, l: TRACK_HALF + PLATFORM_GAP + PLATFORM_DEPTH / 2, turn: Math.PI },
    footprint: [{ t: 108, l: TRACK_HALF + PLATFORM_GAP + PLATFORM_DEPTH / 2, w: 216, d: PLATFORM_DEPTH + 2 }],
    splices: true,
    stop: PASSENGERS,
  },
  // Halts and stations with their buildings on one side: each a 216 straight, splicing onto a line, a stop for
  // passenger trains. Each model's platform is 216 long, its edge line to the track.
  "kit-country-halt": {
    asset: "bldg-country-halt",
    name: "halt",
    track: straight("kit-country-halt", 216),
    rails: "track",
    // A platform 28 deep (its shelter on it), edge line on its +z side: turned to face the track.
    place: { t: 108, l: beside(28), turn: Math.PI },
    footprint: [{ t: 108, l: beside(28), w: 216, d: 30 }],
    splices: true,
    stop: PASSENGERS,
  },
  "kit-mountain-station": {
    asset: "bldg-mountain-station",
    name: "station",
    track: straight("kit-mountain-station", 216),
    rails: "track",
    // Its platform (24 deep, edge line at the model's z 30) in front of the chalet: turned to face the track.
    place: { t: 108, l: TRACK_HALF + PLATFORM_GAP + 30, turn: Math.PI },
    footprint: [
      { t: 108, l: beside(24), w: 216, d: 26 },
      // The chalet and its pines behind the platform.
      { t: 103, l: 63, w: 90, d: 34 },
    ],
    splices: true,
    stop: PASSENGERS,
  },
  "kit-harbour-station": {
    asset: "bldg-harbour-station",
    name: "station",
    track: straight("kit-harbour-station", 216),
    rails: "track",
    // The quay (40 deep, edge line at the model's z −30) beside the track, the water and jetty beyond it.
    place: { t: 108, l: TRACK_HALF + PLATFORM_GAP + 30 },
    footprint: [{ t: 108, l: 66.5, w: 216, d: 91 }],
    splices: true,
    stop: PASSENGERS,
  },
  // Two through roads a double track apart, a platform outside each: a stop on each road, a natural passing place.
  "kit-two-platform-station": {
    asset: "bldg-two-platform-station",
    name: "station",
    track: roads("kit-two-platform-station", sideBySide(2), 216, false),
    rails: "track",
    place: { t: 108, l: ROADS / 2 },
    footprint: [
      // The far platform and its building (right of the first road), the near platform and canopy (left of the second).
      { t: 108, l: -37, w: 216, d: 32 },
      { t: 108, l: ROADS + 34, w: 216, d: 28 },
    ],
    stop: PASSENGERS,
  },
  // Three roads ending at buffers under a glass shed, a concourse past them: trains stop near the buffers, then turn
  // back there as at any end of the line.
  "kit-grand-terminus": {
    asset: "bldg-grand-terminus",
    name: "terminus",
    track: roads("kit-grand-terminus", sideBySide(3), 216, true),
    rails: "track",
    // The model's origin is 205 in from where its roads start, on the middle road.
    place: { t: 205, l: ROADS },
    footprint: [
      { t: 115, l: -28, w: 230, d: 8 },
      { t: 115, l: 2 * ROADS + 28, w: 230, d: 8 },
      { t: 108, l: ROADS / 2, w: 216, d: 26 },
      { t: 108, l: ROADS * 1.5, w: 216, d: 26 },
      // The concourse and clock tower.
      { t: 263, l: ROADS, w: 34, d: 214 },
    ],
    stop: { at: 190, seconds: 4, who: "passengers" },
  },
  // Somewhere to park engines: two roads into a shed, ending at buffers. Its doors open as a train comes in and close
  // behind it.
  "kit-engine-shed": {
    asset: "bldg-engine-shed",
    name: "engine shed",
    track: roads("kit-engine-shed", sideBySide(2), 162, true),
    rails: "track",
    // The model's front (+x, its doors) faces where the roads come in, 54 along them.
    place: { t: 124, l: ROADS / 2, turn: Math.PI },
    footprint: [{ t: 124, l: ROADS / 2, w: 144, d: 148 }],
    moves: "occupied",
  },
  // Three stalls fanned round a turntable's pit (Sandbox's turntable, to come), their roads ending at buffers.
  "kit-roundhouse-segment": {
    asset: "bldg-roundhouse-segment",
    name: "roundhouse",
    track: roads("kit-roundhouse-segment", stalls([-Math.PI / 4, 0, Math.PI / 4]), 108, true),
    rails: "track",
    moves: "occupied",
    // The model's origin is the turntable's centre.
    place: { t: -PIT, l: 0 },
    footprint: [
      { t: 82, l: 0, w: 124, d: 58 },
      { t: 31, l: 123, w: 128, d: 128 },
      { t: 31, l: -123, w: 128, d: 128 },
    ],
  },
  // Engine services: 108 straights with the service beside them (left), splicing onto a line. A steam engine stops
  // for 3 s while the spout or chute swings over it (the fuel station: any engine); not again for a minute.
  "kit-water-tower": {
    asset: "bldg-water-tower",
    name: "water tower",
    track: straight("kit-water-tower", 108),
    rails: "track",
    // The tank (radius 18) just off the track's edge; its spout rests along the track (+x), and swings out over it.
    place: { t: 40, l: TRACK_HALF + PLATFORM_GAP + 18 },
    footprint: [{ t: 39, l: 39, w: 42, d: 38 }],
    splices: true,
    stop: STEAM_SERVICE,
    moves: "stopped",
  },
  "kit-coal-stage": {
    asset: "bldg-coal-stage",
    name: "coal stage",
    track: straight("kit-coal-stage", 108),
    rails: "track",
    // Its chute side (+z) to the track.
    place: { t: 54, l: TRACK_HALF + PLATFORM_GAP + 20, turn: Math.PI },
    footprint: [{ t: 70, l: 41, w: 96, d: 40 }],
    splices: true,
    stop: STEAM_SERVICE,
    moves: "stopped",
  },
  "kit-water-crane": {
    asset: "mech-water-crane",
    name: "water crane",
    track: straight("kit-water-crane", 108),
    rails: "track",
    // The model's own slab of track runs along x at z 38, the column at its origin: turned so the column's on the left.
    place: { t: 54, l: 38, turn: Math.PI },
    footprint: [{ t: 54, l: 38, w: 26, d: 26 }],
    splices: true,
    stop: STEAM_SERVICE,
    moves: "stopped",
  },
  "kit-coaling-crane": {
    asset: "mech-coaling-crane",
    name: "coaling crane",
    track: straight("kit-coaling-crane", 108),
    rails: "track",
    // Its track at the model's z 40, the stage behind it.
    place: { t: 54, l: 40, turn: Math.PI },
    footprint: [{ t: 54, l: 60, w: 86, d: 42 }],
    splices: true,
    stop: STEAM_SERVICE,
    moves: "stopped",
  },
  "kit-fuel-station": {
    asset: "mech-fuel-station",
    name: "fuel station",
    track: straight("kit-fuel-station", 108),
    rails: "track",
    // Its track at the model's z 36, the tank and pump behind it.
    place: { t: 54, l: 36, turn: Math.PI },
    footprint: [{ t: 54, l: 55, w: 108, d: 62 }],
    splices: true,
    stop: { ...STEAM_SERVICE, who: "any" },
    moves: "stopped",
  },
  // Cargo machines: straights that splice, each an economy depot (Sandbox's loaders and unloaders), so trains stop
  // for loading and unloading as at an industry, the machine's own crane working while they stand there.
  // Loaders: an endless heap of one good.
  "kit-log-loader": {
    asset: "mech-log-loader",
    name: "log loader",
    track: straight("kit-log-loader", 162),
    rails: "track",
    // The log pile and post crane behind the track (the model's −z side), turned to the left.
    place: { t: 81, l: 0, turn: Math.PI },
    footprint: [{ t: 81, l: 48, w: 110, d: 36 }],
    splices: true,
    depot: "loader-log",
    moves: "stopped",
  },
  "kit-grain-elevator": {
    asset: "mech-grain-elevator",
    name: "grain elevator",
    track: straight("kit-grain-elevator", 162),
    rails: "track",
    place: { t: 81, l: 0, turn: Math.PI },
    footprint: [{ t: 56, l: 60, w: 130, d: 48 }],
    splices: true,
    depot: "loader-grain",
    moves: "stopped",
  },
  "kit-cargo-conveyor": {
    asset: "mech-cargo-conveyor",
    name: "conveyor",
    track: straight("kit-cargo-conveyor", 216),
    rails: "track",
    // The model's track runs along its z at x 86: turned a quarter, the belt climbs to it from the left.
    place: { t: 108, l: 86, turn: Math.PI / 2 },
    footprint: [{ t: 115, l: 106, w: 56, d: 170 }],
    splices: true,
    depot: "loader-grain",
    moves: "stopped",
  },
  // The coal chute is a loader of coal (not a service): hoppers fill under it.
  "kit-coal-chute": {
    asset: "mech-coal-chute",
    name: "coal chute",
    track: straight("kit-coal-chute", 108),
    rails: "track",
    place: { t: 54, l: 0, turn: Math.PI },
    footprint: [{ t: 54, l: 52, w: 68, d: 48 }],
    splices: true,
    depot: "loader-coal",
    moves: "stopped",
  },
  // Cranes load crates (planks) onto timber wagons.
  "kit-gantry-crane": {
    asset: "mech-gantry-crane",
    name: "gantry crane",
    track: straight("kit-gantry-crane", 216),
    rails: "track",
    // Its rails either side of the line.
    footprint: [
      { t: 108, l: 61, w: 80, d: 20 },
      { t: 108, l: -61, w: 80, d: 20 },
    ],
    splices: true,
    depot: "loader-planks",
    moves: "stopped",
  },
  "kit-harbour-crane": {
    asset: "mech-harbour-crane",
    name: "harbour crane",
    track: straight("kit-harbour-crane", 162),
    rails: "track",
    // Its four legs straddle the line.
    footprint: [
      { t: 81, l: 27, w: 60, d: 10 },
      { t: 81, l: -27, w: 60, d: 10 },
    ],
    splices: true,
    depot: "loader-planks",
    moves: "stopped",
  },
  "kit-magnet-crane": {
    asset: "mech-magnet-crane",
    name: "magnet crane",
    track: straight("kit-magnet-crane", 216),
    rails: "track",
    // On its yard disc beside the line, its jib (the model's +x) reaching over the track.
    place: { t: 108, l: 82, turn: Math.PI / 2 },
    footprint: [{ t: 108, l: 82, w: 120, d: 120 }],
    splices: true,
    depot: "loader-planks",
    moves: "stopped",
  },
  // Unloaders: any goods, which vanish into them.
  "kit-tipping-dump": {
    asset: "mech-tipping-dump",
    name: "wagon tipper",
    track: straight("kit-tipping-dump", 216),
    rails: "track",
    // Its pit on the left (the model's +z).
    place: { t: 108, l: 0 },
    footprint: [{ t: 108, l: 52, w: 104, d: 68 }],
    splices: true,
    depot: "unloader",
    moves: "stopped",
  },
  "kit-drop-hopper": {
    asset: "mech-drop-hopper",
    name: "drop hopper",
    track: straight("kit-drop-hopper", 162),
    rails: "track",
    // Its bin on four legs over the line.
    footprint: [
      { t: 81, l: 32, w: 68, d: 8 },
      { t: 81, l: -32, w: 68, d: 8 },
    ],
    splices: true,
    depot: "unloader",
    moves: "stopped",
  },
  "kit-goods-shed": {
    asset: "bldg-goods-shed",
    name: "goods shed",
    track: straight("kit-goods-shed", 108),
    rails: "track",
    // Its loading dock (the model's +z side, its edge at z 39) to the track.
    place: { t: 54, l: TRACK_HALF + PLATFORM_GAP + 39, turn: Math.PI },
    footprint: [{ t: 54, l: 50, w: 104, d: 60 }],
    splices: true,
    depot: "unloader",
    moves: "stopped",
  },
  // The weighbridge: trains crawl over it while its dial swings.
  "kit-weighbridge": {
    asset: "mech-weighbridge",
    name: "weighbridge",
    track: straight("kit-weighbridge", 108),
    rails: "track",
    // Its hut on the left (the model's −z).
    place: { t: 54, l: 0, turn: Math.PI },
    footprint: [{ t: 54, l: 50, w: 40, d: 34 }],
    splices: true,
    crawl: 30,
    moves: "occupied",
  },
  // A turntable: eight roads round a pit (radius 92), an eighth of a turn apart, and a deck across it that joins two
  // opposite ones. A tap turns the deck to the next road (not with a train on it); trains run on to a road the deck
  // doesn't lie along as to the end of the line (they turn back). Its model draws the deck's rails.
  "kit-turntable": {
    asset: "mech-turntable",
    name: "turntable",
    track: turntable("kit-turntable"),
    rails: "model",
    // The model's origin is the pit's centre.
    place: { t: PIT, l: 0 },
    // The pit, inside the roads that leave its rim.
    footprint: [{ t: PIT, l: 0, w: 124, d: 124 }],
    moves: "state",
  },
  // A transfer table: three roads side by side (60 apart) each side of a pit, and a deck that slides across to join
  // one pair. A tap moves it to the next (not with a train on it).
  "kit-transfer-table": {
    asset: "mech-transfer-table",
    name: "transfer table",
    track: { ...roads("kit-transfer-table", [0, 60, -60].map((l) => pose(0, l, 0)), 120, false), gated: true },
    rails: "model",
    // The model's origin is the pit's middle.
    place: { t: 60, l: 0 },
    footprint: [{ t: 60, l: 0, w: 116, d: 196 }],
    moves: "state",
  },
  // A drive-through wash on a 108 straight: trains crawl through while its brushes spin and its sprays drip.
  "kit-train-wash": {
    asset: "mech-train-wash",
    name: "train wash",
    track: straight("kit-train-wash", 108),
    rails: "track",
    // Its frame's posts either side of the line.
    footprint: [
      { t: 54, l: 36, w: 76, d: 10 },
      { t: 54, l: -36, w: 76, d: 10 },
    ],
    splices: true,
    crawl: 40,
    moves: "occupied",
  },
  // The line runs through the arch on a 108 straight; the portcullis rises as a train comes and drops behind it.
  // Signal skins: the signal piece with a catalogue model for its post. The same block working (red while the line
  // ahead is occupied, or while it's held by a tap), shown by the model, whose moving parts follow the aspect
  // ("state"). Each model faces its own +x: turned round, it faces trains coming in from connector 0, its post on the
  // piece's +l side (where the plain signal's post stands), just past the stop point.
  "kit-semaphore-signal": {
    asset: "mech-semaphore-signal",
    name: "signal",
    track: signalTrack("kit-semaphore-signal"),
    rails: "track",
    // The model's own slab of track is 36 off its post.
    place: { t: SIGNAL_POST, l: 36, turn: Math.PI },
    footprint: [{ t: SIGNAL_POST, l: 36, w: 14, d: 14 }],
    moves: "state",
  },
  "kit-colour-light-signal": {
    asset: "mech-colour-light-signal",
    name: "signal",
    track: signalTrack("kit-colour-light-signal"),
    rails: "track",
    // The model's own slab of track is 30 off its post.
    place: { t: SIGNAL_POST, l: 30, turn: Math.PI },
    footprint: [{ t: SIGNAL_POST, l: 30, w: 12, d: 12 }],
    moves: "state",
  },
  // A gantry over two roads a double track apart (as the double straight's), a signal head over each, both guarding
  // trains running from the roads' first ends: each road's signal works its own block.
  "kit-signal-gantry": {
    asset: "mech-signal-gantry",
    name: "signal gantry",
    track: { ...roads("kit-signal-gantry", sideBySide(2), SIGNAL_LENGTH, false), signal: SIGNAL_STOP },
    rails: "track",
    // Its middle between the roads, its legs outside them.
    place: { t: SIGNAL_POST, l: ROADS / 2, turn: Math.PI },
    footprint: [
      { t: SIGNAL_POST, l: ROADS / 2 - GANTRY_LEG, w: 14, d: 14 },
      { t: SIGNAL_POST, l: ROADS / 2 + GANTRY_LEG, w: 14, d: 14 },
    ],
    moves: "state",
  },
  // A skin of the buffer: a timber buffer stop whose lamp lights while a train stands against it (on its piece).
  "kit-buffer-stop-lamp": {
    asset: "mech-buffer-stop-lamp",
    name: "buffer stop",
    track: bufferTrack("kit-buffer-stop-lamp"),
    rails: "track",
    // Its sprung buffers' faces (the model's x 16) where a plain buffer block's are, 76 along the piece.
    place: { t: 60, l: 0 },
    footprint: [],
    moves: "occupied",
  },
  "kit-castle-gate": {
    asset: "bldg-castle-gate",
    name: "castle gate",
    track: straight("kit-castle-gate", 108),
    rails: "track",
    // Its towers either side of the line (the wall between them stands over the track).
    footprint: [
      { t: 54, l: 46, w: 40, d: 44 },
      { t: 54, l: -46, w: 40, d: 44 },
    ],
    splices: true,
    moves: "occupied",
  },
};

const byType = new Map<string, KitDef>(Object.entries(KITS));

/** The kit a piece type is, or undefined (a map lookup: cheap enough for every piece on every move). */
export const kitOf = (type: PieceTypeId): KitDef | undefined => byType.get(type);

/** Is this piece type a kit? */
export const isKit = (type: PieceTypeId): type is KitTypeId => byType.has(type);

/** The kit piece types, in the order they're listed. */
export const KIT_TYPES = Object.keys(KITS) as readonly KitTypeId[];

/** The kit that draws this catalogue asset, if any (for the tray: its shelf offers the kit, not the prop). */
const byAsset = new Map<string, KitTypeId>(KIT_TYPES.map((t) => [KITS[t].asset, t]));
export const kitForAsset = (asset: string): KitTypeId | undefined => byAsset.get(asset);

/** Where a kit's model stands in its piece's frame (see `KitDef.place`). */
export function kitPlace(kit: KitDef): { t: number; l: number; turn: number } {
  if (kit.place) return { t: kit.place.t, l: kit.place.l, turn: kit.place.turn ?? 0 };
  const end = kit.track.connectors[1]?.pose;
  return { t: end ? end.x / 2 : 0, l: end ? end.z / 2 : 0, turn: 0 };
}
