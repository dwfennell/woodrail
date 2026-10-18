import { getPieceDef, pathLength, type Layout } from "../track";
import { ACCELERATION, CAR_SPECS, flipCursor, SIM_DT, type Cursor, type Sim, type Train } from "../sim";
import { aheadRuns, legFromCursor, lineLegs, type PathRun } from "../game/route-path";
import { carsLength, loopRoadAt, loopRuns, passingLoops, STAND_SHORT, TAIL_CLEAR, type LoopRun as ThroughRun, type PassingLoop, type RoadAt } from "../game/passing-loop";

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
 * - **Blocks** (Phase 3c, `blocking`): a train leaving a passing place claims through to the next one along its route,
 *   every stop on single track between them included (a stop inside its own block keeps the claim: it calls and goes
 *   on). A passing place is a loop that cuts as above; a line with none is one block end to end; a lift, and the
 *   track beside it, is plain track. A block reaching a terminus (a stop the next leg turns back over) ends there with
 *   the turn-back, so a train can always turn back into its own block; with no passing place, one that would run up
 *   to a line-mate standing at the terminus ends short of it, and the train calls where it stands and turns there
 *   (`Sim.turnBack`, cause "short", see `shortCall`). Asks are granted at the end of the tick (`settle`), in the order
 *   the trains became ready (a tie: lower engine id). An empty claim means hold, never go. The releases below are
 *   only a safety net: each is logged (`releases`, `released`); in normal running there are none.
 * - **Other lines and unrouted trains** are left alone: the player's signals rule them.
 *
 * Decided when a train is ready to go or comes up to a loop's far switch, and looked at again every `CHECK_TICKS`
 * while it waits; per tick, only a train with a section still to claim works out how far it has to its loop's far
 * switch. Ways are cached per train, keyed on where it stands and the track's revisions. Nothing here is saved.
 */

/** A gate visit's `far` while a train between stops with no claim asks for one (`claimAsk`). */
const ASKING = -2;

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

/**
 * Why a waiting train was let go without a claim (the safety net): the player's Go now; its line still for `QUIET_S`;
 * the train it waited for turned back from meeting another; that train made no progress for `LOOP_WAIT_S`; a mutual
 * wait (no passing place between them) timed out after `LOOP_WAIT_S`.
 */
export type ReleaseWhy = "go-now" | "quiet" | "turned" | "stalled" | "mutual";

/** A release (see `ReleaseWhy`): when (sim tick), which engine, and whether it was waiting in a loop. */
export interface CrossRelease {
  tick: number;
  engine: number;
  why: ReleaseWhy;
  atLoop: boolean;
}

/** The most releases `Crossing.releases` keeps (the latest). */
const MAX_RELEASES = 64;

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
  | { kind: "needs-loop"; lineId: number }
  /** Its line has no passing place: it waits at its stop for its turn (Phase 3c). */
  | { kind: "turn"; lineId: number };

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

/**
 * A train's block (Phase 3c): its way from where it is through to its next passing place along its route, leg by leg
 * (a leg: to the middle of a stop), through the stops between (it calls at them inside its claim) and back from a
 * terminus it comes to first. On a line with no passing place on the whole round it runs to the next terminus instead
 * (`turns`), where it waits its turn.
 */
interface Block {
  claims: readonly Claim[];
  /** Each leg's stop (its piece), and the index of the claim just after the leg's last. */
  targets: readonly number[];
  ends: readonly number[];
  /** No passing place on its round: it ends at the next terminus, with a turn claim there (`turnClaim`). */
  turns: boolean;
  /** It ends short of a train of its line standing at its last stop (a terminus): it calls there short of that train. */
  short: boolean;
  /** Its line has no passing place on the whole round (for this train): trains take turns, end to end. */
  noLoop?: boolean;
}

const NO_BLOCK: Block = { claims: [], targets: [], ends: [], turns: false, short: false };

/** A block of one leg. */
const oneLeg = (claims: readonly Claim[], target: number): Block => ({ claims, targets: [target], ends: [claims.length], turns: false, short: false });

/**
 * The turn at the end of a block: its last claim the other way round (no length). A train coming up behind to the same
 * terminus meets it head on, so a block that ends at a terminus keeps followers out till its train has got there.
 */
const turnClaim = (c: Claim): Claim => ({ pieceId: c.pieceId, pathIndex: c.pathIndex, back: !c.back, entry: c.exit, exit: c.entry, len: 0 });

/** A train that has called at its stop short of a train of its line standing there (see `callsAt`). */
interface ShortCall {
  /** The stop's piece; when (sim tick) it called; whether it has turned back since. */
  stop: number;
  tick: number;
  turned: boolean;
  /** The pieces under it then, and those next to them: it's still there while every axle is on one of them. */
  pieces: Set<number>;
}

/** A way found clear (`check`, `tryGate`), granted at the end of the tick in turn (`settle`). */
interface Ask {
  engine: number;
  v: Visit;
  gate: boolean;
  way: Block;
  /** The section asked for: claims `at` to `upto`; the road it stands on at its end, and its claim out of a loop. */
  at: number;
  upto: number;
  stand: ReadonlySet<number> | null;
  merge: Claim | null;
}

interface Reservation extends Block {
  /** Its block: it holds claims `from` to `upto` (the rest are sections still to claim). */
  /** Claims before this one are let go (its tail has cleared them). */
  from: number;
  /** Claims from this one on aren't held yet: the far switch of the loop it's to stand in, if the next is refused. */
  upto: number;
  /** The track's revisions it was worked out on. */
  revision: number;
  routing: number;
  /** When (sim tick) it was worked out, and the piece it leads to (its last leg's stop). */
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
  /** Its way found clear this tick, waiting to be granted in turn (`settle`). */
  asking: boolean;
  /** Its line has no passing place for it (its block runs to a terminus): it waits its turn. */
  turns: boolean;
  /** What it last asked for (at a loop's far switch: the section on), as last looked. */
  want: readonly Claim[] | null;
}

interface CachedLeg {
  key: string;
  claims: readonly Claim[] | null;
}

/**
 * Does a claim end at a virtual signal (a loop's far switch, or as far as it was clear), with more to claim beyond?
 * (Not one cut at a stop: it asks there, at the stop.)
 */
const gated = (res: Reservation): boolean => res.upto < res.claims.length && !res.ends.includes(res.upto);

/** Was visit `a` (engine `ea`) ready before `b` (engine `eb`): first come, first served, and from the same moment the lower engine id? */
const earlier = (a: Visit, b: Visit, ea: number, eb: number): boolean => a.readySince < b.readySince || (a.readySince === b.readySince && ea < eb);

/** A steering hint (see `Crossing.avoidOn`): the loop roads to keep off, and a name for them (for caches). */
type Hint = { test: AvoidTest; sig: string };

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
  asking: false,
  turns: false,
  want: null,
});

export class Crossing {
  private readonly reservations = new Map<number, Reservation>();
  private readonly visits = new Map<number, Visit>();
  /** Trains coming up to, or standing at, a loop's far switch with the next section still to claim. */
  private readonly gates = new Map<number, Visit>();
  private readonly pendingLegs = new Map<number, CachedLeg>();
  private readonly hintedLegs = new Map<number, CachedLeg>();
  private readonly tailLegs = new Map<number, CachedLeg>();
  private readonly tailHinted = new Map<number, CachedLeg>();
  private readonly onwardLegs = new Map<number, CachedLeg>();
  /** Each way's runs through loops (per claims list, and the revision they were found on). */
  private readonly runCache = new WeakMap<readonly Claim[], { revision: number; runs: readonly ThroughRun[] }>();
  /**
   * Scratch: this check's own claims by piece; the loop road it would stand on, and its claim out of a loop (`scan`).
   * (A scan can run inside another, working out another train's way afresh: each depth has its own map.)
   */
  private mine = new Map<number, Claim[]>();
  private readonly minePool: Map<number, Claim[]>[] = [];
  private scanDepth = 0;
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
  /** The latest releases (the safety net: see `ReleaseWhy`), oldest first; at most `MAX_RELEASES`. */
  readonly releases: CrossRelease[] = [];
  /** Every release since this crossing began, by why (counters for the balance play-through and tests). */
  readonly released: Record<ReleaseWhy, number> = { "go-now": 0, quiet: 0, turned: 0, stalled: 0, mutual: 0 };
  /** Engines that have just reserved a section: steer them now (their hint changed). */
  readonly steerSoon = new Set<number>();
  /**
   * The ways between stops a block runs on through (`legOn`), by where they start, their stop and the hint: kept for
   * the track's revisions they were found on (cleared when those change).
   */
  private readonly legCache = new Map<string, readonly Claim[] | null>();
  private legRevision = -1;
  private legRouting = -1;
  /** Trains calling at their stop short of a train of their line standing there (see `callsAt`). */
  private readonly shortCalls = new Map<number, ShortCall>();
  /** When (economy tick) a routed train stood still between stops was last looked at for a short call. */
  private readonly shortLookAt = new Map<number, number>();
  /** Each engine's route's stop pieces (`stopsOf`), by the route's stops. */
  private readonly stopSets = new Map<number, { key: string; set: ReadonlySet<number> }>();
  /** Whether each engine's line has no passing place for it (`passless`), by its stops, length and the revisions. */
  private readonly passlessAt = new Map<number, { key: string; none: boolean }>();
  /** Ways found clear this tick, granted at its end in turn (`settle`). */
  private readonly asks: Ask[] = [];
  /** What a train granted its way (`settle`) waited for, and when (sim tick): its card says so till it moves off. */
  private readonly parting = new Map<number, { wait: CrossWait; tick: number }>();

