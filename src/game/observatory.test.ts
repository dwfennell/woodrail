import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, getPieceDef, KITS, Layout, OBSERVATORY_KIT, type PieceTypeId } from "../track";
import { attachPassengers, fareFor, LOOKOUT_FARE, STARGAZER_FARE } from "./passengers";
import { Progress } from "./progress";
import { BLUEPRINTS } from "./blueprints";
import { THING_RULES } from "./things";
import { buildStarterWorld, haltWhy, OBSERVATORY_LOW, STATION_CRANE_AT, syncIndustries, type World } from "./world";

function lay(layout: Layout, ref: number, type: PieceTypeId): number {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  return appendPiece(layout, type, false, ref, via);
}
const otherEnd = (layout: Layout, id: number) => [0, 1].map((k) => connectorRef(id, k)).find((r) => layout.joinedConnector(r) === -1)!;
function endAt(layout: Layout, ref: number): void {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  lay(layout, end.kind === "peg" ? ref : otherEnd(layout, lay(layout, ref, "adapter-peg")), "buffer-turnback");
}

/** Town A's station, a straight, an observatory, two straights, town B's station; a train heading for B. */
function line() {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  endAt(layout, connectorRef(a, 0));
  const s0 = lay(layout, connectorRef(a, 1), "straight-216");
  const h = lay(layout, otherEnd(layout, s0), OBSERVATORY_KIT);
  let last = h;
  for (let i = 0; i < 2; i++) last = lay(layout, otherEnd(layout, last), "straight-216");
  const b = lay(layout, otherEnd(layout, last), "station");
  endAt(layout, otherEnd(layout, b));
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine", "passenger"], { pieceId: s0, pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  economy.addDepot("town", a, 0, STATION_CRANE_AT);
  const B = economy.addDepot("town", b, 1, STATION_CRANE_AT);
  const O = economy.addDepot("town", h, 0);
  const w = { layout, sim, economy, stations: new Map([[0, a], [1, b]]), landscape: { towns: [] } } as unknown as World;
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  sim.setLever(train().cars[0].id, 1);
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
  };
  return { w, economy, B, O, train, run };
}

describe("the observatory", () => {
  it("is a stop for stargazers: riders from a town get off there and pay three times the fare", () => {
    const { w, economy, B, O, train, run } = line();
    const p = Progress.fresh();
    const paid: number[] = [];
    attachPassengers(w, () => p, (fare, _from, to) => void (to === O && paid.push(fare)));
    expect(economy.isLookout(O)).toBe(true);
    B.waiting = 3;
    const coach = train().cars.find((c) => c.kind === "passenger")!.id;
    run(14);
    expect(economy.ridersOf(coach).count).toBe(3);
    run(12);
    const plain = Math.max(1, Math.round(Math.abs(w.layout.getPiece(B.pieceId)!.pose.x - w.layout.getPiece(O.pieceId)!.pose.x) / 800));
    expect(paid).toEqual([plain * STARGAZER_FARE, plain * STARGAZER_FARE, plain * STARGAZER_FARE]);
    expect(STARGAZER_FARE).toBeGreaterThan(LOOKOUT_FARE);
    expect(fareFor(w, B, O, coach)).toBe(plain * STARGAZER_FARE);
  });

  it("stands only on a hilltop, and is a stop of the nearest town however far; comes back from a save", () => {
    const w = buildStarterWorld();
    const town = w.landscape.towns[0];
    expect(haltWhy(w.landscape, OBSERVATORY_KIT, { x: town.centre.x + 300, z: town.centre.z, heading: 0 })).toBe(OBSERVATORY_LOW);
    const id = w.layout.addPiece(OBSERVATORY_KIT, { x: 20000, z: 20000, heading: 0 }, 0, false);
    expect(syncIndustries(w, true)).toBe(true);
    const d = w.economy.depotAtPiece(id)!;
    expect(w.economy.isLookout(d)).toBe(true);
    const back = deserializeWorld(serializeWorld(w));
    if (!back.ok) throw new Error("didn't load");
    expect(back.value.economy.isLookout(back.value.economy.depotAtPiece(id)!)).toBe(true);
  });

  it("is researched (Learning, tier 3, after University and Foundry), made with iron, its model a code model", () => {
    const row = BLUEPRINTS.find((b) => b.id === "observatory")!;
    expect(row).toBeDefined();
    expect(row.branch).toBe("learning");
    expect(THING_RULES["piece:kit-observatory"]).toMatchObject({ tech: "observatory", cost: { iron: 4 } });
    expect(KITS[OBSERVATORY_KIT].asset).toBe("bldg-observatory");
  });
});
