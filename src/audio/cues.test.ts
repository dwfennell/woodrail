import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { PILE_CAP } from "../economy/constants";
import { Economy } from "../economy/economy";
import { Sim, SIM_HZ } from "../sim";
import { Layout } from "../track";
import { hearCranes } from "./cues";

/** A sawmill on a line, and an engine and a timber wagon of logs running into it (as a player's train would). */
function sawmillRun() {
  const layout = new Layout();
  const types = ["straight-216", "straight-216", "depot-sawmill", "straight-216", "straight-216"] as const;
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const depot = economy.addDepot("sawmill", ids[2], 0);
  const train = sim.getTrain(placed.trainId)!;
  sim.setLever(train.cars[0].id, 1);
  economy.setCargo(train.cars[1].id, "log", 3);
  depot.piles[CARGO.planks.index] = PILE_CAP;
  return { sim, economy, depot };
}

describe("cranes are heard by what they move", () => {
  it("a wagon of logs unloading at a sawmill and loading planks: a sound per unit, by its cargo, at the depot", () => {
    const { sim, economy, depot } = sawmillRun();
    const heard: string[] = [];
    const audio = { goods: (cargo: string, loaded: boolean, v: number) => heard.push(`${loaded ? "on" : "off"}:${cargo}:${v}`) };
    for (let i = 0; i < 40 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      // (A frame a tick, here: each crane move is heard.)
      hearCranes(economy.drainEvents(), audio, (id) => (id === depot.id ? [0.5, 0] : null));
    }
    expect(heard).toEqual(["off:log:0.5", "off:log:0.5", "off:log:0.5", "on:planks:0.5", "on:planks:0.5", "on:planks:0.5"]);
  });

  it("several moves at one depot in a frame are one sound; other depots are heard too; a gone depot isn't", () => {
    const heard: number[] = [];
    const audio = { goods: (_c: string, _l: boolean, v: number) => heard.push(v) };
    const at = (id: number) => (id === 3 ? null : ([id / 10, 0] as const));
    hearCranes(
      [
        { kind: "unloaded", depotId: 1, cargo: "log" },
        { kind: "unloaded", depotId: 1, cargo: "log" },
        { kind: "loaded", depotId: 2, cargo: "planks" },
        { kind: "loaded", depotId: 3, cargo: "planks" },
      ],
      audio,
      at,
    );
    expect(heard).toEqual([0.1, 0.2]);
  });
});
