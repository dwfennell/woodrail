import { getPieceDef, pathLength, type Layout } from "../track";
import { ACCELERATION, CAR_SPECS, flipCursor, SIM_DT, type Cursor, type Sim, type Train } from "../sim";
import { aheadRuns, legFromCursor, type PathRun } from "../game/route-path";
import { carsLength, loopRoadAt, loopRuns, passingLoops, STAND_SHORT, TAIL_CLEAR, type LoopRun as ThroughRun, type PassingLoop } from "../game/passing-loop";

/** A train waiting in a loop stands this far (mm) short of its far switch, and its tail this far clear of the near one. */
export { STAND_SHORT, TAIL_CLEAR };
import { next, type AvoidTest } from "./steer";
import type { Route } from "./economy";

/**
 * Trains that wait for each other (routes Phase 3). A routed train on a line with two or more trains running waits,
 * at its stop or in a passing loop, till the way on to the next stop or loop is clear of its line's trains coming the
 * other way; so trains of one line cross at stops where their ways part and in passing loops, and never meet head on
 * between them.
 *
 * - **Its way** is what steering will do (`legFromCursor`, which walks as `steer` chooses and honours pinned switches),
 *   from its front to the middle of its next stop, as claims: each piece it goes over and the ends it goes in and out
 *   by. Two claims on one piece clash when they meet head on there (one goes out by the end the other comes in by):
 *   the same road both ways, or a switch's stem from two of its roads. Roads that only merge or part (both going the
 *   same way) don't clash: following trains are left to signals and the sim's braking.
 * - **Sections** (Phase 3b): a way is cut at every passing loop it runs through (in by one switch's stem, along one
 *   road, out by the other's), where the train fits on the road it takes, clear of both switches, and neither switch
 *   is pinned (a pinned switch wins: the loop is no passing place, and the train waits as at a stop). A section runs
 *   from a stop or loop to the next loop or stop. A train claims one section at a time, as it's about to enter it.
 * - **Claimed on entering** (first come, first served): a train sent on from its stop reserves its first section; one
 *   coming up to a loop's far switch (a virtual signal there, at red) reserves the next one, or, if it can't, stands
 *   on the loop's road short of the switch, its whole length clear of both switches, braking as for a signal
 *   (`gateCap`). Each piece is let go as its tail clears it (looked at only when another train asks), and the rest
 *   when it comes to its stop. A train between stops that holds none (a loaded game, one that ran through its stop, a
 *   way changed under it) is given its way from its tail on, up to the section it's in; a turn back from meeting a
 *   train head on, or a change to the track or a pin, works it out again. A way worked out again like this that runs
 *   through a loop is claimed only as far as it's clear, the rest at a virtual signal as at a far switch (`releg`). A
 *   section into a loop needs the road it would stand on clear of the line's other trains either way, and one out of
 *   a loop waits for a train coming out by its other road. A train held at a red signal keeps its claim.
 * - **The free road** (`steerAvoid`): steering is told to keep off a loop's road a train of the line coming the other
 *   way is on or has claimed (and off the other road of a loop the train has claimed its own road in), so trains
 *   meeting at a loop take a road each. The walks that make claims use the same hint, so they claim what steering
 *   does. A lone train is never given one.
 * - **What it waits for**: a clash with another's claim; with a train standing at a stop on its way (unless it's
 *   heading the same way: then it follows); with where a train standing at, or heading for, its next stop goes on
 *   from there, there (a stop it can't share: a terminus the other turns back at); and, among trains that are both
 *   ready at their stops, with the way of the one that has waited longer (or, from the same moment, the lower engine
 *   id), unless that one can't go either.
 * - **Trains that each stand in the next one's way** (no passing place between them: a mutual wait): none can go
 *   first, so they say the line needs a passing loop. After `LOOP_WAIT_S` the one ready first is let go, as before
 *   (they meet and turn back); the player's line is never changed. Nothing waits for ever: a train is also let go once
 *   its line has been still (nothing moving or being worked) for `QUIET_S` (a train held at a red signal by hand, say),
 *   when the train it waits for turns back from meeting another (its claim no longer leads here), when that train has
 *   made no progress along its claim (nor been worked) for `LOOP_WAIT_S`, moving or not, and when its lever is set
 *   again (the player sends it on: "Go now").
 * - **Other lines and unrouted trains** are left alone: the player's signals rule them.
 *
 * Decided when a train is ready to go or comes up to a loop's far switch, and looked at again every `CHECK_TICKS`
 * while it waits; per tick, only a train with a section still to claim works out how far it has to its loop's far
 * switch. Ways are cached per train, keyed on where it stands and the track's revisions. Nothing here is saved.
 */

/** How often (economy ticks) a waiting train looks again. */
export const CHECK_TICKS = 12;
/** Two trains each in the other's way (no passing place): after this long (s) the one ready first is let go. */
export const LOOP_WAIT_S = 30;
/** A waiting train is let go once nothing on its line has moved or been worked for this long (s). */
export const QUIET_S = 20;
/** How far (mm) on its way a train at its stop looks for track another train of its line holds (`stopCap`). */
const STOP_LOOK = 300;
/** A train coming up to a loop's far switch asks for the section beyond this far (mm) before it would start to brake. */
const GATE_LOOK = 24;

