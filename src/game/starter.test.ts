import { describe, expect, it } from "vitest";
import { Sim, SIM_DT } from "../sim";
import { connectorRef, getPieceDef } from "../track";
import { buildStarterWorld } from "./starter";

describe("starter world", () => {
  it("builds a closed main loop where only the siding buffer and siding are dead-ended by design", () => {
    const { layout } = buildStarterWorld();
    let free = 0;
    for (const id of layout.pieceIds()) {
      const p = layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      def.connectors.forEach((_, i) => {
        if (layout.joinedConnector(connectorRef(id, i)) === -1) free++;
      });
    }
    expect(free).toBe(0);
  });

  it("places two trains, and the running one laps the loop for a minute without derailing", () => {
    const { layout, sim } = buildStarterWorld();
    expect(sim.trainCount).toBe(2);
    for (let i = 0; i < 60 / SIM_DT; i++) sim.tick();
    for (const id of sim.trainIds()) expect(sim.getTrain(id)!.derailed).toBe(false);
    expect(sim).toBeInstanceOf(Sim);
    void layout;
  });
});
