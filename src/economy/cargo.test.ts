import { describe, expect, it } from "vitest";
import { CAR_KINDS, CAR_SPECS } from "../sim";
import { CARGO, CARGO_KINDS, COIN_ICON, GOODS_ICON, canCarry } from "./cargo";

// Node's fs, typed here (the project has no Node types), as bugmaps.test.ts reads files: vitest gives a `?raw` CSS import as "".
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, enc: "utf8"): string; existsSync(path: URL): boolean; readdirSync(path: URL): string[] };

describe("cargo", () => {
  it("a kind of wagon per kind of goods: timber wagons take logs and planks, hoppers grain, vans flour", () => {
    for (const k of CAR_KINDS) expect(canCarry(k), k).toBe(k === "timber" || k === "hopper" || k === "van" || k === "tanker" || k === "reefer");
    expect(canCarry("van", "flour")).toBe(true);
    expect(canCarry("van", "planks")).toBe(false);
    expect(canCarry("timber", "planks")).toBe(true);
    expect(canCarry("timber", "grain")).toBe(false);
    expect(canCarry("hopper", "grain")).toBe(true);
    expect(canCarry("hopper", "log")).toBe(false);
    // The dairy chain and the orchard: milk in a tank wagon (and only there), bread in vans, fruit crates on flatbeds.
    expect(CAR_KINDS.filter((k) => canCarry(k, "milk"))).toEqual(["tanker"]);
    expect(canCarry("tanker", "flour")).toBe(false);
    expect(CAR_KINDS.filter((k) => canCarry(k, "bread"))).toEqual(["van"]);
    expect(CAR_KINDS.filter((k) => canCarry(k, "fruit"))).toEqual(["timber"]);
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

  it("every goods icon, the coin, the book, the timer and the tick are the game's own drawings, in its icon font", async () => {
    const { readFileSync, existsSync, readdirSync } = await fs();
    const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
    expect(css.length, "style.css read").toBeGreaterThan(1000);
    const face = /@font-face \{ font-family: "Woodrail Icons"; src: url\("\.\/assets\/([^"]+)"\)[^}]*unicode-range: ([^;]+);/.exec(css);
    expect(face).not.toBeNull();
    expect(existsSync(new URL(`../assets/${face![1]}`, import.meta.url))).toBe(true);
    const range = new Set(face![2].split(", ").map((u) => parseInt(u.slice(2), 16)));
    const drawn = new Set(readdirSync(new URL("../icons/", import.meta.url)).map((f) => /^u([0-9A-F]+)-/.exec(f)).filter(Boolean).map((m) => parseInt(m![1], 16)));
    for (const icon of [...CARGO_KINDS.map((k) => GOODS_ICON[k]), COIN_ICON, "📘", "⏱", "✓"]) {
      const cp = icon.codePointAt(0)!;
      expect(drawn.has(cp), `${icon}: a drawing in src/icons`).toBe(true);
      expect(range.has(cp), `${icon}: in the font's unicode-range (run scripts/icon-font.py)`).toBe(true);
    }
    expect(range.has(0xfe0f), "the emoji selector, so ⛏️ is drawn whole").toBe(true);
    expect(GOODS_ICON.planks.codePointAt(0)).toBe(0xe000);
    // First in every font list naming Nunito, so it draws its characters in any text.
    const lists = [...css.matchAll(/(font(?:-family)?:[^;]*?)"?Nunito"?/g)];
    expect(lists.length).toBeGreaterThanOrEqual(4); // body, the report note, the cloud input, the tooltip
    for (const m of lists) expect(m[1], m[0]).toMatch(/"Woodrail Icons", $/);
  });

  it("cargo kinds and car kinds are indexed in snapshot order", () => {
    CARGO_KINDS.forEach((k, i) => expect(CARGO[k].index).toBe(i));
    CAR_KINDS.forEach((k, i) => expect(CAR_SPECS[k].index).toBe(i));
  });
});
