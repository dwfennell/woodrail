import { describe, expect, it } from "vitest";
import { GOODS_ICON } from "../economy";
import { actionOf, loadsWords, stopSentences, stopsLine, ticksOf } from "./line-sheet-text";

describe("line sheet words", () => {
  const names = ["Forest yard 2", "Sawmill 2", "Workshop"];
  const plans = [
    { picks: ["log" as const], drops: [] },
    { picks: ["planks" as const], drops: ["log" as const] },
    { picks: [], drops: ["planks" as const] },
  ];
  it("says where a stop's goods come from and go to (round the line)", () => {
    expect(stopSentences(1, plans, names)).toEqual({ drops: [`Drops ${GOODS_ICON.log} logs from Forest yard 2`], picks: [`Picks up ${GOODS_ICON.planks} planks for Workshop`] });
    expect(stopSentences(0, plans, names)).toEqual({ drops: [], picks: [`Picks up ${GOODS_ICON.log} logs for Sawmill 2`] });
    expect(stopSentences(2, plans, names).drops).toEqual([`Drops ${GOODS_ICON.planks} planks from Sawmill 2`]);
  });
  it("two ticks for the actions, and neither is pass by", () => {
    expect(ticksOf("auto")).toEqual({ drop: true, pick: true });
    expect(ticksOf("both")).toEqual({ drop: true, pick: true });
    expect(ticksOf("drop")).toEqual({ drop: true, pick: false });
    expect(actionOf(false, true)).toBe("pick");
    expect(actionOf(false, false)).toBeNull();
  });
  it("short stop lists and loads", () => {
    expect(stopsLine(names)).toBe("Forest yard 2 → Sawmill 2 → Workshop");
    expect(stopsLine(["A", "B", "C", "D", "E", "F"])).toBe("A → B → … → F (6 stops)");
    expect(loadsWords(0)).toBe("");
    expect(loadsWords(1)).toBe("1 load a month");
    expect(loadsWords(18)).toBe("18 loads a month");
  });
});

describe("ink on line colours", async () => {
  const { contrastRatio, inkOn } = await import("./line-sheet-text");
  const { LINE_COLOURS } = await import("./lines");
  it("every line colour's number holds 4.5:1 or picks the better ink", () => {
    for (const { colour } of LINE_COLOURS) {
      const ink = inkOn(colour);
      const other = ink === "#ffffff" ? "#2b2118" : "#ffffff";
      expect(contrastRatio(ink, colour), colour).toBeGreaterThanOrEqual(contrastRatio(other, colour));
    }
    // The yellow line takes dark ink (white on it is under 2:1).
    expect(inkOn("#e6b52c")).toBe("#2b2118");
    expect(contrastRatio("#2b2118", "#e6b52c")).toBeGreaterThan(4.5);
  });
});
