import type { CargoKind } from "../economy/cargo";
import type { DepotState, Economy } from "../economy/economy";
import type { Bag } from "../economy/goods";
import type { ResearchCost } from "./blueprints";
import type { Progress } from "./progress";
import { built, needMet, ready, techOf } from "./tech";

/**
 * Research (Game mode): every blueprint is learned at a school, a depot beside a town that trains bring goods to (spec:
 * docs/superpowers/specs/2026-10-18-research-design.md). One research at a time, `current`, and one waiting, `next`,
 * shared by every school. A research takes its goods (delivered to any school, used up as they arrive: the goods are
 * the progress), then a short study time; from tier 2 it also takes coins, paid when it starts. A pick that can't be
 * paid for yet waits in `next`. Nothing decays: if goods stop coming, it just waits.
 *
 * Kept on `Progress` (saved with it). Advanced only by deliveries and the workshop's clock (`CRAFT_STEP`), never per
 * frame; what a school takes (`lacking`) is a lookup, as the crane asks it for every unit.
 */
export interface Research {
  /** Being researched now (its coins paid), or null. */
  current: string | null;
  /** Up next: starts when `current` is done (once its coins are in hand), or now if nothing is current. */
  next: string | null;
  /**
   * The rest of the queue (#14), in order, after `next`: each moves up to `next` when the one ahead starts. Empty while
   * `next` is null. Each pays its coins when it starts (nothing is reserved), and schools take goods for `current` only.
   */
  later: string[];
  /** Goods delivered into `current` so far. */
  got: Bag;
  /** Seconds studied, once its goods are all in. */
  study: number;
  /** Researches started (coins paid) and swapped out for another, with what they'd got: nothing is lost. */
  readonly held: Map<string, { got: Bag; study: number }>;
  /**
   * Goods collected ahead for researches not started yet (Reading room: the one up next), by research: they go into it
   * when it starts. Kept if it leaves the queue (as `held`): nothing is lost.
   */
  readonly early: Map<string, Bag>;
  /** Goes up whenever anything a card shows changes (not saved): cards redraw on a change of it, never per frame. */
  version: number;
  /**
   * How fast study goes: the fastest of your schools (2 at a college: a school beside a town or city once College is
   * learned; else 1). From the map, not saved: set when schools, towns' levels or what's learned change
   * (`researchSpeed` in landmarks.ts), never per frame.
   */
  speed: number;
}

export const newResearch = (): Research => ({ current: null, next: null, later: [], got: {}, study: 0, held: new Map(), early: new Map(), version: 0, speed: 1 });

/** Seconds of study once a research's goods are in, by tier, at a school's speed of 1 (a college's is 2). */
export const STUDY_SECONDS: Readonly<Record<1 | 2 | 3, number>> = { 1: 20, 2: 45, 3: 90 };

const NONE: ResearchCost = { goods: {} };

/** University (tech tree 3): once learned, every tier-3 lesson needs this share of its goods (rounded up); coins the same. */
export const UNIVERSITY_GOODS = 2 / 3;
const fewer = new Map<string, ResearchCost>();

/**
 * What researching a blueprint takes: goods, and from tier 2 coins. Given what's `learned`: with University, a tier-3
 * one's goods are a third fewer (`UNIVERSITY_GOODS`). A lookup (the crane asks per unit): each kept once worked out.
 */
export function costOf(id: string, learned?: ReadonlySet<string>): ResearchCost {
  const t = techOf(id);
  if (!t) return NONE;
  if (t.tier !== 3 || !learned?.has("university")) return t.research;
  let c = fewer.get(id);
  if (!c) {
    const goods: Record<string, number> = {};
    for (const [k, n] of Object.entries(t.research.goods)) goods[k] = Math.ceil(n * UNIVERSITY_GOODS - 1e-9);
    fewer.set(id, (c = { ...t.research, goods }));
  }
  return c;
}

/** Set how fast study goes (see `Research.speed`): cards and the pill redraw if it changed. */
export function setSpeed(p: Progress, speed: number): void {
  if (p.research.speed === speed) return;
  p.research.speed = speed;
  p.research.version++;
}

