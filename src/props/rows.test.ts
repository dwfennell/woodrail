import { describe, expect, it } from "vitest";
import { ROW_ASSETS, ROW_BODIES, ROW_ROOFS, rowAssetIds, rowColours, rowFor, rowsOn, rowVariant, townPalette } from "./rows";
import { stacks } from "./storeys";

describe("towns in rows: colours and assets", () => {
  it("is off without ?rows", () => {
    expect(rowsOn()).toBe(false);
  });

  it("a variant names one body and one roof, the same in every town", () => {
    const seen = new Set<string>();
    for (let v = 0; v < ROW_BODIES.length * ROW_ROOFS.length; v++) {
      const c = rowColours(v);
      expect(c.door).not.toBe(c.body);
      seen.add(`${c.body} ${c.roof}`);
    }
    expect(seen.size).toBe(32);
    // An old save's hue shifts (0 to 3): four different bodies under the first roof.
    expect(new Set([0, 1, 2, 3].map((v) => rowColours(v).body)).size).toBe(4);
    expect(new Set([0, 1, 2, 3].map((v) => rowColours(v).roof)).size).toBe(1);
  });

  it("a town's palette is its own, and steady", () => {
    const a = townPalette(7, 1, 2);
    expect(townPalette(7, 1, 2)).toEqual(a);
    expect(a.bodies).toHaveLength(5);
    expect(new Set(a.bodies).size).toBe(5);
    expect(a.roofs).toHaveLength(2);
    const city = townPalette(7, 1, 3);
    expect(city.roofs).toHaveLength(3);
    expect(city.roofs.slice(0, 2)).toEqual(a.roofs);
    expect(city.bodies).toEqual(a.bodies);
    expect([1, 2, 3, 4, 5, 6].some((id) => townPalette(7, id, 2).bodies.join() !== a.bodies.join())).toBe(true);
  });

  it("a slice never takes the body colour of one beside it", () => {
    const p = townPalette(7, 1, 3);
    for (let h = 0; h < 200; h++) {
      const beside = [rowVariant(p, h * 31 + 5, []), rowVariant(p, h * 17 + 3, [])];
      const v = rowVariant(p, h, beside);
      expect(beside.map((b) => rowColours(b).body)).not.toContain(rowColours(v).body);
      expect(p.bodies).toContain(v % ROW_BODIES.length);
      expect(p.roofs).toContain(Math.floor(v / ROW_BODIES.length));
      expect(rowVariant(p, h, beside)).toBe(v);
    }
  });

  it("every house and shop a town builds today has a row", () => {
    for (const old of ["bldg-townhouse", "bldg-thatched-cottage", "bldg-timber-house", "bldg-bungalow", "bldg-brick-house", "bldg-narrow-house", "bldg-semi-detached", "bldg-villa", "bldg-terrace", "bldg-cottage-row", "bldg-corner-shop", "bldg-toy-shop", "bldg-apartment-block", "bldg-bakery", "bldg-cafe", "bldg-post-office"]) {
      expect(rowAssetIds()).toContain(rowFor(old));
    }
    for (const kept of ["bldg-church", "bldg-town-hall", "bldg-fire-station", "bldg-ice-cream-kiosk"]) expect(rowFor(kept)).toBeUndefined();
  });

  it("every row can gain storeys", () => {
    expect(rowAssetIds()).toHaveLength(17);
    for (const id of rowAssetIds()) expect(stacks(id), id).toBe(true);
    expect(ROW_ASSETS.four.court).toBe("row-court");
  });
});
