import { generateLandscape, type Landscape } from "../landscape";
import { Sim } from "../sim";
import { Layout } from "../track";

export interface World {
  layout: Layout;
  sim: Sim;
  landscape: Landscape;
  /** Town id → its station piece id. */
  stations: Map<number, number>;
}

export const STARTER_SEED = 7;

/** A fresh map: generated landscape with a station piece in every town and no player track. */
export function createWorld(seed: number, starter = false): World {
  const landscape = generateLandscape(seed, { starter });
  const layout = new Layout();
  const stations = new Map<number, number>();
  for (const town of landscape.towns) stations.set(town.id, layout.addPiece("station", town.station));
  return { layout, sim: new Sim(layout), landscape, stations };
}

/**
 * The map a new player sees: the starter landscape (two towns close together with a clear run between their
 * stations) and nothing else — joining them is the first thing to do.
 */
export function buildStarterWorld(): World {
  return createWorld(STARTER_SEED, true);
}