/** Seconds of study a blueprint takes (at speed 1). */
export function studyTime(id: string, learned?: ReadonlySet<string>): number {
  const tier = techOf(id)?.tier ?? 1;
  return STUDY_SECONDS[tier] / (tier === 1 && learned?.has("study-hall") ? STUDY_HALL : 1);
}

/** Study hall (research, tech-tree Q1): tier-1 lessons go this much faster at any school. */
export const STUDY_HALL = 2;

/** Can it be researched now: built, not learned, what it needs learned and what it requires done? */
export function canResearch(p: Progress, id: string): boolean {
  const t = techOf(id);
  return !!t && built(t) && ready(p, id);
}

/**
 * Pick a research: it becomes `current` if nothing is (paying its coins), else `next`; picking the one in `next` again
 * swaps the two (the one swapped out keeps what it had got). Picking `current` again changes nothing. A pick whose
 * coins are short waits in `next` (the swap too: it waits there). Returns where it went, or null if it can't be
 * researched.
 */
export function pick(p: Progress, id: string): "current" | "next" | null {
  const r = p.research;
  if (!canResearch(p, id)) return null;
  if (r.current === id) return "current";
  r.version++;
  if (r.current === null) {
    r.later = r.later.filter((x) => x !== id);
    r.next = id;
    repairQueue(p);
    return promote(p) ? "current" : "next";
  }
  if (r.next !== id) {
    // (The one up next is replaced; the rest of the queue stays behind it. The player's taps use `toggleQueue`.)
    r.later = r.later.filter((x) => x !== id);
    r.next = id;
    // (The one replaced may have been needed by one behind it.)
    repairQueue(p);
    return "next";
  }
  // The swap: only once it can start (its coins in hand, or started before), so nothing is left with neither slot.
  if (!r.held.has(id) && p.coins < (costOf(id).coins ?? 0)) return "next";
  const old = r.current;
  r.held.set(old, { got: r.got, study: r.study });
  r.current = null;
  r.got = {};
  r.study = 0;
  promote(p);
  // (Promoting moved the queue up: the one swapped out goes back in front of it.)
  if (r.next !== null) r.later.unshift(r.next);
  r.next = old;
  return "current";
}

/** The most researches waiting in the queue (`next` and `later`): a short list a child can read. */
export const QUEUE_MAX = 5;

/** The queue, in order: `next`, then `later`. */
export const queueOf = (r: Research): string[] => (r.next === null ? [] : [r.next, ...r.later]);

/** Where it waits in the queue: 1 for `next`, 2… for `later`, 0 if it isn't queued. */
export function queuePlace(r: Research, id: string): number {
  if (r.next === id) return 1;
  const i = r.later.indexOf(id);
  return i < 0 ? 0 : i + 2;
}

/** Set the queue (`next` and `later`) from a list. */
function setQueue(r: Research, q: string[]): void {
  r.next = q[0] ?? null;
  r.later = q.slice(1);
  r.version++;
}

/**
 * The blueprints a research needs that aren't learned yet, through the ones they need in turn: prerequisites first,
 * each once (the order they'd be researched in). Empty when it can start (as far as blueprints go).
 */
export function missingNeeds(p: Progress, id: string): string[] {
  const out: string[] = [];
  const visit = (x: string): void => {
    for (const n of techOf(x)?.needs ?? []) {
      if (p.learned.has(n) || out.includes(n)) continue;
      visit(n);
      out.push(n);
    }
  };
  visit(id);
  return out;
}

/**
 * Could it be researched once the blueprints it needs are learned: built, not learned, and what it requires (a town, a
 * count) done? Those requirements aren't brought about by the queue, so they block queueing as they do starting.
 */
const queueable = (p: Progress, id: string): boolean => {
  const t = techOf(id);
  return !!t && built(t) && !p.learned.has(id) && t.requires.every((n) => needMet(p, n));
};

/** Its unlearned needs are under way or ahead of it (`ahead`): it can wait in the queue there. */
const inOrder = (p: Progress, id: string, ahead: readonly string[]): boolean => (techOf(id)?.needs ?? []).every((n) => p.learned.has(n) || n === p.research.current || ahead.includes(n));

/**
 * What a tap on a research adds to the end of the queue: the blueprints it needs that aren't learned, under way or
 * queued yet (prerequisites first), then it. ["mills"] once Farming is learned, under way or queued; else
 * ["farming", "mills"].
 */
