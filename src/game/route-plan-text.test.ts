import { describe, expect, it } from "vitest";
import { planIcons, planWords } from "./route-plan-text";

describe("a stop's plan on the route card", () => {
  it("icons under the chip: ⬆ what it picks up, ⬇ what it drops", () => {
    expect(planIcons({ picks: ["planks"], drops: ["log"] })).toBe("⬆🪵 ⬇🌲");
    expect(planIcons({ picks: [], drops: ["planks", "log"] })).toBe("⬇🪵🌲");
    expect(planIcons({ picks: [], drops: [] })).toBe("");
  });
  it("in words, a stop tapped", () => {
    expect(planWords({ picks: ["planks"], drops: ["log"] })).toBe("Picks up planks · Drops logs");
    expect(planWords({ picks: ["log", "grain"], drops: [] })).toBe("Picks up logs, grain");
    expect(planWords({ picks: [], drops: [] })).toBe("Picks up and drops nothing here");
  });
});
