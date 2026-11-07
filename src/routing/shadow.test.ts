import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { HarnessRun, type Scenario } from "./harness";
import { fuzz, shuttle, twoLinesNoLoop, twoTrainsOneLoop } from "./scenarios";
import { KINDS, ReservationShadow } from "./shadow";

/**
 * The reservation core in shadow (routing redesign §4 step 2): it books by the core's rules, and it holds nothing (a run
 * with it on moves exactly as one without).
 */

/** A harness run with the shadow ticked after each step, and the table's own rules checked at each booking. */
function shadowed(scenario: Scenario, seconds = scenario.seconds) {
  const h = new HarnessRun(new Layout(), scenario);
  const shadow = new ReservationShadow(h);
  const faults: string[] = [];
  let checks = 0;
  h.afterStep = () => {
    const before = shadow.bookings;
    shadow.tick();
    if (shadow.bookings === before) return;
    checks++;
    // (The table: no piece booked by two trains; none booked that's under another train.)
    const booked = new Map<number, number>();
    for (const b of shadow.last.values()) {
      if (!b.ok) continue;
      for (const p of b.pieces) {
        const o = booked.get(p.pieceId);
        if (o !== undefined && o !== b.key) faults.push(`piece ${p.pieceId} booked by ${o} and ${b.key}`);
        booked.set(p.pieceId, b.key);
        for (const id of h.sim.trainIds()) if (id !== b.trainId && h.sim.piecesUnder(id).has(p.pieceId)) faults.push(`piece ${p.pieceId} booked by ${b.key} under train ${id}`);
      }
    }
  };
  const report = h.run(seconds);
  return { h, shadow, report, faults, checks };
}

describe("the reservation shadow (routing redesign step 2)", () => {
  it("a lone shuttle: every booking reaches a waiting point (the buffers), and nothing disagrees", () => {
    const { shadow, faults, checks } = shadowed(shuttle, 120);
    expect(checks).toBeGreaterThan(100);
    expect(faults).toEqual([]);
    for (const k of KINDS) if (k !== "strayed") expect(shadow.counts[k], `${k}: ${shadow.first[k].join(" | ")}`).toBe(0);
  });

  it("two trains head on along one line with no loop: neither can book a way (each runs into the other), each names the other", () => {
    const h = new HarnessRun(new Layout(), twoLinesNoLoop);
    const shadow = new ReservationShadow(h);
    h.step();
    shadow.tick();
    const bookings = [...shadow.last.values()];
    expect(bookings).toHaveLength(2);
    const [a, b] = bookings;
    expect(a.refusal).toMatchObject({ kind: "train", by: b.key });
    expect(b.refusal).toMatchObject({ kind: "train", by: a.key });
  });

  it("two trains, one loop: the table's rules hold at every booking over 5 minutes", () => {
    const { faults, checks, shadow } = shadowed(twoTrainsOneLoop, 300);
    expect(checks).toBeGreaterThan(1000);
    expect(faults).toEqual([]);
    expect(shadow.bookings).toBeGreaterThan(0);
  });

  it("holds nothing: fuzz seeds run exactly as without it (the trajectory)", () => {
    for (const seed of [1, 2, 3, 4]) {
      const plain = new HarnessRun(new Layout(), fuzz(seed, 120)).run(120);
      const { report } = shadowed(fuzz(seed, 120), 120);
      expect(report.trajectory, `seed ${seed}`).toBe(plain.trajectory);
    }
    for (const seed of [1, 2]) {
      const plain = new HarnessRun(new Layout(), fuzz(seed, 120, true)).run(120);
      const { report } = shadowed(fuzz(seed, 120, true), 120);
      expect(report.trajectory, `seed ${seed} with signals`).toBe(plain.trajectory);
    }
  });
});