export function chainOf(p: Progress, id: string): string[] {
  const r = p.research;
  const q = queueOf(r);
  return [...missingNeeds(p, id), id].filter((x) => x !== r.current && !q.includes(x));
}

/**
 * Why its chain (`chainOf`) can't be queued, or null if it can: a blueprint in it that can't be researched (not in the
 * game yet, or its requirements not met: `{ stuck }`), or too few places left in the queue (`{ full }`: how many it
 * takes).
 */
export function chainBlock(p: Progress, id: string): { stuck: string } | { full: number } | null {
  const r = p.research;
  if (r.current === id || queuePlace(r, id) > 0) return null;
  const chain = chainOf(p, id);
  const stuck = chain.find((x) => !queueable(p, x));
  if (stuck) return { stuck };
  return queueOf(r).length + chain.length > QUEUE_MAX ? { full: chain.length } : null;
}

/**
 * The research "Research now" starts for it: itself once every blueprint it needs is learned, else the first one it
 * needs that can start now ("Research Farming now"), or null (what it needs is under way already, or can't start).
 */
export function nowTarget(p: Progress, id: string): string | null {
  if (canResearch(p, id)) return id;
  return missingNeeds(p, id).find((x) => x !== p.research.current && canResearch(p, x)) ?? null;
}

/**
 * Keep the queue in order (prerequisites before what needs them): each research waits behind the blueprints it needs
 * (or with them under way or learned). One out of order is moved back behind them; one whose prerequisite isn't
 * queued at all (or that isn't in the game) is dropped. For a save loaded, or after a research left the queue some
 * other way. Returns what was dropped.
 */
export function repairQueue(p: Progress): string[] {
  const r = p.research;
  const rest = queueOf(r).filter((x) => {
    const t = techOf(x);
    return !!t && built(t) && !p.learned.has(x) && x !== r.current;
  });
  const dropped = queueOf(r).filter((x) => !rest.includes(x));
  const ok: string[] = [];
  for (;;) {
    const i = rest.findIndex((x) => inOrder(p, x, ok));
    if (i < 0) break;
    ok.push(...rest.splice(i, 1));
  }
  dropped.push(...rest);
  const q = queueOf(r);
  if (ok.length !== q.length || ok.some((x, i) => x !== q[i])) setQueue(r, ok);
  for (const x of dropped)
    if (!ok.includes(x)) {
      r.held.delete(x);
      r.early.delete(x);
    }
  return dropped;
}

/**
 * Take a research out of the queue, and every one queued that needs it (directly, or through another taken out): they
 * can't be researched without it. It keeps what it had got, if it was started before. Returns the others taken out,
 * in queue order (for the toast: "Removed Mills and Bakery too").
 */
export function dequeue(p: Progress, id: string): string[] {
  const r = p.research;
  const q = queueOf(r);
  if (!q.includes(id)) return [];
  const gone = new Set([id]);
  // (Prerequisites are always ahead of what needs them, so one pass in order finds them all.)
  for (const x of q) if (!gone.has(x) && (techOf(x)?.needs ?? []).some((n) => gone.has(n))) gone.add(x);
  setQueue(r, q.filter((x) => !gone.has(x)));
  promote(p);
  return q.filter((x) => gone.has(x) && x !== id);
}

/**
 * A player's tap on a research's button (#14): with nothing under way or waiting it starts (as `pick`); one in the
 * queue is taken out, with every queued one that needs it (`dequeue`); else it joins the end of the queue, after the
 * blueprints it needs that aren't learned or queued yet (`chainOf`: "Queue Farming, then Mills"), unless one of them
 * can't be researched or the queue hasn't room (`chainBlock`). The one under way: nothing. Returns what happened, or
 * null if nothing could.
 */
export function toggleQueue(p: Progress, id: string): "current" | "queued" | "removed" | null {
  const r = p.research;
  if (r.current === id) return "current";
  const q = queueOf(r);
  if (q.includes(id)) {
    dequeue(p, id);
    return "removed";
  }
  if (chainBlock(p, id)) return null;
  const chain = chainOf(p, id);
  if (r.current === null && q.length === 0 && chain.length === 1) return pick(p, id) === "current" ? "current" : "queued";
  setQueue(r, [...q, ...chain]);
  promote(p);
  return r.current === id ? "current" : "queued";
}

