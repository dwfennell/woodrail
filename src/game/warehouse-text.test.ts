import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { engineStatus } from "./engine-status";
import { STORE_HELP, STORE_NO_ROUTE, STORE_NOT_A_STOP, storeSkipText, storeStock, storeStopText } from "./warehouse-text";

function chain(types: PieceTypeId[]): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(layout, types[i], false, connectorRef(ids[i - 1], 1)));
  return { layout, ids };
}

describe("warehouse words", () => {
  it("say why a train beside one trades nothing, and what to do", () => {
    expect(storeSkipText(false)).toBe("Warehouses trade with trains on a route. Plan a route with a stop here");
    expect(storeSkipText(true)).toBe("This warehouse isn't on its route. Edit the route to add a stop here");
    expect(STORE_HELP).toBe("Drop goods here to keep them for later. On a route, set its stop to Only drop or Only pick up");
  });

  it("the card lists only goods it holds, or Empty", () => {
    expect(storeStock([{ label: "🌲 Logs", count: 0, cap: 24 }])).toBe("Empty");
    expect(storeStock([{ label: "🌲 Logs", count: 0, cap: 24 }, { label: "🪵 Planks", count: 6, cap: 24 }, { label: "⚙ Iron", count: 2, cap: 24 }])).toBe("🪵 Planks 6/24   ·   ⚙ Iron 2/24");
  });

  it("each stop action says what it does at a warehouse", () => {
    expect(storeStopText("auto")).toBe(storeStopText("both"));
    expect(storeStopText("auto")).toMatch(/no later stop wants/);
    expect(storeStopText("drop")).toBe("Drops all its goods here, picks up none");
    expect(storeStopText("pick")).toBe("Picks up goods here, drops none");
  });

  it("the engine card says it for a hand-run train standing at a warehouse; not for an engine alone, nor one with a stop there", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const store = economy.addDepot("warehouse", ids[2]);
    const other = economy.addDepot("sawmill", ids[0]);
    const lone = sim.addTrain(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
    if (lone.kind !== "placed") throw new Error();
    const loneEngine = sim.getTrain(lone.trainId)!.cars[0].id;
    expect(engineStatus(sim, economy, loneEngine, () => "x")).toBe("Stopped");
    sim.removeTrain(lone.trainId);
    const r = sim.addTrain(["engine", "timber"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 200 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    expect(economy.storeItSkips(r.trainId)?.id).toBe(store.id);
    expect(engineStatus(sim, economy, engine, () => "x")).toBe(STORE_NO_ROUTE);
    economy.setRoute(engine, { stops: [{ depotId: other.id, action: "both" }], next: 0 });
    expect(engineStatus(sim, economy, engine, () => "x")).toBe(STORE_NOT_A_STOP);
    economy.setRoute(engine, { stops: [{ depotId: other.id, action: "both" }, { depotId: store.id, action: "both" }], next: 0 });
    expect(economy.storeItSkips(r.trainId)).toBeNull();
    expect(engineStatus(sim, economy, engine, () => "x")).not.toMatch(/[Ww]arehouse/);
  });
});
