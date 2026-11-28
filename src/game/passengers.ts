import { ANYWHERE, type DepotState } from "../economy";
import type { CarLook } from "../sim";
import { VISITOR_BONUS } from "./airports";
import { circusFare, circusRiders } from "./circus";
import { isBridge, isSecretKit, OBSERVATORY_KIT, RISER_HEIGHT } from "../track";
import { CELL } from "../landscape/grid";
import type { Progress } from "./progress";
import { statusOf } from "./town-life";
import type { World } from "./world";
import type { Town } from "../landscape";
import { noteTrip, secretName, secretOfStop } from "./secrets";
import { placeOf, townPlaces, visitorFactor } from "./places";
import { METRO_QUARTERS, METRO_SLOWER } from "./metro";
import { grandDone, hubFare } from "./grand";


/**
 * Game mode's passengers: people wait at each town's station, more the bigger the town; coaches carry them to another
 * town, where they pay a fare by how far they came. The riders you've carried unlock the passenger line of blueprints
 * (see `TECHS`, the ones with `riders`), with no goods to pay.
 */

/** Seats in a coach, by its look. */
export const SEATS: Partial<Record<CarLook, number>> = { classic: 4, dining: 2, sleeper: 4, "double-decker": 8, "first-class": 3, observation: 3, metro: 8, royal: 4 };

/** A first-class coach's riders pay this many times the fare. */
export const FIRST_CLASS = 2;
/** A train with a dining car: every rider on it pays this many times the fare. */
export const DINING = 1.5;
/** Riders on the Royal Train (a royal saloon in it: the grand project's reward, src/game/grand.ts) pay this many times the fare. */
export const ROYAL_FARE = 2;
/** A sleeper coach's riders pay this many times the fare on a long trip (`SLEEPER_TRIP` or more, as the crow flies). */
export const SLEEPER = 2.5;
/** How far a ride must go for a sleeper's fare (mm): 40 squares, from one end of a map's towns toward the other. */
export const SLEEPER_TRIP = 40 * CELL;
/**
 * A train with an observation car: every rider on it who has been over a bridge (a viaduct, a lift bridge) or along a
 * hilltop on the way pays this many times the fare (`noteViews`).
 */
export const OBSERVATION = 1.5;
/** Track this high or more (its base, mm) is a hilltop view (two levels: the lookout's height). */
export const VIEW_HEIGHT = 2 * RISER_HEIGHT;

/** A hamlet's station gets someone new waiting this often (s); each level up, as often again. */
export const RIDER_SECONDS = 24;
/** Most people waiting at a station (twice as many, coming twice as often, with busy stations). */
export const WAITING_CAP = 6;