/**
 * "Research now" on a queued research: it goes to the front of the queue and swaps in for the one under way (which
 * waits up next, keeping what it had got), as `pick` on the one up next does. Held back while its coins are short.
 * One that needs blueprints not learned yet never starts itself: "Research Farming now" starts the first of them that
 * can (`nowTarget`) the same way, and the rest of them and it move up behind it, in order.
 */
export function startNow(p: Progress, id: string): "current" | "next" | null {
  const r = p.research;
  if (r.current === id) return "current";
  const q = queueOf(r);
  if (!q.includes(id)) return null;
  const first = nowTarget(p, id);
  if (first === null) return null;
  if (r.current !== null && !r.held.has(first) && p.coins < (costOf(first).coins ?? 0)) return "next";
  // It and the blueprints it needs, in order, the one to start first; then the rest of the queue as it was.
  const front = [first, ...[...missingNeeds(p, id), id].filter((x) => x !== first && x !== r.current)];
  const rest = q.filter((x) => !front.includes(x));
  // (Only blueprints already queued move: `id` is queued, so what it needs is ahead of it or under way.)
  setQueue(r, [...front, ...rest]);
  if (r.current === null) return promote(p) ? "current" : "next";
  return pick(p, first) === "current" ? "current" : "next";
}

/** Start `next` if nothing is current and it can be: coins paid (none if it was started before). The queue moves up. */
function promote(p: Progress): boolean {
  const r = p.research;
  // Learned meanwhile (a town's offer), or can't be researched any more: nothing to start; the queue moves up.
  while (r.current === null && r.next !== null && !canResearch(p, r.next)) {
    r.held.delete(r.next);
    r.early.delete(r.next);
    setQueue(r, r.later);
    // (The ones that needed it go too.)
    repairQueue(p);
  }
  if (r.current !== null || r.next === null) return false;
  const id = r.next;
  const kept = r.held.get(id);
  if (kept) {
    r.got = kept.got;
    r.study = kept.study;
    r.held.delete(id);
  } else {
    const coins = costOf(id).coins ?? 0;
    if (p.coins < coins) return false;
    p.coins -= coins;
    r.got = {};
    r.study = 0;
  }
  // (What the schools collected ahead for it goes in: Reading room.)
  const ahead = r.early.get(id);
  if (ahead) {
    r.got = { ...r.got };
    for (const [k, n] of Object.entries(ahead) as [CargoKind, number][]) r.got[k] = (r.got[k] ?? 0) + n;
    r.early.delete(id);
  }
  r.current = id;
  r.next = r.later.shift() ?? null;
  r.version++;
  return true;
}

/** How many more of `kind` the current research needs (0: none, or nothing is being researched). A lookup. */
export function lacking(p: Progress, kind: CargoKind): number {
  const r = p.research;
  if (r.current === null) return 0;
  const want = costOf(r.current, p.learned).goods[kind] ?? 0;
  return want > 0 ? Math.max(0, want - (r.got[kind] ?? 0)) : 0;
}

