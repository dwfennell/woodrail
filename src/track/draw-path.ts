import { normalizeAngle, solveParentPose, transformPose, type Pose } from "./math";
import { createSample, pathLength, samplePath } from "./path";
import { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE, SMALL_CURVE_RADIUS, WIDE_CURVE_RADIUS } from "./constants";
import { getPieceDef, type ConnectorKind, type PieceTypeId } from "./pieces";

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

/** The pieces a drawn line is made of: straights, and curves either way. */
export const DRAW_TYPES: readonly PieceTypeId[] = ["straight-216", "straight-144", "straight-108", "straight-54", "curve-large", "curve-wide", "curve-small"];

export interface DrawOptions {
  /** May this piece go here (the landscape, other track, the line's own pieces)? Null, or why not. */
  check?: (c: DrawCandidate, line: readonly DrawnPiece[]) => string | null;
  /** Which types it may use now (Game mode: only those the player has left). */
  allow?: (type: PieceTypeId, line: readonly DrawnPiece[]) => boolean;
  /**
   * A piece that closes the line onto other track from `end` (the Auto piece's fit), or null. Laid instead of a drawn
   * piece if its far end lies on the stroke, and the line is then finished.
   */
  meet?: (end: DrawEnd, line: readonly DrawnPiece[]) => DrawCandidate | null;
  /** Does the line end on other track here (seated, so it's finished)? */
  closes?: (end: DrawEnd) => boolean;
}

/** Stroke points closer than this (mm) to the last are skipped. */
const STEP = 6;
/** The next piece is chosen once the stroke reaches this far (mm) past the line's end, so the look-ahead sees it. */
export const DRAW_LOOKAHEAD = 250;
/**
 * The finger counts as gone on from the line's end (to carry on after a retrace, or to grow the line when it lifts) once
 * it's this far (mm) ahead of it. (When it lifts, whether the last bit of stroke gets a piece is scored: see `stopCost`.)
 */
const FINISH_SLACK = 27;
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
/** What each piece costs on its own: fewer pieces look calmer, and the tight curve and the mini are for when they're needed. */
const PIECE_COST: Partial<Record<PieceTypeId, number>> = { "straight-54": 0.9, "straight-108": 0.4, "curve-small": 1.5 };
const BASE_PIECE_COST = 0.3;
const pieceCost = (t: PieceTypeId): number => BASE_PIECE_COST + (PIECE_COST[t] ?? 0);
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
/** The mini straight costs this much more there (a step is cleaner without one). */
const BAND_MINI = 1;
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
const EIGHTH = Math.PI / 4;
const SIN_EIGHTH = Math.sin(EIGHTH);
const COS_EIGHTH = Math.cos(EIGHTH);

/**
 * Every way each piece type can seat on `end`, mirrored or not. Any two ends join, but each drawn piece has a peg end
 * and a hole end, so it's seated through the end of the other kind: through the same kind would be the same shape
 * again (a straight or curve the other way round), only with its peg and hole swapped.
 */
