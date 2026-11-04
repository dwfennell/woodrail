import { SURF_ROAD } from "../landscape";
import { roadAt } from "../roads/graph";
import { VAN_REACH } from "../roads/road-paths";
import { VEHICLE_CAP, type RoadVehicle, type RoadVehicles } from "../roads/vehicles";
import type { Trip, Vans } from "./vans";
import type { World } from "./world";

/**
 * A town's own cars (tech tree 3): the cars a car factory makes, brought to a town by car carrier, drive about its
 * streets. One car once a town has had any, another every `CARS_EVERY` more, up to `CARS_PER_TOWN` (and the map's
 * `VEHICLE_CAP.car`). Each parks on one of the town's streets, rests a while, drives to another of its streets and
 * back, and rests again: life on the roads, nothing carried.
 *
 * On D5's machinery (`Vans`): paths cached by the land, rerouted after a road edit. Cheap and event-driven: the cars
 * are placed again only when what towns have had or the land changed (`sync`); they move in the economy's tick, and
 * the view (`RoadVehiclesView`) asks for frames only while one moves near the camera, in view (`CAR_REACH`).
 */

/** Cars a town has at most. */
export const CARS_PER_TOWN = 2;
/** A town's first car comes with its first delivery of cars; each further one this many deliveries later. */
export const CARS_EVERY = 6;
/** Seconds a car rests on its street between trips. */
export const CAR_REST = 8;
/** How many of a town's streets (nearest its middle first) a car may park on or drive to. */
const STREETS_TRIED = 12;

/** How many cars a town that's had `n` cars delivered has on its streets. */
export function carsFor(n: number): number {
  return n <= 0 ? 0 : Math.min(CARS_PER_TOWN, 1 + Math.floor((n - 1) / CARS_EVERY));
}

export interface CarTrip extends Trip {
  readonly townId: number;
  /** Which of its town's cars (0, 1…): where it parks, and where it goes. */
  readonly k: number;
  /** Trips made: each goes to another street. */
  n: number;
}

export interface CarHost {
  readonly world: World;
  readonly vans: Vans;
  /** Do towns' cars drive (Game mode)? */
  knows(): boolean;
}

export class TownCars {
  private seen = { known: false, revision: -1, towns: -1, delivered: "", economy: null as unknown };
  /** Each town's streets, nearest its middle first (worked out again with the land). */
  private streets = new Map<number, number[]>();

  constructor(private readonly host: CarHost) {
    host.vans.on.car = {
      // Home: rest, then go again.
      home: (v) => this.vehicles.load(v, CAR_REST),
      ready: (v, trip) => this.go(v, trip as CarTrip),
    };
  }

  private get vehicles(): RoadVehicles {
    return this.host.vans.vehicles;
  }

  /** The cars on a town's streets. */
  carsOf(townId: number): RoadVehicle[] {
    return this.vehicles.list.filter((v) => v.kind === "car" && (v.data as CarTrip | null)?.townId === townId);
  }

  /** Place the towns' cars again if what they've had, the land or the towns changed. Call once a second. */
  sync(): void {
    const w = this.host.world;
    const s = this.seen;
    const known = this.host.knows();
    let delivered = "";
    if (known) for (const [id, bag] of w.economy.deliveredGoods) if ((bag.autos ?? 0) > 0) delivered += `${id}:${carsFor(bag.autos ?? 0)},`;
    if (s.economy === w.economy && s.known === known && s.revision === w.landscape.grid.revision && s.towns === w.landscape.towns.length && s.delivered === delivered) return;
    const landChanged = s.revision !== w.landscape.grid.revision || s.towns !== w.landscape.towns.length || s.economy !== w.economy;
    Object.assign(s, { economy: w.economy, known, revision: w.landscape.grid.revision, towns: w.landscape.towns.length, delivered });
    if (landChanged) this.streets.clear();
    const rv = this.vehicles;
    // Parked cars whose town has none now (another mode, a new world) or whose street went, taken away.
    for (const v of [...rv.list]) {
      if (v.kind !== "car") continue;
      const trip = v.data as CarTrip;
      const ok = known && trip.k < carsFor(w.economy.deliveredGoods.get(trip.townId)?.autos ?? 0) && this.streetsOf(trip.townId).includes(trip.home);
      if (!ok && (v.leg === "home" || v.leg === "loading" || !known)) rv.remove(v);
    }
    if (!known) return;
    for (const [townId, bag] of w.economy.deliveredGoods) {
      const want = carsFor(bag.autos ?? 0);
      const have = this.carsOf(townId);
      for (let k = 0; k < want; k++) {
        if (have.some((v) => (v.data as CarTrip).k === k)) continue;
        if (rv.count("car") >= VEHICLE_CAP.car) return;
        const streets = this.streetsOf(townId);
        if (streets.length < 2) break;
        const home = streets[(k * 5) % streets.length];
        const trip: CarTrip = { home, goalKey: "", goal: () => false, reach: VAN_REACH, to: -1, townId, k, n: 0 };
        const v = this.host.vans.park("car", home, trip);
        // (Off at once: the first car is the payoff of the first delivery.)
        if (v) this.go(v, trip);
      }
    }
  }

  /** A town's streets, nearest its middle first: road squares in its cells. */
  private streetsOf(townId: number): number[] {
    let out = this.streets.get(townId);
    if (out) return out;
    const land = this.host.world.landscape;
    const g = land.grid;
    const town = land.towns.find((t) => t.id === townId);
    const near: [number, number][] = [];
    for (const i of town?.cells ?? []) {
      if (g.surface[i] !== SURF_ROAD || roadAt(land, i) === 0) continue;
      near.push([Math.hypot(g.centreX(g.colOf(i)) - town!.centre.x, g.centreZ(g.rowOf(i)) - town!.centre.z), i]);
    }
    near.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    out = near.slice(0, STREETS_TRIED).map(([, i]) => i);
    this.streets.set(townId, out);
    return out;
  }

  /** Send a car to another of its town's streets (the next on its round that a road reaches); else it rests again. */
  private go(v: RoadVehicle, trip: CarTrip): void {
    const streets = this.streetsOf(trip.townId);
    for (let tries = 0; tries < streets.length; tries++) {
      trip.n++;
      const to = streets[(trip.k * 5 + trip.n * 7) % streets.length];
      if (to === trip.home) continue;
      const goal: CarTrip = { ...trip, goalKey: `street${to}`, goal: (i) => i === to };
      if (this.host.vans.send(v, goal)) return;
    }
    this.vehicles.load(v, CAR_REST);
  }
}
