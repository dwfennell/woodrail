import type { Sim, Train } from "../sim";
import { CHECK_TICKS, type Sections } from "./sections";

/**
 * Stalls: trains stuck for good, said on their cards (routing spec §16 Q3). Nothing turns a train back short of the end
 * of the track, so a wait that can't end lasts till the player changes something, and the player must see why:
 *
 * - **A ring:** trains each waiting on the next, round to the first (two nose to nose on single track is the smallest).
 *   Its trains, and those waiting on one of them, are stuck "in the way" of each other: one must be moved or put away
 *   (a passing loop alone doesn't help two lines' trains: nothing has them wait for each other there).
 * - **Too many trains:** a chain of waits ending at a train its line has no room for (sections' room rule holds it), the
 *   line over room: "too many" for the line.
 * - **Parked:** a chain of waits ending at a train standing with its lever off (the player's own): only moving it helps.
 *
 * A wait is who a standing train with its lever on waits for: sections' wait (a train of its line, or one in its way),
 * the router's (points held for another train), or the sim's (`Sim.heldBy`: short of a crossing or switch another is on,
 * close behind it, nose to nose or against its side), or a lineless train's short of one ahead (`Sections.clearWait`).
 * A chain that ends anywhere else (a train under way, one at a stop, a red signal) isn't a stall: it ends on its own.
 *
 * Cost: nothing per frame. Every `CHECK_TICKS`, with two or more trains, each standing train's chain is followed (each
 * waits on at most one, so O(trains)). A stall must hold `STUCK_S` before it's said, so ordinary meets never are.
 */

/** A wait that can't end must hold this long (s) before its trains are said to be stuck. */
export const STUCK_S = 5;

/** Why a train is stuck. */
export type Stuck =
  /** In a ring of waits: `by` (an engine, or the first car of a train with none) is the train in its way. */
  | { kind: "in-way"; by: number }
  /** Its line has more trains than room, and the one held for it is in the way (`lineId`: that line). */
  | { kind: "too-many"; lineId: number }
  /** A train standing with its lever off (`by`) is in the way, of it or of the train it waits for. */
  | { kind: "parked"; by: number };

/** What stalls read of the economy (or the harness). */
export interface StallsHost {
  /** The line an engine runs (−1: none). */
  lineOf(engine: number): number;
  /** The train (an engine) a routed engine waits for short of points (`Router.waitingOn`); null: none. */
  routeWait(engine: number): { engine: number } | null;
}

/** A train's name in waits: its engine, or its first car if it has none (as sections name trains). */
function nameOf(t: Train): number {
  return t.cars.find((c) => c.kind === "engine")?.id ?? t.cars[0].id;
}

function drive(t: Train): number {
  let net = 0;
  for (const car of t.cars) if (car.kind === "engine") net += car.lever * car.facing;
  return net;
}

