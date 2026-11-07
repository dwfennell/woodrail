/**
 * Plans: the way a routed train goes to its stop, piece by piece (docs/superpowers/specs/2026-10-30-train-routing.md
 * §3.1). The plan search (`plan`, a Dijkstra over (piece, entry, engine leading)) decides at every points: the router's
 * steering, sections' ways (`wayOn`), and the way drawn on the map (`walkTo`) all choose by `planWay`, so the map and
 * the train agree (step 4).
 */
import { getPieceDef, MAX_CONNECTORS, pathLength, pathLengthOf, pointsWayFrom, type Layout } from "../track";
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
 * pinned ones). `keep`: the line's kept ways (stickiness), as the router chooses for it.
 */
export function walkTo(layout: Layout, start: At, target: number, pinned?: PinnedTest, keep?: KeepTest): Leg {
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
      option = planWay(layout, n.pieceId, n.entry, ways, target, pinned, keep?.(n.pieceId, n.entry, target));
      // No way on leads there: the switch stays as it's set.
      if (option === -1) option = pointsWayFrom(layout, n.pieceId, n.entry, ways.length);
    } else if (ways.length > 1) option = pointsWayFrom(layout, n.pieceId, n.entry, ways.length);
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
  /**
   * The end-of-line flip (§16 Q4, Q8): at the end of the line the sim turns the whole train round where it stands
   * (`Sim.turnAround`), so it heads back out led as it came in. Without it (piece counts, as before step 6), a turn-back
   * swaps which end leads.
   */
  flip?: boolean;
}

/**
 * Piece-count costs, as `distanceTo` counted (the metric before plans): a piece is 1, a turn-back `TURN_COST`, and
 * pushing costs no more. Used by `planWay` until step 6 (`ROUTE_FORWARD=0` still plans by them).
 */
export const PIECE_COSTS: PlanCosts = { through: () => 1, turn: () => TURN_COST, push: 1 };

/**
 * A reverse (§6, step 6): 6 m, on top of the run there and back. More than the way round any loop, wye or balloon on a
 * table-sized map (the Sandbox map's land is about 4.2 × 3.2 m), so a plan turns at the end of a line only when no way
 * round leads there (#7: "prefer running forward").
 */
export const REVERSE_COST = 6000;
/**
 * Running engine-last (§6, §16 Q4). The flip keeps whichever end leads, so a plan never starts pushing: this weighs only
 * a train already running engine-last, and the router plans a train the player set up that way (an engine coupled at
 * the back, or Swap ends) as led, so it isn't penalised for what the player chose.
 */
export const PUSH_FACTOR = 1.5;

