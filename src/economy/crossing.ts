import { getPieceDef, pathLength, type Layout } from "../track";
import { flipCursor, SIM_DT, type Cursor, type Sim, type Train } from "../sim";
import { legFromCursor, type PathRun } from "../game/route-path";
import type { Route } from "./economy";

/**
 * Trains that wait for each other (routes Phase 3, first cut: waiting at stops). A routed train on a line with two or
 * more trains running, ready to leave its stop (its work done, its spacing hold over), waits there till the way to its
 * next stop is clear of its line's trains coming the other way; so trains of one line cross at stops where their ways
 * part (a passing loop, two roads), and never meet head on between them.
 *
 * - **Its way** is what steering will do (`legFromCursor`, which walks as `steer` chooses and honours pinned switches),
 *   from its front to the middle of its next stop, as claims: each piece it goes over and the ends it goes in and out
 *   by. Two claims on one piece clash when they meet head on there (one goes out by the end the other comes in by):
 *   the same road both ways, or a switch's stem from two of its roads. Roads that only merge or part (both going the
 *   same way) don't clash: following trains are left to signals and the sim's braking.
 * - **Claimed on leaving** (first come, first served): a train sent on reserves its way; each piece is let go as its
 *   tail clears it (looked at only when another train asks), and the rest when it comes to its stop. A train between
 *   stops that holds none (a loaded game, one that ran through its stop, a way changed under it) is given its way from
 *   its tail on; a turn back from meeting a train head on, or a change to the track or a pin, works it out again. A
 *   train held at a red signal keeps its claim.
 * - **What it waits for**: a clash with another's claim; with a train standing at a stop on its way (unless it's
 *   heading the same way: then it follows); with where a train standing at, or heading for, its next stop goes on
 *   from there, there (a stop it can't share: a terminus the other turns back at); and, among trains that are both
 *   ready, with the way of the one that has waited longer (or, from the same moment, the lower engine id), unless that
 *   one can't go either.
 * - **Trains that each stand in the next one's way** (no passing place between them: a mutual wait): none can go
 *   first, so they say the line needs a passing loop. After `LOOP_WAIT_S` the one ready first is let go, as before
 *   (they meet and turn back); the player's line is never changed. Nothing waits for ever: a train is also let go once its line has been still
 *   (nothing moving or being worked) for `QUIET_S` (a train held at a red signal by hand, say), and when its lever is
 *   set again (the player sends it on: "Go now").
 * - **Other lines and unrouted trains** are left alone: the player's signals rule them.
 *
 * Decided when a train is ready to go, and looked at again every `CHECK_TICKS` while it waits; nothing per tick
 * otherwise. Ways are cached per train, keyed on where it stands and the track's revisions. Nothing here is saved.
 */

/** How often (economy ticks) a waiting train looks again. */
export const CHECK_TICKS = 12;
/** Two trains each in the other's way (no passing place): after this long (s) the one ready first is let go. */
export const LOOP_WAIT_S = 30;
/** A waiting train is let go once nothing on its line has moved or been worked for this long (s). */
export const QUIET_S = 20;

/** One piece a train's way goes over, and the ends it comes in and goes out by (connector indices; −1: a buffer). */
export interface Claim {
  pieceId: number;
  /** The path it goes along, and whether against the path's own way (from its `to` end to its `from`). */
  pathIndex: number;
  back: boolean;
  entry: number;
  exit: number;
}

/** Why a train waits at its stop, for its card. */
export type CrossWait =
  /** For a train of its line: coming from a stop (`moving`), or standing at one. */
  | { kind: "waiting"; lineId: number; engine: number; depotId: number; moving: boolean }
  /** Two of its line's trains stand in each other's way: the line needs a passing loop. */
  | { kind: "needs-loop"; lineId: number };

/** What the crossing rule reads of the economy. */
export interface CrossHost {
  readonly layout: Layout;
  readonly sim: Sim;
  route(engine: number): Route | undefined;
  /** A depot's piece, or −1 if it isn't on the map. */
  stopPiece(depotId: number): number;
  /** The net drive of a train toward its front (only the sign matters). */
  drive(train: Train): number;
  /** Is this train busy of its own accord (being worked at a depot, held for spacing)? It will go by itself. */
  busy(train: Train, engine: number): boolean;
}

