import { Color, MeshStandardMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { CELL } from "../landscape";
import { growToCity, noRoomForBlocks } from "../game/town-testing";
import { buildStarterWorld, type World } from "../game/world";
import type { Materials } from "../render/materials";
import { PropLibrary } from "../render/props/library";
import { scaleOf } from "../catalogue/scale";
import { boxOf, townModels, townProps } from "./towns";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("town models on their squares", () => {
  it("their boxes (as modelled) are the models' own, measured from the GLB at the scale they're drawn", async () => {
    const lib = new PropLibrary(stubMaterials());
    const assets = [...new Set([...townModels().map((m) => m.asset), "bldg-school", "bldg-market-hall", "bldg-library", "bldg-college"])];
    for (const asset of assets) {
      const fp = (await lib.load(asset))!.footprint;
      const box = boxOf(asset)!;
      const k = scaleOf(asset);
      expect(box, asset).toBeDefined();
      expect(fp.cx - fp.hw, asset).toBeCloseTo(box[0] * k, 0);
      expect(fp.cx + fp.hw, asset).toBeCloseTo(box[1] * k, 0);
      expect(fp.cz - fp.hd, asset).toBeCloseTo(box[2] * k, 0);
      expect(fp.cz + fp.hd, asset).toBeCloseTo(box[3] * k, 0);
    }
  }, 60_000);

  it("no building hangs over its squares, by any amount: the starter map's towns, and grown to cities (blocks or not)", async () => {
    const lib = new PropLibrary(stubMaterials());
    for (const blocks of [true, false]) {
      const w = buildStarterWorld();
      if (!blocks) noRoomForBlocks(w.landscape);
      for (const town of w.landscape.towns) growToCity(w, town);
      vi.restoreAllMocks();
      await noOverhang(lib, w);
    }
    await noOverhang(lib, buildStarterWorld());
  }, 120_000);
});

/** Every town building's model stands within its squares (its real box, from the GLB, as posed). */
async function noOverhang(lib: PropLibrary, w: World): Promise<void> {
    const g = w.landscape.grid;
    let checked = 0;
    for (const town of w.landscape.towns) {
      for (const t of townProps(w.landscape, town)) {
        const b = town.buildings.find((x) => x.id === t.building)!;
        const fp = (await lib.load(t.asset))!.footprint;
        const s = t.scale ?? 1;
        // The model's box corners in the world, against its squares' bounds.
        const c = Math.cos(t.heading);
        const sn = Math.sin(t.heading);
        const xs: number[] = [];
        const zs: number[] = [];
        for (const mx of [fp.cx - fp.hw, fp.cx + fp.hw])
          for (const mz of [fp.cz - fp.hd, fp.cz + fp.hd]) {
            xs.push(t.x + (mx * c - mz * sn) * s);
            zs.push(t.z + (mx * sn + mz * c) * s);
          }
        const cx = b.cells.map((i) => g.centreX(g.colOf(i)));
        const cz = b.cells.map((i) => g.centreZ(g.rowOf(i)));
        const over = Math.max(Math.min(...cx) - CELL / 2 - Math.min(...xs), Math.max(...xs) - Math.max(...cx) - CELL / 2, Math.min(...cz) - CELL / 2 - Math.min(...zs), Math.max(...zs) - Math.max(...cz) - CELL / 2);
        expect(over, `${town.name} ${t.asset}`).toBeLessThanOrEqual(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
}
