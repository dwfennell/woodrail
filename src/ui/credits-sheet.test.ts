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
    for (const d of deps) expect(named, d).toContain(d.toLowerCase());
  });
});
