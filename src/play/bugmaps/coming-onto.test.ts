import { describe, expect, it } from "vitest";
import { SIM_HZ } from "../../sim";
import { loadBugMap } from "../bugmap";
import MAP from "./reports/2026-11-16-dandelion-red-signal.txt?raw";

/**
 * A user's map (2026-11-16, nine lines sharing single track through signals' waiting points): a train let into a
 * waiting point at one end of a stretch of single track while another ran into the waiting point past its far end,
 * its next way onto that track head on. The second wasn't on the track yet, nor holding a move over it, so the first
 * was let on; they met on it, and with the trains behind each, stood in a ring of waits for good (four trains from
 * about 180 s). Sections now count a train moving into a waiting point whose way on comes onto the stretch head on
 * (`comingOnto`).
 */
describe("the user's Dandelion map: single track, a train running up to its far end", () => {
  it("no ring of trains waiting on one another stands 30 s, and every train comes to a stop", async () => {
    const { world } = await loadBugMap(MAP);
    const ec = world.economy as unknown as {
      lineIdOf: Map<number, number>;
      routeOf(e: number): { at?: unknown } | undefined;
      sections: { waitOf(e: number): { engine?: number } | null };
    };
    const engines = [...ec.lineIdOf.keys()];
    const stopped = new Set<number>();
    const was = new Map<number, boolean>();
    let ring = "";
    let ringSince = -1;
    let longest = 0;
    // (Trains standing, each waiting on the next, round to the first.)
    const ringNow = (): string => {
      const on = new Map<number, number>();
      for (const e of engines) {
        const w = ec.sections.waitOf(e);
        const t = world.sim.findCar(e)?.train;
        if (w && typeof w.engine === "number" && t && t.speed < 1) on.set(e, w.engine);
      }
      for (const e0 of on.keys()) {
        const seen: number[] = [];
        let e = e0;
        while (on.has(e) && !seen.includes(e)) {
          seen.push(e);
          e = on.get(e)!;
        }
        if (e === e0) return seen.sort((a, b) => a - b).join(",");
      }
      return "";
    };
    for (let i = 0; i < 300 * SIM_HZ; i++) {
      world.sim.tick();
      world.economy.tick();
      if (i % SIM_HZ) continue;
      for (const e of engines) {
        const at = !!ec.routeOf(e)?.at;
        if (at && !was.get(e)) stopped.add(e);
        was.set(e, at);
      }
      const r = ringNow();
      if (r !== ring) {
        ring = r;
        ringSince = i;
      }
      if (ring) longest = Math.max(longest, (i - ringSince) / SIM_HZ);
    }
    expect(longest, `a ring of waits (${ring}) stood`).toBeLessThan(30);
    expect(engines.filter((e) => !stopped.has(e))).toEqual([]);
  }, 120_000);
});