export function candidatesFrom(end: DrawEnd, types: readonly PieceTypeId[] = DRAW_TYPES): DrawCandidate[] {
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
  /** A piece the line would have used but the player has none of left (Game mode), or null. */
  refused: PieceTypeId | null = null;

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

  constructor(
    readonly start: DrawEnd,
    private readonly options: DrawOptions = {},
  ) {
    this.push(start.x, start.z);
    this.fx = start.x;
    this.fz = start.z;
  }

  /** Where the line has got to. */
  get end(): DrawEnd {
    return this.pieces.length ? this.pieces[this.pieces.length - 1].end : this.start;
  }

  /** The stroke's length so far (mm). */
  get strokeLength(): number {
    return this.ss[this.ss.length - 1];
  }

  /** The finger has moved to (x, z): extend the stroke, take pieces off if it's retracing, and grow behind it. True if the pieces changed. */
  addPoint(x: number, z: number): boolean {
    if (Math.hypot(x - this.fx, z - this.fz) < STEP) return false;
    const before = this.pieces.length;
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
    // already due, a move's budget having run out, still come).
    if (away || this.backlog) this.grow(false, GROW_PER_MOVE);
    return trimmed || this.pieces.length !== before;
  }

  /** The finger has lifted: grow the line to the end of the stroke. True if the pieces changed. */
  finish(): boolean {
    const before = this.pieces.length;
    // Pieces already due while drawing go down as they would have then, and then the line grows to the stroke's end.
    if (this.backlog) this.grow(false, Infinity);
    this.grow(true);
    return this.pieces.length !== before;
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

  /** The stroke ahead of the line's end (not yet laid), as x, z pairs into `out`; returns how many points. */
  ahead(out: number[]): number {
    out.length = 0;
    const e = this.end;
    out.push(e.x, e.z);
    for (let i = 0; i < this.xs.length; i++) if (this.ss[i] > this.progress) out.push(this.xs[i], this.zs[i]);
    return out.length / 2;
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
      this.refused = null;
      this.retreating = true;
      this.backlog = false;
      this.runFrom = null;
      return true;
    }
    return false;
  }

  /** Lay pieces along the stroke, up to `budget` of them (while drawing: see `GROW_PER_MOVE`). */
  private grow(finishing: boolean, budget = Infinity): void {
    this.backlog = false;
    if (this.retreating) return;
    for (let guard = 0; guard < MAX_PIECES && !this.stopped && this.pieces.length < MAX_PIECES; guard++) {
      const left = this.strokeLength - this.progress;
      if (left < (finishing ? STEP : DRAW_LOOKAHEAD)) return;
      if (guard >= budget) {
        this.backlog = true;
        return;
      }
      const end = this.end;
      // Finishing: only if the finger was let go a little way from the line's end, moving away from it (not coming back
      // to it, retracing, or round the tip of a hairpin).
      if (finishing && !this.leavingEnd(end)) return;
      const met = this.options.meet?.(end, this.pieces);
      const near = met ? this.nearest(met.end.x, met.end.z, this.progress, this.progress + met.length * 1.6 + 40) : null;
      if (met && near && near.d < MEET_REACH && near.s <= this.strokeLength + MEET_REACH) {
        this.lay(met, near.s);
        if (!this.stopped) this.stopped = "closed";
        return;
      }
      // Back round to its own start: a piece that closes the loop there goes down, rather than one on past it.
      if (this.closeOnStart(end)) return;
      // Finishing a loop that has come round to just short of its start, running its way: that's where it ends (a piece
      // more would go on across its first piece, and say so).
      if (finishing && this.backAtStart(end)) return;
      // Along a straight stroke, a staircase of straights within a band either side of it (QA N1); else, scored.
      const flat = this.flatStroke() ? this.chooseFlat(end, finishing) : undefined;
      const best = flat === undefined ? this.choose(end, finishing) : flat;
      if (!best) return;
      this.lay(best.candidate, best.s, flat !== undefined);
      if (!this.stopped && this.options.closes?.(best.candidate.end)) this.stopped = "closed";
    }
  }

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
        return true;
      }
      // Not closing after all (or in the way): as it was.
      this.pieces.pop();
      this.progress = progress;
      this.stopped = null;
    }
    return false;
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

  private lay(c: DrawCandidate, s: number, aside = false): void {
    const blocked = this.options.check?.(c, this.pieces) ?? null;
    let points = 1;
    while (points < this.ss.length && this.ss[points] <= this.progress) points++;
    this.pieces.push({ type: c.type, flipped: c.flipped, pose: c.pose, y: c.y, entry: c.entry, exit: c.exit, end: c.end, from: this.progress, points, blocked, track: trackOf(c), aside });
    this.progress = Math.max(this.progress, s);
    if (blocked) this.stopped = "blocked";
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
  private best(end: DrawEnd, finishing: boolean, types: readonly PieceTypeId[]): { candidate: DrawCandidate; s: number } | null {
    const firsts = candidatesFrom(end, types);
    let best: { candidate: DrawCandidate; s: number } | null = null;
    const k = this.pieces.length;
    const h0 = this.headingAt(this.progress);
    const before = k ? bendOf(this.pieces[k - 1].type, this.pieces[k - 1].end.heading - (k > 1 ? this.pieces[k - 2].end.heading : this.start.heading)) : 0;
    // Finishing, laying nothing more is a choice too: it costs how far the line's end is from the stroke's, and off its heading.
    let bestCost = finishing ? this.stopCost(end) : Infinity;
    // Each first piece on its own, then with each second piece: the cheapest first pieces first, so the pairs that
    // can't win are seen to sooner (see below). A tie goes to the pair that comes first in the candidates' order
    // (`rank`), as when they were taken in that order.
    let bestRank = -1;
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
    const wins = (cost: number, rank: number) => cost < bestCost || (cost === bestCost && rank < bestRank);
    for (const { a, ea, bendA, costA, i } of scored) {
      // Finishing, a piece may end the line on its own.
      if (finishing) {
        const cost = costA - (Math.min(ea.s, this.strokeLength) - this.progress) * ADVANCE;
        if (wins(cost, i * 64)) {
          bestCost = cost;
          bestRank = i * 64;
          best = { candidate: a, s: ea.s };
        }
      }
      const room = this.strokeLength - ea.s;
      // No pair from here can beat the best so far, even with no cost of its own but its pieces' and covering all the
      // stroke there is: skip the second pieces (most of the cost of a step is finding their ends on the stroke).
      const gain = (this.strokeLength - this.progress) * ADVANCE + FIT_REBATE;
      if (costA - gain > bestCost + 1e-9) continue;
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
        if (wins(cost, i * 64 + 1 + j)) {
          bestCost = cost;
          bestRank = i * 64 + 1 + j;
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
    flatSearch(FLAT_DEPTH, end.x, end.z, atLo, before, 0, null, 0);
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
function flatSearch(depth: number, x: number, z: number, low: boolean, prev: number, cost: number, first: PieceTypeId | null, firstTurn: number): void {
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
    let next = cost + pieceCost(type) + (type === "straight-54" ? BAND_MINI : 0) + (bend ? BAND_CURVE + (g.radius === SMALL_CURVE_RADIUS ? BAND_TIGHT : 0) + (prev ? BAND_PAIR : 0) : 0) + rebendCost(prev, bend) + flatBand(y) + mid;
    if (!f.finishing) next -= (Math.min(a1, f.alongEnd) - Math.min(along, f.alongEnd)) * ADVANCE;
    const ff = first ?? type;
    const ft = first ? firstTurn : turn;
    // While drawing, where a plan leaves the line counts too: running on straight from there a little way, the finger
    // going on as it was, it should still be in the band (else the next piece has to turn straight away).
    const h1 = bend ? (low ? f.lo + EIGHTH : f.lo) : h;
    const total = f.finishing ? next + flatStop(a1, y) : next + flatBand(y + Math.sin(h1 - f.theta) * FLAT_RUN);
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
      if (next + MIN_PIECE_COST - gain < f.bestCost) flatSearch(depth - 1, ex, ez, bend ? !low : low, bend, next, ff, ft);
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
