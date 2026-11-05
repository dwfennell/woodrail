import { Color, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { Materials } from "../../render/materials";
import { Kit } from "../kit";
import { fileOf } from "../registry";
import { PROP_TABS } from "../shelves";
import { ASSETS as grand } from "./grand";
import { ASSETS as paths } from "./paths";
import { ASSETS as secrets } from "./secrets";

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
const BUDGET = { grand: 14000, secret: 6000, path: 8000 } as const;

const kit = new Kit(stubMaterials(), 0.5);
const listed = new Set(PROP_TABS.flatMap((t) => t.shelves).flatMap((s) => s.assets));

describe("design assets: grand projects, secret sites, path landmarks", () => {
  for (const [kind, list] of [["grand", grand], ["secret", secrets], ["path", paths]] as const) {
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

  it("every grand project has its three stages, and every secret its hidden and found states", () => {
    for (const p of ["grand-exhibition", "grand-cathedral", "grand-central", "grand-ferris-wheel", "grand-royal-train"]) for (const n of [1, 2, 3]) expect(grand.some((a) => a.id === `${p}-${n}`), `${p}-${n}`).toBe(true);
    for (const a of secrets.filter((s) => !s.id.endsWith("-hidden"))) expect(secrets.some((s) => s.id === `${a.id}-hidden`), a.id).toBe(true);
  });
});
