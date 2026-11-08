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

describe("the Lines list's order", () => {
  it("lists problems first: stuck, then no trains, waiting, moving; by name within each", async () => {
    const { sortRows } = await import("../ui/lines-view");
    const row = (id: number, name: string, health: "none" | "moving" | "waiting" | "stuck") => ({ id, name, colour: "#000000", stops: [], trains: 0, carries: "", health, healthWords: "", loads: "" });
    const out = sortRows([row(1, "Red line", "moving"), row(2, "Blue line", "stuck"), row(3, "Alpha", "moving"), row(4, "Green line", "none"), row(5, "Teal", "waiting")]);
    expect(out.map((r) => r.id)).toEqual([2, 4, 5, 3, 1]);
  });
});
