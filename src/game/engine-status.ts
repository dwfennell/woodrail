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
  /** Carried by a train lift, or waiting for its platform (on it, about to go; or at its far end). */
  | { kind: "lift"; riding: boolean }
  | { kind: "too-heavy" }
  | { kind: "no-power" }
  | { kind: "slowing" }
  | { kind: "stopped" }
  /** Held at its stop a moment so its line's trains spread out (auto-spacing): `left` seconds at most, or not known. */
  | { kind: "spacing"; line: string; left: number | null }
  /** Waiting in a passing loop or at a line end for a train of its line on the single track ahead (sections); `line`
   * "": for a train not on its line. */
  | { kind: "line-wait"; line: string; parked?: boolean }
  /**
   * Held: its line has more trains than passing loops (lay `more` more for `trains` trains). `spare`: a train not on
   * the line stands on each road of one of its loops; only moving it helps.
   */
  | { kind: "needs-loop"; more: number; trains: number; spare: boolean; parked: boolean }
  | { kind: "held-up" }
  | { kind: "starting" }
  | { kind: "running" };

/** How long after turning back at an open end a train's card still says so (s): it's running back the way it came. */
export const TURNED_SHOWN_S = 8;

/** A train told to go this recently (s) and not moving yet is just starting (the sim hasn't moved it yet). */
const STARTING_S = 0.5;

/**
 * A train told to go is "Starting" till it's up to this speed (mm/s), as long as it was told in the last few seconds
 * (`STARTING_FOR_S`; braking for a red signal later isn't starting).
 */
const STARTING_SPEED = 40;
const STARTING_FOR_S = 4;

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
    // What's being done for this train here (a Drop stop only unloads), or else what the depot does.
    const w = economy.workFor(train.id, depot);
    const r = RECIPES[depot.role];
    const loads = w ? w.load : r.gives.length > 0;
    const unloads = w ? w.unload : r.takes.length > 0;
    return { kind: "worked", depotId: depot.id, work: loads && unloads ? "Loading and unloading" : unloads ? "Unloading" : "Loading" };
  }
  if (train.turnback >= 0) return { kind: "turning-back", cause: turn?.cause ?? "buffer", pieceId: turn?.pieceId ?? -1 };
  const stopAt = economy.kitStops.dwellingAt(train.id);
  if (stopAt !== -1) return { kind: "at-stop", pieceId: stopAt };
  const lift = sim.liftState(train.id);
  if (lift) return { kind: "lift", riding: lift === "riding" };
  if (sim.atRedSignal(train.id)) return { kind: "red-signal", signalId: sim.redSignalAhead(train.id) };
  if (lever === 0) return train.speed > 1 ? { kind: "slowing" } : { kind: "stopped" };
  // Held a moment at its stop so its line's trains spread out.
  for (const car of train.cars) {
    const wait = economy.spacingWait(car.id);
    if (wait) return { kind: "spacing", line: wait.line.name, left: wait.left };
  }
  // Waiting for a train of its line on the single track ahead, or held for want of a passing loop (sections).
  if (train.speed < 1)
    for (const car of train.cars) {
      const w = economy.sectionWait(car.id);
      if (!w) continue;
      // (A line that can deliver nothing, a parked train to blame: that's what to do something about.)
      if (w.kind === "stalled") return { kind: "needs-loop", more: Math.max(1, w.more), trains: w.trains, spare: w.spare || w.parked, parked: w.parked };
      if (w.kind === "room") return { kind: "needs-loop", more: Math.max(1, w.more), trains: w.trains, spare: w.spare, parked: w.parked };
      // (One with room waiting a moment for a line-mate: just that, though the line be full.)
      const lineId = economy.lineIdOf.get(car.id);
      const line = lineId === undefined ? undefined : economy.lines.get(lineId);
      // (Waiting on a train not on its line: say so; it isn't one of the line's.)
      const other = w.kind === "section" || w.kind === "slot" || w.kind === "facing" ? w.engine : -1;
      if (other >= 0 && economy.lineIdOf.get(other) !== lineId) {
        // (One left standing, its lever off: only moving it helps.)
        const o = sim.findCar(other)?.train;
        const parked = !!o && o.speed < 1 && !o.cars.some((c) => c.kind === "engine" && c.lever !== 0);
        return { kind: "line-wait", line: "", parked };
      }
      return { kind: "line-wait", line: line?.name ?? "line" };
    }
  if (train.speed < 1) {
    const why = cantMove?.(train) ?? null;
    if (why) return { kind: why };
    // Getting going (moving, but under 1 mm/s yet), or told to go a moment ago: not held up.
    const justSet = train.leverTick !== undefined && (sim.ticks - train.leverTick) * SIM_DT < STARTING_S;
    if (train.speed > 0 || justSet) return { kind: "starting" };
    return { kind: "held-up" };
  }
  // Gathering speed after Go.
  if (train.speed < STARTING_SPEED && train.leverTick !== undefined && (sim.ticks - train.leverTick) * SIM_DT < STARTING_FOR_S) return { kind: "starting" };
  return { kind: "running" };
}

