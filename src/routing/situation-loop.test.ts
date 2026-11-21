/**
 * Situation help step 3 (spec docs/superpowers/specs/2026-11-18-situation-help.md, detector #4): two lines' trains nose
 * to nose on single track, where a passing loop is the fix. On the routing harness: the loop a straight short, the
 * stall classifier says them stuck in each other's way, the tip is found; the straight put in, they pass and deliver,
 * and the tip isn't found.
 */
import { describe, expect, it } from "vitest";
import { SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { chain, loopOn } from "../economy/loop-fixtures";
import { JAM_LOOP } from "../game/situation-tips";
import type { World } from "../game/world";
import { HarnessRun } from "./harness";

const S: PieceTypeId = "straight-216";
const CARS: CarKind[] = ["engine", "timber", "timber"];

describe("situation tips: trains can't pass", { timeout: 120_000 }, () => {
  it("nose to nose for want of a loop: said; the loop closed, they pass, and it isn't", () => {
    let gap: { type: PieceTypeId; pose: { x: number; z: number; heading: number }; y: number; flipped: boolean } | null = null;
    const run = new HarnessRun(new Layout(), {
      name: "head on, the loop a straight short",
      seconds: 900,
      build: (layout) => {
        const [a, ...w] = chain(layout, ["depot-forest", S, S, S, S]);
        appendPiece(layout, "buffer-turnback", false, connectorRef(a, 0));
        const l = loopOn(layout, connectorRef(w[3], 1), [S, S], [S]);
        const e = chain(layout, [S, S, S, S, "depot-sawmill"], connectorRef(l.s2, 0));
        appendPiece(layout, "buffer-turnback", false, connectorRef(e[4], 1));
        // (The loop's side road a straight short: the player's to lay.)
        const p = layout.getPiece(l.side[1])!;
        gap = { type: p.type, pose: { ...p.pose }, y: p.y ?? 0, flipped: p.flipped };
        layout.removePiece(l.side[1]);
        return {
          trains: [
            { pieceId: w[0], stops: [a, e[4]], next: 1, line: 1, cars: CARS },
            { pieceId: e[1], reversed: true, stops: [e[4], a], next: 1, line: 2, cars: CARS },
          ],
        };
      },
    });
    // The economy as the detector reads it, from the harness (two lines, one train each).
    const world = () =>
      ({
        sim: run.sim,
        layout: run.layout,
        economy: {
          stalls: run.stalls,
          sections: run.sections,
          lineIdOf: new Map(run.engines.map((e, k) => [e, k + 1])),
          lines: new Map([
            [1, { id: 1, name: "Red line" }],
            [2, { id: 2, name: "Blue line" }],
          ]),
        },
      }) as unknown as World;
    const r = run.run(300);
    expect(r.arrivals).toEqual([0, 0]);
    expect(r.stalls.why).toEqual(["in-way", "in-way"]);
    const sit = JAM_LOOP.look(world(), { learned: new Set(["switches", "routes"]), nameOf: () => "" });
    expect(sit?.title).toBe("Trains can't pass");
    expect(sit?.text).toMatch(/nose to nose\. A passing loop in the middle lets them pass/);
    expect(sit?.more).toBe("loops");
    expect(sit?.pieces?.length).toBeGreaterThan(1);
    // Before Switches: learning them first.
    expect(JAM_LOOP.look(world(), { learned: new Set(), nameOf: () => "" })?.text).toMatch(/Learn Switches/);
    // The straight put in: joined at both ends, the loop is one, and they pass.
    const id = run.layout.addPiece(gap!.type, gap!.pose, gap!.y, gap!.flipped);
    expect([0, 1].map((c) => run.layout.joinedConnector(connectorRef(id, c)) !== -1)).toEqual([true, true]);
    for (let i = 0; i < 600 * SIM_HZ; i++) run.step();
    const after = run.run(0);
    expect(Math.min(...after.arrivals)).toBeGreaterThan(5);
    expect(JAM_LOOP.look(world(), { learned: null, nameOf: () => "" })).toBeNull();
  });
});
