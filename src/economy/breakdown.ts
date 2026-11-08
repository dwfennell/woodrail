import { getPieceDef, pointsStateFor, pointsWayFrom, type Layout } from "../track";
import { CAR_SPECS, flipCursor, nearestCursor, SIM_HZ, type Cursor, type Sim, type Train } from "../sim";
import { waysFrom } from "../routing/graph";
import { legFromCursor, runsLength, type PathRun } from "../game/route-path";

/**
 * The breakdown crane (Game mode's Breakdown crane, tech-tree "breakdown"): a crane wagon in a train with an engine
 * drives out along the track to a derailed train and lifts it back on, or to a train stuck in the way of others and
 * lifts it off the line, back into the box.
 *
 * - **By itself:** a crane train standing idle (its levers off, on no line) sets out for a train that has come off the
 *   rails, the nearest such crane first. A derailed train is picked up again on the card, or by the HUD's Re-rail, as
 *   before: the crane is the toy way, not the only one.
 * - **Sent:** a stuck train's card offers "Send the crane" for the train in its way (`send`, kind "remove").
 * - **Driving:** the crane train runs on its engine's lever, toward whichever of its ends has the shorter way there (the
 *   router's own walk, `legFromCursor`), turning back at a line's end as any train does. A few times a second it sets
 *   the points just ahead its way (not points a train is on or a route has locked), and stops once its crane is
 *   within `CRANE_REACH` of the train (across a line beside it too: the jib reaches).
 * - **Working:** the turret slews round to face the train, the hook drops, the train is lifted (its cars come upright
 *   as they rise), then set down on the nearest free track (`Sim.rerail`, its cars' ids and loads kept), or lifted off
 *   and taken away (`Sim.removeTrain`, as the card's Remove does). The turret swings home. The crane train waits there.
 *
 * Cost: nothing per tick with no job, but a look every `LOOK_TICKS` for derailed trains (a loop over the trains). Not
 * saved: a job under way at a save is begun again by itself after a load (a derailed train), or sent again.
 */

/** How near (mm, crane car's middle to the nearest car of the train it works) a crane can lift a train from. */
export const CRANE_REACH = 160;
/** How far ahead (mm) a driving crane sets the points its way. */
const POINTS_LOOK = 700;
/** How often (ticks) a driving crane looks again, and an idle one for a derailed train. */
const DRIVE_TICKS = 12;
const LOOK_TICKS = 60;
/** A crane train that has stood this long (s) with its lever on, short of the train, gives up (something's in its way). */
const BLOCKED_S = 8;
/** The longest (s) a crane drives before it gives up. */
const DRIVE_MAX_S = 180;

/** How long each step of the work takes (s). */
export const CRANE_STEPS = { swing: 1.1, lower: 0.8, lift: 1.4, set: 1.0, stow: 1.1 } as const;
type Step = keyof typeof CRANE_STEPS;
const ORDER: readonly Step[] = ["swing", "lower", "lift", "set", "stow"];

/** The rope's length (mm) at rest, and paid out to reach a train. */
export const ROPE_REST = 12;
const ROPE_DOWN = 34;

export type CraneJobKind = "rerail" | "remove";

export interface CraneJob {
  /** The crane car's id. */
  readonly crane: number;
  /** A car of the train it's for (car ids survive a re-rail). */
  readonly target: number;
  readonly kind: CraneJobKind;
  /** Set out by itself (a derailed train and an idle crane), or sent from a card. */
  readonly auto: boolean;
  /**
   * "drive": out to the train; the steps of the work; then "home": back to where it set out from (`home`), clear of
   * the line it worked on (QA 2026-11-05 #2: it stood in the way of the train it put right).
   */
  phase: "drive" | Step | "home";
  /** The piece the crane train stood on when it was sent: where it goes back to after the work. */
  home: number;
  /** Ticks into the phase. */
  t: number;
  /** Ticks driving, and standing still with its lever on. */
  driven: number;
  blocked: number;
  /** Which way it drives (+1: toward its train's front). */
  sign: 1 | -1;
  /** The turret's slew now and the way it turns to (radians, about the car's up; 0: along the car). */
  slew: number;
  slewTo: number;
  /** The target's lift (0 to 1). */
  hoist: number;
}

