/**
 * Which train is on these pieces: the one place that answers it (routing redesign §6.2). Before it, sections
 * (`standingOn`, `inWayOf`), the router (`standingOn`, `otherOn`, `otherUnder`) and others each scanned the trains
 * their own way: by axle, by the sim's cover (`piecesUnder`), standing or not.
 *
 * Two measures of "on":
 * - **axles** (`"axles"`): a train with an axle on the piece (`Train.bogies`).
 * - **cars** (`"cars"`): a train whose cars cover the piece, axle to axle (`Sim.piecesUnder`).
 *
 * And, for the booking table (§6 F8), the pieces and paths under a train from buffer face to buffer face
 * (`underByEnds`): the cars' ends, not their axles, so a switch or crossing is had until the last car's body is off it.
 */
import { getPieceDef, routeFrom, type Layout, type RouteStep } from "../track";
import { CAR_SPECS, COUPLER_GAP } from "./cars";
import { flipCursor, type Cursor, type RouteMemory } from "./cursor";
import { walkTrack } from "./track-walk";
import type { Sim, Train } from "./sim";

/** Which measure of "on" a question asks by. */
export type OnBy = "axles" | "cars";

/** What a scan asks of the sim (a `Sim`, or a view of one). */
export type OccupancySim = Pick<Sim, "trains" | "piecesUnder">;

export interface OnOptions {
  /** Not this train (or its id). */
  except?: Train | number;
  /** Only trains standing (speed under 1 mm/s). */
  standing?: boolean;
  /** By axles (default) or by cars. */
  by?: OnBy;
  /** Not trains off the rails (by cars they never count). */
  onRails?: boolean;
}

/**
 * The first train (in the sim's order) on any of `pieces` (a set, or a test), with `opts`; undefined: none. Off-the-rails
 * trains don't count by cars (they're under nothing); by axles they do unless `opts` say otherwise, as before.
 */
export function trainOn(sim: OccupancySim, pieces: ReadonlySet<number> | ((pieceId: number) => boolean), opts: OnOptions = {}): Train | undefined {
  const has = typeof pieces === "function" ? pieces : (id: number) => pieces.has(id);
  const exceptId = opts.except === undefined ? -1 : typeof opts.except === "number" ? opts.except : opts.except.id;
  const by = opts.by ?? "axles";
  for (const t of sim.trains()) {
    if (t.id === exceptId) continue;
    if (opts.standing && t.speed >= 1) continue;
    if (opts.onRails && t.derailed) continue;
    if (by === "cars") {
      if (t.derailed) continue;
      for (const p of sim.piecesUnder(t.id)) if (has(p)) return t;
    } else for (const b of t.bogies) if (has(b.pieceId)) return t;
  }
  return undefined;
}


/**
 * Per piece, the train over it by cars (its id; −1: more than one), worked out once a sim tick and kept till the next.
 * For lookups on a hot path (the router's look ahead) where a scan of every train per piece would cost too much.
 */
export class CoverIndex {
  private readonly under = new Map<number, number>();
  private at = -1;

  /** The train id over this piece (−1: more than one; undefined: none), as of sim tick `tick`. */
  over(sim: OccupancySim, tick: number, pieceId: number): number | undefined {
    if (this.at !== tick) {
      this.at = tick;
      this.under.clear();
      for (const { id } of sim.trains()) for (const p of sim.piecesUnder(id)) this.under.set(p, this.under.has(p) && this.under.get(p) !== id ? -1 : id);
    }
    return this.under.get(pieceId);
  }

  /** Is another train than `trainId` over this piece (as `over`)? */
  otherOver(sim: OccupancySim, tick: number, pieceId: number, trainId: number): boolean {
    const o = this.over(sim, tick, pieceId);
    return o !== undefined && o !== trainId;
  }
}

/** The way on as the train's own axles took it: a switch it remembers (from its trunk), else as the points lie. */
function trainChooser(memory: RouteMemory): (layout: Layout, pieceId: number, exit: number, out: RouteStep) => boolean {
  return (layout, pieceId, exit, out) => {
    if (!routeFrom(layout, pieceId, exit, out)) return false;
    const m = memory.get(out.pieceId);
    if (m && !out.reversed) {
      const p = layout.getPiece(out.pieceId);
      if (p && getPieceDef(p.type, p.flipped).isSwitch) out.pathIndex = m.path;
    }
    return true;
  };
}

