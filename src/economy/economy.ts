import { getPieceDef, pathLength, type Layout } from "../track";
import { SIM_DT, type Cursor, type Sim, type Train } from "../sim";
import { CARGO, CARGO_KINDS, canCarry, type CargoKind } from "./cargo";
import { ticks, CRANE_TICKS, CRAWL_SPEED, PILE_CAP, WAGON_CAPACITY } from "./constants";
import type { Bag } from "./goods";
import { KitStops } from "./kit-stops";
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
/** A rider gets on or off a coach in this time. */
const RIDER_TICKS = ticks(0.3);

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

export type DepotRole = "forest" | "sawmill" | "town" | "workshop" | "farm" | "mill" | "quarry" | "warehouse" | "mine" | "foundry" | "carpenter" | "smithy" | "power" | "harbour" | KitDepotRole;

/**
 * Sandbox's cargo machines (kit pieces with a `depot`: src/track/kits.ts): a loader with an endless heap of one good,
 * and an unloader whose goods vanish into it. Sandbox has no industries to feed, so one of each makes a goods line.
 */
export type KitDepotRole = "loader-log" | "loader-grain" | "loader-coal" | "loader-planks" | "unloader";

/** The kit depot roles (for saves, and to tell them from industries'). */
export const KIT_DEPOT_ROLES: readonly KitDepotRole[] = ["loader-log", "loader-grain", "loader-coal", "loader-planks", "unloader"];

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
  /** Its piles of what it gives never run down (a Sandbox loader's endless heap): kept full. */
  readonly endless?: boolean;
  /** What it takes vanishes into it (a Sandbox unloader): its piles stay empty, so it always has room. */
  readonly sink?: boolean;
}

export const RECIPES: Record<DepotRole, Recipe> = {
  forest: { takes: [], gives: ["log"], cycle: { uses: {}, makes: { log: 1 }, seconds: 15 } },
  sawmill: { takes: ["log"], gives: ["planks"], cycle: { uses: { log: 1 }, makes: { planks: 1 }, seconds: 8 } },
  town: { takes: ["planks", "flour", "stone", "iron", "furniture", "tools"], gives: [], cycle: { uses: {}, makes: {}, seconds: 30, eats: true } },
  // Takes goods in to make things from (Game mode's crafting draws on its pile; it makes nothing by itself).
  workshop: { takes: ["planks", "iron"], gives: [] },
  // The farm chain (Game mode): a farm yard by the fields fills hoppers with grain; a mill grinds it into flour.
  farm: { takes: [], gives: ["grain"], cycle: { uses: {}, makes: { grain: 1 }, seconds: 12 } },
  mill: { takes: ["grain"], gives: ["flour"], cycle: { uses: { grain: 1 }, makes: { flour: 1 }, seconds: 8 } },
  // Stone cut from a hillside (Game mode's quarries).
  quarry: { takes: [], gives: ["stone"], cycle: { uses: {}, makes: { stone: 1 }, seconds: 14 } },
  // Mining and iron (Phase C): a mine in the hills brings up coal and ore; a foundry makes iron of them.
  mine: { takes: [], gives: ["coal", "ore"], cycle: { uses: {}, makes: { coal: 1, ore: 1 }, seconds: 18 } },
  foundry: { takes: ["coal", "ore"], gives: ["iron"], cycle: { uses: { coal: 1, ore: 1 }, makes: { iron: 1 }, seconds: 10 } },
  // Made goods: a carpenter's yard makes furniture of planks, a smithy tools of iron.
  carpenter: { takes: ["planks"], gives: ["furniture"], cycle: { uses: { planks: 3 }, makes: { furniture: 1 }, seconds: 12 } },
  smithy: { takes: ["iron"], gives: ["tools"], cycle: { uses: { iron: 2 }, makes: { tools: 1 }, seconds: 14 } },
  // A power station burns coal; while it has some, electric engines run.
  power: { takes: ["coal"], gives: [], cycle: { uses: { coal: 1 }, makes: {}, seconds: 60 } },
  // A harbour (Game mode) takes any good onto its quay for the boats that call by themselves (`src/game/harbours.ts`).
  harbour: { takes: [...CARGO_KINDS], gives: [] },
  // Keeps goods for later: everything, more of it. Routed trains drop or pick up there as their stops say.
  warehouse: { takes: [...CARGO_KINDS], gives: [...CARGO_KINDS], cap: 24, routedOnly: true },
  // Sandbox's cargo machines: an endless heap of one good, and somewhere goods vanish.
  "loader-log": { takes: [], gives: ["log"], endless: true },
  "loader-grain": { takes: [], gives: ["grain"], endless: true },
  "loader-coal": { takes: [], gives: ["coal"], endless: true },
  "loader-planks": { takes: [], gives: ["planks"], endless: true },
  unloader: { takes: [...CARGO_KINDS], gives: [], sink: true },
};

