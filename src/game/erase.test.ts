import { describe, expect, it } from "vitest";
import { eraseRefusal, type EraseRefusal } from "./erase";

describe("what a clearing sweep says of what stays (once, on lift)", () => {
  it("nothing, when everything it passed over went", () => {
    expect(eraseRefusal(new Map())).toBeNull();
  });

  it("the reason, when one kind of thing stayed (a depot's track and its building are one kind)", () => {
    expect(eraseRefusal(new Map<EraseRefusal, string>([["station", "Forest yard stays"]]))).toBe("Forest yard stays");
  });

  it("the kinds together, when several stayed", () => {
    const told = new Map<EraseRefusal, string>([
      ["station", "Larkfield station stays"],
      ["train", "Trains stay: take one off from its card"],
      ["house", "The town's houses stay"],
    ]);
    expect(eraseRefusal(told)).toBe("Some things stay: stations and depots, trains, the town's houses");
  });

  it("roads and the map's trees are among them", () => {
    const told = new Map<EraseRefusal, string>([
      ["road", "Roads stay: tap one with Clear off to take it up"],
      ["tree", "Trees stay: the Land tab moves them"],
    ]);
    expect(eraseRefusal(told)).toBe("Some things stay: roads, trees");
    expect(eraseRefusal(new Map<EraseRefusal, string>([["tree", "Trees stay: the Land tab moves them"]]))).toBe("Trees stay: the Land tab moves them");
  });
});
