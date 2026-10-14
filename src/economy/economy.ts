import { getPieceDef, pathLength, type Layout } from "../track";
import { SIM_DT, type Cursor, type Sim, type Train } from "../sim";
import { CARGO, CARGO_KINDS, canCarry, type CargoKind } from "./cargo";
import { ticks, CRANE_TICKS, CRAWL_SPEED, PILE_CAP, WAGON_CAPACITY } from "./constants";
import type { Bag } from "./goods";
import { steer } from "./steer";

/** How often (sim ticks) the switches ahead of routed trains are set. */
const STEER_TICKS = 8;

const NONE = 0;
const CRAWLING = 1;
const HALTED = 2;
/** A wagon centre this close to the crane point (mm) counts as under the crane. */
const AT_CRANE = 0.5;
/** A train crawling through a depot that has stood still this long is held up short of the crane. */
const STUCK_TICKS = ticks(1);

/** One train's visit to a depot. Allocated once per train and reused. */
interface Service {
  readonly trainId: number;
  phase: number;
  depotId: number;
  /** The car under the crane while halted. */
  carId: number;
  /** Ticks into the current crane move. */
  ticks: number;
  /** Ticks it has stood still while crawling (held up short of the crane). */
  still: number;
  /** Cars already served (or sent on) during this visit. */
  readonly done: Set<number>;
}

export type DepotRole = "forest" | "sawmill" | "town" | "workshop" | "farm" | "mill" | "quarry" | "warehouse";

/**
 * What a kind of depot does: the goods trains bring it (unloaded onto its piles), the goods it gives them, and what it
 * makes by itself, a cycle at a time. One row per kind of industry: a new one is a row here (and a model).
 */
export interface Recipe {
  readonly takes: readonly CargoKind[];
  readonly gives: readonly CargoKind[];
  /**
   * One cycle every `seconds` (at rate 1): uses `uses` from its piles, adds `makes` to them. Runs while it has what it
   * uses and room for what it makes. `eats`: uses one of whatever it has of `takes` (a town using up its goods).
   */
  readonly cycle?: { readonly uses: Bag; readonly makes: Bag; readonly seconds: number; readonly eats?: boolean };
  /** Most units each pile holds (default `PILE_CAP`). */
  readonly cap?: number;
  /** Serves only routed trains, at their stops (it takes and gives the same goods: a train must say which). */
  readonly routedOnly?: boolean;
}

export const RECIPES: Record<DepotRole, Recipe> = {
  forest: { takes: [], gives: ["log"], cycle: { uses: {}, makes: { log: 1 }, seconds: 15 } },
  sawmill: { takes: ["log"], gives: ["planks"], cycle: { uses: { log: 1 }, makes: { planks: 1 }, seconds: 8 } },
  town: { takes: ["planks", "flour", "stone"], gives: [], cycle: { uses: {}, makes: {}, seconds: 30, eats: true } },
  // Takes goods in to make things from (Game mode's crafting draws on its pile; it makes nothing by itself).
  workshop: { takes: ["planks"], gives: [] },
  // The farm chain (Game mode): a farm yard by the fields fills hoppers with grain; a mill grinds it into flour.
  farm: { takes: [], gives: ["grain"], cycle: { uses: {}, makes: { grain: 1 }, seconds: 12 } },
  mill: { takes: ["grain"], gives: ["flour"], cycle: { uses: { grain: 1 }, makes: { flour: 1 }, seconds: 8 } },
  // Stone cut from a hillside (Game mode's quarries).
  quarry: { takes: [], gives: ["stone"], cycle: { uses: {}, makes: { stone: 1 }, seconds: 14 } },
  // Keeps goods for later: everything, more of it. Routed trains drop or pick up there as their stops say.
  warehouse: { takes: [...CARGO_KINDS], gives: [...CARGO_KINDS], cap: 24, routedOnly: true },
};

/** The piles a kind of depot keeps: what it takes and what it gives. */
/** Most units a pile of this kind of depot holds. */
export function capOf(role: DepotRole): number {
  return RECIPES[role].cap ?? PILE_CAP;
}

