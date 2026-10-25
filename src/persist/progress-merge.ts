import { isTaken, Progress, TAKEN_KEPT, type ProgressData, type Taken } from "../game/progress";
import { costOf, type ResearchData } from "../game/research";
import type { Merger } from "./cloud";

/**
 * Game mode's progress from two devices that both played on since they last matched, made one, so neither's earnings
 * are lost (cloud saves; the CoS's rules of 2026-10-24). Also when their layouts clashed: the railway is the layout
 * winner's, but the progress is still merged, so a session's earnings aren't rolled back by one piece of track.
 *
 * - coins, counters (riders, `counts`), the toy box (`owned`): the base plus what each side earned or spent since;
 * - the furthest reached: `bestLevel` (max), `firstFlour` (either), blueprints learned (both), goals done (both);
 * - research: what either learned is done; one being studied on both: the base plus the goods each brought (no more
 *   than it needs), and the most study; two different ones, the one further along stays current and the other waits
 *   next (or keeps its goods aside);
 * - the reward offers waiting: one per town and level; one taken on either side (in the base, gone from that side)
 *   stays taken; one taken on both pays once (`bothTook`: the remote's take is undone before the sums);
 * - the player's own queue (`orders`, `making`) and `fieldsPlanted` (fields are land) go with the world kept: the
 *   later copy's (`later`).
 *
 * `base` is the progress as both last had it (undefined: not known; see `baseFor`).
 */
export function mergeProgress(base: ProgressData | undefined, local: ProgressData, theirs: ProgressData, later: "local" | "remote"): ProgressData {
  const b = baseFor(base, local, theirs);
  const remote = undoTakes(theirs, bothTook(b, local, theirs));
  const latest = later === "local" ? local : remote;
  const sum = (bn: number | undefined, ln: number | undefined, rn: number | undefined) => Math.max(0, (bn ?? 0) + ((ln ?? 0) - (bn ?? 0)) + ((rn ?? 0) - (bn ?? 0)));
  const learned = [...new Set([...local.learned, ...remote.learned])];
  return {
    owned: sumMaps(b.owned, local.owned, remote.owned),
    learned,
    offers: mergeOffers(b.offers ?? [], local.offers ?? [], remote.offers ?? []),
    coins: sum(b.coins, local.coins, remote.coins),
    orders: [...(latest.orders ?? [])],
    making: !!latest.making,
    fieldsPlanted: latest.fieldsPlanted ?? 0,
    riders: sum(b.riders, local.riders, remote.riders),
    bestLevel: Math.max(local.bestLevel ?? 0, remote.bestLevel ?? 0),
    firstFlour: !!local.firstFlour || !!remote.firstFlour,
    counts: sumMaps(b.counts ?? [], local.counts ?? [], remote.counts ?? []),
    research: mergeResearch(local.research, remote.research, new Set(learned), b.research),
    ...mergeTaken(local, theirs),
    // (The game it is now: the cloud's copy's, whichever railway is kept, so the next merge between these two has the
    // cloud's copy, of the same game, to count from. Else two games merged would add up again at every sync.)
    ...((theirs.origin ?? local.origin) !== undefined ? { origin: theirs.origin ?? local.origin } : {}),
  };
}

/**
 * What the two had in common, to count each side's gains from (CoS, QA's first-PUT race: with the winner's copy as
 * the base, its gains counted as nothing). By the game each is (`origin`, made when a game starts):
 * - the copy both last matched (`base`), when it's of this same game: exact;
 * - none, and two games (or a fresh code, each device with its own): a new game's progress, so each side's gains
 *   on top of its starting box both count, and the box once;
 * - none, but one game on both (it reached the other device through the cloud, whose copy in common is gone): the
 *   least of each, so nothing they had in common counts twice. (A gain on both sides may count as one; it never
 *   counts as two.)
 */
function baseFor(base: ProgressData | undefined, local: ProgressData, remote: ProgressData): ProgressData {
  if (base && base.origin === local.origin && base.origin === remote.origin) return base;
  if (local.origin !== remote.origin) return Progress.fresh().toJSON();
  const min = (a: readonly [string, number][], b: readonly [string, number][]): [string, number][] => {
    const m = new Map(b);
    return a.filter(([k]) => m.has(k)).map(([k, n]) => [k, Math.min(n, m.get(k)!)]);
  };
  return {
    owned: min(local.owned, remote.owned),
    learned: [],
    coins: Math.min(local.coins ?? 0, remote.coins ?? 0),
    riders: Math.min(local.riders ?? 0, remote.riders ?? 0),
    counts: min(local.counts ?? [], remote.counts ?? []),
    origin: local.origin,
  };
}

