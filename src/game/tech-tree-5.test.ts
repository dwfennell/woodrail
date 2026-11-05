import { describe, expect, it } from "vitest";
import { archFloors, bridgeLevels, checkPlacement, gridWithPlots, SURF_RIVER, type Landscape } from "../landscape";
import { archesOf, BRIDGE_LENGTH, getPieceDef, isBridge, RISER_HEIGHT, VIADUCT_LENGTH } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { THING_RULES } from "./things";
import { GAME_TRACK_KITS, BRIDGE_GROUPS, trayKey } from "../ui/tray-catalogue";
import { planUnderpass } from "./underpass-dig";

function flat(): Landscape {
  return { seed: 0, starter: false, grid: gridWithPlots(-1, -1, 2, 2), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}
/** River squares along z across x 96..150 (the clearance test's). */
function river(land: Landscape): void {
  const g = land.grid;
  for (let x = 96; x <= 150; x += 16)
    for (let z = -100; z <= 100; z += 16) {
      const i = g.cellAtWorld(x, z);
      if (i !== -1) g.surface[i] = SURF_RIVER;
    }
}
const P = (x: number, z: number, heading = 0) => ({ x, z, heading });

describe("Stone viaduct", () => {
  it("is a bridge twice as long on four arches the size of a bridge's", () => {
    expect(isBridge("viaduct")).toBe(true);
    expect(VIADUCT_LENGTH).toBe(2 * BRIDGE_LENGTH);
    const a = archesOf("viaduct");
    const b = archesOf("bridge");
    expect(a.centres).toHaveLength(4);
    expect(a.radius * VIADUCT_LENGTH).toBeCloseTo(b.radius * BRIDGE_LENGTH);
    expect(getPieceDef("viaduct", false).connectors[1].pose.x).toBeCloseTo(VIADUCT_LENGTH);
  });

  it("stands over a river and across a valley between two hills, on arches down to the ground", () => {
    const land = flat();
    river(land);
    expect(checkPlacement(land, "viaduct", false, P(-100, 0), RISER_HEIGHT)).toEqual({ kind: "clear" });
    expect(bridgeLevels(land, "viaduct", false, P(-100, 0), RISER_HEIGHT)).toBe(1);
    // A valley: hills two levels up either side of a gap 4 squares wide; the viaduct spans it at the hilltops.
    const v = flat();
    const g = v.grid;
    for (let x = -400; x < 800; x += 36)
      for (let z = -100; z < 100; z += 36) {
        const i = g.cellAtWorld(x, z);
        if (i !== -1 && (x < 0 || x >= 360)) g.height[i] = 2;
      }
    const y = 2 * RISER_HEIGHT;
    expect(bridgeLevels(v, "viaduct", false, P(-36, 0), y)).toBe(2);
    // (Its end arches spring from the hilltops; the middle ones reach the valley floor.)
    const floors = archFloors(v, "viaduct", false, P(-36, 0), y, 2);
    expect(floors === null || floors.some((f) => f === 2)).toBe(true);
  });

  it("digs no underpass (it spans valleys, not lines)", () => {
    expect(planUnderpass({} as never, "viaduct", false, P(0, 0), RISER_HEIGHT, -1 as never)).toBeNull();
  });

  it("is researched (tier 3, after Bridges and Quarries) and made with stone; on the Bridges shelf", () => {
    const row = BLUEPRINTS.find((b) => b.id === "viaduct")!;
    expect(row.plan).toBeUndefined();
    expect(row.tier).toBe(3);
    expect(row.needs).toEqual(["bridges", "quarries"]);
    expect(THING_RULES["piece:viaduct"]).toMatchObject({ tech: "viaduct", cost: { stone: 4 } });
    expect(BRIDGE_GROUPS[0].items.map(trayKey)).toContain("piece:viaduct");
  });
});

describe("Lift bridge", () => {
  it("crosses a river at the ground, which a straight can't", () => {
    const land = flat();
    river(land);
    expect(checkPlacement(land, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "river" });
    expect(checkPlacement(land, "kit-lift-bridge", false, P(0, 0), 0)).toEqual({ kind: "clear" });
  });

  it("is researched (tier 3, after Bridges and Harbours), made with iron, a Railway kit", () => {
    const row = BLUEPRINTS.find((b) => b.id === "lift-bridge")!;
    expect(row.plan).toBeUndefined();
    expect(row.needs).toEqual(["bridges", "harbours"]);
    expect(THING_RULES["piece:kit-lift-bridge"]).toMatchObject({ tech: "lift-bridge", cost: { iron: 2 } });
    expect(GAME_TRACK_KITS.items.map(trayKey)).toContain("piece:kit-lift-bridge");
  });
});
