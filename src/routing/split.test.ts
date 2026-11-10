/**
 * The split: the crossover's board without the line beside its single end. One line in at end 0 (a hole), two out at
 * ends 1 (straight on) and 2 (over, a double track's width to the left; flipped, to the right), both pegs. Points with
 * one lever, routed as points (`track/points.ts`); its two-track end joins double track directly.
 */
import { describe, expect, it } from "vitest";
import {
  appendPiece,
  connectorRef,
  createRouteStep,
  createSample,
  DOUBLE_TRACK_SPACING,
  getPieceDef,
  Layout,
  leverCount,
  pathLength,
  pointsWayFrom,
  routeFrom,
  samplePath,
  type PieceTypeId,
} from "../track";
import { doubleTrack, junction, leverPoints, offersChoice, pathsFoul } from "../track/points";
import { chain } from "../economy/loop-fixtures";
import { runScenario, type HarnessRun, type Scenario } from "./harness";
import { Sim } from "../sim";
import { arrowEnds, setRoute } from "../render/track-view";

const S: PieceTypeId = "straight-216";
const STOP: PieceTypeId = "depot-forest";
const BUFFER: PieceTypeId = "buffer-turnback";

/** A split with a leg off each end, each leg `══ stop ══ ══ ⊏`. */
function withLegs(layout: Layout, flipped = false) {
  const id = layout.addPiece("split", { x: 0, z: 0, heading: 0 }, 0, flipped);
  const legs = [0, 1, 2].map((c) => {
    const ids = chain(layout, [S, STOP, S, S], connectorRef(id, c));
    appendPiece(layout, BUFFER, false, connectorRef(ids[ids.length - 1], 1));
    return ids;
  });
  return { id, legs, stops: legs.map((l) => l[1]) };
}

