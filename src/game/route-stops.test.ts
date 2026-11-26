import { describe, expect, it } from "vitest";
import type { DepotRole } from "../economy";
import { depotLabel } from "./boats";
import { mapMarkers } from "./map-markers";
import { receivedBy } from "./town-life";
import { townStatus } from "./towns";
import { nextStop, placeCardTitle, placeName, routeStops } from "./route-stops";
import { buildStarterWorld, DEPOT_NAMES, syncIndustries } from "./world";

describe("route stops", () => {
  it("lists every depot, towns first; a tap goes through them and round again", () => {
    const w = buildStarterWorld();
    syncIndustries(w);
    const stops = routeStops(w);
    expect(stops).toHaveLength(w.economy.allDepots().length);
    expect(stops[0].name).toBe(w.landscape.towns.find((t) => t.id === w.economy.depot(stops[0].depotId)!.townId)!.name);
    expect(stops.some((s) => s.name === "Sawmill")).toBe(true);
    expect(stops.some((s) => s.name === "Forest yard")).toBe(true);
    let at = stops[0].depotId;
    const seen = [at];
    for (let k = 1; k <= stops.length; k++) seen.push((at = nextStop(stops, at)));
    expect(seen).toEqual([...stops.map((s) => s.depotId), stops[0].depotId]);
  });
});

describe("a place's name", () => {
  // Player report (2026-11-26): "certain places will be given names like 'TOWN X River Landing' but then when you click
  // on something it just says 'River Landing'". One name for a place, the same on its card, its stops, a boat's stops
  // and the map's markers, for every kind of place, in one case style.
  it("is the same on its card, on a line's stops, on a boat's stops and on the map, for every role", () => {
    const w = buildStarterWorld();
    syncIndustries(w);
    const roles = (Object.keys(DEPOT_NAMES) as DepotRole[]).filter((r) => r !== "town");
    const t = w.landscape.towns[0].centre;
    // One of each (and a second sawmill and landing: numbered, or by another town), each on a straight of its own.
    const ids = [...roles, "sawmill", "landing"].map((role, i) => {
      const piece = w.layout.addPiece("straight-216", { x: t.x + 20000 + (i % 8) * 400, z: t.z + 20000 + Math.floor(i / 8) * 400, heading: 0 }, 0);
      return { role, id: w.economy.addDepot(role as DepotRole, piece).id };
    });
    const stops = routeStops(w);
    const markers = new Map(mapMarkers(w, (id) => townStatus(receivedBy(w, id))).map((m) => [m.key, m.title]));
    for (const d of w.economy.allDepots()) {
      const name = stops.find((s) => s.depotId === d.id)?.name;
      const what = `${d.role} #${d.id}`;
      expect(name, what).toBeTruthy();
      expect(placeName(w, d.id), what).toBe(name);
      expect(placeCardTitle(w, d.id).title, what).toBe(name);
      if (d.role === "landing" || d.role === "harbour" || d.role === "boatyard") expect(depotLabel(w, d.id), what).toBe(name);
      const marker = markers.get(`site:${d.id}`);
      if (marker !== undefined) expect(marker, what).toBe(name);
      // One case style: a capital at the start (a town's name keeps its own), the kind in lower case after it.
      expect(name![0], what).toBe(name![0].toUpperCase());
      const kind = placeCardTitle(w, d.id).kind;
      if (kind) expect(name!.toLowerCase().includes(kind.split(" ").at(-1)!.toLowerCase()), `${what}: "${name}" says it's a ${kind}`).toBe(true);
    }
    // A dock by the town nearest it, its kind under it on its card; an industry numbered when there are two.
    const landings = ids.filter((x) => x.role === "landing").map((x) => placeCardTitle(w, x.id));
    expect(landings[0].title).toMatch(/^[A-Z][a-z]+.* landing( \d)?$/);
    expect(landings[0].kind).toBe("River landing");
    expect(stops.filter((s) => /^Sawmill \d$/.test(s.name)).length).toBeGreaterThanOrEqual(2);
    expect(placeCardTitle(w, ids.find((x) => x.role === "foundry")!.id)).toEqual({ title: "Foundry", kind: "" });
  });
});