/** The piles a kind of depot keeps: what it takes and what it gives. */
/** Most units a pile of this kind of depot holds. */
export function capOf(role: DepotRole): number {
  return RECIPES[role].cap ?? PILE_CAP;
}

/** What a harbour's dock shed adds to each of its piles (Game mode; up to `MAX_SHEDS`). */
export const SHED_CAP = 12;
export const MAX_SHEDS = 3;

/** How much each pile of this depot holds: its kind's, and its dock sheds' (a harbour's). */
export function capAt(d: DepotState): number {
  return capOf(d.role) + d.sheds * SHED_CAP;
}

export function pilesOf(role: DepotRole): CargoKind[] {
  const r = RECIPES[role];
  return CARGO_KINDS.filter((k) => r.takes.includes(k) || r.gives.includes(k));
}

/** What a train does at a stop on its route: drop goods off, pick goods up, or both. */
export type StopAction = "both" | "drop" | "pick";

/**
 * A train's route: the depots it stops at, in order, and what it does at each. A routed train is served only at the
 * stop it's heading for, `next` (stops in a row at one depot are one visit), and the switches ahead of it are set
 * toward it (see `steer`); passing that stop moves `next` on.
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
  /** People waiting at a town's station for a coach (Game mode's passengers). */
  waiting: number;
  /** Dock sheds beside a harbour's quay (Game mode): each holds more of every good (see `capAt`). */
  sheds: number;
}

/** People riding a coach: how many, and the station (depot id) they got on at. */
export interface Riders {
  count: number;
  from: number;
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
const NO_RIDERS: Riders = { count: 0, from: -1 };

/**
 * Depots, their piles and the cargo riding on wagons. Pure and deterministic: everything advances in whole sim
 * ticks from `tick()`, called once after every `Sim.tick()`.
 */
export class Economy {
  private readonly depots: DepotState[] = [];
  private readonly byPiece = new Map<number, DepotState>();
  private readonly cargo = new Map<number, CarCargo>();
  /** Coach car id → the people riding it. */
  private readonly riders = new Map<number, Riders>();
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
  /** Trains stopping at kit pieces' stops (a platform's dwell: see `KitStops`). */
  readonly kitStops: KitStops;

  constructor(
    readonly layout: Layout,
    readonly sim: Sim,
  ) {
    this.kitStops = new KitStops(layout, sim);
    sim.speedCap = (train) => this.capFor(train);
  }

  /** Register a depot on a piece. `craneAt` defaults to the middle of the piece's track. */
  addDepot(role: DepotRole, pieceId: number, townId = -1, craneAt?: number): DepotState {
    const p = this.layout.getPiece(pieceId);
    const len = p ? pathLength(getPieceDef(p.type, p.flipped).paths[0].geom) : 216;
    const d: DepotState = { id: this.depots.length, pieceId, role, townId, auto: true, waitFull: false, piles: new Int32Array(CARGO_KINDS.length), timer: 0, rate: 1, craneAt: craneAt ?? len / 2, waiting: 0, sheds: 0 };
    // An endless heap is full from the start.
    if (RECIPES[role].endless) for (const k of RECIPES[role].gives) d.piles[CARGO[k].index] = capAt(d);
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
    if (count <= 0 || kind === null) {
      this.cargo.delete(carId);
      this.landedFrom.delete(carId);
    } else this.cargo.set(carId, { kind, count: Math.min(count, this.wagonCapacity) });
  }