describe("the split", () => {
  for (const flipped of [false, true])
    it(`its paths meet its ends, placed and heading out (${flipped ? "flipped" : "as it comes"})`, () => {
      const def = getPieceDef("split", flipped);
      const s = createSample();
      for (const p of def.paths)
        for (const [end, at, out] of [
          [p.from, 0, Math.PI],
          [p.to!, pathLength(p.geom), 0],
        ] as const) {
          samplePath(p.geom, at, s);
          const c = def.connectors[end].pose;
          expect(Math.hypot(s.x - c.x, s.z - c.z), `path ${p.from}→${p.to} at end ${end}`).toBeLessThan(1e-6);
          const d = Math.atan2(Math.sin(s.heading + out - c.heading), Math.cos(s.heading + out - c.heading));
          expect(Math.abs(d), `heading at end ${end}`).toBeLessThan(1e-6);
        }
    });

  it("is the crossover's straight and link, without its second line: a hole at the trunk, two pegs a double track's width apart", () => {
    const def = getPieceDef("split", false);
    const crossover = getPieceDef("crossover", false);
    expect(def.connectors.map((c) => c.kind)).toEqual(["socket", "peg", "peg"]);
    expect(def.connectors[0]).toEqual(crossover.connectors[0]);
    expect(def.connectors[1]).toEqual(crossover.connectors[1]);
    expect(def.connectors[2]).toEqual(crossover.connectors[3]);
    expect(def.paths.map((p) => [p.from, p.to])).toEqual([
      [0, 1],
      [0, 2],
    ]);
    expect(def.paths[0].geom).toEqual(crossover.paths[0].geom);
    expect(def.paths[1].geom).toEqual(crossover.paths[2].geom);
    expect(getPieceDef("split", true).connectors[2].pose.z).toBeCloseTo(-DOUBLE_TRACK_SPACING);
    // (Its board: filled in between the two lines at the two-track end, tapering to the trunk.)
    expect(def.web).toBeDefined();
  });

  it("is points with one lever (track/points.ts): a choice at its trunk only, the two roads fouling each other", () => {
    const def = getPieceDef("split", false);
    expect(def.isSwitch).toBe(true);
    expect(leverPoints(def)).toBe(true);
    expect(offersChoice(def)).toBe(true);
    expect(junction(def)).toBe(true);
    expect(doubleTrack(def)).toBe(false);
    expect(pathsFoul(def, 0, 1)).toBe(true);
    expect(leverCount(def)).toBe(1);
    expect(arrowEnds(def)).toEqual([0]);
    expect(setRoute(def, 0)).toBe(def.paths[0]);
    expect(setRoute(def, 1)).toBe(def.paths[1]);
  });

  for (const flipped of [false, true])
    it(`its two-track end joins double track directly, both lines at once (${flipped ? "flipped" : "as it comes"})`, () => {
      const layout = new Layout();
      const id = layout.addPiece("split", { x: 0, z: 0, heading: 0 }, 0, flipped);
      // (Flipped, its other line is to the right: the double straight's first line meets that one.)
      const dbl = appendPiece(layout, "double-straight", false, connectorRef(id, flipped ? 2 : 1), 0);
      expect(layout.joinedConnector(connectorRef(id, 1))).not.toBe(-1);
      expect(layout.joinedConnector(connectorRef(id, 2))).not.toBe(-1);
      expect(layout.joinedConnector(connectorRef(dbl, 0))).not.toBe(-1);
      expect(layout.joinedConnector(connectorRef(dbl, 2))).not.toBe(-1);
      // And a crossover beyond that, both its near ends joined.
      const x = appendPiece(layout, "crossover", false, connectorRef(dbl, 1), 0);
      for (const c of [0, 2]) expect(layout.joinedConnector(connectorRef(x, c)), `crossover end ${c}`).not.toBe(-1);
    });

  it("follows its lever from the trunk, and leads trains from either branch back to the trunk whatever the lever", () => {
    const layout = new Layout();
    const { id, legs } = withLegs(layout);
    const def = getPieceDef("split", false);
    const step = createRouteStep();
    const exitFrom = (end: number) => {
      expect(routeFrom(layout, legs[end][0], 0, step)).toBe(true);
      expect(step.pieceId).toBe(id);
      const p = def.paths[step.pathIndex];
      return step.reversed ? p.from : p.to;
    };
    layout.setSwitchState(id, 0);
    expect([0, 1, 2].map(exitFrom)).toEqual([1, 0, 0]);
    layout.setSwitchState(id, 1);
    expect([0, 1, 2].map(exitFrom)).toEqual([2, 0, 0]);
    expect(pointsWayFrom(layout, id, 0, 2)).toBe(1);
  });

  it("the sim: a lever tap throws it, never under a train", () => {
    const layout = new Layout();
    const o = withLegs(layout);
    const sim = new Sim(layout);
    expect(sim.toggleSwitch(o.id)).toBe(true);
    expect(layout.switchState(o.id)).toBe(1);
    expect(sim.toggleSwitch(o.id)).toBe(true);
    expect(layout.switchState(o.id)).toBe(0);
    expect(sim.addTrain(["engine"], { pieceId: o.id, pathIndex: 0, reversed: false, s: 100 }).kind).toBe("placed");
    expect(sim.toggleSwitch(o.id)).toBe(false);
    expect(layout.switchState(o.id)).toBe(0);
  });

  for (const flipped of [false, true])
    it(`a routed train runs onto each branch and back through the single end, the router setting it each way, with no train invariant broken (${flipped ? "flipped" : "as it comes"})`, () => {
      const seen = { states: new Set<number>(), stops: [] as number[] };
      let o!: ReturnType<typeof withLegs>;
      const order = [1, 0, 2, 0];
      const scenario: Scenario = {
        name: "split: a routed train every way",
        seconds: 480,
        build: (layout) => {
          o = withLegs(layout, flipped);
          const watch = (run: HarnessRun) => {
            const t = run.sim.findCar(run.engines[0])?.train;
            if (t?.bogies.some((b) => b.pieceId === o.id)) seen.states.add(run.layout.switchState(o.id));
            const at = t ? o.stops.find((s) => t.bogies.some((b) => b.pieceId === s)) : undefined;
            if (at !== undefined && seen.stops[seen.stops.length - 1] !== at) seen.stops.push(at);
            return false;
          };
          return {
            trains: [{ pieceId: o.legs[0][0], reversed: true, stops: order.map((k) => o.stops[k]), cars: ["engine", "timber"] }],
            events: [{ when: watch, do: () => {} }],
          };
        },
      };
      const report = runScenario(new Layout(), scenario);
      for (const k of Object.keys(report.broke) as (keyof typeof report.broke)[]) expect(report.broke[k].count, `${k}: ${report.broke[k].first.join("; ")}`).toBe(0);
      expect(report.arrivals[0]).toBeGreaterThanOrEqual(4);
      // (Its tail starts by leg 0's stop: the stops come to after that.)
      const after = seen.stops[0] === o.stops[0] ? seen.stops.slice(1) : seen.stops;
      expect(after.slice(0, 4)).toEqual(order.map((k) => o.stops[k]));
      expect(seen.states.has(0)).toBe(true);
      expect(seen.states.has(1)).toBe(true);
    });
});
