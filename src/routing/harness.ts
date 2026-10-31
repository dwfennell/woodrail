/**
 * The routing harness (docs/superpowers/specs/2026-10-30-train-routing.md §12): a scripted layout, its trains and their
 * routes, run on a `Sim`, `Sections` and a `Router` with no `Economy` and no render, with the routing invariants checked
 * every tick. Test-only: nothing in the game imports it.
 *
 * What stands in for the economy (harness-only, named here so it's never mistaken for the game):
 * - **Routes:** a list of stop pieces per engine. A train comes to a stop when any axle is on its piece and is on past it
 *   when none is (as `Economy.advanceRoutes`, without spacing). There are no depots, so nothing dwells: a train runs
 *   through its stops, and turns back only where the track ends.
 * - **Lines:** trains given the same `line` share one (sections manage a line of two or more, as in the game).
 * - **Speed cap:** sections' only (no depot or kit stops).
 * - **A save round-trip:** a new `Sim` on the same layout with each train put back where it stood (new car ids, as a load
 *   gives), and new `Sections` and `Router` with the lines' places restored (`savedPlace`/`restorePlace`), as
 *   `deserializeWorld` does.
 */
import { Sim, SIM_HZ, type CarKind, type Cursor, type Train } from "../sim";
import { getPieceDef, type Layout } from "../track";
import { Sections } from "../economy/sections";
import { Stalls, type Stuck } from "../economy/stalls";
import { Router } from "./router";
import { next, waysFrom } from "./graph";
import { planChoice, ROUTE_COSTS } from "./plan";

/** A train in a scenario. No `stops`: hand-run (its lever on, no route). */
export interface TrainSpec {
  pieceId: number;
  /** Facing back along the piece's path. */
  reversed?: boolean;
  s?: number;
  cars?: CarKind[];
  /** Its route: stop pieces, in order. */
  stops?: number[];
  /** The stop it heads for first (an index into `stops`). */
  next?: number;
  /** Trains with the same line number share a line; a routed train with none runs a line of its own. */
  line?: number;
  lever?: -1 | 0 | 1;
  /** Left out if it doesn't fit there (the fuzz's trains). */
  optional?: boolean;
}

/** Something the player does at a time (seconds), or the first tick `when` holds: a lever tap, a pin, a save, a piece taken up. */
export interface ScriptedEvent {
  at?: number;
  when?: (run: HarnessRun) => boolean;
  do: (run: HarnessRun) => void;
}

export interface Scenario {
  name: string;
  /** Lay the track (switches set as the player left them) and say where the trains go. */
  build(layout: Layout): { trains: TrainSpec[]; events?: ScriptedEvent[]; watch?: number[] };
  /** How long it runs (game seconds). */
  seconds: number;
  /** The longest a lever-on train may stand still (seconds) before it counts as stuck (default 60, §12). */
  maxStill?: number;
  /**
   * Harness-only: each line works its single track alone (`Sections.shared` off), so the router's own wait at points is
   * what's tested. In the game, sections hold such a train at its slot's end first (single-line working across lines).
   */
  ownLines?: boolean;
}

/** The invariants checked every tick (§12). */
export const INVARIANTS = ["wrongRoad", "split", "underTrain", "pinned", "restore", "deadlock", "lockRun"] as const;
export type Invariant = (typeof INVARIANTS)[number];

/** Turn-backs by cause (`Train.lastTurn`). */
export type Turns = { buffer: number; "open-end": number };

