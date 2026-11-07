import { CARGO, COIN_ICON, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { iconCounts } from "../economy/goods";
import type { Progress } from "./progress";
import { describeNeed, type Need } from "./blueprints";
import { aheadLacking, canResearch, chainBlock, chainOf, coinsShort, costOf, lacks, missingNeeds, nowTarget, QUEUE_MAX, queueOf, queuePlace, READING_ROOM, studying, studyLeft, studyTime } from "./research";
import { needMet, seenOf, TECHS, techOf, unlocksOf } from "./tech";
import { ruleOf } from "./things";
import { capital, listed } from "../lib/words";

/**
 * Research in words and states, for the Research picker (the board's web), the HUD's pill and the school's card.
 * Short: they're read on a phone. `school` is the name of the school goods go to ("Larkfield school"), or null if none
 * is placed yet. Pure: the UI draws from these, tests check them.
 */

const coins = (n: number) => `${n}${COIN_ICON}`;
const label = (id: string) => techOf(id)?.label ?? id;

/** A blueprint's name cut short for the pill: "Bridges and ramps" → "Bridges", "Diesel (Trains tab)" → "Diesel". */
export const shortLabel = (id: string): string => techOf(id)?.short ?? label(id).replace(/\s*\(.*\)$/, "").split(" and ")[0];

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

/** One chip of a card's cost: "\uE000 6/10" (got of needed), or "🪙 20"; `short` when the coins aren't in hand. */
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
 * Everything a research costs, in words with each icon, so no symbol needs learning: "10 \uE000 planks, 6 🌾 grain,
 * 40 🪙 coins" ("nothing" when free). Coins already paid (under way, or set aside) say so: "40 🪙 coins (paid)".
 */
export function costWords(p: Progress, id: string): string {
  const cost = costOf(id, p.learned);
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

/** A requirement as something to do, for a locked tray tile: "reach a town", "carry 100 people (40 so far)". */
function needToDo(p: Progress, n: Need): string {
  switch (n.kind) {
    case "count": {
      const got = n.stat === "riders" ? p.riders : n.stat === "blueprints" ? p.learned.size : (p.counts.get(n.stat) ?? 0);
      const what: Record<string, string> = { riders: `carry ${n.n} people`, blueprints: `learn ${n.n} things`, loadsMoved: `move ${n.n} loads`, logsCut: `cut ${n.n} logs`, planksSawn: `saw ${n.n} planks`, stoneCut: `cut ${n.n} stone`, grainGrown: `grow ${n.n} grain`, flourGround: `grind ${n.n} flour` };
      return `${what[n.stat] ?? `${n.n} ${n.stat}`} (${got} so far)`;
    }
    case "delivered":
      return `deliver ${n.n} ${n.good}`;
    case "level": {
      const names = n.towns && n.towns > 1 ? ["", "villages", "towns", "cities", "cities ★"] : ["", "a village", "a town", "a city", "a city ★"];
      return `reach ${n.towns && n.towns > 1 ? `${n.towns} ${names[n.level]}` : names[n.level]}`;
    }
    case "landmark":
      return `get ${n.label}`;
    case "place":
      return `have ${n.text}`;
  }
}

const cap = capital;
const and = (xs: string[]) => listed(xs);

/**
 * How a locked tray tile is unlocked, in plain words, and the research to open the picker on (null if none can show
 * there): "Research Signals to unlock"; "Research Switches, then Signals"; "Reach a town, then research Big stations"; "Coming
 * soon". `jump` is the blueprint itself if the picker shows its card, else the nearest blueprint before it that shows
 * (one a "?" or not shown yet can't be opened on).
 */
export function unlockHow(p: Progress, id: string): { text: string; jump: string | null } {
  const t = techOf(id);
  if (!t) return { text: "Not learned yet", jump: null };
  const seen = seenOf(p);
  const shows = (x: string) => seen.get(x) === "shown";
  // The nearest blueprint on the way that the picker shows: this one, else what it needs first (breadth first).
  const jumpOf = (): string | null => {
    const queue = [id];
    const been = new Set<string>();
    while (queue.length) {
      const x = queue.shift()!;
      if (been.has(x)) continue;
      been.add(x);
      if (shows(x)) return x;
      for (const n of techOf(x)?.needs ?? []) if (!p.learned.has(n)) queue.push(n);
    }
    return null;
  };
  const name = shortLabel(id);
  if (p.learned.has(id)) return { text: `${name}: learned`, jump: null };
  if (t.plan) return { text: `Coming soon (${name})`, jump: shows(id) ? id : null };
  const r = p.research;
  if (r.current === id) return { text: `Researching ${name} now: it unlocks then`, jump: id };
  if (queuePlace(r, id) > 0) return { text: `${name} is next in Research: it unlocks then`, jump: id };
  if (canResearch(p, id)) return { text: `Research ${name} to unlock`, jump: id };
  const missing = t.needs.filter((n) => !p.learned.has(n)).map(shortLabel);
  const unmet = t.requires.filter((n) => !needMet(p, n)).map((n) => needToDo(p, n));
  const first = [...(missing.length ? [`research ${and(missing)}`] : []), ...unmet];
  if (first.length === 0) return { text: `Research ${name} to unlock`, jump: jumpOf() };
  if (unmet.length === 0) return { text: `Research ${and(missing)}, then ${name}`, jump: jumpOf() };
  return { text: `${cap(first.join(", "))}, then research ${name}`, jump: jumpOf() };
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
  const cost = costOf(id, p.learned);
  const got = gotOf(p, id);
  const chips: Chip[] = (Object.keys(cost.goods) as CargoKind[]).map((k) => {
    const n = Math.min(got[k] ?? 0, cost.goods[k]!);
    return { text: `${GOODS_ICON[k]} ${n}/${cost.goods[k]}`, title: `${CARGO[k].label}: ${n} of ${cost.goods[k]} brought` };
  });
  const c = cost.coins ?? 0;
  if (c > 0 && !paid(p, id)) chips.push(p.coins < c ? { text: `${COIN_ICON} ${c}`, short: true, title: `Coins: ${c}, not enough yet` } : { text: `${COIN_ICON} ${c}`, title: `Coins: ${c}, paid when it starts` });
  return chips;
}

/** The chips as one line: "\uE000 6/10 · 🌾 0/6 · 🪙 20". */
export const chipsText = (chips: readonly Chip[]): string => chips.map((c) => c.text).join(" · ");

/** How far a research's goods are in (0–1), or its study once they are. */
export function researchFill(p: Progress, id: string): number {
  const goods = costOf(id, p.learned).goods;
  const got = gotOf(p, id);
  let need = 0;
  let have = 0;
  for (const k of Object.keys(goods) as CargoKind[]) {
    need += goods[k]!;
    have += Math.min(got[k] ?? 0, goods[k]!);
  }
  if (p.research.current === id && studying(p)) return Math.min(1, p.research.study / studyTime(id, p.learned));
  return need > 0 ? have / need : 0;
}

/** What the current research waits for: "bring 4\uE000 to Larkfield school", "studying: 12 s", "place a school by a town". */
export function researchWants(p: Progress, school: string | null): string {
  if (studying(p)) return `studying: ${Math.ceil(studyLeft(p))} s`;
  return school ? `bring ${iconCounts(lacks(p))} to ${school}` : "place a school by a town";
}

/** A card the picker can act on (researching, next or ready): its chips, study time, line, and its one button. */
export interface ResearchCardView {
  chips: Chip[];
  /** "20 s study". */
  study: string;
  /** How it stands, in a short line ("bring 4\uE000 to Larkfield school", "Next up, after Switches", "Needs a school"). */
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
 * A card's research view (null for learned and soon, and for locked ones held back by something besides blueprints). A
 * ready card: Research when nothing is under way or waiting, else Add to queue (held back while the queue is full). One
 * in the queue (#14): Remove, and Research now (it swaps in for the one under way), held back while its coins are
 * short; its line says where it waits ("Next up, after Switches", "3rd in line, after Signals"). One that needs
 * blueprints not learned yet never says Research now: "Research Farming now" starts the first of them (`nowTarget`),
 * and none while that's under way already. The one under way: live progress, no button. A locked one that needs
 * blueprints not learned yet: `chainCard`. With no school placed nothing can be picked: "Needs a school".
 */
export function researchCard(p: Progress, id: string, school: string | null): ResearchCardView | null {
  const state = cardState(p, id);
  if (state === "locked") return chainCard(p, id, school);
  if (state !== "ready" && state !== "researching" && state !== "next") return null;
  const r = p.research;
  const base = { chips: researchChips(p, id), study: `${Math.ceil(studyTime(id, p.learned) / p.research.speed)} s study` };
  if (state === "researching") return { ...base, why: researchWants(p, school), fill: researchFill(p, id) };
  const q = queueOf(r);
  if (state === "next") {
    const place = queuePlace(r, id);
    const ahead = place === 1 ? r.current : q[place - 2];
    const where = place === 1 ? "Next up" : `${ordinal(place)} in line`;
    const after = ahead ? `${where}, after ${shortLabel(ahead)}` : where;
    const first = nowTarget(p, id);
    // What it needs is under way already: it waits for it (Remove only).
    if (first === null) return { ...base, why: after, remove: true };
    const action = first === id ? "Research now" : `Research ${shortLabel(first)} now`;
    const short = place === 1 && first === id ? coinsShort(p) : r.held.has(first) ? 0 : Math.max(0, (costOf(first).coins ?? 0) - p.coins);
    const why = short === 0 ? after : place === 1 && !r.current ? `Waiting for ${coins(short)}` : `${after} · ${coins(short)} short`;
    return short > 0 ? { ...base, why, action, blocked: true, remove: true } : { ...base, why, action, remove: true };
  }
  const queueing = r.current !== null || q.length > 0;
  const action = queueing ? "Add to queue" : "Research";
  if (!school) return { ...base, why: "Needs a school", action, blocked: true };
  if (queueing && q.length >= QUEUE_MAX) return { ...base, why: `The queue is full (${QUEUE_MAX})`, action, blocked: true };
  return { ...base, action };
}

/** The toast as taking one out of the queue takes the queued ones that need it too: "Removed Mills and Bakery too". */
export function removedText(ids: readonly string[]): string {
  const names = ids.map(shortLabel);
  return `Removed ${listed(names)} too`;
}

/** "Farming, then Dairy, then Bakery". */
const thenList = (ids: readonly string[]): string => ids.map(shortLabel).join(", then ");

/**
 * A locked card that needs blueprints not learned yet: one tap queues them, in order, then it (`chainOf`). With nothing
 * under way or waiting it says "Research Farming now" ("Then Mills"): the first starts. Else "Queue Farming, then Mills"
 * ("Queue Farming and 2 more" for a longer chain, its line saying the order), or "Add to queue" once what it needs is
 * under way or queued ("After Farming"). Held back, saying why, where a blueprint in the chain can't be researched yet
 * ("Farming II needs 60 grain grown first") or the queue hasn't room. Null if it waits on something besides blueprints
 * (a town, a count: the card says what, as before).
 */
function chainCard(p: Progress, id: string, school: string | null): ResearchCardView | null {
  const missing = missingNeeds(p, id);
  const t = techOf(id);
  if (missing.length === 0 || !t || t.requires.some((n) => !needMet(p, n))) return null;
  const r = p.research;
  const q = queueOf(r);
  const chain = chainOf(p, id);
  const base = { chips: researchChips(p, id), study: `${Math.ceil(studyTime(id, p.learned) / p.research.speed)} s study` };
  const idle = r.current === null && q.length === 0;
  let action: string;
  let why: string | undefined;
  if (chain.length === 1) {
    action = "Add to queue";
    why = `After ${shortLabel(missing[missing.length - 1])}`;
  } else if (idle) {
    action = `Research ${shortLabel(chain[0])} now`;
    why = `Then ${thenList(chain.slice(1))}`;
  } else {
    action = chain.length === 2 ? `Queue ${shortLabel(chain[0])}, then ${shortLabel(id)}` : `Queue ${shortLabel(chain[0])} and ${chain.length - 1} more`;
    if (chain.length > 2) why = thenList(chain);
  }
  const block = chainBlock(p, id);
  if (block && "stuck" in block) {
    const s = techOf(block.stuck);
    const unmet = s?.requires.filter((n) => !needMet(p, n)) ?? [];
    // (A town to grow: the step the player can take. QA 2026-11-05 #4.)
    const grow = unmet.some((n) => n.kind === "level") ? ": grow a town into one" : "";
    const words = s?.plan ? `${shortLabel(block.stuck)} isn't in the game yet` : `${shortLabel(block.stuck)} needs ${unmet.map(describeNeed).join(" and ")} first${grow}`;
    // No button: it couldn't be pressed (QA 2026-11-05 #4: a greyed "Research Sugar beet now" read as a promise).
    return { ...base, why: words, blocked: true };
  }
  if (!school) return { ...base, why: "Needs a school", action, blocked: true };
  if (block) return { ...base, why: q.length >= QUEUE_MAX ? `The queue is full (${QUEUE_MAX})` : `Needs ${block.full} places in the queue (${QUEUE_MAX - q.length} left)`, action, blocked: true };
  return { ...base, ...(why ? { why } : {}), action };
}

/**
 * One part of the pill's count: a good the research needs (or the coins the one up next waits for), got of needed.
 * Shown "\uE0002/6", or "\uE000✓" once it's all in.
 */
export interface PillPart {
  icon: string;
  got: number;
  need: number;
}

/** The pill on the HUD: a name and a count (shown as "📘 Mills \uE0000/6 🌾0/6"), how far along, and whether to pick one. */
export interface PillView {
  name: string;
  /** The count in full: every part ("\uE000✓ 🌾2/6"), the study time left ("⏱ 12 s"), or "research" (Pick research). */
  count: string;
  /** Every good the research needs (or the coins it waits for), in cargo order; empty while studying or idle. */
  parts: PillPart[];
  /** The cost in words, for the pill's tooltip and its name for a screen reader ("0 of 6 \uE000 planks, 0 of 6 🌾 grain"). */
  words: string;
  fill: number;
  /** Nothing picked: "Pick research". */
  idle: boolean;
  /** How many more wait in the queue behind the one shown (#14): a "+2" on the pill; 0 for none. */
  more: number;
}

const partText = (x: PillPart): string => (x.got >= x.need ? `${x.icon}✓` : `${x.icon}${x.got}/${x.need}`);

/**
 * The pill's count, as much as fits: `fit` 0 is every part, a ticked one for a good all in ("\uE000✓ 🌾2/6 🔩0/10"); 1
 * leaves the ticked ones out ("🌾2/6 🔩0/10"); 2 is the good most lacking (the most of it still to come, as a share)
 * and how many more ("🔩0/10 +1"). Never a good cut off unsaid: what's left out is all in, or counted in the "+N".
 * Only parts with a count; the study time and "research" are the count as is.
 */
export function pillCount(v: PillView, fit: 0 | 1 | 2 = 0): string {
  if (v.parts.length === 0) return v.count;
  if (fit === 0) return v.parts.map(partText).join(" ");
  const left = v.parts.filter((x) => x.got < x.need);
  if (left.length === 0) return v.count;
  if (fit === 1 || left.length === 1) return left.map(partText).join(" ");
  const most = [...left].sort((a, b) => (b.need - b.got) / b.need - (a.need - a.got) / a.need || b.need - b.got - (a.need - a.got))[0];
  return `${partText(most)} +${left.length - 1}`;
}

/**
 * The HUD's research pill: the research under way and every good it needs, each got of needed ("Mills", "\uE0000/6 🌾0/6";
 * a good all in ticked), its study time left once the goods are in ("⏱ 12 s"), the one waiting for coins ("Routes",
 * "🪙5/20"), or "Pick research" with nothing picked. Coins paid (as a research starts) aren't shown. Hidden (null) with
 * nothing picked and no school placed.
 */
export function pillView(p: Progress, hasSchool: boolean): PillView | null {
  const r = p.research;
  const queued = queueOf(r).length;
  const view = (id: string, count: string, parts: PillPart[], words: string, fill: number, more: number): PillView => ({ name: shortLabel(id), count, parts, words, fill, idle: false, more });
  if (r.current) {
    const id = r.current;
    if (studying(p)) return view(id, `⏱ ${Math.ceil(studyLeft(p))} s`, [], `studying, ${Math.ceil(studyLeft(p))} s left`, researchFill(p, id), queued);
    const goods = costOf(id, p.learned).goods;
    const parts = (Object.keys(goods) as CargoKind[]).map((k) => ({ icon: GOODS_ICON[k], got: Math.min(r.got[k] ?? 0, goods[k]!), need: goods[k]! }));
    const words = (Object.keys(goods) as CargoKind[]).map((k, i) => `${parts[i].got} of ${goods[k]} ${GOODS_ICON[k]} ${goodName(k, goods[k]!)}`).join(", ");
    return view(id, parts.map(partText).join(" "), parts, words, researchFill(p, id), queued);
  }
  if (r.next) {
    const need = costOf(r.next).coins ?? 0;
    const short = coinsShort(p);
    if (short > 0) {
      const part = { icon: COIN_ICON, got: need - short, need };
      return view(r.next, partText(part), [part], `waiting for coins, ${need - short} of ${need} ${COIN_ICON}; then ${costWords(p, r.next)}`, (need - short) / need, queued - 1);
    }
  }
  return hasSchool || r.next ? { name: "Pick", count: "research", parts: [], words: "", fill: 0, idle: true, more: 0 } : null;
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

/** The pill in one line, in full: "📘 Mills \uE0000/6 🌾0/6", "📘 Pick research" ("" when it's hidden). */
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
  const goods = costOf(r.current, p.learned).goods;
  const piles = (Object.keys(goods) as CargoKind[]).map((k) => ({ label: GOODS_ICON[k], count: r.got[k] ?? 0, cap: goods[k]! }));
  // (A college studies twice as fast: said while it matters, the goods all in.)
  const fast = r.speed > 1 ? " (college: 2×)" : "";
  return { piles, note: (studying(p) ? `Studying ${label(r.current)}: ${Math.ceil(studyLeft(p))} s${fast}` : `Researching ${label(r.current)}`) + then + readingAhead(p), idle: false };
}

/**
 * The Reading room's line on the school's card: what the research up next has collected ahead, of what it needs
 * (" · Reading ahead for Mills: 🌾3/6"); "" without the Reading room or nothing up next.
 */
export function readingAhead(p: Progress): string {
  const r = p.research;
  if (r.next === null || !p.learned.has(READING_ROOM)) return "";
  const goods = costOf(r.next, p.learned).goods;
  const kinds = Object.keys(goods) as CargoKind[];
  if (kinds.length === 0) return "";
  const parts = kinds.map((k) => `${GOODS_ICON[k]}${goods[k]! - aheadLacking(p, k)}/${goods[k]}`);
  return ` · Reading ahead for ${label(r.next)}: ${parts.join(" ")}`;
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

/**
 * What a research learned says, in the News and its one toast: "Learned Switches! Make a switch or a Y switch at the
 * workshop · Present: 1 Engine". `makes`: what it brings, in words (`makesLine`), "" for a feature, which says how to
 * use it (`how`, else its blurb). The toast adds the goal it opens and, when the queue moves on, what's studied next
 * (QA 2026-11-03: that was a second toast, "Learned Switches! Next: Tank engine", after "Learned switches! …").
 */
export function learnedText(o: { label: string; makes: string; how?: string; blurb: string; present?: string; goal?: string; tip?: string; next?: string }): { line: string; toast: string; tipped: boolean } {
  const line = `Learned ${o.label}! ${o.makes || o.how || o.blurb}${o.present ?? ""}`;
  // A feature's tip (feature-tips.ts): how to start using it, unless the line says it already (its `how`).
  // (Its first clause is enough to tell: Sidings' how "Tap an industry, then Second track" is its tip's start.)
  const said = o.tip && (line.includes(o.tip) || line.includes(o.tip.split(":")[0]));
  const tip = o.tip && !said ? `💡 ${o.tip}` : "";
  const toast = [line, o.goal, tip, o.next ? `Next: ${o.next}` : ""].filter(Boolean).join(" · ");
  return { line, toast, tipped: !!tip };
}
