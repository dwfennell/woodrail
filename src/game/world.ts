import { generateLandscape, type DepotKind, type Landscape } from "../landscape";
import { Economy } from "../economy";
import { Sim } from "../sim";
import { Layout, type PieceTypeId } from "../track";

export const depotPieceType = (kind: DepotKind): PieceTypeId => (kind === "forest" ? "depot-forest" : "depot-sawmill");

export const DEPOT_NAMES: Record<DepotKind, string> = { forest: "Forest yard", sawmill: "Sawmill" };

export interface World {
  layout: Layout;
  sim: Sim;
  landscape: Landscape;
  /** Town id → its station piece id. */
  stations: Map<number, number>;
  /** Depot id → its depot piece id. */
  depots: Map<number, number>;
  /** Piles, production and cargo; economy depot ids equal landscape depot ids, then one per town. */
  economy: Economy;
}

/** Where a town station's goods crane stops wagons: near its socket end, by the plank pile. */
export const STATION_CRANE_AT = 30;

/**
 * The economy for a world: the landscape's depots first (so economy depot id = landscape depot id), then one goods
 * depot per town station.
 */
export function createEconomy(layout: Layout, sim: Sim, landscape: Landscape, stations: ReadonlyMap<number, number>, depots: ReadonlyMap<number, number>): Economy {
  const economy = new Economy(layout, sim);
  for (const d of landscape.depots) economy.addDepot(d.kind, depots.get(d.id)!);
  for (const t of landscape.towns) economy.addDepot("town", stations.get(t.id)!, t.id, STATION_CRANE_AT);
  return economy;
}

export const STARTER_SEED = 7;

/** A fresh map: generated landscape with a station piece in every town and no player track. */
export function createWorld(seed: number, starter = false): World {
  const landscape = generateLandscape(seed, { starter });
  const layout = new Layout();
  const stations = new Map<number, number>();
  for (const town of landscape.towns) stations.set(town.id, layout.addPiece("station", town.station));
  const depots = new Map<number, number>();
  for (const depot of landscape.depots) depots.set(depot.id, layout.addPiece(depotPieceType(depot.kind), depot.piece));
  const sim = new Sim(layout);
  return { layout, sim, landscape, stations, depots, economy: createEconomy(layout, sim, landscape, stations, depots) };
}

/**
 * The map a new player sees: the starter landscape (two towns close together with a clear run between their
 * stations) and nothing else — joining them is the first thing to do.
 */
export function buildStarterWorld(): World {
  return createWorld(STARTER_SEED, true);
}