const offerKey = (from: unknown, level: unknown) => `${String(from ?? "")}\u0000${String(level ?? "")}`;
const keyOf = (o: unknown) => offerKey((o as { from?: unknown } | null)?.from, (o as { level?: unknown } | null)?.level);
/** A side's rewards taken (as stored: only the ones that read). */
const takenOf = (d: ProgressData): Taken[] => (Array.isArray(d.taken) ? d.taken.filter(isTaken) : []);

/**
 * The remote's rewards from offers both sides took (in the base, gone from both, and a take of it recorded on both).
 * (QA: a city's offer synced to two devices, the 200 coins taken on both, paid 400.)
 */
function bothTook(base: ProgressData, local: ProgressData, remote: ProgressData): Taken[] {
  const offers = (d: ProgressData) => new Set((d.offers ?? []).map(keyOf));
  const inBase = offers(base);
  const inLocal = offers(local);
  const inRemote = offers(remote);
  const tookHere = new Set(takenOf(local).map(keyOf));
  return takenOf(remote).filter((t) => {
    const k = keyOf(t);
    return inBase.has(k) && !inLocal.has(k) && !inRemote.has(k) && tookHere.has(k);
  });
}

/** A side's progress as if these rewards weren't taken there (coins, things, and goods still in the same research). */
function undoTakes(d: ProgressData, takes: readonly Taken[]): ProgressData {
  if (takes.length === 0) return d;
  const less = (bag: [string, number][], minus: readonly [string, number][]): [string, number][] => {
    const m = new Map(bag);
    for (const [k, n] of minus) m.set(k, (m.get(k) ?? 0) - n);
    return [...m];
  };
  let coins = d.coins ?? 0;
  let owned = d.owned;
  let research = d.research;
  for (const t of takes) {
    coins -= t.coins ?? 0;
    if (t.owned) owned = less(owned, t.owned);
    if (t.goods && research && t.to !== undefined) {
      if (research.current === t.to) research = { ...research, got: less(research.got, t.goods) };
      else if (research.held?.some(([id]) => id === t.to)) research = { ...research, held: research.held.map(([id, h]) => [id, id === t.to ? { ...h, got: less(h.got, t.goods!) } : h]) };
    }
  }
  return { ...d, coins, owned, research };
}

