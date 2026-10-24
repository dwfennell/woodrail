import { normalizeAngle, solveParentPose, transformPose, type Pose } from "./math";
import { createSample, pathLength, samplePath } from "./path";
import { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE, LARGE_CURVE_RADIUS, RAMP_LENGTH, RISER_HEIGHT, SMALL_CURVE_RADIUS, WIDE_CURVE_RADIUS } from "./constants";
import { connectorRef, Layout } from "./layout";
import { getPieceDef, isBridge, type ConnectorKind, type PieceTypeId } from "./pieces";
import { relaxJoints } from "./relax";

/**
 * Drawing track: a stroke drawn with a finger (ground points) turned into a run of pieces, one at a time, from a free
 * end. See docs/superpowers/specs/2026-10-15-draw-track-design.md.
 */

/** Where a drawn line has got to: a free end, its heading pointing the way the line goes on. */
export interface DrawEnd {
  x: number;
  z: number;
  heading: number;
  y: number;
  /** The end's own kind: the next piece seats on it with an end of the other kind. */
  kind: ConnectorKind;
}

export interface DrawnPiece {
  readonly type: PieceTypeId;
  readonly flipped: boolean;
  readonly pose: Pose;
  readonly y: number;
  /** The piece's end seated on the line (its connector index), and the one it leaves free. */
  readonly entry: number;
  readonly exit: number;
  /** Where the line starts again after it. */
  readonly end: DrawEnd;
  /** How far along the stroke (mm) the line had got before this piece, and how many stroke points lead up to there. */
  readonly from: number;
  readonly points: number;
  /** Why it may not go there (the line stops at it), or null. */
  readonly blocked: string | null;
  /** The reason code for that (see `DrawCheck`), or null. */
  readonly blockedBy: string | null;
  /** Points along its track, from where it joins the line to its free end: x, z and the heading the line runs, in threes. */
  readonly track: readonly number[];
  /** Laid along a straight stroke, where the line may lie off to its side (see `DrawLine.chooseFlat`). */
  readonly aside: boolean;
}

/** A piece the line could take next, before it's checked. */
export interface DrawCandidate {
  readonly type: PieceTypeId;
  readonly flipped: boolean;
  readonly pose: Pose;
  readonly y: number;
  readonly entry: number;
  readonly exit: number;
  readonly end: DrawEnd;
  /** Along its track (mm). */
  readonly length: number;
}

/**
 * Why a piece may not go somewhere, as the line's `check` says it: a reason code (a `BlockReason`, or "self" where the
 * line would cross itself), the message to show, and for some reasons how many levels it's about: for "hill" how far
 * up the hill is, for "river" and "unsupported" how many whole levels the piece stands above the ground under it (see
 * `drawRefusal` in src/game/track-rules.ts).
 */
export interface DrawCheck {
  readonly reason: string;
  readonly message: string;
  readonly levels?: number;
}

/** The pieces a drawn line is made of: straights, and curves either way. */
export const DRAW_TYPES: readonly PieceTypeId[] = ["straight-216", "straight-144", "straight-108", "straight-54", "curve-large", "curve-wide", "curve-small"];

/**
 * The standard pieces: the tray's Long, Medium and Short straights and its Curve (src/ui/tray-catalogue.ts), a wooden
 * railway box's own sizes. The Mini, the tight and wide curves (and the Auto piece's cut lengths) are for where they're
 * needed: a line closing onto a station or depot prefers the standard ones when they fit about as well (see `ODD_COST`).
 */
export const STANDARD_DRAW_TYPES: readonly PieceTypeId[] = ["straight-216", "straight-144", "straight-108", "curve-large"];

export interface DrawOptions {
  /** May this piece go here (the landscape, other track, the line's own pieces)? Null, or why not. */
  check?: (c: DrawCandidate, line: readonly DrawnPiece[]) => DrawCheck | null;
  /** Which types it may use now (Game mode: only those the player has left). */
  allow?: (type: PieceTypeId, line: readonly DrawnPiece[]) => boolean;
  /**
   * A piece that closes the line onto other track from `end` (the Auto piece's fit), or null. Laid instead of a drawn
   * piece if its far end lies on the stroke, and the line is then finished.
   */
  meet?: (end: DrawEnd, line: readonly DrawnPiece[]) => DrawCandidate | null;
  /** Does the line end on other track here (seated, so it's finished)? */
  closes?: (end: DrawEnd) => boolean;
  /**
   * The free ends of other track within `reach` (mm) of this end that the line could close onto (facing back toward
   * it, at its height), into `out`; how many. (See `DrawLine.closeBack`.)
   */
  freeEnds?: (end: DrawEnd, reach: number, out: DrawEnd[]) => number;
  /**
   * Does the line start on track that stays put (a free end of track, a branch's switch)? A line begun on open ground
   * (false) is free at its start, so it can give there too as it bends to close (see `DrawLine.flexOnto`). Default true.
   */
  startHeld?: boolean;
  /** Is a free end of other track within `reach` (mm) of this end (a piece from here might close onto it)? */
  nearTrack?: (end: DrawEnd, reach: number) => boolean;
  /** The ground's height (mm) at a plan point: where a ramp's far end will land (see `DrawLine.lands`). */
  groundAt?: (x: number, z: number) => number;
  /**
   * Is a plan point over the river (where track needs a bridge)? Lets a line on the ground see the water coming and
   * ramp up in time (see `DrawLine.waterAhead`).
   */
  wet?: (x: number, z: number) => boolean;
  /** Is a plan point on the map (track may go there)? A crossing keeps to it (see `DrawLine.startCrossing`). */
  onMap?: (x: number, z: number) => boolean;
  /** What to say when the line needed a special piece (a ramp, a bridge) it may not use: "Out of ramp pieces". */
  outOf?: (type: PieceTypeId) => string;
}

/** Stroke points closer than this (mm) to the last are skipped. */
const STEP = 6;
/**
 * Plans' costs this close are a tie (see `best`): what half a millimetre of stroke is worth (`ADVANCE`), less than a
 * finger can mean. (A camera a hair off after an undo moved QA's terrace 2 stroke by 6 µm, and that alone flipped which
 * of two equal plans won.)
 */
const TIE = 0.5 / 120;
/** Other track's free end this near (mm) the line's end: a piece that closes onto it is looked for (see `closeOnto`). */
const CLOSE_REACH = 300;
/**
 * Closing onto other track's free end when no one piece from the line's end seats on it (see `closeBack`): up to this
 * many of the line's last pieces may be laid again another way, as up to `CLOSE_LAY` pieces that do seat on it (or
 * three standard pieces that seat on it exactly: a straight and two curves, round a corner into a depot). Each new
 * piece's far end this close (mm) to the stroke (the last one, `MEET_REACH`), and at most `CLOSE_TRIES` such fits
 * checked against the map.
 */
const CLOSE_BACK = 2;
const CLOSE_LAY = 2;
const CLOSE_ON_REACH = 60;
/** ...or, for standard pieces that seat on it exactly, this close. */
const STANDARD_ON_REACH = 90;
const CLOSE_TRIES = 6;
/**
 * A fit's far end this close (mm, and radians) to the free end may still close: the line's joints give a little to
 * meet it (see `flexOnto`), each within the joint's play, as a near miss is closed when track is put down (the
 * editor's reach). At most `FLEX_TRIES` such fits are tried a time (each a fit of the line's joints).
 */
const FLEX_REACH = 60;
const FLEX_ANGLE = (12 * Math.PI) / 180;
const FLEX_TRIES = 2;
/** The line's last this many pieces give to close (see `flexOnto`), in at most this many sweeps a fit. */
const FLEX_DEPTH = 5;
const FLEX_SWEEPS = 80;
/** A joint closed this snug (mm, the turn counted at `SNUG_REACH` mm along the track) has no play to take up. */
const SNUG_MM = 0.3;
const SNUG_REACH = 30;
/** A line closed onto a free end this near (mm: the Auto straight's fit, see `auto-straight.ts`) is bent onto it. */
const SEAT_REACH = 2 * JOINT_POS_TOLERANCE;
/** Scoring a fit: a radian off the free end's heading counts as this many mm off it, and this many mm as one unit. */
const FLEX_TURN_MM = 180;
const FLEX_COST_MM = 15;
/** A fit that has to bend the line to close costs this much more than one that seats as it is. */
const FLEX_COST = 0.5;
/**
 * A line begun on open ground may move over this far (mm), its end turned no more than this off the free end's, to
 * seat its last piece there (see `shiftOnto`). Scored as a fit that seats as it is, each `SHIFT_COST_MM` mm of it one
 * unit, and `SHIFT_COST` more: less than bending its joints (`FLEX_COST`).
 */
const SHIFT_REACH = 45;
const SHIFT_TURN = (0.25 * Math.PI) / 180;
const SHIFT_COST_MM = 30;
const SHIFT_COST = 0.2;
/** The next piece is chosen once the stroke reaches this far (mm) past the line's end, so the look-ahead sees it. */
export const DRAW_LOOKAHEAD = 250;
/**
 * The finger counts as gone on from the line's end (to carry on after a retrace, or to grow the line when it lifts) once
 * it's this far (mm) ahead of it. (When it lifts, whether the last bit of stroke gets a piece is scored: see `stopCost`.)
 */
const FINISH_SLACK = 27;
/**
 * The finger this far (mm) to the side of the line's end, ahead of it, counts as going on from it whichever way it
 * moves: round a U-turn on the tight curve's radius (two radii across), it's well clear of the line, not coming back
 * over it.
 */
const TURNED_REACH = 1.7 * SMALL_CURVE_RADIUS;
/** Retracing: the finger this close (mm) to a piece's track, heading back along it, takes it (and those after) off. */
const TRIM_REACH = 30;
/** The finger counts as moving away from the line's end when its movement is at least this far (a cosine) that way. */
const AWAY = 0.3;
/** Pieces' tracks are kept as points this far apart (mm), for retracing. */
const TRACK_STEP = 12;
/** Scoring: how far off the stroke (mm), and off its heading (radians), count as one unit of cost. */
const SIGMA_D = 18;
const SIGMA_H = 0.3;
/** Scoring: this far off the stroke (mm), and off its heading (radians), costs nothing (a hand's wobble). */
const DEAD_D = 5;
const DEAD_H = 0.1;
/** The stroke's heading is taken across this much of it (mm) either side, or at least this much near its ends. */
const HEADING_HALF = 60;
const HEADING_MIN = 30;
/** Each mm the pair of pieces gains along the stroke is worth this much (long pieces win on a straight run). */
const ADVANCE = 1 / 120;
/** Overshooting the stroke's end when finishing: this many mm costs one unit. */
const SIGMA_OVER = 40;
/** Finishing: stopping this many mm short of the stroke's end costs one unit (so the line ends a little short, or a little past, whichever fits). */
const SIGMA_SHORT = 20;
const MAX_PIECES = 200;
/**
 * While drawing, at most this many pieces are laid on one pointer move. Normally a move lays one at most; after a stall
 * (a bend too sharp, the line waiting while the finger goes on) the stroke can come back within reach of the line a
 * metre or more past its end, and laying all of that at once took one move 4 to 6 ms in Node (20 pieces, each scored
 * and checked). The rest go down on the moves after, a piece a move (the ghosts run up to the finger), or when the
 * finger lifts.
 */
const GROW_PER_MOVE = 1;

/** A way `closeBack` might close: pieces taken back, pieces laid, the free end met, how, and what it costs. */
type Fit = { back: number; lay: DrawCandidate[]; to: DrawEnd; exact: boolean; shift: boolean; cost: number };

/** Thrown by a preview's close search when its slice is up (see `DrawLine.preview`, `closeBack`). */
const LATE = { late: true };

/** How many levels above the line's height the finger is looked for on a hill nearer the camera (see `onGround`). */
const SEEN_LEVELS = 4;
/** What each piece costs on its own: fewer pieces look calmer, and the tight curve and the mini are for when they're needed. */
const PIECE_COST: Partial<Record<PieceTypeId, number>> = { "straight-54": 0.9, "straight-108": 0.4, "curve-small": 1.5 };
const BASE_PIECE_COST = 0.3;
const pieceCost = (t: PieceTypeId): number => BASE_PIECE_COST + (PIECE_COST[t] ?? 0);
/**
 * Closing onto other track's free end (see `closeBack`), a piece that isn't standard (`STANDARD_DRAW_TYPES`) costs this
 * much more: where standard pieces close it about as well, they're the ones laid.
 */
const ODD_COST = 1;
const STANDARD = new Set<PieceTypeId>(STANDARD_DRAW_TYPES);
const drawCost = (t: PieceTypeId): number => pieceCost(t) + (STANDARD.has(t) ? 0 : ODD_COST);
/** The least any piece costs. */
const MIN_PIECE_COST = BASE_PIECE_COST;
/**
 * A piece bending another way from the one before it (another radius, or the other hand) costs this much, and going
 * from straight to curve or back this much: a steady curve stays one radius, and a straight run doesn't kink.
 */
const REBEND_COST = 0.4;
const RESHAPE_COST = 0.3;
/**
 * A mini straight next to a curve (in the pair scored) costs this much less: it's how a lead-in that isn't a sum of
 * the long pieces is made to fit before a bend, where a curve starting early would take the bend's radius wrong.
 */
const FIT_REBATE = 0.3;
/**
 * A curve's radius against the stroke's (see `radiusCost`): this far off (a log ratio, about 10%) costs nothing, and
 * each this much more costs one unit, so the curve a radius step off (the curve on a wide arc, or the wide curve on
 * the curve's arc, about 0.4) costs about 4.
 */
const DEAD_R = 0.1;
const SIGMA_R = 0.15;
/** The stroke bending less than this (curvature, 1/mm) over a curve's stretch is a straight run: its radius isn't asked. */
const FLAT_CURVATURE = 1 / (2 * WIDE_CURVE_RADIUS);
/**
 * The stroke past the line's end going round in a circle tighter than any curve: none of it further from the line's end
 * than this share of its length (a quarter circle of the tight curve's radius reaches about 0.9; a circle of 50 to 80 mm
 * reaches 0.3 to 0.4 once it's gone the look-ahead round; out and straight back reaches 0.5).
 */
const CIRCLING = 0.4;
/** A loop's end this close (radians, and `MEET_REACH` mm) to its start, running its way, is back at it. */
const SNAP_BACK_H = 0.1;
/** A closing piece is laid when its far end is this close (mm) to the stroke drawn so far. */
const MEET_REACH = 40;
/**
 * A straight stroke (see `DrawLine.flatStroke`): no point of it further than this (mm), or this share of its length, off
 * its chord, over at least `FLAT_SPAN` mm. It's looked at from where the straight run began, or `FLAT_BACK` mm behind
 * where the line has got to on it, up to its end, but over no more than `FLAT_WINDOW` mm.
 */
const FLAT_DEV = 16;
const FLAT_SAG = 0.03;
const FLAT_SPAN = 200;
const FLAT_BACK = 60;
const FLAT_WINDOW = 700;
/** A line running the stroke's way (this close, radians) and on it (this close, mm) is left to the usual scoring. */
const FLAT_ON_H = 0.06;
const FLAT_ON_D = 15;
/**
 * Along a straight stroke the line may lie this far (mm) to either side of it for nothing; each `BAND_SIGMA` mm further
 * costs one unit (at each piece's end, and where a curve lies furthest off). A curve there costs `BAND_CURVE` more
 * than its piece does (it steps the line back toward the finger, so fewer is calmer). Plans are looked at this many
 * pieces ahead.
 */
