import type { ProgressData } from "../game/progress";
import type { ResearchData } from "../game/research";
import type { Merger } from "./cloud";

/**
 * Game mode's progress from two devices that both played on (neither changed the railway's layout since they last
 * matched), made one, so neither's earnings are lost (cloud saves; the CoS's rules of 2026-10-24):
 *
 * - coins, counters (riders, `counts`), the toy box (`owned`): the base plus what each side earned or spent since;
 * - the furthest reached: `bestLevel` (max), `firstFlour` (either), blueprints learned (both), goals done (both);
 * - research: what either learned is done; one being studied on both keeps the most of each good and of the study;
 *   two different ones, the one further along stays current and the other waits next (or keeps its goods aside);
 * - the reward cards waiting: both sides' (once each);
 * - the player's own queue (`orders`, `making`) and `fieldsPlanted` (fields are land) go with the world kept: the
 *   later copy's (`later`).
 *
 * `base` is the progress as both last had it (undefined: not known, so the remote's).
 */
export function mergeProgress(base: ProgressData | undefined, local: ProgressData, remote: ProgressData, later: "local" | "remote"): ProgressData {
  const b = base ?? remote;
  const latest = later === "local" ? local : remote;
  const sum = (bn: number | undefined, ln: number | undefined, rn: number | undefined) => Math.max(0, (bn ?? 0) + ((ln ?? 0) - (bn ?? 0)) + ((rn ?? 0) - (bn ?? 0)));
  const learned = [...new Set([...local.learned, ...remote.learned])];
  return {
    owned: sumMaps(b.owned, local.owned, remote.owned),
    learned,
    offers: unionOffers(local.offers ?? [], remote.offers ?? []),
    coins: sum(b.coins, local.coins, remote.coins),
    orders: [...(latest.orders ?? [])],
    making: !!latest.making,
    fieldsPlanted: latest.fieldsPlanted ?? 0,
    riders: sum(b.riders, local.riders, remote.riders),
    bestLevel: Math.max(local.bestLevel ?? 0, remote.bestLevel ?? 0),
    firstFlour: !!local.firstFlour || !!remote.firstFlour,
    counts: sumMaps(b.counts ?? [], local.counts ?? [], remote.counts ?? []),
    research: mergeResearch(local.research, remote.research, new Set(learned)),
  };
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

/** Both sides' offers, once each (the same town's same cards are one offer). */
function unionOffers(local: readonly unknown[], remote: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const o of [...local, ...remote]) {
    const key = JSON.stringify(o);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

type Bag = [string, number][];
const total = (g: Bag) => g.reduce((n, [, k]) => n + k, 0);
const maxBags = (a: Bag, b: Bag): Bag => {
  const m = new Map(a);
  for (const [k, n] of b) m.set(k, Math.max(m.get(k) ?? 0, n));
  return [...m];
};

/**
 * The research, from both: blueprints learned on either side are no longer studied. The same one current on both:
 * the most of each good and of the study. Different ones: the one further along (more goods in, then more study)
 * stays current; the other goes next if that's free, else it keeps its goods aside (`held`, as a swap does).
 */
export function mergeResearch(local: ResearchData | undefined, remote: ResearchData | undefined, learned: ReadonlySet<string>): ResearchData | undefined {
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
    got = maxBags(local.got, remote.got);
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
