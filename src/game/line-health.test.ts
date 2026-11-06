import { describe, expect, it } from "vitest";
import { HEALTH_ORDER, lineHealth } from "./line-health";
import type { TrainState } from "./engine-status";

const run: TrainState = { kind: "running" };
const work: TrainState = { kind: "worked", depotId: 1, work: "Loading" };
const red: TrainState = { kind: "red-signal", signalId: 3 };
const stuck: TrainState = { kind: "stuck", why: "too-many" };

describe("lineHealth", () => {
  it("no trains: none; any stuck or off the track: stuck; all standing waiting: waiting; else moving", () => {
    expect(lineHealth([])).toBe("none");
    expect(lineHealth([run, stuck])).toBe("stuck");
    expect(lineHealth([{ kind: "derailed" }])).toBe("stuck");
    expect(lineHealth([red, { kind: "points-wait", line: "", by: 2, points: 4 }])).toBe("waiting");
    expect(lineHealth([red, run])).toBe("moving");
    expect(lineHealth([work])).toBe("moving");
  });
  it("orders problems first", () => {
    const order = (["moving", "waiting", "none", "stuck"] as const).slice().sort((a, b) => HEALTH_ORDER[a] - HEALTH_ORDER[b]);
    expect(order).toEqual(["stuck", "none", "waiting", "moving"]);
  });
});