interface Reservation {
  claims: readonly Claim[];
  /** Claims before this one are let go (its tail has cleared them). */
  from: number;
  /** The track's revisions it was worked out on. */
  revision: number;
  routing: number;
  /** When (sim tick) it was worked out, and the piece it leads to (its next stop's). */
  made: number;
  /** The train it was made for (a train put back on the rails, or coupled, is another: its claim is worked out again). */
  trainId: number;
  target: number;
  /** Let go without a claim (timed out, or sent on by the player): only the pieces it stands on count. */
  free: boolean;
}

interface Visit {
  /** When it was first ready to go (economy tick). */
  readySince: number;
  /** Its lever's tick then (set again, the player sends it on). */
  lever: number;
  /** Last asked (economy tick), and last looked (for `CHECK_TICKS`). */
  asked: number;
  checkedAt: number;
  /** Sent on (claimed its way, or let go): not held again this visit. */
  granted: boolean;
  wait: CrossWait | null;
  /** The trains whose claims or standing it clashes with outright, as last looked. */
  hard: number[];
  /** Those of them standing at their stops (in a mutual wait, each is in the other's). */
  standing: number[];
  /** When its line last had something moving or being worked, and when it first stood in a mutual wait (−1: not). */
  quietSince: number;
  loopSince: number;
}

interface PendingLeg {
  pieceId: number;
  pathIndex: number;
  reversed: boolean;
  target: number;
  revision: number;
  routing: number;
  claims: readonly Claim[] | null;
}

/** Two claims on one piece meet head on there. */
const headOn = (a: Claim, b: Claim): boolean => a.exit === b.entry || a.entry === b.exit;

/** The stop a route goes on to after stop `i` (stops in a row at one depot are one visit). */
export function stopAfter(r: Route, i: number): number {
  const here = r.stops[i].depotId;
  let k = i;
  for (let n = 0; n < r.stops.length; n++) {
    k = (k + 1) % r.stops.length;
    if (r.stops[k].depotId !== here) return k;
  }
  return i;
}

/** The stop a route last left, heading for stop `i`. */
export function stopBefore(r: Route, i: number): number {
  const here = r.stops[i].depotId;
  let k = i;
  for (let n = 0; n < r.stops.length; n++) {
    k = (k - 1 + r.stops.length) % r.stops.length;
    if (r.stops[k].depotId !== here) return k;
  }
  return i;
}

export class Crossing {
  private readonly reservations = new Map<number, Reservation>();
  private readonly visits = new Map<number, Visit>();
  private readonly pendingLegs = new Map<number, PendingLeg>();
  private readonly onwardLegs = new Map<number, PendingLeg>();
  /** Scratch: this check's own claims by piece. */
  private readonly mine = new Map<number, Claim[]>();
  /** Each engine's lever tick when it came to its stop (see `arrived`). */
  private readonly leverAt = new Map<number, number>();

  /** Off: no train waits (for comparisons: the balance play-through, tests). */
  enabled = true;

  constructor(private readonly host: CrossHost) {}

  /**
   * Should `engine` (its train `train`, on line `lineId`, ready to leave its stop) wait there (economy tick `now`)?
   * `live`: the line's engines running now; `lever`: when its lever was last set. Starts its visit the first time it's
   * asked; false once it's sent on (its way claimed, or let go).
   */
  holds(engine: number, train: Train, lineId: number, live: () => readonly number[], now: number, lever = 0): boolean {
    if (!this.enabled) return false;
    let v = this.visits.get(engine);
    if (!v) {
      v = { readySince: now, lever: this.leverAt.get(engine) ?? lever, asked: now, checkedAt: -Infinity, granted: false, wait: null, hard: [], standing: [], quietSince: now, loopSince: -1 };
      this.visits.set(engine, v);
    }
    v.asked = now;
    if (v.granted) return false;
    if (v.lever !== lever) {
      this.letGo(engine, v);
      return false;
    }
    if (now - v.checkedAt < CHECK_TICKS) return v.wait !== null;
    v.checkedAt = now;
    const engines = live();
    if (engines.length < 2) {
      // A lone train claims nothing (a second one, when it comes, works out its way from where it is).
      v.wait = null;
      v.hard = [];
      v.standing = [];
      return false;
    }
    return this.check(engine, train, lineId, engines, now, v);
  }

