/**
 * What Empty's toast says (a wagon card's Empty, the engine card's Delete cargo): what was tipped out, by goods, and where
 * on the map takes the first of them, if anywhere does ("Tipped out 6 🪵 · Ashby takes 🪵").
 */
import { GOODS_ICON, type CargoKind } from "../economy/cargo";

export interface Tipped {
  kind: CargoKind;
  count: number;
}

/** Add one wagon's goods to a tally by kind, in the order first met. */
export function addTipped(into: Tipped[], t: Tipped): void {
  const had = into.find((x) => x.kind === t.kind);
  if (had) had.count += t.count;
  else into.push({ kind: t.kind, count: t.count });
}

/**
 * The toast: "Tipped out 6 🪵", several goods "Tipped out 6 🪵 4 🌾", then the place that takes the first good that
 * has one (`takerOf` gives its name, or null: no hint). A town or school is named as is; an industry gets "The".
 */
export function emptyWords(tipped: readonly Tipped[], takerOf: (kind: CargoKind) => { name: string; town: boolean } | null): string {
  if (tipped.length === 0) return "";
  const what = tipped.map((t) => `${t.count} ${GOODS_ICON[t.kind]}`).join(" ");
  for (const t of tipped) {
    const taker = takerOf(t.kind);
    if (!taker || !taker.name) continue;
    return `Tipped out ${what} · ${taker.town ? taker.name : `The ${taker.name}`} takes ${GOODS_ICON[t.kind]}`;
  }
  return `Tipped out ${what}`;
}
