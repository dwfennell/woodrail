/**
 * Knots the dispatcher tied and never untied (the e2e with it on, 2026-11-25), on the routing harness with the
 * dispatcher on:
 *
 * - **The trap:** a line with one passing loop, a line end at each of its places (a forest, a sawmill) and three trains
 *   of one line. The search held the way to the sawmill (granted to the train turning there) as taken for its whole
 *   look-ahead, so none could deliver (0 of 3) and any move went: the third train took the loop's last road while the
 *   one at the sawmill had to come back through it. Signals alone run it (12 loads each in 330 s). `KNOT` unties it, but
 *   it's off by default (it costs the big maps: its note).
 * - **The loop laid after:** two lines' trains nose to nose for want of a loop (situation-loops), the loop then closed.
 *   Their booked ways were kept as built before (route and place unchanged), so neither was ever granted the new road.
 *   The layout's revision in a hold's signature builds them afresh.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { chain, loopOn } from "../economy/loop-fixtures";
import { HarnessRun } from "./harness";
import { KNOT } from "./dispatcher";

const S: PieceTypeId = "straight-216";
const CARS: CarKind[] = ["engine", "timber", "timber"];

describe("the dispatcher's knots", { timeout: 120_000 }, () => {
  let was = false;
  beforeEach(() => {
    was = HarnessRun.dispatch;
    HarnessRun.dispatch = true;
  });
  afterEach(() => {
    HarnessRun.dispatch = was;
  });

  const trap = () =>
    new HarnessRun(new Layout(), {
      name: "the trap: three trains, one loop, two line ends",
      seconds: 330,
      build: (layout) => {
        const [a, ...w] = chain(layout, ["depot-forest", S, S]);
        appendPiece(layout, "buffer-turnback", false, connectorRef(a, 0));
        const l = loopOn(layout, connectorRef(w[1], 1), [S, S], [S]);
        const e = chain(layout, [S, S, "depot-sawmill"], connectorRef(l.s2, 0));
        appendPiece(layout, "buffer-turnback", false, connectorRef(e[2], 1));
        // (As the touch suite's trap puts them: one at the forest's end heading for the sawmill, one at the sawmill's
        // and one on the loop's main road both heading for the forest, all three facing the sawmill.)
        return {
          trains: [
            { pieceId: w[0], s: 200, stops: [a, e[2]], next: 1, line: 1, cars: CARS },
            { pieceId: e[0], s: 200, stops: [a, e[2]], next: 0, line: 1, cars: CARS },
            { pieceId: l.main[0], s: 100, stops: [a, e[2]], next: 0, line: 1, cars: CARS },
          ],
        };
      },
    });

  // (The knot check is off by default: it costs the big maps (`KNOT`'s note). The trap as it stands, and as it would.)
  it("the trap, as the dispatcher runs today: three trains on one loop and two line ends tie a knot", () => {
    const r = trap().run(120);
    expect(r.arrivals).toEqual([0, 0, 0]);
  });

  it("…which the knot check unties: all three deliver", () => {
    const was = KNOT.on;
    KNOT.on = true;
    try {
      const r = trap().run(330);
      expect(r.stalls.why).toEqual([null, null, null]);
      // (Signals alone: 12, 12, 13.)
      expect(Math.min(...r.arrivals)).toBeGreaterThanOrEqual(10);
    } finally {
      KNOT.on = was;
    }
  });

  it("the loop laid after two trains met nose to nose: they pass and deliver", () => {
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
    const before = run.run(300);
    expect(before.arrivals).toEqual([0, 0]);
    run.edit((layout) => void layout.addPiece(gap!.type, gap!.pose, gap!.y, gap!.flipped));
    for (let i = 0; i < 120 * SIM_HZ; i++) run.step();
    const after = run.run(0);
    expect(Math.min(...after.arrivals)).toBeGreaterThanOrEqual(2);
  });
});
