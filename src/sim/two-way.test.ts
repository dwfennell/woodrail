import { describe, expect, it } from "vitest";
import { putAway } from "../game/put-away";
import { joinLine } from "../game/lines";

describe("two-way track past a signal (two-way.ts)", () => {
  it("the user's complex map, its jam cleared: no two trains let into one stretch of single track from its two ends", async () => {
    // (src/play/bugmaps/reports/2026-11-18-complex-jams.txt, saved jammed: Purple and Blue nose to nose. Purple put
    // away and put back at its mill, as the card's "Move one of them" has the player do. On main, Blue leaving the school
    // east and Purple leaving the town west were each let past their signals into the single track 44-45-9-41-174 in
    // the same second, 30 s later, and stood nose to nose for good.)
    const { readFileSync } = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, enc: "utf8"): string };
    const { loadBugMap, replayBugMap } = await import("../play/bugmap");
    const { world } = await loadBugMap(readFileSync(new URL("../play/bugmaps/reports/2026-11-18-complex-jams.txt", import.meta.url), "utf8"));
    const { sim, economy } = world;
    const purple = 18;
    const lineId = economy.lineIdOf.get(purple)!;
    const kinds = sim.findCar(purple)!.train.cars.map((c) => c.kind);
    putAway(sim, economy, purple);
    const mill = 187;
    let back = -1;
    const standing = new Map<number, number>();
    let longest = 0;
    const r = replayBugMap(world, {
      seconds: 600,
      stopAtFirst: false,
      onTick: () => {
        if (sim.ticks === 120 * 120) {
          const placed = sim.addTrain(kinds, { pieceId: mill, pathIndex: 0, reversed: false, s: 100 });
          expect(placed.kind).toBe("placed");
          if (placed.kind !== "placed") return;
          back = sim.getTrain(placed.trainId)!.cars[0].id;
          joinLine(economy, back, lineId);
          sim.setLever(back, 1);
        }
        if (sim.ticks % 120) return;
        // (How long each train has stood with its lever on, not at a stop.)
        for (const id of sim.trainIds()) {
          const t = sim.getTrain(id)!;
          const e = t.cars[0].id;
          const still = t.cars.some((c) => c.kind === "engine" && c.lever !== 0) && !economy.routeOf(e)?.at && Math.abs(t.speed) < 1;
          const n = still ? (standing.get(e) ?? 0) + 1 : 0;
          standing.set(e, n);
          longest = Math.max(longest, n);
        }
      },
    });
    expect(r.first, "no invariant broken").toBeNull();
    expect(back).toBeGreaterThan(0);
    expect(longest, "no train stood a minute (a head-on stands for good)").toBeLessThan(60);
    for (const e of [1, 7, 10, 14, back]) expect(r.arrivals.get(e) ?? 0, `train ${e} came to its stops`).toBeGreaterThan(0);
  }, 300_000);
});
