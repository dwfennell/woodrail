import { SIM_DT } from "../sim";

/** Before a line's lap is known: trains on it leave a stop at least this long (s) apart. */
export const DEFAULT_HEADWAY_S = 8;
/** A train is never held at a stop longer than this (s) for spacing, from when it would first have left. */
export const MAX_HOLD_S = 20;
/** How much a new lap counts in a line's lap estimate (the rest is the estimate so far). */
const LAP_WEIGHT = 0.5;

interface LineSpacing {
  /** The line's stops as they were when this was learnt (an edit starts it afresh). */
  stops: string;
  /** The last departure (economy tick, and which engine) from each stop, by stop index. */
  lastDepart: Map<number, { tick: number; engine: number }>;
  /** Where each of its engines is standing now (at its next stop, since a tick), till it leaves. */
  at: Map<number, { index: number; tick: number }>;
  /** How long (ticks) a lap takes running (holds left out), as an estimate from trains' laps; 0 until one is known. */
  lap: number;
  /** When each engine last left the line's first stop (its lap starts there), or none since an edit. */
  lapFrom: Map<number, number>;
  /** How long (ticks) each engine has been held since its lap began (left out of the lap: it's the spacing's own). */
  heldInLap: Map<number, number>;
}

/**
 * Auto-spacing (routes Phase 2): trains on one line spread out. A train that has done its work at its stop (or has none
 * there) waits a moment longer: while another train of its line that came to that stop before it is still there, and
 * then till a headway has passed since the last other train left it (a lap's time shared among the line's trains; until
 * a lap is known, `DEFAULT_HEADWAY_S`). Never more than `MAX_HOLD_S` in all. All in the economy's ticks (sim time), so a
 * pause skews nothing; nothing here is saved (it's learnt again).
 */
export class Spacing {
  private readonly lines = new Map<number, LineSpacing>();
  /**
   * Each held engine's hold: when it began, and its lever then (set again, by the player, it lets the train go). Cleared
   * when it leaves its stop.
   */
  private readonly holdFrom = new Map<number, { tick: number; lever: number }>();

  private of(lineId: number, stops: string): LineSpacing {
    let s = this.lines.get(lineId);
    if (!s || s.stops !== stops) this.lines.set(lineId, (s = { stops, lastDepart: new Map(), at: new Map(), lap: 0, lapFrom: new Map(), heldInLap: new Map() }));
    return s;
  }

  /** Engine `engine` of line `lineId` (stops signature `stops`) came to its stop `index` at tick `now`. */
  arrived(lineId: number, stops: string, engine: number, index: number, now: number): void {
    this.of(lineId, stops).at.set(engine, { index, tick: now });
  }

  /** Engine `engine` of line `lineId` (stops signature `stops`) left its stop `index` at tick `now`. */
  departed(lineId: number, stops: string, engine: number, index: number, now: number): void {
    const s = this.of(lineId, stops);
    s.lastDepart.set(index, { tick: now, engine });
    s.at.delete(engine);
    const held = this.holdFrom.get(engine);
    if (held) s.heldInLap.set(engine, (s.heldInLap.get(engine) ?? 0) + (now - held.tick));
    this.holdFrom.delete(engine);
    if (index !== 0) return;
    // A lap: from one departure from the first stop to the next (only whole laps since the line was last edited), less
    // the time it was held (else holds would lengthen the lap, and so the headway, and so the holds).
    const from = s.lapFrom.get(engine);
    if (from !== undefined) {
      const lap = now - from - (s.heldInLap.get(engine) ?? 0);
      s.lap = s.lap === 0 ? lap : s.lap * (1 - LAP_WEIGHT) + lap * LAP_WEIGHT;
    }
    s.lapFrom.set(engine, now);
    s.heldInLap.set(engine, 0);
  }

  /**
   * Should engine `engine`, at its stop `index` of line `lineId`, wait (tick `now`)? `live`: the line's engines running
   * now (on the track, not derailed); `lever`: when its lever was last set. Starts its hold the first time it's asked;
   * false once it may go, the hold has run `MAX_HOLD_S`, or its lever has been set since (the player sends it on).
   */
  holds(lineId: number, stops: string, engine: number, index: number, live: readonly number[], now: number, lever = 0): boolean {
    if (live.length < 2) return false;
    // Let go (its lever set since the hold began): not held again this visit.
    const held = this.holdFrom.get(engine);
    if (held && held.lever !== lever) return false;
    const s = this.of(lineId, stops);
    const mine = s.at.get(engine);
    // Another of its trains came here first and is still here: it goes first.
    const behind = [...s.at].some(([e, a]) => e !== engine && a.index === index && live.includes(e) && (!mine || a.tick < mine.tick || (a.tick === mine.tick && e < engine)));
    if (!behind) {
      const last = s.lastDepart.get(index);
      if (!last || last.engine === engine || !live.includes(last.engine)) return false;
      const headway = s.lap > 0 ? s.lap / live.length : DEFAULT_HEADWAY_S / SIM_DT;
      if (now - last.tick >= headway) return false;
    }
    if (!held) this.holdFrom.set(engine, { tick: now, lever });
    return now - (held?.tick ?? now) < MAX_HOLD_S / SIM_DT;
  }
  /** Has engine `engine` a hold begun at its stop (this visit)? */
  holding(engine: number): boolean {
    return this.holdFrom.has(engine);
  }

  /** The lap estimate (seconds) of a line, or 0 if none yet (for tests and the readout). */
  lapSeconds(lineId: number): number {
    return (this.lines.get(lineId)?.lap ?? 0) * SIM_DT;
  }

  /** Forget lines and engines no longer running. */
  prune(lines: ReadonlySet<number>, engines: ReadonlySet<number>): void {
    for (const id of this.lines.keys()) if (!lines.has(id)) this.lines.delete(id);
    for (const s of this.lines.values()) for (const id of s.at.keys()) if (!engines.has(id)) s.at.delete(id);
    for (const id of this.holdFrom.keys()) if (!engines.has(id)) this.holdFrom.delete(id);
  }
}
