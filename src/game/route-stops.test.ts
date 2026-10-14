import { describe, expect, it } from "vitest";
import { nextStop, routeStops } from "./route-stops";
import { buildStarterWorld, syncIndustries } from "./world";

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
