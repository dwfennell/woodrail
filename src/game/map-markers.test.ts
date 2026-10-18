import { describe, expect, it } from "vitest";
import { mapMarkers } from "./map-markers";
import { receivedBy } from "./town-life";
import { townStatus } from "./towns";
import { buildStarterWorld } from "./world";

describe("map markers", () => {
  it("point out every town with what it wants, and every depot with its stock", () => {
    const w = buildStarterWorld();
    w.economy.delivered.set(w.landscape.towns[0].id, 6);
    const markers = mapMarkers(w, (id) => townStatus(receivedBy(w, id)));
    const towns = markers.filter((m) => m.kind === "town");
    expect(towns).toHaveLength(w.landscape.towns.length);
    expect(towns[0]).toMatchObject({ title: w.landscape.towns[0].name, detail: "Village · wants 🪵 planks 2/8", fill: 0.25 });
    expect(towns[1].detail).toBe("Hamlet · wants 🪵 planks 0/4");
    const forest = markers.find((m) => m.kind === "forest")!;
    expect(forest).toMatchObject({ title: "Forest yard", detail: "🌲 Logs 0" });
    expect(markers.find((m) => m.kind === "sawmill")!.detail).toBe("🌲 Logs 0 · 🪵 Planks 0");
    expect(new Set(markers.map((m) => m.key)).size).toBe(markers.length);
  });

  it("point out an industry the player put down (a workshop) too, but nothing twice (QA: the map had no workshop)", () => {
    const w = buildStarterWorld();
    const before = mapMarkers(w, (id) => townStatus(receivedBy(w, id)));
    const at = w.layout.addPiece("depot-workshop", { x: 900, z: -400, heading: 0 });
    w.economy.addDepot("workshop", at);
    const after = mapMarkers(w, (id) => townStatus(receivedBy(w, id)));
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((m) => m.kind === "workshop")).toMatchObject({ title: "Workshop", x: 900, z: -400 });
    expect(new Set(after.map((m) => m.key)).size).toBe(after.length);
  });
});
