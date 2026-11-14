import { describe, expect, it } from "vitest";
import { ROW_ASSETS, ROW_BODIES, ROW_ROOFS, rowAssetIds, rowColours, rowFor, rowVariant, townPalette } from "./rows";
import { stacks } from "./storeys";

describe("towns in rows: colours and assets", () => {
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

  it("neither house of a pair takes a colour of the pair beside it", () => {
    const p = townPalette(7, 1, 3);
    for (let h = 0; h < 400; h++) {
      const beside = rowVariant(p, h * 31 + 5, []);
      const theirs = [rowColours(beside).body, rowColours(beside).second];
      const mine = rowColours(rowVariant(p, h, [beside]));
      expect(theirs, `${h}`).not.toContain(mine.body);
      expect(theirs, `${h}`).not.toContain(mine.second);
    }
  });

  it("a row keeps clear what its building does, not its whole tile: track fits beside it as it did beside a house", async () => {
    const { rowFootprint, civicAssets } = await import("./rows");
    for (const id of [...rowAssetIds(), ...civicAssets().map((c) => c.id)]) {
      const f = rowFootprint(id);
      const lot = id === "row-court" || civicAssets().some((c) => c.id === id && c.squares === 2) || ["row-terrace", "row-bakery", "row-cafe", "row-post", "row-flats"].includes(id) ? 72 : 36;
      // (8 mm in from each end of its lot, and no deeper than a house: 48 mm.)
      expect(f.hd, id).toBeLessThanOrEqual(lot - 8);
      expect(f.hw, id).toBeLessThanOrEqual(24);
    }
  });

  it("every house and shop a town builds today has a row", () => {
    for (const old of ["bldg-townhouse", "bldg-thatched-cottage", "bldg-timber-house", "bldg-bungalow", "bldg-brick-house", "bldg-narrow-house", "bldg-semi-detached", "bldg-villa", "bldg-terrace", "bldg-cottage-row", "bldg-corner-shop", "bldg-toy-shop", "bldg-apartment-block", "bldg-bakery", "bldg-cafe", "bldg-post-office"]) {
      expect(rowAssetIds()).toContain(rowFor(old));
    }
  });

  it("every landmark, place and civic style a town can put up has a model made for its lot", async () => {
    const { LANDMARKS } = await import("../game/landmarks");
    const { PLACES } = await import("../game/places");
    const { STYLES_BY_LEVEL } = await import("./storeys");
    const { fitScale, PLACE_MIN_FIT } = await import("./towns");
    const { civicRow, civicAssets, rowSquares } = await import("./rows");
    const made = new Set([...rowAssetIds(), ...civicAssets().map((c) => c.id)]);
    const want: [string, number, number][] = [["bldg-church", 2, 1], ["bldg-church", 4, 1]];
    for (const m of LANDMARKS) for (const [n, list] of [[1, m.models.one], [2, m.models.two], [4, [...(m.models.four ?? []), ...m.models.two]]] as const) for (const a of list) want.push([a, n, 1]);
    for (const m of PLACES) for (const [n, list] of [[1, m.models.one], [2, m.models.two], [4, [...(m.models.four ?? []), ...m.models.two]]] as const) for (const a of list) want.push([a, n, PLACE_MIN_FIT]);
    for (const st of STYLES_BY_LEVEL) for (const [n, list] of [[1, st.one], [2, st.two], [4, st.four]] as const) for (const a of list) want.push([a, n, 1]);
    let civic = 0;
    for (const [asset, squares, min] of want) {
      // (Park furniture, `scene-*`, stays as it is; a model that doesn't fit a lot never goes up on it.)
      if (!asset.startsWith("bldg-") || fitScale(asset, squares, min) === null) continue;
      const row = civicRow(asset, squares) ?? rowFor(asset);
      expect(row, `${asset} on ${squares}`).toBeDefined();
      expect(made, `${asset} on ${squares}`).toContain(row);
      if (civicRow(asset, squares)) civic++;
      // Made for that lot (on a block, one for two squares may stand on the street's two).
      const lot = rowSquares(row!);
      if (civicRow(asset, squares)) expect(lot === squares || (squares === 4 && lot === 2), `${row} on ${squares}`).toBe(true);
    }
    expect(civic).toBeGreaterThan(20);
    expect(civicAssets()).toHaveLength(23);
  });

  it("every row can gain storeys", () => {
    expect(rowAssetIds()).toHaveLength(17);
    for (const id of rowAssetIds()) expect(stacks(id), id).toBe(true);
    expect(ROW_ASSETS.four.court).toBe("row-court");
  });
});
