/**
 * The swap planner (routing-zero, 2026-11-14): for a line whose trains have stalled in each other's way where the
 * dispatcher oracle (`oracle.ts`) still finds a way for them all to keep delivering (three trains on three line ends off
 * one set of points, one spare: whoever holds what, the right one has to go into the spare at the right moment, moves
 * ahead). It searches once from the stall (a few thousand states on such a layout), keeps the graph, and from then on
 * names the next move: one train's, from where they all stand to the next place it rests, on a shortest way to a state
 * in the set where they all keep delivering and the train most in need comes to its stop. Sections carry the move out
 * (`Sections.planned`). It acts only on a stall: what runs today never comes here.
 */
import type { Layout } from "../track";
import { oracle, type Elem, type OTrain } from "./oracle";

/** A train as the oracle has it: its pieces, tail first, and how far (mm) short of its front piece's end it stands. */
export interface PlanTrain {
  e: Elem[];
  fs: number;
}

/** One move: train `k` (its index among the planned trains) goes from where it stands to `to`, or turns round there. */
export interface PlannedMove {
  k: number;
  to: PlanTrain;
  turn: boolean;
}

export interface SwapPlan {
  /** The states searched (state 0: where they stood when it was made). */
  readonly states: PlanTrain[][];
  readonly edges: number[][];
  /** The set of states they all keep delivering in. */
  readonly keep: ReadonlySet<number>;
}

/** Most states searched for a plan: past that, no plan (a layout too big to plan on a phone at a stall). */
export const PLAN_STATES = 20_000;

/**
 * A plan from `trains` (their stops: a routed train's), or null if the oracle finds none where every one of them keeps
 * delivering, or the search grows past `maxStates`.
 */
export function planSwap(layout: Layout, trains: OTrain[], maxStates = PLAN_STATES): SwapPlan | null {
  const o = oracle(layout, trains, "spare", maxStates, false, false, true, true);
  if (o.capped || !o.graph || o.best < trains.length) return null;
  return { states: o.graph.states, edges: o.graph.edges, keep: new Set(o.graph.best) };
}

/**
 * The plan's state where every train's front is where it is now, on the same piece going the same way, or (`ahead[k]`)
 * a piece on (the plan has a train's front a little further on than the game's lead bogie: it keeps a gap and an
 * inset the plan doesn't), the nearest by how far short of its front piece's end each stands. −1: none.
 */
export function stateOf(plan: SwapPlan, now: readonly PlanTrain[], ahead?: readonly (Elem | null)[]): number {
  const front = (t: PlanTrain) => t.e[t.e.length - 1];
  const same = (a: Elem, b: Elem) => a.p === b.p && a.en === b.en && a.ex === b.ex;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < plan.states.length; i++) {
    const s = plan.states[i];
    if (s.length !== now.length) continue;
    let d = 0;
    let ok = true;
    for (let k = 0; k < s.length && ok; k++) {
      const pf = front(s[k]);
      const gf = front(now[k]);
      if (gf && same(pf, gf)) d += Math.abs(s[k].fs - now[k].fs);
      else if (ahead?.[k] && same(pf, ahead[k]!)) d += 1000 + s[k].fs;
      else ok = false;
    }
    if (ok && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/**
 * The next move from state `at`: on a shortest way to a state they all keep delivering in where a train covers its
 * target piece, trying the trains in `order` (the one waited longest first; `targets[k]`, −1: none). Null if none.
 */
export function nextFrom(plan: SwapPlan, at: number, targets: readonly number[], order: readonly number[]): PlannedMove | null {
  if (at < 0 || at >= plan.states.length) return null;
  // (Breadth first from `at`: each state's first move on the way.)
  const first = new Int32Array(plan.states.length).fill(-1);
  const seen = new Uint8Array(plan.states.length);
  seen[at] = 1;
  const queue: number[] = [];
  for (const s of plan.edges[at] ?? []) {
    if (s >= plan.states.length || seen[s]) continue;
    seen[s] = 1;
    first[s] = s;
    queue.push(s);
  }
  const reached: number[] = [];
  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi];
    reached.push(s);
    for (const n of plan.edges[s] ?? []) {
      if (n >= plan.states.length || seen[n]) continue;
      seen[n] = 1;
      first[n] = first[s];
      queue.push(n);
    }
  }
  for (const k of order) {
    const target = targets[k];
    if (target < 0) continue;
    for (const s of reached) {
      if (!plan.keep.has(s) || !plan.states[s][k].e.some((x) => x.p === target)) continue;
      return moveOf(plan, at, first[s]);
    }
  }
  return null;
}

/** The move from state `a` to state `b` (one train moved or turned). */
function moveOf(plan: SwapPlan, a: number, b: number): PlannedMove | null {
  const sa = plan.states[a];
  const sb = plan.states[b];
  for (let k = 0; k < sa.length; k++) {
    const x = sa[k];
    const y = sb[k];
    if (x.fs === y.fs && x.e.length === y.e.length && x.e.every((e, i) => e.p === y.e[i].p && e.en === y.e[i].en && e.ex === y.e[i].ex)) continue;
    // (Turned: the same pieces the other way round.)
    const turn = x.e.length === y.e.length && x.e.every((e, i) => e.p === y.e[y.e.length - 1 - i].p);
    return { k, to: y, turn };
  }
  return null;
}

/**
 * `nextFrom`, run on while the moves it names are the same train's going forward: one longer move (it runs through
 * without stopping at each piece the plan rests at). Ends at the train's target, so it calls there.
 */
export function runFrom(plan: SwapPlan, at: number, targets: readonly number[], order: readonly number[], most = 24): PlannedMove | null {
  return runFromAt(plan, at, targets, order, most)?.m ?? null;
}

/** `runFrom`, and the state its move leads to. */
export function runFromAt(plan: SwapPlan, at: number, targets: readonly number[], order: readonly number[], most = 24): { m: PlannedMove; s: number } | null {
  const m = nextFrom(plan, at, targets, order);
  if (!m) return null;
  let s = plan.edges[at].find((x) => plan.states[x][m.k] === m.to) ?? -1;
  if (m.turn) return { m, s };
  let last = m;
  for (let i = 0; i < most && s >= 0; i++) {
    const tg = targets[m.k];
    if (tg >= 0 && plan.states[s][m.k].e.some((x) => x.p === tg)) break;
    const n = nextFrom(plan, s, targets, order);
    if (!n || n.k !== m.k || n.turn) break;
    const t = plan.edges[s].find((x) => plan.states[x][n.k] === n.to) ?? -1;
    if (t < 0) break;
    last = n;
    s = t;
  }
  return { m: last, s };
}