export interface Report {
  name: string;
  /** Per invariant: how many times it broke, and the first few, in words. */
  broke: Record<Invariant, { count: number; first: string[] }>;
  /** Per train: how long (ticks) it stood with its lever on, held by sections (`Sections.waitOf`). */
  held: number[];
  /** Per train (in `trains` order): stops come to, turn-backs, the longest stand-still (s). */
  arrivals: number[];
  /** Of those, the ones made with the engine not leading (pushing its cars). */
  pushed: number[];
  turns: Turns[];
  /**
   * Per train: how long (ticks) it stood waiting at points (`Router.waitOf`, §3.3), and the nearest and farthest its nose
   * stood from them (mm; Infinity / −Infinity: it never stood waiting).
   */
  waited: number[];
  stoodFrom: { near: number; far: number }[];
  /** Waits at points begun (`Router.waitsBegun`). */
  waits: number;
  /**
   * Stalls (economy/stalls.ts): waits that can't end, now that nothing turns a train back short of the end of the track
   * (§16 Q3). `begun`: stalls begun; `stuck`: per train, ticks it stood said to be stuck, and why it last was.
   */
  stalls: { begun: number; stuck: number[]; why: (Stuck["kind"] | null)[] };
  longestStill: number[];
  /** Times a train's front came onto a piece through facing points with a choice, and the switch throws seen. */
  facing: number;
  throws: number;
  /** Ticks any axle stood on the scenario's watched pieces (`watch`: track no train should go onto). */
  onWatched: number;
  /** Sections' safety-net releases (`Sections.released`): the "30 s net", 0 when all is well. */
  net: number;
  ticks: number;
  ms: number;
  /** The router's time (`Router.tick`), mean µs a tick. */
  routerUs: number;
  /** Its looks ahead (a routed train asking for its points: every 8 ticks), and their mean µs (locks included). */
  looks: number;
  lookUs: number;
  /** Routed trains' fronts coming onto a new piece, and the router's time per one (µs: its whole cost, spread over them). */
  pieces: number;
  pieceUs: number;
  /** Locks granted, asks refused (all or none), and points put back to their default (step 4). */
  locks: number;
  refused: number;
  restored: number;
  /**
   * A lever tap on points locked for a train (§16 Q1, as changed at step 5): true once one has been made that left them
   * set for it (the tap their new default, for once it has passed: the restore check sees them go to it).
   */
  tapKept: boolean;
  /**
   * A hash of every train's place and speed once a second (for "identical to a recorded trajectory"). Not the switches:
   * restoring them after a train has gone (step 4) doesn't change where it runs.
   */
  trajectory: string;
}

/** The first few breaks of an invariant are kept in words (the rest only counted). */
const KEEP = 4;
/** A switch nobody holds or stands on this long is at its default (§12). */
const RESTORE_TICKS = SIM_HZ;

interface RouteState {
  stops: number[];
  next: number;
  at: boolean;
}

/** FNV-1a, as the trajectory recorder hashes (scripts/trajectory/record.ts). */
function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A train's net drive toward its front (as `Economy.drive`). */
function drive(train: Train): number {
  let net = 0;
  for (const car of train.cars) if (car.kind === "engine") net += car.lever * car.facing;
  return net;
}

/** A running scenario: the world, the stand-ins for the economy, and the invariants' state. */
export class HarnessRun {
  sim: Sim;
  sections!: Sections;
  router!: Router;
  stalls!: Stalls;
  /** Engine car ids by train (in `trains` order); they change on a save round-trip, as a load's do. */
  readonly engines: number[] = [];
  /** Routes by engine (in the order they were set: the router steers in this order, as the economy's routes). */
  routes = new Map<number, RouteState>();
  lineOf = new Map<number, number>();
  tick = 0;

  private readonly report: Report;
  private readonly specs: TrainSpec[];
  private readonly maxStill: number;
  private readonly events: ScriptedEvent[];
  private polled: ScriptedEvent[];
  private readonly watch: ReadonlySet<number>;
  private switches: number[] = [];
  private readonly pinnedAt = new Map<number, number>();
  private readonly freeSince = new Map<number, number>();
  private readonly restoreBroken = new Set<number>();
  private readonly still: number[];
  private readonly front: { train: number; sign: number; pieceId: number }[];
  private readonly lastTurn: number[];
  private readonly lockFront: number[];
  private traj = 0x811c9dc5;
  private readonly ownLines: boolean;
  private routerMs = 0;

