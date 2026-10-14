import { DEPOT_NAMES, type World } from "./world";

/** A place a train's route can stop at: any depot on the map (a town's station, an industry). */
export interface RouteStop {
  readonly depotId: number;
  readonly name: string;
}

/** Every depot a route can stop at, towns first, named for the engine card ("Workshop 2" when there are more). */
export function routeStops(w: World): RouteStop[] {
  const depots = w.economy.allDepots().filter((d) => w.layout.getPiece(d.pieceId));
  const towns = depots.filter((d) => d.role === "town");
  const others = depots.filter((d) => d.role !== "town");
  const out: RouteStop[] = towns.map((d) => ({ depotId: d.id, name: w.landscape.towns.find((t) => t.id === d.townId)?.name ?? "Town" }));
  for (const d of others) {
    const same = others.filter((o) => o.role === d.role);
    const base = DEPOT_NAMES[d.role as keyof typeof DEPOT_NAMES];
    out.push({ depotId: d.id, name: same.length > 1 ? `${base} ${same.indexOf(d) + 1}` : base });
  }
  return out;
}

/** The stop after `depotId` in the list, wrapping round: what a tap on a stop's chip picks. */
export function nextStop(stops: readonly RouteStop[], depotId: number): number {
  const i = stops.findIndex((s) => s.depotId === depotId);
  return stops[(i + 1) % stops.length].depotId;
}
