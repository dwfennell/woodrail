import { kitOf } from "../track";
import type { DepotRole, DepotState } from "../economy";
import { DEPOT_NAMES, depotName, type World } from "./world";

/** What naming a place needs: its depots, their pieces, and the towns. */
type Places = Pick<World, "economy" | "landscape" | "layout">;

/**
 * Docks on the water are named by the town nearest them ("Rookhurst landing"), as boats always named them: a river may
 * have a landing near each town, and "River landing 2" says nothing of where (player report 2026-11-26: the boat's
 * stops said "Rookhurst landing", its card "River landing").
 */
const BY_TOWN: Partial<Record<DepotRole, string>> = { landing: "landing", harbour: "harbour", boatyard: "boatyard", shipyard: "shipyard", slip: "ferry slip" };

/** A place a train's route can stop at: any depot on the map (a town's station, an industry). */
export interface RouteStop {
  readonly depotId: number;
  readonly name: string;
}

/** The names last worked out, per economy: kept while the layout, the depots and the towns are as they were. */
const cached = new WeakMap<object, { layout: object; revision: number; depots: number; towns: number; stops: RouteStop[]; byId: Map<number, string> }>();

/**
 * Every depot a route can stop at, towns first, each by its place's name ("Workshop 2" when there are more): the one
 * source of a place's name (see `placeName`). Worked out again only when the layout, the depots or the towns change;
 * the list is shared, not to be changed.
 */
export function routeStops(w: Places): RouteStop[] {
  return namesOf(w).stops;
}

/**
 * A place's name, wherever it's named (its card's title, a line's or a boat's stops, the Lines list, the map's markers,
 * toasts): a town's station by the town, an industry by its kind ("Sawmill", "Sawmill 2" when there are more), a dock
 * by the town nearest it ("Rookhurst landing"); one taken up by its kind, or "A stop".
 */
export function placeName(w: Places, depotId: number): string {
  return namesOf(w).byId.get(depotId) ?? lostStopName(w, depotId);
}

/**
 * A place's card's title and, under it, its kind where the name doesn't say: a town's card (its ledger, `townCard`) by
 * the town's name ("Larkfield", or "Larkfield goods" for the older goods card), anything else by `placeName`.
 */
export function placeCardTitle(w: Places, depotId: number, townCard = true): { title: string; kind: string } {
  const d = w.economy.depot(depotId);
  if (!d) return { title: "", kind: "" };
  if (d.role === "town") return { title: `${w.landscape.towns.find((t) => t.id === d.townId)?.name ?? ""}${townCard ? "" : " goods"}`, kind: "" };
  return { title: placeName(w, depotId), kind: placeKind(w, depotId) };
}

/**
 * What kind of place it is, for under its name on its card where the name doesn't say ("River landing" under
 * "Rookhurst landing"), or "" where it does ("Sawmill 2", a town).
 */
export function placeKind(w: Places, depotId: number): string {
  const d = w.economy.depot(depotId);
  if (!d || d.role === "town") return "";
  const kit = kitOf(w.layout.getPiece(d.pieceId)?.type ?? "straight-216");
  const kind = kit && !BY_TOWN[d.role] ? kit.name[0].toUpperCase() + kit.name.slice(1) : DEPOT_NAMES[d.role];
  const name = placeName(w, depotId);
  return name.toLowerCase().startsWith(kind.toLowerCase()) ? "" : kind;
}

function namesOf(w: Places): { stops: RouteStop[]; byId: Map<number, string> } {
  const depots = w.economy.allDepots();
  const c = cached.get(w.economy);
  const revision = (w.layout as { revision?: number }).revision ?? -1;
  if (c && c.layout === w.layout && c.revision === revision && revision !== -1 && c.depots === depots.length && c.towns === w.landscape.towns.length) return c;
  const stops = workOut(w, depots);
  const fresh = { layout: w.layout, revision, depots: depots.length, towns: w.landscape.towns.length, stops, byId: new Map(stops.map((s) => [s.depotId, s.name])) };
  cached.set(w.economy, fresh);
  return fresh;
}

function workOut(w: Places, depots: readonly DepotState[]): RouteStop[] {
  const towns = depots.filter((d) => d.role === "town");
  const others = depots.filter((d) => d.role !== "town");
  // A town's station by the town's name; its halts after it ("Ashby halt", Game mode's: see `HALT_KITS`).
  const townName = (d: DepotState) => {
    const town = w.landscape.towns.find((t) => t.id === d.townId)?.name ?? "Town";
    const kit = kitOf(w.layout.getPiece(d.pieceId)!.type);
    return kit ? `${town} ${kit.name}` : town;
  };
  towns.sort((a, b) => Number(w.economy.isHalt(a)) - Number(w.economy.isHalt(b)));
  const out: RouteStop[] = towns.map((d) => {
    const base = townName(d);
    const same = towns.filter((o) => townName(o) === base);
    return { depotId: d.id, name: same.length > 1 ? `${base} ${same.indexOf(d) + 1}` : base };
  });
  // An industry by its kind's name; a dock by the town nearest it; a kit piece's cargo stop (Sandbox's loaders) by its
  // kit's ("Log loader").
  const nameOf = (d: DepotState) => {
    const piece = w.layout.getPiece(d.pieceId)!;
    const noun = BY_TOWN[d.role];
    if (noun) {
      let best: { name: string; dist: number } | null = null;
      for (const t of w.landscape.towns) {
        const dist = Math.hypot(t.centre.x - piece.pose.x, t.centre.z - piece.pose.z);
        if (!best || dist < best.dist) best = { name: t.name, dist };
      }
      return best ? `${best.name} ${noun}` : depotName(w, d);
    }
    const kit = kitOf(piece.type);
    return kit ? kit.name[0].toUpperCase() + kit.name.slice(1) : depotName(w, d);
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

/**
 * A stop whose depot isn't on the map now (its piece taken up), as the engine card names it: by its kind or town
 * (no number: it's not among the stops to pick), "A stop" when unknown.
 */
export function lostStopName(w: Pick<World, "landscape" | "economy">, depotId: number): string {
  const d = w.economy.depot(depotId);
  return (d && depotName(w, d)) || "A stop";
}

/** What the engine card says of a stop taken up: the train runs on past it till it's back (undo) or taken off. */
export function lostStopWords(name: string): string {
  return `${name} was taken up, so it's off the route`;
}

/** A dock's name for a boat's card: its place's name, as everywhere ("Foxley landing"), or "a dock". */
export function depotLabel(w: Places, depotId: number): string {
  return w.economy.depot(depotId) ? placeName(w, depotId) : "a dock";
}
