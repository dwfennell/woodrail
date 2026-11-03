import { describe, expect, it } from "vitest";

// Node's fs, typed here (the project has no Node types), as bugmaps.test.ts reads files.
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, enc?: "utf8"): string & Uint8Array; readdirSync(path: URL): string[]; statSync(path: URL): { mtimeMs: number; size: number; isDirectory(): boolean } };

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

  it("no emoji is left to the phone: every pictograph the game shows is one the font draws", async () => {
    // The phone's own emoji font looks nothing like the game's icons (QA 2026-11-03): each must be drawn in src/icons.
    const { readFileSync, readdirSync, statSync } = await fs();
    const drawn = new Set(readdirSync(new URL("../icons/", import.meta.url)).filter((f) => f.endsWith(".svg")).map((f) => parseInt(f.slice(1, f.indexOf("-")), 16)));
    const missing: string[] = [];
    const scan = (dir: URL, rel: string) => {
      for (const f of readdirSync(dir)) {
        const url = new URL(f, dir);
        if (statSync(url).isDirectory()) scan(new URL(`${f}/`, dir), `${rel}${f}/`);
        else if (/\.(ts|html)$/.test(f) && !/\.test\.ts$/.test(f)) {
          // Comments may name a character (a code's own notes): only what reaches the page counts.
          const code = readFileSync(url, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
          for (const m of code.matchAll(/\p{Extended_Pictographic}/gu)) {
            const c = m[0].codePointAt(0)!;
            if (!drawn.has(c)) missing.push(`${m[0]} U+${c.toString(16).toUpperCase()} in src/${rel}${f}`);
          }
        }
      }
    };
    scan(new URL("../", import.meta.url), "");
    expect([...new Set(missing)], "draw these in src/icons and rerun scripts/icon-font.py").toEqual([]);
  });

  it("the font is one small file (a few kB for every icon)", async () => {
    const { statSync } = await fs();
    expect(statSync(new URL("../assets/woodrail-icons.woff2", import.meta.url)).size).toBeLessThan(24 * 1024);
  });
});
