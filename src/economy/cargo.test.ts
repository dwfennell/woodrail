import { describe, expect, it } from "vitest";
import { CAR_KINDS, CAR_SPECS } from "../sim";
import { CARGO, CARGO_KINDS, COIN_ICON, GOODS_ICON, canCarry } from "./cargo";

describe("cargo", () => {
  it("a kind of wagon per kind of goods: timber wagons take logs and planks, hoppers grain, vans flour", () => {
    for (const k of CAR_KINDS) expect(canCarry(k), k).toBe(k === "timber" || k === "hopper" || k === "van");
    expect(canCarry("van", "flour")).toBe(true);
    expect(canCarry("van", "planks")).toBe(false);
    expect(canCarry("timber", "planks")).toBe(true);
    expect(canCarry("timber", "grain")).toBe(false);
    expect(canCarry("hopper", "grain")).toBe(true);
    expect(canCarry("hopper", "log")).toBe(false);
  });

  it("every kind of goods has one icon of its own, a single glyph", () => {
    const icons = CARGO_KINDS.map((k) => GOODS_ICON[k]);
    expect(Object.keys(GOODS_ICON).sort()).toEqual([...CARGO_KINDS].sort());
    expect(new Set([...icons, COIN_ICON]).size).toBe(icons.length + 1);
    expect(GOODS_ICON.planks).toBe("🪵");
    expect(COIN_ICON).toBe("🪙");
    const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
    for (const icon of [...icons, COIN_ICON]) {
      expect([...graphemes.segment(icon)].length, icon).toBe(1);
      // No joined sequences (older phones draw them as two pictures): one code point, at most with a variation selector.
      expect(icon, icon).not.toContain("‍");
      expect([...icon].filter((c) => c !== "️").length, icon).toBe(1);
    }
  });

  it("cargo kinds and car kinds are indexed in snapshot order", () => {
    CARGO_KINDS.forEach((k, i) => expect(CARGO[k].index).toBe(i));
    CAR_KINDS.forEach((k, i) => expect(CAR_SPECS[k].index).toBe(i));
  });
});