export function pilesOf(role: DepotRole): CargoKind[] {
  const r = RECIPES[role];
  return CARGO_KINDS.filter((k) => r.takes.includes(k) || r.gives.includes(k));
}

/** What a train does at a stop on its route: drop goods off, pick goods up, or both. */
export type StopAction = "both" | "drop" | "pick";

/**
 * A train's route: the depots it stops at, in order, and what it does at each. A routed train is served only at its
 * stops, and the switches ahead of it are set toward `next` (see `steer`); passing that stop moves `next` on.
 */
export interface Route {
  stops: { depotId: number; action: StopAction }[];
  /** The stop it's heading for (an index into `stops`). */
  next: number;
  /** It's at its next stop now (it moves on to the one after when it leaves). */
  at?: boolean;
}

export interface DepotState {
  readonly id: number;
  readonly pieceId: number;
  readonly role: DepotRole;
  /** The town a station depot belongs to (−1 for goods depots). */
  readonly townId: number;
  /** Load and unload trains by itself. */
  auto: boolean;
  /** Trains wait under the crane until each wagon is full. */
  waitFull: boolean;
  /** Units on each pile, by cargo index. */
  readonly piles: Int32Array;
  /** Ticks into the current production (forest, sawmill) or use (town) cycle. */
  timer: number;
  /** How fast it makes things, against its recipe (an industry near fewer of its resource is slower; 0 stops it). */
  rate: number;
  /** Where wagons stop for the crane: distance (mm) from the depot path's `from` end. */
  readonly craneAt: number;
}

export interface CarCargo {
  kind: CargoKind | null;
  count: number;
}

/** A crane move in progress (filled in by `Economy.craneMove`; allocate one per caller and reuse it). */
export interface CraneMove {
  kind: CargoKind;
  /** From the wagon to a pile (true), or the other way. */
  toPile: boolean;
  carId: number;
  /** 0–1 through the move. */
  phase: number;
}

/** Something the crane did this tick (for sounds and small effects). */
export interface EconomyEvent {
  readonly kind: "loaded" | "unloaded";
  readonly depotId: number;
  readonly cargo: CargoKind;
}

export type CargoSlot = { readonly kind: "pile"; readonly depotId: number; readonly cargo: CargoKind } | { readonly kind: "car"; readonly carId: number };

const EMPTY: CarCargo = { kind: null, count: 0 };

/**
 * Depots, their piles and the cargo riding on wagons. Pure and deterministic: everything advances in whole sim
 * ticks from `tick()`, called once after every `Sim.tick()`.
 */
export class Economy {
  private readonly depots: DepotState[] = [];
  private readonly byPiece = new Map<number, DepotState>();
  private readonly cargo = new Map<number, CarCargo>();
  /** Engine car id → its train's route (see `Route`). Trains with none are served at any depot they pass. */
  private readonly routes = new Map<number, Route>();
  /** Town id → plank bundles delivered there (by train or by hand). */
  readonly delivered = new Map<number, number>();
  /** Town id → everything delivered there, by kind (planks are counted in `delivered` too). */
  readonly deliveredGoods = new Map<number, Bag>();
  private readonly services = new Map<number, Service>();
  private events: EconomyEvent[] = [];
  /** The other half of the event double buffer (no new array each drain). */
  private drained: EconomyEvent[] = [];

  constructor(
    readonly layout: Layout,
    readonly sim: Sim,
  ) {
    sim.speedCap = (train) => this.capFor(train);
  }

  /** Register a depot on a piece. `craneAt` defaults to the middle of the piece's track. */
  addDepot(role: DepotRole, pieceId: number, townId = -1, craneAt?: number): DepotState {
    const p = this.layout.getPiece(pieceId);
    const len = p ? pathLength(getPieceDef(p.type, p.flipped).paths[0].geom) : 216;
    const d: DepotState = { id: this.depots.length, pieceId, role, townId, auto: true, waitFull: false, piles: new Int32Array(CARGO_KINDS.length), timer: 0, rate: 1, craneAt: craneAt ?? len / 2 };
    this.depots.push(d);
    this.byPiece.set(pieceId, d);
    return d;
  }

