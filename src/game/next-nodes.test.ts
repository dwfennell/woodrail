import { describe, expect, it } from "vitest";
import { canCarry, CARGO, CARGO_KINDS, Economy, RECIPES, type CargoKind } from "../economy";
import { CAR_KINDS, CAR_SPECS, Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { firstFoodNews } from "./food-text";
import { buysText } from "./town-ledger";
import { FULL_PAY, LUXURIES, payFor, PRICES, townStatus } from "./towns";
import { STICKERS, type StickerContext } from "./stickers";
import { THING_RULES } from "./things";
import type { World } from "./world";
import { INDUSTRY_ROLE } from "./world";

/**
 * The tech tree's next nodes (spec "Next nodes", 2026-11-02) by train: a closed oval of the game's own depot pieces,
 * the industries on one side and a town's station on the other, one hand-run train going round. Nothing is written
 * into a pile: each industry makes its goods only of what the train brings it, and the town gets them.
 */
function loop(industries: PieceTypeId[], cars: CarKind[]) {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
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
  economy.addDepot("town", ids[sequence.indexOf("station")], 0);
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
  const got = (k: CargoKind) => economy.deliveredGoods.get(0)?.[k] ?? 0;
  return { economy, depots, run, got, closed: [...layout.joints()].length === sequence.length };
}

const bp = (id: string) => BLUEPRINTS.find((b) => b.id === id)!;

describe("Juice works", () => {
  it("is built: a row with no plan after Orchards, mostly coins, and the juice works it brings", () => {
    expect(bp("juice").plan).toBeUndefined();
    expect(bp("juice")).toMatchObject({ needs: ["orchard"], tier: 2, research: { goods: { planks: 8 }, coins: 120 } });
    expect(THING_RULES["piece:depot-juicer"]).toMatchObject({ tech: "juice", coins: 200 });
    expect(RECIPES.juicer).toMatchObject({ takes: ["fruit"], gives: ["juice"], cycle: { uses: { fruit: 1 }, makes: { juice: 1 } } });
  });

  it("orchard → juice works → town: fruit by flatbed, juice in crates by van", () => {
    const { closed, run, economy, got } = loop(["depot-orchard", "depot-juicer"], ["engine", "timber", "van"]);
    expect(closed).toBe(true);
    run(15);
    expect(economy.made[CARGO.juice.index]).toBeGreaterThan(0);
    expect(got("juice")).toBeGreaterThan(0);
  }, 120_000);

  it("a juice works with no fruit brought makes nothing", () => {
    const { run, economy } = loop(["depot-juicer"], ["engine", "van"]);
    run(5);
    expect(economy.made[CARGO.juice.index]).toBe(0);
  }, 60_000);
});

describe("goods towns always buy at full pay", () => {
  it("every one is taken by towns, paid in full at any level, and none is wanted to grow", () => {
    for (const k of FULL_PAY) {
      expect(RECIPES.town.takes, k).toContain(k);
      expect(LUXURIES.has(k), k).toBe(true);
      expect(payFor(k, townStatus({})), k).toBe(PRICES[k]);
      expect(CARGO_KINDS, k).toContain(k);
    }
    // No study asks for them: the balance player would research toward them (`towardChains`).
    for (const b of BLUEPRINTS) for (const k of Object.keys(b.research.goods)) expect(FULL_PAY.has(k as CargoKind), `${b.id} asks ${k}`).toBe(false);
  });

  it("the News says the first of each, and the town card lists the learned ones", () => {
    expect(firstFoodNews("juice", 2, 2, "Ashby")).toBe("First juice! 🧃 Ashby buys it at full pay");
    expect(firstFoodNews("juice", 2, 5, "Ashby")).toBeNull();
    expect(buysText(new Set(["orchard", "juice"]))).toBe("Always buys 🍎 fruit and 🧃 juice at full pay");
  });
});

describe("Creamery", () => {
  it("is built: after Dairy farm, mostly coins, the creamery it brings makes cheese of milk", () => {
    expect(bp("creamery").plan).toBeUndefined();
    expect(bp("creamery")).toMatchObject({ needs: ["dairy"], tier: 2, research: { goods: { planks: 10 }, coins: 140 } });
    expect(THING_RULES["piece:depot-creamery"]).toMatchObject({ tech: "creamery", coins: 240 });
    expect(RECIPES.creamery).toMatchObject({ takes: ["milk"], gives: ["cheese"], cycle: { uses: { milk: 1 }, makes: { cheese: 1 } } });
  });

  it("dairy → creamery → town: milk by tank wagon, cheese by van", () => {
    const { closed, run, economy, got } = loop(["depot-dairy", "depot-creamery"], ["engine", "tanker", "van"]);
    expect(closed).toBe(true);
    run(15);
    expect(economy.made[CARGO.cheese.index]).toBeGreaterThan(0);
    expect(got("cheese")).toBeGreaterThan(0);
  }, 120_000);
});

describe("Cold van", () => {
  it("is built: after Creamery, a wagon of its own (4 planks) that carries cheese", () => {
    expect(bp("reefer").plan).toBeUndefined();
    expect(bp("reefer")).toMatchObject({ needs: ["creamery"], tier: 2, research: { goods: { planks: 4 }, coins: 100 } });
    expect(THING_RULES["car:reefer"]).toMatchObject({ tech: "reefer", cost: { planks: 4 } });
    expect(CAR_KINDS.filter((k) => canCarry(k, "cheese"))).toEqual(["van", "reefer"]);
    expect(canCarry("reefer", "milk")).toBe(false);
    expect(CAR_SPECS.reefer).toMatchObject({ length: 84, powered: false });
  });

  it("a cold van carries the creamery's cheese to town", () => {
    const { run, got, economy } = loop(["depot-dairy", "depot-creamery"], ["engine", "tanker", "reefer"]);
    run(15);
    expect(economy.made[CARGO.cheese.index]).toBeGreaterThan(0);
    expect(got("cheese")).toBeGreaterThan(0);
  }, 120_000);
});

describe("Ice cream factory", () => {
  it("is built: tier 3 after the Cold van and Orchards, two goods from two chains make ice cream", () => {
    expect(bp("ice-cream").plan).toBeUndefined();
    expect(bp("ice-cream")).toMatchObject({ needs: ["reefer", "orchard"], tier: 3, research: { goods: { planks: 10 }, coins: 200 } });
    expect(THING_RULES["piece:depot-icecream"]).toMatchObject({ tech: "ice-cream", coins: 360 });
    expect(RECIPES.icecream).toMatchObject({ takes: ["milk", "fruit"], gives: ["icecream"], cycle: { uses: { milk: 1, fruit: 1 }, makes: { icecream: 1 } } });
    // Ice cream rides in a cold van and nothing else.
    expect(CAR_KINDS.filter((k) => canCarry(k, "icecream"))).toEqual(["reefer"]);
  });

  it("(milk + fruit) → ice cream: the train brings both, and a cold van takes the ice cream to town", () => {
    const { closed, run, economy, got } = loop(["depot-dairy", "depot-orchard", "depot-icecream"], ["engine", "tanker", "timber", "reefer"]);
    expect(closed).toBe(true);
    run(20);
    expect(economy.made[CARGO.icecream.index]).toBeGreaterThan(0);
    expect(got("icecream")).toBeGreaterThan(0);
    // The hidden sticker for it: earned by the delivery itself (its check reads the economy's totals).
    const sticker = STICKERS.find((s) => s.id === "ice-cream-day")!;
    expect(sticker.hidden).toBe(true);
    expect(sticker.check({ economy } as unknown as World, {} as StickerContext)).toBe(true);
  }, 120_000);

  it("fruit alone isn't ice cream, and without a cold van it stays at the factory", () => {
    const fruitOnly = loop(["depot-orchard", "depot-icecream"], ["engine", "timber", "reefer"]);
    fruitOnly.run(10);
    expect(fruitOnly.economy.made[CARGO.icecream.index]).toBe(0);
    const noColdVan = loop(["depot-dairy", "depot-orchard", "depot-icecream"], ["engine", "tanker", "timber", "van"]);
    noColdVan.run(15);
    expect(noColdVan.economy.made[CARGO.icecream.index]).toBeGreaterThan(0);
    expect(noColdVan.got("icecream")).toBe(0);
  }, 120_000);
});