  constructor(
    readonly layout: Layout,
    scenario: Scenario,
  ) {
    const built = scenario.build(layout);
    this.sim = new Sim(layout);
    const placed = built.trains.map((t) => {
      const r = this.sim.addTrain(t.cars ?? ["engine", "timber", "timber"], { pieceId: t.pieceId, pathIndex: 0, reversed: !!t.reversed, s: t.s ?? 100 });
      if (r.kind === "placed") return r.trainId;
      if (!t.optional) throw new Error(`${scenario.name}: no room for a train on piece ${t.pieceId}`);
      return -1;
    });
    this.specs = built.trains.filter((_, k) => placed[k] !== -1);
    for (const id of placed) {
      if (id === -1) continue;
      const k = this.engines.length;
      // (Its engine: at the front, or where the player coupled it, `pushingShuttle`'s at the back.)
      const engine = this.sim.getTrain(id)!.cars.find((c) => c.kind === "engine")!.id;
      this.sim.setLever(engine, this.specs[k].lever ?? 1);
      this.engines.push(engine);
    }
    this.events = (built.events ?? []).filter((e) => !e.when).sort((a, b) => a.at! - b.at!);
    this.polled = (built.events ?? []).filter((e) => e.when);
    this.watch = new Set(built.watch ?? []);
    this.maxStill = scenario.maxStill ?? 60;
    this.ownLines = !!scenario.ownLines;
    const none = () => ({ count: 0, first: [] as string[] });
    this.report = {
      name: scenario.name,
      broke: Object.fromEntries(INVARIANTS.map((k) => [k, none()])) as Report["broke"],
      arrivals: this.specs.map(() => 0),
      pushed: this.specs.map(() => 0),
      turns: this.specs.map(() => ({ buffer: 0, "open-end": 0 })),
      longestStill: this.specs.map(() => 0),
      facing: 0,
      throws: 0,
      onWatched: 0,
      net: 0,
      ticks: 0,
      ms: 0,
      routerUs: 0,
      looks: 0,
      lookUs: 0,
      pieces: 0,
      pieceUs: 0,
      locks: 0,
      refused: 0,
      restored: 0,
      tapKept: false,
      trajectory: "",
      waited: this.specs.map(() => 0),
      held: this.specs.map(() => 0),
      stoodFrom: this.specs.map(() => ({ near: Infinity, far: -Infinity })),
      waits: 0,
      stalls: { begun: 0, stuck: this.specs.map(() => 0), why: this.specs.map(() => null) },
    };
    this.still = this.specs.map(() => 0);
    this.front = this.specs.map(() => ({ train: -1, sign: 0, pieceId: -1 }));
    this.lastTurn = this.specs.map(() => -1);
    this.lockFront = this.specs.map(() => -1);
    this.specs.forEach((t, k) => {
      if (!t.stops) return;
      this.routes.set(this.engines[k], { stops: t.stops, next: t.next ?? 0, at: false });
      this.lineOf.set(this.engines[k], t.line ?? 1000 + k);
    });
    this.wire();
    // (Points as laid are the defaults, as the game's track edit tells the router: `Economy.prune`.)
    this.router.laid();
    this.switchesChanged();
    this.spy();
  }

