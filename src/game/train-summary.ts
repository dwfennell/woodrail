import { CARGO, CARGO_KINDS, GOODS_ICON, type CargoKind } from "../economy/cargo";

/** People on a coach, beside goods in a train's load. */
export const RIDER_ICON = "🧑";

/**
 * Speeds as the card says them, in words on one scale by the engine's speed against the classic engine's (1):
 * under it "slow" (the goods engine, 0.8), about it "steady" (classic, tank), over it "quick" (diesel 1.2, electric
 * 1.4), and from 1.5 "fast" (the express). Each word is the least speed it starts at.
 */
export const SPEED_WORDS: readonly { from: number; word: string }[] = [
  { from: 1.45, word: "fast" },
  { from: 1.1, word: "quick" },
  { from: 0.95, word: "steady" },
  { from: 0, word: "slow" },
];

/** A train's top speed (against the classic engine's) in a word: "slow", "steady", "quick" or "fast"; "" when 0. */
export function speedWord(speed: number): string {
  if (!(speed > 0)) return "";
  return SPEED_WORDS.find((w) => speed >= w.from)!.word;
}

/** At most this many kinds of goods are named in the load line; more say "+2 more" (two lines at 360 px). */
export const LOAD_KINDS_SHOWN = 4;

/** The longest line name the summary names (as the stuck and points cards do); longer, it's left out. */
export const SUMMARY_LINE_NAME = 12;

/** One car of a train, as the summary counts it: an engine, a wagon and what's on it, a coach and its riders. */
export interface SummaryCar {
  kind: "engine" | "wagon" | "coach";
  /** A wagon's goods (null: empty). */
  cargo?: CargoKind | null;
  /** A wagon's goods, or a coach's riders. */
  count?: number;
}

/**
 * The engine card's train summary, two short lines:
 * - `about`: "4 cars · steady · Red line" (cars past the engines; the speed as a word (`speedWord`), left out while it can't move; the line
 *   left out when there's none, or its name is too long);
 * - `load`: what's on board, by good in cargo order then riders: "🌲 12 · 🪵 4 · 🧑 3", or "Empty" (no cars: "").
 */
export function trainSummary(cars: readonly SummaryCar[], speed: number, line: string): { about: string; load: string } {
  const n = cars.filter((c) => c.kind !== "engine").length;
  const about = [n === 1 ? "1 car" : `${n} cars`];
  if (speed > 0) about.push(speedWord(speed));
  if (line && line.length <= SUMMARY_LINE_NAME) about.push(line);
  return { about: about.join(" · "), load: n === 0 ? "" : loadWords(cars) };
}

/** What a train carries: "🌲 12 · 🪵 4 · 🧑 3", at most `LOAD_KINDS_SHOWN` kinds then "+n more"; "Empty". */
export function loadWords(cars: readonly SummaryCar[]): string {
  const goods = new Map<CargoKind, number>();
  let riders = 0;
  for (const c of cars) {
    if (c.kind === "wagon" && c.cargo && (c.count ?? 0) > 0) goods.set(c.cargo, (goods.get(c.cargo) ?? 0) + c.count!);
    else if (c.kind === "coach") riders += c.count ?? 0;
  }
  const parts = CARGO_KINDS.filter((k) => goods.has(k)).map((k) => `${GOODS_ICON[k]} ${goods.get(k)}`);
  if (riders > 0) parts.push(`${RIDER_ICON} ${riders}`);
  if (parts.length === 0) return "Empty";
  if (parts.length <= LOAD_KINDS_SHOWN) return parts.join(" · ");
  return `${parts.slice(0, LOAD_KINDS_SHOWN - 1).join(" · ")} · +${parts.length - LOAD_KINDS_SHOWN + 1} more`;
}

/** A wagon's card: "🌲 Logs: 6 of 8", "Empty (carries logs, planks, iron)"; a coach: "🧑 3 of 6 seats". */
export function carLoadWords(car: SummaryCar, room: number, carries: readonly CargoKind[] = []): string {
  if (car.kind === "coach") return `${RIDER_ICON} ${car.count ?? 0} of ${room} seats`;
  if (!car.cargo || !car.count) {
    const what = carries.map((k) => CARGO[k].label.toLowerCase());
    return what.length ? `Empty (carries ${what.join(", ")})` : "Empty";
  }
  return `${GOODS_ICON[car.cargo]} ${CARGO[car.cargo].label}: ${car.count} of ${room}`;
}