  private check(engine: number, train: Train, lineId: number, live: readonly number[], now: number, v: Visit): boolean {
    const { host } = this;
    const r = host.route(engine);
    if (!r || r.stops.length === 0) return this.grant(engine, v, null, -1);
    const target = host.stopPiece(r.stops[stopAfter(r, r.next % r.stops.length)].depotId);
    const mine = target < 0 ? null : this.pending(engine, train, target);
    if (!mine || mine.length === 0) return this.grant(engine, v, mine, target);
    const s = this.scan(engine, train, mine, target, live, v);
    v.hard = s.hard;
    v.standing = s.standing;
    if (s.hard.length === 0 && s.soft === -1) return this.grant(engine, v, mine, target);
    if (!s.quiet) v.quietSince = now;
    if (s.loop !== -1) {
      if (v.loopSince < 0) v.loopSince = now;
    } else v.loopSince = -1;
    if (s.loop === -1 && now - v.quietSince >= QUIET_S / SIM_DT) {
      this.letGo(engine, v);
      return false;
    }
    // In a mutual wait (no passing place between them), after a while the one ready first is let go, as before.
    if (s.loop !== -1) {
      const lv = this.visits.get(s.loop);
      const first = !lv || v.readySince < lv.readySince || (v.readySince === lv.readySince && engine < s.loop);
      if (first && (now - v.loopSince) * SIM_DT >= LOOP_WAIT_S) {
        this.letGo(engine, v);
        return false;
      }
    }
    if (s.loop !== -1) v.wait = { kind: "needs-loop", lineId };
    else {
      const by = s.hard.length > 0 ? s.hard[0] : s.soft;
      const rb = host.route(by)!;
      const stands = s.standing.includes(by) || (!this.reservations.has(by) && !!rb.at);
      const i = rb.next % rb.stops.length;
      v.wait = { kind: "waiting", lineId, engine: by, depotId: rb.stops[stands ? i : stopBefore(rb, i)].depotId, moving: !stands };
    }
    return true;
  }

  /**
   * The line's other trains a way (`mine`, to piece `target`) clashes with: outright (`hard`; those standing at their
   * stops in `standing`), and, among trains both ready, the one that goes first (`soft`); a train in a mutual wait with
   * this one (`loop`), and whether nothing on the line is moving or being worked (`quiet`).
   */
  private scan(engine: number, train: Train, mine: readonly Claim[], target: number, live: readonly number[], v: Visit) {
    const { host } = this;
    const last = mine[mine.length - 1].pieceId;
    const byPiece = this.mine;
    byPiece.clear();
    for (const c of mine) {
      const at = byPiece.get(c.pieceId);
      if (at) at.push(c);
      else byPiece.set(c.pieceId, [c]);
    }
    const hard: number[] = [];
    const standing: number[] = [];
    let soft = -1;
    let loop = -1;
    let quiet = true;
    // (A mutual wait only counts between two trains standing still: one still running in, or out, is only passing.)
    const still = train.speed < 1;
    for (const u of live) {
      if (u === engine) continue;
      const tu = host.sim.findCar(u)?.train;
      const ru = host.route(u);
      if (!tu || tu === train || !ru || ru.stops.length === 0) continue;
      if (tu.speed > 1 || host.busy(tu, u)) quiet = false;
      const res = this.reservation(u, tu, ru);
      // (Let go and still at its stop: it counts as standing there.)
      if (res && !(res.free && ru.at)) {
        if (this.clashes(res.free ? this.occupancy(tu) : res.claims, res.free ? 0 : res.from)) hard.push(u);
        // Heading for our stop too, ahead of us: where it goes on from there, there (it may turn back at it).
        else if (!res.free && !ru.at && res.target === target && res.claims.length > 0) {
          const on = this.onward(u, ru, res.claims[res.claims.length - 1]);
          if (on && this.clashesOn(on, last)) hard.push(u);
        }
        continue;
      }
      // Standing at its stop, not yet sent on: the pieces it stands on (unless it's heading our way: we follow it), and
      // where it goes next, at our stop (a stop it can't share with us: a terminus it turns back at, say).
      const uTarget = host.stopPiece(ru.stops[stopAfter(ru, ru.next % ru.stops.length)].depotId);
      const theirs = uTarget < 0 ? null : this.pending(u, tu, uTarget);
      const uAt = host.stopPiece(ru.stops[ru.next % ru.stops.length].depotId);
      if (this.clashes(this.occupancy(tu), 0) || (uAt === target && theirs && this.clashesOn(theirs, last))) {
        hard.push(u);
        standing.push(u);
        if (loop === -1 && still && tu.speed < 1 && this.waitsOn(u, engine, live.length)) loop = u;
        continue;
      }
      // Both ready: the one ready first goes first (unless it can't go either).
      const uv = this.visits.get(u);
      if (theirs && soft === -1 && uv && !uv.granted && uv.hard.length === 0 && (uv.readySince < v.readySince || (uv.readySince === v.readySince && u < engine)) && this.clashes(theirs, 0)) soft = u;
    }
    return { hard, standing, soft, loop, quiet };
  }

