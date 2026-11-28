import { CARGO, GOODS_ICON } from "../economy/cargo";
import { goodKind, HaulLog, RIDERS, type HaulLine, type VehicleLog } from "../economy/history";
import { RIDER_ICON } from "../game/train-summary";

/**
 * A train's or boat's History sheet's words (spec docs/superpowers/specs/2026-11-28-delivery-history.md, "The view"),
 * made from its log: the summary, and a row a visit, newest first, each with a line a good. Pure: the sheet draws it.
 */

export interface HistoryLineView {
  drop: boolean;
  /** "Picked up 3 🪵 logs → Sawmill", "Dropped 3 🪵 logs from Forest · 2 min". */
  text: string;
  /** Coins it earned (0: none said). */
  coins: number;
}

export interface HistoryVisitView {
  /** The stop's depot (−1: since taken up: nothing to frame). */
  depotId: number;
  name: string;
  /** "just now", "4 min ago", "1 h 20 min ago". */
  ago: string;
  lines: HistoryLineView[];
}

export interface HistoryView {
  /** "Last hour: 14 loads dropped · +212🪙", or how to fill it while it's empty. */
  summary: string;
  visits: HistoryVisitView[];
}

/** The summary's window: an hour of play ("today" is a day of the railway's calendar, 4 s: too short to say much). */
export const SUMMARY_S = 3600;

/** "3 🪵 logs", "1 🧑 person". */
export function amountText(good: number, n: number): string {
  if (good === RIDERS) return `${n} ${RIDER_ICON} ${n === 1 ? "person" : "people"}`;
  const kind = goodKind(good);
  if (!kind) return `${n}`;
  return `${n} ${GOODS_ICON[kind]} ${CARGO[kind].label.toLowerCase()}`;
}

/** Seconds as "40 s", "2 min", "1 h 5 min". */
export function spanText(s: number): string {
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t} s`;
  const m = Math.round(t / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

/** How long ago `at` was, at `now` (game seconds). */
export function agoText(at: number, now: number): string {
  const s = now - at;
  return s < 45 ? "just now" : `${spanText(s)} ago`;
}

/** A line's words, places named by `nameOf` (−1: none). */
export function lineText(l: HaulLine, nameOf: (depotId: number) => string): string {
  const what = amountText(l.good, l.n);
  if (!l.drop) return `Picked up ${what}${l.place >= 0 ? ` → ${nameOf(l.place)}` : ""}`;
  const parts = [`Dropped ${what}`];
  if (l.place >= 0) parts[0] += ` from ${nameOf(l.place)}`;
  if (l.rode > 0 && l.n > 0) parts.push(spanText(l.rode / l.n));
  return parts.join(" · ");
}

/** The sheet's view of `log` at game time `now`. */
export function historyView(log: VehicleLog | undefined, now: number, nameOf: (depotId: number) => string): HistoryView {
  const visits = (log?.visits() ?? []).filter((v) => v.lines.length > 0);
  if (visits.length === 0) return { summary: "Nothing moved yet: what it picks up and drops off shows here, newest first.", visits: [] };
  const { loads, people, coins } = HaulLog.summary(log, now - SUMMARY_S);
  const span = now < SUMMARY_S ? "So far" : "Last hour";
  const moved = [loads > 0 || people === 0 ? `${loads} ${loads === 1 ? "load" : "loads"}` : "", people > 0 ? `${people} ${people === 1 ? "person" : "people"}` : ""].filter(Boolean).join(", ");
  const summary = `${span}: ${moved} dropped off${coins > 0 ? ` · +${coins}🪙` : ""}`;
  return {
    summary,
    visits: visits.map((v) => ({
      depotId: v.depotId,
      name: v.depotId >= 0 ? nameOf(v.depotId) : "A place since taken up",
      ago: agoText(v.at, now),
      // (Drops first, as the crane does them.)
      lines: [...v.lines].sort((a, b) => Number(b.drop) - Number(a.drop)).map((l) => ({ drop: l.drop, text: lineText(l, (id) => (id >= 0 ? nameOf(id) : "")), coins: l.coins })),
    })),
  };
}
