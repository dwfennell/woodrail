import { describe, expect, it } from "vitest";
import { deliveryStops, nextStop } from "./delivery";
import { buildStarterWorld, syncIndustries } from "./world";

describe("delivery stops", () => {
  it("lists the depots that take goods, towns first; a tap goes through them and back to anywhere", () => {
    const w = buildStarterWorld();
    syncIndustries(w);
    const stops = deliveryStops(w);
    expect(stops.length).toBeGreaterThan(1);
    expect(stops[0].name).toBe(w.landscape.towns.find((t) => t.id === w.economy.depot(stops[0].depotId)!.townId)!.name);
    // Forest yards give logs but take nothing: never a stop.
    expect(stops.every((s) => w.economy.depot(s.depotId)!.role !== "forest")).toBe(true);
    expect(stops.some((s) => s.name === "Sawmill")).toBe(true);
    let at = -1;
    const seen: number[] = [];
    for (let k = 0; k <= stops.length; k++) seen.push((at = nextStop(stops, at)));
    expect(seen).toEqual([...stops.map((s) => s.depotId), -1]);
  });
});
