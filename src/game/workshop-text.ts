/**
 * What the game says about how goods reach the workshop and the school, and why a train passes a stop keeping its
 * goods (`Economy.keptAt`). Each stop takes goods in the order a train comes to it, by its own setting: nothing is held
 * back for a stop further on (but a workshop's waiting tray order). Short and kid-clear, as the warehouse's words
 * (warehouse-text.ts).
 */
import { CARGO, type CargoKind } from "../economy/cargo";
import type { KeepWhy } from "../economy/economy";

/** The workshop's card: how planks get there, under what it holds. */
export const SHOP_HELP = "Trains drop planks here as they pass. On a route, add the workshop as a stop";

/**
 * Why a train passing `place` keeps its `kind` (its engine card). `role`: the depot's. `place`: what it's called
 * ("Foxley", "the workshop", "the school").
 */
export function keptText(why: Exclude<KeepWhy, "nothing" | "route">, kind: CargoKind, role: string, place: string): string {
  const goods = CARGO[kind].label.toLowerCase();
  const head = `Not dropping ${goods}: `;
  switch (why) {
    case "not-stop":
      return `${head}${place} isn't on this route. Edit the route to add a stop here`;
    case "full":
      return `${head}${place} is full`;
    case "shares":
      return role === "school" ? `${head}the school shares with towns and has had its part` : `${head}${place} shares with towns and has its ${goods}`;
    case "order":
      return `Keeping ${goods} for the workshop's order`;
    case "unwanted":
      return role === "school" ? `${head}the research doesn't need any` : `${head}${place} doesn't need any now`;
  }
}
