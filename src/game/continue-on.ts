import type { Economy } from "../economy";
import type { Sim, Train } from "../sim";
import { trainState } from "./engine-status";

/**
 * Continue, on an engine's card: a train waiting to turn back where the track just stops (perhaps being worked at a
 * station there) gives that up and runs on to the next stop on its route at once, its engine leading. Offered only to
 * a routed train (one with somewhere to go: two stops or more) still waiting there.
 */
export function canContinue(sim: Sim, economy: Economy, engineCarId: number): boolean {
  const found = sim.findCar(engineCarId);
  if (!found || found.train.turnback < 0) return false;
  const route = economy.routeOf(engineCarId);
  if (!route || new Set(route.stops.map((s) => s.depotId)).size < 2) return false;
  const s = trainState(sim, economy, found.train, found.train.cars[found.index].lever);
  return s.kind === "turning-back" && s.cause === "open-end" && !s.done;
}

/** Does an engine lead this train the way it's driven (not pushing its wagons)? */
function engineLeads(t: Train): boolean {
  let net = 0;
  for (const car of t.cars) if (car.kind === "engine") net += car.lever * car.facing;
  const lead = net >= 0 ? t.cars[0] : t.cars[t.cars.length - 1];
  return lead.kind === "engine";
}

/**
 * Do it (see `canContinue`): the crane lets the train go, and it's lifted and turned round where it stands, as at the
 * end of its wait (sections then admit its move like any other). Pushing its wagons that way, the engine runs round to
 * lead. "no-room" (nothing done) where it can be neither turned nor run round.
 */
export function continueOn(sim: Sim, economy: Economy, engineCarId: number): "continued" | "no-room" | "none" {
  if (!canContinue(sim, economy, engineCarId)) return "none";
  const train = sim.findCar(engineCarId)!.train;
  let turned = sim.turnNow(train.id);
  if (!turned) {
    // No room to set it down turned round. Pushing its wagons into the end, it just goes back, the engine leading;
    // leading into it, the engine runs round to the other end first.
    if (!engineLeads(train)) {
      for (const car of train.cars) if (car.kind === "engine") sim.setLever(car.id, -car.lever as -1 | 0 | 1);
    } else {
      const r = sim.runAround(engineCarId);
      if (r === "ran-round") sim.setLever(engineCarId, 1);
      else if (r !== "turned") return "no-room";
    }
    turned = sim.findCar(engineCarId)!.train;
  } else if (!engineLeads(turned) && sim.runAround(engineCarId) === "ran-round") {
    sim.setLever(engineCarId, 1);
    turned = sim.findCar(engineCarId)!.train;
  }
  economy.skipVisit(turned.id);
  return "continued";
}
