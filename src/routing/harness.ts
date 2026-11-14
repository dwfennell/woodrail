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
 * - **A save round-trip:** a new `Sim` on the same layout with each train put back where it stood (its car ids and the
 *   sim's id counters kept, as a v14 load does), and new `Sections` and `Router` with the lines' places restored
 *   (`savedPlace`/`restorePlace`), as `deserializeWorld` does.
 */
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { connectorRef, type Layout, type SignalMode, type SignalStyle } from "../track";
import { Sections } from "../economy/sections";
import { Stalls, type Stuck } from "../economy/stalls";
import { Router } from "./router";
import { aimOf, lapAims, passVias, ranOnto, resetVias, skipVias, viaDone, type ViaProgress } from "./via";
import { INVARIANTS, Invariants, type Invariant, type InvariantWorld } from "../sim/invariants";
import { driveOf } from "../sim/train-cars";

export { INVARIANTS, type Invariant };

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
  /** Via points (§3.5): per stop, the pieces passed on the way from it to the next. */
  vias?: number[][];
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
  /** Check heldFree too (the booking core in shadow beside the checks: `InvariantOptions.heldFree`). */
  heldFree?: boolean;
}

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
  /** Per train: whether it runs a route (has stops); a hand-run one comes to no stop, it shuttles end to end. */
  routed: boolean[];
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
  /** Trains that gave way to break a ring of waits (stalls.ts): hand-run ones taking another road ahead (none turn). */
  gaveWay: { any: number };
  longestStill: number[];
  /** Times a train's front came onto a piece through facing points with a choice, and the switch throws seen. */
  facing: number;
  throws: number;
  /** Ticks any axle stood on the scenario's watched pieces (`watch`: track no train should go onto). */
  onWatched: number;
  /** Sections' safety-net releases (`Sections.released`): the "30 s net", 0 when all is well. */
  net: number;
  /**
   * Signals (signals spec §10.1): fronts that crossed a red signal's joint having been past braking for it when it
   * turned red (not a break of `redRun`, but counted), and fronts that crossed a joint guarded by a signal at all.
   */
  redLate: number;
  signalPasses: number;
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

interface RouteState extends ViaProgress {
  stops: number[];
  next: number;
  at: boolean;
  vias?: number[][];
}

/** FNV-1a, as the trajectory recorder hashes (scripts/trajectory/record.ts). */
function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A train's net drive toward its front (as `Economy.drive`). */
const drive = driveOf;

/** A running scenario: the world, the stand-ins for the economy, and the invariants' state. */
export class HarnessRun implements InvariantWorld {
  sim: Sim;
  sections!: Sections;
  router!: Router;
  stalls!: Stalls;
  /** Engine car ids by train (in `trains` order); a save round-trip keeps them, as a load does (save v14). */
  readonly engines: number[] = [];
  /** Routes by engine (in the order they were set: the router steers in this order, as the economy's routes). */
  routes = new Map<number, RouteState>();
  lineOf = new Map<number, number>();
  tick = 0;
  /** The invariants (src/sim/invariants.ts), checked every tick: the same checks the game's dev builds run. */
  readonly checks: Invariants;

