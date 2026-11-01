import { CARGO, GOODS_ICON, type CargoKind } from "../economy";

/** One stop's plan (`Economy.routePlan`): what a train on the line picks up and drops there. */
export interface StopPlan {
  readonly picks: readonly CargoKind[];
  readonly drops: readonly CargoKind[];
}

/** Under a stop's chip, icons only: "⬆🪵 ⬇🌲" (picks up planks, drops logs); "" for nothing. */
export function planIcons(p: StopPlan): string {
  const part = (arrow: string, ks: readonly CargoKind[]) => (ks.length ? arrow + ks.map((k) => GOODS_ICON[k]).join("") : "");
  return [part("⬆", p.picks), part("⬇", p.drops)].filter(Boolean).join(" ");
}

/** A stop tapped, in words: "Picks up planks · Drops logs", or that it does neither. */
export function planWords(p: StopPlan): string {
  const list = (ks: readonly CargoKind[]) => ks.map((k) => CARGO[k].label.toLowerCase()).join(", ");
  const parts = [p.picks.length ? `Picks up ${list(p.picks)}` : "", p.drops.length ? `Drops ${list(p.drops)}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Picks up and drops nothing here";
}