  /**
   * Does `u` wait, standing, on `engine` (directly, or through a chain of trains each standing in the next one's way,
   * as last looked)? A mutual wait: none of them can go first.
   */
  private waitsOn(u: number, engine: number, most: number): boolean {
    let x = u;
    for (let k = 0; k < most; k++) {
      const vx = this.visits.get(x);
      if (!vx || vx.granted || vx.standing.length === 0) return false;
      if (vx.standing.includes(engine)) return true;
      x = vx.standing[0];
    }
    return false;
  }

  /** Do these claims (from index `from`) clash with this check's own? */
  private clashes(claims: readonly Claim[], from: number): boolean {
    for (let k = from; k < claims.length; k++) {
      const c = claims[k];
      const at = this.mine.get(c.pieceId);
      if (at) for (const m of at) if (headOn(m, c)) return true;
    }
    return false;
  }

  /** Do these claims clash with this check's own on piece `pieceId` (its stop)? */
  private clashesOn(claims: readonly Claim[], pieceId: number): boolean {
    const at = this.mine.get(pieceId);
    if (!at) return false;
    for (const c of claims) if (c.pieceId === pieceId) for (const m of at) if (headOn(m, c)) return true;
    return false;
  }

  /** Send it on, claiming `claims` (its way from its stop). */
  private grant(engine: number, v: Visit, claims: readonly Claim[] | null, target: number): boolean {
    v.granted = true;
    v.wait = null;
    v.hard = [];
    v.standing = [];
    if (claims) this.reserve(engine, claims, false, target);
    return false;
  }

  /** Let it go with no claim (timed out, or sent on by the player). */
  private letGo(engine: number, v: Visit): void {
    v.granted = true;
    v.wait = null;
    v.hard = [];
    v.standing = [];
    this.reserve(engine, [], true, -1);
  }

  private reserve(engine: number, claims: readonly Claim[], free: boolean, target: number): void {
    const { layout, sim } = this.host;
    const trainId = sim.findCar(engine)?.train.id ?? -1;
    this.reservations.set(engine, { claims, from: 0, revision: layout.revision, routing: layout.routingVersion, made: sim.ticks, free, target, trainId });
  }