/** The rewards taken, from both (one per offer), the latest kept. */
function mergeTaken(local: ProgressData, remote: ProgressData): { taken?: Taken[] } {
  const seen = new Set<string>();
  const out: Taken[] = [];
  for (const t of [...takenOf(local), ...takenOf(remote)]) {
    const k = keyOf(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.length > 0 ? { taken: out.slice(-TAKEN_KEPT) } : {};
}

/** Goals done on either. */
export function mergeGoals(local: readonly string[], remote: readonly string[]): string[] {
  return [...new Set([...local, ...remote])];
}

/** Per key: the base plus each side's change since (never below 0; a key at 0 is left out). */
function sumMaps(base: readonly [string, number][], local: readonly [string, number][], remote: readonly [string, number][]): [string, number][] {
  const b = new Map(base);
  const l = new Map(local);
  const r = new Map(remote);
  const out: [string, number][] = [];
  for (const k of new Set([...l.keys(), ...r.keys(), ...b.keys()])) {
    const bn = b.get(k) ?? 0;
    const n = Math.max(0, bn + ((l.get(k) ?? 0) - bn) + ((r.get(k) ?? 0) - bn));
    if (n > 0) out.push([k, n]);
  }
  return out;
}

/**
 * The offers waiting, from both: one per town and level (the same growth seen on both draws different cards: it's one
 * offer, the local one kept). One in the base that's gone from either side was taken there: it stays taken. (QA: one
 * growth on two devices gave two rewards.)
 */
export function mergeOffers(base: readonly unknown[], local: readonly unknown[], remote: readonly unknown[]): unknown[] {
  const inBase = new Set(base.map(keyOf));
  const inLocal = new Set(local.map(keyOf));
  const inRemote = new Set(remote.map(keyOf));
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const o of [...local, ...remote]) {
    const k = keyOf(o);
    if (seen.has(k)) continue;
    seen.add(k);
    if (inBase.has(k) && !(inLocal.has(k) && inRemote.has(k))) continue;
    out.push(o);
  }
  return out;
}

type Bag = [string, number][];

/**
 * A research's goods brought on both: what it had in the base (as current, or kept aside) plus what each side brought
 * since, never more than it needs (`costOf`).
 */
function sumGoods(id: string, base: ResearchData | undefined, local: Bag, remote: Bag): Bag {
  const had = new Map<string, number>(base?.current === id ? base.got : (base?.held?.find(([h]) => h === id)?.[1].got ?? []));
  const need = costOf(id).goods;
  const l = new Map(local);
  const r = new Map(remote);
  const out: Bag = [];
  for (const k of new Set([...l.keys(), ...r.keys()])) {
    const b = had.get(k) ?? 0;
    const n = Math.min(need[k] ?? Infinity, Math.max(0, b + ((l.get(k) ?? 0) - b) + ((r.get(k) ?? 0) - b)));
    if (n > 0) out.push([k, n]);
  }
  return out;
}
const total = (g: Bag) => g.reduce((n, [, k]) => n + k, 0);
const maxBags = (a: Bag, b: Bag): Bag => {
  const m = new Map(a);
  for (const [k, n] of b) m.set(k, Math.max(m.get(k) ?? 0, n));
  return [...m];
};

/**
 * The research, from both: blueprints learned on either side are no longer studied. The same one current on both:
 * the goods each brought added (`sumGoods`), and the most study. Different ones: the one further along (more goods in, then more study)
 * stays current; the other goes next if that's free, else it keeps its goods aside (`held`, as a swap does).
 */
export function mergeResearch(local: ResearchData | undefined, remote: ResearchData | undefined, learned: ReadonlySet<string>, base?: ResearchData): ResearchData | undefined {
  if (!local || !remote) return local ?? remote;
  const open = (id: string | null) => (id !== null && !learned.has(id) ? id : null);
  const held = new Map<string, { got: Bag; study: number }>();
  for (const [id, h] of [...(local.held ?? []), ...(remote.held ?? [])]) {
    if (learned.has(id)) continue;
    const was = held.get(id);
    held.set(id, was ? { got: maxBags(was.got, h.got), study: Math.max(was.study, h.study) } : { got: [...h.got], study: h.study });
  }
  const lc = open(local.current);
  const rc = open(remote.current);
  let current: string | null;
  let got: Bag;
  let study: number;
  let other: { id: string; got: Bag; study: number } | null = null;
  if (lc !== null && lc === rc) {
    current = lc;
    got = sumGoods(lc, base, local.got, remote.got);
    study = Math.max(local.study, remote.study);
  } else {
    const l = { id: lc, got: lc ? local.got : [], study: lc ? local.study : 0 };
    const r = { id: rc, got: rc ? remote.got : [], study: rc ? remote.study : 0 };
    const ahead = (x: typeof l, y: typeof l) => x.id !== null && (y.id === null || total(x.got) > total(y.got) || (total(x.got) === total(y.got) && x.study >= y.study));
    const [first, second] = ahead(l, r) ? [l, r] : [r, l];
    current = first.id;
    got = first.got;
    study = first.study;
    if (second.id !== null) other = { id: second.id, got: second.got, study: second.study };
  }
  // What's next: either side's, as long as it's still to learn and isn't the current.
  let next = [open(local.next), open(remote.next)].find((id) => id !== null && id !== current) ?? null;
  if (other && other.id !== current) {
    if (next === null || next === other.id) next = other.id;
    // (Its goods kept aside, as a swap keeps them, to carry on with when it's picked again.)
    if (total(other.got) > 0 || other.study > 0) {
      const was = held.get(other.id);
      held.set(other.id, was ? { got: maxBags(was.got, other.got), study: Math.max(was.study, other.study) } : { got: other.got, study: other.study });
    }
  }
  if (current !== null) held.delete(current);
  return { current, next, got, study, ...(held.size > 0 ? { held: [...held] } : {}) };
}

/**
 * The cloud's merger for Game mode (`CloudSync`'s `merge`): its progress and goals keys, as stored (JSON). A side
 * whose progress doesn't read is left as the other's.
 */
export function gameMerger(keys: { progress: string; goals: string }): Merger {
  const read = <T>(raw: string | null | undefined): T | undefined => {
    try {
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  };
  const list = (raw: string | null | undefined) => (read<unknown>(raw) as unknown[] | undefined)?.filter((x): x is string => typeof x === "string") ?? [];
  return {
    keys: { game: [keys.progress, keys.goals] },
    merge(_mode, base, local, remote, later) {
      const l = read<ProgressData>(local[keys.progress]);
      const r = read<ProgressData>(remote[keys.progress]);
      const progress = l && r ? JSON.stringify(mergeProgress(read<ProgressData>(base[keys.progress]), l, r, later)) : (local[keys.progress] ?? remote[keys.progress] ?? null);
      return { [keys.progress]: progress, [keys.goals]: JSON.stringify(mergeGoals(list(local[keys.goals]), list(remote[keys.goals]))) };
    },
  };
}