const BAND = 50;
const BAND_SIGMA = 5;
const BAND_CURVE = 1;
/** The tight curve, a kink in a straight line, costs this much more there. */
const BAND_TIGHT = 2;
/** A curve straight after another (a step with no straight between) costs this much more: a run of them is a snake. */
const BAND_PAIR = 1.5;
/**
 * A curve of another kind than the staircase's curve before it costs this much more there: the steps alike (QA: s108
 * wide s144 large~ s108), where they fit about as well.
 */
const BAND_MIX = 0.5;
/**
 * The staircase's step after a piece (see `BAND_MIX`): a curve starts one (its bend), unless it ends one (it turns back
 * from the step's first curve, `step`); a straight carries it on, unless one already came between (`prev` 0).
 */
const stepAfter = (step: number, bend: number, prev: number): number => (bend ? (step && Math.sign(step) !== Math.sign(bend) ? 0 : bend) : prev ? step : 0);
/** The mini straight costs this much more there (a step is cleaner without one). */
const BAND_MINI = 1;
/**
 * Finishing, a plan that ends on a curve costs this much more: the line would end turned off the stroke's way, a step
 * begun and not finished, only to put its end a little nearer where the finger lifted (anywhere in the band will do).
 */
const BAND_LAST_CURVE = 3;
/** Finishing, each this much (mm) further than half the band off the stroke's end costs one unit. */
const BAND_STOP = 25;
/** Finishing, each this much (mm) past the stroke's end costs one unit. */
const BAND_OVER = 30;
const FLAT_DEPTH = 3;
/**
 * At most this many pieces are looked at in one plan search (with 7 types, three deep is 399 at most; cutting branches
 * that can't win leaves far fewer). Past it the best plan found so far is laid.
 */
const FLAT_NODES = 400;
/** While drawing, a plan should leave the line able to run on straight this far (mm) in the band. */
const FLAT_RUN = 100;
/**
 * Special pieces (see `DrawLine.special`): one comes in only where the plain piece chosen is refused for its reason (a
 * hill, the river, nothing underneath), and only if its far end is this close (mm) to the stroke, ahead of where the
 * line has got to.
 */
const SPECIAL_REACH = 45;
/**
 * Coming down, further off is fine (coming down is never pointless: with no risers in a drawn line, the only other
 * way is a red ghost, or bridges on over dry land); the stroke's taken up again after it.
 */
const DOWN_REACH = 70;
/**
 * Going up for the river, likewise: the line on a staircase of straights along a slanted stroke (the usual swipe up the
 * screen is about 23° off the grid) can be this far off the finger where the ramp goes, and the bridges after it bring
 * it back.
 */
const RIVER_REACH = 90;
/**
 * On the ground, the stroke ahead is looked at this far (mm) past where the piece chosen would end, plus a ramp's
 * length, for water: if it's there, a ramp goes up now, while there's room for it before the bank. Every this many mm.
 */
const APPROACH_SLACK = 30;
/** Crossing the river: how far (mm) along each eighth the water is looked for, and the most bridges laid in one crossing. */
const CROSS_LOOK = 2000;
/** A large curve's chord (mm): about what turning onto a crossing's eighth takes. */
const LARGE_CURVE_CHORD = 2 * LARGE_CURVE_RADIUS * Math.sin(Math.PI / 8);
const MAX_CROSSING = 12;
const APPROACH_STEP = 24;
/** Straights that may go first, so that a ramp after them lands where it should (see `DrawLine.fill`), shortest first. */
const FILLERS: readonly PieceTypeId[] = ["straight-54", "straight-108", "straight-144", "straight-216"];
/** A ramp's far end is looked at for the ground this far (mm) on past it. */
const LAND_PROBE = 8;
/** Is a laid piece a ramp going up the way the line runs? */
const climbs = (p: DrawnPiece): boolean => p.type === "ramp" && p.end.y > p.y + 1;
const EIGHTH = Math.PI / 4;
const SIN_EIGHTH = Math.sin(EIGHTH);
const COS_EIGHTH = Math.cos(EIGHTH);

/**
 * Every way each piece type can seat on `end`, mirrored or not. Any two ends join, but each drawn piece has a peg end
 * and a hole end, so it's seated through the end of the other kind: through the same kind would be the same shape
 * again (a straight or curve the other way round), only with its peg and hole swapped.
 */
export function candidatesFrom(end: DrawEnd, types: readonly PieceTypeId[] = DRAW_TYPES): readonly DrawCandidate[] {
  // (Kept for each end, by the types asked for: the line looks from the same ends on every move, its ghosts worked out
  // afresh each time, and a candidate's own end is kept the same way, so a search a few pieces deep is made once.)
  let known = candidateMemo.get(end);
  if (!known) candidateMemo.set(end, (known = new Map()));
  const key = types === DRAW_TYPES ? "" : types.join(",");
  const had = known.get(key);
  if (had && had.x === end.x && had.z === end.z && had.heading === end.heading && had.y === end.y && had.kind === end.kind) return had.out;
  const out = candidatesAt(end, types);
  known.set(key, { x: end.x, z: end.z, heading: end.heading, y: end.y, kind: end.kind, out });
  return out;
}

const candidateMemo = new WeakMap<DrawEnd, Map<string, { x: number; z: number; heading: number; y: number; kind: ConnectorKind; out: readonly DrawCandidate[] }>>();

function candidatesAt(end: DrawEnd, types: readonly PieceTypeId[]): DrawCandidate[] {
  const out: DrawCandidate[] = [];
  const seat: Pose = { x: end.x, z: end.z, heading: end.heading + Math.PI };
  for (const type of types) {
    const base = getPieceDef(type, false);
    for (const flipped of base.flippable ? [false, true] : [false]) {
      const def = getPieceDef(type, flipped);
      if (def.connectors.length !== 2) continue;
      const path = def.paths[0];
      const length = path.geom.kind === "line" ? path.geom.length : path.geom.kind === "arc" ? Math.abs(path.geom.radius * path.geom.sweep) : 0;
      for (let entry = 0; entry < 2; entry++) {
        const c = def.connectors[entry];
        if (c.kind === end.kind && def.connectors[1 - entry].kind !== end.kind) continue;
        const exit = 1 - entry;
        const pose = solveParentPose(c.pose, seat, { x: 0, z: 0, heading: 0 });
        const y = end.y - c.y;
        const e = def.connectors[exit];
        const w = transformPose(pose, e.pose, { x: 0, z: 0, heading: 0 });
        out.push({ type, flipped, pose, y, entry, exit, length, end: { x: w.x, z: w.z, heading: w.heading, y: y + e.y, kind: e.kind } });
      }
    }
  }
  return out;
}

/** A ramp seated on `end`, going up (its foot on it) or down (its top on it), or null. */
function rampFrom(end: DrawEnd, up: boolean): DrawCandidate | null {
  for (const c of candidatesFrom(end, ["ramp"])) if (up ? c.end.y > end.y + 1 : c.end.y < end.y - 1) return c;
  return null;
}

