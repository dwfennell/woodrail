import { describe, expect, it } from "vitest";
import { covers, describe as describeBag, iconCounts, minus, plus, times, total } from "./goods";

describe("bags of goods", () => {
  it("add, take away (never below zero), scale (rounding up) and count", () => {
    expect(plus({ planks: 2 }, { planks: 3, log: 1 })).toEqual({ planks: 5, log: 1 });
    expect(minus({ planks: 5, log: 1 }, { planks: 7 })).toEqual({ log: 1 });
    expect(times({ planks: 3 }, 1.5)).toEqual({ planks: 5 });
    expect(total({ planks: 2, log: 3 })).toBe(5);
  });

  it("cover a need only with enough of every kind", () => {
    expect(covers({ planks: 3, log: 2 }, { planks: 3 })).toBe(true);
    expect(covers({ planks: 3 }, { planks: 3, log: 1 })).toBe(false);
    expect(covers({}, {})).toBe(true);
  });

  it("read as words, each count with its icon", () => {
    expect(describeBag({ planks: 1 })).toBe("1🪵 plank");
    expect(describeBag({ log: 2, planks: 12 })).toBe("2🌲 logs + 12🪵 planks");
    expect(describeBag({})).toBe("nothing");
    expect(iconCounts({ stone: 10, planks: 30 })).toBe("30🪵 10🪨");
    expect(iconCounts({})).toBe("");
  });
});
