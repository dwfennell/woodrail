import { describe, expect, it } from "vitest";
import { CAR_KINDS, CAR_SPECS } from "../sim";
import { CARGO, CARGO_KINDS, COIN_ICON, GOODS_ICON, canCarry } from "./cargo";

// Node's fs, typed here (the project has no Node types), as bugmaps.test.ts reads files: vitest gives a `?raw` CSS import as "".
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, enc: "utf8"): string; existsSync(path: URL): boolean };

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
    // Logs are the log emoji (raw wood); planks their own glyph (sawn boards), not a look-alike of it.
    expect(GOODS_ICON.log).toBe("🪵");
    expect(GOODS_ICON.planks).toBe("\uE000");
    expect(COIN_ICON).toBe("🪙");
    const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
    for (const icon of [...icons, COIN_ICON]) {
      expect([...graphemes.segment(icon)].length, icon).toBe(1);
      // No joined sequences (older phones draw them as two pictures): one code point, at most with a variation selector.
      expect(icon, icon).not.toContain("‍");
      expect([...icon].filter((c) => c !== "️").length, icon).toBe(1);
    }
  });

  it("the planks glyph is drawn: style.css loads the game's icon font for U+E000, first in every font list naming Nunito", async () => {
    const { readFileSync, existsSync } = await fs();
    const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
    const face = /@font-face \{ font-family: "Woodrail Icons"; src: url\("\.\/assets\/([^"]+)"\)[^}]*unicode-range: U\+E000;/.exec(css);
    expect(css.length, "style.css read").toBeGreaterThan(1000);
    expect(face).not.toBeNull();
    expect(existsSync(new URL(`../assets/${face![1]}`, import.meta.url))).toBe(true);
    expect(GOODS_ICON.planks.codePointAt(0)).toBe(0xe000);
    const lists = [...css.matchAll(/(font(?:-family)?:[^;]*?)"?Nunito"?/g)];
    expect(lists.length).toBeGreaterThanOrEqual(4); // body, the report note, the cloud input, the tooltip
    for (const m of lists) expect(m[1], m[0]).toMatch(/"Woodrail Icons", $/);
  });

  it("cargo kinds and car kinds are indexed in snapshot order", () => {
    CARGO_KINDS.forEach((k, i) => expect(CARGO[k].index).toBe(i));
    CAR_KINDS.forEach((k, i) => expect(CAR_SPECS[k].index).toBe(i));
  });
});
