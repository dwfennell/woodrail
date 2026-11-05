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
  "water-river-tug",
  "water-barge",
  "water-barge-logs",
  "water-barge-stone",
  "water-barge-ore",
  "water-barge-coal",
  "water-barge-grain",
  "water-cargo-ship",
  "water-train-ferry",
  "water-tug-frame",
  "water-tug-planked",
  "water-ship-frame",
  "water-ship-planked",
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
  "water-landing",
  "water-boatyard",
  "water-shipyard",
  "water-ferry-slip",
  "life-ducks",
]);

export function placeOn(asset: string): PlaceOn {
  return WATER.has(asset) ? "water" : ANY.has(asset) ? "any" : "land";
}