  depot(id: number): DepotState | undefined {
    return this.depots[id];
  }

  depotAtPiece(pieceId: number): DepotState | undefined {
    return this.byPiece.get(pieceId);
  }

  allDepots(): readonly DepotState[] {
    return this.depots;
  }

  cargoOf(carId: number): Readonly<CarCargo> {
    return this.cargo.get(carId) ?? EMPTY;
  }

  /** Put cargo straight onto a car (saves, tests). */
  setCargo(carId: number, kind: CargoKind | null, count: number): void {
    if (count <= 0 || kind === null) this.cargo.delete(carId);
    else this.cargo.set(carId, { kind, count: Math.min(count, WAGON_CAPACITY) });
  }

  setAuto(depotId: number, on: boolean): void {
    const d = this.depots[depotId];
    if (d) d.auto = on;
  }

  setWaitFull(depotId: number, on: boolean): void {
    const d = this.depots[depotId];
    if (d) d.waitFull = on;
  }

  /** Can a pile hold this cargo (it is the depot's input or output) and is there room? */
  pileAccepts(d: DepotState, kind: CargoKind): boolean {
    const r = RECIPES[d.role];
    return (r.takes.includes(kind) || r.gives.includes(kind)) && d.piles[CARGO[kind].index] < capOf(d.role);
  }

  /** Can this car take one more unit of `kind`? */
  carAccepts(carId: number, kind: CargoKind): boolean {
    const found = this.sim.findCar(carId);
    if (!found || !canCarry(found.train.cars[found.index].kind, kind)) return false;
    const c = this.cargoOf(carId);
    return c.count < WAGON_CAPACITY && (c.kind === null || c.kind === kind);
  }

  /** Move one unit by hand between a pile and a wagon (or two of either). False, changing nothing, if not allowed. */
  moveCargo(from: CargoSlot, to: CargoSlot): boolean {
    let kind: CargoKind;
    if (from.kind === "pile") {
      const d = this.depots[from.depotId];
      if (!d || d.piles[CARGO[from.cargo].index] <= 0) return false;
      kind = from.cargo;
    } else {
      const c = this.cargoOf(from.carId);
      if (c.kind === null || c.count <= 0) return false;
      kind = c.kind;
    }
    if (to.kind === "pile") {
      const d = this.depots[to.depotId];
      if (!d || to.cargo !== kind || !this.pileAccepts(d, kind)) return false;
    } else if (!this.carAccepts(to.carId, kind)) return false;
    if (from.kind === "car" && to.kind === "car" && from.carId === to.carId) return false;

    this.take(from, kind);
    this.put(to, kind);
    return true;
  }

  private take(slot: CargoSlot, kind: CargoKind): void {
    if (slot.kind === "pile") this.depots[slot.depotId].piles[CARGO[kind].index]--;
    else this.setCargo(slot.carId, kind, this.cargoOf(slot.carId).count - 1);
  }

  private put(slot: CargoSlot, kind: CargoKind): void {
    if (slot.kind === "pile") {
      const d = this.depots[slot.depotId];
      d.piles[CARGO[kind].index]++;
      if (d.role === "town" && kind === "planks") this.delivered.set(d.townId, (this.delivered.get(d.townId) ?? 0) + 1);
      if (d.role === "town") {
        const got = this.deliveredGoods.get(d.townId) ?? {};
        got[kind] = (got[kind] ?? 0) + 1;
        this.deliveredGoods.set(d.townId, got);
      }
    } else this.setCargo(slot.carId, kind, this.cargoOf(slot.carId).count + 1);
  }

  /** Unload one unit from a car onto a depot's input pile (crane work). */
  protected unloadOne(d: DepotState, carId: number): void {
    const kind = this.cargoOf(carId).kind!;
    this.take({ kind: "car", carId }, kind);
    this.put({ kind: "pile", depotId: d.id, cargo: kind }, kind);
  }

  /** Load one unit from a depot's output pile onto a car (crane work). */
  protected loadOne(d: DepotState, carId: number): void {
    const kind = this.loadKind(d, carId)!;
    this.take({ kind: "pile", depotId: d.id, cargo: kind }, kind);
    this.put({ kind: "car", carId }, kind);
  }

