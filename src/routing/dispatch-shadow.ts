/**
 * The dispatcher in shadow, first report (dispatcher spec §8 step 1, docs/superpowers/specs/2026-11-18-dispatcher.md):
 * for each jam today's rules make on a reference map (`runJams`), would a dispatcher with every train's plan and every
 * lever have found an order that keeps them all going? Judged by the oracle (`oracle.ts`: every sequence of moves under
 * the user's rules: trains turn only at their own line ends, never wait on points), twice:
 *
 * - **now**, from the jam: an order exists, so the dispatcher clears it without the player ("resolvable");
 * - **before**, from where the trains stood `BEFORE_S` before it began: an order exists then though none does now, so
 *   the dispatcher would have avoided it ("avoidable"); none even then: the layout has no room ("layout").
 *
 * Test-only, nothing in the game runs it. A capped search (`MAX_STATES`) says so ("unknown").
 */
import type { Layout } from "../track";
import type { Sim } from "../sim";
import type { Economy } from "../economy/economy";
import { trainLength } from "../sim/train-cars";
import { elemsByLength, oracle, type OTrain } from "./oracle";

/** How far back (s) "before" looks: the jam counted from when its train was first stuck. */
export const BEFORE_S = 30;
/** The oracle's state cap per judgement. */
export const MAX_STATES = 200_000;

export type JamVerdict = "resolvable" | "avoidable" | "layout" | "unknown";

/** Every train on the map as the oracle takes it: its pieces, its stops' pieces (a hand-run train: none), its length. */
export function oTrainsOf(layout: Layout, sim: Sim, economy: Economy): OTrain[] {
  const out: OTrain[] = [];
  for (const id of sim.trainIds()) {
    const t = sim.getTrain(id)!;
    if (t.derailed) continue;
    const engine = t.cars.find((c) => c.kind === "engine")?.id;
    const route = engine === undefined ? undefined : economy.routeOf(engine);
    const stops = route && route.stops.length > 0 ? route.stops.map((s) => economy.depot(s.depotId)?.pieceId ?? -1).filter((p) => p >= 0) : null;
    out.push({ elems: elemsByLength(layout, t), stops, length: trainLength(t) });
  }
  return out;
}

export interface Judgement {
  /** Trains on the map, and how many the oracle keeps delivering together. */
  trains: number;
  best: number;
  states: number;
  capped: boolean;
  ms: number;
}

export function judge(layout: Layout, trains: OTrain[]): Judgement {
  const t0 = performance.now();
  const o = oracle(layout, trains, "own", MAX_STATES);
  return { trains: trains.length, best: o.best, states: o.states, capped: o.capped, ms: Math.round(performance.now() - t0) };
}

/** The verdict from the two judgements. */
export function verdictOf(now: Judgement, before: Judgement | null): JamVerdict {
  if (now.best >= now.trains) return "resolvable";
  if (before && before.best >= before.trains) return "avoidable";
  if (now.capped || (before?.capped ?? false)) return "unknown";
  return "layout";
}
