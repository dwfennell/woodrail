/**
 * Where a model may stand: on land, floating on the river (its middle over water), either (a bridge spans it), or on a
 * hill's top only (a wind turbine: `hill`).
 */
export type PlaceOn = "land" | "water" | "any" | "hill";

/** Models that stand only on a hill's top. */
const HILL: ReadonlySet<string> = new Set(["mech-wind-turbine"]);

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
  return WATER.has(asset) ? "water" : ANY.has(asset) ? "any" : HILL.has(asset) ? "hill" : "land";
}
