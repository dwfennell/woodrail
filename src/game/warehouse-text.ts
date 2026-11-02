import { CARGO, type CargoKind, type StoreMode } from "../economy";

/**
 * What the game says about warehouses: they trade only with trains on a route (`routedOnly` in RECIPES), and a player
 * whose hand-run train stands beside one sees nothing happen. Short and kid-clear.
 */

/** A train with no route, beside a warehouse (its card, and a toast the first time at each warehouse). */
export const STORE_NO_ROUTE = "Warehouses trade with trains on a route. Plan a route with a stop here";

/** A train on a route that has no stop at this warehouse. */
export const STORE_NOT_A_STOP = "This warehouse isn't on its line. Edit the line to add a stop here";

/** What a train beside a warehouse it can't trade with is told: by whether it has a route. */
export function storeSkipText(routed: boolean): string {
  return routed ? STORE_NOT_A_STOP : STORE_NO_ROUTE;
}

/** The warehouse's card: how to use it, under what it holds. */
export const STORE_HELP = "Drop goods here to keep them for later. Choose below what it takes and gives; on a route, set its stop to Only drop or Only pick up";

/** What each store mode is called on the warehouse's card (`StoreMode`). */
export const STORE_MODE_WORDS: Record<StoreMode, string> = { both: "Takes and gives", in: "Takes only", out: "Gives only", off: "Closed" };

/** Each store mode's picture, on its button: goods coming down off a train, going up onto one, both, or neither. */
export const STORE_MODE_ICON: Record<StoreMode, string> = { both: "⬇⬆", in: "⬇", out: "⬆", off: "🚫" };

/** The warehouse's card, the row for goods it doesn't list. */
export const STORE_OTHERS = "Any other goods";

/** The warehouse's card: its button for listing another good (before any arrives). */
export const STORE_ADD = "+ Add a good";

/**
 * The route card, for a warehouse stop the route would drop or pick up a good at but for the warehouse's own setting
 * (the stricter rule wins): "Not dropping planks: the warehouse is set to Gives only".
 */
export function storeBlockText(drop: boolean, kind: CargoKind, mode: StoreMode): string {
  return `Not ${drop ? "dropping" : "picking up"} ${CARGO[kind].label.toLowerCase()}: the warehouse is set to ${STORE_MODE_WORDS[mode]}`;
}

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

/** An industry giving several goods (`givesChoice`): its two choices per good, in words and pictures. */
export const GIVES_MODES: readonly StoreMode[] = ["both", "off"];
export const GIVES_MODE_WORDS: Partial<Record<StoreMode, string>> = { both: "Gives", off: "Doesn't give" };
export const GIVES_MODE_ICON: Partial<Record<StoreMode, string>> = { both: "⬆", off: "🚫" };

/** Its card's line over the choices. */
export const GIVES_HELP = "Choose which goods trains load here. It keeps making both";

/**
 * Such an industry set not to give a good a route would pick up there ("Not picking up ore: the mine is set not to
 * give it"), or set to give none of its goods (`all`: "Not loading: the mine is set to give nothing"). `name`: the
 * industry's name, as its card has it ("Mine").
 */
export function givesBlockText(name: string, kind: CargoKind | null): string {
  const n = name.toLowerCase();
  return kind === null ? `Not loading: the ${n} is set to give nothing` : `Not picking up ${CARGO[kind].label.toLowerCase()}: the ${n} is set not to give it`;
}

/** A wagon's card: on or off for each good it can carry (all on to start), in words and pictures. */
export const WAGON_MODES: readonly StoreMode[] = ["both", "off"];
export const WAGON_MODE_WORDS: Partial<Record<StoreMode, string>> = { both: "Takes", off: "Off" };
export const WAGON_MODE_ICON: Partial<Record<StoreMode, string>> = { both: "✓", off: "🚫" };

/** A wagon set to carry none of its goods. */
export const WAGON_NONE = "Carries nothing (all switched off)";

/** One tap: every wagon of this kind on its train set the same as this one. */
export const WAGON_SAME = "Same for all wagons like this on this train";

/** Said once the wagons are set the same. */
export const WAGON_SAME_DONE = "All wagons like this one on the train take the same goods now";