  /**
   * Another train's claim, brought up to date: let go behind its tail; worked out afresh from its tail if it has none
   * between stops, if the track or a pin changed, or if it turned back from meeting a train. Null: standing at its stop,
   * not yet sent on.
   */
  private reservation(engine: number, train: Train, r: Route): Reservation | null {
    const { layout, sim } = this.host;
    let res = this.reservations.get(engine);
    if (!res && r.at) return null;
    const target = this.host.stopPiece(r.stops[r.at ? stopAfter(r, r.next % r.stops.length) : r.next % r.stops.length].depotId);
    const turned = !!res && train.turnback < 0 && train.lastTurn?.cause === "train" && train.lastTurn.tick >= res.made;
    if (!res || res.trainId !== train.id || (!res.free && (res.revision !== layout.revision || res.routing !== layout.routingVersion || res.target !== target || turned))) {
      const claims = target < 0 ? null : r.at ? this.pending(engine, train, target) : this.fromTail(train, target);
      this.reserve(engine, claims ?? [], claims === null, target);
      res = this.reservations.get(engine)!;
      if (turned) res.made = sim.ticks + 1;
    }
    if (!res.free && res.claims.length > 0) {
      // Let go behind its tail: the first claim still under one of its axles. None: it's off its way (a switch thrown
      // under it, say), so its way is worked out again from where its tail is.
      let on = false;
      for (let k = res.from; k < res.claims.length && !on; k++) {
        const id = res.claims[k].pieceId;
        if (train.bogies.some((b) => b.pieceId === id)) {
          res.from = k;
          on = true;
        }
      }
      if (!on && target >= 0) {
        const claims = r.at ? this.pending(engine, train, target) : this.fromTail(train, target);
        this.reserve(engine, claims ?? [], claims === null, target);
        res = this.reservations.get(engine)!;
      }
    }
    return res;
  }

  /** The pieces a train stands on, the way it's heading. */
  private occupancy(train: Train): Claim[] {
    const { layout } = this.host;
    const back = this.host.drive(train) < 0;
    const out: Claim[] = [];
    for (const b of train.bogies) {
      const piece = layout.getPiece(b.pieceId);
      if (!piece) continue;
      const path = getPieceDef(piece.type, piece.flipped).paths[b.pathIndex];
      const forward = b.reversed === back;
      const entry = forward ? path.from : (path.to ?? -1);
      const exit = forward ? (path.to ?? -1) : path.from;
      if (!out.some((c) => c.pieceId === b.pieceId && c.entry === entry)) out.push({ pieceId: b.pieceId, pathIndex: b.pathIndex, back: !forward, entry, exit });
    }
    return out;
  }

  /** The cursor at a train's front, pointing the way it goes (its tail's, with `tail`). */
  private end(train: Train, tail: boolean): Cursor {
    const back = this.host.drive(train) < 0;
    const lead = back === tail;
    const c: Cursor = { ...(lead ? train.bogies[0] : train.bogies[train.bogies.length - 1]) };
    if (back) flipCursor(this.host.layout, c);
    return c;
  }

  /** A train's way from its front to the middle of piece `target`, as claims: cached while it stands. */
  private pending(engine: number, train: Train, target: number): readonly Claim[] | null {
    const { layout } = this.host;
    const f = this.end(train, false);
    const p = this.pendingLegs.get(engine);
    if (p && p.pieceId === f.pieceId && p.pathIndex === f.pathIndex && p.reversed === f.reversed && p.target === target && p.revision === layout.revision && p.routing === layout.routingVersion) return p.claims;
    const claims = claimsOf(layout, legFromCursor(layout, f, target));
    this.pendingLegs.set(engine, { pieceId: f.pieceId, pathIndex: f.pathIndex, reversed: f.reversed, target, revision: layout.revision, routing: layout.routingVersion, claims });
    return claims;
  }

