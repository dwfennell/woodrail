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
    expect(eraseRefusal(told)).toBe("Some things stay: trains, stations and depots, the town's houses");
  });

  it("roads and the map's trees are among them", () => {
    const told = new Map<EraseRefusal, string>([
      ["road", "Roads stay: tap one with Clear off to take it up"],
      ["tree", "Trees stay: the Land tab moves them"],
    ]);
    expect(eraseRefusal(told)).toBe("Some things stay: roads, trees");
  });

  it("names them in one order however the sweep met them, three at most", () => {
    const a = new Map<EraseRefusal, string>([["tree", "t"], ["station", "s"]]);
    const b = new Map<EraseRefusal, string>([["station", "s"], ["tree", "t"]]);
    expect(eraseRefusal(a)).toBe(eraseRefusal(b));
    const all = new Map<EraseRefusal, string>([["tree", "t"], ["road", "r"], ["house", "h"], ["station", "s"], ["train", "x"], ["busy", "b"]]);
    expect(eraseRefusal(all)).toBe("Some things stay: track a train is on, trains, stations and depots, and 3 more");
    expect(eraseRefusal(new Map<EraseRefusal, string>([["tree", "Trees stay: the Land tab moves them"]]))).toBe("Trees stay: the Land tab moves them");
  });
});
