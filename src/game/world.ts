import { generateLandscape, type Landscape } from "../landscape";
import { Sim } from "../sim";
import { appendPiece, connectorRef, Layout } from "../track";

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
 * The map a new player sees: two towns already joined by a short line with buffers at the far ends,
 * and a train setting off from the first town.
 */
export function buildStarterWorld(): World {
  const world = createWorld(STARTER_SEED, true);
  const { layout, sim, landscape, stations } = world;
  const [a, b] = landscape.towns;
  const ref = connectorRef;

  let last = stations.get(a.id)!;
  const line: number[] = [];
  for (let i = 0; i < 4; i++) line.push((last = appendPiece(layout, "straight-216", false, ref(last, 1))));
  // The line ends exactly at town B's station socket, so it seats there too.

  appendPiece(layout, "buffer", false, ref(stations.get(b.id)!, 1));
  const adapter = appendPiece(layout, "adapter-peg", false, ref(stations.get(a.id)!, 0), 0);
  appendPiece(layout, "buffer", false, ref(adapter, 1));

  const placed = sim.addTrain(["engine", "hopper", "passenger", "caboose"], { pieceId: line[1], pathIndex: 0, reversed: false, s: 120 });
  if (placed.kind === "placed") sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
  return world;
}
