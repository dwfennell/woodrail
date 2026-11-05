import { CARGO_KINDS, canCarry, type CargoKind } from "../economy";
import { SURF_SEA, type Landscape } from "../landscape";
import type { Pose } from "../track";
import { depotPoint } from "./harbours";
import type { Progress } from "./progress";
import { PRICES } from "./towns";
import type { World } from "./world";

/**
 * The train ferry abroad (Game mode's Train ferry; docs/superpowers/specs/2026-11-04-water-transport.md §5, choice E1):
 * a ferry slip on the shore, its track ending at the sea's edge. A train routed there that stands at the slip's end
 * goes aboard: held where it is (`Economy.held`) and drawn on the ferry's deck instead, its load sold abroad at a town's
 * full price. The ferry sails out to sea, stays a while abroad, and comes back; the train comes off with its wagons
 * full of goods from abroad (paid for at a town's price, as many as the coins go to), and runs on along its route.
 * Nothing in the sim moves for the trip: the train stands still the while, so routing needs no ferry of its own.
 */

/** The slip's line is this long; the ferry ties up past its end. */
export const SLIP_LENGTH = 216;
/** Where the ferry ties up: its middle this far along the slip's line (past its end), on the line. */
export const FERRY_AT = SLIP_LENGTH + 60 + 162;
/** Seconds the ferry takes to sail out to sea (and back). */
export const FERRY_SAIL = 15;
/** Seconds it's away abroad between. */
export const FERRY_AWAY = 60;
/** How far out it sails (mm, on along the slip's line). */
export const FERRY_OUT = 1400;
/** Goods from abroad, the dearest first: a wagon comes back full of the first it can carry. */
export const IMPORTS: readonly CargoKind[] = ["tools", "furniture", "iron", "bricks", "flour", "planks", "milk", "coal", "stone", "grain", "log"];

export type FerryPhase = "in" | "out" | "away" | "back";

export interface FerryTrip {
  /** The slip's depot. */
  slip: number;
  phase: FerryPhase;
  /** Seconds into this phase. */
  t: number;
  /** The train aboard: its cars' ids, front to back (empty while it waits at the slip). */
  cars: number[];
}

export type FerryEvent =
  /** A train went aboard: what its load fetched abroad. */
  | { kind: "boarded"; slip: number; engine: number; coins: number; sold: number }
  /** It came back: the goods it brought, and what they cost. */
  | { kind: "landed"; slip: number; engine: number; goods: Partial<Record<CargoKind, number>>; coins: number };

/** Why a ferry slip can't stand here (its end must be at the sea), or null. */
export function slipWhy(land: Landscape, pose: Pose): string | null {
  const g = land.grid;
  let sea = 0;
  // (Past its end, along its line: the ferry's berth. A drop a square short of the water still finds it.)
  for (const t of [SLIP_LENGTH + 40, SLIP_LENGTH + 110, SLIP_LENGTH + 180, SLIP_LENGTH + 250]) {
    const p = depotPoint(pose, t, 0);
    const cell = g.cellAtWorld(p.x, p.z);
    if (cell !== -1 && g.surface[cell] === SURF_SEA) sea++;
  }
  return sea >= 2 ? null : "A ferry slip goes on the shore, its end at the open sea";
}

/** Where the ferry is on a trip (world) and which way it faces: tied up at its slip, or out to sea along the slip's line. */
export function ferryPose(pose: Pose, trip: FerryTrip | null, extra = 0): { x: number; z: number; heading: number; shown: boolean } {
  const at = depotPoint(pose, FERRY_AT, 0);
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  if (!trip || trip.phase === "in") return { ...at, heading: pose.heading, shown: true };
  const u = trip.phase === "away" ? 1 : Math.min(1, (trip.t + extra) / FERRY_SAIL);
  // Eased: getting going, slowing to the slip.
  const f = trip.phase === "out" ? u * u : trip.phase === "back" ? 1 - (1 - u) * (1 - u) : 1;
  const d = trip.phase === "back" ? FERRY_OUT * (1 - f) : FERRY_OUT * f;
  return { x: at.x + c * d, z: at.z + s * d, heading: pose.heading, shown: trip.phase !== "away" };
}

/** The ferries' trips, by slip: one train at a time each. Ticked once a second of play, as the boats are. Not saved. */
export class Ferries {
  private readonly trips = new Map<number, FerryTrip>();
  /** Cars just back from abroad, by the slip they came off at: not taken again till their train has left it. */
  private readonly back = new Map<number, number>();

  /** The trip at a slip, or null (the ferry tied up there, waiting). */
  tripAt(slip: number): FerryTrip | null {
    return this.trips.get(slip) ?? null;
  }

  /** Every trip under way. */
  all(): FerryTrip[] {
    return [...this.trips.values()];
  }