/** A string's 32-bit FNV-1a hash. */
function hashString(t: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The most answers `remembered` keeps for a line (then it starts again). */
const REMEMBERED = 20000;

/**
 * A line's options, the answers it asks for again and again kept for the stroke: whether a piece may go somewhere (the
 * land and other track don't change while a line is drawn; the line's own pieces are part of the question), the free
 * ends near an end, and where the river is. The ghosts are worked out afresh on every move (`DrawLine.preview`),
 * mostly from the same pieces in the same places as the move before.
 */
function remembered(options: DrawOptions): DrawOptions {
  const { check, freeEnds, wet } = options;
  // (The line asked about by where every piece of it is, as a hash: by its length and last two pieces only, a line
  // moved over or relaid further back read as the same line. Its pieces are made afresh on each move, so by place, not
  // by object; each piece's hashed once, and each array's hash kept while its pieces are the same objects.)
  const pieceHashes = new WeakMap<DrawnPiece, number>();
  const pieceHash = (p: DrawnPiece): number => {
    let h = pieceHashes.get(p);
    if (h === undefined) {
      h = hashString(`${p.type}|${p.flipped}|${p.pose.x}|${p.pose.z}|${p.pose.heading}|${p.y}`);
      pieceHashes.set(p, h);
    }
    return h;
  };
  const lineHashes = new WeakMap<readonly DrawnPiece[], { of: DrawnPiece[]; key: string }>();
  const lineKey = (line: readonly DrawnPiece[]): string => {
    const had = lineHashes.get(line);
    if (had && had.of.length === line.length && had.of.every((p, i) => p === line[i])) return had.key;
    // (Two 32-bit hashes of the pieces in order.)
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (const p of line) {
      const h = pieceHash(p);
      a = Math.imul(a ^ h, 0x01000193);
      b = Math.imul(b + h, 0x85ebca6b) ^ (b >>> 13);
    }
    const key = `${line.length}|${a >>> 0}|${b >>> 0}`;
    lineHashes.set(line, { of: line.slice(), key });
    return key;
  };
  const checks = new Map<string, DrawCheck | null>();
  const ends = new Map<string, DrawEnd[]>();
  const wets = new Map<number, Map<number, boolean>>();
  let wetCount = 0;
  return {
    ...options,
    wet: wet
      ? (x, z) => {
          let row = wets.get(x);
          const known = row?.get(z);
          if (known !== undefined) return known;
          const w = wet(x, z);
          if (wetCount >= REMEMBERED) {
            wets.clear();
            wetCount = 0;
            row = undefined;
          }
          if (!row) wets.set(x, (row = new Map()));
          row.set(z, w);
          wetCount++;
          return w;
        }
      : undefined,
    check: check
      ? (c, line) => {
          const key = `${c.type}|${c.flipped}|${c.entry}|${c.pose.x}|${c.pose.z}|${c.pose.heading}|${c.y}|${lineKey(line)}`;
          const known = checks.get(key);
          if (known !== undefined) return known;
          const why = check(c, line);
          if (checks.size >= REMEMBERED) checks.clear();
          checks.set(key, why);
          return why;
        }
      : undefined,
    freeEnds: freeEnds
      ? (e, reach, out) => {
          const key = `${e.x}|${e.z}|${e.heading}|${e.y}|${reach}`;
          let found = ends.get(key);
          if (!found) {
            freeEnds(e, reach, out);
            found = out.map((t) => ({ ...t }));
            if (ends.size >= REMEMBERED) ends.clear();
            ends.set(key, found);
          }
          out.length = 0;
          for (const t of found) out.push(t);
          return out.length;
        }
      : undefined,
  };
}

/** A run of track following a stroke: points go in as the finger moves; pieces come out behind it. */
export class DrawLine {
  readonly pieces: DrawnPiece[] = [];
  /** Stroke points (mm) and the distance along the stroke to each. */
  private xs: number[] = [];
  private zs: number[] = [];
  private ss: number[] = [];
  /** How far along the stroke the line's end has got. */
  private progress = 0;
  /** The line has stopped: at a piece that can't go there, or on other track. */
  stopped: "blocked" | "closed" | null = null;
  /**
   * Closed back round onto its own start (`closeOnStart`): that joint's play isn't taken up here (see `fitted`).
   */
  private loop = false;
  /**
   * Are the line's pieces fitted, joint play and all, as they should go down (see `closedOnto`)? Not a loop closed on
   * its own start: the editor spreads that joint's play once it's down.
   */
  get fitted(): boolean {
    return !this.loop;
  }
  /** A piece the line would have used but the player has none of left (Game mode), or null. */
  refused: PieceTypeId | null = null;
  /**
   * Crossing the river from the ground (see `cross`): the eighth it crosses on, square to the water as near as the stroke
   * lets it, and how far it's got: turning onto that eighth on dry land, running up to the bank, over (a ramp up, then
   * bridges), then a ramp down; and how many bridges are down.
   */
  private crossing: { heading: number; phase: "turn" | "run" | "over"; bridges: number } | null = null;
  /** Come off a crossing and not yet back in a straight stroke's band (see `chooseFlat`). */
  private offBand = false;
  /** Fits that didn't close (see `closeBack`), while the line's last piece was `of` (undefined: none). */
  private unclosed: { of: DrawnPiece | undefined; keys: Set<string> } = { of: undefined, keys: new Set() };
  /**
   * A preview's step cut short (see `preview`): the fits its close search tried (whether each was bent to fit), which
   * the step taken again counts as tried without trying them again (see `closeBack`).
   */
  private tried = new Map<string, boolean>();
  /** The next close search takes up one cut short (its `tried`, its `search`), rather than beginning afresh. */
  private resuming = false;
  /** A close search cut short (see `closeBack`): the fits found so far, where it had got to, whether it found them all. */
  private search: { fits: Fit[]; next: number; done: boolean } | null = null;
  /** When a preview's slice is up (`performance.now()`): its close search stops there, after a try (see `closeBack`). */
  private until = Infinity;
  /** The special piece the piece being placed needed but may not use (see `want`), or null. */
  private wanted: PieceTypeId | null = null;

  /** The height (mm) the finger is read at (see `addSeen`). */
  private seen: number;
  /** Where the finger last was (for the way it's moving), whether or not that went into the stroke. */
  private fx: number;
  private fz: number;
  /**
   * Going back over the line: pieces were taken off. Nothing grows (while drawing, or when the finger lifts) until the
   * finger has gone forward past the line's end again; the stroke then carries on from there.
   */
  private retreating = false;
  /** Set by `headingAt`: where along the stroke the heading it gave is true. */
  private headingTrueAt = 0;
  /** A move's piece budget (`GROW_PER_MOVE`) ran out with the stroke still reaching past the look-ahead: more to lay. */
  private backlog = false;
  /** Where along the stroke the straight run the line is on began (see `flatStroke`), or null. */
  private runFrom: number | null = null;
  /** `tailHeading` as it was when the stroke had `tailAt` points (-1: not yet worked out). */
  private tailAt = -1;
  private tail = 0;
  /** The straight stroke's chord (set by `flatStroke`): a point on it and the way it runs. */
  private readonly chord = { x: 0, z: 0, ux: 1, uz: 0 };

  private readonly options: DrawOptions;

  constructor(
    readonly start: DrawEnd,
    options: DrawOptions = {},
  ) {
    this.options = remembered(options);
    this.seen = start.y;
    this.push(start.x, start.z);
    this.fx = start.x;
    this.fz = start.z;
  }

  /** Where the line has got to. */
  get end(): DrawEnd {
    return this.pieces.length ? this.pieces[this.pieces.length - 1].end : this.start;
  }

  /** Where the stroke has got to: the finger's last point in it. */
  get tip(): { x: number; z: number } {
    const n = this.xs.length - 1;
    return { x: this.xs[n], z: this.zs[n] };
  }

  /** The stroke's length so far (mm). */
  get strokeLength(): number {
    return this.ss[this.ss.length - 1];
  }

  /** The finger has moved to (x, z): extend the stroke, take pieces off if it's retracing, and grow behind it. True if the pieces changed. */
  addPoint(x: number, z: number): boolean {
    if (Math.hypot(x - this.fx, z - this.fz) < STEP) return false;
    // The stroke's first points short of where the line starts (a branch's: the finger still by the line it left, the
    // switch's branch end ahead of it): waited out, as if the stroke began there. Taken as the stroke's way, they bent
    // it into an S-jog of two tight curves to come back onto the finger's line (QA: switch, curve, reversed curve).
    if (this.xs.length === 1) {
      const s = this.start;
      if ((x - s.x) * Math.cos(s.heading) + (z - s.z) * Math.sin(s.heading) < STEP) return false;
    }
    this.rev++;
    const before = this.pieces.length;
    // (Closing can lay the last piece or two again another way, or bend them, as many as before: see `closeBack`.)
    const lastBefore = this.pieces[before - 1];
    const trimmed = this.retrace(x, z);
    const mx = x - this.fx;
    const mz = z - this.fz;
    this.fx = x;
    this.fz = z;
    // Is the finger moving away from the line's end (any way: on, or off to a side to turn), or back toward it?
    const e = this.end;
    const ex = x - e.x;
    const ez = z - e.z;
    // (Ahead of the end, too: track only goes on forward from it, so behind it the finger is going back.)
    const ahead = ex * Math.cos(e.heading) + ez * Math.sin(e.heading);
    const away = ahead > 0 && (mx * ex + mz * ez) / (Math.hypot(mx, mz) * Math.hypot(ex, ez) || 1) > AWAY;
    if (this.retreating) {
      // Still going back, or not yet past the line's end: the stroke waits at the end. It carries on once the finger is
      // ahead of the end and moving away from it, whichever way (going back and drawing another way is a sharp turn).
      if (trimmed || ahead < FINISH_SLACK || !away) return trimmed;
      this.retreating = false;
    }
    this.push(x, z);
    // Coming back toward the end (turning round to retrace, the tip of a hairpin): no new ghost meanwhile (but pieces
    // already due, a move's budget having run out, still come). Round a U-turn as tight as the tight curve, though,
    // the finger past halfway round comes back toward the end a whole turn's width to its side, not back over the
    // line: it grows (QA: a one-stroke U of about 90 mm radius laid nothing).
    const turned = ahead > 0 && Math.abs(ez * Math.cos(e.heading) - ex * Math.sin(e.heading)) >= TURNED_REACH;
    if (away || turned || this.backlog) this.grow(false, GROW_PER_MOVE);
    return trimmed || this.pieces.length !== before || this.pieces[this.pieces.length - 1] !== lastBefore;
  }

  /** The finger has lifted: grow the line to the end of the stroke. True if the pieces changed. */
  finish(): boolean {
    const before = this.pieces.length;
    const lastBefore = this.pieces[before - 1];
    // As the ghosts showed it, if nothing has changed since (see `preview`): the preview worked out to the end.
    this.preview();
    this.adopt(this.previewed!);
    this.previewed = null;
    this.job = null;
    this.rev++;
    return this.pieces.length !== before || this.pieces[this.pieces.length - 1] !== lastBefore;
  }

  /**
   * What lifting the finger now would lay (`finish`), the line left as it is: the ghosts show these, and lifting the
   * finger then lays exactly them (`finish` takes this outcome as it is). (QA: the line grew its last stretch, or closed
   * onto a station's end another way, only once the finger lifted, so what went down wasn't what the ghosts showed.)
   *
   * Worked out on a copy of the line (`copy`), so nothing of it leaks back into the line; again only when the line has
   * changed since (`rev`). `budget` (ms): worked on for about that long and no more (a piece at least; none at 0),
   * carrying on where it left off on the next call (`previewDone` says whether it's caught up); until then it's the last
   * one worked out. (QA: worked out whole on every move, a move took 0.6 to 0.9 ms in the browser where it had taken 0.1 to
   * 0.2, and a fast flick far ahead of the line up to 32 ms: the line laid its backlog afresh on every move.) The answer
   * doesn't depend on how it was cut up (see `grow`'s `resumed`).
   */
  preview(budget = Infinity): readonly DrawnPiece[] {
    if (this.previewed && this.previewFor === this.rev) return this.previewed.pieces;
    if (budget <= 0) return this.previewed?.pieces ?? this.pieces;
    if (!this.job || this.job.for !== this.rev) {
      const line = this.copy();
      this.job = { line, for: this.rev, phase: line.backlog ? 0 : 1, resumed: false, steps: 0 };
    }
    const job = this.job;
    const until = budget === Infinity ? Infinity : performance.now() + budget;
    // (A piece at a time, at least one a call: pieces already due while drawing go down as they would have then, and
    // then the line grows to the stroke's end.)
    job.line.until = until;
    do {
      const finishing = job.phase === 1;
      // (A step whose close search runs out of time part way (see `closeBack`) leaves the line as it was and is taken
      // again on the next call, knowing the fits it found, those it tried and those that didn't close: so a close
      // search, the costliest step, is spread over calls.)
      try {
        job.line.grow(finishing, budget === Infinity ? Infinity : 1, job.resumed);
      } catch (e) {
        if (e !== LATE) throw e;
        DrawLine.cutShort++;
        job.line.resuming = true;
        return this.previewed?.pieces ?? this.pieces;
      }
      job.resumed = true;
      if (!job.line.backlog || ++job.steps >= MAX_PIECES) {
        job.resumed = false;
        job.steps = 0;
        job.phase++;
      }
    } while (job.phase < 2 && performance.now() < until);
    if (job.phase < 2) return this.previewed?.pieces ?? this.pieces;
    this.previewed = job.line;
    this.previewFor = this.rev;
    this.job = null;
    return this.previewed.pieces;
  }

  /** How many preview steps have been cut short and taken up again (for the tests). */
  static cutShort = 0;

  /** Has `preview` caught up with the line as it is now (what it returns is what lifting now would lay)? */
  get previewDone(): boolean {
    return !!this.previewed && this.previewFor === this.rev;
  }

  /** The finished line `preview` last worked out, and for which `rev`. */
  private previewed: DrawLine | null = null;
  private previewFor = -1;
  /** A preview being worked out (see `preview`): on a copy of the line as it was at `rev` `for`. */
  private job: { line: DrawLine; for: number; phase: number; resumed: boolean; steps: number } | null = null;
  /** Counts the line's changes: its stroke or its pieces (see `preview`). */
  private rev = 0;

  /** A copy of the line, to work on without changing it: its own stroke, pieces and state; the same options and caches. */
  private copy(): DrawLine {
    const c = Object.create(DrawLine.prototype) as DrawLine;
    Object.assign(c, this);
    const w = c as unknown as Record<string, unknown>;
    w.pieces = this.pieces.slice();
    w.xs = this.xs.slice();
    w.zs = this.zs.slice();
    w.ss = this.ss.slice();
    w.unclosed = { of: this.unclosed.of, keys: new Set(this.unclosed.keys) };
    w.tried = new Map();
    w.resuming = false;
    w.search = null;
    w.chord = { ...this.chord };
    w.crossing = this.crossing && { ...this.crossing };
    w.previewed = null;
    w.job = null;
    return c;
  }

  /** Take on a copy's state (see `copy`), as if this line had done what it did. */
  private adopt(c: DrawLine): void {
    const pieces = this.pieces;
    const { previewed, previewFor, job, rev } = this;
    Object.assign(this, c);
    const w = this as unknown as Record<string, unknown>;
    w.pieces = pieces;
    pieces.length = 0;
    for (const p of c.pieces) pieces.push(p);
    Object.assign(this, { previewed, previewFor, job, rev });
  }

  /** The pieces that may go down (up to the first one that can't). */
  placeable(): DrawnPiece[] {
    const out: DrawnPiece[] = [];
    for (const p of this.pieces) {
      if (p.blocked) break;
      out.push(p);
    }
    return out;
  }

  /** Is the finger going back over the line (taking pieces off, the line not growing till it heads on again)? */
  get goingBack(): boolean {
    return this.retreating;
  }

  /**
   * Is the line stuck behind the finger, though nothing's in the way? Either the stroke has gone well on past its end
   * (twice the look-ahead) and nothing fits it there (a corner sharper than any piece can turn), or it has gone round in
   * a circle tighter than any curve: at least the look-ahead of it, none of it far from the line's end (the line lays
   * a curve or so of it, and no more). Not while going back over the line.
   */
  get stalled(): boolean {
    const n = this.ss.length;
    if (this.stopped || this.retreating || n === 0) return false;
    const unlaid = this.ss[n - 1] - this.progress;
    if (unlaid > 2 * DRAW_LOOKAHEAD) return true;
    if (unlaid < DRAW_LOOKAHEAD) return false;
    const e = this.end;
    const reach = CIRCLING * unlaid;
    for (let i = n - 1; i >= 0 && this.ss[i] > this.progress; i--) if (Math.hypot(this.xs[i] - e.x, this.zs[i] - e.z) >= reach) return false;
    return true;
  }

  /**
   * Lifted (after `finish`), was the line left behind, nothing in its way: at least the look-ahead of the stroke not
   * laid, the finger let go well clear of the line's end (a corner or a circle tighter than any piece, the U of a
   * hairpin)? Not if it closed or stopped at something, or the finger came back over the line.
   */
  get leftBehind(): boolean {
    const n = this.ss.length;
    if (this.stopped || this.retreating || n === 0 || this.ss[n - 1] - this.progress < DRAW_LOOKAHEAD) return false;
    const e = this.end;
    return Math.hypot(this.xs[n - 1] - e.x, this.zs[n - 1] - e.z) >= 2 * FINISH_SLACK;
  }

  /** The stroke ahead of the line's end (not yet laid), as x, z pairs into `out`; returns how many points. */
  ahead(out: number[]): number {
    out.length = 0;
    const e = this.end;
    out.push(e.x, e.z);
    for (let i = 0; i < this.xs.length; i++) if (this.ss[i] > this.progress) out.push(this.xs[i], this.zs[i]);
    return out.length / 2;
  }

  /** The height (mm) the finger is read at (see `addSeen`). */
  get seenAt(): number {
    return this.seen;
  }

  /**
   * The finger moved, read on a level plane at a height (`read`: the screen point seen at that height on the map, or
   * null). It's read at the height of the ground the line has got to: up on a hilltop, the finger is over the hilltop.
   * When the line comes to rest on the ground at another height (up a ramp onto a hill, or down off raised track), the
   * stroke still ahead is moved to where it's seen at the new height (`shiftAhead`), once, so it runs on without a jump.
   * Up in the air (on a ramp up for the river, on bridges) it's read as it was: a straight stroke on the screen stays
   * straight on the map, and the bridges straight under it (re-read a level up and moved, the stroke ran a little to
   * one side of the line, which turned back to it over the water). The point read and whether the pieces changed.
   */
  addSeen(read: (height: number) => { x: number; z: number } | null): { p: { x: number; z: number } | null; changed: boolean } {
    const e = this.end;
    if (e.y !== this.seen && this.resting(e)) {
      const was = this.onGround(read, this.seen);
      const now = this.onGround(read, e.y);
      if (was && now) this.shiftAhead(now.x - was.x, now.z - was.z);
      this.seen = e.y;
      this.rev++;
    }
    const p = this.onGround(read, this.seen, true);
    return { p, changed: p ? this.addPoint(p.x, p.z) : false };
  }

  /**
   * The finger read at a height, or on the ground under it where that's higher (a hill ahead of the line, the finger
   * over its top: read on the plane at the line's height, it was seen beyond the hill, and the stroke doubled back
   * where it crossed onto it, a "too sharp" stall, QA N2). Two steps of looking at the ground under the point.
   *
   * `onward` (the finger's moves): a hill nearer the camera than the point read, seen from its high side, too. Read at
   * the line's height, the finger over its top was seen past it, on the low ground in front of it, back along the view
   * and off to one side, so the stroke jogged back; and by the map's edge, past the edge (QA N5, terrace 2 seen from the
   * west: the line curved away at its first level, s54 s54 curve-small, "That's past the edge of the map"). So if the
   * point read goes back against the line's way by more than a step, or off the map: the level up where the finger's
   * ray meets ground just that high and goes on, the nearest the finger, if one does; else, if the ray goes through a
   * hill on the way down (the point read is hidden behind it), nothing from this move (over a rise on the screen, where
   * no level's ground is under it); else the point read.
   */
  private onGround(read: (height: number) => { x: number; z: number } | null, height: number, onward = false): { x: number; z: number } | null {
    const groundAt = this.options.groundAt;
    const from = height;
    let p = read(height);
    for (let k = 0; k < 2 && p && groundAt; k++) {
      const g = groundAt(p.x, p.z);
      if (g <= height + 1) break;
      height = g;
      p = read(height);
    }
    if (!onward || !p || !groundAt) return p;
    // Going on the way the line's end points, or not back by more than a step's noise: as read. (The way the line
    // points, not the stroke's last steps: they may be a jump onto a level and back.)
    const e = this.end;
    const onMap = this.options.onMap;
    const off = !!onMap && !onMap(p.x, p.z);
    if (!off && (p.x - this.fx) * Math.cos(e.heading) + (p.z - this.fz) * Math.sin(e.heading) >= -STEP) return p;
    // Going back, or off the map: a level up where the finger's ray meets ground just that high, going on, the nearest
    // the finger, if any. Its ray through a hill on the way (the point read hidden behind it) but on no such level's
    // ground (over a rise on the screen): nothing taken from this move.
    let best: { x: number; z: number } | null = p;
    let bestD = Infinity;
    for (let k = 1; k <= SEEN_LEVELS; k++) {
      const level = (Math.floor((from + 1) / RISER_HEIGHT) + k) * RISER_HEIGHT;
      if (level <= height + 1) continue;
      const q = read(level);
      if (!q) continue;
      const g = groundAt(q.x, q.z);
      if (g >= level - 1 && bestD === Infinity) best = null;
      if (Math.abs(g - level) > 1 || (q.x - this.fx) * Math.cos(e.heading) + (q.z - this.fz) * Math.sin(e.heading) < -STEP) continue;
      const d = Math.hypot(q.x - this.fx, q.z - this.fz);
      if (d < bestD) {
        best = q;
        bestD = d;
      }
    }
    return best;
  }

  /** Does the line's end rest on the ground (not up on arches, a ramp's own support, or risers)? Yes if the ground isn't known. */
  private resting(e: DrawEnd): boolean {
    const groundAt = this.options.groundAt;
    if (!groundAt) return true;
    // (Just past the end: at a ramp's top end, the ground it runs onto.)
    return Math.abs(groundAt(e.x + Math.cos(e.heading) * LAND_PROBE, e.z + Math.sin(e.heading) * LAND_PROBE) - e.y) <= 1;
  }

  /**
   * The stroke ahead of the line's end (not yet laid), and where the finger is, moved by (dx, dz). The finger is seen
   * on the plane at the height the line has got to (up on a hilltop, it's over the hilltop); when the line climbs or
   * comes down a level, the points still ahead, seen at the old height, move to where they'd be seen at the new one,
   * so the stroke runs on without a jump in it.
   */
  shiftAhead(dx: number, dz: number): void {
    this.rev++;
    const n = this.xs.length;
    let k = n;
    while (k > 1 && this.ss[k - 1] > this.progress) k--;
    for (let i = k; i < n; i++) {
      this.xs[i] += dx;
      this.zs[i] += dz;
      this.ss[i] = this.ss[i - 1] + Math.hypot(this.xs[i] - this.xs[i - 1], this.zs[i] - this.zs[i - 1]);
    }
    this.fx += dx;
    this.fz += dz;
    this.tailAt = -1;
  }

  private push(x: number, z: number): void {
    this.tailAt = -1;
    const n = this.xs.length;
    this.ss.push(n === 0 ? 0 : this.ss[n - 1] + Math.hypot(x - this.xs[n - 1], z - this.zs[n - 1]));
    this.xs.push(x);
    this.zs.push(z);
  }

  /**
   * Going back over the line: if the finger is over one of its pieces, heading back the way the line runs there, that
   * piece and those after it come off (and the stroke goes back to where the line was before it).
   */
  private retrace(x: number, z: number): boolean {
    const dx = x - this.fx;
    const dz = z - this.fz;
    const len = Math.hypot(dx, dz);
    for (let k = 0; k < this.pieces.length; k++) {
      const t = this.pieces[k].track;
      let over = false;
      // Not its last few points: back at a joint, the piece before it stays.
      const upTo = t.length - 3 * Math.ceil(TRIM_REACH / TRACK_STEP);
      for (let i = 0; i < upTo && !over; i += 3) {
        if (Math.hypot(x - t[i], z - t[i + 1]) > TRIM_REACH) continue;
        // Heading back along the line (against the way it runs here).
        over = (dx * Math.cos(t[i + 2]) + dz * Math.sin(t[i + 2])) / len < -0.3;
      }
      // Laid along a straight stroke, off to its side: going back over the stroke it was laid for counts too.
      const p = this.pieces[k];
      if (!over && p.aside && (dx * Math.cos(t[2]) + dz * Math.sin(t[2])) / len < -0.3) {
        const to = k + 1 < this.pieces.length ? this.pieces[k + 1].points : this.xs.length;
        const last = to - Math.ceil(TRIM_REACH / STEP);
        for (let i = p.points; i < last && !over; i++) over = Math.hypot(x - this.xs[i], z - this.zs[i]) <= TRIM_REACH;
      }
      if (!over) continue;
      this.pieces.length = k;
      this.xs.length = this.zs.length = this.ss.length = p.points;
      this.tailAt = -1;
      this.progress = Math.min(p.from, this.strokeLength);
      this.stopped = null;
      this.loop = false;
      this.refused = null;
      this.retreating = true;
      this.crossing = null;
      this.backlog = false;
      this.runFrom = null;
      return true;
    }
    return false;
  }

  /**
   * Lay pieces along the stroke, up to `budget` of them (while drawing: see `GROW_PER_MOVE`). `resumed`: carrying on
   * from a call whose budget ran out (`preview`'s slices), as if it were the same call.
   */
  private grow(finishing: boolean, budget = Infinity, resumed = false): void {
    this.backlog = false;
    if (this.retreating) return;
    for (let guard = 0; guard < MAX_PIECES && !this.stopped && this.pieces.length < MAX_PIECES; guard++) {
      const left = this.strokeLength - this.progress;
      // Over the water when the finger lifts: the crossing is finished (the line comes down on the far bank).
      const over = this.crossing?.phase === "over";
      if (left < (finishing ? (over ? -Infinity : STEP) : DRAW_LOOKAHEAD)) {
        // While drawing, short of the look-ahead, the finger come to other track's free end: closed onto it now, so
        // the ghosts show the line as it will go down (QA: it closed only on the lift, another way than shown).
        if (!finishing && !this.crossing && guard === 0 && !resumed) this.closeHere(this.end, true);
        return;
      }
      if (guard >= budget) {
        this.backlog = true;
        return;
      }
      const end = this.end;
      if (this.crossing) {
        if (finishing && !over) {
          this.crossing = null;
          continue;
        }
        if (!this.cross()) return;
        continue;
      }
      // Finishing: only if the finger was let go a little way from the line's end, moving away from it (not coming back
      // to it, retracing, or round the tip of a hairpin).
      if (finishing && !this.leavingEnd(end)) return;
      if (this.closeHere(end, false)) return;
      // Finishing a loop that has come round to just short of its start, running its way: that's where it ends (a piece
      // more would go on across its first piece, and say so).
      if (finishing && this.backAtStart(end)) return;
      // Along a straight stroke, a staircase of straights within a band either side of it (QA N1); else, scored.
      const flat = this.flatStroke() ? this.chooseFlat(end, finishing) : undefined;
      const best = flat === undefined ? this.choose(end, finishing) : flat;
      if (!best) return;
      this.place(best.candidate, best.s, flat !== undefined, finishing);
      if (!this.stopped && this.options.closes?.(this.end)) this.closedOnto();
    }
  }

  /**
   * Close the line onto track it has come to, if a way of doing so fits (see `grow`): the Auto straight's fit onto a
   * free end, a piece back onto its own start, one piece onto a free end (`closeOnto`), or its last pieces laid again
   * (`closeBack`). True if the line is done for now (closed, or stopped). `early`: while drawing, short of the
   * look-ahead (nothing refused is laid then).
   */
  private closeHere(end: DrawEnd, early: boolean): boolean {
    // (Only if the finger has come to other track's free end, a piece or few on: else only back round onto the line's
    // own start. One look along the stroke for each free end near, on every move; the ways of closing cost far more.)
    if (!this.nearFreeEnd(end)) return this.closeOnStart(end);
    const met = this.options.meet?.(end, this.pieces);
    const near = met ? this.nearest(met.end.x, met.end.z, this.progress, this.progress + met.length * 1.6 + 40) : null;
    if (met && near && near.d < MEET_REACH && near.s <= this.strokeLength + MEET_REACH) {
      // (Refused, a straight a few mm into a station's end: the other ways of closing are looked for first.)
      const why = this.options.check?.(met, this.pieces) ?? null;
      if (!why || (!early && !this.options.freeEnds)) {
        const progress = this.progress;
        this.lay(met, near.s, false, why);
        if (this.stopped) return true;
        this.closedOnto();
        // (Its end left off the free end, bending the line onto it refused (into a house, say): the other ways of
        // closing are looked for instead, rather than leaving the editor to pull it shut once it's down.)
        const closes = this.options.closes;
        if (!this.options.freeEnds || !closes || closes(this.end)) return true;
        this.pieces.pop();
        this.progress = progress;
        this.stopped = null;
      }
    }
    // Back round to its own start: a piece that closes the loop there goes down, rather than one on past it.
    if (this.closeOnStart(end)) return true;
    // A piece that closes onto other track's free end here, its far end on the stroke: that, rather than a piece on
    // first (QA N5: 5 mm short of a station's end, a straight then a curve into the house beside it, where the one
    // curve closed).
    // (Begun on open ground, the one piece is weighed with the rest in `closeBack`: moved over a little, standard pieces
    // may seat where only a tight curve does as the line lies.)
    if (this.options.startHeld !== false && this.closeOnto(end)) return true;
    // None does: the line's last piece or two laid again another way so that it closes there (QA: a line drawn into a
    // station's end stopped 30 to 140 mm short of it, buffers facing, where no one piece's length would do).
    return this.closeBack();
  }

  /**
   * Has the stroke come to a free end of other track that the line could close onto from `end` (within `CLOSE_BACK`
   * pieces back and `CLOSE_LAY` on, see `closeBack`): within `MEET_REACH` and a joint's play of it, since the line's
   * last few pieces? True if it can't tell (no `freeEnds` option).
   */
  private nearFreeEnd(end: DrawEnd): boolean {
    const freeEnds = this.options.freeEnds;
    if (!freeEnds) return true;
    const ends = this.gateScratch;
    const k = this.pieces.length;
    // (From the line's end and the ends of its last pieces, as `closeBack` looks: the same answers, kept for each end.)
    for (let back = 0; back <= Math.min(CLOSE_BACK, k); back++) {
      const e = back === 0 ? end : k - back > 0 ? this.pieces[k - back - 1].end : this.start;
      const from = back === 0 ? this.progress : this.pieces[k - back].from;
      if (freeEnds(e, CLOSE_LAY * 216 + FLEX_REACH, ends) === 0) continue;
      for (const t of ends) if (this.nearest(t.x, t.z, from - 10, this.strokeLength).d < MEET_REACH + 2 * JOINT_POS_TOLERANCE) return true;
    }
    return false;
  }

  private readonly gateScratch: DrawEnd[] = [];

  /**
   * A loop come back round to the line's start: lay a piece that seats on it (`closes` says so), if one does and its far
   * end is on the stroke, and the line is closed. (Otherwise the stroke drawn a little past the start, the line would
   * take a piece on past it, across its own first piece.) True if it closed.
   */
  private closeOnStart(end: DrawEnd): boolean {
    const closes = this.options.closes;
    if (!closes || this.pieces.length < 2) return false;
    const s = this.start;
    if (Math.hypot(end.x - s.x, end.z - s.z) > 2 * DRAW_LOOKAHEAD) return false;
    const allow = this.options.allow;
    for (const c of candidatesFrom(end, allow ? DRAW_TYPES.filter((t) => allow(t, this.pieces)) : DRAW_TYPES)) {
      if (Math.hypot(c.end.x - s.x, c.end.z - s.z) > JOINT_POS_TOLERANCE || Math.abs(normalizeAngle(c.end.heading - s.heading)) > JOINT_ANGLE_TOLERANCE) continue;
      const near = this.nearest(c.end.x, c.end.z, this.progress - 10, this.progress + c.length * 1.6 + 40);
      if (near.d >= MEET_REACH || near.s > this.strokeLength + MEET_REACH) continue;
      const progress = this.progress;
      this.lay(c, near.s);
      if (!this.stopped && closes(c.end)) {
        this.stopped = "closed";
        this.loop = true;
        return true;
      }
      // Not closing after all (or in the way): as it was.
      this.pieces.pop();
      this.progress = progress;
      this.stopped = null;
    }
    return false;
  }

  /**
   * Other track's free end within a piece of the line's end: lay the piece that seats on it (`closes` says so), if one
   * does and its far end is on the stroke, and the line is closed. True if it closed. Only near track (one look for a
   * free end, `nearTrack`, before trying the pieces).
   */
  private closeOnto(end: DrawEnd): boolean {
    const closes = this.options.closes;
    if (!closes || !this.options.nearTrack?.(end, CLOSE_REACH)) return false;
    const allow = this.options.allow;
    const check = this.options.check;
    for (const c of candidatesFrom(end, allow ? DRAW_TYPES.filter((t) => allow(t, this.pieces)) : DRAW_TYPES)) {
      if (!closes(c.end)) continue;
      const near = this.nearest(c.end.x, c.end.z, this.progress - 10, this.progress + c.length * 1.6 + 40);
      if (near.d >= MEET_REACH || near.s > this.strokeLength + MEET_REACH) continue;
      if (check?.(c, this.pieces)) continue;
      this.lay(c, near.s);
      if (!this.stopped) this.closedOnto();
      return true;
    }
    return false;
  }

  /**
   * Other track's free end ahead (`freeEnds`), and no one piece from the line's end seats on it (`closeOnto`): take
   * back up to `CLOSE_BACK` of the line's last plain pieces (not a ramp or bridge, laid where it had to be) and lay up
   * to `CLOSE_LAY` plain pieces whose far end comes to that free end, each on the stroke. Within the joint's play it
   * seats as it is; a little further off (`FLEX_REACH`, `FLEX_ANGLE`), the line's joints each give a little to meet
   * it (`flexOnto`), as a wooden line does when pushed, the free end's track held where it is (a station, a depot).
   * The cheapest fit first: fewest pieces taken back, the calmest and standard pieces, nearest the free end and the stroke. True if
   * it closed (the line is then closed); else the line is as it was.
   */
  private closeBack(): boolean {
    const closes = this.options.closes;
    const freeEnds = this.options.freeEnds;
    // (Afresh, unless taking up one cut short: see `tried`.)
    const resume = this.resuming;
    if (!resume) this.tried = new Map();
    this.resuming = false;
    if (!closes || !freeEnds || this.crossing) return false;
    const n = this.pieces.length;
    const progress = this.progress;
    const all = this.pieces.slice();
    /** The line with its last `back` pieces taken back. */
    const keep = (back: number) => {
      this.pieces.length = 0;
      for (let i = 0; i < n - back; i++) this.pieces.push(all[i]);
    };
    // (Begun on open ground, the whole line may move a little to seat its last piece: see `shiftOnto`.)
    const loose = this.options.startHeld === false;
    /** A preview's slice up (see `preview`): the line as it was, what's been found kept for the next, and out. */
    const late = (state: { fits: Fit[]; next: number; done: boolean }): void => {
      if (performance.now() <= this.until) return;
      this.search = state;
      keep(0);
      this.progress = progress;
      this.stopped = null;
      throw LATE;
    };
    // (Taking up one cut short, from the line as it was then: the fits found so far, and where it had got to.)
    const was = resume ? this.search : null;
    this.search = null;
    const fits: Fit[] = was ? was.fits : [];
    const ends: DrawEnd[] = [];
    const from0 = was ? was.next : 0;
    for (let back = from0; !was?.done && back <= Math.min(CLOSE_BACK, n); back++) {
      if (back > 0 && (!DRAW_TYPES.includes(all[n - back].type) || all[n - back].blocked)) break;
      // (Each number of pieces taken back looked at in full; the slice up, the rest on the next.)
      if (back > from0) late({ fits, next: back, done: false });
      keep(back);
      const end = this.end;
      const from = back > 0 ? all[n - back].from : progress;
      if (freeEnds(end, CLOSE_LAY * 216 + FLEX_REACH, ends) === 0) continue;
      // (Only the free ends the finger has come to: a look along the stroke for each, before any piece is tried.)
      let k = 0;
      for (const t of ends) {
        const near = this.nearest(t.x, t.z, from - 10, this.strokeLength);
        if (near.d < MEET_REACH) ends[k++] = t;
      }
      ends.length = k;
      if (k === 0) continue;
      const types = this.allowed();
      const standard = types.filter((t) => STANDARD.has(t));
      // How far a piece's far end is from meeting one of those free ends (the turn counted at `FLEX_TURN_MM` a radian),
      // and that end, if the piece's end is within the flex of it and it's on the stroke drawn (the finger went to it).
      const meets = (c: DrawCandidate, s0: number): { to: DrawEnd; err: number; exact: boolean; shift: boolean; d: number } | null => {
        let best: { to: DrawEnd; err: number; exact: boolean; shift: boolean; d: number } | null = null;
        for (const t of ends) {
          if (Math.abs(t.y - c.end.y) > 2) continue;
          const pos = Math.hypot(t.x - c.end.x, t.z - c.end.z);
          const turn = Math.abs(normalizeAngle(t.heading - c.end.heading - Math.PI));
          if (pos > FLEX_REACH || turn > FLEX_ANGLE) continue;
          const err = pos + turn * FLEX_TURN_MM;
          if (best && err >= best.err) continue;
          const near = this.nearest(t.x, t.z, s0 - 10, s0 + c.length * 1.6 + 40 + FLEX_REACH);
          if (near.d >= MEET_REACH || near.s > this.strokeLength + MEET_REACH) continue;
          const exact = pos <= JOINT_POS_TOLERANCE && turn <= JOINT_ANGLE_TOLERANCE;
          best = { to: t, err, exact, shift: !exact && loose && pos <= SHIFT_REACH && turn <= SHIFT_TURN, d: near.d };
        }
        return best;
      };
      const push = (lay: DrawCandidate[], m: NonNullable<ReturnType<typeof meets>>, extra: number) => {
        let cost = back + extra + m.d / MEET_REACH + (m.exact ? m.err / FLEX_COST_MM : m.shift ? SHIFT_COST + m.err / SHIFT_COST_MM : FLEX_COST + m.err / FLEX_COST_MM);
        for (const c of lay) cost += drawCost(c.type);
        fits.push({ back, lay, to: m.to, exact: m.exact, shift: m.shift, cost });
      };
      // (The line as it is, bent to meet it.)
      if (back === 0 && n > 0) {
        const none = meets({ ...all[n - 1], length: 0 }, from);
        if (none && !none.exact) push([], none, 0);
      }
      for (const a of candidatesFrom(end, types)) {
        const one = meets(a, from);
        // (One piece seated as it is, from where the line has got to: that's `closeOnto`'s, unless the line is loose.)
        if (one && !(back === 0 && one.exact && !loose)) push([a], one, 0);
        const mid = this.nearest(a.end.x, a.end.z, from - 10, from + a.length * 1.6 + 40);
        // (Standard pieces that seat exactly may stray further from the stroke: QA, a corner drawn tighter than the
        // curve into a depot's end, where only a tight curve stayed near it and was bent to meet the end.)
        const near = mid.d <= CLOSE_ON_REACH;
        if (!near && (mid.d > STANDARD_ON_REACH || !STANDARD.has(a.type))) continue;
        for (const b of candidatesFrom(a.end, types)) {
          const two = meets(b, mid.s);
          if (two && (near || ((two.exact || two.shift) && STANDARD.has(b.type)))) push([a, b], two, mid.d / CLOSE_ON_REACH);
          // Three standard pieces that seat exactly, where no two do (a straight and the curve's two halves).
          if (!standard.length || !STANDARD.has(a.type) || !STANDARD.has(b.type)) continue;
          const mid2 = this.nearest(b.end.x, b.end.z, mid.s - 10, mid.s + b.length * 1.6 + 40);
          if (mid2.d > STANDARD_ON_REACH) continue;
          for (const c of candidatesFrom(b.end, standard)) {
            const three = meets(c, mid2.s);
            if (three?.exact || three?.shift) push([a, b, c], three, (mid.d + mid2.d) / CLOSE_ON_REACH);
          }
        }
      }
    }
    if (!was?.done) {
      fits.sort((p, q) => p.cost - q.cost);
      // (Found in full this time: the slice up, the tries on the next.)
      late({ fits, next: 0, done: true });
    }
    const check = this.options.check;
    let flexed = 0;
    // (A fit that didn't close isn't tried again while the line is as it is: on the next move, the next ones are.)
    if (this.unclosed.of !== all[n - 1]) this.unclosed = { of: all[n - 1], keys: new Set() };
    let tries = 0;
    let fresh = 0;
    for (const fit of fits) {
      if (tries >= CLOSE_TRIES) break;
      if (!fit.exact && !fit.shift && flexed >= FLEX_TRIES) continue;
      const key = `${fit.back}:${fit.lay.map((c) => `${c.type}${c.flipped ? "~" : ""}${c.entry}`).join(",")}:${fit.to.x.toFixed(1)},${fit.to.z.toFixed(1)}`;
      // (Tried already by this step, cut short in a preview's slice: counted as tried, as it was then.)
      const bent = this.tried.get(key);
      if (bent !== undefined) {
        tries++;
        if (bent) flexed++;
        continue;
      }
      if (this.unclosed.keys.has(key)) continue;
      // A fit tried already in this slice, and it's up: the rest on the next.
      if (fresh > 0) late({ fits, next: 0, done: true });
      fresh++;
      tries++;
      this.tried.set(key, !fit.exact && !fit.shift);
      keep(fit.back);
      this.progress = fit.back > 0 ? all[n - fit.back].from : progress;
      let ok = true;
      for (const c of fit.lay) {
        // (Moved over, the pieces are checked where they'll go: see `shiftOnto`.)
        if (!this.may(c.type) || (!fit.shift && check?.(c, this.pieces))) {
          ok = false;
          break;
        }
        const near = this.nearest(c.end.x, c.end.z, this.progress - 10, this.progress + c.length * 1.6 + 40);
        this.lay(c, near.s, false, null);
      }
      if (ok && fit.shift) ok = this.shiftOnto(fit.to);
      else if (ok && !fit.exact) {
        flexed++;
        ok = this.flexOnto(fit.to);
      }
      if (ok && closes(this.end)) {
        this.closedOnto();
        return true;
      }
      this.unclosed.keys.add(key);
    }
    // Nothing closed: the line as it was.
    keep(0);
    this.progress = progress;
    return false;
  }

  /**
   * The line has closed onto other track's free end, seated within the joint's play: it's finished, and the play at
   * that joint is taken up along its last pieces (`flexOnto`), as the editor would once they're down. Done here, the
   * ghosts show it, and what goes down is what they show (DrawHand puts the line down as it is: see
   * `Editor.placeRun`'s `fitted`). (QA: the editor spread the play only once the line was down, moving it up to 53 mm
   * off its ghosts.)
   */
  private closedOnto(): void {
    this.stopped = "closed";
    const e = this.end;
    const ends = this.seatScratch;
    // (The Auto straight's fit closes a little further off than the joint's play: that's taken up here too.)
    const n = this.options.freeEnds?.(e, SEAT_REACH, ends) ?? 0;
    let best: DrawEnd | null = null;
    let bestErr = Infinity;
    for (let i = 0; i < n; i++) {
      const t = ends[i];
      const pos = Math.hypot(t.x - e.x, t.z - e.z);
      const turn = Math.abs(normalizeAngle(t.heading - e.heading - Math.PI));
      if (Math.abs(t.y - e.y) > 2 || pos > SEAT_REACH || turn > FLEX_ANGLE || pos + turn * SNUG_REACH >= bestErr) continue;
      best = t;
      bestErr = pos + turn * SNUG_REACH;
    }
    // (Snug already: nothing to take up.)
    if (best && bestErr > SNUG_MM) this.flexOnto(best);
  }

  private readonly seatScratch: DrawEnd[] = [];

  /**
   * A line begun on open ground (`DrawOptions.startHeld` false), its end a little off `to` and facing it: the whole
   * line moved over, as it is, so its end seats there (no joint bent: QA, tight corners into a station's end from open
   * ground closed with tight curves and the straights bent, where standard pieces, moved over, seat exactly). Every
   * piece checked again where it would go; true if it did.
   */
  private shiftOnto(to: DrawEnd): boolean {
    const e = this.end;
    const dx = to.x - e.x;
    const dz = to.z - e.z;
    const check = this.options.check;
    const moved: DrawnPiece[] = [];
    for (const p of this.pieces) {
      const pose = { ...p.pose, x: p.pose.x + dx, z: p.pose.z + dz };
      const q: DrawnPiece = { ...p, pose, end: { ...p.end, x: p.end.x + dx, z: p.end.z + dz }, track: p.track.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dz : v)) };
      if (check?.({ ...q, length: 0 }, moved)) return false;
      moved.push(q);
    }
    for (let i = 0; i < moved.length; i++) this.pieces[i] = moved[i];
    return true;
  }

  /**
   * Bend the line's joints, each a little within the joint's play, so its end meets `to` (a free end of other track,
   * which stays where it is, as does the track the line starts from unless it began on open ground: see
   * `DrawOptions.startHeld`), as `relaxJoints` takes up a near miss when track is put down. True if it does: the
   * line's pieces are then where it put them. Else they're left as they were.
   */
  private flexOnto(to: DrawEnd): boolean {
    // (The same bend asked for again, the ghosts worked out afresh on the next move: as it came out then.)
    const key = `${to.x}|${to.z}|${to.heading}|${to.y}|${this.options.startHeld !== false}|${this.pieces.map((p) => `${p.type}${p.flipped}${p.entry}|${p.pose.x}|${p.pose.z}|${p.pose.heading}|${p.y}`).join(";")}`;
    const known = this.bends.get(key);
    if (known !== undefined) {
      if (!known) return false;
      for (const [i, pose] of known) this.pieces[i] = this.bentPiece(this.pieces[i], pose);
      return true;
    }
    const bent = this.bend(to);
    if (this.bends.size >= 64) this.bends.clear();
    this.bends.set(key, bent && bent.map((p, i) => [i, p.pose] as [number, Pose]).filter(([i]) => bent[i] !== this.pieces[i]));
    if (!bent) return false;
    for (let i = 0; i < bent.length; i++) this.pieces[i] = bent[i];
    return true;
  }

  /** Bends `flexOnto` worked out, by the line and the free end: the pieces that moved and where to, or null (none closes). */
  private readonly bends = new Map<string, [number, Pose][] | null>();

  /** A piece of the line moved to `pose` (its far end and track with it). */
  private bentPiece(p: DrawnPiece, pose: Pose): DrawnPiece {
    const def = getPieceDef(p.type, p.flipped);
    const w = transformPose(pose, def.connectors[p.exit].pose, { x: 0, z: 0, heading: 0 });
    const end = { ...p.end, x: w.x, z: w.z, heading: w.heading };
    return { ...p, pose, end, track: trackOf({ type: p.type, flipped: p.flipped, pose, y: p.y, entry: p.entry, exit: p.exit, length: 0, end }) };
  }

  /** `flexOnto`'s bend: the line's pieces as bent (those that didn't move the same objects), or null. */
  private bend(to: DrawEnd): DrawnPiece[] | null {
    const scratch = new Layout();
    const ids = this.pieces.map((p) => scratch.addPiece(p.type, p.pose, p.y, p.flipped));
    const last = this.pieces[this.pieces.length - 1];
    if (!last) return null;
    // The free end met, as the end of a piece that's held (seated on it, running on away from the line).
    const into = candidatesFrom({ ...to, heading: to.heading + Math.PI }, ["straight-54"])[0];
    const held = new Set([scratch.addPiece(into.type, into.pose, into.y, into.flipped)]);
    const target = connectorRef([...held][0], into.entry);
    if (this.options.startHeld !== false) {
      const s = this.start;
      const behind = candidatesFrom({ ...s, heading: s.heading + Math.PI, kind: s.kind === "peg" ? "socket" : "peg" }, ["straight-54"])[0];
      if (behind) held.add(scratch.addPiece(behind.type, behind.pose, behind.y, behind.flipped));
    }
    // (The line's last few pieces give, as the editor's near-miss closing would bend them; bounded, as this can run on
    // a pointer move.)
    const moved = relaxJoints(scratch, [ids[ids.length - 1]], (id) => held.has(id), [[connectorRef(ids[ids.length - 1], last.exit), target]], { depth: FLEX_DEPTH, sweeps: FLEX_SWEEPS });
    if (moved.size === 0) return null;
    // Each piece that moved checked again where it now is (on the land, clear of other track and of the line before
    // it): bent into a house or the station's platform, the line doesn't close that way.
    const check = this.options.check;
    const bent = this.pieces.slice();
    for (let i = 0; i < ids.length; i++) {
      const pose = moved.get(ids[i]);
      if (!pose) continue;
      const q = this.bentPiece(bent[i], pose);
      if (check?.({ ...q, length: 0 }, bent.slice(0, i))) return null;
      bent[i] = q;
    }
    return bent;
  }

  /** Has the line come back round to a little short of its start, running the way it set off? */
  private backAtStart(end: DrawEnd): boolean {
    const s = this.start;
    return this.pieces.length >= 2 && Math.hypot(end.x - s.x, end.z - s.z) < MEET_REACH && Math.abs(normalizeAngle(end.heading - s.heading)) < SNAP_BACK_H;
  }

  /** Is the finger, where it was let go, a little way ahead of the line's end and moving away from it? */
  private leavingEnd(end: DrawEnd): boolean {
    const n = this.xs.length - 1;
    const ax = this.xs[n] - end.x;
    const az = this.zs[n] - end.z;
    if (Math.hypot(ax, az) < FINISH_SLACK) return false;
    // Ahead of the end (track only goes on forward from it).
    if (ax * Math.cos(end.heading) + az * Math.sin(end.heading) <= 0) return false;
    // The finger's last few centimetres of movement.
    const back = this.pointAt(Math.max(0, this.strokeLength - 30));
    const mx = this.xs[n] - back.x;
    const mz = this.zs[n] - back.z;
    return mx * ax + mz * az > 0;
  }

  /** Lay a piece the line chose, or the special piece it needs there instead (see `special`), or show it can't go. */
  private place(c: DrawCandidate, s: number, aside: boolean, finishing: boolean): void {
    this.wanted = null;
    const why = this.options.check?.(c, this.pieces) ?? null;
    const refused = this.refused;
    if (why && this.special(why)) return;
    // The river just ahead on the ground: cross it square (see `cross`), rather than meeting the bank wherever the
    // stroke's staircase brings the line to it. Only near water: elsewhere a line costs what it did. (If the player
    // may not cross, the line just goes on: it wasn't refused anything. QA: a flat line said "No ramp pieces left".)
    if (!why && this.waterAhead(c) && this.startCrossing(false) && this.cross()) return;
    // Refused, and the piece that would have done (a ramp, a bridge) is one the player may not use: the plain piece
    // that goes there instead and best follows the stroke, its end on it, if one does (QA: in a flat gap between hills,
    // an imprecise stroke said "Ramp: not learned yet" when a straight would have gone through). Nothing was wanted
    // after all. (Only on this refusal: a dozen or so pieces checked, the cheapest first.)
    if (why && this.wanted) {
      const ok = (q: DrawCandidate) => this.onStroke(q, this.progress) !== null && !this.options.check?.(q, this.pieces);
      const clear = this.best(this.end, finishing, this.allowed(), ok);
      if (clear) {
        this.wanted = null;
        this.refused = refused;
        this.lay(clear.candidate, clear.s, false, null);
        return;
      }
    }
    // Refused, and the piece that would have done is one the player has none of: say that.
    const outOf = this.wanted && this.options.outOf ? this.options.outOf(this.wanted) : null;
    this.lay(c, s, aside, why && outOf ? { ...why, message: outOf } : why);
  }

  /** Lay a piece (checked here unless `why`, its check, is given). */
  private lay(c: DrawCandidate, s: number, aside = false, why: DrawCheck | null = this.options.check?.(c, this.pieces) ?? null): void {
    let points = 1;
    while (points < this.ss.length && this.ss[points] <= this.progress) points++;
    const blocked = why?.message ?? null;
    this.pieces.push({ type: c.type, flipped: c.flipped, pose: c.pose, y: c.y, entry: c.entry, exit: c.exit, end: c.end, from: this.progress, points, blocked, blockedBy: why?.reason ?? null, track: trackOf(c), aside });
    this.progress = Math.max(this.progress, s);
    if (blocked) this.stopped = "blocked";
  }

  /**
   * The piece the line chose was refused (`why`): the special piece a player would reach for there instead, if there
   * is one (N2 phase 1, see docs/superpowers/specs/2026-10-17-draw-junctions-ramps-bridges-design.md). A hill one level
   * up: a ramp. The river: a straight bridge, from a level up (a hilltop, raised track), or from the ground a crossing
   * (see `startCrossing`). Nothing underneath (off a hilltop, a bridge, raised track): a ramp down, or just after climbing for
   * the river (or where a ramp down would stand in it) a bridge on over. Each is laid only where its far end is on the stroke,
   * and only if the player has one (else `wanted` says which); at most two more placements are checked for it. True if
   * a piece was laid (or the last one replaced); false leaves the chosen piece to show why it can't go.
   */
  private special(why: DrawCheck): boolean {
    const levels = why.levels ?? 0;
    // (Two levels or more up where the piece chosen ends: a ramp onto the first, if one lands just on it; a long straight
    // across both rises of a terrace drawn straight at it was refused two levels up, where the line had climbed with
    // shorter pieces. QA N5, terrace 2: read where it was drawn, the stroke ran straight on into it.)
    if (why.reason === "hill") return levels === 1 ? this.rampUp(false) : levels > 1 && (this.rampUp(false, true) || this.climbBack());
    if (why.reason === "river") return levels >= 1 ? this.bridge() : (this.startCrossing() && this.cross()) || this.rampUp(true);
    if (why.reason !== "unsupported" || levels < 1) return false;
    // Just climbed to cross the river (the ramp's top end in the air, short of the water): on over it, not straight
    // back down. (Up on a hill too short to run on, it comes down again.)
    const last = this.pieces[this.pieces.length - 1];
    const groundAt = this.options.groundAt;
    if (last && climbs(last) && !(groundAt && groundAt(last.end.x, last.end.z) >= last.end.y - 1)) return this.bridge();
    const down = this.rampDown();
    if (down === "laid") return true;
    // Where a ramp down would stand in the river, or (just off a bridge) isn't on the stroke yet: a bridge on, till it is.
    return (down === "river" || (!!last && isBridge(last.type))) && this.bridge();
  }

  /** The plain pieces the line may use now. */
  private allowed(): readonly PieceTypeId[] {
    const allow = this.options.allow;
    return allow ? DRAW_TYPES.filter((t) => allow(t, this.pieces)) : DRAW_TYPES;
  }

  /** May the line use a piece of this type now (Game mode: has the player one left)? */
  private may(type: PieceTypeId, line: readonly DrawnPiece[] = this.pieces): boolean {
    return !this.options.allow || this.options.allow(type, line);
  }

  /** The line needed this piece and may not use it: said when it goes down. (False, for returning.) */
  private want(type: PieceTypeId): false {
    this.refused ??= type;
    this.wanted = type;
    return false;
  }

  /** Where along the stroke a special piece's far end comes (seated on the line where it had got to `from`), or null if that's off the stroke. */
  private onStroke(c: DrawCandidate, from: number, reach = SPECIAL_REACH): number | null {
    const near = this.nearest(c.end.x, c.end.z, from - 10, from + c.length * 1.6 + 40);
    return near.d <= reach && near.s > from + 1 ? near.s : null;
  }

  /**
   * Does a ramp's far end land where the line can go on from it: going up, on the hill (else the next piece is left in
   * the air short of it); going down, on ground no higher than its foot (else it's dug into the hilltop, and the next
   * piece runs into the hill). `exact`: on ground just as high as its end (not into a higher level). Yes if the ground
   * isn't known.
   */
  private lands(r: DrawCandidate, up: boolean, exact = false): boolean {
    const groundAt = this.options.groundAt;
    if (!groundAt) return true;
    const e = r.end;
    const g = groundAt(e.x + Math.cos(e.heading) * LAND_PROBE, e.z + Math.sin(e.heading) * LAND_PROBE);
    if (exact && Math.abs(g - e.y) > 1) return false;
    return up ? g >= e.y - 1 : g <= e.y + 1;
  }

  /**
   * A ramp up from the line's end, or else from one piece back in place of that piece (a plain straight): onto the hill
   * (its far end on it: else a straight first, see `fill`), or for the river, anywhere short of the water (a ramp
   * can't stand in it). A ramp cutting the ground from under other track shows red, and says so.
   */
  private rampUp(river: boolean, exact = false): boolean {
    if (!this.may("ramp")) return this.want("ramp");
    const reach = river ? RIVER_REACH : SPECIAL_REACH;
    const r = rampFrom(this.end, true);
    const s = r && this.onStroke(r, this.progress, reach);
    if (r && s !== null) {
      if (!river && !this.lands(r, true, exact)) return this.fill(true, exact);
      const why = this.options.check?.(r, this.pieces) ?? null;
      if (!why || why.reason === "undercut") {
        this.lay(r, s, false, why);
        if (river) this.overRiver();
        return true;
      }
    }
    // One piece back: that straight (or, for the river, curve) comes off and the ramp goes in its place (this move's
    // one change).
    const k = this.pieces.length;
    const last = this.pieces[k - 1];
    if (!last || last.blocked || !(last.type.startsWith("straight-") || (river && DRAW_TYPES.includes(last.type)))) return false;
    const before = this.pieces.slice(0, -1);
    const b = rampFrom(k > 1 ? before[k - 2].end : this.start, true);
    const sb = b && this.onStroke(b, last.from, reach);
    if (!b || sb === null || (!river && !this.lands(b, true, exact))) return false;
    const why = this.options.check?.(b, before) ?? null;
    if (why && why.reason !== "undercut") return false;
    this.pieces.pop();
    this.progress = last.from;
    this.lay(b, sb, false, why);
    if (river) this.overRiver();
    return true;
  }

  /**
   * Two levels up where the piece chosen would end, and no ramp from the line's end lands on the first (see `special`):
   * the line's last piece, a plain straight, taken off, and from there a ramp, or a shorter straight and then a ramp,
   * that lands just on the first level. False (the line as it was) if neither does.
   */
  private climbBack(): boolean {
    const last = this.pieces[this.pieces.length - 1];
    if (!last || last.blocked || !last.type.startsWith("straight-")) return false;
    const progress = this.progress;
    this.pieces.pop();
    this.progress = last.from;
    if (this.rampUp(false, true)) return true;
    this.pieces.push(last);
    this.progress = progress;
    return false;
  }

  /** Up a ramp for the river: straight bridges on, the way it points, then a ramp down (see `cross`). */
  private overRiver(): void {
    if (!this.stopped) this.crossing = { heading: this.end.heading, phase: "over", bridges: 0 };
  }

  /**
   * Begin crossing the river from the ground (QA N2: a slanted stroke met the bank on its staircase's curves, with no
   * room for a ramp, and curved bridges made an S over the water): of the two eighths either side of the stroke's way
   * on from the line's end, the one that crosses the least water (looked along from the end, every `APPROACH_STEP`
   * mm), the nearer the stroke's on a tie. False if neither meets water within `CROSS_LOOK`, or the line may have no
   * ramp or bridge (`want` says which, if the crossing is `needed`: not when it would only be begun ahead of time).
   */
  private startCrossing(needed = true): boolean {
    const wet = this.options.wet;
    if (!wet) return false;
    if (!this.may("ramp")) return needed && this.want("ramp");
    if (!this.may("bridge")) return needed && this.want("bridge");
    const e = this.end;
    // The stroke's way on: from the line's end to where the stroke has got (or the tail's heading, close in).
    const n = this.xs.length - 1;
    const far = Math.hypot(this.xs[n] - e.x, this.zs[n] - e.z) > 60;
    const way = far ? Math.atan2(this.zs[n] - e.z, this.xs[n] - e.x) : this.tailHeading();
    const lo = Math.floor(way / EIGHTH) * EIGHTH;
    let best: { heading: number; cost: number } | null = null;
    for (const heading of [lo, lo + EIGHTH]) {
      const cx = Math.cos(heading);
      const cz = Math.sin(heading);
      let from = -1;
      let to = -1;
      const onMap = this.options.onMap;
      for (let d = APPROACH_STEP; d <= CROSS_LOOK; d += APPROACH_STEP) {
        // (Off the map before it's over the water and down again, the crossing can't go this way: a ramp's length on.)
        if (onMap && !onMap(e.x + cx * d, e.z + cz * d)) break;
        if (to !== -1 && d > to + RAMP_LENGTH) break;
        const w = wet(e.x + cx * d, e.z + cz * d);
        if (w && from === -1) from = d;
        if (!w && from !== -1 && to === -1) to = d;
      }
      if (from === -1 || to === -1 || (onMap && !onMap(e.x + cx * (to + RAMP_LENGTH), e.z + cz * (to + RAMP_LENGTH)))) continue;
      // The far bank no more than a level up (the bridges' height), for a ramp's length: a higher hill there stops it.
      const groundAt = this.options.groundAt;
      let high = false;
      for (let d = to; d <= to + RAMP_LENGTH && groundAt && !high; d += APPROACH_STEP) high = groundAt(e.x + cx * d, e.z + cz * d) > e.y + RISER_HEIGHT + 1;
      if (high) continue;
      // Less water, nearer the stroke's way, and fewer curves to turn onto it (each needs room before the bank).
      const cost = to - from + 40 * Math.abs(normalizeAngle(heading - way)) + 100 * Math.round(Math.abs(normalizeAngle(heading - e.heading)) / EIGHTH);
      if (!best || cost < best.cost) best = { heading: normalizeAngle(heading), cost };
    }
    if (!best) return false;
    this.crossing = { heading: best.heading, phase: "turn", bridges: 0 };
    return true;
  }

  /**
   * The next piece of a crossing (see `startCrossing`), laid whatever the stroke does meanwhile: a curve onto its
   * eighth (on dry land), plain straights on along it while a ramp still fits before the water after them, a ramp up,
   * straight bridges, and a ramp down once one stands clear of the water with dry land after it. A piece that can't go
   * ends the crossing: it shows red (a curve or bridge), or the line goes back to choosing (no room for the ramp: it
   * says so as before). False if nothing was laid.
   */
  private cross(): boolean {
    const c = this.crossing!;
    const e = this.end;
    const check = (q: DrawCandidate) => this.options.check?.(q, this.pieces) ?? null;
    if (c.phase === "turn") {
      const d = normalizeAngle(c.heading - e.heading);
      if (Math.abs(d) < 0.01) c.phase = "run";
      else {
        const want = e.heading + Math.sign(d) * EIGHTH;
        const curve = (["curve-large", "curve-wide", "curve-small"] as const)
          .filter((t) => this.may(t))
          .map((t) => candidatesFrom(e, [t]).find((q) => Math.abs(normalizeAngle(q.end.heading - want)) < 0.01))
          .find((q) => q && !check(q));
        if (!curve) {
          this.crossing = null;
          return false;
        }
        this.lay(curve, this.alongStroke(curve), false, null);
        return true;
      }
    }
    const cx = Math.cos(c.heading);
    const cz = Math.sin(c.heading);
    // Dry along the eighth from the end for `len` mm (then at least the ramp's length more)?
    // (Across the track's width too: a slantwise bank meets its edge first.)
    const wet = this.options.wet;
    const dry = (len: number) => {
      if (!wet) return true;
      for (let d = APPROACH_STEP; d <= len; d += APPROACH_STEP)
        for (const side of [-20, 0, 20]) if (wet(e.x + cx * d - cz * side, e.z + cz * d + cx * side)) return false;
      return true;
    };
    if (c.phase === "run") {
      // On along the eighth to the bank: the longest straight after which a ramp still fits before the water.
      for (const type of ["straight-216", "straight-144", "straight-108", "straight-54"] as const) {
        if (!this.may(type)) continue;
        const q = candidatesFrom(e, [type])[0];
        if (!dry(q.length + RAMP_LENGTH + APPROACH_SLACK)) continue;
        if (check(q)) break;
        this.lay(q, this.alongStroke(q), false, null);
        return true;
      }
      const r = rampFrom(e, true);
      if (!r || check(r)) {
        // No room on this eighth: a ramp from the end as it is, or one piece back in that piece's place (see
        // `rampUp`, which goes on over from there).
        this.crossing = null;
        return this.rampUp(true);
      }
      this.lay(r, this.alongStroke(r), false, null);
      c.phase = "over";
      return true;
    }
    // Over: down as soon as a ramp clears the water, with dry land past its foot; else a bridge on.
    const down = rampFrom(e, false);
    if (c.bridges > 0 && down && dry(RAMP_LENGTH + APPROACH_SLACK + 48) && !check(down)) {
      this.lay(down, this.alongStroke(down), false, null);
      this.crossing = null;
      this.offBand = true;
      return true;
    }
    const b = candidatesFrom(e, ["bridge"])[0];
    if (!this.may("bridge") || c.bridges >= MAX_CROSSING) {
      if (!this.may("bridge")) this.want("bridge");
      this.crossing = null;
      return false;
    }
    const why = check(b);
    this.lay(b, this.alongStroke(b), false, why && this.wanted && this.options.outOf ? { ...why, message: this.options.outOf(this.wanted) } : why);
    if (why) this.crossing = null;
    else c.bridges++;
    return !why;
  }

  /** How far along the stroke a piece laid on a crossing gets (it needn't lie on the stroke: it goes on, past where the line had got). */
  private alongStroke(q: DrawCandidate): number {
    const near = this.nearest(q.end.x, q.end.z, this.progress - 10, this.progress + q.length * 1.6 + 40);
    return Math.max(near.s, this.progress + 1);
  }

  /**
   * On the ground, laying `c`: is there water on the stroke ahead within `c`'s length and a ramp's (and a little)? Then
   * after `c` there'd be no room to ramp up before the bank. A few ground lookups along the stroke drawn so far; none
   * if the map has no water to tell (`wet`).
   */
  private waterAhead(c: DrawCandidate): boolean {
    const { wet, groundAt } = this.options;
    if (!wet || !groundAt) return false;
    const e = this.end;
    if (Math.abs(groundAt(e.x, e.z) - e.y) > 1) return false;
    // (Room for a curve onto the crossing's eighth too.)
    const to = this.progress + c.length + RAMP_LENGTH + 2 * APPROACH_SLACK + LARGE_CURVE_CHORD;
    // (Past the stroke drawn so far, on the way the finger was going: the stroke runs only the look-ahead past the line.)
    const n = this.xs.length - 1;
    const h = this.tailHeading();
    for (let at = this.progress + APPROACH_STEP; at <= to; at += APPROACH_STEP) {
      const past = at - this.strokeLength;
      const p = past > 0 ? { x: this.xs[n] + Math.cos(h) * past, z: this.zs[n] + Math.sin(h) * past } : this.pointAt(at);
      // (Water level with the line: from a hilltop over it, a bridge goes straight on.)
      if (wet(p.x, p.z)) return groundAt(p.x, p.z) >= e.y - 1;
    }
    return false;
  }

  /** A ramp down from the line's end, landing on the ground (else a straight first, see `fill`). "river" if it would stand in the water. */
  private rampDown(): "laid" | "river" | "no" {
    if (!this.may("ramp")) return this.want("ramp") || "no";
    const r = rampFrom(this.end, false);
    const s = r && this.onStroke(r, this.progress, DOWN_REACH);
    if (!r || s === null) return "no";
    if (!this.lands(r, false)) return this.fill(false) ? "laid" : "no";
    const why = this.options.check?.(r, this.pieces) ?? null;
    if (why && why.reason !== "undercut") return why.reason === "river" ? "river" : "no";
    this.lay(r, s, false, why);
    return "laid";
  }

  /**
   * A ramp from the line's end would land short of the hill (or, coming down, still on the hilltop): the shortest
   * straight on from the end after which it would land, if that may go. The ramp follows on the next move.
   */
  private fill(up: boolean, exact = false): boolean {
    const groundAt = this.options.groundAt;
    if (!groundAt) return false;
    const end = this.end;
    const want = end.y + (up ? RISER_HEIGHT : -RISER_HEIGHT);
    const cos = Math.cos(end.heading);
    const sin = Math.sin(end.heading);
    for (const type of FILLERS) {
      if (!this.may(type)) continue;
      const f = candidatesFrom(end, [type])[0];
      const reach = f.length + RAMP_LENGTH + LAND_PROBE;
      const g = groundAt(end.x + cos * reach, end.z + sin * reach);
      if (up ? g < want - 1 : g > want + 1) continue;
      if (exact && Math.abs(g - want) > 1) continue;
      const s = this.onStroke(f, this.progress);
      if (s === null || this.options.check?.(f, this.pieces)) return false;
      this.lay(f, s, false, null);
      return true;
    }
    return false;
  }

  /**
   * A straight bridge on from the line's end, in place of the piece chosen: on the eighth the line is on (curved
   * bridges made an S over the water: QA N2), the stroke taken up again on dry land after. False if it can't stand
   * there (not a whole level up), or the player has none.
   */
  private bridge(): boolean {
    if (!this.may("bridge")) return this.want("bridge");
    const t = candidatesFrom(this.end, ["bridge"])[0];
    const why = this.options.check?.(t, this.pieces) ?? null;
    if (why && (why.reason === "unsupported" || why.reason === "river")) return false;
    this.lay(t, this.alongStroke(t), false, why);
    return true;
  }

  /** The best next piece: scored with the one after it (or alone, finishing near the stroke's end). */
  private choose(end: DrawEnd, finishing: boolean): { candidate: DrawCandidate; s: number } | null {
    const allow = this.options.allow;
    if (!allow) return this.best(end, finishing, DRAW_TYPES);
    const types = DRAW_TYPES.filter((t) => allow(t, this.pieces));
    // The piece it would have used, if it's one the player has run out of (Game mode): said when the line goes down.
    const ideal = types.length < DRAW_TYPES.length ? this.best(end, finishing, DRAW_TYPES) : null;
    if (ideal && !types.includes(ideal.candidate.type)) this.refused ??= ideal.candidate.type;
    return types.length === 0 ? null : this.best(end, finishing, types);
  }

  /**
   * Each first piece is scored with the best second piece after it: how near their ends lie to the stroke and its
   * heading, how much each turns against how much the stroke does along it, what each costs, and whether it bends
   * another way from the piece before; less the stroke the pair covers. Pairs that can't beat the best found so far,
   * by what they cost before their ends are looked for on the stroke, aren't scored further: the same choice, at a
   * fraction of the cost.
   */
  private best(end: DrawEnd, finishing: boolean, types: readonly PieceTypeId[], ok?: (c: DrawCandidate) => boolean): { candidate: DrawCandidate; s: number } | null {
    const firsts = candidatesFrom(end, types);
    let best: { candidate: DrawCandidate; s: number } | null = null;
    const k = this.pieces.length;
    const h0 = this.headingAt(this.progress);
    const before = k ? bendOf(this.pieces[k - 1].type, this.pieces[k - 1].end.heading - (k > 1 ? this.pieces[k - 2].end.heading : this.start.heading)) : 0;
    // Finishing, laying nothing more is a choice too: it costs how far the line's end is from the stroke's, and off its heading.
    let bestCost = finishing ? this.stopCost(end) : Infinity;
    // Each first piece on its own, then with each second piece: the cheapest first pieces first, so the pairs that
    // can't win are seen to sooner (see below). A tie (to within rounding: TIE) goes to the shorter first piece, which
    // commits the line to less before the next step looks again (two straights that cover the same ground tie
    // exactly, and which came out cheaper by a hair flipped with a camera a millionth of a millimetre off: QA's
    // terrace 2 drawn again took the long one first and had no room left for its second ramp); then to the pair that
    // comes first in the candidates' order (`rank`), as when they were taken in that order.
    let bestRank = -1;
    let bestLength = Infinity;
    const scored: { a: DrawCandidate; ea: ReturnType<DrawLine["endCost"]>; bendA: number; costA: number; i: number }[] = [];
    for (let i = 0; i < firsts.length; i++) {
      const a = firsts[i];
      const ea = this.endCost(a.end, this.progress, a.length, finishing);
      if (ea.back) continue;
      const bendA = bendOf(a.type, a.end.heading - end.heading);
      const costA =
        ea.cost + (finishing ? 0 : turnCost(a.end.heading - end.heading, ea.h - h0)) + this.radiusCost(bendA, this.progress, ea.s) + pieceCost(a.type) + (k ? rebendCost(before, bendA) : 0);
      scored.push({ a, ea, bendA, costA, i });
    }
    scored.sort((p, q) => p.costA - q.costA);
    const wins = (cost: number, rank: number, length: number) => {
      const tie = TIE;
      if (cost < bestCost - tie) return true;
      if (cost > bestCost + tie) return false;
      return length < bestLength || (length === bestLength && rank < bestRank);
    };
    // No pair from a first piece can beat the best so far, even with no cost of its own but its pieces' and covering
    // all the stroke there is (nor can the piece alone, finishing): skip it (most of the cost of a step is finding the
    // second pieces' ends on the stroke).
    const gain = (this.strokeLength - this.progress) * ADVANCE + FIT_REBATE;
    for (const { a, ea, bendA, costA, i } of scored) {
      if (costA - gain > bestCost + 1e-9) continue;
      // (Only pieces that may go there, if asked: checked once they might still win, as the dearest part.)
      if (ok && !ok(a)) continue;
      // Finishing, a piece may end the line on its own.
      if (finishing) {
        const cost = costA - (Math.min(ea.s, this.strokeLength) - this.progress) * ADVANCE;
        if (wins(cost, i * 64, a.length)) {
          bestCost = cost;
          bestRank = i * 64;
          bestLength = a.length;
          best = { candidate: a, s: ea.s };
        }
      }
      const room = this.strokeLength - ea.s;
      const seconds = candidatesFrom(a.end, types);
      for (let j = 0; j < seconds.length; j++) {
        const b = seconds[j];
        // (Likewise each second piece, by what it costs before its end is found.)
        const lower = costA + (pieceCost(b.type) + rebendCost(bendA, bendOf(b.type, b.end.heading - a.end.heading))) * (!finishing && room < b.length ? Math.max(0, room) / b.length : 1) - gain;
        if (lower > bestCost + 1e-9) continue;
        // While drawing, a second piece running on past the stroke drawn so far is scored where it reaches the stroke's
        // end: past there nobody knows yet where the finger goes.
        const cut = !finishing && room < b.length;
        const eb = cut ? this.endCost(poseAlong(b, Math.max(0, room), SCRATCH), ea.s, Math.max(0, room), false) : this.endCost(b.end, ea.s, b.length, finishing);
        if (eb.back) continue;
        const share = cut ? Math.max(0, room) / b.length : 1;
        const turnB = (cut ? SCRATCH.heading : b.end.heading) - a.end.heading;
        const bendB = bendOf(b.type, b.end.heading - a.end.heading);
        const costB = eb.cost + (finishing ? 0 : turnCost(turnB, eb.h - ea.h)) + this.radiusCost(bendB, ea.s, eb.s) + pieceCost(b.type) + rebendCost(bendA, bendB);
        // A mini straight fitting the line up to a bend, or on out of it.
        const fit = (a.type === "straight-54" && bendB !== 0) || (bendA !== 0 && b.type === "straight-54") ? FIT_REBATE : 0;
        const cost = costA + costB * share - fit - (Math.min(eb.s, this.strokeLength) - this.progress) * ADVANCE;
        if (wins(cost, i * 64 + 1 + j, a.length)) {
          bestCost = cost;
          bestRank = i * 64 + 1 + j;
          bestLength = a.length;
          best = { candidate: a, s: ea.s };
        }
      }
    }
    if (best && best.s <= this.progress + 1) return null;
    return best;
  }

  /**
   * Is the stroke ahead of the line's end straight (QA N1)? Its chord goes in `chord`. Straight: from where the run
   * began (or a little behind where the line has got to on the stroke) to its end, its first and last quarters' means
   * are well apart, and no point strays far off the line that fits its points best (least squares, so a hand's wobble
   * averages out).
   */
  private flatStroke(): boolean {
    const len = this.strokeLength;
    const s0 = Math.max(0, len - FLAT_WINDOW, Math.min(this.runFrom ?? Infinity, this.progress - FLAT_BACK));
    const span = len - s0;
    let flat = span >= FLAT_SPAN;
    if (flat) {
      this.meanPoint(s0, s0 + span / 4, 0);
      this.meanPoint(len - span / 4, len, 2);
      const cx = MEAN[2] - MEAN[0];
      const cz = MEAN[3] - MEAN[1];
      const cl = Math.hypot(cx, cz);
      if (cl < span / 2) flat = false;
      else {
        const c = this.chord;
        // The line that fits the points best (least squares: through their mean, along their spread's main axis), run
        // the stroke's way. (A hand's wobble tilts it less than it does the chord between two stretches' means.)
        let n = 0;
        let mx = 0;
        let mz = 0;
        for (let i = this.xs.length - 1; i >= 0 && this.ss[i] >= s0; i--, n++) {
          mx += this.xs[i];
          mz += this.zs[i];
        }
        mx /= n;
        mz /= n;
        let sxx = 0;
        let sxz = 0;
        let szz = 0;
        for (let i = this.xs.length - 1; i >= 0 && this.ss[i] >= s0; i--) {
          const dx = this.xs[i] - mx;
          const dz = this.zs[i] - mz;
          sxx += dx * dx;
          sxz += dx * dz;
          szz += dz * dz;
        }
        const axis = 0.5 * Math.atan2(2 * sxz, sxx - szz);
        const way = Math.cos(axis) * cx + Math.sin(axis) * cz < 0 ? -1 : 1;
        c.x = mx;
        c.z = mz;
        c.ux = way * Math.cos(axis);
        c.uz = way * Math.sin(axis);
        const reach = Math.max(FLAT_DEV, FLAT_SAG * span);
        for (let i = this.xs.length - 1; i >= 0 && this.ss[i] >= s0 && flat; i--) if (Math.abs((this.zs[i] - c.z) * c.ux - (this.xs[i] - c.x) * c.uz) > reach) flat = false;
      }
    }
    if (!flat) this.runFrom = null;
    else this.runFrom ??= Math.max(0, this.progress - FLAT_BACK);
    return flat;
  }

  /** The mean of the stroke's points from s0 to s1 (or the point at s0, if there are none), into MEAN[k] and MEAN[k + 1]. */
  private meanPoint(s0: number, s1: number, k: number): void {
    let lo = 0;
    let hi = this.ss.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ss[mid] < s0) lo = mid + 1;
      else hi = mid;
    }
    let x = 0;
    let z = 0;
    let n = 0;
    for (let i = lo; i < this.ss.length && this.ss[i] <= s1; i++, n++) {
      x += this.xs[i];
      z += this.zs[i];
    }
    if (n > 0) {
      MEAN[k] = x / n;
      MEAN[k + 1] = z / n;
    } else {
      const p = this.pointAt(s0);
      MEAN[k] = p.x;
      MEAN[k + 1] = p.z;
    }
  }

  /**
   * The next piece along a straight stroke (QA N1). The view is turned to the grid, so a straight swipe on the screen is
   * a straight line up to half an eighth of a turn off the eighths the track runs on, and followed closely it's a snake
   * of curves one way and the other. Instead the line runs straight on one of the two eighths either side of the
   * stroke's way, anywhere within `BAND` mm of it, and turns onto the other eighth (a curve, or a pair of curves either
   * way: a step) when going on would take it further off. Plans of up to `FLAT_DEPTH` pieces are scored (the band,
   * each piece's cost and its curves', less the stroke they cover; finishing, how far short of or past the stroke's end
   * they stop) and the best plan's first piece is laid (see `flatSearch`: branches that can't win are cut, and it looks
   * at no more than `FLAT_NODES` pieces). Undefined (score as usual) if the line isn't on one of those eighths, or is on
   * the stroke and running its way.
   */
  private chooseFlat(end: DrawEnd, finishing: boolean): { candidate: DrawCandidate; s: number } | null | undefined {
    const c = this.chord;
    const theta = Math.atan2(c.uz, c.ux);
    const lo = Math.floor(theta / EIGHTH) * EIGHTH;
    // On the stroke and running its way: the usual scoring keeps it on, and sees a bend coming sooner (a bend just
    // starting tilts the chord a little, so not quite its way).
    const y0 = (end.z - c.z) * c.ux - (end.x - c.x) * c.uz;
    if (Math.abs(normalizeAngle(end.heading - theta)) < FLAT_ON_H && Math.abs(y0) < FLAT_ON_D) return undefined;
    // Out of the band altogether, come off a river crossing (which keeps to its eighth): the usual scoring steers it
    // back to the finger (the band's plans would sooner stop, finishing, than pay to come back in).
    if (this.offBand && Math.abs(y0) > BAND) return undefined;
    this.offBand = false;
    let atLo: boolean;
    if (Math.abs(normalizeAngle(end.heading - lo)) < 0.01) atLo = true;
    else if (Math.abs(normalizeAngle(end.heading - lo - EIGHTH)) < 0.01) atLo = false;
    else return undefined;
    const allow = this.options.allow;
    const types = allow ? DRAW_TYPES.filter((t) => allow(t, this.pieces)) : DRAW_TYPES;
    const n = this.xs.length - 1;
    const alongEnd = (this.xs[n] - c.x) * c.ux + (this.zs[n] - c.z) * c.uz;
    const along0 = (end.x - c.x) * c.ux + (end.z - c.z) * c.uz;
    const k = this.pieces.length;
    const before = k ? bendOf(this.pieces[k - 1].type, this.pieces[k - 1].end.heading - (k > 1 ? this.pieces[k - 2].end.heading : this.start.heading)) : 0;
    const f = FLAT;
    f.cx = c.x;
    f.cz = c.z;
    f.ux = c.ux;
    f.uz = c.uz;
    f.theta = theta;
    f.lo = lo;
    const off = Math.min(EIGHTH, Math.max(0, normalizeAngle(theta - lo)));
    f.sinOff[0] = Math.sin(off);
    f.cosOff[0] = Math.cos(off);
    f.sinOff[1] = Math.sin(EIGHTH - off);
    f.cosOff[1] = Math.cos(EIGHTH - off);
    f.alongEnd = alongEnd;
    f.finishing = finishing;
    f.types = types;
    f.budget = FLAT_NODES;
    f.bestCost = finishing ? flatStop(along0, y0) : Infinity;
    f.bestType = null;
    f.bestTurn = 0;
    // (A step begun, its first curve one or two pieces back: its second is of its kind if that fits about as well.)
    const bendAt = (i: number) => (i < 0 ? 0 : bendOf(this.pieces[i].type, this.pieces[i].end.heading - (i > 0 ? this.pieces[i - 1].end.heading : this.start.heading)));
    let step = 0;
    for (let i = k - 1; i >= Math.max(0, k - 2); i--) {
      const b = bendAt(i);
      if (!b) continue;
      // (It turned back from the curve before it, at most a straight between: that step is done.)
      const a = bendAt(i - 1) || bendAt(i - 2);
      step = a && Math.sign(a) !== Math.sign(b) ? 0 : b;
      break;
    }
    flatSearch(FLAT_DEPTH, end.x, end.z, atLo, before, 0, null, 0, step);
    const bestType = f.bestType as PieceTypeId | null;
    const bestTurn = f.bestTurn;
    f.types = DRAW_TYPES;
    if (bestType === null) return finishing ? null : undefined;
    const want = end.heading + bestTurn * EIGHTH;
    const candidate = candidatesFrom(end, [bestType]).find((q) => Math.abs(normalizeAngle(q.end.heading - want)) < 0.01);
    if (!candidate) return undefined;
    const near = this.nearest(candidate.end.x, candidate.end.z, this.progress - 10, this.progress + candidate.length * 1.6 + 40);
    if (near.s <= this.progress + 1) return undefined;
    return { candidate, s: near.s };
  }

  /**
   * A curve (signed radius `bend`) against how tightly the stroke bends over the stretch it covers (s0 to s1, up to the
   * stroke's end). The stroke's curvature is measured over each half of the stretch (how far it turns along it), and the
   * tighter half counts: a curve starting early, on the straight before a bend, is held to the bend's radius, not to the
   * average of the straight and the bend (which a wider curve would fit, its ends on the stroke all the same). The
   * curvature is taken within the curves there are: tighter than the tight curve (a corner) asks for the tight curve,
   * gentler than the wide one for the wide one.
   */
  private radiusCost(bend: number, s0: number, s1: number): number {
    if (bend === 0) return 0;
    s1 = Math.min(s1, this.strokeLength);
    if (s1 - s0 < 20) return 0;
    const sign = bend > 0 ? 1 : -1;
    const h0 = this.headingAt(s0);
    const at0 = this.headingTrueAt;
    const hm = this.headingAt((s0 + s1) / 2);
    const atm = this.headingTrueAt;
    const h1 = this.headingAt(s1);
    const at1 = this.headingTrueAt;
    const k1 = atm - at0 > 5 ? (sign * normalizeAngle(hm - h0)) / (atm - at0) : 0;
    const k2 = at1 - atm > 5 ? (sign * normalizeAngle(h1 - hm)) / (at1 - atm) : 0;
    const k = Math.max(k1, k2);
    if (k < FLAT_CURVATURE) return 0;
    const ratio = Math.min(1 / SMALL_CURVE_RADIUS, Math.max(1 / WIDE_CURVE_RADIUS, k)) * Math.abs(bend);
    const err = Math.max(0, Math.abs(Math.log(ratio)) - DEAD_R);
    return (err / SIGMA_R) ** 2;
  }

  /** Finishing: what it costs to end the line at `e`, short of the stroke's end. */
  private stopCost(e: DrawEnd): number {
    const n = this.xs.length - 1;
    const dh = Math.max(0, Math.abs(normalizeAngle(e.heading - this.headingAt(this.strokeLength))) - DEAD_H);
    return (Math.hypot(this.xs[n] - e.x, this.zs[n] - e.z) / SIGMA_SHORT) ** 2 + (dh / SIGMA_H) ** 2;
  }

  /**
   * How far an end lies from the stroke, and off its heading there, searching the stroke from `from` up to a little
   * past one piece's length. Past the stroke's end it carries on straight (the way the finger was going); finishing,
   * that overshoot costs.
   */
  private endCost(e: { x: number; z: number; heading: number }, from: number, length: number, finishing: boolean): { cost: number; s: number; h: number; back: boolean } {
    const near = this.nearest(e.x, e.z, from - 10, from + length * 1.6 + 40);
    const hs = this.headingAt(near.s);
    const dh = normalizeAngle(e.heading - hs);
    // A few mm, or a few degrees, off is as good as on: a hand doesn't draw truer than that.
    const d = Math.max(0, near.d - DEAD_D);
    const h = Math.max(0, Math.abs(dh) - DEAD_H);
    let cost = (d / SIGMA_D) ** 2 + (h / SIGMA_H) ** 2;
    const over = near.s - this.strokeLength;
    if (finishing && over > 0) cost += (over / SIGMA_OVER) ** 2;
    return { cost, s: near.s, h: hs, back: near.s < from + length * 0.3 };
  }

  /** Nearest point on the stroke between distances s0 and s1 (extended straight past its end): distance and where. */
  private nearest(x: number, z: number, s0: number, s1: number): { d: number; s: number } {
    const n = this.xs.length;
    let bestD = Infinity;
    let bestS = 0;
    // Start at the first segment reaching s0 (binary search: the stroke may be long).
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ss[mid + 1] !== undefined && this.ss[mid + 1] < s0) lo = mid + 1;
      else hi = mid;
    }
    // (Squared distances, the root taken once: this is most of what scoring a piece costs.)
    const xs = this.xs;
    const zs = this.zs;
    const ss = this.ss;
    let bestD2 = Infinity;
    for (let i = Math.max(0, lo); i < n - 1 && ss[i] <= s1; i++) {
      const ax = xs[i];
      const az = zs[i];
      const sx = xs[i + 1] - ax;
      const sz = zs[i + 1] - az;
      const l2 = sx * sx + sz * sz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / l2)) : 0;
      const dx = ax + sx * t - x;
      const dz = az + sz * t - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestS = ss[i] + (ss[i + 1] - ss[i]) * t;
      }
    }
    bestD = Math.sqrt(bestD2);
    // Past the end: carry the stroke on straight, the way the finger was going over its last few centimetres.
    const h = this.tailHeading();
    const ex = this.xs[n - 1];
    const ez = this.zs[n - 1];
    const along = (x - ex) * Math.cos(h) + (z - ez) * Math.sin(h);
    if (along > 0) {
      const d = Math.abs(-(x - ex) * Math.sin(h) + (z - ez) * Math.cos(h));
      if (d < bestD) {
        bestD = d;
        bestS = this.strokeLength + along;
      }
    }
    return { d: bestD, s: bestS };
  }

  /** The way the finger was going at the end of the stroke: across its last few centimetres (past a hand's wobble). */
  private tailHeading(): number {
    // (Asked for every piece scored: worked out once for each length of the stroke.)
    if (this.tailAt === this.ss.length) return this.tail;
    this.tailAt = this.ss.length;
    return (this.tail = this.tailHeadingOf());
  }

  private tailHeadingOf(): number {
    const len = this.strokeLength;
    const a = this.pointAt(Math.max(0, len - HEADING_HALF));
    const n = this.xs.length - 1;
    if (Math.hypot(this.xs[n] - a.x, this.zs[n] - a.z) < 4) return this.headingAt(len);
    return Math.atan2(this.zs[n] - a.z, this.xs[n] - a.x);
  }

  /**
   * The stroke's heading at distance s: smoothed over a few centimetres either side. Where along the stroke that heading
   * is true of a circle goes in `headingTrueAt`: near the stroke's ends the window is lopsided, and its chord runs the
   * way a circle does halfway along it, not at s.
   */
  private headingAt(s: number): number {
    const len = this.strokeLength;
    this.headingTrueAt = s;
    if (len < 1) return this.start.heading;
    // Across a long stretch either side, so a hand's wobble averages out: the same either side where it can (on a
    // circle, that chord runs the way the circle does at s). Near the stroke's ends, one side reaches up to twice as far
    // as the other has room to (and a few centimetres at least), which lags a curve no more than a short window would.
    const c = Math.max(0, Math.min(len, s));
    const back = Math.min(c, HEADING_HALF, Math.max(HEADING_MIN, 2 * (len - c)));
    const on = Math.min(len - c, HEADING_HALF, Math.max(HEADING_MIN, 2 * c));
    this.headingTrueAt = c + (on - back) / 2;
    const a = this.pointAt(c - back);
    const b = this.pointAt(c + on);
    if (Math.hypot(b.x - a.x, b.z - a.z) < 4) return this.start.heading;
    return Math.atan2(b.z - a.z, b.x - a.x);
  }

  private pointAt(s: number): { x: number; z: number } {
    const n = this.xs.length;
    if (s <= 0) return { x: this.xs[0], z: this.zs[0] };
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.ss[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = this.ss[hi] - this.ss[lo];
    const t = span > 0 ? Math.min(1, (s - this.ss[lo]) / span) : 0;
    return { x: this.xs[lo] + (this.xs[hi] - this.xs[lo]) * t, z: this.zs[lo] + (this.zs[hi] - this.zs[lo]) * t };
  }
}