export type CraneEvent =
  | { kind: "sent"; crane: number; target: number; auto: boolean }
  /** `goes`: the train carries on (its levers set back as they were). */
  | { kind: "rerailed"; crane: number; target: number; goes: boolean }
  | { kind: "removed"; crane: number; target: number }
  | { kind: "gave-up"; crane: number; target: number; why: "no-way" | "blocked" | "no-room" };

export type SendResult = { ok: true; crane: number } | { ok: false; why: "no-crane" | "busy" | "no-way" | "on-its-way" };

/** What the cranes need of the economy. */
export interface BreakdownHost {
  /** Is this engine on a line (driven by its route: not a crane to send)? */
  onLine(engine: number): boolean;
  /** Is this piece's lever locked for a routed train (`Router.locked`)? */
  locked(pieceId: number): boolean;
  /** Points thrown (the game swings the lever, with a click). */
  thrown(pieceId: number): void;
  /** A train taken off the track (the economy prunes what was its). */
  removed(): void;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The middle of car `i` of a train (between its two axles), into `out`. */
function carMiddle(t: Train, i: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const a = t.world[2 * i];
  const b = t.world[2 * i + 1];
  out.x = (a.x + b.x) / 2;
  out.y = (a.y + b.y) / 2;
  out.z = (a.z + b.z) / 2;
  return out;
}

const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };

export class Breakdown {
  /** Derailed trains (a car of each) whose crane the player stopped: not set out for again by itself. */
  private readonly calledOff = new Set<number>();
  /** Jobs under way, by crane car id. */
  private readonly jobs = new Map<number, CraneJob>();
  private events: CraneEvent[] = [];
  /** Jobs done, for tests and the play-through. */
  rerailed = 0;
  removed = 0;

  constructor(
    private readonly layout: Layout,
    private readonly sim: Sim,
    private readonly host: BreakdownHost,
  ) {}

  /** Is any job under way (the game draws frames while one works)? */
  get busy(): boolean {
    return this.jobs.size > 0;
  }

  /** The job a crane is on, or the job for a train (by any of its cars), if any. */
  jobOf(craneCar: number): CraneJob | undefined {
    return this.jobs.get(craneCar);
  }

  jobFor(carId: number): CraneJob | undefined {
    if (this.jobs.size === 0) return undefined;
    const found = this.sim.findCar(carId);
    for (const j of this.jobs.values()) {
      // (Going home, its job for the train is done.)
      if (j.phase === "home") continue;
      if (j.target === carId) return j;
      if (found && found.train.cars.some((c) => c.id === j.target)) return j;
    }
    return undefined;
  }

  /** Every job under way (the game poses the cranes and the trains they lift). */
  all(): IterableIterator<CraneJob> {
    return this.jobs.values();
  }

  /** How a crane's turret and rope stand now (its rest when it has no job). */
  poseOf(job: CraneJob): { slew: number; rope: number } {
    const p = job.phase;
    const f = p === "drive" || p === "home" ? 0 : ease(job.t / (CRANE_STEPS[p] * SIM_HZ));
    const rope = p === "lower" ? ROPE_REST + (ROPE_DOWN - ROPE_REST) * f : p === "lift" ? ROPE_DOWN - (ROPE_DOWN - ROPE_REST) * f * 0.8 : p === "set" ? ROPE_REST + (ROPE_DOWN - ROPE_REST) * 0.2 * (1 - f) : ROPE_REST;
    return { slew: job.slew, rope };
  }

  /** Cars of trains a crane is lifting, and how far (0 to 1): a car not in it isn't lifted. */
  hoistOf(carId: number): number {
    if (this.jobs.size === 0) return 0;
    // (Asked for every car every frame while a crane works: the lifted cars are found once a tick, not once a car.)
    if (this.hoistedAt !== this.ticks) {
      this.hoistedAt = this.ticks;
      this.hoisted.clear();
      for (const j of this.jobs.values()) {
        if (j.hoist <= 0) continue;
        const t = this.sim.findCar(j.target)?.train;
        if (t) for (const c of t.cars) if (!this.hoisted.has(c.id)) this.hoisted.set(c.id, j.hoist);
      }
    }
    return this.hoisted.get(carId) ?? 0;
  }
  /** The cars being lifted now, and how far (`hoistOf`), as of tick `hoistedAt`. */
  private readonly hoisted = new Map<number, number>();
  private hoistedAt = -1;
  /** Ticks run (`tick`). */
  private ticks = 0;

