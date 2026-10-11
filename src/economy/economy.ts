import { getPieceDef, pathLength, type Layout } from "../track";
import { SIM_DT, type Cursor, type Sim, type Train } from "../sim";
import { CARGO, canCarry, type CargoKind } from "./cargo";
import { CRANE_TICKS, CRAWL_SPEED, FOREST_TICKS, PILE_CAP, SAWMILL_TICKS, TOWN_USE_TICKS, WAGON_CAPACITY } from "./constants";

const NONE = 0;
const CRAWLING = 1;
const HALTED = 2;
/** A wagon centre this close to the crane point (mm) counts as under the crane. */
const AT_CRANE = 0.5;

/** One train's visit to a depot. Allocated once per train and reused. */
interface Service {
  phase: number;
  depotId: number;
  /** The car under the crane while halted. */
  carId: number;
  /** Ticks into the current crane move. */
  ticks: number;
  /** Cars already served (or sent on) during this visit. */
  readonly done: Set<number>;
}

export type DepotRole = "forest" | "sawmill" | "town";

/** What a depot takes from trains and what it gives them. */
export const ROLE: Record<DepotRole, { takes: CargoKind | null; gives: CargoKind | null }> = {
  forest: { takes: null, gives: "log" },
  sawmill: { takes: "log", gives: "planks" },
  town: { takes: "planks", gives: null },
};

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
  /** Where wagons stop for the crane: distance (mm) from the depot path's `from` end. */
  readonly craneAt: number;
}