/** A ride to a lookout halt pays this many times the fare: a day out for the view. */
export const LOOKOUT_FARE = 2;
/** A ride to an observatory pays this many times the fare: a night out to see the stars. */
export const STARGAZER_FARE = 3;

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
 * town's people out; they don't make more. But a metro stop (the first `METRO_QUARTERS` of a town's) is a quarter of
 * the town with its own clock and cap, at half its town's rate: those riders are new. `clock` holds each town's time
 * since its last arrival, by town id (a quarter's by −2 − its depot id), kept by the caller between calls. Cheap: a few
 * towns, called about once a second.
 */
export function peopleArrive(world: World, p: Progress, seconds: number, clock: Map<number, number>, boost: (townId: number) => number = () => 1): void {
  // No one waits for coaches that can't be made yet.
  if (!p.learned.has("passengers")) return;
  // (And riders on an observation car's train who are over a view now have had it.)
  if (p.learned.has("observation")) noteViews(world);
  const cap = waitingCap(p);
  const busy = p.learned.has("stations");
  // Each town's stops, in depot order (its station, added with the map, first); its metro stops apart, the first
  // `METRO_QUARTERS` of them each a quarter of the town with riders of its own (metro.ts).
  const stops = new Map<number, DepotState[]>();
  const quarters = new Map<number, DepotState[]>();
  for (const d of world.economy.allDepots()) {
    // (No one lives at a lookout: riders only get off there.)
    if (d.role !== "town" || world.economy.isLookout(d)) continue;
    const into = world.economy.isMetro(d) ? quarters : stops;
    const list = into.get(d.townId);
    if (list) list.push(d);
    else into.set(d.townId, [d]);
  }
  /** Riders turn up at `list` (sharing one clock, keyed `key`, and one cap) every `every` seconds. */
  const arrive = (key: number, list: DepotState[], every: number) => {
    let waiting = 0;
    for (const d of list) waiting += d.waiting;
    if (waiting >= cap) {
      clock.set(key, 0);
      return;
    }
    let t = (clock.get(key) ?? 0) + seconds;
    while (t >= every && waiting < cap) {
      t -= every;
      let to = list[0];
      for (const d of list) if (d.waiting < to.waiting) to = d;
      to.waiting++;
      waiting++;
    }
    // A full town doesn't save up people for later.
    clock.set(key, waiting >= cap ? 0 : t);
  };
  // (`boost`: a town that hears about the trains, its radio mast powered, sends more: src/game/radio.ts.)
  for (const [townId, list] of stops) arrive(townId, list, riderSeconds(statusOf(world, townId).level, busy) / (circusRiders(p, townId) * boost(townId)));
  for (const [townId, list] of quarters) {
    const every = riderSeconds(statusOf(world, townId).level, busy) * METRO_SLOWER;
    // (A quarter's clock is keyed by its depot: −2 − its id, apart from the towns' own.)
    for (const d of list.slice(0, METRO_QUARTERS)) arrive(-2 - d.id, [d], every);
  }
  // Where they want to go: the places the lines take them to, dealt by pull (newcomers, and anyone whose place no line
  // goes to now). Spec 2026-11-15-passenger-destinations.md.
  world.economy.refreshReach();
}

/** A town's pull grows this much for each place standing in it (a town hall, a park, a fountain…), up to `PLACES_PULL_MAX`. */
export const PLACE_PULL = 0.1;
export const PLACES_PULL_MAX = 0.5;
/** A lookout halt's pull, against a hamlet's 1. */
export const LOOKOUT_PULL = 2;
/** An observatory's, a found secret's, an airport's and an airship mast's pull. */
export const SIGHT_PULL = 3;
/** A town with a finished grand project draws this many times as many. */
export const GRAND_PULL = 1.5;

/**
 * How strongly a place draws people (spec 2026-11-15-passenger-destinations.md): a town by its size, the places standing
 * in it, its visitors now (`month`), the circus and a finished grand project; a lookout, an observatory, a found secret,
 * an airport and a mast by what they are; a metro quarter as its town's size. Distance plays no part. Cheap (a town's
 * buildings); called as people are dealt places.
 */
export function placePull(world: World, p: Progress, key: number, month?: number): number {
  if (key >= 0) {
    const town = world.landscape?.towns.find((t) => t.id === key);
    if (!town) return 1;
    let pull = 1 + statusOf(world, key).level;
    pull *= 1 + Math.min(PLACES_PULL_MAX, PLACE_PULL * townPlaces(town).size);
    pull *= visitorFactor(town, month);
    pull *= circusRiders(p, key);
    for (const [id, plan] of world.economy.grandPlans)
      if (plan.townId === key && grandDone(id, plan)) {
        pull *= GRAND_PULL;
        break;
      }
    return pull;
  }
  const d = world.economy.depot(-2 - key);
  if (!d) return 1;
  if (d.role === "airport" || d.role === "mast") return SIGHT_PULL;
  if (world.economy.isLookout(d)) {
    const type = world.layout.getPiece(d.pieceId)?.type;
    return type === OBSERVATORY_KIT || (!!type && isSecretKit(type)) ? SIGHT_PULL : LOOKOUT_PULL;
  }
  // (A metro quarter: its town's size.)
  return 1 + statusOf(world, d.townId).level;
}

/** Seats in a car by its look, in Game mode (only coaches have any). */
export function seatsIn(world: World, carId: number): number {
  const found = world.sim.findCar(carId);
  if (!found || found.train.cars[found.index].kind !== "passenger") return 0;
  return SEATS[world.sim.lookOf(carId)] ?? 0;
}

/**
 * What visitors pay at station `to`'s town against a plain fare (game/places.ts: its best leisure place, in its season
 * by `month`, 0 = January; 1: none).
 */
export function visitorsAt(world: World, to: DepotState, month?: number): number {
  const town = world.landscape?.towns.find((t) => t.id === to.townId);
  return town ? visitorFactor(town, month) : 1;
}

/**
 * What a rider from `from` to `to` pays over a plain fare as a visitor: `visitorsAt` the town they get off in, but only
 * coming from another town. A ride within one town (a metro ride across a city, between its quarters) is no day out:
 * else one cinema doubled the metro's income (a 1-coin fare × 1.5 rounds to 2) and its line paid back in 54 minutes,
 * not the 114 the metro is priced for (docs/balance-2026-11-05.md).
 */
export function visitorsFor(world: World, from: DepotState, to: DepotState, month?: number): number {
  return from.townId === to.townId ? 1 : visitorsAt(world, to, month);
}

/**
 * One rider's fare from station `from` to station `to`, riding coach `carId` (in `month`, for visitors' seasons). A
 * visitor off a plane (`from` an airport) pays `VISITOR_BONUS` times as much; one taken to an airport pays nothing here
 * (the plane takes their fare), and so does one taken to an airship's mast (the tour takes it).
 */
export function fareFor(world: World, from: DepotState, to: DepotState, carId: number, month?: number): number {
  if (to.role === "airport" || to.role === "mast") return 0;
  const a = world.layout.getPiece(from.pieceId)?.pose;
  const b = world.layout.getPiece(to.pieceId)?.pose;
  // Whole coins for the ride, then first class and a dining car on top.
  const far = a && b ? Math.hypot(a.x - b.x, a.z - b.z) : 0;
  let fare = a && b ? Math.max(MIN_FARE, Math.round(far * FARE_PER_MM)) : MIN_FARE;
  const found = world.sim.findCar(carId);
  if (found) {
    const look = world.sim.lookOf(carId);
    if (look === "first-class") fare *= FIRST_CLASS;
    if (look === "sleeper" && far >= SLEEPER_TRIP) fare *= SLEEPER;
    if (found.train.cars.some((c) => c.kind === "passenger" && world.sim.lookOf(c.id) === "dining")) fare *= DINING;
    if (world.economy.ridersOf(carId).scenic && hasObservation(world, found.train.cars)) fare *= OBSERVATION;
    if (look === "royal") fare *= ROYAL_FARE;
    // Grand Central finished: a quarter more on any line through it (src/game/grand.ts).
    fare *= hubFare(world, from, to, found.train.cars.find((c) => c.kind === "engine")?.id);
  }
  if (from.role === "airport") fare *= VISITOR_BONUS;
  // Getting off at a town with a leisure place, from another town: a visitor, who pays more.
  fare *= visitorsFor(world, from, to, month);
  if (world.economy.isLookout(to)) fare *= world.layout.getPiece(to.pieceId)?.type === OBSERVATORY_KIT ? STARGAZER_FARE : LOOKOUT_FARE;
  return Math.round(fare);
}

function hasObservation(world: World, cars: readonly { id: number; kind: string }[]): boolean {
  for (const c of cars) if (c.kind === "passenger" && world.sim.lookOf(c.id) === "observation") return true;
  return false;
}

/** Is this piece a view for an observation car's riders: a bridge (a viaduct, a lift bridge), or track on a hilltop? */
export function isView(world: World, pieceId: number): boolean {
  const p = world.layout.getPiece(pieceId);
  return !!p && (isBridge(p.type) || p.y >= VIEW_HEIGHT - 0.5);
}

/**
 * Riders on a train with an observation car who are over a view now (any car of the train on one: `isView`) have had
 * it, and pay `OBSERVATION` times the fare when they get off. Called with `peopleArrive`, once a second: a train takes
 * a few seconds to cross even a short bridge. Only trains with an observation car and riders are looked at.
 */
export function noteViews(world: World): void {
  for (const t of world.sim.trains()) {
    if (!hasObservation(world, t.cars)) continue;
    let seen = false;
    for (const b of t.bogies)
      if (isView(world, b.pieceId)) {
        seen = true;
        break;
      }
    if (!seen) continue;
    for (const c of t.cars) if (c.kind === "passenger") world.economy.markScenic(c.id);
  }
}

/** Someone got off: pay their fare and count them (at a secret's halt, a tourist trip: `noteTrip`). Returns the coins paid. */
export function payFare(world: World, p: Progress, from: DepotState, to: DepotState, carId: number, month?: number, year = 0): number {
  // (The circus's town pays double: src/game/circus.ts.)
  const fare = fareFor(world, from, to, carId, month) * circusFare(p, to);
  p.coins += fare;
  p.riders++;
  // (Visitors counted, for the Day out sticker.)
  if (visitorsFor(world, from, to, month) > 1) p.counts.set("visitors", (p.counts.get("visitors") ?? 0) + 1);
  if (world.economy.isLookout(to)) noteTrip(world, p, from, to, fare, year);
  return fare;
}

/** Put Game mode's passengers into the world's economy (seats and fares). */
export function attachPassengers(world: World, p: () => Progress, paid?: (fare: number, from: DepotState, to: DepotState) => void, month?: () => number, year?: () => number): void {
  world.economy.seatsOf = (carId) => seatsIn(world, carId);
  world.economy.pullOf = (key) => placePull(world, p(), key, month?.());
  world.economy.onAlight = (from, to, carId) => {
    const fare = payFare(world, p(), from, to, carId, month?.(), year?.());
    paid?.(fare, from, to);
    return fare;
  };
}

/** Back to Sandbox: coaches carry no one. */
export function detachPassengers(world: World): void {
  world.economy.seatsOf = null;
  world.economy.pullOf = null;
  world.economy.onAlight = null;
}

/**
 * A place's name for the cards (spec 2026-11-15-passenger-destinations.md): a town's name; "Observatory", a found
 * secret's name, "⛰️ Lookout", "Airport", "Airship tour", a metro stop's "<town> metro"; "anywhere".
 */
export function placeName(world: World, key: number): string {
  if (key === ANYWHERE) return "anywhere";
  if (key >= 0) return world.landscape?.towns.find((t) => t.id === key)?.name ?? "a town";
  const d = world.economy.depot(-2 - key);
  if (!d) return "a town";
  if (d.role === "airport") return "Airport";
  if (d.role === "mast") return "Airship tour";
  const town = world.landscape?.towns.find((t) => t.id === d.townId)?.name ?? "";
  if (world.economy.isLookout(d)) {
    const type = world.layout.getPiece(d.pieceId)?.type;
    if (type === OBSERVATORY_KIT) return "Observatory";
    const site = secretOfStop(world, d);
    return site ? secretName(site) : "⛰️ Lookout";
  }
  return `${town} metro`;
}

/** Most places named on a card's row; the rest are "+n more". */
export const PLACES_SHOWN = 4;

/**
 * Counts by place as words, the most first (then by name): "Ashby 3 · Brook 2 · +1 more". Empty for none.
 */
export function placesWords(world: World, counts: ReadonlyMap<number, number>): string {
  const rows = [...counts].filter(([, n]) => n > 0).map(([k, n]) => [placeName(world, k), n] as const);
  rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = rows.slice(0, PLACES_SHOWN).map(([name, n]) => `${name} ${n}`);
  if (rows.length > PLACES_SHOWN) shown.push(`+${rows.length - PLACES_SHOWN} more`);
  return shown.join(" · ");
}

/** Who's waiting at a town's stops (its station and halts, not a metro quarter), by place. */
export function waitingByPlace(world: World, townId: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const d of world.economy.allDepots()) {
    if (d.role !== "town" || d.townId !== townId || world.economy.isMetro(d) || world.economy.isLookout(d)) continue;
    world.economy.dealPlaces(d);
    for (let i = 0; i < d.waiting; i++) out.set(d.wants[i], (out.get(d.wants[i]) ?? 0) + 1);
  }
  return out;
}

/** What draws people to a town, for its card: its places standing that aren't treats ("🖼️ Museum, 🌳 Park"); null for none. */
export function drawsWords(town: Town): string | null {
  const names: string[] = [];
  for (const id of townPlaces(town)) {
    const place = placeOf(id);
    if (place && place.kind !== "treat") names.push(`${place.icon} ${place.name}`);
  }
  return names.length > 0 ? names.join(", ") : null;
}

/**
 * Where these coaches' riders are going, as words ("Ashby 3 · Brook 1"; one place alone, just its name, the count being
 * said beside it already); empty when none say (they want anywhere).
 */
export function ridersTo(world: World, coaches: readonly number[]): string {
  const by = new Map<number, number>();
  for (const id of coaches) for (const [k, n] of world.economy.ridersByPlace(id)) by.set(k, (by.get(k) ?? 0) + n);
  const anywhere = by.delete(ANYWHERE);
  if (by.size === 1 && !anywhere) return placeName(world, [...by.keys()][0]);
  return placesWords(world, by);
}
