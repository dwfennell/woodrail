import { describe, expect, it } from "vitest";
import { SIM_HZ } from "../sim";
import { loadBugMap } from "../play/bugmap";
import text from "../play/bugmaps/signals-mill-wait.txt?raw";
import { engineStatus, trainLabel } from "./engine-status";

/**
 * A train held at a red signal only because sections keep it for another train says who it waits for and where it's
 * going (QA 2026-11-06: engine 44 at the path signal by the mill said only "Waiting at a red signal", its way clear,
 * held for engine 48, a hopper shuttle). Names, never ids.
 */
describe("line-wait-for: a held train names the train it waits for", () => {
  it("engine 44, held at a signal for another line's train: 'Waiting for <name> (<what> train) to clear the line to <its next stop>'", async () => {
    const { world } = await loadBugMap(text);
    const w = world;
    const place = (id: number) => `the ${w.economy.depot(id)?.role ?? "stop"}`;
    expect(trainLabel(w.sim, 48)).toMatch(/^[A-Z][a-z]+ \(hopper train\)$/);
    const said = new Set<string>();
    for (let i = 0; i < 300 * SIM_HZ; i++) {
      w.sim.tick();
      w.economy.tick();
      if (i % 12 === 0) said.add(engineStatus(w.sim, w.economy, 44, place));
    }
    const named = [...said].filter((t) => t.startsWith("Waiting for"));
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.SHOW) console.log("SAID", JSON.stringify([...said]));
    expect(named.length, JSON.stringify([...said])).toBeGreaterThan(0);
    expect(named.some((t) => t.includes("to clear the line")), JSON.stringify([...said])).toBe(true);
    for (const t of named) {
      // (Or, since routing redesign step 3, short of points another train's last car is still over: the router's wait.)
      if (t.endsWith("to pass the points")) expect(t).toMatch(/^Waiting for (the train on the [A-Z][a-z]+ line|[A-Z][a-z]+ \((hopper|passenger|timber|goods|mail) train\)) to pass the points$/);
      else expect(t).toMatch(/^Waiting for [A-Z][a-z]+ \((hopper|passenger|timber|goods|mail) train\) to clear the line( to the [a-z]+)?$/);
      expect(t).not.toMatch(/\d/);
    }
  }, 120_000);
});