/** Everything the current research still needs (empty: none, or nothing picked). */
export function lacks(p: Progress): Bag {
  const out: Bag = {};
  const r = p.research;
  if (r.current === null) return out;
  for (const k of Object.keys(costOf(r.current, p.learned).goods) as CargoKind[]) {
    const n = lacking(p, k);
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Are the current research's goods all in (it's being studied)? */
export function studying(p: Progress): boolean {
  const r = p.research;
  if (r.current === null) return false;
  for (const k of Object.keys(costOf(r.current, p.learned).goods) as CargoKind[]) if (lacking(p, k) > 0) return false;
  return true;
}

/** Reading room (research, tech tree 4): schools collect the goods of the research up next too. */
export const READING_ROOM = "reading-room";

/**
 * How many more of `kind` the schools collect ahead for the research up next (Reading room learned; 0 without it, or
 * with nothing up next). What it got before (swapped out, `held`) and what's collected (`early`) count. A lookup.
 */
export function aheadLacking(p: Progress, kind: CargoKind): number {
  const r = p.research;
  const id = r.next;
  if (id === null || !p.learned.has(READING_ROOM)) return 0;
  const want = costOf(id, p.learned).goods[kind] ?? 0;
  if (want <= 0) return 0;
  return Math.max(0, want - (r.held.get(id)?.got[kind] ?? 0) - (r.early.get(id)?.[kind] ?? 0));
}

/** What the research up next still needs, collected ahead (empty: no Reading room, nothing up next, or all in). */
export function aheadLacks(p: Progress): Bag {
  const out: Bag = {};
  const id = p.research.next;
  if (id === null || !p.learned.has(READING_ROOM)) return out;
  for (const k of Object.keys(costOf(id, p.learned).goods) as CargoKind[]) {
    const n = aheadLacking(p, k);
    if (n > 0) out[k] = n;
  }
  return out;
}

/**
 * How many of `kind` a school takes now: what the research under way lacks, and with Reading room what the one up next
 * lacks. `ok` says whether this school may take goods for a research (one studied at a College or a University: only
 * such a school); none: any. A lookup (the crane asks per unit).
 */
export function wants(p: Progress, kind: CargoKind, ok?: (id: string) => boolean): number {
  const r = p.research;
  let n = 0;
  if (r.current !== null && (!ok || ok(r.current))) n += lacking(p, kind);
  if (r.next !== null && (!ok || ok(r.next))) n += aheadLacking(p, kind);
  return n;
}

/**
 * `n` of `kind` reach a school: the current research takes what it lacks, and with Reading room the one up next the
 * rest it lacks (`ok`: as for `wants`). Returns how many were taken.
 */
export function deliver(p: Progress, kind: CargoKind, n: number, ok?: (id: string) => boolean): number {
  const r = p.research;
  let taken = 0;
  if (r.current !== null && (!ok || ok(r.current))) {
    const take = Math.min(n, lacking(p, kind));
    if (take > 0) {
      r.got[kind] = (r.got[kind] ?? 0) + take;
      taken += take;
    }
  }
  if (taken < n && r.next !== null && (!ok || ok(r.next))) {
    const take = Math.min(n - taken, aheadLacking(p, kind));
    if (take > 0) {
      const bag = r.early.get(r.next) ?? {};
      bag[kind] = (bag[kind] ?? 0) + take;
      r.early.set(r.next, bag);
      taken += take;
    }
  }
  if (taken > 0) r.version++;
  return taken;
}

/** Coins still short for the research waiting in `next` (0: none waiting, or it can start). */
export function coinsShort(p: Progress): number {
  const r = p.research;
  if (r.next === null || r.held.has(r.next)) return 0;
  return Math.max(0, (costOf(r.next).coins ?? 0) - p.coins);
}

/** Seconds of study left for the current research (its whole study time until its goods are in), at the schools' speed. */
export function studyLeft(p: Progress, speed = p.research.speed): number {
  const r = p.research;
  return r.current === null ? 0 : Math.max(0, (studyTime(r.current, p.learned) - r.study) / speed);
}

/** The study's clock on game time: where the world's clock (`Game.simSeconds`) stood when it was last read. */
export interface StudyClock {
  at: number | null;
}

/**
 * Seconds of play since `clock` last read the world's clock (`now`: `Game.simSeconds`), and moves it on: so study stands
 * still while the game is paused or stalled and keeps the trains' pace, whatever the wall clock does. 0 on the first
 * read and when the clock went back (another session loaded).
 */
export function simElapsed(clock: StudyClock, now: number): number {
  const was = clock.at;
  clock.at = now;
  return was === null || now < was ? 0 : now - was;
}

/**
 * Advance `seconds` of play at a school speed of `speed`: start `next` if nothing is current (coins may have come in),
 * study once the goods are in, and when the study is done learn it and start
 * `next`. Returns the blueprint learned, or null. Cheap: a few lookups when nothing happens.
 */
export function tick(p: Progress, seconds: number, speed = p.research.speed): string | null {
  const r = p.research;
  // Learned some other way meanwhile (a town's offer): set it aside, goods and all (they're used up).
  if (r.current !== null && p.learned.has(r.current)) {
    r.current = null;
    r.got = {};
    r.study = 0;
    r.version++;
  }
  if (r.current === null) {
    promote(p);
    return null;
  }
  if (!studying(p)) return null;
  const id = r.current;
  const before = Math.ceil(studyLeft(p, speed));
  r.study += seconds * speed;
  if (r.study < studyTime(id, p.learned)) {
    if (Math.ceil(studyLeft(p, speed)) !== before) r.version++;
    return null;
  }
  p.learned.add(id);
  r.current = null;
  r.got = {};
  r.study = 0;
  r.version++;
  promote(p);
  return id;
}

/**
 * Goods a train (or a hand) brings to a school go into the research (what a school takes at all is `lacking`, asked
 * through the economy's `accepts`). `delivered` hears of each unit taken. Game mode only; `detachResearch` undoes it.
 */
export function attachResearch(economy: Economy, progress: () => Progress, delivered?: (kind: CargoKind) => void, takesFor?: (d: DepotState, id: string) => boolean): void {
  economy.intoSink = (d, kind) => {
    if (d.role === "school" && deliver(progress(), kind, 1, takesFor && ((id) => takesFor(d, id))) > 0) delivered?.(kind);
  };
  economy.sinkWants = (kind) => wants(progress(), kind);
}

export function detachResearch(economy: Economy): void {
  economy.intoSink = null;
  economy.sinkWants = null;
}

/** Saved form (see `Progress.toJSON`). */
export interface ResearchData {
  current: string | null;
  next: string | null;
  /** The queue after `next` (#14); absent when empty (and in saves from before it). */
  later?: string[];
  got: [string, number][];
  study: number;
  held?: [string, { got: [string, number][]; study: number }][];
  /** Goods collected ahead (Reading room), by research; absent when none. */
  early?: [string, [string, number][]][];
}

const bagData = (b: Bag): [string, number][] => Object.entries(b).filter(([, n]) => (n ?? 0) > 0) as [string, number][];

export function researchToJSON(r: Research): ResearchData {
  return { current: r.current, next: r.next, ...(r.later.length > 0 ? { later: [...r.later] } : {}), got: bagData(r.got), study: r.study, ...(r.held.size > 0 ? { held: [...r.held].map(([id, h]) => [id, { got: bagData(h.got), study: h.study }] as [string, { got: [string, number][]; study: number }]) } : {}), ...(r.early.size > 0 ? { early: [...r.early].map(([id, b]) => [id, bagData(b)] as [string, [string, number][]]) } : {}) };
}

/** From saved data, against the blueprints (an unknown or malformed part is dropped). */
export function researchFromJSON(data: unknown, known: (id: unknown) => string | null, kinds: ReadonlySet<string>): Research {
  const r = newResearch();
  const d = data as Partial<ResearchData> | null | undefined;
  if (!d || typeof d !== "object") return r;
  const bag = (e: unknown): Bag => {
    const out: Bag = {};
    if (Array.isArray(e)) for (const x of e) if (Array.isArray(x) && kinds.has(x[0]) && Number.isInteger(x[1]) && x[1] > 0) out[x[0] as CargoKind] = x[1];
    return out;
  };
  const time = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
  r.current = known(d.current);
  r.next = known(d.next);
  if (r.next === r.current) r.next = null;
  // The queue after it: known, each once, not the one under way or up next, at most `QUEUE_MAX` in all.
  if (r.next !== null && Array.isArray(d.later))
    for (const x of d.later) {
      const id = known(x);
      if (id !== null && id !== r.current && id !== r.next && !r.later.includes(id) && r.later.length < QUEUE_MAX - 1) r.later.push(id);
    }
  if (r.current !== null) {
    r.got = bag(d.got);
    r.study = time(d.study);
  }
  if (Array.isArray(d.held)) for (const e of d.held) if (Array.isArray(e) && known(e[0])) r.held.set(known(e[0])!, { got: bag(e[1]?.got), study: time(e[1]?.study) });
  if (Array.isArray(d.early))
    for (const e of d.early)
      if (Array.isArray(e) && known(e[0])) {
        const b = bag(e[1]);
        if (Object.keys(b).length > 0) r.early.set(known(e[0])!, b);
      }
  return r;
}
