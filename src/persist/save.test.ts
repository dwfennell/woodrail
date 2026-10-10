import { describe, expect, it } from "vitest";
import { buildStarterWorld } from "../game/starter";
import { SIM_DT } from "../sim";
import { connectorRef, getPieceDef } from "../track";
import { deserializeWorld, serializeWorld, SAVE_VERSION } from "./save";

describe("save format", () => {
  it("round-trips a layout with joints, switch states and trains", () => {
    const world = buildStarterWorld();
    for (let i = 0; i < 3 / SIM_DT; i++) world.sim.tick();
    const sw = [...world.layout.pieceIds()].find((id) => getPieceDef(world.layout.getPiece(id)!.type, false).isSwitch)!;
    world.layout.setSwitchState(sw, 1);

    const json = JSON.stringify(serializeWorld(world.layout, world.sim));
    const loaded = deserializeWorld(JSON.parse(json));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const { layout, sim } = loaded.value;
    expect(layout.pieceCount).toBe(world.layout.pieceCount);
    expect(layout.jointCount).toBe(world.layout.jointCount);
    expect(layout.switchState(sw)).toBe(1);
    expect(sim.trainCount).toBe(2);
    const kinds = sim.trainIds().map((id) => sim.getTrain(id)!.cars.map((c) => c.kind).join(","));
    expect(kinds.sort()).toEqual(["engine,hopper,hopper", "engine,hopper,passenger,caboose"]);
    const levers = sim.trainIds().flatMap((id) => sim.getTrain(id)!.cars.map((c) => c.lever));
    expect(levers).toContain(1);
    for (const id of layout.pieceIds()) {
      const def = getPieceDef(layout.getPiece(id)!.type, layout.getPiece(id)!.flipped);
      def.connectors.forEach((_, i) => expect(layout.joinedConnector(connectorRef(id, i))).not.toBe(-1));
    }
  });

  it("rejects malformed data with a reason instead of throwing", () => {
    const r = deserializeWorld({ version: SAVE_VERSION, pieces: [{ id: "x" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pieces/);
  });

  it("rejects unknown versions", () => {
    const r = deserializeWorld({ version: 999, pieces: [], trains: [], switches: [] });
    expect(r.ok).toBe(false);
  });
});
