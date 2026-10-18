import { COIN_ICON, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { iconCounts } from "../economy/goods";
import type { Progress } from "./progress";
import { coinsShort, costOf, lacks, pick, studying, studyLeft } from "./research";
import { techOf } from "./tech";

/**
 * Research in words, for the blueprint board's stopgap (P1: its tap picks a research; the Research picker comes in
 * P2), the toast that says so, and the school's card. Short: they're read on a phone. `school` is the name of the
 * school goods go to ("Larkfield school"), or null if none is placed yet.
 */

const coins = (n: number) => `${n}${COIN_ICON}`;
const label = (id: string) => techOf(id)?.label ?? id;

/** What the current research waits for: "bring 4🪵 to Larkfield school", "studying: 12 s", "place a school by a town". */
export function researchWants(p: Progress, school: string | null): string {
  if (studying(p)) return `studying: ${Math.ceil(studyLeft(p))} s`;
  return school ? `bring ${iconCounts(lacks(p))} to ${school}` : "place a school by a town";
}

/**
 * The board's tap on a ready blueprint (the stopgap): pick it for research, and say what happened in a toast:
 * "Researching Switches: bring 4🪵 to Larkfield school", "Next up: Bridges", "Next up: Routes (20🪙 short)". Null if
 * it can't be researched (nothing changes).
 */
export function tapResearch(p: Progress, id: string, school: string | null): string | null {
  const where = pick(p, id);
  if (!where) return null;
  if (where === "current") return `Researching ${label(id)}: ${researchWants(p, school)}`;
  const short = coinsShort(p);
  return short > 0 ? `Next up: ${label(id)} (${coins(short)} short)` : `Next up: ${label(id)}`;
}

/** A ready blueprint's card on the board: how its research stands, and its button's word. */
export function researchCard(p: Progress, id: string, school: string | null): { why?: string; research?: "current" | "next"; action: string } {
  const r = p.research;
  if (r.current === id) return { why: researchWants(p, school), research: "current", action: "Researching" };
  if (r.next === id) {
    const short = coinsShort(p);
    return { why: short > 0 ? `Waiting for ${coins(short)}` : "Up next", research: "next", action: r.current ? "Research now" : "Research" };
  }
  const action = r.current ? "Next up" : "Research";
  return school ? { action } : { why: "Needs a school", action };
}

/** The board's line about research: what's under way, or what to do. */
export function researchLine(p: Progress, school: string | null): string {
  const id = p.research.current;
  if (id) return `Researching ${label(id)}: ${researchWants(p, school)}`;
  return school ? "Tap a blueprint to research it" : "Place your school by a town";
}

/** A key that changes whenever the school's card would (cheap enough to ask every frame the card is open). */
export const schoolCardKey = (p: Progress): number => p.research.version * 4 + (p.research.current ? 1 : 0) + (p.research.next ? 2 : 0);

/** The school's card: the current research's goods (got of needed), and a line saying how it stands. */
export function schoolCard(p: Progress): { piles: { label: string; count: number; cap: number }[]; note: string } {
  const r = p.research;
  if (!r.current) {
    const short = coinsShort(p);
    return { piles: [], note: r.next ? `Next up: ${label(r.next)}${short > 0 ? ` (${coins(short)} short)` : ""}` : "Pick research in Blueprints" };
  }
  const goods = costOf(r.current).goods;
  const piles = (Object.keys(goods) as CargoKind[]).map((k) => ({ label: GOODS_ICON[k], count: r.got[k] ?? 0, cap: goods[k]! }));
  return { piles, note: studying(p) ? `Studying ${label(r.current)}: ${Math.ceil(studyLeft(p))} s` : `Researching ${label(r.current)}` };
}