  private readonly report: Report;
  private readonly specs: TrainSpec[];
  private readonly maxStill: number;
  private readonly events: ScriptedEvent[];
  private polled: ScriptedEvent[];
  private readonly watch: ReadonlySet<number>;
  private readonly still: number[];
  private readonly lastTurn: number[];
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
    this.checks = new Invariants(this, {
      restore: true,
      maxStill: this.maxStill,
      trains: () => this.engines.map((engine, key) => ({ key, engine })),
      name: (k) => `train ${k}`,
      now: () => this.tick,
      heldFree: !!scenario.heldFree,
    });
    this.report = {
      name: scenario.name,
      broke: this.checks.broke,
      arrivals: this.specs.map(() => 0),
      routed: this.specs.map((t) => !!t.stops),
      pushed: this.specs.map(() => 0),
      turns: this.specs.map(() => ({ buffer: 0, "open-end": 0 })),
      longestStill: this.specs.map(() => 0),
      facing: 0,
      throws: 0,
      onWatched: 0,
      net: 0,
      redLate: 0,
      signalPasses: 0,
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
      gaveWay: { any: 0 },
    };
    this.still = this.specs.map(() => 0);
    this.lastTurn = this.specs.map(() => -1);
    this.specs.forEach((t, k) => {
      if (!t.stops) return;
      this.routes.set(this.engines[k], { stops: t.stops, next: t.next ?? 0, at: false, ...(t.vias ? { vias: t.vias } : {}) });
      this.lineOf.set(this.engines[k], t.line ?? 1000 + k);
    });
    this.wire();
    // (Points as laid are the defaults, as the game's track edit tells the router: `Economy.prune`.)
    this.router.laid();
    this.checks.watchThrows(() => this.report.throws++);
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
      lap: (engine) => this.lap(engine),
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
        if (skipVias(r, r.stops.length, (k) => r.vias?.[k], pieces)) return;
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
      keep: (engine) => this.router.ways.of(this.lineOf.get(engine) ?? engine),
    });
    this.sections.shared = !this.ownLines;
    // (Sections' cap, and the router's: short of points it waits for, §3.3.)
    sim.speedCap = (train) => Math.min(this.sections.cap(train), this.router.speedCap(train));
    sim.waitsAt = (train) => this.router.waitsAt(train);
    sim.standsWithin = (train) => this.sections.standsWithin(train);
    sim.turnsNose = (train) => this.sections.turnsNose(train);
    this.router = new Router({
      layout,
      sim,
      routed: this.routes,
      // (As the economy's: where it's heading, the stop after once at one, or a via point on the way; `then` aims on.)
      goal: (engine) => this.goal(engine, 0),
      then: (engine) => this.goal(engine, 1),
      lapRule: (engine) => this.sections.lapRule(engine),
      owner: (engine) => this.owner(engine),
      drive,
      granted: (engine) => this.sections.steerHint(engine),
      awaitingGrant: (engine) => this.sections.awaitingGrant(engine),
      soon: this.sections.steerSoon,
    });
    this.router.timing = true;
    // (Path signals read the router's locks, as the economy wires them.)
    const router = this.router;
    sim.pathLocks = { locks: (t, points, choice) => router.pathLocks(t, points, choice), way: (t, id, entry) => router.pathWay(t, id, entry), version: () => router.locksVersion };
    // (And sections' waiting points: a mark shows clear for a line's train only once its move past it is granted.)
    const sections = this.sections;
    sim.signalGate = { at: (ref) => sections.gateAt(ref), version: () => sections.gateVersion() };
    this.stalls = new Stalls(sim, this.sections, {
      lineOf: (engine) => (this.routes.has(engine) ? (this.lineOf.get(engine) ?? -1) : -1),
      routeWait: (engine) => this.router.waitingOn(engine),
      routed: (engine) => this.routes.has(engine),
      goal: (engine) => this.target(engine),
      otherRoad: (id, by) => {
        const t = sim.getTrain(id);
        return !!t && this.router.giveWayRoad(t, sim.piecesUnder(by));
      },
    });
  }

  routed(engine: number): boolean {
    return this.routes.has(engine);
  }

  drive(train: Train): number {
    return drive(train);
  }

  /** Busy where it stands by its own choice: at its stop, or turning back at the end of the line (`greenHeld`). */
  busy(train: Train, engine: number): boolean {
    return !!this.routes.get(engine)?.at || train.turnback >= 0;
  }

  /** The player's switch positions (the default each is restored to): as laid, then each lever tap's (the router's). */
  defaultOf(pieceId: number): number {
    return this.router.defaultOf(pieceId);
  }

  /** Where a routed engine is going: its next stop, or (standing at it) the next different one, or a via point on the way; −1: none on the map. */
  target(engine: number): number {
    return this.goal(engine, 0);
  }

  /** Its aims round one lap from the one it has now (as `Economy`'s, sections' `circling`). */
  lap(engine: number): number[] {
    const r = this.routes.get(engine);
    if (!r || r.stops.length === 0) return [];
    let i = r.next % r.stops.length;
    if (r.at) {
      const here = r.stops[i];
      for (let k = 0; k < r.stops.length && r.stops[i] === here; k++) i = (i + 1) % r.stops.length;
    }
    const onMap = (p: number) => !!this.layout.getPiece(p);
    return lapAims(r.stops.length, i, viaDone(r, i), (k) => r.vias?.[k], onMap, (k) => (onMap(r.stops[k]) ? r.stops[k] : -1));
  }

  /** Whose kept ways (stickiness) a routed engine's plan keeps: its line's. */
  owner(engine: number): number {
    return this.lineOf.get(engine) ?? engine;
  }

  /** Where a route is aimed on its way into stop `i`: its next via point not passed, else the stop (as the economy's). */
  private aim(r: RouteState, i: number, skip = 0): number {
    const onMap = (p: number) => !!this.layout.getPiece(p);
    return aimOf(r, r.stops.length, i, (k) => r.vias?.[k], onMap, onMap(r.stops[i]) ? r.stops[i] : -1, skip);
  }

  /** The router's goal (as `Economy.goalOf`): its next stop, at it the stop after (a different one); or a via point on the way (`skip` aims on). */
  private goal(engine: number, skip: number): number {
    const r = this.routes.get(engine);
    if (!r || r.stops.length === 0) return -1;
    let i = r.next % r.stops.length;
    if (r.at) {
      const here = r.stops[i];
      const train = this.sim.findCar(engine)?.train;
      // (And past any it has run onto already, between its front and this one, as the economy's.)
      for (let k = 0; k < r.stops.length; k++) {
        const p = r.stops[i];
        if (p !== here && (!train || !this.layout.getPiece(p) || !ranOnto(train.bogies, drive(train), here, p))) break;
        i = (i + 1) % r.stops.length;
      }
    }
    return this.aim(r, i, skip);
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

  /** Train `k` put away (its card's Remove, or picked up): off the track and its line. */
  putAway(k: number): void {
    const engine = this.engines[k];
    const t = engine === undefined ? undefined : this.sim.findCar(engine)?.train;
    if (!t) return;
    this.sim.removeTrain(t.id);
    this.routes.delete(engine);
    this.lineOf.delete(engine);
    // (As the game's Remove: `economy.prune()`.)
    this.sections.prune(new Set(this.lineOf.keys()));
    this.stalls.prune();
  }

  /** A signal mark held at red by hand, or let go (a tap on it). */
  holdSignal(id: number, on: boolean): void {
    if (!!this.layout.getSignal(id)?.held !== on) this.sim.toggleMark(id);
  }

  /** A signal mark turned round on its joint (its card's Turn round). */
  turnSignal(id: number): void {
    this.layout.turnSignal(id);
  }

  /** A signal mark taken away (its card's Remove). */
  removeSignal(id: number): void {
    this.layout.removeSignal(id);
  }

  pin(pieceId: number, on: boolean): void {
    this.layout.setPinned(pieceId, on);
    this.checks.pinned(pieceId, on);
  }

  /** A piece taken up (a train on it comes off the rails, as in the editor). */
  takeUp(pieceId: number): void {
    this.layout.removePiece(pieceId);
    this.sim.trackChanged();
  }

  /**
   * A track edit (the player laying or taking up pieces with the train running): `edit` changes the layout, then the sim
   * and the router hear of it, as the game's track edit tells them (`Sim.trackChanged`, `Economy.prune`'s `laid`).
   */
  edit(edit: (layout: Layout) => void): void {
    edit(this.layout);
    this.sim.trackChanged();
    this.router.laid();
  }

  /** Saved and loaded: every train put back where it stood on a new sim (ids kept), routing and sections afresh. */
  saveAndLoad(): void {
    const old = this.sim;
    // (The points' defaults go through the save as the game's do: only those that differ from how the points lie.)
    const defaults = this.router.save();
    const saved = this.engines.map((engine) => {
      const t = old.findCar(engine)?.train;
      return t && !t.derailed ? { kinds: t.cars.map((c) => c.kind), ids: t.cars.map((c) => c.id), lead: { ...t.bogies[0] }, facing: t.cars.map((c) => c.facing), levers: t.cars.map((c) => c.lever), speed: t.speed, place: this.sections.savedPlace(engine) } : null;
    });
    const counters = old.idCounters();
    this.sim = new Sim(this.layout);
    this.sim.setIdCounters(counters);
    const routes = new Map<number, RouteState>();
    const lines = new Map<number, number>();
    const back = new Set<number>();
    saved.forEach((s, k) => {
      if (!s) return;
      const placed = this.sim.addTrain(s.kinds, s.lead, s.ids);
      if (placed.kind !== "placed") throw new Error("a saved train didn't fit back");
      const t = this.sim.getTrain(placed.trainId)!;
      if (t.bogies[0].pieceId === s.lead.pieceId && Math.abs(t.bogies[0].s - s.lead.s) < 1e-6) t.speed = s.speed;
      t.cars.forEach((car, i) => {
        if (s.facing[i] === -1) this.sim.flipCar(car.id);
        if (car.kind === "engine") this.sim.setLever(car.id, s.levers[i]);
      });
      back.add(this.engines[k]);
      this.checks.forget(k);
      this.lastTurn[k] = -1;
    });
    for (const [engine, r] of this.routes) if (back.has(engine)) routes.set(engine, r);
    for (const [engine, id] of this.lineOf) if (back.has(engine)) lines.set(engine, id);
    this.routes = routes;
    this.lineOf = lines;
    this.report.stalls.begun += this.stalls.begun;
    this.report.gaveWay.any += this.stalls.gaveWay;
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
    this.report.pieceUs = (this.routerMs * 1000) / Math.max(1, this.checks.pieces);
    this.report.locks = r.granted;
    this.report.refused = r.refused;
    this.report.restored = r.restored;
    this.report.waits = r.waitsBegun;
    this.report.stalls.begun += this.stalls.begun;
    this.stalls.begun = 0;
    this.report.gaveWay.any += this.stalls.gaveWay;
    this.stalls.gaveWay = 0;
    this.report.pieces = this.checks.pieces;
    this.report.facing = this.checks.facing;
    this.report.redLate = this.checks.redLate;
    this.report.signalPasses = this.checks.signalPasses;
    this.report.trajectory = this.traj.toString(16).padStart(8, "0");
    return this.report;
  }

  /** Called after each tick's checks (the reservation shadow, routing/shadow.ts): it may read, never change, the run. */
  afterStep: ((run: HarnessRun) => void) | null = null;

  /** One tick, in the economy's order (the sim, routes come to and left, the router), then the checks. */
  step(): void {
    this.checks.beforeTick();
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
      if (!on && !r.at && r.vias) {
        const t = found.train;
        const net = drive(t);
        if (net !== 0) passVias(r, r.stops.length, (i) => r.vias?.[i], (p) => !!this.layout.getPiece(p), (net > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]).pieceId);
      }
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
        resetVias(r);
      }
    });
  }

  /** The report's counts, then the invariants (src/sim/invariants.ts). */
  private check(): void {
    const { sim } = this;
    this.engines.forEach((engine, k) => {
      const found = sim.findCar(engine);
      if (!found) return;
      const t = found.train;
      if (t.derailed) return;
      if (t.lastTurn && t.lastTurn.tick !== this.lastTurn[k]) {
        this.lastTurn[k] = t.lastTurn.tick;
        this.report.turns[k][t.lastTurn.cause]++;
      }
      if (this.watch.size > 0 && t.bogies.some((b) => this.watch.has(b.pieceId))) this.report.onWatched++;
      const net = drive(t);
      // (A stall (stalls.ts) is said on its card, so it counts apart (`stalls`); the longest stand-still counts the
      // stands the invariants' deadlock check would: not one sections hold for want of room, nor one at a red switch.)
      const stuck = this.stalls.stuckOf(engine);
      if (stuck) {
        this.report.stalls.stuck[k]++;
        this.report.stalls.why[k] = stuck.kind;
      }
      if (net !== 0 && t.speed === 0 && !stuck && !this.sections.heldForRoom(engine) && this.router.waitOf(engine)?.kind !== "pinned" && !this.sections.swapHolds(engine)) {
        const s = ++this.still[k];
        if (s > this.report.longestStill[k]) this.report.longestStill[k] = s;
      } else this.still[k] = 0;
      const wait = this.sections.waitOf(engine);
      if (wait && t.speed === 0 && net !== 0) this.report.held[k]++;
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
    });
    this.checks.check();
    this.afterStep?.(this);
  }

  private record(): void {
    let s = "";
    for (const t of this.sim.trains()) {
      s += `T:${t.speed}:${t.derailed ? 1 : 0}`;
      for (const b of t.bogies) s += `|${b.pieceId},${b.pathIndex},${b.reversed ? 1 : 0},${b.s}`;
    }
    this.traj = fnv(s, this.traj);
  }
}

/**
 * In a scenario's `build`: a signal mark on the joint at a piece's connector, guarding trains that cross it from that
 * piece (signals spec §10.1). Its id (for events: `holdSignal`, `turnSignal`, `removeSignal`).
 */
export function signal(layout: Layout, pieceId: number, connector: number, opts: { held?: boolean; style?: SignalStyle; mode?: SignalMode } = {}): number {
  const id = layout.addSignal(connectorRef(pieceId, connector), opts.style ?? "plain", opts.mode ?? !!opts.held);
  if (id === -1) throw new Error(`signal: piece ${pieceId}'s end ${connector} is no joint (or has a signal that way)`);
  return id;
}

/** Run a scenario on a new layout from start to end. */
export function runScenario(layout: Layout, scenario: Scenario): Report {
  return new HarnessRun(layout, scenario).run(scenario.seconds);
}
