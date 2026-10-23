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
    // A town wants flour to become a city: planks alone stop it at Town.
    expect(townStatus({ planks: 500 })).toMatchObject({ level: 2, name: "Town", wants: { planks: 14, flour: 6 } });
    // And stone to be a city ★.
    expect(townStatus({ planks: 4 + 8 + 14 + 22, flour: 6 + 12 }).level).toBe(3);
    expect(townStatus({ planks: 4 + 8 + 14 + 22, flour: 6 + 12, stone: 10 }).level).toBe(4);
  });

  it("show a town's basket: what it has had of each good toward the next level", () => {
    const s = townStatus({ planks: 4 + 8 + 10, flour: 3 });
    expect(s).toMatchObject({ level: 2, got: { planks: 10, flour: 3 }, wants: { planks: 14, flour: 6 } });
    expect(s.fill).toBeCloseTo(13 / 20);
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

describe("pay and prices", () => {
  it("towns pay full price for what they want now, half for the rest; land gets dearer", async () => {
    const { payFor, plotPrice } = await import("./towns");
    // A hamlet or a village pays more for planks (QA P5: early coins); a town and up, the price.
    const s = townStatus({});
    expect(payFor("planks", s)).toBe(6);
    expect(payFor("planks", townStatus({ planks: 4 }))).toBe(6);
    expect(payFor("planks", townStatus({ planks: 12 }))).toBe(4);
    expect(payFor("log", s)).toBe(1);
    // A town pays more for its flour too (QA: coins sat near 0 after the mill); a city, the price.
    expect(payFor("flour", townStatus({ planks: 12 }))).toBe(12);
    expect(payFor("flour", townStatus({ planks: 4 }))).toBe(6);
    expect(payFor("flour", townStatus({ planks: 26, flour: 6 }))).toBe(6);
    expect(plotPrice(4)).toBe(60);
    expect(plotPrice(6)).toBeGreaterThan(plotPrice(5));
  });
});
