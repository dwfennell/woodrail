import type { RouteStopDef } from "../economy";
import { firstStopAhead, lineOf, startLine } from "./lines";
import { LEVER_REACH, trackDistance, wiredPoles } from "./lineside";
import { depotName, type World } from "./world";

/**
 * The Telegraph's "see every train, call one home" (tech tree S2): a signal box's card lists the trains in its reach
 * (near the box, or near any telegraph pole wired to it), each with a Call home that sends it back.
 *
 * - **In reach:** a train with an engine, any piece under it within `LEVER_REACH` of the box or a wired pole (as the
 *   levers it works are). Worked out when the card is drawn (a tap, a throw, a call), never per frame.
 * - **Home:** a train on a line goes back to its line's first stop (its depot: where its round starts), keeping its
 *   line. A train on no line goes to the station it comes to first along its way (`firstStopAhead`, the router's own
 *   walk), on a line of its own with that one stop ("Home"). Either way it stops there, its levers off
 *   (`Economy.homeCalls`), till the player sends it on from its card.
 */

/** A train in a signal box's reach. */
export interface TrainInReach {
  readonly trainId: number;
  /** Its (first) engine's car id. */
  readonly engine: number;
  /** Its engine's name. */
  readonly name: string;
  /** How near it comes (mm) to the box or the nearest wired pole. */
  readonly distance: number;
}

/**
 * The trains in reach of a signal box at (x, z): near it, and with the Telegraph (`wired`) near every pole wired to it.
 * Nearest first; trains with no engine (wagons left standing) aren't listed: there's nothing to call.
 */
export function trainsInReach(world: Pick<World, "layout" | "sim" | "props">, x: number, z: number, wired: boolean): TrainInReach[] {
  const points = [{ x, z }, ...(wired ? wiredPoles(world.props, x, z) : [])];
  const out: TrainInReach[] = [];
  for (const id of world.sim.trainIds()) {
    const train = world.sim.getTrain(id)!;
    const engine = train.cars.find((c) => c.kind === "engine");
    if (!engine || train.derailed) continue;
    let best = Infinity;
    for (const pieceId of world.sim.piecesUnder(id)) for (const p of points) best = Math.min(best, trackDistance(world.layout, pieceId, p.x, p.z));
    if (best <= LEVER_REACH) out.push({ trainId: id, engine: engine.id, name: world.sim.nameOf(engine.id), distance: best });
  }
  return out.sort((a, b) => a.distance - b.distance || a.trainId - b.trainId);
}

export type Home = { readonly depotId: number; readonly kind: "depot" | "station"; readonly name: string };

/** Where Call home sends this engine's train: its line's first stop, else the station it comes to first; null: none. */
export function homeOf(world: Pick<World, "economy" | "landscape">, engine: number): Home | null {
  const e = world.economy;
  const line = lineOf(e, engine);
  const first = line?.stops.map((s) => e.depot(s.depotId)).find((d) => d && e.onMap(d));
  if (first) return { depotId: first.id, kind: "depot", name: depotName(world, first) };
  const stations: RouteStopDef[] = e
    .allDepots()
    .filter((d) => d.role === "town" && e.onMap(d))
    .map((d) => ({ depotId: d.id, action: "auto" }));
  const k = firstStopAhead(e, engine, stations);
  if (k === -1) return null;
  const d = e.depot(stations[k].depotId)!;
  return { depotId: d.id, kind: "station", name: depotName(world, d) };
}

export type CallResult = { ok: true; home: Home } | { ok: false; why: "no-train" | "no-home" };

/** Call this engine's train home (see the module's note). */
export function callHome(world: Pick<World, "economy" | "landscape">, engine: number): CallResult {
  const e = world.economy;
  const found = e.sim.findCar(engine);
  if (!found || found.train.derailed) return { ok: false, why: "no-train" };
  const home = homeOf(world, engine);
  if (!home) return { ok: false, why: "no-home" };
  const line = lineOf(e, engine);
  if (line) {
    const next = line.stops.findIndex((s) => s.depotId === home.depotId);
    e.setRoute(engine, { stops: line.stops, next, at: false });
  } else {
    const made = startLine(e, engine, [{ depotId: home.depotId, action: "auto" }]);
    made.name = "Home";
    made.transient = true;
  }
  // It stops there as it comes to it (`Economy.homeCalls`). A train standing with its lever off sets off.
  e.homeCalls.set(engine, home.depotId);
  const car = found.train.cars[found.index];
  if (car.lever === 0) e.sim.setLever(engine, car.facing);
  return { ok: true, home };
}

/** What a card says a call did. */
export function calledLine(name: string, home: Home): string {
  return home.kind === "depot" ? `${name} is called home to ${home.name}` : `${name} is called home to ${home.name} station`;
}
