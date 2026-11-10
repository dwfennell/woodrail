import { describe, expect, it } from "vitest";
import { AIRSHIP_SEATS, Economy } from "../economy";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { Airships, BASE_FARE, MAX_FARE, TOUR_SECONDS, TOUR_WAIT, tourSights } from "./airship";
import { BLUEPRINTS } from "./blueprints";
import { attachPassengers, fareFor } from "./passengers";
import { Progress } from "./progress";
import { THING_RULES } from "./things";
import { buildStarterWorld, INDUSTRY_ROLE, STATION_CRANE_AT, type World } from "./world";

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

/** A town's station and an airship mast on a line, a coach train between. */
function line(cars: CarKind[] = ["passenger", "engine"]) {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  endAt(layout, connectorRef(a, 0));
  let last = a;
  const straights: number[] = [];
  for (let i = 0; i < 4; i++) straights.push((last = lay(layout, i === 0 ? connectorRef(a, 1) : otherEnd(layout, last), "straight-216")));
  const b = lay(layout, otherEnd(layout, last), "depot-mast");
  endAt(layout, otherEnd(layout, b));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: straights[0], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const town = economy.addDepot("town", a, 0, STATION_CRANE_AT);
  const mast = economy.addDepot("mast", b);
  const w = { layout, sim, economy, landscape: { towns: [] } } as unknown as World;
  const car = (kind: CarKind) => sim.getTrain(sim.trainIds()[0])!.cars.find((c) => c.kind === kind)!;
  sim.setLever(car("engine").id, 1);
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
  };
  return { w, economy, town, mast, car, run };
}

const SIGHTS = { bridges: 2, towns: 1, trains: 1, fare: 9 };

describe("the airship's tours", () => {
  it("riders a train brings board the airship at its mast (nothing paid yet), up to its seats", () => {
    const { w, economy, town, mast, car, run } = line();
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    const coach = car("passenger").id;
    economy.setRiders(coach, 4, town.id);
    run(20);
    expect(mast.flyers).toBe(4);
    expect(p.coins).toBe(0);
    expect(fareFor(w, town, mast, coach)).toBe(0);
    mast.flyers = AIRSHIP_SEATS;
    economy.setRiders(coach, 2, town.id);
    run(40);
    expect(mast.flyers).toBe(AIRSHIP_SEATS);
  });

  it("takes off when it's full, and as it lands each rider pays the tour's fare", () => {
    const { w, mast } = line();
    const p = Progress.fresh();
    const ships = new Airships();
    ships.update(w, p, 0, () => SIGHTS);
    mast.flyers = AIRSHIP_SEATS;
    expect(ships.update(w, p, 1, () => SIGHTS)).toEqual([]);
    expect(ships.phase(mast.id).kind).toBe("touring");
    expect(mast.flyers).toBe(0);
    expect(ships.update(w, p, TOUR_SECONDS, () => SIGHTS)).toEqual([]);
    expect(ships.update(w, p, TOUR_SECONDS + 1, () => SIGHTS)).toEqual([{ depotId: mast.id, riders: AIRSHIP_SEATS, paid: AIRSHIP_SEATS * SIGHTS.fare }]);
    expect(p.coins).toBe(AIRSHIP_SEATS * SIGHTS.fare);
    expect(ships.phase(mast.id).kind).toBe("docked");
  });

  it("with a few aboard it waits a while for more, then goes anyway", () => {
    const { w, mast } = line();
    const p = Progress.fresh();
    const ships = new Airships();
    ships.update(w, p, 0, () => SIGHTS);
    mast.flyers = 2;
    ships.update(w, p, TOUR_WAIT - 1, () => SIGHTS);
    expect(ships.phase(mast.id).kind).toBe("docked");
    ships.update(w, p, TOUR_WAIT + 1, () => SIGHTS);
    expect(ships.state(mast.id)).toMatchObject({ touring: true, aboard: 2, fare: SIGHTS.fare });
  });
});

describe("what there is to see", () => {
  it("bridges, towns and trains in the loop add to the fare, up to a most", () => {
    const w = buildStarterWorld();
    const c = w.landscape.towns[0].centre;
    const bare = tourSights(w, { x: c.x, z: c.z });
    expect(bare.towns).toBeGreaterThanOrEqual(1);
    expect(bare.fare).toBe(Math.min(MAX_FARE, BASE_FARE + bare.bridges + 2 * bare.towns + bare.trains));
    // A bridge laid in the loop: a coin more.
    w.layout.addPiece("bridge", { x: c.x + 100, z: c.z + 100, heading: 0 });
    expect(tourSights(w, { x: c.x, z: c.z }).bridges).toBe(bare.bridges + 1);
  });

  it("is a blueprint after the airport, its mast made at the workshop", () => {
    const b = BLUEPRINTS.find((x) => x.id === "airship")!;
    expect(b).toBeDefined();
    expect(b.needs).toEqual(["airport"]);
    expect(THING_RULES["piece:depot-mast"]?.tech).toBe("airship");
    expect(INDUSTRY_ROLE["depot-mast"]).toBe("mast");
  });
});
