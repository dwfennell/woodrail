/**
 * What the game says about warehouses: they trade only with trains on a route (`routedOnly` in RECIPES), and a player
 * whose hand-run train stands beside one sees nothing happen. Short and kid-clear.
 */

/** A train with no route, beside a warehouse (its card, and a toast the first time at each warehouse). */
export const STORE_NO_ROUTE = "Warehouses trade with trains on a route. Plan a route with a stop here";

/** A train on a route that has no stop at this warehouse. */
export const STORE_NOT_A_STOP = "This warehouse isn't on its route. Edit the route to add a stop here";

/** What a train beside a warehouse it can't trade with is told: by whether it has a route. */
export function storeSkipText(routed: boolean): string {
  return routed ? STORE_NOT_A_STOP : STORE_NO_ROUTE;
}

/** The warehouse's card: how to use it, under what it holds. */
export const STORE_HELP = "Drop goods here to keep them for later. On a route, set its stop to Only drop or Only pick up";

/** The warehouse's card, its goods line: what it holds (only goods it has some of), or that it's empty. */
export function storeStock(held: readonly { label: string; count: number; cap: number }[]): string {
  const some = held.filter((h) => h.count > 0);
  return some.length === 0 ? "Empty" : some.map((h) => `${h.label} ${h.count}/${h.cap}`).join("   ·   ");
}

/**
 * What a stop's action does at a warehouse, under the stop's options on the route card. Automatic leaves goods no
 * later stop wants and takes what a later stop wants (`dropsAt`, `picksAt`).
 */
export function storeStopText(action: "auto" | "both" | "drop" | "pick"): string {
  if (action === "drop") return "Drops all its goods here, picks up none";
  if (action === "pick") return "Picks up goods here, drops none";
  return "Leaves goods no later stop wants, takes what a later stop wants";
}