  /** Sections and the router on this sim, with the harness's routes and lines as their host (as the economy wires them). */
  private wire(): void {
    const { layout, sim } = this;
    this.sections = new Sections(layout, sim, {
      lineOf: (engine) => (this.routes.has(engine) ? (this.lineOf.get(engine) ?? -1) : -1),
      live: (lineId) => {
        const live: number[] = [];
        for (const [engine, id] of this.lineOf) {
          if (id !== lineId || !this.routes.has(engine)) continue;
          const found = this.sim.findCar(engine);
          if (found && !found.train.derailed) live.push(engine);
        }
        return live;
      },
      target: (engine) => this.target(engine),
      stopPieces: (lineId) => {
        const engine = [...this.lineOf].find(([, id]) => id === lineId)?.[0];
        const stops = engine === undefined ? [] : (this.routes.get(engine)?.stops ?? []);
        const out: number[] = [];
        for (const p of stops) if (this.layout.getPiece(p) && out[out.length - 1] !== p) out.push(p);
        if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
        return out;
      },
      drive,
      skipStops: (engine, pieces) => {
        const r = this.routes.get(engine);
        if (!r || r.stops.length === 0 || r.at) return;
        let i = r.next % r.stops.length;
        for (let k = 0; k < r.stops.length; k++) {
          if (!pieces.has(r.stops[i])) {
            r.next = i;
            return;
          }
          i = (i + 1) % r.stops.length;
        }
      },
      restsAt: (pieceId) => this.router.defaultOf(pieceId),
    });
    this.sections.shared = !this.ownLines;
    // (Sections' cap, and the router's: short of points it waits for, §3.3.)
    sim.speedCap = (train) => Math.min(this.sections.cap(train), this.router.speedCap(train));
    sim.waitsAt = (train) => this.router.waitsAt(train);
    this.router = new Router({
      layout,
      sim,
      routed: this.routes,
      goal: (engine) => {
        const r = this.routes.get(engine)!;
        const p = r.stops[r.next % r.stops.length];
        return this.layout.getPiece(p) ? p : -1;
      },
      drive,
      granted: (engine) => this.sections.steerHint(engine),
      awaitingGrant: (engine) => this.sections.awaitingGrant(engine),
      soon: this.sections.steerSoon,
    });
    this.router.timing = true;
    this.stalls = new Stalls(sim, this.sections, {
      lineOf: (engine) => (this.routes.has(engine) ? (this.lineOf.get(engine) ?? -1) : -1),
      routeWait: (engine) => this.router.waitingOn(engine),
    });
  }

  /** The player's switch positions (the default each is restored to): as laid, then each lever tap's (the router's). */
  defaultOf(pieceId: number): number {
    return this.router.defaultOf(pieceId);
  }

  /** Where a routed engine is going: its next stop, or (standing at it) the next different one; −1: none on the map. */
  target(engine: number): number {
    const r = this.routes.get(engine);
    if (!r || r.stops.length === 0) return -1;
    let i = r.next % r.stops.length;
    if (r.at) {
      const here = r.stops[i];
      for (let k = 0; k < r.stops.length && r.stops[i] === here; k++) i = (i + 1) % r.stops.length;
    }
    return this.layout.getPiece(r.stops[i]) ? r.stops[i] : -1;
  }

  /** Every switch throw is watched: never under a train, never a pinned one (§12). */
  private spy(): void {
    const layout = this.layout;
    const set = layout.setSwitchState.bind(layout);
    layout.setSwitchState = (pieceId: number, state: number) => {
      if (state !== layout.switchState(pieceId)) {
        this.report.throws++;
        if (this.sim.pointsHeld(pieceId)) this.broke("underTrain", `points ${pieceId} thrown to ${state} under a train`);
        if (layout.isPinned(pieceId)) this.broke("pinned", `pinned points ${pieceId} thrown to ${state}`);
      }
      set(pieceId, state);
    };
  }

  private broke(k: Invariant, what: string): void {
    const b = this.report.broke[k];
    if (b.count++ < KEEP) b.first.push(`${(this.tick / SIM_HZ).toFixed(1)} s: ${what}`);
  }

  /** The points on the map (worked out again when track is taken up). */
  private switchesChanged(): void {
    this.switches = [];
    for (const id of this.layout.pieceIds()) {
      const p = this.layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      if (def.isSwitch && !def.gated && !def.signal) this.switches.push(id);
    }
  }