/** One piece a train's way goes over, and the ends it comes in and goes out by (connector indices; −1: a buffer). */
export interface Claim {
  pieceId: number;
  /** The path it goes along, and whether against the path's own way (from its `to` end to its `from`). */
  pathIndex: number;
  back: boolean;
  entry: number;
  exit: number;
  /** How far (mm) the way runs on this piece. */
  len: number;
}

/** Why a train waits, for its card. */
export type CrossWait =
  /** For a train of its line: coming from a stop (`moving`), or standing at one; at its stop, or in a loop (`atLoop`). */
  | { kind: "waiting"; lineId: number; engine: number; depotId: number; moving: boolean; atLoop: boolean }
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
  /** The engines running this engine's line now (on the track, not derailed), and the line's id (−1: none). */
  live(engine: number): readonly number[];
  lineOf(engine: number): number;
}

interface Reservation {
  /** Its way, to its next stop; it holds claims `from` to `upto` (the rest are sections still to claim). */
  claims: readonly Claim[];
  /** Claims before this one are let go (its tail has cleared them). */
  from: number;
  /** Claims from this one on aren't held yet: the far switch of the loop it's to stand in, if the next is refused. */
  upto: number;
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
  /** Those of them standing (at their stops, or in a loop): in a mutual wait, each is in the other's. */
  standing: number[];
  /** When its line last had something moving or being worked, and when it first stood in a mutual wait (−1: not). */
  quietSince: number;
  loopSince: number;
  /** In a loop: the far switch it waits at. */
  far: number;
  /** When (sim tick) it began to wait: a train it waits for that turns back from meeting another after this lets it go. */
  since: number;
  /**
   * The train it last waited for, and that train's progress: its claim (when made) and how far its tail had got along
   * it; and when (economy tick) it last made progress (got further along its claim, or was worked at a depot).
   */
  by: number;
  byMade: number;
  byFrom: number;
  progressAt: number;
}

interface CachedLeg {
  key: string;
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

/** A train's length (mm), buffer face to buffer face. */
export const trainLength = (train: Train): number => carsLength(train.cars);

const newVisit = (now: number, lever: number, since: number): Visit => ({
  readySince: now,
  lever,
  asked: now,
  checkedAt: -Infinity,
  granted: false,
  wait: null,
  hard: [],
  standing: [],
  quietSince: now,
  loopSince: -1,
  far: -1,
  since,
  by: -1,
  byMade: -1,
  byFrom: -1,
  progressAt: now,
});

export class Crossing {
  private readonly reservations = new Map<number, Reservation>();
  private readonly visits = new Map<number, Visit>();
  /** Trains coming up to, or standing at, a loop's far switch with the next section still to claim. */
  private readonly gates = new Map<number, Visit>();
  private readonly pendingLegs = new Map<number, CachedLeg>();
  private readonly hintedLegs = new Map<number, CachedLeg>();
  private readonly tailLegs = new Map<number, CachedLeg>();
  private readonly onwardLegs = new Map<number, CachedLeg>();
  /** Each way's runs through loops (per claims list, and the revision they were found on). */
  private readonly runCache = new WeakMap<readonly Claim[], { revision: number; runs: readonly ThroughRun[] }>();
  /** Scratch: this check's own claims by piece; the loop road it would stand on, and its claim out of a loop (`scan`). */
  private readonly mine = new Map<number, Claim[]>();
  private standOn: ReadonlySet<number> | null = null;
  /** Working out how far a way afresh is clear (`releg`): another's way worked out meanwhile isn't clipped. */
  private clipping = false;
  private mergeAt: Claim | null = null;
  /** Each engine's lever tick when it came to its stop (see `arrived`). */
  private readonly leverAt = new Map<number, number>();
  /** When (sim tick) each engine last turned back from meeting a train (seen as its speed limit is asked: `gateCap`). */
  private readonly metAt = new Map<number, number>();
  /** When (economy tick) a routed engine between stops with no claim was last looked at (see `gateCap`). */
  private readonly unclaimedAt = new Map<number, number>();
  /** Trains at their stops, not yet sent on: the piece ahead of each one's front, and whether another holds it. */
  private readonly stopAhead = new Map<number, { pieceId: number; checked: number; blocked: number; room: number }>();
  /** Engines that have just reserved a section: steer them now (their hint changed). */
  readonly steerSoon = new Set<number>();

  /** Off: no train waits (for comparisons: the balance play-through, tests). */
  enabled = true;
  /** Off: trains wait only at stops, a whole leg at a time (Phase 3a; for comparisons). */
  loops = true;

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
      v = newVisit(now, this.leverAt.get(engine) ?? lever, this.host.sim.ticks);
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
    const leg = target < 0 ? null : this.pendingFor(engine, train, target, live);
    if (!leg || leg.length === 0) return this.grant(engine, v, leg, target);
    // Its first section: to the first loop it would wait in, or the stop.
    const upto = this.uptoAfter(leg, train, 0);
    const s = this.scan(engine, train, upto === leg.length ? leg : leg.slice(0, upto), target, live, v, upto === leg.length, this.standRoad(leg, upto));
    v.hard = s.hard;
    v.standing = s.standing;
    if (s.hard.length === 0 && s.soft === -1) return this.grant(engine, v, leg, target, upto);
    return this.waitOn(engine, lineId, now, v, s, false);
  }

