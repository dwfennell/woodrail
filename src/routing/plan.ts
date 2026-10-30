/**
 * Plans: the way a routed train goes to its stop, piece by piece (docs/superpowers/specs/2026-10-30-train-routing.md
 * §3.1). The plan search (`plan`, a Dijkstra over (piece, entry, engine leading)) decides at every points: the router's
 * steering, sections' ways (`wayOn`), and the way drawn on the map (`walkTo`) all choose by `planWay`, so the map and
 * the train agree (step 4).
 */
import { getPieceDef, MAX_CONNECTORS, pathLength, type Layout } from "../track";
import { next, SEARCH, TURN_COST, waysFrom, type PinnedTest } from "./graph";

/** A stretch of one path of one piece, from s0 to s1 along the path's own geometry (s0 > s1 when run backwards). */
export interface PathRun {
  pieceId: number;
  pathIndex: number;
  s0: number;
  s1: number;
}

/** The way between two stops: the runs in order, or null if no way leads there. */
export type Leg = PathRun[] | null;

/** Where a walk along the track stands: on a path, going one way, from `s` (the path's own geometry). */
export interface At {
  pieceId: number;
  pathIndex: number;
  reversed: boolean;
  s: number;
}

/**
 * The way a routed train goes from `start` to the middle of piece `target`, choosing at each switch as the router does
 * (`planWay`) and turning back at the end of a line. Null if it never gets there: no way leads there, or it would go
 * round for ever. Bounded by `SEARCH` steps. `pinned`: which switches stay as they're set (by default the layout's
 * pinned ones).
 */
export function walkTo(layout: Layout, start: At, target: number, pinned?: PinnedTest): Leg {
  const runs: PathRun[] = [];
  const visited = new Set<number>();
  let at = { ...start };
  for (let step = 0; step < SEARCH; step++) {
    const piece = layout.getPiece(at.pieceId);
    if (!piece) return null;
    const def = getPieceDef(piece.type, piece.flipped);
    const path = def.paths[at.pathIndex];
    const len = pathLength(path.geom);
    const end = at.reversed ? 0 : len;
    // The walk is decided by where it stands, so coming round to a path the same way again is a loop.
    const key = (at.pieceId * 8 + at.pathIndex) * 2 + (at.reversed ? 1 : 0);
    if (visited.has(key)) return null;
    visited.add(key);
    if (at.s !== end) runs.push({ pieceId: at.pieceId, pathIndex: at.pathIndex, s0: at.s, s1: end });
    const exit = at.reversed ? path.from : (path.to ?? -1);
    const n = next(layout, at.pieceId, exit);
    const ways = n ? waysFrom(layout, n.pieceId, n.entry, pinned) : [];
    if (!n || ways.length === 0) {
      // The end of the line: the train comes back along this path.
      at = { pieceId: at.pieceId, pathIndex: at.pathIndex, reversed: !at.reversed, s: end };
      continue;
    }
    let option = 0;
    if (n.pieceId !== target && ways.length > 1) {
      option = planWay(layout, n.pieceId, n.entry, ways, target, pinned);
      // No way on leads there: the switch stays as it's set.
      if (option === -1) option = layout.switchState(n.pieceId) % ways.length;
    } else if (ways.length > 1) option = layout.switchState(n.pieceId) % ways.length;
    const w = ways[option];
    const nPiece = layout.getPiece(n.pieceId)!;
    const p = getPieceDef(nPiece.type, nPiece.flipped).paths[w.path];
    const reversed = p.to === n.entry; // as routeFrom has it
    const nLen = pathLength(p.geom);
    if (n.pieceId === target) {
      runs.push({ pieceId: n.pieceId, pathIndex: w.path, s0: reversed ? nLen : 0, s1: nLen / 2 });
      return runs;
    }
    at = { pieceId: n.pieceId, pathIndex: w.path, reversed, s: reversed ? nLen : 0 };
  }
  return null;
}

// ── The plan search (spec §3.1, §6) ─────────────────────────────────────────────────────────────────────────────────────

/** Where a plan stands: on a piece, come in by `entry`, the engine leading or not (it changes at a turn-back). */
export interface PlanState {
  pieceId: number;
  entry: number;
  lead: boolean;
}

/** One piece of a plan: run through on `path` from `entry` out at `exit`; `reverse`: it turns back there (the end of a line). */
export interface Step {
  pieceId: number;
  path: number;
  entry: number;
  exit: number;
  reverse?: boolean;
}

/**
 * What a plan's moves cost. `through`: running through a piece on a path; `turn`: running on to the end of the line on it
 * and back through it (the turn-back's own cost included); `push`: the factor on `through` with the engine not leading.
 */
export interface PlanCosts {
  through(layout: Layout, pieceId: number, path: number): number;
  turn(layout: Layout, pieceId: number, path: number): number;
  push: number;
}

