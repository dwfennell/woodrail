import { Box3, MeshStandardMaterial, type BufferGeometry, type Material } from "three";
import { describe, expect, it } from "vitest";
import { CELL, FIELD_STOCK, generateLandscape, type Field } from "../../landscape";
import type { Materials } from "../materials";
import type { Batcher } from "./batcher";
import { buildField, fieldDressing } from "./fields";

const land = (() => {
  for (let seed = 1; ; seed++) {
    const l = generateLandscape(seed);
    if (l.fields.length > 0) return l;
  }
})();

const mats = (() => {
  const wood = new MeshStandardMaterial();
  return { naturalWood: wood, lacquer: (c: string) => Object.assign(new MeshStandardMaterial(), { userData: { paintColor: c } }) } as unknown as Materials;
})();

/** Builds a field into a stand-in batcher, returning the bounds of everything added and the lacquer colours used. */
function build(field: Field): { box: Box3; colors: Set<string>; parts: number } {
  const box = new Box3();
  const colors = new Set<string>();
  let parts = 0;
  const b = {
    add(m: Material, g: BufferGeometry) {
      g.computeBoundingBox();
      box.union(g.boundingBox!);
      if (m.userData.paintColor) colors.add(m.userData.paintColor);
      parts++;
    },
  } as unknown as Batcher;
  buildField(land, field, mats, b);
  return { box, colors, parts };
}

describe("field dressing", () => {
  it("every stock is chosen by the generator on some map", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60 && seen.size < FIELD_STOCK.length; seed++) for (const f of generateLandscape(seed).fields) seen.add(f.animal);
    expect([...seen].sort()).toEqual([...FIELD_STOCK].sort());
  });

  it("walls, gates and every corner prop turn up across fields", () => {
    const corners = new Set<string>();
    let walls = 0;
    let gates = 0;
    for (const animal of FIELD_STOCK) {
      for (let id = 0; id < 30; id++) {
        const d = fieldDressing(land.seed + id * 101, { ...land.fields[0], id, animal });
        walls += d.wall ? 1 : 0;
        gates += d.gateSide >= 0 ? 1 : 0;
        for (const c of d.corners) if (c) corners.add(c);
        if (animal === "chicken") expect(d.corners).toContain("coop");
      }
    }
    expect(walls).toBeGreaterThan(20);
    expect(walls).toBeLessThan(160);
    expect(gates).toBeGreaterThan(40);
    expect([...corners].sort()).toEqual(["barn", "coop", "hay", "haystack", "hives", "trough"]);
  });

  it("everything stays inside the field's 2 × 2 squares", () => {
    const base = land.fields[0];
    const col = land.grid.colOf(base.cells[0]);
    const row = land.grid.rowOf(base.cells[0]);
    const left = land.grid.centreX(col) - CELL / 2;
    const top = land.grid.centreZ(row) - CELL / 2;
    for (const animal of FIELD_STOCK) {
      for (let id = 0; id < 12; id++) {
        const { box, parts } = build({ ...base, id, animal });
        expect(parts).toBeGreaterThan(40);
        expect(box.min.x).toBeGreaterThanOrEqual(left);
        expect(box.min.z).toBeGreaterThanOrEqual(top);
        expect(box.max.x).toBeLessThanOrEqual(left + CELL * 2);
        expect(box.max.z).toBeLessThanOrEqual(top + CELL * 2);
      }
    }
  });

  it("pigs get mud, chickens a red coop, crops a scarecrow", () => {
    const base = land.fields[0];
    expect(build({ ...base, animal: "pig" }).colors).toContain("#6b4a2b");
    expect(build({ ...base, animal: "chicken" }).colors).toContain("#c8402f");
    expect(build({ ...base, animal: "crops" }).colors).toContain("#e2c48a");
  });
});
