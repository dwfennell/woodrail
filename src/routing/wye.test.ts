/**
 * The wye's three levers (#15): one at each corner, so a routed train can be sent any of its three ways. Each corner's
 * lever is a bit of the wye's switch state (`PieceDef.cornerLevers`); the router sets only the corner a train comes
 * onto it by, and puts the whole wye back to the player's default after it.
 */
import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, pointsWayFrom, type PieceTypeId } from "../track";
import { chain } from "../economy/loop-fixtures";
import { runScenario, type HarnessRun, type Scenario } from "./harness";
import { Sim } from "../sim";

const S: PieceTypeId = "straight-216";
const STOP: PieceTypeId = "depot-forest";
const BUFFER: PieceTypeId = "buffer-turnback";

/**
 * A wye with a leg off each corner, each leg `══ stop ══ ══ ⊏`: a train with a stop on every leg runs each of the
 * wye's three ways in turn (A → B by the trunk's left road, B → C across, C → A to the trunk).
 */
function wyeOfLegs(layout: Layout, defaults = 0) {
  const wye = layout.addPiece("wye", { x: 0, z: 0, heading: 0 });
  const legs = [0, 1, 2].map((c) => {
    const ids = chain(layout, [S, STOP, S, S], connectorRef(wye, c));
    appendPiece(layout, BUFFER, false, connectorRef(ids[ids.length - 1], 1));
    return ids;
  });
  layout.setSwitchState(wye, defaults);
  return { wye, legs, stops: legs.map((l) => l[1]) };
}

/** The wye's three ways, run by a routed train; what each corner's lever was seen set to, and the stops come to. */
function threeWays(defaults: number, seconds = 240) {
  const seen = { states: new Set<number>(), stops: [] as number[] };
  let o!: ReturnType<typeof wyeOfLegs>;
  const scenario: Scenario = {
    name: "a wye's three ways",
    seconds,
    build: (layout) => {
      o = wyeOfLegs(layout, defaults);
      const watch = (run: HarnessRun) => {
        seen.states.add(run.layout.switchState(o.wye));
        const t = run.sim.findCar(run.engines[0])?.train;
        // (The harness's trains run through their stops: the leg's stop it's on, in the order come to.)
        const at = t ? o.stops.find((s) => t.bogies.some((b) => b.pieceId === s)) : undefined;
        if (at !== undefined && seen.stops[seen.stops.length - 1] !== at) seen.stops.push(at);
        return false;
      };
      return {
        // (On leg A, heading into the wye: B, then C, then A.)
        trains: [{ pieceId: o.legs[0][0], reversed: true, stops: [o.stops[1], o.stops[2], o.stops[0]], cars: ["engine", "timber"] }],
        events: [{ when: watch, do: () => {} }],
      };
    },
  };
  const layout = new Layout();
  const report = runScenario(layout, scenario);
  return { report, seen, o, layout };
}