  /**
   * Is this depot making (or using) something now: it has what its cycle uses and room for what it makes? (A
   * sawmill's saw spins while true.)
   */
  working(d: DepotState): boolean {
    const cycle = RECIPES[d.role].cycle;
    if (!cycle || d.rate <= 0) return false;
    if (cycle.eats) return RECIPES[d.role].takes.some((k) => d.piles[CARGO[k].index] > 0);
    for (const k in cycle.uses) if (d.piles[CARGO[k as CargoKind].index] < cycle.uses[k as CargoKind]!) return false;
    for (const k in cycle.makes) if (d.piles[CARGO[k as CargoKind].index] + cycle.makes[k as CargoKind]! > capOf(d.role)) return false;
    return true;
  }

  /** Would the crane do anything for this car at this depot? */
  needsService(d: DepotState, carId: number): boolean {
    const found = this.sim.findCar(carId);
    if (!found || !canCarry(found.train.cars[found.index].kind)) return false;
    return this.canUnload(d, carId) || this.loadKind(d, carId) !== null || this.waitsForLoad(d, carId);
  }

  private canUnload(d: DepotState, carId: number): boolean {
    const c = this.cargoOf(carId);
    if (c.kind === null || c.count <= 0 || !RECIPES[d.role].takes.includes(c.kind) || d.piles[CARGO[c.kind].index] >= capOf(d.role)) return false;
    // A routed train drops goods only at its stops that say so.
    const route = this.routeOfCar(carId);
    return route ? stopAt(route, d.id, "drop") : !RECIPES[d.role].routedOnly;
  }

  /** Give this engine's train a route (null or no stops: none; it's served wherever it goes). */
  setRoute(engineCarId: number, route: Route | null): void {
    if (!route || route.stops.length === 0) this.routes.delete(engineCarId);
    else this.routes.set(engineCarId, route);
  }

  /** This engine's route, if it has one. */
  routeOf(engineCarId: number): Route | undefined {
    return this.routes.get(engineCarId);
  }

  /** The route of the train this car is in: its first engine's (with stops still on the map), or null. */
  routeOfCar(carId: number): Route | null {
    if (this.routes.size === 0) return null;
    const found = this.sim.findCar(carId);
    return found ? this.routeOfTrain(found.train) : null;
  }

  routeOfTrain(train: Train): Route | null {
    if (this.routes.size === 0) return null;
    for (const car of train.cars) {
      const r = this.routes.get(car.id);
      if (r && r.stops.some((s) => this.depots[s.depotId] && this.layout.getPiece(this.depots[s.depotId].pieceId))) return r;
    }
    return null;
  }

  /** What the crane would load onto this car here: goods the depot gives, the car carries and has room for, or null. */
  private loadKind(d: DepotState, carId: number): CargoKind | null {
    const c = this.cargoOf(carId);
    if (c.count >= WAGON_CAPACITY) return null;
    // A routed train picks up goods only at its stops that say so (at a warehouse, only where it says Pick up).
    const route = this.routeOfCar(carId);
    if (route ? !stopAt(route, d.id, "pick") || (RECIPES[d.role].routedOnly && stopAt(route, d.id, "drop")) : RECIPES[d.role].routedOnly) return null;
    const found = this.sim.findCar(carId);
    if (!found) return null;
    const car = found.train.cars[found.index].kind;
    for (const k of RECIPES[d.role].gives) if ((c.kind === null || c.kind === k) && canCarry(car, k) && d.piles[CARGO[k].index] > 0) return k;
    return null;
  }

  /**
   * With "wait for a full load", a wagon that could take more of the depot's goods waits for them, but only while
   * more are coming: goods on the pile, or the depot making them. (A sawmill out of logs isn't, so a train never waits
   * there for planks that would need the logs on its own later wagons.)
   */
  private waitsForLoad(d: DepotState, carId: number): boolean {
    const c = this.cargoOf(carId);
    if (!d.waitFull || c.count >= WAGON_CAPACITY || this.canUnload(d, carId)) return false;
    const found = this.sim.findCar(carId);
    if (!found) return false;
    const car = found.train.cars[found.index].kind;
    const kind = RECIPES[d.role].gives.find((k) => (c.kind === null || c.kind === k) && canCarry(car, k));
    if (kind === undefined) return false;
    return d.piles[CARGO[kind].index] > 0 || this.working(d);
  }

