import { kitOf, getPieceDef, type KitStopWho, type Layout } from "../track";
import { SIM_DT, type Sim, type Train } from "../sim";
import { ticks } from "./constants";

/** Coming up to the stop point. */
const COMING = 0;
/** Standing at it, dwelling. */
const HALTED = 1;
/** Dwelt (or ran past it): runs on, and doesn't stop again until it has left that kit. */
const DONE = 2;

/** The train's front this close to the stop point (mm) counts as there (so the last step to a stand is a creep). */
const AT_STOP = 0.05;
/**
 * How hard a train brakes for a stop (mm/s²): the speed limit coming up to the stop point is what it can still stop
 * from there, so it eases in rather than halting dead. (The sim's own easing is twice the top speed a second.)
 */
const BRAKING = 240;
/** Slowest it creeps the last little way (mm/s), so it doesn't take for ever over the last millimetre. */
const CREEP = 6;

/** A train's visit to a kit with a stop (`KitDef.stop`). One per train at most. */
interface Visit {
  /** The kit piece. */
  pieceId: number;
  phase: number;
  /** Sim ticks it has stood at the stop point. */
  ticks: number;
  /** Which way along the kit's path the train came in (its front's cursor's `reversed` then). */
  reversed: boolean;
}

/**
 * Stops at kit pieces (src/track/kits.ts `stop`): a train they're for eases in and halts with its front at the stop
 * point, waits there for the kit's dwell (counted in sim ticks), then runs on; other trains run through. Read by the
 * economy's speed limit for trains (`Economy.capFor`, as `sim.speedCap`), as a depot's crane halts a train, and
 * ticked with the economy: so it works wherever the economy runs (Sandbox and Game mode alike).
 *
 * Cheap for trains that aren't at a kit: one piece lookup and one map lookup per powered train per tick.
 */
export class KitStops {
  private readonly visits = new Map<number, Visit>();
  /**
   * When each engine last took a service (a stop with a `cooldown`: water, coal, fuel), in sim ticks, by engine car id
   * (cars keep their ids when a train turns round or couples up).
   */
  private readonly served = new Map<number, number>();
  /** Counts trains halting at stops (for whatever wants to see one halt: a kit's moving parts, see `Economy.halts`). */
  halts = 0;

  constructor(
    private readonly layout: Layout,
    private readonly sim: Sim,
  ) {}

  /**
   * The speed limit (mm/s) kits put on a powered train this tick: a stop's (Infinity, or less coming in, 0 halted),
   * and a crawl's while any of its axles is on a kit that has one (a weighbridge).
   */
  cap(train: Train): number {
    const stop = this.stopCap(train);
    return stop === 0 ? 0 : Math.min(stop, this.crawlCap(train));
  }

  /** A crawl's speed limit: the slowest crawl of the kits under the train's axles (Infinity: none). */
  private crawlCap(train: Train): number {
    let cap = Infinity;
    let last = -1;
    for (const b of train.bogies) {
      if (b.pieceId === last) continue;
      last = b.pieceId;
      const piece = this.layout.getPiece(b.pieceId);
      const crawl = piece ? kitOf(piece.type)?.crawl : undefined;
      if (crawl !== undefined && crawl < cap) cap = crawl;
    }
    return cap;
  }

  private stopCap(train: Train): number {
    const lead = train.bogies[0];
    const piece = this.layout.getPiece(lead.pieceId);
    const kitStop = piece ? kitOf(piece.type)?.stop : undefined;
    let stop = kitStop && this.stopsFor(kitStop.who, train) ? kitStop : undefined;
    // A road ending at a buffer (a terminus's) stops trains coming in along it, not those heading back out (turned
    // round at its buffer); on a kit of several roads, whichever road the train is on.
    if (stop && lead.reversed && getPieceDef(piece!.type, piece!.flipped).paths[lead.pathIndex].to === null) stop = undefined;
    let v = this.visits.get(train.id);
    if (v && v.pieceId !== lead.pieceId) {
      // Its front is off the kit it visited. Turned round while standing there (the lever reversed: a new front): the
      // stop's over.
      if (v.phase === HALTED) v.phase = DONE;
      if (!this.on(train, v.pieceId)) {
        // Left it: it may stop there again next time.
        this.visits.delete(train.id);
        v = undefined;
      } else if (!stop) return Infinity;
      // (Still partly on it, and its front onto another kit's stop: a visit to that one.)
      else v = undefined;
    }
    if (!stop) return Infinity;
    if (!v) {
      // An engine that took this kind of service a little while ago runs through (keeps a busy line moving).
      v = { pieceId: lead.pieceId, phase: stop.cooldown && this.servedWithin(train, stop.cooldown) ? DONE : COMING, ticks: 0, reversed: lead.reversed };
      this.visits.set(train.id, v);
    }
    if (v.phase === DONE) return Infinity;
    // Turned round on the kit (its lever reversed): it runs on, the other way.
    if (lead.reversed !== v.reversed) {
      v.phase = DONE;
      return Infinity;
    }
    if (v.phase === HALTED) return 0;
    // How far the front has come onto the kit from the end it came in by: a cursor's `s` counts the way it travels
    // (from the path's `to` end when reversed), as the stop point `at` does.
    const ahead = stop.at - lead.s;
    if (ahead < -AT_STOP) {
      // Already past the stop point (put down beyond it): no stop this time.
      v.phase = DONE;
      return Infinity;
    }
    if (ahead <= AT_STOP) {
      v.phase = HALTED;
      v.ticks = 0;
      this.halts++;
      return 0;
    }
    return Math.min(Math.max(Math.sqrt(2 * BRAKING * ahead), CREEP), ahead / SIM_DT);
  }