  /**
   * Where a train heading for its next stop goes on from there (from the middle of the stop, the way it comes in by
   * `arrive`, its last claim), as claims; cached per train, stop and revisions.
   */
  private onward(engine: number, r: Route, arrive: Claim): readonly Claim[] | null {
    const { layout } = this.host;
    const after = this.host.stopPiece(r.stops[stopAfter(r, r.next % r.stops.length)].depotId);
    if (after < 0) return null;
    const o = this.onwardLegs.get(engine);
    if (o && o.pieceId === arrive.pieceId && o.pathIndex === arrive.pathIndex && o.reversed === arrive.back && o.target === after && o.revision === layout.revision && o.routing === layout.routingVersion) return o.claims;
    const piece = layout.getPiece(arrive.pieceId);
    if (!piece) return null;
    const mid = pathLength(getPieceDef(piece.type, piece.flipped).paths[arrive.pathIndex].geom) / 2;
    const claims = claimsOf(layout, legFromCursor(layout, { pieceId: arrive.pieceId, pathIndex: arrive.pathIndex, reversed: arrive.back, s: mid }, after));
    this.onwardLegs.set(engine, { pieceId: arrive.pieceId, pathIndex: arrive.pathIndex, reversed: arrive.back, target: after, revision: layout.revision, routing: layout.routingVersion, claims });
    return claims;
  }

  /** A train's way from its tail to the middle of piece `target`, as claims (the pieces it's on, and on ahead). */
  private fromTail(train: Train, target: number): Claim[] | null {
    return claimsOf(this.host.layout, legFromCursor(this.host.layout, this.end(train, true), target));
  }

  /**
   * It came to its next stop: its claim is over. `lever`: its lever's tick now (set again during the visit, even while
   * it's held for spacing, the player has sent it on).
   */
  arrived(engine: number, lever = 0): void {
    this.reservations.delete(engine);
    this.visits.delete(engine);
    this.leverAt.set(engine, lever);
  }

  /** It left its stop (its claim, if it made one, goes with it). */
  departed(engine: number): void {
    this.visits.delete(engine);
    this.leverAt.delete(engine);
  }

  /** Is it waiting (or braking to wait) at its stop now? */
  holding(engine: number): boolean {
    const v = this.visits.get(engine);
    return !!v && !v.granted && v.wait !== null;
  }

  /** Why it's waiting at its stop, if it is (asked this tick or the last), for its card. */
  waitOf(engine: number, now: number): CrossWait | null {
    const v = this.visits.get(engine);
    return v && !v.granted && v.wait && now - v.asked <= 1 ? v.wait : null;
  }

  /** What it still claims (for tests): pieces with the ends it goes in and out by; null if nothing. */
  claimOf(engine: number): readonly Claim[] | null {
    const train = this.host.sim.findCar(engine)?.train;
    const r = this.host.route(engine);
    const res = train && r && r.stops.length > 0 ? this.reservation(engine, train, r) : null;
    return res && !res.free ? res.claims.slice(res.from) : null;
  }

  /** Forget engines no longer running a line, and any that came off the rails (they claim afresh when back). */
  prune(engines: ReadonlySet<number>, derailed: (engine: number) => boolean = () => false): void {
    for (const id of this.reservations.keys()) if (!engines.has(id) || derailed(id)) this.reservations.delete(id);
    for (const id of this.visits.keys()) if (!engines.has(id)) this.visits.delete(id);
    for (const id of this.pendingLegs.keys()) if (!engines.has(id)) this.pendingLegs.delete(id);
    for (const id of this.onwardLegs.keys()) if (!engines.has(id)) this.onwardLegs.delete(id);
    for (const id of this.leverAt.keys()) if (!engines.has(id)) this.leverAt.delete(id);
  }

  /** Forget a train's claim (it came off the rails, or was taken off its line). */
  drop(engine: number): void {
    this.reservations.delete(engine);
    this.visits.delete(engine);
  }
}

/** A way's runs as claims: each piece, and the ends it's come in and gone out by. */
export function claimsOf(layout: Layout, runs: readonly PathRun[] | null): Claim[] | null {
  if (!runs) return null;
  const out: Claim[] = [];
  for (const r of runs) {
    const piece = layout.getPiece(r.pieceId);
    if (!piece) continue;
    const path = getPieceDef(piece.type, piece.flipped).paths[r.pathIndex];
    const forward = r.s1 >= r.s0;
    out.push({ pieceId: r.pieceId, pathIndex: r.pathIndex, back: !forward, entry: forward ? path.from : (path.to ?? -1), exit: forward ? (path.to ?? -1) : path.from });
  }
  return out;
}