  // ── What the player does ──────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A lever tap on points (through the router, as `throwLever`): thrown, or (locked for a train) left set for it; either
   * way the tap is the player's new default (the router's). False: refused (a car on them).
   */
  lever(pieceId: number, corner = 0): boolean {
    const was = this.layout.switchState(pieceId);
    const r = this.router.lever(pieceId, corner);
    if ("deferred" in r && this.layout.switchState(pieceId) === was && this.engines.includes(r.by)) this.report.tapKept = true;
    return !("refused" in r);
  }

  /** Train `k` put away (the card's Put away): off the track and its line. */
  putAway(k: number): void {
    const engine = this.engines[k];
    const t = engine === undefined ? undefined : this.sim.findCar(engine)?.train;
    if (!t) return;
    this.sim.removeTrain(t.id);
    this.routes.delete(engine);
    this.lineOf.delete(engine);
    // (As the game's Put away: `economy.prune()`.)
    this.sections.prune(new Set(this.lineOf.keys()));
  }

  pin(pieceId: number, on: boolean): void {
    this.layout.setPinned(pieceId, on);
    if (on) this.pinnedAt.set(pieceId, this.layout.switchState(pieceId));
    else this.pinnedAt.delete(pieceId);
  }

  /** A piece taken up (a train on it comes off the rails, as in the editor). */
  takeUp(pieceId: number): void {
    this.layout.removePiece(pieceId);
    this.sim.trackChanged();
    this.pinnedAt.delete(pieceId);
    this.switchesChanged();
  }

  /** Saved and loaded: every train put back where it stood on a new sim (new car ids), routing and sections afresh. */
  saveAndLoad(): void {
    const old = this.sim;
    // (The points' defaults go through the save as the game's do: only those that differ from how the points lie.)
    const defaults = this.router.save();
    const saved = this.engines.map((engine) => {
      const t = old.findCar(engine)?.train;
      return t && !t.derailed ? { kinds: t.cars.map((c) => c.kind), lead: { ...t.bogies[0] }, facing: t.cars.map((c) => c.facing), levers: t.cars.map((c) => c.lever), speed: t.speed, place: this.sections.savedPlace(engine) } : null;
    });
    this.sim = new Sim(this.layout);
    const routes = new Map<number, RouteState>();
    const lines = new Map<number, number>();
    const renamed = new Map<number, number>();
    saved.forEach((s, k) => {
      if (!s) return;
      const placed = this.sim.addTrain(s.kinds, s.lead);
      if (placed.kind !== "placed") throw new Error("a saved train didn't fit back");
      const t = this.sim.getTrain(placed.trainId)!;
      if (t.bogies[0].pieceId === s.lead.pieceId && Math.abs(t.bogies[0].s - s.lead.s) < 1e-6) t.speed = s.speed;
      t.cars.forEach((car, i) => {
        if (s.facing[i] === -1) this.sim.flipCar(car.id);
        if (car.kind === "engine") this.sim.setLever(car.id, s.levers[i]);
      });
      const engine = t.cars[0].id;
      renamed.set(this.engines[k], engine);
      this.engines[k] = engine;
      this.front[k].train = -1;
      this.lastTurn[k] = -1;
    });
    for (const [engine, r] of this.routes) if (renamed.has(engine)) routes.set(renamed.get(engine)!, r);
    for (const [engine, id] of this.lineOf) if (renamed.has(engine)) lines.set(renamed.get(engine)!, id);
    this.routes = routes;
    this.lineOf = lines;
    this.report.stalls.begun += this.stalls.begun;
    this.wire();
    this.router.restore(defaults);
    saved.forEach((s, k) => {
      const line = lines.get(this.engines[k]);
      if (s && line !== undefined) this.sections.restorePlace(this.engines[k], line, s.place);
    });
    this.sections.restored();
  }

  // ── The run ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Run the scenario to its end (or `seconds`), checking every tick. */
  run(seconds: number): Report {
    const t0 = performance.now();
    const end = this.tick + Math.round(seconds * SIM_HZ);
    let e = 0;
    while (this.tick < end) {
      while (e < this.events.length && this.events[e].at! * SIM_HZ <= this.tick) this.events[e++].do(this);
      if (this.polled.length > 0) {
        const due = this.polled.filter((p) => p.when!(this));
        if (due.length > 0) this.polled = this.polled.filter((p) => !due.includes(p));
        for (const p of due) p.do(this);
      }
      this.step();
    }
    this.report.ms += performance.now() - t0;
    this.report.ticks = this.tick;
    this.report.routerUs = (this.routerMs * 1000) / Math.max(1, this.tick);
    // (Counted on the router of this run; a save round-trip starts a new one, so these are since the last load.)
    const r = this.router;
    this.report.looks = r.looks;
    this.report.lookUs = (r.ms * 1000) / Math.max(1, r.looks);
    this.report.pieceUs = (this.routerMs * 1000) / Math.max(1, this.report.pieces);
    this.report.locks = r.granted;
    this.report.refused = r.refused;
    this.report.restored = r.restored;
    this.report.waits = r.waitsBegun;
    this.report.stalls.begun += this.stalls.begun;
    this.stalls.begun = 0;
    this.report.trajectory = this.traj.toString(16).padStart(8, "0");
    return this.report;
  }

  /** One tick, in the economy's order (the sim, routes come to and left, the router), then the checks. */
  step(): void {
    this.sim.tick();
    this.advanceRoutes();
    const t0 = performance.now();
    this.router.tick();
    this.routerMs += performance.now() - t0;
    this.stalls.tick();
    this.tick++;
    this.check();
    if (this.tick % SIM_HZ === 0) this.record();
  }

  /** As `Economy.advanceRoutes`: on a stop's piece, it's come to it; off it again, on to the next stop. */
  private advanceRoutes(): void {
    this.engines.forEach((engine, k) => {
      const r = this.routes.get(engine);
      const found = this.sim.findCar(engine);
      if (!r || !found) return;
      const stop = r.stops[r.next % r.stops.length];
      if (!this.layout.getPiece(stop)) {
        r.next = (r.next + 1) % r.stops.length;
        r.at = false;
        return;
      }
      const on = found.train.bogies.some((b) => b.pieceId === stop);
      if (on) {
        if (!r.at) {
          this.report.arrivals[k]++;
          const t = found.train;
          const net = drive(t);
          if (net !== 0 && found.index !== (net > 0 ? 0 : t.cars.length - 1)) this.report.pushed[k]++;
        }
        r.at = true;
      } else if (r.at) {
        r.at = false;
        for (let n = 0; n < r.stops.length; n++) {
          r.next = (r.next + 1) % r.stops.length;
          if (r.stops[r.next] !== stop) break;
        }
      }
    });
  }

  private check(): void {
    const { sim, layout } = this;
    this.engines.forEach((engine, k) => {
      const found = sim.findCar(engine);
      if (!found) return;
      const t = found.train;
      if (t.derailed) return;
      if (t.lastTurn && t.lastTurn.tick !== this.lastTurn[k]) {
        this.lastTurn[k] = t.lastTurn.tick;
        this.report.turns[k][t.lastTurn.cause]++;
      }
      this.checkSplit(t, k);
      // (Step 7: a train never runs onto points locked for others only: a routed train's road, or a hand-run train's
      // way as they lie, that another may not share. On them already when they were locked, it's let be: none is
      // granted with a car on them that must move, and one coming the same way shares.)
      this.checkLockRun(t, k, engine);
      if (this.watch.size > 0 && t.bogies.some((b) => this.watch.has(b.pieceId))) this.report.onWatched++;
      const net = drive(t);
      if (this.routes.has(engine)) this.checkRoad(t, k, engine, net);
      // Stuck: a lever-on train standing (not one sections hold for want of room, nor one stood at a red switch pinned
      // against its way: those are the player's to fix, and its card says so).
      // A stall (stalls.ts) is said on its card, so it counts apart (`stalls`), not as stuck unexplained.
      const stuck = this.stalls.stuckOf(engine);
      if (stuck) {
        this.report.stalls.stuck[k]++;
        this.report.stalls.why[k] = stuck.kind;
      }
      if (net !== 0 && t.speed === 0 && !stuck && !this.sections.heldForRoom(engine) && this.router.waitOf(engine)?.kind !== "pinned") {
        const s = ++this.still[k];
        if (s > this.report.longestStill[k]) this.report.longestStill[k] = s;
        if (s === Math.round(this.maxStill * SIM_HZ)) this.broke("deadlock", `train ${k} still for ${this.maxStill} s on piece ${t.bogies[0].pieceId}`);
      } else this.still[k] = 0;
      const wait = this.sections.waitOf(engine);
      if (wait && t.speed === 0 && net !== 0) this.report.held[k]++;
      if (wait && "engine" in wait && !sim.findCar(wait.engine)) this.broke("deadlock", `train ${k} waits (${wait.kind}) for a train that isn't there`);
      const rw = this.router.waitOf(engine);
      if (rw?.kind === "points" && t.speed === 0 && net !== 0) {
        this.report.waited[k]++;
        const gap = this.router.gapTo(t);
        const f = this.report.stoodFrom[k];
        if (gap !== Infinity) {
          f.near = Math.min(f.near, gap);
          f.far = Math.max(f.far, gap);
        }
      }
      if (rw?.kind === "points" && !sim.findCar(rw.by)) this.broke("deadlock", `train ${k} waits at points ${rw.pieceId} for a train that isn't there`);
    });
    if (this.sections.released > this.report.net) {
      this.report.net = this.sections.released;
      this.broke("deadlock", `sections' safety net let a wait go (${this.sections.released})`);
    }
    for (const [id, state] of this.pinnedAt) if (layout.switchState(id) !== state) this.broke("pinned", `pinned points ${id} moved to ${layout.switchState(id)}`);
    this.checkRestore();
  }

  /**
   * Restore: a switch nobody holds or stands on for `RESTORE_TICKS` is at its default. Held: a car on or over it
   * (`pointsHeld`), or a route lock (a train it's set for).
   */
  private checkRestore(): void {
    for (const id of this.switches) {
      if (this.sim.pointsHeld(id) || this.router.locked(id)) {
        this.freeSince.delete(id);
        continue;
      }
      const state = this.layout.switchState(id);
      if (state === this.router.defaultOf(id)) {
        this.freeSince.delete(id);
        this.restoreBroken.delete(id);
        continue;
      }
      const since = this.freeSince.get(id);
      if (since === undefined) this.freeSince.set(id, this.tick);
      else if (this.tick - since >= RESTORE_TICKS && !this.restoreBroken.has(id)) {
        this.restoreBroken.add(id);
        this.broke("restore", `points ${id} left at ${state} (default ${this.router.defaultOf(id)}), no train on them`);
      }
    }
  }

  /**
   * No wrong road: when a routed train's front comes onto facing points with a choice, the way it takes is its way to
   * its stop: the way sections granted it (`steerHint`'s follow), else one whose plan costs no more than the best (the
   * plan search, as the router chooses).
   */
  private checkRoad(t: Train, k: number, engine: number, net: number): void {
    const f = this.front[k];
    const sign = Math.sign(net);
    if (sign === 0) return;
    const b = sign > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1];
    // (A turned train, or one just set going the other way: its front is somewhere else; start afresh.)
    if (f.train !== t.id || f.sign !== sign) {
      Object.assign(f, { train: t.id, sign, pieceId: b.pieceId });
      return;
    }
    if (b.pieceId === f.pieceId) return;
    f.pieceId = b.pieceId;
    this.report.pieces++;
    const piece = this.layout.getPiece(b.pieceId);
    if (!piece) return;
    const path = getPieceDef(piece.type, piece.flipped).paths[b.pathIndex];
    // (The end it came in by: behind it, the way it's going.)
    const back = sign > 0 ? b.reversed : !b.reversed;
    const entry = back ? path.to : path.from;
    if (entry === null || entry === undefined) return;
    const ways = waysFrom(this.layout, b.pieceId, entry);
    const target = this.target(engine);
    if (ways.length < 2 || target === -1 || b.pieceId === target) return;
    this.report.facing++;
    const taken = ways.find((w) => w.path === b.pathIndex);
    if (!taken) return;
    const held = this.sections.steerHint(engine);
    const followed = held ? ways.filter((w) => held.follow(b.pieceId, w.path)) : [];
    let wrong: boolean;
    if (followed.length === 1) wrong = followed[0].option !== taken.option;
    else {
      const costs: number[] = [];
      const best = planChoice(this.layout, b.pieceId, true, ways, held?.aim ?? target, ROUTE_COSTS, costs);
      if (best === -1 || best === taken.option) return;
      wrong = !(costs[taken.option] <= costs[best]);
    }
    if (wrong) this.broke("wrongRoad", `train ${k} took road ${taken.option} at points ${b.pieceId} (${followed.length === 1 ? "not the way granted" : `not its way to ${target}`})`);
  }

  /** Train `k`'s front came onto points locked for other trains only (once per points, while it's on them). */
  private checkLockRun(t: Train, k: number, engine: number): void {
    const net = drive(t);
    if (net === 0) return;
    const b = net > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1];
    const was = this.lockFront[k];
    if (b.pieceId === was) return;
    this.lockFront[k] = b.pieceId;
    const holders = this.router.holdersOf(b.pieceId);
    if (holders.size === 0 || holders.has(engine)) return;
    // (The other end of the train on them already: it came onto them before they were locked.)
    if (t.bogies.some((x) => x !== b && x.pieceId === b.pieceId)) return;
    // (A crossover's other straight, a road that doesn't meet theirs: both may use them.)
    if (this.router.apartFrom(b.pieceId, engine)) return;
    this.broke("lockRun", `train ${k} ran onto points ${b.pieceId} locked for ${[...holders].join(",")}`);
  }

  /**
   * No split, by the bogies' pieces and paths (not by axle distance: loose joints open a few mm): each axle's place
   * joins the next one's along the track, behind it, with each on a path through the piece it's on.
   */
  private checkSplit(t: Train, k: number): void {
    for (let i = 0; i + 1 < t.bogies.length; i++) {
      if (!joinedBehind(this.layout, t.bogies[i], t.bogies[i + 1])) {
        this.broke("split", `train ${k} split between axles ${i} and ${i + 1} (pieces ${t.bogies[i].pieceId}/${t.bogies[i].pathIndex}, ${t.bogies[i + 1].pieceId}/${t.bogies[i + 1].pathIndex})`);
        return;
      }
    }
  }

  private record(): void {
    let s = "";
    for (const id of this.sim.trainIds()) {
      const t = this.sim.getTrain(id)!;
      s += `T:${t.speed}:${t.derailed ? 1 : 0}`;
      for (const b of t.bogies) s += `|${b.pieceId},${b.pathIndex},${b.reversed ? 1 : 0},${b.s}`;
    }
    this.traj = fnv(s, this.traj);
  }
}

