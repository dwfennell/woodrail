import { Sim, SIM_DT, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine, joinLine } from "../game/lines";
import { CARGO } from "./cargo";
import { Economy, type DepotRole } from "./economy";

/** Test fixtures for trains that wait for each other (crossing.test.ts, loops.test.ts). */

/** Lay `types` end to end on from connector `from` (or from the origin); their ids. */
export function chain(layout: Layout, types: readonly PieceTypeId[], from = -1, flips: readonly boolean[] = []): number[] {
  const ids: number[] = [];
  let ref = from;
  types.forEach((t, k) => {
    const id = ref === -1 ? layout.addPiece(t, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, t, !!flips[k], ref);
    ids.push(id);
    ref = connectorRef(id, 1);
  });
  return ids;
}

/**
 * A passing loop laid on from connector `from`: a switch, the main road (`main`: straights), and the other road round
 * by `side` (between two large curves); the far switch's stem is the way on. Its switches and roads.
 */
export function loopOn(layout: Layout, from: number, main: readonly PieceTypeId[], side: readonly PieceTypeId[]) {
  const s1 = appendPiece(layout, "switch", false, from);
  const mainIds = chain(layout, main, connectorRef(s1, 1));
  const [c1] = chain(layout, ["curve-large"], connectorRef(s1, 2), [true]);
  const sideIds = chain(layout, side, connectorRef(c1, 1));
  const [c2] = chain(layout, ["curve-large"], connectorRef(sideIds.length > 0 ? sideIds[sideIds.length - 1] : c1, 1), [true]);
  const s2 = appendPiece(layout, "switch", true, connectorRef(c2, 1), 2);
  if (layout.joinedConnector(connectorRef(s2, 1)) !== connectorRef(mainIds[mainIds.length - 1], 1)) throw new Error("loop doesn't close");
  return { s1, s2, main: mainIds, side: [c1, ...sideIds, c2] };
}

export type World = {
  layout: Layout;
  sim: Sim;
  economy: Economy;
  dx: ReturnType<Economy["addDepot"]>;
};

/** A train of `cars` on piece `pieceId`, facing along its path (or back, `reversed`), its lever on. */
export function train(w: World, pieceId: number, reversed: boolean, cars: CarKind[] = ["engine", "timber"], s = 100): number {
  const placed = w.sim.addTrain(cars, { pieceId, pathIndex: 0, reversed, s });
  if (placed.kind !== "placed") throw new Error("no room");
  const engine = w.sim.getTrain(placed.trainId)!.cars[0].id;
  w.sim.setLever(engine, 1);
  return engine;
}

/** Run `seconds`; counts head-on meetings (a train turned back by another) and every cross wait seen, by engine. */
export function runner(w: World, engines: readonly number[], topUp = true) {
  const meetings: { tick: number; engine: number }[] = [];
  const waits = new Map<number, Set<string>>(engines.map((e) => [e, new Set()]));
  const arrivals = new Map<number, number>(engines.map((e) => [e, 0]));
  const lastTurn = new Map<number, number>();
  let t = 0;
  const step = () => {
    if (topUp && w.dx) w.dx.piles[CARGO.log.index] = Math.max(w.dx.piles[CARGO.log.index], 6);
    const before = engines.map((e) => w.economy.routeOf(e)?.at ?? false);
    w.sim.tick();
    w.economy.tick();
    t++;
    engines.forEach((e, k) => {
      const tr = w.sim.findCar(e)?.train;
      const turn = tr?.lastTurn;
      if (turn?.cause === "train" && lastTurn.get(e) !== turn.tick) {
        lastTurn.set(e, turn.tick);
        meetings.push({ tick: t, engine: e });
      }
      const wait = w.economy.crossWait(e);
      if (wait) waits.get(e)!.add(wait.wait.kind !== "waiting" ? wait.wait.kind : `waiting@${wait.wait.depotId}:${wait.wait.moving ? "moving" : "standing"}${wait.wait.atLoop ? ":loop" : ""}`);
      if (!before[k] && w.economy.routeOf(e)?.at) arrivals.set(e, arrivals.get(e)! + 1);
    });
  };
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) step();
  };
  return { meetings, waits, arrivals, step, run, now: () => t * SIM_DT };
}

/** Two trains on one line of `stops` (depot ids): A on `aAt` facing back along it, B on `bAt` facing along it. */
export function twoTrainsOn(w: World, aAt: number, bAt: number, stops: number[], aNext: number, bNext: number, cars?: CarKind[]) {
  const a = train(w, aAt, true, cars);
  const b = train(w, bAt, false, cars);
  const red = editLine(w.economy, a, (s) => s.push(...stops.map((depotId) => ({ depotId, action: "auto" as const }))))!;
  joinLine(w.economy, b, red.id);
  w.economy.routeOf(a)!.next = aNext;
  w.economy.routeOf(b)!.next = bNext;
  return { a, b, red };
}

/** A new economy with `roles` at `pieces` (as a loaded game has). */
export function economyOn(layout: Layout, sim: Sim, depots: readonly { role: DepotRole; pieceId: number; town: number }[]) {
  const economy = new Economy(layout, sim);
  return { economy, depots: depots.map((d) => economy.addDepot(d.role, d.pieceId, d.town)) };
}
