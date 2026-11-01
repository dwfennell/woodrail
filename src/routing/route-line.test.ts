import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { SIM_HZ } from "../sim";
import { legFromCursor, lineLegs, type Leg } from "../game/route-path";
import { HarnessRun, INVARIANTS, type Scenario } from "./harness";
import { dogbone, millToBalloon, millToTeardrop, type LoopStart } from "./scenarios";

/**
 * The line drawn on the map goes where the train goes (the user, 2026-10-31: "why is it not using the loop back to the
 * farm?"). Each scenario runs in the harness with the train's front piece recorded; the line's legs, joined round once
 * (`lineLegs`, as the all-lines view draws it, and as an engine's card draws it from the train's own way to its next
 * stop), must be a stretch of what the train ran. Before: each leg left its stop by the shorter end, so the leg from a
 * stop by a loop was drawn reversing there, back down the line, while the train ran on round the loop.
 *
 *   npx vitest run src/routing/route-line.test.ts
 */

/** A leg's pieces, without repeats in a row. */
const piecesOf = (leg: Leg) => (leg ?? []).map((r) => r.pieceId).filter((id, i, a) => i === 0 || a[i - 1] !== id);

/** The legs joined round once, as pieces (no repeats in a row). */
function lap(legs: Leg[]): number[] {
  const out: number[] = [];
  for (const leg of legs) for (const id of piecesOf(leg)) if (out[out.length - 1] !== id) out.push(id);
  // (The first piece again closes the lap: it's where the last leg ends.)
  if (out.length > 1 && out[out.length - 1] === out[0]) out.pop();
  return out;
}

const contains = (ran: number[], lapPieces: number[]) => ` ${ran.join(" ")} `.includes(` ${lapPieces.join(" ")} `);

function runLoop(scenario: Scenario) {
  const layout = new Layout();
  const run = new HarnessRun(layout, scenario);
  const engine = run.engines[0];
  const route = run.routes.get(engine)!;
  const lead = () => {
    const t = run.sim.findCar(engine)!.train;
    return t.cars[0].id === engine ? t.bogies[0] : t.bogies[t.bogies.length - 1];
  };
  // The card's view at the start: the train's way to its next stop, and the legs on from there.
  const toNext = legFromCursor(layout, { ...lead() }, route.stops[route.next]);
  const card = lineLegs(layout, route.stops, { k: route.next, leg: toNext });
  const ran: number[] = [];
  for (let i = 0; i < scenario.seconds * SIM_HZ; i++) {
    run.step();
    const id = lead().pieceId;
    if (ran[ran.length - 1] !== id) ran.push(id);
  }
  return { layout, run, ran, stops: route.stops, toNext, card, report: run.run(0) };
}

const STARTS: LoopStart[] = ["to-farm", "to-mill", "to-mill-next-farm", "at-farm", "at-farm-back"];
const CASES: Scenario[] = [
  ...STARTS.map((s) => millToTeardrop(s)),
  millToTeardrop("to-farm", "other"),
  millToTeardrop("to-farm", "pinned"),
  millToTeardrop("at-farm-back", "pinned"),
  ...STARTS.map((s) => millToBalloon(s)),
  ...STARTS.map((s) => dogbone(s)),
];

describe("the drawn line goes round the loop, as the train does", () => {
  for (const scenario of CASES) {
    it(scenario.name, () => {
      const r = runLoop(scenario);
      for (const k of INVARIANTS) expect(r.report.broke[k].count, k).toBe(0);
      // The payoff: it works the line (the farm and the mill, again and again), engine first, turning only at buffers.
      expect(r.report.arrivals[0]).toBeGreaterThanOrEqual(6);
      expect(r.report.pushed[0]).toBe(0);
      const legs = lineLegs(r.layout, r.stops);
      expect(legs.every((l) => l !== null)).toBe(true);
      const drawn = lap(legs);
      expect(contains(r.ran, drawn), `drawn ${drawn.join(" ")}\nran ${r.ran.join(" ")}`).toBe(true);
      // From the train (its card): the way to its next stop is what it runs first, and the legs on from there too.
      expect(contains(r.ran, piecesOf(r.toNext).slice(1)), `to next ${piecesOf(r.toNext).join(" ")}`).toBe(true);
      expect(contains(r.ran, lap(r.card))).toBe(true);
    });
  }

  it("the leg from the farm runs round the loop, not back the way it came (the bug as the user saw it)", () => {
    const r = runLoop(millToTeardrop("to-farm"));
    const legs = lineLegs(r.layout, r.stops);
    const fromFarm = piecesOf(legs[1]);
    // On round the loop: from the farm the leg's second piece is the next piece on round, not the one it came in by.
    const intoFarm = piecesOf(legs[0]);
    expect(fromFarm[1]).not.toBe(intoFarm[intoFarm.length - 2]);
    expect(fromFarm.length).toBeGreaterThan(intoFarm.length);
  });
});