  drainEvents(): CraneEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Crane trains on the map: their crane car's id, the train, and whether it's free to send (no job, on no line, railed). */
  cranes(): { crane: number; train: Train; free: boolean; idle: boolean }[] {
    const out: { crane: number; train: Train; free: boolean; idle: boolean }[] = [];
    for (const t of this.sim.trains()) {
      const crane = t.cars.find((c) => c.kind === "crane");
      if (!crane) continue;
      const engines = t.cars.filter((c) => c.kind === "engine");
      // (Going home after a job, it's free: sent again, the new job takes over.)
      const free = !t.derailed && engines.length > 0 && !engines.some((e) => this.host.onLine(e.id)) && (!this.jobs.has(crane.id) || this.jobs.get(crane.id)!.phase === "home");
      out.push({ crane: crane.id, train: t, free, idle: free && t.speed < 1 && engines.every((e) => e.lever === 0) });
    }
    return out;
  }

  /**
   * Is there a crane train to lift the train with car `target` off the line for the train with car `stuck`: one that is
   * neither of them? (The only crane on the map can be the train in the way, parked after a job: then there's none to
   * send, and the stuck train's card offers no "Send the crane".)
   */
  canLift(target: number, stuck: number): boolean {
    const a = this.sim.findCar(target)?.train;
    const b = this.sim.findCar(stuck)?.train;
    return this.cranes().some((c) => c.train !== a && c.train !== b);
  }

  /**
   * Send the nearest free crane train to the train with car `target`: to lift it back on (it's derailed) or off the
   * line (`kind` "remove"). `idleOnly`: only a crane standing with its levers off (setting out by itself).
   */
  send(target: number, kind: CraneJobKind, auto = false, idleOnly = false): SendResult {
    const found = this.sim.findCar(target);
    if (!found) return { ok: false, why: "no-way" };
    if (this.jobFor(target)) return { ok: false, why: "on-its-way" };
    const cranes = this.cranes().filter((c) => c.train.id !== found.train.id);
    if (cranes.length === 0) return { ok: false, why: "no-crane" };
    const free = cranes.filter((c) => (idleOnly ? c.idle : c.free));
    if (free.length === 0) return { ok: false, why: "busy" };
    const goals = this.goalPieces(found.train, kind);
    let best: { crane: number; train: Train; sign: 1 | -1; length: number } | null = null;
    for (const c of free) {
      const way = this.wayFor(c.train, goals);
      if (way && (!best || way.length < best.length)) best = { crane: c.crane, train: c.train, sign: way.sign, length: way.length };
    }
    if (!best) return { ok: false, why: "no-way" };
    const job: CraneJob = { crane: best.crane, target, kind, auto, phase: "drive", home: best.train.bogies[0]?.pieceId ?? -1, t: 0, driven: 0, blocked: 0, sign: best.sign, slew: 0, slewTo: 0, hoist: 0 };
    this.jobs.set(best.crane, job);
    this.hoistedAt = -1;
    this.events.push({ kind: "sent", crane: best.crane, target, auto });
    // (Already in reach: straight to work. Else off it goes.)
    if (!this.inReach(best.train, best.crane, found.train)) this.drive(job, best.train);
    return { ok: true, crane: best.crane };
  }

  /** Call off a crane's job (the player took the train back, say): it stops where it is. */
  cancel(craneCar: number): void {
    const job = this.jobs.get(craneCar);
    if (!job) return;
    this.jobs.delete(craneCar);
    this.hoistedAt = -1;
    const t = this.sim.findCar(craneCar)?.train;
    if (t && job.phase === "drive") this.setLevers(t, 0);
  }

  /** One sim tick. */
  tick(): void {
    this.ticks++;
    const ticks = this.sim.ticks;
    if (this.jobs.size === 0) {
      if (ticks % LOOK_TICKS === 0) this.lookForDerailed();
      return;
    }
    if (ticks % LOOK_TICKS === 0) this.lookForDerailed();
    for (const job of [...this.jobs.values()]) this.step(job);
  }

