/**
 * Shadow plans (docs/superpowers/specs/2026-10-30-train-routing.md §13, step 3): the plan search (`plan.ts`) run beside
 * today's steering, never acting. Each time the router steers a train toward a switch it hasn't been compared at (or the
 * track, the pins or its target changed), the plan's choice there is set against today's, and a difference is kept with
 * why. Test and QA only: the game's router has no shadow.
 */
import { getPieceDef, type Layout } from "../track";
import { flipCursor, type Cursor, type Train } from "../sim";
import { distanceTo, next, waysFrom, wayToward } from "./graph";
import { PIECE_COSTS, planChoice, planStats, type PlanCosts } from "./plan";
import { LOOK_AHEAD, type AvoidTest } from "./router";

/** What the router tells a shadow each time it steers a train (before it throws anything). */
export interface ShadowObserver {
  steering(layout: Layout, engine: number, train: Train, forward: boolean, target: number, follow?: AvoidTest): void;
}

/** A choice at points where the plan and today's steering differ. */
export interface ShadowDiff {
  engine: number;
  pieceId: number;
  entry: number;
  target: number;
  /** The options chosen: today's and the plan's (−1: none reaches the target). */
  today: number;
  plan: number;
  /** Per option: today's `distanceTo` after it (−1: none), and the plan's cost through it (Infinity: none). */
  todayD: number[];
  planC: number[];
  why: string;
}

/** Why a choice differs (the keys of `ShadowPlans.why`). */
export const WHY = {
  granted: "sections' granted way (`follow`) decides today's choice; the plan doesn't know grants yet (steps 4–5)",
  overcount: "distanceTo marks a piece seen when it's first pushed, so a way first reached through a turn-back hides a shorter one found later: today's distance is too long",
  unreached: "distanceTo found no way (its SEARCH cap, or the seen-at-push overcount) where the plan found one",
  planNone: "the plan found no way where distanceTo did",
  other: "other",
} as const;

/** How many differences are kept in full (the rest only counted by why). */
const KEEP = 20;

export class ShadowPlans implements ShadowObserver {
  /** Choices compared, those that agreed, and those decided today by a sections grant. */
  compared = 0;
  agreed = 0;
  granted = 0;
  /** Differences by why. */
  readonly why = new Map<string, number>();
  readonly diffs: ShadowDiff[] = [];
  /** Plan searches run (cache misses), and their time (ms): total and the longest choice. */
  searches = 0;
  states = 0;
  ms = 0;
  maxMs = 0;
  choices = 0;
  hits = 0;

  /** The plan's choices, by (points, entry, engine leading, target), for the track and pins as `cacheFor` says. */
  private readonly cache = new Map<string, { choice: number; costs: number[] }>();
  private cacheFor = "";
  private pinsAt = -1;
  private pinsSig = "";
  private decksAt = -1;
  private decks: number[] = [];
  /** Per engine, the last choice compared (so a train is compared once each time it comes to points). */
  private readonly last = new Map<number, string>();

  constructor(private readonly costs: PlanCosts = PIECE_COSTS) {}

  steering(layout: Layout, engine: number, train: Train, forward: boolean, target: number, follow?: AvoidTest): void {
    const at = nextChoice(layout, train, forward, target);
    // (No points ahead: the next it comes to is a new approach, compared afresh.)
    if (!at) {
      this.last.delete(engine);
      return;
    }
    const { pieceId, entry, ways } = at;
    const e = train.cars.findIndex((c) => c.id === engine);
    const lead = e === (forward ? 0 : train.cars.length - 1);
    const followed = follow ? ways.filter((w) => follow(pieceId, w.path)) : [];
    const version = this.version(layout);
    const key = `${pieceId}:${entry}:${lead ? 1 : 0}:${target}`;
    const decision = `${version}|${key}|${followed.map((w) => w.option).join(",")}`;
    if (this.last.get(engine) === decision) return;
    this.last.set(engine, decision);
    // Today's choice, as `steerSwitch` makes it: the granted way, else the shortest by `distanceTo`.
    const todayD = ways.map((w) => {
      const n = next(layout, pieceId, w.exit);
      return !n ? -1 : n.pieceId === target ? 0 : distanceTo(layout, n, target);
    });
    const today = followed.length === 1 ? followed[0].option : wayToward(layout, pieceId, ways, target);
    // The plan's, cached by the track, the pins and decks, and the choice.
    if (this.cacheFor !== version) {
      this.cache.clear();
      this.cacheFor = version;
    }
    let p = this.cache.get(key);
    if (p) this.hits++;
    else {
      const s0 = planStats.searches;
      const n0 = planStats.states;
      const t0 = performance.now();
      const costs: number[] = [];
      const choice = planChoice(layout, pieceId, lead, ways, target, this.costs, costs);
      const ms = performance.now() - t0;
      this.ms += ms;
      this.maxMs = Math.max(this.maxMs, ms);
      this.choices++;
      this.searches += planStats.searches - s0;
      this.states += planStats.states - n0;
      p = { choice, costs };
      this.cache.set(key, p);
    }
    this.compared++;
    if (followed.length === 1) this.granted++;
    if (p.choice === today) {
      this.agreed++;
      return;
    }
    const why = followed.length === 1 ? WHY.granted : this.explain(today, p.choice, todayD, p.costs);
    this.why.set(why, (this.why.get(why) ?? 0) + 1);
    if (this.diffs.length < KEEP) this.diffs.push({ engine, pieceId, entry, target, today, plan: p.choice, todayD, planC: p.costs, why });
  }

