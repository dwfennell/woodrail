/**
 * The user's narrow permissive working (2026-11-14, (i)): a train may follow into a plain block behind the one train
 * standing still at that block's far signal, one extra train only, of the lines working that track, and only where it
 * fits behind it clear of the entry signal and of points (`Sections.permits`). On the case it was asked for (ring1, a
 * passing loop, two blocks, three trains of one line the same way round), checked for what it pays and what it must
 * never do.
 */
import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { getPieceDef } from "../track/pieces";
import { HarnessRun } from "./harness";
import { allCases, scenarioOf } from "./cases/cases";

describe("narrow permissive working (the user's (i), 2026-11-14)", () => {
  it("ring1, two blocks, three trains one way round: each runs, never three in a block, none standing on points", () => {
    const c = allCases().find((x) => x.id === "ring1 3×one same sig:blocks2")!;
    const layout = new Layout();
    const { scenario } = scenarioOf(c);
    const h = new HarnessRun(layout, scenario);
    const sim = h.sim;
    // (The waiting points: each a plain block's track, from its signal back to the next signal or points.)
    const blocks: Set<number>[] = [];
    const topo = (h.sections as unknown as { line(id: number): { topo: { slots: { kind: string; pieces: Set<number> }[] } } }).line(h.lineOf.get(h.engines[0])!).topo;
    for (const sl of topo.slots) if (sl.kind === "signal") blocks.push(sl.pieces);
    const isPoints = (id: number) => {
      const p = layout.getPiece(id);
      return !!p && getPieceDef(p.type, p.flipped).paths.length > 1;
    };
    let most = 0;
    let onPoints = 0;
    const stillOnPoints = new Map<number, number>();
    let report = h.run(0);
    for (let s = 0; s < 300; s++) {
      report = h.run(1);
      for (const b of blocks) {
        let n = 0;
        for (const t of sim.trains()) if (t.bogies.some((x) => b.has(x.pieceId))) n++;
        most = Math.max(most, n);
      }
      for (const t of sim.trains()) {
        const on = Math.abs(t.speed) < 1 && t.bogies.some((x) => isPoints(x.pieceId));
        const since = on ? (stillOnPoints.get(t.id) ?? 0) + 1 : 0;
        stillOnPoints.set(t.id, since);
        onPoints = Math.max(onPoints, since);
      }
    }
    // (Each delivers, round and round: the payoff.)
    for (const a of report.arrivals) expect(a).toBeGreaterThanOrEqual(10);
    // (One extra train only: a waiting point never holds three.)
    expect(most).toBeLessThanOrEqual(2);
    // (Never a wait on points: none stands still on them for more than a few seconds, passing.)
    expect(onPoints).toBeLessThanOrEqual(3);
    // (No invariant broken: a train called on past the entry signal isn't a red run. heldFree is the booking core's
    // shadow, which foresees no following: a measure, not a fault.)
    const broke = Object.entries(report.broke).filter(([k, v]) => k !== "heldFree" && v.count > 0).map(([k, v]) => `${k}: ${v.first[0]}`);
    expect(broke).toEqual([]);
  }, 120_000);
});
