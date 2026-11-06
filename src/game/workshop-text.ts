/**
 * What the game says about how goods reach the workshop and the school, and why a train passes a stop keeping its
 * goods (`Economy.keptAt`). Each stop takes goods in the order a train comes to it, by its own setting: nothing is held
 * back for a stop further on but by a setting you can see (a school set to Research first, a workshop's waiting tray
 * order). Short and kid-clear, as the warehouse's words
 * (warehouse-text.ts).
 */
import { CARGO, type CargoKind } from "../economy/cargo";
import { plural, wagonFor } from "./chains";
import type { KeepWhy } from "../economy/economy";

/** The workshop's card: how planks get there, under what it holds. */
export const SHOP_HELP = "Trains drop planks here as they pass. On a route, add the workshop as a stop";

/**
 * Why a train passing `place` keeps its `kind` (its engine card). `role`: the depot's. `place`: what it's called
 * ("Foxley", "the workshop", "the school"). `held`: how many it keeps for the school ("school"; 0: not said).
 */
export function keptText(why: Exclude<KeepWhy, "nothing" | "route">, kind: CargoKind, role: string, place: string, held = 0): string {
  const goods = CARGO[kind].label.toLowerCase();
  const head = `Not dropping ${goods}: `;
  switch (why) {
    case "not-stop":
      return `${head}${place} isn't on this line. Edit the line to add a stop here`;
    case "full":
      return `${head}${place} is full`;
    case "shares":
      return role === "school" ? `${head}the school shares with towns and has had its part` : `${head}${place} shares with towns and has its ${goods}`;
    case "order":
      return `Keeping ${goods} for the workshop's order`;
    case "unwanted":
      return role === "school" ? `${head}the research doesn't need any` : `${head}${place} doesn't need any now`;
    case "school":
      // How many (`Economy.heldForSchool`): a routed train holds at most one wagon's worth (issue #20).
      return held > 0 ? `Keeping ${held} ${goods} for the school (Research first)` : `Keeping ${goods} for the school (Research first)`;
  }
}

/**
 * Why a routed train won't pick up `kind` at `place`, the stop it's heading for or standing at (`Economy.notLoadingAt`),
 * on its engine card: "Not loading planks at the sawmill: the workshop doesn't need any yet". `taker`: the later stop
 * that would take them, as the card names places ("" if none); `takerFull`: it's full (else it doesn't need any yet).
 * A no-wagon reason in the chain hints' words ("…go on a flatbed wagon").
 */
export function notLoadingText(why: "no-room" | "no-wagon" | "none", kind: CargoKind, place: string, taker = "", takerFull = false): string {
  const goods = CARGO[kind].label.toLowerCase();
  switch (why) {
    case "no-room":
      return `Not loading ${goods} at ${place}: ${taker ? `${taker} ${takerFull ? "is full" : "doesn't need any yet"}` : "no stop after it has room"}`;
    case "no-wagon":
      return `Not loading ${goods} at ${place}: ${plural(kind) ? "they go" : "it goes"} on ${wagonFor(kind)}. Add one to this train`;
    case "none":
      return `No ${goods} to load at ${place} yet`;
  }
}
