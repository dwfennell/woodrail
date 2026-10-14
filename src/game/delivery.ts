import { RECIPES } from "../economy";
import { DEPOT_NAMES, type World } from "./world";

/** A place a train can be told to deliver to: a depot that takes goods (a town's station, a workshop, a sawmill). */
export interface DeliveryStop {
  readonly depotId: number;
  readonly name: string;
}

/** The depots on the map that take goods, towns first, named for the engine card ("Workshop 2" when there are more). */
export function deliveryStops(w: World): DeliveryStop[] {
  const takers = w.economy.allDepots().filter((d) => RECIPES[d.role].takes.length > 0 && w.layout.getPiece(d.pieceId));
  const towns = takers.filter((d) => d.role === "town");
  const others = takers.filter((d) => d.role !== "town");
  const out: DeliveryStop[] = towns.map((d) => ({ depotId: d.id, name: w.landscape.towns.find((t) => t.id === d.townId)?.name ?? "Town" }));
  for (const d of others) {
    const same = others.filter((o) => o.role === d.role);
    const base = DEPOT_NAMES[d.role as keyof typeof DEPOT_NAMES];
    out.push({ depotId: d.id, name: same.length > 1 ? `${base} ${same.indexOf(d) + 1}` : base });
  }
  return out;
}

/** The stop after `depotId` in the list (−1: anywhere), wrapping round to anywhere: what a tap on the chip picks. */
export function nextStop(stops: readonly DeliveryStop[], depotId: number): number {
  const i = stops.findIndex((s) => s.depotId === depotId);
  if (i === -1) return stops.length > 0 && depotId === -1 ? stops[0].depotId : -1;
  return i + 1 < stops.length ? stops[i + 1].depotId : -1;
}