  /** Why the plan and `distanceTo` chose differently at a switch (piece-count costs: the plan's is 1 + distanceTo's when both are right). */
  private explain(today: number, plan: number, todayD: number[], planC: number[]): string {
    if (today === -1) return WHY.unreached;
    if (plan === -1) return WHY.planNone;
    if (this.costs === PIECE_COSTS && todayD.some((d, k) => d >= 0 && d + 1 > planC[k])) return WHY.overcount;
    return WHY.other;
  }

  /** The track, the pins and the decks, as a key: plans hold while it's the same. */
  private version(layout: Layout): string {
    if (this.decksAt !== layout.piecesVersion) {
      this.decksAt = layout.piecesVersion;
      this.decks = [];
      for (const id of layout.pieceIds()) {
        const p = layout.getPiece(id)!;
        if (getPieceDef(p.type, p.flipped).gated) this.decks.push(id);
      }
    }
    if (this.pinsAt !== layout.switchesVersion) {
      this.pinsAt = layout.switchesVersion;
      let s = "";
      for (const id of layout.pinnedIds()) s += `${id}=${layout.switchState(id)},`;
      for (const id of this.decks) s += `d${id}=${layout.deckTurning(id) ? "t" : layout.switchState(id)},`;
      this.pinsSig = s;
    }
    return `${layout.revision}:${layout.jointsVersion}:${this.pinsSig}`;
  }

  /** In words, for a test's log. */
  summary(): string {
    const lines = [
      `shadow plans: ${this.compared} choices compared, ${this.agreed} agreed (${this.granted} decided today by a sections grant); ${this.choices} planned (${this.hits} from the cache), ${this.searches} searches, ${this.states} states, ${this.ms.toFixed(1)} ms (mean ${(this.ms / Math.max(1, this.choices)).toFixed(3)} ms, longest ${this.maxMs.toFixed(3)} ms a choice)`,
    ];
    for (const [why, n] of this.why) lines.push(`  ×${n}: ${why}`);
    for (const d of this.diffs.slice(0, 6)) lines.push(`  e${d.engine} at points ${d.pieceId} (in at ${d.entry}) for ${d.target}: today ${d.today} [d ${d.todayD.join("/")}], plan ${d.plan} [cost ${d.planC.join("/")}]`);
    return lines.join("\n");
  }

  /** Another shadow's counts added to this one's (a run's total). */
  add(o: ShadowPlans): void {
    this.compared += o.compared;
    this.agreed += o.agreed;
    this.granted += o.granted;
    this.searches += o.searches;
    this.states += o.states;
    this.ms += o.ms;
    this.maxMs = Math.max(this.maxMs, o.maxMs);
    this.choices += o.choices;
    this.hits += o.hits;
    for (const [w, n] of o.why) this.why.set(w, (this.why.get(w) ?? 0) + n);
    for (const d of o.diffs) if (this.diffs.length < KEEP) this.diffs.push(d);
  }
}

/** The next points ahead of a train with a choice (as `steerSwitch` looks: within `LOOK_AHEAD` pieces, not past its target). */
function nextChoice(layout: Layout, train: Train, forward: boolean, target: number): { pieceId: number; entry: number; ways: ReturnType<typeof waysFrom> } | null {
  const b = forward ? train.bogies[0] : train.bogies[train.bogies.length - 1];
  const c: Cursor = { ...b };
  if (!forward) flipCursor(layout, c);
  const piece = layout.getPiece(c.pieceId);
  if (!piece || c.pieceId === target) return null;
  const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
  let exit = c.reversed ? path.from : (path.to ?? -1);
  let at = c.pieceId;
  for (let k = 0; k < LOOK_AHEAD; k++) {
    const n = next(layout, at, exit);
    if (!n || n.pieceId === target) return null;
    const ways = waysFrom(layout, n.pieceId, n.entry);
    if (ways.length > 1) return { pieceId: n.pieceId, entry: n.entry, ways };
    if (ways.length === 0) return null;
    at = n.pieceId;
    exit = ways[0].exit;
  }
  return null;
}