  /** An idle crane sets out for each derailed train that has none coming. */
  private lookForDerailed(): void {
    // (A train the player called the crane off from, put right or gone since: forgotten.)
    for (const id of this.calledOff) if (!this.sim.findCar(id)?.train.derailed) this.calledOff.delete(id);
    let derailed: Train[] | null = null;
    for (const t of this.sim.trains()) {
      if (t.derailed && t.cars.length > 0 && !this.jobFor(t.cars[0].id) && !t.cars.some((c) => this.calledOff.has(c.id))) (derailed ??= []).push(t);
    }
    if (!derailed) return;
    for (const t of derailed) if (this.send(t.cars[0].id, "rerail", true, true).ok === false && !this.cranes().some((c) => c.idle)) return;
  }

  private step(job: CraneJob): void {
    const sim = this.sim;
    const craneAt = sim.findCar(job.crane);
    if (job.phase === "home") return this.goHome(job, craneAt?.train);
    const target = sim.findCar(job.target)?.train;
    // (The crane or the train gone, the crane come off the rails, or the train put right some other way: the job's over.)
    const over = !craneAt || craneAt.train.derailed || !target || (job.kind === "rerail" && !target.derailed && job.phase !== "set" && job.phase !== "stow") || (job.kind === "remove" && target.derailed);
    if (over && job.phase !== "stow") {
      // (Mid-lift with the train gone: it swings home all the same.)
      if (craneAt && !craneAt.train.derailed && job.phase !== "drive") {
        job.hoist = 0;
        this.enter(job, "stow");
        return;
      }
      this.cancel(job.crane);
      return;
    }
    const crane = craneAt!.train;
    if (job.phase === "drive") {
      job.driven++;
      if (crane.speed < 1 && crane.cars.some((c) => c.kind === "engine" && c.lever !== 0)) job.blocked++;
      else job.blocked = 0;
      if (job.driven % DRIVE_TICKS !== 0) return;
      if (this.inReach(crane, job.crane, target!)) {
        this.setLevers(crane, 0);
        if (crane.speed < 1) this.startWork(job, crane, target!);
        return;
      }
      // (The player stopped it, its levers off: the job's called off, and it stays where it stands.)
      if (crane.cars.every((c) => c.kind !== "engine" || c.lever === 0)) {
        this.jobs.delete(job.crane);
        this.hoistedAt = -1;
        if (job.auto) this.calledOff.add(job.target);
        return;
      }
      if (job.blocked > BLOCKED_S * SIM_HZ) return this.giveUp(job, crane, "blocked");
      if (job.driven > DRIVE_MAX_S * SIM_HZ) return this.giveUp(job, crane, "no-way");
      if (!this.drive(job, crane)) return this.giveUp(job, crane, "no-way");
      return;
    }
    job.t++;
    const f = ease(job.t / (CRANE_STEPS[job.phase] * SIM_HZ));
    if (job.phase === "swing") job.slew = job.slewTo * f;
    else if (job.phase === "lift") job.hoist = f;
    else if (job.phase === "set" && job.kind === "rerail") job.hoist = 1 - f;
    else if (job.phase === "stow") job.slew = job.slewTo * (1 - f);
    if (job.t < CRANE_STEPS[job.phase] * SIM_HZ) return;
    const next = ORDER[ORDER.indexOf(job.phase) + 1];
    if (!next) {
      // (Stowed: back to where it set out from, unless it's there.)
      if (job.home !== -1 && !sim.piecesUnder(crane.id).has(job.home) && this.startHome(job, crane)) return;
      this.jobs.delete(job.crane);
      this.hoistedAt = -1;
      return;
    }
    if (next === "set") {
      // The train set down on the track, or taken away.
      const t = target!;
      if (job.kind === "rerail") {
        carMiddle(crane, crane.cars.findIndex((c) => c.id === job.crane), _a);
        // (Nearest the crane's hook: the train was lifted toward it.)
        const near = this.nearestCar(t, _a);
        // (Each engine's lever as it was, toward the train's own front or back: set again once it's back on the track.)
        const levers = new Map<number, number>();
        for (const c of t.cars) if (c.kind === "engine") levers.set(c.id, c.lever * c.facing);
        const back = sim.rerail(t.id, 150, near);
        if (back === -1) {
          job.hoist = 0;
          this.events.push({ kind: "gave-up", crane: job.crane, target: job.target, why: "no-room" });
          this.enter(job, "stow");
          return;
        }
        this.rerailed++;
        // It carries on as it was going (a routed train along its route): set down, its motor would be off.
        let goes = false;
        for (const c of sim.getTrain(back)?.cars ?? []) {
          const was = levers.get(c.id);
          if (c.kind !== "engine" || !was) continue;
          sim.setLever(c.id, (was * c.facing) as -1 | 0 | 1);
          goes = true;
        }
        this.events.push({ kind: "rerailed", crane: job.crane, target: job.target, goes });
      } else {
        sim.removeTrain(t.id);
        this.host.removed();
        job.hoist = 0;
        this.removed++;
        this.events.push({ kind: "removed", crane: job.crane, target: job.target });
        this.enter(job, "stow");
        return;
      }
    }
    this.enter(job, next);
  }

