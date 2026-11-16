import { describe, expect, it } from "vitest";
import { engineStatus } from "../../game/engine-status";
import { loadBugMap } from "../bugmap";
import { SIM_HZ } from "../../sim";
import text from "./dandelion-red-signal.txt?raw";

// Load in place (docs/superpowers/specs/2026-11-16-load-in-place.md, "Too long for the depot"): on the user's map from
// the red-signal report (2026-11-16), the starter map's sawmill has a switch joined to one end and the user's signal on
// the joint at the other. A train of three or four wagons coming in over the switch stops with its nose short of the
// signal, so its tail is on the switch: no spot there clears both. It loads there anyway, and its card says why.
describe("a train too long for its yard, on the user's map", () => {
  it("loads standing on the points, its card says so, and its goods still move", async () => {
    const { world: w } = await loadBugMap(text);
    const mill = w.economy.allDepots().find((d) => d.role === "sawmill")!;
    let said = "";
    let moved = 0;
    for (let i = 0; i < 300 * SIM_HZ && !said; i++) {
      w.sim.tick();
      w.economy.tick();
      for (const e of w.economy.drainEvents()) if (e.depotId === mill.id) moved++;
      for (const t of w.sim.trains()) {
        if (w.economy.standsOnPoints(t.id)?.id !== mill.id) continue;
        const engine = t.cars.find((c) => c.kind === "engine")!.id;
        said = engineStatus(w.sim, w.economy, engine, () => "the sawmill");
        expect(w.economy.pointsAt(mill.id)).toBe(true);
      }
    }
    expect(said).toMatch(/at the sawmill: too long for its yard, its tail is on the points$/);
    // And the crane works it there: goods on and off at the sawmill.
    for (let i = 0; i < 30 * SIM_HZ; i++) {
      w.sim.tick();
      w.economy.tick();
      for (const e of w.economy.drainEvents()) if (e.depotId === mill.id) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  }, 120_000);
});