export interface CarCargo {
  kind: CargoKind | null;
  count: number;
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
  /** Town id → plank bundles delivered there (by train or by hand). */
  readonly delivered = new Map<number, number>();
  private readonly services = new Map<number, Service>();

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
    const d: DepotState = { id: this.depots.length, pieceId, role, townId, auto: true, waitFull: false, piles: new Int32Array(2), timer: 0, craneAt: craneAt ?? len / 2 };
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
    const r = ROLE[d.role];
    return (r.takes === kind || r.gives === kind) && d.piles[CARGO[kind].index] < PILE_CAP;
  }

  /** Can this car take one more unit of `kind`? */
  carAccepts(carId: number, kind: CargoKind): boolean {
    const found = this.sim.findCar(carId);
    if (!found || !canCarry(found.train.cars[found.index].kind)) return false;
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
    const kind = ROLE[d.role].gives!;
    this.take({ kind: "pile", depotId: d.id, cargo: kind }, kind);
    this.put({ kind: "car", carId }, kind);
  }

  /** Does this depot's sawmill have a log to cut and room for the planks? (Its saw spins while true.) */
  working(d: DepotState): boolean {
    if (d.role === "sawmill") return d.piles[CARGO.log.index] > 0 && d.piles[CARGO.planks.index] < PILE_CAP;
    if (d.role === "forest") return d.piles[CARGO.log.index] < PILE_CAP;
    return d.piles[CARGO.planks.index] > 0;
  }

  /** Would the crane do anything for this car at this depot? */
  needsService(d: DepotState, carId: number): boolean {
    const found = this.sim.findCar(carId);
    if (!found || !canCarry(found.train.cars[found.index].kind)) return false;
    return this.canUnload(d, carId) || this.canLoad(d, carId) || this.waitsForLoad(d, carId);
  }

  private canUnload(d: DepotState, carId: number): boolean {
    const takes = ROLE[d.role].takes;
    const c = this.cargoOf(carId);
    return takes !== null && c.kind === takes && c.count > 0 && d.piles[CARGO[takes].index] < PILE_CAP;
  }

  private canLoad(d: DepotState, carId: number): boolean {
    const gives = ROLE[d.role].gives;
    const c = this.cargoOf(carId);
    return gives !== null && (c.kind === null || c.kind === gives) && c.count < WAGON_CAPACITY && d.piles[CARGO[gives].index] > 0;
  }

  /** With "wait for a full load", a wagon that could take more of the depot's goods waits for them. */
  private waitsForLoad(d: DepotState, carId: number): boolean {
    const gives = ROLE[d.role].gives;
    const c = this.cargoOf(carId);
    return d.waitFull && gives !== null && (c.kind === null || c.kind === gives) && c.count < WAGON_CAPACITY && !this.canUnload(d, carId);
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
   * way), the car, and progress 0–1. Null when the crane is idle or waiting.
   */
  craneMove(depotId: number): { kind: CargoKind; toPile: boolean; carId: number; phase: number } | null {
    for (const s of this.services.values()) {
      if (s.phase !== HALTED || s.depotId !== depotId || s.ticks === 0) continue;
      const d = this.depots[depotId];
      if (this.canUnload(d, s.carId)) return { kind: this.cargoOf(s.carId).kind!, toPile: true, carId: s.carId, phase: s.ticks / CRANE_TICKS };
      if (this.canLoad(d, s.carId)) return { kind: ROLE[d.role].gives!, toPile: false, carId: s.carId, phase: s.ticks / CRANE_TICKS };
    }
    return null;
  }

  private service(trainId: number): Service {
    let s = this.services.get(trainId);
    if (!s) this.services.set(trainId, (s = { phase: NONE, depotId: -1, carId: -1, ticks: 0, done: new Set() }));
    return s;
  }

  /** The automatic depot under any of this train's axles, if any. */
  private depotUnder(train: Train): DepotState | undefined {
    for (const b of train.bogies) {
      const d = this.byPiece.get(b.pieceId);
      if (d && d.auto) return d;
    }
    return undefined;
  }

  /**
   * The sim's speed limit for a powered train: crawl on an automatic depot, and slow so the next wagon needing the
   * crane stops exactly under it, then hold it there (0) while the crane works.
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
    s.phase = CRAWLING;
    let cap = CRAWL_SPEED;
    const len = this.depotLength(d);
    const crane = d.craneAt;
    for (let c = 0; c < train.cars.length; c++) {
      const car = train.cars[c];
      if (s.done.has(car.id) || !this.needsService(d, car.id)) continue;
      const front = train.bogies[2 * c];
      const rear = train.bogies[2 * c + 1];
      if (front.pieceId !== d.pieceId || rear.pieceId !== d.pieceId) continue;
      // Distance still to go before the car's centre is under the crane.
      const centre = (along(front, len) + along(rear, len)) / 2;
      const ahead = (crane - centre) * (front.reversed ? -1 : 1);
      if (ahead < -AT_CRANE) {
        s.done.add(car.id); // it rolled past: leave it be
        continue;
      }
      if (ahead <= AT_CRANE) {
        s.phase = HALTED;
        s.carId = car.id;
        s.ticks = 0;
        return 0;
      }
      if (ahead / SIM_DT < cap) cap = ahead / SIM_DT;
    }
    return cap;
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
    s.done.clear();
  }

  /** Crane work for every halted train: one unit per move, unloading before loading. */
  private work(): void {
    for (const [trainId, s] of this.services) {
      if (s.phase !== HALTED) continue;
      const train = this.sim.getTrain(trainId);
      const d = this.depots[s.depotId];
      if (!train || train.derailed || !d || !d.auto || !this.sim.findCar(s.carId)) {
        this.endVisit(s);
        continue;
      }
      // Lever off: the train stays put and the crane stops; it carries on when the train is set going again.
      if (this.drive(train) === 0) {
        s.phase = CRAWLING;
        s.ticks = 0;
        continue;
      }
      if (!this.canUnload(d, s.carId) && !this.canLoad(d, s.carId)) {
        if (this.waitsForLoad(d, s.carId)) continue;
        s.done.add(s.carId);
        s.phase = CRAWLING;
        s.ticks = 0;
        continue;
      }
      if (++s.ticks < CRANE_TICKS) continue;
      s.ticks = 0;
      if (this.canUnload(d, s.carId)) this.unloadOne(d, s.carId);
      else this.loadOne(d, s.carId);
    }
  }

  /** One sim tick of production, use and crane work. */
  tick(): void {
    this.work();
    for (const d of this.depots) {
      if (!this.working(d)) {
        d.timer = 0;
        continue;
      }
      d.timer++;
      if (d.role === "forest" && d.timer >= FOREST_TICKS) {
        d.piles[CARGO.log.index]++;
        d.timer = 0;
      } else if (d.role === "sawmill" && d.timer >= SAWMILL_TICKS) {
        d.piles[CARGO.log.index]--;
        d.piles[CARGO.planks.index]++;
        d.timer = 0;
      } else if (d.role === "town" && d.timer >= TOWN_USE_TICKS) {
        d.piles[CARGO.planks.index]--;
        d.timer = 0;
      }
    }
  }

  /** Forget cargo on cars, and visits of trains, that no longer exist. */
  prune(): void {
    for (const id of this.cargo.keys()) if (!this.sim.findCar(id)) this.cargo.delete(id);
    for (const id of this.services.keys()) if (!this.sim.getTrain(id)) this.services.delete(id);
  }
}


/** A cursor's distance from its path's `from` end. */
function along(c: Cursor, len: number): number {
  return c.reversed ? len - c.s : c.s;
}
