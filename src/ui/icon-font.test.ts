import { describe, expect, it } from "vitest";

// Node's fs, typed here (the project has no Node types), as bugmaps.test.ts reads files.
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, enc?: "utf8"): string & Uint8Array; readdirSync(path: URL): string[]; statSync(path: URL): { mtimeMs: number; size: number } };

describe("the icon font (src/icons → scripts/icon-font.py → style.css)", () => {
  it("draws exactly the characters there are drawings for, and the emoji selectors", async () => {
    const { readFileSync, readdirSync } = await fs();
    const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
    const range = /font-family: "Woodrail Icons";[^}]*unicode-range: ([^;]+);/.exec(css)![1].split(", ").map((u) => parseInt(u.slice(2), 16));
    const files = readdirSync(new URL("../icons/", import.meta.url)).filter((f) => f.endsWith(".svg"));
    expect(files.every((f) => /^u[0-9A-F]{4,5}-[a-z-]+\.svg$/.test(f)), files.join(" ")).toBe(true);
    const drawn = files.map((f) => parseInt(f.slice(1, f.indexOf("-")), 16));
    expect(new Set(drawn).size, "one drawing per character").toBe(drawn.length);
    // Rerun scripts/icon-font.py after adding or removing a drawing.
    expect([...range].sort((a, b) => a - b)).toEqual([...drawn, 0xfe0e, 0xfe0f].sort((a, b) => a - b));
  });

  it("every drawing is flat shapes the script compiles: no strokes, gradients, images or text", async () => {
    const { readFileSync, readdirSync } = await fs();
    for (const f of readdirSync(new URL("../icons/", import.meta.url))) {
      const svg = readFileSync(new URL(`../icons/${f}`, import.meta.url), "utf8");
      expect(svg, f).toContain('viewBox="0 0 24 24"');
      expect(svg, f).not.toMatch(/stroke=|Gradient|<image|<text|<use|style=/);
    }
  });

  it("the font is one small file (a few kB for every icon)", async () => {
    const { statSync } = await fs();
    expect(statSync(new URL("../assets/woodrail-icons.woff2", import.meta.url)).size).toBeLessThan(24 * 1024);
  });
});