/** A train not on the line stands on each road of a passing loop: no loop laid elsewhere gets past it. */
const SPARE_CUT = "a parked train is in the way. Move it";

/** Why a full line's train can't get on: lay loops, or (a loop taken by trains not on the line) move one. */
function fullText(full: { more: number; spare: boolean; parked: boolean }): string {
  if (full.spare) return SPARE_CUT;
  return `the line is full. Lay ${full.more} more passing loop${full.more === 1 ? "" : "s"}${full.parked ? OR_MOVE : ""}`;
}

/** A train not on the line standing in one of its passing loops: moving it gives the loop back, as laying one would. */
const OR_MOVE = ", or move the parked train";

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
      if (s.cause === "short") {
        // (A train on no line turns back short only of a train ahead of it: plainly that.)
        if (!economy.lineIdOf.has(engineCarId)) return "Turning back: another train's in the way";
        const full = economy.sections.fullness(engineCarId);
        return full ? `Turning back early: ${fullText(full)}` : "Turning back early: the end of the line is taken";
      }
      if (s.cause === "train") return "Turning back: another train's in the way";
      // (A train on no line among a managed line's trains (one taken off it, say): that line's end is none of its, so
      // plainly the track ends. On its own, a buffer is the end of its line, the player's own choice.)
      return !economy.lineIdOf.has(engineCarId) && economy.sections.managing() ? "Turning back: the track ends here" : "Turning back at the end of the line";
    case "red-signal":
      return "Waiting at a red signal";
    case "at-stop": {
      const type = economy.layout.getPiece(s.pieceId)?.type;
      return `Calling at the ${(type && kitOf(type)?.name) ?? "stop"}`;
    }
    case "lift":
      return s.riding ? "Riding the train lift" : "Waiting for the train lift";
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
    case "spacing":
      // (A countdown, in whole seconds, where it's known: behind another train it waits for that one to go.)
      return `Spacing out from the other ${s.line} trains${s.left !== null && s.left >= 1 ? ` · ${Math.ceil(s.left)} s` : ""}`;
    case "line-wait":
      if (s.line) return `Waiting for the ${s.line} train`;
      return s.parked ? `Waiting: ${SPARE_CUT}` : "Waiting: a train not on the line is in the way";
    case "needs-loop":
      if (s.spare) return `Waiting: ${SPARE_CUT}`;
      return `Waiting: lay ${s.more} more passing loop${s.more === 1 ? "" : "s"} for ${s.trains} trains${s.parked ? OR_MOVE : ""}`;
    case "held-up":
      return "Waiting: something's in the way";
    case "running": {
      const route = economy.routeOf(engineCarId);
      if (!route || route.stops.length === 0) return "Running";
      // Still on the stop it's leaving, done with (`next` moves on once it's clear): on its way to the one after.
      let i = route.next % route.stops.length;
      const at = economy.depot(route.stops[i].depotId);
      if (route.at && (!at || !economy.hasWorkAt(found.train.id, at))) {
        const here = route.stops[i].depotId;
        for (let k = 0; k < route.stops.length && route.stops[i].depotId === here; k++) i = (i + 1) % route.stops.length;
      }
      // (Heading for a stop beyond a train its line has no room for: it'll turn back short of it. Say why.)
      const full = economy.sections.unreachable(engineCarId) ? economy.sections.fullness(engineCarId) : null;
      if (full) return `Can't reach ${nameOf(route.stops[i].depotId)}: ${fullText(full)}`;
      return `On its way to ${nameOf(route.stops[i].depotId)}`;
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

/**
 * The tip when two trains first meet head on: what lets them pass (a passing loop with signals), or the blueprint to
 * learn for it first. `learned`: Game mode's blueprints (null in Sandbox, where everything's at hand).
 */
export function headOnTip(learned: ReadonlySet<string> | null): string {
  if (!learned || learned.has("signals")) return "Trains met head on. A passing loop with signals lets them pass";
  if (learned.has("switches")) return "Trains met head on. Learn Signals so they can pass on a loop";
  return "Trains met head on. Learn Switches, then Signals, so they can pass";
}
