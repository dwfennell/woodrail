import { describe, expect, it } from "vitest";
import { capOf } from "../economy/economy";
import { BLUEPRINTS, CITY_SCHOOL_ID } from "./blueprints";
import { keepsForOrder, orderPlanks } from "./crafting";
import { GOALS } from "./goals";
import { Progress } from "./progress";
import { canResearch } from "./research";
import { built, ready, TECHS } from "./tech";
import { THING_RULES } from "./things";

describe("blueprints", () => {
  it("anything ready can be researched from the start; junctions wait for switches, mills for farming", () => {
    const p = Progress.fresh();
    expect(ready(p, "switches") && ready(p, "farming")).toBe(true);
    expect(ready(p, "mills")).toBe(false);
    expect(ready(p, "junctions")).toBe(false);
    p.learned.add("switches");
    expect(ready(p, "junctions")).toBe(true);
  });

  it("one workshop's yard holds the planks for any building it makes (it once held 12: a mill could never be made)", () => {
    const most = Math.max(...Object.values(THING_RULES).map((r) => r!.cost.planks ?? 0));
    expect(capOf("workshop")).toBeGreaterThanOrEqual(most);
  });

  it("every built blueprint is researched (nothing comes by itself), the school and library rows are gone", () => {
    expect(TECHS.some((t) => t.id === "school" || t.id === "library")).toBe(false);
    for (const t of TECHS.filter(built)) {
      expect(Object.keys(t.research.goods).length + (t.research.coins ?? 0), t.id).toBeGreaterThan(0);
      expect("learn" in t, t.id).toBe(false);
      for (const n of t.needs) expect(TECHS.some((x) => x.id === n), `${t.id} needs ${n}`).toBe(true);
    }
  });

  it("the passenger line is researched once enough people are carried", () => {
    const p = Progress.fresh();
    p.learned.add("passengers");
    expect(canResearch(p, "dining")).toBe(false);
    p.riders = 20;
    expect(canResearch(p, "dining")).toBe(true);
    p.learned.add("dining");
    p.riders = 59;
    expect(canResearch(p, "first-class")).toBe(false);
    p.riders = 60;
    expect(canResearch(p, "first-class")).toBe(true);
  });

  it("every tier-3 research needs a school beside a city (its library wing); College needs Routes", () => {
    for (const b of BLUEPRINTS.filter((x) => x.tier === 3)) expect(b.requires.some((n) => n.kind === "landmark" && n.id === CITY_SCHOOL_ID), b.id).toBe(true);
    for (const b of BLUEPRINTS.filter((x) => x.tier !== 3)) expect(b.requires.some((n) => n.kind === "landmark" && n.id === CITY_SCHOOL_ID), b.id).toBe(false);
    const p = Progress.fresh();
    for (const id of ["farming", "mills"]) p.learned.add(id);
    expect(canResearch(p, "quarries")).toBe(false);
    p.landmarks.add(CITY_SCHOOL_ID);
    expect(canResearch(p, "quarries")).toBe(true);
    expect(BLUEPRINTS.find((b) => b.id === "college")!.needs).toEqual(["routes"]);
  });
});

describe("planks kept for the workshop (no route needed)", () => {
  it("never for research (a school takes its own goods): not for a ready blueprint, nor the goal's", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    expect(ready(p, "signals") && ready(p, "bridges") && ready(p, "junctions")).toBe(true);
    expect(GOALS.find((g) => g.id === "build-bridge")!.blueprint).toBe("bridges");
    expect(orderPlanks(p)).toBe(0);
    expect(keepsForOrder(p, 0)).toBe(false);
  });

  it("only for the tray order waiting to be made, no more than the yard holds", () => {
    const p = Progress.fresh();
    p.orders.push("piece:depot-workshop");
    expect(orderPlanks(p)).toBe(THING_RULES["piece:depot-workshop"]!.cost.planks);
    expect(keepsForOrder(p, 11)).toBe(true);
    expect(keepsForOrder(p, 12)).toBe(false);
    expect(orderPlanks(p, 6)).toBe(6);
    // Once it's being made (its planks taken), nothing is kept for it.
    p.making = true;
    expect(orderPlanks(p)).toBe(0);
  });
});