/** Costs in mm (§6, step 6): the length run, a reverse `REVERSE_COST` plus the run there and back, the end-of-line flip. */
export const MM_COSTS: PlanCosts = {
  through: (layout, pieceId, path) => lengthOf(layout, pieceId, path),
  turn: (layout, pieceId, path) => REVERSE_COST + 2 * lengthOf(layout, pieceId, path),
  push: PUSH_FACTOR,
  flip: true,
};

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Step 6, forward costs (#7): on. Plans cost in mm (`MM_COSTS`), so a route goes round a loop, wye or balloon rather than
 * turn at a dead end. `ROUTE_FORWARD=0` in the environment (tests, the play-through) plans by piece counts as at step 5.
 */
export const ROUTE_FORWARD = ENV.ROUTE_FORWARD !== "0";

/** The costs every plan is made with: the router, sections, the drawn line and the harness all choose by these. */
export const ROUTE_COSTS: PlanCosts = ROUTE_FORWARD ? MM_COSTS : PIECE_COSTS;

const lengthOf = pathLengthOf;

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
export function plan(layout: Layout, start: PlanState, target: number, costs: PlanCosts = ROUTE_COSTS, pinned?: PinnedTest): Plan | null {
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
        to = { pieceId: back.pieceId, entry: back.entry, lead: costs.flip ? state.lead : !state.lead };
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
  costs: PlanCosts = ROUTE_COSTS,
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
 * Stickiness (the user, 2026-10-31: "the quarry train to mainly stay on the top"): where two ways cost nearly the same,
 * a line keeps the way it last took, so its trains don't flip between them. "Nearly": within `STICK` of the best plus
 * `STICK_MM` (or one piece, by piece counts).
 */
export const STICK = 0.15;
export const STICK_MM = 300;

/** Does a kept way costing `kept` stay chosen over the best, costing `best`? */
export function sticks(kept: number, best: number): boolean {
  return Number.isFinite(kept) && kept <= best * (1 + STICK) + (ROUTE_FORWARD ? STICK_MM : 1);
}

/**
 * The ways each line (an owner: a line id, or a lineless train's) last took at points, by (target, points, entry): what
 * stickiness keeps. Written only by the router as it sets its trains' way (deterministic: sim-driven, nothing per frame);
 * sections and the drawn line read it, so the map, the card and the train agree.
 *
 * Each kept way carries what it cost when taken, and what the best cost then: after a track edit it's kept while it
 * still costs no more than that (its old way is still there), so a route keeps its way across edits (the user,
 * 2026-11-02: "more predictable if it tries to follow the route … also across those kinds of changes"), unless the edit
 * made a way that clearly saves on it (`clearlyBetter`: a shortcut). A leg the edit made dearer (a road on it cut) is
 * planned again. And per target, the pieces the line's walks have run toward it (its trail): at points it has no way
 * kept for (points laid since), the option back onto its trail, unless the best way on clearly saves on it.
 */
export class WayMemory {
  private readonly kept = new Map<number, Map<number, { at: Map<number, KeptWay>; trail: Set<number>; pieces: Set<number>; note?: { ran(pieceId: number, entry: number): void } }>>();
  get(owner: number, pieceId: number, entry: number, target: number): Keep | undefined {
    const t = this.kept.get(owner)?.get(target);
    return t ? { way: t.at.get(pieceId * MAX_CONNECTORS + entry), trail: t.trail, pieces: t.pieces } : undefined;
  }
  private of_(owner: number, target: number) {
    let byTarget = this.kept.get(owner);
    if (!byTarget) this.kept.set(owner, (byTarget = new Map()));
    let t = byTarget.get(target);
    if (!t) byTarget.set(target, (t = { at: new Map(), trail: new Set(), pieces: new Set() }));
    return t;
  }
  /** The line took `option` at these points toward `target`, costing `cost` (mm) to get there by it, the best `best`. */
  set(owner: number, pieceId: number, entry: number, target: number, option: number, cost = NaN, best = NaN): void {
    this.of_(owner, target).at.set(pieceId * MAX_CONNECTORS + entry, { option, cost, best });
  }
  /** Its walk toward `target` ran onto this piece by `entry` (its trail). */
  ran(owner: number, pieceId: number, entry: number, target: number): void {
    this.trailOf(owner, target).ran(pieceId, entry);
  }
  /** The owner's trail toward `target`, to note a walk's pieces on (the router: once a walk, not once a piece). */
  trailOf(owner: number, target: number): { ran(pieceId: number, entry: number): void } {
    const t = this.of_(owner, target);
    return (t.note ??= { ran: (pieceId: number, entry: number) => void (t.trail.add(pieceId * MAX_CONNECTORS + entry), t.pieces.add(pieceId)) });
  }
  /** A line gone (or its train): what it kept goes. */
  forget(owner: number): void {
    this.kept.delete(owner);
  }
  /** A lookup for one owner, as `planWay`'s `keep` and `walkTo`'s take it. */
  of(owner: number): KeepTest {
    return (pieceId, entry, target) => this.get(owner, pieceId, entry, target);
  }
}

/** The option a line last took at points toward a target, what it cost then and what the best cost then (mm; NaN: not known). */
export interface KeptWay {
  option: number;
  cost: number;
  best?: number;
}

/**
 * What `planWay` keeps to: the line's way at these points, and its trail toward the target (piece × connectors + entry;
 * and the pieces on it, whichever way).
 */
export interface Keep {
  way?: KeptWay;
  trail?: ReadonlySet<number>;
  pieces?: ReadonlySet<number>;
}

/** What a line keeps at points toward a target (undefined: nothing). */
export type KeepTest = (pieceId: number, entry: number, target: number) => Keep | undefined;

/** A kept way costing no more than this (mm) over what it cost when taken is the same way, still there. */
const KEPT_SAME = 0.5;

/**
 * A way laid since that saves this share of a kept way's cost, or `SHORTCUT_MM` (about a train's length: an engine and
 * two wagons are 280 mm), is clearly better: a route takes it (the user, 2026-11-02: "allow shortcuts to improve
 * routing, that's one case where predictability isn't everything"). Smaller gains don't flip a route.
 */
export const SHORTCUT = 0.2;
export const SHORTCUT_MM = 300;

/** Does a way costing `best` clearly save on one costing `kept` (`SHORTCUT`, `SHORTCUT_MM`)? */
export function clearlyBetter(best: number, kept: number): boolean {
  if (!Number.isFinite(best)) return false;
  if (!Number.isFinite(kept)) return true;
  const gain = kept - best;
  return gain >= kept * SHORTCUT || gain >= (ROUTE_FORWARD ? SHORTCUT_MM : 1);
}

/**
 * The plan's choice at points (`pieceId`, come in by `entry`, `ways` out from `waysFrom` with the same `pinned`): the
 * option whose way to `target` costs least (`ROUTE_COSTS`: in mm since step 6), the earlier on a tie; −1 if none reaches it.
 * `keep` (stickiness): the option the line last took here (a number: that option, cost not known) is kept while it costs
 * nearly the best (`sticks`), or no more than when it was taken (its way is still there) unless a track edit since made
 * a way that clearly saves on it (`clearlyBetter`). With no way kept here and these points nowhere on the line's trail
 * (points laid since), the cheapest option that runs back onto its trail, if any reaches the target, unless the best
 * clearly saves on it. The one choice at points for everything that decides (the
 * router, sections, the drawn line). Cached per layout by the track, the pins and the decks (a throw of unpinned points
 * changes nothing a plan sees); a caller's own `pinned` test isn't cached. `out.cost`: what the choice costs.
 */
export function planWay(
  layout: Layout,
  pieceId: number,
  entry: number,
  ways: readonly { option: number; path: number; exit: number }[],
  target: number,
  pinned?: PinnedTest,
  keep?: Keep | number,
  out?: { cost: number; best?: number },
): number {
  let best: number;
  let costs: number[];
  if (pinned) {
    costs = [];
    best = planChoice(layout, pieceId, true, ways, target, ROUTE_COSTS, costs, pinned);
  } else {
    const cache = cacheOf(layout);
    const key = pieceId * MAX_CONNECTORS + entry;
    let byTarget = cache.choices.get(target);
    if (!byTarget) cache.choices.set(target, (byTarget = new Map()));
    let c = byTarget.get(key);
    if (c === undefined) {
      planStats.choices++;
      const o: number[] = [];
      byTarget.set(key, (c = { best: planChoice(layout, pieceId, true, ways, target, ROUTE_COSTS, o), costs: o }));
    } else planStats.hits++;
    best = c.best;
    costs = c.costs;
  }
  let choice = best;
  if (keep !== undefined && best !== -1) {
    const k = typeof keep === "number" ? { option: keep, cost: NaN } : keep.way;
    if (k) {
      const kc = costs[k.option];
      // (Still there, no dearer than when taken; and unless a track edit since made a way that clearly saves on it.)
      const edited = k.best !== undefined && costs[best] < k.best - KEPT_SAME;
      const still = kc <= k.cost + KEPT_SAME && !(edited && clearlyBetter(costs[best], kc));
      if (k.option !== best && ways.some((w) => w.option === k.option) && Number.isFinite(kc) && (still || sticks(kc, costs[best]))) choice = k.option;
    } else if (typeof keep !== "number" && keep.trail && keep.trail.size > 0 && !keep.pieces?.has(pieceId)) {
      let on = -1;
      for (const w of ways) {
        const c = costs[w.option];
        if (!Number.isFinite(c) || (on !== -1 && c >= costs[on])) continue;
        const n = next(layout, pieceId, w.exit);
        if (n && keep.trail.has(n.pieceId * MAX_CONNECTORS + n.entry)) on = w.option;
      }
      // (Back onto its trail, unless the best way on from these new points clearly saves on it.)
      if (on !== -1 && !clearlyBetter(costs[best], costs[on])) choice = on;
    }
  }
  if (out) {
    out.cost = choice === -1 ? Infinity : costs[choice];
    out.best = best === -1 ? Infinity : costs[best];
  }
  return choice;
}

/** Per layout: `planWay`'s choices, for the track, pins and decks as `key` says. */
interface ChoiceCache {
  key: string;
  choices: Map<number, Map<number, { best: number; costs: number[] }>>;
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
