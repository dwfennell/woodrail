import { describe, expect, it } from "vitest";
import { CARGO } from "../economy";
import { CRANE_TICKS, ticks } from "../economy/constants";
import { updateRates } from "./industries";
import { Progress } from "./progress";
import { ready } from "./tech";
import { applyCranes, boostOf, Counters } from "./upgrades";
import { buildStarterWorld } from "./world";

describe("upgrades", () => {
  it("make every industry of their kind faster, the map's own too (the best learned counts)", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    const forest = w.economy.allDepots().find((d) => d.role === "forest")!;
    updateRates(w, (r) => boostOf(p, r));
    expect(forest.rate).toBe(1);
    p.learned.add("harvesters2");
    expect(updateRates(w, (r) => boostOf(p, r))).toBe(true);
    expect(forest.rate).toBe(1.5);
    p.learned.add("harvesters3");
    updateRates(w, (r) => boostOf(p, r));
    expect(forest.rate).toBe(2);
    expect(boostOf(p, "sawmill")).toBe(1);
  });

  it("quicker cranes, then two-arm, then grab cranes", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    applyCranes(w.economy, p);
    expect([w.economy.craneTicks, w.economy.craneLoads]).toEqual([CRANE_TICKS, 1]);
    p.learned.add("cranes1");
    applyCranes(w.economy, p);
    expect(w.economy.craneTicks).toBe(ticks(0.45));
    p.learned.add("cranes2");
    p.learned.add("cranes3");
    applyCranes(w.economy, p);
    expect([w.economy.craneTicks, w.economy.craneLoads]).toEqual([ticks(0.3), 2]);
  });

  it("count what's been done toward them: logs cut, planks sawn, loads moved, goods delivered", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    p.learned.add("harvesters");
    const c = new Counters();
    c.reset(w.economy);
    w.economy.made[CARGO.log.index] += 60;
    w.economy.loadsMoved += 7;
    w.economy.deliveredGoods.set(w.landscape.towns[0].id, { planks: 30 });
    expect(c.collect(w.economy, p)).toBe(true);
    expect(p.counts.get("logsCut")).toBe(60);
    expect(p.counts.get("loadsMoved")).toBe(7);
    expect(p.counts.get("delivered:planks")).toBe(30);
    expect(ready(p, "harvesters2")).toBe(false);
    w.economy.made[CARGO.log.index] += 40;
    expect(c.collect(w.economy, p)).toBe(true);
    expect(p.counts.get("logsCut")).toBe(100);
    expect(ready(p, "harvesters2")).toBe(true);
    // Nothing new: nothing changes.
    expect(c.collect(w.economy, p)).toBe(false);
  });

  it("a forest yard really makes logs faster once upgraded", () => {
    const run = (learn: string[]) => {
      const w = buildStarterWorld();
      const p = Progress.fresh();
      for (const t of learn) p.learned.add(t);
      updateRates(w, (r) => boostOf(p, r));
      for (let i = 0; i < ticks(60); i++) w.economy.tick();
      return w.economy.made[CARGO.log.index];
    };
    expect(run(["harvesters2"])).toBeGreaterThan(run([]));
  });
});
