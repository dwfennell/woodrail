import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { Sim, SIM_HZ, TURNBACK_TICKS } from "./sim";

function line(end: "buffer" | "buffer-turnback") {
  const layout = new Layout();
  const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  layout.addPiece("straight-216", { x: 216, z: 0, heading: 0 });
  layout.addPiece(end, { x: 432, z: 0, heading: 0 });
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine", "timber"], { pieceId: a, pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = sim.getTrain(placed.trainId)!;
  sim.setLever(train.cars[0].id, 1);
  return { sim, train };
}

describe("turnback buffer", () => {
  it("a train resting on it waits two seconds, then drives back", () => {
    const { sim, train } = line("buffer-turnback");
    let arrived = -1;
    let left = -1;
    for (let i = 0; i < 20 * SIM_HZ && left === -1; i++) {
      const x = train.world[0].x;
      sim.tick();
      if (arrived === -1 && train.speed === 0 && i > 10) arrived = i;
      if (arrived !== -1 && sim.getTrain(train.id)!.cars.find((c) => c.kind === "engine")!.lever === -1 && train.world[0].x !== x) left = i;
    }
    expect(arrived).not.toBe(-1);
    expect(left - arrived).toBeGreaterThanOrEqual(TURNBACK_TICKS - 2);
    expect(left - arrived).toBeLessThanOrEqual(TURNBACK_TICKS + 2);
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.tick();
    // Heading away from the buffer now.
    expect(Math.max(...train.world.map((w) => w.x))).toBeLessThan(432);
  });

  it("an ordinary buffer just stops the train", () => {
    const { sim, train } = line("buffer");
    for (let i = 0; i < 20 * SIM_HZ; i++) sim.tick();
    expect(train.speed).toBe(0);
    expect(train.cars[0].lever).toBe(1);
  });
});