  /** Off: no train waits (for comparisons: the balance play-through, tests). */
  enabled = true;
  /** Off: trains wait only at stops, a whole leg at a time (Phase 3a; for comparisons). */
  loops = true;
  /** Off: a train claims one section at a time, to its next stop or loop (Phase 3b; for comparisons). */
  blocks = true;

  /** Block working (Phase 3c) is on: blocks, and waiting in loops (it's built on 3b). */
  private get blocking(): boolean {
    return this.blocks && this.loops;
  }

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
      this.letGo(engine, v, "go-now");
      return false;
    }
    // (Its way found clear: it goes once granted, at the end of the tick.)
    if (v.asking) return true;
    // (Turning back where it stands, to go first from a terminus: the sim holds it still meanwhile.)
    const sc = this.shortCalls.get(engine);
    if (sc && train.turnback >= 0) return false;
    if (sc && !sc.turned && train.lastTurn?.cause === "short" && train.lastTurn.tick >= sc.tick) {
      sc.turned = true;
      for (const b of train.bogies) sc.pieces.add(b.pieceId);
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
    if (!r || r.stops.length === 0) return this.grant(engine, v, null);
    // A stop inside the block it holds (claimed through to here and on): on at once.
    const kept = this.reservations.get(engine);
    if (kept) {
      if (!kept.free && kept.trainId === train.id && kept.revision === host.layout.revision && kept.routing === host.layout.routingVersion) return this.grant(engine, v, null);
      this.reservations.delete(engine);
    }
    // Two of its line's trains at one terminus, nose to tail (this one nearer the line): neither can go on the way it
    // faces without going through the other, so this one turns back where it stands, and goes first.
    if (this.blocking && !this.shortCalls.has(engine) && this.stacked(engine, train, r)) {
      this.callShort(engine, train, host.stopPiece(r.stops[r.next % r.stops.length].depotId), now);
      host.sim.turnBack(train.id);
      v.wait = { kind: "turn", lineId };
      return true;
    }
    const way = this.wayFrom(engine, train, r, live, true, null, () => 0);
    if (!way || way.claims.length === 0) return this.grant(engine, v, way);
    // Its block: through to the first loop it would wait in (or, with no passing place, to the next terminus).
    const upto = this.uptoAfter(way.claims, train, 0);
    const stand = this.standRoad(way.claims, upto);
    v.turns = !!way.noLoop;
    const s = this.scan(engine, train, upto === way.claims.length ? way.claims : way.claims.slice(0, upto), way.targets[way.targets.length - 1], live, v, upto === way.claims.length && !way.short, stand);
    v.hard = s.hard;
    v.standing = s.standing;
    if (s.hard.length === 0 && s.soft === -1) return this.ask({ engine, v, gate: false, way, at: 0, upto, stand, merge: null });
    return this.waitOn(engine, lineId, now, v, s, false);
  }

  /**
   * Is this train (at its stop) stood nose to tail behind a train of its line at the same stop, each one's way on
   * running through the other (a terminus both face the end of)?
   */
  private stacked(engine: number, train: Train, r: Route): boolean {
    const { host, layout } = { host: this.host, layout: this.host.layout };
    const u = this.inTheWay(engine);
    if (u === -1) return false;
    const tu = host.sim.findCar(u)?.train;
    if (!tu) return false;
    // (Ahead of it: on the next piece, or further along the piece its front is on.)
    const f = this.end(train, false);
    const fp = layout.getPiece(f.pieceId);
    if (!fp) return false;
    const path = getPieceDef(fp.type, fp.flipped).paths[f.pathIndex];
    const len = pathLength(path.geom);
    const nextPiece = next(layout, f.pieceId, f.reversed ? path.from : (path.to ?? -1))?.pieceId ?? -1;
    const ahead = tu.bogies.some((b) => b.pieceId === nextPiece || (b.pieceId === f.pieceId && (b.reversed === f.reversed ? b.s : len - b.s) > f.s));
    if (!ahead) return false;
    const ru = host.route(u);
    if (!tu || !ru?.at || ru.stops.length === 0 || tu.speed >= 1) return false;
    const here = host.stopPiece(r.stops[r.next % r.stops.length].depotId);
    if (host.stopPiece(ru.stops[ru.next % ru.stops.length].depotId) !== here) return false;
    const res = this.reservations.get(u);
    if (res && !res.free) return false;
    const onTrain = (way: readonly Claim[] | null, t: Train) => !!way && way.some((c) => t.bogies.some((b) => b.pieceId === c.pieceId));
    const mineOn = (rr: Route) => host.stopPiece(rr.stops[stopAfter(rr, rr.next % rr.stops.length)].depotId);
    const tMine = mineOn(r);
    const tTheirs = mineOn(ru);
    return tMine >= 0 && tTheirs >= 0 && onTrain(this.pending(engine, train, tMine), tu) && onTrain(this.pending(u, tu, tTheirs), train);
  }

  /** Its way is clear: it's granted at the end of the tick, in turn (`settle`). True: it waits till then. */
  private ask(a: Ask): boolean {
    // (Its card says what it waited for till then.)
    a.v.asking = true;
    this.asks.push(a);
    return true;
  }

  /**
   * Grant the ways found clear this tick (called once a tick, by the economy), first come first served: in the order
   * the trains were first ready (at their stops, or at a loop's far switch), and from the same moment, the lower engine
   * id first; each after the first is looked at again against those granted before it.
   */
  settle(): void {
    const asks = this.asks;
    if (asks.length === 0) return;
    if (asks.length > 1) asks.sort((x, y) => x.v.readySince - y.v.readySince || x.engine - y.engine);
    for (let i = 0; i < asks.length; i++) {
      const a = asks[i];
      a.v.asking = false;
      const train = this.host.sim.findCar(a.engine)?.train;
      if (!train || (a.gate ? this.gates.get(a.engine) : this.visits.get(a.engine)) !== a.v || a.v.granted) continue;
      if (i > 0) {
        const s = this.scan(a.engine, train, a.way.claims.slice(a.at, a.upto), a.way.targets[a.way.targets.length - 1], this.host.live(a.engine), a.v, a.upto === a.way.claims.length && !a.way.short, a.stand, a.merge);
        if (s.hard.length > 0 || s.soft !== -1) {
          // (Beaten to it: it looks again next tick, and waits for that one.)
          a.v.checkedAt = -Infinity;
          continue;
        }
      }
      // (Its card keeps what it waited for till it moves off, next tick.)
      if (a.v.wait) this.parting.set(a.engine, { wait: a.v.wait, tick: this.host.sim.ticks });
      if (a.gate) {
        this.gates.delete(a.engine);
        this.reserve(a.engine, a.way, false, a.upto);
      } else this.grant(a.engine, a.v, a.way, a.upto);
      this.lookAgain(a.engine);
    }
    asks.length = 0;
  }

  /**
   * Something changed for the trains of this engine's line (it claimed a block, or came to the end of one): those
   * waiting look again next tick, so the one ready first is seen to be ready (first come, first served).
   */
  private lookAgain(engine: number): void {
    if (!this.blocking) return;
    for (const u of this.host.live(engine)) {
      if (u === engine) continue;
      const v = this.visits.get(u);
      if (v && !v.granted && v.wait) v.checkedAt = -Infinity;
      const g = this.gates.get(u);
      if (g && !g.granted && g.wait) g.checkedAt = -Infinity;
    }
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
      this.letGo(engine, v, "quiet");
      return false;
    }
    // A train it waits for has turned back from meeting another since it began to wait: its claim no longer leads here
    // as it did (and, bouncing, it never stands still for the quiet release). Let it go. (With blocks, Phase 3c, that
    // train claims its block again from where it turned back, and this one waits for that instead.)
    if (!this.blocking)
      for (const u of s.hard)
      if ((this.metAt.get(u) ?? -Infinity) >= v.since) {
        this.letGo(engine, v, "turned");
        return false;
      }
    // Every hold is capped: the train it waits for has made no progress for LOOP_WAIT_S (moving or not, it hasn't got
    // further along its claim, nor been worked at a depot). (With blocks, Phase 3c, a train may wait its turn behind
    // others in turn: it waits while anything on its line moves or is worked.)
    if (s.loop === -1) {
      const by = s.hard.length > 0 ? s.hard[0] : s.soft;
      const res = this.reservations.get(by);
      const made = res && !res.free ? res.made : -1;
      const from = res && !res.free ? res.from : -1;
      const tb = host.sim.findCar(by)?.train;
      if (by !== v.by || (made === v.byMade && from > v.byFrom) || (tb && host.busy(tb, by)) || (this.blocking && !s.quiet)) v.progressAt = now;
      v.by = by;
      v.byMade = made;
      v.byFrom = from;
      if ((now - v.progressAt) * SIM_DT >= LOOP_WAIT_S) {
        this.letGo(engine, v, "stalled");
        return false;
      }
    }
    // Two trains each in the other's way (a train left facing the wrong way after meeting another, say): with blocks,
    // the one ready later turns round where it stands if the way back is clear to where it could wait, and goes back
    // there (to a passing place, or the end of the line), so the other can get by.
    if (s.loop !== -1 && this.blocking) {
      const lv = this.visitOf(s.loop);
      const later = !lv || earlier(lv, v, s.loop, engine);
      const train = host.sim.findCar(engine)?.train;
      if (later && train && this.backOff(engine, train)) {
        v.wait = { kind: "needs-loop", lineId };
        return true;
      }
    }
    // In a mutual wait (no passing place between them), after a while the one ready first is let go, as before.
    if (s.loop !== -1) {
      const lv = this.visitOf(s.loop);
      const first = !lv || v.readySince < lv.readySince || (v.readySince === lv.readySince && engine < s.loop);
      if (first && (now - v.loopSince) * SIM_DT >= LOOP_WAIT_S) {
        this.letGo(engine, v, "mutual");
        return false;
      }
    }
    if (s.loop !== -1) v.wait = { kind: "needs-loop", lineId };
    else if (v.turns) v.wait = { kind: "turn", lineId };
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
    const outer = { mine: this.mine, standOn: this.standOn, mergeAt: this.mergeAt };
    const depth = this.scanDepth++;
    this.mine = this.minePool[depth] ??= new Map();
    try {
      return this.scanIn(engine, train, mine, target, live, v, toStop, stand, merge);
    } finally {
      this.scanDepth--;
      this.mine = outer.mine;
      this.standOn = outer.standOn;
      this.mergeAt = outer.mergeAt;
    }
  }

  private scanIn(engine: number, train: Train, mine: readonly Claim[], target: number, live: readonly number[], v: Visit, toStop: boolean, stand: ReadonlySet<number> | null, merge: Claim | null) {
    const { host } = this;
    this.standOn = stand;
    this.mergeAt = merge;
    const last = mine[mine.length - 1].pieceId;
    const byPiece = this.mine;
    // (Its section ends with the turn at a terminus: see `turnClaim`.)
    const end = mine[mine.length - 1];
    const turnsHere = this.blocking && mine.length > 1 && end.len === 0 && mine[mine.length - 2].pieceId === end.pieceId && mine[mine.length - 2].back !== end.back;
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
        // (With blocks, into a block that ends at a terminus: one on it, even heading our way, holding only part of its
        // way, will turn back there into us; it goes first.)
        else if (turnsHere && !res.free && res.upto < res.claims.length && this.occupancy(tu).some((c) => byPiece.has(c.pieceId))) {
          hard.push(u);
          if (tu.speed < 1) standing.push(u);
        }
        // Heading for our stop too, ahead of us (its way there claimed): where it goes on from there, there (it may turn
        // back at it).
        else if (toStop && !res.free && !ru.at && res.target === target && res.claims.length > 0 && res.upto >= res.claims.length) {
          const on = this.onward(u, ru, res.claims[res.claims.length - 1]);
          if (on && this.clashesOn(on, last)) hard.push(u);
        }
        // Waiting at a loop's far switch for the section on, since before this one was ready (first come, first served):
        // it goes first, if what it asked for clashes with this one's (unless it can't go either).
        else if (soft === -1 && !res.free) {
          const g = this.gates.get(u);
          if (g && !g.granted && g.want && g.wait && earlier(g, v, u, engine) && g.hard.every((h) => h === engine && !g.standing.includes(h)) && this.clashes(g.want, 0)) soft = u;
        }
        continue;
      }
      // Standing at its stop, not yet sent on: the pieces it stands on (unless it's heading our way: we follow it), and
      // where it goes next, at our stop (a stop it can't share with us: a terminus it turns back at, say).
      const uTarget = host.stopPiece(ru.stops[stopAfter(ru, ru.next % ru.stops.length)].depotId);
      const theirs = uTarget < 0 ? null : this.pending(u, tu, uTarget);
      const uAt = host.stopPiece(ru.stops[ru.next % ru.stops.length].depotId);
      const occ = this.occupancy(tu);
      // (With blocks: standing on our way at all, even heading our way, it goes first: we don't run up behind a train
      // that is itself waiting.)
      if (this.clashes(occ, 0) || (toStop && uAt === target && theirs && this.clashesOn(theirs, last)) || (this.blocking && tu.speed < 1 && occ.some((c) => this.mine.has(c.pieceId)))) {
        hard.push(u);
        // (Still running in to its stop, it isn't standing in the way yet.)
        if (tu.speed < 1) standing.push(u);
        if (loop === -1 && still && tu.speed < 1 && this.waitsOn(u, engine, live.length)) loop = u;
        continue;
      }
      // Both ready: the one ready first goes first (unless it can't go either: as last looked, held but by this one's claim);
      // what it would claim is its first section.
      const uv = this.visits.get(u);
      if (theirs && soft === -1 && uv && !uv.granted && uv.hard.every((h) => h === engine && !uv.standing.includes(h)) && (uv.readySince < v.readySince || (uv.readySince === v.readySince && u < engine)) && this.clashes(theirs, 0, this.uptoAfter(theirs, tu, 0))) soft = u;
    }
    // Into a loop whose other road a train of the line already holds or stands on: not while another is on its way to
    // the loop from the other end (it would find no road free: three trains, two roads, none could go on).
    if (stand && this.blocking && hard.length === 0) {
      const u = this.comingTo(engine, train, stand, live, v);
      if (u !== -1) hard.push(u);
    }
    return { hard, standing, soft, loop, quiet };
  }

  /**
   * A section ending on loop road `stand`: if a train of the line (other than `engine`) holds or stands on the loop's
   * other road, a train of the line heading into the loop from its other end (its way to its next stop runs in by the
   * far switch), not yet in it; −1 if none.
   */
  private comingTo(engine: number, train: Train, stand: ReadonlySet<number>, live: readonly number[], v: Visit): number {
    const { host } = this;
    const roadAt = loopRoadAt(host.layout);
    let at: RoadAt | undefined;
    let toB = false;
    for (const p of stand) {
      const mine = this.mine.get(p);
      at = roadAt.get(p);
      if (at && mine) {
        toB = mine[0].entry === at.aEnd;
        break;
      }
      at = undefined;
    }
    if (!at) return -1;
    const loop = at.loop;
    const other = 1 - at.road;
    const onLoop = (pieceId: number, road: number) => {
      const r = roadAt.get(pieceId);
      return !!r && r.loop === loop && (road === -1 || r.road === road);
    };
    // (One already in the loop leaves a road free as it goes.)
    if (train.bogies.some((b) => onLoop(b.pieceId, -1))) return -1;
    let busy = false;
    for (const u of live) {
      const tu = u === engine ? undefined : host.sim.findCar(u)?.train;
      if (!tu || tu === train) continue;
      const res = this.letGoBehind(u, tu);
      if (tu.bogies.some((b) => onLoop(b.pieceId, other))) busy = true;
      else if (res && !res.free) for (let k = res.from; k < res.upto && !busy; k++) busy = onLoop(res.claims[k].pieceId, other);
      if (busy) break;
    }
    if (!busy) return -1;
    for (const u of live) {
      const tu = u === engine ? undefined : host.sim.findCar(u)?.train;
      const ru = host.route(u);
      if (!tu || tu === train || !ru || ru.stops.length === 0 || tu.bogies.some((b) => onLoop(b.pieceId, -1))) continue;
      const into = (way: readonly Claim[] | null) => !!way && this.runsOf(way).some((run) => run.loop === loop && run.entry !== -1 && run.toB !== toB);
      // On its way in: it holds a claim into the loop from the other end.
      const res = this.letGoBehind(u, tu);
      if (res && !res.free && into(res.claims.slice(res.from, res.upto))) return u;
      // At its stop (still working there, or ready first: else this one takes the road), or ready first at a gate. (One
      // merely moving, with no claim in, must stop and ask before it enters: it doesn't hold this one back.)
      const uv = this.visitOf(u);
      if (uv ? uv.granted || !earlier(uv, v, u, engine) : !ru.at) continue;
      const target = host.stopPiece(ru.stops[ru.at ? stopAfter(ru, ru.next % ru.stops.length) : ru.next % ru.stops.length].depotId);
      if (target >= 0 && into(this.pending(u, tu, target))) return u;
    }
    return -1;
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

  /** Send it on, claiming `way` (its block from its stop) up to `upto` (none: it keeps what it holds, if anything). */
  private grant(engine: number, v: Visit, way: Block | null, upto?: number): boolean {
    v.granted = true;
    v.asking = false;
    v.wait = null;
    v.hard = [];
    v.standing = [];
    if (way) this.reserve(engine, way, false, upto);
    return false;
  }

  /** Let it go with no claim (timed out, or sent on by the player): logged (`releases`). */
  private letGo(engine: number, v: Visit, why: ReleaseWhy): void {
    this.releases.push({ tick: this.host.sim.ticks, engine, why, atLoop: v.far !== -1 });
    if (this.releases.length > MAX_RELEASES) this.releases.shift();
    this.released[why]++;
    v.granted = true;
    v.wait = null;
    v.hard = [];
    v.standing = [];
    v.asking = false;
    this.gates.delete(engine);
    // With blocks (Phase 3c): it goes holding its block, unasked, so the line's other trains see where it's going and
    // keep out of it (never with no claim at all: that's what let two trains run on into each other). Without: let go
    // with no claim, as before.
    const train = this.blocking ? this.host.sim.findCar(engine)?.train : undefined;
    const r = train ? this.host.route(engine) : undefined;
    const way = train && r && r.stops.length > 0 ? this.wayFrom(engine, train, r, this.host.live(engine), !!r.at, null, (leg) => (r.at ? 0 : Math.max(0, this.frontIndex(leg, train, 0)))) : null;
    // (As far as it's clear of the line's trains, though: it can't go through one.)
    if (way && way.claims.length > 0 && train) this.releg(engine, train, way, () => this.host.live(engine), true);
    else this.reserve(engine, NO_BLOCK, true);
  }

  /** Reserve a block: claims up to `upto` (by default, to the end of the section the train's front is in). */
  private reserve(engine: number, way: Block, free: boolean, upto?: number): void {
    this.reservations.set(engine, this.build(engine, way, free, upto));
  }

  /** A reservation of `way` for this train, not yet held (see `reserve`). */
  private build(engine: number, way: Block, free: boolean, upto?: number): Reservation {
    const { layout, sim } = this.host;
    const train = sim.findCar(engine)?.train;
    const trainId = train?.id ?? -1;
    const { claims } = way;
    // (Its way from its tail, between stops, may start in a loop: it may wait there. At its stop it's checked there.)
    const atStop = !!this.host.route(engine)?.at;
    const to = free ? 0 : (upto ?? (train ? this.uptoAfter(claims, train, atStop ? 0 : Math.max(0, this.frontIndex(claims, train, 0)), !atStop) : claims.length));
    const target = way.targets.length > 0 ? way.targets[way.targets.length - 1] : -1;
    if (!free && to < claims.length) this.steerSoon.add(engine);
    return { ...way, from: 0, upto: to, revision: layout.revision, routing: layout.routingVersion, made: sim.ticks, free, target, trainId };
  }

  /**
   * Another train's claim, brought up to date: let go behind its tail; worked out afresh from its tail if it has none
   * between stops, if the track or a pin changed, or if it turned back from meeting a train. Null: standing at its stop,
   * not yet sent on.
   */
  private reservation(engine: number, train: Train, r: Route, liveNow?: readonly number[], mode: "own" | "view" = "view"): Reservation | null {
    const live = () => liveNow ?? this.host.live(engine);
    // (With blocks, a claim between stops is only ever granted in `settle`: worked out afresh here it is a view of the
    // way the train would claim, for another train's check, never held; the train itself asks for it, held still
    // meanwhile (`claimAsk`).)
    const asks = this.blocking && !r.at;
    const { layout, sim } = this.host;
    let res = this.reservations.get(engine);
    if (!res && r.at) return null;
    const target = this.host.stopPiece(r.stops[r.at ? stopAfter(r, r.next % r.stops.length) : r.next % r.stops.length].depotId);
    // Turned round at the end of the line (a buffer, or short of a train of its line), inside its block: the same claim
    // (its way already runs back from there), on the new train.
    const t = train.lastTurn;
    if (res && !res.free && res.trainId !== train.id && t && t.cause !== "train" && t.tick >= res.made && this.frontIndex(res.claims, train, res.from) !== -1) res.trainId = train.id;
    const turned = !!res && train.turnback < 0 && t?.cause === "train" && t.tick >= res.made;
    // (Let go and turned back from meeting a train since: its way is worked out again, so it doesn't bounce for ever.)
    // (Turned round since, any way (the end of open track, a buffer), and no longer facing along its claim: its way is
    // worked out again from its tail, so it never runs back over track it holds the other way.)
    const faced = !!res && !res.free && !r.at && !turned && train.turnback < 0 && !!t && t.tick >= res.made && this.frontIndex(res.claims, train, res.from) === -1;
    const stale = !!res && (res.trainId !== train.id || turned || faced || (!res.free && (res.revision !== layout.revision || res.routing !== layout.routingVersion || !res.targets.includes(target))));
    // (Kept at a stop inside its block, not yet sent on from it: it asks afresh there.)
    if (res && stale && r.at && !this.visits.get(engine)?.granted) {
      this.reservations.delete(engine);
      return null;
    }
    const relegs = (): Reservation => this.releg(engine, train, target < 0 ? null : this.wayFrom(engine, train, r, live(), !!r.at, res && !res.free ? res : null, (leg) => (r.at ? 0 : Math.max(0, this.frontIndex(leg, train, 0)))), live, (turned || faced) && this.blocking, !asks);
    if (asks && (!res || stale)) {
      if (res) this.reservations.delete(engine);
      return mode === "own" ? null : relegs();
    }
    if (!res || stale) {
      res = relegs();
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
        if (asks) {
          this.reservations.delete(engine);
          return mode === "own" ? null : relegs();
        }
        res = relegs();
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
   * back, and meets the other.) Its block's legs beyond its next stop are claimed only as far as they're clear: else
   * it claims to the stop, and asks there.
   */
  private releg(engine: number, train: Train, way: Block | null, live: () => readonly number[], clipAll = false, store = true): Reservation {
    const res = this.build(engine, way ?? NO_BLOCK, way === null);
    if (store) this.reservations.set(engine, res);
    if (res.free || !this.loops || this.clipping) return res;
    // (Turned back from meeting a train, with blocks: only as far as it's clear, loop or none, then it asks.)
    const loopy = clipAll || this.blocking || this.uptoAfter(res.claims, train, -1, true, true) < res.claims.length;
    if (!loopy && res.targets.length < 2) return res;
    const engines = live();
    if (engines.length < 2) return res;
    const k = Math.max(0, this.frontIndex(res.claims, train, 0));
    const dummy = newVisit(Infinity, 0, this.host.sim.ticks);
    const target = res.target;
    this.clipping = true;
    try {
      for (let j = k + 2; j <= res.upto; j++) {
        // (Past its next stop, looked at a leg at a time: it would stop and ask at the stop before.)
        const found = res.ends.findIndex((e) => e >= j);
        const leg = found === -1 ? res.ends.length - 1 : found;
        if (leg > 0 && j !== res.ends[leg] && j !== res.upto) continue;
        if (leg <= 0 && !loopy) {
          j = res.ends[0];
          continue;
        }
        const s = this.scan(engine, train, res.claims.slice(k + 1, j), target, engines, dummy, j === res.claims.length, j === res.upto ? this.standFor(train, res.claims, j) : null);
        if (s.hard.length > 0) {
          res.upto = leg > 0 ? Math.max(res.ends[leg - 1], k + 1) : j - 1;
          // (Not to stand on a loop's road, or a switch, short of a train coming the other way: short of the loop.)
          const roadAt = loopRoadAt(this.host.layout);
          while (res.upto > k + 1 && !res.ends.includes(res.upto) && (roadAt.has(res.claims[res.upto - 1].pieceId) || this.isSwitch(res.claims[res.upto - 1].pieceId))) res.upto--;
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
    const claims = claimsOf(this.host.layout, legFromCursor(this.host.layout, start, target, { on, avoid, throughLifts: true }));
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

  /**
   * A train's way to the middle of piece `target`, as claims: from its front (`atStop`), or from its tail (the pieces
   * it's on, the way it's on them, and on ahead as steering goes); as steering goes with `hint` (`steerAvoid`), if any.
   * Cached per train, by where it stands, the target, the hint and the track's revisions.
   */
  private firstLeg(engine: number, train: Train, target: number, atStop: boolean, hint: Hint | null): readonly Claim[] | null {
    if (atStop) {
      const f = this.end(train, false);
      return hint ? this.cached(this.hintedLegs, engine, this.keyOf(f, target, `|${hint.sig}`), f, target, undefined, hint.test) : this.cached(this.pendingLegs, engine, this.keyOf(f, target), f, target);
    }
    const t = this.end(train, true);
    const on = new Map<number, number>();
    let sig = "";
    for (const b of train.bogies)
      if (!on.has(b.pieceId)) {
        on.set(b.pieceId, b.pathIndex);
        sig += `,${b.pieceId}.${b.pathIndex}`;
      }
    const key = this.keyOf(t, target, `|${train.id}${sig}${hint ? `|${hint.sig}` : ""}`);
    return this.cached(hint ? this.tailHinted : this.tailLegs, engine, key, t, target, on, hint?.test);
  }

  /**
   * A train's block (see `Block`): its first leg (from its front at its stop, `atStop`, or from its tail between stops),
   * on through the route's stops to its next passing place, as steering will go with its hint (the free road through
   * loops a train of its line coming the other way is in, worked out on the block as it goes unhinted). `afterOf`: the
   * claim, on a first leg, after which the block's passing place is looked for (the far switch it stands at, in a
   * loop). Own: its claim now, if any (its road in a loop it holds is kept). Null: no way to its next stop.
   */
  private wayFrom(engine: number, train: Train, r: Route, live: readonly number[], atStop: boolean, own: Reservation | null, afterOf: (leg: readonly Claim[]) => number): Block | null {
    const n = r.stops.length;
    // (At its stop, its block runs from there to the stop after; between stops, to the stop it heads for.)
    const i1 = r.at ? stopAfter(r, r.next % n) : r.next % n;
    const target = this.host.stopPiece(r.stops[i1].depotId);
    if (target < 0) return null;
    const plain = this.firstLeg(engine, train, target, atStop, null);
    if (!plain) return null;
    let after = afterOf(plain);
    let block = this.blockOf(r, train, plain, i1, after, !atStop, null);
    if (this.loops && live.length >= 2) {
      const hint = this.avoidOn(engine, block.claims, 0, live, own, this.uptoAfter(block.claims, train, after, !atStop), block.targets);
      const first = hint ? this.firstLeg(engine, train, target, atStop, hint) : null;
      if (hint && first) {
        after = afterOf(first);
        block = this.blockOf(r, train, first, i1, after, !atStop, hint);
      }
    }
    return block.turns ? this.turnEnd(engine, train, block, live, after, this.passless(engine, train, r)) : block;
  }

  /**
   * A block from its first leg (`first`, to the route's stop `i1`): leg by leg on through the route's stops till one
   * runs through a passing place it can wait in (after claim `after`; `inLoop`: one it starts in counts), cut there
   * (`uptoAfter`), or to a terminus (the first stop its way turns back at: `turns`), whichever comes first; with neither
   * on the whole round (back to the stop it last left: a round run one way), the whole round. Off (`blocks`), or
   * waiting only at stops (`loops`): its first leg.
   */
  private blockOf(r: Route, train: Train, first: readonly Claim[], i1: number, after: number, inLoop: boolean, hint: Hint | null): Block {
    const n = r.stops.length;
    const t1 = this.host.stopPiece(r.stops[i1].depotId);
    if (!this.blocks || !this.loops || this.uptoAfter(first, train, after, inLoop) < first.length) return oneLeg(first, t1);
    const home = r.at ? r.next % n : stopBefore(r, i1);
    let claims = first;
    const targets = [t1];
    const ends = [first.length];
    for (let i = i1, k = 0; k < n && i !== home; k++) {
      const j = stopAfter(r, i);
      const p = this.host.stopPiece(r.stops[j].depotId);
      if (p < 0 || claims.length === 0) break;
      const arrive = claims[claims.length - 1];
      const leg = this.legOn(arrive, p, hint);
      if (!leg || leg.length === 0) break;
      // A terminus (the way on from the stop comes back over it: the line ends there, or just beyond) ends the block:
      // the train turns back there into its next block, claimed as at any stop.
      if (leg.some((c) => c.pieceId === arrive.pieceId && c.back !== arrive.back)) return { claims, targets, ends, turns: true, short: false };
      // (Through the stop: its two halves are one claim, so a loop road the stop is on is still seen as run through.)
      const on = leg[0];
      if (on.pieceId === arrive.pieceId && on.pathIndex === arrive.pathIndex && on.back === arrive.back) claims = [...claims.slice(0, -1), { ...arrive, exit: on.exit, len: arrive.len + on.len }, ...leg.slice(1)];
      else claims = claims.concat(leg);
      targets.push(p);
      ends.push(claims.length);
      i = j;
      if (this.uptoAfter(claims, train, after, inLoop) < claims.length) return { claims, targets, ends, turns: false, short: false };
    }
    // (Round again to the stop it last left with neither: a round run one way, the whole of it.)
    return { claims, targets, ends, turns: false, short: false };
  }

  /**
   * The way on from a stop (from the middle of its piece, the way `arrive` comes in) to the middle of piece `target`,
   * as claims, as steering goes with `hint`; cached by where it starts, the target and the hint, for the track's
   * revisions (the cache is cleared when they change).
   */
  private legOn(arrive: Claim, target: number, hint: Hint | null): readonly Claim[] | null {
    const { layout } = this.host;
    if (this.legRevision !== layout.revision || this.legRouting !== layout.routingVersion || this.legCache.size > 1024) {
      this.legCache.clear();
      this.legRevision = layout.revision;
      this.legRouting = layout.routingVersion;
    }
    const key = `${arrive.pieceId}:${arrive.pathIndex}:${arrive.back ? 1 : 0}:${target}${hint ? `|${hint.sig}` : ""}`;
    const hit = this.legCache.get(key);
    if (hit !== undefined) return hit;
    const piece = layout.getPiece(arrive.pieceId);
    let claims: readonly Claim[] | null = null;
    if (piece) {
      const mid = pathLength(getPieceDef(piece.type, piece.flipped).paths[arrive.pathIndex].geom) / 2;
      claims = claimsOf(layout, legFromCursor(layout, { pieceId: arrive.pieceId, pathIndex: arrive.pathIndex, reversed: arrive.back, s: mid }, target, { avoid: hint?.test, throughLifts: true }));
    }
    this.legCache.set(key, claims);
    return claims;
  }

  /**
   * The end of a block that runs to a terminus (`turns`): short of a train of its line standing there (its stop, not
   * yet sent on, or called at short of another), off any switch, if one stands on its way there (it calls at the stop
   * short of that train: see `callsAt`); and its turn claim (`turnClaim`), so a train coming up behind waits.
   */
  private turnEnd(engine: number, train: Train, block: Block, live: readonly number[], after: number, noLoop: boolean): Block {
    const { host } = this;
    const T = block.targets[block.targets.length - 1];
    let claims = block.claims;
    let short = false;
    let cut = -1;
    // (With a passing place on the line, a train standing at the terminus goes back to it first: this one waits.)
    for (const u of noLoop ? live : []) {
      if (u === engine) continue;
      const tu = host.sim.findCar(u)?.train;
      const ru = host.route(u);
      if (!tu || tu === train || !ru?.at || ru.stops.length === 0 || tu.speed >= 1) continue;
      if (host.stopPiece(ru.stops[ru.next % ru.stops.length].depotId) !== T) continue;
      const res = this.reservations.get(u);
      if (res && !res.free) continue;
      let i = -1;
      for (let k = after; k < claims.length && i === -1; k++) {
        const id = claims[k].pieceId;
        if (tu.bogies.some((b) => b.pieceId === id)) i = k;
      }
      // (Its train stands back over an earlier leg's stop: no calling short there.)
      if (i === -1 || (block.ends.length > 1 && i < block.ends[block.ends.length - 2])) continue;
      // (The nearest of them, if several stand there one behind another.)
      if (cut === -1 || i < cut) cut = i;
    }
    if (cut !== -1) {
      while (cut > after + 1 && this.isSwitch(claims[cut - 1].pieceId)) cut--;
      claims = claims.slice(0, Math.max(cut, after + 1));
      short = true;
    }
    if (claims.length === 0) return block;
    const ends = [...block.ends.slice(0, -1), claims.length];
    return { claims: [...claims, turnClaim(claims[claims.length - 1])], targets: block.targets, ends, turns: true, short, noLoop };
  }

  /**
   * Has this train's line no passing place it can use on the whole round (no way between its stops runs through a
   * loop it fits in, unpinned)? Cached per engine by its stops, its length and the track's revisions.
   */
  private passless(engine: number, train: Train, r: Route): boolean {
    const { layout } = this.host;
    const stops = r.stops.map((s) => this.host.stopPiece(s.depotId));
    const key = `${stops.join(",")}|${trainLength(train)}|${layout.revision}|${layout.routingVersion}`;
    const hit = this.passlessAt.get(engine);
    if (hit && hit.key === key) return hit.none;
    let none = true;
    if (passingLoops(layout).length > 0)
      for (const leg of lineLegs(layout, stops.filter((p) => p >= 0))) {
        const claims = claimsOf(layout, leg);
        if (claims && claims.length > 0 && this.uptoAfter(claims, train, -1, false, true) < claims.length) {
          none = false;
          break;
        }
      }
    this.passlessAt.set(engine, { key, none });
    return none;
  }

  private isSwitch(pieceId: number): boolean {
    const p = this.host.layout.getPiece(pieceId);
    return !!p && !!getPieceDef(p.type, p.flipped).isSwitch;
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
  private uptoAfter(claims: readonly Claim[], train: Train, after: number, inLoop = false, loopsOnly = false): number {
    if (!this.loops) return claims.length;
    let best = claims.length;
    // (With blocks: a way that turns back at the end of the line between stops, having left where it set out from,
    // stops there too, turned, and asks for the way back: it claims the turn, so no train follows it in.)
    if (this.blocking && !loopsOnly) {
      const start = claims[Math.max(0, after)]?.pieceId;
      let left = false;
      for (let k = Math.max(1, after + 1); k < claims.length; k++) {
        const c = claims[k];
        const b = claims[k - 1];
        if (b.pieceId !== start && b.pieceId !== c.pieceId) left = true;
        if (left && c.pieceId === b.pieceId && c.back !== b.back && c.len > 0) {
          best = k + 1;
          break;
        }
      }
    }
    const runs = this.runsOf(claims);
    if (runs.length === 0) return best;
    const loops = passingLoops(this.host.layout);
    const need = trainLength(train) + STAND_SHORT + TAIL_CLEAR;
    for (const run of runs) if (run.far > after && run.far < best && (inLoop || run.entry !== -1) && run.length >= need && this.usable(loops[run.loop])) best = run.far;
    return best;
  }

  /**
   * The index of the claim (from `from`) a train's front is on, going the way it goes (a block that turns back runs
   * over a piece both ways); −1 if none.
   */
  private frontIndex(claims: readonly Claim[], train: Train, from: number, to = claims.length): number {
    const f = this.end(train, false);
    for (let k = from; k < to; k++) if (claims[k].pieceId === f.pieceId && claims[k].pathIndex === f.pathIndex && claims[k].back === f.reversed) return k;
    return -1;
  }

  /**
   * How far (mm) a train holding `res` has to go to where it would stand short of claim `to` (by default the far switch
   * its claim ends at: its front's buffer face `STAND_SHORT` short of it); null if its front isn't on its claim.
   */
  private roomTo(res: Reservation, train: Train, to = res.upto): number | null {
    const k = this.frontIndex(res.claims, train, res.from, to);
    if (k === -1) return null;
    const f = this.end(train, false);
    const piece = this.host.layout.getPiece(f.pieceId);
    if (!piece) return null;
    let d = pathLength(getPieceDef(piece.type, piece.flipped).paths[f.pathIndex].geom) - f.s;
    for (let i = k + 1; i < to; i++) d += res.claims[i].len;
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
      if (car.kind === "engine" && this.blocking) {
        const sc = this.shortCall(car.id, train, now);
        if (sc !== null) return sc;
      }
      let res = this.reservations.get(car.id);
      // (With blocks: a train between stops holding no claim (or one gone stale) is held where it is, and asks.)
      if (car.kind === "engine" && this.blocking) {
        const at = this.host.route(car.id);
        if (at && !at.at && at.stops.length > 0 && this.host.lineOf(car.id) >= 0) {
          res = this.reservation(car.id, train, at, undefined, "own") ?? undefined;
          if (!res) return this.claimAsk(car.id, train, at, now);
          if (this.gates.get(car.id)?.far === ASKING) this.gates.delete(car.id);
        }
      }
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
      const r = this.host.route(car.id);
      if (!r || r.stops.length === 0) return Infinity;
      if (res.free) {
        // Let go, and it has met a train head on since: it claims its way again, from its tail.
        const t = train.lastTurn;
        if (!this.blocking || r.at || train.turnback >= 0 || t?.cause !== "train" || t.tick < res.made) return Infinity;
        res = this.reservation(car.id, train, r) ?? undefined;
        if (!res || res.free) return Infinity;
      }
      // A block that ends short of a train of its line at its last stop: it stands there, short of it.
      const short = res.short ? this.shortCap(car.id, train, r, res, now) : Infinity;
      if (!gated(res)) return short;
      return Math.min(short, this.gate(car.id, train, r, now));
    }
    return Infinity;
  }

  /**
   * The speed limit on a train whose block ends short of a train of its line standing at its last stop: it brakes to
   * stand `STAND_SHORT` short of the end of its claim (the piece before the one that train is on), and, stood there,
   * calls at the stop (see `callsAt`).
   */
  private shortCap(engine: number, train: Train, r: Route, res: Reservation, now: number): number {
    if (r.at || train.turnback >= 0) return Infinity;
    const live = this.host.live(engine);
    const fresh = this.reservation(engine, train, r, live);
    if (!fresh || fresh.free || !fresh.short) return Infinity;
    void res;
    const room = this.roomTo(fresh, train, fresh.ends[fresh.ends.length - 1]);
    if (room === null) return Infinity;
    if (room <= 1 && train.speed < 1) this.callShort(engine, train, fresh.target, now);
    return room > 0 ? Math.sqrt(2 * ACCELERATION * room) : 0;
  }

  /** It has called at its stop (`stop`) short of a train of its line standing there. */
  private callShort(engine: number, train: Train, stop: number, now: number): void {
    if (this.shortCalls.has(engine)) return;
    void now;
    const { layout } = this.host;
    const pieces = new Set<number>();
    for (const b of train.bogies) {
      pieces.add(b.pieceId);
      const piece = layout.getPiece(b.pieceId);
      if (!piece) continue;
      // (And the pieces next to them: turned round, it's set down a whisker along.)
      const def = getPieceDef(piece.type, piece.flipped);
      for (let c = 0; c < def.connectors.length; c++) {
        const n = next(layout, b.pieceId, c);
        if (n) pieces.add(n.pieceId);
      }
    }
    this.shortCalls.set(engine, { stop, tick: this.host.sim.ticks, turned: false, pieces });
  }

  /**
   * A train calling at its stop short of a train of its line (at a terminus, on a line with no passing place: its
   * block ended short of it, or it ran up behind it): once the economy has it at its stop, it's turned back where it
   * stands (`Sim.turnBack`), and then waits there for its next block as at a stop. Its speed limit (0: it stands), or
   * null: no short call. A routed train stood still between stops behind a train of its line standing at its stop is
   * looked at every `CHECK_TICKS`.
   */
  private shortCall(engine: number, train: Train, now: number): number | null {
    const { host } = this;
    const r = host.route(engine);
    if (!r || r.stops.length === 0 || host.lineOf(engine) < 0) return null;
    let sc = this.shortCalls.get(engine);
    if (!sc) {
      // Run up behind a train of its line standing at its stop (its block didn't end short of it: that train came after).
      if (r.at || train.speed >= 1 || train.turnback >= 0 || now - (this.shortLookAt.get(engine) ?? -Infinity) < CHECK_TICKS) return null;
      this.shortLookAt.set(engine, now);
      const target = host.stopPiece(r.stops[r.next % r.stops.length].depotId);
      if (target < 0 || train.bogies.some((b) => b.pieceId === target)) return null;
      // (Only in a block that runs to that stop, a terminus, on a line with no passing place.)
      const own = this.reservations.get(engine);
      if (!own || own.free || !own.noLoop || own.target !== target) return null;
      const u = this.inTheWay(engine);
      const ru = u === -1 ? undefined : host.route(u);
      if (!ru?.at || host.stopPiece(ru.stops[ru.next % ru.stops.length].depotId) !== target) return null;
      const res = this.reservations.get(u);
      if (res && !res.free) return null;
      this.callShort(engine, train, target, now);
      sc = this.shortCalls.get(engine)!;
    }
    // Turning round where it stands to face its way (see `wrongWay`): once turned, it claims its way afresh.
    if (sc.stop === -1) {
      if (train.turnback >= 0) return Infinity;
      const t = train.lastTurn;
      if (t?.cause === "short" && t.tick >= sc.tick) {
        this.shortCalls.delete(engine);
        return null;
      }
      if (train.speed < 1) host.sim.turnBack(train.id);
      return train.turnback >= 0 ? Infinity : 0;
    }
    // (Not at its stop yet: the economy has it there on its tick.)
    if (!r.at) return 0;
    if (!sc.turned) {
      const t = train.lastTurn;
      if (train.turnback < 0 && t?.cause === "short" && t.tick >= sc.tick) {
        sc.turned = true;
        for (const b of train.bogies) sc.pieces.add(b.pieceId);
      } else {
        // (Turning: the sim counts it down, the train standing still.)
        if (train.turnback >= 0) return Infinity;
        if (!host.busy(train, engine) && train.speed < 1) host.sim.turnBack(train.id);
        return train.turnback >= 0 ? Infinity : 0;
      }
    }
    // Turned: it goes on in its block, or waits here for the next as at a stop.
    const res = this.reservations.get(engine);
    if (res && !res.free) return null;
    const lineId = host.lineOf(engine);
    return this.holds(engine, train, lineId, () => host.live(engine), now, train.leverTick ?? 0) ? 0 : Infinity;
  }

  /**
   * The stop a train is calling at short of a train of its line standing there (see `shortCall`), while it stands
   * where it called (every axle on the pieces it stood on, or next to them); −1 if none. For the economy: it's at its
   * stop.
   */
  callsAt(engine: number): number {
    const sc = this.shortCalls.get(engine);
    if (!sc || sc.stop === -1) return -1;
    const train = this.host.sim.findCar(engine)?.train;
    if (train && train.bogies.every((b) => sc.pieces.has(b.pieceId))) return sc.stop;
    this.shortCalls.delete(engine);
    return -1;
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

  /**
   * A train between stops with no claim (with blocks): held where it is (0) while it asks for its way from its tail,
   * as far as it's clear, granted in `settle` like any other; it says what it waits for. Alone on its line: no claim.
   */
  /** `standRoad`, unless the train is on that road already (it isn't entering it: it stands where it is). */
  private standFor(train: Train, claims: readonly Claim[], upto: number): ReadonlySet<number> | null {
    const road = this.standRoad(claims, upto);
    return road && train.bogies.some((b) => road.has(b.pieceId)) ? null : road;
  }

  private claimAsk(engine: number, train: Train, r: Route, now: number): number {
    const { host } = this;
    const lever = train.leverTick ?? 0;
    let g = this.gates.get(engine);
    if (!g || g.far !== ASKING) {
      g = newVisit(now, lever, host.sim.ticks);
      g.far = ASKING;
      this.gates.set(engine, g);
    }
    g.asked = now;
    if (g.asking || now - g.checkedAt < CHECK_TICKS) return 0;
    if (g.checkedAt === -Infinity) g.readySince = g.quietSince = g.progressAt = now;
    g.checkedAt = now;
    const live = host.live(engine);
    const target = host.stopPiece(r.stops[r.next % r.stops.length].depotId);
    if (live.length < 2 || target < 0) {
      this.gates.delete(engine);
      return Infinity;
    }
    const way = this.wayFrom(engine, train, r, live, false, null, (leg) => Math.max(0, this.frontIndex(leg, train, 0)));
    if (!way || way.claims.length === 0) {
      this.gates.delete(engine);
      return Infinity;
    }
    const lineId = host.lineOf(engine);
    // Sent on by the player: it takes its way (the safety net, logged).
    if (g.lever !== lever) {
      this.letGo(engine, g, "go-now");
      return Infinity;
    }
    const cand = this.releg(engine, train, way, () => live, true, false);
    const k = Math.max(0, this.frontIndex(cand.claims, train, 0));
    if (cand.upto > k + 1 || cand.upto >= cand.claims.length) {
      this.ask({ engine, v: g, gate: true, way: cand, at: k, upto: cand.upto, stand: this.standFor(train, cand.claims, cand.upto), merge: null });
      return 0;
    }
    // (Nothing on ahead clear: it waits, saying for which train.)
    const upto = this.uptoAfter(cand.claims, train, k, true);
    const s = this.scan(engine, train, cand.claims.slice(k, Math.max(upto, k + 1)), cand.targets[cand.targets.length - 1], live, g, false, this.standFor(train, cand.claims, upto));
    g.hard = s.hard;
    g.standing = s.standing;
    if (s.hard.length === 0 && s.soft === -1) {
      this.ask({ engine, v: g, gate: true, way: cand, at: k, upto: Math.max(upto, k + 1), stand: this.standFor(train, cand.claims, upto), merge: null });
      return 0;
    }
    // (Let go, the safety net: it goes holding its way, logged.)
    return this.waitOn(engine, lineId, now, g, s, false) ? 0 : Infinity;
  }

  private gate(engine: number, train: Train, r: Route, now: number): number {
    const res = this.reservation(engine, train, r, undefined, "own");
    if (!res || res.free || !gated(res)) {
      this.gates.delete(engine);
      return Infinity;
    }
    let room = this.roomTo(res, train);
    // (Its front past the end of what it holds, run on beyond it: it stops where it is, and asks. Holding nothing on
    // ahead never means go.)
    if (room === null) {
      if (!this.blocking || this.frontIndex(res.claims, train, 0) < res.upto) return Infinity;
      room = 0;
    }
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
        this.letGo(engine, g, "go-now");
        return Infinity;
      }
      if (now - g.checkedAt >= CHECK_TICKS && !g.asking) {
        // (First come, first served: from when it first asks; its clocks for the safety net start then too, not when it
        // took the claim this gate ends.)
        if (g.checkedAt === -Infinity) g.readySince = g.quietSince = g.progressAt = now;
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
    const lineId = this.host.lineOf(engine);
    // Where it stands waiting: its claim's end (a loop's far switch, or as far as it was clear), found in its way
    // afresh from its tail (the free roads of loops further on as they are now); its block on from there.
    const end = res.claims[res.upto];
    const standAt = (leg: readonly Claim[]): number => {
      const k = Math.max(0, this.frontIndex(leg, train, 0));
      for (let i = k; i < leg.length; i++) if (leg[i].pieceId === end.pieceId && leg[i].pathIndex === end.pathIndex && leg[i].back === end.back) return i;
      return this.uptoAfter(leg, train, k, true);
    };
    const way: Block = this.wayFrom(engine, train, r, live, false, res, standAt) ?? res;
    const leg = way.claims;
    let at = standAt(leg);
    if (at >= leg.length) {
      // (With blocks, its stand not found on its way afresh: what's ahead of it is asked for like any block, never
      // just taken.)
      if (this.blocking && leg.length > 0) at = Math.min(leg.length - 1, Math.max(0, this.frontIndex(leg, train, 0)));
      else {
        this.gates.delete(engine);
        this.reserve(engine, way, false, leg.length);
        return true;
      }
    }
    const upto = this.uptoAfter(leg, train, at, true);
    const stand = this.standRoad(leg, upto);
    g.turns = !!way.noLoop;
    g.want = leg.slice(at, upto);
    const s = this.scan(engine, train, leg.slice(at, upto), way.targets[way.targets.length - 1], live, g, upto === leg.length && !way.short, stand, leg[at]);
    g.hard = s.hard;
    g.standing = s.standing;
    if (s.hard.length === 0 && s.soft === -1) {
      this.ask({ engine, v: g, gate: true, way, at, upto, stand, merge: leg[at] });
      return false;
    }
    // Facing away from where it's going (turned back from meeting a train, say), its way runs on to the end of the line
    // to turn round there, and a train of its line stands in the way to it: it turns round where it stands instead.
    if (this.blocking && train.speed < 1 && this.wrongWay(leg, at, s.hard)) {
      this.shortCalls.set(engine, { stop: -1, tick: this.host.sim.ticks, turned: false, pieces: new Set() });
      this.reservations.delete(engine);
      this.gates.delete(engine);
      this.host.sim.turnBack(train.id);
      return true;
    }
    return !this.waitOn(engine, lineId, now, g, s, true);
  }

  /**
   * Turn a standing train round where it stands (see `waitOn`), if its way from there the other way round is clear of
   * its line's trains up to where it could next wait (a passing place, its stop, a turn at the end of the line). True if
   * it's turning.
   */
  private backOff(engine: number, train: Train): boolean {
    const { host } = this;
    const r = host.route(engine);
    if (!r || r.stops.length === 0 || train.speed >= 1 || train.turnback >= 0 || this.shortCalls.has(engine)) return false;
    const target = host.stopPiece(r.stops[r.at ? stopAfter(r, r.next % r.stops.length) : r.next % r.stops.length].depotId);
    if (target < 0) return false;
    const c = this.end(train, true);
    flipCursor(host.layout, c);
    const claims = claimsOf(host.layout, legFromCursor(host.layout, c, target, { throughLifts: true }));
    if (!claims || claims.length === 0) return false;
    const upto = Math.max(1, this.uptoAfter(claims, train, 0, true));
    const s = this.scan(engine, train, claims.slice(0, upto), target, host.live(engine), newVisit(Infinity, 0, host.sim.ticks), upto === claims.length, this.standRoad(claims, upto));
    if (s.hard.length > 0) return false;
    this.shortCalls.set(engine, { stop: -1, tick: host.sim.ticks, turned: false, pieces: new Set() });
    this.reservations.delete(engine);
    this.gates.delete(engine);
    host.sim.turnBack(train.id);
    return true;
  }

  /**
   * Does a way (`leg`, from claim `at`) turn back at the end of the line before its stop, with one of `hard` (trains in
   * its way) standing on it short of the turn?
   */
  private wrongWay(leg: readonly Claim[], at: number, hard: readonly number[]): boolean {
    let turn = -1;
    for (let k = Math.max(1, at + 1); k < leg.length && turn === -1; k++) if (leg[k].pieceId === leg[k - 1].pieceId && leg[k].back !== leg[k - 1].back && leg[k].len > 0) turn = k;
    if (turn === -1) return false;
    for (const u of hard) {
      const tu = this.host.sim.findCar(u)?.train;
      if (!tu || tu.speed >= 1) continue;
      for (let j = Math.max(0, at); j < turn; j++) if (tu.bogies.some((b) => b.pieceId === leg[j].pieceId)) return true;
    }
    return false;
  }

  /**
   * The roads of loops on a way (`leg`, from claim `from`) a train should keep off: in a loop it holds its own road in
   * (in `own`, from `own.from` to `own.upto`), the other road; else a road a train of its line coming the other way is
   * on, or holds (either way, for the road it's to stand on: the run whose far switch is claim `stand`); else (with
   * `calls`, the stops it calls at on this way) a road with a stop of its line on it that it isn't calling at. Null if
   * none (or both of a loop's: there's no choosing). `sig` names them, for caches.
   */
  private avoidOn(engine: number, leg: readonly Claim[], from: number, live: readonly number[], own: Reservation | null, stand = -1, calls: readonly number[] | null = null): Hint | null {
    const runs = this.runsOf(leg);
    if (runs.length === 0) return null;
    const { layout } = this.host;
    const loops = passingLoops(layout);
    const roadAt = loopRoadAt(layout);
    let keys: number[] | null = null;
    for (const run of runs) {
      // (A run it starts on: it's on its road already.)
      if (run.far < from || run.entry === -1 || !this.usable(loops[run.loop])) continue;
      let ownRoad = -1;
      // (Its own road through this loop, this way: a block may come back through a loop it left by.)
      if (own)
        for (let k = own.from; k < own.upto && ownRoad === -1; k++) {
          const c = own.claims[k];
          const at = roadAt.get(c.pieceId);
          if (at && at.loop === run.loop && (c.entry === at.aEnd) === run.toB) ownRoad = at.road;
        }
      const add: number[] = [];
      if (ownRoad !== -1) add.push(1 - ownRoad);
      else for (const road of [0, 1]) if (this.opposedOn(engine, run.loop, road, run.toB, live)) add.push(road);
      // (The road it's to stand on at its block's end: off one a train of its line stands still on, either way.)
      if (add.length === 0 && run.far === stand) for (const road of [0, 1]) if (this.standsOn(engine, run.loop, road, live, false)) add.push(road);
      // Neither: it keeps off a road with a stop of its line on it that it isn't calling at (the platform stays free for
      // a train that is: one waiting to stand there would otherwise wait for it).
      if (add.length === 0 && calls) {
        const stops = this.stopsOf(engine);
        const platform = [0, 1].filter((road) => loops[run.loop].roads[road].pieces.some((p) => stops.has(p) && !calls.includes(p)));
        if (platform.length === 1) add.push(platform[0]);
      }
      // (Else off one a train of its line is to stand on: its claim ends there.)
      if (add.length === 0 && run.far === stand) for (const road of [0, 1]) if (this.standsOn(engine, run.loop, road, live, true)) add.push(road);
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

  /**
   * Does a train of the line (other than `engine`) stand on this road of this loop (stood still with an axle on it), or
   * (`held`) hold a claim that ends standing on it (in a loop, short of its far switch)?
   */
  private standsOn(engine: number, loop: number, road: number, live: readonly number[], held: boolean): boolean {
    const { layout, sim } = this.host;
    const roadAt = loopRoadAt(layout);
    const on = (pieceId: number) => {
      const at = roadAt.get(pieceId);
      return !!at && at.loop === loop && at.road === road;
    };
    const mine = sim.findCar(engine)?.train;
    for (const u of live) {
      if (u === engine) continue;
      const tu = sim.findCar(u)?.train;
      if (!tu || tu === mine) continue;
      if (!held) {
        if (tu.speed < 1 && tu.bogies.some((b) => on(b.pieceId))) return true;
        continue;
      }
      const res = this.reservations.get(u);
      if (res && !res.free && gated(res) && res.upto > 0 && on(res.claims[res.upto - 1].pieceId)) return true;
    }
    return false;
  }

  /** A train's claim as it stands, let go behind its tail (as `reservation` does, without working it out afresh). */
  private letGoBehind(engine: number, train: Train): Reservation | undefined {
    const res = this.reservations.get(engine);
    if (!res || res.free) return res;
    for (let k = res.from; k < res.upto; k++) {
      const id = res.claims[k].pieceId;
      if (train.bogies.some((b) => b.pieceId === id)) {
        res.from = k;
        break;
      }
    }
    return res;
  }

  /** The pieces of a train's route's stops (cached by the route's stops). */
  private stopsOf(engine: number): ReadonlySet<number> {
    const r = this.host.route(engine);
    if (!r) return new Set();
    const key = r.stops.map((s) => this.host.stopPiece(s.depotId)).join(",");
    const hit = this.stopSets.get(engine);
    if (hit && hit.key === key) return hit.set;
    const set = new Set(key.split(",").map(Number));
    this.stopSets.set(engine, { key, set });
    return set;
  }

  /**
   * Is a train of the line (other than `engine`) on, or holding, this road of this loop, going the other way (`toB`:
   * ours; null: either way)?
   */
  private opposedOn(engine: number, loop: number, road: number, toB: boolean | null, live: readonly number[]): boolean {
    const { layout, sim } = this.host;
    const roadAt = loopRoadAt(layout);
    const mine = sim.findCar(engine)?.train;
    for (const u of live) {
      if (u === engine) continue;
      const tu = sim.findCar(u)?.train;
      if (!tu || tu === mine) continue;
      const res = this.letGoBehind(u, tu);
      if (res && !res.free)
        for (let k = res.from; k < res.upto; k++) {
          const c = res.claims[k];
          const at = roadAt.get(c.pieceId);
          if (at && at.loop === loop && at.road === road && (toB === null || (c.entry === at.aEnd) !== toB)) return true;
        }
      for (const c of this.occupancy(tu)) {
        const at = roadAt.get(c.pieceId);
        if (at && at.loop === loop && at.road === road && (toB === null || (c.entry === at.aEnd) !== toB)) return true;
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
    if (res && !res.free && res.claims.length > 0) return this.avoidOn(engine, res.claims, res.from, live, res, res.upto, res.targets)?.test;
    const r = this.host.route(engine);
    if (!r?.at || r.stops.length === 0) return undefined;
    const target = this.host.stopPiece(r.stops[stopAfter(r, r.next % r.stops.length)].depotId);
    const p = target < 0 ? null : this.pending(engine, train, target);
    if (!p) return undefined;
    return this.avoidOn(engine, p, 0, live, null, -1, [target])?.test;
  }

  /**
   * It came to its next stop (piece `pieceId`): its claim is over, unless it holds its block on beyond this stop (a stop
   * inside its block: it goes on from here without asking). `lever`: its lever's tick now (set again during the visit,
   * even while it's held for spacing, the player has sent it on).
   */
  arrived(engine: number, lever = 0, pieceId = -1): void {
    const res = this.reservations.get(engine);
    let keep = false;
    if (res && !res.free && pieceId >= 0)
      for (let m = 0; m < res.targets.length - 1; m++)
        if (res.targets[m] === pieceId && res.ends[m] - 1 >= res.from) {
          keep = res.upto > res.ends[m];
          break;
        }
    if (!keep && this.reservations.delete(engine)) this.lookAgain(engine);
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
    if (g && !g.granted && g.wait && now - g.asked <= 1) return g.wait;
    const p = this.parting.get(engine);
    if (!p) return null;
    if (p.tick === this.host.sim.ticks) return p.wait;
    this.parting.delete(engine);
    return null;
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
    for (const m of [this.visits, this.pendingLegs, this.hintedLegs, this.tailLegs, this.tailHinted, this.onwardLegs, this.leverAt, this.unclaimedAt, this.metAt, this.stopAhead, this.shortCalls, this.shortLookAt, this.stopSets, this.parting, this.passlessAt] as Map<number, unknown>[])
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
    const def = getPieceDef(piece.type, piece.flipped);
    const path = def.paths[r.pathIndex];
    const forward = r.s1 >= r.s0;
    // (A lift's platform is gone over end to end: in by one end, out by the other.)
    const to = def.lift ? 1 - path.from : (path.to ?? -1);
    out.push({ pieceId: r.pieceId, pathIndex: r.pathIndex, back: !forward, entry: forward ? path.from : to, exit: forward ? to : path.from, len: Math.abs(r.s1 - r.s0) });
  }
  return out;
}