let warmed = false;

/**
 * Draw two made-up strokes (a gentle wave, and a straight swipe off the grid) and throw them away, once: the JS engine
 * compiles the drawing code as it first runs, and a player's first stroke paid for that on its first piece (3 to 4 ms
 * in Node, against 0.5 ms after this; several times that on a phone). About 10 ms in Node, best run when idle (as the
 * Draw chip is switched on).
 */
export function warmDrawing(): void {
  if (warmed) return;
  warmed = true;
  const start: DrawEnd = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" };
  const wave = new DrawLine(start);
  for (let s = 6; s <= 600; s += 6) wave.addPoint(s, 200 * Math.sin(s / 300));
  wave.finish();
  const swipe = new DrawLine(start);
  for (let s = 6; s <= 600; s += 6) swipe.addPoint(s * 0.92, s * 0.39);
  swipe.finish();
}

/** A piece's track as points (x, z, heading the line runs), from where it joins the line to its free end. */
function trackOf(c: DrawCandidate): number[] {
  const def = getPieceDef(c.type, c.flipped);
  const geom = def.paths[0].geom;
  const len = pathLength(geom);
  // Path 0 runs from connector 0: backwards when the line came in at the other end.
  const reverse = c.entry !== def.paths[0].from;
  const steps = Math.max(1, Math.ceil(len / TRACK_STEP));
  const out: number[] = [];
  const sample = createSample();
  const w: Pose = { x: 0, z: 0, heading: 0 };
  for (let i = 0; i <= steps; i++) {
    const d = reverse ? len - (len * i) / steps : (len * i) / steps;
    samplePath(geom, d, sample);
    transformPose(c.pose, { x: sample.x, z: sample.z, heading: sample.heading + (reverse ? Math.PI : 0) }, w);
    out.push(w.x, w.z, w.heading);
  }
  return out;
}

