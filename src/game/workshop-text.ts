/**
 * What the game says about how goods reach the workshop. Any train passing it drops planks (and iron) there, but a
 * train on a route drops goods only at its stops (`dropsAt`), so one whose route passes the workshop without a stop
 * there keeps them on board. Short and kid-clear, as the warehouse's words (warehouse-text.ts).
 */
import { CARGO, type CargoKind } from "../economy/cargo";

/** The workshop's card: how planks get there, under what it holds. */
export const SHOP_HELP = "Trains drop planks here as they pass. On a route, add the workshop as a stop";

/** A train on a route, carrying goods the workshop takes, beside it with no stop there (its card, and a toast once). */
export function shopSkipText(kind: CargoKind): string {
  return `Not dropping ${CARGO[kind].label.toLowerCase()}: the workshop isn't on this route. Edit the route to add a stop here`;
}
