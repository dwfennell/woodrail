/**
 * Slips and the double three-way (tech-tree T3, T4: docs/superpowers/specs/2026-10-31-tech-tree.md). A slip is a 45°
 * crossing whose ends may also turn onto the other line (one lever: straight across, or onto the curves); a double
 * three-way is a three-way with a lever for each branch. Their geometry meets their ends, trains follow their levers,
 * and routed trains (with the invariants on) are sent every way through them.
 */
import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, createRouteStep, createSample, getPieceDef, Layout, leverCount, pairLeverState, pathLength, pointsWayFrom, routeFrom, samplePath, SLIP_RADIUS, type PieceTypeId } from "../track";
import { chain } from "../economy/loop-fixtures";
import { runScenario, type HarnessRun, type Scenario } from "./harness";
import { Sim } from "../sim";
import { setRoute } from "../render/track-view";

const S: PieceTypeId = "straight-216";
const STOP: PieceTypeId = "depot-forest";
const BUFFER: PieceTypeId = "buffer-turnback";

/** Every path starts and ends on one of its piece's ends: at its place, heading out of the piece there. */
function pathsMeetEnds(type: PieceTypeId, flipped: boolean): void {
  const def = getPieceDef(type, flipped);
  const s = createSample();
  for (const p of def.paths) {
    for (const [end, at, out] of [
      [p.from, 0, Math.PI],
      [p.to!, pathLength(p.geom), 0],
    ] as const) {
      samplePath(p.geom, at, s);
      const c = def.connectors[end].pose;
      expect(Math.hypot(s.x - c.x, s.z - c.z), `${type} path ${p.from}→${p.to} at end ${end}`).toBeLessThan(1e-6);
      const d = Math.atan2(Math.sin(s.heading + out - c.heading), Math.cos(s.heading + out - c.heading));
      expect(Math.abs(d), `${type} heading at end ${end}`).toBeLessThan(1e-6);
    }
  }
}

/** A piece with a leg off each of its ends, each leg `══ stop ══ ══ ⊏`. */
function withLegs(layout: Layout, type: PieceTypeId) {
  const id = layout.addPiece(type, { x: 0, z: 0, heading: 0 });
  const def = getPieceDef(type, false);
  const legs = def.connectors.map((_, c) => {
    const ids = chain(layout, [S, STOP, S, S], connectorRef(id, c));
    appendPiece(layout, BUFFER, false, connectorRef(ids[ids.length - 1], 1));
    return ids;
  });
  return { id, legs, stops: legs.map((l) => l[1]) };
}

/** A routed train starting on leg `from`, heading in, with these legs' stops in turn: what the piece was set to, and the stops come to. */
function routed(type: PieceTypeId, from: number, order: number[], seconds = 300) {
  const seen = { states: new Set<number>(), stops: [] as number[] };
  let o!: ReturnType<typeof withLegs>;
  const scenario: Scenario = {
    name: `${type}: a routed train every way`,
    seconds,
    build: (layout) => {
      o = withLegs(layout, type);
      const watch = (run: HarnessRun) => {
        const t = run.sim.findCar(run.engines[0])?.train;
        if (t?.bogies.some((b) => b.pieceId === o.id)) seen.states.add(run.layout.switchState(o.id));
        const at = t ? o.stops.find((s) => t.bogies.some((b) => b.pieceId === s)) : undefined;
        if (at !== undefined && seen.stops[seen.stops.length - 1] !== at) seen.stops.push(at);
        return false;
      };
      return {
        trains: [{ pieceId: o.legs[from][0], reversed: true, stops: order.map((k) => o.stops[k]), cars: ["engine", "timber"] }],
        events: [{ when: watch, do: () => {} }],
      };
    },
  };
  const report = runScenario(new Layout(), scenario);
  return { report, seen, legs: () => o };
}

const noBreaks = (report: ReturnType<typeof runScenario>) => {
  for (const k of Object.keys(report.broke) as (keyof typeof report.broke)[]) expect(report.broke[k].count, `${k}: ${report.broke[k].first.join("; ")}`).toBe(0);
};

