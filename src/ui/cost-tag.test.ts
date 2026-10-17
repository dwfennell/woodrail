import { describe, expect, it } from "vitest";
import { badgeEms, costTag, costTagSize, trayCostTag } from "./cost-tag";

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
    // Never under 9 px.
    expect(costTagSize("16🪵 4🔩 60🪙")).toBe(9);
  });

  it("drop the coins, then all but the first goods, rather than go under 9 px (the card shows the full price)", () => {
    expect(trayCostTag({ planks: 3 })).toBe("3🪵");
    expect(trayCostTag({ planks: 30 }, 100)).toBe("30🪵 100🪙");
    expect(trayCostTag({ planks: 30, stone: 10 }, 100)).toBe("30🪵 10🪨");
    expect(trayCostTag({ planks: 30, stone: 10, iron: 4, coal: 6 }, 100)).toBe("30🪵 …");
    // Whatever's shown fits its 60 px at the size it's set.
    for (const [c, k] of [[{ planks: 12 }, 30], [{ planks: 30 }, 100], [{ planks: 16, iron: 4 }, 60], [{ planks: 30, stone: 10 }, 100]] as const) {
      const t = trayCostTag(c, k);
      const px = costTagSize(t) ?? 12;
      expect(px).toBeGreaterThanOrEqual(9);
      if (costTagSize(t) !== null) expect(badgeEms(t) * px).toBeLessThanOrEqual(60);
    }
  });
});