export class Stalls {
  /** Stuck trains (by engine) and why, as of the last check. */
  private stuck = new Map<number, Stuck>();
  /** Trains in a wait that can't end, by engine: since when (tick) it has held, and why. */
  private readonly since = new Map<number, { tick: number; why: Stuck }>();
  /** Stalls begun (each a set of trains newly stuck at one check), for tests and the play-through. */
  begun = 0;
  /** Told when trains come to be stuck (once a stall): their engines, and why the first is. */
  onStuck: ((engines: readonly number[], why: Stuck) => void) | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly sections: Sections,
    private readonly host: StallsHost,
  ) {}

  /** Why this engine's train is stuck (null: it isn't). */
  stuckOf(engine: number): Stuck | null {
    if (this.stuck.size === 0) return null;
    return this.stuck.get(engine) ?? null;
  }

  /** How many trains are stuck now. */
  get count(): number {
    return this.stuck.size;
  }

  /** Called every sim tick (after the sim's, the routes' and the router's): looks every `CHECK_TICKS`. */
  tick(): void {
    const { sim } = this;
    if (sim.ticks % CHECK_TICKS !== 0) return;
    const ids = sim.trainIds();
    if (ids.length < 2) {
      if (this.stuck.size > 0) this.stuck = new Map();
      this.since.clear();
      return;
    }
    // (Each standing train with its lever on: who it waits for, if anyone.)
    const on = new Map<number, number>();
    const standing = new Set<number>();
    for (const id of ids) {
      const t = sim.getTrain(id)!;
      if (t.derailed || t.speed >= 1 || t.turnback >= 0 || drive(t) === 0) continue;
      standing.add(id);
      const by = this.waitOf(t);
      if (by !== null && by !== id) on.set(id, by);
    }
    const now = sim.ticks;
    const found = new Map<number, Stuck>();
    for (const start of on.keys()) {
      const chain: number[] = [];
      let x = start;
      let parked: Train | null = null;
      let why: "ring" | "parked" | number | null = null;
      for (;;) {
        chain.push(x);
        const y = on.get(x);
        if (y === undefined) {
          // (The end of the chain: stuck only at a train its line holds for want of room, standing.)
          const t = sim.getTrain(x);
          const e = t ? this.lineEngine(t) : -1;
          if (x !== start && t && t.speed < 1 && e >= 0 && this.sections.heldForRoom(e)) why = this.host.lineOf(e);
          break;
        }
        if (chain.includes(y)) {
          why = "ring";
          break;
        }
        if (!standing.has(y)) {
          // (Standing with its lever off: parked, by the player. Only moving it helps.)
          const p = sim.getTrain(y);
          if (p && !p.derailed && p.speed < 1 && drive(p) === 0) {
            parked = p;
            why = "parked";
          }
          break;
        }
        x = y;
      }
      if (why === null) continue;
      for (const id of chain) {
        const t = sim.getTrain(id)!;
        // (The held train itself is waiting by rule: its card already says the line is full.)
        if (!on.has(id)) continue;
        const by = sim.getTrain(on.get(id)!);
        const engine = this.lineEngine(t);
        if (engine < 0 || !by) continue;
        found.set(engine, why === "ring" ? { kind: "in-way", by: nameOf(by) } : why === "parked" ? { kind: "parked", by: nameOf(parked!) } : { kind: "too-many", lineId: why });
      }
    }
    // (Said once it has held `STUCK_S`.)
    for (const e of this.since.keys()) if (!found.has(e)) this.since.delete(e);
    const stuck = new Map<number, Stuck>();
    const fresh: number[] = [];
    for (const [e, why] of found) {
      const s = this.since.get(e);
      if (!s || s.why.kind !== why.kind) this.since.set(e, { tick: now, why });
      else s.why = why;
      if (now - this.since.get(e)!.tick < STUCK_S * 120) continue;
      stuck.set(e, why);
      if (!this.stuck.has(e)) fresh.push(e);
    }
    this.stuck = stuck;
    if (fresh.length > 0) {
      this.begun++;
      this.onStuck?.(fresh, stuck.get(fresh[0])!);
    }
  }

  /** The train (its id) a standing train waits for: its line's, the router's, the sim's, or short of one ahead. */
  private waitOf(t: Train): number | null {
    const { sim } = this;
    for (const car of t.cars) {
      if (car.kind !== "engine") continue;
      const w = this.sections.waitOf(car.id);
      if (w && "engine" in w && w.engine >= 0) {
        const by = sim.findCar(w.engine)?.train;
        if (by) return by.id;
      }
      const r = this.host.routeWait(car.id);
      if (r && r.engine >= 0) {
        const by = sim.findCar(r.engine)?.train;
        if (by) return by.id;
      }
    }
    return sim.heldBy(t.id) ?? this.sections.clearWait(t.id);
  }

  /** A train's engine on a line, else its first engine (−1: none). */
  private lineEngine(t: Train): number {
    let first = -1;
    for (const car of t.cars) {
      if (car.kind !== "engine") continue;
      if (this.host.lineOf(car.id) >= 0) return car.id;
      if (first < 0) first = car.id;
    }
    return first;
  }
}
