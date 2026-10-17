import { describe, expect, it } from "vitest";
import { badgeEms, costTag, costTagSize } from "./cost-tag";

describe("tray cost badges", () => {
  it("are counts and icons only, goods in cargo order, then coins", () => {
    expect(costTag({ planks: 3 })).toBe("3🪵");
    expect(costTag({ planks: 30, stone: 10 }, 100)).toBe("30🪵 10🪨 100🪙");
    expect(costTag({ iron: 4, planks: 16 }, 60)).toBe("16🪵 4🔩 60🪙");
    expect(costTag({}, 50)).toBe("50🪙");
    expect(costTag({ planks: 0 }, 0)).toBe("");
  });

  it("have no words in them", () => {
    expect(costTag({ log: 1, planks: 2, grain: 3, flour: 4, stone: 5, coal: 6, ore: 7, iron: 8, furniture: 9, tools: 10 }, 11)).not.toMatch(/[a-z]/i);
  });

  it("are set smaller the longer they are, so they stay on one line", () => {
    // The corner pill, at its own 12 px.
    expect(costTagSize("3")).toBeNull();
    expect(costTagSize("Locked")).toBeNull();
    expect(costTagSize("12🪵")).toBeNull();
    // Across the item, as large as fits.
    expect(costTagSize("12🪵 30🪙")).toBe(11);
    expect(costTagSize("30🪵 100🪙")).toBe(10);
    expect(costTagSize("16🪵 4🔩 60🪙")).toBe(8);
    expect(costTagSize("30🪵 10🪨 100🪙")).toBe(7);
    // Every one fits its 60 px of text, even the longest cost the game has (the harbour's).
    for (const t of ["12🪵 30🪙", "30🪵 100🪙", "16🪵 4🔩 60🪙", "30🪵 10🪨 100🪙"]) expect(badgeEms(t) * costTagSize(t)!).toBeLessThanOrEqual(60);
  });
});
