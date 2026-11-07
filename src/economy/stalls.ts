import { loopSignalHold } from "./loop-signal";
import { trainKey, type Sim, type Train } from "../sim";
import { CHECK_TICKS, type Sections } from "./sections";

/**
 * Stalls: trains stuck for good, said on their cards (routing spec §16 Q3). Nothing turns a train back short of the end
 * of the track, so a wait that can't end lasts till the player changes something, and the player must see why:
 *
 * - **A ring:** trains each waiting on the next, round to the first (two nose to nose on single track is the smallest).
 *   Its trains, and those waiting on one of them, are stuck "in the way" of each other: one must be moved or put away
 *   (unless they're two lines' trains with no passing loop where they meet: then laying one is the fix).
 * - **Too many trains:** a chain of waits ending at a train its line has no room for (sections' room rule holds it), the
 *   line over room: "too many" for the line.
 * - **Parked:** a chain of waits ending at a train standing with its lever off (the player's own): only moving it helps.
 *
 * A wait is who a standing train with its lever on waits for: sections' wait (a train of its line, or one in its way),
 * the router's (points held for another train), or the sim's (`Sim.heldBy`: short of a crossing or switch another is on,
 * close behind it, nose to nose or against its side), or a lineless train's short of one ahead (`Sections.clearWait`).
 * A chain that ends anywhere else (a train under way, one at a stop, a signal held by hand) isn't a stall: it ends on
 * its own, or is the player's. Unless it doesn't: a train that has stood waiting `STARVED_S`, on a train under way, is
 * stuck "in the way" of that one (kept waiting by trains that come and go). One through a red signal goes on to the train in its block (`heldBy` "signal").
 *
 * Giving way (2026-11-05, the user: "so easy to get into a deadlock ... everything stops even though it could easily
 * keep going"): a ring that has held `YIELD_S` (before it's said) is broken where the track ahead allows: a hand-run
 * train in it (lever on, no route: it "goes anywhere") takes another road, going forwards, where the facing points just
 * ahead of it can be thrown to one that's free and holds it (`Router.giveWayRoad`; the points go back to the player's
 * way once it's passed, or if it doesn't take them). It then runs on as the points lie, as ever. (The user's map,
 * 2026-11-05: a hand-run train back from the forest yard stood at the points, which lay for the branch the routed train
 * waited on, while the mill spur on their other road was free.)
 *
 * Nothing turns a train round to give way (the user, firm, 2026-11-07: "trains should not turn around except at the end
 * of lines"): not a hand-run one, not a routed one. A train reverses only where its line ends (a buffer, track that
 * just stops, a terminus stop, a line's planned reverse). A ring with no road out ahead is said stuck, each card naming
 * the train in its way and the fix (a passing loop, or moving one). No livelock: a train that took another road doesn't
 * again to the same train till that one has got somewhere (come to its next stop, or turned at the end of the line);
 * one whose road didn't take (its way on held all the same) stands, said stuck. A ring through signals is said stuck
 * (adding a signal is the fix), as is a parked train's (the player's).
 *
 * Cost: nothing per frame. Every `CHECK_TICKS`, with two or more trains, each standing train's chain is followed (each
 * waits on at most one, so O(trains)). A stall must hold `STUCK_S` before it's said, so ordinary meets never are. A ring
 * held `YIELD_S` tries its hand-run trains (a short walk ahead to points) at most every `YIELD_RETRY_S`.
 */

/** A wait that can't end must hold this long (s) before its trains are said to be stuck. */
export const STUCK_S = 5;
/**
 * A train standing waiting this long (s), though the train it waits for is under way, is said to be stuck too: kept
 * waiting by trains that come and go (one going round non-stop, taking what it waits for each time it comes by).
 */
export const STARVED_S = 120;
/** A ring of waits that has held this long (s) is broken by a train in it taking another road, where one can (above). */
export const YIELD_S = 2;
/** A ring nobody in could break is tried again this often (s): a train in it may have come off its cool-down. */
export const YIELD_RETRY_S = 2;

/** Why a train is stuck. */
export type Stuck =
  /**
   * In a ring of waits: `by` (an engine, or the first car of a train with none) is the train in its way. `loop`: it's
   * another line's (or a train on no line), and no passing loop is on its line's ways: laying one lets them pass
   * (single-line working across lines, sections.ts). Else (a loop there, or two trains of one line nose to nose)
   * moving one is what helps.
   */
  | { kind: "in-way"; by: number; loop: boolean }
  /** Its line has more trains than room, and the one held for it is in the way (`lineId`: that line). */
  | { kind: "too-many"; lineId: number }
  /** A train standing with its lever off (`by`) is in the way, of it or of the train it waits for. */
  | { kind: "parked"; by: number }
  /**
   * In a ring of waits through signals (signals spec §6): each stands at a red signal with a train in the block (or on
   * the way) beyond. Too many trains for the signals placed: adding a signal, or putting a train away, helps.
   */
  | { kind: "signals"; by: number }
  /**
   * In a ring of waits where a train (`by`) stands at a signal inside a passing loop's road, its tail over the loop's
   * points (`loopSignalHold`, issue #31): no train gets into the loop past it. Moving that signal (`mark`) to the loop
   * road's end is the fix.
   */
  | { kind: "loop-signal"; by: number; mark: number };