  /** The car under the crane at a depot right now, or −1. */
  servicedCar(depotId: number): number {
    for (const s of this.services.values()) if (s.phase === HALTED && s.depotId === depotId) return s.carId;
    return -1;
  }

  /** Progress (0–1) of the crane's current move at a depot, or −1 when idle. */
  cranePhase(depotId: number): number {
    for (const s of this.services.values()) if (s.phase === HALTED && s.depotId === depotId) return s.ticks / CRANE_TICKS;
    return -1;
  }

  /**
   * What the crane at a depot is carrying right now: the cargo, which way (from the wagon to a pile, or the other
   * way), the car, and progress 0–1, written into `out`. False when the crane is idle or waiting.
   */
  craneMove(depotId: number, out: CraneMove): boolean {
    for (const s of this.services.values()) {
      if (s.phase !== HALTED || s.depotId !== depotId || s.ticks === 0) continue;
      const d = this.depots[depotId];
      out.carId = s.carId;
      out.phase = s.ticks / CRANE_TICKS;
      if (this.canUnload(d, s.carId)) {
        out.kind = this.cargoOf(s.carId).kind!;
        out.toPile = true;
        return true;
      }
      const load = this.loadKind(d, s.carId);
      if (load !== null) {
        out.kind = load;
        out.toPile = false;
        return true;
      }
    }
    return false;
  }

  private service(trainId: number): Service {
    let s = this.services.get(trainId);
    if (!s) this.services.set(trainId, (s = { trainId, phase: NONE, depotId: -1, carId: -1, ticks: 0, still: 0, done: new Set() }));
    return s;
  }

  /**
   * The automatic depot under this train's axles, if any. A train beside two (industries end to end) is served where
   * a wagon has work: the one whose crane is working on it, else the first with work, else the first.
   */
  private depotUnder(train: Train): DepotState | undefined {
    const s = this.services.get(train.id);
    let first: DepotState | undefined;
    let work: DepotState | undefined;
    for (const b of train.bogies) {
      const d = this.byPiece.get(b.pieceId);
      if (!d || !d.auto || d === first || d === work) continue;
      if (s && s.phase === HALTED && s.depotId === d.id) return d;
      first ??= d;
      if (!work && train.cars.some((c) => !(s && s.depotId === d.id && s.done.has(c.id)) && this.needsService(d, c.id))) work = d;
    }
    return work ?? first;
  }