/** How far (pieces) behind an axle the next one may be. */
const SPLIT_DEPTH = 6;

/** Is axle `b` on track that joins axle `a`'s, behind it (each pointing toward the train's front), within a few pieces? */
function joinedBehind(layout: Layout, a: Cursor, b: Cursor): boolean {
  if (a.pieceId === b.pieceId) return a.pathIndex === b.pathIndex && a.reversed === b.reversed;
  const pa = layout.getPiece(a.pieceId);
  const pb = layout.getPiece(b.pieceId);
  if (!pa || !pb) return false;
  const pathA = getPieceDef(pa.type, pa.flipped).paths[a.pathIndex];
  const pathB = getPieceDef(pb.type, pb.flipped).paths[b.pathIndex];
  // (b's front end: where it points; it must be where the way from a comes in.)
  const bFront = b.reversed ? pathB.from : pathB.to;
  const search = (pieceId: number, exit: number | null, depth: number): boolean => {
    if (exit === null || exit < 0) return false;
    const n = next(layout, pieceId, exit);
    if (!n) return false;
    if (n.pieceId === b.pieceId) return n.entry === bFront;
    if (depth >= SPLIT_DEPTH) return false;
    const p = layout.getPiece(n.pieceId)!;
    return getPieceDef(p.type, p.flipped).paths.some((q) => (q.from === n.entry ? search(n.pieceId, q.to, depth + 1) : q.to === n.entry && search(n.pieceId, q.from, depth + 1)));
  };
  return search(a.pieceId, a.reversed ? pathA.to : pathA.from, 1);
}

/** Run a scenario on a new layout from start to end. */
export function runScenario(layout: Layout, scenario: Scenario): Report {
  return new HarnessRun(layout, scenario).run(scenario.seconds);
}
