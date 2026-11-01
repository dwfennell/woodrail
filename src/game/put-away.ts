import type { CargoKind, Economy } from "../economy";
import type { CarKind, CarLook, Cursor, Sim } from "../sim";
import { joinLine, startLine } from "./lines";

/** A train taken off the map into the box, as it was: enough to put it back (undo). */
export interface PutAway {
  /** Put it back where it stood, on its line (held for room again if there's still none). False: no room there now. */
  restore(): boolean;
  /** Would it go back there now (nothing come to stand in its place)? */
  fits(): boolean;
}

/**
 * "Put away" (a line with a train too many): the train with this engine back in the box, off its line at once (its
 * cars free for the tray again). Null if there's no such train.
 */
export function putAway(sim: Sim, economy: Economy, engine: number): PutAway | null {
  const found = sim.findCar(engine);
  if (!found || found.train.derailed) return null;
  const t = found.train;
  const cars: { kind: CarKind; facing: 1 | -1; lever: -1 | 0 | 1; id: number; look: CarLook; cargo?: { kind: CargoKind; count: number } }[] = t.cars.map((c) => {
    const cargo = economy.cargoOf(c.id);
    return { kind: c.kind, facing: c.facing, lever: c.lever, id: c.id, look: sim.lookOf(c.id), ...(cargo.kind ? { cargo: { kind: cargo.kind, count: cargo.count } } : {}) };
  });
  const at: Cursor = { ...t.bogies[0] };
  const lineId = economy.lineIdOf.get(engine);
  // (Its line as it was: if it was the line's last train, the line goes with it (`prune`), and comes back with it.)
  const was = lineId === undefined ? undefined : economy.lines.get(lineId);
  const line = was && { id: was.id, colour: was.colour, name: was.name, stops: was.stops.map((s) => ({ ...s })) };
  const next = economy.routeOf(engine)?.next ?? 0;
  sim.removeTrain(t.id);
  economy.prune();
  const kinds = cars.map((c) => c.kind);
  const ids = cars.map((c) => c.id);
  return {
    fits: () => {
      const r = sim.addTrain(kinds, at, ids);
      if (r.kind !== "placed") return false;
      sim.removeTrain(r.trainId);
      return true;
    },
    restore: () => {
      const r = sim.addTrain(kinds, at, ids);
      if (r.kind !== "placed") return false;
      const back = sim.getTrain(r.trainId)!;
      back.cars.forEach((car, i) => {
        sim.setLook(car.id, cars[i].look);
        if (cars[i].facing === -1 && car.facing !== -1) sim.flipCar(car.id);
        if (car.kind === "engine") sim.setLever(car.id, cars[i].lever);
        const cargo = cars[i].cargo;
        if (cargo) economy.setCargo(car.id, cargo.kind, cargo.count);
      });
      // Back on its line (the same line, edited meanwhile or not); gone (it was its last train), the line comes back as
      // it was, under a new id if another line has taken its own.
      if (was && economy.lines.get(was.id) === was) joinLine(economy, engine, was.id);
      else if (line) {
        const stops = line.stops.filter((s) => economy.depot(s.depotId));
        const id = economy.lines.has(line.id) ? Math.max(...economy.lines.keys()) + 1 : line.id;
        if (stops.length > 0) economy.lines.get(startLine(economy, engine, stops, id, line).id)!.name = line.name;
      }
      if (line && economy.lineIdOf.get(engine) !== undefined) {
        const route = economy.routeOf(engine);
        if (route && route.stops.length > 0) route.next = next % route.stops.length;
      }
      return true;
    },
  };
}