  /**
   * It must wait (`s`, from `scan`): unless it's let go (a mutual wait timed out, its line still too long), why, for
   * its card. True: it waits.
   */
  private waitOn(engine: number, lineId: number, now: number, v: Visit, s: ReturnType<Crossing["scan"]>, atLoop: boolean): boolean {
    const { host } = this;
    // (In a mutual wait the line is still because of the wait itself: that has its own release, below.)
    if (!s.quiet || s.loop !== -1) v.quietSince = now;
    if (s.loop !== -1) {
      v.progressAt = now;
      v.by = -1;
    }
    if (s.loop !== -1) {
      if (v.loopSince < 0) v.loopSince = now;
    } else v.loopSince = -1;
    if (s.loop === -1 && now - v.quietSince >= QUIET_S / SIM_DT) {
      this.letGo(engine, v);
      return false;
    }
    // A train it waits for has turned back from meeting another since it began to wait: its claim no longer leads here
    // as it did (and, bouncing, it never stands still for the quiet release). Let it go.
    for (const u of s.hard)
      if ((this.metAt.get(u) ?? -Infinity) >= v.since) {
        this.letGo(engine, v);
        return false;
      }
    // Every hold is capped: the train it waits for has made no progress for LOOP_WAIT_S (moving or not, it hasn't got
    // further along its claim, nor been worked at a depot).
    if (s.loop === -1) {
      const by = s.hard.length > 0 ? s.hard[0] : s.soft;
      const res = this.reservations.get(by);
      const made = res && !res.free ? res.made : -1;
      const from = res && !res.free ? res.from : -1;
      const tb = host.sim.findCar(by)?.train;
      if (by !== v.by || (made === v.byMade && from > v.byFrom) || (tb && host.busy(tb, by))) v.progressAt = now;
      v.by = by;
      v.byMade = made;
      v.byFrom = from;
      if ((now - v.progressAt) * SIM_DT >= LOOP_WAIT_S) {
        this.letGo(engine, v);
        return false;
      }
    }
    // In a mutual wait (no passing place between them), after a while the one ready first is let go, as before.
    if (s.loop !== -1) {
      const lv = this.visitOf(s.loop);
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
      const inLoop = !rb.at && !!this.gates.get(by)?.wait;
      const stands = !inLoop && (s.standing.includes(by) || (!this.reservations.has(by) && !!rb.at));
      const i = rb.next % rb.stops.length;
      v.wait = { kind: "waiting", lineId, engine: by, depotId: rb.stops[stands ? i : stopBefore(rb, i)].depotId, moving: !stands, atLoop };
    }
    return true;
  }