/** A piece's bend: 0 for a straight, or its radius signed by the way it turns (its heading changing by `turn`). */
function bendOf(type: PieceTypeId, turn: number): number {
  const geom = getPieceDef(type, false).paths[0].geom;
  if (geom.kind !== "arc") return 0;
  return normalizeAngle(turn) < 0 ? -geom.radius : geom.radius;
}

/**
 * A piece turning (radians) more or less than the stroke does along it: a steady curve is followed by curves of its
 * radius, not by a tighter one making up for a straight run on too far (whose ends can sit on the stroke all the same).
 */
function turnCost(piece: number, stroke: number): number {
  const d = Math.max(0, Math.abs(normalizeAngle(piece - stroke)) - DEAD_H);
  return (d / SIGMA_H) ** 2;
}

function rebendCost(p: number, q: number): number {
  if (p === q) return 0;
  return p === 0 || q === 0 ? RESHAPE_COST : REBEND_COST;
}

const SCRATCH: Pose = { x: 0, z: 0, heading: 0 };

/**
 * The plan search along a straight stroke (`DrawLine.chooseFlat`): its inputs and the best plan so far. One shared
 * scratch, so a search allocates nothing.
 */
const FLAT = {
  /** The chord: a point on it, and the way it runs (and its angle); the low eighth of the two either side of it. */
  cx: 0,
  cz: 0,
  ux: 1,
  uz: 0,
  theta: 0,
  lo: 0,
  /** How far the chord's way is round from the low eighth, and back from the high one: sine and cosine. */
  sinOff: [0, 0],
  cosOff: [1, 1],
  /** How far along the chord the stroke's end is. */
  alongEnd: 0,
  finishing: false,
  types: DRAW_TYPES as readonly PieceTypeId[],
  /** Pieces it may still look at (see `FLAT_NODES`). */
  budget: 0,
  bestCost: Infinity,
  bestType: null as PieceTypeId | null,
  bestTurn: 0,
};