  /** The trip a car is on (it's aboard, abroad), or null. */
  tripOf(carId: number): FerryTrip | null {
    for (const t of this.trips.values()) if (t.cars.includes(carId)) return t;
    return null;
  }

  /** A new map: nothing aboard (a train held is let go). */
  reset(world: World): void {
    for (const t of this.trips.values()) for (const c of t.cars) world.economy.held.delete(c);
    this.trips.clear();
    this.back.clear();
  }

  tick(world: World, p: Progress, seconds: number): FerryEvent[] {
    const events: FerryEvent[] = [];
    const { economy, sim, layout } = world;
    for (const d of economy.allDepots()) {
      if (d.role !== "slip" || !layout.getPiece(d.pieceId)) continue;
      const trip = this.trips.get(d.id);
      if (!trip) {
        // (A ferry for each slip, built at a shipyard: a slip with none waiting has trains wait.)
        if (this.trips.size >= economy.ferriesBuilt) continue;
        // A train routed here, standing on the slip: aboard.
        const train = this.trainAt(world, d.id, d.pieceId);
        if (!train) continue;
        const cars = train.cars.map((c) => c.id);
        let coins = 0;
        let sold = 0;
        for (const c of cars) {
          const load = economy.cargoOf(c);
          if (!load.kind || load.count <= 0) continue;
          coins += (PRICES[load.kind] ?? 0) * load.count;
          sold += load.count;
          economy.setCargo(c, null, 0);
        }
        p.coins += coins;
        for (const c of cars) economy.held.add(c);
        this.trips.set(d.id, { slip: d.id, phase: "out", t: 0, cars });
        events.push({ kind: "boarded", slip: d.id, engine: cars.find((c) => sim.findCar(c)?.train.cars.find((x) => x.id === c)?.kind === "engine") ?? cars[0], coins, sold });
        continue;
      }
      trip.t += seconds;
      const length = trip.phase === "away" ? FERRY_AWAY : FERRY_SAIL;
      if (trip.t < length) continue;
      trip.t = 0;
      if (trip.phase === "out") trip.phase = "away";
      else if (trip.phase === "away") trip.phase = "back";
      else {
        // Back: the train comes off with goods from abroad, and goes on its way.
        const goods: Partial<Record<CargoKind, number>> = {};
        let coins = 0;
        let engine = trip.cars[0];
        for (const id of trip.cars) {
          const car = sim.findCar(id);
          if (!car) continue;
          const kind = car.train.cars[car.index].kind;
          if (kind === "engine") engine = id;
          const good = IMPORTS.find((k) => canCarry(kind, k) && economy.cargoOf(id).count === 0);
          if (!good) continue;
          const price = PRICES[good] ?? 0;
          const n = price > 0 ? Math.min(economy.wagonCapacity, Math.floor((p.coins - coins) / price)) : economy.wagonCapacity;
          if (n <= 0) continue;
          economy.setCargo(id, good, n);
          goods[good] = (goods[good] ?? 0) + n;
          coins += n * price;
        }
        p.coins -= coins;
        for (const c of trip.cars) {
          economy.held.delete(c);
          this.back.set(c, d.pieceId);
        }
        this.trips.delete(d.id);
        events.push({ kind: "landed", slip: d.id, engine, goods, coins });
      }
    }
    // Trains back from abroad that have left their slip (or gone): they may go again.
    for (const [car, piece] of this.back) {
      const t = sim.findCar(car)?.train;
      if (!t || !t.bogies.some((b) => b.pieceId === piece)) this.back.delete(car);
    }
    // A slip taken up with a train aboard: it's let go where it stands.
    for (const [slip, trip] of this.trips) {
      const d = economy.depot(slip);
      if (d && layout.getPiece(d.pieceId)) continue;
      for (const c of trip.cars) economy.held.delete(c);
      this.trips.delete(slip);
    }
    return events;
  }

  /** A train standing on the slip's piece whose route calls at the slip (one going nowhere else isn't taken). */
  private trainAt(world: World, slip: number, pieceId: number) {
    const { economy, sim } = world;
    for (const id of sim.trainIds()) {
      const t = sim.getTrain(id)!;
      if (Math.abs(t.speed) > 1 || !t.bogies.some((b) => b.pieceId === pieceId)) continue;
      if (t.cars.some((c) => this.tripOf(c.id) || this.back.has(c.id))) continue;
      const routed = t.cars.some((c) => c.kind === "engine" && economy.routeOf(c.id)?.stops.some((s) => s.depotId === slip));
      if (routed) return t;
    }
    return null;
  }
}

/** Every good a trip could bring (for tests and the card). */
export const IMPORTABLE: readonly CargoKind[] = CARGO_KINDS.filter((k) => IMPORTS.includes(k));
