import { Color, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { Materials } from "../../render/materials";
import { Kit } from "../kit";
import { fileOf } from "../registry";
import { PROP_TABS } from "../shelves";
import { ASSETS as grand } from "./grand";
import { ASSETS as royal, ROYAL_ENGINE_LENGTH, ROYAL_SALOON_LENGTH } from "./royal-train";
import { Box3 } from "three";
import { CAR_SPECS } from "../../sim/cars";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

/** Triangles in a built model, as the props draw it (`PROP_DETAIL` 0.5; underlays left out, as `bake` does). */
function triangles(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (let p: Object3D | null = mesh; p; p = p.parent) if (p.userData.underlay) return;
    const g = mesh.geometry;
    n += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  });
  return n;
}

/**
 * Triangle budgets for the design assets (spec 2026-11-05), as props are drawn: a grand project is one per map, big
 * on screen; a secret site or a path landmark a few per map. For scale, built the same way: the bandstand
 * is about 2,100, the playground 2,200, the fountain 1,200.
 */
const BUDGET = { grand: 14000 } as const;

const kit = new Kit(stubMaterials(), 0.5);
const listed = new Set(PROP_TABS.flatMap((t) => t.shelves).flatMap((s) => s.assets));

describe("grand projects' models", () => {
  for (const [kind, list] of [["grand", grand]] as const) {
    for (const a of list) {
      it(`${a.id} builds under ${BUDGET[kind]} triangles, loads by its file and is on a Sandbox shelf`, () => {
        const root = a.build(kit);
        const tris = triangles(root);
        expect(tris, a.id).toBeGreaterThan(50);
        expect(tris, a.id).toBeLessThan(BUDGET[kind]);
        expect(fileOf(a.id)).toBe(kind);
        expect(listed.has(a.id), a.id).toBe(true);
        a.animate?.(root, 2);
      });
    }
  }

  it("every grand project has a model for each of its stages", () => {
    for (const [p, last] of [["grand-exhibition", 4], ["grand-cathedral", 4], ["grand-central", 3], ["grand-ferris-wheel", 3], ["grand-royal-train", 3]] as const)
      for (let n = 0; n <= last; n++) expect(grand.some((a) => a.id === `${p}-${n}`), `${p}-${n}`).toBe(true);
  });

  it("the Royal Train's cars are car-ready: the engine's and the coach's lengths, wheels' feet on y = 0, a bogies node, few triangles", () => {
    expect(ROYAL_ENGINE_LENGTH).toBe(CAR_SPECS.engine.length);
    expect(ROYAL_SALOON_LENGTH).toBe(CAR_SPECS.passenger.length);
    for (const a of royal) {
      const root = a.build(kit);
      expect(root.getObjectByName("bogies"), a.id).toBeTruthy();
      root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(root);
      expect(box.min.y, a.id).toBeGreaterThan(-0.5);
      expect(box.min.y, a.id).toBeLessThan(2);
      expect(triangles(root), a.id).toBeLessThan(4000);
    }
  });
});

describe("a grand project's plot (stage 0)", () => {
  it("covers every later stage's footprint, so the site it reserves is the one it grows to", async () => {
    const { loadFootprints } = await import("../../props/footprints-testing");
    const fp = await loadFootprints(["grand"]);
    for (const [p, last] of [["grand-exhibition", 4], ["grand-cathedral", 4], ["grand-central", 3], ["grand-ferris-wheel", 3], ["grand-royal-train", 3]] as const) {
      const site = fp(`${p}-0`)!;
      for (let n = 1; n <= last; n++) {
        const f = fp(`${p}-${n}`)!;
        // (Within a few mm: a crane's jib or a flag may reach a little past the fence.)
        expect(f.cx - f.hw, `${p}-${n} x0`).toBeGreaterThanOrEqual(site.cx - site.hw - 4);
        expect(f.cx + f.hw, `${p}-${n} x1`).toBeLessThanOrEqual(site.cx + site.hw + 4);
        expect(f.cz - f.hd, `${p}-${n} z0`).toBeGreaterThanOrEqual(site.cz - site.hd - 4);
        expect(f.cz + f.hd, `${p}-${n} z1`).toBeLessThanOrEqual(site.cz + site.hd + 4);
      }
    }
  }, 60_000);
});
