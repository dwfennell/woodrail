import { kitOf } from "../track";
import type { DepotState } from "../economy";
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
  // An industry by its kind's name; a kit piece's cargo stop (Sandbox's loaders) by its kit's ("Log loader").
  const nameOf = (d: DepotState) => {
    const kit = kitOf(w.layout.getPiece(d.pieceId)!.type);
    return kit ? kit.name[0].toUpperCase() + kit.name.slice(1) : DEPOT_NAMES[d.role as keyof typeof DEPOT_NAMES];
  };
  for (const d of others) {
    const base = nameOf(d);
    const same = others.filter((o) => nameOf(o) === base);
    out.push({ depotId: d.id, name: same.length > 1 ? `${base} ${same.indexOf(d) + 1}` : base });
  }
  return out;
}

/** The stop after `depotId` in the list, wrapping round: what a tap on a stop's chip picks. */
export function nextStop(stops: readonly RouteStop[], depotId: number): number {
  const i = stops.findIndex((s) => s.depotId === depotId);
  return stops[(i + 1) % stops.length].depotId;
}
