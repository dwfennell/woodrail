import { describe, expect, it } from "vitest";
import { layoutWeb, TAG_W, type Station } from "./blueprint-board";

const st = (id: string, branch: string, needs: string[] = []): Station => ({ id, label: id, blurb: "", branch, makes: [], state: "locked", seen: "shown", needs, price: "free", planks: 0, requires: [] });

describe("the blueprint web", () => {
  it("puts each blueprint a column right of its furthest prerequisite, branches in bands, nothing overlapping", () => {
    const stations = [st("switches", "track"), st("junctions", "track", ["switches"]), st("routes", "logistics", ["switches"]), st("warehouses", "logistics", ["routes"]), st("harbours", "water", ["warehouses", "junctions"]), st("bridges", "track")];
    const web = layoutWeb(stations, ["track", "logistics", "water", "food"]);
    const at = (id: string) => web.at.get(id)!;
    expect(at("junctions").x).toBeGreaterThan(at("switches").x);
    expect(at("warehouses").x).toBeGreaterThan(at("routes").x);
    // Harbours follow their furthest prerequisite (warehouses), not the nearer one.
    expect(at("harbours").x).toBeGreaterThan(at("warehouses").x);
    // Bands in order, an empty branch (food) takes no room; each tag inside its own band.
    expect(web.bands.map((b) => b.id)).toEqual(["track", "logistics", "water"]);
    for (const s of stations) {
      const band = web.bands.find((b) => b.id === s.branch)!;
      expect(at(s.id).y).toBeGreaterThanOrEqual(band.top);
      expect(at(s.id).y).toBeLessThan(band.top + band.height);
    }
    const spots = stations.map((s) => `${at(s.id).x},${at(s.id).y}`);
    expect(new Set(spots).size).toBe(stations.length);
    expect(web.width).toBeGreaterThanOrEqual(Math.max(...stations.map((s) => at(s.id).x)) + TAG_W);
  });
});