  /**
   * The sim's speed limit for a powered train: on an automatic depot where one of its wagons has work, crawl, and slow
   * so the next wagon needing the crane stops exactly under it, then hold it there (0) while the crane works. A train
   * with nothing to do there runs through at full speed.
   */
  private capFor(train: Train): number {
    const d = this.depotUnder(train);
    const s = this.service(train.id);
    if (!d) {
      if (s.phase !== NONE || s.done.size > 0) this.endVisit(s);
      return Infinity;
    }
    if (s.depotId !== d.id) {
      this.endVisit(s);
      s.depotId = d.id;
      s.phase = CRAWLING;
    }
    // Reversing the lever sends the train on: nothing more for it here this visit.
    if (this.drive(train) < 0) {
      for (const car of train.cars) s.done.add(car.id);
      s.phase = CRAWLING;
      return Infinity;
    }
    if (s.phase === HALTED) return 0;
    // Nothing for the crane in this train (this visit): it won't stop, so it needn't slow.
    if (!train.cars.some((car) => !s.done.has(car.id) && this.needsService(d, car.id))) return Infinity;
    s.phase = CRAWLING;
    let cap = CRAWL_SPEED;
    const len = this.depotLength(d);
    const crane = d.craneAt;
    // A wagon the crane can't stop under (rolled past it, or off the depot's track on a long train): served where it
    // stands, once no other wagon is still coming up to the crane.
    // The train runs front first (its cars in order): cars after the last one on the depot are still to come.
    let lastOn = -1;
    for (let c = 0; c < train.cars.length; c++) if (train.bogies[2 * c].pieceId === d.pieceId || train.bogies[2 * c + 1].pieceId === d.pieceId) lastOn = c;
    // Stopped short of the crane (a buffer, a train ahead): the ones still to come won't, so they're reached for too.
    s.still = train.speed === 0 ? s.still + 1 : 0;
    const stuck = s.still > STUCK_TICKS;
    let reach = -1;
    let coming = false;
    for (let c = 0; c < train.cars.length; c++) {
      const car = train.cars[c];
      if (s.done.has(car.id) || !this.needsService(d, car.id)) continue;
      const front = train.bogies[2 * c];
      const rear = train.bogies[2 * c + 1];
      if (front.pieceId !== d.pieceId || rear.pieceId !== d.pieceId) {
        // Running onto the depot (its leading end on it), or not there yet: it will come up to the crane.
        const arriving = front.pieceId === d.pieceId || (rear.pieceId !== d.pieceId && c > lastOn);
        if (arriving && !stuck) coming = true;
        else if (reach === -1) reach = car.id;
        continue;
      }
      // Distance still to go before the car's centre is under the crane.
      const centre = (along(front, len) + along(rear, len)) / 2;
      const ahead = (crane - centre) * (front.reversed ? -1 : 1);
      if (ahead < -AT_CRANE) {
        if (reach === -1) reach = car.id;
        continue;
      }
      if (ahead <= AT_CRANE) return this.halt(s, car.id);
      if (stuck) {
        if (reach === -1) reach = car.id;
        continue;
      }
      coming = true;
      if (ahead / SIM_DT < cap) cap = ahead / SIM_DT;
    }
    // Beside the depot at all, every wagon gets its turn: the train stops for the ones the crane must reach to.
    if (!coming && reach !== -1) return this.halt(s, reach);
    return cap;
  }

  /** Stop the train for the crane to work on this car. */
  private halt(s: Service, carId: number): number {
    s.phase = HALTED;
    s.carId = carId;
    s.ticks = 0;
    return 0;
  }

  /** Net drive of a train's engines toward its front (sign only matters). */
  private drive(train: Train): number {
    let net = 0;
    for (const car of train.cars) if (car.kind === "engine") net += car.lever * car.facing;
    return net;
  }

  private depotLength(d: DepotState): number {
    const p = this.layout.getPiece(d.pieceId);
    return p ? pathLength(getPieceDef(p.type, p.flipped).paths[0].geom) : 216;
  }

  private endVisit(s: Service): void {
    s.phase = NONE;
    s.depotId = -1;
    s.carId = -1;
    s.ticks = 0;
    s.still = 0;
    s.done.clear();
  }

  /** Crane work for every halted train: one unit per move, unloading before loading. */
  private work(): void {
    for (const s of this.services.values()) {
      if (s.phase !== HALTED) continue;
      const train = this.sim.getTrain(s.trainId);
      const d = this.depots[s.depotId];
      if (!train) {
        // Gone (coupled into another train, or removed): forget its visit.
        this.services.delete(s.trainId);
        continue;
      }
      if (train.derailed || !d || !d.auto || !this.sim.findCar(s.carId)) {
        this.endVisit(s);
        continue;
      }
      // Lever off: the train stays put and the crane stops; it carries on when the train is set going again.
      if (this.drive(train) === 0) {
        s.phase = CRAWLING;
        s.ticks = 0;
        continue;
      }
      if (!this.canUnload(d, s.carId) && this.loadKind(d, s.carId) === null) {
        if (this.waitsForLoad(d, s.carId)) continue;
        s.done.add(s.carId);
        s.phase = CRAWLING;
        s.ticks = 0;
        continue;
      }
      if (++s.ticks < CRANE_TICKS) continue;
      s.ticks = 0;
      if (this.canUnload(d, s.carId)) {
        this.events.push({ kind: "unloaded", depotId: d.id, cargo: this.cargoOf(s.carId).kind! });
        this.unloadOne(d, s.carId);
      } else {
        this.events.push({ kind: "loaded", depotId: d.id, cargo: this.loadKind(d, s.carId)! });
        this.loadOne(d, s.carId);
      }
    }
  }

