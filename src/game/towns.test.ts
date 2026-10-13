import { describe, expect, it } from "vitest";
import { housesBy, townLevel, townStatus, TOWN_LEVELS } from "./towns";

describe("town levels", () => {
  it("start as a hamlet wanting planks", () => {
    expect(townStatus({})).toMatchObject({ level: 0, name: "Hamlet", wants: { planks: 4 }, got: { planks: 0 }, fill: 0 });
  });

  it("grow as goods arrive, counting what's had since the last growth", () => {
    expect(townStatus({ planks: 3 })).toMatchObject({ level: 0, fill: 0.75 });
    expect(townStatus({ planks: 4 })).toMatchObject({ level: 1, name: "Village", got: { planks: 0 } });
    expect(townStatus({ planks: 9 })).toMatchObject({ level: 1, got: { planks: 5 }, wants: { planks: 8 } });
    expect(townStatus({ planks: 4 + 8 + 14 + 22 }).level).toBe(4);
  });

  it("keep wanting more past the table", () => {
    const last = TOWN_LEVELS[TOWN_LEVELS.length - 1].wants.planks!;
    expect(townLevel(TOWN_LEVELS.length).wants.planks).toBeGreaterThan(last);
    expect(townLevel(TOWN_LEVELS.length + 1).wants.planks).toBeGreaterThan(townLevel(TOWN_LEVELS.length).wants.planks!);
    expect(townLevel(TOWN_LEVELS.length).name).toContain("★");
  });

  it("ignore goods they don't want", () => {
    expect(townStatus({ log: 50 }).level).toBe(0);
  });

  it("add their houses level by level", () => {
    expect(housesBy(0)).toBe(0);
    expect(housesBy(1)).toBe(TOWN_LEVELS[0].houses);
    expect(housesBy(2)).toBe(TOWN_LEVELS[0].houses + TOWN_LEVELS[1].houses);
  });
});
