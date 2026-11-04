import { expect, it } from "vitest";
import { Sim, SIM_HZ, type Train } from "../sim";
import { Layout } from "../track";
import { CARGO } from "./cargo";
import { PILE_CAP } from "./constants";
import { Economy } from "./economy";

// Feedback #26: "This last log wouldn't unload at the sawmill even though there was room for more logs there." The
// crane passed over a wagon while the log pile was full, and (waiting for a full load of planks) never came back to it
// once the mill had used logs and made room.
it("a wagon passed over while the pile was full drops its last logs once there's room (wait for a full load)", () => {
  const layout = new Layout();
  const types = ["straight-216", "straight-216", "depot-sawmill", "straight-216", "straight-216"] as const;
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const d = economy.addDepot("sawmill", ids[2], 0);
  economy.setWaitFull(d.id, true);
  const train = sim.getTrain([...sim.trainIds()][0]) as Train;
  sim.setLever(train.cars[0].id, 1);
  const wagon = train.cars.find((c) => c.kind === "timber")!;
  economy.setCargo(wagon.id, "log", 3);
  // Room for two of its three logs: the pile fills with one still aboard.
  d.piles[CARGO.log.index] = PILE_CAP - 2;
  let full = false;
  for (let i = 0; i < 25 * SIM_HZ; i++) {
    sim.tick();
    economy.tick();
    if (d.piles[CARGO.log.index] >= PILE_CAP) full = true;
  }
  expect(full).toBe(true);
  // (It may have taken planks on since.)
  expect(economy.cargoOf(wagon.id).kind).not.toBe("log");
});
