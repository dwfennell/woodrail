import { describe, expect, it } from "vitest";
import { Progress } from "./progress";
import { deliver } from "./research";
import { researchCard, researchLine, schoolCard, schoolCardKey, tapResearch } from "./research-text";

const SCHOOL = "Larkfield school";

describe("the board's tap (the P1 stopgap): it picks a research, not pays at the workshop", () => {
  it("the first tap starts it and says where to bring what", () => {
    const p = Progress.fresh();
    expect(tapResearch(p, "switches", SCHOOL)).toBe("Researching Switches: bring 4🪵 to Larkfield school");
    expect(p.research.current).toBe("switches");
    // Nothing learned, nothing taken from anywhere yet.
    expect(p.learned.has("switches")).toBe(false);
  });

  it("the next tap puts one up next; one whose coins are short says how many", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    tapResearch(p, "signals", SCHOOL);
    expect(tapResearch(p, "bridges", SCHOOL)).toBe("Next up: Bridges and ramps");
    expect(tapResearch(p, "routes", SCHOOL)).toBe("Next up: Train routes (20🪙 short)");
    expect(p.research.next).toBe("routes");
  });

  it("with no school yet it says to place one; a blueprint that can't be researched does nothing", () => {
    const p = Progress.fresh();
    expect(tapResearch(p, "switches", null)).toBe("Researching Switches: place a school by a town");
    expect(tapResearch(p, "junctions", SCHOOL)).toBeNull();
    expect(p.research.next).toBeNull();
  });

  it("each ready card says how its research stands, and its button's word", () => {
    const p = Progress.fresh();
    expect(researchCard(p, "switches", SCHOOL)).toEqual({ action: "Research" });
    expect(researchCard(p, "switches", null)).toEqual({ why: "Needs a school", action: "Research" });
    tapResearch(p, "switches", SCHOOL);
    expect(researchCard(p, "switches", SCHOOL)).toEqual({ why: "bring 4🪵 to Larkfield school", research: "current", action: "Researching" });
    expect(researchCard(p, "bridges", SCHOOL)).toEqual({ action: "Next up" });
    tapResearch(p, "bridges", SCHOOL);
    expect(researchCard(p, "bridges", SCHOOL)).toEqual({ why: "Up next", research: "next", action: "Research now" });
    expect(researchLine(p, SCHOOL)).toBe("Researching Switches: bring 4🪵 to Larkfield school");
    deliver(p, "planks", 4);
    expect(researchLine(p, SCHOOL)).toBe("Researching Switches: studying: 20 s");
  });
});

describe("the school's card", () => {
  it("shows the research's goods got of needed, and what it's at; its key changes only when they do", () => {
    const p = Progress.fresh();
    expect(schoolCard(p)).toEqual({ piles: [], note: "Pick research in Blueprints" });
    const k0 = schoolCardKey(p);
    tapResearch(p, "switches", SCHOOL);
    expect(schoolCardKey(p)).not.toBe(k0);
    deliver(p, "planks", 3);
    expect(schoolCard(p)).toEqual({ piles: [{ label: "🪵", count: 3, cap: 4 }], note: "Researching Switches" });
    const k1 = schoolCardKey(p);
    expect(schoolCardKey(p)).toBe(k1);
    deliver(p, "planks", 1);
    expect(schoolCard(p).note).toBe("Studying Switches: 20 s");
    expect(schoolCardKey(p)).not.toBe(k1);
  });
});
