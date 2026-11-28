import pkgSrc from "../../package.json?raw";
import { describe, expect, it } from "vitest";
import { CREDITS } from "./credits-sheet";

describe("☰ Credits", () => {
  it("credits the EFF word list, with its CC BY 3.0 licence linked (the cloud codes' words)", () => {
    const eff = CREDITS.find((c) => c.what.includes("EFF"))!;
    expect(eff.licence).toBe("CC BY 3.0");
    expect(eff.link).toBe("https://creativecommons.org/licenses/by/3.0/");
    expect(eff.home).toBe("https://www.eff.org/dice");
  });
  it("links every licence over https", () => {
    for (const c of CREDITS) expect(c.link).toMatch(/^https:\/\//);
  });
  it("names every library the game ships with", () => {
    const deps = Object.keys((JSON.parse(pkgSrc) as { dependencies: Record<string, string> }).dependencies);
    const named = CREDITS.map((c) => c.what.toLowerCase()).join(" ");
    // A scoped package is named by its project (@capacitor/android: Capacitor) or the work in it (@fontsource/nunito:
    // Nunito, the font).
    const name = (d: string) => {
      const scoped = /^@([^/]+)\/(.+)$/.exec(d.toLowerCase());
      return scoped ? [scoped[1], scoped[2], scoped[2].replaceAll("-", " ")] : [d.toLowerCase()];
    };
    for (const d of deps) expect(name(d).some((n) => named.includes(n)), d).toBe(true);
  });
});