  /** One sim tick: trains halted at a stop dwell (only while they stand there with their lever on). */
  tick(): void {
    for (const [trainId, v] of this.visits) {
      if (v.phase !== HALTED) continue;
      const train = this.sim.getTrain(trainId);
      const piece = this.layout.getPiece(v.pieceId);
      const stop = piece ? kitOf(piece.type)?.stop : undefined;
      if (!train || train.derailed || !stop) {
        this.visits.delete(trainId);
        continue;
      }
      if (train.speed !== 0 || !this.driven(train)) continue;
      if (++v.ticks < ticks(stop.seconds)) continue;
      v.phase = DONE;
      // A service taken: its engines run through services for a while.
      if (stop.cooldown) for (const car of train.cars) if (car.kind === "engine") this.served.set(car.id, this.sim.ticks);
    }
  }

  /** Did any of this train's engines take a service in the last `seconds` (game time)? */
  private servedWithin(train: Train, seconds: number): boolean {
    for (const car of train.cars) {
      if (car.kind !== "engine") continue;
      const at = this.served.get(car.id);
      if (at !== undefined && this.sim.ticks - at < ticks(seconds)) return true;
    }
    return false;
  }

  /** When this engine last took a service (sim ticks), if it has (for tests, the engine card). */
  servedAt(engineCarId: number): number | undefined {
    return this.served.get(engineCarId);
  }

  /** Is this train standing at a kit's stop (for the engine card, the debug report)? */
  dwelling(trainId: number): boolean {
    return this.dwellingAt(trainId) !== -1;
  }

  /** The kit piece this train is standing at for its stop, or −1. */
  dwellingAt(trainId: number): number {
    const v = this.visits.get(trainId);
    return v?.phase === HALTED ? v.pieceId : -1;
  }

  /** Is a train standing at this kit piece's stop now? */
  haltedAt(pieceId: number): boolean {
    for (const v of this.visits.values()) if (v.phase === HALTED && v.pieceId === pieceId) return true;
    return false;
  }

  /** Forget visits of trains that no longer exist (coupled into another, removed, lifted and turned round). */
  prune(): void {
    for (const id of this.visits.keys()) if (!this.sim.getTrain(id)) this.visits.delete(id);
    for (const id of this.served.keys()) if (!this.sim.findCar(id)) this.served.delete(id);
  }

  /** Is the stop for this train? */
  private stopsFor(who: KitStopWho, train: Train): boolean {
    if (who === "any") return true;
    if (who === "passengers") return train.cars.some((c) => c.kind === "passenger");
    return train.cars.some((c) => c.kind === "engine" && STEAM.has(this.sim.lookOf(c.id)));
  }

  /** Is any of the train's axles on this piece? */
  private on(train: Train, pieceId: number): boolean {
    for (const b of train.bogies) if (b.pieceId === pieceId) return true;
    return false;
  }

  /** Is the train's lever on (its engines driving it one way or the other)? */
  private driven(train: Train): boolean {
    let net = 0;
    for (const car of train.cars) if (car.kind === "engine") net += car.lever * car.facing;
    return net !== 0;
  }
}

/** Engine looks that are steam engines (for `who: "steam"`). */
const STEAM: ReadonlySet<string> = new Set(["classic", "tank", "express", "goods"]);
