import { describe, expect, it } from "vitest";
import { cleanEngineName, ENGINE_NAMES, MAX_ENGINE_NAME, pickEngineName } from "./engine-names";

describe("engine names", () => {
  it("every name in the list fits a plate, and none is listed twice", () => {
    for (const n of ENGINE_NAMES) expect(n.length).toBeLessThanOrEqual(MAX_ENGINE_NAME);
    expect(new Set(ENGINE_NAMES).size).toBe(ENGINE_NAMES.length);
  });

  it("the same id and names taken give the same name (stable), and a taken name is passed over", () => {
    expect(pickEngineName(7, new Set())).toBe(pickEngineName(7, new Set()));
    const first = pickEngineName(7, new Set());
    const next = pickEngineName(7, new Set([first]));
    expect(next).not.toBe(first);
    expect(ENGINE_NAMES).toContain(next);
  });

  it("with every name taken, a numbered one, still short enough", () => {
    const all = new Set(ENGINE_NAMES);
    const name = pickEngineName(3, all);
    expect(name).toMatch(/ 2$/);
    expect(name.length).toBeLessThanOrEqual(MAX_ENGINE_NAME);
  });

  it("a typed name is trimmed, its spaces run together, and cut to 14 letters", () => {
    expect(cleanEngineName("  Big   Bertha ")).toBe("Big Bertha");
    expect(cleanEngineName("Abcdefghijklmnopq")).toBe("Abcdefghijklmn");
    expect(cleanEngineName("\u0007Tab\tby")).toBe("Tab by");
    expect(cleanEngineName("   ")).toBeNull();
    expect(Array.from(cleanEngineName("🚂🚂🚂🚂🚂🚂🚂🚂🚂🚂🚂🚂🚂🚂🚂🚂")!).length).toBe(MAX_ENGINE_NAME);
  });
});
