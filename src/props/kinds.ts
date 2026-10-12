/** Where a model may stand: on land, floating on the river (its middle over water), or either (a bridge spans it). */
export type PlaceOn = "land" | "water" | "any";

const WATER: ReadonlySet<string> = new Set([
  "veh-rowing-boat",
  "veh-sailing-boat",
  "veh-car-ferry",
  "veh-cargo-ship",
  "veh-tugboat",
  "veh-paddle-steamer",
  "veh-fishing-boat",
  "veh-submarine",
  "life-swans",
  "life-fish-jumping",
]);

const ANY: ReadonlySet<string> = new Set([
  "mech-stone-arch-bridge",
  "mech-viaduct",
  "mech-suspension-bridge",
  "mech-bascule-bridge",
  "mech-swing-bridge",
  "mech-lift-bridge",
  "mech-rope-bridge",
  "mech-truss-bridge",
  "mech-covered-bridge",
  "mech-trestle",
  "mech-river-ford",
  "life-ducks",
]);

export function placeOn(asset: string): PlaceOn {
  return WATER.has(asset) ? "water" : ANY.has(asset) ? "any" : "land";
}