/**
 * The pieces under a train from its rear car's buffer face to its front car's (§6 F8), each with the paths it's on (a
 * bit each), into `out` (cleared first). The span between the end axles follows the train's own way (its switch
 * memory); the overhangs beyond them, the points as they lie.
 */
export function underByEnds(layout: Layout, train: Train, out: Map<number, number> = new Map()): Map<number, number> {
  out.clear();
  const b = train.bogies;
  if (b.length === 0 || train.cars.length === 0) return out;
  const add = (pieceId: number, path: number) => {
    out.set(pieceId, (out.get(pieceId) ?? 0) | (1 << path));
  };
  const front = b[0];
  const last = b[b.length - 1];
  const frontInset = CAR_SPECS[train.cars[0].kind].bogieInset;
  const rearInset = CAR_SPECS[train.cars[train.cars.length - 1].kind].bogieInset;
  // (Axle to axle, along its own way: the cars' lengths and the gaps between, less the end overhangs.)
  let span = (train.cars.length - 1) * COUPLER_GAP - frontInset - rearInset;
  for (const car of train.cars) span += CAR_SPECS[car.kind].length;
  for (const x of b) add(x.pieceId, x.pathIndex);
  walkTrack(layout, last, Math.max(0, span), (p, path) => add(p, path), trainChooser(train.memory));
  // (The front overhang, and the rear one behind the last axle.)
  walkTrack(layout, front, frontInset, (p, path) => add(p, path));
  const rear: Cursor = { ...last };
  flipCursor(layout, rear);
  walkTrack(layout, rear, rearInset, (p, path) => add(p, path));
  return out;
}

/**
 * `underByEnds` kept per train for a hot path: the span between the end axles is worked out again only when an axle has
 * come onto another piece or path, or the track changed; the overhangs past the end axles (a car's nose reaching over
 * the next joint) every call, as they move with the train along a piece.
 */
export class UnderCache {
  private readonly spans = new Map<number, { at: number[]; rev: number; sw: number; joints: number; span: Map<number, number> }>();
  private readonly out = new Map<number, number>();

  /**
   * The pieces and paths under the train, end to end: into `out` if given, else a map kept and reused (read it before
   * the next call).
   */
  of(layout: Layout, train: Train, out: Map<number, number> = this.out): ReadonlyMap<number, number> {
    out.clear();
    const b = train.bogies;
    if (b.length === 0 || train.cars.length === 0) return out;
    let hit = this.spans.get(train.id);
    let same = !!hit && hit.rev === layout.revision && hit.sw === layout.switchesVersion && hit.joints === layout.jointsVersion && hit.at.length === b.length;
    for (let i = 0; same && i < b.length; i++) if (hit!.at[i] !== b[i].pieceId * 8 + b[i].pathIndex) same = false;
    if (!same) {
      const span = new Map<number, number>();
      const frontInset = CAR_SPECS[train.cars[0].kind].bogieInset;
      const rearInset = CAR_SPECS[train.cars[train.cars.length - 1].kind].bogieInset;
      let d = (train.cars.length - 1) * COUPLER_GAP - frontInset - rearInset;
      for (const car of train.cars) d += CAR_SPECS[car.kind].length;
      for (const x of b) span.set(x.pieceId, (span.get(x.pieceId) ?? 0) | (1 << x.pathIndex));
      walkTrack(layout, b[b.length - 1], Math.max(0, d), (p, path) => void span.set(p, (span.get(p) ?? 0) | (1 << path)), trainChooser(train.memory));
      hit = { at: b.map((x) => x.pieceId * 8 + x.pathIndex), rev: layout.revision, sw: layout.switchesVersion, joints: layout.jointsVersion, span };
      this.spans.set(train.id, hit);
    }
    for (const [p, m] of hit!.span) out.set(p, m);
    const add = (p: number, path: number) => void out.set(p, (out.get(p) ?? 0) | (1 << path));
    walkTrack(layout, b[0], CAR_SPECS[train.cars[0].kind].bogieInset, add);
    const rear: Cursor = { ...b[b.length - 1] };
    flipCursor(layout, rear);
    walkTrack(layout, rear, CAR_SPECS[train.cars[train.cars.length - 1].kind].bogieInset, add);
    return out;
  }

  /** Forget trains no longer on the sim (call now and then). */
  prune(alive: (trainId: number) => boolean): void {
    for (const id of this.spans.keys()) if (!alive(id)) this.spans.delete(id);
  }
}