  ridersOf(carId: number): Readonly<Riders> {
    return this.riders.get(carId) ?? NO_RIDERS;
  }

  /** Put people straight onto a coach (saves, tests): `count` who got on at depot `from`. */
  setRiders(carId: number, count: number, from: number): void {
    if (count <= 0) this.riders.delete(carId);
    else this.riders.set(carId, { count, from });
  }

  /**
   * Seats in a car (Game mode sets it: coaches by their look). Null, or 0 seats: it carries no one, and trains don't
   * stop at stations for it (Sandbox).
   */
  seatsOf: ((carId: number) => number) | null = null;

  /** Someone got off a coach at station `to`, having got on at `from` (Game mode pays their fare). */
  onAlight: ((from: DepotState, to: DepotState, carId: number) => void) | null = null;

  /** Would someone on this coach get off here: a town's station other than where they got on (a stop to drop at)? */
  private canAlight(d: DepotState, carId: number): boolean {
    const r = this.riders.get(carId);
    if (!r || d.role !== "town" || r.from === d.id) return false;
    const route = this.routeOfCar(carId);
    return !route || stopAt(route, d.id, "drop");
  }

  /** Would someone waiting here get on this coach: a free seat, and no one aboard bound from elsewhere? */
  private canBoard(d: DepotState, carId: number): boolean {
    if (d.role !== "town" || d.waiting <= 0 || !this.seatsOf) return false;
    const r = this.riders.get(carId);
    if (r && (r.from !== d.id || r.count >= this.seatsOf(carId))) return false;
    if (!r && this.seatsOf(carId) <= 0) return false;
    const route = this.routeOfCar(carId);
    return !route || stopAt(route, d.id, "pick");
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
    return (r.takes.includes(kind) || r.gives.includes(kind)) && d.piles[CARGO[kind].index] < capAt(d);
  }

  /** Can this car take one more unit of `kind`? */
  carAccepts(carId: number, kind: CargoKind): boolean {
    const found = this.sim.findCar(carId);
    if (!found || !canCarry(found.train.cars[found.index].kind, kind)) return false;
    const c = this.cargoOf(carId);
    return c.count < this.wagonCapacity && (c.kind === null || c.kind === kind);
  }

  /**
   * Where a unit tapped (not dragged) goes: from a depot's pile onto a wagon standing beside it (one already part
   * filled with it first, then the nearest the crane), or from a wagon onto the pile of a depot it stands at. Null
   * when there's nowhere it can go.
   */
  tapTarget(from: CargoSlot): CargoSlot | null {
    if (from.kind === "pile") {
      const d = this.depots[from.depotId];
      if (!d || d.piles[CARGO[from.cargo].index] <= 0) return null;
      const kind = from.cargo;
      let best: { carId: number; score: number } | null = null;
      for (const id of this.sim.trainIds()) {
        const train = this.sim.getTrain(id);
        if (!train || train.derailed) continue;
        for (let c = 0; c < train.cars.length; c++) {
          const car = train.cars[c];
          const front = train.bogies[2 * c];
          const rear = train.bogies[2 * c + 1];
          if (front.pieceId !== d.pieceId && rear.pieceId !== d.pieceId) continue;
          if (!this.carAccepts(car.id, kind)) continue;
          // Top up a part-filled wagon before starting another; then the one nearest the crane.
          const started = this.cargoOf(car.id).count > 0 ? 0 : 1000;
          const len = this.depotLength(d);
          const at = front.pieceId === d.pieceId && rear.pieceId === d.pieceId ? (along(front, len) + along(rear, len)) / 2 : front.pieceId === d.pieceId ? along(front, len) : along(rear, len);
          const score = started + Math.abs(at - d.craneAt);
          if (!best || score < best.score) best = { carId: car.id, score };
        }
      }
      return best ? { kind: "car", carId: best.carId } : null;
    }
    const c = this.cargoOf(from.carId);
    const found = this.sim.findCar(from.carId);
    if (c.kind === null || c.count <= 0 || !found) return null;
    const kind = c.kind;
    const train = found.train;
    // A depot under this wagon, else under the rest of its train.
    const under = [train.bogies[2 * found.index], train.bogies[2 * found.index + 1], ...train.bogies];
    for (const b of under) {
      const d = this.byPiece.get(b.pieceId);
      if (d && this.pileAccepts(d, kind)) return { kind: "pile", depotId: d.id, cargo: kind };
    }
    return null;
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
    if (slot.kind === "pile") {
      const d = this.depots[slot.depotId];
      if (!RECIPES[d.role].endless) d.piles[CARGO[kind].index]--;
    } else this.setCargo(slot.carId, kind, this.cargoOf(slot.carId).count - 1);
  }

