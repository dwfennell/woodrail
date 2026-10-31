import { Color, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { createWorld } from "../game/world";
import type { Materials } from "../render/materials";
import { modelKey, PropLibrary } from "../render/props/library";
import { extraStyles, INNER, jitterOf, RING, stackOf, stacks, storeyHeight, storeysFor } from "./storeys";
import { distanceFromCentre, fitsLot, pickOf, setTownStoreys, townModels, townProps } from "./towns";

describe("storeys: towns grow upward (issue #17)", () => {
  it("a hamlet's houses stay as modelled; each size step adds a storey at the centre", () => {
    expect(storeysFor("bldg-townhouse", 0, 0)).toBe(0);
    expect([1, 2, 3, 4].map((l) => storeysFor("bldg-townhouse", l, 0))).toEqual([1, 2, 3, 4]);
  });

  it("one storey fewer for each ring out from the centre, never below none", () => {
    expect([0, 1, 2, 3, 4].map((r) => storeysFor("bldg-townhouse", 4, INNER + r * RING + 1))).toEqual([4, 3, 2, 1, 0]);
    expect(storeysFor("bldg-townhouse", 1, INNER + 2 * RING)).toBe(0);
  });

  it("never fewer at a higher level, wherever it stands and whatever its jitter", () => {
    for (const asset of ["bldg-townhouse", "bldg-villa", "bldg-bungalow", "bldg-apartment-block"])
      for (let d = 0; d < 8 * RING; d += 13)
        for (const j of [0, 0.3, 0.99])
          for (let l = 0; l < 8; l++) expect(storeysFor(asset, l + 1, d, j)).toBeGreaterThanOrEqual(storeysFor(asset, l, d, j));
  });

  it("cottages and bungalows gain one storey at most; buildings without blocks none", () => {
    expect(storeysFor("bldg-bungalow", 6, 0)).toBe(1);
    expect(storeysFor("bldg-thatched-cottage", 6, 0)).toBe(1);
    expect(storeysFor("bldg-villa", 6, 0)).toBe(2);
    expect(storeysFor("bldg-church", 6, 0)).toBe(0);
    expect(storeysFor("bldg-fire-station", 6, 0)).toBe(0);
    expect(stacks("bldg-church")).toBe(false);
  });

  it("a stack is the ground block, floors between, and the house on top, a storey apart", () => {
    expect(stackOf("bldg-townhouse", 0)).toEqual([]);
    expect(stackOf("bldg-townhouse", 3)).toEqual([
      { piece: "bldg-townhouse-ground", y: 0 },
      { piece: "bldg-townhouse-floor", y: 20 },
      { piece: "bldg-townhouse-floor", y: 40 },
      { piece: "bldg-townhouse-upper", y: 60 },
    ]);
    expect(storeyHeight("bldg-apartment-block")).toBe(24);
    expect(jitterOf(5)).toBe(jitterOf(5));
    expect(jitterOf(5)).toBeGreaterThanOrEqual(0);
    expect(jitterOf(5)).toBeLessThan(1);
  });

  it("bigger towns build with more styles, each fitting its lot", () => {
    expect(extraStyles(0, 1)).toEqual([]);
    expect(extraStyles(1, 2)).toEqual([]);
    expect(extraStyles(2, 1).length).toBeGreaterThan(0);
    expect(extraStyles(3, 1).length).toBeGreaterThan(extraStyles(2, 1).length);
    expect(extraStyles(3, 4)).toContain("bldg-town-hall");
    expect(extraStyles(4, 4)).toContain("bldg-hospital");
    // Half the picks from the new styles, half from the town's own, from one draw.
    expect(pickOf(["a", "b"], ["X", "Y"], 0)).toBe("X");
    expect(pickOf(["a", "b"], ["X", "Y"], 0.49)).toBe("Y");
    expect(pickOf(["a", "b"], ["X", "Y"], 0.5)).toBe("a");
    expect(pickOf(["a", "b"], ["X", "Y"], 0.999)).toBe("b");
    for (const { asset, squares } of townModels()) expect(fitsLot(asset, squares), `${asset} on ${squares}`).toBe(true);
  });
});

describe("storeys on a map's towns", () => {
  const w = createWorld(4242);
  const land = w.landscape;

  it("at level 0 a town is dressed as before (Sandbox, a new map)", () => {
    for (const t of land.towns) expect(townProps(land, t, { level: 0 })).toEqual(townProps(land, t));
  });

  it("a city with no church gets one on its first new house lot of two squares or more", () => {
    let found = 0;
    for (const t of land.towns) {
      const before = townProps(land, t).filter((p) => p.asset === "bldg-church").length;
      const city = townProps(land, t, { level: 3 }).filter((p) => p.asset === "bldg-church").length;
      if (before === 0 && t.buildings.some((b) => b.cells.length >= 2 && !b.landmark)) {
        expect(city, t.name).toBe(1);
        found++;
      } else expect(city).toBeGreaterThanOrEqual(before);
    }
    // (A town dressed already keeps its models: no church dropped on it.)
    for (const t of land.towns) expect(townProps(land, t, { level: 3, dressedAs: () => "bldg-villa" })).toEqual(townProps(land, t, { dressedAs: () => "bldg-villa" }));
    expect(found).toBeGreaterThan(0);
  });

  it("each level makes its town taller, the centre most; only props that change are touched", () => {
    const t = land.towns[0];
    const props = [...w.props.all()].filter((p) => p.town === t.id && p.building !== undefined);
    const byId = new Map(t.buildings.map((b) => [b.id, b]));
    const sum = () => props.reduce((n, p) => n + (p.storeys ?? 0), 0);
    let last = -1;
    for (let level = 0; level <= 4; level++) {
      setTownStoreys(land, t, w.props, level);
      expect(sum(), `level ${level}`).toBeGreaterThan(last);
      last = sum();
      if (level === 0) last = 0;
    }
    // Taller toward the centre: the nearest house over the farthest, and a city ★'s middle three storeys up or more.
    const stacked = props.filter((p) => stacks(p.asset)).sort((a, b) => distanceFromCentre(land, t, byId.get(a.building!)!) - distanceFromCentre(land, t, byId.get(b.building!)!));
    expect(stacked[0].storeys ?? 0).toBeGreaterThan(stacked[stacked.length - 1].storeys ?? 0);
    expect(Math.max(...stacked.map((p) => p.storeys ?? 0))).toBeGreaterThanOrEqual(3);
    const v = w.props.version;
    expect(setTownStoreys(land, t, w.props, 4)).toBe(0);
    expect(w.props.version).toBe(v);
    // Back to a hamlet (a fresh game on the same map): flat again.
    setTownStoreys(land, t, w.props, 0);
    expect(sum()).toBe(0);
  });
});

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("a stacked house's model", () => {
  it("is its storeys taller than the house, on the same footprint", async () => {
    const lib = new PropLibrary(stubMaterials());
    const plain = (await lib.load(modelKey("bldg-townhouse")))!;
    const two = (await lib.load(modelKey("bldg-townhouse", 0, 2)))!;
    const painted = (await lib.load(modelKey("bldg-townhouse", 2, 2)))!;
    expect(two.height).toBeCloseTo(plain.height + 40, 0);
    expect(two.footprint.hw).toBeCloseTo(plain.footprint.hw, 0);
    expect(two.footprint.hd).toBeCloseTo(plain.footprint.hd, 0);
    expect(painted.height).toBeCloseTo(two.height, 0);
  });
});
