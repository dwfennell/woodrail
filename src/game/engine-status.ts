import { RECIPES, type Economy } from "../economy";
import { SIM_DT, type Sim, type Train, type TurnCause } from "../sim";
import { kitOf, type Layout } from "../track";

/** Why a train can't move at all: too heavy for its engines, or electric with no power (see `cantMove`). */
export type CantMove = (train: Train) => "too-heavy" | "no-power" | null;

/** What a train is doing, as the engine card and reports see it. */
export type TrainState =
  | { kind: "derailed" }
  | { kind: "worked"; depotId: number; work: "Loading" | "Unloading" | "Loading and unloading" }
  | { kind: "turning-back"; cause: TurnCause; pieceId: number; done?: boolean }
  | { kind: "red-signal"; signalId: number }
  /** Standing at a kit's stop (a platform) for its dwell. */
  | { kind: "at-stop"; pieceId: number }
  | { kind: "too-heavy" }
  | { kind: "no-power" }
  | { kind: "slowing" }
  | { kind: "stopped" }
  | { kind: "held-up" }
  | { kind: "starting" }
  | { kind: "running" };

/** How long after turning back at an open end a train's card still says so (s): it's running back the way it came. */
export const TURNED_SHOWN_S = 8;

/** A train told to go this recently (s) and not moving yet is just starting (the sim hasn't moved it yet). */
const STARTING_S = 0.5;

/**
 * What a train is doing, and if it's standing with its lever on, why: being worked at a depot, turning back at the end
 * of the line, a red signal, too heavy for its engines or no power (`cantMove`), or held up by something else.
 * Worked out when asked (the card, a report), never per frame.
 */
export function trainState(sim: Sim, economy: Economy, train: Train, lever: number, cantMove: CantMove | null = null): TrainState {
  if (train.derailed) return { kind: "derailed" };
  // Turned back where the track just stops (a gap the player can't see): said first, over a depot's work there, and
  // while it runs back the way it came, so the card doesn't just read "Running".
  const turn = train.lastTurn;
  const turning = train.turnback >= 0 && turn !== undefined;
  if (turn?.cause === "open-end" && (turning || (sim.ticks - turn.tick) * SIM_DT < TURNED_SHOWN_S)) {
    // `done`: already running back the way it came.
    return { kind: "turning-back", cause: "open-end", pieceId: turn.pieceId, done: !turning };
  }
  // Being worked by a crane comes next: at a depot at the end of the line the train also waits to turn back.
  const depot = economy.servingDepot(train.id);
  if (depot) {
    const r = RECIPES[depot.role];
    return { kind: "worked", depotId: depot.id, work: r.takes.length === 0 ? "Loading" : r.gives.length === 0 ? "Unloading" : "Loading and unloading" };
  }
  if (train.turnback >= 0) return { kind: "turning-back", cause: turn?.cause ?? "buffer", pieceId: turn?.pieceId ?? -1 };
  const stopAt = economy.kitStops.dwellingAt(train.id);
  if (stopAt !== -1) return { kind: "at-stop", pieceId: stopAt };
  if (sim.atRedSignal(train.id)) return { kind: "red-signal", signalId: sim.redSignalAhead(train.id) };
  if (lever === 0) return train.speed > 1 ? { kind: "slowing" } : { kind: "stopped" };
  if (train.speed < 1) {
    const why = cantMove?.(train) ?? null;
    if (why) return { kind: why };
    // Getting going (moving, but under 1 mm/s yet), or told to go a moment ago: not held up.
    const justSet = train.leverTick !== undefined && (sim.ticks - train.leverTick) * SIM_DT < STARTING_S;
    if (train.speed > 0 || justSet) return { kind: "starting" };
    return { kind: "held-up" };
  }
  return { kind: "running" };
}

/**
 * What a train is doing, in a few words for its engine's card: off the rails, being worked at a depot, turning back,
 * waiting at a red signal, too heavy or without power, stopped, held up, or on its way (to the next stop on its route,
 * if it has one). `nameOf` names a depot (a stop, a town's station).
 */
export function engineStatus(sim: Sim, economy: Economy, engineCarId: number, nameOf: (depotId: number) => string, cantMove: CantMove | null = null): string {
  const found = sim.findCar(engineCarId);
  if (!found) return "";
  const s = trainState(sim, economy, found.train, found.train.cars[found.index].lever, cantMove);
  switch (s.kind) {
    case "derailed":
      return "Off the rails: Rerail puts it back";
    case "worked":
      return `${s.work} at ${nameOf(s.depotId)}`;
    case "turning-back":
      if (s.cause === "open-end") return s.done ? "Turned back: the track ends here" : "Turning back: the track ends here";
      return s.cause === "train" ? "Turning back: another train's in the way" : "Turning back at the end of the line";
    case "red-signal":
      return "Waiting at a red signal";
    case "at-stop": {
      const type = economy.layout.getPiece(s.pieceId)?.type;
      return `Calling at the ${(type && kitOf(type)?.name) ?? "stop"}`;
    }
    case "too-heavy":
      return "Too heavy for its engine: take a car off, or add an engine";
    case "no-power":
      return "No power: a power station needs coal";
    case "slowing":
      return "Slowing to a stop";
    case "starting":
      return "Starting";
    case "stopped":
      return "Stopped";
    case "held-up":
      return "Waiting: something's in the way";
    case "running": {
      const route = economy.routeOf(engineCarId);
      const next = route?.stops[route.next];
      return next ? `On its way to ${nameOf(next.depotId)}` : "Running";
    }
  }
}

/**
 * Each train as a "Send to Claude" report sees it: its cars, its engines' levers, its speed and top speed, the piece its
 * front is on, and what it's doing (with the depot or signal holding it). Small and JSON-able.
 */
export function trainsForReport(sim: Sim, economy: Economy, layout: Layout, cantMove: CantMove | null = null): Record<string, unknown>[] {
  return sim.trainIds().map((id) => {
    const t = sim.getTrain(id)!;
    const engines = t.cars.filter((c) => c.kind === "engine");
    const lever = engines.find((c) => c.lever !== 0)?.lever ?? 0;
    const front = t.bogies[0];
    const piece = front ? layout.getPiece(front.pieceId) : undefined;
    return {
      id,
      cars: t.cars.map((c) => `${c.id}:${c.kind}`),
      levers: engines.map((c) => c.lever),
      speed: Math.round(t.speed),
      topSpeed: sim.topSpeed ? Math.round(sim.topSpeed(t)) : null,
      piece: piece ? { id: front.pieceId, type: piece.type, s: Math.round(front.s) } : null,
      state: trainState(sim, economy, t, lever, cantMove),
      lastTurn: t.lastTurn ? { ...t.lastTurn, secondsAgo: Math.round((sim.ticks - t.lastTurn.tick) * SIM_DT) } : null,
    };
  });
}