  /** One sim tick of production, use and crane work. */
  tick(): void {
    this.work();
    if (this.routes.size > 0) {
      this.advanceRoutes();
      // Switches ahead of routed trains, a few times a second (a train covers a few mm a tick).
      if (++this.steerTicks % STEER_TICKS === 0) this.steerTrains();
    }
    for (const d of this.depots) {
      if (!this.working(d)) {
        d.timer = 0;
        continue;
      }
      d.timer++;
      const cycle = RECIPES[d.role].cycle!;
      if (d.timer < cycleTicks(cycle.seconds, d.rate)) continue;
      d.timer = 0;
      if (cycle.eats) {
        for (const k of RECIPES[d.role].takes) if (d.piles[CARGO[k].index] > 0) d.piles[CARGO[k].index]--;
        continue;
      }
      for (const k in cycle.uses) d.piles[CARGO[k as CargoKind].index] -= cycle.uses[k as CargoKind]!;
      for (const k in cycle.makes) d.piles[CARGO[k as CargoKind].index] += cycle.makes[k as CargoKind]!;
    }
  }

  /** Called when a route has set a switch (the game redraws its lever). */
  onSwitch: ((pieceId: number) => void) | null = null;
  private steerTicks = 0;

  /** A routed train that has been at its next stop and left it heads for the one after. */
  private advanceRoutes(): void {
    for (const [engine, r] of this.routes) {
      const found = this.sim.findCar(engine);
      if (!found) continue;
      const stop = r.stops[r.next % r.stops.length];
      const d = this.depots[stop.depotId];
      if (!d || !this.layout.getPiece(d.pieceId)) {
        // Its stop was taken up: on to the next.
        r.next = (r.next + 1) % r.stops.length;
        r.at = false;
        continue;
      }
      const on = found.train.bogies.some((b) => b.pieceId === d.pieceId);
      if (on) r.at = true;
      else if (r.at) {
        r.at = false;
        r.next = (r.next + 1) % r.stops.length;
      }
    }
  }

  /** Set the switches ahead of each routed train toward its next stop. */
  private steerTrains(): void {
    for (const [engine, r] of this.routes) {
      const found = this.sim.findCar(engine);
      if (!found || found.train.derailed) continue;
      const net = this.drive(found.train);
      const d = this.depots[r.stops[r.next % r.stops.length].depotId];
      if (net === 0 || !d) continue;
      if (steer(this.layout, found.train, net > 0, d.pieceId)) this.onSwitch?.(d.pieceId);
    }
  }

  /** Events since the last drain. The returned array is reused: read it before the next drain. */
  drainEvents(): readonly EconomyEvent[] {
    const e = this.events;
    this.events = this.drained;
    this.events.length = 0;
    this.drained = e;
    return e;
  }

  /** Forget cargo and destinations on cars, and visits of trains, that no longer exist. */
  prune(): void {
    for (const id of this.cargo.keys()) if (!this.sim.findCar(id)) this.cargo.delete(id);
    for (const id of this.routes.keys()) if (!this.sim.findCar(id)) this.routes.delete(id);
    for (const id of this.services.keys()) if (!this.sim.getTrain(id)) this.services.delete(id);
  }
}


/** Is depot `depotId` a stop on `route` where the train may `act` (drop or pick up)? */
function stopAt(route: Route, depotId: number, act: "drop" | "pick"): boolean {
  return route.stops.some((s) => s.depotId === depotId && (s.action === "both" || s.action === act));
}

/** Ticks in one cycle of `seconds` at `rate` (whole ticks, so production stays in step with the sim). */
function cycleTicks(seconds: number, rate: number): number {
  return Math.max(1, Math.round(ticks(seconds) / rate));
}

/** A cursor's distance from its path's `from` end. */
function along(c: Cursor, len: number): number {
  return c.reversed ? len - c.s : c.s;
}