  private enter(job: CraneJob, phase: Step): void {
    job.phase = phase;
    job.t = 0;
  }

  private startWork(job: CraneJob, crane: Train, target: Train): void {
    // (The turret turns to face the train's nearest car, from the crane car's heading.)
    const i = crane.cars.findIndex((c) => c.id === job.crane);
    carMiddle(crane, i, _a);
    const near = this.nearestCar(target, _a);
    const f = crane.world[2 * i];
    const r = crane.world[2 * i + 1];
    const car = crane.cars[i];
    // (The car's +x is its front: the way its first axle lies from its second, turned if it runs backwards.)
    const along = Math.atan2(f.z - r.z, f.x - r.x) + (car.facing === 1 ? 0 : Math.PI);
    const to = Math.atan2(near.z - _a.z, near.x - _a.x);
    // (The turret stands toward the car's back; the jib reaches forward: aimed from its middle, near enough.)
    let d = -(to - along);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    job.slewTo = d;
    this.enter(job, "swing");
  }

  private giveUp(job: CraneJob, crane: Train, why: "no-way" | "blocked" | "no-room"): void {
    this.setLevers(crane, 0);
    this.jobs.delete(job.crane);
    this.hoistedAt = -1;
    this.events.push({ kind: "gave-up", crane: job.crane, target: job.target, why });
  }

  /** Set off home after the work: false if there's no way back (it stays where it is). */
  private startHome(job: CraneJob, crane: Train): boolean {
    const way = this.wayFor(crane, [job.home]);
    if (!way) return false;
    job.phase = "home";
    job.t = 0;
    job.driven = 0;
    job.blocked = 0;
    job.sign = way.sign;
    this.setPoints(way.leg);
    this.setLevers(crane, way.sign);
    return true;
  }

  /**
   * Driving home: it stops once on the piece it set out from. Stopped by the player, blocked (the train it put right
   * is in its way, say), or too long on the way: it stops where it is, saying nothing (the job's done).
   */
  private goHome(job: CraneJob, crane: Train | undefined): void {
    if (!crane || crane.derailed) {
      this.jobs.delete(job.crane);
      return;
    }
    job.driven++;
    if (crane.speed < 1 && crane.cars.some((c) => c.kind === "engine" && c.lever !== 0)) job.blocked++;
    else job.blocked = 0;
    if (job.driven % DRIVE_TICKS !== 0) return;
    const stop = () => {
      this.setLevers(crane, 0);
      this.jobs.delete(job.crane);
    };
    if (this.sim.piecesUnder(crane.id).has(job.home)) return stop();
    if (crane.cars.every((c) => c.kind !== "engine" || c.lever === 0)) {
      this.jobs.delete(job.crane);
      return;
    }
    if (job.blocked > BLOCKED_S * SIM_HZ || job.driven > DRIVE_MAX_S * SIM_HZ) return stop();
    const way = this.wayFor(crane, [job.home]);
    if (!way) return stop();
    job.sign = way.sign;
    this.setPoints(way.leg);
    this.setLevers(crane, way.sign);
  }

  /** Set its way off again: the points ahead, and its levers. False: no way there now. */
  private drive(job: CraneJob, crane: Train): boolean {
    const target = this.sim.findCar(job.target)?.train;
    if (!target) return false;
    const way = this.wayFor(crane, this.goalPieces(target, job.kind));
    if (!way) return false;
    job.sign = way.sign;
    this.setPoints(way.leg);
    this.setLevers(crane, way.sign);
    return true;
  }

