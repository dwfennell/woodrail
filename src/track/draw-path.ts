import { normalizeAngle, solveParentPose, transformPose, type Pose } from "./math";
import { createSample, pathLength, samplePath } from "./path";
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
/** Finishing: the line stops when less than this much stroke (mm) is left. */
const FINISH_SLACK = 27;
/** Retracing: the finger this close (mm) to a piece's track, heading back along it, takes it (and those after) off. */
const TRIM_REACH = 30;
/** Pieces' tracks are kept as points this far apart (mm), for retracing. */
const TRACK_STEP = 12;
/** Scoring: how far off the stroke (mm), and off its heading (radians), count as one unit of cost. */
const SIGMA_D = 18;
const SIGMA_H = 0.3;
/** Each mm the pair of pieces gains along the stroke is worth this much (long pieces win on a straight run). */
const ADVANCE = 1 / 120;
/** Overshooting the stroke's end when finishing: this many mm costs one unit. */
const SIGMA_OVER = 40;
const MAX_PIECES = 200;
/** What each piece costs on its own: fewer pieces look calmer, and the tight curve and the mini are for when they're needed. */
const PIECE_COST: Partial<Record<PieceTypeId, number>> = { "straight-54": 0.9, "straight-108": 0.4, "curve-small": 1.5 };
const BASE_PIECE_COST = 0.3;
const pieceCost = (t: PieceTypeId): number => BASE_PIECE_COST + (PIECE_COST[t] ?? 0);
/** A closing piece is laid when its far end is this close (mm) to the stroke drawn so far. */
const MEET_REACH = 40;

/** Every way each piece type can seat on `end`: through an end of the other kind, mirrored or not. */
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
        if (c.kind === end.kind) continue;
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

  constructor(
    readonly start: DrawEnd,
    private readonly options: DrawOptions = {},
  ) {
    this.push(start.x, start.z);
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
    const n = this.xs.length;
    if (Math.hypot(x - this.xs[n - 1], z - this.zs[n - 1]) < STEP) return false;
    const before = this.pieces.length;
    const trimmed = this.retrace(x, z);
    this.push(x, z);
    this.grow(false);
    return trimmed || this.pieces.length !== before;
  }

  /** The finger has lifted: grow the line to the end of the stroke. True if the pieces changed. */
  finish(): boolean {
    const before = this.pieces.length;
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

  /** The stroke ahead of the line's end (not yet laid), as x, z pairs into `out`; returns how many points. */
  ahead(out: number[]): number {
    out.length = 0;
    const e = this.end;
    out.push(e.x, e.z);
    for (let i = 0; i < this.xs.length; i++) if (this.ss[i] > this.progress) out.push(this.xs[i], this.zs[i]);
    return out.length / 2;
  }

  private push(x: number, z: number): void {
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
    const n = this.xs.length;
    const dx = x - this.xs[n - 1];
    const dz = z - this.zs[n - 1];
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
      if (!over) continue;
      const p = this.pieces[k];
      this.pieces.length = k;
      this.xs.length = this.zs.length = this.ss.length = p.points;
      this.progress = Math.min(p.from, this.strokeLength);
      this.stopped = null;
      this.refused = null;
      return true;
    }
    return false;
  }

  private grow(finishing: boolean): void {
    for (let guard = 0; guard < MAX_PIECES && !this.stopped && this.pieces.length < MAX_PIECES; guard++) {
      const left = this.strokeLength - this.progress;
      if (left < (finishing ? FINISH_SLACK : DRAW_LOOKAHEAD)) return;
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
      const best = this.choose(end, finishing);
      if (!best) return;
      this.lay(best.candidate, best.s);
      if (!this.stopped && this.options.closes?.(best.candidate.end)) this.stopped = "closed";
    }
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

  private lay(c: DrawCandidate, s: number): void {
    const blocked = this.options.check?.(c, this.pieces) ?? null;
    let points = 1;
    while (points < this.ss.length && this.ss[points] <= this.progress) points++;
    this.pieces.push({ type: c.type, flipped: c.flipped, pose: c.pose, y: c.y, entry: c.entry, exit: c.exit, end: c.end, from: this.progress, points, blocked, track: trackOf(c) });
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

  private best(end: DrawEnd, finishing: boolean, types: readonly PieceTypeId[]): { candidate: DrawCandidate; s: number } | null {
    const firsts = candidatesFrom(end, types);
    let best: { candidate: DrawCandidate; s: number } | null = null;
    let bestCost = Infinity;
    for (const a of firsts) {
      const ea = this.endCost(a.end, this.progress, a.length, finishing);
      if (ea.back) continue;
      // Finishing, a piece may end the line on its own.
      if (finishing) {
        const cost = ea.cost + pieceCost(a.type) - (ea.s - this.progress) * ADVANCE;
        if (cost < bestCost) {
          bestCost = cost;
          best = { candidate: a, s: ea.s };
        }
      }
      for (const b of candidatesFrom(a.end, types)) {
        const eb = this.endCost(b.end, ea.s, b.length, finishing);
        if (eb.back) continue;
        const cost = ea.cost + eb.cost + pieceCost(a.type) + pieceCost(b.type) - (eb.s - this.progress) * ADVANCE;
        if (cost < bestCost) {
          bestCost = cost;
          best = { candidate: a, s: ea.s };
        }
      }
    }
    if (best && best.s <= this.progress + 1) return null;
    return best;
  }

  /**
   * How far an end lies from the stroke, and off its heading there, searching the stroke from `from` up to a little
   * past one piece's length. Past the stroke's end it carries on straight (the way the finger was going); finishing,
   * that overshoot costs.
   */
  private endCost(e: DrawEnd, from: number, length: number, finishing: boolean): { cost: number; s: number; back: boolean } {
    const near = this.nearest(e.x, e.z, from - 10, from + length * 1.6 + 40);
    const dh = normalizeAngle(e.heading - this.headingAt(near.s));
    let cost = (near.d / SIGMA_D) ** 2 + (dh / SIGMA_H) ** 2;
    const over = near.s - this.strokeLength;
    if (finishing && over > 0) cost += (over / SIGMA_OVER) ** 2;
    return { cost, s: near.s, back: near.s < from + length * 0.3 };
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
    for (let i = Math.max(0, lo); i < n - 1 && this.ss[i] <= s1; i++) {
      const ax = this.xs[i];
      const az = this.zs[i];
      const sx = this.xs[i + 1] - ax;
      const sz = this.zs[i + 1] - az;
      const l2 = sx * sx + sz * sz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / l2)) : 0;
      const d = Math.hypot(ax + sx * t - x, az + sz * t - z);
      if (d < bestD) {
        bestD = d;
        bestS = this.ss[i] + Math.sqrt(l2) * t;
      }
    }
    // Past the end: carry the stroke on straight.
    const h = this.headingAt(this.strokeLength);
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

  /** The stroke's heading at distance s: smoothed over a few centimetres either side. */
  private headingAt(s: number): number {
    const len = this.strokeLength;
    if (len < 1) return this.start.heading;
    const a = this.pointAt(Math.max(0, Math.min(len, s) - 30));
    const b = this.pointAt(Math.min(len, s + 30));
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