  /**
   * The line's other trains a section (`mine`, of a way to piece `target`; `toStop`: it runs to the stop) clashes
   * with: outright (`hard`; those standing, at their stops or in a loop, in `standing`), and, among trains both ready
   * at their stops, the one that goes first (`soft`); a train in a mutual wait with this one (`loop`), and whether
   * nothing on the line is moving or being worked (`quiet`). A section that ends in a loop needs the road it's to stand
   * on (`stand`) clear of the line's other trains whichever way they go (it stands its whole length there), and one
   * out of a loop by its far switch (`merge`, its claim there) clashes with another coming out of it by its other road.
   */
  private scan(engine: number, train: Train, mine: readonly Claim[], target: number, live: readonly number[], v: Visit, toStop: boolean, stand: ReadonlySet<number> | null = null, merge: Claim | null = null) {
    const { host } = this;
    this.standOn = stand;
    this.mergeAt = merge;
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
      const res = this.reservation(u, tu, ru, live);
      // (Let go and still at its stop: it counts as standing there.)
      if (res && !(res.free && ru.at)) {
        if (res.free ? this.clashes(this.occupancy(tu), 0) : this.clashes(res.claims, res.from, res.upto)) {
          hard.push(u);
          // Standing in a loop, waiting for the section on: in a mutual wait, it can't go first either.
          if (!res.free && this.gates.get(u)?.wait && tu.speed < 1) {
            standing.push(u);
            if (loop === -1 && still && this.waitsOn(u, engine, live.length)) loop = u;
          }
        }
        // Heading for our stop too, ahead of us (its way there claimed): where it goes on from there, there (it may turn
        // back at it).
        else if (toStop && !res.free && !ru.at && res.target === target && res.claims.length > 0 && res.upto >= res.claims.length) {
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
      if (this.clashes(this.occupancy(tu), 0) || (toStop && uAt === target && theirs && this.clashesOn(theirs, last))) {
        hard.push(u);
        standing.push(u);
        if (loop === -1 && still && tu.speed < 1 && this.waitsOn(u, engine, live.length)) loop = u;
        continue;
      }
      // Both ready: the one ready first goes first (unless it can't go either); what it would claim is its first section.
      const uv = this.visits.get(u);
      if (theirs && soft === -1 && uv && !uv.granted && uv.hard.length === 0 && (uv.readySince < v.readySince || (uv.readySince === v.readySince && u < engine)) && this.clashes(theirs, 0, this.uptoAfter(theirs, tu, 0))) soft = u;
    }
    return { hard, standing, soft, loop, quiet };
  }

  /** A train's visit: at its stop, or at a loop's far switch. */
  private visitOf(engine: number): Visit | undefined {
    return this.visits.get(engine) ?? this.gates.get(engine);
  }

  /**
   * Does `u` wait, standing, on `engine` (directly, or through a chain of trains each standing in the next one's way,
   * as last looked)? A mutual wait: none of them can go first.
   */
  private waitsOn(u: number, engine: number, most: number): boolean {
    let x = u;
    for (let k = 0; k < most; k++) {
      const vx = this.visitOf(x);
      if (!vx || vx.granted || vx.standing.length === 0) return false;
      if (vx.standing.includes(engine)) return true;
      x = vx.standing[0];
    }
    return false;
  }

  /** Do these claims (from index `from`, up to `to`) clash with this check's own? */
  private clashes(claims: readonly Claim[], from: number, to = claims.length): boolean {
    const stand = this.standOn;
    const merge = this.mergeAt;
    for (let k = from; k < to; k++) {
      const c = claims[k];
      if (stand?.has(c.pieceId)) return true;
      if (merge && c.pieceId === merge.pieceId && c.exit === merge.exit && c.entry !== merge.entry) return true;
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

  /** Send it on, claiming `claims` (its way from its stop) up to `upto`. */
  private grant(engine: number, v: Visit, claims: readonly Claim[] | null, target: number, upto?: number): boolean {
    v.granted = true;
    v.wait = null;
    v.hard = [];
    v.standing = [];
    if (claims) this.reserve(engine, claims, false, target, upto);
    return false;
  }

  /** Let it go with no claim (timed out, or sent on by the player). */
  private letGo(engine: number, v: Visit): void {
    v.granted = true;
    v.wait = null;
    v.hard = [];
    v.standing = [];
    this.gates.delete(engine);
    this.reserve(engine, [], true, -1);
  }

  /** Reserve a way: claims up to `upto` (by default, to the end of the section the train's front is in). */
  private reserve(engine: number, claims: readonly Claim[], free: boolean, target: number, upto?: number): void {
    const { layout, sim } = this.host;
    const train = sim.findCar(engine)?.train;
    const trainId = train?.id ?? -1;
    // (Its way from its tail, between stops, may start in a loop: it may wait there. At its stop it's checked there.)
    const atStop = !!this.host.route(engine)?.at;
    const to = free ? 0 : (upto ?? (train ? this.uptoAfter(claims, train, atStop ? 0 : Math.max(0, this.frontIndex(claims, train, 0)), !atStop) : claims.length));
    this.reservations.set(engine, { claims, from: 0, upto: to, revision: layout.revision, routing: layout.routingVersion, made: sim.ticks, free, target, trainId });
    if (!free && to < claims.length) this.steerSoon.add(engine);
  }

  /**
   * Another train's claim, brought up to date: let go behind its tail; worked out afresh from its tail if it has none
   * between stops, if the track or a pin changed, or if it turned back from meeting a train. Null: standing at its stop,
   * not yet sent on.
   */
  private reservation(engine: number, train: Train, r: Route, liveNow?: readonly number[]): Reservation | null {
    const live = () => liveNow ?? this.host.live(engine);
    const { layout, sim } = this.host;
    let res = this.reservations.get(engine);
    if (!res && r.at) return null;
    const target = this.host.stopPiece(r.stops[r.at ? stopAfter(r, r.next % r.stops.length) : r.next % r.stops.length].depotId);
    const turned = !!res && train.turnback < 0 && train.lastTurn?.cause === "train" && train.lastTurn.tick >= res.made;
    if (!res || res.trainId !== train.id || (!res.free && (res.revision !== layout.revision || res.routing !== layout.routingVersion || res.target !== target || turned))) {
      const claims = target < 0 ? null : r.at ? this.pendingFor(engine, train, target, live()) : this.fromTail(engine, train, target, live());
      res = this.releg(engine, train, claims, target, live);
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
        const claims = r.at ? this.pendingFor(engine, train, target, live()) : this.fromTail(engine, train, target, live());
        res = this.releg(engine, train, claims, target, live);
      }
    }
    return res;
  }

  /**
   * A way worked out afresh (see `reservation`) is given without asking. Where it runs through a passing loop it could
   * wait in, it claims only as far ahead of its front as it's clear of the line's other trains (up to the end of its
   * section), and the rest as it comes up to it, as at a loop's far switch (`gateCap`), standing short of it if it
   * can't: a train turned back, or turned round at the end of the line, would otherwise run on to meet another again,
   * or up behind one waiting in the loop. (With no loop on its way it runs on as before: it was let go, or turned
   * back, and meets the other.)
   */
  private releg(engine: number, train: Train, claims: readonly Claim[] | null, target: number, live: () => readonly number[]): Reservation {
    this.reserve(engine, claims ?? [], claims === null, target);
    const res = this.reservations.get(engine)!;
    if (res.free || !this.loops || this.clipping || this.uptoAfter(res.claims, train, -1, true) >= res.claims.length) return res;
    const engines = live();
    if (engines.length < 2) return res;
    const k = Math.max(0, this.frontIndex(res.claims, train, 0));
    const dummy = newVisit(Infinity, 0, this.host.sim.ticks);
    this.clipping = true;
    try {
      for (let j = k + 2; j <= res.upto; j++) {
        const s = this.scan(engine, train, res.claims.slice(k + 1, j), target, engines, dummy, j === res.claims.length, j === res.upto ? this.standRoad(res.claims, j) : null);
        if (s.hard.length > 0) {
          res.upto = j - 1;
          break;
        }
      }
    } finally {
      this.clipping = false;
    }
    if (res.upto < res.claims.length) this.steerSoon.add(engine);
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
      if (!out.some((c) => c.pieceId === b.pieceId && c.entry === entry)) out.push({ pieceId: b.pieceId, pathIndex: b.pathIndex, back: !forward, entry, exit, len: 0 });
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

  /** A way from `start` to the middle of piece `target`, as claims, cached in `cache` by `key`. */
  private cached(cache: Map<number, CachedLeg>, engine: number, key: string, start: Cursor, target: number, on?: ReadonlyMap<number, number>, avoid?: AvoidTest): readonly Claim[] | null {
    const p = cache.get(engine);
    if (p && p.key === key) return p.claims;
    const claims = claimsOf(this.host.layout, legFromCursor(this.host.layout, start, target, { on, avoid }));
    cache.set(engine, { key, claims });
    return claims;
  }

  private keyOf(c: Cursor, target: number, extra = ""): string {
    const { layout } = this.host;
    return `${c.pieceId}:${c.pathIndex}:${c.reversed ? 1 : 0}:${target}:${layout.revision}:${layout.routingVersion}${extra}`;
  }

  /** A train's way from its front to the middle of piece `target`, as claims, as steering goes unhinted: cached while it stands. */
  private pending(engine: number, train: Train, target: number): readonly Claim[] | null {
    const f = this.end(train, false);
    return this.cached(this.pendingLegs, engine, this.keyOf(f, target), f, target);
  }

  /** `pending`, as steering will go with its hint (`steerAvoid`): the free road through loops another train is in. */
  private pendingFor(engine: number, train: Train, target: number, live: readonly number[]): readonly Claim[] | null {
    const plain = this.pending(engine, train, target);
    if (!plain || !this.loops || live.length < 2) return plain;
    const hint = this.avoidOn(engine, plain, 0, live, null);
    if (!hint) return plain;
    const f = this.end(train, false);
    return this.cached(this.hintedLegs, engine, this.keyOf(f, target, `|${hint.sig}`), f, target, undefined, hint.test) ?? plain;
  }

  /**
   * A train's way from its tail to the middle of piece `target`, as claims (the pieces it's on, the way it's on them,
   * and on ahead as steering goes, with its hint).
   */
  private fromTail(engine: number, train: Train, target: number, live: readonly number[]): Claim[] | null {
    const t = this.end(train, true);
    const on = new Map<number, number>();
    let sig = "";
    for (const b of train.bogies)
      if (!on.has(b.pieceId)) {
        on.set(b.pieceId, b.pathIndex);
        sig += `,${b.pieceId}.${b.pathIndex}`;
      }
    const key = this.keyOf(t, target, `|${train.id}${sig}`);
    const plain = this.cached(this.tailLegs, engine, key, t, target, on) as Claim[] | null;
    if (!plain || !this.loops || live.length < 2) return plain;
    const res = this.reservations.get(engine);
    const hint = this.avoidOn(engine, plain, 0, live, res && !res.free ? res : null);
    if (!hint) return plain;
    return claimsOf(this.host.layout, legFromCursor(this.host.layout, t, target, { on, avoid: hint.test })) ?? plain;
  }

  /**
   * Where a train heading for its next stop goes on from there (from the middle of the stop, the way it comes in by
   * `arrive`, its last claim), as claims; cached per train, stop and revisions.
   */
  private onward(engine: number, r: Route, arrive: Claim): readonly Claim[] | null {
    const { layout } = this.host;
    const after = this.host.stopPiece(r.stops[stopAfter(r, r.next % r.stops.length)].depotId);
    if (after < 0) return null;
    const piece = layout.getPiece(arrive.pieceId);
    if (!piece) return null;
    const mid = pathLength(getPieceDef(piece.type, piece.flipped).paths[arrive.pathIndex].geom) / 2;
    const start = { pieceId: arrive.pieceId, pathIndex: arrive.pathIndex, reversed: arrive.back, s: mid };
    return this.cached(this.onwardLegs, engine, this.keyOf(start, after), start, after);
  }

  // —— Sections at passing loops ——

  /** A way's runs through passing loops (cached per claims list). */
  private runsOf(claims: readonly Claim[]): readonly ThroughRun[] {
    const { layout } = this.host;
    const hit = this.runCache.get(claims);
    if (hit && hit.revision === layout.revision) return hit.runs;
    const runs = loopRuns(layout, claims);
    this.runCache.set(claims, { revision: layout.revision, runs });
    return runs;
  }

  /** The pieces of the loop road a way (`claims`) cut at `upto` would stand on (null: it runs to its stop). */
  private standRoad(claims: readonly Claim[], upto: number): ReadonlySet<number> | null {
    if (upto >= claims.length) return null;
    const run = this.runsOf(claims).find((r) => r.far === upto);
    return run ? new Set(passingLoops(this.host.layout)[run.loop].roads[run.road].pieces) : null;
  }

  /** Can trains pass in this loop (neither switch pinned: a pinned one wins)? */
  private usable(loop: PassingLoop): boolean {
    return !this.host.layout.isPinned(loop.a) && !this.host.layout.isPinned(loop.b);
  }

  /**
   * Where a train's way (`claims`) is cut into sections: the far switches (claim indices) of the loops it runs through
   * that it can wait in, after claim `after` (`inLoop`: one it starts in counts too); the first of them, or the way's end.
   */
  private uptoAfter(claims: readonly Claim[], train: Train, after: number, inLoop = false): number {
    if (!this.loops) return claims.length;
    const runs = this.runsOf(claims);
    if (runs.length === 0) return claims.length;
    const loops = passingLoops(this.host.layout);
    const need = trainLength(train) + STAND_SHORT + TAIL_CLEAR;
    let best = claims.length;
    for (const run of runs) if (run.far > after && run.far < best && (inLoop || run.entry !== -1) && run.length >= need && this.usable(loops[run.loop])) best = run.far;
    return best;
  }

  /** The index of the claim (from `from`) a train's front is on; −1 if none. */
  private frontIndex(claims: readonly Claim[], train: Train, from: number, to = claims.length): number {
    const f = this.end(train, false);
    for (let k = from; k < to; k++) if (claims[k].pieceId === f.pieceId && claims[k].pathIndex === f.pathIndex) return k;
    return -1;
  }

  /**
   * How far (mm) a train holding `res` has to go to where it would stand short of the far switch its claim ends at
   * (its front's buffer face `STAND_SHORT` short of it); null if its front isn't on its claim.
   */
  private roomTo(res: Reservation, train: Train): number | null {
    const k = this.frontIndex(res.claims, train, res.from, res.upto);
    if (k === -1) return null;
    const f = this.end(train, false);
    const piece = this.host.layout.getPiece(f.pieceId);
    if (!piece) return null;
    let d = pathLength(getPieceDef(piece.type, piece.flipped).paths[f.pathIndex].geom) - f.s;
    for (let i = k + 1; i < res.upto; i++) d += res.claims[i].len;
    const lead = this.host.drive(train) < 0 ? train.cars[train.cars.length - 1] : train.cars[0];
    return d - CAR_SPECS[lead.kind].bogieInset - STAND_SHORT;
  }

  /**
   * The speed limit (mm/s) on a routed train coming up to a passing loop's far switch with the section beyond still to
   * claim (a virtual signal there): it asks for that section as it comes near; refused, it brakes (at the sim's
   * `ACCELERATION`) to stand short of the switch, on the loop's road, and waits there. Infinity otherwise.
   */
  gateCap(train: Train, now: number): number {
    if (!this.enabled) return Infinity;
    const met = train.lastTurn;
    if (met?.cause === "train") for (const car of train.cars) if (car.kind === "engine") this.metAt.set(car.id, met.tick);
    if (!this.loops) return Infinity;
    for (const car of train.cars) {
      let res = this.reservations.get(car.id);
      if (!res) {
        if (car.kind !== "engine") continue;
        const at = this.host.route(car.id);
        // At its stop, not yet sent on (being worked, say, its wagons drawn up under the crane in turn): it mustn't
        // creep out onto track a train of its line holds or stands on (one waiting in a loop beside the stop).
        if (at?.at && this.host.lineOf(car.id) >= 0) return this.stopCap(car.id, train, now);
        // A routed train between stops that holds no claim (a loaded game; its line just given a second train): now and
        // then, its way from its tail (it may be in a loop, or coming up to one, with a train coming the other way).
        if (now - (this.unclaimedAt.get(car.id) ?? -Infinity) < CHECK_TICKS) continue;
        const r = at;
        if (!r || r.at || r.stops.length === 0 || this.host.lineOf(car.id) < 0) continue;
        this.unclaimedAt.set(car.id, now);
        const live = this.host.live(car.id);
        if (live.length < 2) continue;
        res = this.reservation(car.id, train, r, live) ?? undefined;
        if (!res) continue;
      }
      if (res.free || res.upto >= res.claims.length) return Infinity;
      const r = this.host.route(car.id);
      if (!r || r.stops.length === 0) return Infinity;
      return this.gate(car.id, train, r, now);
    }
    return Infinity;
  }

  /**
   * The speed limit on a train at its stop, not yet sent on: short of the first piece ahead of it (the next
   * `STOP_LOOK` mm, as the switches are set) that a train of its line holds or stands on (looked at every
   * `CHECK_TICKS`), braking as for a signal. Infinity otherwise.
   */
  private stopCap(engine: number, train: Train, now: number): number {
    const { host } = this;
    const live = host.live(engine);
    if (live.length < 2) return Infinity;
    const f = this.end(train, false);
    let b = this.stopAhead.get(engine);
    if (!b || b.pieceId !== f.pieceId || now - b.checked >= CHECK_TICKS) {
      let blocked = -1;
      let room = 0;
      // (Where the switches send it now: a train being worked creeps on past its stop, whatever its way.)
      const leg = aheadRuns(host.layout, f, STOP_LOOK);
      for (let k = 1; k < leg.length && blocked === -1; k++) {
          const id = leg[k].pieceId;
          for (const u of live) {
            const tu = u === engine ? undefined : host.sim.findCar(u)?.train;
            if (!tu || tu === train) continue;
            const res = this.reservations.get(u);
            let held = tu.bogies.some((x) => x.pieceId === id);
            if (!held && res && !res.free) for (let j = res.from; j < res.upto && !held; j++) held = res.claims[j].pieceId === id;
            if (held) {
              blocked = k;
              break;
            }
          }
          if (blocked === -1) room += Math.abs(leg[k].s1 - leg[k].s0);
        }
      // (Nor onto a switch just before it: it would foul the other road.)
      while (blocked > 1) {
        const sw = host.layout.getPiece(leg[blocked - 1].pieceId);
        if (!sw || !getPieceDef(sw.type, sw.flipped).isSwitch) break;
        blocked--;
        room -= Math.abs(leg[blocked].s1 - leg[blocked].s0);
      }
      // (Room: from the end of the piece its front is on to the blocked piece.)
      this.stopAhead.set(engine, (b = { pieceId: f.pieceId, checked: now, blocked, room }));
    }
    if (b.blocked === -1) return Infinity;
    const piece = host.layout.getPiece(f.pieceId);
    if (!piece) return Infinity;
    const lead = host.drive(train) < 0 ? train.cars[train.cars.length - 1] : train.cars[0];
    const room = pathLength(getPieceDef(piece.type, piece.flipped).paths[f.pathIndex].geom) - f.s + b.room - CAR_SPECS[lead.kind].bogieInset - STAND_SHORT;
    return room > 0 ? Math.sqrt(2 * ACCELERATION * room) : 0;
  }

  private gate(engine: number, train: Train, r: Route, now: number): number {
    const res = this.reservation(engine, train, r);
    if (!res || res.free || res.upto >= res.claims.length) {
      this.gates.delete(engine);
      return Infinity;
    }
    const room = this.roomTo(res, train);
    if (room === null) return Infinity;
    const far = res.claims[res.upto].pieceId;
    const lever = train.leverTick ?? 0;
    let g = this.gates.get(engine);
    if (!g || g.far !== far) {
      g = newVisit(now, lever, this.host.sim.ticks);
      g.far = far;
      this.gates.set(engine, g);
    }
    g.asked = now;
    if (room <= (train.speed * train.speed) / (2 * ACCELERATION) + GATE_LOOK) {
      // Sent on by the player: let go.
      if (g.lever !== lever) {
        this.letGo(engine, g);
        return Infinity;
      }
      if (now - g.checkedAt >= CHECK_TICKS) {
        g.checkedAt = now;
        const live = this.host.live(engine);
        if (live.length < 2) {
          // Alone on its line now: nothing to wait for.
          res.upto = res.claims.length;
          this.gates.delete(engine);
          return Infinity;
        }
        if (this.tryGate(engine, train, r, res, g, live, now)) return Infinity;
      }
    }
    return room > 0 ? Math.sqrt(2 * ACCELERATION * room) : 0;
  }

  /** Claim the section beyond the loop it's in (true), or say why it waits. */
  private tryGate(engine: number, train: Train, r: Route, res: Reservation, g: Visit, live: readonly number[], now: number): boolean {
    void r;
    const lineId = this.host.lineOf(engine);
    const target = res.target;
    // Its way afresh from its tail (the free roads of loops further on as they are now).
    const leg = this.fromTail(engine, train, target, live) ?? res.claims;
    const k = this.frontIndex(leg, train, 0);
    // Where it stands waiting: its claim's end (a loop's far switch, or as far as it was clear), found in the new way.
    const end = res.claims[res.upto];
    let at = -1;
    for (let i = Math.max(0, k); i < leg.length && at === -1; i++) if (leg[i].pieceId === end.pieceId && leg[i].pathIndex === end.pathIndex) at = i;
    if (at === -1) at = this.uptoAfter(leg, train, Math.max(0, k), true);
    if (at >= leg.length) {
      this.gates.delete(engine);
      this.reserve(engine, leg, false, target, leg.length);
      return true;
    }
    const upto = this.uptoAfter(leg, train, at, true);
    const s = this.scan(engine, train, leg.slice(at, upto), target, live, g, upto === leg.length, this.standRoad(leg, upto), leg[at]);
    g.hard = s.hard;
    g.standing = s.standing;
    if (s.hard.length === 0 && s.soft === -1) {
      this.gates.delete(engine);
      this.reserve(engine, leg, false, target, upto);
      return true;
    }
    return !this.waitOn(engine, lineId, now, g, s, true);
  }

  /**
   * The roads of loops on a way (`leg`, from claim `from`) a train should keep off: in a loop it holds its own road in
   * (in `own`, from `own.from` to `own.upto`), the other road; else a road a train of its line coming the other way is
   * on, or holds. Null if none (or both of a loop's: there's no choosing). `sig` names them, for caches.
   */
  private avoidOn(engine: number, leg: readonly Claim[], from: number, live: readonly number[], own: Reservation | null): { test: AvoidTest; sig: string } | null {
    const runs = this.runsOf(leg);
    if (runs.length === 0) return null;
    const { layout } = this.host;
    const loops = passingLoops(layout);
    const roadAt = loopRoadAt(layout);
    let keys: number[] | null = null;
    for (const run of runs) {
      if (run.far < from || !this.usable(loops[run.loop])) continue;
      let ownRoad = -1;
      if (own)
        for (let k = own.from; k < own.upto && ownRoad === -1; k++) {
          const at = roadAt.get(own.claims[k].pieceId);
          if (at && at.loop === run.loop) ownRoad = at.road;
        }
      const add: number[] = [];
      if (ownRoad !== -1) add.push(1 - ownRoad);
      else for (const road of [0, 1]) if (this.opposedOn(engine, run.loop, road, run.toB, live)) add.push(road);
      // (Both roads: no choosing.)
      if (add.length === 1) (keys ??= []).push(run.loop * 2 + add[0]);
    }
    if (!keys) return null;
    const set = new Set(keys);
    return { test: (pieceId) => {
      const at = roadAt.get(pieceId);
      return !!at && set.has(at.loop * 2 + at.road);
    }, sig: [...set].sort((a, b) => a - b).join(",") };
  }

  /** Is a train of the line (other than `engine`) on, or holding, this road of this loop, going the other way (`toB`: ours)? */
  private opposedOn(engine: number, loop: number, road: number, toB: boolean, live: readonly number[]): boolean {
    const { layout, sim } = this.host;
    const roadAt = loopRoadAt(layout);
    const mine = sim.findCar(engine)?.train;
    for (const u of live) {
      if (u === engine) continue;
      const tu = sim.findCar(u)?.train;
      if (!tu || tu === mine) continue;
      const res = this.reservations.get(u);
      if (res && !res.free)
        for (let k = res.from; k < res.upto; k++) {
          const c = res.claims[k];
          const at = roadAt.get(c.pieceId);
          if (at && at.loop === loop && at.road === road && (c.entry === at.aEnd) !== toB) return true;
        }
      for (const c of this.occupancy(tu)) {
        const at = roadAt.get(c.pieceId);
        if (at && at.loop === loop && at.road === road && (c.entry === at.aEnd) !== toB) return true;
      }
    }
    return false;
  }

  /**
   * The hint for steering this train (see `steer`'s `avoid`): the roads of passing loops on its way it should keep
   * off (see `avoidOn`). Undefined for a lone train, or one with no way worked out: steering goes as ever.
   */
  steerAvoid(engine: number, train: Train): AvoidTest | undefined {
    if (!this.enabled || !this.loops || passingLoops(this.host.layout).length === 0) return undefined;
    const live = this.host.live(engine);
    if (live.length < 2) return undefined;
    const res = this.reservations.get(engine);
    if (res && !res.free && res.claims.length > 0) return this.avoidOn(engine, res.claims, res.from, live, res)?.test;
    const r = this.host.route(engine);
    if (!r?.at || r.stops.length === 0) return undefined;
    const target = this.host.stopPiece(r.stops[stopAfter(r, r.next % r.stops.length)].depotId);
    const p = target < 0 ? null : this.pending(engine, train, target);
    if (!p) return undefined;
    return this.avoidOn(engine, p, 0, live, null)?.test;
  }

  /**
   * It came to its next stop: its claim is over. `lever`: its lever's tick now (set again during the visit, even while
   * it's held for spacing, the player has sent it on).
   */
  arrived(engine: number, lever = 0): void {
    this.reservations.delete(engine);
    this.visits.delete(engine);
    this.gates.delete(engine);
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

  /**
   * Is this routed train stood still with a train of its own line just ahead (on the piece its front is on, or the
   * next)? That train's engine, or −1: for its card (it waits for that train, rather than "something's in the way").
   * Asked only by the card.
   */
  inTheWay(engine: number): number {
    const { layout, sim } = this.host;
    const train = sim.findCar(engine)?.train;
    if (!train || train.speed >= 1) return -1;
    const live = this.host.live(engine);
    if (live.length < 2) return -1;
    const f = this.end(train, false);
    const piece = layout.getPiece(f.pieceId);
    if (!piece) return -1;
    const path = getPieceDef(piece.type, piece.flipped).paths[f.pathIndex];
    const ahead = next(layout, f.pieceId, f.reversed ? path.from : (path.to ?? -1))?.pieceId ?? -1;
    for (const u of live) {
      const tu = u === engine ? undefined : sim.findCar(u)?.train;
      if (tu && tu !== train && tu.bogies.some((b) => b.pieceId === f.pieceId || b.pieceId === ahead)) return u;
    }
    return -1;
  }

  /** Why it's waiting at its stop or in a loop, if it is (asked this tick or the last), for its card. */
  waitOf(engine: number, now: number): CrossWait | null {
    const v = this.visits.get(engine);
    if (v && !v.granted && v.wait && now - v.asked <= 1) return v.wait;
    const g = this.gates.get(engine);
    return g && !g.granted && g.wait && now - g.asked <= 1 ? g.wait : null;
  }

  /** What it still claims (for tests): pieces with the ends it goes in and out by; null if nothing. */
  claimOf(engine: number): readonly Claim[] | null {
    const train = this.host.sim.findCar(engine)?.train;
    const r = this.host.route(engine);
    const res = train && r && r.stops.length > 0 ? this.reservation(engine, train, r) : null;
    return res && !res.free ? res.claims.slice(res.from, res.upto) : null;
  }

  /** Forget engines no longer running a line, and any that came off the rails (they claim afresh when back). */
  prune(engines: ReadonlySet<number>, derailed: (engine: number) => boolean = () => false): void {
    for (const id of this.reservations.keys()) if (!engines.has(id) || derailed(id)) this.reservations.delete(id);
    for (const id of this.gates.keys()) if (!engines.has(id) || derailed(id)) this.gates.delete(id);
    for (const m of [this.visits, this.pendingLegs, this.hintedLegs, this.tailLegs, this.onwardLegs, this.leverAt, this.unclaimedAt, this.metAt, this.stopAhead] as Map<number, unknown>[])
      for (const id of m.keys()) if (!engines.has(id)) m.delete(id);
  }

  /** Forget a train's claim (it came off the rails, or was taken off its line). */
  drop(engine: number): void {
    this.reservations.delete(engine);
    this.visits.delete(engine);
    this.gates.delete(engine);
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
    out.push({ pieceId: r.pieceId, pathIndex: r.pathIndex, back: !forward, entry: forward ? path.from : (path.to ?? -1), exit: forward ? (path.to ?? -1) : path.from, len: Math.abs(r.s1 - r.s0) });
  }
  return out;
}
