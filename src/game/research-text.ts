import { CARGO, COIN_ICON, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { iconCounts } from "../economy/goods";
import type { Progress } from "./progress";
import { canResearch, coinsShort, costOf, lacks, QUEUE_MAX, queueOf, queuePlace, studying, studyLeft, studyTime } from "./research";
import { needMet, TECHS, techOf, unlocksOf } from "./tech";
import { ruleOf } from "./things";

/**
 * Research in words and states, for the Research picker (the board's web), the HUD's pill and the school's card.
 * Short: they're read on a phone. `school` is the name of the school goods go to ("Larkfield school"), or null if none
 * is placed yet. Pure: the UI draws from these, tests check them.
 */

const coins = (n: number) => `${n}${COIN_ICON}`;
const label = (id: string) => techOf(id)?.label ?? id;

/** A blueprint's name cut short for the pill: "Bridges and ramps" → "Bridges", "Diesel (Trains tab)" → "Diesel". */
export const shortLabel = (id: string): string => label(id).replace(/\s*\(.*\)$/, "").split(" and ")[0];

/**
 * A blueprint's card in the picker. learned: done. researching: under way (`current`). next: up next. ready: can be
 * picked now. locked: later (needs another blueprint first, or something done). soon: not in the game yet.
 */
export type CardState = "learned" | "researching" | "next" | "ready" | "locked" | "soon";

export function cardState(p: Progress, id: string): CardState {
  if (p.learned.has(id)) return "learned";
  if (techOf(id)?.plan) return "soon";
  const r = p.research;
  if (r.current === id) return "researching";
  if (queuePlace(r, id) > 0) return "next";
  return canResearch(p, id) ? "ready" : "locked";
}

/** One chip of a card's cost: "🪵 6/10" (got of needed), or "🪙 20"; `short` when the coins aren't in hand. */
export interface Chip {
  text: string;
  short?: boolean;
  /** The chip in words, for its tooltip: "Planks: 6 of 10 brought", "Coins: 20 (you have 5)". */
  title: string;
}

/** A good's name in words, lower case: "planks", "grain"; one of a plural one is "1 plank". */
const goodName = (k: CargoKind, n: number): string => {
  const name = CARGO[k].label.toLowerCase();
  return n === 1 && name.endsWith("s") ? name.slice(0, -1) : name;
};

/**
 * Everything a research costs, in words with each icon, so no symbol needs learning: "10 🪵 planks, 6 🌾 grain,
 * 40 🪙 coins" ("nothing" when free). Coins already paid (under way, or set aside) say so: "40 🪙 coins (paid)".
 */
export function costWords(p: Progress, id: string): string {
  const cost = costOf(id);
  const parts = (Object.keys(cost.goods) as CargoKind[]).map((k) => `${cost.goods[k]} ${GOODS_ICON[k]} ${goodName(k, cost.goods[k]!)}`);
  const c = cost.coins ?? 0;
  if (c > 0) parts.push(`${c} ${COIN_ICON} ${c === 1 ? "coin" : "coins"}${paid(p, id) ? " (paid)" : ""}`);
  return parts.join(", ") || "nothing";
}

/**
 * What a research unlocks, in words: the things it lets you make (their tray names), then what it lets you do
 * ("Train routes"), else what it brings: "Switch, Y switch". Fixed per blueprint.
 */
export function unlocksWords(id: string): string {
  const t = techOf(id);
  if (!t) return "";
  const names = unlocksOf(id).map((x) => ruleOf(x)!.label);
  if (t.feature) names.push(t.feature.label);
  return names.length ? names.join(", ") : t.brings;
}

/** Goods got so far toward a research: the current one's, or what a set-aside one kept (none otherwise). */
function gotOf(p: Progress, id: string): Partial<Record<CargoKind, number>> {
  const r = p.research;
  if (r.current === id) return r.got;
  return r.held.get(id)?.got ?? {};
}

/** Its coins are paid already: it's under way, or was started and set aside. */
const paid = (p: Progress, id: string) => p.research.current === id || p.research.held.has(id);

/** A research's cost as chips: each good got of needed, then its coins (from tier 2) unless they're paid. */
export function researchChips(p: Progress, id: string): Chip[] {
  const cost = costOf(id);
  const got = gotOf(p, id);
  const chips: Chip[] = (Object.keys(cost.goods) as CargoKind[]).map((k) => {
    const n = Math.min(got[k] ?? 0, cost.goods[k]!);
    return { text: `${GOODS_ICON[k]} ${n}/${cost.goods[k]}`, title: `${CARGO[k].label}: ${n} of ${cost.goods[k]} brought` };
  });
  const c = cost.coins ?? 0;
  if (c > 0 && !paid(p, id)) chips.push(p.coins < c ? { text: `${COIN_ICON} ${c}`, short: true, title: `Coins: ${c}, not enough yet` } : { text: `${COIN_ICON} ${c}`, title: `Coins: ${c}, paid when it starts` });
  return chips;
}

/** The chips as one line: "🪵 6/10 · 🌾 0/6 · 🪙 20". */
export const chipsText = (chips: readonly Chip[]): string => chips.map((c) => c.text).join(" · ");

/** How far a research's goods are in (0–1), or its study once they are. */
export function researchFill(p: Progress, id: string): number {
  const goods = costOf(id).goods;
  const got = gotOf(p, id);
  let need = 0;
  let have = 0;
  for (const k of Object.keys(goods) as CargoKind[]) {
    need += goods[k]!;
    have += Math.min(got[k] ?? 0, goods[k]!);
  }
  if (p.research.current === id && studying(p)) return Math.min(1, p.research.study / studyTime(id));
  return need > 0 ? have / need : 0;
}

/** What the current research waits for: "bring 4🪵 to Larkfield school", "studying: 12 s", "place a school by a town". */
export function researchWants(p: Progress, school: string | null): string {
  if (studying(p)) return `studying: ${Math.ceil(studyLeft(p))} s`;
  return school ? `bring ${iconCounts(lacks(p))} to ${school}` : "place a school by a town";
}

/** A card the picker can act on (researching, next or ready): its chips, study time, line, and its one button. */
export interface ResearchCardView {
  chips: Chip[];
  /** "20 s study". */
  study: string;
  /** How it stands, in a short line ("bring 4🪵 to Larkfield school", "Next up, after Switches", "Needs a school"). */
  why?: string;
  /** Its button: "Research", "Add to queue" or "Research now" (the swap); none while it's the research under way. */
  action?: string;
  /** In the queue: a second button, "Remove", takes it out (the tap that put it in, again). */
  remove?: boolean;
  /** The button can't be used now (`why` says why). */
  blocked?: boolean;
  /** Goods in (or study done), 0–1, for the one under way. */
  fill?: number;
}

/** "2nd", "3rd", "4th". */
const ordinal = (n: number) => `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/**
 * A card's research view (null for learned, locked and soon). A ready card: Research when nothing is under way or
 * waiting, else Add to queue (held back while the queue is full). One in the queue (#14): Remove, and Research now
 * (it swaps in for the one under way), held back while its coins are short; its line says where it waits ("Next up,
 * after Switches", "3rd in line, after Signals"). The one under way: live progress, no button. With no school placed
 * nothing can be picked: "Needs a school".
 */
export function researchCard(p: Progress, id: string, school: string | null): ResearchCardView | null {
  const state = cardState(p, id);
  if (state !== "ready" && state !== "researching" && state !== "next") return null;
  const r = p.research;
  const base = { chips: researchChips(p, id), study: `${Math.ceil(studyTime(id) / p.research.speed)} s study` };
  if (state === "researching") return { ...base, why: researchWants(p, school), fill: researchFill(p, id) };
  const q = queueOf(r);
  if (state === "next") {
    const place = queuePlace(r, id);
    const short = place === 1 ? coinsShort(p) : r.held.has(id) ? 0 : Math.max(0, (costOf(id).coins ?? 0) - p.coins);
    const ahead = place === 1 ? r.current : q[place - 2];
    const where = place === 1 ? "Next up" : `${ordinal(place)} in line`;
    const after = ahead ? `${where}, after ${shortLabel(ahead)}` : where;
    const why = short === 0 ? after : place === 1 && !r.current ? `Waiting for ${coins(short)}` : `${after} · ${coins(short)} short`;
    return short > 0 ? { ...base, why, action: "Research now", blocked: true, remove: true } : { ...base, why, action: "Research now", remove: true };
  }
  const queueing = r.current !== null || q.length > 0;
  const action = queueing ? "Add to queue" : "Research";
  if (!school) return { ...base, why: "Needs a school", action, blocked: true };
  if (queueing && q.length >= QUEUE_MAX) return { ...base, why: `The queue is full (${QUEUE_MAX})`, action, blocked: true };
  return { ...base, action };
}

/** The pill on the HUD: a name and a count (shown as "📘 Bridges 6/10🪵"), how far along, and whether to pick one. */
export interface PillView {
  name: string;
  count: string;
  fill: number;
  /** Nothing picked: "Pick research". */
  idle: boolean;
  /** How many more wait in the queue behind the one shown (#14): a "+2" on the pill; 0 for none. */
  more: number;
}

/**
 * The HUD's research pill: the research under way and its first good still lacking ("Bridges", "6/10🪵"), its study
 * time left once the goods are in ("12 s"), the one waiting for coins ("Routes", "5/20🪙"), or "Pick research" with
 * nothing picked. Hidden (null) with nothing picked and no school placed.
 */
export function pillView(p: Progress, hasSchool: boolean): PillView | null {
  const r = p.research;
  const queued = queueOf(r).length;
  if (r.current) {
    const id = r.current;
    if (studying(p)) return { name: shortLabel(id), count: `${Math.ceil(studyLeft(p))} s`, fill: researchFill(p, id), idle: false, more: queued };
    const goods = costOf(id).goods;
    const k = (Object.keys(goods) as CargoKind[]).find((x) => (r.got[x] ?? 0) < goods[x]!)!;
    return { name: shortLabel(id), count: `${r.got[k] ?? 0}/${goods[k]}${GOODS_ICON[k]}`, fill: researchFill(p, id), idle: false, more: queued };
  }
  if (r.next) {
    const need = costOf(r.next).coins ?? 0;
    const short = coinsShort(p);
    if (short > 0) return { name: shortLabel(r.next), count: `${need - short}/${coins(need)}`, fill: (need - short) / need, idle: false, more: queued - 1 };
  }
  return hasSchool || r.next ? { name: "Pick", count: "research", fill: 0, idle: true, more: 0 } : null;
}

/**
 * The research the pill shows (`pillView`): the one under way, else the one up next while it waits for coins; null
 * with "Pick research" (the picker then opens as it would: on the goal's research, or the card showing). A tap on the
 * pill opens the picker on it.
 */
export function pillResearch(p: Progress): string | null {
  const r = p.research;
  if (r.current) return r.current;
  return r.next && coinsShort(p) > 0 ? r.next : null;
}

/** The pill in one line: "📘 Bridges 6/10🪵", "📘 Pick research" ("" when it's hidden). */
export const pillText = (v: PillView | null): string => (v ? `📘 ${v.name} ${v.count}${v.more > 0 ? ` +${v.more}` : ""}` : "");

/**
 * What the pill shows depends on: the research's version (a pick, a delivery, a whole second of study), whether a
 * school is placed, and the coins while a research waits for them. Asked on the workshop's clock; the pill is redrawn
 * only when it changes.
 */
export function pillKey(p: Progress, hasSchool: boolean): string {
  const r = p.research;
  const waiting = r.current === null && r.next !== null && coinsShort(p) > 0;
  return `${r.version}|${hasSchool ? 1 : 0}|${waiting ? p.coins : ""}`;
}

/** Every research's coins, lowest first, each once: a card's coins chip goes red below its price. */
let coinPrices: number[] | null = null;

/**
 * What the Research picker shows depends on, as a key: the research's version (a pick, a delivery, a second of study),
 * the coins only as far as the picker shows them (which prices they reach, and what the one up next is short), what's
 * learned, each requirement met or not (a school beside a city among them; riders while one counts them),
 * the school's name and the goal. The picker is rebuilt only when this changes, not on every coin or counted load (QA:
 * it rebuilt every second while trains ran). A lookup over the blueprints: cheap enough for the workshop's clock.
 */
export function pickerKey(p: Progress, school: string | null, goal: string): string {
  coinPrices ??= [...new Set(TECHS.map((t) => t.research.coins ?? 0).filter((c) => c > 0))].sort((a, b) => a - b);
  let reached = 0;
  while (reached < coinPrices.length && coinPrices[reached] <= p.coins) reached++;
  let met = "";
  let riders = false;
  for (const t of TECHS) {
    if (p.learned.has(t.id)) continue;
    for (const n of t.requires) {
      met += needMet(p, n) ? "1" : "0";
      riders ||= n.kind === "count" && n.stat === "riders";
    }
  }
  return `${p.research.version}|${reached}|${coinsShort(p)}|${p.learned.size}|${met}|${riders ? p.riders : ""}|${school ?? ""}|${goal}`;
}

/**
 * The goal's research to open the picker on: the goal's blueprint, while nothing is under way and it can be picked
 * (null otherwise). Nothing is picked without a tap.
 */
export function goalPick(p: Progress, blueprint: string | undefined, hasSchool: boolean): string | null {
  if (!blueprint || !hasSchool || p.research.current !== null) return null;
  return canResearch(p, blueprint) ? blueprint : null;
}

/**
 * "Show me" for a goal after a blueprint: open the picker on it (the blueprint), once a school is placed and while
 * it's still to pick (not learned, not under way). Null: show the goal on the map as usual (where to place the school,
 * or the school the goods go to).
 */
export function showMePick(p: Progress, blueprint: string | undefined, hasSchool: boolean): string | null {
  if (!blueprint || !hasSchool || p.learned.has(blueprint) || p.research.current === blueprint) return null;
  return canResearch(p, blueprint) ? blueprint : null;
}

/** A key that changes whenever the school's card would (cheap enough to ask every frame the card is open). */
export const schoolCardKey = (p: Progress): number => p.research.version * 4 + (p.research.current ? 1 : 0) + (p.research.next ? 2 : 0);

/** The school's card: the current research's goods (got of needed), a line saying how it stands, and `idle` (nothing
 * under way, nothing up next: the card offers the picker). */
export function schoolCard(p: Progress): { piles: { label: string; count: number; cap: number }[]; note: string; idle: boolean } {
  const r = p.research;
  if (!r.current) {
    const short = coinsShort(p);
    if (!r.next) return { piles: [], note: "Idle: pick research", idle: true };
    return { piles: [], note: `Next up: ${label(r.next)}${short > 0 ? ` (${coins(short)} short)` : ""}${r.later.length > 0 ? `, then ${r.later.length} more` : ""}`, idle: false };
  }
  const queued = queueOf(r).length;
  const then = queued > 0 ? ` · ${queued} in queue` : "";
  const goods = costOf(r.current).goods;
  const piles = (Object.keys(goods) as CargoKind[]).map((k) => ({ label: GOODS_ICON[k], count: r.got[k] ?? 0, cap: goods[k]! }));
  // (A college studies twice as fast: said while it matters, the goods all in.)
  const fast = r.speed > 1 ? " (college: 2×)" : "";
  return { piles, note: (studying(p) ? `Studying ${label(r.current)}: ${Math.ceil(studyLeft(p))} s${fast}` : `Researching ${label(r.current)}`) + then, idle: false };
}

/** The school's idle line, as a research finishes with nothing up next: "Larkfield school is idle: pick what to learn next". */
export const idleText = (school: string): string => `${school} is idle: pick what to learn next`;

/**
 * Says the school's idle (`idleText`) once per finish: a research `id` just learned with nothing under way or up next
 * (and a school to name). The same finish asked again (in the same game) says nothing; null with something still to
 * do. The pill and the school's card show it from then on.
 */
export class IdleNotice {
  private told: { p: Progress; id: string } | null = null;

  finished(p: Progress, id: string, school: string | null): string | null {
    const r = p.research;
    if (!school || r.current !== null || r.next !== null) return null;
    if (this.told?.p === p && this.told.id === id) return null;
    this.told = { p, id };
    return idleText(school);
  }
}