/**
 * Piece-count costs, as `distanceTo` counted (the metric before plans): a piece is 1, a turn-back `TURN_COST`, and
 * pushing costs no more. Used by `planWay` until step 6 brings costs in mm (`MM_COSTS`).
 */
export const PIECE_COSTS: PlanCosts = { through: () => 1, turn: () => TURN_COST, push: 1 };

/** A reverse (§6): about 2 m, on top of the run back. */
export const REVERSE_COST = 2000;
/** Running engine-last (§6). */
export const PUSH_FACTOR = 1.5;

/** Costs in mm (§6, step 6; not used yet): the length run, a reverse `REVERSE_COST` plus the run there and back. */
export const MM_COSTS: PlanCosts = {
  through: (layout, pieceId, path) => lengthOf(layout, pieceId, path),
  turn: (layout, pieceId, path) => REVERSE_COST + 2 * lengthOf(layout, pieceId, path),
  push: PUSH_FACTOR,
};

function lengthOf(layout: Layout, pieceId: number, path: number): number {
  const p = layout.getPiece(pieceId)!;
  return pathLength(getPieceDef(p.type, p.flipped).paths[path].geom);
}

/** A found plan: what it costs, and its steps from the start up to (not into) the target's piece. */
export interface Plan {
  cost: number;
  steps: Step[];
}

const stateKey = (s: PlanState) => (s.pieceId * MAX_CONNECTORS + s.entry) * 2 + (s.lead ? 1 : 0);

/** Searches done, states taken off the heap, and `planWay`'s choices worked out and taken from its cache (for measuring). */
export const planStats = { searches: 0, states: 0, choices: 0, hits: 0 };

/**
 * The cheapest way from `start` to piece `target` (a Dijkstra over (piece, entry, engine leading) with a binary heap,
 * capped at `SEARCH` states), or null if none reaches it. A train turns back where the track ends; pinned switches
 * offer only the road they're set to (`waysFrom`). Equal costs go to the earlier way out of each piece, as `wayToward`
 * breaks ties.
 */
export function plan(layout: Layout, start: PlanState, target: number, costs: PlanCosts = PIECE_COSTS, pinned?: PinnedTest): Plan | null {
  planStats.searches++;
  if (start.pieceId === target) return { cost: 0, steps: [] };
  const best = new Map<number, number>();
  const from = new Map<number, { prev: PlanState | null; step: Step | null }>();
  const heap = new Heap();
  best.set(stateKey(start), 0);
  from.set(stateKey(start), { prev: null, step: null });
  heap.push(0, 0, start);
  let order = 1;
  const done = new Set<number>();
  while (heap.size > 0 && done.size < SEARCH) {
    const { cost, state } = heap.pop();
    const key = stateKey(state);
    if (done.has(key)) continue;
    done.add(key);
    planStats.states++;
    if (state.pieceId === target) {
      const steps: Step[] = [];
      for (let k = key; ; ) {
        const f = from.get(k)!;
        if (!f.prev) break;
        steps.push(f.step!);
        k = stateKey(f.prev);
      }
      return { cost, steps: steps.reverse() };
    }
    const factor = state.lead ? 1 : costs.push;
    for (const w of waysFrom(layout, state.pieceId, state.entry, pinned)) {
      const n = next(layout, state.pieceId, w.exit);
      let to: PlanState | null;
      let c: number;
      let step: Step;
      if (n) {
        to = { pieceId: n.pieceId, entry: n.entry, lead: state.lead };
        c = cost + costs.through(layout, state.pieceId, w.path) * factor;
        step = { pieceId: state.pieceId, path: w.path, entry: state.entry, exit: w.exit };
      } else {
        // The end of the line: back through this piece and out where it came in, the engine now at the other end.
        const back = next(layout, state.pieceId, state.entry);
        if (!back) continue;
        to = { pieceId: back.pieceId, entry: back.entry, lead: !state.lead };
        c = cost + costs.turn(layout, state.pieceId, w.path) * factor;
        step = { pieceId: state.pieceId, path: w.path, entry: state.entry, exit: w.exit, reverse: true };
      }
      const k = stateKey(to);
      if (done.has(k) || (best.get(k) ?? Infinity) <= c) continue;
      best.set(k, c);
      from.set(k, { prev: state, step });
      heap.push(c, order++, to);
    }
  }
  return null;
}