  private put(slot: CargoSlot, kind: CargoKind): void {
    if (slot.kind === "pile") {
      const d = this.depots[slot.depotId];
      if (RECIPES[d.role].sink) return;
      d.piles[CARGO[kind].index] = Math.min(capAt(d), d.piles[CARGO[kind].index] + 1);
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
    const landed = this.landed.get(d.id);
    if (landed && landed[CARGO[kind].index] > 0) {
      landed[CARGO[kind].index]--;
      // The car carries landed goods away: it doesn't hand them back here.
      this.landedFrom.set(carId, d.id);
    }
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
    for (const k in cycle.makes) if (d.piles[CARGO[k as CargoKind].index] + cycle.makes[k as CargoKind]! > capAt(d)) return false;
    return true;
  }

  /** Would the crane do anything for this car at this depot? */
  needsService(d: DepotState, carId: number): boolean {
    const found = this.sim.findCar(carId);
    if (!found) return false;
    if (found.train.cars[found.index].kind === "passenger") return this.canAlight(d, carId) || this.canBoard(d, carId);
    if (!canCarry(found.train.cars[found.index].kind)) return false;
    return this.canUnload(d, carId) || this.loadKind(d, carId) !== null || this.waitsForLoad(d, carId);
  }

  private canUnload(d: DepotState, carId: number): boolean {
    const c = this.cargoOf(carId);
    if (c.kind === null || c.count <= 0 || !RECIPES[d.role].takes.includes(c.kind)) return false;
    // Goods landed here for trains to take away aren't taken back (from any car, nor a car that took them here).
    if ((this.landed.get(d.id)?.[CARGO[c.kind].index] ?? 0) > 0 || this.landedFrom.get(carId) === d.id) return false;
    if (this.accepts) {
      if (!this.accepts(d, c.kind)) return false;
      // What a town still wants it takes in even with its platform's pile full (it's counted, not stacked).
      if (d.role !== "town" && d.piles[CARGO[c.kind].index] >= capAt(d)) return false;
    } else if (d.piles[CARGO[c.kind].index] >= capAt(d)) return false;
    // A routed train drops goods only at its stops that say so.
    const route = this.routeOfCar(carId);
    if (route) return stopAt(route, d.id, "drop");
    // Goods kept for a workshop: an unrouted train carries them on past the towns.
    if (d.role === "town" && this.reserved?.(c.kind)) return false;
    return !RECIPES[d.role].routedOnly;
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

  /**
   * May this car's train pick up goods at this depot? A routed train only at its stops that say so (at a warehouse,
   * only where it says Pick up); an unrouted one anywhere but a warehouse.
   */
  private picksUpAt(d: DepotState, carId: number): boolean {
    const route = this.routeOfCar(carId);
    if (!route) return !RECIPES[d.role].routedOnly;
    return stopAt(route, d.id, "pick") && !(RECIPES[d.role].routedOnly && stopAt(route, d.id, "drop"));
  }

  /** What the crane would load onto this car here: goods the depot gives, the car carries and has room for, or null. */
  private loadKind(d: DepotState, carId: number): CargoKind | null {
    const c = this.cargoOf(carId);
    if (c.count >= this.wagonCapacity) return null;
    if (!this.picksUpAt(d, carId)) return null;
    const found = this.sim.findCar(carId);
    if (!found) return null;
    const car = found.train.cars[found.index].kind;
    let best: CargoKind | null = null;
    let fewest = Infinity;
    for (const k of this.givesAt(d)) {
      if ((c.kind !== null && c.kind !== k) || !canCarry(car, k) || d.piles[CARGO[k].index] <= 0) continue;
      if (c.kind !== null) return k;
      // An empty wagon takes the good its train carries least of: a train of hoppers at a mine takes coal and ore both.
      let n = 0;
      for (const other of found.train.cars) if (this.cargo.get(other.id)?.kind === k) n++;
      if (n < fewest) {
        best = k;
        fewest = n;
      }
    }
    return best;
  }

  /**
   * With "wait for a full load", a wagon that could take more of the depot's goods waits for them, but only while
   * more are coming: goods on the pile, or the depot making them. (A sawmill out of logs isn't, so a train never waits
   * there for planks that would need the logs on its own later wagons.) Not while another wagon still has goods to
   * unload here: that goes first (the wagon waits its turn again once the crane is done with the others). Nor where
   * its train may not pick up (a routed train's Drop stop, or a depot that isn't one of its stops).
   */
  private waitsForLoad(d: DepotState, carId: number): boolean {
    const c = this.cargoOf(carId);
    if (!d.waitFull || c.count >= this.wagonCapacity || this.canUnload(d, carId) || !this.picksUpAt(d, carId)) return false;
    const found = this.sim.findCar(carId);
    if (!found) return false;
    const done = this.services.get(found.train.id)?.done;
    if (found.train.cars.some((o) => o.id !== carId && !done?.has(o.id) && this.canUnload(d, o.id))) return false;
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
    for (const s of this.services.values()) if (s.phase === HALTED && s.depotId === depotId) return s.ticks / this.craneTicks;
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
      out.phase = s.ticks / this.craneTicks;
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

  /**
   * Counts trains halting, at a depot's crane or a kit's stop: it changes when one halts (a train standing still
   * changes nothing the frame loop sees otherwise; a kit's moving parts start then).
   */
  get halts(): number {
    return this.depotHalts + this.kitStops.halts;
  }
  private depotHalts = 0;

  /** Is a train standing at this piece now: at its depot's crane (working on it), or at its kit's stop? */
  standingAt(pieceId: number): boolean {
    if (this.kitStops.haltedAt(pieceId)) return true;
    const d = this.byPiece.get(pieceId);
    return !!d && this.cranePhase(d.id) >= 0;
  }

  /** The depot whose crane is working this train now (it's crawling to, or halted at, the crane), if any. */
  servingDepot(trainId: number): DepotState | undefined {
    const s = this.services.get(trainId);
    return s && s.phase !== NONE && s.depotId !== -1 ? this.depots[s.depotId] : undefined;
  }

  /**
   * What the crane is doing for this train at this depot, as far as its cars still need: unloading (goods it takes,
   * riders getting off) and/or loading (goods it may pick up, riders getting on). With nothing left to do (a moment
   * as it finishes), what the depot does that this train may have done: a Drop stop only unloads.
   */
  workFor(trainId: number, d: DepotState): { load: boolean; unload: boolean } | null {
    const train = this.sim.getTrain(trainId);
    if (!train) return null;
    const left = this.workLeft(train, d);
    if (left.load || left.unload) return left;
    const route = this.routeOfTrain(train);
    const r = RECIPES[d.role];
    return {
      load: r.gives.length > 0 && (route ? stopAt(route, d.id, "pick") : !r.routedOnly),
      unload: r.takes.length > 0 && (route ? stopAt(route, d.id, "drop") : true),
    };
  }

  /** Has the crane anything left to do for this train at this depot (this visit)? */
  hasWorkAt(trainId: number, d: DepotState): boolean {
    const train = this.sim.getTrain(trainId);
    if (!train) return false;
    const left = this.workLeft(train, d);
    return left.load || left.unload;
  }

  /** What the crane has left to do for this train's cars at this depot (this visit). */
  private workLeft(train: Train, d: DepotState): { load: boolean; unload: boolean } {
    const done = this.services.get(train.id)?.done;
    let load = false;
    let unload = false;
    for (const car of train.cars) {
      if (done?.has(car.id)) continue;
      if (car.kind === "passenger") {
        unload ||= this.canAlight(d, car.id);
        load ||= this.canBoard(d, car.id);
      } else if (canCarry(car.kind)) {
        unload ||= this.canUnload(d, car.id);
        load ||= this.loadKind(d, car.id) !== null || this.waitsForLoad(d, car.id);
      }
    }
    return { load, unload };
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
   * The sim's speed limit for a powered train: a depot's (see `depotCap`), and a kit's stop's (a platform: see
   * `KitStops`), whichever is lower.
   */
  private capFor(train: Train): number {
    const depot = this.depotCap(train);
    return depot === 0 ? 0 : Math.min(depot, this.kitStops.cap(train));
  }

  /**
   * The speed limit a depot puts on a powered train: on an automatic depot where one of its wagons has work, crawl,
   * and slow so the next wagon needing the crane stops exactly under it, then hold it there (0) while the crane works.
   * A train with nothing to do there runs through at full speed.
   */
  private depotCap(train: Train): number {
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
    // Reversing the lever sends the train on: nothing more for it here this visit (and it isn't being worked).
    if (this.drive(train) < 0) {
      for (const car of train.cars) s.done.add(car.id);
      s.phase = NONE;
      return Infinity;
    }
    if (s.phase === HALTED) return 0;
    // Nothing for the crane in this train (this visit): it won't stop, so it needn't slow (nor is it being worked:
    // `servingDepot`).
    if (!train.cars.some((car) => !s.done.has(car.id) && this.needsService(d, car.id))) {
      s.phase = NONE;
      return Infinity;
    }
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
    if (s.phase !== HALTED) this.depotHalts++;
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
      // People get off a coach, then on, by themselves (no crane).
      const alight = this.canAlight(d, s.carId);
      if (alight || this.canBoard(d, s.carId)) {
        if (++s.ticks < RIDER_TICKS) continue;
        s.ticks = 0;
        const r = this.riders.get(s.carId);
        if (alight) {
          const from = this.depots[r!.from];
          this.setRiders(s.carId, r!.count - 1, r!.from);
          if (from) this.onAlight?.(from, d, s.carId);
        } else {
          d.waiting--;
          this.setRiders(s.carId, (r?.count ?? 0) + 1, d.id);
        }
        continue;
      }
      if (!this.canUnload(d, s.carId) && this.loadKind(d, s.carId) === null) {
        if (this.waitsForLoad(d, s.carId)) continue;
        s.done.add(s.carId);
        // Unloading done: the wagons that stood aside for it can wait for their load now.
        for (const car of train.cars) if (car.id !== s.carId && s.done.has(car.id) && this.waitsForLoad(d, car.id)) s.done.delete(car.id);
        s.phase = CRAWLING;
        s.ticks = 0;
        continue;
      }
      if (++s.ticks < this.craneTicks) continue;
      s.ticks = 0;
      // A grab crane lifts more than one load a move (while there's more to move).
      for (let n = 0; n < this.craneLoads; n++) {
        if (this.canUnload(d, s.carId)) {
          this.events.push({ kind: "unloaded", depotId: d.id, cargo: this.cargoOf(s.carId).kind! });
          this.unloadOne(d, s.carId);
        } else if (this.loadKind(d, s.carId) !== null) {
          this.events.push({ kind: "loaded", depotId: d.id, cargo: this.loadKind(d, s.carId)! });
          this.loadOne(d, s.carId);
        } else break;
        this.loadsMoved++;
      }
    }
  }

  /** One sim tick of production, use and crane work (and trains' dwells at kits' stops). */
  tick(): void {
    this.work();
    this.kitStops.tick();
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
      for (const k in cycle.makes) {
        d.piles[CARGO[k as CargoKind].index] += cycle.makes[k as CargoKind]!;
        this.made[CARGO[k as CargoKind].index] += cycle.makes[k as CargoKind]!;
      }
    }
  }

  /**
   * A mode's say in what a depot takes from trains, beyond its recipe (Game mode: a town takes only what it still
   * wants for its next level, so the rest rides on to the next town). Null: everything its recipe takes.
   */
  accepts: ((d: DepotState, kind: CargoKind) => boolean) | null = null;

  /**
   * Goods a mode keeps for a workshop (Game mode: planks, while the workshop is short of what the cheapest blueprint
   * on the board needs): towns don't take them from unrouted trains, which carry them on to the workshop.
   */
  reserved: ((kind: CargoKind) => boolean) | null = null;

  /**
   * Goods landed at a depot for trains to take away (Game mode: what a boat brought to a harbour), by depot id and
   * cargo index. A depot gives these as well as its recipe's goods.
   */
  readonly landed = new Map<number, Int32Array>();
  /** Cars carrying goods landed at a depot, by car id: the depot they came from (they're not unloaded back there). */
  readonly landedFrom = new Map<number, number>();

  /** Land `n` of `kind` on a depot's pile for trains to take away. */
  land(d: DepotState, kind: CargoKind, n: number): void {
    let l = this.landed.get(d.id);
    if (!l) this.landed.set(d.id, (l = new Int32Array(CARGO_KINDS.length)));
    l[CARGO[kind].index] += n;
    d.piles[CARGO[kind].index] += n;
  }

  /** The goods a depot gives trains: its recipe's, and any landed there. */
  private givesAt(d: DepotState): readonly CargoKind[] {
    const l = this.landed.get(d.id);
    if (!l) return RECIPES[d.role].gives;
    return [...RECIPES[d.role].gives, ...CARGO_KINDS.filter((k) => l[CARGO[k].index] > 0 && !RECIPES[d.role].gives.includes(k))];
  }

  /** Ticks a crane takes to move a load (Game mode's quicker cranes make it shorter). */
  craneTicks = CRANE_TICKS;
  /** Units a wagon holds (Game mode's heavy wagons, from the smithy: more). */
  wagonCapacity = WAGON_CAPACITY;
  /** Loads a crane moves at once (grab cranes: two). */
  craneLoads = 1;
  /** Units of each good made at industries, by cargo index, since this economy began (counters for Game mode). */
  readonly made = new Int32Array(CARGO_KINDS.length);
  /** Loads the cranes have moved, since this economy began. */
  loadsMoved = 0;

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
        // Left it: on past it, and past any stops after it at the same depot (they were the same visit).
        r.at = false;
        for (let k = 0; k < r.stops.length; k++) {
          r.next = (r.next + 1) % r.stops.length;
          if (r.stops[r.next].depotId !== stop.depotId) break;
        }
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
    for (const id of this.riders.keys()) if (!this.sim.findCar(id)) this.riders.delete(id);
    for (const id of this.routes.keys()) if (!this.sim.findCar(id)) this.routes.delete(id);
    for (const id of this.services.keys()) if (!this.sim.getTrain(id)) this.services.delete(id);
    this.kitStops.prune();
  }
}


/** Is depot `depotId` a stop on `route` where the train may `act` (drop or pick up)? */
/**
 * Does a routed train `act` at this depot now? Only at the stop it's heading for (with any stops right after it at
 * the same depot: one visit), so goods picked up for a later stop aren't dropped at another on the way.
 */
function stopAt(route: Route, depotId: number, act: "drop" | "pick"): boolean {
  const n = route.stops.length;
  for (let k = 0; k < n; k++) {
    const s = route.stops[(route.next + k) % n];
    if (s.depotId !== depotId) return false;
    if (s.action === "both" || s.action === act) return true;
  }
  return false;
}

/** Ticks in one cycle of `seconds` at `rate` (whole ticks, so production stays in step with the sim). */
function cycleTicks(seconds: number, rate: number): number {
  return Math.max(1, Math.round(ticks(seconds) / rate));
}

/** A cursor's distance from its path's `from` end. */
function along(c: Cursor, len: number): number {
  return c.reversed ? len - c.s : c.s;
}