describe("slips (T4)", () => {
  it("are a 45° crossing with curves: the same ends, the crossing's straights, and an eighth-turn curve that meets both lines' ends", () => {
    const crossing = getPieceDef("crossing-45", false);
    for (const type of ["slip-single", "slip-double"] as const) {
      for (const flipped of [false, true]) pathsMeetEnds(type, flipped);
      const def = getPieceDef(type, false);
      expect(def.connectors).toEqual(crossing.connectors);
      expect(def.paths.slice(0, 2)).toEqual(crossing.paths);
      expect(def.isSwitch).toBe(true);
      expect(def.slip).toBe(true);
      expect(def.flippable).toBe(true);
      expect(leverCount(def)).toBe(1);
    }
    expect(getPieceDef("slip-single", false).paths).toHaveLength(3);
    expect(getPieceDef("slip-double", false).paths).toHaveLength(4);
    // (Between the curve and the wide curve: gentle enough for any train.)
    expect(SLIP_RADIUS).toBeGreaterThan(173);
    expect(SLIP_RADIUS).toBeLessThan(175);
  });

  it("one lever: every end with a choice goes straight across at 0 and onto its curve at 1", () => {
    const layout = new Layout();
    const { id, legs } = withLegs(layout, "slip-double");
    const def = getPieceDef("slip-double", false);
    const step = createRouteStep();
    // (Leaving each leg's first piece toward the slip: which end of the slip it's then going to.)
    const exitFrom = (end: number) => {
      expect(routeFrom(layout, legs[end][0], 0, step)).toBe(true);
      expect(step.pieceId).toBe(id);
      const p = def.paths[step.pathIndex];
      return step.reversed ? p.from : p.to;
    };
    layout.setSwitchState(id, 0);
    expect([0, 1, 2, 3].map(exitFrom)).toEqual([1, 0, 3, 2]);
    layout.setSwitchState(id, 1);
    expect([0, 1, 2, 3].map(exitFrom)).toEqual([3, 2, 1, 0]);
    for (const end of [0, 1, 2, 3]) expect(pointsWayFrom(layout, id, end, 2)).toBe(1);
  });

  it("a single slip turns from end 0 only (and back from end 3); its other ends go straight across whatever the lever", () => {
    const layout = new Layout();
    const { id, legs } = withLegs(layout, "slip-single");
    const def = getPieceDef("slip-single", false);
    const step = createRouteStep();
    const exitFrom = (end: number) => {
      routeFrom(layout, legs[end][0], 0, step);
      const p = def.paths[step.pathIndex];
      return step.reversed ? p.from : p.to;
    };
    layout.setSwitchState(id, 1);
    expect([0, 1, 2, 3].map(exitFrom)).toEqual([3, 0, 3, 0]);
    layout.setSwitchState(id, 0);
    expect([0, 1, 2, 3].map(exitFrom)).toEqual([1, 0, 3, 2]);
  });

  it("the chevrons show every end with a choice: both curves set both ways at 1, both lines across at 0", () => {
    const def = getPieceDef("slip-double", false);
    expect([0, 1, 2, 3].map((e) => def.paths.indexOf(setRoute(def, 1, e)!))).toEqual([2, 3, 3, 2]);
    expect([0, 1, 2, 3].map((e) => def.paths.indexOf(setRoute(def, 0, e)!))).toEqual([0, 0, 1, 1]);
  });

  it("the sim: a lever tap throws it, never under a train", () => {
    const layout = new Layout();
    const o = withLegs(layout, "slip-double");
    const sim = new Sim(layout);
    expect(sim.toggleSwitch(o.id)).toBe(true);
    expect(layout.switchState(o.id)).toBe(1);
    expect(sim.toggleSwitch(o.id)).toBe(true);
    expect(layout.switchState(o.id)).toBe(0);
    expect(sim.addTrain(["engine"], { pieceId: o.id, pathIndex: 1, reversed: false, s: 70 }).kind).toBe("placed");
    expect(sim.toggleSwitch(o.id)).toBe(false);
    expect(layout.switchState(o.id)).toBe(0);
  });

  it("a double slip: a routed train runs onto both curves and across both lines, the router setting it each way, with no train invariant broken", () => {
    // (Leg 0 → 3 by its curve, 3 → 2 across, 2 → 1 by the other curve, 1 → 0 across.)
    const { report, seen, legs } = routed("slip-double", 0, [3, 2, 1, 0], 420);
    noBreaks(report);
    expect(report.arrivals[0]).toBeGreaterThanOrEqual(4);
    const o = legs();
    // (Its tail starts on leg 0's stop: the stops come to after that.)
    const after = seen.stops[0] === o.stops[0] ? seen.stops.slice(1) : seen.stops;
    expect(after.slice(0, 4)).toEqual([3, 2, 1, 0].map((k) => o.stops[k]));
    expect(seen.states.has(0)).toBe(true);
    expect(seen.states.has(1)).toBe(true);
  });

  it("a single slip: a routed train turns onto its curve and back, and crosses straight over", () => {
    // (Leg 0 → 3 by the curve, 3 → 2 across, 2 → 0: across to leg 3, turned back there, and back by the curve.)
    const { report, seen, legs } = routed("slip-single", 0, [3, 2, 0], 420);
    noBreaks(report);
    expect(report.arrivals[0]).toBeGreaterThanOrEqual(3);
    const o = legs();
    expect(seen.stops).toContain(o.stops[2]);
    expect(seen.stops).toContain(o.stops[3]);
    expect(seen.states.has(1)).toBe(true);
  });
});