/** A binary min-heap of plan states by cost, then by when they were pushed (so ties go to the earlier way). */
class Heap {
  private costs: number[] = [];
  private orders: number[] = [];
  private states: PlanState[] = [];
  get size(): number {
    return this.costs.length;
  }
  private less(i: number, j: number): boolean {
    return this.costs[i] < this.costs[j] || (this.costs[i] === this.costs[j] && this.orders[i] < this.orders[j]);
  }
  private swap(i: number, j: number): void {
    [this.costs[i], this.costs[j]] = [this.costs[j], this.costs[i]];
    [this.orders[i], this.orders[j]] = [this.orders[j], this.orders[i]];
    [this.states[i], this.states[j]] = [this.states[j], this.states[i]];
  }
  push(cost: number, order: number, state: PlanState): void {
    this.costs.push(cost);
    this.orders.push(order);
    this.states.push(state);
    for (let i = this.costs.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): { cost: number; state: PlanState } {
    const top = { cost: this.costs[0], state: this.states[0] };
    const last = this.costs.length - 1;
    this.swap(0, last);
    this.costs.pop();
    this.orders.pop();
    this.states.pop();
    for (let i = 0; ; ) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.costs.length && this.less(l, m)) m = l;
      if (r < this.costs.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

/**
 * The plan's choice at points (`pieceId`, come in by `entry`, `ways` out from `waysFrom`): the way whose plan to `target`
 * costs least, the earlier on a tie (as `wayToward`); −1 if none reaches it. `costs` per way (Infinity: none) are filled
 * in when given. `pinned` as for `waysFrom`.
 */
export function planChoice(
  layout: Layout,
  pieceId: number,
  lead: boolean,
  ways: readonly { option: number; path: number; exit: number }[],
  target: number,
  costs: PlanCosts = PIECE_COSTS,
  out?: number[],
  pinned?: PinnedTest,
): number {
  let best = -1;
  let bestC = Infinity;
  for (const w of ways) {
    const n = next(layout, pieceId, w.exit);
    let c = Infinity;
    if (n) {
      const rest = n.pieceId === target ? { cost: 0 } : plan(layout, { pieceId: n.pieceId, entry: n.entry, lead }, target, costs, pinned);
      if (rest) c = costs.through(layout, pieceId, w.path) * (lead ? 1 : costs.push) + rest.cost;
    }
    if (out) out[w.option] = c;
    if (c < bestC) {
      bestC = c;
      best = w.option;
    }
  }
  return best;
}

/**
 * The plan's choice at points (`pieceId`, come in by `entry`, `ways` out from `waysFrom` with the same `pinned`): the
 * option whose way to `target` costs least (piece counts, `PIECE_COSTS`), the earlier on a tie; −1 if none reaches it.
 * The one choice at points for everything that decides (the router, sections, the drawn line). Cached per layout by the
 * track, the pins and the decks (a throw of unpinned points changes nothing a plan sees); a caller's own `pinned` test
 * isn't cached.
 */
export function planWay(
  layout: Layout,
  pieceId: number,
  entry: number,
  ways: readonly { option: number; path: number; exit: number }[],
  target: number,
  pinned?: PinnedTest,
): number {
  if (pinned) return planChoice(layout, pieceId, true, ways, target, PIECE_COSTS, undefined, pinned);
  const cache = cacheOf(layout);
  const key = pieceId * MAX_CONNECTORS + entry;
  let byTarget = cache.choices.get(target);
  if (!byTarget) cache.choices.set(target, (byTarget = new Map()));
  let c = byTarget.get(key);
  if (c === undefined) {
    planStats.choices++;
    byTarget.set(key, (c = planChoice(layout, pieceId, true, ways, target)));
  } else planStats.hits++;
  return c;
}

/** Per layout: `planWay`'s choices, for the track, pins and decks as `key` says. */
interface ChoiceCache {
  key: string;
  choices: Map<number, Map<number, number>>;
  switchesAt: number;
  piecesAt: number;
  decks: number[];
}
const caches = new WeakMap<Layout, ChoiceCache>();

/** The layout's choice cache, emptied if the track, the pins or the decks have changed since it was filled. */
function cacheOf(layout: Layout): ChoiceCache {
  let c = caches.get(layout);
  if (!c) caches.set(layout, (c = { key: "", choices: new Map(), switchesAt: -1, piecesAt: -1, decks: [] }));
  // (Only when a switch has moved, or pieces come or gone, is the key worked out again: pins and decks are few.)
  if (c.switchesAt === layout.switchesVersion && c.piecesAt === layout.piecesVersion && c.key.startsWith(`${layout.revision}:${layout.jointsVersion}:`)) return c;
  if (c.piecesAt !== layout.piecesVersion) {
    c.piecesAt = layout.piecesVersion;
    c.decks = [];
    for (const id of layout.pieceIds()) {
      const p = layout.getPiece(id)!;
      if (getPieceDef(p.type, p.flipped).gated) c.decks.push(id);
    }
  }
  c.switchesAt = layout.switchesVersion;
  let key = `${layout.revision}:${layout.jointsVersion}:`;
  for (const id of layout.pinnedIds()) key += `${id}=${layout.switchState(id)},`;
  for (const id of c.decks) key += `d${id}=${layout.deckTurning(id) ? "t" : layout.switchState(id)},`;
  if (key !== c.key) {
    c.key = key;
    c.choices.clear();
  }
  return c;
}
