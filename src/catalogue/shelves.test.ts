import { describe, expect, it } from "vitest";
import { CATALOGUE } from "./assets";
import { fileOf } from "./registry";
import { BRIDGE_PROP_SHELVES, PROP_TABS } from "./shelves";

const listed = [...PROP_TABS.flatMap((t) => t.shelves), ...BRIDGE_PROP_SHELVES].flatMap((s) => s.assets);
const ids = new Set(CATALOGUE.map((a) => a.id));

describe("prop shelves", () => {
  it("list real catalogue assets, each once, all loadable by file", () => {
    for (const id of listed) {
      expect(ids.has(id), id).toBe(true);
      expect(fileOf(id), id).not.toBeNull();
    }
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("leave out what's deferred: roads, tunnels, the sky, the catalogue's track and trains", () => {
    for (const id of ["scene-road-straight", "scene-roundabout", "scene-car-park", "scene-rainbow", "scene-clouds", "scene-sun-moon"]) expect(listed).not.toContain(id);
    const offered = new Set(listed);
    const rest = CATALOGUE.filter((a) => !offered.has(a.id) && !a.inGame && a.category !== "Track" && a.category !== "Trains" && a.category !== "Wagons");
    expect(rest.map((a) => a.id).sort()).toEqual([
      "mech-double-tunnel",
      "mech-mountain-tunnel",
      "mech-rock-cutting",
      "mech-tunnel-portal",
      "scene-car-park",
      "scene-clouds",
      "scene-rainbow",
      "scene-road-curve",
      "scene-road-junction",
      "scene-road-straight",
      "scene-roundabout",
      "scene-sun-moon",
      "scene-zebra-crossing",
    ]);
  });
});