describe("a wye's three levers (#15)", () => {
  it("each corner's lever picks the road from that corner alone", () => {
    const layout = new Layout();
    const { wye } = wyeOfLegs(layout);
    for (let state = 0; state < 8; state++) {
      layout.setSwitchState(wye, state);
      for (const corner of [0, 1, 2]) expect(pointsWayFrom(layout, wye, corner, 2)).toBe((state >> corner) & 1);
    }
  });

  it("the sim: a lever throws its own corner only, never under a train", () => {
    const layout = new Layout();
    const o = wyeOfLegs(layout);
    const sim = new Sim(layout);
    expect(sim.toggleSwitch(o.wye, 1)).toBe(true);
    expect(layout.switchState(o.wye)).toBe(0b010);
    expect(sim.toggleSwitch(o.wye, 2)).toBe(true);
    expect(sim.toggleSwitch(o.wye, 0)).toBe(true);
    expect(layout.switchState(o.wye)).toBe(0b111);
    expect(sim.toggleSwitch(o.wye, 1)).toBe(true);
    expect(layout.switchState(o.wye)).toBe(0b101);
    // (A train on the wye: no lever moves.)
    expect(sim.addTrain(["engine"], { pieceId: o.wye, pathIndex: 2, reversed: false, s: 100 }).kind).toBe("placed");
    for (const c of [0, 1, 2]) expect(sim.toggleSwitch(o.wye, c)).toBe(false);
    expect(layout.switchState(o.wye)).toBe(0b101);
  });

  it("a routed train runs all three ways, the router setting each corner it comes onto, and puts the wye back", () => {
    const { report, seen } = threeWays(0);
    for (const k of Object.keys(report.broke) as (keyof typeof report.broke)[]) expect(report.broke[k].count, `${k}: ${report.broke[k].first.join("; ")}`).toBe(0);
    // The payoff: every leg's stop, round and round (B, C, A, B, …).
    expect(report.arrivals[0]).toBeGreaterThanOrEqual(6);
    expect(new Set(seen.stops).size).toBe(3);
    // B → C is across from corner 1 (its lever's bit, 0b010): set for it by the router, never by the default.
    expect([...seen.states].some((s) => (s & 0b010) !== 0)).toBe(true);
    // Set, and put back to the default (0) after each pass.
    expect(report.restored).toBeGreaterThan(0);
    expect(seen.states.has(0)).toBe(true);
  });

  it("with every corner's default the other way, the router still sends it each way, and puts back all three", () => {
    const { report, seen } = threeWays(0b111);
    for (const k of Object.keys(report.broke) as (keyof typeof report.broke)[]) expect(report.broke[k].count, k).toBe(0);
    expect(report.arrivals[0]).toBeGreaterThanOrEqual(6);
    expect(new Set(seen.stops).size).toBe(3);
    // A → B from the trunk is its left road (bit 0 clear), C → A from corner 2 to the trunk (bit 2 clear).
    expect([...seen.states].some((s) => (s & 0b001) === 0)).toBe(true);
    expect([...seen.states].some((s) => (s & 0b100) === 0)).toBe(true);
    expect(report.restored).toBeGreaterThan(0);
  });

  it("a lever tap throws only its own corner; locked for a train, it waits for it, the tap that corner's new default", () => {
    const got: { free?: number[]; locked?: { state: number; deferred: boolean; def: number } } = {};
    const scenario: Scenario = {
      name: "wye lever taps",
      seconds: 120,
      build: (layout) => {
        const o = wyeOfLegs(layout);
        return {
          trains: [{ pieceId: o.legs[0][0], reversed: true, stops: [o.stops[1], o.stops[2], o.stops[0]], cars: ["engine", "timber"] }],
          events: [
            // (Free: each tap throws its own corner only, and the router takes it as that corner's default.)
            {
              at: 0,
              do: (run) => {
                const states: number[] = [];
                for (const c of [1, 2, 2, 1]) {
                  run.lever(o.wye, c);
                  states.push(run.layout.switchState(o.wye));
                }
                got.free = [...states, run.router.defaultOf(o.wye)];
              },
            },
            // (Locked for the train coming B → C across corner 1: a tap on corner 2 leaves them set for it.)
            {
              when: (run) => run.router.locked(o.wye) && pointsWayFrom(run.layout, o.wye, 1, 2) === 1,
              do: (run) => {
                const was = run.layout.switchState(o.wye);
                const r = run.router.lever(o.wye, 2);
                got.locked = { state: was ^ run.layout.switchState(o.wye), deferred: "deferred" in r, def: run.router.defaultOf(o.wye) };
              },
            },
          ],
        };
      },
    };
    const report = runScenario(new Layout(), scenario);
    expect(got.free).toEqual([0b010, 0b110, 0b010, 0b000, 0b000]);
    expect(got.locked).toEqual({ state: 0, deferred: true, def: 0b100 });
    // (And it went the tap's way once the train had passed: the restore check holds.)
    expect(report.broke.restore.count).toBe(0);
    expect(report.broke.underTrain.count).toBe(0);
  });
});