describe("the double three-way (T3)", () => {
  const def = getPieceDef("switch-3way-double", false);

  it("is a three-way's shape with two levers, one for each branch", () => {
    pathsMeetEnds("switch-3way-double", false);
    const three = getPieceDef("switch-3way", false);
    expect(def.connectors).toEqual(three.connectors);
    expect(def.paths).toEqual(three.paths);
    expect(leverCount(def)).toBe(2);
    expect(def.pairLevers).toBe(true);
  });

  it("each lever sends trains its branch's way, or back straight on; one thrown puts the other back", () => {
    expect(pairLeverState(0, 0)).toBe(1);
    expect(pairLeverState(1, 0)).toBe(0);
    expect(pairLeverState(1, 1)).toBe(2);
    expect(pairLeverState(2, 0)).toBe(1);
    const layout = new Layout();
    const o = withLegs(layout, "switch-3way-double");
    const sim = new Sim(layout);
    const way = () => pointsWayFrom(layout, o.id, 0, 3);
    expect(way()).toBe(0);
    sim.toggleSwitch(o.id, 0);
    expect(way()).toBe(1);
    sim.toggleSwitch(o.id, 1);
    expect(way()).toBe(2);
    sim.toggleSwitch(o.id, 1);
    expect(way()).toBe(0);
    // (Followed from the trunk: the road each lever sets.)
    const step = createRouteStep();
    for (const [lever, end] of [
      [0, 2],
      [1, 3],
    ] as const) {
      layout.setSwitchState(o.id, 0);
      sim.toggleSwitch(o.id, lever);
      routeFrom(layout, o.legs[0][0], 0, step);
      expect(def.paths[step.pathIndex].to).toBe(end);
    }
  });

  it("a routed train is sent all three ways from the trunk, with no train invariant broken", () => {
    const { report, seen, legs } = routed("switch-3way-double", 0, [1, 2, 3], 420);
    noBreaks(report);
    expect(report.arrivals[0]).toBeGreaterThanOrEqual(3);
    const o = legs();
    for (const k of [1, 2, 3]) expect(seen.stops).toContain(o.stops[k]);
    for (const s of [0, 1, 2]) expect(seen.states.has(s), `state ${s}`).toBe(true);
  });

  it("a lever tap locked for a routed train waits for it, the tap its new default", () => {
    const got: { deferred?: boolean; def?: number; state?: number } = {};
    const scenario: Scenario = {
      name: "double three-way lever taps",
      seconds: 200,
      build: (layout) => {
        const o = withLegs(layout, "switch-3way-double");
        return {
          trains: [{ pieceId: o.legs[0][0], reversed: true, stops: [o.stops[2], o.stops[0]], cars: ["engine", "timber"] }],
          events: [
            {
              when: (run) => run.router.locked(o.id) && run.layout.switchState(o.id) === 1,
              do: (run) => {
                const r = run.router.lever(o.id, 1);
                got.deferred = "deferred" in r;
                got.def = run.router.defaultOf(o.id);
                got.state = run.layout.switchState(o.id);
              },
            },
          ],
        };
      },
    };
    const report = runScenario(new Layout(), scenario);
    expect(got).toEqual({ deferred: true, def: 2, state: 1 });
    expect(report.broke.restore.count).toBe(0);
    expect(report.broke.underTrain.count).toBe(0);
  });
});
