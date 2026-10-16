import { RECIPES, type Economy } from "../economy";
import type { Sim } from "../sim";

/**
 * What a train is doing, in a few words for its engine's card: off the rails, turning back, being worked at a depot,
 * waiting at a red signal, stopped, held up, or on its way (to the next stop on its route, if it has one).
 * `nameOf` names a depot (a stop, a town's station).
 */
export function engineStatus(sim: Sim, economy: Economy, engineCarId: number, nameOf: (depotId: number) => string): string {
  const found = sim.findCar(engineCarId);
  if (!found) return "";
  const t = found.train;
  if (t.derailed) return "Off the rails: Rerail puts it back";
  // Being worked by a crane comes first: at a depot at the end of the line the train also waits to turn back.
  const depot = economy.servingDepot(t.id);
  if (depot) {
    const r = RECIPES[depot.role];
    const work = r.takes.length === 0 ? "Loading" : r.gives.length === 0 ? "Unloading" : "Loading and unloading";
    return `${work} at ${nameOf(depot.id)}`;
  }
  if (t.turnback >= 0) return "Turning back at the end of the line";
  if (sim.atRedSignal(t.id)) return "Waiting at a red signal";
  const lever = found.train.cars[found.index].lever;
  if (lever === 0) return t.speed > 1 ? "Slowing to a stop" : "Stopped";
  if (t.speed < 1) return "Waiting: something's in the way";
  const route = economy.routeOf(engineCarId);
  const next = route?.stops[route.next];
  return next ? `On its way to ${nameOf(next.depotId)}` : "Running";
}