  /** Each engine's lever so the train runs toward its front (`sign` 1) or its back (−1), or off (0). */
  private setLevers(t: Train, sign: -1 | 0 | 1): void {
    for (const c of t.cars) if (c.kind === "engine") this.sim.setLever(c.id, (sign * c.facing) as -1 | 0 | 1);
  }

  /** The pieces a crane drives toward for a train: the track nearest each car of a derailed one, or the pieces under one. */
  private goalPieces(t: Train, kind: CraneJobKind): number[] {
    const out = new Set<number>();
    if (kind === "rerail" || t.derailed) {
      for (let i = 0; i < t.cars.length; i++) {
        carMiddle(t, i, _b);
        const near = nearestCursor(this.layout, _b.x, _b.z, CRANE_REACH, 0);
        if (near) out.add(near.cursor.pieceId);
      }
    } else if (t.bogies.length > 0) {
      out.add(t.bogies[0].pieceId);
      out.add(t.bogies[t.bogies.length - 1].pieceId);
    }
    return [...out];
  }

  /** The shorter way (by its front or its back) for a train to one of `goals`, or null. */
  private wayFor(t: Train, goals: readonly number[]): { sign: 1 | -1; leg: PathRun[]; length: number } | null {
    if (t.bogies.length === 0 || goals.length === 0) return null;
    const front: Cursor = { ...t.bogies[0] };
    const back: Cursor = { ...t.bogies[t.bogies.length - 1] };
    flipCursor(this.layout, back);
    let best: { sign: 1 | -1; leg: PathRun[]; length: number } | null = null;
    for (const [sign, from] of [[1, front], [-1, back]] as const) {
      for (const g of goals) {
        // (Its own pieces are the goal: nothing to drive.)
        const leg = legFromCursor(this.layout, from, g);
        if (!leg) continue;
        const length = runsLength(leg);
        if (!best || length < best.length) best = { sign, leg, length };
      }
    }
    return best;
  }

  /** Throw the points along the first `POINTS_LOOK` of a way to the road it takes (none a train is on or a route holds). */
  private setPoints(leg: readonly PathRun[]): void {
    let d = 0;
    for (let i = 0; i < leg.length && d < POINTS_LOOK; i++) {
      const run = leg[i];
      const piece = this.layout.getPiece(run.pieceId);
      if (piece && i > 0) {
        const def = getPieceDef(piece.type, piece.flipped);
        if (def.isSwitch && !def.gated && !def.signal && !def.lift) {
          const path = def.paths[run.pathIndex];
          const entry = run.s1 >= run.s0 ? path.from : (path.to ?? -1);
          const ways = waysFrom(this.layout, run.pieceId, entry);
          const option = ways.findIndex((w) => w.path === run.pathIndex);
          if (ways.length > 1 && option >= 0 && pointsWayFrom(this.layout, run.pieceId, entry, ways.length) !== option && !this.sim.pointsHeld(run.pieceId) && !this.host.locked(run.pieceId)) {
            this.layout.setSwitchState(run.pieceId, pointsStateFor(this.layout, run.pieceId, entry, option));
            this.host.thrown(run.pieceId);
          }
        }
      }
      d += Math.abs(run.s1 - run.s0);
    }
  }

  /** Is a crane car within reach of any car of a train? */
  private inReach(crane: Train, craneCar: number, target: Train): boolean {
    const i = crane.cars.findIndex((c) => c.id === craneCar);
    if (i < 0) return false;
    carMiddle(crane, i, _a);
    const n = this.nearestCar(target, _a);
    return Math.hypot(n.x - _a.x, n.z - _a.z) <= CRANE_REACH + CAR_SPECS.crane.length / 2;
  }

  /** The middle of a train's car nearest a point. */
  private nearestCar(t: Train, p: { x: number; z: number }): { x: number; z: number } {
    let best = { x: 0, z: 0 };
    let bd = Infinity;
    for (let i = 0; i < t.cars.length; i++) {
      carMiddle(t, i, _b);
      const d = Math.hypot(_b.x - p.x, _b.z - p.z);
      if (d < bd) {
        bd = d;
        best = { x: _b.x, z: _b.z };
      }
    }
    return best;
  }
}

const NO_EVENTS: CraneEvent[] = [];
