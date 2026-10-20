import type { CargoKind } from "../economy/cargo";
import type { Economy } from "../economy/economy";
import type { Bag } from "../economy/goods";
import type { ResearchCost } from "./blueprints";
import type { Progress } from "./progress";
import { built, learnAuto, ready, techOf } from "./tech";

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
  /** Goods delivered into `current` so far. */
  got: Bag;
  /** Seconds studied, once its goods are all in. */
  study: number;
  /** Researches started (coins paid) and swapped out for another, with what they'd got: nothing is lost. */
  readonly held: Map<string, { got: Bag; study: number }>;
  /** Goes up whenever anything a card shows changes (not saved): cards redraw on a change of it, never per frame. */
  version: number;
}

export const newResearch = (): Research => ({ current: null, next: null, got: {}, study: 0, held: new Map(), version: 0 });

/** Seconds of study once a research's goods are in, by tier, at a school's speed of 1 (a college: faster, from P4). */
export const STUDY_SECONDS: Readonly<Record<1 | 2 | 3, number>> = { 1: 20, 2: 45, 3: 90 };

const NONE: ResearchCost = { goods: {} };

/** What researching a blueprint takes: goods, and from tier 2 coins. */
export function costOf(id: string): ResearchCost {
  return techOf(id)?.research ?? NONE;
}

/** Seconds of study a blueprint takes (at speed 1). */
export function studyTime(id: string): number {
  return STUDY_SECONDS[techOf(id)?.tier ?? 1];
}

/** Can it be researched now: built, not learned, what it needs learned and what it requires done, and not by itself? */
export function canResearch(p: Progress, id: string): boolean {
  const t = techOf(id);
  return !!t && built(t) && t.learn === "board" && ready(p, id);
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
    r.next = id;
    return promote(p) ? "current" : "next";
  }
  if (r.next !== id) {
    r.next = id;
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
  r.next = old;
  return "current";
}

/** Start `next` if nothing is current and it can be: coins paid (none if it was started before). */
function promote(p: Progress): boolean {
  const r = p.research;
  if (r.current !== null || r.next === null) return false;
  const id = r.next;
  if (!canResearch(p, id)) {
    // Learned meanwhile (a town's offer): nothing to start.
    r.next = null;
    r.held.delete(id);
    r.version++;
    return false;
  }
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
  r.current = id;
  r.next = null;
  r.version++;
  return true;
}

/** How many more of `kind` the current research needs (0: none, or nothing is being researched). A lookup. */
export function lacking(p: Progress, kind: CargoKind): number {
  const r = p.research;
  if (r.current === null) return 0;
  const want = costOf(r.current).goods[kind] ?? 0;
  return want > 0 ? Math.max(0, want - (r.got[kind] ?? 0)) : 0;
}

/** Everything the current research still needs (empty: none, or nothing picked). */
export function lacks(p: Progress): Bag {
  const out: Bag = {};
  const r = p.research;
  if (r.current === null) return out;
  for (const k of Object.keys(costOf(r.current).goods) as CargoKind[]) {
    const n = lacking(p, k);
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Are the current research's goods all in (it's being studied)? */
export function studying(p: Progress): boolean {
  const r = p.research;
  if (r.current === null) return false;
  for (const k of Object.keys(costOf(r.current).goods) as CargoKind[]) if (lacking(p, k) > 0) return false;
  return true;
}

/** `n` of `kind` reach a school: the current research takes what it lacks. Returns how many it took. */
export function deliver(p: Progress, kind: CargoKind, n: number): number {
  const take = Math.min(n, lacking(p, kind));
  if (take <= 0) return 0;
  const r = p.research;
  r.got[kind] = (r.got[kind] ?? 0) + take;
  r.version++;
  return take;
}

/** Coins still short for the research waiting in `next` (0: none waiting, or it can start). */
export function coinsShort(p: Progress): number {
  const r = p.research;
  if (r.next === null || r.held.has(r.next)) return 0;
  return Math.max(0, (costOf(r.next).coins ?? 0) - p.coins);
}

/** Seconds of study left for the current research (its whole study time until its goods are in). */
export function studyLeft(p: Progress, speed = 1): number {
  const r = p.research;
  return r.current === null ? 0 : Math.max(0, (studyTime(r.current) - r.study) / speed);
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
 * study once the goods are in, and when the study is done learn it (and what comes by itself with it) and start
 * `next`. Returns the blueprint learned, or null. Cheap: a few lookups when nothing happens.
 */
export function tick(p: Progress, seconds: number, speed = 1): string | null {
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
  if (r.study < studyTime(id)) {
    if (Math.ceil(studyLeft(p, speed)) !== before) r.version++;
    return null;
  }
  p.learned.add(id);
  p.board.delete(id);
  r.current = null;
  r.got = {};
  r.study = 0;
  r.version++;
  learnAuto(p);
  promote(p);
  return id;
}

/**
 * Goods a train (or a hand) brings to a school go into the research (what a school takes at all is `lacking`, asked
 * through the economy's `accepts`). `delivered` hears of each unit taken. Game mode only; `detachResearch` undoes it.
 */
export function attachResearch(economy: Economy, progress: () => Progress, delivered?: (kind: CargoKind) => void): void {
  economy.intoSink = (d, kind) => {
    if (d.role === "school" && deliver(progress(), kind, 1) > 0) delivered?.(kind);
  };
  economy.sinkWants = (kind) => lacking(progress(), kind);
}

export function detachResearch(economy: Economy): void {
  economy.intoSink = null;
  economy.sinkWants = null;
}

/** Saved form (see `Progress.toJSON`). */
export interface ResearchData {
  current: string | null;
  next: string | null;
  got: [string, number][];
  study: number;
  held?: [string, { got: [string, number][]; study: number }][];
}

const bagData = (b: Bag): [string, number][] => Object.entries(b).filter(([, n]) => (n ?? 0) > 0) as [string, number][];

export function researchToJSON(r: Research): ResearchData {
  return { current: r.current, next: r.next, got: bagData(r.got), study: r.study, ...(r.held.size > 0 ? { held: [...r.held].map(([id, h]) => [id, { got: bagData(h.got), study: h.study }] as [string, { got: [string, number][]; study: number }]) } : {}) };
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
  if (r.current !== null) {
    r.got = bag(d.got);
    r.study = time(d.study);
  }
  if (Array.isArray(d.held)) for (const e of d.held) if (Array.isArray(e) && known(e[0])) r.held.set(known(e[0])!, { got: bag(e[1]?.got), study: time(e[1]?.study) });
  return r;
}