/** The band's cost `y` mm to the side of the chord. */
const flatBand = (y: number): number => (Math.max(0, Math.abs(y) - BAND) / BAND_SIGMA) ** 2;

/**
 * Finishing: how far short of, or past, the stroke's end the line stops, and how far to its side (anywhere in the band
 * will do, but nearer the finger is better at the very end).
 */
function flatStop(along: number, y: number): number {
  const short = FLAT.alongEnd - along;
  return (short > 0 ? (short / SIGMA_SHORT) ** 2 : (short / BAND_OVER) ** 2) + (Math.max(0, Math.abs(y) - BAND / 2) / BAND_STOP) ** 2;
}

/**
 * Depth first, from (x, z) heading along the low eighth or the high, the bend before and the cost so far; the plan's
 * first piece and its turn. A branch is cut once what it has cost, less all the stroke it could still cover, is no
 * better than the best plan found (every piece costs something, and covering stroke is the only gain); and the search
 * stops after `FLAT_NODES` pieces, keeping the best plan found by then.
 */
function flatSearch(depth: number, x: number, z: number, low: boolean, prev: number, cost: number, first: PieceTypeId | null, firstTurn: number, step: number): void {
  const f = FLAT;
  const h = low ? f.lo : f.lo + EIGHTH;
  const fx = Math.cos(h);
  const fz = Math.sin(h);
  const along = (x - f.cx) * f.ux + (z - f.cz) * f.uz;
  const types = f.types;
  for (let t = 0; t < types.length; t++) {
    if (f.budget-- <= 0) return;
    const type = types[t];
    const g = FLAT_GEOM[type];
    let ex: number;
    let ez: number;
    let mid = 0;
    let bend = 0;
    let turn = 0;
    if (g.radius === 0) {
      ex = x + fx * g.length;
      ez = z + fz * g.length;
    } else {
      // Onto the other eighth: up from the low one, down from the high.
      turn = low ? 1 : -1;
      bend = turn * g.radius;
      const a = g.radius * SIN_EIGHTH;
      const b = turn * g.radius * (1 - COS_EIGHTH);
      ex = x + fx * a - fz * b;
      ez = z + fz * a + fx * b;
      // The curve's furthest from the chord, where it runs the chord's way (the stroke's way lies between the eighths).
      const am = g.radius * f.sinOff[low ? 0 : 1];
      const bm = turn * g.radius * (1 - f.cosOff[low ? 0 : 1]);
      mid = flatBand((z + fz * am + fx * bm - f.cz) * f.ux - (x + fx * am - fz * bm - f.cx) * f.uz);
    }
    const y = (ez - f.cz) * f.ux - (ex - f.cx) * f.uz;
    const a1 = (ex - f.cx) * f.ux + (ez - f.cz) * f.uz;
    let next = cost + pieceCost(type) + (type === "straight-54" ? BAND_MINI : 0) + (bend ? BAND_CURVE + (g.radius === SMALL_CURVE_RADIUS ? BAND_TIGHT : 0) + (prev ? BAND_PAIR : 0) + (step && Math.sign(step) !== Math.sign(bend) && Math.abs(step) !== g.radius ? BAND_MIX : 0) : 0) + rebendCost(prev, bend) + flatBand(y) + mid;
    if (!f.finishing) next -= (Math.min(a1, f.alongEnd) - Math.min(along, f.alongEnd)) * ADVANCE;
    const ff = first ?? type;
    const ft = first ? firstTurn : turn;
    // While drawing, where a plan leaves the line counts too: running on straight from there a little way, the finger
    // going on as it was, it should still be in the band (else the next piece has to turn straight away).
    const h1 = bend ? (low ? f.lo + EIGHTH : f.lo) : h;
    const total = f.finishing ? next + flatStop(a1, y) + (bend ? BAND_LAST_CURVE : 0) : next + flatBand(y + Math.sin(h1 - f.theta) * FLAT_RUN);
    // While drawing, a plan is taken as far as the stroke goes (or as many pieces as are looked at): stopping short
    // would hide where going on from there leads.
    const ends = f.finishing || depth === 1 || a1 >= f.alongEnd;
    if (ends && total < f.bestCost) {
      f.bestCost = total;
      f.bestType = ff;
      f.bestTurn = ft;
    }
    // Nothing more to gain past the stroke's end while drawing (nobody knows yet where the finger goes); nor down a
    // branch that can't beat the best plan even covering all the stroke left.
    if (depth > 1 && (f.finishing || a1 < f.alongEnd)) {
      const gain = f.finishing ? 0 : Math.max(0, f.alongEnd - a1) * ADVANCE;
      if (next + MIN_PIECE_COST - gain < f.bestCost) flatSearch(depth - 1, ex, ez, bend ? !low : low, bend, next, ff, ft, stepAfter(step, bend, prev));
    }
  }
}
const MEAN = [0, 0, 0, 0];

/** Each drawn piece's shape, for planning along a straight stroke: a straight's length, or a curve's radius (an eighth of a turn). */
const FLAT_GEOM = Object.fromEntries(
  DRAW_TYPES.map((t) => {
    const geom = getPieceDef(t, false).paths[0].geom;
    return [t, geom.kind === "arc" ? { length: 0, radius: geom.radius } : { length: geom.kind === "line" ? geom.length : 0, radius: 0 }];
  }),
) as Record<PieceTypeId, { length: number; radius: number }>;
const SAMPLE = createSample();

/** Where a candidate's track has got to `t` mm from where it joins the line (x, z and the way it runs), into `out`. */
function poseAlong(c: DrawCandidate, t: number, out: Pose): Pose {
  const def = getPieceDef(c.type, c.flipped);
  const geom = def.paths[0].geom;
  const len = pathLength(geom);
  const reverse = c.entry !== def.paths[0].from;
  const d = Math.max(0, Math.min(len, t));
  samplePath(geom, reverse ? len - d : d, SAMPLE);
  return transformPose(c.pose, { x: SAMPLE.x, z: SAMPLE.z, heading: SAMPLE.heading + (reverse ? Math.PI : 0) }, out);
}
