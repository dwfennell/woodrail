import { describe, expect, it } from "vitest";
import { getPieceDef, isPlainStraight, KIT_TYPES, kitForAsset, kitOf, kitPlace, KITS, PIECE_TYPES, straightLength, type PieceTypeId } from ".";

describe("kit pieces", () => {
  it("are piece types, generated from the kits", () => {
    expect(KIT_TYPES).toContain("kit-platform-furnished");
    for (const type of KIT_TYPES) {
      expect(PIECE_TYPES).toContain(type);
      // The piece's def is the kit's track.
      expect(getPieceDef(type, false)).toBe(KITS[type].track);
      expect(getPieceDef(type, false).type).toBe(type);
    }
  });

  it("kitOf finds a kit by its type, and nothing for other pieces", () => {
    const kit = kitOf("kit-platform-furnished")!;
    expect(kit.asset).toBe("bldg-platform-furnished");
    expect(kitOf("straight-216")).toBeUndefined();
    expect(kitOf("depot-workshop")).toBeUndefined();
    // Not fooled by the prototype's keys.
    expect(kitOf("constructor" as PieceTypeId)).toBeUndefined();
    expect(kitForAsset("bldg-platform-furnished")).toBe("kit-platform-furnished");
    expect(kitForAsset("bldg-country-halt")).toBeUndefined();
  });

  it("splicing kits are single straights a multiple of 54 long, and not plain straights", () => {
    for (const type of KIT_TYPES) {
      const kit = KITS[type];
      if (!kit.splices) continue;
      const len = straightLength(type, false);
      expect(len, type).toBeGreaterThan(0);
      expect(len % 54, type).toBe(0);
      // A kit isn't spliced onto (nor taken up by) another kit or a depot.
      expect(isPlainStraight(type)).toBe(false);
    }
  });

  it("the furnished platform: a 216 straight, its platform on the +l side, a 4 s stop for passengers", () => {
    const kit = KITS["kit-platform-furnished"];
    expect(straightLength("kit-platform-furnished", false)).toBe(216);
    expect(kit.splices).toBe(true);
    expect(kit.rails).toBe("track");
    expect(kit.stop).toEqual({ at: 196, seconds: 4, who: "passengers" });
    // Clear of the track (40 wide), on its left.
    for (const r of kit.footprint) expect(r.l - r.d / 2).toBeGreaterThanOrEqual(20);
    expect(kitPlace(kit)).toEqual({ t: 108, l: 34, turn: Math.PI });
  });
});
