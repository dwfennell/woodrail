import type { Layout } from "../track";
import type { Sim } from "../sim";
import { CARGO, canCarry, type CargoKind } from "./cargo";
import { FOREST_TICKS, PILE_CAP, SAWMILL_TICKS, TOWN_USE_TICKS, WAGON_CAPACITY } from "./constants";

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

  constructor(
    readonly layout: Layout,
    readonly sim: Sim,
  ) {}

  addDepot(role: DepotRole, pieceId: number, townId = -1): DepotState {
    const d: DepotState = { id: this.depots.length, pieceId, role, townId, auto: true, waitFull: false, piles: new Int32Array(2), timer: 0 };
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

  /** One sim tick of production and use. */
  tick(): void {
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

  /** Forget cargo on cars that no longer exist (removed trains). */
  prune(): void {
    for (const id of this.cargo.keys()) if (!this.sim.findCar(id)) this.cargo.delete(id);
  }
}