/** What stalls read of the economy (or the harness). */
export interface StallsHost {
  /** The line an engine runs (−1: none). */
  lineOf(engine: number): number;
  /** The train (an engine) a routed engine waits for short of points (`Router.waitingOn`); null: none. */
  routeWait(engine: number): { engine: number } | null;
  /** Is this engine run by a route (else, its lever on, it's hand-run: it goes anywhere)? Absent: nobody gives way. */
  routed?(engine: number): boolean;
  /** The piece a routed engine heads for next (its stop, or the via point it's aimed at); −1: none on the map. */
  goal?(engine: number): number;
  /**
   * A hand-run train (its id) giving way by another road: the facing points just ahead thrown to a free road clear of
   * `by`'s train (`Router.giveWayRoad`). True if thrown.
   */
  otherRoad?(trainId: number, by: number): boolean;
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
  /** Standing trains with a wait, by train id: since when (tick) they have stood waiting, whoever on. */
  private readonly waiting = new Map<number, number>();
  /** Stalls begun (each a set of trains newly stuck at one check), for tests and the play-through. */
  begun = 0;
  /** Trains that gave way (took another road ahead to break a ring), for tests and the play-through. */
  gaveWay = 0;
  /**
   * Whom each train last gave way to, by `trainKey`: that train's key, and its goal and last end-of-line turn then (it
   * has got somewhere once either has changed).
   */
  private readonly gaveTo = new Map<number, { by: number; goal: number; turn: number }>();
  /** Rings nobody in could break, by their trains (sorted ids, joined): when last tried (tick). */
  private readonly tried = new Map<string, number>();
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
    const why = this.stuck.get(engine) ?? null;
    // (The train in its way taken off the track since the last look (lifted into the hand, say): not stuck behind it.)
    return why && "by" in why && !this.sim.findCar(why.by) ? null : why;
  }

  /**
   * Trains taken off the track (put away, say) dropped at once, not at the next look: theirs, and any naming them as in
   * the way (that wait is over; the train asks again). As `Sections.prune`, called by `Economy.prune`.
   */
  prune(): void {
    const gone = (e: number, why: Stuck) => !this.sim.findCar(e) || ("by" in why && !this.sim.findCar(why.by));
    if (this.stuck.size > 0) {
      let changed = false;
      const stuck = new Map(this.stuck);
      for (const [e, why] of stuck)
        if (gone(e, why)) {
          stuck.delete(e);
          changed = true;
        }
      if (changed) this.stuck = stuck;
    }
    for (const [e, s] of this.since) if (gone(e, s.why)) this.since.delete(e);
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
      // (Waiting at the end of the line to turn round counts only when another train leaves it no room: `heldHow` "turn".)
      if (t.derailed || t.speed >= 1 || (t.turnback >= 0 && sim.heldHow(id) !== "turn") || drive(t) === 0) continue;
      standing.add(id);
      const by = this.waitOf(t);
      if (by !== null && by !== id) on.set(id, by);
    }
    const now = sim.ticks;
    for (const id of this.waiting.keys()) if (!on.has(id)) this.waiting.delete(id);
    for (const id of on.keys()) if (!this.waiting.has(id)) this.waiting.set(id, now);
    const found = new Map<number, Stuck>();
    /** Rings of waits (signals' aside), by their trains (sorted ids, joined): their trains, in order of waiting. */
    const rings = new Map<string, number[]>();
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
          const ring = chain.slice(chain.indexOf(y));
          const key = [...ring].sort((a, b) => a - b).join(",");
          if (!rings.has(key)) rings.set(key, ring);
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
      if (why === null) {
        // (Kept waiting `STARVED_S` on a train under way: stuck in its way all the same.)
        const by = sim.getTrain(on.get(start)!);
        const t = sim.getTrain(start)!;
        const engine = this.lineEngine(t);
        if (by && engine >= 0 && now - (this.waiting.get(start) ?? now) >= STARVED_S * 120) found.set(engine, { kind: "in-way", by: nameOf(by), loop: this.loopFixes(engine, by) });
        continue;
      }
      // (A ring with a train at a signal inside a passing loop, its tail over the points: that signal, to move. Else a
      // ring with a red signal in it: too many trains for the signals.)
      const inLoop = why === "ring" ? this.loopSignalIn(chain) : null;
      const signals = why === "ring" && chain.some((id) => sim.heldHow(id) === "signal");
      for (const id of chain) {
        const t = sim.getTrain(id)!;
        // (The held train itself is waiting by rule: its card already says the line is full.)
        if (!on.has(id)) continue;
        const by = sim.getTrain(on.get(id)!);
        const engine = this.lineEngine(t);
        if (engine < 0 || !by) continue;
        found.set(engine, inLoop ? { kind: "loop-signal", ...inLoop } : signals ? { kind: "signals", by: nameOf(by) } : why === "ring" ? { kind: "in-way", by: nameOf(by), loop: this.loopFixes(engine, by) } : why === "parked" ? { kind: "parked", by: nameOf(parked!) } : { kind: "too-many", lineId: why });
      }
    }
    // (Rings that have held `YIELD_S`: one of their trains gives way, where one can. Its ring's trains aren't stuck.)
    if (rings.size > 0) this.giveWay(rings, on, found, now);
    else if (this.tried.size > 0) this.tried.clear();
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

  /**
   * Each ring of waits (not through signals) that has held `YIELD_S`: a hand-run train in it takes another road at the
   * facing points just ahead, going forwards (`StallsHost.otherRoad`), unless it gave way to the same train already and
   * that one has got nowhere since. Never by turning round: a train reverses only where its line ends. Broken, its
   * trains are dropped from `found` (not stuck). Nobody able: tried again `YIELD_RETRY_S` on, and said stuck at `STUCK_S`.
   */
  private giveWay(rings: Map<string, number[]>, on: Map<number, number>, found: Map<number, Stuck>, now: number): void {
    const { sim, host } = this;
    if (!host.routed || !host.otherRoad) return;
    for (const k of this.tried.keys()) if (!rings.has(k)) this.tried.delete(k);
    if (this.gaveTo.size > 0) for (const [k, g] of this.gaveTo) if (!sim.trainByKey(k) || !sim.trainByKey(g.by)) this.gaveTo.delete(k);
    for (const [key, ring] of rings) {
      // (Held long enough: since its first train was found in it. Through a red signal: adding a signal is the fix.)
      let held = Infinity;
      let signals = false;
      for (const id of ring) {
        if (sim.heldHow(id) === "signal") signals = true;
        const t = sim.getTrain(id);
        const s = t && this.since.get(this.lineEngine(t));
        held = Math.min(held, s ? now - s.tick : 0);
      }
      if (signals || held < YIELD_S * 120) continue;
      const last = this.tried.get(key);
      if (last !== undefined && now - last < YIELD_RETRY_S * 120) continue;
      let gave: Train | null = null;
      for (const id of ring) {
        const t = sim.getTrain(id);
        if (!t) continue;
        const engine = this.lineEngine(t);
        // (Only a hand-run train: a routed one keeps to its way, waiting.)
        if (engine < 0 || host.routed(engine)) continue;
        const by = sim.getTrain(on.get(id)!);
        if (!by) continue;
        const byKey = trainKey(by);
        const progress = this.progressOf(by);
        const was = this.gaveTo.get(trainKey(t));
        // (Given way to it already, and it's got nowhere since: the road didn't let it go (its way on held all the same),
        // or it would only come back. It waits, said stuck.)
        if (was && was.by === byKey && was.goal === progress.goal && was.turn === progress.turn) continue;
        if (!host.otherRoad(id, by.id)) continue;
        gave = t;
        this.gaveTo.set(trainKey(t), { by: byKey, ...progress });
        break;
      }
      if (!gave) {
        this.tried.set(key, now);
        continue;
      }
      this.gaveWay++;
      this.tried.delete(key);
      for (const id of ring) {
        const t = sim.getTrain(id);
        const e = t ? this.lineEngine(t) : -1;
        if (e >= 0) found.delete(e);
      }
    }
  }

  /** A train of these standing at a signal inside a passing loop, its tail over the loop's points: it and the signal. */
  private loopSignalIn(ids: readonly number[]): { by: number; mark: number } | null {
    const { sim } = this;
    if (sim.layout.signalCount === 0) return null;
    for (const id of ids) {
      const key = sim.redSignalKeyAhead(id);
      // (A mark's key: −1 − its id. An old signal piece stands where it's laid, not at a joint inside a road.)
      if (key >= 0 || key === -1) continue;
      const hold = loopSignalHold(sim.layout, sim, -1 - key);
      if (hold && hold.trainId === id) return { by: nameOf(sim.getTrain(id)!), mark: -1 - key };
    }
    return null;
  }

  /** How far a train has got: its goal (a routed one's next stop or aim; −1: none) and its last end-of-line turn (tick). */
  private progressOf(t: Train): { goal: number; turn: number } {
    const e = this.lineEngine(t);
    const routed = e >= 0 && !!this.host.routed?.(e);
    return { goal: routed && this.host.goal ? this.host.goal(e) : -1, turn: t.lastTurn?.tick ?? -1 };
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

  /**
   * Would a passing loop let `engine`'s train and `by` pass? When they're two lines' trains (or one on no line), and
   * there's no passing loop on the line's ways for them to meet at: then laying one is the fix. (With a loop there and
   * still stuck, or two of one line's trains nose to nose, moving one is.)
   */
  private loopFixes(engine: number, by: Train): boolean {
    const mine = this.host.lineOf(engine);
    const theirs = this.lineEngine(by);
    const other = theirs >= 0 ? this.host.lineOf(theirs) : -1;
    if (mine >= 0 && mine === other) return false;
    const line = mine >= 0 ? mine : other;
    if (line < 0) return false;
    return this.sections.passingLoops(line) === 0;
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
