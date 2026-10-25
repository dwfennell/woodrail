import { beforeAll, describe, expect, it } from "vitest";
import { CARGO, Economy, MAX_WAGON_CAPACITY } from "../economy";
import { ticks } from "../economy/constants";
import { loadFootprints } from "../props/footprints-testing";
import type { Footprint } from "../props/placement";
import { ENGINE_SPEED, Sim } from "../sim";
import { appendPiece, connectorRef, Layout } from "../track";
import { tooHeavy, topSpeed } from "./engines";
import { dueLandmarks } from "./landmarks";
import { Progress } from "./progress";
import { ready, techOf } from "./tech";
import { TownLife, type TownLifeHost } from "./town-life";
import { applyCranes } from "./upgrades";
import { buildStarterWorld, type World } from "./world";

/** The game's own prop footprints (`Game.footprintOf`), so towns grow around their props as in the game. (Its props are towns' buildings.) */
let footprintOf: (asset: string) => Footprint | undefined = () => {
  throw new Error("footprints not loaded yet (see beforeAll)");
};
beforeAll(async () => {
  footprintOf = await loadFootprints(["bldg"]);
}, 60_000);

describe("Phase C, the rest", () => {
  it("a carpenter's yard makes furniture of planks; a smithy tools of iron; a power station burns coal", () => {
    const layout = new Layout();
    const ids = ["depot-carpenter", "depot-smithy", "depot-power"].map((t, i) => layout.addPiece(t as never, { x: i * 400, z: 0, heading: 0 }));
    const e = new Economy(layout, new Sim(layout));
    const [carp, smith, power] = [e.addDepot("carpenter", ids[0]), e.addDepot("smithy", ids[1]), e.addDepot("power", ids[2])];
    carp.piles[CARGO.planks.index] = 6;
    smith.piles[CARGO.iron.index] = 4;
    power.piles[CARGO.coal.index] = 1;
    expect(e.working(power)).toBe(true);
    for (let i = 0; i < ticks(40); i++) e.tick();
    expect(carp.piles[CARGO.furniture.index]).toBe(2);
    expect(smith.piles[CARGO.tools.index]).toBe(2);
    expect(e.working(power)).toBe(true);
    for (let i = 0; i < ticks(30); i++) e.tick();
    expect(e.working(power)).toBe(false);
  });

  it("towns always take made goods (furniture, tools), wanted or not", () => {
    const w = buildStarterWorld();
    const host: TownLifeHost = Object.assign(w, { footprintOf: (asset: string) => footprintOf(asset), editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
    new TownLife(host, { grew: () => {}, received: () => {} }).reset();
    const station = w.economy.depotAtPiece(w.stations.get(w.landscape.towns[0].id)!)!;
    expect(w.economy.accepts!(station, "furniture")).toBe(true);
    expect(w.economy.accepts!(station, "tools")).toBe(true);
    expect(w.economy.accepts!(station, "iron")).toBe(false); // not wanted by a hamlet
  });

  it("towns build no college (your school becomes one), and College makes nothing cheaper", () => {
    const w = buildStarterWorld();
    const [a] = w.landscape.towns;
    expect(dueLandmarks(w.landscape, a, 3, () => true).map((m) => m.id)).toEqual(["market"]);
    expect(techOf("junctions")!.research).toEqual({ goods: { planks: 6 } });
  });

  it("the smithy's heavy wagons hold 5; the grab cranes need it", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    for (const t of ["cranes1", "cranes2", "harvesters", "sawmills", "farming", "mills", "quarries", "tank", "goods-engine", "mines", "foundry", "carpentry"]) p.learned.add(t);
    p.bestLevel = 4;
    p.landmarks.add("city-school");
    expect(ready(p, "cranes3")).toBe(false);
    p.learned.add("smithy");
    expect(ready(p, "cranes3")).toBe(true);
    applyCranes(w.economy, p);
    expect(w.economy.wagonCapacity).toBe(MAX_WAGON_CAPACITY);
  });

  it("an electric engine runs only while a power station has coal", () => {
    const layout = new Layout();
    let last = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    for (let i = 0; i < 6; i++) last = appendPiece(layout, "straight-216", false, connectorRef(last, 1));
    const powerPiece = layout.addPiece("depot-power", { x: 0, z: 800, heading: 0 });
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine", "timber"], { pieceId: last, pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") throw new Error("no room");
    const train = sim.getTrain(placed.trainId)!;
    sim.setLook(train.cars[0].id, "electric");
    const economy = new Economy(layout, sim);
    const power = economy.addDepot("power", powerPiece);
    const w = { layout, sim, economy } as unknown as World;
    expect(topSpeed(w, train)).toBe(0);
    expect(tooHeavy(w, train)).toMatch(/No power/);
    power.piles[CARGO.coal.index] = 2;
    expect(topSpeed(w, train)).toBeCloseTo(ENGINE_SPEED * 1.4);
  });
});
