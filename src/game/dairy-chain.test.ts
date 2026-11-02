import { describe, expect, it } from "vitest";
import { CARGO, Economy, RECIPES } from "../economy";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { INDUSTRY_ROLE } from "./world";

/**
 * The dairy chain and the orchard by train (tech-tree I3, I4): a closed oval of the game's own depot pieces, the
 * industries on one side and a town's station on the other, one hand-run train going round. Nothing is written into
 * a pile: the farm grows grain, the mill grinds it, the dairy's cows give milk, and the bakery bakes bread only from
 * the flour and milk the train brings it.
 */
function loop(industries: PieceTypeId[], cars: CarKind[]) {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  // (The other side as long as the industries' side, so the oval closes: the station and straights.)
  const sequence: PieceTypeId[] = [...half, ...industries, ...half, "station", ...industries.slice(1).map((): PieceTypeId => "straight-216")];
  const ids: number[] = [];
  let last = -1;
  for (const type of sequence) {
    last = last === -1 ? layout.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, type, false, connectorRef(last, 1));
    ids.push(last);
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const depots = industries.map((type) => economy.addDepot(INDUSTRY_ROLE[type]!, ids[sequence.indexOf(type)]));
  const town = economy.addDepot("town", ids[sequence.indexOf("station")], 0);
  const placed = sim.addTrain(cars, { pieceId: ids[ids.length - 1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
  const run = (minutes: number) => {
    for (let i = 0; i < minutes * 60 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
    expect(sim.getTrain(placed.trainId)!.derailed).toBe(false);
  };
  return { layout, sim, economy, depots, town, run, closed: [...layout.joints()].length === sequence.length };
}

describe("the dairy chain", () => {
  it("a bakery takes two goods, flour and milk, and makes bread of them", () => {
    expect(RECIPES.dairy).toMatchObject({ takes: [], gives: ["milk"] });
    expect(RECIPES.bakery).toMatchObject({ takes: ["flour", "milk"], gives: ["bread"], cycle: { uses: { flour: 1, milk: 1 }, makes: { bread: 1 } } });
    expect(RECIPES.orchard).toMatchObject({ takes: [], gives: ["fruit"] });
    // Towns take all three.
    for (const k of ["milk", "bread", "fruit"] as const) expect(RECIPES.town.takes).toContain(k);
  });

  it("farm → mill and dairy → bakery → town: the train brings the bakery flour and milk, and the town gets bread", () => {
    const { closed, depots, town, run, economy } = loop(["depot-farm", "depot-mill", "depot-dairy", "depot-bakery"], ["engine", "hopper", "van", "tanker"]);
    expect(closed).toBe(true);
    const [, , dairy, bakery] = depots;
    run(25);
    const got = economy.deliveredGoods.get(0) ?? {};
    // The bakery baked (it made bread of the flour and milk it was brought), and bread reached the town by van.
    expect(economy.made[CARGO.bread.index]).toBeGreaterThan(0);
    expect(got.bread ?? 0).toBeGreaterThan(0);
    // Milk came from the dairy by tank wagon (it gives only milk, and only a tank wagon carries it).
    expect(economy.made[CARGO.milk.index]).toBeGreaterThan(0);
    expect(dairy.role).toBe("dairy");
    expect(bakery.role).toBe("bakery");
    expect(town.role).toBe("town");
  }, 120_000);

  it("without milk the bakery bakes nothing: flour alone isn't bread", () => {
    const { run, economy, depots } = loop(["depot-farm", "depot-mill", "depot-bakery"], ["engine", "hopper", "van"]);
    run(15);
    expect(economy.made[CARGO.flour.index]).toBeGreaterThan(0);
    expect(depots[2].piles[CARGO.flour.index]).toBeGreaterThan(0);
    expect(economy.made[CARGO.bread.index]).toBe(0);
  }, 120_000);

  it("an orchard's fruit rides on flatbeds to a town", () => {
    const { run, economy } = loop(["depot-orchard"], ["engine", "timber", "timber"]);
    run(10);
    expect(economy.deliveredGoods.get(0)?.fruit ?? 0).toBeGreaterThan(0);
  }, 120_000);
});
