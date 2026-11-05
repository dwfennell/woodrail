import { describe, expect, it } from "vitest";
import { canCarry, CARGO_KINDS } from "./cargo";
import { carriesLine, needsWagonText, wagonsFor, wagonTag, wagonWords, WAGON_NAME } from "./wagons";

describe("which wagon carries which goods (the cards' and tray's words)", () => {
  it("by the game's own rule: every wagon named for a good can carry it, and none left out", () => {
    for (const kind of CARGO_KINDS) {
      const named = wagonsFor(kind);
      for (const car of named) expect(canCarry(car, kind)).toBe(true);
      for (const car of Object.keys(WAGON_NAME) as (keyof typeof WAGON_NAME)[]) if (canCarry(car, kind)) expect(named).toContain(car);
      // Every good some train can take says which wagon.
      expect(named.length).toBeGreaterThan(0);
    }
  });

  it("a quarry's stone goes in a hopper; logs on a flatbed", () => {
    expect(wagonTag("stone")).toBe("🚃 Hopper");
    expect(wagonTag("log")).toBe("🚃 Flatbed");
    expect(wagonTag("milk")).toBe("🚃 Milk tank");
    expect(wagonTag("autos")).toBe("🚃 Car carrier");
  });

  it("a good two wagons carry names both", () => {
    expect(wagonWords("cheese")).toBe("Goods van or Cold van");
    expect(wagonWords("mail")).toBe("Mail van or Sorting van");
  });

  it("a train that can't take what's there is told plainly what it needs", () => {
    expect(needsWagonText("stone")).toBe("Needs a hopper for stone");
    expect(needsWagonText("log")).toBe("Needs a flatbed for logs");
    expect(needsWagonText("icecream")).toBe("Needs a cold van for ice cream");
    expect(needsWagonText("fish")).toBe("Needs a goods van or cold van for fish");
  });

  it("a wagon's tray card lists everything it carries, with icons", () => {
    expect(carriesLine("hopper")).toBe("🌾 grain, 🪨 stone, ⚫ coal, ⛏️ ore");
    // The goods van's dozen, all of them (its short detail names only a few).
    expect(carriesLine("van").split(", ")).toHaveLength(13);
    expect(carriesLine("passenger")).toBe("");
  });
});
