/**
 * The dispatcher in shadow, first report (dispatcher spec §8 step 1, docs/superpowers/specs/2026-11-18-dispatcher.md):
 * for each jam today's rules make on a reference map (`runJams`), would a dispatcher with every train's plan and every
 * lever have found an order that keeps them all going? Judged by the oracle (`oracle.ts`: every sequence of moves under
 * the user's rules: trains turn only at their own line ends, never wait on points), twice:
 *
 * - **now**, from the jam: an order exists, so the dispatcher clears it without the player ("resolvable");
 * - **before**, from where the trains stood `BEFORE_S` before it began: an order exists then though none does now, so
 *   the dispatcher would have avoided it ("avoidable"); none even then: the layout has no room ("layout").
 * - **with one back-up** (`judgeWithBackUp`, dispatcher spec §2.2 step 5), where neither: more trains kept going.
 *
 * A train may rest at its own stop over points (`stopOnPoints`), as the game lets one too long for its yard.
 *
 * Test-only, nothing in the game runs it. A capped search (`MAX_STATES`) says so ("unknown").
 */
import { getPieceDef, pathLength, type Layout } from "../track";
import { next, waysFrom } from "./graph";
import type { Sim } from "../sim";
import type { Economy } from "../economy/economy";
import { trainLength } from "../sim/train-cars";
import { elemsByLength, isSwitch, oracle, type Elem, type OTrain } from "./oracle";

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
  const o = oracle(layout, trains, "own", MAX_STATES, false, false, true, false, true);
  return { trains: trains.length, best: o.best, states: o.states, capped: o.capped, ms: Math.round(performance.now() - t0) };
}

/** The verdict from the two judgements. */
export function verdictOf(now: Judgement, before: Judgement | null): JamVerdict {
  if (now.best >= now.trains) return "resolvable";
  if (before && before.best >= before.trains) return "avoidable";
  if (now.capped || (before?.capped ?? false)) return "unknown";
  return "layout";
}

/** A piece's length along the path between two of its ends. */
function lengthBetween(layout: Layout, e: Elem): number {
  const piece = layout.getPiece(e.p);
  if (!piece) return 0;
  const def = getPieceDef(piece.type, piece.flipped);
  const path = def.paths.find((q) => (q.from === e.en && q.to === e.ex) || (q.from === e.ex && q.to === e.en));
  return path ? pathLength(path.geom) : 0;
}

/**
 * The back-ups a train could make (dispatcher spec §2.2 step 5): reverse along the track behind it, at most its own
 * length, through any points (every way), onto pieces no other train is on, to where it stands clear of points, then
 * face the way it was going again. Each: the train as it would stand (tail first, front last, as `OTrain.elems`).
 * Pieces only, as the oracle counts them (a piece holds one train).
 */
export function backUpsOf(layout: Layout, trains: readonly OTrain[], k: number): Elem[][] {
  const t = trains[k];
  const length = t.length ?? 0;
  if (length <= 0 || t.elems.length === 0) return [];
  const taken = new Set<number>();
  trains.forEach((o, j) => {
    if (j !== k) for (const e of o.elems) taken.add(e.p);
  });
  // (Reversed: its tail is now its front, driving back.)
  const back = [...t.elems].reverse().map((e) => ({ p: e.p, en: e.ex, ex: e.en }));
  const out: Elem[][] = [];
  const seen = new Set<string>();
  const walk = (path: Elem[], moved: number) => {
    const f = path[path.length - 1];
    if (f.ex < 0) return;
    const nx = next(layout, f.p, f.ex);
    if (!nx || taken.has(nx.pieceId) || path.some((e) => e.p === nx.pieceId)) return;
    for (const w of waysFrom(layout, nx.pieceId, nx.entry, () => false)) {
      if (w.exit < 0) continue;
      const el = { p: nx.pieceId, en: nx.entry, ex: w.exit };
      const m = moved + lengthBetween(layout, el);
      if (m > length + lengthBetween(layout, el)) continue;
      const grown = [...path, el];
      // (Standing: the pieces from its new front back as far as it's long.)
      const stand: Elem[] = [];
      let cover = 0;
      for (let i = grown.length - 1; i >= 0 && cover < length; i--) {
        stand.unshift(grown[i]);
        cover += lengthBetween(layout, grown[i]);
      }
      if (m <= length && stand.every((e) => !isSwitch(layout, e.p))) {
        // (Faced the way it was going again: the pieces it stands on, reversed back.)
        const faced = [...stand].reverse().map((e) => ({ p: e.p, en: e.ex, ex: e.en }));
        const key = faced.map((e) => `${e.p}.${e.en}`).join(",");
        if (!seen.has(key)) {
          seen.add(key);
          out.push(faced);
        }
      }
      if (m < length) walk(grown, m);
    }
  };
  walk(back, 0);
  return out;
}

/**
 * With one back-up (any one train, any of its `backUpsOf`): the most trains the oracle keeps delivering. The best found,
 * and which train backed up (−1: none helps).
 */
export function judgeWithBackUp(layout: Layout, trains: OTrain[], base: Judgement): { best: number; by: number; tried: number; ms: number } {
  const t0 = performance.now();
  let best = base.best;
  let by = -1;
  let tried = 0;
  for (let k = 0; k < trains.length && best < trains.length; k++) {
    if (!trains[k].stops) continue;
    for (const elems of backUpsOf(layout, trains, k)) {
      tried++;
      const moved = trains.slice();
      moved[k] = { ...trains[k], elems };
      const o = oracle(layout, moved, "own", MAX_STATES, false, false, true, false, true);
      if (o.best > best) {
        best = o.best;
        by = k;
      }
      if (best >= trains.length) break;
    }
  }
  return { best, by, tried, ms: Math.round(performance.now() - t0) };
}
