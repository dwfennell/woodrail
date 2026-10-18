import type { DepotState } from "../economy";
import type { CarLook } from "../sim";
import type { Progress } from "./progress";
import { townStatus } from "./towns";
import { receivedBy } from "./town-life";
import type { World } from "./world";

/**
 * Game mode's passengers: people wait at each town's station, more the bigger the town; coaches carry them to another
 * town, where they pay a fare by how far they came. The riders you've carried unlock the passenger line of blueprints
 * (see `TECHS`, the ones with `riders`), with no goods to pay.
 */

/** Seats in a coach, by its look. */
export const SEATS: Partial<Record<CarLook, number>> = { classic: 4, dining: 2, sleeper: 4, "double-decker": 8, "first-class": 3 };

/** A first-class coach's riders pay this many times the fare. */
export const FIRST_CLASS = 2;
/** A train with a dining car: every rider on it pays this many times the fare. */
export const DINING = 1.5;

/** A hamlet's station gets someone new waiting this often (s); each level up, as often again. */
export const RIDER_SECONDS = 24;
/** Most people waiting at a station (twice as many, coming twice as often, with busy stations). */
export const WAITING_CAP = 6;

/** Each mm between the two stations is worth this much fare (and never less than `MIN_FARE`). */
const FARE_PER_MM = 1 / 800;
const MIN_FARE = 1;

export function waitingCap(p: Progress): number {
  return p.learned.has("stations") ? WAITING_CAP * 2 : WAITING_CAP;
}

/** Seconds between new people waiting at a town's station, by the town's level (0, a hamlet, up): busy stations, half. */
export function riderSeconds(level: number, busy = false): number {
  return RIDER_SECONDS / (1 + level) / (busy ? 2 : 1);
}

/**
 * People turn up at towns' stations, `seconds` of play at a time. A town's arrivals are shared among its stops (its
 * station and any halts, every depot of role "town" with its `townId`), not added to: one clock and one cap per town,
 * each newcomer going to the stop with the fewest waiting (the earliest, its station, on a tie). So halts spread a
 * town's people out; they don't make more. `clock` holds each town's time since its last arrival, by town id (kept by
 * the caller between calls). Cheap: a few towns, called about once a second.
 */
export function peopleArrive(world: World, p: Progress, seconds: number, clock: Map<number, number>): void {
  // No one waits for coaches that can't be made yet.
  if (!p.learned.has("passengers")) return;
  const cap = waitingCap(p);
  const busy = p.learned.has("stations");
  // Each town's stops, in depot order (its station, added with the map, first).
  const stops = new Map<number, DepotState[]>();
  for (const d of world.economy.allDepots()) {
    if (d.role !== "town" || !world.layout.getPiece(d.pieceId)) continue;
    const list = stops.get(d.townId);
    if (list) list.push(d);
    else stops.set(d.townId, [d]);
  }
  for (const [townId, list] of stops) {
    let waiting = 0;
    for (const d of list) waiting += d.waiting;
    if (waiting >= cap) {
      clock.set(townId, 0);
      continue;
    }
    const every = riderSeconds(townStatus(receivedBy(world, townId)).level, busy);
    let t = (clock.get(townId) ?? 0) + seconds;
    while (t >= every && waiting < cap) {
      t -= every;
      let to = list[0];
      for (const d of list) if (d.waiting < to.waiting) to = d;
      to.waiting++;
      waiting++;
    }
    // A full town doesn't save up people for later.
    clock.set(townId, waiting >= cap ? 0 : t);
  }
}

/** Seats in a car by its look, in Game mode (only coaches have any). */
export function seatsIn(world: World, carId: number): number {
  const found = world.sim.findCar(carId);
  if (!found || found.train.cars[found.index].kind !== "passenger") return 0;
  return SEATS[world.sim.lookOf(carId)] ?? 0;
}

/** One rider's fare from station `from` to station `to`, riding coach `carId`. */
export function fareFor(world: World, from: DepotState, to: DepotState, carId: number): number {
  const a = world.layout.getPiece(from.pieceId)?.pose;
  const b = world.layout.getPiece(to.pieceId)?.pose;
  // Whole coins for the ride, then first class and a dining car on top.
  let fare = a && b ? Math.max(MIN_FARE, Math.round(Math.hypot(a.x - b.x, a.z - b.z) * FARE_PER_MM)) : MIN_FARE;
  const found = world.sim.findCar(carId);
  if (found) {
    if (world.sim.lookOf(carId) === "first-class") fare *= FIRST_CLASS;
    if (found.train.cars.some((c) => c.kind === "passenger" && world.sim.lookOf(c.id) === "dining")) fare *= DINING;
  }
  return Math.round(fare);
}

/** Someone got off: pay their fare and count them. Returns the coins paid. */
export function payFare(world: World, p: Progress, from: DepotState, to: DepotState, carId: number): number {
  const fare = fareFor(world, from, to, carId);
  p.coins += fare;
  p.riders++;
  return fare;
}

/** Put Game mode's passengers into the world's economy (seats and fares). */
export function attachPassengers(world: World, p: () => Progress, paid?: (fare: number, from: DepotState, to: DepotState) => void): void {
  world.economy.seatsOf = (carId) => seatsIn(world, carId);
  world.economy.onAlight = (from, to, carId) => {
    const fare = payFare(world, p(), from, to, carId);
    paid?.(fare, from, to);
  };
}

/** Back to Sandbox: coaches carry no one. */
export function detachPassengers(world: World): void {
  world.economy.seatsOf = null;
  world.economy.onAlight = null;
}
