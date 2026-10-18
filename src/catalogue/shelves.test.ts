import { describe, expect, it } from "vitest";
import { CATALOGUE } from "./assets";
import { fileOf } from "./registry";
import { BRIDGE_PROP_SHELVES, PROP_TABS, RAIL_HELD_BACK } from "./shelves";
import { KIT_TYPES, KITS } from "../track";

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

  it("leave out what's deferred: roads, tunnels, the sky, the catalogue's track and trains, and what looks like railway but isn't yet", () => {
    for (const id of ["scene-road-straight", "scene-roundabout", "scene-car-park", "scene-rainbow", "scene-clouds", "scene-sun-moon"]) expect(listed).not.toContain(id);
    const offered = new Set(listed);
    for (const id of RAIL_HELD_BACK) expect(ids.has(id), id).toBe(true);
    const held = new Set(RAIL_HELD_BACK);
    const rest = CATALOGUE.filter((a) => !offered.has(a.id) && !held.has(a.id) && !a.inGame && a.category !== "Track" && a.category !== "Trains" && a.category !== "Wagons");
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

  it("offer every kit piece's model on a Sandbox shelf, none of them held back", () => {
    const held = new Set(RAIL_HELD_BACK);
    for (const type of KIT_TYPES) {
      const asset = KITS[type].asset;
      expect(listed, type).toContain(asset);
      expect(held.has(asset), type).toBe(false);
    }
    // Stations and sheds on Buildings → Railway; the machines on Machines → Railway & yard.
    const shelf = (tab: string, label: string) => PROP_TABS.find((t) => t.id === tab)!.shelves.find((s) => s.label === label)!.assets;
    for (const a of ["bldg-two-platform-station", "bldg-grand-terminus", "bldg-engine-shed", "bldg-roundhouse-segment", "bldg-castle-gate"]) expect(shelf("buildings", "Railway")).toContain(a);
    for (const a of ["mech-gantry-crane", "mech-log-loader", "mech-water-crane", "mech-fuel-station", "mech-weighbridge"]) expect(shelf("machines", "Railway & yard")).toContain(a);
  });
});
